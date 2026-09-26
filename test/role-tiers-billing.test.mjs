/* role-tiers-billing.test.mjs — audit fixes from vault/Role-Tiers.md section 6 (2026-09-26):
 * 1 add-ons never grant Pro, 2 the onco iOS product id, 7 live price defaults, 8 admin set-plan +
 * Ultimate, 12 Trainee needs verification, 13 token packs re-sized from 2026-12-26. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fulfilPurchase, planKeyFromProductId, plans, traineeGate } from "../functions/api/billing/[[path]].js";
import { tokenPacks, packsV2Active, tokenPackList } from "../functions/_credits.js";
import { purchasePatch, tierFromPlanKey, normalizeTier, effectiveTierFor, adminSetPlan, adminUltimateMigration, clinicAddonSlots } from "../functions/_entitlements.js";

const NOW = Date.parse("2026-09-26T10:00:00Z"), DAY = 86400000;

test("finding 1: add-ons record the add-on and never call grantPro", async () => {
  for (const key of ["addon:onco", "addon:clinic"]) {
    let granted = false, recorded = null;
    const deps = { grantPro: async () => { granted = true; return {}; }, recordTierPurchase: async (env, uid, k) => { recorded = k; return { ok: 1 }; } };
    const r = await fulfilPurchase({}, "u1", key, 1, "test", deps);
    assert.equal(granted, false, key + " must not grant Pro");
    assert.equal(recorded, key);
    assert.equal(r.ok, true);
  }
  let granted = false;
  await fulfilPurchase({}, "u1", "physician:monthly", 1, "test", { grantPro: async () => { granted = true; return {}; }, recordTierPurchase: async () => ({ tier: "physician" }) });
  assert.equal(granted, true, "a real plan still grants Pro");
});

test("finding 1: extra clinic adds a live slot; onco extends its expiry", () => {
  const p1 = purchasePatch(null, "addon:clinic", { months: 1 }, NOW);
  assert.equal(p1.clinicAddonSlots, 1);
  assert.equal(p1.clinicAddonExp, NOW + 30 * DAY);
  const p2 = purchasePatch(p1, "addon:clinic", { months: 1 }, NOW + DAY);
  assert.equal(p2.clinicAddonSlots, 2);
  assert.equal(clinicAddonSlots(Object.assign({}, p1, p2), NOW + 2 * DAY), 2);
  assert.equal(clinicAddonSlots(p2, p2.clinicAddonExp + 1), 0);
  assert.ok(purchasePatch(null, "addon:onco", { months: 1 }, NOW).oncoAddonExp > NOW);
});

test("finding 2: both onco product ids map to the add-on", () => {
  assert.equal(planKeyFromProductId("in.stewardmd.onco.monthly"), "addon:onco");
  assert.equal(planKeyFromProductId("in.stewardmd.addon.onco"), "addon:onco");
  assert.equal(planKeyFromProductId("in.stewardmd.physician.annual"), "physician:annual");
});

test("finding 7: code defaults equal the live prices; struck anchors 3,499 / 4,999", () => {
  const t = plans({}).tiers;
  assert.equal(t.physician.amount, 149900);
  assert.equal(t.physician.annual, 1499900);
  assert.equal(t.physicianpro.amount, 249900);
  assert.equal(t.physicianpro.annual, 2499900);
  assert.equal(t.physician.regular, 349900);
  assert.equal(t.physicianpro.regular, 499900);
  assert.equal(t.pro.annual, 499900);
});

test("finding 12: Trainee web order needs a reviewed account", async () => {
  const gate = (claims) => traineeGate({}, "u1", { tier: "student" }, { getUserClaims: async () => claims });
  assert.equal((await gate({})).error, "verify-first");
  assert.equal((await gate({ phoneVerified: true })).error, "verify-first");
  assert.equal(await gate({ verified: true }), null);
  assert.equal(await gate({ traineeVerified: true }), null);
  assert.equal(await gate({ provUntil: Date.now() + DAY }), null);
  assert.equal(await traineeGate({}, "u1", { tier: "pro" }, { getUserClaims: async () => ({}) }), null);
  assert.equal(await traineeGate({}, "u1", { tier: "student" }, { getUserClaims: async () => { throw new Error("x"); } }), null);   // fail-open
});

test("finding 13: token packs keep Introductory sizes until 2026-12-26, then 10k / 40k / 100k", () => {
  const before = tokenPacks({}, Date.parse("2026-12-25T12:00:00+05:30"));
  assert.deepEqual([before.boost.mt, before.plus.mt, before.power.mt], [50000, 250000, 750000]);
  const after = tokenPacks({}, Date.parse("2026-12-26T00:00:01+05:30"));
  assert.deepEqual([after.boost.mt, after.plus.mt, after.power.mt], [10000, 40000, 100000]);
  assert.deepEqual([after.boost.amount, after.plus.amount, after.power.amount], [4900, 19900, 49900]);
  assert.equal(after.plus.regular, undefined);
  assert.equal(packsV2Active({ PACKS_V2_FROM: "2026-10-01T00:00:00Z" }, Date.parse("2026-10-02T00:00:00Z")), true);
});

test("Ultimate: a known tier that no payment can buy", () => {
  assert.equal(normalizeTier("ultimate"), "ultimate");
  assert.equal(tierFromPlanKey("ultimate:monthly"), null);
  assert.equal(effectiveTierFor({ tier: "ultimate", tierExp: null }, NOW), "ultimate");
  const p = purchasePatch({ tier: "ultimate", tierExp: null }, "physician:monthly", { months: 1 }, NOW);
  assert.equal(p.tier, "ultimate");    // a purchase never downgrades
});

test("finding 8: adminSetPlan writes tier + expiry and the Pro claim, never shortening it", async () => {
  let written = null, merged = null;
  const deps = { resolveUid: async () => "u1", writeEntitlement: async (e, uid, patch) => { written = patch; },
    getUserClaims: async () => ({ pro: true, proExp: NOW + 90 * DAY, source: "subscription" }), mergeUserClaims: async (e, uid, p) => { merged = p; },
    invalidateBudgetCache: async () => {} };
  const r = await adminSetPlan({}, { uid: "u1", tier: "ultimate", days: 30, now: NOW }, deps);
  assert.equal(r.ok, true);
  assert.equal(written.tier, "ultimate");
  assert.equal(written.tierExp, NOW + 30 * DAY);
  assert.equal(merged.pro, true);
  assert.equal(merged.proExp, NOW + 90 * DAY);        // longer paid claim kept
  assert.equal(merged.source, "subscription");
  await adminSetPlan({}, { uid: "u1", tier: "ultimate", forever: true, now: NOW }, deps);
  assert.equal(written.tierExp, null);
  assert.equal(merged.proExp, null);
  assert.equal((await adminSetPlan({}, { uid: "u1", tier: "gold", days: 3 }, deps)).error, "bad_tier");
  assert.equal((await adminSetPlan({}, { uid: "u1", tier: "pro" }, deps)).error, "bad_days");
  merged = null;
  await adminSetPlan({}, { uid: "u1", tier: "free", now: NOW }, deps);
  assert.equal(merged, null, "free leaves the claim alone");
});

test("D3: Ultimate migration lists first, converts only named uids, flags paying subscribers", async () => {
  const users = [
    { uid: "a", email: "a@x", claims: { pro: true, source: "manual" } },
    { uid: "b", email: "b@x", claims: { pro: true, proExp: NOW + DAY, source: "subscription" } },
    { uid: "c", email: "c@x", claims: { verified: true } },
  ];
  let writes = 0;
  const deps = { listUsersPage: async () => ({ users, nextPageToken: null }), writeEntitlement: async () => { writes++; },
    getUserClaims: async (e, uid) => (users.find((u) => u.uid === uid) || {}).claims, invalidateBudgetCache: async () => {} };
  const dry = await adminUltimateMigration({}, {}, deps);
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.candidates.map((x) => x.uid), ["a"]);
  assert.deepEqual(dry.paying.map((x) => x.uid), ["b"]);
  assert.equal(writes, 0, "a dry run writes nothing");
  const run = await adminUltimateMigration({}, { dryRun: false, uids: ["a", "c"] }, deps);
  assert.deepEqual(run.converted.map((x) => x.uid), ["a"]);
  assert.deepEqual(run.skipped, [{ uid: "c", reason: "not_pro" }]);
  assert.equal(writes, 1);
});
