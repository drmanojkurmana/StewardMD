// functions/_connect/abdm/linktoken.js — ABDM link tokens (M2).
//
// A link token authorises HIP-initiated care-context linking for one patient at one facility. Two hard
// limits shape this module, both from the integrator FAQ:
//
//   Q31  calling generate-token more than THREE times in one day for the same (ABHA address, facility)
//        gets you "blocked for 24 hours" - and the block is delivered in the CALLBACK, so you only find
//        out asynchronously.
//   Q31  the token is valid for SIX MONTHS. It is meant to be obtained once at registration and reused.
//
// So the token is cached, the daily attempts are counted, and a fourth attempt is refused locally rather
// than spent on a block. The cache key is the tenant-scoped ABHA HMAC - never a raw ABHA (no-phi R16).

export class LinkTokenError extends Error {
  constructor(message, code) { super(message); this.code = code || "link_token_error"; }
}

const TOKEN_PREFIX = "connect:abdm:linktok:";
const ATTEMPT_PREFIX = "connect:abdm:linktok:att:";

// Six months, minus a week of headroom so we renew before ABDM expires it mid-visit.
export const TOKEN_TTL_SEC = 180 * 24 * 3600 - 7 * 24 * 3600;
export const MAX_ATTEMPTS_PER_DAY = 3;

const tokenKey = (hipId, abhaHash) => TOKEN_PREFIX + hipId + ":" + abhaHash;
const attemptKey = (hipId, abhaHash, day) => ATTEMPT_PREFIX + hipId + ":" + abhaHash + ":" + day;

/** UTC day stamp. ABDM's window is "a day"; UTC is the defensible reading and matches their timestamps. */
export function dayStamp(now) {
  const d = new Date(typeof now === "function" ? now() : (now || Date.now()));
  return d.toISOString().slice(0, 10);
}

/** A cached, still-valid token for this (facility, patient), or null. */
export async function getCachedToken(deps, { hipId, abhaHash }) {
  const { kv, now } = deps;
  if (!kv) return null;
  let raw;
  try { raw = await kv.get(tokenKey(hipId, abhaHash)); } catch { return null; }
  if (!raw) return null;
  let rec; try { rec = JSON.parse(raw); } catch { return null; }
  if (!rec || !rec.token) return null;
  const nowMs = typeof now === "function" ? Date.parse(now()) : Date.now();
  if (Number.isFinite(rec.exp) && rec.exp <= nowMs) return null;      // expired: treat as absent
  return rec.token;
}

/** Store a token issued by ABDM. `ttlSec` defaults to just under six months. */
export async function putToken(deps, { hipId, abhaHash, token, ttlSec }) {
  const { kv, now } = deps;
  if (!kv) return;
  if (!token) throw new LinkTokenError("refusing to cache an empty link token", "empty_token");
  const ttl = Math.max(60, Number(ttlSec) || TOKEN_TTL_SEC);
  const nowMs = typeof now === "function" ? Date.parse(now()) : Date.now();
  const rec = JSON.stringify({ token, exp: nowMs + ttl * 1000 });
  try { await kv.put(tokenKey(hipId, abhaHash), rec, { expirationTtl: ttl }); } catch { /* best-effort */ }
}

/** How many generate-token calls we have already made today for this pair. */
export async function attemptsToday(deps, { hipId, abhaHash }) {
  const { kv, now } = deps;
  if (!kv) return 0;
  try { return Number(await kv.get(attemptKey(hipId, abhaHash, dayStamp(now)))) || 0; }
  catch { return 0; }
}

/**
 * Claim one of today's three attempts. Throws `daily_limit` when they are gone, so we never spend the
 * fourth call and earn a 24-hour block.
 *
 * ponytail: KV get-then-put is not atomic, so two concurrent requests can both see 2 and both proceed.
 * That costs one extra ABDM call in a rare race, never a wrong answer - the ceiling is ABDM's own
 * counter. Move to a Durable Object or the D1 atomic counter if real concurrency shows up here.
 */
export async function claimAttempt(deps, { hipId, abhaHash }) {
  const { kv, now } = deps;
  const used = await attemptsToday(deps, { hipId, abhaHash });
  if (used >= MAX_ATTEMPTS_PER_DAY) {
    throw new LinkTokenError(
      "ABDM allows only " + MAX_ATTEMPTS_PER_DAY + " link-token requests per patient per day at this facility; a fourth would block the patient for 24 hours",
      "daily_limit");
  }
  if (kv) {
    // Expire at the end of the window rather than a rolling 24h, so the count matches ABDM's day.
    try { await kv.put(attemptKey(hipId, abhaHash, dayStamp(now)), String(used + 1), { expirationTtl: 26 * 3600 }); }
    catch { /* best-effort: the ABDM-side counter is the real limit */ }
  }
  return used + 1;
}

/**
 * Body for POST /api/hiecm/v3/token/generate-token. PURE.
 *
 * FAQ Q32 is a trap worth encoding: whether `abhaNumber` is present here dictates whether it must ALSO
 * be present in the later /v3/link/carecontext call. Pass it in both places or neither - so this returns
 * the flag the linking step has to honour.
 */
export function buildGenerateTokenBody({ abhaNumber, abhaAddress, name, gender, yearOfBirth }) {
  if (!abhaAddress) throw new LinkTokenError("abhaAddress is required", "abha_address_required");
  const body = { abhaAddress };
  const digits = String(abhaNumber || "").replace(/\D/g, "");
  if (digits) {
    if (digits.length !== 14) throw new LinkTokenError("ABHA number must be 14 digits", "bad_abha");
    body.abhaNumber = digits;
  }
  if (name) body.name = name;
  if (gender) body.gender = gender;
  const y = Number(yearOfBirth);
  if (y) {
    // The swagger constrains this to a 4-digit year in the 1900-2200 range.
    if (!Number.isInteger(y) || y < 1900 || y > 2200) throw new LinkTokenError("yearOfBirth must be a 4-digit year", "bad_year");
    body.yearOfBirth = y;
  }
  return { body, abhaNumberIncluded: Boolean(digits) };
}

/**
 * Ask ABDM for a link token, respecting the cache and the daily limit.
 *
 * The gateway answers 202 and delivers the token asynchronously to
 * `<callback>/api/v3/hip/token/on-generate-token`, so this returns `{ pending: true }` on a fresh
 * request. The callback handler calls putToken(). A cache hit returns `{ token }` immediately.
 */
export async function ensureLinkToken(deps, { hipId, abhaHash, patient }) {
  if (!hipId) throw new LinkTokenError("no HIP id configured - register the facility and bind it to the client id", "no_hip_id");
  if (!abhaHash) throw new LinkTokenError("patient pseudonym is required", "no_subject");

  const cached = await getCachedToken(deps, { hipId, abhaHash });
  if (cached) return { token: cached, pending: false, fromCache: true };

  const { body, abhaNumberIncluded } = buildGenerateTokenBody(patient || {});
  await claimAttempt(deps, { hipId, abhaHash });      // throws before we spend an ABDM call

  const res = await deps.gateway.post("tokenGenerate", body);
  return { token: null, pending: true, fromCache: false, abhaNumberIncluded, status: res && res.status };
}
