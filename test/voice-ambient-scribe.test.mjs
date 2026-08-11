/* test/voice-ambient-scribe.test.mjs -- Ambient scribe: 15s rolling chunks + accumulation + refine trigger.
 * Tests accumulate (dedupes overlap, handles punctuation, guards 1-word dedup) and needsRefine.
 * node --test test/voice-ambient-scribe.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const AMB = require("../voice-ambient.js");

test("accumulate: empty prev returns chunk", () => {
  assert.equal(AMB.accumulate("", "patient has fever"), "patient has fever");
});

test("accumulate: joins chunks + trims multi-word overlap", () => {
  // Real case: 2+ word re-hear at seam
  let t = AMB.accumulate("", "patient has severe fever");
  t = AMB.accumulate(t, "severe fever is concerning");
  // "severe fever" matches at boundary → trimmed
  assert.match(t, /patient has severe fever is concerning/);
  assert.equal(t.match(/severe/g).length, 1, "severe appears once, not duplicated");
});

test("accumulate: punctuation at seam deduped", () => {
  // Whisper adds period; normalization strips it; multi-word overlap survives
  const result = AMB.accumulate("patient has severe fever.", "severe fever is concerning");
  // "severe fever." (normalized: "severe fever") matches "severe fever" at start
  assert.match(result, /patient has severe fever is concerning/);
  assert.equal(result.match(/severe/g).length, 1, "severe appears once despite punctuation");
});

test("accumulate: single-word overlap NOT trimmed (protects no/the)", () => {
  const result = AMB.accumulate("no fever", "fever is not serious");
  // Single-word overlap "fever" is NOT trimmed (2+ word rule)
  assert.match(result, /no fever fever is not serious/);
});

test("accumulate: full-duplicate chunk has no trailing space", () => {
  const result = AMB.accumulate("patient has fever", "patient has fever");
  assert.equal(result, "patient has fever");
  assert.ok(!result.endsWith(" "), "no trailing space");
});

test("accumulate: no overlap appends cleanly", () => {
  const result = AMB.accumulate("patient is here", "different topic entirely");
  assert.match(result, /patient is here different topic entirely/);
});

test("needsRefine fires every N and on final", () => {
  assert.equal(AMB.needsRefine({ chunkN: 3, refineEveryChunks: 3, final: false }), true);
  assert.equal(AMB.needsRefine({ chunkN: 2, refineEveryChunks: 3, final: false }), false);
  assert.equal(AMB.needsRefine({ chunkN: 2, refineEveryChunks: 3, final: true }), true);
});

test("needsRefine guards against 0/undefined", () => {
  assert.equal(AMB.needsRefine({ chunkN: 2, refineEveryChunks: 0, final: false }), false);
  assert.equal(AMB.needsRefine({ chunkN: 2, refineEveryChunks: undefined, final: false }), false);
  assert.equal(AMB.needsRefine({ chunkN: 0, refineEveryChunks: 3, final: false }), false);
});
