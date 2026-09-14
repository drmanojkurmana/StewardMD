/* functions/_roster.js — who works when, where. PURE: no I/O, every rule here is unit-tested.
 *
 * NOT A CLINICAL RECORD. Rostering is staff data about staff, kept beside memberships in the org store,
 * never in the patient record. Work queues may ASK it who is on duty; nothing clinical is written here.
 *
 * THE THREE REFUSALS THAT MATTER, because each is a ward left short without anyone noticing:
 *   - the same person on two overlapping shifts (a name on the rota is not a person on the ward);
 *   - someone rostered on a day their leave was approved;
 *   - a swap that leaves either person double-booked.
 * Everything else is reported rather than refused: a gap is shown so a human fills it, never "fixed" by
 * moving someone automatically.
 *
 * Times are "HH:MM" in the hospital's local day; a shift whose end is not after its start runs past
 * midnight into the next day. Dates are "YYYY-MM-DD".
 */

const pad = (n) => String(n).padStart(2, "0");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

class RosterError extends Error { constructor(code, message) { super(message); this.code = code; } }

function minutes(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function dayIndex(date) { return Math.floor(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000); }
function dateOf(idx) { const d = new Date(idx * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function addDays(date, n) { return dateOf(dayIndex(date) + n); }

/** A shift definition, validated. minimum: { role: count } for coverage. */
function shiftDef(input) {
  const i = input || {};
  const name = String(i.name || "").trim();
  if (!name) throw new RosterError("name_required", "a shift needs a name");
  if (!TIME_RE.test(String(i.start)) || !TIME_RE.test(String(i.end))) throw new RosterError("bad_time", "start and end are HH:MM");
  if (i.start === i.end) throw new RosterError("zero_length", "a shift cannot start and end at the same time");
  const unit = String(i.unit || "").trim();
  if (!unit) throw new RosterError("unit_required", "say which ward or unit the shift is for");
  const minimum = {};
  for (const [role, n] of Object.entries(i.minimum || {})) { const c = Math.floor(Number(n)); if (c > 0) minimum[String(role)] = c; }
  return { id: String(i.id || ""), name, unit, start: i.start, end: i.end, minimum };
}

/** [startMinute, endMinute) on a continuous minute axis, so overnight shifts compare correctly. */
function span(date, shift) {
  const base = dayIndex(date) * 1440;
  const s = base + minutes(shift.start);
  let e = base + minutes(shift.end);
  if (e <= s) e += 1440;
  return [s, e];
}
const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

function onLeave(identity, date, leaves) {
  return (leaves || []).some((l) => l.identity === identity && l.status === "approved" && l.from <= date && date <= l.to);
}

/**
 * Would this assignment be allowed? Returns null, or a RosterError describing the refusal.
 * assignment: { identity, date, shiftId }; shifts: {id: def}; existing: assignments; leaves: leave rows.
 */
function assignmentProblem(assignment, shifts, existing, leaves, ignoreId) {
  const a = assignment || {};
  if (!a.identity) return new RosterError("identity_required", "who is being rostered?");
  if (!DATE_RE.test(String(a.date))) return new RosterError("bad_date", "date is YYYY-MM-DD");
  const shift = shifts[a.shiftId];
  if (!shift) return new RosterError("unknown_shift", "that shift is not defined for this hospital");
  if (onLeave(a.identity, a.date, leaves)) return new RosterError("on_leave", `${a.identity} has approved leave on ${a.date}`);
  const mine = span(a.date, shift);
  for (const e of existing || []) {
    if (e.identity !== a.identity || e.id === ignoreId || e.status === "cancelled") continue;
    const other = shifts[e.shiftId];
    if (other && overlaps(mine, span(e.date, other))) {
      return new RosterError("double_booked", `${a.identity} is already on ${other.name} (${other.unit}) on ${e.date}, which overlaps`);
    }
  }
  return null;
}

/** Dates for a weekly repeat: the start date and then every 7 days, `weeks` times in all (max 26). */
function weeklyDates(startDate, weeks) {
  if (!DATE_RE.test(String(startDate))) throw new RosterError("bad_date", "date is YYYY-MM-DD");
  const n = Math.max(1, Math.min(26, Math.floor(Number(weeks) || 1)));
  return Array.from({ length: n }, (_, k) => addDays(startDate, 7 * k));
}

/**
 * Coverage for each shift on each date in [from, to]: who is on, how many of each role, and the gaps
 * against the shift's minimum. roleOf: identity -> role.
 */
function coverage(from, to, shifts, assignments, roleOf) {
  if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to)) || to < from) throw new RosterError("bad_range", "from and to are YYYY-MM-DD, from first");
  if (dayIndex(to) - dayIndex(from) > 62) throw new RosterError("range_too_long", "ask for at most two months at a time");
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const shift of Object.values(shifts)) {
      const on = (assignments || []).filter((x) => x.date === d && x.shiftId === shift.id && x.status !== "cancelled");
      const counts = {};
      for (const x of on) { const r = roleOf(x.identity) || "unknown"; counts[r] = (counts[r] || 0) + 1; }
      const gaps = Object.entries(shift.minimum).filter(([r, n]) => (counts[r] || 0) < n).map(([role, need]) => ({ role, need, have: counts[role] || 0, short: need - (counts[role] || 0) }));
      out.push({ date: d, shiftId: shift.id, shift: shift.name, unit: shift.unit, staff: on.map((x) => x.identity), assignments: on.map((x) => ({ id: x.id, identity: x.identity })), counts, gaps });
    }
  }
  return out;
}

/** Who is on duty at instant `atMs` (UTC ms) for the hospital's utcOffsetMinutes, optionally in one unit. */
function onDutyAt(atMs, utcOffsetMinutes, shifts, assignments, unit) {
  const local = Math.floor((atMs + (Number(utcOffsetMinutes) || 0) * 60000) / 60000);
  return (assignments || []).filter((x) => {
    if (x.status === "cancelled") return false;
    const s = shifts[x.shiftId];
    if (!s || (unit && s.unit !== unit)) return false;
    const [a, b] = span(x.date, s);
    return a <= local && local < b;
  });
}

/**
 * A swap: `from` gives their assignment to `to`. Checked as if `to` held it and `from` did not.
 * Returns null or a RosterError.
 */
function swapProblem(assignment, toIdentity, shifts, existing, leaves) {
  if (!toIdentity || toIdentity === assignment.identity) return new RosterError("bad_swap", "swap with a different colleague");
  return assignmentProblem({ ...assignment, identity: toIdentity }, shifts, existing, leaves, assignment.id);
}

function validLeave(input) {
  const i = input || {};
  if (!DATE_RE.test(String(i.from)) || !DATE_RE.test(String(i.to)) || i.to < i.from) throw new RosterError("bad_range", "leave needs from and to dates, from first");
  if (!String(i.reason || "").trim()) throw new RosterError("reason_required", "say what the leave is for");
  if (dayIndex(i.to) - dayIndex(i.from) > 92) throw new RosterError("leave_too_long", "request leave in blocks of at most three months");
  return { from: i.from, to: i.to, reason: String(i.reason).trim().slice(0, 200) };
}

export { RosterError, shiftDef, span, overlaps, onLeave, assignmentProblem, weeklyDates, coverage, onDutyAt, swapProblem, validLeave, addDays };
