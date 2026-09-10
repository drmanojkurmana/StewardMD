// test/connect/sdk/catalog.test.mjs -- Task 4: built-in catalog + defaultRegistry + barrel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultRegistry, BUILTIN } from "../../../functions/_connect/sdk/catalog.js";
import * as sdk from "../../../functions/_connect/sdk/index.js";

test("defaultRegistry has all built-ins with the right profiles", () => {
  const r = defaultRegistry();
  assert.equal(r.has("fhir-r4"), true);
  assert.equal(r.has("abdm"), true);
  assert.equal(r.has("rest-json"), true);
  assert.equal(r.has("dicomweb"), true);
  assert.equal(r.has("graphql"), true);
  assert.equal(r.has("sql"), true);
  assert.equal(r.has("browser-session"), true);
  assert.equal(r.resolve("fhir-r4").meta.profile, "pull");
  assert.equal(r.resolve("abdm").meta.profile, "event");
  assert.equal(r.resolve("rest-json").meta.profile, "pull");
  assert.equal(r.resolve("dicomweb").meta.profile, "pull");
  assert.equal(r.resolve("graphql").meta.profile, "pull");
  assert.equal(r.resolve("sql").meta.profile, "pull");
  assert.equal(r.resolve("browser-session").meta.profile, "pull");
  assert.deepEqual(Object.keys(r.asConnectorMap()).sort(), ["abdm", "browser-session", "dicomweb", "fhir-r4", "graphql", "rest-json", "sql"]);
});

test("each defaultRegistry() call is a DISTINCT instance (per-request isolation)", () => {
  const a = defaultRegistry(), b = defaultRegistry();
  assert.notEqual(a, b);
  assert.notEqual(a.asConnectorMap(), b.asConnectorMap());  // distinct frozen maps
  assert.equal(Object.isFrozen(BUILTIN), true);
});

test("index.js re-exports the public surface", () => {
  for (const sym of ["describe", "assertDescriptor", "runConformance", "assertConforms", "ConformanceError", "createRegistry", "defaultRegistry"]) {
    assert.ok(sdk[sym], "missing export: " + sym);
  }
});
