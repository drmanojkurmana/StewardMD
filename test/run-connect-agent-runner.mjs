// test/run-connect-agent-runner.mjs -- Integration test for connect-agent/runner.mjs.
// Tests fake lease/report server with HMAC validation, end-to-end lease -> discover -> compile ->
// validate -> report-success pipeline with synthetic EMR, and failure handling without wedging.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { hmacHex, equalHex } from "../functions/_connect/agent/hmac.js";
import { pollAndProcessOnce, processJob, signRunnerRequest } from "../connect-agent/runner.mjs";
import { fakeCamofoxClient } from "./connect-agent/fake-camofox-client.mjs";
import { startSyntheticEmr } from "./connect-agent/synthetic-emr-server.mjs";

const RUNNER_KEY = "integration-runner-key-secret-32b";
const RUNNER_ID = "runner-integration-1";

function createFakeBrokerServer({ jobs = [] } = {}) {
  const jobList = jobs.map((j) => ({ ...j }));
  const receivedReports = [];
  const nonces = new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const method = req.method.toUpperCase();

    let rawBody = "";
    for await (const chunk of req) rawBody += chunk;
    let body = {};
    try {
      if (rawBody) body = JSON.parse(rawBody);
    } catch {}

    const sendJson = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    // Verify HMAC on all requests
    const sig = req.headers["x-smd-signature"];
    const tsStr = req.headers["x-smd-timestamp"];
    const nonce = req.headers["x-smd-nonce"];

    if (!sig || !tsStr || !nonce) {
      return sendJson(401, { error: "missing_headers" });
    }

    const ts = Number(tsStr);
    if (Math.abs(Date.now() - ts) > 120000) {
      return sendJson(401, { error: "timestamp_out_of_window" });
    }

    if (nonces.has(nonce)) {
      return sendJson(401, { error: "nonce_replayed" });
    }
    nonces.add(nonce);

    const canonical = `${method}\n${url.pathname}\n${tsStr}\n${nonce}\n${rawBody}`;
    const expectedSig = await hmacHex(RUNNER_KEY, canonical);
    if (!equalHex(expectedSig, sig)) {
      return sendJson(401, { error: "invalid_signature" });
    }

    // Route: POST /runner/jobs/lease or /api/connect/agent/runner/jobs/lease
    if (method === "POST" && url.pathname.endsWith("/jobs/lease")) {
      const available = jobList.find((j) => !j.completed_at && (!j.lease_expires_at || j.lease_expires_at <= Date.now()));
      if (!available) {
        return sendJson(200, { ok: true, job: null });
      }
      available.lease_owner = body.runnerId || RUNNER_ID;
      available.lease_expires_at = Date.now() + 30000;
      available.attempts = (available.attempts || 0) + 1;
      available.revision = (available.revision || 1) + 1;

      return sendJson(200, {
        ok: true,
        job: {
          id: available.id,
          tenantId: available.tenant_id,
          sessionId: available.session_id,
          deploymentId: available.deployment_id,
          state: available.state,
          revision: available.revision,
          leaseOwner: available.lease_owner,
          leaseExpiresAt: available.lease_expires_at,
          attempts: available.attempts,
        },
        session: available.session || {
          id: available.session_id,
          state: "AUTHENTICATED",
          runnerRef: "camofox-user-integration",
        },
        deployment: available.deployment || {
          id: available.deployment_id,
          origins: available.origins || ["https://emr.example"],
        },
      });
    }

    // Route: POST /runner/jobs/:id/report
    const reportMatch = url.pathname.match(/\/jobs\/([^/]+)\/report$/);
    if (method === "POST" && reportMatch) {
      const jobId = decodeURIComponent(reportMatch[1]);
      const job = jobList.find((j) => j.id === jobId);
      if (!job) return sendJson(404, { error: "not_found" });

      receivedReports.push({ jobId, ...body });

      if (body.outcome === "failure") {
        job.state = "FAILED";
        job.completed_at = new Date().toISOString();
        job.stage_code = body.errorCode;
      } else if (body.outcome === "success") {
        if (body.stage === "DISCOVERING") job.state = "COMPILING";
        else if (body.stage === "COMPILING") job.state = "VALIDATING";
        else if (body.stage === "VALIDATING") {
          job.state = "AWAITING_APPROVAL";
          job.completed_at = new Date().toISOString();
          job.candidate_version_id = body.candidateVersionId;
        }
      }

      return sendJson(200, {
        ok: true,
        job: {
          id: job.id,
          state: job.state,
          stage: body.stage.toLowerCase(),
          completedAt: job.completed_at || null,
          candidateVersionId: job.candidate_version_id || null,
        },
      });
    }

    return sendJson(404, { error: "not_found" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}/runner/`,
        receivedReports,
        jobList,
        close: () =>
          new Promise((r) => {
            if (typeof server.closeAllConnections === "function") server.closeAllConnections();
            server.close(r);
          }),
      });
    });
  });
}

test("full cycle: lease -> discover -> compile -> validate -> report-success", async () => {
  const emr = await startSyntheticEmr();

  const mockEvents = [
    {
      method: "GET",
      origin: emr.origin,
      path: "/api/patients",
      queryKeys: [],
      status: 200,
      contentType: "application/json",
      responseShape: {
        type: "object",
        keys: {
          items: {
            type: "array",
            sample: {
              type: "object",
              keys: {
                id: "string",
                name: "string",
              },
            },
          },
        },
      },
    },
    {
      method: "GET",
      origin: emr.origin,
      path: "/api/patients/{id}/medications",
      queryKeys: [],
      status: 200,
      contentType: "application/json",
      responseShape: {
        type: "object",
        keys: {
          items: {
            type: "array",
            sample: {
              type: "object",
              keys: {
                id: "string",
                drug: "string",
                dose: "string",
                status: "string",
              },
            },
          },
        },
      },
    },
    {
      method: "GET",
      origin: emr.origin,
      path: "/api/patients/{id}/results",
      queryKeys: [],
      status: 200,
      contentType: "application/json",
      responseShape: {
        type: "object",
        keys: {
          items: {
            type: "array",
            sample: {
              type: "object",
              keys: {
                id: "string",
                test: "string",
                value: "string",
                unit: "string",
                status: "string",
              },
            },
          },
        },
      },
    },
  ];

  const validationFixture = {
    params: { patientId: "pt-482910" },
    routes: {
      "GET /api/patients": {
        status: 200,
        body: { items: [{ id: "pt-482910", name: "Synthetic Testpatient" }] },
      },
      "GET /api/patients/pt-482910/medications": {
        status: 200,
        body: { items: [{ id: "med-1", drug: "Metformin", dose: "500mg", status: "active" }] },
      },
      "GET /api/patients/pt-482910/results": {
        status: 200,
        body: { items: [{ id: "res-1", test: "Glucose", value: "95", unit: "mg/dL", status: "final" }] },
      },
    },
  };

  const client = fakeCamofoxClient({ events: mockEvents });

  const broker = await createFakeBrokerServer({
    jobs: [
      {
        id: "job-full-cycle-1",
        tenant_id: "tenant-alpha",
        session_id: "ses-101",
        deployment_id: "dep-101",
        state: "AUTHENTICATED",
        revision: 1,
        origins: [emr.origin],
      },
    ],
  });

  try {
    const res = await pollAndProcessOnce({
      runnerKey: RUNNER_KEY,
      runnerId: RUNNER_ID,
      baseUrl: broker.url,
      camofoxClient: client,
      discoveryWaitMs: 50,
      validationFixture,
    });

    assert.equal(res.leased, true);
    assert.equal(res.job.id, "job-full-cycle-1");
    assert.equal(res.result.ok, true);
    assert.ok(res.result.candidateVersionId.startsWith("ver_"));
    assert.ok(res.result.manifest);
    assert.ok(res.result.validation.evidenceHash);

    // Verify all stage reports were transmitted in order
    const stages = broker.receivedReports.map((r) => `${r.stage}:${r.outcome}`);
    assert.deepEqual(stages, [
      "DISCOVERING:progress",
      "DISCOVERING:success",
      "COMPILING:progress",
      "COMPILING:success",
      "VALIDATING:progress",
      "VALIDATING:success",
    ]);

    // Verify terminal report carried candidateVersionId and evidenceHash
    const finalReport = broker.receivedReports[broker.receivedReports.length - 1];
    assert.equal(finalReport.stage, "VALIDATING");
    assert.equal(finalReport.outcome, "success");
    assert.equal(finalReport.candidateVersionId, res.result.candidateVersionId);
    assert.equal(finalReport.evidenceHash, res.result.validation.evidenceHash);

    // Verify job in broker reached AWAITING_APPROVAL
    const brokerJob = broker.jobList.find((j) => j.id === "job-full-cycle-1");
    assert.equal(brokerJob.state, "AWAITING_APPROVAL");
    assert.ok(brokerJob.completed_at);
  } finally {
    await broker.close();
    await emr.close();
  }
});

test("failure cycle: discovery error reports failure with safe errorCode and does not wedge", async () => {
  // Faulty Camofox client that throws during discovery
  const failingClient = {
    async createTab() {
      throw new Error("Camofox connection refused: internal connection error with token 12345");
    },
  };

  const broker = await createFakeBrokerServer({
    jobs: [
      {
        id: "job-fail-cycle-1",
        tenant_id: "tenant-alpha",
        session_id: "ses-fail",
        deployment_id: "dep-fail",
        state: "AUTHENTICATED",
        revision: 1,
        origins: ["https://emr.example.test"],
      },
    ],
  });

  try {
    const res = await pollAndProcessOnce({
      runnerKey: RUNNER_KEY,
      runnerId: RUNNER_ID,
      baseUrl: broker.url,
      camofoxClient: failingClient,
      discoveryWaitMs: 50,
    });

    assert.equal(res.leased, true);
    assert.equal(res.result.ok, false);
    // Verified safe error code, never leaks upstream message
    assert.equal(res.result.errorCode, "E_DISCOVERY_FAILED");

    // Verify failure report arrived at server
    const failReport = broker.receivedReports.find((r) => r.outcome === "failure");
    assert.ok(failReport);
    assert.equal(failReport.stage, "DISCOVERING");
    assert.equal(failReport.errorCode, "E_DISCOVERY_FAILED");
    // Ensure no raw message / sensitive text leaked into report
    assert.equal(JSON.stringify(failReport).includes("token"), false);

    // Verify job reached FAILED state
    const brokerJob = broker.jobList.find((j) => j.id === "job-fail-cycle-1");
    assert.equal(brokerJob.state, "FAILED");
    assert.equal(brokerJob.stage_code, "E_DISCOVERY_FAILED");
    assert.ok(brokerJob.completed_at);

    // Verify the runner does not wedge: another poll attempt succeeds gracefully
    const nextRes = await pollAndProcessOnce({
      runnerKey: RUNNER_KEY,
      runnerId: RUNNER_ID,
      baseUrl: broker.url,
      camofoxClient: failingClient,
    });
    assert.equal(nextRes.leased, false);
    assert.equal(nextRes.job, null);
  } finally {
    await broker.close();
  }
});
