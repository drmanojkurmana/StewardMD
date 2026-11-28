/* Two-group yes/no results must not flip with how the groups are named.
 * Published anchors: RECOVERY dexamethasone, 28-day deaths 482/2104 vs
 * 1110/4321 (crude RR 0.89; the paper's 0.83 is age-adjusted). Doll and Hill
 * 1950, men: 647 of 649 lung cancer cases smoked vs 622 of 649 controls
 * (OR 14.04).
 *
 * node --test test/research-group-order.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");

function rep(n, v) { return Array(n).fill(v); }
function near(a, b, tol, label) {
  assert.ok(Math.abs(a - b) <= tol, label + ": got " + a + ", want " + b);
}

const RECOVERY_DIED = rep(482, "yes").concat(rep(1622, "no"), rep(1110, "yes"), rep(3211, "no"));
function recoveryArms(treated, comparison) { return rep(2104, treated).concat(rep(4321, comparison)); }

test("RECOVERY risk ratio is 0.89 whatever the arms are called", function () {
  [
    ["Dexamethasone", "Usual care"], ["Treatment", "Control"], ["Yes", "No"], ["1", "0"],
    ["Drug", "Placebo"], ["Intervention", "Standard care"], ["Exposed", "Unexposed"]
  ].forEach(function (pair) {
    const r = STATS.compare(RECOVERY_DIED, recoveryArms(pair[0], pair[1]), { outcomeType: "binary", studyType: "RCT" });
    assert.equal(r.effect.measure, "RR", pair.join("/"));
    near(r.effect.estimate, 0.8918, 1e-3, pair.join("/") + " RR");
    near(r.effect.ciLower, 0.812, 1e-3, pair.join("/") + " lo");
    near(r.effect.ciUpper, 0.979, 1e-3, pair.join("/") + " hi");
    assert.equal(r.byGroup[0].group, pair[0], pair.join("/") + " treated group first");
  });
});

const SMOKED = rep(647, "yes").concat(rep(2, "no"), rep(622, "yes"), rep(27, "no"));
function caseStatus(c, k) { return rep(649, c).concat(rep(649, k)); }

test("Doll and Hill odds ratio is 14.04 for Case/Control, Yes/No and 1/0", function () {
  [["Case", "Control"], ["Yes", "No"], ["1", "0"], ["Lung cancer", "No lung cancer"]].forEach(function (pair) {
    const r = STATS.compare(SMOKED, caseStatus(pair[0], pair[1]), { outcomeType: "binary", studyType: "case-control" });
    assert.equal(r.effect.measure, "OR");
    near(r.effect.estimate, 14.043, 1e-3, pair.join("/") + " OR");
    near(r.effect.ciLower, 3.325, 1e-3, pair.join("/") + " lo");
    near(r.effect.ciUpper, 59.301, 1e-3, pair.join("/") + " hi");
  });
});

test("the sentence names the group whose numbers it shows", function () {
  const r = STATS.compare(SMOKED, caseStatus("Yes", "No"), { outcomeType: "binary", studyType: "case-control" });
  /* the screen passes the column's levels in sorted order: No, Yes */
  const s = STATS.resultsSentence(r, { outcome: "Smoking", groupLabels: ["No", "Yes"] });
  assert.match(s, /higher odds of Smoking/);
  assert.match(s, /647 of 649 \(99\.7%\) in Yes vs 622 of 649 \(95\.8%\) in No/);
  assert.match(s, /odds ratio 14\.04/);
});

test("Smoker vs Non-smoker puts smokers first", function () {
  const cancer = rep(647, "yes").concat(rep(622, "no"), rep(2, "yes"), rep(27, "no"));
  const grp = rep(1269, "Smoker").concat(rep(29, "Non-smoker"));
  const r = STATS.compare(cancer, grp, { outcomeType: "binary" });
  assert.equal(r.byGroup[0].group, "Smoker");
  near(r.effect.estimate, 14.043, 1e-3, "OR");
});

test("small tables on the Fisher path follow the same order", function () {
  const out = rep(1, "yes").concat(rep(9, "no"), rep(6, "yes"), rep(4, "no"));
  const grp = rep(10, "Yes").concat(rep(10, "No"));
  const r = STATS.compare(out, grp, { outcomeType: "binary", studyType: "RCT" });
  assert.equal(r.test, "fisher");
  assert.equal(r.byGroup[0].group, "Yes");
  near(r.effect.estimate, (1 / 10) / (6 / 10), 1e-9, "RR treated vs comparison");
});

test("labels the app cannot read keep their sorted order", function () {
  const out = rep(3, "yes").concat(rep(7, "no"), rep(6, "yes"), rep(4, "no"));
  const r = STATS.compare(out, rep(10, "Ward B").concat(rep(10, "Ward A")), { outcomeType: "binary" });
  assert.equal(r.byGroup[0].group, "Ward A");
  assert.equal(r.byGroup[0].levelIndex, 0);
});

test("number outcomes keep R's order, so the mean difference sign is unchanged", function () {
  const y = [5, 6, 7, 8, 9, 1, 2, 3, 4, 5];
  const r = STATS.compare(y, rep(5, "Yes").concat(rep(5, "No")), { outcomeType: "numeric" });
  assert.equal(r.byGroup[0].group, "No");
});
