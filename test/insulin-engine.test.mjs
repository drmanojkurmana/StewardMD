/* test/insulin-engine.test.mjs - pure insulin dose engine. */
import { test } from "node:test";
import assert from "node:assert/strict";
import E from "../insulin-engine.js";

test("roundDose rounds to increment", () => {
  assert.equal(E.roundDose(4.3, 1), 4);
  assert.equal(E.roundDose(4.3, 0.5), 4.5);
  assert.equal(E.roundDose(4.24, 0.5), 4);
});

test("correctionDose: (glucose - target) / ISF", () => {
  const r = E.correctionDose({ glucose: 250, target: 120, isf: 50, increment: 1 });
  assert.equal(r.result, 2.6);          // (250-120)/50
  assert.equal(r.rounded, 3);
  assert.equal(r.unit, "units");
  assert.ok(r.steps.length >= 2);
  assert.match(r.formula, /glucose/i);
});

test("correctionDose: no correction when glucose <= target", () => {
  const r = E.correctionDose({ glucose: 100, target: 120, isf: 50 });
  assert.equal(r.rounded, 0);
});

test("correctionDose: missing input returns null result", () => {
  const r = E.correctionDose({ glucose: NaN, target: 120, isf: 50 });
  assert.equal(r.result, null);
});

test("mealBolus: carbs / ICR", () => {
  const r = E.mealBolus({ carbs: 60, icr: 10, increment: 1 });
  assert.equal(r.result, 6);
  assert.equal(r.rounded, 6);
  assert.match(r.formula, /carb/i);
});

test("mealBolus: rounds to 0.5", () => {
  const r = E.mealBolus({ carbs: 55, icr: 10, increment: 0.5 });
  assert.equal(r.rounded, 5.5);
});

test("mealBolus: missing input returns null", () => {
  const r = E.mealBolus({ carbs: NaN, icr: 10 });
  assert.equal(r.result, null);
});

test("activeInsulin: linear decay, half-elapsed dose", () => {
  const r = E.activeInsulin({ doses: [{ units: 4, minutesAgo: 120 }], dia: 4, model: "linear" });
  assert.equal(r.result, 2);
});

test("activeInsulin: expired dose contributes 0", () => {
  const r = E.activeInsulin({ doses: [{ units: 6, minutesAgo: 300 }], dia: 4 });
  assert.equal(r.result, 0);
});

test("activeInsulin: sums multiple doses", () => {
  const r = E.activeInsulin({ doses: [
    { units: 4, minutesAgo: 120 },   // 2u remaining
    { units: 2, minutesAgo: 60 }     // 1.5u remaining (75%)
  ], dia: 4 });
  assert.equal(r.result, 3.5);
  assert.equal(r.model, "linear");
});

test("activeInsulin: no doses -> 0", () => {
  const r = E.activeInsulin({ doses: [], dia: 4 });
  assert.equal(r.result, 0);
});

test("combinedDose: meal + correction - IOB", () => {
  const r = E.combinedDose({ carbs: 60, icr: 10, glucose: 250, target: 120, isf: 50, iob: 1, increment: 1 });
  assert.equal(r.mealComponent, 6);
  assert.equal(r.correctionComponent, 2.6);
  assert.equal(r.iobSubtracted, 1);
  assert.equal(r.rounded, 8);
});

test("combinedDose: never negative", () => {
  const r = E.combinedDose({ carbs: 0, icr: 10, glucose: 100, target: 120, isf: 50, iob: 5 });
  assert.equal(r.rounded, 0);
});

test("combinedDose: missing required input returns null", () => {
  const r = E.combinedDose({ carbs: 60, icr: 10, glucose: NaN, target: 120, isf: 50 });
  assert.equal(r.result, null);
});

test("isfFromTdd: 1800 rule", () => {
  const r = E.isfFromTdd({ tdd: 36 });     // 1800/36 = 50
  assert.equal(r.result, 50);
  assert.match(r.formula, /1800/);
});

test("icrFromTdd: 500 rule", () => {
  const r = E.icrFromTdd({ tdd: 50 });     // 500/50 = 10
  assert.equal(r.result, 10);
});

test("basalInitiation: weight-based TDD then 50/50 split", () => {
  const r = E.basalInitiation({ weightKg: 80, tddFactor: 0.4, basalFraction: 0.5, increment: 1 });
  assert.equal(r.tdd, 32);
  assert.equal(r.basal, 16);
  assert.equal(r.mealBolusEach, 5);   // 5.33 rounded to 1u
});

test("basalInitiation: missing weight returns null", () => {
  const r = E.basalInitiation({ weightKg: NaN });
  assert.equal(r.result, null);
});

test("pediatricInit: weight-based TDD with pediatric split", () => {
  const r = E.pediatricInit({ weightKg: 20, stage: "prepubertal" });
  assert.equal(r.tdd, 10);        // 20 x 0.5
  assert.equal(r.basal, 5);       // 50%
  assert.equal(r.mealBolusEach, 1.5); // (10-5)/3 -> 1.5 (0.5 step)
  assert.ok(r.clinicalNotes.some(n => /specialist/i.test(n)));
});

test("pediatricInit: pubertal factor is higher; missing weight null", () => {
  assert.ok(E.pediatricInit({ weightKg: 40, stage: "pubertal" }).tdd > E.pediatricInit({ weightKg: 40, stage: "prepubertal" }).tdd);
  assert.equal(E.pediatricInit({ weightKg: NaN }).result, null);
});

test("dkaInsulin: fixed-rate infusion = weight x rate/kg", () => {
  assert.equal(E.dkaInsulin({ weightKg: 70 }).result, 7);          // 70 x 0.1
  assert.equal(E.dkaInsulin({ weightKg: 70, ratePerKg: 0.05 }).result, 3.5);
  assert.equal(E.dkaInsulin({ weightKg: 70 }).unit, "units/hour");
});

test("dkaInsulin: caps at protocol max, carries K+ + trained-clinician notes + monitoring", () => {
  const r = E.dkaInsulin({ weightKg: 100, maxRate: 6 });
  assert.equal(r.result, 6);      // min(10, 6)
  assert.ok(r.monitoring.length >= 3);
  assert.ok(r.clinicalNotes.some(n => /potassium/i.test(n)));
  assert.ok(r.clinicalNotes.some(n => /TRAINED CLINICIANS/.test(n)));
});

test("dkaInsulin: missing weight returns null", () => {
  assert.equal(E.dkaInsulin({ weightKg: 0 }).result, null);
});

/* ── Regression: IOB must never eat into carbohydrate cover ─────────────────
 * Previously `total = meal + correction - IOB` subtracted active insulin from the
 * WHOLE bolus, so a patient about to eat received far less than their carbs needed
 * (60 g at ICR 10 with 3 u IOB and glucose at target gave 3 u instead of 6 u) —
 * a direct cause of post-prandial hyperglycaemia, and it contradicted the module's
 * own stated assumption "meal coverage is never reduced". IOB now nets off the
 * CORRECTION only, which is standard bolus-calculator behaviour. */
test("combinedDose: IOB never reduces meal cover (at-target, IOB > correction)", () => {
  const r = E.combinedDose({ carbs: 60, icr: 10, glucose: 120, target: 120, isf: 50, iob: 3, increment: 1 });
  assert.equal(r.mealComponent, 6);
  assert.equal(r.correctionComponent, 0);
  assert.equal(r.correctionAfterIob, 0);       // correction floored, not driven negative
  assert.equal(r.rounded, 6);                  // was 3 before the fix
});

test("combinedDose: IOB exceeding the correction leaves meal cover intact", () => {
  const r = E.combinedDose({ carbs: 45, icr: 15, glucose: 180, target: 120, isf: 50, iob: 5, increment: 1 });
  assert.equal(r.mealComponent, 3);            // 45/15
  assert.equal(r.correctionComponent, 1.2);    // (180-120)/50
  assert.equal(r.correctionAfterIob, 0);       // 1.2 - 5 -> floored
  assert.equal(r.rounded, 3);                  // was 0 before the fix (whole meal missed)
  assert.ok(r.clinicalNotes.some(n => /only the meal bolus/i.test(n)));
});

test("combinedDose: IOB below the correction still nets off correctly", () => {
  const r = E.combinedDose({ carbs: 60, icr: 10, glucose: 250, target: 120, isf: 50, iob: 1, increment: 1 });
  assert.equal(r.correctionComponent, 2.6);
  assert.equal(r.correctionAfterIob, 1.6);
  assert.equal(r.rounded, 8);                  // 6 + 1.6 -> 7.6 -> 8 (unchanged behaviour)
});

/* ── Regression: pure correction must account for active insulin ──────────── */
test("correctionDose: subtracts IOB to prevent stacking", () => {
  const r = E.correctionDose({ glucose: 250, target: 120, isf: 50, iob: 1.5, increment: 1 });
  assert.equal(r.grossCorrection, 2.6);
  assert.equal(r.iobSubtracted, 1.5);
  assert.equal(r.rounded, 1);                  // 2.6 - 1.5 = 1.1 -> 1
  assert.ok(/IOB/.test(r.formula));
});

test("correctionDose: IOB covering the whole gap gives no extra insulin", () => {
  const r = E.correctionDose({ glucose: 200, target: 150, isf: 50, iob: 4, increment: 1 });
  assert.equal(r.rounded, 0);                  // 1 u gross, 4 u already active
});

test("correctionDose: without IOB behaves as before but flags the risk", () => {
  const r = E.correctionDose({ glucose: 250, target: 120, isf: 50, increment: 1 });
  assert.equal(r.rounded, 3);                  // 2.6 -> 3, unchanged
  assert.ok(r.assumptions.some(a => /may stack/i.test(a)));
});

/* ── Context adjustment: renal / pregnancy must CHANGE the dose ──────────────
 * Previously the renal, hepatic and pregnancy chips only emitted a generic
 * caution — every combination produced an identical TDD. Conditions with a
 * quantified guideline adjustment now scale the weight-based starting dose;
 * those without a validated multiplier (hepatic, steroids) still must not. */
test("basalInitiation: unchanged when no context flags are set", () => {
  const r = E.basalInitiation({ weightKg: 80, tddFactor: 0.4, increment: 1 });
  assert.equal(r.tdd, 32);
  assert.equal(r.contextMultiplier, 1);
});

test("renal: eGFR 10-50 gives 75% of the dose", () => {
  const r = E.basalInitiation({ weightKg: 80, tddFactor: 0.4, increment: 1, ctx: { renal: true, egfr: 30 } });
  assert.equal(r.contextMultiplier, 0.75);
  assert.equal(r.tdd, 24);                       // 32 -> 24, was 32 before
  assert.ok(r.contextApplied.some(a => /75%/.test(a)));
});

test("renal: eGFR <10 or dialysis gives 50%", () => {
  assert.equal(E.basalInitiation({ weightKg: 80, tddFactor: 0.4, ctx: { renal: true, egfr: 8 } }).tdd, 16);
  assert.equal(E.basalInitiation({ weightKg: 80, tddFactor: 0.4, ctx: { renal: true, dialysis: true } }).tdd, 16);
});

test("renal: eGFR above 50 is not reduced", () => {
  const r = E.basalInitiation({ weightKg: 80, tddFactor: 0.4, ctx: { renal: false, egfr: 75 } });
  assert.equal(r.contextMultiplier, 1);
  assert.equal(r.tdd, 32);
});

test("renal flagged without an eGFR falls back to the 75% band and says so", () => {
  const r = E.basalInitiation({ weightKg: 80, tddFactor: 0.4, ctx: { renal: true } });
  assert.equal(r.tdd, 24);
  assert.ok(r.contextApplied.some(a => /without an eGFR/i.test(a)));
});

test("pregnancy: trimester factors RAISE the dose (0.7 / 0.8 / 0.9 u/kg/day)", () => {
  const t1 = E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: true, trimester: 1 } });
  const t2 = E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: true, trimester: 2 } });
  const t3 = E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: true, trimester: 3 } });
  assert.equal(t1.tdd, 49);   // 70 x 0.7
  assert.equal(t2.tdd, 56);   // 70 x 0.8
  assert.equal(t3.tdd, 63);   // 70 x 0.9
  assert.ok(t3.tdd > t2.tdd && t2.tdd > t1.tdd);
  assert.ok(t2.clinicalNotes.some(n => /under 95 mg\/dL/.test(n)));   // tighter targets surfaced
});

test("pregnancy without a trimester does not guess, but advises the range", () => {
  const r = E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: true } });
  assert.equal(r.tdd, 28);                                            // unchanged
  assert.ok(r.clinicalNotes.some(n => /Select a trimester/i.test(n)));
});

test("hepatic and steroids give guidance but never a fabricated multiplier", () => {
  const h = E.basalInitiation({ weightKg: 80, tddFactor: 0.4, ctx: { hepatic: true } });
  assert.equal(h.contextMultiplier, 1);
  assert.equal(h.tdd, 32);
  assert.ok(h.clinicalNotes.some(n => /no validated dose multiplier/i.test(n)));
  const s = E.basalInitiation({ weightKg: 80, tddFactor: 0.4, ctx: { steroids: true } });
  assert.equal(s.tdd, 32);
  assert.ok(s.clinicalNotes.some(n => /PRANDIAL/i.test(n)));
});

test("pregnancy + renal combine: trimester factor then renal reduction", () => {
  const r = E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: true, trimester: 3, renal: true, egfr: 30 } });
  assert.equal(r.contextFactor, 0.9);
  assert.equal(r.contextMultiplier, 0.75);
  assert.equal(r.tdd, 47);    // 70 x 0.9 = 63, x 0.75 = 47.25 -> 47
});

/* ── Bolus context advice: toggling a context must visibly change the output ──
 * Renal/pregnancy/etc. previously did nothing at all in meal/correction/combined
 * mode (they only adjusted weight-based initiation). They now return concrete
 * adjusted figures — but deliberately do NOT rescale the bolus silently, because
 * the entered ICR/ISF may already account for the context. */
test("bolusContextAdvice: no context -> nothing shown", () => {
  assert.equal(E.bolusContextAdvice(5, {}).length, 0);
});

test("bolusContextAdvice: exercise gives the 25-50% pre-exercise range", () => {
  const a = E.bolusContextAdvice(8, { exercise: true });
  const ex = a.find(x => x.id === "exercise");
  assert.ok(ex);
  assert.equal(ex.value, "4 to 6 units");        // 50% .. 75% of 8
});

test("bolusContextAdvice: pregnancy surfaces the tighter targets", () => {
  const p = E.bolusContextAdvice(6, { pregnancy: true }).find(x => x.id === "pregnancy");
  assert.match(p.value, /95/);
  assert.match(p.detail, /140/);
});

test("bolusContextAdvice: steroids explain why insulin is never auto-increased", () => {
  const s = E.bolusContextAdvice(6, { steroids: true }).find(x => x.id === "steroids");
  assert.match(s.value, /not auto-increased/i);
  assert.match(s.detail, /PRANDIAL/);
});

test("bolusContextAdvice: zero dose returns nothing", () => {
  assert.equal(E.bolusContextAdvice(0, { exercise: true }).length, 0);
});


/* ── Context now APPLIES to the bolus (reported: every context gave the same dose) ── */
test("bolusContextFactor: lowering contexts scale, raising contexts never do", () => {
  assert.equal(E.bolusContextFactor({}).factor, 1);
  assert.equal(E.bolusContextFactor({ renal: true, egfr: 30 }).factor, 0.75);
  assert.equal(E.bolusContextFactor({ renal: true, dialysis: true }).factor, 0.5);
  assert.equal(E.bolusContextFactor({ hepatic: true }).factor, 0.75);
  assert.equal(E.bolusContextFactor({ exercise: true }).factor, 0.75);
  // never auto-INCREASE insulin
  assert.equal(E.bolusContextFactor({ pregnancy: true }).factor, 1);
  assert.equal(E.bolusContextFactor({ steroids: true }).factor, 1);
});

test("mealBolus: each context changes the dose (45 g / ICR 10 = 5 u)", () => {
  const d = (ctx) => E.mealBolus({ carbs: 45, icr: 10, increment: 1, ctx }).rounded;
  assert.equal(d({}), 5);
  assert.equal(d({ renal: true, egfr: 30 }), 3);       // was 5
  assert.equal(d({ renal: true, dialysis: true }), 2);
  assert.equal(d({ hepatic: true }), 3);               // was 5
  assert.equal(d({ exercise: true }), 3);
});

test("contexts compound and are shown as steps", () => {
  const r = E.mealBolus({ carbs: 45, icr: 10, increment: 1, ctx: { renal: true, egfr: 30, hepatic: true } });
  assert.equal(r.contextFactor, 0.56);                 // 0.75 x 0.75
  assert.equal(r.contextApplied.length, 2);
  assert.ok(r.steps.some(s => /Context-adjusted dose/.test(s.label)));
});

test("correction and combined also apply the context factor", () => {
  const c = E.correctionDose({ glucose: 250, target: 150, isf: 50, increment: 1, ctx: { renal: true, egfr: 30 } });
  assert.equal(c.rounded, 2);                          // 2 u gross -> x0.75 = 1.5 -> 2
  assert.equal(c.contextFactor, 0.75);
  const k = E.combinedDose({ carbs: 60, icr: 10, glucose: 150, target: 150, isf: 50, iob: 0, increment: 1, ctx: { hepatic: true } });
  assert.equal(k.rounded, 5);                          // 6 u meal -> x0.75 = 4.5 -> 5
});

/* ── Every context effect is gated on ITS OWN chip ──────────────────────────
 * Requirement: the eGFR box appears, and the dose is based on eGFR, ONLY when
 * Renal is selected. Previously `ctx.renal || ok(ctx.egfr)` meant a leftover
 * eGFR kept reducing the dose after Renal was unticked — a silent reduction
 * with nothing on screen to explain it. Same principle for pregnancy. */
test("renal OFF with a stale eGFR does not touch the bolus", () => {
  assert.equal(E.bolusContextFactor({ renal: false, egfr: 20 }).factor, 1);
  assert.equal(E.bolusContextFactor({ egfr: 8, dialysis: true }).factor, 1);   // no chip -> no effect
  assert.equal(E.mealBolus({ carbs: 45, icr: 10, increment: 1, ctx: { renal: false, egfr: 20 } }).rounded, 5);
});

test("renal ON uses the eGFR that is now visible", () => {
  assert.equal(E.bolusContextFactor({ renal: true, egfr: 20 }).factor, 0.75);
  assert.equal(E.mealBolus({ carbs: 45, icr: 10, increment: 1, ctx: { renal: true, egfr: 20 } }).rounded, 3);
});

test("renal OFF with a stale eGFR does not touch weight-based initiation", () => {
  const r = E.basalInitiation({ weightKg: 80, tddFactor: 0.4, ctx: { renal: false, egfr: 20 } });
  assert.equal(r.contextMultiplier, 1);
  assert.equal(r.tdd, 32);
  assert.equal(E.basalInitiation({ weightKg: 80, tddFactor: 0.4, ctx: { renal: true, egfr: 20 } }).tdd, 24);
});

test("pregnancy OFF with a stale trimester does not change the starting dose", () => {
  const off = E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: false, trimester: 3 } });
  assert.equal(off.tdd, 28);                       // plain 70 x 0.4
  assert.equal(off.contextFactor, 0.4);
  assert.equal(E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: true, trimester: 3 } }).tdd, 63);
});
