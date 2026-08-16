/* test/coupons.test.mjs — institution coupon codes: create / verdict / redeem / revoke.
 * Fake KV (Map) + fake grant/revoke/getUserClaims injected via deps — no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoupon, redeemCoupon, revokeCoupon, couponVerdict, listCoupons, normCode } from "../functions/_coupons.js";

function fakeKv() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
function harness(claimsByUid = {}) {
  const grants = [], revokes = [];
  const claims = Object.assign({}, claimsByUid);
  return {
    grants, revokes, claims,
    deps: {
      kv: fakeKv(),
      grantPro: async (env, uid, opts) => { grants.push({ uid, opts }); claims[uid] = { pro: true, source: opts.source }; return { ok: true, uid }; },
      revokePro: async (env, uid) => { revokes.push(uid); delete claims[uid]; return { ok: true }; },
      getUserClaims: async (env, uid) => claims[uid] || {},
    },
  };
}

test("couponVerdict: revoked / expired / exhausted / already", () => {
  const now = 1000;
  assert.equal(couponVerdict(null, "u", now).reason, "not-found");
  assert.equal(couponVerdict({ revoked: true }, "u", now).reason, "revoked");
  assert.equal(couponVerdict({ expiresAt: 500 }, "u", now).reason, "expired");
  assert.equal(couponVerdict({ maxRedemptions: 2, redeemedBy: ["a", "b"] }, "c", now).reason, "exhausted");
  assert.equal(couponVerdict({ redeemedBy: ["u"] }, "u", now).already, true);   // idempotent
  assert.equal(couponVerdict({ maxRedemptions: 2, redeemedBy: ["a"] }, "b", now).ok, true);
});

test("create defaults to 1 year of Pro; code normalized", async () => {
  const h = harness();
  const c = await createCoupon({}, { code: "gimsr-2026 " }, h.deps);
  assert.equal(c.code, "GIMSR2026");
  assert.equal(c.months, 12);            // default grant
  assert.equal(normCode(" a-b_c "), "ABC");
});

test("redeem grants Pro, records uid, is idempotent", async () => {
  const h = harness();
  await createCoupon({}, { code: "INST1", months: 6, maxRedemptions: 2 }, h.deps);
  const r1 = await redeemCoupon({}, "inst1", "uidA", h.deps);   // lowercase in → normalized
  assert.equal(r1.ok, true); assert.equal(h.grants.length, 1);
  assert.equal(h.grants[0].opts.months, 6);
  assert.equal(h.grants[0].opts.source, "coupon:INST1");
  const r2 = await redeemCoupon({}, "INST1", "uidA", h.deps);   // same user again
  assert.equal(r2.already, true);
  const stored = JSON.parse(h.deps.kv.m.get("coupon:INST1"));
  assert.deepEqual(stored.redeemedBy, ["uidA"]);                // not duplicated
});

test("maxRedemptions exhausts", async () => {
  const h = harness();
  await createCoupon({}, { code: "CAP1", maxRedemptions: 1 }, h.deps);
  assert.equal((await redeemCoupon({}, "CAP1", "u1", h.deps)).ok, true);
  assert.equal((await redeemCoupon({}, "CAP1", "u2", h.deps)).reason, "exhausted");
});

test("revoke pulls Pro from coupon redeemers but NOT from a doctor who since paid", async () => {
  const h = harness();
  await createCoupon({}, { code: "ORG", months: 12 }, h.deps);
  await redeemCoupon({}, "ORG", "docA", h.deps);
  await redeemCoupon({}, "ORG", "docB", h.deps);
  h.claims["docB"] = { pro: true, source: "razorpay" };   // docB later bought their own sub
  const r = await revokeCoupon({}, "ORG", h.deps);
  assert.equal(r.pulledPro, 1);                 // only docA
  assert.deepEqual(h.revokes, ["docA"]);
  assert.equal(JSON.parse(h.deps.kv.m.get("coupon:ORG")).revoked, true);
});

test("founding SKU: type founding, defaults 12mo + 500 seats, redeem flags founding", async () => {
  const h = harness();
  const c = await createCoupon({ FOUNDING_SEATS: "500" }, { type: "founding", code: "FOUND25" }, h.deps);
  assert.equal(c.type, "founding");
  assert.equal(c.months, 12);
  assert.equal(c.maxRedemptions, 500);
  const r = await redeemCoupon({}, "FOUND25", "docF", h.deps);
  assert.equal(r.ok, true); assert.equal(r.founding, true);
  assert.equal(h.grants[0].opts.months, 12);
});

test("listCoupons returns created coupons", async () => {
  const h = harness();
  await createCoupon({}, { code: "A1" }, h.deps);
  await createCoupon({}, { code: "B2" }, h.deps);
  const all = await listCoupons({}, h.deps);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((c) => c.code).sort(), ["A1", "B2"]);
});
