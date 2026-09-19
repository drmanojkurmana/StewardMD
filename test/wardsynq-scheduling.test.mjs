/* test/wardsynq-scheduling.test.mjs — appointments, and the follow-up that was promised. Pure half.
 *
 * node --test test/wardsynq-scheduling.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, HOLDS_SLOT, Appointment, AppointmentRequest, appointmentIdFor, recallIdFor, overlaps, recallStatus } from "../functions/_wardsynq/scheduling.js";

const at = (iso, minutes) => ({ startAt: iso, minutes });

test("two appointments collide when they overlap, and only when both are comparable", () => {
  const a = at("2026-09-10T09:00:00.000Z", 15);
  assert.equal(overlaps(a, at("2026-09-10T09:10:00.000Z", 15)), true, "starts inside it");
  assert.equal(overlaps(a, at("2026-09-10T08:50:00.000Z", 15)), true, "ends inside it");
  assert.equal(overlaps(a, at("2026-09-10T08:45:00.000Z", 60)), true, "swallows it");
  // Back to back is not a clash: 09:15 starts exactly when 09:00-09:15 ends.
  assert.equal(overlaps(a, at("2026-09-10T09:15:00.000Z", 15)), false);
  assert.equal(overlaps(a, at("2026-09-10T08:45:00.000Z", 15)), false);
  /* An appointment with no length cannot be compared, so it reports NO clash - which is exactly why
   * booking requires a duration. Without that requirement this invariant would be silently off. */
  assert.equal(overlaps(a, { startAt: "2026-09-10T09:05:00.000Z" }), false);
  assert.equal(overlaps(a, at("not a date", 15)), false);
});

test("only a live appointment holds its slot", () => {
  assert.deepEqual([...HOLDS_SLOT].sort(), ["arrived", "booked"]);
  // Cancelled, completed and did-not-attend all free the time for somebody else.
  for (const s of ["cancelled", "completed", "did-not-attend"]) assert.ok(!HOLDS_SLOT.includes(s), s);
  assert.deepEqual(STATES, ["booked", "arrived", "completed", "cancelled", "did-not-attend"]);
});

test("DID-NOT-ATTEND IS RECORDED, NEVER INFERRED FROM THE CLOCK", () => {
  /* A slot whose time has passed with nobody marking it is not a DNA - it is an appointment nobody
   * updated. Treating time alone as evidence of absence would put a DNA on the record of every
   * patient a clinic was too busy to check in. */
  const stale = Appointment({ id: "a1", patientId: "p", clinicianId: "c", startAt: "2020-01-01T09:00:00.000Z", minutes: 15 });
  assert.equal(stale.state, "booked", "years later, still just booked");
  assert.equal(stale.changedAt, null);
  // A DNA is a state somebody set, with a name against it.
  const dna = Appointment({ ...stale, state: "did-not-attend", changedBy: "cfa:desk", changeReason: "Did not attend, no contact." });
  assert.equal(dna.state, "did-not-attend");
  assert.equal(dna.changedBy, "cfa:desk");
});

test("A RECALL IS A REQUEST, and stays visibly outstanding until somebody books it", () => {
  const r = AppointmentRequest({ id: "r1", patientId: "p", reason: "Review after discharge", dueBy: "2026-09-14T00:00:00.000Z", requestedBy: "cfa:dr" });
  assert.equal(r.state, "open");
  assert.equal(r.appointmentId, null, "nothing is booked by promising it");
  // Overdue is COMPUTED, never stored: a stored flag goes stale by the hour.
  assert.deepEqual(recallStatus(r, Date.parse("2026-09-13T00:00:00.000Z")), { state: "open", overdueDays: 0 });
  assert.deepEqual(recallStatus(r, Date.parse("2026-09-17T00:00:00.000Z")), { state: "overdue", overdueDays: 3 });
  // Once booked it stops being chased, and a cancelled one is not overdue either.
  assert.equal(recallStatus({ ...r, state: "booked" }, Date.parse("2026-10-01T00:00:00.000Z")).state, "booked");
  assert.equal(recallStatus({ ...r, state: "cancelled" }, Date.parse("2026-10-01T00:00:00.000Z")).state, "cancelled");
  // A recall with no due date is open but never overdue: a wish is not a deadline.
  assert.deepEqual(recallStatus({ ...r, dueBy: null }, Date.parse("2030-01-01T00:00:00.000Z")), { state: "open", overdueDays: 0 });
  assert.equal(recallStatus(null).state, "none");
});

test("ids are deterministic, so a retried booking is the same appointment", () => {
  const a = appointmentIdFor("cfa:dr", "2026-09-10T09:00:00.000Z", "pat");
  assert.equal(a, appointmentIdFor("CFA:DR", "2026-09-10T09:00:00.000Z", "PAT"));
  // A different patient at the same time is a different appointment - which is what the clash check
  // then has to catch, rather than the id silently merging them into one.
  assert.notEqual(a, appointmentIdFor("cfa:dr", "2026-09-10T09:00:00.000Z", "other"));
  assert.notEqual(a, appointmentIdFor("cfa:dr", "2026-09-10T09:30:00.000Z", "pat"));
  assert.equal(appointmentIdFor("", "t", "p"), null);
  // A recall is per patient, encounter and reason: two different follow-ups from one stay stay two.
  assert.notEqual(recallIdFor("p", "e1", "Review chest film"), recallIdFor("p", "e1", "Repeat bloods"));
  assert.equal(recallIdFor("p", "", "Review"), recallIdFor("p", null, "Review"));
  assert.equal(recallIdFor("", "e", "r"), null);
});

test("overbooking is possible and says it is overbooking", () => {
  const plain = Appointment({ id: "a", patientId: "p", clinicianId: "c", startAt: "2026-09-10T09:00:00.000Z", minutes: 15 });
  assert.equal(plain.overbooked, false);
  assert.equal(plain.overbookReason, null);
  /* Real clinics overbook, and a system that refuses will be worked around - so it is allowed and
   * visible, never something that happens because two people clicked at once. */
  const over = Appointment({ ...plain, overbooked: true, overbookReason: "Urgent review, consultant agreed." });
  assert.equal(over.overbooked, true);
  assert.match(over.overbookReason, /consultant agreed/);
});
