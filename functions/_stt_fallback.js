/* functions/_stt_fallback.js — DICTATION CREDITS for the cloud speech-to-text fallback.
 *
 * Dictation normally runs on the phone (Whisper / native STT) and costs us nothing. Only when the phone
 * cannot transcribe does voice.js send the audio to /api/ai/transcribe, and that path is billed per
 * second of audio (AI_COST_PER_AUDIO_SEC_INR, Rs 0.02/s default, so a 5-minute consult costs about Rs 6).
 *
 * Owner, 2026-09-26: lock that fallback behind its own monthly credit, cut per use, and NEVER show it
 * in rupees ("the customer feels cheap"): 1 credit = 10 paise of our cost, so Rs 10 = 100 credits.
 *   Free (mobile-number verified only) 100 credits, Pro accounts 500, Clinician / Clinician Pro 1,000.
 * Top-ups are the "dict" quota packs in functions/_quota.js (same meter, same purchase path as the
 * other packs). Pure helpers here so the sizing tests offline. Kill switch:
 * STT_FALLBACK_CREDITS_ON="0" (env or KV billing:cfg flags) turns the meter off (fail-open). */
import { cfgFlag } from "./_billingcfg.js";

export const DICT_CREDITS = { none: 0, free: 100, pro: 500, clinician: 1000 };
export const PAISE_PER_CREDIT = 10;
// Rs 0.02/s, the same default _ai_usage.js estCostInr uses for audio.
const PAISE_PER_SEC_DEFAULT = 2;
// The highest bitrate a WebView MediaRecorder uses by default is about 128 kbps = 16,000 bytes/s, so
// bytes / 16000 is a FLOOR on the audio's length: a client cannot shrink its charge by under-reporting.
export const MAX_BYTES_PER_SEC = 16000;
// One recording is never charged for more than 15 minutes, whatever the client claims.
export const MAX_CHARGE_SEC = 900;

export function sttFallbackOn(env) {
  const v = cfgFlag(env, "STT_FALLBACK_CREDITS_ON");
  return String(v == null ? "1" : v) !== "0";
}

// Which monthly allowance an account gets. Tier comes from entitlements/{uid} (what they paid for);
// the `pro` claim covers accounts holding Pro without a tier record (grants, coupons). A free account
// gets its credits only once its mobile number is verified (owner, 2026-09-26). No uid = none.
export function planClass(tier, isPro, hasUid, phoneVerified) {
  if (!hasUid) return "none";
  const t = String(tier || "").toLowerCase();
  if (t === "physician" || t === "physicianpro" || t === "ultimate") return "clinician";
  if (t === "trainee" || t === "coresident" || t === "pro") return "pro";
  if (isPro) return "pro";
  return phoneVerified ? "free" : "none";
}

export function monthlyCredits(env, cls) {
  const c = DICT_CREDITS[cls] != null ? cls : "none";
  if (c === "none") return 0;
  const ov = Number(cfgFlag(env, "DICT_CREDITS_" + c.toUpperCase()));
  return Number.isFinite(ov) && ov >= 0 ? Math.floor(ov) : DICT_CREDITS[c];
}

export function paisePerSec(env) {
  const inr = Number(env && env.AI_COST_PER_AUDIO_SEC_INR);
  return Number.isFinite(inr) && inr > 0 ? inr * 100 : PAISE_PER_SEC_DEFAULT;
}

// Seconds to charge: the larger of the client's measured duration and the byte-size floor, clamped.
export function chargeSeconds(b64Len, clientMs) {
  const bytes = Math.floor(Math.max(0, +b64Len || 0) * 3 / 4);
  const floorSec = Math.ceil(bytes / MAX_BYTES_PER_SEC);
  const ms = +clientMs;
  const clientSec = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
  return Math.min(MAX_CHARGE_SEC, Math.max(1, floorSec, clientSec));
}

// Credits for one recording (at least 1).
export function chargeCredits(env, b64Len, clientMs) {
  return Math.max(1, Math.ceil(chargeSeconds(b64Len, clientMs) * paisePerSec(env) / PAISE_PER_CREDIT));
}

// A caller with no account cannot hold credits: ask them to sign in rather than open a shop.
export function signinBody() {
  return {
    error: "stt-fallback-signin",
    message: "Sign in and verify your mobile number to use cloud dictation. Clinical dictation on the phone is free.",
  };
}
