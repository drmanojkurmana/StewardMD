// functions/api/connect/enterprise/[[path]].js — Track D Enterprise admin plane (spec §3).
// NEW, more-specific route: Cloudflare Pages routes /api/connect/enterprise/* here, ahead of the Phase-0
// catch-all functions/api/connect/[[path]].js (which is UNCHANGED). Flag-gated (smd_connect); server-
// derived identity; no-store. All authorization is fail-closed RBAC inside the enterprise modules.
import { flagOn, jsonResponse } from "../../../_connect/testkit.js";
import { AuthError, PermissionError, SandboxViolation } from "../../../_connect/permission.js";
import { identify } from "../../../_usage.js";
import { ownerOK } from "../../../_adminauth.js";
import { listMembers, invite, setRole, removeMember } from "../../../_connect/enterprise/members.js";
import { createTenant, updateTenant, suspendTenant } from "../../../_connect/enterprise/org.js";
import { setLimit } from "../../../_connect/enterprise/ratelimit.js";
import { readAudit, metrics } from "../../../_connect/enterprise/observability.js";

const STATUS = (e) => (e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : 400);
const CODE = (e) => (e && e.constructor && e.constructor.name ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error" : "error");

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/connect\/enterprise\/?/, "").replace(/\/+$/, "");
  const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, ownerOk: ownerOK };
  let body = {}; if (request.method === "POST") { try { body = await request.json(); } catch {} }
  const tid = body.tenantId || url.searchParams.get("tenant");

  try {
    if (request.method === "GET" && seg === "members") return jsonResponse({ ok: true, members: await listMembers(deps, request, env, tid) });
    if (request.method === "POST" && seg === "members/invite") return jsonResponse(await invite(deps, request, env, tid, body));
    if (request.method === "POST" && seg === "members/role") return jsonResponse(await setRole(deps, request, env, tid, body));
    if (request.method === "POST" && seg === "members/remove") return jsonResponse(await removeMember(deps, request, env, tid, body));

    if (request.method === "POST" && seg === "tenants") return jsonResponse(await createTenant(deps, request, env, body));
    if (request.method === "POST" && seg === "tenants/update") return jsonResponse(await updateTenant(deps, request, env, tid, body));
    if (request.method === "POST" && seg === "tenants/suspend") return jsonResponse(await suspendTenant(deps, request, env, tid));

    if (request.method === "POST" && seg === "ratelimit") return jsonResponse(await setLimit(deps, request, env, tid, body));

    if (request.method === "GET" && seg === "audit") return jsonResponse({ ok: true, events: await readAudit(deps, request, env, tid, { action: url.searchParams.get("action"), outcome: url.searchParams.get("outcome"), limit: url.searchParams.get("limit") }) });
    if (request.method === "GET" && seg === "observability") return jsonResponse({ ok: true, metrics: await metrics(deps, request, env, tid) });

    return jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (e) {
    return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });     // sanitized: only {error: code}
  }
}
