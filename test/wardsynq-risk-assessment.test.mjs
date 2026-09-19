/* test/wardsynq-risk-assessment.test.mjs — the scored nursing assessments. Pure half.
 *
 * node --test test/wardsynq-risk-assessment.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTool, score, reassessmentStatus, assessmentIdFor } from "../functions/_wardsynq/risk-assessment.js";

/* A tool shaped as a hospital would supply one. The thresholds and actions are THIS TEST'S content,
 * not clinical guidance: WardSynQ ships the structure and the hospital supplies the tool it has
 * approved, exactly as it does for order sets and critical limits. */
const FALLS = {
  id: "falls", name: "Falls risk", version: "1", reassessEveryHours: 24,
  items: [
    { key: "history", title: "Fall in the last 12 months", options: [{ value: "no", score: 0 }, { value: "yes", score: 2 }] },
    { key: "mobility", title: "Mobility", options: [{ value: "independent", score: 0 }, { value: "assisted", score: 1 }, { value: "unsafe", score: 3 }] },
  ],
  bands: [
    { band: "low", min: 0, max: 1, actions: [] },
    { band: "moderate", min: 2, max: 3, actions: ["Falls information leaflet", "Call bell within reach"] },
    { band: "high", min: 4, max: 5, actions: ["Hourly rounding", "Bed in lowest position", "Medical review of sedatives"] },
  ],
};

test("EVERY ITEM MUST BE ANSWERED: a partial score reads lower than the truth", () => {
  const t = resolveTool(FALLS);
  assert.equal(t.ok, true);
  /* A score over half the questions is a smaller number than the truth, and it errs towards saying
   * the patient is safe - the one direction a risk tool must never drift. So it is refused rather
   * than scored with the gap treated as zero. */
  const partial = score(t, { history: "yes" });
  assert.equal(partial.ok, false);
  assert.equal(partial.error, "incomplete");
  assert.deepEqual(partial.missing, ["mobility"]);
  // An answer the tool does not offer is refused too, not scored as zero.
  const bogus = score(t, { history: "yes", mobility: "flying" });
  assert.equal(bogus.ok, false);
  assert.deepEqual(bogus.invalid, [{ key: "mobility", value: "flying" }]);
});

test("THE SCORE SELECTS THE ACTIONS, which are the point", () => {
  const t = resolveTool(FALLS);
  const low = score(t, { history: "no", mobility: "independent" });
  assert.deepEqual([low.total, low.band, low.actions], [0, "low", []]);

  const high = score(t, { history: "yes", mobility: "unsafe" });
  assert.equal(high.total, 5);
  assert.equal(high.band, "high");
  // A risk score that produces a number and no consequence is paperwork, and wards learn very fast
  // which paperwork changes nothing.
  assert.deepEqual(high.actions, ["Hourly rounding", "Bed in lowest position", "Medical review of sedatives"]);
  assert.equal(high.chosen.mobility.score, 3, "and the answers that produced it are kept");
});

test("a score outside every band is REPORTED, not assigned to the nearest one", () => {
  // The bands are the hospital's clinical content; guessing past them would be inventing it.
  const gappy = resolveTool({ ...FALLS, bands: [{ band: "low", min: 0, max: 1, actions: ["x"] }] });
  const out = score(gappy, { history: "yes", mobility: "unsafe" });
  assert.equal(out.ok, true);
  assert.equal(out.band, null);
  assert.equal(out.unbanded, true);
  assert.deepEqual(out.actions, [], "and no action is guessed at either");
  assert.match(out.detail, /outside every band/);
});

test("a tool with no bands is refused: a number with no consequence is paperwork", () => {
  assert.equal(resolveTool({ ...FALLS, bands: [] }).error, "no_bands");
  assert.equal(resolveTool({ id: "t", name: "T", items: [] }).error, "tool_empty");
  assert.equal(resolveTool({ name: "no id" }).error, "tool_incomplete");
  // An item whose options carry no usable score is dropped and REPORTED - one that silently
  // contributed zero is how a tool reports a lower risk than the paper version.
  const bad = resolveTool({ ...FALLS, items: [...FALLS.items, { key: "x", title: "X", options: [{ value: "a" }] }] });
  assert.deepEqual(bad.problems.map((p) => p.reason), ["bad_options"]);
  assert.equal(bad.items.length, 2, "the sound items still stand");
});

test("REASSESSMENT IS COMPUTED, so it cannot go stale", () => {
  const t = resolveTool(FALLS);
  const at = "2026-09-07T09:00:00.000Z";
  const a = { assessedAt: at, reassessEvery: t.reassessEvery };
  assert.equal(reassessmentStatus(a, t, Date.parse("2026-09-07T20:00:00.000Z")).state, "current");
  /* A pressure assessment done on admission and never repeated is exactly how a heel ulcer develops
   * on a ward that "assesses risk". */
  const late = reassessmentStatus(a, t, Date.parse("2026-09-09T09:00:00.000Z"));
  assert.equal(late.state, "overdue");
  assert.equal(late.overdueHours, 24);
  // A tool with no interval says so rather than being silently current forever.
  assert.equal(reassessmentStatus({ assessedAt: at }, { reassessEvery: null }, Date.now()).state, "no-interval");
  assert.equal(reassessmentStatus(null).state, "none");
});

test("a reassessment is a NEW assessment, never an overwrite", () => {
  const a = assessmentIdFor("enc", "falls", "2026-09-07T09:00:00.000Z");
  assert.notEqual(a, assessmentIdFor("enc", "falls", "2026-09-08T09:00:00.000Z"), "yesterday's score survives");
  assert.notEqual(a, assessmentIdFor("enc", "pressure", "2026-09-07T09:00:00.000Z"));
  assert.equal(a, assessmentIdFor("ENC", "Falls", "2026-09-07T09:00:00.000Z"));
  assert.equal(assessmentIdFor("", "falls", "t"), null);
});
