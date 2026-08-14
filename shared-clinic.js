/* shared-clinic.js — Shared Clinic EMR orchestrator (Phase 11 wiring). Bridges the sync core
 * (clinic-store + clinic-sync + clinic-crypto) to the EXISTING OPD-EMR overlay through the same
 * 2-method `localStore = {getConsult, saveConsult}` contract opd-emr already binds to for source:"local".
 * So a shared clinic reuses the whole assessment UI, ASSESS_SCHEMA, Rx pad, investigations and vitals —
 * only the storage behind the seam changes (synced clinic-store instead of single-device localStorage).
 *
 * A shared-clinic patient is a `patient` record; each patient has one CURRENT `encounter` record that
 * the assessment form reads (prefill) and writes — both flow through clinic-store, so every change is
 * versioned + queued for the encrypted Drive-delta sync. Per-visit encounter history is a later
 * enhancement (keyed by the queue visit/session); this milestone matches personal-clinic's single
 * "latest" behaviour so the drop-in is exact.
 *
 * The sync loop (Phase 7), Drive transport (Phase 6 native), device authz (Phase 4) and clinic
 * create/join (Phase 2/3) attach to this orchestrator next. window.SMD_SHARED_CLINIC.create(opts).
 * Generic — no ONCQIS / oncology.
 */
(function () {
  "use strict";
  function assign(t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } return t; }

  // opts: { store (required), sync?, syncEngine wiring later }
  function create(opts) {
    opts = opts || {};
    var store = opts.store;
    var sync = opts.sync || null;   // clinic-sync instance (optional until Drive wired)

    // ---- patients ----
    // SMD-<clinic code>-<seq> for every patient at creation. Code = last-3 of the clinic id so all devices
    // agree; queue-created patients pass the same-derived mrn, so ids are consistent across entry points.
    function clinicCode() { var s = String(opts.clinicId || "").replace(/[^a-z0-9]/gi, "").toUpperCase(); return s.slice(-3) || "CLN"; }
    function pad3(n) { n = String(n); while (n.length < 3) n = "0" + n; return n; }
    function addPatient(p) {
      p = p || {};
      var mrn = String(p.mrn || "").trim(); if (!mrn) mrn = "SMD-" + clinicCode() + "-" + pad3(store.list("patient").length + 1);
      var rec = store.put("patient", {
        name: String(p.name || "").trim() || "Unnamed",
        age: String(p.age || "").trim(), sex: p.sex || "", phone: String(p.phone || "").trim(),
        mrn: mrn
      });
      return rec.id;
    }
    function listPatients() {
      return store.list("patient")
        .map(function (r) { return assign({ id: r.id, updatedAt: r.updatedAt }, r.data); })
        .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    }
    function getPatient(id) { var r = store.get(id); return r ? assign({ id: r.id }, r.data) : null; }
    function deletePatient(id) { store.remove(id); }

    // All non-deleted encounters for a patient, newest first (the visit footprint).
    function encountersFor(patientId) {
      var list = store.list("encounter", function (r) { return (r.patientId || (r.data && r.data.patientId)) === patientId; });
      list.sort(function (a, b) { return (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0); });
      return list;
    }
    function currentEncounter(patientId) { return encountersFor(patientId)[0] || null; }

    // Per-consult-open history: opening a patient starts a fresh visit; the first save of that visit
    // creates a NEW dated encounter, later saves in the same open update it. Reopening = a new entry.
    var _active = {};   // patientId -> active encounter id for the current open (null after startConsult)
    function startConsult(patientId) { _active[patientId] = null; }

    // ---- the opd-emr localStore contract (source:"shared") ----
    var localStore = {
      // prefill vals for the assessment form: carry forward the latest visit (continuity)
      getConsult: function (patientId) {
        var enc = currentEncounter(patientId);
        return (enc && enc.data && enc.data.vals) ? enc.data.vals : {};
      },
      // save the current assessment. `fields` = the GHIS-name payload; `vals` = form state for prefill;
      // `meta.author` = who wrote it. First save of a consult-open appends a new dated encounter.
      saveConsult: function (patientId, fields, vals, meta) {
        meta = meta || {};
        var data = { patientId: patientId, vals: vals || {}, fields: fields || {}, author: meta.author || "" };
        var activeId = _active[patientId], raw = activeId && store.raw(activeId);
        if (raw && !raw.deleted) store.update(activeId, data);
        else { var rec = store.put("encounter", data, { patientId: patientId }); _active[patientId] = rec.id; }
        // touch the patient so its list position + updatedAt reflect the new consult
        var pr = store.raw(patientId);
        if (pr && !pr.deleted) store.update(patientId, pr.data);
      },
      startConsult: startConsult,
      // chronological footprint: every encounter (+ later Rx/investigations/documents) newest-first
      timeline: function (patientId) {
        return encountersFor(patientId).map(function (r) {
          var d = r.data || {};
          return { id: r.id, ts: r.createdAt || r.updatedAt || 0, kind: "note", author: d.author || "", vals: d.vals || {}, fields: d.fields || {} };
        });
      }
    };

    // ---- sync surface (thin pass-through; loop cadence is Phase 7) ----
    function syncNow() { return sync ? sync.syncOnce() : Promise.resolve({ skipped: "no-sync" }); }
    function pendingCount() { return store.pendingCount(); }
    function conflicts() { return store.conflicts(); }
    function conflictCount() { return store.conflictCount(); }
    function resolveConflict(recordId, mergedData) { return store.resolveConflict(recordId, mergedData); }

    return {
      addPatient: addPatient, listPatients: listPatients, getPatient: getPatient, deletePatient: deletePatient,
      currentEncounter: currentEncounter,
      localStore: localStore,
      syncNow: syncNow, pendingCount: pendingCount,
      conflicts: conflicts, conflictCount: conflictCount, resolveConflict: resolveConflict,
      _store: store
    };
  }

  var API = { create: create };
  if (typeof window !== "undefined") window.SMD_SHARED_CLINIC = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
