/* Case-control and Schoenfeld sample size.
 * Frozen: caseControl 0.40/2/1 -> 133, 144, 144; 0.30/2.5/2 -> 59, 66, 132.
 * logRankEvents HR 0.7 power 0.8 -> 247; HR 0.6 power 0.9 -> 162.
 * Run: node --test test/research-samplesize-cc.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SS = require("../research-samplesize.js");

const OR_MSG = "The odds ratio must differ from 1 and exposure must be between 0% and 100%.";
const HR_MSG = "A hazard ratio of 1 means no difference; choose the smallest difference that matters.";

function closeRel(actual, expected, label) {
  const abs = Math.abs(actual - expected);
  const rel = abs / Math.max(Math.abs(expected), 1e-15);
  assert.ok(rel <= 1e-4, label + ": got " + actual + ", want " + expected);
}

test("Fleiss case-control sizes match the frozen cases", function () {
  const a = SS.caseControl({ p0: 0.40, or: 2, ratio: 1 });
  assert.equal(a.ok, true);
  assert.equal(a.method, "Fleiss with continuity correction");
  closeRel(a.p1, 0.5714285714285715, "p1 a");
  assert.equal(a.casesUncorrected, 133);
  assert.equal(a.cases, 144);
  assert.equal(a.controls, 144);
  assert.equal(a.total, 288);
  assert.deepEqual(a.warnings, []);

  const b = SS.caseControl({ p0: 0.30, or: 2.5, ratio: 2 });
  assert.equal(b.ok, true);
  closeRel(b.p1, 0.5172413793103449, "p1 b");
  assert.equal(b.casesUncorrected, 59);
  assert.equal(b.cases, 66);
  assert.equal(b.controls, 132);
  assert.equal(b.total, 198);
});

test("Schoenfeld event counts match the frozen hazard ratios", function () {
  const a = SS.logRankEvents({ hr: 0.7, power: 0.8, allocation: 0.5 });
  assert.equal(a.ok, true);
  assert.equal(a.method, "Schoenfeld");
  assert.equal(a.events, 247);
  assert.equal(a.total, null);
  const inv = SS.logRankEvents({ hr: 1 / 0.7, power: 0.8, allocation: 0.5 });
  assert.equal(inv.events, 247);
  const b = SS.logRankEvents({ hr: 0.6, power: 0.9, allocation: 0.5 });
  assert.equal(b.ok, true);
  assert.equal(b.events, 162);
  assert.equal(b.total, null);
});

test("probEvent and dropout round the totals upward", function () {
  const ev = SS.logRankEvents({ hr: 0.7, power: 0.8, probEvent: 0.5, dropout: 0.1 });
  assert.equal(ev.ok, true);
  assert.equal(ev.events, 247);
  assert.equal(ev.total, 549);
  const even = SS.logRankEvents({ hr: 0.7, power: 0.8, probEvent: 1, dropout: 0 });
  assert.equal(even.events, 247);
  assert.equal(even.total, 247);
  const dropped = SS.caseControl({ p0: 0.40, or: 2, ratio: 1, dropout: 0.1 });
  assert.equal(dropped.ok, true);
  assert.equal(dropped.casesUncorrected, 133);
  assert.ok(dropped.cases > 144);
  assert.equal(dropped.controls, dropped.cases);
  assert.equal(dropped.total, dropped.cases + dropped.controls);
});

test("invalid sample-size inputs do not throw", function () {
  assert.equal(SS.caseControl().ok, false);
  assert.deepEqual(SS.caseControl().warnings, []);
  assert.deepEqual(SS.caseControl({ p0: 0.4, or: 1 }).warnings, [OR_MSG]);
  assert.deepEqual(SS.caseControl({ p0: 0, or: 2 }).warnings, [OR_MSG]);
  assert.deepEqual(SS.caseControl({ p0: 1, or: 2 }).warnings, [OR_MSG]);
  assert.equal(SS.caseControl({ p0: 0.4, or: 2, ratio: 0 }).ok, false);
  assert.deepEqual(SS.caseControl({ p0: 0.4, or: 2, ratio: 0 }).warnings, []);
  assert.deepEqual(SS.caseControl({ p0: 0.4, or: 2, alpha: 0 }).warnings, []);
  assert.deepEqual(SS.caseControl({ p0: 0.4, or: 2, power: 1 }).warnings, []);
  assert.deepEqual(SS.caseControl({ p0: 0.4, or: 2, dropout: 1 }).warnings, []);
  assert.deepEqual(SS.caseControl({ p0: 0.4, or: 2, dropout: -0.01 }).warnings, []);
  assert.equal(SS.logRankEvents().ok, false);
  assert.deepEqual(SS.logRankEvents().warnings, []);
  assert.deepEqual(SS.logRankEvents({ hr: 1 }).warnings, [HR_MSG]);
  assert.deepEqual(SS.logRankEvents({ hr: 0 }).warnings, []);
  assert.deepEqual(SS.logRankEvents({ hr: 0.7, allocation: 0 }).warnings, []);
  assert.deepEqual(SS.logRankEvents({ hr: 0.7, allocation: 1 }).warnings, []);
  assert.deepEqual(SS.logRankEvents({ hr: 0.7, probEvent: 0 }).warnings, []);
  assert.deepEqual(SS.logRankEvents({ hr: 0.7, probEvent: 1.2 }).warnings, []);
  assert.deepEqual(SS.logRankEvents({ hr: 0.7, dropout: 1 }).warnings, []);
});
