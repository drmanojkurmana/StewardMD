/* Physician Pro (Rs 899/mo) early access to the four experimental imaging modules.
 * WHY these assertions: early access must GRANT without ever DENYING — the access-code path that
 * every other tier uses today has to survive untouched, and a per-user featureFlags:false (the
 * revoke lever) must still beat a paid tier. Inert unless ROLE_GATES_ON=1, like the rest of the
 * matrix. The label side of this decision is asserted in test/experimental-beta-label.test.mjs. */
import assert from "node:assert";
import test from "node:test";
import { featureAllowed, earlyAccessAllows, requireFeature, EARLY_ACCESS_KEYS, registryEntry } from "../functions/_features.js";

const DAY = 86400000;
const GATES = { ROLE_GATES_ON: "1" };
const pp = () => ({ tier: "physicianpro", tierExp: Date.now() + DAY, role: "physician" });
const MODULES = ["thorex", "kardiox", "sknx", "fundx"];
const SUBKEYS = ["thorex_llm", "thorex_backend", "kardiox_ecg19", "sknx_llm", "sknx_cloud"];

test("all four modules and their sub-keys are in the early-access list", () => {
  MODULES.concat(SUBKEYS).forEach((k) => assert.ok(EARLY_ACCESS_KEYS.indexOf(k) >= 0, k + " missing"));
  MODULES.forEach((k) => assert.ok(registryEntry(k) && registryEntry(k).experimental === true, k + " not experimental in registry"));
});

test("physicianpro is allowed each experimental feature with no access code", () => {
  MODULES.concat(SUBKEYS).forEach((k) => {
    assert.equal(earlyAccessAllows(k, "physicianpro"), true, k);
    assert.equal(featureAllowed(GATES, pp(), k, "physician"), true, k);
  });
});

test("lower tiers are NOT allowed the module keys without a code", () => {
  ["free", "trainee", "coresident", "pro", "physician"].forEach((tier) => {
    MODULES.forEach((k) => {
      assert.equal(earlyAccessAllows(k, tier), false, tier + " " + k);
      assert.equal(featureAllowed(GATES, { tier, tierExp: Date.now() + DAY }, k, "physician"), false, tier + " " + k);
    });
  });
});

test("early access is grant-only: it never denies a legacy defaultOn sub-key", () => {
  // thorex_llm / sknx_cloud are defaultOn:true today. Adding physicianpro must not turn them into a
  // tier gate that locks everyone else out.
  ["thorex_llm", "thorex_backend", "sknx_llm", "sknx_cloud"].forEach((k) => {
    assert.equal(featureAllowed(GATES, { tier: "free" }, k, "student"), true, k + " free");
  });
});

test("a per-user featureFlags:false still denies a physicianpro", () => {
  MODULES.forEach((k) => {
    const rec = Object.assign(pp(), { featureFlags: { [k]: false } });
    assert.equal(featureAllowed(GATES, rec, k, "physician"), false, k);
  });
});

// Owner 2026-09-26: early access is grant-only, so it no longer waits for ROLE_GATES_ON. Lower tiers are
// unchanged with the gate off: defaultRoles [] on the module keys still means nobody without a code.
test("ROLE_GATES_ON off: physicianpro still granted; lower tiers still need a code", () => {
  MODULES.forEach((k) => assert.equal(featureAllowed({}, pp(), k, "physician"), true, k));
  MODULES.forEach((k) => assert.equal(featureAllowed({}, { tier: "physician", tierExp: null }, k, "physician"), false, k));
});

test("requireFeature: physicianpro granted without a code; a code still works for a lower tier", async () => {
  const req = { headers: { get: () => "Bearer x" } };
  const env = { FEATURES_ON: "1", ROLE_GATES_ON: "1" };

  for (const k of MODULES) {
    const pro = { uid: "u1", getEntitlement: async () => pp() };
    const r = await requireFeature(env, req, k, pro);
    assert.equal(r.allowed, true, k + " physicianpro");
    assert.equal(r.reason, "granted", k + " reason");

    const coded = {
      uid: "u2", xaToken: "tok",
      getEntitlement: async () => ({ tier: "pro", tierExp: Date.now() + DAY, role: "physician" }),
      checkActive: async () => ({ active: true })
    };
    const c = await requireFeature(env, req, k, coded);
    assert.equal(c.allowed, true, k + " code path");
    assert.equal(c.reason, "code", k + " code reason");

    const bare = { uid: "u3", getEntitlement: async () => ({ tier: "pro", tierExp: Date.now() + DAY, role: "physician" }) };
    assert.equal((await requireFeature(env, req, k, bare)).allowed, false, k + " pro without code");
  }
});

// With EXPERIMENTAL_ENFORCE_<MODULE>="1" (production), each module's betaGate asks planEarlyAccess before the
// access code, so Clinician Pro / Ultimate are not locked out by the code gate (owner 2026-09-26).
test("planEarlyAccess: server twin of the plan early access, fails closed", async () => {
  const { planEarlyAccess } = await import("../functions/_features.js");
  const req = { headers: { get: () => "Bearer x" } };
  const dep = (tier) => ({ uid: "u1", getEntitlement: async () => ({ tier, tierExp: null }) });
  for (const k of ["kardiox", "thorex", "fundx", "sknx"]) {
    assert.equal(await planEarlyAccess({}, req, k, dep("physicianpro")), true, k);
    assert.equal(await planEarlyAccess({}, req, k, dep("ultimate")), true, k);
    assert.equal(await planEarlyAccess({}, req, k, dep("physician")), false, k);
    assert.equal(await planEarlyAccess({}, req, k, dep(null)), false, k);
  }
  assert.equal(await planEarlyAccess({}, req, "kardiox", { verifyFirebaseToken: async () => null }), false);
  assert.equal(await planEarlyAccess({}, req, "kardiox", { uid: "u1", getEntitlement: async () => { throw new Error("x"); } }), false);
});
