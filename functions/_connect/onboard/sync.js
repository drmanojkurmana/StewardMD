// functions/_connect/onboard/sync.js — Automatic sync scheduler for a self-service FHIR pull connection.
// NO schema change: the schedule lives IN the existing connect_connector_config.config JSON blob as two new
// keys, config.syncIntervalMin (0/absent = OFF) and config.lastSyncAt (ISO string, last time this connection
// was refreshed) — same row, same column, mirroring how config.lastTest already lives there (store.js).
//
// DESIGN DECISION — what a scheduled sync refreshes: pullConnection(deps, request, env, tenantId,
// connectionId, patientId) requires BOTH a real authenticated actor (requireCan "connector:read", derived from
// a request) AND a specific patientId to fetch. A cron sweep has neither: it is a system trigger with no
// clinician request behind it, and this store has no concept of a per-connection patient roster/cohort (adding
// one would be a schema change, out of scope). Fabricating a patientId list was explicitly ruled out. So
// runDueSyncs does NOT call pullConnection; it re-runs the SAME capability probe the manual "Test" button uses
// (probe.js's runProbe + store.js's recordTest) — the honest, minimal, generically-useful thing a connection
// can refresh unattended for ANY onboarded FHIR connection: proving the endpoint is still reachable and
// authenticating, and refreshing config.lastTest/status so a silently-broken EMR link surfaces on the
// dashboard without a human clicking Test. A whole-population data pull stays a deliberate, RBAC'd, per-patient
// action (pullConnection, unchanged) — this increment only automates the reachability/capability heartbeat.
import { requireCan } from "../enterprise/guard.js";
import { makeAuditSink } from "../audit.js";
import { OnboardError } from "./errors.js";
import { getRow, recordTest, safeView } from "./store.js";
import { runProbe } from "./probe.js";

const SYNC_MIN_INTERVAL_MIN = 15;      // a sane floor — no connection may be polled more than every 15 min
const SYNC_MAX_INTERVAL_MIN = 10080;   // 7 days — a sane ceiling (weekly heartbeat is still "automatic")

// 0/absent => 0 (sync OFF). Throws OnboardError("invalid", ...) for anything else out of bounds.
function validateIntervalMin(raw) {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0)
    throw new OnboardError("invalid", "intervalMin must be a non-negative integer");
  if (raw === 0) return 0;
  if (raw < SYNC_MIN_INTERVAL_MIN || raw > SYNC_MAX_INTERVAL_MIN)
    throw new OnboardError("invalid", "intervalMin must be 0 (off) or between " + SYNC_MIN_INTERVAL_MIN + " and " + SYNC_MAX_INTERVAL_MIN);
  return raw;
}

// Endpoint: RBAC-gated (connector:write — same action save/delete use; scheduling is a config-write, not a
// read/pull). Persists config.syncIntervalMin only; config.lastSyncAt is left untouched. PHI-free audit.
export async function setSyncConfig(deps, request, env, tenantId, connectionId, body = {}) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:write");
  const { row, config } = await getRow(deps.db, tenant.id, connectionId);
  const intervalMin = validateIntervalMin(body.intervalMin);
  config.syncIntervalMin = intervalMin;
  config.updatedAt = new Date().toISOString();
  await deps.db.prepare("UPDATE connect_connector_config SET config=? WHERE tenant_id=? AND connector_id=?")
    .bind(JSON.stringify(config), tenant.id, connectionId).run();
  await makeAuditSink(env, deps.db)({ tenantId: tenant.id, actor: actor.id, connectorId: connectionId, action: "connect.onboard.sync_configured", outcome: "ok", ts: new Date().toISOString() });
  return safeView(Object.assign({}, row, { config: JSON.stringify(config) }));
}

// Pure helper (unit-tested standalone): is this row due for an automatic sync right now?
// due <=> syncIntervalMin > 0 AND (never synced OR interval elapsed) AND status is active/draft
// (a "revoked"/other status connection is never auto-synced, even if it still carries an interval).
export function isDue(row, now) {
  let config = {}; try { config = JSON.parse((row && row.config) || "{}"); } catch {}
  const interval = Number(config.syncIntervalMin) || 0;
  if (!(interval > 0)) return false;
  const status = (row && row.status) || "draft";
  if (status !== "active" && status !== "draft") return false;
  if (!config.lastSyncAt) return true;
  const last = Date.parse(config.lastSyncAt);
  if (!Number.isFinite(last)) return true;         // corrupt timestamp -> treat as never synced (fail toward due)
  return (Number(now) - last) >= interval * 60000;
}

function lastSyncAtMs(row) {
  try { const c = JSON.parse(row.config || "{}"); return c.lastSyncAt ? Date.parse(c.lastSyncAt) : -Infinity; }
  catch { return -Infinity; }
}

// Re-run the capability probe for one onboarded connection (system-triggered: no request/actor to RBAC-check —
// the ONLY gate on this whole batch is the caller endpoint's admin-token check). Returns the probe result;
// throws only on an infra fault (D1/secrets), which the caller catches per-item.
async function refreshOne(deps, tenantId, connectionId) {
  const { row, config } = await getRow(deps.db, tenantId, connectionId);
  let creds = {}; try { creds = JSON.parse(await deps.secrets.open(config.sealed)); } catch { creds = {}; }
  const result = await runProbe(deps, row.base_url, config, creds);
  await recordTest(deps, tenantId, connectionId, result);
  return result;
}

// Endpoint (cron-only, admin-token-gated by the caller route — NOT RBAC): enumerate every onboarded FHIR pull
// connection across ALL tenants, run the due ones (oldest lastSyncAt / never-synced first, bounded by `max`),
// and PHI-freely record the outcome. A single connection's failure is caught and recorded; it NEVER aborts the
// batch, and config.lastSyncAt is stamped regardless of outcome so a persistently-failing connection is not
// retried every tick (it just waits out its own interval like everything else — no hot-loop).
export async function runDueSyncs(deps, env, now, { max = 25 } = {}) {
  const r = await deps.db.prepare("SELECT * FROM connect_connector_config").all();
  const rows = (r.results || []).filter((row) => {
    try { return JSON.parse(row.config || "{}").source === "onboard"; } catch { return false; }
  });
  const due = rows.filter((row) => isDue(row, now));
  due.sort((a, b) => lastSyncAtMs(a) - lastSyncAtMs(b));           // never-synced (-Infinity) sorts first
  const batch = due.slice(0, Math.max(0, max));

  let errors = 0;
  for (const row of batch) {
    const tenantId = row.tenant_id, connectionId = row.connector_id;
    let outcome = "ok";
    try {
      const result = await refreshOne(deps, tenantId, connectionId);
      if (!result || !result.ok) outcome = "error";
    } catch (e) {
      outcome = "error";
    }
    if (outcome === "error") errors++;

    // Always stamp lastSyncAt — success or failure — so a broken connection cools down for its own interval.
    try {
      const { config } = await getRow(deps.db, tenantId, connectionId);
      config.lastSyncAt = new Date(Number(now)).toISOString();
      await deps.db.prepare("UPDATE connect_connector_config SET config=? WHERE tenant_id=? AND connector_id=?")
        .bind(JSON.stringify(config), tenantId, connectionId).run();
    } catch (e) { /* best-effort stamp; must not abort the batch */ }

    // PHI-free: connectorId + outcome only — no bundle, no counts, no patient reference, no error message.
    try {
      await makeAuditSink(env, deps.db)({ tenantId, connectorId: connectionId, action: "connect.onboard.synced", outcome, ts: new Date(Number(now)).toISOString() });
    } catch (e) { /* audit best-effort */ }
  }
  return { ok: true, due: due.length, ran: batch.length, errors };
}
