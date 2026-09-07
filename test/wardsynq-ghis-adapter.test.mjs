/* test/wardsynq-ghis-adapter.test.mjs — GHIS (Ward Sync) to canonical model.
 *
 * The first Integration Hub adapter, so these tests double as the contract every later adapter
 * (HL7 v2, FHIR R4, DICOMweb, LIS, ABDM, IoMT) has to meet: stable ids so a replay does not
 * duplicate, nothing silently dropped, the raw source preserved, and no invented clinical values.
 *
 * The three tests that matter most are the ones pinning the traps in the source data: GHIS `dob`
 * is an age, lab units are not normalised, and a partially broken bundle still yields its good
 * rows.
 *
 * node --test test/wardsynq-ghis-adapter.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mapGhisBundle, ingestGhisBundle, parseGhisDate, mapSex, sourceId, UNKNOWN_DOB, SYSTEM,
} from "../wardsynq/adapters/wardsynq-ghis-adapter.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";

/* ------------------------------------------------------------------ fixtures */

/** Shaped from the live ghis-ward.js / icu.js survey, including its quirks. */
const bundle = (over) => ({
  patientId: "12345",
  episodeId: "EP987",
  source: "Ward Sync",
  ts: Date.UTC(2026, 8, 3, 9, 0),
  patient: {
    name: "RAMU DEVI", sex: "F", bed: "12A", mrn: "12345",
    doctor: "Dr. Suresh", dept: "GIMSR MICU", age: "45",
  },
  labs: [
    { test: "Sodium", result: "138", units: "mEq/L", low: "135", high: "145", date: "03-JUL-2026 08:30" },
    { test: "Potassium", result: "6.4", units: "mEq/L", low: "3.5", high: "5.1", critical: true, date: "03-JUL-2026 08:30" },
  ],
  imaging: [
    { reportId: "R1", studyName: "CT Brain Plain", date: "03-JUL-2026", report: "No acute infarct.", reported: true, doctor: "Dr. Rao" },
  ],
  ...over,
});

/* ------------------------------------------------------------------ the three traps */

test("trap: GHIS `dob` is an AGE and must never become a date of birth", () => {
  // The live payload sends dob:"45" meaning 45 years old. Parsed as a date that is the year 45.
  const { patient } = mapGhisBundle(bundle({ patient: { name: "X", sex: "M" }, dob: "45" }));
  assert.equal(patient.ageYears, 45, "the age is captured as an age");
  assert.equal(patient.dob, UNKNOWN_DOB, "and a birth date is NOT invented from it");
  assert.equal(patient.dobIsUnknown, true);
  assert.equal(Number.isNaN(Date.parse(patient.dob)), true,
    "the sentinel must not parse as a real date, or downstream age maths would produce a confident wrong answer");
});

test("trap: an unparseable age is reported rather than silently becoming null", () => {
  const { patient, issues } = mapGhisBundle(bundle({ patient: { name: "X", sex: "M", age: "not-a-number" } }));
  assert.equal(patient.ageYears, null);
  assert.equal(issues.some((i) => i.code === "GHIS_AGE_UNPARSEABLE"), true);
});

test("trap: lab values are stored exactly as reported and flagged un-normalised", () => {
  const { observations } = mapGhisBundle(bundle());
  const k = observations.find((o) => o.sourceTestName === "Potassium");
  assert.equal(k.value, 6.4, "the numeric value is as reported");
  assert.equal(k.unit, "mEq/L", "the unit is as reported");
  assert.equal(k.unitNormalised, false,
    "icu.js wardToSI is not a unit normaliser despite its name; re-deriving one unreviewed could silently alter an electrolyte");
  assert.equal(k.sourceValue, "6.4", "the raw string survives, so a mapping error is recoverable without a re-fetch");
});

/* ------------------------------------------------------------------ identity */

test("identity: patientId is the MRN, and the episode is a visit not a patient", () => {
  const { patient, encounter } = mapGhisBundle(bundle());
  assert.equal(patient.mrn, "12345", "GHIS has no separate UHID; patientId IS the MRN");
  assert.deepEqual(patient.identifiers, [{ system: "ghis-patient-id", value: "12345" }]);
  assert.equal(encounter.patientId, patient.id);
  assert.notEqual(encounter.id, patient.id, "an episode identifies a visit, never the person");
  assert.deepEqual(encounter.identifiers, [{ system: "ghis-episode-id", value: "EP987" }],
    "the source visit id must survive as a readable identifier, not only baked into a generated id string");
});

test("identity: a bundle with no patientId yields nothing rather than a nameless record", () => {
  const { patient, observations, issues } = mapGhisBundle({ labs: [{ test: "Sodium", result: "138" }] });
  assert.equal(patient, null);
  assert.equal(observations.length, 0, "labs must never be attached to an unidentified patient");
  assert.equal(issues[0].code, "GHIS_NO_PATIENT_ID");
});

test("identity: sex is mapped conservatively and unknown stays unknown", () => {
  assert.equal(mapSex("M"), "male");
  assert.equal(mapSex("female"), "female");
  assert.equal(mapSex(""), "unknown");
  assert.equal(mapSex("?"), "unknown");
});

/* ------------------------------------------------------------------ stable ids */

test("ids: the same source record always maps to the same id, so a replay does not duplicate", () => {
  const a = mapGhisBundle(bundle());
  const b = mapGhisBundle(bundle());
  assert.equal(a.patient.id, b.patient.id);
  assert.equal(a.encounter.id, b.encounter.id);
  assert.deepEqual(a.observations.map((o) => o.id), b.observations.map((o) => o.id));
  assert.match(a.patient.id, /^ghis-pat-/);
});

test("ids: different patients and different draws never collide", () => {
  const p1 = mapGhisBundle(bundle());
  const p2 = mapGhisBundle(bundle({ patientId: "99999" }));
  assert.notEqual(p1.patient.id, p2.patient.id);
  assert.notEqual(p1.observations[0].id, p2.observations[0].id, "same test, different patient, must not share an id");

  const later = mapGhisBundle(bundle({ labs: [{ test: "Sodium", result: "140", units: "mEq/L", date: "04-JUL-2026 08:30" }] }));
  assert.notEqual(p1.observations[0].id, later.observations[0].id, "the same test on a different day is a different observation");
});

/* ------------------------------------------------------------------ dates */

test("dates: the GHIS DD-MON-YYYY form parses, including its 08:00 default", () => {
  assert.equal(parseGhisDate("03-JUL-2026 08:30"), "2026-07-03T08:30:00.000Z");
  assert.equal(parseGhisDate("03-JUL-2026"), "2026-07-03T08:00:00.000Z",
    "a draw with no time defaults to 08:00 as icu.js does, so it cannot slip to the previous day in another timezone");
  assert.equal(parseGhisDate("2026-07-03T08:30:00.000Z"), "2026-07-03T08:30:00.000Z", "ISO still works");
});

test("dates: an unrecognised date is null and reported, never guessed", () => {
  assert.equal(parseGhisDate("last tuesday"), null);
  assert.equal(parseGhisDate(""), null);
  const { issues } = mapGhisBundle(bundle({ labs: [{ test: "Sodium", result: "138", date: "last tuesday" }] }));
  assert.equal(issues.some((i) => i.code === "GHIS_LAB_DATE_UNPARSEABLE"), true);
});

/* ------------------------------------------------------------------ labs and imaging */

test("labs: reference range, criticality and provenance are carried across", () => {
  const { observations } = mapGhisBundle(bundle());
  const k = observations.find((o) => o.sourceTestName === "Potassium");
  assert.deepEqual(k.referenceRange, { low: 3.5, high: 5.1, text: null });
  assert.equal(k.sourceCritical, true, "GHIS's own critical flag is carried");
  assert.equal(k.meta.source.system, SYSTEM, "every ingested record says where it came from");
  assert.equal(k.category, "laboratory");
  assert.equal(k.code, "2823-3", "a recognised test gets a canonical code");
  assert.equal(k.codeSystem, "LOINC");
});

test("labs: a source critical flag does not by itself gate anything", () => {
  const { observations } = mapGhisBundle(bundle());
  const k = observations.find((o) => o.sourceCritical);
  assert.equal(k.sourceCritical, true);
  assert.equal("critical" in k, false,
    "criticality as a clinical control belongs to the safety engine, not to whatever a source system asserts");
});

test("labs: the 2026-09-06 LOINC coverage widening resolves every newly added concept, and both deliberately-excluded ones stay ghis-local", () => {
  const b = bundle({
    labs: [
      { test: "Calcium", result: "9.2", units: "mg/dL" },
      { test: "Ionised Calcium", result: "1.15", units: "mmol/L" },
      { test: "Magnesium", result: "2.1", units: "mg/dL" },
      { test: "Phosphate", result: "3.4", units: "mg/dL" },
      { test: "Phosphorus", result: "3.4", units: "mg/dL" },
      { test: "Direct Bilirubin", result: "0.3", units: "mg/dL" },
      { test: "Alkaline Phosphatase", result: "88", units: "U/L" },
      { test: "Amylase", result: "60", units: "U/L" },
      { test: "Lipase", result: "40", units: "U/L" },
      { test: "Procalcitonin", result: "0.1", units: "ng/mL" },
      { test: "Haematocrit", result: "38", units: "%" },
      // Deliberately excluded — genuinely ambiguous, not merely unseeded (see LAB_CODE_SEED's own header).
      { test: "Bicarbonate", result: "24", units: "mEq/L" },
      { test: "Neutrophils", result: "70", units: "%" },
      // "PCT" is procalcitonin on a biochemistry report and PLATELETCRIT on an automated CBC, where
      // it prints alongside MPV/PDW. This adapter maps CBC parameters too, so both reach it.
      { test: "PCT", result: "0.22", units: "%" },
    ],
  });
  const { observations, issues } = mapGhisBundle(b);
  const codeFor = (name) => (observations.find((o) => o.sourceTestName === name) || {}).code;
  const systemFor = (name) => (observations.find((o) => o.sourceTestName === name) || {}).codeSystem;

  assert.equal(codeFor("Calcium"), "17861-6");
  assert.equal(codeFor("Ionised Calcium"), "1994-3");
  assert.notEqual(codeFor("Ionised Calcium"), codeFor("Calcium"), "ionised and total calcium are different analytes with different codes");
  assert.equal(codeFor("Magnesium"), "19123-9");
  assert.equal(codeFor("Phosphate"), "2777-1");
  assert.equal(codeFor("Phosphorus"), "2777-1", "phosphate and phosphorus name the same analyte");
  assert.equal(codeFor("Direct Bilirubin"), "1968-7");
  assert.equal(codeFor("Alkaline Phosphatase"), "6768-6");
  assert.equal(codeFor("Amylase"), "1798-8");
  assert.equal(codeFor("Lipase"), "3040-3");
  assert.equal(codeFor("Procalcitonin"), "33959-8");
  assert.equal(codeFor("Haematocrit"), "4544-3");

  // Bicarbonate/TCO2 and neutrophil %/absolute each carry MORE THAN ONE possible LOINC code for
  // one bare test name — no code is guessed for either, exactly like any other unseeded test.
  assert.equal(systemFor("Bicarbonate"), "ghis-local");
  assert.equal(codeFor("Bicarbonate"), "Bicarbonate", "kept under its own name, not coded");
  assert.equal(systemFor("Neutrophils"), "ghis-local");
  assert.equal(codeFor("Neutrophils"), "Neutrophils");
  // The bare abbreviation must NOT become procalcitonin: a plateletcrit coded as a sepsis biomarker
  // is a fabricated result, at a value that reads plausibly as either.
  assert.equal(systemFor("PCT"), "ghis-local", "PCT is ambiguous (procalcitonin vs plateletcrit)");
  assert.notEqual(codeFor("PCT"), "33959-8", "PCT must never be coded as procalcitonin");
  // ...while the full name still is, and PCV (packed cell volume) is unambiguously haematocrit.
  assert.equal(codeFor("Procalcitonin"), "33959-8");
  assert.equal(issues.filter((i) => i.code === "GHIS_LAB_UNMAPPED" && (i.testName === "Bicarbonate" || i.testName === "Neutrophils")).length, 2);
});

test("labs: an unmapped test keeps its name and is reported, never dropped", () => {
  const { observations, issues } = mapGhisBundle(bundle({ labs: [{ test: "Serum Xyzase", result: "3", units: "U/L" }] }));
  assert.equal(observations.length, 1, "an unmapped lab is still a real result and must reach the chart");
  assert.equal(observations[0].code, "Serum Xyzase");
  assert.equal(observations[0].codeSystem, "ghis-local");
  assert.equal(issues.some((i) => i.code === "GHIS_LAB_UNMAPPED"), true);
});

test("labs: a non-numeric result is preserved, not coerced to a number", () => {
  const { observations } = mapGhisBundle(bundle({ labs: [{ test: "Sodium", result: "NOT DETECTED", units: "" }] }));
  assert.equal(observations[0].value, "NOT DETECTED");
  assert.equal(observations[0].nonNumeric, true, "coercing this to NaN or 0 would be a fabricated result");
});

test("imaging: an unreported study is preliminary, not final", () => {
  const done = mapGhisBundle(bundle());
  assert.equal(done.reports[0].status, "final");
  assert.equal(done.reports[0].conclusion, "No acute infarct.");

  const pending = mapGhisBundle(bundle({ imaging: [{ reportId: "R2", studyName: "CT Chest", reported: false }] }));
  assert.equal(pending.reports[0].status, "preliminary",
    "an unread scan must not look like a signed-off result");
});

/* ------------------------------------------------------------------ partial failure */

test("resilience: one bad row does not discard the rest of the ward import", () => {
  const { observations, issues } = mapGhisBundle(bundle({
    labs: [
      { test: "Sodium", result: "138", units: "mEq/L" },
      { test: "", result: "999" }, // unusable
      { test: "Potassium", result: "4.1", units: "mEq/L" },
    ],
  }));
  assert.equal(observations.length, 2, "dropping a whole ward's labs over one bad row is its own clinical risk");
  assert.equal(issues.some((i) => i.code === "GHIS_LAB_NO_NAME"), true);
});

test("resilience: mapping never throws on junk input", () => {
  for (const junk of [null, undefined, {}, { patientId: "1" }, { patientId: "1", labs: null }]) {
    assert.doesNotThrow(() => mapGhisBundle(junk));
  }
});

/* ------------------------------------------------------------------ the hub wiring */

test("hub: ingest announces every entity on the bus and writes them once", async () => {
  const bus = new ClinicalEventBus();
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();
  const seen = [];
  for (const t of ["Patient", "Encounter", "Observation", "DiagnosticReport"]) {
    bus.on(`adapter.ingest.${t}`, (e) => seen.push(e.payload.entity.resourceType));
  }

  const { patient, observations } = await ingestGhisBundle(bundle(), { bus, store });

  assert.deepEqual(seen.sort(), ["DiagnosticReport", "Encounter", "Observation", "Observation", "Patient"].sort());
  const stored = await store.get("Patient", patient.id);
  assert.equal(stored.mrn, "12345", "the canonical patient is persisted, not the GHIS row");
  const storedObs = await store.byPatient("Observation", patient.id);
  assert.equal(storedObs.length, observations.length);
});

test("hub: re-ingesting the same bundle does not reprocess it", async () => {
  const bus = new ClinicalEventBus();
  let deliveries = 0;
  bus.on("adapter.ingest.Observation", () => { deliveries += 1; });

  const b = bundle();
  const first = await ingestGhisBundle(b, { bus });
  // Same source data, same recordedAt, so the event id is identical and the bus deduplicates.
  const replayEvents = first.observations.map((o) => `ingest-${o.id}-${o.meta.recordedAt}`);
  for (const id of replayEvents) await bus.emit("adapter.ingest.Observation", {}, { id });

  assert.equal(deliveries, 2, "a reconnect replaying the same records must not double-process them");
});

test("hub: a re-sync of a changed value versions the record rather than duplicating it", async () => {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();
  await ingestGhisBundle(bundle(), { store });
  await ingestGhisBundle(bundle({
    labs: [{ test: "Potassium", result: "5.9", units: "mEq/L", low: "3.5", high: "5.1", date: "03-JUL-2026 08:30" }],
  }), { store });

  const { patient } = mapGhisBundle(bundle());
  const k = mapGhisBundle(bundle()).observations.find((o) => o.sourceTestName === "Potassium");
  const history = await store.history("Observation", k.id);
  assert.equal(history.length, 2, "a corrected result is a new version of the same observation");
  assert.equal(history[0].value, 6.4, "the original value is still there");
  assert.equal(history[1].value, 5.9);
  const latest = await store.get("Observation", k.id);
  assert.equal(latest.value, 5.9, "and the current value is the corrected one");
});

test("hub: a bundle that cannot be identified is announced as a failure, not silently swallowed", async () => {
  const bus = new ClinicalEventBus();
  const failures = [];
  bus.on("adapter.ingest.failed", (e) => failures.push(e.payload));
  await ingestGhisBundle({ labs: [] }, { bus });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].system, SYSTEM);
});

test("hub: issues are announced so a site can see its own mapping gaps", async () => {
  const bus = new ClinicalEventBus();
  const reported = [];
  bus.on("adapter.ingest.issues", (e) => reported.push(...e.payload.issues));
  await ingestGhisBundle(bundle({ labs: [{ test: "Serum Xyzase", result: "3" }] }), { bus });
  assert.equal(reported.some((i) => i.code === "GHIS_LAB_UNMAPPED"), true,
    "an adapter that quietly drops vocabulary it does not know is how a chart goes silently incomplete");
});

test("hub: mapping alone writes and emits nothing", async () => {
  const bus = new ClinicalEventBus();
  let emitted = 0;
  bus.on("adapter.ingest.Patient", () => { emitted += 1; });
  mapGhisBundle(bundle()); // pure call, no deps
  assert.equal(emitted, 0, "mapping must be testable without a bus, a store or a network");
});
