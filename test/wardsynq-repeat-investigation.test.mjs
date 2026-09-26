/* test/wardsynq-repeat-investigation.test.mjs - CLIN-03 (audit B3): a repeat test on the same stay is its own
 * request. The order id used to be (stay, test) alone, so a stat potassium recheck after a released 6.9 was
 * written over the closed first order: the collection worklist showed it as already received, a final
 * release was refused as already_final, and the only way to file it (corrected) replaced the 6.9.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-repeat-investigation.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { as, seedHospital, admittedPatient, releasePotassium, ORG, DOCTOR, LAB, H } = await import("./_wardsynq-alert-harness.mjs");

const order = (p, priority) => as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: p.encounterId, code: "Potassium", category: "laboratory", priority });

test("CLIN-03: a repeat potassium after the first result is a new order, collected and released on its own", async () => {
  seedHospital({ criticalLimits: { Potassium: { high: 6.0, low: 2.8 } } });
  const p = await admittedPatient();
  const first = await releasePotassium(p, 6.9, 30);

  const again = await order(p, "stat");
  assert.equal(again.__status, 200);
  assert.equal(again.written, 1);
  const firstOrderId = (await H.RECORD.latest("tenant-wsq", "DiagnosticReport", first.reportId)).serviceRequestId;
  assert.notEqual(again.orderId, firstOrderId, "the repeat has its own id");

  // Ordering it again while the repeat is open is still the duplicate guard.
  const dup = await order(p, "stat");
  assert.equal(dup.skipped, "already_ordered");
  assert.equal(dup.orderId, again.orderId);

  const list = await as(LAB, `/ward/collections?orgId=${ORG}&patientId=${p.patientId}`);
  const row = list.requests.find((r) => r.serviceRequestId === again.orderId);
  assert.equal(row.collection.state, "none", "nobody has taken the recheck yet: " + JSON.stringify(list.requests));

  assert.equal((await as(LAB, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: again.orderId, specimenType: "Serum" })).__status, 200);
  const rel = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: again.orderId, status: "final", tests: [{ test: "Potassium", value: 7.4, unit: "mmol/L" }] });
  assert.equal(rel.__status, 200, JSON.stringify(rel));
  assert.notEqual(rel.reportId, first.reportId);

  const values = (await H.RECORD.byPatient("tenant-wsq", "Observation", p.patientId)).filter((o) => /potassium/i.test(o.id)).map((o) => o.value).sort();
  assert.deepEqual(values, [6.9, 7.4], "both results stay on the chart");

  // A third order after the second closes takes the next id again.
  const third = await order(p, "routine");
  assert.equal(third.written, 1);
  assert.ok(![firstOrderId, again.orderId].includes(third.orderId));
});
