// test/connect/onboard/probe.test.mjs — the capability probe: success (fhirVersion/software from metadata),
// each error class (bad-url | tls | unauthorized | not-fhir | unreachable), token vs SMART auth headers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runProbe, testConnection } from "../../../functions/_connect/onboard/probe.js";
import { saveConnection, listConnections } from "../../../functions/_connect/onboard/store.js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { makeOnboardDb } from "./onboard-db.mjs";
import { makeMockFhir } from "../smart/mock-fhir-server.mjs";
import { RS384_PRIVATE_JWK } from "../smart/fixtures/smart-keys.mjs";

const jr = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const CS = { resourceType: "CapabilityStatement", fhirVersion: "4.0.1", software: { name: "HAPI FHIR" } };
const BUNDLE = { resourceType: "Bundle", type: "searchset", entry: [] };

// Recording mock: routes by path; records the headers each call saw (to assert the auth header applied).
function recMock(routes) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url); seen.push({ path: u.pathname, headers: init.headers || {} });
    const r = routes[u.pathname.replace(/^.*\/(metadata|Patient)$/, "$1")] || routes[u.pathname];
    if (typeof r === "function") return r(u, init);
    return r || new Response("nf", { status: 404 });
  };
  return { fetch, seen, now: () => Date.now() };
}
const tokenConfig = { authMethod: "token" };
const creds = { token: "sekret-123" };
const BASE = "https://fhir.example.org/r4";

test("token probe success -> ok with fhirVersion + softwareName; Authorization: Bearer applied", async () => {
  const deps = recMock({ metadata: () => jr(CS), Patient: () => jr(BUNDLE) });
  const res = await runProbe(deps, BASE, tokenConfig, creds);
  assert.deepEqual(res, { ok: true, fhirVersion: "4.0.1", softwareName: "HAPI FHIR" });
  assert.equal(deps.seen[0].headers.authorization, "Bearer sekret-123");
});

test("token probe with a custom headerName sends the token under that header (not Authorization)", async () => {
  const deps = recMock({ metadata: () => jr(CS), Patient: () => jr(BUNDLE) });
  const res = await runProbe(deps, BASE, { authMethod: "token", headerName: "X-API-Key" }, creds);
  assert.equal(res.ok, true);
  assert.equal(deps.seen[0].headers["X-API-Key"], "sekret-123");
  assert.equal(deps.seen[0].headers.authorization, undefined);
});

test("error class: bad-url (non-https base)", async () => {
  const deps = recMock({});
  assert.deepEqual(await runProbe(deps, "http://fhir.example.org/r4", tokenConfig, creds), { ok: false, error: "bad-url" });
});

test("error class: tls (certificate failure surfaces as tls, no message leak)", async () => {
  const deps = recMock({ metadata: () => { const e = new TypeError("fetch failed"); e.cause = { code: "CERT_HAS_EXPIRED" }; throw e; } });
  assert.deepEqual(await runProbe(deps, BASE, tokenConfig, creds), { ok: false, error: "tls" });
});

test("error class: unreachable (DNS/connect failure)", async () => {
  const deps = recMock({ metadata: () => { const e = new TypeError("fetch failed"); e.cause = { code: "ENOTFOUND" }; throw e; } });
  assert.deepEqual(await runProbe(deps, BASE, tokenConfig, creds), { ok: false, error: "unreachable" });
});

test("error class: unauthorized (401 from metadata)", async () => {
  const deps = recMock({ metadata: () => new Response("", { status: 401 }) });
  assert.deepEqual(await runProbe(deps, BASE, tokenConfig, creds), { ok: false, error: "unauthorized" });
});

test("error class: not-fhir (metadata is not a CapabilityStatement)", async () => {
  const deps = recMock({ metadata: () => jr({ resourceType: "OperationOutcome" }) });
  assert.deepEqual(await runProbe(deps, BASE, tokenConfig, creds), { ok: false, error: "not-fhir" });
});

test("error class: unauthorized when Patient search is 401 even though metadata is fine", async () => {
  const deps = recMock({ metadata: () => jr(CS), Patient: () => new Response("", { status: 401 }) });
  assert.deepEqual(await runProbe(deps, BASE, tokenConfig, creds), { ok: false, error: "unauthorized" });
});

test("SMART probe: discovery + private_key_jwt token, then metadata/Patient succeed (reused signer)", async () => {
  const mock = makeMockFhir({ base: "https://fhir.example.org" });
  const deps = { fetch: mock.fetch, now: () => Date.now() };
  const smartConfig = { authMethod: "smart" };               // tokenEndpoint discovered from .well-known
  const smartCreds = { clientId: "cid", privateKeyJwk: RS384_PRIVATE_JWK, kid: RS384_PRIVATE_JWK.kid, alg: "RS384" };
  const res = await runProbe(deps, "https://fhir.example.org/fhir", smartConfig, smartCreds);
  assert.equal(res.ok, true);
  assert.ok(mock.calls.some((c) => c.method === "POST"));     // a real token exchange happened
});

test("SMART probe SSRF-rejects a discovered token endpoint on a private host (nothing signed/POSTed)", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url); calls.push({ method: (init.method || "GET"), path: u.pathname });
    if (u.pathname.endsWith("/.well-known/smart-configuration")) return jr({ token_endpoint: "https://169.254.169.254/token" });
    return new Response("nf", { status: 404 });
  };
  const res = await runProbe({ fetch, now: () => Date.now() }, "https://fhir.example.org/fhir", { authMethod: "smart" },
    { clientId: "cid", privateKeyJwk: RS384_PRIVATE_JWK, kid: RS384_PRIVATE_JWK.kid, alg: "RS384" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "bad-url");                          // discovered token endpoint SSRF-rejected
  assert.equal(calls.some((c) => c.method === "POST"), false); // never signed/POSTed to the private host
});

test("testConnection endpoint records last-test, flips status to active, and audits (PHI-free)", async () => {
  const env = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(4)).toString("base64") };
  const mock = makeMockFhir({ base: "https://fhir.example.org" });
  const db = makeOnboardDb({ connect_membership: [{ user_id: "u1", tenant_id: "t1", role: "admin" }], connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }] });
  const deps = { db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }), fetch: mock.fetch, now: () => Date.now() };
  const { connectionId } = await saveConnection(deps, {}, env, "t1", { name: "P", type: "fhir", fhirBaseUrl: mock.base, auth: { method: "token", token: "mock-access-1" } });

  const res = await testConnection(deps, {}, env, "t1", connectionId);
  assert.equal(res.ok, true);
  const list = await listConnections(deps, {}, env, "t1");
  assert.equal(list[0].status, "active");
  assert.equal(list[0].lastTest.ok, true);
  assert.ok((db._tables.connect_audit_event || []).some((r) => r.action === "connect.onboard.tested"));
});
