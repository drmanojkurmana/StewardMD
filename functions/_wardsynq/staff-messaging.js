/* functions/_wardsynq/staff-messaging.js - staff talk to staff about a patient inside WardSynQ, not on WhatsApp.
 *
 * THE PROBLEM. Ward groups on WhatsApp carry names, MRNs, photos of drug charts and results, on personal phones, with
 * no record of who read what and no way to take a message back. That is patient data outside the hospital's record
 * under the DPDP Act and the IT Act. This is the same conversation kept where the chart is.
 *
 * ONE MESSAGE IS ONE StaffMessage RECORD, bound to a patient (and optionally the stay) or to a unit. A reply names the
 * thread it answers and inherits the thread's binding and addressees, so a thread about Bed 4 cannot drift onto
 * another patient. Addressed by ROLE (doctor, nurse, ...), by NAMED PEOPLE, or both. A named person must be an active
 * member of this hospital whose role may read the patient (checked at send, against this hospital's member list, so a
 * member of another hospital cannot be named). A thread addressed only to named people is shown to them and its sender,
 * not to everyone else who may read the patient; the record itself is unchanged and still readable for an investigation.
 *
 * WHO MAY SEE A PATIENT THREAD is who may see the patient. Every read of a patient thread first reads the Patient
 * record as the caller, through their own governed service, so the same grant that opens the chart opens the thread
 * and the read is audited like any chart read. A role that cannot read the patient gets 403 and no message text.
 * (This codebase grants patient access by record type per role; there is no per-patient care-team rule to apply.)
 *
 * NOTHING LEAVES WARDSYNQ. There is no SMS, WhatsApp or email path in this file. Escalation is a push to the
 * addressees' registered phones with a FIXED title and body (messagePushPayload): no patient name, MRN, ward, bed,
 * thread id or message text, only "a message is waiting". The text is read after signing in.
 *
 * NOTHING IS DELETED. The record store is append-only: an edit is a new version (the earlier text stays in the
 * history), and a recall is a new version with who, when and why. A recalled message's text is not shown on the
 * list; it is still in the record for an investigation.
 *
 * READ STATE is one StaffMessageRead per (thread, reader), a version per time they opened it. Unread is computed:
 * messages in the thread from somebody else sent after the reader's last read.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-staff-messaging.test.mjs
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor, grantForRole } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ROLES, CAPS, can } from "../_queue_roles.js";
import { FOETAL_SEX } from "./registers.js";
import { patientLabels, labelKey, actorName } from "./patient-label.js";

const MSG = "StaffMessage";
const READ = "StaffMessageRead";
const MAX_BODY = 2000;
const MAX_SUBJECT = 120;
/* ponytail: a named address is for a few colleagues; a larger group is a role. */
const MAX_PEOPLE = 20;
/* ponytail: one page of the newest messages and read marks per inbox load; an index by thread and reader when a
 * hospital outgrows it. A full page is reported as partial, never as everything. */
const SCAN = 500;

const str = (v) => (v == null ? "" : String(v).trim());
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });

/** PURE. The whole push for a message escalation. Fixed words; nothing from the message, the patient or the ward. */
function messagePushPayload() {
  return { title: "WardSynQ: message waiting", body: "A message is waiting for you. Open WardSynQ to read it.", tag: "wsq-message",
    data: { type: "wardsynq-message", v: "1", kind: "message", urgency: "high" } };
}

async function openService(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: "this message changed since it was shown; refresh and try again", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
const stripMeta = (r) => { const { meta, version, writtenBy, ...rest } = r; return { rec: rest, version }; };

/** Reads the patient as the caller: true, or a refusal. The read is the audited chart read that gates the thread. */
async function patientGate(svc, patientId) {
  try {
    const p = await svc.get("Patient", patientId);
    return p ? { ok: true, patient: p } : { ok: false, status: 404, error: "patient_not_found" };
  } catch (e) {
    if (e instanceof GovernanceError) return { ok: false, status: 403, error: "patient_not_readable", detail: "your role may not see this patient, so it may not see messages about them" };
    return { ok: false, status: 502, error: "record_read_failed" };
  }
}

/** PURE. Whether `me` may open a message's thread: a thread addressed only to named people is theirs and its sender's. */
function openTo(m, me) {
  const people = (m && m.toPeople) || [];
  if (!people.length || ((m.toRoles || []).length)) return true;
  return m.from === me || people.some((p) => p && p.identity === me);
}

/** A message by id, with its patient gate and its named-people gate applied. { msg, version } or { refuse }. */
async function loadMessage(svc, id, me) {
  let cur;
  try { cur = await svc.get(MSG, id); }
  catch (e) { return { refuse: e instanceof GovernanceError ? { ok: false, status: 403, error: "permission" } : { ok: false, status: 502, error: "record_read_failed" } }; }
  if (!cur) return { refuse: { ok: false, status: 404, error: "message_not_found" } };
  if (cur.patientId) { const g = await patientGate(svc, cur.patientId); if (!g.ok) return { refuse: g }; }
  if (!openTo(cur, me)) return { refuse: { ok: false, status: 403, error: "not_addressed", detail: "this thread is addressed to named people and you are not one of them" } };
  const { rec, version } = stripMeta(cur);
  return { msg: rec, version };
}

/** PURE. What a text may not say; null when it may be sent. */
function textRefusal(body) {
  if (!body) return { error: "body_required", detail: "write the message" };
  if (body.length > MAX_BODY) return { error: "body_too_long", detail: `a message is at most ${MAX_BODY} characters` };
  /* PC&PNDT Act s.5(2): nobody communicates the sex of a foetus by words or in any other manner, inside a hospital too
   * (the same check as a reply to a patient, portal-requests.js). */
  if (FOETAL_SEX.test(body)) return { error: "foetal_sex_refused", detail: "PC&PNDT Act s.5(2): a message must not state the sex of a foetus. Nothing was sent." };
  return null;
}

/**
 * Sends to the addressees who have not read the thread since this message: a fixed push, recorded on the message as a
 * new version. ctx.push(identities, msg) -> {sent,total,reason?} or null when this hospital has push off; ctx.members()
 * -> [{identity, role, active}]. Never "delivered": sent is what the gateway accepted.
 */
async function escalate(svc, ctx, msg, version, by, reads) {
  const at = new Date().toISOString();
  let entry;
  if (!ctx.push) entry = { at, by, recipients: 0, sent: 0, total: 0, reason: "PUSH_OFF" };
  else {
    let members;
    try { members = (await ctx.members()) || []; } catch { members = null; }
    if (!members) entry = { at, by, recipients: 0, sent: 0, total: 0, reason: "STAFF_UNREADABLE" };
    else {
      const readers = reads || new Map();
      const named = new Set((msg.toPeople || []).map((p) => p && p.identity));
      const ids = members.filter((m) => m && m.active !== false && ((msg.toRoles || []).includes(str(m.role)) || named.has(str(m.identity))))
        .map((m) => str(m.identity)).filter((id) => id && id !== msg.from && !(str(readers.get(id)) >= str(msg.sentAt)));
      if (!ids.length) entry = { at, by, recipients: 0, sent: 0, total: 0, reason: "NO_RECIPIENT" };
      else {
        let out;
        try { out = (await ctx.push(ids, messagePushPayload())) || {}; } catch { out = { sent: 0, total: 0, reason: "PUSH_FAILED" }; }
        entry = { at, by, recipients: ids.length, sent: out.sent || 0, total: out.total || 0, ...(out.reason ? { reason: out.reason } : {}) };
      }
    }
  }
  const next = { ...msg, escalations: [...(msg.escalations || []), entry] };
  try {
    const put = await svc.put(next, { expectedVersion: version });
    return { ok: true, escalation: entry, version: put.record.version, message: next };
  } catch (e) { return { ...writeFailure(e), escalation: entry, detail: "the push was attempted but could not be recorded on the message" }; }
}

/** PURE. A member as a picker shows them: a label, nothing else. */
const memberLabel = (m) => str(m.displayName) || str(m.email) || str(m.identity);

/** PURE. Whether a member's role may be addressed on a thread: it opens the chart and reads messages (and the patient). */
function roleMayRead(role, patientBound) {
  if (!can(role, CAPS.EMR_VIEW)) return false;
  const g = grantForRole(role);
  const reads = (t) => !!g && (g.read === null || g.read.includes(t));
  return reads("StaffMessage") && (!patientBound || reads("Patient"));
}

/**
 * The named addressees, checked against this hospital's active members. { people } or { refuse }. Everyone refused is
 * named in the refusal, so the sender knows whom to take off.
 */
async function resolvePeople(ctx, ids, patientBound) {
  if (!ids.length) return { people: [] };
  if (ids.length > MAX_PEOPLE) return { refuse: { ok: false, status: 422, error: "too_many_people", detail: `name at most ${MAX_PEOPLE} people; address a role instead` } };
  let members;
  try { members = await ctx.members(); } catch { members = null; }
  if (!Array.isArray(members)) return { refuse: { ok: false, status: 502, error: "staff_unreadable", detail: "the staff list could not be read, so the named people could not be checked. Nothing was sent." } };
  const byId = new Map(members.filter((m) => m && m.active !== false).map((m) => [str(m.identity), m]));
  const people = [], refused = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) refused.push({ identity: id, label: id, reason: "not_member" });
    else if (!roleMayRead(str(m.role), patientBound)) refused.push({ identity: id, label: memberLabel(m), reason: "cannot_read" });
    else people.push({ identity: id, label: memberLabel(m) });
  }
  if (refused.length) return { refuse: { ok: false, status: 422, error: "people_refused", refused,
    detail: `not sent. These people cannot be addressed (not an active member of this hospital, or their role may not see this ${patientBound ? "patient" : "thread"}): ${refused.map((r) => r.label).join(", ")}` } };
  return { people };
}

/** GET /ward/staff-message-people. Active members who may be named on a patient thread, label and role only. */
async function listMessagePeople(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", people: [] };
  const { resolved, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let members;
  try { members = await ctx.members(); } catch { members = null; }
  if (!Array.isArray(members)) return { ...base, ok: false, status: 502, error: "staff_unreadable" };
  const people = members.filter((m) => m && m.active !== false && str(m.identity) !== resolved.actor.id && roleMayRead(str(m.role), true))
    .map((m) => ({ identity: str(m.identity), label: memberLabel(m), role: str(m.role) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { ...base, ok: true, people };
}

/** Read marks for these threads by this reader: Map(threadId -> lastReadAt). Throws when unreadable. */
async function myReads(svc, me, patientId) {
  const rows = patientId ? await svc.byPatient(READ, patientId) : await svc.list(READ, SCAN);
  const out = new Map();
  for (const r of rows || []) if (r && r.readerId === me) out.set(r.threadId, r.lastReadAt);
  return { reads: out, partial: !patientId && (rows || []).length >= SCAN };
}
/** Everybody's read marks on one thread: Map(readerId -> lastReadAt). */
async function threadReads(svc, msg) {
  const rows = msg.patientId ? await svc.byPatient(READ, msg.patientId) : await svc.list(READ, SCAN);
  return new Map((rows || []).filter((r) => r && r.threadId === msg.threadId).map((r) => [r.readerId, r.lastReadAt]));
}

/**
 * POST /ward/staff-message-send. ctx: { migration, threadId? | (patientId, encounterId?) | unit, subject?, body,
 * toRoles?, toPeople? (member identities), urgent?, push, members }
 */
async function sendStaffMessage(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const body = String(ctx.body == null ? "" : ctx.body).replace(/\r\n/g, "\n").trim();
  const bad = textRefusal(body);
  if (bad) return { ...base, ok: false, status: 422, ...bad, written: 0 };
  const toRoles = Array.isArray(ctx.toRoles) ? [...new Set(ctx.toRoles.map(str).filter(Boolean))] : [];
  const unknown = toRoles.filter((r) => !ROLES.includes(r));
  if (unknown.length) return { ...base, ok: false, status: 422, error: "role_unknown", detail: `not a role here: ${unknown.join(", ")}`, written: 0 };
  const toPeopleIds = Array.isArray(ctx.toPeople) ? [...new Set(ctx.toPeople.map(str).filter(Boolean))] : [];

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let binding;
  const threadId = str(ctx.threadId);
  if (threadId) {
    const got = await loadMessage(svc, threadId, resolved.actor.id);
    if (got.refuse) return { ...base, ...got.refuse, written: 0 };
    const root = got.msg;
    if (root.threadId !== root.id) return { ...base, ok: false, status: 422, error: "not_a_thread", detail: "reply to the first message of a thread", written: 0 };
    binding = { threadId, patientId: root.patientId, encounterId: root.encounterId, unit: root.unit, subject: root.subject, toRoles: root.toRoles || [], toPeople: root.toPeople || [] };
  } else {
    const patientId = str(ctx.patientId), unit = str(ctx.unit).slice(0, 60);
    if (!!patientId === !!unit) return { ...base, ok: false, status: 422, error: "binding_required", detail: "a thread is about one patient or one unit, not both and not neither", written: 0 };
    const subject = str(ctx.subject).slice(0, MAX_SUBJECT);
    if (!subject) return { ...base, ok: false, status: 422, error: "subject_required", written: 0 };
    let encounterId = null;
    if (patientId) {
      const g = await patientGate(svc, patientId);
      if (!g.ok) return { ...base, ...g, written: 0 };
      encounterId = str(ctx.encounterId) || null;
      if (encounterId) {
        let enc = null;
        try { enc = await svc.get("Encounter", encounterId); } catch { enc = null; }
        if (!enc || str(enc.patientId) !== patientId) return { ...base, ok: false, status: 409, error: "encounter_mismatch", detail: "that stay is not this patient's", written: 0 };
      }
    }
    const named = await resolvePeople(ctx, toPeopleIds, !!patientId);
    if (named.refuse) return { ...base, ...named.refuse, written: 0 };
    binding = { threadId: null, patientId: patientId || null, encounterId, unit: unit || null, subject, toRoles, toPeople: named.people };
  }
  const nowMs = Date.now(), sentAt = new Date(nowMs).toISOString();
  const id = `wsq-smsg-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const msg = {
    resourceType: MSG, id, threadId: binding.threadId || id,
    patientId: binding.patientId, encounterId: binding.encounterId, unit: binding.unit, subject: binding.subject, toRoles: binding.toRoles, toPeople: binding.toPeople,
    body, urgent: ctx.urgent === true, from: resolved.actor.id, fromName: actorName(resolved.actor), fromRole: resolved.role || null, sentAt,
    editedAt: null, recalled: null, escalations: [],
    source: { system: "wardsynq-native", sourceId: "staff-messaging" },
  };
  let version;
  try { version = (await svc.put(msg, { idempotencyKey: ctx.idempotencyKey || null })).record.version; }
  catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  const out = { ...base, ok: true, written: 1, messageId: id, threadId: msg.threadId, version };
  if (msg.urgent) {
    // The sender has read their own thread; nobody else has yet, so no read marks are needed for a new message.
    const esc = await escalate(svc, ctx, msg, version, resolved.actor.id, null);
    out.escalation = esc.escalation;
    if (!esc.ok) out.escalationNotRecorded = true;
  }
  return out;
}

/** Author-only change to a message: an edit or a recall, as a new version. */
async function authorChange(request, env, ctx, change) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const got = await loadMessage(svc, str(ctx.messageId), resolved.actor.id);
  if (got.refuse) return { ...base, ...got.refuse, written: 0 };
  if (got.msg.from !== resolved.actor.id) return { ...base, ok: false, status: 403, error: "not_author", detail: "only the person who sent a message may change it", written: 0 };
  if (got.msg.recalled) return { ...base, ok: false, status: 409, error: "recalled", detail: "this message was recalled", written: 0 };
  if (ctx.expectedVersion != null && Number(ctx.expectedVersion) !== got.version) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
  const next = change(got.msg, resolved.actor.id);
  if (next.refuse) return { ...base, ok: false, status: 422, ...next.refuse, written: 0 };
  try {
    const put = await svc.put(next, { expectedVersion: got.version });
    return { ...base, ok: true, written: 1, messageId: next.id, version: put.record.version };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

/** POST /ward/staff-message-edit. ctx: { messageId, body, expectedVersion? }. The earlier text stays in the record's history. */
function editStaffMessage(request, env, ctx) {
  const body = String(ctx.body == null ? "" : ctx.body).replace(/\r\n/g, "\n").trim();
  return authorChange(request, env, ctx, (msg) => {
    const bad = textRefusal(body);
    if (bad) return { refuse: bad };
    return { ...msg, body, editedAt: new Date().toISOString() };
  });
}

/** POST /ward/staff-message-recall. ctx: { messageId, reason }. Kept in the record; hidden on the list. */
function recallStaffMessage(request, env, ctx) {
  const reason = str(ctx.reason).slice(0, 300);
  return authorChange(request, env, ctx, (msg, by) => (reason.length < 5
    ? { refuse: { error: "reason_required", detail: "say why the message is recalled" } }
    : { ...msg, recalled: { by, at: new Date().toISOString(), reason } }));
}

/** POST /ward/staff-message-read. ctx: { threadId }. The caller has now read the thread. */
async function markThreadRead(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const got = await loadMessage(svc, str(ctx.threadId), resolved.actor.id);
  if (got.refuse) return { ...base, ...got.refuse, written: 0 };
  const me = resolved.actor.id;
  const id = `${got.msg.threadId}.read.${me.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60)}`;
  let cur = null;
  try { cur = await svc.get(READ, id); } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", written: 0 }; }
  const lastReadAt = new Date().toISOString();
  const row = { resourceType: READ, id, threadId: got.msg.threadId, patientId: got.msg.patientId || null, readerId: me, lastReadAt, source: { system: "wardsynq-native", sourceId: "staff-messaging" } };
  try {
    const put = await svc.put(row, cur ? { expectedVersion: cur.version } : {});
    return { ...base, ok: true, written: 1, threadId: got.msg.threadId, lastReadAt, version: put.record.version };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

/** POST /ward/staff-message-escalate. ctx: { messageId, push, members }. Pushes to addressees who have not read it. */
async function escalateStaffMessage(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const got = await loadMessage(svc, str(ctx.messageId), resolved.actor.id);
  if (got.refuse) return { ...base, ...got.refuse, written: 0 };
  if (got.msg.recalled) return { ...base, ok: false, status: 409, error: "recalled", written: 0 };
  if (!(got.msg.toRoles || []).length && !(got.msg.toPeople || []).length) return { ...base, ok: false, status: 422, error: "no_addressees", detail: "this thread is addressed to no role and no person, so there is nobody to alert", written: 0 };
  let reads;
  try { reads = await threadReads(svc, got.msg); } catch { return { ...base, ok: false, status: 502, error: "record_read_failed", written: 0 }; }
  const out = await escalate(svc, ctx, got.msg, got.version, resolved.actor.id, reads);
  return { ...base, ...out, written: out.ok ? 1 : 0 };
}

/** PURE. A message as the list shows it: a recalled message keeps who, when and why, never its text. */
function shown(m) {
  return { messageId: m.id, threadId: m.threadId, body: m.recalled ? null : m.body, from: m.from, fromName: m.fromName || null, fromRole: m.fromRole || null,
    sentAt: m.sentAt, editedAt: m.editedAt || null, recalled: m.recalled || null, urgent: !!m.urgent, escalations: m.escalations || [], version: m.version };
}

/** PURE. Messages grouped into threads, newest activity first, with unread counts for `me`. */
function threadsOf(messages, reads, me, myRole) {
  const byThread = new Map();
  for (const m of messages || []) {
    if (!m || !m.threadId) continue;
    if (!byThread.has(m.threadId)) byThread.set(m.threadId, []);
    byThread.get(m.threadId).push(m);
  }
  const out = [];
  for (const [threadId, list] of byThread) {
    list.sort((a, b) => str(a.sentAt).localeCompare(str(b.sentAt)));
    const root = list.find((m) => m.id === threadId);
    if (!root) continue; // a reply whose first message is outside this page is shown with its thread, or not at all
    if (!openTo(root, me)) continue; // addressed only to named people, and `me` is not one of them
    const last = str(reads.get(threadId));
    const unread = list.filter((m) => m.from !== me && !m.recalled && str(m.sentAt) > last).length;
    const toRoles = root.toRoles || [], toPeople = root.toPeople || [];
    out.push({
      threadId, subject: root.subject, patientId: root.patientId || null, encounterId: root.encounterId || null, unit: root.unit || null,
      toRoles, toPeople,
      forMe: (!toRoles.length && !toPeople.length) || toRoles.includes(myRole) || toPeople.some((p) => p && p.identity === me) || list.some((m) => m.from === me),
      startedBy: root.from, startedAt: root.sentAt, lastAt: list[list.length - 1].sentAt, unread, lastReadAt: last || null,
      messages: list.map(shown),
    });
  }
  return out.sort((a, b) => str(b.lastAt).localeCompare(str(a.lastAt)));
}

/**
 * GET /ward/staff-messages. ctx: { patientId? | unit? | view: "mine"|"all" }. A patient's threads are read after the
 * patient is read as the caller. The hospital-wide list shows a patient thread only to a role that may read patients.
 */
async function listStaffMessages(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", threads: [] };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  const patientId = str(ctx.patientId), unit = str(ctx.unit), me = resolved.actor.id;
  let rows, partial = false;
  if (patientId) {
    const g = await patientGate(svc, patientId);
    if (!g.ok) return { ...base, ...g };
    try { rows = await svc.byPatient(MSG, patientId); } catch { return { ...base, ok: false, status: 502, error: "record_read_failed" }; }
  } else {
    try { rows = await svc.list(MSG, SCAN); } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed" }; }
    partial = (rows || []).length >= SCAN;
    const scopeRead = resolved.actor.scope && resolved.actor.scope.read;
    const seesPatients = scopeRead === null || (Array.isArray(scopeRead) && scopeRead.includes("Patient"));
    rows = (rows || []).filter((m) => m && (m.patientId ? seesPatients : true) && (!unit || m.unit === unit));
  }
  let reads;
  try { reads = await myReads(svc, me, patientId || null); } catch { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "read marks could not be loaded" }; }
  let threads = threadsOf(rows, reads.reads, me, resolved.role);
  if (ctx.view === "mine") threads = threads.filter((t) => t.forMe);
  const labels = await patientLabels(svc, threads.filter((t) => t.patientId));
  for (const t of threads) if (t.patientId) t.patient = labels.get(labelKey(t)) || null;
  return { ...base, ok: true, me, role: resolved.role || null, threads, unread: threads.reduce((n, t) => n + t.unread, 0),
    ...(partial || reads.partial ? { partial: true, warning: `Only the newest ${SCAN} messages were checked. Older threads may be missing.` } : {}) };
}

export {
  MSG, READ, MAX_BODY, MAX_PEOPLE, SCAN, messagePushPayload, textRefusal, threadsOf, shown, openTo, roleMayRead,
  sendStaffMessage, listMessagePeople, editStaffMessage, recallStaffMessage, markThreadRead, escalateStaffMessage, listStaffMessages,
};
