// test/connect/sdk/registry.test.mjs — Task 3: fail-closed, per-request registry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../../../functions/_connect/sdk/registry.js";
import { UpstreamError } from "../../../functions/_connect/permission.js";
import { fhirR4Connector } from "../../../functions/_connect/connectors/fhir-r4/connector.js";
import { abdmConnector } from "../../../functions/_connect/abdm/connector.js";

const broken = { meta: { id: "broken", profile: "pull", sccmVersion: "1.0", kinds: [] } };   // missing pull methods
const badVer = { meta: { id: "bv", profile: "pull", sccmVersion: "2.0", kinds: [] }, capabilities: async () => ({}), authenticate: async () => ({}), validate: async () => ({}), fetchPatient: async () => ({}), normalize: async () => ({}) };

test("register accepts a clean connector; refuses broken/duplicate/bad-version (fail-closed)", () => {
  const r = createRegistry();
  r.register(fhirR4Connector);
  assert.equal(r.has("fhir-r4"), true);
  assert.throws(() => r.register(broken));                 // missing methods
  assert.throws(() => r.register(badVer));                 // sccmVersion 2.0
  assert.throws(() => r.register(fhirR4Connector));        // duplicate id
  assert.equal(r.list().length, 1);                        // nothing bad was added
});

test("resolve throws UpstreamError on unknown id and on profile mismatch", () => {
  const r = createRegistry().register(fhirR4Connector).register(abdmConnector);
  assert.throws(() => r.resolve("nope"), UpstreamError);
  assert.throws(() => r.resolve("fhir-r4", "event"), UpstreamError);   // fhir-r4 is pull
  assert.equal(r.resolve("fhir-r4", "pull").meta.id, "fhir-r4");
  assert.equal(r.resolve("abdm", "event").meta.id, "abdm");
});

test("asConnectorMap is frozen and mutation-safe", () => {
  const m = createRegistry().register(fhirR4Connector).asConnectorMap();
  assert.equal(Object.isFrozen(m), true);
  assert.throws(() => { "use strict"; m.evil = 1; });      // frozen -> throws in strict mode
  assert.deepEqual(Object.keys(m), ["fhir-r4"]);
});

test("list() returns DESCRIPTORS, not connector code/secrets", () => {
  const list = createRegistry().register(fhirR4Connector).list();
  assert.equal(typeof list[0].capabilities, "object");     // a descriptor
  assert.equal(list[0].profile, "pull");
  assert.equal("fetchPatient" in list[0], false);          // no connector methods leaked
});

test("registries are isolated — no shared mutable state", () => {
  const a = createRegistry().register(fhirR4Connector);
  const b = createRegistry();
  assert.equal(b.has("fhir-r4"), false);                   // B did not inherit A's registration
  b.register(abdmConnector);
  assert.equal(a.has("abdm"), false);                      // A unaffected by B
});
