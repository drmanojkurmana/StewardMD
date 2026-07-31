// functions/api/connect/[[path]].js — StewardMD Connect HTTP surface (spec §8). Flag-gated; server-derived identity; no-store.
import { flagOn, jsonResponse } from "../../_connect/testkit.js";
import { loadPatientContext, ingestEvent } from "../../_connect/engine.js";
import { defaultRegistry } from "../../_connect/sdk/index.js"; // Track C: connectors resolved via the SDK registry (conformance-gated, frozen, per-request)
import { AuthError, PermissionError, SandboxViolation } from "../../_connect/permission.js";
import { makeSecrets } from "../../_connect/secrets.js";
import { makeAuditSink } from "../../_connect/audit.js";
import { handleIngress } from "../../_connect/abdm/ingress.js";
import { hipFlagOn } from "../../_connect/abdm/hip-flags.js";
import { handleDiscovery, serveTransfer, putHipConsent, linkCareContext } from "../../_connect/abdm/hip.js";
import { followcareSource } from "../../_connect/abdm/hip-sources/followcare.js";
import { identify } from "../../_usage.js";

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

  if (path === "/context" && request.method === "POST") {
    let body = {}; try { body = await request.json(); } catch {}
    // Track C: hand the PULL engine only the pull-profile connectors (event connectors like abdm have no
    // fetchPatient). A wrong-profile/unknown connectorId then resolves to undefined and hits the engine's OWN
    // guard (engine.js: "connector not registered" -> UpstreamError -> {error:"upstream"}) AFTER auth/membership,
    // exactly as before Track C. Auth stays strictly first for every id (a wrong id is indistinguishable to an
    // unauthenticated caller). Restores the precise pre-Track-C deps.connectors = { "fhir-r4": fhirR4Connector }.
    const pullConnectors = {};
    for (const [id, c] of Object.entries(defaultRegistry().asConnectorMap())) if (c.meta.profile === "pull") pullConnectors[id] = c;
    const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, connectors: pullConnectors };
    const req = { request, tenantId: body.tenantId, patientRef: body.patientRef, scope: body.scope, connectorId: body.connectorId || "fhir-r4" };
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
