/* test/icd-suggest.test.mjs — MaiK ICD suggestion prompt/sanitizer: pure, no network/LLM/D1.
 *
 * node --test test/icd-suggest.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { icdSuggestPrompt, sanitizeIcdSuggest } from "../functions/api/ai/_icd-suggest.js";

const CANDIDATES = [
  { id: "icd10:E11.9", system: "ICD-10", code: "E11.9", title: "Type 2 diabetes mellitus without complications" },
  { id: "icd11:5A11", system: "ICD-11", code: "5A11", title: "Type 2 diabetes mellitus" },
  { id: "icd10:E10.9", system: "ICD-10", code: "E10.9", title: "Type 1 diabetes mellitus without complications" },
];

test("icdSuggestPrompt: embeds the doctor's text and every candidate's id/system/code/title, instructs no invention", () => {
  const p = icdSuggestPrompt("58F, known T2DM, HbA1c 9.1", CANDIDATES);
  assert.ok(p.includes("58F, known T2DM, HbA1c 9.1"));
  assert.ok(p.includes("icd10:E11.9 | ICD-10 | E11.9 | Type 2 diabetes mellitus without complications"));
  assert.ok(p.includes("icd11:5A11 | ICD-11 | 5A11 | Type 2 diabetes mellitus"));
  assert.ok(/never invent/i.test(p));
  assert.ok(/EXACTLY/.test(p));
});

test("icdSuggestPrompt: an empty candidate list still produces a valid prompt (server 'none found' fallback)", () => {
  const p = icdSuggestPrompt("some diagnosis", []);
  assert.ok(p.includes("(none found)"));
});

test("sanitizeIcdSuggest: only ids present in the candidate list survive, with the CANDIDATE's own fields, not the model's", () => {
  const parsed = { suggestions: [
    { id: "icd10:E11.9", confidence: "high", why: "Explicit T2DM history stated." },
    { id: "icd10:Z99.9", confidence: "high", why: "hallucinated code not in candidates" }, // must be dropped
  ] };
  const out = sanitizeIcdSuggest(parsed, CANDIDATES);
  assert.equal(out.suggestions.length, 1);
  assert.equal(out.suggestions[0].id, "icd10:E11.9");
  assert.equal(out.suggestions[0].code, "E11.9");
  assert.equal(out.suggestions[0].title, "Type 2 diabetes mellitus without complications");
});

test("sanitizeIcdSuggest: dedupes repeated ids, caps at 6, defaults an invalid confidence to 'medium'", () => {
  const many = Array.from({ length: 10 }, () => ({ id: "icd10:E11.9", confidence: "urgent!!", why: "x" }));
  const out = sanitizeIcdSuggest({ suggestions: many }, CANDIDATES);
  assert.equal(out.suggestions.length, 1, "duplicate id collapses to one row");
  assert.equal(out.suggestions[0].confidence, "medium");
});

test("sanitizeIcdSuggest: malformed/missing input degrades to an empty list, never throws", () => {
  assert.deepEqual(sanitizeIcdSuggest(null, CANDIDATES).suggestions, []);
  assert.deepEqual(sanitizeIcdSuggest({}, CANDIDATES).suggestions, []);
  assert.deepEqual(sanitizeIcdSuggest({ suggestions: "not-an-array" }, CANDIDATES).suggestions, []);
  assert.deepEqual(sanitizeIcdSuggest({ suggestions: [null, 42, "x"] }, CANDIDATES).suggestions, []);
});
