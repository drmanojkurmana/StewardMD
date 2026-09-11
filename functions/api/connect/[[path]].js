// functions/api/connect/[[path]].js — StewardMD Connect HTTP surface (spec §8). Flag-gated; server-derived identity; no-store.
import { flagOn, jsonResponse } from "../../_connect/testkit.js";
import { loadPatientContext, searchPatients, searchPractitioners, ingestEvent } from "../../_connect/engine.js";
import { fhirR4Connector } from "../../_connect/connectors/fhir-r4/connector.js";
import { AuthError, PermissionError, SandboxViolation } from "../../_connect/permission.js";
import { makeSecrets } from "../../_connect/secrets.js";
import { makeAuditSink } from "../../_connect/audit.js";
import { handleIngress } from "../../_connect/abdm/ingress.js";
import { hipFlagOn } from "../../_connect/abdm/hip-flags.js";
import { handleDiscovery, serveTransfer, putHipConsent, linkCareContext } from "../../_connect/abdm/hip.js";
import { followcareSource } from "../../_connect/abdm/hip-sources/followcare.js";
import { identify } from "../../_usage.js";
import { ownerOK } from "../../_adminauth.js";
import { sweep } from "../../_connect/abdm/state.js";
/* TASK 7.8: the composition of the ABDM consume tail. This route is the ONE place the exchange side
 * and the record side meet, which is why the wiring lives here and not inside either of them. */
import { consumeTransfer, requestConsent, requestHealthInformation } from "../../_connect/abdm/hiu.js";
import { makeGateway, AbdmError } from "../../_connect/abdm/gateway.js";
import { getConsentReqByConsentId, fetchConsentArtifact } from "../../_connect/abdm/consent.js";
import { makeConsumeAndLand } from "../../_wardsynq/abdm-land.js";
import { recordDeps as wsqRecordDeps } from "../../_wardsynq/deps.js";
import { fhirFlagOn } from "../../_connect/smart/flags.js"; // Track A: smd_connect_fhir gate (default OFF)
import { handleFeedIngest } from "../../_connect/ingest.js"; // Track B: HMAC-gated legacy-feed ingest
import { hl7v2Connector } from "../../_connect/connectors/hl7v2/connector.js";
import { fileConnector } from "../../_connect/connectors/file/connector.js";
import { fhirPushConnector } from "../../_connect/connectors/fhir-push/connector.js"; // Track B: generic FHIR-push webhook
import { defaultRegistry } from "../../_connect/sdk/index.js"; // Track C: Connector SDK registry (gated by smd_connect_sdk)
import { sdkFlagOn } from "../../_connect/sdk/flags.js";
import { restFlagOn } from "../../_connect/connectors/rest-json/flags.js"; // per-track gate: smd_connect_rest
import { dicomFlagOn } from "../../_connect/connectors/dicomweb/flags.js"; // per-track gate: smd_connect_dicom
import { graphqlFlagOn } from "../../_connect/connectors/graphql/flags.js"; // per-track gate: smd_connect_graphql
import { sqlFlagOn } from "../../_connect/connectors/sql/flags.js"; // per-track gate: smd_connect_sql

/* An ABDM gateway that did not accept is an UPSTREAM failure, not a bad request: 400 would tell a
 * caller to change something it got right, and would make a gateway outage look like a client bug. */
const STATUS = (e) => (e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : e instanceof AbdmError ? 502 : 400);
const CODE = (e) => (e && e.constructor && e.constructor.name) ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error" : "error";

/* TASK 7.8. The ABDM gateway this deployment talks to, or null when it is not configured.
 *
 * Built ONLY from environment the operator set. A gateway invented from defaults would be a client
 * pointed at somebody else's endpoint, so an absent base URL or an absent HIU identity means no
 * gateway and therefore no consume tail - the push stays buffered and recoverable rather than
 * half-consumed against a server this hospital never registered with.
 */
function abdmGatewayFor(env, deps) {
  const baseUrl = String((env && env.ABDM_GATEWAY_URL) || "").trim();
  const hiuId = String((env && env.ABDM_HIU_ID) || "").trim();
  if (!baseUrl || !hiuId || !deps.kv) return null;
  return makeGateway({
    baseUrl, hiuId, cmId: String((env && env.ABDM_CM_ID) || "").trim() || null,
    hipId: String((env && env.ABDM_HIP_ID) || "").trim() || null,
    fetch, kv: deps.kv, secrets: deps.secrets, now: () => new Date(),
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/connect/, "") || "/";

  if (path === "/health") return jsonResponse({ ok: true, service: "stewardmd-connect", phase: 0 });
  // ABDM HIU inbound webhook (Stage-4 Task-4, R6): ABDM-authenticated (no StewardMD actor). Identity is the
  // verified body-signature + the correlation row — tenant from the row, never the body. Fetch is wired for
  // getPinnedJwks; jwks is left unset so it is fetched+pinned per env.ABDM_JWKS_URL (fail-closed if unset).
  if (/^\/ingress\/abdm/.test(path)) {
    const deps = { db: env.CONNECT_DB, r2: env.CONNECT_R2, kv: env.MAIK_KV, secrets: makeSecrets(env),
      audit: makeAuditSink(env, env.CONNECT_DB),   // on-fetch → verifyConsentArtifact records consent.verified/denied (R14)
      // Stage-5 HIP serve wiring: the FollowCare read-source + the HIP handlers (the ingress gates them on the
      // second flag hipFlagOn; serveTransfer pushes sealed pages to the HIU's dataPushUrl). Tenant is the row's.
      source: followcareSource, handleDiscovery, serveTransfer, putHipConsent,
      ingestEvent, fetch, now: () => new Date().toISOString() };
    /* TASK 7.8: the consume tail, wired. consumeTransfer and consumeNdhmBundle existed, were tested,
     * and had NO production caller - a hospital could complete a whole ABDM exchange and have
     * nothing on the chart. This is the missing composition: join + decrypt + file, through the same
     * adapter, MPI and governed store every other feed uses. It is built only when the gateway this
     * deployment needs to acknowledge a transfer is actually configured; without that, a push is
     * still buffered durably and recovered by the reconcile pass rather than half-consumed. */
    const abdmGateway = abdmGatewayFor(env, deps);
    if (abdmGateway) {
      deps.consumeAndLand = makeConsumeAndLand({
        env,
        consumeTransfer,
        consumeDeps: { db: deps.db, r2: deps.r2, secrets: deps.secrets, gateway: abdmGateway, now: deps.now() },
        recordDeps: (tenantId) => wsqRecordDeps(env, tenantId),
        consentFor: async (consentId) => {
          if (consentId == null) return null;
          const row = await getConsentReqByConsentId(deps.db, consentId);
          if (!row) return null;
          // The purpose is stored as the JSON the VERIFIED artifact carried; it binds what this data
          // may be used for. An unparseable one is passed through as-is rather than dropped.
          let purpose = null;
          try { purpose = row.purpose ? JSON.parse(row.purpose) : null; } catch { purpose = row.purpose || null; }
          return { consentId, purpose, actor: row.actor || null };
        },
      });
      /* THE ARTIFACT FETCH, wired for the same reason. A GRANT notification says the patient agreed;
       * the signed artifact that says WHAT they agreed to arrives only if we ask for it, and the
       * data request cannot pass its own scope check until that artifact has been verified and
       * persisted. fetchConsentArtifact had no production caller either, so a granted consent
       * stopped there. This is the protocol's own next step, not a human decision - nobody presses
       * a button to find out what a consent they were just granted actually covers. */
      deps.fetchArtifact = async ({ requestId, consentId }) => fetchConsentArtifact(env, { gateway: abdmGateway }, { requestId, consentId });
    }
    return handleIngress(env, deps, request);
  }
  // Track B: HMAC-gated feed ingest. No StewardMD actor; tenant from the feed row. HL7 v2 + file/CSV keep the
  // HL7 flag; the generic FHIR-push webhook (/ingress/fhir) is routed to the SAME spine with kind 'fhir-push'
  // and its OWN flag. The /ingress/fhir match is anchored (not /ingress/fhir-r4, which stays reserved -> 501).
  if (/^\/ingress\/hl7/.test(path) || /^\/ingress\/file/.test(path) || /^\/ingress\/fhir(?:\/|$)/.test(path)) {
    const kind = /^\/ingress\/hl7/.test(path) ? "hl7v2" : /^\/ingress\/fhir(?:\/|$)/.test(path) ? "fhir-push" : "file";
    const feedDeps = { db: env.CONNECT_DB, kv: env.MAIK_KV, secrets: makeSecrets(env), connectors: { hl7v2: hl7v2Connector, file: fileConnector, "fhir-push": fhirPushConnector }, audit: makeAuditSink(env, env.CONNECT_DB), now: () => Date.now() };
    return handleFeedIngest(env, feedDeps, request, kind);
  }
  if (/^\/ingress\//.test(path)) return jsonResponse({ error: "not_implemented", phase: 1 }, { status: 501 });

  /* ABDM HIU: the two doors that START an exchange.
   *
   * These existed as functions with real consent binding, real crypto and a real state machine, and
   * NOTHING CALLED THEM - a hospital could receive an ABDM callback and had no way to ask for
   * anything in the first place. The functions themselves already do the part that matters: both
   * derive the actor from the request and verify tenant membership BEFORE any gateway call or any
   * write, so a body's tenantId is never trusted. This route adds what a door has to add - the
   * argument checks that stop a request being made that can never be used - and maps the failures
   * onto honest status codes.
   *
   * They are gated on the base Connect flag (the top guard) and on a CONFIGURED GATEWAY: with no
   * gateway there is nobody to ask, and answering anything but "not found" would advertise a door
   * that cannot open.
   */
  if (path === "/abdm/hiu/consent-request" && request.method === "POST") {
    const gw = abdmGatewayFor(env, { kv: env.MAIK_KV, secrets: makeSecrets(env) });
    if (!gw) return jsonResponse({ error: "not_found" }, { status: 404 });
    let body = {}; try { body = await request.json(); } catch {}
    /* PURPOSE AND HITYPES ARE REQUIRED HERE, not because ABDM demands them in this shape but because
     * a consent granted without them can never be USED: revalidateForRequest fails closed on an
     * absent purpose and on an empty hiTypes set, so a consent requested without either would be
     * granted by a patient and then refuse every data request made under it. Refusing at the door is
     * the only place that failure can still be explained to somebody. */
    if (!body.abhaAddress) return jsonResponse({ error: "abha_address_required" }, { status: 422 });
    if (!body.purpose) return jsonResponse({ error: "purpose_required", detail: "a consent with no purpose cannot be used for any later request" }, { status: 422 });
    if (!Array.isArray(body.hiTypes) || !body.hiTypes.length) return jsonResponse({ error: "hi_types_required", detail: "name at least one health-information type; a consent for nothing grants nothing" }, { status: 422 });
    if (!body.dateRange || !body.dateRange.from || !body.dateRange.to) return jsonResponse({ error: "date_range_required", detail: "a consent is for a period; an unbounded one is not asked for here" }, { status: 422 });
    if (!body.dataEraseAt) return jsonResponse({ error: "data_erase_at_required", detail: "say when this data must be erased; an expiry this server cannot state is one it cannot honour" }, { status: 422 });
    const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, secrets: makeSecrets(env), gateway: gw,
      identifyFn: identify, audit: makeAuditSink(env, env.CONNECT_DB), now: () => new Date().toISOString() };
    try {
      const out = await requestConsent(env, deps, { request, tenantId: body.tenantId, abhaAddress: body.abhaAddress,
        purpose: body.purpose, hiTypes: body.hiTypes, dateRange: body.dateRange, dataEraseAt: body.dataEraseAt });
      /* The requestId and nothing else. The raw ABHA went into the POST body to the gateway and is
       * never echoed back, never stored and never audited - it is HMAC'd before it reaches D1. */
      return jsonResponse({ ok: true, requestId: out.requestId, status: out.status });
    } catch (e) {
      return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });
    }
  }
  if (path === "/abdm/hiu/data-request" && request.method === "POST") {
    const gw = abdmGatewayFor(env, { kv: env.MAIK_KV, secrets: makeSecrets(env) });
    if (!gw) return jsonResponse({ error: "not_found" }, { status: 404 });
    let body = {}; try { body = await request.json(); } catch {}
    if (!body.consentId) return jsonResponse({ error: "consent_id_required" }, { status: 422 });
    /* Every one of these is a thing the consent gate compares the request against, and every one of
     * them fails CLOSED inside it. Checking them here means a caller is told which argument was
     * missing instead of being told, uniformly, that consent revalidation failed. */
    if (!Array.isArray(body.careContexts) || !body.careContexts.length) return jsonResponse({ error: "care_contexts_required", detail: "name the care contexts being asked for; a request that names none is bound to nothing" }, { status: 422 });
    if (!Array.isArray(body.hiTypes) || !body.hiTypes.length) return jsonResponse({ error: "hi_types_required" }, { status: 422 });
    if (!body.purpose) return jsonResponse({ error: "purpose_required", detail: "the purpose must match the one the consent was granted for" }, { status: 422 });
    const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, secrets: makeSecrets(env), gateway: gw,
      identifyFn: identify, audit: makeAuditSink(env, env.CONNECT_DB), now: () => new Date().toISOString() };
    try {
      const out = await requestHealthInformation(env, deps, { request, tenantId: body.tenantId, consentId: body.consentId,
        careContexts: body.careContexts, hiTypes: body.hiTypes, purpose: body.purpose, dateRange: body.dateRange });
      return jsonResponse({ ok: true, requestId: out.requestId, status: out.status });
    } catch (e) {
      return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });
    }
  }

  // ABDM HIP care-context REGISTRATION (Stage-5 Task-8, gated on the SECOND flag). Server-DERIVED identity:
  // linkCareContext resolves the actor + tenant membership (AuthError/PermissionError before any write) and
  // HMACs the raw ABHA before D1 — the body carries the ABHA once, never a trusted tenant/actor. Idempotent.
  if (path === "/hip/care-contexts" && request.method === "POST") {
    if (!hipFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    let body = {}; try { body = await request.json(); } catch {}
    const deps = { db: env.CONNECT_DB, audit: makeAuditSink(env, env.CONNECT_DB), identify };
    const req = { request, tenantId: body.tenantId, abhaAddress: body.abhaAddress, ref: body.ref,
      hiType: body.hiType, display: body.display, source: body.source, now: () => new Date().toISOString() };
    try {
      const out = await linkCareContext(env, deps, req);
      return jsonResponse({ ok: true, id: out.id });
    } catch (e) {
      return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });   // sanitized; no raw value/stack
    }
  }

  // ABDM reconciliation GC sweep (Stage-6 Task-8). CRON-ONLY: the stewardmd-api Worker's hourly cron POSTs
  // here with the shared X-Admin-Token. Already flag-gated by the onRequest top guard (flag OFF -> 404, so
  // existence is not leaked). Additionally admin-token protected and NO-OP-SAFE: if the D1/R2 bindings are
  // absent (Connect flag-OFF / unprovisioned) it returns cleanly WITHOUT touching state.sweep. FAIL-SAFE: any
  // sweep error is audited metadata-only (no message/stack, no PHI) and never rethrown, so a GC failure can
  // never crash the Worker's scheduled handler.
  if (path === "/admin/sweep" && request.method === "POST") {
    if (!(await ownerOK(request, env))) return jsonResponse({ error: "forbidden" }, { status: 403 });
    if (!env.CONNECT_DB || !env.CONNECT_R2) return jsonResponse({ ok: true, skipped: "bindings_absent" });
    const now = new Date().toISOString();
    try {
      const counts = await sweep(env.CONNECT_DB, env.CONNECT_R2, env, now);
      try { await makeAuditSink(env, env.CONNECT_DB)({ action: "data.swept", outcome: "ok", resourceCounts: counts, ts: now }); } catch {}
      return jsonResponse(Object.assign({ ok: true }, counts));
    } catch (e) {
      // Fail-safe: record the failure metadata-only (no error message / stack) and return a clean response.
      try { await makeAuditSink(env, env.CONNECT_DB)({ action: "data.swept", outcome: "error", ts: now }); } catch {}
      return jsonResponse({ ok: false, error: "sweep_failed" });
    }
  }

  if (path === "/context" && request.method === "POST") {
    let body = {}; try { body = await request.json(); } catch {}
    // Track C: with smd_connect_sdk OFF this is byte-identical to the pre-SDK literal map; ON, it is the
    // pull-profile subset of the conformance-gated SDK registry (event connectors like abdm are filtered out).
    let connectors = { "fhir-r4": fhirR4Connector };
    if (sdkFlagOn(env)) {
      connectors = {};
      for (const [id, c] of Object.entries(defaultRegistry().asConnectorMap()))
        if (c.meta && c.meta.profile === "pull") connectors[id] = c;
    }
    const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, connectors };
    const req = { request, tenantId: body.tenantId, patientRef: body.patientRef, scope: body.scope, connectorId: body.connectorId || "fhir-r4" };
    // Track A: a FHIR-connector context request requires smd_connect_fhir too (no existence leak when off).
    if (req.connectorId === "fhir-r4" && !fhirFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    // Track: a rest-json context request requires smd_connect_rest too, so the per-track flag gates the SDK
    // /context path (with smd_connect_sdk ON) exactly as it gates the onboard save/test/pull routes.
    if (req.connectorId === "rest-json" && !restFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    // Track: a dicomweb context request requires smd_connect_dicom too, same per-track gate idiom.
    if (req.connectorId === "dicomweb" && !dicomFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    // Track: a graphql context request requires smd_connect_graphql too, same per-track gate idiom.
    if (req.connectorId === "graphql" && !graphqlFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    // Track: a sql context request requires smd_connect_sql too, same per-track gate idiom.
    if (req.connectorId === "sql" && !sqlFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    // NOTE: engine derives actor via identify(request) and verifies membership for tenantId;
    // a body tenantId the actor is not a member of => PermissionError (no cross-tenant read).
    try {
      const bundle = await loadPatientContext(env, deps, req);
      return jsonResponse({ ok: true, bundle });     // ephemeral; not persisted
    } catch (e) {
      return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });   // sanitized; no raw value/stack
    }
  }
  if (path === "/patients/search" && request.method === "POST") {
    let body = {}; try { body = await request.json(); } catch {}
    let connectors = { "fhir-r4": fhirR4Connector };
    if (sdkFlagOn(env)) {
      connectors = {};
      for (const [id, c] of Object.entries(defaultRegistry().asConnectorMap()))
        if (c.meta && c.meta.profile === "pull") connectors[id] = c;
    }
    const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, connectors };
    const req = { request, tenantId: body.tenantId, connectorId: body.connectorId || "fhir-r4", query: body.query };
    // Same per-track gates as /context: a connector's search needs its own flag (no existence leak when off).
    if (req.connectorId === "fhir-r4" && !fhirFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    if (req.connectorId === "rest-json" && !restFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    if (req.connectorId === "dicomweb" && !dicomFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    if (req.connectorId === "graphql" && !graphqlFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    if (req.connectorId === "sql" && !sqlFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    try {
      const patients = await searchPatients(env, deps, req);   // engine derives actor + verifies membership
      return jsonResponse({ ok: true, patients });             // lightweight [{id,name,gender,birthDate}]
    } catch (e) {
      return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });   // sanitized
    }
  }
  if (path === "/practitioners/search" && request.method === "POST") {
    let body = {}; try { body = await request.json(); } catch {}
    let connectors = { "fhir-r4": fhirR4Connector };
    if (sdkFlagOn(env)) {
      connectors = {};
      for (const [id, c] of Object.entries(defaultRegistry().asConnectorMap()))
        if (c.meta && c.meta.profile === "pull") connectors[id] = c;
    }
    const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, connectors };
    const req = { request, tenantId: body.tenantId, connectorId: body.connectorId || "fhir-r4", query: body.query };
    if (req.connectorId === "fhir-r4" && !fhirFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    if (req.connectorId === "rest-json" && !restFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    if (req.connectorId === "dicomweb" && !dicomFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    if (req.connectorId === "graphql" && !graphqlFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    if (req.connectorId === "sql" && !sqlFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    try {
      const doctors = await searchPractitioners(env, deps, req);   // engine derives actor + verifies membership
      return jsonResponse({ ok: true, doctors });                  // lightweight [{id,name}]
    } catch (e) {
      return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });   // sanitized
    }
  }
  return jsonResponse({ error: "not_found" }, { status: 404 });
}
