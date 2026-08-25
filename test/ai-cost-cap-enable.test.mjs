/* test/ai-cost-cap-enable.test.mjs — what actually happens when AI_COST_CAP_ON is switched on.
 *
 * THE BUG THIS PINS: aiu:doc:<key>:<day>.cost is what checkCostCap reads to decide the free allowance
 * and to debit the prepaid wallet. It was written only by recordAiUsage, which runs PRE-call from
 * gateAndCount and therefore always recorded estCostInr 0. So the field was structurally always zero:
 * enabling the cap would have been completely inert, and a doctor's purchased tokens could never be
 * deducted. addAiSpend (called from _usage.js recordUsage, where the real token counts exist) is the fix.
 *
 * It also pins the SAFETY property the owner needs before flipping the flag: with the flag off, or with
 * no rupee cap set, nothing blocks and nothing is debited — free/Pro usage is untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addAiSpend, doctorUsageSummary } from "../functions/_ai_usage.js";
import { checkCostCap, costCapOn, dailyCostCap, addTokens, getCredits, inrToMt } from "../functions/_credits.js";

function fakeKv(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { m, async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const KEY = "em:doc@x.in", DAY = "2026-08-25", NOW = Date.parse(DAY + "T10:00:00Z");
const ON = { AI_COST_CAP_ON: "1" };

test("the flag is off by default — production's current state", () => {
  assert.equal(costCapOn({}), false);
  assert.equal(costCapOn({ AI_COST_CAP_ON: "0" }), false);
  assert.equal(costCapOn(ON), true);
});

test("REGRESSION: real spend now reaches the record the cap reads", async () => {
  const kv = fakeKv();
  const before = await doctorUsageSummary({}, kv, KEY, NOW);
  assert.equal(before.estCostInr, 0);
  assert.equal(before.tokens, 0);

  await addAiSpend(kv, KEY, DAY, 0.42, 3000);
  await addAiSpend(kv, KEY, DAY, 0.58, 1000);

  const after = await doctorUsageSummary({}, kv, KEY, NOW);
  assert.equal(after.estCostInr, 1, "two calls of ₹0.42 + ₹0.58 accumulate to ₹1.00");
  assert.equal(after.tokens, 4000, "and the token counts accumulate (dashboard tile was always 0)");
  assert.equal(inrToMt(after.estCostInr), 2000, "which the dashboard shows as 2,000 MT spent");
});

test("addAiSpend never corrupts the counts recordAiUsage keeps alongside it", async () => {
  const kv = fakeKv({ ["aiu:doc:" + KEY + ":" + DAY]: JSON.stringify({ req: 4, tok: 0, cost: 0, latSum: 900, fail: 1, byModule: { maik: 4 } }) });
  await addAiSpend(kv, KEY, DAY, 0.25, 500);
  const d = await kv.get("aiu:doc:" + KEY + ":" + DAY, "json");
  assert.equal(d.req, 4, "request count preserved");
  assert.deepEqual(d.byModule, { maik: 4 }, "per-module counts preserved");
  assert.equal(d.fail, 1); assert.equal(d.latSum, 900);
  assert.equal(d.cost, 0.25); assert.equal(d.tok, 500);
});

test("a zero-cost call (cache hit / failure) writes nothing", async () => {
  const kv = fakeKv();
  await addAiSpend(kv, KEY, DAY, 0, 0);
  assert.equal(kv.m.size, 0, "no key created, so a cached answer never burns allowance");
});

test("SAFETY: flag OFF -> free/Pro usage is completely untouched", async () => {
  const kv = fakeKv();
  await addTokens(kv, KEY, 750000);
  await addAiSpend(kv, KEY, DAY, 50, 100000);          // a huge day of AI
  assert.equal(costCapOn({}), false, "gateAndCount therefore never calls checkCostCap at all");
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000, "wallet untouched while the flag is off");
});

test("SAFETY: flag ON but no rupee cap set -> still nothing blocks, nothing is debited", async () => {
  const kv = fakeKv();
  await addTokens(kv, KEY, 750000);
  await addAiSpend(kv, KEY, DAY, 50, 100000);
  const cap = await dailyCostCap(ON, kv, "doc@x.in", null);
  assert.equal(cap, 0, "AI_DAILY_COST_CAP_INR unset => 0 => unlimited");
  const c = await checkCostCap(ON, kv, KEY, cap, NOW);
  assert.equal(c.ok, true);
  assert.equal(c.unlimited, true);
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000, "no cap means no debit — the flag alone does nothing");
});

test("ENABLED end to end: free allowance first, then the wallet, then a clean block", async () => {
  const kv = fakeKv();
  const env = Object.assign({ AI_DAILY_COST_CAP_INR: "5" }, ON);
  await addTokens(kv, KEY, 750000);                     // the ₹499 Power pack
  const cap = await dailyCostCap(env, kv, "doc@x.in", null);
  assert.equal(cap, 5);

  await addAiSpend(kv, KEY, DAY, 3, 20000);             // ₹3 of AI — inside the free ₹5
  let c = await checkCostCap(env, kv, KEY, cap, NOW);
  assert.equal(c.ok, true);
  assert.ok(!c.onCredits, "free allowance is spent first");
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000, "wallet untouched");

  await addAiSpend(kv, KEY, DAY, 7, 40000);             // ₹10 total — ₹5 over
  c = await checkCostCap(env, kv, KEY, cap, NOW);
  assert.equal(c.ok, true);
  assert.equal(c.onCredits, true, "AI keeps working on the wallet — no interruption mid-consult");
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000 - 10000, "exactly the ₹5 overage = 10,000 MT");

  await addAiSpend(kv, KEY, DAY, 380, 2000000);         // blow through the whole pack
  c = await checkCostCap(env, kv, KEY, cap, NOW);
  assert.equal(await getCredits(kv, KEY), 0, "wallet floors at zero, never negative");
  assert.equal(c.ok, false);
  assert.equal(c.reason, "ai-cost-cap");
  assert.ok(c.resetAt > NOW, "and the sheet can say when the free allowance returns");
});

test("ENABLED: a doctor with NO wallet is blocked at the cap, not overcharged", async () => {
  const kv = fakeKv();
  const env = Object.assign({ AI_DAILY_COST_CAP_INR: "5" }, ON);
  await addAiSpend(kv, KEY, DAY, 6, 30000);
  const c = await checkCostCap(env, kv, KEY, 5, NOW);
  assert.equal(c.ok, false, "this is the visible change for free users — they hit a wall at ₹5/day");
  assert.equal(c.credits, 0);
  assert.equal(c.creditsMt, 0);
});

test("ENABLED: a per-user cap override beats the global one", async () => {
  const kv = fakeKv();
  const env = Object.assign({ AI_DAILY_COST_CAP_INR: "5" }, ON);
  await kv.put("ai:costcap:doc@x.in", "100");
  assert.equal(await dailyCostCap(env, kv, "doc@x.in", null), 100, "so a pilot user can be raised or exempted individually");
});

test("the wallet is keyed the same way the spend is — em:<email>, not fb:<uid>", async () => {
  const kv = fakeKv();
  const env = Object.assign({ AI_DAILY_COST_CAP_INR: "1" }, ON);
  await addTokens(kv, KEY, 50000);
  await addAiSpend(kv, "fb:some-uid", DAY, 20, 50000);   // spend recorded under the WRONG key
  const c = await checkCostCap(env, kv, KEY, 1, NOW);
  assert.equal(c.ok, true);
  assert.equal(inrToMt(await getCredits(kv, KEY)), 50000, "mismatched keys => spend lands nowhere: the exact failure gate.costKey prevents");
});
