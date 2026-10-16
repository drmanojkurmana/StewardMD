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
