/* Owner, 2026-09-24: balanced answers by default, with a one-tap Short / Balanced / Detailed choice that
 * every engine honours. Pinned at the three layers: the sheet, the cloud route, the on-device engine. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const S = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
const L = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
test("the sheet has the control and every clinical answer applies the preference", () => {
  assert.match(H, /id="maikLen"/);
  assert.match(H, /function runClinical\(question, retrieval, depth, active, topicLabel\) \{\n\s*depth = maikApplyLen\(depth\);/);
  const fn = new Function("localStorage", H.slice(H.indexOf("var MAIK_LEN = "), H.indexOf("function maikCycleLen()")) + "return maikApplyLen;");
  const mk = (v) => fn({ getItem: () => v });
  assert.equal(mk("medium")("concise"), "concise"); assert.equal(mk("medium")("detailed"), "detailed");
  assert.equal(mk("short")("concise"), "brief"); assert.equal(mk("short")("detailed"), "detailed", "an explicit 'in detail' wins over Short");
  assert.equal(mk("long")("concise"), "detailed"); assert.equal(mk(null)("concise"), "concise", "default is balanced");
});
test("the cloud route caps and instructs per length", () => {
  assert.match(S, /body\.depth === "brief"\) \? Math\.min\(OUT_BASE, 480\)/);
  assert.match(S, /LENGTH: SHORT\./); assert.match(S, /LENGTH: DETAILED\./);
});
test("the on-device engine caps and instructs per length", () => {
  assert.match(L, /depth === "brief"\) \{ common\.nPredict = Math\.min\(common\.nPredict, 400\)/);
  assert.match(L, /LENGTH: BALANCED\./); assert.match(L, /LENGTH: DETAILED\./);
});
