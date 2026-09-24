/* Plan item 10 + F3: a released result brings the patient back from investigation into the OPD queue.
 *
 * The lab releases against the RECORD's patient (opd-pat-<mrn>); the desk's ticket carries the MRN. F3 found the
 * two never matched, so the recall silently did nothing. Real routes: register, queue at the desk, order, collect,
 * release; the patient sent for tests is back in the queue with the result marked ready.
 *
 * node --test --experimental-test-module-mocks test/opd-result-back.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
const { seedHospital, as, admittedPatient, docs, ORG, DOCTOR, LAB, ADMIN } = await import("./_wardsynq-alert-harness.mjs");

test("a released result recalls today's OPD ticket for that patient, matched from the record id to the ticket's MRN", async () => {
  seedHospital();
  const p = await admittedPatient();
  const q = await as(ADMIN, "/pool", "POST", { orgId: ORG, name: "Ravi", mobile: "9876543299", mrn: p.mrn });
  assert.equal(q.__status, 200, JSON.stringify(q));
  const t = q.ticket;
  // Sent for tests by the doctor (the status walk has its own tests; this one is about finding the patient again).
  const d = docs.get("q_tickets/" + t.id); d.fields.status = "investigation";
  assert.equal(d.fields.mrn, p.mrn, "the desk's ticket carries the MRN");
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: p.encounterId, code: "Haemoglobin", category: "laboratory" });
  assert.equal(order.__status, 200, JSON.stringify(order));
  assert.equal((await as(LAB, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: order.orderId, specimenType: "Whole blood" })).__status, 200);
  const r = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: order.orderId, patientId: p.patientId, encounterId: p.encounterId, status: "final", tests: [{ test: "Haemoglobin", value: 12.1, unit: "g/dL" }] });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.notEqual(p.patientId, p.mrn, "the record id is not the MRN: the case F3 is about");
  assert.equal(r.opdRecalled, 1, "the patient at the lab is brought back");
  const back = docs.get("q_tickets/" + t.id).fields;
  assert.equal(back.status, "waiting");
  assert.ok(back.resultReadyAt > 0, "and the result is marked ready");
});
