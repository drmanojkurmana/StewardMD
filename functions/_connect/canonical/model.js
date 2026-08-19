// functions/_connect/canonical/model.js — SCCM v1 resources + bundle (spec §4.2/§4.3)
export const SCCM_VERSION = "1.0";
export const SCCM_MAJOR = 1;
export const RESOURCE_KEYS = ["encounters", "conditions", "medications", "allergies", "observations", "diagnosticReports", "documents", "imagingStudies", "immunizations", "invoices"];

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

// ── Immunization (SCCM v1.1) ────────────────────────────────────────────────────────────────────────
// Added because ABDM makes all EIGHT HI types mandatory for an HMIS, and ImmunizationRecord is one of
// them. NRCES marks Composition.section AND section.entry min=1 on that profile, so a record with no
// immunisations is structurally INVALID rather than merely thin - which meant the HI type could not be
// served at all while SCCM had nowhere to put a vaccination.
//
// The FHIR minima this has to be able to satisfy: status, vaccineCode (with system+code+display),
// patient (supplied by the bundle) and occurrence[x]. Everything else is optional and OMITTED when the
// source does not carry it - and NRCES is strict about that: `site`, `route`, `performer.function` and
// `reasonCode` are each optional, but IF present their coding needs system+code+display. So a half-known
// site is worse than no site, and putIf is doing real work here.
export function immunization(o = {}) {
  requireId(o);
  const out = { id: o.id, vaccineCode: o.vaccineCode || null, status: o.status || "completed" };
  putIf(out, "occurrenceDateTime", o.occurrenceDateTime);
  putIf(out, "lotNumber", o.lotNumber);
  putIf(out, "expirationDate", o.expirationDate);
  putIf(out, "doseNumber", o.doseNumber);
  putIf(out, "site", o.site);                 // codeable; needs system+code+display if present at all
  putIf(out, "route", o.route);               // codeable; same
  putIf(out, "manufacturer", o.manufacturer); // free text (an Organization reference is not modelled)
  putIf(out, "encounter", o.encounter);
  return out;
}

// ── Invoice (SCCM v1.1) ─────────────────────────────────────────────────────────────────────────────
// The other mandatory-but-unmodelled HI type. The normalizer used to skip Invoice as "billing artifact,
// not clinical data", which is true and beside the point: ABDM requires it of an HMIS, and a patient
// asking for their records is entitled to what they were charged.
//
// NRCES minima: identifier.value, status, type (system+code+display), subject (from the bundle), date,
// lineItem[].chargeItem[x], lineItem[].priceComponent[].{type, code(system+code+display), amount},
// totalNet and totalGross. `type` codes come from ndhm-billing-codes (00 Consultation, 01 Pharmacy,
// 02 IPD, 03 OPD, 99 Others); priceComponent.code from ndhm-price-components (00 MRP, 01 Rate,
// 02 Discount, 03 CGST, 04 SGST); priceComponent.type from the R4 required set
// (base|surcharge|deduction|discount|tax|informational).
//
// Money is { value, currency } and currency is NOT defaulted: an amount without a currency is a number,
// not a price, and guessing INR for a bill we did not issue would be inventing data.
export function money(o = {}) {
  const out = {};
  putIf(out, "value", o.value);
  putIf(out, "currency", o.currency);
  return out;
}
export function invoicePriceComponent(o = {}) {
  const out = { type: o.type || "base" };
  putIf(out, "code", o.code);                 // codeable
  putIf(out, "amount", o.amount ? money(o.amount) : null);
  putIf(out, "factor", o.factor);
  return out;
}
export function invoiceLineItem(o = {}) {
  const out = {};
  putIf(out, "sequence", o.sequence);
  putIf(out, "chargeItem", o.chargeItem);     // codeable: what was charged for
  out.priceComponents = (o.priceComponents || []).map(invoicePriceComponent);
  return out;
}
export function invoice(o = {}) {
  requireId(o);
  const out = { id: o.id, status: o.status || "issued", type: o.type || null };
  putIf(out, "identifierValue", o.identifierValue);
  putIf(out, "date", o.date);
  out.lineItems = (o.lineItems || []).map(invoiceLineItem);
  putIf(out, "totalNet", o.totalNet ? money(o.totalNet) : null);
  putIf(out, "totalGross", o.totalGross ? money(o.totalGross) : null);
  putIf(out, "encounter", o.encounter);
  return out;
}

export function bundle(o = {}) {
  return {
    sccmVersion: SCCM_VERSION, tenantId: o.tenantId || null, patient: o.patient || null,
    encounters: o.encounters || [], conditions: o.conditions || [], medications: o.medications || [],
    allergies: o.allergies || [], observations: o.observations || [], diagnosticReports: o.diagnosticReports || [],
    documents: o.documents || [], imagingStudies: o.imagingStudies || [],
    immunizations: o.immunizations || [], invoices: o.invoices || [],
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
