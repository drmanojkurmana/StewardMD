// functions/_connect/onboard/activity.js — Self-service "Activity log" (security-center-lite): a tenant-scoped,
// PHI-free, client-safe READ of the tenant's own connect_audit_event rows, so a hospital admin can see who
// created/tested/pulled/synced/discovered/mapped which connection, and when -- auditing their own integration
// without contacting us. This ADDS a narrow, bounded read on top of the EXISTING append-only, PHI-free audit
// sink (functions/_connect/audit.js); it writes nothing new.
//
// PRIVACY: mirrors functions/_connect/maik/integration-health.js's tenant-scoping + PHI-exclusion approach
// exactly. The client-safe projection is { action, outcome, connectorId, ts } ONLY -- no actor, no id, no
// tenantId, and NEVER patient_ref_hash / consent_id / transaction_id / care_context_hash / scope /
// resource_counts (those are correlation ids / free-form blobs, not activity-log display fields; the audit
// ALLOW-list in audit.js is why they can never be PHI, but this reader additionally never forwards them by
// KEY). RBAC via connector:read (the SAME read permission the /health endpoint uses) -- fail-closed
// requireCan; tenant is the RESOLVED membership tenant, never the client-supplied id, so there is no
// cross-tenant widening.
import { requireCan } from "../enterprise/guard.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function intOpt(v, dflt, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

// Read a field from either the camelCase audit-event shape or the snake_case D1 row.
function pick(row, camel, snake) {
  if (!row || typeof row !== "object") return undefined;
  if (row[camel] != null) return row[camel];
  if (snake && row[snake] != null) return row[snake];
  return undefined;
}

// A deterministic, wall-clock-free sortable rank for a ts (ISO string or epoch number). Unparseable/missing
// sorts last, so a malformed row never jumps to the top.
function tsRank(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (typeof ts === "string") { const p = Date.parse(ts); if (Number.isFinite(p)) return p; }
  return -Infinity;
}

// The ONLY fields a client ever sees for an activity row. Every other column on connect_audit_event
// (id, tenant_id, actor, patient_ref_hash, resource_counts, scope, consent_id, transaction_id,
// care_context_hash, latency_ms) is structurally dropped here -- never forwarded, even if the row carries it.
function toClientRow(row) {
  return {
    action: pick(row, "action") ?? null,
    outcome: pick(row, "outcome") ?? null,
    connectorId: pick(row, "connectorId", "connector_id") ?? null,
    ts: pick(row, "ts") ?? null,
  };
}

// readTenantActivity(deps, request, env, tenantId, opts) -> { ok:true, events:[...], truncated }.
// Fail-closed RBAC (connector:read); tenant is taken from the RESOLVED membership, never the client-supplied
// id, so there is no cross-tenant widening. If the D1 binding is absent, return an EMPTY list rather than
// throwing -- a missing binding is an ops/config gap, not a security decision (there is no membership to
// resolve, and nothing to leak).
export async function readTenantActivity(deps, request, env, tenantId, opts = {}) {
  if (!deps || !deps.db) return { ok: true, events: [], truncated: false };

  const { tenant } = await requireCan(deps, request, env, tenantId, "connector:read");
  const limit = intOpt(opts.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  // Overfetch by one so truncation can be detected without a second COUNT query. ORDER BY / LIMIT are real
  // D1 semantics; the JS-side sort + slice below is the source of truth (belt-and-suspenders against any
  // driver that returns rows out of order).
  const r = await deps.db.prepare(
    "SELECT * FROM connect_audit_event WHERE tenant_id=? ORDER BY ts DESC LIMIT ?"
  ).bind(tenant.id, limit + 1).all();
  const rows = (r.results || []).filter((row) => String(pick(row, "tenantId", "tenant_id")) === String(tenant.id)); // defense-in-depth tenant re-check

  rows.sort((a, b) => tsRank(pick(b, "ts")) - tsRank(pick(a, "ts")));    // most-recent-first, input-order-independent

  const truncated = rows.length > limit;
  const events = rows.slice(0, limit).map(toClientRow);
  return { ok: true, events, truncated };
}
