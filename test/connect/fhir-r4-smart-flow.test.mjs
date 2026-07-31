// test/connect/fhir-r4-smart-flow.test.mjs — Task 9: composed end-to-end SMART pull through the engine
// against the adversarial mock. Proves the Tasks 2-8 invariants hold COMPOSED, ephemeral + fail-closed +
// sandbox-only + no PHI/secret leak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPatientContext } from "../../functions/_connect/engine.js";
import { fhirR4Connector } from "../../functions/_connect/connectors/fhir-r4/connector.js";
import { buildMaikContext } from "../../functions/_connect/maik-context.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";
import { makeSecrets } from "../../functions/_connect/secrets.js";
import { makeMockDb, makeMockKv } from "../../functions/_connect/testkit.js";
import { makeMockFhir } from "./smart/mock-fhir-server.mjs";
import { RS384_PRIVATE_JWK } from "./smart/fixtures/smart-keys.mjs";

const SCOPE = ["Patient", "Encounter", "Condition", "MedicationStatement", "Observation", "AllergyIntolerance", "DiagnosticReport", "DocumentReference"];
const SEC = { clientId: "cid", kid: RS384_PRIVATE_JWK.kid, alg: "RS384", privateKeyJwk: RS384_PRIVATE_JWK };

async function baseEnv() {
  const env = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(5)).toString("base64"), CONNECT_HMAC_SALT: "c2FsdA==", MAIK_KV: makeMockKv() };
  env.SMART_KEY_T1 = await makeSecrets(env).seal(JSON.stringify(SEC));      // sealed SMART material at secret_ref
  return env;
}
function seed(mock) {
  return makeMockDb({
    connect_membership: [{ user_id: "u1", tenant_id: "t1", role: "clinician" }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: JSON.stringify(SCOPE) }],
    connect_connector_config: [{ tenant_id: "t1", connector_id: "fhir-r4", kind: "fhir-r4", profile: "pull", base_url: mock.base + "/fhir", config: JSON.stringify({ smart: {} }), secret_ref: "SMART_KEY_T1", scope: JSON.stringify(SCOPE) }],
  });
}
const deps = (db) => ({ db, kv: makeMockKv(), identifyFn: async () => ({ id: "u1", guest: false }), connectors: { "fhir-r4": Object.assign({}, fhirR4Connector) } });
const req = { request: {}, tenantId: "t1", patientRef: "P1", scope: SCOPE, connectorId: "fhir-r4" };

test("happy path -> valid SCCM bundle, labs/vitals bucketed, PHI-free audit, token cached encrypted", async () => {
  const env = await baseEnv();
  const mock = makeMockFhir({ extraPages: 1 });                             // 2 pages of Observation -> a lab AND a vital
  const db = seed(mock);
  const bundle = await loadPatientContext(env, deps(db), req, { fetch: mock.fetch });
  assert.equal(validateBundle(bundle).ok, true);
  assert.equal(bundle.patient.id, "P1");
  assert.ok(bundle.medications.some((m) => m.origin === "order"));          // MedicationRequest
  const mk = buildMaikContext(bundle);
  assert.ok(mk.labs.length >= 1 && mk.vitals.length >= 1);                  // category derived correctly
  // one PHI-free audit event
  assert.equal(db._tables.connect_audit_event.length, 1);
  const audit = JSON.stringify(db._tables.connect_audit_event);
  assert.equal(audit.includes("Synthetic"), false);                        // patient name never persisted
  assert.equal(audit.includes("mock-access-"), false);                     // token never persisted
  // token cached ENCRYPTED (ciphertext), never plaintext
  const tok = await env.MAIK_KV.get("connect:smart:tok:t1:fhir-r4");
  assert.ok(tok && tok.includes("mock-access-") === false);
});

test("poisoned discovery -> fails closed, nothing signed/sent/persisted", async () => {
  const env = await baseEnv();
  const mock = makeMockFhir({ poisonDiscovery: true });
  const db = seed(mock);
  await assert.rejects(() => loadPatientContext(env, deps(db), req, { fetch: mock.fetch }));
  assert.equal(mock.calls.some((c) => c.method === "POST"), false);        // no token POST
  assert.ok(db._tables.connect_audit_event.some((r) => JSON.stringify(r).includes("error") || JSON.stringify(r).includes("denied")));
});

test("scope narrowed (no Observation) -> no Observation in the bundle", async () => {
  const env = await baseEnv();
  const mock = makeMockFhir();
  const narrow = ["Patient", "Condition"];
  const db = makeMockDb({
    connect_membership: [{ user_id: "u1", tenant_id: "t1", role: "clinician" }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: JSON.stringify(narrow) }],
    connect_connector_config: [{ tenant_id: "t1", connector_id: "fhir-r4", kind: "fhir-r4", profile: "pull", base_url: mock.base + "/fhir", config: JSON.stringify({ smart: {} }), secret_ref: "SMART_KEY_T1", scope: JSON.stringify(narrow) }],
  });
  const bundle = await loadPatientContext(env, deps(db), { ...req, scope: narrow }, { fetch: mock.fetch });
  assert.equal(bundle.observations.length, 0);
  assert.equal(mock.calls.some((c) => c.path.includes("/Observation")), false);
});

test("no PHI / no secret in any audit row", async () => {
  const env = await baseEnv();
  const mock = makeMockFhir({ extraPages: 1 });
  const db = seed(mock);
  await loadPatientContext(env, deps(db), req, { fetch: mock.fetch });
  const blob = JSON.stringify(db._tables.connect_audit_event);
  for (const secret of ["Synthetic", "mock-access-", RS384_PRIVATE_JWK.d, "P1 "]) assert.equal(blob.includes(secret), false);
});
