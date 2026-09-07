/* functions/_rx_public.js — THE PUBLIC SIDE OF A PRESCRIPTION.
 * ===========================================================================
 * Everything a pharmacist sees when they scan the QR on a printed prescription, and NOTHING else.
 *
 * Both the JSON endpoint (/api/rx/v/:code) and the human page (/verify/:code) resolve through
 * `resolve()` here, so there is exactly ONE definition of what a verification discloses. Two copies
 * would drift, and the copy that drifted would be the one that leaked. Mirrors _pglog_public.js.
 *
 * UNAUTHENTICATED BY DESIGN. A pharmacist holding a printout has no StewardMD account, and requiring
 * one would make the QR useless to the only person it exists for. What that costs, and how it is
 * paid for:
 *   - Enumeration: the code is an opaque 80-bit random handle, plus a per-IP rate limit.
 *   - Disclosure: the record itself contains no patient data at all (functions/_rx_store.js decides
 *     what may be written), so there is no PHI here to leak even in principle. What is shown is
 *     what is ALREADY ON THE PAPER IN THEIR HAND — the drugs, the prescriber's name and
 *     registration number, whether that prescriber is verified, and whether the prescription still
 *     stands. Never a uid, an email, or anything about the patient.
 *
 * WHY THE ANSWER IS COMPUTED, NOT STORED. Status is derived from the dates on every read
 * (rx-validity.statusAt), so an expired prescription reads EXPIRED the moment it expires — no cron,
 * no backfill, and no window in which a stale stored flag still says ACTIVE.
 */
import * as S from "./_rx_store.js";
import RXV from "../rx-validity.js";

/* A small fixed-window rate limiter over the KV binding the rest of the app already uses. Fails
 * OPEN on a KV error: a verification lookup is read-only and PHI-free, so refusing every pharmacist
 * because a cache is down is the worse failure. (The WRITE paths fail closed; the asymmetry is
 * deliberate and matches _pglog_public.js.) */
export async function rateLimit(env, request, bucket, limit, windowSec) {
  const store = (env && (env.CASES_KV || env.GHIS_KV || env.MAIK_KV)) || null;
  if (!store) return { ok: true };
  try {
    // CF-Connecting-IP ONLY. X-Forwarded-For is client-supplied, so falling back to it hands the
    // caller their own rate-limit bucket key — rotate the header and the limit is gone.
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    const win = Math.floor(Date.now() / (windowSec * 1000));
    const key = "rx:rl:" + bucket + ":" + win + ":" + ip;
    const cur = Number(await store.get(key)) || 0;
    if (cur >= limit) return { ok: false, retryAfter: windowSec };
    await store.put(key, String(cur + 1), { expirationTtl: windowSec * 2 });
    return { ok: true };
  } catch (e) { return { ok: true }; }
}

/* Show the code grouped the way it is printed, so a reader can match the two by eye. */
function pretty(code) {
  const t = String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return t.replace(/(.{4})(?=.)/g, "$1-");
}

/* The PUBLIC answer. Every field was chosen by asking: is this already on the document in the
 * reader's hand? If not, it does not appear. Note `uid` is dropped here — it is on the record for
 * revocation authorisation and is nobody else's business. */
export function describe(rec, now) {
  const state = RXV.statusAt(rec, now);
  return {
    ok: true,
    status: state,                                  // ACTIVE | EXPIRED | REVOKED | ARCHIVED
    code: pretty(rec.code),
    // The prescriber. A registration number a council actually verified is the only thing that
    // makes this a check rather than a claim, so whether it was verified is stated outright.
    doctor: {
      name: (rec.doctor && rec.doctor.name) || "",
      regNo: (rec.doctor && rec.doctor.regNo) || "",
      verified: !!(rec.doctor && rec.doctor.verified),
    },
    // Masked initials, so whoever presents the paper can be checked against it. Never a name - the
    // store validates that on the way in, and this only passes through what was stored.
    patientMask: rec.patientMask || "",
    drugs: [].concat(rec.drugs || []),
    issuedAt: rec.issuedAt || null,
    validUntil: rec.validUntil || null,
    schedule: rec.schedule || "",
    refillsAllowed: rec.refillsAllowed == null ? null : rec.refillsAllowed,
    revokedReason: rec.revokedAt ? (rec.revokedReason || "") : "",
  };
}

export async function resolve(env, request, rawCode, deps) {
  const rl = await ((deps && deps.rateLimit) || rateLimit)(env, request, "verify", 30, 60);
  if (!rl.ok) {
    return { status: 429, retryAfter: rl.retryAfter,
      body: { ok: false, status: "rate_limited", message: "Too many lookups. Try again in a minute." } };
  }
  const code = RXV.normalizeCode(rawCode);
  if (!code || code.length < 12) {
    return { status: 400,
      body: { ok: false, status: "malformed", message: "That is not a StewardMD prescription code." } };
  }
  let rec = null;
  try { rec = await ((deps && deps.lookup) || S.lookup)(env, code, deps); } catch (e) { rec = null; }
  if (!rec) {
    // Deliberately identical wording for "never existed" and "not readable": distinguishing them
    // would turn this endpoint into an oracle for which codes exist.
    return { status: 404,
      body: { ok: false, status: "not_found", message: "No prescription carries that code." } };
  }
  const now = (deps && deps.now && deps.now()) || Date.now();
  return { status: 200, body: describe(rec, now) };
}
