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
    function addPatient(p) {
      p = p || {};
      var rec = store.put("patient", {
        name: String(p.name || "").trim() || "Unnamed",
        age: String(p.age || "").trim(), sex: p.sex || "", phone: String(p.phone || "").trim()
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

    // The patient's current encounter (newest, non-deleted). One per patient for now.
    function currentEncounter(patientId) {
      var list = store.list("encounter", function (r) { return (r.patientId || (r.data && r.data.patientId)) === patientId; });
      list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      return list[0] || null;
    }

    // ---- the opd-emr localStore contract (source:"shared") ----
    var localStore = {
      // prefill vals for the assessment form (matches personal-clinic's `latest`)
      getConsult: function (patientId) {
        var enc = currentEncounter(patientId);
        return (enc && enc.data && enc.data.vals) ? enc.data.vals : {};
      },
      // save the current assessment: update the patient's current encounter (or create the first).
      // `fields` = the GHIS-name payload; `vals` = the form state for prefill (same as personal-clinic).
      saveConsult: function (patientId, fields, vals) {
        var enc = currentEncounter(patientId);
        var data = { patientId: patientId, vals: vals || {}, fields: fields || {} };
        if (enc) store.update(enc.id, data);
        else store.put("encounter", data, { patientId: patientId });
        // touch the patient so its list position + updatedAt reflect the new consult
        var pr = store.raw(patientId);
        if (pr && !pr.deleted) store.update(patientId, pr.data);
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
