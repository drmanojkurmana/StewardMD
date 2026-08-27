/* functions/_aibudget.js — StewardMD ID Phase 3: per-person monthly AI-token allowance.
 * Pure derivation + a KV-cached cap reader. Monthly allowance (no carry-over) reusing the existing
 * maik:m:<id>:<month> counter as the SPEND, this as the CAP source. Verified-gated free trial
 * (anti-abuse: fresh accounts can't re-verify a used reg number). Flag-gated by AI_BUDGET_ON.
 * (Task 2 adds getEntitlement/usageKv imports for the KV-cached monthlyCapFor reader.) */

import { getEntitlement } from "./_entitlements.js";
import { usageKv } from "./_usage.js";

export const PREMIUM_MODELS = ["kardiox_ecg19"];
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

// DEFAULT ON since 2026-08-27 (owner decision). The per-tier allowances above are the whole
// point of verifying: an unverified account gets no AI budget, a verified one does. Set
// AI_BUDGET_ON=0 to fall back to the legacy flat caps.
export function aiBudgetOn(env) {
  const v = env && env.AI_BUDGET_ON;
  if (v === undefined || v === null || v === "") return true;
  return !(String(v) === "0" || String(v) === "false");
}

// not Pro & not verified -> none (0); not Pro & verified -> free trial; Pro+physician -> promax; else pro.
export function budgetTier(isPro, role, verified) {
  if (!isPro) return verified ? "free" : "none";
  return role === "physician" ? "promax" : "pro";
}
export function roleAllowance(env, isPro, role, verified) {
  switch (budgetTier(isPro, role, verified)) {
    case "none": return 0;
    case "free": return num(env && env.BUDGET_FREE_TOKENS, 5000);
    case "promax": return num(env && env.BUDGET_PROMAX_TOKENS, 3000000);
    default: return num(env && env.BUDGET_PRO_TOKENS, 1000000);
  }
}
export function currentMonthGrant(record, month) {
  if (record && record.aiGrantMonth === month) return Math.max(0, num(record.aiGrantTokens, 0));
  return 0;
}
export function effectiveAllowance(env, isPro, role, verified, record, month) {
  const base = (record && record.aiCapTokens != null) ? Math.max(0, num(record.aiCapTokens, 0)) : roleAllowance(env, isPro, role, verified);
  return base + currentMonthGrant(record, month);
}
export function premiumModelAllowed(env, record, key, role) {
  if (record && record.premiumModels && record.premiumModels[key] === true) return true;
  const roles = String((env && env["PREMIUM_" + key.toUpperCase() + "_ROLES"]) || "").split(",").map((s) => s.trim()).filter(Boolean);
  return roles.indexOf(role) >= 0;
}

const CACHE_TTL = 60 * 60 * 26;   // ~26h; also self-heals on month change via the stored month
function cacheKey(uid) { return "maik:budget:" + uid; }

/* Drop the cached cap for a uid. Call whenever the TIER changes under a user (verification,
 * approval, a grant), or they keep the old allowance for up to CACHE_TTL. */
export async function clearBudgetCache(env, uid, deps) {
  if (!uid) return false;
  const kv = (deps && deps.kv) || usageKv(env);
  if (!kv) return false;
  try { await kv.delete(cacheKey(uid)); return true; } catch (e) { return false; }
}

export async function monthlyCapFor(env, uid, isPro, verified, month, deps) {
  if (!aiBudgetOn(env) || !uid) return null;
  deps = deps || {};
  const kv = deps.kv || usageKv(env);
  if (!kv) return null;                                   // no KV -> fail-open to legacy
  try {
    const cached = await kv.get(cacheKey(uid), "json");
    if (cached && cached.month === month && typeof cached.cap === "number") return cached.cap;
  } catch (e) { /* fall through to recompute */ }
  const getEnt = deps.getEntitlement || getEntitlement;
  let record = null;
  try { record = await getEnt(env, uid, deps); } catch (e) { record = null; }   // fail-open below
  const role = record && record.role;
  const cap = effectiveAllowance(env, isPro, role, verified, record, month);
  try { await kv.put(cacheKey(uid), JSON.stringify({ cap, month }), { expirationTtl: CACHE_TTL }); } catch (e) {}
  return cap;
}
export async function invalidateBudgetCache(env, uid, deps) {
  deps = deps || {};
  const kv = deps.kv || usageKv(env);
  if (!kv || !uid) return;
  try { await kv.delete(cacheKey(uid)); } catch (e) {}
}
