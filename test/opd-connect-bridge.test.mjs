// test/opd-connect-bridge.test.mjs — Connect->OPD bridge: FHIR Encounter bundle -> OPD worklist rows (pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encountersToRows, fhirName } from "../functions/_opd_connect_connector.js";

test("encountersToRows: distinct patients from today's FHIR encounters, keyed for importRoster", () => {
  const bundle = { resourceType: "Bundle", entry: [
    { resource: { resourceType: "Encounter", id: "e1", subject: { reference: "Patient/ca6117-patient-001", display: "Alex Sample Tan" }, serviceType: { text: "General Medicine" } } },
    { resource: { resourceType: "Encounter", id: "e2", subject: { reference: "Patient/ca6117-patient-002", display: "Ben Sample Lim" }, type: [{ text: "Cardiology" }] } },
    { resource: { resourceType: "Encounter", id: "e3", subject: { reference: "Patient/ca6117-patient-001", display: "Alex Sample Tan" } } }, // dup patient
    { resource: { resourceType: "Encounter", id: "e4", subject: { reference: "Patient/999" } } }, // no display -> fallback
    { resource: { resourceType: "Observation", id: "o1" } }, // non-encounter ignored
  ] };
  const rows = encountersToRows(bundle);
  assert.equal(rows.length, 3, "3 distinct patients (dup collapsed, non-encounter dropped)");
  assert.deepEqual(rows[0], { PatientName: "Alex Sample Tan", PatientId: "ca6117-patient-001", VisitId: "e1", VisitType: "new", Department: "General Medicine" });
  assert.equal(rows[1].Department, "Cardiology");                 // from type[].text
  assert.equal(rows[2].PatientName, "Patient 999");               // missing display -> stable fallback
  assert.deepEqual(encountersToRows(null), []);
  assert.deepEqual(encountersToRows({ entry: [] }), []);
});

test("fhirName: prefer name.text, else given + family", () => {
  assert.equal(fhirName({ name: [{ text: "Alex Sample Tan" }] }), "Alex Sample Tan");
  assert.equal(fhirName({ name: [{ given: ["Ben", "S"], family: "Lim" }] }), "Ben S Lim");
  assert.equal(fhirName({ name: [{ family: "Rao" }] }), "Rao");
  assert.equal(fhirName({}), "");
  assert.equal(fhirName(null), "");
});
