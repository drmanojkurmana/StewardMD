import { test } from "node:test";
import assert from "node:assert/strict";
import { patient, encounter, condition, observation, diagnosticReport, documentReference, bundle, imagingStudy } from "../../functions/_connect/canonical/model.js";
import { codeable, reference } from "../../functions/_connect/canonical/coding.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";

test("valid bundle passes", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "x" });
  assert.equal(validateBundle(b).ok, true);
});

test("missing patient is an error", () => {
  const b = bundle({ tenantId: "t1", patient: null, sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /patient/);
});

test("dangling intra-bundle reference is nulled with a warning", () => {
  const c = condition({ id: "c1", code: codeable({ text: "dx" }), encounter: reference("Encounter", "missing") });
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), conditions: [c], sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, true);
  assert.equal(b.conditions[0].encounter, null);          // resolve-or-null
  assert.match(r.warnings.join(), /reference/i);
});

test("resolvable reference is preserved", () => {
  const e = encounter({ id: "e1", status: "finished", class: "IP" });
  const c = condition({ id: "c1", code: codeable({ text: "dx" }), encounter: reference("Encounter", "e1") });
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), encounters: [e], conditions: [c], sourceConnector: "x" });
  validateBundle(b);
  assert.deepEqual(b.conditions[0].encounter, { type: "Encounter", id: "e1" });
});

test("DiagnosticReport.results resolves-or-nulls each entry", () => {
  const obs1 = observation({ id: "obs1", category: "laboratory", code: codeable({ text: "Hb" }) });
  const d = diagnosticReport({ id: "d1", code: codeable({ text: "CBC" }), results: [reference("Observation", "obs1"), reference("Observation", "missing")] });
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), observations: [obs1], diagnosticReports: [d], sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, true);
  assert.deepEqual(b.diagnosticReports[0].results[0], { type: "Observation", id: "obs1" });
  assert.equal(b.diagnosticReports[0].results[1], null);
  assert.match(r.warnings.join(), /DiagnosticReport\.results/);
});

test("DocumentReference.encounter resolves-or-nulls", () => {
  const e = encounter({ id: "e1", status: "finished", class: "IP" });
  const d1 = documentReference({ id: "doc1", type: codeable({ text: "discharge summary" }), encounter: reference("Encounter", "missing") });
  const d2 = documentReference({ id: "doc2", type: codeable({ text: "discharge summary" }), encounter: reference("Encounter", "e1") });
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), encounters: [e], documents: [d1, d2], sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, true);
  assert.equal(b.documents[0].encounter, null);
  assert.deepEqual(b.documents[1].encounter, { type: "Encounter", id: "e1" });
  assert.match(r.warnings.join(), /reference/i);
});

// ---- ImagingStudy (metadata-only) ---------------------------------------------------------------------------

test("bundle with a valid imaging study validates", () => {
  const im = imagingStudy({
    id: "im1", modality: "CT", bodySite: "chest", studyDate: "2026-07-01",
    accessionNumber: "ACC-1", description: "CT chest", seriesCount: 2, instanceCount: 120,
    sourceStudyId: "1.2.3.4",
  });
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), imagingStudies: [im], sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, true);
});

test("imaging study with a bad-typed field fails", () => {
  const bad = { id: "im2", seriesCount: "three" };   // simulates a connector bypassing imagingStudy()
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), imagingStudies: [bad], sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /seriesCount.*must be a number/);
});

test("imaging study carrying a url/binary field fails closed (no WADO-RS binary retrieval)", () => {
  const withUrl = { id: "im3", modality: "CT", url: "https://pacs.example/studies/1.2.3.4" };
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), imagingStudies: [withUrl], sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /forbidden field/);
});

test("imaging study missing an id fails", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), imagingStudies: [{ modality: "CT" }], sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /missing\/invalid id/);
});

test("REGRESSION: a bundle with no imaging studies validates exactly as before", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, true);
  assert.deepEqual(b.imagingStudies, []);
});
