/* ResearchMD ClinicalTrials.gov API v2 connector (ES module).
 * Terms: docs/research/research-2.0b-database-terms.md section 6.
 * - Base URL: https://clinicaltrials.gov/api/v2 (open public REST API, no key).
 * - Rate limit: <= 50 req/min per IP (token bucket 50/60 req/s).
 * - Caching: 24 h (86,400 s) via Cloudflare Cache API (caches.default) or
 *   injected cache, keyed by normalized request URL, with in-memory fallback.
 * - Privacy & minimisation: normalises strictly to {nct, title, phase, status,
 *   enrollment, arms:[{label,type,description}],
 *   primaryOutcome:[{measure,timeFrame}], resultsPosted:boolean,
 *   source:"ClinicalTrials.gov"}. Keeps nothing else (no contact emails).
 * - On upstream 5xx / timeout / network / 429: returns { available: false,
 *   reason: "unavailable", source: "ClinicalTrials.gov" } without caching.
 */
import {
  ConnectorError, createBucket, fetchWithRetry, readJson, politeUserAgent,
} from "./_http.js";

const BASE = "https://clinicaltrials.gov/api/v2";
const SOURCE = "ClinicalTrials.gov";
const CACHE_TTL_SEC = 86400;
const CACHE_TTL_MS = CACHE_TTL_SEC * 1000;
const BUCKET = createBucket(50 / 60);
const NCT_RE = /^NCT\d{8}$/;

const VALID_STATUSES = new Set([
  "ACTIVE_NOT_RECRUITING",
  "COMPLETED",
  "ENROLLING_BY_INVITATION",
  "NOT_YET_RECRUITING",
  "RECRUITING",
  "SUSPENDED",
  "TERMINATED",
  "WITHDRAWN",
  "AVAILABLE",
  "NO_LONGER_AVAILABLE",
  "TEMPORARILY_NOT_AVAILABLE",
  "APPROVED_FOR_MARKETING",
  "WITHHELD",
  "UNKNOWN",
]);

const PHASE_ALIASES = {
  EARLY_PHASE1: "EARLY_PHASE1",
  "EARLY PHASE 1": "EARLY_PHASE1",
  PHASE0: "EARLY_PHASE1",
  "PHASE 0": "EARLY_PHASE1",
  "0": "EARLY_PHASE1",
  PHASE1: "PHASE1",
  "PHASE 1": "PHASE1",
  "1": "PHASE1",
  PHASE2: "PHASE2",
  "PHASE 2": "PHASE2",
  "2": "PHASE2",
  PHASE3: "PHASE3",
  "PHASE 3": "PHASE3",
  "3": "PHASE3",
  PHASE4: "PHASE4",
  "PHASE 4": "PHASE4",
  "4": "PHASE4",
  NA: "NA",
  "N/A": "NA",
};

const MEM_CACHE = new Map();
const MAX_MEM_CACHE = 500;

export function clearCache() {
  MEM_CACHE.clear();
}

export function selectBucket() {
  return BUCKET;
}

function optsOf(opts = {}) {
  const email = String((opts && opts.contactEmail) || "").trim();
  const headers = {
    Accept: "application/json",
    "User-Agent": email && email.indexOf("@") > 0 ? politeUserAgent(email) : "StewardMD-ResearchMD/1.0",
  };
  return {
    headers,
    fetchImpl: opts.fetch,
    sleep: opts.sleep,
    random: opts.random,
    now: opts.now || Date.now,
    deadline: opts.deadline === undefined ? Infinity : opts.deadline,
    bucket: opts.bucket || BUCKET,
    cache: opts.cache,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
  };
}

function transport(o) {
  const t = {
    headers: o.headers,
    fetchImpl: o.fetchImpl,
    sleep: o.sleep,
    random: o.random,
    now: o.now,
    deadline: o.deadline,
    bucket: o.bucket,
  };
  if (o.timeoutMs !== undefined) t.timeoutMs = o.timeoutMs;
  if (o.maxRetries !== undefined) t.maxRetries = o.maxRetries;
  return t;
}

function resolveCache(o) {
  if (o.cache !== undefined) return o.cache;
  if (typeof caches !== "undefined" && caches && caches.default) return caches.default;
  return null;
}

async function cacheGet(o, cacheUrl) {
  const cache = resolveCache(o);
  if (cache) {
    try {
      const hit = await cache.match(new Request(cacheUrl, { method: "GET" }));
      if (hit) return await hit.json();
    } catch (e) { /* treat cache error as miss */ }
    return null;
  }
  const entry = MEM_CACHE.get(cacheUrl);
  if (!entry) return null;
  if (o.now() >= entry.expiresAt) {
    MEM_CACHE.delete(cacheUrl);
    return null;
  }
  return entry.value;
}

async function cacheSet(o, cacheUrl, value) {
  const cache = resolveCache(o);
  if (cache) {
    try {
      await cache.put(
        new Request(cacheUrl, { method: "GET" }),
        new Response(JSON.stringify(value), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=" + CACHE_TTL_SEC,
          },
        })
      );
    } catch (e) { /* best-effort caching */ }
    return;
  }
  if (MEM_CACHE.size >= MAX_MEM_CACHE) {
    const oldest = MEM_CACHE.keys().next().value;
    if (oldest !== undefined) MEM_CACHE.delete(oldest);
  }
  MEM_CACHE.set(cacheUrl, { value, expiresAt: o.now() + CACHE_TTL_MS });
}

function listFromParam(val) {
  if (val === undefined || val === null || val === "") return [];
  const arr = Array.isArray(val) ? val : String(val).split(",");
  return arr.map((x) => String(x || "").trim()).filter(Boolean);
}

function parseStatuses(val) {
  const items = listFromParam(val).map((s) => s.toUpperCase());
  for (const s of items) {
    if (!VALID_STATUSES.has(s))
      throw new ConnectorError("invalid_search", "Unknown ClinicalTrials.gov status: " + s);
  }
  return items;
}

function parsePhases(val) {
  const raw = listFromParam(val);
  const out = [];
  for (const item of raw) {
    const key = item.toUpperCase().replace(/\s+/g, " ").trim();
    const mapped = PHASE_ALIASES[key];
    if (!mapped)
      throw new ConnectorError("invalid_search", "Unknown ClinicalTrials.gov phase: " + item);
    if (out.indexOf(mapped) < 0) out.push(mapped);
  }
  return out;
}

function isUnavailableErr(e) {
  return e instanceof ConnectorError && (e.code === "search_failed" || e.code === "search_rate_limited");
}

/* Normalise one ClinicalTrials.gov API v2 study object to the minimal contract shape.
 * Keeps strictly the 9 documented fields and nothing else. */
export function normalise(raw) {
  const ps = (raw && raw.protocolSection) || {};
  const idMod = ps.identificationModule || {};
  const statusMod = ps.statusModule || {};
  const designMod = ps.designModule || {};
  const armsMod = ps.armsInterventionsModule || {};
  const outcomesMod = ps.outcomesModule || {};

  const nct = String(idMod.nctId || "").trim();
  if (!NCT_RE.test(nct))
    throw new ConnectorError("invalid_search", "ClinicalTrials.gov record has no valid nctId");

  const title = String(idMod.briefTitle || idMod.officialTitle || "").trim();
  const rawPhases = Array.isArray(designMod.phases)
    ? designMod.phases
    : (designMod.phases ? [designMod.phases] : []);
  const phase = rawPhases.map((x) => String(x || "").trim()).filter(Boolean).join(", ");
  const status = String(statusMod.overallStatus || "").trim();
  const rawCount = designMod.enrollmentInfo && designMod.enrollmentInfo.count;
  const enrollment = typeof rawCount === "number" && Number.isFinite(rawCount) ? rawCount : null;

  const arms = (Array.isArray(armsMod.armGroups) ? armsMod.armGroups : []).map((a) => ({
    label: String((a && a.label) || "").trim(),
    type: String((a && a.type) || "").trim(),
    description: String((a && a.description) || "").trim(),
  }));

  const primaryOutcome = (Array.isArray(outcomesMod.primaryOutcomes) ? outcomesMod.primaryOutcomes : []).map((o) => ({
    measure: String((o && o.measure) || "").trim(),
    timeFrame: String((o && o.timeFrame) || "").trim(),
  }));

  const resultsPosted = Boolean(raw && raw.hasResults);

  return {
    nct,
    title,
    phase,
    status,
    enrollment,
    arms,
    primaryOutcome,
    resultsPosted,
    source: SOURCE,
  };
}

export function buildSearchUrl(params = {}) {
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new ConnectorError("invalid_search", "Search parameters must be an object");

  const condition = typeof params.condition === "string" ? params.condition.trim() : "";
  const intervention = typeof params.intervention === "string" ? params.intervention.trim() : "";
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (condition.length > 500 || intervention.length > 500 || query.length > 500)
    throw new ConnectorError("invalid_search", "Search terms must be at most 500 characters");

  const statuses = parseStatuses(params.status);
  const phases = parsePhases(params.phase);

  if (!condition && !intervention && !query && !statuses.length && !phases.length)
    throw new ConnectorError("invalid_search", "Provide condition, intervention, phase, or status");

  const pageSizeRaw = params.pageSize === undefined || params.pageSize === null || params.pageSize === "" ? 20 : Number(params.pageSize);
  if (!Number.isInteger(pageSizeRaw) || pageSizeRaw < 1 || pageSizeRaw > 1000)
    throw new ConnectorError("invalid_search", "pageSize must be an integer from 1 to 1000");

  const pageToken = params.pageToken === undefined || params.pageToken === null ? "" : String(params.pageToken).trim();
  if (pageToken.length > 500)
    throw new ConnectorError("invalid_search", "pageToken is too long");

  const p = new URLSearchParams();
  if (condition) p.set("query.cond", condition);
  if (intervention) p.set("query.intr", intervention);
  if (query) p.set("query.term", query);
  if (statuses.length) p.set("filter.overallStatus", statuses.join(","));
  if (phases.length) {
    const expr = phases.length === 1
      ? "AREA[Phase]" + phases[0]
      : "AREA[Phase](" + phases.join(" OR ") + ")";
    p.set("filter.advanced", expr);
  }
  p.set("pageSize", String(pageSizeRaw));
  if (pageToken) p.set("pageToken", pageToken);
  return BASE + "/studies?" + p.toString();
}

export async function search(params = {}, opts = {}) {
  const url = buildSearchUrl(params);
  const o = optsOf(opts);
  const cached = await cacheGet(o, url);
  if (cached) return cached;

  let body;
  try {
    body = await readJson(await fetchWithRetry(url, transport(o)));
  } catch (e) {
    if (isUnavailableErr(e)) {
      return {
        available: false,
        studies: [],
        nextPageToken: null,
        totalCount: 0,
        reason: "unavailable",
        source: SOURCE,
      };
    }
    throw e;
  }

  const rawStudies = Array.isArray(body && body.studies) ? body.studies : [];
  const studies = [];
  for (const raw of rawStudies) {
    try { studies.push(normalise(raw)); } catch (e) { /* skip malformed study */ }
  }
  const result = {
    available: true,
    studies,
    nextPageToken: (body && body.nextPageToken) ? String(body.nextPageToken) : null,
    totalCount: typeof (body && body.totalCount) === "number" ? body.totalCount : studies.length,
    source: SOURCE,
  };
  await cacheSet(o, url, result);
  return result;
}

export async function lookup(nctId, opts = {}) {
  const id = String(nctId || "").trim();
  if (!NCT_RE.test(id))
    throw new ConnectorError("invalid_search", "nctId must match NCTxxxxxxxx");

  const url = BASE + "/studies/" + id;
  const o = optsOf(opts);
  const cached = await cacheGet(o, url);
  if (cached) return cached;

  let body;
  try {
    body = await readJson(await fetchWithRetry(url, transport(o)));
  } catch (e) {
    if (e instanceof ConnectorError && e.code === "invalid_search" && /HTTP 404\b/.test(e.message)) {
      return { available: true, trial: null, notFound: true, source: SOURCE };
    }
    if (isUnavailableErr(e)) {
      return { available: false, trial: null, reason: "unavailable", source: SOURCE };
    }
    throw e;
  }

  const trial = normalise(body);
  const result = { available: true, trial, source: SOURCE };
  await cacheSet(o, url, result);
  return result;
}
