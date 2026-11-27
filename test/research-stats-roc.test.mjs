/* ROC curve and AUC on the device (research-stats.js: roc): hand-checked
 * cases and input rules. The full number-by-number check against R pROC is
 * test/research-stats-parity-roc.test.mjs.
 *
 * Run: node --test test/research-stats-roc.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const S = require("../research-stats.js");

function near(a, b, tol, label) {
  assert.ok(Math.abs(a - b) <= (tol || 1e-9), (label || "") + ": got " + a + ", want " + b);
}

const COLS = ["test", "disease"];
/* 4 with the disease (1, 3, 2, 4), 3 without (2, 0.5, 1.5). Pairs where the
 * case is higher: 1 beats 0.5; 3, 4 beat all 3; 2 beats 0.5 and 1.5 and ties 2.
 * AUC = (1 + 3 + 3 + 2.5) / 12 = 19/24. pROC 1.18.5: CI 0.4145 to 1 (DeLong),
 * best cut-off 2.5 with sensitivity 0.5 and specificity 1. */
const SMALL = [[1, "yes"], [2, "no"], [3, "yes"], [0.5, "no"], [2, "yes"], [1.5, "no"], [4, "yes"]];

test("small hand case matches the worked answer and pROC", () => {
  const r = S.roc(SMALL, COLS, "disease", ["test"]);
  assert.equal(r.positiveLevel, "yes");
  const t = r.tests[0];
  assert.equal(t.direction, "<");
  near(t.auc, 19 / 24, 1e-12, "AUC");
  near(t.ciLower, 0.4144714216705111, 1e-6, "CI lower");
  assert.equal(t.ciUpper, 1, "CI upper is kept at 1");
  assert.deepEqual(t.thresholds, [-Infinity, 0.75, 1.25, 1.75, 2.5, 3.5, Infinity]);
  assert.deepEqual(t.sensitivities, [1, 1, 0.75, 0.75, 0.5, 0.25, 0]);
  assert.equal(t.best.threshold, 2.5);
  assert.equal(t.best.tp, 2);
  assert.equal(t.best.fp, 0);
  assert.equal(t.best.fn, 2);
  assert.equal(t.best.tn, 3);
  assert.equal(t.best.ppv, 1);
  near(t.best.npv, 0.6, 1e-12, "NPV");
  assert.equal(t.best.positiveWhen, "above");
});

test("perfect separation gives AUC 1 with a zero-width interval", () => {
  const rows = [[1, "no"], [2, "no"], [3, "no"], [7, "yes"], [8, "yes"], [9, "yes"]];
  const t = S.roc(rows, COLS, "disease", ["test"]).tests[0];
  assert.equal(t.auc, 1);
  assert.equal(t.se, 0);
  assert.equal(t.ciLower, 1);
  assert.equal(t.ciUpper, 1);
  assert.equal(t.best.sensitivity, 1);
  assert.equal(t.best.specificity, 1);
});

test("lower values meaning disease are picked up automatically", () => {
  const rows = [[9, "no"], [8, "no"], [7, "no"], [1, "yes"], [2, "yes"], [7.5, "yes"]];
  const t = S.roc(rows, COLS, "disease", ["test"]).tests[0];
  assert.equal(t.direction, ">");
  assert.ok(t.auc > 0.8);
  assert.equal(t.best.positiveWhen, "below");
});

test("forcing the wrong direction warns that the test is worse than chance", () => {
  const rows = [[9, "no"], [8, "no"], [7, "no"], [1, "yes"], [2, "yes"], [7.5, "yes"]];
  const t = S.roc(rows, COLS, "disease", ["test"], { direction: "<" }).tests[0];
  assert.ok(t.auc < 0.5);
  assert.ok(t.warnings.some((w) => /below 0.5/.test(w)));
});

test("blank and non-number cells are left out and counted", () => {
  const rows = SMALL.concat([["", "yes"], ["NA", "no"], [5, ""], ["high", "yes"]]);
  const t = S.roc(rows, COLS, "disease", ["test"]).tests[0];
  assert.equal(t.n, 7);
  assert.equal(t.dropped, 4);
  near(t.auc, 19 / 24, 1e-12, "AUC unchanged");
});

test("numbers typed as text are read as numbers", () => {
  const rows = SMALL.map((r) => [String(r[0]), r[1]]);
  near(S.roc(rows, COLS, "disease", ["test"]).tests[0].auc, 19 / 24, 1e-12, "AUC");
});

test("the user can say which value means the condition", () => {
  const rows = [[1, "Good"], [2, "Good"], [3, "Poor"], [4, "Poor"], [2.5, "Good"]];
  const r = S.roc(rows, COLS, "disease", ["test"], { positiveLevel: "Poor" });
  assert.equal(r.positiveLevel, "Poor");
  assert.equal(r.negativeLevel, "Good");
  assert.equal(r.tests[0].auc, 1);
  const flipped = S.roc(rows, COLS, "disease", ["test"], { positiveLevel: "Good" });
  assert.equal(flipped.tests[0].direction, ">");
  assert.equal(flipped.tests[0].auc, 1);
});

test("one group missing is a clear error", () => {
  const rows = [[1, "yes"], [2, "yes"], [3, "no"]];
  assert.throws(() => S.roc(rows.slice(0, 2), COLS, "disease", ["test"]), /exactly 2 values/);
  const only = [[1, "yes"], [2, "yes"], ["", "no"]];
  assert.throws(() => S.roc(only, COLS, "disease", ["test"]), (e) => e.code === "roc_one_class");
});

test("a condition column with 3 values is refused", () => {
  const rows = [[1, "a"], [2, "b"], [3, "c"]];
  assert.throws(() => S.roc(rows, COLS, "disease", ["test"]), (e) => e.code === "roc_truth_levels");
});

test("a single person in a group gives the AUC but no interval", () => {
  const rows = [[1, "no"], [2, "no"], [3, "yes"]];
  const t = S.roc(rows, COLS, "disease", ["test"]).tests[0];
  assert.equal(t.auc, 1);
  assert.equal(t.ciLower, null);
  assert.ok(t.warnings.length > 0);
});

test("two tests are compared on the people who have both values", () => {
  const cols = ["a", "b", "disease"];
  const rows = [
    [1, 2, "no"], [2, 1, "no"], [3, 4, "no"], [2.5, 3, "no"],
    [4, 3.5, "yes"], [5, 2.8, "yes"], [6, 5, "yes"], [3.2, "", "yes"]
  ];
  const r = S.roc(rows, cols, "disease", ["a", "b"]);
  assert.equal(r.tests[0].n, 8);
  assert.equal(r.tests[1].n, 7);
  assert.equal(r.comparisons.length, 1);
  const c = r.comparisons[0];
  assert.equal(c.n, 7);
  assert.equal(c.method, "DeLong (paired)");
  near(c.diff, c.aucA - c.aucB, 1e-12, "difference");
  assert.ok(c.p > 0 && c.p <= 1);
  assert.equal(c.directionsDiffer, false);
});

test("at most 4 tests, and the condition column cannot be a test", () => {
  const cols = ["a", "b", "c", "d", "e", "disease"];
  assert.throws(() => S.roc([[1, 2, 3, 4, 5, "yes"]], cols, "disease", ["a", "b", "c", "d", "e"]), /at most 4/);
  assert.throws(() => S.roc(SMALL, COLS, "disease", ["disease"]), /cannot be the condition/);
});

test("AUC bands use plain words", () => {
  assert.equal(S.aucBand(0.95), "outstanding");
  assert.equal(S.aucBand(0.85), "excellent");
  assert.equal(S.aucBand(0.75), "acceptable");
  assert.equal(S.aucBand(0.6), "poor");
  assert.equal(S.aucBand(0.5), "no better than chance");
});

test("10 000 people run in well under a second", () => {
  const rows = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 10000; i++) {
    const sick = rnd() < 0.3;
    rows.push([Math.round((rnd() + (sick ? 0.4 : 0)) * 100) / 10, sick ? "yes" : "no"]);
  }
  const t0 = Date.now();
  const t = S.roc(rows, COLS, "disease", ["test"]).tests[0];
  assert.ok(Date.now() - t0 < 1000, "took " + (Date.now() - t0) + " ms");
  assert.ok(t.auc > 0.6 && t.auc < 0.9);
});
