/* test/maik-model-corrupt.test.mjs — a corrupt on-device model must not be a dead end.
 *
 * REPORTED 2026-08-24: MaiK MxCore installed, every answer failed, and the new error message finally
 * named the cause - "model corrupted".
 *
 * Integrity in maik-models.js is byte-length + GGUF magic, deliberately NOT a full SHA-256 of 2.5 GB
 * read back through the bridge. A download resumed from the wrong offset can hit the exact expected
 * length with corrupt bytes inside, pass that check and be marked installed. llama.cpp then refuses
 * it. Nothing acted on that refusal, so the pack stayed "installed", every question failed, and there
 * was no way to recover from inside the app.
 *
 * Clearing only the localStorage marker would NOT work: installed() re-checks the size, it still
 * matches, and it marks the pack installed again. The bad file has to go.
 *
 * node --test test/maik-model-corrupt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const LOCAL = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const MODELS = readFileSync(new URL("../maik-models.js", import.meta.url), "utf8");

test("REGRESSION: a load failure reported as corrupt removes the unusable pack", () => {
  const i = LOCAL.indexOf("A CORRUPT MODEL IS A DEAD END");
  assert.ok(i > -1, "the recovery path must exist");
  const blk = LOCAL.slice(i, i + 1800);
  assert.match(blk, /model-corrupted\|corrupt\|failed to load/, "matches what the plugin actually reports");
  assert.match(blk, /M\.remove\(packId\)/, "the file is deleted, not just unmarked");
  assert.match(blk, /_loadedPack = null/, "and the cached load is dropped");
});

test("the corrupt path rethrows a stable code the UI can branch on", () => {
  const i = LOCAL.indexOf("A CORRUPT MODEL IS A DEAD END");
  const blk = LOCAL.slice(i, i + 1800);
  assert.match(blk, /code = "model-corrupted"/);
});

test("a non-corrupt load error is NOT treated as corruption", () => {
  const i = LOCAL.indexOf("A CORRUPT MODEL IS A DEAD END");
  const blk = LOCAL.slice(i, i + 1800);
  assert.match(blk, /throw err;/, "anything else propagates untouched - never delete 2.5 GB on a guess");
});

test("removing a pack really does clear the marker AND the file", () => {
  const i = MODELS.indexOf("function remove(id)");
  assert.ok(i > -1);
  const fn = MODELS.slice(i, i + 500);
  assert.match(fn, /lrem\(MARK_PREFIX \+ id\)/, "marker");
  assert.match(fn, /modelDelete/, "and the file, or installed() would re-mark it on size");
});

test("installed() still checks size only — the assumption this fix is built on", () => {
  const i = MODELS.indexOf("function installed(id)");
  const fn = MODELS.slice(i, i + 600);
  assert.match(fn, /sizeOf\(f\.name\)/);
  assert.equal(/sha256/i.test(fn), false,
    "no on-device hashing: that is WHY a wrong-offset resume can pass as installed");
});
