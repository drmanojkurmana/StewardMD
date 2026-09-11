/* test/opd-voice.test.mjs — voice engine -> opd-emr assessment field mapping (_voiceMerge).
 * Verifies SMD_AMBIENT updates fold into opd-emr's assessVals under the RIGHT GHIS field names,
 * with correct value coercion (check->true/false, yesno->Y/N), that engine findings opd-emr can't
 * save are dropped (never guessed), that a doctor-edited field is never overwritten, and that
 * map-gated updates (applied:false, e.g. patient-reported) are skipped. node --test test/opd-voice.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const OPD = require("../opd-emr.js");
const { _voiceMerge, VOICE_MAP } = OPD;

// shape an SMD_EMRMAP-style update
const u = (field, value, applied = true) => ({ field, value, applied });

test("maps engine field ids to opd-emr GHIS names + coerces values", () => {
  const r = _voiceMerge({}, {}, [
    u("bpSys", 100), u("bpDia", 60), u("pulse", 88), u("temp", 101),
    u("tenderness", "No"), u("pallor", false), u("oedema", true),
    u("cardiacSounds", "S1 S2 heard, normal"), u("provisionalDx", "viral fever")
  ]);
  assert.equal(r.vals.BP_SYS, "100");
  assert.equal(r.vals.BP_dia, "60");
  assert.equal(r.vals.Pulse, "88");
  assert.equal(r.vals.Temp, "101");
  assert.equal(r.vals.tenderness_yesNo, "N", "yesno coerced to N");
  assert.equal(r.vals.pallor, "false", "check coerced to false string");
  assert.equal(r.vals.Oedema, "true", "check coerced to true string");
  assert.equal(r.vals.cardiac_sound, "S1 S2 heard, normal");
  assert.equal(r.vals.provisional_diagnosis, "viral fever");
  assert.ok(r.filled.includes("BP_SYS") && r.filled.includes("tenderness_yesNo"));
});

test("engine findings opd-emr can't save are DROPPED, never guessed", () => {
  // loc/orientation/murmurs/breathSounds/abdoShape are omitted from opd-emr's ASSESS_SCHEMA
  const r = _voiceMerge({}, {}, [u("loc", "Conscious"), u("murmurs", "No"), u("breathSounds", "Vesicular"), u("temp", 99)]);
  assert.deepEqual(r.dropped.sort(), ["breathSounds", "loc", "murmurs"]);
  assert.equal(r.vals.Temp, "99");                 // the one mappable field still lands
  assert.equal(Object.keys(VOICE_MAP).includes("loc"), false, "loc intentionally unmapped");
});

test("doctor-edited field is never overwritten (conflict surfaced)", () => {
  const r = _voiceMerge({ BP_SYS: "130" }, { BP_SYS: true }, [u("bpSys", 100), u("bpDia", 60)]);
  assert.equal(r.vals.BP_SYS, "130", "manual value preserved");
  assert.equal(r.vals.BP_dia, "60", "untouched field still fills");
  assert.deepEqual(r.conflicts, [{ name: "BP_SYS", incoming: 100 }]);
});

test("map-gated updates (applied:false) are skipped", () => {
  const r = _voiceMerge({}, {}, [u("bpSys", 150, false)]);   // e.g. patient-reported, dropped upstream
  assert.equal(r.vals.BP_SYS, undefined);
  assert.equal(r.filled.length, 0);
});

test("maps all scribe consultation fields to GHIS columns", () => {
  const r = _voiceMerge({}, {}, [
    u("cc", "Fever x 3 days, cough x 2 days"),
    u("presentHx", "High grade fever with chills"),
    u("pastHx", "Appendectomy 2018"),
    u("dm", "Yes"),
    u("dmDetails", "T2DM on Metformin 500mg BD"),
    u("htn", "Yes"),
    u("htnDetails", "HTN on Telma 40mg OD"),
    u("cardiac", "No"),
    u("cardiacDetails", "None"),
    u("asthma", "Yes"),
    u("asthmaDetails", "Mild intermittent, inhaler PRN"),
    u("tb", "No"),
    u("tbDetails", "No history"),
    u("thyroid", "Yes"),
    u("thyroidDetails", "Hypothyroid on Thyronorm 50mcg"),
    u("epilepsy", "No"),
    u("epilepsyDetails", "None"),
    u("comorbidsNote", "CKD Stage 2"),
    u("allergies", "Penicillin - rash"),
    u("habits", "Yes"),
    u("habitsDetails", "Smoker 5 pack-years"),
    u("systemicExam", "Chest clear, S1 S2 normal, P/A soft"),
    u("tenderness", "Yes"),
    u("tendernessDetails", "Right iliac fossa tenderness"),
    u("abdoMass", "No"),
    u("abdoMassDetails", "No palpable mass"),
    u("provisionalDx", "Acute appendicitis"),
    u("managementPlan", "NPO, IV fluids, surgical consult")
  ]);

  assert.equal(r.vals.Chief_complaints_duration, "Fever x 3 days, cough x 2 days");
  assert.equal(r.vals.History_present_illness, "High grade fever with chills");
  assert.equal(r.vals.History_past_illness, "Appendectomy 2018");
  assert.equal(r.vals.Diabetes_yesNo, "Y");
  assert.equal(r.vals.Diabetes_details, "T2DM on Metformin 500mg BD");
  assert.equal(r.vals.Hypertension_yesNo, "Y");
  assert.equal(r.vals.Hypertension_details, "HTN on Telma 40mg OD");
  assert.equal(r.vals.Cardiac_yesNo, "N");
  assert.equal(r.vals.Cardiac_details, "None");
  assert.equal(r.vals.Bronchial_yesNo, "Y");
  assert.equal(r.vals.Bronchial_details, "Mild intermittent, inhaler PRN");
  assert.equal(r.vals.Tuberculosis_yesNo, "N");
  assert.equal(r.vals.Tuberculosis_details, "No history");
  assert.equal(r.vals.Thyroid_yesNo, "Y");
  assert.equal(r.vals.Thyroid_details, "Hypothyroid on Thyronorm 50mcg");
  assert.equal(r.vals.Epilepsy_yesNo, "N");
  assert.equal(r.vals.Epilepsy_details, "None");
  assert.equal(r.vals.Others_details, "CKD Stage 2");
  assert.equal(r.vals.Known_allergies_details, "Penicillin - rash");
  assert.equal(r.vals.Habitat_addiction_yesno, "Y");
  assert.equal(r.vals.Habitat_addiction_others, "Smoker 5 pack-years");
  assert.equal(r.vals.sys_examination, "Chest clear, S1 S2 normal, P/A soft");
  assert.equal(r.vals.tenderness_yesNo, "Y");
  assert.equal(r.vals.tenderness_details, "Right iliac fossa tenderness");
  assert.equal(r.vals.palpable_mass_yesNo, "N");
  assert.equal(r.vals.palpable_mass_details, "No palpable mass");
  assert.equal(r.vals.provisional_diagnosis, "Acute appendicitis");
  assert.equal(r.vals.management_plan, "NPO, IV fluids, surgical consult");
});

test("populated accordion sections auto-expand in render", () => {
  const vals = {
    Chief_complaints_duration: "Headache",
    Diabetes_yesNo: "Y",
    Diabetes_details: "T2DM x 5y",
    Temp: "101",
    sys_examination: "P/A soft"
  };
  const html = OPD._render({ tab: "assess", writeOn: true, assessLoaded: true, patient: { mrn: "MR10" }, assessVals: vals });
  // Check that sections with data are rendered with <details class="oe-acc" open>
  const openCount = (html.match(/<details class="oe-acc" open>/g) || []).length;
  // History (i===0) + Co-morbid + Vitals + Examination should all be open
  assert.ok(openCount >= 3, `Expected at least 3 open sections, got ${openCount}`);
  assert.match(html, /T2DM x 5y/);
  assert.match(html, /value="101"/);
});

test("maps prior treatment, family history, lmp, immunization, and nutritional state", () => {
  const r = _voiceMerge({}, {}, [
    u("treatmentReceived", "Metformin 500mg BD, Telma 40mg OD"),
    u("familyHistory", "Yes"),
    u("familyDiabetes", "Yes"),
    u("familyHtn", "No"),
    u("familyHeart", "Yes"),
    u("familyCancer", "No"),
    u("familyTb", "No"),
    u("familyAsthma", "No"),
    u("familyDetails", "Father had CAD at 50"),
    u("lmp", "12-Aug-2026"),
    u("immunization", "Up to date as per IAP"),
    u("nutrition", "Moderately nourished"),
    u("hydration", "Well hydrated")
  ]);

  assert.equal(r.vals["val.treatment_received"], "Metformin 500mg BD, Telma 40mg OD");
  assert.equal(r.vals.Family_history_yesno, "Y");
  assert.equal(r.vals.Family_history_diabetics, "true");
  assert.equal(r.vals.Family_history_hypertension, "false");
  assert.equal(r.vals.Family_history_Heart, "true");
  assert.equal(r.vals.Family_history_cancer, "false");
  assert.equal(r.vals.Family_history_TB, "false");
  assert.equal(r.vals.Family_history_asthma, "false");
  assert.equal(r.vals.Family_history_othersdetails, "Father had CAD at 50");
  assert.equal(r.vals.LMP, "12-Aug-2026");
  assert.equal(r.vals.immunization_status, "Up to date as per IAP");
  assert.equal(r.vals.Nutrtion, "Moderately nourished");
  assert.equal(r.vals.hydration, "Well hydrated");
});

test("auto-calculates BMI and Mosteller BSA from height and weight", () => {
  const calc = OPD._calcBmiBsa(170, 68);
  assert.equal(calc.bmi, "23.5");
  assert.equal(calc.bsa, "1.79");

  // _voiceMerge computes BMI & BSA automatically
  const r = _voiceMerge({}, {}, [u("heightCm", 170), u("weightKg", 68)]);
  assert.equal(r.vals.Height, "170");
  assert.equal(r.vals.Weight, "68");
  assert.equal(r.vals.BMI, "23.5");
  assert.equal(r.vals.bsa, "1.79");
  assert.ok(r.filled.includes("BMI") && r.filled.includes("bsa"));
});

test("detects drug-allergy conflicts against prescribed management plans", () => {
  const conf1 = OPD._checkAllergyConflicts("Known allergy to Penicillin (anaphylaxis)", "Plan: start tab Augmentin 625mg BD x 5 days");
  assert.equal(conf1.length, 1);
  assert.equal(conf1[0].allergy, "Penicillin class");
  assert.equal(conf1[0].drug, "augmentin");

  const conf2 = OPD._checkAllergyConflicts("Sulfa drugs - rash", "Rx Bactrim DS 1 tab BD");
  assert.equal(conf2.length, 1);
  assert.equal(conf2[0].drug, "bactrim");

  const safe = OPD._checkAllergyConflicts("Penicillin allergy", "Plan: tab Cefixime 200mg BD and tab Paracetamol 650mg TDS");
  assert.equal(safe.length, 0);
});

test("detects critical physiological red flags and triage emergencies", () => {
  const shock = OPD._detectTriageRedFlags({ BP_SYS: "75", BP_dia: "45", Pulse: "110" });
  assert.ok(shock.some(f => f.includes("Hypotension / Shock")));

  const tachy = OPD._detectTriageRedFlags({ Pulse: "155" });
  assert.ok(tachy.some(f => f.includes("Severe Tachycardia")));

  const stemi = OPD._detectTriageRedFlags({ provisional_diagnosis: "Anterior wall STEMI" });
  assert.ok(stemi.some(f => f.includes("Acute Coronary Event / STEMI")));

  const normal = OPD._detectTriageRedFlags({ BP_SYS: "120", BP_dia: "80", Pulse: "76", respiratory: "16", Temp: "98.4" });
  assert.equal(normal.length, 0);
});

test("generates bilingual patient visit summary with vitals and warning advice", () => {
  const st = {
    patient: { name: "Ramesh Rao", mrn: "MR1001" },
    author: "Dr. Rao",
    assessVals: {
      Chief_complaints_duration: "Fever x 3 days",
      History_present_illness: "High fever with chills",
      Temp: "101.2",
      BP_SYS: "120",
      BP_dia: "80",
      Pulse: "88",
      Height: "170",
      Weight: "68",
      BMI: "23.5",
      Known_allergies_details: "Penicillin",
      "val.treatment_received": "Paracetamol 650mg",
      provisional_diagnosis: "Viral fever",
      management_plan: "Rx: Tab Paracetamol 650mg TDS\nAdvice: Hydration, rest"
    }
  };
  const html = OPD._visitSummaryHtml(st);
  assert.match(html, /Ramesh Rao/);
  assert.match(html, /Temp: 101\.2°F/);
  assert.match(html, /BP: 120\/80 mmHg/);
  assert.match(html, /BMI: 23\.5/);
  assert.match(html, /Penicillin/);
  assert.match(html, /Paracetamol 650mg/);
  assert.match(html, /అత్యవసర సంకేతాలు/); // Telugu warning signs
});


