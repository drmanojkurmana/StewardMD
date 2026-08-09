/* functions/_queue_notify.js — Smart OPD Queue patient notifications. Reuses the FollowCare SMS/WhatsApp
 * senders + the shared i18n engine; logs its own PHI-free delivery events into q_events (NOT fc_delivery).
 * PHI-light: message bodies carry NO patient name/MRN — only dept, doctor, an opaque link, counts/times.
 *
 * Idempotency: position tiers use ONE MONOTONIC stage counter on the ticket (n_stage: 0→ahead5(1)→
 * ahead2(2)→next(3)) so advancing never re-sends or back-sends a lower tier (a patient added straight at
 * position 2 sends ahead2 and skips ahead5). registered/complete use their own one-shot booleans.
 * pendingEvent() is PURE and unit-tested; the sender is thin best-effort I/O.
 */
import I18n from "../followcare-i18n.js";
import { sendSms } from "./_followcare_sms.js";
import { sendWhatsApp, waConfigured } from "./_followcare_whatsapp.js";
import { decPHI, mintTicketToken } from "./_queue.js";
import { fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";

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

async function linkUrl(env, ticket) {
  var base = (env && env.QUEUE_LINK_BASE) || "https://stewardmd.in";
  var tok = await mintTicketToken(env, ticket.id, ticket.expiresAt || (Date.now() + 12 * 3600e3), ticket.tokenVer || 1);
  return base.replace(/\/+$/, "") + "/queue?t=" + tok;
}
async function send(env, toE164, body, link) {
  var payload = { toE164: toE164, body: body, vars: { link: link, text: body } };
  // Match FollowCare: use WhatsApp only when it's actually configured, else fall back to SMS.
  if (String(env.FOLLOWCARE_MSG_CHANNEL || "sms").toLowerCase() === "whatsapp" && waConfigured(env)) {
    try { return await sendWhatsApp(env, payload); } catch (e) { return { ok: false, reason: "wa_exception" }; }
  }
  return sendSms(env, payload);
}
function mask(p) { var d = String(p || "").replace(/\D/g, ""); return d.length >= 4 ? "•••••" + d.slice(-4) : "••••"; }
async function auditNotify(env, session, ticket, event, res, masked) {
  var id = crypto.randomUUID().replace(/-/g, "");
  var f = { ts: Date.now(), hospitalId: session.hospitalId || "", ticketId: ticket.id, actor: "system", action: "notify:" + event, meta: (res.ok ? "sent " : res.skipped ? "skipped " : "failed ") + masked };
  try { await fsCommit(env, [wCreate(env, "q_events/" + id, f)]); } catch (e) {}
}

// Send the sealed visit-timeline link to the patient at checkout (channel = FOLLOWCARE_MSG_CHANNEL,
// WhatsApp for now). Best-effort; skips silently when the ticket has no mobile yet.
export async function notifyTimeline(env, session, ticket, url) {
  var mobile = "";
  try { mobile = await decPHI(env, ticket.encMobile); } catch (e) {}
  if (!mobile) return { skipped: true, reason: "no_phone" };
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
  var res;
  try {
    var link = await linkUrl(env, ticket);
    var body = I18n.t("queue.msg." + event, ticket.lang || "en", {
      dept: session.department || "the clinic", doctor: session.doctorName || "", link: link,
      ahead: vars.ahead != null ? vars.ahead : Math.max(0, (ticket.position || 1) - 1), eta: vars.eta || ""
    });
    res = await send(env, mobile, body, link);
  } catch (e) { res = { ok: false, reason: "exception" }; }
  // Mark the tier attempted (we had a number) so it never re-fires; audit masked. Best-effort writes.
  var patch = { updatedAt: Date.now() };
  if (stageNum) patch.n_stage = stageNum;
  if (boolFlag) patch[boolFlag] = true;
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
  }
}
