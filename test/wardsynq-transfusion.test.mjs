/* test/wardsynq-transfusion.test.mjs — HAZ-BLD-01, ABO-incompatible transfusion.
 *
 * Adversarial. Nearly every test is an attempt to get incompatible blood, or the right blood for the
 * wrong patient, past the control. The serology is the easy part; the tests that matter are the ones
 * about identity and the bedside, because that is where people actually die.
 *
 * The exhaustive compatibility matrix is asserted explicitly rather than generated from the same
 * table the implementation uses, because a test that derives its expectations from the code under
 * test proves only that the code equals itself.
 *
 * node --test test/wardsynq-transfusion.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PHASE, COMPONENT, TransfusionSafetyError, TransfusionEpisode, checkCompatibility, traceUnit,
} from "../wardsynq/wardsynq-transfusion.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { Patient } from "../wardsynq/wardsynq-model.js";

function clock(startIso) {
  let t = Date.parse(startIso);
  return { now: () => new Date(t).toISOString(), advance: (min) => { t += min * 60000; } };
}

const patientOf = (over) => {
  const p = Patient({ mrn: "GH-1", name: "Test Patient", dob: "1970-01-01", wristbandBarcode: "GH-1", ...over });
  p.aboGroup = over && "aboGroup" in over ? over.aboGroup : "A";
  p.rhD = over && "rhD" in over ? over.rhD : "positive";
  return p;
};

const unitOf = (over) => ({
  unitId: "U-1001", aboGroup: "A", rhD: "positive", component: COMPONENT.RED_CELLS,
  expiresAt: "2026-10-01T00:00:00.000Z", ...over,
});

function ep(over) {
  const c = (over && over.clock) || clock("2026-09-04T09:00:00.000Z");
  return { engine: new TransfusionEpisode({ now: c.now, ...(over || {}) }), clock: c };
}

/** Drives a correct episode to the point just before starting. */
async function upToBedside(engine, patient, unit) {
  const e = await engine.request(patient, { component: unit.component, units: 1, indication: "symptomatic anaemia" }, "dr-1");
  await engine.crossmatch(e, unit, "bms-1");
  await engine.issue(e, "bms-1");
  return e;
}

/* ------------------------------------------------------------------ the matrix */

test("compatibility: the full red cell matrix is exactly right", () => {
  // Recipient -> every donor group that may be given. Written out by hand on purpose.
  const expected = {
    O: { O: true, A: false, B: false, AB: false },
    A: { O: true, A: true, B: false, AB: false },
    B: { O: true, A: false, B: true, AB: false },
    AB: { O: true, A: true, B: true, AB: true },
  };
  for (const recipient of ["O", "A", "B", "AB"]) {
    for (const donor of ["O", "A", "B", "AB"]) {
      const v = checkCompatibility(
        { aboGroup: recipient, rhD: "positive" },
        unitOf({ aboGroup: donor, rhD: "positive" }),
      );
      assert.equal(v.compatible, expected[recipient][donor],
        `red cells: group ${donor} into group ${recipient} should be ${expected[recipient][donor] ? "allowed" : "REFUSED"}`);
    }
  }
});

test("compatibility: plasma is the INVERSE of red cells, and the module does not confuse them", () => {
  const expected = {
    O: { O: true, A: true, B: true, AB: true },
    A: { O: false, A: true, B: false, AB: true },
    B: { O: false, A: false, B: true, AB: true },
    AB: { O: false, A: false, B: false, AB: true },
  };
  for (const recipient of ["O", "A", "B", "AB"]) {
    for (const donor of ["O", "A", "B", "AB"]) {
      const v = checkCompatibility(
        { aboGroup: recipient, rhD: "positive" },
        unitOf({ aboGroup: donor, component: COMPONENT.PLASMA }),
      );
      assert.equal(v.compatible, expected[recipient][donor],
        `plasma: group ${donor} into group ${recipient} should be ${expected[recipient][donor] ? "allowed" : "REFUSED"}`);
    }
  }
  // The specific inversion that would be lethal if the tables were swapped.
  assert.equal(checkCompatibility({ aboGroup: "O", rhD: "positive" }, unitOf({ aboGroup: "AB" })).compatible, false,
    "group AB red cells into a group O patient is the classic fatal error");
  assert.equal(checkCompatibility({ aboGroup: "O", rhD: "positive" }, unitOf({ aboGroup: "AB", component: COMPONENT.PLASMA })).compatible, true,
    "AB plasma into a group O patient is correct, and a single shared table would get one of these wrong");
});

test("compatibility: an undetermined group on either side is never compatible", () => {
  assert.equal(checkCompatibility({ aboGroup: null, rhD: "positive" }, unitOf()).compatible, false);
  assert.equal(checkCompatibility({ aboGroup: "A", rhD: "positive" }, unitOf({ aboGroup: undefined })).compatible, false);
  const v = checkCompatibility({ aboGroup: "", rhD: "positive" }, unitOf());
  assert.equal(v.reasons.some((r) => r.code === "PATIENT_GROUP_UNKNOWN"), true,
    "an ungrouped patient has no compatible unit outside an emergency protocol this module does not implement");
});

test("compatibility: D-positive cells into a D-negative patient are refused by default", () => {
  const v = checkCompatibility({ aboGroup: "O", rhD: "negative" }, unitOf({ aboGroup: "O", rhD: "positive" }));
  assert.equal(v.compatible, false);
  assert.equal(v.reasons.some((r) => r.code === "RHD_MISMATCH"), true);
  const allowed = checkCompatibility({ aboGroup: "O", rhD: "negative" }, unitOf({ aboGroup: "O", rhD: "positive" }), { allowRhDPositiveToNegative: true });
  assert.equal(allowed.compatible, true, "and only an explicit policy decision changes that");
});

test("compatibility: an unmodelled component is refused rather than guessed", () => {
  const v = checkCompatibility({ aboGroup: "A", rhD: "positive" }, unitOf({ component: COMPONENT.PLATELETS }));
  assert.equal(v.compatible, false);
  assert.equal(v.reasons.some((r) => r.code === "COMPONENT_NOT_SUPPORTED"), true,
    "platelet compatibility has its own rules; guessing a direction would be worse than refusing");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the lab */

test("ADVERSARIAL: an incompatible unit cannot be crossmatched, whatever the caller wants", async () => {
  const { engine } = ep();
  const p = patientOf({ aboGroup: "O" });
  const e = await engine.request(p, { component: COMPONENT.RED_CELLS }, "dr-1");
  await assert.rejects(() => engine.crossmatch(e, unitOf({ aboGroup: "AB" }), "bms-1"), (err) => {
    assert.equal(err.code, "INCOMPATIBLE");
    return true;
  });
  assert.equal(e.phase, PHASE.REQUESTED, "the episode does not advance on a failed crossmatch");
  assert.ok(e.ledger.some((l) => l.event === "crossmatch-failed"), "and the attempt is on the record");
});

test("ADVERSARIAL: a unit cannot be issued without a crossmatch", async () => {
  const { engine } = ep();
  const e = await engine.request(patientOf(), { component: COMPONENT.RED_CELLS }, "dr-1");
  await assert.rejects(() => engine.issue(e, "bms-1"), (err) => { assert.equal(err.code, "NOT_CROSSMATCHED"); return true; });
});

/* ------------------------------------------------------------------ ADVERSARIAL: the bedside */

test("ADVERSARIAL: a single person cannot complete the bedside check", async () => {
  const { engine } = ep();
  const p = patientOf();
  const u = unitOf();
  const e = await upToBedside(engine, p, u);
  await assert.rejects(() => engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: null,
    scannedPatientBarcode: "GH-1", scannedUnitId: "U-1001", patient: p, unitInHand: u,
  }), (err) => { assert.equal(err.code, "TWO_PERSON_REQUIRED"); return true; });
});

test("ADVERSARIAL: one person cannot be both checkers", async () => {
  const { engine } = ep();
  const p = patientOf();
  const u = unitOf();
  const e = await upToBedside(engine, p, u);
  await assert.rejects(() => engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: "nurse-1",
    scannedPatientBarcode: "GH-1", scannedUnitId: "U-1001", patient: p, unitInHand: u,
  }), (err) => { assert.equal(err.code, "SECOND_CHECKER_NOT_INDEPENDENT"); return true; });
});

test("ADVERSARIAL: the right unit at the WRONG patient's bedside is refused", async () => {
  const { engine } = ep();
  const intended = patientOf({ mrn: "GH-1", wristbandBarcode: "GH-1" });
  const otherPatient = patientOf({ mrn: "GH-2", wristbandBarcode: "GH-2" });
  const u = unitOf();
  const e = await upToBedside(engine, intended, u);

  await assert.rejects(() => engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: "nurse-2",
    scannedPatientBarcode: "GH-2", scannedUnitId: "U-1001", patient: otherPatient, unitInHand: u,
  }), (err) => {
    assert.equal(err.code, "PATIENT_IDENTITY");
    return true;
  }, "this is the way people actually die: a perfectly good unit given to the patient in the next bed");
  assert.equal(e.phase, PHASE.ISSUED);
});

test("ADVERSARIAL: a unit crossmatched for someone else cannot be given here", async () => {
  const { engine } = ep();
  const p = patientOf();
  const e = await upToBedside(engine, p, unitOf({ unitId: "U-1001" }));
  await assert.rejects(() => engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: "nurse-2",
    scannedPatientBarcode: "GH-1", scannedUnitId: "U-9999",
    patient: p, unitInHand: unitOf({ unitId: "U-9999" }),
  }), (err) => { assert.equal(err.code, "WRONG_UNIT"); return true; });
});

test("ADVERSARIAL: a mislabelled unit is caught by re-reading the bag, not by trusting the paperwork", async () => {
  const { engine } = ep();
  const p = patientOf({ aboGroup: "O", rhD: "positive" });
  // The lab crossmatched a group O unit correctly.
  const e = await upToBedside(engine, p, unitOf({ unitId: "U-1001", aboGroup: "O" }));
  // The bag physically at the bedside carries the same barcode but is group AB.
  await assert.rejects(() => engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: "nurse-2",
    scannedPatientBarcode: "GH-1", scannedUnitId: "U-1001",
    patient: p, unitInHand: unitOf({ unitId: "U-1001", aboGroup: "AB" }),
  }), (err) => {
    assert.equal(err.code, "ABO_INCOMPATIBLE");
    return true;
  }, "compatibility is re-derived from the physical unit; if the bag and the paperwork disagree, the paperwork is what must not be believed");
});

test("ADVERSARIAL: a unit whose label was never read cannot pass the check", async () => {
  const { engine } = ep();
  const p = patientOf();
  const e = await upToBedside(engine, p, unitOf());
  await assert.rejects(() => engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: "nurse-2",
    scannedPatientBarcode: "GH-1", scannedUnitId: "U-1001", patient: p, unitInHand: null,
  }), (err) => { assert.equal(err.code, "UNIT_NOT_READ"); return true; });
});

test("ADVERSARIAL: an expired unit is refused at the bedside", async () => {
  const c = clock("2026-09-04T09:00:00.000Z");
  const { engine } = ep({ clock: c });
  const p = patientOf();
  const u = unitOf({ expiresAt: "2026-09-04T08:00:00.000Z" }); // expired an hour ago
  const e = await upToBedside(engine, p, u);
  await assert.rejects(() => engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: "nurse-2",
    scannedPatientBarcode: "GH-1", scannedUnitId: "U-1001", patient: p, unitInHand: u,
  }), (err) => { assert.equal(err.code, "UNIT_EXPIRED"); return true; });
});

test("ADVERSARIAL: a transfusion cannot start without a passed bedside check", async () => {
  const { engine } = ep();
  const e = await upToBedside(engine, patientOf(), unitOf());
  await assert.rejects(() => engine.start(e, "nurse-1"), (err) => { assert.equal(err.code, "NOT_CHECKED"); return true; });
});

/* ------------------------------------------------------------------ the happy path and reactions */

test("episode: a correct transfusion runs the whole chain and records every step", async () => {
  const c = clock("2026-09-04T09:00:00.000Z");
  const bus = new ClinicalEventBus();
  const types = [];
  for (const t of ["transfusion.requested", "transfusion.crossmatched", "transfusion.issued", "transfusion.checked", "transfusion.started", "transfusion.completed"]) {
    bus.on(t, (x) => types.push(x.type));
  }
  const { engine } = ep({ clock: c, bus });
  const p = patientOf();
  const u = unitOf();
  const e = await upToBedside(engine, p, u);
  await engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: "nurse-2",
    scannedPatientBarcode: "GH-1", scannedUnitId: "U-1001", patient: p, unitInHand: u,
  });
  await engine.start(e, "nurse-1");
  c.advance(15);
  await engine.observe(e, "nurse-1", { temperature: 37.1, pulse: 88, bp: "118/72" });
  c.advance(120);
  await engine.complete(e, "nurse-1");

  assert.equal(e.phase, PHASE.COMPLETED);
  assert.deepEqual(types, ["transfusion.requested", "transfusion.crossmatched", "transfusion.issued", "transfusion.checked", "transfusion.started", "transfusion.completed"]);
  assert.equal(e.bedsideCheck.secondCheckerId, "nurse-2");
  assert.equal(e.observations.length, 1);
  for (const expected of ["requested", "crossmatched", "issued", "bedside-check-passed", "started", "observed", "completed"]) {
    assert.ok(e.ledger.some((l) => l.event === expected), `the ledger records ${expected}`);
  }
  assert.ok(e.ledger.every((l) => l.at), "every entry is timestamped");
});

test("reaction: a suspected reaction stops the transfusion terminally", async () => {
  const c = clock("2026-09-04T09:00:00.000Z");
  const { engine } = ep({ clock: c });
  const p = patientOf();
  const u = unitOf();
  const e = await upToBedside(engine, p, u);
  await engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: "nurse-2",
    scannedPatientBarcode: "GH-1", scannedUnitId: "U-1001", patient: p, unitInHand: u,
  });
  await engine.start(e, "nurse-1");
  c.advance(10);
  await engine.reaction(e, "nurse-1", "rigors and a temperature rise of 1.8 C");

  assert.equal(e.phase, PHASE.STOPPED);
  assert.equal(e.reaction.unitId, "U-1001");
  await assert.rejects(() => engine.complete(e, "nurse-1"), (err) => { assert.equal(err.code, "STOPPED"); return true; });
  await assert.rejects(() => engine.start(e, "nurse-1"), (err) => {
    assert.equal(err.code, "STOPPED");
    return true;
  }, "restarting the same unit after a reaction must require a new, separately checked episode");
});

test("ADVERSARIAL: observations and reactions cannot be recorded against a transfusion that is not running", async () => {
  const { engine } = ep();
  const e = await upToBedside(engine, patientOf(), unitOf());
  await assert.rejects(() => engine.observe(e, "nurse-1", { temperature: 37 }), (err) => { assert.equal(err.code, "NOT_RUNNING"); return true; });
  await assert.rejects(() => engine.reaction(e, "nurse-1", "x"), (err) => { assert.equal(err.code, "NOT_RUNNING"); return true; });
});

test("ADVERSARIAL: every clinical act must name who performed it", async () => {
  const { engine } = ep();
  await assert.rejects(() => engine.request(patientOf(), { component: COMPONENT.RED_CELLS }, null),
    (err) => { assert.equal(err.code, "NO_ACTOR"); return true; });
  const e = await upToBedside(engine, patientOf(), unitOf());
  await assert.rejects(() => engine.start(e, null), (err) => { assert.ok(["NO_ACTOR", "NOT_CHECKED"].includes(err.code)); return true; });
});

/* ------------------------------------------------------------------ traceability */

test("traceability: a unit can be traced to every patient it ever touched", async () => {
  const { engine } = ep();
  const p1 = patientOf({ mrn: "GH-1", wristbandBarcode: "GH-1" });
  const e1 = await upToBedside(engine, p1, unitOf({ unitId: "U-77" }));
  const trace = traceUnit([e1], "U-77");
  assert.equal(trace.length, 1);
  assert.equal(trace[0].patientMrn, "GH-1");
  assert.ok(trace[0].ledger.length >= 3, "the trace carries the unit's whole ledger, not just its current state");
  assert.deepEqual(traceUnit([e1], "U-OTHER"), []);
});

test("integration: every phase is persisted to the append-only store", async () => {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();
  const { engine } = ep({ store });
  const p = patientOf();
  const u = unitOf();
  const e = await upToBedside(engine, p, u);
  await engine.bedsideCheck(e, {
    checkerId: "nurse-1", secondCheckerId: "nurse-2",
    scannedPatientBarcode: "GH-1", scannedUnitId: "U-1001", patient: p, unitInHand: u,
  });
  const history = await store.history("TransfusionEpisode", e.id);
  assert.ok(history.length >= 4, `each phase is its own version, got ${history.length}`);
  assert.equal(history[0].phase, PHASE.REQUESTED, "the original request survives on the record");
  assert.equal(history.at(-1).phase, PHASE.CHECKED);
});

test("ADVERSARIAL: a failed crossmatch is still persisted, so refusals are auditable", async () => {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();
  const { engine } = ep({ store });
  const p = patientOf({ aboGroup: "O" });
  const e = await engine.request(p, { component: COMPONENT.RED_CELLS }, "dr-1");
  await assert.rejects(() => engine.crossmatch(e, unitOf({ aboGroup: "AB" }), "bms-1"));
  const history = await store.history("TransfusionEpisode", e.id);
  assert.ok(history.some((v) => v.ledger.some((l) => l.event === "crossmatch-failed")),
    "a near miss is evidence and must not vanish because the operation threw");
});
