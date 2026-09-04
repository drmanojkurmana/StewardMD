/* StewardMD — Government Health Schemes API (Cloudflare Pages Function).
 *
 * Public, READ-ONLY, non-PHI reference data (govt scheme package masters — packages, native
 * codes, rates, eligibility). No write path here — Phase 1 ingestion writes via
 * scripts/govschemes/*, not this API. See vault/modules/Government Health Schemes.md and
 * vault/decisions/Decisions.md (2026-09-02) before touching this file.
 *
 * Backed by Cloudflare D1 (binding GOVSCHEMES_DB, "stewardmd-govschemes"). FAIL-SAFE: any
 * DB/binding error returns 200 with an empty result + {error:"unavailable"} — never a 5xx.
 *
 * rate_tier is safety-critical (see functions/db/migrate_govschemes_hbp_fields.sql) — every
 * package row below carries it; amounts across states are only comparable with the tier visible.
 *
 * Routes (GET only):
 *   /api/schemes/jurisdictions              -> { jurisdictions:[{id,name,type,schemes,packages}] }
 *   /api/schemes/search?q=&state=&limit=    -> { results:[...packages] }         (state = jurisdiction id)
 *   /api/schemes/compare?q=                 -> { groups:[{treatment_name_normalised, rows:[...]}] }
 *   /api/schemes/package/<id>               -> full package row + source + version_label
 *   /api/schemes/schemes?state=             -> { schemes:[{id,name,authority,packages}] }        (branches within a state)
 *   /api/schemes/specialities?state=&scheme= -> { specialities:[{code,name,packages}] }           (browse categories)
 *   /api/schemes/browse?state=&scheme=&speciality=&limit=&offset=
 *                                            -> { results:[...packages], total }                  (no free text, paginated)
 */
import * as repo from "../../_schemes_repo.js";

const json = (obj, opts) => {
  opts = opts || {};
  return new Response(JSON.stringify(obj), {
    status: opts.status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": opts.cache || "no-store" },
  });
};
const PUB_CACHE = "public, max-age=300";

// Coarse app gate — same shape as functions/api/retrieve/[[path]].js: Cf-Access, X-App-Token,
// or an allowed/empty Origin (native app requests carry no Origin header).
function authorise(request, env) {
  if (request.headers.get("Cf-Access-Authenticated-User-Email")) return true;
  const tok = request.headers.get("X-App-Token");
  if (env.GHIS_APP_TOKEN && tok === env.GHIS_APP_TOKEN) return true;
  if (env.GHIS_APP_TOKEN === undefined && env.AI_APP_TOKEN && tok === env.AI_APP_TOKEN) return true;
  const o = request.headers.get("Origin") || "";
  return o === "https://stewardmd.in" || o === "https://www.stewardmd.in" || o === "https://localhost" || o === "capacitor://localhost" || o === "";
}

// q trimmed, 2..80 chars; returns "" (invalid) otherwise so callers can 400 on falsy.
function validQuery(raw) {
  const q = String(raw || "").trim();
  return (q.length >= 2 && q.length <= 80) ? q : "";
}
// state = jurisdiction id slug; a non-matching value is treated as "no filter" rather than a
// hard error — this is an optional refinement param, not a required one.
function validState(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return /^[a-z-]+$/.test(s) ? s : "";
}

// Runs `fn`, returning its result merged with `empty` shape unless the caller fails the coarse
// gate, the DB isn't bound, or `fn` throws — then `empty` + {error:"unavailable"} comes back with
// a 200, per the fail-safe contract (auth failure degrades the same as any other unavailability,
// same as functions/api/retrieve/[[path]].js — never a 403/5xx on this public read surface).
async function safeRead(request, env, empty, fn) {
  if (!authorise(request, env) || !repo.hasDb(env)) return Object.assign({}, empty, { error: "unavailable" });
  try { return await fn(); } catch (e) { return Object.assign({}, empty, { error: "unavailable" }); }
}

function formatPackageDetail(detail) {
  const out = Object.assign({}, detail.row);
  out.package_id = out.id; delete out.id;
  delete out.scheme_version_id; delete out.source_id;
  out.source = detail.source ? {
    url: detail.source.url || "", authority: detail.source.authority || "",
    retrieved_ts: detail.source.retrieved_ts || 0, verification_status: detail.source.verification_status || "unverified",
  } : null;
  return out;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });

  const url = new URL(request.url);
  const parts = Array.isArray(params.path) ? params.path.filter(Boolean) : (params.path ? [params.path] : []);
  const head = parts[0] || "";

  if (head === "jurisdictions" && !parts[1]) {
    const body = await safeRead(request, env, { jurisdictions: [] }, async () => ({ jurisdictions: await repo.listJurisdictions(env) }));
    return json(body, { cache: body.error ? "no-store" : PUB_CACHE });
  }

  if (head === "search" && !parts[1]) {
    const q = validQuery(url.searchParams.get("q"));
    if (!q) return json({ error: "query_too_short" }, { status: 400 });
    const stateId = validState(url.searchParams.get("state"));
    const limit = repo.clampLimit(url.searchParams.get("limit"));
    const body = await safeRead(request, env, { results: [] }, async () => ({ results: await repo.searchPackages(env, { q, stateId, limit }) }));
    return json(body, { cache: body.error ? "no-store" : PUB_CACHE });
  }

  if (head === "compare" && !parts[1]) {
    const q = validQuery(url.searchParams.get("q"));
    if (!q) return json({ error: "query_too_short" }, { status: 400 });
    const body = await safeRead(request, env, { groups: [] }, async () => ({ groups: await repo.comparePackages(env, q) }));
    return json(body, { cache: body.error ? "no-store" : PUB_CACHE });
  }

  if (head === "schemes" && !parts[1]) {
    const stateId = validState(url.searchParams.get("state"));
    if (!stateId) return json({ error: "state_required" }, { status: 400 });
    const body = await safeRead(request, env, { schemes: [] }, async () => ({ schemes: await repo.listSchemes(env, stateId) }));
    return json(body, { cache: body.error ? "no-store" : PUB_CACHE });
  }

  if (head === "specialities" && !parts[1]) {
    const stateId = validState(url.searchParams.get("state"));
    const schemeId = validState(url.searchParams.get("scheme"));
    const body = await safeRead(request, env, { specialities: [] }, async () =>
      ({ specialities: await repo.listSpecialities(env, { jurisdictionId: stateId, schemeId }) }));
    return json(body, { cache: body.error ? "no-store" : PUB_CACHE });
  }

  if (head === "browse" && !parts[1]) {
    const stateId = validState(url.searchParams.get("state"));
    const schemeId = validState(url.searchParams.get("scheme"));
    const specRaw = url.searchParams.get("speciality");
    const speciality = specRaw == null ? undefined : String(specRaw).trim();
    const limit = repo.clampLimit(url.searchParams.get("limit"));
    const offset = parseInt(url.searchParams.get("offset"), 10) || 0;
    const body = await safeRead(request, env, { results: [], total: 0 }, async () => {
      const r = await repo.browsePackages(env, { jurisdictionId: stateId, schemeId, speciality, limit, offset });
      return { results: r.rows, total: r.total };
    });
    return json(body, { cache: body.error ? "no-store" : PUB_CACHE });
  }

  if (head === "package" && parts[1]) {
    let status = 200;
    const body = await safeRead(request, env, {}, async () => {
      const detail = await repo.getPackageById(env, parts[1]);
      if (!detail) { status = 404; return { error: "not_found" }; }
      return formatPackageDetail(detail);
    });
    return json(body, { status, cache: (status === 200 && !body.error) ? PUB_CACHE : "no-store" });
  }

  return json({ error: "not_found" }, { status: 404 });
}
