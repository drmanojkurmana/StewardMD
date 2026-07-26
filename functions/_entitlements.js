/* functions/_entitlements.js — StewardMD ID Phase 2: per-person entitlement record.
 * Server-only (entitlements/{uid}). Source of truth for role + per-module tier override; the
 * experimental-access gates prefer the person-tier over the device-activation tier when
 * ENTITLEMENTS_ON. Pure derivation + deps-injectable IO so the whole thing is testable offline. */
import * as FS from "./_fbfirestore.js";

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
