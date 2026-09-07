/* test/wardsynq-ward-order.test.mjs — ordering an investigation from the ward. Pure.
 *
 * node --test test/wardsynq-ward-order.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIORITIES, normalisePriority, priorityRank, wardOrderIdFor } from "../functions/_wardsynq/ward-order.js";

test("AN UNKNOWN PRIORITY BECOMES ROUTINE - never refused, never trusted", () => {
  /* Refusing would stop an order over a typo, at 3am, for a patient who needs the test. Trusting
   * would let "URGENT!!" sort as something the system does not understand. */
  assert.equal(normalisePriority("stat"), "stat");
  assert.equal(normalisePriority("STAT"), "stat", "case is not identity");
  assert.equal(normalisePriority("URGENT!!"), "routine");
  assert.equal(normalisePriority(""), "routine");
  assert.equal(normalisePriority(null), "routine");
  assert.deepEqual(PRIORITIES, ["stat", "urgent", "routine"]);
});

test("NOTHING JUMPS THE QUEUE BY BEING UNRECOGNISED", () => {
  assert.ok(priorityRank("stat") < priorityRank("urgent"));
  assert.ok(priorityRank("urgent") < priorityRank("routine"));
  // A value the system does not know sorts LAST, not first. The opposite would let a typo outrank a
  // genuine stat order.
  assert.equal(priorityRank("emergency!!"), PRIORITIES.length);
  assert.equal(priorityRank(undefined), PRIORITIES.length);
});

test("ONE ORDER PER STAY AND TEST, so asking twice is not two specimens", () => {
  /* A ward round and a post-take round both asking for U&Es is the commonest duplicate in a hospital,
   * and two requests produce two specimens, two bottles and two bills. */
  const id = wardOrderIdFor("wsq-adm-1", "Renal profile");
  assert.equal(id, wardOrderIdFor("WSQ-ADM-1", "renal  profile"));
  assert.notEqual(id, wardOrderIdFor("wsq-adm-1", "Full blood count"));
  // A different stay is a different order: wanting a repeat next admission is a real thing.
  assert.notEqual(id, wardOrderIdFor("wsq-adm-2", "Renal profile"));
  assert.equal(wardOrderIdFor("", "Renal profile"), null);
  assert.equal(wardOrderIdFor("wsq-adm-1", ""), null);
});
