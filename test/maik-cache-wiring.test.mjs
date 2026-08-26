/* maik-cache-wiring.test.mjs — the answer cache, EXERCISED rather than grepped.
 *
 * test/maik-cache.test.mjs unit-tests _maik_cache.js and then asserts the wiring by searching the
 * handler's SOURCE for the right ordering. That catches a re-ordering, but it cannot tell you whether
 * a KV write actually happens — and "the code is present and in the right order" was true of the
 * ORIGINAL bug too: the cache block existed and was correct, it was merely unreachable.
 *
 * So this drives the real exported onRequest() of functions/api/ai/[[path]].js over the live-stream
 * path with a fake KV and a fake Gemini upstream, and asserts on OBSERVED EFFECTS:
 *   - a streamed answer lands a maik:ans:* key in KV (this is the bug that was reported)
 *   - the next identical question is served FROM that key, with no upstream call at all
 *   - the same holds on the non-stream path
 *   - a case-commentary request (computed differential) is never cached
 *
 * Everything under test is the shipped handler; only KV, the clock-free upstream, and the provider
 * credentials are stand-ins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));

const QUESTION = "what is the maintenance dose of amiodarone in atrial fibrillation";
const ANSWER = "Amiodarone maintenance is typically 200 mg once daily after loading.";

function fakeKv() {
  const m = new Map();
  return {
    _m: m,
    keys: (prefix) => [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)),
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async (o) => ({ keys: [...m.keys()].filter((k) => !(o && o.prefix) || k.startsWith(o.prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

/* Gemini's streaming wire format: CRLF-delimited SSE frames. Chunked mid-answer on purpose, so the
 * accumulated `full` handed to the completion callback is genuinely reassembled from several reads. */
function upstreamSse(text) {
  const frames = text.match(/.{1,18}/gs).map((t) =>
    "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) + "\r\n\r\n");
  return new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
}

/* One harness per scenario: fresh KV, fresh upstream counter, fresh env. */
function harness(envOverrides) {
  const kv = fakeKv();
  const calls = { stream: 0, nonStream: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    if (u.indexOf("streamGenerateContent") >= 0) {
      calls.stream++;
      return new Response(upstreamSse(ANSWER), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (u.indexOf("generateContent") >= 0) {
      calls.nonStream++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: "STOP" }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    // Anything else this request happens to reach (re-rank, config probes) is not under test.
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = Object.assign({
    AI_PROVIDER: "developer",
    GEMINI_API_KEY: "test-key-not-real",
    MAIK_ANSWER_CACHE: "1",
    MAIK_LIVE_STREAM: "1",
    MAIK_KV: kv,
  }, envOverrides || {});
  return { kv, calls, env, restore: () => { globalThis.fetch = realFetch; } };
}

/* Drive one /api/ai/explain call and drain everything, including the waitUntil work the stream path
 * uses to write the cache AFTER the response has already been handed to the client. */
async function explain(env, { stream = true, body = null } = {}) {
  const waits = [];
  const url = "https://stewardmd.in/api/ai/explain" + (stream ? "?stream=1" : "");
  const headers = { "Content-Type": "application/json", Authorization: "Bearer test-user" };
  if (stream) headers.Accept = "text/event-stream";
  const request = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body || { question: QUESTION, grounding: [{ text: "Amiodarone dosing.", provenance: ["StewardMD KB"] }] }),
  });
  const res = await onRequest({ request, env, params: { path: ["explain"] }, waitUntil: (p) => waits.push(p) });
  const text = await res.text();                  // fully drain the SSE / JSON body
  await Promise.allSettled(waits);                // let the deferred cache write land
  return { res, text };
}

const cacheKeys = (kv) => kv.keys("maik:ans:");
const sseDeltas = (t) => t.split("\n").filter((l) => l.indexOf("data:") === 0)
  .map((l) => { try { return JSON.parse(l.slice(5)); } catch { return {}; } })
  .map((o) => o.delta || "").join("");

test("live-stream path WRITES the answer cache (the reported bug: maik:ans:* stayed empty)", async () => {
  const h = harness();
  try {
    const first = await explain(h.env);
    assert.equal(h.calls.stream, 1, "the upstream stream should have been called exactly once");
    assert.equal(sseDeltas(first.text), ANSWER, "the client must still receive the whole streamed answer");
    assert.equal(cacheKeys(h.kv).length, 1, "a streamed answer must leave exactly one maik:ans:* key in KV");
    const stored = JSON.parse(await h.kv.get(cacheKeys(h.kv)[0]));
    assert.equal(stored.text, ANSWER, "the cached payload must be the fully reassembled answer");
  } finally { h.restore(); }
});

test("live-stream path READS the cache: the second identical question costs no upstream call", async () => {
  const h = harness();
  try {
    await explain(h.env);
    assert.equal(h.calls.stream, 1);
    const second = await explain(h.env);
    assert.equal(h.calls.stream, 1, "a cache HIT must not call the provider again (this is the whole point)");
    assert.equal(h.calls.nonStream, 0, "a cache hit must not fall through to the non-stream call either");
    assert.equal(sseDeltas(second.text), ANSWER, "the cached answer is delivered over the same SSE channel");
  } finally { h.restore(); }
});

test("the cache is read BEFORE the stream opens, not after it returns", async () => {
  // The original defect in one assertion: with the cache pre-populated, a live-stream request must
  // never reach the provider. Pre-fix the early return fired first and the upstream was always hit.
  const h = harness();
  try {
    await explain(h.env);                       // populate
    h.calls.stream = 0;
    await explain(h.env);
    assert.equal(h.calls.stream, 0, "a warm cache must short-circuit the live-stream early return");
  } finally { h.restore(); }
});

test("non-stream path still writes and reads the cache (unchanged by the fix)", async () => {
  const h = harness();
  try {
    const first = await explain(h.env, { stream: false });
    assert.equal(h.calls.nonStream, 1);
    assert.equal(JSON.parse(first.text).text, ANSWER);
    assert.equal(cacheKeys(h.kv).length, 1, "the non-stream answer is cached too");
    const second = await explain(h.env, { stream: false });
    assert.equal(h.calls.nonStream, 1, "the second identical question is served from KV");
    assert.equal(JSON.parse(second.text).cached, true, "and is marked cached:true to the client");
  } finally { h.restore(); }
});

test("case commentary (a computed differential) is NEVER cached", async () => {
  // Safety contract from _maik_cache.js: only generic knowledge answers are cacheable, because a
  // request carrying a computed differential is about a specific patient.
  const h = harness();
  try {
    await explain(h.env, {
      stream: true,
      body: { question: QUESTION, grounding: [{ text: "x", provenance: ["KB"] }], reasoning: { differential: [{ dx: "AF", p: 0.8 }] } },
    });
    assert.equal(cacheKeys(h.kv).length, 0, "a patient-specific answer must never reach the shared cache");
  } finally { h.restore(); }
});

test("with MAIK_ANSWER_CACHE off, nothing is cached at all", async () => {
  const h = harness({ MAIK_ANSWER_CACHE: "" });
  try {
    await explain(h.env);
    assert.equal(h.calls.stream, 1);
    assert.equal(cacheKeys(h.kv).length, 0, "the flag must still gate the whole feature");
  } finally { h.restore(); }
});
