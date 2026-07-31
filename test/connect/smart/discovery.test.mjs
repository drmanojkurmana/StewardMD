// test/connect/smart/discovery.test.mjs — Task 2: discovery + token-endpoint trust gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverSmart, assertTokenEndpointAllowed, SmartError, SMART_HOST_ALLOWLIST } from "../../../functions/_connect/smart/discovery.js";
import { fhirFlagOn } from "../../../functions/_connect/smart/flags.js";
import { makeMockFhir } from "./mock-fhir-server.mjs";
import { makeMockKv } from "../../../functions/_connect/testkit.js";

const deps = (mock, kv) => ({ fetch: mock.fetch, kv, now: () => Date.now(), logger: { warn() {} } });

test("well-formed smart-configuration -> token endpoint", async () => {
  const mock = makeMockFhir();
  const d = await discoverSmart(deps(mock, makeMockKv()), { fhirBase: mock.base });
  assert.equal(d.tokenEndpoint, mock.tokenEndpoint);
  assert.deepEqual(d.algsSupported, ["RS384", "ES384"]);
});

test("CapabilityStatement fallback yields the same endpoint", async () => {
  const mock = makeMockFhir({ noWellKnown: true });
  const d = await discoverSmart(deps(mock, makeMockKv()), { fhirBase: mock.base });
  assert.equal(d.tokenEndpoint, mock.tokenEndpoint);
});

test("poisoned token_endpoint (off-allow-list host) -> SmartError, nothing returned", async () => {
  const mock = makeMockFhir({ poisonDiscovery: true });
  await assert.rejects(() => discoverSmart(deps(mock, makeMockKv()), { fhirBase: mock.base }), SmartError);
});

test("http:// or userinfo token endpoint -> SmartError", () => {
  assert.throws(() => assertTokenEndpointAllowed("http://smart-mock.local/oauth/token"), SmartError);
  assert.throws(() => assertTokenEndpointAllowed("https://u:p@smart-mock.local/oauth/token"), SmartError);
  assert.throws(() => assertTokenEndpointAllowed("https://evil.example/token"), SmartError);
  assert.doesNotThrow(() => assertTokenEndpointAllowed("https://smart-mock.local/oauth/token"));
});

test("second call hits the KV cache (one discovery fetch total)", async () => {
  const mock = makeMockFhir(); const kv = makeMockKv();
  await discoverSmart(deps(mock, kv), { fhirBase: mock.base });
  await discoverSmart(deps(mock, kv), { fhirBase: mock.base });
  const wk = mock.calls.filter((c) => c.path.includes("smart-configuration")).length;
  assert.equal(wk, 1);                                          // second call served from cache
});

test("HARDENING: a config-supplied allowlist override can only NARROW, never widen (frozen ceiling)", () => {
  // override lists the attacker host -> still refused (frozen list is the ceiling; override only intersects).
  assert.throws(() => assertTokenEndpointAllowed("https://evil.exfil.example/token", ["evil.exfil.example"]), SmartError);
  // a STRING override must not degrade .includes() to substring matching -> refused.
  assert.throws(() => assertTokenEndpointAllowed("https://evil.exfil.example/token", "prefix-evil.exfil.example-suffix"), SmartError);
  // a legitimate narrowing override still allows an on-frozen-list host.
  assert.doesNotThrow(() => assertTokenEndpointAllowed("https://smart-mock.local/oauth/token", ["smart-mock.local"]));
});

test("HARDENING: fhirBase is gated (https + frozen host) before any discovery fetch (no SSRF)", async () => {
  let fetched = false;
  const deps = { fetch: async () => { fetched = true; return new Response("{}"); }, kv: makeMockKv(), now: () => Date.now(), logger: { warn() {} } };
  await assert.rejects(() => discoverSmart(deps, { fhirBase: "http://169.254.169.254/latest/meta-data" }), SmartError);
  assert.equal(fetched, false);                                // never fetched the metadata IP
});

test("fhirFlagOn requires BOTH smd_connect and smd_connect_fhir", () => {
  assert.equal(fhirFlagOn({ CONNECT_FLAG: "1", CONNECT_FHIR_FLAG: "1" }), true);
  assert.equal(fhirFlagOn({ CONNECT_FLAG: "1" }), false);
  assert.equal(fhirFlagOn({ CONNECT_FHIR_FLAG: "1" }), false);
  assert.equal(fhirFlagOn({}), false);
  assert.ok(SMART_HOST_ALLOWLIST.includes("smart-mock.local"));
});
