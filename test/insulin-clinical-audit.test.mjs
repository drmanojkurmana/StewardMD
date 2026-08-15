/* test/insulin-clinical-audit.test.mjs — endocrinologist-authored known-answer audit of the insulin
 * engine + safety layer. Every expected value is hand-computed from the standard formula. Run:
 *   node --test test/insulin-clinical-audit.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../insulin-engine.js");
const S = require("../insulin-safety.js");

// ---------- ISF (correction factor) : 1800 rule (rapid), 1500 (regular) ----------
test("ISF = 1800/TDD (rapid) and 1500/TDD (regular)", () => {
  assert.equal(E.isfFromTdd({ tdd: 50, rule: 1800 }).result, 36);      // 1800/50
  assert.equal(E.isfFromTdd({ tdd: 40, rule: 1500 }).result, 37.5);    // 1500/40
  assert.equal(E.isfFromTdd({ tdd: 0 }).result, null);                 // guard: divide-by-zero
});

// ---------- ICR : 500 rule (rapid), 450 (regular) ----------
test("ICR = 500/TDD (rapid) and 450/TDD (regular)", () => {
  assert.equal(E.icrFromTdd({ tdd: 50, rule: 500 }).result, 10);       // 500/50
  assert.equal(E.icrFromTdd({ tdd: 40, rule: 450 }).result, 11.3);     // 450/40 = 11.25 -> 11.3
  assert.equal(E.icrFromTdd({ tdd: -5 }).result, null);
});

// ---------- Correction dose : (glucose - target)/ISF, floored, IOB-netted ----------
test("correction = (glucose-target)/ISF, never negative, IOB netted", () => {
  let r = E.correctionDose({ glucose: 250, target: 120, isf: 50 });    // 130/50 = 2.6 -> 3u
  assert.equal(r.result, 2.6); assert.equal(r.rounded, 3);
  assert.equal(E.correctionDose({ glucose: 120, target: 120, isf: 50 }).rounded, 0);   // at target -> 0
  assert.equal(E.correctionDose({ glucose: 100, target: 120, isf: 50 }).rounded, 0);   // below target -> 0 (no negative insulin)
  r = E.correctionDose({ glucose: 250, target: 120, isf: 50, iob: 1 });                 // 2.6 - 1 = 1.6 -> 2u
  assert.equal(r.rounded, 2);
  assert.equal(E.correctionDose({ glucose: 200, target: 120, isf: 40, iob: 5 }).rounded, 0); // gross 2 - IOB 5 -> floored 0
  assert.equal(E.correctionDose({ glucose: 250, target: 120, isf: 0 }).result, null);   // guard
});

// ---------- Meal bolus : carbs / ICR ----------
test("meal bolus = carbs/ICR", () => {
  assert.equal(E.mealBolus({ carbs: 60, icr: 10 }).rounded, 6);
  const r = E.mealBolus({ carbs: 45, icr: 10 });                        // 4.5 -> 5u (round half up)
  assert.equal(r.result, 4.5); assert.equal(r.rounded, 5);
  assert.equal(E.mealBolus({ carbs: 60, icr: 0 }).result, null);
});

// ---------- Combined : meal + max(0, correction - IOB). IOB must NOT reduce meal cover ----------
test("combined = meal + (correction - IOB); IOB never cuts meal coverage", () => {
  let r = E.combinedDose({ carbs: 60, icr: 10, glucose: 250, target: 120, isf: 50, iob: 1 });
  assert.equal(r.mealComponent, 6); assert.equal(r.correctionComponent, 2.6);
  assert.equal(r.correctionAfterIob, 1.6); assert.equal(r.result, 7.6); assert.equal(r.rounded, 8);
  // IOB larger than correction: correction floored to 0, but the full 6u meal survives
  r = E.combinedDose({ carbs: 60, icr: 10, glucose: 200, target: 120, isf: 40, iob: 5 });
  assert.equal(r.correctionAfterIob, 0); assert.equal(r.rounded, 6);
});

// ---------- Active insulin (IOB) : linear decay, clamped to 0 past DIA ----------
test("IOB linear decay, clamped at 0 after DIA", () => {
  assert.equal(E.activeInsulin({ dia: 4, doses: [{ units: 6, minutesAgo: 60 }] }).result, 4.5); // 6*(1-1/4)
  assert.equal(E.activeInsulin({ dia: 4, doses: [{ units: 6, minutesAgo: 300 }] }).result, 0);  // elapsed>DIA -> 0
  assert.equal(E.activeInsulin({ dia: 4, doses: [{ units: 6, minutesAgo: 60 }, { units: 4, minutesAgo: 120 }] }).result, 6.5); // 4.5 + 2
});

// ---------- Weight-based basal-bolus initiation ----------
test("basal init: TDD = wt*factor, 50/50 split, meal each = (TDD-basal)/3", () => {
  const r = E.basalInitiation({ weightKg: 70, tddFactor: 0.4, basalFraction: 0.5, increment: 1 });
  assert.equal(r.tdd, 28); assert.equal(r.basal, 14); assert.equal(r.mealBolusEach, 5); // 14/3=4.67 -> 5
  assert.equal(E.basalInitiation({ weightKg: 0 }).result, null);
});

test("basal init: renal banding (eGFR 10-50 -> 75%, <10/dialysis -> 50%)", () => {
  assert.equal(E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { renal: true, egfr: 30 } }).tdd, 21); // 28*0.75
  assert.equal(E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { renal: true, egfr: 8 } }).tdd, 14);  // 28*0.5
  assert.equal(E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { renal: true, dialysis: true } }).tdd, 14);
  assert.equal(E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { renal: true, egfr: 60 } }).tdd, 28); // >=50 no cut
});

test("basal init: pregnancy trimester factor supersedes, and combines with renal", () => {
  assert.equal(E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: true, trimester: 2 } }).tdd, 56); // 70*0.8
  assert.equal(E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: true, trimester: 3 } }).tdd, 63); // 70*0.9
  assert.equal(E.basalInitiation({ weightKg: 70, tddFactor: 0.4, ctx: { pregnancy: true, trimester: 2, renal: true, egfr: 30 } }).tdd, 42); // 70*0.8*0.75
});

// ---------- Pediatric initiation (ISPAD stage factors) ----------
test("pediatric init: stage factors, 0.5u increments", () => {
  const r = E.pediatricInit({ weightKg: 30, stage: "prepubertal" });   // 0.5 -> 15u
  assert.equal(r.tdd, 15); assert.equal(r.basal, 7.5); assert.equal(r.mealBolusEach, 2.5);
  assert.equal(E.pediatricInit({ weightKg: 40, stage: "pubertal" }).tdd, 36); // 0.9
});

// ---------- DKA fixed-rate IV infusion ----------
test("DKA FRIII = wt * rate/kg, capped, with potassium safety note", () => {
  assert.equal(E.dkaInsulin({ weightKg: 80, ratePerKg: 0.1 }).result, 8);      // 0.1 u/kg/h
  assert.equal(E.dkaInsulin({ weightKg: 80, maxRate: 6 }).result, 6);          // capped
  const r = E.dkaInsulin({ weightKg: 20, ratePerKg: 0.05, paeds: true });
  assert.equal(r.result, 1);
  assert.ok(r.clinicalNotes.join(" ").toLowerCase().includes("potassium"), "DKA must carry the K+ safety note");
});

// ---------- Context factor (bolus): lowers dose for renal/hepatic/exercise; NEVER auto-raises ----------
test("bolus context factor: renal/hepatic/exercise reduce; pregnancy/steroids never auto-increase", () => {
  assert.equal(E.bolusContextFactor({ renal: true, egfr: 30 }).factor, 0.75);
  assert.equal(E.bolusContextFactor({ renal: true, egfr: 8 }).factor, 0.5);
  assert.equal(E.bolusContextFactor({ hepatic: true }).factor, 0.75);
  assert.equal(E.bolusContextFactor({ exercise: true }).factor, 0.75);
  assert.equal(E.bolusContextFactor({ renal: true, egfr: 30, hepatic: true, exercise: true }).factor, 0.42); // 0.75^3
  assert.equal(E.bolusContextFactor({ pregnancy: true }).factor, 1);   // safety: no silent increase
  assert.equal(E.bolusContextFactor({ steroids: true }).factor, 1);    // safety: no silent increase
});

// ---------- Safety layer ----------
test("safety: hypoglycemia is a critical interrupt below 70 mg/dL", () => {
  const w = S.evaluate({}, { glucose: 65, target: 120, iob: 0 }, { rounded: 2 });
  const hypo = w.find((x) => x.id === "hypoglycemia");
  assert.ok(hypo && hypo.severity === "critical" && hypo.interrupt === true);
});
test("safety: severe hyperglycemia warning >300; max-bolus critical when configured; stacking caution", () => {
  assert.ok(S.evaluate({}, { glucose: 350 }, { rounded: 5 }).some((x) => x.id === "severe_hyper"));
  assert.ok(S.evaluate({ maxBolus: 10 }, { glucose: 250 }, { rounded: 12 }).some((x) => x.id === "max_bolus" && x.interrupt));
  assert.ok(S.evaluate({}, { glucose: 180, iob: 3 }, { rounded: 2 }).some((x) => x.id === "stacking"));
});

// ---------- NEW safety defaults ----------
test("safety: glucose >400 is a CRITICAL DKA/HHS interrupt; 300-400 stays a warning", () => {
  const hi = S.evaluate({}, { glucose: 450, target: 120 }, { rounded: 15 });
  const crit = hi.find((x) => x.id === "critical_hyper");
  assert.ok(crit && crit.severity === "critical" && crit.interrupt === true, ">400 must hard-interrupt");
  assert.ok(!hi.some((x) => x.id === "severe_hyper"), "the two hyper bands must not double-fire");
  const mid = S.evaluate({}, { glucose: 350, target: 120 }, { rounded: 8 });
  assert.ok(mid.some((x) => x.id === "severe_hyper"), "300-400 stays the ketone warning");
  assert.ok(!mid.some((x) => x.id === "critical_hyper"));
});

test("safety: weight-based TDD is checked against the daily cap (weight-typo guard)", () => {
  // mirrors insulin.js wiring: basal/pediatric set result.dailyTotal = tdd
  const w = S.evaluate({ maxDaily: 100 }, { noGlucose: true }, { dailyTotal: 280 });
  const cap = w.find((x) => x.id === "max_daily");
  assert.ok(cap && cap.severity === "critical" && cap.interrupt === true);
  assert.ok(!S.evaluate({ maxDaily: 100 }, { noGlucose: true }, { dailyTotal: 40 }).some((x) => x.id === "max_daily"));
});

// ---------- Unit-agnostic: engine is canonical mg/dL; a mmol-equivalent input gives the same dose ----------
test("unit consistency: mg/dL-equivalent of a mmol reading yields the same correction", () => {
  // 13.9 mmol/L glucose, 6.1 target, 2.8 mmol/L/u ISF  ->  *18  ->  250.2 / 109.8 / 50.4 mg/dL
  const mgdl = E.correctionDose({ glucose: 13.9 * 18, target: 6.1 * 18, isf: 2.8 * 18 });
  // (250.2-109.8)/50.4 = 2.79 -> 3u
  assert.equal(mgdl.rounded, 3);
});
