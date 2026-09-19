/* test/wardsynq-flowsheet.test.mjs — the running total that is quietly wrong.
 *
 * Decisions in an ICU are made off the flowsheet's totals rather than its cells, and a total looks
 * equally authoritative whether or not the hours underneath it are complete. Most of these tests are
 * about that, and the rest are about an infusion volume being an integral rather than a
 * multiplication.
 *
 * node --test test/wardsynq-flowsheet.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BACKFILL_AFTER_MINUTES, KIND, DIRECTION, FlowsheetError,
  hourBucket, hoursBetween, chart, correct,
  fluidBalance, infusionVolume, weightBasedRate, setVersusMeasured, buildGrid, recomputeAfterCorrection,
} from "../wardsynq/wardsynq-flowsheet.js";

const DAY = "2026-09-04T";
const h = (hour, min = 0) => `${DAY}${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000Z`;

const entry = (over) => chart({
  patientId: "pat-1", code: "urine", label: "Urine output", value: 50, unit: "mL",
  kind: KIND.OBSERVED, direction: DIRECTION.OUT,
  observedAt: h(0), chartedAt: h(0, 10), by: "nurse-7", ...over,
});

/** A full 24 hours of intake and output, both charted every hour. */
const fullDay = (perHourIn = 100, perHourOut = 80) => {
  const out = [];
  for (let i = 0; i < 24; i++) {
    out.push(entry({ code: "iv-fluids", direction: DIRECTION.IN, value: perHourIn, observedAt: h(i), chartedAt: h(i, 10) }));
    out.push(entry({ code: "urine", direction: DIRECTION.OUT, value: perHourOut, observedAt: h(i), chartedAt: h(i, 10) }));
  }
  return out;
};

/* ------------------------------------------------------------------ buckets and times */

test("an observation falls into its hour bucket", () => {
  assert.equal(hourBucket(h(14, 40)), h(14));
  assert.equal(hourBucket(h(14, 0)), h(14));
  assert.equal(hoursBetween(h(0), h(24)).length, 24);
  assert.throws(() => hourBucket("not a time"), (e) => e instanceof FlowsheetError && e.code === "BAD_TIME");
});

test("ADVERSARIAL: observedAt and chartedAt are BOTH required", () => {
  assert.throws(() => chart({ patientId: "p", code: "c", kind: KIND.OBSERVED, by: "n", observedAt: h(1) }),
    (e) => e.code === "NO_TIMES");
  try {
    chart({ patientId: "p", code: "c", kind: KIND.OBSERVED, by: "n", chartedAt: h(1) });
  } catch (e) {
    assert.match(e.message, /Charting is retrospective in an ICU/);
    assert.match(e.message, /erases whether the record was contemporaneous/);
  }
});

test("ADVERSARIAL: a late entry is marked BACKFILLED, and the mark is computed not declared", () => {
  const prompt = entry({ observedAt: h(14), chartedAt: h(14, 40) });
  assert.equal(prompt.backfilled, false);
  assert.equal(prompt.lagMinutes, 40);

  // After a bad night the 14:00 observations get written at 20:00.
  const late = entry({ observedAt: h(14), chartedAt: h(20) });
  assert.equal(late.backfilled, true);
  assert.equal(late.lagMinutes, 360);
  assert.match(late.backfillNote, /retrospective entry, not a contemporaneous one/);

  // A caller cannot switch it off, because it is derived rather than passed in.
  const forged = entry({ observedAt: h(14), chartedAt: h(20), backfilled: false });
  assert.equal(forged.backfilled, true);
});

test("an entry cannot be charted before it was observed", () => {
  assert.throws(() => entry({ observedAt: h(14), chartedAt: h(13) }), (e) => e.code === "CHARTED_BEFORE_OBSERVED");
});

test("set and measured are different KINDS, not a flag", () => {
  assert.throws(() => entry({ kind: "peep" }), (e) => e.code === "NO_KIND");
  try {
    entry({ kind: undefined });
  } catch (e) {
    assert.match(e.message, /a set value and a measured value are different facts/);
  }
});

/* ------------------------------------------------------------------ ADVERSARIAL: the missing hour */

test("ADVERSARIAL: a complete day totals honestly", () => {
  const b = fluidBalance(fullDay(100, 80), { from: h(0), to: h(24) });
  assert.equal(b.inMl, 2400);
  assert.equal(b.outMl, 1920);
  assert.equal(b.balanceMl, 480);
  assert.equal(b.complete, true);
  assert.equal(b.caution, null);
  assert.match(b.reading, /over 24 complete hours/);
});

test("ADVERSARIAL: three unchared hours do NOT silently become zero", () => {
  // Nobody charted output between 03:00 and 06:00. The patient did not stop producing urine.
  const day = fullDay(100, 80).filter((e) => {
    const hr = Number(e.observedAt.slice(11, 13));
    return !(e.direction === DIRECTION.OUT && hr >= 3 && hr < 6);
  });

  const b = fluidBalance(day, { from: h(0), to: h(24) });
  assert.equal(b.complete, false);
  assert.equal(b.missingHours.length, 3);
  assert.deepEqual(b.missingHours.map((m) => m.hour.slice(11, 16)), ["03:00", "04:00", "05:00"]);
  assert.deepEqual(b.missingHours[0].missing, ["output"]);

  // The numbers are still returned, deliberately: suppressing them pushes a nurse to add it up on
  // paper. What is refused is calling this a balance.
  assert.equal(b.balanceMl, 2400 - (21 * 80));
  assert.match(b.reading, /INCOMPLETE: 03:00 \(output\), 04:00 \(output\), 05:00 \(output\)/);
  assert.match(b.caution, /the difference is exactly the amount nobody recorded/);
});

test("ADVERSARIAL: an hour with intake charted and output blank is NOT a complete hour", () => {
  const day = fullDay(100, 80).filter((e) => !(e.direction === DIRECTION.OUT && e.observedAt === h(7)));
  const b = fluidBalance(day, { from: h(0), to: h(24) });
  assert.equal(b.complete, false);
  assert.equal(b.hoursCovered, 23);
  assert.deepEqual(b.missingHours[0].missing, ["output"]);
});

test("a window requiring only output can say so, and then intake gaps do not fail it", () => {
  const outputOnly = fullDay(100, 80).filter((e) => e.direction === DIRECTION.OUT);
  assert.equal(fluidBalance(outputOnly, { from: h(0), to: h(24) }).complete, false);
  assert.equal(fluidBalance(outputOnly, { from: h(0), to: h(24), requireBothDirections: false }).complete, true);
});

test("a balance over an empty window reports every hour missing rather than a tidy zero", () => {
  const b = fluidBalance([], { from: h(0), to: h(4) });
  assert.equal(b.balanceMl, 0);
  assert.equal(b.complete, false);
  assert.equal(b.missingHours.length, 4);
  assert.throws(() => fluidBalance([], {}), (e) => e.code === "NO_WINDOW");
});

/* ------------------------------------------------------------------ ADVERSARIAL: corrections */

test("ADVERSARIAL: a correction supersedes rather than overwrites, and says what it invalidated", () => {
  const original = entry({ code: "urine", value: 400, observedAt: h(2), chartedAt: h(2, 5) });
  const { original: kept, replacement, note } = correct(original, {
    value: 40, by: "nurse-9", reason: "transcription error, the jug read 40 not 400", at: h(6),
  });

  assert.equal(kept.value, 400, "the wrong value is what a clinician saw and may have acted on");
  assert.ok(kept.supersededBy);
  assert.equal(replacement.value, 40);
  assert.equal(replacement.amended, true);
  assert.equal(replacement.supersedes.value, 400);
  assert.match(note, /is now wrong until recomputed/);
  assert.match(note, /Check whether anyone acted on it/);
});

test("a corrected entry is excluded from the total and its replacement included", () => {
  const day = fullDay(100, 80);
  const wrong = entry({ code: "urine", value: 400, observedAt: h(2), chartedAt: h(2, 5) });

  // The total a consultant read at 06:00, before anybody noticed.
  const before = fluidBalance([...day, wrong], { from: h(0), to: h(24) });
  assert.equal(before.outMl, 24 * 80 + 400);

  // correct() marks the original superseded IN PLACE, so the same array now totals differently.
  // That is the point: the chart has one current truth and keeps the one it used to have.
  const { replacement } = correct(wrong, { value: 40, by: "n", reason: "misread", at: h(6) });
  const after = fluidBalance([...day, wrong, replacement], { from: h(0), to: h(24) });

  assert.equal(after.outMl, 24 * 80 + 40, "the 400 is dropped and the 40 counted");
  assert.equal(before.outMl - after.outMl, 360, "and 360 mL of output that never happened has left the balance");
});

test("a correction needs a reason and cannot be applied twice", () => {
  const e = entry();
  assert.throws(() => correct(e, { value: 1, by: "n" }), (e2) => e2.code === "NO_REASON");
  correct(e, { value: 1, by: "n", reason: "r", at: h(3) });
  assert.throws(() => correct(e, { value: 2, by: "n", reason: "r", at: h(4) }), (e2) => e2.code === "ALREADY_CORRECTED");
});

/* ------------------------------------------------------------------ ADVERSARIAL: infusions */

test("ADVERSARIAL: an infusion volume is an INTEGRAL, not the current rate times elapsed time", () => {
  // Noradrenaline: 10 mL/h for two hours, weaned to 2 mL/h for the next two.
  const history = [
    { at: h(0), ratePerHour: 10 },
    { at: h(2), ratePerHour: 2 },
  ];
  const v = infusionVolume(history, { from: h(0), to: h(4) });

  assert.equal(v.ml, 24, "10x2 + 2x2 = 24");
  // The obvious wrong implementation, current rate x elapsed, gives 2 x 4 = 8: a third of the truth,
  // and it under-reports a vasopressor, which is the direction that misleads.
  assert.notEqual(v.ml, 8);
  assert.equal(v.segments.length, 2);
  assert.equal(v.segments[0].ratePerHour, 10);
});

test("a rate change part-way through an hour is integrated exactly", () => {
  const v = infusionVolume([{ at: h(0), ratePerHour: 10 }, { at: h(0, 30), ratePerHour: 0 }], { from: h(0), to: h(1) });
  assert.equal(v.ml, 5);
});

test("a window that opens before the infusion started says so", () => {
  const v = infusionVolume([{ at: h(6), ratePerHour: 10 }], { from: h(0), to: h(8) });
  assert.equal(v.ml, 20);
  assert.equal(v.startedAfterWindow, true);
  assert.match(v.reason, /after the window opened/);
});

test("an unsorted rate history is sorted rather than trusted", () => {
  const jumbled = [{ at: h(2), ratePerHour: 2 }, { at: h(0), ratePerHour: 10 }];
  assert.equal(infusionVolume(jumbled, { from: h(0), to: h(4) }).ml, 24);
});

test("no rate history is reported as incomplete, not as zero volume delivered", () => {
  const v = infusionVolume([], { from: h(0), to: h(4) });
  assert.equal(v.complete, false);
  assert.match(v.reason, /no rate history/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the weight */

test("ADVERSARIAL: a weight-based rate cannot be calculated without a weight", () => {
  const r = weightBasedRate({ dosePerKgPerMin: 0.1, concentrationMgPerMl: 0.064 });
  assert.equal(r.ratePerHour, null);
  assert.match(r.reason, /an estimate must be recorded AS an estimate rather than assumed/);
});

test("a rate is computed with its workings, so the cell can be traced to the three numbers", () => {
  const r = weightBasedRate({ dosePerKgPerMin: 0.1, weightKg: 70, concentrationMgPerMl: 0.064 });
  // 0.1 x 70 x 60 = 420 mcg/h = 0.42 mg/h / 0.064 = 6.56 mL/h
  assert.equal(r.ratePerHour, 6.56);
  assert.match(r.workings, /0\.1 mcg\/kg\/min x 70 kg x 60 = 420 mcg\/h/);
});

test("ADVERSARIAL: an implausible weight is flagged, because every rate is multiplied by it", () => {
  const r = weightBasedRate({ dosePerKgPerMin: 0.1, weightKg: 700, concentrationMgPerMl: 0.064 });
  assert.ok(r.ratePerHour > 0, "the arithmetic still runs; what is added is the warning");
  assert.ok(r.weightWarning);
  assert.match(r.caution, /Every weight-based rate on this patient is multiplied by this number/);
});

test("a paediatric weight is checked against the child's own band", () => {
  const r = weightBasedRate({ dosePerKgPerMin: 0.1, weightKg: 60, concentrationMgPerMl: 0.064, patient: { ageDays: 3 } });
  assert.ok(r.weightWarning, "60 kg is not a neonate");
  const ok = weightBasedRate({ dosePerKgPerMin: 0.1, weightKg: 3.4, concentrationMgPerMl: 0.064, patient: { ageDays: 3 } });
  assert.equal(ok.weightWarning, null);
});

test("a rate needs the concentration of the bag actually hanging", () => {
  assert.throws(() => weightBasedRate({ dosePerKgPerMin: 0.1, weightKg: 70 }), (e) => e.code === "NO_CONCENTRATION");
  assert.throws(() => weightBasedRate({ weightKg: 70, concentrationMgPerMl: 1 }), (e) => e.code === "NO_DOSE");
});

/* ------------------------------------------------------------------ ADVERSARIAL: set vs measured */

test("ADVERSARIAL: a set PEEP and a measured PEEP that disagree is the finding", () => {
  const rows = [
    entry({ code: "peep", label: "PEEP", value: 8, unit: "cmH2O", kind: KIND.SET, direction: null, observedAt: h(9), chartedAt: h(9, 5) }),
    entry({ code: "peep", label: "PEEP", value: 12, unit: "cmH2O", kind: KIND.MEASURED, direction: null, observedAt: h(9), chartedAt: h(9, 5) }),
  ];
  const r = setVersusMeasured(rows, "peep", { hour: h(9) });
  assert.equal(r.state, "diverged");
  assert.equal(r.difference, 4);
  assert.match(r.note, /The difference is the finding/);
});

test("a set value with no measured value, and the reverse, are each reported as what they are", () => {
  const setOnly = [entry({ code: "peep", value: 8, kind: KIND.SET, direction: null, observedAt: h(9), chartedAt: h(9, 5) })];
  assert.equal(setVersusMeasured(setOnly, "peep").state, "set-only");
  assert.match(setVersusMeasured(setOnly, "peep").note, /not known whether it was delivered/);

  const measuredOnly = [entry({ code: "peep", value: 12, kind: KIND.MEASURED, direction: null, observedAt: h(9), chartedAt: h(9, 5) })];
  assert.equal(setVersusMeasured(measuredOnly, "peep").state, "measured-only");
  assert.match(setVersusMeasured(measuredOnly, "peep").note, /whether the machine is doing what was asked/);
});

test("a tolerance can be set, and within it the pair matches", () => {
  const rows = [
    entry({ code: "peep", value: 8, kind: KIND.SET, direction: null, observedAt: h(9), chartedAt: h(9, 5) }),
    entry({ code: "peep", value: 8.4, kind: KIND.MEASURED, direction: null, observedAt: h(9), chartedAt: h(9, 5) }),
  ];
  assert.equal(setVersusMeasured(rows, "peep", { tolerance: 0.5 }).state, "matched");
  assert.equal(setVersusMeasured(rows, "peep", { tolerance: 0 }).state, "diverged");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the grid */

test("ADVERSARIAL: an empty cell stays empty and is counted, never rendered as a zero", () => {
  const rows = [
    entry({ code: "urine", value: 80, observedAt: h(0), chartedAt: h(0, 5) }),
    entry({ code: "urine", value: 60, observedAt: h(2), chartedAt: h(2, 5) }),
  ];
  const grid = buildGrid(rows, { from: h(0), to: h(4) });
  const urine = grid.rows.find((r) => r.code === "urine");

  assert.equal(urine.cells.length, 4);
  assert.equal(urine.cells[1].empty, true);
  assert.equal(urine.cells[1].value, null, "a blank rendered as 0 is the display half of the missing-hour problem");
  assert.equal(urine.chartedHours, 2);
  assert.equal(urine.completeness, 50);
});

test("the grid surfaces backfilling at the top, because the PATTERN is the signal", () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(entry({ observedAt: h(i), chartedAt: h(i + 7) }));
  const grid = buildGrid(rows, { from: h(0), to: h(8) });

  assert.equal(grid.backfilledEntries, 8);
  assert.match(grid.backfillReading, /Read this grid as partly retrospective/);
  // One backfilled row is a busy hour. A whole shift of them is a shift where nobody was charting.
  assert.ok(grid.backfillReading.includes(`${BACKFILL_AFTER_MINUTES} minutes`));
});

test("a corrected entry is not shown in the grid, and the amendment count is", () => {
  const wrong = entry({ code: "urine", value: 400, observedAt: h(2), chartedAt: h(2, 5) });
  const { replacement } = correct(wrong, { value: 40, by: "n", reason: "misread", at: h(6) });
  const grid = buildGrid([wrong, replacement], { from: h(0), to: h(4) });
  const cell = grid.rows[0].cells[2];
  assert.equal(cell.value, 40);
  assert.equal(cell.amended, true);
  assert.equal(grid.amendedEntries, 1);
});

test("the grid can be asked for specific codes and keeps their order", () => {
  const rows = [
    entry({ code: "urine", observedAt: h(0), chartedAt: h(0, 5) }),
    entry({ code: "peep", kind: KIND.SET, direction: null, observedAt: h(0), chartedAt: h(0, 5) }),
  ];
  const grid = buildGrid(rows, { from: h(0), to: h(2), codes: ["peep", "urine"] });
  assert.deepEqual(grid.rows.map((r) => r.code), ["peep", "urine"]);
});

/* ------------------------------------------------------------------ ADVERSARIAL: what the correction changed
 *
 * correct() can only tell the person making the correction that later totals are wrong. This says
 * WHICH, by how much, and flags the case that is not merely arithmetic: a balance that crosses a
 * line somebody prescribes against.
 */

test("ADVERSARIAL: a correction reports exactly which cumulative totals changed", () => {
  const day = fullDay(100, 80);
  const wrong = entry({ code: "urine", value: 400, observedAt: h(2), chartedAt: h(2, 5) });
  const correction = correct(wrong, { value: 40, by: "n", reason: "misread the jug", at: h(6) });
  const entries = [...day, wrong, correction.replacement];

  const r = recomputeAfterCorrection({
    entries, correction,
    windows: [
      { from: h(0), to: h(4), label: "00:00 to 04:00" },
      { from: h(0), to: h(24), label: "24 hour balance" },
      { from: h(6), to: h(12), label: "06:00 to 12:00" },
    ],
  });

  assert.equal(r.windowsChanged, 2, "the window that does not contain the corrected hour is untouched");
  assert.ok(r.changed.every((c) => c.label !== "06:00 to 12:00"));
  assert.equal(r.changed.find((c) => c.label === "24 hour balance").deltaMl, 360);
  assert.match(r.reading, /24 hour balance/);
});

test("ADVERSARIAL: a total that CROSSES zero is flagged, because that is a different patient", () => {
  // Six hours: 100 mL/h in, 80 mL/h out, so +120. One hour of output was charted as 400 instead of 40.
  const rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push(entry({ code: "iv", direction: DIRECTION.IN, value: 100, observedAt: h(i), chartedAt: h(i, 5) }));
    if (i !== 2) rows.push(entry({ code: "urine", direction: DIRECTION.OUT, value: 80, observedAt: h(i), chartedAt: h(i, 5) }));
  }
  const wrong = entry({ code: "urine", direction: DIRECTION.OUT, value: 400, observedAt: h(2), chartedAt: h(2, 5) });
  const before = [...rows, wrong];

  const beforeBalance = fluidBalance(before, { from: h(0), to: h(6) });
  assert.ok(beforeBalance.balanceMl < 0, "the wrong figure made this patient look negative");

  const correction = correct(wrong, { value: 40, by: "n", reason: "misread", at: h(7) });
  const r = recomputeAfterCorrection({
    entries: [...rows, wrong, correction.replacement], correction,
    windows: [{ from: h(0), to: h(6), label: "shift balance" }],
  });

  assert.equal(r.crossings.length, 1);
  assert.match(r.crossings[0].significance, /read negative and now reads positive/,
    "not '360 mL smaller': a patient who was negative and is now positive, which is what gets prescribed on");
});

test("a correction that changes nothing in the given windows says so plainly", () => {
  const day = fullDay(100, 80);
  const wrong = entry({ code: "urine", value: 400, observedAt: h(2), chartedAt: h(2, 5) });
  const correction = correct(wrong, { value: 40, by: "n", reason: "misread", at: h(6) });

  const r = recomputeAfterCorrection({
    entries: [...day, wrong, correction.replacement], correction,
    windows: [{ from: h(10), to: h(14), label: "later" }],
  });
  assert.equal(r.windowsChanged, 0);
  assert.match(r.reading, /No cumulative total in the given windows changed/);
});

test("ADVERSARIAL: the recomputation states the thing it CANNOT do", () => {
  const day = fullDay(100, 80);
  const wrong = entry({ code: "urine", value: 400, observedAt: h(2), chartedAt: h(2, 5) });
  const correction = correct(wrong, { value: 40, by: "n", reason: "misread", at: h(6) });

  const r = recomputeAfterCorrection({
    entries: [...day, wrong, correction.replacement], correction,
    windows: [{ from: h(0), to: h(24) }],
  });
  assert.match(r.limitation, /does NOT identify who read the previous figures/);
  assert.match(r.limitation, /Someone has to look/);
});

test("recomputation needs both entry sets and at least one window", () => {
  assert.throws(() => recomputeAfterCorrection({ windows: [{ from: h(0), to: h(1) }] }), (e) => e.code === "NO_SETS");
  assert.throws(() => recomputeAfterCorrection({ entries: [], windows: [{ from: h(0), to: h(1) }] }),
    (e) => e.code === "NO_CORRECTION");
  const c = correct(entry(), { value: 1, by: "n", reason: "r", at: h(9) });
  assert.throws(() => recomputeAfterCorrection({ entries: [], correction: c }), (e) => e.code === "NO_WINDOW");
});
