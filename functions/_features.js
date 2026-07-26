/* functions/_features.js — StewardMD ID Phase 4: Pro feature-toggle switchboard.
 * A generic per-user/role feature registry + pure resolver + a server-side requireFeature gate.
 * Absorbs Phase-3 premiumModels (the resolver honors the legacy map). Server-enforce only,
 * flag-gated by FEATURES_ON (inert/allow when off). */
export const FEATURE_REGISTRY = [
  { key: "thorex_llm",       label: "ThoreX Learn-more / correlate LLM", defaultOn: true },
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
