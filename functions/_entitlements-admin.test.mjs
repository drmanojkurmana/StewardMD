import assert from "node:assert";
import test from "node:test";
import { adminLookup, adminSetRole, adminSetTier, adminClearOverride } from "../functions/_entitlements.js";

function deps({ record = null, claims = {}, user = { email: "dr@x.com", displayName: "Dr X" }, smdId = "SMD-ABC234" } = {}) {
  const store = { rec: record };
  return {
    resolveUid: async () => "u1",
    getEntitlement: async () => store.rec,
    writeEntitlement: async (env, uid, patch) => { store.rec = Object.assign({}, store.rec, patch); return store.rec; },
    getUserClaims: async () => claims,
    lookupUserByUid: async () => user,
    fsGet: async (env, path) => path === "users/u1/profile/self" ? { fields: { smdId } } : null,
    _store: store
  };
}

test("adminLookup joins record + pro/verified + smdId", async () => {
  const d = deps({ record: { role: "student" }, claims: { pro: true, verified: true, regNo: "MH1" } });
  const r = await adminLookup({}, { smdId: "abc234" }, d);
  assert.equal(r.ok, true);
  assert.equal(r.uid, "u1");
  assert.equal(r.role, "student");
  assert.equal(r.effectiveTiers.thorex, "v2beta");
  assert.equal(r.pro, true);
  assert.equal(r.verified, true);
  assert.equal(r.smdId, "SMD-ABC234");
});
test("adminSetRole validates + writes", async () => {
  const d = deps();
  const ok = await adminSetRole({}, { email: "dr@x.com", role: "physician" }, d);
  assert.equal(ok.ok, true);
  assert.equal(d._store.rec.role, "physician");
  const bad = await adminSetRole({}, { email: "dr@x.com", role: "nurse" }, d);
  assert.equal(bad.ok, false); assert.equal(bad.error, "bad_role");
});
test("adminSetTier validates feature+tier and writes an override", async () => {
  const d = deps();
  const ok = await adminSetTier({}, { uid: "u1", feature: "thorex", tier: "v2beta" }, d);
  assert.equal(ok.ok, true);
  assert.equal(d._store.rec.override_thorex, "v2beta");
  assert.equal((await adminSetTier({}, { uid: "u1", feature: "thorex", tier: "gold" }, d)).error, "bad_tier");
  assert.equal((await adminSetTier({}, { uid: "u1", feature: "", tier: "v1" }, d)).error, "bad_feature");
});
test("adminClearOverride nulls the override", async () => {
  const d = deps({ record: { role: "physician", override_thorex: "v2beta" } });
  const ok = await adminClearOverride({}, { uid: "u1", feature: "thorex" }, d);
  assert.equal(ok.ok, true);
  assert.equal(d._store.rec.override_thorex, null);
});
test("resolve miss -> not_found", async () => {
  const d = deps(); d.resolveUid = async () => null;
  assert.equal((await adminSetRole({}, { email: "no@x.com", role: "student" }, d)).error, "not_found");
});
