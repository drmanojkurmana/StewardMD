/* functions/_wardsynq/patient-messaging.js - reminders to patients by SMS and WhatsApp (gap wave 2026-09-16).
 *
 * WHAT IS SENT. Five message types, each off until the hospital turns it on and names its template:
 *   appointment  before a booked appointment, at the hours the hospital sets (24 and 2 by default)
 *   labReady     a laboratory report became final (never a critical one: that is discussed by the care team first)
 *   followUp     a promised follow-up (AppointmentRequest) is due within the days the hospital sets
 *   refill       an active medicine's prescribed duration ends within the days the hospital sets
 *   feedback     a stay or an OPD visit finished: the survey link (patient-feedback.js)
 * No message carries a diagnosis, a test, a medicine or a name: a date, the hospital's name and a link at most.
 *
 * CHANNELS ARE ADAPTERS. SMS reuses the existing DLT path (_followcare_sms.js sendTwoFactor, the hospital's DLT
 * sender ID from Admin > Hospital > alerts), with a DLT template NAME per message type that the hospital enters.
 * WhatsApp is the Business Cloud API (WHATSAPP_KIND below), a connector on Admin > Integrations whose access
 * token is sealed per hospital (connectors.js) and never returned. The domain takes both as ports.
 *
 * CONSENT FIRST (DPDP). A message goes only to a channel the patient opted in to, with the number they consented
 * for (`_wardsynq_comm_pref`, every change a version naming who recorded it and how). Opt-out is re-checked at the
 * moment of sending. No consent is recorded as skipped, never quietly dropped.
 *
 * SENT MEANS THE PROVIDER ACCEPTED IT, AND NOTHING LESS. A message is marked sent only when the provider's API
 * answered success (2Factor Status Success; WhatsApp a message id with status accepted). A refusal, a network
 * failure, a held or paused WhatsApp message, a missing template or credential is failed with the reason, retried
 * at most three times where retrying can help, and listed on Admin > Patient communication. Delivery to the handset
 * is not confirmed by anything here and the screen says so.
 *
 * QUIET HOURS. Nothing is sent inside the hospital's quiet hours (its local time); the message waits, and one whose
 * moment has passed (an appointment already started) expires rather than arriving late.
 */

import { VersionConflictError } from "./repository.js";
import { newInvite, INVITE_TYPE } from "./patient-feedback.js";
import { lawOn, childGate } from "./privacy-law.js";

const PREF = "_wardsynq_comm_pref", MESSAGE = "_wardsynq_comm_message";
const TYPES = Object.freeze(["appointment", "labReady", "followUp", "refill", "feedback"]);
const CHANNELS = Object.freeze(["whatsapp", "sms"]);
const SCAN = 1000, MAX_NEW_PER_RUN = 200, MAX_SEND_PER_RUN = 100, MAX_ATTEMPTS = 3, RETRY_AFTER_MS = 15 * 60000;

const str = (v) => (v == null ? "" : String(v).trim());
const clip = (v, n) => str(v).slice(0, n);
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
const auditEvent = (action, actor, scope) => ({ ts: new Date().toISOString(), actor: str(actor), connectorId: "wardsynq-patient-comms", action, outcome: "ok", scope });
const refuse = (status, error, message) => ({ ok: false, status, error, message });
const noStore = (mig) => !mig || mig.mode === "off" || !mig.tenantId;
const notHospital = refuse(404, "not_a_wardsynq_hospital", "Patient communication is kept for a WardSynQ hospital.");

/* ---- the WhatsApp Business Cloud API adapter --------------------------------------------------------------
 * Request shape read from Meta's Cloud API reference on 2026-09-16
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages):
 *   POST https://graph.facebook.com/{Version}/{Phone-Number-ID}/messages, Authorization: Bearer <token>
 *   { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
 *     template: { name, language: { code }, components: [{ type: "body", parameters: [{ type: "text", text }] }] } }
 *   200 -> { messaging_product, contacts: [{ input, wa_id }], messages: [{ id, message_status }] },
 *   message_status "accepted" | "held_for_quality_assessment" | "paused". Only accepted counts as sent. */
const GRAPH = "https://graph.facebook.com";
const metaCloud = {
  label: "WhatsApp Business Cloud API (Meta)",
  help: "From Meta's WhatsApp Manager: the phone number ID, the Graph API version (for example v21.0) and a permanent access token of a system user. Each message type needs an approved template, named on Admin > Patient communication.",
  settings: [
    { key: "phoneNumberId", label: "Phone number ID", type: "text", required: true },
    { key: "apiVersion", label: "Graph API version", type: "text", required: true },
  ],
  secrets: [{ key: "accessToken", label: "Access token", required: true }],
  validate: (s, present) => (!/^\d{5,20}$/.test(str(s.phoneNumberId)) ? "The phone number ID is digits only."
    : !/^v\d{1,2}\.\d$/.test(str(s.apiVersion)) ? "The Graph API version looks like v21.0."
    : !present.accessToken ? "WhatsApp needs the access token." : null),

  /** -> { ok: true, providerId } | { ok: false, reason, httpStatus?, detail, retry } */
  async sendTemplate({ settings, secrets, to, templateName, language, params, fetchImpl }) {
    const body = { messaging_product: "whatsapp", recipient_type: "individual", to: str(to), type: "template",
      template: { name: str(templateName), language: { code: str(language) || "en" }, components: [{ type: "body", parameters: (params || []).map((t) => ({ type: "text", text: String(t) })) }] } };
    let res, text = "";
    try {
      res = await (fetchImpl || fetch)(`${GRAPH}/${encodeURIComponent(str(settings.apiVersion))}/${encodeURIComponent(str(settings.phoneNumberId))}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${str(secrets.accessToken)}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      text = await res.text();
    } catch (e) { return { ok: false, reason: "PROVIDER_UNREACHABLE", detail: "WhatsApp could not be reached.", retry: true }; }
    let j = null; try { j = JSON.parse(text); } catch { j = null; }
    const msg = j && Array.isArray(j.messages) ? j.messages[0] : null;
    if (res.status >= 200 && res.status < 300 && msg && str(msg.id)) {
      const st = str(msg.message_status);
      if (!st || st === "accepted") return { ok: true, providerId: str(msg.id) };
      return { ok: false, reason: st === "held_for_quality_assessment" ? "PROVIDER_HELD" : "PROVIDER_PAUSED", httpStatus: res.status, detail: `WhatsApp did not accept the message for delivery (${st}).`, retry: false };
    }
    const err = j && j.error ? `${str(j.error.code)} ${str(j.error.message)}`.trim().slice(0, 160) : "";
    return { ok: false, reason: "PROVIDER_REFUSED", httpStatus: res.status, detail: `WhatsApp refused the message: ${res.status}${err ? ": " + err : ""}`, retry: res.status === 429 || res.status >= 500 };
  },
};
const WHATSAPP_KIND = Object.freeze({
  label: "WhatsApp Business", singleton: true,
  help: "Patient reminders over WhatsApp, only to patients who opted in to WhatsApp. Nothing is sent until this is set up and each message type names its approved template.",
  providers: { meta_cloud: metaCloud },
});

/* ---- configuration, pure ----------------------------------------------------------------------------------- */

/** PURE. The hospital's settings with defaults, each type off unless enabled. */
function settingsOf(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const t = c.types && typeof c.types === "object" ? c.types : {};
  const type = (k, extra) => {
    const x = t[k] && typeof t[k] === "object" ? t[k] : {};
    return { enabled: x.enabled === true, smsTemplate: clip(x.smsTemplate, 80), whatsappTemplate: clip(x.whatsappTemplate, 120), whatsappLanguage: clip(x.whatsappLanguage, 12) || "en", ...extra(x) };
  };
  const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(str(v)) ? str(v) : d);
  const quiet = c.quietHours && typeof c.quietHours === "object" ? c.quietHours : {};
  const channels = (Array.isArray(c.channels) ? c.channels : CHANNELS).filter((x) => CHANNELS.includes(x));
  return {
    enabled: c.enabled === true,
    quietHours: { start: hhmm(quiet.start, "21:00"), end: hhmm(quiet.end, "08:00") },
    channels: channels.length ? [...new Set(channels)] : [...CHANNELS],
    portalUrl: /^https:\/\/[^\s]+$/.test(str(c.portalUrl)) ? str(c.portalUrl).slice(0, 300) : "",
    types: {
      appointment: type("appointment", (x) => ({ offsetsHours: [...new Set((Array.isArray(x.offsetsHours) ? x.offsetsHours : [24, 2]).map(Number).filter((h) => Number.isFinite(h) && h > 0 && h <= 168))].sort((a, b) => b - a) })),
      labReady: type("labReady", () => ({})),
      followUp: type("followUp", (x) => ({ daysBefore: Number.isInteger(Number(x.daysBefore)) && Number(x.daysBefore) >= 0 && Number(x.daysBefore) <= 30 ? Number(x.daysBefore) : 2 })),
      refill: type("refill", (x) => ({ daysBefore: Number.isInteger(Number(x.daysBefore)) && Number(x.daysBefore) >= 0 && Number(x.daysBefore) <= 30 ? Number(x.daysBefore) : 3 })),
      feedback: type("feedback", () => ({})),
    },
  };
}

/** PURE. Minute-of-day inside [start, end), wrapping midnight. */
function inQuietHours(nowMs, off, quiet) {
  const m = Math.floor(((nowMs + off * 60000) % 86400000 + 86400000) % 86400000 / 60000);
  const toMin = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
  const s = toMin(quiet.start), e = toMin(quiet.end);
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** PURE. Digits with the country code; a 10-digit Indian number gets 91. Null when not a phone number. */
function normaliseMobile(v) {
  let d = str(v).replace(/[^\d]/g, "");
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
const mask = (d) => (d ? "*".repeat(Math.max(0, d.length - 4)) + d.slice(-4) : null);

/** PURE. A free-text prescribed duration ("5 days", "2 weeks", "1 month") in days, or null when it cannot be read. */
function durationDays(v) {
  const m = /^\s*(\d{1,3})\s*(d|day|days|w|wk|week|weeks|m|mo|month|months)\b/i.exec(str(v));
  if (!m) return null;
  const n = Number(m[1]), u = m[2].toLowerCase();
  return u.startsWith("w") ? n * 7 : u.startsWith("m") ? n * 30 : n;
}

const localText = (ms, off) => {
  const d = new Date(ms + off * 60000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const localDay = (ms, off) => localText(ms, off).slice(0, -6);

/* ---- preferences ------------------------------------------------------------------------------------------- */

const prefId = (patientId) => `pref-${slug(patientId)}`;
const prefOut = (p) => ({
  patientId: p ? p.patientId : null, version: p ? p.version : 0,
  channels: Object.fromEntries(CHANNELS.map((ch) => { const c = p && p.channels && p.channels[ch]; return [ch, c ? { optedIn: c.optedIn === true, mobile: mask(c.mobile), at: c.at, source: c.source, by: c.by } : { optedIn: false, mobile: null, at: null, source: null, by: null }]; })),
});

/**
 * Record an opt-in or opt-out. ctx: { repository, tenantId, patientId, channel, optedIn, mobile?, source "portal"|"staff", by, note? }
 * An opt-in needs the number consented for. An opt-out keeps no number.
 */
async function setPreference(ctx) {
  const patientId = str(ctx.patientId), channel = str(ctx.channel);
  if (!patientId) return refuse(422, "patient_required", "Choose the patient.");
  if (!CHANNELS.includes(channel)) return refuse(422, "bad_channel", "The channel is SMS or WhatsApp.");
  const optedIn = ctx.optedIn === true;
  const mobile = optedIn ? normaliseMobile(ctx.mobile) : null;
  if (optedIn && !mobile) return refuse(422, "mobile_required", "Give the mobile number the patient agreed to be contacted on.");
  if (ctx.source === "staff" && !clip(ctx.note, 200)) return refuse(422, "note_required", "Say how the patient gave or withdrew consent (for example: signed the consent form at the desk).");
  /* DPDP Rules 2025 r.10, from commencement (privacy-law.js): messaging a child directly is not a health service, so an
   * opt-in for a child (or a patient whose date of birth is not recorded) is recorded by staff with a parent or guardian
   * verified against an ID the hospital holds or a DigiLocker token. A child cannot opt in from the portal. An opt-out
   * is never gated. */
  let parentVerification = null;
  const law = lawOn(ctx.dpdp, Date.now());
  if (optedIn && law.dpdpInForce) {
    let patient;
    try { patient = await ctx.repository.latest(ctx.tenantId, "Patient", patientId); } catch { return refuse(502, "record_read_failed", "The patient's date of birth could not be read, so nothing was changed."); }
    const pv = ctx.source === "staff" ? ctx.parentVerification || null : null;
    const gate = childGate({ dob: patient && patient.dob, purpose: "direct-message", atMs: Date.now(), law, givenBy: pv ? "parent" : "", verification: pv });
    if (gate.required && !gate.satisfied) return { ...refuse(422, "parental_consent_required", "Messages to a child need a parent or guardian's consent, recorded at the desk with their identity checked against an ID the hospital holds or a DigiLocker token."), citation: gate.citation };
    if (gate.required) parentVerification = { method: pv.method, reference: clip(pv.reference, 200), parentName: clip(pv.parentName, 200), verifiedBy: str(ctx.by), citation: gate.citation };
  }
  const at = new Date().toISOString();
  let cur;
  try { cur = await ctx.repository.latest(ctx.tenantId, PREF, prefId(patientId)); } catch { return refuse(502, "preference_read_failed", "The patient's preferences could not be read, so nothing was changed."); }
  const prev = cur && cur.channels && cur.channels[channel];
  if (prev && (prev.optedIn === true) === optedIn && (prev.mobile || null) === mobile) return { ok: true, unchanged: true, preference: prefOut(cur) };
  const next = { resourceType: PREF, id: prefId(patientId), version: cur ? cur.version + 1 : 1, patientId,
    channels: { ...((cur && cur.channels) || {}), [channel]: { optedIn, mobile, at, by: str(ctx.by), source: ctx.source === "portal" ? "portal" : "staff", note: clip(ctx.note, 200) || null, parentVerification } },
    writtenBy: { id: str(ctx.by), kind: "human", at } };
  try { await ctx.repository.append(ctx.tenantId, [next], { audit: auditEvent(optedIn ? "patient.comms.opt_in" : "patient.comms.opt_out", ctx.by, { channel, source: next.channels[channel].source }) }); }
  catch (e) { return e instanceof VersionConflictError ? refuse(409, "version_conflict", "The preferences changed at the same moment. Try again; nothing was saved.") : refuse(502, "preference_write_failed", "The preference could not be saved, so it was not changed."); }
  return { ok: true, preference: prefOut(next) };
}
async function getPreference(ctx) {
  try { return { ok: true, preference: prefOut(await ctx.repository.latest(ctx.tenantId, PREF, prefId(ctx.patientId))) }; }
  catch { return refuse(502, "preference_read_failed", "The patient's preferences could not be read."); }
}

/** Staff route. GET reads, POST records. ctx: { migration, recordDeps, actorId, method, patientId, channel, optedIn, mobile, note } */
async function staffPreference(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repository = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, patientId = str(ctx.patientId);
  if (!patientId) return refuse(422, "patient_required", "Choose the patient.");
  let patient;
  try { patient = await repository.latest(tenantId, "Patient", patientId); } catch { return refuse(502, "record_read_failed", "The patient could not be read."); }
  if (!patient) return refuse(404, "patient_not_found", "No such patient at this hospital.");
  if (ctx.method === "GET") return getPreference({ repository, tenantId, patientId });
  return setPreference({ repository, tenantId, patientId, channel: ctx.channel, optedIn: ctx.optedIn === true, mobile: ctx.mobile, source: "staff", by: ctx.actorId, note: ctx.note, dpdp: ctx.dpdp, parentVerification: ctx.parentVerification });
}

/* ---- generating what is due ------------------------------------------------------------------------------------ */

/** PURE. The candidates due now from the record. src: { appointments, reports, recalls, orders, encounters }. */
function dueCandidates(s, src, nowMs, off, orgName, feedbackOn) {
  const out = [];
  const T = s.types;
  if (T.appointment.enabled) {
    for (const a of src.appointments || []) {
      const start = Date.parse(a && a.startAt);
      if (!a || a.state !== "booked" || !Number.isFinite(start) || start <= nowMs) continue;
      const offs = T.appointment.offsetsHours;
      for (let i = 0; i < offs.length; i++) {
        const due = start - offs[i] * 3600000, nextDue = i + 1 < offs.length ? start - offs[i + 1] * 3600000 : Infinity;
        if (nowMs >= due && nowMs < nextDue) out.push({ type: "appointment", key: `${a.id}-${offs[i]}h`, patientId: a.patientId, subject: { kind: "Appointment", id: a.id }, dueAt: due, expiresAt: start, vars: [localText(start, off), orgName] });
      }
    }
  }
  if (T.labReady.enabled) {
    for (const r of src.reports || []) {
      const at = Date.parse((r && (r.verifiedAt || r.issuedAt || (r.writtenBy && r.writtenBy.at))) || "");
      if (!r || r.status !== "final" || r.critical || !Number.isFinite(at) || nowMs - at > 72 * 3600000) continue;
      out.push({ type: "labReady", key: r.id, patientId: r.patientId, subject: { kind: "DiagnosticReport", id: r.id }, dueAt: at, expiresAt: at + 7 * 86400000, vars: [orgName, s.portalUrl || "-"] });
    }
  }
  if (T.followUp.enabled) {
    for (const q of src.recalls || []) {
      const due = Date.parse(str(q && q.dueBy).slice(0, 10) + "T00:00:00Z") - off * 60000;
      if (!q || q.state !== "open" || !Number.isFinite(due)) continue;
      const from = due - T.followUp.daysBefore * 86400000;
      if (nowMs >= from && nowMs <= due + 86400000) out.push({ type: "followUp", key: q.id, patientId: q.patientId, subject: { kind: "AppointmentRequest", id: q.id }, dueAt: from, expiresAt: due + 86400000, vars: [localDay(due, off), orgName] });
    }
  }
  if (T.refill.enabled) {
    for (const o of src.orders || []) {
      const days = durationDays(o && o.duration);
      const start = Date.parse((o && (o.signedAt || (o.meta && o.meta.createdAt) || (o.writtenBy && o.writtenBy.at))) || "");
      if (!o || o.status !== "active" || !days || !Number.isFinite(start)) continue;
      const end = start + days * 86400000, from = end - T.refill.daysBefore * 86400000;
      if (nowMs >= from && nowMs <= end) out.push({ type: "refill", key: `${o.id}-${o.version || 1}`, patientId: o.patientId, subject: { kind: "MedicationOrder", id: o.id }, dueAt: from, expiresAt: end, vars: [localDay(end, off), orgName] });
    }
  }
  if (feedbackOn) {
    for (const e of src.encounters || []) {
      const end = Date.parse((e && e.periodEnd) || "");
      if (!e || e.status !== "finished" || !["IPD", "OPD"].includes(e.class) || !Number.isFinite(end) || end > nowMs || nowMs - end > 3 * 86400000) continue;
      out.push({ type: "feedback", key: e.id, patientId: e.patientId, subject: { kind: "Encounter", id: e.id }, dueAt: end, expiresAt: end + 14 * 86400000, encounter: e });
    }
  }
  return out.filter((c) => str(c.patientId));
}

/* ---- sending --------------------------------------------------------------------------------------------------- */

/** One attempt on one channel. ports: { sms: {missing, send(to, templateName, vars)}, whatsapp: {spec, settings, secrets} | null, fetchImpl } */
async function attempt(msg, s, ports) {
  const t = s.types[msg.type];
  if (msg.channel === "sms") {
    if (!ports.sms || (ports.sms.missing || []).length) return { ok: false, reason: "SMS_NOT_CONFIGURED", detail: ((ports.sms && ports.sms.missing) || ["SMS is not set up."]).join(" "), retry: false };
    if (!t.smsTemplate) return { ok: false, reason: "TEMPLATE_NOT_SET", detail: "No DLT template name is set for this message type.", retry: false };
    try {
      const r = await ports.sms.send(msg.to, t.smsTemplate, msg.vars || []);
      if (r && r.ok) return { ok: true, providerId: r.providerId ? String(r.providerId).slice(0, 80) : null };
      return { ok: false, reason: "PROVIDER_REFUSED", httpStatus: (r && r.status) || null, detail: `The SMS provider did not accept the message${r && r.status ? ` (${r.status})` : ""}.`, retry: !r || !r.status || r.status >= 500 || r.status === 429 };
    } catch { return { ok: false, reason: "PROVIDER_UNREACHABLE", detail: "The SMS provider could not be reached.", retry: true }; }
  }
  if (!ports.whatsapp) return { ok: false, reason: "WHATSAPP_NOT_CONFIGURED", detail: "WhatsApp is not connected on Admin > Integrations.", retry: false };
  if (!t.whatsappTemplate) return { ok: false, reason: "TEMPLATE_NOT_SET", detail: "No WhatsApp template is set for this message type.", retry: false };
  return ports.whatsapp.spec.sendTemplate({ settings: ports.whatsapp.settings, secrets: ports.whatsapp.secrets, to: msg.to, templateName: t.whatsappTemplate, language: t.whatsappLanguage, params: msg.vars || [], fetchImpl: ports.fetchImpl });
}

const msgOut = (m) => ({
  id: m.id, type: m.type, patientId: m.patientId, subject: m.subject, channel: m.channel || null, to: mask(m.to), status: m.status, reason: m.reason || null, detail: m.detail || null,
  dueAt: m.dueAt, sentAt: m.sentAt || null, attempts: (m.attempts || []).length, lastAttemptAt: ((m.attempts || []).slice(-1)[0] || {}).at || null, providerId: m.providerId || null, updatedAt: m.writtenBy && m.writtenBy.at,
});

/**
 * Generate what is due and send what can be sent. Called by the hospital's tick and by "Send due now".
 * ctx: { repository, tenantId, orgName, commsCfg, feedbackCfg, off, nowMs?, ports: { sms, whatsapp, fetchImpl }, actorId? }
 * -> { ok, created, sent, failed, held, skipped, expired } or a refusal when the record could not be read.
 */
async function runPatientMessaging(ctx) {
  const s = settingsOf(ctx.commsCfg);
  const feedbackOn = !!(ctx.feedbackCfg && ctx.feedbackCfg.enabled === true);
  if (!s.enabled && !feedbackOn) return { ok: true, skipped: "off" };
  const nowMs = Number(ctx.nowMs) || Date.now(), off = Number(ctx.off) || 0, repo = ctx.repository, tenantId = ctx.tenantId;
  const by = str(ctx.actorId) || "service:patient-comms";
  const read = (type, on) => (on ? repo.latestByType(tenantId, type, SCAN, { newest: true }) : Promise.resolve([]));
  let existing, invited, src;
  try {
    const T = s.enabled ? s.types : {};
    const [msgs, invites, appointments, reports, recalls, orders, encounters] = await Promise.all([
      repo.latestByType(tenantId, MESSAGE, SCAN, { newest: true }), read(INVITE_TYPE, feedbackOn),
      read("Appointment", T.appointment && T.appointment.enabled), read("DiagnosticReport", T.labReady && T.labReady.enabled),
      read("AppointmentRequest", T.followUp && T.followUp.enabled), read("MedicationOrder", T.refill && T.refill.enabled), read("Encounter", feedbackOn)]);
    existing = new Map((msgs || []).filter(Boolean).map((m) => [m.id, m]));
    invited = new Set((invites || []).filter(Boolean).map((i) => i.encounterId));
    src = { appointments, reports, recalls, orders, encounters };
  } catch { return refuse(502, "record_read_failed", "The record could not be read, so no reminders were generated or sent."); }

  const out = { ok: true, created: 0, sent: 0, failed: 0, held: 0, skipped: 0, expired: 0, invites: 0 };
  const at = new Date(nowMs).toISOString();
  const prefCache = new Map();
  const prefOf = async (pid) => { if (!prefCache.has(pid)) prefCache.set(pid, await repo.latest(tenantId, PREF, prefId(pid))); return prefCache.get(pid); };

  /* 1. New messages. Deterministic ids: a candidate already written is never written twice. */
  const cands = dueCandidates(s, src, nowMs, off, clip(ctx.orgName, 60) || "Hospital", feedbackOn)
    // A stay already invited is not invited again: its token was shown once and is not kept.
    .filter((c) => !existing.has(`msg-${c.type}-${slug(c.key)}`) && !(c.type === "feedback" && invited.has(c.key))).slice(0, MAX_NEW_PER_RUN);
  for (const c of cands) {
    const id = `msg-${c.type}-${slug(c.key)}`;
    const typeOn = s.enabled && s.types[c.type].enabled;
    let pref;
    try { pref = typeOn ? await prefOf(c.patientId) : null; } catch { return { ...refuse(502, "record_read_failed", "Patient preferences could not be read; the run stopped."), ...out }; }
    const channel = typeOn ? s.channels.find((ch) => pref && pref.channels && pref.channels[ch] && pref.channels[ch].optedIn === true) : null;
    const recs = [];
    let vars = c.vars;
    if (c.type === "feedback") {
      const inv = await newInvite(c.encounter, ctx.feedbackCfg, nowMs);
      recs.push(...inv.records);
      invited.add(c.key);
      out.invites++;
      vars = [clip(ctx.orgName, 60) || "Hospital", s.portalUrl ? `${s.portalUrl}#org=${encodeURIComponent(str(ctx.orgId))}&survey=${inv.token}` : "-"];
      if (!typeOn) {
        try { await repo.append(tenantId, recs, { audit: auditEvent("patient.feedback.invited", by, { inviteId: inv.record.id }) }); }
        catch (e) { if (!(e instanceof VersionConflictError)) return { ...refuse(502, "record_write_failed", "A feedback invitation could not be saved; the run stopped."), ...out }; }
        continue;
      }
    }
    const msg = { resourceType: MESSAGE, id, version: 1, type: c.type, patientId: c.patientId, subject: c.subject, dueAt: new Date(c.dueAt).toISOString(), expiresAt: new Date(c.expiresAt).toISOString(),
      channel: channel || null, to: channel ? pref.channels[channel].mobile : null, vars, status: channel ? "queued" : "skipped", reason: channel ? null : "NO_CONSENT",
      detail: channel ? null : "The patient has not opted in to SMS or WhatsApp.", attempts: [], createdAt: at, writtenBy: { id: by, kind: "service", at } };
    recs.push(msg);
    try { await repo.append(tenantId, recs, { audit: auditEvent("patient.message.queued", by, { id, type: c.type, status: msg.status }) }); }
    catch (e) { if (e instanceof VersionConflictError) continue; return { ...refuse(502, "record_write_failed", "A reminder could not be saved; the run stopped."), ...out }; }
    existing.set(id, msg); out.created++;
    if (msg.status === "skipped") out.skipped++;
  }
  if (!s.enabled) return out;

  /* 2. Send. Queued, held by quiet hours, or failed with a retry due. */
  const quiet = inQuietHours(nowMs, off, s.quietHours);
  const sendable = [...existing.values()].filter((m) => m && (m.status === "queued" || m.status === "held_quiet_hours" || (m.status === "retrying" && Date.parse(m.nextAttemptAt || "") <= nowMs)))
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))).slice(0, MAX_SEND_PER_RUN);
  for (const m of sendable) {
    let next;
    if (Date.parse(m.expiresAt) <= nowMs) next = { ...m, status: "expired", reason: "EXPIRED", detail: "Its moment passed before it could be sent." };
    else if (quiet) { if (m.status === "held_quiet_hours") { out.held++; continue; } next = { ...m, status: "held_quiet_hours", reason: "QUIET_HOURS", detail: `Waiting for the end of quiet hours (${s.quietHours.end}).` }; }
    else {
      let pref;
      try { pref = await prefOf(m.patientId); } catch { continue; }
      const cp = pref && pref.channels && pref.channels[m.channel];
      if (!s.types[m.type].enabled) next = { ...m, status: "skipped", reason: "TYPE_TURNED_OFF", detail: "The hospital turned this message type off before it was sent." };
      else if (!cp || cp.optedIn !== true) next = { ...m, status: "skipped", reason: "OPTED_OUT", detail: "The patient opted out before it was sent." };
      else {
        const msg = { ...m, to: cp.mobile };
        let r;
        try { r = await attempt(msg, s, ctx.ports || {}); } catch { r = { ok: false, reason: "SEND_ERROR", detail: "The send could not run.", retry: true }; }
        const attempts = [...(m.attempts || []), { at, channel: m.channel, ok: !!r.ok, reason: r.reason || null, httpStatus: r.httpStatus || null }];
        if (r.ok) next = { ...msg, attempts, status: "sent", reason: null, detail: null, sentAt: at, providerId: r.providerId || null };
        else if (r.retry && attempts.length < MAX_ATTEMPTS) next = { ...msg, attempts, status: "retrying", reason: r.reason, detail: r.detail || null, nextAttemptAt: new Date(nowMs + RETRY_AFTER_MS).toISOString() };
        else next = { ...msg, attempts, status: "failed", reason: r.reason, detail: r.detail || null };
      }
    }
    next = { ...next, version: m.version + 1, writtenBy: { id: by, kind: "service", at } };
    try { await repo.append(tenantId, [next], { audit: auditEvent(`patient.message.${next.status}`, by, { id: m.id, type: m.type, channel: m.channel, reason: next.reason || null }) }); }
    catch (e) { if (e instanceof VersionConflictError) continue; return { ...refuse(502, "record_write_failed", "A send result could not be recorded; the run stopped so nothing is sent twice."), ...out }; }
    existing.set(m.id, next);
    if (next.status === "sent") out.sent++;
    else if (next.status === "failed" || next.status === "retrying") out.failed++;
    else if (next.status === "held_quiet_hours") out.held++;
    else if (next.status === "expired") out.expired++;
    else if (next.status === "skipped") out.skipped++;
  }
  return out;
}

/* ---- the Admin screen's reads and acts -------------------------------------------------------------------------- */

/** PURE. For each type and channel: what is missing before it can send. */
function readiness(s, smsMissing, whatsappConnected) {
  const out = {};
  for (const k of TYPES) {
    const t = s.types[k];
    out[k] = {
      enabled: t.enabled,
      sms: [...(smsMissing || []), ...(t.smsTemplate ? [] : ["No DLT template name for this message type."])],
      whatsapp: [...(whatsappConnected ? [] : ["WhatsApp is not connected on Admin > Integrations."]), ...(t.whatsappTemplate ? [] : ["No WhatsApp template for this message type."])],
    };
  }
  return out;
}

/** ctx: { migration, recordDeps, wsqCfg, smsMissing, whatsappConnected, status? } */
async function messageLog(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  let rows;
  try { rows = (await ctx.recordDeps.repository.latestByType(ctx.migration.tenantId, MESSAGE, SCAN, { newest: true })) || []; }
  catch { return refuse(502, "record_read_failed", "The delivery log could not be read."); }
  const s = settingsOf(ctx.wsqCfg && ctx.wsqCfg.patientComms);
  const counts = {};
  for (const m of rows) if (m) counts[m.status] = (counts[m.status] || 0) + 1;
  const want = str(ctx.status);
  return { ok: true, settings: s, readiness: readiness(s, ctx.smsMissing, ctx.whatsappConnected), whatsappConnected: !!ctx.whatsappConnected, smsMissing: ctx.smsMissing || [],
    counts, partial: rows.length >= SCAN, messages: rows.filter((m) => m && (!want || m.status === want || (want === "problems" && ["failed", "retrying", "skipped", "expired"].includes(m.status)))).slice(0, 300).map(msgOut) };
}

/** Put a failed, skipped or expired message back in the queue after its cause is fixed. ctx: { migration, recordDeps, actorId, id } */
async function retryMessage(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, at = new Date().toISOString();
  let cur;
  try { cur = await repo.latest(tenantId, MESSAGE, str(ctx.id)); } catch { return refuse(502, "record_read_failed", "The message could not be read."); }
  if (!cur) return refuse(404, "message_not_found", "No such message.");
  if (!["failed", "skipped", "retrying"].includes(cur.status)) return refuse(409, "not_retryable", "Only a failed or skipped message can be tried again.");
  if (Date.parse(cur.expiresAt) <= Date.now()) return refuse(409, "expired", "This message's moment has passed; it is not sent late.");
  let pref;
  try { pref = await repo.latest(tenantId, PREF, prefId(cur.patientId)); } catch { return refuse(502, "record_read_failed", "The patient's preferences could not be read."); }
  const s = settingsOf(ctx.wsqCfg && ctx.wsqCfg.patientComms);
  const channel = s.channels.find((ch) => pref && pref.channels && pref.channels[ch] && pref.channels[ch].optedIn === true);
  if (!channel) return refuse(409, "no_consent", "The patient has not opted in to any channel.");
  const next = { ...cur, version: cur.version + 1, status: "queued", channel, to: pref.channels[channel].mobile, reason: null, detail: null, retryRequestedBy: str(ctx.actorId), writtenBy: { id: str(ctx.actorId), kind: "human", at } };
  try { await repo.append(tenantId, [next], { audit: auditEvent("patient.message.requeued", ctx.actorId, { id: cur.id }) }); }
  catch (e) { return e instanceof VersionConflictError ? refuse(409, "version_conflict", "The message changed at the same moment; nothing was changed.") : refuse(502, "record_write_failed", "The message could not be queued again."); }
  return { ok: true, message: msgOut(next) };
}

export {
  PREF as PREFERENCE_TYPE, MESSAGE as MESSAGE_TYPE, TYPES as MESSAGE_TYPES, CHANNELS, WHATSAPP_KIND,
  settingsOf, inQuietHours, normaliseMobile, durationDays, dueCandidates, readiness,
  setPreference, getPreference, staffPreference, runPatientMessaging, messageLog, retryMessage,
};
