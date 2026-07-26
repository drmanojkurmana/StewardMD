import assert from "node:assert";
import test from "node:test";
import { monthlyCapFor, invalidateBudgetCache } from "../functions/_aibudget.js";

function fakeKv(seed = {}) { const m = new Map(Object.entries(seed)); return { async get(k, t) { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, _m: m }; }

test("flag off -> null (legacy)", async () => {
  assert.equal(await monthlyCapFor({}, "u1", true, true, "2026-07", { kv: fakeKv() }), null);
});
test("no uid -> null", async () => {
  assert.equal(await monthlyCapFor({ AI_BUDGET_ON: "1" }, null, true, true, "2026-07", { kv: fakeKv() }), null);
});
test("cache hit (fresh month) skips Firestore", async () => {
  const kv = fakeKv({ "maik:budget:u1": JSON.stringify({ cap: 42, month: "2026-07" }) });
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
  assert.equal(cached.cap, 3000000); assert.equal(cached.month, "2026-07");
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
