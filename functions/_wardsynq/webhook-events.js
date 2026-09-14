/* functions/_wardsynq/webhook-events.js - P2.13: which record writes are webhook events, staged in the write.
 *
 * ONE CHOKE POINT. Every RecordService write, whichever route or feed it came from (ward admit, ED
 * disposition, an HL7 ADT, a FHIR update, a lab release, a verification), reaches the repository through
 * TenantBackend.write() in service.js. That is where this runs: it compares each record with the version
 * before it, and an event it recognises becomes an outbox row IN THE SAME append as the record. The
 * write lands with its event or neither lands, so a refused or failed write never announces anything.
 *
 * NOTHING FOR A HOSPITAL WITH NO WEBHOOK. The endpoint list is read once per service (memoised on the
 * backend); only event types an active endpoint subscribes to are staged. If that read fails the event
 * is staged anyway and the fan-out consumer decides: a missed notification is worse than a spare row.
 *
 * NO PHI. The staged payload is the event type and an opaque id: the SHA-256 form of the canonical id
 * (canonical ids here are built from an MRN, an admission time or a test code). Its alias is written in
 * the same append so the FHIR door resolves it for a receiver holding its own SMART token.
 *
 * Kept apart from webhooks.js so service.js does not import the admin module (which imports
 * documents.js, which imports service.js).
 */

import { outboxEvent } from "./outbox.js";
import { hashedId } from "./fhir-id.js";

const ENDPOINT_TYPE = "_wardsynq_webhook";
const TOPIC_EVENT = "webhook.event";
const MAX_ENDPOINTS = 20;

/** The fixed list a hospital subscribes from. */
const EVENT_TYPES = Object.freeze({
  "encounter.admitted": "Patient admitted",
  "encounter.transferred": "Patient transferred to another ward or bed",
  "encounter.discharged": "Patient discharged",
  "order.placed": "Order placed (medication or investigation)",
  "result.released": "Result released",
  "critical-result.raised": "Critical result raised",
});

const ADMISSION_CLASSES = ["IPD", "ICU", "MATERNITY", "PEDIATRICS", "NICU"];
const OPEN = "in-progress";
const RELEASED = ["preliminary", "final", "corrected", "amended"];
const WATCHED = new Set(["Encounter", "MedicationOrder", "ServiceRequest", "DiagnosticReport", "CriticalResultLoop"]);
const str = (v) => (v == null ? "" : String(v).trim());
const loc = (l) => `${str(l && l.ward).toLowerCase()}|${str(l && l.bed).toLowerCase()}`;

/**
 * PURE. The webhook events one write is, given the version before it (null for a new record).
 * Returns [{ type, resourceType (FHIR), id (canonical) }].
 */
function webhookEventsFor(prev, rec) {
  if (!rec || !WATCHED.has(rec.resourceType)) return [];
  const t = rec.resourceType;
  if (t === "Encounter") {
    if (!ADMISSION_CLASSES.includes(rec.class)) return [];
    const wasOpen = !!prev && prev.status === OPEN && ADMISSION_CLASSES.includes(prev.class);
    const ref = { resourceType: "Encounter", id: rec.id };
    if (rec.status === OPEN && !wasOpen) return [{ type: "encounter.admitted", ...ref }];
    if (rec.status === OPEN && wasOpen && loc(prev.location) !== loc(rec.location)) return [{ type: "encounter.transferred", ...ref }];
    if (rec.status === "finished" && wasOpen) return [{ type: "encounter.discharged", ...ref }];
    return [];
  }
  if (t === "MedicationOrder" || t === "ServiceRequest") {
    return rec.status === "active" && !(prev && prev.status === "active")
      ? [{ type: "order.placed", resourceType: t === "MedicationOrder" ? "MedicationRequest" : "ServiceRequest", id: rec.id }] : [];
  }
  if (t === "DiagnosticReport") {
    // A release, a verification to final and a correction are each news; a re-save of the same status is not.
    return RELEASED.includes(rec.status) && (!prev || prev.status !== rec.status || rec.status === "corrected" || rec.status === "amended")
      ? [{ type: "result.released", resourceType: "DiagnosticReport", id: rec.id }] : [];
  }
  // CriticalResultLoop has no FHIR form; the receiver is pointed at the report the value is on.
  return !prev && rec.state === "open" && str(rec.reportId) ? [{ type: "critical-result.raised", resourceType: "DiagnosticReport", id: str(rec.reportId) }] : [];
}

/** The event types an active endpoint of this hospital subscribes to, or null when that could not be read. */
async function subscribedTypes(repository, tenantId, memo) {
  if (memo && memo.webhookTypes !== undefined) return memo.webhookTypes;
  let types;
  try {
    const rows = await repository.latestByType(tenantId, ENDPOINT_TYPE, MAX_ENDPOINTS * 5);
    types = new Set((rows || []).filter((e) => e && e.active === true).flatMap((e) => e.eventTypes || []));
  } catch { types = null; }
  if (memo) memo.webhookTypes = types;
  return types;
}

/**
 * What to add to one append: { events: outbox rows, aliases: [{hash, resourceType, id}] }.
 * `memo` is the TenantBackend (one per service), so a request with many writes reads the list once.
 */
async function stageWebhookEvents(repository, tenantId, records, memo) {
  const out = { events: [], aliases: [] };
  const watched = (records || []).filter((r) => r && WATCHED.has(r.resourceType));
  if (!watched.length) return out;
  const types = await subscribedTypes(repository, tenantId, memo);
  if (types && !types.size) return out;
  const seen = new Map();
  for (const rec of watched) {
    const key = `${rec.resourceType}|${rec.id}`;
    const prev = seen.has(key) ? seen.get(key) : await repository.latest(tenantId, rec.resourceType, rec.id);
    seen.set(key, rec);
    for (const e of webhookEventsFor(prev, rec)) {
      if (types && !types.has(e.type)) continue;
      const hash = hashedId(e.id);
      const at = new Date().toISOString();
      out.events.push(outboxEvent(TOPIC_EVENT, { type: e.type, occurredAt: at, resource: { resourceType: e.resourceType, id: hash } }, at));
      out.aliases.push({ hash, resourceType: e.resourceType === "MedicationRequest" ? "MedicationOrder" : e.resourceType, id: e.id });
    }
  }
  return out;
}

/* P2.5: an endpoint's payload shape. "wardsynq" is the thin JSON above; "fhir-id-only" makes the same
 * endpoint an R4 backport Subscription (fhir-subscription.js) with one topic per event type. */
const PAYLOAD_FHIR = "fhir-id-only";
const PAYLOADS = Object.freeze(["wardsynq", PAYLOAD_FHIR]);
/** The canonical of the topic an event type is. Ours, in our own namespace. */
const topicFor = (type) => `urn:stewardmd:fhir:SubscriptionTopic:${str(type)}`;
/** One Subscription per (endpoint, event type): R4 backport criteria name exactly one topic. */
const subscriptionIdFor = (endpointId, type) => `${str(endpointId)}.${str(type)}`;

export { ENDPOINT_TYPE, TOPIC_EVENT, MAX_ENDPOINTS, EVENT_TYPES, PAYLOAD_FHIR, PAYLOADS, topicFor, subscriptionIdFor, webhookEventsFor, stageWebhookEvents };
