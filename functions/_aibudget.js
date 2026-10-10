/* functions/_aibudget.js — StewardMD ID Phase 3: per-person monthly AI-token allowance.
 * Pure derivation + a KV-cached cap reader. Monthly allowance (no carry-over) reusing the existing
 * maik:m:<id>:<month> counter as the SPEND, this as the CAP source. Flag-gated by AI_BUDGET_ON.
 *
 * WHO GETS THE FREE ALLOWANCE (owner decision D8, 2026-09-26): a non-Pro account gets
 * BUDGET_FREE_TOKENS only once its MOBILE NUMBER is verified (the `phoneVerified` claim, one number
 * per account: functions/_lifecycle.js bindPhone). Registration verification alone no longer grants
 * it; a registration-verified doctor gets the 7-day Pro through the Pro path, which is unaffected.
 * Callers pass claims.phoneVerified === true as the `phoneVerified` argument below, NOT
 * claims.verified. Pro tiers ignore it.
 * (Task 2 adds getEntitlement/usageKv imports for the KV-cached monthlyCapFor reader.) */

import { getEntitlement } from "./_entitlements.js";
import { usageKv } from "./_usage.js";

export const PREMIUM_MODELS = ["kardiox_ecg19"];
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

// DEFAULT ON since 2026-08-27 (owner decision). The per-tier allowances below are the whole
// point of verifying: an account without a verified mobile gets no Free AI budget (D8, 2026-09-26). Set
// AI_BUDGET_ON=0 to fall back to the legacy flat caps.
export function aiBudgetOn(env) {
  const v = env && env.AI_BUDGET_ON;
  if (v === undefined || v === null || v === "") return true;
  return !(String(v) === "0" || String(v) === "false");
}

// not Pro & mobile not verified -> none (0); not Pro & phoneVerified -> free; Pro+physician -> promax; else pro.
export function budgetTier(isPro, role, phoneVerified) {
  if (!isPro) return phoneVerified === true ? "free" : "none";
  return role === "physician" ? "promax" : "pro";
}
export function roleAllowance(env, isPro, role, phoneVerified) {
  switch (budgetTier(isPro, role, phoneVerified)) {
    case "none": return 0;
    case "free": return num(env && env.BUDGET_FREE_TOKENS, 5000);
    // One Pro allowance (owner, 2026-10-10: "300000 MK per month for pro users"). The old defaults were 1M (Pro) and
    // 3M (physician). A single account can still be raised or lowered in User control (record.aiCapTokens).
    case "promax": return num(env && env.BUDGET_PROMAX_TOKENS, 300000);
    default: return num(env && env.BUDGET_PRO_TOKENS, 300000);
  }
}
export function currentMonthGrant(record, month) {
  if (record && record.aiGrantMonth === month) return Math.max(0, num(record.aiGrantTokens, 0));
  return 0;
}
export function effectiveAllowance(env, isPro, role, phoneVerified, record, month) {
  const base = (record && record.aiCapTokens != null) ? Math.max(0, num(record.aiCapTokens, 0)) : roleAllowance(env, isPro, role, phoneVerified);
  return base + currentMonthGrant(record, month);
}
export function premiumModelAllowed(env, record, key, role) {
  if (record && record.premiumModels && record.premiumModels[key] === true) return true;
  const roles = String((env && env["PREMIUM_" + key.toUpperCase() + "_ROLES"]) || "").split(",").map((s) => s.trim()).filter(Boolean);
  return roles.indexOf(role) >= 0;
}

const CACHE_TTL = 60 * 60 * 26;   // ~26h; also self-heals on month change via the stored month
// v2 (2026-10-10): the Pro allowance changed from 1M/3M to 300,000, so caps cached under the old key must not be served.
function cacheKey(uid) { return "maik:budget:v2:" + uid; }

/* Drop the cached cap for a uid. Call whenever the TIER changes under a user (verification,
 * approval, a grant), or they keep the old allowance for up to CACHE_TTL. */
export async function clearBudgetCache(env, uid, deps) {
  if (!uid) return false;
  const kv = (deps && deps.kv) || usageKv(env);
  if (!kv) return false;
  try { await kv.delete(cacheKey(uid)); return true; } catch (e) { return false; }
}

/* The cache entry records the inputs it was computed from (`in`), and is used only when they match.
 * Without that, a cap computed as "none" (0) before the doctor verified their mobile would be
 * served for ~26 h after they did, and a caller passing a different flag would poison the entry for
 * every other caller. Entries written before 2026-09-26 carry no `in` and are recomputed once. */
function capInputs(isPro, phoneVerified) { return (isPro ? "p" : "f") + (phoneVerified === true ? "1" : "0"); }
export async function monthlyCapFor(env, uid, isPro, phoneVerified, month, deps) {
  if (!aiBudgetOn(env) || !uid) return null;
  deps = deps || {};
  const kv = deps.kv || usageKv(env);
  if (!kv) return null;                                   // no KV -> fail-open to legacy
  const inputs = capInputs(isPro, phoneVerified);
  try {
    const cached = await kv.get(cacheKey(uid), "json");
    if (cached && cached.month === month && cached.in === inputs && typeof cached.cap === "number") return cached.cap;
  } catch (e) { /* fall through to recompute */ }
  const getEnt = deps.getEntitlement || getEntitlement;
  let record = null;
  try { record = await getEnt(env, uid, deps); } catch (e) { record = null; }   // fail-open below
  const role = record && record.role;
  const cap = effectiveAllowance(env, isPro, role, phoneVerified, record, month);
  try { await kv.put(cacheKey(uid), JSON.stringify({ cap, month, in: inputs }), { expirationTtl: CACHE_TTL }); } catch (e) {}
  return cap;
}
export async function invalidateBudgetCache(env, uid, deps) {
  deps = deps || {};
  const kv = deps.kv || usageKv(env);
  if (!kv || !uid) return;
  try { await kv.delete(cacheKey(uid)); } catch (e) {}
}
