/* functions/_wardsynq/fhir-subscription.js - Subscription (R4 Subscriptions Backport), as a view of the webhooks.
 *
 * NOT A SECOND DELIVERY SYSTEM. A hospital already has webhooks (webhooks.js): staged in the clinical
 * write, fanned out through the outbox, signed, retried, logged and auto-disabled. An endpoint the
 * administrator registers with payload "fhir-id-only" receives the backport's id-only notification
 * Bundle instead of the thin JSON, and THAT endpoint is what this file shows as Subscription resources:
 * one per event type, because backport criteria name exactly one topic.
 *
 * READ ONLY. Subscriptions are created, changed, tested and turned off on the Admin Center's
 * Integrations screen, where the destination address checks, the secret and the audit already live. A
 * FHIR create would be a second door onto the same endpoint list with none of that. An endpoint with
 * the WardSynQ JSON payload is not a Subscription and is not shown here.
 *
 * WHO. The webhooks' own gate on the ward door (staff.admin at the route) plus a clinical actor that
 * may read the record; on /api/fhir a SMART backend-services token with system/Subscription.read. The
 * header carrying the signing secret is never part of the resource.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { operationOutcome } from "./fhir.js";
import { ENDPOINT_TYPE, MAX_ENDPOINTS, EVENT_TYPES, PAYLOAD_FHIR, topicFor, subscriptionIdFor } from "./webhook-events.js";

const str = (v) => (v == null ? "" : String(v).trim());
const PAYLOAD_CONTENT = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-payload-content";

/** PURE. The Subscriptions one endpoint is. [] for an endpoint that does not send FHIR notifications. */
function fhirSubscriptions(ep) {
  if (!ep || ep.payload !== PAYLOAD_FHIR) return [];
  const status = ep.active === true ? "active" : ep.status === "auto-disabled" ? "error" : "off";
  return (ep.eventTypes || []).map((type) => ({
    resourceType: "Subscription", id: subscriptionIdFor(ep.id, type),
    status,
    reason: str(ep.description) || EVENT_TYPES[type] || type,
    criteria: topicFor(type),
    ...(status === "error" && ep.disabledReason ? { error: str(ep.disabledReason) } : {}),
    channel: {
      type: "rest-hook", endpoint: ep.url, payload: "application/fhir+json",
      _payload: { extension: [{ url: PAYLOAD_CONTENT, valueCode: "id-only" }] },
    },
  }));
}

async function authorise(request, env, ctx) {
  const b = ctx.actorOverride;
  if (b) {
    const ok = b.source === "smart:backend" && !b.patientId && (b.scopes || []).some((s) => s === "system/Subscription.read" || s === "system/*.read");
    return ok ? { ok: true } : { status: 403, obj: operationOutcome("error", "forbidden", "Subscription needs a SMART backend-services token with system/Subscription.read") };
  }
  try { await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps); return { ok: true }; }
  catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { status, obj: operationOutcome("error", status === 401 ? "login" : "forbidden", str(e && e.message) || "not permitted") };
  }
}

/** GET Subscription/{id} and GET Subscription?status=&criteria=. ctx: { migration, id?, base, actorDeps, recordDeps, actorOverride? } */
async function subscriptions(request, env, ctx, url) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { status: 404, obj: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const q = url.searchParams;
  const bad = [...new Set(q.keys())].filter((k) => !["status", "criteria", "orgId", "_format"].includes(k));
  if (!ctx.id && bad.length) return { status: 400, obj: operationOutcome("error", "not-supported", `${bad.join(", ")}: Subscription is searched by status and criteria`) };
  const who = await authorise(request, env, ctx);
  if (!who.ok) return who;
  let eps;
  try { eps = (await ctx.recordDeps.repository.latestByType(mig.tenantId, ENDPOINT_TYPE, MAX_ENDPOINTS * 5)) || []; }
  catch { return { status: 502, obj: operationOutcome("error", "exception", "the subscription list could not be read") }; }
  const all = eps.flatMap(fhirSubscriptions);
  if (ctx.id) {
    const hit = all.find((s) => s.id === str(ctx.id));
    return hit ? { status: 200, obj: hit } : { status: 404, obj: operationOutcome("error", "not-found", "no such Subscription") };
  }
  const matched = all.filter((s) => (!q.get("status") || s.status === str(q.get("status"))) && (!q.get("criteria") || s.criteria === str(q.get("criteria"))));
  return { status: 200, obj: { resourceType: "Bundle", type: "searchset", total: matched.length, entry: matched.map((s) => ({ fullUrl: `${str(ctx.base)}/Subscription/${s.id}`, resource: s, search: { mode: "match" } })) } };
}

export { PAYLOAD_CONTENT, fhirSubscriptions, subscriptions };
