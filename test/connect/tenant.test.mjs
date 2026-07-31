import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSandboxAllowed, SANDBOX_ALLOWLIST, loadConnectorConfig } from "../../functions/_connect/tenant.js";
import { SandboxViolation } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

test("sandbox mode allows an allow-listed base_url", () => {
  assert.doesNotThrow(() => assertSandboxAllowed({ mode: "sandbox" }, { base_url: "https://r4.smarthealthit.org/fhir" }, SANDBOX_ALLOWLIST));
});
test("sandbox mode blocks a non-allow-listed (real) base_url", () => {
  assert.throws(() => assertSandboxAllowed({ mode: "sandbox" }, { base_url: "https://fhir.realhospital.example/" }, SANDBOX_ALLOWLIST), SandboxViolation);
});
test("live mode is refused entirely in Phase 0 (no consent yet)", () => {
  assert.throws(() => assertSandboxAllowed({ mode: "live" }, { base_url: "https://r4.smarthealthit.org/fhir" }, SANDBOX_ALLOWLIST), SandboxViolation);
});
test("non-https base_url is refused even on an allow-listed host", () => {
  assert.throws(() => assertSandboxAllowed({ mode: "sandbox" }, { base_url: "http://r4.smarthealthit.org/fhir" }, SANDBOX_ALLOWLIST), SandboxViolation);
});
test("scheme spoofing (httpsevil://) is refused, not accepted as https", () => {
  assert.throws(() => assertSandboxAllowed({ mode: "sandbox" }, { base_url: "httpsevil://r4.smarthealthit.org/fhir" }, SANDBOX_ALLOWLIST), SandboxViolation);
});
test("base_url with userinfo is refused even on an allow-listed host", () => {
  assert.throws(() => assertSandboxAllowed({ mode: "sandbox" }, { base_url: "https://user:pass@r4.smarthealthit.org/fhir" }, SANDBOX_ALLOWLIST), SandboxViolation);
});
test("loadConnectorConfig picks the right row when a tenant has more than one connector", async () => {
  const db = makeMockDb({
    connect_connector_config: [
      { tenant_id: "t1", connector_id: "fhir-r4", kind: "fhir-r4", profile: "pull", base_url: "https://r4.smarthealthit.org/fhir", scope: "[]" },
      { tenant_id: "t1", connector_id: "hl7", kind: "hl7v2", profile: "pull", base_url: "https://synthea.local/hl7", scope: "[]" },
    ],
  });
  const config = await loadConnectorConfig(db, "t1", "hl7");
  assert.equal(config.connector_id, "hl7");
});
