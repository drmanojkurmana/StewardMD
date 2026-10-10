/* test/ai-budget-tiers.test.mjs — the AI allowance ladder.
 *
 * D8 (owner, 2026-09-26): the FREE allowance needs a verified MOBILE NUMBER (`phoneVerified`), not
 * registration verification. The third argument to budgetTier/roleAllowance/effectiveAllowance is
 * that flag now; a registration-verified doctor reaches Pro through the Pro path (isPro true).
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

test("the ladder: no verified mobile gets nothing, a verified mobile gets Free, Pro gets most", () => {
  assert.equal(budgetTier(false, null, false), "none", "Free account, mobile not verified");
  assert.equal(budgetTier(false, null, true), "free", "Free account, mobile verified");
  assert.equal(budgetTier(true, null, true), "pro");
  assert.equal(budgetTier(true, "physician", true), "promax");

  const none = roleAllowance(ENV, false, null, false);
  const free = roleAllowance(ENV, false, null, true);
  const pro = roleAllowance(ENV, true, null, true);
  const promax = roleAllowance(ENV, true, "physician", true);

  assert.equal(none, 0, "an account without a verified mobile gets no AI budget at all");
  assert.ok(free > none, "verifying the mobile is worth something");
  assert.ok(pro > free, "Pro is worth more than Free");
  // One Pro allowance (owner, 2026-10-10: 300,000 MaiK Tokens a month for Pro). The physician tier used to be 3x.
  assert.equal(promax, pro, "Pro is one allowance now; a single account can still be raised in User control");
  assert.equal(pro, 300000, "300,000 MaiK Tokens a month");
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
  assert.ok(after >= 300000, `the free week must be a real allowance, got ${after}`);
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

test("D8: registration verification alone no longer grants the Free allowance; the mobile does", () => {
  // A Free (non-Pro) doctor whose REGISTRATION is verified but whose mobile is not: callers now pass
  // claims.phoneVerified, which is false here, so the tier is none.
  assert.equal(roleAllowance(ENV, false, null, false), 0);
  assert.equal(roleAllowance(ENV, false, null, true), 5000, "BUDGET_FREE_TOKENS default");
  // Only a real boolean true counts: a truthy string from a mangled claim does not unlock tokens.
  assert.equal(budgetTier(false, null, "true"), "none");
  // Pro is unaffected either way.
  assert.equal(roleAllowance(ENV, true, null, false), roleAllowance(ENV, true, null, true));
  assert.equal(roleAllowance(ENV, true, "physician", false), roleAllowance(ENV, true, "physician", true));
});
