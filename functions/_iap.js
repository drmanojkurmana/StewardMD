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

// ---- crypto / encoding helpers (pure; unit-tested) ---------------------------------------------
export function b64url(bytes) {
  let s = ""; const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlStr(str) { return b64url(new TextEncoder().encode(str)); }
export function b64urlDecodeToStr(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u);
}
// PEM (any label) -> DER ArrayBuffer.
export function pemToDer(pem) {
  const b64 = String(pem || "").replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
// Build + sign a JWT. alg "RS256" (RSASSA-PKCS1-v1_5) or "ES256" (ECDSA P-256). key is a PKCS8 PEM.
async function signJwt(header, claim, pem, alg, subtle) {
  subtle = subtle || (typeof crypto !== "undefined" && crypto.subtle);
  const signingInput = b64urlStr(JSON.stringify(header)) + "." + b64urlStr(JSON.stringify(claim));
  const algParams = alg === "ES256"
    ? { name: "ECDSA", namedCurve: "P-256" }
    : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const key = await subtle.importKey("pkcs8", pemToDer(pem), algParams, false, ["sign"]);
  const signParams = alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
  const sig = await subtle.sign(signParams, key, new TextEncoder().encode(signingInput));
  return signingInput + "." + b64url(new Uint8Array(sig));
}

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
  const token = purchase && (purchase.purchaseToken || purchase.receipt);
  if (!token) return { configured: true, valid: false, reason: "no-token" };
  let sa; try { sa = JSON.parse(env.GOOGLE_PLAY_SA_JSON); } catch (e) { return { configured: true, valid: false, reason: "bad-sa-json" }; }
  if (!sa.client_email || !sa.private_key) return { configured: true, valid: false, reason: "bad-sa-json" };
  // 1) Mint an OAuth access token from the service account (RS256 JWT bearer grant).
  const nowS = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    { alg: "RS256", typ: "JWT" },
    { iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: nowS, exp: nowS + 3600 },
    sa.private_key, "RS256");
  const tr = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(assertion),
  });
  const td = await tr.json();
  if (!tr.ok || !td.access_token) return { configured: true, valid: false, reason: "oauth-failed" };
  // 2) Look up the subscription purchase (subscriptionsv2).
  const url = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    encodeURIComponent(env.GOOGLE_PLAY_PACKAGE) + "/purchases/subscriptionsv2/tokens/" + encodeURIComponent(token);
  const sr = await fetchFn(url, { headers: { Authorization: "Bearer " + td.access_token } });
  const sd = await sr.json();
  if (!sr.ok) return { configured: true, valid: false, reason: "play-lookup-failed" };
  const state = sd.subscriptionState || "";
  const valid = state === "SUBSCRIPTION_STATE_ACTIVE" || state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
  const expiry = sd.lineItems && sd.lineItems.length ? sd.lineItems[sd.lineItems.length - 1].expiryTime : null;
  return { configured: true, valid: valid, expiresAt: expiry ? Date.parse(expiry) : null, source: "google-play", state: state };
}

// Apple App Store Server API — GET /inApps/v1/subscriptions/{transactionId}.
// VERIFY (owner completes): sign an ES256 JWT with APPLE_ASC_KEY/KEY_ID/ISSUER (bundle APPLE_BUNDLE_ID), call
// https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/{transactionId} (sandbox host for test), decode
// the JWS signedTransactionInfo -> expiresDate + status. Return { configured:true, valid, expiresAt, source:"app-store" }.
async function verifyAppStore(env, purchase, fetchFn) {
  const txId = purchase && (purchase.transactionId || purchase.purchaseToken || purchase.receipt);
  if (!txId) return { configured: true, valid: false, reason: "no-transaction-id" };
  const nowS = Math.floor(Date.now() / 1000);
  // Sign the App Store Server API token (ES256, aud appstoreconnect-v1, bundle id in `bid`).
  const jwt = await signJwt(
    { alg: "ES256", kid: env.APPLE_ASC_KEY_ID, typ: "JWT" },
    { iss: env.APPLE_ASC_ISSUER, iat: nowS, exp: nowS + 1800, aud: "appstoreconnect-v1", bid: env.APPLE_BUNDLE_ID },
    env.APPLE_ASC_KEY, "ES256");
  // Production host first; on 404 (transaction unknown there) retry sandbox — matches Apple's guidance.
  const hosts = ["https://api.storekit.itunes.apple.com", "https://api.storekit-sandbox.itunes.apple.com"];
  let sd = null, okHost = false;
  for (const h of hosts) {
    const r = await fetchFn(h + "/inApps/v1/subscriptions/" + encodeURIComponent(txId), { headers: { Authorization: "Bearer " + jwt } });
    if (r.ok) { sd = await r.json(); okHost = true; break; }
    if (r.status !== 404) return { configured: true, valid: false, reason: "apple-lookup-" + r.status };
  }
  if (!okHost || !sd) return { configured: true, valid: false, reason: "apple-not-found" };
  // data[].lastTransactions[].{status, signedTransactionInfo(JWS)}. status 1 = active, 2 = expired,
  // 3 = billing retry, 4 = grace, 5 = revoked. Active or grace => valid.
  const groups = sd.data || [];
  for (const g of groups) {
    for (const t of (g.lastTransactions || [])) {
      const active = t.status === 1 || t.status === 4;
      let expiresAt = null;
      try { const payload = JSON.parse(b64urlDecodeToStr(String(t.signedTransactionInfo || "").split(".")[1] || "")); expiresAt = payload.expiresDate ? +payload.expiresDate : null; } catch (e) {}
      if (active) return { configured: true, valid: true, expiresAt: expiresAt, source: "app-store", status: t.status };
    }
  }
  return { configured: true, valid: false, reason: "no-active-subscription", source: "app-store" };
}

// Days of Pro to grant from a store expiry (ms epoch). Grants up to the store's expiry (>= 1 day).
export function daysFromExpiry(expiresAtMs, now) {
  now = now || Date.now();
  const d = Math.ceil((Number(expiresAtMs) - now) / (24 * 3600 * 1000));
  return Math.max(1, isFinite(d) ? d : 1);
}
