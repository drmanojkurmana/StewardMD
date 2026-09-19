/* test/medcore-gbm.test.mjs — the gradient-boosted model, and the three properties that matter
 * more than its accuracy: missing is a branch, clinical direction is enforced, and it stops.
 */
import { test } from "node:test";
import assert from "node:assert";
import { fitGbm, scoreGbm, fitBinner, binValue } from "../backend/medcore/gbm.mjs";
import { MONOTONE } from "../backend/medcore/train.mjs";

/** Rows where `x` drives the label, plus a pure-noise column. */
function cohort(n, fn, seed) {
  let a = seed || 7;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const x = rnd() * 10, noise = rnd() * 10;
    rows.push({ values: { x, noise }, label: fn(x, rnd) });
  }
  return rows;
}

test("gbm: it learns a non-linear relationship a linear model cannot", () => {
  // Risk is high at both extremes of x and low in the middle: a logistic model on x alone is blind
  // to this, a depth-2 tree is not.
  const rows = cohort(2000, (x, rnd) => ((x < 2 || x > 8) ? (rnd() < 0.8 ? 1 : 0) : (rnd() < 0.1 ? 1 : 0)), 11);
  const m = fitGbm(rows.slice(0, 1600), { featureIds: ["x", "noise"], valid: rows.slice(1600), rounds: 120, depth: 2 });
  assert.ok(scoreGbm(m, { x: 0.5, noise: 5 }) > 0.5, "low extreme is high risk");
  assert.ok(scoreGbm(m, { x: 9.5, noise: 5 }) > 0.5, "high extreme is high risk");
  assert.ok(scoreGbm(m, { x: 5, noise: 5 }) < 0.3, "the middle is low risk");
});

test("gbm: missing is its own branch, not an imputed number", () => {
  // Rows where x is ABSENT are high risk; rows with any value of x are low risk. Only a model that
  // routes on absence can represent this, and a median-imputing model cannot see it at all.
  const rows = [];
  for (let i = 0; i < 1200; i++) {
    const absent = i % 3 === 0;
    rows.push({ values: { x: absent ? null : (i % 10), noise: i % 7 }, label: absent ? 1 : 0 });
  }
  const m = fitGbm(rows.slice(0, 900), { featureIds: ["x", "noise"], valid: rows.slice(900), rounds: 80, depth: 2 });
  const pAbsent = scoreGbm(m, { x: null, noise: 3 });
  const pPresent = scoreGbm(m, { x: 5, noise: 3 });
  assert.ok(pAbsent > 0.8, "absence must be learnable as a signal: " + pAbsent);
  assert.ok(pPresent < 0.2, "a recorded value must not look like an absent one: " + pPresent);
  // undefined and NaN are the same absence as null.
  assert.equal(scoreGbm(m, { noise: 3 }), pAbsent);
  assert.equal(scoreGbm(m, { x: NaN, noise: 3 }), pAbsent);
});

test("gbm: a monotone constraint is enforced even when the data contradicts it", () => {
  // The treatment paradox in miniature: in THIS data a high lactate is protective, because the
  // sickest were rescued. An unconstrained model would learn that. A constrained one may not.
  const rows = [];
  for (let i = 0; i < 1500; i++) {
    const lactate_value = (i % 100) / 10;                      // 0..9.9
    const label = lactate_value > 6 ? 0 : (i % 3 === 0 ? 1 : 0);
    rows.push({ values: { lactate_value, noise: i % 11 }, label });
  }
  const free = fitGbm(rows, { featureIds: ["lactate_value", "noise"], rounds: 60, depth: 2 });
  const bound = fitGbm(rows, { featureIds: ["lactate_value", "noise"], rounds: 60, depth: 2, monotone: { lactate_value: +1 } });

  const at = (m, v) => scoreGbm(m, { lactate_value: v, noise: 5 });
  assert.ok(at(free, 8) < at(free, 3), "unconstrained, this data teaches that a high lactate is safer");
  assert.ok(at(bound, 8) >= at(bound, 3) - 1e-9,
    "constrained, a rising lactate may never lower risk: " + at(bound, 8) + " vs " + at(bound, 3));
  // And the constraint must hold across the whole range, not just at two points.
  let prev = -1;
  for (let v = 0; v <= 10; v += 0.5) {
    const p = at(bound, v);
    assert.ok(p >= prev - 1e-9, "monotonicity broke at lactate " + v);
    prev = p;
  }
});

test("gbm: early stopping keeps the best iteration, not the last", () => {
  const rows = cohort(1200, (x, rnd) => (x > 5 ? (rnd() < 0.7 ? 1 : 0) : (rnd() < 0.3 ? 1 : 0)), 3);
  const m = fitGbm(rows.slice(0, 900), {
    featureIds: ["x", "noise"], valid: rows.slice(900), rounds: 500, earlyStopping: 10, depth: 3
  });
  assert.ok(m.stopped, "a run with a validation set reports where it stopped");
  assert.equal(m.trees.length, m.stopped.keptTrees);
  assert.ok(m.trees.length < 500, "it must stop before exhausting the rounds: " + m.trees.length);
  assert.ok(m.stopped.validLogLoss > 0);
});

test("gbm: binning reserves bin 0 for missing and is monotone in the value", () => {
  const rows = cohort(500, () => 0, 5);
  const b = fitBinner(rows, ["x"], 16);
  assert.equal(binValue(b, "x", null), 0);
  assert.equal(binValue(b, "x", undefined), 0);
  assert.equal(binValue(b, "x", NaN), 0);
  assert.ok(binValue(b, "x", 0.1) >= 1, "a real value never lands in the missing bin");
  assert.ok(binValue(b, "x", 9.9) >= binValue(b, "x", 0.1));
});

test("gbm: the monotone table is clinical content, directions and all", () => {
  // Rising is dangerous.
  for (const id of ["lactate_value", "creat_value", "hr_value", "rr_value", "shock_index"]) {
    assert.equal(MONOTONE[id], +1, id + " must be constrained upward");
  }
  // Falling is dangerous.
  for (const id of ["map_value", "sbp_value", "spo2_value", "gcs_value", "uop_value"]) {
    assert.equal(MONOTONE[id], -1, id + " must be constrained downward");
  }
  // Both directions are dangerous, so these are deliberately unconstrained rather than guessed.
  for (const id of ["temp_value", "na_value", "k_value"]) {
    assert.equal(MONOTONE[id], undefined, id + " must stay unconstrained: both directions are bad");
  }
});

test("gbm: the model is plain JSON, so an artifact can carry it", () => {
  const rows = cohort(600, (x, rnd) => (x > 5 ? (rnd() < 0.8 ? 1 : 0) : 0), 9);
  const m = fitGbm(rows, { featureIds: ["x", "noise"], rounds: 20, depth: 2 });
  const round = JSON.parse(JSON.stringify(m));
  assert.equal(scoreGbm(round, { x: 7, noise: 1 }), scoreGbm(m, { x: 7, noise: 1 }));
  assert.ok(Array.isArray(round.trees) && round.trees.length === 20);
});
