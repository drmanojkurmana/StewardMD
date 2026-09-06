/* functions/_wardsynq/service.js — the WardSynQ Clinical Record Service.
 *
 * This is the authoritative clinical record when WardSynQ is a hospital's EMR. It is the SAME
 * ClinicalStore and the SAME GovernedStore that run in the browser today, instantiated here on the
 * server per request, over a persistence port instead of IndexedDB. No clinical logic is
 * re-implemented in this file: versioning, append-only history, provenance stamping and the actor
 * ceilings all come from wardsynq/ unchanged. What this file adds is exactly what a device-local
 * store cannot have:
 *
 *   TENANCY       every read and write is scoped to one hospital, decided from membership, never
 *                 from the request body
 *   IDENTITY      the actor is derived from the verified token and the membership role; a client's
 *                 claim about who it is does not survive the door
 *   CONCURRENCY   a write states the version it was derived from; a stale one is refused with the
 *                 current record, never merged silently. The repository's unique key backs this up
 *                 for the race the check cannot see.
 *   IDEMPOTENCY   a retried write replays its original outcome instead of producing version N+2
 *   AUDIT         every read and write of clinical content leaves a PHI-free row in the existing
 *                 Connect audit trail, in the same atomic batch as the write it describes
 *   AUTHORITY     in integration mode an external EMR owns what it owns: a record whose latest
 *                 version came from another system is not overwritten through the native door
 *
 * TWO MODES, ONE CONTRACT. A tenant runs as SYSTEM-OF-RECORD (WardSynQ owns the record) or in
 * INTEGRATION (an external EMR is authoritative for the data it owns and reaches WardSynQ through
 * the connectors). Both modes use this service, this model and this store. The mode only changes
 * which writes the native door accepts; it does not change what a record is.
 *
 * STATUS: IMPLEMENTED. Not clinically validated, not clinically approved, and the deployment modes
 * other than Cloudflare D1 are a port contract, not an implementation.
 */

import { ClinicalStore } from "../../wardsynq/wardsynq-store.js";
import { GovernedStore, GovernanceError, canRead } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError, assertRepository } from "./repository.js";
import { actorFromConnectRole, aiActorFor, isAiOrigin } from "./actor.js";

/** The canonical resource types. Mirrors wardsynq-model.js; a type not listed here is refused. */
const RESOURCE_TYPES = Object.freeze([
  "Patient", "Encounter", "Condition", "AllergyIntolerance", "Observation",
  "MedicationOrder", "MedicationAdministration", "ServiceRequest", "DiagnosticReport",
  "CarePlan", "ClinicalNote",
]);

const MODE = Object.freeze({ SYSTEM_OF_RECORD: "system-of-record", INTEGRATION: "integration" });

/** Provenance value the model stamps on records WardSynQ itself originated. */
const NATIVE_SYSTEM = "wardsynq-native";

class AuthorityError extends Error {
  constructor(message, code, detail) {
    super(message);
    this.name = "AuthorityError";
    this.code = code || "EXTERNAL_AUTHORITY";
    this.detail = detail || null;
  }
}

class RecordRequestError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RecordRequestError";
    this.code = code || "BAD_REQUEST";
  }
}

/**
 * The ClinicalStore backend over the persistence port, fixed to one tenant. This is the whole
 * bridge: four methods the store already expects, each forwarding with the tenant prepended. The
 * store cannot address another tenant because the backend has no parameter for one.
 */
class TenantBackend {
  constructor(repository, tenantId) {
    this.repository = assertRepository(repository);
    this.tenantId = tenantId;
    this._ctx = null;
  }
  async open() {}
  async close() {}
  get(resourceType, id) { return this.repository.latest(this.tenantId, resourceType, id); }
  history(resourceType, id) { return this.repository.history(this.tenantId, resourceType, id); }
  byPatient(resourceType, patientId) { return this.repository.byPatient(this.tenantId, resourceType, patientId); }

  /** Context for the NEXT write only: idempotency key and the audit event to land with it. */
  withWriteContext(ctx) { this._ctx = ctx || null; }

  async write(records) {
    const ctx = this._ctx || {};
    this._ctx = null;
    return this.repository.append(this.tenantId, records, { idempotencyKey: ctx.idempotencyKey || null, audit: ctx.audit || null });
  }
}

/**
 * Reads the tenant's record policy out of connect_tenant.settings (JSON). Nothing here is a
 * clinical rule; it is which system owns which records, and it is per hospital.
 *
 *   settings.wardsynq.recordMode      "system-of-record" (default) | "integration"
 *   settings.wardsynq.externallyOwned resource types the external EMR creates; in integration mode
 *                                     defaults to the identity and visit masters, Patient and
 *                                     Encounter, which an existing EMR always owns. Configurable.
 */
function recordPolicy(tenant) {
  let settings = {};
  try { settings = typeof tenant.settings === "string" ? JSON.parse(tenant.settings || "{}") : (tenant.settings || {}); } catch { settings = {}; }
  const ws = (settings && settings.wardsynq) || {};
  const mode = ws.recordMode === MODE.INTEGRATION ? MODE.INTEGRATION : MODE.SYSTEM_OF_RECORD;
  const externallyOwned = Array.isArray(ws.externallyOwned)
    ? ws.externallyOwned.filter((t) => RESOURCE_TYPES.includes(t))
    : (mode === MODE.INTEGRATION ? ["Patient", "Encounter"] : []);
  return Object.freeze({ mode, externallyOwned: Object.freeze(externallyOwned) });
}

/** Kept under its first name. The mapping itself lives in actor.js, beside the OPD-role mapping. */
const actorForMembership = actorFromConnectRole;

function externallyOwned(record) {
  const sys = record && record.meta && record.meta.source && record.meta.source.system;
  return !!sys && sys !== NATIVE_SYSTEM;
}

class RecordService {
  /**
   * @param {{repository: object, tenant: {id: string, settings?: any}, actor: object, role: string,
   *   bus?: object, pseudonym?: (patientId: string) => Promise<string|null>, now?: () => string}} deps
   */
  constructor(deps) {
    deps = deps || {};
    if (!deps.tenant || !deps.tenant.id) throw new RecordRequestError("a record service is always for one tenant", "NO_TENANT");
    if (!deps.actor) throw new RecordRequestError("a record service is always for one actor", "NO_ACTOR");
    this.tenant = deps.tenant;
    this.tenantId = String(deps.tenant.id);
    this.actor = deps.actor;
    this.role = deps.role || null;
    this.roleSource = deps.roleSource || null;
    this.policy = recordPolicy(deps.tenant);
    this.now = deps.now || (() => new Date().toISOString());
    this.pseudonym = deps.pseudonym || (async () => null);
    this.repository = assertRepository(deps.repository);
    this.backend = new TenantBackend(this.repository, this.tenantId);
    /* The raw store is a CONSTRUCTOR LOCAL, never a property. It used to be `this.store`, directly
     * under a comment claiming it "is not exported from this object" - which it plainly was: every
     * route handler holds a RecordService (openService() returns one), and ClinicalStore.put() takes
     * no actor and performs none of authoriseWrite's checks - no EXECUTE ceiling, no
     * signedBy-must-be-the-actor check, no credential check, no audit row. Nothing in the repository
     * reached for it, so this closes a latent hole rather than fixing a live bypass, but it is the
     * single invariant this layer exists to hold and a comment is not an access control. */
    const store = new ClinicalStore({ backend: this.backend, bus: deps.bus || null });
    // The only write path.
    this.governed = new GovernedStore({ store, bus: deps.bus || null });
  }

  /** What a client needs to know before it writes: who the server thinks it is, and the mode. */
  descriptor() {
    const a = this.actor;
    return {
      service: "wardsynq-record",
      tenantId: this.tenantId,
      mode: this.policy.mode,
      externallyOwned: [...this.policy.externallyOwned],
      role: this.role,
      roleSource: this.roleSource,
      actor: {
        id: a.id, kind: a.kind, tier: a.tier, display: a.display, canSign: !!a.credential,
        // null = every type. A UI disables what the server will refuse rather than discovering it.
        readable: a.scope.read === null ? null : [...a.scope.read],
        writable: a.scope.write === null ? null : [...a.scope.write],
      },
      resourceTypes: [...RESOURCE_TYPES],
    };
  }

  /** The types this actor may read, for chart and feed filtering. */
  _readableTypes() { return RESOURCE_TYPES.filter((t) => canRead(this.actor, t)); }

  async _audit(action, fields) {
    const patientId = fields && fields.patientId;
    const event = {
      ts: this.now(), actor: this.actor.id, connectorId: "wardsynq", action,
      resourceCounts: (fields && fields.resourceCounts) || null,
      scope: (fields && fields.scope) || null,
      patientRefHash: patientId ? await this.pseudonym(patientId) : null,
      outcome: (fields && fields.outcome) || "ok",
    };
    return event;
  }

  _assertType(resourceType) {
    if (!RESOURCE_TYPES.includes(resourceType)) throw new RecordRequestError(`unknown resource type "${resourceType}"`, "UNKNOWN_TYPE");
  }

  async get(resourceType, id) {
    this._assertType(resourceType);
    const rec = await this.governed.get(this.actor, resourceType, id);
    await this.repository.auditOnly(this.tenantId, await this._audit("record.read", { scope: { resourceType, id, found: !!rec }, patientId: rec && (rec.patientId || (resourceType === "Patient" ? rec.id : null)) }));
    return rec;
  }

  async history(resourceType, id) {
    this._assertType(resourceType);
    const rows = await this.governed.history(this.actor, resourceType, id);
    const last = rows[rows.length - 1];
    await this.repository.auditOnly(this.tenantId, await this._audit("record.read", { scope: { resourceType, id, history: true, versions: rows.length }, patientId: last && (last.patientId || (resourceType === "Patient" ? last.id : null)) }));
    return rows;
  }

  async byPatient(resourceType, patientId) {
    this._assertType(resourceType);
    const rows = await this.governed.byPatient(this.actor, resourceType, patientId);
    await this.repository.auditOnly(this.tenantId, await this._audit("record.read", { scope: { resourceType, byPatient: true }, resourceCounts: { [resourceType]: rows.length }, patientId }));
    return rows;
  }

  /**
   * A roster: the latest version of every record of one type in this tenant. Capped, and audited
   * as a list rather than a read, because a ward list is the one legitimate cross-patient query.
   */
  async list(resourceType, limit) {
    this._assertType(resourceType);
    this.governed._assertRead(this.actor, resourceType);
    const rows = await this.repository.latestByType(this.tenantId, resourceType, limit);
    await this.repository.auditOnly(this.tenantId, await this._audit("record.list", { scope: { resourceType, limit: Number(limit) || null }, resourceCounts: { [resourceType]: rows.length } }));
    return rows;
  }

  /** The whole chart: latest version of every resource in the patient's compartment. */
  async chart(patientId) {
    const out = {};
    const counts = {};
    // Only the types this actor may read. A pharmacist's chart is the orders and nothing else, and
    // the absence of a key says so rather than an empty list pretending the notes do not exist.
    for (const t of this._readableTypes()) {
      const rows = await this.governed.byPatient(this.actor, t, patientId);
      out[t] = rows;
      counts[t] = rows.length;
    }
    await this.repository.auditOnly(this.tenantId, await this._audit("record.read", { scope: { chart: true }, resourceCounts: counts, patientId }));
    return out;
  }

  /** Everything written to this tenant after a cursor. How a second client learns what changed. */
  async changes(since, limit) {
    if (!this.governed) throw new RecordRequestError("no store", "NO_STORE");
    // The governed store has no change feed of its own; this is a READ and is gated the same way.
    this.governed._assertRead(this.actor);
    const raw = await this.repository.changes(this.tenantId, since, limit);
    // The cursor advances over everything; the records handed back are only what may be read.
    const page = { records: raw.records.filter((r) => canRead(this.actor, r.resourceType)), cursor: raw.cursor };
    await this.repository.auditOnly(this.tenantId, await this._audit("record.changes", { scope: { since: Number(since) || 0, cursor: page.cursor, withheld: raw.records.length - page.records.length }, resourceCounts: { records: page.records.length } }));
    return page;
  }

  /**
   * The native write door.
   *
   * @param {object} entity  a canonical entity (resourceType + id required)
   * @param {{expectedVersion?: number|null, idempotencyKey?: string|null, activePatientId?: string|null,
   *   origin?: {kind: string, id?: string}|null}} [opts]
   *   origin  who produced the content. `{kind: "ai", id: "maik"}` (or an entity with aiDrafted: true)
   *           makes the write an AI-kind actor's, delegated by this session's human, never the human's.
   * @returns {Promise<{record: object, replayed: boolean, actor: {id, kind, tier, onBehalfOf}}>}
   */
  async put(entity, opts) {
    opts = opts || {};
    const writer = isAiOrigin(entity, opts.origin) ? aiActorFor(this.actor, opts.origin) : this.actor;
    if (!entity || typeof entity !== "object") throw new RecordRequestError("a write needs an entity", "NO_ENTITY");
    if (typeof entity.resourceType !== "string") throw new RecordRequestError("entity.resourceType is required", "NO_TYPE");
    this._assertType(entity.resourceType);
    if (typeof entity.id !== "string" || !entity.id.trim()) throw new RecordRequestError("entity.id is required", "NO_ID");

    const key = opts.idempotencyKey ? String(opts.idempotencyKey) : null;
    if (key) {
      const prior = await this.repository.recall(this.tenantId, key);
      if (prior) {
        // Same key, same outcome. The record returned is the version that write produced, so a
        // client that lost the first response sees exactly what it would have seen.
        const versions = await this.repository.history(this.tenantId, prior.resourceType, prior.id);
        const rec = versions.find((v) => v.version === prior.version) || null;
        return { record: rec, replayed: true };
      }
    }

    const current = await this.repository.latest(this.tenantId, entity.resourceType, entity.id);
    const currentVersion = current ? current.version : 0;

    // Concurrency, the visible half. A client that says which version it read is refused if that
    // is no longer the latest, and is handed the latest so it can reconcile rather than guess.
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== null) {
      const expected = Number(opts.expectedVersion);
      if (!Number.isInteger(expected) || expected < 0) throw new RecordRequestError("expectedVersion must be a non-negative integer", "BAD_EXPECTED_VERSION");
      if (expected !== currentVersion) {
        throw new VersionConflictError(`expected version ${expected} but the record is at version ${currentVersion}`, { expectedVersion: expected, currentVersion, current });
      }
    }

    // Authority. A record another system owns is corrected by that system, through its connector,
    // not by the native door. This holds in BOTH modes: a lab result a LIS reported is not edited by
    // hand in a system-of-record deployment either.
    if (current && externallyOwned(current)) {
      throw new AuthorityError(
        `${entity.resourceType}/${entity.id} is owned by ${current.meta.source.system}; changes to it arrive through that system's connector`,
        "EXTERNAL_AUTHORITY", { system: current.meta.source.system, current }
      );
    }
    // In integration mode, the external EMR creates the identity and visit masters. WardSynQ does
    // not mint a patient the hospital's EMR does not know about.
    if (!current && this.policy.mode === MODE.INTEGRATION && this.policy.externallyOwned.includes(entity.resourceType)) {
      throw new AuthorityError(
        `${entity.resourceType} records are created by the hospital's EMR in integration mode`,
        "EXTERNAL_CREATE", { mode: this.policy.mode, externallyOwned: [...this.policy.externallyOwned] }
      );
    }

    const patientId = entity.resourceType === "Patient" ? entity.id : (entity.patientId || null);
    // The audit row lands in the SAME atomic append as the version it describes. The version it
    // names is the one the store is about to assign, which the concurrency check above just fixed.
    const auditEvent = await this._audit("record.write", {
      scope: { resourceType: entity.resourceType, id: entity.id, version: currentVersion + 1, mode: this.policy.mode, idempotent: !!key,
        ...(writer !== this.actor ? { writer: writer.id, writerKind: writer.kind, onBehalfOf: writer.onBehalfOf } : {}) },
      resourceCounts: { [entity.resourceType]: 1 },
      patientId,
    });
    this.backend.withWriteContext({ idempotencyKey: key, audit: auditEvent });

    let saved;
    try {
      saved = await this.governed.put(writer, entity, { activePatientId: opts.activePatientId || null });
    } catch (err) {
      this.backend.withWriteContext(null);
      if (err instanceof GovernanceError) {
        await this.repository.auditOnly(this.tenantId, await this._audit("record.denied", {
          scope: { resourceType: entity.resourceType, id: entity.id, reasons: err.reasons.map((r) => r.code),
            ...(writer !== this.actor ? { writer: writer.id, writerKind: writer.kind, onBehalfOf: writer.onBehalfOf } : {}) },
          patientId, outcome: "denied",
        }));
      }
      throw err;
    }
    return { record: saved, replayed: false, actor: { id: writer.id, kind: writer.kind, tier: writer.tier, onBehalfOf: writer.onBehalfOf } };
  }

  /**
   * The ingest door, for the Integration Hub. Hands back a governed handle that writes as whichever
   * ADAPTER actor the hub supplies, with audit per entity. The hub enforces the adapter ceiling
   * through the same GovernedStore, so an upstream EMR's "active order" lands as a draft here too.
   */
  governedForIngest(opts) {
    opts = opts || {};
    const self = this;
    // The hub's own replay guard is per process, and on a server a process is one request. The
    // durable version is the idempotency table: the source's event identity is recorded with the
    // FIRST entity that lands, so a re-sent bundle is recognised by the next request too.
    let pendingKey = opts.idempotencyKey ? String(opts.idempotencyKey) : null;
    return {
      /** True when this bundle has already landed. Checked by the route before the hub runs. */
      alreadyIngested: async () => (pendingKey ? !!(await self.repository.recall(self.tenantId, pendingKey)) : false),
      put: async (adapterActor, entity) => {
        const patientId = entity.resourceType === "Patient" ? entity.id : (entity.patientId || null);
        const current = await self.repository.latest(self.tenantId, entity.resourceType, entity.id);
        const auditEvent = await self._audit("record.ingest", {
          scope: { resourceType: entity.resourceType, id: entity.id, version: (current ? current.version : 0) + 1, system: entity.meta && entity.meta.source && entity.meta.source.system },
          resourceCounts: { [entity.resourceType]: 1 }, patientId,
        });
        auditEvent.actor = adapterActor.id;
        self.backend.withWriteContext({ audit: auditEvent, idempotencyKey: pendingKey });
        try {
          const saved = await self.governed.put(adapterActor, entity);
          pendingKey = null;                    // recorded with this write; later entities carry no key
          return saved;
        } catch (err) {
          self.backend.withWriteContext(null);
          throw err;
        }
      },
    };
  }
}

export {
  RESOURCE_TYPES, MODE, NATIVE_SYSTEM,
  AuthorityError, RecordRequestError,
  TenantBackend, RecordService, recordPolicy, actorForMembership, externallyOwned,
};
