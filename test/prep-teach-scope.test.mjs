// PrepNucleus Ask MaiK answers medical study questions only (owner 2026-11-19: it answered "Who is India's PM").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outOfScope, SCOPE_REFUSAL, CHAT_SYSTEM } from "../functions/api/ai/_prep-teach.js";

test("non-medical asks are refused by the shared firewall; chat follow-ups and medical asks are not", () => {
  for (const q of ["Who is indias pm", "Who is pm of india", "who won the world cup", "write a python code", "tell me a joke", "what is the capital of france"]) assert.equal(outOfScope(q), true, q);
  for (const q of ["Why not B?", "Give a mnemonic", "Explain simply", "Criteria?", "Levels above?", "what is the eGFR formula", "what is PCOD?", "thanks"]) assert.equal(outOfScope(q), false, q);
});
test("the server refuses before quota, tokens or a model call, and the prompt carries the same rule", () => {
  const src = readFileSync(new URL("../functions/api/ai/_prep-teach.js", import.meta.url), "utf8");
  const gate = src.indexOf("outOfScope(lastU.t)"), quota = src.indexOf("checkQuota(env, request"), model = src.indexOf("await callGemini(");
  assert.ok(gate > 0 && gate < quota && gate < model, "scope gate runs first");
  assert.match(CHAT_SYSTEM, /SCOPE:/); assert.ok(CHAT_SYSTEM.includes(SCOPE_REFUSAL), "the model refuses with the same line");
  assert.match(CHAT_SYSTEM, /Never refuse a medical question/);
  assert.doesNotMatch(SCOPE_REFUSAL, /[—–]/);
});
test("the app refuses on the phone too, with the same line and no model run", () => {
  const src = readFileSync(new URL("../prep-ask.js", import.meta.url), "utf8");
  assert.ok(src.includes('"' + SCOPE_REFUSAL + '"'), "same refusal text in the app");
  assert.match(src, /if \(offTopic\(txt\)\) \{[^}]*addTurn\(\{ r: "m", t: SCOPE_MSG, ok: true[^}]*\}\); return draw/);
});
