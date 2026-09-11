/* test/wardsynq-portal-requests.test.mjs — the patient asks; a human answers.
 *
 * node --test test/wardsynq-portal-requests.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MESSAGE_TYPE, REQUEST_TYPE, MAX_BODY, NOT_EMERGENCY,
  patientWriteActor, waitingHours, worklist, PatientMessage,
} from "../functions/_wardsynq/portal-requests.js";
import { RESOURCE_TYPES } from "../functions/_wardsynq/service.js";
import { TIER } from "../wardsynq/wardsynq-actors.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/portal-requests.js", import.meta.url), "utf8");
const PORTAL = readFileSync(new URL("../functions/api/portal/[[path]].js", import.meta.url), "utf8");

test("THIS IS NOT A CHANNEL FOR AN EMERGENCY, and it says so where it will be read", () => {
  /* A patient with crushing chest pain who types it into a portal because the portal was there, and
   * waits, is the worst outcome this feature can produce. */
  assert.match(NOT_EMERGENCY, /not a way to get urgent help/);
  assert.match(NOT_EMERGENCY, /emergency services/);
  assert.match(NOT_EMERGENCY, /may take days/);

  // Stamped on the stored row, so a reader later knows what the patient had been told.
  const m = PatientMessage({ id: "m1", patientId: "p1", body: "hello", sentAt: "2026-09-08T09:00:00.000Z" });
  assert.equal(m.channelWarning, NOT_EMERGENCY);
  // And returned even on a refusal, not only on success.
  assert.ok(/error: "message_required", written: 0, notEmergency: NOT_EMERGENCY/.test(SRC));
});

test("A PATIENT CANNOT BOOK: the request reserves nothing and holds no slot", () => {
  /* AppointmentRequest already exists with this rule for a clinician's promised follow-up, and it is
   * no less true when the patient asked: auto-booking makes a promise look kept when nobody has
   * spoken to them. */
  const reqFn = SRC.slice(SRC.indexOf("async function requestAppointment"));
  assert.ok(/state: "outstanding"/.test(reqFn));
  assert.ok(/NOTHING IS BOOKED YET/.test(reqFn));
  /* The record it writes is the REQUEST type. An `Appointment` is the thing that holds a slot, and
   * nothing here creates one. */
  assert.ok(/resourceType: REQUEST_TYPE/.test(reqFn));
  assert.ok(!/resourceType: "Appointment"/.test(SRC), "no slot-holding Appointment is ever written");
  assert.equal(REQUEST_TYPE, "AppointmentRequest");
  // Who asked is recorded: a clerk reads a patient's request differently from a clinician's promise.
  assert.ok(/origin: "patient"/.test(reqFn));
});

test("NOTHING AUTO-REPLIES, and the ladder is the structural half of that", () => {
  /* A reassuring automatic reply to "my chest hurts" is a clinical act performed by a machine on a
   * person who believed they had contacted their doctor. A reply needs EMR_TREAT, and an AI actor is
   * capped at DRAFT by its kind so the store itself would refuse it. */
  const replyFn = SRC.slice(SRC.indexOf("async function replyToMessage"));
  assert.ok(/"record:write"/.test(replyFn));
  assert.ok(/resolved\.actor\.id/.test(replyFn), "the reply carries the clinician's own identity");
  // No model, no generation, anywhere in the file.
  assert.ok(!/openai|anthropic|generate|llm|maik/i.test(SRC));
});

test("AN UNREAD MESSAGE IS THE FAILURE MODE, so it is measured and sorted oldest first", () => {
  const now = "2026-09-08T12:00:00.000Z";
  const w = worklist([
    { id: "a", patientId: "p1", sentAt: "2026-09-08T11:00:00.000Z" },
    { id: "b", patientId: "p2", sentAt: "2026-09-05T12:00:00.000Z" },
    { id: "c", patientId: "p3", sentAt: "2026-09-08T10:00:00.000Z", answeredAt: "2026-09-08T10:30:00.000Z" },
  ], now);

  assert.equal(w.open, 2, "an answered message is not on the list");
  /* Oldest first and never newest first: a queue sorted the other way buries the failure at the
   * bottom of the page, which is exactly where it stays. */
  assert.deepEqual(w.messages.map((m) => m.messageId), ["b", "a"]);
  assert.equal(w.messages[0].waitingHours, 72);
  assert.equal(w.longestWaitingHours, 72);
  assert.match(w.warning, /72 hours/);
  assert.match(w.warning, /nobody is watching this list/);

  // Under the threshold there is no false alarm, and an empty list has no longest wait.
  assert.equal(worklist([{ id: "a", sentAt: "2026-09-08T11:00:00.000Z" }], now).warning, undefined);
  assert.equal(worklist([], now).longestWaitingHours, null);
  // An unreadable timestamp is null, never zero - "we cannot tell" is not "it just arrived".
  assert.equal(waitingHours("nonsense", now), null);
  assert.equal(waitingHours(null, now), null);
});

test("what a patient sends is a REQUEST, and the ladder says so", () => {
  const a = patientWriteActor("pat-1");
  /* DRAFT rather than EXECUTE on purpose: a patient's message is a proposal, and encoding that in
   * the tier means every route does not have to remember it. */
  assert.equal(a.tier, TIER.DRAFT);
  assert.ok(a.id.startsWith("patient:"));
  assert.deepEqual([...a.scope.write].sort(), [REQUEST_TYPE, MESSAGE_TYPE].sort());
  // It cannot touch anything clinical.
  assert.ok(!a.scope.write.includes("Observation"));
  assert.ok(!a.scope.write.includes("Condition"));
  assert.ok(!a.scope.write.includes("MedicationOrder"));
  assert.ok(!a.scope.read.includes("DiagnosticReport"), "the write actor is not the read actor");
});

test("THE PATIENT ID COMES FROM THE GRANT on the write side too", () => {
  /* A session that took a patient id from its caller could write a message onto anybody's record. */
  assert.ok(/patientId: session\.patientId/.test(PORTAL));
  assert.ok(!/body\.patientId/.test(PORTAL));
  // And the session is checked BEFORE anything is written.
  const block = PORTAL.slice(PORTAL.indexOf('sub === "message"'));
  assert.ok(block.indexOf("sessionPatient") < block.indexOf("sendMessage"));
});

test("a message has a bound, and both types are append-only", () => {
  assert.equal(MAX_BODY, 2000);
  assert.ok(/message_too_long/.test(SRC));
  assert.ok(RESOURCE_TYPES.includes(MESSAGE_TYPE));
  assert.ok(RESOURCE_TYPES.includes(REQUEST_TYPE));
});
