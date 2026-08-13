/* test/maik-ask-server.test.mjs — MaiK Ask server prompts + sanitizers (Phase D).
 * The sanitizers are the server-side safety net: only allowed actions, only pathway-allowed fields,
 * explicit findings only. node --test test/maik-ask-server.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { maikNextPrompt, maikExtractPrompt, sanitizeMaikNext, sanitizeMaikExtract } from "../functions/api/ai/_maik-ask.js";

test("next prompt forbids doctoring + demands one JSON action", () => {
  const p = maikNextPrompt({ complaint: "headache", targetField: "location", targetHint: "one side or both", language: "te-en" });
  assert.match(p, /do NOT\s+diagnose/i);
  assert.match(p, /ask \| clarify \| finish \| alert_doctor/);
  assert.match(p, /ONE question only/i);
});

test("sanitizeMaikNext: unknown action -> safe finish (never surfaces LLM prose)", () => {
  assert.equal(sanitizeMaikNext({ action: "diagnose", question: "you have migraine" }).action, "finish");
  assert.equal(sanitizeMaikNext({ action: "prescribe", question: "take x" }).action, "finish");
  const ok = sanitizeMaikNext({ action: "ask", question: "Is it one side or both?", targetField: "location", priority: "high" });
  assert.equal(ok.action, "ask");
  assert.match(ok.question, /one side/);
  assert.equal(ok.priority, "high");
});

test("sanitizeMaikNext: ask with empty question downgrades to finish", () => {
  assert.equal(sanitizeMaikNext({ action: "ask", question: "  " }).action, "finish");
});

test("sanitizeMaikExtract: only allowed fields, explicit values, clamped confidence", () => {
  const r = sanitizeMaikExtract({ findings: [
    { field: "headache.location", value: "right-sided", confidence: 0.96 },
    { field: "nausea", value: "present", confidence: 5 },
    { field: "not_allowed", value: "x", confidence: 0.9 },
    { field: "severity", value: "", confidence: 0.9 }
  ] }, ["location", "nausea", "severity"]);
  assert.deepEqual(r.findings.map(f => f.field).sort(), ["location", "nausea"]);
  assert.equal(r.findings.find(f => f.field === "nausea").confidence, 0.5);
});

test("sanitizeMaikExtract: garbage -> empty findings", () => {
  assert.deepEqual(sanitizeMaikExtract(null, ["x"]).findings, []);
  assert.deepEqual(sanitizeMaikExtract({ findings: "nope" }, ["x"]).findings, []);
});
