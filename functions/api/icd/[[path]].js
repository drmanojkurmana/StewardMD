/* StewardMD — ICD Search API (Cloudflare Pages Function).
 *
 * Public, READ-ONLY, non-PHI reference data (WHO ICD-10 + ICD-11 disease codes/titles, sourced
 * from public WHO/CMS releases - see scripts/icd/README.md). Mirrors functions/api/schemes/
 * exactly: same auth gate, same fail-safe contract, same shape.
 *
 * Backed by Cloudflare D1 (binding ICD_DB, "stewardmd-icd"). FAIL-SAFE: any DB/binding error
 * returns 200 with an empty result + {error:"unavailable"} - never a 5xx.
 *
 * Routes (GET only):
 *   /api/icd/search?q=&system=&limit=   -> { results:[{id,system,code,title,chapter,is_leaf}] }
 *   /api/icd/code/<id>                  -> the single code row, or 404
 */
import * as repo from "../../_icd_repo.js";

const json = (obj, opts) => {
  opts = opts || {};
  return new Response(JSON.stringify(obj), {
    status: opts.status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": opts.cache || "no-store" },
  });
};
const PUB_CACHE = "public, max-age=3600"; // static WHO/CMS reference data - safe to cache longer than scheme rates

// Same coarse app gate as functions/api/schemes/[[path]].js.
function authorise(request, env) {
  if (request.headers.get("Cf-Access-Authenticated-User-Email")) return true;
  const tok = request.headers.get("X-App-Token");
  if (env.GHIS_APP_TOKEN && tok === env.GHIS_APP_TOKEN) return true;
  if (env.GHIS_APP_TOKEN === undefined && env.AI_APP_TOKEN && tok === env.AI_APP_TOKEN) return true;
  const o = request.headers.get("Origin") || "";
  return o === "https://stewardmd.in" || o === "https://www.stewardmd.in" || o === "https://localhost" || o === "capacitor://localhost" || o === "";
}

function validQuery(raw) {
  const q = String(raw || "").trim();
  return (q.length >= 2 && q.length <= 80) ? q : "";
}

async function safeRead(request, env, empty, fn) {
  if (!authorise(request, env) || !repo.hasDb(env)) return Object.assign({}, empty, { error: "unavailable" });
  try { return await fn(); } catch (e) { return Object.assign({}, empty, { error: "unavailable" }); }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });

  const url = new URL(request.url);
  const parts = Array.isArray(params.path) ? params.path.filter(Boolean) : (params.path ? [params.path] : []);
  const head = parts[0] || "";

  if (head === "search" && !parts[1]) {
    const q = validQuery(url.searchParams.get("q"));
    if (!q) return json({ error: "query_too_short" }, { status: 400 });
    const system = repo.normSystem(url.searchParams.get("system"));
    const limit = repo.clampLimit(url.searchParams.get("limit"));
    const body = await safeRead(request, env, { results: [] }, async () => ({ results: await repo.searchCodes(env, { q, system, limit }) }));
    return json(body, { cache: body.error ? "no-store" : PUB_CACHE });
  }

  if (head === "code" && parts[1]) {
    let status = 200;
    // icd_codes.id is "icd10:<code>" / "icd11:<code>" - it contains a colon, so the client always
    // encodeURIComponent()s it before building the URL. Cloudflare's [[path]] catch-all does NOT
    // decode individual path segments, so parts[1] arrives here still literally "icd10%3AE11.9" -
    // decode it before querying D1, where the stored id has a real colon.
    let id = parts[1];
    try { id = decodeURIComponent(id); } catch (e) {}
    const body = await safeRead(request, env, {}, async () => {
      const row = await repo.getCodeById(env, id);
      if (!row) { status = 404; return { error: "not_found" }; }
      return row;
    });
    return json(body, { status, cache: (status === 200 && !body.error) ? PUB_CACHE : "no-store" });
  }

  return json({ error: "not_found" }, { status: 404 });
}
