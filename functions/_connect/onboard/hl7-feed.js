// functions/_connect/onboard/hl7-feed.js — Self-Service EMR Onboarding: the HL7 v2 feed path.
// The wizard REGISTERS an inbound feed that a hospital's integration engine (Mirth/Rhapsody/...) POSTs HL7 v2
// messages to; the ALREADY-BUILT Track-B HMAC-gated ingest spine (functions/_connect/ingest.js) verifies +
// parses + normalizes each message. We only CREATE / LIST / REVOKE feeds here.
//
// This is now a THIN wrapper over the shared feed-core factory (./feed-core.js), which holds the create/list/
// revoke logic identical to the FHIR-push webhook feed: server-generated 32-byte HMAC secret, envelope-sealed
// inline (secret_sealed), shown ONCE, PHI-free audit, fail-closed RBAC (create/delete connector:write, list
// connector:read), revoke deletes the row (erasing the sealed secret). The only HL7-specifics kept here are
// the connector kind ('hl7v2'), the ingest endpoint (/api/connect/ingress/hl7), the SCCM scope, and the
// optional advisory HL7 message-type allow-list. The public API (createFeed/listFeeds/deleteFeed +
// HL7_FEED_SCOPE/FEED_HEADERS) is UNCHANGED.
import { makeFeed, FEED_HEADERS } from "./feed-core.js";
import { OnboardError } from "./errors.js";

export { FEED_HEADERS };
// The SCCM scope an HL7 v2 event feed may deliver (Patient always; ORU=Observation/DiagnosticReport,
// ADT=Encounter/Condition, MDM=DocumentReference, ...). The spine filters anything outside this per message.
export const HL7_FEED_SCOPE = Object.freeze(["Patient", "Encounter", "Condition", "MedicationStatement", "AllergyIntolerance", "Observation", "DiagnosticReport", "DocumentReference"]);

const feed = makeFeed({ kind: "hl7v2", ingestPath: "/api/connect/ingress/hl7", scope: HL7_FEED_SCOPE, auditKey: "connect.onboard.hl7-feed" });

const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
// Optional allow-list of message types, e.g. ["ORU^R01","ADT^A01"]. Stored as documentation/config; validated
// but not required. (The spine authenticates by HMAC; message-type policy is advisory today.)
function normMsgTypes(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new OnboardError("invalid", "allowedMessageTypes must be an array");
  const out = [];
  for (const t of v) {
    if (!nonEmpty(t)) throw new OnboardError("invalid", "allowedMessageTypes entries must be non-empty strings");
    out.push(String(t).trim().toUpperCase());
  }
  return out.slice(0, 64); // hard cap
}

export const createFeed = (deps, request, env, tenantId, body = {}) => feed.createFeed(deps, request, env, tenantId, body, normMsgTypes);
export const listFeeds = feed.listFeeds;
export const deleteFeed = feed.deleteFeed;
