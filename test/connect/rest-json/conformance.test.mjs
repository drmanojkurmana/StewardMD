// test/connect/rest-json/conformance.test.mjs — rest-json (pull) passes the profile-aware conformance kit
// unmodified, same shape as fhir-r4 in test/connect/sdk/existing-connectors-conform.test.mjs. 6/7 ACTIVE
// (a pull connector always emits a bundle); 8 (no PHI in audit), 9 (sentinel secret never leaks), and 10
// (fail-closed on a rejecting fetch) are the security-critical checks for a brand-new built-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runConformance } from "../../../functions/_connect/sdk/conformance.js";
import { restJsonConnector } from "../../../functions/_connect/connectors/rest-json/connector.js";

const ROWS = [{ patientId: "P1", testCode: "718-7", testCodeSystem: "LN", testName: "Hemoglobin", value: 9.2, unit: "g/dL", orderId: "O1", collectedAt: "2026-08-01", resultStatus: "final" }];
const okFetch = async () => new Response(JSON.stringify(ROWS), { status: 200 });

test("rest-json (pull) conforms — checks 1-10 with 6/7 active", async () => {
  const r = await runConformance(restJsonConnector, { fetch: okFetch, fixtures: { patientRef: "P1" } });
  assert.equal(r.passed, true, "failed: " + JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.descriptor.profile, "pull");
  assert.equal(r.checks.find((c) => c.name === "6-valid-sccm").skipped, false);
  assert.equal(r.checks.find((c) => c.name === "7-deterministic-ids").ok, true);
  assert.equal(r.checks.find((c) => c.name === "8-no-phi-in-audit").ok, true);
  assert.equal(r.checks.find((c) => c.name === "9-no-secret-leak").ok, true);
  assert.equal(r.checks.find((c) => c.name === "10-fail-closed").ok, true);
});
