/* StewardMD - signed unsubscribe tokens for marketing email.
 *
 * Every marketing email carries a link and a List-Unsubscribe header that identify the recipient
 * WITHOUT exposing the uid or needing a sign-in: the token is base64url(uid) + "." + HMAC-SHA256 of
 * the uid under UNSUB_SECRET (falls back to RESEND_API_KEY, which is always present when an email can
 * be sent at all). A forged or truncated token verifies to null and does nothing.
 *
 * Pure WebCrypto, no state. Tested in test/email-template.test.mjs.
 */

const APP = "https://stewardmd.in";

function key(env) { return (env && (env.UNSUB_SECRET || env.RESEND_API_KEY)) || ""; }
function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch (e) { return null; }
}
async function mac(secret, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}

// -> token string, or "" when no secret is configured (the email then simply carries no link).
export async function unsubToken(env, uid) {
  const secret = key(env);
  if (!secret || !uid) return "";
  const u = new TextEncoder().encode(String(uid));
  return b64u(u) + "." + b64u(await mac(secret, String(uid)));
}

// -> uid for a genuine token, else null. Constant-time compare on the MAC.
export async function unsubUid(env, token) {
  const secret = key(env);
  const parts = String(token || "").split(".");
  if (!secret || parts.length !== 2) return null;
  const u = unb64u(parts[0]), sig = unb64u(parts[1]);
  if (!u || !sig || !u.length) return null;
  const uid = new TextDecoder().decode(u);
  const want = await mac(secret, uid);
  if (want.length !== sig.length) return null;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want[i] ^ sig[i];
  return d === 0 ? uid : null;
}

export function unsubUrl(token) { return token ? APP + "/api/unsubscribe?t=" + encodeURIComponent(token) : ""; }
