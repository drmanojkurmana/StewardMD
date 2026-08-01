// functions/api/connect/[[path]].js — StewardMD Connect HTTP surface (spec §8). Flag-gated; server-derived identity; no-store.
import { flagOn, jsonResponse } from "../../_connect/testkit.js";
import { loadPatientContext, ingestEvent } from "../../_connect/engine.js";
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
import { fhirFlagOn } from "../../_connect/smart/flags.js"; // Track A: smd_connect_fhir gate (default OFF)
import { handleFeedIngest } from "../../_connect/ingest.js"; // Track B: HMAC-gated legacy-feed ingest
import { hl7v2Connector } from "../../_connect/connectors/hl7v2/connector.js";
import { fileConnector } from "../../_connect/connectors/file/connector.js";

const STATUS = (e) => (e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : 400);
const CODE = (e) => (e && e.constructor && e.constructor.name) ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error" : "error";

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
    return handleIngress(env, deps, request);
  }
  // Track B: HMAC-gated legacy-feed ingest (HL7 v2 + file/CSV). No StewardMD actor; tenant from the feed row.
  if (/^\/ingress\/hl7/.test(path) || /^\/ingress\/file/.test(path)) {
    const kind = /^\/ingress\/hl7/.test(path) ? "hl7v2" : "file";
    const feedDeps = { db: env.CONNECT_DB, kv: env.MAIK_KV, secrets: makeSecrets(env), connectors: { hl7v2: hl7v2Connector, file: fileConnector }, audit: makeAuditSink(env, env.CONNECT_DB), now: () => Date.now() };
    return handleFeedIngest(env, feedDeps, request, kind);
  }
  if (/^\/ingress\//.test(path)) return jsonResponse({ error: "not_implemented", phase: 1 }, { status: 501 });

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
    const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, connectors: { "fhir-r4": fhirR4Connector } };
    const req = { request, tenantId: body.tenantId, patientRef: body.patientRef, scope: body.scope, connectorId: body.connectorId || "fhir-r4" };
    // Track A: a FHIR-connector context request requires smd_connect_fhir too (no existence leak when off).
    if (req.connectorId === "fhir-r4" && !fhirFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
    // NOTE: engine derives actor via identify(request) and verifies membership for tenantId;
    // a body tenantId the actor is not a member of => PermissionError (no cross-tenant read).
    try {
      const bundle = await loadPatientContext(env, deps, req);
      return jsonResponse({ ok: true, bundle });     // ephemeral; not persisted
    } catch (e) {
      return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });   // sanitized; no raw value/stack
    }
  }
  return jsonResponse({ error: "not_found" }, { status: 404 });
}
