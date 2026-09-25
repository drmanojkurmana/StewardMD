/* Owner, 2026-09-24: pressing Stop left "Searching evidence" and the thinking orbs running. The
 * composer's Stop calls _maikStop, which nothing ever assigned. runClinical now assigns it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../home.js", import.meta.url), "utf8");
test("runClinical assigns the Stop hook and it ends the render", () => {
  const i = SRC.indexOf("function runClinical(question, retrieval, depth, active, topicLabel)");
  const j = SRC.indexOf("_maikStop = function () {", i);
  assert.ok(i > 0 && j > i, "the Stop hook is assigned inside runClinical");
  const blk = SRC.slice(j, j + 1400);
  for (const re of [/_maikDone = true;/, /_clearStages\(\);/, /clearTimeout\(_maikTO\);/, /maikSetSendMode\(false\);/, /Stopped/])
    assert.match(blk, re);
});
test("the Stop button calls the hook and cancels the on-device engine", () => {
  const k = SRC.indexOf("function maikStopNow()");
  const blk = SRC.slice(k, k + 700);
  assert.match(blk, /SMD_MAIK_LOCAL\.cancel\(\)/); assert.match(blk, /_maikStop\(\)/);
});
