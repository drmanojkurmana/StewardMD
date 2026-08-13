/* test/opd-investigations.test.mjs — doctor-dictated investigation capture.
 * "let's do CBC, LFT, RFT" -> ["CBC","LFT","RFT"] for the Management plan. Short acronyms are
 * word-bounded so they can't false-match inside another word. node --test test/opd-investigations.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { _detectInvestigations } = require("../opd-emr.js");

test("captures a spoken order list", () => {
  assert.deepEqual(_detectInvestigations("ok let's do CBC, LFT and RFT for him"), ["CBC", "LFT", "RFT"]);
});

test("matches aliases and multi-word panels", () => {
  const got = _detectInvestigations("send complete blood count, chest x-ray, thyroid function and an ECG");
  assert.ok(got.includes("CBC") && got.includes("Chest X-ray") && got.includes("Thyroid profile") && got.includes("ECG"));
});

test("dedups and returns first-seen order", () => {
  assert.deepEqual(_detectInvestigations("CBC now, repeat CBC tomorrow, also ESR"), ["CBC", "ESR"]);
});

test("short acronyms are word-bounded (no false hits)", () => {
  // "description" contains "crp"? no. "professor" contains no acronym. Guard against substring hits.
  assert.deepEqual(_detectInvestigations("the professor described the abgestment"), []);  // 'abg' must not hit inside a word
});

test("empty / no investigations -> empty", () => {
  assert.deepEqual(_detectInvestigations("patient has fever and cough for three days"), []);
});
