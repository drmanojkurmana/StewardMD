// functions/api/connect/[[path]].js — StewardMD Connect HTTP surface (spec §8). Flag-gated; server-derived identity; no-store.
import { flagOn, jsonResponse } from "../../_connect/testkit.js";
import { loadPatientContext, ingestEvent } from "../../_connect/engine.js";
import { fhirR4Connector } from "../../_connect/connectors/fhir-r4/connector.js";
import { AuthError, PermissionError, SandboxViolation } from "../../_connect/permission.js";
import { makeSecrets } from "../../_connect/secrets.js";
import { makeAuditSink } from "../../_connect/audit.js";
import { handleIngress } from "../../_connect/abdm/ingress.js";
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
      ingestEvent, fetch, now: () => new Date().toISOString() };
    return handleIngress(env, deps, request);
  }
  if (/^\/ingress\//.test(path)) return jsonResponse({ error: "not_implemented", phase: 1 }, { status: 501 });

  if (path === "/context" && request.method === "POST") {
    let body = {}; try { body = await request.json(); } catch {}
    const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, connectors: { "fhir-r4": fhirR4Connector } };
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
