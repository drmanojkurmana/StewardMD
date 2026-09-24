/* A hospital added through Connect appears in the StewardMD app's hospital picker (owner decision
 * 2026-09-24, option A: one hospital, both registries).
 *
 * The bug: a hospital created through the adapter lived only in CONNECT_DB, and the app's picker reads
 * Firestore q_orgs, so it was connected to the server and absent from the app. The assertion that
 * matters is the last hop - GET /api/queue/orgs, what the picker actually reads - lists it, with the
 * exact fields the picker filters on (mode "connect" + a connectorId), and lists it ONCE however many
 * times it is linked.
 *
 * node --test --experimental-test-module-mocks test/connect-opd-org-link.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docs, api, seed, uidFor, ENV, OWNER_A, OWNER_B } from "./helpers/opd-router-harness.mjs";
// Imported AFTER the harness has mocked Firestore: a static import is hoisted and would load the real one.
const { linkTenantToOpdOrg } = await import("../functions/_connect/onboard/opd-org-link.js");

const TENANT = { id: "adapter-hospital-a1b2c3", name: "Adapter Hospital" };
const pickerRows = (r) => (r.orgs || []).filter((o) => o.mode === "connect" && o.connectorId);   // queue.js _listHospitals
const linked = (r) => pickerRows(r).filter((o) => o.connectTenantId === TENANT.id);

test("a Connect hospital is linked into the app's registry and shows in the hospital picker", async () => {
  seed();
  assert.equal(linked(await api("/orgs", "GET", null, OWNER_A)).length, 0, "before: connected to the server, absent from the app");

  const r = await linkTenantToOpdOrg(ENV, TENANT, uidFor(OWNER_A));
  assert.equal(r.created, true);
  assert.equal(r.org.mode, "connect");
  assert.equal(r.org.connectorId, "connect", "the connector _opd_connect_connector.js resolves");
  assert.equal(r.org.connectTenantId, TENANT.id);

  const after = await api("/orgs", "GET", null, OWNER_A);
  assert.equal(after.__status, 200, JSON.stringify(after));
  const rows = linked(after);
  assert.equal(rows.length, 1, "the picker now lists it: " + JSON.stringify(after.orgs).slice(0, 300));
  assert.equal(rows[0].name, "Adapter Hospital");
});

test("linking is idempotent: a second link, or a hospital already linked, never makes a second org", async () => {
  seed();
  const first = await linkTenantToOpdOrg(ENV, TENANT, uidFor(OWNER_A));
  const again = await linkTenantToOpdOrg(ENV, TENANT, uidFor(OWNER_A));
  assert.equal(again.created, false);
  assert.equal(again.org.id, first.org.id, "the same org comes back");
  const orgs = [...docs.keys()].filter((k) => k.startsWith("q_orgs/") && docs.get(k).fields.connectTenantId === TENANT.id);
  assert.equal(orgs.length, 1, "one hospital, one org");
  assert.equal(linked(await api("/orgs", "GET", null, OWNER_A)).length, 1);
});

test("it is the creator's hospital, not everyone's: another hospital's owner does not see it", async () => {
  seed();
  await linkTenantToOpdOrg(ENV, TENANT, uidFor(OWNER_A));
  assert.equal(linked(await api("/orgs", "GET", null, OWNER_B)).length, 0);
  assert.equal((await api("/orgs", "GET", null)).__status, 401, "signed out sees nothing");
});

test("it refuses to link without a tenant or an actor rather than writing an ownerless org", async () => {
  seed();
  await assert.rejects(() => linkTenantToOpdOrg(ENV, {}, uidFor(OWNER_A)), /tenant_required/);
  await assert.rejects(() => linkTenantToOpdOrg(ENV, TENANT, ""), /actor_required/);
  assert.equal([...docs.keys()].filter((k) => k.startsWith("q_orgs/") && docs.get(k).fields.connectTenantId).length, 0);
});
