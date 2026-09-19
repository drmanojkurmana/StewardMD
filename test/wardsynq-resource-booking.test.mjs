/* test/wardsynq-resource-booking.test.mjs — the room, the theatre and the scanner. Pure.
 *
 * node --test test/wardsynq-resource-booking.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, resolveResources, ResourceBooking, bookingIdFor, clashWith } from "../functions/_wardsynq/resource-booking.js";

const b = (over) => ResourceBooking({ id: "b1", resourceId: "ct-1", startAt: "2026-09-07T09:00:00.000Z", minutes: 30, state: "booked", ...(over || {}) });

test("THERE IS NO OVERBOOKED FLAG, because two patients do not fit in one scanner", () => {
  /* scheduling.js ALLOWS a clinician's diary to be overbooked - real clinics do it, and a system
   * that refuses is worked around. A room is different in kind, and offering an override here would
   * produce a diary saying two people are in a place only one of them can be. */
  assert.deepEqual(STATES, ["booked", "cancelled", "completed"]);
  const r = b();
  assert.equal(r.overbooked, undefined);
  assert.equal(r.overbookReason, undefined);
});

test("ONLY A LIVE BOOKING BLOCKS", () => {
  const existing = [b({ id: "b0", startAt: "2026-09-07T09:15:00.000Z", minutes: 30 })];
  const clash = clashWith(b({ id: "b1" }), existing);
  assert.equal(clash.id, "b0", "an overlapping live booking blocks");

  /* A cancelled booking has freed the room. Treating it as a clash would make a cancelled slot
   * unbookable forever, which is how a scheduler ends up keeping a paper list. */
  assert.equal(clashWith(b({ id: "b1" }), [b({ id: "b0", state: "cancelled", startAt: "2026-09-07T09:15:00.000Z" })]), null);
  // A booking on a DIFFERENT resource at the same time is not a clash.
  assert.equal(clashWith(b({ id: "b1" }), [b({ id: "b0", resourceId: "mri-1", startAt: "2026-09-07T09:15:00.000Z" })]), null);
  // Nor is the same booking against itself, which is what makes a retry idempotent rather than a
  // permanent self-collision.
  assert.equal(clashWith(b({ id: "b1" }), [b({ id: "b1" })]), null);
  // Touching but not overlapping: 09:00+30 ends exactly as 09:30 begins.
  assert.equal(clashWith(b({ id: "b1" }), [b({ id: "b0", startAt: "2026-09-07T09:30:00.000Z" })]), null);
});

test("a resource the hospital does not have is not a resource", () => {
  const { resources, problems } = resolveResources([
    { id: "ct-1", name: "CT scanner", kind: "equipment", location: "Radiology" },
    { id: "th-1", name: "Theatre 1", kind: "theatre" },
    { name: "no id" },
  ]);
  assert.deepEqual(resources.map((r) => r.id), ["ct-1", "th-1"]);
  // Reported, because a room that vanished from the list looks exactly like one the hospital does
  // not have - and somebody would add a second one.
  assert.deepEqual(problems.map((p) => p.reason), ["no_id"]);
  // An unknown kind is "other" rather than refused: the kind is a label, not a rule.
  assert.equal(resolveResources([{ id: "x", kind: "spaceship" }]).resources[0].kind, "other");
  assert.deepEqual(resolveResources(null).resources, []);
});

test("one booking per resource and instant, so a retry is the same booking", () => {
  const id = bookingIdFor("ct-1", "2026-09-07T09:00:00.000Z");
  assert.equal(id, bookingIdFor("CT/1", "2026-09-07T09:00:00.000Z"));
  assert.notEqual(id, bookingIdFor("ct-1", "2026-09-07T09:30:00.000Z"));
  assert.notEqual(id, bookingIdFor("mri-1", "2026-09-07T09:00:00.000Z"));
  assert.equal(bookingIdFor("", "t"), null);
  assert.equal(bookingIdFor("ct-1", ""), null);
});
