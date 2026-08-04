import { test } from "node:test";
import assert from "node:assert";
import ENT from "../sknx-entitlement.js";

test("not pro -> free", () => {
  assert.equal(ENT.resolve({ isPro: () => false, tierFor: () => "v2beta" }), "free");
});
test("pro + v2beta grant -> v2beta", () => {
  assert.equal(ENT.resolve({ isPro: () => true, tierFor: () => "v2beta" }), "v2beta");
});
test("pro without grant -> v1", () => {
  assert.equal(ENT.resolve({ isPro: () => true, tierFor: () => "v1" }), "v1");
});
