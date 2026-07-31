import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceScope, PermissionError } from "../../functions/_connect/permission.js";

test("scope is intersected, never widened", () => {
  assert.deepEqual(enforceScope(["Patient", "Observation"], ["Observation", "Condition"]), ["Observation"]);
});
test("fail-closed: empty intersection throws", () => {
  assert.throws(() => enforceScope(["Patient"], ["Billing"]), PermissionError);
});
test("fail-closed: bad input throws (never falls open)", () => {
  assert.throws(() => enforceScope(null, ["Patient"]), PermissionError);
});
