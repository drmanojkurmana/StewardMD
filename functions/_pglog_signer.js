/* functions/_pglog_signer.js — NMC Logbook · WHO IS ALLOWED TO SIGN, and what their signature says.
 * ===========================================================================
 * PGMER-2023 §5.2(vii) requires the logbook to be "checked, assessed and authenticated monthly by
 * the Post-graduate guide". PGMER-2023 §9.2(c) puts a monetary penalty on the NAMED faculty / HoD /
 * Dean who submits a false record. Both of those presuppose something the module did not previously
 * check: that the person signing is a REGISTERED MEDICAL PRACTITIONER.
 *
 * A logbook signature from an unverified account is worth nothing. Worse, it looks exactly like one
 * that is worth something. So:
 *
 *   NOBODY DIGITALLY SIGNS ANYTHING IN THIS MODULE WITHOUT A VERIFIED MEDICAL REGISTRATION,
 *   AND THE REGISTRATION NUMBER IS RECORDED ON THE RECORD THEY SIGNED.
 *
 * "Verified" is not a new concept invented here. StewardMD already verifies doctors against the LIVE
 * Indian Medical Register: /api/verify-doctor reads the registration certificate, cross-checks the
 * number against nmc.org.in, writes `icu:doctor:<uid>` into KV and sets the Firebase custom claim
 * `verified:true` with `regNo`. This module READS that. It does not re-implement it, and it cannot
 * grant it.
 *
 * FAIL CLOSED, ALWAYS. If KV is unreachable, if the record is missing, if the claim lookup throws —
 * the signature is REFUSED. An outage must never silently downgrade a regulatory signature to an
 * unverified one; the resident can wait, a falsified training record cannot be taken back.
 *
 * WHAT A SIGNATURE RECORDS. Not just a uid. `signerSnapshot()` returns the registration number, the
 * council, the practitioner's registered name and how it was verified, and the store copies that
 * ONTO the entry/assessment/attestation at the moment of signing. A signature that only said
 * "fb:abc123 signed this" would be unauditable by the University that has to rely on it.
 */
import { getUserClaims } from "./_fbadmin.js";

const DOCTOR_PREFIX = "icu:doctor:";
const doctorKey = (uid) => DOCTOR_PREFIX + String(uid || "");
// Same binding order verify-doctor.js and functions/api/verifications use.
function kv(env) { return (env && (env.CASES_KV || env.GHIS_KV)) || null; }

// identify()/the router namespace a caller as "fb:<firebaseUid>"; KV and Firebase claims are keyed
// by the RAW uid. Getting this wrong would make every lookup miss and — before the fail-closed rule
// below — would have failed OPEN. It is one function, used by every path.
export function rawUid(u) {
  const s = String(u == null ? "" : u);
  return s.replace(/^(fb:|ghis:|cfa:)/, "");
}

export function signerError(code, message) {
  return Object.assign(new Error(code), { status: 403, userMessage: message });
}

/* Resolve the signing identity of `actorUid`, or THROW.
 *
 * Order: the KV doctor record first (it is what the verification pipeline actually writes, and it
 * carries the council and the registered name), then the Firebase custom claim as a fallback for an
 * account verified before the KV record existed. A claim alone is accepted only when it carries a
 * registration number — `verified:true` with no number is not a signature anyone can check.
 */
export async function signerSnapshot(env, actorUid, deps) {
  deps = deps || {};
  const uid = rawUid(actorUid);
  if (!uid) throw signerError("signer_unidentified", "Sign in again before signing a logbook record.");

  // Test seam. Production never passes this.
  if (deps.signer) return deps.signer;

  let rec = null, kvFailed = false;
  const store = deps.kv ? deps.kv : kv(env);
  if (store) {
    try { rec = await store.get(doctorKey(uid), "json"); }
    catch (e) { kvFailed = true; }
  } else {
    kvFailed = true;
  }

  const verifiedByRecord = !!(rec && (rec.verified === true || rec.status === "verified"));
  if (verifiedByRecord) {
    const regNo = String(rec.regNo || rec.extractedRegNo || "").trim();
    if (!regNo) {
      throw signerError("signer_no_registration_number",
        "Your account is verified but carries no registration number, so a signature from it could " +
        "not be checked by anyone. Contact support to complete your verification.");
    }
    return {
      uid, regNo,
      council: String(rec.council || "").trim(),
      name: String(rec.name || rec.extractedName || "").trim(),
      via: String(rec.via || "certificate"),
      verifiedAt: String(rec.verifiedAt || rec.updatedAt || ""),
      source: "register"
    };
  }

  // Fallback: the Firebase custom claim set by the same pipeline.
  let claims = null, claimsFailed = false;
  try { claims = await (deps.getUserClaims || getUserClaims)(env, uid); }
  catch (e) { claimsFailed = true; }
  if (claims && claims.verified === true && String(claims.regNo || "").trim()) {
    return {
      uid, regNo: String(claims.regNo).trim(),
      council: String(claims.council || "").trim(),
      name: String(claims.name || "").trim(),
      via: "claim", verifiedAt: "", source: "claim"
    };
  }

  // FAIL CLOSED. An infrastructure failure is reported as an infrastructure failure — never as
  // "unverified", and never as a pass.
  if (kvFailed && claimsFailed) {
    throw Object.assign(new Error("signer_check_unavailable"), {
      status: 503,
      userMessage: "Your medical registration could not be checked just now, so nothing was signed. " +
        "Nothing has been recorded. Please try again shortly."
    });
  }
  if (rec && (rec.status === "pending" || rec.status === "pending_review")) {
    throw signerError("signer_verification_pending",
      "Your medical registration is still under review. You can read and comment, but you cannot " +
      "sign a logbook record until it is verified.");
  }
  if (rec && rec.status === "rejected") {
    throw signerError("signer_verification_rejected",
      "Your medical registration was not verified. You cannot sign a logbook record.");
  }
  throw signerError("signer_unverified",
    "Verify your medical council registration before signing a logbook record. A PG logbook entry " +
    "is a document a University relies on, and PGMER-2023 §9.2(c) attaches a penalty to a false one, " +
    "so it must carry a registered practitioner's number.");
}

/* The fields written onto a signed record. Deliberately a small, fixed, PHI-free set: the number a
 * University can check, the council that issued it, the registered name, and how it was verified.
 * `prefix` keeps verifiedBy* / assessedBy* / attestedBy* apart on the same document. */
export function signatureFields(prefix, snap, at) {
  const p = String(prefix || "");
  const out = {};
  out[p + "Reg"] = snap.regNo;
  out[p + "Council"] = snap.council || "";
  out[p + "Name"] = snap.name || "";
  out[p + "RegSource"] = snap.source;
  out[p + "RegCheckedAt"] = at;
  return out;
}

/* Is this actor allowed to sign at all? A boolean form for the UI, which uses it to explain WHY the
 * verify button is unavailable instead of showing a button that fails. Never used as the gate — the
 * gate is signerSnapshot() throwing, server-side, on the write path. */
export async function canSign(env, actorUid, deps) {
  try {
    const s = await signerSnapshot(env, actorUid, deps);
    return { ok: true, regNo: s.regNo, council: s.council, name: s.name, source: s.source };
  } catch (e) {
    return { ok: false, reason: e.message, message: e.userMessage || "", status: e.status || 403 };
  }
}
