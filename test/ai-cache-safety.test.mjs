/* ai-cache-safety.test.mjs - the MaiK answer cache is SHARED ACROSS USERS (audit T01).
 *
 * Drives the real /api/ai/explain handler (non-stream path) with a fake KV and a fake Gemini, and
 * asserts on observed effects: a request carrying the asker's own context (history, About-me,
 * earlier topics) never reads or writes the cache, a different KB/retrieval never reuses an answer,
 * and body.regen skips the read but still writes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerCacheKey, cacheEligibleCtx, kbFingerprint } from "../functions/_maik_cache.js";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const Q = "what is the maintenance dose of amiodarone in atrial fibrillation";

function fakeKv() {
  const m = new Map();
  return {
    _m: m,
    get: async (k, t) => { if (!m.has(k)) return null; const v = m.get(k); return (t === "json" || (t && t.type === "json")) ? JSON.parse(v) : v; },
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async () => ({ keys: [], list_complete: true }),
  };
}
function harness() {
  const kv = fakeKv();
  const calls = { gen: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url && url.url ? url.url : url);
    if (u.indexOf("generateContent") >= 0) {
      calls.gen++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer " + calls.gen }] }, finishReason: "STOP" }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  const env = { AI_PROVIDER: "developer", GEMINI_API_KEY: "k", MAIK_ANSWER_CACHE: "1", MAIK_KV: kv };
  return { kv, calls, env, restore: () => { globalThis.fetch = real; } };
}
async function ask(env, body) {
  const waits = [];
  const request = new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const res = await onRequest({ request, env, params: { path: ["explain"] }, waitUntil: (p) => waits.push(p) });
  const j = await res.json();
  await Promise.allSettled(waits);
  return j;
}
const keys = (kv) => [...kv._m.keys()].filter((k) => k.startsWith("maik:ans:"));
const G = [{ diseaseId: "af", text: "Amiodarone dosing.", provenance: ["StewardMD KB"] }];

for (const [label, extra] of [
  ["conversation history", { history: [{ q: "af rate control", a: "beta blocker" }] }],
  ["an About-me line", { doctor: "Cardiologist in Pune, prefers ESC guidance" }],
  ["earlier topics", { earlier: ["heart failure"] }],
]) {
  test("a request carrying " + label + " is never read from or written to the shared cache", async () => {
    const h = harness();
    try {
      await ask(h.env, { question: Q, grounding: G });            // a clean answer is cached
      assert.equal(keys(h.kv).length, 1);
      const j = await ask(h.env, Object.assign({ question: Q, grounding: G }, extra));
      assert.equal(h.calls.gen, 2, "the personalised request must generate, not hit the cache");
      assert.notEqual(j.cached, true);
      assert.equal(keys(h.kv).length, 1, "and must not write its personalised answer back");
    } finally { h.restore(); }
  });
}

test("a different KB / retrieval does not reuse an answer", async () => {
  const h = harness();
  try {
    await ask(h.env, { question: Q, grounding: G });
    await ask(h.env, { question: Q, grounding: [{ diseaseId: "af", text: "x", provenance: ["ESC 2024"] }] });
    assert.equal(h.calls.gen, 2, "new provenance = new key");
    await ask(h.env, { question: Q, grounding: G, kbVersion: "kb-2026-10" });
    assert.equal(h.calls.gen, 3, "a new kbVersion = new key");
    await ask(h.env, { question: Q, grounding: G, sources: [{ n: 1, title: "ACC/AHA AF 2023" }] });
    assert.equal(h.calls.gen, 4, "different SOURCES = new key");
    const j = await ask(h.env, { question: Q, grounding: G });
    assert.equal(j.cached, true, "the original evidence set still hits");
  } finally { h.restore(); }
});

test("regen skips the cache READ but still WRITES the fresh answer", async () => {
  const h = harness();
  try {
    await ask(h.env, { question: Q, grounding: G });
    const r = await ask(h.env, { question: Q, grounding: G, regen: true });
    assert.equal(h.calls.gen, 2, "Regenerate must call the model");
    assert.equal(r.text, "answer 2");
    const j = await ask(h.env, { question: Q, grounding: G });
    assert.equal(j.cached, true);
    assert.equal(j.text, "answer 2", "the regenerated answer replaced the rejected one");
  } finally { h.restore(); }
});

test("unit: eligibility + fingerprint are order-independent and key-affecting", async () => {
  assert.equal(cacheEligibleCtx({}), true);
  assert.equal(cacheEligibleCtx({ history: [] , earlier: [], doctor: "  " }), true);
  assert.equal(cacheEligibleCtx({ doctor: "x" }), false);
  const a = kbFingerprint({ grounding: [{ diseaseId: "a", provenance: ["p1", "p2"] }], sources: [{ title: "S" }] });
  const b = kbFingerprint({ grounding: [{ diseaseId: "a", provenance: ["p2", "p1"] }], sources: [{ title: "S" }] });
  assert.equal(a, b);
  const sha = async (s) => Buffer.from(String(s)).toString("base64");
  assert.notEqual(await answerCacheKey(sha, {}, { question: Q, kb: a }), await answerCacheKey(sha, {}, { question: Q, kb: a + "x" }));
});
