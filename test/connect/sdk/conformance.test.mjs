// test/connect/sdk/conformance.test.mjs — Task 2: profile-aware conformance kit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runConformance, assertConforms, ConformanceError } from "../../../functions/_connect/sdk/conformance.js";
import { bundle, patient } from "../../../functions/_connect/canonical/model.js";
import { UpstreamError } from "../../../functions/_connect/permission.js";

const validBundle = (ctx) => bundle({ tenantId: ctx.tenant.id, patient: patient({ id: "p1", gender: "male" }), generatedAt: ctx.now().toISOString(), sourceConnector: "mock" });

// (a) clean pull
const cleanPull = {
  meta: { id: "clean-pull", name: "Clean Pull", version: "1", profile: "pull", kinds: ["mock"], sccmVersion: "1.0" },
  capabilities: async () => ({ resources: ["Patient"], operations: ["read"], authKinds: ["none"] }),
  authenticate: async () => ({ ok: true }),
  validate: async () => ({ ok: true, checks: [] }),
  fetchPatient: async (ctx) => { const r = await ctx.fetch("https://x/Patient/p1").catch((e) => { throw new UpstreamError("fetch failed"); }); await r.json?.().catch(() => {}); return {}; },
  normalize: async (ctx) => validBundle(ctx),
};
// (b) clean event skeleton (emitsBundle defaults false for event)
const cleanEvent = {
  meta: { id: "clean-event", name: "Clean Event", version: "1", profile: "event", kinds: ["mock"], sccmVersion: "1.0" },
  authenticate: async () => ({ ok: true }),
  validate: async () => ({ ok: true, checks: [] }),
  initiate: async () => ({ ok: true }),
  normalize: async () => null,
  ingest: async () => ({ handle: { type: "x" }, bundle: null }),
};
// (c) audit-leaky pull — normalize writes a non-ALLOW key to ctx.audit
const leaky = Object.assign({}, cleanPull, { meta: Object.assign({}, cleanPull.meta, { id: "leaky" }), normalize: async (ctx) => { ctx.audit({ patientName: "Doe", ssn: "123" }); return validBundle(ctx); } });
// (d) fail-open pull — fetchPatient swallows a rejecting fetch and returns a complete bundle with no warnings
const failOpen = Object.assign({}, cleanPull, { meta: Object.assign({}, cleanPull.meta, { id: "fail-open" }), fetchPatient: async (ctx) => { try { await ctx.fetch("https://x/Patient/p1"); } catch (e) { /* swallowed! */ } return {}; } });
// (e) sneaky pull — a pull connector that emits a bundle but self-declares emitsBundle:false to try to SKIP
// checks 6/7, then normalizes to an INVALID SCCM bundle (sccmVersion 9.9, patient null). It must NOT certify.
const sneakyPull = Object.assign({}, cleanPull, {
  meta: Object.assign({}, cleanPull.meta, { id: "sneaky-pull", capabilities: { emitsBundle: false } }),
  normalize: async () => ({ sccmVersion: "9.9", patient: null, meta: { warnings: [] } }),
});

test("clean pull connector -> passed, checks 6/7 active", async () => {
  const r = await runConformance(cleanPull);
  assert.equal(r.passed, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.checks.find((c) => c.name === "6-valid-sccm").skipped, false);
});

test("clean event skeleton -> passed, checks 6/7 SKIPPED (emitsBundle false)", async () => {
  const r = await runConformance(cleanEvent);
  assert.equal(r.passed, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.checks.find((c) => c.name === "6-valid-sccm").skipped, true);
  assert.equal(r.checks.find((c) => c.name === "7-deterministic-ids").skipped, true);
});

test("audit-leaky connector -> check 8 fails, passed false", async () => {
  const r = await runConformance(leaky);
  assert.equal(r.passed, false);
  assert.equal(r.checks.find((c) => c.name === "8-no-phi-in-audit").ok, false);
});

test("fail-open connector -> check 10 fails, passed false", async () => {
  const r = await runConformance(failOpen);
  assert.equal(r.passed, false);
  assert.equal(r.checks.find((c) => c.name === "10-fail-closed").ok, false);
});

test("a pull connector cannot self-declare emitsBundle:false to skip bundle validation (6/7 forced on for pull)", async () => {
  // The abusable-skip fix: for profile 'pull' the kit forces emits=true, so checks 6 (normalize->valid SCCM)
  // and 7 (deterministic source-derived ids) ALWAYS run regardless of the self-declared emitsBundle flag.
  // This connector emits invalid SCCM, so it must be certified passed:false (it wrongly passed before the fix).
  const r = await runConformance(sneakyPull);
  assert.equal(r.passed, false);
  const c6 = r.checks.find((c) => c.name === "6-valid-sccm");
  assert.equal(c6.skipped, false);                        // check 6 now runs (not skipped by the false flag)
  assert.equal(c6.ok, false);                             // and fails on the invalid SCCM bundle
  assert.equal(r.checks.find((c) => c.name === "7-deterministic-ids").skipped, false);
});

test("assertConforms throws ConformanceError listing the failed checks", async () => {
  await assert.rejects(() => assertConforms(leaky), (e) => e instanceof ConformanceError && e.failed.includes("8-no-phi-in-audit"));
  await assert.rejects(() => assertConforms(failOpen), (e) => e instanceof ConformanceError && e.failed.includes("10-fail-closed"));
  await assert.doesNotReject(() => assertConforms(cleanPull));
});
