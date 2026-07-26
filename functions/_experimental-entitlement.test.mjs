import assert from "node:assert/strict";
import test from "node:test";
import { resolveTier, checkActive, signToken } from "../functions/_experimental.js";

// ---- resolveTier unit tests (the cleanest seam — no token needed) ------------------------

test("resolveTier: flag on + record exists -> person tier (override wins)", async () => {
  const fs = { fsGet: async () => ({ fields: { role: "student" } }) };
  const tier = await resolveTier({ ENTITLEMENTS_ON: "1" }, "thorex", "u1", "v1", fs);
  assert.equal(tier, "v2beta"); // student -> v2beta per roleToTier
});

test("resolveTier: flag on + no record -> falls back to activation tier", async () => {
  const fs = { fsGet: async () => null };
  const tier = await resolveTier({ ENTITLEMENTS_ON: "1" }, "thorex", "u1", "v2beta", fs);
  assert.equal(tier, "v2beta");
});

test("resolveTier: flag off -> activation tier, record ignored", async () => {
  const fs = { fsGet: async () => ({ fields: { role: "student" } }) };
  const tier = await resolveTier({}, "thorex", "u1", "v1", fs);
  assert.equal(tier, "v1");
});

test("resolveTier: no uid -> activation tier even if flag on", async () => {
  const fs = { fsGet: async () => ({ fields: { role: "student" } }) };
  const tier = await resolveTier({ ENTITLEMENTS_ON: "1" }, "thorex", null, "v1", fs);
  assert.equal(tier, "v1");
});

test("resolveTier: fsGet throws -> fail-open to activation tier", async () => {
  const fs = { fsGet: async () => { throw new Error("boom"); } };
  const tier = await resolveTier({ ENTITLEMENTS_ON: "1" }, "thorex", "u1", "v1", fs);
  assert.equal(tier, "v1");
});

test("resolveTier: activation tier normalizes unknown values to v1", async () => {
  const fs = { fsGet: async () => null };
  const tier = await resolveTier({}, "thorex", "u1", "bogus", fs);
  assert.equal(tier, "v1");
});

// ---- checkActive end-to-end happy path (mints a real signed token) -----------------------

function fakeFs({ activation, entitlement }) {
  return {
    fsGet: async (env, path) => {
      if (path.startsWith("experimentalActivations/")) return activation ? { fields: activation } : null;
      if (path.startsWith("entitlements/")) return entitlement ? { fields: entitlement } : null;
      return null;
    },
    fsCommit: async () => {},
    fsQuery: async () => [],
  };
}

test("checkActive prefers person-tier when ENTITLEMENTS_ON and a record exists", async () => {
  const secret = "test-secret";
  const env = { EXPERIMENTAL_TOKEN_SECRET: secret, ENTITLEMENTS_ON: "1" };
  const token = await signToken({ f: "thorex", u: "u1", d: "dev1", p: "ios", a: "act1", t: "v1" }, secret);
  const fs = fakeFs({
    activation: { feature: "thorex", uid: "u1", deviceId: "dev1", status: "active", tier: "v1" },
    entitlement: { role: "student" },
  });
  const result = await checkActive(env, "thorex", token, fs);
  assert.equal(result.active, true);
  assert.equal(result.tier, "v2beta");
});

test("checkActive falls back to activation tier when no entitlement record", async () => {
  const secret = "test-secret";
  const env = { EXPERIMENTAL_TOKEN_SECRET: secret, ENTITLEMENTS_ON: "1" };
  const token = await signToken({ f: "thorex", u: "u1", d: "dev1", p: "ios", a: "act1", t: "v2beta" }, secret);
  const fs = fakeFs({
    activation: { feature: "thorex", uid: "u1", deviceId: "dev1", status: "active", tier: "v2beta" },
    entitlement: null,
  });
  const result = await checkActive(env, "thorex", token, fs);
  assert.equal(result.active, true);
  assert.equal(result.tier, "v2beta");
});

test("checkActive ignores the entitlement record when flag is OFF", async () => {
  const secret = "test-secret";
  const env = { EXPERIMENTAL_TOKEN_SECRET: secret }; // ENTITLEMENTS_ON unset
  const token = await signToken({ f: "thorex", u: "u1", d: "dev1", p: "ios", a: "act1", t: "v1" }, secret);
  const fs = fakeFs({
    activation: { feature: "thorex", uid: "u1", deviceId: "dev1", status: "active", tier: "v1" },
    entitlement: { role: "student" },
  });
  const result = await checkActive(env, "thorex", token, fs);
  assert.equal(result.active, true);
  assert.equal(result.tier, "v1");
});
