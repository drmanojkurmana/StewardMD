/* test/wardsynq-stock.test.mjs — what the pharmacy believes it has, and why that is never a gate.
 *
 * node --test test/wardsynq-stock.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVE_TYPE, KINDS, quantityOf, levelsFrom, flagLevels, mixedUnits } from "../functions/_wardsynq/stock.js";
import { grantForRole } from "../functions/_wardsynq/actor.js";
import { RESOURCE_TYPES } from "../functions/_wardsynq/service.js";

const mv = (over = {}) => ({ id: "mvt-1", kind: "receipt", code: "MET500", display: "Metformin 500mg", quantity: { value: 100, unit: "tablet" }, location: "Main", at: "2026-09-08T08:00:00.000Z", ...over });
const dsp = (over = {}) => ({ id: "dsp-1", drug: "Metformin 500mg", drugCode: "MET500", quantity: { value: 30, unit: "tablet" }, destination: "Main", ...over });

test("A LEVEL IS SUMMED FROM MOVEMENTS, and issues are never re-entered", () => {
  /* The quantity that left the pharmacy is already a MedicationDispense. A second movement for the
   * same event means the two can disagree, and the one describing an actual patient is the right one. */
  const { levels } = levelsFrom([mv()], [dsp()]);
  assert.equal(levels.length, 1);
  assert.equal(levels[0].level, 70);
  assert.equal(levels[0].received, 100);
  assert.equal(levels[0].issued, 30);
  assert.equal(levels[0].unit, "tablet");
});

test("A NEGATIVE LEVEL IS REPORTED, NEVER CLAMPED TO ZERO", () => {
  /* Clamping is how an inventory hides its own corruption: the number stops being impossible and
   * starts being merely wrong, and nobody investigates a plausible number. A negative level means
   * stock was issued that was never received - a missing delivery or a controlled-drug problem. */
  const { levels } = levelsFrom([], [dsp()]);
  const { negative, levels: flagged } = flagLevels(levels, {});
  assert.equal(flagged[0].level, -30);
  assert.equal(flagged[0].impossible, true);
  assert.match(flagged[0].note, /cannot be true/);
  assert.equal(negative.length, 1);
});

test("A REORDER LEVEL PRODUCES A LIST, and an unset one is not a breach", () => {
  const { levels } = levelsFrom([mv({ quantity: { value: 20, unit: "tablet" } })], []);
  const low = flagLevels(levels, { MET500: { level: 50 } });
  assert.equal(low.belowReorder.length, 1);
  assert.equal(low.levels[0].reorderAt, 50);

  // At the level, not only below it: "we have exactly the minimum" is when to reorder.
  assert.equal(flagLevels(levelsFrom([mv({ quantity: { value: 50, unit: "tablet" } })], []).levels, { MET500: 50 }).belowReorder.length, 1);

  // No entry means no threshold, not a threshold of zero. Number("") is 0 and 0 is finite.
  assert.equal(flagLevels(levels, {}).belowReorder.length, 0);
  assert.equal(flagLevels(levels, { MET500: { level: "" } }).levels[0].reorderAt, null);
  assert.equal(flagLevels(levels, { MET500: { level: "" } }).belowReorder.length, 0);
});

test("UNITS ARE NOT CONVERTED: boxes and tablets are shown side by side, never added", () => {
  /* Guessing that a box is twenty-eight tablets produces a confident number that is wrong by a
   * factor of twenty-eight. That mapping is a product catalogue this build does not have. */
  const { levels } = levelsFrom([mv(), mv({ id: "mvt-2", quantity: { value: 5, unit: "box" } })], []);
  assert.equal(levels.length, 2);
  assert.deepEqual(levels.map((l) => l.level).sort((a, b) => a - b), [5, 100]);
  const mixed = mixedUnits(levels);
  assert.equal(mixed.length, 1);
  assert.deepEqual(mixed[0].units.sort(), ["box", "tablet"]);
});

test("a movement that cannot be counted is REPORTED, not absorbed into silence", () => {
  const { problems } = levelsFrom(
    [mv({ id: "a", quantity: null }), mv({ id: "b", kind: "invented" }), mv({ id: "c", code: "" })],
    [dsp({ id: "d", quantity: null })]);
  assert.deepEqual(problems.map((p) => p.reason).sort(),
    ["dispense_not_countable", "no_code", "no_quantity", "unknown_kind"]);

  /* A dispense with no quantity is a permitted record (pharmacy-dispense.js allows it) and counting
   * it as zero would OVERSTATE stock, which is the direction that matters. */
  assert.ok(problems.some((p) => p.dispenseId === "d"));
});

test("PURE: a quantity is a number and a unit, and 'some' is not a stock record", () => {
  assert.deepEqual(quantityOf({ value: 10, unit: "tablet" }), { value: 10, unit: "tablet" });
  assert.equal(quantityOf({ value: 10 }), null, "a number with no unit is not a quantity");
  assert.equal(quantityOf({ unit: "tablet" }), null);
  // Number("") is 0 and 0 is finite: absence is checked before finiteness.
  assert.equal(quantityOf({ value: "", unit: "tablet" }), null);
  assert.equal(quantityOf({ value: null, unit: "tablet" }), null);
  assert.equal(quantityOf(null), null);
  // A genuine zero IS a quantity: recording that nothing was received is a real correction.
  assert.deepEqual(quantityOf({ value: 0, unit: "tablet" }), { value: 0, unit: "tablet" });
});

test("AN ISSUE IS NOT A MOVEMENT KIND, so nobody can decrement stock without a patient record", () => {
  assert.ok(!KINDS.includes("issue"));
  assert.ok(!KINDS.includes("dispense"));
  assert.deepEqual([...KINDS], ["receipt", "adjustment", "wastage", "transfer-out", "transfer-in"]);
});

test("stock is the dispensing side of pharmacy, and confers nothing clinical", () => {
  const ph = grantForRole("pharmacy");
  assert.ok(ph.write.includes(MOVE_TYPE));
  assert.ok(ph.read.includes("MedicationDispense"), "the level subtracts what was issued");
  // A box arriving on a shelf is not a clinical fact and this grant reaches none.
  assert.ok(!ph.write.includes("MedicationAdministration"));
  assert.ok(!ph.write.includes("MedicationOrder"));
  assert.ok(!ph.write.includes("Observation"));
  assert.ok(RESOURCE_TYPES.includes(MOVE_TYPE));

  // A ward nurse gains no stock authority from being able to give a dose.
  assert.ok(!grantForRole("nurse").write.includes(MOVE_TYPE));
});
