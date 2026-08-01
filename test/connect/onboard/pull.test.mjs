// test/connect/onboard/pull.test.mjs — pull -> fhir-r4 connector (REUSED, bearer mode) -> normalize to SCCM
// -> validate. PHI-free audit. Against a PUBLIC host (SSRF-allowed) using the adversarial mock FHIR server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { saveConnection } from "../../../functions/_connect/onboard/store.js";
import { pullConnection } from "../../../functions/_connect/onboard/pull.js";
import { makeOnboardDb } from "./onboard-db.mjs";
import { makeMockFhir } from "../smart/mock-fhir-server.mjs";

const env = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(3)).toString("base64"), CONNECT_HMAC_SALT: "c2FsdA==" };
const seedDb = (role = "admin") => makeOnboardDb({
  connect_membership: [{ user_id: "u1", tenant_id: "t1", role }],
  connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
});
const req = {};
// token == the value the mock's data endpoints require ("Bearer mock-access-1"), so the reused connector
// (which sends Authorization: Bearer <token>) authenticates against the mock.
const bodyFor = (mock) => ({ name: "Public FHIR", type: "fhir", fhirBaseUrl: mock.base, auth: { method: "token", token: "mock-access-1" } });

test("pull returns a valid SCCM bundle (labs/vitals/meds) and writes a PHI-free audit row", async () => {
  const mock = makeMockFhir({ base: "https://fhir.example.org", extraPages: 1 });
  const db = seedDb();
  const deps = { db, kv: makeMockKv(), secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }), fetch: mock.fetch, now: () => Date.now() };
  const { connectionId } = await saveConnection(deps, req, env, "t1", bodyFor(mock));

  const bundle = await pullConnection(deps, req, env, "t1", connectionId, "P1");
  assert.equal(validateBundle(bundle).ok, true);
  assert.equal(bundle.patient.id, "P1");
  assert.ok(bundle.medications.some((m) => m.origin === "order"));   // MedicationRequest normalized
  assert.ok(bundle.observations.length >= 1);

  const auditRows = db._tables.connect_audit_event || [];
  assert.ok(auditRows.some((r) => r.action === "connect.onboard.pulled"));
  const blob = JSON.stringify(auditRows);
  for (const secret of ["Synthetic", "mock-access-", "fhir.example.org"]) assert.equal(blob.includes(secret), false);
  assert.equal(blob.includes("P1"), false);                          // raw patientId never persisted (hashed)
});

// --- rest-json: the same pull.js path, reused per the row's stored kind ---------------------------------
test("a saved rest-json connection pulls through a mocked safe fetch -> valid SCCM bundle; token never in the audit", async () => {
  const ROWS = [{ patientId: "P1", testCode: "718-7", testCodeSystem: "LN", testName: "Hemoglobin", value: 9.2, unit: "g/dL", orderId: "O1", collectedAt: "2026-08-01", resultStatus: "final" }];
  const restFetch = async (url, init) => {
    assert.match(String(url), /\/results\?patientId=P1$/);
    assert.equal(init.headers.authorization, "Bearer rest-tok-1");
    return new Response(JSON.stringify(ROWS), { status: 200 });
  };
  const db = seedDb();
  const deps = { db, kv: makeMockKv(), secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }), fetch: restFetch, now: () => Date.now() };
  const { connectionId } = await saveConnection(deps, req, env, "t1",
    { name: "Lab API", type: "rest-json", baseUrl: "https://labs.example.org", auth: { method: "token", token: "rest-tok-1" } });

  const bundle = await pullConnection(deps, req, env, "t1", connectionId, "P1");
  assert.equal(validateBundle(bundle).ok, true);
  assert.equal(bundle.observations.length, 1);
  assert.equal(bundle.meta.sourceConnector, "rest-json");

  const auditRows = db._tables.connect_audit_event || [];
  assert.ok(auditRows.some((r) => r.action === "connect.onboard.pulled"));
  const blob = JSON.stringify(auditRows);
  for (const secret of ["rest-tok-1", "labs.example.org"]) assert.equal(blob.includes(secret), false);
  assert.equal(blob.includes("P1"), false);      // raw patientId never persisted (hashed)
});

test("pull is denied for an auditor (PHI is not for the auditor role)", async () => {
  const mock = makeMockFhir({ base: "https://fhir.example.org" });
  const db = seedDb("auditor");
  const deps = { db, kv: makeMockKv(), secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }), fetch: mock.fetch, now: () => Date.now() };
  // an auditor can't even save (connector:write); seed the row directly so we isolate the pull gate.
  await db.prepare("INSERT INTO connect_connector_config (tenant_id,connector_id,kind,profile,base_url,config,secret_ref,scope,status) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind("t1", "c1", "fhir-r4", "pull", "https://fhir.example.org",
      JSON.stringify({ source: "onboard", authMethod: "token", sealed: await makeSecrets(env).seal(JSON.stringify({ token: "mock-access-1" })) }),
      null, "[]", "draft").run();
  await assert.rejects(() => pullConnection(deps, req, env, "t1", "c1", "P1"));   // PermissionError
});
