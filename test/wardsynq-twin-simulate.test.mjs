/* test/wardsynq-twin-simulate.test.mjs — TASK 10.19: simulation, and its structural inability to write.
 *
 * THE PROOF THIS FILE CANNOT MUTATE ANYTHING is not "we did not call put()" observed after the fact -
 * it is that the module imports no RecordService and no repository at all. This is verified two ways:
 * a static check that the source imports nothing storage-shaped, and a runtime check that running
 * every scenario against a POISONED repository (any write method throws) never throws.
 *
 * node --test test/wardsynq-twin-simulate.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simulateScenario, SCENARIOS, LABEL } from "../functions/_wardsynq/twin-simulate.js";

const RAW = readFileSync(new URL("../functions/_wardsynq/twin-simulate.js", import.meta.url), "utf8");
/* Comments stripped first: the file's own header explains at length why it holds no storage import,
 * and scanning that prose for the word "repository" would fail on the very sentence proving the
 * absence, exactly the trap test/ward-ui.test.mjs's own tripwires already document a fix for. */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/* A twin snapshot shaped like buildTwinSnapshot() would really produce - not a fixture invented for
 * this file, matching the exact nesting digital-twin.js's own sections carry. */
function realTwin(over) {
  return {
    generatedAt: "2026-09-10T08:00:00.000Z", ward: null,
    sections: {
      flow: { status: "ok", data: { flow: { beds: { occupied: 40, states: { available: 10, reserved: 2, occupied: 40, blocked: 1, cleaning: 3, maintenance: 0 } } } } },
      lis: { status: "ok", data: { outstanding: 24, checked: 100 } },
      ...(over || {}),
    },
    notBuilt: { bloodBank: "no blood-product inventory module exists in this codebase" },
  };
}

/* ---- 1: structural proof, not just discipline ------------------------------------------------------ */

test("1. STRUCTURAL: this module imports no RecordService, repository, or write path at all", () => {
  assert.ok(!/RecordService/.test(SRC), "importing RecordService would be a path back to the record store");
  assert.ok(!/\brepository\b/i.test(SRC));
  assert.ok(!/\.put\(|\.append\(/.test(SRC), "no write method is even named in this file");
});

test("2. ADVERSARIAL: every scenario runs cleanly against a repository that throws on ANY write", () => {
  /* Not passed to simulateScenario at all - proving the module cannot reach it even if a future
   * change accidentally threaded one through. If this ever needs to compile, that is itself the
   * regression this test exists to catch. */
  const poisoned = { put: () => { throw new Error("simulation must never write"); }, append: () => { throw new Error("simulation must never write"); } };
  for (const name of Object.keys(SCENARIOS)) {
    assert.doesNotThrow(() => simulateScenario(realTwin(), name, { extraAdmissions: 5, removedBeds: 2, hoursOut: 6, ward: "Ward A" }), name);
  }
  assert.ok(poisoned.put, "sanity: the spy itself is callable, so its absence above is meaningful");
});

/* ---- 3: every output carries the label, on the object itself -------------------------------------- */

test("3. every scenario's result carries the SIMULATION label on the object, not only in a comment", () => {
  for (const name of Object.keys(SCENARIOS)) {
    const r = simulateScenario(realTwin(), name, {});
    assert.equal(r.label, LABEL);
    assert.match(r.label, /NOT LIVE STATE/);
    assert.ok(r.simulatedAt);
  }
});

/* ---- 4: the named scenarios, each a real arithmetic projection over the real twin ------------------ */

test("4. extra-admissions projects occupancy forward and detects a capacity breach", () => {
  const r = simulateScenario(realTwin(), "extra-admissions", { extraAdmissions: 15, dischargesExpected: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.baseline.occupied, 40);
  assert.equal(r.baseline.totalBeds, 56);
  assert.equal(r.projected.occupied, 53);
  assert.equal(r.projected.wouldExceedCapacity, false);
  const breach = simulateScenario(realTwin(), "extra-admissions", { extraAdmissions: 30 });
  assert.equal(breach.projected.wouldExceedCapacity, true);
  assert.ok(breach.projected.deficit > 0);
});

test("5. icu-capacity-reduction shrinks the bed pool, not the occupied count", () => {
  const r = simulateScenario(realTwin(), "icu-capacity-reduction", { removedBeds: 20 });
  assert.equal(r.baseline.occupied, 40);
  assert.equal(r.projected.remainingBeds, 36);
  assert.equal(r.projected.wouldExceedCapacity, true);
  assert.equal(r.projected.overflow, 4);
});

test("6. diagnostic-outage grows the LIS backlog by a stated, honest flat rate", () => {
  const r = simulateScenario(realTwin(), "diagnostic-outage", { modality: "CT", hoursOut: 24 });
  assert.equal(r.baseline.outstanding, 24);
  assert.equal(r.projected.additionalBacklog, 24, "24 outstanding / 24h * 24h out = the full daily rate again");
  assert.match(r.projected.note, /not a queueing model/);
});

test("7. blood-shortage refuses honestly - there is no blood inventory to simulate a shortage of", () => {
  const r = simulateScenario(realTwin(), "blood-shortage", {});
  assert.equal(r.ok, false);
  assert.match(r.detail, /no blood-product inventory module exists/);
});

test("8. ward-closure states its own limit rather than inventing a per-ward number", () => {
  const r = simulateScenario(realTwin(), "ward-closure", { ward: "Ward A" });
  assert.equal(r.ok, true);
  assert.equal(r.projected, null);
  assert.match(r.note, /hospital-wide, not per-ward/);
  const noWard = simulateScenario(realTwin(), "ward-closure", {});
  assert.equal(noWard.ok, false);
  assert.equal(noWard.error, "ward_required");
});

/* ---- 9: refusals ------------------------------------------------------------------------------------ */

test("9. an unknown scenario is refused, listing what IS known", () => {
  const r = simulateScenario(realTwin(), "zombie-outbreak", {});
  assert.equal(r.ok, false);
  assert.equal(r.error, "unknown_scenario");
  assert.match(r.detail, /extra-admissions/);
});

test("10. a missing twin is refused rather than simulating from nothing", () => {
  const r = simulateScenario(null, "extra-admissions", {});
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_twin");
});

test("11. a scenario is refused, honestly, when its section is UNAVAILABLE in the twin", () => {
  const r = simulateScenario(realTwin({ flow: { status: "unavailable", error: "threw" } }), "extra-admissions", {});
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_baseline");
});
