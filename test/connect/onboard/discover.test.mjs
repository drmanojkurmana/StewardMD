// test/connect/onboard/discover.test.mjs — auto-discovery: unauthenticated capability probe for wizard
// pre-fill. Success (fhirVersion/software + SMART detection via well-known AND via the CapabilityStatement
// oauth-uris fallback), each error class (bad-url | tls | not-fhir | unreachable), no-leak, and the full
// RBAC-gated + audited endpoint (mirrors probe.test.mjs's testConnection coverage).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDiscovery, discoverCapabilities } from "../../../functions/_connect/onboard/discover.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const jr = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const CS = { resourceType: "CapabilityStatement", fhirVersion: "4.0.1", software: { name: "HAPI FHIR" } };
const CS_OAUTH = {
  resourceType: "CapabilityStatement", fhirVersion: "4.0.1", software: { name: "HAPI FHIR" },
  rest: [{ security: { extension: [{ url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris",
    extension: [{ url: "token", valueUri: "https://fhir.example.org/oauth/token" }] }] } }],
};
const BASE = "https://fhir.example.org/r4";

// Recording mock: routes /metadata and /.well-known/smart-configuration; records every URL fetched so a
// no-fetch-to-private-host assertion (bad-url path) can be verified.
function recMock(routes) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url); seen.push({ path: u.pathname, headers: init.headers || {} });
    let r;
    if (u.pathname.endsWith("/metadata")) r = routes.metadata;
    else if (u.pathname.endsWith("/.well-known/smart-configuration")) r = routes.wellKnown;
    if (typeof r === "function") return r(u, init);
    return r || new Response("nf", { status: 404 });
  };
  return { fetch, seen, now: () => Date.now() };
}

test("success: fhirVersion + softwareName from metadata; smart.supported via well-known token_endpoint", async () => {
  const deps = recMock({ metadata: () => jr(CS), wellKnown: () => jr({ token_endpoint: "https://fhir.example.org/oauth/token" }) });
  const res = await runDiscovery(deps, BASE);
  assert.deepEqual(res, {
    ok: true,
    detected: {
      type: "fhir", fhirVersion: "4.0.1", softwareName: "HAPI FHIR",
      smart: { supported: true, tokenEndpoint: "https://fhir.example.org/oauth/token" },
      suggestedAuthMethod: "smart",
    },
  });
  assert.ok(deps.seen.some((c) => c.path.endsWith("/.well-known/smart-configuration")));
});

test("no SMART config and no oauth-uris in CapabilityStatement -> smart.supported false, suggestedAuthMethod token", async () => {
  const deps = recMock({ metadata: () => jr(CS) });   // well-known unrouted -> 404
  const res = await runDiscovery(deps, BASE);
  assert.deepEqual(res, {
    ok: true,
    detected: { type: "fhir", fhirVersion: "4.0.1", softwareName: "HAPI FHIR", smart: { supported: false }, suggestedAuthMethod: "token" },
  });
});

test("no well-known (404) but CapabilityStatement oauth-uris carries a token uri -> smart.supported true via fallback", async () => {
  const deps = recMock({ metadata: () => jr(CS_OAUTH) });   // well-known unrouted -> 404
  const res = await runDiscovery(deps, BASE);
  assert.equal(res.ok, true);
  assert.deepEqual(res.detected.smart, { supported: true, tokenEndpoint: "https://fhir.example.org/oauth/token" });
  assert.equal(res.detected.suggestedAuthMethod, "smart");
});

test("error class: not-fhir (metadata is not a CapabilityStatement)", async () => {
  const deps = recMock({ metadata: () => jr({ resourceType: "OperationOutcome" }) });
  assert.deepEqual(await runDiscovery(deps, BASE), { ok: false, error: "not-fhir" });
});

test("error class: bad-url (private/loopback baseUrl) — and no fetch reaches the private host", async () => {
  const deps = recMock({});
  assert.deepEqual(await runDiscovery(deps, "http://169.254.169.254/"), { ok: false, error: "bad-url" });
  assert.deepEqual(await runDiscovery(deps, "https://localhost/fhir"), { ok: false, error: "bad-url" });
  assert.equal(deps.seen.length, 0);   // neither bad-url attempt reached the network
});

test("error class: tls (certificate failure surfaces as tls, no message leak)", async () => {
  const deps = recMock({ metadata: () => { const e = new TypeError("fetch failed"); e.cause = { code: "CERT_HAS_EXPIRED" }; throw e; } });
  assert.deepEqual(await runDiscovery(deps, BASE), { ok: false, error: "tls" });
});

test("error class: unreachable (connect refusal)", async () => {
  const deps = recMock({ metadata: () => { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; } });
  assert.deepEqual(await runDiscovery(deps, BASE), { ok: false, error: "unreachable" });
});

test("no-leak: a thrown error's URL/message/stack never reach the client-safe result", async () => {
  const deps = recMock({
    metadata: () => { const e = new TypeError("fetch failed: https://fhir.example.org/internal-detail?token=SEKRET"); e.stack = "at secretPath (internal.js:1)"; e.cause = { code: "CERT_HAS_EXPIRED" }; throw e; },
  });
  const res = await runDiscovery(deps, BASE);
  assert.deepEqual(Object.keys(res).sort(), ["error", "ok"]);
  const s = JSON.stringify(res);
  assert.doesNotMatch(s, /SEKRET/);
  assert.doesNotMatch(s, /internal-detail/);
  assert.doesNotMatch(s, /secretPath/);
});

test("discoverCapabilities: RBAC-gated (connector:validate) + audits PHI-free, returns detected capabilities", async () => {
  const env = {};
  const db = makeOnboardDb({
    connect_membership: [{ user_id: "u1", tenant_id: "t1", role: "admin" }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
  });
  const fetchImpl = recMock({ metadata: () => jr(CS), wellKnown: () => jr({ token_endpoint: "https://fhir.example.org/oauth/token" }) }).fetch;
  const deps = { db, identifyFn: async () => ({ id: "u1", guest: false }), fetch: fetchImpl, now: () => Date.now() };

  const res = await discoverCapabilities(deps, {}, env, "t1", { baseUrl: BASE });
  assert.equal(res.ok, true);
  assert.equal(res.detected.suggestedAuthMethod, "smart");
  assert.ok((db._tables.connect_audit_event || []).some((r) => r.action === "connect.onboard.discovered" && r.outcome === "ok"));
});

test("discoverCapabilities: non-member actor is denied before any upstream fetch (fail-closed RBAC)", async () => {
  const env = {};
  const db = makeOnboardDb({ connect_membership: [], connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }] });
  const deps = { db, identifyFn: async () => ({ id: "u1", guest: false }), fetch: async () => { throw new Error("must not fetch"); }, now: () => Date.now() };
  await assert.rejects(() => discoverCapabilities(deps, {}, env, "t1", { baseUrl: BASE }));
});
