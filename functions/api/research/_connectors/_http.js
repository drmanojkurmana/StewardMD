/* ResearchMD Phase 2.3 shared connector transport (ES module).
 * Contract: docs/research/contracts/phase-2/connector-api.md.
 * Terms: docs/research/research-2.0b-database-terms.md (rule 10: 429/5xx get
 * exponential backoff with jitter, 1s doubling to a 60s cap, at most 5 retries).
 * Adapters never touch D1 or R2; they return plain data and throw typed errors.
 *
 * Everything time- or randomness-related is injectable (now, sleep, random,
 * fetch, bucket) so the test suite runs with no network and no real waits.
 */

export class ConnectorError extends Error {
  constructor(code, message, retryAfterMs = 0) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Token bucket, per deployment (module-level in each adapter), shared across
 * projects. ratePerSec comes from the 2.0b terms table for that database. */
export function createBucket(ratePerSec) {
  /* Capacity is at least 1 token, so a rate under 1/s (e.g. 50/min) can still fire; a cap below 1 never fills. */
  const capacity = Math.max(1, ratePerSec);
  let tokens = capacity;
  let last = null;
  return {
    ratePerSec,
    async acquire(now = Date.now, sleep = defaultSleep) {
      for (;;) {
        const t = now();
        if (last === null) last = t;
        tokens = Math.min(capacity, tokens + ((t - last) / 1000) * ratePerSec);
        last = t;
        if (tokens >= 1) { tokens -= 1; return; }
        await sleep(Math.ceil(((1 - tokens) / ratePerSec) * 1000));
      }
    },
  };
}

/* Backoff delay for retry attempt n (0-based): 1s, 2s, 4s, 8s, 16s, capped at
 * 60s, with jitter in [0.5, 1.0) of the base. A Retry-After header is a floor. */
export function backoffDelay(attempt, random = Math.random, retryAfterMs = 0) {
  const base = Math.min(60000, 1000 * Math.pow(2, attempt));
  const jittered = Math.round(base * (0.5 + 0.5 * random()));
  return Math.min(60000, Math.max(jittered, retryAfterMs));
}

function retryAfterMsOf(headers) {
  const v = headers && typeof headers.get === "function" ? headers.get("retry-after") : null;
  if (!v) return 0;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(60000, secs * 1000);
  const when = Date.parse(v);
  if (Number.isFinite(when)) return Math.max(0, Math.min(60000, when - Date.now()));
  return 0;
}

/* One HTTP request with the contract retry policy. Returns the ok Response;
 * throws ConnectorError("search_rate_limited") after 429 retries are spent,
 * ConnectorError("search_failed") after 5xx/network retries or the run ceiling,
 * ConnectorError("invalid_search") for a non-retryable 4xx. */
export async function fetchWithRetry(url, options = {}) {
  const {
    method = "GET", headers = {}, body,
    fetchImpl = (...a) => globalThis.fetch(...a),
    sleep = defaultSleep, random = Math.random, now = Date.now,
    bucket = null, deadline = Infinity, timeoutMs = 30000, maxRetries = 5,
  } = options;
  let lastDelay = 0;
  for (let attempt = 0; ; attempt++) {
    if (now() > deadline)
      throw new ConnectorError("search_failed", "Search run exceeded the 10 minute ceiling");
    if (bucket) await bucket.acquire(now, sleep);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (attempt >= maxRetries)
        throw new ConnectorError("search_failed", "Database request failed after retries: " + String((e && e.message) || e).slice(0, 160));
      lastDelay = backoffDelay(attempt, random);
      await sleep(lastDelay);
      continue;
    }
    clearTimeout(timer);
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= maxRetries) {
        const code = res.status === 429 ? "search_rate_limited" : "search_failed";
        throw new ConnectorError(code,
          code === "search_rate_limited"
            ? "Database rate limit hit; retry after " + Math.ceil(lastDelay / 1000) + "s"
            : "Database error HTTP " + res.status + " after retries", lastDelay);
      }
      lastDelay = backoffDelay(attempt, random, retryAfterMsOf(res.headers));
      await sleep(lastDelay);
      continue;
    }
    if (!res.ok)
      throw new ConnectorError("invalid_search", "Database answered HTTP " + res.status);
    return res;
  }
}

export async function readJson(res) {
  try { return await res.json(); }
  catch (e) { throw new ConnectorError("search_failed", "Database returned a non-JSON body"); }
}

/* YYYY-MM-DD -> YYYY/MM/DD (NCBI date format). Validates the shape. */
export function ncbiDate(iso) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(iso || "")))
    throw new ConnectorError("invalid_search", "dateTo must be YYYY-MM-DD");
  return iso.replace(/-/g, "/");
}

export function isIsoDate(iso) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(iso || ""));
}

/* The polite User-Agent the 2.0b terms require for Crossref and Europe PMC. */
export function politeUserAgent(email) {
  return "StewardMD-ResearchMD/1.0 (https://stewardmd.in; mailto:" + email + ")";
}

export function requireContactEmail(config) {
  const email = String((config && config.contactEmail) || "").trim();
  if (!email || email.indexOf("@") < 1)
    throw new ConnectorError("invalid_search",
      "RESEARCH_CONTACT_EMAIL is not configured; the database terms require a maintainer contact on every request");
  return email;
}