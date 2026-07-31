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

// ── PubMed query sanitization ────────────────────────────────────────────────
// PubMed treats "and"/"or"/"not" as BOOLEAN OPERATORS, so a natural-language question like
// "Carvedilol or Propranolol which is best or better for varices" silently SHATTERS the search
// (each stray "or" splits it into OR-branches) and PubMed returns near-random systematic reviews.
// We therefore build the search from the question's salient KEYWORDS only — dropping operator words
// and question/comparison filler — and let PubMed's automatic term mapping AND them + expand synonyms.
const RESEARCH_STOP = new Set((
  "a an the and or nor not of to in into on at by for from with without vs versus v is are was were " +
  "be been being do does did done should would could can cannot may might will shall must have has had " +
  "which what who whom whose when where why how whether if then than that this these those it its their " +
  "our your my his her they them we us i you he she as also more most least much many any some each " +
  "best better worse worst superior inferior same equal give given single answer please tell think about " +
  "compare comparison between difference good bad prefer preferred choice choose better-or-worse " +
  "use used using role effect effects efficacy safety patient patients adult adults case cases per over " +
  "just also only even still yet now here there really actually simply kindly want need get " +
  "one two three four five six seven eight nine ten so them"
).split(/\s+/));

// The salient keyword set of a question (for building the query AND the relevance guard).
export function researchKeywords(q) {
  const out = [];
  const seen = new Set();
  String(q == null ? "" : q).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).forEach(function (w) {
    w = w.replace(/^-+|-+$/g, "");
    if (w.length > 1 && !RESEARCH_STOP.has(w) && !seen.has(w)) { seen.add(w); out.push(w); }
  });
  return out;
}

// A clean PubMed term: salient keywords only, capped, space-joined (PubMed ANDs + maps them).
// Returns "" when the question carries no usable keywords (e.g. a vague "what do you think?").
export function researchTermFor(q) {
  return researchKeywords(q).slice(0, 12).join(" ").slice(0, 200);
}

// Relevance guard: a retrieved source is on-topic only if its title shares a SPECIFIC (>=5-char)
// keyword with the question. Filters the off-topic systematic reviews PubMed can still return, so we
// never present unrelated papers as "the evidence".
export function sourceOnTopic(title, keywords) {
  const t = String(title || "").toLowerCase();
  for (var i = 0; i < (keywords || []).length; i++) {
    var w = keywords[i];
    if (w && w.length >= 5 && t.indexOf(w) >= 0) return true;
  }
  return false;
}

// Retrieval topic WITH follow-up context. Use the current question's keywords; but when the question
// is a pure follow-up carrying NO topic keyword of its own ("which is better?", "what do you think?",
// "one answer", "why?") — everything filtered as filler — fall back to the most recent PRIOR user turn
// that HAS a topic, so the search stays on what's under discussion. `history` is [{q, a}, ...] (recent
// last). A question that names ANY topic term of its own (even a short one like "DKA") uses itself.
export function researchTopic(q, history) {
  if (researchKeywords(q).length) return researchTermFor(q);
  const h = Array.isArray(history) ? history : [];
  for (var i = h.length - 1; i >= 0; i--) {
    var pq = (h[i] && (h[i].q || h[i].question)) || "";
    if (pq && researchKeywords(pq).length) return researchTermFor(pq + " " + q) || researchTermFor(pq);
  }
  return researchTermFor(q);
}
