// functions/_connect/canonical/model.js — SCCM v1 resources + bundle (spec §4.2/§4.3)
export const SCCM_VERSION = "1.0";
export const SCCM_MAJOR = 1;
export const RESOURCE_KEYS = ["encounters", "conditions", "medications", "allergies", "observations", "diagnosticReports", "documents"];

function requireId(o) { if (!o || !o.id || typeof o.id !== "string") throw new Error("resource requires a stable string id"); return o.id; }

export function patient(o = {}) { requireId(o); return { id: o.id, identifiers: o.identifiers || [], name: o.name || null, gender: o.gender || "unknown", birthDate: o.birthDate || null, deceased: o.deceased ?? null }; }
export function encounter(o = {}) { requireId(o); return { id: o.id, status: o.status || "unknown", class: o.class || null, period: o.period || null, reason: o.reason || null, practitioners: o.practitioners || [] }; }
export function condition(o = {}) { requireId(o); return { id: o.id, code: o.code || null, clinicalStatus: o.clinicalStatus || "unknown", category: o.category || null, onset: o.onset || null, recordedDate: o.recordedDate || null, encounter: o.encounter || null }; }
export function medicationStatement(o = {}) { requireId(o); return { id: o.id, medication: o.medication || null, origin: o.origin || "statement", status: o.status || "unknown", dosage: o.dosage || null, effectivePeriod: o.effectivePeriod || null, reason: o.reason || [] }; }
export function allergyIntolerance(o = {}) { requireId(o); return { id: o.id, code: o.code || null, clinicalStatus: o.clinicalStatus || "active", criticality: o.criticality || "unable-to-assess", reactions: o.reactions || [] }; }
export function observation(o = {}) { requireId(o); return { id: o.id, category: o.category || null, code: o.code || null, value: o.value ?? null, referenceRange: o.referenceRange || null, interpretation: o.interpretation || null, effectiveDateTime: o.effectiveDateTime || null, status: o.status || "unknown" }; }
export function diagnosticReport(o = {}) { requireId(o); return { id: o.id, code: o.code || null, category: o.category || null, status: o.status || "unknown", effectiveDateTime: o.effectiveDateTime || null, conclusion: o.conclusion || null, results: o.results || [] }; }
export function documentReference(o = {}) { requireId(o); return { id: o.id, type: o.type || null, category: o.category || null, status: o.status || "unknown", date: o.date || null, text: o.text || null, encounter: o.encounter || null }; }

export function bundle(o = {}) {
  return {
    sccmVersion: SCCM_VERSION, tenantId: o.tenantId || null, patient: o.patient || null,
    encounters: o.encounters || [], conditions: o.conditions || [], medications: o.medications || [],
    allergies: o.allergies || [], observations: o.observations || [], diagnosticReports: o.diagnosticReports || [],
    documents: o.documents || [],
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
