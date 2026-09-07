/* test/wardsynq-pharmacy-dispense.test.mjs — the pharmacy issued it. Nobody has taken it. Pure half.
 *
 * node --test test/wardsynq-pharmacy-dispense.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, MedicationDispense, dispenseIdFor, quantityOf, expiryState, verificationFor } from "../functions/_wardsynq/pharmacy-dispense.js";

test("THERE IS NO 'GIVEN' STATE, because that is a different record entirely", () => {
  /* A dispense is a SUPPLY fact: medicine left the pharmacy. A system where "dispensed" can drift
   * into "given" puts doses on charts that nobody administered, attributable to nurses who never saw
   * them. */
  assert.deepEqual(STATES, ["issued", "returned"]);
  const d = MedicationDispense({ id: "d", orderId: "o", state: "administered" });
  assert.equal(d.state, "issued", "an unknown state is never accepted as a clinical claim");
  assert.equal(d.resourceType, "MedicationDispense");
  assert.equal(d.administeredAt, undefined);
  assert.equal(d.administeredBy, undefined);
});

test("A QUANTITY IS TWO THINGS OR IT IS NOTHING", () => {
  assert.deepEqual(quantityOf({ value: 28, unit: "tablet" }), { value: 28, unit: "tablet" });
  // "We sent some" is not a supply record, and a quantity nobody stated cannot be reconciled later.
  assert.equal(quantityOf({ value: 28 }), null, "a number with no unit is not a quantity");
  assert.equal(quantityOf({ unit: "tablet" }), null);
  assert.equal(quantityOf({ value: 0, unit: "tablet" }), null, "issuing nothing is not issuing");
  assert.equal(quantityOf({ value: -5, unit: "tablet" }), null);
  assert.equal(quantityOf({ value: "twenty-eight", unit: "tablet" }), null);
  assert.equal(quantityOf(null), null);
});

test("A REPEAT SUPPLY IS A NEW DISPENSE, and a retry is not", () => {
  const a = dispenseIdFor("wsq-rx-1", 2, "2026-09-07T09:00:00.000Z");
  assert.equal(a, dispenseIdFor("WSQ/RX 1", 2, "2026-09-07T09:00:00.000Z"), "a retry at the same instant is the same dispense");
  /* An id keyed only on the order would have silently overwritten the first supply - losing the fact
   * that the ward was supplied twice, which is exactly what a controlled-drug audit looks for. */
  assert.notEqual(a, dispenseIdFor("wsq-rx-1", 2, "2026-09-07T21:00:00.000Z"));
  assert.notEqual(a, dispenseIdFor("wsq-rx-1", 3, "2026-09-07T09:00:00.000Z"), "and a changed order is a different supply");
  // A missing version is null, not version 0: "-v0-" would claim a version of the order that does
  // not exist.
  assert.equal(dispenseIdFor("wsq-rx-1", null, "2026-09-07T09:00:00.000Z"), null);
  assert.equal(dispenseIdFor("wsq-rx-1", 2, ""), null);
  assert.equal(dispenseIdFor("", 2, "t"), null);
});

test("A SUPERSEDED VERIFICATION IS NOT A VERIFICATION", () => {
  const v = (orderVersion, outcome) => ({ orderVersion, outcome: outcome || "verified" });
  /* The pharmacist verified version 2 and the prescriber amended to version 3. Issuing now would put
   * "the pharmacist approved this" against a prescription they never saw. */
  const stale = verificationFor([v(2)], 3);
  assert.equal(stale.state, "superseded");
  assert.equal(stale.verifiedVersion, 2);

  assert.equal(verificationFor([v(3)], 3).state, "current");
  // A query is not an approval, so it does not count as one.
  assert.equal(verificationFor([v(3, "queried")], 3).state, "none");
  /* Not every hospital runs pharmacy verification, so "none" is not a refusal - it is recorded on
   * the dispense as unverified rather than implying a check that never happened. */
  assert.equal(verificationFor([], 1).state, "none");
  assert.equal(verificationFor(null, 1).state, "none");
});

test("what was issued stays what was issued", () => {
  const d = MedicationDispense({
    id: "d", orderId: "o", orderVersion: 2, drug: "Amoxicillin",
    quantity: { value: 21, unit: "capsule" }, destination: "Medical A", verifiedVersion: 2,
  });
  assert.equal(d.orderVersion, 2);
  assert.deepEqual(d.quantity, { value: 21, unit: "capsule" });
  assert.equal(d.unverified, false);
  // A non-numeric version is null rather than a coerced 0.
  assert.equal(MedicationDispense({ id: "d", orderId: "o", orderVersion: "2" }).orderVersion, null);
});

test("AN EXPIRY IS THE END OF ITS DAY, and an absent one is never 'checked and fine'", () => {
  const at = "2026-09-30T10:00:00.000Z";
  /* A box marked 09/2026 is usable on 30 September. Parsing that as midnight would refuse a month of
   * usable stock, and a pharmacy that has to work around a refusal stops reading them. */
  assert.equal(expiryState("2026-09", at).state, "in-date");
  assert.equal(expiryState("2026-09-30", at).state, "in-date");
  assert.equal(expiryState("2026-08", at).state, "expired");
  assert.equal(expiryState("2026-09-29", at).state, "expired");
  assert.match(expiryState("2026-08", at).detail, /expired on 2026-08/);

  /* `unknown` is its OWN answer and never a pass: a hospital that does not capture expiry has not
   * checked it, and reporting that as fine would assert something nobody looked at. */
  assert.equal(expiryState("", at).state, "unknown");
  assert.equal(expiryState(null, at).state, "unknown");
  assert.match(expiryState("", at).detail, /none was checked/);
  assert.equal(expiryState("next Tuesday", at).state, "unreadable");
  assert.match(expiryState("next Tuesday", at).detail, /no expiry was checked/);
});

test("batch and expiry are recorded, and neither is derived", () => {
  const d = MedicationDispense({ id: "d", orderId: "o", batch: "B-4471", expiry: "2027-03" });
  assert.equal(d.batch, "B-4471");
  assert.equal(d.expiry, "2027-03");
  // Which batch went to which patient is the first thing a recall asks. Nothing invents either.
  assert.equal(MedicationDispense({ id: "d", orderId: "o" }).batch, null);
  assert.equal(MedicationDispense({ id: "d", orderId: "o" }).expiry, null);
});
