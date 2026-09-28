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
