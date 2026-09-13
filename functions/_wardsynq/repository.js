/* functions/_wardsynq/repository.js — the persistence PORT of the WardSynQ Clinical Record Service.
 *
 * This file is the deployment boundary. Everything above it (the clinical model, the ClinicalStore,
 * the GovernedStore, the API contract) is deployment-independent; everything below it is one
 * database. A managed India-hosted WardSynQ, a hospital-controlled on-premise one and a hybrid all
 * run the SAME service and differ only in which implementation of this port they are handed.
 *
 *   repository-d1.js     Cloudflare D1        the current managed deployment       IMPLEMENTED
 *   MemoryRepository     process memory       tests, and the reference semantics   IMPLEMENTED
 *   (postgres / sqlite)  hospital-local       on-premise                           NOT IMPLEMENTED
 *
 * The port is deliberately small: eight methods, one error type. A hospital's database team can
 * implement it against their own engine in an afternoon and never touch the clinical application.
 *
 * THE CONTRACT, which every implementation must honour and MemoryRepository demonstrates:
 *
 *   latest(tenantId, resourceType, id)               -> record | null       the highest version
 *   history(tenantId, resourceType, id)              -> record[]            every version, ascending
 *   byPatient(tenantId, resourceType, patientId)     -> record[]            latest version per id
 *   latestByType(tenantId, resourceType, limit)      -> record[]            latest per id, a roster
 *   patientsByIdentifier(tenantId, keys)             -> Patient[]           an INDEX SEEK, not a scan
 *   append(tenantId, records, ctx)                   -> {seq}               ATOMIC; see below
 *   changes(tenantId, sinceSeq, limit)               -> {records, cursor}   ascending by seq
 *   recall(tenantId, idempotencyKey)                 -> {resourceType,id,version} | null
 *   auditOnly(tenantId, event)                       -> void                a read's audit row
 *
 * append() is the only write and it is append-only: it inserts new versions and never updates or
 * deletes. It MUST be atomic across the records, the idempotency key and the audit event it is
 * given - and across the optional ctx.idempotency ([{key, resourceType, id, version}]) and
 * ctx.audits ([event]) lists, which let one append carry several logical writes (see staged.js,
 * the consultation's unit of work) with every key and every audit row they would have had alone - and it MUST throw VersionConflictError if any (resourceType, id, version) already exists
 * for that tenant. That last rule is the concurrency control for the whole system: two clients
 * that both derive version N+1 from version N cannot both land, whatever the network did.
 *
 * Every method takes tenantId FIRST and every implementation must scope by it. There is no
 * cross-tenant method and there never will be one at this layer.
 */

import { patientIdentifierKeys } from "./identity-key.js";
import { fhirId, hashedId } from "./fhir-id.js";

/**
 * PURE. The published hashed form of a record id, or null when the id is published verbatim.
 *
 * Only non-conforming (or over-long) ids are ever hashed, so for the overwhelming majority of rows
 * this returns null and the alias index costs nothing.
 */
function aliasFor(record) {
  const id = record && typeof record.id === "string" ? record.id : "";
  if (!id) return null;
  const published = fhirId(id);
  return published && published !== id ? published : null;
}

class VersionConflictError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "VersionConflictError";
    this.code = "VERSION_CONFLICT";
    this.detail = detail || null;
  }
}

class RepositoryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RepositoryError";
    this.code = code || "REPOSITORY_ERROR";
  }
}

/* TASK 9.16. `probe` is on the port because a health check that does not reach storage is not a
 * health check. On 2026-09-07 the schema had never been applied to the production D1: every clinical
 * write failed on its first read, and /api/wardsynq/health answered {ok:true} throughout, because it
 * returned a literal. An implementation that cannot answer probe() cannot be served from. */
const PORT_METHODS = Object.freeze(["latest", "history", "byPatient", "latestByType", "patientsByIdentifier", "idByHash", "append", "changes", "recall", "auditOnly", "probe"]);

/**
 * One identifier was offered for a second person.
 *
 * Not a VersionConflictError, and deliberately not a subclass of one: a version conflict means "you
 * read a stale copy, read again and retry", which a caller may safely automate. This means "the
 * number you are claiming already belongs to somebody else", and retrying it is exactly the wrong
 * response - the caller must go and look at who that somebody is. Different problem, different
 * error, different thing to do about it.
 */
class IdentityConflictError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "IdentityConflictError";
    this.code = "IDENTITY_CONFLICT";
    this.detail = detail || null;
  }
}

/** Refuses at boot rather than at the first clinical write. */
function assertRepository(repo) {
  if (!repo || typeof repo !== "object") throw new RepositoryError("a repository is required", "NO_REPOSITORY");
  for (const m of PORT_METHODS) {
    if (typeof repo[m] !== "function") throw new RepositoryError(`repository is missing ${m}()`, "PORT_INCOMPLETE");
  }
  return repo;
}

function clone(v) {
  return v === null || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v));
}

/**
 * The ceiling on a latestByType() roster, shared by every implementation so they cannot disagree.
 *
 * IT USED TO BE 200 AND IT WAS SILENT, which is the part that was wrong. Callers ask for what they
 * actually need - analytics-extract.js asks for 1000, fhir-inbound.js asks for 1000 to match an
 * inbound feed against the local patients, blackout.js and fhir-outbound.js ask for 500 - and every
 * one of them was quietly handed 200 rows with no signal that anything had been dropped. Worse, the
 * 200 kept were the OLDEST, because both implementations page in insertion order: on a tenant past
 * the ceiling the most recent records - the newly registered patient, the emergency declared this
 * morning - were the ones that fell off.
 *
 * ponytail: a flat ceiling, still. This raises it to what the callers already believe they get and
 * makes it one named constant instead of two hidden magic numbers; it does NOT turn list() into a
 * paged query. A tenant with more than MAX_ROSTER records of one type is still truncated, so
 * list() remains a bounded roster and must not be used as the index for an identity match. That
 * limit is real and is stated in the audit rather than papered over here.
 */
const MAX_ROSTER = 1000;
const DEFAULT_ROSTER = 100;

function rosterLimit(limit) {
  return Math.max(1, Math.min(MAX_ROSTER, Number(limit) || DEFAULT_ROSTER));
}

/** What the record row carries besides the body, so an implementation can index without parsing. */
function rowOf(tenantId, record) {
  const meta = record.meta || {};
  const by = record.writtenBy || {};
  return {
    tenantId,
    resourceType: record.resourceType,
    id: record.id,
    version: record.version,
    patientId: record.resourceType === "Patient" ? record.id : (record.patientId || null),
    recordedAt: meta.recordedAt || (by.at || new Date().toISOString()),
    effectiveAt: meta.effectiveAt || null,
    actorId: by.id || null,
    actorKind: by.kind || null,
    body: record,
  };
}

/**
 * The reference implementation. Also what the tests run against, so the semantics every other
 * implementation must match are executable rather than described.
 */
class MemoryRepository {
  constructor() {
    this._rows = [];            // every version ever written, in seq order
    this._seq = 0;
    this._idem = new Map();     // `${tenant}|${key}` -> {resourceType,id,version}
    /* The patient identity index, mirroring the wardsynq_patient_identifier table exactly.
     * `${tenant}|${systemKey}|${valueNorm}` -> patientId. Its whole job is that a lookup costs the
     * same on a hospital of ten patients and a hospital of a hundred thousand. */
    this._ident = new Map();
    /* The FHIR hashed-id alias index, mirroring wardsynq_id_alias.
     * `${tenant}|${idHash}` -> {resourceType, id}. Only non-conforming ids appear here. */
    this._alias = new Map();
    this.audit = [];            // audit events, in order, for inspection
  }

  _versionsOf(tenantId, resourceType, id) {
    return this._rows.filter((r) => r.tenantId === tenantId && r.resourceType === resourceType && r.id === id);
  }

  async latest(tenantId, resourceType, id) {
    const v = this._versionsOf(tenantId, resourceType, id);
    return v.length ? clone(v[v.length - 1].body) : null;
  }

  async history(tenantId, resourceType, id) {
    return this._versionsOf(tenantId, resourceType, id).map((r) => clone(r.body));
  }

  async byPatient(tenantId, resourceType, patientId) {
    const byId = new Map();
    for (const r of this._rows) {
      if (r.tenantId !== tenantId || r.resourceType !== resourceType || r.patientId !== patientId) continue;
      byId.set(r.id, r);                       // rows are in seq order, so the last wins
    }
    return [...byId.values()].map((r) => clone(r.body));
  }

  async latestByType(tenantId, resourceType, limit) {
    const max = rosterLimit(limit);
    const byId = new Map();
    for (const r of this._rows) {
      if (r.tenantId !== tenantId || r.resourceType !== resourceType) continue;
      byId.set(r.id, r);
    }
    return [...byId.values()].slice(0, max).map((r) => clone(r.body));
  }

  /**
   * Every local Patient carrying any of these identifiers. An INDEX SEEK per identifier, never a
   * scan: the cost is the number of identifiers on the incoming patient, which is a handful, and is
   * completely independent of how many patients the hospital holds.
   *
   * @param {string} tenantId
   * @param {{systemKey: string, valueNorm: string}[]} keys
   * @returns {Promise<object[]>} the latest version of each matching Patient, de-duplicated
   */
  async patientsByIdentifier(tenantId, keys) {
    const ids = new Set();
    for (const k of keys || []) {
      if (!k || !k.systemKey || !k.valueNorm) continue;
      const hit = this._ident.get(`${tenantId}|${k.systemKey}|${k.valueNorm}`);
      if (hit) ids.add(hit);
    }
    const out = [];
    for (const id of ids) {
      const v = this._versionsOf(tenantId, "Patient", id);
      if (v.length) out.push(clone(v[v.length - 1].body));
    }
    return out;
  }

  /**
   * The canonical id a published `wsq-<hash>` stands for, or null. INDEX SEEK, never a scan.
   * @returns {Promise<{resourceType: string, id: string}|null>}
   */
  async idByHash(tenantId, idHash) {
    const hit = this._alias.get(`${tenantId}|${idHash}`);
    return hit ? { ...hit } : null;
  }

  /**
   * Populates the identity index from Patient rows that were written BEFORE the index existed.
   *
   * WITHOUT THIS THE FIX IS THEORETICAL. The index is maintained on write, so on the day it ships
   * every patient a hospital already holds has no entry in it - and identity reconciliation would
   * go on missing exactly the people it was built to find, while looking like it worked. It is
   * idempotent and safe to re-run: an identifier already recorded for the same patient is left
   * alone, and one recorded for a DIFFERENT patient is REPORTED rather than overwritten, because
   * that is a pre-existing duplicate in the data and a backfill must not silently pick a winner.
   *
   * @returns {Promise<{scanned: number, indexed: number, conflicts: object[]}>}
   */
  async reindexPatientIdentifiers(tenantId) {
    const out = { scanned: 0, indexed: 0, conflicts: [], aliases: 0 };
    /* The hashed-id alias index is rebuilt in the same pass, and over EVERY type rather than only
     * Patient: a published id belongs to any resource FHIR can be asked to read back. */
    for (const r of this._rows) {
      if (r.tenantId !== tenantId) continue;
      const alias = aliasFor(r.body);
      if (alias && !this._alias.has(`${tenantId}|${alias}`)) {
        this._alias.set(`${tenantId}|${alias}`, { resourceType: r.resourceType, id: r.id });
        out.aliases += 1;
      }
    }
    const latest = new Map();
    for (const r of this._rows) {
      if (r.tenantId !== tenantId || r.resourceType !== "Patient") continue;
      latest.set(r.id, r.body);                 // rows are in seq order, so the last wins
    }
    for (const body of latest.values()) {
      out.scanned += 1;
      for (const k of patientIdentifierKeys(body)) {
        const mapKey = `${tenantId}|${k.systemKey}|${k.valueNorm}`;
        const owner = this._ident.get(mapKey);
        if (owner && owner !== body.id) { out.conflicts.push({ ...k, heldBy: owner, alsoClaimedBy: body.id }); continue; }
        if (owner) continue;
        this._ident.set(mapKey, body.id);
        out.indexed += 1;
      }
    }
    return out;
  }

  /**
   * @param {string} tenantId
   * @param {object[]} records  canonical entities, each already carrying its version
   * @param {{idempotencyKey?: string, audit?: object}} [ctx]
   */
  async append(tenantId, records, ctx) {
    ctx = ctx || {};
    // Atomicity: check every row first, then write every row. Nothing lands if anything conflicts.
    for (const rec of records) {
      const dup = this._rows.find((r) => r.tenantId === tenantId && r.resourceType === rec.resourceType && r.id === rec.id && r.version === rec.version);
      if (dup) {
        throw new VersionConflictError(`${rec.resourceType}/${rec.id} version ${rec.version} already exists`, { resourceType: rec.resourceType, id: rec.id, version: rec.version });
      }
    }
    if (ctx.idempotencyKey && this._idem.has(`${tenantId}|${ctx.idempotencyKey}`)) {
      throw new VersionConflictError("idempotency key already used", { idempotencyKey: ctx.idempotencyKey });
    }
    const extraKeys = Array.isArray(ctx.idempotency) ? ctx.idempotency : [];
    for (const k of extraKeys) {
      if (this._idem.has(`${tenantId}|${k.key}`)) throw new VersionConflictError("idempotency key already used", { idempotencyKey: k.key });
    }
    /* THE IDENTITY CHECK, in the same all-or-nothing phase as the version check above and for the
     * same reason: an identifier that lands while a sibling row is refused would leave the index
     * claiming a patient the record does not have. Claiming an identifier that already belongs to a
     * DIFFERENT patient is refused; re-claiming your own (every new version of a Patient re-offers
     * its identifiers) is a no-op. */
    const claims = [];
    for (const rec of records) {
      for (const k of patientIdentifierKeys(rec)) {
        const mapKey = `${tenantId}|${k.systemKey}|${k.valueNorm}`;
        const owner = this._ident.get(mapKey);
        if (owner && owner !== rec.id) {
          throw new IdentityConflictError(
            `${k.systemKey} ${k.valueNorm} already identifies ${owner}`,
            { systemKey: k.systemKey, valueNorm: k.valueNorm, heldBy: owner, offeredFor: rec.id });
        }
        if (!owner) claims.push([mapKey, rec.id]);
      }
    }
    let last = this._seq;
    for (const rec of records) {
      this._seq += 1;
      last = this._seq;
      this._rows.push({ seq: this._seq, ...rowOf(tenantId, clone(rec)) });
    }
    for (const [mapKey, patientId] of claims) this._ident.set(mapKey, patientId);
    /* AN IDENTIFIER REMOVED FROM A PATIENT RELEASES ITS CLAIM.
     *
     * Without this, correcting a mis-typed number was permanent and it took the real owner down
     * with it: a clerk types somebody else's ABHA onto Asha's chart, notices, and removes it - the
     * index still says that ABHA is Asha's, so when the person it actually belongs to arrives their
     * chart CANNOT BE CREATED, refused forever by a number nobody holds any more. Diffed against the
     * previous version rather than scanned, so the cost is the identifiers on one patient. */
    for (const rec of records) {
      if (rec.resourceType !== "Patient") continue;
      const versions = this._versionsOf(tenantId, "Patient", rec.id);
      const prior = versions.length > 1 ? versions[versions.length - 2].body : null;
      if (!prior) continue;
      const kept = new Set(patientIdentifierKeys(rec).map((k) => `${k.systemKey}|${k.valueNorm}`));
      for (const k of patientIdentifierKeys(prior)) {
        const pair = `${k.systemKey}|${k.valueNorm}`;
        if (kept.has(pair)) continue;
        const mapKey = `${tenantId}|${pair}`;
        if (this._ident.get(mapKey) === rec.id) this._ident.delete(mapKey);
      }
    }
    /* The published-id alias, for the ids FHIR cannot carry verbatim. First writer wins: the hash is
     * a function of the id, so a second entry for one hash means a SHA-256 collision, not a claim. */
    for (const rec of records) {
      const alias = aliasFor(rec);
      if (alias && !this._alias.has(`${tenantId}|${alias}`)) {
        this._alias.set(`${tenantId}|${alias}`, { resourceType: rec.resourceType, id: rec.id });
      }
    }
    if (ctx.idempotencyKey && records.length) {
      const r = records[records.length - 1];
      this._idem.set(`${tenantId}|${ctx.idempotencyKey}`, { resourceType: r.resourceType, id: r.id, version: r.version });
    }
    for (const k of extraKeys) this._idem.set(`${tenantId}|${k.key}`, { resourceType: k.resourceType, id: k.id, version: k.version });
    if (ctx.audit) this.audit.push({ tenantId, ...clone(ctx.audit) });
    for (const a of Array.isArray(ctx.audits) ? ctx.audits : []) this.audit.push({ tenantId, ...clone(a) });
    return { seq: last };
  }

  async changes(tenantId, sinceSeq, limit) {
    const since = Number(sinceSeq) || 0;
    const max = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = this._rows.filter((r) => r.tenantId === tenantId && r.seq > since).slice(0, max);
    return { records: rows.map((r) => ({ seq: r.seq, ...clone(r.body) })), cursor: rows.length ? rows[rows.length - 1].seq : since };
  }

  async recall(tenantId, idempotencyKey) {
    const hit = this._idem.get(`${tenantId}|${idempotencyKey}`);
    return hit ? { ...hit } : null;
  }

  /** Reads are audited too. Separate from append because a read writes nothing else. */
  /** In-memory: reachable whenever the object exists. Reported honestly as such. */
  async probe() {
    return { ok: true, backend: "memory", detail: "in-process store; nothing is persisted and nothing can be unreachable" };
  }

  async auditOnly(tenantId, event) {
    this.audit.push({ tenantId, ...clone(event) });
  }
}

export { VersionConflictError, IdentityConflictError, RepositoryError, PORT_METHODS, assertRepository, rowOf, MemoryRepository, MAX_ROSTER, rosterLimit };
