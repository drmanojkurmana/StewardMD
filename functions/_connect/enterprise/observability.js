// functions/_connect/enterprise/observability.js — tenant-scoped audit + aggregate metrics (spec §3.6).
// Everything derives from connect_audit_event, which is PHI-free by construction. The tenant filter is
// taken from the RESOLVED membership (tenant.id), never a client-supplied filter that could widen. The
// metrics view additionally strips the per-tenant HMAC pseudonym — aggregates only, no per-row identifiers.
import { requireCan } from "./guard.js";

async function auditRows(db, tenantId) {
  const r = await db.prepare("SELECT * FROM connect_audit_event WHERE tenant_id=?").bind(tenantId).all();
  return r.results || [];
}

export async function readAudit(deps, request, env, tenantId, filter = {}) {
  const { tenant } = await requireCan(deps, request, env, tenantId, "audit:read");
  let rows = await auditRows(deps.db, tenant.id);               // tenant scope from membership, not the client
  if (filter.action) rows = rows.filter((r) => String(r.action) === String(filter.action));
  if (filter.outcome) rows = rows.filter((r) => String(r.outcome) === String(filter.outcome));
  const limit = Math.max(1, Math.min(1000, Number(filter.limit) || 200));
  // Redact the per-row HMAC pseudonym from the auditor view: it is PHI-free-by-construction but still a
  // per-patient correlation handle, and "auditor is read-only, no-PHI". Accountability is preserved by the
  // action/actor/outcome/ts trail. (Owner may opt to expose it for forensic linkage — see docs // VERIFY.)
  return rows.slice(-limit).map((r) => { const { patient_ref_hash, ...rest } = r; return rest; });
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

export async function metrics(deps, request, env, tenantId) {
  const { tenant } = await requireCan(deps, request, env, tenantId, "observability:read");
  const rows = await auditRows(deps.db, tenant.id);
  const byAction = {}, byOutcome = {};
  const lat = [];
  for (const r of rows) {
    const a = String(r.action || "unknown"), o = String(r.outcome || "unknown");
    byAction[a] = (byAction[a] || 0) + 1;
    byOutcome[o] = (byOutcome[o] || 0) + 1;
    const l = Number(r.latency_ms); if (Number.isFinite(l)) lat.push(l);
  }
  lat.sort((x, y) => x - y);
  const allowed = byOutcome.ok || 0, denied = byOutcome.denied || 0;
  return {
    tenantId: tenant.id,
    total: rows.length,
    byAction, byOutcome,
    allowDenyRatio: denied ? Math.round((allowed / denied) * 100) / 100 : null,
    ratelimitBlocks: byAction["ratelimit.block"] || 0,
    latencyP50: pct(lat, 50), latencyP95: pct(lat, 95),
    // NOTE: no patient_ref_hash, no per-row identifiers in the aggregate output.
  };
}
