/* functions/_wardsynq/mar-schedule.js — what is due, and when.
 *
 * Until now nothing in WardSynQ computed a medication schedule. The eMAR could administer a dose at
 * a time, but the time had to be handed to it, so the ward screen had to ask the NURSE to pick the
 * round time and say out loud that the system was not asserting anything was due. That is the gap
 * this closes: the frequency a doctor already wrote on the order becomes the times the dose is due.
 *
 * A SCHEDULE IS DERIVED, NEVER STORED. Nothing here writes a record. It reads the active orders and
 * computes the slots; the MedicationAdministration is still created only when a nurse acts on one.
 * Pre-creating administration rows for future doses would put doses on a chart that nobody has
 * given, and a chart that lists ungiven doses as records is worse than no schedule at all.
 *
 * PRN IS NEVER SCHEDULED. A drug written "as needed" is given on a patient's need, not on a clock.
 * Putting it on the round would state that it is due, which is precisely what PRN means it is not.
 * PRN orders come back in their own list, so the ward can still see them and give one deliberately.
 *
 * AN UNPARSEABLE FREQUENCY IS REPORTED, NEVER DROPPED AND NEVER GUESSED. If this file cannot say
 * what "alternate days after dialysis" means, the order appears in `unscheduled` with its raw text
 * so the ward can see it needs a human. Silently omitting it is a missed dose; guessing at it is a
 * wrong one. Both are worse than saying "I do not know what this means".
 *
 * TDS IS NOT Q8H. Named frequencies (OD/BD/TDS/QID) are ward CLOCK TIMES — the drug round, aligned
 * to meals and staffing, which is how a real ward gives them. QnH is a strict INTERVAL from when the
 * order became effective, because "every 8 hours" on an antibiotic means the interval, and flattening
 * the two into "three times a day" is how a level-dependent drug drifts.
 */

import { STATES, TERMINAL } from "../../wardsynq/wardsynq-meds.js";
import { medicationAdministrationIdFor } from "./opd-identity.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* The ward's standard administration times, as wall-clock in the hospital's own timezone. A site
 * overrides any of these through the org (see `timesFor`); the defaults are the common Indian ward
 * round. Changing them changes when doses are due, so they are org configuration, not a constant a
 * caller passes in per request. */
const DEFAULT_MAR_TIMES = Object.freeze({
  OD: Object.freeze(["08:00"]),
  BD: Object.freeze(["08:00", "20:00"]),
  TDS: Object.freeze(["08:00", "14:00", "22:00"]),
  QID: Object.freeze(["06:00", "12:00", "18:00", "22:00"]),
  OM: Object.freeze(["08:00"]),
  HS: Object.freeze(["22:00"]),
});

/* Every spelling of a frequency this file will accept, mapped to its canonical key. Anything not
 * here is NOT understood, and being unlisted is a reportable answer rather than a default. */
const ALIASES = Object.freeze({
  OD: "OD", QD: "OD", DAILY: "OD", ONCEDAILY: "OD", ONCEADAY: "OD", "1ID": "OD",
  BD: "BD", BID: "BD", TWICEDAILY: "BD", TWICEADAY: "BD",
  TDS: "TDS", TID: "TDS", THRICEDAILY: "TDS", THREETIMESADAY: "TDS",
  QID: "QID", QDS: "QID", FOURTIMESADAY: "QID",
  OM: "OM", MANE: "OM", MORNING: "OM",
  HS: "HS", ON: "HS", NOCTE: "HS", ATNIGHT: "HS", BEDTIME: "HS", ATBEDTIME: "HS",
  STAT: "STAT", ONCE: "STAT", ONCEONLY: "STAT", IMMEDIATELY: "STAT",
  PRN: "PRN", SOS: "PRN", ASNEEDED: "PRN", ASREQUIRED: "PRN", WHENREQUIRED: "PRN", IFREQUIRED: "PRN",
});

/** How many slots one request will ever enumerate. A truncated result SAYS it was truncated. */
const MAX_SLOTS = 400;
/** The widest window that can be asked for, so one request cannot enumerate a year of doses. */
const MAX_WINDOW_DAYS = 31;

/**
 * PURE. What a written frequency means, or null when this file does not know.
 *
 * Returns one of:
 *   { kind: "times",    key, perDay }   named ward round (OD/BD/TDS/QID/OM/HS)
 *   { kind: "interval", hours, perDay } QnH, strictly every n hours from the order's effective time
 *   { kind: "once" }                    STAT: one dose, when the order was written
 *   { kind: "prn" }                     never scheduled
 *   { kind: "pattern",  slots }         the Indian 1-0-1 / 1-1-1 / 1-0-0-1 notation
 */
function parseFrequency(freq) {
  const raw = str(freq);
  if (!raw) return null;
  const norm = raw.toUpperCase().replace(/[\s.–—]/g, "");

  // "1-0-1", "1-1-1", "0-0-1", and the four-slot "1-0-0-1". Widely written on Indian charts, and a
  // frequency this file would otherwise have to call unreadable on a majority of real orders.
  if (/^\d(-\d){2,3}$/.test(norm)) {
    const parts = norm.split("-").map(Number);
    const slots = parts.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
    // "0-0-0" is not a frequency. It is an order that says never, which is not something to schedule.
    return slots.length ? { kind: "pattern", slots, of: parts.length } : null;
  }

  const q = /^Q(\d{1,2})H$/.exec(norm);
  if (q) {
    const hours = Number(q[1]);
    // 0 is meaningless and anything over 24 is not an intra-day interval this file can place.
    if (!hours || hours > 24) return null;
    return { kind: "interval", hours, perDay: 24 / hours };
  }

  const key = ALIASES[norm];
  if (!key) return null;
  if (key === "STAT") return { kind: "once" };
  if (key === "PRN") return { kind: "prn" };
  return { kind: "times", key, perDay: DEFAULT_MAR_TIMES[key].length };
}

/**
 * PURE. The ward's times for a canonical key, with any org override applied.
 *
 * An override that survives validation wins. One that does NOT - a typo, a wrong shape, "8am"
 * instead of "08:00" - falls back to the default round rather than to an empty one. Returning []
 * here would drop every dose of that frequency off the schedule and the round would simply look
 * quiet, which is the worst possible failure for a configuration mistake nobody has noticed yet.
 */
function timesFor(key, overrides) {
  const fallback = DEFAULT_MAR_TIMES[key] || [];
  const o = overrides && overrides[key];
  if (!Array.isArray(o) || !o.length) return [...fallback];
  const usable = o.filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(str(t)));
  return usable.length === o.length ? usable : [...fallback];
}

/* The hospital's wall clock. An offset in minutes rather than a timezone name: the standard times
 * are wall-clock, and turning "08:00 on the 9th" into an instant needs the offset that applies then.
 * ponytail: a fixed offset is exact for India (no DST) and for every fixed-offset site; a site that
 * observes DST needs a real tz database here, and should not use this until it has one. */
function slotInstant(y, m, d, hhmm, offsetMinutes) {
  const [hh, mm] = hhmm.split(":").map(Number);
  return Date.UTC(y, m, d, hh, mm) - offsetMinutes * 60000;
}

/**
 * PURE. Every time this order is due within [from, to).
 *
 * Never before the order became effective and never after it stops: a schedule that runs an
 * antibiotic past its course, or starts it before it was written, is the harm scheduling introduces.
 *
 * @returns {{ due: number[], truncated: boolean }} epoch ms, ascending.
 */
function scheduleSlots(order, opts) {
  const o = opts || {};
  const offset = Number.isFinite(o.offsetMinutes) ? o.offsetMinutes : 330;   // +05:30, the app's home ward
  const spec = parseFrequency(order && order.frequency);
  const out = { due: [], truncated: false };
  if (!spec || spec.kind === "prn") return out;

  const from = Date.parse(o.from);
  const to = Date.parse(o.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return out;

  const startedAt = Date.parse((order.meta && order.meta.effectiveAt) || order.effectiveAt || "");
  const start = Number.isFinite(startedAt) ? startedAt : from;
  const stoppedAt = Date.parse(order.stopAt || "");
  const stop = Number.isFinite(stoppedAt) ? stoppedAt : Infinity;

  const keep = (t) => t >= from && t < to && t >= start && t <= stop;
  const push = (t) => { if (out.due.length >= MAX_SLOTS) { out.truncated = true; return; } out.due.push(t); };

  if (spec.kind === "once") {
    // STAT is one dose at the moment it was ordered. It is not a daily anything.
    if (keep(start)) push(start);
    return out;
  }

  if (spec.kind === "interval") {
    const step = spec.hours * 3600000;
    // Count forward from the order's own start so the interval is measured from the first dose, not
    // from midnight or from the window the caller happened to ask about.
    let n = Math.max(0, Math.ceil((from - start) / step));
    for (let t = start + n * step; t < to && !out.truncated; t += step) if (keep(t)) push(t);
    return out;
  }

  const times = spec.kind === "pattern"
    // A 3-slot pattern reads against the TDS round, a 4-slot one against QID, so the ward's own
    // configured times drive both notations and there is no second table to disagree with.
    ? spec.slots.map((i) => timesFor(spec.of === 4 ? "QID" : "TDS", o.times)[i]).filter(Boolean)
    : timesFor(spec.key, o.times);
  if (!times.length) return out;

  // Walk calendar days across the window in the hospital's own clock, one day either side so a slot
  // near a boundary is not lost to the offset.
  const dayMs = 86400000;
  for (let day = from - dayMs; day < to + dayMs && !out.truncated; day += dayMs) {
    const local = new Date(day + offset * 60000);
    const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
    for (const hhmm of times) {
      const t = slotInstant(y, m, d, hhmm, offset);
      if (keep(t) && out.due.indexOf(t) < 0) push(t);
    }
  }
  out.due.sort((a, b) => a - b);
  return out;
}

/* A dose nobody needs to chase. Built from the state machine's OWN constants, never retyped: a
 * hand-written copy of these names is how this check silently stops matching. It did exactly that
 * in the first draft of this file, which spelled them in capitals and would therefore have reported
 * every dose that had already been given as overdue, forever.
 *
 * TERMINAL plus HELD. Held is not terminal - the order is still live and the next dose is still due
 * - but this dose was deliberately withheld, so a decision has been made and there is nothing to
 * chase about it. */
const CLOSED = Object.freeze([...TERMINAL, STATES.HELD]);

/** PURE. A dose is overdue when its time has passed and nobody has resolved it. */
function isOverdue(dueAtMs, status, nowMs, graceMinutes) {
  if (status && CLOSED.indexOf(String(status)) >= 0) return false;
  const grace = Number.isFinite(graceMinutes) ? graceMinutes : 60;
  return nowMs > dueAtMs + grace * 60000;
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

/**
 * The patient's medication schedule over a window, with each slot's administration state.
 *
 * ctx: { migration, patientId, from, to?, now?, marTimes?, offsetMinutes?, graceMinutes?,
 *        actorDeps, recordDeps }
 */
async function marSchedule(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", due: [], prn: [], unscheduled: [] };

  const patientId = str(ctx.patientId);
  const from = str(ctx.from);
  if (!patientId || !Date.parse(from)) {
    return { ...base, ok: false, status: 422, error: "patient_and_from_required", detail: "patientId and an ISO `from` are required", due: [], prn: [], unscheduled: [] };
  }
  const fromMs = Date.parse(from);
  const toMs = Date.parse(str(ctx.to)) || (fromMs + 86400000);
  if (toMs <= fromMs) return { ...base, ok: false, status: 422, error: "bad_window", detail: "`to` must be after `from`", due: [], prn: [], unscheduled: [] };
  if (toMs - fromMs > MAX_WINDOW_DAYS * 86400000) {
    return { ...base, ok: false, status: 422, error: "window_too_wide", detail: `the window may not exceed ${MAX_WINDOW_DAYS} days`, due: [], prn: [], unscheduled: [] };
  }

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, due: [], prn: [], unscheduled: [] };

  let orders;
  try { orders = await svc.byPatient("MedicationOrder", patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), due: [], prn: [], unscheduled: [] }; }

  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const opts = { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), times: ctx.marTimes, offsetMinutes: ctx.offsetMinutes };
  const due = [], prn = [], unscheduled = [];
  let truncated = false;

  for (const o of (orders || []).filter((x) => x && x.status === "active")) {
    const card = { orderId: o.id, drug: o.drug, dose: o.dose || null, route: o.route || null, frequency: o.frequency || null };
    const spec = parseFrequency(o.frequency);
    if (!spec) {
      // Named, not omitted. A ward that cannot see this order has no way to know a dose is missing.
      unscheduled.push({ ...card, reason: o.frequency ? "frequency_not_understood" : "no_frequency" });
      continue;
    }
    if (spec.kind === "prn") { prn.push({ ...card, asNeeded: true }); continue; }

    const slots = scheduleSlots(o, opts);
    if (slots.truncated) truncated = true;
    for (const t of slots.due) {
      const dueAt = new Date(t).toISOString();
      const administrationId = medicationAdministrationIdFor(o.id, dueAt);
      let mar = null;
      try { mar = administrationId ? await svc.get("MedicationAdministration", administrationId) : null; } catch { mar = null; }
      due.push({
        ...card, dueAt, administrationId,
        status: mar ? mar.status : null,             // null = this dose has not been started
        administeredAt: (mar && mar.administeredAt) || null,
        administeredBy: (mar && mar.administeredBy) || null,
        overdue: isOverdue(t, mar && mar.status, nowMs, ctx.graceMinutes),
      });
    }
  }
  due.sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : (a.drug < b.drug ? -1 : 1)));
  return {
    ...base, ok: true, patientId, from: opts.from, to: opts.to,
    due, prn, unscheduled,
    // Never a silent cap: a truncated round that looked complete would read as "nothing else is due".
    ...(truncated ? { truncated: true, detail: `more than ${MAX_SLOTS} doses fall in this window; narrow it` } : {}),
  };
}

export { DEFAULT_MAR_TIMES, ALIASES, MAX_SLOTS, MAX_WINDOW_DAYS, parseFrequency, timesFor, scheduleSlots, isOverdue, marSchedule };
