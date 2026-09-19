/* test/wardsynq-radiology.test.mjs — the imaging report. Pure.
 *
 * node --test test/wardsynq-radiology.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUSES, reportIdFor, impressionChanged } from "../functions/_wardsynq/radiology-report.js";

test("A CHANGED IMPRESSION IS A DISCREPANCY, and whitespace is not", () => {
  /* A final impression that differs from the preliminary one somebody already acted on is the
   * commonest serious event in radiology. */
  assert.equal(impressionChanged({ impression: "No intracranial haemorrhage." }, "Small left frontal contusion."), true);
  // Case and whitespace are not a discrepancy - flagging those would make the real ones unreadable.
  assert.equal(impressionChanged({ impression: "No intracranial haemorrhage." }, "  no  INTRACRANIAL   haemorrhage. "), false);
  // Nothing to compare against is not a discrepancy either: a first report has changed from nothing.
  assert.equal(impressionChanged(null, "Anything"), false);
  assert.equal(impressionChanged({ impression: "" }, "Anything"), false);
  assert.equal(impressionChanged({ impression: "Something" }, ""), false);
});

test("ONE REPORT PER STUDY, and a second reading is a new version of it", () => {
  /* The registrar reports at 02:00 and the consultant reads at 09:00. Two reports would let a ward
   * read one and act on it while the other stood. */
  const id = reportIdFor("wsq-sr-ct1");
  assert.equal(id, reportIdFor("WSQ/SR CT1"));
  assert.notEqual(id, reportIdFor("wsq-sr-ct2"));
  assert.equal(reportIdFor(""), null);
  assert.equal(reportIdFor(null), null);
});

test("preliminary is a real state, and correction is the only way past final", () => {
  /* The registrar's reading is acted on. A system that only stored the consultant's would erase what
   * the night team actually saw and decided from. */
  assert.deepEqual(STATUSES, ["preliminary", "final", "corrected"]);
  assert.ok(STATUSES.includes("preliminary"));
  assert.ok(!STATUSES.includes("cancelled"), "a study that was not done is not a report at all");
});
