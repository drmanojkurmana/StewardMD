// test/shared-clinic.test.mjs — Shared Clinic EMR orchestrator (Phase 11): patient CRUD + the
// opd-emr localStore bridge (getConsult/saveConsult), and the end-to-end shared-clinic flow where one
// device's registration + assessment reach another device through the encrypted sync engine.
// node --test test/shared-clinic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const S = require(join(HERE, "..", "clinic-store.js"));
const SYNC = require(join(HERE, "..", "clinic-sync.js"));
const SC = require(join(HERE, "..", "shared-clinic.js"));

const crypto = {
  encrypt: (s) => Promise.resolve(Buffer.from(String(s)).toString("base64")),
  decrypt: (b) => Promise.resolve(Buffer.from(String(b), "base64").toString())
};
function mkTransport() { const files = {}; return { files, list: () => Object.keys(files), get: (n) => Promise.resolve(files[n]), put: (n, b) => { files[n] = b; return Promise.resolve(); } }; }
function mkNode(dev, tx, base) {
  let t = base;
  const store = S.create({ deviceId: dev, clinicId: "C1", clock: () => (t += 10) });
  const sync = SYNC.create({ store, transport: tx, crypto, deviceId: dev, clinicId: "C1", state: { batch: 0, cursor: {} } });
  const clinic = SC.create({ store, sync });
  return { store, sync, clinic };
}

test("patients: add / list / get / delete via the orchestrator", () => {
  const st = S.create({ deviceId: "devA", clinicId: "C1", clock: (() => { let t = 1000; return () => (t += 10); })() });
  const clinic = SC.create({ store: st });
  const id = clinic.addPatient({ name: "Asha", age: "34", sex: "Female", phone: "99999" });
  assert.equal(clinic.getPatient(id).name, "Asha");
  assert.equal(clinic.listPatients().length, 1);
  clinic.deletePatient(id);
  assert.equal(clinic.getPatient(id), null);
  assert.equal(clinic.listPatients().length, 0);
});

test("addPatient persists an mrn (SMD-XXX-nnn) that syncs on the patient record", () => {
  const st = S.create({ deviceId: "devA", clinicId: "C1", clock: (() => { let t = 1000; return () => (t += 10); })() });
  const clinic = SC.create({ store: st });
  const id = clinic.addPatient({ name: "Asha", mrn: "SMD-C1X-007" });
  assert.equal(clinic.getPatient(id).mrn, "SMD-C1X-007", "mrn round-trips through getPatient");
  assert.equal(clinic.listPatients()[0].mrn, "SMD-C1X-007", "mrn is on the listed patient");
  assert.equal(st.get(id).data.mrn, "SMD-C1X-007", "mrn stored in record data (so it syncs across devices)");
});

test("localStore bridge: saveConsult stores vals; getConsult prefills them", () => {
  const st = S.create({ deviceId: "devA", clinicId: "C1", clock: (() => { let t = 1000; return () => (t += 10); })() });
  const clinic = SC.create({ store: st });
  const id = clinic.addPatient({ name: "P" });
  assert.deepEqual(clinic.localStore.getConsult(id), {}, "no consult yet -> empty prefill");
  clinic.localStore.saveConsult(id, { Chief_complaints: "fever" }, { cc: "fever 3 days", bp: "120/80" });
  assert.equal(clinic.localStore.getConsult(id).cc, "fever 3 days");
  assert.equal(clinic.currentEncounter(id).data.fields.Chief_complaints, "fever");
});

test("localStore bridge: saves within one consult-open UPDATE the same encounter", () => {
  const st = S.create({ deviceId: "devA", clinicId: "C1", clock: (() => { let t = 1000; return () => (t += 10); })() });
  const clinic = SC.create({ store: st });
  const id = clinic.addPatient({ name: "P" });
  clinic.localStore.startConsult(id);
  clinic.localStore.saveConsult(id, {}, { cc: "a" });
  clinic.localStore.saveConsult(id, {}, { cc: "b" });
  assert.equal(st.list("encounter").length, 1, "one encounter, updated");
  assert.equal(clinic.localStore.getConsult(id).cc, "b");
  assert.ok(clinic.currentEncounter(id).version >= 2, "encounter versioned up on re-save");
});

test("timeline: a NEW dated encounter per consult-open; newest-first + author footprint", () => {
  const st = S.create({ deviceId: "devA", clinicId: "C1", clock: (() => { let t = 1000; return () => (t += 10); })() });
  const clinic = SC.create({ store: st });
  const id = clinic.addPatient({ name: "P" });
  const ls = clinic.localStore;
  ls.startConsult(id); ls.saveConsult(id, {}, { cc: "a" }, { author: "Dr A" }); ls.saveConsult(id, {}, { cc: "a2" }, { author: "Dr A" });
  assert.equal(st.list("encounter").length, 1, "one encounter for the first open");
  ls.startConsult(id); ls.saveConsult(id, {}, { cc: "b" }, { author: "Dr B" });
  assert.equal(st.list("encounter").length, 2, "second open appends a new encounter");
  const tl = ls.timeline(id);
  assert.equal(tl.length, 2);
  assert.equal(tl[0].vals.cc, "b", "newest first");
  assert.equal(tl[0].author, "Dr B", "author captured");
  assert.equal(tl[1].vals.cc, "a2", "same-open save updated the earlier entry");
});

test("END-TO-END shared clinic: doctor A registers + assesses; nurse B sees it after sync", async () => {
  const tx = mkTransport();
  const A = mkNode("devA", tx, 1000);   // doctor
  const B = mkNode("devB", tx, 5000);   // nurse
  const pid = A.clinic.addPatient({ name: "Asha Rao", age: "34", sex: "Female" });
  A.clinic.localStore.saveConsult(pid, { Chief_complaints: "fever" }, { cc: "fever 3 days", bp: "120/80" });
  await A.clinic.syncNow();               // A pushes encrypted deltas to the clinic Drive
  await B.clinic.syncNow();               // B pulls them

  assert.equal(B.clinic.getPatient(pid).name, "Asha Rao", "nurse B sees the patient A registered");
  assert.equal(B.clinic.localStore.getConsult(pid).cc, "fever 3 days", "and A's assessment prefills on B");
  assert.equal(B.clinic.localStore.getConsult(pid).bp, "120/80");
});

test("END-TO-END conflict: A and B edit the same patient's encounter concurrently -> parked on merge", async () => {
  const tx = mkTransport();
  const A = mkNode("devA", tx, 1000), B = mkNode("devB", tx, 5000);
  const pid = A.clinic.addPatient({ name: "P" });
  A.clinic.localStore.saveConsult(pid, {}, { dose: "500 mg" });
  await A.clinic.syncNow(); await B.clinic.syncNow();         // both have the patient + encounter
  // concurrent edits to the same encounter
  A.clinic.localStore.saveConsult(pid, {}, { dose: "500 mg (A)" });
  B.clinic.localStore.saveConsult(pid, {}, { dose: "450 mg (B)" });
  await A.clinic.syncNow(); await B.clinic.syncNow();
  await A.clinic.syncNow();                                    // A ingests B's conflicting delta
  assert.ok(A.clinic.conflictCount() >= 1, "conflict surfaced for review, not silently overwritten");
});
