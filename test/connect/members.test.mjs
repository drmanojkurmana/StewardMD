// test/connect/members.test.mjs — membership management RBAC + guards (spec §3.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { listMembers, invite, setRole, removeMember, listMyTenants } from "../../functions/_connect/enterprise/members.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";
// makeMockDb's UPDATE/DELETE are no-ops (append-only, by design -- see testkit.js), so it can assert the
// GUARD pre-checks (which throw before any SQL) but not real write-STATE. makeOnboardDb round-trips
// INSERT/SELECT/UPDATE/DELETE for exactly the column=? equality statements members.js emits, so it is used
// below where a test needs to observe the row actually change (mirrors the consent tests' approach). The
// TOCTOU correlated-subquery guard on the demote/remove-owner path is real-D1-only and is not re-verified here.
import { makeOnboardDb } from "./onboard/onboard-db.mjs";

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

// "superadmin" is the platform-operator role (OWNER_EMAILS allow-list, functions/_connect/identity.js
// isSuperAdmin) — it must NEVER be grantable via a connect_membership invite/setRole, even by an owner.
// That would be a second, weaker path to the same privilege that bypasses the email allow-list entirely.
test("superadmin cannot be granted via invite or setRole, even by an owner", async () => {
  await assert.rejects(() => invite({ db: seed(TWO_OWNERS), identifyFn: idFn("u-owner") }, {}, {}, "t1", { userId: "x", role: "superadmin" }), PermissionError);
  await assert.rejects(() => setRole({ db: seed(TWO_OWNERS), identifyFn: idFn("u-owner") }, {}, {}, "t1", { userId: "u-admin", role: "superadmin" }), PermissionError);
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

// listMembers's raw rows carry {user_id,tenant_id,role} (server-internal shape); the onboard router (functions/
// api/connect/onboard/[[path]].js) projects each row to a client-safe {userId,role} ONLY before it ever reaches
// the wire -- tenant_id is dropped (the caller already knows it: it's the tenant they selected). This asserts
// that projection (the exact map the router applies) yields exactly those two keys, nothing more.
test("the router's {userId,role} projection of a raw member row carries exactly those two keys", async () => {
  const rows = await listMembers({ db: seed(ONE_OWNER), identifyFn: idFn("u-owner") }, {}, {}, "t1");
  const projected = rows.map((r) => ({ userId: r.user_id, role: r.role }));
  assert.equal(projected.length, 2);
  for (const p of projected) assert.deepEqual(Object.keys(p).sort(), ["role", "userId"]);
});

test("owner can remove a non-last owner (the row is actually deleted; a PHI-free member.remove audit row is written)", async () => {
  const db = makeOnboardDb({ connect_tenant: [{ id: "t1", mode: "sandbox", name: "T1" }], connect_membership: TWO_OWNERS.map((m) => ({ ...m })) });
  const r = await removeMember({ db, identifyFn: idFn("u-owner") }, {}, {}, "t1", { userId: "u-own2" });
  assert.equal(r.ok, true);
  const remaining = (await db.prepare("SELECT * FROM connect_membership WHERE tenant_id=?").bind("t1").all()).results;
  assert.ok(!remaining.some((m) => m.user_id === "u-own2"));           // actually removed
  assert.ok(remaining.some((m) => m.user_id === "u-owner"));           // the other owner is untouched
  const auditRows = db._tables.connect_audit_event || [];
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, "member.remove");
  assert.equal(auditRows[0].outcome, "ok");
});

test("setRole actually updates the row and writes a role.change audit row", async () => {
  const db = makeOnboardDb({ connect_tenant: [{ id: "t1", mode: "sandbox", name: "T1" }], connect_membership: TWO_OWNERS.map((m) => ({ ...m })) });
  const r = await setRole({ db, identifyFn: idFn("u-owner") }, {}, {}, "t1", { userId: "u-admin", role: "auditor" });
  assert.equal(r.ok, true);
  const rows = (await db.prepare("SELECT * FROM connect_membership WHERE tenant_id=?").bind("t1").all()).results;
  assert.equal(rows.find((m) => m.user_id === "u-admin").role, "auditor");
  const auditRows = db._tables.connect_audit_event || [];
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, "role.change");
  assert.equal(auditRows[0].outcome, "ok");
});

// listMyTenants + the platform super-admin (see test/connect/superadmin.test.mjs for the full matrix of
// security scenarios; these two pin the tenant-picker behavior specifically).
const idEmail = (id, email) => async () => ({ id, guest: false, email });
test("listMyTenants: a super-admin (verified owner email) sees EVERY tenant, not just their own memberships", async () => {
  const db = makeMockDb({
    connect_tenant: [{ id: "t1", mode: "sandbox", name: "T1" }, { id: "t2", mode: "sandbox", name: "T2" }, { id: "t3", mode: "sandbox" }],
    connect_membership: [{ user_id: "u-clin", tenant_id: "t1", role: "clinician" }],
  });
  const env = { OWNER_EMAILS: "owner@example.com" };
  const mine = await listMyTenants({ db, identifyFn: idEmail("fb:whatever-uid", "owner@example.com") }, {}, env);
  assert.deepEqual(mine.map((t) => t.tenantId).sort(), ["t1", "t2", "t3"]);
  assert.ok(mine.every((t) => t.role === "superadmin"));
  assert.equal(mine.find((t) => t.tenantId === "t3").name, undefined);   // name===id -> omitted, never invented
});

test("listMyTenants: a non-super-admin (even one with no memberships) sees only their own memberships, never every tenant", async () => {
  const db = makeMockDb({
    connect_tenant: [{ id: "t1", mode: "sandbox", name: "T1" }, { id: "t2", mode: "sandbox", name: "T2" }],
    connect_membership: [{ user_id: "u-clin", tenant_id: "t1", role: "clinician" }],
  });
  const env = { OWNER_EMAILS: "owner@example.com" };
  assert.deepEqual(await listMyTenants({ db, identifyFn: idEmail("u-nobody", "nobody@example.com") }, {}, env), []);
  const clin = await listMyTenants({ db, identifyFn: idEmail("u-clin", "clinician@example.com") }, {}, env);
  assert.deepEqual(clin.map((t) => t.tenantId), ["t1"]);
  assert.equal(clin[0].role, "clinician");
});
