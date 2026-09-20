/* functions/_features.js — StewardMD ID Phase 4: Pro feature-toggle switchboard.
 * A generic per-user/role feature registry + pure resolver + a server-side requireFeature gate.
 * Absorbs Phase-3 premiumModels (the resolver honors the legacy map). Server-enforce only,
 * flag-gated by FEATURES_ON (inert/allow when off). */
// Only dereferenced inside function bodies (except the literals below): _entitlements.js imports
// this module back, so anything touched at module-eval time would hit the ESM cycle's TDZ.
import { getEntitlement, effectiveTierFor, oncoAddonActive } from "./_entitlements.js";
import { checkActive } from "./_experimental.js";
import { verifyFirebaseToken } from "./_fbauth.js";

// ---- Role x tier matrix ----
// `tiers`      = purchase tiers that include the feature.
// `roles`      = verification roles it ALSO requires (PG Logbook is an NMC trainee document: the
//                tier pays for it, but only an intern/resident may legally keep one).
// `tierRoles`  = a tier admitted only for certain roles (a Trainee gets Ward Sync only as a resident).
// Entries with none of these keep the legacy defaultOn/defaultRoles behaviour untouched.
// Inert unless ROLE_GATES_ON=1 — see featureAllowed().
const PAID_TIERS = ["trainee", "coresident", "pro", "physician", "physicianpro"];
const ATTENDING_TIERS = ["physician", "physicianpro"];
const ALL_TIERS = ["free"].concat(PAID_TIERS);
// Imaging AI is never refused, only rationed. Defaults here; env IMAGING_CAP_<TIER> overrides.
const IMAGING_CAPS = { free: 2, trainee: 4, coresident: 4, pro: 10, physician: 10, physicianpro: 20 };
export const ONCO_TRIAL_DAYS = 3;

export const FEATURE_REGISTRY = [
  { key: "thorex_llm",       label: "ThoreX Learn-more / correlate LLM", defaultOn: true },
  { key: "sknx_llm",         label: "SknX educational-report LLM",        defaultOn: true },
  { key: "thorex_backend",   label: "ThoreX CXR analysis (secure-egress proxy)",  defaultOn: true },
  { key: "sknx_cloud",       label: "SknX cloud classifier (secure-egress proxy)", defaultOn: true },
  { key: "kardiox_ecg19",    label: "KardioX 19-class ECG model",        defaultRoles: [] },
  { key: "scribe_dictation", label: "MaiK Scribe clinical dictation",    defaultRoles: ["physician", "resident"] },
  { key: "lab_watch",        label: "Apple Watch Lab Watch sync",        defaultRoles: ["physician", "resident", "student"], tiers: ["pro", "physician", "physicianpro"] },
  { key: "case_sync",        label: "Cross-device case sync",            defaultOn: true, tiers: PAID_TIERS },
  { key: "ward_sync",        label: "Ward Sync / ICU collaboration",     defaultRoles: ["physician", "resident"],
    tiers: ["coresident", "pro", "physician", "physicianpro"], tierRoles: { trainee: ["resident"] } },
  { key: "fundx",            label: "FundX module",   defaultRoles: [], experimental: true },
  { key: "kardiox",          label: "KardioX module", defaultRoles: [], experimental: true },
  { key: "thorex",           label: "ThoreX module",  defaultRoles: [], experimental: true },
  { key: "sknx",             label: "SknX module",    defaultRoles: [], experimental: true },
  // Ladder features (matrix-gated; live only under ROLE_GATES_ON)
  { key: "clinix_all",       label: "CliniX full library",              tiers: PAID_TIERS },
  { key: "local_ai",         label: "On-device MaiK",                   tiers: ALL_TIERS },   // free for every user (owner, 2026-09-20)
  { key: "pglog",            label: "NMC PG logbook",                   tiers: ["trainee", "coresident"], roles: ["intern", "resident"] },
  { key: "scribe",           label: "MaiK Scribe",                      tiers: ATTENDING_TIERS },
  { key: "followcare",       label: "FollowCare",                       tiers: ATTENDING_TIERS },
  { key: "opd_clinic",       label: "OPD queue / billing / clinic EMR", tiers: ATTENDING_TIERS },
  { key: "clinic_hosted",    label: "Hosted clinic (we hold the PHI)",  tiers: ["physicianpro"] },
  { key: "imaging_ai",       label: "Imaging AI (per-day capped)",      tiers: ALL_TIERS },
  { key: "onco_ai",          label: "Oncology AI extras (add-on/trial)", addon: "onco", trialDays: ONCO_TRIAL_DAYS }
];
export function featureKeys() { return FEATURE_REGISTRY.map((e) => e.key); }
export function registryEntry(key) { return FEATURE_REGISTRY.find((e) => e.key === key) || null; }
export function featuresOn(env) { return String((env && env.FEATURES_ON) || "") === "1"; }

function envKey(key) { return "FEATURE_" + String(key).toUpperCase(); }
function envRoles(env, key) { const v = env && env[envKey(key) + "_ROLES"]; return v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : null; }
function envDefaultOn(env, key) { return String((env && env[envKey(key) + "_DEFAULT_ON"]) || "") === "1"; }

// ---- Matrix resolvers (pure) ----
export function roleGatesOn(env) { return String((env && env.ROLE_GATES_ON) || "") === "1"; }

/* Physician Pro (Rs 899/mo) includes EARLY ACCESS to the four experimental imaging modules — no
 * access code needed (owner decision 2026-09-18). GRANT-ONLY: it never denies, so every other tier
 * keeps exactly today's behaviour (the checkActive access-code path in requireFeature). Listed
 * explicitly rather than derived from `experimental: true` because the paid sub-keys (thorex_llm,
 * sknx_cloud, kardiox_ecg19 ...) are separate registry entries with their own legacy defaults.
 * EARLY ACCESS IS NOT VALIDATION: these models are unvalidated (docs/fundx/VALIDATION-PROGRAM.md)
 * and every surface reached this way must still render its beta/experimental labelling. */
const EARLY_ACCESS_TIERS = ["physicianpro"];
export const EARLY_ACCESS_KEYS = [
  "thorex", "thorex_llm", "thorex_backend",
  "kardiox", "kardiox_ecg19",
  "sknx", "sknx_llm", "sknx_cloud",
  "fundx", "fundx_llm"
];
export function earlyAccessAllows(key, tier) {
  return EARLY_ACCESS_TIERS.indexOf(tier) >= 0 && EARLY_ACCESS_KEYS.indexOf(key) >= 0;
}

// true/false for a tier-gated feature; null when this feature isn't in the matrix (legacy rules
// apply) or needs the record itself (the onco add-on/trial).
export function matrixAllows(key, tier, role) {
  const entry = registryEntry(key);
  if (!entry || !entry.tiers) return null;
  if (entry.tiers.indexOf(tier) >= 0) return !entry.roles || entry.roles.indexOf(role) >= 0;
  const tr = entry.tierRoles && entry.tierRoles[tier];
  return tr ? tr.indexOf(role) >= 0 : false;
}
// Imaging AI is rationed, not refused — free accounts still get a couple of reads a day.
export function imagingCapFor(env, record, now) {
  const tier = effectiveTierFor(record, now);
  const ov = Number(env && env["IMAGING_CAP_" + tier.toUpperCase()]);
  if (Number.isFinite(ov) && ov >= 0) return Math.floor(ov);
  return IMAGING_CAPS[tier] != null ? IMAGING_CAPS[tier] : IMAGING_CAPS.free;
}
// 3-day onco-AI trial per account, started on FIRST USE (not signup) — needsStart tells the caller
// to persist `oncoTrialStart` now, so an account that never opens oncology keeps its trial intact.
export function oncoTrialState(record, now) {
  now = now || Date.now();
  const start = record && record.oncoTrialStart;
  if (start == null) return { active: true, needsStart: true, startedAt: now, endsAt: now + ONCO_TRIAL_DAYS * 86400000 };
  const endsAt = +start + ONCO_TRIAL_DAYS * 86400000;
  return { active: now < endsAt, needsStart: false, startedAt: +start, endsAt };
}
export function oncoAiAllowed(record, now) {
  now = now || Date.now();
  return oncoAddonActive(record, now) || oncoTrialState(record, now).active;
}
// null = the matrix has no opinion; the legacy role/defaultOn rules decide.
function matrixVerdict(record, key, role, now) {
  const entry = registryEntry(key);
  if (!entry) return null;
  if (entry.addon === "onco") return oncoAiAllowed(record, now);
  return matrixAllows(key, effectiveTierFor(record, now), role);
}

export function featureAllowed(env, record, key, role, now) {
  const ff = record && record.featureFlags;
  if (ff && Object.prototype.hasOwnProperty.call(ff, key)) return ff[key] === true;   // explicit per-user wins
  if (record && record.premiumModels && record.premiumModels[key] === true) return true;   // legacy back-compat
  const entry = registryEntry(key);
  if (!entry) return false;
  if (envDefaultOn(env, key)) return true;   // ops escape hatch, above the matrix
  if (roleGatesOn(env)) {
    if (earlyAccessAllows(key, effectiveTierFor(record, now))) return true;   // grant-only, never denies
    const m = matrixVerdict(record, key, role, now); if (m !== null) return m;
  }
  if (entry.defaultOn) return true;
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
