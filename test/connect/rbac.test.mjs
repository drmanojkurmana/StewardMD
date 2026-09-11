// test/connect/rbac.test.mjs — Track D RBAC matrix (spec §3.1). Deny-by-default, fail-closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { can, ROLES, TENANT_ROLES, ACTIONS, ROLE_MATRIX } from "../../functions/_connect/enterprise/rbac.js";
import { requireCan } from "../../functions/_connect/enterprise/guard.js";
import { PermissionError, AuthError } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

test("clinician has PHI actions; admin/owner do NOT (PHI is clinician-only)", () => {
  assert.equal(can("clinician", "context:load"), true);
  assert.equal(can("clinician", "maik:attach"), true);
  assert.equal(can("admin", "context:load"), false);
  assert.equal(can("owner", "context:load"), false);
  assert.equal(can("admin", "maik:attach"), false);
  assert.equal(can("owner", "maik:attach"), false);
});

test("egress:baa is owner-only", () => {
  assert.equal(can("owner", "egress:baa"), true);
  assert.equal(can("admin", "egress:baa"), false);
  assert.equal(can("clinician", "egress:baa"), false);
  assert.equal(can("auditor", "egress:baa"), false);
});

test("admin manages the org; clinician does not", () => {
  assert.equal(can("admin", "tenant:write"), true);
  assert.equal(can("admin", "member:invite"), true);
  assert.equal(can("admin", "ratelimit:write"), true);
  assert.equal(can("clinician", "tenant:write"), false);
  assert.equal(can("clinician", "member:invite"), false);
});

test("auditor is read-only, no PHI, no writes", () => {
  assert.equal(can("auditor", "audit:read"), true);
  assert.equal(can("auditor", "observability:read"), true);
  assert.equal(can("auditor", "tenant:read"), true);
  assert.equal(can("auditor", "context:load"), false);
  assert.equal(can("auditor", "tenant:write"), false);
  assert.equal(can("auditor", "member:invite"), false);
});

test("deny-by-default: unknown role, unknown action, empty inputs", () => {
  assert.equal(can("superuser", "tenant:read"), false);
  assert.equal(can("owner", "no-such-action"), false);
  assert.equal(can("", ""), false);
  assert.equal(can(undefined, undefined), false);
  assert.equal(can(null, "tenant:read"), false);
});

test("every matrix action is a declared ACTION (no typos granting phantom permissions)", () => {
  for (const role of Object.keys(ROLE_MATRIX)) {
    for (const a of ROLE_MATRIX[role]) assert.ok(ACTIONS.includes(a), role + " grants undeclared action " + a);
  }
  assert.deepEqual([...ROLES].sort(), Object.keys(ROLE_MATRIX).sort());
});

// superadmin — the platform-operator role (email allow-list; see identity.js isSuperAdmin). can() itself
// is role-string-in/bool-out and knows nothing about HOW a role was derived; these pin the MATRIX only.
test("superadmin's matrix grants EVERY declared ACTION (platform operator, not a tenant role)", () => {
  for (const a of ACTIONS) assert.equal(can("superadmin", a), true, "superadmin missing action " + a);
  assert.equal(ROLE_MATRIX.superadmin.length, ACTIONS.length);
});

test("superadmin is in ROLES (for the ROLES/ROLE_MATRIX symmetry check above) but NOT in TENANT_ROLES "
  + "(it must never be grantable via a connect_membership invite/setRole)", () => {
  assert.ok(ROLES.includes("superadmin"));
  assert.ok(!TENANT_ROLES.includes("superadmin"));
  assert.deepEqual([...TENANT_ROLES].sort(), ["admin", "auditor", "clinician", "owner"]);
});

// The four pre-existing tenant roles' matrices are BYTE-UNCHANGED by adding superadmin (this duplicates
// the assertions above verbatim so a regression here fails loudly and separately from the new role).
test("the four existing tenant roles' matrices are unchanged", () => {
  assert.equal(can("clinician", "context:load"), true);
  assert.equal(can("clinician", "maik:attach"), true);
  assert.equal(can("admin", "context:load"), false);
  assert.equal(can("owner", "context:load"), false);
  assert.equal(can("owner", "egress:baa"), true);
  assert.equal(can("admin", "egress:baa"), false);
  assert.equal(can("clinician", "egress:baa"), false);
  assert.equal(can("auditor", "egress:baa"), false);
  assert.equal(can("admin", "tenant:write"), true);
  assert.equal(can("clinician", "tenant:write"), false);
  assert.equal(can("auditor", "audit:read"), true);
  assert.equal(can("auditor", "tenant:write"), false);
  assert.deepEqual(ROLE_MATRIX.owner, ["tenant:read", "tenant:write", "member:read", "member:invite", "member:role", "member:remove", "connector:read", "connector:write", "connector:validate", "ratelimit:write", "audit:read", "observability:read", "egress:baa"]);
  assert.deepEqual(ROLE_MATRIX.admin, ["tenant:read", "tenant:write", "member:read", "member:invite", "member:role", "member:remove", "connector:read", "connector:write", "connector:validate", "ratelimit:write", "audit:read", "observability:read"]);
  // 2026-09-06: clinician gained record:read / record:write for the WardSynQ Clinical Record Service
  // (functions/api/wardsynq). Same PHI posture as context:load: clinician-only, never owner/admin/auditor.
  assert.deepEqual(ROLE_MATRIX.clinician, ["tenant:read", "connector:read", "context:load", "maik:attach", "record:read", "record:write"]);
  assert.equal(can("admin", "record:read"), false);
  assert.equal(can("auditor", "record:read"), false);
  assert.equal(can("owner", "record:write"), false);
  assert.deepEqual(ROLE_MATRIX.auditor, ["tenant:read", "member:read", "connector:read", "audit:read", "observability:read"]);
});

// requireCan — server-derived identity + membership + can()
const idFn = (id, guest = false) => async () => ({ id, guest });
const db = () => makeMockDb({ connect_tenant: [{ id: "t1", mode: "sandbox" }], connect_membership: [{ user_id: "u-clin", tenant_id: "t1", role: "clinician" }, { user_id: "u-admin", tenant_id: "t1", role: "admin" }] });

test("requireCan allows a clinician to context:load", async () => {
  const r = await requireCan({ db: db(), identifyFn: idFn("u-clin") }, {}, {}, "t1", "context:load");
  assert.equal(r.role, "clinician");
});

test("requireCan denies an admin context:load (fail-closed, not a member-level allow)", async () => {
  await assert.rejects(() => requireCan({ db: db(), identifyFn: idFn("u-admin") }, {}, {}, "t1", "context:load"), PermissionError);
});

test("requireCan rejects a guest actor (AuthError)", async () => {
  await assert.rejects(() => requireCan({ db: db(), identifyFn: idFn("ip:1", true) }, {}, {}, "t1", "tenant:read"), AuthError);
});

test("requireCan denies a non-member of the requested tenant (no cross-tenant)", async () => {
  await assert.rejects(() => requireCan({ db: db(), identifyFn: idFn("u-clin") }, {}, {}, "t2", "tenant:read"), PermissionError);
});
