// test/connect/abdm/fixtures/sccm-records.mjs
// HAND-AUTHORED SYNTHETIC SCCM records (canonical model) fed to serializeNdhm (SCCM -> NDHM HIP serve).
// NEVER real PHI. Built with the canonical factories so they are guaranteed-valid SCCM inputs, and shaped so
// serializeNdhm(...) round-trips back through normalizeNdhm to the SAME resource counts.
import { bundle, patient, condition, medicationStatement, allergyIntolerance, observation, diagnosticReport, documentReference } from "../../../../functions/_connect/canonical/model.js";
import { coding, codeable, quantity, reference } from "../../../../functions/_connect/canonical/coding.js";

const std = (system, code, display) => coding({ system, code, display, kind: "standard" });

// A StewardMD discharge-summary decision-support record: 1 condition, 2 meds (order+statement), 1 allergy,
// 2 observations (one is a DiagnosticReport result), 1 diagnostic report, 1 document (= the summary itself).
export const dischargeRecord = bundle({
  tenantId: "gimsr", sourceConnector: "stewardmd", generatedAt: "2026-07-31T00:00:00.000Z",
  patient: patient({ id: "pat-1", gender: "male", birthDate: "1980-01-01", name: { text: "Synthetic Patient", family: "Patient", given: ["Synthetic"] } }),
  conditions: [
    condition({ id: "cond-1", clinicalStatus: "resolved", code: codeable({ coding: [std("http://hl7.org/fhir/sid/icd-10", "J18.9", "Pneumonia")], text: "Community-acquired pneumonia" }) }),
  ],
  medications: [
    medicationStatement({ id: "med-1", origin: "order", status: "active", medication: codeable({ coding: [std("http://www.nlm.nih.gov/research/umls/rxnorm", "308191")], text: "Amoxicillin 500mg" }), dosage: { text: "1 tablet three times a day for 5 days" } }),
    medicationStatement({ id: "med-2", origin: "statement", status: "completed", medication: codeable({ text: "Azithromycin 500mg" }), dosage: { text: "Once daily for 3 days" } }),
  ],
  allergies: [
    allergyIntolerance({ id: "alg-1", criticality: "high", code: codeable({ coding: [std("http://snomed.info/sct", "373270004")], text: "Penicillin" }) }),
  ],
  observations: [
    observation({ id: "obs-hb", category: "laboratory", status: "final", effectiveDateTime: "2026-07-30T10:00:00Z", code: codeable({ coding: [std("http://loinc.org", "718-7")], text: "Hemoglobin" }), value: quantity({ value: 9.2, unit: "g/dL", code: "g/dL" }) }),
    observation({ id: "obs-note", category: "laboratory", status: "final", code: codeable({ text: "Blood culture result" }), value: { text: "No growth after 48h" } }),
  ],
  diagnosticReports: [
    diagnosticReport({ id: "dr-1", status: "final", conclusion: "Mild anemia", code: codeable({ coding: [std("http://loinc.org", "58410-2")], text: "Complete Blood Count" }), results: [reference("Observation", "obs-hb")] }),
  ],
  documents: [
    documentReference({ id: "comp-ds", status: "final", text: "Admitted with pneumonia; treated with antibiotics; discharged stable", type: codeable({ coding: [std("http://snomed.info/sct", "373942005", "Discharge summary")], text: "Discharge summary" }) }),
  ],
});

// A record carrying a StewardMD-local (proprietary, non-standard system) code: the local coding + its text must
// survive serialization (and re-derive to kind:"local" through normalizeNdhm).
export const localOnlyRecord = bundle({
  tenantId: "gimsr", sourceConnector: "stewardmd",
  patient: patient({ id: "pat-9", gender: "female" }),
  conditions: [
    condition({ id: "cond-loc", clinicalStatus: "active", code: codeable({ coding: [coding({ system: "urn:hospital:dx", code: "LX1", display: "House code", kind: "local" })], text: "Local hospital diagnosis label" }) }),
  ],
  documents: [
    documentReference({ id: "comp-loc", status: "final", text: "local consultation note", type: codeable({ text: "Consultation note" }) }),
  ],
});
