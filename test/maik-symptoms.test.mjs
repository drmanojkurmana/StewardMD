/* MaiK symptom->approach layer: presentation queries ("fever", "chest pain") return a conservative
 * first-approach (common + can't-miss + workup + red flags); a real disease query does NOT hijack it;
 * the flag disables it. Also checks maik-kb compose() serves the symptom answer on a KB-miss.
 * node --test test/maik-symptoms.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
global.window = global;
const SX = require("../kb/ai/maik-symptoms.js");

test("common presentations return a structured first-approach", () => {
  ["fever", "chest pain", "breathlessness", "headache", "abdominal pain", "dizziness", "syncope", "low back pain"].forEach((q) => {
    const r = SX.compose(q);
    assert.ok(r && r.text, "no answer for: " + q);
    assert.match(r.text, /Can't-miss/i, "missing can't-miss for: " + q);
    assert.match(r.text, /Red flags/i, "missing red flags for: " + q);
    assert.match(r.text, /verify/i, "missing verify caveat for: " + q);
  });
});

test("lead-ins still match ('how to approach fever', 'workup of chest pain')", () => {
  assert.ok(SX.compose("how to approach fever"));
  assert.ok(SX.compose("workup of chest pain"));
});

test("a specific disease query does NOT hit the symptom layer", () => {
  assert.equal(SX.compose("diabetic ketoacidosis management"), null);
  assert.equal(SX.compose("pulmonary tuberculosis treatment"), null);
});

test("maik-kb compose() serves the symptom answer on a KB-miss", () => {
  // load the real KB so resolveTarget behaves normally, then a symptom miss should route to the layer
  ["kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/dist/kb.rag.js"].forEach(function (p) {
    (0, eval)(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
  });
  const KB = require("../kb/ai/maik-kb.js");
  const r = KB.compose("fever", {}, {});
  assert.ok(r && /Can't-miss/i.test(r.text || ""), "compose() should serve the fever symptom approach on a KB-miss");
});
