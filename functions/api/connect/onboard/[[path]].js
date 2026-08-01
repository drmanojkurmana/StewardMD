// functions/api/connect/onboard/[[path]].js — Connect onboarding/ops READ surface (Part 4).
// NEW, more-specific route: Cloudflare Pages routes /api/connect/onboard/* here, ahead of the Phase-0
// catch-all functions/api/connect/[[path]].js (UNCHANGED). Read-only, PHI-free, tenant-scoped.
//
// GET /api/connect/onboard/health?tenant=<id> -> Enterprise Integration-Health analytics: the tenant's
// recent PHI-free audit rows folded into per-connector success/failure rates, per-action outcome counts,
// an overall roll-up, recent failures, and warning signals. Flag-gated (smd_connect AND smd_connect_onboard);
// server-derived identity + fail-closed RBAC (connector:read); tenant taken from the resolved membership.
import { flagOn, jsonResponse } from "../../../_connect/testkit.js";
import { AuthError, PermissionError, SandboxViolation } from "../../../_connect/permission.js";
import { identify } from "../../../_usage.js";
import { readTenantIntegrationHealth } from "../../../_connect/maik/integration-health.js";

const STATUS = (e) => (e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : 400);
const CODE = (e) => (e && e.constructor && e.constructor.name ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error" : "error");

// smd_connect (master kill-switch) AND smd_connect_onboard (this surface). Flag OFF => 404 (no existence leak).
export function flagOnboardOn(env) { return flagOn(env) && String(env && env.CONNECT_ONBOARD_FLAG) === "1"; }

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOnboardOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/connect\/onboard\/?/, "").replace(/\/+$/, "");
  const deps = { db: env.CONNECT_DB, identifyFn: identify };
  const tid = url.searchParams.get("tenant");

  try {
    if (request.method === "GET" && seg === "health") {
      return jsonResponse({ ok: true, health: await readTenantIntegrationHealth(deps, request, env, tid) });
    }
    return jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (e) {
    return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });     // sanitized: only {error: code}
  }
}
