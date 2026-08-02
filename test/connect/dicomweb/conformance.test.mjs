// test/connect/dicomweb/conformance.test.mjs — dicomweb (pull) passes the profile-aware conformance kit
// unmodified, same shape as rest-json in test/connect/rest-json/conformance.test.mjs. 6/7 ACTIVE (a pull
// connector always emits a bundle); 8 (no PHI in audit), 9 (sentinel secret never leaks), and 10 (fail-closed
// on a rejecting fetch) are the security-critical checks for a brand-new built-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runConformance } from "../../../functions/_connect/sdk/conformance.js";
import { dicomWebConnector } from "../../../functions/_connect/connectors/dicomweb/connector.js";

const STUDY = {
  "0020000D": { vr: "UI", Value: ["1.2.840.113619.2.55.1.1"] },
  "00080061": { vr: "CS", Value: ["CT"] },
  "00201206": { vr: "IS", Value: [2] },
  "00201208": { vr: "IS", Value: [128] },
};
const okFetch = async () => new Response(JSON.stringify([STUDY]), { status: 200 });

test("dicomweb (pull) conforms — checks 1-10 with 6/7 active", async () => {
  const r = await runConformance(dicomWebConnector, { fetch: okFetch, fixtures: { patientRef: "P1" } });
  assert.equal(r.passed, true, "failed: " + JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.descriptor.profile, "pull");
  assert.equal(r.checks.find((c) => c.name === "6-valid-sccm").skipped, false);
  assert.equal(r.checks.find((c) => c.name === "7-deterministic-ids").ok, true);
  assert.equal(r.checks.find((c) => c.name === "8-no-phi-in-audit").ok, true);
  assert.equal(r.checks.find((c) => c.name === "9-no-secret-leak").ok, true);
  assert.equal(r.checks.find((c) => c.name === "10-fail-closed").ok, true);
});
