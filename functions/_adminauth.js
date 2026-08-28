/* StewardMD — unified admin authorization (shared).
 * One owner Google login controls every admin surface (notifications, verifications,
 * lab-watch, push). Accepts EITHER:
 *   • Authorization: Bearer <Firebase ID token> whose email ∈ OWNER_EMAILS, OR
 *   • X-Admin-Token matching UPDATES_ADMIN_TOKEN or VERIFY_ADMIN_TOKEN (legacy fallback).
 * OWNER_EMAILS (comma-separated) ADDS to the built-in owner list — the two are UNIONED, so the built-in
 * owners always work even if a stale/partial OWNER_EMAILS env is set in the Cloudflare dashboard.
 */
import { verifyFirebaseToken } from "./_fbauth.js";

/* stewardmd.in@gmail.com was REMOVED: the owner describes that account as "a medical college who is
 * buying my product", i.e. a customer. Leaving it here made it a platform owner - able to read every
 * tenant and mint institutions - and it also meant the tenant-isolation test proved nothing, because
 * the "customer" it tested with could reach everything by another route. Add it back through the
 * OWNER_EMAILS env var if that was deliberate; env can add owners, never remove them. */
const OWNER_EMAILS_DEFAULT = ["drmanojkurmana@gmail.com", "mkkmanojkumar0@gmail.com", "kdiwakar45@gmail.com"];

export function ownerEmails(env) {
  const fromEnv = (env && env.OWNER_EMAILS) ? String(env.OWNER_EMAILS).split(",") : [];
  const all = OWNER_EMAILS_DEFAULT.concat(fromEnv).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(all));   // union of built-in defaults + env; env can add owners, never remove
}
export function emailFromToken(idToken) {
  try {
    const p = String(idToken).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return String(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), (c) => c.charCodeAt(0)))).email || "").toLowerCase();
  } catch (e) { return ""; }
}
function tokenMatch(got, want) {
  if (!want || !got || got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

// → true if the caller is an owner (Google login) or holds a valid legacy admin token.
export async function ownerOK(request, env) {
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer) {
    const uid = await verifyFirebaseToken(bearer, env);
    if (uid) {
      const email = emailFromToken(bearer);
      if (email && ownerEmails(env).indexOf(email) > -1) return true;
    }
  }
  const tok = request.headers.get("X-Admin-Token") || "";
  if (tokenMatch(tok, env.UPDATES_ADMIN_TOKEN)) return true;
  if (tokenMatch(tok, env.VERIFY_ADMIN_TOKEN)) return true;
  return false;
}
