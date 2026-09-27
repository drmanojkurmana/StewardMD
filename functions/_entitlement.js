/* StewardMD — Pro entitlement (source of truth on the server).
 *
 * Pro is a Firebase custom claim (`pro:true` + `proExp` ms), set server-side only (via the
 * clobber-safe mergeUserClaims). The gate reads it from the verified ID token; Firestore Rules can
 * read `request.auth.token.pro` for collaboration/shared-cases. NEVER trust a client flag.
 *
 * LAUNCH PROMO: until PRO_FREE_UNTIL everyone is treated as Pro (no purchase needed) so the whole
 * app is unlocked for testing/launch; after that instant, only real entitlements count. The date is
 * overridable via env.PRO_FREE_UNTIL (ms epoch or ISO string) without a code change.
 */
import { mergeUserClaims, getUserClaims } from "./_fbadmin.js";
import { verifiedClaimsFor } from "./_fbauth.js";
import { cfgFlag, warmBillingCfg } from "./_billingcfg.js";
import { ownerEmails } from "./_adminauth.js";

const PROMO_UNTIL_DEFAULT = Date.parse("2026-09-27T23:59:59+05:30");   // 27 Sep 2026, 23:59 IST (owner, 2026-09-16)

export function promoUntil(env) {
  const v = cfgFlag(env, "PRO_FREE_UNTIL");   // live KV override wins over env (lets the owner end the promo now)
  if (v) { const t = /^\d+$/.test(String(v)) ? +v : Date.parse(v); if (t) return t; }
  return PROMO_UNTIL_DEFAULT;
}
export function promoActive(env, now) { return (now || Date.now()) < promoUntil(env); }

// ── Per-user free trial ────────────────────────────────────────────────────────────────────────
// Each account gets a trial clock (claim `trialStart`, ms) stamped on first sign-in (see entitlementFor).
// Length: 14 days for trials STARTED on/before the cutover (env TRIAL14_UNTIL, default 15 Sep 2026),
// 7 days after. So early adopters get 14, later signups get 7 — matching the launch promo window.
const DAY_MS = 86400000;
export function trialCutover(env) {
  const v = env && env.TRIAL14_UNTIL;
  if (v) { const t = /^\d+$/.test(String(v)) ? +v : Date.parse(v); if (t) return t; }
  return Date.parse("2026-09-15T23:59:59+05:30");
}
export function trialDaysFor(env, trialStartMs) { return (trialStartMs && +trialStartMs <= trialCutover(env)) ? 14 : 7; }
export function trialState(env, claims, now) {
  now = now || Date.now();
  const ts = claims && claims.trialStart ? +claims.trialStart : 0;
  if (!ts) return { active: false, started: false, endsAt: null, daysLeft: 0 };
  const endsAt = ts + trialDaysFor(env, ts) * DAY_MS;
  return { active: now < endsAt, started: true, endsAt, daysLeft: Math.max(0, Math.ceil((endsAt - now) / DAY_MS)) };
}

// ── Verification gate (owner decision, 2026-08-27) ────────────────────────────────────────────
// StewardMD is for registered doctors, so Pro is an entitlement of a VERIFIED account: the gate asks
// about registration BEFORE it asks about money. Three tiers, and this function decides tier 1:
//   verified (NMC/SMC)      -> Pro, free for VERIFIED_PRO_DAYS from the moment of verification
//   signed up, not verified -> FREE tier only (the lifecycle sweep removes the account at day 7)
//   guest                   -> handled client-side (300 s per session, 2 per day)
// Reversible from KV with no deploy: set VERIFY_REQUIRED_FOR_PRO=0 to restore the old behaviour.
export function verifyRequired(env) {
  const v = cfgFlag(env, "VERIFY_REQUIRED_FOR_PRO");
  return !(v === "0" || v === 0 || v === false || v === "false");     // default ON
}
export const VERIFIED_PRO_DAYS_DEFAULT = 7;
export function verifiedProDays(env) {
  const n = +cfgFlag(env, "VERIFIED_PRO_DAYS");
  return Number.isFinite(n) && n > 0 ? n : VERIFIED_PRO_DAYS_DEFAULT;
}

/* Who is allowed to hold Pro at all once enforcement is on.
 *   claims.verified === true   a real NMC/SMC register match, or an owner approval of a doctor or
 *                              PG resident (full registration)
 *   claims.traineeVerified     an owner-approved medical student or intern (see mayPrescribe above:
 *                              allowed here, never on a prescribing surface)
 *   claims.provUntil > now     proof uploaded, MANUAL REVIEW PENDING. Owner decision: full access
 *                              while pending, so the owner's review latency is never a user-facing
 *                              outage for an intern or student who did everything right.
 * Reads CLAIMS ONLY - no KV or Firestore lookup - because this runs on every gated request. */
/* A platform owner (functions/_adminauth.js OWNER_EMAILS) holds Pro as a team entitlement. The
 * email is read from the SIGNED token, so a client cannot claim it. Deliberately NOT the same as
 * `verified`: verification also unlocks the prescription pad, which stamps a real registration
 * number, and an owner who is not a registered doctor must still not have that. So an owner is
 * `allowed` (Pro) but only `verified` if they actually verified.
 *
 * Reported 2026-09-02: the owner's own account showed the Pro badge (a `pro` claim) while the
 * Subscription row said "needs a verified registration" - accessState() had no notion of an owner,
 * so /billing/status answered `unverified` and the paywall bounced to the verify explainer. */
export function isOwnerClaims(env, claims) {
  const e = claims && typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  return !!e && ownerEmails(env).indexOf(e) > -1;
}

/* ── Verification role (audit 2026-09-26, vault/Role-Tiers.md section 6, findings 3 and 4) ───────
 * Two claims, two meanings. Keep them apart everywhere:
 *   verified:true         a REGISTERED doctor (NMC/SMC full registration: practising doctor or PG
 *                         resident). The only claim that may prescribe, sign, or print a Reg. No.
 *   traineeVerified:true  a REVIEWED medical student or intern (owner approved their college or
 *                         internship ID). A real account: access, the free week, the purge sweep and
 *                         the AI budget treat it like a verified one. It must NEVER prescribe:
 *                         students hold no registration and interns only a provisional one.
 * Readers that ask "is this a registered doctor" use mayPrescribe(); readers that ask "is this a
 * real, reviewed account" use isReviewedAccount(). */
export const VERIFY_ROLES = ["doctor", "resident", "intern", "student"];
export const TRAINEE_VERIFY_ROLES = ["intern", "student"];
// Verification role (what the chooser sent) -> entitlements/{uid}.role (functions/_entitlements.js ROLES).
export const VERIFY_ROLE_TO_ENTITLEMENT = { doctor: "physician", resident: "resident", intern: "intern", student: "student" };
// Unknown or missing -> "doctor": the historical default of /api/verify-doctor, and the role every
// record written before the chooser existed was verified under.
export function normalizeVerifyRole(r) {
  const v = String(r == null ? "" : r).trim().toLowerCase();
  return VERIFY_ROLES.indexOf(v) >= 0 ? v : "doctor";
}
export function isTraineeVerifyRole(r) {
  return TRAINEE_VERIFY_ROLES.indexOf(String(r == null ? "" : r).trim().toLowerCase()) >= 0;
}
export function entitlementRoleFor(verifyRole) { return VERIFY_ROLE_TO_ENTITLEMENT[normalizeVerifyRole(verifyRole)]; }
export function mayPrescribe(claims) { return !!(claims && claims.verified === true); }
export function isReviewedAccount(claims) {
  return !!(claims && (claims.verified === true || claims.traineeVerified === true));
}

// An entitlement role that is already a paid/admin-set variant of the same person is kept: a doctor
// the owner set to physician_pro must not drop to physician because they re-verified.
const ROLE_FAMILY = { physician: ["physician", "physician_pro"], resident: ["resident", "co_resident", "pro"] };

/* Write the verification role into entitlements/{uid}.role. BEST-EFFORT: never throws, so a Firestore
 * outage can never fail a verification. deps: { getEntitlement, writeEntitlement } (tests inject
 * them; production loads functions/_entitlements.js lazily, which also keeps this module out of the
 * _entitlements -> _aibudget -> _usage -> _entitlement import cycle at evaluation time).
 * Returns { ok, role, skipped?, error? }. */
export async function recordVerifiedRole(env, uid, verifyRole, deps) {
  deps = deps || {};
  const role = entitlementRoleFor(verifyRole);
  if (!uid) return { ok: false, role, error: "no-uid" };
  try {
    let get = deps.getEntitlement, write = deps.writeEntitlement;
    if (!get || !write) {
      const m = await import("./_entitlements.js");
      get = get || m.getEntitlement; write = write || m.writeEntitlement;
    }
    let cur = null;
    try { cur = await get(env, uid, deps); } catch (e) { cur = null; }   // unreadable -> write anyway
    const have = cur && typeof cur.role === "string" ? cur.role : "";
    if (have && (ROLE_FAMILY[role] || [role]).indexOf(have) >= 0) return { ok: true, role: have, skipped: "same-family" };
    await write(env, uid, { role, roleSource: "verification" }, deps);
    return { ok: true, role };
  } catch (e) {
    try { console.warn("[verify] entitlement role write failed", String((e && e.message) || e).slice(0, 120)); } catch (x) {}
    return { ok: false, role, error: "write-failed" };
  }
}

/* THE FREE WEEK NEEDS A VERIFIED PROFILE (owner, 2026-09-27): "Only verified profiles get pro
 * subscription for 7 days ... verification is mandatory, phone number or NMC or state MC id
 * verification, to get eligible for the 7 days free Pro trial."
 *
 * Before this, an UNVERIFIED account held the week too: tapping "Not now" on the verify screen
 * stamped provUntil (the skip trial), and so did uploading a certificate still awaiting review.
 * Now the week needs one of: a verified registration (verified / traineeVerified) or a verified
 * mobile number (phoneVerified, set only after the WhatsApp/SMS code matches). provUntil alone no
 * longer unlocks Pro. It runs ONCE, from whichever verification came first, so verifying the
 * other one later does not start a second week.
 *
 * `verified` keeps meaning "registered doctor" - the prescribing surfaces read it - so a phone-only
 * account is `phoneVerified`, never `verified`. TRIAL_NEEDS_VERIFY "0" restores provisional access. */
export function trialNeedsVerify(env) {
  const v = String(cfgFlag(env, "TRIAL_NEEDS_VERIFY") == null ? "" : cfgFlag(env, "TRIAL_NEEDS_VERIFY")).trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}
// When the free week starts: the first verification this account completed.
function weekStart(claims) {
  const a = claims && claims.verifiedAt ? +claims.verifiedAt : 0;
  const b = claims && claims.phoneVerifiedAt ? +claims.phoneVerifiedAt : 0;
  return a && b ? Math.min(a, b) : (a || b);
}
function trialOnceOn(env) { const v = String(cfgFlag(env, "TRIAL_ONCE_ON") == null ? "" : cfgFlag(env, "TRIAL_ONCE_ON")).trim().toLowerCase(); return v === "1" || v === "true" || v === "on"; }
export function accessState(env, claims, now) {
  now = now || Date.now();
  const prov = claims && claims.provUntil ? +claims.provUntil : 0;
  const owner = isOwnerClaims(env, claims);
  // trialDenied: the free week was refused because this doctor/number/device already had one on
  // another account (_trial_ledger.js). Verified still means verified; there is just no free week.
  // Honoured only while TRIAL_ONCE_ON is "1", so switching the flag off restores every denied week.
  const denied = !!(claims && claims.trialDenied) && trialOnceOn(env);
  if (claims && claims.verified === true) {
    const at = trialNeedsVerify(env) ? weekStart(claims) : (claims.verifiedAt ? +claims.verifiedAt : 0);
    // No verifiedAt = verified before this feature existed. entitlementFor() backfills it rather
    // than reading 0 here, so a doctor already verified never blinks out of Pro on deploy day.
    const endsAt = at ? at + verifiedProDays(env) * DAY_MS : 0;
    if (denied && !owner) return { allowed: true, verified: true, trainee: false, reviewed: true, pending: false, verifiedAt: at || null, owner, trialDenied: true,
             freeProEndsAt: null, freeProActive: false };
    return { allowed: true, verified: true, trainee: false, reviewed: true, pending: false, verifiedAt: at || null, owner,
             freeProEndsAt: endsAt || null, freeProActive: owner || !!(endsAt && now < endsAt) };
  }
  // A reviewed student/intern: the same access and free week as a verified doctor, but `verified`
  // stays false, because that field is read as "registered doctor" by the prescribing surfaces.
  if (claims && claims.traineeVerified === true) {
    const at = trialNeedsVerify(env) ? weekStart(claims) : (claims.verifiedAt ? +claims.verifiedAt : 0);
    const endsAt = at ? at + verifiedProDays(env) * DAY_MS : 0;
    if (denied && !owner) return { allowed: true, verified: false, trainee: true, reviewed: true, pending: false, verifiedAt: at || null, owner, trialDenied: true,
             freeProEndsAt: null, freeProActive: false };
    return { allowed: true, verified: false, trainee: true, reviewed: true, pending: false, verifiedAt: at || null, owner,
             freeProEndsAt: endsAt || null, freeProActive: owner || !!(endsAt && now < endsAt) };
  }
  if (owner) {
    return { allowed: true, verified: false, pending: !!(prov && now < prov), provUntil: prov || null, owner: true,
             freeProEndsAt: null, freeProActive: true };
  }
  if (trialNeedsVerify(env)) {
    if (claims && claims.phoneVerified === true) {
      const at = weekStart(claims);
      const endsAt = at ? at + verifiedProDays(env) * DAY_MS : 0;
      if (denied) return { allowed: true, verified: false, phoneVerified: true, reviewed: false, pending: !!(prov && now < prov), provUntil: prov || null, verifiedAt: at || null, owner, trialDenied: true,
               freeProEndsAt: null, freeProActive: false };
      return { allowed: true, verified: false, phoneVerified: true, reviewed: false, pending: !!(prov && now < prov), provUntil: prov || null, verifiedAt: at || null, owner,
               freeProEndsAt: endsAt || null, freeProActive: !!(endsAt && now < endsAt) };
    }
    // Pending review or a skipped verification, with nothing verified: no free week.
    return { allowed: false, verified: false, pending: !!prov, provUntil: prov || null, needsVerification: true,
             freeProEndsAt: null, freeProActive: false };
  }
  if (prov && now < prov && !denied) {
    return { allowed: true, verified: false, pending: true, provUntil: prov,
             freeProEndsAt: prov, freeProActive: true };
  }
  return { allowed: false, verified: false, pending: !!prov, provUntil: prov || null,
           freeProEndsAt: null, freeProActive: false };
}

// Decide Pro from a caller's token claims.
// ENFORCEMENT ON:  not verified -> false, full stop. Then a paid claim, then the free verified week.
//   The launch promo deliberately does NOT apply here: it returns true for every caller regardless
//   of claims, which is exactly the hole that let unverified accounts hold Pro. Turning the flag
//   off restores the promo path below, unchanged.
// ENFORCEMENT OFF: launch promo (everyone free until PRO_FREE_UNTIL) -> paid claim -> per-user trial.
export function isPro(env, claims, now) {
  now = now || Date.now();
  if (verifyRequired(env)) {
    const a = accessState(env, claims, now);
    if (!a.allowed) return false;
    if (claims && claims.pro === true && (!claims.proExp || +claims.proExp > now)) return true;
    return !!a.freeProActive;
  }
  if (promoActive(env, now)) return true;
  if (claims && claims.pro === true && (!claims.proExp || +claims.proExp > now)) return true;
  if (trialState(env, claims, now).active) return true;
  return false;
}
export function entitlementState(env, claims, now) {
  now = now || Date.now();
  const tr = trialState(env, claims, now);
  if (verifyRequired(env)) {
    const a = accessState(env, claims, now);
    const paid = !!(claims && claims.pro === true && (!claims.proExp || +claims.proExp > now));
    const base = { promo: false, trial: false, verified: a.verified, phoneVerified: !!(a.phoneVerified || (claims && claims.phoneVerified === true)), pendingReview: !!a.pending,
                   traineeVerified: !!a.trainee, reviewed: !!a.reviewed,
                   verifyRequired: true, freeProEndsAt: a.freeProEndsAt || null };
    // Say WHY, not just no. The paywall/verify UI branches on `reason` so an unverified clinician
    // is sent to the certificate upload, not to a payment sheet that cannot help them.
    if (!a.allowed) return { ...base, pro: false, source: "none", until: null, reason: "unverified" };
    if (paid) return { ...base, pro: true, source: (claims.source || "subscription"), until: (claims.proExp || null) };
    if (a.owner) return { ...base, pro: true, source: "owner", until: null, owner: true };
    if (a.freeProActive) {
      return { ...base, pro: true, until: a.freeProEndsAt,
               source: a.verified || a.trainee ? "verified-free-week" : a.phoneVerified ? "phone-verified-week" : a.pending ? "pending-review" : "verified-free-week", trial: true,
               daysLeft: Math.max(0, Math.ceil((a.freeProEndsAt - now) / DAY_MS)) };
    }
    return { ...base, pro: false, source: "none", until: null, reason: a.trialDenied ? "trial-used" : "verified-week-expired" };
  }
  if (promoActive(env, now)) return { pro: true, source: "launch-promo", until: promoUntil(env), promo: true, trial: !!tr.active, trialEndsAt: tr.endsAt, daysLeft: tr.daysLeft };
  const paid = !!(claims && claims.pro === true && (!claims.proExp || +claims.proExp > now));
  if (paid) return { pro: true, source: (claims.source || "subscription"), until: (claims.proExp || null), promo: false, trial: false, trialEndsAt: tr.endsAt };
  if (tr.active) return { pro: true, source: "trial", until: tr.endsAt, promo: false, trial: true, trialEndsAt: tr.endsAt, daysLeft: tr.daysLeft };
  return { pro: false, source: "none", until: null, promo: false, trial: false, trialEndsAt: tr.endsAt, reason: tr.started ? "trial-expired" : "none" };
}

// Authoritative (fresh) entitlement for a uid — does a server-side claims lookup, so it reflects a
// grant immediately even before the client's ID token refreshes. Use for /billing/status, not hot gates.
// `email` is the caller's address from the SIGNED token (the billing route passes it). Custom claims
// never carry an email - nothing writes one - so without it isOwnerClaims() below is always false on
// this path, and the owner's own /billing/status said "not Pro" the day their verified free week
// ended (2026-09-20: on-device models locked, MaiK "not working"), while the hot AI gate, which reads
// the token, still said Pro. The email is merged transiently, never persisted.
export async function entitlementFor(env, uid, email) {
  try { await warmBillingCfg(env && env.MAIK_KV); } catch (e) {}
  if (!uid) return entitlementState(env, null);
  let claims = {};
  try { claims = await getUserClaims(env, uid); } catch (e) {}
  if (email && typeof email === "string" && !claims.email) claims.email = email;
  // Start the per-user trial clock on first status check (no pro, no trial yet). One write per new
  // account; done here (not on the hot proFromRequest gate) so gates stay read-only.
  try { if (!claims.pro && !claims.trialStart) { const ts = Date.now(); await mergeUserClaims(env, uid, { trialStart: ts }); claims.trialStart = ts; } } catch (e) {}
  // A number verified before phoneVerifiedAt existed: its week runs from now, once, rather than from 0.
  try {
    if (verifyRequired(env) && trialNeedsVerify(env) && claims.phoneVerified === true && !claims.phoneVerifiedAt) {
      const pa = Date.now();
      await mergeUserClaims(env, uid, { phoneVerifiedAt: pa });
      claims.phoneVerifiedAt = pa;
    }
  } catch (e) {}
  // Backfill verifiedAt for doctors verified BEFORE the free week existed. Without it their window
  // computes from 0 and they drop to the free tier the instant this deploys - a support wave made
  // of exactly the people who did the right thing. One write, once, each.
  try {
    if (verifyRequired(env) && isReviewedAccount(claims) && !claims.verifiedAt && !(claims.trialDenied && trialOnceOn(env))) {
      const va = Date.now();
      await mergeUserClaims(env, uid, { verifiedAt: va });
      claims.verifiedAt = va;
    }
  } catch (e) {}
  return entitlementState(env, claims);
}

// Grant / extend Pro for a uid (from a verified purchase, or an owner comp). Clobber-safe: keeps any
// existing claims (e.g. `verified`). opts: { forever } · { months } · { days } · { source }. A timed
// grant extends from the current expiry if still in the future. `forever` clears the expiry.
export async function grantPro(env, uid, opts) {
  opts = opts || {};
  const now = Date.now();
  const source = String(opts.source || "manual").slice(0, 40);
  if (opts.forever) {
    await mergeUserClaims(env, uid, { pro: true, proExp: null, source: source });   // null expiry = forever
    return { ok: true, uid, forever: true, proExp: null };
  }
  var days = opts.days ? +opts.days : (opts.months ? +opts.months * 30 : 30);
  days = Math.max(1, days);
  let base = now;
  try { const cur = await getUserClaims(env, uid); if (cur && cur.pro && cur.proExp && +cur.proExp > now) base = +cur.proExp; } catch (e) {}
  const proExp = base + days * 24 * 3600 * 1000;
  await mergeUserClaims(env, uid, { pro: true, proExp: proExp, source: source });
  return { ok: true, uid, forever: false, proExp: proExp };
}
// Revoke Pro (refund/chargeback/expiry cleanup).
export async function revokePro(env, uid) {
  await mergeUserClaims(env, uid, { pro: null, proExp: null, source: null });
  return { ok: true, uid };
}


// Verify the caller's Firebase ID token and read its Pro entitlement (+ launch promo). Fast enough
// for hot endpoints (JWKS is cached in _fbauth). Returns { pro, uid, claims }. A guest (no/invalid
// token) is still Pro DURING the promo; once the promo ends a guest is never Pro. The pro claim is
// read from the token payload, trustworthy only because the signature is verified just above.
export async function proFromRequest(env, request) {
  try { await warmBillingCfg(env && env.MAIK_KV); } catch (e) {}   // refresh live promo/flags (cached 30s)
  // Read-only hot gate: verify the token, decide Pro from its claims (promo → paid → trial). A guest
  // (no/invalid token) is Pro ONLY during the launch promo. The trial clock is stamped in
  // entitlementFor (the /billing/status path), not here, so this gate never writes.
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return { pro: promoActive(env), uid: null, claims: null };
  const verified = await verifiedClaimsFor(request, env);   // RS256 + aud/iss/exp, memoised per request (T52)
  const uid = verified && verified.sub;
  if (!uid) return { pro: promoActive(env), uid: null, claims: null };
  const claims = verified;
  return { pro: isPro(env, claims), uid, claims };
}

// Hard gate for Pro-only server features (Ward Sync sign-in, Lab Watch, cross-device case sync).
// { ok:true } when allowed; the caller replies needsProBody() with 402 when ok is false.
//
// It now also reports WHY. "You need Pro" is the wrong thing to tell an unverified doctor: what
// they need is to upload a certificate, and sending them to a payment sheet instead reads as the
// app being broken. The reason travels to the client so the client can offer the right button.
export async function requirePro(env, request) {
  const { pro, uid, claims } = await proFromRequest(env, request);
  const st = entitlementState(env, claims || {});
  return {
    ok: !!pro, pro: !!pro, uid,
    reason: pro ? null : (st.reason || "none"),
    verified: !!st.verified,
    pendingReview: !!st.pendingReview,
  };
}

// The one wording of each refusal, so eleven endpoints cannot drift into eleven different answers.
export function proMessageFor(reason) {
  if (reason === "unverified") {
    return "This feature needs a verified medical registration. Verify your NMC or State Medical Council registration to unlock it, free for 7 days.";
  }
  if (reason === "verified-week-expired") {
    return "Your free Pro week has ended. Subscribe to keep using Pro features.";
  }
  return "This is a StewardMD Pro feature.";
}

// The 402 body every Pro-gated endpoint should return. `extra` merges in anything endpoint-specific.
export function needsProBody(gate, extra) {
  const g = gate || {};
  const reason = g.reason || "none";
  return Object.assign({
    error: "needs-pro", needsPro: true, reason,
    verified: !!g.verified, pendingReview: !!g.pendingReview,
    message: proMessageFor(reason),
  }, extra || {});
}
