// functions/api/connect/[[path]].js — StewardMD Connect HTTP surface (spec §8). Flag-gated; server-derived identity; no-store.
import { flagOn, jsonResponse } from "../../_connect/testkit.js";
import { loadPatientContext } from "../../_connect/engine.js";
import { fhirR4Connector } from "../../_connect/connectors/fhir-r4/connector.js";
import { AuthError, PermissionError, SandboxViolation } from "../../_connect/permission.js";
import { identify } from "../../_usage.js";

const STATUS = (e) => (e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : 400);
const CODE = (e) => (e && e.constructor && e.constructor.name) ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error" : "error";

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/connect/, "") || "/";

  if (path === "/health") return jsonResponse({ ok: true, service: "stewardmd-connect", phase: 0 });
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
