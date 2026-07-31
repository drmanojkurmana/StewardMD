import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActor, resolveTenant, AuthError } from "../../functions/_connect/identity.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

const identifyGuest = async () => ({ id: "ip:1", guest: true });
const identifyUser = async () => ({ id: "fb:u1", guest: false });

test("resolveActor rejects a guest", async () => {
  await assert.rejects(() => resolveActor(identifyGuest, {}, {}), AuthError);
  assert.deepEqual(await resolveActor(identifyUser, {}, {}), { id: "fb:u1" });
});

test("resolveTenant requires membership", async () => {
  const db = makeMockDb({ connect_membership: [{ user_id: "fb:u1", tenant_id: "t1", role: "clinician" }], connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: '["Patient"]' }] });
  const r = await resolveTenant(db, "fb:u1", "t1");
  assert.equal(r.role, "clinician");
  await assert.rejects(() => resolveTenant(db, "fb:u1", "t2"), PermissionError);   // not a member
});
