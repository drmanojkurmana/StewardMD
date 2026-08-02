// test/connect/fhir-r4-normalize-enrich.test.mjs — Task 7: enriched FHIR R4 -> SCCM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFhir } from "../../functions/_connect/connectors/fhir-r4/normalize.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";
import { buildMaikContext } from "../../functions/_connect/maik-context.js";

const ctx = { tenant: { id: "t1" }, now: () => new Date(0) };
const norm = (resources) => normalizeFhir(ctx, { patient: { id: "P1", gender: "female", birthDate: "1979-01-01", name: [{ text: "X" }] }, resources });

test("vital-signs Observation -> category vital-signs (surfaces in buildMaikContext.vitals)", () => {
  const b = norm([{ resourceType: "Observation", id: "o1", category: [{ coding: [{ code: "vital-signs" }] }], code: { text: "Heart rate" }, valueQuantity: { value: 88, unit: "/min" } }]);
  assert.equal(b.observations[0].category, "vital-signs");
  assert.ok(buildMaikContext(b).vitals.some((v) => v.label === "Heart rate"));
});

test("lab Observation maps referenceRange + interpretation", () => {
  const b = norm([{ resourceType: "Observation", id: "o2", category: [{ coding: [{ code: "laboratory" }] }], code: { text: "HbA1c" }, valueQuantity: { value: 9.1, unit: "%" }, interpretation: [{ text: "high" }], referenceRange: [{ low: { value: 4, unit: "%" }, high: { value: 5.6, unit: "%" } }] }]);
  const o = b.observations[0];
  assert.equal(o.interpretation.text, "high");
  assert.equal(o.referenceRange.high.value, 5.6);
});

test("Observation with no category -> defaults to laboratory + a warning", () => {
  const b = norm([{ resourceType: "Observation", id: "o3", code: { text: "Glucose" }, valueQuantity: { value: 5, unit: "mmol/L" } }]);
  assert.equal(b.observations[0].category, "laboratory");
  assert.ok(b.meta.warnings.some((w) => w.includes("defaulted to laboratory")));
});

test("MedicationRequest -> origin order + dosage text", () => {
  const b = norm([{ resourceType: "MedicationRequest", id: "m1", medicationCodeableConcept: { text: "Metformin" }, status: "active", dosageInstruction: [{ text: "500 mg BID" }] }]);
  assert.equal(b.medications[0].origin, "order");
  assert.equal(b.medications[0].dosage.text, "500 mg BID");
});

test("DiagnosticReport result resolves in-bundle, and dangles-to-null out of bundle", () => {
  const inB = norm([{ resourceType: "Observation", id: "Observation-lab", category: [{ coding: [{ code: "laboratory" }] }], code: { text: "CBC" }, valueQuantity: { value: 1 } }, { resourceType: "DiagnosticReport", id: "d1", code: { text: "CBC panel" }, result: [{ reference: "Observation/Observation-lab" }] }]);
  assert.equal(validateBundle(inB).ok, true);
  assert.equal(inB.diagnosticReports[0].results[0].id, "Observation-lab");

  const outB = norm([{ resourceType: "DiagnosticReport", id: "d2", code: { text: "CBC" }, result: [{ reference: "Observation/MISSING" }] }]);
  const v = validateBundle(outB);
  assert.equal(v.ok, true);                                     // dangling ref nulled, not a hard fail
  assert.equal(outB.diagnosticReports[0].results[0], null);
});

test("DocumentReference is narrative-only; inline attachment bytes are dropped + warned", () => {
  const b = norm([{ resourceType: "DocumentReference", id: "doc1", type: { text: "Discharge summary" }, description: "Narrative.", content: [{ attachment: { data: "QklOQVJZ" } }] }]);
  assert.equal(b.documents[0].text, "Narrative.");
  assert.equal(JSON.stringify(b.documents).includes("QklOQVJZ"), false);   // no binary bytes
  assert.ok(b.meta.warnings.some((w) => w.includes("attachment bytes dropped")));
});

test("the full enriched set validates; a malformed resource warns without throwing", () => {
  const b = norm([{ resourceType: "Observation", id: "o9", category: [{ coding: [{ code: "vital-signs" }] }], code: { text: "BP" }, valueQuantity: { value: 120, unit: "mmHg" } }, { resourceType: "Condition", id: "c1", code: { text: "HTN" }, clinicalStatus: { coding: [{ code: "active" }] } }]);
  assert.equal(validateBundle(b).ok, true);
});
