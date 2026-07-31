import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSandboxAllowed, SANDBOX_ALLOWLIST } from "../../functions/_connect/tenant.js";
import { SandboxViolation } from "../../functions/_connect/permission.js";

test("sandbox mode allows an allow-listed base_url", () => {
  assert.doesNotThrow(() => assertSandboxAllowed({ mode: "sandbox" }, { base_url: "https://r4.smarthealthit.org/fhir" }, SANDBOX_ALLOWLIST));
});
test("sandbox mode blocks a non-allow-listed (real) base_url", () => {
  assert.throws(() => assertSandboxAllowed({ mode: "sandbox" }, { base_url: "https://fhir.realhospital.example/" }, SANDBOX_ALLOWLIST), SandboxViolation);
});
test("live mode is refused entirely in Phase 0 (no consent yet)", () => {
  assert.throws(() => assertSandboxAllowed({ mode: "live" }, { base_url: "https://r4.smarthealthit.org/fhir" }, SANDBOX_ALLOWLIST), SandboxViolation);
});
