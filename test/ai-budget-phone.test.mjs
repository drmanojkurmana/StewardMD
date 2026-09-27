/* test/ai-budget-phone.test.mjs - D8 (owner, 2026-09-26): the FREE AI allowance needs a verified
 * MOBILE NUMBER. A non-Pro account gets BUDGET_FREE_TOKENS only with claims.phoneVerified === true;
 * registration verification alone no longer grants it. Pro is unaffected. The refusal for a Free
 * account without a verified mobile carries reason "phone-unverified" so pro-notice.js can open the
 * phone sheet instead of a price.
 *
 * checkQuota runs for real: a locally-minted RS256 token, the Google JWK fetch stubbed to our key.
 * node --test test/ai-budget-phone.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveAllowance, monthlyCapFor } from "../functions/_aibudget.js";
import { checkQuota } from "../functions/_usage.js";

const ENV = { BUDGET_FREE_TOKENS: "5000" };

test("effectiveAllowance: non-Pro + phoneVerified -> free tokens; non-Pro without it -> 0; Pro unaffected", () => {
  assert.equal(effectiveAllowance(ENV, false, null, true, {}, "2026-09"), 5000);
  assert.equal(effectiveAllowance(ENV, false, null, false, {}, "2026-09"), 0);
  assert.equal(effectiveAllowance(ENV, true, null, false, {}, "2026-09"), 1000000);
  assert.equal(effectiveAllowance(ENV, true, "physician", false, {}, "2026-09"), 3000000);
  assert.equal(effectiveAllowance(ENV, false, null, false, { aiCapTokens: 800 }, "2026-09"), 800, "an owner override still wins");
});

test("every budget caller in the files this change owns passes phoneVerified, not verified", () => {
  const usage = readFileSync(new URL("../functions/_usage.js", import.meta.url), "utf8");
  assert.match(usage, /monthlyCapFor\(env, callerUid, isProCaller, callerPhoneVerified, month/);
  assert.match(usage, /callerPhoneVerified = !!\(pr\.claims && pr\.claims\.phoneVerified === true\)/);
  const ent = readFileSync(new URL("../functions/_entitlements.js", import.meta.url), "utf8");
  assert.match(ent, /effectiveAllowance\(env, claims\.pro === true, rec\.role, claims\.phoneVerified === true, rec, month\)/);
});

/* ── checkQuota end to end ────────────────────────────────────────────────────────────────────── */
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = Object.assign(await crypto.subtle.exportKey("jwk", kp.publicKey), { kid: "bp1", alg: "RS256" });
async function token(uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "bp1" }));
  const p = b64u(JSON.stringify(Object.assign({ aud: "stewardmd-498ec", iss: "https://securetoken.google.com/stewardmd-498ec", sub: uid, iat: now, exp: now + 3600, email: uid + "@example.com" }, claims)));
  return h + "." + p + "." + b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)));
}
function fakeKv() {
  const m = new Map();
  return { _m: m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }) };
}
const MONTH = new Date().toISOString().slice(0, 7);
const OLD = Date.now() - 30 * 86400000;   // registration verified a month ago: the free Pro week is over
async function gate(uid, claims, used) {
  const kv = fakeKv();
  if (used) await kv.put("maik:m:fb:" + uid + ":" + MONTH, JSON.stringify({ tokens: used }));
  // Per-user caps are enforced only with MAIK_ENFORCE_CAPS=1 (launch default is unlimited).
  const env = { MAIK_KV: kv, MAIK_ENFORCE_CAPS: "1", BUDGET_FREE_TOKENS: "5000", PRO_FREE_UNTIL: "1" };
  const req = new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { Authorization: "Bearer " + (await token(uid, claims)) } });
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).indexOf("securetoken@system") >= 0
    ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Cache-Control": "max-age=3600" } })
    : new Response("{}");
  try { return await checkQuota(env, req, "general"); } finally { globalThis.fetch = real; }
}

test("checkQuota: Free, registration-verified, mobile NOT verified -> 402 reason phone-unverified", async () => {
  const g = await gate("bp-u1", { verified: true, verifiedAt: OLD }, 0);
  assert.equal(g.ok, false);
  assert.equal(g.reason, "phone-unverified");
  assert.equal(g.needsPro, true);
  assert.match(g.message, /Verify your mobile number/);
  assert.equal(g.message.indexOf("—"), -1, "no em-dash");
});

test("checkQuota: Free with a verified mobile has the free allowance", async () => {
  const g = await gate("bp-u2", { verified: true, verifiedAt: OLD, phoneVerified: true }, 0);
  assert.equal(g.ok, true);
});

test("checkQuota: Free with a verified mobile, allowance spent -> the existing Pro-expiry reason is kept", async () => {
  const g = await gate("bp-u3", { verified: true, verifiedAt: OLD, phoneVerified: true }, 6000);
  assert.equal(g.ok, false); assert.equal(g.reason, "verified-week-expired"); assert.equal(g.needsPro, true);
  const g2 = await gate("bp-u4", { phoneVerified: true }, 6000);
  assert.equal(g2.reason, "unverified", "no registration: verifying it (free Pro week) is still the ask");
});

test("checkQuota: Pro is unaffected by the mobile flag", async () => {
  const g = await gate("bp-u5", { pro: true, verified: true, verifiedAt: OLD }, 6000);
  assert.equal(g.ok, true);
});

test("monthlyCapFor: the free allowance tracks phoneVerified through the cache", async () => {
  const kv = fakeKv(); const env = { BUDGET_FREE_TOKENS: "5000" };
  const d = { kv, getEntitlement: async () => ({}) };
  assert.equal(await monthlyCapFor(env, "bp-u6", false, false, MONTH, d), 0);
  assert.equal(await monthlyCapFor(env, "bp-u6", false, true, MONTH, d), 5000);
  assert.equal(await monthlyCapFor(env, "bp-u6", true, false, MONTH, d), 1000000);
});

test("checkQuota: an approved student/intern (traineeVerified) is not told to verify a registration", async () => {
  const g = await gate("bp-u8", { traineeVerified: true, verifiedAt: OLD, phoneVerified: true }, 6000);
  assert.equal(g.ok, false);
  assert.equal(g.reason, "verified-week-expired", "a reviewed account gets the Pro-expiry reason, not 'unverified'");
  assert.equal(g.verified, true);
});

test("thorex and sknx pass phoneVerified into the shared budget and say phone-unverified on a Free refusal", () => {
  for (const f of ["thorex", "sknx"]) {
    const src = readFileSync(new URL("../functions/api/" + f + "/[[path]].js", import.meta.url), "utf8");
    assert.match(src, /phoneVerified = !!\(pr\.claims && pr\.claims\.phoneVerified === true\)/, f);
    assert.match(src, /monthlyCapFor\(env, uid, isPro, phoneVerified, month/, f);
    assert.match(src, /\(phoneVerified \? "needs-pro" : "phone-unverified"\)/, f);
  }
});
