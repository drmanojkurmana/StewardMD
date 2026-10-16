/* retrieve-vertex.test.mjs - the /api/retrieve vector arm embeds with Vertex (not Workers AI) and cannot run away.
 * No VERTEX_API_KEY, no Vectorize, or the daily cap reached: empty matches (keyword-only). A working path embeds ONE
 * question per request with the x-goog-api-key header (never in the URL) and never touches env.AI. */
import { test } from "node:test";
import assert from "node:assert/strict";
const route = await import("../functions/api/retrieve/[[path]].js");

const vec = new Array(768).fill(0.02);
function stub() {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (String(u).includes("aiplatform.googleapis.com")) { calls.push({ u: String(u), h: o.headers, b: JSON.parse(o.body) }); return new Response(JSON.stringify({ predictions: [{ embeddings: { values: vec } }] }), { status: 200 }); }
    return real(u, o);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const kvOf = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };
const post = (env) => route.onRequest({ request: new Request("https://stewardmd.in/api/retrieve", { method: "POST", headers: { Origin: "https://stewardmd.in", "Content-Type": "application/json" }, body: JSON.stringify({ query: "burning urination" }) }), env }).then((r) => r.json());
const VEC = { query: async () => ({ matches: [{ id: "uti", score: 0.8, metadata: { diseaseId: "uti" } }] }) };

test("one question = one Vertex embed call, key in a header, Workers AI never used", async () => {
  const s = stub();
  try {
    const env = { VERTEX_API_KEY: "k", KB_VECTORIZE: VEC, MAIK_KV: kvOf(), AI: { run: async () => { throw new Error("Workers AI must not be called"); } } };
    const j = await post(env);
    assert.deepEqual(j.matches.map((m) => m.diseaseId), ["uti"]);
    assert.equal(s.calls.length, 1);
    assert.match(s.calls[0].u, /text-embedding-005:predict$/);
    assert.ok(!s.calls[0].u.includes("key="), "key never in the URL");
    assert.equal(s.calls[0].h["x-goog-api-key"], "k");
    assert.equal(s.calls[0].b.instances[0].task_type, "RETRIEVAL_QUERY");
    assert.equal(s.calls[0].b.parameters.outputDimensionality, 768);
  } finally { s.restore(); }
});

test("no key, no Vectorize, or the daily cap reached: empty matches and no Vertex call", async () => {
  const s = stub();
  try {
    assert.deepEqual((await post({ KB_VECTORIZE: VEC })).matches, []);
    assert.deepEqual((await post({ VERTEX_API_KEY: "k" })).matches, []);
    const kv = kvOf(); kv.m.set("retrieve:n:" + new Date().toISOString().slice(0, 10), "20000");
    assert.deepEqual((await post({ VERTEX_API_KEY: "k", KB_VECTORIZE: VEC, MAIK_KV: kv })).matches, []);
    assert.equal(s.calls.length, 0, "nothing was embedded");
  } finally { s.restore(); }
});

test("a failed or malformed embed degrades to empty matches, never an error", async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.deepEqual((await post({ VERTEX_API_KEY: "k", KB_VECTORIZE: VEC })).matches, []);
    globalThis.fetch = async () => new Response(JSON.stringify({ predictions: [{ embeddings: { values: [1, 2] } }] }), { status: 200 });
    assert.deepEqual((await post({ VERTEX_API_KEY: "k", KB_VECTORIZE: VEC })).matches, []);
  } finally { globalThis.fetch = real; }
});

test("hedged: a stalled first call does not sink the question, the second call at 1 s wins and the first is aborted", async () => {
  const real = globalThis.fetch; let n = 0, aborted = 0;
  globalThis.fetch = (u, o) => {
    if (!String(u).includes("aiplatform.googleapis.com")) return real(u, o);
    const k = ++n;
    if (k === 1) return new Promise((_, rej) => o.signal.addEventListener("abort", () => { aborted++; rej(new Error("aborted")); }));
    return Promise.resolve(new Response(JSON.stringify({ predictions: [{ embeddings: { values: vec } }] }), { status: 200 }));
  };
  try {
    const info = {}, v = await route.embedQuery({ VERTEX_API_KEY: "k" }, "burning urination", info);
    assert.equal(v.length, 768);
    assert.equal(info.calls, 2, "second call started at ~1 s, third never needed");
    assert.ok(info.ms >= 900 && info.ms < 3000, "won by the hedge, not the deadline: " + info.ms);
    assert.equal(aborted, 1, "the stalled call was aborted");
  } finally { globalThis.fetch = real; }
});

/* free-quota tier: Workers AI first (binding CF_AI_FREE, old bge index), Vertex when the cap is hit or it fails */
const OLD = { query: async () => ({ matches: [{ id: "c1", score: 0.7, metadata: { diseaseId: "old-uti" } }] }) };
const aiOk = (calls) => ({ run: async (m, a) => { calls.push([m, a]); return { data: [new Array(768).fill(0.01)] }; } });

test("free tier answers first from the old index; Vertex is not called", async () => {
  const s = stub(), calls = [];
  try {
    const j = await post({ CF_AI_FREE: aiOk(calls), KB_VECTORIZE_OLD: OLD, VERTEX_API_KEY: "k", KB_VECTORIZE: VEC, MAIK_KV: kvOf() });
    assert.deepEqual(j.matches.map((m) => m.diseaseId), ["old-uti"]);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], "@cf/baai/bge-base-en-v1.5"); assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test("free tier over its daily cap or erroring falls through to Vertex, and without a KV counter it never spends", async () => {
  const s = stub(), calls = [];
  try {
    const kv = kvOf(); kv.m.set("retrieve:wai:" + new Date().toISOString().slice(0, 10), "3000");
    let j = await post({ CF_AI_FREE: aiOk(calls), KB_VECTORIZE_OLD: OLD, VERTEX_API_KEY: "k", KB_VECTORIZE: VEC, MAIK_KV: kv });
    assert.deepEqual(j.matches.map((m) => m.diseaseId), ["uti"]); assert.equal(calls.length, 0);
    j = await post({ CF_AI_FREE: { run: async () => { throw new Error("boom"); } }, KB_VECTORIZE_OLD: OLD, VERTEX_API_KEY: "k", KB_VECTORIZE: VEC, MAIK_KV: kvOf() });
    assert.deepEqual(j.matches.map((m) => m.diseaseId), ["uti"]);
    j = await post({ CF_AI_FREE: aiOk(calls), KB_VECTORIZE_OLD: OLD });
    assert.deepEqual(j.matches, []); assert.equal(calls.length, 0, "no MAIK_KV, no spend");
  } finally { s.restore(); }
});
