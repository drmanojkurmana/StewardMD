/* functions/_wardsynq/patient-feedback.js - post-discharge and post-OPD surveys (gap wave 2026-09-16).
 *
 * WHO IS ASKED. When a stay (IPD) or an OPD visit finishes, patient-messaging.js creates one invitation per
 * encounter and, when the patient opted in to a channel and the hospital turned the feedback message on, sends the
 * link. The same invitation is shown in the patient portal. The questions are the hospital's own (Admin > Patient
 * feedback) and are copied onto the invitation, so a later edit never changes what a patient was asked.
 *
 * THE LINK. `portal.html#org=<hospital>&survey=<token>`: a random token in the fragment (never sent to a server log),
 * which opens that one survey and nothing else. Only its SHA-256 is an index (`_wardsynq_feedback_token`). It
 * expires after 30 days or once answered.
 *
 * WHAT IS ASKED. Always NPS (0 to 10, how likely to recommend) and a comment, plus the hospital's questions (a rating
 * from 1 to 5, yes or no, or text). A response at or below the hospital's low score (6 by default) or with any
 * rating of 1 or 2 goes to the service-recovery queue, where staff record what was done; resolving needs a note.
 *
 * NO PHI IN LOGS. Audit rows name invitation ids and whether a response was low, never an answer.
 */

import { VersionConflictError } from "./repository.js";

const INVITE = "_wardsynq_feedback_invite", TOKEN = "_wardsynq_feedback_token", RESPONSE = "_wardsynq_feedback_response";
const SCAN = 1000, INVITE_DAYS = 30;
const QUESTION_KINDS = Object.freeze(["rating5", "yesno", "text"]);
const RECOVERY = Object.freeze(["open", "in_progress", "resolved"]);

const str = (v) => (v == null ? "" : String(v).trim());
const clip = (v, n) => str(v).slice(0, n);
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 150);
const auditEvent = (action, actor, scope) => ({ ts: new Date().toISOString(), actor: str(actor), connectorId: "wardsynq-feedback", action, outcome: "ok", scope });
const refuse = (status, error, message) => ({ ok: false, status, error, message });
const noStore = (mig) => !mig || mig.mode === "off" || !mig.tenantId;

async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str(text)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PURE. The hospital's survey settings with defaults. */
function feedbackSettings(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const qs = (list) => (Array.isArray(list) ? list : []).slice(0, 15).map((q, i) => ({
    id: slug(q && q.id) || `q${i + 1}`, text: clip(q && q.text, 200), kind: QUESTION_KINDS.includes(q && q.kind) ? q.kind : "rating5",
  })).filter((q) => q.text);
  const low = Number(c.lowScoreAtOrBelow);
  return {
    enabled: c.enabled === true,
    lowScoreAtOrBelow: Number.isInteger(low) && low >= 0 && low <= 10 ? low : 6,
    surveys: { discharge: { questions: qs(c.surveys && c.surveys.discharge && c.surveys.discharge.questions) }, opd: { questions: qs(c.surveys && c.surveys.opd && c.surveys.opd.questions) } },
  };
}

/** A new invitation for a finished encounter: the records to append and the token (returned once, never stored plain). */
async function newInvite(encounter, cfg, nowMs) {
  const s = feedbackSettings(cfg);
  const kind = encounter.class === "IPD" ? "discharge" : "opd";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tokenHash = await sha(token);
  const at = new Date(nowMs).toISOString();
  const record = { resourceType: INVITE, id: `fbi-${slug(encounter.id)}`, version: 1, patientId: encounter.patientId, encounterId: encounter.id, kind,
    department: clip(encounter.location && encounter.location.ward, 80) || null, questions: s.surveys[kind].questions, status: "open",
    createdAt: at, expiresAt: new Date(nowMs + INVITE_DAYS * 86400000).toISOString(), writtenBy: { id: "service:patient-feedback", kind: "service", at } };
  const pointer = { resourceType: TOKEN, id: `fbt-${tokenHash.slice(0, 40)}`, version: 1, inviteId: record.id, createdAt: at, writtenBy: record.writtenBy };
  return { token, record, records: [record, pointer] };
}

const inviteOut = (i) => ({ inviteId: i.id, kind: i.kind, department: i.department || null, questions: i.questions || [], createdAt: i.createdAt, expiresAt: i.expiresAt });
function inviteState(i, nowMs) {
  if (!i) return "not_found";
  if (i.status === "answered") return "answered";
  if (Date.parse(i.expiresAt) <= nowMs) return "expired";
  return "open";
}

/** By link. ctx: { repository, tenantId, token } -> { ok, state, survey? }. A wrong token and a missing one answer alike. */
async function openSurvey(ctx) {
  const token = str(ctx.token);
  const none = refuse(404, "survey_not_found", "This survey link is not valid.");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return none;
  let invite;
  try {
    const p = await ctx.repository.latest(ctx.tenantId, TOKEN, `fbt-${(await sha(token)).slice(0, 40)}`);
    invite = p ? await ctx.repository.latest(ctx.tenantId, INVITE, p.inviteId) : null;
  } catch { return refuse(502, "record_read_failed", "The survey could not be opened. Try again later."); }
  if (!invite) return none;
  const state = inviteState(invite, Date.now());
  return { ok: true, state, ...(state === "open" ? { survey: inviteOut(invite) } : {}), invite };
}

/** PURE. Validated answers, or an error message. */
function answersFrom(invite, raw, lowAt) {
  const a = raw && typeof raw === "object" ? raw : {};
  const nps = Number(a.nps);
  if (!Number.isInteger(nps) || nps < 0 || nps > 10) return { error: "Choose a score from 0 to 10." };
  const answers = {};
  let lowRating = false;
  for (const q of invite.questions || []) {
    const v = a.answers && a.answers[q.id];
    if (v === undefined || v === null || v === "") continue;
    if (q.kind === "rating5") { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 5) return { error: "A rating is from 1 to 5." }; answers[q.id] = n; if (n <= 2) lowRating = true; }
    else if (q.kind === "yesno") { if (v !== true && v !== false) return { error: "Answer yes or no." }; answers[q.id] = v; }
    else answers[q.id] = clip(v, 1000);
  }
  return { nps, answers, comment: clip(a.comment, 2000) || null, low: nps <= lowAt || lowRating };
}

/**
 * Submit. ctx: { repository, tenantId, feedbackCfg, token? | (inviteId and sessionPatientId), answers: { nps, comment, answers } }
 */
async function submitSurvey(ctx) {
  let invite;
  if (str(ctx.token)) {
    const o = await openSurvey(ctx);
    if (!o.ok) return o;
    invite = o.invite;
  } else {
    try { invite = await ctx.repository.latest(ctx.tenantId, INVITE, str(ctx.inviteId)); } catch { return refuse(502, "record_read_failed", "The survey could not be opened."); }
    if (!invite || invite.patientId !== str(ctx.sessionPatientId)) return refuse(404, "survey_not_found", "This survey is not available.");
  }
  const state = inviteState(invite, Date.now());
  if (state !== "open") return refuse(409, `survey_${state}`, state === "answered" ? "This survey has already been answered. Thank you." : "This survey has closed.");
  const s = feedbackSettings(ctx.feedbackCfg);
  const got = answersFrom(invite, ctx.answers, s.lowScoreAtOrBelow);
  if (got.error) return refuse(422, "bad_answers", got.error);
  const at = new Date().toISOString(), by = `patient:${invite.patientId}`;
  const response = { resourceType: RESPONSE, id: `fbr-${invite.id.slice(4)}`, version: 1, inviteId: invite.id, patientId: invite.patientId, encounterId: invite.encounterId, kind: invite.kind,
    department: invite.department, questions: invite.questions, nps: got.nps, answers: got.answers, comment: got.comment, low: got.low,
    recovery: got.low ? { status: "open", notes: [] } : null, submittedAt: at, writtenBy: { id: by, kind: "human", at } };
  const closed = { ...invite, version: invite.version + 1, status: "answered", answeredAt: at, writtenBy: { id: by, kind: "human", at } };
  try { await ctx.repository.append(ctx.tenantId, [response, closed], { audit: auditEvent("patient.feedback.submitted", by, { inviteId: invite.id, low: got.low }) }); }
  catch (e) { return e instanceof VersionConflictError ? refuse(409, "survey_answered", "This survey has already been answered. Thank you.") : refuse(502, "record_write_failed", "Your answers could not be saved. Please try again."); }
  return { ok: true, submitted: true };
}

/** For a portal session: this patient's open invitations. */
async function pendingSurveys(ctx) {
  try {
    const rows = (await ctx.repository.latestByType(ctx.tenantId, INVITE, SCAN, { newest: true })) || [];
    const now = Date.now();
    return { ok: true, surveys: rows.filter((i) => i && i.patientId === str(ctx.patientId) && inviteState(i, now) === "open").map(inviteOut) };
  } catch { return refuse(502, "record_read_failed", "Your surveys could not be loaded."); }
}

/** PURE. NPS: percent promoters (9-10) minus percent detractors (0-6), rounded. */
function npsOf(scores) {
  if (!scores.length) return null;
  const p = scores.filter((x) => x >= 9).length, d = scores.filter((x) => x <= 6).length;
  return Math.round(((p - d) / scores.length) * 100);
}

/** PURE. The dashboard from responses. */
function dashboardOf(responses, from, to) {
  const rows = responses.filter((r) => r && (!from || r.submittedAt >= from) && (!to || r.submittedAt < to));
  const groups = new Map();
  for (const r of rows) {
    const k = (r.department || "") + "|" + r.kind;
    const g = groups.get(k) || { department: r.department || null, kind: r.kind, scores: [], low: 0 };
    g.scores.push(r.nps); if (r.low) g.low++;
    groups.set(k, g);
  }
  const byDepartment = [...groups.values()].map((g) => ({ department: g.department, kind: g.kind, responses: g.scores.length, nps: npsOf(g.scores),
    promoters: g.scores.filter((x) => x >= 9).length, passives: g.scores.filter((x) => x === 7 || x === 8).length, detractors: g.scores.filter((x) => x <= 6).length,
    average: Math.round((g.scores.reduce((a, b) => a + b, 0) / g.scores.length) * 10) / 10, low: g.low }))
    .sort((a, b) => (a.nps ?? 101) - (b.nps ?? 101));
  const item = (r) => ({ id: r.id, patientId: r.patientId, kind: r.kind, department: r.department || null, nps: r.nps, comment: r.comment || null, answers: r.answers || {}, questions: r.questions || [], submittedAt: r.submittedAt, low: !!r.low, recovery: r.recovery || null, version: r.version });
  return {
    responses: rows.length, nps: npsOf(rows.map((r) => r.nps)), byDepartment,
    recoveryQueue: rows.filter((r) => r.recovery && r.recovery.status !== "resolved").sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt))).map(item),
    recentComments: rows.filter((r) => r.comment).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt))).slice(0, 50).map(item),
  };
}

/** Staff. ctx: { migration, recordDeps, wsqCfg, from?, to? } */
async function feedbackDashboard(request, env, ctx) {
  if (noStore(ctx.migration)) return refuse(404, "not_a_wardsynq_hospital", "Feedback is kept for a WardSynQ hospital.");
  let rows;
  try { rows = (await ctx.recordDeps.repository.latestByType(ctx.migration.tenantId, RESPONSE, SCAN, { newest: true })) || []; }
  catch { return refuse(502, "record_read_failed", "Feedback could not be read."); }
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(ctx.from)) ? str(ctx.from) : "", to = /^\d{4}-\d{2}-\d{2}$/.test(str(ctx.to)) ? str(ctx.to) : "";
  return { ok: true, settings: feedbackSettings(ctx.wsqCfg && ctx.wsqCfg.feedback), partial: rows.length >= SCAN, ...dashboardOf(rows, from, to) };
}

/** Staff record service recovery. ctx: { migration, recordDeps, actorId, id, status, note } */
async function updateRecovery(request, env, ctx) {
  if (noStore(ctx.migration)) return refuse(404, "not_a_wardsynq_hospital", "Feedback is kept for a WardSynQ hospital.");
  const status = str(ctx.status), note = clip(ctx.note, 1000);
  if (!RECOVERY.includes(status) || status === "open") return refuse(422, "bad_status", "Mark it in progress or resolved.");
  if (!note) return refuse(422, "note_required", "Say what was done (for example: called the patient, apologised, fixed the billing error).");
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, at = new Date().toISOString();
  let cur;
  try { cur = await repo.latest(tenantId, RESPONSE, str(ctx.id)); } catch { return refuse(502, "record_read_failed", "The response could not be read."); }
  if (!cur || !cur.recovery) return refuse(404, "not_in_queue", "No such response in the service-recovery queue.");
  if (cur.recovery.status === "resolved") return refuse(409, "already_resolved", "This has already been resolved.");
  const next = { ...cur, version: cur.version + 1, recovery: { status, notes: [...(cur.recovery.notes || []), { at, by: str(ctx.actorId), status, note }], ...(status === "resolved" ? { resolvedAt: at, resolvedBy: str(ctx.actorId) } : {}) }, writtenBy: { id: str(ctx.actorId), kind: "human", at } };
  try { await repo.append(tenantId, [next], { audit: auditEvent(`patient.feedback.recovery_${status}`, ctx.actorId, { id: cur.id }) }); }
  catch (e) { return e instanceof VersionConflictError ? refuse(409, "version_conflict", "This changed at the same moment; nothing was saved.") : refuse(502, "record_write_failed", "The update could not be saved."); }
  return { ok: true, recovery: next.recovery };
}

export { INVITE as INVITE_TYPE, TOKEN as TOKEN_TYPE, RESPONSE as RESPONSE_TYPE, feedbackSettings, newInvite, openSurvey, answersFrom, submitSurvey, pendingSurveys, npsOf, dashboardOf, feedbackDashboard, updateRecovery };
