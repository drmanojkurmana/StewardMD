/* test/wardsynq-backup-run.test.mjs — taking the backup, and knowing when the last one was.
 *
 * node --test test/wardsynq-backup-run.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RUN_TYPE, MAX_PAGE, rowForExport, rpoVerdict } from "../functions/_wardsynq/backup-run.js";
import { verifyPlan, exportLines } from "../functions/_wardsynq/backup.js";
import { RESOURCE_TYPES } from "../functions/_wardsynq/service.js";

const rec = (over = {}) => ({
  seq: 7, resourceType: "Observation", id: "obs-1", version: 2, patientId: "pat-1",
  meta: { recordedAt: "2026-09-08T09:00:00.000Z", effectiveAt: "2026-09-08T08:55:00.000Z" },
  writtenBy: { id: "cfa:nurse", kind: "human" }, value: 126, ...over,
});

test("PURE: an exported row round-trips through the verifier that a restore would run", () => {
  const row = rowForExport("t1", rec());
  assert.equal(row.tenant_id, "t1");
  assert.equal(row.resource_type, "Observation");
  assert.equal(row.version, 2);
  assert.equal(row.patient_id, "pat-1");
  assert.equal(row.recorded_at, "2026-09-08T09:00:00.000Z");
  assert.equal(row.actor_id, "cfa:nurse");

  /* `seq` is a repository cursor, not part of the record, and must not travel in the body - a
   * restored chart carrying the sequence numbers of the database it came from is describing the
   * old deployment rather than the record. */
  assert.ok(!/"seq"/.test(row.body));
  assert.equal(JSON.parse(row.body).value, 126);

  // The digest agrees with the verifier at the other end. That is the whole contract.
  const whole = [rowForExport("t1", rec({ version: 1 })), rowForExport("t1", rec({ version: 2 }))];
  const plan = verifyPlan(exportLines(whole));
  assert.equal(plan.ok, true, JSON.stringify(plan.problems));
  assert.equal(plan.rows.length, 2);
});

test("A SHORT EXPORT IS CAUGHT, which is why a page is not a backup", () => {
  /* Exporting version 2 without version 1 restores WITHOUT ERROR into a chart that denies a clinical
   * fact somebody recorded: every query still answers and the answer is a version of the truth no
   * clinician ever saw. This is the case a row count cannot see, and it is exactly what a caller who
   * stopped paging halfway would produce - hence `complete: false` on every page. */
  const plan = verifyPlan(exportLines([rowForExport("t1", rec({ version: 2 }))]));
  assert.equal(plan.ok, false);
  assert.equal(plan.problems[0].reason, "version_gap");
  assert.deepEqual(plan.problems[0].missing, [1]);
});

test("A PATIENT RECORD IS ITS OWN PATIENT, so a restored chart does not lose its owner", () => {
  // Everywhere else in the codebase Patient.patientId is the record's own id. The export must agree
  // or a restore rebuilds a patient nobody's observations point at.
  assert.equal(rowForExport("t1", rec({ resourceType: "Patient", id: "pat-9", patientId: null })).patient_id, "pat-9");
});

test("NO RECORDED BACKUP IS NEVER A GREEN LIGHT", () => {
  /* A hospital with no backup and an "ok" status is the exact failure this file exists to prevent.
   * The age is null rather than zero, and `meets` is false rather than unknown. */
  const none = rpoVerdict(null, 60, "2026-09-08T12:00:00.000Z");
  assert.equal(none.ageMinutes, null);
  assert.equal(none.meets, false);
  assert.match(none.reading, /NO BACKUP HAS EVER BEEN RECORDED/);

  // An unparseable timestamp is the same case, not a backup that happened at the epoch.
  assert.equal(rpoVerdict("not a date", 60, "2026-09-08T12:00:00.000Z").meets, false);
});

test("RPO IS MEASURED AGAINST THE OBJECTIVE, and an unconfigured objective is not a pass", () => {
  const ok = rpoVerdict("2026-09-08T11:30:00.000Z", 60, "2026-09-08T12:00:00.000Z");
  assert.equal(ok.ageMinutes, 30);
  assert.equal(ok.meets, true);

  const breach = rpoVerdict("2026-09-08T06:00:00.000Z", 60, "2026-09-08T12:00:00.000Z");
  assert.equal(breach.ageMinutes, 360);
  assert.equal(breach.meets, false);
  assert.match(breach.reading, /NOT BEING MET/);
  assert.match(breach.reading, /360 minutes of the record would be lost/);

  /* `meets` is NULL, not true: there is nothing to compare against, and a hospital that never set an
   * objective has not met one. An objective living only in a runbook is a sentence. */
  const unset = rpoVerdict("2026-09-08T11:30:00.000Z", null, "2026-09-08T12:00:00.000Z");
  assert.equal(unset.meets, null);
  assert.equal(unset.objectiveMinutes, null);
  assert.match(unset.reading, /No recovery point objective is configured/);

  // Number("") is 0 and 0 is finite. An empty configured objective is unset, never "zero minutes".
  assert.equal(rpoVerdict("2026-09-08T11:30:00.000Z", "", "2026-09-08T12:00:00.000Z").meets, null);
  assert.equal(rpoVerdict("2026-09-08T11:30:00.000Z", 0, "2026-09-08T12:00:00.000Z").meets, null);
});

test("the receipt is a record, and the page cap keeps a hospital from being asked for in one request", () => {
  assert.ok(RESOURCE_TYPES.includes(RUN_TYPE));
  assert.equal(MAX_PAGE, 500);
});
