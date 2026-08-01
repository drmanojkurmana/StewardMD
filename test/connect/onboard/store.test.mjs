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
