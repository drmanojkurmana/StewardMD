/* test/wardsynq-specimen.test.mjs — the sample somebody has to take. Pure half.
 *
 * node --test test/wardsynq-specimen.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, SpecimenCollection, specimenIdFor, isOutstanding, collectionState } from "../functions/_wardsynq/specimen.js";

const spec = (over) => SpecimenCollection({ id: "s1", serviceRequestId: "sr-1", patientId: "pat", ...(over || {}) });

test("AN ORDER NOBODY COLLECTED IS NOT AN ORDER AWAITING A RESULT", () => {
  /* This is the whole reason the file exists. Both read as "requested, no result yet", and only one
   * of them has a nurse who still has to go and do something. */
  const none = collectionState([]);
  assert.equal(none.state, "none");
  assert.match(none.detail, /No sample has been taken/);
  assert.equal(collectionState(null).state, "none");
});

test("COLLECTED IS NOT RECEIVED: a tube in a pocket is not a tube on the bench", () => {
  assert.deepEqual(STATES, ["collected", "received", "failed"]);
  assert.equal(collectionState([spec({ state: "collected", collectedAt: "2026-09-07T09:00:00.000Z" })]).state, "collected");
  // The space between these two is where samples are lost; collapsing them would let a ward believe
  // the lab has something it has never seen.
  assert.equal(isOutstanding(spec({ state: "collected" })), true);
  assert.equal(isOutstanding(spec({ state: "received" })), false);
  assert.equal(isOutstanding(spec({ state: "failed" })), true, "a failed attempt still needs doing");

  // Received wins over any other attempt: the laboratory has one, whatever happened to the others.
  const mixed = [spec({ id: "a", state: "failed", failedAt: "2026-09-07T09:00:00.000Z" }), spec({ id: "b", state: "received", receivedAt: "2026-09-07T10:00:00.000Z" })];
  assert.equal(collectionState(mixed).state, "received");
  assert.equal(collectionState(mixed).specimenId, "b");
});

test("EVERY ATTEMPT FAILED MUST NEVER READ AS 'IN PROGRESS'", () => {
  /* The order needs doing again, and nobody is going to be told by a result arriving. A ward that
   * reads this as in-flight waits forever for a potassium that is never coming. */
  const s = collectionState([
    spec({ id: "a", state: "failed", failureReason: "Missed vein", failedAt: "2026-09-07T09:00:00.000Z" }),
    spec({ id: "b", state: "failed", failureReason: "Haemolysed, lab rejected", failedAt: "2026-09-07T10:00:00.000Z" }),
  ]);
  assert.equal(s.state, "failed");
  assert.equal(s.attempts, 2);
  assert.equal(s.reason, "Haemolysed, lab rejected", "the most recent reason is the actionable one");
  assert.match(s.detail, /still needs taking/);
});

test("A SECOND ATTEMPT IS A SECOND SPECIMEN, and the first one is not erased", () => {
  const a = specimenIdFor("wsq-sr-1", "2026-09-07T09:00:00.000Z");
  assert.equal(a, specimenIdFor("WSQ/SR 1", "2026-09-07T09:00:00.000Z"), "a retry at the same instant is the same sample");
  /* An id keyed only on the request would overwrite the failure - erasing the fact that the patient
   * was bled twice, which is exactly what a complaint asks about. */
  assert.notEqual(a, specimenIdFor("wsq-sr-1", "2026-09-07T09:40:00.000Z"));
  assert.equal(specimenIdFor("", "t"), null);
  assert.equal(specimenIdFor("wsq-sr-1", ""), null);
});

test("NO SPECIMEN TYPE IS INVENTED, and no result is ever produced here", () => {
  const s = spec({ specimenType: null, container: null });
  // A system that guesses the tube from the test name tells the laboratory the wrong thing with
  // total confidence.
  assert.equal(s.specimenType, null);
  assert.equal(s.container, null);
  // Nothing in this record can carry a value: collection is a specimen fact, the result is the
  // laboratory's, and a file that could do both would let whoever draws the blood say what it showed.
  assert.equal(s.value, undefined);
  assert.equal(s.code, undefined);
  assert.equal(s.resourceType, "SpecimenCollection");
  // An unknown state is never accepted as a claim.
  assert.equal(spec({ state: "resulted" }).state, "collected");
});
