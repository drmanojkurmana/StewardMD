// functions/api/connect/agent/[[path]].js -- Connect Hospital agent-broker HTTP surface.
// Cloudflare Pages routes /api/connect/agent/* here, ahead of the Phase-0 catch-all
// functions/api/connect/[[path]].js. Flag-gated (smd_connect_agent, default OFF => 404,
// no existence leak); server-derived identity (identify) + fail-closed RBAC inside the agent
// modules; no-store; sanitized errors (only { error: <class> } -- never a stack/URL/token).
import { jsonResponse } from "../../../_connect/testkit.js";
import { agentFlagOn, browserSessionFlagOn } from "../../../_connect/agent/flags.js";
import { AuthError, PermissionError, SandboxViolation } from "../../../_connect/permission.js";
import { OnboardError } from "../../../_connect/onboard/errors.js";
import { identify } from "../../../_usage.js";
import { ownerOK } from "../../../_adminauth.js";
import { makeSecrets } from "../../../_connect/secrets.js";
import { resolveActor, resolveTenant } from "../../../_connect/identity.js";
import { listMyTenants } from "../../../_connect/enterprise/members.js";
import {
  requireAgent,
  assertOwnership,
  assertTransition,
  canTransition,
  canAgent,
  SESSION_LIVE,
} from "../../../_connect/agent/state.js";
import {
  assertConsent,
  revokeConsent,
} from "../../../_connect/agent/consent.js";
import {
  issueViewerToken,
  redeemViewerToken,
} from "../../../_connect/agent/viewer-token.js";
import {
  getDeployment,
  findDeploymentByFingerprint,
  deploymentFingerprint,
  deploymentView,
  getVersion,
  insertSession,
  getSessionRow,
  findLiveSession,
  casSession,
  sessionView,
  insertJob,
  findJobForSession,
  casJob,
  revokeSessionViewerTokens,
  newId,
  nowIso,
} from "../../../_connect/agent/store.js";

export { agentFlagOn, browserSessionFlagOn } from "../../../_connect/agent/flags.js";

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
        : e instanceof SandboxViolation
          ? 403
          : 400;

const CODE = (e) =>
  e instanceof OnboardError
    ? e.klass
    : e && e.constructor && e.constructor.name
      ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error"
      : "error";

function hasCredentials(body) {
  if (!body || typeof body !== "object") return false;
  const keys = ["password", "token", "credentials", "secret", "emrPassword", "clientSecret", "privateKey", "auth"];
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null) return true;
  }
  return false;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!agentFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/connect\/agent\/?/, "").replace(/\/+$/, "");
  const parts = seg ? seg.split("/") : [];
  const method = request.method;

  const deps = {
    db: env.CONNECT_DB,
    kv: env.MAIK_KV,
    identifyFn: env.identifyFn || identify,
    ownerOk: env.ownerOk || ownerOK,
    secrets: makeSecrets(env),
    fetch,
    now: env.now || (() => Date.now()),
    env,
  };

  let body = {};
  if (method === "POST" || method === "DELETE") {
    try { body = await request.json(); } catch {}
  }
  const tid = body.tenantId || url.searchParams.get("tenant");

  try {
    // POST /sessions -- validate actor/tenant via identify()+RBAC, consent, create job/session
    if (method === "POST" && seg === "sessions") {
      if (!browserSessionFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (hasCredentials(body)) throw new OnboardError("invalid", "credentials must not be supplied");
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const deploymentId = body.deploymentId;
      if (!deploymentId) throw new OnboardError("invalid", "deploymentId required");
      const deployment = await getDeployment(deps.db, tid, deploymentId);
      const consent = await assertConsent(deps, env, {
        tenantId: tid,
        actorId: actor.id,
        deploymentId: deployment.id,
        requiredScope: ["emr:session"],
        now: deps.now(),
      });
      const nowMs = Number(deps.now());
      // Reconnect/backgrounding resumption
      let session = await findLiveSession(deps.db, tid, actor.id, deployment.id, SESSION_LIVE, nowMs);
      let job = session ? await findJobForSession(deps.db, tid, session.id) : null;
      if (!session) {
        const sessionId = newId("ses_");
        const sessionTtl = Number(body.ttlMs) > 0 ? Number(body.ttlMs) : 3600000;
        const sessionExpiry = Math.min(nowMs + sessionTtl, Number(consent.expires_at));
        session = await insertSession(deps.db, {
          id: sessionId,
          tenant_id: tid,
          deployment_id: deployment.id,
          actor_id: actor.id,
          runner_ref: newId("run_"),
          consent_id: consent.id,
          state: "CREATED",
          control_owner: "clinician",
          expires_at: sessionExpiry,
        });
        const jobId = newId("job_");
        job = await insertJob(deps.db, {
          id: jobId,
          tenant_id: tid,
          session_id: sessionId,
          deployment_id: deployment.id,
          actor_id: actor.id,
          state: "CREATED",
          idempotency_key: body.idempotencyKey || null,
          deadline_at: sessionExpiry,
          max_attempts: Number(body.maxAttempts) || 3,
        });
      }
      return jsonResponse(Object.assign({ ok: true }, sessionView(session, job)));
    }

    // POST /sessions/:id/viewer-token -- short-lived, actor-bound, single-use viewer authorization
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "viewer-token") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      const nowMs = Number(deps.now());
      if (SESSION_LIVE.indexOf(session.state) === -1 || nowMs >= Number(session.expires_at)) {
        throw new OnboardError("expired", "session expired");
      }
      const vt = await issueViewerToken(deps, env, {
        session,
        actorId: actor.id,
        ttlMs: body.ttlMs,
        now: nowMs,
      });
      return jsonResponse(Object.assign({ ok: true }, vt));
    }

    // POST /sessions/:id/viewer-token/redeem -- redeem viewer authorization (single-use, actor-bound)
    if (method === "POST" && parts.length === 4 && parts[0] === "sessions" && parts[2] === "viewer-token" && parts[3] === "redeem") {
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const token = body.token || request.headers.get("x-smd-viewer-token");
      const redeemed = await redeemViewerToken(deps, env, token, { actorId: actor.id, now: deps.now() });
      return jsonResponse(Object.assign({ ok: true }, redeemed));
    }

    // GET /sessions/:id -- sanitized state/progress only, never raw internals
    if (method === "GET" && parts.length === 2 && parts[0] === "sessions") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "read");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      const job = await findJobForSession(deps.db, tid, sessionId);
      return jsonResponse(Object.assign({ ok: true }, sessionView(session, job)));
    }

    // POST /sessions/:id/handoff -- idempotent handoff to agent
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "handoff") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      let job = await findJobForSession(deps.db, tid, sessionId);
      const idemKey = body.idempotencyKey || request.headers.get("Idempotency-Key") || null;

      // Idempotency check
      if (idemKey && job && job.idempotency_key === idemKey) {
        return jsonResponse(Object.assign({ ok: true, idempotent: true }, sessionView(session, job)));
      }
      if (session.control_owner === "agent" && (session.state === "AUTHENTICATED" || (job && job.state === "DISCOVERING"))) {
        return jsonResponse(Object.assign({ ok: true, idempotent: true }, sessionView(session, job)));
      }

      await assertConsent(deps, env, {
        tenantId: tid,
        actorId: actor.id,
        deploymentId: session.deployment_id,
        requiredScope: ["emr:session", "emr:discover"],
        now: deps.now(),
      });

      let currentSession = session;
      if (currentSession.state === "CREATED") {
        assertTransition("session", "CREATED", "AWAITING_LOGIN");
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { state: "AWAITING_LOGIN" });
      }
      if (currentSession.state === "AWAITING_LOGIN") {
        assertTransition("session", "AWAITING_LOGIN", "AUTHENTICATED");
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { state: "AUTHENTICATED", control_owner: "agent" });
      } else if (currentSession.state === "AUTHENTICATED" && currentSession.control_owner !== "agent") {
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { control_owner: "agent" });
      }

      let currentJob = job;
      if (currentJob) {
        if (currentJob.state === "CREATED") {
          assertTransition("job", "CREATED", "AWAITING_LOGIN");
          currentJob = await casJob(deps.db, tid, currentJob.id, currentJob.revision, { state: "AWAITING_LOGIN" });
        }
        if (currentJob.state === "AWAITING_LOGIN") {
          assertTransition("job", "AWAITING_LOGIN", "AUTHENTICATED");
          currentJob = await casJob(deps.db, tid, currentJob.id, currentJob.revision, { state: "AUTHENTICATED" });
        }
        if (currentJob.state === "AUTHENTICATED") {
          assertTransition("job", "AUTHENTICATED", "DISCOVERING");
          const jobSet = { state: "DISCOVERING", stage: "discovering" };
          if (idemKey && !currentJob.idempotency_key) jobSet.idempotency_key = idemKey;
          currentJob = await casJob(deps.db, tid, currentJob.id, currentJob.revision, jobSet);
        }
      }

      return jsonResponse(Object.assign({ ok: true }, sessionView(currentSession, currentJob)));
    }

    // POST /sessions/:id/pause -- explicit ownership transfer to clinician
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "pause") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      if (SESSION_LIVE.indexOf(session.state) === -1) {
        throw new OnboardError("conflict", "session is not active");
      }
      let currentSession = session;
      if (currentSession.control_owner !== "clinician") {
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { control_owner: "clinician" });
      }
      const job = await findJobForSession(deps.db, tid, sessionId);
      return jsonResponse(Object.assign({ ok: true }, sessionView(currentSession, job)));
    }

    // POST /sessions/:id/resume -- explicit ownership transfer to agent
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "resume") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      if (SESSION_LIVE.indexOf(session.state) === -1) {
        throw new OnboardError("conflict", "session is not active");
      }
      let currentSession = session;
      if (currentSession.control_owner !== "agent") {
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { control_owner: "agent" });
      }
      const job = await findJobForSession(deps.db, tid, sessionId);
      return jsonResponse(Object.assign({ ok: true }, sessionView(currentSession, job)));
    }

    // DELETE /sessions/:id -- cancel/revoke session and schedule cleanup
    if (method === "DELETE" && parts.length === 2 && parts[0] === "sessions") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      assertTransition("session", session.state, "CANCELLED");
      const updatedSession = await casSession(deps.db, tid, session.id, session.revision, {
        state: "CANCELLED",
        closed_at: nowIso(),
        cleanup_after: nowIso(),
      });
      const job = await findJobForSession(deps.db, tid, sessionId);
      let updatedJob = job;
      if (job && canTransition("job", job.state, "CANCELLED")) {
        assertTransition("job", job.state, "CANCELLED");
        updatedJob = await casJob(deps.db, tid, job.id, job.revision, {
          state: "CANCELLED",
          completed_at: nowIso(),
        });
      }
      const nowMs = Number(deps.now());
      await revokeSessionViewerTokens(deps.db, session.id, nowMs);
      if (body.revokeConsent && session.consent_id) {
        try { await revokeConsent(deps, env, { tenantId: tid, consentId: session.consent_id, now: nowMs }); } catch {}
      }
      return jsonResponse(Object.assign({ ok: true, cancelled: true }, sessionView(updatedSession, updatedJob)));
    }

    // POST /hospitals/resolve -- resolve deployment by metadata without leaking membership
    if (method === "POST" && seg === "hospitals/resolve") {
      const actor = await resolveActor(deps.identifyFn, request, env);
      const targetTenantId = body.tenantId || null;
      const origins = Array.isArray(body.origins) ? body.origins : null;
      const fingerprint = body.fingerprint || (origins ? await deploymentFingerprint(origins) : null);
      const deploymentId = body.deploymentId || null;
      const hospitalId = body.hospitalId || null;

      if (targetTenantId) {
        let isAllowed = false;
        try {
          const { role } = await resolveTenant(deps.db, actor, targetTenantId, env);
          isAllowed = canAgent(role, "read");
        } catch {
          isAllowed = false;
        }
        if (!isAllowed) {
          throw new OnboardError("not-found", "hospital not found");
        }
        let dep = null;
        if (deploymentId) {
          dep = (await deps.db.prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND id=?").bind(targetTenantId, deploymentId).first()) || null;
        } else if (fingerprint) {
          dep = await findDeploymentByFingerprint(deps.db, targetTenantId, fingerprint);
        } else if (hospitalId) {
          dep = (await deps.db.prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND hospital_id=?").bind(targetTenantId, hospitalId).first()) || null;
        }
        if (!dep) throw new OnboardError("not-found", "hospital not found");
        const activeVer = dep.active_version_id ? await getVersion(deps.db, targetTenantId, dep.active_version_id) : null;
        return jsonResponse(Object.assign({ ok: true }, deploymentView(dep, activeVer)));
      }

      // No tenant specified: search caller's own accessible tenants without cross-tenant leak
      const myTenants = await listMyTenants(deps, request, env);
      let foundDep = null;
      let foundTenantId = null;
      for (const t of myTenants) {
        if (!canAgent(t.role, "read")) continue;
        let dep = null;
        if (deploymentId) {
          dep = (await deps.db.prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND id=?").bind(t.tenantId, deploymentId).first()) || null;
        } else if (fingerprint) {
          dep = await findDeploymentByFingerprint(deps.db, t.tenantId, fingerprint);
        } else if (hospitalId) {
          dep = (await deps.db.prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND hospital_id=?").bind(t.tenantId, hospitalId).first()) || null;
        }
        if (dep) {
          foundDep = dep;
          foundTenantId = t.tenantId;
          break;
        }
      }
      if (!foundDep) throw new OnboardError("not-found", "hospital not found");
      const activeVer = foundDep.active_version_id ? await getVersion(deps.db, foundTenantId, foundDep.active_version_id) : null;
      return jsonResponse(Object.assign({ ok: true }, deploymentView(foundDep, activeVer)));
    }

    return jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (e) {
    return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });
  }
}
