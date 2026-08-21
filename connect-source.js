/* connect-source.js — StewardMD Connect client data source (P2, increment 1). Exposes window.SMD_CONNECT.
 *
 * The GENERIC equivalent of ghis-proxy.js / ghis-meds.js (which are hardcoded to GIMSR): once a doctor
 * onboards ANY hospital via the Connect console, this pulls that patient's NORMALIZED (SCCM) EMR context
 * so the app's clinical surfaces (Ward Sync, ICU, patient summary) can render it -- "connect once, it just
 * works", the same way GIMSR does today, but for any connected hospital.
 *
 * PHI: ephemeral -- the pulled bundle is returned to the caller for rendering, never persisted here.
 * Auth/security: the caller's Firebase id token (window.SMD_AUTH) is sent; the SERVER derives identity and
 * verifies tenant membership on every call, so a client cannot read a hospital it does not belong to.
 * App-only: base is relative on the stewardmd.in website, absolute (https://stewardmd.in) inside the native
 * app, where a relative /api would hit the local Capacitor origin.
 */
(function () {
  "use strict";

  function apiBase() {
    try { var h = location.hostname || ""; return /(^|\.)stewardmd\.in$/i.test(h) ? "" : "https://stewardmd.in"; }
    catch (e) { return "https://stewardmd.in"; }
  }
  function token() {
    try { var u = window.SMD_AUTH && window.SMD_AUTH.currentUser; return (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  }
  var DEFAULT_SCOPE = ["Patient", "Encounter", "Condition", "MedicationStatement", "AllergyIntolerance", "Observation", "DiagnosticReport"];

  // The hospitals (tenants) the signed-in user belongs to. Resolves to [] when signed out / on error.
  function tenants() {
    return token().then(function (t) {
      if (!t) return [];
      return fetch(apiBase() + "/api/connect/onboard/tenants", { headers: { Authorization: "Bearer " + t } })
        .then(function (r) { return r.ok ? r.json() : { tenants: [] }; })
        .then(function (d) { return (d && d.tenants) || []; })
        .catch(function () { return []; });
    });
  }

  // Pull one patient's normalized SCCM bundle from a connected EMR.
  // opts: { tenantId, patientRef, scope?, connectorId?, connectionId? } -> Promise<{ ok:true, bundle } | { error:<code> }>
  // A REAL connected hospital (onboard wizard) uses the real-host pull route /onboard/pull/:id -- the Phase-0
  // /context endpoint is sandbox-locked (host allow-list) and cannot reach hosts like hapi.fhir.org. So we
  // prefer the tenant's onboard FHIR connection when it has one, and fall back to /context for sandbox tenants.
  function pullViaOnboard(t, tenantId, connectionId, patientRef) {
    return fetch(apiBase() + "/api/connect/onboard/pull/" + encodeURIComponent(connectionId), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      body: JSON.stringify({ tenantId: tenantId, patientId: patientRef }),
    }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }, function () { return { s: r.status, d: {} }; }); })
      .then(function (x) { return (x.s === 200 && x.d && x.d.ok) ? { ok: true, bundle: x.d.bundle } : { error: (x.d && x.d.error) || ("http-" + x.s) }; })
      .catch(function () { return { error: "network" }; });
  }
  function pullViaContext(t, opts) {
    var body = { tenantId: opts.tenantId, patientRef: opts.patientRef, scope: opts.scope || DEFAULT_SCOPE, connectorId: opts.connectorId || "fhir-r4" };
    return fetch(apiBase() + "/api/connect/context", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }, function () { return { s: r.status, d: {} }; }); })
      .then(function (x) { return (x.s === 200 && x.d && x.d.ok) ? { ok: true, bundle: x.d.bundle } : { error: (x.d && x.d.error) || ("http-" + x.s) }; })
      .catch(function () { return { error: "network" }; });
  }
  function pullContext(opts) {
    opts = opts || {};
    if (!opts.tenantId || !opts.patientRef) return Promise.resolve({ error: "tenant-and-patient-required" });
    return token().then(function (t) {
      if (!t) return { error: "not-signed-in" };
      if (opts.connectionId) return pullViaOnboard(t, opts.tenantId, opts.connectionId, opts.patientRef);   // caller already knows the connection (roster tap)
      return connections(opts.tenantId).then(function (cons) {
        var fhir = (cons || []).filter(function (c) { return c && c.connectionId; })[0];
        return fhir ? pullViaOnboard(t, opts.tenantId, fhir.connectionId, opts.patientRef) : pullViaContext(t, opts);
      });
    });
  }

  // The SCCM bundle uses FLAT typed arrays (bundle.medications, bundle.observations, ...) -- NOT FHIR entry[],
  // and there is NO resourceType. Map a requested type -> its bundle key. `patient` is a single object (-> [p]).
  var SCCM_KEY = {
    Patient: "patient", Encounter: "encounters", Condition: "conditions",
    MedicationStatement: "medications", MedicationRequest: "medications", Medication: "medications",
    AllergyIntolerance: "allergies", Observation: "observations",
    DiagnosticReport: "diagnosticReports", DocumentReference: "documents", ImagingStudy: "imagingStudies",
  };
  // Pull + return only the normalized SCCM resources of a given type (e.g. "MedicationStatement", "Observation").
  function resourcesOfType(opts, type) {
    return pullContext(opts).then(function (r) {
      if (!r.ok) return r;
      var b = r.bundle || {}, key = SCCM_KEY[type] || (type ? String(type).toLowerCase() + "s" : null);
      var v = key ? b[key] : null;
      var out = v == null ? [] : (Array.isArray(v) ? v : [v]);   // patient is a single object
      return { ok: true, resources: out, type: type };
    });
  }

  // Patient SEARCH by name (standard FHIR Patient?name=). -> Promise<{ ok:true, patients:[{id,name,gender,birthDate}] } | { error }>
  function searchPatients(opts) {
    opts = opts || {};
    if (!opts.tenantId || !opts.query) return Promise.resolve({ ok: true, patients: [] });
    return token().then(function (t) {
      if (!t) return { error: "not-signed-in" };
      return fetch(apiBase() + "/api/connect/patients/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
        body: JSON.stringify({ tenantId: opts.tenantId, query: opts.query, connectorId: opts.connectorId || "fhir-r4" }),
      }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }, function () { return { s: r.status, d: {} }; }); })
        .then(function (x) { return (x.s === 200 && x.d && x.d.ok) ? { ok: true, patients: x.d.patients || [] } : { error: (x.d && x.d.error) || ("http-" + x.s) }; })
        .catch(function () { return { error: "network" }; });
    });
  }

  // Doctor list from a connected hospital EMR (FHIR Practitioner?name=). Empty query -> the active list.
  // -> Promise<{ ok:true, doctors:[{id,name}] } | { error }>
  function listDoctors(opts) {
    opts = opts || {};
    if (!opts.tenantId) return Promise.resolve({ ok: true, doctors: [] });
    return token().then(function (t) {
      if (!t) return { error: "not-signed-in" };
      return fetch(apiBase() + "/api/connect/practitioners/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
        body: JSON.stringify({ tenantId: opts.tenantId, query: opts.query || "", connectorId: opts.connectorId || "fhir-r4" }),
      }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }, function () { return { s: r.status, d: {} }; }); })
        .then(function (x) { return (x.s === 200 && x.d && x.d.ok) ? { ok: true, doctors: x.d.doctors || [] } : { error: (x.d && x.d.error) || ("http-" + x.s) }; })
        .catch(function () { return { error: "network" }; });
    });
  }

  // A connected hospital's FHIR connections (to pick a connectionId for the worklist). -> Promise<[{connectionId,name,...}]>
  function connections(tenantId) {
    if (!tenantId) return Promise.resolve([]);
    return token().then(function (t) {
      if (!t) return [];
      return fetch(apiBase() + "/api/connect/onboard/all?tenant=" + encodeURIComponent(tenantId), { headers: { Authorization: "Bearer " + t } })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) { return (d && d.fhir) || []; })
        .catch(function () { return []; });
    });
  }
  // Today's roster (inpatient/OPD) from a connected FHIR hospital -> Promise<{ ok:true, rows } | { error }>.
  // rows use Ward Sync's shape: {patientId, patientFirstName, gender, bedName, employeeFirstName, deptDescription, dob, episodeId}.
  function worklist(opts) {
    opts = opts || {};
    if (!opts.tenantId || !opts.connectionId) return Promise.resolve({ error: "tenant-and-connection-required" });
    return token().then(function (t) {
      if (!t) return { error: "not-signed-in" };
      return fetch(apiBase() + "/api/connect/onboard/worklist/" + encodeURIComponent(opts.connectionId), {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
        body: JSON.stringify({ tenantId: opts.tenantId, date: opts.date || "" }),
      }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }, function () { return { s: r.status, d: {} }; }); })
        .then(function (x) { return (x.s === 200 && x.d && x.d.ok) ? { ok: true, rows: x.d.rows || [] } : { error: (x.d && x.d.error) || ("http-" + x.s) }; })
        .catch(function () { return { error: "network" }; });
    });
  }

  window.SMD_CONNECT = { tenants: tenants, connections: connections, worklist: worklist, pullContext: pullContext, resourcesOfType: resourcesOfType, searchPatients: searchPatients, listDoctors: listDoctors, DEFAULT_SCOPE: DEFAULT_SCOPE, apiBase: apiBase };
})();
