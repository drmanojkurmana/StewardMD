/* test/verify-claim-reconcile.test.mjs — the verification split-brain.
 *
 * REPORTED WITH A SCREEN RECORDING, 2026-08-27: the verification panel showed
 * "Your account is verified ✓" while, at the same moment and for the same account, every Pro
 * feature showed "This feature needs a verified registration".
 *
 * Both were reading honestly, from different stores:
 *   GET /api/verify-doctor  -> the KV doctor record  icu:doctor:<uid>
 *   every entitlement gate  -> the Firebase claim    verified / verifiedAt
 * Nothing reconciled them, so once they drifted the disagreement was permanent.
 *
 * The claim is authoritative (it is what the gates read, it is signed, a client cannot forge it),
 * so healing runs in ONE direction: a record that says verified re-asserts the claim, never the
 * reverse. These tests exist mostly to pin that direction.
 *
 * node --test test/verify-claim-reconcile.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileVerifiedClaim } from "../functions/_verify_claim.js";

const UID = "u1";
const KEY = "icu:doctor:" + UID;

function deps(record, claims) {
  const wrote = [];
  return {
    wrote,
    kv: { get: async (k) => (k === KEY ? record : null) },
    getUserClaims: async () => claims,
    mergeUserClaims: async (env, uid, patch) => { wrote.push({ uid, patch }); },
  };
}
const ENV = {};

test("THE REPORTED CASE: record says verified, claim says nothing -> the claim is written", async () => {
  const d = deps({ status: "verified", regNo: "APMC/112487" }, {});
  const r = await reconcileVerifiedClaim(ENV, UID, d);
  assert.equal(r.healed, true);
  assert.equal(d.wrote.length, 1);
  assert.equal(d.wrote[0].patch.verified, true);
  assert.equal(d.wrote[0].patch.regNo, "APMC/112487", "the registration number comes along");
  assert.ok(d.wrote[0].patch.verifiedAt > 0, "verifiedAt must be set, or the free week is zero-length");
});

test("verified claim but NO verifiedAt is also healed", async () => {
  // Same visible symptom by a different route: accessState() computes a zero-length free week, so
  // the doctor is 'verified' and still holds no entitlement.
  const d = deps({ status: "verified" }, { verified: true });
  const r = await reconcileVerifiedClaim(ENV, UID, d);
  assert.equal(r.healed, true);
  assert.ok(d.wrote[0].patch.verifiedAt > 0);
});

test("an already-consistent account is left completely alone", async () => {
  const d = deps({ status: "verified" }, { verified: true, verifiedAt: 1756000000000 });
  const r = await reconcileVerifiedClaim(ENV, UID, d);
  assert.equal(r.healed, false);
  assert.equal(d.wrote.length, 0, "no claim write, so no pointless token churn");
});

test("healing is ONE-WAY: a non-verified record never grants the claim", async () => {
  for (const status of ["pending", "trial", "rejected", "unverified"]) {
    const d = deps({ status }, {});
    const r = await reconcileVerifiedClaim(ENV, UID, d);
    assert.equal(r.healed, false, `${status} must not grant a verified claim`);
    assert.equal(d.wrote.length, 0);
  }
});

test("a record that only carries the legacy verified:true flag still counts", async () => {
  const d = deps({ verified: true, regNo: "MH1" }, {});
  assert.equal((await reconcileVerifiedClaim(ENV, UID, d)).healed, true);
});

test("no record, no KV, no uid: never throws, never writes", async () => {
  const none = deps(null, {});
  assert.equal((await reconcileVerifiedClaim(ENV, UID, none)).healed, false);
  assert.equal(none.wrote.length, 0);

  assert.equal((await reconcileVerifiedClaim(ENV, "", deps({ status: "verified" }, {}))).healed, false);
  assert.equal((await reconcileVerifiedClaim(ENV, UID, { kv: null })).healed, false);
});

test("it is best-effort — a failing store or claim write cannot break the caller's read", async () => {
  const boom = {
    kv: { get: async () => { throw new Error("kv down"); } },
    getUserClaims: async () => ({}),
    mergeUserClaims: async () => {},
  };
  assert.equal((await reconcileVerifiedClaim(ENV, UID, boom)).healed, false);

  const writeFails = {
    kv: { get: async () => ({ status: "verified" }) },
    getUserClaims: async () => ({}),
    mergeUserClaims: async () => { throw new Error("claims down"); },
  };
  assert.equal((await reconcileVerifiedClaim(ENV, UID, writeFails)).healed, false,
    "a failed write reports not-healed rather than claiming success");
});

test("it reports the status it saw, so a caller can bust caches only when something changed", async () => {
  const d = deps({ status: "verified", regNo: "R9" }, {});
  const r = await reconcileVerifiedClaim(ENV, UID, d);
  assert.equal(r.status, "verified");
  assert.equal(r.regNo, "R9");
});
