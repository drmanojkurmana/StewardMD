// test/connect/rest-json/connector.test.mjs — the generic REST/JSON pull connector: contract, fetchPatient+
// normalize round trip (bare array AND {results:[...]}), malformed/empty/unrecognized shapes never invent
// rows, row-cap truncation, custom header auth, and the fail-closed fetch idiom (typed UpstreamError on a
// bare rejection; an already-typed error such as the onboard SSRF guard's OnboardError is never masked).
import { test } from "node:test";
import assert from "node:assert/strict";
import { restJsonConnector } from "../../../functions/_connect/connectors/rest-json/connector.js";
import { assertConnector } from "../../../functions/_connect/interfaces.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { UpstreamError } from "../../../functions/_connect/permission.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";

const ctx = (over = {}) => ({
  tenant: { id: "t1" },
  now: () => new Date(0),
  config: Object.assign({ base_url: "https://labs.example.org", resultsPath: "/results", patientParam: "patientId" }, over.config || {}),
  secrets: over.secrets || (async (name) => (name === "bearer" ? "tok-123" : null)),
  fetch: over.fetch,
  budget: over.budget || { maxRows: 50000 },
  logger: { warn() {}, error() {} },
});

// Canonical-named keys so the REUSED inferColumnMap (csv-upload.js) auto-detects them, same as a plain CSV.
const ROWS = [
  { patientId: "P1", testCode: "718-7", testCodeSystem: "LN", testName: "Hemoglobin", value: 9.2, unit: "g/dL", orderId: "O1", collectedAt: "2026-08-01", resultStatus: "final" },
  { patientId: "P1", testCode: "2160-0", testCodeSystem: "LN", testName: "Creatinine", value: 1.1, unit: "mg/dL", orderId: "O1", collectedAt: "2026-08-01", resultStatus: "final" },
];

test("restJsonConnector satisfies the pull-profile contract", () => {
  assert.doesNotThrow(() => assertConnector(restJsonConnector));
  assert.equal(restJsonConnector.meta.id, "rest-json");
  assert.equal(restJsonConnector.meta.profile, "pull");
  assert.equal(restJsonConnector.meta.sccmVersion, "1.0");
});

test("fetchPatient+normalize round-trip (bare array) -> valid SCCM bundle; auth header + url are correct", async () => {
  const fetchStub = async (url, init) => {
    assert.match(String(url), /\/results\?patientId=P1$/);
    assert.equal(init.headers.authorization, "Bearer tok-123");
    assert.equal(init.redirect, "manual");
    return new Response(JSON.stringify(ROWS), { status: 200 });
  };
  const c = ctx({ fetch: fetchStub });
  const raw = await restJsonConnector.fetchPatient(c, "P1");
  const bundle = await restJsonConnector.normalize(c, raw);
  assert.equal(validateBundle(bundle).ok, true);
  assert.equal(bundle.observations.length, 2);
  assert.equal(bundle.diagnosticReports.length, 1);       // both rows share orderId O1
  assert.equal(bundle.meta.sourceConnector, "rest-json");
});

test("fetchPatient accepts {results:[...]} the same way as a bare array", async () => {
  const fetchStub = async () => new Response(JSON.stringify({ results: ROWS }), { status: 200 });
  const c = ctx({ fetch: fetchStub });
  const raw = await restJsonConnector.fetchPatient(c, "P1");
  assert.equal(raw.rows.length, 2);
  assert.equal(validateBundle(await restJsonConnector.normalize(c, raw)).ok, true);
});

test("an unrecognized response shape -> 0 rows + a warning, never invented rows; still a valid (empty) bundle", async () => {
  const fetchStub = async () => new Response(JSON.stringify({ notRows: 1 }), { status: 200 });
  const c = ctx({ fetch: fetchStub });
  const raw = await restJsonConnector.fetchPatient(c, "P1");
  assert.deepEqual(raw.rows, []);
  assert.ok(raw.warnings.some((w) => w.includes("unrecognized response shape")));
  assert.equal(validateBundle(await restJsonConnector.normalize(c, raw)).ok, true);
});

test("an empty bare array -> 0 rows, no shape warning", async () => {
  const fetchStub = async () => new Response("[]", { status: 200 });
  const c = ctx({ fetch: fetchStub });
  const raw = await restJsonConnector.fetchPatient(c, "P1");
  assert.deepEqual(raw.rows, []);
  assert.deepEqual(raw.warnings, []);
  assert.equal(validateBundle(await restJsonConnector.normalize(c, raw)).ok, true);
});

test("rows are capped at ctx.budget.maxRows with a truncation warning", async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ patientId: "P1", testName: "T" + i, value: i, unit: "u" }));
  const fetchStub = async () => new Response(JSON.stringify(many), { status: 200 });
  const c = ctx({ fetch: fetchStub, budget: { maxRows: 3 } });
  const raw = await restJsonConnector.fetchPatient(c, "P1");
  assert.equal(raw.rows.length, 3);
  assert.ok(raw.warnings.some((w) => w.includes("truncated")));
});

test("a custom headerName sends the token under that header, not Authorization", async () => {
  const fetchStub = async (url, init) => { assert.equal(init.headers["X-API-Key"], "tok-123"); assert.equal(init.headers.authorization, undefined); return new Response("[]"); };
  const c = ctx({ fetch: fetchStub, config: { headerName: "X-API-Key" } });
  await restJsonConnector.fetchPatient(c, "P1");
});

test("!res.ok -> typed UpstreamError", async () => {
  const c = ctx({ fetch: async () => new Response("nope", { status: 500 }) });
  await assert.rejects(() => restJsonConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("a non-JSON response body -> typed UpstreamError, never an uncontrolled throw", async () => {
  const c = ctx({ fetch: async () => new Response("not json", { status: 200 }) });
  await assert.rejects(() => restJsonConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("a bare rejecting fetch is wrapped in a typed UpstreamError (fail-closed, never uncontrolled)", async () => {
  const c = ctx({ fetch: async () => { throw new Error("network down"); } });
  await assert.rejects(() => restJsonConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("an already-typed error (e.g. the onboard SSRF guard's OnboardError) from the fetch is re-thrown, NOT masked", async () => {
  const c = ctx({ fetch: async () => { throw new OnboardError("ssrf", "redirect target blocked"); } });
  await assert.rejects(() => restJsonConnector.fetchPatient(c, "P1"), (e) => e instanceof OnboardError && e.klass === "ssrf");
});

test("capabilities + validate", async () => {
  const caps = await restJsonConnector.capabilities();
  assert.deepEqual(caps.resources, ["Patient", "Observation", "DiagnosticReport"]);
  assert.deepEqual(caps.authKinds, ["token"]);
  const c = ctx({ fetch: async () => new Response("[]", { status: 200 }) });
  const v = await restJsonConnector.validate(c);
  assert.equal(v.ok, true);
});
