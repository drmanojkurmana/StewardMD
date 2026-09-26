import { H, as, seedHospital, admittedPatient, ORG, DOCTOR, NURSE } from "./_wardsynq-alert-harness.mjs";
/* test/wardsynq-data-integrity-routes.test.mjs - the audit's data-integrity findings that go through the real
 * router (lane C of the 2026-09-26 audit). Each test reproduces the audit demo and fails without its fix.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-data-integrity-routes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** Makes the next `n` repository reads of `type` fail the way D1 does on a dropped connection. */
function failReads(type, n) {
  const repo = H.RECORD, real = repo.latest.bind(repo);
  let left = n || 1;
  repo.latest = async (tenantId, resourceType, id) => {
    if (left > 0 && resourceType === type) { left--; throw new Error("D1_ERROR: Network connection lost."); }
    return real(tenantId, resourceType, id);
  };
  return () => { repo.latest = real; };
}

test("DATA-03: a start-anaesthesia retried after a failed read refuses (502) and keeps the drugs already charted", async () => {
  seedHospital();
  const p = await admittedPatient();
  const book = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: p.mrn, procedure: "Appendectomy", laterality: "not-applicable", scheduledAt: "2026-09-27T05:00:00.000Z", theatre: "OT1" } });
  assert.equal(book.__status, 200, JSON.stringify(book));
  const caseId = book.caseId;
  const start = await as(DOCTOR, "/ward/anesthesia-start", "POST", { orgId: ORG, caseId, asaClass: "II", technique: "general" });
  assert.equal(start.__status, 200, JSON.stringify(start));
  const ev = await as(DOCTOR, "/ward/anesthesia-event", "POST", { orgId: ORG, caseId, event: { drug: "Propofol", dose: "150mg", route: "IV" } });
  assert.equal(ev.__status, 200, JSON.stringify(ev));

  const restore = failReads("AnesthesiaRecord", 1);
  const again = await as(DOCTOR, "/ward/anesthesia-start", "POST", { orgId: ORG, caseId, asaClass: "II", technique: "general" });
  restore();
  assert.equal(again.__status, 502, JSON.stringify(again));
  assert.equal(again.error, "record_read_failed");
  assert.equal(again.written, 0);

  const after = await as(DOCTOR, `/ward/anesthesia-get?orgId=${ORG}&caseId=${caseId}`);
  assert.deepEqual(after.record.events.map((e) => e.drug), ["Propofol"], "the charted drug survived");

  // A failed read of the anaesthesia record on GET is an error, not "no record".
  const r2 = failReads("AnesthesiaRecord", 1);
  const got = await as(DOCTOR, `/ward/anesthesia-get?orgId=${ORG}&caseId=${caseId}`);
  r2();
  assert.equal(got.__status, 502);
  assert.equal(got.record, null);

  // Booking the same case again after a failed case read refuses instead of overwriting the case.
  const r3 = failReads("SurgicalCase", 1);
  const rebook = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: p.mrn, procedure: "Appendectomy", laterality: "not-applicable", scheduledAt: "2026-09-27T05:00:00.000Z", theatre: "OT1" } });
  r3();
  assert.equal(rebook.__status, 502, JSON.stringify(rebook));
});
