/* functions/_aibudget.js — StewardMD ID Phase 3: per-person monthly AI-token allowance.
 * Pure derivation + a KV-cached cap reader. Monthly allowance (no carry-over) reusing the existing
 * maik:m:<id>:<month> counter as the SPEND, this as the CAP source. Verified-gated free trial
 * (anti-abuse: fresh accounts can't re-verify a used reg number). Flag-gated by AI_BUDGET_ON.
 * (Task 2 adds getEntitlement/usageKv imports for the KV-cached monthlyCapFor reader.) */

export const PREMIUM_MODELS = ["kardiox_ecg19"];
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

export function aiBudgetOn(env) { return String((env && env.AI_BUDGET_ON) || "") === "1"; }

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
