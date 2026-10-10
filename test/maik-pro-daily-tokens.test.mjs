/* test/maik-pro-daily-tokens.test.mjs - owner, 2026-10-10: "give every user who is pro 20K MaiK tokens
 * per day" (about Rs 10/day at most). checkQuota end to end with a signed token: a Pro account is
 * refused at 20,000 tokens for the day with a message that says so; an owner is never refused; the
 * router pre-parse and PrepNucleus are not counted as MaiK questions; MAIK_PRO_DAILY_TOKENS overrides.
 * node --test test/maik-pro-daily-tokens.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkQuota } from "../functions/_usage.js";
import { istDay } from "../functions/_counters.js";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = Object.assign(await crypto.subtle.exportKey("jwk", kp.publicKey), { kid: "pd1", alg: "RS256" });
async function token(uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "pd1" }));
  const p = b64u(JSON.stringify(Object.assign({ aud: "stewardmd-498ec", iss: "https://securetoken.google.com/stewardmd-498ec", sub: uid, iat: now, exp: now + 3600, email: uid + "@example.com", email_verified: true }, claims)));
  return h + "." + p + "." + b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)));
}
function fakeKv() {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }) };
}
async function gate(uid, claims, usedToday, extraEnv, type) {
  const kv = fakeKv();
  if (usedToday) await kv.put("maik:u:fb:" + uid + ":" + istDay(Date.now()), JSON.stringify({ general: 0, case: 0, intent: 0, ocr: 0, pdfPages: 0, tokens: usedToday }));
  const env = Object.assign({ MAIK_KV: kv, MAIK_ENFORCE_CAPS: "1", OWNER_EMAILS: "owner1@example.com" }, extraEnv || {});
  const req = new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { Authorization: "Bearer " + (await token(uid, claims)) } });
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).indexOf("securetoken@system") >= 0
    ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Cache-Control": "max-age=3600" } })
    : new Response("{}");
  try { return await checkQuota(env, req, type || "general"); } finally { globalThis.fetch = real; }
}
const PRO = { pro: true, proExp: Date.now() + 30 * 86400000, verified: true };

test("Pro under 20,000 tokens today: allowed", async () => {
  assert.equal((await gate("pd-a", PRO, 19999)).ok, true);
});

test("Pro at 20,000 tokens today: refused, and the message names the allowance", async () => {
  const g = await gate("pd-b", PRO, 20000);
  assert.equal(g.ok, false);
  assert.equal(g.reason, "pro-daily-tokens");
  assert.match(g.message, /20,000 MaiK tokens/);
  assert.match(g.message, /midnight/);
  assert.equal(g.message.indexOf("—"), -1, "no em-dash");
});

test("an owner is never refused by it", async () => {
  assert.equal((await gate("owner1", PRO, 500000)).ok, true);
});

test("the router pre-parse is not a MaiK question", async () => {
  assert.equal((await gate("pd-c", PRO, 25000, null, "router")).ok, true);
});

test("case questions count against the same allowance", async () => {
  assert.equal((await gate("pd-d", PRO, 20000, null, "case")).reason, "pro-daily-tokens");
});

test("MAIK_PRO_DAILY_TOKENS overrides the allowance", async () => {
  assert.equal((await gate("pd-e", PRO, 25000, { MAIK_PRO_DAILY_TOKENS: "30000" })).ok, true);
  assert.equal((await gate("pd-f", PRO, 25000, { MAIK_PRO_DAILY_TOKENS: "24000" })).reason, "pro-daily-tokens");
});

test("MAIK_ENFORCE_CAPS=0 lifts it with the other per-user caps", async () => {
  assert.equal((await gate("pd-g", PRO, 25000, { MAIK_ENFORCE_CAPS: "0" })).ok, true);
});

/* ── Admin control (owner, 2026-10-10: "give that increase option in admin section and user specific control too") ── */
import { setProDailyTokens, getProDailyTokens, setUserProTokens, getUserProTokens } from "../functions/_ai_usage.js";
async function gateWith(uid, usedToday, seed) {
  const kv = fakeKv();
  if (usedToday) await kv.put("maik:u:fb:" + uid + ":" + istDay(Date.now()), JSON.stringify({ general: 0, case: 0, intent: 0, ocr: 0, pdfPages: 0, tokens: usedToday }));
  await seed(kv);
  const env = { MAIK_KV: kv, MAIK_ENFORCE_CAPS: "1", OWNER_EMAILS: "owner1@example.com" };
  const req = new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { Authorization: "Bearer " + (await token(uid, PRO)) } });
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).indexOf("securetoken@system") >= 0 ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Cache-Control": "max-age=3600" } }) : new Response("{}");
  try { return await checkQuota(env, req, "general"); } finally { globalThis.fetch = real; }
}

test("app-wide value set in admin raises every Pro account's allowance", async () => {
  assert.equal((await gateWith("pa-1", 50000, (kv) => setProDailyTokens(kv, 60000))).ok, true);
  const g = await gateWith("pa-2", 60000, (kv) => setProDailyTokens(kv, 60000));
  assert.equal(g.reason, "pro-daily-tokens"); assert.match(g.message, /60,000 MaiK tokens/);
});

test("one account's own number beats the app-wide value, both ways", async () => {
  assert.equal((await gateWith("pa-3", 50000, async (kv) => { await setProDailyTokens(kv, 20000); await setUserProTokens(kv, "pa-3@example.com", 100000); })).ok, true, "raised for this account");
  assert.equal((await gateWith("pa-4", 6000, async (kv) => { await setProDailyTokens(kv, 60000); await setUserProTokens(kv, "pa-4@example.com", 5000); })).reason, "pro-daily-tokens", "lowered for this account");
});

test("unlimited for one account; clearing it returns to the app-wide value", async () => {
  assert.equal((await gateWith("pa-5", 900000, (kv) => setUserProTokens(kv, "pa-5@example.com", "unlimited"))).ok, true);
  assert.equal((await gateWith("pa-6", 30000, async (kv) => { await setUserProTokens(kv, "pa-6@example.com", "unlimited"); await setUserProTokens(kv, "pa-6@example.com", null); })).reason, "pro-daily-tokens");
});

test("stored values are validated", async () => {
  const kv = fakeKv();
  assert.equal(await setProDailyTokens(kv, 500), false, "below 1,000 refused");
  assert.equal(await setProDailyTokens(kv, "abc"), false);
  assert.equal(await setProDailyTokens(kv, 45000), true); assert.equal(await getProDailyTokens(kv), 45000);
  assert.equal(await setProDailyTokens(kv, ""), true); assert.equal(await getProDailyTokens(kv), null, "blank clears");
  assert.equal(await setUserProTokens(kv, "X@Y.in", -5), false);
  assert.equal(await setUserProTokens(kv, "X@Y.in", "unlimited"), true); assert.equal(await getUserProTokens(kv, "x@y.in"), -1, "email is case-insensitive");
});

/* ── The AI Usage screen reads the same allowance (owner, 2026-10-10: gave an account 60k in the admin console and the app dashboard still did not show it) ── */
import { proDailyTokensView } from "../functions/_usage.js";
async function view(uid, claims, usedToday, seed, owner) {
  const kv = fakeKv();
  if (usedToday) await kv.put("maik:u:fb:" + uid + ":" + istDay(Date.now()), JSON.stringify({ tokens: usedToday }));
  if (seed) await seed(kv);
  const env = { MAIK_KV: kv, OWNER_EMAILS: "owner1@example.com" };
  const req = new Request("https://stewardmd.in/api/ai/usage", { headers: { Authorization: "Bearer " + (await token(uid, claims)) } });
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).indexOf("securetoken@system") >= 0 ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Cache-Control": "max-age=3600" } }) : new Response("{}");
  try { return await proDailyTokensView(env, req, { id: "fb:" + uid, email: uid + "@example.com" }, kv); } finally { globalThis.fetch = real; }
}
test("usage screen: default allowance and today's use", async () => {
  const v = await view("pv-1", PRO, 4500);
  assert.deepEqual({ limit: v.limit, used: v.used, unlimited: v.unlimited }, { limit: 20000, used: 4500, unlimited: false });
});
test("usage screen: shows the number set for this account (60,000), which beats the app-wide value", async () => {
  const v = await view("pv-2", PRO, 100, async (kv) => { await setProDailyTokens(kv, 30000); await setUserProTokens(kv, "pv-2@example.com", 60000); });
  assert.equal(v.limit, 60000);
  assert.equal((await view("pv-3", PRO, 0, (kv) => setProDailyTokens(kv, 30000))).limit, 30000, "app-wide when the account has none");
});
test("usage screen: unlimited account and owner", async () => {
  assert.equal((await view("pv-4", PRO, 0, (kv) => setUserProTokens(kv, "pv-4@example.com", "unlimited"))).unlimited, true);
  assert.equal((await view("owner1", PRO, 0)).unlimited, true);
});
test("usage screen: a non-Pro account has no daily allowance to show", async () => {
  assert.equal(await view("pv-5", { verified: true }, 0), null);
});
