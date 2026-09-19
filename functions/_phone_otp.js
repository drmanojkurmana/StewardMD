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
 * vendor is needed. SMS via 2Factor uses its dedicated OTP API (a DLT-approved OTP template comes
 * with the account, TWOFACTOR_TEMPLATE_OTP overrides the name); every other provider goes through
 * sendSms() with the code in var2 / the body. WhatsApp through the custom BSP fills
 * PHONE_OTP_WA_BODY when set (same {{to}} {{name}} {{link}} {{text}} tokens; the code is {{link}}),
 * else the FollowCare body.
 *
 * PHONE_VERIFY_ON (default on): set 0 to make both routes answer { ok:false, error:"off" } without a
 * deploy. The client (phone-verify.js) then never asks.
 *
 * Nothing here is PHI: it is the doctor's own number, kept only in the OTP record (10-minute TTL)
 * and, once verified, on the lifecycle record.
 */
import { sendWhatsApp, waConfigured } from "./_followcare_whatsapp.js";
import { sendSms, smsProvider, smsConfigured } from "./_followcare_sms.js";

export const TTL = 600;              // the code lives 10 minutes
export const RESEND_THROTTLE = 30;   // seconds between sends to one account
export const MAX_TRIES = 5;          // wrong guesses before the code is burnt
export const DAILY_CAP = 6;          // codes per number per day: nobody gets SMS-bombed from our account

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

// 2Factor's OTP endpoint sends the code through its pre-approved OTP template.
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
  if (smsProvider(env) === "twofactor" && env.TWOFACTOR_API_KEY) {
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
export function capKey(phone) { return "otp:phone:cap:" + phone; }
function nowS() { return Math.floor(Date.now() / 1000); }
function gen6() { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 1000000).padStart(6, "0"); }

// deps: { store, deliver(phone, code, name, channel) -> deliverOtp result, defaultCc? }
export async function phoneStart(who, body, deps) {
  const store = deps.store;
  const phone = normalizePhone(body && body.phone, deps.defaultCc);
  if (!phone) return { ok: false, error: "bad-phone", status: 400 };
  const channel = body && body.channel === "sms" ? "sms" : "auto";
  let existing = null;
  try { existing = await store.get(otpKey(who.uid), "json"); } catch (e) {}
  if (existing && existing.sentAt && (nowS() - existing.sentAt) < RESEND_THROTTLE) {
    return { ok: false, error: "too-soon", retryAfter: RESEND_THROTTLE - (nowS() - existing.sentAt), status: 429 };
  }
  // Per-number daily cap, independent of the account asking.
  let cap = 0;
  try { cap = +(await store.get(capKey(phone))) || 0; } catch (e) {}
  if (cap >= DAILY_CAP) return { ok: false, error: "daily-cap", status: 429 };
  // Same-window re-send keeps the same code (a doctor switching WhatsApp -> SMS must not get two codes).
  const code = (existing && existing.phone === phone && existing.exp > nowS() && existing.code) ? existing.code : gen6();
  const rec = { code, phone, exp: nowS() + TTL, tries: 0, sentAt: nowS() };
  try { await store.put(otpKey(who.uid), JSON.stringify(rec), { expirationTtl: TTL }); } catch (e) { return { ok: false, error: "store-failed", status: 500 }; }
  try { await store.put(capKey(phone), String(cap + 1), { expirationTtl: 86400 }); } catch (e) {}
  const d = await deps.deliver(phone, code, who.name || "", channel);
  if (!d || !d.ok) {
    // Soft-fail with 200 so the client can show Resend / SMS instead. Never a 502 (Cloudflare replaces it).
    return { ok: false, error: d && d.reason === "no_channel" ? "no-channel" : "send-failed", reason: (d && d.reason) || "" };
  }
  return { ok: true, sent: true, channel: d.channel, fellBack: !!d.fellBack, ttl: TTL, to: maskPhone(phone) };
}

// deps: { store, onVerified(phone) }  -> claim + lifecycle stamp, best-effort
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
  if (deps.onVerified) { try { await deps.onVerified(rec.phone); } catch (e) {} }
  return { ok: true, verified: true, to: maskPhone(rec.phone) };
}
