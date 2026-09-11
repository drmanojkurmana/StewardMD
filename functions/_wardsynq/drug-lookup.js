/* functions/_wardsynq/drug-lookup.js — last-resort brand -> composition lookup against StewardMD's
 * own national drug database (the `drugs` table behind api.stewardmd.in, ~412k branded products).
 *
 * WHY THIS IS NOT IN THE SAFETY ENGINE. wardsynq-safety.js is deterministic, synchronous and
 * offline: same inputs, same verdict, no network, no clock. That is what makes it a control you can
 * put in a safety case, and it must not be traded away for coverage. So the lookup lives out here in
 * the ASYNC pre-check that already awaits, and it only ever hands the engine a plain composition
 * string to resolve the ordinary way. The engine is unchanged and still runs with no I/O.
 *
 * THE FOUR RULES THIS FILE EXISTS TO KEEP:
 *
 *  1. LOCAL FIRST. It is called only when the compiled pack could not resolve the drug at all. Every
 *     drug already covered by the pack's 1000+ aliases and combinations costs nothing and waits for
 *     nothing; there is no added latency on the common path.
 *  2. FAIL SAFE, NEVER FAIL OPEN. Timeout, network error, rate limit, bad JSON, no match - every one
 *     returns null, the drug stays unresolved, and the caller reports it as NOT CHECKED. A lookup
 *     that did not happen must never read as a check that came back clean. This is the whole point:
 *     the failure mode of a network dependency on a clinical path has to be "we could not check",
 *     not "nothing found".
 *  3. IT CANNOT DELAY A PRESCRIPTION. The CDSS pre-check is advisory-only and never gates the write
 *     (see rx-safety.js). A slow or dead lookup shows the doctor "not checked" and the prescription
 *     proceeds exactly as it does today.
 *  4. IT MUST NOT RESOLVE THE WRONG DRUG. A search endpoint returns near matches; accepting one
 *     blindly would put a different molecule's allergy profile on this order, which is worse than no
 *     answer. A result is used only when the queried name actually appears in the brand it came
 *     back with.
 *
 * Set DRUG_API_BASE="" in the environment to switch it off entirely.
 */

const DEFAULT_BASE = "https://api.stewardmd.in";
const TIMEOUT_MS = 1200;
const CACHE_MAX = 500;

/** Per-isolate memo. Bounded, and it caches misses too - a brand that is not in the DB should not be
 *  asked for again on every keystroke of the same consultation. */
const _cache = new Map();

function cacheGet(key) { return _cache.has(key) ? _cache.get(key) : undefined; }
function cacheSet(key, value) {
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, value);
}

/** PURE. The name a prescriber writes, reduced to what the brand index is keyed on. */
function queryTermFor(drugName) {
  const t = String(drugName == null ? "" : drugName).trim().toLowerCase();
  if (!t) return "";
  // "Augmentin 625 DUO tablet" -> "augmentin". Strengths and forms are noise to a brand index, and
  // the first word is what brand-generics.js already established a prescriber leads with.
  const first = t.split(/[\s/,()+-]+/).filter(Boolean)[0] || "";
  return first.length >= 3 && !/^\d/.test(first) ? first : "";
}

/**
 * PURE. Is this result actually the drug that was asked for, or merely near it?
 *
 * The brand's FIRST WORD must equal the queried term exactly. A substring test is not enough, and
 * that is not a theoretical worry: searching the real database for "Mox" (which in India is a
 * well-known amoxicillin brand) returns "Moxifloxacin 400mg Tablet", whose name contains "mox".
 * Accepting it would have checked a penicillin-allergic patient's amoxicillin against a
 * fluoroquinolone's profile and reported no allergy - the wrong-drug answer this whole file is
 * built to avoid, and worse than returning nothing. Caught 2026-09-07 while testing against live
 * data; a name we cannot confirm is left unresolved and reported as NOT CHECKED.
 */
function isTrustworthyMatch(term, row) {
  if (!term || !row) return false;
  const brandFirst = String(row.brand || "").toLowerCase().split(/[\s/,()+-]+/).filter(Boolean)[0] || "";
  return !!brandFirst && brandFirst === term;
}

/**
 * Brand name -> composition string ("Amoxycillin + Clavulanic Acid"), or null.
 * Never throws. Never blocks longer than TIMEOUT_MS.
 *
 * @param {string} drugName as written on the order
 * @param {object} env Worker env; `DRUG_API_BASE` overrides the host, "" disables
 * @param {{fetchImpl?: Function, timeoutMs?: number}} [deps] test seams
 */
async function lookupComposition(drugName, env, deps) {
  deps = deps || {};
  const base = env && typeof env.DRUG_API_BASE === "string" ? env.DRUG_API_BASE : DEFAULT_BASE;
  if (!base) return null;                                  // explicitly disabled
  const term = queryTermFor(drugName);
  if (!term) return null;

  const cached = cacheGet(term);
  if (cached !== undefined) return cached;

  const doFetch = deps.fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return null;

  let composition = null;
  try {
    const url = `${base.replace(/\/+$/, "")}/brand-search?q=${encodeURIComponent(term)}&limit=3`;
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(deps.timeoutMs || TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (res && res.ok) {
      const body = await res.json();
      for (const row of (body && body.results) || []) {
        if (!row || !row.composition) continue;
        if (!isTrustworthyMatch(term, row)) continue;      // near match, not this drug
        composition = String(row.composition);
        break;
      }
    }
  } catch {
    composition = null;                                    // timeout, network, JSON - all the same
  }
  cacheSet(term, composition);
  return composition;
}

/** Test seam: the memo is per-isolate and otherwise unreachable. */
function _resetCache() { _cache.clear(); }

export { lookupComposition, queryTermFor, isTrustworthyMatch, _resetCache, DEFAULT_BASE, TIMEOUT_MS };
