/* functions/_opd_insights.js - the OPD dashboard's figures (GET /api/queue/opd-insights), PURE over tickets.
 *
 * The console's premium dashboard draws four things the pulse does not carry: registrations per hour today, each
 * day of the month (registered / seen), today's visit mix, and today against the SAME TIME yesterday. All of it is
 * counts and durations: no name, token, MRN or mobile leaves this file, so the answer is safe on any desk screen.
 *
 * "Same time yesterday" means yesterday's tickets read as they stood at now minus 24 hours (only what had happened by
 * then counts), so a morning never looks worse than a finished day. Both sides go through ONE function (kpisAt), so
 * a delta is never two differently defined numbers subtracted.
 */
import { NO_SHOW_RECALL_MS } from "./_queue_eta.js";

const DAY_MS = 86400000, HOUR_MS = 3600000;
function percentileMin(list, p) {
  if (!list.length) return null;
  const s = list.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Math.round(s[i] / 60000);
}
const at = (v, cutoff) => Number(v) > 0 && Number(v) <= cutoff;

/** The day's headline figures as they stood at `cutoff` (ms). */
export function kpisAt(tickets, cutoff) {
  let registered = 0, seen = 0, completed = 0, noShow = 0;
  const door = [], consult = [];
  for (const t of tickets || []) {
    if (!t || !at(t.registeredAt, cutoff)) continue;
    registered++;
    const started = at(t.consultStartAt, cutoff), ended = at(t.consultEndAt, cutoff);
    if (started || (t.status === "completed" && ended)) seen++;
    if (started) door.push(t.consultStartAt - t.registeredAt);
    if (started && ended && t.consultEndAt >= t.consultStartAt) consult.push(t.consultEndAt - t.consultStartAt);
    if (t.status === "completed" && ended) completed++;
    if (t.status === "no_show" && at(t.noShowAt, cutoff)) noShow++;
  }
  const finished = completed + noShow;
  return {
    registered, seen, noShow,
    doorToDoctor: { medianMin: percentileMin(door, 50), p90Min: percentileMin(door, 90), n: door.length },
    consultMedianMin: percentileMin(consult, 50),
    // null, not 0: nobody finished yet is not nobody walked out.
    abandonedPct: finished ? Math.round((noShow / finished) * 100) : null,
  };
}
const diff = (a, b) => (a == null || b == null ? null : a - b);

/** Registrations per hour of the hospital's day (offsetMin east of UTC). */
export function hourly(tickets, offsetMin) {
  const out = new Array(24).fill(0), off = (Number(offsetMin) || 0) * 60000;
  for (const t of tickets || []) {
    if (!t || !(Number(t.registeredAt) > 0)) continue;
    const h = Math.floor((((t.registeredAt + off) % DAY_MS) + DAY_MS) % DAY_MS / HOUR_MS);
    out[h]++;
  }
  return out;
}

/** Today's visit mix: by visit type, and who went ahead of the queue by reason. */
export function visitMix(tickets) {
  const mix = { new: 0, followup: 0, appointment: 0, teleconsult: 0, priority: {} };
  for (const t of tickets || []) {
    if (!t) continue;
    const v = t.visitType === "followup" || t.visitType === "appointment" || t.visitType === "teleconsult" ? t.visitType : "new";
    mix[v]++;
    if (Number(t.priority) > 0) { const r = String(t.priorityReason || "other"); mix.priority[r] = (mix.priority[r] || 0) + 1; }
  }
  if (!mix.teleconsult) delete mix.teleconsult;
  if (!mix.appointment) delete mix.appointment;
  return mix;
}

/** A past day in the month strip: counts only. */
export function dayCounts(date, tickets) {
  let registered = 0, seen = 0;
  for (const t of tickets || []) {
    if (!t) continue;
    registered++;
    if (Number(t.consultStartAt) > 0 || t.status === "completed") seen++;
  }
  return { date, registered, seen };
}

/** Dates of the month from the 1st to `today` (YYYY-MM-DD strings, the hospital's day). */
export function monthDates(today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ""));
  if (!m) return [];
  const out = [];
  for (let d = 1; d <= Number(m[3]); d++) out.push(m[1] + "-" + m[2] + "-" + String(d).padStart(2, "0"));
  return out;
}
export function prevDate(date) {
  const t = Date.parse(String(date) + "T12:00:00Z");
  return Number.isFinite(t) ? new Date(t - DAY_MS).toISOString().slice(0, 10) : "";
}

/* Only the fields the figures read, so a cached past day holds no patient data. */
export function slim(t) {
  return t ? { status: t.status, registeredAt: Number(t.registeredAt) || 0, consultStartAt: Number(t.consultStartAt) || 0, consultEndAt: Number(t.consultEndAt) || 0, noShowAt: Number(t.noShowAt) || 0 } : null;
}

/**
 * today: today's tickets; yesterday: yesterday's; month: [{date, tickets}] for the past days of this month
 * (today is added from `today`). -> the /opd-insights answer body.
 */
export function insights({ today, yesterday, month, date, nowMs, offsetMin }) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const kToday = kpisAt(today, now), kYest = kpisAt(yesterday, now - DAY_MS);
  const days = (month || []).map((d) => dayCounts(d.date, d.tickets));
  days.push(dayCounts(date, today));
  const recallable = (today || []).filter((t) => t && t.status === "no_show" && Number(t.noShowAt) > 0 && t.noShowAt + NO_SHOW_RECALL_MS > now).length;
  return {
    date, at: now,
    hourly: hourly(today, offsetMin),
    currentHour: Math.floor((((now + (Number(offsetMin) || 0) * 60000) % DAY_MS) + DAY_MS) % DAY_MS / HOUR_MS),
    month: days,
    mix: visitMix(today),
    today: kToday,
    yesterday: kYest,
    // today minus the same time yesterday; null where either side was not measured
    delta: {
      registered: kToday.registered - kYest.registered,
      seen: kToday.seen - kYest.seen,
      doorToDoctorMin: diff(kToday.doorToDoctor.medianMin, kYest.doorToDoctor.medianMin),
      abandonedPct: diff(kToday.abandonedPct, kYest.abandonedPct),
    },
    recallableNoShows: recallable,
  };
}
