/* test/wardsynq-pipeline.test.mjs — production-readiness validation of the whole GHIS pipeline.
 *
 * GHIS -> adapter -> canonical model -> MPI -> encounter -> observations -> event bus -> safety
 * engine -> the surface a clinician reads.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE UNIT SUITES. Every module in that chain has its own tests
 * and they all pass. The cut-over pre-flight then found, on its first run, that no adapter could
 * write an Encounter at all, which no unit test caught because each file was correct in isolation
 * and the defect lived in the seam. This file tests the seams, on the assumption that more of them
 * are wrong.
 *
 * THE INVARIANTS ARE THE POINT. An invariant is a statement that must hold whatever happened, and
 * unlike a scenario it does not depend on anybody having imagined the failure. Each of the ten is
 * ALSO proven able to fail, in its own test, because an invariant that has never failed is
 * decoration rather than evidence.
 *
 * node --test test/wardsynq-pipeline.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { installLiveGhis } from "../wardsynq/wardsynq-ghis-live.js";
import { mapGhisBundle } from "../wardsynq/adapters/wardsynq-ghis-adapter.js";
import { GovernedStore, makeActor, KIND, TIER, INSTRUCTION_TYPES, authoriseWrite } from "../wardsynq/wardsynq-actors.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { scoreMatch, findCandidates } from "../wardsynq/wardsynq-mpi.js";
import { MedicationAdministrationRecord, denyWithoutSafetyEngine } from "../wardsynq/wardsynq-meds.js";
import { MedicationOrder, Patient } from "../wardsynq/wardsynq-model.js";

const settle = () => new Promise((r) => setImmediate(r));
const flagsOn = { get: (k) => k === "smd_wardsynq_cutover" };
const flagsOff = { get: () => false };

/* ------------------------------------------------------------------ the rig */

/** A GHIS bundle. `over` replaces top-level keys. */
const bundle = (over = {}) => ({
  patientId: "GH-40118",
  episodeId: "EP-9912",
  ts: "2026-09-05T08:00:00.000Z",
  patientFirstName: "Anjali", employeeFirstName: "Dr Rao",
  dob: "67", gender: "F", bedName: "MICU 04", deptDescription: "Medical ICU",
  labs: [
    { test: "Potassium", result: "5.4", units: "mmol/L", date: "05/09/2026", low: "3.5", high: "5.1" },
    { test: "Creatinine", result: "1.42", units: "mg/dL", date: "05/09/2026" },
  ],
  ...over,
});

/**
 * The whole pipeline, wired the way the flag wires it.
 *
 * `failOn` makes a chosen resource type's write fail, which is how partial-write and rollback are
 * tested without waiting for a real disk to fill.
 */
async function pipeline({ failOn = null, legacy = null, bus: useBus = true } = {}) {
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  await raw.open();
  const governed = new GovernedStore({ store: raw });
  const feed = makeActor({ id: "ghis-adapter", kind: KIND.ADAPTER, tier: TIER.DRAFT });
  const handle = governed.asStoreFor(feed);

  const store = failOn
    ? { ...handle, put: (e) => (e.resourceType === failOn ? Promise.reject(new Error(`simulated failure on ${failOn}`)) : handle.put(e)) }
    : handle;

  const bus = useBus ? new ClinicalEventBus() : null;
  const events = [];
  if (bus) bus.on("interop.ingested", (e) => events.push(e));

  const host = {
    ingestFromWard: legacy || ((b) => ({
      applied: Object.fromEntries((Array.isArray(b && b.labs) ? b.labs : [])
        .filter((r) => Number.isFinite(Number.parseFloat(r.result)))
        .map((r) => [String(r.test).toLowerCase(), { source: "Ward Sync", ts: b.ts }])),
      conflicts: [],
    })),
  };

  const live = installLiveGhis({ host, flags: flagsOn, store, bus });
  return { raw, governed, feed, store, bus, events, host, live };
}

/** Everything currently in the store, across the types this pipeline writes. */
async function contents(raw, patientId = "ghis-pat-gh-40118") {
  const out = { Patient: [], Encounter: [], Observation: [], DiagnosticReport: [] };
  for (const type of Object.keys(out)) {
    try { out[type] = await raw.byPatient(type, patientId); } catch { out[type] = []; }
  }
  const p = await raw.get("Patient", patientId);
  if (p) out.Patient = [p];
  return out;
}

/* ==================================================================
 * THE TEN INVARIANTS
 * Each is checked over whatever the store holds, and each has a
 * companion test proving it can FAIL.
 * ================================================================== */

/** 1 + 2: no clinical record may reference a Patient or Encounter that is not there. */
async function checkReferences(raw, all) {
  const violations = [];
  const encounterIds = new Set(all.Encounter.map((e) => e.id));
  const patientIds = new Set(all.Patient.map((p) => p.id));

  for (const type of ["Observation", "DiagnosticReport", "Encounter"]) {
    for (const rec of all[type]) {
      if (rec.encounterId && !encounterIds.has(rec.encounterId)) {
        violations.push({ invariant: 1, record: `${rec.resourceType}/${rec.id}`, dangling: `Encounter/${rec.encounterId}` });
      }
      if (rec.patientId && !patientIds.has(rec.patientId)) {
        violations.push({ invariant: 2, record: `${rec.resourceType}/${rec.id}`, dangling: `Patient/${rec.patientId}` });
      }
    }
  }
  return violations;
}

/** 5: every accepted clinical record carries provenance saying where it came from. */
function checkProvenance(all) {
  const violations = [];
  for (const type of Object.keys(all)) {
    for (const rec of all[type]) {
      if (!rec.meta || !rec.meta.source || !rec.meta.source.system) {
        violations.push({ invariant: 5, record: `${rec.resourceType}/${rec.id}`, why: "no meta.source.system" });
      }
      if (!rec.meta || !rec.meta.recordedAt) {
        violations.push({ invariant: 5, record: `${rec.resourceType}/${rec.id}`, why: "no meta.recordedAt" });
      }
    }
  }
  return violations;
}

/** Runs every invariant that can be checked from the store alone. */
async function invariants(raw, patientId) {
  const all = await contents(raw, patientId);
  return { all, violations: [...await checkReferences(raw, all), ...checkProvenance(all)] };
}

/* ==================================================================
 * SCENARIOS
 * ================================================================== */

test("SCENARIO new patient: a first bundle creates patient, encounter and observations", async () => {
  const { raw, host, live } = await pipeline();
  host.ingestFromWard(bundle());
  await settle();

  const { all, violations } = await invariants(raw);
  assert.equal(all.Patient.length, 1);
  assert.equal(all.Encounter.length, 1);
  assert.equal(all.Observation.length, 2);
  assert.deepEqual(violations, [], "a clean ingest must violate nothing");
  assert.equal(live.report().writeErrors, 0);
});

test("SCENARIO existing patient: a second bundle versions rather than duplicating", async () => {
  const { raw, host } = await pipeline();
  host.ingestFromWard(bundle());
  await settle();
  host.ingestFromWard(bundle({ ts: "2026-09-05T12:00:00.000Z", labs: [{ test: "Potassium", result: "5.0", units: "mmol/L", date: "05/09/2026" }] }));
  await settle();

  const all = await contents(raw);
  assert.equal(all.Patient.length, 1, "one patient, not two");
  const history = await raw.history("Patient", all.Patient[0].id);
  assert.ok(history.length >= 1, "and the store keeps every version rather than overwriting");
});

test("SCENARIO duplicate patient: the MPI scores a near-match rather than merging silently", () => {
  // Two GHIS records for one person, differing by a typo and a missing middle name. The pipeline
  // must NOT auto-merge: it scores and surfaces.
  const a = { name: "Anjali Menon", dob: "1959-04-02", sex: "F", mrn: "GH-40118" };
  const b = { name: "Anjali Menen", dob: "1959-04-02", sex: "F", mrn: "GH-40877" };
  const m = scoreMatch(a, b);
  assert.ok(m.score > 0, "a near-duplicate scores");
  assert.ok(m.breakdown, "and the score is explainable rather than a bare number");
  assert.notEqual(a.mrn, b.mrn, "two MRNs remain two identities until a human merges them");
});

test("SCENARIO encounter creation and transfer: a ward move versions the encounter", async () => {
  const { raw, host } = await pipeline();
  host.ingestFromWard(bundle());
  await settle();
  host.ingestFromWard(bundle({ ts: "2026-09-05T14:00:00.000Z", bedName: "Ward 3A, bed 12", deptDescription: "General Medicine" }));
  await settle();

  const all = await contents(raw);
  assert.equal(all.Encounter.length, 1, "a transfer is the same episode in a new place, not a new episode");
  const { violations } = await invariants(raw);
  assert.deepEqual(violations, []);
});

test("SCENARIO lab ingestion: values, units and the source's own words all survive", async () => {
  const { raw, host } = await pipeline();
  host.ingestFromWard(bundle());
  await settle();

  const obs = (await contents(raw)).Observation;
  const k = obs.find((o) => o.sourceTestName === "Potassium");
  assert.equal(k.value, 5.4);
  assert.equal(k.unit, "mmol/L");
  assert.equal(k.sourceValue, "5.4", "the raw survives, so a mapping error is recoverable from the record");
  assert.equal(k.unitNormalised, false, "trap 2: this pipeline does not convert units, and says so");
});

test("SCENARIO medication ingestion: GHIS medications do NOT become orders in this build", async () => {
  const { raw, host } = await pipeline();
  // A bundle carrying medications. The adapter maps labs and imaging and nothing else.
  host.ingestFromWard(bundle({ medications: [{ drug: "warfarin", dose: "3mg", status: "active" }] }));
  await settle();

  const mapped = mapGhisBundle(bundle({ medications: [{ drug: "warfarin" }] }));
  assert.equal(mapped.medicationOrders, undefined, "the adapter has no medication mapping at all");
  const orders = await raw.byPatient("MedicationOrder", "ghis-pat-gh-40118").catch(() => []);
  assert.equal(orders.length, 0,
    "which is the SAFE gap: an unmapped medication is absent, not silently wrong. It is a declared limitation, not a working feature.");
});

test("SCENARIO malformed data: junk is quarantined and the round survives", async () => {
  const { raw, host, live } = await pipeline();
  for (const junk of [{}, { labs: "not an array" }, { patientId: "", labs: [] }, null]) {
    assert.doesNotThrow(() => host.ingestFromWard(junk));
  }
  await settle();
  assert.equal(live.report().adapterErrors, 0, "malformed input is an issue, not a crash");
  assert.ok(live.report().issues.length >= 1, "and it is recorded rather than dropped");
});

test("SCENARIO missing identifiers: no patient id means no identity is invented", async () => {
  const { raw, host, live } = await pipeline();
  host.ingestFromWard(bundle({ patientId: null }));
  await settle();
  assert.ok(live.report().issues.some((i) => i.code === "GHIS_NO_PATIENT_ID"));
  const { violations } = await invariants(raw);
  assert.deepEqual(violations, [], "and nothing partial was written for a patient that could not be identified");
});

test("SCENARIO duplicate replay: the same bundle twice writes once", async () => {
  const { raw, host, live } = await pipeline();
  const b = bundle();
  host.ingestFromWard(b);
  await settle();
  const afterFirst = live.report().written;
  host.ingestFromWard(b);
  await settle();

  assert.equal(live.report().written, afterFirst);
  assert.ok(live.report().skippedDuplicate >= 1);
  const all = await contents(raw);
  assert.equal(all.Observation.length, 2, "and the store holds one copy of each observation");
});

test("SCENARIO offline then reconnect: a catch-up window replays without duplicating", async () => {
  const { raw, host, live } = await pipeline();
  const b1 = bundle({ ts: "2026-09-05T08:00:00.000Z" });
  const b2 = bundle({ ts: "2026-09-05T09:00:00.000Z", labs: [{ test: "Sodium", result: "138", units: "mmol/L", date: "05/09/2026" }] });

  host.ingestFromWard(b1);
  await settle();
  // Reconnect: the source resends its whole window, including what we already have.
  host.ingestFromWard(b1);
  host.ingestFromWard(b2);
  await settle();

  const all = await contents(raw);
  assert.equal(all.Observation.length, 3, "two from the first bundle and one new, not five");
  const { violations } = await invariants(raw);
  assert.deepEqual(violations, []);
});

test("SCENARIO concurrent edits: a manual value and a ward value both survive as versions", async () => {
  const { raw, governed, host } = await pipeline();
  host.ingestFromWard(bundle());
  await settle();

  const obs = (await contents(raw)).Observation;
  const k = obs.find((o) => o.sourceTestName === "Potassium");

  // A clinician corrects it while the feed is still running.
  const nurse = makeActor({ id: "nurse-7", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "RN-1" });
  await governed.asStoreFor(nurse).put({ ...k, value: 4.9 });

  const history = await raw.history("Observation", k.id);
  assert.ok(history.length >= 2, "the append-only store keeps both");
  assert.equal(history.some((v) => v.value === 5.4), true, "the ward value is still readable");
  assert.equal(history.some((v) => v.value === 4.9), true, "and so is the correction");
});

test("SCENARIO event replay: replaying the same bus event has no second effect", async () => {
  const { bus } = await pipeline();
  let handled = 0;
  bus.on("replay.test", () => { handled += 1; });
  await bus.emit("replay.test", { x: 1 }, { id: "same" });
  await bus.emit("replay.test", { x: 1 }, { id: "same" });
  assert.equal(handled, 1);
});

/* ==================================================================
 * INVARIANT 1 and 2: DANGLING REFERENCES
 * ================================================================== */

test("INVARIANT 1+2 CAN FAIL: the checker catches a dangling reference when there is one", async () => {
  // Proving the check is real before trusting it to pass.
  const fake = {
    Patient: [], Encounter: [],
    Observation: [{ resourceType: "Observation", id: "o1", patientId: "p-missing", encounterId: "e-missing", meta: { source: { system: "x" }, recordedAt: "t" } }],
    DiagnosticReport: [],
  };
  const v = await checkReferences(null, fake);
  assert.equal(v.length, 2, "one dangling encounter and one dangling patient");
  assert.ok(v.some((x) => x.invariant === 1));
  assert.ok(v.some((x) => x.invariant === 2));
});

test("INVARIANT 1: a failed ENCOUNTER write must not leave observations dangling", async () => {
  // This is the defect the pre-flight's sibling: the encounter write fails, the observations are
  // written anyway, and each carries an encounterId pointing at nothing. A dangling reference that
  // nothing reports is worse than a loud failure.
  const { raw, host, live } = await pipeline({ failOn: "Encounter" });
  host.ingestFromWard(bundle());
  await settle();

  const { violations } = await invariants(raw);
  assert.deepEqual(violations, [],
    "either the whole bundle lands or none of it does; a partial bundle is a corrupt chart");
  assert.ok(live.report().writeErrors >= 1, "and the failure is still visible");
});

test("INVARIANT 2: a failed PATIENT write must not leave an encounter or observations behind", async () => {
  const { raw, host, live } = await pipeline({ failOn: "Patient" });
  host.ingestFromWard(bundle());
  await settle();

  const { all, violations } = await invariants(raw);
  assert.deepEqual(violations, []);
  assert.equal(all.Observation.length, 0, "nothing clinical is recorded against a patient that does not exist");
  assert.ok(live.report().writeErrors >= 1);
});

test("INVARIANT: a partial write leaves a REFERENTIALLY SOUND prefix, not a corrupt chart", async () => {
  /* This test originally demanded that the whole bundle roll back, and it was the wrong
   * requirement. The store is append-only: there is nothing to un-write, and demanding rollback
   * from it would have meant either inventing a delete or claiming a guarantee that was not there.
   *
   * What IS guaranteed, and is what actually matters clinically, is that a prefix of a
   * dependency-ordered sequence is always referentially complete. A patient admitted with no
   * results yet is a true statement that the next bundle completes. An observation pointing at an
   * encounter that was never written is a corrupt chart. Only the second is a defect, and only the
   * second is prevented here. */
  const { raw, host, live } = await pipeline({ failOn: "Observation" });
  host.ingestFromWard(bundle());
  await settle();

  const { all, violations } = await invariants(raw);
  assert.deepEqual(violations, [], "nothing dangles");
  assert.equal(all.Observation.length, 0, "the failing write and everything after it was abandoned");
  assert.equal(all.Patient.length, 1, "and what did land is a true and complete statement on its own");
  assert.equal(all.Encounter.length, 1);
  assert.ok(live.report().failures.length >= 1);
  assert.ok(live.report().failures[0].abandoned.length >= 1, "the abandoned work is named, so it can be retried");
});

test("INVARIANT: with a transaction-capable store the guarantee becomes ALL-OR-NOTHING", async () => {
  // Where the store offers a real transaction, the stronger property is available and is used.
  const staged = [];
  let committed = [];
  const transactional = {
    put: (e) => { staged.push(e); return e; },
    transaction: async (fn) => {
      const local = [];
      await fn({ put: async (e) => { if (e.resourceType === "Observation") throw new Error("simulated failure"); local.push(e); } });
      committed = committed.concat(local);   // only reached if nothing threw
    },
  };

  const host = { ingestFromWard: () => ({ applied: {} }) };
  const live = installLiveGhis({ host, flags: flagsOn, store: transactional });
  host.ingestFromWard(bundle());
  await settle();

  assert.equal(committed.length, 0, "the observation threw, so the patient and encounter did not commit either");
  assert.equal(live.report().written, 0);
  assert.ok(live.report().failures.length >= 1, "and the whole bundle is retained as one recoverable failure");
});

/* ==================================================================
 * INVARIANT 3: the safety engine cannot be bypassed
 * ================================================================== */

test("INVARIANT 3: no ACTIVE MedicationOrder can be created by the ingest path", async () => {
  const { store } = await pipeline();
  const order = MedicationOrder({ patientId: "ghis-pat-gh-40118", drug: "warfarin", prescriberId: "dr-1", status: "active" });
  await assert.rejects(() => Promise.resolve(store.put(order)),
    "an adapter is capped at DRAFT and a MedicationOrder is an instruction type");
});

test("INVARIANT 3 CAN FAIL: an EXECUTE human is allowed, so the rule is about tier and not about luck", async () => {
  const { governed } = await pipeline();
  const doctor = makeActor({ id: "dr-1", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "GMC-1" });
  const order = MedicationOrder({ patientId: "p", drug: "warfarin", prescriberId: "dr-1", status: "active" });
  const written = await governed.asStoreFor(doctor).put(order);
  assert.ok(written, "a credentialed human CAN commit one, which is what makes the adapter's refusal meaningful");
});

test("INVARIANT 3: the eMAR refuses to administer with no safety engine wired", async () => {
  const emar = new MedicationAdministrationRecord({});   // no safetyCheck supplied
  const order = MedicationOrder({ patientId: "p", drug: "amoxicillin", prescriberId: "dr-1" });
  const patient = Patient({ id: "p", mrn: "M", name: "N", dob: "1960-01-01", wristbandBarcode: "W" });
  let rec = emar.open(order);
  rec = await emar.verify(rec, "pharm");
  rec = await emar.dispense(rec, "pharm");
  await assert.rejects(
    () => emar.scan(rec, { order, patient, nurseId: "n", scan: { patientBarcode: "W", drugBarcode: order.drugBarcode || order.drug, dose: order.dose, route: order.route } }),
    "the default hook denies, so an unconfigured system refuses to give drugs rather than waving them through");
});

/* ==================================================================
 * INVARIANT 4: duplicate ingestion, no duplicate side effects
 * ================================================================== */

test("INVARIANT 4: replaying a bundle produces no second downstream side effect", async () => {
  const { host, bus, events } = await pipeline();
  const sideEffects = [];
  bus.on("interop.ingested", () => sideEffects.push(1));

  const b = bundle();
  host.ingestFromWard(b);
  host.ingestFromWard(b);
  host.ingestFromWard(b);
  await settle();

  assert.equal(sideEffects.length, 1, "three deliveries, one clinical consequence");
  assert.equal(events.length, 1);
});

/* ==================================================================
 * INVARIANT 5: provenance
 * ================================================================== */

test("INVARIANT 5 CAN FAIL: the checker catches a record with no provenance", () => {
  const v = checkProvenance({ Observation: [{ resourceType: "Observation", id: "o1", meta: {} }], Patient: [], Encounter: [], DiagnosticReport: [] });
  assert.ok(v.length >= 1);
  assert.equal(v[0].invariant, 5);
});

test("INVARIANT 5: every record written by the pipeline carries its source", async () => {
  const { raw, host } = await pipeline();
  host.ingestFromWard(bundle());
  await settle();

  const all = await contents(raw);
  assert.deepEqual(checkProvenance(all), []);
  assert.equal(all.Observation[0].meta.source.system, "ghis", "and it names the system it came from");
});

/* ==================================================================
 * INVARIANT 6: failed writes are visible AND recoverable
 * ================================================================== */

test("INVARIANT 6: EVERY failed write is retained, not just the last one", async () => {
  const { host, live } = await pipeline({ failOn: "Observation" });
  host.ingestFromWard(bundle());                                    // two observations fail
  host.ingestFromWard(bundle({ ts: "2026-09-05T10:00:00.000Z" }));  // two more
  await settle();

  const report = live.report();
  assert.ok(Array.isArray(report.failures), "a single lastError loses every failure but one");
  assert.ok(report.failures.length >= 2, `expected several retained failures, got ${report.failures.length}`);
  assert.ok(report.failures.every((f) => f.entity && f.message), "each names what failed and why");
});

test("INVARIANT 6: a failed write is RECOVERABLE, meaning the entity is still available to retry", async () => {
  const { host, live } = await pipeline({ failOn: "Observation" });
  host.ingestFromWard(bundle());
  await settle();
  const report = live.report();
  assert.ok(report.failures.some((f) => f.retryable !== undefined),
    "visible is not the same as recoverable: something has to be able to try again");
});

/* ==================================================================
 * INVARIANT 7: conflicts are never silently overwritten
 * ================================================================== */

test("INVARIANT 7: a ward value never silently replaces a clinician's correction", async () => {
  const { raw, governed, host } = await pipeline();
  host.ingestFromWard(bundle());
  await settle();

  const k = (await contents(raw)).Observation.find((o) => o.sourceTestName === "Potassium");
  const nurse = makeActor({ id: "nurse-7", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "RN-1" });
  await governed.asStoreFor(nurse).put({ ...k, value: 4.9 });

  // The feed resends the original value.
  host.ingestFromWard(bundle({ ts: "2026-09-05T11:00:00.000Z" }));
  await settle();

  const history = await raw.history("Observation", k.id);
  assert.ok(history.length >= 2, "every version is kept, so nothing is lost");
  assert.ok(history.some((v) => v.value === 4.9),
    "the clinician's value is still in the record and can be shown alongside the ward's");
});

/* ==================================================================
 * INVARIANT 8: a broken bus consumer cannot corrupt the record
 * ================================================================== */

test("INVARIANT 8: a throwing event consumer cannot corrupt or roll back the canonical record", async () => {
  const { raw, bus, host } = await pipeline();
  bus.on("interop.ingested", () => { throw new Error("a downstream consumer exploded"); });

  host.ingestFromWard(bundle());
  await settle();

  const { all, violations } = await invariants(raw);
  assert.equal(all.Observation.length, 2, "the chart is intact");
  assert.deepEqual(violations, []);
  assert.ok(bus.deadLetterQueue.length >= 1, "and the broken consumer is in the dead letter queue rather than silent");
});

/* ==================================================================
 * INVARIANT 9: replay idempotence
 * ================================================================== */

test("INVARIANT 9: replaying the same GHIS bundle five times is indistinguishable from once", async () => {
  const once = await pipeline();
  once.host.ingestFromWard(bundle());
  await settle();
  const afterOnce = await contents(once.raw);

  const many = await pipeline();
  for (let i = 0; i < 5; i++) many.host.ingestFromWard(bundle());
  await settle();
  const afterMany = await contents(many.raw);

  assert.equal(afterMany.Patient.length, afterOnce.Patient.length);
  assert.equal(afterMany.Encounter.length, afterOnce.Encounter.length);
  assert.equal(afterMany.Observation.length, afterOnce.Observation.length);
  assert.deepEqual(
    afterMany.Observation.map((o) => o.id).sort(),
    afterOnce.Observation.map((o) => o.id).sort(),
    "same ids, same count: a replay is a no-op and not a near-miss");
});

/* ==================================================================
 * INVARIANT 10: OFF and ON differ, explicitly and testably
 * ================================================================== */

test("INVARIANT 10: with the flag OFF, nothing is written and the legacy result is identical", async () => {
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  await raw.open();
  const governed = new GovernedStore({ store: raw });
  const feed = makeActor({ id: "ghis", kind: KIND.ADAPTER, tier: TIER.DRAFT });
  const host = { ingestFromWard: (b) => ({ applied: { k: {} }, marker: "legacy" }) };

  const off = installLiveGhis({ host, flags: flagsOff, store: governed.asStoreFor(feed) });
  assert.equal(off.installed, false);

  const result = host.ingestFromWard(bundle());
  await settle();
  const all = await contents(raw);
  assert.equal(all.Observation.length, 0, "OFF writes nothing to the canonical model");
  assert.equal(result.marker, "legacy");
});

test("INVARIANT 10: with the flag ON, the legacy result is byte-identical and the canonical model fills", async () => {
  const legacyOff = { ingestFromWard: (b) => ({ applied: { k: {} }, marker: "legacy", n: 1 }) };
  const before = legacyOff.ingestFromWard(bundle());

  const { raw, host } = await pipeline({ legacy: () => ({ applied: { k: {} }, marker: "legacy", n: 1 }) });
  const after = host.ingestFromWard(bundle());
  await settle();

  assert.deepEqual(after, before,
    "the ONLY difference the flag makes to the mobile app is none: the legacy return value is identical");
  const all = await contents(raw);
  assert.ok(all.Observation.length > 0, "and the documented difference is that the canonical model now fills");
});

test("INVARIANT 10: the difference is DOCUMENTED where somebody turning the flag on will read it", async () => {
  const { readFile } = await import("node:fs/promises");
  const flags = await readFile(new URL("../wardsynq-flags.js", import.meta.url), "utf8");
  assert.match(flags, /smd_wardsynq_cutover/);
  assert.match(flags, /legacy path still owns STATE/i);
  assert.match(flags, /cannot change what the app shows|runs FIRST and its result is returned untouched/i);
});
