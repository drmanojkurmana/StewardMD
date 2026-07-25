/* functions/api/experimental/[[path]].js — Experimental Access framework router.
 *
 * The one surface the app + admin console talk to; every check is server-side.
 *
 *   APP  (X-App-Token / allowed Origin; a valid Firebase ID token gives the caller uid):
 *     GET  /api/experimental/features                                  -> { features:[…] }
 *     POST /api/experimental/activate  { feature, code, deviceId, deviceModel, platform }
 *                                                                       -> { ok, token, … } | { ok:false, error, message }
 *     POST /api/experimental/verify    { feature, deviceId, token }     -> { active, reason? }
 *     POST /api/experimental/status    { feature, deviceId }            -> { active, token?, … }  (authoritative; restores after reinstall)
 *
 *   ADMIN (owner Google login via _adminauth.ownerOK):
 *     GET  /api/experimental/admin/features
 *     POST /api/experimental/admin/generate       { feature, expiry, notes }   -> { ok, code (ONCE), id }
 *     GET  /api/experimental/admin/codes?feature=
 *     GET  /api/experimental/admin/activations?feature=
 *     POST /api/experimental/admin/set-tier        { activationId, tier }   (change an activation's tier)
 *     POST /api/experimental/admin/revoke         { activationId }   (deactivate a device; code stays consumed)
 *     POST /api/experimental/admin/revoke-code    { id }             (kill a code by its hash id)
 *     POST /api/experimental/admin/delete-expired { feature? }
 *     GET  /api/experimental/admin/analytics?feature=
 *
 * Rate-limited per identity + IP on /activate to blunt guessing (codes are already high-entropy).
 */
import * as X from "../../_experimental.js";
import { verifyFirebaseToken } from "../../_fbauth.js";
import { ownerOK } from "../../_adminauth.js";
import { usageKv } from "../../_usage.js";

const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || "";
  const h = { "Vary": "Origin" };
  if (CORS_ORIGINS.indexOf(o) >= 0) { h["Access-Control-Allow-Origin"] = o; h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"; h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-App-Token, X-Admin-Token"; h["Access-Control-Max-Age"] = "86400"; }
  return h;
}
function json(obj, status, request) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)) }); }

// App gate — same posture as /api/fundx: Cf-Access email, a matching app token, or an allowed Origin.
function authorise(request, env) {
  if (request.headers.get("Cf-Access-Authenticated-User-Email")) return true;
  const tok = request.headers.get("X-App-Token");
  if (tok && (tok === env.EXPERIMENTAL_APP_TOKEN || tok === env.FUNDX_APP_TOKEN || tok === env.AI_APP_TOKEN || tok === env.GHIS_APP_TOKEN)) return true;
  const o = request.headers.get("Origin") || "";
  return o === "https://stewardmd.in" || o === "https://www.stewardmd.in" || o === "https://localhost" || o === "capacitor://localhost" || o === "";
}
// The caller's Firebase uid (device binding is bound to the SERVER-derived uid — never a client value).
async function callerUid(request, env) {
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  try { return await verifyFirebaseToken(tok, env); } catch (e) { return null; }
}
function clientIp(request) { return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "ip"; }

// Activation rate limit (min interval + per-identity/day cap) — high-entropy codes make guessing
// infeasible; this is defence in depth. Fail-open if no KV is bound.
async function rateLimit(env, request, uid) {
  const store = usageKv(env);
  if (!store) return { ok: true };
  const id = "xa:" + (uid || clientIp(request));
  const nowS = Math.floor(Date.now() / 1000);
  try {
    const last = await store.get("xa:rate:" + id);
    if (last && (nowS - Number(last)) < 2) return { ok: false, code: "rate_limited", status: 429 };
    await store.put("xa:rate:" + id, String(nowS), { expirationTtl: 60 });
    const day = new Date(nowS * 1000).toISOString().slice(0, 10);
    const ckey = "xa:count:" + id + ":" + day;
    const cur = Number(await store.get(ckey)) || 0;
    const cap = Number(env.EXPERIMENTAL_ACTIVATE_DAILY_CAP) || 30;
    if (cur >= cap) return { ok: false, code: "too_many_attempts", status: 429 };
    await store.put(ckey, String(cur + 1), { expirationTtl: 90000 });
  } catch (e) { return { ok: true }; }
  return { ok: true };
}

async function readBody(request) { try { return await request.json(); } catch (e) { return {}; } }

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const isAdmin = /\/admin(\/|$)/.test(path);
  const seg = path.split("/").pop();

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

  try {
    // ---------- ADMIN (owner login) ----------
    if (isAdmin) {
      if (!(await ownerOK(request, env))) return json({ error: "forbidden" }, 403, request);
      if (request.method === "GET" && seg === "features") return json({ features: X.featureList() }, 200, request);
      if (request.method === "GET" && seg === "codes") return json({ codes: await X.listCodes(env, { feature: url.searchParams.get("feature") || null }) }, 200, request);
      if (request.method === "GET" && seg === "activations") return json({ activations: await X.listActivations(env, { feature: url.searchParams.get("feature") || null }) }, 200, request);
      if (request.method === "GET" && seg === "analytics") return json({ analytics: await X.analytics(env, { feature: url.searchParams.get("feature") || null }) }, 200, request);
      if (request.method === "POST" && seg === "generate") {
        const b = await readBody(request);
        if (!X.isFeature(b.feature)) return json({ error: "bad_feature" }, 400, request);
        const r = await X.generateCode(env, { feature: b.feature, expiry: b.expiry, notes: b.notes, tier: b.tier });
        return json(r, 200, request);
      }
      if (request.method === "POST" && seg === "set-tier") {
        const b = await readBody(request);
        if (!b.activationId) return json({ error: "missing_activationId" }, 400, request);
        return json(await X.setActivationTier(env, { activationId: b.activationId, tier: b.tier }), 200, request);
      }
      if (request.method === "POST" && seg === "revoke") {
        const b = await readBody(request);
        if (!b.activationId) return json({ error: "missing_activationId" }, 400, request);
        return json(await X.revokeActivation(env, { activationId: b.activationId }), 200, request);
      }
      if (request.method === "POST" && seg === "revoke-code") {
        const b = await readBody(request);
        if (!b.id) return json({ error: "missing_id" }, 400, request);
        return json(await X.revokeCode(env, { hashedCode: b.id }), 200, request);
      }
      if (request.method === "POST" && seg === "delete-expired") {
        const b = await readBody(request);
        return json(await X.deleteExpired(env, { feature: b.feature || null }), 200, request);
      }
      return json({ error: "not_found" }, 404, request);
    }

    // ---------- APP ----------
    if (!authorise(request, env)) return json({ error: "unauthorized" }, 401, request);
    if (request.method === "GET" && seg === "features") return json({ features: X.featureList() }, 200, request);

    if (request.method === "POST" && seg === "activate") {
      const uid = await callerUid(request, env);
      const rl = await rateLimit(env, request, uid);
      if (!rl.ok) return json({ ok: false, error: rl.code, message: "Too many attempts — please wait and try again." }, rl.status, request);
      const b = await readBody(request);
      const r = await X.activate(env, { feature: b.feature, code: b.code, uid, deviceId: b.deviceId, deviceModel: b.deviceModel, platform: b.platform });
      if (!r.ok) return json({ ok: false, error: r.error, message: X.messageFor(r.error) }, r.error === "signin_required" ? 401 : 200, request);
      return json(r, 200, request);
    }

    if (request.method === "POST" && seg === "verify") {
      const uid = await callerUid(request, env);
      const b = await readBody(request);
      return json(await X.verify(env, { feature: b.feature, deviceId: b.deviceId, token: b.token, uid }), 200, request);
    }

    if (request.method === "POST" && seg === "status") {
      const uid = await callerUid(request, env);
      if (!uid) return json({ active: false, error: "signin_required" }, 401, request);
      const b = await readBody(request);
      return json(await X.statusFor(env, { feature: b.feature, deviceId: b.deviceId, uid }), 200, request);
    }

    return json({ error: "not_found" }, 404, request);
  } catch (e) {
    const status = (e && e.status) || 500;
    return json({ error: (e && e.code) || "internal_error", detail: (e && e.detail) || null }, status, request);
  }
}
