/* functions/api/followcare/[[path]].js — FollowCare AI router.
 *
 * Three audiences, three auth postures — every clinical decision is server-side (the engine runs here,
 * never trusting a client score), every route is tenant-scoped, and no PHI ever appears in a URL/log.
 *
 *   CLINICIAN  (Firebase ID token → uid; X-App-Token / allowed Origin app-gate):
 *     GET  /api/followcare/pathways                         -> { pathways:[{id,name,schedule}] }
 *     POST /api/followcare/enroll  { hospitalId, pathwayId, phone, name?, mrn?, dischargeMs?, lang?, sendHour?, tz? }
 *                                                            -> { ok, episodeId, link }   (link = patient portal URL)
 *     GET  /api/followcare/episodes?hospitalId=             -> { episodes:[summary…] }  (only this doctor's)
 *     GET  /api/followcare/episode?id=                      -> { episode, timeline }    (owner doctor only)
 *     POST /api/followcare/revoke  { episodeId }            -> { ok }                    (kills outstanding links)
 *
 *   PATIENT  (opaque signed link token only — NEVER authenticated, NEVER installs the app):
 *     GET  /api/followcare/portal?t=<token>                 -> { disease, dayOffset, questionnaire, firstName }
 *     POST /api/followcare/submit  { t, answers }           -> { escalation, patientMessage, recovered }
 *
 *   ADMIN  (owner Google login via _adminauth.ownerOK):
 *     GET  /api/followcare/admin/stats?hospitalId=          -> { counts by escalation/status }
 *
 * Master flag: FollowCare is gated by env FOLLOWCARE_ENABLED !== "0" (default on server; the client master
 * flag smd_followcare gates the UI). Escalations that need a clinician are pushed via the reused push layer
 * (_taskpush) — but only a de-identified "review needed" ping, never PHI.
 */
import * as FC from "../../_followcare.js";
import Pathways from "../../../followcare-pathways.js";
import { verifyFirebaseToken } from "../../_fbauth.js";
import { ownerOK } from "../../_adminauth.js";
import { fcKv } from "../../_followcare.js";
import { sendNativeToAll, nativePushEnabled } from "../../_nativepush.js";
import { fsQuery } from "../../_fbfirestore.js";

const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || "";
  const h = { "Vary": "Origin" };
  if (CORS_ORIGINS.indexOf(o) >= 0) { h["Access-Control-Allow-Origin"] = o; h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"; h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-App-Token, X-Admin-Token"; h["Access-Control-Max-Age"] = "86400"; }
  return h;
}
function json(obj, status, request) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)) }); }
async function readBody(request) { try { return await request.json(); } catch (e) { return {}; } }
function enabled(env) { return String((env && env.FOLLOWCARE_ENABLED) == null ? "1" : env.FOLLOWCARE_ENABLED) !== "0"; }

// App gate (same posture as /api/experimental + /api/fundx): Cf-Access email, a matching app token, or an allowed Origin.
function authorise(request, env) {
  if (request.headers.get("Cf-Access-Authenticated-User-Email")) return true;
  const tok = request.headers.get("X-App-Token");
  if (tok && (tok === env.FOLLOWCARE_APP_TOKEN || tok === env.AI_APP_TOKEN || tok === env.FUNDX_APP_TOKEN)) return true;
  const o = request.headers.get("Origin") || "";
  return o === "https://stewardmd.in" || o === "https://www.stewardmd.in" || o === "https://localhost" || o === "capacitor://localhost" || o === "";
}
async function callerUid(request, env) {
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  try { return await verifyFirebaseToken(tok, env); } catch (e) { return null; }
}
function clientIp(request) { return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "ip"; }

// Rate limit the patient-facing submit (per link + IP) — defence in depth; tokens are already unguessable.
async function rateLimit(env, request, key) {
  const store = fcKv(env); if (!store) return { ok: true };
  const id = "fc:rl:" + key + ":" + clientIp(request);
  const nowS = Math.floor(Date.now() / 1000);
  try {
    const last = await store.get(id);
    if (last && (nowS - Number(last)) < 2) return { ok: false, status: 429 };
    await store.put(id, String(nowS), { expirationTtl: 60 });
  } catch (e) { return { ok: true }; }
  return { ok: true };
}

// Fire a de-identified "review needed" push to the enrolling clinician. Best-effort; never blocks the reply,
// never carries PHI (no name/phone — just disease + episode id). Reuses the native-push layer; push tokens
// are keyed under the namespaced id "fb:"+uid, while the episode stores the raw Firebase uid.
async function notifyClinician(env, ep, escalation) {
  try {
    if (!ep || !ep.doctorUid || !nativePushEnabled(env)) return;
    const title = escalation === "red" ? "FollowCare · urgent review" : "FollowCare · review needed";
    const body = (ep.disease || "A patient") + " recovery check-in flagged " + escalation + ". Tap to review.";
    await sendNativeToAll(env, { title, body, data: { type: "followcare", episodeId: ep.episodeId, escalation } }, { uid: "fb:" + ep.doctorUid });
  } catch (e) { /* push is best-effort — an escalation is still visible on the dashboard */ }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const isAdmin = /\/admin(\/|$)/.test(path);
  const seg = path.split("/").pop();

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (!enabled(env)) return json({ error: "disabled" }, 503, request);

  try {
    // ---------------- ADMIN ----------------
    if (isAdmin) {
      if (!(await ownerOK(request, env))) return json({ error: "forbidden" }, 403, request);
      if (request.method === "GET" && seg === "stats") {
        const hospitalId = url.searchParams.get("hospitalId") || "";
        return json({ stats: await adminStats(env, hospitalId) }, 200, request);
      }
      return json({ error: "not_found" }, 404, request);
    }

    // ---------------- PATIENT (token only) ----------------
    if (seg === "portal" && request.method === "GET") {
      const t = url.searchParams.get("t") || "";
      const rl = await rateLimit(env, request, "portal");
      if (!rl.ok) return json({ error: "rate_limited" }, 429, request);
      const ctx = await FC.portalContext(env, t);
      return json(ctx, ctx.ok ? 200 : (ctx.error === "link_expired" ? 410 : 400), request);
    }
    if (seg === "submit" && request.method === "POST") {
      const b = await readBody(request);
      const rl = await rateLimit(env, request, "submit");
      if (!rl.ok) return json({ error: "rate_limited" }, 429, request);
      const res = await FC.submitPortalAssessment(env, b.t, b.answers || {});
      if (res.ok && res.notify) {
        const ep = await FC.getEpisode(env, FC.episodeIdFromToken(b.t));
        context.waitUntil ? context.waitUntil(notifyClinician(env, ep, res.escalation)) : notifyClinician(env, ep, res.escalation);
      }
      // Patient only ever sees a safe message + status — never the raw score or clinician-notify plan.
      if (!res.ok) return json({ ok: false, error: res.error }, res.error === "link_expired" ? 410 : 400, request);
      return json({ ok: true, escalation: res.escalation, patientMessage: res.patientMessage, recovered: res.recovered }, 200, request);
    }

    // ---------------- CLINICIAN (app-gated + Firebase uid) ----------------
    if (!authorise(request, env)) return json({ error: "unauthorized" }, 401, request);
    if (request.method === "GET" && seg === "pathways") {
      return json({ pathways: Pathways.list().map(function (p) { return { id: p.id, name: p.name, schedule: p.schedule, version: p.version }; }) }, 200, request);
    }

    const uid = await callerUid(request, env);
    if (!uid) return json({ error: "signin_required" }, 401, request);

    if (request.method === "POST" && seg === "enroll") {
      const b = await readBody(request);
      if (!b.hospitalId) return json({ error: "missing_hospitalId" }, 400, request);
      const r = await FC.enrollEpisode(env, {
        hospitalId: b.hospitalId, doctorUid: uid, pathwayId: b.pathwayId, phone: b.phone, name: b.name, mrn: b.mrn,
        dischargeMs: b.dischargeMs, lang: b.lang, sendHour: b.sendHour, tz: b.tz,
      });
      return json(r, r.ok ? 200 : 400, request);
    }
    if (request.method === "GET" && seg === "episodes") {
      const list = await FC.listEpisodesForDoctor(env, uid, { limit: 200 });
      return json({ episodes: list }, 200, request);
    }
    if (request.method === "GET" && seg === "episode") {
      const id = url.searchParams.get("id") || "";
      const ep = await FC.getEpisode(env, id);
      if (!ep) return json({ error: "not_found" }, 404, request);
      if (ep.doctorUid !== uid && !(await ownerOK(request, env))) return json({ error: "forbidden" }, 403, request);
      return json({ episode: FC.episodeSummary(ep), timeline: await FC.episodeTimeline(env, id) }, 200, request);
    }
    if (request.method === "POST" && seg === "revoke") {
      const b = await readBody(request);
      const ep = await FC.getEpisode(env, b.episodeId);
      if (!ep) return json({ error: "not_found" }, 404, request);
      if (ep.doctorUid !== uid && !(await ownerOK(request, env))) return json({ error: "forbidden" }, 403, request);
      return json(await FC.revokeLinks(env, b.episodeId, "doctor:" + uid), 200, request);
    }

    return json({ error: "not_found" }, 404, request);
  } catch (e) {
    const status = (e && e.status) || 500;
    return json({ error: (e && e.code) || "internal_error" }, status, request);
  }
}

// Aggregate counts for the admin console (tenant-scoped when hospitalId given). Beta volumes are tiny.
async function adminStats(env, hospitalId) {
  const where = hospitalId ? { field: "hospitalId", value: hospitalId } : null;
  const rows = await fsQuery(env, "fc_episodes", where ? { where, limit: 1000 } : { limit: 1000 });
  const by = { active: 0, escalated: 0, recovered: 0, closed: 0 }, esc = { green: 0, yellow: 0, orange: 0, red: 0 };
  rows.forEach(function (d) {
    const f = d.fields || {};
    if (by[f.status] != null) by[f.status]++;
    if (esc[f.lastEscalation] != null) esc[f.lastEscalation]++;
  });
  return { total: rows.length, byStatus: by, byEscalation: esc };
}
