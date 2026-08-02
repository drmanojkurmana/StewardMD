// test/connect/onboard/self-serve.test.mjs — P1 self-service tenant creation:
// any authenticated doctor/owner creates their OWN hospital and becomes its `owner`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../../functions/api/connect/onboard/[[path]].js";
import { makeMockDb } from "../../../functions/_connect/testkit.js";
import { sha256hex } from "../../../functions/_usage.js";

const post = (body, env, headers) => ({
  request: new Request("https://x/api/connect/onboard/tenants", {
    method: "POST", body: JSON.stringify(body),
    headers: Object.assign({ "content-type": "application/json" }, headers || {}),
  }), env, params: {},
});
const ON = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" };
const HDR = { "Cf-Access-Authenticated-User-Email": "doc@hospital.test" };

test("self-serve: an authenticated doctor creates their hospital and is seeded as owner", async () => {
  const db = makeMockDb({ connect_tenant: [], connect_membership: [] });
  const res = await onRequest(post({ name: "Test Hospital" }, Object.assign({ CONNECT_DB: db }, ON), HDR));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.role, "owner");
  assert.equal(body.mode, "sandbox");                       // no PHI/live opened here
  assert.match(body.id, /^test-hospital-[a-z0-9]{1,6}$/);    // SERVER-generated slug id (never client-supplied)
  // a connect_tenant row (sandbox) + an owner connect_membership for the caller were inserted
  const actor = "cfa:" + (await sha256hex("doc@hospital.test"));
  assert.equal(db._tables.connect_tenant.length, 1);
  assert.deepEqual(db._tables.connect_tenant[0]._raw.slice(0, 4), [body.id, "Test Hospital", "active", "sandbox"]);
  assert.equal(db._tables.connect_membership.length, 1);
  assert.deepEqual(db._tables.connect_membership[0]._raw, [actor, body.id, "owner"]);
});

test("self-serve: a guest (no verified identity) cannot create a tenant -> 401", async () => {
  const res = await onRequest(post({ name: "X" }, Object.assign({ CONNECT_DB: makeMockDb({}) }, ON)));  // no auth header
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "auth");
});

test("self-serve: a blank hospital name is rejected -> 403", async () => {
  const res = await onRequest(post({ name: "   " }, Object.assign({ CONNECT_DB: makeMockDb({}) }, ON), HDR));
  assert.equal(res.status, 403);
});

test("self-serve: CONNECT_SELFSERVE_FLAG=0 disables the surface -> 404 (no existence leak, before auth)", async () => {
  const env = Object.assign({ CONNECT_DB: makeMockDb({}), CONNECT_SELFSERVE_FLAG: "0" }, ON);
  const res = await onRequest(post({ name: "X" }, env, HDR));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

test("self-serve: the client CANNOT supply/hijack a tenant id (server generates it from the name)", async () => {
  const db = makeMockDb({ connect_tenant: [], connect_membership: [] });
  const res = await onRequest(post({ name: "My Clinic", id: "stewardmd-test", tenantId: "stewardmd-test" }, Object.assign({ CONNECT_DB: db }, ON), HDR));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.notEqual(body.id, "stewardmd-test");               // ignored the client id
  assert.match(body.id, /^my-clinic-[a-z0-9]{1,6}$/);
});
