/* cf-access-verify.test.mjs - no route trusts a bare (or junk-asserted) Cf-Access header.
 *
 * Before: ~25 routes took Cf-Access-Authenticated-User-Email at face value (cases, license, billing,
 * push, queue, wardsynq, connect... via the two identify() helpers, plus the coarse app gates of
 * experimental, fundx, followcare, icd, schemes, retrieve), and /api/ai accepted ANY value in
 * Cf-Access-Jwt-Assertion. Any client could send those headers and pick whose account it ran as
 * (the owner's email on /api/license returned the KB key). Now _fbauth.js cfAccessEmail() verifies
 * the Access JWT (RS256 vs the team certs, iss, aud, exp) and every route goes through it.
 *
 * Real RS256 tokens are minted here and verified against JWK sets served from a fetch stub, the same
 * way test/ai-auth-gate.test.mjs does it for Firebase. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cfAccessEmail, identify as fbIdentify } from "../functions/_fbauth.js";
import { identify as usageIdentify } from "../functions/_usage.js";

const TEAM = "smd-test.cloudflareaccess.com", AUD = "aud-tag-1";
const ACCESS = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
const FORGED = { "Cf-Access-Authenticated-User-Email": "owner@example.com", "Cf-Access-Jwt-Assertion": "x.y.z" };
const EVIL = { Origin: "https://evil.example" };   // so the coarse gates cannot pass on the Origin rule

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const gen = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const kp = await gen(), rogue = await gen();
const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
const jwkAccess = Object.assign({}, pub, { kid: "a1", alg: "RS256", use: "sig" });
const jwkFb = Object.assign({}, pub, { kid: "f1", alg: "RS256", use: "sig" });
async function sign(kid, claims, key) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), p = b64u(JSON.stringify(claims));
  return h + "." + p + "." + b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", (key || kp).privateKey, new TextEncoder().encode(h + "." + p)));
}
const now = () => Math.floor(Date.now() / 1000);
const accessJwt = (claims, key) => sign("a1", Object.assign({ iss: "https://" + TEAM, aud: [AUD], email: "Owner@Example.com", sub: "s1", iat: now(), exp: now() + 600 }, claims || {}), key);
const fbJwt = (claims) => sign("f1", Object.assign({ aud: "stewardmd-498ec", iss: "https://securetoken.google.com/stewardmd-498ec", sub: "u1", iat: now(), exp: now() + 600, email: "doc@example.com" }, claims || {}));

const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  const s = String(u);
  if (s === "https://" + TEAM + "/cdn-cgi/access/certs") return new Response(JSON.stringify({ keys: [jwkAccess] }));
  if (s.indexOf("securetoken@system.gserviceaccount.com") >= 0) return new Response(JSON.stringify({ keys: [jwkFb] }));
  return realFetch(u, i);
};

const req = (url, headers, init) => new Request("https://stewardmd.in" + url, Object.assign({ headers }, init || {}));
function fakeKv() {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }) };
}
const emptyDb = { prepare: () => { const st = { bind: () => st, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }; return st; } };

// ---------------------------------------------------------------- the verifier itself
test("cfAccessEmail: only a verified Access JWT yields an email", async () => {
  const email = async (headers, env) => cfAccessEmail(req("/", headers), env);
  assert.equal(await email({ "Cf-Access-Authenticated-User-Email": "a@b.c" }, ACCESS), "", "bare email header");
  assert.equal(await email(FORGED, ACCESS), "", "email + junk assertion");
  assert.equal(await email({ "Cf-Access-Jwt-Assertion": await accessJwt() }, {}), "", "Access not configured -> off");
  assert.equal(await email({ "Cf-Access-Jwt-Assertion": await accessJwt() }, ACCESS), "owner@example.com", "valid JWT, email from the claims");
  assert.equal(await email({ "Cf-Access-Jwt-Assertion": await accessJwt(), "Cf-Access-Authenticated-User-Email": "victim@x.com" }, ACCESS), "owner@example.com", "the email header is never read");
  assert.equal(await email({ "Cf-Access-Jwt-Assertion": await accessJwt({ aud: ["other-app"] }) }, ACCESS), "", "wrong aud");
  assert.equal(await email({ "Cf-Access-Jwt-Assertion": await accessJwt({ iss: "https://evil.cloudflareaccess.com" }) }, ACCESS), "", "wrong iss");
  assert.equal(await email({ "Cf-Access-Jwt-Assertion": await accessJwt({ exp: now() - 5 }) }, ACCESS), "", "expired");
  assert.equal(await email({ "Cf-Access-Jwt-Assertion": await accessJwt({}, rogue) }, ACCESS), "", "signed by another key");
  assert.equal(await email({ "Cf-Access-Jwt-Assertion": await accessJwt({ email: undefined, common_name: "svc" }) }, ACCESS), "", "service token (no email)");
  assert.equal(await email({ "Cf-Access-Jwt-Assertion": await accessJwt({ aud: AUD }) }, Object.assign({}, ACCESS, { CF_ACCESS_AUD: "x, " + AUD })), "owner@example.com", "string aud, AUD list");
});

test("both identify() helpers ignore a forged Cf-Access header (every route that calls them)", async () => {
  assert.equal(await fbIdentify(req("/", FORGED), ACCESS), null);
  const u = await usageIdentify(req("/", Object.assign({ "CF-Connecting-IP": "1.2.3.4" }, FORGED)), ACCESS);
  assert.equal(u.guest, true);
  assert.equal(u.email, undefined);
  assert.equal(await fbIdentify(req("/", { "Cf-Access-Jwt-Assertion": await accessJwt() }), ACCESS), "cfa:owner@example.com");
  assert.equal((await usageIdentify(req("/", { "Cf-Access-Jwt-Assertion": await accessJwt() }), ACCESS)).email, "owner@example.com");
  assert.equal(await fbIdentify(req("/", { Authorization: "Bearer " + (await fbJwt()) }), {}), "fb:u1");
});

// ---------------------------------------------------------------- per route
const route = async (file) => (await import(new URL("../functions/api/" + file, import.meta.url))).onRequest;

test("/api/cases: forged header 401, Firebase and verified Access still work", async () => {
  const on = await route("cases/[[path]].js");
  const env = Object.assign({ CASES_KV: fakeKv() }, ACCESS);
  const get = (h) => on({ request: req("/api/cases/c1", h), env, params: { path: ["c1"] } }).then((r) => r.status);
  assert.equal(await get(FORGED), 401);
  assert.equal(await get({ Authorization: "Bearer " + (await fbJwt()) }), 404, "signed in: reaches the store (no such case)");
  assert.equal(await get({ "Cf-Access-Jwt-Assertion": await accessJwt() }), 404);
});

test("/api/license: the owner's email in a forged header no longer returns the KB key", async () => {
  const on = await route("license.js");
  const env = Object.assign({ APP_KB_KEY: "kb-secret", OWNER_EMAILS: "owner@example.com" }, ACCESS);
  const post = (h) => on({ request: req("/api/license", h, { method: "POST" }), env });
  const forged = await post(FORGED);
  assert.equal(forged.status, 401);
  assert.ok((await forged.text()).indexOf("kb-secret") < 0);
  const ok = await post({ "Cf-Access-Jwt-Assertion": await accessJwt() });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).key, "kb-secret");
});

test("/api/billing: forged header is signed-out; a Firebase user gets past sign-in", async () => {
  const on = await route("billing/[[path]].js");
  const post = (h) => on({ request: req("/api/billing/iap/verify", Object.assign({ "Content-Type": "application/json" }, h), { method: "POST", body: "{}" }), env: Object.assign({}, ACCESS) }).then((r) => r.status);
  assert.equal(await post(FORGED), 401);
  assert.equal(await post({ Authorization: "Bearer " + (await fbJwt()) }), 400, "signed in: fails on the missing purchase instead");
});

test("/api/push: forged header is auth-required; Firebase works", async () => {
  const on = await route("push/[[path]].js");
  const get = (h) => on({ request: req("/api/push/wardsynq-receipts", h), env: Object.assign({ PUSH_KV: fakeKv() }, ACCESS), params: { path: ["wardsynq-receipts"] } }).then((r) => r.status);
  assert.equal(await get(FORGED), 401);
  assert.equal(await get({ Authorization: "Bearer " + (await fbJwt()) }), 200);
});

test("/api/experimental gate: forged header 401, verified Access passes", async () => {
  const on = await route("experimental/[[path]].js");
  const get = (h) => on({ request: req("/api/experimental/features", Object.assign({}, EVIL, h)), env: Object.assign({}, ACCESS) }).then((r) => r.status);
  assert.equal(await get(FORGED), 401);
  assert.equal(await get({ "Cf-Access-Jwt-Assertion": await accessJwt() }), 200);
});

test("/api/fundx gate: forged header 401, verified Access passes", async () => {
  const on = await route("fundx/[[path]].js");
  const get = (h) => on({ request: req("/api/fundx/health", Object.assign({}, EVIL, h)), env: Object.assign({}, ACCESS) }).then((r) => r.status);
  assert.equal(await get(FORGED), 401);
  assert.equal(await get({ "Cf-Access-Jwt-Assertion": await accessJwt() }), 200);
});

test("/api/followcare clinician gate: forged header 401, verified Access passes", async () => {
  const on = await route("followcare/[[path]].js");
  const get = (h) => on({ request: req("/api/followcare/ready", Object.assign({}, EVIL, h)), env: Object.assign({}, ACCESS) }).then((r) => r.status);
  assert.equal(await get(FORGED), 401);
  assert.equal(await get({ "Cf-Access-Jwt-Assertion": await accessJwt() }), 200);
});

test("/api/icd + /api/schemes: forged header reads as unavailable, verified Access reads", async () => {
  const icd = await route("icd/[[path]].js"), sch = await route("schemes/[[path]].js");
  const icdGet = (h) => icd({ request: req("/api/icd/code/icd10%3AE11", Object.assign({}, EVIL, h)), env: Object.assign({ ICD_DB: emptyDb }, ACCESS), params: { path: ["code", "icd10%3AE11"] } }).then((r) => r.json());
  assert.equal((await icdGet(FORGED)).error, "unavailable");
  assert.equal((await icdGet({ "Cf-Access-Jwt-Assertion": await accessJwt() })).error, "not_found", "authorised: reached the DB");
  const schGet = (h) => sch({ request: req("/api/schemes/jurisdictions", Object.assign({}, EVIL, h)), env: Object.assign({ GOVSCHEMES_DB: emptyDb }, ACCESS), params: { path: ["jurisdictions"] } }).then((r) => r.json());
  assert.equal((await schGet(FORGED)).error, "unavailable");
  assert.equal((await schGet({ "Cf-Access-Jwt-Assertion": await accessJwt() })).error, undefined);
});

test("/api/retrieve: forged header gets no vector matches, verified Access does", async () => {
  const on = await route("retrieve/[[path]].js");
  const env = Object.assign({ AI: { run: async () => ({ data: [[0.1, 0.2]] }) }, KB_VECTORIZE: { query: async () => ({ matches: [{ id: "c1", score: 0.9, metadata: { diseaseId: "d1", section: "s" } }] }) } }, ACCESS);
  const post = (h) => on({ request: req("/api/retrieve", Object.assign({ "Content-Type": "application/json" }, EVIL, h), { method: "POST", body: JSON.stringify({ query: "sepsis" }) }), env }).then((r) => r.json());
  assert.equal((await post(FORGED)).matches.length, 0);
  assert.equal((await post({ "Cf-Access-Jwt-Assertion": await accessJwt() })).matches.length, 1);
});

test("/api/ai gate: email + junk assertion no longer passes (T28 follow-up)", async () => {
  const on = await route("ai/[[path]].js");
  const get = (h) => on({ request: req("/api/ai/status", h), env: Object.assign({ APP_GATE_KEY: "app-secret" }, ACCESS), params: { path: ["status"] }, waitUntil: () => {} }).then((r) => r.status);
  assert.equal(await get(FORGED), 403);
  assert.equal(await get({ "Cf-Access-Jwt-Assertion": await accessJwt() }), 200);
});

test("the test-only trust switch is off in this suite", () => {
  assert.notEqual(globalThis.__SMD_TEST_TRUST_CF_ACCESS_HEADER, true);
});
