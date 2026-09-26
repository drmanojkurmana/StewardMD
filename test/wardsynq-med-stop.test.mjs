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

/* ---- the rest of CLIN-04: discharge stops the stay's orders, a course length, and checks read this stay only. */

test("CLIN-04: discharge stops every active order of the stay, audited with the reason 'discharged'", async () => {
  seedHospital({});
  const p = await admittedPatient();
  const a = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: p.patientId, encounterId: p.encounterId, drug: "Pantoprazole", dose: { value: 40, unit: "mg" }, route: "IV", frequency: "OD" } });
  const b = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: p.patientId, encounterId: p.encounterId, drug: "Ceftriaxone", dose: { value: 1, unit: "g" }, route: "IV", frequency: "BD" } });
  assert.equal(a.__status, 200); assert.equal(b.__status, 200);
  const d = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: p.encounterId, disposition: "home",
    overrideReason: "reviewed, going home on oral medicines", billDeferredReason: "insurer settles" });
  assert.equal(d.__status, 200, JSON.stringify(d));
  assert.deepEqual(d.ordersStopped.sort(), [a.orderId, b.orderId].sort());
  for (const id of [a.orderId, b.orderId]) {
    const o = await H.RECORD.latest("tenant-wsq", "MedicationOrder", id);
    assert.equal(o.status, "stopped");
    assert.equal(o.stopReason, "discharged");
    assert.ok(o.stoppedBy && o.stoppedAt);
  }
});

test("CLIN-04: the Prescribe form's course length becomes the order's stop time", async () => {
  seedHospital({});
  const p = await admittedPatient();
  const o = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: p.patientId, encounterId: p.encounterId, drug: "Ceftriaxone", dose: { value: 1, unit: "g" }, route: "IV", frequency: "OD", durationDays: 5 } });
  assert.equal(o.__status, 200, JSON.stringify(o));
  const stored = await H.RECORD.latest("tenant-wsq", "MedicationOrder", o.orderId);
  const days = (Date.parse(stored.stopAt) - Date.now()) / 86400000;
  assert.ok(days > 4.9 && days <= 5, "stops five days from now: " + stored.stopAt);
  const from = new Date(Date.now() + 6 * 86400000).toISOString(), to = new Date(Date.now() + 7 * 86400000).toISOString();
  const later = await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${p.patientId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  assert.ok(!later.due.some((x) => x.orderId === o.orderId), "no dose after the course");
  const bad = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: p.patientId, encounterId: p.encounterId, drug: "Pantoprazole", dose: { value: 40, unit: "mg" }, route: "IV", frequency: "OD", durationDays: 0 } });
  assert.equal(bad.error, "bad_course_days");
  const src = (await import("node:fs")).readFileSync(new URL("../ward.js", import.meta.url), "utf8");
  assert.match(src, /durationDays: days \? Number\(days\) : undefined/, "the ward form sends it");
});

test("CLIN-04: order-entry checks read this stay's orders and the OPD home medicines, not a past admission's", async () => {
  seedHospital({});
  const p = await admittedPatient();
  const at = new Date(Date.now() - 60 * 86400e3).toISOString();
  const meta = { recordedAt: at, effectiveAt: at, amendedAt: null, source: { system: "wardsynq-native", sourceId: null, importedAt: at }, derivedFrom: [] };
  const oldStay = "wsq-adm-old-stay";
  await H.RECORD.append("tenant-wsq", [
    { resourceType: "Encounter", id: oldStay, version: 1, patientId: p.patientId, class: "IPD", status: "finished", periodStart: at, periodEnd: at, meta },
    { resourceType: "MedicationOrder", id: "wsq-rx-old-paracetamol", version: 1, patientId: p.patientId, encounterId: oldStay, drug: "Paracetamol", dose: { value: 1000, unit: "mg" }, frequency: "QDS", route: "PO", prescriberId: "cfa:old", status: "active", signedBy: "cfa:old", meta },
  ]);
  const order = (drug) => as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, checkOnly: true, order: { patientId: p.patientId, encounterId: p.encounterId, drug, dose: { value: 1000, unit: "mg" }, route: "PO", frequency: "QDS" } });
  const vitals = await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: p.encounterId, patientId: p.patientId, vitals: { weight: "70" } });
  assert.equal(vitals.__status, 200);
  const past = await order("Paracetamol");
  assert.ok(!past.safety.findings.some((f) => f.code === "SAME_DRUG_ACTIVE" || f.code === "DOSE_ABSOLUTE_CEILING_CUMULATIVE"), JSON.stringify(past.safety.findings));

  await H.RECORD.append("tenant-wsq", [
    { resourceType: "MedicationOrder", id: "wsq-rx-opd-home-paracetamol", version: 1, patientId: p.patientId, encounterId: "opd-enc-home", drug: "Paracetamol", dose: { value: 1000, unit: "mg" }, frequency: "QDS", route: "PO", prescriberId: "cfa:opd", status: "active", signedBy: "cfa:opd", meta },
    { resourceType: "Encounter", id: "opd-enc-home", version: 1, patientId: p.patientId, class: "OPD", status: "finished", periodStart: at, meta },
  ]);
  const home = await order("Paracetamol");
  assert.ok(home.safety.findings.some((f) => f.code === "SAME_DRUG_ACTIVE"), "an OPD home medicine is still read");
});
