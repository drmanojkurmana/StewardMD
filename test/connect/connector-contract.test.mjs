// test/connect/connector-contract.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertConnector, makeCtx, runConformance } from "../../functions/_connect/interfaces.js";
import { patient, bundle } from "../../functions/_connect/canonical/model.js";

// a minimal in-repo mock PULL connector used to prove the harness
const mockConnector = {
  meta: { id: "mock", name: "Mock", version: "0.1", profile: "pull", kinds: ["mock"], sccmVersion: "1.0" },
  capabilities: async () => ({ resources: ["Patient"], operations: ["read"], authKinds: ["none"] }),
  authenticate: async () => ({ ok: true }),
  validate: async () => ({ ok: true, checks: [] }),
  fetchPatient: async () => ({ raw: { id: "P1" } }),
  normalize: async (ctx, raw) => bundle({ tenantId: ctx.tenant.id, patient: patient({ id: raw.raw.id }), sourceConnector: "mock" }),
};

test("assertConnector accepts a well-formed pull connector, rejects a broken one", () => {
  assert.doesNotThrow(() => assertConnector(mockConnector));
  assert.throws(() => assertConnector({ meta: { profile: "pull" } }), /fetchPatient/);
});

test("mock connector passes the conformance harness", async () => {
  const res = await runConformance(mockConnector, { fixtures: { patientRef: "P1" } });
  assert.equal(res.passed, true, JSON.stringify(res.checks.filter((c) => !c.ok)));
});

test("a connector that leaks PHI into audit fails conformance", async () => {
  const leaky = Object.assign({}, mockConnector, {
    normalize: async (ctx, raw) => { ctx.audit({ action: "x", patientName: "John Doe" }); return mockConnector.normalize(ctx, raw); },
  });
  const res = await runConformance(leaky, { fixtures: { patientRef: "P1" } });
  assert.equal(res.passed, false);
});
