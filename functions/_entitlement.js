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
import { verifyFirebaseToken } from "./_fbauth.js";

const PROMO_UNTIL_DEFAULT = Date.parse("2026-09-15T23:59:59+05:30");   // 15 Sep 2026, 23:59 IST

export function promoUntil(env) {
  const v = env && env.PRO_FREE_UNTIL;
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

// Decide Pro from a caller's token claims. Order: launch promo (master switch, everyone free until
// PRO_FREE_UNTIL) → paid subscription claim → active per-user trial. Restored 2026-08-16 from the
// launch free-for-all; still a no-op change WHILE the promo is active (returns true for all).
export function isPro(env, claims, now) {
  now = now || Date.now();
  if (promoActive(env, now)) return true;
  if (claims && claims.pro === true && (!claims.proExp || +claims.proExp > now)) return true;
  if (trialState(env, claims, now).active) return true;
  return false;
}
export function entitlementState(env, claims, now) {
  now = now || Date.now();
  const tr = trialState(env, claims, now);
  if (promoActive(env, now)) return { pro: true, source: "launch-promo", until: promoUntil(env), promo: true, trial: !!tr.active, trialEndsAt: tr.endsAt, daysLeft: tr.daysLeft };
  const paid = !!(claims && claims.pro === true && (!claims.proExp || +claims.proExp > now));
  if (paid) return { pro: true, source: (claims.source || "subscription"), until: (claims.proExp || null), promo: false, trial: false, trialEndsAt: tr.endsAt };
  if (tr.active) return { pro: true, source: "trial", until: tr.endsAt, promo: false, trial: true, trialEndsAt: tr.endsAt, daysLeft: tr.daysLeft };
  return { pro: false, source: "none", until: null, promo: false, trial: false, trialEndsAt: tr.endsAt, reason: tr.started ? "trial-expired" : "none" };
}

// Authoritative (fresh) entitlement for a uid — does a server-side claims lookup, so it reflects a
// grant immediately even before the client's ID token refreshes. Use for /billing/status, not hot gates.
export async function entitlementFor(env, uid) {
  if (!uid) return entitlementState(env, null);
  let claims = {};
  try { claims = await getUserClaims(env, uid); } catch (e) {}
  // Start the per-user trial clock on first status check (no pro, no trial yet). One write per new
  // account; done here (not on the hot proFromRequest gate) so gates stay read-only.
  try { if (!claims.pro && !claims.trialStart) { const ts = Date.now(); await mergeUserClaims(env, uid, { trialStart: ts }); claims.trialStart = ts; } } catch (e) {}
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

// Decode a JWT payload WITHOUT verifying (caller must verify the signature first).
function decodeJwtPayload(tok) {
  try {
    const p = String(tok || "").split(".")[1]; if (!p) return null;
    let s = p.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    const bin = atob(s); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(u));
  } catch (e) { return null; }
}

// Verify the caller's Firebase ID token and read its Pro entitlement (+ launch promo). Fast enough
// for hot endpoints (JWKS is cached in _fbauth). Returns { pro, uid, claims }. A guest (no/invalid
// token) is still Pro DURING the promo; once the promo ends a guest is never Pro. The pro claim is
// read from the token payload, trustworthy only because the signature is verified just above.
export async function proFromRequest(env, request) {
  // Read-only hot gate: verify the token, decide Pro from its claims (promo → paid → trial). A guest
  // (no/invalid token) is Pro ONLY during the launch promo. The trial clock is stamped in
  // entitlementFor (the /billing/status path), not here, so this gate never writes.
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return { pro: promoActive(env), uid: null, claims: null };
  const uid = await verifyFirebaseToken(tok, env);   // verifies RS256 signature + aud/iss/exp
  if (!uid) return { pro: promoActive(env), uid: null, claims: null };
  const claims = decodeJwtPayload(tok) || {};
  return { pro: isPro(env, claims), uid, claims };
}

// Hard gate for Pro-only server features (Ward Sync sign-in, Lab Watch, cross-device case sync).
// { ok:true } when allowed; the caller replies 402 { needsPro:true } when ok is false.
export async function requirePro(env, request) {
  const { pro, uid } = await proFromRequest(env, request);
  return { ok: !!pro, pro: !!pro, uid };
}
