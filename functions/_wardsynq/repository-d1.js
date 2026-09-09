/* functions/_wardsynq/repository-d1.js — the Cloudflare D1 implementation of the persistence port.
 *
 * Schema: functions/db/wardsynq_schema.sql. Tenancy and the audit trail reuse the existing
 * stewardmd-connect tables (connect_tenant, connect_membership, connect_audit_event); the record
 * itself lives in wardsynq_record and the retry table in wardsynq_idempotency.
 *
 * No UPDATE, no DELETE. The one write is a D1 batch (atomic) of INSERTs: the record versions, the
 * idempotency key and the audit event land together or not at all. A UNIQUE violation on
 * (tenant, type, id, version) surfaces as VersionConflictError, which is how a lost race is
 * reported instead of being overwritten.
 *
 * This file is the ONLY place that knows these table names. A hospital-local database is a sibling
 * file implementing the same eight methods against its own engine.
 */

import { VersionConflictError, RepositoryError, rowOf } from "./repository.js";
import { scrubPhi } from "../_connect/abdm/no-phi.js";

const AUDIT_INSERT = "INSERT INTO connect_audit_event (id,tenant_id,ts,actor,connector_id,action,resource_counts,scope,patient_ref_hash,latency_ms,outcome,consent_id,transaction_id,care_context_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

function parseBody(row) {
  if (!row) return null;
  try { return JSON.parse(row.body); } catch { throw new RepositoryError("a stored record could not be parsed", "CORRUPT_ROW"); }
}

function isUniqueViolation(err) {
  const m = String((err && err.message) || err || "");
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(m);
}

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
}

/* TASK 9.6. An audit value is metadata, and metadata is short. A client-controlled header with no
 * length bound is a storage-exhaustion primitive against an append-only table nothing can prune, so
 * every string is clipped before it is scanned. The clip is VISIBLE - a silently truncated identifier
 * that still looks like an identifier is worse than one that says it was cut. */
const AUDIT_STRING_MAX = 512;

/* SCRUB THE LEAVES, NEVER THE CONTAINER, AND THE REASON IS SPECIFIC.
 *
 * scrubPhi() redacts any OBJECT carrying a `resourceType` key wholesale, because on the ABDM path
 * such an object is a decrypted FHIR resource that somebody dumped into a free-form blob. WardSynQ's
 * audit scope legitimately looks like that: `{resourceType: "Patient", id: "pat-2", version: 3}` is
 * not a patient, it is the METADATA saying which record was written. Handing the whole scope to
 * scrubPhi therefore replaced every audit scope in the system with "[REDACTED]" - trading a
 * contamination bug for an audit-blinding one, which is the worse of the two. Caught by the test
 * that asserts a legitimate correlation id survives.
 *
 * So the walk is done here and scrubPhi is applied only to STRING LEAVES, where its value-shape
 * detection is exactly what is wanted and its container rule cannot fire. A decrypted resource
 * smuggled into this blob still has each of its own leaves scanned - a name, a mobile, an ABHA are
 * all caught individually - which is weaker than wholesale redaction and is the deliberate trade for
 * having an audit trail that still says what happened. */
function scrubLeaves(value, depth = 0) {
  if (depth > 8) return "[REDACTED]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return scrubPhi(value);
  if (Array.isArray(value)) return value.map((v) => scrubLeaves(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = scrubLeaves(value[k], depth + 1);
    return out;
  }
  return value;
}

function bounded(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length <= AUDIT_STRING_MAX ? value : `${value.slice(0, AUDIT_STRING_MAX)}…[TRUNCATED ${value.length} chars]`;
  }
  if (Array.isArray(value)) return value.slice(0, 64).map((v) => bounded(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).slice(0, 64)) out[k] = bounded(value[k], depth + 1);
    return out;
  }
  return value;
}

class D1Repository {
  /** @param {object} db  a D1 binding (env.CONNECT_DB) */
  constructor(db) {
    if (!db || typeof db.prepare !== "function") throw new RepositoryError("D1Repository needs a D1 binding", "NO_DB");
    this.db = db;
  }

  async latest(tenantId, resourceType, id) {
    const row = await this.db
      .prepare("SELECT body FROM wardsynq_record WHERE tenant_id=? AND resource_type=? AND id=? ORDER BY version DESC LIMIT 1")
      .bind(tenantId, resourceType, id).first();
    return parseBody(row);
  }

  async history(tenantId, resourceType, id) {
    const r = await this.db
      .prepare("SELECT body FROM wardsynq_record WHERE tenant_id=? AND resource_type=? AND id=? ORDER BY version ASC")
      .bind(tenantId, resourceType, id).all();
    return (r.results || []).map(parseBody);
  }

  async byPatient(tenantId, resourceType, patientId) {
    // Latest version per id, decided in SQL so a chart with thousands of observations is not
    // shipped to the worker to be reduced there.
    const r = await this.db
      .prepare(
        "SELECT r.body FROM wardsynq_record r " +
        "JOIN (SELECT id, MAX(version) AS v FROM wardsynq_record WHERE tenant_id=? AND resource_type=? AND patient_id=? GROUP BY id) m " +
        "ON m.id = r.id AND m.v = r.version WHERE r.tenant_id=? AND r.resource_type=? ORDER BY r.seq ASC"
      )
      .bind(tenantId, resourceType, patientId, tenantId, resourceType).all();
    return (r.results || []).map(parseBody);
  }

  async latestByType(tenantId, resourceType, limit) {
    const max = Math.max(1, Math.min(200, Number(limit) || 100));
    const r = await this.db
      .prepare(
        "SELECT r.body FROM wardsynq_record r " +
        "JOIN (SELECT id, MAX(version) AS v FROM wardsynq_record WHERE tenant_id=? AND resource_type=? GROUP BY id) m " +
        "ON m.id = r.id AND m.v = r.version WHERE r.tenant_id=? AND r.resource_type=? ORDER BY r.seq ASC LIMIT ?"
      )
      .bind(tenantId, resourceType, tenantId, resourceType, max).all();
    return (r.results || []).map(parseBody);
  }

  /**
   * TASK 9.6. The audit INSERT, with the same two guards the OTHER writer of this table already had.
   *
   * `connect_audit_event` is documented "append-only; metadata only, NO PHI" and has two writers.
   * functions/_connect/audit.js allow-lists the KEYS and then value-scans the free-form blobs with
   * scrubPhi, and its own comment explains why both are needed: allow-listing keys does not stop PHI
   * hidden inside a VALUE. This writer did neither.
   *
   * THE ROUTE THAT MATTERED WAS NOT A CARELESS CALLER, IT WAS A HEADER. actor.js's requestContextOf()
   * reads `X-Correlation-Id` and `X-Device-Id` straight off the request, service.js's _audit() folds
   * them into `scope.request`, and they arrived here untouched - client-controlled, unbounded strings
   * landing in an append-only table with no DELETE path anywhere in this repository. That is not an
   * exfiltration route, since the attacker already knows what they sent; it is a CONTAMINATION route,
   * and the damage is that a store the hospital has told a regulator holds no patient data quietly
   * holds some, permanently.
   *
   * REDACTED, NOT DROPPED. A row that silently loses its correlation id is harder to reason about
   * than one that says the value was refused, so a PHI-shaped value becomes "[REDACTED]" in place.
   */
  /**
   * TASK 9.16. Does the storage this service claims to have actually answer?
   *
   * It reads the RECORD TABLE, not the connection. The failure this exists for is not "the database
   * is down" - Cloudflare will tell you that - it is "the database is up and the schema was never
   * applied", which is what happened on 2026-09-07 and which a connection check reports as healthy.
   * A `SELECT ... LIMIT 0` touches the table definition and no rows, so it costs nothing and still
   * fails loudly when the table is not there.
   */
  async probe() {
    const started = Date.now();
    try {
      await this.db.prepare("SELECT tenant_id FROM wardsynq_record LIMIT 0").all();
      await this.db.prepare("SELECT id FROM connect_audit_event LIMIT 0").all();
      return { ok: true, backend: "d1", ms: Date.now() - started };
    } catch (err) {
      /* The CATEGORY, never the driver's message. This endpoint is reachable without a tenant, so a
       * raw SQL error here would hand an unauthenticated caller the schema. "The record table could
       * not be read" is what an operator needs and all they need. */
      const missing = /no such table|does not exist/i.test(String((err && err.message) || ""));
      return {
        ok: false, backend: "d1", ms: Date.now() - started,
        detail: missing
          ? "the record schema is not present on this database - it has not been applied"
          : "the record store could not be queried",
      };
    }
  }

  _auditStatement(tenantId, e) {
    const safe = scrubLeaves(bounded(e.scope ?? null));
    const counts = scrubLeaves(bounded(e.resourceCounts ?? null));
    return this.db.prepare(AUDIT_INSERT).bind(
      e.id || newId(), tenantId, e.ts || new Date().toISOString(), e.actor || null, e.connectorId || "wardsynq",
      e.action || null, JSON.stringify(counts), JSON.stringify(safe),
      e.patientRefHash || null, e.latencyMs ?? null, e.outcome || null, null, null, null
    );
  }

  async append(tenantId, records, ctx) {
    ctx = ctx || {};
    if (!records || !records.length) return { seq: null };
    const stmts = [];
    for (const rec of records) {
      const row = rowOf(tenantId, rec);
      stmts.push(this.db
        .prepare("INSERT INTO wardsynq_record (tenant_id,resource_type,id,version,patient_id,recorded_at,effective_at,actor_id,actor_kind,body) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(row.tenantId, row.resourceType, row.id, row.version, row.patientId, row.recordedAt, row.effectiveAt, row.actorId, row.actorKind, JSON.stringify(row.body)));
    }
    if (ctx.idempotencyKey) {
      const r = records[records.length - 1];
      stmts.push(this.db
        .prepare("INSERT INTO wardsynq_idempotency (tenant_id,key,resource_type,id,version,created_at) VALUES (?,?,?,?,?,?)")
        .bind(tenantId, ctx.idempotencyKey, r.resourceType, r.id, r.version, new Date().toISOString()));
    }
    if (ctx.audit) stmts.push(this._auditStatement(tenantId, ctx.audit));

    let results;
    try {
      results = await this.db.batch(stmts);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new VersionConflictError("another client wrote this version first", { records: records.map((r) => ({ resourceType: r.resourceType, id: r.id, version: r.version })) });
      }
      throw err;
    }
    // D1 batch is atomic: either every statement succeeded or the batch threw.
    const last = results && results[records.length - 1];
    const seq = last && last.meta && typeof last.meta.last_row_id === "number" ? last.meta.last_row_id : null;
    return { seq };
  }

  async changes(tenantId, sinceSeq, limit) {
    const since = Number(sinceSeq) || 0;
    const max = Math.max(1, Math.min(500, Number(limit) || 100));
    const r = await this.db
      .prepare("SELECT seq, body FROM wardsynq_record WHERE tenant_id=? AND seq>? ORDER BY seq ASC LIMIT ?")
      .bind(tenantId, since, max).all();
    const rows = r.results || [];
    return {
      records: rows.map((row) => ({ seq: row.seq, ...parseBody(row) })),
      cursor: rows.length ? rows[rows.length - 1].seq : since,
    };
  }

  async recall(tenantId, idempotencyKey) {
    const row = await this.db
      .prepare("SELECT resource_type, id, version FROM wardsynq_idempotency WHERE tenant_id=? AND key=?")
      .bind(tenantId, idempotencyKey).first();
    return row ? { resourceType: row.resource_type, id: row.id, version: row.version } : null;
  }

  async auditOnly(tenantId, event) {
    await this._auditStatement(tenantId, event).run();
  }
}

export { D1Repository };
