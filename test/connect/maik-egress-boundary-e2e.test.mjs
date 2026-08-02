// test/connect/maik-egress-boundary-e2e.test.mjs — D-F1: the REAL end-to-end egress boundary (no mocked pullLanes).
// Drives the actual chain pullLanes -> bridge.js -> loadPatientContext(engine.js) -> splitLanes(lanes.js) ->
// assertEgressAllowed(maik-context.js) against the adversarial mock FHIR server, and proves the real-PHI
// zero-egress property is enforced by the ENGINE's SANDBOX ALLOW-LIST + live-mode refusal — NOT by egressBaaOk
// (which short-circuits true for sandbox and is presently un-wired). The existing maik-egress-invariant test
// MOCKS pullLanes and hand-feeds {mode,egressBaaOk}, so it never guards the real boundary; THIS test does:
// a future real host on the allow-list, or baa_ok=1 on a live tenant, would open a leak and fail one of these.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pullLanes } from "../../functions/_connect/maik-bridge/bridge.js";
import { applyConnectContext } from "../../functions/_connect/maik-bridge/hook.js";
import { fhirR4Connector } from "../../functions/_connect/connectors/fhir-r4/connector.js";
import { makeSecrets } from "../../functions/_connect/secrets.js";
import { makeMockDb, makeMockKv } from "../../functions/_connect/testkit.js";
import { bindKey } from "../../functions/_connect/maik-bridge/attach.js";
import { SandboxViolation } from "../../functions/_connect/permission.js";
import { makeMockFhir } from "./smart/mock-fhir-server.mjs";
import { RS384_PRIVATE_JWK } from "./smart/fixtures/smart-keys.mjs";

const SCOPE = ["Patient", "Encounter", "Condition", "MedicationStatement", "Observation", "AllergyIntolerance", "DiagnosticReport", "DocumentReference"];
const SEC = { clientId: "cid", kid: RS384_PRIVATE_JWK.kid, alg: "RS384", privateKeyJwk: RS384_PRIVATE_JWK };
const FLAGS = { CONNECT_FLAG: "1", CONNECT_MAIK_FLAG: "1" };
// Synthetic markers the adversarial mock serves (synthResource). ONLY these may ever reach egress.
const SYNTH = ["Type 2 diabetes mellitus", "Metformin", "Penicillin", "HbA1c"];

async function baseEnv() {
  const env = { ...FLAGS, CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"), CONNECT_HMAC_SALT: "c2FsdA==", MAIK_KV: makeMockKv() };
  env.SMART_KEY_T1 = await makeSecrets(env).seal(JSON.stringify(SEC));
  return env;
}
function seedDb(mock, { mode = "sandbox", base } = {}) {
  return makeMockDb({
    connect_membership: [{ user_id: "u1", tenant_id: "t1", role: "clinician" }],
    connect_tenant: [{ id: "t1", mode, granted_scopes: JSON.stringify(SCOPE) }],
    // NOTE: connect_tenant_egress is deliberately NOT seeded -> egressBaaOk() returns false. Egress still opens
    // in sandbox mode, which is exactly the assurance point: the sandbox allow-list is the gate, not egressBaaOk.
    connect_connector_config: [{ tenant_id: "t1", connector_id: "fhir-r4", kind: "fhir-r4", profile: "pull", base_url: (base || mock.base) + "/fhir", config: JSON.stringify({ smart: {} }), secret_ref: "SMART_KEY_T1", scope: JSON.stringify(SCOPE) }],
  });
}
async function makeDeps(env, db) {
  const kv = makeMockKv();
  const sealed = await makeSecrets(env).seal(JSON.stringify({ tenantId: "t1", connectorId: "fhir-r4", patientRef: "P1" }));
  await kv.put(bindKey("u1"), sealed);                      // active MaiK-session binding for clinician u1
  return { db, kv, identifyFn: async () => ({ id: "u1", guest: false }), connectors: { "fhir-r4": fhirR4Connector } };
}

test("sandbox + allow-listed base_url: egress opens with ONLY synthetic data (via the real chain, egressBaaOk=false)", async () => {
  const env = await baseEnv();
  const mock = makeMockFhir();                              // base https://smart-mock.local (on SANDBOX_ALLOWLIST)
  const deps = await makeDeps(env, seedDb(mock));
  const lanes = await pullLanes(env, deps, {}, { fetch: mock.fetch });
  assert.ok(lanes && lanes.egress, "egress lane opened for a sandbox, allow-listed, synthetic bundle");
  const blob = JSON.stringify(lanes.egress);
  assert.ok(SYNTH.some((m) => blob.includes(m)), "the synthetic markers reached egress");
  // and the AI-endpoint hook folds that (and only that) into pkg.patientCase
  const pkg = { question: "q", grounding: [] };
  const r = await applyConnectContext(env, {}, pkg, { fetch: mock.fetch, deps });
  assert.equal(r.applied, true);
  assert.ok(SYNTH.some((m) => JSON.stringify(r.pkg.patientCase).includes(m)));
});

test("non-allow-listed base_url: blocked at the boundary (SandboxViolation); hook adds ZERO bytes", async () => {
  const env = await baseEnv();
  const mock = makeMockFhir();
  const deps = await makeDeps(env, seedDb(mock, { base: "https://evil.exfil.example" }));   // host not on the allow-list
  await assert.rejects(() => pullLanes(env, deps, {}, { fetch: mock.fetch }), SandboxViolation);
  const pkg = { question: "q", grounding: [] };
  const r = await applyConnectContext(env, {}, pkg, { fetch: mock.fetch, deps });            // fail-safe swallows it
  assert.equal(r.applied, false);
  assert.equal(r.pkg.patientCase, undefined);
});

test("live tenant: refused at the engine (assertSandboxAllowed) so no bundle ever reaches egress", async () => {
  const env = await baseEnv();
  const mock = makeMockFhir();
  const deps = await makeDeps(env, seedDb(mock, { mode: "live" }));    // allow-listed host but LIVE mode
  await assert.rejects(() => pullLanes(env, deps, {}, { fetch: mock.fetch }), SandboxViolation);
  const pkg = { question: "q", grounding: [] };
  const r = await applyConnectContext(env, {}, pkg, { fetch: mock.fetch, deps });
  assert.equal(r.applied, false);
  assert.equal(r.pkg.patientCase, undefined);
});

test("D-F2: a demoted actor (role lacks context:load) is denied at PULL time, sealed binding notwithstanding", async () => {
  const env = await baseEnv();
  const mock = makeMockFhir();
  const db = makeMockDb({
    connect_membership: [{ user_id: "u1", tenant_id: "t1", role: "auditor" }],   // demoted from clinician mid-session
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: JSON.stringify(SCOPE) }],
    connect_connector_config: [{ tenant_id: "t1", connector_id: "fhir-r4", kind: "fhir-r4", profile: "pull", base_url: mock.base + "/fhir", config: JSON.stringify({ smart: {} }), secret_ref: "SMART_KEY_T1", scope: JSON.stringify(SCOPE) }],
  });
  const deps = await makeDeps(env, db);                                // the 1h binding is still present in KV
  await assert.rejects(() => pullLanes(env, deps, {}, { fetch: mock.fetch }), /context:load/);
  const pkg = { question: "q", grounding: [] };
  const r = await applyConnectContext(env, {}, pkg, { fetch: mock.fetch, deps });
  assert.equal(r.applied, false);                                      // hook fail-safe -> nothing auto-pulled
  assert.equal(r.pkg.patientCase, undefined);
});
