/* StewardMD — ICU Cases store (Cloudflare Pages Function)
 *
 * Cloud persistence for ICU patient cases so a clinician's saved patients follow
 * THEM across devices. Storage is scoped PER AUTHENTICATED USER — a clinician can
 * only ever read/write their own cases. Capped at MAX (10) cases per user; the
 * oldest is evicted on overflow.
 *
 * IDENTITY (required for all case operations — this is PHI):
 *   1. Cloudflare Access header  Cf-Access-Authenticated-User-Email  (if deployed
 *      behind Access), OR
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
const MAX = 10;
const FB_PROJECT_DEFAULT = "stewardmd-498ec";
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }
function idxKey(uid) { return "icu:index:" + uid; }
function caseKey(uid, id) { return "icu:case:" + uid + ":" + id; }

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

// ── Firebase ID token verification (RS256, via Google's public JWK set) ──────
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function b64urlToString(s) { return new TextDecoder().decode(b64urlToBytes(s)); }

let _jwks = null, _jwksExp = 0;                 // per-isolate cache of Google's signing keys
async function getJwks() {
  const now = Date.now();
  if (_jwks && now < _jwksExp) return _jwks;
  const r = await fetch(JWK_URL);
  const data = await r.json();
  const map = {};
  for (const k of (data.keys || [])) map[k.kid] = k;
  const cc = r.headers.get("Cache-Control") || "", m = cc.match(/max-age=(\d+)/);
  _jwksExp = now + (m ? parseInt(m[1], 10) * 1000 : 3600 * 1000);
  _jwks = map;
  return map;
}
async function verifyFirebaseToken(token, env) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = JSON.parse(b64urlToString(parts[0])); payload = JSON.parse(b64urlToString(parts[1])); }
  catch (e) { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== project) return null;
  if (payload.iss !== "https://securetoken.google.com/" + project) return null;
  if (!payload.sub) return null;
  if (!(typeof payload.exp === "number" && payload.exp > now)) return null;
  if (typeof payload.iat === "number" && payload.iat > now + 300) return null;   // small clock skew
  const jwk = (await getJwks())[header.kid];
  if (!jwk) return null;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]));
  } catch (e) { return null; }
  return ok ? payload.sub : null;
}

// Stable, namespaced per-user id — or null if the caller is not authenticated.
async function identify(request, env) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (email) return "cfa:" + email.toLowerCase();
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (tok) { const uid = await verifyFirebaseToken(tok, env); if (uid) return "fb:" + uid; }
  return null;
}

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
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
