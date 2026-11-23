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
    bucket: opts.bucket || BUCKET,
  };
}

function transport(o) {
  return {
    headers: o.headers, fetchImpl: o.fetchImpl, sleep: o.sleep, random: o.random,
    now: o.now, deadline: o.deadline, bucket: o.bucket,
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