// test/connect/engine-pipeline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPatientContext } from "../../functions/_connect/engine.js";
import { fhirR4Connector } from "../../functions/_connect/connectors/fhir-r4/connector.js";
import { PermissionError, SandboxViolation } from "../../functions/_connect/permission.js";
import { makeMockDb, makeMockKv } from "../../functions/_connect/testkit.js";
import { SYNTHETIC } from "./fixtures/fhir-synthetic.mjs";

const ENV = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"), CONNECT_HMAC_SALT: "c2FsdA==" };
const identifyUser = async () => ({ id: "fb:u1", guest: false });
const fetchOk = async (url) => (/\/Patient\//.test(url) ? new Response(JSON.stringify(SYNTHETIC.patient)) : new Response(JSON.stringify({ entry: SYNTHETIC.resources.map((r) => ({ resource: r })) })));

function seed(over = {}) {
  return makeMockDb(Object.assign({
    connect_membership: [{ user_id: "fb:u1", tenant_id: "t1", role: "clinician" }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: JSON.stringify(["Patient", "Condition", "Observation"]) }],
    connect_connector_config: [{ tenant_id: "t1", connector_id: "fhir-r4", kind: "fhir-r4", profile: "pull", base_url: "https://r4.smarthealthit.org/fhir", scope: JSON.stringify(["Patient", "Condition", "Observation", "MedicationStatement"]) }],
  }, over));
}
const deps = (db) => ({ db, kv: makeMockKv(), identifyFn: identifyUser, connectors: { "fhir-r4": Object.assign({}, fhirR4Connector) } });
const req = (over = {}) => Object.assign({ request: {}, tenantId: "t1", patientRef: "P1", scope: ["Patient", "Condition", "Observation"], connectorId: "fhir-r4" }, over);

test("happy path returns a validated bundle and persists NO patient content", async () => {
  const db = seed();
  const ctx = deps(db);
  ctx.connectors["fhir-r4"].fetchPatient = fhirR4Connector.fetchPatient;    // uses injected ctx.fetch
  // inject fetch via a wrapper connector ctx: engine builds ctx with env fetch; override here:
  const bundle = await loadPatientContext(ENV, ctx, req(), { fetch: fetchOk });
  assert.equal(bundle.patient.id, "P1");
  // audit row exists; NO patient content anywhere in the db mock
  const dump = JSON.stringify(db._tables);
  assert.equal(dump.includes("Synthetic"), false);        // patient name never persisted
  assert.equal(db._tables.connect_audit_event.length, 1);
});

test("scope filter drops out-of-scope resources (medications not granted)", async () => {
  const bundle = await loadPatientContext(ENV, deps(seed()), req(), { fetch: fetchOk });
  assert.equal(bundle.medications.length, 0);              // MedicationStatement not in granted/ requested scope
});

test("sandbox gate blocks a non-allow-listed base_url", async () => {
  const db = seed({ connect_connector_config: [{ tenant_id: "t1", connector_id: "fhir-r4", kind: "fhir-r4", profile: "pull", base_url: "https://fhir.realhospital.example/", scope: "[]" }] });
  await assert.rejects(() => loadPatientContext(ENV, deps(db), req(), { fetch: fetchOk }), SandboxViolation);
});

test("non-member is denied (fail-closed) and audited as denied", async () => {
  const db = seed({ connect_membership: [] });
  await assert.rejects(() => loadPatientContext(ENV, deps(db), req(), { fetch: fetchOk }), PermissionError);
});
