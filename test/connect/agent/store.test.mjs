// test/connect/agent/store.test.mjs - D1 store CRUD, CAS semantics and tenant-qualified reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deploymentFingerprint,
  getDeployment,
  findDeploymentByFingerprint,
  insertDeployment,
  deploymentOrigins,
  deploymentView,
  getVersion,
  insertVersion,
  insertConsent,
  listConsents,
  getConsent,
  revokeConsentRow,
  insertSession,
  getSessionRow,
  findLiveSession,
  casSession,
  sessionView,
  insertJob,
  getJobRow,
  getJobById,
  findJobByIdempotencyKey,
  findJobForSession,
  casJob,
  jobsInStates,
  insertViewerToken,
  getViewerToken,
  markViewerTokenUsed,
  revokeSessionViewerTokens,
  getNonce,
  insertNonce,
  OnboardError,
} from "../../../functions/_connect/agent/store.js";
import { SESSION_LIVE } from "../../../functions/_connect/agent/state.js";
import { makeAgentDb } from "./agent-db.mjs";

test("store operations fail-closed when DB binding is missing", async () => {
  await assert.rejects(
    () => getDeployment(null, "t1", "d1"),
    { name: "OnboardError", klass: "not-configured" }
  );
  await assert.rejects(
    () => insertSession(undefined, {}),
    { name: "OnboardError", klass: "not-configured" }
  );
  await assert.rejects(
    () => casSession(null, "t1", "s1", 1, { state: "AWAITING_LOGIN" }),
    { name: "OnboardError", klass: "not-configured" }
  );
});

test("deploymentFingerprint computes deterministic SHA-256 over canonical origin set", async () => {
  const origins1 = ["https://emr.hospital-a.org", "https://api.hospital-a.org"];
  const origins2 = ["https://api.hospital-a.org", "https://emr.hospital-a.org"]; // different order
  const fp1 = await deploymentFingerprint(origins1);
  const fp2 = await deploymentFingerprint(origins2);

  assert.equal(fp1, fp2);
  assert.match(fp1, /^[0-9a-f]{64}$/);

  // Different origins produce different fingerprint
  const fpOther = await deploymentFingerprint(["https://emr.hospital-b.org"]);
  assert.notEqual(fp1, fpOther);

  // Empty / undefined origins
  const fpEmpty = await deploymentFingerprint([]);
  assert.equal(fpEmpty, await deploymentFingerprint(null));
});

test("deployment CRUD, tenant-qualified reads and client-safe projection", async () => {
  const db = makeAgentDb();
  const origins = ["https://emr.city-hospital.org"];
  const fp = await deploymentFingerprint(origins);

  // Insert deployment for tenant-1
  const dep = await insertDeployment(db, {
    tenantId: "tenant-1",
    hospitalId: "site-north",
    name: "City Hospital North",
    origins,
    vendor: "Epic",
    fingerprint: fp,
    networkMode: "public",
  });

  assert.match(dep.id, /^dep_/);
  assert.equal(dep.tenant_id, "tenant-1");
  assert.equal(dep.hospital_id, "site-north");
  assert.equal(dep.status, "active");

  // Read back for same tenant succeeds
  const read = await getDeployment(db, "tenant-1", dep.id);
  assert.equal(read.id, dep.id);
  assert.deepEqual(deploymentOrigins(read), origins);

  // Cross-tenant read fails with not-found (no IDOR existence leak)
  await assert.rejects(
    () => getDeployment(db, "tenant-2", dep.id),
    { name: "OnboardError", klass: "not-found" }
  );

  // findDeploymentByFingerprint is tenant-scoped
  const foundSameTenant = await findDeploymentByFingerprint(db, "tenant-1", fp);
  assert.equal(foundSameTenant.id, dep.id);
  const foundOtherTenant = await findDeploymentByFingerprint(db, "tenant-2", fp);
  assert.equal(foundOtherTenant, null);

  // Safe client view
  const activeVer = {
    id: "ver-1",
    content_hash: "hash-123",
    capabilities: JSON.stringify(["emr:session", "emr:read"]),
    schema_version: 1,
  };
  const view = deploymentView(dep, activeVer);
  assert.equal(view.deploymentId, dep.id);
  assert.equal(view.hospitalId, "site-north");
  assert.equal(view.name, "City Hospital North");
  assert.deepEqual(view.origins, origins);
  assert.equal(view.activeVersion.versionId, "ver-1");
  assert.equal("fingerprint" in view, false);
});

test("adapter version CRUD and tenant isolation", async () => {
  const db = makeAgentDb();

  const ver = await insertVersion(db, {
    tenantId: "tenant-1",
    deploymentId: "dep-1",
    manifestRef: "r2://manifests/m1.json",
    schemaVersion: 1,
    contentHash: "hash-sha256-abcdef",
    capabilities: ["emr:session", "emr:read"],
    evidenceHash: "evidence-sha256-123456",
  });

  assert.match(ver.id, /^ver_/);
  assert.equal(ver.tenant_id, "tenant-1");
  assert.equal(ver.lifecycle, "CREATED");

  // Same tenant read succeeds
  const read = await getVersion(db, "tenant-1", ver.id);
  assert.equal(read.id, ver.id);

  // Cross-tenant read returns null
  const cross = await getVersion(db, "tenant-2", ver.id);
  assert.equal(cross, null);

  // Empty id returns null
  assert.equal(await getVersion(db, "tenant-1", null), null);
});

test("session CRUD and compare-and-swap (CAS) semantics", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;

  const session = await insertSession(db, {
    id: "sess-1",
    tenant_id: "tenant-1",
    deployment_id: "dep-1",
    actor_id: "actor-doc-1",
    runner_ref: "camofox-user-opaque-ref-123",
    consent_id: "con-1",
    state: "CREATED",
    control_owner: "clinician",
    expires_at: nowMs + 3600000,
  });

  assert.equal(session.revision, 1);
  assert.equal(session.state, "CREATED");

  // CAS update 1: expectedRevision 1 -> bumps to 2
  const updated1 = await casSession(db, "tenant-1", "sess-1", 1, {
    state: "AWAITING_LOGIN",
  });
  assert.equal(updated1.revision, 2);
  assert.equal(updated1.state, "AWAITING_LOGIN");

  // CAS update with stale revision 1 fails with conflict
  await assert.rejects(
    () => casSession(db, "tenant-1", "sess-1", 1, { state: "AUTHENTICATED" }),
    { name: "OnboardError", klass: "conflict" }
  );

  // CAS update 2: expectedRevision 2 -> bumps to 3
  const updated2 = await casSession(db, "tenant-1", "sess-1", 2, {
    state: "AUTHENTICATED",
    control_owner: "agent",
  });
  assert.equal(updated2.revision, 3);
  assert.equal(updated2.state, "AUTHENTICATED");
  assert.equal(updated2.control_owner, "agent");

  // CAS on missing session throws not-found
  await assert.rejects(
    () => casSession(db, "tenant-1", "sess-missing", 1, { state: "AUTHENTICATED" }),
    { name: "OnboardError", klass: "not-found" }
  );

  // CAS cross-tenant throws not-found (tenant isolation)
  await assert.rejects(
    () => casSession(db, "tenant-2", "sess-1", 3, { state: "NEEDS_REAUTH" }),
    { name: "OnboardError", klass: "not-found" }
  );
});

test("concurrent CAS race: exactly one update wins and the other fails with conflict", async () => {
  const db = makeAgentDb();
  await insertSession(db, {
    id: "sess-race",
    tenant_id: "tenant-1",
    deployment_id: "dep-1",
    actor_id: "actor-1",
    runner_ref: "ref-1",
    consent_id: "con-1",
    state: "CREATED",
    control_owner: "clinician",
    expires_at: Date.now() + 60000,
  });

  // Racer A updates from rev 1
  const racerA = await casSession(db, "tenant-1", "sess-race", 1, { state: "AWAITING_LOGIN" });
  assert.equal(racerA.revision, 2);

  // Racer B also tries to update from rev 1 (simulating concurrent race where both read rev 1)
  await assert.rejects(
    () => casSession(db, "tenant-1", "sess-race", 1, { state: "CANCELLED" }),
    { name: "OnboardError", klass: "conflict" }
  );

  // Database retains Racer A state, not Racer B
  const finalRow = await getSessionRow(db, "tenant-1", "sess-race");
  assert.equal(finalRow.state, "AWAITING_LOGIN");
  assert.equal(finalRow.revision, 2);
});

test("findLiveSession resumes live session and ignores expired or terminal states", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;

  // 1. Expired session
  await insertSession(db, {
    id: "sess-old",
    tenant_id: "tenant-1",
    deployment_id: "dep-1",
    actor_id: "actor-doc-1",
    runner_ref: "ref-old",
    consent_id: "con-1",
    state: "AUTHENTICATED",
    control_owner: "clinician",
    expires_at: nowMs - 1000,
  });

  // 2. Terminal session (CANCELLED)
  await insertSession(db, {
    id: "sess-cancelled",
    tenant_id: "tenant-1",
    deployment_id: "dep-1",
    actor_id: "actor-doc-1",
    runner_ref: "ref-can",
    consent_id: "con-1",
    state: "CANCELLED",
    control_owner: "clinician",
    expires_at: nowMs + 100000,
  });

  // Should find none so far
  const none = await findLiveSession(db, "tenant-1", "actor-doc-1", "dep-1", SESSION_LIVE, nowMs);
  assert.equal(none, null);

  // 3. Active live session
  const live = await insertSession(db, {
    id: "sess-live",
    tenant_id: "tenant-1",
    deployment_id: "dep-1",
    actor_id: "actor-doc-1",
    runner_ref: "ref-live",
    consent_id: "con-1",
    state: "AUTHENTICATED",
    control_owner: "clinician",
    expires_at: nowMs + 100000,
  });

  const found = await findLiveSession(db, "tenant-1", "actor-doc-1", "dep-1", SESSION_LIVE, nowMs);
  assert.equal(found.id, live.id);

  // Different actor does NOT get this session (doctor isolation)
  const otherDoc = await findLiveSession(db, "tenant-1", "actor-doc-2", "dep-1", SESSION_LIVE, nowMs);
  assert.equal(otherDoc, null);
});

test("sessionView strictly omits runner_ref, runner_id and browser credentials", async () => {
  const db = makeAgentDb();
  const session = await insertSession(db, {
    id: "sess-view-1",
    tenant_id: "tenant-1",
    deployment_id: "dep-1",
    actor_id: "actor-1",
    runner_ref: "camofox-secret-user-id-MUST-NOT-LEAK",
    consent_id: "con-1",
    state: "AUTHENTICATED",
    control_owner: "clinician",
    expires_at: 1700000000000,
  });

  const job = {
    id: "job-1",
    state: "DISCOVERING",
    revision: 2,
    stage: "observe",
    stage_code: "ok",
    attempts: 1,
    max_attempts: 3,
    deadline_at: 1700001000000,
    candidate_version_id: "ver-candidate-1",
  };

  const view = sessionView(session, job);
  assert.equal(view.sessionId, "sess-view-1");
  assert.equal(view.state, "AUTHENTICATED");
  assert.equal(view.job.jobId, "job-1");
  assert.equal(view.job.stage, "observe");

  // Invariant: runner credentials never leave server
  assert.equal("runner_ref" in view, false);
  assert.equal("runnerRef" in view, false);
  assert.equal("runner_id" in view, false);
  assert.equal("runnerId" in view, false);
  assert.doesNotMatch(JSON.stringify(view), /camofox-secret-user-id/);
});

test("job CRUD, CAS, idempotency and lease queries", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;

  const job = await insertJob(db, {
    id: "job-1",
    tenant_id: "tenant-1",
    session_id: "sess-1",
    deployment_id: "dep-1",
    actor_id: "actor-1",
    state: "CREATED",
    idempotency_key: "idem-key-abc",
    deadline_at: nowMs + 600000,
    max_attempts: 3,
  });

  assert.equal(job.revision, 1);
  assert.equal(job.state, "CREATED");

  // Idempotency lookup
  const idemFound = await findJobByIdempotencyKey(db, "tenant-1", "idem-key-abc");
  assert.equal(idemFound.id, "job-1");

  // Different tenant cannot find by idempotency key
  const idemOtherTenant = await findJobByIdempotencyKey(db, "tenant-2", "idem-key-abc");
  assert.equal(idemOtherTenant, null);

  // CAS on job
  const updatedJob = await casJob(db, "tenant-1", "job-1", 1, {
    state: "DISCOVERING",
    stage: "observe",
    stage_code: "in_progress",
  });
  assert.equal(updatedJob.revision, 2);
  assert.equal(updatedJob.state, "DISCOVERING");

  // Stale CAS on job fails with conflict
  await assert.rejects(
    () => casJob(db, "tenant-1", "job-1", 1, { state: "COMPILING" }),
    { name: "OnboardError", klass: "conflict" }
  );

  // findJobForSession
  const sessionJob = await findJobForSession(db, "tenant-1", "sess-1");
  assert.equal(sessionJob.id, "job-1");

  // jobsInStates (for lease sweep)
  const inDiscovering = await jobsInStates(db, ["DISCOVERING"]);
  assert.equal(inDiscovering.length, 1);
  assert.equal(inDiscovering[0].id, "job-1");
  const inCreated = await jobsInStates(db, ["CREATED"]);
  assert.equal(inCreated.length, 0);

  // getJobById
  assert.equal((await getJobById(db, "job-1")).id, "job-1");
  assert.equal(await getJobById(db, "job-nonexistent"), null);
});

test("viewer token store operations", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;

  await insertViewerToken(db, {
    jti: "vt_123",
    tenant_id: "tenant-1",
    session_id: "sess-1",
    actor_id: "actor-1",
    expires_at: nowMs + 120000,
  });

  const row = await getViewerToken(db, "vt_123");
  assert.equal(row.jti, "vt_123");
  assert.equal(row.used_at, null);
  assert.equal(row.revoked_at, null);

  // Mark used
  const afterUsed = await markViewerTokenUsed(db, "vt_123", nowMs + 1000);
  assert.equal(afterUsed.used_at, nowMs + 1000);

  // Revoke session viewer tokens
  await revokeSessionViewerTokens(db, "sess-1", nowMs + 2000);
  const afterRevoke = await getViewerToken(db, "vt_123");
  assert.equal(afterRevoke.revoked_at, nowMs + 2000);
});

test("nonce replay protection store operations", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;

  assert.equal(await getNonce(db, "nonce-1"), null);

  await insertNonce(db, {
    nonce: "nonce-1",
    runnerId: "runner-1",
    seenAt: nowMs,
    expiresAt: nowMs + 300000,
  });

  const row = await getNonce(db, "nonce-1");
  assert.equal(row.nonce, "nonce-1");
  assert.equal(row.runner_id, "runner-1");
  assert.equal(row.seen_at, nowMs);
});
