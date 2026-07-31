// test/connect/abdm/jws.test.mjs — pinned JWS verifier (Stage-4 Task-2). SECURITY PRIMITIVE.
// Test keys are generated in-process with WebCrypto (extractable) + exportKey('jwk') — no fixtures on disk,
// no new deps. The module only VERIFIES; this file owns the (adversarial) JWS-signing helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyJws, getPinnedJwks, JwsError, ABDM_JWKS_HOSTS } from "../../../functions/_connect/abdm/jws.js";

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

// ── base64url helpers (test side) ────────────────────────────────────────────
function bytesToB64url(bytes) {
  const u = new Uint8Array(bytes); let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const strToB64url = (str) => bytesToB64url(enc.encode(str));
const b64urlToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4; if (pad) s += "=".repeat(4 - pad);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

// Build a compact JWS: header + payload signed with `signAlgo` under `key`.
async function signJws(header, payload, signAlgo, key) {
  const h = strToB64url(JSON.stringify(header));
  const p = strToB64url(JSON.stringify(payload));
  const sig = await subtle.sign(signAlgo, key, enc.encode(h + "." + p));
  return h + "." + p + "." + bytesToB64url(sig);
}

// ── key material (generated once) ────────────────────────────────────────────
const RS_GEN = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const RS_SIGN = { name: "RSASSA-PKCS1-v1_5" };
const ES_GEN = { name: "ECDSA", namedCurve: "P-256" };
const ES_SIGN = { name: "ECDSA", hash: "SHA-256" };

const rsa = await subtle.generateKey(RS_GEN, true, ["sign", "verify"]);
const rsaJwk = await subtle.exportKey("jwk", rsa.publicKey);
rsaJwk.kid = "rsa-1"; rsaJwk.alg = "RS256"; rsaJwk.use = "sig";

const ec = await subtle.generateKey(ES_GEN, true, ["sign", "verify"]);
const ecJwk = await subtle.exportKey("jwk", ec.publicKey);
ecJwk.kid = "ec-1"; ecJwk.alg = "ES256"; ecJwk.use = "sig";

// Attacker RSA key — NOT in the pinned JWKS, but re-uses the legit kid "rsa-1".
const atk = await subtle.generateKey(RS_GEN, true, ["sign", "verify"]);
const atkJwk = await subtle.exportKey("jwk", atk.publicKey);
atkJwk.kid = "rsa-1"; atkJwk.alg = "RS256"; atkJwk.use = "sig";
const ATTACKER_JWKS = { keys: [atkJwk] };

const JWKS = { keys: [rsaJwk, ecJwk] };   // the PINNED JWKS

// ── verifyJws: happy paths ───────────────────────────────────────────────────
test("verifyJws accepts a valid RS256 token over the pinned JWKS", async () => {
  const token = await signJws({ alg: "RS256", kid: "rsa-1", typ: "JWT" }, { sub: "hip-1", careContext: "cc" }, RS_SIGN, rsa.privateKey);
  const r = await verifyJws(token, { jwks: JWKS });
  assert.equal(r.ok, true);
  assert.equal(r.payload.sub, "hip-1");
  assert.equal(r.payload.careContext, "cc");
});

test("verifyJws accepts a valid ES256 token over the pinned JWKS", async () => {
  const token = await signJws({ alg: "ES256", kid: "ec-1", typ: "JWT" }, { sub: "hip-2" }, ES_SIGN, ec.privateKey);
  const r = await verifyJws(token, { jwks: JWKS });
  assert.equal(r.ok, true);
  assert.equal(r.payload.sub, "hip-2");
});

test("verifyJws honours a caller allow-list narrower than the pinned set (RS256 refused when only ES256 allowed)", async () => {
  const token = await signJws({ alg: "RS256", kid: "rsa-1" }, { sub: "x" }, RS_SIGN, rsa.privateKey);
  const r = await verifyJws(token, { jwks: JWKS, allowedAlgs: ["ES256"] });
  assert.equal(r.ok, false);
  assert.equal(r.payload, null);
});

// ── verifyJws: alg attacks ───────────────────────────────────────────────────
test("verifyJws rejects alg:\"none\" (unsecured JWS)", async () => {
  const h = strToB64url(JSON.stringify({ alg: "none", kid: "rsa-1" }));
  const p = strToB64url(JSON.stringify({ sub: "attacker" }));
  const token = h + "." + p + ".";   // empty signature
  const r = await verifyJws(token, { jwks: JWKS });
  assert.equal(r.ok, false);
  assert.equal(r.payload, null);
});

test("verifyJws blocks the RSA-public-key-as-HMAC-secret confusion attack (HS256 forged with the JWKS modulus)", async () => {
  // Classic key-confusion: the attacker HMACs with the (public) RSA modulus bytes as the shared secret.
  const secretBytes = b64urlToBytes(rsaJwk.n);
  const hmacKey = await subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const token = await signJws({ alg: "HS256", kid: "rsa-1", typ: "JWT" }, { sub: "attacker" }, { name: "HMAC" }, hmacKey);
  const r = await verifyJws(token, { jwks: JWKS });
  assert.equal(r.ok, false);   // rejected at the alg allow-list, BEFORE any key is touched
  assert.equal(r.payload, null);
});

test("verifyJws cannot be coerced into HMAC even if a caller allow-list names HS256 (structural)", async () => {
  const secretBytes = b64urlToBytes(rsaJwk.n);
  const hmacKey = await subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const token = await signJws({ alg: "HS256", kid: "rsa-1" }, { sub: "attacker" }, { name: "HMAC" }, hmacKey);
  const r = await verifyJws(token, { jwks: JWKS, allowedAlgs: ["HS256", "RS256"] });
  assert.equal(r.ok, false);
});

// ── verifyJws: embedded-locator attacks (jku/x5u/url-kid never dereferenced) ──
test("verifyJws IGNORES an embedded jku/x5u pointing at an attacker JWKS (uses only the pinned key)", async () => {
  // Signed by the ATTACKER key, but the header kid re-uses the legit "rsa-1" and carries a jku/x5u to an
  // attacker JWKS. If the locator were dereferenced the attacker key would validate; against the pinned
  // JWKS the legit key is selected and the (attacker) signature fails. Note verifyJws takes NO fetch dep,
  // so dereferencing is structurally impossible.
  const token = await signJws(
    { alg: "RS256", kid: "rsa-1", jku: "https://attacker.example/jwks.json", x5u: "https://attacker.example/x5u" },
    { sub: "attacker" }, RS_SIGN, atk.privateKey);
  const r = await verifyJws(token, { jwks: JWKS });
  assert.equal(r.ok, false);
  // Sanity: that same attacker token WOULD validate against the attacker JWKS — proving the pinning is what stops it.
  const bad = await verifyJws(token, { jwks: ATTACKER_JWKS });
  assert.equal(bad.ok, true);
});

test("verifyJws rejects a kid not present in the pinned JWKS", async () => {
  const token = await signJws({ alg: "RS256", kid: "unknown-kid" }, { sub: "x" }, RS_SIGN, atk.privateKey);
  const r = await verifyJws(token, { jwks: JWKS });
  assert.equal(r.ok, false);
});

test("verifyJws treats a URL-looking kid as an opaque id, never a locator to dereference", async () => {
  const token = await signJws({ alg: "RS256", kid: "https://attacker.example/keys#1" }, { sub: "x" }, RS_SIGN, atk.privateKey);
  const r = await verifyJws(token, { jwks: JWKS });
  assert.equal(r.ok, false);   // no kid match in the pinned JWKS; the URL is NOT fetched
});

// ── verifyJws: tamper + malformed ────────────────────────────────────────────
test("verifyJws rejects a token whose payload was tampered after signing", async () => {
  const token = await signJws({ alg: "RS256", kid: "rsa-1" }, { sub: "hip-1", amount: 1 }, RS_SIGN, rsa.privateKey);
  const [h, , s] = token.split(".");
  const forgedPayload = strToB64url(JSON.stringify({ sub: "hip-1", amount: 999999 }));
  const r = await verifyJws(h + "." + forgedPayload + "." + s, { jwks: JWKS });
  assert.equal(r.ok, false);
  assert.equal(r.payload, null);
});

test("verifyJws fails closed (never throws) on malformed input", async () => {
  for (const bad of ["garbage", "a.b", "", "...", null, undefined, 42, "a.b.c.d"]) {
    const r = await verifyJws(bad, { jwks: JWKS });
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test("verifyJws fails closed when no JWKS is supplied (defense in depth)", async () => {
  const token = await signJws({ alg: "RS256", kid: "rsa-1" }, { sub: "x" }, RS_SIGN, rsa.privateKey);
  for (const jwks of [null, undefined, {}, { keys: [] }]) {
    const r = await verifyJws(token, { jwks });
    assert.equal(r.ok, false);
  }
});

test("verifyJws rejects a key whose kty is incompatible with the header alg", async () => {
  // ES256 header but select the RSA key by re-labelling it with the ec kid.
  const mislabeled = { ...rsaJwk, kid: "ec-1" };
  const token = await signJws({ alg: "ES256", kid: "ec-1" }, { sub: "x" }, ES_SIGN, ec.privateKey);
  const r = await verifyJws(token, { jwks: { keys: [mislabeled] } });
  assert.equal(r.ok, false);   // kty RSA cannot be used for ES256
});

// ── getPinnedJwks: allow-list + TLS + fail-closed ────────────────────────────
function kvMock() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, String(v)) }; }
function mockFetch(handler) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  f.calls = calls;
  return f;
}
const ALLOWED_URL = "https://" + ABDM_JWKS_HOSTS[0] + "/certs";

test("ABDM_JWKS_HOSTS is a non-empty allow-list of host strings", () => {
  assert.ok(Array.isArray(ABDM_JWKS_HOSTS));
  assert.ok(ABDM_JWKS_HOSTS.length >= 1);
  for (const h of ABDM_JWKS_HOSTS) assert.equal(typeof h, "string");
});

test("getPinnedJwks fails closed when the JWKS URL is unset (no bypass)", async () => {
  await assert.rejects(() => getPinnedJwks({}, { fetch: mockFetch(() => ({ ok: true })), kv: kvMock() }), JwsError);
});

test("getPinnedJwks refuses a non-https URL (TLS only)", async () => {
  const env = { ABDM_JWKS_URL: "http://" + ABDM_JWKS_HOSTS[0] + "/certs" };
  await assert.rejects(() => getPinnedJwks(env, { fetch: mockFetch(() => ({ ok: true })), kv: kvMock() }), JwsError);
});

test("getPinnedJwks refuses a host that is not on the allow-list", async () => {
  const env = { ABDM_JWKS_URL: "https://attacker.example/jwks.json" };
  const fetch = mockFetch(() => ({ ok: true, status: 200, json: async () => JWKS }));
  await assert.rejects(() => getPinnedJwks(env, { fetch, kv: kvMock() }), JwsError);
  assert.equal(fetch.calls.length, 0);   // never even attempted the fetch
});

test("getPinnedJwks fails closed when the fetch throws (unreachable)", async () => {
  const env = { ABDM_JWKS_URL: ALLOWED_URL };
  const fetch = mockFetch(() => { throw new Error("ECONNREFUSED"); });
  await assert.rejects(() => getPinnedJwks(env, { fetch, kv: kvMock() }), JwsError);
});

test("getPinnedJwks fails closed on a non-2xx JWKS response", async () => {
  const env = { ABDM_JWKS_URL: ALLOWED_URL };
  const fetch = mockFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));
  await assert.rejects(() => getPinnedJwks(env, { fetch, kv: kvMock() }), JwsError);
});

test("getPinnedJwks fails closed on a JWKS body with no keys", async () => {
  const env = { ABDM_JWKS_URL: ALLOWED_URL };
  const fetch = mockFetch(() => ({ ok: true, status: 200, json: async () => ({ keys: [] }) }));
  await assert.rejects(() => getPinnedJwks(env, { fetch, kv: kvMock() }), JwsError);
});

test("getPinnedJwks fetches over TLS from the allow-listed host and caches in KV (2nd call: no 2nd fetch)", async () => {
  const env = { ABDM_JWKS_URL: ALLOWED_URL };
  const kv = kvMock();
  const fetch = mockFetch(() => ({ ok: true, status: 200, json: async () => JWKS }));
  const jwks1 = await getPinnedJwks(env, { fetch, kv });
  const jwks2 = await getPinnedJwks(env, { fetch, kv });
  assert.equal(jwks1.keys.length, 2);
  assert.equal(jwks2.keys.length, 2);
  assert.equal(fetch.calls.length, 1);   // second call served from KV cache
});

test("a JWKS fetched via getPinnedJwks verifies a real RS256 token end-to-end", async () => {
  const env = { ABDM_JWKS_URL: ALLOWED_URL };
  const fetch = mockFetch(() => ({ ok: true, status: 200, json: async () => JWKS }));
  const jwks = await getPinnedJwks(env, { fetch, kv: kvMock() });
  const token = await signJws({ alg: "RS256", kid: "rsa-1" }, { sub: "e2e" }, RS_SIGN, rsa.privateKey);
  const r = await verifyJws(token, { jwks });
  assert.equal(r.ok, true);
  assert.equal(r.payload.sub, "e2e");
});
