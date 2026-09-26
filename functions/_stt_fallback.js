/* functions/_stt_fallback.js — a separate monthly rupee wallet for the CLOUD speech-to-text fallback.
 *
 * Dictation normally runs on the phone (Whisper / native STT) and costs us nothing. Only when the phone
 * cannot transcribe does voice.js send the audio to /api/ai/transcribe, and that path is billed per
 * second of audio (AI_COST_PER_AUDIO_SEC_INR, Rs 0.02/s default, so a 5-minute consult is about Rs 6).
 * Owner, 2026-09-26: lock that fallback behind its own credit, cut per use, separate from the MaiK
 * token budget: Free Rs 10, Pro accounts Rs 50, Clinician / Clinician Pro Rs 100 a month.
 *
 * Pure helpers + deps-injectable KV so the whole meter tests offline. Kill switch:
 * STT_FALLBACK_CREDITS_ON="0" (env or KV billing:cfg flags) turns the meter off (fail-open). */
import { cfgFlag } from "./_billingcfg.js";

// Monthly allowance per plan class, in paise. Env override STT_FALLBACK_PAISE_<CLASS>.
export const STT_FALLBACK_PAISE = { free: 1000, pro: 5000, clinician: 10000 };
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

// Which wallet size an account gets. Tier comes from entitlements/{uid} (what they paid for); the
// `pro` claim covers accounts that hold Pro without a tier record (grants, coupons, owners).
// No uid (guest) is always free.
export function planClass(tier, isPro, hasUid) {
  if (!hasUid) return "free";
  const t = String(tier || "").toLowerCase();
  if (t === "physician" || t === "physicianpro" || t === "ultimate") return "clinician";
  if (t === "trainee" || t === "coresident" || t === "pro") return "pro";
  return isPro ? "pro" : "free";
}

export function allowancePaise(env, cls) {
  const c = STT_FALLBACK_PAISE[cls] != null ? cls : "free";
  const ov = Number(cfgFlag(env, "STT_FALLBACK_PAISE_" + c.toUpperCase()));
  return Number.isFinite(ov) && ov >= 0 ? Math.floor(ov) : STT_FALLBACK_PAISE[c];
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

export function monthKey(now) { return new Date(now || Date.now()).toISOString().slice(0, 7); }
export function walletKey(id, now) { return "stt:fb:" + id + ":" + monthKey(now); }

// Read-only check before the model is called. Nothing is spent until the transcript succeeds.
export async function checkFallback(env, kv, id, cls, costPaise, now) {
  const allowance = allowancePaise(env, cls);
  if (!kv || !id) return { ok: true, allowance, spent: 0, metered: false };
  let spent = 0;
  try { const j = await kv.get(walletKey(id, now), "json"); spent = (j && +j.spent) || 0; } catch (e) { return { ok: true, allowance, spent: 0, metered: false }; }
  return { ok: spent + costPaise <= allowance, allowance, spent, remaining: Math.max(0, allowance - spent), metered: true };
}

export async function spendFallback(kv, id, costPaise, now) {
  if (!kv || !id) return null;
  const key = walletKey(id, now);
  let spent = 0;
  try { const j = await kv.get(key, "json"); spent = (j && +j.spent) || 0; } catch (e) {}
  const rec = { spent: spent + costPaise, at: now || Date.now() };
  try { await kv.put(key, JSON.stringify(rec), { expirationTtl: 40 * 86400 }); } catch (e) {}
  return rec;
}

export function exhaustedBody(check, now) {
  return {
    error: "stt-fallback-exhausted",
    message: "This month's cloud dictation credit is used up. Clinical dictation on the phone stays free and unlimited.",
    allowanceInr: check.allowance / 100,
    spentInr: check.spent / 100,
    resetMonth: monthKey(now)
  };
}
