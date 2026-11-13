/* test/appcheck.test.mjs — Firebase App Check JWT verifier (functions/_appcheck.js).
 *
 * Mints RS256 tokens against a local RSA key + JWKS stub (same pattern as
 * test/cf-access-verify.test.mjs). Covers valid token OK and every reject path the design names:
 * wrong iss/aud, expired, bad signature, unknown kid, alg:none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyAppCheck, resetAppCheckJwksCache, APPCHECK_JWKS_URL, APPCHECK_PROJECT_NUMBER_DEFAULT,
} from "../functions/_appcheck.js";

const PN = APPCHECK_PROJECT_NUMBER_DEFAULT;   // 911280405587 from GoogleService-Info.plist
const ENV = { FIREBASE_PROJECT_NUMBER: PN };

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const gen = () => crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const kp = await gen(), rogue = await gen();
const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
const jwk = Object.assign({}, pub, { kid: "ac1", alg: "RS256", use: "sig" });

async function sign(header, claims, key) {
  const h = b64u(JSON.stringify(header));
  const p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", (key || kp).privateKey, new TextEncoder().encode(h + "." + p)
  );
  return h + "." + p + "." + b64u(sig);
}
const now = () => Math.floor(Date.now() / 1000);
function goodClaims(extra) {
  return Object.assign({
    iss: "https://firebaseappcheck.googleapis.com/" + PN,
    aud: ["projects/" + PN],
    sub: "1:" + PN + ":ios:abc",
    iat: now(),
    exp: now() + 600,
  }, extra || {});
}
const appJwt = (claims, key) => sign({ alg: "RS256", kid: "ac1", typ: "JWT" }, goodClaims(claims), key);

const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  if (String(u) === APPCHECK_JWKS_URL) {
    return new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=21600" },
    });
  }
  return realFetch(u, i);
};

function req(token) {
  const h = {};
  if (token != null) h["X-Firebase-AppCheck"] = token;
  return new Request("https://stewardmd.in/api/ota/check", { headers: h });
}

test("verifyAppCheck: valid RS256 token against local JWKS is accepted", async () => {
  resetAppCheckJwksCache();
  const payload = await verifyAppCheck(req(await appJwt()), ENV);
  assert.ok(payload, "valid token must verify");
  assert.equal(payload.iss, "https://firebaseappcheck.googleapis.com/" + PN);
  assert.ok(payload.aud.includes("projects/" + PN));
});

test("verifyAppCheck: missing header → null", async () => {
  resetAppCheckJwksCache();
  assert.equal(await verifyAppCheck(req(null), ENV), null);
  assert.equal(await verifyAppCheck(req(""), ENV), null);
});

test("verifyAppCheck: wrong iss rejected", async () => {
  resetAppCheckJwksCache();
  const tok = await appJwt({ iss: "https://firebaseappcheck.googleapis.com/000000000000" });
  assert.equal(await verifyAppCheck(req(tok), ENV), null);
});

test("verifyAppCheck: wrong aud rejected", async () => {
  resetAppCheckJwksCache();
  assert.equal(await verifyAppCheck(req(await appJwt({ aud: ["projects/000000000000"] })), ENV), null);
  assert.equal(await verifyAppCheck(req(await appJwt({ aud: "projects/000000000000" })), ENV), null);
});

test("verifyAppCheck: expired rejected", async () => {
  resetAppCheckJwksCache();
  assert.equal(await verifyAppCheck(req(await appJwt({ exp: now() - 30 })), ENV), null);
});

test("verifyAppCheck: bad signature (rogue key) rejected", async () => {
  resetAppCheckJwksCache();
  assert.equal(await verifyAppCheck(req(await appJwt({}, rogue)), ENV), null);
});

test("verifyAppCheck: unknown kid rejected", async () => {
  resetAppCheckJwksCache();
  const tok = await sign({ alg: "RS256", kid: "no-such-kid", typ: "JWT" }, goodClaims());
  assert.equal(await verifyAppCheck(req(tok), ENV), null);
});

test("verifyAppCheck: alg:none rejected", async () => {
  resetAppCheckJwksCache();
  const h = b64u(JSON.stringify({ alg: "none", kid: "ac1", typ: "JWT" }));
  const p = b64u(JSON.stringify(goodClaims()));
  const tok = h + "." + p + ".";
  assert.equal(await verifyAppCheck(req(tok), ENV), null);
});

test("verifyAppCheck: string aud projects/<number> accepted", async () => {
  resetAppCheckJwksCache();
  const payload = await verifyAppCheck(req(await appJwt({ aud: "projects/" + PN })), ENV);
  assert.ok(payload);
});

test("verifyAppCheck: FIREBASE_PROJECT_NUMBER from env is required for iss/aud match", async () => {
  resetAppCheckJwksCache();
  const other = "999999999999";
  const tok = await sign(
    { alg: "RS256", kid: "ac1", typ: "JWT" },
    {
      iss: "https://firebaseappcheck.googleapis.com/" + other,
      aud: ["projects/" + other],
      sub: "x", iat: now(), exp: now() + 600,
    }
  );
  assert.equal(await verifyAppCheck(req(tok), ENV), null, "token for another project number");
  assert.ok(await verifyAppCheck(req(tok), { FIREBASE_PROJECT_NUMBER: other }), "same number in env");
});
