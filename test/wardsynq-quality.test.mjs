/* test/wardsynq-quality.test.mjs — measures about the system, over a period. Pure half.
 *
 * node --test test/wardsynq-quality.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMeasures, measure, MIN_DENOMINATOR } from "../functions/_wardsynq/quality.js";

const FROM = Date.parse("2026-09-01T00:00:00.000Z");
const TO = Date.parse("2026-09-08T00:00:00.000Z");
const OUT = "2026-08-01T00:00:00.000Z";   // before the period
const at = (h) => new Date(Date.parse("2026-09-03T00:00:00.000Z") + h * 3600000).toISOString();
const run = (over) => computeMeasures({ fromMs: FROM, toMs: TO, ackWindowMinutes: 30, graceMinutes: 60, ...(over || {}) });
const byId = (ms, id) => ms.find((m) => m.id === id);

test("A RATE WITH NO CASES IS NULL, never 0% and never 100%", () => {
  /* "0%" over no cases reads as a failing ward and "100%" over one case reads as a solved problem.
   * Both are how a quality dashboard lies. */
  const m = measure("x", "X", 0, 0);
  assert.equal(m.rate, null);
  assert.equal(m.underpowered, undefined);

  const thin = measure("x", "X", 1, 1);
  assert.equal(thin.rate, 1);
  assert.equal(thin.underpowered, true, "one of one is not evidence of anything");
  assert.match(thin.note, /Too few to read as a rate/);

  const solid = measure("x", "X", 15, MIN_DENOMINATOR);
  assert.equal(solid.rate, 0.75);
  assert.equal(solid.underpowered, undefined);
});

test("A CRITICAL RESULT NOBODY EVER ACKNOWLEDGED STAYS IN THE DENOMINATOR", () => {
  /* This is the measure's whole point. Counting only the loops that WERE acknowledged would drop
   * exactly the failures it exists to find, and the rate would read 100% on a ward where a result
   * has been sitting unseen for a week. */
  const loops = [
    { reportedAt: at(0), acknowledgedAt: at(0.25) },   // 15 min: on time
    { reportedAt: at(1), acknowledgedAt: at(2) },      // 60 min: late
    { reportedAt: at(2), acknowledgedAt: null },       // never
    { reportedAt: OUT, acknowledgedAt: at(3) },        // outside the period
  ];
  const m = byId(run({ loops }), "critical-ack-within-window");
  assert.equal(m.denominator, 3, "the never-acknowledged one is counted, the out-of-period one is not");
  assert.equal(m.numerator, 1);
  // Reported separately: "acknowledged late" and "never acknowledged" are different failures, and
  // only one of them is still happening.
  assert.equal(m.neverAcknowledged, 1);
  assert.equal(m.windowMinutes, 30);
});

test("A MEASURE WITH NO AGREED THRESHOLD IS NOT COMPUTED AGAINST AN INVENTED ONE", () => {
  const m = byId(run({ loops: [{ reportedAt: at(0), acknowledgedAt: at(0.1) }], ackWindowMinutes: null }), "critical-ack-within-window");
  assert.equal(m.computable, false);
  assert.equal(m.rate, null);
  // Named with the reason and with the fix, because a measure scored against a window nobody agreed
  // to is a number nobody will act on.
  assert.match(m.reason, /configured no escalation window/);
  assert.match(m.reason, /wardsynq\.criticalEscalation/);
});

test("A DOSE WITH NO DUE TIME IS EXCLUDED FROM BOTH HALVES, not counted as late", () => {
  const administrations = [
    { status: "administered", dueAt: at(8), administeredAt: at(8.5) },   // 30 min: within grace
    { status: "administered", dueAt: at(8), administeredAt: at(10) },    // 2 h: late
    { status: "administered", dueAt: at(8), administeredAt: at(7) },     // an hour EARLY, not late
    { status: "administered", dueAt: null, administeredAt: at(9) },      // written before dueAt existed
    { status: "held", dueAt: at(8), administeredAt: at(8) },             // not given at all
  ];
  const m = byId(run({ administrations }), "dose-on-time");
  /* A record that cannot answer the question is not evidence of a late dose, so it leaves the
   * denominator too. Counting it as late would report a failing eMAR because of a schema change. */
  assert.equal(m.denominator, 3);
  assert.equal(m.excludedNoDueTime, 1);
  assert.equal(m.numerator, 2, "on time and early both count; early is not late");

  // Every dose in the period predating dueAt: refused rather than reported as 0%.
  const old = byId(run({ administrations: [{ status: "administered", dueAt: null, administeredAt: at(9) }] }), "dose-on-time");
  assert.equal(old.computable, false);
  assert.match(old.reason, /do not carry dueAt/);
});

test("ONLY A DISCHARGE SUMMARY COUNTS AS A DISCHARGE SUMMARY, and an open stay is not late", () => {
  const encounters = [
    { id: "e1", class: "IPD", status: "finished", periodEnd: at(1) },
    { id: "e2", class: "IPD", status: "finished", periodEnd: at(2) },
    { id: "e3", class: "IPD", status: "in-progress", periodEnd: null },   // still here, not late
    { id: "e4", class: "OPD", status: "finished", periodEnd: at(3) },     // not an admission
  ];
  const summaries = [
    { encounterId: "e1", noteType: "discharge-summary", signedBy: "cfa:dr" },
    { encounterId: "e2", noteType: "discharge-summary", signedBy: null },  // drafted, unsigned
    // A signed ward round note against a stay is NOT a discharge summary, and counting it would
    // report one wherever anybody had signed anything.
    { encounterId: "e2", noteType: "progress", signedBy: "cfa:dr" },
  ];
  const m = byId(run({ encounters, summaries }), "discharge-summary-signed");
  assert.equal(m.denominator, 2);
  assert.equal(m.numerator, 1);
  assert.equal(m.rate, 0.5);
});

test("THE MEASURE THE RECORD CANNOT SUPPORT IS SHOWN WITH ITS REASON, never left off", () => {
  const m = byId(run({}), "allergy-status-documented");
  assert.equal(m.computable, false);
  assert.equal(m.rate, null);
  /* Omitting it would read as "nothing to report" on a dashboard. Estimating it would report good
   * documentation for a ward that never asks - a guess in the dangerous direction. */
  assert.match(m.reason, /asked, and there are none/);
  assert.match(m.reason, /not a calculation/);
  // And it is still in the list, so a reader counts four measures and sees which two are unavailable.
  assert.equal(run({}).length, 4);
});
