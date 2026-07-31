// test/connect/abdm/fixtures/ndhm-synthetic.mjs
// HAND-AUTHORED SYNTHETIC NDHM-FHIR document Bundles (NDHM/ABDM record profiles).
// NEVER captured from a real ABDM/HIP/live gateway — no real PHI. Every Composition is a
// Bundle.type=document whose sections reference the clinical resources in the same bundle.
// Base64 below is the literal string "SYNTHETIC_BINARY_BYTES" — a decoy so the binary-strip
// test can assert these bytes never reach SCCM.

export const B64_MARKER = "U1lOVEhFVElDX0JJTkFSWV9CWVRFUw=="; // base64("SYNTHETIC_BINARY_BYTES")

const PATIENT = {
  resourceType: "Patient", id: "pat-1", gender: "male", birthDate: "1980-01-01",
  name: [{ text: "Synthetic Patient", family: "Patient", given: ["Synthetic"] }],
};
const PROFILE = (name) => "https://nrces.in/ndhm/fhir/r4/StructureDefinition/" + name;

// Build a Bundle.type=document: Composition first, then Patient, then the rest.
function doc(composition, ...resources) {
  return {
    resourceType: "Bundle", type: "document",
    identifier: { system: "urn:synthetic:ndhm", value: "synthetic-doc" },
    timestamp: "2026-07-31T00:00:00Z",
    entry: [
      { fullUrl: "urn:uuid:" + composition.id, resource: composition },
      { fullUrl: "urn:uuid:" + PATIENT.id, resource: PATIENT },
      ...resources.map((r) => ({ fullUrl: "urn:uuid:" + r.id, resource: r })),
    ],
  };
}

// --- DiagnosticReportRecord: a DiagnosticReport whose result references an Observation ---
export const diagnosticReportRecord = doc(
  { resourceType: "Composition", id: "comp-dr", status: "final",
    meta: { profile: [PROFILE("DiagnosticReportRecord")] },
    type: { text: "Diagnostic Report", coding: [{ system: "http://snomed.info/sct", code: "721981007", display: "Diagnostic studies report" }] },
    subject: { reference: "Patient/pat-1" }, title: "Diagnostic Report", date: "2026-07-31T00:00:00Z",
    text: { status: "generated", div: "<div>Complete Blood Count; Hemoglobin 9.2 g/dL</div>" },
    section: [{ title: "Diagnostic Report", entry: [{ reference: "DiagnosticReport/dr-1" }] }] },
  { resourceType: "DiagnosticReport", id: "dr-1", status: "final",
    code: { text: "Complete Blood Count", coding: [{ system: "http://loinc.org", code: "58410-2" }] },
    result: [{ reference: "Observation/obs-hb" }], conclusion: "Mild anemia" },
  { resourceType: "Observation", id: "obs-hb", status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
    code: { text: "Hemoglobin", coding: [{ system: "http://loinc.org", code: "718-7" }] },
    valueQuantity: { value: 9.2, unit: "g/dL", code: "g/dL" }, effectiveDateTime: "2026-07-30T10:00:00Z" },
);

// --- PrescriptionRecord: a MedicationRequest (origin -> order) ---
export const prescriptionRecord = doc(
  { resourceType: "Composition", id: "comp-rx", status: "final",
    meta: { profile: [PROFILE("PrescriptionRecord")] },
    type: { text: "Prescription record", coding: [{ system: "http://snomed.info/sct", code: "440545006", display: "Prescription record" }] },
    subject: { reference: "Patient/pat-1" }, title: "Prescription",
    text: { status: "generated", div: "<div>Tab Amoxicillin 500mg TID x 5 days</div>" },
    section: [{ title: "Medications", entry: [{ reference: "MedicationRequest/mr-1" }] }] },
  { resourceType: "MedicationRequest", id: "mr-1", status: "active", intent: "order",
    medicationCodeableConcept: { text: "Amoxicillin 500mg", coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "308191" }] },
    dosageInstruction: [{ text: "1 tablet three times a day for 5 days" }] },
);

// --- OPConsultRecord: Condition + MedicationRequest + AllergyIntolerance ---
export const opConsultRecord = doc(
  { resourceType: "Composition", id: "comp-op", status: "final",
    meta: { profile: [PROFILE("OPConsultRecord")] },
    type: { text: "Clinical consultation report", coding: [{ system: "http://snomed.info/sct", code: "371530004", display: "Clinical consultation report" }] },
    subject: { reference: "Patient/pat-1" }, title: "OP Consultation",
    text: { status: "generated", div: "<div>Fever x 3 days; started amoxicillin; penicillin allergy noted</div>" },
    section: [
      { title: "Chief complaints", entry: [{ reference: "Condition/cond-1" }] },
      { title: "Medications", entry: [{ reference: "MedicationRequest/mr-2" }] },
      { title: "Allergies", entry: [{ reference: "AllergyIntolerance/alg-1" }] },
    ] },
  { resourceType: "Condition", id: "cond-1",
    code: { text: "Enteric fever", coding: [{ system: "http://snomed.info/sct", code: "4834000" }] },
    clinicalStatus: { coding: [{ code: "active" }] } },
  { resourceType: "MedicationRequest", id: "mr-2", status: "active",
    medicationCodeableConcept: { text: "Amoxicillin 500mg" } },
  { resourceType: "AllergyIntolerance", id: "alg-1", criticality: "high",
    code: { text: "Penicillin", coding: [{ system: "http://snomed.info/sct", code: "373270004" }] } },
);

// --- DischargeSummaryRecord: Condition + MedicationStatement (origin -> statement) + DiagnosticReport ---
export const dischargeSummaryRecord = doc(
  { resourceType: "Composition", id: "comp-ds", status: "final",
    meta: { profile: [PROFILE("DischargeSummaryRecord")] },
    type: { text: "Discharge summary", coding: [{ system: "http://snomed.info/sct", code: "373942005", display: "Discharge summary" }] },
    subject: { reference: "Patient/pat-1" }, title: "Discharge Summary",
    text: { status: "generated", div: "<div>Admitted with pneumonia; treated; discharged stable</div>" },
    section: [
      { title: "Diagnosis", entry: [{ reference: "Condition/cond-2" }] },
      { title: "Medications on discharge", entry: [{ reference: "MedicationStatement/ms-1" }] },
      { title: "Investigations", entry: [{ reference: "DiagnosticReport/dr-2" }] },
    ] },
  { resourceType: "Condition", id: "cond-2",
    code: { text: "Community-acquired pneumonia", coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "J18.9" }] },
    clinicalStatus: { coding: [{ code: "resolved" }] } },
  { resourceType: "MedicationStatement", id: "ms-1", status: "completed",
    medicationCodeableConcept: { text: "Azithromycin 500mg" }, dosage: [{ text: "Once daily for 3 days" }] },
  { resourceType: "DiagnosticReport", id: "dr-2", status: "final",
    code: { text: "Chest X-ray", coding: [{ system: "http://loinc.org", code: "36643-5" }] },
    conclusion: "Right lower lobe consolidation" },
);

// --- WellnessRecord: vital-signs -> "wellness", social-history -> "social-history" ---
export const wellnessRecord = doc(
  { resourceType: "Composition", id: "comp-well", status: "final",
    meta: { profile: [PROFILE("WellnessRecord")] },
    type: { text: "Wellness record", coding: [{ system: "http://snomed.info/sct", code: "163020007", display: "Wellness record" }] },
    subject: { reference: "Patient/pat-1" }, title: "Wellness Record",
    text: { status: "generated", div: "<div>Weight 72 kg; 8000 steps/day</div>" },
    section: [
      { title: "Vital Signs", entry: [{ reference: "Observation/obs-wt" }] },
      { title: "Physical Activity", entry: [{ reference: "Observation/obs-steps" }] },
    ] },
  { resourceType: "Observation", id: "obs-wt", status: "final",
    category: [{ coding: [{ code: "vital-signs" }] }],
    code: { text: "Body weight", coding: [{ system: "http://loinc.org", code: "29463-7" }] },
    valueQuantity: { value: 72, unit: "kg", code: "kg" } },
  { resourceType: "Observation", id: "obs-steps", status: "final",
    category: [{ coding: [{ code: "social-history" }] }],
    code: { text: "Steps per day", coding: [{ system: "http://loinc.org", code: "55423-8" }] },
    valueQuantity: { value: 8000, unit: "steps", code: "steps" } },
);

// --- ImmunizationRecord: SCCM has no immunization key (owner DEFER) -> metadata-only + warning ---
export const immunizationRecord = doc(
  { resourceType: "Composition", id: "comp-imm", status: "final",
    meta: { profile: [PROFILE("ImmunizationRecord")] },
    type: { text: "Immunization record", coding: [{ system: "http://snomed.info/sct", code: "41000179103", display: "Immunization record" }] },
    subject: { reference: "Patient/pat-1" }, title: "Immunization Record",
    text: { status: "generated", div: "<div>COVID-19 vaccine dose 1</div>" },
    section: [{ title: "Immunizations", entry: [{ reference: "Immunization/imm-1" }] }] },
  { resourceType: "Immunization", id: "imm-1", status: "completed",
    vaccineCode: { text: "COVID-19 vaccine" }, occurrenceDateTime: "2026-01-15" },
);

// --- HealthDocumentRecord with binary attachment (DocumentReference + Binary carry base64) ---
export const healthDocumentBinary = doc(
  { resourceType: "Composition", id: "comp-hd", status: "final",
    meta: { profile: [PROFILE("HealthDocumentRecord")] },
    type: { text: "Health document", coding: [{ system: "http://snomed.info/sct", code: "419891008", display: "Record artifact" }] },
    subject: { reference: "Patient/pat-1" }, title: "Scanned Health Document",
    text: { status: "generated", div: "<div>Scanned discharge summary (PDF)</div>" },
    section: [{ title: "Document", entry: [{ reference: "DocumentReference/docref-1" }, { reference: "Binary/bin-1" }] }] },
  { resourceType: "DocumentReference", id: "docref-1", status: "current",
    type: { text: "Discharge summary document" },
    content: [{ attachment: { contentType: "application/pdf", title: "discharge.pdf", data: B64_MARKER } }] },
  { resourceType: "Binary", id: "bin-1", contentType: "application/pdf", data: B64_MARKER },
);

// --- InvoiceRecord: billing artifact -> skipped + warning ---
export const invoiceRecord = doc(
  { resourceType: "Composition", id: "comp-inv", status: "final",
    meta: { profile: [PROFILE("InvoiceRecord")] },
    type: { text: "Invoice", coding: [{ system: "http://snomed.info/sct", code: "721912009", display: "Medical record" }] },
    subject: { reference: "Patient/pat-1" }, title: "Invoice",
    text: { status: "generated", div: "<div>Consultation charges INR 500</div>" },
    section: [{ title: "Invoice", entry: [{ reference: "Invoice/inv-1" }] }] },
  { resourceType: "Invoice", id: "inv-1", status: "issued", totalGross: { value: 500, currency: "INR" } },
);

// --- A section references a resource that is NOT present in the document ---
export const missingReferencedResource = doc(
  { resourceType: "Composition", id: "comp-miss", status: "final",
    meta: { profile: [PROFILE("OPConsultRecord")] },
    type: { text: "Clinical consultation report" },
    subject: { reference: "Patient/pat-1" }, title: "OP Consultation",
    text: { status: "generated", div: "<div>Consult</div>" },
    section: [
      { title: "Chief complaints", entry: [{ reference: "Condition/cond-1" }] },
      { title: "Medications", entry: [{ reference: "MedicationRequest/missing-med" }] }, // NOT in bundle
    ] },
  { resourceType: "Condition", id: "cond-1",
    code: { text: "Headache" }, clinicalStatus: { coding: [{ code: "active" }] } },
);

// --- A section references a resourceType we do not map (unknown clinical resource) ---
export const unknownResource = doc(
  { resourceType: "Composition", id: "comp-unk", status: "final",
    meta: { profile: [PROFILE("OPConsultRecord")] },
    type: { text: "Clinical consultation report" },
    subject: { reference: "Patient/pat-1" }, title: "OP Consultation",
    text: { status: "generated", div: "<div>Consult</div>" },
    section: [
      { title: "Chief complaints", entry: [{ reference: "Condition/cond-1" }] },
      { title: "Care Plan", entry: [{ reference: "CarePlan/cp-1" }] },
    ] },
  { resourceType: "Condition", id: "cond-1",
    code: { text: "Hypertension" }, clinicalStatus: { coding: [{ code: "active" }] } },
  { resourceType: "CarePlan", id: "cp-1", status: "active", title: "Lifestyle plan" },
);

// --- A Condition with NO code at all: cc() must still emit a text fallback ---
export const codelessCondition = doc(
  { resourceType: "Composition", id: "comp-cl", status: "final",
    meta: { profile: [PROFILE("OPConsultRecord")] },
    type: { text: "Clinical consultation report" },
    subject: { reference: "Patient/pat-1" }, title: "OP Consultation",
    text: { status: "generated", div: "<div>x</div>" },
    section: [{ title: "Chief complaints", entry: [{ reference: "Condition/cond-x" }] }] },
  { resourceType: "Condition", id: "cond-x", clinicalStatus: { coding: [{ code: "active" }] } }, // no code
);
