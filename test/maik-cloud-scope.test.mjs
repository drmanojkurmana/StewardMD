/* maik-cloud-scope.test.mjs — MaiK Cloud (Vertex/Gemini) answers medical questions ONLY.
 *
 * Why this file exists: a doctor ran a normal clinical conversation on a real phone and MaiK told
 * them, twice, that it "answers only medical and clinical questions" — for "What is PCOD?" and
 * "What is SGLT2 drugs mechanism of action?". The deterministic firewall was refusing its own
 * default-deny bucket, i.e. refusing every clinical term that happened not to be in a finite list.
 *
 * The boundary is now split in two, and BOTH halves are asserted here:
 *   1. deterministic  — refuse only what we can positively identify as non-clinical (cheap, no call)
 *   2. the model      — the uncertain tail reaches Vertex, which refuses non-medical itself
 *
 * The server prompt is a Cloudflare Pages function with runtime-only imports, so the wiring is
 * checked at SOURCE level. That is deliberate: the bug being guarded against is "somebody edits the
 * prompt and drops the scope rule", which is exactly a source-level regression.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MaiKScope = require("../kb/ai/maik-scope.js");
const SRC = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");

// The clinician-facing free-text answer prompts. Structured internal tasks (imaging, onco,
// extraction) are not open chat and intentionally carry no scope rule. RESEARCH_SYS (the Gemini
// grounded-search fallback prompt) was removed 2026-09-04 along with that fallback itself -
// RESEARCH_SYS_SNIPPETS is now the only web-research prompt, TinyFish-only, no Gemini fallback.
const CHAT_PROMPTS = ["KNOWLEDGE_SYS", "RESEARCH_SYS_SNIPPETS", "EVIDENCE_REVIEW_SYS"];

test("cloud: every clinician-facing prompt carries the medical-only scope rule", () => {
  assert.match(SRC, /const MEDICAL_ONLY\s*=/, "MEDICAL_ONLY must be defined once and shared");
  for (const name of CHAT_PROMPTS) {
    const m = SRC.match(new RegExp("const " + name + " =[\\s\\S]*?;\\n"));
    assert.ok(m, name + " not found");
    assert.ok(/\+ MEDICAL_ONLY;\s*$/.test(m[0]), name + " is missing MEDICAL_ONLY");
  }
});

test("cloud: the scope rule names a refusal line and refuses non-medical categories", () => {
  const m = SRC.match(/const MEDICAL_ONLY =([\s\S]*?);\n/);
  const rule = m[1];
  assert.match(rule, /I can only help with medical and clinical questions/);
  for (const cat of ["general knowledge", "geography", "sport", "programming", "travel"]) {
    assert.ok(rule.includes(cat), "scope rule should name " + cat);
  }
});

test("cloud: the scope rule explicitly forbids OVER-refusing a real clinical question", () => {
  // Without this clause the model becomes the new source of the exact bug being fixed: a doctor
  // asking about something obscure gets told their question is not medical.
  const rule = SRC.match(/const MEDICAL_ONLY =([\s\S]*?);\n/)[1];
  assert.match(rule, /unfamiliar/i);
  assert.match(rule, /must never be told their question is not medical/i);
  assert.match(rule, /ANSWER IT as a clinical question/i);
});

test("cloud: the server firewall uses the SHARED predicate, not its own copy", () => {
  // The client and server each had their own idea of "non-medical" and they drifted: the server
  // already excluded the uncertain bucket, the client did not, and the client is what doctors saw.
  const fw = SRC.match(/function firewallBlock\(q\)\s*\{[\s\S]*?\n\}/)[0];
  assert.match(fw, /isRefusable/);
  assert.ok(!/category !== "non_medical"/.test(fw), "should no longer hand-roll the predicate");
});

test("cloud: real clinical questions are never blocked before the model call", () => {
  for (const q of ["What is PCOD?", "What is SGLT2 drugs mechanism of action?", "PCOS management",
                   "DPP-4 inhibitor mechanism", "Side effects of Linagliptin", "half life of amiodarone",
                   "Polycystic Kidney Disease", "GLP-1 agonist in CKD", "BPH first line"]) {
    assert.equal(MaiKScope.isRefusable(q), false, "wrongly blocked: " + q);
  }
});

test("cloud: plainly non-medical questions never reach the model", () => {
  for (const q of ["what is ap capital", "what is the capital of andhra pradesh", "how to code",
                   "write me a python script", "who won the world cup", "tell me a joke",
                   "plan my trip to goa", "what's the weather today"]) {
    assert.equal(MaiKScope.isRefusable(q), true, "should be blocked free: " + q);
  }
});
