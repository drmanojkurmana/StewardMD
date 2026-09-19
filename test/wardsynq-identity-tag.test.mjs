/* test/wardsynq-identity-tag.test.mjs — TASK 6.14: the wristband/QR/NFC tag lifecycle engine.
 * node --test test/wardsynq-identity-tag.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAG_TYPES, STATUS, IdentityTagError,
  assignTag, verifyTag, deactivateTag, reportLost, replaceTag,
} from "../wardsynq/wardsynq-identity-tag.js";

test("assignTag refuses without patient, type, code or actor", () => {
  assert.throws(() => assignTag({ tagType: "wristband", code: "A1", assignedBy: "n1" }), IdentityTagError);
  assert.throws(() => assignTag({ patientId: "p1", code: "A1", assignedBy: "n1" }), IdentityTagError);
  assert.throws(() => assignTag({ patientId: "p1", tagType: "wristband", assignedBy: "n1" }), IdentityTagError);
  assert.throws(() => assignTag({ patientId: "p1", tagType: "wristband", code: "A1" }), IdentityTagError);
  assert.throws(() => assignTag({ patientId: "p1", tagType: "carrier-pigeon", code: "A1", assignedBy: "n1" }), IdentityTagError);
});

test("assignTag normalises the code and starts active", () => {
  const t = assignTag({ patientId: "p1", tagType: "wristband", code: "  a1-b2  ", assignedBy: "n1", now: "2026-01-01T00:00:00Z" });
  assert.equal(t.code, "A1-B2");
  assert.equal(t.status, STATUS.ACTIVE);
  assert.equal(t.history.length, 1);
});

test("verifyTag matches case/whitespace-insensitively, and refuses a non-active tag", () => {
  const t = assignTag({ patientId: "p1", tagType: "wristband", code: "A1B2", assignedBy: "n1" });
  assert.equal(verifyTag(t, "a1 b2").matches, true);
  assert.equal(verifyTag(t, "a1 b2").matches, true, "whitespace inside the code is also normalised");
  assert.equal(verifyTag(t, "WRONG").matches, false);
  assert.equal(verifyTag(null, "A1B2").matches, false);
  deactivateTag(t, { by: "n1", reason: "discharge" });
  assert.equal(verifyTag(t, "A1B2").matches, false, "an ended tag never verifies again, even with the right code");
});

test("deactivateTag requires an actor and a real reason, and only works on an active tag", () => {
  const t = assignTag({ patientId: "p1", tagType: "wristband", code: "A1", assignedBy: "n1" });
  assert.throws(() => deactivateTag(t, { reason: "discharge" }), IdentityTagError);
  assert.throws(() => deactivateTag(t, { by: "n1", reason: "x" }), IdentityTagError, "too short to be a real reason");
  deactivateTag(t, { by: "n1", reason: "patient discharged" });
  assert.equal(t.status, STATUS.DEACTIVATED);
  assert.throws(() => deactivateTag(t, { by: "n1", reason: "again" }), IdentityTagError, "cannot deactivate what is already ended");
});

test("reportLost is its own state, distinct from deactivated", () => {
  const t = assignTag({ patientId: "p1", tagType: "wristband", code: "A1", assignedBy: "n1" });
  reportLost(t, { by: "n1", reason: "fell off during transfer" });
  assert.equal(t.status, STATUS.LOST);
  assert.notEqual(t.status, STATUS.DEACTIVATED);
});

test("replaceTag ends the old tag and issues a new one in one call, chained by id", () => {
  const old = assignTag({ patientId: "p1", tagType: "wristband", code: "A1", assignedBy: "n1", now: "2026-01-01T00:00:00Z" });
  const { old: endedOld, next } = replaceTag(old, { newCode: "B2", by: "n2", reason: "band damaged in transit", now: "2026-01-01T01:00:00Z" });
  assert.equal(endedOld.status, STATUS.REPLACED);
  assert.equal(next.status, STATUS.ACTIVE);
  assert.equal(next.code, "B2");
  assert.equal(next.replacesTagId, old.id);
  assert.equal(next.patientId, old.patientId);
  assert.equal(next.tagType, old.tagType);
});

test("replaceTag also works from LOST (issuing a fresh tag after a loss), and keeps the lost reason intact", () => {
  const old = assignTag({ patientId: "p1", tagType: "wristband", code: "A1", assignedBy: "n1" });
  reportLost(old, { by: "n1", reason: "fell off during transfer" });
  const { old: endedOld, next } = replaceTag(old, { newCode: "C3", by: "n2", reason: "reissuing after loss" });
  assert.equal(endedOld.status, STATUS.LOST, "the loss is why it ended, not the replacement - status stays LOST");
  assert.equal(endedOld.endedReason, "fell off during transfer", "the ORIGINAL loss reason is preserved, not overwritten by the replace reason");
  assert.equal(next.status, STATUS.ACTIVE);
});

test("replaceTag refuses on an already-replaced or already-deactivated tag - assign a fresh one instead", () => {
  const t1 = assignTag({ patientId: "p1", tagType: "wristband", code: "A1", assignedBy: "n1" });
  const { old: replaced } = replaceTag(t1, { newCode: "B2", by: "n1", reason: "damaged" });
  assert.throws(() => replaceTag(replaced, { newCode: "C3", by: "n1", reason: "again" }), IdentityTagError);

  const t2 = assignTag({ patientId: "p1", tagType: "wristband", code: "A1", assignedBy: "n1" });
  deactivateTag(t2, { by: "n1", reason: "discharge" });
  assert.throws(() => replaceTag(t2, { newCode: "D4", by: "n1", reason: "x" }), IdentityTagError);
});

test("TAG_TYPES names exactly wristband, qr, nfc - no invented physical mechanism", () => {
  assert.deepEqual(TAG_TYPES, ["wristband", "qr", "nfc"]);
});
