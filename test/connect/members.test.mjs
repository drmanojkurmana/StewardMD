// test/connect/members.test.mjs — membership management RBAC + guards (spec §3.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { listMembers, invite, setRole, removeMember } from "../../functions/_connect/enterprise/members.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

const idFn = (id) => async () => ({ id, guest: false });
function seed(members) {
  return makeMockDb({ connect_tenant: [{ id: "t1", mode: "sandbox", name: "T1" }], connect_membership: members });
}
const TWO_OWNERS = [{ user_id: "u-owner", tenant_id: "t1", role: "owner" }, { user_id: "u-own2", tenant_id: "t1", role: "owner" }, { user_id: "u-admin", tenant_id: "t1", role: "admin" }, { user_id: "u-clin", tenant_id: "t1", role: "clinician" }, { user_id: "u-aud", tenant_id: "t1", role: "auditor" }];
const ONE_OWNER = [{ user_id: "u-owner", tenant_id: "t1", role: "owner" }, { user_id: "u-admin", tenant_id: "t1", role: "admin" }];

test("admin invites a clinician -> invite row appended", async () => {
  const db = seed(TWO_OWNERS);
  const r = await invite({ db, identifyFn: idFn("u-admin") }, {}, {}, "t1", { userId: "new1", role: "clinician" });
  assert.equal(r.status, "invited");
  assert.equal(db._tables.connect_membership_invite.length, 1);
  assert.ok(JSON.stringify(db._tables.connect_membership_invite[0]).includes("invited"));
});

test("clinician cannot invite (member:invite denied)", async () => {
  await assert.rejects(() => invite({ db: seed(TWO_OWNERS), identifyFn: idFn("u-clin") }, {}, {}, "t1", { userId: "x", role: "clinician" }), PermissionError);
});

test("invalid role is refused", async () => {
  await assert.rejects(() => invite({ db: seed(TWO_OWNERS), identifyFn: idFn("u-admin") }, {}, {}, "t1", { userId: "x", role: "superuser" }), PermissionError);
});

test("only an owner may grant owner (admin cannot)", async () => {
  await assert.rejects(() => invite({ db: seed(TWO_OWNERS), identifyFn: idFn("u-admin") }, {}, {}, "t1", { userId: "x", role: "owner" }), PermissionError);
  const r = await invite({ db: seed(TWO_OWNERS), identifyFn: idFn("u-owner") }, {}, {}, "t1", { userId: "x", role: "owner" });
  assert.equal(r.ok, true);
});

test("admin cannot demote/modify an owner (†)", async () => {
  await assert.rejects(() => setRole({ db: seed(TWO_OWNERS), identifyFn: idFn("u-admin") }, {}, {}, "t1", { userId: "u-owner", role: "admin" }), PermissionError);
});

test("last-owner cannot be demoted", async () => {
  await assert.rejects(() => setRole({ db: seed(ONE_OWNER), identifyFn: idFn("u-owner") }, {}, {}, "t1", { userId: "u-owner", role: "admin" }), PermissionError);
});

test("last-owner cannot be removed", async () => {
  await assert.rejects(() => removeMember({ db: seed(ONE_OWNER), identifyFn: idFn("u-owner") }, {}, {}, "t1", { userId: "u-owner" }), PermissionError);
});

test("owner can demote a non-last owner", async () => {
  const r = await setRole({ db: seed(TWO_OWNERS), identifyFn: idFn("u-owner") }, {}, {}, "t1", { userId: "u-own2", role: "admin" });
  assert.equal(r.ok, true);
});

test("auditor can list members; clinician cannot", async () => {
  const rows = await listMembers({ db: seed(TWO_OWNERS), identifyFn: idFn("u-aud") }, {}, {}, "t1");
  assert.equal(rows.length, 5);
  await assert.rejects(() => listMembers({ db: seed(TWO_OWNERS), identifyFn: idFn("u-clin") }, {}, {}, "t1"), PermissionError);
});
