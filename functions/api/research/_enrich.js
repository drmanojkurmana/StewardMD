/* ResearchMD Phase 1 enrichment routes (ES module, server side).
 * - POST /v1/enrich/retraction  body {doi} or {dois:[...]}  -> Crossref /
 *   Retraction Watch status for each DOI.
 * - POST /v1/enrich/openalex    body {doi|dois|pmid|pmids} -> cited-by count,
 *   OA status/link and up to 5 related works per work.
 * Only bibliographic identifiers (DOI, PMID) are accepted; no case text can
 * enter these handlers. Any provider failure, timeout or missing key returns
 * 200 {available:false} so the client hides the feature silently.
 */
import { retractionsForDois } from "./_connectors/crossref.js";
import { lookupWorks } from "./_connectors/openalex.js";
import { normaliseDoi } from "./_dedup.js";

const MAX_IDS = 50;

function defaultCache() {
  try {
    return typeof caches !== "undefined" && caches && caches.default ? caches.default : null;
  } catch (e) {
    return null;
  }
}

function listOf(body, one, many) {
  if (body && typeof body[one] === "string" && body[one].trim()) return [body[one]];
  if (body && Array.isArray(body[many])) return body[many];
  return [];
}

function uniqueDois(values) {
  const out = [];
  for (const raw of values) {
    const d = normaliseDoi(raw);
    if (d && out.indexOf(d) < 0) out.push(d);
  }
  return out.slice(0, MAX_IDS);
}

function uniquePmids(values) {
  const out = [];
  for (const raw of values) {
    const p = String(raw == null ? "" : raw).trim();
    if (/^\d{1,9}$/.test(p) && out.indexOf(p) < 0) out.push(p);
  }
  return out.slice(0, MAX_IDS);
}

export async function enrichRetractionRoute(ctx) {
  const { request, env, requestId, api } = ctx;
  let body;
  try { body = await api.bodyJson(request); } catch (e) {
    return api.err(400, "invalid_body", "Invalid enrichment payload", requestId);
  }
  const dois = uniqueDois(listOf(body, "doi", "dois"));
  if (!dois.length) return api.err(400, "invalid_body", "doi or dois is required", requestId);
  if (!env.RESEARCH_CONTACT_EMAIL)
    return api.json({ available: false, retractions: {} }, 200, { "x-request-id": requestId });
  try {
    const retractions = await retractionsForDois(dois, {
      contactEmail: env.RESEARCH_CONTACT_EMAIL,
      fetch: ctx.fetch,
      sleep: ctx.sleep,
      random: ctx.random,
      now: ctx.now,
      bucket: ctx.bucket,
      cache: ctx.cache === undefined ? defaultCache() : ctx.cache,
    });
    const out = { available: true, source: "Crossref / Retraction Watch", retractions };
    if (dois.length === 1) out.retraction = retractions[dois[0]];
    return api.json(out, 200, { "x-request-id": requestId });
  } catch (e) {
    return api.json({ available: false, retractions: {} }, 200, { "x-request-id": requestId });
  }
}

export async function enrichOpenAlexRoute(ctx) {
  const { request, env, requestId, api } = ctx;
  let body;
  try { body = await api.bodyJson(request); } catch (e) {
    return api.err(400, "invalid_body", "Invalid enrichment payload", requestId);
  }
  const dois = uniqueDois(listOf(body, "doi", "dois"));
  const pmids = uniquePmids(listOf(body, "pmid", "pmids"));
  if (!dois.length && !pmids.length)
    return api.err(400, "invalid_body", "doi, dois, pmid or pmids is required", requestId);
  if (!env.OPENALEX_API_KEY)
    return api.json({ available: false, works: [] }, 200, { "x-request-id": requestId });
  try {
    const works = await lookupWorks({ dois, pmids }, {
      apiKey: env.OPENALEX_API_KEY,
      contactEmail: env.RESEARCH_CONTACT_EMAIL,
      fetch: ctx.fetch,
      sleep: ctx.sleep,
      random: ctx.random,
      now: ctx.now,
      bucket: ctx.bucket,
      cache: ctx.cache === undefined ? defaultCache() : ctx.cache,
    });
    return api.json({ available: true, source: "OpenAlex", works }, 200, { "x-request-id": requestId });
  } catch (e) {
    return api.json({ available: false, works: [] }, 200, { "x-request-id": requestId });
  }
}