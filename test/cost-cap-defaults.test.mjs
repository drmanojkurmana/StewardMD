import test from "node:test";
import assert from "node:assert/strict";
import { dailyCostCap } from "../functions/_credits.js";

test("role caps default in code once the wrangler.toml vars are gone", async () => {
  assert.equal(await dailyCostCap({}, null, null, "student"), 5);
  assert.equal(await dailyCostCap({}, null, null, "co_resident"), 6);
  assert.equal(await dailyCostCap({}, null, null, "physician_pro"), 25);
});
test("env still overrides the code default; unknown role falls to the global cap", async () => {
  assert.equal(await dailyCostCap({ AI_COST_CAP_STUDENT: "9" }, null, null, "student"), 9);
  assert.equal(await dailyCostCap({ AI_DAILY_COST_CAP_INR: "3" }, null, null, "visitor"), 3);
});
