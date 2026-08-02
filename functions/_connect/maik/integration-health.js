// functions/_connect/maik/integration-health.js — Part 4: Enterprise Integration-Health Analytics.
//
// Aggregate the PHI-free Connect audit trail (connect_audit_event) into OPERATIONAL health metrics so an
// admin can see which integrations are healthy: per-connector success/failure rates, per-action outcome
// counts, an overall roll-up, the most-recent failures, and warning/unmapped signal counts.
//
// HARD PRIVACY BOUNDARY (spec + the audit ALLOW-list in functions/_connect/audit.js): analytics must NOT
// train on or expose patient data. The audit event is PHI-free BY CONSTRUCTION, but this layer is
// additionally DISCIPLINED to read ONLY the operational fields — action, connectorId, tenantId, outcome,
// resourceCounts (numeric warning/unmapped signals only), scope.reason (a short non-PHI code, defensively
// re-checked), ts. It NEVER reads or emits patientRefHash / careContextHash / consentId / transactionId
// (those are per-event correlation ids, not health metrics). Output is COUNTS + IDS + TIMESTAMPS + short
// outcome/reason CODES only.
//
// computeIntegrationHealth is PURE, DETERMINISTIC, NO WALL CLOCK, NO RANDOMNESS, NO NETWORK, NO LLM. It is
// bounded (input sliced to a cap before aggregating) and NEVER throws (empty/malformed input => safe zero
// result). readTenantIntegrationHealth is the thin, tenant-scoped, fail-closed DB reader used by the
// /api/connect/onboard/health endpoint; the pure core above has no dependencies.

import { requireCan } from "../enterprise/guard.js";

const DEFAULT_MAX_EVENTS = 5000;   // aggregate at most this many events (bound work; endpoint also LIMITs)
const DEFAULT_MAX_RECENT = 20;     // recentFailures cap
const OK_OUTCOMES = new Set(["ok", "success", "accepted"]);   // everything else non-empty => a failure signal

// ---- tiny, defensive helpers (never throw) -----------------------------------------------------------------

function asArray(x) { return Array.isArray(x) ? x : []; }
function intOpt(v, dflt, lo, hi) { const n = Number(v); if (!Number.isFinite(n)) return dflt; return Math.max(lo, Math.min(hi, Math.trunc(n))); }

// Read a field from either the camelCase audit-event shape (buildAuditEvent output) or the snake_case D1 row.
function pick(e, camel, snake) {
  if (!e || typeof e !== "object") return undefined;
  if (e[camel] != null) return e[camel];
  if (snake && e[snake] != null) return e[snake];
  return undefined;
}
// resourceCounts / scope arrive as an object (in-process event) or a JSON string (D1 column). Parse safely.
function asObject(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") { try { const o = JSON.parse(v); return o && typeof o === "object" ? o : null; } catch { return null; } }
  return null;
}
function nonNegNum(o, k) { const v = o && o[k]; return (typeof v === "number" && Number.isFinite(v) && v >= 0) ? v : 0; }

// A deterministic, wall-clock-free sortable rank for a ts (ISO string or epoch number). Date.parse of a GIVEN
// string is a pure parse, not a clock read. Unparseable/missing => sorts last.
function tsRank(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (typeof ts === "string") { const p = Date.parse(ts); if (Number.isFinite(p)) return p; }
  return -Infinity;
}

// ok | failed | unknown. "ok"/"success"/"accepted" => ok; empty/missing => unknown; any other value => failed.
function classify(outcome) {
  if (outcome == null) return "unknown";
  const s = String(outcome).trim().toLowerCase();
  if (!s) return "unknown";
  return OK_OUTCOMES.has(s) ? "ok" : "failed";
}

// scope.reason may accompany a denial/error. Emit it ONLY if it is a short, code-shaped, non-PHI-looking
// string. This blocks anything hash-shaped (patientRefHash is 64 hex chars), an email/free text, or an
// over-long value. The audit already redacts; this is defense-in-depth so nothing PHI-shaped can surface.
function safeReason(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return undefined;
  const r = scope.reason;
  if (typeof r !== "string") return undefined;
  const v = r.trim();
  if (!v || v.length > 40) return undefined;             // too long => could be free text / PHI
  if (/^[0-9a-f]{16,}$/i.test(v)) return undefined;      // hash/token/pseudonym shaped => never emit
  if (!/^[a-z0-9][a-z0-9 ._-]*$/i.test(v)) return undefined; // reason-CODE charset only (no @, /, etc.)
  return v;
}

function emptyResult() {
  return {
    perConnector: [],
    perAction: {},
    overall: { totalEvents: 0, okRate: 0, failedCount: 0, activeConnectors: 0 },
    recentFailures: [],
    warnings: { total: 0, warnings: 0, unmapped: 0 },
    generatedFromCount: 0,
  };
}

// ---- pure core --------------------------------------------------------------------------------------------

// computeIntegrationHealth(auditEvents, opts) -> health roll-up. opts: { maxEvents (5000), maxRecent (20) }.
export function computeIntegrationHealth(auditEvents, opts = {}) {
  try {
    const o = opts && typeof opts === "object" ? opts : {};
    const cap = intOpt(o.maxEvents, DEFAULT_MAX_EVENTS, 1, 20000);
    const maxRecent = intOpt(o.maxRecent, DEFAULT_MAX_RECENT, 0, 500);
    const events = asArray(auditEvents).slice(0, cap);     // bound BEFORE aggregating
    if (!events.length) return emptyResult();

    const conn = new Map();      // connectorId -> accumulator
    const perAction = {};
    const failures = [];         // {action, connectorId, outcome, reason?, ts, _rank}
    let counted = 0, okCount = 0, failedCount = 0;
    let warnWarnings = 0, warnUnmapped = 0;

    for (const e of events) {
      if (!e || typeof e !== "object") continue;
      const connectorId = pick(e, "connectorId", "connector_id");
      const action = pick(e, "action");
      const outcomeRaw = pick(e, "outcome");
      // Skip a row with NO operational identity at all (malformed / noise) so it never conjures a phantom
      // "unknown" bucket. Real audit events always carry action + outcome + connectorId.
      const hasField = (v) => v != null && String(v) !== "";
      if (!hasField(connectorId) && !hasField(action) && !hasField(outcomeRaw)) continue;
      counted += 1;
      const cid = hasField(connectorId) ? String(connectorId) : "unknown";
      const act = hasField(action) ? String(action) : "unknown";
      const outcome = hasField(outcomeRaw) ? String(outcomeRaw) : "unknown";
      const cls = classify(outcomeRaw);
      const ts = pick(e, "ts");
      const rc = asObject(pick(e, "resourceCounts", "resource_counts"));
      const warnN = nonNegNum(rc, "warnings");
      const unmapN = nonNegNum(rc, "unmapped");
      warnWarnings += warnN; warnUnmapped += unmapN;

      // per-connector
      let c = conn.get(cid);
      if (!c) { c = { connectorId: cid, total: 0, ok: 0, failed: 0, warningCount: 0, lastOutcome: null, lastTs: null, _lastRank: -Infinity }; conn.set(cid, c); }
      c.total += 1;
      if (cls === "ok") c.ok += 1; else if (cls === "failed") c.failed += 1;
      c.warningCount += warnN + unmapN;
      const rank = tsRank(ts);
      if (rank >= c._lastRank) { c._lastRank = rank; c.lastOutcome = outcome; c.lastTs = ts != null ? ts : null; } // latest wins ties (deterministic per input)

      // per-action outcome counts
      let a = perAction[act];
      if (!a) { a = { total: 0, byOutcome: {} }; perAction[act] = a; }
      a.total += 1;
      a.byOutcome[outcome] = (a.byOutcome[outcome] || 0) + 1;

      // overall
      if (cls === "ok") okCount += 1; else if (cls === "failed") failedCount += 1;

      // recent failures
      if (cls === "failed") {
        const item = { action: act, connectorId: cid, outcome, ts: ts != null ? ts : null, _rank: rank };
        const reason = safeReason(asObject(pick(e, "scope")));
        if (reason !== undefined) item.reason = reason;
        failures.push(item);
      }
    }

    // perConnector: finalize failureRate; sort by failureRate desc, then connectorId asc (deterministic).
    const perConnector = [...conn.values()].map((c) => ({
      connectorId: c.connectorId,
      total: c.total,
      ok: c.ok,
      failed: c.failed,
      failureRate: c.total ? c.failed / c.total : 0,
      warningCount: c.warningCount,
      lastOutcome: c.lastOutcome,
      lastTs: c.lastTs,
    })).sort((x, y) => (y.failureRate - x.failureRate) || (x.connectorId < y.connectorId ? -1 : x.connectorId > y.connectorId ? 1 : 0));

    // recentFailures: ts desc, then connectorId asc, then action asc (input-order-independent). Strip _rank.
    failures.sort((x, y) => (y._rank - x._rank)
      || (x.connectorId < y.connectorId ? -1 : x.connectorId > y.connectorId ? 1 : 0)
      || (x.action < y.action ? -1 : x.action > y.action ? 1 : 0));
    const recentFailures = failures.slice(0, maxRecent).map((f) => { const { _rank, ...rest } = f; return rest; });

    // perAction: emit with canonically-sorted action keys + sorted outcome keys so the whole result is
    // order-independent (shuffled input => byte-identical output).
    const perActionOut = {};
    for (const k of Object.keys(perAction).sort()) {
      const a = perAction[k];
      const bo = {};
      for (const oc of Object.keys(a.byOutcome).sort()) bo[oc] = a.byOutcome[oc];
      perActionOut[k] = { total: a.total, byOutcome: bo };
    }

    const totalEvents = counted;
    return {
      perConnector,
      perAction: perActionOut,
      overall: {
        totalEvents,
        okRate: totalEvents ? okCount / totalEvents : 0,
        failedCount,
        activeConnectors: conn.size,
      },
      recentFailures,
      warnings: { total: warnWarnings + warnUnmapped, warnings: warnWarnings, unmapped: warnUnmapped },
      generatedFromCount: counted,
    };
  } catch {
    return emptyResult();          // belt-and-suspenders: never throw
  }
}

// ---- thin, tenant-scoped DB reader (used by the onboard/health endpoint) -----------------------------------

const READ_LIMIT = 1000;   // bound: at most this many rows
const WINDOW_DAYS = 7;     // bound: last N days

// readTenantIntegrationHealth(deps, request, env, tenantId, opts) -> computeIntegrationHealth(rows).
// Fail-closed RBAC via requireCan (connector:read); tenant is taken from the RESOLVED membership, never the
// client-supplied id, so there is no cross-tenant widening. PHI-free by the pure core above.
export async function readTenantIntegrationHealth(deps, request, env, tenantId, opts = {}) {
  const { tenant } = await requireCan(deps, request, env, tenantId, "connector:read");
  const limit = intOpt(opts.limit, READ_LIMIT, 1, 5000);
  const days = intOpt(opts.windowDays, WINDOW_DAYS, 1, 90);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();   // endpoint may use the clock; the pure core does not
  const r = await deps.db.prepare(
    "SELECT * FROM connect_audit_event WHERE tenant_id=? AND ts>=? ORDER BY ts DESC LIMIT ?"
  ).bind(tenant.id, cutoff, limit).all();
  const rows = (r.results || []).filter((row) => String(row.tenant_id) === String(tenant.id));  // defense-in-depth tenant re-check
  return computeIntegrationHealth(rows, opts);
}
