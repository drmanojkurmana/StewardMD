import { test } from "node:test";
import assert from "node:assert";
import SKNX from "../sknx.js";

test("isOn requires the flag AND (a code OR a non-free entitlement)", () => {
  // Pro (non-free entitlement) path — unchanged, no access code present.
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "v2beta", xaccess: () => false }), true);
  assert.equal(SKNX.isOn({ flag: () => false, entitlement: () => "v2beta", xaccess: () => false }), false);
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "free", xaccess: () => false }), false);
});

test("isOn is false when flag is true but entitlement is v1 (non-free but still gated by flag only)", () => {
  // v1 is a paid, non-free tier -> the Pro path still opens it.
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "v1", xaccess: () => false }), true);
});

test("isOn: an active Experimental Access code unlocks SknX even at the free entitlement", () => {
  // The new code-gated path: a valid SMD_XACCESS activation opens SknX regardless of Pro status.
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "free", xaccess: () => true }), true);
  // ...but the flag must still be set (a code without the module flag is still off).
  assert.equal(SKNX.isOn({ flag: () => false, entitlement: () => "free", xaccess: () => true }), false);
});
