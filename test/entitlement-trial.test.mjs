/* test/entitlement-trial.test.mjs — Pro entitlement: launch promo, paid claim, per-user 14/7-day trial. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPro, entitlementState, trialState, trialDaysFor } from "../functions/_entitlement.js";

const DAY = 86400000;
const CUT = Date.parse("2026-09-15T23:59:59+05:30");
const promoPast = { PRO_FREE_UNTIL: "2020-01-01" };   // promo OFF → real gating
const promoOn = {};                                    // default promo (far future) ON
const now = Date.parse("2026-10-01T10:00:00Z");        // after cutover + after promoPast

test("trialDaysFor: 14 up to cutover, 7 after", () => {
  assert.equal(trialDaysFor(promoPast, CUT - DAY), 14);
  assert.equal(trialDaysFor(promoPast, CUT + DAY), 7);
  assert.equal(trialDaysFor(promoPast, 0), 7);   // no start → treated as 7
});

test("trialState: none / active / expired", () => {
  assert.equal(trialState(promoPast, {}, now).started, false);
  const started = now - 2 * DAY;                          // started 2 days ago, after cutover → 7-day trial
  assert.equal(trialState(promoPast, { trialStart: started }, now).active, true);
  const old = now - 20 * DAY;                             // 20 days ago → expired
  const s = trialState(promoPast, { trialStart: old }, now);
  assert.equal(s.active, false); assert.equal(s.daysLeft, 0);
});

test("isPro: promo covers everyone (free-for-all preserved)", () => {
  assert.equal(isPro(promoOn, null, Date.now()), true);          // guest during promo
  assert.equal(isPro(promoOn, {}, Date.now()), true);
});

test("isPro after promo: paid OR active trial only", () => {
  assert.equal(isPro(promoPast, {}, now), false);                                   // no pay, no trial
  assert.equal(isPro(promoPast, { pro: true }, now), true);                          // paid, no expiry
  assert.equal(isPro(promoPast, { pro: true, proExp: now - DAY }, now), false);      // paid but expired
  assert.equal(isPro(promoPast, { trialStart: now - 3 * DAY }, now), true);          // in 7-day trial
  assert.equal(isPro(promoPast, { trialStart: now - 30 * DAY }, now), false);        // trial expired
});

test("entitlementState reports source + trial info", () => {
  assert.equal(entitlementState(promoOn, {}, Date.now()).source, "launch-promo");
  assert.equal(entitlementState(promoPast, { pro: true }, now).source, "subscription");
  const tr = entitlementState(promoPast, { trialStart: now - 2 * DAY }, now);
  assert.equal(tr.source, "trial"); assert.equal(tr.pro, true); assert.ok(tr.daysLeft >= 1);
  const ex = entitlementState(promoPast, { trialStart: now - 30 * DAY }, now);
  assert.equal(ex.pro, false); assert.equal(ex.reason, "trial-expired");
});
