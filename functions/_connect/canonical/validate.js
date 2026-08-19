// functions/_connect/canonical/validate.js — SCCM validator + reference resolution (spec §4.3, C5)
import { RESOURCE_KEYS, SCCM_VERSION } from "./model.js";

const REF_TARGET_KEY = { Encounter: "encounters", Condition: "conditions", Observation: "observations", DiagnosticReport: "diagnosticReports", DocumentReference: "documents" };

// ImagingStudy is metadata-only (spec groundwork for a future DICOMweb QIDO-RS connector): a plain string/number
// field allowlist, no codeable-concept, no intra-bundle reference. Any binary/url-shaped field is a hard error —
// this mirrors the codebase's no-binary discipline (documentReference already carries no attachment bytes).
const IMAGING_STRING_FIELDS = ["modality", "bodySite", "studyDate", "accessionNumber", "description", "sourceStudyId"];
const IMAGING_NUMBER_FIELDS = ["seriesCount", "instanceCount"];
const IMAGING_FORBIDDEN_FIELDS = ["url", "wadoUri", "wadoUrl", "wadoRsRoot", "retrieveUrl", "pixelData", "binary", "attachment", "content", "contentUrl", "data"];
function validateImagingStudy(img, errors) {
  if (!img || typeof img !== "object" || typeof img.id !== "string" || !img.id) { errors.push("ImagingStudy missing/invalid id"); return; }
  for (const k of IMAGING_STRING_FIELDS) { if (img[k] != null && typeof img[k] !== "string") errors.push("ImagingStudy " + img.id + "." + k + " must be a string"); }
  for (const k of IMAGING_NUMBER_FIELDS) { if (img[k] != null && typeof img[k] !== "number") errors.push("ImagingStudy " + img.id + "." + k + " must be a number"); }
  for (const f of IMAGING_FORBIDDEN_FIELDS) { if (Object.prototype.hasOwnProperty.call(img, f)) errors.push("ImagingStudy " + img.id + " carries forbidden field '" + f + "' (metadata-only: no binary/url)"); }
}

// Immunization + Invoice (SCCM v1.1). The FHIR minima are enforced HERE rather than left to the
// serializer, because a bundle that cannot produce a valid ImmunizationRecord should be rejected at
// ingest, not discovered at push time when a patient is waiting.
const IMMUNIZATION_STATUS = new Set(["completed", "entered-in-error", "not-done"]);
const INVOICE_STATUS = new Set(["draft", "issued", "balanced", "cancelled", "entered-in-error"]);
const PRICE_COMPONENT_TYPE = new Set(["base", "surcharge", "deduction", "discount", "tax", "informational"]);

function validateImmunization(im, errors, checkCoded) {
  if (!im || typeof im !== "object" || typeof im.id !== "string" || !im.id) { errors.push("Immunization missing/invalid id"); return; }
  const w = "Immunization " + im.id;
  if (!IMMUNIZATION_STATUS.has(im.status)) errors.push(w + ".status must be completed|entered-in-error|not-done");
  if (!im.vaccineCode) errors.push(w + ".vaccineCode is required");
  else checkCoded(im.vaccineCode, w + ".vaccineCode");
  // occurrence[x] is min=1 in FHIR, so a vaccination with no date cannot be serialised.
  if (!im.occurrenceDateTime) errors.push(w + ".occurrenceDateTime is required");
  // site/route are optional, but a coding that is present must be complete - a half-known site is worse
  // than none, because NRCES makes system+code+display all min=1 once the element exists.
  for (const f of ["site", "route"]) if (im[f]) checkCoded(im[f], w + "." + f);
}

function validateInvoice(inv, errors, checkCoded) {
  if (!inv || typeof inv !== "object" || typeof inv.id !== "string" || !inv.id) { errors.push("Invoice missing/invalid id"); return; }
  const w = "Invoice " + inv.id;
  if (!INVOICE_STATUS.has(inv.status)) errors.push(w + ".status must be draft|issued|balanced|cancelled|entered-in-error");
  if (!inv.identifierValue) errors.push(w + ".identifierValue is required");
  if (!inv.date) errors.push(w + ".date is required");
  if (!inv.type) errors.push(w + ".type is required"); else checkCoded(inv.type, w + ".type");
  const money = (m, where) => {
    if (!m || m.value == null) { errors.push(where + " requires a value"); return; }
    if (typeof m.value !== "number" || !Number.isFinite(m.value)) errors.push(where + ".value must be a finite number");
    // An amount without a currency is a number, not a price. Never defaulted.
    if (!m.currency) errors.push(where + " requires a currency");
  };
  money(inv.totalNet, w + ".totalNet");
  money(inv.totalGross, w + ".totalGross");
  const items = inv.lineItems || [];
  if (!items.length) errors.push(w + ".lineItems must have at least one entry");
  items.forEach((li, i) => {
    const lw = w + ".lineItems[" + i + "]";
    if (!li.chargeItem) errors.push(lw + ".chargeItem is required"); else checkCoded(li.chargeItem, lw + ".chargeItem");
    const pcs = li.priceComponents || [];
    if (!pcs.length) errors.push(lw + ".priceComponents must have at least one entry");
    pcs.forEach((pc, j) => {
      const pw = lw + ".priceComponents[" + j + "]";
      if (!PRICE_COMPONENT_TYPE.has(pc.type)) errors.push(pw + ".type must be one of " + [...PRICE_COMPONENT_TYPE].join("|"));
      if (!pc.code) errors.push(pw + ".code is required"); else checkCoded(pc.code, pw + ".code");
      money(pc.amount, pw + ".amount");
    });
  });
}

export function validateBundle(b) {
  const errors = [], warnings = [];
  if (!b || typeof b !== "object") return { ok: false, errors: ["bundle missing"], warnings };
  if (!b.patient || !b.patient.id) errors.push("bundle.patient is required");
  if (b.sccmVersion !== SCCM_VERSION) errors.push("unexpected sccmVersion " + b.sccmVersion);

  // Build the id index per resource type for reference resolution.
  const index = {};
  for (const key of RESOURCE_KEYS) { index[key] = new Set((b[key] || []).map((r) => r && r.id)); }

  // Coded fields must carry a text fallback; intra-bundle references must resolve-or-null.
  const checkCoded = (cc, where) => { if (cc && (!cc.text || !String(cc.text).trim())) errors.push(where + " coded field missing text fallback"); };
  const resolveRef = (obj, field, where) => {
    const ref = obj[field]; if (!ref) return;
    const key = REF_TARGET_KEY[ref.type];
    if (!key || !index[key] || !index[key].has(ref.id)) { obj[field] = null; warnings.push(where + " reference " + ref.type + "/" + ref.id + " did not resolve; nulled"); }
  };

  (b.conditions || []).forEach((c) => { checkCoded(c.code, "Condition"); resolveRef(c, "encounter", "Condition"); });
  (b.medications || []).forEach((m) => checkCoded(m.medication, "MedicationStatement"));
  (b.allergies || []).forEach((a) => checkCoded(a.code, "AllergyIntolerance"));
  (b.observations || []).forEach((o) => { checkCoded(o.code, "Observation"); if (!o.category) errors.push("Observation " + o.id + " missing category"); });
  (b.diagnosticReports || []).forEach((d) => { checkCoded(d.code, "DiagnosticReport"); (d.results || []).forEach((_, i) => resolveRef(d.results, i, "DiagnosticReport.results")); });
  (b.documents || []).forEach((d) => { checkCoded(d.type, "DocumentReference"); resolveRef(d, "encounter", "DocumentReference"); });
  (b.imagingStudies || []).forEach((im) => validateImagingStudy(im, errors));
  (b.immunizations || []).forEach((im) => validateImmunization(im, errors, checkCoded));
  (b.invoices || []).forEach((inv) => validateInvoice(inv, errors, checkCoded));

  return { ok: errors.length === 0, errors, warnings };
}
