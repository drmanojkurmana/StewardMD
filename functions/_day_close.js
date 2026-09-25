/* functions/_day_close.js - the owner's day close on WhatsApp at a set hour (OPD plan, owner ask G2 2026-09-25).
 *
 * The hospital sets org.wardsynq.dayClose = { enabled, hour (0-23, the hospital's clock), mobile }. The stewardmd-api
 * worker's hourly cron POSTs /api/queue/ops/day-close-all; each hospital whose hour has come gets ONE message a day:
 * the send is claimed first with a create-only record (q_dayclose_sent/<hospital>__<date>), so two overlapping runs
 * cannot both send, and a failed send is retried on later hours, at most MAX_ATTEMPTS times.
 *
 * The message is the day in counts and totals (the same figures as the Close the day screen): it names no patient.
 * It goes over the WhatsApp channel the queue's patient messages use (_followcare_whatsapp.js); there is no SMS
 * fallback, because an SMS must match a registered DLT template and this text changes every day.
 */
import { fsGet, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { sendWhatsApp, waConfigured } from "./_followcare_whatsapp.js";
import { writeOrgAudit } from "./_q_audit_chain.js";

export const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 50 * 60000;
const sanitize = (s) => String(s == null ? "" : s).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60);

/* PURE. The saved setting, as it may be trusted: off unless explicitly on, an hour 0-23 (default 20:00), a mobile of
 * 10 to 15 digits (a bare 10-digit number is Indian). null for a setting that cannot be saved, with why. */
export function dayCloseSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const hour = r.hour == null || r.hour === "" ? 20 : Number(r.hour);
  const digits = String(r.mobile || "").replace(/\D/g, "");
  return { enabled: r.enabled === true, hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 20, mobile: digits.length >= 10 && digits.length <= 15 ? (digits.length === 10 ? "91" + digits : digits) : "" };
}
export function settingsRefusal(raw) {
  const r = raw && typeof raw === "object" ? raw : null;
  if (!r || typeof r.enabled !== "boolean") return "Say whether the day close is sent (on or off).";
  const h = Number(r.hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) return "Pick the hour to send it, 0 to 23 on the hospital's clock.";
  const d = String(r.mobile || "").replace(/\D/g, "");
  if (r.enabled && (d.length < 10 || d.length > 15)) return "Enter the WhatsApp number it goes to, with the country code if it is not an Indian number.";
  return "";
}
export function maskMobile(m) { const d = String(m || "").replace(/\D/g, ""); return d.length >= 4 ? "•••••" + d.slice(-4) : ""; }

/* PURE. Whether this hospital's day close is due now: its hour has come on its own clock. `date` is that local day
 * (the key of the once-a-day record). */
export function dayCloseDue(settings, nowMs, offsetMinutes) {
  const off = Number.isFinite(offsetMinutes) ? offsetMinutes : 330;
  const local = new Date(nowMs + off * 60000);
  return { due: !!(settings && settings.enabled && settings.mobile && local.getUTCHours() >= settings.hour), date: local.toISOString().slice(0, 10) };
}

const rupees = (p) => "₹" + Math.round((p || 0) / 100).toLocaleString("en-IN");
const REASON = { emergency: "emergency", senior: "senior citizen", pregnant: "pregnant", disability: "disability", child: "child", results: "results ready", other: "other", unstated: "no reason recorded" };
/* PURE. The message: the day in counts and totals, in the order the owner reads the screen. No patient named. */
export function dayCloseText(r, orgName) {
  const c = (r && r.close) || {}, p = c.pulse || {}, m = r && r.money;
  const lines = [(orgName || "Your hospital") + ", day close " + ((r && r.date) || "") + "."];
  lines.push("Patients seen: " + (p.seen || 0) + " of " + (p.registered || 0) + " registered" + (p.noShow ? ", " + p.noShow + " no-shows" : "") + ".");
  if (p.doorToDoctor && p.doorToDoctor.medianMin != null) lines.push("Door to doctor: " + p.doorToDoctor.medianMin + " min (9 in 10 within " + p.doorToDoctor.p90Min + " min).");
  if (r && r.moneyUnread) lines.push("Money: could not be read; open Billing, Shift report.");
  else if (m) lines.push("Collected: " + rupees(m.net) + " net from " + (m.count || 0) + " bills" + (m.refunds && m.refunds.count ? ", after " + m.refunds.count + " refunds of " + rupees(m.refunds.total) : "") + "." + (r.unbilled ? " Not yet paid: " + r.unbilled + "." : ""));
  const open = (p.waiting || 0) + (p.inConsultation || 0);
  if (open) lines.push("Still in the OPD: " + open + ".");
  const pr = Object.keys(c.priority || {});
  if (pr.length) lines.push("Put ahead of the queue: " + pr.map((k) => c.priority[k] + " " + (REASON[k] || k)).join(", ") + ".");
  if (c.offline) lines.push("Checked in offline: " + c.offline + ".");
  const busiest = (c.rooms || [])[0];
  if (busiest && busiest.seen) lines.push("Busiest: " + busiest.room + (busiest.doctor ? " (" + busiest.doctor + ")" : "") + ", " + busiest.seen + " seen.");
  if (r && r.unread && r.unread.length) lines.push("Some rooms could not be read, so these figures are short.");
  return lines.join("\n");
}

const recordPath = (orgId, date) => "q_dayclose_sent/" + sanitize(orgId) + "__" + sanitize(date);
/* The day's record: { status: sending|sent|failed, attempts, at, reason }. null when none. */
export async function sendRecord(env, orgId, date) {
  const d = await fsGet(env, recordPath(orgId, date));
  return d ? Object.assign({ updateTime: d.updateTime }, d.fields || {}) : null;
}
/* Claims today's send. Returns true when THIS run may send: a first claim (create-only), or a failed one whose
 * retry is due (guarded on the record being unchanged since it was read). */
export async function claimSend(env, orgId, date, nowMs) {
  const ex = await sendRecord(env, orgId, date);
  try {
    if (!ex) { await fsCommit(env, [wCreate(env, recordPath(orgId, date), { orgId: String(orgId), date: String(date), status: "sending", attempts: 1, at: nowMs, expiresAt: nowMs + 40 * 86400e3 })]); return true; }
    if (ex.status !== "failed" || (ex.attempts || 0) >= MAX_ATTEMPTS || nowMs - (ex.at || 0) < RETRY_AFTER_MS) return false;
    await fsCommit(env, [wUpdate(env, recordPath(orgId, date), { status: "sending", attempts: (ex.attempts || 0) + 1, at: nowMs }, { updateTime: ex.updateTime })]);
    return true;
  } catch (e) { if (e && e.code === "precondition") return false; throw e; }
}

/* Sends one message and says what happened. `how` is "scheduled" (the daily one: recorded under the day's record)
 * or "test" (the owner's Send now: audited, never counted as the day's). */
export async function sendDayClose(env, org, report, settings, how, nowMs) {
  const body = dayCloseText(report, org.name || "");
  let res;
  if (!waConfigured(env)) res = { ok: false, reason: "whatsapp_not_configured" };
  else { try { res = await sendWhatsApp(env, { toE164: settings.mobile, body, vars: { text: body } }); } catch (e) { res = { ok: false, reason: "exception" }; } }
  const ok = !!(res && res.ok), reason = ok ? "" : String((res && (res.reason || res.detail || res.status)) || "failed").slice(0, 80);
  if (how === "scheduled") { try { await fsCommit(env, [wUpdate(env, recordPath(org.id, report.date), { status: ok ? "sent" : "failed", reason, at: nowMs })]); } catch (e) {} }
  try { await writeOrgAudit(env, { hospitalId: org.id, ticketId: "", actor: how === "scheduled" ? "system:day-close" : "owner:day-close", action: "day_close:" + (ok ? "sent" : "failed"), meta: JSON.stringify({ how, to: maskMobile(settings.mobile), date: report.date, reason }), ts: nowMs }); } catch (e) {}
  return { ok, reason };
}
