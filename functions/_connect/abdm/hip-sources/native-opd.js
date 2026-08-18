// functions/_connect/abdm/hip-sources/native-opd.js — the HIP source for clinics with NO external EMR.
//
// This is the "StewardMD EMR" half of the product: when a clinic has no EMR of its own, StewardMD OPD is
// authoritative for the encounter timeline (docs/queue/opd-platform-architecture.md §8). Those records
// live in Firestore `q_timeline/{ticketId}` with each entry encrypted under a SERVER-held key
// (`encPHI`/`decPHI`), so unlike the local-first Shared Clinic EMR they CAN be projected server-side.
//
// Same invariants as the FollowCare source (ADR-2G):
//   - PURE READ PROJECTION. It re-shapes existing entries and never diagnoses, prescribes or alters.
//   - The reader is INJECTED (`deps.opd`), so this file has no coupling to _queue_timeline.js and is
//     unit-testable. The reader HMACs the ABHA; this source only ever sees the pseudonym.
//   - Only records whose subject is the requested patient are emitted. Unknown patient -> [], not a throw.
//
// ── RETENTION CONFLICT (read before enabling this source) ───────────────────────────────────────────
// `q_timeline` docs carry a Firestore TTL: ~2 days while the visit is open, then `linkExpiresAt` after
// checkout - 7 days by default, 30 at most. ABDM care contexts are the opposite: once linked they can
// NEVER be unlinked (FAQ Q33), and a consent may stay valid for months, during which the patient can ask
// for the data at any time.
//
// So linking a native OPD visit to ABDM creates a record that will outlive the data behind it. When the
// TTL fires, the patient is left with a care context in their PHR that can never be fetched.
//
// This source does NOT silently paper over that. It exposes `retentionRisk()` so the linking path can
// refuse, and `loadRecord` throws a distinguishable `RecordExpired` rather than an anonymous failure.
// Actually fixing it needs an owner decision, because it is a data-retention policy change:
//   (a) extend `q_timeline` retention for ABDM-linked visits to cover the consent horizon, or
//   (b) snapshot the FHIR bundle at link time into an ABDM-retained store keyed by the consent's
//       dataEraseAt, or
//   (c) do not link native OPD visits at all, and offer ABDM only to connected-EMR tenants.

import { coding, codeable, provenance } from "../../canonical/coding.js";
import { bundle, patient, medicationStatement, observation, documentReference } from "../../canonical/model.js";
import { careContextRef, parseCareContextRef, careContextDisplay, hiTypesForVisit } from "../carecontext.js";

/** Thrown when the care context is still linked at ABDM but the underlying record has aged out. */
export class RecordExpired extends Error {
  constructor(ref) { super("native OPD record has passed its retention window: " + ref); this.name = "RecordExpired"; }
}

// A timeline entry kind maps to the HI type it contributes to.
const KIND_TO_HITYPE = {
  note: "OPConsultation", assessment: "OPConsultation", status: "OPConsultation", move: "OPConsultation",
  medication: "Prescription", vitals: "WellnessRecord", checkout: "OPConsultation",
};

const HITYPE_TO_RECORD = {
  OPConsultation: "OPConsultRecord", Prescription: "PrescriptionRecord",
  WellnessRecord: "WellnessRecord", DiagnosticReport: "DiagnosticReportRecord",
};

/** Which HI types a decrypted timeline actually supports. Only what is present. */
export function hiTypesForTimeline(tl) {
  const entries = (tl && Array.isArray(tl.entries) ? tl.entries : []);
  return hiTypesForVisit({
    notes: entries.some((e) => KIND_TO_HITYPE[e.kind] === "OPConsultation") || undefined,
    medications: entries.filter((e) => e.kind === "medication"),
    vitals: entries.some((e) => e.kind === "vitals") || undefined,
  });
}

/**
 * How much retention is left, in days, and whether it is safe to link.
 * `horizonDays` is how long ABDM might plausibly ask for this record - default 180, since a consent can
 * comfortably run that long and a linked context is permanent.
 */
export function retentionRisk(tl, { now = Date.now(), horizonDays = 180 } = {}) {
  const expiresAt = Number(tl && tl.expiresAt) || 0;
  const daysLeft = expiresAt ? Math.floor((expiresAt - now) / 86400000) : 0;
  return { expiresAt, daysLeft, safeToLink: daysLeft >= horizonDays, horizonDays };
}

/** Project a decrypted timeline into an SCCM record. PURE. */
export function projectTimeline(tl, { tenantId, now } = {}) {
  const generatedAt = typeof now === "function" ? now() : new Date().toISOString();
  const entries = (tl && Array.isArray(tl.entries) ? tl.entries : []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const ref = careContextRef({ kind: "opd", id: tl.ticketId });

  // The subject carries OUR ticket reference, never an ABHA and never the patient's name: the queue
  // holds only mrnLast4 in the clear and the name stays encrypted.
  const patientRes = patient({
    id: tl.ticketId,
    identifiers: [{ system: "https://stewardmd.in/opd/ticket", value: tl.ticketId }],
    name: null,
  });

  const medications = entries.filter((e) => e.kind === "medication").map((e, i) => medicationStatement({
    id: ref + "-med-" + i,
    medication: codeable({ text: e.text || "medication" }),
    origin: "order", status: "active",
    effectivePeriod: { start: iso(e.ts) },
  }));

  const observations = entries.filter((e) => e.kind === "vitals").map((e, i) => observation({
    id: ref + "-obs-" + i,
    category: "vital-signs",
    code: codeable({ coding: [coding({ system: "http://loinc.org", code: "85353-1", display: "Vital signs", kind: "standard" })], text: "Vital signs" }),
    value: e.text ? { text: String(e.text) } : null,
    effectiveDateTime: iso(e.ts),
    status: "final",
  }));

  // Consultation narrative: notes + assessments, in order, as an unstructured document. ABDM explicitly
  // permits starting with attachment-style bundles before structured coded data.
  const narrative = entries
    .filter((e) => KIND_TO_HITYPE[e.kind] === "OPConsultation" && e.text)
    .map((e) => new Date(e.ts).toISOString() + " - " + e.text)
    .join("\n");

  const documents = narrative ? [documentReference({
    id: ref + "-consult",
    type: codeable({ coding: [coding({ system: "http://snomed.info/sct", code: "371530004", display: "Clinical consultation report", kind: "standard" })], text: "Consultation" }),
    category: "OPConsultRecord", status: "current", date: generatedAt, text: narrative,
  })] : [];

  const record = bundle({
    tenantId, sourceConnector: "native-opd", generatedAt,
    patient: patientRes, conditions: [], medications, observations, documents,
    scope: ["Patient", "MedicationRequest", "Observation", "DocumentReference"],
    provenance: [provenance({ resource: "Composition", sourceConnector: "native-opd", sourceId: ref })],
    warnings: [],
  });
  record.recordType = "OPConsultRecord";
  return record;
}

const iso = (ms) => new Date(Number(ms) || 0).toISOString();

export const nativeOpdSource = {
  id: "native-opd",
  hiTypes: ["OPConsultation", "Prescription", "WellnessRecord"],

  /**
   * deps.opd.listVisits(env, { tenantId, patientAbhaHash }) -> [{ ticketId, patientAbhaHash, entries,
   *   expiresAt, closedAt, date }]  (entries already DECRYPTED by the reader)
   */
  async listCareContexts(env, deps, { tenantId, patientAbhaHash } = {}) {
    const reader = deps && deps.opd;
    if (!patientAbhaHash || !reader || typeof reader.listVisits !== "function") return [];
    const visits = (await reader.listVisits(env, { tenantId, patientAbhaHash })) || [];
    if (!Array.isArray(visits)) return [];
    return visits
      .filter((v) => v && v.patientAbhaHash === patientAbhaHash)   // subject guard, defence in depth
      .map((v) => {
        const types = hiTypesForTimeline(v);
        if (!types.length) return null;                            // nothing servable - do not advertise
        return {
          referenceNumber: careContextRef({ kind: "opd", id: v.ticketId }),
          display: careContextDisplay({ kind: "opd", date: v.date || v.closedAt || Date.now(), types }),
          hiType: types[0],
        };
      })
      .filter(Boolean);
  },

  async loadRecord(env, deps, { tenantId, careContextRef: ref } = {}) {
    const reader = deps && deps.opd;
    if (!reader || typeof reader.getVisit !== "function") throw new Error("native OPD reader not injected");
    const parsed = parseCareContextRef(ref);
    if (!parsed || parsed.kind !== "opd") throw new Error("not a native OPD care context: " + ref);

    const tl = await reader.getVisit(env, { tenantId, ticketId: parsed.id });
    // A linked context whose record has aged out is the documented retention conflict, not a generic
    // miss - name it so the caller can report something truthful to ABDM.
    if (!tl) throw new RecordExpired(ref);

    const types = hiTypesForTimeline(tl);
    const hiType = types[0] || "OPConsultation";
    return {
      record: projectTimeline(tl, { tenantId, now: deps.now }),
      patientAbhaHash: tl.patientAbhaHash || null,
      hiType,
      recordType: HITYPE_TO_RECORD[hiType] || "OPConsultRecord",
    };
  },
};
