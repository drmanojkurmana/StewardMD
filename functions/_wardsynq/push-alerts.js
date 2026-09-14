/* functions/_wardsynq/push-alerts.js — a critical result reaches a phone, and only its detail is fetched.
 *
 * S3 P0 (design sections 3.2 to 3.7). Before this every server caller of openCriticalLoops and runTick
 * passed notifyDeps: {} and every loop recorded NO_CHANNEL: no critical result reached any phone.
 *
 * THIN PAYLOAD. What crosses APNs and FCM is a fixed title, a body naming only the ward and bed, and
 * five data keys: type, v, nid, kind, urgency. Never the patient name or MRN (owner decision O3, which
 * allows ward and bed), never a patient id, test, value or hospital. The nid is a random 128-bit id;
 * the detail is fetched after unlock from GET /api/push/notice/<nid>, which answers only the people the
 * notice was addressed to, in the hospital it belongs to.
 *
 * SMS WHEN NO PHONE CONFIRMS (owner decision O4). A notice no handset has receipted as delivered within
 * its level's window is sent once by SMS to the recipients' alert mobiles, by the hospital's DLT
 * template, with the same rule: ward and bed only. Not configured is recorded and shown, never skipped.
 *
 * SENT IS NOT DELIVERED. The channel returns delivered:false even when every gateway accepted, exactly
 * as wardsynq-notify.js and wardsynq-mobile-channel.js insist. Delivery is the handset's receipt, and
 * acknowledgement is the clinical act at /ward/acknowledge. Nothing here acknowledges anything.
 *
 * EVERYTHING IS ON THE LOOP RECORD. Each dispatch appends a notice (nid, level, recipients, noDevice,
 * sent, total, receipts) to loop.notifications; receipts and declines are appended there too, with an
 * audit row naming who. KV holds only the nid pointer and the device index (device-directory.js).
 *
 * Pure over ports: repository, directory, readers, sendToTokens. No Cloudflare, no Firestore here.
 */

import { VersionConflictError } from "./repository.js";
import { escalationOf } from "./critical-results.js";
import { LEVELS, resolveRecipients, nextLevel, levelsFor, level2NurseRuleOf, DEFAULT_LEVELS } from "./alert-recipients.js";
import { Dispatcher, NotifyError } from "../../wardsynq/wardsynq-notify.js";
import { ReadLog, READ_KIND } from "../../wardsynq/wardsynq-readlog.js";
import { ClinicalRead, readIdFor } from "./read-log.js";

const str = (v) => (v == null ? "" : String(v).trim());
const LOOP = "CriticalResultLoop";

/* Titles come from this table and nowhere else: free text never enters a payload. */
const PUSH_TITLES = Object.freeze({
  critical: "WardSynQ: urgent result",
  deterioration: "WardSynQ: patient needs review",
  sepsis: "WardSynQ: sepsis alert",
  bundle: "WardSynQ: care bundle due",
  test: "WardSynQ: test alert",
});
const PAYLOAD_KEYS = Object.freeze(["type", "v", "nid", "kind", "urgency"]);
const RECEIPT_KINDS = Object.freeze(["delivered", "viewed", "informed"]);

/** PURE. A ward or bed label as it may appear on a lock screen: short, printable, nothing else. */
const place = (v) => str(v).replace(/[^\p{L}\p{N} .,/#()-]/gu, "").slice(0, 40);

/** PURE. The whole push. `data` carries PAYLOAD_KEYS and nothing else; the text names ward and bed only. */
function thinPayload(kind, nid, location) {
  const k = PUSH_TITLES[kind] ? kind : "critical";
  const ward = place(location && location.ward), bed = place(location && location.bed);
  const where = [ward && "Ward " + ward, bed && "bed " + bed].filter(Boolean).join(", ");
  return {
    title: PUSH_TITLES[k], body: (where ? where + ". " : "") + "Open StewardMD to view.", tag: "wsq-alert",
    data: { type: "wardsynq-alert", v: "2", nid: str(nid), kind: k, urgency: "high" },
  };
}

function randomNid() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The Dispatcher channel. deps: { orgId, tenantId, policy, readers, directory, sendToTokens(tokenIds, msg) }
 *
 * The payload the caller hands the Dispatcher carries { loopId, patientId, reportId, encounterId,
 * level | escalation, notices: [] }; the notice this dispatch made is pushed onto payload.notices so
 * the caller writes it on the loop. A retry of the same payload returns the first answer and sends
 * nothing twice: Dispatcher retries a channel that did not deliver, and SENT is never delivered.
 */
function serverPushChannel(deps) {
  const done = new WeakMap();
  return async function sendToPhones(payload) {
    if (done.has(payload)) return done.get(payload);
    const level = str(payload.level || payload.escalation) || "due";
    const at = new Date().toISOString();
    const loop = { id: payload.loopId, reportId: payload.reportId, encounterId: payload.encounterId };
    const who = await resolveRecipients({ orgId: deps.orgId, loop, level, policy: deps.policy }, deps.readers);
    const notice = { nid: null, kind: "critical", level, at, recipients: who.recipients, noDevice: [], sent: 0, total: 0, receipts: [] };
    // The named level-2 nurse rule that decided the nurses, with how many it found and the total resolved (owner decision 2026-09-14).
    if (who.nurseRule) notice.nurseRule = { ...who.nurseRule, recipients: who.recipients.length };
    let result;
    if (!who.recipients.length) {
      notice.reason = "NO_RECIPIENT";
      result = { delivered: false, detail: "NO_RECIPIENT: nobody could be resolved to tell about this result (no ordering clinician, nobody on duty in the unit with a listed role, no escalation contact)" };
    } else {
      const tokenIds = new Set();
      for (const r of who.recipients) {
        const ids = await deps.directory.devicesFor(deps.orgId, r.slice(deps.orgId.length + 1));
        if (!ids.length) notice.noDevice.push(r);
        ids.forEach((t) => tokenIds.add(t));
      }
      notice.nid = randomNid();
      // The pointer is written before anything is sent: a phone must never hold an nid that resolves to nothing.
      await deps.directory.putNotice(notice.nid, { orgId: deps.orgId, tenantId: deps.tenantId, loopId: payload.loopId });
      const out = tokenIds.size ? await deps.sendToTokens([...tokenIds], thinPayload("critical", notice.nid, who.location)) : { sent: 0, total: 0 };
      notice.sent = out.sent || 0;
      notice.total = out.total || 0;
      if (!notice.total) notice.reason = "NO_DEVICE";
      else if (out.disabled) notice.reason = "PUSH_NOT_CONFIGURED";
      result = {
        delivered: false, sent: notice.sent > 0, receipt: notice.nid,
        detail: !notice.total ? `none of the ${who.recipients.length} recipient(s) has a phone registered for alerts`
          : out.disabled ? "push is not configured on this server, so nothing was sent"
          : `sent to ${notice.sent} of ${notice.total} device(s) for ${who.recipients.length} recipient(s). That is SENT: no handset has confirmed and nobody has acknowledged`,
      };
    }
    if (Array.isArray(payload.notices)) payload.notices.push(notice);
    done.set(payload, result);
    return result;
  };
}

/** Attempts one level for a loop and returns what to record: { notification, notices }. Never throws. */
async function dispatchLevel(notifyDeps, loop, level) {
  const notices = [];
  let notification;
  try {
    const sent = await new Dispatcher(notifyDeps || {}).send({ loopId: loop.id, patientId: loop.patientId, reportId: loop.reportId || null, encounterId: loop.encounterId || null, code: loop.code, display: loop.display, value: loop.value, unit: loop.unit, level, escalation: level, notices }, undefined, { retries: 2 });
    notification = { attempted: true, delivered: sent.delivered, channels: sent.attempts.map((a) => ({ channel: a.channel, delivered: a.delivered, detail: a.detail })) };
  } catch (e) {
    notification = { attempted: true, delivered: false, reason: e instanceof NotifyError ? e.code : "NOTIFY_ERROR", detail: str(e && e.message).slice(0, 200) };
  }
  if (notices.some((n) => n.reason === "NO_RECIPIENT") && !notification.reason) notification.reason = "NO_RECIPIENT";
  return { notification, notices };
}

/** PURE. Minutes a level has before the next one takes over: the window a phone has to confirm. */
function levelWindowMinutes(level, policy) {
  const a = Number(policy && policy.acknowledgeWithinMinutes) || 30, b = Number(policy && policy.escalateAfterMinutes) || 60;
  return level === "overdue" ? Math.max(1, b - a) : a;
}

/** PURE. The nids on an open loop owed an SMS now: addressed to somebody, not yet tried by SMS, and no
 * handset has said delivered within the level window. A notice nobody was resolved for has nobody to text. */
function smsFallbackDue(loop, nowMs, policy) {
  if (!loop || loop.state !== "open") return [];
  return (loop.notifications || []).filter((n) => n && n.nid && !n.sms && (n.recipients || []).length
    && !(n.receipts || []).some((r) => r.kind === "delivered")
    && (nowMs - Date.parse(n.at)) >= levelWindowMinutes(n.level, policy) * 60000).map((n) => n.nid);
}

/**
 * The SMS fallback. deps: { readers: {latest, members}, sms: { send(toDigits, vars) -> {ok}, missing: [] } }
 * Returns (loop, nids) -> { [nid]: {at, sent, total, noMobile, reason?, missing?} }. Never throws.
 */
function smsFallbackSender(deps) {
  return async function smsFallback(loop, nids) {
    const at = new Date().toISOString();
    const out = {};
    const missing = (deps.sms && deps.sms.missing) || ["no SMS adapter"];
    let members = [], location = { ward: null, bed: null };
    try {
      members = (await deps.readers.members()) || [];
      const enc = loop.encounterId ? await deps.readers.latest("Encounter", loop.encounterId) : null;
      location = { ward: place(enc && enc.location && enc.location.ward) || null, bed: place(enc && enc.location && enc.location.bed) || null };
    } catch (e) { /* recorded per notice below as no mobile found */ }
    const mobileOf = new Map(members.filter((m) => m && m.active !== false && m.alertMobile).map((m) => [str(m.identity), str(m.alertMobile)]));
    for (const nid of nids) {
      const n = (loop.notifications || []).find((x) => x && x.nid === nid);
      const rec = { at, sent: 0, total: 0, noMobile: [] };
      const targets = [];
      for (const r of (n && n.recipients) || []) {
        const m = mobileOf.get(r.slice(r.indexOf("~") + 1));
        if (m) targets.push(m); else rec.noMobile.push(r);
      }
      rec.total = new Set(targets).size;
      if (missing.length) { out[nid] = { ...rec, reason: "SMS_NOT_CONFIGURED", missing }; continue; }
      if (!rec.total) { out[nid] = { ...rec, reason: "NO_MOBILE" }; continue; }
      for (const to of new Set(targets)) {
        try { const r = await deps.sms.send(to, { var1: location.ward || "-", var2: location.bed || "-" }); if (r && r.ok) rec.sent += 1; }
        catch (e) { /* counted as not sent */ }
      }
      out[nid] = rec.sent ? rec : { ...rec, reason: "SMS_FAILED" };
    }
    return out;
  };
}

function auditEvent(actorId, action, scope, at) {
  return { ts: at, actor: str(actorId), connectorId: "wardsynq", action, resourceCounts: null, scope, patientRefHash: null, outcome: "ok" };
}

/** Reads the loop and the addressed notice, or refuses with 404 for anyone it was not addressed to. */
async function addressed(ctx) {
  const loop = await ctx.repository.latest(ctx.tenantId, LOOP, ctx.pointer.loopId);
  const entry = loop && (loop.notifications || []).find((n) => n && n.nid === ctx.nid);
  const mine = entry && (entry.recipients || []).find((r) => (ctx.callerIds || []).includes(r));
  if (!entry || !mine) return { error: { ok: false, status: 404, error: "not_found" } };
  return { loop, entry, by: mine };
}

/** Appends a new loop version built by `change`, retrying a lost race a few times. */
async function appendLoop(ctx, change, audit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await addressed(ctx);
    if (got.error) return got.error;
    const out = await change(got);
    if (out.reply) return out.reply;
    try {
      await ctx.repository.append(ctx.tenantId, [{ ...out.next, version: got.loop.version + 1 }], { audit: audit(got) });
      return { ok: true, ...out.ok };
    } catch (e) {
      if (!(e instanceof VersionConflictError)) return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message) };
    }
  }
  return { ok: false, status: 409, error: "version_conflict", detail: "the loop kept changing; try again" };
}
const withNotice = (loop, nid, fn) => (loop.notifications || []).map((n) => (n && n.nid === nid ? fn(n) : n));

/**
 * The detail behind an nid, for its addressee. Writes a read-log row and an audit row in the same
 * append; if that write fails nothing is returned, because a critical result read with no record of
 * who read it is exactly what the audit trail exists to prevent.
 * ctx: { repository, tenantId, nid, pointer, callerIds, actorId, orgName, policy, nowMs }
 */
async function readNotice(ctx) {
  const got = await addressed(ctx);
  if (got.error) return got.error;
  const { loop, entry } = got;
  const [patient, encounter] = await Promise.all([
    loop.patientId ? ctx.repository.latest(ctx.tenantId, "Patient", loop.patientId) : null,
    loop.encounterId ? ctx.repository.latest(ctx.tenantId, "Encounter", loop.encounterId) : null,
  ]);
  const at = new Date(ctx.nowMs || Date.now()).toISOString();
  let read;
  try {
    const e = new ReadLog().record({ valueId: loop.id, version: loop.version, value: loop.value, by: ctx.actorId, kind: READ_KIND.OPENED, patientId: loop.patientId, at, context: "push-notice" });
    read = ClinicalRead({ ...e, id: readIdFor(loop.id, loop.version, ctx.actorId, at) });
    await ctx.repository.append(ctx.tenantId, [{ ...read, version: 1, writtenBy: { id: str(ctx.actorId), kind: "human", at } }],
      { audit: auditEvent(ctx.actorId, "record.read", { resourceType: LOOP, id: loop.id, via: "push-notice", nid: ctx.nid }, at) });
  } catch (e) {
    return { ok: false, status: 502, error: "read_log_failed", detail: "the read could not be recorded, so the detail was not released" };
  }
  const location = (encounter && encounter.location) || {};
  return {
    ok: true,
    notice: {
      nid: entry.nid, kind: entry.kind || "critical", level: entry.level, sentAt: entry.at,
      orgId: ctx.pointer.orgId, hospital: ctx.orgName || null,
      loopId: loop.id, state: loop.state, reportedAt: loop.reportedAt || null,
      escalation: escalationOf(loop, ctx.nowMs || Date.now(), ctx.policy),
      patient: { id: loop.patientId, name: (patient && patient.name) || null, mrn: (patient && patient.mrn) || null },
      location: { ward: location.ward || null, bed: location.bed || null },
      result: { code: loop.code, display: loop.display, value: loop.value, unit: loop.unit, basis: loop.basis },
      acknowledge: { route: "/api/queue/ward/acknowledge", loopId: loop.id, actionRequired: true },
    },
  };
}

/** A handset or a person saying what happened to this notice. Idempotent per (kind, recipient). */
async function receiptNotice(ctx) {
  const kind = str(ctx.kind);
  if (!RECEIPT_KINDS.includes(kind)) return { ok: false, status: 400, error: "bad_kind", detail: `kind is one of ${RECEIPT_KINDS.join(", ")}; acknowledging is done at /api/queue/ward/acknowledge with an action` };
  const at = new Date(ctx.nowMs || Date.now()).toISOString();
  return appendLoop(ctx, async ({ loop, entry, by }) => {
    if ((entry.receipts || []).some((r) => r.kind === kind && r.by === by)) return { reply: { ok: true, duplicate: true } };
    const receipt = { kind, by, at, device: str(ctx.device).slice(0, 120) || null };
    return { next: { ...loop, notifications: withNotice(loop, ctx.nid, (n) => ({ ...n, receipts: [...(n.receipts || []), receipt] })), writtenBy: { id: str(ctx.actorId), kind: "human", at } }, ok: { duplicate: false, kind } };
  }, ({ loop }) => auditEvent(ctx.actorId, "critical.notice." + kind, { resourceType: LOOP, id: loop.id, nid: ctx.nid }, at));
}

/**
 * "I cannot attend". Recorded on the notice, and the next level is told NOW rather than at its time.
 * ctx adds: notifyDeps. At the top level there is nobody further to tell: said, and the loop stays open.
 */
async function declineNotice(ctx) {
  const at = new Date(ctx.nowMs || Date.now()).toISOString();
  return appendLoop(ctx, async ({ loop, entry, by }) => {
    if (loop.state !== "open") return { reply: { ok: false, status: 409, error: "loop_not_open", detail: "this result has already been acknowledged; there is nothing to pass on" } };
    if ((entry.receipts || []).some((r) => r.kind === "declined" && r.by === by)) return { reply: { ok: true, duplicate: true } };
    const receipt = { kind: "declined", by, at, reason: str(ctx.reason).slice(0, 200) || null };
    const current = LEVELS[Math.max(0, LEVELS.indexOf(loop.escalatedLevel), LEVELS.indexOf(entry.level))];
    const level = nextLevel(current);
    // ponytail: a lost version race re-runs this and so re-sends the next tier; rare, and a duplicate push beats a lost one.
    let next = { ...loop, notifications: withNotice(loop, ctx.nid, (n) => ({ ...n, receipts: [...(n.receipts || []), receipt] })), writtenBy: { id: str(ctx.actorId), kind: "human", at } };
    if (level) {
      const d = await dispatchLevel(ctx.notifyDeps, loop, level);
      const minutesOpen = escalationOf(loop, ctx.nowMs || Date.now(), ctx.policy).minutesOpen;
      next = { ...next, escalatedLevel: level, notifications: [...next.notifications, ...d.notices],
        escalations: [...(loop.escalations || []), { level, at, minutesOpen, notification: d.notification, cause: "declined", declinedBy: by }] };
    }
    return { next, ok: { declined: true, escalatedTo: level, ...(level ? {} : { detail: "this was already the top of the ladder: nobody further is configured, and the result stays open on the board" }) } };
  }, ({ loop }) => auditEvent(ctx.actorId, "critical.notice.declined", { resourceType: LOOP, id: loop.id, nid: ctx.nid }, at));
}

/**
 * Who the ladder would tell NOW with no phone registered, read from the DeviceDirectory rather than from past
 * notices (which only name people an alert already went to): every active member on duty in any ward with a
 * role on some level, and every named contact. ctx: { orgId, directory, readers: {members, onDuty(unit)} }.
 * -> { ok: true, checked, noDevice: [{identity, role, why}], partial } or { ok: false, error }. Never throws.
 */
async function phoneCoverage(ctx, levels) {
  if (!ctx.directory || !ctx.readers) return { ok: false, error: "store_unavailable" };
  try {
    const roles = new Set(LEVELS.flatMap((k) => levels[k].roles));
    const members = (await ctx.readers.members()) || [];
    const active = new Map(members.filter((m) => m && m.active !== false).map((m) => [str(m.identity), str(m.role)]));
    const duty = roles.size ? await ctx.readers.onDuty("") : { onDuty: [] };
    if (!duty || duty.ok === false) return { ok: false, error: "rota_read_failed" };
    const people = new Map();
    for (const a of duty.onDuty || []) {
      const id = str(a.identity);
      if (roles.has(active.get(id))) people.set(id, { identity: id, role: active.get(id), why: "on duty" });
    }
    for (const id of new Set(LEVELS.flatMap((k) => levels[k].contacts))) if (!people.has(id)) people.set(id, { identity: id, role: active.get(id) || null, why: "named contact" });
    const noDevice = [];
    for (const p of people.values()) if (!(await ctx.directory.devicesFor(ctx.orgId, p.identity)).length) noDevice.push(p);
    return { ok: true, checked: people.size, noDevice, partial: !!duty.partial };
  } catch (e) {
    return { ok: false, error: "read_failed", detail: str(e && e.message).slice(0, 200) };
  }
}

/**
 * For the Admin Center: is the push path on, what ladder is in force, and which open loops told nobody.
 * Ids only: no patient, no value. ctx: { repository, tenantId, wsqCfg, actorId, smsMissing, orgId, directory, readers }
 */
async function alertDeliveryStatus(ctx) {
  const cfg = ctx.wsqCfg || {};
  const SCAN = 500;
  let loops;
  try { loops = await ctx.repository.latestByType(ctx.tenantId, LOOP, SCAN, { newest: true }); }
  catch (e) { return { ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) }; }
  const failures = [];
  const noDevice = new Map();
  for (const l of loops || []) {
    if (!l || l.state !== "open") continue;
    for (const n of l.notifications || []) {
      // A push that reached nobody but whose SMS went out did tell somebody: listed only if both failed.
      if (n && n.reason && !(n.sms && n.sms.sent)) failures.push({ loopId: l.id, level: n.level, at: n.at, reason: n.reason, recipients: (n.recipients || []).length });
      if (n && n.sms && n.sms.reason) failures.push({ loopId: l.id, level: n.level, at: n.sms.at, reason: n.sms.reason, recipients: (n.recipients || []).length, sms: true });
      for (const r of (n && n.noDevice) || []) noDevice.set(r, (noDevice.get(r) || 0) + 1);
    }
  }
  const at = new Date().toISOString();
  try { await ctx.repository.auditOnly(ctx.tenantId, auditEvent(ctx.actorId, "record.list", { resourceType: LOOP, purpose: "alert-delivery-status" }, at)); }
  catch (e) { return { ok: false, status: 502, error: "audit_write_failed" }; }
  const levels = levelsFor(cfg.criticalEscalation);
  return {
    ok: true,
    enabled: !!(cfg.alerts && cfg.alerts.push && cfg.alerts.push.enabled === true),
    levels, defaults: DEFAULT_LEVELS, nurseRule: level2NurseRuleOf(cfg.criticalEscalation),
    phones: await phoneCoverage(ctx, levels),
    minutes: { acknowledgeWithinMinutes: (cfg.criticalEscalation && cfg.criticalEscalation.acknowledgeWithinMinutes) || 30, escalateAfterMinutes: (cfg.criticalEscalation && cfg.criticalEscalation.escalateAfterMinutes) || 60 },
    failures: failures.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50),
    noDevice: [...noDevice].map(([identity, times]) => ({ identity, times })),
    sms: { ready: !(ctx.smsMissing || []).length, missing: ctx.smsMissing || [], senderId: (cfg.alerts && cfg.alerts.sms && cfg.alerts.sms.senderId) || "", templateName: (cfg.alerts && cfg.alerts.sms && cfg.alerts.sms.templateName) || "" },
    partial: (loops || []).length >= SCAN,
  };
}

export { PUSH_TITLES, PAYLOAD_KEYS, RECEIPT_KINDS, thinPayload, serverPushChannel, dispatchLevel, levelWindowMinutes, smsFallbackDue, smsFallbackSender, readNotice, receiptNotice, declineNotice, phoneCoverage, alertDeliveryStatus };
