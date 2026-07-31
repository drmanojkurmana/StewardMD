// test/connect/abdm/fixtures/hip-followcare-synthetic.mjs
// HAND-AUTHORED SYNTHETIC FollowCare discharge/recovery EPISODES for the HIP read-projection tests.
// NEVER captured from a real patient / FollowCare tenant — there is NO real PHI here and, per ADR-2G,
// NO raw ABHA address either: a FollowCare episode is scoped ONLY by its HMAC `patientAbhaHash`
// pseudonym. `careContextRef` is an opaque FollowCare episode id (NOT an ABHA). The injected reader
// (`makeReader`/`makeLeakyReader`) is a mock in-memory store standing in for the real Firestore reader.

// Fake pseudonyms — clearly synthetic; NOT derivable from any real ABHA. (hex-shaped, decoy values)
export const PATIENT_A_HASH = "aaaa1111synthetic-abha-hmac-patient-A";
export const PATIENT_B_HASH = "bbbb2222synthetic-abha-hmac-patient-B";

// A synthetic discharge episode for patient A — the wired end-to-end source shape.
export const dischargeEpisodeA = {
  careContextRef: "fc-ep-A-001",              // opaque FollowCare episode id (NEVER an ABHA)
  patientAbhaHash: PATIENT_A_HASH,            // the ONLY patient key the source ever sees
  hiType: "DischargeSummary",
  display: "Discharge summary - Community-acquired pneumonia (2026-07-20)",
  dischargeDate: "2026-07-20",
  patient: { id: "fc-pat-A", gender: "female", birthDate: "1972-05-14", name: { text: "Synthetic Patient A" } },
  diagnoses: [
    { system: "http://hl7.org/fhir/sid/icd-10", code: "J18.9", display: "Community-acquired pneumonia", clinicalStatus: "resolved" },
    { text: "Acute kidney injury (resolving)" },                       // code-less -> text fallback
  ],
  medications: [
    { system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "18631", display: "Azithromycin", dosage: "500 mg once daily x3 days" },
    { text: "Paracetamol 500 mg as needed" },                          // free-text med -> text fallback
  ],
  observations: [
    { category: "vital-signs", system: "http://loinc.org", code: "8867-4", display: "Heart rate", value: 78, unit: "beats/min", effectiveDateTime: "2026-07-20T09:00:00Z" },
    { category: "laboratory", system: "http://loinc.org", code: "718-7", display: "Hemoglobin", value: 11.2, unit: "g/dL", effectiveDateTime: "2026-07-19T06:00:00Z" },
  ],
  summary: {
    title: "Discharge summary",
    text: "Admitted with community-acquired pneumonia; treated with azithromycin; renal function recovered; discharged stable. Follow up in 1 week.",
  },
};

// A synthetic episode belonging to a DIFFERENT patient (B) — used only to prove the source's
// ADR-2G subject guard: it must NEVER be emitted when patient A is requested.
export const dischargeEpisodeB = {
  careContextRef: "fc-ep-B-001",
  patientAbhaHash: PATIENT_B_HASH,
  hiType: "DischargeSummary",
  display: "Discharge summary - Uncomplicated appendicitis",
  dischargeDate: "2026-07-18",
  patient: { id: "fc-pat-B", gender: "male", birthDate: "1990-02-02", name: { text: "Synthetic Patient B" } },
  diagnoses: [{ system: "http://snomed.info/sct", code: "74400008", display: "Appendicitis", clinicalStatus: "resolved" }],
  medications: [{ text: "Ibuprofen 400 mg TID" }],
  observations: [],
  summary: { title: "Discharge summary", text: "Post-appendectomy; discharged well." },
};

// Realistic reader: a store that scopes listEpisodes by patientAbhaHash (as a real Firestore query would).
export function makeReader(episodes = []) {
  return {
    async listEpisodes(_env, { patientAbhaHash } = {}) {
      return episodes.filter((e) => e && e.patientAbhaHash === patientAbhaHash);
    },
    async getEpisode(_env, { careContextRef } = {}) {
      return episodes.find((e) => e && e.careContextRef === careContextRef) || null;
    },
  };
}

// Adversarial reader: OVER-returns (ignores patient scope) so the source's OWN subject guard is exercised.
export function makeLeakyReader(episodes = []) {
  return {
    async listEpisodes() { return episodes.slice(); },              // returns EVERY patient's episodes
    async getEpisode(_env, { careContextRef } = {}) {
      return episodes.find((e) => e && e.careContextRef === careContextRef) || null;
    },
  };
}
