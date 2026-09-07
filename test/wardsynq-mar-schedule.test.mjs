/* test/wardsynq-mar-schedule.test.mjs — what is due, and when. Pure: no store, no network.
 *
 * node --test test/wardsynq-mar-schedule.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAR_TIMES, MAX_SLOTS, parseFrequency, timesFor, scheduleSlots, isOverdue } from "../functions/_wardsynq/mar-schedule.js";

const IST = 330;
const iso = (t) => new Date(t).toISOString();
/** An order that became effective at a given instant. */
function order(frequency, effectiveAt, extra) {
  return { id: "wsq-rx-1", drug: "Paracetamol", frequency, meta: { effectiveAt }, ...(extra || {}) };
}
/** The due times of a schedule, as hospital-local "DD HH:MM", which is how a ward reads them. */
function local(due) {
  return due.map((t) => {
    const d = new Date(t + IST * 60000);
    return String(d.getUTCDate()).padStart(2, "0") + " " + String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  });
}
const DAY = { from: "2026-09-08T18:30:00.000Z", to: "2026-09-09T18:30:00.000Z" };   // 9 Sep, 00:00–24:00 IST
const START = "2026-09-01T00:00:00.000Z";

test("the frequencies a ward actually writes are understood, and everything else is honestly not", () => {
  assert.deepEqual(parseFrequency("BD"), { kind: "times", key: "BD", perDay: 2 });
  assert.equal(parseFrequency("bid").key, "BD", "case and spelling do not change the meaning");
  assert.equal(parseFrequency("T.D.S.").key, "TDS");
  assert.equal(parseFrequency("QDS").key, "QID");
  assert.equal(parseFrequency("nocte").key, "HS");
  assert.deepEqual(parseFrequency("Q6H"), { kind: "interval", hours: 6, perDay: 4 });
  assert.equal(parseFrequency("STAT").kind, "once");
  assert.equal(parseFrequency("SOS").kind, "prn");
  assert.equal(parseFrequency("as needed").kind, "prn");

  // Not understood is a RESULT, not a default. Guessing here is a wrong dose.
  assert.equal(parseFrequency("alternate days after dialysis"), null);
  assert.equal(parseFrequency(""), null);
  assert.equal(parseFrequency(null), null);
  assert.equal(parseFrequency("Q0H"), null, "every zero hours is not an interval");
  assert.equal(parseFrequency("Q36H"), null, "not an intra-day interval this file can place");
});

test("the Indian 1-0-1 notation is read, and 0-0-0 is not a frequency", () => {
  assert.deepEqual(parseFrequency("1-0-1"), { kind: "pattern", slots: [0, 2], of: 3 });
  assert.deepEqual(parseFrequency("1-1-1"), { kind: "pattern", slots: [0, 1, 2], of: 3 });
  assert.deepEqual(parseFrequency("0-0-1"), { kind: "pattern", slots: [2], of: 3 });
  assert.deepEqual(parseFrequency("1-0-0-1"), { kind: "pattern", slots: [0, 3], of: 4 });
  assert.equal(parseFrequency("2-0-2").slots.length, 2, "the number is a quantity, not a second dose time");
  assert.equal(parseFrequency("0-0-0"), null, "an order that says never is not something to schedule");

  // A 3-slot pattern reads against the TDS round and a 4-slot one against QID, so there is one table.
  assert.deepEqual(local(scheduleSlots(order("1-0-1", START), { ...DAY, offsetMinutes: IST }).due), ["09 08:00", "09 22:00"]);
  assert.deepEqual(local(scheduleSlots(order("1-0-0-1", START), { ...DAY, offsetMinutes: IST }).due), ["09 06:00", "09 22:00"]);
});

test("named frequencies land on the ward round, in the hospital's own clock", () => {
  const on = (f) => local(scheduleSlots(order(f, START), { ...DAY, offsetMinutes: IST }).due);
  assert.deepEqual(on("OD"), ["09 08:00"]);
  assert.deepEqual(on("BD"), ["09 08:00", "09 20:00"]);
  assert.deepEqual(on("TDS"), ["09 08:00", "09 14:00", "09 22:00"]);
  assert.deepEqual(on("QID"), ["09 06:00", "09 12:00", "09 18:00", "09 22:00"]);
  assert.deepEqual(on("HS"), ["09 22:00"]);
  // Each slot is exactly once per day: a boundary must not duplicate or drop a dose. This window is
  // the 9th, 10th and 11th in IST, so TDS is nine doses.
  assert.equal(scheduleSlots(order("TDS", START), { from: DAY.from, to: "2026-09-11T18:30:00.000Z", offsetMinutes: IST }).due.length, 9);
});

test("a ward that gives its round at other times gets those times, and no second table disagrees", () => {
  const times = { BD: ["09:00", "21:00"], TDS: ["07:00", "13:00", "19:00"] };
  assert.deepEqual(local(scheduleSlots(order("BD", START), { ...DAY, offsetMinutes: IST, times }).due), ["09 09:00", "09 21:00"]);
  // The 1-0-1 notation follows the SAME override, because it reads against the TDS round.
  assert.deepEqual(local(scheduleSlots(order("1-0-1", START), { ...DAY, offsetMinutes: IST, times }).due), ["09 07:00", "09 19:00"]);
  assert.deepEqual(timesFor("BD", times), ["09:00", "21:00"]);
  assert.deepEqual(timesFor("BD", { BD: ["nonsense"] }), DEFAULT_MAR_TIMES.BD, "an unusable override falls back, it does not empty the round");
  assert.deepEqual(timesFor("OD", null), ["08:00"]);
});

test("TDS IS NOT Q8H: an interval runs from the order, not from the ward round", () => {
  // Ordered at 03:15 IST. Q8H means 03:15, 11:15, 19:15 — not the 08:00/14:00/22:00 drug round.
  const at = "2026-09-08T21:45:00.000Z";
  assert.deepEqual(local(scheduleSlots(order("Q8H", at), { ...DAY, offsetMinutes: IST }).due), ["09 03:15", "09 11:15", "09 19:15"]);
  assert.deepEqual(local(scheduleSlots(order("TDS", at), { ...DAY, offsetMinutes: IST }).due), ["09 08:00", "09 14:00", "09 22:00"]);
  // And it keeps its phase days later, rather than resetting at midnight or at the window's edge.
  const later = scheduleSlots(order("Q8H", at), { from: "2026-09-20T18:30:00.000Z", to: "2026-09-21T18:30:00.000Z", offsetMinutes: IST });
  assert.deepEqual(local(later.due), ["21 03:15", "21 11:15", "21 19:15"]);
});

test("PRN IS NEVER SCHEDULED", () => {
  // Putting an as-needed drug on the round states that it is due, which is what PRN means it is not.
  assert.deepEqual(scheduleSlots(order("PRN", START), { ...DAY, offsetMinutes: IST }).due, []);
  assert.deepEqual(scheduleSlots(order("SOS", START), { ...DAY, offsetMinutes: IST }).due, []);
  // Neither is an unreadable frequency: it is reported by marSchedule, never silently placed.
  assert.deepEqual(scheduleSlots(order("alternate days", START), { ...DAY, offsetMinutes: IST }).due, []);
});

test("STAT is one dose when it was ordered, and is not a daily anything", () => {
  const at = "2026-09-09T05:00:00.000Z";
  const s = scheduleSlots(order("STAT", at), { ...DAY, offsetMinutes: IST });
  assert.deepEqual(s.due.map(iso), [at]);
  // Ordered yesterday, so it is not due again today. A STAT that recurs is a repeated dose nobody wrote.
  assert.deepEqual(scheduleSlots(order("STAT", START), { ...DAY, offsetMinutes: IST }).due, []);
});

test("a dose is never scheduled before the order started or after the course stops", () => {
  // Written at 15:00 IST today: the 08:00 dose already passed and is NOT retro-scheduled.
  const written = "2026-09-09T09:30:00.000Z";
  assert.deepEqual(local(scheduleSlots(order("BD", written), { ...DAY, offsetMinutes: IST }).due), ["09 20:00"]);

  // A five-day course does not appear on day nine. This is the harm scheduling introduces, and the
  // reason stopAt had to exist before a schedule was allowed to assert anything is due.
  const course = order("BD", START, { stopAt: "2026-09-06T00:00:00.000Z" });
  assert.deepEqual(scheduleSlots(course, { ...DAY, offsetMinutes: IST }).due, []);
  const stillRunning = order("BD", START, { stopAt: "2026-09-09T14:00:00.000Z" });
  assert.deepEqual(local(scheduleSlots(stillRunning, { ...DAY, offsetMinutes: IST }).due), ["09 08:00"], "the dose after the stop is not given");
});

test("the window is respected exactly, and a bad one yields nothing rather than a guess", () => {
  // `to` lands exactly on the 12:00 IST slot (06:30Z). The 06:00 dose is in, the 12:00 one is not.
  const half = scheduleSlots(order("QID", START), { from: DAY.from, to: "2026-09-09T06:30:00.000Z", offsetMinutes: IST });
  assert.deepEqual(local(half.due), ["09 06:00"], "`to` is exclusive");
  assert.deepEqual(scheduleSlots(order("BD", START), { from: DAY.to, to: DAY.from, offsetMinutes: IST }).due, [], "a backwards window");
  assert.deepEqual(scheduleSlots(order("BD", START), { from: "not a date", to: DAY.to, offsetMinutes: IST }).due, []);
});

test("a hospital on another clock gets its own wall time, not the default ward's", () => {
  // Same instant, UTC hospital: the 08:00 round is 08:00 THERE.
  const utc = scheduleSlots(order("BD", START), { from: "2026-09-09T00:00:00.000Z", to: "2026-09-10T00:00:00.000Z", offsetMinutes: 0 });
  assert.deepEqual(utc.due.map(iso), ["2026-09-09T08:00:00.000Z", "2026-09-09T20:00:00.000Z"]);
  const ist = scheduleSlots(order("BD", START), { ...DAY, offsetMinutes: IST });
  assert.deepEqual(ist.due.map(iso), ["2026-09-09T02:30:00.000Z", "2026-09-09T14:30:00.000Z"], "08:00 IST is 02:30Z");
});

test("NO SILENT CAP: too many doses says so instead of looking like a complete round", () => {
  const wide = scheduleSlots(order("Q1H", START), { from: DAY.from, to: "2026-09-30T18:30:00.000Z", offsetMinutes: IST });
  assert.equal(wide.truncated, true);
  assert.equal(wide.due.length, MAX_SLOTS);
  assert.equal(scheduleSlots(order("BD", START), { ...DAY, offsetMinutes: IST }).truncated, false);
});

test("overdue means the time passed and nobody resolved it", () => {
  const due = Date.parse("2026-09-09T08:00:00.000Z");
  const late = due + 90 * 60000, soon = due + 10 * 60000;
  assert.equal(isOverdue(due, null, late), true, "90 minutes past, never started");
  assert.equal(isOverdue(due, null, soon), false, "inside the hour's grace");
  assert.equal(isOverdue(due, "scanned", late), true, "started but not finished is still not given");
  // A dose that was given, refused, held or cancelled has been dealt with. Flagging it overdue would
  // send a nurse to chase a dose somebody already made a decision about.
  //
  // These are the state machine's OWN spellings, and they are lower case. The first draft of this
  // check hand-wrote them in capitals, so it matched nothing and would have reported every dose
  // that had already been given as overdue, forever. The module now imports STATES/TERMINAL.
  for (const s of ["administered", "refused", "cancelled", "held"]) assert.equal(isOverdue(due, s, late), false, s);
  assert.equal(isOverdue(due, "ADMINISTERED", late), true, "and no second spelling is silently accepted");
  assert.equal(isOverdue(due, null, due + 5 * 60000, 0), true, "a ward with no grace flags it at once");
});
