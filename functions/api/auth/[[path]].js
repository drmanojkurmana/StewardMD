/* StewardMD — email verification OTP (Cloudflare Pages Function). Additive; the app uses Firebase
 * Email/Password for the account itself, and this endpoint layers a branded Resend one-time code to
 * confirm the user owns the email during sign-up.
 *
 * Routes (both require a valid Firebase ID token — the caller's own account):
 *   POST /api/auth/send-otp     -> generates a 6-digit code, stores it in KV (10-min TTL,
 *                                  30s resend throttle), emails it via Resend to the TOKEN's email.
 *   POST /api/auth/verify-otp   body { code } -> checks code/expiry/attempts; on success clears the
 *                                  code, best-effort sets the `emailVerified` custom claim, returns ok.
 *
 * The OTP is keyed by uid and sent only to the email inside the verified token, so a token can't be
 * used to spam codes to arbitrary addresses. Storage: CASES_KV (falls back to GHIS_KV), same as the
 * doctor-verification records. No PII beyond the account email is stored, and it self-expires.
 */
import { verifyFirebaseToken } from "../../_fbauth.js";
import { mergeUserClaims, lookupUidByEmail, setUserPassword } from "../../_fbadmin.js";
import { emailOtp, emailResetCode, emailTempPassword } from "../../_email.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const TTL = 600;            // 10 minutes
const RESEND_THROTTLE = 30; // seconds between OTP sends
const RESET_THROTTLE = 60;  // seconds between password-reset requests per email
const MAX_TRIES = 5;

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }
function otpKey(uid) { return "otp:email:" + uid; }
function now() { return Math.floor(Date.now() / 1000); }
function gen6() { var a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 1000000).padStart(6, "0"); }
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "")); }
// Strong, copy-friendly temp password (unambiguous alphabet — no 0/O/1/l/I).
function genTempPassword() {
  var A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  var n = 14, a = new Uint32Array(n); crypto.getRandomValues(a);
  var s = ""; for (var i = 0; i < n; i++) s += A[a[i] % A.length];
  return s;
}

// Decode the (already cryptographically-verified) token payload to read the account email + name.
function tokenPayload(tok) {
  try {
    var p = String(tok || "").split(".")[1];
    var s = atob(p.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(s)));
  } catch (e) { return {}; }
}

async function authed(request, env) {
  var tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  var uid = await verifyFirebaseToken(tok, env);
  if (!uid) return null;
  var p = tokenPayload(tok);
  return { uid: uid, email: (p.email || "").toLowerCase(), name: p.name || p.displayName || "" };
}

export async function onRequestPost(context) {
  try {
    return await handle(context);
  } catch (e) {
    // never surface a raw platform error; 500 (not 502) passes through Cloudflare with our JSON body
    try { console.warn("[auth] exception:", String((e && (e.stack || e.message)) || e)); } catch (x) {}
    return json({ ok: false, error: "server-error" }, 500);
  }
}

async function handle(context) {
  var request = context.request, env = context.env;
  var store = kv(env);
  if (!store) return json({ ok: false, error: "kv-unavailable" }, 500);

  var route = (context.params && context.params.path) || [];
  var action = Array.isArray(route) ? route[0] : route;

  // Password-reset is UNAUTHENTICATED (the user is locked out, so there's no token). Both paths are
  // enumeration-safe (always a generic ok) and rate-limited per email.
  if (action === "reset-request") return resetRequest(request, env, store);
  if (action === "reset-verify") return resetVerify(request, env, store);

  var who = await authed(request, env);
  if (!who) return json({ ok: false, error: "signin-required" }, 401);
  if (!who.email) return json({ ok: false, error: "no-email-on-account" }, 400);

  if (action === "send-otp") {
    var existing = null;
    try { existing = await store.get(otpKey(who.uid), "json"); } catch (e) {}
    if (existing && existing.sentAt && (now() - existing.sentAt) < RESEND_THROTTLE) {
      return json({ ok: false, error: "too-soon", retryAfter: RESEND_THROTTLE - (now() - existing.sentAt) }, 429);
    }
    var code = gen6();
    var rec = { code: code, email: who.email, exp: now() + TTL, tries: 0, sentAt: now() };
    try { await store.put(otpKey(who.uid), JSON.stringify(rec), { expirationTtl: TTL }); } catch (e) { return json({ ok: false, error: "store-failed" }, 500); }
    var sent = await emailOtp(env, { email: who.email, name: who.name, code: code, minutes: 10 });
    if (!sent || sent.ok === false) {
      // Soft-fail with 200 + ok:false so the client can show "tap Resend". NOTE: must NOT use a 502
      // here — Cloudflare's edge replaces any 502 from a Function with its own error page, so the
      // JSON never reaches the client. The code stays stored (resend re-sends the same-window code).
      return json({ ok: false, error: "email-failed" });
    }
    return json({ ok: true, sent: true, ttl: TTL, to: who.email.replace(/^(.).*(@.*)$/, "$1***$2") });
  }

  if (action === "verify-otp") {
    var body = {};
    try { body = await request.json(); } catch (e) {}
    var code = String((body && body.code) || "").replace(/\D/g, "");
    if (code.length !== 6) return json({ ok: false, error: "bad-code" }, 400);
    var rec = null;
    try { rec = await store.get(otpKey(who.uid), "json"); } catch (e) {}
    if (!rec) return json({ ok: false, error: "expired" }, 400);
    if (rec.exp && now() > rec.exp) { try { await store.delete(otpKey(who.uid)); } catch (e) {} return json({ ok: false, error: "expired" }, 400); }
    if ((rec.tries || 0) >= MAX_TRIES) { try { await store.delete(otpKey(who.uid)); } catch (e) {} return json({ ok: false, error: "locked" }, 429); }
    if (String(rec.code) !== code) {
      rec.tries = (rec.tries || 0) + 1;
      try { await store.put(otpKey(who.uid), JSON.stringify(rec), { expirationTtl: Math.max(1, (rec.exp || now()) - now()) }); } catch (e) {}
      return json({ ok: false, error: "mismatch", triesLeft: Math.max(0, MAX_TRIES - rec.tries) }, 400);
    }
    // success
    try { await store.delete(otpKey(who.uid)); } catch (e) {}
    try { await mergeUserClaims(env, who.uid, { emailVerified: true }); } catch (e) {}   // best-effort; client also flags it in profile
    return json({ ok: true, verified: true });
  }

  return json({ ok: false, error: "not-found" }, 404);
}

// ---- forgot password (unauthenticated) ---------------------------------------------------
// Always returns a generic { ok:true } for a valid email format so callers can't enumerate which
// addresses have accounts. Rate-limited per email. mode:"temp" emails an auto-generated password;
// otherwise emails a 6-digit code the user redeems in reset-verify with a new password of their own.
async function resetRequest(request, env, store) {
  var body = {}; try { body = await request.json(); } catch (e) {}
  var email = String((body && body.email) || "").trim().toLowerCase();
  var mode = (body && body.mode) === "temp" ? "temp" : "otp";
  if (!validEmail(email)) return json({ ok: false, error: "bad-email" }, 400);
  var dbg = false; try { dbg = new URL(request.url).searchParams.get("debug") === "1"; } catch (e) {}
  var generic = json({ ok: true, sent: true });

  var rlKey = "reset:rl:" + email;
  try { var rl = await store.get(rlKey, "json"); if (rl && rl.at && (now() - rl.at) < RESET_THROTTLE) return generic; } catch (e) {}

  var uid = null;
  try { var found = await lookupUidByEmail(env, email); uid = found && found.uid; } catch (e) {}  // returns {uid,email,name}
  if (!uid) return generic;                                  // no account → still generic (no enumeration)
  try { await store.put(rlKey, JSON.stringify({ at: now() }), { expirationTtl: RESET_THROTTLE }); } catch (e) {}

  if (mode === "temp") {
    var pw = genTempPassword();
    try { await setUserPassword(env, uid, pw); } catch (e) { var d = String((e && e.message) || e); try { console.warn("[reset:temp] setpw failed:", d); } catch (x) {} return dbg ? json({ ok: false, error: "setpw-failed", detail: d.slice(0, 300) }) : generic; }
    try { await emailTempPassword(env, { email: email, password: pw }); } catch (e) {}
  } else {
    var code = gen6();
    try { await store.put("reset:otp:" + email, JSON.stringify({ code: code, uid: uid, exp: now() + TTL, tries: 0 }), { expirationTtl: TTL }); } catch (e) {}
    try { await emailResetCode(env, { email: email, code: code, minutes: 10 }); } catch (e) {}
  }
  return generic;
}

// Redeem a reset code + set the user's chosen new password.
async function resetVerify(request, env, store) {
  var body = {}; try { body = await request.json(); } catch (e) {}
  var email = String((body && body.email) || "").trim().toLowerCase();
  var code = String((body && body.code) || "").replace(/\D/g, "");
  var newPassword = String((body && body.newPassword) || "");
  if (!validEmail(email) || code.length !== 6) return json({ ok: false, error: "bad-code" }, 400);
  if (newPassword.length < 8) return json({ ok: false, error: "weak-password" }, 400);

  var key = "reset:otp:" + email, rec = null;
  try { rec = await store.get(key, "json"); } catch (e) {}
  if (!rec) return json({ ok: false, error: "expired" }, 400);
  if (rec.exp && now() > rec.exp) { try { await store.delete(key); } catch (e) {} return json({ ok: false, error: "expired" }, 400); }
  if ((rec.tries || 0) >= MAX_TRIES) { try { await store.delete(key); } catch (e) {} return json({ ok: false, error: "locked" }, 429); }
  if (String(rec.code) !== code) {
    rec.tries = (rec.tries || 0) + 1;
    try { await store.put(key, JSON.stringify(rec), { expirationTtl: Math.max(1, (rec.exp || now()) - now()) }); } catch (e) {}
    return json({ ok: false, error: "mismatch", triesLeft: Math.max(0, MAX_TRIES - rec.tries) }, 400);
  }
  try { await setUserPassword(env, rec.uid, newPassword); } catch (e) { return json({ ok: false, error: "set-failed" }, 500); }
  try { await store.delete(key); } catch (e) {}
  return json({ ok: true, reset: true });
}
