/* functions/_wardsynq/staged.js — a unit of work over the repository port: several writes, one commit.
 *
 * WHY. A consultation is five writers (vitals, problems, prescriptions, tests, note), each of which
 * builds its own RecordService and calls repository.append() for itself. append() is atomic per call -
 * D1's batch is one transaction - but five calls are five transactions, so a failure in the fourth left
 * the first three on the chart: half a consultation. The store could always do better; nothing asked it
 * to.
 *
 * HOW. StagedRepository implements the whole port. Reads go to the real repository with everything
 * staged so far laid over the top, so a later writer sees an earlier writer's records exactly as if they
 * had landed (versions, byPatient, recall). append() does NOT write: it checks what the real store would
 * check (a version already taken, a key already used) and holds the records, their idempotency key and
 * their audit event. commit() sends all of it to the real repository in ONE append - every record, every
 * key, every audit row - which lands entirely or not at all. discard() drops it; nothing ever reached
 * the store.
 *
 * WHAT IT DOES NOT COVER. Reads' audit rows (auditOnly) are written immediately, because the reads really
 * happened. Anything a writer does outside the repository port is outside the unit of work; the
 * consultation writers do nothing of the kind (see test/wardsynq-consultation-atomic.test.mjs).
 * A concurrent writer that takes a version between staging and commit makes commit() throw the real
 * VersionConflictError, and still nothing is written.
 */

import { VersionConflictError } from "./repository.js";

const subjectOf = (rec) => (rec.resourceType === "Patient" ? rec.id : (rec.patientId || null));
const clone = (o) => JSON.parse(JSON.stringify(o));

class StagedRepository {
  constructor(real) {
    this.real = real;
    this.tenantId = null;
    this.records = [];            // in append order
    this.keys = [];               // [{ key, resourceType, id, version }]
    this.audits = [];
  }

  _tenant(tenantId) {
    if (this.tenantId && this.tenantId !== tenantId) throw new Error("staged unit of work spans two tenants");
    this.tenantId = tenantId;
  }
  _staged(resourceType, id) { return this.records.filter((r) => r.resourceType === resourceType && r.id === id); }
  _latestStagedById(filter) {
    const byId = new Map();
    for (const r of this.records) if (filter(r)) byId.set(r.id, r);
    return byId;
  }

  async latest(tenantId, resourceType, id) {
    const s = this._staged(resourceType, id);
    return s.length ? clone(s[s.length - 1]) : this.real.latest(tenantId, resourceType, id);
  }
  async history(tenantId, resourceType, id) {
    return [...(await this.real.history(tenantId, resourceType, id)), ...this._staged(resourceType, id).map(clone)];
  }
  async byPatient(tenantId, resourceType, patientId) {
    const real = await this.real.byPatient(tenantId, resourceType, patientId);
    const staged = this._latestStagedById((r) => r.resourceType === resourceType && subjectOf(r) === patientId);
    return [...real.filter((r) => !staged.has(r.id)), ...[...staged.values()].map(clone)];
  }
  async latestByType(tenantId, resourceType, limit) {
    const real = await this.real.latestByType(tenantId, resourceType, limit);
    const staged = this._latestStagedById((r) => r.resourceType === resourceType);
    return [...real.filter((r) => !staged.has(r.id)), ...[...staged.values()].map(clone)];
  }
  async recall(tenantId, key) {
    const k = this.keys.find((x) => x.key === key);
    return k ? { resourceType: k.resourceType, id: k.id, version: k.version } : this.real.recall(tenantId, key);
  }
  patientsByIdentifier(tenantId, keys) { return this.real.patientsByIdentifier(tenantId, keys); }
  idByHash(tenantId, h) { return this.real.idByHash(tenantId, h); }
  changes(tenantId, since, limit) { return this.real.changes(tenantId, since, limit); }
  auditOnly(tenantId, event) { return this.real.auditOnly(tenantId, event); }
  probe() { return this.real.probe(); }

  /** Holds a write, refusing now what the real store would refuse at commit. */
  async append(tenantId, records, ctx) {
    ctx = ctx || {};
    this._tenant(tenantId);
    for (const rec of records || []) {
      if (this._staged(rec.resourceType, rec.id).some((r) => r.version === rec.version)) {
        throw new VersionConflictError(`${rec.resourceType}/${rec.id} version ${rec.version} already staged`, { resourceType: rec.resourceType, id: rec.id, version: rec.version });
      }
      const cur = await this.real.latest(tenantId, rec.resourceType, rec.id);
      if (cur && cur.version >= rec.version) {
        throw new VersionConflictError(`${rec.resourceType}/${rec.id} version ${rec.version} already exists`, { resourceType: rec.resourceType, id: rec.id, version: rec.version });
      }
    }
    if (ctx.idempotencyKey && (this.keys.some((k) => k.key === ctx.idempotencyKey) || (await this.real.recall(tenantId, ctx.idempotencyKey)))) {
      throw new VersionConflictError("idempotency key already used", { idempotencyKey: ctx.idempotencyKey });
    }
    for (const rec of records || []) this.records.push(clone(rec));
    if (ctx.idempotencyKey && records && records.length) {
      const r = records[records.length - 1];
      this.keys.push({ key: ctx.idempotencyKey, resourceType: r.resourceType, id: r.id, version: r.version });
    }
    if (ctx.audit) this.audits.push(clone(ctx.audit));
    return { seq: null, staged: true };
  }

  get size() { return this.records.length; }

  /** Everything staged, in one atomic append. Throws whatever the real store throws; then nothing landed. */
  async commit() {
    if (!this.records.length) return { seq: null, committed: 0 };
    const out = await this.real.append(this.tenantId, this.records, { idempotency: this.keys, audits: this.audits });
    const committed = this.records.length;
    this.discard();
    return { ...out, committed };
  }

  discard() { this.records = []; this.keys = []; this.audits = []; }
}

export { StagedRepository };
