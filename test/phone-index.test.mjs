/* test/phone-index.test.mjs - one mobile number, one account (audit finding 14, 2026-09-26).
 *
 * Before: the OTP was keyed otp:phone:<uid> and markPhoneVerified stored the number with no index, so
 * one mobile could verify any number of accounts (and each got the Free AI allowance, D8). Now a
 * phone -> uid index (functions/_lifecycle.js), keyed by a HASH of the number, refuses a second live
 * account at phone-start (before any code is sent) and again at phone-verify.
 *
 * node --test test/phone-index.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { phoneStart, phoneVerify, phoneHash, otpKey, capKey, PHONE_HASH_PREFIX } from "../functions/_phone_otp.js";
import {
  phoneIndexKey, checkPhoneAvailable, bindPhone, releasePhone, markPhoneVerified, markPurged, getLifecycle,
} from "../functions/_lifecycle.js";

function memKV() {
  const m = new Map();
  return {
    _m: m,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list() { return { keys: [...m.keys()].map((name) => ({ name })), list_complete: true }; },
  };
}
const PHONE = "919876543210";
const alive = { userExists: async () => true };
function world() { const kv = memKV(); return { kv, env: { MAIK_KV: kv, CASES_KV: kv } }; }

test("phoneHash: SHA-256 hex over a fixed prefix + E.164, stable, and the key never carries the number", async () => {
  const h = await phoneHash(PHONE);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await phoneHash("+" + PHONE), h, "the + and spacing do not change the hash");
  const want = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PHONE_HASH_PREFIX + "+" + PHONE))).toString("hex");
  assert.equal(h, want);
  assert.notEqual(await phoneHash("919876543211"), h);
  const key = await phoneIndexKey(PHONE);
  assert.equal(key, "phoneidx:" + h);
  assert.equal(key.indexOf("9876543210"), -1);
});

test("bind: the first account binds; the same account re-binding is fine", async () => {
  const { env } = world();
  assert.deepEqual(await checkPhoneAvailable(env, "u1", PHONE, alive), { ok: true });
  assert.equal((await bindPhone(env, "u1", PHONE, alive)).ok, true);
  const idx = await env.MAIK_KV.get(await phoneIndexKey(PHONE), "json");
  assert.equal(idx.uid, "u1"); assert.ok(idx.at > 0);
  assert.deepEqual(await checkPhoneAvailable(env, "u1", PHONE, alive), { ok: true }, "same uid");
  assert.equal((await bindPhone(env, "u1", PHONE, alive)).ok, true, "re-bind same uid");
});

test("refuse: a number bound to another LIVE account is phone-in-use, and the index is not moved", async () => {
  const { env } = world();
  await bindPhone(env, "u1", PHONE, alive);
  await markPhoneVerified(env, "u1", PHONE);
  assert.deepEqual(await checkPhoneAvailable(env, "u2", PHONE, alive), { ok: false, error: "phone-in-use" });
  assert.deepEqual(await bindPhone(env, "u2", PHONE, alive), { ok: false, error: "phone-in-use" });
  assert.equal((await env.MAIK_KV.get(await phoneIndexKey(PHONE), "json")).uid, "u1");
});

test("fail closed: a Firebase lookup that errors (null) counts as live", async () => {
  const { env } = world();
  await bindPhone(env, "u1", PHONE, alive);
  assert.equal((await checkPhoneAvailable(env, "u2", PHONE, { userExists: async () => null })).ok, false);
});

test("release: a purged owner (lifecycle purgedAt) frees the number for another account", async () => {
  const { env } = world();
  await bindPhone(env, "u1", PHONE, alive);
  await markPhoneVerified(env, "u1", PHONE);
  await markPurged(env, "u1", "delete");
  const c = await checkPhoneAvailable(env, "u2", PHONE, alive);
  assert.equal(c.ok, true); assert.equal(c.released, "u1");
  assert.equal((await bindPhone(env, "u2", PHONE, alive)).ok, true);
  assert.equal((await env.MAIK_KV.get(await phoneIndexKey(PHONE), "json")).uid, "u2");
});

test("release: a deleted Firebase user (self-delete, no purge stamp) frees the number", async () => {
  const { env } = world();
  await bindPhone(env, "u1", PHONE, alive);
  const gone = { userExists: async (e, uid) => uid !== "u1" };
  assert.equal((await checkPhoneAvailable(env, "u2", PHONE, gone)).ok, true);
  assert.equal((await bindPhone(env, "u2", PHONE, gone)).ok, true);
});

test("release: an owner who moved to a different number no longer holds the old one", async () => {
  const { env } = world();
  await bindPhone(env, "u1", PHONE, alive);
  await markPhoneVerified(env, "u1", PHONE);
  // u1 verifies a new number: markPhoneVerified drops the old index entry.
  await bindPhone(env, "u1", "919812345678", alive);
  await markPhoneVerified(env, "u1", "919812345678");
  assert.equal(await env.MAIK_KV.get(await phoneIndexKey(PHONE), "json"), null, "old entry removed");
  assert.equal((await checkPhoneAvailable(env, "u2", PHONE, alive)).ok, true);
  // And a stale entry (release failed) is still treated as free because the owner's record moved on.
  await env.MAIK_KV.put(await phoneIndexKey(PHONE), JSON.stringify({ uid: "u1", at: 1 }));
  assert.equal((await checkPhoneAvailable(env, "u2", PHONE, alive)).ok, true);
  // releasePhone only ever removes an entry that points at the caller.
  assert.equal(await releasePhone(env, "u2", "919812345678"), false);
  assert.equal((await env.MAIK_KV.get(await phoneIndexKey("919812345678"), "json")).uid, "u1");
});

test("bind reads back: a racing writer that lands last wins, and the loser is told phone-in-use", async () => {
  const { kv, env } = world();
  const racy = Object.assign({}, kv, {
    async put(k, v) { await kv.put(k, v); if (k.indexOf("phoneidx:") === 0) await kv.put(k, JSON.stringify({ uid: "u-other", at: 2 })); },
    get: kv.get, delete: kv.delete,
  });
  const r = await bindPhone(env, "u1", PHONE, Object.assign({ kv: racy }, alive));
  assert.deepEqual(r, { ok: false, error: "phone-in-use" });
});

/* ── through the OTP flow ─────────────────────────────────────────────────────────────────────── */
function otpDeps(env, uid, store) {
  const sent = [];
  return {
    sent,
    start: { store, defaultCc: "91", checkOwner: (p) => checkPhoneAvailable(env, uid, p, alive), deliver: async (phone, code) => { sent.push({ phone, code }); return { ok: true, channel: "whatsapp" }; } },
    verify: (onVerified) => ({ store, bind: (p) => bindPhone(env, uid, p, alive), onVerified }),
  };
}

test("phone-start refuses phone-in-use BEFORE any code is generated, stored, counted or sent", async () => {
  const { kv, env } = world();
  const a = otpDeps(env, "u1", kv);
  await phoneStart({ uid: "u1" }, { phone: "98765 43210" }, a.start);
  await phoneVerify({ uid: "u1" }, { code: a.sent[0].code }, a.verify(async (p) => { await markPhoneVerified(env, "u1", p); }));
  const capBefore = await kv.get(await capKey(PHONE));
  const b = otpDeps(env, "u2", kv);
  const r = await phoneStart({ uid: "u2" }, { phone: "+91 98765 43210" }, b.start);
  assert.equal(r.ok, false); assert.equal(r.error, "phone-in-use"); assert.equal(r.status, 409);
  assert.equal(b.sent.length, 0, "no OTP sent");
  assert.equal(await kv.get(otpKey("u2")), null, "no OTP stored");
  assert.equal(await kv.get(await capKey(PHONE)), capBefore, "the daily cap is not spent on a refusal");
});

test("phone-verify re-checks: a number taken since phone-start is refused and onVerified never runs", async () => {
  const { kv, env } = world();
  const b = otpDeps(env, "u2", kv);
  await phoneStart({ uid: "u2" }, { phone: "9876543210" }, b.start);   // free at start
  await bindPhone(env, "u1", PHONE, alive);                             // u1 wins the race meanwhile
  let called = false;
  const r = await phoneVerify({ uid: "u2" }, { code: b.sent[0].code }, b.verify(async () => { called = true; }));
  assert.deepEqual(r, { ok: false, error: "phone-in-use", status: 409 });
  assert.equal(called, false, "no phoneVerified claim for the loser");
});

test("a KV failure in the index fails closed with store-failed, not a silent verify", async () => {
  const store = memKV();
  const r = await phoneStart({ uid: "u1" }, { phone: "9876543210" }, { store, deliver: async () => ({ ok: true, channel: "sms" }), checkOwner: async () => { throw new Error("kv down"); } });
  assert.equal(r.error, "store-failed"); assert.equal(r.status, 500);
});

test("no raw number in ANY KV key after a full start -> verify -> bind -> refuse cycle", async () => {
  const { kv, env } = world();
  const a = otpDeps(env, "u1", kv);
  await phoneStart({ uid: "u1" }, { phone: "9876543210" }, a.start);
  await phoneVerify({ uid: "u1" }, { code: a.sent[0].code }, a.verify(async (p) => { await markPhoneVerified(env, "u1", p); }));
  await phoneStart({ uid: "u2" }, { phone: "9876543210" }, otpDeps(env, "u2", kv).start);
  const keys = [...kv._m.keys()];
  assert.ok(keys.some((k) => k.indexOf("phoneidx:") === 0), "the index was written");
  for (const k of keys) assert.equal(k.indexOf("9876543210"), -1, "raw number in key " + k);
  assert.equal((await getLifecycle(env, "u1")).phone, PHONE, "the number lives in the lifecycle VALUE (support can see it)");
});

test("the auth route wires checkOwner at phone-start and bind at phone-verify, and clears the budget cache", () => {
  const src = readFileSync(new URL("../functions/api/auth/[[path]].js", import.meta.url), "utf8");
  assert.match(src, /checkOwner: function \(phone\) \{ return checkPhoneAvailable\(env, who\.uid, phone\); \}/);
  assert.match(src, /bind: function \(phone\) \{ return bindPhone\(env, who\.uid, phone\); \}/);
  assert.match(src, /clearBudgetCache\(env, who\.uid\)/);
});

test("the client says phone-in-use in a plain sentence, no em-dash", () => {
  const src = readFileSync(new URL("../phone-verify.js", import.meta.url), "utf8");
  const m = src.match(/"phone-in-use": "([^"]+)"/);
  assert.ok(m, "phone-verify.js has copy for phone-in-use");
  assert.equal(m[1], "This number is already verified on another StewardMD account. Use a different number, or sign in to that account.");
  assert.equal(m[1].indexOf("—"), -1);
});
