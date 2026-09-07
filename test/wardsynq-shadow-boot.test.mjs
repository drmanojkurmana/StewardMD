/* test/wardsynq-shadow-boot.test.mjs — wardsynq-shadow-boot.js's testable surface.
 *
 * Everything else in this file's `boot()` (polling for window.ICU, dynamic import, console logging)
 * is browser glue with no logic worth asserting on. These three functions are the actual DECISIONS
 * boot() makes, extracted and exported (2026-09-06) specifically so they have a test — this file's
 * own header documents that a wiring mistake in this exact layer once made a real ward sync report
 * `bundlesSeen: 0` on a device, silently, because nothing was watching this code at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasAnyMethod, flagIsOn, mergeReports, METHODS } from "../wardsynq-shadow-boot.js";

test("METHODS covers both doors a real ward sync can come through, most-used first", () => {
  assert.deepEqual(METHODS, ["ingestWardHistory", "ingestFromWard"]);
});

test("hasAnyMethod: true the moment EITHER door exists, so boot() never waits for one that a build lacks", () => {
  assert.equal(hasAnyMethod(null), false);
  assert.equal(hasAnyMethod({}), false);
  assert.equal(hasAnyMethod({ ingestWardHistory: function () {} }), true);
  assert.equal(hasAnyMethod({ ingestFromWard: function () {} }), true, "the older-build fallback alone is enough to stop polling");
  assert.equal(hasAnyMethod({ someOtherMethod: function () {} }), false);
});

test("flagIsOn: false with no window at all, never throws — this file imports cleanly under Node for exactly this reason", () => {
  assert.equal(flagIsOn(), false);
});

test("flagIsOn: reads SMD_WARDSYNQ_FLAGS.get('smd_wardsynq_shadow'), and a flags object that throws is treated as off", () => {
  const prior = globalThis.window;
  try {
    globalThis.window = { SMD_WARDSYNQ_FLAGS: { get: (k) => k === "smd_wardsynq_shadow" } };
    assert.equal(flagIsOn(), true);
    globalThis.window = { SMD_WARDSYNQ_FLAGS: { get: () => false } };
    assert.equal(flagIsOn(), false);
    globalThis.window = { SMD_WARDSYNQ_FLAGS: { get: () => { throw new Error("boom"); } } };
    assert.equal(flagIsOn(), false, "a broken flags registry reads as OFF, never crashes the boot check");
    globalThis.window = {};
    assert.equal(flagIsOn(), false, "no flags registry at all reads as OFF");
  } finally {
    globalThis.window = prior;
  }
});

test("mergeReports: sums counts across every wrapped method, so the combined report cannot hide what one door saw", () => {
  const a = { method: "ingestWardHistory", observed: true, bundlesSeen: 3, mapped: 3, shadowErrors: 0, observationsMapped: 12, legacyLabRows: 12, issues: [{ code: "X" }], disagreements: [], lastAt: "2026-09-06T05:00:00.000Z" };
  const b = { method: "ingestFromWard", observed: false, bundlesSeen: 0, mapped: 0, shadowErrors: 0, observationsMapped: 0, legacyLabRows: 0, issues: [], disagreements: [], lastAt: null };
  const merged = mergeReports([a, b]);
  assert.deepEqual(merged.methods, ["ingestWardHistory", "ingestFromWard"]);
  assert.equal(merged.observed, true, "observed if ANY wrapped method saw a bundle");
  assert.equal(merged.bundlesSeen, 3);
  assert.equal(merged.observationsMapped, 12);
  assert.deepEqual(merged.issues, [{ code: "X" }]);
  assert.equal(merged.lastAt, "2026-09-06T05:00:00.000Z");
  assert.equal(merged.clean, true, "one method observed cleanly, the other saw nothing — still clean");
  assert.equal(merged.byMethod.ingestWardHistory.bundlesSeen, 3, "per-door breakdown, not just the sum");
});

test("mergeReports: ADVERSARIAL — an error or a disagreement on EITHER method makes the whole thing not clean, and nothing observed means nothing clean", () => {
  const clean = { method: "ingestWardHistory", observed: true, bundlesSeen: 1, mapped: 1, shadowErrors: 0, observationsMapped: 1, legacyLabRows: 1, issues: [], disagreements: [], lastAt: "t" };
  const errored = { method: "ingestFromWard", observed: true, bundlesSeen: 1, mapped: 0, shadowErrors: 1, observationsMapped: 0, legacyLabRows: 1, issues: [], disagreements: [], lastAt: "t" };
  assert.equal(mergeReports([clean, errored]).clean, false, "an error on the SECOND door is not hidden by the first being clean");
  const disagreed = { method: "ingestFromWard", observed: true, bundlesSeen: 1, mapped: 1, shadowErrors: 0, observationsMapped: 0, legacyLabRows: 1, issues: [], disagreements: [{ note: "shortfall" }], lastAt: "t" };
  assert.equal(mergeReports([clean, disagreed]).clean, false);
  const untouched = { method: "ingestWardHistory", observed: false, bundlesSeen: 0, mapped: 0, shadowErrors: 0, observationsMapped: 0, legacyLabRows: 0, issues: [], disagreements: [], lastAt: null };
  assert.equal(mergeReports([untouched]).clean, false, "zero errors and zero disagreements is not evidence when nothing was observed");
});

test("REGRESSION: importing this module does not require a browser — the exact gap that let a wiring mistake ship unnoticed", () => {
  // If this file threw on import (a bare `window.X` reference with no guard, say), the test runner
  // itself would fail before reaching this assertion. Reaching here IS the regression check.
  assert.equal(typeof hasAnyMethod, "function");
  assert.equal(typeof flagIsOn, "function");
  assert.equal(typeof mergeReports, "function");
});
