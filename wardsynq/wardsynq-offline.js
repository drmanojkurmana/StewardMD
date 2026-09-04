/* wardsynq/wardsynq-offline.js — offline charting and reconciliation. HAZ-DOWN-01.
 *
 * The requirement is not "keep working when the network drops". Any queue does that. The requirement
 * is ZERO SILENT OVERWRITES on the way back, and that is the hard half: two clinicians charting the
 * same patient from two devices during an outage will both be right, and last-write-wins will throw
 * one of them away without telling anybody.
 *
 * So this module never resolves a genuine clinical conflict. It detects them, refuses to guess, and
 * hands them to a human. The only things it merges automatically are changes that cannot disagree.
 *
 *   outage -> local append-only journal -> reconnect -> three-way compare against the
 *             common ancestor -> auto-merge only where fields are disjoint
 *             -> everything else becomes a CONFLICT for a clinician to resolve
 *
 * THREE-WAY, NOT TWO-WAY. Comparing local against remote can only tell you they differ. Comparing
 * both against the version they were BOTH derived from tells you who changed what, which is the
 * difference between "these disagree" and "one of you edited the dose and the other edited the
 * route, and both are fine".
 *
 * WHAT IS NEVER AUTO-MERGED, regardless of field disjointness: anything already signed, anything
 * that has been administered, and any entity where both sides changed the same field to different
 * values. A signed record is somebody's name against a clinical decision, and quietly folding an
 * offline edit into it forges that signature.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-offline.test.mjs
 */

const OUTCOME = Object.freeze({
  APPLIED: "applied",         // no remote change; the local edit lands cleanly
  MERGED: "merged",           // both changed, disjoint fields, safely combined
  CONFLICT: "conflict",       // needs a human
  UNCHANGED: "unchanged",     // nothing to do
});

/** Fields that are bookkeeping rather than clinical content. */
const IGNORED = Object.freeze(["meta", "writtenBy", "version", "_rev"]);

/** Entities in these states are never auto-merged into. */
const SEALED_STATUSES = Object.freeze(["active", "completed", "final", "administered", "signed"]);

class OfflineError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "OfflineError";
    this.code = code || "OFFLINE_VIOLATION";
  }
}

/**
 * Durable backends for the journal. The in-memory one is for tests and for a caller that genuinely
 * wants no persistence; IndexedDB is what a ward workstation uses.
 *
 * The interface is deliberately tiny, because the only thing that matters is that `append` has
 * reached durable storage before it resolves.
 */
class MemoryJournalBackend {
  constructor() { this.rows = []; }
  async open() {}
  async append(entry) { this.rows.push(JSON.parse(JSON.stringify(entry))); }
  async all() { return this.rows.map((r) => JSON.parse(JSON.stringify(r))); }
  async remove(keys) {
    const drop = new Set(keys);
    this.rows = this.rows.filter((r) => !drop.has(`${r.resourceType}/${r.id}/${r.at}`));
  }
}

/**
 * IndexedDB backend. Never touches `indexedDB` at import time, so this module loads in Node.
 *
 * A journal entry is written in its own transaction and the promise resolves on `transaction.
 * oncomplete`, not on `request.onsuccess`: a request succeeding only means the write was accepted
 * into the transaction, and a device that dies between those two moments would lose the edit while
 * having told the clinician it was saved.
 */
class IndexedDBJournalBackend {
  constructor(opts) {
    opts = opts || {};
    this.dbName = opts.dbName || "wardsynq-offline";
    this.storeName = opts.storeName || "journal";
    this.db = null;
  }
  async open() {
    if (this.db) return;
    const idb = (typeof globalThis !== "undefined" && globalThis.indexedDB) || null;
    if (!idb) throw new OfflineError("IndexedDB is not available in this environment", "NO_INDEXEDDB");
    this.db = await new Promise((resolve, reject) => {
      const req = idb.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async append(entry) {
    await this.open();
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).put({ key: `${entry.resourceType}/${entry.id}/${entry.at}`, entry });
      // Resolve on COMPLETE. See the note above: request success is not durability.
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async all() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve((req.result || []).map((r) => r.entry));
      req.onerror = () => reject(req.error);
    });
  }
  async remove(keys) {
    await this.open();
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readwrite");
      const os = tx.objectStore(this.storeName);
      for (const k of keys) os.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * The local journal. Append-only, exactly like the server store, because an outage is precisely when
 * a device is most likely to be closed, dropped or run out of battery mid-edit.
 *
 * DURABILITY IS THE POINT. `record()` is async and does not resolve until the entry has reached the
 * backend. A UI that tells a clinician their note is saved before this resolves is lying, and the
 * whole reason this hazard stayed PARTIAL until now is that an in-memory journal loses everything a
 * workstation was holding the moment it loses power.
 */
class OfflineJournal {
  constructor(deps) {
    deps = deps || {};
    this.now = deps.now || (() => new Date().toISOString());
    this.backend = deps.backend || new MemoryJournalBackend();
    this.entries = [];
    this.restored = false;
  }

  /** Loads anything a previous session left behind. Call once at startup, before charting. */
  async open() {
    await this.backend.open();
    const rows = await this.backend.all();
    // Restored in the order they were written, so reconciliation sees them as they happened.
    this.entries = rows
      .filter((e) => e && e.resourceType && e.id && e.at)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((e) => Object.freeze(e));
    this.restored = true;
    return this.entries.length;
  }

  /**
   * Records one local edit against the version it was derived from. The BASE is the whole point: an
   * edit that does not say what it was derived from cannot be three-way merged later, only guessed
   * at, so it is required.
   *
   * Async, and durable before it resolves.
   */
  async record(entity, base, actorId) {
    if (!entity || !entity.resourceType || !entity.id) throw new OfflineError("an offline edit needs an identified entity", "NO_ENTITY");
    if (!actorId) throw new OfflineError("an offline edit must name who made it", "NO_ACTOR");
    if (base === undefined) throw new OfflineError("an offline edit must record the version it was derived from", "NO_BASE");
    const entry = {
      at: this.now(), actorId,
      resourceType: entity.resourceType, id: entity.id,
      entity: JSON.parse(JSON.stringify(entity)),
      base: base === null ? null : JSON.parse(JSON.stringify(base)),
    };
    // Durable FIRST. If this throws, the caller learns the edit was not saved, which is the honest
    // outcome; appending to memory first would let a UI report success for a lost note.
    await this.backend.append(entry);
    const frozen = Object.freeze(entry);
    this.entries.push(frozen);
    return frozen;
  }

  pending() { return [...this.entries]; }

  /** Drops entries that have been reconciled. Everything else stays for the next attempt. */
  async clear(keys) {
    const done = new Set(keys || []);
    await this.backend.remove([...done]);
    this.entries = this.entries.filter((e) => !done.has(`${e.resourceType}/${e.id}/${e.at}`));
    return this.entries.length;
  }

  get size() { return this.entries.length; }
}

const key = (e) => `${e.resourceType}/${e.id}/${e.at}`;

/** Clinically meaningful fields that differ between two versions. */
function changedFields(from, to) {
  if (!from) return Object.keys(to || {}).filter((k) => !IGNORED.includes(k));
  const out = [];
  for (const k of new Set([...Object.keys(from), ...Object.keys(to || {})])) {
    if (IGNORED.includes(k)) continue;
    if (JSON.stringify(from[k]) !== JSON.stringify(to[k])) out.push(k);
  }
  return out;
}

/**
 * The three-way compare for one entity.
 *
 * @param {{base: object|null, local: object, remote: object|null}} input
 * @returns {{outcome: string, merged: object|null, conflicts: {field, base, local, remote}[], reason: string}}
 */
function reconcileOne({ base, local, remote }) {
  if (!remote) {
    // Nothing upstream: either genuinely new, or created offline. Nothing to conflict with.
    return { outcome: OUTCOME.APPLIED, merged: local, conflicts: [], reason: "no server version exists" };
  }

  const localChanges = changedFields(base, local);
  const remoteChanges = changedFields(base, remote);

  if (!localChanges.length) {
    return { outcome: OUTCOME.UNCHANGED, merged: remote, conflicts: [], reason: "the offline device changed nothing" };
  }
  if (!remoteChanges.length) {
    return { outcome: OUTCOME.APPLIED, merged: { ...remote, ...pick(local, localChanges) }, conflicts: [], reason: "only the offline device changed this record" };
  }

  // Both sides moved. A sealed record is never folded into, even across disjoint fields: quietly
  // merging an offline edit into a signed order forges the signature already on it.
  const sealed = SEALED_STATUSES.includes(remote.status) || !!remote.signedBy || !!remote.administeredAt;
  if (sealed) {
    return {
      outcome: OUTCOME.CONFLICT,
      merged: null,
      conflicts: localChanges.map((f) => ({ field: f, base: base ? base[f] : undefined, local: local[f], remote: remote[f] })),
      reason: "the server version has been signed, administered or completed since this device went offline",
    };
  }

  const overlapping = localChanges.filter((f) => remoteChanges.includes(f) && JSON.stringify(local[f]) !== JSON.stringify(remote[f]));
  if (overlapping.length) {
    return {
      outcome: OUTCOME.CONFLICT,
      merged: null,
      conflicts: overlapping.map((f) => ({ field: f, base: base ? base[f] : undefined, local: local[f], remote: remote[f] })),
      reason: "both sides changed the same field to different values",
    };
  }

  // Disjoint edits: safe to combine, and only because we know from the BASE who changed what.
  return {
    outcome: OUTCOME.MERGED,
    merged: { ...remote, ...pick(local, localChanges) },
    conflicts: [],
    reason: `offline changed ${localChanges.join(", ")}; server changed ${remoteChanges.join(", ")}`,
  };
}

function pick(obj, fields) {
  const out = {};
  for (const f of fields) out[f] = obj[f];
  return out;
}

/**
 * Reconciles a whole journal against the server on reconnection.
 *
 * Returns everything: what landed, what merged, and what needs a person. Nothing is discarded, and
 * a conflict is never resolved by preference, recency or device. Both versions survive so a
 * clinician can see what each of them actually said.
 */
class Reconciler {
  /** @param {{store: object, bus?: object, now?: () => string}} deps */
  constructor(deps) {
    deps = deps || {};
    if (!deps.store) throw new OfflineError("reconciliation needs a store", "NO_STORE");
    this.store = deps.store;
    this.bus = deps.bus || null;
    this.now = deps.now || (() => new Date().toISOString());
  }

  async reconcile(journal, opts) {
    opts = opts || {};
    const applied = [], merged = [], conflicts = [], unchanged = [];

    for (const entry of journal.pending()) {
      const remote = await this.store.get(entry.resourceType, entry.id);
      const r = reconcileOne({ base: entry.base, local: entry.entity, remote });

      if (r.outcome === OUTCOME.CONFLICT) {
        const record = {
          key: key(entry), resourceType: entry.resourceType, id: entry.id,
          patientId: entry.entity.patientId || null,
          offlineBy: entry.actorId, offlineAt: entry.at,
          reason: r.reason, conflicts: r.conflicts,
          local: entry.entity, remote, base: entry.base,
          detectedAt: this.now(), resolved: false,
        };
        conflicts.push(record);
        if (this.bus) await this.bus.emit("offline.conflict", record);
        continue;
      }
      if (r.outcome === OUTCOME.UNCHANGED) { unchanged.push(key(entry)); continue; }

      if (!opts.dryRun) await this.store.put(r.merged);
      (r.outcome === OUTCOME.MERGED ? merged : applied).push({ key: key(entry), id: entry.id, reason: r.reason });
    }

    // Settled entries leave the journal; conflicts stay until a human resolves them, so a device
    // that dies mid-reconciliation comes back still holding the unresolved work.
    if (!opts.dryRun) {
      const settled = [...applied.map((a) => a.key), ...merged.map((m) => m.key), ...unchanged];
      if (settled.length) await journal.clear(settled);
    }

    const summary = { applied, merged, conflicts, unchanged, total: applied.length + merged.length + conflicts.length + unchanged.length, stillPending: journal.size };
    if (this.bus) await this.bus.emit("offline.reconciled", { ...summary, conflictCount: conflicts.length });
    return summary;
  }

  /**
   * Applies a human's decision on a conflict. There is deliberately no "resolve all", no automatic
   * preference and no timeout that picks a side: the entire value of this module is that a person
   * looked at both versions.
   */
  async resolve(conflict, choice, actorId, rationale) {
    if (!actorId) throw new OfflineError("resolving a conflict must name the clinician", "NO_ACTOR");
    if (!["local", "remote", "manual"].includes(choice && choice.take)) {
      throw new OfflineError("a resolution must take the offline version, the server version, or a manually merged one", "NO_CHOICE");
    }
    if (!rationale || String(rationale).trim().length < 5) {
      throw new OfflineError("a resolution must say why, because somebody's charting is being discarded", "NO_RATIONALE");
    }
    const chosen = choice.take === "local" ? conflict.local
      : choice.take === "remote" ? conflict.remote
        : choice.entity;
    if (!chosen) throw new OfflineError("a manual resolution must supply the merged entity", "NO_ENTITY");

    const resolved = {
      ...chosen,
      conflictResolution: {
        by: actorId, at: this.now(), took: choice.take, rationale: String(rationale).trim(),
        discarded: choice.take === "local" ? conflict.remote : choice.take === "remote" ? conflict.local : { local: conflict.local, remote: conflict.remote },
      },
    };
    await this.store.put(resolved);
    conflict.resolved = true;
    if (this.bus) await this.bus.emit("offline.conflict.resolved", { key: conflict.key, by: actorId, took: choice.take });
    return resolved;
  }
}

export {
  OUTCOME, SEALED_STATUSES, OfflineError,
  OfflineJournal, MemoryJournalBackend, IndexedDBJournalBackend,
  Reconciler, reconcileOne, changedFields,
};
