/* test/credits.test.mjs — daily AI-cost cap + prepaid credits (₹50 → ₹25). Fake KV, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyCostCap, setUserCostCap, addCredits, adminSetCredits, getCredits, checkCostCap, creditConversion, grantFoundingPool, foundingDailyCap } from "../functions/_credits.js";

function fakeKv(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    m,
    async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}
const DAY = "2026-10-01";
const now = Date.parse(DAY + "T10:00:00Z");
const DOC = "em:doc@x.in";
function withCost(store, cost) { store.m.set("aiu:doc:" + DOC + ":" + DAY, JSON.stringify({ cost })); }

test("cap resolution: per-user > env role > env global > unlimited", async () => {
  const kv = fakeKv();
  assert.equal(await dailyCostCap({}, kv, "doc@x.in", null), 0);                       // nothing set → unlimited
  assert.equal(await dailyCostCap({ AI_DAILY_COST_CAP_INR: "10" }, kv, "doc@x.in"), 10);
  assert.equal(await dailyCostCap({ AI_COST_CAP_INTERN: "5", AI_DAILY_COST_CAP_INR: "10" }, kv, "doc@x.in", "intern"), 5);
  await setUserCostCap(kv, "doc@x.in", 3);
  assert.equal(await dailyCostCap({ AI_DAILY_COST_CAP_INR: "10" }, kv, "doc@x.in"), 3);  // per-user wins
});

test("credits: buy ₹50 → +₹25 (50% conversion)", async () => {
  assert.equal(creditConversion({}), 0.5);
  const kv = fakeKv();
  const r = await addCredits({}, kv, DOC, 50);
  assert.equal(r.added, 25); assert.equal(r.balance, 25);
  assert.equal(await getCredits(kv, DOC), 25);
  await adminSetCredits(kv, DOC, 0);                     // revoke
  assert.equal(await getCredits(kv, DOC), 0);
});

test("under cap → ok; unlimited cap → ok", async () => {
  const kv = fakeKv(); withCost(kv, 4);
  assert.equal((await checkCostCap({}, kv, DOC, 10, now)).ok, true);
  assert.equal((await checkCostCap({}, kv, DOC, 0, now)).unlimited, true);   // cap 0 = unlimited
});

test("at cap, no credits → 429 ai-cost-cap with resetAt", async () => {
  const kv = fakeKv(); withCost(kv, 12);
  const r = await checkCostCap({}, kv, DOC, 10, now);
  assert.equal(r.ok, false); assert.equal(r.reason, "ai-cost-cap");
  assert.equal(r.resetAt, Date.UTC(2026, 9, 2));         // next UTC midnight
});

test("at cap WITH credits → ok on credits, and lazily debits the over-cap spend", async () => {
  const kv = fakeKv(); withCost(kv, 13);                 // ₹3 over a ₹10 cap
  await adminSetCredits(kv, DOC, 20);
  const r = await checkCostCap({}, kv, DOC, 10, now);
  assert.equal(r.ok, true); assert.equal(r.onCredits, true);
  assert.equal(r.credits, 17);                            // 20 - 3 over-cap debited
  // second gate same day, cost grown to ₹15 (₹5 over) → debit only the new ₹2 delta
  withCost(kv, 15);
  const r2 = await checkCostCap({}, kv, DOC, 10, now);
  assert.equal(r2.credits, 15);                           // 17 - 2, not double-charged
});

test("Founding-Doctor: fixed pool + exactly ONE auto-refill, then block", async () => {
  const env = { FOUNDING_AI_GRANT_INR: "120", FOUNDING_AI_REFILL_INR: "120" };
  const kv = fakeKv();
  const g = await grantFoundingPool(env, kv, DOC);
  assert.equal(g.balance, 120); assert.equal(g.plan, "founding");
  assert.equal(foundingDailyCap({}), 0.01);                     // ~0 free daily → all AI draws the pool
  // burn the first ₹120 → auto-refills to ₹120 once
  withCost(kv, 120.01);
  const r1 = await checkCostCap(env, kv, DOC, 0.01, now);
  assert.equal(r1.ok, true); assert.equal(r1.onCredits, true);
  assert.equal(r1.credits, 120);                                // refilled
  // burn the refill too → no second refill → blocked (annual ceiling = ₹240 reached)
  withCost(kv, 240.01);
  const r2 = await checkCostCap(env, kv, DOC, 0.01, now);
  assert.equal(r2.ok, false); assert.equal(r2.reason, "ai-cost-cap");
  assert.equal(JSON.parse(kv.m.get("maik:credit:" + DOC)).refillsUsed, 1);
});

test("credits exhausted → block", async () => {
  const kv = fakeKv(); withCost(kv, 100);                // ₹90 over cap, only ₹5 credit
  await adminSetCredits(kv, DOC, 5);
  const r = await checkCostCap({}, kv, DOC, 10, now);
  assert.equal(r.credits, 0);                            // drained
  assert.equal(r.ok, false); assert.equal(r.reason, "ai-cost-cap");
});
