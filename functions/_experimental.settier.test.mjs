import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSetTierWrite } from "./_experimental.js";

test("set-tier builds a normalized guarded update", () => {
  const w = buildSetTierWrite("act_abc", "v2beta");
  assert.equal(w.path.endsWith("act_abc"), true);
  assert.equal(w.fields.tier, "v2beta");
  const w2 = buildSetTierWrite("act_abc", "nonsense");
  assert.equal(w2.fields.tier, "v1");
});
