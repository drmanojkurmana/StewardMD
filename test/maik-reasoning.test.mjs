/* test/maik-reasoning.test.mjs — MaiK Ask reasoning provider abstraction (Phase A).
 * The seam must NEVER surface an unvalidated LLM response as a clinical action: unknown actions /
 * off-pathway fields are rejected, an unusable response falls back to the predefined pathway question,
 * and extraction keeps only explicit, in-pathway, typed findings. node --test test/maik-reasoning.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../maik-reasoning.js");

const PATHWAY = {
  id: "headache",
  fields: { location: { ask: "one side or both" }, severity: { ask: "how severe" } },
  associated: { nausea: {} },
  redFlags: { thunderclap_onset: { ask: "did it start suddenly" } }
};
// mock provider: returns whatever the test queues; retry ("constrained") returns the 2nd item
function mockProvider(nextSeq, extractSeq) {
  let ni = 0, ei = 0;
  return {
    next: () => nextSeq[Math.min(ni++, nextSeq.length - 1)],
    extract: () => extractSeq[Math.min(ei++, extractSeq.length - 1)]
  };
}

test("valid question passes through validated", async () => {
  R.setProvider(mockProvider([{ action: "ask", question: "Is it one side or both?", targetField: "location", priority: "high", reason: "x" }], [{}]));
  const q = await R.generateNextQuestion({ pathway: PATHWAY, targetField: "location" });
  assert.equal(q.action, "ask");
  assert.equal(q.targetField, "location");
  assert.match(q.question, /one side/);
});

test("unknown action is rejected -> retry -> fallback to pathway template", async () => {
  // first response has a forbidden action (e.g. the LLM tried to 'diagnose'); retry also invalid
  R.setProvider(mockProvider([{ action: "diagnose", question: "You have migraine" }, { action: "prescribe" }], [{}]));
  const q = await R.generateNextQuestion({ pathway: PATHWAY, targetField: "location" });
  assert.equal(q.action, "ask");
  assert.match(q.reason, /fallback/);
  assert.ok(!/migraine/i.test(q.question), "must never surface the LLM's rejected text");
});

test("off-pathway targetField is rejected", () => {
  const bad = R._validateNextQuestion({ action: "ask", question: "q?", targetField: "blood_pressure" }, PATHWAY);
  assert.equal(bad, null);
  const ok = R._validateNextQuestion({ action: "ask", question: "q?", targetField: "headache.location" }, PATHWAY);
  assert.equal(ok.action, "ask");
});

test("extract keeps only explicit, in-pathway, typed findings", async () => {
  R.setProvider(mockProvider([{}], [{ findings: [
    { field: "headache.location", value: "right-sided", confidence: 0.96 },
    { field: "nausea", value: "present", confidence: 2 },     // bad confidence -> clamped to 0.5
    { field: "made_up_field", value: "x", confidence: 0.9 },  // off-pathway -> dropped
    { field: "severity", value: "", confidence: 0.9 }         // empty value -> dropped
  ] }]));
  const r = await R.extractPatientAnswer({ pathway: PATHWAY }, "right side lo undi, nausea undi");
  assert.deepEqual(r.findings.map(f => f.field).sort(), ["location", "nausea"]);
  assert.equal(r.findings.find(f => f.field === "nausea").confidence, 0.5);
});

test("provider throwing never crashes -> fallback question", async () => {
  R.setProvider({ next: () => { throw new Error("boom"); }, extract: () => { throw new Error("boom"); } });
  const q = await R.generateNextQuestion({ pathway: PATHWAY, targetField: "severity" });
  assert.equal(q.action, "ask");
  const e = await R.extractPatientAnswer({ pathway: PATHWAY }, "text");
  assert.deepEqual(e.findings, []);
});

test("detectLanguage: local script detection + code-switch", () => {
  assert.equal(R.detectLanguage("తలనొప్పి రెండు రోజులు").primary, "telugu");
  const mixed = R.detectLanguage("Right side lo headache undi");
  assert.equal(mixed.primary, "telugu");
  assert.equal(mixed.style, "mixed");
  assert.equal(R.detectLanguage("I have a headache").primary, "english");
});
