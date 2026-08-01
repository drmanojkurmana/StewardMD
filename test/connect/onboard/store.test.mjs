// test/connect/onboard/store.test.mjs — save/list/delete CRUD: envelope round-trip, secrets never leak,
// SSRF reject at save, RBAC gate, delete erases the sealed credential.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { saveConnection, listConnections, deleteConnection, getRow } from "../../../functions/_connect/onboard/store.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const MASTER = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");
const env = { CONNECT_MASTER_KEY: MASTER };
const seedDb = (role = "admin") => makeOnboardDb({
  connect_membership: [{ user_id: "u1", tenant_id: "t1", role }],
  connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
});
const deps = (db) => ({ db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }) });
const req = {};
const tokenBody = { name: "GIMSR EMR", type: "fhir", fhirBaseUrl: "https://fhir.example.org/r4", auth: { method: "token", token: "sekret-bearer-123" } };

test("save envelope-seals the credential and stores an onboard row; returns a connectionId", async () => {
  const db = seedDb();
  const res = await saveConnection(deps(db), req, env, "t1", tokenBody);
  assert.equal(res.ok, true);
  assert.ok(res.connectionId && typeof res.connectionId === "string");
  const rows = db._tables.connect_connector_config;
  assert.equal(rows.length, 1);
  const stored = JSON.stringify(rows[0]);
  assert.equal(stored.includes("sekret-bearer-123"), false);       // raw token NEVER stored in the clear
  const config = JSON.parse(rows[0].config);
  assert.ok(config.sealed && !config.sealed.includes("sekret-bearer-123"));
  assert.equal(config.source, "onboard");
  // round-trip: the sealed blob decrypts back to the token
  const creds = JSON.parse(await makeSecrets(env).open(config.sealed));
  assert.equal(creds.token, "sekret-bearer-123");
});

test("save SSRF-rejects a private/loopback base URL", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...tokenBody, fhirBaseUrl: "https://169.254.169.254/fhir" }),
    (e) => e instanceof OnboardError && e.klass === "bad-url");
  assert.equal((db._tables.connect_connector_config || []).length, 0);   // nothing persisted
});

test("save rejects an unknown auth method and a non-fhir type", async () => {
  const db = seedDb();
  await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...tokenBody, auth: { method: "basic", token: "x" } }), (e) => e.klass === "invalid");
  await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...tokenBody, type: "hl7" }), (e) => e.klass === "invalid");
});

test("list returns the tenant's connections and NEVER any secret material", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", tokenBody);
  const list = await listConnections(deps(db), req, env, "t1");
  assert.equal(list.length, 1);
  const c = list[0];
  assert.equal(c.connectionId, connectionId);
  assert.equal(c.name, "GIMSR EMR");
  assert.equal(c.fhirBaseUrl, "https://fhir.example.org/r4");
  assert.equal(c.authMethod, "token");
  const blob = JSON.stringify(list);
  // "token" legitimately appears as the authMethod value; assert the SECRET material never leaks.
  for (const s of ["sekret-bearer-123", "sealed", "privateKeyJwk"]) assert.equal(blob.includes(s), false);
});

test("delete removes the row and erases the sealed credential", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", tokenBody);
  assert.equal(db._tables.connect_connector_config.length, 1);
  const res = await deleteConnection(deps(db), req, env, "t1", connectionId);
  assert.equal(res.ok, true);
  assert.equal(db._tables.connect_connector_config.length, 0);       // sealed cred gone with the row
  await assert.rejects(() => getRow(db, "t1", connectionId), (e) => e.klass === "not-found");
});

test("delete of a missing connection is a not-found", async () => {
  const db = seedDb();
  await assert.rejects(() => deleteConnection(deps(db), req, env, "t1", "does-not-exist"), (e) => e.klass === "not-found");
});

test("a non-member actor is denied (fail-closed RBAC, not a leak)", async () => {
  const db = seedDb();
  const otherDeps = { db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "intruder", guest: false }) };
  await assert.rejects(() => saveConnection(otherDeps, req, env, "t1", tokenBody));   // PermissionError
});

// --- rest-json (generic REST/JSON lab-results pull connector) ------------------------------------------------
const restBody = { name: "Lab API", type: "rest-json", baseUrl: "https://labs.example.org", auth: { method: "token", token: "sekret-rest-456" } };

test("save accepts type 'rest-json' with auth.method 'token'; envelope-seals the credential", async () => {
  const db = seedDb();
  const res = await saveConnection(deps(db), req, env, "t1", restBody);
  assert.equal(res.ok, true);
  const rows = db._tables.connect_connector_config;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "rest-json");
  assert.equal(rows[0].profile, "pull");
  const config = JSON.parse(rows[0].config);
  assert.equal(config.type, "rest-json");
  assert.equal(JSON.parse(rows[0].scope).join(","), "Patient,Observation,DiagnosticReport");
  const stored = JSON.stringify(rows[0]);
  assert.equal(stored.includes("sekret-rest-456"), false);           // raw token NEVER stored in the clear
  const creds = JSON.parse(await makeSecrets(env).open(config.sealed));
  assert.equal(creds.token, "sekret-rest-456");                      // round-trip
});

test("save rejects auth.method 'smart' for type 'rest-json' (token-only)", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...restBody, auth: { method: "smart", clientId: "cid" } }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("save SSRF-rejects a private/loopback baseUrl for type 'rest-json'", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...restBody, baseUrl: "https://169.254.169.254/labs" }),
    (e) => e instanceof OnboardError && e.klass === "bad-url");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("list surfaces rest-json connections (resultsPath/patientParam) and never secret material", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", { ...restBody, resultsPath: "/api/labs", patientParam: "mrn" });
  const list = await listConnections(deps(db), req, env, "t1");
  assert.equal(list.length, 1);
  assert.equal(list[0].connectionId, connectionId);
  assert.equal(list[0].type, "rest-json");
  assert.equal(list[0].resultsPath, "/api/labs");
  assert.equal(list[0].patientParam, "mrn");
  assert.equal(JSON.stringify(list).includes("sekret-rest-456"), false);
});

test("save SHAPE-validates rest-json request-shaping fields (no fragment/query/host-pivot/header-injection)", async () => {
  const db = seedDb();
  // Important: a '#' in resultsPath makes the patient-scoping query a URL fragment (never sent on the wire) ->
  // a silent unfiltered/all-patient fetch. Minor: a ':port' or non-'/' path pivots the host. Both fail closed.
  for (const bad of ["/results#dummy", ":8080/internal", "results", "/a b", "/x?y=1", "/@evil.com"]) {
    await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...restBody, resultsPath: bad }),
      (e) => e instanceof OnboardError && e.klass === "invalid", "resultsPath '" + bad + "' must be rejected");
  }
  await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...restBody, patientParam: "x&admin=true" }), (e) => e.klass === "invalid");
  await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...restBody, headerName: "X-Bad\r\nEvil: 1" }), (e) => e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);   // nothing was persisted
  const ok = await saveConnection(deps(db), req, env, "t1", { ...restBody, resultsPath: "/api/v2/results", patientParam: "mrn_id" });
  assert.ok(ok.connectionId);                                            // a clean absolute path + simple param name is accepted
});

// --- dicomweb (DICOMweb QIDO-RS imaging-metadata pull connector) --------------------------------------------
const dicomBody = { name: "Hospital PACS", type: "dicomweb", baseUrl: "https://pacs.example.org/dicom-web", auth: { method: "token", token: "sekret-dicom-789" } };

test("save accepts type 'dicomweb' with auth.method 'token'; envelope-seals the credential", async () => {
  const db = seedDb();
  const res = await saveConnection(deps(db), req, env, "t1", dicomBody);
  assert.equal(res.ok, true);
  const rows = db._tables.connect_connector_config;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "dicomweb");
  assert.equal(rows[0].profile, "pull");
  const config = JSON.parse(rows[0].config);
  assert.equal(config.type, "dicomweb");
  assert.equal(JSON.parse(rows[0].scope).join(","), "ImagingStudy");
  const stored = JSON.stringify(rows[0]);
  assert.equal(stored.includes("sekret-dicom-789"), false);        // raw token NEVER stored in the clear
  const creds = JSON.parse(await makeSecrets(env).open(config.sealed));
  assert.equal(creds.token, "sekret-dicom-789");                   // round-trip
});

test("save rejects auth.method 'smart' for type 'dicomweb' (token-only)", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...dicomBody, auth: { method: "smart", clientId: "cid" } }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("save SSRF-rejects a private/loopback baseUrl for type 'dicomweb'", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...dicomBody, baseUrl: "https://169.254.169.254/dicom-web" }),
    (e) => e instanceof OnboardError && e.klass === "bad-url");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("list surfaces dicomweb connections (studiesPath/patientTag) and never secret material", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", { ...dicomBody, studiesPath: "/api/studies", patientTag: "00100020" });
  const list = await listConnections(deps(db), req, env, "t1");
  assert.equal(list.length, 1);
  assert.equal(list[0].connectionId, connectionId);
  assert.equal(list[0].type, "dicomweb");
  assert.equal(list[0].studiesPath, "/api/studies");
  assert.equal(list[0].patientTag, "00100020");
  assert.equal(JSON.stringify(list).includes("sekret-dicom-789"), false);
});

test("save SHAPE-validates dicomweb request-shaping fields (studiesPath + patientTag; no fragment/query/host-pivot/header-injection)", async () => {
  const db = seedDb();
  // Same rationale as rest-json's resultsPath: a '#' in studiesPath makes the patient-scoping query a URL
  // fragment (never sent on the wire) -> a silent unfiltered/all-patient fetch.
  for (const bad of ["/studies#dummy", ":8080/internal", "studies", "/a b", "/x?y=1", "/@evil.com"]) {
    await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...dicomBody, studiesPath: bad }),
      (e) => e instanceof OnboardError && e.klass === "invalid", "studiesPath '" + bad + "' must be rejected");
  }
  // patientTag must be a real 8-hex-digit DICOM tag, not an arbitrary string.
  for (const bad of ["PatientID", "0010,0020", "001000200", "0010002", "zzzzzzzz"]) {
    await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...dicomBody, patientTag: bad }),
      (e) => e instanceof OnboardError && e.klass === "invalid", "patientTag '" + bad + "' must be rejected");
  }
  await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...dicomBody, headerName: "X-Bad\r\nEvil: 1" }), (e) => e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);   // nothing was persisted
  const ok = await saveConnection(deps(db), req, env, "t1", { ...dicomBody, studiesPath: "/api/v2/studies", patientTag: "00100020" });
  assert.ok(ok.connectionId);                                            // a clean absolute path + valid tag is accepted
});
