/* test/wardsynq-consult-med-safety.test.mjs - CLIN-02 (audit B2): a prescription saved through the
 * consultation screen runs the same safety engine and hard stops as /ward/medication-order. Before the
 * fix the consultation writer passed no rule pack, so paracetamol 2000 mg QID (8 g a day) was saved
 * active with safetyAtOrder {checked:false, NO_RULE_PACK} while the Prescribe route refused it.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-consult-med-safety.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, H } = await import("./_wardsynq-alert-harness.mjs");

const consult = (p, med) => as(DOCTOR, "/ward/consultation", "POST", { orgId: ORG, encounterId: p.encounterId, patientId: p.patientId, medications: [med] });

test("CLIN-02: a consultation prescription above the absolute ceiling is refused, as on the Prescribe form", async () => {
  seedHospital({});
  const p = await admittedPatient();
  const med = { patientId: p.patientId, encounterId: p.encounterId, drug: "Paracetamol", dose: { value: 2000, unit: "mg" }, route: "PO", frequency: "QID" };
  const direct = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: med });
  assert.equal(direct.error, "safety_hard_stop");
  const c = await consult(p, med);
  assert.equal(c.ok, false, JSON.stringify(c));
  assert.equal(c.__status, 409);
  assert.equal(c.results[0].error, "safety_hard_stop");
  assert.match(c.results[0].detail, /absolute single-dose ceiling/);
  assert.equal(c.written, 0);
});

test("CLIN-02: an overridable finding needs a reason on the consultation, and a clean order is saved with the check on it", async () => {
  seedHospital({});
  const p = await admittedPatient();
  const med = { patientId: p.patientId, encounterId: p.encounterId, drug: "Amoxicillin", dose: { value: 500, unit: "mg" }, route: "PO", frequency: "TDS" };
  const first = await consult(p, med);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.results[0].safety.checked, true, "the result carries the safety verdict");
  const o = await H.RECORD.latest("tenant-wsq", "MedicationOrder", first.results[0].orderId);
  assert.equal(o.safetyAtOrder.checked, true);

  // The same molecule again: SAME_DRUG_ACTIVE is overridable, so the consultation needs a reason.
  const med2 = { ...med, drug: "Amoxicillin 250mg", dose: { value: 250, unit: "mg" } };
  const again = await consult(p, med2);
  assert.equal(again.ok, false, JSON.stringify(again));
  assert.equal(again.results[0].error, "safety_reason_required");
  assert.ok(again.results[0].safety.overridables.some((f) => f.code === "SAME_DRUG_ACTIVE"));
  const reasoned = await consult(p, { ...med2, overrideReason: "loading course, reviewed" });
  assert.equal(reasoned.ok, true, JSON.stringify(reasoned));
});
