// functions/api/license.js — StewardMD native-only license / activation endpoint (native-only lock, Phase 2a).
//
// The native app calls this on launch (and roughly every 2h) with the signed-in user's login. If the user is
// Pro, the server returns the app's KB/engine DECRYPTION KEY + a 2h grace, so the on-device (encrypted) KB can
// run. No Pro -> no key -> the app stays locked. This is the server-side gate that makes "works only if the
// server allows it" real: because the KB/engine is encrypted in the bundle (Phase 2b), the key is the only way
// to run it, and the key is issued only here, only to a live authenticated Pro account.
//
// PHI-free. Owner accounts are always Pro. // VERIFY (Phase 3): isPro() must consult real IAP receipts
// (Play Billing + App Store Server API), not just the owner list + env allowlist stub below.
import { identify } from "../_usage.js";
import { ownerEmails } from "../_adminauth.js";
import { entitlementFor } from "../_entitlement.js";

const GRACE_SECONDS = 2 * 60 * 60;   // 2h offline grace (owner-chosen)

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", "pragma": "no-cache" },
  });
}

// Entitled to run the app? Owner emails always are, then a test/comp allowlist, then the REAL Pro entitlement
// (entitlementFor -> the Firebase pro claim granted by Razorpay / IAP / an admin comp, which also honours the
// launch promo PRO_FREE_UNTIL: everyone is Pro until that instant, then only real subscribers). So the native
// lock unlocks for everyone during the free-launch window and for paid subscribers after it -- the owner moves
// the cutoff via PRO_FREE_UNTIL, with no code change.
async function isPro(who, env) {
  try {
    const email = (who && who.email) ? String(who.email).toLowerCase() : "";
    if (email && ownerEmails(env).indexOf(email) > -1) return true;                       // owner: always
    const allow = (env && env.LICENSE_PRO_EMAILS ? String(env.LICENSE_PRO_EMAILS).split(",") : [])
      .map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (email && allow.indexOf(email) > -1) return true;                                   // test / comp allowlist
    const uid = (who && who.id && who.id.indexOf("fb:") === 0) ? who.id.slice(3) : null;   // identify() -> "fb:<uid>"
    if (uid) { const e = await entitlementFor(env, uid); return !!(e && e.pro); }
    return false;
  } catch (e) { return false; }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ error: "method" }, 405);

  let who = null;
  try { who = await identify(request, env); } catch (e) { who = null; }
  // identify() -> { id, guest, email }: Cf-Access (verified header) or Firebase (verified token) only; a guest
  // (ip:hash) or missing id is never entitled. The email is server-derived, never a request-body value.
  if (!who || who.guest || !who.id) return json({ error: "auth" }, 401);
  if (!(await isPro(who, env))) return json({ ok: false, pro: false, error: "not_pro" }, 402);

  // Authorized. Deliver the KB/engine decryption key (set as the Pages secret APP_KB_KEY once Phase 2b's
  // build-time encryption is on) + the 2h grace. Until APP_KB_KEY exists, we return the entitlement with no
  // key (the app still runs its unencrypted bundle), so this endpoint is safe to ship ahead of the encryption.
  const now = Date.now();
  const out = { ok: true, pro: true, graceSeconds: GRACE_SECONDS, issuedAt: now, expiresAt: now + GRACE_SECONDS * 1000 };
  if (env && env.APP_KB_KEY) out.key = String(env.APP_KB_KEY);   // per-release symmetric key; only ever reaches a Pro user
  return json(out);
}
