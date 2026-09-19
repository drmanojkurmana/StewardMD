// test/connect/agent/activation.test.mjs - adapter version activation, rollback and drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activateVersion, rollbackVersion, markDrift, OnboardError, PermissionError } from "../../../functions/_connect/agent/activation.js";
import {
  insertDeployment, deploymentFingerprint, getDeployment,
  insertVersion, getVersion, casVersionLifecycle, getActiveActivation,
} from "../../../functions/_connect/agent/store.js";
import { makeAgentDb } from "./agent-db.mjs";

const TENANT = "tenant-1";

async function seedDeployment(db) {
  const origins = ["https://emr.city-hospital.org"];
  return insertDeployment(db, {
    tenantId: TENANT, hospitalId: "site-north", name: "City Hospital North",
    origins, vendor: "Epic", fingerprint: await deploymentFingerprint(origins), networkMode: "public",
  });
}

// insertVersion() only ever creates a CREATED candidate - walk it to AWAITING_APPROVAL the same way the
// (separately-owned) compile/validate pipeline would, using the exact state-machine edges from state.js.
async function seedApprovedVersion(db, deploymentId, { evidenceHash = "evidence-abc", contentHash = "hash-1" } = {}) {
  const v0 = await insertVersion(db, {
    tenantId: TENANT, deploymentId, manifestRef: "r2://manifests/m.json", schemaVersion: 2,
    contentHash, capabilities: ["emr:read"], evidenceHash,
  });
  await casVersionLifecycle(db, TENANT, v0.id, "CREATED", { lifecycle: "VALIDATING" });
  return casVersionLifecycle(db, TENANT, v0.id, "VALIDATING", { lifecycle: "AWAITING_APPROVAL" });
}

test("activation requires the 'activate' need - a clinician can onboard but never activate", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v = await seedApprovedVersion(db, dep.id);
  await assert.rejects(
    () => activateVersion(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v.id, actorId: "dr-1", role: "clinician", evidenceHash: "evidence-abc" }),
    (e) => e instanceof PermissionError
  );
  // and the version genuinely did not move
  assert.equal((await getVersion(db, TENANT, v.id)).lifecycle, "AWAITING_APPROVAL");
});

test("activation succeeds for an approved version with matching evidence, and points the deployment at it", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v = await seedApprovedVersion(db, dep.id, { evidenceHash: "evidence-xyz" });

  const { version, activation } = await activateVersion(db, {
    tenantId: TENANT, deploymentId: dep.id, versionId: v.id, actorId: "admin-1", role: "admin",
    policyVersion: "policy-2026-09", evidenceHash: "evidence-xyz",
  });

  assert.equal(version.lifecycle, "ACTIVE");
  assert.equal(version.approver, "admin-1");
  assert.equal(activation.version_id, v.id);
  assert.equal(activation.evidence_hash, "evidence-xyz");
  assert.equal(activation.revoked_at, null);

  const deployment = await getDeployment(db, TENANT, dep.id);
  assert.equal(deployment.active_version_id, v.id);

  const active = await getActiveActivation(db, TENANT, dep.id);
  assert.equal(active.id, activation.id);
});

test("activation is refused when the caller's evidence hash does not match the validated candidate", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v = await seedApprovedVersion(db, dep.id, { evidenceHash: "evidence-real" });
  await assert.rejects(
    () => activateVersion(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v.id, actorId: "admin-1", role: "admin", evidenceHash: "evidence-forged" }),
    { name: "OnboardError", klass: "conflict" }
  );
  assert.equal((await getVersion(db, TENANT, v.id)).lifecycle, "AWAITING_APPROVAL", "a rejected activation must not move the version");
});

test("activation is refused for a version with no bound evidence at all", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v = await seedApprovedVersion(db, dep.id, { evidenceHash: null });
  await assert.rejects(
    () => activateVersion(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v.id, actorId: "admin-1", role: "admin", evidenceHash: "anything" }),
    { name: "OnboardError", klass: "invalid" }
  );
});

test("activation is refused from any lifecycle other than AWAITING_APPROVAL (fail-closed on the state machine)", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v = await insertVersion(db, { tenantId: TENANT, deploymentId: dep.id, manifestRef: "r2://m.json", schemaVersion: 2, contentHash: "h", capabilities: [], evidenceHash: "e" });
  assert.equal(v.lifecycle, "CREATED");
  await assert.rejects(
    () => activateVersion(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v.id, actorId: "admin-1", role: "admin", evidenceHash: "e" }),
    { name: "OnboardError", klass: "conflict" }
  );
});

test("activation refuses a version that belongs to a different deployment (not a cross-tenant leak, a plain not-found)", async () => {
  const db = makeAgentDb();
  const depA = await seedDeployment(db);
  const depB = await insertDeployment(db, { tenantId: TENANT, hospitalId: "site-south", origins: ["https://emr.south.org"], fingerprint: "fp-south" });
  const vForA = await seedApprovedVersion(db, depA.id);
  await assert.rejects(
    () => activateVersion(db, { tenantId: TENANT, deploymentId: depB.id, versionId: vForA.id, actorId: "admin-1", role: "admin", evidenceHash: "evidence-abc" }),
    { name: "OnboardError", klass: "not-found" }
  );
});

test("a lost activation race reports conflict, not a silent second success", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v = await seedApprovedVersion(db, dep.id, { evidenceHash: "evidence-race" });
  const args = { tenantId: TENANT, deploymentId: dep.id, versionId: v.id, actorId: "admin-1", role: "admin", evidenceHash: "evidence-race" };
  await activateVersion(db, args); // first caller wins
  await assert.rejects(() => activateVersion(db, args), { name: "OnboardError", klass: "conflict" });
});

test("rollback restores a previously-active version and supersedes it in the activation ledger", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v1 = await seedApprovedVersion(db, dep.id, { evidenceHash: "e1", contentHash: "h1" });
  const { activation: act1 } = await activateVersion(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v1.id, actorId: "admin-1", role: "admin", evidenceHash: "e1" });

  const v2 = await seedApprovedVersion(db, dep.id, { evidenceHash: "e2", contentHash: "h2" });
  await activateVersion(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v2.id, actorId: "admin-1", role: "admin", evidenceHash: "e2" });
  assert.equal((await getDeployment(db, TENANT, dep.id)).active_version_id, v2.id);

  const { version, activation } = await rollbackVersion(db, { tenantId: TENANT, deploymentId: dep.id, targetVersionId: v1.id, actorId: "admin-2", role: "owner", reason: "v2 regressed on labs" });
  assert.equal(version.id, v1.id);
  assert.equal((await getDeployment(db, TENANT, dep.id)).active_version_id, v1.id, "deployment must point back at v1");
  assert.match(activation.policy_version, /^rollback:/);

  const nowActive = await getActiveActivation(db, TENANT, dep.id);
  assert.equal(nowActive.id, activation.id);

  // the superseded (by rollback) v2 activation, and the original v1 activation it itself superseded, are
  // both non-live now - only the newest row is ever "the" active activation.
  const act1Row = await db.prepare("SELECT * FROM connect_agent_activation WHERE tenant_id=? AND id=?").bind(TENANT, act1.id).first();
  assert.notEqual(act1Row.revoked_at, null);
});

test("rollback refuses a target that was never itself an active/repairable version", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const neverActivated = await seedApprovedVersion(db, dep.id); // sits at AWAITING_APPROVAL, never ACTIVE
  await assert.rejects(
    () => rollbackVersion(db, { tenantId: TENANT, deploymentId: dep.id, targetVersionId: neverActivated.id, actorId: "admin-1", role: "admin", reason: "x" }),
    { name: "OnboardError", klass: "invalid" }
  );
});

test("rollback refuses when the target is already the active version", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v = await seedApprovedVersion(db, dep.id);
  await activateVersion(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v.id, actorId: "admin-1", role: "admin", evidenceHash: "evidence-abc" });
  await assert.rejects(
    () => rollbackVersion(db, { tenantId: TENANT, deploymentId: dep.id, targetVersionId: v.id, actorId: "admin-1", role: "admin", reason: "noop" }),
    { name: "OnboardError", klass: "invalid" }
  );
});

test("rollback is role-gated exactly like activation", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v1 = await seedApprovedVersion(db, dep.id, { contentHash: "h1" });
  await activateVersion(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v1.id, actorId: "admin-1", role: "admin", evidenceHash: "evidence-abc" });
  const v2 = await seedApprovedVersion(db, dep.id, { contentHash: "h2" });
  await assert.rejects(
    () => rollbackVersion(db, { tenantId: TENANT, deploymentId: dep.id, targetVersionId: v1.id, actorId: "dr-1", role: "clinician", reason: "x" }),
    (e) => e instanceof PermissionError
  );
});

test("drift moves ONLY the version to NEEDS_REPAIR - the deployment keeps serving it (in-flight reads stay pinned)", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v = await seedApprovedVersion(db, dep.id);
  await activateVersion(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v.id, actorId: "admin-1", role: "admin", evidenceHash: "evidence-abc" });

  const drifted = await markDrift(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v.id, reason: "medications probe started 404ing" });
  assert.equal(drifted.lifecycle, "NEEDS_REPAIR");
  assert.match(drifted.policy_version, /^drift:/);
  assert.equal((await getDeployment(db, TENANT, dep.id)).active_version_id, v.id, "drift does not unpoint the deployment");
});

test("drift is refused from a lifecycle it has no legal edge from", async () => {
  const db = makeAgentDb();
  const dep = await seedDeployment(db);
  const v = await insertVersion(db, { tenantId: TENANT, deploymentId: dep.id, manifestRef: "r2://m.json", schemaVersion: 2, contentHash: "h", capabilities: [], evidenceHash: "e" });
  await assert.rejects(
    () => markDrift(db, { tenantId: TENANT, deploymentId: dep.id, versionId: v.id, reason: "x" }),
    { name: "OnboardError", klass: "conflict" }
  );
});
