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

  return { ok: errors.length === 0, errors, warnings };
}
