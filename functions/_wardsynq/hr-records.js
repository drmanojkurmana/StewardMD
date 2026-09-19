/* functions/_wardsynq/hr-records.js - professional credentials and training records (gap wave 2026-09-16, HR).
 *
 * CREDENTIALS. Per staff member: professional registrations (state medical or nursing council number and its
 * validity) and certificates (BLS, ACLS and others) with expiry. Stored as `_wardsynq_hr_credential`, append-only
 * like attendance (hr-attendance.js explains why these are not RecordService types). Removing one archives it.
 *
 * EXPIRY ALERTS. 60, 30 and 7 days before a credential expires an alert is recorded for the member and for HR
 * (`_wardsynq_hr_alert`, one per credential, threshold and expiry date, so a renewed credential alerts afresh).
 * They are shown on the member's own records (Staff rota) and on Admin > Credentials until acknowledged. This is
 * an in-app alert; nothing here sends an SMS or a push to staff.
 *
 * THE SIGNING RULE, OFF BY DEFAULT. wardsynq.hr.expiredRegistrationBlocksSigning: when true, a member whose
 * recorded registrations have all expired signs nothing (actor.js clears the signing credential, so every
 * signature path refuses with NO_CREDENTIAL). A member with no registration recorded is not blocked by this rule:
 * the rule is about expiry. If the records cannot be read while the rule is on, signing is refused, not waved through.
 *
 * TRAINING. Courses (the six NABH HRM mandatory ones can be added in one step: fire safety, infection control,
 * BLS, hand hygiene, POSH, DPDP; the hospital sets each validity), sessions with attendance, completions with
 * validity, and compliance by department: of the mandatory courses that apply to each active member's role, the
 * share whose latest completion is still valid.
 */

import { VersionConflictError } from "./repository.js";

const CRED = "_wardsynq_hr_credential", ALERT = "_wardsynq_hr_alert";
const COURSE = "_wardsynq_hr_course", SESSION = "_wardsynq_hr_session", TRAINING = "_wardsynq_hr_training";
const SCAN = 1000;
const ALERT_DAYS = Object.freeze([60, 30, 7]);
const CRED_KINDS = Object.freeze(["registration", "certificate"]);
const STANDARD_COURSES = Object.freeze([
  ["fire-safety", "Fire safety"], ["infection-control", "Infection control"], ["bls", "Basic life support (BLS)"],
  ["hand-hygiene", "Hand hygiene"], ["posh", "Prevention of sexual harassment (POSH)"], ["dpdp", "Data protection (DPDP Act)"],
]);

const str = (v) => (v == null ? "" : String(v).trim());
const clip = (v, n) => str(v).slice(0, n);
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) && Number.isFinite(Date.parse(str(v) + "T00:00:00Z"));
const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const todayAt = (nowMs, cfg) => new Date((Number(nowMs) || Date.now()) + (cfg && cfg.utcOffsetMinutes != null ? Number(cfg.utcOffsetMinutes) || 0 : 330) * 60000).toISOString().slice(0, 10);
const auditEvent = (action, actor, scope) => ({ ts: new Date().toISOString(), actor: str(actor), connectorId: "wardsynq-hr", action, outcome: "ok", scope });
const refuse = (status, error, message) => ({ ok: false, status, error, message });
const readFailed = refuse(502, "hr_read_failed", "HR records could not be read, so nothing was changed.");
const writeFailed = (e) => e instanceof VersionConflictError
  ? refuse(409, "version_conflict", "This record changed at the same moment. Reload and try again; nothing was saved.")
  : refuse(502, "hr_write_failed", "The change could not be saved, so it was not made.");
const noStore = (mig) => !mig || mig.mode === "off" || !mig.tenantId;
const notHospital = refuse(404, "not_a_wardsynq_hospital", "HR records are kept for a WardSynQ hospital.");
const writer = (actorId, at) => ({ id: str(actorId), kind: "human", at });

async function h16(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str(text)));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function all(repo, tenantId, type) {
  const rows = (await repo.latestByType(tenantId, type, SCAN)) || [];
  return { rows: rows.filter(Boolean), partial: rows.length >= SCAN };
}

/* ---- credentials ------------------------------------------------------------------------------------------ */

/** PURE. valid | expiring (within 60 days) | expired | no_expiry, and days left. */
function credentialState(c, today) {
  if (!c.validTo) return { state: "no_expiry", daysLeft: null };
  const left = daysBetween(today, c.validTo);
  return { state: left < 0 ? "expired" : left <= ALERT_DAYS[0] ? "expiring" : "valid", daysLeft: left };
}
const credentialOut = (c, today) => ({
  id: c.id, identity: c.identity, kind: c.kind, category: c.category, name: c.name, number: c.number, issuer: c.issuer || null,
  validFrom: c.validFrom || null, validTo: c.validTo || null, removed: c.removed === true, version: c.version, updatedAt: c.writtenBy && c.writtenBy.at, ...credentialState(c, today),
});

/**
 * Add or change a credential. ctx: { migration, recordDeps, actorId, members, wsqCfg, id?, identity, kind, category,
 * name, number, issuer?, validFrom?, validTo?, remove?, reason? }
 */
async function saveCredential(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, at = new Date().toISOString(), today = todayAt(ctx.nowMs, ctx.wsqCfg);
  let cur = null;
  if (str(ctx.id)) {
    try { cur = await repo.latest(tenantId, CRED, str(ctx.id)); } catch { return readFailed; }
    if (!cur) return refuse(404, "credential_not_found", "No such credential at this hospital.");
  }
  if (ctx.remove === true) {
    if (!cur) return refuse(422, "credential_required", "Choose the credential to remove.");
    if (!clip(ctx.reason, 300)) return refuse(422, "reason_required", "Say why this credential is being removed.");
    if (cur.removed) return { ok: true, unchanged: true, credential: credentialOut(cur, today) };
    const next = { ...cur, version: cur.version + 1, removed: true, removedReason: clip(ctx.reason, 300), writtenBy: writer(ctx.actorId, at) };
    try { await repo.append(tenantId, [next], { audit: auditEvent("hr.credential.removed", ctx.actorId, { id: next.id }) }); } catch (e) { return writeFailed(e); }
    return { ok: true, credential: credentialOut(next, today) };
  }
  const identity = cur ? cur.identity : str(ctx.identity);
  if (!cur && !(ctx.members || []).some((m) => m && m.identity === identity)) return refuse(422, "unknown_staff", "That is not a staff member of this hospital.");
  const kind = str(ctx.kind);
  if (!CRED_KINDS.includes(kind)) return refuse(422, "bad_kind", "A credential is a registration or a certificate.");
  const category = clip(ctx.category, 80), name = clip(ctx.name, 120), number = clip(ctx.number, 80);
  if (!category || !name) return refuse(422, "name_required", "Say what the credential is (for example State nursing council, or BLS).");
  if (kind === "registration" && !number) return refuse(422, "number_required", "A registration needs its number.");
  for (const [k, label] of [["validFrom", "Valid from"], ["validTo", "Valid until"]]) if (str(ctx[k]) && !isDate(ctx[k])) return refuse(422, "bad_date", `${label} is not a date.`);
  if (kind === "certificate" && !str(ctx.validTo)) return refuse(422, "expiry_required", "A certificate needs its expiry date.");
  if (str(ctx.validFrom) && str(ctx.validTo) && str(ctx.validTo) < str(ctx.validFrom)) return refuse(422, "bad_dates", "Valid until is before valid from.");
  const id = cur ? cur.id : `cred-${await h16(identity)}-${slug(category)}-${slug(number || name) || "x"}`;
  if (!cur) {
    let clash;
    try { clash = await repo.latest(tenantId, CRED, id); } catch { return readFailed; }
    if (clash && !clash.removed) return refuse(409, "credential_exists", "This member already has that credential recorded. Change it instead.");
    cur = clash || null;
  }
  const next = { resourceType: CRED, id, version: cur ? cur.version + 1 : 1, identity, kind, category, name, number: number || null, issuer: clip(ctx.issuer, 120) || null,
    validFrom: str(ctx.validFrom) || null, validTo: str(ctx.validTo) || null, removed: false, createdAt: (cur && cur.createdAt) || at, createdBy: (cur && cur.createdBy) || str(ctx.actorId), writtenBy: writer(ctx.actorId, at) };
  try { await repo.append(tenantId, [next], { audit: auditEvent(cur ? "hr.credential.updated" : "hr.credential.added", ctx.actorId, { id, kind, validTo: next.validTo }) }); } catch (e) { return writeFailed(e); }
  return { ok: true, credential: credentialOut(next, today) };
}

/** PURE. The alerts owed now: for each live credential with an expiry, each threshold reached and not yet alerted. */
function dueAlerts(credentials, existingIds, today) {
  const out = [];
  for (const c of credentials) {
    if (!c || c.removed || !c.validTo) continue;
    const left = daysBetween(today, c.validTo);
    if (left < 0) continue;
    for (const d of [...ALERT_DAYS].sort((a, b) => a - b)) {
      if (left > d) continue;
      const id = `hra-${c.id}-${c.validTo}-${d}`;
      if (!existingIds.has(id)) out.push({ id, credentialId: c.id, identity: c.identity, threshold: d, validTo: c.validTo, daysLeft: left, name: c.name });
      break; // only the nearest threshold reached: a credential found at 5 days left gets the 7-day alert, not three at once
    }
  }
  return out;
}

/** Records the expiry alerts now due. Called by the tick and by Admin > Credentials. ctx: { repository, tenantId, actorId, wsqCfg, nowMs? } */
async function runCredentialAlerts(ctx) {
  const today = todayAt(ctx.nowMs, ctx.wsqCfg), at = new Date().toISOString();
  let creds, alerts;
  try { [creds, alerts] = await Promise.all([all(ctx.repository, ctx.tenantId, CRED), all(ctx.repository, ctx.tenantId, ALERT)]); }
  catch { return readFailed; }
  const due = dueAlerts(creds.rows, new Set(alerts.rows.map((a) => a.id)), today);
  if (!due.length) return { ok: true, created: 0, partial: creds.partial || alerts.partial };
  const recs = due.map((a) => ({ resourceType: ALERT, version: 1, ...a, for: [a.identity, "hr"], raisedOn: today, acknowledged: {}, createdAt: at, writtenBy: { id: str(ctx.actorId) || "service:hr-alerts", kind: ctx.actorId ? "human" : "service", at } }));
  try { await ctx.repository.append(ctx.tenantId, recs, { audit: auditEvent("hr.credential.alerts_raised", ctx.actorId || "service:hr-alerts", { count: recs.length }) }); }
  catch (e) { return writeFailed(e); }
  return { ok: true, created: recs.length, partial: creds.partial || alerts.partial };
}

const alertOut = (a) => ({ id: a.id, credentialId: a.credentialId, identity: a.identity, name: a.name, threshold: a.threshold, validTo: a.validTo, raisedOn: a.raisedOn, acknowledged: a.acknowledged || {} });

/** Acknowledge an alert: the member for themselves, HR (manager) for HR. ctx: { migration, recordDeps, id, identity, manager } */
async function acknowledgeAlert(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, at = new Date().toISOString();
  let cur;
  try { cur = await repo.latest(tenantId, ALERT, str(ctx.id)); } catch { return readFailed; }
  const self = cur && str(ctx.identity) && cur.identity === str(ctx.identity);
  if (!cur || (!self && !ctx.manager)) return refuse(404, "alert_not_found", "No such alert for you.");
  const who = ctx.manager && !self ? "hr" : "member";
  if (cur.acknowledged && cur.acknowledged[who]) return { ok: true, unchanged: true, alert: alertOut(cur) };
  const next = { ...cur, version: cur.version + 1, acknowledged: { ...(cur.acknowledged || {}), [who]: { at, by: str(ctx.actorId) } }, writtenBy: writer(ctx.actorId, at) };
  try { await repo.append(tenantId, [next], { audit: auditEvent("hr.credential.alert_acknowledged", ctx.actorId, { id: next.id, as: who }) }); } catch (e) { return writeFailed(e); }
  return { ok: true, alert: alertOut(next) };
}

/** Hospital view. ctx: { migration, recordDeps, wsqCfg, identity? } */
async function listCredentials(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, today = todayAt(ctx.nowMs, ctx.wsqCfg);
  let creds, alerts;
  try { [creds, alerts] = await Promise.all([all(repo, tenantId, CRED), all(repo, tenantId, ALERT)]); } catch { return refuse(502, "hr_read_failed", "Credentials could not be read."); }
  const identity = str(ctx.identity);
  const mine = (x) => !identity || x.identity === identity;
  return {
    ok: true, today, partial: creds.partial || alerts.partial, alertDays: ALERT_DAYS,
    signingRule: !!(ctx.wsqCfg && ctx.wsqCfg.hr && ctx.wsqCfg.hr.expiredRegistrationBlocksSigning === true),
    credentials: creds.rows.filter((c) => mine(c) && !c.removed).map((c) => credentialOut(c, today)).sort((a, b) => String(a.validTo || "9999").localeCompare(String(b.validTo || "9999"))),
    alerts: alerts.rows.filter((a) => mine(a) && !(identity ? a.acknowledged && a.acknowledged.member : a.acknowledged && a.acknowledged.hr)).map(alertOut).sort((a, b) => String(a.validTo).localeCompare(String(b.validTo))),
  };
}

/** PURE. Whether this person's registrations block signing: all recorded registrations expired. */
function registrationBlock(credentials, identities, today) {
  const ids = new Set((identities || []).map(str).filter(Boolean));
  const regs = (credentials || []).filter((c) => c && !c.removed && c.kind === "registration" && ids.has(c.identity));
  if (!regs.length) return { blocked: false, reason: "no_registration_recorded" };
  const live = regs.some((c) => !c.validTo || c.validTo >= today);
  return live ? { blocked: false, reason: "registration_valid" } : { blocked: true, reason: "registration_expired" };
}

/** For actor.js. -> { blocked, reason }; a read failure is blocked (the rule is on, and it cannot be checked). */
async function registrationStatus(repository, tenantId, identities, wsqCfg, nowMs) {
  try {
    const { rows } = await all(repository, String(tenantId), CRED);
    return registrationBlock(rows, identities, todayAt(nowMs, wsqCfg));
  } catch { return { blocked: true, reason: "registration_unreadable" }; }
}

/* ---- training ---------------------------------------------------------------------------------------------- */

const courseOut = (c) => ({ id: c.id, name: c.name, mandatory: c.mandatory === true, validityMonths: c.validityMonths || null, roles: c.roles || [], active: c.active !== false, version: c.version });

/** ctx: { migration, recordDeps, actorId, standard?: true | id?, name, mandatory, validityMonths, roles, active } */
async function saveCourse(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, at = new Date().toISOString();
  if (ctx.standard === true) {
    let existing;
    try { existing = new Set((await all(repo, tenantId, COURSE)).rows.map((c) => c.id)); } catch { return readFailed; }
    const add = STANDARD_COURSES.filter(([k]) => !existing.has(`course-${k}`)).map(([k, name]) => ({ resourceType: COURSE, id: `course-${k}`, version: 1, name, mandatory: true, validityMonths: null, roles: [], active: true, standard: k, createdAt: at, writtenBy: writer(ctx.actorId, at) }));
    if (!add.length) return { ok: true, added: 0 };
    try { await repo.append(tenantId, add, { audit: auditEvent("hr.course.standard_added", ctx.actorId, { courses: add.map((c) => c.id) }) }); } catch (e) { return writeFailed(e); }
    return { ok: true, added: add.length, courses: add.map(courseOut) };
  }
  const name = clip(ctx.name, 120);
  if (!name) return refuse(422, "name_required", "Name the course.");
  const months = ctx.validityMonths === "" || ctx.validityMonths == null ? null : Number(ctx.validityMonths);
  if (months !== null && !(Number.isInteger(months) && months > 0 && months <= 120)) return refuse(422, "bad_validity", "Validity is a whole number of months between 1 and 120, or blank for no expiry.");
  const id = str(ctx.id) || `course-${slug(name)}`;
  let cur;
  try { cur = await repo.latest(tenantId, COURSE, id); } catch { return readFailed; }
  if (!str(ctx.id) && cur) return refuse(409, "course_exists", "A course with that name exists. Change it instead.");
  const next = { ...(cur || { resourceType: COURSE, id, createdAt: at }), version: cur ? cur.version + 1 : 1, name, mandatory: ctx.mandatory === true, validityMonths: months,
    roles: (Array.isArray(ctx.roles) ? ctx.roles : []).map((r) => clip(r, 40)).filter(Boolean).slice(0, 30), active: ctx.active !== false, writtenBy: writer(ctx.actorId, at) };
  try { await repo.append(tenantId, [next], { audit: auditEvent(cur ? "hr.course.updated" : "hr.course.added", ctx.actorId, { id }) }); } catch (e) { return writeFailed(e); }
  return { ok: true, course: courseOut(next) };
}

const sessionOut = (s) => ({ id: s.id, courseId: s.courseId, date: s.date, trainer: s.trainer || null, venue: s.venue || null, status: s.status, attendees: s.attendees || [], version: s.version });

/** Plan a session or cancel one. ctx: { migration, recordDeps, actorId, members, id?, courseId, date, trainer, venue, invitees[], cancel?, reason? } */
async function saveSession(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, at = new Date().toISOString();
  let cur = null;
  if (str(ctx.id)) {
    try { cur = await repo.latest(tenantId, SESSION, str(ctx.id)); } catch { return readFailed; }
    if (!cur) return refuse(404, "session_not_found", "No such training session.");
    if (ctx.cancel === true) {
      if (!clip(ctx.reason, 300)) return refuse(422, "reason_required", "Say why the session is cancelled.");
      if (cur.status !== "planned") return refuse(409, "session_not_planned", "Only a planned session can be cancelled.");
      const next = { ...cur, version: cur.version + 1, status: "cancelled", cancelReason: clip(ctx.reason, 300), writtenBy: writer(ctx.actorId, at) };
      try { await repo.append(tenantId, [next], { audit: auditEvent("hr.session.cancelled", ctx.actorId, { id: next.id }) }); } catch (e) { return writeFailed(e); }
      return { ok: true, session: sessionOut(next) };
    }
  }
  let course;
  try { course = await repo.latest(tenantId, COURSE, str(ctx.courseId || (cur && cur.courseId))); } catch { return readFailed; }
  if (!course || course.active === false) return refuse(422, "course_required", "Choose an active course.");
  if (!isDate(ctx.date)) return refuse(422, "date_required", "Choose the session date.");
  const known = new Set((ctx.members || []).filter((m) => m && m.active !== false).map((m) => m.identity));
  const invitees = [...new Set((Array.isArray(ctx.invitees) ? ctx.invitees : []).map(str).filter(Boolean))];
  const stray = invitees.filter((i) => !known.has(i));
  if (stray.length) return refuse(422, "unknown_staff", `Not active staff of this hospital: ${stray.slice(0, 5).join(", ")}.`);
  const prev = new Map(((cur && cur.attendees) || []).map((a) => [a.identity, a]));
  const id = cur ? cur.id : `sess-${course.id.replace(/^course-/, "")}-${str(ctx.date)}-${(await h16(at + Math.random())).slice(0, 6)}`;
  const next = { resourceType: SESSION, id, version: cur ? cur.version + 1 : 1, courseId: course.id, date: str(ctx.date), trainer: clip(ctx.trainer, 120) || null, venue: clip(ctx.venue, 120) || null,
    status: cur ? cur.status : "planned", attendees: invitees.map((i) => prev.get(i) || { identity: i, attended: null, completed: false }), createdAt: (cur && cur.createdAt) || at, writtenBy: writer(ctx.actorId, at) };
  if (cur && cur.status !== "planned") return refuse(409, "session_not_planned", "A held or cancelled session cannot be changed.");
  try { await repo.append(tenantId, [next], { audit: auditEvent(cur ? "hr.session.updated" : "hr.session.planned", ctx.actorId, { id, invitees: invitees.length }) }); } catch (e) { return writeFailed(e); }
  return { ok: true, session: sessionOut(next) };
}

function addMonths(date, months) {
  const d = new Date(Date.parse(date + "T00:00:00Z"));
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
const trainingOut = (t) => ({ id: t.id, identity: t.identity, courseId: t.courseId, completedOn: t.completedOn, validUntil: t.validUntil || null, sessionId: t.sessionId || null, note: t.note || null, removed: t.removed === true });

/**
 * Mark a session held: who attended and who completed. Completions are written in the SAME append as the session,
 * so a session cannot say "completed" without the training record, nor the reverse.
 * ctx: { migration, recordDeps, actorId, id, attendance: [{identity, attended, completed}] }
 */
async function recordSessionAttendance(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, at = new Date().toISOString();
  let cur, course;
  try { cur = await repo.latest(tenantId, SESSION, str(ctx.id)); course = cur ? await repo.latest(tenantId, COURSE, cur.courseId) : null; } catch { return readFailed; }
  if (!cur || !course) return refuse(404, "session_not_found", "No such training session.");
  if (cur.status !== "planned") return refuse(409, "session_not_planned", "Attendance for this session is already recorded.");
  if (Date.parse(cur.date + "T00:00:00Z") > Date.now() + 86400000) return refuse(422, "session_in_future", "Attendance is recorded on or after the session date.");
  const given = new Map((Array.isArray(ctx.attendance) ? ctx.attendance : []).map((a) => [str(a && a.identity), a]));
  const attendees = (cur.attendees || []).map((a) => {
    const g = given.get(a.identity) || {};
    const attended = g.attended === true;
    return { identity: a.identity, attended, completed: attended && g.completed === true };
  });
  const validUntil = course.validityMonths ? addMonths(cur.date, course.validityMonths) : null;
  const completions = [];
  for (const a of attendees.filter((x) => x.completed)) {
    completions.push({ resourceType: TRAINING, id: `trn-${await h16(a.identity)}-${course.id.replace(/^course-/, "")}-${cur.date}`, version: 1, identity: a.identity, courseId: course.id, completedOn: cur.date, validUntil, sessionId: cur.id, note: null, createdAt: at, writtenBy: writer(ctx.actorId, at) });
  }
  try {
    const existing = await Promise.all(completions.map((t) => repo.latest(tenantId, TRAINING, t.id)));
    existing.forEach((e, i) => { if (e) completions[i].version = e.version + 1; });
  } catch { return readFailed; }
  const next = { ...cur, version: cur.version + 1, status: "held", attendees, writtenBy: writer(ctx.actorId, at) };
  try { await repo.append(tenantId, [next, ...completions], { audit: auditEvent("hr.session.held", ctx.actorId, { id: cur.id, attended: attendees.filter((a) => a.attended).length, completed: completions.length }) }); } catch (e) { return writeFailed(e); }
  return { ok: true, session: sessionOut(next), completions: completions.map(trainingOut) };
}

/** A completion recorded without a session (training done elsewhere, with evidence). ctx: { ..., identity, courseId, completedOn, note } */
async function recordTraining(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, at = new Date().toISOString();
  const identity = str(ctx.identity);
  if (!(ctx.members || []).some((m) => m && m.identity === identity)) return refuse(422, "unknown_staff", "That is not a staff member of this hospital.");
  if (!isDate(ctx.completedOn) || Date.parse(ctx.completedOn + "T00:00:00Z") > Date.now() + 86400000) return refuse(422, "date_required", "Give the completion date (not in the future).");
  const note = clip(ctx.note, 300);
  if (!note) return refuse(422, "evidence_required", "Say where this training was done and what evidence was seen.");
  let course, cur;
  try { course = await repo.latest(tenantId, COURSE, str(ctx.courseId)); } catch { return readFailed; }
  if (!course) return refuse(422, "course_required", "Choose the course.");
  const id = `trn-${await h16(identity)}-${course.id.replace(/^course-/, "")}-${str(ctx.completedOn)}`;
  try { cur = await repo.latest(tenantId, TRAINING, id); } catch { return readFailed; }
  if (cur && !cur.removed) return refuse(409, "already_recorded", "This completion is already recorded.");
  const rec = { resourceType: TRAINING, id, version: cur ? cur.version + 1 : 1, identity, courseId: course.id, completedOn: str(ctx.completedOn),
    validUntil: course.validityMonths ? addMonths(str(ctx.completedOn), course.validityMonths) : null, sessionId: null, note, removed: false, createdAt: at, writtenBy: writer(ctx.actorId, at) };
  try { await repo.append(tenantId, [rec], { audit: auditEvent("hr.training.recorded", ctx.actorId, { id, courseId: course.id }) }); } catch (e) { return writeFailed(e); }
  return { ok: true, training: trainingOut(rec) };
}

/**
 * PURE. Compliance by department. members: active staff with role and scope.departments; departments: [{id, name}].
 * A member counts toward the first department in their scope, or "none".
 */
function complianceOf(members, departments, courses, completions, today) {
  const mandatory = courses.filter((c) => c.mandatory === true && c.active !== false);
  const latest = new Map();
  for (const t of completions) {
    if (!t || t.removed) continue;
    const k = t.identity + "|" + t.courseId, p = latest.get(k);
    if (!p || String(t.completedOn) > String(p.completedOn)) latest.set(k, t);
  }
  const deptName = new Map((departments || []).map((d) => [d.id, d.name || d.id]));
  const byDept = new Map(), people = [];
  for (const m of members) {
    if (!m || m.active === false) continue;
    const dep = (m.scope && m.scope.departments && m.scope.departments[0]) || "none";
    const need = mandatory.filter((c) => !(c.roles || []).length || c.roles.includes(m.role));
    const rows = need.map((c) => {
      const t = latest.get(m.identity + "|" + c.id);
      const state = !t ? "missing" : t.validUntil && t.validUntil < today ? "expired" : "valid";
      return { courseId: c.id, state, completedOn: t ? t.completedOn : null, validUntil: t ? t.validUntil : null };
    });
    const ok = rows.filter((r) => r.state === "valid").length;
    people.push({ identity: m.identity, role: m.role, department: dep, required: rows.length, compliant: ok, courses: rows });
    const d = byDept.get(dep) || { department: dep, name: dep === "none" ? null : deptName.get(dep) || dep, staff: 0, required: 0, compliant: 0, byCourse: {} };
    d.staff++; d.required += rows.length; d.compliant += ok;
    for (const r of rows) { const bc = d.byCourse[r.courseId] || { required: 0, compliant: 0 }; bc.required++; if (r.state === "valid") bc.compliant++; d.byCourse[r.courseId] = bc; }
    byDept.set(dep, d);
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const departmentsOut = [...byDept.values()].map((d) => ({ ...d, percent: pct(d.compliant, d.required) })).sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));
  const required = departmentsOut.reduce((s, d) => s + d.required, 0), compliant = departmentsOut.reduce((s, d) => s + d.compliant, 0);
  return { departments: departmentsOut, people, hospital: { required, compliant, percent: pct(compliant, required) }, mandatoryCourses: mandatory.map(courseOut) };
}

/** Courses, sessions, completions and compliance. identity limits it to one person's own. ctx: { migration, recordDeps, wsqCfg, members, departments, identity? } */
async function trainingOverview(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, today = todayAt(ctx.nowMs, ctx.wsqCfg);
  let courses, sessions, completions;
  try { [courses, sessions, completions] = await Promise.all([all(repo, tenantId, COURSE), all(repo, tenantId, SESSION), all(repo, tenantId, TRAINING)]); }
  catch { return refuse(502, "hr_read_failed", "Training records could not be read."); }
  const identity = str(ctx.identity);
  const partial = courses.partial || sessions.partial || completions.partial;
  if (identity) {
    const me = (ctx.members || []).filter((m) => m && m.identity === identity);
    const c = complianceOf(me, ctx.departments, courses.rows, completions.rows, today);
    return { ok: true, today, partial, courses: courses.rows.filter((x) => x.active !== false).map(courseOut), mine: c.people[0] || null,
      completions: completions.rows.filter((t) => t.identity === identity && !t.removed).map(trainingOut),
      sessions: sessions.rows.filter((s) => s.status === "planned" && (s.attendees || []).some((a) => a.identity === identity)).map(sessionOut) };
  }
  return { ok: true, today, partial, courses: courses.rows.map(courseOut).sort((a, b) => a.name.localeCompare(b.name)),
    sessions: sessions.rows.map(sessionOut).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    completions: completions.rows.filter((t) => !t.removed).map(trainingOut).sort((a, b) => String(b.completedOn).localeCompare(String(a.completedOn))).slice(0, 500),
    compliance: complianceOf(ctx.members || [], ctx.departments, courses.rows, completions.rows, today) };
}

export {
  CRED as CREDENTIAL_TYPE, ALERT as ALERT_TYPE, COURSE as COURSE_TYPE, SESSION as SESSION_TYPE, TRAINING as TRAINING_TYPE, ALERT_DAYS, STANDARD_COURSES,
  credentialState, dueAlerts, registrationBlock, registrationStatus, complianceOf, addMonths,
  saveCredential, runCredentialAlerts, acknowledgeAlert, listCredentials, saveCourse, saveSession, recordSessionAttendance, recordTraining, trainingOverview,
};
