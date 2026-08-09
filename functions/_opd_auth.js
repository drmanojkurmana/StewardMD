/* functions/_opd_auth.js — StewardMD-native staff auth (Phase 5): email + PIN, GHIS-independent.
 *
 * Private-clinic staff sign in with an owner-issued email+password OR a clinic-scoped PIN — no GHIS, no
 * StewardMD app account. Both mint a short-lived signed staff session (reusing the queue token HMAC).
 * Secrets are PBKDF2-hashed (never plaintext); PIN attempts are rate-limited + locked out. Authorization
 * is ALWAYS org-membership (q_members) server-side — a session only proves identity, never authority.
 *
 * PURE parts (pinLocked / nextPinState / lockout constants) are unit-tested; hashing uses WebCrypto
 * (Workers + node 18+). No hard-coded admin/GHIS ids anywhere.
 */
import { signToken, verifyToken, idFromToken, queueSecret } from "./_queue.js";

const enc = new TextEncoder();
function b64u(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(str) { let s = String(str).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

// ---- secret hashing (PBKDF2-SHA256; never store plaintext) --------------------------------------
export function genSalt() { return b64u(crypto.getRandomValues(new Uint8Array(16))); }
export async function hashSecret(secret, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secret)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unb64u(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
  return b64u(new Uint8Array(bits));
}
export async function verifySecret(secret, salt, hash) {
  if (!secret || !salt || !hash) return false;
  const h = await hashSecret(secret, salt);
  // length-safe constant-ish compare
  if (h.length !== String(hash).length) return false;
  let diff = 0; for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ String(hash).charCodeAt(i);
  return diff === 0;
}

// ---- PIN rate-limit / lockout (PURE state machine) ----------------------------------------------
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;
export function pinLocked(member, now) {
  const until = (member && member.pinLockedUntil) || 0;
  return { locked: until > now, until: until, remainingMs: Math.max(0, until - now) };
}
// Returns the fields to persist after an attempt. On success -> reset. On failure -> increment; lock at max.
export function nextPinState(member, now, success) {
  if (success) return { pinAttempts: 0, pinLockedUntil: 0 };
  const attempts = ((member && member.pinAttempts) || 0) + 1;
  return attempts >= PIN_MAX_ATTEMPTS ? { pinAttempts: attempts, pinLockedUntil: now + PIN_LOCK_MS } : { pinAttempts: attempts, pinLockedUntil: 0 };
}

// ---- staff session token (identity only — authority comes from q_members) -----------------------
const STAFF_TTL_MS = 12 * 3600 * 1000;
export async function mintStaffSession(env, orgId, identity, nowMs) {
  return signToken({ id: String(orgId) + "~" + String(identity), exp: (nowMs || 0) + STAFF_TTL_MS, ver: 1 }, queueSecret(env));
}
export async function verifyStaffSession(env, token, nowMs) {
  const v = await verifyToken(token, queueSecret(env), 1, nowMs || 0);
  if (!v || !v.ok) return null;
  const raw = idFromToken(token); const i = String(raw).indexOf("~");
  if (i < 0) return null;
  return { orgId: raw.slice(0, i), identity: raw.slice(i + 1) };
}
