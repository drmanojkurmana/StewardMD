import assert from "node:assert";
import test from "node:test";
import { adminSetFlag, adminClearFlag } from "../functions/_entitlements.js";

function deps({ record = {} } = {}) {
  const store = { rec: record };
  return {
    resolveUid: async () => "u1",
    getEntitlement: async () => store.rec,
    writeEntitlement: async (env, uid, patch) => { store.rec = Object.assign({}, store.rec, patch); return store.rec; },
    _store: store
  };
}
test("adminSetFlag writes featureFlags[feature]=true", async () => {
  const d = deps();
  const r = await adminSetFlag({}, { uid: "u1", feature: "scribe_dictation", enabled: true }, d);
  assert.equal(r.ok, true); assert.equal(d._store.rec.featureFlags.scribe_dictation, true);
});
test("adminSetFlag can DISABLE (false)", async () => {
  const d = deps({ record: { featureFlags: {} } });
  await adminSetFlag({}, { uid: "u1", feature: "thorex_llm", enabled: false }, d);
  assert.equal(d._store.rec.featureFlags.thorex_llm, false);
});
test("bad feature rejected", async () => {
  const d = deps();
  assert.equal((await adminSetFlag({}, { uid: "u1", feature: "bogus", enabled: true }, d)).error, "bad_feature");
});
test("adminClearFlag deletes the key", async () => {
  const d = deps({ record: { featureFlags: { scribe_dictation: true } } });
  const r = await adminClearFlag({}, { uid: "u1", feature: "scribe_dictation" }, d);
  assert.equal(r.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(d._store.rec.featureFlags, "scribe_dictation"), false);
});
