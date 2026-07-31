// test/connect/abdm/fixtures/hip-flow-synthetic.mjs
// HAND-AUTHORED SYNTHETIC FollowCare discharge episodes for the Stage-5 Task-9 END-TO-END HIP-serve proof.
// NEVER captured from a real patient / FollowCare tenant — there is NO real PHI here and, per ADR-2G, NO raw
// ABHA either: an episode is scoped ONLY by its HMAC `patientAbhaHash` (the test computes the REAL per-tenant
// HMAC and passes it in, so the source/consent/carecontext layers all bind like-for-like). `careContextRef` is
// an opaque FollowCare episode id (NOT an ABHA). We RE-EXPORT the existing realistic `makeReader` (a mock
// in-memory Firestore stand-in) so the flow test imports its episode + reader helpers from one place (PONYTAIL).
export { makeReader, makeLeakyReader } from "./hip-followcare-synthetic.mjs";

// A decrypted-ONLY leak sentinel: it rides inside the sealed NDHM Bundle as the Patient.name, so it MUST be
// recoverable after the mock HIU decrypts a page, yet MUST NEVER appear in the pushed (ciphertext) body, in the
// audit trail, or at rest in D1. A distinctive dx string is a second such sentinel (Condition.code text).
export const PHI_MARKER = "PHI-HIP-FLOW-PATIENT-NAME-ZZZ";

// Build a synthetic discharge episode for a given patient hash, with a caller-chosen resource shape so the
// round-trip resource-count invariant is meaty (N conditions / N meds / N observations + the summary document).
export function episode(ref, patientAbhaHash, { dx = "Community-acquired pneumonia", patientId = "fc-pat-A", conditions = 1, meds = 1, observations = 1 } = {}) {
  return {
    careContextRef: ref,                          // opaque FollowCare episode id (NEVER an ABHA)
    patientAbhaHash,                              // the ONLY patient key the source ever sees (HMAC pseudonym)
    hiType: "DischargeSummary",
    display: "Discharge summary - " + dx + " (" + ref + ")",
    dischargeDate: "2026-07-20",
    patient: { id: patientId, gender: "female", birthDate: "1972-05-14", name: { text: PHI_MARKER } },
    diagnoses: Array.from({ length: conditions }, (_, i) => ({
      system: "http://hl7.org/fhir/sid/icd-10", code: "J18.9", display: dx + (i ? " (finding " + i + ")" : ""), clinicalStatus: "resolved",
    })),
    medications: Array.from({ length: meds }, (_, i) => ({ text: "Azithromycin 500 mg once daily" + (i ? " (line " + i + ")" : "") })),
    observations: Array.from({ length: observations }, (_, i) => ({
      category: "vital-signs", system: "http://loinc.org", code: "8867-4", display: "Heart rate", value: 78 + i, unit: "beats/min",
    })),
    summary: { title: "Discharge summary", text: dx + " treated and discharged stable. Follow up in 1 week." },
  };
}
