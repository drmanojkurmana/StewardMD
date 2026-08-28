/* insulin-flags.js - Insulin module feature-flag registry (SMD_INSULIN_FLAGS).
 * Resolution per flag: ?query param -> localStorage -> default. Mirrors thorex-flags.js. */
(function () {
  "use strict";
  // type: bool. def: default when unset. query: ?alias (or null). All default OFF.
  var DEFS = {
    smd_insulin:      { type: "bool", def: true,  query: "insulin",     desc: "Insulin module master flag (home tile + module). DEFAULT ON (owner enabled). Hide with ?insulin=0." },
    smd_insulin_dka:  { type: "bool", def: true, query: "insulin_dka", desc: "Clinician DKA insulin workflow. Access-gated. PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on' 2026-08-16). Hide with ?insulin_dka=0." },
    smd_insulin_peds: { type: "bool", def: true, query: "insulin_peds", desc: "Pediatric insulin workflow. Access-gated. PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on' 2026-08-16). Hide with ?insulin_peds=0." },
    // Ask MaiK: free text -> MaiK PRE-FILLS the calculator (mode + inputs) for the doctor to check and
    // press Calculate. It never prints a dose; the units still come from INSULIN_ENGINE via compute().
    // DEFAULT OFF - new clinical surface, extraction not yet proven in practice. Show with ?insulin_ask=1.
    smd_insulin_ask:  { type: "bool", def: false, query: "insulin_ask", desc: "Ask MaiK inside the insulin calculator (free text pre-fills the form; never answers the dose). DEFAULT OFF. Show with ?insulin_ask=1." }
  };
  function store()  { try { return localStorage; } catch (e) { return null; } }
  function search() { try { return (location && location.search) || ""; } catch (e) { return ""; } }
  function rawQuery(alias) {
    if (!alias) return null;
    var m = search().match(new RegExp("[?&]" + alias + "=([^&]+)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function coerce(def, raw) {
    if (raw == null) return def.def;
    return raw === "1" || raw === "on" || raw === "true";
  }
  function get(key) {
    var def = DEFS[key]; if (!def) return null;
    var q = rawQuery(def.query); if (q != null) return coerce(def, q);
    var s = store(); return coerce(def, s ? s.getItem(key) : null);
  }
  function set(key, val) {
    var def = DEFS[key], s = store(); if (!def || !s) return false;
    try { s.setItem(key, val ? "1" : "0"); return true; } catch (e) { return false; }
  }
  var API = { DEFS: DEFS, get: get, set: set, bool: function (k) { return !!get(k); } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_INSULIN_FLAGS = API;
})();
