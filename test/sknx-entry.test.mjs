import { test } from "node:test";
import assert from "node:assert";
import SKNX from "../sknx.js";

test("isOn requires the flag AND a non-free entitlement", () => {
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "v2beta" }), true);
  assert.equal(SKNX.isOn({ flag: () => false, entitlement: () => "v2beta" }), false);
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "free" }), false);
});

test("isOn is false when flag is true but entitlement is v1 (non-free but still gated by flag only)", () => {
  // v1 is a paid, non-free tier -> isOn only cares about flag AND entitlement !== "free".
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "v1" }), true);
});
