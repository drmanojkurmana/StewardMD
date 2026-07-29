/* StewardMD — unified admin authorization (shared).
 * One owner Google login controls every admin surface (notifications, verifications,
 * lab-watch, push). Accepts EITHER:
 *   • Authorization: Bearer <Firebase ID token> whose email ∈ OWNER_EMAILS, OR
 *   • X-Admin-Token matching UPDATES_ADMIN_TOKEN or VERIFY_ADMIN_TOKEN (legacy fallback).
 * OWNER_EMAILS (comma-separated) overrides the default owner list.
 */
import { verifyFirebaseToken } from "./_fbauth.js";

const OWNER_EMAILS_DEFAULT = ["drmanojkurmana@gmail.com", "mkkmanojkumar0@gmail.com", "kdiwakar45@gmail.com"];

export function ownerEmails(env) {
  return (env.OWNER_EMAILS ? String(env.OWNER_EMAILS).split(",") : OWNER_EMAILS_DEFAULT)
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
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
