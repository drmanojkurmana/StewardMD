/* clinic-store.js — Shared Clinic EMR local store (Phase 5 core). Offline-first, in-memory records +
 * an append-only pending-change queue + a conflicts list, built on the clinic-model (Phase 1).
 *
 * Local-first: reads/writes are synchronous against an in-memory cache so the OPD stays responsive
 * offline; persistence to a durable backend (IndexedDB on native — a later adapter) is fire-and-forget
 * through the injected `persist` hooks. The sync engine (Phase 6) drains pending() to encrypted Drive
 * deltas and feeds remote deltas back through ingest().
 *
 * A local edit does NOT clobber on ingest: a remote change conflicting with an unsynced local edit is
 * parked in conflicts() for a review card (Phase 8) — clinical fields never silently overwrite.
 *
 * window.SMD_CLINIC_STORE.create(opts) + module.exports (Node-testable). Generic — no ONCQIS.
 */
(function () {
  "use strict";
  var M = (typeof require === "function") ? require("./clinic-model.js")
    : (typeof window !== "undefined" ? window.SMD_CLINIC_MODEL : null);

  // opts: { deviceId, userId, clinicId, clock?():number, persist?:{ saveRecord, saveChange,
  //         deleteChange, saveConflict, deleteConflict } }. persist hooks are optional + fire-and-forget.
  function create(opts) {
    opts = opts || {};
    var deviceId = opts.deviceId || "dev";
    var userId = opts.userId || "";
    var clinicId = opts.clinicId || "";
    var clock = opts.clock || function () { try { return Date.now(); } catch (e) { return 0; } };
    var persist = opts.persist || {};

    var records = {};       // id -> record envelope
    var pending = {};       // changeId -> change (not yet synced to Drive)
    var conflicts = {};     // recordId -> { local, incoming, fields, at }

    function ctx(extra) {
      return Object.assign({ now: clock(), deviceId: deviceId, userId: userId, clinicId: clinicId }, extra || {});
    }
    function fire(fn, arg) { try { if (typeof fn === "function") fn(arg); } catch (e) {} }
    function commit(rec, change) {
      records[rec.id] = rec;
      pending[change.changeId] = change;
      fire(persist.saveRecord, rec);
      fire(persist.saveChange, change);
      return rec;
    }

    var store = {
      // ---- local writes (queue a change for the next sync) ----
      put: function (entityType, data, extra) {                 // create a new record
        var r = M.create(entityType, data, ctx(extra));
        return commit(r.record, r.change);
      },
      update: function (id, data, extra) {                      // edit an existing record
        var cur = records[id]; if (!cur) return null;
        var r = M.edit(cur, data, ctx(extra));
        return commit(r.record, r.change);
      },
      remove: function (id, extra) {                            // soft-delete (tombstone)
        var cur = records[id]; if (!cur) return null;
        var r = M.remove(cur, ctx(extra));
        return commit(r.record, r.change);
      },

      // ---- reads ----
      get: function (id) { var r = records[id]; return (r && !r.deleted) ? r : null; },
      raw: function (id) { return records[id] || null; },       // incl. tombstones (for sync)
      list: function (entityType, filter) {
        var out = [];
        for (var id in records) {
          if (!records.hasOwnProperty(id)) continue;
          var r = records[id];
          if (r.deleted) continue;
          if (entityType && r.entityType !== entityType) continue;
          if (filter && !filter(r)) continue;
          out.push(r);
        }
        return out;
      },

      // ---- sync plumbing ----
      pending: function () { var a = []; for (var k in pending) if (pending.hasOwnProperty(k)) a.push(pending[k]); return a; },
      pendingCount: function () { return this.pending().length; },
      markSynced: function (changeIds) {
        (changeIds || []).forEach(function (id) { if (pending[id]) { delete pending[id]; fire(persist.deleteChange, id); } });
      },
      // ingest remote changes (already decrypted). Returns { applied, conflicts, skipped }.
      ingest: function (changes) {
        var res = { applied: 0, conflicts: 0, skipped: 0 };
        (changes || []).forEach(function (chg) {
          var local = records[chg.recordId];
          var r = M.apply(local, chg);
          if (r.kind === "created" || r.kind === "fastforward") {
            records[r.record.id] = r.record; fire(persist.saveRecord, r.record); res.applied++;
          } else if (r.kind === "conflict") {
            conflicts[chg.recordId] = { local: r.local, incoming: r.incoming, fields: r.fields, at: clock() };
            fire(persist.saveConflict, conflicts[chg.recordId]); res.conflicts++;
          } else {
            res.skipped++;   // duplicate / stale
          }
        });
        return res;
      },

      // ---- conflicts (Phase 8 surfaces these; resolve makes a fresh authoritative edit) ----
      conflicts: function () { var a = []; for (var id in conflicts) if (conflicts.hasOwnProperty(id)) a.push(Object.assign({ recordId: id }, conflicts[id])); return a; },
      conflictCount: function () { return this.conflicts().length; },
      resolveConflict: function (recordId, mergedData) {
        var c = conflicts[recordId]; if (!c) return null;
        // Base the resolution on the FURTHER-ahead side so the new version supersedes both branches.
        var base = (c.incoming.version >= c.local.version) ? c.incoming : c.local;
        var r = M.edit(base, mergedData, ctx());
        records[r.record.id] = r.record; pending[r.change.changeId] = r.change;
        delete conflicts[recordId];
        fire(persist.saveRecord, r.record); fire(persist.saveChange, r.change); fire(persist.deleteConflict, recordId);
        return r.record;
      },

      // ---- hydrate from a durable backend at startup (records + pending + conflicts) ----
      hydrate: function (snapshot) {
        snapshot = snapshot || {};
        (snapshot.records || []).forEach(function (r) { records[r.id] = r; });
        (snapshot.pending || []).forEach(function (c) { pending[c.changeId] = c; });
        (snapshot.conflicts || []).forEach(function (c) { conflicts[c.recordId] = c; });
        return this;
      },
      _debug: function () { return { records: records, pending: pending, conflicts: conflicts }; }
    };
    return store;
  }

  var API = { create: create };
  if (typeof window !== "undefined") window.SMD_CLINIC_STORE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
