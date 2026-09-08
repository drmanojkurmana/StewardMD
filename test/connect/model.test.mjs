import { test } from "node:test";
import assert from "node:assert/strict";
import { patient, observation, bundle, assertConsumable, SCCM_MAJOR, imagingStudy, RESOURCE_KEYS } from "../../functions/_connect/canonical/model.js";
import { codeable, quantity } from "../../functions/_connect/canonical/coding.js";

test("patient requires a stable id", () => {
  assert.throws(() => patient({}), /id/);
  assert.equal(patient({ id: "p1" }).id, "p1");
});

test("observation carries category + coded code + value", () => {
  const o = observation({ id: "o1", category: "laboratory", code: codeable({ text: "Hb" }), value: quantity({ value: 9 }) });
  assert.equal(o.category, "laboratory");
});

test("bundle envelope pins sccmVersion and holds all resource arrays", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "fhir-r4" });
  assert.equal(b.sccmVersion, "1.1");
  assert.deepEqual(b.conditions, []);
  // 1.1 is additive: the three new collections are present and empty, so a 1.0 consumer reads unchanged.
  assert.deepEqual([b.administrations, b.serviceRequests, b.consents], [[], [], []]);
  assert.equal(b.meta.sourceConnector, "fhir-r4");
});

test("assertConsumable rejects a mismatched major", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "x" });
  assert.doesNotThrow(() => assertConsumable(b, SCCM_MAJOR));
  assert.throws(() => assertConsumable(b, SCCM_MAJOR + 1), /version/);
});

// ---- ImagingStudy (metadata-only) ---------------------------------------------------------------------------

test("imagingStudy requires a stable id", () => {
  assert.throws(() => imagingStudy({}), /id/);
  assert.equal(imagingStudy({ id: "im1" }).id, "im1");
});

test("imagingStudy with only an id shapes to just { id } (no fabricated defaults)", () => {
  const im = imagingStudy({ id: "im1" });
  assert.deepEqual(im, { id: "im1" });
});

test("imagingStudy carries only the optional fields actually present; unknown fields are omitted", () => {
  const im = imagingStudy({ id: "im1", modality: "CT", bodySite: "chest", seriesCount: 2, notAField: "should not appear" });
  assert.deepEqual(im, { id: "im1", modality: "CT", bodySite: "chest", seriesCount: 2 });
  assert.equal("studyDate" in im, false);
  assert.equal("notAField" in im, false);
});

test("imagingStudy full shape (all optional fields present)", () => {
  const im = imagingStudy({
    id: "im2", modality: "MR", bodySite: "brain", studyDate: "2026-07-15",
    accessionNumber: "ACC-42", description: "MRI brain without contrast",
    seriesCount: 4, instanceCount: 210, sourceStudyId: "1.2.840.10008.study.42",
  });
  assert.deepEqual(im, {
    id: "im2", modality: "MR", bodySite: "brain", studyDate: "2026-07-15",
    accessionNumber: "ACC-42", description: "MRI brain without contrast",
    seriesCount: 4, instanceCount: 210, sourceStudyId: "1.2.840.10008.study.42",
  });
});

test("RESOURCE_KEYS includes imagingStudies", () => {
  assert.ok(RESOURCE_KEYS.includes("imagingStudies"));
});

test("bundle() defaults imagingStudies to [] (byte-compatible for every existing/no-imaging bundle)", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "x" });
  assert.deepEqual(b.imagingStudies, []);
});
