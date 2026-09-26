/* test/wardsynq-med-stop.test.mjs - CLIN-04 (audit B4): a medication order can be stopped, and the round is
 * this stay's orders only. Before the fix nothing could take an order out of "active", and the round and the
 * nurse worklist scheduled every active order the patient had ever had, so an OPD course from three months
 * ago showed as overdue on a new admission.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-med-stop.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, NURSE, H } = await import("./_wardsynq-alert-harness.mjs");
const { orderFromPrescription } = await import("../functions/_wardsynq/migrate-prescription.js");

const window = () => ({ from: new Date(Date.now() - 12 * 3600e3).toISOString(), to: new Date(Date.now() + 12 * 3600e3).toISOString() });
const schedule = (p) => { const w = window(); return as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${p.patientId}&from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`); };

test("CLIN-04: an OPD prescription from months ago is not on the inpatient round or the worklist", async () => {
  seedHospital({});
  const p = await admittedPatient();
  const o = orderFromPrescription({ ticket: { ghisPatientId: p.mrn, id: "opd-ticket-june" }, prescriberId: "cfa:opd-doc", canSign: true,
    rx: { drugId: "amox-500", name: "Amoxicillin 500 mg", route: "PO", frequency: "TDS", duration: "5 days", qty: "15" } });
  const at = new Date(Date.now() - 90 * 86400e3).toISOString();
  o.version = 1; o.meta = { recordedAt: at, effectiveAt: at, amendedAt: null, source: o.source || { system: "wardsynq-native" }, derivedFrom: [] };
  await H.RECORD.append("tenant-wsq", [o]);
  assert.equal(o.patientId, p.patientId, "the OPD order is the same patient");
  assert.notEqual(o.encounterId, p.encounterId);

  const ward = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: p.patientId, encounterId: p.encounterId, drug: "Pantoprazole", dose: { value: 40, unit: "mg" }, route: "IV", frequency: "OD" } });
  assert.equal(ward.__status, 200, JSON.stringify(ward));

  const sch = await schedule(p);
  assert.equal(sch.__status, 200);
  const drugs = [...new Set(sch.due.map((d) => d.drug).concat(sch.unscheduled.map((d) => d.drug)))];
  assert.ok(!drugs.some((d) => /amoxicillin/i.test(d)), "the OPD course is not on the round: " + JSON.stringify(drugs));
  const wl = await as(NURSE, `/ward/nurse-worklist?orgId=${ORG}&ward=Medical%20A`);
  const row = (wl.rows || []).find((r) => r.patientId === p.patientId);
  assert.equal(row.overdue, 0, "no overdue OPD doses on the worklist");
});

test("CLIN-04: a doctor stops an order with a reason; it leaves the round and cannot be given", async () => {
  seedHospital({});
  const p = await admittedPatient();
  const placed = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: p.patientId, encounterId: p.encounterId, drug: "Heparin", dose: { value: 5000, unit: "units" }, route: "SC", frequency: "BD" } });
  assert.equal(placed.__status, 200, JSON.stringify(placed));
  assert.ok((await schedule(p)).due.some((d) => d.orderId === placed.orderId));

  const noReason = await as(DOCTOR, "/ward/medication-stop", "POST", { orgId: ORG, orderId: placed.orderId });
  assert.equal(noReason.__status, 422);
  assert.equal(noReason.error, "reason_required");

  const stop = await as(DOCTOR, "/ward/medication-stop", "POST", { orgId: ORG, orderId: placed.orderId, reason: "bleeding from the wound" });
  assert.equal(stop.__status, 200, JSON.stringify(stop));
  const stored = await H.RECORD.latest("tenant-wsq", "MedicationOrder", placed.orderId);
  assert.equal(stored.status, "stopped");
  assert.equal(stored.stopReason, "bleeding from the wound");
  assert.ok(stored.stoppedBy && stored.stoppedAt);

  assert.ok(!(await schedule(p)).due.some((d) => d.orderId === placed.orderId), "a stopped order is off the round");
  const again = await as(DOCTOR, "/ward/medication-stop", "POST", { orgId: ORG, orderId: placed.orderId, reason: "x" });
  assert.equal(again.error, "order_not_active");
  const give = await as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: "verify", orderId: placed.orderId, dueAt: new Date().toISOString(), patient: { id: p.patientId } });
  assert.equal(give.error, "order_not_active");
});
