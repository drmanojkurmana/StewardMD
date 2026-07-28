/* StewardMD · FollowCare AI — dispatch + daily scheduler (server).
 *
 * Turns the schedule into outbound check-in links and keeps episodes moving:
 *   • plan(episode, now)        — PURE decision: send today's link / send a reminder / nothing + missedCount.
 *   • messageBody(name, link, lang) — templated, PHI-light (first name + opaque link only), en + hi.
 *   • sendCheckinLink(...)      — compose + send via SMS (reuse _followcare_sms), log delivery.
 *   • runScheduler(env, now)    — scan ACTIVE episodes, dispatch due links + reminders, and escalate MISSED
 *                                 check-ins (engine.assessMissed → notify the enrolling clinician, de-identified).
 *
 * Runs from an owner/cron-gated endpoint (POST /api/followcare/admin/run-scheduler). Beta volumes run inline
 * with a per-run cap; the same plan() drives a Cloudflare Queue producer/consumer when a tenant outgrows inline
 * fan-out (documented scale path — not stubbed here). The AI never changes therapy; this only sends reminders.
 */
import { fsQuery, wUpdate, fsCommit } from "./_fbfirestore.js";
import { getEpisode, decPHI, linkFor, recordDelivery, audit, eraseEpisode } from "./_followcare.js";
import { sendSms } from "./_followcare_sms.js";
import { sendWhatsApp, waConfigured } from "./_followcare_whatsapp.js";
import Engine from "../followcare-engine.js";
import Pathways from "../followcare-pathways.js";
import I18n from "../followcare-i18n.js";

const DAY = 86400000;

// ---- PURE send-decision -----------------------------------------------------------------
// Given an episode + now, decide what to dispatch. opts: { reminderGapMs (default 24h), missGraceMs (24h) }.
// Returns { action:"send"|"remind"|"none", day, missedCount }.
//   send   = the current due day's link has not gone out yet (lastSentDay < due day)
//   remind = it went out but is still unanswered and the reminder gap has elapsed
//   missedCount = due assessments overdue by > missGraceMs and still unanswered (drives escalation)
export function plan(ep, nowMs, opts) {
  opts = opts || {};
  const reminderGapMs = opts.reminderGapMs || DAY;
  const missGraceMs = opts.missGraceMs || DAY;
  const schedule = ep.schedule || [];
  const lastDone = (ep.lastDayDone == null) ? -1 : ep.lastDayDone;
  const lastSentDay = (ep.lastSentDay == null) ? -1 : ep.lastSentDay;
  const lastSentMs = ep.lastSentMs || 0;

  const dueUnanswered = schedule.filter((s) => s.dueAtMs <= nowMs && s.dayOffset > lastDone);
  const missedCount = dueUnanswered.filter((s) => s.dueAtMs < (nowMs - missGraceMs)).length;

  if (!dueUnanswered.length) return { action: "none", day: null, missedCount: 0 };
  const day = dueUnanswered[0].dayOffset;

  if (lastSentDay < day) return { action: "send", day, missedCount };
  if ((nowMs - lastSentMs) >= reminderGapMs) return { action: "remind", day, missedCount };
  return { action: "none", day, missedCount };
}

// ---- templated, PHI-light message -------------------------------------------------------
// Bodies come from the reviewed i18n registry (followcare-i18n.js) so a patient gets their check-in in
// their own language when one has been reviewed, and English otherwise — NEVER a machine translation at
// send time. PHI-light: first name + opaque link only. `kind` maps to a registry key.
const MSG_KEY = { send: "fc.msg.send", remind: "fc.msg.remind", reminder_med: "fc.msg.reminder_med", reminder_appt: "fc.msg.reminder_appt" };
export function messageBody(firstName, link, lang, kind) {
  const key = MSG_KEY[kind] || MSG_KEY.send;
  return I18n.t(key, lang || "en", { name: firstName || "", link: link || "" });
}

// ---- send one check-in link -------------------------------------------------------------
export async function sendCheckinLink(env, ep, kind) {
  // A minor's messages go to the GUARDIAN (DPDP §9), with a generic greeting (never the child's name).
  const recipientEnc = ep.isMinor ? ep._phi.guardianEnc : ep._phi.phoneEnc;
  let firstName = "";
  if (!ep.isMinor) { try { firstName = (await decPHI(env, ep._phi.nameEnc)).trim().split(/\s+/)[0] || ""; } catch (e) {} }
  let phone = "";
  try { phone = await decPHI(env, recipientEnc); } catch (e) {}
  if (!phone) return { ok: false, reason: "no_phone" };
  const link = await linkFor(env, ep);
  const body = messageBody(firstName, link, ep.lang || "en", kind || "send");
  return sendPatientMessage(env, ep, body, { firstName: firstName, link: link, phone: phone });
}
// Reusable: send ONE PHI-light message to the episode's patient over the configured channel + log delivery.
// Used by check-in dispatch AND by the Doctor Action Center (comms notifications). `opts` may pre-supply the
// decrypted phone/firstName/link (avoids re-decrypting); otherwise phone is decrypted here. Fails SAFE.
export async function sendPatientMessage(env, ep, body, opts) {
  opts = opts || {};
  let phone = opts.phone || "";
  if (!phone) { const recEnc = ep.isMinor ? ep._phi.guardianEnc : ep._phi.phoneEnc; try { phone = await decPHI(env, recEnc); } catch (e) {} }
  if (!phone) return { ok: false, reason: "no_phone" };
  const payload = { toE164: phone, body: body, vars: { var1: opts.firstName || "", var2: opts.link || "", name: opts.firstName || "", link: opts.link || "", text: body } };
  // Channel: WhatsApp when selected + configured, else SMS. Both fail SAFE (skipped) when unconfigured.
  const channel = String(env.FOLLOWCARE_MSG_CHANNEL || "sms").toLowerCase();
  let res, ch;
  if (channel === "whatsapp" && waConfigured(env)) { res = await sendWhatsApp(env, payload); ch = "whatsapp"; }
  else { res = await sendSms(env, payload); ch = "sms"; }
  await recordDelivery(env, {
    episodeId: ep.episodeId, hospitalId: ep.hospitalId, channel: ch,
    toMasked: maskPhone(phone), status: res.ok ? "sent" : (res.skipped ? "skipped" : "failed"),
    // Redact any phone number the provider may echo in its error body before it reaches the delivery log.
    providerId: res.providerId || "", error: res.ok ? "" : redactDigits(res.reason || res.detail || ""),
  });
  return res;
}
export function maskPhone(p) { const d = String(p).replace(/[^\d]/g, ""); return d.length >= 4 ? ("•••••" + d.slice(-4)) : "••••"; }
export function redactDigits(s) { return String(s == null ? "" : s).replace(/\d{7,}/g, "•••").slice(0, 200); }

// ---- daily scheduler --------------------------------------------------------------------
// Scans ACTIVE episodes and dispatches. notify(ep, level) is an optional de-identified clinician ping
// (the route passes its notifyClinician). Returns a summary { scanned, sent, reminded, missedEscalated, skipped }.
export async function runScheduler(env, nowMs, opts) {
  opts = opts || {};
  const cap = Number(env.FOLLOWCARE_SCHEDULER_CAP) || 500;
  const notify = typeof opts.notify === "function" ? opts.notify : null;
  // Scan ACTIVE and ESCALATED episodes: an escalated patient must keep receiving check-ins so their recovery
  // is still monitored while the clinician follows up (I4) — the episode leaves monitoring only when recovered/closed.
  const active = await fsQuery(env, "fc_episodes", { where: { field: "status", value: "active" }, limit: cap });
  const escalated = await fsQuery(env, "fc_episodes", { where: { field: "status", value: "escalated" }, limit: cap });
  const rows = active.concat(escalated);
  const summary = { scanned: rows.length, sent: 0, reminded: 0, missedEscalated: 0, skipped: 0, failed: 0 };

  for (const d of rows) {
    const ep = await getEpisode(env, d.id);
    if (!ep) continue;
    const p = plan(ep, nowMs, opts);

    // Dispatch the due link / reminder.
    if (p.action === "send" || p.action === "remind") {
      const res = await sendCheckinLink(env, ep, p.action === "remind" ? "remind" : "send");
      if (res.ok) { summary[p.action === "remind" ? "reminded" : "sent"]++; }
      else if (res.skipped) { summary.skipped++; }
      else { summary.failed++; }
      await fsCommit(env, [wUpdate(env, "fc_episodes/" + ep.episodeId, { lastSentDay: p.day, lastSentMs: nowMs }, { exists: true })]);
    }

    // Escalate a MISSED check-in (never let a non-responder silently sit at prior risk).
    if (p.missedCount > 0 && ep.lastEscalation !== "red") {
      const missed = Engine.assessMissed(ep.pathwayId, p.missedCount, { pathways: Pathways });
      const level = (missed && missed.escalation) || "yellow";
      if (level === "orange" || level === "red") {
        // Only escalate once per missed threshold crossing (guard on a stored marker).
        if (ep.lastMissedEscalated !== p.missedCount) {
          await fsCommit(env, [wUpdate(env, "fc_episodes/" + ep.episodeId, { lastEscalation: level, status: "escalated", lastMissedEscalated: p.missedCount }, { exists: true })]);
          await audit(env, { hospitalId: ep.hospitalId, episodeId: ep.episodeId, actor: "system", action: "missed_escalation", meta: { missedCount: p.missedCount, level } });
          summary.missedEscalated++;
          if (notify) { try { await notify(ep, level); } catch (e) {} }
        }
      }
    }
  }

  // Retention (DPDP §8(7)): once follow-up is done, delete the patient's data after a bounded period.
  // OFF by default (0) so nothing is ever surprise-deleted; the owner sets FOLLOWCARE_RETENTION_DAYS to opt in.
  const retDays = Number(env.FOLLOWCARE_RETENTION_DAYS) || 0;
  if (retDays > 0) {
    summary.retentionErased = 0;
    const cutoff = nowMs - retDays * DAY;
    const doneRows = (await fsQuery(env, "fc_episodes", { where: { field: "status", value: "recovered" }, limit: cap }))
      .concat(await fsQuery(env, "fc_episodes", { where: { field: "status", value: "closed" }, limit: cap }));
    for (const d of doneRows) {
      const f = d.fields || {};
      const doneMs = f.recoveredMs || f.createdMs || 0;
      if (doneMs && doneMs < cutoff) { await eraseEpisode(env, d.id, "system:retention"); summary.retentionErased++; }
    }
  }
  return summary;
}
