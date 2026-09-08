/* functions/api/fhir/[[path]].js - the FHIR server an external application talks to.
 *
 * /api/queue/ward/fhir is the same record behind a clinician's session, inside the block that
 * assumes an employee. This is the door for something that is NOT an employee: an application
 * holding a SMART on FHIR token this server issued. It sits outside that block on purpose, the way
 * /api/portal does for patients - the one place a non-staff caller reads a chart must not be an
 * exception inside code whose every other line assumes staff.
 *
 *   GET  /api/fhir/{orgId}/.well-known/smart-configuration
 *   GET  /api/fhir/{orgId}/metadata                        CapabilityStatement, with the SMART security block
 *   GET  /api/fhir/{orgId}/smart/authorize?...             the clinician's own session authorises an app
 *   POST /api/fhir/{orgId}/smart/token                     form-encoded, per OAuth
 *   POST /api/fhir/{orgId}/smart/revoke
 *   GET  /api/fhir/{orgId}/{Type}...                       every read the ward door answers, as the bearer
 *
 * READ ONLY. A bearer can write nothing: its actor has an empty write scope, and this file has no
 * write route. Inbound exchange stays on the clinician's door. OFF unless the hospital enabled
 * wardsynq.fhir.smart and registered a client; the org id in the path is not a secret and gets an
 * anonymous caller nothing.
 */

import * as ORG from "../../_opd_org_store.js";
import { actorDeps, recordDeps } from "../../_wardsynq/deps.js";
import { operationOutcome } from "../../_wardsynq/fhir.js";
import { fhirResponse, dispatchRead } from "../../_wardsynq/fhir-route.js";
import { smartEnabled, smartConfiguration, authorize, token, revoke, resolveBearer } from "../../_wardsynq/smart-server.js";

const str = (v) => (v == null ? "" : String(v).trim());

function cors(request) {
  const origin = (request && request.headers && request.headers.get("Origin")) || "";
  return { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, Prefer, If-Match", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Expose-Headers": "ETag, Last-Modified, Location", Vary: "Origin" };
}
const oauth = (obj, status, request, extra) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" }, cors(request), extra || {}) });

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
  const url = new URL(request.url);
  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/").filter(Boolean);
  const orgId = str(parts[0]);
  if (!orgId) return fhirResponse(operationOutcome("error", "not-found", "no hospital named"), 404, null, cors(request));

  const org = await ORG.getOrg(env, orgId);
  if (!org || org.mode !== "wardsynq" || !org.connectTenantId) return fhirResponse(operationOutcome("error", "not-found", "not found"), 404, null, cors(request));
  const cfg = (org.wardsynq && org.wardsynq.fhir) || null;
  const migration = { mode: "authoritative", tenantId: String(org.connectTenantId) };
  const base = `${url.origin}/api/fhir/${orgId}`;
  const smart = smartEnabled(cfg) ? { authorize: `${base}/smart/authorize`, token: `${base}/smart/token`, revoke: `${base}/smart/revoke` } : null;
  const ctx = { migration, config: cfg, base, actorDeps: actorDeps(env), recordDeps: recordDeps(env, migration.tenantId), smart, terminology: (org.wardsynq && org.wardsynq.terminology) || null, profiles: (cfg && cfg.profiles) || null };

  const sub = parts[1] || "", sub2 = parts[2] || "";

  if (sub === ".well-known" && sub2 === "smart-configuration") {
    if (!smart) return fhirResponse(operationOutcome("error", "not-found", "not found"), 404, null, cors(request));
    return oauth(smartConfiguration(base, cfg), 200, request);
  }

  if (sub === "smart") {
    if (sub2 === "authorize" && request.method === "GET") {
      const r = await authorize(request, env, { ...ctx, params: url.searchParams });
      if (r.redirect) return new Response(null, { status: 302, headers: Object.assign({ Location: r.redirect, "Cache-Control": "no-store" }, cors(request)) });
      return oauth(r.body, r.status, request, r.retryAfter ? { "Retry-After": String(r.retryAfter) } : null);
    }
    if ((sub2 === "token" || sub2 === "revoke") && request.method === "POST") {
      let form;
      try { form = new URLSearchParams(await request.text()); } catch { form = new URLSearchParams(); }
      const r = sub2 === "token" ? await token(request, env, { ...ctx, form }) : await revoke(request, env, { ...ctx, form });
      return oauth(r.body, r.status, request, r.retryAfter ? { "Retry-After": String(r.retryAfter) } : null);
    }
    return oauth({ error: "not_found" }, 404, request);
  }

  if (request.method !== "GET") return fhirResponse(operationOutcome("error", "not-supported", "this door is read-only"), 405, { Allow: "GET" }, cors(request));
  /* The CapabilityStatement is PUBLIC. It is how a client discovers the endpoints before it holds
   * any token, it names no patient, and hiding it would only hide the door - not lock it. */
  if (sub === "metadata") {
    const { obj, status } = await dispatchRead(request, env, ["metadata"], url, ctx, "");
    return fhirResponse(obj, status, null, cors(request));
  }
  /* Every other read. The bearer is resolved here and handed down already narrowed; with no bearer
   * at all this door is closed - a staff session uses the ward route. */
  const bearer = await resolveBearer(request, env, ctx);
  if (!bearer) return fhirResponse(operationOutcome("error", "login", "a SMART bearer token is required"), 401, { "WWW-Authenticate": 'Bearer realm="wardsynq"' }, cors(request));
  if (bearer.error) return fhirResponse(operationOutcome("error", "login", bearer.error.detail), bearer.error.status, { "WWW-Authenticate": `Bearer realm="wardsynq", error="${bearer.error.code}"` }, cors(request));

  const { obj, status } = await dispatchRead(request, env, parts.slice(1), url, { ...ctx, actorOverride: bearer }, request.headers.get("Prefer") || "");
  return fhirResponse(obj, status, null, cors(request));
}
