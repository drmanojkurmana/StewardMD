import { test } from "node:test";
import assert from "node:assert";
import SKNX from "../sknx.js";

test("isOn requires the flag AND (a code OR an early-access plan)", () => {
  // Owner decision 2026-09-26: a Pro (non-free) entitlement alone no longer opens SknX; only a code
  // or an early-access plan (Clinician Pro / Ultimate) does.
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "v2beta", xaccess: () => false, plan: () => false }), false);
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "v1", xaccess: () => false, plan: () => false }), false);
  assert.equal(SKNX.isOn({ flag: () => true, xaccess: () => false, plan: () => true }), true);
  assert.equal(SKNX.isOn({ flag: () => false, xaccess: () => false, plan: () => true }), false);
  assert.equal(SKNX.isOn({ flag: () => true, xaccess: () => false, plan: () => false }), false);
});

test("isOn: an active Experimental Access code unlocks SknX even at the free entitlement", () => {
  // The new code-gated path: a valid SMD_XACCESS activation opens SknX regardless of Pro status.
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "free", xaccess: () => true, plan: () => false }), true);
  // ...but the flag must still be set (a code without the module flag is still off).
  assert.equal(SKNX.isOn({ flag: () => false, entitlement: () => "free", xaccess: () => true, plan: () => false }), false);
});
