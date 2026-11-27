/* ResearchMD Phase 2.3 Crossref REST connector (ES module).
 * Contract: docs/research/contracts/phase-2/connector-api.md.
 * Terms: docs/research/research-2.0b-database-terms.md section 4.
 * - Polite pool: mailto query param AND a User-Agent with mailto on every
 *   request (rules 5, 6). Optional Metadata Plus token via the
 *   crossref-api-key header when configured.
 * - 10 req/s bucket; list queries run sequentially (concurrency 1, under the
 *   polite pool's 3-connection list limit).
 * - cursor=* deep paging (rule 19), rows max 1000, select= field minimisation
 *   (rule 18).
 * - x-rate-limit-* / x-api-pool headers are inspected on every response. The
 *   terms' "pause below 20% capacity" rule needs a remaining-capacity header
 *   that Crossref does not document (UNCONFIRMED), so the connector relies on
 *   the documented 429 + exponential backoff behaviour instead.
 * Metadata is CC0: store indefinitely. Attribution "Metadata provided by
 * Crossref" and https://doi.org/ links are UI/export duties (rule 16).
 */
import {
  ConnectorError, createBucket, fetchWithRetry, readJson, isIsoDate,
  requireContactEmail, politeUserAgent,
} from "./_http.js";

const WORKS_URL = "https://api.crossref.org/works";
const PAGE_ROWS = 1000;
const FETCH_BATCH = 20;
const SELECT = "DOI,title,author,published,abstract,URL,container-title";
const BUCKET = createBucket(10);
const FILTER_KEYS = ["dateFrom", "type"];
const RATE_HEADERS = ["x-rate-limit-limit", "x-rate-limit-interval", "x-concurrency-limit", "x-api-pool"];
const UPDATE_SELECT = "DOI,update-to,published,created";
const RETRACTION_TTL_SECONDS = 24 * 60 * 60;
const UPDATE_CHUNK = 20;
const RETRACTION_SOURCE = "Crossref / Retraction Watch";
const UPDATE_STATUS = { retraction: "retracted", expression_of_concern: "expression_of_concern" };

function optsOf(opts = {}) {
  const email = requireContactEmail(opts);
  const headers = { "User-Agent": politeUserAgent(email), "Accept": "application/json" };
  if (opts.plusToken) headers["crossref-api-key"] = "Bearer " + String(opts.plusToken).trim();
  return {
    email, headers,
    fetchImpl: opts.fetch,
    sleep: opts.sleep,
    random: opts.random,
    now: opts.now || Date.now,
    deadline: opts.deadline === undefined ? Infinity : opts.deadline,
    timeoutMs: opts.timeoutMs === undefined ? 30000 : opts.timeoutMs,
    maxRetries: opts.maxRetries === undefined ? 5 : opts.maxRetries,
    signal: opts.signal || null,
    bucket: opts.bucket || BUCKET,
  };
}

function transport(o) {
  return {
    headers: o.headers, fetchImpl: o.fetchImpl, sleep: o.sleep, random: o.random,
    now: o.now, deadline: o.deadline, timeoutMs: o.timeoutMs, maxRetries: o.maxRetries, signal: o.signal, bucket: o.bucket,
  };
}

function validateFilters(filters) {
  const f = filters || {};
  for (const k of Object.keys(f)) {
    if (FILTER_KEYS.indexOf(k) < 0)
      throw new ConnectorError("invalid_search", "Unknown Crossref filter: " + k);
  }
  if (f.dateFrom !== undefined && !isIsoDate(f.dateFrom))
    throw new ConnectorError("invalid_search", "filters.dateFrom must be YYYY-MM-DD");
  if (f.type !== undefined && (typeof f.type !== "string" || !/^[a-z0-9-]+$/.test(f.type)))
    throw new ConnectorError("invalid_search", "filters.type must be a Crossref type slug");
  return f;
}

function filterString(f, dateTo) {
  const parts = [];
  if (f.dateFrom) parts.push("from-pub-date:" + f.dateFrom);
  if (dateTo) parts.push("until-pub-date:" + dateTo);
  if (f.type) parts.push("type:" + f.type);
  return parts.join(",");
}

function noteRateHeaders(res, seen) {
  for (const h of RATE_HEADERS) {
    const v = res.headers && typeof res.headers.get === "function" ? res.headers.get(h) : null;
    if (v !== null && v !== undefined) seen[h] = v;
  }
}

/* search(query, filters, dateTo) -> { ids, totalCount, metadata }.
 * ids are DOIs in database order. */
export async function search(query, filters = {}, dateTo = null, opts = {}) {
  if (typeof query !== "string" || !query.trim() || query.length > 4000)
    throw new ConnectorError("invalid_search", "query must be 1-4000 characters");
  const f = validateFilters(filters);
  if (dateTo !== null && dateTo !== undefined && !isIsoDate(dateTo))
    throw new ConnectorError("invalid_search", "dateTo must be YYYY-MM-DD");
  const o = optsOf(opts);
  const executedAt = new Date(o.now()).toISOString();
  const filter = filterString(f, dateTo);
  const rateHeaders = {};

  const ids = [];
  let totalCount = null;
  let cursor = "*";
  for (;;) {
    const p = new URLSearchParams();
    p.set("query", query.trim());
    p.set("rows", String(PAGE_ROWS));
    p.set("cursor", cursor);
    p.set("select", SELECT);
    p.set("mailto", o.email);
    if (filter) p.set("filter", filter);
    const res = await fetchWithRetry(WORKS_URL + "?" + p.toString(), transport(o));
    noteRateHeaders(res, rateHeaders);
    const body = await readJson(res);
    const message = (body && body.message) || {};
    if (totalCount === null) totalCount = parseInt(message["total-results"], 10) || 0;
    const items = message.items || [];
    for (const it of items) if (it && it.DOI) ids.push(String(it.DOI));
    const next = message["next-cursor"];
    if (ids.length >= totalCount) break;
    if (!items.length || !next)
      throw new ConnectorError("search_failed", "Crossref returned a short page at cursor " + cursor);
    cursor = next;
  }
  if (ids.length !== totalCount)
    throw new ConnectorError("search_failed", "Crossref id count mismatch: " + ids.length + " of " + totalCount);
  return { ids, totalCount, metadata: { apiVersion: "unknown", executedAt, queryEcho: "" }, rateHeaders };
}

/* Batched raw-record fetch: same-key doi filters are ORed by Crossref. */
export async function fetchRecords(ids, opts = {}) {
  const o = optsOf(opts);
  const out = [];
  for (let i = 0; i < ids.length; i += FETCH_BATCH) {
    const batch = ids.slice(i, i + FETCH_BATCH);
    const p = new URLSearchParams();
    p.set("filter", batch.map((d) => "doi:" + d).join(","));
    p.set("rows", String(batch.length));
    p.set("select", SELECT);
    p.set("mailto", o.email);
    const res = await fetchWithRetry(WORKS_URL + "?" + p.toString(), transport(o));
    noteRateHeaders(res, {});
    const body = await readJson(res);
    for (const it of (body && body.message && body.message.items) || []) out.push(it);
  }
  return out;
}

function yearOf(raw) {
  const parts = raw && raw.published && raw.published["date-parts"];
  const y = parts && parts[0] && parts[0][0];
  return typeof y === "number" && Number.isFinite(y) ? y : null;
}

/* normalise(raw) -> the contract record shape. raw is one works item. */
export function normalise(raw) {
  const externalId = String((raw && raw.DOI) || "").trim();
  if (!externalId) throw new ConnectorError("invalid_search", "Crossref record has no DOI");
  return {
    source: "crossref",
    externalId,
    title: String((raw && Array.isArray(raw.title) && raw.title[0]) || ""),
    authors: (Array.isArray(raw && raw.author) ? raw.author : []).map((a) => {
      if (a && a.family) return (String(a.family) + " " + String(a.given || "")).trim();
      return String((a && a.name) || "").trim();
    }).filter(Boolean),
    year: yearOf(raw),
    doi: externalId,
    extra: raw,
  };
}

/* ---- Retractions and expressions of concern (Crossref / Retraction Watch) ---
 * Crossref returns editorial notices through the `updates:{DOI}` filter; each
 * notice work carries `update-to` entries naming the affected DOI, the notice
 * type and the date. Retraction Watch records are included in Crossref with
 * `source: "retraction-watch"`. Only retraction and expression_of_concern are
 * surfaced; corrections, errata and withdrawals are not retractions.
 * Results are cached in the Cloudflare Cache API for 24 hours. */

function normDoi(value) {
  let d = String(value || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  d = d.replace(/[.,;:\s]+$/, "");
  return d.indexOf("10.") === 0 ? d : "";
}

function isoDateOf(obj) {
  const p = obj && obj["date-parts"] && obj["date-parts"][0];
  if (!p || !p[0]) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return String(p[0]) + "-" + pad(p[1] || 1) + "-" + pad(p[2] || 1);
}

function defaultCache() {
  try {
    return typeof caches !== "undefined" && caches && caches.default ? caches.default : null;
  } catch (e) {
    return null;
  }
}

function retractionCacheKey(doi) {
  return "https://stewardmd.in/__research_cache/crossref/retraction/v1/" + encodeURIComponent(doi);
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

async function cacheWrite(cache, key, value, ttlSeconds) {
  if (!cache || typeof cache.put !== "function") return;
  try {
    await cache.put(key, new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json", "cache-control": "max-age=" + ttlSeconds },
    }));
  } catch (e) {
    /* Cache API is an optimisation; a write failure never fails the lookup. */
  }
}

function noneResult() {
  return { status: "none", date: "", noticeDoi: "", source: RETRACTION_SOURCE };
}

/* batches: [{doi}] -> { "<doi>": {status,date,noticeDoi,source} }.
 * `status` is retracted | expression_of_concern | none. A retraction outranks
 * an expression of concern for the same DOI; ties use the latest notice date. */
export async function retractionsForDois(dois, opts = {}) {
  const o = optsOf(opts);
  const cache = opts.cache === undefined ? defaultCache() : opts.cache;
  const wanted = [];
  for (const raw of (Array.isArray(dois) ? dois : [])) {
    const d = normDoi(raw);
    if (d && wanted.indexOf(d) < 0) wanted.push(d);
  }
  const out = {};
  const misses = [];
  for (const d of wanted) {
    const cached = await cacheRead(cache, retractionCacheKey(d));
    if (cached && (cached.status === "retracted" || cached.status === "expression_of_concern" || cached.status === "none")) {
      out[d] = cached;
    } else {
      misses.push(d);
    }
  }
  const found = {};
  for (let i = 0; i < misses.length; i += UPDATE_CHUNK) {
    const chunk = misses.slice(i, i + UPDATE_CHUNK);
    const p = new URLSearchParams();
    p.set("filter", chunk.map((d) => "updates:" + d).join(","));
    p.set("rows", "1000");
    p.set("select", UPDATE_SELECT);
    p.set("mailto", o.email);
    const body = await readJson(await fetchWithRetry(WORKS_URL + "?" + p.toString(), transport(o)));
    const items = (body && body.message && body.message.items) || [];
    for (const item of items) {
      const noticeDoi = String((item && item.DOI) || "");
      const updates = Array.isArray(item && item["update-to"]) ? item["update-to"] : [];
      for (const update of updates) {
        const target = normDoi(update && update.DOI);
        if (!target || chunk.indexOf(target) < 0) continue;
        const status = UPDATE_STATUS[String((update && update.type) || "").toLowerCase()];
        if (!status) continue;
        const date = isoDateOf(update.updated) || isoDateOf(item.published) || isoDateOf(item.created);
        const rank = status === "retracted" ? 2 : 1;
        const prev = found[target];
        if (!prev || rank > prev.rank || (rank === prev.rank && date > prev.date)) {
          found[target] = { status, date, noticeDoi, rank };
        }
      }
    }
  }
  for (const d of misses) {
    const hit = found[d];
    const result = hit
      ? { status: hit.status, date: hit.date, noticeDoi: hit.noticeDoi, source: RETRACTION_SOURCE }
      : noneResult();
    out[d] = result;
    await cacheWrite(cache, retractionCacheKey(d), result, RETRACTION_TTL_SECONDS);
  }
  return out;
}

/* retractionForDoi(doi) -> {status,date,noticeDoi,source}. */
export async function retractionForDoi(doi, opts = {}) {
  const d = normDoi(doi);
  if (!d) throw new ConnectorError("invalid_search", "doi must be a valid DOI");
  const map = await retractionsForDois([d], opts);
  return map[d];
}