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

  _auditStatement(tenantId, e) {
    return this.db.prepare(AUDIT_INSERT).bind(
      e.id || newId(), tenantId, e.ts || new Date().toISOString(), e.actor || null, e.connectorId || "wardsynq",
      e.action || null, JSON.stringify(e.resourceCounts ?? null), JSON.stringify(e.scope ?? null),
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
