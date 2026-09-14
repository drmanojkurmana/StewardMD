/* functions/_wardsynq/repository-d1.js — the Cloudflare D1 implementation of the persistence port.
 *
 * Schema: functions/db/wardsynq_schema.sql. Tenancy and the audit trail reuse the existing
 * stewardmd-connect tables (connect_tenant, connect_membership, connect_audit_event); the record
 * itself lives in wardsynq_record and the retry table in wardsynq_idempotency.
 *
 * No UPDATE, no DELETE. The one write is a D1 batch (atomic) of INSERTs: the record versions, the
 * idempotency key, the audit event and its audit-chain link (audit-chain.js) land together or not at all. A UNIQUE violation on
 * (tenant, type, id, version) surfaces as VersionConflictError, which is how a lost race is
 * reported instead of being overwritten.
 *
 * This file is the ONLY place that knows these table names. A hospital-local database is a sibling
 * file implementing the same eight methods against its own engine.
 */

import { VersionConflictError, IdentityConflictError, RepositoryError, rowOf, rosterLimit, AUDIT_READ_MAX } from "./repository.js";
import { patientIdentifierKeys } from "./identity-key.js";
import { fhirId } from "./fhir-id.js";
import { nextLinks, APPEND_ATTEMPTS, retryPause, withChainLock } from "./audit-chain.js";

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

/* A lost race for the next audit-chain link (see _batchWithChain). Checked before every other
 * constraint, because it is the one case where retrying the identical write is exactly right. */
function isChainViolation(err) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String((err && err.message) || err || "")) && /wardsynq_audit_chain/i.test(String((err && err.message) || err || ""));
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

  async latestByType(tenantId, resourceType, limit, opts) {
    const max = rosterLimit(limit);
    const r = await this.db
      .prepare(
        "SELECT r.body FROM wardsynq_record r " +
        "JOIN (SELECT id, MAX(version) AS v FROM wardsynq_record WHERE tenant_id=? AND resource_type=? GROUP BY id) m " +
        "ON m.id = r.id AND m.v = r.version WHERE r.tenant_id=? AND r.resource_type=? ORDER BY r.seq " + (opts && opts.newest ? "DESC" : "ASC") + " LIMIT ?"
      )
      .bind(tenantId, resourceType, tenantId, resourceType, max).all();
    return (r.results || []).map(parseBody);
  }

  /**
   * OPTIONAL (see repository.js): one page, newest first, of the latest version per id starting with
   * `prefix`. The prefix is a RANGE on the UNIQUE (tenant_id, resource_type, id, version) index, not a
   * LIKE, so a hospital's other rows are never walked. The cursor is the seq of the last row handed back.
   */
  async pageByIdPrefix(tenantId, resourceType, prefix, opts) {
    const pre = String(prefix || "");
    if (!pre) return { records: [], next: null };
    const max = rosterLimit(opts && opts.limit), before = Number(opts && opts.before) || null;
    const hi = pre.slice(0, -1) + String.fromCharCode(pre.charCodeAt(pre.length - 1) + 1);
    const r = await this.db
      .prepare(
        "SELECT r.body, r.seq FROM wardsynq_record r " +
        "JOIN (SELECT id, MAX(version) AS v FROM wardsynq_record WHERE tenant_id=? AND resource_type=? AND id>=? AND id<? GROUP BY id) m " +
        "ON m.id = r.id AND m.v = r.version WHERE r.tenant_id=? AND r.resource_type=?" + (before ? " AND r.seq<?" : "") + " ORDER BY r.seq DESC LIMIT ?"
      )
      .bind(...[tenantId, resourceType, pre, hi, tenantId, resourceType, ...(before ? [before] : []), max + 1]).all();
    const rows = r.results || [];
    return { records: rows.slice(0, max).map(parseBody), next: rows.length > max ? rows[max - 1].seq : null };
  }

  /**
   * OPTIONAL (see repository.js): latest version per id whose body status is one of `statuses`,
   * oldest first. The status lives in the body JSON - there is deliberately no status column (see
   * the outbox index note in wardsynq_schema.sql) - so the predicate reads it with json_extract,
   * which idx_wardsynq_record_outbox_status keeps cheap. Without that index this still answers
   * correctly, only slower.
   *
   * The IN list is placeholders, never interpolation: statuses arrive as outbox constants, but a
   * query builder that trusts its caller is how a constant becomes an injection one refactor later.
   * Non-string entries are dropped before binding, so a stray value narrows the read instead of
   * widening it.
   */
  async latestByStatus(tenantId, resourceType, statuses, limit) {
    const want = (Array.isArray(statuses) ? statuses : []).filter((s) => typeof s === "string");
    if (!want.length) return [];
    const max = rosterLimit(limit);
    const r = await this.db
      .prepare(
        "SELECT r.body FROM wardsynq_record r " +
        "JOIN (SELECT id, MAX(version) AS v FROM wardsynq_record WHERE tenant_id=? AND resource_type=? GROUP BY id) m " +
        "ON m.id = r.id AND m.v = r.version WHERE r.tenant_id=? AND r.resource_type=? " +
        "AND json_extract(r.body, '$.status') IN (" + want.map(() => "?").join(",") + ") ORDER BY r.seq ASC LIMIT ?"
      )
      .bind(tenantId, resourceType, tenantId, resourceType, ...want, max).all();
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
      await this.db.prepare("SELECT chain_seq FROM wardsynq_audit_chain LIMIT 0").all();
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

  /**
   * The audit row exactly as it will be stored, keyed by column. It is what gets hashed into the chain
   * AND what gets bound, so every value is already the type the column hands back (text as a string,
   * latency as a number): a hash over a value SQL would have converted could never verify.
   */
  _auditRow(tenantId, e) {
    const t = (v) => (v == null || v === "" ? null : String(v));
    const lat = e.latencyMs == null || !Number.isFinite(Number(e.latencyMs)) ? null : Number(e.latencyMs);
    return {
      id: t(e.id) || newId(), tenant_id: String(tenantId), ts: t(e.ts) || new Date().toISOString(), actor: t(e.actor),
      connector_id: t(e.connectorId) || "wardsynq", action: t(e.action),
      resource_counts: JSON.stringify(scrubLeaves(bounded(e.resourceCounts ?? null))), scope: JSON.stringify(scrubLeaves(bounded(e.scope ?? null))),
      patient_ref_hash: t(e.patientRefHash), latency_ms: lat, outcome: t(e.outcome), consent_id: null, transaction_id: null, care_context_hash: null,
    };
  }

  _auditStatement(row) {
    return this.db.prepare(AUDIT_INSERT).bind(row.id, row.tenant_id, row.ts, row.actor, row.connector_id, row.action, row.resource_counts,
      row.scope, row.patient_ref_hash, row.latency_ms, row.outcome, row.consent_id, row.transaction_id, row.care_context_hash);
  }

  /** OPTIONAL (audit-chain.js): the newest link, or null before the first chained row. */
  async auditChainHead(tenantId) {
    const row = await this.db
      .prepare("SELECT chain_seq, row_hash FROM wardsynq_audit_chain WHERE tenant_id=? ORDER BY chain_seq DESC LIMIT 1")
      .bind(tenantId).first();
    return row ? { seq: Number(row.chain_seq), hash: row.row_hash } : null;
  }

  /** OPTIONAL (audit-chain.js): links fromSeq..toSeq with the stored audit row each covers (null if gone). */
  async auditChainRows(tenantId, fromSeq, toSeq) {
    const r = await this.db
      .prepare(
        "SELECT c.chain_seq, c.audit_id, c.prev_hash, c.row_hash, c.legacy_boundary, a.id AS a_id, a.tenant_id AS a_tenant_id, a.ts, a.actor, a.connector_id, a.action, " +
        "a.resource_counts, a.scope, a.patient_ref_hash, a.latency_ms, a.outcome, a.consent_id, a.transaction_id, a.care_context_hash " +
        "FROM wardsynq_audit_chain c LEFT JOIN connect_audit_event a ON a.id = c.audit_id WHERE c.tenant_id=? AND c.chain_seq>=? AND c.chain_seq<=? ORDER BY c.chain_seq ASC"
      )
      .bind(tenantId, Number(fromSeq), Number(toSeq)).all();
    return (r.results || []).map((x) => ({
      chainSeq: Number(x.chain_seq), auditId: x.audit_id, prevHash: x.prev_hash, rowHash: x.row_hash, legacyBoundary: x.legacy_boundary,
      row: x.a_id == null ? null : {
        id: x.a_id, tenant_id: x.a_tenant_id, ts: x.ts, actor: x.actor, connector_id: x.connector_id, action: x.action, resource_counts: x.resource_counts,
        scope: x.scope, patient_ref_hash: x.patient_ref_hash, latency_ms: x.latency_ms, outcome: x.outcome, consent_id: x.consent_id,
        transaction_id: x.transaction_id, care_context_hash: x.care_context_hash,
      },
    }));
  }

  /**
   * Runs `stmts` as ONE batch with the chain links for `auditRows` appended.
   *
   * WHY A PRIMARY KEY AND NOT A GUARDED HEAD ROW. SHA-256 cannot be computed inside SQLite, so the head
   * must be read and the hash computed here, before the batch - and a concurrent write can extend the
   * chain in between. The obvious guard, `UPDATE head SET hash=? WHERE hash=<what I read>`, does not
   * work in a D1 batch: an UPDATE that matches no row SUCCEEDS with zero changes, so the batch would
   * commit a forked link. A plain INSERT of (tenant_id, chain_seq) = head + 1 does work: the loser of
   * the race violates the primary key, the WHOLE batch rolls back (records, idempotency key and audit
   * row with it), and it is re-read and re-run here. Nothing landed, so re-running is safe; after
   * APPEND_ATTEMPTS it surfaces as a VersionConflictError, which already means "nothing was written".
   */
  async _batchWithChain(tenantId, stmts, auditRows) {
    if (!auditRows.length) return this.db.batch(stmts);
    return withChainLock(this.db, tenantId, () => this._batchWithChainNow(tenantId, stmts, auditRows));
  }

  async _batchWithChainNow(tenantId, stmts, auditRows) {
    for (let attempt = 1; ; attempt++) {
      const head = await this.auditChainHead(tenantId);
      let boundary = null;
      if (!head) {
        const last = await this.db
          .prepare("SELECT id FROM connect_audit_event WHERE tenant_id=? AND connector_id='wardsynq' ORDER BY ts DESC LIMIT 1")
          .bind(tenantId).first();
        boundary = (last && last.id) || null;
      }
      const links = await nextLinks(head, auditRows.map((row) => ({ auditId: row.id, row })), boundary);
      const chain = links.map((l) => this.db
        .prepare("INSERT INTO wardsynq_audit_chain (tenant_id,chain_seq,audit_id,prev_hash,row_hash,legacy_boundary) VALUES (?,?,?,?,?,?)")
        .bind(tenantId, l.chainSeq, l.auditId, l.prevHash, l.rowHash, l.legacyBoundary));
      try {
        return await this.db.batch(stmts.concat(chain));
      } catch (err) {
        if (!isChainViolation(err)) throw err;
        if (attempt >= APPEND_ATTEMPTS) throw new VersionConflictError("the audit chain moved under this write; nothing was written", { auditChain: true });
        await retryPause(attempt);
      }
    }
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
    const auditRows = [ctx.audit, ...(Array.isArray(ctx.audits) ? ctx.audits : [])].filter(Boolean).map((a) => this._auditRow(tenantId, a));
    for (const row of auditRows) stmts.push(this._auditStatement(row));

    /* The published-id alias, for the ids FHIR cannot carry verbatim. OR IGNORE because the hash is
     * a function of the id: a second row for one hash would mean a SHA-256 collision, not a claim,
     * and it must never fail a clinical write. */
    const aliases = records.map((rec) => ({ hash: aliasFor(rec), resourceType: rec.resourceType, id: rec.id })).filter((a) => a.hash)
      .concat(Array.isArray(ctx.aliases) ? ctx.aliases : []);
    for (const a of aliases) {
      stmts.push(this.db
        .prepare("INSERT OR IGNORE INTO wardsynq_id_alias (tenant_id,id_hash,resource_type,id,first_seen) VALUES (?,?,?,?,?)")
        .bind(tenantId, a.hash, a.resourceType, a.id, new Date().toISOString()));
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
      results = await this._batchWithChain(tenantId, stmts, auditRows);
    } catch (err) {
      if (err instanceof VersionConflictError) throw err;
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
    const row = this._auditRow(tenantId, event);
    await this._batchWithChain(tenantId, [this._auditStatement(row)], [row]);
  }

  /**
   * OPTIONAL, not in PORT_METHODS: the security review reads the audit trail back. A deployment
   * without it reports the review as unavailable rather than clean. Newest rows win the limit, so a
   * truncated read loses the oldest baseline, never the period under review.
   * @returns {Promise<{events: object[], oldestAt: string|null, truncated: boolean}>}
   */
  async auditTrail(tenantId, opts) {
    const since = String((opts && opts.since) || "");
    const limit = Math.max(1, Math.min(AUDIT_READ_MAX, Number(opts && opts.limit) || AUDIT_READ_MAX));
    const r = await this.db
      .prepare("SELECT id, ts, actor, action, resource_counts, scope, patient_ref_hash, outcome FROM connect_audit_event WHERE tenant_id=? AND connector_id='wardsynq' AND ts>=? ORDER BY ts DESC LIMIT ?")
      .bind(tenantId, since, limit + 1).all();
    const rows = r.results || [];
    const o = await this.db
      .prepare("SELECT MIN(ts) AS oldest FROM connect_audit_event WHERE tenant_id=? AND connector_id='wardsynq'")
      .bind(tenantId).first();
    const json = (v) => { try { return v == null ? null : JSON.parse(v); } catch { return null; } };
    return {
      truncated: rows.length > limit,
      oldestAt: (o && o.oldest) || null,
      events: rows.slice(0, limit).reverse().map((row) => ({
        id: row.id, ts: row.ts, actor: row.actor, action: row.action, resourceCounts: json(row.resource_counts),
        scope: json(row.scope), patientRefHash: row.patient_ref_hash, outcome: row.outcome,
      })),
    };
  }

  /** OPTIONAL (G11): this hospital's audit rows with these ids, in the auditTrail shape, each with its chain link number (null when unlinked). */
  async auditRowsById(tenantId, ids) {
    const list = [...new Set((ids || []).map(String))].slice(0, 200);
    if (!list.length) return [];
    const r = await this.db
      .prepare(`SELECT a.id, a.ts, a.actor, a.action, a.resource_counts, a.scope, a.patient_ref_hash, a.outcome, c.chain_seq FROM connect_audit_event a LEFT JOIN wardsynq_audit_chain c ON c.audit_id=a.id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.id IN (${list.map(() => "?").join(",")})`)
      .bind(tenantId, ...list).all();
    const json = (v) => { try { return v == null ? null : JSON.parse(v); } catch { return null; } };
    return (r.results || []).map((row) => ({ id: row.id, ts: row.ts, actor: row.actor, action: row.action, resourceCounts: json(row.resource_counts),
      scope: json(row.scope), patientRefHash: row.patient_ref_hash, outcome: row.outcome, chainSeq: row.chain_seq == null ? null : Number(row.chain_seq) }));
  }
}

export { D1Repository };
