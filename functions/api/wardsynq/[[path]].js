/* functions/api/wardsynq/[[path]].js — the HTTP door of the WardSynQ Clinical Record Service.
 *
 * Flag-gated (WARDSYNQ_RECORD=1; default OFF, 404 so existence is not leaked). Identity is
 * server-derived from the verified token; tenancy is decided from connect_membership; the RBAC
 * matrix and the actor ceilings are the existing ones. Every response is no-store.
 *
 *   GET  /api/wardsynq/health
 *   GET  /api/wardsynq/:tenant                                      descriptor: mode, role, actor
 *   GET  /api/wardsynq/:tenant/changes?since=<seq>&limit=<n>        what changed, for the other client
 *   GET  /api/wardsynq/:tenant/list/:type?limit=<n>                 a roster: latest of every record of one type
 *   GET  /api/wardsynq/:tenant/patient/:patientId                   the whole chart
 *   GET  /api/wardsynq/:tenant/patient/:patientId/:type             latest of one type
 *   GET  /api/wardsynq/:tenant/record/:type/:id                     latest version (404 if none)
 *   GET  /api/wardsynq/:tenant/record/:type/:id/history             every version
 *   POST /api/wardsynq/:tenant/record                               {entity, expectedVersion?, activePatientId?, origin?}
 *                                                                   header Idempotency-Key (or body.idempotencyKey)
 *                                                                   origin {kind:"ai", id} => written by an AI actor on
 *                                                                   the session's behalf, never as the human
 *
 * Identity: a Firebase / Cloudflare Access session, or (with QUEUE_STAFF_ENABLED=1) a StewardMD staff
 * session via X-Staff-Token. Role: the OPD organisation's membership when the tenant has one, else
 * Connect membership. Mapping to a governed actor: functions/_wardsynq/actor.js.
 *   POST /api/wardsynq/:tenant/ingest/sccm                          an SCCM bundle from any connector
 *
 * Errors are codes, never stacks: 401 unauthenticated, 403 not a member / role / governance /
 * authority, 404 unknown, 409 version conflict (with the current record so the client can
 * reconcile), 400 malformed.
 *
 * The only Cloudflare-specific lines are the two that pick the repository and the D1 binding. A
 * hospital-local deployment swaps those and keeps the rest.
 */
import { jsonResponse } from "../../_connect/testkit.js";
import { AuthError, PermissionError } from "../../_connect/permission.js";
import { VersionConflictError } from "../../_wardsynq/repository.js";
import { RecordService, AuthorityError, RecordRequestError } from "../../_wardsynq/service.js";
import { resolveClinicalActor } from "../../_wardsynq/actor.js";
import { actorDeps, recordDeps } from "../../_wardsynq/deps.js";
import { GovernanceError } from "../../../wardsynq/wardsynq-actors.js";
import { IntegrationHub } from "../../../wardsynq/wardsynq-interop.js";
import { sccmAdapter } from "../../../wardsynq/adapters/wardsynq-sccm-adapter.js";

export function recordFlagOn(env) { return String(env && env.WARDSYNQ_RECORD) === "1"; }

function status(e) {
  if (e instanceof AuthError) return 401;
  if (e instanceof PermissionError) return 403;
  if (e instanceof GovernanceError) return 403;
  if (e instanceof AuthorityError) return 403;
  if (e instanceof VersionConflictError) return 409;
  if (e instanceof RecordRequestError) return 400;
  if (e instanceof TypeError) return 400;          // the model factories throw TypeError on a bad entity
  return 500;
}
function errorBody(e) {
  if (e instanceof GovernanceError) return { error: "governance", code: e.code, reasons: e.reasons };
  if (e instanceof AuthorityError) return { error: "authority", code: e.code, detail: e.detail };
  if (e instanceof VersionConflictError) return { error: "version_conflict", code: e.code, detail: e.detail };
  if (e instanceof RecordRequestError) return { error: "bad_request", code: e.code, message: e.message };
  if (e instanceof TypeError) return { error: "bad_request", code: "INVALID_ENTITY", message: e.message };
  if (e instanceof AuthError) return { error: "auth" };
  if (e instanceof PermissionError) return { error: "permission" };
  return { error: "error" };
}

/**
 * Builds the per-request service, or throws AuthError / PermissionError. The whole authorization
 * path is functions/_wardsynq/actor.js; the production I/O seams are functions/_wardsynq/deps.js,
 * and `deps` overrides any of them so the route is testable without Cloudflare or Firestore:
 *   { db, identifyFn, claimsFn, staffSession, orgForTenant, authorizeOrg, repository, pseudonym }
 */
export async function openService(request, env, tenantId, need, deps) {
  deps = deps || {};
  const a = actorDeps(env, deps);
  if (!a.db) throw new PermissionError("record service is not provisioned");
  const resolved = await resolveClinicalActor(request, env, tenantId, need, a);
  const r = recordDeps(env, resolved.tenant.id, deps);
  return new RecordService({ repository: r.repository, pseudonym: r.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
}

export async function handle(request, env, deps) {
  if (!recordFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/wardsynq\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const method = request.method;

  if (parts[0] === "health") return jsonResponse({ ok: true, service: "wardsynq-record", repository: "d1" });
  const tenantId = parts[0];
  if (!tenantId) return jsonResponse({ error: "not_found" }, { status: 404 });
  const rest = parts.slice(1);

  let body = {};
  if (method === "POST") { try { body = await request.json(); } catch { body = {}; } }

  try {
    if (method === "GET") {
      const svc = await openService(request, env, tenantId, "record:read", deps);

      if (rest.length === 0) return jsonResponse({ ok: true, ...svc.descriptor() });

      if (rest[0] === "changes" && rest.length === 1) {
        const page = await svc.changes(url.searchParams.get("since"), url.searchParams.get("limit"));
        return jsonResponse({ ok: true, ...page });
      }
      if (rest[0] === "list" && rest.length === 2) {
        return jsonResponse({ ok: true, resourceType: rest[1], records: await svc.list(rest[1], url.searchParams.get("limit")) });
      }
      if (rest[0] === "patient" && rest.length === 2) {
        return jsonResponse({ ok: true, patientId: rest[1], chart: await svc.chart(rest[1]) });
      }
      if (rest[0] === "patient" && rest.length === 3) {
        return jsonResponse({ ok: true, patientId: rest[1], resourceType: rest[2], records: await svc.byPatient(rest[2], rest[1]) });
      }
      if (rest[0] === "record" && rest.length === 3) {
        const rec = await svc.get(rest[1], rest[2]);
        if (!rec) return jsonResponse({ error: "not_found" }, { status: 404 });
        return jsonResponse({ ok: true, record: rec });
      }
      if (rest[0] === "record" && rest.length === 4 && rest[3] === "history") {
        return jsonResponse({ ok: true, versions: await svc.history(rest[1], rest[2]) });
      }
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }

    if (method === "POST") {
      const svc = await openService(request, env, tenantId, "record:write", deps);

      if (rest[0] === "record" && rest.length === 1) {
        const idempotencyKey = request.headers.get("Idempotency-Key") || body.idempotencyKey || null;
        const out = await svc.put(body.entity, { expectedVersion: body.expectedVersion, idempotencyKey, activePatientId: body.activePatientId || null, origin: body.origin || null });
        return jsonResponse({ ok: true, replayed: out.replayed, record: out.record, actor: out.actor || null }, { status: out.replayed ? 200 : 201 });
      }
      if (rest[0] === "ingest" && rest[1] === "sccm" && rest.length === 2) {
        const adapter = sccmAdapter();
        const eventId = adapter.sourceEventId(body);
        const governed = svc.governedForIngest({ idempotencyKey: eventId ? `ingest:${adapter.system}:${eventId}` : null });
        if (await governed.alreadyIngested()) {
          return jsonResponse({ ok: true, system: adapter.system, written: 0, refused: 0, duplicate: true, reason: "already ingested", issues: [] });
        }
        const hub = new IntegrationHub({ governed });
        hub.register(adapter);
        const result = await hub.ingest(body);
        return jsonResponse({ ok: result.ok, system: result.system || null, written: (result.entities || []).length, refused: result.refused || 0, duplicate: !!result.duplicate, reason: result.reason || null, issues: result.issues || [] }, { status: result.ok ? 200 : 422 });
      }
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }

    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  } catch (e) {
    return jsonResponse(errorBody(e), { status: status(e) });
  }
}

export async function onRequest(context) {
  return handle(context.request, context.env);
}
