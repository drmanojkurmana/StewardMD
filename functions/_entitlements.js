/* functions/_entitlements.js — StewardMD ID Phase 2: per-person entitlement record.
 * Server-only (entitlements/{uid}). Source of truth for role + per-module tier override; the
 * experimental-access gates prefer the person-tier over the device-activation tier when
 * ENTITLEMENTS_ON. Pure derivation + deps-injectable IO so the whole thing is testable offline. */
import * as FS from "./_fbfirestore.js";
import { lookupUidByEmail } from "./_fbadmin.js";

export const ROLES = ["physician", "resident", "student"];
const COLL = "entitlements";

export function normalizeRole(r) {
  const v = String(r || "").trim().toLowerCase();
  return ROLES.indexOf(v) >= 0 ? v : null;
}
// physician -> clinical-only V1; resident/student -> clinical+educational V2 Beta; unset -> V1.
export function roleToTier(role) {
  const r = normalizeRole(role);
  return (r === "resident" || r === "student") ? "v2beta" : "v1";
}
// override_<feature> wins iff exactly v1|v2beta; else role-derived; else v1.
export function effectiveTier(feature, record) {
  const ov = record && record["override_" + feature];
  if (ov === "v1" || ov === "v2beta") return ov;
  return roleToTier(record && record.role);
}
export function entitlementsOn(env) { return String((env && env.ENTITLEMENTS_ON) || "") === "1"; }

export async function getEntitlement(env, uid, deps) {
  const fsGet = (deps && deps.fsGet) || FS.fsGet;
  const d = await fsGet(env, COLL + "/" + uid);
  return (d && d.fields) ? d.fields : null;
}
// Create-or-merge: bare wUpdate patches only the named fields (updateMask), creating the doc if absent.
export async function writeEntitlement(env, uid, patch, deps) {
  const fsCommit = (deps && deps.fsCommit) || FS.fsCommit;
  const wUpdate = (deps && deps.wUpdate) || FS.wUpdate;
  const fields = Object.assign({ uid: uid, updatedAt: Date.now() }, patch);
  await fsCommit(env, [wUpdate(env, COLL + "/" + uid, fields)]);
  return fields;
}

// Server-side StewardMD ID normalization (mirrors the client SMD_STEWARD_ID.normalizeId).
export function normalizeSmdId(s) {
  s = String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  if (s && s.indexOf("SMD-") !== 0 && /^[A-Z0-9]{6}$/.test(s)) s = "SMD-" + s;
  return s;
}
// Matches functions/api/verify-doctor.js regKey().
export function regKey(reg) { return "icu:reg:" + String(reg || "").replace(/[^A-Za-z0-9]/g, "_").toUpperCase(); }

// Resolve an admin-supplied identity to a uid. Owner-gated callers only.
export async function resolveUid(env, identity, deps) {
  deps = deps || {};
  identity = identity || {};
  if (identity.uid) return identity.uid;
  if (identity.smdId) {
    const fsGet = deps.fsGet || FS.fsGet;
    const d = await fsGet(env, "doctorDirectory/" + normalizeSmdId(identity.smdId));
    return (d && d.fields && d.fields.uid) || null;
  }
  if (identity.email) {
    const lookup = deps.lookupUidByEmail || lookupUidByEmail;
    const u = await lookup(env, String(identity.email).trim().toLowerCase());
    return (u && u.uid) || null;
  }
  if (identity.regNo) {
    const kv = deps.kv || (env && (env.CASES_KV || env.GHIS_KV));
    if (!kv) return null;
    const uid = await kv.get(regKey(identity.regNo));
    return uid || null;
  }
  return null;
}
