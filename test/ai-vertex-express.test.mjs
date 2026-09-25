/* MaiK AI provider: Vertex via API key (express mode) is the main provider, the Gemini key the fallback.
 * Owner, 2026-09-24: the old account's Google Cloud project credentials are being retired; a new Vertex
 * API key replaces them everywhere MaiK calls Google. No network: fetch is stubbed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/ai/[[path]].js";

const pkg = { reasoning: { differential: [{ id: "CAP", name: "CAP", class: "infective", confidence: 82, supporting: ["Fever"], contradictory: [], missing: [] }] }, grounding: [{ diseaseId: "CAP", name: "CAP", knowledge: [{ section: "harrison.pearl", text: "x", source: { ref: "Harrison 22e" } }], provenance: ["Harrison 22e"], drugRefs: [] }], retrieved: [], treatment: null, refs: {}, patientCase: { age: 60, sex: "M" } };
const explain = (obj) => new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://stewardmd.in" }, body: JSON.stringify(obj) });
const health = () => new Request("https://stewardmd.in/api/ai/health", { headers: { Origin: "https://stewardmd.in" } });

let calls;
const realFetch = globalThis.fetch;
function stub({ vertexFails = false } = {}) {
  calls = { vertex: 0, dev: 0, token: 0, vertexUrl: null, vertexHeaders: null };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com") || u.includes("sts.googleapis.com")) { calls.token++; return { json: async () => ({ access_token: "tok" }) }; }
    if (u.includes("aiplatform.googleapis.com")) {
      calls.vertex++; calls.vertexUrl = u; calls.vertexHeaders = init.headers;
      if (vertexFails) return { status: 503, json: async () => ({ error: { message: "simulated 503" } }) };
      return { status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "VERTEX-OK" }] } }] }) };
    }
    if (u.includes("generativelanguage.googleapis.com")) { calls.dev++; return { status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "DEV-OK" }] } }] }) }; }
    throw new Error("unexpected fetch " + u);
  };
}
const ENV = { VERTEX_API_KEY: "vk-test-key", GEMINI_API_KEY: "dev-key" };

test("VERTEX_API_KEY alone makes Vertex available and primary, on the express publisher path, key in the header", async () => {
  stub();
  try {
    const r = await (await onRequest({ request: explain({ package: pkg }), env: ENV, params: { path: ["explain"] }, waitUntil: () => {} })).json();
    assert.equal(r.text, "VERTEX-OK");
    assert.equal(calls.vertex, 1); assert.equal(calls.dev, 0); assert.equal(calls.token, 0, "no service-account token exchange in key mode");
    assert.match(calls.vertexUrl, /^https:\/\/aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\/gemini-2\.5-flash:generateContent$/);
    assert.equal(calls.vertexHeaders["x-goog-api-key"], "vk-test-key");
    assert.ok(!calls.vertexHeaders.Authorization, "no bearer token in key mode");
    assert.ok(!calls.vertexUrl.includes("vk-test-key"), "the key never appears in the URL");
  } finally { globalThis.fetch = realFetch; }
});

test("Vertex failure falls over to the Gemini key", async () => {
  stub({ vertexFails: true });
  try {
    const r = await (await onRequest({ request: explain({ package: pkg }), env: ENV, params: { path: ["explain"] }, waitUntil: () => {} })).json();
    assert.equal(r.text, "DEV-OK");
    assert.ok(calls.vertex >= 1 && calls.dev === 1);
  } finally { globalThis.fetch = realFetch; }
});

test("health names the mode and the fallback; the default provider order is Vertex then Developer", async () => {
  stub();
  try {
    const h = await (await onRequest({ request: health(), env: ENV, params: { path: ["health"] } })).json();
    assert.equal(h.provider, "vertex"); assert.equal(h.fallback_provider, "developer");
    assert.equal(h.vertex_status, h.vertex_last_success ? "healthy" : "configured");   // healthy only after a real success (T51) assert.equal(h.authentication, "API key (Vertex express mode)"); assert.equal(h.vertex_mode, "api-key (express mode)"); assert.equal(h.fallback_available, true);
    const g = await (await onRequest({ request: health(), env: { GEMINI_API_KEY: "dev-key" }, params: { path: ["health"] } })).json();
    assert.equal(g.vertex_status, "unavailable"); assert.equal(g.vertex_mode, null);
  } finally { globalThis.fetch = realFetch; }
});
