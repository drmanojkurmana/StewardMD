import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURES, isFeature, normalizeTier } from "./_experimental.js";

test("thorex is a registered feature", () => {
  assert.equal(isFeature("thorex"), true);
  assert.equal(FEATURES.thorex.prefix, "THORX");
});

test("normalizeTier closes the set to v1|v2beta", () => {
  assert.equal(normalizeTier("v2beta"), "v2beta");
  assert.equal(normalizeTier("v1"), "v1");
  assert.equal(normalizeTier("free"), "v1");
  assert.equal(normalizeTier(undefined), "v1");
  assert.equal(normalizeTier("V2BETA"), "v1"); // exact match only
});
