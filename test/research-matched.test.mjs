/* Matched odds ratio against binom.test and qbeta in R 4.6.2.
 * Run: node --test test/research-matched.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");

const HUGE = "The odds ratio is very large; report only the lower limit.";
const WIDE = "Very few pairs differ; the interval is wide.";
const NONE = "No pairs differ in exposure, so the matched odds ratio cannot be calculated.";

function closeRel(actual, expected, label) {
  const abs = Math.abs(actual - expected);
  const rel = abs / Math.max(Math.abs(expected), 1e-15);
  assert.ok(rel <= 1e-4, label + ": got " + actual + ", want " + expected + ", rel " + rel);
}

test("b 25 c 10 matches the exact conditional interval", function () {
  const fit = STATS.matchedOr({ b: 25, c: 10 });
  assert.equal(fit.ok, true);
  assert.equal(fit.b, 25);
  assert.equal(fit.c, 10);
  assert.equal(fit.or, 2.5);
  closeRel(fit.ciLower, 1.1596189735922389, "lower");
  closeRel(fit.ciUpper, 5.8327132003357205, "upper");
  closeRel(fit.p, 0.016673847800120739, "p");
  assert.equal(fit.method, "exact conditional");
  assert.deepEqual(fit.warnings, []);
});

test("b 8 c 0 reports an infinite odds ratio and the lower limit", function () {
  const fit = STATS.matchedOr({ b: 8, c: 0 });
  assert.equal(fit.ok, true);
  assert.equal(fit.or, Infinity);
  assert.equal(fit.ciUpper, Infinity);
  closeRel(fit.ciLower, 1.7069705889662699, "lower");
  assert.equal(fit.p, 0.0078125);
  assert.ok(fit.warnings.indexOf(HUGE) >= 0);
  assert.ok(fit.warnings.indexOf(WIDE) >= 0);
  assert.equal(fit.method, "exact conditional");
});

test("b 0 c 0 cannot calculate a matched odds ratio", function () {
  const fit = STATS.matchedOr({ b: 0, c: 0 });
  assert.equal(fit.ok, false);
  assert.deepEqual(fit.warnings, [NONE]);
  assert.equal(fit.or, null);
  assert.equal(fit.p, null);
  const pairs = STATS.matchedOr([
    { caseExposed: true, controlExposed: true },
    { caseExposed: false, controlExposed: false }
  ]);
  assert.equal(pairs.ok, false);
  assert.deepEqual(pairs.warnings, [NONE]);
  assert.equal(pairs.b, 0);
  assert.equal(pairs.c, 0);
});
