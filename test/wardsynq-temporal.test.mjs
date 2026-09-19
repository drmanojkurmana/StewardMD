/* test/wardsynq-temporal.test.mjs: WardSynQ P0 bi-temporal query engine test suite.
 *
 * Verifies the bi-temporal query engine over append-only clinical records. Tests ensure
 * that historical beliefs and clinical truths are independently recoverable, corrections
 * supersede without destructive deletion, out-of-order sync replays resolve deterministically,
 * and medico-legal audit scenarios answer both standard-of-care and physiological-truth questions.
 *
 * node --test test/wardsynq-temporal.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Observation,
  MedicationOrder,
  Patient,
  Condition,
  makeMeta,
} from "../wardsynq/wardsynq-model.js";
import {
  asOf,
  historyOf,
  timeline,
  corrections,
  diff,
  reconstructAt,
} from "../wardsynq/wardsynq-temporal.js";

/* ------------------------------------------------------------------ fixtures */

function anObservation(over = {}) {
  const meta = makeMeta({
    effectiveAt: over.effectiveAt,
    source: over.source || { system: "wardsynq-native" },
  });
  if (over.recordedAt) {
    meta.recordedAt = over.recordedAt;
    if (!over.effectiveAt) {
      meta.effectiveAt = over.recordedAt;
    }
  }
  if (over.amendedAt) {
    meta.amendedAt = over.amendedAt;
  }

  const { recordedAt, effectiveAt, amendedAt, ...rest } = over;
  const base = Observation({
    patientId: "pat-temporal-1",
    code: "8867-4",
    value: 80,
    unit: "bpm",
    ...rest,
  });
  base.meta = meta;
  if (over.version !== undefined) {
    base.version = over.version;
  }
  return base;
}

function anOrder(over = {}) {
  const meta = makeMeta({
    effectiveAt: over.effectiveAt,
    source: over.source || { system: "wardsynq-native" },
  });
  if (over.recordedAt) {
    meta.recordedAt = over.recordedAt;
    if (!over.effectiveAt) {
      meta.effectiveAt = over.recordedAt;
    }
  }
  if (over.amendedAt) {
    meta.amendedAt = over.amendedAt;
  }

  const { recordedAt, effectiveAt, amendedAt, ...rest } = over;
  const base = MedicationOrder({
    patientId: "pat-temporal-1",
    drug: "Paracetamol 500mg tablet",
    prescriberId: "dr-primary-1",
    ...rest,
  });
  base.meta = meta;
  if (over.version !== undefined) {
    base.version = over.version;
  }
  return base;
}

/* ------------------------------------------------------------------ empty and single-element inputs */

test("temporal: empty inputs do not throw and return safe fallback values", () => {
  assert.equal(asOf([]), null, "asOf over empty array must return null");
  assert.equal(asOf(null), null, "asOf over null must return null");
  assert.equal(asOf(undefined), null, "asOf over undefined must return null");

  assert.deepEqual(historyOf([]), [], "historyOf over empty array must return empty array");
  assert.deepEqual(historyOf(null), [], "historyOf over null must return empty array");

  assert.deepEqual(timeline([]), [], "timeline over empty array must return empty array");
  assert.deepEqual(timeline(null), [], "timeline over null must return empty array");

  assert.deepEqual(corrections([]), [], "corrections over empty array must return empty array");
  assert.deepEqual(corrections(null), [], "corrections over null must return empty array");

  assert.deepEqual(diff(null, null), [], "diff with null inputs must return empty array");
  assert.deepEqual(diff({}, {}), [], "diff with empty objects must return empty array");

  assert.equal(reconstructAt([]), null, "reconstructAt over empty array must return null");
  assert.equal(reconstructAt(null), null, "reconstructAt over null must return null");
});

test("temporal: single-element inputs do not throw and handle trivial cases correctly", () => {
  const obs = anObservation({
    recordedAt: "2026-09-01T10:00:00.000Z",
    effectiveAt: "2026-09-01T09:30:00.000Z",
    value: 72,
    version: 1,
  });

  const matched = asOf([obs], {
    knownAt: "2026-09-01T11:00:00.000Z",
    effectiveAt: "2026-09-01T09:30:00.000Z",
  });
  assert.ok(matched, "single element must match when query bounds include it");
  assert.equal(matched.value, 72, "value must match single element");

  const hist = historyOf([obs]);
  assert.equal(hist.length, 1, "history of single element has exactly one entry");
  assert.equal(hist[0].wasCurrentBelief, true, "single recorded observation was the belief");
  assert.equal(hist[0].supersededBeforeEffective, false, "single observation was never superseded");
  assert.equal(hist[0].isCurrentBelief, true, "single observation remains current belief");

  const tl = timeline([obs]);
  assert.equal(tl.length, 1, "timeline has one interval for single version");
  assert.equal(tl[0].from, "2026-09-01T09:30:00.000Z", "timeline from matches effectiveAt");
  assert.equal(tl[0].to, null, "timeline to is null for ongoing latest belief");
  assert.equal(tl[0].version.value, 72, "timeline holds version content");

  const corr = corrections([obs]);
  assert.deepEqual(corr, [], "single un-amended version has no corrections");

  const rec = reconstructAt([obs], "2026-09-01T10:00:00.000Z");
  assert.ok(rec, "reconstructAt finds single observation at its recorded time");
  assert.equal(rec.value, 72, "reconstructAt returns correct value");
});

/* ------------------------------------------------------------------ immutability */

test("temporal: pure functions never mutate inputs", () => {
  const v1 = Object.freeze(
    anObservation({
      recordedAt: "2026-09-01T10:00:00.000Z",
      effectiveAt: "2026-09-01T10:00:00.000Z",
      value: 60,
      version: 1,
    })
  );
  const v2 = Object.freeze(
    anObservation({
      recordedAt: "2026-09-01T11:00:00.000Z",
      effectiveAt: "2026-09-01T10:00:00.000Z",
      amendedAt: "2026-09-01T11:00:00.000Z",
      value: 65,
      version: 2,
    })
  );

  const inputList = Object.freeze([v2, v1]); // Out of order and frozen

  assert.doesNotThrow(() => {
    asOf(inputList, { knownAt: "2026-09-01T12:00:00.000Z" });
    historyOf(inputList);
    timeline(inputList);
    corrections(inputList);
    diff(v1, v2);
    reconstructAt(inputList, "2026-09-01T12:00:00.000Z");
  }, "operations on frozen inputs must not attempt in-place mutations");

  assert.equal(inputList[0], v2, "input array ordering must remain untouched");
  assert.equal(inputList[1], v1, "input array ordering must remain untouched");
});

/* ------------------------------------------------------------------ retroactive observation visibility */

test("temporal: retroactive observation is invisible before recordedAt and visible after", () => {
  // A clinician took a bedside reading at 08:00, but entered it into the system at 11:00
  const retroObs = anObservation({
    id: "obs-vitals-1",
    effectiveAt: "2026-09-01T08:00:00.000Z", // When the vitals actually occurred
    recordedAt: "2026-09-01T11:00:00.000Z", // When the system learned the vitals
    value: 138, // Systolic BP
    unit: "mmHg",
    version: 1,
  });

  const versions = [retroObs];

  // At 10:00, a physician rounds on the ward and queries what was true at 08:00
  const beliefAtTen = asOf(versions, {
    knownAt: "2026-09-01T10:00:00.000Z",
    effectiveAt: "2026-09-01T08:00:00.000Z",
  });
  assert.equal(
    beliefAtTen,
    null,
    "at 10:00 the system did not yet have the record so querying 08:00 state must return null"
  );

  // At 11:30, after the reading was charted at 11:00, the system is queried again for 08:00 state
  const beliefAtElevenThirty = asOf(versions, {
    knownAt: "2026-09-01T11:30:00.000Z",
    effectiveAt: "2026-09-01T08:00:00.000Z",
  });
  assert.ok(
    beliefAtElevenThirty,
    "at 11:30 the system knows of the 08:00 reading so it must be returned"
  );
  assert.equal(
    beliefAtElevenThirty.value,
    138,
    "the correct retroactive reading must be retrieved"
  );
});

/* ------------------------------------------------------------------ correction superseding without deleting */

test("temporal: correction supersedes without deleting prior records", () => {
  const v1 = anObservation({
    id: "obs-spo2-1",
    recordedAt: "2026-09-01T09:00:00.000Z",
    effectiveAt: "2026-09-01T09:00:00.000Z",
    value: 88, // Initially entered as 88%
    unit: "%",
    version: 1,
  });

  const v2 = anObservation({
    id: "obs-spo2-1",
    recordedAt: "2026-09-01T09:45:00.000Z",
    effectiveAt: "2026-09-01T09:00:00.000Z", // Correcting the 09:00 measurement
    amendedAt: "2026-09-01T09:45:00.000Z",
    value: 98, // True measurement was 98% (typographical error corrected)
    unit: "%",
    version: 2,
  });

  const allVersions = [v1, v2];

  // What did we believe at 09:30 about the 09:00 reading?
  const beliefBeforeCorrection = asOf(allVersions, {
    knownAt: "2026-09-01T09:30:00.000Z",
    effectiveAt: "2026-09-01T09:00:00.000Z",
  });
  assert.equal(
    beliefBeforeCorrection.value,
    88,
    "before the correction was recorded at 09:45 the system believed SpO2 was 88%"
  );
  assert.equal(
    beliefBeforeCorrection.version,
    1,
    "v1 was the active belief prior to the correction"
  );

  // What do we believe at 10:00 about the 09:00 reading?
  const beliefAfterCorrection = asOf(allVersions, {
    knownAt: "2026-09-01T10:00:00.000Z",
    effectiveAt: "2026-09-01T09:00:00.000Z",
  });
  assert.equal(
    beliefAfterCorrection.value,
    98,
    "after the correction was recorded at 09:45 the system knows SpO2 was 98%"
  );
  assert.equal(
    beliefAfterCorrection.version,
    2,
    "v2 superseded v1 without deleting v1 from the append-only log"
  );

  // Chart audit verification
  const audit = corrections(allVersions);
  assert.equal(audit.length, 1, "exactly one correction occurred");
  assert.equal(
    audit[0].correction.value,
    98,
    "audit pairs the correction v2"
  );
  assert.equal(
    audit[0].superseded.value,
    88,
    "audit pairs the superseded v1"
  );
  assert.deepEqual(
    audit[0].diff,
    [{ field: "value", from: 88, to: 98 }],
    "diff captures the exact clinical change from 88 to 98"
  );
});

/* ------------------------------------------------------------------ omitted axes */

test("temporal: asOf with only knownAt and with only effectiveAt", () => {
  const pastRecord = anObservation({
    recordedAt: "2026-09-01T08:00:00.000Z",
    effectiveAt: "2026-09-01T08:00:00.000Z",
    value: 70,
    version: 1,
  });

  const recentRecord = anObservation({
    recordedAt: "2026-09-01T12:00:00.000Z",
    effectiveAt: "2026-09-01T12:00:00.000Z",
    value: 80,
    version: 2,
  });

  const list = [pastRecord, recentRecord];

  // Only knownAt specified: effectiveAt defaults to now
  const knownAtTen = asOf(list, { knownAt: "2026-09-01T10:00:00.000Z" });
  assert.ok(knownAtTen, "knownAt 10:00 should match records known by 10:00");
  assert.equal(
    knownAtTen.value,
    70,
    "at 10:00 only pastRecord was known so recentRecord must not be returned"
  );

  // Only effectiveAt specified: knownAt defaults to now
  const effectiveAtTen = asOf(list, { effectiveAt: "2026-09-01T10:00:00.000Z" });
  assert.ok(effectiveAtTen, "effectiveAt 10:00 should match latest state effective by 10:00");
  assert.equal(
    effectiveAtTen.value,
    70,
    "at effective time 10:00 pastRecord was effective (recentRecord was not effective until 12:00)"
  );

  // Neither axis specified: both default to now
  const currentBelief = asOf(list);
  assert.ok(currentBelief, "omitting both axes defaults to now");
  assert.equal(
    currentBelief.value,
    80,
    "default query returns latest recorded and effective state"
  );
});

/* ------------------------------------------------------------------ timeline interval merging */

test("temporal: timeline builds intervals and merges adjacent identical versions", () => {
  // Case A: Consecutive intervals with DIFFERENT versions should NOT merge
  const vA = anObservation({
    id: "obs-pulse-1",
    recordedAt: "2026-09-01T08:00:00.000Z",
    effectiveAt: "2026-09-01T08:00:00.000Z",
    value: 72,
    version: 1,
  });
  const vB = anObservation({
    id: "obs-pulse-1",
    recordedAt: "2026-09-01T12:00:00.000Z",
    effectiveAt: "2026-09-01T12:00:00.000Z",
    value: 84,
    version: 2,
  });

  const tlDiff = timeline([vA, vB]);
  assert.equal(tlDiff.length, 2, "two distinct versions create two intervals");
  assert.equal(tlDiff[0].from, "2026-09-01T08:00:00.000Z", "first interval start");
  assert.equal(tlDiff[0].to, "2026-09-01T12:00:00.000Z", "first interval ends where second begins");
  assert.equal(tlDiff[0].version.value, 72, "first interval value");
  assert.equal(tlDiff[1].from, "2026-09-01T12:00:00.000Z", "second interval start");
  assert.equal(tlDiff[1].to, null, "latest interval is open-ended");
  assert.equal(tlDiff[1].version.value, 84, "second interval value");

  // Case B: Adjacent intervals holding the SAME version content must MERGE
  const vC = anObservation({
    id: "obs-pulse-1",
    recordedAt: "2026-09-01T16:00:00.000Z",
    effectiveAt: "2026-09-01T16:00:00.000Z",
    value: 84, // Same value as vB!
    version: 3,
  });

  const tlMerged = timeline([vA, vB, vC]);
  // vB (12:00 -> 16:00, value 84) and vC (16:00 -> null, value 84) share identical clinical fields
  assert.equal(
    tlMerged.length,
    2,
    "adjacent intervals holding identical clinical version state must merge into one"
  );
  assert.equal(tlMerged[0].from, "2026-09-01T08:00:00.000Z");
  assert.equal(tlMerged[0].to, "2026-09-01T12:00:00.000Z");
  assert.equal(tlMerged[0].version.value, 72);

  assert.equal(tlMerged[1].from, "2026-09-01T12:00:00.000Z", "merged interval starts at 12:00");
  assert.equal(tlMerged[1].to, null, "merged interval spans continuously to null");
  assert.equal(tlMerged[1].version.value, 84, "merged interval maintains value 84");
});

/* ------------------------------------------------------------------ out of order input handling */

test("temporal: out-of-order sync replay resolves identically to chronological input", () => {
  const v1 = anObservation({
    id: "obs-temp-1",
    recordedAt: "2026-09-01T06:00:00.000Z",
    effectiveAt: "2026-09-01T06:00:00.000Z",
    value: 36.8,
    version: 1,
  });
  const v2 = anObservation({
    id: "obs-temp-1",
    recordedAt: "2026-09-01T12:00:00.000Z",
    effectiveAt: "2026-09-01T12:00:00.000Z",
    value: 38.5,
    version: 2,
  });
  const v3 = anObservation({
    id: "obs-temp-1",
    recordedAt: "2026-09-01T14:00:00.000Z",
    effectiveAt: "2026-09-01T12:00:00.000Z", // Correction of v2
    amendedAt: "2026-09-01T14:00:00.000Z",
    value: 38.2,
    version: 3,
  });
  const v4 = anObservation({
    id: "obs-temp-1",
    recordedAt: "2026-09-01T18:00:00.000Z",
    effectiveAt: "2026-09-01T18:00:00.000Z",
    value: 37.1,
    version: 4,
  });

  const chronological = [v1, v2, v3, v4];
  const scrambled = [v3, v1, v4, v2]; // Simulating packet reordering during offline sync replay

  // asOf comparisons
  const queryOpts = {
    knownAt: "2026-09-01T15:00:00.000Z",
    effectiveAt: "2026-09-01T12:00:00.000Z",
  };
  const resultChronological = asOf(chronological, queryOpts);
  const resultScrambled = asOf(scrambled, queryOpts);
  assert.equal(
    resultScrambled.value,
    resultChronological.value,
    "asOf must produce identical result regardless of array order"
  );
  assert.equal(
    resultScrambled.version,
    3,
    "at 15:00 the correction v3 must be returned"
  );

  // historyOf comparisons
  const histChronological = historyOf(chronological);
  const histScrambled = historyOf(scrambled);
  assert.deepEqual(
    histScrambled.map((h) => h.version),
    histChronological.map((h) => h.version),
    "historyOf must output versions in recorded order regardless of input array order"
  );

  // timeline comparisons
  const tlChronological = timeline(chronological);
  const tlScrambled = timeline(scrambled);
  assert.deepEqual(
    tlScrambled.map((t) => ({ from: t.from, to: t.to, val: t.version.value })),
    tlChronological.map((t) => ({ from: t.from, to: t.to, val: t.version.value })),
    "timeline must produce identical intervals regardless of sync arrival order"
  );

  // corrections comparisons
  const corrChronological = corrections(chronological);
  const corrScrambled = corrections(scrambled);
  assert.equal(
    corrScrambled.length,
    corrChronological.length,
    "corrections count must match regardless of input order"
  );
  assert.equal(
    corrScrambled[0].correction.version,
    3,
    "correction version must be correctly detected"
  );
  assert.equal(
    corrScrambled[0].superseded.version,
    2,
    "superseded version must be correctly identified"
  );
});

/* ------------------------------------------------------------------ historyOf superseding before effect */

test("temporal: historyOf correctly flags orders superseded before taking effect", () => {
  // Clinician orders 10mg IV Morphine at 10:00, scheduled to be administered at 14:00
  const orderV1 = anOrder({
    id: "rx-morphine-1",
    recordedAt: "2026-09-01T10:00:00.000Z",
    effectiveAt: "2026-09-01T14:00:00.000Z", // Scheduled for future
    dose: { value: 10, unit: "mg" },
    status: "active",
    version: 1,
  });

  // At 11:00 (before 14:00), the clinician modifies the order to 5mg due to renal adjustment
  const orderV2 = anOrder({
    id: "rx-morphine-1",
    recordedAt: "2026-09-01T11:00:00.000Z",
    effectiveAt: "2026-09-01T14:00:00.000Z", // Modifying the 14:00 scheduled dose
    amendedAt: "2026-09-01T11:00:00.000Z",
    dose: { value: 5, unit: "mg" },
    status: "active",
    version: 2,
  });

  const history = historyOf([orderV1, orderV2]);

  assert.equal(history.length, 2, "history contains both version entries");

  // v1 was superseded before 14:00 arrived
  const itemV1 = history.find((h) => h.version === 1);
  assert.equal(
    itemV1.supersededBeforeEffective,
    true,
    "v1 was scheduled for 14:00 but replaced at 11:00, so it was superseded before taking effect"
  );
  assert.equal(
    itemV1.wasCurrentBelief,
    false,
    "v1 never took effect in clinical practice"
  );
  assert.equal(
    itemV1.isCurrentBelief,
    false,
    "v1 is not the current belief"
  );

  // v2 was active when 14:00 arrived
  const itemV2 = history.find((h) => h.version === 2);
  assert.equal(
    itemV2.supersededBeforeEffective,
    false,
    "v2 was in effect at its scheduled time"
  );
  assert.equal(
    itemV2.wasCurrentBelief,
    true,
    "v2 became the valid clinical belief at 14:00"
  );
  assert.equal(
    itemV2.isCurrentBelief,
    true,
    "v2 remains the current belief"
  );
});

/* ------------------------------------------------------------------ shallow field-level diff */

test("temporal: diff produces shallow field-level differences and skips internal fields", () => {
  const vA = {
    id: "cond-1",
    patientId: "pat-1",
    clinicalStatus: "active",
    code: "E11.9",
    display: "Type 2 diabetes mellitus",
    version: 1, // store internal field -> must be skipped
    _rev: "rev-1", // internal field -> must be skipped
    meta: { recordedAt: "2026-09-01T10:00:00.000Z" }, // meta -> must be skipped
  };

  const vB = {
    id: "cond-1",
    patientId: "pat-1",
    clinicalStatus: "resolved", // Changed
    code: "E11.9",
    display: "Type 2 diabetes mellitus without complications", // Changed
    resolvedDate: "2026-09-02", // Added
    version: 2, // store internal field -> must be skipped
    _rev: "rev-2", // internal field -> must be skipped
    meta: { recordedAt: "2026-09-02T10:00:00.000Z" }, // meta -> must be skipped
  };

  const delta = diff(vA, vB);

  // Check that meta, version, and _rev are excluded
  const fields = delta.map((d) => d.field);
  assert.ok(!fields.includes("meta"), "diff must skip meta envelope");
  assert.ok(!fields.includes("version"), "diff must skip store internal version counter");
  assert.ok(!fields.includes("_rev"), "diff must skip internal underscored fields");

  // Check that modified and added fields are reported
  assert.deepEqual(
    delta,
    [
      { field: "clinicalStatus", from: "active", to: "resolved" },
      {
        field: "display",
        from: "Type 2 diabetes mellitus",
        to: "Type 2 diabetes mellitus without complications",
      },
      { field: "resolvedDate", from: undefined, to: "2026-09-02" },
    ],
    "diff must report exact field, from, and to entries"
  );
});

/* ------------------------------------------------------------------ reconstructAt point-in-time */

test("temporal: reconstructAt reconstructs state where belief time equals clinical time", () => {
  const v1 = anObservation({
    recordedAt: "2026-09-01T08:00:00.000Z",
    effectiveAt: "2026-09-01T08:00:00.000Z",
    value: 120,
    version: 1,
  });
  const v2 = anObservation({
    recordedAt: "2026-09-01T12:00:00.000Z",
    effectiveAt: "2026-09-01T12:00:00.000Z",
    value: 130,
    version: 2,
  });

  const list = [v1, v2];

  const atNine = reconstructAt(list, "2026-09-01T09:00:00.000Z");
  assert.equal(
    atNine.value,
    120,
    "at 09:00 both belief and physiological state were v1 (120)"
  );

  const atOne = reconstructAt(list, "2026-09-01T13:00:00.000Z");
  assert.equal(
    atOne.value,
    130,
    "at 13:00 both belief and physiological state were v2 (130)"
  );
});

/* ------------------------------------------------------------------ worked medico-legal scenario */

test("temporal: worked medico-legal scenario answers belief at T and truth at T independently", () => {
  /* Medico-Legal Case Study:
   * 14:00 - Blood drawn for serum potassium test in the ICU.
   * 15:00 - Laboratory enters initial report: Potassium = 4.0 mEq/L (Normal).
   *         effectiveAt: 14:00 (draw time), recordedAt: 15:00 (entry time).
   * 16:00 - On-duty physician reviews chart, observes 4.0 mEq/L, and decides not to administer
   *         potassium-binding resin. Standard of care requires acting on validated lab values.
   * 17:00 - Laboratory discovers analyzer calibration drift on the batch; recalculates the true
   *         potassium level as 6.5 mEq/L (Severe Hyperkalemia). An amendment is entered:
   *         effectiveAt: 14:00 (draw time), recordedAt: 17:00, amendedAt: 17:00.
   * 18:00 - Patient develops cardiac arrhythmia.
   *
   * Medico-Legal Audit Questions:
   * Question 1: What did the clinician believe at 16:00 about the patient's potassium at 14:00?
   *             (Defense of standard-of-care adherence)
   * Question 2: What was the actual potassium level at 14:00 according to current medical knowledge?
   *             (Root cause analysis / physiological truth)
   */

  const initialReportV1 = anObservation({
    id: "obs-lab-potassium-1",
    patientId: "pat-icu-99",
    code: "2823-3",
    codeSystem: "LOINC",
    display: "Potassium [Moles/volume] in Serum or Plasma",
    value: 4.0,
    unit: "mEq/L",
    effectiveAt: "2026-09-01T14:00:00.000Z", // Blood sample acquisition time
    recordedAt: "2026-09-01T15:00:00.000Z",  // Laboratory reporting time
    version: 1,
  });

  const amendedReportV2 = anObservation({
    id: "obs-lab-potassium-1",
    patientId: "pat-icu-99",
    code: "2823-3",
    codeSystem: "LOINC",
    display: "Potassium [Moles/volume] in Serum or Plasma",
    value: 6.5, // Critical value
    unit: "mEq/L",
    effectiveAt: "2026-09-01T14:00:00.000Z", // Sample draw time remains unchanged
    recordedAt: "2026-09-01T17:00:00.000Z",  // Calibration correction time
    amendedAt: "2026-09-01T17:00:00.000Z",
    version: 2,
  });

  const chartHistory = [initialReportV1, amendedReportV2];

  // Audit Question 1: Clinician belief at 16:00
  const beliefAtDecisionTime = asOf(chartHistory, {
    knownAt: "2026-09-01T16:00:00.000Z",
    effectiveAt: "2026-09-01T14:00:00.000Z",
  });

  assert.ok(
    beliefAtDecisionTime,
    "system must reconstruct belief state at the 16:00 decision window"
  );
  assert.equal(
    beliefAtDecisionTime.value,
    4.0,
    "standard-of-care audit confirms physician acted reasonably based on the reported 4.0 mEq/L"
  );
  assert.equal(
    beliefAtDecisionTime.version,
    1,
    "v1 was the sole version known to the clinical team at 16:00"
  );

  // Audit Question 2: Physiological truth at 14:00 established after recalibration
  const physiologicalTruth = asOf(chartHistory, {
    knownAt: "2026-09-01T18:00:00.000Z",
    effectiveAt: "2026-09-01T14:00:00.000Z",
  });

  assert.ok(
    physiologicalTruth,
    "system must reconstruct physiological truth established retrospectively"
  );
  assert.equal(
    physiologicalTruth.value,
    6.5,
    "true physiological state at 14:00 was severe hyperkalemia (6.5 mEq/L)"
  );
  assert.equal(
    physiologicalTruth.version,
    2,
    "v2 reflects the post-calibration truth"
  );

  // Both historical belief and retrospective truth are proven distinct and recoverable
  assert.notEqual(
    beliefAtDecisionTime.value,
    physiologicalTruth.value,
    "what was believed at 16:00 and what was true at 14:00 must be distinctly preserved"
  );

  // Verify chart audit engine captures the amendment and its impact
  const auditEntries = corrections(chartHistory);
  assert.equal(auditEntries.length, 1, "chart audit detects exactly one amendment event");
  assert.equal(
    auditEntries[0].correction.value,
    6.5,
    "amendment value was 6.5 mEq/L"
  );
  assert.equal(
    auditEntries[0].superseded.value,
    4.0,
    "superseded value was 4.0 mEq/L"
  );
  assert.deepEqual(
    auditEntries[0].diff,
    [{ field: "value", from: 4.0, to: 6.5 }],
    "audit diff demonstrates exact change from 4.0 to 6.5"
  );
});


/* ------------------------------------------------------------------ store integration
 *
 * The temporal engine and the store were built independently and deliberately do not import each
 * other. That makes the seam between them the place a mismatch would hide: the engine is only
 * useful if it can read what the store actually hands back, so these run over real store output
 * rather than hand-built fixtures.
 */
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";

test("temporal + store: belief and truth are both recoverable from real store output", async () => {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();

  // A potassium of 4.0 for a 09:00 draw, recorded at 10:00.
  const first = Observation({
    id: "obs-k", patientId: "p1", code: "2823-3", value: 4.0, unit: "mmol/L",
    effectiveAt: "2026-09-01T09:00:00.000Z",
  });
  first.meta.recordedAt = "2026-09-01T10:00:00.000Z";
  await store.put(first);

  // The lab corrects it at 14:00: it was actually 6.5 at 09:00 all along.
  const corrected = Observation({
    id: "obs-k", patientId: "p1", code: "2823-3", value: 6.5, unit: "mmol/L",
    effectiveAt: "2026-09-01T09:00:00.000Z",
  });
  corrected.meta.recordedAt = "2026-09-01T14:00:00.000Z";
  corrected.meta.amendedAt = "2026-09-01T14:00:00.000Z";
  await store.put(corrected);

  const versions = await store.history("Observation", "obs-k");
  assert.equal(versions.length, 2, "the store kept both, as an append-only record must");

  const believedAtNoon = asOf(versions, { knownAt: "2026-09-01T12:00:00.000Z", effectiveAt: "2026-09-01T09:00:00.000Z" });
  const knownLater = asOf(versions, { knownAt: "2026-09-02T00:00:00.000Z", effectiveAt: "2026-09-01T09:00:00.000Z" });

  assert.equal(believedAtNoon.value, 4.0,
    "at noon the chart said 4.0 and that is what a clinician would have acted on; the record must be able to prove it");
  assert.equal(knownLater.value, 6.5, "and the corrected truth is recoverable as a separate question");
  assert.equal(corrections(versions).length, 1, "the correction is visible to a chart audit");
});

test("temporal + store: every stored version stays auditable", async () => {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();

  const build = (value, recordedAt) => {
    const obs = Observation({ id: "obs-x", patientId: "p1", code: "718-7", value, effectiveAt: "2026-09-01T09:00:00.000Z" });
    obs.meta.recordedAt = recordedAt;
    return obs;
  };
  await store.put(build(9.1, "2026-09-01T10:00:00.000Z"));
  await store.put(build(9.4, "2026-09-01T11:00:00.000Z"));

  const flagged = historyOf(await store.history("Observation", "obs-x"));
  assert.equal(flagged.length, 2, "nothing is dropped from an audit view");
  assert.equal(flagged.every((v) => "wasCurrentBelief" in v && "isCurrentBelief" in v), true,
    "every version carries whether it was ever believed, which is what a medico-legal review asks");
  assert.equal(flagged.filter((v) => v.isCurrentBelief).length, 1, "exactly one version is live now");
});
