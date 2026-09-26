/* test/trial-ledger.test.mjs - the free Pro week is once per DOCTOR, not once per account.
 *
 * Owner request 2026-09-26: "7 days free trial is one time and once per number verification ...
 * same device id no second trial ... old signout account already pro new sign in again creating pro
 * trial dont activate." Plan: vault/plans/One-Time-Trial.md. Module: functions/_trial_ledger.js.
 *
 * node --test test/trial-ledger.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  trialOnceMode, normReg, normPhone, normDevice, ipBucket, fingerprints, checkTrial, consumeTrial,
  gateTrial, weekPatch, firstGrantAt, phoneTrialPatch, backfillLedger, requestSignals,
} from "../functions/_trial_ledger.js";
import { accessState, entitlementState, isPro } from "../functions/_entitlement.js";
import { reconcileVerifiedClaim } from "../functions/_verify_claim.js";

const PEPPER = "test-pepper";
const DAY = 86400000;
function memKV(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    _m: m,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix, cursor }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const envOn = (store) => ({ TRIAL_ONCE_ON: "1", TRIAL_PEPPER: PEPPER, CASES_KV: store });
const envShadow = (store) => ({ TRIAL_ONCE_ON: "shadow", TRIAL_PEPPER: PEPPER, CASES_KV: store });
const envOff = (store) => ({ TRIAL_PEPPER: PEPPER, CASES_KV: store });

test("mode: off by default; 1/on enforce; shadow logs; anything else off", () => {
  assert.equal(trialOnceMode({}), "off");
  assert.equal(trialOnceMode({ TRIAL_ONCE_ON: "1" }), "on");
  assert.equal(trialOnceMode({ TRIAL_ONCE_ON: "shadow" }), "shadow");
  assert.equal(trialOnceMode({ TRIAL_ONCE_ON: "0" }), "off");
});

test("normalisers: two spellings of one thing are one fingerprint", async () => {
  assert.equal(normReg("apmc/fmr/112487"), normReg("APMC FMR 112487"));
  assert.equal(normPhone("+91 98765 43210"), "919876543210"); assert.equal(normPhone("98765 43210"), "919876543210");
  assert.equal(normPhone("123"), "");
  assert.deepEqual(normDevice("hw-abcdef123"), { kind: "hw", v: "abcdef123" });
  assert.deepEqual(normDevice("dev-0f0f0f0f"), { kind: "ls", v: "0f0f0f0f" });
  assert.equal(normDevice("junk"), null);
  assert.equal(ipBucket("203.0.113.77"), "203.0.113.0/24");
  assert.equal(ipBucket("2001:db8:abcd:12:1::5"), "2001:db8:abcd:12::/64");
  assert.equal(ipBucket(""), "");
  const a = await fingerprints(PEPPER, { regNo: "apmc/fmr/112487" });
  const b = await fingerprints(PEPPER, { regNo: "APMC-FMR-112487" });
  assert.equal(a[0].key, b[0].key);
});

test("fingerprints are peppered hashes: no raw phone / reg / device in the ledger; no pepper = none", async () => {
  const f = await fingerprints(PEPPER, { regNo: "112487", phone: "9876543210", device: "hw-abc123def", ip: "10.1.2.3" });
  assert.deepEqual(f.map((x) => x.kind), ["reg", "phone", "hw", "ip"]);
  const all = JSON.stringify(f);
  for (const raw of ["112487", "9876543210", "abc123def", "10.1.2"]) assert.equal(all.includes(raw), false, raw + " leaked");
  const other = await fingerprints("another-pepper", { phone: "9876543210" });
  assert.notEqual(other[0].key, f[1].key, "the pepper changes the hash");
  assert.deepEqual(await fingerprints("", { phone: "9876543210" }), []);
});

test("THE ASK: a second account on the same phone number / reg / device gets no week; the same account always does", async () => {
  for (const [kind, input] of [["phone", { phone: "9876543210" }], ["reg", { regNo: "KMC 55555" }], ["hw", { device: "hw-androidid42" }]]) {
    const store = memKV(); const env = envOn(store);
    assert.equal((await gateTrial(env, "old", input, { door: "verify" })).grant, true, kind + ": first account gets the week");
    const again = await gateTrial(env, "old", input, { door: "verify" });
    assert.equal(again.grant, true, kind + ": same account (reinstall, sign in again) is never denied");
    const second = await gateTrial(env, "new", input, { door: "verify" });
    assert.equal(second.grant, false, kind + ": the new account is denied"); assert.equal(second.hit, kind);
  }
});

test("soft signals never deny: the localStorage id (lost on reinstall) and the IP (hospital wifi)", async () => {
  const store = memKV(); const env = envOn(store);
  await gateTrial(env, "a", { device: "dev-0123456789", ip: "203.0.113.5" }, { door: "verify" });
  const b = await gateTrial(env, "b", { device: "dev-0123456789", ip: "203.0.113.9" }, { door: "verify" });
  assert.equal(b.grant, true, "a whole ward on one wifi can each have their week");
  const ipRow = [...store._m.entries()].find(([k]) => k.startsWith("trial:ip:"));
  assert.deepEqual(JSON.parse(ipRow[1]).uids, ["a", "b"], "but the IP is counted for review");
});

test("shadow: never denies, records, reports the would-be denial", async () => {
  const store = memKV(); const env = envShadow(store);
  await gateTrial(env, "a", { phone: "9876543210" }, { door: "verify" });
  const b = await gateTrial(env, "b", { phone: "9876543210" }, { door: "verify" });
  assert.equal(b.grant, true); assert.equal(b.wouldDeny, "phone");
});

test("off: touches nothing, grants everything (today's behaviour exactly)", async () => {
  const store = memKV(); const env = envOff(store);
  await gateTrial(env, "a", { phone: "9876543210" }, {});
  assert.equal((await gateTrial(env, "b", { phone: "9876543210" }, {})).grant, true);
  assert.equal(store._m.size, 0);
});

test("a TYPED reg number is checked but never recorded (nobody can poison the real doctor's number)", async () => {
  const store = memKV(); const env = envOn(store);
  await gateTrial(env, "imposter", { regNo: "KMC 55555" }, { door: "pending", noConsume: ["reg"] });
  assert.equal((await gateTrial(env, "real-doctor", { regNo: "KMC 55555" }, { door: "verify" })).grant, true);
});

test("a row owned by another account is never taken over", async () => {
  const store = memKV();
  const f = await fingerprints(PEPPER, { phone: "9876543210" });
  await consumeTrial(store, "a", f, "verify");
  await consumeTrial(store, "b", f, "verify");
  assert.equal(JSON.parse(store._m.get(f[0].key)).uid, "a");
  assert.equal((await checkTrial(store, "b", f)).hit, "phone");
});

test("weekPatch: first week, never restarted, denied for a duplicate", async () => {
  const store = memKV(); const env = envOn(store);
  const p1 = await weekPatch(env, "a", {}, { regNo: "R1", phone: "9876543210" }, { door: "verify" });
  assert.ok(p1.verifiedAt);
  assert.deepEqual(await weekPatch(env, "a", { verifiedAt: 5 }, { regNo: "R1" }, {}), {}, "an existing verifiedAt is kept");
  // reject -> re-approve: the claim lost verifiedAt, the week restarts from the FIRST grant, not now.
  const first = await firstGrantAt(store, "a");
  store._m.set("trial:uid:a", JSON.stringify({ at: first - 3 * DAY }));
  const p2 = await weekPatch(env, "a", {}, { regNo: "R1" }, { door: "approve" });
  assert.equal(p2.verifiedAt, first - 3 * DAY);
  const dup = await weekPatch(env, "b", {}, { regNo: "R2", phone: "9876543210" }, { door: "verify" });
  assert.ok(dup.trialDenied); assert.equal(dup.verifiedAt, undefined); assert.equal(dup.provUntil, null);
  assert.deepEqual(await weekPatch(env, "b", { trialDenied: 1 }, {}, {}), {}, "stays denied");
});

test("phone verified AFTER the week: records it, ends a duplicate week, never touches paid or no-week accounts", async () => {
  const store = memKV(); const env = envOn(store);
  const now = Date.now();
  // Account without a week: nothing recorded (it must not 'own' the number).
  assert.deepEqual(await phoneTrialPatch(env, "free", "9876543210", {}, null), {});
  assert.equal([...store._m.keys()].some((k) => k.startsWith("trial:used:phone:")), false);
  // Account A holds a week and verifies its phone: recorded.
  assert.deepEqual(await phoneTrialPatch(env, "a", "9876543210", { verifiedAt: now }, null), {});
  // Account B, in its week, verifies the same number: week ends.
  const p = await phoneTrialPatch(env, "b", "9876543210", { verifiedAt: now }, null);
  assert.ok(p.trialDenied); assert.equal(p.provUntil, null);
  // Paid, or the owner: untouched.
  assert.deepEqual(await phoneTrialPatch(env, "c", "9876543210", { verifiedAt: now, pro: true, proExp: now + DAY }, null), {});
  assert.deepEqual(await phoneTrialPatch(env, "d", "9876543210", { verifiedAt: now }, null, { owner: true }), {});
});

test("backfill seeds every registered doctor and their verified phone; free-plan phones are not seeded", async () => {
  const store = memKV({ "icu:reg:KMC_1": "a", "icu:reg:KMC_2": "b" });
  const lc = memKV({
    "lifecycle:u:a": JSON.stringify({ phone: "919876543210", phoneVerifiedAt: 1 }),
    "lifecycle:u:free": JSON.stringify({ phone: "919123456789", phoneVerifiedAt: 1 }),
  });
  const r = await backfillLedger(envOn(store), { store, lifecycleStore: lc });
  assert.deepEqual(r, { ok: true, reg: 2, phone: 1 });
  const env = envOn(store);
  assert.equal((await gateTrial(env, "new", { regNo: "KMC 1" }, {})).grant, false);
  assert.equal((await gateTrial(env, "new2", { phone: "9876543210" }, {})).grant, false);
  assert.equal((await gateTrial(env, "new3", { phone: "9123456789" }, {})).grant, true);
  assert.equal((await backfillLedger({ CASES_KV: store }, { store })).error, "no-pepper");
});

test("requestSignals reads CF-Connecting-IP only (X-Forwarded-For is client-supplied)", () => {
  const h = new Map([["X-SMD-HW", "hw-x1234567"], ["X-Forwarded-For", "1.2.3.4"]]);
  const r = requestSignals({ headers: { get: (k) => h.get(k) || null } });
  assert.equal(r.device, "hw-x1234567"); assert.equal(r.ip, "");
});

/* ── entitlement ─────────────────────────────────────────────────────────────────────────────── */
const ON = { TRIAL_ONCE_ON: "1" };
test("entitlement: verified + trialDenied = verified, NOT Pro, reason trial-used", () => {
  const now = Date.now();
  const c = { verified: true, trialDenied: now - 1000 };
  assert.equal(isPro(ON, c, now), false);
  const a = accessState(ON, c, now);
  assert.equal(a.verified, true); assert.equal(a.freeProActive, false);
  const e = entitlementState(ON, c, now);
  assert.equal(e.pro, false); assert.equal(e.reason, "trial-used"); assert.equal(e.verified, true);
});

test("reversible: with TRIAL_ONCE_ON off (or shadow) a trialDenied claim is ignored, the week comes back", () => {
  const now = Date.now();
  const c = { verified: true, verifiedAt: now - 1000, trialDenied: now - 1000 };
  assert.equal(isPro({}, c, now), true);
  assert.equal(isPro({ TRIAL_ONCE_ON: "shadow" }, c, now), true);
  assert.equal(isPro({}, { provUntil: now + DAY, trialDenied: now }, now), true);
});

test("shadow: weekPatch writes what it always did (fresh verifiedAt) while recording", async () => {
  const store = memKV(); const env = envShadow(store);
  const p = await weekPatch(env, "a", { verifiedAt: 5 }, { phone: "9876543210" }, {});
  assert.ok(p.verifiedAt > 5, "re-verification re-stamps exactly as before");
  assert.equal([...store._m.keys()].some((k) => k.startsWith("trial:used:phone:")), true);
  assert.ok((await weekPatch(envOff(memKV()), "a", { verifiedAt: 5 }, {}, {})).verifiedAt > 5);
});

test("entitlement: a denied pending account gets no pending access; a paid claim and an owner still win", () => {
  const now = Date.now();
  assert.equal(isPro(ON, { provUntil: now + DAY, trialDenied: now }, now), false);
  assert.equal(isPro(ON, { verified: true, trialDenied: now, pro: true, proExp: now + DAY }, now), true);
  assert.equal(isPro({ ...ON, OWNER_EMAILS: "o@x.in" }, { verified: true, trialDenied: now, email: "o@x.in" }, now), true);
  assert.equal(isPro(ON, { verified: true, verifiedAt: now - DAY }, now), true, "normal verified week unchanged");
});

test("reconcile never hands a denied account the week it was refused", async () => {
  const wrote = [];
  await reconcileVerifiedClaim(ON, "u1", {
    kv: { get: async () => ({ status: "verified", regNo: "R" }) },
    getUserClaims: async () => ({ verified: true, trialDenied: 1 }),
    mergeUserClaims: async (e, u, p) => wrote.push(p),
  });
  assert.equal(wrote.length, 0);
});

/* ── wiring ──────────────────────────────────────────────────────────────────────────────────── */
test("every Pro door asks the ledger; the free-plan skip does not", () => {
  const vd = readFileSync(new URL("../functions/api/verify-doctor.js", import.meta.url), "utf8");
  assert.match(vd, /weekPatch\(env, uid, claims/, "auto-verify");
  assert.match(vd, /door: "pending", noConsume: \["reg"\]/, "pending review, typed reg not recorded");
  assert.match(vd, /owner && owner !== uid\) pendingOk = false/, "no pending access on a reg another account holds");
  const skip = vd.slice(vd.indexOf("if (body.trial === true)"), vd.indexOf("if (!imageB64)"));
  assert.equal(/gateTrial/.test(skip), false, "Skip for now is the FREE plan, not a Pro door");
  const ap = readFileSync(new URL("../functions/api/verifications/[[path]].js", import.meta.url), "utf8");
  assert.match(ap, /door: "approve"/); assert.match(ap, /RegClaimedError/); assert.match(ap, /trial-backfill/);
  const au = readFileSync(new URL("../functions/api/auth/[[path]].js", import.meta.url), "utf8");
  assert.match(au, /phoneTrialPatch\(env, who\.uid, phone/);
});

test("client: device header on verify + phone calls; paywall copy for trial-used; no em-dash in new copy", () => {
  const v = readFileSync(new URL("../verify.js", import.meta.url), "utf8");
  assert.match(v, /hwHeaders\(\)/);
  const pv = readFileSync(new URL("../phone-verify.js", import.meta.url), "utf8");
  assert.match(pv, /SMD_DEVICE\.hwHeaders/);
  const dv = readFileSync(new URL("../device-id.js", import.meta.url), "utf8");
  assert.match(dv, /"X-SMD-HW"/);
  const pn = readFileSync(new URL("../pro-notice.js", import.meta.url), "utf8");
  const used = pn.slice(pn.indexOf('if (r === "used")'), pn.indexOf('if (r === "expired")'));
  assert.match(used, /act: "paywall"/); assert.equal(used.includes("\u2014"), false);
});
