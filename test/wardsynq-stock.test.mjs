/* test/wardsynq-stock.test.mjs — what the pharmacy believes it has, and why that is never a gate.
 *
 * node --test test/wardsynq-stock.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVE_TYPE, KINDS, quantityOf, levelsFrom, flagLevels, mixedUnits, nearExpiry, packFactors, validatePacks, toBaseUnit, dualDisplay } from "../functions/_wardsynq/stock.js";
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
  // supplier-return (R2-4) leaves to a supplier, never to a patient, and only against the receipt it came in on.
  assert.deepEqual([...KINDS], ["receipt", "adjustment", "wastage", "transfer-out", "transfer-in", "consumption", "supplier-return"]);
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

test("TASK 3.4: NEAR EXPIRY is computed per batch, never guessed for stock with no recorded expiry", () => {
  const now = "2026-09-08T00:00:00.000Z";
  const soon = mv({ id: "e1", code: "AMOX250", batch: "B1", expiry: "2026-10-01T00:00:00.000Z" }); // ~23 days
  const far = mv({ id: "e2", code: "AMOX250", batch: "B2", expiry: "2027-06-01T00:00:00.000Z" });
  const gone = mv({ id: "e3", code: "AMOX250", batch: "B3", expiry: "2026-08-01T00:00:00.000Z" }); // already past
  const noExpiry = mv({ id: "e4", code: "AMOX250", batch: "B4", expiry: undefined });

  const out = nearExpiry([soon, far, gone, noExpiry], 90, now);
  const batches = out.map((r) => r.batch).sort();
  assert.deepEqual(batches, ["B1", "B3"], "only the near-expiry and the already-expired batch appear; the far one and the un-dated one do not");
  const expired = out.find((r) => r.batch === "B3");
  assert.equal(expired.expired, true);
  assert.ok(expired.daysRemaining < 0);
  const soonRow = out.find((r) => r.batch === "B1");
  assert.equal(soonRow.expired, false);
  assert.ok(soonRow.daysRemaining > 0 && soonRow.daysRemaining <= 90);

  // Only receipts are expiry candidates - a wastage row naming an expiry is not a stock the pharmacy
  // still holds.
  const wasted = mv({ id: "e5", kind: "wastage", code: "AMOX250", batch: "B5", expiry: "2026-09-15T00:00:00.000Z" });
  assert.equal(nearExpiry([wasted], 90, now).length, 0);

  // Two receipts logged against the SAME batch key: the sooner expiry is the one that matters.
  const dup1 = mv({ id: "e6", code: "PARA500", batch: "B6", expiry: "2026-09-20T00:00:00.000Z" });
  const dup2 = mv({ id: "e7", code: "PARA500", batch: "B6", expiry: "2026-12-20T00:00:00.000Z" });
  const dupOut = nearExpiry([dup1, dup2], 90, now);
  assert.equal(dupOut.length, 1);
  assert.equal(dupOut[0].expiry, "2026-09-20T00:00:00.000Z");
});

/* PACK-SIZE CONVERSION: packFactors / validatePacks / toBaseUnit / dualDisplay. An item with no
 * `packs` is untouched by any of this - covered above, "UNITS ARE NOT CONVERTED". */

test("PURE: packFactors resolves a chain of packs to the base unit, and never guesses a bad one", () => {
  const strip = { unit: "strip", of: 10 };
  const box = { unit: "box", of: 10, packUnit: "strip" };
  const { factors, problems } = packFactors("tablet", [strip, box]);
  assert.equal(problems.length, 0);
  assert.deepEqual([...factors.entries()].map(([k, v]) => [k, v.factor]).sort(), [["BOX", 100], ["STRIP", 10], ["TABLET", 1]]);
});

test("PURE: packFactors names what it refuses, and leaves it out of factors", () => {
  assert.deepEqual(packFactors("tablet", [{ unit: "tablet", of: 10 }]).problems, [{ unit: "tablet", reason: "pack_is_base_unit" }]);
  assert.deepEqual(packFactors("tablet", [{ unit: "strip", of: 10 }, { unit: "strip", of: 5 }]).problems, [{ unit: "strip", reason: "duplicate_pack_unit" }]);
  assert.deepEqual(packFactors("tablet", [{ unit: "strip", of: 0 }]).problems, [{ unit: "strip", reason: "bad_pack_factor" }]);
  assert.deepEqual(packFactors("tablet", [{ unit: "strip", of: -3 }]).problems, [{ unit: "strip", reason: "bad_pack_factor" }]);
  assert.deepEqual(packFactors("tablet", [{ unit: "strip", of: 2.5 }]).problems, [{ unit: "strip", reason: "bad_pack_factor" }]);
  assert.deepEqual(packFactors("tablet", [{ unit: "box", of: 10, packUnit: "strip" }]).problems, [{ unit: "box", reason: "unresolved_pack_unit", packUnit: "strip" }]);
  assert.ok(packFactors("tablet", [{ unit: "box", of: 5, packUnit: "box" }]).problems.some((p) => p.reason === "pack_cycle"));
  // A two-step cycle (box needs carton, carton needs box) is caught too, not just a unit naming itself.
  const cycle = packFactors("tablet", [{ unit: "box", of: 5, packUnit: "carton" }, { unit: "carton", of: 2, packUnit: "box" }]);
  assert.ok(cycle.problems.some((p) => p.reason === "pack_cycle"));
  assert.equal(packFactors("", [{ unit: "strip", of: 10 }]).problems[0].reason, "no_base_unit");
  // A pack with no unit at all is named, never silently dropped.
  assert.deepEqual(packFactors("tablet", [{ of: 10 }]).problems, [{ reason: "pack_needs_unit" }]);
});

test("validatePacks: no packs at all is fine; a bad declaration is refused before anything is received against it", () => {
  assert.deepEqual(validatePacks("tablet", []), { ok: true, problems: [] });
  assert.deepEqual(validatePacks("tablet", null), { ok: true, problems: [] });
  assert.equal(validatePacks("tablet", [{ unit: "strip", of: 10 }]).ok, true);
  const bad = validatePacks("tablet", [{ unit: "strip", of: 10 }, { unit: "box", of: 10, packUnit: "carton" }]);
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => p.reason === "unresolved_pack_unit"));
});

test("PURE: toBaseUnit converts a quantity entered in the base unit or any declared pack, and refuses an unknown one by name", () => {
  const packs = [{ unit: "strip", of: 10 }, { unit: "box", of: 10, packUnit: "strip" }];
  assert.deepEqual(toBaseUnit("tablet", packs, { value: 5, unit: "tablet" }), { ok: true, value: 5, unit: "tablet", factor: 1, enteredAs: { value: 5, unit: "tablet" } });
  assert.deepEqual(toBaseUnit("tablet", packs, { value: 25, unit: "strip" }), { ok: true, value: 250, unit: "tablet", factor: 10, enteredAs: { value: 25, unit: "strip" } });
  assert.deepEqual(toBaseUnit("tablet", packs, { value: 3, unit: "box" }), { ok: true, value: 300, unit: "tablet", factor: 100, enteredAs: { value: 3, unit: "box" } });
  // Case-insensitive: the same declared unit typed differently still resolves.
  assert.equal(toBaseUnit("tablet", packs, { value: 1, unit: "Strip" }).value, 10);

  const unknown = toBaseUnit("tablet", packs, { value: 5, unit: "carton" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "unknown_unit");
  assert.match(unknown.detail, /"carton" is not tablet or a pack size declared for this item/);

  assert.equal(toBaseUnit("tablet", packs, null).ok, false);
  assert.equal(toBaseUnit("tablet", packs, null).reason, "no_quantity");
});

test("PURE: dualDisplay shows the largest pack that divides the quantity exactly, never a fraction of one", () => {
  const packs = [{ unit: "strip", of: 10 }, { unit: "box", of: 10, packUnit: "strip" }];
  assert.equal(dualDisplay("tablet", packs, 250), "25 strip (250 tablet)");
  // 1000 tablets divides evenly by both strip (100) and box (10); the largest pack wins.
  assert.equal(dualDisplay("tablet", packs, 1000), "10 box (1000 tablet)");
  // 15 tablets is not a whole number of strips (10) or boxes (100): no pack shown as though it were whole.
  assert.equal(dualDisplay("tablet", packs, 15), null);
  // Zero is a real, recordable quantity, but never displayed as "0 strip (0 tablet)".
  assert.equal(dualDisplay("tablet", packs, 0), null);
  // No packs declared: nothing to show.
  assert.equal(dualDisplay("tablet", [], 250), null);
  assert.equal(dualDisplay("tablet", null, 250), null);
});
