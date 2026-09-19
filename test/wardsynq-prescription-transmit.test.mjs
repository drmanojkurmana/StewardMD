/* test/wardsynq-prescription-transmit.test.mjs — sending a prescription, and knowing it arrived.
 *
 * node --test test/wardsynq-prescription-transmit.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, CHANNELS, PrescriptionTransmission, transmissionIdFor, payloadFor, isOutstanding } from "../functions/_wardsynq/prescription-transmit.js";

const ORDER = {
  id: "wsq-rx-1", version: 3, patientId: "pat", encounterId: "enc", status: "active",
  drug: "Amoxicillin", drugCode: "723", drugCodeSystem: "rxnorm",
  dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TDS", prescriberId: "cfa:dr",
};
const PATIENT = { id: "pat", name: "Asha Rao", mrn: "SMD-1", dob: "1972-04-02", sex: "female", note: "should not travel" };

test("QUEUED IS NOT SENT, AND SENT IS NOT ACKNOWLEDGED", () => {
  /* Collapsing these is how a system tells a clinician a prescription is at the pharmacy when it is
   * sitting in an outbox. `sent` means the transport reported it left; `acknowledged` means the far
   * end said it has it. */
  assert.deepEqual(STATES, ["queued", "sent", "acknowledged", "failed"]);
  const q = PrescriptionTransmission({ id: "t", orderId: "o", state: "queued" });
  assert.equal(q.sentAt, null);
  assert.equal(q.acknowledgedAt, null);
  // Only acknowledged is finished. Everything else still needs a human.
  assert.equal(isOutstanding({ state: "queued" }), true);
  assert.equal(isOutstanding({ state: "sent" }), true, "left the building is not arrived");
  assert.equal(isOutstanding({ state: "failed" }), true);
  assert.equal(isOutstanding({ state: "acknowledged" }), false);
});

test("A FAILURE STAYS LOUD until a human resolves it", () => {
  const failed = { state: "failed", failureReason: "Pharmacy endpoint refused the message." };
  assert.equal(isOutstanding(failed), true);
  /* It does not retry into silence and does not clear itself: an undelivered prescription is a
   * patient who goes to the pharmacy and is told there is nothing for them. */
  assert.equal(isOutstanding({ ...failed, attempts: 9 }), true);
  // Resolving it takes it off the list - and the state stays `failed`, because it was never
  // acknowledged and saying otherwise would put a delivery that did not happen on the record.
  const resolved = { ...failed, resolvedAt: "2026-09-07T10:00:00.000Z", resolution: "Printed and handed to the patient." };
  assert.equal(isOutstanding(resolved), false);
  assert.equal(resolved.state, "failed");
});

test("THE PAYLOAD CARRIES WHAT A DISPENSER NEEDS, AND NO CLINICAL HISTORY", () => {
  const p = payloadFor(ORDER, PATIENT);
  assert.equal(p.prescription.drug, "Amoxicillin");
  assert.deepEqual(p.prescription.dose, { value: 500, unit: "mg" });
  assert.equal(p.prescription.orderVersion, 3, "so a pharmacy holding two can tell them apart");
  // The minimum that identifies the right person at a counter.
  assert.equal(p.patient.name, "Asha Rao");
  assert.equal(p.patient.mrn, "SMD-1");
  /* A prescription sent with the patient's whole record attached is a privacy incident waiting to
   * be one, and none of it helps somebody count out tablets. */
  assert.equal(p.patient.note, undefined);
  assert.equal(Object.keys(p).length, 2);
  assert.deepEqual(Object.keys(p.patient).sort(), ["dob", "mrn", "name", "sex"]);
  // An uncoded drug does not acquire a code system on the way out.
  const uncoded = payloadFor({ ...ORDER, drugCode: null }, PATIENT);
  assert.equal(uncoded.prescription.drugCode, null);
  assert.equal(uncoded.prescription.drugCodeSystem, null);
  assert.equal(payloadFor(null, PATIENT), null);
});

test("a changed prescription is a NEW transmission, and the old one is still what was sent", () => {
  const v3 = transmissionIdFor("wsq-rx-1", 3, "pharmacy");
  assert.equal(v3, transmissionIdFor("WSQ/RX 1", 3, "pharmacy"));
  // The prescriber doubles the dose: version 4 is a different message entirely.
  assert.notEqual(v3, transmissionIdFor("wsq-rx-1", 4, "pharmacy"));
  // The same version to a different destination is also its own transmission.
  assert.notEqual(v3, transmissionIdFor("wsq-rx-1", 3, "patient"));
  assert.equal(transmissionIdFor("wsq-rx-1", null, "pharmacy"), null);
  assert.equal(transmissionIdFor("", 1, "pharmacy"), null);
});

test("print is a first-class destination, not a failure to have a network", () => {
  assert.ok(CHANNELS.includes("print"));
  assert.deepEqual(CHANNELS, ["pharmacy", "patient", "print", "external-system"]);
  // An unknown channel falls back to print rather than to something that claims a network.
  assert.equal(PrescriptionTransmission({ id: "t", orderId: "o", channel: "carrier-pigeon" }).channel, "print");
});

test("the payload is kept verbatim, so the record can say what they GOT", () => {
  const sent = PrescriptionTransmission({ id: "t", orderId: "wsq-rx-1", orderVersion: 3, payload: payloadFor(ORDER, PATIENT) });
  /* A transmission whose content could be regenerated from the current order would answer "what
   * does the order say now", not "what did they get". */
  assert.equal(sent.payload.prescription.dose.value, 500);
  assert.equal(sent.orderVersion, 3);
  assert.equal(sent.attempts, 0);
  assert.equal(PrescriptionTransmission({ id: "t", orderId: "o", attempts: "many" }).attempts, 0, "a non-number is not a count");
});
