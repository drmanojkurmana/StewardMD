// The ABDM V3 callback receiver: route table, mandatory headers, bearer verification, replay, and the
// 60-second acknowledgement discipline. See docs/connect/abdm/V3-SPEC-RECONCILIATION.md D3.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROUTES, HIP_ROUTES, HIU_ROUTES, routeFor, readHeaders, seenBefore, verifyBearer,
  expectedIssuer, handleCallback, CallbackError,
} from "../../../functions/_connect/abdm/callbacks.js";

const NOW = "2026-08-18T12:00:00.000Z";
const ENV = { ABDM_ENV: "sandbox", ABDM_CALLBACK_BASE: "https://abdm.stewardmd.in", ABDM_JWKS_URL: "https://dev.abdm.gov.in/api/hiecm/gateway/v3/certs" };

// ── a real RS256 signer, so bearer verification is exercised for real ───────────────────────────────
const b64u = (b) => Buffer.from(b).toString("base64url");
async function signer() {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const kid = "test-kid-1";
  const jwks = { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] };
  const mint = async (claims, alg = "RS256") => {
    const h = b64u(JSON.stringify({ alg, typ: "JWT", kid }));
    const p = b64u(JSON.stringify(claims));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p));
    return h + "." + p + "." + Buffer.from(sig).toString("base64url");
  };
  return { jwks, mint, kid };
}

const goodClaims = (over = {}) => ({
  iss: "https://dev.abdm.gov.in/auth/realms/cent",
  exp: Math.floor(Date.parse(NOW) / 1000) + 600,
  iat: Math.floor(Date.parse(NOW) / 1000) - 10,
  ...over,
});

function req({ path = "/api/v3/hip/patient/care-context/discover", method = "POST", token, headers = {}, body = {} } = {}) {
  const h = new Map(Object.entries({
    "REQUEST-ID": crypto.randomUUID(),
    TIMESTAMP: NOW,
    "X-HIP-ID": "IN0710000001",
    ...(token ? { authorization: "Bearer " + token } : {}),
    ...headers,
  }));
  return {
    method,
    url: "https://abdm.stewardmd.in" + path,
    headers: { get: (n) => { for (const [k, v] of h) if (k.toLowerCase() === n.toLowerCase()) return v; return null; } },
    json: async () => body,
  };
}

function memKv() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } };
}
const depsFor = (jwks, extra = {}) => ({
  fetch: async () => ({ ok: true, status: 200, json: async () => jwks }),
  kv: memKv(), now: () => NOW, ...extra,
});

// ── route table ─────────────────────────────────────────────────────────────────────────────────────
test("every V3 callback path ABDM can call is routed", () => {
  for (const p of [
    "/api/v3/hip/token/on-generate-token", "/api/v3/hip/patient/care-context/discover",
    "/api/v3/hip/link/care-context/init", "/api/v3/hip/link/care-context/confirm",
    "/api/v3/link/on_carecontext", "/api/v3/links/context/on-notify", "/api/v3/patients/sms/on-notify",
    "/api/v3/consent/request/hip/notify", "/api/v3/hip/health-information/request", "/api/v3/hip/patient/share",
    "/api/v3/hiu/consent/request/on-init", "/api/v3/hiu/consent/request/on-status",
    "/api/v3/hiu/consent/request/notify", "/api/v3/hiu/consent/on-fetch",
    "/api/v3/hiu/health-information/on-request", "/api/v3/hiu/patient/on-share",
  ]) assert.ok(routeFor(p), "unrouted: " + p);
  assert.equal(Object.keys(HIP_ROUTES).length, 10);
  assert.equal(Object.keys(HIU_ROUTES).length, 6);
  assert.equal(Object.keys(ROUTES).length, 16);
});

test("routes carry the role that decides which id header is expected", () => {
  assert.equal(routeFor("/api/v3/hip/patient/share").role, "hip");
  assert.equal(routeFor("/api/v3/hiu/consent/on-fetch").role, "hiu");
});

test("a trailing slash or query string still routes; anything else does not", () => {
  assert.ok(routeFor("/api/v3/hip/patient/share/"));
  assert.ok(routeFor("/api/v3/hip/patient/share?x=1"));
  assert.equal(routeFor("/api/v3/hip/patient/shares"), null);
  assert.equal(routeFor("/"), null);
  assert.equal(routeFor(""), null);
});

// ── headers ─────────────────────────────────────────────────────────────────────────────────────────
test("the mandatory headers are enforced", () => {
  assert.throws(() => readHeaders(req({ headers: { "REQUEST-ID": undefined } }), "hip", () => NOW), CallbackError);
  const h = readHeaders(req(), "hip", () => NOW);
  assert.equal(h.entityId, "IN0710000001");
  assert.equal(h.timestamp, NOW);
});

test("a missing or unparseable TIMESTAMP, or one outside the skew, is refused", () => {
  const mk = (ts) => ({ ...req(), headers: { get: (n) => (n === "REQUEST-ID" ? "r" : n === "TIMESTAMP" ? ts : null) } });
  assert.throws(() => readHeaders(mk(null), "hip", () => NOW), CallbackError);
  assert.throws(() => readHeaders(mk("not-a-date"), "hip", () => NOW), CallbackError);
  assert.throws(() => readHeaders(mk("2026-08-18T14:00:00.000Z"), "hip", () => NOW), CallbackError); // +2h
  assert.doesNotThrow(() => readHeaders(mk("2026-08-18T12:05:00.000Z"), "hip", () => NOW));           // +5m
});

test("the HIU role reads X-HIU-ID instead of X-HIP-ID", () => {
  const r = req({ path: "/api/v3/hiu/consent/on-fetch", headers: { "X-HIP-ID": undefined, "X-HIU-ID": "HIU-1" } });
  assert.equal(readHeaders(r, "hiu", () => NOW).entityId, "HIU-1");
});

// ── bearer ──────────────────────────────────────────────────────────────────────────────────────────
test("the expected issuer follows the environment and is overridable", () => {
  assert.equal(expectedIssuer(ENV), "https://dev.abdm.gov.in/auth/realms/cent");
  assert.equal(expectedIssuer({ ABDM_ENV: "production" }), "https://apis.abdm.gov.in/auth/realms/cent");
  assert.equal(expectedIssuer({ ...ENV, ABDM_TOKEN_ISSUER: "https://x/realm" }), "https://x/realm");
});

test("a correctly signed, unexpired, right-issuer bearer verifies", async () => {
  const { jwks, mint } = await signer();
  const claims = await verifyBearer(ENV, depsFor(jwks), req({ token: await mint(goodClaims()) }));
  assert.equal(claims.iss, "https://dev.abdm.gov.in/auth/realms/cent");
});

test("no bearer, an expired one, or a foreign issuer are all refused 401", async () => {
  const { jwks, mint } = await signer();
  const deps = depsFor(jwks);
  const expired = await mint(goodClaims({ exp: Math.floor(Date.parse(NOW) / 1000) - 5 }));
  const foreign = await mint(goodClaims({ iss: "https://evil.example/realm" }));
  await assert.rejects(() => verifyBearer(ENV, deps, req({})), (e) => e.status === 401);
  await assert.rejects(() => verifyBearer(ENV, deps, req({ token: expired })), (e) => e.status === 401);
  await assert.rejects(() => verifyBearer(ENV, deps, req({ token: foreign })), (e) => e.status === 401);
});

test("a token signed by an unknown key is refused, not trusted", async () => {
  const a = await signer(), b = await signer();
  const foreignKeyToken = await b.mint(goodClaims());
  await assert.rejects(
    () => verifyBearer(ENV, depsFor(a.jwks), req({ token: foreignKeyToken })),
    (e) => e.status === 401);
});

test("when the JWKS cannot be reached the callback fails closed with 503", async () => {
  const deps = { fetch: async () => { throw new Error("network down"); }, kv: memKv(), now: () => NOW };
  const { mint } = await signer();
  const token = await mint(goodClaims());
  await assert.rejects(() => verifyBearer(ENV, deps, req({ token })), (e) => e.status === 503);
});

// ── replay ──────────────────────────────────────────────────────────────────────────────────────────
test("a REQUEST-ID is accepted once and recognised as a replay after that", async () => {
  const kv = memKv();
  assert.equal(await seenBefore(kv, "id-1"), false);
  assert.equal(await seenBefore(kv, "id-1"), true);
  assert.equal(await seenBefore(kv, "id-2"), false);
});

test("with no KV the replay check does not block legitimate traffic", async () => {
  assert.equal(await seenBefore(null, "id-1"), false);
});

// ── the receiver end to end ─────────────────────────────────────────────────────────────────────────
test("a valid callback acknowledges 202 and runs the handler for its kind", async () => {
  const { jwks, mint } = await signer();
  const seen = [];
  const deps = depsFor(jwks, { handlers: { discover: async (ctx) => { seen.push(ctx); } } });
  const res = await handleCallback(ENV, deps, req({ token: await mint(goodClaims()), body: { transactionId: "T1" } }));
  assert.equal(res.status, 202);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.transactionId, "T1");
  assert.equal(seen[0].route.kind, "discover");
  assert.equal(seen[0].headers.entityId, "IN0710000001");
});

test("an unknown path 404s and a GET is refused", async () => {
  const { jwks, mint } = await signer();
  const deps = depsFor(jwks);
  const t = await mint(goodClaims());
  assert.equal((await handleCallback(ENV, deps, req({ path: "/api/v3/nope", token: t }))).status, 404);
  assert.equal((await handleCallback(ENV, deps, req({ method: "GET", token: t }))).status, 405);
});

test("a rejected bearer never reaches a handler", async () => {
  const { jwks } = await signer();
  let ran = false;
  const deps = depsFor(jwks, { handlers: { discover: async () => { ran = true; } } });
  const res = await handleCallback(ENV, deps, req({}));   // no token
  assert.equal(res.status, 401);
  assert.equal(ran, false);
});

test("a replayed callback is acknowledged but the handler runs only once", async () => {
  const { jwks, mint } = await signer();
  let runs = 0;
  const deps = depsFor(jwks, { handlers: { discover: async () => { runs += 1; } } });
  const rid = crypto.randomUUID();
  const token = await mint(goodClaims());
  const mk = () => req({ token, headers: { "REQUEST-ID": rid } });
  assert.equal((await handleCallback(ENV, deps, mk())).status, 202);
  const second = await handleCallback(ENV, deps, mk());
  assert.equal(second.status, 202);
  assert.equal(JSON.parse(await second.text()).duplicate, true);
  assert.equal(runs, 1);
});

test("an unimplemented kind still acknowledges, so ABDM does not retry-storm", async () => {
  const { jwks, mint } = await signer();
  const unhandled = [];
  const deps = depsFor(jwks, { handlers: {}, onUnhandled: (x) => unhandled.push(x) });
  const res = await handleCallback(ENV, deps, req({ token: await mint(goodClaims()) }));
  assert.equal(res.status, 202);
  assert.equal(JSON.parse(await res.text()).handled, false);
  assert.equal(unhandled.length, 1);
});

test("a throwing handler still leaves a 202 - the ack is already committed", async () => {
  const { jwks, mint } = await signer();
  const errs = [];
  const deps = depsFor(jwks, { handlers: { discover: async () => { throw new Error("downstream broke"); } }, onError: (e) => errs.push(e) });
  const res = await handleCallback(ENV, deps, req({ token: await mint(goodClaims()) }));
  assert.equal(res.status, 202);
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /downstream broke/);
});

test("waitUntil is used when available, so the ack is not held behind the work", async () => {
  const { jwks, mint } = await signer();
  const pending = [];
  let done = false;
  const deps = depsFor(jwks, {
    handlers: { discover: async () => { await new Promise((r) => setTimeout(r, 5)); done = true; } },
    waitUntil: (p) => pending.push(p),
  });
  const res = await handleCallback(ENV, deps, req({ token: await mint(goodClaims()) }));
  assert.equal(res.status, 202);
  assert.equal(done, false, "the handler must not have been awaited before responding");
  await Promise.all(pending);
  assert.equal(done, true);
});

test("a non-JSON body is refused before any handler runs", async () => {
  const { jwks, mint } = await signer();
  let ran = false;
  const deps = depsFor(jwks, { handlers: { discover: async () => { ran = true; } } });
  const r = req({ token: await mint(goodClaims()) });
  r.json = async () => { throw new Error("not json"); };
  const res = await handleCallback(ENV, deps, r);
  assert.equal(res.status, 400);
  assert.equal(ran, false);
});

test("a path prefix on the callback base is stripped before routing", async () => {
  const { jwks, mint } = await signer();
  const deps = depsFor(jwks, { handlers: { discover: async () => {} } });
  const env = { ...ENV, ABDM_CALLBACK_PATH_PREFIX: "/abdm" };
  const r = req({ path: "/abdm/api/v3/hip/patient/care-context/discover", token: await mint(goodClaims()) });
  assert.equal((await handleCallback(env, deps, r)).status, 202);
});
