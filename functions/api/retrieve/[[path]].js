/* StewardMD — hybrid-retrieval VECTOR ARM (Cloudflare Pages Function).
 *
 * POST /api/retrieve { query, k } -> { matches: [{ diseaseId, chunkId, section, score }] }
 *
 * Embeds the query with Vertex AI (text-embedding-005, 768-d, the same VERTEX_API_KEY MaiK already uses; NOT
 * Workers AI, owner 2026-10-15) and searches the Vectorize index of KB diseases. The client keeps its LOCAL lexical arm and RRF-fuses the two.
 *
 * FAIL-SAFE BY DESIGN: if the Vertex key or the Vectorize (`KB_VECTORIZE`)
 * binding is absent, or anything throws, this returns 200 { matches: [] } so the
 * client silently degrades to lexical-only — never a 5xx, never a broken answer.
 * Only KB reference text (query + chunks) is involved; no patient data.
 */
import { cfAccessEmail } from "../../_fbauth.js";
const EMBED_MODEL = "text-embedding-005";
const EMBED_URL = "https://aiplatform.googleapis.com/v1/publishers/google/models/" + EMBED_MODEL + ":predict";
const WAI_MODEL = "@cf/baai/bge-base-en-v1.5";           // 768-d, the model the old stewardmd-kb index was built with
const WAI_DAY_CAP = 3000;                                // questions per UTC day on the free tier (about 0.2 neuron each, far under the 10,000 free neurons/day)
const DAY_CAP = 20000;                                  // hard ceiling on embedded questions per UTC day (spend guard)

// One question -> one 768-d vector. Express-mode key in a header (never the URL). Null on any failure.
// The express endpoint answers in about 1.5 s or stalls past 3 s (measured live, 2026-10-16), so the request is HEDGED:
// a second call starts at 1 s and a third at 2 s if nothing has come back; the first good vector wins and the rest are
// aborted. Worst case 3 calls of a ~20-word query per question, still a fraction of a cent. Hard deadline 6 s.
const HEDGE_AT = [0, 1000, 2000], DEADLINE_MS = 6000;
export async function embedQuery(env, text, info) {
  const key = String((env && env.VERTEX_API_KEY) || "").trim();
  if (!key) return null;
  const t0 = Date.now(), ctls = [];
  const body = JSON.stringify({ instances: [{ content: text, task_type: "RETRIEVAL_QUERY" }], parameters: { outputDimensionality: 768 } });
  const one = async (ctl) => {
    const r = await fetch(EMBED_URL, { method: "POST", signal: ctl.signal, headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body });
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    const v = j && j.predictions && j.predictions[0] && j.predictions[0].embeddings && j.predictions[0].embeddings.values;
    if (!(Array.isArray(v) && v.length === 768)) throw new Error("bad vector");
    return v;
  };
  return await new Promise((resolve) => {
    let settled = false, failed = 0, timers = [];
    const finish = (v) => { if (settled) return; settled = true; timers.forEach(clearTimeout); ctls.forEach((c) => { try { c.abort(); } catch (e) {} }); if (info) { info.ms = Date.now() - t0; info.calls = ctls.length; } resolve(v); };
    HEDGE_AT.forEach((at) => timers.push(setTimeout(() => {
      if (settled) return;
      const ctl = new AbortController(); ctls.push(ctl);
      one(ctl).then(finish, () => { if (++failed >= HEDGE_AT.length) finish(null); });
    }, at)));
    timers.push(setTimeout(() => finish(null), DEADLINE_MS));
  });
}

/* TIER 1, FREE QUOTA (owner 2026-10-16): the Workers AI binding is named CF_AI_FREE, NOT AI, so every other env.AI caller
 * (rerank, grounding check, PDF) stays off. Only this function uses it, behind a KV daily counter far below the free
 * 10,000 neurons/day. Over the cap, binding absent, or any error: null, and the caller falls through to Vertex. */
async function waiQuery(env, text) {
  const ai = env && env.CF_AI_FREE; if (!ai || !env.KB_VECTORIZE_OLD) return null;
  const kv = env.MAIK_KV; if (!kv) return null;                         // no counter, no spend
  const cap = Math.max(100, Math.min(WAI_DAY_CAP, Number(env.WAI_DAILY_CAP) || WAI_DAY_CAP));
  const k = "retrieve:wai:" + new Date().toISOString().slice(0, 10);
  try {
    const n = Number(await kv.get(k)) || 0; if (n >= cap) return null;
    await kv.put(k, String(n + 1), { expirationTtl: 172800 });
    const r = await Promise.race([ai.run(WAI_MODEL, { text: [text] }), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500))]);
    const v = r && r.data && r.data[0];
    return Array.isArray(v) && v.length === 768 ? v : null;
  } catch (e) { return null; }
}
const shape = (res) => ((res && res.matches) || []).map((m) => ({
  diseaseId: (m.metadata && m.metadata.diseaseId) || null, chunkId: m.id || null, section: (m.metadata && m.metadata.section) || null, score: typeof m.score === "number" ? m.score : null
})).filter((m) => m.diseaseId);

// Daily spend guard: a KV counter per UTC day. Over the cap (or KV unavailable) means no vector arm, keyword only.
async function underCap(env) {
  const kv = env && env.MAIK_KV; if (!kv) return true;
  const cap = Math.max(100, Math.min(DAY_CAP, Number(env.RETRIEVE_DAILY_CAP) || DAY_CAP));
  const k = "retrieve:n:" + new Date().toISOString().slice(0, 10);
  try { const n = Number(await kv.get(k)) || 0; if (n >= cap) return false; await kv.put(k, String(n + 1), { expirationTtl: 172800 }); return true; } catch (e) { return true; }
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Same coarse gate as the AI Function (origin allowlist / verified Cf-Access JWT / app token).
async function authorise(request, env) {
  if (await cfAccessEmail(request, env)) return true;   // a VERIFIED Access JWT; the bare email header is forgeable
  const tok = request.headers.get("X-App-Token");
  if (env.GHIS_APP_TOKEN && tok === env.GHIS_APP_TOKEN) return true;
  if (env.GHIS_APP_TOKEN === undefined && env.AI_APP_TOKEN && tok === env.AI_APP_TOKEN) return true;
  const o = request.headers.get("Origin") || "";
  return o === "https://stewardmd.in" || o === "https://www.stewardmd.in" || o === "https://localhost" || o === "capacitor://localhost" || o === "";
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!(await authorise(request, env))) return json({ matches: [] });      // fail-safe, not 403, so the client falls back
  if (request.method !== "POST") return json({ matches: [] });
  const wai = !!(env.CF_AI_FREE && env.KB_VECTORIZE_OLD), vertex = !!(env.VERTEX_API_KEY && env.KB_VECTORIZE);
  if (!wai && !vertex) return json({ matches: [] });                        // not provisioned: keyword-only

  try {
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const query = String((body && body.query) || "").slice(0, 500).trim();
    if (!query) return json({ matches: [] });
    const k = Math.max(1, Math.min(50, Number(body && body.k) || 12));

    // tier 1: Workers AI free quota against the old bge index
    if (wai) {
      const v = await waiQuery(env, query);
      if (v) {
        try {
          const m = shape(await env.KB_VECTORIZE_OLD.query(v, { topK: k, returnMetadata: "all" }));
          if (m.length) { const o = json({ matches: m }); o.headers.set("X-Retrieve-Tier", "workers-ai"); return o; }
        } catch (e) {}
      }
    }
    // tier 2: Vertex text-embedding-005 against the t5 index, under its own daily cap
    if (vertex && (await underCap(env))) {
      const info = {}, vec = await embedQuery(env, query, info);
      if (vec) {
        const m = shape(await env.KB_VECTORIZE.query(vec, { topK: k, returnMetadata: "all" }));
        const out = json({ matches: m }); out.headers.set("X-Retrieve-Tier", "vertex"); out.headers.set("Server-Timing", "embed;dur=" + (info.ms || 0) + ";desc=\"calls " + (info.calls || 0) + "\""); return out;
      }
    }
    return json({ matches: [] });                                           // tiers 3+ (on-phone model, then keywords) run in the client
  } catch (e) {
    return json({ matches: [] });                                           // never break retrieval
  }
}
