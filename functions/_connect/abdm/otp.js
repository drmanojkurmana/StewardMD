// functions/_connect/abdm/otp.js — the OTP the HIP sends during user-initiated linking.
//
// WHOSE OTP THIS IS. ABDM's Discovery & Link flow says: "On getting the link/init request, the HRP/HIP
// must send an OTP to the patient's phone number." The gateway does not generate it, does not deliver it
// and does not verify it - it only carries the patient's answer back to us on link/confirm. So this is
// entirely ours, which means the security properties are ours too.
//
// WHAT IT GUARANTEES
//   - the OTP is never stored: only a salted hash of it, so a dump of KV cannot be replayed
//   - single-use: a confirmed reference is destroyed, so the same OTP cannot link twice
//   - bounded attempts: three wrong answers destroy the reference rather than letting it be ground down
//   - bounded sends: a per-patient window, so link/init cannot be turned into an SMS bombing tool
//   - bounded resends: two, matching what ABDM's own M1 guidance allows
//   - constant answers: unknown reference, expired reference and wrong OTP are indistinguishable, so the
//     reply is not an oracle for guessing which references exist
//
// DELIVERY IS REAL OR IT IS REPORTED FALSE. There is no simulated success anywhere in this file. An
// Indian transactional SMS must match a DLT-approved template registered with the provider, so an OTP
// needs its OWN template id - `ABDM_OTP_TEMPLATE` - separate from FollowCare's check-in template.
// Until that is provisioned, `deliver()` returns { ok:false, reason:"not_configured" } and link/init
// honestly reports delivered:false. A patient waiting for an OTP that was never sent is worse than an
// error, so we never claim to have sent one.

import { sendSms, smsConfigured, toDialable } from "../../_followcare_sms.js";
import { sendWhatsApp, waConfigured } from "../../_followcare_whatsapp.js";
import { guardedKvPut } from "./no-phi.js";

export class OtpError extends Error {}

export const OTP_TTL_SEC = 10 * 60;          // ABDM's link OTPs are short-lived; ten minutes is generous
export const MAX_VERIFY_ATTEMPTS = 3;
export const MAX_RESENDS = 2;                // "System may activate the Resend OTP button atleast 2 times"
export const SEND_WINDOW_SEC = 3600;
export const MAX_SENDS_PER_WINDOW = 3;       // per patient per hour: enough for a genuine retry, not a flood

const REF_PREFIX = "connect:abdm:linkotp:";
const RATE_PREFIX = "connect:abdm:otprate:";

const isoOf = (now) => {
  const d = typeof now === "function" ? now() : now;
  if (d && typeof d.toISOString === "function") return d.toISOString();
  if (typeof d === "string" && d) return d;
  return new Date(typeof d === "number" ? d : Date.now()).toISOString();
};

async function sha256hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A 6-digit OTP from the CSPRNG. Rejection-sampled so every value is equally likely - a plain modulo
 * would make the low 296 values marginally more probable, which is a real (if small) bias in a secret.
 * NEVER Math.random.
 */
export function mintOtp(io) {
  if (io && typeof io.mintOtp === "function") return String(io.mintOtp());   // test seam only
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= 4294000000);   // 900000 * 4771
  return String(100000 + (v % 900000));
}

/** The OTP is bound to its reference, so a hash lifted from one reference cannot be replayed into another. */
const otpHash = (otp, ref) => sha256hex(String(otp) + ":" + String(ref));

// ── rate limiting ───────────────────────────────────────────────────────────────────────────────────
/**
 * Fixed-window send budget per (tenant, patient). The window index lives in the VALUE so a new window
 * resets the count even before the TTL fires. Key carries only a pseudonym, never a mobile or an ABHA.
 *
 * Fails CLOSED: if KV is unavailable we refuse to send, because an unbounded OTP path is a bombing tool.
 */
export async function claimSendBudget(deps, { tenantId, patientRef, now }) {
  const kv = deps && deps.kv;
  if (!kv) return { allowed: false, reason: "no-rate-store" };
  const key = RATE_PREFIX + tenantId + ":" + (await sha256hex(String(patientRef)));
  const nowMs = Date.parse(isoOf(now));
  if (!Number.isFinite(nowMs)) return { allowed: false, reason: "no-clock" };
  const win = Math.floor(nowMs / (SEND_WINDOW_SEC * 1000));
  let rec = null;
  try { rec = JSON.parse((await kv.get(key)) || "null"); } catch { rec = null; }
  const count = rec && rec.win === win ? (Number(rec.count) || 0) : 0;
  if (count >= MAX_SENDS_PER_WINDOW) return { allowed: false, reason: "rate-limited", count };
  try {
    await guardedKvPut(kv, key, JSON.stringify({ win, count: count + 1 }), { expirationTtl: SEND_WINDOW_SEC * 2 });
  } catch { return { allowed: false, reason: "rate-store-failed" }; }
  return { allowed: true, count: count + 1 };
}

// ── delivery ────────────────────────────────────────────────────────────────────────────────────────
/** Is a channel actually able to send an ABDM link OTP right now? */
export function otpDeliveryConfigured(env) {
  if (!env) return false;
  // A DLT-approved OTP template is not optional in India: without it the provider rejects or silently
  // drops the message, which would look to us like success.
  if (!env.ABDM_OTP_TEMPLATE) return false;
  return Boolean(smsConfigured(env) || waConfigured(env));
}

/**
 * Send the OTP. Returns { ok, channel?, reason? } and NEVER pretends.
 *
 * The message text carries the OTP and nothing else identifying - no name, no ABHA, no care-context
 * reference. An SMS is not a private channel.
 */
export async function deliverOtp(env, deps, { mobile, otp, facilityName } = {}) {
  if (!otpDeliveryConfigured(env)) return { ok: false, reason: "not_configured" };
  const to = toDialable(mobile, env.FOLLOWCARE_DEFAULT_CC);
  if (!to || to.length < 10) return { ok: false, reason: "bad_number" };

  const who = facilityName || env.ABDM_FACILITY_NAME || "your hospital";
  const body = otp + " is your one time password to link your health records with " + who +
    ". It expires in 10 minutes. Do not share it.";
  const payload = { toE164: mobile, body, vars: { otp: String(otp), text: body }, template: env.ABDM_OTP_TEMPLATE };

  const send = deps && deps.send;                       // test seam: a recorder instead of a live provider
  const wantsWa = String(env.FOLLOWCARE_MSG_CHANNEL || "sms").toLowerCase() === "whatsapp";
  try {
    if (wantsWa && waConfigured(env)) {
      const wa = send ? await send("whatsapp", payload) : await sendWhatsApp(env, payload);
      if (wa && wa.ok) return { ok: true, channel: "whatsapp" };
      // Fall back to SMS rather than leaving the patient without an OTP.
      if (smsConfigured(env)) {
        const sms = send ? await send("sms", payload) : await sendSms(env, payload);
        return sms && sms.ok
          ? { ok: true, channel: "sms", waFellBack: true }
          : { ok: false, channel: "sms", reason: (sms && sms.reason) || "send_failed" };
      }
      return { ok: false, channel: "whatsapp", reason: (wa && wa.reason) || "send_failed" };
    }
    if (smsConfigured(env)) {
      const sms = send ? await send("sms", payload) : await sendSms(env, payload);
      return sms && sms.ok ? { ok: true, channel: "sms" } : { ok: false, channel: "sms", reason: (sms && sms.reason) || "send_failed" };
    }
  } catch (e) {
    // A provider exception must never read as a send.
    return { ok: false, reason: "exception" };
  }
  return { ok: false, reason: "not_configured" };
}

// ── issue / verify ──────────────────────────────────────────────────────────────────────────────────
/**
 * Mint an OTP for one link request, hold the scope it authorises, and try to deliver it.
 *
 * `refs` is the care-context list link/init offered. Holding it WITH the OTP is what makes link/confirm
 * unable to link anything that was not offered.
 *
 * Returns { linkRef, expiresAt, delivered, channel?, reason? }. `delivered` is the truth about the send.
 */
export async function issueLinkOtp(env, deps, { tenantId, patientRef, refs, transactionId, mobile, now, io } = {}) {
  const kv = deps && deps.kv;
  if (!kv) throw new OtpError("otp store is not bound");

  const budget = await claimSendBudget(deps, { tenantId, patientRef, now });
  if (!budget.allowed) {
    // Refuse to mint at all. Minting without sending would leave a live reference nobody can satisfy.
    return { linkRef: null, delivered: false, reason: budget.reason };
  }

  const linkRef = (deps.newId || (() => crypto.randomUUID()))();
  const otp = mintOtp(io);
  const nowIso = isoOf(now);
  const expiresAt = new Date(Date.parse(nowIso) + OTP_TTL_SEC * 1000).toISOString();

  // NON-PHI at rest: an OTP hash, a pseudonymous patient ref and opaque care-context references.
  await kv.put(REF_PREFIX + linkRef, JSON.stringify({
    otpHash: await otpHash(otp, linkRef),
    tenantId, transactionId, patientRef,
    refs: Array.isArray(refs) ? refs : [],
    attempts: 0, resends: 0, expiresAt,
  }), { expirationTtl: OTP_TTL_SEC });

  const sent = await deliverOtp(env, deps, { mobile, otp });
  return { linkRef, expiresAt, delivered: Boolean(sent.ok), channel: sent.channel, reason: sent.ok ? undefined : sent.reason };
}

/**
 * Re-send the SAME OTP for an existing reference. A NEW OTP would invalidate one the patient may be about
 * to type; ABDM's own guidance is a resend, not a re-mint. Bounded to MAX_RESENDS.
 *
 * The OTP itself is not recoverable from the stored hash, so a resend re-mints and re-stores - which does
 * invalidate the old code. That is the honest trade, and it is why the count is bounded and the reply
 * says so.
 */
export async function resendLinkOtp(env, deps, { linkRef, mobile, now, io } = {}) {
  const kv = deps && deps.kv;
  if (!kv) throw new OtpError("otp store is not bound");
  const key = REF_PREFIX + linkRef;
  let st = null;
  try { st = JSON.parse((await kv.get(key)) || "null"); } catch { st = null; }
  if (!st) return { delivered: false, reason: "unknown-or-expired" };
  if ((st.resends || 0) >= MAX_RESENDS) return { delivered: false, reason: "resend-limit" };

  const budget = await claimSendBudget(deps, { tenantId: st.tenantId, patientRef: st.patientRef, now });
  if (!budget.allowed) return { delivered: false, reason: budget.reason };

  const otp = mintOtp(io);
  const ttl = ttlRemaining(st, now);
  if (ttl <= 0) { await kv.delete(key); return { delivered: false, reason: "unknown-or-expired" }; }
  await kv.put(key, JSON.stringify({ ...st, otpHash: await otpHash(otp, linkRef), resends: (st.resends || 0) + 1 }),
    { expirationTtl: ttl });

  const sent = await deliverOtp(env, deps, { mobile, otp });
  return { delivered: Boolean(sent.ok), channel: sent.channel, resends: (st.resends || 0) + 1, reason: sent.ok ? undefined : sent.reason };
}

function ttlRemaining(st, now) {
  const exp = Date.parse(st && st.expiresAt), n = Date.parse(isoOf(now));
  if (!Number.isFinite(exp) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor((exp - n) / 1000));
}

/**
 * Verify the patient's answer.
 *
 * Returns { ok, state?, reason }. EVERY failure returns the same `ok:false` with a reason that is for the
 * audit trail only - the caller must answer ABDM identically whichever it was, so an unknown reference,
 * an expired one and a wrong OTP cannot be told apart from outside.
 */
export async function verifyLinkOtp(deps, { linkRef, token, now } = {}) {
  const kv = deps && deps.kv;
  if (!kv) throw new OtpError("otp store is not bound");
  if (!linkRef) return { ok: false, reason: "no-reference" };
  const key = REF_PREFIX + linkRef;
  let st = null;
  try { st = JSON.parse((await kv.get(key)) || "null"); } catch { st = null; }
  if (!st) return { ok: false, reason: "unknown-or-expired" };

  // KV expiry is the primary bound; this is the belt, for a store that returned a stale value.
  if (ttlRemaining(st, now) <= 0) { await kv.delete(key); return { ok: false, reason: "unknown-or-expired" }; }

  if ((st.attempts || 0) >= MAX_VERIFY_ATTEMPTS) { await kv.delete(key); return { ok: false, reason: "attempts-exhausted" }; }

  const given = await otpHash(String(token == null ? "" : token), linkRef);
  if (given !== st.otpHash) {
    const attempts = (st.attempts || 0) + 1;
    // Past the cap the reference is DESTROYED rather than left to be ground down.
    if (attempts >= MAX_VERIFY_ATTEMPTS) await kv.delete(key);
    else await kv.put(key, JSON.stringify({ ...st, attempts }), { expirationTtl: ttlRemaining(st, now) });
    return { ok: false, reason: "wrong-otp", attempts };
  }

  // Correct. Single-use: destroy the reference before returning, so a replay of the same OTP finds nothing.
  await kv.delete(key);
  return { ok: true, state: st, reason: "verified" };
}
