/* ai-token-memo.test.mjs - one /api/ai request verifies the Firebase token ONCE (T52), and the Vertex
 * token hops (STS, IAM, OAuth) are time-bounded. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = Object.assign(await crypto.subtle.exportKey("jwk", kp.publicKey), { kid: "m1", alg: "RS256" });
const now = Math.floor(Date.now() / 1000);
const h = b64u(JSON.stringify({ alg: "RS256", kid: "m1" })), p = b64u(JSON.stringify({ aud: "stewardmd-498ec", iss: "https://securetoken.google.com/stewardmd-498ec", sub: "u9", iat: now, exp: now + 3600, email: "doc@example.com" }));
const TOKEN = h + "." + p + "." + b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)));

function fakeKv() {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}

test("a signed-in /explain verifies the token signature exactly once", async () => {
  const real = globalThis.fetch, realVerify = crypto.subtle.verify;
  let verifies = 0;
  crypto.subtle.verify = function () { verifies++; return realVerify.apply(this, arguments); };
  globalThis.fetch = async (u) => {
    const s = String(u);
    if (s.indexOf("securetoken@system") >= 0) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Cache-Control": "max-age=3600" } });
    if (s.indexOf("generateContent") >= 0) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
    return new Response("{}");
  };
  try {
    const waits = [];
    const r = await onRequest({ request: new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ question: "dose of amiodarone in af", grounding: [{ text: "x" }] }) }), env: { AI_PROVIDER: "developer", GEMINI_API_KEY: "k", MAIK_KV: fakeKv() }, params: { path: ["explain"] }, waitUntil: (x) => waits.push(x) });
    assert.equal(r.status, 200);
    await r.text(); await Promise.allSettled(waits);
    assert.equal(verifies, 1, "authorise, identify, owner and entitlement checks must share one verification");
  } finally { globalThis.fetch = real; crypto.subtle.verify = realVerify; }
});

test("STS, IAM and the SA-JWT OAuth exchange are all time-bounded", () => {
  const src = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
  for (const host of ["sts.googleapis.com", "iamcredentials.googleapis.com", "oauth2.googleapis.com/token"]) {
    const i = src.indexOf(host);
    assert.ok(i > 0, host);
    assert.match(src.slice(i - 60, i + 700), /fetchJsonWithTimeout\([\s\S]*TOKEN_FETCH_MS\)/, host + " must go through fetchJsonWithTimeout");
  }
});
