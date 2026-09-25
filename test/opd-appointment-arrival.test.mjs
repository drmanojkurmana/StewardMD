/* OPD plan item 8: a booked patient who ARRIVES joins the OPD queue.
 *
 * Marking an appointment arrived used to update the record only, so a booked patient then had to be
 * registered again at the desk as a walk-in. Now the arrival adds them to the OPD pool and the answer
 * carries the token - once, however often the arrival is retried.
 *
 * node --test --experimental-test-module-mocks test/opd-appointment-arrival.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docs, seedHospital, as, admittedPatient, ORG, DOCTOR } from "./_wardsynq-alert-harness.mjs";

const tickets = () => [...docs.entries()].filter(([k]) => k.startsWith("q_tickets/")).map(([, d]) => d.fields);

test("arrival adds the patient to the OPD queue and returns the token, exactly once", async () => {
  seedHospital();
  const { patientId } = await admittedPatient();
  const booked = await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId, clinicianId: "cfa:dr-clinic", startAt: new Date(Date.now() + 3600e3).toISOString(), minutes: 15, reason: "Review" });
  assert.equal(booked.__status, 200, JSON.stringify(booked));
  const before = tickets().length;

  const arrived = await as(DOCTOR, "/ward/appointment", "POST", { orgId: ORG, appointmentId: booked.appointmentId, state: "arrived" });
  assert.equal(arrived.__status, 200, JSON.stringify(arrived));
  assert.ok(arrived.queueTicket && arrived.queueTicket.id, "the arrival carries the token: " + JSON.stringify(arrived).slice(0, 300));
  assert.equal(tickets().length, before + 1, "one ticket in the queue");
  assert.equal(tickets().find((t) => t.patientId === patientId).patientId, patientId, "the ticket is this patient");

  const again = await as(DOCTOR, "/ward/appointment", "POST", { orgId: ORG, appointmentId: booked.appointmentId, state: "arrived" });
  assert.equal(again.__status, 200);
  assert.equal(again.queueTicket, undefined, "a retried arrival adds no second token");
  assert.equal(tickets().length, before + 1);
});
