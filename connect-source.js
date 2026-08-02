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
  // opts: { tenantId, patientRef, scope?, connectorId? } -> Promise<{ ok:true, bundle } | { error:<code> }>
  function pullContext(opts) {
    opts = opts || {};
    if (!opts.tenantId || !opts.patientRef) return Promise.resolve({ error: "tenant-and-patient-required" });
    return token().then(function (t) {
      if (!t) return { error: "not-signed-in" };
      var body = {
        tenantId: opts.tenantId, patientRef: opts.patientRef,
        scope: opts.scope || DEFAULT_SCOPE, connectorId: opts.connectorId || "fhir-r4",
      };
      return fetch(apiBase() + "/api/connect/context", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
        body: JSON.stringify(body),
      }).then(function (r) {
        return r.json().then(function (d) { return { s: r.status, d: d }; }, function () { return { s: r.status, d: {} }; });
      }).then(function (x) {
        return (x.s === 200 && x.d && x.d.ok) ? { ok: true, bundle: x.d.bundle } : { error: (x.d && x.d.error) || ("http-" + x.s) };
      }).catch(function () { return { error: "network" }; });
    });
  }

  // Pull + return only the resources of a given SCCM/FHIR type (e.g. "MedicationStatement", "Observation").
  // Defensive over the bundle shape: accepts { resources:[{resourceType,...}] } or a FHIR Bundle { entry:[{resource}] }.
  function resourcesOfType(opts, type) {
    return pullContext(opts).then(function (r) {
      if (!r.ok) return r;
      var b = r.bundle || {};
      var list = b.resources || b.entry || (b.resourceType === "Bundle" ? [] : []);
      var out = [];
      (list || []).forEach(function (e) { var res = (e && e.resource) || e; if (res && res.resourceType === type) out.push(res); });
      return { ok: true, resources: out, type: type };
    });
  }

  window.SMD_CONNECT = { tenants: tenants, pullContext: pullContext, resourcesOfType: resourcesOfType, DEFAULT_SCOPE: DEFAULT_SCOPE, apiBase: apiBase };
})();
