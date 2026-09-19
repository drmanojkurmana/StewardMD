// functions/api/connect/agent/runner/[[path]].js -- Connect Hospital runner callback HTTP surface.
// Cloudflare Pages routes /api/connect/agent/runner/* here. Flag-gated (smd_connect_agent, default OFF => 404,
// no existence leak); shared runner HMAC secret verification with replay protection (+-120s timestamp window,
// nonce uniqueness); CAS-guarded leasing and terminal completion deduplication.
import { jsonResponse } from "../../../../_connect/testkit.js";
import { agentFlagOn } from "../../../../_connect/agent/flags.js";
import { AuthError, PermissionError } from "../../../../_connect/permission.js";
import { OnboardError } from "../../../../_connect/onboard/errors.js";
import { hmacHex, equalHex } from "../../../../_connect/agent/hmac.js";
import { makeSecrets } from "../../../../_connect/secrets.js";
import {
  assertTransition,
  JOB_LEASABLE,
  JOB_RECLAIMABLE,
} from "../../../../_connect/agent/state.js";
import {
  getJobById,
  casJob,
  casJobLease,
  casRenewJobLease,
  jobsInStates,
  getNonce,
  insertNonce,
  getSessionRow,
  getDeployment,
  deploymentOrigins,
  insertVersion,
  nowIso,
} from "../../../../_connect/agent/store.js";

export const TIMESTAMP_WINDOW_MS = 120 * 1000; // +-120 seconds

const STATUS = (e) =>
  e instanceof OnboardError
    ? e.klass === "not-found"
      ? 404
      : e.klass === "too-large"
        ? 413
        : e.klass === "forbidden"
          ? 403
          : e.klass === "conflict"
            ? 409
            : 400
    : e instanceof AuthError
      ? 401
      : e instanceof PermissionError
        ? 403
        : 400;

const CODE = (e) =>
  e instanceof OnboardError
    ? e.klass
    : e && e.constructor && e.constructor.name
      ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error"
      : "error";

async function resolveRunnerKey(deps, env) {
  let key = env && (env.RUNNER_HMAC_KEY || env.CONNECT_AGENT_RUNNER_KEY);
  if (!key && deps && deps.secrets) {
    try {
      key = (await deps.secrets.get("RUNNER_HMAC_KEY")) || (await deps.secrets.get("CONNECT_AGENT_RUNNER_KEY"));
    } catch {}
  }
  if (!key) throw new OnboardError("not-configured", "RUNNER_HMAC_KEY missing");
  return String(key);
}

function sanitizeErrorCode(raw) {
  if (typeof raw !== "string" || !raw) return "E_FAILED";
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 64);
  return cleaned || "E_FAILED";
}

async function verifyHmacAuth({ request, rawBody, runnerKey, deps }) {
  const h = request.headers;
  const sig = h.get("x-smd-signature") || h.get("x-signature");
  const tsHeader = h.get("x-smd-timestamp") || h.get("x-timestamp");
  const nonce = h.get("x-smd-nonce") || h.get("x-nonce");
  const runnerId = h.get("x-smd-runner-id") || h.get("x-runner-id") || null;

  if (!sig || !tsHeader || !nonce) {
    throw new AuthError("missing required hmac headers");
  }

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) {
    throw new AuthError("invalid timestamp");
  }

  const nowMs = Number(deps.now());
  if (Math.abs(nowMs - ts) > TIMESTAMP_WINDOW_MS) {
    throw new AuthError("timestamp out of window");
  }

  const existingNonce = await getNonce(deps.db, nonce);
  if (existingNonce) {
    throw new AuthError("nonce already used");
  }

  const url = new URL(request.url);
  const canonicalMsg = `${request.method.toUpperCase()}\n${url.pathname}\n${tsHeader}\n${nonce}\n${rawBody}`;
  const expectedSig = await hmacHex(runnerKey, canonicalMsg);

  if (!equalHex(expectedSig, sig)) {
    throw new AuthError("invalid signature");
  }

  await insertNonce(deps.db, {
    nonce,
    runnerId: runnerId || null,
    seenAt: nowMs,
    expiresAt: nowMs + TIMESTAMP_WINDOW_MS,
  });

  return { runnerId, authenticated: true };
}

async function authenticateRequest({ request, rawBody, runnerKey, deps, allowBearer = false }) {
  const h = request.headers;
  const sig = h.get("x-smd-signature") || h.get("x-signature");
  if (sig) {
    return verifyHmacAuth({ request, rawBody, runnerKey, deps });
  }

  if (allowBearer) {
    const authHeader = h.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token && equalHex(token, runnerKey)) {
        const runnerId = h.get("x-smd-runner-id") || h.get("x-runner-id") || null;
        return { runnerId, authenticated: true };
      }
    }
  }

  throw new AuthError("unauthorized");
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!agentFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });

  const url = new URL(request.url);
  const seg = url.pathname
    .replace(/^\/api\/connect\/agent\/runner\/?/, "")
    .replace(/^\/runner\/?/, "")
    .replace(/\/+$/, "");
  const parts = seg ? seg.split("/") : [];
  const method = request.method.toUpperCase();

  const deps = {
    db: env.CONNECT_DB,
    kv: env.MAIK_KV,
    secrets: makeSecrets(env),
    now: env.now || (() => Date.now()),
    env,
  };

  let rawBody = "";
  let body = {};
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    try {
      rawBody = await request.text();
      if (rawBody) body = JSON.parse(rawBody);
    } catch {}
  }

  try {
    const runnerKey = await resolveRunnerKey(deps, env);

    // POST /runner/jobs/lease
    if (method === "POST" && parts.length === 2 && parts[0] === "jobs" && parts[1] === "lease") {
      const auth = await authenticateRequest({ request, rawBody, runnerKey, deps, allowBearer: true });
      const runnerId = body.runnerId || auth.runnerId || request.headers.get("x-smd-runner-id") || null;
      if (!runnerId) throw new OnboardError("invalid", "runnerId required");

      const ttlMs = Math.min(Math.max(Number(body.leaseDurationMs || body.ttlMs) || 30000, 5000), 300000);
      const nowMs = Number(deps.now());

      const candidateJobs = await jobsInStates(deps.db, JOB_RECLAIMABLE);
      const eligible = [];

      for (const job of candidateJobs) {
        if (job.completed_at != null) continue;
        if (job.deadline_at && Number(job.deadline_at) <= nowMs) continue;

        if (job.lease_expires_at != null && Number(job.lease_expires_at) > nowMs) {
          continue; // Active lease held by another runner
        }

        if (job.lease_expires_at == null) {
          if (JOB_LEASABLE.indexOf(job.state) === -1) continue;
          eligible.push(job);
        } else {
          // Lapsed lease: reclaimable by any runner for states in JOB_RECLAIMABLE
          eligible.push(job);
        }
      }

      eligible.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

      for (const job of eligible) {
        try {
          const newExpiresAt = nowMs + ttlMs;
          const newAttempts = Number(job.attempts || 0) + 1;
          const leasedJob = await casJobLease(deps.db, job.tenant_id, job.id, job.revision, {
            leaseOwner: runnerId,
            leaseExpiresAt: newExpiresAt,
            attempts: newAttempts,
          });

          const session = await getSessionRow(deps.db, job.tenant_id, job.session_id);
          const deployment = await getDeployment(deps.db, job.tenant_id, job.deployment_id);

          return jsonResponse({
            ok: true,
            job: {
              id: leasedJob.id,
              tenantId: leasedJob.tenant_id,
              sessionId: leasedJob.session_id,
              deploymentId: leasedJob.deployment_id,
              state: leasedJob.state,
              revision: Number(leasedJob.revision),
              leaseOwner: leasedJob.lease_owner,
              leaseExpiresAt: Number(leasedJob.lease_expires_at),
              deadlineAt: Number(leasedJob.deadline_at),
              attempts: Number(leasedJob.attempts),
              stage: leasedJob.stage || null,
              stageCode: leasedJob.stage_code || null,
            },
            session: session ? {
              id: session.id,
              state: session.state,
              controlOwner: session.control_owner,
              runnerRef: session.runner_ref,
              expiresAt: Number(session.expires_at),
            } : null,
            deployment: deployment ? {
              id: deployment.id,
              hospitalId: deployment.hospital_id,
              name: deployment.name || null,
              origins: deploymentOrigins(deployment),
            } : null,
          });
        } catch (leaseErr) {
          if (leaseErr instanceof OnboardError && leaseErr.klass === "conflict") {
            continue; // Raced with another runner; try next eligible job
          }
          throw leaseErr;
        }
      }

      return jsonResponse({ ok: true, job: null });
    }

    // POST /runner/jobs/:id/lease/renew
    if (method === "POST" && parts.length === 4 && parts[0] === "jobs" && parts[2] === "lease" && parts[3] === "renew") {
      const auth = await authenticateRequest({ request, rawBody, runnerKey, deps, allowBearer: true });
      const jobId = parts[1];
      const runnerId = body.runnerId || auth.runnerId || request.headers.get("x-smd-runner-id") || null;
      if (!runnerId) throw new OnboardError("invalid", "runnerId required");

      const job = await getJobById(deps.db, jobId);
      if (!job) throw new OnboardError("not-found", "job not found");

      if (!job.lease_owner || String(job.lease_owner) !== String(runnerId)) {
        throw new OnboardError("forbidden", "runner does not hold lease");
      }
      if (job.completed_at != null) {
        throw new OnboardError("conflict", "job already completed");
      }

      const ttlMs = Math.min(Math.max(Number(body.leaseDurationMs || body.ttlMs) || 30000, 5000), 300000);
      const nowMs = Number(deps.now());
      const newExpiresAt = nowMs + ttlMs;

      const updatedJob = await casRenewJobLease(deps.db, job.tenant_id, job.id, job.revision, newExpiresAt);
      return jsonResponse({
        ok: true,
        leaseExpiresAt: newExpiresAt,
        revision: Number(updatedJob.revision),
      });
    }

    // POST /runner/jobs/:id/report
    if (method === "POST" && parts.length === 3 && parts[0] === "jobs" && parts[2] === "report") {
      // Replay-resistant HMAC authentication is strictly required on report callbacks
      const auth = await verifyHmacAuth({ request, rawBody, runnerKey, deps });
      const jobId = parts[1];
      const runnerId = body.runnerId || auth.runnerId || request.headers.get("x-smd-runner-id") || null;

      const job = await getJobById(deps.db, jobId);
      if (!job) throw new OnboardError("not-found", "job not found");

      if (job.lease_owner && runnerId && String(job.lease_owner) !== String(runnerId)) {
        throw new OnboardError("forbidden", "runner does not hold lease");
      }

      // Guard against duplicate reports on an already-completed job (no-op, never double-apply)
      if (job.completed_at != null) {
        return jsonResponse({
          ok: true,
          noop: true,
          completed: true,
          job: {
            id: job.id,
            state: job.state,
            stage: job.stage || null,
            stageCode: job.stage_code || null,
            completedAt: job.completed_at,
            candidateVersionId: job.candidate_version_id || null,
          },
        });
      }

      const stage = body.stage;
      const outcome = body.outcome;
      const VALID_STAGES = ["DISCOVERING", "COMPILING", "VALIDATING"];
      const VALID_OUTCOMES = ["progress", "success", "failure"];

      if (!VALID_STAGES.includes(stage) || !VALID_OUTCOMES.includes(outcome)) {
        throw new OnboardError("invalid", "invalid stage or outcome");
      }

      let targetState = job.state;
      if (outcome === "failure") {
        targetState = "FAILED";
      } else if (outcome === "progress") {
        if (stage === "DISCOVERING") {
          targetState = "DISCOVERING";
        } else if (stage === "COMPILING") {
          targetState = "COMPILING";
        } else if (stage === "VALIDATING") {
          targetState = "VALIDATING";
        }
      } else if (outcome === "success") {
        if (stage === "DISCOVERING") {
          targetState = "COMPILING";
        } else if (stage === "COMPILING") {
          targetState = "VALIDATING";
        } else if (stage === "VALIDATING") {
          targetState = "AWAITING_APPROVAL";
        }
      }

      if (job.state !== targetState) {
        assertTransition("job", job.state, targetState);
      }

      const isTerminal = targetState === "FAILED" || targetState === "AWAITING_APPROVAL" || targetState === "ACTIVE";
      const updateSet = {
        stage: stage.toLowerCase(),
      };
      if (job.state !== targetState) {
        updateSet.state = targetState;
      }
      if (outcome === "failure") {
        updateSet.stage_code = sanitizeErrorCode(body.errorCode);
      }
      if (body.candidateVersionId) {
        updateSet.candidate_version_id = String(body.candidateVersionId);
      }
      if (isTerminal) {
        updateSet.completed_at = nowIso();
      }

      // If a candidate manifest was supplied, record the immutable adapter version
      if (body.manifest && deps.db) {
        try {
          const m = body.manifest;
          const ver = await insertVersion(deps.db, {
            tenantId: job.tenant_id,
            deploymentId: job.deployment_id,
            manifestRef: "manifest:" + (m.contentHash || body.candidateVersionId || m.manifestId || "unknown"),
            schemaVersion: m.schemaVersion || 3,
            contentHash: m.contentHash || "sha256:0",
            capabilities: (m.operations || []).map((o) => o.type),
            parentVersionId: null,
            evidenceHash: body.evidenceHash || null,
          });
          if (ver && ver.id) {
            updateSet.candidate_version_id = ver.id;
          }
        } catch {}
      }

      const updatedJob = await casJob(deps.db, job.tenant_id, job.id, job.revision, updateSet);

      return jsonResponse({
        ok: true,
        job: {
          id: updatedJob.id,
          state: updatedJob.state,
          stage: updatedJob.stage || null,
          stageCode: updatedJob.stage_code || null,
          completedAt: updatedJob.completed_at || null,
          candidateVersionId: updatedJob.candidate_version_id || null,
          revision: Number(updatedJob.revision),
        },
      });
    }

    return jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (e) {
    return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });
  }
}
