/* test/wardsynq-ghis-live-boot.test.mjs — wardsynq-ghis-live-boot.js's testable surface.
 *
 * Mirrors test/wardsynq-shadow-boot.test.mjs's own scope exactly: `boot()` itself is browser glue
 * (polling for window.ICU, dynamic import, console logging) with no logic worth asserting on. These
 * are the actual DECISIONS the boot layer makes — flag check, method detection, report merging, and
 * (new to this file) deriving the write path from the EXISTING record connection rather than a new
 * one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasAnyMethod, flagIsOn, mergeReports, recordDeps, METHODS } from "../wardsynq-ghis-live-boot.js";
import { makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";

test("METHODS covers both doors a real ward sync can come through, most-used first — the same list the shadow boot script wraps", () => {
  assert.deepEqual(METHODS, ["ingestWardHistory", "ingestFromWard"]);
});

test("hasAnyMethod: true the moment EITHER door exists", () => {
  assert.equal(hasAnyMethod(null), false);
  assert.equal(hasAnyMethod({}), false);
  assert.equal(hasAnyMethod({ ingestWardHistory: function () {} }), true);
  assert.equal(hasAnyMethod({ ingestFromWard: function () {} }), true);
});

test("flagIsOn: reads smd_wardsynq_cutover specifically — NOT the shadow flag — and never throws with no window at all", () => {
  assert.equal(flagIsOn(), false, "no window: imports cleanly under Node for exactly this reason");
  const prior = globalThis.window;
  try {
    globalThis.window = { SMD_WARDSYNQ_FLAGS: { get: (k) => k === "smd_wardsynq_cutover" } };
    assert.equal(flagIsOn(), true);
    globalThis.window = { SMD_WARDSYNQ_FLAGS: { get: (k) => k === "smd_wardsynq_shadow" } };
    assert.equal(flagIsOn(), false, "the shadow flag being on does not turn the cut-over on");
    globalThis.window = { SMD_WARDSYNQ_FLAGS: { get: () => { throw new Error("boom"); } } };
    assert.equal(flagIsOn(), false, "a broken flags registry reads as OFF, never crashes the boot check");
  } finally {
    globalThis.window = prior;
  }
});

test("CRITICAL: the default production state is OFF — flagIsOn() is false with nothing configured, so boot() returns before touching window.ICU, installLiveGhis, or any store", () => {
  assert.equal(flagIsOn(), false);
});

test("recordDeps: no window.SMD_WARDSYNQ_RECORD, or one that failed to connect, is a DRY RUN — no store, no bus, never a crash", () => {
  const prior = globalThis.window;
  try {
    globalThis.window = {};
    assert.deepEqual(recordDeps({ makeActor, KIND, TIER }), { store: null, bus: null });
    globalThis.window = { SMD_WARDSYNQ_RECORD: { tenantId: "gimsr", error: "tenant not found", code: "no_tenant" } };
    assert.deepEqual(recordDeps({ makeActor, KIND, TIER }), { store: null, bus: null }, "an ERRORED record connection is still a dry run, not a crash");
  } finally {
    globalThis.window = prior;
  }
});

test("recordDeps: a connected record session yields a store bound to a FRESH ADAPTER actor, never the signed-in doctor's own actor", () => {
  const prior = globalThis.window;
  try {
    let capturedActor = null;
    const fakeGoverned = {
      asStoreFor(actor) { capturedActor = actor; return { put: async () => {}, tag: "the-real-store" }; },
    };
    const humanActor = makeActor({ id: "fb:dr-menon", kind: KIND.HUMAN, tier: TIER.EXECUTE });
    globalThis.window = { SMD_WARDSYNQ_RECORD: { tenantId: "gimsr", governed: fakeGoverned, actor: humanActor, bus: { emit: async () => {} } } };
    const deps = recordDeps({ makeActor, KIND, TIER });
    assert.equal(deps.store.tag, "the-real-store", "the store comes from the EXISTING governed session, not a new one");
    assert.equal(deps.bus.emit && typeof deps.bus.emit, "function", "the SAME event bus the record connection already built");
    assert.equal(capturedActor.kind, "adapter", "never the doctor's own kind");
    assert.equal(capturedActor.tier, "draft", "capped at DRAFT by the existing actor model, whatever tier the signed-in doctor holds");
    assert.notEqual(capturedActor.id, humanActor.id, "a fresh adapter identity, not a copy of the doctor's own");
  } finally {
    globalThis.window = prior;
  }
});

test("mergeReports: sums counts across every wrapped method; mode is 'halted' if ANY door was halted, else 'live' if any is live", () => {
  const live = { method: "ingestWardHistory", mode: "live", bundlesSeen: 2, mapped: 2, written: 4, skippedDuplicate: 0, adapterErrors: 0, writeErrors: 0, observationsMapped: 4, issues: [], divergences: [], failures: [], lastAt: "t1", clinicalNote: "note" };
  const idle = { method: "ingestFromWard", mode: "off", bundlesSeen: 0, mapped: 0, written: 0, skippedDuplicate: 0, adapterErrors: 0, writeErrors: 0, observationsMapped: 0, issues: [], divergences: [], failures: [], lastAt: null, clinicalNote: null };
  const merged = mergeReports([live, idle]);
  assert.deepEqual(merged.methods, ["ingestWardHistory", "ingestFromWard"]);
  assert.equal(merged.mode, "live");
  assert.equal(merged.bundlesSeen, 2);
  assert.equal(merged.written, 4);
  assert.equal(merged.clinicalNote, "note");
  assert.equal(merged.byMethod.ingestWardHistory.written, 4, "per-door breakdown, not just the sum");

  const halted = { ...live, mode: "halted" };
  assert.equal(mergeReports([halted, idle]).mode, "halted", "a halt on EITHER door is not hidden by the other still being live");
});

test("REGRESSION: importing this module needs no browser — the exact gap wardsynq-shadow-boot.js already had, closed here from the start", () => {
  assert.equal(typeof hasAnyMethod, "function");
  assert.equal(typeof flagIsOn, "function");
  assert.equal(typeof mergeReports, "function");
  assert.equal(typeof recordDeps, "function");
});
