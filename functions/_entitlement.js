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

const PROMO_UNTIL_DEFAULT = Date.parse("2026-09-15T23:59:59+05:30");   // 15 Sep 2026, 23:59 IST

export function promoUntil(env) {
  const v = env && env.PRO_FREE_UNTIL;
  if (v) { const t = /^\d+$/.test(String(v)) ? +v : Date.parse(v); if (t) return t; }
  return PROMO_UNTIL_DEFAULT;
}
export function promoActive(env, now) { return (now || Date.now()) < promoUntil(env); }

// Decide Pro from a caller's token claims (+ the launch promo). `claims` = the custom-claim object
// (has `pro` and optional `proExp` ms). Used by requirePro on hot endpoints (reads the token — fast).
export function isPro(env, claims, now) {
  now = now || Date.now();
  if (promoActive(env, now)) return true;
  if (claims && claims.pro === true && (!claims.proExp || +claims.proExp > now)) return true;
  return false;
}
export function entitlementState(env, claims, now) {
  now = now || Date.now();
  if (promoActive(env, now)) return { pro: true, source: "launch-promo", until: promoUntil(env), promo: true };
  const paid = !!(claims && claims.pro === true && (!claims.proExp || +claims.proExp > now));
  return { pro: paid, source: paid ? (claims.source || "subscription") : "none", until: paid ? (claims.proExp || null) : null, promo: false };
}

// Authoritative (fresh) entitlement for a uid — does a server-side claims lookup, so it reflects a
// grant immediately even before the client's ID token refreshes. Use for /billing/status, not hot gates.
export async function entitlementFor(env, uid) {
  if (!uid) return entitlementState(env, null);
  let claims = {};
  try { claims = await getUserClaims(env, uid); } catch (e) {}
  return entitlementState(env, claims);
}

// Grant / extend Pro for a uid (from a verified purchase, or an owner comp). Clobber-safe: keeps any
// existing claims (e.g. `verified`). Extends from the current expiry if still in the future.
export async function grantPro(env, uid, opts) {
  opts = opts || {};
  const now = Date.now();
  const months = Math.max(1, +opts.months || 1);
  let base = now;
  try { const cur = await getUserClaims(env, uid); if (cur && cur.pro && +cur.proExp > now) base = +cur.proExp; } catch (e) {}
  const proExp = base + months * 30 * 24 * 3600 * 1000;
  await mergeUserClaims(env, uid, { pro: true, proExp, source: String(opts.source || "manual").slice(0, 40) });
  return { ok: true, uid, proExp, months };
}
// Revoke Pro (refund/chargeback/expiry cleanup).
export async function revokePro(env, uid) {
  await mergeUserClaims(env, uid, { pro: null, proExp: null, source: null });
  return { ok: true, uid };
}
