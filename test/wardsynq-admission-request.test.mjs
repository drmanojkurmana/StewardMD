/* test/wardsynq-admission-request.test.mjs — the patient promised a bed. Pure.
 *
 * node --test test/wardsynq-admission-request.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, URGENCY, AdmissionRequest, requestIdFor, waitingHours, rank } from "../functions/_wardsynq/admission-request.js";

const req = (over) => AdmissionRequest({ id: "r1", patientId: "pat", requestedAt: "2026-09-01T09:00:00.000Z", state: "waiting", ...(over || {}) });
const NOW = Date.parse("2026-09-07T09:00:00.000Z");

test("A WAITING-LIST ENTRY HOLDS NO BED, and the record has nowhere to put one", () => {
  /* Reserving a bed for a patient who is not in it makes the board show full while beds stand empty,
   * and a ward that cannot trust the board stops reading it. */
  const r = req({ ward: "Medical A" });
  assert.equal(r.ward, "Medical A", "a PREFERENCE");
  assert.equal(r.bed, undefined, "and there is no bed field to allocate one into");
  assert.deepEqual(STATES, ["waiting", "admitted", "cancelled"]);
});

test("HOW LONG SOMEBODY HAS WAITED IS COMPUTED, so it cannot go stale", () => {
  assert.equal(waitingHours(req(), NOW), 144);
  // Once it is no longer waiting there is no wait: a closed request with a growing number would be
  // a queue that never empties on any report.
  assert.equal(waitingHours(req({ state: "admitted" }), NOW), null);
  assert.equal(waitingHours(req({ state: "cancelled" }), NOW), null);
  assert.equal(waitingHours(req({ requestedAt: "whenever" }), NOW), null);
  assert.equal(waitingHours(null, NOW), null);
});

test("THE SICKEST FIRST, THEN THE LONGEST WAITING - never the other way round", () => {
  assert.deepEqual(URGENCY, ["emergency", "urgent", "soon", "elective"]);
  assert.ok(rank(req({ urgency: "emergency" })) < rank(req({ urgency: "elective" })));
  /* TWO GUARDS, both needed. The factory refuses to STORE an urgency the hospital did not use,
   * normalising it to the least urgent value - so an unknown word can never jump the queue by being
   * written. And `rank` sorts one LAST if a row ever reaches it anyway, which a row read from an
   * older version of the record could. */
  assert.equal(req({ urgency: "whenever" }).urgency, "elective", "never stored as something urgent");
  assert.equal(rank({ urgency: "whenever" }), URGENCY.length, "and never sorted to the front");
  assert.equal(rank({}), URGENCY.length);
});

test("A PATIENT MAY BE ON THE LIST TWICE, and the second promise never replaces the first", () => {
  /* A medical bed now and a surgical slot next month are two different promises. An id keyed on the
   * patient alone would have silently replaced one with the other. */
  const a = requestIdFor("pat", "Medicine", "2026-09-01T09:00:00.000Z");
  assert.notEqual(a, requestIdFor("pat", "Surgery", "2026-09-01T09:00:00.000Z"));
  assert.notEqual(a, requestIdFor("pat", "Medicine", "2026-10-01T09:00:00.000Z"));
  // The same request submitted twice is the same request.
  assert.equal(a, requestIdFor("PAT", "medicine", "2026-09-01T09:00:00.000Z"));
  assert.equal(requestIdFor("", "Medicine", "t"), null);
  assert.equal(requestIdFor("pat", "Medicine", ""), null);
});
