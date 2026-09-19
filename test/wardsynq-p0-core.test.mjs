/* test/wardsynq-p0-core.test.mjs — WardSynQ P0 core: canonical model, Clinical Event Bus, eMAR.
 *
 * These three modules are the floor the rest of WardSynQ stands on, so the tests here are about
 * invariants rather than coverage theatre: required fields actually reject, a redelivered event is
 * not reprocessed, and a dose cannot reach ADMINISTERED without passing every gate in front of it.
 *
 * node --test test/wardsynq-p0-core.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Patient, Encounter, Condition, AllergyIntolerance, Observation,
  MedicationOrder, MedicationAdministration, ServiceRequest, DiagnosticReport,
  CarePlan, ClinicalNote, makeMeta,
} from "../wardsynq/wardsynq-model.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import {
  STATES, FIVE_RIGHTS, MedicationSafetyError, MedicationAdministrationRecord,
  checkFiveRights, denyWithoutSafetyEngine,
} from "../wardsynq/wardsynq-meds.js";

/* ------------------------------------------------------------------ fixtures */

function aPatient(over) {
  return Patient({ mrn: "MRN-0001", name: "Test Patient", dob: "1980-04-12", wristbandBarcode: "WB-0001", ...over });
}

function anOrder(patient, over) {
  return MedicationOrder({
    patientId: patient.id,
    drug: "Paracetamol 500mg tablet",
    drugBarcode: "DB-PARA-500",
    dose: { value: 500, unit: "mg" },
    route: "oral",
    prescriberId: "dr-1",
    ...over,
  });
}

function aGoodScan(over) {
  return { patientBarcode: "WB-0001", drugBarcode: "DB-PARA-500", dose: { value: 500, unit: "mg" }, route: "oral", ...over };
}

const allowAll = () => ({ allowed: true, blocks: [], warnings: [] });

/* ------------------------------------------------------------------ model */

test("model: entities build with provenance and bi-temporal fields", () => {
  const p = aPatient();
  assert.equal(p.resourceType, "Patient");
  assert.ok(p.id, "an id is assigned when none is supplied");
  assert.equal(p.meta.source.system, "wardsynq-native", "native records are not attributed to an adapter");
  assert.ok(p.meta.recordedAt, "T_recorded is always stamped");
  assert.equal(p.meta.effectiveAt, p.meta.recordedAt, "effectiveAt defaults to recordedAt");
  assert.equal(p.meta.amendedAt, null, "a first write is never an amendment");
  assert.deepEqual(p.meta.derivedFrom, []);
});

test("model: adapter provenance and lineage survive construction", () => {
  const obs = Observation({
    patientId: "pat-1", code: "718-7", codeSystem: "LOINC", value: 9.1, unit: "g/dL",
    source: { system: "ghis", sourceId: "ghis-lab-4471" },
    derivedFrom: ["obs-49102", "dev-telemetry-881"],
    effectiveAt: "2026-09-01T10:00:00.000Z",
  });
  assert.equal(obs.meta.source.system, "ghis");
  assert.equal(obs.meta.source.sourceId, "ghis-lab-4471");
  assert.ok(obs.meta.source.importedAt, "an ingested record records when it was imported");
  assert.deepEqual(obs.meta.derivedFrom, ["obs-49102", "dev-telemetry-881"]);
  assert.equal(obs.meta.effectiveAt, "2026-09-01T10:00:00.000Z", "clinical truth time is not overwritten by import time");
  assert.notEqual(obs.meta.effectiveAt, obs.meta.recordedAt, "effectiveAt and recordedAt are independent axes");
});

test("model: required clinical identifiers are rejected when missing", () => {
  assert.throws(() => Patient({ name: "No MRN", dob: "1980-01-01" }), /Patient.mrn/);
  assert.throws(() => Patient({ mrn: "M1", dob: "1980-01-01" }), /Patient.name/);
  assert.throws(() => Patient({ mrn: "M1", name: "No DOB" }), /Patient.dob/);
  assert.throws(() => Condition({ code: "E11" }), /Condition.patientId/);
  assert.throws(() => AllergyIntolerance({ patientId: "p1" }), /AllergyIntolerance.substance/);
  assert.throws(() => Observation({ patientId: "p1" }), /Observation.code/);
  assert.throws(() => MedicationOrder({ patientId: "p1", drug: "X" }), /MedicationOrder.prescriberId/);
  assert.throws(() => MedicationAdministration({ patientId: "p1" }), /MedicationAdministration.orderId/);
  assert.throws(() => ServiceRequest({ patientId: "p1", code: "CBC" }), /ServiceRequest.requesterId/);
  assert.throws(() => DiagnosticReport({ patientId: "p1" }), /DiagnosticReport.code/);
  assert.throws(() => CarePlan({ patientId: "p1" }), /CarePlan.authorId/);
  assert.throws(() => ClinicalNote({}), /ClinicalNote.patientId/);
});

test("model: an empty string is not a present identifier", () => {
  assert.throws(() => Patient({ mrn: "   ", name: "Whitespace", dob: "1980-01-01" }), /Patient.mrn/);
});

test("model: Encounter class is constrained to real care settings", () => {
  assert.throws(() => Encounter({ patientId: "p1", class: "WARDROUND" }), /Encounter.class/);
  for (const cls of ["OPD", "IPD", "ED", "ICU", "DAYCARE", "VIRTUAL"]) {
    assert.equal(Encounter({ patientId: "p1", class: cls }).class, cls);
  }
});

test("model: AI-authored records default to unsigned and flagged", () => {
  const note = ClinicalNote({ patientId: "p1", aiDrafted: true, sections: { subjective: "..." } });
  assert.equal(note.aiDrafted, true);
  assert.equal(note.signedBy, null, "an AI draft carries no clinician signature until one signs it");
  assert.equal(note.authorId, null);

  const rx = MedicationOrder({ patientId: "p1", drug: "Amoxicillin", prescriberId: "dr-1", aiDrafted: true });
  assert.equal(rx.status, "draft", "an AI-drafted order starts in draft, never active");
  assert.equal(rx.signedBy, null);
});

test("model: allergy criticality falls back to unable-to-assess rather than guessing", () => {
  assert.equal(AllergyIntolerance({ patientId: "p1", substance: "Penicillin" }).criticality, "unable-to-assess");
  assert.equal(AllergyIntolerance({ patientId: "p1", substance: "Penicillin", criticality: "nonsense" }).criticality, "unable-to-assess");
  assert.equal(AllergyIntolerance({ patientId: "p1", substance: "Penicillin", criticality: "high" }).criticality, "high");
});

test("model: device observations carry signal quality and artifact flags", () => {
  const clean = Observation({ patientId: "p1", code: "8867-4", category: "device", value: 88, signalQualityIndex: 96 });
  assert.equal(clean.artifact, false);
  const noisy = Observation({ patientId: "p1", code: "8867-4", category: "device", value: 210, signalQualityIndex: 41, artifact: true });
  assert.equal(noisy.artifact, true, "a flagged artifact must stay flagged for score exclusion downstream");
  assert.equal(Observation({ patientId: "p1", code: "8867-4" }).signalQualityIndex, null, "absent SQI is null, not zero");
});

test("model: derivedFrom must be a list when supplied", () => {
  assert.throws(() => makeMeta({ derivedFrom: "obs-1" }), /derivedFrom/);
});

test("model: ids are unique across rapid construction", () => {
  const ids = new Set(Array.from({ length: 500 }, () => aPatient().id));
  assert.equal(ids.size, 500);
});

/* ------------------------------------------------------------------ event bus */

test("bus: handlers receive the event and the clock advances", async () => {
  const bus = new ClinicalEventBus({ nodeId: "ward-3a" });
  const seen = [];
  bus.on("obs.recorded", (e) => { seen.push(e); });

  await bus.emit("obs.recorded", { value: 1 });
  await bus.emit("obs.recorded", { value: 2 });

  assert.equal(seen.length, 2);
  assert.equal(seen[0].vectorClock["ward-3a"], 1);
  assert.equal(seen[1].vectorClock["ward-3a"], 2, "each distinct event is one causal step");
  assert.equal(seen[1].payload.value, 2);
});

test("bus: only subscribers of the emitted type are called", async () => {
  const bus = new ClinicalEventBus();
  let a = 0; let b = 0;
  bus.on("meds.administered", () => { a += 1; });
  bus.on("meds.held", () => { b += 1; });
  await bus.emit("meds.administered", {});
  assert.equal(a, 1);
  assert.equal(b, 0);
});

test("bus: a redelivered event id is not reprocessed and does not tick the clock", async () => {
  const bus = new ClinicalEventBus({ nodeId: "n1" });
  let calls = 0;
  bus.on("adapter.ingest", () => { calls += 1; });

  const first = await bus.emit("adapter.ingest", { lab: "K+" }, { id: "ghis-evt-77" });
  const replay = await bus.emit("adapter.ingest", { lab: "K+" }, { id: "ghis-evt-77" });

  assert.equal(calls, 1, "a replayed adapter event must not be processed twice");
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true, "the replay is reported as a duplicate, not silently identical");
  assert.equal(replay.vectorClock.n1, first.vectorClock.n1, "a duplicate is not a new causal step");
});

test("bus: unsubscribe stops delivery, both ways", async () => {
  const bus = new ClinicalEventBus();
  let n = 0;
  const handler = () => { n += 1; };
  const unsubscribe = bus.on("x", handler);
  await bus.emit("x", {});
  unsubscribe();
  await bus.emit("x", {});
  assert.equal(n, 1, "the returned unsubscribe detaches the handler");

  bus.on("y", handler);
  assert.equal(bus.listenerCount("y"), 1);
  bus.off("y", handler);
  assert.equal(bus.listenerCount("y"), 0);
});

test("bus: a failing handler retries then lands in the dead-letter queue", async () => {
  const bus = new ClinicalEventBus({ maxRetries: 3 });
  let attempts = 0;
  bus.on("flaky", () => { attempts += 1; throw new Error("downstream unavailable"); });

  await bus.emit("flaky", { n: 1 });

  assert.equal(attempts, 3, "exhausts maxRetries before giving up");
  assert.equal(bus.deadLetterQueue.length, 1, "a lost clinical event is never dropped silently");
  assert.match(bus.deadLetterQueue[0].error, /downstream unavailable/);
  assert.equal(bus.deadLetterQueue[0].event.type, "flaky");

  const drained = bus.drainDeadLetters();
  assert.equal(drained.length, 1);
  assert.equal(bus.deadLetterQueue.length, 0, "draining clears the queue for the supervisor");
});

test("bus: a handler that recovers on retry does not dead-letter", async () => {
  const bus = new ClinicalEventBus({ maxRetries: 3 });
  let attempts = 0;
  bus.on("transient", () => {
    attempts += 1;
    if (attempts < 2) throw new Error("first attempt fails");
  });
  await bus.emit("transient", {});
  assert.equal(attempts, 2);
  assert.equal(bus.deadLetterQueue.length, 0);
});

test("bus: one failing handler does not starve the others", async () => {
  const bus = new ClinicalEventBus({ maxRetries: 1 });
  let good = 0;
  bus.on("fan", () => { throw new Error("bad handler"); });
  bus.on("fan", () => { good += 1; });
  await bus.emit("fan", {});
  assert.equal(good, 1, "a broken subscriber cannot block delivery to a working one");
  assert.equal(bus.deadLetterQueue.length, 1);
});

test("bus: async handlers are awaited before emit resolves", async () => {
  const bus = new ClinicalEventBus();
  let done = false;
  bus.on("slow", async () => {
    await new Promise((r) => setTimeout(r, 5));
    done = true;
  });
  await bus.emit("slow", {});
  assert.equal(done, true);
});

test("bus: mergeClock takes the per-node maximum", () => {
  const bus = new ClinicalEventBus({ nodeId: "tab-a" });
  bus.mergeClock({ "tab-a": 5, "tab-b": 9 });
  bus.mergeClock({ "tab-b": 4, "tab-c": 2 });
  assert.deepEqual(
    Object.fromEntries(bus._clock),
    { "tab-a": 5, "tab-b": 9, "tab-c": 2 },
    "a stale remote clock never rewinds local knowledge",
  );
});

test("bus: the idempotency cache is bounded", async () => {
  const bus = new ClinicalEventBus({ idempotencyWindow: 10 });
  for (let i = 0; i < 50; i++) await bus.emit("t", { i }, { id: `e-${i}` });
  assert.equal(bus._seen.size, 10, "the seen-id cache does not grow without bound in a long session");
  assert.equal(bus._seenOrder.length, 10);
});

test("bus: emit rejects a missing event type", async () => {
  const bus = new ClinicalEventBus();
  await assert.rejects(() => bus.emit("", {}), /event type is required/);
  assert.throws(() => bus.on("x", "not a function"), /handler must be a function/);
});

/* ------------------------------------------------------------------ five rights */

test("five rights: a correct bedside scan passes all five", () => {
  const p = aPatient();
  const o = anOrder(p);
  const r = checkFiveRights(o, aGoodScan(), p);
  assert.equal(r.passed, true, JSON.stringify(r.results));
  assert.deepEqual(r.failed, []);
  assert.deepEqual(Object.keys(r.results).sort(), [...FIVE_RIGHTS].sort());
});

test("five rights: each right fails independently on the wrong input", () => {
  const p = aPatient();
  const o = anOrder(p);

  const wrongPatient = checkFiveRights(o, aGoodScan({ patientBarcode: "WB-9999" }), p);
  assert.deepEqual(wrongPatient.failed, ["patient"]);

  const wrongDrug = checkFiveRights(o, aGoodScan({ drugBarcode: "DB-INSULIN" }), p);
  assert.deepEqual(wrongDrug.failed, ["drug"]);

  const wrongDose = checkFiveRights(o, aGoodScan({ dose: { value: 1000, unit: "mg" } }), p);
  assert.deepEqual(wrongDose.failed, ["dose"]);

  const wrongRoute = checkFiveRights(o, aGoodScan({ route: "IV" }), p);
  assert.deepEqual(wrongRoute.failed, ["route"]);
});

test("five rights: a unit mismatch is a dose failure, not a rounding detail", () => {
  const p = aPatient();
  const o = anOrder(p, { dose: { value: 500, unit: "mg" } });
  const r = checkFiveRights(o, aGoodScan({ dose: { value: 500, unit: "mcg" } }), p);
  assert.deepEqual(r.failed, ["dose"], "500 mcg is not 500 mg");
});

test("five rights: an unscanned wristband or product is a failure, never a skip", () => {
  const p = aPatient();
  const o = anOrder(p);
  assert.deepEqual(checkFiveRights(o, aGoodScan({ patientBarcode: null }), p).failed, ["patient"]);
  assert.deepEqual(checkFiveRights(o, aGoodScan({ drugBarcode: undefined }), p).failed, ["drug"]);
  assert.equal(checkFiveRights(o, {}, p).failed.length, 4, "an empty scan fails patient, drug, dose and route");
});

test("five rights: identity is not satisfied by a barcode alone if the chart disagrees", () => {
  const p = aPatient();
  const orderForSomeoneElse = anOrder(p, { patientId: "pat-other" });
  const r = checkFiveRights(orderForSomeoneElse, aGoodScan(), p);
  assert.deepEqual(r.failed, ["patient"], "a matching band on the wrong chart is still wrong-patient");
});

test("five rights: barcode comparison ignores case and padding, not content", () => {
  const p = aPatient();
  const o = anOrder(p);
  assert.equal(checkFiveRights(o, aGoodScan({ patientBarcode: " wb-0001 " }), p).passed, true);
  assert.equal(checkFiveRights(o, aGoodScan({ patientBarcode: "wb-00010" }), p).passed, false);
});

test("five rights: timing is checked against the window, and never faked when unscheduled", () => {
  const p = aPatient();
  const o = anOrder(p);
  const scheduledAt = "2026-09-04T08:00:00.000Z";

  const onTime = checkFiveRights(o, aGoodScan({ scheduledAt, at: "2026-09-04T08:30:00.000Z" }), p, { windowMinutes: 60 });
  assert.equal(onTime.results.time.ok, true);

  const late = checkFiveRights(o, aGoodScan({ scheduledAt, at: "2026-09-04T11:00:00.000Z" }), p, { windowMinutes: 60 });
  assert.equal(late.results.time.ok, false);
  assert.deepEqual(late.failed, ["time"]);

  const unscheduled = checkFiveRights(o, aGoodScan(), p);
  assert.equal(unscheduled.results.time.ok, true);
  assert.match(unscheduled.results.time.detail, /not asserted/, "an unasserted right says so rather than claiming a pass");
});

/* ------------------------------------------------------------------ eMAR state machine */

test("emar: the full closed loop reaches ADMINISTERED and emits at every step", async () => {
  const bus = new ClinicalEventBus();
  const events = [];
  for (const t of ["verified", "dispensed", "scanned", "administered"]) {
    bus.on(`meds.${t}`, (e) => events.push(e.type));
  }
  const emar = new MedicationAdministrationRecord({ bus, safetyCheck: allowAll });
  const p = aPatient();
  const o = anOrder(p);

  const rec = emar.open(o);
  assert.equal(rec.status, STATES.ORDERED);

  await emar.verify(rec, "pharm-1");
  assert.equal(rec.status, STATES.VERIFIED);
  await emar.dispense(rec, "pharm-1");
  await emar.scan(rec, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" });
  assert.equal(rec.status, STATES.SCANNED);
  assert.equal(rec.scannedPatientBarcode, "WB-0001", "the scan is recorded, not just checked");
  await emar.administer(rec, { order: o, nurseId: "nurse-1" });

  assert.equal(rec.status, STATES.ADMINISTERED);
  assert.equal(rec.administeredBy, "nurse-1");
  assert.ok(rec.administeredAt);
  assert.deepEqual(events, ["meds.verified", "meds.dispensed", "meds.scanned", "meds.administered"]);
});

test("emar: the default safety hook is fail-closed", async () => {
  assert.equal(denyWithoutSafetyEngine().allowed, false);

  const emar = new MedicationAdministrationRecord(); // no safetyCheck injected
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");

  await assert.rejects(
    () => emar.scan(rec, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" }),
    (err) => {
      assert.ok(err instanceof MedicationSafetyError);
      assert.equal(err.reasons[0].code, "NO_SAFETY_ENGINE");
      return true;
    },
    "with no safety engine wired in, the system must refuse rather than wave the dose through",
  );
  assert.equal(rec.status, STATES.DISPENSED, "a refused scan leaves the record where it was");
});

test("emar: a clinical block from the safety engine stops the dose and is reported", async () => {
  const bus = new ClinicalEventBus();
  const blocked = [];
  bus.on("meds.blocked", (e) => blocked.push(e.payload));
  const emar = new MedicationAdministrationRecord({
    bus,
    safetyCheck: () => ({ allowed: false, blocks: [{ code: "ALLERGY_ANAPHYLAXIS", message: "documented anaphylaxis to penicillins" }], warnings: [] }),
  });
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");

  await assert.rejects(
    () => emar.scan(rec, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" }),
    /clinical safety engine blocked/,
  );
  assert.equal(rec.status, STATES.DISPENSED);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].reasons[0].code, "ALLERGY_ANAPHYLAXIS", "the clinical reason reaches the UI, not a generic failure");
});

test("emar: safety warnings that do not block are carried onto the record", async () => {
  const emar = new MedicationAdministrationRecord({
    safetyCheck: () => ({ allowed: true, blocks: [], warnings: [{ code: "RENAL_DOSE", message: "consider eGFR adjustment" }] }),
  });
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");
  await emar.scan(rec, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" });
  assert.equal(rec.safetyWarnings[0].code, "RENAL_DOSE");
});

test("emar: an async safety engine is awaited", async () => {
  const emar = new MedicationAdministrationRecord({
    safetyCheck: async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { allowed: true, blocks: [], warnings: [] };
    },
  });
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");
  await emar.scan(rec, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" });
  assert.equal(rec.status, STATES.SCANNED);
});

test("emar: a failed scan blocks, emits, and never advances the record", async () => {
  const bus = new ClinicalEventBus();
  const blocked = [];
  bus.on("meds.blocked", (e) => blocked.push(e.payload));
  const emar = new MedicationAdministrationRecord({ bus, safetyCheck: allowAll });
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");

  await assert.rejects(
    () => emar.scan(rec, { order: o, patient: p, scan: aGoodScan({ patientBarcode: "WB-WRONG" }), nurseId: "nurse-1" }),
    (err) => {
      assert.equal(err.reasons[0].code, "FIVE_RIGHTS_PATIENT");
      return true;
    },
  );
  assert.equal(rec.status, STATES.DISPENSED);
  assert.equal(blocked.length, 1);
});

test("emar: a dose can never reach ADMINISTERED without a bedside scan", async () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll });
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");

  await assert.rejects(
    () => emar.administer(rec, { order: o, nurseId: "nurse-1" }),
    /illegal transition dispensed -> administered/,
    "skipping the scan is the wrong-patient hazard; the state machine must refuse it",
  );
  assert.equal(rec.status, STATES.DISPENSED);
});

test("emar: illegal transitions are refused across the machine", async () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll });
  const p = aPatient();
  const o = anOrder(p);

  const fresh = emar.open(o);
  await assert.rejects(() => emar.dispense(fresh, "x"), /illegal transition ordered -> dispensed/);

  const done = emar.open(o);
  await emar.verify(done, "pharm-1");
  await emar.dispense(done, "pharm-1");
  await emar.scan(done, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" });
  await emar.administer(done, { order: o, nurseId: "nurse-1" });
  await assert.rejects(() => emar.hold(done, "nurse-1", "too late"), /illegal transition/, "a given dose is terminal");
  await assert.rejects(() => emar.refuse(done, "nurse-1"), /illegal transition/);
});

test("emar: a held dose resumes through the scan, never straight to administered", async () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll });
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");
  await emar.hold(rec, "nurse-1", "patient off ward for imaging");

  assert.equal(rec.status, STATES.HELD);
  assert.equal(rec.holdReason, "patient off ward for imaging");
  await assert.rejects(() => emar.administer(rec, { order: o, nurseId: "nurse-1" }), /illegal transition held -> administered/);

  await emar.transition(rec, STATES.DISPENSED, { actorId: "nurse-1", reason: "patient back on ward" });
  await emar.scan(rec, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" });
  await emar.administer(rec, { order: o, nurseId: "nurse-1" });
  assert.equal(rec.status, STATES.ADMINISTERED);
});

test("emar: a hold without a reason is not a clinical record", async () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll });
  const p = aPatient();
  const rec = emar.open(anOrder(p));
  await assert.rejects(() => emar.hold(rec, "nurse-1", ""), /hold\(\) needs a reason/);
});

test("emar: high-alert medication requires an independent second nurse", async () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll, highAlertDrugs: ["INSULIN", "HEPARIN"] });
  const p = aPatient();
  const o = anOrder(p, { drug: "Insulin glargine 100u/mL", drugBarcode: "DB-INS-100" });
  assert.equal(emar.isHighAlert(o), true);
  assert.equal(emar.isHighAlert(anOrder(p)), false);

  const scan = aGoodScan({ drugBarcode: "DB-INS-100" });
  const mk = async () => {
    const rec = emar.open(o);
    await emar.verify(rec, "pharm-1");
    await emar.dispense(rec, "pharm-1");
    await emar.scan(rec, { order: o, patient: p, scan, nurseId: "nurse-1" });
    return rec;
  };

  const noWitness = await mk();
  await assert.rejects(
    () => emar.administer(noWitness, { order: o, nurseId: "nurse-1" }),
    (err) => { assert.equal(err.reasons[0].code, "WITNESS_REQUIRED"); return true; },
  );
  assert.equal(noWitness.status, STATES.SCANNED, "a missing witness leaves the dose ungiven");

  const selfWitness = await mk();
  await assert.rejects(
    () => emar.administer(selfWitness, { order: o, nurseId: "nurse-1", witnessId: "nurse-1" }),
    (err) => { assert.equal(err.reasons[0].code, "WITNESS_NOT_INDEPENDENT"); return true; },
  );

  const witnessed = await mk();
  await emar.administer(witnessed, { order: o, nurseId: "nurse-1", witnessId: "nurse-2" });
  assert.equal(witnessed.status, STATES.ADMINISTERED);
  assert.equal(witnessed.witnessedBy, "nurse-2");
});

test("emar: the audit trail appends on every transition and on every block", async () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll });
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");
  await assert.rejects(() => emar.scan(rec, { order: o, patient: p, scan: aGoodScan({ route: "IV" }), nurseId: "nurse-1" }), MedicationSafetyError);
  await emar.scan(rec, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" });
  await emar.administer(rec, { order: o, nurseId: "nurse-1" });

  const trail = rec.audit.map((a) => a.to);
  assert.deepEqual(trail, [
    STATES.ORDERED, STATES.VERIFIED, STATES.DISPENSED,
    STATES.DISPENSED, // the refused scan is recorded in place, not erased
    STATES.SCANNED, STATES.ADMINISTERED,
  ]);
  const blockEntry = rec.audit.find((a) => a.reason === "blocked");
  assert.equal(blockEntry.blocks[0].code, "FIVE_RIGHTS_ROUTE", "the failed attempt keeps its reason for the safety committee");
  assert.ok(rec.audit.every((a) => a.at), "every audit line is timestamped");
  assert.equal(rec.audit[1].actorId, "pharm-1");
});

test("emar: the state machine works with no bus attached", async () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll });
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");
  await emar.scan(rec, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" });
  await emar.administer(rec, { order: o, nurseId: "nurse-1" });
  assert.equal(rec.status, STATES.ADMINISTERED, "events are observability, not a dependency of the gates");
});

test("emar: actors are mandatory where accountability is", async () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll });
  const p = aPatient();
  const o = anOrder(p);
  const rec = emar.open(o);
  await assert.rejects(() => emar.verify(rec, null), /pharmacist id/);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");
  await assert.rejects(() => emar.scan(rec, { order: o, patient: p, scan: aGoodScan() }), /needs order, patient and nurseId/);
  await emar.scan(rec, { order: o, patient: p, scan: aGoodScan(), nurseId: "nurse-1" });
  await assert.rejects(() => emar.administer(rec, { order: o }), /needs nurseId/);
});

test("emar: a refused dose is terminal and keeps its reason", async () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll });
  const p = aPatient();
  const rec = emar.open(anOrder(p));
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");
  await emar.refuse(rec, "nurse-1", "patient declined, nausea");
  assert.equal(rec.status, STATES.REFUSED);
  assert.equal(rec.audit.at(-1).reason, "patient declined, nausea");
  await assert.rejects(() => emar.dispense(rec, "pharm-1"), /illegal transition/);
});

test("emar: open() requires a real order", () => {
  const emar = new MedicationAdministrationRecord({ safetyCheck: allowAll });
  assert.throws(() => emar.open(null), /needs a MedicationOrder/);
  assert.throws(() => emar.open({ patientId: "p1" }), /needs a MedicationOrder/);
});
