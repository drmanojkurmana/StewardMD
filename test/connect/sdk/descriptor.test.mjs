// test/connect/sdk/descriptor.test.mjs — Task 1: describe + assertDescriptor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, assertDescriptor } from "../../../functions/_connect/sdk/descriptor.js";
import { fhirR4Connector } from "../../../functions/_connect/connectors/fhir-r4/connector.js";
import { abdmConnector } from "../../../functions/_connect/abdm/connector.js";

test("describe(fhir-r4) -> pull / ga / emitsBundle true", () => {
  const d = describe(fhirR4Connector);
  assert.equal(d.profile, "pull");
  assert.equal(d.lifecycle, "ga");
  assert.equal(d.capabilities.emitsBundle, true);
  assert.equal(d.sccmVersion, "1.1", "the FHIR connector emits the 1.1 collections; a 1.x minor is additive");
  assert.equal(d.id, "fhir-r4");
});

test("describe(abdm) -> event / skeleton / emitsBundle false", () => {
  const d = describe(abdmConnector);
  assert.equal(d.profile, "event");
  assert.equal(d.lifecycle, "skeleton");
  assert.equal(d.capabilities.emitsBundle, false);
});

test("meta.lifecycle / meta.capabilities overrides win over the defaults", () => {
  const c = { meta: { id: "x", profile: "event", sccmVersion: "1.0", kinds: ["k"], lifecycle: "beta", capabilities: { emitsBundle: true, eventTypes: ["data-push"] } } };
  const d = describe(c);
  assert.equal(d.lifecycle, "beta");
  assert.equal(d.capabilities.emitsBundle, true);
  assert.deepEqual(d.capabilities.eventTypes, ["data-push"]);
});

/* TASK 7 STEP 3: the plan's own required contract fields (direction/identity strategy/terminology
 * mappings/transport/retries/idempotency/ownership/read-write/health/feature flags/tenant scope). */
test("describe() states ownership, readWrite and tenantScope as structural facts, for a real pull AND a real event connector", () => {
  const pull = describe(fhirR4Connector);
  assert.equal(pull.direction, "outbound-pull");
  assert.equal(pull.ownership, "external", "external content is never relabeled native, for any connector");
  assert.equal(pull.readWrite, "read-only", "a pull connector has no ingest method");
  assert.equal(pull.tenantScope, "single-tenant");

  const event = describe(abdmConnector);
  assert.equal(event.direction, "inbound-event");
  assert.equal(event.ownership, "external");
  assert.equal(event.readWrite, "write-via-ingest", "an event connector's only effect on the record is through ingest");
  assert.equal(event.tenantScope, "single-tenant");
});

test("describe() never fabricates a per-connector fact it was not told - identityStrategy/terminologyMappings/transport/retries/idempotency/health/featureFlag default to null, not a reassuring guess", () => {
  const d = describe(fhirR4Connector);
  for (const field of ["identityStrategy", "terminologyMappings", "transport", "retries", "idempotency", "health", "featureFlag"]) {
    assert.equal(d[field], null, `${field} was not declared by this connector's meta and must not be invented`);
  }
});

test("describe() passes through a per-connector fact when the connector actually declares one", () => {
  const c = { meta: { id: "x", profile: "pull", sccmVersion: "1.0", kinds: ["k"], identityStrategy: "mrn-exact-match", terminologyMappings: "LOINC/SNOMED via terminology.js", transport: "https-pull", retries: "3x exponential backoff", idempotency: "content-digest", health: "GET /health", featureFlag: "CONNECT_X_FLAG" } };
  const d = describe(c);
  assert.equal(d.identityStrategy, "mrn-exact-match");
  assert.equal(d.terminologyMappings, "LOINC/SNOMED via terminology.js");
  assert.equal(d.transport, "https-pull");
  assert.equal(d.retries, "3x exponential backoff");
  assert.equal(d.idempotency, "content-digest");
  assert.equal(d.health, "GET /health");
  assert.equal(d.featureFlag, "CONNECT_X_FLAG");
});

test("assertDescriptor accepts the real connectors and rejects bad shapes", () => {
  assert.doesNotThrow(() => assertDescriptor(describe(fhirR4Connector)));
  assert.doesNotThrow(() => assertDescriptor(describe(abdmConnector)));
  assert.throws(() => assertDescriptor(describe({ meta: { id: "x", profile: "pull", sccmVersion: "2.0", kinds: [] } })), /sccmVersion/);
  assert.throws(() => assertDescriptor(describe({ meta: { id: "x", profile: "push", sccmVersion: "1.0", kinds: [] } })), /profile/);
  assert.throws(() => assertDescriptor(describe({ meta: { profile: "pull", sccmVersion: "1.0", kinds: [] } })), /id/);
});
