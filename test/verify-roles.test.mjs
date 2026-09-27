/* test/verify-roles.test.mjs — verification ROLE end to end (audit 2026-09-26, vault/Role-Tiers.md
 * section 6, findings 3 and 4).
 *
 * Finding 3: owner approval wrote verified:true for every role, and the Rx pad gates on verified, so
 * an approved medical STUDENT or INTERN could prescribe. Now: doctor/resident -> verified (may
 * prescribe); intern/student -> traineeVerified (a reviewed account that never prescribes).
 * Finding 4: the verification role never reached entitlements/{uid}.role. Now both the auto-verify
 * path and owner approval write it (best-effort).
 *
 * Everything runs offline on injected deps: no Firebase, no Firestore, no KV, no email.
 * node --test test/verify-roles.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accessState, isPro, entitlementState, mayPrescribe, isReviewedAccount,
  normalizeVerifyRole, isTraineeVerifyRole, entitlementRoleFor, recordVerifiedRole,
} from "../functions/_entitlement.js";
import { decidePurge } from "../functions/_lifecycle.js";
import { reconcileVerifiedClaim } from "../functions/_verify_claim.js";
import { completeAutoVerify, decideTrial } from "../functions/api/verify-doctor.js";
import { doApprove, listLegacyTraineeVerified } from "../functions/api/verifications/[[path]].js";
import { mergeClaims } from "../functions/_fbadmin.js";

const DAY = 86400000;
const now = Date.parse("2026-09-26T10:00:00Z");

// ---- fakes ---------------------------------------------------------------------------------------
function memKV(seed) {
  const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    m,
    async get(k, type) { const v = m.has(k) ? m.get(k) : null; if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
// Records every side effect so each test can assert exactly what happened.
function fakeDeps(opts) {
  opts = opts || {};
  const calls = { claims: {}, merges: [], ent: [], entRec: opts.entRec || null, emails: [], marked: 0, upsell: 0, budget: 0 };
  return {
    calls,
    mergeUserClaims: async (env, uid, patch) => {
      if (opts.claimFails) throw new Error("claims down");
      calls.merges.push(patch); calls.claims = mergeClaims(calls.claims, patch); return calls.claims;
    },
    getEntitlement: async () => { if (opts.entReadFails) throw new Error("fs down"); return calls.entRec; },
    writeEntitlement: async (env, uid, patch) => {
      if (opts.entWriteFails) throw new Error("fs down");
      calls.ent.push(patch); calls.entRec = Object.assign({}, calls.entRec || {}, patch); return patch;
    },
    emailVerified: async (env, a) => { calls.emails.push(a); },
    markVerified: async () => { calls.marked++; },
    sendProUpsellOnce: async () => { calls.upsell++; },
    clearBudgetCache: async () => { calls.budget++; },
  };
}
const UID = "u1";
const DKEY = "icu:doctor:" + UID;
const pendingRec = (role, extra) => ({ uid: UID, email: "a@x.in", status: "pending", role, extractedRegNo: "COLL-4471", ...(extra || {}) });

// ---- pure helpers ---------------------------------------------------------------------------------
test("verification roles: four, normalised, doctor by default", () => {
  assert.equal(normalizeVerifyRole("Resident"), "resident");
  assert.equal(normalizeVerifyRole("student"), "student");
  assert.equal(normalizeVerifyRole(""), "doctor");
  assert.equal(normalizeVerifyRole("dean"), "doctor", "unknown roles are the historical default");
  assert.equal(isTraineeVerifyRole("intern"), true);
  assert.equal(isTraineeVerifyRole("student"), true);
  assert.equal(isTraineeVerifyRole("resident"), false, "residents hold full registration");
  assert.equal(isTraineeVerifyRole("doctor"), false);
});

test("verification role -> entitlements role mapping", () => {
  assert.equal(entitlementRoleFor("doctor"), "physician");
  assert.equal(entitlementRoleFor("resident"), "resident");
  assert.equal(entitlementRoleFor("intern"), "intern");
  assert.equal(entitlementRoleFor("student"), "student");
});

test("mayPrescribe is the verified claim only; isReviewedAccount also accepts a trainee", () => {
  assert.equal(mayPrescribe({ verified: true }), true);
  assert.equal(mayPrescribe({ traineeVerified: true }), false);
  assert.equal(mayPrescribe(null), false);
  assert.equal(isReviewedAccount({ traineeVerified: true }), true);
  assert.equal(isReviewedAccount({ verified: true }), true);
  assert.equal(isReviewedAccount({ provUntil: now + DAY }), false, "pending review is not reviewed");
});

// ---- recordVerifiedRole ---------------------------------------------------------------------------
test("recordVerifiedRole writes the mapped role to entitlements", async () => {
  const d = fakeDeps();
  const r = await recordVerifiedRole({}, UID, "doctor", d);
  assert.deepEqual([r.ok, r.role], [true, "physician"]);
  assert.equal(d.calls.ent.length, 1);
  assert.equal(d.calls.ent[0].role, "physician");
});

test("recordVerifiedRole keeps an admin-set upgrade of the same person", async () => {
  const d = fakeDeps({ entRec: { role: "physician_pro" } });
  const r = await recordVerifiedRole({}, UID, "doctor", d);
  assert.equal(r.skipped, "same-family");
  assert.equal(d.calls.ent.length, 0, "physician_pro is not downgraded to physician");
  const d2 = fakeDeps({ entRec: { role: "co_resident" } });
  await recordVerifiedRole({}, UID, "resident", d2);
  assert.equal(d2.calls.ent.length, 0, "co_resident is not downgraded to resident");
  const d3 = fakeDeps({ entRec: { role: "intern" } });
  await recordVerifiedRole({}, UID, "resident", d3);
  assert.equal(d3.calls.entRec.role, "resident", "an intern who became a resident is promoted");
});

test("recordVerifiedRole is best-effort: a Firestore failure never throws", async () => {
  const r = await recordVerifiedRole({}, UID, "student", fakeDeps({ entWriteFails: true }));
  assert.deepEqual([r.ok, r.error], [false, "write-failed"]);
  const d = fakeDeps({ entReadFails: true });
  const r2 = await recordVerifiedRole({}, UID, "intern", d);
  assert.equal(r2.ok, true, "an unreadable record is still written");
  assert.equal(d.calls.entRec.role, "intern");
});

// ---- owner approval, by role -----------------------------------------------------------------------
for (const [role, entRole] of [["doctor", "physician"], ["resident", "resident"]]) {
  test(`approve ${role}: verified claim (may prescribe), reg index, role ${entRole}, verified email`, async () => {
    const kv = memKV({ [DKEY]: pendingRec(role, { extractedRegNo: "APMC/FMR/112487" }) });
    const d = fakeDeps();
    d.calls.claims = { provUntil: now + DAY, pro: true };
    const out = await doApprove(kv, {}, UID, "", d);
    assert.equal(d.calls.claims.verified, true);
    assert.equal(d.calls.claims.regNo, "APMC/FMR/112487");
    assert.ok(d.calls.claims.verifiedAt > 0, "verifiedAt starts the free week");
    assert.equal(d.calls.claims.provUntil, undefined, "provUntil cleared");
    assert.equal(d.calls.claims.traineeVerified, undefined);
    assert.equal(d.calls.claims.pro, true, "merge keeps the pro claim");
    assert.equal(mayPrescribe(d.calls.claims), true);
    assert.equal(out.status, "verified");
    assert.equal(out.role, role);
    assert.equal(await kv.get("icu:reg:APMC_FMR_112487"), UID, "registration index written");
    assert.equal(d.calls.entRec.role, entRole);
    assert.equal(d.calls.emails.length, 1, "the 'prescriptions unlocked' email is for doctors");
    assert.equal(d.calls.marked, 1);
    assert.equal(d.calls.budget, 1);
  });
}

for (const [role, entRole] of [["intern", "intern"], ["student", "student"]]) {
  test(`approve ${role}: traineeVerified, NOT verified, no regNo, role ${entRole}, no Rx email`, async () => {
    const kv = memKV({ [DKEY]: pendingRec(role) });
    const d = fakeDeps();
    d.calls.claims = { provUntil: now + DAY };
    const out = await doApprove(kv, {}, UID, "", d);
    assert.equal(d.calls.claims.verified, undefined, "the prescribing claim is not granted");
    assert.equal(d.calls.claims.traineeVerified, true);
    assert.ok(d.calls.claims.verifiedAt > 0, "verifiedAt set so the free week and trial logic work");
    assert.equal(d.calls.claims.provUntil, undefined, "provUntil cleared");
    assert.equal(d.calls.claims.regNo, undefined, "a college ID is not a registration number");
    assert.equal(mayPrescribe(d.calls.claims), false);
    assert.equal(isReviewedAccount(d.calls.claims), true);
    assert.equal(out.status, "trainee_verified");
    assert.equal(out.verified, false);
    assert.equal(out.regNo, "");
    assert.equal(await kv.get("icu:reg:COLL_4471"), null, "no registration index for a college ID");
    const stored = await kv.get(DKEY, "json");
    assert.equal(stored.status, "trainee_verified");
    assert.equal(stored.role, role);
    assert.equal(d.calls.entRec.role, entRole);
    assert.equal(d.calls.emails.length, 0, "no 'prescriptions unlocked' email to a trainee");
    assert.equal(d.calls.marked, 1, "lifecycle marked verified: the sweep spares them");
  });
}

test("approve a trainee who holds a legacy verified:true claim withdraws it", async () => {
  const kv = memKV({ [DKEY]: pendingRec("student", { status: "verified", verified: true }) });
  const d = fakeDeps();
  d.calls.claims = { verified: true, regNo: "COLL-4471", verifiedAt: now - 30 * DAY };
  await doApprove(kv, {}, UID, "", d);
  assert.equal(d.calls.claims.verified, undefined);
  assert.equal(d.calls.claims.regNo, undefined);
  assert.equal(d.calls.claims.traineeVerified, true);
});

test("owner can correct the role on approval (a legacy 'Intern / Resident' who is a resident)", async () => {
  const kv = memKV({ [DKEY]: pendingRec("intern", { extractedRegNo: "TSMC/55821" }) });
  const d = fakeDeps();
  const out = await doApprove(kv, {}, UID, "", d, "resident");
  assert.equal(d.calls.claims.verified, true);
  assert.equal(out.role, "resident");
  assert.equal(d.calls.entRec.role, "resident");
});

test("a record with no role approves as a doctor (records from before the chooser)", async () => {
  const kv = memKV({ [DKEY]: { uid: UID, status: "pending", extractedRegNo: "12345" } });
  const d = fakeDeps();
  await doApprove(kv, {}, UID, "", d);
  assert.equal(d.calls.claims.verified, true);
  assert.equal(d.calls.entRec.role, "physician");
});

test("approval never fails because the entitlements write failed", async () => {
  const kv = memKV({ [DKEY]: pendingRec("student") });
  const d = fakeDeps({ entWriteFails: true });
  const out = await doApprove(kv, {}, UID, "", d);
  assert.equal(out.status, "trainee_verified");
  assert.equal(out.roleWrite.ok, false);
  assert.equal(d.calls.claims.traineeVerified, true);
});

// ---- auto-verify path (register matched) -------------------------------------------------------------
const MATCH = { registrationNo: "112487", firstName: "ANU RAO", smcName: "Andhra Pradesh Medical Council" };
for (const [role, entRole] of [["doctor", "physician"], ["resident", "resident"]]) {
  test(`auto-verify ${role}: verified claim, KV role, entitlements role ${entRole}`, async () => {
    const kv = memKV();
    const d = fakeDeps();
    d.calls.claims = { traineeVerified: true };   // an intern who now holds full registration
    const out = await completeAutoVerify({}, kv, { uid: UID, email: "a@x.in", role, match: MATCH, source: "nmc", effReg: "112487" }, d);
    assert.equal(out.status, "verified");
    assert.equal(out.role, role);
    assert.equal(d.calls.claims.verified, true);
    assert.equal(d.calls.claims.regNo, "112487");
    assert.equal(d.calls.claims.traineeVerified, undefined, "trainee claim cleared on full registration");
    const rec = await kv.get(DKEY, "json");
    assert.equal(rec.status, "verified");
    assert.equal(rec.role, role);
    assert.equal(await kv.get("icu:reg:112487"), UID);
    assert.equal(d.calls.entRec.role, entRole);
    assert.equal(d.calls.emails.length, 1);
    assert.equal(d.calls.budget, 1);
  });
}

test("auto-verify can never mint the prescribing claim for a student or intern", async () => {
  for (const role of ["student", "intern"]) {
    const d = fakeDeps();
    await assert.rejects(completeAutoVerify({}, memKV(), { uid: UID, role, match: MATCH }, d), /trainee_cannot_auto_verify/);
    assert.equal(d.calls.merges.length, 0);
  }
});

test("auto-verify: entitlements failure is swallowed, claim failure is not", async () => {
  const out = await completeAutoVerify({}, memKV(), { uid: UID, role: "doctor", match: MATCH }, fakeDeps({ entWriteFails: true }));
  assert.equal(out.status, "verified");
  assert.equal(out.roleWrite.ok, false);
  await assert.rejects(completeAutoVerify({}, memKV(), { uid: UID, role: "doctor", match: MATCH }, fakeDeps({ claimFails: true })));
});

// ---- access / free week ------------------------------------------------------------------------------
test("accessState: a trainee is allowed with the free week, but is not 'verified'", () => {
  const c = { traineeVerified: true, verifiedAt: now - 2 * DAY };
  const a = accessState({}, c, now);
  assert.equal(a.allowed, true);
  assert.equal(a.verified, false, "verified means registered doctor");
  assert.equal(a.trainee, true);
  assert.equal(a.reviewed, true);
  assert.equal(a.freeProActive, true);
  assert.equal(isPro({}, c, now), true, "Pro free inside the week");
  assert.equal(isPro({}, { traineeVerified: true, verifiedAt: now - 9 * DAY }, now), false, "then the free tier");
  assert.equal(isPro({}, { traineeVerified: true, verifiedAt: now - 9 * DAY, pro: true }, now), true, "a paying trainee keeps Pro");
  const st = entitlementState({}, { traineeVerified: true, verifiedAt: now - 9 * DAY }, now);
  assert.equal(st.reason, "verified-week-expired", "not told to verify again");
  assert.equal(st.traineeVerified, true);
  assert.equal(st.verified, false);
  assert.equal(accessState({}, { verified: true, verifiedAt: now }, now).reviewed, true);
  assert.equal(accessState({}, {}, now).allowed, false);
});

// ---- the unverified sweep ----------------------------------------------------------------------------
test("the unverified sweep spares a trainee", () => {
  const rec = { firstSeen: now - 20 * DAY, purgeWarnedAt: now - 10 * DAY };
  assert.equal(decidePurge({}, rec, {}, now).action, "purge", "control: an unverified account is due");
  const d = decidePurge({}, rec, { traineeVerified: true }, now);
  assert.deepEqual([d.action, d.reason], ["skip", "trainee-verified"]);
});

// ---- read paths that could re-grant the prescribing claim ------------------------------------------
test("reconcile never re-asserts verified:true from a student or intern record", async () => {
  for (const role of ["student", "intern"]) {
    const wrote = [];
    const r = await reconcileVerifiedClaim({}, UID, {
      kv: { get: async () => ({ status: "verified", verified: true, role, regNo: "COLL-1" }) },
      getUserClaims: async () => ({ traineeVerified: true }),
      mergeUserClaims: async (e, u, p) => { wrote.push(p); },
    });
    assert.equal(r.healed, false);
    assert.equal(wrote.length, 0);
  }
  // control: a doctor record still heals
  const wrote = [];
  const r = await reconcileVerifiedClaim({}, UID, {
    kv: { get: async () => ({ status: "verified", role: "doctor", regNo: "112487" }) },
    getUserClaims: async () => ({}), mergeUserClaims: async (e, u, p) => { wrote.push(p); },
  });
  assert.equal(r.healed, true);
  // and trainee_verified never heals
  const r2 = await reconcileVerifiedClaim({}, UID, {
    kv: { get: async () => ({ status: "trainee_verified", role: "student" }) },
    getUserClaims: async () => ({}), mergeUserClaims: async () => { throw new Error("must not write"); },
  });
  assert.equal(r2.healed, false);
});

test("the skip-trial endpoint lets a reviewed trainee straight through", () => {
  const r = decideTrial({ status: "trainee_verified", role: "intern" }, now, 7);
  assert.equal(r.status, "verified", "older clients read this as 'dismiss the gate'");
  assert.equal(r.trainee, true);
  assert.equal(r.grant, undefined);
});

// ---- owner dry-run listing of legacy approvals -----------------------------------------------------
test("legacy-trainees lists student/intern records holding 'verified', and writes nothing", async () => {
  const kv = memKV({
    "icu:doctor:a": { uid: "a", role: "student", status: "verified", verified: true, email: "a@x", verifiedAt: "2026-09-01" },
    "icu:doctor:b": { uid: "b", role: "intern", status: "verified", verified: true, email: "b@x", verifiedAt: "2026-09-10" },
    "icu:doctor:c": { uid: "c", role: "doctor", status: "verified", verified: true },
    "icu:doctor:d": { uid: "d", role: "student", status: "pending" },
    "icu:doctor:e": { uid: "e", role: "intern", status: "trainee_verified", traineeVerified: true },
    "icu:doctor:f": { uid: "f", status: "verified", verified: true },
  });
  const before = JSON.stringify([...kv.m]);
  const items = await listLegacyTraineeVerified(kv);
  assert.deepEqual(items.map((i) => i.uid), ["b", "a"], "newest first; doctors, pending and new trainees excluded");
  assert.equal(items[0].role, "intern");
  assert.equal(JSON.stringify([...kv.m]), before, "dry run: KV unchanged");
});
