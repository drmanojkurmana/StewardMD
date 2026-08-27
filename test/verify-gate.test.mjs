/* test/verify-gate.test.mjs — Pro is an entitlement of a VERIFIED account.
 *
 * OWNER DECISION 2026-08-27. Before this, `isPro()` returned true for every caller while the launch
 * promo ran (to 15 Sep 2026) WITHOUT ever reading claims.verified — so an account that had never
 * shown a registration certificate held full Pro. That is what "the app is not verifying anyone"
 * actually meant, and it is why the fix belongs in this one function rather than in each of the
 * eleven server modules that gate on it.
 *
 * The three tiers:
 *   verified (NMC/SMC)      -> Pro, free for VERIFIED_PRO_DAYS (7) from the moment of verification
 *   signed up, not verified -> FREE tier (isPro false); the lifecycle sweep removes it at day 7
 *   guest                   -> never reaches here (client-side: 300 s per session, 2 per day)
 *
 * node --test test/verify-gate.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPro, entitlementState, accessState, verifyRequired, verifiedProDays,
} from "../functions/_entitlement.js";

const DAY = 86400000;
const now = Date.parse("2026-08-27T10:00:00Z");
// Promo left at its default (far-future, ACTIVE) on purpose: the whole point is that enforcement
// must beat the promo. If these pass with the promo running, they pass at any date.
const ON = {};
const OFF = { VERIFY_REQUIRED_FOR_PRO: "0" };

const verified = (agoDays) => ({ verified: true, verifiedAt: now - agoDays * DAY });

test("enforcement is ON by default and off only for an explicit falsy flag", () => {
  assert.equal(verifyRequired({}), true);
  assert.equal(verifyRequired({ VERIFY_REQUIRED_FOR_PRO: "0" }), false);
  assert.equal(verifyRequired({ VERIFY_REQUIRED_FOR_PRO: "false" }), false);
  assert.equal(verifyRequired({ VERIFY_REQUIRED_FOR_PRO: false }), false);
  assert.equal(verifyRequired({ VERIFY_REQUIRED_FOR_PRO: "1" }), true);
});

test("THE HOLE THAT WAS OPEN: the launch promo no longer hands Pro to an unverified account", () => {
  // This exact call returned true before the change, for every user, verified or not.
  assert.equal(isPro(ON, {}, now), false, "a signed-in but unverified account is FREE tier");
  assert.equal(isPro(ON, null, now), false, "no claims at all is certainly not Pro");
  // ...and the flag genuinely restores the old contract, which is what makes this reversible.
  assert.equal(isPro(OFF, {}, now), true, "flag off = the promo free-for-all, unchanged");
});

test("verified doctor gets Pro free for 7 days, then drops to free", () => {
  assert.equal(verifiedProDays(ON), 7);
  assert.equal(isPro(ON, verified(0), now), true, "just verified");
  assert.equal(isPro(ON, verified(6), now), true, "day 6, still inside the week");
  assert.equal(isPro(ON, verified(8), now), false, "day 8, the free week is over");
  // The window length is tunable from KV without a deploy.
  assert.equal(isPro({ VERIFIED_PRO_DAYS: "30" }, verified(8), now), true);
});

test("a PAYING verified doctor keeps Pro after the free week", () => {
  const paid = { ...verified(90), pro: true };
  assert.equal(isPro(ON, paid, now), true);
  const expired = { ...verified(90), pro: true, proExp: now - DAY };
  assert.equal(isPro(ON, expired, now), false, "an expired subscription is not a subscription");
});

test("paying but UNVERIFIED is still not Pro — verification gates money, not the reverse", () => {
  assert.equal(isPro(ON, { pro: true }, now), false);
  assert.equal(isPro(ON, { pro: true, proExp: now + 90 * DAY }, now), false);
});

test("manual review PENDING gets full access while it is pending (owner decision)", () => {
  // An intern/student uploaded a college ID. Review latency must not be a user-facing outage.
  assert.equal(isPro(ON, { provUntil: now + 5 * DAY }, now), true);
  assert.equal(isPro(ON, { provUntil: now - DAY }, now), false, "the pending window can expire");
  const a = accessState(ON, { provUntil: now + 5 * DAY }, now);
  assert.equal(a.allowed, true);
  assert.equal(a.pending, true);
  assert.equal(a.verified, false, "pending is NOT verified — the prescription gate still sees false");
});

test("accessState reads claims only — no KV/Firestore call on the hot path", () => {
  // It is called on every gated request; if it ever becomes async this assertion breaks loudly.
  const r = accessState(ON, verified(1), now);
  assert.equal(typeof r.then, "undefined");
  assert.equal(r.freeProActive, true);
  assert.equal(r.freeProEndsAt, now - DAY + 7 * DAY);
});

test("a doctor verified before this feature existed is not silently dropped", () => {
  // verifiedAt missing → the window cannot be computed here. accessState must still report them
  // ALLOWED so entitlementFor() can backfill the stamp, rather than reading 0 and locking them out.
  const a = accessState(ON, { verified: true }, now);
  assert.equal(a.allowed, true, "still allowed — the backfill in entitlementFor() sets the clock");
  assert.equal(a.verified, true);
  assert.equal(a.freeProActive, false, "no stamp yet, so no week has started");
});

test("entitlementState explains WHY, so the UI can route to verification not to payment", () => {
  const un = entitlementState(ON, {}, now);
  assert.equal(un.pro, false);
  assert.equal(un.reason, "unverified");
  assert.equal(un.verifyRequired, true);
  assert.equal(un.promo, false, "never advertise a promo that the gate will not honour");

  const fresh = entitlementState(ON, verified(1), now);
  assert.equal(fresh.pro, true);
  assert.equal(fresh.source, "verified-free-week");
  assert.equal(fresh.daysLeft, 6);

  const pend = entitlementState(ON, { provUntil: now + 3 * DAY }, now);
  assert.equal(pend.pro, true);
  assert.equal(pend.source, "pending-review");
  assert.equal(pend.pendingReview, true);

  const over = entitlementState(ON, verified(30), now);
  assert.equal(over.pro, false);
  assert.equal(over.reason, "verified-week-expired");
  assert.equal(over.verified, true, "still a verified doctor — they just need to subscribe now");
});

test("flag off restores the old entitlementState contract byte for byte", () => {
  const s = entitlementState(OFF, {}, now);
  assert.equal(s.pro, true);
  assert.equal(s.source, "launch-promo");
  assert.equal(s.promo, true);
});
