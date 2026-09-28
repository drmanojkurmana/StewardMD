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

test("on by default since 2026-09-27: no ctx.v2, no window, no flag; ctx.v2 overrides", () => {
  assert.equal(NLP._v2({}), true);
  assert.equal(NLP._v2({ v2: false }), false);
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

// round 8: typed-note reading (every mention, course idioms, recent time, tests and plans)
const ctx8 = (v2) => ({
  valid: { ...ctx2(v2).valid, headache: 1, anticoagulated: 1, alteredSensorium: 1 },
  labels: {}, v2, numeric: {},
  syn: { ...ctx2(v2).syn, headache: ["headache"], anticoagulated: ["warfarin"], alteredSensorium: ["confus"] },
});
const read8 = (t, v2) => NLP.extract(t, ctx8(v2));
const present8 = (t, v2) => read8(t, v2).present;

test("a later clean mention wins over a negated first one", () => {
  const t = "Denies fever at home. Vitals: temp 39.3";
  assert.ok(!present8(t, false).includes("fever"), "classic read only the first mention");
  assert.ok(present8(t, true).includes("fever"));
  assert.ok(present8("No fever at onset. Now high fever and cough", true).includes("fever"));
  assert.ok(present8("Afebrile on arrival. temp 38.4 at night", true).includes("fever"), "a measured 38.4 is fever");
  assert.ok(!present8("no fever, no cough", true).includes("fever"), "every mention negated stays absent");
  assert.ok(read8("no fever, no cough", true).absent.includes("fever"));
});

test("'not responding / no improvement' describe a course and negate nothing", () => {
  const t = "Prolonged high fever not responding to antibiotics";
  assert.ok(!present8(t, false).includes("fever"), "classic: 'not' negated the fever");
  assert.ok(present8(t, true).includes("fever"));
  assert.ok(present8("cough with no improvement on inhalers", true).includes("cough"));
  assert.ok(present8("No improvement, fever and cough", true).includes("cough"), "an idiom head does not start a negated list");
  assert.ok(present8("fever not settled with paracetamol", true).includes("fever"));
});

test("recent time is the present illness; 'background of N days of' too", () => {
  assert.ok(!present8("headache over the past hour", false).includes("headache"), "classic: 'past' made it past history");
  assert.ok(present8("headache over the past hour", true).includes("headache"));
  assert.ok(present8("confusion in the last 2 days", true).includes("alteredSensorium"));
  assert.ok(present8("On a background of 3 days of fever and cough", true).includes("fever"));
  assert.ok(!present8("past history of cough", true).includes("cough"), "past history stays past");
  assert.ok(!present8("background of 10 years of cough", true).includes("cough"), "years are background");
});

test("resolved, stopped, tested or planned is not a current finding", () => {
  assert.ok(!present8("fever which has since subsided, now cough", true).includes("fever"));
  assert.ok(!present8("AF, self-discontinued warfarin 6 months ago", true).includes("anticoagulated"));
  assert.ok(!present8("HIV serology pending", true).includes("immunocompromised"));
  assert.ok(!present8("HIV non-reactive", true).includes("immunocompromised"));
  assert.ok(!present8("blood cultures if febrile", true).includes("fever"));
  assert.ok(present8("fever for 3 days", true).includes("fever"));
  assert.ok(!present8("No ketones on the clinic dipstick. Serum ketones (bhb) 1.2", true).includes("ketonemia"),
    "a later lab name with a value is left to the numeric parser");
});

// round 10: derived findings that most often decided the top diagnosis on typed train notes
test("a cough of two weeks or more; bilateral crackles; exertional chest pain; days into admission", () => {
  const keys = ["cough", "prolongedCough2Weeks", "bilateralCrackles", "exertionalChestPain", "hospitalDay48"];
  const c10 = { valid: Object.fromEntries(keys.map((k) => [k, 1])), labels: {}, syn: { cough: ["cough"] }, numeric: {}, v2: true };
  const p = (t) => NLP.extract(t, c10).present;
  assert.ok(p("Cough for 6 weeks with evening fever").includes("prolongedCough2Weeks"));
  assert.ok(p("6-week history of productive cough").includes("prolongedCough2Weeks"));
  assert.ok(p("persistent dry cough").includes("prolongedCough2Weeks"));
  assert.ok(p("Cough began ~6 weeks ago").includes("prolongedCough2Weeks"));
  assert.ok(!p("cough for 5 days").includes("prolongedCough2Weeks"));
  assert.ok(p("Bilateral fine inspiratory crackles to mid-zones").includes("bilateralCrackles"));
  assert.ok(!p("no bilateral crackles").includes("bilateralCrackles"));
  assert.ok(p("chest tightness while climbing stairs").includes("exertionalChestPain"));
  assert.ok(!p("breathless on exertion, chest pain at rest").includes("exertionalChestPain"), "a comma ends the link");
  assert.ok(p("admitted 6 days ago for hip surgery").includes("hospitalDay48"));
  assert.ok(p("day 5 of mechanical ventilation").includes("hospitalDay48"));
  assert.ok(!p("admitted 1 day ago").includes("hospitalDay48"));
  assert.ok(!NLP.extract("Cough for 6 weeks", { ...c10, v2: false }).present.includes("prolongedCough2Weeks"), "classic unchanged");
});

// round 11: severe abdominal pain and a swollen joint said with words between
test("severe abdominal / loin pain with words between; a named swollen joint", () => {
  const keys = ["severeAbdominalPain", "jointSwelling"];
  const c11 = { valid: Object.fromEntries(keys.map((k) => [k, 1])), labels: {}, syn: {}, numeric: {}, v2: true };
  const p = (t) => NLP.extract(t, c11).present;
  assert.ok(p("Severe, constant epigastric pain radiating to the back").includes("severeAbdominalPain"));
  assert.ok(p("sudden severe left loin pain").includes("severeAbdominalPain"));
  assert.ok(!p("no severe abdominal pain").includes("severeAbdominalPain"));
  assert.ok(p("Right knee is markedly swollen with a tense effusion").includes("jointSwelling"));
  assert.ok(!p("knee not swollen").includes("jointSwelling"));
});

// round 13: a subject before the negation, "rather than", the fever later in a duration's list
test("'He denies X, Y or Z' negates every item; 'rather than X'; a list's fever takes the duration", () => {
  const keys = ["diarrhea", "nauseaVomiting", "cough", "fever", "prolongedFever", "headache"];
  const c13 = { valid: Object.fromEntries(keys.map((k) => [k, 1])), labels: {}, numeric: {}, v2: true,
    syn: { diarrhea: ["diarrhea", "diarrhoea"], nauseaVomiting: ["vomiting"], cough: ["cough"], fever: ["fever"], headache: ["headache"] } };
  const r = (t) => NLP.extract(t, c13);
  assert.deepEqual(r("He denies recent illness, diarrhea, or vomiting").present, []);
  assert.ok(r("mild constipation rather than diarrhoea").absent.includes("diarrhea"));
  assert.ok(r("Three weeks of worsening headache, low-grade fever and drowsiness").present.includes("prolongedFever"));
  assert.ok(!r("3 weeks of cough and 2 days of fever").present.includes("prolongedFever"), "another number in between: not the fever's");
  assert.ok(r("she has cough, fever and vomiting").present.includes("nauseaVomiting"), "a positive list stays positive");
});

// round 15: a ketone RESULT is read against the DKA threshold; "resolved completely" IS clinical improvement
test("ketone results below 3 mmol/L, trace or zero are not ketonaemia; resolution reads as improving", () => {
  const c15 = { valid: { ketonemia: 1, clinicallyImproving: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { ketonemia: ["ketones", "hydroxybutyrate"], clinicallyImproving: ["resolved completely", "now improving"] } };
  const p = (t) => NLP.extract(t, c15).present;
  assert.ok(!p("serum ketones (beta-hydroxybutyrate) 1.2").includes("ketonemia"));
  assert.ok(!p("urine ketones trace").includes("ketonemia"));
  assert.ok(!p("serum ketones mmol/l 0").includes("ketonemia"));
  assert.ok(p("serum ketones 5.8 mmol/l").includes("ketonemia"));
  assert.ok(p("urine ketones 2+").includes("ketonemia"), "a dipstick grade is positive");
  assert.ok(p("ketones positive").includes("ketonemia"));
  assert.ok(p("weakness that resolved completely with no residual deficit").includes("clinicallyImproving"));
  assert.ok(!NLP.extract("serum ketones 1.2", { ...c15, v2: false }).absent.includes("ketonemia"), "classic unchanged");
});

// round 17: "aspirated" as a procedure is not an aspiration event (narrow: real aspiration notes mention fluid and effusions)
test("pus aspirated from an abscess is a procedure; 'vomited and aspirated gastric fluid' is an aspiration event", () => {
  const c17 = { valid: { aspirationRiskFactor: 1 }, labels: {}, numeric: {}, v2: true, syn: { aspirationRiskFactor: ["aspirated"] } };
  const p = (t) => NLP.extract(t, c17).present;
  assert.ok(!p("40 ml of pus was aspirated from the abscess").includes("aspirationRiskFactor"));
  assert.ok(!p("ultrasound-guided, aspirated anchovy-sauce material").includes("aspirationRiskFactor"));
  assert.ok(p("he vomited and aspirated gastric fluid").includes("aspirationRiskFactor"));
  assert.ok(p("aspirated, now with a right pleural effusion").includes("aspirationRiskFactor"));
});

// round 18: electrolytes and glucose from the note (the findings exist under smd_kb_v2)
test("sodium, potassium, calcium and glucose values become findings; units inferred; tumour markers ignored", () => {
  const keys = ["sodiumLow", "potassiumHigh", "calciumHigh", "glucoseLow", "glucoseHigh", "glucoseVeryHigh"];
  const c18 = { valid: Object.fromEntries(keys.map((k) => [k, 1])), labels: {}, syn: {}, numeric: {}, v2: true };
  const p = (t) => NLP.extract(t, c18).present;
  assert.deepEqual(p("Labs: sodium 118 mmol/l; potassium 7.2 mmol/l").sort(), ["potassiumHigh", "sodiumLow"]);
  assert.ok(p("corrected calcium 3.4 mmol/l").includes("calciumHigh"));
  assert.ok(p("calcium 13.2 mg/dl").includes("calciumHigh"));
  assert.ok(!p("CA 19-9 of 400").includes("calciumHigh"), "a tumour marker is not calcium");
  assert.ok(p("CBG 42 mg/dl").includes("glucoseLow"));
  assert.ok(p("glucose 2.1 mmol/l").includes("glucoseLow"));
  assert.deepEqual(p("RBS 780 mg/dl").sort(), ["glucoseHigh", "glucoseVeryHigh"]);
  assert.deepEqual(p("blood sugar 110"), []);
  assert.deepEqual(p("sodium 138, K 4.1"), []);
});

// round 19 (metamorphic tests, the Laya idea): the same meaning must give the same findings
test("doubled spaces and line breaks read the same; long list items are negated; worst value wins; explicit age", () => {
  const keys = ["chestPain", "exertionalChestPain", "orthopnea", "tachycardia", "hypotension", "renalImpairment", "thrombocytopenia", "fever", "ageOver50", "cough"];
  const c19 = { valid: Object.fromEntries(keys.map((k) => [k, 1])), labels: {}, numeric: {}, v2: true,
    syn: { chestPain: ["chest pain"], exertionalChestPain: ["chest pain on exertion"], orthopnea: ["orthopnoea"], cough: ["cough"], fever: ["fever"] } };
  const p = (t) => NLP.extract(t, c19).present;
  assert.ok(p("chest  pain for 2 days").includes("chestPain"), "two spaces");
  assert.ok(p("Seen in clinic\nFever and cough").includes("fever"), "a line break ends a statement");
  assert.ok(!p("No orthopnoea, cough or chest pain on exertion.").includes("exertionalChestPain"), "a four-word item is negated");
  assert.ok(p("HR 88, later HR 128").includes("tachycardia"), "the worst heart rate");
  assert.ok(p("BP 128/80 on arrival, BP 82/50 an hour later").includes("hypotension"), "the lowest labelled BP");
  assert.ok(p("baseline creatinine 1.1 mg/dl; creatinine 4.2 mg/dl today").includes("renalImpairment"), "the highest creatinine");
  assert.ok(p("platelets 180; platelets 60").includes("thrombocytopenia"), "the lowest platelets");
  assert.ok(p("Type 2 diabetes for 18 years. 64-year-old man with fever").includes("ageOver50"), "the explicit age, not a duration");
  assert.ok(!NLP.extract("HR 88, later HR 128", { ...c19, v2: false }).present.includes("tachycardia"), "classic reads the first value");
});

// round 21: an ulcer named on the foot
test("an ulcer named on the foot is a diabetic foot ulcer finding", () => {
  const c21 = { valid: { diabeticFootUlcer: 1 }, labels: {}, syn: {}, numeric: {}, v2: true };
  const p = (t) => NLP.extract(t, c21).present;
  assert.ok(p("Painful, discharging ulcer over the right forefoot").includes("diabeticFootUlcer"));
  assert.ok(p("plantar ulcer under the first metatarsal head").includes("diabeticFootUlcer"));
  assert.ok(!p("peptic ulcer disease").includes("diabeticFootUlcer"));
  assert.ok(!p("no foot ulcer").includes("diabeticFootUlcer"));
});

// round 24: "a hot, swollen, painful right knee" names a swollen joint (adjectives before the joint)
test("a hot, swollen, painful knee is a swollen joint", () => {
  const c24 = { valid: { jointSwelling: 1 }, labels: {}, syn: {}, numeric: {}, v2: true };
  const p = (t) => NLP.extract(t, c24).present;
  assert.ok(p("Rapid onset of a hot, swollen, exquisitely painful right knee with fever").includes("jointSwelling"));
  assert.ok(p("right knee is swollen").includes("jointSwelling"));
  assert.ok(!p("no swollen joints").includes("jointSwelling"));
});

// round 25: with thirst and no burning, "frequent urination" is polyuria (hyperglycaemia), not a bladder symptom
test("frequent urination with thirst is polyuria; with burning it stays a urinary symptom", () => {
  const c25 = { valid: { urinaryFrequency: 1, polyuriaPolydipsia: 1, dysuria: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { urinaryFrequency: ["frequent urination"], dysuria: ["burning"] } };
  const p = (t) => NLP.extract(t, c25).present;
  assert.deepEqual(p("3-day history of increasing thirst, frequent urination, and vomiting"), ["polyuriaPolydipsia"]);
  assert.ok(p("burning and frequent urination").includes("urinaryFrequency"));
  assert.ok(p("frequent urination at night").includes("urinaryFrequency"));
});

// round 26: a "non-" prefix negates the word it is fused to ("non-tender", "non-productive")
test("a non- prefix negates the fused word", () => {
  const c26 = { valid: { erythema: 1, cough: 1, purulentSputum: 1, petechialRash: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { erythema: ["erythematous"], cough: ["cough"], purulentSputum: ["productive"], petechialRash: ["non-blanching rash"] } };
  const r = (t) => NLP.extract(t, c26);
  assert.ok(r("the wound edge is non-erythematous").absent.includes("erythema"));
  assert.ok(!r("the wound edge is non-erythematous").present.includes("erythema"));
  const nc = r("non-productive cough for a week");
  assert.ok(nc.present.includes("cough"));
  assert.ok(!nc.present.includes("purulentSputum"));
  assert.ok(r("a non-blanching rash on the legs").present.includes("petechialRash"));
});

// round 27: pressure-type chest pain, girdle pain, CURB-65, a swollen tender calf, the overdose scene, leftover signs
test("round 27 readings", () => {
  const c27 = { valid: { exertionalChestPain: 1, chestPain: 1, polyarthralgia: 1, severeCriteria: 1, cough: 1, alteredSensorium: 1, hypotension: 1, tachypnea: 1,
    crepitations: 1, consolidation: 1, knownCOPD: 1, legSwellingUnilateral: 1, calfTenderness: 1, drugOverdose: 1, ageOver50: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { chestPain: ["chest pain"], cough: ["cough"], alteredSensorium: ["confused", "unresponsive", "drowsy"], crepitations: ["crackles"], consolidation: ["consolidation"],
      knownCOPD: ["copd"], drugOverdose: ["overdose"] } };
  const r = (t) => NLP.extract(t, c27);
  const p = (t) => r(t).present;
  assert.ok(p("Central crushing chest pain radiating to left arm for 1 hour").includes("exertionalChestPain"));
  assert.ok(p("retrosternal pressure-like chest pain radiating to the jaw").includes("exertionalChestPain"));
  assert.ok(p("a dull, heavy discomfort across the lower chest").includes("exertionalChestPain"));
  assert.ok(!p("heavy smoker, chest clear, chest pain worse on inspiration").includes("exertionalChestPain"));
  assert.ok(!p("tearing chest pain radiating to the back").includes("exertionalChestPain"));
  assert.ok(r("no crushing chest pain").absent.includes("exertionalChestPain"));
  assert.ok(p("severe bilateral shoulder and hip girdle pain and stiffness").includes("polyarthralgia"));
  // CURB-65 >= 3 needs a pneumonia chest; a clear chest or COPD with crackles alone does not score
  assert.ok(p("72 year old with cough, crackles, now confused. bp 82/50, rr 34").includes("severeCriteria"));
  assert.ok(!p("72 year old with cough, now confused, bp 82/50, rr 34. Film clear, excluding pneumonia").includes("severeCriteria"));
  assert.ok(!p("72 year old with copd, cough, crackles, confused, bp 82/50, rr 34").includes("severeCriteria"));
  assert.ok(!p("58 year old with cough, crackles. rr 32, bp 120/80, urea 9").includes("severeCriteria"));
  assert.ok(p("70 year old with cough, consolidation, confused, rr 24, BUN 30 mg/dL").includes("severeCriteria"));
  const calf = p("Right calf is mildly swollen and tender compared to the left");
  assert.ok(calf.includes("legSwellingUnilateral") && calf.includes("calfTenderness"));
  assert.ok(!p("both legs are swollen to the knees").includes("legSwellingUnilateral"));
  assert.ok(p("Found drowsy at home beside empty medication blister packs").includes("drugOverdose"));
  assert.ok(p("Found unresponsive. A used syringe was beside him").includes("drugOverdose"));
  assert.ok(!p("found unresponsive by his wife; on insulin").includes("drugOverdose"));
  assert.ok(!p("minor residual right basal consolidation, resolving").includes("consolidation"));
  assert.ok(!p("a few basal crackles from resolving infection").includes("crepitations"));
  assert.ok(p("right basal crackles, consolidation on CXR").includes("consolidation"));
});

// round 28: a negated list that starts mid-sentence with a clause lead; treatment-unresponsive; "before any"; residual is present
test("round 28 readings", () => {
  const c28 = { valid: { jaundice: 1, dyspnea: 1, bleedingManifestation: 1, alteredSensorium: 1, oliguria: 1, organDysfunction: 1, cough: 1, fever: 1,
    purulentSputum: 1, rightUpperQuadrantPain: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { jaundice: ["jaundice"], dyspnea: ["breathless", "breathlessness"], bleedingManifestation: ["bleeding"], alteredSensorium: ["confusion", "unresponsive"],
      oliguria: ["oliguria"], cough: ["cough"], fever: ["fever"], purulentSputum: ["sputum"], rightUpperQuadrantPain: ["right-upper-quadrant tenderness"] } };
  const r = (t) => NLP.extract(t, c28);
  const a = r("He is eating, has passed urine in good volume, and has NO jaundice, breathlessness, bleeding, confusion or oliguria.");
  assert.deepEqual(a.present, []);
  assert.ok(["jaundice", "dyspnea", "bleedingManifestation", "alteredSensorium", "oliguria"].every((k) => a.absent.includes(k)));
  // a bare "no X" inside a terse list does not negate what follows it
  const b = r("c/o cough, sputum, no fever, breathlessness on exertion");
  assert.ok(b.present.includes("dyspnea") && b.absent.includes("fever"));
  assert.ok(!r("fever unresponsive to paracetamol").present.includes("alteredSensorium"));
  assert.ok(r("found unresponsive at home").present.includes("alteredSensorium"));
  assert.ok(!r("caught before any organ failure").present.includes("organDysfunction"));
  assert.ok(r("mild residual right-upper-quadrant tenderness").present.includes("rightUpperQuadrantPain"));
});

// round 29: a guarded first mention must not crash the later-mention scan
test("a finding whose first mention is skipped still reads a later mention", () => {
  const c = { valid: { alteredSensorium: 1 }, labels: {}, numeric: {}, v2: true, syn: { alteredSensorium: ["unresponsive"] } };
  const r = NLP.extract("fever unresponsive to paracetamol; later found unresponsive at home", c);
  assert.ok(r.present.includes("alteredSensorium"));
});

// round 29: the typo matcher takes one edit, the same first letter, and never a real word
test("the typo matcher does not turn real words into findings", () => {
  const c29 = { valid: { nauseaVomiting: 1, jaundice: 1, palpitations: 1, focalNeuroDeficit: 1, papilledema: 1, dysphagia: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { nauseaVomiting: ["retching"], jaundice: ["yellowing"], palpitations: ["palpitation"], focalNeuroDeficit: ["slurred"], papilledema: ["fundoscopy", "papilloedema"],
      dysphagia: ["dysphagia"] } };
  const p = (t) => NLP.extract(t, c29).present;
  assert.deepEqual(p("drenching night sweats"), []);
  assert.deepEqual(p("over the following days"), []);
  assert.deepEqual(p("palpation of the left lower quadrant"), []);
  assert.deepEqual(p("blurred vision"), []);
  assert.deepEqual(p("expressive dysphasia"), []);
  assert.deepEqual(p("fundoscopy shows choroidal tubercles"), []);
  assert.ok(p("fundoscopy shows bilateral disc swelling").includes("papilledema"));
  assert.ok(p("palpitaton for a week").includes("palpitations"));   // a real typo still reads
});

// round 32: a low haemoglobin and a high INR (as the lab import reads them); a head strike or a fall in words
test("round 32 readings", () => {
  const c32 = { valid: { hemoglobin: 1, inr: 1, headInjury: 1, oliguria: 1 }, labels: {}, numeric: { hemoglobin: 1, inr: 1 }, v2: true,
    syn: { oliguria: ["declining urine output"] } };
  const p = (t) => NLP.extract(t, c32).present;
  assert.ok(p("Labs: hemoglobin 6.2 g/dL").includes("hemoglobin"));
  assert.ok(p("Hb 82 g/L").includes("hemoglobin"));
  assert.ok(!p("Hb 13.5").includes("hemoglobin"));
  assert.ok(!p("last documented Hb 6 months ago was 12").includes("hemoglobin"));
  assert.ok(p("INR 2.4").includes("inr"));
  assert.ok(!p("INR 1.1").includes("inr"));
  assert.ok(p("slipped in the bathroom and knocked his head on the sink").includes("headInjury"));
  assert.ok(p("a minor fall backwards from standing height").includes("headInjury"));
  assert.ok(!p("a fall in blood pressure overnight").includes("headInjury"));
  assert.ok(p("declining urine output over 6 weeks").includes("oliguria"));
});

// round 33: tonsillar exudate and tender neck nodes said with words between
test("tonsillar exudate and tender cervical nodes with words between", () => {
  const c33 = { valid: { tonsillarExudate: 1, tenderCervicalNodes: 1 }, labels: {}, numeric: {}, v2: true, syn: {} };
  const p = (t) => NLP.extract(t, c33).present;
  assert.ok(p("Oropharynx shows markedly erythematous tonsils with bilateral confluent white-yellow exudate").includes("tonsillarExudate"));
  assert.ok(p("Tender, enlarged anterior cervical lymph nodes bilaterally").includes("tenderCervicalNodes"));
  assert.ok(!p("tonsils normal, no exudate").includes("tonsillarExudate"));
  assert.ok(!p("cervical lymph nodes palpable, not tender").includes("tenderCervicalNodes"));
});

// round 34: palmar erythema is a liver sign; negated disc swelling is not papilloedema; frothy urine is not a seizure
test("round 34 mention guards", () => {
  const c34 = { valid: { skinErythema: 1, papilledema: 1, seizure: 1 }, labels: { skinErythema: "Erythema" }, numeric: {}, v2: true,
    syn: { papilledema: ["fundoscopy", "papilloedema"], seizure: ["froth", "seizure"] } };
  const p = (t) => NLP.extract(t, c34).present;
  assert.ok(!p("Stigmata of chronic liver disease: palmar erythema and spider naevi.").includes("skinErythema"));
  assert.ok(!p("No erythema of the leg. Palmar erythema noted.").includes("skinErythema"));
  assert.ok(p("Diffuse erythema of the left leg.").includes("skinErythema"));
  assert.ok(!p("Fundoscopy: optic discs appear normal, no pallor or oedema").includes("papilledema"));
  assert.ok(p("Fundoscopy shows bilateral papilloedema").includes("papilledema"));
  assert.ok(!p("frothy urine for 3 weeks").includes("seizure"));
  assert.ok(p("frothing at the mouth and tongue biting").includes("seizure"));
});

// rounds 35 and 36: pain worse on breathing, several joints, extra doses, slow breathing, tingling with weak legs,
// lists led by "without" / "are not", "has not passed urine", an intimal flap, symmetric brisk reflexes
test("rounds 35 and 36 readings", () => {
  const c36 = { valid: { pleuriticChestPain: 1, pleuriticPain: 1, jointSwelling: 1, polyarthralgia: 1, drugOverdose: 1, bradypnea: 1, ascendingWeakness: 1,
    orthopnea: 1, calfTenderness: 1, fever: 1, rash: 1, headache: 1, urinaryRetention: 1, asterixis: 1, focalNeuroDeficit: 1, nauseaVomiting: 1 },
    labels: {}, numeric: {}, v2: true,
    syn: { orthopnea: ["orthopnoea"], calfTenderness: ["calf pain"], fever: ["fever"], rash: ["rash"], headache: ["headache"],
      urinaryRetention: ["distended bladder", "not passed urine"], asterixis: ["flap"], focalNeuroDeficit: ["brisk reflexes"], nauseaVomiting: ["retching"] } };
  const r = (t) => NLP.extract(t, c36);
  const p = (t) => r(t).present;
  assert.ok(p("It is clearly worse when she lies flat at night and on deep inspiration").includes("pleuriticChestPain"));
  const ra = p("symmetrical pain and swelling affecting the metacarpophalangeal joints");
  assert.ok(ra.includes("jointSwelling") && ra.includes("polyarthralgia"));
  assert.ok(p("She took two extra oxycodone doses today").includes("drugOverdose"));
  assert.ok(p("Chest clear with quiet, shallow, slow respiratory effort").includes("bradypnea"));
  assert.ok(p("3 days of tingling and mild weakness in both legs").includes("ascendingWeakness"));
  assert.deepEqual(p("palpitations at night, and are not accompanied by orthopnoea, calf pain or fever"), []);
  const w = r("fever, without rash, headache or vomiting");
  assert.ok(w.present.includes("fever") && w.absent.includes("rash") && w.absent.includes("headache"));
  assert.ok(p("he has not passed urine for 10 hours and has a distended bladder").includes("urinaryRetention"));
  assert.ok(!p("CT: intimal flap in the ascending aorta").includes("asterixis"));
  assert.ok(!p("Fine tremor, brisk reflexes").includes("focalNeuroDeficit"));
  assert.ok(p("brisk reflexes on the right with an upgoing plantar").includes("focalNeuroDeficit"));
  assert.ok(!p("pain reaching maximal intensity within 6 hours").includes("nauseaVomiting"));
});

// round 37: coronary history by event, sinusitis features, "severe ... headache", reduced urine output, and
// "alcohol-related cirrhosis" names a cause (not current drinking)
test("round 37 readings", () => {
  const c37 = { valid: { knownCAD: 1, unilateralFacialPain: 1, doubleSickening: 1, symptomsOver10Days: 1, headacheSevere: 1, oliguria: 1, alcoholExcess: 1 },
    labels: {}, numeric: {}, v2: true, syn: {} };
  const p = (t) => NLP.extract(t, c37).present;
  assert.ok(p("prior anterior MI with a drug-eluting stent 4 years ago").includes("knownCAD"));
  assert.ok(p("Facial pain and purulent nasal discharge for 11 days, worsening after initial improvement").includes("doubleSickening"));
  assert.ok(p("Facial pain and purulent nasal discharge for 11 days").includes("symptomsOver10Days"));
  assert.ok(!p("nasal congestion for 4 days").includes("symptomsOver10Days"));
  assert.ok(p("developed worsening right-sided facial pain").includes("unilateralFacialPain"));
  assert.ok(p("New, severe left-sided headache for 3 weeks").includes("headacheSevere"));
  assert.ok(p("Urine output over the last day was noticeably reduced").includes("oliguria"));
  assert.ok(!p("urine output not reduced").includes("oliguria"));
  assert.ok(p("two alcohol-related admissions this year").includes("alcoholExcess"));
  assert.ok(!p("known alcohol-related cirrhosis").includes("alcoholExcess"));
});

// round 38: items with their own "no" end the negation for an item without one, unless it sits in an "or" run
test("per-item negation: an item without its own no is present unless joined by or", () => {
  const c38 = { valid: { fever: 1, neckStiffness: 1, alteredSensorium: 1, seizure: 1, cough: 1, hemoptysis: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { fever: ["fever"], neckStiffness: ["neck stiffness"], alteredSensorium: ["altered sensorium"], seizure: ["seizure"], cough: ["cough"], hemoptysis: ["haemoptysis"] } };
  const r = (t) => NLP.extract(t, c38);
  const b = r("No fever, no neck stiffness, altered sensorium after seizure.");
  assert.deepEqual(b.present.sort(), ["alteredSensorium", "seizure"]);
  assert.ok(b.absent.includes("fever") && b.absent.includes("neckStiffness"));
  assert.deepEqual(r("No preceding trauma, no cough, fever, or haemoptysis").present, []);
  assert.deepEqual(r("No cough, fever or haemoptysis").present, []);
});

// round 39: pain through to the back
test("pain radiating or boring through to the back is back pain", () => {
  const c39 = { valid: { backPain: 1 }, labels: {}, numeric: {}, v2: true, syn: {} };
  const p = (t) => NLP.extract(t, c39).present;
  assert.ok(p("Severe epigastric pain radiating to the back for 12 hours").includes("backPain"));
  assert.ok(p("severe, constant epigastric pain boring through to the back").includes("backPain"));
  assert.ok(!p("no pain radiating to the back").includes("backPain"));
});

// round 40: "X without Y" never negates X; postfix forms still negate; course idioms after X still do not
test("negation scope: without after the finding, postfix forms, idioms", () => {
  const c40 = { valid: { fever: 1, rigors: 1, nauseaVomiting: 1, neckStiffness: 1, calfTenderness: 1, rash: 1, papilledema: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { fever: ["fever"], rigors: ["rigors"], nauseaVomiting: ["nausea", "vomiting"], neckStiffness: ["neck stiff"], calfTenderness: ["calf tender"],
      rash: ["rash"], papilledema: ["papilledema"] } };
  const r = (t) => NLP.extract(t, c40);
  const a = r("fever without rigors");
  assert.ok(a.present.includes("fever") && a.absent.includes("rigors"));
  assert.ok(r("mild nausea without vomiting").present.includes("nauseaVomiting"));
  assert.ok(r("bilateral early papilledema without frank choroidal tubercles").present.includes("papilledema"));
  assert.ok(r("neck stiffness was not elicited").absent.includes("neckStiffness"));
  assert.ok(r("calf tenderness: none").absent.includes("calfTenderness"));
  assert.ok(r("rash not seen").absent.includes("rash"));
  assert.ok(r("fever not responding to paracetamol").present.includes("fever"));
  assert.ok(r("He denies fever").absent.includes("fever"));
});

// round 41: the "old" of an age is not a past-history cue
test("an age phrase does not make the findings beside it past history", () => {
  const c41 = { valid: { fever: 1, ruralExposure: 1, cerebrovascularDisease: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { fever: ["febrile"], ruralExposure: ["farmer"], cerebrovascularDisease: ["stroke"] } };
  const r = (t) => NLP.extract(t, c41);
  assert.ok(r("A 30-year-old febrile man.").findings.some((f) => f.canonicalFindingId === "fever" && f.temporality === "current"));
  assert.ok(r("A 61-year-old cotton farmer.").findings.some((f) => f.canonicalFindingId === "ruralExposure" && f.temporality === "current"));
  assert.ok(r("A 70 year old with an old stroke.").findings.some((f) => f.canonicalFindingId === "cerebrovascularDisease" && f.temporality === "historical"));
});

// round 42: shorthand reads as the words ("w/o", "w/", "abd", a trailing "-" / "(+)" / "-ve")
test("doctors' shorthand", () => {
  const c42 = { valid: { fever: 1, rigors: 1, abdominalPain: 1, nauseaVomiting: 1, cough: 1, weightLoss: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { fever: ["fever"], rigors: ["rigors"], abdominalPain: ["abdominal pain"], nauseaVomiting: ["vomiting"], cough: ["cough"], weightLoss: ["weight loss"] } };
  const r = (t) => NLP.extract(t, c42);
  const a = r("Fever w/o rigors.");
  assert.ok(a.present.includes("fever") && a.absent.includes("rigors"));
  const b = r("Abd pain +, vomiting +, fever -");
  assert.ok(b.present.includes("abdominalPain") && b.present.includes("nauseaVomiting") && b.absent.includes("fever"));
  const c = r("Cough (+), fever (-).");
  assert.ok(c.present.includes("cough") && c.absent.includes("fever"));
  assert.ok(r("Fever - 3 days.").present.includes("fever"));   // a dash inside a phrase is not a sign
  assert.ok(r("frail over the past year w/ 8 kg unintentional weight loss").findings.some((f) => f.canonicalFindingId === "weightLoss" && f.temporality === "current"));
});

// round 43: a bullet or number opening a statement is not part of it (negated lists kept their head)
test("bullet lines read like sentences", () => {
  const c43 = { valid: { fever: 1, cough: 1, dysuria: 1, headache: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { fever: ["fever"], cough: ["cough"], dysuria: ["dysuria"], headache: ["headache"] } };
  const r = (t) => NLP.extract(t, c43);
  const a = r("- No fever, cough or dysuria\n- Headache for 2 days");
  assert.deepEqual(a.present, ["headache"]);
  assert.ok(["fever", "cough", "dysuria"].every((k) => a.absent.includes(k)));
  assert.deepEqual(r("1. Headache for 3 days. 2. No cough.").present, ["headache"]);
  assert.ok(r("* fever\n* no cough").present.includes("fever"));
});

// round 44: contractions, never, neither/nor negate ("never had a headache like this" does not)
test("contractions, never and neither-nor negate", () => {
  const c44 = { valid: { fever: 1, cough: 1, dyspnea: 1, headache: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { fever: ["fever"], cough: ["cough"], dyspnea: ["breathless"], headache: ["headache"] } };
  const r = (t) => NLP.extract(t, c44);
  for (const t of ["He doesn't have fever.", "He doesn’t have fever.", "He hasn't had fever.", "Never had fever."]) assert.ok(r(t).absent.includes("fever"), t);
  assert.ok(r("She didn't have any cough.").absent.includes("cough"));
  assert.ok(r("She isn't breathless.").absent.includes("dyspnea"));
  const n = r("Neither fever nor cough.");
  assert.ok(n.absent.includes("fever") && n.absent.includes("cough"));
  assert.ok(r("She has never had a headache like this before.").present.includes("headache"));
});

// round 45: vital-sign formats ("Temp 101F" is Fahrenheit, not a 101-year-old woman)
test("vital-sign formats doctors type", () => {
  const c45 = { valid: { fever: 1, tachycardia: 1, hypoxia: 1, hypotension: 1, alteredSensorium: 1, ageOver50: 1 }, labels: {}, numeric: {}, v2: true, syn: {} };
  const r = (t) => NLP.extract(t, c45);
  const t101 = r("Temp 101F.");
  assert.ok(t101.present.includes("fever") && !t101.present.includes("ageOver50") && t101.demographics.age === undefined);
  assert.ok(r("T 38.9.").present.includes("fever"));
  assert.ok(!r("T2DM for 10 years.").present.includes("fever"));
  assert.ok(r("PR 124/min.").present.includes("tachycardia"));
  assert.ok(r("SpO2- 89%.").present.includes("hypoxia"));
  assert.ok(r("GCS E2V3M5.").present.includes("alteredSensorium"));
  assert.ok(r("SBP 82.").present.includes("hypotension"));
  const v = r("Vitals: T 38.4, P 112, BP 90/60, RR 26, SpO2 91%.");
  assert.ok(v.present.includes("fever") && v.present.includes("tachycardia"));
  assert.equal(r("45 F with fever").demographics.age, 45);
});

// round 46: lab abbreviations doctors type (Cr, K, T. bili); a bare glucose of 20 to 40 is ambiguous, so not read
test("lab abbreviations and an ambiguous glucose", () => {
  const c46 = { valid: { renalImpairment: 1, potassiumHigh: 1, glucoseLow: 1, glucoseHigh: 1, organDysfunction: 1 }, labels: {}, numeric: {}, v2: true, syn: {} };
  const r = (t) => NLP.extract(t, c46).present;
  assert.ok(r("Cr 2.8.").includes("renalImpairment"));
  assert.ok(r("K 6.4.").includes("potassiumHigh"));
  assert.ok(r("K+ 6.8.").includes("potassiumHigh"));
  assert.ok(!r("CRP 48.").includes("renalImpairment"));
  assert.ok(r("T. bili 4.2.").includes("organDysfunction"));
  assert.ok(r("Total bilirubin 3.1 mg/dl.").includes("organDysfunction"));
  const g = r("RBS 30.");
  assert.ok(!g.includes("glucoseLow") && !g.includes("glucoseHigh"));
  assert.ok(r("RBS 30 mg/dl.").includes("glucoseLow"));
  assert.ok(r("RBS 480.").includes("glucoseHigh"));
  assert.ok(r("RBS 2.8 mmol/l.").includes("glucoseLow"));
});

// round 47: "h/o fever for 5 days" opens the present illness (Indian notes); "for 10 years" and "2 weeks ago" stay past
test("history of a finding for days is the present illness", () => {
  const c47 = { valid: { fever: 1, cough: 1, hypertensionHx: 1, nauseaVomiting: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { fever: ["fever"], cough: ["cough"], hypertensionHx: ["hypertension"], nauseaVomiting: ["nausea", "vomiting"] } };
  const r = (t) => NLP.extract(t, c47);
  for (const t of ["h/o fever for 5 days.", "History of fever for 5 days with cough.", "h/o fever x 3 days.", "h/o fever since yesterday."])
    assert.ok(r(t).present.includes("fever"), t);
  assert.ok(r("h/o cough since 2 weeks.").present.includes("cough"));
  const past = r("History of hypertension for 10 years.").findings.find((f) => f.canonicalFindingId === "hypertensionHx");
  assert.equal(past.temporality, "historical");
  assert.ok(!r("History of fever 2 weeks ago.").present.includes("fever"));
  assert.ok(!r("Past history of fever for 3 days last year.").present.includes("fever"));
  assert.ok(r("N/V since morning.").present.includes("nauseaVomiting"));
  assert.ok(r("No n/v.").absent.includes("nauseaVomiting"));
});

// round 47: "neutropenic precautions / protocol" is a ward routine, not a neutrophil count
test("neutropenic precautions are not neutropenia", () => {
  const cN = { valid: { neutropenia: 1 }, labels: {}, numeric: {}, v2: true, syn: { neutropenia: ["neutropenia", "neutropenic"] } };
  const r = (t) => NLP.extract(t, cN).present;
  assert.ok(!r("Per neutropenic-precaution protocol, cultures drawn.").includes("neutropenia"));
  assert.ok(!r("Neutropenic precautions started.").includes("neutropenia"));
  assert.ok(r("He is neutropenic.").includes("neutropenia"));
  assert.ok(r("Febrile neutropenia.").includes("neutropenia"));
});

// round 49: safety-netting names findings the patient does not have; a turn back to the patient is read again
test("safety-net advice is not a finding", () => {
  const cS = { valid: { dyspnea: 1, chestPain: 1, alteredSensorium: 1, rash: 1, nauseaVomiting: 1, fever: 1, diarrhea: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { dyspnea: ["breathless"], chestPain: ["chest pain"], alteredSensorium: ["confusion"], rash: ["rash"], nauseaVomiting: ["vomiting"], fever: ["fever"], diarrhea: ["loose motion"] } };
  const r = (t) => NLP.extract(t, cS).present;
  assert.deepEqual(r("Return if breathless, chest pain or confusion."), []);
  assert.deepEqual(r("Advised to report any rash."), []);
  assert.deepEqual(r("Warning signs explained: rash, vomiting."), []);
  assert.deepEqual(r("She was told to return if fever persisted, but she now has rash and vomiting.").sort(), ["nauseaVomiting", "rash"]);
  assert.deepEqual(r("Mother told about fever and loose motions since 2 days.").sort(), ["diarrhea", "fever"]);
  assert.deepEqual(r("Chest pain since morning. Return if breathless."), ["chestPain"]);
});

// round 50: "h/o fever with chills x 5 days" is dated from "history of" to the sentence end; "cough/cold" is coryza
test("history dated past a with, and a cold with a cough", () => {
  const c50 = { valid: { fever: 1, rigors: 1, coryza: 1, cough: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { fever: ["fever"], rigors: ["chills", "rigors"], coryza: ["coryza", "running nose"], cough: ["cough"] } };
  const r = (t) => NLP.extract(t, c50);
  assert.ok(r("H/o fever with chills/rigors x 5 days.").present.includes("fever"));
  for (const t of ["Fever/cough/cold since 3 days.", "Cold and cough for 2 days.", "Sneezing, cold since yesterday."]) assert.ok(r(t).present.includes("coryza"), t);
  assert.ok(!r("Cold peripheries.").present.includes("coryza"));
  assert.ok(r("No cough/cold.").absent.includes("coryza"));
});

// round 51: a BP typo is not read from inside a longer number ("BP 1200/80" is not 200/80)
test("blood pressure is read from whole numbers only", () => {
  const cB = { valid: { hypertensionHx: 1, hypotension: 1 }, labels: {}, numeric: {}, v2: true, syn: {} };
  const r = (t) => NLP.extract(t, cB).present;
  assert.deepEqual(r("BP 1200/80."), []);
  assert.deepEqual(r("Vitals: 1200/80."), []);
  assert.deepEqual(r("BP 150/90."), ["hypertensionHx"]);
  assert.deepEqual(r("BP 70/40."), ["hypotension"]);
  assert.deepEqual(r("Date 12/10/2026."), []);
  assert.ok(r("GCS 13/15, BP 88/50.").includes("hypotension"));
});

// round 52: a named antibiotic course before this visit is prior antibiotic exposure; today's plan is not
test("a named antibiotic course is prior exposure", () => {
  const cA = { valid: { priorAntibiotics: 1, antibioticsLast90Days: 1 }, labels: {}, numeric: {}, v2: true, syn: {} };
  const r = (t) => NLP.extract(t, cA).present;
  for (const t of ["Took amoxicillin for 3 days last week.", "Received a course of IV cefuroxime perioperatively.", "Recently completed a 10-day course of IV piperacillin-tazobactam.",
    "Worsening despite oral antibiotics.", "The last treated with oral co-amoxiclav.", "Given 2 doses of azithromycin."]) assert.deepEqual(r(t).sort(), ["antibioticsLast90Days", "priorAntibiotics"], t);
  for (const t of ["Has not received any antibiotics.", "Started on IV ceftriaxone in casualty.", "Plan: ceftriaxone 2 g IV."]) assert.deepEqual(r(t), [], t);
});

// round 54: pregnancy as Indian notes write it; the obstetric score alone is parity, not a pregnancy
test("pregnancy from gestation, POG and a positive UPT", () => {
  const cP = { valid: { pregnancy: 1 }, labels: {}, numeric: {}, v2: true, syn: { pregnancy: ["pregnant"] } };
  const r = (t) => NLP.extract(t, cP).present;
  for (const t of ["G2P1L1 at 28 weeks POG.", "Primi at 32 weeks.", "30 weeks of amenorrhoea.", "POG 24 weeks.", "LMP 2 months back, UPT positive."]) assert.deepEqual(r(t), ["pregnancy"], t);
  for (const t of ["UPT negative.", "G2P2L2, tubectomy done.", "Not pregnant."]) assert.deepEqual(r(t), [], t);
});

// round 55: fever durations as structured notes write them; a range reads its lower bound
test("fever duration after a dash, colon or bracket, a fortnight, a range", () => {
  const cD = { valid: { fever: 1, prolongedFever: 1, prolongedCough2Weeks: 1, cough: 1 }, labels: {}, numeric: {}, v2: true, syn: { fever: ["fever"], cough: ["cough"] } };
  const r = (t) => NLP.extract(t, cD).present;
  for (const t of ["Fever for a fortnight.", "Fever - 7 days.", "Fever (10 days).", "Fever: 8 days.", "Fever for 7-10 days."]) assert.ok(r(t).includes("prolongedFever"), t);
  for (const t of ["Fever for 2-3 days.", "Fever for 5 days."]) assert.ok(!r(t).includes("prolongedFever"), t);
  assert.ok(r("Cough - 3 weeks.").includes("prolongedCough2Weeks"));
});

// round 56: a normal examination in words is a pertinent negative; a present mention of the key still wins
test("normal examination phrases deny what they rule out", () => {
  const cE = { valid: { crepitations: 1, wheeze: 1, neckStiffness: 1, focalNeuroDeficit: 1, dehydration: 1 }, labels: {}, numeric: {}, v2: true,
    syn: { crepitations: ["crepitation", "crepts"], wheeze: ["wheeze"], neckStiffness: ["neck stiff"], focalNeuroDeficit: ["hemiparesis"], dehydration: ["dehydrat"] } };
  const r = (t) => NLP.extract(t, cE);
  assert.deepEqual(r("Chest clear.").absent.sort(), ["crepitations", "wheeze"]);
  assert.deepEqual(r("RS: NVBS, no added sounds.").absent.sort(), ["crepitations", "wheeze"]);
  assert.deepEqual(r("Neck supple.").absent, ["neckStiffness"]);
  assert.deepEqual(r("No focal neurological deficit.").absent, ["focalNeuroDeficit"]);
  assert.deepEqual(r("Well hydrated.").absent, ["dehydration"]);
  assert.deepEqual(r("Chest not clear.").absent, []);
  const mix = r("Chest clear except right basal crepitations.");
  assert.ok(mix.present.includes("crepitations") && mix.absent.includes("wheeze"));
});

// round 57: a body-fluid glucose is not the blood glucose (CSF glucose read as hypoglycaemia in meningitis notes)
test("CSF and other fluid glucose is not blood glucose", () => {
  const cG = { valid: { glucoseLow: 1, glucoseHigh: 1 }, labels: {}, numeric: {}, v2: true, syn: {} };
  const r = (t) => NLP.extract(t, cG).present;
  for (const t of ["csf glucose 62 mg/dL.", "Labs: protein 0.92 g/L (elevated); glucose 3.4 mmol/L (CSF:serum ratio normal at 0.55).",
    "CSF: WBC 180/uL; protein 0.9 g/L; glucose 1.4 mmol/L.", "Pleural fluid glucose 40 mg/dl."]) assert.deepEqual(r(t), [], t);
  for (const t of ["CSF normal. Glucose 45 mg/dl.", "LP: CSF clear, glucose 30 mg/dl, blood glucose 45 mg/dl.", "Glucose 2.8 mmol/L.", "RBS 45 mg/dl."]) assert.deepEqual(r(t), ["glucoseLow"], t);
});
