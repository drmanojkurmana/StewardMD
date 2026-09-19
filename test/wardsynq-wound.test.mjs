/* test/wardsynq-wound.test.mjs — the wound over time. Pure.
 *
 * node --test test/wardsynq-wound.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, ORIGINS, stageRank, worseStage, woundIdFor, assessmentIdFor, WoundAssessment, areaCm2, compare } from "../functions/_wardsynq/wound.js";

const a = (over) => WoundAssessment({ id: "x", woundId: "w", patientId: "pat", site: "Sacrum", kind: "pressure", assessedAt: "2026-09-07T09:00:00.000Z", ...(over || {}) });

test("A PRESSURE ULCER IS NEVER REVERSE-STAGED", () => {
  /* A category 4 that improves does not become a category 2. The lost tissue does not come back,
   * granulation is not muscle, and a chart that let the stage fall would report less harm than the
   * hospital caused - the one direction a harm record must never drift. */
  assert.equal(worseStage("4", "2"), "4");
  assert.equal(worseStage("2", "4"), "4");
  assert.equal(worseStage(null, "3"), "3");
  assert.equal(worseStage("3", null), "3");
  assert.equal(worseStage(null, null), null);

  /* `unstageable` and `deep-tissue` OUTRANK 4: both may conceal full-thickness loss, and treating
   * them as lesser is how a serious ulcer is recorded as a minor one. */
  assert.equal(worseStage("4", "unstageable"), "unstageable");
  assert.equal(worseStage("4", "deep-tissue"), "deep-tissue");
  assert.ok(stageRank("unstageable") > stageRank("4"));
  // A word the vocabulary does not contain ranks below everything rather than above it.
  assert.equal(stageRank("nearly better"), 0);
  assert.equal(a({ stage: "nearly better" }).stage, null, "and is never stored as a stage");
  assert.deepEqual(STAGES, ["1", "2", "3", "4", "unstageable", "deep-tissue"]);
});

test("AREA IS COMPUTED AND NEVER CALLED HEALING", () => {
  assert.equal(areaCm2(a({ lengthCm: 4, widthCm: 2.5 })), 10);
  // Never a partial figure: one measurement is not an area.
  assert.equal(areaCm2(a({ lengthCm: 4 })), null);
  assert.equal(areaCm2(a({})), null);
  // A negative measurement is not a measurement.
  assert.equal(a({ lengthCm: -3 }).lengthCm, null);

  const smaller = compare(a({ lengthCm: 3, widthCm: 2 }), a({ lengthCm: 4, widthCm: 2.5, assessedAt: "2026-09-01T09:00:00.000Z" }));
  assert.equal(smaller.state, "smaller");
  assert.equal(smaller.changeCm2, -4);
  /* "Smaller" is not "healing". A cavity can shrink at the surface while it undermines, and a nurse
   * reading "improving" stops looking. */
  assert.match(smaller.note, /not a judgement that the wound is healing/);
  assert.ok(!/improv|healing well/i.test(smaller.state));

  assert.equal(compare(a({}), null).state, "first");
  assert.equal(compare(a({ lengthCm: 3 }), a({ lengthCm: 4, widthCm: 2 })).state, "not-comparable");
});

test("WHERE IT CAME FROM IS A FIXED VOCABULARY, and unknown is one of the answers", () => {
  assert.deepEqual(ORIGINS, ["present-on-admission", "acquired-here", "unknown"]);
  // Defaulting to anything else would move a number the hospital is accountable for.
  assert.equal(a({}).origin, "unknown");
  assert.equal(a({ origin: "somewhere" }).origin, "unknown");
  assert.equal(a({ origin: "acquired-here" }).origin, "acquired-here");
});

test("a wound is its SITE, and each assessment is a moment in its series", () => {
  const w = woundIdFor("pat", "Sacrum");
  assert.equal(w, woundIdFor("PAT", " sacrum "), "case and spacing are not identity");
  // A different site is a different wound - two pressure ulcers on one patient are two problems.
  assert.notEqual(w, woundIdFor("pat", "Left heel"));
  assert.equal(woundIdFor("", "Sacrum"), null);

  const t1 = assessmentIdFor(w, "2026-09-07T09:00:00.000Z");
  assert.equal(t1, assessmentIdFor(w, "2026-09-07T09:00:00.000Z"), "a re-chart at the same instant is the same assessment");
  assert.notEqual(t1, assessmentIdFor(w, "2026-09-08T09:00:00.000Z"));
  assert.equal(assessmentIdFor(w, ""), null);
});
