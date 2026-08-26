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

const truthy = (v) => ["1", "true", "on", "yes"].indexOf(String(v || "").toLowerCase()) >= 0;
export function answerCacheOn(env) { return truthy(env && env.MAIK_ANSWER_CACHE); }
export function abstainOn(env) { return truthy(env && env.MAIK_ABSTAIN); }

const CFG_KEY = "maik:cfg";   // owner runtime overrides (AI Control Center) — win over env; no redeploy

/* Effective MaiK config = KV overrides layered over the env defaults. One cheap KV read per answer.
 * Returns { answerCache, abstain, cacheVersion, source } — source flags whether an override is set. */
export async function getRuntimeCfg(store, env) {
  const base = { answerCache: answerCacheOn(env), abstain: abstainOn(env), cacheVersion: String((env && env.MAIK_CACHE_VERSION) || "1") };
  let ov = null;
  try { const v = store && (await store.get(CFG_KEY)); if (v) ov = JSON.parse(v); } catch (e) { ov = null; }
  if (!ov || typeof ov !== "object") return { ...base, source: "env" };
  return {
    answerCache: typeof ov.answerCache === "boolean" ? ov.answerCache : base.answerCache,
    abstain: typeof ov.abstain === "boolean" ? ov.abstain : base.abstain,
    cacheVersion: ov.cacheVersion != null ? String(ov.cacheVersion) : base.cacheVersion,
    source: "override",
  };
}
/* Merge a partial patch into the KV override. patch.clearCache=true bumps cacheVersion (wipes cache).
 * `now` passed in for determinism. Returns the stored override object. */
export async function setRuntimeCfg(store, patch, now) {
  if (!store) return null;
  let cur = {}; try { const v = await store.get(CFG_KEY); if (v) cur = JSON.parse(v) || {}; } catch (e) { cur = {}; }
  patch = patch || {};
  if (typeof patch.answerCache === "boolean") cur.answerCache = patch.answerCache;
  if (typeof patch.abstain === "boolean") cur.abstain = patch.abstain;
  if (patch.clearCache === true || patch.cacheVersion != null) cur.cacheVersion = patch.cacheVersion != null ? String(patch.cacheVersion) : ("v" + (now || Date.now()));
  await store.put(CFG_KEY, JSON.stringify(cur));
  return cur;
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
  const ver = String(o.version != null ? o.version : ((env && env.MAIK_CACHE_VERSION) || "1"));   // runtime override wins
  /* `tier` is part of the key, not a reason to refuse the cache. A lazy tier-1 answer is the LEAD
   * ONLY, so serving it to a request that wanted the whole answer would silently truncate it - but
   * keying on the tier keeps the two apart and lets both be cached. Excluding tiers entirely, which
   * is what this used to do, disabled the cache for every real client: the app sends tier 1 by
   * default (home.js maikLazyOn). Absent/0 keeps the ORIGINAL key shape, so existing entries written
   * before this still hit rather than being orphaned by a format change. */
  const tier = Number(o.tier) || 0;
  const parts = [ver, q, String(o.depth || "std"), String(o.audience || "any"), String(o.model || "def")]
    .concat(tier ? ["t" + tier] : []).join("|");
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
