/* Staff rostering rules (functions/_roster.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftDef, assignmentProblem, weeklyDates, coverage, onDutyAt, swapProblem, validLeave } from "../functions/_roster.js";

const SHIFTS = {
  day: shiftDef({ id: "day", name: "Day", unit: "Ward A", start: "08:00", end: "20:00", minimum: { nurse: 2, doctor: 1 } }),
  night: shiftDef({ id: "night", name: "Night", unit: "Ward A", start: "20:00", end: "08:00", minimum: { nurse: 1 } }),
  late: shiftDef({ id: "late", name: "Late", unit: "ICU", start: "14:00", end: "22:00" }),
  early: shiftDef({ id: "early", name: "Early", unit: "ICU", start: "06:00", end: "14:00" }),
};
const ROLE = { n1: "nurse", n2: "nurse", d1: "doctor" };

test("a shift definition is validated; an overnight shift is allowed", () => {
  assert.throws(() => shiftDef({ name: "X", unit: "A", start: "25:00", end: "08:00" }), /HH:MM/);
  assert.throws(() => shiftDef({ name: "X", unit: "A", start: "08:00", end: "08:00" }), /same time/);
  assert.throws(() => shiftDef({ name: "X", start: "08:00", end: "09:00" }), /ward or unit/);
  assert.deepEqual(SHIFTS.night.minimum, { nurse: 1 });
});

test("REFUSED: the same person on overlapping shifts, including across midnight", () => {
  const existing = [{ id: "a1", identity: "n1", date: "2026-09-14", shiftId: "night" }];
  assert.equal(assignmentProblem({ identity: "n1", date: "2026-09-15", shiftId: "early" }, SHIFTS, existing, []).code, "double_booked", "night 20:00-08:00 overlaps the next morning's 06:00 early shift");
  assert.equal(assignmentProblem({ identity: "n1", date: "2026-09-15", shiftId: "day" }, SHIFTS, existing, []), null, "a day shift starting as the night ends touches it but does not overlap");
  assert.equal(assignmentProblem({ identity: "n1", date: "2026-09-14", shiftId: "late" }, SHIFTS, existing, []).code, "double_booked", "late 14-22 overlaps night from 20:00");
  assert.equal(assignmentProblem({ identity: "n1", date: "2026-09-16", shiftId: "day" }, SHIFTS, existing, []), null);
  assert.equal(assignmentProblem({ identity: "n2", date: "2026-09-15", shiftId: "day" }, SHIFTS, existing, []), null, "someone else is fine");
  assert.equal(assignmentProblem({ identity: "n1", date: "2026-09-15", shiftId: "day" }, SHIFTS, [{ ...existing[0], status: "cancelled" }], []), null, "a cancelled assignment does not block");
});

test("REFUSED: rostering someone on a day of approved leave (requested leave does not block)", () => {
  const leaves = [{ identity: "n1", from: "2026-09-20", to: "2026-09-22", status: "approved" }, { identity: "n2", from: "2026-09-20", to: "2026-09-22", status: "requested" }];
  assert.equal(assignmentProblem({ identity: "n1", date: "2026-09-21", shiftId: "day" }, SHIFTS, [], leaves).code, "on_leave");
  assert.equal(assignmentProblem({ identity: "n2", date: "2026-09-21", shiftId: "day" }, SHIFTS, [], leaves), null);
  assert.equal(assignmentProblem({ identity: "n1", date: "2026-09-23", shiftId: "day" }, SHIFTS, [], leaves), null);
});

test("weekly repeats, capped at 26 weeks", () => {
  assert.deepEqual(weeklyDates("2026-09-14", 3), ["2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.equal(weeklyDates("2026-12-28", 2)[1], "2027-01-04");
  assert.equal(weeklyDates("2026-09-14", 99).length, 26);
});

test("coverage shows who is on and the exact shortfall per role, and never invents staff", () => {
  const asg = [{ identity: "n1", date: "2026-09-14", shiftId: "day" }, { identity: "d1", date: "2026-09-14", shiftId: "day" }];
  const c = coverage("2026-09-14", "2026-09-14", SHIFTS, asg, (id) => ROLE[id]);
  const day = c.find((x) => x.shiftId === "day");
  assert.deepEqual(day.staff, ["n1", "d1"]);
  assert.deepEqual(day.gaps, [{ role: "nurse", need: 2, have: 1, short: 1 }]);
  assert.deepEqual(c.find((x) => x.shiftId === "night").gaps, [{ role: "nurse", need: 1, have: 0, short: 1 }]);
  assert.deepEqual(c.find((x) => x.shiftId === "late").gaps, [], "no minimum, no gap");
  assert.throws(() => coverage("2026-09-01", "2026-12-01", SHIFTS, [], () => ""), /two months/);
});

test("on duty now respects the hospital's clock and overnight shifts", () => {
  const asg = [{ identity: "n1", date: "2026-09-14", shiftId: "night" }, { identity: "n2", date: "2026-09-15", shiftId: "day" }];
  const at0300IST = Date.UTC(2026, 8, 14, 21, 30);   // 03:00 on the 15th in IST (+330)
  assert.deepEqual(onDutyAt(at0300IST, 330, SHIFTS, asg).map((x) => x.identity), ["n1"]);
  const at0900IST = Date.UTC(2026, 8, 15, 3, 30);
  assert.deepEqual(onDutyAt(at0900IST, 330, SHIFTS, asg, "Ward A").map((x) => x.identity), ["n2"]);
  assert.deepEqual(onDutyAt(at0900IST, 330, SHIFTS, asg, "ICU"), []);
});

test("a swap is checked as if the colleague held the shift: refused when it double-books them", () => {
  const mine = { id: "a1", identity: "n1", date: "2026-09-14", shiftId: "day" };
  const existing = [mine, { id: "a2", identity: "n2", date: "2026-09-14", shiftId: "late" }];
  assert.equal(swapProblem(mine, "n2", SHIFTS, existing, []).code, "double_booked");
  assert.equal(swapProblem(mine, "n1", SHIFTS, existing, []).code, "bad_swap");
  assert.equal(swapProblem(mine, "d1", SHIFTS, existing, []), null);
  assert.throws(() => validLeave({ from: "2026-09-10", to: "2026-09-09", reason: "x" }), /from first/);
  assert.throws(() => validLeave({ from: "2026-09-10", to: "2026-09-11" }), /what the leave is for/);
});
