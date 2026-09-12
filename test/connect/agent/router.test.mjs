// test/connect/agent/router.test.mjs -- Connect Hospital agent-broker HTTP router tests.
// Tests flag gating, authentication, RBAC, consent verification, viewer-token binding,
// pause/resume ownership transfer, delete/revoke cleanup, and leak-free hospital resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../../functions/api/connect/agent/[[path]].js";
import { makeAgentDb } from "./agent-db.mjs";
import { recordConsent } from "../../../functions/_connect/agent/consent.js";
import { deploymentFingerprint, getSessionRow, getJobRow, getViewerToken } from "../../../functions/_connect/agent/store.js";
import { sha256hex } from "../../../functions/_connect/agent/hmac.js";

const post = (path, body, env, headers = {}) => ({
  request: new Request("https://x" + path, {
    method: "POST",
    body: JSON.stringify(body || {}),
    headers: Object.assign({ "content-type": "application/json" }, headers),
  }),
  env,
  params: {},
});

const get = (path, env, headers = {}) => ({
  request: new Request("https://x" + path, {
    method: "GET",
    headers,
  }),
  env,
  params: {},
});

const del = (path, body, env, headers = {}) => ({
  request: new Request("https://x" + path, {
    method: "DELETE",
    body: body ? JSON.stringify(body) : undefined,
    headers: Object.assign(body ? { "content-type": "application/json" } : {}, headers),
  }),
  env,
  params: {},
});

const BASE_FLAGS = {
  CONNECT_FLAG: "1",
  CONNECT_ONBOARD_FLAG: "1",
  CONNECT_AGENT_FLAG: "1",
  CONNECT_BROWSER_SESSION_FLAG: "1",
  CONNECT_CONSENT_SIGNING_KEY: "secret-consent-signing-key-32bytes",
  CONNECT_AGENT_TOKEN_KEY: "secret-agent-token-key-32bytes",
};

async function setupTestEnv() {
  const nowMs = 1700000000000;
  const doc1Email = "doctor1@example.org";
  const doc1Id = "cfa:" + (await sha256hex(doc1Email));
  const doc2Email = "doctor2@example.org";
  const doc2Id = "cfa:" + (await sha256hex(doc2Email));
  const auditorEmail = "auditor1@example.org";
  const auditorId = "cfa:" + (await sha256hex(auditorEmail));
  const docT2Email = "doct2@example.org";
  const docT2Id = "cfa:" + (await sha256hex(docT2Email));

  const dep1Origins = ["https://emr1.example.org"];
  const dep1Fp = await deploymentFingerprint(dep1Origins);
  const dep2Origins = ["https://emr2-secret.example.org"];
  const dep2Fp = await deploymentFingerprint(dep2Origins);

  const db = makeAgentDb({
    connect_tenant: [
      { id: "t1", name: "Hospital Alpha", mode: "sandbox" },
      { id: "t2", name: "Hospital Beta Secret", mode: "sandbox" },
    ],
    connect_membership: [
      { user_id: doc1Id, tenant_id: "t1", role: "clinician" },
      { user_id: doc2Id, tenant_id: "t1", role: "clinician" },
      { user_id: auditorId, tenant_id: "t1", role: "auditor" },
      { user_id: docT2Id, tenant_id: "t2", role: "clinician" },
    ],
    connect_deployment: [
      {
        id: "dep-1",
        tenant_id: "t1",
        hospital_id: "hosp-alpha",
        name: "General Hospital Alpha",
        origins: JSON.stringify(dep1Origins),
        vendor: "epic",
        fingerprint: dep1Fp,
        network_mode: "public",
        active_version_id: null,
        status: "active",
        created_at: new Date(nowMs).toISOString(),
        updated_at: new Date(nowMs).toISOString(),
      },
      {
        id: "dep-secret-2",
        tenant_id: "t2",
        hospital_id: "hosp-beta-secret",
        name: "Secret Hospital Beta",
        origins: JSON.stringify(dep2Origins),
        vendor: "cerner",
        fingerprint: dep2Fp,
        network_mode: "public",
        active_version_id: null,
        status: "active",
        created_at: new Date(nowMs).toISOString(),
        updated_at: new Date(nowMs).toISOString(),
      },
    ],
    connect_adapter_version: [],
    connect_agent_consent: [],
    connect_agent_session: [],
    connect_agent_job: [],
    connect_agent_viewer_token: [],
  });

  const identifyFn = async (req) => {
    const email = req.headers.get("Cf-Access-Authenticated-User-Email");
    if (!email) return { id: "guest", guest: true };
    const em = email.toLowerCase();
    if (em === doc1Email) return { id: doc1Id, guest: false, email: doc1Email };
    if (em === doc2Email) return { id: doc2Id, guest: false, email: doc2Email };
    if (em === auditorEmail) return { id: auditorId, guest: false, email: auditorEmail };
    if (em === docT2Email) return { id: docT2Id, guest: false, email: docT2Email };
    return { id: "cfa:" + em, guest: false, email: em };
  };

  const env = Object.assign({}, BASE_FLAGS, {
    CONNECT_DB: db,
    now: () => nowMs,
    identifyFn,
  });

  return {
    db,
    env,
    nowMs,
    doc1: { id: doc1Id, email: doc1Email, headers: { "Cf-Access-Authenticated-User-Email": doc1Email } },
    doc2: { id: doc2Id, email: doc2Email, headers: { "Cf-Access-Authenticated-User-Email": doc2Email } },
    auditor: { id: auditorId, email: auditorEmail, headers: { "Cf-Access-Authenticated-User-Email": auditorEmail } },
    docT2: { id: docT2Id, email: docT2Email, headers: { "Cf-Access-Authenticated-User-Email": docT2Email } },
    dep1Origins,
    dep1Fp,
    dep2Origins,
    dep2Fp,
  };
}

// --- Flag Gating Tests ---

test("flag-off returns the same 'not enabled' shape the onboard router uses", async () => {
  const { doc1 } = await setupTestEnv();

  // All flags missing
  const res1 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", deploymentId: "dep-1" }, {}, doc1.headers));
  assert.equal(res1.status, 404);
  assert.equal(res1.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res1.json(), { error: "not_found" });

  // Master flag off
  const res2 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1" }, { CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "1" }, doc1.headers));
  assert.equal(res2.status, 404);
  assert.deepEqual(await res2.json(), { error: "not_found" });

  // Onboard flag off
  const res3 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1" }, { CONNECT_FLAG: "1", CONNECT_AGENT_FLAG: "1" }, doc1.headers));
  assert.equal(res3.status, 404);
  assert.deepEqual(await res3.json(), { error: "not_found" });

  // Agent flag off
  const res4 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1" }, { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" }, doc1.headers));
  assert.equal(res4.status, 404);
  assert.deepEqual(await res4.json(), { error: "not_found" });

  // Browser session flag off gates POST /sessions (404), but GET /sessions/:id or POST /hospitals/resolve are reachable past the router gate
  const envNoBrowser = Object.assign({}, BASE_FLAGS, { CONNECT_BROWSER_SESSION_FLAG: "0" });
  const res5 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", deploymentId: "dep-1" }, envNoBrowser, doc1.headers));
  assert.equal(res5.status, 404);
  assert.deepEqual(await res5.json(), { error: "not_found" });
});

test("unknown sub-path returns 404", async () => {
  const { env, doc1 } = await setupTestEnv();
  const res = await onRequest(get("/api/connect/agent/nonexistent-endpoint", env, doc1.headers));
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not_found" });
});

// --- Unauthenticated Requests Denied ---

test("unauthenticated request denied with sanitized 401 and no-store", async () => {
  const { env } = await setupTestEnv();

  // POST /sessions
  const r1 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", deploymentId: "dep-1" }, env));
  assert.equal(r1.status, 401);
  assert.equal(r1.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r1.json(), { error: "auth" });

  // GET /sessions/:id
  const r2 = await onRequest(get("/api/connect/agent/sessions/sess-1?tenant=t1", env));
  assert.equal(r2.status, 401);
  assert.deepEqual(await r2.json(), { error: "auth" });

  // POST /sessions/:id/viewer-token
  const r3 = await onRequest(post("/api/connect/agent/sessions/sess-1/viewer-token", { tenantId: "t1" }, env));
  assert.equal(r3.status, 401);
  assert.deepEqual(await r3.json(), { error: "auth" });

  // POST /sessions/:id/handoff
  const r4 = await onRequest(post("/api/connect/agent/sessions/sess-1/handoff", { tenantId: "t1" }, env));
  assert.equal(r4.status, 401);
  assert.deepEqual(await r4.json(), { error: "auth" });

  // POST /sessions/:id/pause
  const r5 = await onRequest(post("/api/connect/agent/sessions/sess-1/pause", { tenantId: "t1" }, env));
  assert.equal(r5.status, 401);
  assert.deepEqual(await r5.json(), { error: "auth" });

  // POST /sessions/:id/resume
  const r6 = await onRequest(post("/api/connect/agent/sessions/sess-1/resume", { tenantId: "t1" }, env));
  assert.equal(r6.status, 401);
  assert.deepEqual(await r6.json(), { error: "auth" });

  // DELETE /sessions/:id
  const r7 = await onRequest(del("/api/connect/agent/sessions/sess-1?tenant=t1", {}, env));
  assert.equal(r7.status, 401);
  assert.deepEqual(await r7.json(), { error: "auth" });

  // POST /hospitals/resolve
  const r8 = await onRequest(post("/api/connect/agent/hospitals/resolve", { tenantId: "t1", origins: ["https://emr1.example.org"] }, env));
  assert.equal(r8.status, 401);
  assert.deepEqual(await r8.json(), { error: "auth" });
});

// --- Cross-Tenant and Role Denied ---

test("cross-tenant request denied (IDOR protection)", async () => {
  const { env, doc1 } = await setupTestEnv();

  // Doc1 is a member of t1 only; asking for t2 is rejected with 403
  const res = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t2", deploymentId: "dep-secret-2" }, env, doc1.headers));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "permission" });
});

test("auditor role is denied session creation (fail-closed RBAC)", async () => {
  const { env, auditor } = await setupTestEnv();

  // Auditor has read permission but may not perform "session"
  const res = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", deploymentId: "dep-1" }, env, auditor.headers));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "permission" });
});

// --- Credential Safety ---

test("POST /sessions rejects supplied credentials and never echoes them", async () => {
  const { env, doc1 } = await setupTestEnv();

  const credBodies = [
    { tenantId: "t1", deploymentId: "dep-1", password: "SecretPassword123!" },
    { tenantId: "t1", deploymentId: "dep-1", token: "bearer-token-secret" },
    { tenantId: "t1", deploymentId: "dep-1", credentials: { user: "dr-x", pass: "1234" } },
    { tenantId: "t1", deploymentId: "dep-1", secret: "my-secret" },
    { tenantId: "t1", deploymentId: "dep-1", auth: { method: "basic" } },
  ];

  for (const b of credBodies) {
    const res = await onRequest(post("/api/connect/agent/sessions", b, env, doc1.headers));
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.deepEqual(data, { error: "invalid" });
    assert.doesNotMatch(JSON.stringify(data), /SecretPassword/);
    assert.doesNotMatch(JSON.stringify(data), /bearer-token/);
  }
});

// --- Consent Verification ---

test("missing or invalid consent denied", async () => {
  const { db, env, nowMs, doc1 } = await setupTestEnv();

  // 1. Missing consent entirely
  const r1 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", deploymentId: "dep-1" }, env, doc1.headers));
  assert.equal(r1.status, 403);
  assert.deepEqual(await r1.json(), { error: "forbidden" });

  // 2. Expired consent
  const expiredRow = await recordConsent(
    { db, now: () => nowMs - 100000 },
    env,
    {
      tenantId: "t1",
      actorId: doc1.id,
      deploymentId: "dep-1",
      scope: ["emr:session"],
      ttlMs: 1000,
      now: nowMs - 100000,
    }
  );
  const r2 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", deploymentId: "dep-1" }, env, doc1.headers));
  assert.equal(r2.status, 400);
  assert.deepEqual(await r2.json(), { error: "expired" });

  // Clean up expired row from db
  db._tables.connect_agent_consent = [];

  // 3. Revoked consent
  const revRow = await recordConsent(
    { db, now: () => nowMs },
    env,
    {
      tenantId: "t1",
      actorId: doc1.id,
      deploymentId: "dep-1",
      scope: ["emr:session"],
      now: nowMs,
    }
  );
  await db.prepare("UPDATE connect_agent_consent SET revoked_at=? WHERE id=?").bind(nowMs, revRow.id).run();
  const r3 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", deploymentId: "dep-1" }, env, doc1.headers));
  assert.equal(r3.status, 400);
  assert.deepEqual(await r3.json(), { error: "revoked" });

  // Clean up revoked row
  db._tables.connect_agent_consent = [];

  // 4. Tampered consent receipt HMAC
  const tamperRow = await recordConsent(
    { db, now: () => nowMs },
    env,
    {
      tenantId: "t1",
      actorId: doc1.id,
      deploymentId: "dep-1",
      scope: ["emr:session"],
      now: nowMs,
    }
  );
  await db.prepare("UPDATE connect_agent_consent SET receipt_hmac=? WHERE id=?").bind("badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb", tamperRow.id).run();
  const r4 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", deploymentId: "dep-1" }, env, doc1.headers));
  assert.equal(r4.status, 403);
  assert.deepEqual(await r4.json(), { error: "forbidden" });

  // 5. Consent missing required scope ("emr:read" granted, but not "emr:session")
  db._tables.connect_agent_consent = [];
  await recordConsent(
    { db, now: () => nowMs },
    env,
    {
      tenantId: "t1",
      actorId: doc1.id,
      deploymentId: "dep-1",
      scope: ["emr:read"],
      now: nowMs,
    }
  );
  const r5 = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", deploymentId: "dep-1" }, env, doc1.headers));
  assert.equal(r5.status, 403);
  assert.deepEqual(await r5.json(), { error: "forbidden" });
});

// --- Session Creation and Resumption ---

test("POST /sessions creates session and job, returns sanitized view, and resumes existing live session", async () => {
  const { db, env, nowMs, doc1 } = await setupTestEnv();

  await recordConsent(
    { db, now: () => nowMs },
    env,
    {
      tenantId: "t1",
      actorId: doc1.id,
      deploymentId: "dep-1",
      scope: ["emr:session", "emr:discover", "emr:read"],
      now: nowMs,
    }
  );

  // Initial session creation
  const res1 = await onRequest(post("/api/connect/agent/sessions", {
    tenantId: "t1",
    deploymentId: "dep-1",
    idempotencyKey: "test-idem-1",
  }, env, doc1.headers));

  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.match(data1.sessionId, /^ses_/);
  assert.equal(data1.deploymentId, "dep-1");
  assert.equal(data1.state, "CREATED");
  assert.equal(data1.controlOwner, "clinician");
  assert.equal(data1.revision, 1);
  assert.match(data1.job.jobId, /^job_/);
  assert.equal(data1.job.state, "CREATED");

  // Invariant: runner credentials never leave server
  assert.equal("runner_ref" in data1, false);
  assert.equal("runner_id" in data1, false);

  // App reconnection/backgrounding: calling POST /sessions again resumes live session
  const res2 = await onRequest(post("/api/connect/agent/sessions", {
    tenantId: "t1",
    deploymentId: "dep-1",
  }, env, doc1.headers));

  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.sessionId, data1.sessionId);
  assert.equal(data2.job.jobId, data1.job.jobId);
});

// --- Viewer Token Actor-Bound and Single-Use ---

test("viewer-token is actor-bound (a different actor's token is rejected) and single-use", async () => {
  const { db, env, nowMs, doc1, doc2 } = await setupTestEnv();

  await recordConsent(
    { db, now: () => nowMs },
    env,
    {
      tenantId: "t1",
      actorId: doc1.id,
      deploymentId: "dep-1",
      scope: ["emr:session", "emr:discover", "emr:read"],
      now: nowMs,
    }
  );

  const sRes = await onRequest(post("/api/connect/agent/sessions", {
    tenantId: "t1",
    deploymentId: "dep-1",
  }, env, doc1.headers));
  const { sessionId } = await sRes.json();

  // Doc2 cannot request viewer token for Doc1's session (ownership check fails)
  const doc2Req = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/viewer-token`, {
    tenantId: "t1",
  }, env, doc2.headers));
  assert.equal(doc2Req.status, 404);
  assert.deepEqual(await doc2Req.json(), { error: "not-found" });

  // Doc1 requests viewer token
  const vtRes = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/viewer-token`, {
    tenantId: "t1",
    ttlMs: 60000,
  }, env, doc1.headers));
  assert.equal(vtRes.status, 200);
  const vtData = await vtRes.json();
  assert.equal(vtData.ok, true);
  assert.match(vtData.token, /^smdvt1\./);
  assert.match(vtData.jti, /^vt_/);

  // Doc2 attempts to redeem Doc1's viewer token -> rejected
  const redeemDoc2 = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/viewer-token/redeem`, {
    tenantId: "t1",
    token: vtData.token,
  }, env, doc2.headers));
  assert.equal(redeemDoc2.status, 403);
  assert.deepEqual(await redeemDoc2.json(), { error: "forbidden" });

  // Doc1 redeems their own viewer token -> succeeds
  const redeemDoc1 = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/viewer-token/redeem`, {
    tenantId: "t1",
    token: vtData.token,
  }, env, doc1.headers));
  assert.equal(redeemDoc1.status, 200);
  const redeemed = await redeemDoc1.json();
  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.sessionId, sessionId);

  // Single-use invariant: second redemption rejected with 409 conflict
  const redeemAgain = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/viewer-token/redeem`, {
    tenantId: "t1",
    token: vtData.token,
  }, env, doc1.headers));
  assert.equal(redeemAgain.status, 409);
  assert.deepEqual(await redeemAgain.json(), { error: "conflict" });
});

// --- Pause and Resume Ownership Gating ---

test("pause/resume rejected for a non-owning actor", async () => {
  const { db, env, nowMs, doc1, doc2 } = await setupTestEnv();

  await recordConsent(
    { db, now: () => nowMs },
    env,
    {
      tenantId: "t1",
      actorId: doc1.id,
      deploymentId: "dep-1",
      scope: ["emr:session", "emr:discover", "emr:read"],
      now: nowMs,
    }
  );

  const sRes = await onRequest(post("/api/connect/agent/sessions", {
    tenantId: "t1",
    deploymentId: "dep-1",
  }, env, doc1.headers));
  const { sessionId } = await sRes.json();

  // Doc2 attempts pause on Doc1's session -> rejected with 404 not-found
  const pauseNonOwner = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/pause`, {
    tenantId: "t1",
  }, env, doc2.headers));
  assert.equal(pauseNonOwner.status, 404);
  assert.deepEqual(await pauseNonOwner.json(), { error: "not-found" });

  // Doc2 attempts resume on Doc1's session -> rejected with 404 not-found
  const resumeNonOwner = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/resume`, {
    tenantId: "t1",
  }, env, doc2.headers));
  assert.equal(resumeNonOwner.status, 404);
  assert.deepEqual(await resumeNonOwner.json(), { error: "not-found" });

  // Doc1 (owner) successfully transfers ownership
  const pauseOwner = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/pause`, {
    tenantId: "t1",
  }, env, doc1.headers));
  assert.equal(pauseOwner.status, 200);
  const pauseData = await pauseOwner.json();
  assert.equal(pauseData.controlOwner, "clinician");

  const resumeOwner = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/resume`, {
    tenantId: "t1",
  }, env, doc1.headers));
  assert.equal(resumeOwner.status, 200);
  const resumeData = await resumeOwner.json();
  assert.equal(resumeData.controlOwner, "agent");
});

// --- Handoff and Idempotency ---

test("POST /sessions/:id/handoff transitions state to AUTHENTICATED and is idempotent", async () => {
  const { db, env, nowMs, doc1 } = await setupTestEnv();

  await recordConsent(
    { db, now: () => nowMs },
    env,
    {
      tenantId: "t1",
      actorId: doc1.id,
      deploymentId: "dep-1",
      scope: ["emr:session", "emr:discover", "emr:read"],
      now: nowMs,
    }
  );

  const sRes = await onRequest(post("/api/connect/agent/sessions", {
    tenantId: "t1",
    deploymentId: "dep-1",
  }, env, doc1.headers));
  const { sessionId } = await sRes.json();

  // Initial handoff
  const hRes1 = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/handoff`, {
    tenantId: "t1",
    idempotencyKey: "handoff-key-1",
  }, env, doc1.headers));

  assert.equal(hRes1.status, 200);
  const hData1 = await hRes1.json();
  assert.equal(hData1.ok, true);
  assert.equal(hData1.state, "AUTHENTICATED");
  assert.equal(hData1.controlOwner, "agent");
  // AUTHENTICATED, not DISCOVERING: handoff hands the job to a runner ready to lease, it does not
  // itself advance to DISCOVERING - JOB_LEASABLE (state.js) is only CREATED/AUTHENTICATED, so a job
  // handoff pushed straight to DISCOVERING could never actually be leased by any runner (DISCOVERING
  // is reclaimable-after-lease-loss only). The runner's own POST .../report with stage:"DISCOVERING"
  // is what makes that transition, once it has actually leased the job - see
  // functions/api/connect/agent/runner/[[path]].js and the acceptance matrix (Scenario 2) that caught
  // this the first time a runner actually tried to lease a freshly-handed-off job and got none.
  assert.equal(hData1.job.state, "AUTHENTICATED");

  // Idempotent repeated handoff
  const hRes2 = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/handoff`, {
    tenantId: "t1",
    idempotencyKey: "handoff-key-1",
  }, env, doc1.headers));

  assert.equal(hRes2.status, 200);
  const hData2 = await hRes2.json();
  assert.equal(hData2.ok, true);
  assert.equal(hData2.idempotent, true);
  assert.equal(hData2.state, "AUTHENTICATED");
});

// --- DELETE Reaches Revoke / Cleanup ---

test("DELETE actually reaches revoke/cleanup in state.js", async () => {
  const { db, env, nowMs, doc1 } = await setupTestEnv();

  await recordConsent(
    { db, now: () => nowMs },
    env,
    {
      tenantId: "t1",
      actorId: doc1.id,
      deploymentId: "dep-1",
      scope: ["emr:session", "emr:discover", "emr:read"],
      now: nowMs,
    }
  );

  const sRes = await onRequest(post("/api/connect/agent/sessions", {
    tenantId: "t1",
    deploymentId: "dep-1",
  }, env, doc1.headers));
  const { sessionId } = await sRes.json();

  // Issue viewer token before deletion
  const vtRes = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/viewer-token`, {
    tenantId: "t1",
  }, env, doc1.headers));
  const { jti } = await vtRes.json();

  // Perform DELETE
  const delRes = await onRequest(del(`/api/connect/agent/sessions/${sessionId}`, {
    tenantId: "t1",
    revokeConsent: true,
  }, env, doc1.headers));

  assert.equal(delRes.status, 200);
  const delData = await delRes.json();
  assert.equal(delData.ok, true);
  assert.equal(delData.cancelled, true);
  assert.equal(delData.state, "CANCELLED");

  // Verify underlying session row in DB is marked CANCELLED with closed_at and cleanup_after
  const sessionRow = await getSessionRow(db, "t1", sessionId);
  assert.equal(sessionRow.state, "CANCELLED");
  assert.ok(sessionRow.closed_at);
  assert.ok(sessionRow.cleanup_after);

  // Verify underlying job row in DB is marked CANCELLED
  const jobRow = await getJobRow(db, "t1", delData.job.jobId);
  assert.equal(jobRow.state, "CANCELLED");
  assert.ok(jobRow.completed_at);

  // Verify outstanding viewer token was revoked
  const vtRow = await getViewerToken(db, jti);
  assert.ok(vtRow.revoked_at);

  // Attempting to delete already cancelled session fails closed with conflict
  const secondDel = await onRequest(del(`/api/connect/agent/sessions/${sessionId}`, {
    tenantId: "t1",
  }, env, doc1.headers));
  assert.equal(secondDel.status, 409);
  assert.deepEqual(await secondDel.json(), { error: "conflict" });
});

// --- Hospitals Resolve: No Leakage ---

test("hospitals/resolve does not distinguish 'exists but not yours' from 'does not exist' in its response", async () => {
  const { env, doc1 } = await setupTestEnv();

  // Case A: Query for hospital in t2 (which exists in DB, but Doc1 has no membership in t2)
  const resForbidden = await onRequest(post("/api/connect/agent/hospitals/resolve", {
    tenantId: "t2",
    deploymentId: "dep-secret-2",
  }, env, doc1.headers));

  // Case B: Query for hospital in a fictional tenant (which does not exist at all)
  const resNonexistent = await onRequest(post("/api/connect/agent/hospitals/resolve", {
    tenantId: "t-fictional-does-not-exist",
    deploymentId: "dep-fictional",
  }, env, doc1.headers));

  // Case C: Query for non-existent deployment in Doc1's own tenant
  const resNotFoundSameTenant = await onRequest(post("/api/connect/agent/hospitals/resolve", {
    tenantId: "t1",
    deploymentId: "dep-nonexistent",
  }, env, doc1.headers));

  // Assert all three responses are IDENTICAL
  assert.equal(resForbidden.status, 404);
  assert.equal(resNonexistent.status, 404);
  assert.equal(resNotFoundSameTenant.status, 404);

  const bodyA = await resForbidden.json();
  const bodyB = await resNonexistent.json();
  const bodyC = await resNotFoundSameTenant.json();

  assert.deepEqual(bodyA, { error: "not-found" });
  assert.deepEqual(bodyB, { error: "not-found" });
  assert.deepEqual(bodyC, { error: "not-found" });

  // And an accessible hospital in Doc1's own tenant succeeds with client-safe view
  const resFound = await onRequest(post("/api/connect/agent/hospitals/resolve", {
    tenantId: "t1",
    origins: ["https://emr1.example.org"],
  }, env, doc1.headers));

  assert.equal(resFound.status, 200);
  const foundData = await resFound.json();
  assert.equal(foundData.ok, true);
  assert.equal(foundData.deploymentId, "dep-1");
  assert.equal(foundData.hospitalId, "hosp-alpha");
  assert.equal(foundData.name, "General Hospital Alpha");
  assert.equal("fingerprint" in foundData, false);
  assert.equal("tenant_id" in foundData, false);
});

// --- Adversarial Tests (mirroring rbac-adversarial.test.mjs) ---

test("raw browser runner controls (evaluate, navigate, devtools) are never exposed", async () => {
  const { env, doc1 } = await setupTestEnv();

  const paths = [
    "/api/connect/agent/evaluate",
    "/api/connect/agent/sessions/sess-1/evaluate",
    "/api/connect/agent/sessions/sess-1/navigate",
    "/api/connect/agent/navigate",
    "/api/connect/agent/runner",
    "/api/connect/agent/devtools",
    "/api/connect/agent/sessions/sess-1/cdp",
  ];

  for (const p of paths) {
    const postRes = await onRequest(post(p, { script: "alert(1)" }, env, doc1.headers));
    assert.equal(postRes.status, 404);
    assert.deepEqual(await postRes.json(), { error: "not_found" });

    const getRes = await onRequest(get(p, env, doc1.headers));
    assert.equal(getRes.status, 404);
    assert.deepEqual(await getRes.json(), { error: "not_found" });
  }
});

test("prototype-pollution keys in body do not grant access or pollute responses", async () => {
  const { env, doc1 } = await setupTestEnv();

  const hostileBody = JSON.parse('{"__proto__":{"role":"superadmin"},"constructor":{"prototype":{"role":"superadmin"}},"tenantId":"t1","deploymentId":"dep-1"}');
  const res = await onRequest(post("/api/connect/agent/sessions", hostileBody, env, doc1.headers));
  // Must fail at consent (since doc1 has no consent yet), NOT bypass to superadmin
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "forbidden" });
  assert.equal(({}).role, undefined);
});

test("native identify() without env override works with Cf-Access header", async () => {
  const { sha256hex: usageSha } = await import("../../../functions/_usage.js");
  const email = "native-doc@example.org";
  const nativeActorId = "cfa:" + (await usageSha(email));

  const db = makeAgentDb({
    connect_tenant: [{ id: "t1", name: "Alpha", mode: "sandbox" }],
    connect_membership: [{ user_id: nativeActorId, tenant_id: "t1", role: "clinician" }],
    connect_deployment: [],
    connect_adapter_version: [],
    connect_agent_consent: [],
    connect_agent_session: [],
    connect_agent_job: [],
    connect_agent_viewer_token: [],
  });

  // Env WITHOUT identifyFn override -- uses real identify() in functions/_usage.js
  const env = Object.assign({}, BASE_FLAGS, { CONNECT_DB: db });
  const headers = { "Cf-Access-Authenticated-User-Email": email };

  const res = await onRequest(post("/api/connect/agent/hospitals/resolve", {
    tenantId: "t1",
    hospitalId: "nonexistent",
  }, env, headers));

  // Resolved tenant, reached deployment lookup, not-found (authenticated and authorized!)
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not-found" });
});


// --- Tenant listing for the picker ---

test("GET /tenants lists the caller's tenants without a tenant chosen; unauthenticated is 401", async () => {
  const { env, doc1 } = await setupTestEnv();
  const res = await onRequest(get("/api/connect/agent/tenants", env, doc1.headers));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.ok, true);
  assert.ok(d.tenants.some((t) => t.tenantId === "t1"), "doc1's own tenant is listed");
  const r2 = await onRequest(get("/api/connect/agent/tenants", env));
  assert.equal(r2.status, 401);
});
