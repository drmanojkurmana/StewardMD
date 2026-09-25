/* ai-auth-gate.test.mjs - /api/ai authorise() (audit T28).
 * Any Authorization header, or a bare Cf-Access email header, used to pass the gate. Now a bearer
 * passes only if it verifies as a Firebase ID token (an invalid one falls through to the app/origin
 * checks), Cf-Access needs a VERIFIED Access JWT, and guests get a per-IP burst limit. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedClaimsFor, cfAccessEmail } from "../functions/_fbauth.js";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const GATE = { APP_GATE_KEY: "app-secret" };

function fakeKv() {
  const m = new Map();
  return { _m: m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}
const status = (headers, env) => onRequest({ request: new Request("https://stewardmd.in/api/ai/status", { headers }), env: Object.assign({}, GATE, env || {}), params: { path: ["status"] }, waitUntil: () => {} }).then((r) => r.status);

/* A real RS256 Firebase-shaped token, verified against a JWKS we serve from a fetch stub. */
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = Object.assign(await crypto.subtle.exportKey("jwk", kp.publicKey), { kid: "k1", alg: "RS256", use: "sig" });
async function mint(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const p = b64u(JSON.stringify(Object.assign({ aud: "stewardmd-498ec", iss: "https://securetoken.google.com/stewardmd-498ec", sub: "u1", iat: now, exp: now + 3600, email: "doc@example.com" }, claims || {})));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p));
  return h + "." + p + "." + b64u(sig);
}
let jwksFetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  if (String(u).indexOf("securetoken@system.gserviceaccount.com") >= 0) { jwksFetches++; return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Cache-Control": "max-age=3600" } }); }
  return realFetch(u, i);
};

test("a junk Authorization header no longer passes the gate", async () => {
  assert.equal(await status({ Authorization: "Bearer junk" }), 403);
});

test("an invalid token falls through to the app checks instead of hard-failing", async () => {
  assert.equal(await status({ Authorization: "Bearer junk", "X-SMD-App": "app-secret" }), 200);
  assert.equal(await status({ Authorization: "Bearer junk", Origin: "capacitor://localhost" }), 200);
});

test("a VERIFIED Firebase token passes with no Origin (same-origin GET from the admin console)", async () => {
  assert.equal(await status({ Authorization: "Bearer " + (await mint()) }), 200);
  assert.equal(await status({ Authorization: "Bearer " + (await mint({ exp: 1 })) }), 403, "an expired token does not");
});

test("Cf-Access headers alone (email, or email + an unverified assertion) never pass", async () => {
  assert.equal(await status({ "Cf-Access-Authenticated-User-Email": "a@b.c" }), 403);
  assert.equal(await status({ "Cf-Access-Authenticated-User-Email": "a@b.c", "Cf-Access-Jwt-Assertion": "x.y.z" }), 403);
  assert.equal(await cfAccessEmail(new Request("https://x", { headers: { "Cf-Access-Authenticated-User-Email": "A@B.c" } }), {}), "");
  // A VERIFIED Access JWT passing is covered in test/cf-access-verify.test.mjs.
});

test("/api/ai never meters a bare (unasserted) Cf-Access email as that user", async () => {
  const kv = fakeKv();
  const waits = [];
  const env = { MAIK_KV: kv, AI_PROVIDER: "developer", GEMINI_API_KEY: "k" };
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).indexOf("generateContent") >= 0
    ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }) : real(u, i);
  try {
    const send = (headers) => onRequest({ request: new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: Object.assign({ "Content-Type": "application/json", "X-SMD-Device": "dev-1" }, headers), body: JSON.stringify({ question: "dose of amiodarone in af", grounding: [{ text: "x" }] }) }), env, params: { path: ["explain"] }, waitUntil: (p) => waits.push(p) }).then((r) => r.text());
    await send({ "Cf-Access-Authenticated-User-Email": "victim@x.com" });
    await Promise.allSettled(waits);
    assert.ok(![...kv._m.keys()].some((k) => k.indexOf("victim@x.com") >= 0), "spoofed email must not own any usage key");
    await send({ "Cf-Access-Authenticated-User-Email": "victim@x.com", "Cf-Access-Jwt-Assertion": "a.b.c" });
    await Promise.allSettled(waits);
    assert.ok(![...kv._m.keys()].some((k) => k.indexOf("victim@x.com") >= 0), "nor with a junk assertion beside it");
  } finally { globalThis.fetch = real; }
});

test("token verification is memoised per request", async () => {
  const req = new Request("https://x", { headers: { Authorization: "Bearer " + (await mint()) } });
  const a = verifiedClaimsFor(req, {}), b = verifiedClaimsFor(req, {});
  assert.equal(a, b, "same promise for the same request");
  assert.equal((await a).sub, "u1");
});

test("guests get a per-IP burst limit on /explain; signed-in callers do not", async () => {
  const kv = fakeKv();
  const env = { MAIK_KV: kv, MAIK_GUEST_BURST_PER_MIN: "3", AI_PROVIDER: "developer", GEMINI_API_KEY: "k" };
  const post = (headers) => onRequest({ request: new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: Object.assign({ "CF-Connecting-IP": "1.1.1.1", "Content-Type": "application/json" }, headers), body: "{}" }), env, params: { path: ["explain"] }, waitUntil: () => {} }).then((r) => r.status);
  for (let i = 0; i < 3; i++) assert.notEqual(await post({}), 429);
  assert.equal(await post({}), 429, "the 4th guest request in a minute is refused");
  const tok = await mint();
  assert.notEqual(await post({ Authorization: "Bearer " + tok }), 429, "a verified user on the same IP is not burst-limited");
  assert.notEqual(await post({ "CF-Connecting-IP": "2.2.2.2" }), 429, "another IP is unaffected");
});

test("the burst limit fails open without KV", async () => {
  const env = { MAIK_GUEST_BURST_PER_MIN: "1" };
  for (let i = 0; i < 3; i++) {
    const r = await onRequest({ request: new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { "CF-Connecting-IP": "1.1.1.1" }, body: "{}" }), env, params: { path: ["explain"] }, waitUntil: () => {} });
    assert.notEqual(r.status, 429);
  }
});

test.after(() => { globalThis.fetch = realFetch; assert.ok(jwksFetches >= 1); });
