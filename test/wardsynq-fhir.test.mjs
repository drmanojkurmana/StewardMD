/* test/wardsynq-fhir.test.mjs — the record as FHIR R4, read only. Pure half.
 *
 * The rule under test throughout: NEVER INVENT A CODE SYSTEM. A guessed `system` URI is a lie that
 * survives every export and every integration afterwards, because a receiving system cannot tell it
 * from a real one.
 *
 * node --test test/wardsynq-fhir.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FHIR_TYPE, CANONICAL_TYPE, systemUriFor, codeable, toFhir, bundle, capabilityStatement,
  fhirPatient, fhirCondition, fhirObservation, fhirMedicationRequest, fhirMedicationAdministration,
  fhirEncounter, fhirDocumentReference, fhirAllergy,
} from "../functions/_wardsynq/fhir.js";

test("NEVER INVENT A CODE SYSTEM: an uncoded concept is text, with no coding at all", () => {
  // Every one of these is a value the model uses to mean "nobody gave us a coding", and each is
  // honest in its own file. Emitting LOINC anyway so the output looked properly coded would be a
  // lie a receiving system has no way to detect.
  for (const s of ["", "unspecified", "text", "ghis-local", "wardsynq-fluid", "local", "UNSPECIFIED"]) {
    assert.equal(systemUriFor(s), null, `"${s}" must yield no system`);
  }
  const c = codeable("Query connective tissue disorder", "text", "Query connective tissue disorder");
  assert.equal(c.coding, undefined, "no coding array at all");
  assert.equal(c.text, "Query connective tissue disorder");

  // A vocabulary we DO record gets a proper coding, and the text as well.
  assert.equal(systemUriFor("http://loinc.org"), "http://loinc.org");
  assert.equal(systemUriFor("ICD-10"), "http://hl7.org/fhir/sid/icd-10");
  const k = codeable("2823-3", "http://loinc.org", "Potassium");
  assert.deepEqual(k.coding, [{ system: "http://loinc.org", code: "2823-3", display: "Potassium" }]);
  assert.equal(k.text, "Potassium");

  // A vocabulary nobody has taught this file about is ALSO uncoded, rather than guessed at.
  assert.equal(systemUriFor("some-hospital-codes"), null);
  assert.equal(codeable("XYZ", "some-hospital-codes", "Local test").coding, undefined);
});

test("a provisional diagnosis stays provisional on the way out", () => {
  const c = fhirCondition({
    resourceType: "Condition", id: "p1", patientId: "pat", code: "J18.9", codeSystem: "ICD-10",
    display: "Pneumonia", clinicalStatus: "active", verificationStatus: "provisional",
  });
  // A problem list that exported everything as "confirmed" would turn every working diagnosis into
  // a fact at the hospital boundary.
  assert.equal(c.verificationStatus.coding[0].code, "provisional");
  assert.equal(c.clinicalStatus.coding[0].code, "active");
  assert.deepEqual(c.code.coding, [{ system: "http://hl7.org/fhir/sid/icd-10", code: "J18.9", display: "Pneumonia" }]);
  assert.deepEqual(c.subject, { reference: "Patient/pat" });

  // An uncoded problem exports as text and keeps its verification status.
  const t = fhirCondition({ resourceType: "Condition", id: "p2", patientId: "pat", code: "Query sepsis", codeSystem: "text", display: "Query sepsis", verificationStatus: "differential", clinicalStatus: "active" });
  assert.equal(t.code.coding, undefined);
  assert.equal(t.verificationStatus.coding[0].code, "differential");
});

test("ONLY A GIVEN DOSE EXPORTS AS COMPLETED: an in-flight one never does", () => {
  const at = (status) => fhirMedicationAdministration({ resourceType: "MedicationAdministration", id: "m", patientId: "pat", orderId: "rx", drug: "Paracetamol", status }).status;
  assert.equal(at("administered"), "completed");
  // Everything else is in-flight or stopped. Exporting any of these as "completed" would put a dose
  // nobody gave onto another hospital's record.
  assert.equal(at("refused"), "not-done");
  assert.equal(at("cancelled"), "not-done");
  assert.equal(at("held"), "on-hold");
  for (const s of ["ordered", "verified", "dispensed", "scanned"]) assert.equal(at(s), "in-progress", s);
  const given = fhirMedicationAdministration({ resourceType: "MedicationAdministration", id: "m", patientId: "pat", orderId: "rx", drug: "Paracetamol", status: "administered", administeredAt: "2026-09-07T09:00:00.000Z", administeredBy: "cfa:rn" });
  assert.deepEqual(given.request, { reference: "MedicationRequest/rx" });
  assert.equal(given.performer[0].actor.display, "cfa:rn");
});

test("a dose is exported as a quantity, not only as prose", () => {
  const r = fhirMedicationRequest({
    resourceType: "MedicationOrder", id: "rx", patientId: "pat", drug: "Paracetamol",
    dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TDS", status: "active", prescriberId: "cfa:dr",
  });
  assert.equal(r.status, "active");
  assert.equal(r.intent, "order");
  // A receiving system that can only read the text cannot check the dose.
  assert.deepEqual(r.dosageInstruction[0].doseAndRate[0].doseQuantity, { value: 500, unit: "mg", system: "http://unitsofmeasure.org", code: "mg" });
  assert.match(r.dosageInstruction[0].text, /500 mg, oral, TDS/);
  // An unmapped drug name is text, never a guessed RxNorm code.
  assert.equal(r.medicationCodeableConcept.coding, undefined);
  assert.equal(r.medicationCodeableConcept.text, "Paracetamol");
});

test("an unmerged identity does not leave here looking confirmed", () => {
  const p = fhirPatient({ resourceType: "Patient", id: "pat", mrn: "SMD-1", name: "Asha Rao", sex: "female", dob: "1972-04-02", provisional: true });
  assert.equal(p.active, false, "a provisional record is exported as inactive, not silently as a confirmed patient");
  // The name is not split on a space and guessed wrong for most of the world's names.
  assert.deepEqual(p.name, [{ text: "Asha Rao" }]);
  assert.equal(p.identifier[0].value, "SMD-1");
  assert.equal(fhirPatient({ id: "p2", name: "X", sex: "unknown-value" }).gender, "unknown");
  assert.equal(fhirPatient({ id: "p3", name: "X", sex: "female", provisional: false }).active, undefined);
});

test("an unsigned note exports as preliminary, never as a finished document", () => {
  const draft = fhirDocumentReference({ resourceType: "ClinicalNote", id: "n1", patientId: "pat", noteType: "discharge-summary", authorId: "cfa:dr", signedBy: null });
  assert.equal(draft.docStatus, "preliminary", "a draft that exported as final would look signed to everyone downstream");
  assert.equal(draft.authenticator, undefined);
  const signed = fhirDocumentReference({ resourceType: "ClinicalNote", id: "n1", patientId: "pat", noteType: "discharge-summary", authorId: "cfa:dr", signedBy: "cfa:dr" });
  assert.equal(signed.docStatus, "final");
  assert.equal(signed.authenticator.display, "cfa:dr");
});

test("observations carry the right value type and never fabricate a unit system", () => {
  const num = fhirObservation({ resourceType: "Observation", id: "o1", patientId: "pat", category: "vital-signs", code: "8867-4", codeSystem: "http://loinc.org", display: "Heart rate", value: 96, unit: "/min", meta: { effectiveAt: "2026-09-07T09:00:00.000Z" } });
  assert.equal(num.valueQuantity.value, 96);
  assert.equal(num.valueQuantity.system, "http://unitsofmeasure.org");
  assert.equal(num.category[0].coding[0].code, "vital-signs");
  assert.equal(num.effectiveDateTime, "2026-09-07T09:00:00.000Z");
  // A non-numeric result is a string, not a quantity with a made-up number.
  const text = fhirObservation({ resourceType: "Observation", id: "o2", patientId: "pat", category: "laboratory", code: "Culture", codeSystem: "ghis-local", value: "No growth at 48h" });
  assert.equal(text.valueString, "No growth at 48h");
  assert.equal(text.valueQuantity, undefined);
  assert.equal(text.code.coding, undefined, "a local lab name is not a LOINC code");
  // A value-less observation carries neither.
  const none = fhirObservation({ resourceType: "Observation", id: "o3", patientId: "pat", code: "X", value: null });
  assert.equal(none.valueQuantity, undefined);
  assert.equal(none.valueString, undefined);
});

test("an inpatient encounter exports as an inpatient encounter, with its ward", () => {
  const e = fhirEncounter({ resourceType: "Encounter", id: "e1", patientId: "pat", class: "IPD", status: "in-progress", periodStart: "2026-09-07T08:00:00.000Z", periodEnd: null, location: { ward: "Medical A", bed: "12" } });
  assert.equal(e.class.code, "IMP");
  assert.equal(e.status, "in-progress");
  assert.equal(e.period.start, "2026-09-07T08:00:00.000Z");
  assert.equal(e.period.end, undefined, "an open stay has no end, rather than a guessed one");
  assert.match(e.location[0].location.display, /Medical A, bed 12/);
  assert.equal(fhirEncounter({ id: "e2", patientId: "p", class: "OPD", status: "finished" }).class.code, "AMB");
  assert.equal(fhirEncounter({ id: "e3", patientId: "p", status: "weird" }).status, "unknown");
});

test("an allergy keeps 'unable-to-assess' rather than being upgraded to a certainty", () => {
  const a = fhirAllergy({ resourceType: "AllergyIntolerance", id: "a1", patientId: "pat", substance: "Penicillin", severity: "severe", criticality: "high" });
  assert.equal(a.criticality, "high");
  assert.equal(a.reaction[0].severity, "severe");
  // Our model says "unable-to-assess" when nobody knows, and so does FHIR. It is not rounded up.
  assert.equal(fhirAllergy({ id: "a2", patientId: "p", substance: "X" }).criticality, "unable-to-assess");
  assert.equal(fhirAllergy({ id: "a3", patientId: "p", substance: "X", criticality: "nonsense" }).criticality, "unable-to-assess");
});

test("a type with no honest mapping is not exported at all", () => {
  // Better absent than approximated: a ShiftHandover rendered as some nearby FHIR resource would be
  // read downstream as a clinical document it is not.
  for (const t of ["ShiftHandover", "CriticalResultLoop", "BreakGlassGrant", "MedicationVerification"]) {
    assert.equal(toFhir({ resourceType: t, id: "x" }), null, t);
    assert.equal(FHIR_TYPE[t], undefined, `${t} is not advertised either`);
  }
  assert.equal(toFhir(null), null);
  assert.equal(toFhir({ resourceType: "Nonsense", id: "x" }), null);
  // And the map round-trips for everything that IS exported.
  for (const [ours, theirs] of Object.entries(FHIR_TYPE)) assert.equal(CANONICAL_TYPE[theirs], ours);
});

/* TASK 7 STEP 4.6: CarePlan, real. Goals become CarePlan.activity - not a second resource type
 * invented to hold one string. */
test("fhirCarePlan: goals become activity.detail, a review date becomes period.end, status maps honestly", () => {
  const plan = {
    resourceType: "CarePlan", id: "cp-1", patientId: "p1", encounterId: "e1",
    state: "active", title: "Post-op mobility plan", authorId: "cfa:nurse1", reviewBy: "2026-09-10",
    goals: [{ title: "Walk to bathroom unassisted", measure: "by day 3", state: "active" }, { title: "Off oxygen", state: "met" }],
    meta: { recordedAt: "2026-09-07T10:00:00Z" },
  };
  const f = toFhir(plan);
  assert.equal(f.resourceType, "CarePlan");
  assert.equal(f.status, "active");
  assert.equal(f.intent, "plan");
  assert.equal(f.title, "Post-op mobility plan");
  assert.deepEqual(f.subject, { reference: "Patient/p1" });
  assert.deepEqual(f.encounter, { reference: "Encounter/e1" });
  assert.equal(f.author.display, "cfa:nurse1");
  assert.equal(f.period.end, "2026-09-10");
  assert.equal(f.activity.length, 2);
  assert.equal(f.activity[0].detail.status, "in-progress");
  assert.match(f.activity[0].detail.description, /Walk to bathroom unassisted/);
  assert.equal(f.activity[1].detail.status, "completed");

  // An unrecognised status is "unknown", never guessed as something more reassuring.
  assert.equal(toFhir({ resourceType: "CarePlan", id: "cp-2", patientId: "p1", authorId: "a", state: "nonsense" }).status, "unknown");
  // No goals: no activity array at all, not an empty one masquerading as "we checked".
  assert.equal(toFhir({ resourceType: "CarePlan", id: "cp-3", patientId: "p1", authorId: "a", state: "active" }).activity, undefined);
});

test("THE CAPABILITY STATEMENT DOES NOT OVERSTATE", () => {
  const c = capabilityStatement({ date: "2026-09-07T00:00:00.000Z", version: "wardsynq-1" });
  assert.equal(c.resourceType, "CapabilityStatement");
  assert.equal(c.fhirVersion, "4.0.1");
  /* READ, VREAD, HISTORY and SEARCH - every one of them real - and nothing that writes. This list
   * widened on 2026-09-08 when vread and history were implemented; it must never widen ahead of
   * the implementation, because a client trusts the declaration. */
  const codes = new Set(c.rest[0].resource.flatMap((r) => r.interaction.map((i) => i.code)));
  assert.deepEqual([...codes].sort(), ["history-instance", "read", "search-type", "vread"]);
  for (const bad of ["create", "update", "delete", "patch"]) assert.ok(!codes.has(bad), `must not advertise ${bad}`);
  // And it says outright that this is not profile-validated, where a machine and a human both see
  // it - because a CapabilityStatement that overstates is how a receiver trusts what it should not.
  assert.match(c.implementation.description, /no implementation guide is carried/);
  assert.match(c.implementation.description, /conformance to US Core or a national profile is neither claimed nor checked/);
  assert.match(c.implementation.description, /never as a guessed code/);
  /* Every mapped type, plus the three DERIVED ones: Provenance (from each version's own stamp), and
   * TASK 7.11's Practitioner and Organization (from the actor id on a row and from the org record).
   * None of the three is a stored canonical type, and each declares only what it can actually do -
   * the two identity types are read-only and say outright that this server is not a directory. */
  assert.equal(c.rest[0].resource.length, Object.keys(FHIR_TYPE).length + 3, "it advertises exactly what it maps, plus the three derived types");
  const derived = c.rest[0].resource.filter((r) => ["Provenance", "Practitioner", "Organization"].includes(r.type));
  assert.equal(derived.length, 3);
  for (const r of derived.filter((x) => x.type !== "Provenance")) {
    assert.deepEqual(r.interaction.map((i) => i.code), ["read"], r.type + " is read-only");
    assert.ok(!r.searchParam, r.type + " declares no search: there is no directory to search");
    assert.match(r.documentation, /Derived, read-only/);
  }
  assert.match(derived.find((r) => r.type === "Practitioner").documentation, /never a name inferred from an account/);
  assert.ok(c.rest[0].resource.some((r) => r.type === "Provenance"));
});

test("a bundle is a searchset with fullUrls that resolve back here", () => {
  const b = bundle([fhirPatient({ id: "pat", name: "X", mrn: "M1" })], { base: "https://x/api/queue/ward/fhir", timestamp: "2026-09-07T09:00:00.000Z" });
  assert.equal(b.resourceType, "Bundle");
  assert.equal(b.type, "searchset");
  assert.equal(b.total, 1);
  assert.equal(b.entry[0].fullUrl, "https://x/api/queue/ward/fhir/Patient/pat");
  assert.equal(bundle([]).total, 0);
});
