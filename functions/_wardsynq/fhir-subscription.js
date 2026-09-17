/* functions/_wardsynq/fhir-subscription.js - Subscription (R4 Subscriptions Backport), as a view of the webhooks.
 *
 * NOT A SECOND DELIVERY SYSTEM. A hospital already has webhooks (webhooks.js): staged in the clinical
 * write, fanned out through the outbox, signed, retried, logged and auto-disabled. An endpoint the
 * administrator registers with payload "fhir-id-only" receives the backport's id-only notification
 * Bundle instead of the thin JSON, and THAT endpoint is what this file shows as Subscription resources:
 * one per event type, because backport criteria name exactly one topic.
 *
 * CREATED OVER FHIR THROUGH THE SAME DOOR AS THE SCREEN (G10). POST Subscription is validated as R4
 * structure (fhir-validate.js), then narrowed to what this server can honestly deliver - rest-hook,
 * application/fhir+json, id-only, exactly one topic it publishes, no custom headers, no end date - and
 * anything else is refused by name rather than dropped. What passes is handed to registerWebhook(): the
 * SAME https-only, public-address-only destination checks, the same sealed secret, the same audit row and
 * the same endpoint cap as the Integrations screen. It is not a second endpoint list. The signing secret
 * comes back once, in a response header, because a Subscription resource has no element that may carry
 * it; it is never part of any resource. Changes and turning one off stay on the Integrations screen.
 *
 * $STATUS. GET Subscription/{id}/$status answers the backport's searchset Bundle holding one
 * SubscriptionStatus Parameters: the subscription, its topic, its status and type query-status, plus the
 * reason when delivery auto-disabled it. No event count is given, because the delivery log is not a count
 * of events and a number that is not one would be believed.
 *
 * An endpoint with the WardSynQ JSON payload is not a Subscription and is not shown here.
 *
 * WHO. The webhooks' own gate on the ward door (staff.admin at the route) plus a clinical actor that
 * may read the record (and write it, for a create, as registerWebhook requires); on /api/fhir a SMART
 * backend-services token with system/Subscription.read reads and asks $status. The SMART door creates
 * nothing: this server issues no write scopes.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { operationOutcome } from "./fhir.js";
import { validateResource } from "./fhir-validate.js";
import { registerWebhook } from "./webhooks.js";
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
    if (!hit) return { status: 404, obj: operationOutcome("error", "not-found", "no such Subscription") };
    return ctx.op === "$status" ? { status: 200, obj: statusBundle(hit, str(ctx.base)) } : { status: 200, obj: hit };
  }
  const matched = all.filter((s) => (!q.get("status") || s.status === str(q.get("status"))) && (!q.get("criteria") || s.criteria === str(q.get("criteria"))));
  return { status: 200, obj: { resourceType: "Bundle", type: "searchset", total: matched.length, entry: matched.map((s) => ({ fullUrl: `${str(ctx.base)}/Subscription/${s.id}`, resource: s, search: { mode: "match" } })) } };
}

/** PURE. The backport's $status answer for one Subscription: a searchset holding its SubscriptionStatus. */
function statusBundle(sub, base) {
  return {
    resourceType: "Bundle", type: "searchset", total: 1,
    entry: [{ fullUrl: `urn:uuid:${crypto.randomUUID()}`, search: { mode: "match" }, resource: { resourceType: "Parameters", parameter: [
      { name: "subscription", valueReference: { reference: `${base ? base + "/" : ""}Subscription/${sub.id}` } },
      { name: "topic", valueCanonical: sub.criteria },
      { name: "status", valueCode: sub.status },
      { name: "type", valueCode: "query-status" },
      ...(sub.error ? [{ name: "error", valueCodeableConcept: { text: sub.error } }] : []),
    ] } }],
  };
}

/** The topic canonicals this server publishes, back to the event type each is. */
const TOPIC_TO_EVENT = Object.freeze(Object.fromEntries(Object.keys(EVENT_TYPES).map((t) => [topicFor(t), t])));

/**
 * PURE. What a POSTed Subscription asks for, narrowed to what this server delivers, or every reason it
 * cannot be honoured. Returns { url, eventType, description } or { issues: [OperationOutcome.issue] }.
 */
function subscriptionRequest(body) {
  const v = validateResource(body);
  const errors = v.issues.filter((i) => i.severity === "error" || i.severity === "fatal");
  if (!body || body.resourceType !== "Subscription") return { issues: [{ severity: "error", code: "invalid", diagnostics: "the body must be a Subscription" }] };
  if (errors.length) return { issues: errors };
  const issues = [];
  const refuse = (path, text) => issues.push({ severity: "error", code: "not-supported", diagnostics: text, expression: [path] });
  const ch = body.channel || {};
  if (!["requested", "active"].includes(body.status)) refuse("Subscription.status", "a new Subscription is created as requested (or active)");
  const eventType = TOPIC_TO_EVENT[str(body.criteria)];
  if (!eventType) refuse("Subscription.criteria", `criteria must be exactly one topic this server publishes: ${Object.keys(TOPIC_TO_EVENT).join(", ")}`);
  if (ch.type !== "rest-hook") refuse("Subscription.channel.type", "only rest-hook is delivered");
  if (!str(ch.endpoint)) refuse("Subscription.channel.endpoint", "a rest-hook needs an endpoint");
  if (str(ch.payload) !== "application/fhir+json") refuse("Subscription.channel.payload", "the payload must be application/fhir+json");
  const content = ((ch._payload && ch._payload.extension) || []).filter((e) => e && e.url === PAYLOAD_CONTENT);
  if (content.length !== 1 || content[0].valueCode !== "id-only") refuse("Subscription.channel.payload", "only id-only notifications are sent: set the backport-payload-content extension to id-only");
  if (ch.header) refuse("Subscription.channel.header", "custom headers are not sent; notifications are signed with the secret returned at creation");
  if (body.end) refuse("Subscription.end", "an end date is not honoured; turn the subscription off on the Integrations screen");
  const otherExt = [...(body.extension || []), ...(ch.extension || []), ...(((ch._payload && ch._payload.extension) || []).filter((e) => !e || e.url !== PAYLOAD_CONTENT))];
  if (otherExt.length) refuse("Subscription.extension", `extensions this server does not honour: ${otherExt.map((e) => str(e && e.url)).join(", ")}`);
  if (body.contact) refuse("Subscription.contact", "a contact is not recorded; the administrator who creates it is");
  return issues.length ? { issues } : { url: str(ch.endpoint), eventType, description: str(body.reason) };
}

/**
 * POST Subscription (ward door). ctx: { migration, body, base, actorDeps, recordDeps, resolveHost?, fetchImpl? }
 * Returns { status, obj, headers? }.
 */
async function createSubscription(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { status: 404, obj: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const req = subscriptionRequest(ctx.body);
  if (req.issues) return { status: 422, obj: { resourceType: "OperationOutcome", issue: req.issues } };
  const r = await registerWebhook(request, env, { ...ctx, url: req.url, eventTypes: [req.eventType], description: req.description, payload: PAYLOAD_FHIR });
  if (!r.ok) {
    const code = r.status === 401 ? "login" : r.status === 403 ? "forbidden" : r.status === 409 ? "conflict" : r.status === 422 ? "invalid" : "exception";
    return { status: r.status || 502, obj: operationOutcome("error", code, r.message || r.error || "the subscription was not created") };
  }
  const [sub] = fhirSubscriptions({ id: r.webhook.id, payload: PAYLOAD_FHIR, active: r.webhook.active, status: r.webhook.status, eventTypes: r.webhook.eventTypes, description: r.webhook.description, url: r.webhook.url });
  return { status: 201, obj: sub, headers: { Location: `${str(ctx.base)}/Subscription/${sub.id}`, "X-WardSynQ-Webhook-Secret": r.secret } };
}

export { PAYLOAD_CONTENT, fhirSubscriptions, subscriptions, statusBundle, subscriptionRequest, createSubscription };
