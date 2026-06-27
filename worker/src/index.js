/**
 * StewardMD Drug API — Cloudflare Worker (composition-centric)
 * ----------------------------------------------------------------------------
 * Endpoints (all GET, JSON):
 *   GET /health                       liveness + D1 status
 *   GET /search?q=&limit=             distinct COMPOSITIONS (generics) matching q,
 *                                     each with class + brand count
 *   GET /suggest?q=&limit=            composition-name autocomplete
 *   GET /composition?name=&sort=&limit=&offset=
 *                                     one generic: shared uses/side-effects +
 *                                     its BRANDS (brand, manufacturer, mrp, form,
 *                                     pack), sortable: relevance|price_asc|price_desc
 *   GET /drug/:id                     single brand row (full detail)
 *
 * A drug's clinical info (uses/side-effects) is a property of the COMPOSITION,
 * not the brand — so it is returned once per generic, with brands listed under it.
 *
 * Data: existing D1 `stewardmd-prod` (env.DB). Layered cache (browser ->
 * Cloudflare edge / Worker cache -> D1). CORS applied per-request after cache.
 * ----------------------------------------------------------------------------
 */

const ALLOWED_ORIGINS = [
  "https://stewardmd.in", "https://www.stewardmd.in",
  "capacitor://localhost", "ionic://localhost", "http://localhost",
];
const DEV_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const TTL = { search: 300, suggest: 600, comp: 600, drug: 86400 };

function corsHeaders(origin) {
  let allow = "https://stewardmd.in";
  if (origin && (ALLOWED_ORIGINS.includes(origin) || DEV_ORIGIN_RE.test(origin))) allow = origin;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(data, { status = 200, ttl = 0, extra = {} } = {}) {
  const headers = { "Content-Type": "application/json; charset=utf-8", ...extra };
  headers["Cache-Control"] = ttl > 0 ? `public, max-age=${ttl}, s-maxage=${ttl}` : "no-store";
  return new Response(JSON.stringify(data), { status, headers });
}
function withCors(res, origin) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
function ftsQuery(q) {
  const tokens = (q || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!tokens.length) return null;
  return tokens.map((t) => `${t}*`).join(" ");
}
function tableMissing(err) { return /no such table/i.test(String(err && err.message)); }
function emptyNote(obj) { return json(obj, { extra: { "x-db-status": "empty" } }); }

// /search -> distinct compositions (relevance order), with class + brand count
async function handleSearch(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 40);
  const match = q.length >= 2 ? ftsQuery(q) : null;
  if (!match) return json({ query: q, count: 0, results: [] }, { ttl: TTL.search });
  try {
    // relevance-ordered matched rows; dedupe to distinct compositions
    const { results } = await env.DB.prepare(
      `SELECT d.composition AS composition, d.class AS class
         FROM drugs_fts f JOIN drugs d ON d.id = f.rowid
        WHERE drugs_fts MATCH ?1 ORDER BY rank LIMIT 400`
    ).bind(match).all();
    const order = [], meta = {};
    for (const r of results) {
      const c = r.composition || "";
      if (!c || meta[c]) continue;
      meta[c] = { composition: c, class: r.class || "" };
      order.push(c);
      if (order.length >= limit) break;
    }
    if (!order.length) return json({ query: q, count: 0, results: [] }, { ttl: TTL.search });
    // brand counts for just these compositions
    const ph = order.map((_, i) => `?${i + 1}`).join(",");
    const { results: counts } = await env.DB.prepare(
      `SELECT composition, count(*) AS brands FROM drugs WHERE composition IN (${ph}) GROUP BY composition`
    ).bind(...order).all();
    for (const c of counts) if (meta[c.composition]) meta[c.composition].brands = c.brands;
    return json({ query: q, count: order.length, results: order.map((c) => meta[c]) }, { ttl: TTL.search });
  } catch (err) {
    if (tableMissing(err)) return emptyNote({ query: q, count: 0, results: [] });
    return json({ error: "search_failed" }, { status: 500 });
  }
}

async function handleSuggest(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "8", 10) || 8, 15);
  const match = q.length >= 2 ? ftsQuery(q) : null;
  if (!match) return json({ query: q, suggestions: [] }, { ttl: TTL.suggest });
  try {
    const { results } = await env.DB.prepare(
      `SELECT d.composition FROM drugs_fts f JOIN drugs d ON d.id = f.rowid
        WHERE drugs_fts MATCH ?1 ORDER BY rank LIMIT 200`
    ).bind(match).all();
    const seen = new Set(), out = [];
    for (const r of results) { const c = r.composition; if (c && !seen.has(c)) { seen.add(c); out.push(c); if (out.length >= limit) break; } }
    return json({ query: q, suggestions: out }, { ttl: TTL.suggest });
  } catch (err) {
    if (tableMissing(err)) return emptyNote({ query: q, suggestions: [] });
    return json({ error: "suggest_failed" }, { status: 500 });
  }
}

const SORTS = {
  relevance: "discontinued ASC, brand COLLATE NOCASE ASC",
  price_asc: "(mrp IS NULL) ASC, mrp ASC, brand COLLATE NOCASE ASC",
  price_desc: "(mrp IS NULL) ASC, mrp DESC, brand COLLATE NOCASE ASC",
};

// Company-tier filters — prefix-anchored manufacturer names (lowercased) so
// e.g. "sun pharma" excludes "Alsun Pharma", "intas" excludes "Vintas".
const TIERS = {
  branded: ["sun pharma", "abbott", "cipla", "dr reddy", "lupin", "torrent", "zydus", "alkem",
    "sanofi", "glaxo", "pfizer", "astrazeneca", "boehringer", "novo nordisk", "eli lilly"],
  generic: ["mankind", "aristo", "intas", "macleods", "micro labs", "emcure", "alembic", "usv",
    "eris", "glenmark", "blue cross", "franco", "wallace", "medley", "akumentis"],
};

// /composition -> shared clinical info + sortable brand list
async function handleComposition(url, env) {
  const name = (url.searchParams.get("name") || "").trim();
  if (!name) return json({ error: "missing name" }, { status: 400 });
  const sort = SORTS[url.searchParams.get("sort")] ? url.searchParams.get("sort") : "relevance";
  const tier = url.searchParams.get("tier");
  const pats = (tier && TIERS[tier]) ? TIERS[tier].map((p) => p + "%") : null;
  const mfr = pats ? " AND (" + pats.map((_, i) => `lower(manufacturer) LIKE ?${i + 2}`).join(" OR ") + ")" : "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 300);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
  try {
    // shared clinical info: richest non-empty representative (NOT tier-filtered)
    const rep = await env.DB.prepare(
      `SELECT class, chem_class, action_class, uses, side_effects, habit_forming
         FROM drugs WHERE composition = ?1 AND uses IS NOT NULL AND uses <> ''
        ORDER BY length(uses) DESC LIMIT 1`
    ).bind(name).first();
    const fallback = rep ? null : await env.DB.prepare(
      `SELECT class, chem_class, action_class, uses, side_effects, habit_forming
         FROM drugs WHERE composition = ?1 LIMIT 1`).bind(name).first();
    const info = rep || fallback;
    const baseBinds = pats ? [name, ...pats] : [name];
    const total = await env.DB.prepare(
      `SELECT count(*) AS n FROM drugs WHERE composition = ?1${mfr}`).bind(...baseBinds).first();
    const li = (pats ? pats.length : 0) + 2, oi = li + 1;
    const { results: brands } = await env.DB.prepare(
      `SELECT id, brand, manufacturer, mrp, form, pack, discontinued
         FROM drugs WHERE composition = ?1${mfr} ORDER BY ${SORTS[sort]} LIMIT ?${li} OFFSET ?${oi}`
    ).bind(...baseBinds, limit, offset).all();
    if (!info && (!total || !total.n)) return json({ error: "not_found" }, { status: 404 });
    return json({
      composition: name, sort, tier: (tier && TIERS[tier]) ? tier : "all",
      class: info ? info.class : "", chem_class: info ? info.chem_class : "",
      action_class: info ? info.action_class : "",
      uses: info ? info.uses : "", side_effects: info ? info.side_effects : "",
      habit_forming: info ? info.habit_forming : "",
      total: total ? total.n : brands.length, brands,
    }, { ttl: TTL.comp });
  } catch (err) {
    if (tableMissing(err)) return emptyNote({ composition: name, brands: [] });
    return json({ error: "composition_failed" }, { status: 500 });
  }
}

async function handleDrug(id, env) {
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return json({ error: "bad_id" }, { status: 400 });
  try {
    const row = await env.DB.prepare(`SELECT * FROM drugs WHERE id = ?1`).bind(n).first();
    if (!row) return json({ error: "not_found" }, { status: 404 });
    return json({ drug: row }, { ttl: TTL.drug });
  } catch (err) {
    if (tableMissing(err)) return json({ error: "index not built yet" }, { status: 503, extra: { "x-db-status": "empty" } });
    return json({ error: "drug_failed" }, { status: 500 });
  }
}

async function handleHealth(env) {
  let dbReady = false, rows = null;
  try { const r = await env.DB.prepare(`SELECT count(*) AS n FROM drugs`).first(); dbReady = true; rows = r ? r.n : null; }
  catch (_) { dbReady = false; }
  return json({ ok: true, service: "stewardmd-api", db: "stewardmd-prod", dbReady, rows }, { ttl: 0 });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "GET") return withCors(json({ error: "method_not_allowed" }, { status: 405 }), origin);

    // edge rate limit per client IP
    if (env.RL) {
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      try {
        const { success } = await env.RL.limit({ key: ip });
        if (!success) return withCors(json({ error: "rate_limited" }, { status: 429, extra: { "Retry-After": "10" } }), origin);
      } catch (_) { /* fail open */ }
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const cacheable = path === "/search" || path === "/suggest" || path === "/composition" || path.startsWith("/drug/");

    const cache = caches.default;
    if (cacheable) { const hit = await cache.match(request); if (hit) return withCors(hit, origin); }

    let res;
    if (path === "/" || path === "/health") res = await handleHealth(env);
    else if (path === "/search") res = await handleSearch(url, env);
    else if (path === "/suggest") res = await handleSuggest(url, env);
    else if (path === "/composition") res = await handleComposition(url, env);
    else if (path.startsWith("/drug/")) res = await handleDrug(decodeURIComponent(path.slice("/drug/".length)), env);
    else res = json({ error: "not_found" }, { status: 404 });

    const cc = res.headers.get("Cache-Control") || "";
    if (cacheable && res.status === 200 && cc.includes("max-age=") && !cc.includes("max-age=0")) {
      ctx.waitUntil(cache.put(request, res.clone()));
    }
    return withCors(res, origin);
  },
};
