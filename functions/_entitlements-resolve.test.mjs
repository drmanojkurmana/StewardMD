import assert from "node:assert";
import test from "node:test";
import { resolveUid, normalizeSmdId, regKey } from "../functions/_entitlements.js";

test("normalizeSmdId + regKey", () => {
  assert.equal(normalizeSmdId(" abc234 "), "SMD-ABC234");
  assert.equal(normalizeSmdId("SMD-ABC234"), "SMD-ABC234");
  assert.equal(regKey("mh-12345/a"), "icu:reg:MH_12345_A");
});
test("resolveUid: uid passthrough", async () => {
  assert.equal(await resolveUid({}, { uid: "u9" }, {}), "u9");
});
test("resolveUid: smdId via doctorDirectory", async () => {
  const deps = { fsGet: async (env, path) => path === "doctorDirectory/SMD-ABC234" ? { fields: { uid: "u1" } } : null };
  assert.equal(await resolveUid({}, { smdId: "abc234" }, deps), "u1");
  assert.equal(await resolveUid({}, { smdId: "ZZZ999" }, deps), null);
});
test("resolveUid: email via lookupUidByEmail", async () => {
  const deps = { lookupUidByEmail: async (env, e) => e === "dr@x.com" ? { uid: "u2" } : null };
  assert.equal(await resolveUid({}, { email: "dr@x.com" }, deps), "u2");
  assert.equal(await resolveUid({}, { email: "no@x.com" }, deps), null);
});
test("resolveUid: regNo via KV", async () => {
  const kv = { get: async (k) => k === "icu:reg:MH12345" ? "u3" : null };
  const deps = { kv };
  assert.equal(await resolveUid({}, { regNo: "MH12345" }, deps), "u3");
  assert.equal(await resolveUid({}, { regNo: "NOPE" }, deps), null);
});
test("resolveUid: no identity -> null", async () => {
  assert.equal(await resolveUid({}, {}, {}), null);
});
