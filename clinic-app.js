/* clinic-app.js — Shared Clinic EMR bootstrap (Phase 6/7 wiring). Assembles the tested core
 * (clinic-crypto + clinic-store + clinic-sync + clinic-drive + shared-clinic) into ONE live, on-device
 * instance and gives it the two things a real EMR needs beyond the pure logic: durable local persistence
 * (so data survives an app restart) and a sync cadence (so devices converge without the user tapping
 * "sync").
 *
 * Local persistence: the whole store snapshot (records + pending queue + conflicts + sync cursor) is
 * written to a single, DEBOUNCED, AES-GCM-ENCRYPTED blob in localStorage, keyed per clinic. Encrypted at
 * rest with the same clinic key as the Drive deltas — so a shared nurse device holds no readable PHI, and
 * the clinic secret is never persisted (it is supplied by the Phase 2/3 join/unlock flow each launch).
 * ponytail: localStorage single-blob, debounced; move to IndexedDB if a clinic's data outgrows ~5MB.
 *
 * Sync cadence: an interval (~15s) plus, in a browser, `online` + `visibilitychange` reconnect kicks and
 * a `kick()` the OPD calls after a save. Overlapping cycles are coalesced (one in flight at a time).
 *
 * window.SMD_CLINIC_APP.create(cfg) -> Promise<instance>. Flag-gated by the caller (smd_shared_clinic,
 * default OFF). Generic — no ONCQIS / oncology.
 */
(function () {
  "use strict";
  var g = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : this);
  function mod(name, glob) { return (typeof require === "function") ? require(name) : (g[glob] || null); }
  var CRY = mod("./clinic-crypto.js", "SMD_CLINIC_CRYPTO");
  var STORE = mod("./clinic-store.js", "SMD_CLINIC_STORE");
  var SYNC = mod("./clinic-sync.js", "SMD_CLINIC_SYNC");
  var DRIVE = mod("./clinic-drive.js", "SMD_CLINIC_DRIVE");
  var ORCH = mod("./shared-clinic.js", "SMD_SHARED_CLINIC");

  function vals(map) { var a = []; for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) a.push(map[k]); return a; }
  function conflictArr(cmap) {
    var a = []; for (var id in cmap) if (Object.prototype.hasOwnProperty.call(cmap, id)) {
      var c = {}; c.recordId = id; for (var k in cmap[id]) if (Object.prototype.hasOwnProperty.call(cmap[id], k)) c[k] = cmap[id][k]; a.push(c);
    } return a;
  }

  // cfg: { clinicId, deviceId, userId, secret, salt, storageKey?, intervalMs?,
  //        storage?, driveFetch?, getToken?, crypto?, transport?, clock?, bindEvents? }
  // secret+salt come from the clinic join/unlock (Phase 2/3); storage/driveFetch/getToken/crypto/transport
  // are injectable for tests. Returns a Promise so the encrypted local snapshot is decrypted+hydrated first.
  function create(cfg) {
    cfg = cfg || {};
    var clinicId = cfg.clinicId, deviceId = cfg.deviceId, userId = cfg.userId || "";
    var storage = cfg.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    var key = cfg.storageKey || ("smd_clinic_" + clinicId);
    var intervalMs = cfg.intervalMs || 15000;
    var bindEvents = (cfg.bindEvents !== false) && (typeof window !== "undefined");
    var crypto = cfg.crypto || CRY.create(cfg.secret, cfg.salt);

    // ---- durable snapshot I/O (single encrypted blob) ----
    function readSnapshot() {
      if (!storage) return Promise.resolve(null);
      var blob = null; try { blob = storage.getItem(key); } catch (e) {}
      if (!blob) return Promise.resolve(null);
      return Promise.resolve(crypto.decrypt(blob)).then(function (str) { try { return JSON.parse(str); } catch (e) { return null; } }).catch(function () { return null; });
    }

    return readSnapshot().then(function (snap) {
      snap = snap || {};
      var store = STORE.create({ deviceId: deviceId, userId: userId, clinicId: clinicId, clock: cfg.clock, persist: hooks() });
      store.hydrate({ records: snap.records || [], pending: snap.pending || [], conflicts: snap.conflicts || [] });
      var syncState = snap.syncState || { batch: 0, cursor: {} };

      var transport = cfg.transport || DRIVE.create(clinicId, { fetch: cfg.driveFetch, getToken: cfg.getToken });
      var sync = SYNC.create({ store: store, transport: transport, crypto: crypto, deviceId: deviceId, clinicId: clinicId, state: syncState, onState: function () { scheduleSave(); } });
      var orch = ORCH.create({ store: store, sync: sync, clinicId: clinicId });

      // ---- persistence: debounced full-snapshot save (every store/sync mutation schedules it) ----
      var saveTimer = null, saving = null;
      function snapshot() {
        var d = store._debug();
        return { v: 1, records: vals(d.records), pending: vals(d.pending), conflicts: conflictArr(d.conflicts), syncState: sync.state() };
      }
      function saveNow() {
        if (saveTimer) { try { clearTimeout(saveTimer); } catch (e) {} saveTimer = null; }
        if (!storage) return Promise.resolve();
        saving = Promise.resolve(crypto.encrypt(JSON.stringify(snapshot())))
          .then(function (blob) { try { storage.setItem(key, blob); } catch (e) {} });
        return saving;
      }
      function scheduleSave() {
        if (!storage || saveTimer) return;
        if (typeof setTimeout !== "function") { saveNow(); return; }
        saveTimer = setTimeout(function () { saveTimer = null; saveNow(); }, 800);
      }
      function hooks() {
        var s = function () { scheduleSave(); };
        return { saveRecord: s, saveChange: s, deleteChange: s, saveConflict: s, deleteConflict: s };
      }

      // ---- sync cadence (coalesced) ----
      var inflight = null, timer = null, kickTimer = null;
      function syncNow() {
        if (inflight) return inflight;
        inflight = Promise.resolve(sync.syncOnce()).then(function (r) { inflight = null; return r; }, function (e) { inflight = null; return { error: String(e) }; });
        return inflight;
      }
      function kick() { // debounced sync soon (called after a save/edit)
        if (kickTimer || typeof setTimeout !== "function") return;
        kickTimer = setTimeout(function () { kickTimer = null; syncNow(); }, 1200);
      }
      var onOnline = function () { syncNow(); };
      var onVisible = function () { if (typeof document === "undefined" || document.visibilityState === "visible") syncNow(); };
      function start(ms) {
        stop();
        if (typeof setInterval === "function") timer = setInterval(syncNow, ms || intervalMs);
        if (bindEvents) { try { window.addEventListener("online", onOnline); document.addEventListener("visibilitychange", onVisible); } catch (e) {} }
        syncNow();
        return inst;
      }
      function stop() {
        if (timer) { try { clearInterval(timer); } catch (e) {} timer = null; }
        if (bindEvents) { try { window.removeEventListener("online", onOnline); document.removeEventListener("visibilitychange", onVisible); } catch (e) {} }
        return inst;
      }
      function destroy() { stop(); if (kickTimer) { try { clearTimeout(kickTimer); } catch (e) {} kickTimer = null; } return saveNow(); }

      var inst = {
        // clinic data + the opd-emr localStore bridge (source:"shared")
        addPatient: function (p) { var id = orch.addPatient(p); kick(); return id; },
        listPatients: orch.listPatients, getPatient: orch.getPatient,
        deletePatient: function (id) { orch.deletePatient(id); kick(); },
        currentEncounter: orch.currentEncounter,
        localStore: {
          getConsult: orch.localStore.getConsult,
          saveConsult: function (pid, fields, v, meta) { orch.localStore.saveConsult(pid, fields, v, meta); kick(); },
          startConsult: orch.localStore.startConsult,
          timeline: orch.localStore.timeline
        },
        // sync + persistence control
        syncNow: syncNow, kick: kick, start: start, stop: stop, destroy: destroy, saveNow: saveNow,
        pendingCount: orch.pendingCount, conflicts: orch.conflicts, conflictCount: orch.conflictCount, resolveConflict: orch.resolveConflict,
        available: function () { return transport.available ? transport.available() : true; },
        _store: store, _sync: sync, _orch: orch
      };
      return inst;
    });
  }

  var API = { create: create };
  if (typeof window !== "undefined") window.SMD_CLINIC_APP = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
