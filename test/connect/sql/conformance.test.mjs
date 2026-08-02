// test/connect/sql/conformance.test.mjs — sql (pull) passes the profile-aware conformance kit unmodified,
// same shape as rest-json/graphql. The sql connector ignores ctx.fetch entirely (it reads via ctx.config.driver,
// not HTTP) and this synthetic ctx never supplies a driver, so every run exercises the STUB's honest
// not-configured path: fetchPatient returns ZERO rows + notConfigured, and normalize still produces a valid
// patient-only SCCM bundle (checks 6/7 ACTIVE on that empty bundle, never a fabricated row). 8 (no PHI in
// audit), 9 (sentinel secret never leaks) and 10 (fail-closed on a rejecting fetch — irrelevant to this
// connector, but the empty bundle already carries a warning so it counts as fail-closed) are the
// security-critical checks for a brand-new built-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runConformance } from "../../../functions/_connect/sdk/conformance.js";
import { sqlConnector } from "../../../functions/_connect/connectors/sql/connector.js";

test("sql (pull, no driver wired) conforms — checks 1-10 with 6/7 active on the empty not-configured bundle", async () => {
  const r = await runConformance(sqlConnector, { fetch: async () => new Response("{}"), fixtures: { patientRef: "P1" } });
  assert.equal(r.passed, true, "failed: " + JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.descriptor.profile, "pull");
  assert.equal(r.checks.find((c) => c.name === "6-valid-sccm").skipped, false);
  assert.equal(r.checks.find((c) => c.name === "7-deterministic-ids").ok, true);
  assert.equal(r.checks.find((c) => c.name === "8-no-phi-in-audit").ok, true);
  assert.equal(r.checks.find((c) => c.name === "9-no-secret-leak").ok, true);
  assert.equal(r.checks.find((c) => c.name === "10-fail-closed").ok, true);
});
