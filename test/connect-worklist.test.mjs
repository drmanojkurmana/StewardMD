// Connect ward/OPD roster: FHIR Encounter bundle -> roster rows (bed/doctor/dept, distinct patients).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encounterRoster } from "../functions/_connect/onboard/worklist.js";
test("encounterRoster: distinct patients with bed/doctor/dept from today's encounters", () => {
  const b = { entry: [
    { resource: { resourceType: "Encounter", id: "e1", subject: { reference: "Patient/p1", display: "Asha Rao" }, location: [{ location: { display: "ICU Bed 3" } }], participant: [{ individual: { display: "Dr Manoj" } }], serviceType: { text: "Critical Care" } } },
    { resource: { resourceType: "Encounter", id: "e2", subject: { reference: "Patient/p1" } } },  // dup patient
    { resource: { resourceType: "Encounter", id: "e3", subject: { reference: "Patient/p2" }, type: [{ text: "Cardiology" }] } },
    { resource: { resourceType: "Observation", id: "o" } },  // ignored
  ] };
  const r = encounterRoster(b);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { patientId: "p1", patientFirstName: "Asha Rao", gender: "", dob: "", bedName: "ICU Bed 3", employeeFirstName: "Dr Manoj", deptDescription: "Critical Care", episodeId: "e1" });
  assert.equal(r[1].deptDescription, "Cardiology");
  assert.deepEqual(encounterRoster(null), []);
});
