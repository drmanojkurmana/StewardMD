// test/connect/sdk/existing-connectors-conform.test.mjs — Task 6: fhir-r4 (pull) + abdm (event skeleton)
// pass the conformance kit AS-IS. NO connector edits (the two files are imported read-only and unchanged).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runConformance } from "../../../functions/_connect/sdk/conformance.js";
import { fhirR4Connector } from "../../../functions/_connect/connectors/fhir-r4/connector.js";
import { abdmConnector } from "../../../functions/_connect/abdm/connector.js";
import { SYNTHETIC } from "../fixtures/fhir-synthetic.mjs";

// Synthetic FHIR fetch: /Patient/{ref} -> the patient; /{Type}?patient=... -> that type's entries only.
const fetchOk = async (url) => {
  const u = String(url);
  if (/\/Patient\/[^/?]+$/.test(u)) return new Response(JSON.stringify(SYNTHETIC.patient));
  const m = u.match(/\/([A-Za-z]+)\?/);
  const type = m ? m[1] : null;
  const entry = SYNTHETIC.resources.filter((r) => !type || r.resourceType === type).map((r) => ({ resource: r }));
  return new Response(JSON.stringify({ entry }));
};

test("fhir-r4 (pull) conforms as-is — checks 1-10 with 6/7 active", async () => {
  const r = await runConformance(fhirR4Connector, { fetch: fetchOk, fixtures: { patientRef: "P1" } });
  assert.equal(r.passed, true, "failed: " + JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.descriptor.profile, "pull");
  assert.equal(r.checks.find((c) => c.name === "6-valid-sccm").skipped, false);
  assert.equal(r.checks.find((c) => c.name === "7-deterministic-ids").ok, true);
});

test("abdm (event skeleton) conforms as-is — 6/7 SKIPPED, 1-5/8-10 green", async () => {
  const r = await runConformance(abdmConnector, { fixtures: { rawEvent: { type: "data-push", requestId: "r1" } } });
  assert.equal(r.passed, true, "failed: " + JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.descriptor.profile, "event");
  assert.equal(r.descriptor.capabilities.emitsBundle, false);
  assert.equal(r.checks.find((c) => c.name === "6-valid-sccm").skipped, true);
  assert.equal(r.checks.find((c) => c.name === "7-deterministic-ids").skipped, true);
  assert.equal(r.checks.find((c) => c.name === "8-no-phi-in-audit").ok, true);
  assert.equal(r.checks.find((c) => c.name === "10-fail-closed").ok, true);
});

// The "as-is" claim: this file imports both connectors read-only and modifies neither.
