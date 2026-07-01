/* StewardMD — ICU Cases store (Cloudflare Pages Function)
 *
 * Cloud persistence for ICU patient cases so a clinician's saved patients follow
 * them across devices. Capped at MAX (10) cases; the oldest is evicted on overflow.
 *
 * Routes:
 *   GET    /api/cases        -> { enabled, cases:[{id,name,dx,bed,savedAt}] }  (index only)
 *   GET    /api/cases/:id    -> { case:{id,name,dx,bed,savedAt,state} } | 404
 *   PUT    /api/cases/:id    -> { ok, cases:[index] }   body = full case entry
 *   DELETE /api/cases/:id    -> { ok, cases:[index] }
 *
 * Storage: env.CASES_KV (preferred) or env.GHIS_KV (fallback, key-prefixed).
 *   index key : "icu:index"      -> JSON [{id,name,dx,bed,savedAt}]
 *   case key  : "icu:case:<id>"  -> JSON full entry (includes ICU_STATE snapshot)
 * If no KV is bound, GET returns { enabled:false } and writes return 501 so the
 * client falls back to on-device (localStorage) storage.
 *
 * PHI: ICU cases contain patient data. Access is gated (Cf-Access / X-App-Token /
 * same-origin) exactly like the GHIS/AI Functions, and responses are never cached
 * (Cache-Control:no-store; sw.js also bypasses /api/).
 */
const MAX = 10;
const IDX = "icu:index", PFX = "icu:case:";

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }

function authorise(request, env) {
  if (request.headers.get("Cf-Access-Authenticated-User-Email")) return true;
  if (env.GHIS_APP_TOKEN && request.headers.get("X-App-Token") === env.GHIS_APP_TOKEN) return true;
  const o = request.headers.get("Origin") || "";
  return o.endsWith("stewardmd.in") || o === "";
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

async function readIndex(store) { try { return (await store.get(IDX, "json")) || []; } catch (e) { return []; } }

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!authorise(request, env)) return json({ error: "unauthorised" }, 403);

  const store = kv(env);
  const id = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const method = request.method;

  if (!store) {
    if (method === "GET" && !id) return json({ enabled: false, cases: [] });
    return json({ enabled: false, error: "no-store" }, 501);
  }

  try {
    if (method === "GET" && !id) {
      const idx = await readIndex(store);
      idx.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      return json({ enabled: true, cases: idx });
    }
    if (method === "GET" && id) {
      const c = await store.get(PFX + id, "json");
      return c ? json({ case: c }) : json({ error: "not-found" }, 404);
    }
    if (method === "PUT" && id) {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const entry = {
        id,
        name: String(body.name || "Unnamed").slice(0, 120),
        dx: String(body.dx || "").slice(0, 300),
        bed: String(body.bed || "").slice(0, 40),
        savedAt: Number(body.savedAt) || Date.now(),
        state: body.state || {}
      };
      let idx = await readIndex(store);
      idx = idx.filter((e) => e.id !== id);
      idx.push({ id, name: entry.name, dx: entry.dx, bed: entry.bed, savedAt: entry.savedAt });
      idx.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));   // newest first
      const evicted = idx.slice(MAX);                             // beyond MAX = oldest
      idx = idx.slice(0, MAX);
      await store.put(PFX + id, JSON.stringify(entry));
      for (const e of evicted) { try { await store.delete(PFX + e.id); } catch (x) {} }
      await store.put(IDX, JSON.stringify(idx));
      return json({ ok: true, cases: idx });
    }
    if (method === "DELETE" && id) {
      let idx = await readIndex(store);
      idx = idx.filter((e) => e.id !== id);
      await store.delete(PFX + id);
      await store.put(IDX, JSON.stringify(idx));
      return json({ ok: true, cases: idx });
    }
    return json({ error: "bad-request", method, id }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
