/* functions/_iap.js — store In-App-Purchase verification for the native-only lock (Phase 3).
 *
 * Verifies a Play / App Store SUBSCRIPTION purchase SERVER-SIDE and reports { valid, expiresAt }, so the
 * caller (functions/api/billing/[[path]].js) can grantPro() into the SAME entitlement store Razorpay + admin
 * comps already use. The actual store API calls live behind per-platform seams gated on the owner's
 * credentials; until those are set the verify() returns { configured:false } and the route replies 501 —
 * it NEVER returns valid:true without a real store confirmation (no fake grants).
 *
 * OWNER PROVISIONING (then the seams below become live):
 *   Google Play: env GOOGLE_PLAY_SA_JSON (service-account JSON) + GOOGLE_PLAY_PACKAGE (in.stewardmd.app).
 *   Apple:       env APPLE_ASC_KEY (.p8 contents) + APPLE_ASC_KEY_ID + APPLE_ASC_ISSUER + APPLE_BUNDLE_ID.
 * Plus a native billing plugin on the client (Play Billing / StoreKit) that makes the purchase and POSTs the
 * token/transaction to /api/billing/iap/verify. See docs/native-only-lock.md.
 */

export function iapConfigured(env, platform) {
  if (platform === "google") return !!(env && env.GOOGLE_PLAY_SA_JSON && env.GOOGLE_PLAY_PACKAGE);
  if (platform === "apple") return !!(env && env.APPLE_ASC_KEY && env.APPLE_ASC_KEY_ID && env.APPLE_ASC_ISSUER && env.APPLE_BUNDLE_ID);
  return false;
}

// Verify a purchase. -> { configured, valid, expiresAt?, source, reason? }. Fail-closed: any error/unknown
// platform/absent creds => not valid (the route then 501s or 402s; a purchase is never trusted client-side).
export async function verifyPurchase(env, purchase, io) {
  io = io || {};
  const fetchFn = io.fetch || (typeof fetch !== "undefined" ? fetch : null);
  const platform = purchase && purchase.platform;
  if (platform !== "google" && platform !== "apple") return { configured: false, valid: false, reason: "unknown-platform" };
  if (!iapConfigured(env, platform)) return { configured: false, valid: false, reason: "not-configured" };
  try {
    return platform === "google" ? await verifyGooglePlay(env, purchase, fetchFn) : await verifyAppStore(env, purchase, fetchFn);
  } catch (e) { return { configured: true, valid: false, reason: "verify-error" }; }
}

// Google Play subscriptions — purchases.subscriptionsv2.get.
// VERIFY (owner completes): mint an OAuth access token from GOOGLE_PLAY_SA_JSON (build an RS256 JWT with
// scope https://www.googleapis.com/auth/androidpublisher, exchange it at https://oauth2.googleapis.com/token),
// then GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{GOOGLE_PLAY_PACKAGE}/
// purchases/subscriptionsv2/tokens/{purchaseToken}. Read subscriptionState (ACTIVE/IN_GRACE => valid) and
// lineItems[0].expiryTime -> expiresAt. Return { configured:true, valid, expiresAt, source:"google-play" }.
async function verifyGooglePlay(env, purchase, fetchFn) {
  return { configured: true, valid: false, reason: "google-adapter-not-wired" };   // seam: implement per the note above
}

// Apple App Store Server API — GET /inApps/v1/subscriptions/{transactionId}.
// VERIFY (owner completes): sign an ES256 JWT with APPLE_ASC_KEY/KEY_ID/ISSUER (bundle APPLE_BUNDLE_ID), call
// https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/{transactionId} (sandbox host for test), decode
// the JWS signedTransactionInfo -> expiresDate + status. Return { configured:true, valid, expiresAt, source:"app-store" }.
async function verifyAppStore(env, purchase, fetchFn) {
  return { configured: true, valid: false, reason: "apple-adapter-not-wired" };    // seam: implement per the note above
}

// Days of Pro to grant from a store expiry (ms epoch). Grants up to the store's expiry (>= 1 day).
export function daysFromExpiry(expiresAtMs, now) {
  now = now || Date.now();
  const d = Math.ceil((Number(expiresAtMs) - now) / (24 * 3600 * 1000));
  return Math.max(1, isFinite(d) ? d : 1);
}
