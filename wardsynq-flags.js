/* wardsynq-flags.js - WardSynQ feature-flag registry (SMD_WARDSYNQ_FLAGS).
 * Resolution per flag: ?query param -> localStorage -> default. Mirrors insulin-flags.js. */
(function () {
  "use strict";
  /* WardSynQ is the Clinical OS / EMR being built inside StewardMD. The existing Ward Sync GHIS
   * integration is the SAME system: it becomes WardSynQ's first hospital-data adapter, feeding the
   * canonical model and the Clinical Event Bus. See vault/modules/WardSynQ.md.
   *
   * NOTHING HERE SHIPS ON. Every flag defaults OFF, and the shadow flag below is the only one with
   * any runtime effect today.
   *
   * WHY A SHADOW PATH RATHER THAN A CUT-OVER. `ingestFromWard` in icu.js is read through by the ICU
   * flowsheet, medlist and autofetch, and `STATE.wardSync` is read directly at 22 sites in icu.js
   * alone. Rewiring that in one step would put a live mobile app behind an adapter that has never
   * seen a real GHIS bundle. So the first step observes only: with the shadow flag on, a bundle that
   * has ALREADY been ingested by the legacy path is additionally passed through the WardSynQ adapter
   * and the result logged. The legacy path is not modified, not wrapped and not reordered, and a
   * failure in the shadow path can never affect it.
   *
   * The cut-over proper happens only after the shadow path has been observed against real ward data
   * and the mapping has been checked against what the legacy path produced. */
  var DEFS = {
    smd_wardsynq: {
      type: "bool", def: false, query: "wardsynq",
      desc: "WardSynQ Clinical OS master flag. DEFAULT OFF. Nothing in WardSynQ is reachable without this."
    },
    smd_wardsynq_shadow: {
      type: "bool", def: false, query: "wardsynq_shadow",
      desc: "Shadow-ingest GHIS bundles through the WardSynQ adapter alongside the legacy path, for comparison only. DEFAULT OFF. Observes, never writes to the chart and never alters legacy behaviour. Enable with ?wardsynq_shadow=1."
    },
    smd_wardsynq_cutover: {
      type: "bool", def: false, query: "wardsynq_cutover",
      desc: "Route ward data through WardSynQ as the primary path instead of the legacy ingest. DEFAULT OFF and NOT IMPLEMENTED: the flag exists so the sequence is explicit. Do not enable until the shadow path has been compared against real ward data."
    }
  };
  function store()  { try { return localStorage; } catch (e) { return null; } }
  function search() { try { return (location && location.search) || ""; } catch (e) { return ""; } }
  function rawQuery(alias) {
    if (!alias) return null;
    var m = search().match(new RegExp("[?&]" + alias + "=([^&]+)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function truthy(v) { return v === "1" || v === "true" || v === "on" || v === "yes"; }
  function falsy(v)  { return v === "0" || v === "false" || v === "off" || v === "no"; }

  function get(name) {
    var def = DEFS[name];
    if (!def) return null;
    var q = rawQuery(def.query);
    if (q !== null) {
      if (truthy(q)) return true;
      if (falsy(q)) return false;
    }
    var s = store();
    if (s) {
      try {
        var v = s.getItem(name);
        if (v !== null) {
          if (truthy(v)) return true;
          if (falsy(v)) return false;
        }
      } catch (e) {}
    }
    return def.def;
  }

  function set(name, on) {
    var s = store();
    if (!s || !DEFS[name]) return false;
    try { s.setItem(name, on ? "1" : "0"); return true; } catch (e) { return false; }
  }

  function all() {
    var out = {};
    for (var k in DEFS) if (Object.prototype.hasOwnProperty.call(DEFS, k)) out[k] = get(k);
    return out;
  }

  window.SMD_WARDSYNQ_FLAGS = { defs: DEFS, get: get, set: set, all: all };
})();
