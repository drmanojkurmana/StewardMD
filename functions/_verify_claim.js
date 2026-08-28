/* StewardMD — reconcile "is this doctor verified" between its two stores.
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS FOR (reported with a screen recording, 2026-08-27):
 * the verification panel said "Your account is verified ✓" while every Pro feature said "This
 * feature needs a verified registration", at the same moment, for the same account.
 *
 * Both were reading honestly, from different places:
 *   GET /api/verify-doctor  -> the KV doctor record  icu:doctor:<uid>
 *   every entitlement gate  -> the Firebase custom claim  verified / verifiedAt
 *
 * They drift whenever a record was written without the claim landing: a doctor verified before the
 * claim existed, an owner approval that wrote KV but whose claim write failed, a claim cleared by a
 * later merge. Nothing ever reconciled them, so the disagreement was permanent and invisible.
 *
 * THE CLAIM IS AUTHORITATIVE — it is what the gates read, it is signed, and a client cannot forge
 * it. So this heals in one direction only: a RECORD that says verified re-asserts the CLAIM. It
 * never does the reverse, because a stale KV record must not be able to grant entitlement on its
 * own; the record only ever re-states what a real verification already concluded.
 *
 * Best-effort by design: every caller is on a read path that must still answer if this fails.
 */
import { getUserClaims, mergeUserClaims } from "./_fbadmin.js";

function kv(env) { return (env && (env.CASES_KV || env.GHIS_KV)) || null; }
const doctorKey = (uid) => "icu:doctor:" + uid;

/* Returns { healed, status, regNo } — `healed` true only when a claim was actually written, so a
 * caller can bust caches that were computed from the stale answer. */
export async function reconcileVerifiedClaim(env, uid, deps) {
  const out = { healed: false, status: "", regNo: "" };
  if (!uid) return out;
  const store = (deps && deps.kv) || kv(env);
  if (!store) return out;

  let rec = null;
  try { rec = await store.get(doctorKey(uid), "json"); } catch (e) { return out; }
  if (!rec) return out;

  const status = rec.status || (rec.verified ? "verified" : "unverified");
  out.status = status;
  out.regNo = rec.regNo || rec.extractedRegNo || "";
  if (status !== "verified") return out;   // pending / trial / rejected never grant the claim

  let claims = null;
  try { claims = (deps && deps.getUserClaims ? deps.getUserClaims : getUserClaims)(env, uid); claims = await claims; }
  catch (e) { return out; }

  // Already consistent. verifiedAt is required too: without it accessState() computes a zero-length
  // free week, which is the same "verified but no Pro" symptom by a different route.
  if (claims && claims.verified === true && claims.verifiedAt) return out;

  try {
    const merge = (deps && deps.mergeUserClaims) || mergeUserClaims;
    // verifiedAt starts NOW rather than at the original verification date, which we may not have in
    // a usable form. It is the kind direction: a doctor who was already verified gets their full
    // free week rather than one that silently expired before they ever saw it.
    await merge(env, uid, { verified: true, verifiedAt: Date.now(), regNo: out.regNo || (claims && claims.regNo) || "" });
    out.healed = true;
  } catch (e) { /* best effort: the caller still answers */ }
  return out;
}
