/* functions/_pglog_public.js — NMC Logbook · THE PUBLIC SIDE OF A SIGNATURE.
 * ===========================================================================
 * Everything an examiner sees when they scan the QR on a printed logbook, and NOTHING else.
 *
 * Both the JSON endpoint (/api/pglog/v/:code) and the human page (/pglog/v/:code) resolve through
 * `resolve()` here, so there is exactly ONE definition of what a verification discloses. Two copies
 * would drift, and the copy that drifted would be the one that leaked.
 *
 * UNAUTHENTICATED BY DESIGN. An examiner holding a printout has no StewardMD account, and requiring
 * one would make the QR useless to the only person it exists for. What that costs, and how it is
 * paid for:
 *   - Enumeration: the code is an opaque 80-bit random handle, plus a per-IP rate limit.
 *   - Disclosure: the payload is limited to what is ALREADY ON THE PAPER IN THEIR HAND — the
 *     resident's name and StewardMD ID, the programme, the KIND of activity and its date, the
 *     signer's name and registration, and whether the record still stands. Never the case
 *     reference, the diagnosis, the remarks, the reflection, a uid, an email or an entry id.
 */
import * as S from "./_pglog_store.js";
import * as V from "./_pglog_verify.js";

/* A small fixed-window rate limiter over the KV binding the rest of the app already uses. Fails
 * OPEN on a KV error: a verification lookup is read-only and PHI-free, so refusing every examiner
 * because a cache is down is the worse failure. (The WRITE paths fail closed; this one does not,
 * and the asymmetry is deliberate.) */
export async function rateLimit(env, request, bucket, limit, windowSec) {
  const store = env.CASES_KV || env.GHIS_KV || null;
  if (!store) return { ok: true };
  try {
    // CF-Connecting-IP ONLY. X-Forwarded-For is client-supplied, so falling back to it hands the
    // caller their own rate-limit bucket key — an attacker rotates the header and the limit is gone.
    // Without the trusted header everyone shares the "anon" bucket, which is the safe direction.
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    const win = Math.floor(Date.now() / (windowSec * 1000));
    const key = "pglog:rl:" + bucket + ":" + win + ":" + ip;
    const cur = Number(await store.get(key)) || 0;
    if (cur >= limit) return { ok: false, retryAfter: windowSec };
    await store.put(key, String(cur + 1), { expirationTtl: windowSec * 2 });
    return { ok: true };
  } catch (e) { return { ok: true }; }
}

/* Build the PUBLIC answer for a verification code. Every field here was chosen by asking: is this
 * already on the document the examiner is holding? If not, it does not appear. */
/* Show enough of an identifier to match it against the document in front of you, and no more. */
function maskId(v) {
  const t = String(v || "");
  // A StewardMD ID is SMD-XXXXXX. Anything shorter is not one, and half-masking it would produce a
  // string that looks like an ID and is not.
  return t.length >= 10 ? t.slice(0, 4) + "\u2022\u2022\u2022" + t.slice(-3) : t;
}

export async function describeVerification(env, rec, code, deps) {
  // Test seam, same convention the store uses. Production never passes it.
  const D = Object.assign({ getEntry: S.getEntry, getAssessment: S.getAssessment,
    getAttestation: S.getAttestation, getResident: S.getResident, getProgramme: S.getProgramme,
    digestFor: V.digestFor }, deps || {});
  const out = {
    ok: true, code,
    kind: rec.kind,
    issuedAt: rec.issuedAt,
    disclaimer: "StewardMD attests to what it recorded and to the signer's registration as verified " +
      "against the Indian Medical Register at the time of signing. It does not certify the clinical " +
      "content, and it is not a determination by the NMC or by any University."
  };
  if (rec.revoked) {
    out.status = "superseded";
    out.message = "This record was amended after it was signed, so this signature no longer stands. " +
      "The corrected record carries its own code, and the original is retained in the audit trail.";
    return out;
  }

  // Re-read the LIVE document and re-derive its digest through the SAME function that produced the
  // one stored at signing time (V.payloadFor). Two hand-written field lists is exactly how this
  // check once declared every honest record a forgery.
  let live = null;
  try {
    if (rec.kind === "entry") live = await D.getEntry(env, rec.refId);
    else if (rec.kind === "assessment") live = await D.getAssessment(env, rec.refId);
    else if (rec.kind === "attestation") live = await D.getAttestation(env, rec.refId);
  } catch (e) { live = null; }

  if (!live) {
    out.status = "unavailable";
    out.message = "The record behind this code could not be read just now. Nothing is implied about " +
      "its validity — try again shortly.";
    return out;
  }

  let expect = "";
  try { expect = await D.digestFor(env, rec.kind, V.payloadFor(rec.kind, live)); } catch (e) { expect = ""; }
  if (!expect || !V.digestEqual(expect, rec.digest)) {
    out.status = "tampered";
    out.message = "This record does not match what was signed. Do not rely on it. Report it to the " +
      "institution's Academic Cell.";
    return out;
  }

  out.status = "valid";
  const res = await D.getResident(env, live.residentId).catch(() => null);
  const prog = res ? await D.getProgramme(env, res.programmeId).catch(() => null) : null;
  // The StewardMD ID is masked. It is the cross-module identity handle, and while it is printed on
  // the document the examiner is holding, publishing it in full to anyone who comes by a code widens
  // its exposure beyond the logbook. The visible tail is enough to match against the paper, which is
  // the only thing this line exists for.
  out.resident = res ? { name: res.name, smdId: maskId(res.smdId), trainingYear: res.trainingYear } : null;
  out.programme = prog ? { degree: prog.degree, specialty: prog.specialtyId, name: prog.name } : null;
  if (rec.kind === "entry") {
    out.record = { type: "Logbook entry", activity: live.kind, setting: live.setting || "",
                   role: live.role || "", date: live.occurredAt, amendments: (live.revisions || []).length };
    out.signedBy = { name: live.verifiedName || "", registrationNo: live.verifiedReg || "",
                     council: live.verifiedCouncil || "", at: live.verifiedAt,
                     role: "Verifying faculty (PGMER-2023 §5.2(vii))" };
  } else if (rec.kind === "assessment") {
    out.record = { type: "Formative assessment", template: live.templateId, outcome: live.outcome,
                   score: live.maxTotal ? live.total + " / " + live.maxTotal : "—" };
    out.signedBy = { name: live.assessorName || "", registrationNo: live.assessorReg || "",
                     council: live.assessorCouncil || "", at: live.assessedAt, role: "Assessor" };
  } else {
    out.record = { type: live.kind === "monthly" ? "Monthly authentication" : "Head of Department certification",
                   period: live.period || "", entries: (live.counts || {}).total || 0,
                   verifiedEntries: (live.counts || {}).verified || 0 };
    out.signedBy = { name: live.attestedName || "", registrationNo: live.attestedReg || "",
                     council: live.attestedCouncil || "", at: live.attestedAt,
                     role: "Postgraduate guide (PGMER-2023 §5.2(vii))" };
  }
  return out;
}

/* The one entry point. Returns { status, body } — the JSON route serialises it, the HTML page
 * renders it. Every failure mode answers vaguely and identically, so probing teaches nothing. */
export async function resolve(env, request, rawCode, deps) {
  const rl = await (deps && deps.rateLimit ? deps.rateLimit : rateLimit)(env, request, "verify", 30, 60);
  if (!rl.ok) {
    return { status: 429, retryAfter: rl.retryAfter,
      body: { ok: false, status: "rate_limited", message: "Too many lookups. Try again in a minute." } };
  }
  const code = V.normalizeCode(rawCode);
  if (!code) {
    return { status: 400,
      body: { ok: false, status: "malformed", message: "That is not a StewardMD verification code." } };
  }
  let rec = null;
  try { rec = await (deps && deps.lookup ? deps.lookup : V.lookup)(env, code, deps); } catch (e) { rec = null; }
  if (!rec) {
    return { status: 404,
      body: { ok: false, status: "not_found", message: "No signed record carries that code." } };
  }
  return { status: 200, body: await describeVerification(env, rec, code, deps) };
}
