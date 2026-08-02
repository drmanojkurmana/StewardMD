// test/connect/fhir-r4-patient-search.test.mjs — P2 patient search: connector FHIR parse + router gates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fhirR4Connector } from "../../functions/_connect/connectors/fhir-r4/connector.js";
import { onRequest } from "../../functions/api/connect/[[path]].js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

function ctx(fetchImpl) {
  return { config: { base_url: "https://fhir.example/r4" }, scope: ["Patient"], fetch: fetchImpl, secrets: async () => null, budget: { maxSubrequests: 20 }, now: () => new Date(0), kv: null, logger: { warn() {}, error() {} } };
}
const searchset = (patients) => ({ resourceType: "Bundle", type: "searchset", entry: patients.map((p) => ({ resource: p })) });
const resp = (status, json) => ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(json) });

test("fhir-r4 searchPatients: builds Patient?name= and maps entries (text | given+family)", async () => {
  let seen = null;
  const out = await fhirR4Connector.searchPatients(ctx((url) => { seen = url; return Promise.resolve(resp(200, searchset([
    { resourceType: "Patient", id: "p1", name: [{ given: ["John"], family: "Smith" }], gender: "male", birthDate: "1970-01-01" },
    { resourceType: "Patient", id: "p2", name: [{ text: "Asha Rao" }], gender: "female" },
    { resourceType: "Observation", id: "o1" },   // non-Patient entries filtered out
  ]))); }), "smith");
  assert.match(seen, /\/Patient\?name=smith&_count=\d+$/);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: "p1", name: "John Smith", gender: "male", birthDate: "1970-01-01" });
  assert.deepEqual(out[1], { id: "p2", name: "Asha Rao", gender: "female", birthDate: "" });
});

test("fhir-r4 searchPatients: empty query returns [] without any fetch", async () => {
  let called = false;
  const out = await fhirR4Connector.searchPatients(ctx(() => { called = true; return Promise.resolve(resp(200, searchset([]))); }), "   ");
  assert.deepEqual(out, []);
  assert.equal(called, false);
});

test("fhir-r4 searchPatients: a non-OK upstream is a typed UpstreamError", async () => {
  await assert.rejects(fhirR4Connector.searchPatients(ctx(() => Promise.resolve(resp(500, {}))), "x"), /HTTP 500/);
});

// --- router gates (parallel to /context) ---
const post = (path, body, env, headers) => ({ request: new Request("https://x" + path, { method: "POST", body: JSON.stringify(body), headers: Object.assign({ "content-type": "application/json" }, headers || {}) }), env, params: {} });

test("POST /patients/search: unauthenticated -> 401 (route live + gated, no cross-tenant read)", async () => {
  const env = { CONNECT_FLAG: "1", CONNECT_FHIR_FLAG: "1", CONNECT_DB: makeMockDb({}) };
  const res = await onRequest(post("/api/connect/patients/search", { tenantId: "t1", query: "smith", connectorId: "fhir-r4" }, env));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "auth");
});

test("POST /patients/search: fhir flag OFF -> 404 (no existence leak)", async () => {
  const env = { CONNECT_FLAG: "1", CONNECT_DB: makeMockDb({}) };   // no CONNECT_FHIR_FLAG
  const res = await onRequest(post("/api/connect/patients/search", { tenantId: "t1", query: "smith", connectorId: "fhir-r4" }, env));
  assert.equal(res.status, 404);
});
