// test/connect/dicomweb/connector.test.mjs — the DICOMweb QIDO-RS pull connector: contract, fetchPatient+
// normalize round trip (DICOM tag -> imagingStudies mapping asserted), a study missing tags never fabricates
// fields, a non-array/garbage response never invents studies, row-cap truncation, custom header auth + the
// DICOM-JSON Accept header, and the fail-closed fetch idiom (typed UpstreamError on a bare rejection; an
// already-typed error such as the onboard SSRF guard's OnboardError is never masked). Also asserts NO url/
// binary field is ever emitted, even when the raw (poisoned) study object carries one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dicomWebConnector } from "../../../functions/_connect/connectors/dicomweb/connector.js";
import { assertConnector } from "../../../functions/_connect/interfaces.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { UpstreamError } from "../../../functions/_connect/permission.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";

const ctx = (over = {}) => ({
  tenant: { id: "t1" },
  now: () => new Date(0),
  config: Object.assign({ base_url: "https://pacs.example.org/dicom-web", studiesPath: "/studies", patientTag: "00100020" }, over.config || {}),
  secrets: over.secrets || (async (name) => (name === "bearer" ? "tok-123" : null)),
  fetch: over.fetch,
  budget: over.budget || { maxRows: 5000 },
  logger: { warn() {}, error() {} },
});

// A realistic QIDO-RS DICOM-JSON study object: every field the connector maps is present.
const STUDY_FULL = {
  "0020000D": { vr: "UI", Value: ["1.2.840.113619.2.55.1.1"] },   // StudyInstanceUID
  "00080020": { vr: "DA", Value: ["20260715"] },                   // StudyDate
  "00080050": { vr: "SH", Value: ["ACC12345"] },                   // AccessionNumber
  "00080061": { vr: "CS", Value: ["CT"] },                          // ModalitiesInStudy
  "00081030": { vr: "LO", Value: ["CT Chest without contrast"] },   // StudyDescription
  "00201206": { vr: "IS", Value: [3] },                             // NumberOfStudyRelatedSeries
  "00201208": { vr: "IS", Value: [512] },                           // NumberOfStudyRelatedInstances
  "00180015": { vr: "CS", Value: ["CHEST"] },                       // BodyPartExamined
};
// A minimal study object: only the mandatory StudyInstanceUID.
const STUDY_MINIMAL = { "0020000D": { vr: "UI", Value: ["1.2.840.113619.2.55.1.2"] } };

test("dicomWebConnector satisfies the pull-profile contract", () => {
  assert.doesNotThrow(() => assertConnector(dicomWebConnector));
  assert.equal(dicomWebConnector.meta.id, "dicomweb");
  assert.equal(dicomWebConnector.meta.profile, "pull");
  assert.equal(dicomWebConnector.meta.sccmVersion, "1.0");
});

test("fetchPatient+normalize round-trip -> valid SCCM bundle; DICOM tag mapping + auth + Accept + url are correct", async () => {
  const fetchStub = async (url, init) => {
    assert.match(String(url), /\/studies\?00100020=P1$/);
    assert.equal(init.headers.authorization, "Bearer tok-123");
    assert.equal(init.headers.accept, "application/dicom+json");
    assert.equal(init.redirect, "manual");
    return new Response(JSON.stringify([STUDY_FULL]), { status: 200 });
  };
  const c = ctx({ fetch: fetchStub });
  const raw = await dicomWebConnector.fetchPatient(c, "P1");
  const bundle = await dicomWebConnector.normalize(c, raw);
  assert.equal(validateBundle(bundle).ok, true);
  assert.equal(bundle.imagingStudies.length, 1);
  const s = bundle.imagingStudies[0];
  assert.equal(s.sourceStudyId, "1.2.840.113619.2.55.1.1");
  assert.equal(s.modality, "CT");
  assert.equal(s.studyDate, "20260715");
  assert.equal(s.accessionNumber, "ACC12345");
  assert.equal(s.description, "CT Chest without contrast");
  assert.equal(s.seriesCount, 3);
  assert.equal(s.instanceCount, 512);
  assert.equal(s.bodySite, "CHEST");
  assert.equal(bundle.meta.sourceConnector, "dicomweb");
});

test("modality falls back to Modality (00080060) when ModalitiesInStudy (00080061) is absent", async () => {
  const study = { "0020000D": { vr: "UI", Value: ["1.2.3"] }, "00080060": { vr: "CS", Value: ["MR"] } };
  const c = ctx({ fetch: async () => new Response(JSON.stringify([study]), { status: 200 }) });
  const raw = await dicomWebConnector.fetchPatient(c, "P1");
  const bundle = await dicomWebConnector.normalize(c, raw);
  assert.equal(bundle.imagingStudies[0].modality, "MR");
});

test("a study missing optional tags -> those fields OMITTED, never fabricated (only id+sourceStudyId present)", async () => {
  const fetchStub = async () => new Response(JSON.stringify([STUDY_MINIMAL]), { status: 200 });
  const c = ctx({ fetch: fetchStub });
  const raw = await dicomWebConnector.fetchPatient(c, "P1");
  const bundle = await dicomWebConnector.normalize(c, raw);
  assert.equal(validateBundle(bundle).ok, true);
  assert.equal(bundle.imagingStudies.length, 1);
  const s = bundle.imagingStudies[0];
  assert.deepEqual(Object.keys(s).sort(), ["id", "sourceStudyId"]);
});

test("a study missing StudyInstanceUID is skipped with a warning, never fabricated", async () => {
  const study = { "00080061": { vr: "CS", Value: ["CT"] } };   // no 0020000D
  const c = ctx({ fetch: async () => new Response(JSON.stringify([study]), { status: 200 }) });
  const raw = await dicomWebConnector.fetchPatient(c, "P1");
  const bundle = await dicomWebConnector.normalize(c, raw);
  assert.equal(bundle.imagingStudies.length, 0);
  assert.ok(bundle.meta.warnings.some((w) => w.includes("StudyInstanceUID")));
  assert.equal(validateBundle(bundle).ok, true);
});

test("a non-array response shape -> 0 studies + a warning, never invented, no throw; still a valid (empty) bundle", async () => {
  const fetchStub = async () => new Response(JSON.stringify({ studies: [STUDY_FULL] }), { status: 200 });
  const c = ctx({ fetch: fetchStub });
  const raw = await dicomWebConnector.fetchPatient(c, "P1");
  assert.deepEqual(raw.rows, []);
  assert.ok(raw.warnings.some((w) => w.includes("unrecognized response shape")));
  const bundle = await dicomWebConnector.normalize(c, raw);
  assert.equal(bundle.imagingStudies.length, 0);
  assert.equal(validateBundle(bundle).ok, true);
});

test("an empty bare array -> 0 studies, no shape warning", async () => {
  const c = ctx({ fetch: async () => new Response("[]", { status: 200 }) });
  const raw = await dicomWebConnector.fetchPatient(c, "P1");
  assert.deepEqual(raw.rows, []);
  assert.deepEqual(raw.warnings, []);
});

test("studies are capped at ctx.budget.maxRows with a truncation warning", async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ "0020000D": { vr: "UI", Value: ["1.2.3." + i] } }));
  const fetchStub = async () => new Response(JSON.stringify(many), { status: 200 });
  const c = ctx({ fetch: fetchStub, budget: { maxRows: 3 } });
  const raw = await dicomWebConnector.fetchPatient(c, "P1");
  assert.equal(raw.rows.length, 3);
  assert.ok(raw.warnings.some((w) => w.includes("truncated")));
});

test("a custom headerName sends the token under that header, not Authorization (Accept still set)", async () => {
  const fetchStub = async (url, init) => {
    assert.equal(init.headers["X-API-Key"], "tok-123");
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers.accept, "application/dicom+json");
    return new Response("[]");
  };
  const c = ctx({ fetch: fetchStub, config: { headerName: "X-API-Key" } });
  await dicomWebConnector.fetchPatient(c, "P1");
});

test("!res.ok -> typed UpstreamError", async () => {
  const c = ctx({ fetch: async () => new Response("nope", { status: 500 }) });
  await assert.rejects(() => dicomWebConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("a non-JSON response body -> typed UpstreamError, never an uncontrolled throw", async () => {
  const c = ctx({ fetch: async () => new Response("not json", { status: 200 }) });
  await assert.rejects(() => dicomWebConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("a bare rejecting fetch is wrapped in a typed UpstreamError (fail-closed, never uncontrolled)", async () => {
  const c = ctx({ fetch: async () => { throw new Error("network down"); } });
  await assert.rejects(() => dicomWebConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("an already-typed error (e.g. the onboard SSRF guard's OnboardError) from the fetch is re-thrown, NOT masked", async () => {
  const c = ctx({ fetch: async () => { throw new OnboardError("ssrf", "redirect target blocked"); } });
  await assert.rejects(() => dicomWebConnector.fetchPatient(c, "P1"), (e) => e instanceof OnboardError && e.klass === "ssrf");
});

test("capabilities + validate (unfiltered limited QIDO query)", async () => {
  const caps = await dicomWebConnector.capabilities();
  assert.deepEqual(caps.resources, ["ImagingStudy"]);
  assert.deepEqual(caps.authKinds, ["token"]);
  const c = ctx({ fetch: async (url) => { assert.match(String(url), /\/studies\?limit=1$/); return new Response("[]", { status: 200 }); } });
  const v = await dicomWebConnector.validate(c);
  assert.equal(v.ok, true);
});

test("NEVER emits a url/wadoUri/pixel/binary field, even when the raw study object carries one (metadata only)", async () => {
  const poisoned = Object.assign({}, STUDY_FULL, {
    wadoURL: "https://pacs.example.org/wado?requestType=WADO&studyUID=1.2.3",
    url: "https://evil.example.org/steal",
    pixelData: "base64-would-go-here",
  });
  const fetchStub = async () => new Response(JSON.stringify([poisoned]), { status: 200 });
  const c = ctx({ fetch: fetchStub });
  const raw = await dicomWebConnector.fetchPatient(c, "P1");
  const bundle = await dicomWebConnector.normalize(c, raw);
  const s = bundle.imagingStudies[0];
  for (const f of ["url", "wadoUri", "wadoUrl", "wadoRsRoot", "retrieveUrl", "pixelData", "binary", "attachment", "content", "contentUrl", "data"]) {
    assert.equal(f in s, false, "forbidden field '" + f + "' must never appear");
  }
  assert.equal(validateBundle(bundle).ok, true);
});
