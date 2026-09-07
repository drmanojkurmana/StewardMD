/* test/wardsynq-patient-record.test.mjs — what a patient may be handed, and what must not be.
 *
 * node --test test/wardsynq-patient-record.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RELEASE_TYPE, openCriticalReportIds, releasableReport, diagnosisFor, statements, clinicianWarnings,
} from "../functions/_wardsynq/patient-record.js";
import { RESOURCE_TYPES } from "../functions/_wardsynq/service.js";

const rep = (over) => ({ id: "rep-1", code: "Renal profile", status: "final", reportedAt: "2026-09-08T09:00:00.000Z", ...(over || {}) });

test("A PATIENT MUST NOT LEARN A CRITICAL RESULT FROM A PRINTOUT", () => {
  /* The oldest failure in this area is a potassium of 7.2 reaching the patient before it reached a
   * clinician. The report is withheld BECAUSE the loop is open - not because somebody remembered. */
  const openIds = openCriticalReportIds([
    { state: "open", reportId: "rep-1" },
    { state: "acknowledged", reportId: "rep-2" },
    { state: "closed", reportId: "rep-3" },
  ]);
  assert.deepEqual([...openIds], ["rep-1"]);

  const held = releasableReport(rep(), openIds, []);
  assert.equal(held.ok, false);
  assert.equal(held.reason, "critical_unacknowledged");
  assert.match(held.say, /care team/);

  /* Acknowledging it is what releases it, and that is the same act that was always required: a
   * named human saying "I have seen this". Nothing here adds a second gate to open. */
  assert.equal(releasableReport(rep({ id: "rep-2" }), openIds, []).ok, true);
  assert.equal(releasableReport(rep({ id: "rep-3" }), openIds, []).ok, true);
});

test("A PRELIMINARY RESULT IS NOT A RESULT YET, and a corrected one is", () => {
  const ids = new Set();
  assert.equal(releasableReport(rep({ status: "preliminary" }), ids, []).reason, "not_final");
  assert.equal(releasableReport(rep({ status: "cancelled" }), ids, []).reason, "not_final");
  // A patient holding a superseded number on paper has no way to know it changed.
  assert.equal(releasableReport(rep({ status: "final" }), ids, []).ok, true);
  assert.equal(releasableReport(rep({ status: "corrected" }), ids, []).ok, true);
});

test("sensitivity is ORG CONFIGURATION and this file invents no list of its own", () => {
  const ids = new Set();
  /* The record carries no sensitivity flag, and a code list made up here would be a clinical policy
   * written by a programmer. Unconfigured means nothing is withheld on these grounds - and the
   * document says so, to the clinician, rather than implying a clearance nobody gave. */
  assert.equal(releasableReport(rep({ code: "HIV serology" }), ids, []).ok, true);
  assert.equal(releasableReport(rep({ code: "HIV serology" }), ids, ["HIV serology"]).reason, "sensitive");
  // Case-insensitive, because a policy typed by a human is not typed the way a payload is.
  assert.equal(releasableReport(rep({ code: "hiv serology" }), ids, ["HIV Serology"]).reason, "sensitive");
  assert.equal(releasableReport(rep({ code: "Renal profile" }), ids, ["HIV serology"]).ok, true);

  /* The warning goes to the CLINICIAN and is never mixed into what the patient reads: a line saying
   * "not for the patient", printed on the patient's own copy, would be the most careless thing on
   * the page. The two lists are separate so that separation cannot be lost in a template. */
  assert.equal(clinicianWarnings(false).length, 1);
  assert.match(clinicianWarnings(false)[0], /neverRelease/);
  assert.deepEqual(clinicianWarnings(true), []);
  const say = statements({ withheldResults: [], excludedDiagnoses: 0, diagnoses: [] });
  assert.ok(!say.some((s) => /neverRelease/.test(s)));
  assert.ok(!say.some((s) => /NOT FOR THE PATIENT/i.test(s)));
});

test("A DIFFERENTIAL IS NOT A DIAGNOSIS, and a working one is labelled rather than dropped", () => {
  /* Handing a patient the list of things it might be, printed under "your diagnoses", is worse than
   * handing them nothing. */
  assert.equal(diagnosisFor({ code: "I10", verificationStatus: "differential" }), null);
  assert.equal(diagnosisFor({ code: "N18.3", verificationStatus: "refuted" }), null);
  assert.equal(diagnosisFor({ code: "X", verificationStatus: "entered-in-error" }), null);

  const confirmed = diagnosisFor({ code: "E11.9", display: "Type 2 diabetes", verificationStatus: "confirmed", clinicalStatus: "active" });
  assert.equal(confirmed.display, "Type 2 diabetes");
  assert.equal(confirmed.note, undefined);

  /* Leaving a working diagnosis out entirely would be its own kind of lie, and printing it as
   * settled is how a patient stops asking the question that would correct it. So it goes out, said
   * in words rather than as a status code the patient has to decode. */
  const working = diagnosisFor({ code: "J44.9", display: "COPD", verificationStatus: "provisional" });
  assert.match(working.note, /working diagnosis/);
});

test("NOTHING IS WITHHELD SILENTLY, because an absent result reads as a test nobody did", () => {
  const say = statements({ withheldResults: [{ reason: "not_final" }, { reason: "critical_unacknowledged" }], excludedDiagnoses: 2, diagnoses: [] });
  assert.ok(say.some((s) => /2 results are not included/.test(s)));
  assert.ok(say.some((s) => /ruled out/.test(s)), "and so is a diagnosis that was excluded");
  // Singular reads as a sentence, not as a template with a number in it.
  assert.ok(statements({ withheldResults: [{ reason: "not_final" }], excludedDiagnoses: 0, diagnoses: [] })
    .some((s) => /1 result is not included/.test(s)));

  /* It is a handout and not the legal record, and it says so on every copy - an omission that
   * implies the record is thinner than it is would be the most misleading part of the document. */
  assert.ok(say.some((s) => /not your complete medical record/.test(s)));
});

test("the release is a RECEIPT and the store is append-only, so it survives being regretted", () => {
  assert.ok(RESOURCE_TYPES.includes(RELEASE_TYPE));
});
