/* functions/_wardsynq/portal-requests.js - the patient asks; a human answers.
 *
 * #948 gave the patient a read-only door. This is the other direction, and it is the direction with
 * the hazards. Two things a patient may do - send a message to their care team, and ask for an
 * appointment - and one rule underneath both: NOTHING A PATIENT SENDS CAUSES ANYTHING TO HAPPEN BY
 * ITSELF. Every route here creates a request that a named human then acts on, or does not.
 *
 * THIS IS NOT A CHANNEL FOR AN EMERGENCY, and saying so once in a help page is not enough. A patient
 * with crushing chest pain who types it into a portal because the portal was there, and waits, is
 * the single worst outcome this feature can produce. So the warning is on the page, on the form, and
 * on the stored record and every response - and it is deliberately the first thing in the payload
 * rather than a footnote under a send button.
 *
 * NOTHING AUTO-REPLIES. No AI answers a patient message, at any tier, ever. WardSynQ caps an AI actor
 * at DRAFT everywhere else precisely so a model cannot commit a clinical act, and a reassuring
 * automatic reply to "my chest hurts" is a clinical act performed by a machine on a person who
 * believed they had contacted their doctor. There is no reply path in this file that any non-human
 * actor can reach: a reply requires EMR_TREAT.
 *
 * AN UNREAD MESSAGE IS THE FAILURE MODE, so it is measured. A message that sits unread for days is
 * how this feature hurts somebody, and a worklist that shows only a count hides it. Every message
 * carries how long it has been waiting, oldest first, and nothing marks itself read.
 *
 * A PATIENT CANNOT BOOK. `AppointmentRequest` already exists with exactly this rule - a follow-up
 * somebody promised that stays outstanding until a human books it, because auto-booking makes a
 * promise look kept when nobody has spoken to the patient. A patient asking for an appointment is
 * the same fact from the other side, so it is the same type and it reserves nothing.
 *
 * THE PATIENT ID COMES FROM THE GRANT, never from the request, exactly as in #948. A session that
 * took a patient id from its caller could write a message onto anybody's record.
 */

import { makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { RecordService } from "./service.js";
import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";

const str = (v) => (v == null ? "" : String(v).trim());

const MESSAGE_TYPE = "PatientMessage";
const REQUEST_TYPE = "AppointmentRequest";

/** Long enough for a real question, short enough that nobody writes their history into it. */
const MAX_BODY = 2000;

/** Said on the page, on the form, on the record and on every response. Never a footnote. */
const NOT_EMERGENCY =
  "This is not a way to get urgent help. Nobody is watching for messages all the time, and a reply may take days. "
  + "If you are seriously unwell, or worried you might be, contact your hospital or emergency services now.";

/**
 * The actor a patient's own write runs as.
 *
 * KIND.HUMAN with a `patient:` id, as in #948, and a write scope of exactly the two things a patient
 * may create. It is TIER.DRAFT and not EXECUTE on purpose: what a patient sends is a REQUEST, and
 * the ladder should say so rather than relying on every route to remember.
 */
function patientWriteActor(patientId) {
  return makeActor({
    id: `patient:${str(patientId)}`,
    kind: KIND.HUMAN,
    tier: TIER.DRAFT,
    scope: { read: [MESSAGE_TYPE, REQUEST_TYPE], write: [MESSAGE_TYPE, REQUEST_TYPE] },
  });
}

function serviceFor(ctx, actor) {
  return new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: { id: ctx.migration.tenantId }, actor, role: "patient-portal", roleSource: "wardsynq-patient-access",
  });
}

/** PURE. How long something has been waiting, in hours. Null when it cannot be told. */
function waitingHours(sinceIso, nowIso) {
  const from = Date.parse(str(sinceIso));
  const now = Date.parse(str(nowIso)) || Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((now - from) / 3600000));
}

/**
 * PURE. The worklist, oldest first, with how long each has waited.
 *
 * A count alone hides the message that has been sitting for four days, which is the one that matters.
 */
function worklist(messages, nowIso) {
  const open = (messages || []).filter(Boolean).filter((m) => !m.answeredAt);
  const rows = open.map((m) => ({
    messageId: m.id, patientId: m.patientId, subject: m.subject || null, sentAt: m.sentAt,
    waitingHours: waitingHours(m.sentAt, nowIso),
  }));
  /* Oldest first and never newest first. A queue sorted the other way buries the failure at the
   * bottom of the page, which is exactly where it will stay. */
  rows.sort((a, b) => String(a.sentAt || "").localeCompare(String(b.sentAt || "")));
  const longest = rows.length ? rows[0].waitingHours : null;
  return {
    open: rows.length, messages: rows, longestWaitingHours: longest,
    ...(longest !== null && longest >= 48 ? {
      warning: `The oldest unanswered message has been waiting ${longest} hours. Patients were told a reply may take days; nothing here chases anyone, and nobody is watching this list unless a person opens it.`,
    } : {}),
  };
}

/** PURE. The stored message. */
function PatientMessage(input) {
  const i = input || {};
  return {
    resourceType: MESSAGE_TYPE,
    id: i.id, patientId: i.patientId,
    subject: i.subject || null,
    body: i.body,
    sentAt: i.sentAt,
    /* Stamped on the row itself. Anybody reading this later - a clinician, an investigator - sees
     * what the patient was told about the channel at the moment they used it. */
    channelWarning: NOT_EMERGENCY,
    answeredAt: i.answeredAt || null,
    answeredBy: i.answeredBy || null,
    reply: i.reply || null,
    source: { system: "wardsynq-native", sourceId: `patient-message:${i.id}` },
  };
}

/**
 * The patient sends a message. Called only from the portal endpoint, after the token is checked.
 * ctx: { migration, patientId, subject?, body, recordDeps }
 */
async function sendMessage(request, env, ctx) {
  const base = { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const body = str(ctx.body);
  if (!body) return { ...base, ok: false, status: 422, error: "message_required", written: 0, notEmergency: NOT_EMERGENCY };
  if (body.length > MAX_BODY) {
    return { ...base, ok: false, status: 422, error: "message_too_long", written: 0,
      detail: `A message can be up to ${MAX_BODY} characters. This is a question for your team, not a place to write your history.` };
  }

  const at = new Date().toISOString();
  const id = `wsq-pmsg-${str(patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.replace(/[^0-9]/g, "")}`;
  const record = PatientMessage({ id, patientId, subject: str(ctx.subject) || null, body, sentAt: at });

  try {
    await serviceFor(ctx, patientWriteActor(patientId)).put(record);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }

  return {
    ...base, ok: true, written: 1, messageId: id, sentAt: at,
    /* First in the payload, not a footnote. A patient who has just described chest pain into a text
     * box is the person who most needs to read this sentence. */
    notEmergency: NOT_EMERGENCY,
    note: "Your message has been added to your record and your care team will see it. Nothing has replied to you automatically, and nothing will: a person answers this.",
  };
}

/**
 * The patient asks for an appointment. It reserves nothing and books nothing.
 * ctx: { migration, patientId, reason, preference?, recordDeps }
 */
async function requestAppointment(request, env, ctx) {
  const base = { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null };
  const patientId = str(ctx.patientId);
  const reason = str(ctx.reason);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say briefly what the appointment is for, so the person booking it can judge how soon", written: 0 };

  const at = new Date().toISOString();
  const id = `wsq-apreq-${str(patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.replace(/[^0-9]/g, "")}`;
  /* The SAME type a clinician's promised follow-up uses, with the same rule: it stays visibly
   * outstanding until a human books it. Auto-booking would make the promise look kept when nobody
   * had spoken to the patient, and that is no less true when the patient asked. */
  const record = {
    resourceType: REQUEST_TYPE, id, patientId,
    reason, preference: str(ctx.preference) || null,
    state: "outstanding",
    requestedAt: at,
    /* WHO ASKED, recorded. A follow-up a clinician promised and one a patient asked for are
     * different facts and a booking clerk reads them differently. */
    requestedBy: `patient:${patientId}`,
    origin: "patient",
    source: { system: "wardsynq-native", sourceId: `patient-appointment-request:${id}` },
  };

  try {
    await serviceFor(ctx, patientWriteActor(patientId)).put(record);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }

  return {
    ...base, ok: true, written: 1, requestId: id, requestedAt: at,
    notEmergency: NOT_EMERGENCY,
    /* Never "your appointment is booked". Nothing has been reserved and no slot is held. */
    note: "Your request has been sent. NOTHING IS BOOKED YET and no time has been held: somebody will contact you to arrange it. If you do not hear back, contact the hospital.",
  };
}

async function openClinical(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { resolved, svc: new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : "permission", detail: str(e && e.message) } };
  }
}

/** ctx: { migration, now? } - what patients have asked, oldest first. */
async function messageWorklist(request, env, ctx) {
  const base = { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null };
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", open: 0, messages: [] };

  const { svc, error } = await openClinical(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, open: 0, messages: [] };

  let rows;
  try { rows = await svc.list(MESSAGE_TYPE, 200); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), open: 0, messages: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), open: 0, messages: [] };
  }

  return { ...base, ok: true, ...worklist(rows, str(ctx.now) || new Date().toISOString()),
    note: "Nothing marks itself read, and nothing here has replied to anybody. A message is answered by a person." };
}

/**
 * A clinician replies. EMR_TREAT, because answering a patient's clinical question is a clinical act.
 * ctx: { migration, messageId, reply }
 */
async function replyToMessage(request, env, ctx) {
  const base = { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null };
  const messageId = str(ctx.messageId), reply = str(ctx.reply);
  if (!messageId || !reply) return { ...base, ok: false, status: 422, error: "reply_required", written: 0 };

  const { svc, resolved, error } = await openClinical(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(MESSAGE_TYPE, messageId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "message_not_found", written: 0 };

  const { meta, version, ...rest } = current;
  const now = new Date().toISOString();
  try {
    /* Written by the clinician's own actor, so the reply carries their identity in the record. An
     * AI actor is capped at DRAFT by its kind and would be refused here by the store itself, which
     * is the structural half of "nothing auto-replies". */
    await svc.put({ ...rest, reply, answeredAt: now, answeredBy: resolved.actor.id }, { expectedVersion: version });
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
  return { ...base, ok: true, written: 1, messageId, answeredAt: now, actor: resolved.actor.id,
    note: "The reply is on the patient's record and they will see it next time they open their record. Nothing has been sent to a phone." };
}

export {
  MESSAGE_TYPE, REQUEST_TYPE, MAX_BODY, NOT_EMERGENCY,
  patientWriteActor, waitingHours, worklist, PatientMessage,
  sendMessage, requestAppointment, messageWorklist, replyToMessage,
};
