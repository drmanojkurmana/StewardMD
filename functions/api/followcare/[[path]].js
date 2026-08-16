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
import { runScheduler, sendPatientMessage } from "../../_followcare_dispatch.js";
import I18n from "../../../followcare-i18n.js";
import Analytics from "../../../followcare-analytics.js";
import Intel from "../../../followcare-intel.js";
import Integration from "../../../followcare-integration.js";
// Side-effect import: registers globalThis.FollowCareDiagnosis so Integration.diagnosisToPathway (used by
// the CSV bulk-enroll) resolves via the full ICD-10 + text DiagnosisMapper, not the legacy fallback table.
import "../../../followcare-diagnosis.js";
// Doctor Action Center (flag smd_followcare_actions): doctor↔patient communication. Pure model + server layer.
import * as FCC from "../../_followcare_comms.js";
import Comms from "../../../followcare-comms.js";
// AI Voice Fallback (flag smd_followcare_voice): eligibility/scheduling/records + engine-reuse on call result.
import * as FCV from "../../_followcare_voice.js";

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
// Constant-time string compare (secret tokens are high-entropy; still avoid an early-return timing oracle).
function ctEq(a, b) { a = String(a || ""); b = String(b || ""); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
// The RunPod voice service's credential for posting call results (Phase 2). Owner login also works (for testing).
async function voiceServiceOK(request, env) {
  const t = request.headers.get("X-Voice-Token") || "";
  if (env.FOLLOWCARE_VOICE_SERVICE_TOKEN && ctEq(t, env.FOLLOWCARE_VOICE_SERVICE_TOKEN)) return true;
  return await ownerOK(request, env);
}

async function notifyClinician(env, ep, escalation) {
  try {
    if (!ep || !ep.doctorUid || !nativePushEnabled(env)) return;
    // Minimum-necessary (HIPAA §164.502(b)): the push carries NO diagnosis and no patient identifier — just an
    // urgency-tiered prompt + the opaque episodeId for an in-app deep link. Details load in-app after auth.
    const title = escalation === "red" ? "FollowCare · urgent review" : "FollowCare · review needed";
    const body = "A recovery check-in needs your review. Tap to open.";
    await sendNativeToAll(env, { title, body, data: { type: "followcare", episodeId: ep.episodeId } }, { uid: "fb:" + ep.doctorUid });
  } catch (e) { /* push is best-effort — an escalation is still visible on the dashboard */ }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const isAdmin = /\/admin(\/|$)/.test(path);
  const isVoice = /\/voice\//.test(path);
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
      // Cron/owner-triggered daily dispatch: send due check-in links + reminders, escalate missed check-ins.
      if (request.method === "POST" && seg === "run-scheduler") {
        const summary = await runScheduler(env, Date.now(), { notify: function (ep, level) { return notifyClinician(env, ep, level); } });
        return json({ ok: true, summary }, 200, request);
      }
      // AI voice fallback scheduler (flag smd_followcare_voice; per-hospital enable). Fires at the IST window
      // crons. Enqueues eligible non-responders inside their window + reports the GPU-start decision. Phase 1
      // does not place calls (the RunPod voice service does) — it is inert until a hospital enables voice.
      if (request.method === "POST" && seg === "run-voice") {
        const summary = await FCV.runVoiceScheduler(env, Date.now(), {});
        return json({ ok: true, summary }, 200, request);
      }
      // Phase 3 — hospital command-center analytics (owner-gated; NON-PHI aggregates only).
      if (request.method === "GET" && seg === "analytics") {
        const eps = await FC.listAllSummaries(env, url.searchParams.get("hospitalId") || "");
        const now = Date.now();
        return json({ analytics: {
          commandCenter: Analytics.commandCenter(eps, now), rollup: Analytics.rollup(eps),
          byDepartment: Analytics.byDepartment(eps), byDisease: Analytics.byDisease(eps),
          quality: Analytics.quality(eps), executive: Analytics.executive(eps),
          insights: Analytics.insights(eps), digest: Analytics.digest(eps, now),
        } }, 200, request);
      }
      // Phase 4 — discharge CSV bulk import (for hospitals without an API). The importer attests batch consent.
      if (request.method === "POST" && seg === "import") {
        const b = await readBody(request);
        if (!b.hospitalId) return json({ error: "missing_hospitalId" }, 400, request);
        if (!b.consentAttested) return json({ error: "consent_required" }, 400, request);
        const parsed = Integration.fromDischargeCSV(b.csv || "");
        const doctorUid = b.assignDoctorUid || ("hospital:" + b.hospitalId);
        const res = { enrolled: 0, failed: 0, errors: parsed.errors.slice(0, 100) };
        for (const row of parsed.rows.slice(0, 500)) {
          const r = await FC.enrollEpisode(env, { hospitalId: b.hospitalId, doctorUid: doctorUid, pathwayId: row.pathwayId, phone: row.phone, name: row.name, dischargeMs: row.dischargeMs, lang: row.lang, consentAttested: true });
          if (r.ok) res.enrolled++; else { res.failed++; res.errors.push({ reason: r.error }); }
        }
        return json(res, 200, request);
      }
      // CSV export (MODULE 16) — NON-PHI operational columns.
      if (request.method === "GET" && seg === "report") {
        const eps = await FC.listAllSummaries(env, url.searchParams.get("hospitalId") || "");
        return new Response(Analytics.csv(eps), { status: 200, headers: Object.assign({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=followcare-report.csv", "Cache-Control": "no-store" }, corsHeaders(request)) });
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
    if (seg === "lang" && request.method === "POST") {
      // Patient sets their preferred portal language (token-gated, no login). Stored so it's never re-asked.
      const b = await readBody(request);
      const rl = await rateLimit(env, request, "lang");
      if (!rl.ok) return json({ error: "rate_limited" }, 429, request);
      const res = await FC.setPortalLanguage(env, b.t, b.lang);
      return json(res, res.ok ? 200 : (res.error === "link_expired" ? 410 : 400), request);
    }
    if (seg === "forget" && request.method === "POST") {
      // Patient right-to-erasure / messaging opt-out (token-gated, no login). DPDP §13.
      const b = await readBody(request);
      const rl = await rateLimit(env, request, "forget");
      if (!rl.ok) return json({ error: "rate_limited" }, 429, request);
      const res = await FC.forgetViaToken(env, b.t);
      return json(res, res.ok ? 200 : (res.error === "link_expired" ? 410 : 400), request);
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

    // ---------------- PATIENT (token-gated, no login) · Doctor Action Center ----------------
    if (seg === "inbox" && request.method === "GET") {
      const rl = await rateLimit(env, request, "inbox");
      if (!rl.ok) return json({ error: "rate_limited" }, 429, request);
      const res = await FCC.patientInbox(env, url.searchParams.get("t") || "");
      return json(res, res.ok ? 200 : (res.error === "link_expired" ? 410 : 400), request);
    }
    if (seg === "respond" && request.method === "POST") {
      const b = await readBody(request);
      const rl = await rateLimit(env, request, "respond");
      if (!rl.ok) return json({ error: "rate_limited" }, 429, request);
      const res = await FCC.respondToComm(env, b.t, b.commId || "", b.kind || "", b);
      if (res.ok && res.notify !== false) { /* doctor push is best-effort + handled elsewhere */ }
      return json(res, res.ok ? 200 : (res.error === "link_expired" ? 410 : (res.error === "not_found" ? 404 : 400)), request);
    }
    if (seg === "upload" && request.method === "POST") {
      // Binary photo upload (patient token). Streams to R2 via the binding — never buffered as JSON.
      const rl = await rateLimit(env, request, "upload");
      if (!rl.ok) return json({ error: "rate_limited" }, 429, request);
      const ct = request.headers.get("content-type") || "";
      const len = parseInt(request.headers.get("content-length") || "0", 10) || null;
      const res = await FCC.uploadPhoto(env, url.searchParams.get("t") || "", url.searchParams.get("commId") || "", ct, len, request.body);
      return json(res, res.ok ? 200 : (res.error === "link_expired" ? 410 : (res.error === "media_not_configured" ? 503 : 400)), request);
    }

    // ---------------- VOICE FALLBACK: result ingest + patient opt-out ----------------
    // The RunPod voice service posts a completed call's result here (its own service token). Runs the SAME
    // engine as the portal submit → escalation/notify/records converge on one source of truth.
    if (isVoice && seg === "result" && request.method === "POST") {
      if (!(await voiceServiceOK(request, env))) return json({ error: "forbidden" }, 403, request);
      const b = await readBody(request);
      const res = await FCV.submitVoiceResult(env, b.episodeId || "", b, { notify: function (ep, level) { return notifyClinician(env, ep, level); } });
      return json(res, res.ok ? 200 : (res.error === "not_found" ? 404 : 400), request);
    }
    // Patient opts out of (or back into) AI voice calls from their portal link — token-gated, no login.
    if (isVoice && seg === "optout" && request.method === "POST") {
      const b = await readBody(request);
      const rl = await rateLimit(env, request, "voice_optout");
      if (!rl.ok) return json({ error: "rate_limited" }, 429, request);
      const v = await FC.verifyEpisodeToken(env, b.t);
      if (!v.ok) return json({ ok: false, error: v.error }, v.error === "link_expired" ? 410 : 400, request);
      return json(await FCV.setVoiceOptOut(env, v.ep.episodeId, b.optOut !== false), 200, request);
    }

    // ---------------- CLINICIAN (app-gated + Firebase uid) ----------------
    if (!authorise(request, env)) return json({ error: "unauthorized" }, 401, request);
    if (request.method === "GET" && seg === "ready") {
      // `media` = is the R2 photo bucket bound? (lets the app tell if Request-Photo is fully provisioned)
      return json({ ready: FC.isConfigured(env), enabled: enabled(env), media: !!(env && env.FOLLOWCARE_R2), photoViewOnce: String((env && env.FOLLOWCARE_PHOTO_VIEW_ONCE) || "") === "1" }, 200, request);
    }
    if (request.method === "GET" && seg === "pathways") {
      return json({ pathways: Pathways.list().map(function (p) { return { id: p.id, name: p.name, schedule: p.schedule, version: p.version }; }) }, 200, request);
    }

    const uid = await callerUid(request, env);
    if (!uid) return json({ error: "signin_required" }, 401, request);

    // The doctor's hospital binding (tenant authority). Set once, then used to scope every enroll.
    if (seg === "hospital" && request.method === "GET") {
      return json({ hospital: await FC.resolveDoctorHospital(env, uid) }, 200, request);
    }
    if (seg === "hospital" && request.method === "POST") {
      const b = await readBody(request);
      return json(await FC.setDoctorHospital(env, uid, { hospitalId: b.hospitalId, hospitalName: b.hospitalName }), 200, request);
    }

    // ---------------- VOICE FALLBACK: clinician settings + manual call ----------------
    // Per-hospital voice + ambulance settings (resolved from the doctor's binding; owner may target any hospital).
    if (isVoice && seg === "settings") {
      const bind = await FC.resolveDoctorHospital(env, uid);
      const isOwner = await ownerOK(request, env);
      let hospitalId = bind && bind.hospitalId;
      if (request.method === "GET") {
        if (isOwner && url.searchParams.get("hospitalId")) hospitalId = url.searchParams.get("hospitalId");
        if (!hospitalId) return json({ error: "hospital_not_set" }, 400, request);
        return json({ ok: true, hospitalId, settings: await FCV.getHospitalSettings(env, hospitalId) }, 200, request);
      }
      if (request.method === "POST") {
        const b = await readBody(request);
        if (isOwner && b.hospitalId) hospitalId = b.hospitalId;
        if (!hospitalId) return json({ error: "hospital_not_set" }, 400, request);
        return json(await FCV.setHospitalSettings(env, hospitalId, { voice: b.voice, ambulance: b.ambulance }, "doctor:" + uid), 200, request);
      }
    }
    // Doctor-initiated AI call. Same 1-call/day + not-responded + window guards as the scheduler (no bypass).
    if (isVoice && seg === "call" && request.method === "POST") {
      const b = await readBody(request);
      const ep = await FC.getEpisode(env, b.episodeId || "");
      if (!ep) return json({ error: "not_found" }, 404, request);
      if (ep.doctorUid !== uid && !(await ownerOK(request, env))) return json({ error: "forbidden" }, 403, request);
      const settings = await FCV.getHospitalSettings(env, ep.hospitalId);
      const r = await FCV.queueVoiceCall(env, ep, settings, Date.now(), { manual: true, actor: "doctor:" + uid });
      return json(r, r.ok ? 200 : 400, request);
    }

    if (request.method === "POST" && seg === "enroll") {
      const b = await readBody(request);
      // Tenant authority: the hospital is resolved SERVER-SIDE from the doctor's uid-keyed binding, never
      // taken from the request body (which would let a doctor enroll under any hospital). Owner may override.
      const isOwner = await ownerOK(request, env);
      const bind = await FC.resolveDoctorHospital(env, uid);
      let hospitalId = bind && bind.hospitalId;
      if (isOwner && b.hospitalId) hospitalId = b.hospitalId;
      if (!hospitalId) return json({ error: "hospital_not_set" }, 400, request);
      if (b.hospitalId && !isOwner && b.hospitalId !== hospitalId) return json({ error: "hospital_mismatch" }, 403, request);
      const r = await FC.enrollEpisode(env, {
        hospitalId: hospitalId, doctorUid: uid, pathwayId: b.pathwayId, phone: b.phone, name: b.name,
        dischargeMs: b.dischargeMs, lang: b.lang, sendHour: b.sendHour, tz: b.tz,
        consentAttested: b.consentAttested, isMinor: b.isMinor, guardianPhone: b.guardianPhone,
      });
      // AUTOMATE delivery: on a successful enrol, send the patient their secure link immediately over the
      // configured channel (WhatsApp/SMS) — no more manual copy/paste. Consent was attested at enrol. The link
      // is still returned so the doctor can also copy/share it. Fails SAFE: if the channel isn't configured the
      // send is "skipped" and the doctor shares manually. `delivered` tells the UI what happened.
      if (r.ok) {
        try {
          const ep = await FC.getEpisode(env, r.episodeId);
          const body = I18n.t("fc.msg.welcome", (ep && ep.lang) || b.lang || "en", { link: r.link });
          const send = await sendPatientMessage(env, ep, body, { link: r.link });
          r.delivered = (send && send.ok) ? "sent" : (send && send.skipped ? "not_configured" : "failed");
          r.channel = String(env.FOLLOWCARE_MSG_CHANNEL || "sms").toLowerCase();
        } catch (e) { r.delivered = "failed"; }
      }
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
      // Audit the PHI/clinical-read (who viewed which episode, when) — HIPAA §164.312(b) / DPDP accountability.
      const auditRead = FC.audit(env, { hospitalId: ep.hospitalId, episodeId: id, actor: "doctor:" + uid, action: "view" });
      context.waitUntil ? context.waitUntil(auditRead) : await auditRead;
      const summary = FC.episodeSummary(ep);
      const timeline = await FC.episodeTimeline(env, id);
      // Phase 5 — recovery intelligence for this episode (twin / deterioration prediction / prevention plan).
      const pw = Pathways.get(ep.pathwayId);
      const lastTl = timeline.length ? timeline[timeline.length - 1] : null;
      const latest = { recoveryScore: summary.score, escalation: summary.currentEscalation, readmissionRisk: summary.risk, trend: summary.trend, redFlags: (lastTl && lastTl.redFlags) || [], reasons: (lastTl && lastTl.reasons) || [] };
      const intel = {
        twin: Intel.recoveryTwin(pw, ep.lastDayDone, latest),
        prediction: Intel.predictDeterioration(timeline.map(function (t) { return { dayOffset: t.dayOffset, score: t.score, escalation: t.escalation }; }), latest, pw),
        prevention: Intel.preventionPlan(latest, ep.pathwayId),
      };
      // AI voice fallback status for this episode (eligibility / last call / 1-per-day) — UI shows a card + button.
      let voice = null;
      try { const vs = await FCV.getHospitalSettings(env, ep.hospitalId); voice = await FCV.voiceStatusForEpisode(env, ep, vs, Date.now()); } catch (e) {}
      return json({ episode: summary, timeline: timeline, intel: intel, voice: voice }, 200, request);
    }

    // ---------------- Doctor Action Center (clinician, tenant-scoped) ----------------
    // Resolve the caller's episode + ownership once for every comms route.
    async function ownEpisode(id) {
      const ep = await FC.getEpisode(env, id);
      if (!ep) return { err: json({ error: "not_found" }, 404, request) };
      if (ep.doctorUid !== uid && !(await ownerOK(request, env))) return { err: json({ error: "forbidden" }, 403, request) };
      return { ep: ep };
    }
    if (request.method === "POST" && seg === "action") {
      const b = await readBody(request);
      const r = await ownEpisode(b.episodeId || ""); if (r.err) return r.err;
      const bind = await FC.resolveDoctorHospital(env, uid);
      const doctor = { uid: uid, name: String(b.doctorName || "").slice(0, 120), hospitalName: (bind && bind.hospitalName) || "" };
      const res = await FCC.postDoctorAction(env, r.ep, doctor, b.type || "", b);
      return json(res, res.ok ? 200 : 400, request);
    }
    if (request.method === "GET" && seg === "comms") {
      const r = await ownEpisode(url.searchParams.get("id") || ""); if (r.err) return r.err;
      return json(await FCC.listComms(env, r.ep.episodeId), 200, request);
    }
    if (request.method === "POST" && seg === "draft") {
      // AI draft suggestion (doctor reviews/edits/discards; never auto-sent).
      const b = await readBody(request);
      const r = await ownEpisode(b.episodeId || ""); if (r.err) return r.err;
      const s = FC.episodeSummary(r.ep);
      const ctx = { pathwayId: r.ep.pathwayId, disease: r.ep.disease, escalation: s.currentEscalation, score: s.score, trend: s.trend };
      return json({ ok: true, draft: FCC.draftFor(b.kind || "reply", ctx) }, 200, request);
    }
    if (request.method === "GET" && seg === "media") {
      // Stream an uploaded photo. Key format: followcare/<episodeId>/... — enforce the doctor owns that episode.
      const key = url.searchParams.get("key") || "";
      const m = key.match(/^followcare\/([^/]+)\//);
      if (!m) return json({ error: "bad_key" }, 400, request);
      const r = await ownEpisode(m[1]); if (r.err) return r.err;
      const obj = await FCC.getMedia(env, key);
      if (!obj) return json({ error: "not_found_or_expired" }, 404, request);   // expired photos are purged + 404
      const h = new Headers(corsHeaders(request));
      h.set("Content-Type", obj.contentType || "application/octet-stream");
      h.set("Cache-Control", "private, no-store");
      return new Response(obj.body, { status: 200, headers: h });
    }
    if (request.method === "GET" && seg === "export") {
      // Phase 4 — EMR write-back payload (FHIR R4-ish Bundle). No PHI beyond the EMR patient ref the caller supplies.
      const id = url.searchParams.get("id") || "";
      const ep = await FC.getEpisode(env, id);
      if (!ep) return json({ error: "not_found" }, 404, request);
      if (ep.doctorUid !== uid && !(await ownerOK(request, env))) return json({ error: "forbidden" }, 403, request);
      const tl = await FC.episodeTimeline(env, id);
      return json({ fhir: Integration.toFHIR(FC.episodeSummary(ep), tl, { emrPatientId: url.searchParams.get("emrId") || "" }) }, 200, request);
    }
    if (request.method === "POST" && seg === "revoke") {
      const b = await readBody(request);
      const ep = await FC.getEpisode(env, b.episodeId);
      if (!ep) return json({ error: "not_found" }, 404, request);
      if (ep.doctorUid !== uid && !(await ownerOK(request, env))) return json({ error: "forbidden" }, 403, request);
      return json(await FC.revokeLinks(env, b.episodeId, "doctor:" + uid), 200, request);
    }
    if (request.method === "POST" && seg === "ack") {
      const b = await readBody(request);
      const ep = await FC.getEpisode(env, b.episodeId);
      if (!ep) return json({ error: "not_found" }, 404, request);
      if (ep.doctorUid !== uid && !(await ownerOK(request, env))) return json({ error: "forbidden" }, 403, request);
      return json(await FC.acknowledgeEpisode(env, b.episodeId, "doctor:" + uid), 200, request);
    }
    if (request.method === "POST" && seg === "erase") {
      // Clinician/owner erasure of a patient's episode + all its data (DPDP §13 right to be forgotten).
      const b = await readBody(request);
      const ep = await FC.getEpisode(env, b.episodeId);
      if (!ep) return json({ ok: true, erased: false }, 200, request);   // already gone → idempotent
      if (ep.doctorUid !== uid && !(await ownerOK(request, env))) return json({ error: "forbidden" }, 403, request);
      return json(await FC.eraseEpisode(env, b.episodeId, "doctor:" + uid), 200, request);
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
