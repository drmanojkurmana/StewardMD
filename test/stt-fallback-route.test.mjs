/* stt-fallback-route.test.mjs - the real /api/ai/transcribe handler spends the fallback credit only on
 * success and refuses with 402 stt-fallback-exhausted once the month's wallet is used up. */
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
const spent = (kv) => { const k = [...kv._m.keys()].find((x) => x.startsWith("stt:fb:")); return k ? JSON.parse(kv._m.get(k)).spent : 0; };
// The per-user 3 s rate limit sits in front; clear it between calls so each call reaches the wallet.
const clearRate = (kv) => { for (const k of [...kv._m.keys()]) if (k.startsWith("maik:rl:")) kv._m.delete(k); };
const BASE = { AI_PROVIDER: "developer", GEMINI_API_KEY: "k", PRO_FREE_UNTIL: "2000-01-01" };

test("guest (free, Rs 10): one 5-minute fallback succeeds and is charged Rs 6; the next is refused", async () => {
  const kv = fakeKv(), env = Object.assign({ MAIK_KV: kv }, BASE);
  const a = await transcribe(env, 300000, true);
  assert.equal(a.status, 200);
  assert.equal(a.body.transcript, "bp 120 by 80");
  assert.equal(spent(kv), 600);
  clearRate(kv);
  const b = await transcribe(env, 300000, true);
  assert.equal(b.status, 402);
  assert.equal(b.body.error, "stt-fallback-exhausted");
  assert.equal(b.body.allowanceInr, 10);
  assert.equal(spent(kv), 600, "a refused call spends nothing");
});

test("a failed transcription spends nothing", async () => {
  const kv = fakeKv(), env = Object.assign({ MAIK_KV: kv }, BASE);
  try { await transcribe(env, 60000, false); } catch (e) {}
  assert.equal(spent(kv), 0);
});

test("kill switch STT_FALLBACK_CREDITS_ON=0: unmetered", async () => {
  const kv = fakeKv(), env = Object.assign({ MAIK_KV: kv, STT_FALLBACK_CREDITS_ON: "0" }, BASE);
  const a = await transcribe(env, 900000, true);
  assert.equal(a.status, 200);
  assert.equal(spent(kv), 0);
});
