/* Purchase -> tier. WHY: fulfilPurchase() used to throw the plan away and grant a flat "pro", so a
 * ₹199 Trainee and a ₹2,499 Physician Pro bought identical access. These lock the mapping, the
 * expiry maths and the no-downgrade rule (buying Trainee on top of Physician Pro must not shrink). */
import assert from "node:assert";
import test from "node:test";
import { normalizeTier, tierFromPlanKey, effectiveTierFor, purchasePatch, recordTierPurchase } from "../functions/_entitlements.js";
import { fulfilPurchase, planKeyFromProductId } from "../functions/api/billing/[[path]].js";

const DAY = 86400000, NOW = 1750000000000;

test("normalizeTier", () => {
  assert.equal(normalizeTier("PhysicianPro"), "physicianpro");
  assert.equal(normalizeTier("physician_pro"), "physicianpro");
  assert.equal(normalizeTier("free"), "free");
  assert.equal(normalizeTier("wizard"), null);
  assert.equal(normalizeTier(null), null);
});

test("tierFromPlanKey maps the paywall keys", () => {
  assert.equal(tierFromPlanKey("student:monthly"), "trainee");
  assert.equal(tierFromPlanKey("student:annual"), "trainee");
  assert.equal(tierFromPlanKey("coresident:annual"), "coresident");
  assert.equal(tierFromPlanKey("pro:monthly"), "pro");
  assert.equal(tierFromPlanKey("physician:monthly"), "physician");
  assert.equal(tierFromPlanKey("physicianpro:annual"), "physicianpro");
  assert.equal(tierFromPlanKey("addon:onco"), null);
  assert.equal(tierFromPlanKey("tokens:plus"), null);
  assert.equal(tierFromPlanKey(""), null);
});

test("effectiveTierFor: expired -> free, null exp = forever", () => {
  assert.equal(effectiveTierFor({ tier: "pro", tierExp: NOW + DAY }, NOW), "pro");
  assert.equal(effectiveTierFor({ tier: "pro", tierExp: NOW - 1 }, NOW), "free");
  assert.equal(effectiveTierFor({ tier: "physician", tierExp: null }, NOW), "physician");
  assert.equal(effectiveTierFor({}, NOW), "free");
  assert.equal(effectiveTierFor(null, NOW), "free");
});

test("purchasePatch: fresh buy sets tier + 30d/month", () => {
  const p = purchasePatch(null, "student:monthly", { months: 1 }, NOW);
  assert.equal(p.tier, "trainee");
  assert.equal(p.tierExp, NOW + 30 * DAY);
  assert.equal(purchasePatch(null, "physician:annual", { months: 12 }, NOW).tierExp, NOW + 360 * DAY);
});

test("purchasePatch: renewal stacks on the unexpired remainder", () => {
  const rec = { tier: "pro", tierExp: NOW + 10 * DAY };
  assert.equal(purchasePatch(rec, "pro:monthly", { months: 1 }, NOW).tierExp, NOW + 40 * DAY);
});

test("purchasePatch: never downgrades or shrinks an active higher tier", () => {
  const rec = { tier: "physicianpro", tierExp: NOW + 300 * DAY };
  const p = purchasePatch(rec, "student:monthly", { months: 1 }, NOW);
  assert.equal(p.tier, "physicianpro");
  assert.ok(p.tierExp >= rec.tierExp);
  // forever stays forever
  assert.equal(purchasePatch({ tier: "physicianpro", tierExp: null }, "student:monthly", { months: 1 }, NOW).tierExp, null);
  // upgrade IS allowed
  assert.equal(purchasePatch({ tier: "trainee", tierExp: NOW + DAY }, "physician:monthly", { months: 1 }, NOW).tier, "physician");
  // an EXPIRED higher tier does not block the new one
  assert.equal(purchasePatch({ tier: "physicianpro", tierExp: NOW - 1 }, "student:monthly", { months: 1 }, NOW).tier, "trainee");
});

test("purchasePatch: onco add-on records oncoAddonExp, leaves tier alone", () => {
  const p = purchasePatch({ tier: "pro", tierExp: NOW + DAY }, "addon:onco", { months: 1 }, NOW);
  assert.deepEqual(p, { oncoAddonExp: NOW + 30 * DAY });
  assert.equal(purchasePatch({ oncoAddonExp: NOW + 5 * DAY }, "addon:onco", { months: 1 }, NOW).oncoAddonExp, NOW + 35 * DAY);
});

test("purchasePatch: token packs change nothing", () => {
  assert.equal(purchasePatch(null, "tokens:plus", { months: 0 }, NOW), null);
});

test("recordTierPurchase writes the patch", async () => {
  let written = null;
  const p = await recordTierPurchase({}, "u1", "coresident:monthly", { months: 1, now: NOW }, {
    getEntitlement: async () => ({ role: "resident" }),
    writeEntitlement: async (env, uid, patch) => { written = { uid, patch }; },
  });
  assert.equal(p.tier, "coresident");
  assert.equal(written.uid, "u1");
  assert.equal(written.patch.tier, "coresident");
});

test("fulfilPurchase records tier alongside grantPro", async () => {
  let written = null, granted = null;
  const r = await fulfilPurchase({}, "u1", "physician:annual", 12, "razorpay", {
    grantPro: async (env, uid, o) => { granted = o; return { ok: true, proExp: 1 }; },
    getEntitlement: async () => null,
    writeEntitlement: async (env, uid, patch) => { written = patch; },
  });
  assert.equal(r.ok, true);
  assert.equal(granted.months, 12);              // grantPro behaviour unchanged
  assert.equal(written.tier, "physician");
  assert.ok(written.tierExp > Date.now());
});

test("fulfilPurchase: addon:onco grants Pro months AND the add-on", async () => {
  let written = null;
  await fulfilPurchase({}, "u1", "addon:onco", 1, "razorpay", {
    grantPro: async () => ({ ok: true }),
    getEntitlement: async () => null,
    writeEntitlement: async (env, uid, patch) => { written = patch; },
  });
  assert.ok(written.oncoAddonExp > Date.now());
  assert.equal(written.tier, undefined);
});

test("fulfilPurchase survives an entitlement-store error (money path must not fail)", async () => {
  const r = await fulfilPurchase({}, "u1", "pro:monthly", 1, "razorpay", {
    grantPro: async () => ({ ok: true, proExp: 5 }),
    getEntitlement: async () => { throw new Error("firestore"); },
    writeEntitlement: async () => { throw new Error("firestore"); },
  });
  assert.equal(r.ok, true);
});

test("planKeyFromProductId maps App Store / Play product ids", () => {
  assert.equal(planKeyFromProductId("in.stewardmd.physicianpro.annual"), "physicianpro:annual");
  assert.equal(planKeyFromProductId("in.stewardmd.student.monthly"), "student:monthly");
  assert.equal(planKeyFromProductId("in.stewardmd.addon.onco"), "addon:onco");
  assert.equal(planKeyFromProductId("something.else"), null);
  assert.equal(planKeyFromProductId(""), null);
});
