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
