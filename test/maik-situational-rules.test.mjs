/* test/maik-situational-rules.test.mjs - the MCQ and pasted-text rules ride along only on the
 * questions that need them (owner transcripts 2026-10-01: Oncotype "31 is the only option", a biopsy
 * MCQ flipped when told the key, "which answer is better, 1 or 2?" answered as a clinical question). */
import { test } from "node:test";
import assert from "node:assert/strict";
const { situationalRules, MCQ_RULE, PASTE_RULE } = await import("../functions/api/ai/[[path]].js");

test("an A/B/C/D question gets the MCQ rule", () => {
  const q = "Oncotype DX 21 recurrence score shows high risk at ?\nA) 10\nB) 18\nC) 31\nD) 40";
  assert.ok(situationalRules(q).includes(MCQ_RULE));
});

test("the key-disagreement follow-up still gets it", () => {
  assert.ok(situationalRules("Answer he gave is D").includes(MCQ_RULE));
});

test("a long paste with a judge-it ask gets the paste rule", () => {
  const q = "TCHP: docetaxel 75 mg/m2 ... ".repeat(40) + "This is answer 2. Who answered better? Just tell me 1 or 2 why";
  assert.ok(situationalRules(q).includes(PASTE_RULE));
});

test("an ordinary question gets neither", () => {
  assert.equal(situationalRules("PMRT in breast cancer: mandatory in whom?"), "");
  assert.equal(situationalRules("How to treat UTI in a 30 year old woman"), "");
});
