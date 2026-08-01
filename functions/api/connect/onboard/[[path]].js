// functions/api/connect/onboard/[[path]].js — Self-Service EMR Onboarding HTTP surface (Part 3, Increment 1).
// NEW, more-specific route: Cloudflare Pages routes /api/connect/onboard/* here, ahead of the Phase-0
// catch-all functions/api/connect/[[path]].js (unchanged). Flag-gated (smd_connect_onboard, default OFF =>
// 404, no existence leak); server-derived identity (identify) + fail-closed RBAC inside the onboard modules;
// no-store; sanitized errors (only { error: <class> } — never a stack/URL/token). Owner/admin gated via the
// connector:* RBAC actions (owner & admin hold them); pull additionally denies auditors (PHI).
import { jsonResponse } from "../../../_connect/testkit.js";
import { onboardFlagOn } from "../../../_connect/onboard/flags.js";
import { AuthError, PermissionError, SandboxViolation } from "../../../_connect/permission.js";
import { OnboardError } from "../../../_connect/onboard/errors.js";
import { identify } from "../../../_usage.js";
import { ownerOK } from "../../../_adminauth.js";
import { makeSecrets } from "../../../_connect/secrets.js";
import { saveConnection, listConnections, deleteConnection } from "../../../_connect/onboard/store.js";
import { testConnection } from "../../../_connect/onboard/probe.js";
import { pullConnection } from "../../../_connect/onboard/pull.js";

const STATUS = (e) => e instanceof OnboardError ? (e.klass === "not-found" ? 404 : 400)
  : e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : 400;
const CODE = (e) => e instanceof OnboardError ? e.klass
  : (e && e.constructor && e.constructor.name ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error" : "error");

export async function onRequest(context) {
  const { request, env } = context;
  if (!onboardFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/connect\/onboard\/?/, "").replace(/\/+$/, "");
  const parts = seg ? seg.split("/") : [];
  const method = request.method;

  const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, ownerOk: ownerOK, secrets: makeSecrets(env), fetch, now: () => Date.now() };
  let body = {}; if (method === "POST") { try { body = await request.json(); } catch {} }
  const tid = body.tenantId || url.searchParams.get("tenant");

  try {
    if (method === "POST" && seg === "emr") return jsonResponse(await saveConnection(deps, request, env, tid, body));
    if (method === "GET" && seg === "list") return jsonResponse({ ok: true, connections: await listConnections(deps, request, env, tid) });
    if (method === "POST" && parts[0] === "test" && parts[1]) return jsonResponse(await testConnection(deps, request, env, tid, parts[1]));
    if (method === "POST" && parts[0] === "pull" && parts[1]) return jsonResponse({ ok: true, bundle: await pullConnection(deps, request, env, tid, parts[1], body.patientId) });
    if (method === "DELETE" && parts.length === 1 && parts[0]) return jsonResponse(await deleteConnection(deps, request, env, tid, parts[0]));
    return jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (e) {
    return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });     // sanitized: only { error: code }
  }
}
