/* StewardMD — MaiK AI provider abstraction tests (Vertex primary / Developer fallback)
 *
 * Verifies the transport layer WITHOUT any real network or Google credentials:
 * a throwaway RSA-2048 key exercises the REAL self-signed-JWT signing (Web Crypto);
 * the OAuth token endpoint, Vertex generateContent, and Developer generateContent are
 * all stubbed. Asserts provider selection (AI_PROVIDER), Vertex→Developer failover,
 * OAuth token caching, gemini-2.5-flash default, and the /status shape.
 *
 * USAGE: node test/run-ai-providers.mjs   (exit 0 = pass)
 */
import { onRequest } from "../functions/api/ai/[[path]].js";
import { generateKeyPairSync } from "node:crypto";

let fails = 0; const ok = (c, m, x) => { console.log((c ? "✅ " : "❌ ") + m + (x !== undefined ? " — " + x : "")); if (!c) fails++; };

// throwaway RSA-2048 (PKCS8 PEM) — NOT a GCP key; only to exercise real JWT signing
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const VERTEX_ENV = { GCP_PROJECT: "stewardmd-498ec", GCP_LOCATION: "us-central1", GCP_SA_EMAIL: "maik-vertex-ai@stewardmd-498ec.iam.gserviceaccount.com", GCP_SA_PRIVATE_KEY: privateKey };

const pkg = { reasoning: { differential: [{ id: "CAP", name: "CAP", class: "infective", confidence: 82, supporting: ["Fever"], contradictory: [], missing: [] }] }, grounding: [{ diseaseId: "CAP", name: "CAP", knowledge: [{ section: "harrison.pearl", text: "x", source: { ref: "Harrison 22e" } }], provenance: ["Harrison 22e"], drugRefs: [] }], retrieved: [], treatment: null, refs: {}, patientCase: { age: 60, sex: "M" } };
const req = (obj) => new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json", "Origin": "https://stewardmd.in" }, body: JSON.stringify(obj) });
const statusReq = () => new Request("https://stewardmd.in/api/ai/status", { headers: { Origin: "https://stewardmd.in" } });

// ---- fetch stub: routes token / vertex / developer; records calls ----
let calls;
const realFetch = globalThis.fetch;
function stub() {
  calls = { token: 0, vertex: 0, dev: 0, vertexUrl: null, vertexAuth: null, tokenShouldFail: false };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.indexOf("oauth2.googleapis.com/token") >= 0) {
      calls.token++;
      if (calls.tokenShouldFail) return { json: async () => ({ error: "invalid_grant", error_description: "simulated auth failure" }) };
      return { json: async () => ({ access_token: "tok-abc", expires_in: 3600 }) };
    }
    if (u.indexOf("aiplatform.googleapis.com") >= 0) {
      calls.vertex++; calls.vertexUrl = u; calls.vertexAuth = init.headers.Authorization;
      if (calls.vertexShouldFail) return { json: async () => ({ error: { message: "simulated Vertex 503" } }) };
      return { json: async () => ({ candidates: [{ content: { parts: [{ text: "VERTEX-OK" }] } }] }) };
    }
    if (u.indexOf("generativelanguage.googleapis.com") >= 0) {
      calls.dev++;
      return { json: async () => ({ candidates: [{ content: { parts: [{ text: "DEV-OK" }] } }] }) };
    }
    throw new Error("unexpected fetch " + u);
  };
}

try {
  // 1) Vertex PRIMARY (default AI_PROVIDER) — real JWT signed, token exchanged, Vertex called
  stub();
  let r = await (await onRequest({ request: req({ package: pkg }), env: VERTEX_ENV, params: { path: ["explain"] } })).json();
  ok(r.text === "VERTEX-OK", "default → Vertex primary used", r.text);
  ok(calls.token === 1 && calls.vertex === 1 && calls.dev === 0, "Vertex path: 1 token exchange + 1 vertex call, no dev", JSON.stringify({ token: calls.token, vertex: calls.vertex, dev: calls.dev }));
  ok(/us-central1-aiplatform\.googleapis\.com\/v1\/projects\/stewardmd-498ec\/locations\/us-central1\/publishers\/google\/models\/gemini-2\.5-flash:generateContent/.test(calls.vertexUrl), "Vertex endpoint + gemini-2.5-flash default", calls.vertexUrl.slice(0, 90) + "…");
  ok(calls.vertexAuth === "Bearer tok-abc", "Vertex called with OAuth Bearer token", calls.vertexAuth);

  // 2) OAuth token CACHING — second call reuses token (no new token exchange)
  r = await (await onRequest({ request: req({ package: pkg }), env: VERTEX_ENV, params: { path: ["explain"] } })).json();
  ok(r.text === "VERTEX-OK" && calls.token === 1 && calls.vertex === 2, "token cached across calls (still 1 exchange, 2 vertex calls)", JSON.stringify({ token: calls.token, vertex: calls.vertex }));

  // 3) FAILOVER — Vertex primary but Vertex call fails → Developer fallback (GEMINI_API_KEY present)
  stub(); calls.vertexShouldFail = true;
  r = await (await onRequest({ request: req({ package: pkg }), env: { ...VERTEX_ENV, GEMINI_API_KEY: "dev-key" }, params: { path: ["explain"] } })).json();
  ok(r.text === "DEV-OK" && calls.vertex === 1 && calls.dev === 1, "Vertex failure → automatic Developer fallback", r.text + " (vertex tried:" + calls.vertex + ", dev:" + calls.dev + ")");

  // 4) AI_PROVIDER=developer → developer only, no Vertex/token traffic
  stub();
  r = await (await onRequest({ request: req({ package: pkg }), env: { AI_PROVIDER: "developer", GEMINI_API_KEY: "dev-key" }, params: { path: ["explain"] } })).json();
  ok(r.text === "DEV-OK" && calls.vertex === 0 && calls.token === 0, "AI_PROVIDER=developer → Developer only (no Vertex/token)", JSON.stringify({ dev: calls.dev, vertex: calls.vertex }));

  // 5) status shape (Vertex configured)
  stub();
  let s = await (await onRequest({ request: statusReq(), env: VERTEX_ENV, params: { path: ["status"] } })).json();
  ok(s.enabled === true && s.provider === "vertex" && s.vertex === true && s.model === "gemini-2.5-flash", "/status reports vertex primary + model", JSON.stringify(s));

  // 6) no providers → disabled + explain fails safe (client falls back to rule-based)
  s = await (await onRequest({ request: statusReq(), env: {}, params: { path: ["status"] } })).json();
  ok(s.enabled === false, "no providers → {enabled:false}");
  r = await (await onRequest({ request: req({ package: pkg }), env: {}, params: { path: ["explain"] } })).json();
  ok(r.enabled === false || r.error === "ai-disabled", "no providers → explain returns ai-disabled");

  // 7) Developer-only env (no GCP) with default AI_PROVIDER → Vertex unavailable → Developer
  stub();
  r = await (await onRequest({ request: req({ package: pkg }), env: { GEMINI_API_KEY: "dev-key" }, params: { path: ["explain"] } })).json();
  ok(r.text === "DEV-OK" && calls.vertex === 0, "Vertex unavailable (no GCP env) → Developer used", r.text);

  globalThis.fetch = realFetch;
  console.log(`\n${fails === 0 ? "ALL GREEN — provider abstraction: Vertex primary, Developer failover, token cached, 2.5-flash default" : fails + " failed"}`);
  process.exit(fails ? 1 : 0);
} catch (e) { globalThis.fetch = realFetch; console.log("HARNESS ERROR:", e.message); process.exit(2); }
