/* functions/_queue_notify.js — Smart OPD Queue patient notifications. Reuses the FollowCare SMS/WhatsApp
 * senders + the shared i18n engine; logs its own PHI-free delivery events into q_events (NOT fc_delivery).
 * PHI-light: message bodies carry NO patient name/MRN — only dept, doctor, the OPD token, an opaque link, counts/times.
 *
 * Idempotency: position tiers use ONE MONOTONIC stage counter on the ticket (n_stage: 0→ahead5(1)→
 * ahead2(2)→next(3)) so advancing never re-sends or back-sends a lower tier (a patient added straight at
 * position 2 sends ahead2 and skips ahead5). registered/complete use their own one-shot booleans.
 * pendingEvent() is PURE and unit-tested; the sender is thin best-effort I/O.
 */
import I18n from "../followcare-i18n.js";
import { sendSms, smsConfigured } from "./_followcare_sms.js";
import { sendWhatsApp, waConfigured } from "./_followcare_whatsapp.js";
import { decPHI, mintTicketToken } from "./_queue.js";
import { fsCommit, wUpdate } from "./_fbfirestore.js";
import { writeOrgAudit } from "./_q_audit_chain.js";
import { quotaOn, quotaKv, consumeVisit } from "./_quota.js";
import { getEntitlement } from "./_entitlements.js";

var DEFAULT_THRESHOLDS = { early: 5, prep: 2 };
var STAGE = { ahead5: 1, ahead2: 2, next: 3 };   // monotonic position tiers
var BOOL = { registered: "n_reg", complete: "n_complete" };   // one-shot; delayed has neither (always sends)

// PURE: the single position event to fire NOW for a queued ticket, given its monotonic stage. "" = none.
export function pendingEvent(ticket, cfg) {
  cfg = cfg || {};
  var early = cfg.early || DEFAULT_THRESHOLDS.early, prep = cfg.prep || DEFAULT_THRESHOLDS.prep;
  var p = ticket.position || 0, stage = ticket.n_stage || 0;
  if (p <= 0) return "";                                  // not queued (in consult / terminal)
  if (p === 1 && stage < STAGE.next) return "next";
  if (p <= prep && stage < STAGE.ahead2) return "ahead2";
  if (p <= early && stage < STAGE.ahead5) return "ahead5";
  return "";
}

/* Plan item 14: "the doctor is running late", with the new estimate. The queue.msg.delayed template existed and
 * nothing sent it. It goes when the doctor is away from consulting (break, emergency, procedure, meeting, or the
 * session paused), or when a patient's estimate has slipped DELAY.slipMin past the one they were last given
 * (n_etaTold, first taken at their first recompute). Never to the next patient (their own message says come in),
 * at most one per DELAY.gapMs and DELAY.max per visit, so a long day is news, not noise. PURE. */
export var DELAY = { slipMin: 20, gapMs: 30 * 60000, max: 3 };
var AWAY = { "break": 1, emergency: 1, procedure: 1, meeting: 1 };
export function doctorAway(session) { return !!(session && (AWAY[session.doctorStatus] || session.status === "paused")); }
export function delayDue(ticket, nowMs, away) {
  var s = ticket.status;
  if (s !== "registered" && s !== "waiting" && s !== "called") return false;
  if ((ticket.position || 0) <= 1) return false;
  if ((ticket.n_delays || 0) >= DELAY.max || nowMs - (ticket.n_delayAt || 0) < DELAY.gapMs) return false;
  if (away) return true;
  var told = ticket.n_etaTold || 0;
  return !!(told && ticket.etaStart && ticket.etaStart - told >= DELAY.slipMin * 60000);
}
// The estimate as a clock time the patient can plan by. ponytail: IST; a per-hospital time zone when one exists.
export function clockTime(ms, tz) {
  try { return new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: tz || "Asia/Kolkata" }); } catch (e) { return ""; }
}

async function linkUrl(env, ticket) {
  var base = (env && env.QUEUE_LINK_BASE) || "https://stewardmd.in";
  var tok = await mintTicketToken(env, ticket.id, ticket.expiresAt || (Date.now() + 12 * 3600e3), ticket.tokenVer || 1);
  return base.replace(/\/+$/, "") + "/queue?t=" + tok;
}
/* Channel order for QUEUE messages. WhatsApp first whenever it is configured, SMS only as the
 * fallback, because a WhatsApp utility message costs a fraction of an SMS and the queue sends 3 to 5
 * of them per patient. This is deliberately NOT FollowCare's default (that one is sms-first and stays
 * that way): QUEUE_MSG_CHANNEL overrides for the queue alone, then FOLLOWCARE_MSG_CHANNEL, and
 * setting either to "sms" forces SMS.
 *
 * HONEST LIMIT: nothing in the codebase knows whether a given patient is actually reachable on
 * WhatsApp. There is no per-patient channel preference on the ticket, no capability lookup, and the
 * provider does not report it (see the report accompanying this change). So "WhatsApp first" is a
 * per-SEND attempt-then-fall-back, not a per-patient routing decision: we try WhatsApp, and a failed
 * send drops to SMS. A real per-patient signal would need either a stored preference captured at
 * registration or a provider capability check before the send. */
function queueChannel(env) {
  var c = String((env && (env.QUEUE_MSG_CHANNEL || env.FOLLOWCARE_MSG_CHANNEL)) || "whatsapp").toLowerCase();
  return c === "sms" ? "sms" : "whatsapp";
}
async function send(env, toE164, body, link) {
  var payload = { toE164: toE164, body: body, vars: { link: link, text: body } };
  // WhatsApp first (when configured); if that send fails or the patient isn't on WhatsApp, fall back to
  // SMS (2Factor). Otherwise SMS is the primary channel.
  if (queueChannel(env) === "whatsapp" && waConfigured(env)) {
    var wa; try { wa = await sendWhatsApp(env, payload); } catch (e) { wa = { ok: false, reason: "wa_exception" }; }
    if (wa && wa.ok) return Object.assign({ channel: "whatsapp" }, wa);
    if (smsConfigured(env)) return Object.assign({ channel: "sms", waFellBack: true }, await sendSms(env, payload));
    return Object.assign({ channel: "whatsapp" }, wa);
  }
  return Object.assign({ channel: "sms" }, await sendSms(env, payload));
}
/* Clinic Messaging meter. ONE unit per patient per visit: the ticket id is the visit, so the first
 * message of a visit charges and every later message of the SAME visit is free (see consumeVisit in
 * functions/_quota.js). Returns true when the message may go out.
 *
 * Running out never blocks the queue: the doctor keeps seeing patients, positions and ETAs keep
 * recomputing, only the outbound patient messages pause. It is also fail-open at every step - meter
 * off, no doctor uid, no KV, or a thrown read all let the message through - because a billing lookup
 * must never be the reason a waiting patient is left uninformed. */
async function chargeVisit(env, session, ticket) {
  try {
    if (!quotaOn(env)) return true;
    var uid = (session && session.doctorUid) || "";
    var kv = quotaKv(env);
    if (!uid || !kv || !ticket || !ticket.id) return true;
    var ent = null;
    try { ent = await getEntitlement(env, uid); } catch (e) { ent = null; }
    var r = await consumeVisit(env, kv, uid, ticket.id, {
      role: ent && ent.role, msgTier: ent && ent.msgTier, msgTierExp: ent && ent.msgTierExp,
    });
    return !!(r && r.ok);
  } catch (e) { return true; }
}

function mask(p) { var d = String(p || "").replace(/\D/g, ""); return d.length >= 4 ? "•••••" + d.slice(-4) : "••••"; }
async function auditNotify(env, session, ticket, event, res, masked) {
  await writeOrgAudit(env, { hospitalId: session.hospitalId || "", ticketId: ticket.id, actor: "system", action: "notify:" + event, meta: (res.ok ? "sent " : res.skipped ? "skipped " : "failed ") + masked });
}

// Send the sealed visit-timeline link to the patient at checkout (channel = FOLLOWCARE_MSG_CHANNEL,
// WhatsApp for now). Best-effort; skips silently when the ticket has no mobile yet.
export async function notifyTimeline(env, session, ticket, url) {
  var mobile = "";
  try { mobile = await decPHI(env, ticket.encMobile); } catch (e) {}
  if (!mobile) return { skipped: true, reason: "no_phone" };
  if (!(await chargeVisit(env, session, ticket))) return { skipped: true, reason: "quota-exhausted" };
  var doctor = session.doctorName || "your doctor";
  var body = "Your visit summary from " + doctor + " is ready. View it here (private link, valid 7 days): " + url;
  var res;
  try { res = await send(env, mobile, body, url); } catch (e) { res = { ok: false, reason: "exception" }; }
  await auditNotify(env, session, ticket, "timeline", res, mask(mobile));
  return res;
}

// Send one event for one ticket (idempotent, best-effort — never throws to the caller).
export async function notifyTicket(env, session, ticket, event, vars) {
  vars = vars || {};
  var stageNum = STAGE[event], boolFlag = BOOL[event];
  if (stageNum && (ticket.n_stage || 0) >= stageNum) return { skipped: true, reason: "already_sent" };
  if (boolFlag && ticket[boolFlag]) return { skipped: true, reason: "already_sent" };
  var mobile = "";
  try { mobile = await decPHI(env, ticket.encMobile); } catch (e) {}
  // No number yet (e.g. a GHIS-imported ticket before the lazy demographics lookup): skip WITHOUT
  // marking, so the tier fires once a mobile is attached. No send attempt = no spam (just a cheap re-check).
  if (!mobile) return { skipped: true, reason: "no_phone" };
  // Out of messaging allowance: skip WITHOUT marking the stage, exactly like the no-phone case, so the
  // tier still fires for this patient the moment the doctor tops up. Never throws, never blocks.
  if (!(await chargeVisit(env, session, ticket))) return { skipped: true, reason: "quota-exhausted" };
  var res;
  try {
    var link = await linkUrl(env, ticket);
    var body = I18n.t("queue.msg." + event, ticket.lang || "en", {
      dept: ticket.department || session.department || "the clinic", doctor: session.doctorName || "", link: link,
      ahead: vars.ahead != null ? vars.ahead : Math.max(0, (ticket.position || 1) - 1), eta: vars.eta || ""
    });
    if (ticket.token && (event === "registered" || event === "next")) body = I18n.t("queue.msg.token", ticket.lang || "en", { token: ticket.token }) + " " + body;
    res = await send(env, mobile, body, link);
  } catch (e) { res = { ok: false, reason: "exception" }; }
  // Mark the tier attempted (we had a number) so it never re-fires; audit masked. Best-effort writes.
  var patch = { updatedAt: Date.now() };
  if (stageNum) patch.n_stage = stageNum;
  if (boolFlag) patch[boolFlag] = true;
  if (event === "delayed") { patch.n_delays = (ticket.n_delays || 0) + 1; patch.n_delayAt = Date.now(); patch.n_etaTold = ticket.etaStart || 0; Object.assign(ticket, { n_delays: patch.n_delays, n_delayAt: patch.n_delayAt, n_etaTold: patch.n_etaTold }); }
  try { await fsCommit(env, [wUpdate(env, "q_tickets/" + ticket.id, patch)]); } catch (e) {}
  if (stageNum) ticket.n_stage = stageNum;
  if (boolFlag) ticket[boolFlag] = true;
  await auditNotify(env, session, ticket, event, res, mask(mobile));
  return res;
}

// Fire position events across the queue after a recompute (best-effort, sequential — OPD queues are
// small). registered/complete/delayed are fired explicitly by the engine at their moments.
export async function runQueueNotifications(env, session, tickets, cfg) {
  for (var i = 0; i < tickets.length; i++) {
    var t = tickets[i];
    if (t.status !== "registered" && t.status !== "waiting" && t.status !== "called") continue;
    var ev = pendingEvent(t, cfg);
    if (ev) { try { await notifyTicket(env, session, t, ev, { ahead: Math.max(0, (t.position || 1) - 1) }); } catch (e) {} }
    // Plan item 14: the estimate a patient was first shown is the baseline a later slip is measured from.
    if (!t.n_etaTold && t.etaStart) { t.n_etaTold = t.etaStart; try { await fsCommit(env, [wUpdate(env, "q_tickets/" + t.id, { n_etaTold: t.etaStart })]); } catch (e) {} }
    else if (delayDue(t, Date.now(), doctorAway(session))) { try { await notifyTicket(env, session, t, "delayed", { eta: clockTime(t.etaStart) }); } catch (e) {} }
  }
}
