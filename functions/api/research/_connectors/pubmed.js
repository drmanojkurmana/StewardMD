/* ResearchMD Phase 2.3 PubMed / NCBI E-utilities connector (ES module).
 * Contract: docs/research/contracts/phase-2/connector-api.md.
 * Terms: docs/research/research-2.0b-database-terms.md section 2.
 * - tool and email params on EVERY request; api_key as a URL query param when
 *   configured (header passing is UNCONFIRMED for the legacy CGI endpoints).
 * - 10 req/s with a key, 3 req/s without (token buckets below).
 * - History server (usehistory=y, WebEnv + query_key) with 500-id pages;
 *   esummary batches of 200 (rule 19: never single-record calls).
 * - Batches over 100 requests must run off-peak (weekdays 21:00-05:00 ET or
 *   weekends); enforced conservatively before paging starts.
 * - dateTo binds maxdate with datetype=crdt (create date: the stable field for
 *   the 99% re-query reproducibility gate; publication dates can shift).
 * Attribution ("Courtesy of the U.S. National Library of Medicine") and the
 * freshness disclosure are UI/export duties (rules 12, 14); the archive keeps
 * executedAt so the screen can render them.
 */
import {
  ConnectorError, createBucket, fetchWithRetry, readJson, ncbiDate, isIsoDate,
  requireContactEmail,
} from "./_http.js";

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const TOOL = "StewardMD_ResearchMD";
const SEARCH_PAGE = 500;
const SUMMARY_BATCH = 200;
const KEYED_BUCKET = createBucket(10);
const ANON_BUCKET = createBucket(3);
const FILTER_KEYS = ["dateFrom", "languages", "publicationTypes"];

function optsOf(opts = {}) {
  const email = requireContactEmail(opts);
  return {
    email,
    apiKey: String(opts.apiKey || "").trim(),
    fetchImpl: opts.fetch,
    sleep: opts.sleep,
    random: opts.random,
    now: opts.now || Date.now,
    deadline: opts.deadline === undefined ? Infinity : opts.deadline,
    bucket: opts.bucket || (String(opts.apiKey || "").trim() ? KEYED_BUCKET : ANON_BUCKET),
  };
}

function commonParams(o) {
  const p = new URLSearchParams();
  p.set("tool", TOOL);
  p.set("email", o.email);
  if (o.apiKey) p.set("api_key", o.apiKey);
  return p;
}

function transport(o) {
  return {
    fetchImpl: o.fetchImpl, sleep: o.sleep, random: o.random, now: o.now,
    deadline: o.deadline, bucket: o.bucket,
  };
}

/* Conservative peak-hours check (terms rule 4). ET weekday 05:00-20:59 is peak. */
export function isPeakHours(nowMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false,
  }).formatToParts(new Date(nowMs));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(get("hour")) % 24;
  return hour >= 5 && hour < 21;
}

function buildTerm(query, filters) {
  let term = query;
  if (filters.languages && filters.languages.length)
    term += " AND (" + filters.languages.map((l) => l + "[Language]").join(" OR ") + ")";
  if (filters.publicationTypes && filters.publicationTypes.length)
    term += " AND (" + filters.publicationTypes.map((t) => t + "[Publication Type]").join(" OR ") + ")";
  return term;
}

function validateFilters(filters) {
  const f = filters || {};
  for (const k of Object.keys(f)) {
    if (FILTER_KEYS.indexOf(k) < 0)
      throw new ConnectorError("invalid_search", "Unknown PubMed filter: " + k);
  }
  if (f.dateFrom !== undefined && !isIsoDate(f.dateFrom))
    throw new ConnectorError("invalid_search", "filters.dateFrom must be YYYY-MM-DD");
  for (const k of ["languages", "publicationTypes"]) {
    if (f[k] !== undefined && (!Array.isArray(f[k]) || f[k].some((v) => typeof v !== "string" || !v.trim() || /[\[\]]/.test(v))))
      throw new ConnectorError("invalid_search", "filters." + k + " must be an array of plain terms");
  }
  return f;
}

/* search(query, filters, dateTo) -> { ids, totalCount, metadata } per contract. */
export async function search(query, filters = {}, dateTo = null, opts = {}) {
  if (typeof query !== "string" || !query.trim() || query.length > 4000)
    throw new ConnectorError("invalid_search", "query must be 1-4000 characters");
  const f = validateFilters(filters);
  if (dateTo !== null && dateTo !== undefined && !isIsoDate(dateTo))
    throw new ConnectorError("invalid_search", "dateTo must be YYYY-MM-DD");
  const o = optsOf(opts);
  const executedAt = new Date(o.now()).toISOString();

  const first = commonParams(o);
  first.set("db", "pubmed");
  first.set("term", buildTerm(query.trim(), f));
  first.set("retmax", "0");
  first.set("usehistory", "y");
  first.set("retmode", "json");
  if (dateTo) { first.set("datetype", "crdt"); first.set("maxdate", ncbiDate(dateTo)); }
  if (f.dateFrom) { first.set("datetype", "crdt"); first.set("mindate", ncbiDate(f.dateFrom)); }
  const head = await readJson(await fetchWithRetry(BASE + "esearch.fcgi?" + first.toString(), transport(o)));
  const esr = (head && head.esearchresult) || {};
  const totalCount = parseInt(esr.count, 10) || 0;
  const apiVersion = head && head.header && head.header.version ? "esearch-" + head.header.version : "unknown";
  const metadata = { apiVersion, executedAt, queryEcho: String(esr.querytranslation || "") };
  if (totalCount === 0) return { ids: [], totalCount: 0, metadata };
  if (!esr.webenv || !esr.querykey)
    throw new ConnectorError("search_failed", "PubMed did not return a history server handle");

  /* Terms rule 4: >100 requests must run off-peak. Estimate search pages plus
   * esummary batches and refuse during peak rather than quietly hammering. */
  const estimatedRequests = 1 + Math.ceil(totalCount / SEARCH_PAGE) + Math.ceil(totalCount / SUMMARY_BATCH);
  if (estimatedRequests > 100 && isPeakHours(o.now()))
    throw new ConnectorError("search_rate_limited",
      "This PubMed search needs more than 100 requests; NCBI terms require off-peak hours (weekdays 21:00-05:00 ET or weekends)", 3600000);

  const ids = [];
  for (let retstart = 0; retstart < totalCount; retstart += SEARCH_PAGE) {
    const p = commonParams(o);
    p.set("db", "pubmed");
    p.set("query_key", String(esr.querykey));
    p.set("WebEnv", String(esr.webenv));
    p.set("retstart", String(retstart));
    p.set("retmax", String(SEARCH_PAGE));
    p.set("retmode", "json");
    const page = await readJson(await fetchWithRetry(BASE + "esearch.fcgi?" + p.toString(), transport(o)));
    const list = (page && page.esearchresult && page.esearchresult.idlist) || [];
    if (!list.length)
      throw new ConnectorError("search_failed", "PubMed returned a short page at retstart " + retstart);
    for (const id of list) ids.push(String(id));
  }
  if (ids.length !== totalCount)
    throw new ConnectorError("search_failed", "PubMed id count mismatch: " + ids.length + " of " + totalCount);
  return { ids, totalCount, metadata };
}

/* Batched raw-record fetch (esummary, 200 ids per request). Returns the native
 * records for normalise(); the API persists them, never the adapter. */
export async function fetchRecords(ids, opts = {}) {
  const o = optsOf(opts);
  const out = [];
  for (let i = 0; i < ids.length; i += SUMMARY_BATCH) {
    const p = commonParams(o);
    p.set("db", "pubmed");
    p.set("id", ids.slice(i, i + SUMMARY_BATCH).join(","));
    p.set("retmode", "json");
    const body = await readJson(await fetchWithRetry(BASE + "esummary.fcgi?" + p.toString(), transport(o)));
    const result = (body && body.result) || {};
    const uids = result.uids || ids.slice(i, i + SUMMARY_BATCH);
    for (const uid of uids) if (result[uid]) out.push(result[uid]);
  }
  return out;
}

function yearOf(raw) {
  const m = String(raw.pubdate || raw.epubdate || "").match(/[0-9]{4}/);
  return m ? parseInt(m[0], 10) : null;
}

/* normalise(raw) -> the contract record shape. raw is one esummary record. */
export function normalise(raw) {
  const externalId = String((raw && raw.uid) || "").trim();
  if (!externalId) throw new ConnectorError("invalid_search", "PubMed record has no uid");
  let doi = "";
  const eloc = String(raw.elocationid || "");
  const dm = eloc.match(/10\.[0-9]{4,9}\/[^\s]+/i);
  if (dm) doi = dm[0];
  if (!doi && Array.isArray(raw.articleids)) {
    const hit = raw.articleids.find((a) => a && a.idtype === "doi");
    if (hit) doi = String(hit.value || "");
  }
  return {
    source: "pubmed",
    externalId,
    title: String(raw.title || ""),
    authors: (Array.isArray(raw.authors) ? raw.authors : []).map((a) => String((a && a.name) || "")).filter(Boolean),
    year: yearOf(raw),
    doi: doi.replace(/[.,;]+$/, ""),
    extra: raw,
  };
}