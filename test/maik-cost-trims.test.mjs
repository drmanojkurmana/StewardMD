/* MaiK Cloud prompt trims from the 2026-10-02 cost audit. Each one removes tokens that did not change
 * the answer: the stewardship block on questions that are not about antimicrobial choice, a second
 * copy of a long pasted question, retrieved notes past the top 5, and the two-tier rule in the
 * bottom-line-only call (which states its own shape). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { renderGroundedPrompt } = await import("../functions/api/ai/[[path]].js");
const SRC = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");

const STW = { refs: { stewardship: [{ deescalation: "Narrow to the culture result at 48-72 h.", framework: ["Start broad, then narrow."] }] } };

test("stewardship goes with antimicrobial-choice questions only", () => {
  assert.match(renderGroundedPrompt(Object.assign({ question: "when can I de-escalate meropenem in pneumonia" }, STW), 16000), /ANTIBIOTIC STEWARDSHIP/);
  assert.match(renderGroundedPrompt(Object.assign({ question: "first line antibiotic for CAP" }, STW), 16000), /ANTIBIOTIC STEWARDSHIP/);
  assert.doesNotMatch(renderGroundedPrompt(Object.assign({ question: "what are the complications of pneumonia" }, STW), 16000), /ANTIBIOTIC STEWARDSHIP/);
});

test("a long pasted question is not repeated at the end; a short one still is", () => {
  const long = "Compare these two answers. " + "x ".repeat(400);
  const out = renderGroundedPrompt({ question: long }, 16000);
  assert.equal(out.split("x x x x x").length - 1 >= 1, true);
  assert.doesNotMatch(out, /=== CLINICIAN QUESTION ===\n/);
  assert.match(renderGroundedPrompt({ question: "dose of atropine in OP poisoning" }, 16000), /=== CLINICIAN QUESTION ===\ndose of atropine/);
});

test("retrieved notes stop at the top 5", () => {
  const retrieved = Array.from({ length: 8 }, (_, i) => ({ diseaseId: "d" + i, section: "s", text: "Distinct note number " + i + " about something specific." }));
  const out = renderGroundedPrompt({ question: "q about notes", retrieved }, 16000);
  assert.match(out, /note number 4/);
  assert.doesNotMatch(out, /note number 5/);
});

test("the bottom-line-only call drops the two-tier rule; the full prompt keeps it", () => {
  assert.match(SRC, /const TWO_TIER_RULE = "- TWO-TIER ANSWER/);
  assert.match(SRC, /body\.tier === 1\) sysA = sysA\.replace\(TWO_TIER_RULE, ""\)/);
});
