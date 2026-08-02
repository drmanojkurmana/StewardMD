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
