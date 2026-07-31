// test/connect/maik-attach.test.mjs — sealed MaiK-session binding, NO raw PHI in KV (spec §4.4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { attach, detach, readBinding, bindKey } from "../../functions/_connect/maik-bridge/attach.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb, makeMockKv } from "../../functions/_connect/testkit.js";

const ENV = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"), CONNECT_HMAC_SALT: "c2FsdA==" };
const idFn = (id) => async () => ({ id, guest: false });
const seed = () => makeMockDb({ connect_tenant: [{ id: "t1", mode: "sandbox" }], connect_membership: [{ user_id: "u-clin", tenant_id: "t1", role: "clinician" }, { user_id: "u-admin", tenant_id: "t1", role: "admin" }] });

test("clinician attach seals the binding — raw patientRef / MRN is NOT in KV", async () => {
  const kv = makeMockKv();
  const deps = { db: seed(), kv, identifyFn: idFn("u-clin") };
  await attach(deps, {}, ENV, { tenantId: "t1", connectorId: "fhir-r4", patientRef: "MRN-000-SECRET-42" });
  const stored = await kv.get(bindKey("u-clin"));
  assert.ok(stored);
  assert.equal(stored.includes("MRN-000-SECRET-42"), false);       // ciphertext only — no PHI in KV
  assert.equal(stored.includes("fhir-r4"), false);                 // whole binding is sealed
});

test("readBinding round-trips the sealed binding", async () => {
  const kv = makeMockKv();
  const deps = { db: seed(), kv, identifyFn: idFn("u-clin") };
  await attach(deps, {}, ENV, { tenantId: "t1", connectorId: "fhir-r4", patientRef: "MRN-000-SECRET-42" });
  const b = await readBinding(ENV, kv, "u-clin");
  assert.deepEqual(b, { tenantId: "t1", connectorId: "fhir-r4", patientRef: "MRN-000-SECRET-42" });
});

test("admin cannot attach (maik:attach is clinician-only)", async () => {
  await assert.rejects(() => attach({ db: seed(), kv: makeMockKv(), identifyFn: idFn("u-admin") }, {}, ENV, { tenantId: "t1", connectorId: "fhir-r4", patientRef: "P1" }), PermissionError);
});

test("attach audit event is PHI-free (patientRefHash, no raw ref)", async () => {
  const db = seed(), kv = makeMockKv();
  await attach({ db, kv, identifyFn: idFn("u-clin") }, {}, ENV, { tenantId: "t1", connectorId: "fhir-r4", patientRef: "MRN-000-SECRET-42" });
  const blob = JSON.stringify(db._tables.connect_audit_event);
  assert.equal(db._tables.connect_audit_event.length, 1);
  assert.equal(blob.includes("MRN-000-SECRET-42"), false);         // no raw ref in audit
  assert.ok(blob.includes("maik.attach"));
});

test("a new attach overwrites the prior (one active binding); detach clears it", async () => {
  const kv = makeMockKv();
  const deps = { db: seed(), kv, identifyFn: idFn("u-clin") };
  await attach(deps, {}, ENV, { tenantId: "t1", connectorId: "fhir-r4", patientRef: "A" });
  await attach(deps, {}, ENV, { tenantId: "t1", connectorId: "fhir-r4", patientRef: "B" });
  assert.equal((await readBinding(ENV, kv, "u-clin")).patientRef, "B");
  await detach(deps, {}, ENV);
  assert.equal(await readBinding(ENV, kv, "u-clin"), null);
});
