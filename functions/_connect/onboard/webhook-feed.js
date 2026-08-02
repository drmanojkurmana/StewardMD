// functions/_connect/onboard/webhook-feed.js — Self-Service EMR Onboarding: the generic push WEBHOOK path
// (FHIR-push feed). The wizard REGISTERS an inbound feed that a hospital's EMR / integration engine POSTs a
// FHIR R4 Bundle (or a single FHIR resource) to; the ALREADY-BUILT Track-B HMAC-gated ingest spine
// (functions/_connect/ingest.js) verifies the signature + replay-guards, then routes the pushed FHIR through
// the SHIPPED FHIR normalizer (connectors/fhir-push -> normalizeFhir) to SCCM. We only CREATE / LIST / REVOKE
// feeds here; the spine owns ingest.
//
// A feed is a connect_feed row with connector_id = 'fhir-push'. It is IDENTICAL to the HL7 v2 feed except the
// connector kind, the ingest endpoint (/api/connect/ingress/fhir) and the SCCM scope, so it reuses the shared
// feed-core factory verbatim: server-generated 32-byte HMAC secret, envelope-sealed inline (secret_sealed),
// shown ONCE, PHI-free audit, fail-closed RBAC (create/delete connector:write, list connector:read), revoke
// deletes the row (erasing the sealed secret). There is no message-type allow-list (a push is resource-typed).
import { makeFeed } from "./feed-core.js";

// A FHIR-push feed may deliver any SCCM resource type the FHIR normalizer produces. Patient is always present
// (the SCCM bundle requires it); the spine filters anything outside this scope per push (least privilege).
export const FHIR_PUSH_SCOPE = Object.freeze(["Patient", "Encounter", "Condition", "MedicationStatement", "AllergyIntolerance", "Observation", "DiagnosticReport", "DocumentReference"]);

const feed = makeFeed({ kind: "fhir-push", ingestPath: "/api/connect/ingress/fhir", scope: FHIR_PUSH_SCOPE, auditKey: "connect.onboard.webhook-feed" });

// No normMsgTypes -> msg_types persists as [] (a push is typed by each resource's resourceType, not a header).
export const createFeed = feed.createFeed;
export const listFeeds = feed.listFeeds;
export const deleteFeed = feed.deleteFeed;
