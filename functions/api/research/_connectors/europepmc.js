/* ResearchMD Phase 2.3 Europe PMC REST connector (ES module).
 * Contract: docs/research/contracts/phase-2/connector-api.md.
 * Terms: docs/research/research-2.0b-database-terms.md section 3.
 * - Open API, no key exists; descriptive User-Agent with maintainer mailto.
 * - No published hard quota (UNCONFIRMED); polite 10 req/s bucket.
 * - cursorMark paging (rule 19), pageSize max 1000, format=json explicit.
 * - resultType=lite for search indexing (rule 18); core only for the record
 *   fetch, which carries abstracts and the licence field.
 * - Full text is NOT fetched here. When Phase 3 ingests full text, the licence
 *   field kept in extra must be checked: cc by / cc0 only; NC-licensed and
 *   all-rights-reserved records stay metadata + outbound link (rule 13).
 * Attribution "Data provided by Europe PMC" is a UI/export duty (rule 15).
 */
import {
  ConnectorError, createBucket, fetchWithRetry, readJson, isIsoDate,
  requireContactEmail, politeUserAgent,
} from "./_http.js";

const SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

function resultListOf(body) {
  const rl = body && body.resultList;
  if (Array.isArray(rl)) return rl;
  if (rl && Array.isArray(rl.result)) return rl.result;
  return [];
}
const PAGE_SIZE = 1000;
const FETCH_BATCH = 25;
const BUCKET = createBucket(10);
const FILTER_KEYS = ["dateFrom", "languages", "pubTypes"];

function optsOf(opts = {}) {
  const email = requireContactEmail(opts);
  return {
    headers: { "User-Agent": politeUserAgent(email), "Accept": "application/json" },
    fetchImpl: opts.fetch,
    sleep: opts.sleep,
    random: opts.random,
    now: opts.now || Date.now,
    deadline: opts.deadline === undefined ? Infinity : opts.deadline,
    timeoutMs: opts.timeoutMs === undefined ? 30000 : opts.timeoutMs,
    maxRetries: opts.maxRetries === undefined ? 5 : opts.maxRetries,
    signal: opts.signal || null,
    partialOnBudget: !!opts.partialOnBudget,
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
      throw new ConnectorError("invalid_search", "Unknown Europe PMC filter: " + k);
  }
  if (f.dateFrom !== undefined && !isIsoDate(f.dateFrom))
    throw new ConnectorError("invalid_search", "filters.dateFrom must be YYYY-MM-DD");
  for (const k of ["languages", "pubTypes"]) {
    if (f[k] !== undefined && (!Array.isArray(f[k]) || f[k].some((v) => typeof v !== "string" || !v.trim() || /[\s:()\[\]]/.test(v))))
      throw new ConnectorError("invalid_search", "filters." + k + " must be an array of plain codes");
  }
  return f;
}

function buildQuery(query, f, dateTo) {
  let q = query.trim();
  if (dateTo || f.dateFrom)
    q += " AND FIRST_PDATE:[" + (f.dateFrom || "*") + " TO " + (dateTo || "*") + "]";
  if (f.languages && f.languages.length)
    q += " AND (" + f.languages.map((l) => "LANG:" + l).join(" OR ") + ")";
  if (f.pubTypes && f.pubTypes.length)
    q += " AND (" + f.pubTypes.map((t) => "PUB_TYPE:" + t).join(" OR ") + ")";
  return q;
}

/* search(query, filters, dateTo) -> { ids, totalCount, metadata }.
 * ids are "SRC:id" composites (database order, unique across MED/PMC/AGR...);
 * normalise() derives the dedup key (PMID, DOI or PMCID) from the full record. */
export async function search(query, filters = {}, dateTo = null, opts = {}) {
  if (typeof query !== "string" || !query.trim() || query.length > 4000)
    throw new ConnectorError("invalid_search", "query must be 1-4000 characters");
  const f = validateFilters(filters);
  if (dateTo !== null && dateTo !== undefined && !isIsoDate(dateTo))
    throw new ConnectorError("invalid_search", "dateTo must be YYYY-MM-DD");
  const o = optsOf(opts);
  const executedAt = new Date(o.now()).toISOString();
  const q = buildQuery(query, f, dateTo);

  const ids = [];
  const liteRecords = [];
  let totalCount = null;
  let cursorMark = "*";
  let queryEcho = "";
  let partial = false;
  const searchDeadline = o.partialOnBudget && Number.isFinite(o.deadline)
    ? Math.min(o.deadline, o.now() + Math.max(15000, Math.floor((o.deadline - o.now()) * 0.55)))
    : o.deadline;
  for (;;) {
    if (o.partialOnBudget && ids.length > 0 && o.now() > searchDeadline) {
      partial = true;
      break;
    }
    const p = new URLSearchParams();
    p.set("query", q);
    p.set("resultType", "lite");
    p.set("format", "json");
    p.set("pageSize", String(PAGE_SIZE));
    p.set("cursorMark", cursorMark);
    let body;
    try {
      body = await readJson(await fetchWithRetry(SEARCH_URL + "?" + p.toString(), transport(o)));
    } catch (e) {
      if (o.partialOnBudget && ids.length > 0) {
        partial = true;
        break;
      }
      throw e;
    }
    if (totalCount === null) {
      totalCount = parseInt(body.hitCount, 10) || 0;
      queryEcho = String(body.query || "");
    }
    const list = resultListOf(body);
    for (const r of list) {
      ids.push(String(r.source) + ":" + String(r.id));
      if (liteRecords.length < 200) liteRecords.push(r);
    }
    const next = body.nextCursorMark;
    if (ids.length >= totalCount) break;
    if (!list.length || !next || next === cursorMark)
      throw new ConnectorError("search_failed", "Europe PMC returned a short page at cursor " + cursorMark);
    cursorMark = next;
  }
  if (!partial && ids.length !== totalCount)
    throw new ConnectorError("search_failed", "Europe PMC id count mismatch: " + ids.length + " of " + totalCount);
  /* Keep the lite records even on a complete search: the route falls back to
   * them when the core-record fetch times out, so a slow Europe PMC response
   * cannot leave the project with a run that has zero retrievable records. */
  const out = { ids, totalCount, metadata: { apiVersion: "unknown", executedAt, queryEcho } };
  if (partial) out.partial = true;
  if (liteRecords.length) out.liteRecords = liteRecords;
  return out;
}

/* Batched raw-record fetch (resultType=core for abstracts + licence). */
export async function fetchRecords(ids, opts = {}) {
  const o = optsOf(opts);
  const out = [];
  for (let i = 0; i < ids.length; i += FETCH_BATCH) {
    if (o.partialOnBudget && i > 0 && o.now() > o.deadline) break;
    const parts = ids.slice(i, i + FETCH_BATCH).map((composite) => {
      const at = composite.indexOf(":");
      const src = composite.slice(0, at), id = composite.slice(at + 1);
      return "(EXT_ID:" + id + " AND SRC:" + src + ")";
    });
    const p = new URLSearchParams();
    p.set("query", parts.join(" OR "));
    p.set("resultType", "core");
    p.set("format", "json");
    p.set("pageSize", String(PAGE_SIZE));
    try {
      const body = await readJson(await fetchWithRetry(SEARCH_URL + "?" + p.toString(), transport(o)));
      for (const r of resultListOf(body)) out.push(r);
    } catch (e) {
      if (o.partialOnBudget) break;
      throw e;
    }
  }
  return out;
}

function authorsOf(raw) {
  const list = raw && raw.authorList && raw.authorList.author;
  if (Array.isArray(list) && list.length) {
    return list.map((a) => {
      const family = String((a && a.lastName) || "").trim();
      const initials = String((a && a.initials) || "").trim();
      if (family) return (family + " " + initials).trim();
      return String((a && a.fullName) || "").trim();
    }).filter(Boolean);
  }
  return String((raw && raw.authorString) || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/* normalise(raw) -> the contract record shape. raw is one core/lite record. */
export function normalise(raw) {
  const pmid = String((raw && raw.pmid) || "").trim();
  const doi = String((raw && raw.doi) || "").trim();
  const pmcid = String((raw && raw.pmcid) || "").trim();
  const externalId = pmid || doi || pmcid ||
    (raw && raw.source && raw.id ? String(raw.source) + ":" + String(raw.id) : "");
  if (!externalId) throw new ConnectorError("invalid_search", "Europe PMC record has no external id");
  const year = parseInt(raw && raw.pubYear, 10);
  return {
    source: "europe_pmc",
    externalId,
    title: String((raw && raw.title) || ""),
    authors: authorsOf(raw),
    year: Number.isFinite(year) ? year : null,
    doi,
    extra: raw,
  };
}