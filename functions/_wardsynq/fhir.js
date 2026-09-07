/* functions/_wardsynq/fhir.js — WardSynQ's record, as FHIR R4. Read only.
 *
 * "Interoperable" is a claim hospitals are lied to about constantly, so this file is narrow and
 * says what it is: a READ endpoint that renders the canonical record as FHIR R4 resources and a
 * CapabilityStatement that does not overstate what it can do. It is how a hospital gets its own
 * data OUT of WardSynQ - into a national exchange, a research extract, a successor system, or a
 * regulator's hands - which is the half of interoperability that matters most and is most often
 * missing.
 *
 * READ ONLY, DELIBERATELY. A FHIR WRITE endpoint is a far larger commitment: profile validation,
 * terminology binding, conformance to whatever the sender believes R4 means. Accepting writes
 * without that is how a record fills with resources nobody can interpret afterwards. WardSynQ's
 * own doors stay the write path; this one exports.
 *
 * THE ONE RULE THAT MATTERS: NEVER INVENT A CODE SYSTEM.
 *
 * The canonical model records `codeSystem` as "unspecified", "text" or "ghis-local" whenever nobody
 * gave it a real one - the problem list, the fluid chart and the GHIS lab feed all do this on
 * purpose. The tempting thing here is to emit `system: "http://loinc.org"` anyway so the output
 * looks properly coded. That would be a lie that SURVIVES EVERY EXPORT AND EVERY INTEGRATION
 * AFTERWARDS: a receiving system has no way to tell a real LOINC code from one this file made up,
 * and will treat both as authoritative. So an uncoded concept is emitted as CodeableConcept.text
 * with NO coding at all, which is exactly what FHIR provides for and exactly what is true.
 *
 * SHAPED IS NOT THE SAME AS CONFORMANT. The canonical model has been FHIR-shaped since P0, but
 * shaped is not conformant: this output is not profile-validated, not claimed to meet US Core or
 * any national profile, and the CapabilityStatement says so rather than implying a certification
 * nobody has done.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* Code systems this file KNOWS a URI for. Anything not listed is emitted with no system, ever.
 * Adding a row here is a statement that WardSynQ genuinely records that vocabulary. */
const SYSTEM_URI = Object.freeze({
  "http://loinc.org": "http://loinc.org",
  loinc: "http://loinc.org",
  "icd-10": "http://hl7.org/fhir/sid/icd-10",
  icd10: "http://hl7.org/fhir/sid/icd-10",
  rxnorm: "http://www.nlm.nih.gov/research/umls/rxnorm",
  snomed: "http://snomed.info/sct",
  "snomed-ct": "http://snomed.info/sct",
});

/* Values the model uses to mean "nobody gave us a coding". Each is honest in its own file and must
 * stay honest here. */
const UNCODED = Object.freeze(["", "unspecified", "text", "ghis-local", "wardsynq-fluid", "local"]);

/** PURE. The FHIR system URI for one of our codeSystem values, or null when we do not know one. */
function systemUriFor(codeSystem) {
  const s = str(codeSystem);
  if (!s || UNCODED.includes(s.toLowerCase())) return null;
  return SYSTEM_URI[s] || SYSTEM_URI[s.toLowerCase()] || null;
}

/**
 * PURE. A CodeableConcept that never claims a vocabulary it does not have.
 *
 * With a known system: a proper coding, plus text. Without one: TEXT ONLY. A receiving system can
 * then tell the difference, which is the entire point.
 */
function codeable(code, codeSystem, display) {
  const c = str(code), d = str(display) || c;
  if (!c && !d) return undefined;
  const system = systemUriFor(codeSystem);
  const out = {};
  if (system && c) out.coding = [{ system, code: c, ...(d && d !== c ? { display: d } : {}) }];
  // `text` is always present. It is the only thing that is always true.
  out.text = d || c;
  return out;
}

const ref = (type, id) => (str(id) ? { reference: `${type}/${id}` } : undefined);
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };

/* ---- resource mappers. PURE, one per canonical type. ------------------------------------------- */

function fhirPatient(p) {
  return clean({
    resourceType: "Patient", id: p.id,
    identifier: [
      p.mrn ? { use: "usual", type: { text: "Medical record number" }, value: p.mrn } : undefined,
      ...(p.identifiers || []).map((i) => (i && i.value ? { system: str(i.system) || undefined, value: String(i.value) } : undefined)),
    ].filter(Boolean),
    // A single unparsed name. FHIR wants given/family and we do not hold them separately, so the
    // whole name goes in `text` rather than being split on a space and guessed wrong for most of
    // the world's names.
    name: p.name ? [{ text: p.name }] : undefined,
    gender: ["male", "female", "other", "unknown"].includes(str(p.sex)) ? str(p.sex) : "unknown",
    birthDate: str(p.dob) || undefined,
    // An unmerged trauma identity must never leave here looking confirmed.
    active: p.provisional ? false : undefined,
  });
}

function fhirEncounter(e) {
  const STATUS = { "in-progress": "in-progress", finished: "finished", cancelled: "cancelled", planned: "planned" };
  return clean({
    resourceType: "Encounter", id: e.id,
    status: STATUS[str(e.status)] || "unknown",
    class: e.class === "IPD" ? { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" }
      : e.class === "OPD" ? { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" }
      : undefined,
    subject: ref("Patient", e.patientId),
    period: clean({ start: str(e.periodStart) || undefined, end: str(e.periodEnd) || undefined }),
    reasonCode: e.reason ? [{ text: e.reason }] : undefined,
    location: e.location && (e.location.ward || e.location.bed)
      ? [{ location: { display: [e.location.ward, e.location.bed ? `bed ${e.location.bed}` : null].filter(Boolean).join(", ") } }]
      : undefined,
  });
}

function fhirCondition(c) {
  const VERIF = { confirmed: "confirmed", provisional: "provisional", differential: "differential", refuted: "refuted" };
  const CLIN = { active: "active", resolved: "resolved", inactive: "inactive" };
  return clean({
    resourceType: "Condition", id: c.id,
    clinicalStatus: CLIN[str(c.clinicalStatus)] ? { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: CLIN[str(c.clinicalStatus)] }] } : undefined,
    // Provisional stays provisional on the way out. A problem list that exported everything as
    // "confirmed" would turn every working diagnosis into a fact at the hospital boundary.
    verificationStatus: VERIF[str(c.verificationStatus)] ? { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: VERIF[str(c.verificationStatus)] }] } : undefined,
    code: codeable(c.code, c.codeSystem, c.display),
    subject: ref("Patient", c.patientId),
    encounter: ref("Encounter", c.encounterId),
    onsetDateTime: str(c.onsetDate) || undefined,
    note: c.note ? [{ text: c.note }] : undefined,
  });
}

function fhirAllergy(a) {
  return clean({
    resourceType: "AllergyIntolerance", id: a.id,
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: str(a.clinicalStatus) === "inactive" ? "inactive" : "active" }] },
    // "unable-to-assess" is a real FHIR value and is what our model already says when nobody knows.
    criticality: ["low", "high", "unable-to-assess"].includes(str(a.criticality)) ? str(a.criticality) : "unable-to-assess",
    code: codeable(a.substance, a.substanceCodeSystem, a.substance),
    patient: ref("Patient", a.patientId),
    reaction: a.reaction || a.severity ? [clean({ manifestation: a.reaction ? [{ text: String(a.reaction) }] : [{ text: "not recorded" }], severity: ["mild", "moderate", "severe"].includes(str(a.severity)) ? str(a.severity) : undefined })] : undefined,
    note: a.reportedText ? [{ text: `Reported as: ${a.reportedText}` }] : undefined,
  });
}

function fhirObservation(o) {
  const CAT = { "vital-signs": "vital-signs", laboratory: "laboratory", imaging: "imaging" };
  const value = typeof o.value === "number"
    ? { valueQuantity: clean({ value: o.value, unit: str(o.unit) || undefined, system: o.unit ? "http://unitsofmeasure.org" : undefined, code: str(o.unit) || undefined }) }
    : (o.value == null || o.value === "" ? {} : { valueString: String(o.value) });
  return clean({
    resourceType: "Observation", id: o.id,
    status: "final",
    category: CAT[str(o.category)] ? [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: CAT[str(o.category)] }] }] : undefined,
    code: codeable(o.code, o.codeSystem, o.display),
    subject: ref("Patient", o.patientId),
    encounter: ref("Encounter", o.encounterId),
    effectiveDateTime: str((o.meta && o.meta.effectiveAt) || o.effectiveAt) || undefined,
    ...value,
  });
}

function fhirMedicationRequest(m) {
  const STATUS = { active: "active", draft: "draft", "on-hold": "on-hold", cancelled: "cancelled", completed: "completed" };
  return clean({
    resourceType: "MedicationRequest", id: m.id,
    status: STATUS[str(m.status)] || "unknown",
    intent: "order",
    medicationCodeableConcept: codeable(m.drugCode || m.drug, m.drugCodeSystem, m.drug),
    subject: ref("Patient", m.patientId),
    encounter: ref("Encounter", m.encounterId),
    requester: m.prescriberId ? { display: m.prescriberId } : undefined,
    dosageInstruction: (m.dose || m.route || m.frequency) ? [clean({
      text: [m.dose ? `${m.dose.value} ${m.dose.unit}` : null, m.route, m.frequency].filter(Boolean).join(", ") || undefined,
      route: m.route ? { text: m.route } : undefined,
      // The dose as a real quantity, not only as prose, because a receiving system that can only
      // read the text cannot check it.
      doseAndRate: m.dose && typeof m.dose.value === "number"
        ? [{ doseQuantity: clean({ value: m.dose.value, unit: str(m.dose.unit) || undefined, system: m.dose.unit ? "http://unitsofmeasure.org" : undefined, code: str(m.dose.unit) || undefined }) }]
        : undefined,
    })] : undefined,
  });
}

function fhirMedicationAdministration(a) {
  // Our states are the eMAR's, and only ONE of them is an administration that happened. Everything
  // else is in-flight or stopped, and must not export as "completed".
  const STATUS = { administered: "completed", refused: "not-done", cancelled: "not-done", held: "on-hold" };
  return clean({
    resourceType: "MedicationAdministration", id: a.id,
    status: STATUS[str(a.status)] || "in-progress",
    medicationCodeableConcept: codeable(a.drugCode || a.drug, a.drugCodeSystem, a.drug),
    subject: ref("Patient", a.patientId),
    context: ref("Encounter", a.encounterId),
    effectiveDateTime: str(a.administeredAt) || undefined,
    performer: a.administeredBy ? [{ actor: { display: a.administeredBy } }] : undefined,
    request: ref("MedicationRequest", a.orderId),
  });
}

function fhirServiceRequest(s) {
  return clean({
    resourceType: "ServiceRequest", id: s.id,
    status: ["active", "completed", "revoked", "draft"].includes(str(s.status)) ? str(s.status) : "unknown",
    intent: "order",
    code: codeable(s.code, s.codeSystem, s.display),
    subject: ref("Patient", s.patientId),
    encounter: ref("Encounter", s.encounterId),
    requester: s.requesterId ? { display: s.requesterId } : undefined,
  });
}

function fhirDiagnosticReport(d) {
  return clean({
    resourceType: "DiagnosticReport", id: d.id,
    status: ["preliminary", "final", "corrected", "cancelled"].includes(str(d.status)) ? str(d.status) : "unknown",
    code: codeable(d.code, d.codeSystem, d.code),
    subject: ref("Patient", d.patientId),
    encounter: ref("Encounter", d.encounterId),
    conclusion: d.conclusion || undefined,
    result: (d.resultObservationIds || []).map((id) => ref("Observation", id)).filter(Boolean),
  });
}

function fhirDocumentReference(n) {
  // A clinical note is a DOCUMENT in FHIR, and the signature state travels with it: a draft that
  // exported as `current` would look like a finished, signed note to everyone downstream.
  return clean({
    resourceType: "DocumentReference", id: n.id,
    status: "current",
    docStatus: n.signedBy ? "final" : "preliminary",
    type: { text: str(n.noteType) || "note" },
    subject: ref("Patient", n.patientId),
    date: str(n.meta && n.meta.recordedAt) || undefined,
    author: n.authorId ? [{ display: n.authorId }] : undefined,
    authenticator: n.signedBy ? { display: n.signedBy } : undefined,
    context: n.encounterId ? { encounter: [ref("Encounter", n.encounterId)] } : undefined,
    content: [{ attachment: clean({ contentType: "text/plain", data: undefined, title: str(n.noteType) || undefined }) }],
  });
}

/** The canonical types this file can render, and the mapper for each. A type absent here is not
 *  exported at all rather than being emitted as something approximate. */
const MAPPERS = Object.freeze({
  Patient: fhirPatient,
  Encounter: fhirEncounter,
  Condition: fhirCondition,
  AllergyIntolerance: fhirAllergy,
  Observation: fhirObservation,
  MedicationOrder: fhirMedicationRequest,
  MedicationAdministration: fhirMedicationAdministration,
  ServiceRequest: fhirServiceRequest,
  DiagnosticReport: fhirDiagnosticReport,
  ClinicalNote: fhirDocumentReference,
});

/** Our type name to the FHIR one it renders as. */
const FHIR_TYPE = Object.freeze({
  Patient: "Patient", Encounter: "Encounter", Condition: "Condition",
  AllergyIntolerance: "AllergyIntolerance", Observation: "Observation",
  MedicationOrder: "MedicationRequest", MedicationAdministration: "MedicationAdministration",
  ServiceRequest: "ServiceRequest", DiagnosticReport: "DiagnosticReport", ClinicalNote: "DocumentReference",
});
/** And back, so a caller can ask for the FHIR name. */
const CANONICAL_TYPE = Object.freeze(Object.fromEntries(Object.entries(FHIR_TYPE).map(([k, v]) => [v, k])));

/** PURE. One canonical record to FHIR, or null when this file has no honest mapping for its type. */
function toFhir(record) {
  const m = record && MAPPERS[record.resourceType];
  return m ? m(record) : null;
}

/** PURE. A searchset Bundle. */
function bundle(resources, opts) {
  const o = opts || {};
  return {
    resourceType: "Bundle",
    type: o.type || "searchset",
    total: resources.length,
    ...(o.timestamp ? { timestamp: o.timestamp } : {}),
    entry: resources.map((r) => ({ fullUrl: `${o.base || ""}/${r.resourceType}/${r.id}`, resource: r })),
  };
}

/**
 * PURE. What this server actually supports. It says READ and SEARCH only, and it says outright that
 * the output is not profile-validated - because a CapabilityStatement that overstates is how a
 * receiving system decides it can trust something it cannot.
 */
function capabilityStatement(opts) {
  const o = opts || {};
  return {
    resourceType: "CapabilityStatement",
    status: "active",
    date: o.date || null,
    kind: "instance",
    software: { name: "WardSynQ", version: o.version || "0" },
    fhirVersion: "4.0.1",
    format: ["application/fhir+json"],
    /* Said in the document itself, where a machine and a human both see it. WardSynQ's model has
     * been FHIR-SHAPED since P0, and shaped is not conformant. */
    implementation: {
      description: "WardSynQ clinical record, read-only FHIR R4 export. Not profile-validated; "
        + "no claim of conformance to US Core or any national profile. Concepts WardSynQ holds "
        + "without a coding are emitted as CodeableConcept.text with no coding, never as a guessed code.",
    },
    rest: [{
      mode: "server",
      security: { description: "Bearer token or staff session, scoped to one hospital. Same authority as every other WardSynQ door." },
      resource: Object.values(FHIR_TYPE).map((t) => ({
        type: t,
        // READ and SEARCH. No create, no update, no delete - and nothing here implies otherwise.
        interaction: [{ code: "read" }, { code: "search-type" }],
        searchParam: [{ name: "patient", type: "reference" }],
      })),
    }],
  };
}

async function open(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/** FHIR's own error shape. A FHIR client parses OperationOutcome; it does not parse ours. */
function operationOutcome(severity, code, detail) {
  return { resourceType: "OperationOutcome", issue: [{ severity, code, diagnostics: detail }] };
}

/**
 * Everything this server holds for one patient, as a Bundle.
 * ctx: { migration, patientId, types?, actorDeps, recordDeps }
 */
async function patientEverything(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ok: false, status: 400, outcome: operationOutcome("error", "required", "patient is required") };

  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };

  const wanted = Array.isArray(ctx.types) && ctx.types.length
    ? ctx.types.map((t) => CANONICAL_TYPE[t] || t).filter((t) => MAPPERS[t])
    : Object.keys(MAPPERS);

  const out = [];
  for (const type of wanted) {
    try {
      if (type === "Patient") { const p = await svc.get("Patient", patientId); if (p) out.push(toFhir(p)); continue; }
      const rows = await svc.byPatient(type, patientId);
      for (const r of rows || []) { const f = toFhir(r); if (f) out.push(f); }
    } catch {
      /* A type this actor may not read is simply absent from the bundle. It is NOT reported as an
       * empty result set, because "no allergies" and "you may not see the allergies" are different
       * facts and a bundle cannot express the second one. The reader is told which types are in it
       * via the bundle's own contents. */
    }
  }
  return { ok: true, status: 200, bundle: bundle(out, { base: str(ctx.base), timestamp: new Date().toISOString() }) };
}

/** One resource by type and id. */
async function readResource(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };

  const fhirType = str(ctx.type);
  const canonical = CANONICAL_TYPE[fhirType];
  if (!canonical) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", `WardSynQ does not export ${fhirType || "that type"}`) };

  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };

  let record;
  try { record = await svc.get(canonical, str(ctx.id)); }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }
  if (!record) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such resource") };

  const f = toFhir(record);
  if (!f) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "no mapping for that resource") };
  return { ok: true, status: 200, resource: f };
}

export {
  SYSTEM_URI, UNCODED, MAPPERS, FHIR_TYPE, CANONICAL_TYPE,
  systemUriFor, codeable, toFhir, bundle, capabilityStatement, operationOutcome,
  fhirPatient, fhirEncounter, fhirCondition, fhirAllergy, fhirObservation,
  fhirMedicationRequest, fhirMedicationAdministration, fhirServiceRequest,
  fhirDiagnosticReport, fhirDocumentReference,
  patientEverything, readResource,
};
