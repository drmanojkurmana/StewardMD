/* maik-scope-tool-requests.test.mjs - asking MaiK for a StewardMD TOOL is a clinical request.
 *
 * Why this file exists: on a Pixel 9 (MaiK Cloud), Edge handed "show me the resistance patterns
 * antibiogram" (twice) and "search icd teruvu" (after "Ask MaiK anyway") to MaiK, and MaiK replied
 * "I can only help with medical and clinical questions". The Intent Firewall had no signal for app
 * tool words, so the query reached the model as "uncertain", and the model's scope rule read an
 * app-navigation request as non-medical.
 *
 * Both halves are asserted: the firewall now recognises tool requests as clinical (certain), and
 * every prompt carrying the medical-only rule says tool requests are in scope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MaiKScope = require("../kb/ai/maik-scope.js");
const SERVER = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
const LOCAL = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

const TOOL_REQUESTS = [
  "show me the resistance patterns antibiogram",
  "search icd teruvu",
  "open antibiogram",
  "antibiogram kholo",
  "antibiogram chupinchu",
  "ICD code for this",
  "icd-10 search",
  "open the CURB-65 calculator",
  "qSOFA calculator kholo",
  "open drug index",
];

test("firewall: app tool requests carry a CERTAIN clinical signal", () => {
  for (const q of TOOL_REQUESTS) {
    const c = MaiKScope.classify(q);
    assert.equal(c.medical, true, "not read as clinical: " + q);
    assert.equal(c.certain, true, "clinical but uncertain: " + q);
    assert.equal(MaiKScope.isRefusable(q), false, "refused: " + q);
  }
});

test("firewall: genuinely non-medical requests are still refused", () => {
  for (const q of ["write me a poem about cricket", "who won the ipl", "plan my trip to goa"]) {
    assert.equal(MaiKScope.isRefusable(q), true, "should be refused: " + q);
  }
});

function assertToolClause(rule, where) {
  assert.match(rule, /StewardMD tool/i, where + " must say StewardMD tool requests are in scope");
  for (const w of ["antibiogram", "ICD", "calculator", "kholo", "teruvu"]) {
    assert.ok(rule.includes(w), where + " tool clause should name " + w);
  }
  assert.match(rule, /never refuse/i, where + " must forbid refusing a tool request");
}

test("cloud prompt: MEDICAL_ONLY puts app/tool requests in scope", () => {
  assertToolClause(SERVER.match(/const MEDICAL_ONLY =([\s\S]*?);\n/)[1], "MEDICAL_ONLY");
});

test("local prompts: SYSTEM_CORE and MEDICAL_ONLY_LOCAL put app/tool requests in scope", () => {
  assertToolClause(LOCAL.match(/var SYSTEM_CORE =([\s\S]*?);\n/)[1], "SYSTEM_CORE");
  assertToolClause(LOCAL.match(/var MEDICAL_ONLY_LOCAL =([\s\S]*?);\n/)[1], "MEDICAL_ONLY_LOCAL");
});
