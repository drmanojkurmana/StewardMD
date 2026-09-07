/* test/wardsynq-critical-results.test.mjs — the closed loop on a critical result. Pure half.
 *
 * node --test test/wardsynq-critical-results.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CRITICAL_LIMITS, DEFAULT_ESCALATION, canonUnit, limitsFor, classify, loopIdFor, escalationOf,
} from "../functions/_wardsynq/critical-results.js";

const K = (value, unit = "mmol/L", extra) => ({ code: "2823-3", value, unit, ...(extra || {}) });

test("THE LAB'S OWN FLAG ALWAYS WINS, whatever this file's table thinks", () => {
  // A perfectly normal potassium the laboratory flagged is critical. Software that can talk a lab
  // out of its own critical flag is not a safety feature.
  const flagged = classify(K(4.2, "mmol/L", { sourceCritical: true }), DEFAULT_CRITICAL_LIMITS);
  assert.equal(flagged.critical, true);
  assert.equal(flagged.basis, "lab", "and it is recorded as the lab's call, not the table's");

  // It wins even when the analyte is not in the table at all, and even with no unit to compare.
  const unknown = classify({ code: "99999-9", display: "Novel assay", value: "positive", sourceCritical: true }, DEFAULT_CRITICAL_LIMITS);
  assert.equal(unknown.critical, true);
  assert.equal(unknown.basis, "lab");
});

test("the table can only ADD: a value outside a limit is flagged, and says whose opinion that is", () => {
  const high = classify(K(7.1), DEFAULT_CRITICAL_LIMITS);
  assert.equal(high.critical, true);
  assert.equal(high.basis, "limit", "distinguishable from a laboratory flag, always");
  assert.deepEqual(high.bound, { side: "high", limit: 6.2 });
  assert.equal(high.display, "Potassium");

  const low = classify(K(2.4), DEFAULT_CRITICAL_LIMITS);
  assert.deepEqual(low.bound, { side: "low", limit: 2.8 });
  assert.equal(classify(K(4.0), DEFAULT_CRITICAL_LIMITS), null, "a normal result is not flagged");
  // The bound is inclusive: exactly at the limit is critical, not just past it.
  assert.equal(classify(K(6.2), DEFAULT_CRITICAL_LIMITS).critical, true);
  assert.equal(classify(K(2.8), DEFAULT_CRITICAL_LIMITS).critical, true);
});

test("a one-sided analyte is only tested on the side that has a limit", () => {
  // A haemoglobin of 19 is abnormal but not a critical value; 6 is.
  assert.equal(classify({ code: "718-7", value: 19, unit: "g/dL" }, DEFAULT_CRITICAL_LIMITS), null);
  assert.equal(classify({ code: "718-7", value: 6, unit: "g/dL" }, DEFAULT_CRITICAL_LIMITS).critical, true);
  assert.equal(DEFAULT_CRITICAL_LIMITS["718-7"].high, null);
});

test("a result that is not plainly one number is NOT flagged and NOT guessed at", () => {
  // "Haemolysed", "<0.01" and "see report" are real laboratory answers. Extracting a number from one
  // to test against a threshold produces false alarms and, far worse, false silence.
  for (const v of ["haemolysed", "see report", "", null, undefined, "<0.01", "positive"]) {
    assert.equal(classify(K(v), DEFAULT_CRITICAL_LIMITS), null, `"${v}" must not be compared`);
  }
  // And a value that IS a number in a string still is one.
  assert.equal(classify(K("7.4"), DEFAULT_CRITICAL_LIMITS).critical, true);
});

test("UNCOMPARABLE IS NOT NORMAL: a mismatched unit is reported, never silently passed", () => {
  const r = classify(K(7.1, "mg/dL"), DEFAULT_CRITICAL_LIMITS);
  assert.equal(r.critical, false);
  assert.equal(r.uncomparable, true, "reporting it as within limits would be a false reassurance");
  assert.equal(r.basis, "unit-mismatch");
  assert.equal(r.expectedUnit, "mmol/L");
  // Spelling is not a mismatch: the same unit written differently still compares.
  assert.equal(classify(K(7.1, "mmol/l"), DEFAULT_CRITICAL_LIMITS).critical, true);
  assert.equal(canonUnit("gm/dl"), "g/dL");
  assert.equal(canonUnit("MMOL/L"), "mmol/L");
});

test("the limits are a site default, and a site can replace them", () => {
  // A renal unit whose dialysis patients live at a potassium this file would call critical.
  const site = limitsFor({ "2823-3": { display: "Potassium", unit: "mmol/L", low: 2.5, high: 6.8 } });
  assert.equal(classify(K(6.5), site), null, "not critical here");
  assert.equal(classify(K(6.5), DEFAULT_CRITICAL_LIMITS).critical, true, "but critical on the default");
  assert.equal(classify(K(6.9), site).critical, true);
  // Analytes the site did not override keep the defaults.
  assert.equal(site["2951-2"].low, 120);
});

test("a broken override falls back to the default instead of switching an analyte off", () => {
  // An override with no usable bounds would silently stop flagging that analyte entirely, and the
  // list would just look quiet. That is the worst possible outcome of a configuration typo.
  for (const bad of [{ low: "abc", high: 6 }, { low: null, high: null }, {}, null, "nonsense", []]) {
    const t = limitsFor({ "2823-3": bad });
    assert.equal(t["2823-3"].high, 6.2, `override ${JSON.stringify(bad)} must not disable potassium`);
  }
  assert.equal(classify(K(7.1), limitsFor({ "2823-3": { low: "x" } })).critical, true);
  // A one-sided override IS legitimate and is kept.
  assert.equal(limitsFor({ "2823-3": { unit: "mmol/L", low: null, high: 7 } })["2823-3"].high, 7);
});

test("one loop per report and analyte, so a re-ingested result never duplicates", () => {
  assert.equal(loopIdFor("opd-dr-lab-v1-cbc", "2823-3"), "wsq-crit-opd-dr-lab-v1-cbc-2823-3");
  assert.equal(loopIdFor("R/1", "2823-3"), loopIdFor("r-1", "2823-3"), "the same report, spelled differently");
  assert.notEqual(loopIdFor("r1", "2823-3"), loopIdFor("r1", "2951-2"), "two analytes stay two loops");
  assert.equal(loopIdFor("", "2823-3"), null);
  assert.equal(loopIdFor("r1", ""), null);
});

test("ESCALATION IS COMPUTED, never stored, and runs from when the result was REPORTED", () => {
  const reportedAt = "2026-09-07T09:00:00.000Z";
  const at = (m) => Date.parse(reportedAt) + m * 60000;
  const open = { state: "open", reportedAt };

  assert.equal(escalationOf(open, at(5)).level, "due");
  assert.equal(escalationOf(open, at(31)).level, "overdue", "past the acknowledge window");
  assert.equal(escalationOf(open, at(61)).level, "escalate");
  assert.equal(escalationOf(open, at(61)).minutesOpen, 61);
  // It runs from the report, not from when WardSynQ happened to open the loop: a result that sat in
  // an interface queue for an hour is already an hour late, and the clock must say so.
  assert.equal(escalationOf({ state: "open", reportedAt, openedAt: "2026-09-07T09:55:00.000Z" }, at(61)).level, "escalate");
  // An acknowledged loop is not chased.
  assert.equal(escalationOf({ state: "acknowledged", reportedAt }, at(600)).level, "none");
  assert.equal(escalationOf({ state: "closed", reportedAt }, at(600)).level, "none");
  // A site can set its own policy.
  assert.equal(escalationOf(open, at(20), { acknowledgeWithinMinutes: 15, escalateAfterMinutes: 45 }).level, "overdue");
  assert.equal(DEFAULT_ESCALATION.acknowledgeWithinMinutes, 30);
});
