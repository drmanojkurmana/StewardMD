/* test/maik-quality-run.test.mjs — the quality harness's own logic (audit T19), no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checks, claimsOf, parity, runOneLatency, latencySummary, estOutTokens } from "../scripts/maik-quality-run.mjs";

test("objective checks: a real answer passes, a refusal / object leak / provider name fails", () => {
  const c = { expectedTopic: "cholangitis" };
  const good = "Acute cholangitis needs urgent biliary drainage (ERCP) within 24 to 48 hours plus antibiotics such as piperacillin-tazobactam; assess severity with the Tokyo guidelines.";
  assert.deepEqual(Object.values(checks(c, good)).every(Boolean), true);
  assert.equal(checks(c, "I can only help with medical and clinical questions.").notRefusal, false);
  assert.equal(checks(c, good + " [object Object]").noObject, false);
  assert.equal(checks(c, good + " Powered by Gemini.").noProvider, false);
  assert.equal(checks(c, "Pneumonia is treated with amoxicillin 1 g three times daily for five days in most adults.").onTopic, false);
});

test("parity: dose numbers only one engine gave are surfaced", () => {
  const p = parity("Amlodipine 5 mg daily; losartan 50 mg daily.", "Amlodipine 10 mg daily; losartan 50 mg daily.");
  assert.deepEqual(p.onlyCloudDoses, ["5mg"]); assert.deepEqual(p.onlyOfflineDoses, ["10mg"]);
  assert.ok(p.sharedDrugs.includes("amlodipine") && p.sharedDrugs.includes("losartan"));
  assert.deepEqual(claimsOf("no numbers here").doses, []);
});

test("latency: one call parses a stubbed SSE stream into ttfb/total/tokens", async () => {
  const enc = new TextEncoder();
  const frames = ['data: {"delta":"Hello world"}\n\n', 'data: {"done":true}\n\n'];
  let i = 0;
  const fetchStub = async () => ({ ok: true, status: 200, body: { getReader: () => ({
    async read() { return i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true, value: undefined }; },
  }) } });
  const row = await runOneLatency("q1", { base: "https://x.test", token: "tok", fetch: fetchStub });
  assert.equal(row.error, "");
  assert.equal(row.outTokens, estOutTokens("Hello world"));
  assert.ok(row.ttfbMs !== null && row.totalMs >= row.ttfbMs);
});

test("latency: HTTP error is recorded, not thrown", async () => {
  const fetchStub = async () => ({ ok: false, status: 500, body: null });
  const row = await runOneLatency("q1", { base: "https://x.test", token: "tok", fetch: fetchStub });
  assert.equal(row.error, "HTTP 500");
  assert.equal(row.ttfbMs, null);
});

test("latencySummary: p50/p95 maths over totalMs/ttfbMs/outTokens, errors excluded", () => {
  const rows = [
    { totalMs: 100, ttfbMs: 10, outTokens: 5, error: "" },
    { totalMs: 200, ttfbMs: 20, outTokens: 7, error: "" },
    { totalMs: 300, ttfbMs: 30, outTokens: 9, error: "" },
    { totalMs: 0, ttfbMs: null, outTokens: 0, error: "HTTP 500" },
  ];
  const s = latencySummary(rows, "https://x.test");
  assert.equal(s.cases, 4);
  assert.equal(s.errors, 1);
  assert.equal(s.totalMsP50, 200);
  assert.equal(s.totalMsP95, 300);
  assert.equal(s.ttfbMsP50, 20);
  assert.equal(s.ttfbMsP95, 30);
  assert.equal(s.outTokensP50, 7);
  assert.equal(s.outTokensP95, 9);
});
