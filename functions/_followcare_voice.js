/* StewardMD · FollowCare AI — Voice Fallback server layer (Pages Functions, service-account).
 *
 * Phase 1: the Cloudflare side of the AI voice fallback. It decides WHO to call, WHEN, and keeps the hard
 * 1-call/day guard; it records calls; and it turns a completed call's answers into a real FollowCare check-in
 * by running the SAME deterministic engine the portal uses (single source of truth — no second brain).
 *
 * Real dialing / STT / TTS live on the RunPod voice service (Phase 2). Phase 1 leaves those as a decision +
 * enqueue only: the scheduler writes fc_voice_calls rows and reports whether the GPU should start; it does not
 * place calls. The feature is INERT in production until a hospital enables voice in its settings.
 *
 * Reuse-first (nothing re-implemented): eligibility/window/guard = FollowCareVoice (pure); clinical scoring =
 * Assessment.scoreAssessment → Engine.assess; notify routing = Schedule.escalationToNotify; dialing number =
 * decPHI(ep.phoneEnc); ambulance/message send = the existing SMS/WhatsApp providers; storage = _fbfirestore.
 *
 * Collections: fc_hospitals/{hospitalId} (settings), fc_voice_calls/{callId} (per-call record),
 *              fc_episodes/{id} (+voiceOptOut, +lastVoiceDate, +lastVoiceMs), fc_assessments (reused on result).
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { getEpisode, decPHI, audit, worstEsc, isConfigured } from "./_followcare.js";
import { sendSms } from "./_followcare_sms.js";
import { sendWhatsApp, waConfigured } from "./_followcare_whatsapp.js";
import Pathways from "../followcare-pathways.js";
import Engine from "../followcare-engine.js";
import Assessment from "../followcare-assessment.js";
import Schedule from "../followcare-schedule.js";
import AI from "../followcare-ai.js";
import Voice from "../followcare-voice.js";

function uuid() { return crypto.randomUUID(); }
function isoDate(ms) { try { return new Date(ms || 0).toISOString().slice(0, 10); } catch (e) { return ""; } }

// ---- per-hospital settings (fc_hospitals/{hospitalId}) -----------------------------------
export async function getHospitalSettings(env, hospitalId) {
  if (!hospitalId) return Voice.normalizeSettings({});
  const d = await fsGet(env, "fc_hospitals/" + String(hospitalId));
  return Voice.normalizeSettings(parseSettingsFields((d && d.fields) || {}));
}
export async function setHospitalSettings(env, hospitalId, patch, actor) {
  if (!hospitalId) return { ok: false, error: "missing_hospitalId" };
  // Normalise BEFORE persisting so the hard caps (1 call/day, window/tz validity) can never be stored around.
  const cur = await getHospitalSettings(env, hospitalId);
  const merged = Voice.normalizeSettings({
    name: (patch && patch.name != null) ? patch.name : cur.name,
    voice: Object.assign({}, cur.voice, (patch && patch.voice) || {}),
    ambulance: Object.assign({}, cur.ambulance, (patch && patch.ambulance) || {}),
  });
  await fsCommit(env, [wUpdate(env, "fc_hospitals/" + String(hospitalId), {
    name: merged.name, voiceJson: JSON.stringify(merged.voice), ambulanceJson: JSON.stringify(merged.ambulance), updatedMs: Date.now(),
  })]);
  await audit(env, { hospitalId, actor: actor || "system", action: "voice_settings" });
  return { ok: true, settings: merged };
}
// fc_hospitals stores the two objects as JSON strings (avoids Firestore nested-map indexing surprises and keeps
// normalizeSettings the single decoder). getHospitalSettings re-parses via normalizeSettings, which tolerates
// either shape (raw fields OR {voiceJson,ambulanceJson}).
function parseSettingsFields(f) {
  if (!f) return {};
  let voice = f.voice, ambulance = f.ambulance;
  try { if (f.voiceJson) voice = JSON.parse(f.voiceJson); } catch (e) {}
  try { if (f.ambulanceJson) ambulance = JSON.parse(f.ambulanceJson); } catch (e) {}
  return { name: f.name, voice, ambulance };
}

// ---- voice status for one episode (UI + /episode) ----------------------------------------
export async function voiceStatusForEpisode(env, ep, settings, nowMs) {
  const now = nowMs || Date.now();
  const guard = Voice.guardOncePerDay(ep, now, settings.voice.tz);
  const elig = Voice.voiceEligible(ep, now, settings);
  const last = await latestCall(env, ep.episodeId);
  return {
    voiceEnabled: !!settings.voice.enabled,
    eligible: elig.eligible, reason: elig.reason,
    optedOut: !!ep.voiceOptOut,
    calledToday: !guard.ok,
    lastCallMs: ep.lastVoiceMs || (last && last.createdMs) || 0,
    lastOutcome: (last && last.outcome) || "",
    lastStatus: (last && last.status) || "",
    ambulanceRequested: !!(last && last.ambulanceRequested),
    emergency: !!(last && last.emergency),
    lastStatement: (last && last.patientStatement) || "",
    nextWindowMs: Voice.nextCallWindow(now, settings).startMs,
  };
}
async function latestCall(env, episodeId) {
  const rows = await fsQuery(env, "fc_voice_calls", { where: { field: "episodeId", value: episodeId }, limit: 25 });
  if (!rows.length) return null;
  return rows.map(function (d) { return d.fields || {}; }).sort(function (a, b) { return (b.createdMs || 0) - (a.createdMs || 0); })[0];
}

// ---- enqueue a call (manual doctor button OR the scheduler) -------------------------------
// Guards, in order (all hard — a doctor CANNOT bypass any of them): voice enabled → not opted out → not
// recovered/closed → a due-unanswered check-in exists (never call a responder) → 1-call/day → eligible.
// Sets lastVoiceDate so the day is consumed at the ATTEMPT (a no-answer still counts — spec §29). Writes an
// fc_voice_calls row (status "scheduled") with scheduledMs = the next permitted window.
export async function queueVoiceCall(env, ep, settings, nowMs, opts) {
  opts = opts || {}; const now = nowMs || Date.now();
  const guard = Voice.guardOncePerDay(ep, now, settings.voice.tz);
  if (!guard.ok) return { ok: false, error: "already_called_today" };
  const elig = Voice.voiceEligible(ep, now, settings, { manual: !!opts.manual });
  if (!elig.eligible) return { ok: false, error: elig.reason };
  const recipientEnc = ep.isMinor ? ep._phi.guardianEnc : ep._phi.phoneEnc;
  if (!recipientEnc) return { ok: false, error: "no_phone" };
  const win = Voice.nextCallWindow(now, settings);
  if (!win.startMs) return { ok: false, error: "no_window" };
  const callId = uuid();
  const due = Voice.dueUnanswered(ep, now)[0] || { dayOffset: 0 };
  await fsCommit(env, [
    wCreate(env, "fc_voice_calls/" + callId, {
      id: callId, episodeId: ep.episodeId, hospitalId: ep.hospitalId, dayOffset: due.dayOffset, lang: ep.lang || "en",
      scheduledMs: win.startMs, startedMs: 0, endedMs: 0, durationMs: 0,
      status: "scheduled", attemptNumber: 1, trigger: opts.manual ? "manual" : "auto",
      outcome: "unknown", redFlag: false, doctorReview: false, ambulanceRequested: false,
      patientStatement: "", summary: "", createdMs: now,
    }),
    wUpdate(env, "fc_episodes/" + ep.episodeId, { lastVoiceDate: Voice.tzDateKey(now, settings.voice.tz), lastVoiceMs: now }, { exists: true }),
  ]);
  await audit(env, { hospitalId: ep.hospitalId, episodeId: ep.episodeId, actor: opts.actor || "system", action: "voice_queued", meta: { trigger: opts.manual ? "manual" : "auto", scheduledMs: win.startMs } });
  return { ok: true, callId, scheduledMs: win.startMs, within: win.within };
}

// ---- daily voice scheduler (cron: POST /admin/run-voice) ----------------------------------
// Scans active/escalated episodes, and for each hospital that has voice ENABLED and is currently inside its
// call window, enqueues eligible non-responders up to maxConcurrent. Returns the GPU-start decision.
// Phase 1 does NOT place calls (dialing is on the RunPod service); it enqueues + reports gpuWouldStart.
export async function runVoiceScheduler(env, nowMs, opts) {
  opts = opts || {}; const now = nowMs || Date.now();
  const cap = Number(env.FOLLOWCARE_SCHEDULER_CAP) || 500;
  const active = await fsQuery(env, "fc_episodes", { where: { field: "status", value: "active" }, limit: cap });
  const escalated = await fsQuery(env, "fc_episodes", { where: { field: "status", value: "escalated" }, limit: cap });
  const rows = active.concat(escalated);
  const settingsCache = {}, perHospitalQueued = {};
  const summary = { scanned: rows.length, eligible: 0, queued: 0, skipped: 0, hospitals: 0, gpuWouldStart: false };

  for (const d of rows) {
    const ep = await getEpisode(env, d.id);
    if (!ep) continue;
    let settings = settingsCache[ep.hospitalId];
    if (!settings) { settings = settingsCache[ep.hospitalId] = await getHospitalSettings(env, ep.hospitalId); }
    if (!settings.voice.enabled || !Voice.withinWindow(now, settings)) { summary.skipped++; continue; }
    if (!Voice.voiceEligible(ep, now, settings).eligible) { summary.skipped++; continue; }
    summary.eligible++;
    const q = perHospitalQueued[ep.hospitalId] || 0;
    if (q >= settings.voice.maxConcurrent) { summary.skipped++; continue; }   // remaining wait for the next run
    const r = await queueVoiceCall(env, ep, settings, now, { actor: "system:cron" });
    if (r.ok) { summary.queued++; perHospitalQueued[ep.hospitalId] = q + 1; } else { summary.skipped++; }
  }
  summary.hospitals = Object.keys(perHospitalQueued).length;
  summary.gpuWouldStart = summary.queued > 0;   // Phase 2: GpuProvider.start() here when true
  return summary;
}

// ---- patient opt-out (token-gated, via the route) ----------------------------------------
export async function setVoiceOptOut(env, episodeId, optedOut) {
  await fsCommit(env, [wUpdate(env, "fc_episodes/" + String(episodeId), { voiceOptOut: !!optedOut }, { exists: true })]);
  return { ok: true, optedOut: !!optedOut };
}

// ---- record a completed call's result — RUN THE SAME ENGINE AS THE PORTAL -----------------
// The RunPod service posts { answers, patientStatement, ambulanceRequested, callId, durationMs, status } after a
// call. A completed call IS a check-in: we score the answers authoritatively, write fc_assessments (exactly-once
// per day — a digital response that already landed wins the race), advance the episode, and record the call.
// meta.notify(ep, level) is the route's de-identified clinician push. ponytail: this mirrors the ~15-line persist
// core of submitPortalAssessment rather than editing that co-owned file — keep the two write shapes in sync.
export async function submitVoiceResult(env, episodeId, payload, meta) {
  if (!isConfigured(env)) return { ok: false, error: "not_configured" };
  payload = payload || {}; meta = meta || {};
  const ep = await getEpisode(env, episodeId);
  if (!ep) return { ok: false, error: "not_found" };
  const settings = await getHospitalSettings(env, ep.hospitalId);
  const now = Date.now();
  const answers = payload.answers || {};
  const status = String(payload.status || "completed");
  const callId = payload.callId || uuid();

  // A call that never got a scored conversation (no answer / technical failure) — record it, no engine run.
  if (status !== "completed" || !Object.keys(answers).length) {
    await fsCommit(env, [wUpdate(env, "fc_voice_calls/" + callId, {
      id: callId, episodeId, hospitalId: ep.hospitalId, status, endedMs: now, durationMs: Number(payload.durationMs) || 0,
      outcome: "unknown", createdMs: now,
    })]);
    await audit(env, { hospitalId: ep.hospitalId, episodeId, actor: "voice", action: "voice_result", meta: { status } });
    return { ok: true, status, scored: false };
  }

  const pw = Pathways.get(ep.pathwayId);
  if (!pw) return { ok: false, error: "bad_pathway" };
  const day = currentDueDayLite(ep, now);
  if (day == null) {
    // Patient already answered (digital response landed while the call was in flight) — cancel, don't double-count.
    await fsCommit(env, [wUpdate(env, "fc_voice_calls/" + callId, { id: callId, episodeId, hospitalId: ep.hospitalId, status: "cancelled", endedMs: now, outcome: "unknown", summary: "patient already responded", createdMs: now })]);
    return { ok: true, status: "cancelled", reason: "already_responded", scored: false };
  }

  const prev = (ep.lastScore != null && ep.lastScore >= 0) ? ep.lastScore : undefined;
  const scored = Assessment.scoreAssessment(ep.pathwayId, answers, { engine: Engine, pathways: Pathways, dayOffset: day, previousScore: prev, previousAnswers: ep.lastAnswers || undefined, answers });
  if (!scored) return { ok: false, error: "score_failed" };
  const r = scored.result;
  const peak = worstEsc(ep.peakEscalation || "", r.escalation);
  const peakSevere = peak === "red" || peak === "orange";
  const nextStatus = (scored.recovered && !peakSevere) ? "recovered" : (r.escalation === "red" || r.escalation === "orange" || peakSevere) ? "escalated" : "active";
  const ai = AI.nextInterval(r, pw, day);
  const adaptiveNextMs = (r.escalation === "red") ? 0 : (ai.deltaHours ? now + ai.deltaHours * 3600000 : (ai.dayOffset != null ? nextDueMsFor(ep, ai.dayOffset) : (scored.nextDay != null ? nextDueMsFor(ep, scored.nextDay) : 0)));
  const outcome = outcomeFrom(r);
  const ambulance = !!payload.ambulanceRequested;
  const emergency = !!payload.emergency;   // voice bot confirmed a danger sign (chest pain, fainting, etc.)

  const aId = "fc_assessments/" + episodeId + "_" + day;
  const writes = [
    wCreate(env, aId, {
      episodeId, hospitalId: ep.hospitalId, dayOffset: day, submittedMs: now, channel: "voice",
      answersJson: JSON.stringify(answers).slice(0, 4000), score: r.recoveryScore, escalation: r.escalation,
      confidence: r.confidence, trend: r.trend, readmissionRisk: r.readmissionRisk,
      redFlagsJson: JSON.stringify(r.redFlags || []).slice(0, 2000), reasonsJson: JSON.stringify(r.reasons || []).slice(0, 2000),
    }),
    wUpdate(env, "fc_episodes/" + episodeId, {
      lastDayDone: day, lastEscalation: r.escalation, peakEscalation: peak, lastScore: r.recoveryScore, lastConfidence: r.confidence,
      lastRisk: r.readmissionRisk, lastTrend: r.trend, needsReview: !!r.needsReview, lastAnswersJson: JSON.stringify(answers).slice(0, 4000),
      nextDueMs: adaptiveNextMs, status: nextStatus, recoveredMs: (scored.recovered && !peakSevere) ? now : (ep.recoveredMs || 0),
    }, ep.updateTime ? { updateTime: ep.updateTime } : { exists: true }),
    wUpdate(env, "fc_voice_calls/" + callId, {
      id: callId, episodeId, hospitalId: ep.hospitalId, dayOffset: day, status: "completed", endedMs: now,
      durationMs: Number(payload.durationMs) || 0, outcome,
      redFlag: !!(r.redFlags && r.redFlags.length), doctorReview: !!r.needsReview || r.escalation === "red" || r.escalation === "orange",
      ambulanceRequested: ambulance, emergency, patientStatement: String(payload.patientStatement || "").slice(0, 500),
      summary: (r.reasons || []).slice(0, 4).join("; ").slice(0, 500), createdMs: now,
    }),
  ];
  try { await fsCommit(env, writes); }
  catch (e) { if (e && e.code === "precondition") return { ok: true, status: "cancelled", reason: "already_responded", scored: false }; throw e; }

  await audit(env, { hospitalId: ep.hospitalId, episodeId, actor: "voice", action: "voice_assessment", meta: { day, escalation: r.escalation, score: r.recoveryScore, outcome } });

  const route = Schedule.escalationToNotify(r.escalation);
  let notified = false;
  if (route.notify && typeof meta.notify === "function") { try { await meta.notify(ep, r.escalation); notified = true; } catch (e) {} }
  let ambulanceSent = null;
  if (ambulance) { ambulanceSent = await notifyAmbulance(env, ep, settings, { problem: payload.patientStatement || "worsening reported on call", nowMs: now }); }
  // A voice-detected danger sign or an ambulance request is ALWAYS urgent — push the doctor even if the
  // questionnaire score alone would not have escalated (previously payload.emergency was ignored entirely).
  if ((emergency || ambulance) && !notified && typeof meta.notify === "function") { try { await meta.notify(ep, "red"); notified = true; } catch (e) {} }

  return { ok: true, status: "completed", scored: true, escalation: r.escalation, outcome, notify: route.notify || emergency || ambulance, notifyPlan: route, ambulance: ambulanceSent, emergency };
}

// ---- ambulance notification (spec §21) — NOTIFY only, NEVER dispatch -----------------------
// Sends the hospital's configured ambulance contact a message with the patient/case details, over the
// configured channel, after the PATIENT explicitly requested it on the call. Also audits + returns status.
export async function notifyAmbulance(env, ep, settings, info) {
  const amb = settings.ambulance || {};
  if (!amb.enabled || !amb.phone) { await audit(env, { hospitalId: ep.hospitalId, episodeId: ep.episodeId, actor: "voice", action: "ambulance_requested", meta: { delivered: "not_configured" } }); return { ok: false, reason: "not_configured" }; }
  let name = "", phone = "";
  try { name = await decPHI(env, ep._phi.nameEnc); } catch (e) {}
  try { phone = await decPHI(env, ep.isMinor ? ep._phi.guardianEnc : ep._phi.phoneEnc); } catch (e) {}
  const now = (info && info.nowMs) || Date.now();
  const body = "AMBULANCE REQUESTED — StewardMD FollowCare\n"
    + "Patient: " + (name || "(name withheld)") + (phone ? " (" + phone + ")" : "") + "\n"
    + "Hospital: " + (ep.hospitalId || "") + "\n"
    + "Discharged: " + isoDate(ep.dischargeMs) + "\n"
    + "Reported: " + String((info && info.problem) || "").slice(0, 160) + "\n"
    + "Case: " + ep.episodeId + "\n"
    + "Time: " + new Date(now).toISOString();
  const res = await sendToNumber(env, amb.phone, body, amb.method);
  await audit(env, { hospitalId: ep.hospitalId, episodeId: ep.episodeId, actor: "voice", action: "ambulance_requested", meta: { delivered: res.ok ? "sent" : (res.skipped ? "skipped" : "failed"), method: amb.method } });
  return { ok: !!res.ok, delivered: res.ok ? "sent" : (res.skipped ? "skipped" : "failed") };
}

// ---- Phase 3: dial queue + live in-call classify + status (consumed by the RunPod voice service) ----
// The scheduled calls the voice service should dial NOW, each with its dial context + the ordered question
// script (from Assessment.buildAssessment — the SAME script the portal renders). Re-checks eligibility at
// dial time and CANCELS any call whose patient has since responded / opted out (spec §4). Returns decrypted
// phones — this is a PHI egress path, gated by the service token on the route.
export async function voiceQueueForDialing(env, nowMs) {
  const now = nowMs || Date.now();
  const rows = await fsQuery(env, "fc_voice_calls", { where: { field: "status", value: "scheduled" }, limit: 200 });
  const calls = [], cancels = [];
  const nameCache = {};   // hospital display name the bot speaks in its greeting (cached per hospital)
  const hospName = async (hid) => {
    if (!(hid in nameCache)) { try { nameCache[hid] = (await getHospitalSettings(env, hid)).name || ""; } catch (e) { nameCache[hid] = ""; } }
    return nameCache[hid];
  };
  const cancel = (id, why) => cancels.push(wUpdate(env, "fc_voice_calls/" + id, { status: "cancelled", endedMs: now, summary: why }, { exists: true }));
  for (const d of rows) {
    const f = d.fields || {};
    if ((f.scheduledMs || 0) > now) continue;                                  // its window hasn't opened yet
    const ep = await getEpisode(env, f.episodeId);
    if (!ep) { cancel(f.id, "episode gone"); continue; }
    if (ep.voiceOptOut) { cancel(f.id, "patient opted out"); continue; }
    const day = currentDueDayLite(ep, now);
    if (day == null) { cancel(f.id, "patient already responded"); continue; }  // digital response wins — never call
    let phone = "";
    try { phone = await decPHI(env, ep.isMinor ? ep._phi.guardianEnc : ep._phi.phoneEnc); } catch (e) {}
    if (!phone) { cancel(f.id, "no phone"); continue; }
    let firstName = "";
    if (!ep.isMinor) { try { firstName = (await decPHI(env, ep._phi.nameEnc)).trim().split(/\s+/)[0] || ""; } catch (e) {} }
    const qn = Assessment.buildAssessment(ep.pathwayId, day, { pathways: Pathways });
    calls.push({
      callId: f.id, episodeId: ep.episodeId, hospitalId: ep.hospitalId, hospitalName: await hospName(ep.hospitalId),
      phone, lang: ep.lang || "en",
      firstName, isMinor: !!ep.isMinor, disease: ep.disease, dayOffset: day,
      greeting: (qn && qn.greeting) || "", questions: (qn && qn.questions) || [],
    });
  }
  if (cancels.length) { try { await fsCommit(env, cancels); } catch (e) {} }
  return { count: calls.length, calls };
}

// In-call escalation signal: run the SAME deterministic engine on the answers gathered so far (read-only, no
// writes) so the voice state machine can branch (ask about ambulance on a red flag) WITHOUT a second brain.
export async function classifyLive(env, episodeId, answers) {
  const ep = await getEpisode(env, episodeId);
  if (!ep) return { ok: false, error: "not_found" };
  const merged = Object.assign({}, ep.lastAnswers || {}, answers || {});
  const r = Engine.assess(ep.pathwayId, merged, { pathways: Pathways, previousScore: (ep.lastScore != null && ep.lastScore >= 0) ? ep.lastScore : undefined, previousAnswers: ep.lastAnswers || undefined, answers: merged });
  const redFlag = !!(r.redFlags && r.redFlags.length);
  return { ok: true, escalation: r.escalation, redFlag, needsReview: !!r.needsReview, askAmbulance: r.escalation === "red", reasons: (r.reasons || []).slice(0, 3) };
}

// Lightweight call-status transitions (ringing / in_progress / no_answer / technical_failure) from the service.
export async function markVoiceStatus(env, callId, patch) {
  if (!callId) return { ok: false, error: "missing_callId" };
  const clean = {}; ["status", "startedMs", "endedMs", "durationMs"].forEach(function (k) { if (patch && patch[k] != null) clean[k] = patch[k]; });
  if (!Object.keys(clean).length) return { ok: true };
  await fsCommit(env, [wUpdate(env, "fc_voice_calls/" + String(callId), clean, { exists: true })]);
  return { ok: true };
}

// ---- small local helpers ------------------------------------------------------------------
async function sendToNumber(env, toE164, body, method) {
  const payload = { toE164, body, vars: { text: body, name: "", link: "" } };
  if (method === "whatsapp" && waConfigured(env)) return sendWhatsApp(env, payload);
  return sendSms(env, payload);
}
function outcomeFrom(r) {
  if (!r) return "unknown";
  if (r.escalation === "red" || r.escalation === "orange" || r.trend === "declining" || r.trend === "critical") return "worsening";
  if (r.trend === "improving") return "improving";
  if (r.trend === "stable" || r.trend === "baseline" || r.escalation === "green" || r.escalation === "yellow") return "same";
  return "unknown";
}
function nextDueMsFor(ep, nextDay) { const s = (ep.schedule || []).find(function (x) { return x.dayOffset === nextDay; }); return s ? s.dueAtMs : 0; }
// Local copy of currentDueDay (the exported one lives in _followcare.js; avoid a circular re-import surface).
function currentDueDayLite(ep, nowMs) {
  const done = ep.lastDayDone == null ? -1 : ep.lastDayDone;
  const due = (ep.schedule || []).filter(function (s) { return s.dueAtMs <= nowMs && s.dayOffset > done; });
  return due.length ? due[0].dayOffset : null;
}
