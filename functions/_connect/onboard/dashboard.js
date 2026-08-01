// functions/_connect/onboard/dashboard.js — Self-Service EMR Onboarding, Part 3 (Enterprise): the unified
// Connections view. This aggregates a tenant's onboarded FHIR connections AND its HL7 v2 feeds into one
// payload so the admin Connections dashboard can render them together in a single table.
//
// It REUSES the already-shipped, already-tested list functions verbatim — listConnections (store.js) and
// listFeeds (hl7-feed.js) — so it inherits their guarantees with ZERO forking:
//   • server-derived identity + fail-closed RBAC (both call requireCan(..., "connector:read")),
//   • tenant scoping (both query WHERE tenant_id = <the resolved tenant the actor is a member of>), so a
//     member of tenant A asking for tenant B is denied by resolveTenant (no IDOR / cross-tenant leak), and
//   • the client-safe projections safeView / safeFeedView, which NEVER return sealed credential material.
// We add NOTHING to the wire beyond what those projections already expose (type/status/lastTest for FHIR;
// feed id/status for HL7) — no faked telemetry. A non-member / unauthenticated caller throws (fail-closed).
import { listConnections } from "./store.js";
import { listFeeds } from "./hl7-feed.js";

// Returns { fhir:[...safeView], hl7:[...safeFeedView], counts:{ fhir, hl7, total } } for the selected tenant.
// Both sub-calls independently enforce auth + RBAC + tenant membership; if either denies, this rejects.
export async function listAll(deps, request, env, tenantId) {
  const fhir = await listConnections(deps, request, env, tenantId);   // requireCan connector:read + tenant-scoped
  const hl7 = await listFeeds(deps, request, env, tenantId);          // requireCan connector:read + tenant-scoped
  return { fhir, hl7, counts: { fhir: fhir.length, hl7: hl7.length, total: fhir.length + hl7.length } };
}
