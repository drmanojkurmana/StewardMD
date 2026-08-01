// test/connect/onboard/dashboard.test.mjs — Part 3 (Enterprise): the membership tenant picker + the unified
// connections view. Proves:
//   • GET /tenants (listMyTenants) returns ONLY the caller's memberships, keyed strictly by the SERVER actor id
//     (a user in tenant A does NOT see tenant B; the request body is ignored) => no cross-user enumeration;
//   • a stored display name is returned, a name-equal-to-id is omitted (we never invent names);
//   • the unified view (listAll) MERGES FHIR connections + HL7 feeds for the selected tenant, omits ALL secret
//     material, and is tenant-scoped (a member of one tenant cannot read another's -> no IDOR);
//   • RBAC: a non-member gets nothing (fail-closed) for a tenant they do not belong to;
//   • the HTTP surface: flag-OFF -> 404 (no existence leak); flag-ON + unauthenticated -> sanitized 401.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listMyTenants } from "../../../functions/_connect/enterprise/members.js";
import { listAll } from "../../../functions/_connect/onboard/dashboard.js";
import { saveConnection } from "../../../functions/_connect/onboard/store.js";
import { createFeed } from "../../../functions/_connect/onboard/hl7-feed.js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { onRequest } from "../../../functions/api/connect/onboard/[[path]].js";
import { makeOnboardDb } from "./onboard-db.mjs";

const MASTER = Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
const env = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_MASTER_KEY: MASTER };
const BOTH = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" };
const secrets = () => makeSecrets(env);
const asUser = (db, id) => ({ db, secrets: secrets(), identifyFn: async () => ({ id, guest: false }) });
const req = { request: new Request("https://stewardmd.in/api/connect/onboard/all", { method: "GET" }) };
const tokenBody = (name) => ({ name, type: "fhir", fhirBaseUrl: "https://fhir.example.org/r4", auth: { method: "token", token: "sekret-bearer-" + name } });

// u1 is an admin of BOTH t-a (display name "GIMSR Hospital") and t-b (no display name: name === id).
// u2 is an admin of ONLY t-c. Intruder is a member of nothing.
const world = () => makeOnboardDb({
  connect_membership: [
    { user_id: "u1", tenant_id: "t-a", role: "admin" },
    { user_id: "u1", tenant_id: "t-b", role: "owner" },
    { user_id: "u2", tenant_id: "t-c", role: "admin" },
  ],
  connect_tenant: [
    { id: "t-a", name: "GIMSR Hospital", mode: "sandbox", granted_scopes: "[]" },
    { id: "t-b", name: "t-b", mode: "sandbox", granted_scopes: "[]" },   // name defaulted to id -> omitted
    { id: "t-c", name: "Other Hospital", mode: "sandbox", granted_scopes: "[]" },
  ],
});

test("GET /tenants: returns ONLY the caller's memberships (u1 sees t-a + t-b, NOT t-c)", async () => {
  const db = world();
  const mine = await listMyTenants(asUser(db, "u1"), req.request, env);
  const ids = mine.map((t) => t.tenantId).sort();
  assert.deepEqual(ids, ["t-a", "t-b"]);              // u2's t-c is NOT visible
  const a = mine.find((t) => t.tenantId === "t-a");
  assert.equal(a.role, "admin");
  assert.equal(a.name, "GIMSR Hospital");             // real display name surfaced
  const b = mine.find((t) => t.tenantId === "t-b");
  assert.equal(b.role, "owner");
  assert.equal(b.name, undefined);                    // name === id -> omitted (never invented)
});

test("GET /tenants: a different actor sees a DISJOINT set (u2 sees only t-c)", async () => {
  const db = world();
  const mine = await listMyTenants(asUser(db, "u2"), req.request, env);
  assert.deepEqual(mine.map((t) => t.tenantId), ["t-c"]);
  assert.equal(mine[0].name, "Other Hospital");
});

test("GET /tenants: keyed by the SERVER actor id, NOT the request body (no cross-user enumeration)", async () => {
  const db = world();
  // An attacker (u2) sends a body claiming to be u1 / asking for t-a. The body is ignored; identify() wins.
  const spoof = { request: new Request("https://stewardmd.in/api/connect/onboard/tenants", { method: "GET" }) };
  const deps = asUser(db, "u2");
  const mine = await listMyTenants(deps, spoof.request, env);
  assert.deepEqual(mine.map((t) => t.tenantId), ["t-c"]);   // still only u2's own tenant
});

test("GET /tenants: an actor with no memberships gets an empty list (the no-membership state)", async () => {
  const db = world();
  assert.deepEqual(await listMyTenants(asUser(db, "nobody"), req.request, env), []);
});

test("unified /all: MERGES this tenant's FHIR connections + HL7 feeds with counts", async () => {
  const db = world();
  await saveConnection(asUser(db, "u1"), req.request, env, "t-a", tokenBody("Main FHIR"));
  await saveConnection(asUser(db, "u1"), req.request, env, "t-a", tokenBody("Backup FHIR"));
  await createFeed(asUser(db, "u1"), req.request, env, "t-a", { name: "Lab Feed", allowedMessageTypes: ["ORU^R01"] });

  const all = await listAll(asUser(db, "u1"), req.request, env, "t-a");
  assert.equal(all.fhir.length, 2);
  assert.equal(all.hl7.length, 1);
  assert.deepEqual(all.counts, { fhir: 2, hl7: 1, total: 3 });
  assert.equal(all.fhir[0].type, "fhir");
  assert.equal(all.hl7[0].name, "Lab Feed");
  assert.deepEqual(all.hl7[0].allowedMessageTypes, ["ORU^R01"]);
});

test("unified /all: NEVER returns secret material (sealed token / hmac secret)", async () => {
  const db = world();
  await saveConnection(asUser(db, "u1"), req.request, env, "t-a", tokenBody("Secure FHIR"));
  const created = await createFeed(asUser(db, "u1"), req.request, env, "t-a", { name: "Secure Feed" });
  const all = await listAll(asUser(db, "u1"), req.request, env, "t-a");
  const blob = JSON.stringify(all);
  for (const leak of ["sekret-bearer-Secure FHIR", "sealed", "secret_sealed", "secret_ref", created.secret]) {
    assert.equal(blob.includes(leak), false);
  }
});

test("unified /all: tenant-scoped — u1's t-a view does NOT include another tenant's rows (no IDOR)", async () => {
  const db = world();
  await saveConnection(asUser(db, "u1"), req.request, env, "t-a", tokenBody("A-FHIR"));
  // u2 puts a connection in t-c; it must never appear in u1's t-a view.
  await saveConnection(asUser(db, "u2"), req.request, env, "t-c", tokenBody("C-FHIR"));
  const all = await listAll(asUser(db, "u1"), req.request, env, "t-a");
  assert.equal(all.fhir.length, 1);
  assert.equal(all.fhir[0].name, "A-FHIR");
  assert.equal(JSON.stringify(all).includes("C-FHIR"), false);
});

test("unified /all: a NON-MEMBER is denied a tenant they do not belong to (fail-closed RBAC, no leak)", async () => {
  const db = world();
  await saveConnection(asUser(db, "u2"), req.request, env, "t-c", tokenBody("C-FHIR"));
  // u1 is NOT a member of t-c -> resolveTenant throws PermissionError; nothing is returned.
  await assert.rejects(() => listAll(asUser(db, "u1"), req.request, env, "t-c"));
  // an outright non-member of everything is likewise denied
  await assert.rejects(() => listAll(asUser(db, "intruder"), req.request, env, "t-a"));
});

// ---- HTTP surface (router) --------------------------------------------------------------------------------
const rget = (path, e) => onRequest({ request: new Request("https://x" + path), env: e, params: {} });

test("router: flag OFF -> 404 for /tenants and /all (no existence leak)", async () => {
  assert.equal((await rget("/api/connect/onboard/tenants", {})).status, 404);
  assert.equal((await rget("/api/connect/onboard/all?tenant=t-a", {})).status, 404);
  assert.equal((await rget("/api/connect/onboard/tenants", { CONNECT_FLAG: "1" })).status, 404);   // sub-flag off
});

test("router: flag ON + unauthenticated -> sanitized 401, no-store, only { error }", async () => {
  for (const p of ["/api/connect/onboard/tenants", "/api/connect/onboard/all?tenant=t-a"]) {
    const res = await rget(p, BOTH);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(await res.json()), ["error"]);
  }
});
