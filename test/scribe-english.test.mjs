/* test/scribe-english.test.mjs — SAFETY REGRESSION GUARD.
 * Both LLM extractors write into the SAME GHIS narrative fields and feed MaiK's English-keyword
 * diagnosis engine. If either prompt stops forcing English, Telugu/Hindi script lands in the chart
 * and MaiK misdiagnoses. These tests must stay green — do not weaken the prompts.
 * node --test test/scribe-english.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessmentExtractPrompt } from "../functions/api/ai/_assessment-extract.js";
import { scribeExtractPrompt } from "../functions/api/ai/_opd-scribe.js";

function forcesEnglish(p) {
  const s = String(p).toLowerCase();
  return s.includes("english") && s.includes("translat");
}

test("opd-scribe prompt forces English + forbids native script", () => {
  const p = scribeExtractPrompt("జ్వరం మూడు రోజుల నుండి, ceftriaxone one gram IV BD");
  assert.ok(forcesEnglish(p), "must instruct English output + translation");
  assert.match(p, /telugu|devanagari/i, "must explicitly forbid Telugu/Devanagari script");
  assert.match(p, /drug|dose|unit|abbrev/i, "must preserve drug/dose/unit/abbrev exactly");
});

test("assessment-extract prompt forces English + forbids native script", () => {
  const p = assessmentExtractPrompt("बुखार तीन दिन से है");
  assert.ok(forcesEnglish(p), "must instruct English output + translation");
  assert.match(p, /telugu|devanagari/i, "must explicitly forbid Telugu/Devanagari script");
});
