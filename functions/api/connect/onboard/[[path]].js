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
import { saveConnection, listConnections, deleteConnection, getRow } from "../../../_connect/onboard/store.js";
import { restFlagOn } from "../../../_connect/connectors/rest-json/flags.js";
import { dicomFlagOn } from "../../../_connect/connectors/dicomweb/flags.js";
import { graphqlFlagOn } from "../../../_connect/connectors/graphql/flags.js";
import { sqlFlagOn } from "../../../_connect/connectors/sql/flags.js";
import { testConnection } from "../../../_connect/onboard/probe.js";
import { validateConnection } from "../../../_connect/onboard/validate-engine.js";
import { discoverCapabilities } from "../../../_connect/onboard/discover.js";
import { pullConnection } from "../../../_connect/onboard/pull.js";
import { setSyncConfig, runDueSyncs, syncNow } from "../../../_connect/onboard/sync.js";
import { parseCsvUpload, CSV_MAX_BYTES } from "../../../_connect/onboard/csv-upload.js";
import { aiMapFlagOn } from "../../../_connect/onboard/ai-map-flags.js";
import { suggestMapping } from "../../../_connect/onboard/ai-map.js";
import { createFeed, listFeeds, deleteFeed } from "../../../_connect/onboard/hl7-feed.js";
import { createFeed as createWebhookFeed, listFeeds as listWebhookFeeds, deleteFeed as deleteWebhookFeed } from "../../../_connect/onboard/webhook-feed.js";
import { listAll } from "../../../_connect/onboard/dashboard.js";
import { listMyTenants, listMembers, setRole, removeMember } from "../../../_connect/enterprise/members.js";
import { adminFlagOn } from "../../../_connect/onboard/admin-flags.js";
import { readTenantIntegrationHealth } from "../../../_connect/maik/integration-health.js";
import { readTenantActivity } from "../../../_connect/onboard/activity.js";
import { listConnectorCatalog } from "../../../_connect/onboard/registry-catalog.js";
import { consentFlagOn } from "../../../_connect/onboard/consent-flags.js";
import { readTenantConsents, revokeTenantConsent } from "../../../_connect/onboard/consents.js";

// Re-export the surface flag gate under the Part-4 analytics test's name (same predicate: master smd_connect
// AND smd_connect_onboard). Integration merged Part-3 (onboardFlagOn) + Part-4 (flagOnboardOn) onto one router.
export { onboardFlagOn as flagOnboardOn } from "../../../_connect/onboard/flags.js";

const STATUS = (e) => e instanceof OnboardError ? (e.klass === "not-found" ? 404 : e.klass === "too-large" ? 413 : 400)
  : e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : e instanceof RateLimited ? 429 : 400;
const CODE = (e) => e instanceof OnboardError ? e.klass
  : (e && e.constructor && e.constructor.name ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error" : "error");

// Per-track flag gate for the generic REST/JSON connector (mirrors Track A's fhirFlagOn idiom in the /context
// router): rest-json save/test/pull additionally require smd_connect_rest, else 404 (no existence leak).
// save knows the type from the request body (client-supplied); test/pull don't carry a type, so peek at the
// stored row's kind — a lookup failure (missing row / no db) is NOT this gate's concern, so it just falls
// through to the normal RBAC-gated call, which raises its own (identical) not-found/401.
async function restGateBlocks(deps, tid, connectionId, env) {
  if (restFlagOn(env)) return false;
  try { const { row } = await getRow(deps.db, tid, connectionId); return row.kind === "rest-json"; }
  catch { return false; }
}

// Same idiom for the DICOMweb per-track gate (smd_connect_dicom).
async function dicomGateBlocks(deps, tid, connectionId, env) {
  if (dicomFlagOn(env)) return false;
  try { const { row } = await getRow(deps.db, tid, connectionId); return row.kind === "dicomweb"; }
  catch { return false; }
}

// Same idiom for the generic GraphQL per-track gate (smd_connect_graphql).
async function graphqlGateBlocks(deps, tid, connectionId, env) {
  if (graphqlFlagOn(env)) return false;
  try { const { row } = await getRow(deps.db, tid, connectionId); return row.kind === "graphql"; }
  catch { return false; }
}

// Same idiom for the generic SQL/DB per-track gate (smd_connect_sql).
async function sqlGateBlocks(deps, tid, connectionId, env) {
  if (sqlFlagOn(env)) return false;
  try { const { row } = await getRow(deps.db, tid, connectionId); return row.kind === "sql"; }
  catch { return false; }
}

// Consent Dashboard per-track gate (smd_connect_consent, default OFF): 404 with no existence leak, the SAME
// idiom as restGateBlocks/dicomGateBlocks/aiMapFlagOn -- but flat (not per-connection), since /consents and
// /consents/:ref/revoke are not scoped to one connector row.
function consentGateBlocks(env) { return !consentFlagOn(env); }

export async function onRequest(context) {
  const { request, env } = context;
  if (!onboardFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/connect\/onboard\/?/, "").replace(/\/+$/, "");
  const parts = seg ? seg.split("/") : [];
  const method = request.method;

  const deps = {
    db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, ownerOk: ownerOK, secrets: makeSecrets(env), fetch, now: () => Date.now(),
    // AI-assisted field mapping seam (functions/_connect/onboard/ai-map.js): intentionally UNSET here, so
    // suggestFieldMap always falls back to the deterministic inferColumnMap while CONNECT_AI_MAP_FLAG is off
    // (the default). // VERIFY before flipping that flag on: wire aiSuggest to a HEADERS-ONLY call routed
    // through the AI Control Center's governed, no-retention model tier (functions/_ai_usage.js) — e.g.
    //   aiSuggest: ({ headers, fields }) => callGovernedModel(env, "connect-map", { headers, fields })
    // — and confirm with the compliance owner that this egress (header strings + the fixed SCCM field list,
    // NEVER a row/cell/patient value) is acceptable BEFORE enabling. Do NOT point this at
    // functions/api/ai/[[path]].js (the live clinician-facing MaiK/Gemini endpoint) — this is a separate,
    // dedicated onboarding seam.
    aiSuggest: undefined,
    // Generic SQL/DB driver seam (functions/_connect/connectors/sql/connector.js): intentionally UNSET here,
    // EXACTLY like aiSuggest above, so save/list/validate-config work but test/pull HONESTLY return
    // not-configured (never a fabricated row / fake empty success). // VERIFY to make it real, the owner must:
    // (a) `wrangler hyperdrive create` + add the Hyperdrive binding to the Pages project; (b) add a SQL client
    // dependency, which REQUIRES introducing a build step (an owner architectural decision this buildless app
    // cannot make); (c) write a driver-pg.js makePgDriver(binding) whose query(template, params) uses a
    // PARAMETERIZED bind — NEVER string-concatenate the patient value (the SQL-injection invariant); (d) set
    //   sqlDriverFactory: (e, bindingName) => makePgDriver(e[bindingName])
    // here; (e) flip CONNECT_SQL_FLAG on only after a live integration test. Do NOT wire a live driver or add a
    // dep now. env is threaded so the wired factory can resolve the binding from the environment.
    sqlDriverFactory: undefined,
    env,
  };
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
    // Self-service Activity log (security-center-lite): the tenant's own PHI-free audit trail, bounded + most-
    // recent-first, client-safe projection only. Same connector:read RBAC as /health; ?limit= optionally tunes
    // the page size (default 50, hard max 200 -- see activity.js).
    if (method === "GET" && seg === "activity") return jsonResponse(await readTenantActivity(deps, request, env, tid, { limit: url.searchParams.get("limit") || undefined }));
    // Connector Registry + Marketplace catalog: a self-service catalog of every connector TYPE the platform
    // supports (metadata only -- no tenant/PHI data), so an admin sees what they can connect and whether each
    // type is enabled. Same connector:read RBAC tier as /health and /activity.
    if (method === "GET" && seg === "connectors") return jsonResponse(await listConnectorCatalog(deps, request, env));
    // Consent Dashboard (Increment 1): PHI-free tenant-scoped read of the tenant's own data-sharing consents,
    // plus a LOCAL revoke that our own data-request gate enforces immediately (see functions/_connect/onboard/
    // consents.js). Same connector:read RBAC tier as /health and /activity for the read; the revoke additionally
    // requires connector:write (owner/admin only). Gated by its OWN narrow flag on top of the base onboard gate.
    if (method === "GET" && seg === "consents") {
      if (consentGateBlocks(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse(await readTenantConsents(deps, request, env, tid, { limit: url.searchParams.get("limit") || undefined }));
    }
    if (method === "POST" && parts[0] === "consents" && parts[1] && parts[2] === "revoke") {
      if (consentGateBlocks(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse(await revokeTenantConsent(deps, request, env, tid, parts[1]));
    }
    // Enterprise Administration Portal: Members/Access. Gated by its OWN narrow flag (smd_connect_admin) on top
    // of the base onboard gate -- 404 when either is off (no existence leak), the SAME idiom as
    // consentGateBlocks/aiMapFlagOn. listMembers/setRole/removeMember are the EXISTING RBAC-gated, last-owner-
    // protected enterprise module (functions/_connect/enterprise/members.js) -- UNCHANGED here. listMembers
    // returns raw {user_id,tenant_id,role} rows; this route PROJECTS each to a client-safe {userId,role} only
    // (tenant_id is dropped -- the caller already knows it, it's the tenant they selected).
    if (method === "GET" && seg === "members") {
      if (!adminFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      const rows = await listMembers(deps, request, env, tid);
      return jsonResponse({ ok: true, members: rows.map((r) => ({ userId: r.user_id, role: r.role })) });
    }
    if (method === "POST" && seg === "members/role") {
      if (!adminFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse(await setRole(deps, request, env, tid, { userId: body.userId, role: body.role }));
    }
    if (method === "POST" && seg === "members/remove") {
      if (!adminFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse(await removeMember(deps, request, env, tid, { userId: body.userId }));
    }
    if (method === "POST" && seg === "emr") {
      if (body.type === "rest-json" && !restFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (body.type === "dicomweb" && !dicomFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (body.type === "graphql" && !graphqlFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (body.type === "sql" && !sqlFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse(await saveConnection(deps, request, env, tid, body));
    }
    if (method === "GET" && seg === "list") return jsonResponse({ ok: true, connections: await listConnections(deps, request, env, tid) });
    // Auto-discovery: unauthenticated capability probe (FHIR version/software/SMART support) for wizard pre-fill.
    if (method === "POST" && seg === "discover") return jsonResponse(await discoverCapabilities(deps, request, env, tid, body));
    if (method === "POST" && parts[0] === "test" && parts[1]) {
      if (await restGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await dicomGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await graphqlGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await sqlGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse(await testConnection(deps, request, env, tid, parts[1]));
    }
    if (method === "POST" && parts[0] === "pull" && parts[1]) {
      if (await restGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await dicomGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await graphqlGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await sqlGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse({ ok: true, bundle: await pullConnection(deps, request, env, tid, parts[1], body.patientId) });
    }
    // Auto Validation: config-shape + connector-conformance (synthetic, type-level) + reachability (the same
    // live probe as /test) in one report. Same per-track gate as /test and /pull (no existence leak either way).
    if (method === "POST" && parts[0] === "validate" && parts[1]) {
      if (await restGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await dicomGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await graphqlGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await sqlGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse(await validateConnection(deps, request, env, tid, parts[1]));
    }
    // Automatic sync scheduler: the RBAC-gated per-connection interval setter (a hospital admin configures it
    // from the wizard); the cron-only sweep below is what actually runs the due connections.
    if (method === "POST" && parts[0] === "sync-config" && parts[1]) return jsonResponse(await setSyncConfig(deps, request, env, tid, parts[1], body));
    // Automatic sync scheduler: manual "Sync now" for ONE connection -- the SAME RBAC tier + per-track gate as
    // /test (it reuses the identical reachability probe), but also stamps config.lastSyncAt like the cron sweep
    // does, so a manual run resets this connection's own auto-sync clock too.
    if (method === "POST" && parts[0] === "sync-now" && parts[1]) {
      if (await restGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await dicomGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await graphqlGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (await sqlGateBlocks(deps, tid, parts[1], env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse(await syncNow(deps, request, env, tid, parts[1]));
    }
    // CRON-ONLY: the stewardmd-api Worker's schedule POSTs here (mirrors /admin/sweep on the Phase-0 surface).
    // Admin-token gated, NOT RBAC — there is no per-request clinician actor in a cron sweep. Missing/wrong
    // token -> 401 before any DB access (no existence leak beyond the top-level flag gate, already checked).
    if (method === "POST" && seg === "sync-run") {
      if (!(await deps.ownerOk(request, env))) return jsonResponse({ error: "unauthorized" }, { status: 401 });
      return jsonResponse(await runDueSyncs(deps, env, deps.now()));
    }
    if (method === "POST" && seg === "csv") return jsonResponse(await parseCsvUpload(deps, request, env, tid, body));
    // AI-assisted field mapping suggestion: a SEPARATE per-track flag (smd_connect_ai_map, default OFF) on top
    // of the base onboard gate, mirroring the rest-json/dicomweb idiom — flag off => 404 (no existence leak)
    // and the wizard falls back to the existing deterministic mapping. See ai-map.js for the PHI-safety
    // invariant (headers + the fixed SCCM field list only, never a row/cell/patient value).
    if (method === "POST" && seg === "suggest-mapping") {
      if (!aiMapFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      return jsonResponse(await suggestMapping(deps, request, env, tid, body));
    }
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
