/* ai-explain-counting.test.mjs - /explain ordering and what counts as a question (T15, T36).
 * T15: a cache hit never reaches the Workers AI re-rank; metering + cache writes go to waitUntil.
 * T36: refine/verify and tier-2 do not consume the daily MaiK question cap; cache hits and failed
 * generations do not count; a generated answer counts exactly once. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const DAY = new Date().toISOString().slice(0, 10);

function fakeKv() {
  const m = new Map();
  return { _m: m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}
function setup({ fail = false } = {}) {
  const kv = fakeKv();
  const calls = { gen: 0, rerank: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => {
    if (String(u).indexOf("generateContent") >= 0) {
      calls.gen++;
      if (fail) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 400 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] } }] }));
    }
    return new Response("{}");
  };
  const env = { AI_PROVIDER: "developer", GEMINI_API_KEY: "k", MAIK_KV: kv, MAIK_ANSWER_CACHE: "1", MAIK_ENFORCE_CAPS: "1", MAIK_RATE_LIMIT_SECONDS: "0.001", MAIK_VERIFY: "1",
    AI: { run: async () => { calls.rerank++; return { response: [{ id: 0, score: 1 }, { id: 1, score: 0.5 }] }; } } };
  return { kv, calls, env, restore: () => { globalThis.fetch = real; } };
}
async function hit(env, seg, body) {
  const waits = [];
  const r = await onRequest({ request: new Request("https://stewardmd.in/api/ai/" + seg, { method: "POST", headers: { "Content-Type": "application/json", "X-SMD-Device": "dev-count" }, body: JSON.stringify(body) }), env, params: { path: [seg] }, waitUntil: (p) => waits.push(p) });
  const t = await r.text();
  await Promise.allSettled(waits);
  return { status: r.status, t };
}
const counted = (kv) => { const k = [...kv._m.keys()].find((x) => x.startsWith("aiu:mod:") && x.endsWith(":maik:" + DAY)); return k ? Number(kv._m.get(k)) : 0; };
const Q = { question: "maintenance dose of amiodarone in atrial fibrillation", grounding: [{ diseaseId: "af", text: "x" }], retrieved: [{ diseaseId: "af", text: "a" }, { diseaseId: "af", text: "b" }] };

test("a generated answer counts once; the cache hit that follows counts zero and skips the re-rank", async () => {
  const h = setup();
  try {
    await hit(h.env, "explain", Q);
    assert.equal(counted(h.kv), 1);
    assert.equal(h.calls.rerank, 1);
    const second = await hit(h.env, "explain", Q);
    assert.match(second.t, /"cached":true/);
    assert.equal(counted(h.kv), 1, "a cache hit must not use up a question");
    assert.equal(h.calls.rerank, 1, "a cache hit must not call the Workers AI re-rank");
    assert.equal(h.calls.gen, 1);
  } finally { h.restore(); }
});

test("a failed generation does not use up a question", async () => {
  const h = setup({ fail: true });
  try {
    const r = await hit(h.env, "explain", Q);
    assert.equal(r.status, 500);
    assert.equal(counted(h.kv), 0);
  } finally { h.restore(); }
});

test("tier-2 'Know more', /refine and /verify never count against the question cap", async () => {
  const h = setup();
  try {
    await hit(h.env, "explain", Object.assign({}, Q, { tier: 2, priorLead: "200 mg daily." }));
    await hit(h.env, "refine", { q: "amiodarone af dose" });
    await hit(h.env, "verify", { text: "Amiodarone 200 mg daily.", package: Q });
    assert.equal(counted(h.kv), 0);
  } finally { h.restore(); }
});

test("the per-user general counter (checkQuota) ignores cache hits too", async () => {
  const h = setup();
  try {
    await hit(h.env, "explain", Q);
    await hit(h.env, "explain", Q);
    const k = [...h.kv._m.keys()].find((x) => x.startsWith("maik:u:"));
    assert.equal(JSON.parse(h.kv._m.get(k)).general, 1);
  } finally { h.restore(); }
});
