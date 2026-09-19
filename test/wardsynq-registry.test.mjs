/* test/wardsynq-registry.test.mjs — the cohort, and who in it is overdue. Pure.
 *
 * node --test test/wardsynq-registry.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegistries, inCohort, reviewStatus, memberRank } from "../functions/_wardsynq/registry.js";

/* Shaped as a hospital would define one. The CODES and the interval are this test's content, not
 * clinical guidance: nothing in the module knows that diabetes is reviewed yearly. */
const DEFS = [{
  id: "diabetes", name: "Diabetes register",
  problemCodes: ["E11", "Type 2 diabetes"],
  review: { everyMonths: 12, observationCode: "4548-4", display: "HbA1c" },
}];
const R = resolveRegistries(DEFS).registries[0];
const NOW = Date.parse("2026-09-07T00:00:00.000Z");
const cond = (over) => ({ code: "E11", display: "Type 2 diabetes", clinicalStatus: "active", verificationStatus: "confirmed", ...(over || {}) });
const hba1c = (at) => ({ code: "4548-4", value: 58, meta: { effectiveAt: at } });

test("MEMBERSHIP IS DERIVED FROM THE PROBLEM LIST, and leaving it is resolving the problem", () => {
  assert.equal(inCohort(R, [cond()]), true);
  // Resolve the diagnosis and the patient leaves the cohort. No separate registry flag to forget.
  assert.equal(inCohort(R, [cond({ clinicalStatus: "resolved" })]), false);
  assert.equal(inCohort(R, [cond({ clinicalStatus: "inactive" })]), false);
  /* A REFUTED diagnosis is one somebody considered and ruled out. Putting them on a recall list for a
   * disease they were found not to have is wrong, and alarming to receive a letter about. */
  assert.equal(inCohort(R, [cond({ verificationStatus: "refuted" })]), false);
  // A provisional one still counts: they are being treated as diabetic until somebody says otherwise.
  assert.equal(inCohort(R, [cond({ verificationStatus: "provisional" })]), true);
  assert.equal(inCohort(R, []), false);
});

test("NOTHING IS MATCHED BY GUESSING", () => {
  /* "Diabetes" and "Diabetes insipidus" are unrelated diseases whose names share a word. A registry
   * that guessed would put the wrong patients on a recall list and leave the right ones off it. */
  assert.equal(inCohort(R, [cond({ code: "E23.2", display: "Diabetes insipidus" })]), false);
  assert.equal(inCohort(R, [cond({ code: "E110", display: "something else" })]), false, "E110 is not E11");
  // The hospital's own words match, because the hospital wrote them into the definition.
  assert.equal(inCohort(R, [cond({ code: "text", display: "type 2 DIABETES" })]), true, "case is not identity");
});

test("NEVER REVIEWED IS THE MOST OVERDUE, not the least", () => {
  const never = reviewStatus(R.recall, [], NOW);
  assert.equal(never.state, "never");
  assert.equal(never.overdue, true);
  assert.equal(never.lastReview, null);
  /* Sorting somebody with no result as though they had just been seen is how a patient goes years
   * without a review. They are the person the registry exists to find. */
  const order = [
    { review: reviewStatus(R.recall, [hba1c("2026-08-01T00:00:00.000Z")], NOW) },   // current
    { review: reviewStatus(R.recall, [hba1c("2024-01-01T00:00:00.000Z")], NOW) },   // long overdue
    { review: never },
    { review: reviewStatus(R.recall, [hba1c("2025-08-01T00:00:00.000Z")], NOW) },   // just overdue
  ].sort((a, b) => { const x = memberRank(a), y = memberRank(b); return (x[0] - y[0]) || (x[1] - y[1]); });
  assert.deepEqual(order.map((m) => m.review.state), ["never", "overdue", "overdue", "current"]);
  assert.ok(order[1].review.overdueDays > order[2].review.overdueDays, "and the longest overdue first");
});

test("the most recent qualifying result wins, and only the qualifying one counts", () => {
  const recent = reviewStatus(R.recall, [hba1c("2024-01-01T00:00:00.000Z"), hba1c("2026-08-01T00:00:00.000Z")], NOW);
  assert.equal(recent.state, "current");
  assert.equal(recent.lastReview, "2026-08-01T00:00:00.000Z");
  // A different test is not a review, however recent.
  assert.equal(reviewStatus(R.recall, [{ code: "2160-0", meta: { effectiveAt: "2026-09-06T00:00:00.000Z" } }], NOW).state, "never");
  // A registry with no configured interval says so rather than showing everybody as up to date.
  assert.equal(reviewStatus(null, [], NOW).state, "no-recall");
});

test("an unusable definition is REPORTED, because a silent one looks like a disease nobody has", () => {
  const bad = resolveRegistries([
    ...DEFS,
    { name: "no id", problemCodes: ["X"] },
    { id: "empty", name: "No codes" },
    { id: "half-recall", problemCodes: ["I10"], review: { everyMonths: 6 } },
  ]);
  assert.deepEqual(bad.problems.map((p) => p.reason), ["no_id", "no_problem_codes", "review_needs_interval_and_code"]);
  /* A registry with no codes would match everybody or nobody, and either way it is not the cohort
   * anybody meant - so it is dropped. A half-configured RECALL is different: the cohort is still
   * real and usable, only the "who is overdue" half is not, so it survives with recall: null. */
  assert.deepEqual(bad.registries.map((r) => r.id), ["diabetes", "half-recall"]);
  assert.equal(bad.registries[1].recall, null);
  assert.deepEqual(resolveRegistries(null).registries, []);
});
