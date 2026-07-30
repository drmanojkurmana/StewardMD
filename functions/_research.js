/* StewardMD — MaiK Research Mode (Evidence Review) shared helpers.
 *
 * PURE, no I/O. Kept tiny + separate so the /api/ai/[[path]].js handler AND the unit test share
 * ONE implementation of query normalization + the response-cache key. This module is additive:
 * it changes no existing behaviour.
 *
 * Research Mode is a clinician EVIDENCE REVIEW over trusted medical literature (PubMed/PMC, WHO,
 * CDC, NICE, ICMR, Cochrane and major specialty-society guidelines) — NOT a general web search.
 */

// Normalize a query for the response cache so trivial variants share a key:
// lowercase, trim, collapse internal whitespace, and strip trailing punctuation.
// (e.g. "  Sepsis  FLUIDS? " and "sepsis fluids" both -> "sepsis fluids").
export function normalizeResearchQuery(q) {
  return String(q == null ? "" : q)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s?.!,;:]+$/g, "")
    .trim();
}

// KV cache key. The handler hashes the normalized query (sha256hex) and prefixes it here.
// TTL is applied by the handler (~7 days). A cache HIT must NOT burn a daily evidence-review slot.
export const RESEARCH_CACHE_PREFIX = "maik:research:v1:";
export function researchCacheKey(hash) { return RESEARCH_CACHE_PREFIX + String(hash == null ? "" : hash); }

// The handler calls the daily-cap gate (gateAndCount) ONLY when this returns true — i.e. a genuine
// cache MISS that will hit the LLM. A cache hit returns cachedHit=true, so no slot is consumed.
export function researchConsumesSlot(cacheHit) { return !cacheHit; }

// PubMed publication-type filter for Evidence Review retrieval: guideline / systematic review /
// meta-analysis / practice guideline ONLY (trusted SECONDARY evidence). Kept here so it is testable
// and so the retrieval allow-list never leaks into query REFUSAL (it filters sources, not topics).
export const RESEARCH_PUBTYPE_FILTER =
  "(Practice Guideline[ptyp] OR Guideline[ptyp] OR systematic review[ptyp] OR Meta-Analysis[ptyp])";
