import assert from "node:assert";
import test from "node:test";
import { aiBudgetOn, budgetTier, roleAllowance, currentMonthGrant, effectiveAllowance, premiumModelAllowed } from "../functions/_aibudget.js";

test("aiBudgetOn default off", () => {
  assert.equal(aiBudgetOn({}), false);
  assert.equal(aiBudgetOn({ AI_BUDGET_ON: "1" }), true);
});
test("budgetTier: verified-gated free trial", () => {
  assert.equal(budgetTier(false, null, false), "none");
  assert.equal(budgetTier(false, null, true), "free");
  assert.equal(budgetTier(false, "student", false), "none");   // unverified never gets trial
  assert.equal(budgetTier(true, "physician", false), "promax");
  assert.equal(budgetTier(true, "student", true), "pro");
  assert.equal(budgetTier(true, null, true), "pro");           // Pro no-role -> pro
});
test("roleAllowance reads env, none=0", () => {
  const env = { BUDGET_FREE_TOKENS: "5000", BUDGET_PRO_TOKENS: "1000000", BUDGET_PROMAX_TOKENS: "3000000" };
  assert.equal(roleAllowance(env, false, null, false), 0);
  assert.equal(roleAllowance(env, false, null, true), 5000);
  assert.equal(roleAllowance(env, true, "student", true), 1000000);
  assert.equal(roleAllowance(env, true, "physician", true), 3000000);
});
test("currentMonthGrant only in its month", () => {
  const rec = { aiGrantMonth: "2026-07", aiGrantTokens: 2000 };
  assert.equal(currentMonthGrant(rec, "2026-07"), 2000);
  assert.equal(currentMonthGrant(rec, "2026-08"), 0);
  assert.equal(currentMonthGrant({}, "2026-07"), 0);
});
test("effectiveAllowance: override wins, grant adds", () => {
  const env = { BUDGET_PRO_TOKENS: "1000000" };
  assert.equal(effectiveAllowance(env, true, "student", true, {}, "2026-07"), 1000000);
  assert.equal(effectiveAllowance(env, true, "student", true, { aiCapTokens: 50000 }, "2026-07"), 50000);
  assert.equal(effectiveAllowance(env, true, "student", true, { aiCapTokens: 50000, aiGrantMonth: "2026-07", aiGrantTokens: 2000 }, "2026-07"), 52000);
  // override lets an admin give an unverified user tokens
  assert.equal(effectiveAllowance(env, false, null, false, { aiCapTokens: 1000 }, "2026-07"), 1000);
});
test("premiumModelAllowed: per-user flag or role default", () => {
  assert.equal(premiumModelAllowed({}, { premiumModels: { kardiox_ecg19: true } }, "kardiox_ecg19", "student"), true);
  assert.equal(premiumModelAllowed({}, {}, "kardiox_ecg19", "student"), false);
  assert.equal(premiumModelAllowed({ PREMIUM_KARDIOX_ECG19_ROLES: "physician" }, {}, "kardiox_ecg19", "physician"), true);
});
