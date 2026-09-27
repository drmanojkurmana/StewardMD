// clinical-nlp.js smd_nlp_v2 (Phase 2 of kb/validation/PLAN-DX-ABX-10.md).
// Each defect is asserted on the classic path (so the record shows what v2 fixes) and fixed on v2.
// Population-level effect: test/run-dx-audit.mjs (FLAGS=smd_nlp_v2=1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const NLP = require("../clinical-nlp.js");

const KEYS = ["transaminasesVeryHigh", "cholestaticLFT", "asciticPMNHigh", "fever", "cough", "tachycardia", "tachypnea", "hypotension", "hypoxia", "alteredSensorium", "lactateElevated",
  "thrombocytopenia", "neutropenia", "absoluteNeutrophilCountLow", "renalImpairment", "organDysfunction", "prolongedFever",
  "subacuteOnset", "ageOver50", "feverGU", "dysuria", "costovertebralTenderness", "malignancy", "platelets", "weight", "myalgiaArthralgia"];
const valid = Object.fromEntries(KEYS.map((k) => [k, 1]));
const ctx = (v2) => ({
  valid, labels: { platelets: "Platelets", weight: "Weight", costovertebralTenderness: "Costovertebral angle tenderness" },
  syn: { fever: ["fever", "febrile"], cough: ["cough"], dysuria: ["dysuria"], costovertebralTenderness: ["costovertebral"], malignancy: ["cancer"],
    myalgiaArthralgia: ["myalgia", "aches and pains"] },
  numeric: { platelets: 1, weight: 1 }, v2,
});
const present = (t, v2) => NLP.extract(t, ctx(v2)).present;

test("off by default: no ctx.v2, no window, no flag", () => {
  assert.equal(NLP._v2({}), false);
  assert.equal(NLP._v2({ v2: true }), true);
});

test("a vital's negation is its own clause, not the whole note", () => {
  const t = "fever, no cough. HR 128, RR 30, SpO2 88%";
  assert.ok(!present(t, false).includes("tachycardia"), "classic: 'no cough' negated every vital");
  for (const k of ["tachycardia", "tachypnea", "hypoxia"]) assert.ok(present(t, true).includes(k), k);
  assert.ok(!present(t, true).includes("cough"), "the real negation still holds");
});

test("a labelled BP is read even after a GCS x/15", () => {
  const t = "GCS 13/15, BP 78/44";
  assert.ok(!present(t, false).includes("hypotension"), "classic took 13/15 as the BP");
  assert.ok(present(t, true).includes("hypotension"));
  assert.ok(present(t, true).includes("alteredSensorium"));
});

test("temperature without a unit, MAP", () => {
  assert.ok(present("temp 39.4", true).includes("fever"));
  assert.ok(present("MAP 58 on arrival", true).includes("hypotension"));
});

test("numeric labs map to findings, only with a short connector", () => {
  assert.ok(present("lactate 5.8 mmol/L", true).includes("lactateElevated"));
  assert.ok(present("lactate (mmol/L) 3.2", true).includes("lactateElevated"));
  assert.ok(!present("lactate 1.4", true).includes("lactateElevated"));
  assert.ok(present("platelets 62,000", true).includes("thrombocytopenia"));
  assert.ok(present("plt 1.2 lakh", true).includes("thrombocytopenia"));
  assert.ok(!present("platelets 245 x10^3/uL", true).includes("thrombocytopenia"));
  assert.ok(!present("platelet count normal, INR 1.1", true).includes("thrombocytopenia"), "INR is not a platelet count");
  assert.ok(!present("creatinine normal, potassium 5.9", true).includes("renalImpairment"), "potassium is not creatinine");
  assert.ok(present("creatinine 2.4 mg/dL", true).includes("renalImpairment"));
  assert.ok(present("creatinine 190 umol/L", true).includes("renalImpairment"));
  const anc = present("ANC 0.3", true);
  assert.ok(anc.includes("neutropenia") && !anc.includes("absoluteNeutrophilCountLow"));
  assert.ok(present("absolute neutrophil count 60", true).includes("absoluteNeutrophilCountLow"));
});

test("organ dysfunction at one SOFA-2 threshold, not on a chronic baseline", () => {
  assert.ok(present("platelets 80,000", true).includes("organDysfunction"));
  assert.ok(present("total bilirubin 3.2 mg/dL", true).includes("organDysfunction"));
  assert.ok(present("GCS 11", true).includes("organDysfunction"));
  assert.ok(!present("known CKD, creatinine 3.1", true).includes("organDysfunction"));
  assert.ok(!present("platelets 130,000", true).includes("organDysfunction"));
});

test("a bare lab name is not a finding", () => {
  assert.ok(present("unable to bear weight", false).includes("weight"), "classic: 'weight' became a finding");
  assert.ok(!present("unable to bear weight", true).includes("weight"));
  assert.ok(!present("platelets pending", true).includes("platelets"));
});

test("'<n>-day history of' is the present illness", () => {
  assert.ok(!present("3-day history of fever and cough", false).includes("fever"), "classic dropped it as past history");
  assert.ok(present("3-day history of fever and cough", true).includes("fever"));
  assert.ok(!present("past history of fever, now well", true).includes("fever"));
});

test("durations: prolonged fever, subacute onset, chronic background ignored", () => {
  assert.ok(present("fever for 2 weeks", true).includes("prolongedFever"));
  assert.ok(present("3 weeks of low-grade evening fever", true).includes("prolongedFever"));
  assert.ok(!present("fever for 3 days", true).includes("prolongedFever"));
  assert.ok(present("back pain for 3 weeks, PSA rising over the last 6 months", true).includes("subacuteOnset"));
  assert.ok(present("a 6-week history of nasal congestion", true).includes("subacuteOnset"));
  assert.ok(!present("fever two days ago", true).includes("subacuteOnset"));
});

test("derived: age band and fever with urinary symptoms", () => {
  assert.ok(present("78-year-old woman", true).includes("ageOver50"), "classic missed the hyphen");
  assert.ok(present("M/64 with fever", true).includes("ageOver50"));
  assert.ok(!present("45 year old man", true).includes("ageOver50"));
  assert.ok(present("fever with dysuria", true).includes("feverGU"));
});

test("CVA tenderness is costovertebral, not stroke", () => {
  assert.ok(present("CVA tenderness on the left", true).includes("costovertebralTenderness"));
});

test("family history is not the patient's; a child's reported fever is", () => {
  assert.ok(!present("family history of cancer", true).includes("malignancy"));
  assert.ok(present("known case of cancer", true).includes("malignancy"));
  assert.ok(present("Mother reports high fever since morning", true).includes("fever"));
});

test("liver enzymes and ascitic fluid (keys exist under smd_kb_v2)", () => {
  assert.ok(present("ALT 2200, AST 1800", true).includes("transaminasesVeryHigh"));
  assert.ok(present("SGPT 1,450 IU/L", true).includes("transaminasesVeryHigh"));
  assert.ok(!present("ALT 320", true).includes("transaminasesVeryHigh"));
  assert.ok(present("ALP 480 IU/L", true).includes("cholestaticLFT"));
  assert.ok(!present("alkaline phosphatase 180", true).includes("cholestaticLFT"));
  assert.ok(present("ascitic fluid PMN 450", true).includes("asciticPMNHigh"));
  assert.ok(!present("ascitic fluid PMN 120", true).includes("asciticPMNHigh"));
  assert.ok(!present("ALT 2200", false).includes("transaminasesVeryHigh"), "classic path unchanged");
});

// round 2: word-start matching, list and postfix negation, "N weeks ago"
const ctx2 = (v2) => ({
  valid: { ...valid, immunocompromised: 1, ecgIschemia: 1, ketonemia: 1, diarrhea: 1, rash: 1, seizure: 1 },
  labels: {}, v2, numeric: {},
  syn: { ...ctx(v2).syn, immunocompromised: ["hiv"], ecgIschemia: ["stemi"], ketonemia: ["ketones", "hydroxybutyrate"], diarrhea: ["diarrhoea", "diarrhea"],
    rash: ["rash"], seizure: ["seizure"], malignancy: ["cancer", "carcinoma"] },
});
const present2 = (t, v2) => NLP.extract(t, ctx2(v2)).present;

test("a phrase has to start a word (short ones also end one)", () => {
  assert.ok(present2("shivering since morning", false).includes("immunocompromised"), "classic: 'hiv' inside 'shivering'");
  assert.ok(!present2("shivering since morning", true).includes("immunocompromised"));
  assert.ok(!present2("unwell systemically", true).includes("ecgIschemia"), "'stemi' inside 'systemically'");
  assert.ok(present2("HIV positive on ART", true).includes("immunocompromised"));
  assert.ok(present2("known carcinomas of the bowel", true).includes("malignancy"), "a long phrase may run on (plural)");
});

test("a negated list negates each short item", () => {
  const t = "No fever, cough, rash or diarrhoea.";
  assert.ok(present2(t, false).includes("cough"), "classic: only the first item was negated");
  for (const k of ["fever", "cough", "rash", "diarrhea"]) assert.ok(!present2(t, true).includes(k), k);
  assert.ok(!present2("no history of head injury, seizure, or cancer", true).includes("seizure"));
});

test("list negation guards: idiom heads and run-on durations", () => {
  assert.ok(present2("No known drug allergies, fever and cough.", true).includes("fever"), "allergy idiom negates nothing");
  assert.ok(present2("No vomiting, fever and cough for 3 days.", true).includes("cough"), "a duration makes it positive");
  assert.ok(present2("No vomiting, fever and cough for 3 days.", true).includes("fever"));
  assert.ok(present2("no rash but fever", true).includes("fever"), "'but' ends the negation");
});

test("a result reported after the name", () => {
  assert.ok(present2("urine ketones positive", true).includes("ketonemia"));
  assert.ok(!present2("beta hydroxybutyrate negative", true).includes("ketonemia"));
  assert.ok(present2("beta hydroxybutyrate negative", false).includes("ketonemia"), "classic kept it");
});

test("'3 weeks ago' dates an event; an onset word makes it the illness tempo", () => {
  assert.ok(!present("Catheter last changed 3 weeks ago. fever", true).includes("subacuteOnset"));
  assert.ok(present("Symptoms started 3 weeks ago", true).includes("subacuteOnset"));
  assert.ok(present("cough for 3 weeks", true).includes("subacuteOnset"));
});
