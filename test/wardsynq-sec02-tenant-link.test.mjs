/* SEC-02 (audit A2): an org may point at a Connect tenant (and so at that hospital's whole clinical
 * record) only when the caller is an owner or admin of that tenant, and never at a tenant another
 * hospital's org already uses. Before the fix, any org admin could POST /org/update with a victim
 * hospital's connectTenantId, and wsqLinkTenantOrg then repointed the victim tenant at the attacker.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-sec02-tenant-link.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import * as H from "./helpers/opd-router-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

/* CONNECT_DB double: tenants and memberships, and the one UPDATE wsqLinkTenantOrg issues. */
let tenants, memberships;
const connectDb = () => ({
  prepare: (sql) => ({ bind: (...a) => ({
    first: async () => (/FROM connect_tenant WHERE id=\?/.test(sql) ? (tenants.get(String(a[0])) ? { ...tenants.get(String(a[0])) } : null) : null),
    all: async () => ({ results: /FROM connect_membership WHERE user_id=\?/.test(sql) ? memberships.filter((m) => m.user_id === String(a[0])) : [] }),
    run: async () => {
      if (/UPDATE connect_tenant SET settings=\?/.test(sql)) { const t = tenants.get(String(a[2])); if (t) t.settings = a[0]; }
      return { success: true, meta: {} };
    },
  }) }),
  batch: async () => [],
});
const ATTACKER = H.OWNER_B;   // owns org-b, and nothing of hospital A
function world() {
  H.seed();
  H.ENV.CONNECT_DB = connectDb();
  tenants = new Map([
    ["tenant-a", { id: "tenant-a", name: "Hospital A", settings: JSON.stringify({ wardsynq: { orgId: "org-a" } }) }],
    ["tenant-new", { id: "tenant-new", name: "Hospital A record", settings: "{}" }],
    ["tenant-b2", { id: "tenant-b2", name: "B second", settings: "{}" }],
  ]);
  memberships = [
    { user_id: H.uidFor(H.OWNER_A), tenant_id: "tenant-a", role: "owner" },
    { user_id: H.uidFor(H.OWNER_A), tenant_id: "tenant-new", role: "owner" },
    { user_id: H.uidFor(H.OWNER_A), tenant_id: "tenant-b2", role: "clinician" },
  ];
  const a = H.docs.get("q_orgs/org-a"); a.fields = { ...a.fields, mode: "wardsynq", connectTenantId: "tenant-a" };
}
const tenantPointer = (id) => JSON.parse(tenants.get(id).settings || "{}").wardsynq;

test("an org admin cannot point their own org at another hospital's tenant", async () => {
  world();
  const r = await H.api("/org/update", "POST", { orgId: "org-b", mode: "wardsynq", connectTenantId: "tenant-a" }, ATTACKER);
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(r.error, "tenant_not_yours");
  assert.equal((await H.ORG.getOrg(H.ENV, "org-b")).connectTenantId, null, "org-b is not linked");
  assert.deepEqual(tenantPointer("tenant-a"), { orgId: "org-a" }, "the victim tenant still points at its own org");
});

test("even a tenant admin cannot give a tenant another hospital already uses to a second owner's org", async () => {
  world();
  memberships.push({ user_id: H.uidFor(ATTACKER), tenant_id: "tenant-a", role: "admin" });
  const r = await H.api("/org/update", "POST", { orgId: "org-b", connectTenantId: "tenant-a" }, ATTACKER);
  assert.equal(r.__status, 409, JSON.stringify(r));
  assert.equal(r.error, "tenant_already_linked");
  assert.deepEqual(tenantPointer("tenant-a"), { orgId: "org-a" });
});

test("a clinician of a tenant is not enough to link it", async () => {
  world();
  const a = H.docs.get("q_orgs/org-a"); a.fields = { ...a.fields, connectTenantId: null };
  const r = await H.api("/org/update", "POST", { orgId: "org-a", connectTenantId: "tenant-b2" }, H.OWNER_A);
  assert.equal(r.__status, 403, JSON.stringify(r));
});

test("the tenant's owner links their own org, the reciprocal pointer is written, and the link cannot then be moved", async () => {
  world();
  const a = H.docs.get("q_orgs/org-a"); a.fields = { ...a.fields, connectTenantId: null };
  const ok = await H.api("/org/update", "POST", { orgId: "org-a", connectTenantId: "tenant-new" }, H.OWNER_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.org.connectTenantId, "tenant-new");
  assert.deepEqual(tenantPointer("tenant-new"), { orgId: "org-a" });
  const same = await H.api("/org/update", "POST", { orgId: "org-a", connectTenantId: "tenant-new", name: "Renamed" }, H.OWNER_A);
  assert.equal(same.__status, 200, "re-saving the same link is fine");
  const move = await H.api("/org/update", "POST", { orgId: "org-a", connectTenantId: "tenant-a" }, H.OWNER_A);
  assert.equal(move.__status, 409, JSON.stringify(move));
  assert.equal(move.error, "tenant_link_immutable");
});

test("/org/from-connect: only an owner or admin of the tenant can make an org from it", async () => {
  world();
  const body = { name: "Connected", connectTenantId: "tenant-a", connectConnectionId: "conn-1" };
  const denied = await H.api("/org/from-connect", "POST", body, ATTACKER);
  assert.equal(denied.__status, 403, JSON.stringify(denied));
  const ok = await H.api("/org/from-connect", "POST", body, H.OWNER_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.org.connectTenantId, "tenant-a");
});

test("wsqLinkTenantOrg never repoints a tenant that already names another org", async () => {
  world();
  // The platform owner may move a link; even then the victim tenant's own pointer is not overwritten.
  H.ENV.OWNER_EMAILS = H.OWNER_B;   // org-b's owner is also the platform owner here
  const r = await H.api("/org/update", "POST", { orgId: "org-b", connectTenantId: "tenant-a" }, H.OWNER_B);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(tenantPointer("tenant-a"), { orgId: "org-a" });
});
