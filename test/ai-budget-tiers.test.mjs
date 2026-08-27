/* test/ai-budget-tiers.test.mjs — verified doctors get a real AI allowance, unverified get none.
 *
 * OWNER 2026-08-27: "no launch promo for who not verified (like who verified had better pro limits
 * while guest have very less)". The tiers already existed in _aibudget.js and already said exactly
 * this; they were switched off behind AI_BUDGET_ON. This pins the ladder and the new default.
 *
 * node --test test/ai-budget-tiers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiBudgetOn, budgetTier, roleAllowance, effectiveAllowance, currentMonthGrant,
} from "../functions/_aibudget.js";

const ENV = {};

test("the tiers are ON by default now, and can still be switched off", () => {
  assert.equal(aiBudgetOn(ENV), true, "default ON: verification has to be worth something");
  assert.equal(aiBudgetOn({ AI_BUDGET_ON: "0" }), false);
  assert.equal(aiBudgetOn({ AI_BUDGET_ON: "false" }), false);
  assert.equal(aiBudgetOn({ AI_BUDGET_ON: "1" }), true);
});

test("the ladder: unverified gets nothing, verified gets more, Pro gets most", () => {
  assert.equal(budgetTier(false, null, false), "none", "signed up but unverified");
  assert.equal(budgetTier(false, null, true), "free", "verified, free week over");
  assert.equal(budgetTier(true, null, true), "pro");
  assert.equal(budgetTier(true, "physician", true), "promax");

  const none = roleAllowance(ENV, false, null, false);
  const free = roleAllowance(ENV, false, null, true);
  const pro = roleAllowance(ENV, true, null, true);
  const promax = roleAllowance(ENV, true, "physician", true);

  assert.equal(none, 0, "an unverified account gets no AI budget at all");
  assert.ok(free > none, "verifying is worth something even after the free week");
  assert.ok(pro > free, "Pro is worth more than verified-only");
  assert.ok(promax > pro, "physician tier is the top of the ladder");
});

test("every step of the ladder is tunable from env without a deploy", () => {
  assert.equal(roleAllowance({ BUDGET_FREE_TOKENS: "9000" }, false, null, true), 9000);
  assert.equal(roleAllowance({ BUDGET_PRO_TOKENS: "42" }, true, null, true), 42);
  assert.equal(roleAllowance({ BUDGET_PROMAX_TOKENS: "77" }, true, "physician", true), 77);
});

test("verifying is what moves you off zero", () => {
  // The exact transition a doctor makes by uploading their certificate.
  const before = roleAllowance(ENV, false, null, false);
  const after = roleAllowance(ENV, true, null, true);   // verified -> Pro for the free week
  assert.equal(before, 0);
  assert.ok(after >= 1000000, `the free week must be a real allowance, got ${after}`);
});

test("a per-account override beats the tier, and a monthly grant adds to it", () => {
  // The owner can lift a single account without touching anyone else's tier.
  const rec = { aiCapTokens: 1234 };
  assert.equal(effectiveAllowance(ENV, false, null, false, rec, "2026-08"), 1234,
    "an explicit cap overrides even the zero tier");
  const granted = { aiCapTokens: 1000, aiGrantMonth: "2026-08", aiGrantTokens: 500 };
  assert.equal(effectiveAllowance(ENV, false, null, false, granted, "2026-08"), 1500);
  assert.equal(effectiveAllowance(ENV, false, null, false, granted, "2026-09"), 1000,
    "last month's grant does not roll over");
  assert.equal(currentMonthGrant(granted, "2026-09"), 0);
});

test("a negative or junk override cannot create a negative allowance", () => {
  assert.equal(effectiveAllowance(ENV, false, null, false, { aiCapTokens: -5 }, "2026-08"), 0);
  assert.equal(currentMonthGrant({ aiGrantMonth: "2026-08", aiGrantTokens: -9 }, "2026-08"), 0);
});
