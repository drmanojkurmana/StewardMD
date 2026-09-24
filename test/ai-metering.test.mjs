/* ai-metering.test.mjs - real token metering (T40) and per-request generation metadata (T41). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sseFrameUsage } from "../functions/_sse_parse.js";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const ADMIN = "admin-token-for-tests";
const USAGE = { promptTokenCount: 1234, candidatesTokenCount: 100, thoughtsTokenCount: 50, cachedContentTokenCount: 0 };

function fakeKv() {
  const m = new Map();
  return { _m: m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}
async function explain(env, body, { stream = false, query = "", headers = {} } = {}) {
  const waits = [];
  const h = Object.assign({ "Content-Type": "application/json", "X-SMD-Device": "dev-meter" }, headers);
  if (stream) h.Accept = "text/event-stream";
  const request = new Request("https://stewardmd.in/api/ai/explain" + (stream ? "?stream=1" : "") + query, { method: "POST", headers: h, body: JSON.stringify(body) });
  const res = await onRequest({ request, env, params: { path: ["explain"] }, waitUntil: (p) => waits.push(p) });
  const text = await res.text();
  await Promise.allSettled(waits);
  return text;
}
const userTokens = (kv) => { const k = [...kv._m.keys()].find((x) => x.startsWith("maik:u:")); return k ? JSON.parse(kv._m.get(k)).tokens : null; };

test("non-stream: recorded tokens are Gemini's usageMetadata (prompt + output + thinking), not chars/4", async () => {
  const kv = fakeKv();
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).indexOf("generateContent") >= 0
    ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "short" }] }, finishReason: "STOP" }], usageMetadata: USAGE }))
    : new Response("{}");
  try { await explain({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k", MAIK_KV: kv }, { question: "dose of amiodarone in af", grounding: [{ text: "x" }] }); }
  finally { globalThis.fetch = real; }
  assert.equal(userTokens(kv), 1234 + 100 + 50);
});

test("stream: the last SSE chunk's usageMetadata is what gets metered", async () => {
  const kv = fakeKv();
  const real = globalThis.fetch;
  const frames = ["data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: "hel" }] } }] }), "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: "lo" }] } }], usageMetadata: USAGE })].join("\r\n\r\n") + "\r\n\r\n";
  globalThis.fetch = async (u) => String(u).indexOf("streamGenerateContent") >= 0 ? new Response(frames, { headers: { "content-type": "text/event-stream" } }) : new Response("{}");
  try { await explain({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k", MAIK_KV: kv, MAIK_LIVE_STREAM: "1" }, { question: "dose of amiodarone in af", grounding: [{ text: "x" }] }, { stream: true }); }
  finally { globalThis.fetch = real; }
  assert.equal(userTokens(kv), 1384);
  assert.deepEqual(sseFrameUsage('data: {"usageMetadata":{"promptTokenCount":3}}'), { promptTokenCount: 3 });
  assert.equal(sseFrameUsage("data: [DONE]"), null);
});

test("no usageMetadata: falls back to the chars/4 estimate", async () => {
  const kv = fakeKv();
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).indexOf("generateContent") >= 0
    ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "x".repeat(400) }] } }] })) : new Response("{}");
  try { await explain({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k", MAIK_KV: kv }, { question: "dose of amiodarone in af", grounding: [{ text: "x" }] }); }
  finally { globalThis.fetch = real; }
  assert.ok(userTokens(kv) > 100, "prompt + 100-token output estimate");
});

test("concurrent requests never read each other's generation metadata", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (String(u).indexOf("generateContent") < 0) return new Response("{}");
    const slow = String(init.body).indexOf("alpha") >= 0;
    await new Promise((r) => setTimeout(r, slow ? 60 : 5));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "t" }] }, finishReason: slow ? "STOP" : "MAX_TOKENS" }], usageMetadata: { promptTokenCount: slow ? 11 : 22 } }));
  };
  const env = { AI_PROVIDER: "developer", GEMINI_API_KEY: "k", UPDATES_ADMIN_TOKEN: ADMIN };
  const opt = { query: "?diag=1", headers: { "X-Admin-Token": ADMIN } };
  try {
    const [a, b] = await Promise.all([
      explain(env, { question: "alpha question about sepsis", grounding: [{ text: "x" }] }, opt),
      explain(env, { question: "beta question about sepsis", grounding: [{ text: "x" }] }, opt),
    ]);
    const da = JSON.parse(a)._diag, db = JSON.parse(b)._diag;
    assert.equal(da.finishReason, "STOP");
    assert.equal(da.promptTok, 11);
    assert.equal(db.finishReason, "MAX_TOKENS");
    assert.equal(db.promptTok, 22);
  } finally { globalThis.fetch = real; }
});
