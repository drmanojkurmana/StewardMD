/* StewardMD - Clinical Bulletins: who may sign, who may manage signers.
 *
 * Firebase ID token only. X-Admin-Token is never accepted here: a shared token proves no identity, so it
 * cannot back a clinical signature, and a Cloudflare Access email is not a doctor's verified account.
 * The signer's name, registration number and council come from bulletin_signers (confirmed by an owner
 * against the NMC register), never from the request.
 */
import { verifiedClaimsFor, verifiedEmailOf } from "./_fbauth.js";
import { ownerEmails } from "./_adminauth.js";
import * as repo from "./_bulletins_repo.js";

async function claimsOf(request, env) {
  try { return await verifiedClaimsFor(request, env); } catch (e) { return null; }
}

// -> { ok:true, uid, name, regNo, council } | { ok:false, reason }
export async function signerIdentity(request, env) {
  const claims = await claimsOf(request, env);
  if (!claims || !claims.sub) return { ok: false, reason: "not-signed-in" };
  if (claims.traineeVerified === true && claims.verified !== true) return { ok: false, reason: "trainee" };
  if (claims.verified !== true) return { ok: false, reason: "not-verified" };
  if (!repo.hasDb(env)) return { ok: false, reason: "no-db" };
  const s = await repo.getSigner(env, claims.sub);
  if (!s || s.active !== 1) return { ok: false, reason: "not-a-signer" };
  return { ok: true, uid: claims.sub, name: s.name, regNo: s.reg_no, council: s.council,
    specialties: String(s.specialties || "").split(",").filter(Boolean) };
}

// -> { ok:true, uid, email } | { ok:false, reason }
export async function ownerIdentity(request, env) {
  const claims = await claimsOf(request, env);
  if (!claims || !claims.sub) return { ok: false, reason: "not-signed-in" };
  const email = verifiedEmailOf(claims) || "";
  if (!email || ownerEmails(env).indexOf(email) < 0) return { ok: false, reason: "not-owner" };
  return { ok: true, uid: claims.sub, email };
}
