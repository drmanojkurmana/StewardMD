/* test/voice-ambient-scribe.test.mjs -- Ambient scribe: 15s rolling chunks + accumulation + refine trigger.
 * Tests accumulate (dedupes overlap) and needsRefine (fires every N and on final).
 * node --test test/voice-ambient-scribe.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const AMB = require("../voice-ambient.js");

test("accumulate joins chunks + trims overlap", () => {
  let t = AMB.accumulate("", "patient has fever");
  t = AMB.accumulate(t, "fever for three days");
  assert.match(t, /fever for three days/);
  assert.ok(t.length < "patient has fever fever for three days".length + 5);
});

test("needsRefine fires every N and on final", () => {
  assert.equal(AMB.needsRefine({ chunkN: 3, refineEveryChunks: 3, final: false }), true);
  assert.equal(AMB.needsRefine({ chunkN: 2, refineEveryChunks: 3, final: false }), false);
  assert.equal(AMB.needsRefine({ chunkN: 2, refineEveryChunks: 3, final: true }), true);
});
