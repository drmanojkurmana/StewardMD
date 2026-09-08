// functions/_connect/canonical/model.js — SCCM v1 resources + bundle (spec §4.2/§4.3)
/* 1.1 (2026-09-08): ADDITIVE minor. Three optional collections - administrations, serviceRequests,
 * consents - and two optional references (diagnosticReport.basedOn, medicationAdministration.request).
 * A 1.0 consumer reads a 1.1 bundle unchanged; assertConsumable() checks the major only. */
export const SCCM_VERSION = "1.1";
export const SCCM_MAJOR = 1;
export const RESOURCE_KEYS = ["encounters", "conditions", "medications", "allergies", "observations", "diagnosticReports", "documents", "imagingStudies", "administrations", "serviceRequests", "consents"];

function requireId(o) { if (!o || !o.id || typeof o.id !== "string") throw new Error("resource requires a stable string id"); return o.id; }
// Attach an optional field only when the source actually carries a value (never invent/default a placeholder).
function putIf(obj, key, val) { if (val != null && val !== "") obj[key] = val; return obj; }

export function patient(o = {}) { requireId(o); return { id: o.id, identifiers: o.identifiers || [], name: o.name || null, gender: o.gender || "unknown", birthDate: o.birthDate || null, deceased: o.deceased ?? null }; }
export function encounter(o = {}) { requireId(o); return { id: o.id, status: o.status || "unknown", class: o.class || null, period: o.period || null, reason: o.reason || null, practitioners: o.practitioners || [] }; }
export function condition(o = {}) { requireId(o); return { id: o.id, code: o.code || null, clinicalStatus: o.clinicalStatus || "unknown", category: o.category || null, onset: o.onset || null, recordedDate: o.recordedDate || null, encounter: o.encounter || null }; }
export function medicationStatement(o = {}) { requireId(o); return { id: o.id, medication: o.medication || null, origin: o.origin || "statement", status: o.status || "unknown", dosage: o.dosage || null, effectivePeriod: o.effectivePeriod || null, reason: o.reason || [] }; }
export function allergyIntolerance(o = {}) { requireId(o); return { id: o.id, code: o.code || null, clinicalStatus: o.clinicalStatus || "active", criticality: o.criticality || "unable-to-assess", reactions: o.reactions || [] }; }
export function observation(o = {}) { requireId(o); return { id: o.id, category: o.category || null, code: o.code || null, value: o.value ?? null, referenceRange: o.referenceRange || null, interpretation: o.interpretation || null, effectiveDateTime: o.effectiveDateTime || null, status: o.status || "unknown" }; }
export function diagnosticReport(o = {}) { requireId(o); return putIf({ id: o.id, code: o.code || null, category: o.category || null, status: o.status || "unknown", effectiveDateTime: o.effectiveDateTime || null, conclusion: o.conclusion || null, results: o.results || [] }, "basedOn", o.basedOn); }
/* SCCM 1.1. A dose that was GIVEN (or explicitly not) somewhere else: what, to whom, when, by whom as the
 * source names them, and the order it answered when the source says so. Status is the source's FHIR
 * status verbatim; what WardSynQ may file is decided by the adapter, never here. */
export function medicationAdministration(o = {}) { requireId(o); return putIf(putIf({ id: o.id, medication: o.medication || null, status: o.status || "unknown", effectiveDateTime: o.effectiveDateTime || null, performer: o.performer || null, dosage: o.dosage || null, encounter: o.encounter || null }, "request", o.request), "reason", o.reason); }
/* SCCM 1.1. An order for something other than a medicine, as the source holds it. */
export function serviceRequest(o = {}) { requireId(o); return putIf({ id: o.id, code: o.code || null, category: o.category || null, status: o.status || "unknown", intent: o.intent || "order", priority: o.priority || null, authoredOn: o.authoredOn || null, requester: o.requester || null, encounter: o.encounter || null }, "occurrence", o.occurrence); }
/* SCCM 1.1. A consent decision as the source recorded it. `scope` and `category` are the source's
 * codings; `decision` is permit|deny|null derived from status and provision; nothing is inferred. */
export function consent(o = {}) { requireId(o); return { id: o.id, status: o.status || "unknown", scope: o.scope || null, category: o.category || [], decision: o.decision || null, dateTime: o.dateTime || null, performer: o.performer || null, period: o.period || null, policy: o.policy || null }; }
export function documentReference(o = {}) { requireId(o); return { id: o.id, type: o.type || null, category: o.category || null, status: o.status || "unknown", date: o.date || null, text: o.text || null, encounter: o.encounter || null }; }

// ImagingStudy — METADATA ONLY (groundwork for a future DICOMweb QIDO-RS connector, a separate increment).
// NO pixel data, NO WADO-RS binary retrieval, NO url field: only study-level facts (modality, body site, study
// date, accession number, description, series/instance counts, an opaque source study identifier). Every field
// but `id` is optional and OMITTED (never defaulted/invented) when the source doesn't carry it — mirrors the
// no-fabrication discipline documentReference() already applies by simply never having a binary field.
export function imagingStudy(o = {}) {
  requireId(o);
  const out = { id: o.id };
  putIf(out, "modality", o.modality);
  putIf(out, "bodySite", o.bodySite);
  putIf(out, "studyDate", o.studyDate);
  putIf(out, "accessionNumber", o.accessionNumber);
  putIf(out, "description", o.description);
  putIf(out, "seriesCount", o.seriesCount);
  putIf(out, "instanceCount", o.instanceCount);
  putIf(out, "sourceStudyId", o.sourceStudyId);
  return out;
}

export function bundle(o = {}) {
  return {
    sccmVersion: SCCM_VERSION, tenantId: o.tenantId || null, patient: o.patient || null,
    encounters: o.encounters || [], conditions: o.conditions || [], medications: o.medications || [],
    allergies: o.allergies || [], observations: o.observations || [], diagnosticReports: o.diagnosticReports || [],
    documents: o.documents || [], imagingStudies: o.imagingStudies || [],
    administrations: o.administrations || [], serviceRequests: o.serviceRequests || [], consents: o.consents || [],
    meta: { generatedAt: o.generatedAt || null, sourceConnector: o.sourceConnector || null, scope: o.scope || [], provenance: o.provenance || [], warnings: o.warnings || [] },
  };
}

export class SccmVersionError extends Error {
  constructor(message) { super(message); this.name = "SccmVersionError"; }
}
export function assertConsumable(b, consumerMajor) {
  const major = parseInt(String(b.sccmVersion).split(".")[0], 10);
  if (major !== consumerMajor) throw new SccmVersionError("SCCM major version " + major + " not consumable by " + consumerMajor);
}
