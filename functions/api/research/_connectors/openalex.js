/* ResearchMD Phase 1.4 OpenAlex connector (ES module).
 * Terms: docs/research/research-2.0b-database-terms.md section 8.
 * - Server side only. Outbound requests carry DOIs or PMIDs, never case text.
 * - Key read from env.OPENALEX_API_KEY by the route and passed in; it is sent
 *   as the documented `api_key` query parameter. A missing key makes the
 *   feature unavailable (the app hides it) and never reaches the network.
 * - Batch lookup uses the documented OR filter (`doi:a|b|c`, `pmid:1|2`).
 *   Same-field OR is supported; mixing filters with `|` is not, so DOIs and
 *   PMIDs are requested separately. At most 50 values per request (the
 *   documented OR limit is 100; 50 keeps URLs short).
 * - Every work is cached for 7 days in the Cloudflare Cache API, keyed by the
 *   normalised DOI or PMID that was looked up.
 * - Attribution "Data: OpenAlex" is a UI duty. https://openalex.org terms.
 */
import { ConnectorError, createBucket, fetchWithRetry, readJson } from "./_http.js";

const WORKS_URL = "https://api.openalex.org/works";
const SELECT = "id,doi,ids,title,publication_year,cited_by_count,open_access,best_oa_location,related_works,locations";
const SELECT_RELATED = "id,title,publication_year,doi";
const BUCKET = createBucket(5);
const BATCH = 50;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_RELATED = 5;
const SOURCE = "OpenAlex";

function optsOf(opts = {}) {
  const apiKey = String(opts.apiKey || "").trim();
  if (!apiKey) throw new ConnectorError("unavailable", "OpenAlex is not configured");
  return {
    apiKey,
    mailto: String(opts.contactEmail || "").trim(),
    fetchImpl: opts.fetch,
    sleep: opts.sleep,
    random: opts.random,
    now: opts.now || Date.now,
    deadline: opts.deadline === undefined ? Infinity : opts.deadline,
    bucket: opts.bucket || BUCKET,
    cache: opts.cache === undefined ? defaultCache() : opts.cache,
  };
}

function transport(o) {
  return {
    fetchImpl: o.fetchImpl, sleep: o.sleep, random: o.random, now: o.now,
    deadline: o.deadline, bucket: o.bucket,
  };
}

function defaultCache() {
  try {
    return typeof caches !== "undefined" && caches && caches.default ? caches.default : null;
  } catch (e) {
    return null;
  }
}

function cacheKey(kind, id) {
  return "https://stewardmd.in/__research_cache/openalex/work/v1/" + kind + "/" + encodeURIComponent(id);
}

async function cacheRead(cache, key) {
  if (!cache || typeof cache.match !== "function") return null;
  try {
    const res = await cache.match(key);
    if (!res) return null;
    const body = await res.json();
    return body && typeof body === "object" ? body : null;
  } catch (e) {
    return null;
  }
}

async function cacheWrite(cache, key, value) {
  if (!cache || typeof cache.put !== "function") return;
  try {
    await cache.put(key, new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json", "cache-control": "max-age=" + TTL_SECONDS },
    }));
  } catch (e) {
    /* Cache API is an optimisation; a write failure never fails the lookup. */
  }
}

function normDoi(value) {
  let d = String(value || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  d = d.replace(/[.,;:\s]+$/, "");
  return d.indexOf("10.") === 0 ? d : "";
}

function shortId(value) {
  const s = String(value || "");
  return s.slice(s.lastIndexOf("/") + 1);
}

function pmidOf(raw) {
  const ids = (raw && raw.ids) || {};
  const m = String(ids.pmid || "").match(/(\d+)\s*$/);
  return m ? m[1] : "";
}

function workOf(raw) {
  const r = raw || {};
  const oa = r.open_access || {};
  const best = r.best_oa_location || null;
  const bestUrl = String(oa.oa_url || (best && (best.pdf_url || best.landing_page_url)) || "");
  return {
    source: SOURCE,
    id: shortId(r.id),
    doi: normDoi(r.doi),
    pmid: pmidOf(r),
    title: String(r.title || r.display_name || ""),
    year: Number.isInteger(r.publication_year) ? r.publication_year : null,
    citedByCount: Number.isFinite(r.cited_by_count) ? r.cited_by_count : 0,
    oaStatus: String(oa.oa_status || "closed"),
    bestOaUrl: /^https:\/\//i.test(bestUrl) ? bestUrl : "",
    relatedWorks: [],
    __rawRelated: Array.isArray(r.related_works) ? r.related_works : [],
  };
}

async function fetchWorks(field, ids, o) {
  const p = new URLSearchParams();
  p.set("filter", field + ":" + ids.join("|"));
  p.set("per_page", "100");
  p.set("select", SELECT);
  p.set("api_key", o.apiKey);
  if (o.mailto) p.set("mailto", o.mailto);
  const body = await readJson(await fetchWithRetry(WORKS_URL + "?" + p.toString(), transport(o)));
  return (body && Array.isArray(body.results) ? body.results : []);
}

async function fetchRelated(ids, o) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const p = new URLSearchParams();
    p.set("filter", "openalex_id:" + chunk.join("|"));
    p.set("per_page", "100");
    p.set("select", SELECT_RELATED);
    p.set("api_key", o.apiKey);
    if (o.mailto) p.set("mailto", o.mailto);
    const body = await readJson(await fetchWithRetry(WORKS_URL + "?" + p.toString(), transport(o)));
    for (const raw of (body && Array.isArray(body.results) ? body.results : [])) {
      const id = shortId(raw && raw.id);
      if (!id) continue;
      out.set(id, {
        id,
        title: String((raw && (raw.title || raw.display_name)) || ""),
        year: Number.isInteger(raw && raw.publication_year) ? raw.publication_year : null,
        doi: normDoi(raw && raw.doi),
      });
    }
  }
  return out;
}

/* lookupWorks({dois, pmids}, opts) -> [work].
 * work = {source,id,doi,pmid,title,year,citedByCount,oaStatus,bestOaUrl,
 *         relatedWorks:[{id,title,year,doi}]}.
 * A DOI and a PMID from the same work resolve to one entry. */
export async function lookupWorks(input, opts = {}) {
  const o = optsOf(opts);
  const dois = [];
  const pmids = [];
  for (const raw of (Array.isArray(input && input.dois) ? input.dois : [])) {
    const d = normDoi(raw);
    if (d && dois.indexOf(d) < 0) dois.push(d);
  }
  for (const raw of (Array.isArray(input && input.pmids) ? input.pmids : [])) {
    const p = String(raw || "").trim();
    if (/^\d{1,9}$/.test(p) && pmids.indexOf(p) < 0) pmids.push(p);
  }
  if (!dois.length && !pmids.length) return [];

  const cached = new Map();
  const missDois = [];
  const missPmids = [];
  for (const d of dois) {
    const hit = await cacheRead(o.cache, cacheKey("doi", d));
    if (hit && hit.id) cached.set("doi:" + d, hit);
    else missDois.push(d);
  }
  for (const p of pmids) {
    const hit = await cacheRead(o.cache, cacheKey("pmid", p));
    if (hit && hit.id) cached.set("pmid:" + p, hit);
    else missPmids.push(p);
  }

  const fresh = new Map();
  const byDoi = new Map();
  const byPmid = new Map();
  for (let i = 0; i < missDois.length; i += BATCH) {
    const chunk = missDois.slice(i, i + BATCH);
    for (const raw of await fetchWorks("doi", chunk, o)) {
      const work = workOf(raw);
      if (!work.id) continue;
      fresh.set(work.id, work);
      if (work.doi) byDoi.set(work.doi, work);
      for (const u of (Array.isArray(raw && raw.locations) ? raw.locations : [])) {
        const ud = normDoi(u && u.doi);
        if (ud) byDoi.set(ud, work);
      }
    }
  }
  for (let i = 0; i < missPmids.length; i += BATCH) {
    const chunk = missPmids.slice(i, i + BATCH);
    for (const raw of await fetchWorks("pmid", chunk, o)) {
      const work = workOf(raw);
      if (!work.id) continue;
      fresh.set(work.id, work);
      if (work.pmid) byPmid.set(work.pmid, work);
      if (work.doi) byDoi.set(work.doi, work);
    }
  }

  /* Expand related works for newly fetched records. A related-work failure
   * leaves the citation counts usable instead of hiding the whole feature. */
  const relatedIds = [];
  const relatedFor = new Map();
  for (const work of fresh.values()) {
    const sourceRaw = work.__rawRelated;
    if (Array.isArray(sourceRaw)) {
      for (const idUrl of sourceRaw) {
        const id = shortId(idUrl);
        if (id && relatedIds.indexOf(id) < 0) relatedIds.push(id);
      }
    }
  }
  if (relatedIds.length) {
    try {
      const map = await fetchRelated(relatedIds, o);
      for (const [id, item] of map) relatedFor.set(id, item);
    } catch (e) {
      /* best effort */
    }
  }

  const results = [];
  const seen = new Set();
  const addWork = (work, relatedIdsForWork) => {
    if (!work || !work.id || seen.has(work.id)) return;
    seen.add(work.id);
    if (Array.isArray(relatedIdsForWork)) {
      const related = [];
      for (const idUrl of relatedIdsForWork) {
        const id = shortId(idUrl);
        const item = relatedFor.get(id);
        if (item) related.push(item);
        if (related.length >= MAX_RELATED) break;
      }
      work.relatedWorks = related;
    }
    delete work.__rawRelated;
    results.push(work);
  };

  for (const d of missDois) {
    const work = byDoi.get(d);
    if (work) {
      addWork(work, work.__rawRelated);
      await cacheWrite(o.cache, cacheKey("doi", d), work);
    }
  }
  for (const p of missPmids) {
    const work = byPmid.get(p);
    if (work) {
      addWork(work, work.__rawRelated);
      await cacheWrite(o.cache, cacheKey("pmid", p), work);
    }
  }
  for (const hit of cached.values()) {
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      results.push(hit);
    }
  }
  return results;
}

/* Exported for route/tests: cache and source constants. */
export const cacheTtlSeconds = TTL_SECONDS;
export const sourceLabel = SOURCE;