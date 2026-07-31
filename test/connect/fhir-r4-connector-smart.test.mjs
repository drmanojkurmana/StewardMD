// test/connect/fhir-r4-connector-smart.test.mjs — Task 6: the SMART-wired pull connector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fhirR4Connector } from "../../functions/_connect/connectors/fhir-r4/connector.js";
import { assertConnector } from "../../functions/_connect/interfaces.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";
import { makeMockFhir } from "./smart/mock-fhir-server.mjs";
import { RS384_PRIVATE_JWK } from "./smart/fixtures/smart-keys.mjs";
import { makeSecrets } from "../../functions/_connect/secrets.js";
import { makeMockKv } from "../../functions/_connect/testkit.js";

const ENV = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(3)).toString("base64") };
const SEC = { clientId: "cid", kid: RS384_PRIVATE_JWK.kid, alg: "RS384", privateKeyJwk: RS384_PRIVATE_JWK };
const ALL = ["Encounter", "Condition", "MedicationRequest", "MedicationStatement", "Observation", "AllergyIntolerance", "DiagnosticReport", "DocumentReference"];

function ctxFor(mock, scope = ALL) {
  return { tenant: { id: "t1", mode: "sandbox", settings: {} }, config: { base_url: mock.base + "/fhir", config: JSON.stringify({ smart: {} }), secret_ref: "x", connector_id: "fhir-r4" }, scope,
    kv: makeMockKv(), secrets: async (n) => (n === "smart" ? SEC : null), envelope: makeSecrets(ENV), now: () => new Date(), fetch: mock.fetch, logger: { warn() {}, error() {} }, budget: { maxSubrequests: 30, deadlineMs: 8000, maxPagesPerResource: 10 } };
}

test("connector contract is well-formed (assertConnector)", () => { assert.doesNotThrow(() => assertConnector(fhirR4Connector)); });

test("authenticate acquires a SMART token; validate ok; capabilities include MedicationRequest", async () => {
  const mock = makeMockFhir(); const ctx = ctxFor(mock);
  const a = await fhirR4Connector.authenticate(ctx);
  assert.match(a.token, /^mock-access-/);
  assert.equal((await fhirR4Connector.validate(ctx)).ok, true);
  assert.ok((await fhirR4Connector.capabilities(ctx)).resources.includes("MedicationRequest"));
});

test("fetchPatient pulls Patient + in-scope families incl MedicationRequest; normalize -> valid SCCM", async () => {
  const mock = makeMockFhir(); const ctx = ctxFor(mock);
  const raw = await fhirR4Connector.fetchPatient(ctx, "P1");
  assert.equal(raw.patient.id, "P1");
  assert.ok(raw.resources.some((r) => r.resourceType === "MedicationRequest"));
  const bundle = await fhirR4Connector.normalize(ctx, raw);
  assert.equal(validateBundle(bundle).ok, true);
  assert.ok(bundle.medications.some((m) => m.origin === "order"));   // MedicationRequest -> order
});

test("scope excluding Observation -> no Observation fetched (least privilege)", async () => {
  const mock = makeMockFhir(); const ctx = ctxFor(mock, ["Condition"]);
  await fhirR4Connector.fetchPatient(ctx, "P1");
  assert.equal(mock.calls.some((c) => c.path.includes("/Observation")), false);
});

test("revoke-then-reissue (first Patient read 401) -> one re-auth + success", async () => {
  const mock = makeMockFhir({ revokeThenReissue: true }); const ctx = ctxFor(mock, ["Condition"]);
  const raw = await fhirR4Connector.fetchPatient(ctx, "P1");
  assert.equal(raw.patient.id, "P1");
  assert.ok(mock.calls.filter((c) => c.method === "POST").length >= 2);   // re-auth happened
});

test("validate returns ok:false when discovery is poisoned (auth fails closed)", async () => {
  const mock = makeMockFhir({ poisonDiscovery: true }); const ctx = ctxFor(mock);
  assert.equal((await fhirR4Connector.validate(ctx)).ok, false);
});
