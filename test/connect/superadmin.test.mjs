// test/connect/superadmin.test.mjs — platform Super Admin (spec: owner-EMAIL allow-list, FULL Connect
// permissions on every tenant, WITHOUT a per-tenant connect_membership row). SECURITY-CRITICAL: this is
// an authorization-boundary change, so every scenario below is a DENY or an ALLOW pinned against the
// exact verified-email-only rule (functions/_connect/identity.js isSuperAdmin/resolveTenant).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActor, resolveTenant, isSuperAdmin, AuthError } from "../../functions/_connect/identity.js";
import { requireCan } from "../../functions/_connect/enterprise/guard.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { can, ACTIONS } from "../../functions/_connect/enterprise/rbac.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";
import { identify } from "../../functions/_usage.js";

const OWNER_EMAIL = "drmanojkurmana@gmail.com";       // one of the OWNER_EMAILS_DEFAULT (functions/_adminauth.js)
const OTHER_OWNER_EMAIL = "kdiwakar45@gmail.com";
const NON_OWNER_EMAIL = "attacker@example.com";

const dbWithTenant = (extra = {}) => makeMockDb(Object.assign({
  connect_tenant: [{ id: "t1", mode: "sandbox", name: "T1" }],
  connect_membership: [{ user_id: "u-clin", tenant_id: "t1", role: "clinician" }],
}, extra));

const idFn = (id, email, guest = false) => async () => ({ id, guest, email });

// ---- isSuperAdmin: the gate itself ----

test("isSuperAdmin: true for a default OWNER_EMAILS address, using the default env (no OWNER_EMAILS set)", () => {
  assert.equal(isSuperAdmin({ id: "fb:x", email: OWNER_EMAIL }, {}), true);
  assert.equal(isSuperAdmin({ id: "fb:y", email: OTHER_OWNER_EMAIL }, {}), true);
});

test("isSuperAdmin: false for a non-owner email, null email, or absent actor (fail-closed)", () => {
  assert.equal(isSuperAdmin({ id: "fb:x", email: NON_OWNER_EMAIL }, {}), false);
  assert.equal(isSuperAdmin({ id: "fb:x", email: null }, {}), false);
  assert.equal(isSuperAdmin({ id: "fb:x" }, {}), false);
  assert.equal(isSuperAdmin(null, {}), false);
  assert.equal(isSuperAdmin(undefined, {}), false);
});

test("isSuperAdmin: OWNER_EMAILS env override changes the set (restricts AND grows)", () => {
  const restricted = { OWNER_EMAILS: OTHER_OWNER_EMAIL };
  assert.equal(isSuperAdmin({ id: "fb:x", email: OWNER_EMAIL }, restricted), false);       // narrowed out
  assert.equal(isSuperAdmin({ id: "fb:y", email: OTHER_OWNER_EMAIL }, restricted), true);  // still in
  const grown = { OWNER_EMAILS: OWNER_EMAIL + "," + NON_OWNER_EMAIL };
  assert.equal(isSuperAdmin({ id: "fb:z", email: NON_OWNER_EMAIL }, grown), true);         // newly added
});

// ---- resolveTenant: the super-admin branch ----

test("resolveTenant: a super-admin gets role=superadmin on an EXISTING tenant with NO membership row", async () => {
  const db = dbWithTenant();
  const r = await resolveTenant(db, { id: "fb:owner-uid", email: OWNER_EMAIL }, "t1", {});
  assert.equal(r.role, "superadmin");
  assert.equal(r.tenant.id, "t1");
});

test("resolveTenant: a super-admin CANNOT invent a tenant id (non-existent tenant still denies)", async () => {
  const db = dbWithTenant();
  await assert.rejects(() => resolveTenant(db, { id: "fb:owner-uid", email: OWNER_EMAIL }, "no-such-tenant", {}), PermissionError);
});

test("resolveTenant: a forged connect_membership row literally carrying role='superadmin' is refused, not honored", async () => {
  const db = dbWithTenant({ connect_membership: [{ user_id: "u-forged", tenant_id: "t1", role: "superadmin" }] });
  // actor has no email at all (not a real super-admin via the allow-list) -- only the forged row claims it.
  await assert.rejects(() => resolveTenant(db, { id: "u-forged", email: null }, "t1", {}), PermissionError);
});

// ---- requireCan: full integration through the guard ----

test("requireCan: a super-admin can perform EVERY declared action on an existing tenant with no membership row", async () => {
  const db = dbWithTenant();
  for (const action of ACTIONS) {
    const r = await requireCan({ db, identifyFn: idFn("fb:owner-uid", OWNER_EMAIL) }, {}, {}, "t1", action);
    assert.equal(r.role, "superadmin");
  }
});

test("requireCan: guest is AuthError, not a super-admin bypass", async () => {
  const db = dbWithTenant();
  await assert.rejects(() => requireCan({ db, identifyFn: idFn("ip:1", OWNER_EMAIL, true) }, {}, {}, "t1", "tenant:read"), AuthError);
});

test("requireCan: a signed-in non-owner-email caller with no membership is still denied (unchanged membership RBAC)", async () => {
  const db = dbWithTenant();
  await assert.rejects(() => requireCan({ db, identifyFn: idFn("u-stranger", NON_OWNER_EMAIL) }, {}, {}, "t1", "tenant:read"), PermissionError);
});

test("requireCan: super-admin on a non-existent tenant is PermissionError, same as anyone else", async () => {
  const db = dbWithTenant();
  await assert.rejects(() => requireCan({ db, identifyFn: idFn("fb:owner-uid", OWNER_EMAIL) }, {}, {}, "no-such-tenant", "tenant:read"), PermissionError);
});

test("requireCan: existing membership-based RBAC (owner/admin/clinician/auditor) is unaffected for non-super-admin callers", async () => {
  const db = dbWithTenant();
  const r = await requireCan({ db, identifyFn: idFn("u-clin", NON_OWNER_EMAIL) }, {}, {}, "t1", "context:load");
  assert.equal(r.role, "clinician");
  await assert.rejects(() => requireCan({ db, identifyFn: idFn("u-clin", NON_OWNER_EMAIL) }, {}, {}, "t1", "tenant:write"), PermissionError);
});

// ---- the exact security requirement: ONLY the verified identify() email counts, never a body value ----
// Uses the REAL functions/_usage.js identify() (not a mock) so this pins the actual production wiring:
// identify() reads Cf-Access-Authenticated-User-Email off the request HEADERS only; it never looks at a
// request body. A request whose JSON body claims an owner email, but whose VERIFIED header identifies a
// different (non-owner) caller, must resolve to that non-owner identity -- and so must NOT be a super-admin.
test("the super-admin check uses ONLY the verified identify() email -- a body-supplied owner email from a different caller does not count", async () => {
  const request = new Request("https://stewardmd.in/api/connect/onboard/tenants", {
    method: "POST",
    headers: { "Cf-Access-Authenticated-User-Email": NON_OWNER_EMAIL },
    body: JSON.stringify({ email: OWNER_EMAIL, actorEmail: OWNER_EMAIL }),   // attacker-controlled body; must be ignored
  });
  const who = await identify(request, {});
  assert.equal(who.email, NON_OWNER_EMAIL);                       // identify() never reads the body
  const actor = await resolveActor(identify, request, {});
  assert.equal(actor.email, NON_OWNER_EMAIL);
  assert.equal(isSuperAdmin(actor, {}), false);

  const db = dbWithTenant();
  await assert.rejects(() => requireCan({ db, identifyFn: identify }, request, {}, "t1", "tenant:read"), PermissionError);
});

test("the super-admin check DOES grant when identify()'s verified header email is itself an owner address", async () => {
  const request = new Request("https://stewardmd.in/api/connect/onboard/tenants", {
    method: "GET",
    headers: { "Cf-Access-Authenticated-User-Email": OWNER_EMAIL },
  });
  const db = dbWithTenant();
  const r = await requireCan({ db, identifyFn: identify }, request, {}, "t1", "member:remove");
  assert.equal(r.role, "superadmin");
});

// sanity: can() itself, independent of the resolution path above
test("can('superadmin', action) is true for every declared action (sanity-checks the matrix used above)", () => {
  for (const a of ACTIONS) assert.equal(can("superadmin", a), true);
});
