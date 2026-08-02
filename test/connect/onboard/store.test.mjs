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

// --- graphql (generic GraphQL lab-results pull connector) ----------------------------------------------------
const gqlQuery = "query($patientId: ID!) { patientLabs(id: $patientId) { rows { patientId testName value unit } } }";
const gqlBody = { name: "Lab GraphQL API", type: "graphql", baseUrl: "https://labs.example.org/graphql", query: gqlQuery, auth: { method: "token", token: "sekret-gql-123" } };

test("save accepts type 'graphql' with auth.method 'token'; envelope-seals the credential", async () => {
  const db = seedDb();
  const res = await saveConnection(deps(db), req, env, "t1", gqlBody);
  assert.equal(res.ok, true);
  const rows = db._tables.connect_connector_config;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "graphql");
  assert.equal(rows[0].profile, "pull");
  const config = JSON.parse(rows[0].config);
  assert.equal(config.type, "graphql");
  assert.equal(config.query, gqlQuery);
  assert.equal(config.patientVar, "patientId");            // default when not supplied
  assert.equal(JSON.parse(rows[0].scope).join(","), "Patient,Observation,DiagnosticReport");
  const stored = JSON.stringify(rows[0]);
  assert.equal(stored.includes("sekret-gql-123"), false);          // raw token NEVER stored in the clear
  const creds = JSON.parse(await makeSecrets(env).open(config.sealed));
  assert.equal(creds.token, "sekret-gql-123");                     // round-trip
});

test("save rejects auth.method 'smart' for type 'graphql' (token-only)", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...gqlBody, auth: { method: "smart", clientId: "cid" } }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("save SSRF-rejects a private/loopback baseUrl for type 'graphql'", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...gqlBody, baseUrl: "https://169.254.169.254/graphql" }),
    (e) => e instanceof OnboardError && e.klass === "bad-url");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("list surfaces graphql connections (query/resultsPath/patientVar) and never secret material", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", { ...gqlBody, resultsPath: "patientLabs.rows", graphqlPath: "/api/graphql" });
  const list = await listConnections(deps(db), req, env, "t1");
  assert.equal(list.length, 1);
  assert.equal(list[0].connectionId, connectionId);
  assert.equal(list[0].type, "graphql");
  assert.equal(list[0].query, gqlQuery);
  assert.equal(list[0].resultsPath, "patientLabs.rows");
  assert.equal(list[0].graphqlPath, "/api/graphql");
  assert.equal(list[0].patientVar, "patientId");
  assert.equal(JSON.stringify(list).includes("sekret-gql-123"), false);
});

test("save rejects a query without the bound $patientVar (would fetch unscoped/all-patient data)", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...gqlBody, query: "query { allLabs { rows { patientId testName value unit } } }" }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  // a custom patientVar must ALSO be referenced, not just the default
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...gqlBody, patientVar: "mrn", query: gqlQuery }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
  const ok = await saveConnection(deps(db), req, env, "t1", { ...gqlBody, patientVar: "mrn", query: "query($mrn: ID!) { patientLabs(id: $mrn) { rows { patientId } } }" });
  assert.ok(ok.connectionId);   // referencing the custom patientVar is accepted
});

test("save rejects a query containing a mutation or subscription (read-only connector)", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...gqlBody, query: "mutation($patientId: ID!) { deletePatient(id: $patientId) }" }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...gqlBody, query: "subscription($patientId: ID!) { labUpdated(id: $patientId) { value } }" }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("save rejects an oversized query", async () => {
  const db = seedDb();
  const huge = "query($patientId: ID!) { patientLabs(id: $patientId) { rows { " + "x".repeat(8100) + " } } }";
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...gqlBody, query: huge }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("save SHAPE-validates graphql request-shaping fields (graphqlPath absolute-path guard; resultsPath dotted-identifier guard; no prototype-polluting segment)", async () => {
  const db = seedDb();
  for (const bad of ["/graphql#dummy", ":8080/internal", "graphql", "/a b", "/x?y=1", "/@evil.com"]) {
    await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...gqlBody, graphqlPath: bad }),
      (e) => e instanceof OnboardError && e.klass === "invalid", "graphqlPath '" + bad + "' must be rejected");
  }
  // resultsPath must be dotted simple identifiers; a __proto__/prototype/constructor segment is rejected even
  // though it would otherwise match the dotted-identifier shape (defense in depth against prototype pollution).
  for (const bad of ["patient labs", "patient.labs.", "patient..labs", "patient/labs", "__proto__.rows", "patient.__proto__", "patient.prototype.rows", "constructor.rows"]) {
    await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...gqlBody, resultsPath: bad }),
      (e) => e instanceof OnboardError && e.klass === "invalid", "resultsPath '" + bad + "' must be rejected");
  }
  await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...gqlBody, headerName: "X-Bad\r\nEvil: 1" }), (e) => e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);   // nothing was persisted
  const ok = await saveConnection(deps(db), req, env, "t1", { ...gqlBody, graphqlPath: "/api/v2/graphql", resultsPath: "patient.labs.rows" });
  assert.ok(ok.connectionId);                                            // a clean absolute path + dotted resultsPath is accepted
});

// --- sql (generic SQL/DB lab-results pull connector -- INTERFACE + STUB) --------------------------------------
const sqlQuery = "SELECT patient_id AS \"patientId\", test_name AS \"testName\" FROM labs WHERE patient_id = $1";
const sqlBody = { name: "Lab DB", type: "sql", bindingName: "LABS_DB", queryTemplate: sqlQuery };

test("save accepts type 'sql': NO URL, NO admin secret (sealed=null, DB creds live in the owner's Hyperdrive binding)", async () => {
  const db = seedDb();
  const res = await saveConnection(deps(db), req, env, "t1", sqlBody);
  assert.equal(res.ok, true);
  const rows = db._tables.connect_connector_config;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "sql");
  assert.equal(rows[0].profile, "pull");
  assert.equal(rows[0].base_url, "");                      // no URL -- SQL has no HTTP endpoint
  const config = JSON.parse(rows[0].config);
  assert.equal(config.type, "sql");
  assert.equal(config.authMethod, "binding");
  assert.equal(config.bindingName, "LABS_DB");
  assert.equal(config.queryTemplate, sqlQuery);
  assert.equal(config.sealed, null);                       // no admin secret to seal for a binding-auth connection
  assert.equal(JSON.parse(rows[0].scope).join(","), "Patient,Observation,DiagnosticReport");
});

test("save rejects a bindingName that is not a simple identifier (never a connection string)", async () => {
  const db = seedDb();
  for (const bad of ["", "  ", "1LABS", "LABS DB", "postgres://user:pass@host/db", "LABS-DB", "LABS.DB"]) {
    await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...sqlBody, bindingName: bad }),
      (e) => e instanceof OnboardError && e.klass === "invalid", "bindingName '" + bad + "' must be rejected");
  }
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("save rejects a non-parameterized queryTemplate (the patient value MUST be a bound placeholder, never concatenated)", async () => {
  const db = seedDb();
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...sqlBody, queryTemplate: "SELECT * FROM labs WHERE patient_id = 'P1'" }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
  // a placeholder alone is not enough -- it must also reference the patient parameter
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...sqlBody, queryTemplate: "SELECT * FROM labs WHERE id = $1" }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  // all three placeholder styles are accepted once the patient parameter is referenced
  for (const q of ["SELECT * FROM labs WHERE patient_id = $1", "SELECT * FROM labs WHERE patient_id = :patientId", "SELECT * FROM labs WHERE patient_id = ?"]) {
    const ok = await saveConnection(deps(db), req, env, "t1", { ...sqlBody, queryTemplate: q });
    assert.ok(ok.connectionId, "queryTemplate '" + q + "' must be accepted");
  }
});

test("save rejects any write/DDL keyword (read-only allow-list) and a stacked (';') statement", async () => {
  const db = seedDb();
  for (const kw of ["INSERT INTO labs(patient_id) VALUES ($1)", "UPDATE labs SET v=1 WHERE patient_id=$1", "DELETE FROM labs WHERE patient_id=$1",
    "DROP TABLE labs", "ALTER TABLE labs ADD c INT", "CREATE TABLE x(id INT)", "GRANT ALL ON labs TO x", "TRUNCATE labs",
    "MERGE INTO labs USING x ON (1=1)", "REPLACE INTO labs VALUES ($1)", "CALL sp_patient($1)", "EXEC sp_patient $1", "EXECUTE sp_patient($1)"]) {
    await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...sqlBody, queryTemplate: kw + " -- patient_id" }),
      (e) => e instanceof OnboardError && e.klass === "invalid", "write keyword in '" + kw + "' must be rejected");
  }
  // a stacked statement (second statement after ';') is rejected even if each half looks read-only
  await assert.rejects(
    () => saveConnection(deps(db), req, env, "t1", { ...sqlBody, queryTemplate: "SELECT * FROM labs WHERE patient_id=$1; SELECT * FROM secrets" }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("save rejects an oversized queryTemplate", async () => {
  const db = seedDb();
  const huge = "SELECT * FROM labs WHERE patient_id = $1 AND note = '" + "x".repeat(8100) + "'";
  await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...sqlBody, queryTemplate: huge }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});

test("list/safeView surfaces bindingName/queryTemplate/columnMap for sql and NEVER a connection string or secret material", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", { ...sqlBody, columnMap: { patientId: "patient_id" } });
  const list = await listConnections(deps(db), req, env, "t1");
  assert.equal(list.length, 1);
  assert.equal(list[0].connectionId, connectionId);
  assert.equal(list[0].type, "sql");
  assert.equal(list[0].bindingName, "LABS_DB");
  assert.equal(list[0].queryTemplate, sqlQuery);
  assert.deepEqual(list[0].columnMap, { patientId: "patient_id" });
  assert.equal(list[0].fhirBaseUrl, "");                 // no URL was ever stored
  const blob = JSON.stringify(list);
  for (const s of ["postgres://", "mysql://", "sealed", "password", "connectionString"]) assert.equal(blob.includes(s), false);
});

test("save rejects a columnMap that is not a plain object", async () => {
  const db = seedDb();
  await assert.rejects(() => saveConnection(deps(db), req, env, "t1", { ...sqlBody, columnMap: ["a", "b"] }),
    (e) => e instanceof OnboardError && e.klass === "invalid");
  assert.equal((db._tables.connect_connector_config || []).length, 0);
});
