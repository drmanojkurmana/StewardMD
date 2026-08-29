/* insulin-scenarios.test.mjs - CLINICAL ACCEPTANCE.
 * Not unit tests of functions: whole bedside cases, written the way a diabetologist would
 * probe a new dosing tool before letting residents near it. Each case states the clinical
 * expectation in words, then asserts the module actually behaves that way.
 * Run: node --test test/insulin-scenarios.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const E = require(join(ROOT, "insulin-engine.js"));
const S = require(join(ROOT, "insulin-safety.js"));
const A = require(join(ROOT, "insulin-ask.js"));

const crit = w => w.filter(x => x.severity === "critical");
const ids = w => w.map(x => x.id);

/* ══ 1. Hypoglycaemia: the one that must never go wrong ══ */

test("SCENARIO: glucose 55 - must refuse a correction and hard-stop", () => {
  const r = E.correctionDose({ glucose: 55, target: 120, isf: 50, increment: 1 });
  assert.equal(r.rounded, 0, "no correction insulin at a glucose of 55");
  const w = S.evaluate({}, { glucose: 55 }, r);
  assert.ok(crit(w).length, "a hypoglycaemic glucose must be a CRITICAL interrupt");
  assert.equal(crit(w)[0].id, "hypoglycemia");
  // The warning must TREAT, not merely withhold. Found in clinical review 2026-08-29: it
  // previously said only "treat the low first", which tells a resident nothing at 3am.
  const d = crit(w)[0].detail;
  assert.match(d, /15 g of fast-acting carbohydrate/i);
  assert.match(d, /recheck in 15 minutes/i);
  assert.match(d, /Do NOT omit the next basal/i, "omitting basal after a hypo causes rebound DKA in type 1");
});

test("SCENARIO: glucose 45 - severe hypoglycaemia must add the parenteral rescue", () => {
  const w = S.evaluate({}, { glucose: 45 }, { rounded: 0 });
  const d = crit(w).find(x => x.id === "hypoglycemia").detail;
  assert.match(d, /25% dextrose|glucagon/i, "below 54 the patient may not be able to swallow");
});

test("SCENARIO: a correction scale must carry its own stop conditions", () => {
  // Found in clinical review: the top band handed out 8 u at 450 with no ketone prompt.
  const notes = E.correctionScale({ tdd: 40 }).clinicalNotes.join(" ");
  assert.match(notes, /CHECK KETONES if the glucose is above 300/i);
  assert.match(notes, /STOP the scale and assess for ketoacidosis above 400/i);
  assert.match(notes, /Do not repeat a correction inside 4 hours/i, "stacking guard travels with the chart");
});

test("SCENARIO: glucose 90 with a target of 120 - at or below target gives nothing", () => {
  assert.equal(E.correctionDose({ glucose: 90, target: 120, isf: 50, increment: 1 }).rounded, 0);
});

test("SCENARIO: eating a meal while hypoglycaemic - meal cover kept, correction not", () => {
  // Clinically: treat the low, but the carbohydrate about to be eaten still needs covering.
  const r = E.combinedDose({ carbs: 60, icr: 10, glucose: 60, target: 120, isf: 50, iob: 0, increment: 1 });
  assert.equal(r.correctionComponent, 0, "no correction below target");
  assert.equal(r.mealComponent, 6, "the meal is still covered");
  assert.ok(crit(S.evaluate({}, { glucose: 60 }, r)).length, "and it still hard-stops for review");
});

/* ══ 2. Hyperglycaemic emergencies ══ */

test("SCENARIO: glucose 480 - must route to a DKA/HHS work-up, not a routine bolus", () => {
  const r = E.correctionDose({ glucose: 480, target: 140, isf: 50, increment: 1 });
  const w = S.evaluate({}, { glucose: 480 }, r);
  assert.ok(crit(w).length, "above 400 must be critical");
  assert.ok(ids(w).includes("critical_hyper"));
  const d = w.find(x => x.id === "critical_hyper").detail;
  assert.match(d, /ketones/i);
  assert.match(d, /pH|bicarbonate/i);
});

test("SCENARIO: DKA - fixed-rate infusion, no bolus, potassium gate, no SC correction", () => {
  const r = E.dkaInsulin({ weightKg: 70 });
  assert.equal(r.rounded, 7, "0.1 u/kg/h in a 70 kg adult");
  assert.equal(r.unit, "units/hour");
  const notes = r.assumptions.concat(r.clinicalNotes).join(" ");
  assert.match(notes, /No initial intravenous bolus/i);
  assert.match(notes, /potassium.*3\.3/i, "the K+ gate must be stated");
  assert.match(notes, /fluid resuscitation/i);
  // and the routine correction path must refuse DKA outright
  const routed = E.firstDoseCorrection({ glucose: 450, target: 140, isf: 50, ctx: { dka: true } });
  assert.equal(routed.result, null);
  assert.match(routed.routing, /DKA\/HHS protocol/);
});

test("SCENARIO: paediatric DKA - lower rate option and the cerebral oedema warning", () => {
  const r = E.dkaInsulin({ weightKg: 30, ratePerKg: 0.05, paeds: true });
  assert.equal(r.rounded, 1.5);
  assert.match(r.clinicalNotes.join(" "), /cerebral oedema/i);
});

/* ══ 3. Pregnancy ══ */

test("SCENARIO: GDM in the third trimester - 0.9 u/kg/day and the tighter targets", () => {
  const r = E.basalInitiation({ weightKg: 70, ctx: { pregnancy: true, trimester: 3 } });
  assert.equal(r.contextFactor, 0.9);
  assert.equal(r.tdd, 63);
  const notes = r.clinicalNotes.join(" ");
  assert.match(notes, /fasting under 95/i);
  assert.match(notes, /1-hour post-prandial under 140/i);
  assert.match(notes, /after delivery/i,
    "the post-partum fall must be flagged - a classic cause of severe hypoglycaemia");
});

test("SCENARIO: pregnancy raises the dose only through a VISIBLE target, never silently", () => {
  // Compare the COMPUTED dose, not the rounded one: at glucose 200 both targets round to 2 u
  // (1.6 vs 2.0), so rounding would hide the effect being asserted here.
  const loose = E.correctionDose({ glucose: 200, target: 120, isf: 50, increment: 1 });
  const tight = E.correctionDose({ glucose: 200, target: 100, isf: 50, increment: 1 });
  assert.equal(loose.result, 1.6);
  assert.equal(tight.result, 2, "a tighter target legitimately asks for more insulin");
  assert.ok(tight.result > loose.result);
  // and at a higher glucose the difference survives rounding too
  assert.ok(E.correctionDose({ glucose: 300, target: 100, isf: 50, increment: 1 }).rounded >
            E.correctionDose({ glucose: 300, target: 140, isf: 50, increment: 1 }).rounded);
  assert.equal(E.bolusContextFactor({ pregnancy: true }).factor, 1, "no hidden pregnancy multiplier");
});

/* ══ 4. Renal and hepatic ══ */

test("SCENARIO: eGFR 8 or dialysis - 50%, and never compounded with anything else", () => {
  assert.equal(E.bolusContextFactor({ renal: true, egfr: 8 }).factor, 0.5);
  assert.equal(E.bolusContextFactor({ renal: true, dialysis: true }).factor, 0.5);
  // dialysis + cirrhosis + walking must still be 50%, not 0.5 x 0.75 x 0.75
  assert.equal(E.bolusContextFactor({ renal: true, dialysis: true, hepatic: true, exercise: true }).factor, 0.5);
});

test("SCENARIO: cirrhosis - no invented multiplier, explicit overnight hypo warning", () => {
  assert.equal(E.bolusContextFactor({ hepatic: true }).factor, 1);
  const adv = E.contextAdjust({ hepatic: true }).advisories.join(" ");
  assert.match(adv, /no validated dose multiplier/i);
  assert.match(adv, /overnight|fasting/i);
});

test("SCENARIO: CKD 3 - a 25% reduction that is applied AND explained on screen", () => {
  const r = E.mealBolus({ carbs: 60, icr: 10, increment: 1, ctx: { renal: true, egfr: 30 } });
  assert.equal(r.rounded, 5);                       // 6 u -> x0.75 = 4.5 -> 5
  assert.equal(r.contextApplied[0].id, "renal");
  assert.match(r.steps.map(s => s.expr).join(" "), /renally cleared/i);
});

/* ══ 5. Insulin stacking ══ */

test("SCENARIO: correction 2 h after a 6 u bolus - IOB must come off the correction", () => {
  const iob = E.activeInsulin({ dia: 4, doses: [{ units: 6, minutesAgo: 120 }] });
  assert.equal(iob.result, 3, "linear decay: half of 6 u at 2 h of a 4 h DIA");
  const r = E.correctionDose({ glucose: 250, target: 120, isf: 50, iob: iob.result, increment: 1 });
  assert.equal(r.grossCorrection, 2.6);
  assert.equal(r.rounded, 0, "active insulin already covers it - give nothing");
});

test("SCENARIO: meal + correction with IOB - the meal is never reduced by IOB", () => {
  const r = E.combinedDose({ carbs: 60, icr: 10, glucose: 200, target: 120, isf: 50, iob: 5, increment: 1 });
  assert.equal(r.mealComponent, 6, "carbohydrate cover is untouched");
  assert.equal(r.correctionAfterIob, 0, "the correction is fully absorbed by IOB");
  assert.equal(r.rounded, 6);
  assert.match(r.clinicalNotes.join(" "), /only the meal bolus is advised/i);
});

/* ══ 6. Type 1 invariants ══ */

test("SCENARIO: type 1, nil by mouth - the basal must NOT be reduced or stopped", () => {
  const r = E.npoRegimen({ basalDose: 24, type1: true });
  assert.equal(r.basal, 24);
  assert.match(r.assumptions.join(" "), /ketoacidosis/i);
});

test("SCENARIO: type 1 must never be offered a correction-scale-only regimen", () => {
  const r = E.correctionScale({ weightKg: 70, dxType: "t1" });
  assert.equal(r.correctionOnly, "never");
  assert.ok(r.blocked);
});

test("SCENARIO: type 1 is insulin-SENSITIVE - its scale must be gentler than a stressed patient's", () => {
  const t1 = E.correctionScale({ weightKg: 70, dxType: "t1" });
  const stress = E.correctionScale({ weightKg: 70, dxType: "stress" });
  for (let i = 0; i < t1.rows.length; i++) assert.ok(t1.rows[i].units <= stress.rows[i].units);
  assert.ok(t1.isf > stress.isf, "a sensitive patient has a HIGHER ISF - one unit drops more");
});

/* ══ 7. Titration judgement ══ */

test("SCENARIO: fasting 190 on 20 u glargine - increase by 2, hold 3 days", () => {
  const r = E.basalTitration({ currentDose: 20, fastingGlucose: 190, weightKg: 70 });
  assert.equal(r.rounded, 22);
  assert.match(r.clinicalNotes.join(" "), /3 days/);
});

test("SCENARIO: fasting mostly high but one night at 58 - must REDUCE, not increase", () => {
  const r = E.basalTitration({ currentDose: 30, fastingValues: [210, 195, 58], weightKg: 70 });
  assert.equal(r.action, "REDUCE");
  assert.ok(r.rounded < 30, "a nocturnal hypo outranks a high average every time");
});

test("SCENARIO: 90 kg on 50 u basal, fasting still high - overbasalization, add prandial", () => {
  const r = E.basalTitration({ currentDose: 50, fastingGlucose: 200, weightKg: 90 });
  assert.equal(r.overbasalization, true);
  assert.match(r.clinicalNotes.join(" "), /prandial|GLP-1/);
});

test("SCENARIO: titration is judged on FASTING only, never a post-meal value", () => {
  const r = E.basalTitration({ currentDose: 20, fastingGlucose: 110, weightKg: 70 });
  assert.equal(r.action, "HOLD");
  assert.match(r.clinicalNotes.join(" "), /post-meal reading is a prandial problem/i);
});

/* ══ 8. Steroids ══ */

test("SCENARIO: prednisolone 40 mg, 70 kg - NPH 28 u with the steroid, tapering together", () => {
  const r = E.steroidCover({ weightKg: 70, steroid: "prednisolone", steroidMg: 40 });
  assert.equal(r.nph, 28);
  const notes = r.assumptions.concat(r.clinicalNotes).join(" ");
  assert.match(notes, /AT THE SAME TIME as the steroid/i);
  assert.match(notes, /TAPER/);
  assert.match(notes, /post-lunch|fasting glucose is often normal/i,
    "the falsely reassuring normal fasting is the classic trap");
});

test("SCENARIO: steroid cover is capped, so a huge pulse dose cannot run away", () => {
  const r = E.steroidCover({ weightKg: 70, steroid: "methylprednisolone", steroidMg: 1000 });
  assert.equal(r.perKgDay, 0.4, "capped at 0.4 u/kg/day");
  assert.equal(r.cappedAtMax, true);
});

/* ══ 9. Transitions ══ */

test("SCENARIO: coming off a 2 u/h drip - 80% carry-over and basal BEFORE the drip stops", () => {
  const r = E.ivToSubcut({ avgRatePerHour: 2 });
  assert.equal(r.tdd, 38);
  assert.match(r.clinicalNotes.join(" "), /2 TO 4 HOURS BEFORE STOPPING/,
    "the overlap is the whole safety point of this calculation");
  assert.match(r.clinicalNotes.join(" "), /ketoacidosis/i);
});

test("SCENARIO: surgery - hold SGLT2 for 3-4 days, hold prandial, keep a reduced basal", () => {
  const r = E.periopRegimen({ basalDose: 20, dxType: "t1" });
  assert.equal(r.prandial, 0);
  assert.equal(r.basal, 16, "type 1 keeps 80%, never zero");
  assert.match(r.clinicalNotes.join(" "), /SGLT2 INHIBITORS 3 TO 4 DAYS/i);
  assert.match(r.clinicalNotes.join(" "), /euglycaemic ketoacidosis/i);
});

test("SCENARIO: a tube feed stops unexpectedly - the module must pre-empt the hypo", () => {
  const r = E.nutritionInsulin({ carbGramsPerDay: 240, weightKg: 70 });
  assert.match(r.clinicalNotes.join(" "), /10% dextrose/);
  assert.match(r.clinicalNotes.join(" "), /glucose hourly/i);
});

/* ══ 10. Caps and gross input error ══ */

test("SCENARIO: a weight typo (700 kg) must trip the daily maximum, not return a dose", () => {
  const r = E.basalInitiation({ weightKg: 700, tddFactor: 0.4 });
  const w = S.evaluate({ maxDaily: 100 }, { noGlucose: true }, Object.assign({}, r, { dailyTotal: r.tdd }));
  assert.ok(crit(w).some(x => x.id === "max_daily"));
});

test("SCENARIO: a single bolus above the configured ceiling is critical", () => {
  const r = E.correctionDose({ glucose: 600, target: 120, isf: 20, increment: 1 });
  const w = S.evaluate({ maxBolus: 15 }, { glucose: 600 }, r);
  assert.ok(crit(w).some(x => x.id === "max_bolus"));
});

test("SCENARIO: a nonsense ISF cannot produce a dose", () => {
  assert.equal(E.correctionDose({ glucose: 300, target: 120, isf: 0, increment: 1 }).result, null);
  assert.equal(E.correctionDose({ glucose: 300, target: 120, isf: -50, increment: 1 }).result, null);
});

/* ══ 11. Units ══ */

test("SCENARIO: a value spoken in mmol/L is converted, never read as a catastrophic low", () => {
  assert.equal(A.parse("sugar 14 mmol").slots.glucose, 252);
  assert.equal(A.parse("cbg 22 mmol/l").slots.glucose, 396);
});

/* ══ 12. Paediatrics ══ */

test("SCENARIO: paediatric initiation is staged, specialist-gated, and not for DKA", () => {
  const r = E.pediatricInit({ weightKg: 30, stage: "pubertal" });
  assert.equal(r.tdd, 27, "0.9 u/kg/day at puberty");
  const notes = r.clinicalNotes.join(" ");
  assert.match(notes, /specialist/i);
  assert.match(notes, /Not for diabetic ketoacidosis/i);
});

test("SCENARIO: a child flagged anywhere raises the paediatric caution", () => {
  assert.ok(ids(S.evaluate({ pediatric: true }, { noGlucose: true }, { rounded: 4 })).includes("pediatric"));
  assert.ok(ids(S.evaluate({ age: 9 }, { noGlucose: true }, { rounded: 4 })).includes("pediatric"));
});

/* ══ 13. Discharge and sick day ══ */

test("SCENARIO: discharging on inpatient doses would cause hypos - 80% and an HbA1c-led plan", () => {
  const r = E.dischargeRegimen({ inpatientBasal: 40, hba1c: 10.5 });
  assert.equal(r.homeBasal, 32);
  assert.match(r.plan, /Basal-bolus|GLP-1/);
  assert.match(r.clinicalNotes.join(" "), /15-15/, "hypo education is what prevents readmission");
});

test("SCENARIO: unwell at home - insulin CONTINUES, with extra correction and red flags", () => {
  const r = E.sickDayRules({ tdd: 40, dxType: "t1" });
  assert.equal(r.extraLow, 4);
  assert.equal(r.extraHigh, 8);
  const notes = r.clinicalNotes.join(" ");
  assert.match(notes, /NEVER STOP INSULIN/i);
  assert.match(notes, /GO TO HOSPITAL/i);
});

/* ══ 14. Every recommendation is attributable ══ */

test("SCENARIO: no calculator in the module produces an uncited number", () => {
  const results = [
    E.correctionDose({ glucose: 250, target: 120, isf: 50, increment: 1 }),
    E.mealBolus({ carbs: 60, icr: 10, increment: 1 }),
    E.combinedDose({ carbs: 60, icr: 10, glucose: 250, target: 120, isf: 50, iob: 0, increment: 1 }),
    E.basalInitiation({ weightKg: 70 }),
    E.pediatricInit({ weightKg: 30 }),
    E.dkaInsulin({ weightKg: 70 }),
    E.basalTitration({ currentDose: 20, fastingGlucose: 190, weightKg: 70 }),
    E.correctionScale({ tdd: 40 }),
    E.inpatientInit({ weightKg: 70, glucose: 180 }),
    E.npoRegimen({ basalDose: 20 }),
    E.steroidCover({ weightKg: 70, steroidMg: 40 }),
    E.ivToSubcut({ avgRatePerHour: 2 }),
    E.premixInit({ weightKg: 60 }),
    E.nutritionInsulin({ carbGramsPerDay: 240, weightKg: 70 }),
    E.periopRegimen({ basalDose: 20 }),
    E.dischargeRegimen({ inpatientBasal: 20 }),
    E.sickDayRules({ tdd: 40 }),
    E.isfFromTdd({ tdd: 40 }),
    E.icrFromTdd({ tdd: 40 })
  ];
  for (const r of results) {
    assert.ok(r.refs && r.refs.length, "every recommendation must cite a source");
    assert.ok(r.formula, "every recommendation must show its formula");
    assert.ok(r.steps && r.steps.length, "every recommendation must show its working");
  }
});

test("SCENARIO: no calculator silently rounds a dose far past its computed value", () => {
  for (const g of [150, 175, 199, 210, 260, 305]) {
    const r = E.correctionDose({ glucose: g, target: 120, isf: 45, increment: 1 });
    assert.ok(Math.abs(r.rounded - r.result) <= 0.5, "rounding stays within half a unit at glucose " + g);
  }
});
