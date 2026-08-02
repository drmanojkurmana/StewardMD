// test/connect/graphql/connector.test.mjs — the generic GraphQL pull connector: contract, fetchPatient+
// normalize round trip (resultsPath extraction AND a bare `data` array), a GraphQL `errors` array never
// invents rows, an unresolved resultsPath never invents rows, row-cap truncation, custom header auth, the
// query-variable-binding (no-injection) guarantee, and the fail-closed fetch idiom (typed UpstreamError on a
// bare rejection; an already-typed error such as the onboard SSRF guard's OnboardError is never masked).
import { test } from "node:test";
import assert from "node:assert/strict";
import { graphqlConnector } from "../../../functions/_connect/connectors/graphql/connector.js";
import { assertConnector } from "../../../functions/_connect/interfaces.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { UpstreamError } from "../../../functions/_connect/permission.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";

const QUERY = "query($patientId: ID!) { patientLabs(id: $patientId) { rows { patientId testCode testCodeSystem testName value unit orderId collectedAt resultStatus } } }";

const ctx = (over = {}) => ({
  tenant: { id: "t1" },
  now: () => new Date(0),
  config: Object.assign({ base_url: "https://labs.example.org", query: QUERY, resultsPath: "patientLabs.rows", patientVar: "patientId" }, over.config || {}),
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

test("graphqlConnector satisfies the pull-profile contract", () => {
  assert.doesNotThrow(() => assertConnector(graphqlConnector));
  assert.equal(graphqlConnector.meta.id, "graphql");
  assert.equal(graphqlConnector.meta.profile, "pull");
  assert.equal(graphqlConnector.meta.sccmVersion, "1.0");
});

test("fetchPatient+normalize round-trip (resultsPath extraction) -> valid SCCM bundle; the patient value is a BOUND variable, never interpolated into the query text", async () => {
  const fetchStub = async (url, init) => {
    assert.equal(String(url), "https://labs.example.org");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, "Bearer tok-123");
    assert.equal(init.headers["content-type"], "application/json");
    assert.equal(init.redirect, "manual");
    const body = JSON.parse(init.body);
    assert.equal(body.query, QUERY);                         // the query is sent VERBATIM, never rewritten
    assert.deepEqual(body.variables, { patientId: "P1" });    // patientRef travels ONLY as a bound variable
    assert.equal(body.query.includes("P1"), false);           // NEVER string-interpolated into the query
    return new Response(JSON.stringify({ data: { patientLabs: { rows: ROWS } } }), { status: 200 });
  };
  const c = ctx({ fetch: fetchStub });
  const raw = await graphqlConnector.fetchPatient(c, "P1");
  const bundle = await graphqlConnector.normalize(c, raw);
  assert.equal(validateBundle(bundle).ok, true);
  assert.equal(bundle.observations.length, 2);
  assert.equal(bundle.diagnosticReports.length, 1);       // both rows share orderId O1
  assert.equal(bundle.meta.sourceConnector, "graphql");
});

test("fetchPatient accepts a bare `data` array (no resultsPath) the same way as resultsPath extraction", async () => {
  const fetchStub = async () => new Response(JSON.stringify({ data: ROWS }), { status: 200 });
  const c = ctx({ fetch: fetchStub, config: { resultsPath: undefined } });
  const raw = await graphqlConnector.fetchPatient(c, "P1");
  assert.equal(raw.rows.length, 2);
  assert.equal(validateBundle(await graphqlConnector.normalize(c, raw)).ok, true);
});

test("a GraphQL `errors` array never invents rows -> 0 rows + a warning that counts them; still a valid (empty) bundle", async () => {
  const fetchStub = async () => new Response(JSON.stringify({ errors: [{ message: "patient not found upstream" }], data: null }), { status: 200 });
  const c = ctx({ fetch: fetchStub });
  const raw = await graphqlConnector.fetchPatient(c, "P1");
  assert.deepEqual(raw.rows, []);
  assert.ok(raw.warnings.some((w) => w.includes("graphql response reported errors; 0 rows read")));
  assert.ok(!raw.warnings.some((w) => w.includes("patient not found upstream")));   // server error text NEVER echoed
  assert.equal(validateBundle(await graphqlConnector.normalize(c, raw)).ok, true);
});

test("an unresolved resultsPath -> 0 rows + a warning, never invented rows; still a valid (empty) bundle", async () => {
  const fetchStub = async () => new Response(JSON.stringify({ data: { somethingElse: [] } }), { status: 200 });
  const c = ctx({ fetch: fetchStub });
  const raw = await graphqlConnector.fetchPatient(c, "P1");
  assert.deepEqual(raw.rows, []);
  assert.ok(raw.warnings.some((w) => w.includes("no array at resultsPath")));
  assert.equal(validateBundle(await graphqlConnector.normalize(c, raw)).ok, true);
});

test("rows are capped at ctx.budget.maxRows with a truncation warning", async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ patientId: "P1", testName: "T" + i, value: i, unit: "u" }));
  const fetchStub = async () => new Response(JSON.stringify({ data: many }), { status: 200 });
  const c = ctx({ fetch: fetchStub, config: { resultsPath: undefined }, budget: { maxRows: 3 } });
  const raw = await graphqlConnector.fetchPatient(c, "P1");
  assert.equal(raw.rows.length, 3);
  assert.ok(raw.warnings.some((w) => w.includes("truncated")));
});

test("a custom headerName sends the token under that header, not Authorization", async () => {
  const fetchStub = async (url, init) => { assert.equal(init.headers["X-API-Key"], "tok-123"); assert.equal(init.headers.authorization, undefined); return new Response(JSON.stringify({ data: [] })); };
  const c = ctx({ fetch: fetchStub, config: { headerName: "X-API-Key" } });
  await graphqlConnector.fetchPatient(c, "P1");
});

test("!res.ok -> typed UpstreamError", async () => {
  const c = ctx({ fetch: async () => new Response("nope", { status: 500 }) });
  await assert.rejects(() => graphqlConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("a non-JSON response body -> typed UpstreamError, never an uncontrolled throw", async () => {
  const c = ctx({ fetch: async () => new Response("not json", { status: 200 }) });
  await assert.rejects(() => graphqlConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("a bare rejecting fetch is wrapped in a typed UpstreamError (fail-closed, never uncontrolled)", async () => {
  const c = ctx({ fetch: async () => { throw new Error("network down"); } });
  await assert.rejects(() => graphqlConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("an already-typed error (e.g. the onboard SSRF guard's OnboardError) from the fetch is re-thrown, NOT masked", async () => {
  const c = ctx({ fetch: async () => { throw new OnboardError("ssrf", "redirect target blocked"); } });
  await assert.rejects(() => graphqlConnector.fetchPatient(c, "P1"), (e) => e instanceof OnboardError && e.klass === "ssrf");
});

test("capabilities + validate", async () => {
  const caps = await graphqlConnector.capabilities();
  assert.deepEqual(caps.resources, ["Patient", "Observation", "DiagnosticReport"]);
  assert.deepEqual(caps.authKinds, ["token"]);
  const c = ctx({ fetch: async (url, init) => { assert.equal(JSON.parse(init.body).query, "{ __typename }"); return new Response(JSON.stringify({ data: { __typename: "Query" } }), { status: 200 }); } });
  const v = await graphqlConnector.validate(c);
  assert.equal(v.ok, true);
});
