/* test/wardsynq-ward-order.test.mjs — ordering an investigation from the ward. Pure.
 *
 * node --test test/wardsynq-ward-order.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIORITIES, OPEN_ORDER_STATUSES, CLOSED_ORDER_STATUSES, isOpenOrder, normalisePriority, priorityRank, wardOrderIdFor } from "../functions/_wardsynq/ward-order.js";
import { ORC_STATUS, ORC_ORDER_STATUS } from "../functions/_wardsynq/hl7-normalize.js";

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

/* ---- R5-2: the open/closed vocabulary is a SAFETY BOUNDARY ---------------------------------------- */

test("EVERY STATUS A WRITER CAN PRODUCE IS ACCOUNTED FOR, or an order vanishes off every worklist", () => {
  /* The laboratory, specimen and imaging boards ask the store for the OPEN orders now (listByStatus,
   * filtered in SQL) instead of reading the whole archive. That is only safe while this vocabulary is
   * complete: a status in NEITHER list is an order that silently never reaches anybody's board, which
   * on a specimen worklist is a sample nobody is ever sent to take.
   *
   * The writers, as at 2026-09-18: ward-order.js and migrate-inv-order.js write "active"; the SCCM
   * adapter (every HL7 and FHIR feed lands through it) writes "draft", because an adapter actor holds
   * the draft tier and the governed store refuses it anything else; hl7-normalize maps ORC-1 and ORC-5
   * onto the words below before that. */
  const known = new Set(["active", "draft", ...Object.values(ORC_STATUS), ...Object.values(ORC_ORDER_STATUS)]);
  const accounted = new Set([...OPEN_ORDER_STATUSES, ...CLOSED_ORDER_STATUSES]);
  const orphans = [...known].filter((s) => !accounted.has(s));
  assert.deepEqual(orphans, [], `these statuses are in neither list, so an order carrying one would disappear: ${orphans.join(", ")}`);
  // The two lists are disjoint: a word in both would make "open" and "closed" a coin toss.
  assert.deepEqual(OPEN_ORDER_STATUSES.filter((s) => CLOSED_ORDER_STATUSES.includes(s)), []);
});

test("isOpenOrder reads what the SENDER said first, so another hospital's closed order is closed here", () => {
  assert.equal(isOpenOrder({ status: "active" }), true);
  assert.equal(isOpenOrder({ status: "completed" }), false);
  // An imported order is filed draft whatever the sender said; externalStatus is where the truth is.
  assert.equal(isOpenOrder({ status: "draft", externalStatus: "revoked" }), false);
  assert.equal(isOpenOrder({ status: "draft", externalStatus: "active" }), true);
  // A word nobody knows stays OPEN: it has to reach a human, not be disappeared by a read.
  assert.equal(isOpenOrder({ status: "wobble" }), true);
  assert.equal(isOpenOrder(null), true);
});
