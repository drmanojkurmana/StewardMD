/* test/iap.test.mjs — store IAP verification. Real WebCrypto key + signJwt; mocked store HTTP.
 * Validates: encoding helpers, fail-closed guards, Google active/expired parsing, Apple active/expired. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPurchase, iapConfigured, b64url, b64urlStr, b64urlDecodeToStr, pemToDer, daysFromExpiry } from "../functions/_iap.js";

const subtle = globalThis.crypto.subtle;
function pemFromDer(buf, label) {
  const b64 = Buffer.from(new Uint8Array(buf)).toString("base64").replace(/(.{64})/g, "$1\n");
  return "-----BEGIN " + label + "-----\n" + b64 + "\n-----END " + label + "-----";
}
async function rsaPem() {
  const k = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  return pemFromDer(await subtle.exportKey("pkcs8", k.privateKey), "PRIVATE KEY");
}
async function ecPem() {
  const k = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return pemFromDer(await subtle.exportKey("pkcs8", k.privateKey), "PRIVATE KEY");
}
function jwsWith(payloadObj) {
  const p = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  return "eyJhbGciOiJFUzI1NiJ9." + p + ".sig";
}

test("encoding helpers roundtrip", () => {
  assert.equal(b64urlDecodeToStr(b64urlStr("héllo/+=world")), "héllo/+=world");
  assert.ok(!/[+/=]/.test(b64url(new Uint8Array([251, 252, 253, 254, 255]))));   // url-safe, no padding
  assert.ok(pemToDer("-----BEGIN X-----\nQUJD\n-----END X-----").byteLength === 3);   // "ABC"
});

test("verifyPurchase fail-closed: unknown platform / not configured", async () => {
  assert.equal((await verifyPurchase({}, { platform: "windows" })).configured, false);
  assert.equal((await verifyPurchase({}, { platform: "google" })).reason, "not-configured");
  assert.equal(iapConfigured({ GOOGLE_PLAY_SA_JSON: "{}", GOOGLE_PLAY_PACKAGE: "in.stewardmd.app" }, "google"), true);
});

test("Google Play: active subscription -> valid with expiry", async () => {
  const env = { GOOGLE_PLAY_SA_JSON: JSON.stringify({ client_email: "sa@x.iam", private_key: await rsaPem() }), GOOGLE_PLAY_PACKAGE: "in.stewardmd.app" };
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push(url);
    if (url.indexOf("oauth2") > -1) return { ok: true, status: 200, json: async () => ({ access_token: "AT" }) };
    return { ok: true, status: 200, json: async () => ({ subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: [{ expiryTime: "2026-11-01T00:00:00Z" }] }) };
  };
  const r = await verifyPurchase(env, { platform: "google", purchaseToken: "TOK" }, { fetch: fetchFn });
  assert.equal(r.valid, true); assert.equal(r.source, "google-play");
  assert.equal(r.expiresAt, Date.parse("2026-11-01T00:00:00Z"));
  assert.ok(calls[0].indexOf("oauth2") > -1 && calls[1].indexOf("subscriptionsv2") > -1);
});

test("Google Play: expired subscription -> not valid", async () => {
  const env = { GOOGLE_PLAY_SA_JSON: JSON.stringify({ client_email: "sa@x.iam", private_key: await rsaPem() }), GOOGLE_PLAY_PACKAGE: "in.stewardmd.app" };
  const fetchFn = async (url) => url.indexOf("oauth2") > -1
    ? { ok: true, status: 200, json: async () => ({ access_token: "AT" }) }
    : { ok: true, status: 200, json: async () => ({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED", lineItems: [] }) };
  const r = await verifyPurchase(env, { platform: "google", purchaseToken: "TOK" }, { fetch: fetchFn });
  assert.equal(r.valid, false);
});

test("Apple: active status -> valid with expiry from signed JWS", async () => {
  const env = { APPLE_ASC_KEY: await ecPem(), APPLE_ASC_KEY_ID: "KID", APPLE_ASC_ISSUER: "ISS", APPLE_BUNDLE_ID: "in.stewardmd.app" };
  const exp = Date.parse("2026-12-01T00:00:00Z");
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ lastTransactions: [{ status: 1, signedTransactionInfo: jwsWith({ expiresDate: exp }) }] }] }) });
  const r = await verifyPurchase(env, { platform: "apple", transactionId: "T1" }, { fetch: fetchFn });
  assert.equal(r.valid, true); assert.equal(r.source, "app-store"); assert.equal(r.expiresAt, exp);
});

test("Apple: expired status -> not valid", async () => {
  const env = { APPLE_ASC_KEY: await ecPem(), APPLE_ASC_KEY_ID: "KID", APPLE_ASC_ISSUER: "ISS", APPLE_BUNDLE_ID: "in.stewardmd.app" };
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ lastTransactions: [{ status: 2, signedTransactionInfo: jwsWith({ expiresDate: 0 }) }] }] }) });
  const r = await verifyPurchase(env, { platform: "apple", transactionId: "T1" }, { fetch: fetchFn });
  assert.equal(r.valid, false);
});

test("daysFromExpiry >= 1", () => {
  assert.equal(daysFromExpiry(Date.now() + 5 * 86400000), 5);
  assert.equal(daysFromExpiry(Date.now() - 1000), 1);
});
