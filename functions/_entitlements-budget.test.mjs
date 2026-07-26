import assert from "node:assert";
import test from "node:test";
import { adminSetBudget, adminAddGrant, adminSetModel } from "../functions/_entitlements.js";

function deps({ record = {} } = {}) {
  const store = { rec: record, invalidated: [] };
  return {
    resolveUid: async () => "u1",
    getEntitlement: async () => store.rec,
    writeEntitlement: async (env, uid, patch) => { store.rec = Object.assign({}, store.rec, patch); return store.rec; },
    invalidateBudgetCache: async (env, uid) => { store.invalidated.push(uid); },
    _store: store
  };
}
test("adminSetBudget writes aiCapTokens + invalidates cache", async () => {
  const d = deps();
  const r = await adminSetBudget({}, { uid: "u1", tokens: 50000 }, d);
  assert.equal(r.ok, true); assert.equal(d._store.rec.aiCapTokens, 50000);
  assert.deepEqual(d._store.invalidated, ["u1"]);
  assert.equal((await adminSetBudget({}, { uid: "u1", tokens: -5 }, d)).error, "bad_amount");
});
test("adminAddGrant writes month + tokens", async () => {
  const d = deps();
  const r = await adminAddGrant({}, { uid: "u1", tokens: 2000, month: "2026-07" }, d);
  assert.equal(r.ok, true);
  assert.equal(d._store.rec.aiGrantMonth, "2026-07");
  assert.equal(d._store.rec.aiGrantTokens, 2000);
  assert.equal((await adminAddGrant({}, { uid: "u1", tokens: 5, month: "nope" }, d)).error, "bad_month");
});
test("adminSetModel toggles a premium model flag", async () => {
  const d = deps({ record: { premiumModels: {} } });
  const r = await adminSetModel({}, { uid: "u1", model: "kardiox_ecg19", allowed: true }, d);
  assert.equal(r.ok, true);
  assert.equal(d._store.rec.premiumModels.kardiox_ecg19, true);
  assert.equal((await adminSetModel({}, { uid: "u1", model: "bogus", allowed: true }, d)).error, "bad_model");
});
