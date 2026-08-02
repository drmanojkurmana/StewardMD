/* test/insulin-golden.test.mjs - locked clinical regression cases.
 * If an expected value changes, that is a deliberate clinical decision - document it in the commit. */
import { test } from "node:test";
import assert from "node:assert/strict";
import E from "../insulin-engine.js";
import S from "../insulin-safety.js";

const CASES = [
  { name: "T1DM adult correction", fn: "correctionDose",
    in: { glucose: 240, target: 120, isf: 40, increment: 1 }, rounded: 3 },
  { name: "meal 45g at 1:15", fn: "mealBolus",
    in: { carbs: 45, icr: 15, increment: 0.5 }, rounded: 3 },
  { name: "combined with IOB", fn: "combinedDose",
    in: { carbs: 30, icr: 10, glucose: 200, target: 120, isf: 40, iob: 2, increment: 1 }, rounded: 3 },
  { name: "ISF 1800 rule TDD 45", fn: "isfFromTdd", in: { tdd: 45 }, rounded: 40 },
  { name: "ICR 500 rule TDD 40", fn: "icrFromTdd", in: { tdd: 40 }, rounded: 12.5 }
];

for (const c of CASES) {
  test("golden: " + c.name, () => {
    const r = E[c.fn](c.in);
    assert.equal(r.rounded, c.rounded);
  });
}

test("golden: hypo case interrupts", () => {
  const r = E.correctionDose({ glucose: 60, target: 120, isf: 40 });
  const w = S.evaluate({}, { glucose: 60 }, r);
  assert.equal(w[0].interrupt, true);
});
