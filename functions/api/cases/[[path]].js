/* StewardMD — ICU Cases store (Cloudflare Pages Function)
 *
 * Cloud persistence for ICU patient cases so a clinician's saved patients follow
 * THEM across devices. Storage is scoped PER AUTHENTICATED USER — a clinician can
 * only ever read/write their own cases. Capped at MAX (10) cases per user; the
 * oldest is evicted on overflow.
 *
 * IDENTITY (required for all case operations — this is PHI):
 *   1. Cloudflare Access, ONLY when its Cf-Access-Jwt-Assertion verifies (_fbauth.js
 *      cfAccessEmail; a bare Cf-Access email header is ignored), OR
 *   2. Firebase ID token in  Authorization: Bearer <token>  (the app's Google
 *      sign-in) — verified server-side against Google's public keys.
 *   A request with no verifiable identity is treated as signed-out: the index GET
 *   returns { enabled:false } (client falls back to on-device localStorage) and
 *   any read-by-id / write returns 401. Cases are NEVER shared between users.
 *
 * Routes:
 *   GET    /api/cases        -> { enabled, cases:[{id,name,dx,bed,savedAt}] }  (this user's index)
 *   GET    /api/cases/:id    -> { case:{...} } | 404
 *   PUT    /api/cases/:id    -> { ok, cases:[index] }   body = full case entry
 *   DELETE /api/cases/:id    -> { ok, cases:[index] }
 *
 * Storage: env.CASES_KV (preferred) or env.GHIS_KV (fallback), keyed per user:
 *   index key : "icu:index:<uid>"       -> JSON [{id,name,dx,bed,savedAt}]
 *   case key  : "icu:case:<uid>:<id>"   -> JSON full entry (includes ICU_STATE snapshot)
 * If no KV is bound, GET returns { enabled:false } and writes return 501.
 *
 * Config: env.FIREBASE_PROJECT_ID (optional; defaults to the app's project id).
 * Responses are never cached (Cache-Control:no-store; sw.js also bypasses /api/).
 */
import { requirePro, needsProBody } from "../../_entitlement.js";
import { identify } from "../../_fbauth.js";   // verified Access JWT or Firebase token -> "cfa:"/"fb:" id
const MAX = 10;

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }
function idxKey(uid) { return "icu:index:" + uid; }
function caseKey(uid, id) { return "icu:case:" + uid + ":" + id; }

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

async function readIndex(store, uid) { try { return (await store.get(idxKey(uid), "json")) || []; } catch (e) { return []; } }

export async function onRequest(context) {
  const { request, env, params } = context;

  const store = kv(env);
  const id = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const method = request.method;

  if (!store) {
    if (method === "GET" && !id) return json({ enabled: false, cases: [] });
    return json({ enabled: false, error: "no-store" }, 501);
  }

  const uid = await identify(request, env);
  if (!uid) {
    // Signed-out: index probe degrades to on-device storage; everything else is denied.
    if (method === "GET" && !id) return json({ enabled: false, cases: [] });
    return json({ enabled: false, error: "auth-required" }, 401);
  }

  try {
    if (method === "GET" && !id) {
      const idx = await readIndex(store, uid);
      idx.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      return json({ enabled: true, cases: idx });
    }
    if (method === "GET" && id) {
      const c = await store.get(caseKey(uid, id), "json");
      return c ? json({ case: c }) : json({ error: "not-found" }, 404);
    }
    if (method === "PUT" && id) {
      // Cross-device cloud sync is Pro; free users keep on-device storage. The 402 now carries the
      // REASON so the client can say "your cases are on this device only, because ..." instead of
      // failing silently, which is indistinguishable from sync being broken.
      const _pg = await requirePro(env, request);
      if (!_pg.ok) return json(needsProBody(_pg, { feature: "cloud-sync" }), 402);
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
      let idx = await readIndex(store, uid);
      idx = idx.filter((e) => e.id !== id);
      idx.push({ id, name: entry.name, dx: entry.dx, bed: entry.bed, savedAt: entry.savedAt });
      idx.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));   // newest first
      const evicted = idx.slice(MAX);                             // beyond MAX = oldest
      idx = idx.slice(0, MAX);
      await store.put(caseKey(uid, id), JSON.stringify(entry));
      for (const e of evicted) { try { await store.delete(caseKey(uid, e.id)); } catch (x) {} }
      await store.put(idxKey(uid), JSON.stringify(idx));
      return json({ ok: true, cases: idx });
    }
    if (method === "DELETE" && id) {
      let idx = await readIndex(store, uid);
      idx = idx.filter((e) => e.id !== id);
      await store.delete(caseKey(uid, id));
      await store.put(idxKey(uid), JSON.stringify(idx));
      return json({ ok: true, cases: idx });
    }
    return json({ error: "bad-request", method, id }, 400);
  } catch (e) {
    { try { console.warn("[api] server error", String((e && e.message) || e).slice(0, 200)); } catch (_e) {} return json({ error: "server_error" }, 500); }
  }
}
