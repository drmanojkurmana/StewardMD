import assert from "node:assert";
import test from "node:test";
import { meterTokens } from "../functions/_usage.js";

// meterTokens increments the shared monthly + daily token counters.
test("meterTokens accumulates into maik:m and maik:u", async () => {
  const store = (() => { const m = new Map(); return { async get(k, t) { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); }, _m: m }; })();
  const env = { MAIK_KV: store };
  await meterTokens(env, "fb:u1", 100, 50);
  await meterTokens(env, "fb:u1", 10, 5);
  // find the month + day keys
  const mKey = [...store._m.keys()].find((k) => k.startsWith("maik:m:fb:u1:"));
  const uKey = [...store._m.keys()].find((k) => k.startsWith("maik:u:fb:u1:"));
  assert.equal(JSON.parse(store._m.get(mKey)).tokens, 165);
  assert.equal(JSON.parse(store._m.get(uKey)).tokens, 165);
});
test("meterTokens no-op without kv or id", async () => {
  await meterTokens({}, "fb:u1", 1, 1);   // no throw
  await meterTokens({ MAIK_KV: {} }, null, 1, 1);   // no throw
});
