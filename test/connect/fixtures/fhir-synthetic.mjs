// test/connect/fixtures/fhir-synthetic.mjs — HAND-AUTHORED synthetic FHIR R4 (no real PHI; never captured from a live/public FHIR test server)
export const SYNTHETIC = {
  patient: { resourceType: "Patient", id: "P1", gender: "female", birthDate: "1975-04-12",
    name: [{ text: "Synthetic Patient", family: "Patient", given: ["Synthetic"] }] },
  resources: [
    { resourceType: "Condition", id: "C1", code: { text: "Type 2 diabetes", coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "E11" }] }, clinicalStatus: { coding: [{ code: "active" }] } },
    { resourceType: "Observation", id: "O1", category: [{ coding: [{ code: "laboratory" }] }], code: { text: "Hemoglobin", coding: [{ system: "http://loinc.org", code: "718-7" }] }, valueQuantity: { value: 9.2, unit: "g/dL", code: "g/dL" } },
    { resourceType: "MedicationStatement", id: "M1", status: "active", medicationCodeableConcept: { text: "Metformin 500mg" } },
    { resourceType: "AllergyIntolerance", id: "A1", criticality: "high", code: { text: "Penicillin" } },
  ],
};
