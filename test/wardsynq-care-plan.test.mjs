/* test/wardsynq-care-plan.test.mjs — what the ward is trying to achieve. Pure half.
 *
 * node --test test/wardsynq-care-plan.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GOAL_STATES, PLAN_STATES, planIdFor, goalKey, goalsFrom, reviewStatus, planSummary } from "../functions/_wardsynq/care-plan.js";

test("A GOAL WITHOUT A MEASURE IS A WISH, and is refused", () => {
  const { goals, rejected } = goalsFrom([
    { title: "Walk to the bathroom", measure: "With one assistant, by Friday" },
    { title: "Improve mobility" },
    { title: "Improve mobility", measure: "   " },
    { title: "", measure: "x" },
    { title: "walk to the BATHROOM", measure: "duplicate" },
  ]);
  /* "Improve mobility" is not a goal. "Walk to the bathroom with one assistant by Friday" is,
   * because a nurse three shifts later can tell whether it happened. A plan of unmeasurable goals
   * can never be wrong, which is the same as one that never helped. */
  assert.equal(goals.length, 1);
  assert.equal(goals[0].measure, "With one assistant, by Friday");
  assert.deepEqual(rejected.map((r) => r.reason), ["no_measure", "no_measure", "no_title", "duplicate"]);
  assert.equal(goals[0].state, "active", "a new goal starts active, not met");
  assert.equal(goals[0].decidedBy, null);
});

test("PROGRESS IS RECORDED, NEVER COMPUTED - and a goal can go either way", () => {
  // `not-met` is a real outcome, not a failure to record one. Patients deteriorate, and a plan that
  // could only improve would be a plan nobody trusted.
  assert.deepEqual(GOAL_STATES, ["active", "met", "not-met", "cancelled"]);
  assert.ok(GOAL_STATES.includes("not-met"));
  assert.deepEqual(PLAN_STATES, ["active", "completed", "cancelled"]);
  // Nothing in the shape infers progress: a goal carries who decided and when, or nulls.
  const { goals } = goalsFrom([{ title: "Wound healing", measure: "Granulating, no slough, by day 5" }]);
  assert.equal(goals[0].decidedAt, null);
  assert.equal(goals[0].outcomeNote, null);
});

test("A PLAN NOBODY HAS REVIEWED IS SAID TO BE STALE, not left looking current", () => {
  const plan = { id: "p", state: "active", reviewBy: "2026-09-10T00:00:00.000Z", goals: [] };
  assert.deepEqual(reviewStatus(plan, Date.parse("2026-09-09T00:00:00.000Z")), { state: "current", overdueDays: 0 });
  /* A care plan written on admission and never touched again is the characteristic failure of care
   * planning, and a system that cannot see it is participating in it. Computed, never stored: a
   * stored "current" is a lie the moment the date passes. */
  assert.deepEqual(reviewStatus(plan, Date.parse("2026-09-13T00:00:00.000Z")), { state: "stale", overdueDays: 3 });
  // A plan with no review date is not silently "current" either - it says it has no date.
  assert.equal(reviewStatus({ ...plan, reviewBy: null }, Date.now()).state, "no-review-date");
  // A closed plan is not chased.
  assert.equal(reviewStatus({ ...plan, state: "completed" }, Date.parse("2030-01-01T00:00:00.000Z")).state, "closed");
  assert.equal(reviewStatus(null).state, "closed");
});

test("the summary counts goals by state and surfaces the review", () => {
  const { goals } = goalsFrom([
    { title: "A", measure: "m" }, { title: "B", measure: "m" }, { title: "C", measure: "m" },
  ]);
  const plan = {
    id: "wsq-plan-e1", patientId: "pat", encounterId: "e1", state: "active", title: "Recovery",
    reviewBy: "2026-09-10T00:00:00.000Z",
    goals: [goals[0], { ...goals[1], state: "met" }, { ...goals[2], state: "not-met", outcomeNote: "Patient declined." }],
  };
  const s = planSummary(plan, Date.parse("2026-09-13T00:00:00.000Z"));
  assert.equal(s.counts.active, 1);
  assert.equal(s.counts.met, 1);
  assert.equal(s.counts["not-met"], 1);
  assert.equal(s.activeGoals, 1);
  assert.equal(s.review.state, "stale");
  assert.equal(s.review.overdueDays, 3);
});

test("one plan per admission; goals are what change", () => {
  assert.equal(planIdFor("wsq-adm-1"), "wsq-plan-wsq-adm-1");
  assert.equal(planIdFor("WSQ/ADM 1"), planIdFor("wsq-adm-1"));
  assert.equal(planIdFor(""), null);
  assert.equal(goalKey("Walk to the bathroom"), goalKey("  WALK to the  bathroom "));
  assert.notEqual(goalKey("Walk to the bathroom"), goalKey("Walk to the door"));
});
