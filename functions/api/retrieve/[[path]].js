/* StewardMD — hybrid-retrieval VECTOR ARM (Cloudflare Pages Function).
 *
 * POST /api/retrieve { query, k } -> { matches: [{ diseaseId, chunkId, section, score }] }
 *
 * Embeds the query with Workers AI (bge-base-en-v1.5) and searches the Vectorize
 * index of KB chunks. The client keeps its LOCAL lexical arm and RRF-fuses the two.
 *
 * FAIL-SAFE BY DESIGN: if the Workers AI (`AI`) or Vectorize (`KB_VECTORIZE`)
 * bindings are absent, or anything throws, this returns 200 { matches: [] } so the
 * client silently degrades to lexical-only — never a 5xx, never a broken answer.
 * Only KB reference text (query + chunks) is involved; no patient data.
 */
const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Same coarse gate as the AI Function (origin allowlist / Cf-Access / app token).
function authorise(request, env) {
  if (request.headers.get("Cf-Access-Authenticated-User-Email")) return true;
  const tok = request.headers.get("X-App-Token");
  if (env.GHIS_APP_TOKEN && tok === env.GHIS_APP_TOKEN) return true;
  if (env.GHIS_APP_TOKEN === undefined && env.AI_APP_TOKEN && tok === env.AI_APP_TOKEN) return true;
  const o = request.headers.get("Origin") || "";
  return o === "https://stewardmd.in" || o === "https://www.stewardmd.in" || o === "https://localhost" || o === "capacitor://localhost" || o === "";
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!authorise(request, env)) return json({ matches: [] });      // fail-safe, not 403 — client falls back
  if (request.method !== "POST") return json({ matches: [] });
  if (!env.AI || !env.KB_VECTORIZE) return json({ matches: [] });   // infra not provisioned yet → lexical-only

  try {
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const query = String((body && body.query) || "").slice(0, 500).trim();
    if (!query) return json({ matches: [] });
    const k = Math.max(1, Math.min(50, Number(body && body.k) || 12));

    const emb = await env.AI.run(EMBED_MODEL, { text: [query] });
    const vec = emb && emb.data && emb.data[0];
    if (!Array.isArray(vec)) return json({ matches: [] });

    const res = await env.KB_VECTORIZE.query(vec, { topK: k, returnMetadata: "all" });
    const matches = ((res && res.matches) || []).map((m) => ({
      diseaseId: (m.metadata && m.metadata.diseaseId) || null,
      chunkId: m.id || null,
      section: (m.metadata && m.metadata.section) || null,
      score: typeof m.score === "number" ? m.score : null
    })).filter((m) => m.diseaseId);
    return json({ matches: matches });
  } catch (e) {
    return json({ matches: [] });                                   // never break retrieval
  }
}
