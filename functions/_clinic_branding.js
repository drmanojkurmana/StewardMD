// Pro white-label clinic branding: a clinic's own logo + name shown on patient-facing surfaces
// (patient queue page, waiting-room wall board, FollowCare portal) with a NON-removable "powered by
// StewardMD". Stored per org in Firestore q_org_branding; logo bytes live in R2 (env.FOLLOWCARE_R2,
// reused - no new bucket). Additive + Pro-gated at upload; brandingFor() returns null unless a logo
// was uploaded, so unbranded clinics render exactly as before.
import { fsGet, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";

const COLL = "q_org_branding";
// SVG is deliberately excluded (script-injection surface for a same-origin-served asset).
const OK_MIME = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };
export const MAX_LOGO_BYTES = 256 * 1024;
export const MAX_NAME_LEN = 60;

// Pure: validate an uploaded logo by content-type + byte size. Returns {ok:true, ext} or {ok:false, error}.
export function validateLogo(mime, size) {
  const ext = OK_MIME[String(mime || "").toLowerCase().split(";")[0].trim()];
  if (!ext) return { ok: false, error: "unsupported_type" };
  if (!size || size <= 0) return { ok: false, error: "empty" };
  if (size > MAX_LOGO_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, ext };
}
// Pure: clean a clinic display name.
export function cleanName(s) { return String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_NAME_LEN); }

export function logoKey(orgId, ext) { return "branding/" + orgId + "/logo." + ext; }
// Served SAME-ORIGIN via the queue endpoint (never a foreign URL -> no mixed content, no third-party tracking).
export function logoUrl(orgId) { return "/api/queue/branding/logo?orgId=" + encodeURIComponent(orgId); }
export function bucket(env) { return env && env.FOLLOWCARE_R2; }

// SAFE read for injecting into patient payloads: returns {clinicLogo, clinicName, ext} or null on any
// error/missing. Callers do `(await brandingFor(...)) || {}` so the base response can never break.
export async function brandingFor(env, orgId) {
  if (!orgId) return null;
  try {
    const d = await fsGet(env, COLL + "/" + orgId);
    if (!d || !d.fields || !d.fields.logoExt) return null;   // no logo uploaded -> not branded
    return { clinicLogo: logoUrl(orgId), clinicName: d.fields.clinicName || "", ext: d.fields.logoExt, updatedAt: d.fields.updatedAt || 0 };
  } catch (e) { return null; }
}

// Persist the branding record (logo bytes already put to R2 by the caller).
export async function putBranding(env, orgId, rec) {
  const existing = await fsGet(env, COLL + "/" + orgId).catch(() => null);
  const fields = { clinicName: cleanName(rec.clinicName), logoExt: rec.ext || "", updatedBy: rec.updatedBy || "", updatedAt: Date.now() };
  await fsCommit(env, [existing ? wUpdate(env, COLL + "/" + orgId, fields) : wCreate(env, COLL + "/" + orgId, fields)]);
  return { ok: true, clinicLogo: logoUrl(orgId), clinicName: fields.clinicName };
}
