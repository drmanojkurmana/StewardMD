import assert from "node:assert";
import test from "node:test";
import { monthlyCapFor, invalidateBudgetCache } from "../functions/_aibudget.js";

function fakeKv(seed = {}) { const m = new Map(Object.entries(seed)); return { async get(k, t) { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, _m: m }; }

// The flag defaults ON since 2026-08-27, so "off" has to be said explicitly.
test("flag off -> null (legacy)", async () => {
  assert.equal(await monthlyCapFor({ AI_BUDGET_ON: "0" }, "u1", true, true, "2026-07", { kv: fakeKv() }), null);
});
test("no uid -> null", async () => {
  assert.equal(await monthlyCapFor({ AI_BUDGET_ON: "1" }, null, true, true, "2026-07", { kv: fakeKv() }), null);
});
test("cache hit (fresh month) skips Firestore", async () => {
  // The entry records the inputs it was computed from (Pro, phoneVerified -> "p1").
  const kv = fakeKv({ "maik:budget:u1": JSON.stringify({ cap: 42, month: "2026-07", in: "p1" }) });
  let called = 0;
  const cap = await monthlyCapFor({ AI_BUDGET_ON: "1" }, "u1", true, true, "2026-07", { kv, getEntitlement: async () => { called++; return { role: "physician" }; } });
  assert.equal(cap, 42); assert.equal(called, 0, "no Firestore read on fresh cache");
});
test("cache miss reads Firestore, computes, caches", async () => {
  const kv = fakeKv();
  const env = { AI_BUDGET_ON: "1", BUDGET_PROMAX_TOKENS: "3000000" };
  const cap = await monthlyCapFor(env, "u2", true, true, "2026-07", { kv, getEntitlement: async () => ({ role: "physician" }) });
  assert.equal(cap, 3000000);
  const cached = await kv.get("maik:budget:u2", "json");
  assert.equal(cached.cap, 3000000); assert.equal(cached.month, "2026-07"); assert.equal(cached.in, "p1");
});
test("stale-month cache is recomputed", async () => {
  const kv = fakeKv({ "maik:budget:u3": JSON.stringify({ cap: 999, month: "2026-06" }) });
  const env = { AI_BUDGET_ON: "1", BUDGET_PRO_TOKENS: "1000000" };
  const cap = await monthlyCapFor(env, "u3", true, true, "2026-07", { kv, getEntitlement: async () => ({ role: "student" }) });
  assert.equal(cap, 1000000);
});
test("Firestore error -> role default (fail-open, no throw)", async () => {
  const env = { AI_BUDGET_ON: "1", BUDGET_PRO_TOKENS: "1000000" };
  const cap = await monthlyCapFor(env, "u4", true, true, "2026-07", { kv: fakeKv(), getEntitlement: async () => { throw new Error("fs down"); } });
  assert.equal(cap, 1000000);
});
test("invalidateBudgetCache deletes the key", async () => {
  const kv = fakeKv({ "maik:budget:u5": JSON.stringify({ cap: 1, month: "2026-07" }) });
  await invalidateBudgetCache({}, "u5", { kv });
  assert.equal(await kv.get("maik:budget:u5", "json"), null);
});

// D8 (2026-09-26): the cache must not outlive the input that decides the free allowance.
test("a cap cached before the mobile was verified is recomputed once it is", async () => {
  const env = { AI_BUDGET_ON: "1", BUDGET_FREE_TOKENS: "5000" };
  const kv = fakeKv();
  const ent = { getEntitlement: async () => ({}) };
  assert.equal(await monthlyCapFor(env, "u6", false, false, "2026-09", Object.assign({ kv }, ent)), 0);
  assert.equal(await monthlyCapFor(env, "u6", false, true, "2026-09", Object.assign({ kv }, ent)), 5000);
  assert.equal((await kv.get("maik:budget:u6", "json")).in, "f1");
});
test("a pre-2026-09-26 entry (no inputs recorded) is recomputed, not trusted", async () => {
  const env = { AI_BUDGET_ON: "1", BUDGET_FREE_TOKENS: "5000" };
  const kv = fakeKv({ "maik:budget:u7": JSON.stringify({ cap: 5000, month: "2026-09" }) });
  assert.equal(await monthlyCapFor(env, "u7", false, false, "2026-09", { kv, getEntitlement: async () => ({}) }), 0,
    "a registration-verified account cached at 5,000 drops to 0 until its mobile is verified");
});
