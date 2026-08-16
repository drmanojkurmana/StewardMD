/* _maik_cache.js — semantic answer cache for MaiK (cost + latency).
 *
 * A large share of MaiK questions are the same few hundred common ones ("dose of X", "management of
 * Y"). Caching the generated answer by (normalized question + depth + audience + model + version)
 * turns those into ZERO-token, instant responses. Env-flagged OFF by default (MAIK_ANSWER_CACHE) so
 * the answer path is byte-identical until the owner opts in.
 *
 * SAFETY (never cache anything patient-specific): the caller only invokes this for GENERIC knowledge
 * answers — no computed differential (hasDx), no lazy tiers, no Connect/PHI context. The version
 * component (MAIK_CACHE_VERSION) lets a prompt/model/KB change invalidate the whole cache in one bump.
 */
const PREFIX = "maik:ans:";

export function answerCacheOn(env) {
  return ["1", "true", "on", "yes"].indexOf(String((env && env.MAIK_ANSWER_CACHE) || "").toLowerCase()) >= 0;
}
export function cacheTtl(env) {
  const d = Number(env && env.MAIK_CACHE_TTL_DAYS) || 14;
  return Math.max(1, Math.min(90, d)) * 86400;   // clamp 1..90 days
}
function normQ(q) {
  return String(q == null ? "" : q).toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

/* Build the cache key. sha256hex is passed in (from _usage.js) so this module stays dependency-free
 * and unit-testable. Returns null when the question is too short/empty to safely key. */
export async function answerCacheKey(sha256hex, env, o) {
  o = o || {};
  const q = normQ(o.question);
  if (q.length < 12 || q.split(" ").length < 2) return null;   // too vague to be a stable, safe key
  const ver = String((env && env.MAIK_CACHE_VERSION) || "1");
  const parts = [ver, q, String(o.depth || "std"), String(o.audience || "any"), String(o.model || "def")].join("|");
  return PREFIX + (await sha256hex(parts));
}

export async function getCachedAnswer(store, key) {
  if (!store || !key) return null;
  try { const v = await store.get(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
export async function putCachedAnswer(store, key, payload, env) {
  if (!store || !key || !payload || !payload.text) return false;
  try { await store.put(key, JSON.stringify({ text: payload.text, ts: Date.now() }), { expirationTtl: cacheTtl(env) }); return true; } catch (e) { return false; }
}
