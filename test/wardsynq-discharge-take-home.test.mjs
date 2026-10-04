/* Owner decision 2026-10-04: discharge asks about each open medication order. The clinician chooses which continue at
 * home; those go on the finished stay's take-home list and their inpatient order closes as "continued at home". The rest
 * stop as "discharged". Nothing continues unless chosen. An order that is not this stay's is refused. Real routes.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-discharge-take-home.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, NURSE, H } = await import("./_wardsynq-alert-harness.mjs");

const TENANT = "tenant-wsq";
const order = (p, drug, dose, frequency) => as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: p.patientId, encounterId: p.encounterId, drug, dose, route: "PO", frequency } });
const discharge = (who, p, extra) => as(who, "/ward/discharge", "POST", { orgId: ORG, encounterId: p.encounterId, disposition: "home", billDeferredReason: "insurer settles", ...(extra || {}) });
const latest = (type, id) => H.RECORD.latest(TENANT, type, id);

async function twoOrders() {
  const p = await admittedPatient();
  const a = await order(p, "Metoprolol", { value: 25, unit: "mg" }, "BD");
  const b = await order(p, "Ceftriaxone", { value: 1, unit: "g" }, "OD");
  assert.equal(a.__status, 200, JSON.stringify(a)); assert.equal(b.__status, 200, JSON.stringify(b));
  return { p, a: a.orderId, b: b.orderId };
}

test("the checklist lists the open medication orders for the choice; a doctor needs no override reason for them", async () => {
  seedHospital({});
  const { p, a, b } = await twoOrders();
  const c = await as(DOCTOR, `/ward/discharge-checklist?orgId=${ORG}&encounterId=${p.encounterId}`);
  assert.equal(c.__status, 200, JSON.stringify(c));
  assert.deepEqual(c.checklist.openOrders.filter((o) => o.kind === "medication").map((o) => o.id).sort(), [a, b].sort());
  assert.ok(!c.blockers.includes("override_required"), JSON.stringify(c.blockers));
  const n = await as(NURSE, `/ward/discharge-checklist?orgId=${ORG}&encounterId=${p.encounterId}`);
  assert.ok(n.blockers.includes("medication_decision_not_permitted"), "the nurse is told the medicines need a treating clinician");
});

test("chosen orders go on the take-home list and close as continued at home; the others stop as discharged", async () => {
  seedHospital({});
  const { p, a, b } = await twoOrders();
  const d = await discharge(DOCTOR, p, { continueOrderIds: [a] });
  assert.equal(d.__status, 200, JSON.stringify(d));
  assert.deepEqual(d.ordersContinuedAtHome, [a]);
  assert.deepEqual(d.ordersStopped, [b]);
  assert.deepEqual(d.takeHomeMedications.map((m) => [m.orderId, m.drug, m.frequency]), [[a, "Metoprolol", "BD"]]);

  const oa = await latest("MedicationOrder", a), ob = await latest("MedicationOrder", b);
  assert.deepEqual([oa.status, oa.stopReason], ["stopped", "continued at home"], "the inpatient order is closed, not left running");
  assert.deepEqual([ob.status, ob.stopReason], ["stopped", "discharged"]);
  assert.ok(oa.stoppedBy && oa.stoppedAt && ob.stoppedBy && ob.stoppedAt, "both closures are attributed versions");

  const enc = await latest("Encounter", p.encounterId);
  assert.equal(enc.status, "finished");
  assert.deepEqual(enc.takeHomeMedications.map((m) => m.orderId), [a]);
  assert.deepEqual(enc.medicationDecisions.orders.map((o) => [o.orderId, o.decision]).sort(), [[a, "continued-at-home"], [b, "stopped"]].sort());
  assert.ok(enc.medicationDecisions.by);

  const sum = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${p.encounterId}`);
  assert.equal(sum.__status, 200, JSON.stringify(sum));
  const meds = sum.assembled.medications;
  assert.match(meds, /^To continue at home \(chosen at discharge\):\nMetoprolol - 25 mg, PO, BD\n\nOn this admission:\n/);
  assert.ok(!meds.split("On this admission:")[0].includes("Ceftriaxone"), "a stopped order is not on the take-home list");
});

test("default: nothing continues; every order stops as discharged and the summary says none continue", async () => {
  seedHospital({});
  const { p, a, b } = await twoOrders();
  const d = await discharge(DOCTOR, p);
  assert.equal(d.__status, 200, JSON.stringify(d));
  assert.deepEqual(d.ordersContinuedAtHome, []);
  assert.deepEqual(d.ordersStopped.sort(), [a, b].sort());
  assert.deepEqual((await latest("Encounter", p.encounterId)).takeHomeMedications, []);
  for (const id of [a, b]) assert.equal((await latest("MedicationOrder", id)).stopReason, "discharged");
  const sum = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${p.encounterId}`);
  assert.match(sum.assembled.medications, /^To continue at home: none\./);
});

test("an order of another stay, an already stopped order or a malformed list is refused, and nothing is written", async () => {
  seedHospital({});
  const { p, a, b } = await twoOrders();
  // Another patient in the next bed (the harness admits everyone to bed 7).
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Otherbed Testpatient", mobile: "9876509988", gender: "female", ageYears: 70 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "8" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  const other = { patientId: adm.patientId, encounterId: adm.encounterId };
  const foreign = (await order(other, "Warfarin", { value: 5, unit: "mg" }, "OD")).orderId;

  const r1 = await discharge(DOCTOR, p, { continueOrderIds: [a, foreign] });
  assert.equal(r1.__status, 422, JSON.stringify(r1));
  assert.equal(r1.error, "continue_order_not_on_stay");
  assert.deepEqual(r1.orderIds, [foreign]);
  const r2 = await discharge(DOCTOR, p, { continueOrderIds: ["wsq-rx-made-up"] });
  assert.equal(r2.error, "continue_order_not_on_stay");
  const r3 = await discharge(DOCTOR, p, { continueOrderIds: a });
  assert.deepEqual([r3.__status, r3.error], [422, "bad_continue_orders"]);

  assert.equal((await as(DOCTOR, "/ward/medication-stop", "POST", { orgId: ORG, orderId: b, reason: "course finished" })).__status, 200);
  const r4 = await discharge(DOCTOR, p, { continueOrderIds: [b] });
  assert.deepEqual([r4.__status, r4.error, r4.orderIds], [409, "continue_order_not_active", [b]]);

  assert.equal((await latest("Encounter", p.encounterId)).status, "in-progress", "no refusal closed the stay");
  assert.equal((await latest("MedicationOrder", a)).status, "active");
  assert.equal((await latest("MedicationOrder", foreign)).status, "active", "the other patient's order was not touched");
});

test("a nurse cannot decide which medicines continue at home", async () => {
  seedHospital({});
  const { p, a } = await twoOrders();
  const r = await discharge(NURSE, p, { continueOrderIds: [a] });
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(r.error, "medication_decision_not_permitted");
  assert.equal((await latest("Encounter", p.encounterId)).status, "in-progress");
});
