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
import { RateLimited } from "../../../_connect/enterprise/ratelimit.js";
import { identify } from "../../../_usage.js";
import { ownerOK } from "../../../_adminauth.js";
import { makeSecrets } from "../../../_connect/secrets.js";
import { saveConnection, listConnections, deleteConnection } from "../../../_connect/onboard/store.js";
import { testConnection } from "../../../_connect/onboard/probe.js";
import { discoverCapabilities } from "../../../_connect/onboard/discover.js";
import { pullConnection } from "../../../_connect/onboard/pull.js";
import { parseCsvUpload, CSV_MAX_BYTES } from "../../../_connect/onboard/csv-upload.js";
import { createFeed, listFeeds, deleteFeed } from "../../../_connect/onboard/hl7-feed.js";
import { createFeed as createWebhookFeed, listFeeds as listWebhookFeeds, deleteFeed as deleteWebhookFeed } from "../../../_connect/onboard/webhook-feed.js";
import { listAll } from "../../../_connect/onboard/dashboard.js";
import { listMyTenants } from "../../../_connect/enterprise/members.js";
import { readTenantIntegrationHealth } from "../../../_connect/maik/integration-health.js";

// Re-export the surface flag gate under the Part-4 analytics test's name (same predicate: master smd_connect
// AND smd_connect_onboard). Integration merged Part-3 (onboardFlagOn) + Part-4 (flagOnboardOn) onto one router.
export { onboardFlagOn as flagOnboardOn } from "../../../_connect/onboard/flags.js";

const STATUS = (e) => e instanceof OnboardError ? (e.klass === "not-found" ? 404 : e.klass === "too-large" ? 413 : 400)
  : e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : e instanceof RateLimited ? 429 : 400;
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
  // Hard byte cap for the CSV upload: reject an oversized body UP FRONT (before buffering/parsing it).
  if (method === "POST" && seg === "csv") {
    const cl = Number(request.headers.get("content-length") || 0);
    if (cl > CSV_MAX_BYTES) return jsonResponse({ error: "too-large" }, { status: 413 });
  }
  let body = {}; if (method === "POST") { try { body = await request.json(); } catch {} }
  const tid = body.tenantId || url.searchParams.get("tenant");

  try {
    // Part 3 (Enterprise): the caller's OWN tenant memberships (server-derived actor id; the body is NOT read)
    // — this drives the UI's tenant picker so an admin selects their hospital instead of typing a tenant id.
    if (method === "GET" && seg === "tenants") return jsonResponse({ ok: true, tenants: await listMyTenants(deps, request, env) });
    // Part 3 (Enterprise): the unified connections view (FHIR connections + HL7 feeds) for the selected tenant.
    if (method === "GET" && seg === "all") return jsonResponse(Object.assign({ ok: true }, await listAll(deps, request, env, tid)));
    // Part 4 (Enterprise analytics): PHI-free per-connector integration health over the tenant's audit rows.
    if (method === "GET" && seg === "health") return jsonResponse({ ok: true, health: await readTenantIntegrationHealth(deps, request, env, tid) });
    if (method === "POST" && seg === "emr") return jsonResponse(await saveConnection(deps, request, env, tid, body));
    if (method === "GET" && seg === "list") return jsonResponse({ ok: true, connections: await listConnections(deps, request, env, tid) });
    // Auto-discovery: unauthenticated capability probe (FHIR version/software/SMART support) for wizard pre-fill.
    if (method === "POST" && seg === "discover") return jsonResponse(await discoverCapabilities(deps, request, env, tid, body));
    if (method === "POST" && parts[0] === "test" && parts[1]) return jsonResponse(await testConnection(deps, request, env, tid, parts[1]));
    if (method === "POST" && parts[0] === "pull" && parts[1]) return jsonResponse({ ok: true, bundle: await pullConnection(deps, request, env, tid, parts[1], body.patientId) });
    if (method === "POST" && seg === "csv") return jsonResponse(await parseCsvUpload(deps, request, env, tid, body));
    // Increment 3: HL7 v2 self-service feeds (create/list/revoke). The created feed is a connect_feed row the
    // Track-B ingest spine reads; the ingestUrl returned is the REAL /api/connect/ingress/hl7 endpoint.
    if (method === "POST" && seg === "hl7-feed") return jsonResponse(await createFeed(deps, request, env, tid, body));
    if (method === "GET" && seg === "hl7-feed/list") return jsonResponse({ ok: true, feeds: await listFeeds(deps, request, env, tid) });
    if (method === "DELETE" && parts[0] === "hl7-feed" && parts[1]) return jsonResponse(await deleteFeed(deps, request, env, tid, parts[1]));
    // Generic push WEBHOOK (FHIR-push) self-service feeds (create/list/revoke). Same shape as HL7; the created
    // feed is a connect_feed row the Track-B ingest spine reads, and the ingestUrl returned is the REAL
    // /api/connect/ingress/fhir endpoint (routes pushed FHIR through normalizeFhir -> SCCM).
    if (method === "POST" && seg === "webhook-feed") return jsonResponse(await createWebhookFeed(deps, request, env, tid, body));
    if (method === "GET" && seg === "webhook-feed/list") return jsonResponse({ ok: true, feeds: await listWebhookFeeds(deps, request, env, tid) });
    if (method === "DELETE" && parts[0] === "webhook-feed" && parts[1]) return jsonResponse(await deleteWebhookFeed(deps, request, env, tid, parts[1]));
    if (method === "DELETE" && parts.length === 1 && parts[0]) return jsonResponse(await deleteConnection(deps, request, env, tid, parts[0]));
    return jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (e) {
    return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });     // sanitized: only { error: code }
  }
}
