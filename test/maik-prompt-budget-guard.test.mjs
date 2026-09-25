/* Prompt-size guard (audit T19, 2026-09-25). KNOWLEDGE_SYS reached ~2,300 tokens, resent on every call,
 * before anyone noticed. Each budget is the declaration's size in source (a close proxy for the prompt
 * text) plus about 10% headroom. Growing a prompt past it is allowed, but deliberately: raise the number
 * here in the same change and say why. Zero tokens, runs in CI. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
const L = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

function span(src, name) {
  const i = src.indexOf("const " + name + " =") >= 0 ? src.indexOf("const " + name + " =") : src.indexOf("var " + name + " =");
  assert.ok(i >= 0, name + " is declared");
  const m = src.slice(i + 1).search(/\n\s*(const|function|export|let|var|async function) /);
  return m;
}
const BUDGET = { KNOWLEDGE_SYS: 8200, RAG_SYS: 3300, TUTOR_SYS: 4150, EVIDENCE_REVIEW_SYS: 3100, RESEARCH_SYS_SNIPPETS: 2250, MEDICAL_ONLY: 1420, ABSTAIN_RULE: 650 };
for (const [name, max] of Object.entries(BUDGET)) {
  test(`cloud prompt ${name} stays within its budget (${max} chars of source)`, () => {
    const n = span(S, name);
    assert.ok(n <= max, `${name} is ${n} chars; budget ${max}. Raise it deliberately if the growth is needed.`);
  });
}
test("offline SYSTEM_CORE stays within its budget", () => {
  const n = span(L, "SYSTEM_CORE");
  assert.ok(n <= 1900, `SYSTEM_CORE is ${n} chars; budget 1900`);
});
