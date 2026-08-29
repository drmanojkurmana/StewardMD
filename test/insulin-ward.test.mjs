/* insulin-ward.test.mjs - the ward workflows: titration, correction scale, inpatient
 * initiation, NPO, steroid cover, IV->SC transition, premix.
 * These are the calculations a resident actually opens the app to do. Every expected
 * value below traces to the guideline quoted in the function's `refs`.
 * Run: node --test test/insulin-ward.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../insulin-engine.js");

/* ── Basal titration (ADA 2-by-3 rule) ─────────────────────────────────────── */

test("basal titration: fasting above target increases by 2 units", () => {
  const r = E.basalTitration({ currentDose: 20, fastingGlucose: 190, weightKg: 70 });
  assert.equal(r.action, "INCREASE");
  assert.equal(r.rounded, 22);
  assert.equal(r.changeUnits, 2);
});

test("basal titration: in-target holds", () => {
  const r = E.basalTitration({ currentDose: 20, fastingGlucose: 110, weightKg: 70 });
  assert.equal(r.action, "HOLD");
  assert.equal(r.rounded, 20);
});

test("basal titration: a single low overrides a high mean - never titrate up through a hypo", () => {
  // mean of 190 and 60 is 125 (in target), but there is a hypoglycaemic reading
  const r = E.basalTitration({ currentDose: 20, fastingValues: [190, 60], weightKg: 70 });
  assert.equal(r.action, "REDUCE");
  assert.equal(r.rounded, 18);                       // -10%
  assert.match(r.clinicalNotes[0], /Hypoglycaemia/i);
});

test("basal titration: severe low (<54) cuts 20%, not 10%", () => {
  const r = E.basalTitration({ currentDose: 20, fastingValues: [50], weightKg: 70 });
  assert.equal(r.rounded, 16);
});

test("basal titration: overbasalization above 0.5 u/kg/day says intensify, not increase", () => {
  // 70 kg, already on 36 u -> increasing to 38 is 0.54 u/kg/day
  const r = E.basalTitration({ currentDose: 36, fastingGlucose: 200, weightKg: 70 });
  assert.equal(r.action, "INCREASE");
  assert.equal(r.overbasalization, true);
  assert.match(r.clinicalNotes.join(" "), /OVERBASALIZATION/);
  assert.match(r.clinicalNotes.join(" "), /prandial|GLP-1/);
});

test("basal titration: percent method uses 10% steps", () => {
  const r = E.basalTitration({ currentDose: 40, fastingGlucose: 200, weightKg: 90, method: "percent" });
  assert.equal(r.rounded, 44);
});

test("basal titration: needs a current dose and a fasting value", () => {
  assert.equal(E.basalTitration({ fastingGlucose: 180 }).result, null);
  assert.equal(E.basalTitration({ currentDose: 20 }).result, null);
});

/* ── Correction scale ──────────────────────────────────────────────────────── */

test("correction scale: built from the patient's own TDD, rising by band", () => {
  const r = E.correctionScale({ tdd: 40, target: 150 });   // ISF = 1800/40 = 45
  assert.equal(r.isf, 45);
  assert.equal(r.rows.length, 6);
  // bands must be non-decreasing and start at 0 or more
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].units >= r.rows[i - 1].units);
  assert.equal(r.rows[0].label, "150 to 199");
});

test("correction scale: capped per dose", () => {
  const r = E.correctionScale({ tdd: 120, target: 150, maxPerDose: 6 });
  assert.ok(r.rows.every(x => x.units <= 6));
  assert.ok(r.rows.some(x => x.cappedAt === 6));
});

test("correction scale: resistance preset changes the estimated TDD", () => {
  const sens = E.correctionScale({ weightKg: 70, resistance: "sensitive" });
  const res = E.correctionScale({ weightKg: 70, resistance: "resistant" });
  assert.ok(res.tddUsed > sens.tddUsed);
  assert.ok(res.rows[3].units > sens.rows[3].units);   // resistant patient needs more
});

test("correction scale: warns that correction-only without basal is discouraged", () => {
  const r = E.correctionScale({ tdd: 40 });
  assert.match(r.clinicalNotes.join(" "), /without basal/i);
});

/* ── Inpatient initiation (RABBIT-2) ───────────────────────────────────────── */

test("inpatient init: 0.4 u/kg for admission glucose at or below 200", () => {
  const r = E.inpatientInit({ weightKg: 70, glucose: 180 });
  assert.equal(r.factorUsed, 0.4);
  assert.equal(r.tdd, 28);
  assert.equal(r.basal, 14);
  assert.equal(r.mealBolusEach, 5);      // 14/3 = 4.67 -> 5
});

test("inpatient init: 0.5 u/kg above 200", () => {
  assert.equal(E.inpatientInit({ weightKg: 70, glucose: 260 }).factorUsed, 0.5);
});

test("inpatient init: reduced to 0.3 u/kg for age >=70 or creatinine >=2.0", () => {
  assert.equal(E.inpatientInit({ weightKg: 70, glucose: 260, age: 74 }).factorUsed, 0.3);
  assert.equal(E.inpatientInit({ weightKg: 70, glucose: 260, creatinine: 2.4 }).factorUsed, 0.3);
  assert.equal(E.inpatientInit({ weightKg: 70, glucose: 260, age: 74 }).reducedDose, true);
});

test("inpatient init: carries the inpatient target and the oral-agent warning", () => {
  const n = E.inpatientInit({ weightKg: 70, glucose: 180 }).clinicalNotes.join(" ");
  assert.match(n, /140 to 180/);
  assert.match(n, /SGLT2/);
});

/* ── NPO ───────────────────────────────────────────────────────────────────── */

test("NPO: type 1 keeps the full basal", () => {
  const r = E.npoRegimen({ basalDose: 20, type1: true });
  assert.equal(r.basal, 20);
  assert.equal(r.prandial, 0);
  assert.match(r.assumptions.join(" "), /Stopping basal in type 1 causes ketoacidosis/i);
});

test("NPO: type 2 basal reduced to 80%, or 50% with hypoglycaemia risk", () => {
  assert.equal(E.npoRegimen({ basalDose: 20 }).basal, 16);
  assert.equal(E.npoRegimen({ basalDose: 20, hypoRisk: true }).basal, 10);
});

test("NPO: derives basal from TDD when only a TDD is known", () => {
  assert.equal(E.npoRegimen({ tdd: 40 }).previousBasal, 20);
});

test("NPO: prandial is always held and correction continues", () => {
  const r = E.npoRegimen({ basalDose: 20 });
  assert.equal(r.prandial, 0);
  assert.match(r.correctionFrequency, /6 hours/);
});

/* ── Steroid cover ─────────────────────────────────────────────────────────── */

test("steroid cover: 40 mg prednisolone in a 70 kg patient", () => {
  const r = E.steroidCover({ weightKg: 70, steroid: "prednisolone", steroidMg: 40 });
  // 40 mg pred-equiv -> 0.1 x (40/10) = 0.4 u/kg/day, at the cap -> 70 x 0.4 = 28 u
  assert.equal(r.prednisoloneEquivalent, 40);
  assert.equal(r.perKgDay, 0.4);
  assert.equal(r.nph, 28);
  assert.equal(r.cappedAtMax, true);
});

test("steroid cover: converts dexamethasone to prednisolone equivalent", () => {
  // 6 mg dexamethasone x (5 / 0.75) = 40 mg prednisolone equivalent
  const r = E.steroidCover({ weightKg: 60, steroid: "dexamethasone", steroidMg: 6 });
  assert.equal(r.prednisoloneEquivalent, 40);
  assert.match(r.assumptions.join(" "), /36 to 72/);   // long-acting caveat
});

test("steroid cover: small dose stays below the cap", () => {
  const r = E.steroidCover({ weightKg: 70, steroid: "prednisolone", steroidMg: 10 });
  assert.equal(r.perKgDay, 0.1);
  assert.equal(r.nph, 7);
  assert.equal(r.cappedAtMax, false);
});

test("steroid cover: insists the insulin tapers with the steroid", () => {
  const n = E.steroidCover({ weightKg: 70, steroidMg: 20 }).clinicalNotes.join(" ");
  assert.match(n, /TAPER/);
});

/* ── IV to subcutaneous ────────────────────────────────────────────────────── */

test("IV to SC: 80% of the extrapolated 24 hour requirement", () => {
  const r = E.ivToSubcut({ avgRatePerHour: 2 });        // 48 u/24h -> 80% = 38.4 -> 38
  assert.equal(r.total24, 48);
  assert.equal(r.tdd, 38);
  assert.equal(r.basal, 19);
});

test("IV to SC: the conservative 60% option", () => {
  assert.equal(E.ivToSubcut({ avgRatePerHour: 2, percent: 0.6 }).tdd, 29);
  assert.equal(E.ivToSubcut({ avgRatePerHour: 2, percent: 60 }).tdd, 29);   // accepts 60 or 0.6
});

test("IV to SC: averages the recent stable rates", () => {
  assert.equal(E.ivToSubcut({ recentRates: [1.5, 2, 2.5] }).infusionRate, 2);
});

test("IV to SC: the overlap instruction is present and unmissable", () => {
  const n = E.ivToSubcut({ avgRatePerHour: 2 }).clinicalNotes.join(" ");
  assert.match(n, /2 TO 4 HOURS BEFORE STOPPING/);
});

/* ── Premix ────────────────────────────────────────────────────────────────── */

test("premix init: two-thirds morning, one-third evening", () => {
  const r = E.premixInit({ weightKg: 60 });            // 0.3 x 60 = 18
  assert.equal(r.tdd, 18);
  assert.equal(r.morning, 12);
  assert.equal(r.evening, 6);
  assert.equal(r.morning + r.evening, r.tdd);
});

test("premix init: accepts a known TDD", () => {
  const r = E.premixInit({ tdd: 30 });
  assert.equal(r.morning, 20);
  assert.equal(r.evening, 10);
});

test("premix titration: morning judged on pre-dinner, evening on fasting", () => {
  const r = E.premixTitration({ morning: 20, evening: 10, preDinner: 200, fasting: 100 });
  assert.equal(r.morning, 22);     // pre-dinner high -> morning up
  assert.equal(r.evening, 10);     // fasting in target -> evening unchanged
});

test("premix titration: a hypo reduces the responsible injection by 20%", () => {
  const r = E.premixTitration({ morning: 20, evening: 10, fasting: 60, preDinner: 120 });
  assert.equal(r.evening, 8);      // fasting low -> evening premix down 20%
  assert.equal(r.morning, 20);
});

/* ── Cross-cutting: every ward function must cite a guideline ──────────────── */

test("every ward workflow carries a pinned reference", () => {
  const results = [
    E.basalTitration({ currentDose: 20, fastingGlucose: 190, weightKg: 70 }),
    E.correctionScale({ tdd: 40 }),
    E.inpatientInit({ weightKg: 70, glucose: 180 }),
    E.npoRegimen({ basalDose: 20 }),
    E.steroidCover({ weightKg: 70, steroidMg: 20 }),
    E.ivToSubcut({ avgRatePerHour: 2 }),
    E.premixInit({ weightKg: 60 }),
    E.premixTitration({ morning: 20, evening: 10, fasting: 100 })
  ];
  for (const r of results) {
    assert.ok(r.refs && r.refs.length, "every ward result must cite its source");
    assert.ok(/ADA|RABBIT|Endocrine Society|glucocorticoid/i.test(r.refs.join(" ")));
    assert.ok(r.formula, "every ward result must show its formula");
  }
});

test("ward functions fail closed on missing input, never with a guessed number", () => {
  assert.equal(E.correctionScale({}).result, null);
  assert.equal(E.inpatientInit({}).result, null);
  assert.equal(E.npoRegimen({}).result, null);
  assert.equal(E.steroidCover({ weightKg: 70 }).result, null);
  assert.equal(E.ivToSubcut({}).result, null);
  assert.equal(E.premixInit({}).result, null);
});

/* ── Diabetes type drives the scale and what is allowed ────────────────────── */

test("dx type sets the sensitivity band: T1 sensitive, stress/steroid resistant", () => {
  const t1 = E.correctionScale({ weightKg: 70, dxType: "t1" });
  const t2 = E.correctionScale({ weightKg: 70, dxType: "t2" });
  const stress = E.correctionScale({ weightKg: 70, dxType: "stress" });
  assert.equal(t1.resistance, "sensitive");
  assert.equal(t2.resistance, "usual");
  assert.equal(stress.resistance, "resistant");
  // a resistant patient must get MORE insulin per band than a sensitive one
  assert.ok(stress.rows[3].units > t2.rows[3].units);
  assert.ok(t2.rows[3].units > t1.rows[3].units);
});

test("correction-only is BLOCKED in type 1 and secondary, ACCEPTABLE in stress", () => {
  const t1 = E.correctionScale({ weightKg: 70, dxType: "t1" });
  assert.equal(t1.correctionOnly, "never");
  assert.ok(t1.blocked, "type 1 must carry a block message for a scale-alone regimen");
  assert.match(t1.clinicalNotes[0], /never appropriate in type 1/i);

  const sec = E.correctionScale({ weightKg: 70, dxType: "secondary" });
  assert.equal(sec.correctionOnly, "never");
  assert.ok(sec.blocked);

  const stress = E.correctionScale({ weightKg: 70, dxType: "stress" });
  assert.equal(stress.correctionOnly, "acceptable");
  assert.equal(stress.blocked, null);
  assert.match(stress.clinicalNotes[0], /IS acceptable|recognised exception/i);
});

test("stress hyperglycaemia insists on an HbA1c to exclude undiagnosed diabetes", () => {
  const s = E.correctionScale({ weightKg: 70, dxType: "stress" });
  assert.match(s.clinicalNotes.join(" "), /HbA1c/);
  assert.match(s.clinicalNotes.join(" "), /6\.5%/);
});

test("an explicit resistance overrides the diagnosis default", () => {
  assert.equal(E.correctionScale({ weightKg: 70, dxType: "t1", resistance: "resistant" }).resistance, "resistant");
});

test("dxGuidance is safe for an unknown or skipped type", () => {
  const g = E.dxGuidance(null);
  assert.equal(g.resistance, "usual");
  assert.deepEqual(g.notes, []);
  assert.deepEqual(g.suggest, []);
});

test("every dx type carries notes, a band and suggested workflows", () => {
  for (const id of Object.keys(E.DX_TYPES)) {
    const d = E.DX_TYPES[id];
    assert.ok(d.label && d.detail, id + " needs a label and detail");
    assert.ok(["sensitive", "usual", "resistant"].includes(d.resistance), id + " needs a band");
    assert.ok(d.notes.length >= 3, id + " needs real guidance");
    assert.ok(d.suggest.length, id + " needs suggested workflows");
  }
  // the two insulin-deficient types must never permit correction-only or a stopped basal
  assert.equal(E.DX_TYPES.t1.correctionOnly, "never");
  assert.equal(E.DX_TYPES.secondary.correctionOnly, "never");
  assert.equal(E.DX_TYPES.t1.basalMayStop, false);
  assert.equal(E.DX_TYPES.secondary.basalMayStop, false);
});

/* ── Enteral / parenteral nutrition ────────────────────────────────────────── */

test("continuous feed: nutritional insulin from carbohydrate plus weight-based basal", () => {
  const r = E.nutritionInsulin({ carbGramsPerDay: 240, weightKg: 70 });
  assert.equal(r.nutritional, 20);        // 240 / 12
  assert.equal(r.basal, 14);              // 70 x 0.2
  assert.equal(r.rounded, 34);
});

test("bolus feeds split the nutritional insulin across the feeds", () => {
  assert.equal(E.nutritionInsulin({ carbGramsPerDay: 240, feed: "bolus", feedsPerDay: 4 }).perFeed, 5);
});

test("TPN adds insulin to the bag at 0.1 u per gram of dextrose", () => {
  assert.equal(E.nutritionInsulin({ dextroseGrams: 200, feed: "tpn", weightKg: 70 }).inBag, 20);
});

test("nutrition carries the feed-interruption warning, which is the actual killer", () => {
  const n = E.nutritionInsulin({ carbGramsPerDay: 240, weightKg: 70 }).clinicalNotes.join(" ");
  assert.match(n, /FEED STOPPING IS THE DANGER/i);
  assert.match(n, /10% dextrose/);
});

/* ── Perioperative ─────────────────────────────────────────────────────────── */

test("perioperative: 80% basal in type 1, 75% otherwise, prandial always held", () => {
  assert.equal(E.periopRegimen({ basalDose: 20, dxType: "t1" }).basal, 16);
  assert.equal(E.periopRegimen({ basalDose: 20, dxType: "t2" }).basal, 15);
  assert.equal(E.periopRegimen({ basalDose: 20 }).prandial, 0);
});

test("perioperative: the SGLT2 euglycaemic DKA warning is present and specific", () => {
  const n = E.periopRegimen({ basalDose: 20 }).clinicalNotes.join(" ");
  assert.match(n, /SGLT2 INHIBITORS 3 TO 4 DAYS/i);
  assert.match(n, /euglycaemic ketoacidosis/i);
  assert.match(n, /100 to 180/);
});

/* ── Discharge ─────────────────────────────────────────────────────────────── */

test("discharge: home basal is 80% of the inpatient dose", () => {
  assert.equal(E.dischargeRegimen({ inpatientBasal: 30 }).homeBasal, 24);
});

test("discharge: the regimen follows HbA1c, and type 1 is always basal-bolus", () => {
  assert.match(E.dischargeRegimen({ inpatientBasal: 20, hba1c: 6.5 }).plan, /oral agents/i);
  assert.match(E.dischargeRegimen({ inpatientBasal: 20, hba1c: 8 }).plan, /basal insulin/i);
  assert.match(E.dischargeRegimen({ inpatientBasal: 20, hba1c: 11 }).plan, /Basal-bolus|GLP-1/i);
  assert.match(E.dischargeRegimen({ inpatientBasal: 20, hba1c: 6.5, dxType: "t1" }).plan, /Basal-bolus \(mandatory\)/);
});

test("discharge: education checklist and the 15-15 rule are present", () => {
  const n = E.dischargeRegimen({ inpatientBasal: 20 }).clinicalNotes.join(" ");
  assert.match(n, /15-15/);
  assert.match(n, /teach-back/i);
  assert.match(n, /1 to 2 weeks/);
});

/* ── Sick day ──────────────────────────────────────────────────────────────── */

test("sick day: extra insulin is 10-20% of the total daily dose", () => {
  const r = E.sickDayRules({ tdd: 40 });
  assert.equal(r.extraLow, 4);
  assert.equal(r.extraHigh, 8);
});

test("sick day: never-stop-insulin is stated, and T1 gets routine ketone testing", () => {
  assert.match(E.sickDayRules({ tdd: 40, dxType: "t1" }).clinicalNotes.join(" "), /NEVER STOP INSULIN/i);
  assert.match(E.sickDayRules({ tdd: 40, dxType: "t1" }).clinicalNotes.join(" "), /ketones every 4 hours/i);
  assert.match(E.sickDayRules({ tdd: 40, dxType: "t2" }).clinicalNotes.join(" "), /ketones if glucose goes above 250/i);
});

test("sick day: red-flag list tells the patient when to come in", () => {
  const n = E.sickDayRules({ tdd: 40 }).clinicalNotes.join(" ");
  assert.match(n, /GO TO HOSPITAL/i);
  assert.match(n, /vomiting/i);
});

test("new workflows cite a guideline and fail closed on missing input", () => {
  const rs = [
    E.nutritionInsulin({ carbGramsPerDay: 240, weightKg: 70 }),
    E.periopRegimen({ basalDose: 20 }),
    E.dischargeRegimen({ inpatientBasal: 20 }),
    E.sickDayRules({ tdd: 40 })
  ];
  for (const r of rs) {
    assert.ok(r.refs && r.refs.length && /ADA/.test(r.refs.join(" ")));
    assert.ok(r.formula);
  }
  assert.equal(E.nutritionInsulin({}).result, null);
  assert.equal(E.periopRegimen({}).result, null);
  assert.equal(E.dischargeRegimen({}).result, null);
  assert.equal(E.sickDayRules({}).result, null);
});
