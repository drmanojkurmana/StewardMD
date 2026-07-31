// test/connect/org.test.mjs — org/tenant lifecycle (spec §3.4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, updateTenant, suspendTenant } from "../../functions/_connect/enterprise/org.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

const idFn = (id) => async () => ({ id, guest: false });
const seed = () => makeMockDb({ connect_tenant: [{ id: "t1", mode: "sandbox", name: "T1", status: "active" }], connect_membership: [{ user_id: "u-owner", tenant_id: "t1", role: "owner" }, { user_id: "u-clin", tenant_id: "t1", role: "clinician" }, { user_id: "u-aud", tenant_id: "t1", role: "auditor" }] });

test("platform owner creates a tenant + seeds creator as owner", async () => {
  const db = seed();
  const r = await createTenant({ db, identifyFn: idFn("u-new"), ownerOk: async () => true }, {}, {}, { id: "acme", name: "Acme" });
  assert.equal(r.id, "acme");
  assert.equal(r.mode, "sandbox");
  assert.equal(db._tables.connect_tenant.length, 2);        // t1 seed + acme
  assert.ok(JSON.stringify(db._tables.connect_membership).includes("owner"));
});

test("non platform-owner cannot create a tenant", async () => {
  await assert.rejects(() => createTenant({ db: seed(), identifyFn: idFn("u-new"), ownerOk: async () => false }, {}, {}, { id: "acme" }), PermissionError);
});

test("tenant id must match [a-z0-9-]", async () => {
  await assert.rejects(() => createTenant({ db: seed(), identifyFn: idFn("u-new"), ownerOk: async () => true }, {}, {}, { id: "Acme Corp!" }), PermissionError);
});

test("sandbox->live transition is refused", async () => {
  await assert.rejects(() => updateTenant({ db: seed(), identifyFn: idFn("u-owner") }, {}, {}, "t1", { mode: "live" }), PermissionError);
});

test("clinician cannot write tenant; owner can update name", async () => {
  await assert.rejects(() => updateTenant({ db: seed(), identifyFn: idFn("u-clin") }, {}, {}, "t1", { name: "X" }), PermissionError);
  const r = await updateTenant({ db: seed(), identifyFn: idFn("u-owner") }, {}, {}, "t1", { name: "T1-renamed" });
  assert.equal(r.ok, true);
});

test("owner suspends; auditor cannot", async () => {
  const r = await suspendTenant({ db: seed(), identifyFn: idFn("u-owner") }, {}, {}, "t1");
  assert.equal(r.ok, true);
  await assert.rejects(() => suspendTenant({ db: seed(), identifyFn: idFn("u-aud") }, {}, {}, "t1"), PermissionError);
});
