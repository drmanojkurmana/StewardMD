/* test/personal-clinic.test.mjs — My Clinic on-device store (patients + consults + backup/restore).
 * node --test test/personal-clinic.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const CLINIC = require("../personal-clinic.js");

function fakeLS() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; }

test("add / list / get patient + save+load consult round-trip", () => {
  CLINIC.configure({ localStorage: fakeLS() });
  const id = CLINIC.addPatient({ name: "Ravi Kumar", age: 42, sex: "Male", phone: "9999" });
  assert.ok(id, "returns an id");
  const list = CLINIC.listPatients();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Ravi Kumar");
  assert.deepEqual(CLINIC.getConsult(id), {}, "new patient has empty consult");
  CLINIC.saveConsult(id, { Temp: "101" }, { Temp: "101", cc: "fever" });
  assert.deepEqual(CLINIC.getConsult(id), { Temp: "101", cc: "fever" }, "latest consult reloads for prefill");
});

test("addPatient persists an mrn (the no-MRN SMD-XXX-nnn hospital id) on the record", () => {
  CLINIC.configure({ localStorage: fakeLS() });
  const id = CLINIC.addPatient({ name: "Asha", mrn: "SMD-A7K-001" });
  assert.equal(CLINIC.getPatient(id).mrn, "SMD-A7K-001", "mrn round-trips through getPatient");
  assert.equal(CLINIC.listPatients()[0].mrn, "SMD-A7K-001", "mrn is in the patient index");
});

test("timeline: one dated entry per consult-open; same-open saves update it; author + newest-first", () => {
  CLINIC.configure({ localStorage: fakeLS() });
  const id = CLINIC.addPatient({ name: "Ravi" });
  CLINIC.startConsult(id);
  CLINIC.saveConsult(id, {}, { cc: "fever" }, { author: "Dr A" });
  CLINIC.saveConsult(id, {}, { cc: "fever, cough" }, { author: "Dr A" });   // same open -> updates the entry
  assert.equal(CLINIC.timeline(id).length, 1, "one entry for one open");
  CLINIC.startConsult(id);
  CLINIC.saveConsult(id, {}, { cc: "followup" }, { author: "Dr B" });       // new open -> new dated entry
  const tl = CLINIC.timeline(id);
  assert.equal(tl.length, 2, "two entries for two opens");
  assert.equal(tl[0].vals.cc, "followup", "newest first");
  assert.equal(tl[0].author, "Dr B", "author captured");
  assert.equal(tl[1].vals.cc, "fever, cough", "same-open save updated the earlier entry");
});

test("investigations + prescriptions record and merge into the timeline", () => {
  CLINIC.configure({ localStorage: fakeLS() });
  const id = CLINIC.addPatient({ name: "P" });
  CLINIC.startConsult(id); CLINIC.saveConsult(id, {}, { cc: "fever" }, { author: "Dr A" });
  CLINIC.localStore.addInvestigation(id, { name: "LFT" }, { author: "Dr A" });
  CLINIC.localStore.addPrescription(id, { drug: "Tab Azithro", freq: "OD", duration: "3d" }, { author: "Dr A" });
  assert.equal(CLINIC.localStore.listInvestigations(id)[0].name, "LFT");
  assert.equal(CLINIC.localStore.listPrescriptions(id)[0].drug, "Tab Azithro");
  const tl = CLINIC.localStore.timeline(id);
  assert.equal(tl.length, 3, "note + investigation + prescription");
  assert.ok(tl.some(function (e) { return e.kind === "investigation"; }) && tl.some(function (e) { return e.kind === "prescription"; }));
});

test("export -> wipe -> import restores everything", () => {
  CLINIC.configure({ localStorage: fakeLS() });
  const id = CLINIC.addPatient({ name: "Sita", age: 30, sex: "Female" });
  CLINIC.saveConsult(id, {}, { cc: "cough x3 days" });
  const json = CLINIC.exportJSON();
  CLINIC.configure({ localStorage: fakeLS() });                 // fresh store
  assert.equal(CLINIC.listPatients().length, 0);
  const r = CLINIC.importJSON(json);
  assert.ok(r.ok && r.added === 1);
  assert.equal(CLINIC.listPatients()[0].name, "Sita");
  assert.deepEqual(CLINIC.getConsult(id), { cc: "cough x3 days" });
});

test("delete patient removes it from the index", () => {
  CLINIC.configure({ localStorage: fakeLS() });
  const id = CLINIC.addPatient({ name: "Temp" });
  CLINIC.deletePatient(id);
  assert.equal(CLINIC.listPatients().length, 0);
});

test("importJSON rejects garbage safely", () => {
  CLINIC.configure({ localStorage: fakeLS() });
  assert.equal(CLINIC.importJSON("not json").ok, false);
  assert.equal(CLINIC.importJSON({ nope: 1 }).ok, false);
  assert.equal(CLINIC.listPatients().length, 0);
});
