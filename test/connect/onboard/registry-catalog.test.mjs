// test/connect/onboard/registry-catalog.test.mjs — Connector Registry + Marketplace catalog: a self-service,
// PHI-free, tenant-INDEPENDENT list of every connector TYPE the platform supports (metadata only). Pins: one
// entry per known type with the right category/resources/authKinds, the pull entries matching the SDK registry
// (fhir-r4/rest-json/dicomweb present, abdm event-profile NOT listed), `enabled` reflecting the per-track flag
// env, identical output across tenants (no tenant row is ever read), and fail-closed RBAC (a non-member / guest
// is denied).
import { test } from "node:test";
import assert from "node:assert/strict";
import { listConnectorCatalog } from "../../../functions/_connect/onboard/registry-catalog.js";
import { AuthError, PermissionError } from "../../../functions/_connect/permission.js";
import { makeMockDb } from "../../../functions/_connect/testkit.js";

const idFn = (id, guest = false) => async () => ({ id, guest });

function seed() {
  return makeMockDb({
    connect_tenant: [{ id: "t1", mode: "sandbox" }, { id: "t2", mode: "sandbox" }],
    connect_membership: [
      { user_id: "u-admin", tenant_id: "t1", role: "admin" },
      { user_id: "u-clin", tenant_id: "t1", role: "clinician" },
      { user_id: "u-t2", tenant_id: "t2", role: "admin" },
    ],
  });
}

const req = (tenant) => new Request("https://x/api/connect/onboard/connectors" + (tenant ? "?tenant=" + tenant : ""));
const ON = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" };

function byId(connectors, id) { return connectors.find((c) => c.id === id); }

// ---- shape + registry-derived pull entries -----------------------------------------------------------------

test("one entry per known connector type, with the right category", async () => {
  const r = await listConnectorCatalog({ db: seed(), identifyFn: idFn("u-admin") }, req("t1"), ON);
  assert.equal(r.ok, true);
  const ids = r.connectors.map((c) => c.id).sort();
  assert.deepEqual(ids, ["dicomweb", "fhir-push", "fhir-r4", "file", "hl7v2", "rest-json"]);
  assert.equal(byId(r.connectors, "fhir-r4").category, "pull");
  assert.equal(byId(r.connectors, "rest-json").category, "pull");
  assert.equal(byId(r.connectors, "dicomweb").category, "imaging");
  assert.equal(byId(r.connectors, "file").category, "file");
  assert.equal(byId(r.connectors, "hl7v2").category, "feed");
  assert.equal(byId(r.connectors, "fhir-push").category, "feed");
});

test("the pull entries match the SDK registry (fhir-r4/rest-json/dicomweb present); abdm NOT listed", async () => {
  const r = await listConnectorCatalog({ db: seed(), identifyFn: idFn("u-admin") }, req("t1"), ON);
  const ids = r.connectors.map((c) => c.id);
  assert.ok(ids.includes("fhir-r4"));
  assert.ok(ids.includes("rest-json"));
  assert.ok(ids.includes("dicomweb"));
  assert.equal(ids.includes("abdm"), false);   // profile "event" -- a different onboarding surface, not a self-service type here

  const fhir = byId(r.connectors, "fhir-r4");
  assert.equal(fhir.profile, "pull");
  assert.ok(fhir.resources.includes("Patient"));
  assert.ok(fhir.resources.includes("Encounter"));
  assert.ok(fhir.resources.includes("Observation"));
  assert.ok(fhir.authKinds.includes("smart-backend-services"));

  const rest = byId(r.connectors, "rest-json");
  assert.deepEqual(rest.resources.slice().sort(), ["DiagnosticReport", "Observation", "Patient"]);
  assert.deepEqual(rest.authKinds, ["token"]);

  const dicom = byId(r.connectors, "dicomweb");
  assert.deepEqual(dicom.resources, ["ImagingStudy"]);
  assert.deepEqual(dicom.authKinds, ["token"]);
});

test("every entry carries a description string and no undefined/null field", async () => {
  const r = await listConnectorCatalog({ db: seed(), identifyFn: idFn("u-admin") }, req("t1"), ON);
  for (const c of r.connectors) {
    for (const k of ["id", "name", "category", "profile", "description", "flagEnv"]) {
      assert.equal(typeof c[k], "string", k + " must be a string on " + c.id);
      assert.ok(c[k].length > 0, k + " must be non-empty on " + c.id);
    }
    assert.equal(typeof c.enabled, "boolean", "enabled must be a boolean on " + c.id);
    assert.ok(Array.isArray(c.resources), "resources must be an array on " + c.id);
    assert.ok(Array.isArray(c.authKinds), "authKinds must be an array on " + c.id);
  }
});

// ---- `enabled` reflects the per-track flag env --------------------------------------------------------------

test("enabled reflects the flag env: CONNECT_REST_FLAG on -> rest-json enabled, off -> disabled", async () => {
  const db = seed();
  const off = await listConnectorCatalog({ db, identifyFn: idFn("u-admin") }, req("t1"), ON);
  assert.equal(byId(off.connectors, "rest-json").enabled, false);
  const on = await listConnectorCatalog({ db, identifyFn: idFn("u-admin") }, req("t1"), Object.assign({}, ON, { CONNECT_REST_FLAG: "1" }));
  assert.equal(byId(on.connectors, "rest-json").enabled, true);
  // other entries are unaffected by the rest-json flag
  assert.equal(byId(on.connectors, "fhir-r4").enabled, false);
  assert.equal(byId(on.connectors, "dicomweb").enabled, false);
});

test("enabled reflects each of the other per-track flags independently", async () => {
  const db = seed();
  const r1 = await listConnectorCatalog({ db, identifyFn: idFn("u-admin") }, req("t1"), Object.assign({}, ON, { CONNECT_FHIR_FLAG: "1" }));
  assert.equal(byId(r1.connectors, "fhir-r4").enabled, true);
  assert.equal(byId(r1.connectors, "rest-json").enabled, false);

  const r2 = await listConnectorCatalog({ db, identifyFn: idFn("u-admin") }, req("t1"), Object.assign({}, ON, { CONNECT_DICOM_FLAG: "1" }));
  assert.equal(byId(r2.connectors, "dicomweb").enabled, true);

  const r3 = await listConnectorCatalog({ db, identifyFn: idFn("u-admin") }, req("t1"), Object.assign({}, ON, { CONNECT_HL7_FLAG: "1" }));
  assert.equal(byId(r3.connectors, "hl7v2").enabled, true);
  assert.equal(byId(r3.connectors, "fhir-push").enabled, false);

  const r4 = await listConnectorCatalog({ db, identifyFn: idFn("u-admin") }, req("t1"), Object.assign({}, ON, { CONNECT_FHIR_PUSH_FLAG: "1" }));
  assert.equal(byId(r4.connectors, "fhir-push").enabled, true);
  assert.equal(byId(r4.connectors, "hl7v2").enabled, false);

  // CSV/file rides the base onboard flag only -- always enabled once the onboard surface itself is reachable.
  const r5 = await listConnectorCatalog({ db, identifyFn: idFn("u-admin") }, req("t1"), ON);
  assert.equal(byId(r5.connectors, "file").enabled, true);
});

// ---- PHI-free + tenant-independent --------------------------------------------------------------------------

test("PHI-free + tenant-independent: identical catalog for a different valid tenant, no tenant id in the output", async () => {
  const db = seed();
  const r1 = await listConnectorCatalog({ db, identifyFn: idFn("u-admin") }, req("t1"), ON);
  const r2 = await listConnectorCatalog({ db, identifyFn: idFn("u-t2") }, req("t2"), ON);
  assert.deepEqual(r1.connectors, r2.connectors);   // same env -> byte-identical catalog regardless of tenant
  const blob = JSON.stringify(r1);
  assert.equal(blob.includes("t1"), false);
  assert.equal(blob.includes("t2"), false);
});

// ---- fail-closed RBAC ------------------------------------------------------------------------------------

test("clinician (holds connector:read) may read the catalog", async () => {
  const r = await listConnectorCatalog({ db: seed(), identifyFn: idFn("u-clin") }, req("t1"), ON);
  assert.ok(r.connectors.length > 0);
});

test("a member of t1 cannot read the catalog scoped to t2 (cross-tenant => PermissionError)", async () => {
  await assert.rejects(() => listConnectorCatalog({ db: seed(), identifyFn: idFn("u-admin") }, req("t2"), ON), PermissionError);
});

test("a non-member of the tenant is denied (PermissionError)", async () => {
  await assert.rejects(() => listConnectorCatalog({ db: seed(), identifyFn: idFn("u-stranger") }, req("t1"), ON), PermissionError);
});

test("guest / unauthenticated caller is denied (AuthError, fail-closed)", async () => {
  await assert.rejects(() => listConnectorCatalog({ db: seed(), identifyFn: idFn("ip:x", true) }, req("t1"), ON), AuthError);
});
