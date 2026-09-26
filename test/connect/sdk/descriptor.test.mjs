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
  assert.equal(d.sccmVersion, "1.0");
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

test("assertDescriptor accepts the real connectors and rejects bad shapes", () => {
  assert.doesNotThrow(() => assertDescriptor(describe(fhirR4Connector)));
  assert.doesNotThrow(() => assertDescriptor(describe(abdmConnector)));
  assert.throws(() => assertDescriptor(describe({ meta: { id: "x", profile: "pull", sccmVersion: "2.0", kinds: [] } })), /sccmVersion/);
  assert.throws(() => assertDescriptor(describe({ meta: { id: "x", profile: "push", sccmVersion: "1.0", kinds: [] } })), /profile/);
  assert.throws(() => assertDescriptor(describe({ meta: { profile: "pull", sccmVersion: "1.0", kinds: [] } })), /id/);
});
