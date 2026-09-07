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
  needsProBody, proMessageFor,
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

/* ── The refusal has to explain itself ────────────────────────────────────────────────────────
 * A Pro gate that fails without a reason is indistinguishable from a bug, and "you need Pro" is an
 * actively WRONG thing to tell an unverified doctor: verification would have unlocked it free. The
 * reason travels in the 402 body so the client can offer the right button. */

test("the 402 body names the reason, not just the refusal", () => {
  const gate = { ok: false, pro: false, reason: "unverified", verified: false, pendingReview: false };
  const b = needsProBody(gate);
  assert.equal(b.needsPro, true);
  assert.equal(b.error, "needs-pro", "the key older clients already branch on is preserved");
  assert.equal(b.reason, "unverified");
  assert.equal(b.verified, false);
  assert.ok(b.message.length > 20, "a sentence a doctor can read, not a code");
});

test("the refusal message tells an unverified doctor to VERIFY, not to pay", () => {
  const m = proMessageFor("unverified");
  assert.match(m, /verif/i);
  assert.match(m, /free for 7 days/i);
  assert.ok(!/subscri|pay|price/i.test(m), `must not sell: ${m}`);

  const expired = proMessageFor("verified-week-expired");
  assert.match(expired, /subscribe/i, "once the free week is over, selling IS the honest answer");
});

test("an unrecognised reason still produces a usable sentence", () => {
  assert.ok(proMessageFor(undefined).length > 10);
  assert.ok(needsProBody(null).message.length > 10);
  assert.equal(needsProBody(null).reason, "none");
});

test("endpoint-specific fields merge in without losing the reason", () => {
  const b = needsProBody({ ok: false, reason: "unverified" }, { ok: false, error: "pro_required", feature: "queue-branding" });
  assert.equal(b.reason, "unverified", "the reason survives an endpoint's legacy shape");
  assert.equal(b.error, "pro_required", "and the endpoint keeps the key its client expects");
  assert.equal(b.feature, "queue-branding");
  assert.equal(b.needsPro, true);
});

test("a granted gate carries no reason to leak into a message", () => {
  const b = needsProBody({ ok: true, pro: true, reason: null });
  assert.equal(b.reason, "none");
});

// ── platform owners hold Pro as a team entitlement, without being "verified" ───────────────────
// Reported 2026-09-02: the owner's account wore the Pro badge (a `pro` claim) while the Subscription
// row said "needs a verified registration". accessState() had no notion of an owner, so
// /billing/status answered `unverified` for the person who runs the platform.
const TEAM = { OWNER_EMAILS: "team@example.test" };
const ownerClaims = (extra) => ({ email: "team@example.test", ...(extra || {}) });

test("an owner is Pro even with no verified claim and no paid claim", () => {
  assert.equal(isPro(TEAM, ownerClaims(), now), true);
  const s = entitlementState(TEAM, ownerClaims(), now);
  assert.equal(s.pro, true);
  assert.equal(s.source, "owner");
  assert.equal(s.reason, undefined, "no reason to bounce on, so no verify explainer");
});

test("an owner is NOT thereby verified: the prescription pad still needs a real registration", () => {
  const a = accessState(TEAM, ownerClaims(), now);
  assert.equal(a.allowed, true);
  assert.equal(a.verified, false);
  assert.equal(entitlementState(TEAM, ownerClaims(), now).verified, false);
});

test("an owner whose free verified week has EXPIRED stays Pro", () => {
  const c = ownerClaims(verified(30));
  assert.equal(isPro(TEAM, c, now), true);
  assert.equal(entitlementState(TEAM, c, now).source, "owner");
  assert.equal(entitlementState(TEAM, c, now).verified, true, "a verified owner is still verified");
});

test("a paid owner reports the subscription, not the team entitlement", () => {
  const c = ownerClaims({ pro: true, proExp: now + 10 * DAY, source: "subscription" });
  assert.equal(entitlementState(TEAM, c, now).source, "subscription");
});

test("the email must come from the token and match exactly; anyone else is unchanged", () => {
  assert.equal(isPro(TEAM, { email: "TEAM@example.test" }, now), true, "case-insensitive");
  assert.equal(isPro(TEAM, { email: "someone@example.test" }, now), false);
  assert.equal(isPro(TEAM, {}, now), false, "no email, no entitlement");
  assert.equal(entitlementState(TEAM, { email: "someone@example.test" }, now).reason, "unverified");
});
