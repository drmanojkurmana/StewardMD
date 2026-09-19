// test/connect/agent/runner-router.test.mjs -- Tests for runner callback router.
// Covers HMAC verification, timestamp window, nonce replay protection, CAS leasing,
// lapsed lease reclamation, illegal transition rejection, and duplicate terminal report idempotency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../../functions/api/connect/agent/runner/[[path]].js";
import { makeAgentDb } from "./agent-db.mjs";
import { hmacHex, sha256hex } from "../../../functions/_connect/agent/hmac.js";
import { getJobById, getNonce } from "../../../functions/_connect/agent/store.js";

const RUNNER_KEY = "test-runner-hmac-shared-secret-32b";
const TEST_NOW_MS = 1700000000000;

const post = (path, body, env, headers = {}) => {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body || {});
  return {
    request: new Request("https://x" + path, {
      method: "POST",
      body: bodyText,
      headers: Object.assign(
        {
          "content-type": "application/json",
        },
        headers
      ),
    }),
    env,
    params: {},
  };
};

async function signHeaders({ method = "POST", pathname, body, runnerKey = RUNNER_KEY, runnerId = "runner-1", timestamp, nonce }) {
  const ts = String(timestamp != null ? timestamp : Date.now());
  const n = nonce || ("nonce_" + Math.random().toString(36).slice(2) + Date.now());
  const bodyText = typeof body === "string" ? body : JSON.stringify(body || {});
  const canonicalMsg = `${method.toUpperCase()}\n${pathname}\n${ts}\n${n}\n${bodyText}`;
  const sig = await hmacHex(runnerKey, canonicalMsg);
  return {
    "x-smd-timestamp": ts,
    "x-smd-nonce": n,
    "x-smd-signature": sig,
    "x-smd-runner-id": runnerId,
  };
}

const BASE_FLAGS = {
  CONNECT_FLAG: "1",
  CONNECT_ONBOARD_FLAG: "1",
  CONNECT_AGENT_FLAG: "1",
  RUNNER_HMAC_KEY: RUNNER_KEY,
};

function setupRunnerTestEnv(customSeed = {}) {
  const nowMs = 1700000000000;
  const db = makeAgentDb({
    connect_tenant: [
      { id: "t1", name: "Hospital Alpha", mode: "sandbox" },
    ],
    connect_deployment: [
      {
        id: "dep-1",
        tenant_id: "t1",
        hospital_id: "hosp-1",
        name: "General Hospital",
        origins: JSON.stringify(["https://emr.hospital.test"]),
        vendor: "epic",
        fingerprint: "fp-1",
        network_mode: "public",
        active_version_id: null,
        status: "active",
        created_at: new Date(nowMs).toISOString(),
        updated_at: new Date(nowMs).toISOString(),
      },
    ],
    connect_agent_session: [
      {
        id: "ses-1",
        tenant_id: "t1",
        deployment_id: "dep-1",
        actor_id: "act-1",
        runner_ref: "camofox-user-1",
        runner_id: null,
        consent_id: "con-1",
        state: "AUTHENTICATED",
        control_owner: "agent",
        revision: 1,
        expires_at: nowMs + 3600000,
        cleanup_after: null,
        closed_at: null,
        created_at: new Date(nowMs).toISOString(),
        updated_at: new Date(nowMs).toISOString(),
      },
    ],
    connect_agent_job: [
      {
        id: "job-1",
        tenant_id: "t1",
        session_id: "ses-1",
        deployment_id: "dep-1",
        actor_id: "act-1",
        state: "AUTHENTICATED",
        revision: 1,
        idempotency_key: null,
        lease_owner: null,
        lease_expires_at: null,
        attempts: 0,
        max_attempts: 3,
        deadline_at: nowMs + 3600000,
        stage: null,
        stage_code: null,
        candidate_version_id: null,
        completed_at: null,
        created_at: new Date(nowMs).toISOString(),
        updated_at: new Date(nowMs).toISOString(),
      },
    ],
    connect_agent_nonce: [],
    connect_adapter_version: [],
    ...customSeed,
  });

  const env = {
    ...BASE_FLAGS,
    CONNECT_DB: db,
    now: () => nowMs,
  };

  return { env, db, nowMs };
}

test("flag off returns 404 not found", async () => {
  const { env, nowMs } = setupRunnerTestEnv();
  const offEnv = { ...env, CONNECT_AGENT_FLAG: "0" };
  const pathname = "/runner/jobs/lease";
  const body = { runnerId: "runner-1" };
  const headers = await signHeaders({ pathname, body, timestamp: nowMs });
  const res = await onRequest(post(pathname, body, offEnv, headers));
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, "not_found");
});

test("valid HMAC signature is accepted on report", async () => {
  const { env, nowMs } = setupRunnerTestEnv({
    connect_agent_job: [
      {
        id: "job-valid-hmac",
        tenant_id: "t1",
        session_id: "ses-1",
        deployment_id: "dep-1",
        actor_id: "act-1",
        state: "DISCOVERING",
        revision: 1,
        lease_owner: "runner-1",
        lease_expires_at: TEST_NOW_MS + 30000,
        attempts: 1,
        max_attempts: 3,
        deadline_at: TEST_NOW_MS + 3600000,
        stage: "discovering",
        stage_code: null,
        candidate_version_id: null,
        completed_at: null,
        created_at: new Date(TEST_NOW_MS).toISOString(),
        updated_at: new Date(TEST_NOW_MS).toISOString(),
      },
    ],
  });

  const pathname = "/runner/jobs/job-valid-hmac/report";
  const body = { stage: "DISCOVERING", outcome: "success", runnerId: "runner-1" };
  const headers = await signHeaders({ pathname, body, timestamp: nowMs, runnerId: "runner-1" });

  const res = await onRequest(post(pathname, body, env, headers));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.job.state, "COMPILING");
});

test("tampered HMAC signature is rejected with 401", async () => {
  const { env, nowMs } = setupRunnerTestEnv();
  const pathname = "/runner/jobs/job-1/report";
  const body = { stage: "DISCOVERING", outcome: "progress", runnerId: "runner-1" };
  const headers = await signHeaders({ pathname, body, timestamp: nowMs });

  // Tamper with the signature
  headers["x-smd-signature"] = headers["x-smd-signature"].replace(/^[0-9a-f]/, (c) => (c === "a" ? "b" : "a"));

  const res = await onRequest(post(pathname, body, env, headers));
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "auth");
});

test("stale timestamp outside window is rejected with 401", async () => {
  const { env, nowMs } = setupRunnerTestEnv();
  const pathname = "/runner/jobs/job-1/report";
  const body = { stage: "DISCOVERING", outcome: "progress", runnerId: "runner-1" };

  // Timestamp 121 seconds in the past (outside +-120s window)
  const staleTime = nowMs - 121000;
  const headers = await signHeaders({ pathname, body, timestamp: staleTime });

  const res = await onRequest(post(pathname, body, env, headers));
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "auth");
});

test("replayed nonce is rejected with 401", async () => {
  const { env, nowMs, db } = setupRunnerTestEnv({
    connect_agent_job: [
      {
        id: "job-replay",
        tenant_id: "t1",
        session_id: "ses-1",
        deployment_id: "dep-1",
        actor_id: "act-1",
        state: "AUTHENTICATED",
        revision: 1,
        lease_owner: "runner-1",
        lease_expires_at: TEST_NOW_MS + 30000,
        attempts: 1,
        max_attempts: 3,
        deadline_at: TEST_NOW_MS + 3600000,
        stage: null,
        stage_code: null,
        candidate_version_id: null,
        completed_at: null,
        created_at: new Date(TEST_NOW_MS).toISOString(),
        updated_at: new Date(TEST_NOW_MS).toISOString(),
      },
    ],
  });

  const pathname = "/runner/jobs/job-replay/report";
  const body = { stage: "DISCOVERING", outcome: "progress", runnerId: "runner-1" };
  const fixedNonce = "fixed-replay-nonce-12345";
  const headers = await signHeaders({ pathname, body, timestamp: nowMs, nonce: fixedNonce });

  // First request succeeds
  const res1 = await onRequest(post(pathname, body, env, headers));
  assert.equal(res1.status, 200);

  // Nonce is now recorded in DB
  const nonceRow = await getNonce(db, fixedNonce);
  assert.ok(nonceRow);
  assert.equal(nonceRow.nonce, fixedNonce);

  // Second request with exact same nonce is rejected as replay
  const res2 = await onRequest(post(pathname, body, env, headers));
  assert.equal(res2.status, 401);
  const data2 = await res2.json();
  assert.equal(data2.error, "auth");
});

test("lease CAS prevents two runners leasing the same job", async () => {
  const { env, nowMs, db } = setupRunnerTestEnv();

  const pathname = "/runner/jobs/lease";
  const body1 = { runnerId: "runner-A", leaseDurationMs: 30000 };
  const headers1 = await signHeaders({ pathname, body: body1, timestamp: nowMs, runnerId: "runner-A" });

  // Runner A claims the job
  const res1 = await onRequest(post(pathname, body1, env, headers1));
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.ok(data1.job);
  assert.equal(data1.job.id, "job-1");
  assert.equal(data1.job.leaseOwner, "runner-A");
  assert.equal(data1.job.revision, 2);

  // Runner B attempts to lease while Runner A holds the active lease
  const body2 = { runnerId: "runner-B", leaseDurationMs: 30000 };
  const headers2 = await signHeaders({ pathname, body: body2, timestamp: nowMs, runnerId: "runner-B" });

  const res2 = await onRequest(post(pathname, body2, env, headers2));
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.ok, true);
  // No eligible jobs available because job-1 is currently leased and not lapsed
  assert.equal(data2.job, null);
});

test("a lapsed lease is reclaimed by a different runner", async () => {
  const nowMs = 1700000000000;
  // Job was leased by runner-A, but the lease expired 5 seconds ago
  const { env, db } = setupRunnerTestEnv({
    connect_agent_job: [
      {
        id: "job-lapsed",
        tenant_id: "t1",
        session_id: "ses-1",
        deployment_id: "dep-1",
        actor_id: "act-1",
        state: "DISCOVERING",
        revision: 2,
        lease_owner: "runner-A",
        lease_expires_at: nowMs - 5000, // lapsed!
        attempts: 1,
        max_attempts: 3,
        deadline_at: nowMs + 3600000,
        stage: "discovering",
        stage_code: null,
        candidate_version_id: null,
        completed_at: null,
        created_at: new Date(nowMs - 60000).toISOString(),
        updated_at: new Date(nowMs - 60000).toISOString(),
      },
    ],
  });

  const pathname = "/runner/jobs/lease";
  const body = { runnerId: "runner-B", leaseDurationMs: 30000 };
  const headers = await signHeaders({ pathname, body, timestamp: nowMs, runnerId: "runner-B" });

  // Runner B calls /lease
  const res = await onRequest(post(pathname, body, env, headers));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.job);
  assert.equal(data.job.id, "job-lapsed");
  assert.equal(data.job.leaseOwner, "runner-B");
  assert.equal(data.job.leaseExpiresAt, nowMs + 30000);
  assert.equal(data.job.attempts, 2);
  assert.equal(data.job.revision, 3);

  // Check stored state in DB
  const stored = await getJobById(db, "job-lapsed");
  assert.equal(stored.lease_owner, "runner-B");
  assert.equal(stored.lease_expires_at, nowMs + 30000);
});

test("an illegal stage transition is refused", async () => {
  const { env, nowMs } = setupRunnerTestEnv({
    connect_agent_job: [
      {
        id: "job-illegal",
        tenant_id: "t1",
        session_id: "ses-1",
        deployment_id: "dep-1",
        actor_id: "act-1",
        state: "CREATED", // cannot transition directly to AWAITING_APPROVAL
        revision: 1,
        lease_owner: "runner-1",
        lease_expires_at: TEST_NOW_MS + 30000,
        attempts: 1,
        max_attempts: 3,
        deadline_at: TEST_NOW_MS + 3600000,
        stage: null,
        stage_code: null,
        candidate_version_id: null,
        completed_at: null,
        created_at: new Date(TEST_NOW_MS).toISOString(),
        updated_at: new Date(TEST_NOW_MS).toISOString(),
      },
    ],
  });

  // Stage VALIDATING with outcome success implies transition to AWAITING_APPROVAL,
  // which is illegal from CREATED state
  const pathname = "/runner/jobs/job-illegal/report";
  const body = { stage: "VALIDATING", outcome: "success", runnerId: "runner-1" };
  const headers = await signHeaders({ pathname, body, timestamp: nowMs });

  const res = await onRequest(post(pathname, body, env, headers));
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.error, "conflict");
});

test("a duplicate terminal report does not double-apply", async () => {
  const { env, nowMs, db } = setupRunnerTestEnv({
    connect_agent_job: [
      {
        id: "job-terminal",
        tenant_id: "t1",
        session_id: "ses-1",
        deployment_id: "dep-1",
        actor_id: "act-1",
        state: "VALIDATING",
        revision: 3,
        lease_owner: "runner-1",
        lease_expires_at: TEST_NOW_MS + 30000,
        attempts: 1,
        max_attempts: 3,
        deadline_at: TEST_NOW_MS + 3600000,
        stage: "validating",
        stage_code: null,
        candidate_version_id: null,
        completed_at: null,
        created_at: new Date(TEST_NOW_MS).toISOString(),
        updated_at: new Date(TEST_NOW_MS).toISOString(),
      },
    ],
  });

  const pathname = "/runner/jobs/job-terminal/report";
  const body = {
    stage: "VALIDATING",
    outcome: "success",
    candidateVersionId: "ver_test123",
    runnerId: "runner-1",
  };

  // First terminal report
  const headers1 = await signHeaders({ pathname, body, timestamp: nowMs });
  const res1 = await onRequest(post(pathname, body, env, headers1));
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.equal(data1.job.state, "AWAITING_APPROVAL");
  assert.ok(data1.job.completedAt);
  assert.equal(data1.job.revision, 4);

  const completedAtAfterFirst = data1.job.completedAt;

  // Second terminal report (duplicate callback) with fresh nonce
  const headers2 = await signHeaders({ pathname, body, timestamp: nowMs });
  const res2 = await onRequest(post(pathname, body, env, headers2));
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.ok, true);
  assert.equal(data2.noop, true);
  assert.equal(data2.completed, true);
  assert.equal(data2.job.completedAt, completedAtAfterFirst);

  // Verify the job row in DB was not mutated again
  const finalJob = await getJobById(db, "job-terminal");
  assert.equal(finalJob.revision, 4); // still 4, no extra CAS increment
  assert.equal(finalJob.completed_at, completedAtAfterFirst);
  assert.equal(finalJob.state, "AWAITING_APPROVAL");
});

test("renew lease extends expiry for current lease holder", async () => {
  const { env, nowMs, db } = setupRunnerTestEnv({
    connect_agent_job: [
      {
        id: "job-renew",
        tenant_id: "t1",
        session_id: "ses-1",
        deployment_id: "dep-1",
        actor_id: "act-1",
        state: "DISCOVERING",
        revision: 1,
        lease_owner: "runner-holder",
        lease_expires_at: TEST_NOW_MS + 10000,
        attempts: 1,
        max_attempts: 3,
        deadline_at: TEST_NOW_MS + 3600000,
        stage: "discovering",
        stage_code: null,
        candidate_version_id: null,
        completed_at: null,
        created_at: new Date(TEST_NOW_MS).toISOString(),
        updated_at: new Date(TEST_NOW_MS).toISOString(),
      },
    ],
  });

  const pathname = "/runner/jobs/job-renew/lease/renew";
  const body = { runnerId: "runner-holder", leaseDurationMs: 45000 };
  const headers = await signHeaders({ pathname, body, timestamp: nowMs, runnerId: "runner-holder" });

  const res = await onRequest(post(pathname, body, env, headers));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.leaseExpiresAt, nowMs + 45000);
  assert.equal(data.revision, 2);

  const updated = await getJobById(db, "job-renew");
  assert.equal(updated.lease_expires_at, nowMs + 45000);
});

test("renew lease refuses a runner that does not hold the lease", async () => {
  const { env, nowMs } = setupRunnerTestEnv({
    connect_agent_job: [
      {
        id: "job-renew-refuse",
        tenant_id: "t1",
        session_id: "ses-1",
        deployment_id: "dep-1",
        actor_id: "act-1",
        state: "DISCOVERING",
        revision: 1,
        lease_owner: "runner-holder",
        lease_expires_at: TEST_NOW_MS + 10000,
        attempts: 1,
        max_attempts: 3,
        deadline_at: TEST_NOW_MS + 3600000,
        stage: "discovering",
        stage_code: null,
        candidate_version_id: null,
        completed_at: null,
        created_at: new Date(TEST_NOW_MS).toISOString(),
        updated_at: new Date(TEST_NOW_MS).toISOString(),
      },
    ],
  });

  const pathname = "/runner/jobs/job-renew-refuse/lease/renew";
  const body = { runnerId: "runner-intruder", leaseDurationMs: 45000 };
  const headers = await signHeaders({ pathname, body, timestamp: nowMs, runnerId: "runner-intruder" });

  const res = await onRequest(post(pathname, body, env, headers));
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, "forbidden");
});
