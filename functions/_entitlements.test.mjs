import assert from "node:assert";
import test from "node:test";
import { roleToTier, effectiveTier, normalizeRole, entitlementsOn, getEntitlement, writeEntitlement } from "../functions/_entitlements.js";

test("roleToTier maps role -> tier", () => {
  assert.equal(roleToTier("physician"), "v1");
  assert.equal(roleToTier("resident"), "v2beta");
  assert.equal(roleToTier("student"), "v2beta");
  assert.equal(roleToTier(null), "v1");
  assert.equal(roleToTier("bogus"), "v1");
});
test("effectiveTier: override wins, else role, else v1", () => {
  assert.equal(effectiveTier("thorex", { role: "physician" }), "v1");
  assert.equal(effectiveTier("thorex", { role: "student" }), "v2beta");
  assert.equal(effectiveTier("thorex", { role: "physician", override_thorex: "v2beta" }), "v2beta");
  assert.equal(effectiveTier("thorex", { role: "student", override_thorex: "v1" }), "v1");
  assert.equal(effectiveTier("thorex", { role: "student", override_thorex: "bogus" }), "v2beta"); // bad override ignored
  assert.equal(effectiveTier("thorex", {}), "v1");
});
test("normalizeRole closes the set", () => {
  assert.equal(normalizeRole("physician"), "physician");
  assert.equal(normalizeRole("STUDENT"), "student");
  assert.equal(normalizeRole("nurse"), null);
});
test("entitlementsOn reads env flag (default off)", () => {
  assert.equal(entitlementsOn({}), false);
  assert.equal(entitlementsOn({ ENTITLEMENTS_ON: "1" }), true);
  assert.equal(entitlementsOn({ ENTITLEMENTS_ON: "0" }), false);
});
test("getEntitlement returns fields or null", async () => {
  const present = { fsGet: async () => ({ fields: { role: "student" } }) };
  const absent = { fsGet: async () => null };
  assert.deepEqual(await getEntitlement({}, "u1", present), { role: "student" });
  assert.equal(await getEntitlement({}, "u1", absent), null);
});
test("writeEntitlement merges via a single wUpdate commit", async () => {
  const committed = [];
  const deps = { fsCommit: async (env, writes) => committed.push(...writes), wUpdate: (env, path, fields) => ({ path, fields }) };
  await writeEntitlement({}, "u1", { role: "student", updatedBy: "owner@x.com" }, deps);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].path, "entitlements/u1");
  assert.equal(committed[0].fields.role, "student");
  assert.ok(committed[0].fields.updatedAt, "stamps updatedAt");
});
