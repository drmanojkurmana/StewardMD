// functions/_connect/abdm/hip-sources/connected-emr.js — the HIP source for hospitals that HAVE an EMR.
//
// This is the other half of the product: StewardMD connects AI, tools and OPD to whatever EMR the
// hospital already runs. There, the EMR is authoritative for the clinical record and StewardMD holds only
// a minimal shadow (docs/queue/opd-platform-architecture.md §8). So a care context is NOT served from our
// store - it is FETCHED THROUGH THE CONNECTOR at the moment ABDM asks, then projected.
//
// That fetch-on-demand shape is the right one for three separate reasons:
//   - it needs no second copy of the hospital's record, so nothing to keep in sync and nothing extra to
//     breach;
//   - the retention conflict that dogs the native source does not arise, because the EMR keeps its own
//     records for as long as the hospital's own policy says;
//   - the hospital stays the record of truth, which is what its own compliance posture assumes.
//
// The cost is that a data request is only as available as the hospital's EMR. ABDM allows ~20 minutes for
// the push, so a slow or offline EMR turns into a failed transfer - the caller must report that honestly
// rather than send an empty bundle, which would look to the patient like "no records exist".
//
// NO STEWARDMD ACTOR EXISTS HERE. ABDM is the caller. The tenant comes from the correlation row, never
// from the callback body, and the patient is known only as a pseudonym - hence findLinkByHash and
// buildConnectorCtx rather than the actor-driven loadPatientContext().

import { loadConnectorConfig } from "../../tenant.js";
import { buildConnectorCtx } from "../../engine.js";
import { findLinkByHash } from "../abha-link.js";
import { careContextRef, parseCareContextRef, careContextDisplay } from "../carecontext.js";

/** The hospital's EMR could not be reached or refused. Distinct from "the patient has no records". */
export class EmrUnavailable extends Error {
  constructor(msg) { super("connected EMR unavailable: " + msg); this.name = "EmrUnavailable"; }
}
/** We hold no ABHA binding for this patient at this tenant, so there is nothing to look up in the EMR. */
export class NoPatientBinding extends Error {
  constructor() { super("no ABHA binding for this patient at this tenant"); this.name = "NoPatientBinding"; }
}

const HITYPE_TO_RECORD = {
  OPConsultation: "OPConsultRecord", Prescription: "PrescriptionRecord",
  DiagnosticReport: "DiagnosticReportRecord", DischargeSummary: "DischargeSummaryRecord",
};

/** Encounter class -> care-context kind. ABDM wants one context per OP visit and one per admission. */
function kindOf(enc) {
  const c = String((enc && (enc.class && (enc.class.code || enc.class))) || "").toUpperCase();
  return (c === "IMP" || c === "ACUTE" || c === "NONAC" || c === "INPATIENT") ? "ipd" : "opd";
}

/** What an encounter can offer, judged from what the bundle actually carries for it. PURE. */
export function hiTypesForEncounter(bundleLike, encounterId) {
  const b = bundleLike || {};
  const mine = (arr) => (arr || []).filter((r) => !r.encounter || r.encounter === encounterId || (r.encounter && r.encounter.id === encounterId));
  const out = [];
  if (mine(b.documents).length || mine(b.conditions).length) out.push("OPConsultation");
  if (mine(b.medications).length) out.push("Prescription");
  if (mine(b.diagnosticReports).length || mine(b.observations).length) out.push("DiagnosticReport");
  return out;
}

/** Narrow a whole-patient bundle down to one encounter, so we never over-share. PURE. */
export function sliceBundleToEncounter(bundleLike, encounterId) {
  const b = bundleLike || {};
  const mine = (arr) => (arr || []).filter((r) => r && (!r.encounter || r.encounter === encounterId || (r.encounter && r.encounter.id === encounterId)));
  return {
    ...b,
    encounters: (b.encounters || []).filter((e) => e && e.id === encounterId),
    conditions: mine(b.conditions), medications: mine(b.medications),
    observations: mine(b.observations), diagnosticReports: mine(b.diagnosticReports),
    documents: mine(b.documents),
  };
}

/**
 * Fetch the patient's whole context from the hospital EMR through its configured connector.
 * `deps` = { db, connectors, fetch, now, env }.
 */
async function fetchFromEmr(env, deps, { tenant, patientRef }) {
  const config = await loadConnectorConfig(deps.db, tenant.id, tenant.connectorId);
  if (!config) throw new EmrUnavailable("connector not configured for tenant " + tenant.id);
  const connector = deps.connectors && deps.connectors[tenant.connectorId];
  if (!connector) throw new EmrUnavailable("connector not registered: " + tenant.connectorId);

  let granted;
  try { granted = JSON.parse(tenant.granted_scopes || "[]"); }
  catch { throw new EmrUnavailable("tenant has invalid granted_scopes"); }

  const ctx = buildConnectorCtx(env, tenant, config, granted, Date.now(), { fetch: deps.fetch });
  try {
    const raw = await connector.fetchPatient(ctx, patientRef);
    return await connector.normalize(ctx, raw);
  } catch (e) {
    // Never degrade an upstream failure into an empty projection: to the patient that reads as
    // "this hospital has no records for me", which is a different and wrong statement.
    throw new EmrUnavailable((e && e.message) || "fetch failed");
  }
}

/** Resolve the EMR-side patient reference for a pseudonym, via the ABHA binding. */
async function patientRefFor(deps, { tenantId, patientAbhaHash }) {
  const row = await findLinkByHash({ db: deps.db }, { tenantId, abhaHash: patientAbhaHash });
  if (!row || !row.patient_ref) throw new NoPatientBinding();
  return row.patient_ref;
}

export const connectedEmrSource = {
  id: "connected-emr",
  hiTypes: ["OPConsultation", "Prescription", "DiagnosticReport", "DischargeSummary"],

  /**
   * Discovery. `deps.tenant` is the already-authorised tenant row from the correlation, carrying
   * `connectorId` and `granted_scopes`.
   */
  async listCareContexts(env, deps, { tenantId, patientAbhaHash } = {}) {
    if (!patientAbhaHash || !deps || !deps.tenant) return [];
    let patientRef;
    try { patientRef = await patientRefFor(deps, { tenantId, patientAbhaHash }); }
    catch (e) {
      if (e instanceof NoPatientBinding) return [];   // we simply do not know this patient here
      throw e;
    }
    const bundleLike = await fetchFromEmr(env, deps, { tenant: deps.tenant, patientRef });
    const encounters = (bundleLike && bundleLike.encounters) || [];
    return encounters
      .map((enc) => {
        const types = hiTypesForEncounter(bundleLike, enc.id);
        if (!types.length) return null;                       // nothing servable; do not advertise
        return {
          referenceNumber: careContextRef({ kind: kindOf(enc), id: enc.id }),
          display: careContextDisplay({
            kind: kindOf(enc),
            date: (enc.period && (enc.period.start || enc.period.end)) || undefined,
            types,
          }),
          hiType: types[0],
        };
      })
      .filter(Boolean);
  },

  async loadRecord(env, deps, { tenantId, careContextRef: ref } = {}) {
    if (!deps || !deps.tenant) throw new EmrUnavailable("no tenant context");
    const parsed = parseCareContextRef(ref);
    if (!parsed) throw new Error("unparseable care context: " + ref);

    // The subject comes from OUR correlation, never from the callback body.
    const patientAbhaHash = deps.patientAbhaHash;
    if (!patientAbhaHash) throw new Error("no subject pseudonym for this request");
    const patientRef = await patientRefFor(deps, { tenantId, patientAbhaHash });

    const full = await fetchFromEmr(env, deps, { tenant: deps.tenant, patientRef });
    const encounter = (full.encounters || []).find((e) => e && e.id === parsed.id);
    // An encounter that has vanished from the EMR is the hospital's business, not a bug here - but it
    // must be reported, not silently served as empty.
    if (!encounter) throw new EmrUnavailable("encounter no longer present in the EMR: " + parsed.id);

    const record = sliceBundleToEncounter(full, parsed.id);
    record.recordType = HITYPE_TO_RECORD[hiTypesForEncounter(full, parsed.id)[0]] || "OPConsultRecord";
    const hiType = hiTypesForEncounter(full, parsed.id)[0] || "OPConsultation";
    return { record, patientAbhaHash, hiType, recordType: record.recordType };
  },
};
