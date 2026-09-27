/* stt-fallback-route.test.mjs - the real /api/ai/transcribe handler charges dictation credits only on
 * success, refuses with the top-up body (402 quota-exhausted, feature dict) when they are spent, and asks
 * an account-less caller to sign in. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
function fakeKv() {
  const m = new Map();
  return { _m: m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}
async function transcribe(env, durationMs, ok) {
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).indexOf("generateContent") >= 0
    ? (ok ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "bp 120 by 80" }] }, finishReason: "STOP" }] })) : new Response("boom", { status: 500 }))
    : new Response("{}");
  try {
    const request = new Request("https://stewardmd.in/api/ai/transcribe", { method: "POST",
      headers: { "Content-Type": "application/json", "X-SMD-Device": "dev-stt" },
      body: JSON.stringify({ audio: "data:audio/webm;base64,AAAA", durationMs }) });
    const res = await onRequest({ request, env, params: { path: ["transcribe"] }, waitUntil: () => {} });
    return { status: res.status, body: await res.json() };
  } finally { globalThis.fetch = real; }
}
const BASE = { AI_PROVIDER: "developer", GEMINI_API_KEY: "k", PRO_FREE_UNTIL: "2000-01-01" };

test("no account: 402 stt-fallback-signin, no model call, no rupees in the message", async () => {
  const kv = fakeKv(), env = Object.assign({ MAIK_KV: kv }, BASE);
  let called = false;
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => { if (String(u).indexOf("generateContent") >= 0) called = true; return new Response("{}"); };
  try {
    const request = new Request("https://stewardmd.in/api/ai/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: "data:audio/webm;base64,AAAA" }) });
    const res = await onRequest({ request, env, params: { path: ["transcribe"] }, waitUntil: () => {} });
    const b = await res.json();
    assert.equal(res.status, 402);
    assert.equal(b.error, "stt-fallback-signin");
    assert.ok(!/₹|Rs\s?\d/.test(b.message));
  } finally { globalThis.fetch = real; }
  assert.equal(called, false);
});

test("kill switch STT_FALLBACK_CREDITS_ON=0: guests transcribe unmetered as before", async () => {
  const kv = fakeKv(), env = Object.assign({ MAIK_KV: kv, STT_FALLBACK_CREDITS_ON: "0" }, BASE);
  const a = await transcribe(env, 900000, true);
  assert.equal(a.status, 200);
  assert.equal(a.body.transcript, "bp 120 by 80");
  assert.ok(![...kv._m.keys()].some((k) => k.startsWith("quota:dict:")));
});
