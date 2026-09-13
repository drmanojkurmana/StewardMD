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

// The same machine for email + password sign-in, stored in its own fields so a PIN lockout and a
// password lockout never reset each other. Email sign-in had no attempt limit at all.
export function passLocked(member, now) { return pinLocked({ pinLockedUntil: member && member.passLockedUntil }, now); }
export function nextPassState(member, now, success) {
  const s = nextPinState({ pinAttempts: member && member.passAttempts }, now, success);
  return { passAttempts: s.pinAttempts, passLockedUntil: s.pinLockedUntil };
}

// ---- credential policy (PURE). Returns a plain sentence for the admin, or null when acceptable. ---
// ponytail: a short blocklist, not a breach corpus; add a k-anonymity breach check when there is a budget for the call.
const COMMON_PASSWORDS = new Set(["password", "password1", "password123", "1234567890", "qwertyuiop", "welcome123", "admin12345", "hospital123", "abcdefghij", "iloveyou12"]);
export function passwordProblem(password, email) {
  const p = String(password || "");
  if (p.length < 10) return "Use at least 10 characters.";
  if (/^(.)\1+$/.test(p)) return "A password cannot be one character repeated.";
  if (COMMON_PASSWORDS.has(p.toLowerCase())) return "That password is too common. Choose another.";
  const local = String(email || "").toLowerCase().split("@")[0];
  if (local.length >= 3 && p.toLowerCase().includes(local)) return "A password cannot contain the email name.";
  return null;
}
export function pinProblem(pin) {
  const p = String(pin || "");
  if (!/^\d{4,8}$/.test(p)) return "A PIN is 4 to 8 digits.";
  if (/^(\d)\1+$/.test(p)) return "A PIN cannot be one digit repeated.";
  if ("01234567890".includes(p) || "09876543210".includes(p)) return "A PIN cannot be a run of consecutive digits.";
  return null;
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
  // issuedAt is derived from the signed expiry, so it cannot be forged without the secret.
  return { orgId: raw.slice(0, i), identity: raw.slice(i + 1), issuedAt: v.exp - STAFF_TTL_MS };
}
// PURE. A session issued before the member's sessions were revoked (reset, disable, new PIN or
// password) is dead, even though its signature and expiry are still good.
export function sessionRevoked(session, member) {
  const at = Number(member && member.sessionsRevokedAt) || 0;
  return at > 0 && Number(session && session.issuedAt) < at;
}

// ---- two-step sign-in: authenticator codes (RFC 6238 TOTP: HMAC-SHA1, 30 s, 6 digits) ------------
// Works with any standard authenticator app. The secret is 20 random bytes shown once as base32.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(u8) {
  let bits = 0, value = 0, out = "";
  for (const b of u8) { value = ((value << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const s = String(str || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of s) { const i = B32.indexOf(ch); if (i < 0) return null; value = ((value << 5) | i) & 0xffff; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export function newTotpSecret() { return base32Encode(crypto.getRandomValues(new Uint8Array(20))); }
export const TOTP_STEP_MS = 30000;
export async function totpAt(secretB32, step) {
  const key = await crypto.subtle.importKey("raw", base32Decode(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8); let n = step;
  for (let i = 7; i >= 0; i--) { msg[i] = n & 255; n = Math.floor(n / 256); }
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[19] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1000000).padStart(6, "0");
}
/* One step either side for phone clock drift. Returns the matched step, or 0. A step at or before
  * lastStep is refused, so a code read over a shoulder cannot be used a second time. */
export async function verifyTotp(secretB32, code, nowMs, lastStep) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c) || !base32Decode(secretB32)) return 0;
  const cur = Math.floor(nowMs / TOTP_STEP_MS);
  for (const s of [cur - 1, cur, cur + 1]) { if (s > (Number(lastStep) || 0) && (await totpAt(secretB32, s)) === c) return s; }
  return 0;
}
export function otpauthUri(secretB32, account, issuer) {
  const iss = issuer || "WardSynQ";
  return "otpauth://totp/" + encodeURIComponent(iss + ":" + account) + "?secret=" + secretB32 + "&issuer=" + encodeURIComponent(iss) + "&algorithm=SHA1&digits=6&period=30";
}
// Backup codes: 10 base32 characters (50 bits), shown once, stored only as SHA-256.
export function newRecoveryCodes(n) { return Array.from({ length: n || 8 }, () => base32Encode(crypto.getRandomValues(new Uint8Array(7))).slice(0, 10)); }
export async function hashRecoveryCode(code) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(String(code || "").toUpperCase().replace(/[\s-]/g, "")));
  return b64u(new Uint8Array(d));
}
// The second-step ticket: 5 minutes, signed with ver 2 so it can never pass as a staff session (ver 1).
const MFA_CHALLENGE_MS = 5 * 60 * 1000;
export async function mintMfaChallenge(env, orgId, identity, nowMs) {
  return signToken({ id: String(orgId) + "~" + String(identity), exp: (nowMs || 0) + MFA_CHALLENGE_MS, ver: 2 }, queueSecret(env));
}
export async function verifyMfaChallenge(env, token, nowMs) {
  const v = await verifyToken(token, queueSecret(env), 2, nowMs || 0);
  if (!v || !v.ok) return null;
  const raw = idFromToken(token); const i = String(raw).indexOf("~");
  return i < 0 ? null : { orgId: raw.slice(0, i), identity: raw.slice(i + 1) };
}
