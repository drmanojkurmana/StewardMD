// functions/_connect/canonical/model.js — SCCM v1 resources + bundle (spec §4.2/§4.3)
export const SCCM_VERSION = "1.0";
export const SCCM_MAJOR = 1;
export const RESOURCE_KEYS = ["encounters", "conditions", "medications", "allergies", "observations", "diagnosticReports", "documents", "imagingStudies"];

function requireId(o) { if (!o || !o.id || typeof o.id !== "string") throw new Error("resource requires a stable string id"); return o.id; }
// Attach an optional field only when the source actually carries a value (never invent/default a placeholder).
function putIf(obj, key, val) { if (val != null && val !== "") obj[key] = val; return obj; }

export function patient(o = {}) { requireId(o); return { id: o.id, identifiers: o.identifiers || [], name: o.name || null, gender: o.gender || "unknown", birthDate: o.birthDate || null, deceased: o.deceased ?? null }; }
export function encounter(o = {}) { requireId(o); return { id: o.id, status: o.status || "unknown", class: o.class || null, period: o.period || null, reason: o.reason || null, practitioners: o.practitioners || [] }; }
export function condition(o = {}) { requireId(o); return { id: o.id, code: o.code || null, clinicalStatus: o.clinicalStatus || "unknown", category: o.category || null, onset: o.onset || null, recordedDate: o.recordedDate || null, encounter: o.encounter || null }; }
export function medicationStatement(o = {}) { requireId(o); return { id: o.id, medication: o.medication || null, origin: o.origin || "statement", status: o.status || "unknown", dosage: o.dosage || null, effectivePeriod: o.effectivePeriod || null, reason: o.reason || [] }; }
export function allergyIntolerance(o = {}) { requireId(o); return { id: o.id, code: o.code || null, clinicalStatus: o.clinicalStatus || "active", criticality: o.criticality || "unable-to-assess", reactions: o.reactions || [] }; }
export function observation(o = {}) { requireId(o); return { id: o.id, category: o.category || null, code: o.code || null, value: o.value ?? null, referenceRange: o.referenceRange || null, interpretation: o.interpretation || null, effectiveDateTime: o.effectiveDateTime || null, status: o.status || "unknown" }; }
export function diagnosticReport(o = {}) { requireId(o); return { id: o.id, code: o.code || null, category: o.category || null, status: o.status || "unknown", effectiveDateTime: o.effectiveDateTime || null, conclusion: o.conclusion || null, results: o.results || [] }; }
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
