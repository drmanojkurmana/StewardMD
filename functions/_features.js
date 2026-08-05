/* functions/_features.js — StewardMD ID Phase 4: Pro feature-toggle switchboard.
 * A generic per-user/role feature registry + pure resolver + a server-side requireFeature gate.
 * Absorbs Phase-3 premiumModels (the resolver honors the legacy map). Server-enforce only,
 * flag-gated by FEATURES_ON (inert/allow when off). */
import { getEntitlement } from "./_entitlements.js";
import { checkActive } from "./_experimental.js";
import { verifyFirebaseToken } from "./_fbauth.js";

export const FEATURE_REGISTRY = [
  { key: "thorex_llm",       label: "ThoreX Learn-more / correlate LLM", defaultOn: true },
  { key: "sknx_llm",         label: "SknX educational-report LLM",        defaultOn: true },
  { key: "thorex_backend",   label: "ThoreX CXR analysis (secure-egress proxy)",  defaultOn: true },
  { key: "sknx_cloud",       label: "SknX cloud classifier (secure-egress proxy)", defaultOn: true },
  { key: "kardiox_ecg19",    label: "KardioX 19-class ECG model",        defaultRoles: [] },
  { key: "scribe_dictation", label: "MaiK Scribe clinical dictation",    defaultRoles: ["physician", "resident"] },
  { key: "lab_watch",        label: "Apple Watch Lab Watch sync",        defaultRoles: ["physician", "resident", "student"] },
  { key: "case_sync",        label: "Cross-device case sync",            defaultOn: true },
  { key: "ward_sync",        label: "Ward Sync / ICU collaboration",     defaultRoles: ["physician", "resident"] },
  { key: "fundx",            label: "FundX module",   defaultRoles: [], experimental: true },
  { key: "kardiox",          label: "KardioX module", defaultRoles: [], experimental: true },
  { key: "thorex",           label: "ThoreX module",  defaultRoles: [], experimental: true }
];
export function featureKeys() { return FEATURE_REGISTRY.map((e) => e.key); }
export function registryEntry(key) { return FEATURE_REGISTRY.find((e) => e.key === key) || null; }
export function featuresOn(env) { return String((env && env.FEATURES_ON) || "") === "1"; }

function envKey(key) { return "FEATURE_" + String(key).toUpperCase(); }
function envRoles(env, key) { const v = env && env[envKey(key) + "_ROLES"]; return v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : null; }
function envDefaultOn(env, key) { return String((env && env[envKey(key) + "_DEFAULT_ON"]) || "") === "1"; }

export function featureAllowed(env, record, key, role) {
  const ff = record && record.featureFlags;
  if (ff && Object.prototype.hasOwnProperty.call(ff, key)) return ff[key] === true;   // explicit per-user wins
  if (record && record.premiumModels && record.premiumModels[key] === true) return true;   // legacy back-compat
  const entry = registryEntry(key);
  if (!entry) return false;
  if (envDefaultOn(env, key) || entry.defaultOn) return true;
  const roles = envRoles(env, key) || entry.defaultRoles || [];
  return roles.indexOf(role) >= 0;
}

function bearer(request) { try { return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""); } catch (e) { return ""; } }

export async function requireFeature(env, request, key, deps) {
  if (!featuresOn(env)) return { allowed: true, reason: "flag_off" };
  deps = deps || {};
  let uid = deps.uid || null;
  if (!uid) { try { uid = await (deps.verifyFirebaseToken || verifyFirebaseToken)(bearer(request), env); } catch (e) { uid = null; } }
  if (!uid) return { allowed: false, reason: "signin_required" };
  let record = null;
  try { record = await (deps.getEntitlement || getEntitlement)(env, uid, deps); } catch (e) { record = null; }   // fail-open
  const role = record && record.role;
  if (featureAllowed(env, record, key, role)) return { allowed: true, uid, role, reason: "granted" };
  const entry = registryEntry(key);
  if (entry && entry.experimental && deps.xaToken) {
    try { const a = await (deps.checkActive || checkActive)(env, key, deps.xaToken); if (a && a.active) return { allowed: true, uid, role, reason: "code" }; } catch (e) {}
  }
  return { allowed: false, uid, role, reason: "feature_off" };
}
