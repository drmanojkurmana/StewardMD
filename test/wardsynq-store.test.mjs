/* test/wardsynq-store.test.mjs - WardSynQ P0 persistence test suite.
 *
 * Tests the ClinicalStore append-only persistence layer and its backends:
 * MemoryBackend and IndexedDBBackend.
 *
 * node --test test/wardsynq-store.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Patient,
  Observation,
  Condition,
  MedicationOrder,
} from "../wardsynq/wardsynq-model.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import {
  ClinicalStore,
  MemoryBackend,
  IndexedDBBackend,
} from "../wardsynq/wardsynq-store.js";

/* ------------------------------------------------------------------ fixtures */

function aPatient(over) {
  return Patient({
    mrn: "MRN-0001",
    name: "Test Patient",
    dob: "1980-04-12",
    wristbandBarcode: "WB-0001",
    ...over,
  });
}

function anObservation(patient, over) {
  return Observation({
    patientId: patient ? patient.id : "pat-1",
    code: "8867-4",
    value: 80,
    unit: "bpm",
    ...over,
  });
}

function aCondition(patient, over) {
  return Condition({
    patientId: patient ? patient.id : "pat-1",
    code: "E11",
    display: "Type 2 diabetes",
    ...over,
  });
}

/* ------------------------------------------------------------------ ClinicalStore: validation & lifecycle */

test("store: open and close lifecycle works and is idempotent", async () => {
  const store = new ClinicalStore(new MemoryBackend());
  await store.open();
  await store.open(); // idempotent

  const p = aPatient();
  const saved = await store.put(p);
  assert.equal(saved.id, p.id);

  await store.close();
  await store.close(); // idempotent

  await assert.rejects(
    () => store.get("Patient", p.id),
    /ClinicalStore is closed/
  );

  // Can be reopened
  await store.open();
  const reopened = await store.get("Patient", p.id);
  assert.equal(reopened.id, p.id);
});

test("store: put requires entity.resourceType and entity.id and throws TypeError otherwise", async () => {
  const store = new ClinicalStore();

  await assert.rejects(() => store.put(null), TypeError);
  await assert.rejects(() => store.put(undefined), TypeError);
  await assert.rejects(() => store.put("string"), TypeError);
  await assert.rejects(() => store.put({}), TypeError);
  await assert.rejects(() => store.put({ id: "123" }), TypeError);
  await assert.rejects(() => store.put({ resourceType: "Patient" }), TypeError);
  await assert.rejects(
    () => store.put({ resourceType: "", id: "123" }),
    TypeError
  );
  await assert.rejects(
    () => store.put({ resourceType: "   ", id: "123" }),
    TypeError
  );
  await assert.rejects(
    () => store.put({ resourceType: "Patient", id: "" }),
    TypeError
  );
  await assert.rejects(
    () => store.put({ resourceType: "Patient", id: "   " }),
    TypeError
  );
  await assert.rejects(
    () => store.put({ resourceType: 123, id: "123" }),
    TypeError
  );
  await assert.rejects(
    () => store.put({ resourceType: "Patient", id: 123 }),
    TypeError
  );
});

/* ------------------------------------------------------------------ ClinicalStore: append-only & versions */

test("store: put is append-only, increments integer version field, and keeps every prior version", async () => {
  const store = new ClinicalStore();
  const p = aPatient({ id: "pat-version-test", name: "Initial Name" });

  const v1 = await store.put(p);
  assert.equal(v1.version, 1);
  assert.equal(v1.name, "Initial Name");

  const v2Input = { ...v1, name: "Updated Name" };
  const v2 = await store.put(v2Input);
  assert.equal(v2.version, 2);
  assert.equal(v2.name, "Updated Name");

  const v3Input = { ...v2, name: "Third Name" };
  const v3 = await store.put(v3Input);
  assert.equal(v3.version, 3);
  assert.equal(v3.name, "Third Name");

  // get returns latest version
  const latest = await store.get("Patient", "pat-version-test");
  assert.equal(latest.version, 3);
  assert.equal(latest.name, "Third Name");

  // history returns all versions oldest first
  const history = await store.history("Patient", "pat-version-test");
  assert.equal(history.length, 3);
  assert.equal(history[0].version, 1);
  assert.equal(history[0].name, "Initial Name");
  assert.equal(history[1].version, 2);
  assert.equal(history[1].name, "Updated Name");
  assert.equal(history[2].version, 3);
  assert.equal(history[2].name, "Third Name");
});

test("store: get returns null and history returns empty array for non-existent entities", async () => {
  const store = new ClinicalStore();
  const missing = await store.get("Patient", "non-existent-id");
  assert.equal(missing, null);

  const emptyHistory = await store.history("Patient", "non-existent-id");
  assert.deepEqual(emptyHistory, []);

  // Gracefully handles falsy or non-string inputs
  assert.equal(await store.get("", ""), null);
  assert.deepEqual(await store.history("", ""), []);
});

test("store: distinct resource types with the same id maintain independent versioning", async () => {
  const store = new ClinicalStore();
  const sharedId = "shared-id-123";

  await store.put({ resourceType: "Condition", id: sharedId, patientId: "p1", code: "E10" });
  await store.put({ resourceType: "Condition", id: sharedId, patientId: "p1", code: "E11" });

  await store.put({ resourceType: "ServiceRequest", id: sharedId, patientId: "p1", code: "CBC", requesterId: "dr-1" });

  const cond = await store.get("Condition", sharedId);
  assert.equal(cond.version, 2);
  assert.equal(cond.code, "E11");

  const sr = await store.get("ServiceRequest", sharedId);
  assert.equal(sr.version, 1);
  assert.equal(sr.code, "CBC");
});

/* ------------------------------------------------------------------ ClinicalStore: byPatient queries */

test("store: byPatient returns latest version of each distinct entity for that patient", async () => {
  const store = new ClinicalStore();
  const patientA = "pat-alpha";
  const patientB = "pat-beta";

  // Patient A has Observation 1 (put twice -> v1, v2)
  const obs1v1 = anObservation(null, { id: "obs-1", patientId: patientA, value: 70 });
  await store.put(obs1v1);
  const obs1v2 = anObservation(null, { id: "obs-1", patientId: patientA, value: 75 });
  await store.put(obs1v2);

  // Patient A has Observation 2 (put once -> v1)
  const obs2v1 = anObservation(null, { id: "obs-2", patientId: patientA, value: 120 });
  await store.put(obs2v1);

  // Patient B has Observation 3 (put once -> v1)
  const obs3v1 = anObservation(null, { id: "obs-3", patientId: patientB, value: 99 });
  await store.put(obs3v1);

  // Query Patient A
  const resultsA = await store.byPatient("Observation", patientA);
  assert.equal(resultsA.length, 2);

  const foundObs1 = resultsA.find((r) => r.id === "obs-1");
  const foundObs2 = resultsA.find((r) => r.id === "obs-2");

  assert.ok(foundObs1, "obs-1 should be returned for patient A");
  assert.equal(foundObs1.version, 2, "obs-1 should be at its latest version (2)");
  assert.equal(foundObs1.value, 75);

  assert.ok(foundObs2, "obs-2 should be returned for patient A");
  assert.equal(foundObs2.version, 1, "obs-2 should be at version 1");
  assert.equal(foundObs2.value, 120);

  // Query Patient B
  const resultsB = await store.byPatient("Observation", patientB);
  assert.equal(resultsB.length, 1);
  assert.equal(resultsB[0].id, "obs-3");
  assert.equal(resultsB[0].value, 99);

  // Non-existent patient returns empty array
  const resultsEmpty = await store.byPatient("Observation", "pat-non-existent");
  assert.deepEqual(resultsEmpty, []);
});

/* ------------------------------------------------------------------ ClinicalStore: deep copy isolation */

test("store: deep-copy on write prevents mutating stored state through input reference", async () => {
  const store = new ClinicalStore();
  const input = aPatient({ id: "pat-deep-write", name: "Original Name" });
  input.customDetails = { note: "clean" };

  await store.put(input);

  // Mutate input after put
  input.name = "Mutated Input Name";
  input.customDetails.note = "tampered";

  const fetched = await store.get("Patient", "pat-deep-write");
  assert.equal(fetched.name, "Original Name");
  assert.equal(fetched.customDetails.note, "clean");
});

test("store: deep-copy on read prevents mutating stored state through returned references", async () => {
  const store = new ClinicalStore();
  const input = anObservation(null, { id: "obs-deep-read", patientId: "pat-1", value: 100 });
  await store.put(input);

  // Mutate object returned from get()
  const read1 = await store.get("Observation", "obs-deep-read");
  read1.value = 999;
  const read2 = await store.get("Observation", "obs-deep-read");
  assert.equal(read2.value, 100);

  // Mutate object returned from history()
  const hist = await store.history("Observation", "obs-deep-read");
  hist[0].value = 888;
  const read3 = await store.get("Observation", "obs-deep-read");
  assert.equal(read3.value, 100);

  // Mutate object returned from byPatient()
  const list = await store.byPatient("Observation", "pat-1");
  list[0].value = 777;
  const read4 = await store.get("Observation", "obs-deep-read");
  assert.equal(read4.value, 100);
});

/* ------------------------------------------------------------------ ClinicalStore: transactions */

test("store: transaction commits all staged writes atomically on success", async () => {
  const store = new ClinicalStore();

  const res = await store.transaction(async (tx) => {
    const p = await tx.put(aPatient({ id: "pat-tx-1" }));
    const o = await tx.put(anObservation(null, { id: "obs-tx-1", patientId: p.id }));
    return { pId: p.id, oId: o.id };
  });

  assert.equal(res.pId, "pat-tx-1");
  assert.equal(res.oId, "obs-tx-1");

  const p = await store.get("Patient", "pat-tx-1");
  const o = await store.get("Observation", "obs-tx-1");
  assert.ok(p);
  assert.ok(o);
  assert.equal(p.version, 1);
  assert.equal(o.version, 1);
});

test("store: failed transaction leaves no partial writes (all-or-nothing)", async () => {
  const store = new ClinicalStore();

  // Pre-seed an existing condition at version 1
  const initial = aCondition(null, { id: "cond-tx-fail", patientId: "p1", display: "Original Condition" });
  await store.put(initial);

  await assert.rejects(
    () =>
      store.transaction(async (tx) => {
        // Attempt an update to the existing condition
        await tx.put({ ...initial, display: "Modified Inside Failing Tx" });

        // Attempt to create a brand new observation
        await tx.put(anObservation(null, { id: "obs-tx-fail", patientId: "p1" }));

        throw new Error("Simulated clinical transaction failure");
      }),
    /Simulated clinical transaction failure/
  );

  // Existing condition must still be at version 1 with original content
  const cond = await store.get("Condition", "cond-tx-fail");
  assert.equal(cond.version, 1);
  assert.equal(cond.display, "Original Condition");

  const history = await store.history("Condition", "cond-tx-fail");
  assert.equal(history.length, 1);

  // Brand new observation must not exist
  const obs = await store.get("Observation", "obs-tx-fail");
  assert.equal(obs, null);

  const byPat = await store.byPatient("Observation", "p1");
  assert.equal(byPat.length, 0);
});

test("store: transaction handles multiple puts to the same entity with incrementing versions", async () => {
  const store = new ClinicalStore();

  await store.transaction(async (tx) => {
    const v1 = await tx.put({ resourceType: "Condition", id: "c-same-tx", patientId: "p1", code: "E10" });
    assert.equal(v1.version, 1);

    const v2 = await tx.put({ resourceType: "Condition", id: "c-same-tx", patientId: "p1", code: "E11" });
    assert.equal(v2.version, 2);
  });

  const latest = await store.get("Condition", "c-same-tx");
  assert.equal(latest.version, 2);
  assert.equal(latest.code, "E11");

  const history = await store.history("Condition", "c-same-tx");
  assert.equal(history.length, 2);
  assert.equal(history[0].version, 1);
  assert.equal(history[1].version, 2);
});

test("store: transaction handle supports get, history, and byPatient for staged state", async () => {
  const store = new ClinicalStore();

  await store.transaction(async (tx) => {
    await tx.put(anObservation(null, { id: "obs-staged", patientId: "p-staged", value: 50 }));

    const read = await tx.get("Observation", "obs-staged");
    assert.equal(read.value, 50);
    assert.equal(read.version, 1);

    const hist = await tx.history("Observation", "obs-staged");
    assert.equal(hist.length, 1);

    const byPat = await tx.byPatient("Observation", "p-staged");
    assert.equal(byPat.length, 1);
    assert.equal(byPat[0].id, "obs-staged");
  });
});

test("store: transaction requires a function argument", async () => {
  const store = new ClinicalStore();
  await assert.rejects(() => store.transaction(null), TypeError);
  await assert.rejects(() => store.transaction("not a function"), TypeError);
});

/* ------------------------------------------------------------------ ClinicalStore: ClinicalEventBus */

test("store: works with no bus attached", async () => {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  const p = aPatient();
  const saved = await store.put(p);
  assert.equal(saved.id, p.id);
  assert.equal(saved.version, 1);
});

test("store: bus emits store.put event with stored entity after each successful write", async () => {
  const bus = new ClinicalEventBus();
  const events = [];
  bus.on("store.put", (event) => {
    events.push(event);
  });

  const store = new ClinicalStore({ bus });
  const p = aPatient({ id: "pat-bus-1" });
  const saved = await store.put(p);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "store.put");
  assert.equal(events[0].payload.id, "pat-bus-1");
  assert.equal(events[0].payload.version, 1);
  assert.deepEqual(events[0].payload, saved);
});

test("store: bus emits store.put for every record in a successful transaction, and none on failure", async () => {
  const bus = new ClinicalEventBus();
  const events = [];
  bus.on("store.put", (event) => {
    events.push(event);
  });

  const store = new ClinicalStore({ bus });

  // Successful transaction
  await store.transaction(async (tx) => {
    await tx.put(aPatient({ id: "pat-tx-bus" }));
    await tx.put(anObservation(null, { id: "obs-tx-bus", patientId: "pat-tx-bus" }));
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].payload.id, "pat-tx-bus");
  assert.equal(events[1].payload.id, "obs-tx-bus");

  // Failing transaction
  events.length = 0;
  await assert.rejects(
    () =>
      store.transaction(async (tx) => {
        await tx.put(aPatient({ id: "pat-tx-should-fail" }));
        throw new Error("Failed");
      }),
    /Failed/
  );

  assert.equal(events.length, 0, "no store.put events must be emitted when transaction fails");
});

/* ------------------------------------------------------------------ MemoryBackend interface */

test("memory backend: implements backend interface directly", async () => {
  const backend = new MemoryBackend();
  await backend.open();

  await backend.write([
    { resourceType: "Condition", id: "c1", version: 1, patientId: "p1", code: "E10" },
    { resourceType: "Condition", id: "c1", version: 2, patientId: "p1", code: "E11" },
    { resourceType: "Condition", id: "c2", version: 1, patientId: "p1", code: "I10" },
    { resourceType: "Condition", id: "c3", version: 1, patientId: "p2", code: "J45" },
  ]);

  const latest = await backend.get("Condition", "c1");
  assert.equal(latest.version, 2);
  assert.equal(latest.code, "E11");

  const history = await backend.history("Condition", "c1");
  assert.equal(history.length, 2);
  assert.equal(history[0].version, 1);
  assert.equal(history[1].version, 2);

  const patient1Records = await backend.byPatient("Condition", "p1");
  assert.equal(patient1Records.length, 2);
  const ids = patient1Records.map((r) => r.id).sort();
  assert.deepEqual(ids, ["c1", "c2"]);

  await backend.close();
  await assert.rejects(() => backend.get("Condition", "c1"), /closed/);
});

/* ------------------------------------------------------------------ IndexedDBBackend */

test("indexeddb backend: safe to import and instantiate in Node without browser globals", () => {
  const backend = new IndexedDBBackend();
  assert.ok(backend);
  assert.equal(backend.dbName, "wardsynq-store");
  assert.equal(backend.db, null);
});

test("indexeddb backend: open rejects informatively in Node when indexedDB is undefined", async () => {
  if (typeof globalThis.indexedDB !== "undefined") {
    return; // skip if indexedDB exists in this environment
  }
  const backend = new IndexedDBBackend();
  await assert.rejects(
    () => backend.open(),
    /IndexedDB is not available in this environment/
  );
});

const hasIndexedDB =
  typeof globalThis !== "undefined" && typeof globalThis.indexedDB !== "undefined";

test(
  "indexeddb backend: full lifecycle and operations",
  { skip: !hasIndexedDB ? "IndexedDB is not available in plain Node" : false },
  async () => {
    const backend = new IndexedDBBackend({ dbName: "test-idb-suite" });
    const store = new ClinicalStore(backend);
    await store.open();

    const p = aPatient({ id: "pat-idb-1" });
    const v1 = await store.put(p);
    assert.equal(v1.version, 1);

    const v2 = await store.put({ ...p, name: "Updated Name" });
    assert.equal(v2.version, 2);

    const fetched = await store.get("Patient", "pat-idb-1");
    assert.equal(fetched.version, 2);
    assert.equal(fetched.name, "Updated Name");

    const history = await store.history("Patient", "pat-idb-1");
    assert.equal(history.length, 2);
    assert.equal(history[0].version, 1);
    assert.equal(history[1].version, 2);

    const obs1 = anObservation(null, { id: "obs-idb-1", patientId: "pat-idb-1", value: 10 });
    await store.put(obs1);
    const obs2 = anObservation(null, { id: "obs-idb-1", patientId: "pat-idb-1", value: 20 });
    await store.put(obs2);

    const byPat = await store.byPatient("Observation", "pat-idb-1");
    assert.equal(byPat.length, 1);
    assert.equal(byPat[0].version, 2);
    assert.equal(byPat[0].value, 20);

    await store.close();
  }
);
