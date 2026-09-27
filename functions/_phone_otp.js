/* StewardMD - mobile-number verification after sign-in: a 6-digit code over WhatsApp, SMS as backup.
 *
 * Owner request 2026-09-19: "after sign in ask every signup phone number verified by WhatsApp with
 * backup SMS". The routes live in functions/api/auth/[[path]].js (phone-start / phone-verify); this
 * module is the pure part: number normalisation, the delivery chain and the OTP record rules, so it
 * unit-tests without a network (test/phone-otp.test.mjs).
 *
 * Delivery chain (deliverOtp):
 *   channel "auto"      WhatsApp if a provider is configured and the send succeeds, else SMS.
 *   channel "sms"       SMS only (the "Send by SMS instead" button).
 *   channel "whatsapp"  WhatsApp only.
 * Providers are the FollowCare senders (_followcare_whatsapp.js / _followcare_sms.js), so no new
 * vendor is needed. With 2Factor, SMS goes as our own DLT OTP template (sendDlt, header MAIK). If
 * that is refused, 2Factor's OTP API is tried ONLY when TWOFACTOR_TEMPLATE_OTP names an approved
 * 2Factor OTP SMS template: without one that route delivers the code as a VOICE CALL (2Factor's
 * default), which is what doctors got instead of an SMS until 2026-09-28. Every other provider goes
 * through sendSms() with the code in var2 / the body. WhatsApp through the custom BSP fills
 * PHONE_OTP_WA_BODY when set (same {{to}} {{name}} {{link}} {{text}} tokens; the code is {{link}}),
 * else the FollowCare body.
 *
 * Send budget (owner 2026-09-26): at most 3 codes per account per 24 h, 2 by WhatsApp + 1 by SMS
 * (WA_MAX / SMS_MAX / SEND_WINDOW, record otp:phone:sends:<uid>). "auto" never falls back to a
 * spent channel; a 4th ask answers send-cap, a 2nd SMS answers sms-used. A failed delivery spends
 * nothing and does not start the 30 s throttle. The per-number DAILY_CAP still applies on top.
 *
 * PHONE_VERIFY_ON (default on): set 0 to make both routes answer { ok:false, error:"off" } without a
 * deploy. The client (phone-verify.js) then never asks.
 *
 * Nothing here is PHI: it is the doctor's own number, kept only in the OTP record (10-minute TTL)
 * and, once verified, on the lifecycle record.
 *
 * One number, one account (audit finding 14, 2026-09-26). The verified number is indexed
 * phone -> uid (functions/_lifecycle.js phoneIndexKey), keyed by phoneHash(), never the raw digits.
 * phone-start refuses { error:"phone-in-use" } BEFORE sending a code when the number is bound to a
 * different live account (deps.checkOwner); phone-verify re-checks and binds (deps.bind) before
 * the claim is written. The per-number daily-cap key is hashed the same way.
 */
import { sendWhatsApp, waConfigured } from "./_followcare_whatsapp.js";
import { sendSms, smsProvider, smsConfigured, sendDlt, dltConfigured } from "./_followcare_sms.js";

export const TTL = 600;              // the code lives 10 minutes
export const RESEND_THROTTLE = 30;   // seconds between sends to one account
export const MAX_TRIES = 5;          // wrong guesses before the code is burnt
export const DAILY_CAP = 6;          // codes per number per day: nobody gets SMS-bombed from our account
// Per-account send budget (owner 2026-09-26: "max 3 otp (wtsapp 2 plus 1 sms) tries per head"):
// 2 codes by WhatsApp + 1 by SMS per account per SEND_WINDOW. Counted per DELIVERED code on the
// channel that actually carried it (an auto send that fell back to SMS spends the SMS one).
export const WA_MAX = 2;
export const SMS_MAX = 1;
export const SEND_WINDOW = 86400;

export function phoneVerifyEnabled(env) {
  const v = env && env.PHONE_VERIFY_ON;
  if (v === undefined || v === null || v === "") return true;
  return !(String(v) === "0" || String(v) === "false");
}

// Digits with a country code. India-first: a bare 10-digit number gets 91; a leading 0 is dropped.
// Returns "" for anything that is not 10-15 digits after cleaning.
export function normalizePhone(raw, defaultCc) {
  let d = String(raw || "").replace(/[^\d]/g, "");
  if (d.length === 11 && d[0] === "0") d = d.slice(1);
  if (d.length === 10) d = String(defaultCc || "91") + d;
  if (d.length === 12 && d.indexOf("91") === 0 && /^[6-9]/.test(d.slice(2)) === false) return "";   // Indian mobiles start 6-9
  if (d.length < 11 || d.length > 15) return "";
  return d;
}
// "+91 ******3210": enough to recognise, not enough to copy.
export function maskPhone(d) {
  d = String(d || "");
  if (d.length < 6) return "";
  const cc = d.length > 10 ? d.slice(0, d.length - 10) : "";
  const local = d.slice(-10);
  return (cc ? "+" + cc + " " : "") + "******" + local.slice(-4);
}
export function otpText(code, minutes) { return code + " is your StewardMD verification code. It is valid for " + (minutes || 10) + " minutes. Do not share it."; }

function whatsappEnv(env) {
  return env.PHONE_OTP_WA_BODY ? Object.assign({}, env, { FOLLOWCARE_WA_BODY: env.PHONE_OTP_WA_BODY }) : env;
}

// 2Factor's OTP endpoint with a named OTP SMS template (TWOFACTOR_TEMPLATE_OTP). Unnamed, it calls instead.
async function twoFactorOtp(env, phone, code) {
  const tpl = env.TWOFACTOR_TEMPLATE_OTP ? "/" + encodeURIComponent(env.TWOFACTOR_TEMPLATE_OTP) : "";
  const to10 = phone.length > 10 ? phone.slice(-10) : phone;
  const url = "https://2factor.in/API/V1/" + encodeURIComponent(env.TWOFACTOR_API_KEY) + "/SMS/" + encodeURIComponent(to10) + "/" + encodeURIComponent(code) + tpl;
  const r = await fetch(url, { method: "GET" });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch (e) {}
  const ok = r.ok && String(j.Status || "").toLowerCase() === "success";
  return { ok: !!ok, providerId: j.Details || null, status: r.status, detail: ok ? null : String(text).slice(0, 200) };
}

export function smsAvailable(env) {
  return (smsProvider(env) === "twofactor" && !!env.TWOFACTOR_API_KEY) || smsConfigured(env);
}

async function viaSms(env, phone, code, name) {
  if (dltConfigured(env)) {
    const own = await sendDlt(env, phone, "otp", [code, String(TTL / 60)]);
    // No template named: fail here (the doctor sees Resend) rather than fall through to a voice call.
    if (own.ok || !env.TWOFACTOR_TEMPLATE_OTP) return own;
    try { return await twoFactorOtp(env, phone, code); } catch (e) { return { ok: false, reason: "exception" }; }
  }
  return sendSms(env, { toE164: phone, body: otpText(code), templateId: env.SMS_TEMPLATE_OTP || undefined, vars: { var1: name || "Doctor", var2: code, name: name || "Doctor", code: code, link: code } });
}
async function viaWhatsApp(env, phone, code, name) {
  if (!waConfigured(env)) return { ok: false, skipped: true, reason: "not_configured" };
  return sendWhatsApp(whatsappEnv(env), { toE164: phone, body: otpText(code), vars: { name: name || "Doctor", link: code, text: otpText(code) } });
}

// -> { ok, channel: "whatsapp"|"sms"|null, fellBack?, reason? }. Never throws.
export async function deliverOtp(env, { phone, code, name, channel }) {
  channel = channel === "sms" || channel === "whatsapp" ? channel : "auto";
  let wa = null;
  if (channel !== "sms") {
    try { wa = await viaWhatsApp(env, phone, code, name); } catch (e) { wa = { ok: false, reason: "exception" }; }
    if (wa && wa.ok) return { ok: true, channel: "whatsapp" };
    if (channel === "whatsapp") return { ok: false, channel: null, reason: (wa && wa.reason) || "whatsapp_failed" };
  }
  if (!smsAvailable(env)) return { ok: false, channel: null, reason: wa && !wa.skipped ? "whatsapp_failed_no_sms" : "no_channel" };
  let sms = null;
  try { sms = await viaSms(env, phone, code, name); } catch (e) { sms = { ok: false, reason: "exception" }; }
  if (sms && sms.ok) return { ok: true, channel: "sms", fellBack: channel === "auto" && !!wa && !wa.skipped };
  return { ok: false, channel: null, reason: (sms && sms.reason) || "sms_failed" };
}

/* ── the OTP record rules (pure, KV injected) ────────────────────────────────────────────────── */
export function otpKey(uid) { return "otp:phone:" + uid; }
/* Hash of the normalised E.164 number, for every KV KEY that is about a number (the cap counter
 * here, the phone -> uid index in _lifecycle.js). Plain SHA-256 with a fixed domain prefix: the one
 * keyed secret in the project (CONNECT_HMAC_SALT) is optional and Connect-scoped, and setting or
 * rotating it later would silently re-key the index and release every bound number. Input is the
 * digits normalizePhone() returns (country code included); "+" is added so it is E.164 proper. */
export const PHONE_HASH_PREFIX = "smd-phone-v1:";
export async function phoneHash(phone) {
  const d = String(phone || "").replace(/[^\d]/g, "");
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PHONE_HASH_PREFIX + "+" + d));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function capKey(phone) { return "otp:phone:cap:" + (await phoneHash(phone)); }
export function sendsKey(uid) { return "otp:phone:sends:" + uid; }
function sendsLeft(s) { return { whatsapp: Math.max(0, WA_MAX - ((s && s.wa) || 0)), sms: Math.max(0, SMS_MAX - ((s && s.sms) || 0)) }; }
function nowS() { return Math.floor(Date.now() / 1000); }
function gen6() { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 1000000).padStart(6, "0"); }

// deps: { store, deliver(phone, code, name, channel) -> deliverOtp result, defaultCc?,
//         checkOwner?(phone) -> { ok } | { ok:false, error:"phone-in-use" } }
export async function phoneStart(who, body, deps) {
  const store = deps.store;
  const phone = normalizePhone(body && body.phone, deps.defaultCc);
  if (!phone) return { ok: false, error: "bad-phone", status: 400 };
  const asked = body && body.channel === "sms" ? "sms" : "auto";
  let existing = null;
  try { existing = await store.get(otpKey(who.uid), "json"); } catch (e) {}
  if (existing && existing.sentAt && (nowS() - existing.sentAt) < RESEND_THROTTLE) {
    return { ok: false, error: "too-soon", retryAfter: RESEND_THROTTLE - (nowS() - existing.sentAt), status: 429 };
  }
  // Per-account budget: 2 WhatsApp + 1 SMS per window. Auto only falls back to a channel with budget left.
  let sends = null;
  try { sends = await store.get(sendsKey(who.uid), "json"); } catch (e) {}
  if (sends && sends.since && nowS() - sends.since >= SEND_WINDOW) sends = null;
  const left = sendsLeft(sends);
  if (!left.whatsapp && !left.sms) return { ok: false, error: "send-cap", left, retryAfter: sends ? Math.max(1, sends.since + SEND_WINDOW - nowS()) : 0, status: 429 };
  if (asked === "sms" && !left.sms) return { ok: false, error: "sms-used", left, status: 429 };
  const channel = asked === "sms" ? "sms" : (left.whatsapp && left.sms ? "auto" : (left.whatsapp ? "whatsapp" : "sms"));
  // Per-number daily cap, independent of the account asking.
  const ck = await capKey(phone);
  let cap = 0;
  try { cap = +(await store.get(ck)) || 0; } catch (e) {}
  if (cap >= DAILY_CAP) return { ok: false, error: "daily-cap", status: 429 };
  // One number, one account: refuse BEFORE a code is generated, stored or sent.
  if (deps.checkOwner) {
    let own = null;
    try { own = await deps.checkOwner(phone); } catch (e) { own = { ok: false, error: "store-failed" }; }
    if (!own || !own.ok) return { ok: false, error: (own && own.error) || "phone-in-use", status: own && own.error === "store-failed" ? 500 : 409 };
  }
  // Same-window re-send keeps the same code (a doctor switching WhatsApp -> SMS must not get two codes),
  // and keeps its wrong-guess count, so a resend is not a fresh set of guesses at the same code.
  const reuse = !!(existing && existing.phone === phone && existing.exp > nowS() && existing.code);
  const code = reuse ? existing.code : gen6();
  const rec = { code, phone, exp: nowS() + TTL, tries: reuse ? (existing.tries || 0) : 0, sentAt: nowS() };
  try { await store.put(otpKey(who.uid), JSON.stringify(rec), { expirationTtl: TTL }); } catch (e) { return { ok: false, error: "store-failed", status: 500 }; }
  try { await store.put(ck, String(cap + 1), { expirationTtl: 86400 }); } catch (e) {}
  const d = await deps.deliver(phone, code, who.name || "", channel);
  if (!d || !d.ok) {
    // Nothing arrived: no 30 s throttle on the retry ("Try SMS instead" must work at once), and the
    // account budget is not spent. The code stays so a late-arriving message still verifies.
    rec.sentAt = 0;
    try { await store.put(otpKey(who.uid), JSON.stringify(rec), { expirationTtl: TTL }); } catch (e) {}
    // Soft-fail with 200 so the client can show Resend / SMS instead. Never a 502 (Cloudflare replaces it).
    return { ok: false, error: d && d.reason === "no_channel" ? "no-channel" : "send-failed", reason: (d && d.reason) || "", left };
  }
  const s2 = sends ? { since: sends.since, wa: sends.wa || 0, sms: sends.sms || 0 } : { since: nowS(), wa: 0, sms: 0 };
  if (d.channel === "sms") s2.sms++; else s2.wa++;
  try { await store.put(sendsKey(who.uid), JSON.stringify(s2), { expirationTtl: Math.max(60, s2.since + SEND_WINDOW - nowS()) }); } catch (e) {}
  return { ok: true, sent: true, channel: d.channel, fellBack: !!d.fellBack, ttl: TTL, to: maskPhone(phone), left: sendsLeft(s2) };
}

// deps: { store, bind?(phone) -> { ok } | { ok:false, error }, onVerified(phone) }
// bind runs after the code matches and BEFORE onVerified (claim + lifecycle stamp, best-effort):
// a refusal there means the number was taken by another live account since phone-start.
export async function phoneVerify(who, body, deps) {
  const store = deps.store;
  const code = String((body && body.code) || "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "bad-code", status: 400 };
  const key = otpKey(who.uid);
  let rec = null; try { rec = await store.get(key, "json"); } catch (e) {}
  if (!rec) return { ok: false, error: "expired", status: 400 };
  if (rec.exp && nowS() > rec.exp) { try { await store.delete(key); } catch (e) {} return { ok: false, error: "expired", status: 400 }; }
  if ((rec.tries || 0) >= MAX_TRIES) { try { await store.delete(key); } catch (e) {} return { ok: false, error: "locked", status: 429 }; }
  if (String(rec.code) !== code) {
    rec.tries = (rec.tries || 0) + 1;
    // The MAX_TRIES-th wrong guess burns the code at once (no "0 tries left" limbo).
    if (rec.tries >= MAX_TRIES) { try { await store.delete(key); } catch (e) {} return { ok: false, error: "locked", status: 429 }; }
    try { await store.put(key, JSON.stringify(rec), { expirationTtl: Math.max(1, (rec.exp || nowS()) - nowS()) }); } catch (e) {}
    return { ok: false, error: "mismatch", triesLeft: MAX_TRIES - rec.tries, status: 400 };
  }
  try { await store.delete(key); } catch (e) {}
  if (deps.bind) {
    let b = null;
    try { b = await deps.bind(rec.phone); } catch (e) { b = { ok: false, error: "store-failed" }; }
    if (!b || !b.ok) return { ok: false, error: (b && b.error) || "phone-in-use", status: b && b.error === "store-failed" ? 500 : 409 };
  }
  if (deps.onVerified) { try { await deps.onVerified(rec.phone); } catch (e) {} }
  return { ok: true, verified: true, to: maskPhone(rec.phone) };
}
