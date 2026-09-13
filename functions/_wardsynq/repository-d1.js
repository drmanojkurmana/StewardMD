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

import { VersionConflictError, IdentityConflictError, RepositoryError, rowOf, rosterLimit } from "./repository.js";
import { patientIdentifierKeys } from "./identity-key.js";
import { fhirId } from "./fhir-id.js";

/** PURE. The published hashed form of a record id, or null when it is published verbatim. */
function aliasFor(record) {
  const id = record && typeof record.id === "string" ? record.id : "";
  if (!id) return null;
  const published = fhirId(id);
  return published && published !== id ? published : null;
}
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

/* Which table lost. A batch carries both the record insert and the identity-index insert, and the
 * two failures mean completely different things to the caller - "read again and retry" versus "this
 * number belongs to someone else, go and look at who" - so they must not arrive as one error. */
function isIdentityViolation(err) {
  return isUniqueViolation(err) && /wardsynq_patient_identifier/i.test(String((err && err.message) || err || ""));
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
    const max = rosterLimit(limit);
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

  /**
   * INTERNAL. Who currently holds each of these identifiers, as `${systemKey}|${valueNorm}` -> patientId.
   * One statement, one index seek per key, bounded by the identifiers on the patient in hand.
   */
  async _identifierOwners(tenantId, keys) {
    const out = new Map();
    const list = (keys || []).filter((k) => k && k.systemKey && k.valueNorm);
    if (!list.length) return out;
    const where = list.map(() => "(system_key=? AND value_norm=?)").join(" OR ");
    const binds = [tenantId];
    for (const k of list) binds.push(k.systemKey, k.valueNorm);
    const r = await this.db
      .prepare(`SELECT system_key, value_norm, patient_id FROM wardsynq_patient_identifier WHERE tenant_id=? AND (${where})`)
      .bind(...binds).all();
    for (const row of r.results || []) out.set(`${row.system_key}|${row.value_norm}`, row.patient_id);
    return out;
  }

  /**
   * Every local Patient carrying any of these identifiers. INDEX SEEK, never a scan: the cost is the
   * number of identifiers offered, not the number of patients the hospital holds. Tenant-scoped by
   * the leading column of the primary key, so an identifier can never match across hospitals.
   */
  async patientsByIdentifier(tenantId, keys) {
    const owners = await this._identifierOwners(tenantId, keys);
    const ids = [...new Set(owners.values())];
    if (!ids.length) return [];
    const marks = ids.map(() => "?").join(",");
    const r = await this.db
      .prepare(
        "SELECT r.body FROM wardsynq_record r " +
        "JOIN (SELECT id, MAX(version) AS v FROM wardsynq_record WHERE tenant_id=? AND resource_type='Patient' AND id IN (" + marks + ") GROUP BY id) m " +
        "ON m.id = r.id AND m.v = r.version WHERE r.tenant_id=? AND r.resource_type='Patient'"
      )
      .bind(tenantId, ...ids, tenantId).all();
    return (r.results || []).map(parseBody);
  }

  /**
   * The canonical id a published `wsq-<hash>` stands for, or null. INDEX SEEK on the primary key.
   * @returns {Promise<{resourceType: string, id: string}|null>}
   */
  async idByHash(tenantId, idHash) {
    const row = await this.db
      .prepare("SELECT resource_type, id FROM wardsynq_id_alias WHERE tenant_id=? AND id_hash=?")
      .bind(tenantId, idHash).first();
    return row ? { resourceType: row.resource_type, id: row.id } : null;
  }

  /**
   * Populates the identity index from Patient rows written BEFORE the index existed. See the
   * MemoryRepository twin for why this is not optional.
   *
   * PAGED BY seq, deliberately, so the backfill is not itself the bounded scan it exists to retire:
   * it walks the whole table a page at a time and finishes whatever the hospital's size.
   *
   * @returns {Promise<{scanned: number, indexed: number, conflicts: object[]}>}
   */
  async reindexPatientIdentifiers(tenantId, opts) {
    const page = Math.max(1, Math.min(1000, Number(opts && opts.pageSize) || 500));
    const out = { scanned: 0, indexed: 0, conflicts: [], aliases: 0 };

    /* The hashed-id alias index, rebuilt in the same run and over EVERY type rather than only
     * Patient: a published id belongs to any resource FHIR can be asked to read back. Paged the
     * same way, so a backfill is never itself the bounded scan it exists to retire. */
    let aliasAfter = 0;
    for (;;) {
      const r = await this.db
        .prepare("SELECT seq, resource_type, id FROM wardsynq_record WHERE tenant_id=? AND seq>? ORDER BY seq ASC LIMIT ?")
        .bind(tenantId, aliasAfter, page).all();
      const rows = r.results || [];
      if (!rows.length) break;
      for (const row of rows) {
        aliasAfter = row.seq;
        const alias = aliasFor({ id: row.id });
        if (!alias) continue;
        await this.db
          .prepare("INSERT OR IGNORE INTO wardsynq_id_alias (tenant_id,id_hash,resource_type,id,first_seen) VALUES (?,?,?,?,?)")
          .bind(tenantId, alias, row.resource_type, row.id, new Date().toISOString()).run();
        out.aliases += 1;
      }
    }

    let after = 0;
    for (;;) {
      const r = await this.db
        .prepare(
          "SELECT r.seq, r.id, r.body FROM wardsynq_record r " +
          "JOIN (SELECT id, MAX(version) AS v FROM wardsynq_record WHERE tenant_id=? AND resource_type='Patient' GROUP BY id) m " +
          "ON m.id=r.id AND m.v=r.version WHERE r.tenant_id=? AND r.resource_type='Patient' AND r.seq>? ORDER BY r.seq ASC LIMIT ?"
        )
        .bind(tenantId, tenantId, after, page).all();
      const rows = r.results || [];
      if (!rows.length) break;
      for (const row of rows) {
        after = row.seq;
        out.scanned += 1;
        const body = parseBody(row);
        for (const k of patientIdentifierKeys(body)) {
          const owner = (await this._identifierOwners(tenantId, [k])).get(`${k.systemKey}|${k.valueNorm}`);
          if (owner && owner !== body.id) { out.conflicts.push({ ...k, heldBy: owner, alsoClaimedBy: body.id }); continue; }
          if (owner) continue;
          await this.db
            .prepare("INSERT INTO wardsynq_patient_identifier (tenant_id,system_key,value_norm,patient_id,first_seen) VALUES (?,?,?,?,?)")
            .bind(tenantId, k.systemKey, k.valueNorm, body.id, new Date().toISOString()).run();
          out.indexed += 1;
        }
      }
    }
    return out;
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
    // Several logical writes in one atomic batch (staged.js): every key and audit row they carry.
    for (const k of Array.isArray(ctx.idempotency) ? ctx.idempotency : []) {
      stmts.push(this.db
        .prepare("INSERT INTO wardsynq_idempotency (tenant_id,key,resource_type,id,version,created_at) VALUES (?,?,?,?,?,?)")
        .bind(tenantId, k.key, k.resourceType, k.id, k.version, new Date().toISOString()));
    }
    if (ctx.audit) stmts.push(this._auditStatement(tenantId, ctx.audit));
    for (const a of Array.isArray(ctx.audits) ? ctx.audits : []) stmts.push(this._auditStatement(tenantId, a));

    /* The published-id alias, for the ids FHIR cannot carry verbatim. OR IGNORE because the hash is
     * a function of the id: a second row for one hash would mean a SHA-256 collision, not a claim,
     * and it must never fail a clinical write. */
    for (const rec of records) {
      const alias = aliasFor(rec);
      if (!alias) continue;
      stmts.push(this.db
        .prepare("INSERT OR IGNORE INTO wardsynq_id_alias (tenant_id,id_hash,resource_type,id,first_seen) VALUES (?,?,?,?,?)")
        .bind(tenantId, alias, rec.resourceType, rec.id, new Date().toISOString()));
    }

    /* THE IDENTITY INDEX. One indexed read for everything being claimed, then an insert per key
     * that nobody holds yet - inside the SAME atomic batch as the record rows, so the index and the
     * record can never disagree about who exists.
     *
     * The read is a pre-check, not the guarantee. The guarantee is the PRIMARY KEY: for a key this
     * read found absent the statement is a PLAIN insert, so if a concurrent writer claimed it in
     * between, the constraint fires, the whole batch rolls back, and the racer that lost creates no
     * duplicate patient. A key this patient ALREADY holds gets no statement at all, which is what
     * lets every later version of a Patient re-offer its own identifiers harmlessly. */
    const wanted = [];
    for (const rec of records) for (const k of patientIdentifierKeys(rec)) wanted.push({ ...k, patientId: rec.id });
    if (wanted.length) {
      const held = await this._identifierOwners(tenantId, wanted);
      const now = new Date().toISOString();
      for (const w of wanted) {
        const owner = held.get(`${w.systemKey}|${w.valueNorm}`);
        if (owner && owner !== w.patientId) {
          throw new IdentityConflictError(`${w.systemKey} ${w.valueNorm} already identifies ${owner}`,
            { systemKey: w.systemKey, valueNorm: w.valueNorm, heldBy: owner, offeredFor: w.patientId });
        }
        if (owner) continue;                                   // already ours, nothing to write
        stmts.push(this.db
          .prepare("INSERT INTO wardsynq_patient_identifier (tenant_id,system_key,value_norm,patient_id,first_seen) VALUES (?,?,?,?,?)")
          .bind(tenantId, w.systemKey, w.valueNorm, w.patientId, now));
      }
    }

    /* AN IDENTIFIER REMOVED FROM A PATIENT RELEASES ITS CLAIM. Without this, correcting a mis-typed
     * number was permanent and took the real owner down with it - the number stays claimed by the
     * chart it was typed on by mistake, so the person it belongs to can never be created. Scoped to
     * rows this patient owns (the (tenant_id, patient_id) index), so it is bounded and can never
     * release somebody else's identifier. */
    for (const rec of records) {
      if (rec.resourceType !== "Patient") continue;
      const kept = new Set(patientIdentifierKeys(rec).map((k) => `${k.systemKey}|${k.valueNorm}`));
      const mine = await this.db
        .prepare("SELECT system_key, value_norm FROM wardsynq_patient_identifier WHERE tenant_id=? AND patient_id=?")
        .bind(tenantId, rec.id).all();
      for (const row of mine.results || []) {
        if (kept.has(`${row.system_key}|${row.value_norm}`)) continue;
        stmts.push(this.db
          .prepare("DELETE FROM wardsynq_patient_identifier WHERE tenant_id=? AND system_key=? AND value_norm=? AND patient_id=?")
          .bind(tenantId, row.system_key, row.value_norm, rec.id));
      }
    }

    let results;
    try {
      results = await this.db.batch(stmts);
    } catch (err) {
      // The identity index first: a batch can only violate one constraint, and mislabelling this
      // one as a version conflict would tell the caller to retry a write that must never be retried.
      if (isIdentityViolation(err)) {
        throw new IdentityConflictError("another client claimed this identifier first", { records: records.map((r) => ({ resourceType: r.resourceType, id: r.id })) });
      }
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
