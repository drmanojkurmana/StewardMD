/* wardsynq-flags.js - WardSynQ feature-flag registry (SMD_WARDSYNQ_FLAGS).
 * Resolution per flag: ?query param -> localStorage -> default. Mirrors insulin-flags.js. */
(function () {
  "use strict";
  /* WardSynQ is the Clinical OS / EMR being built inside StewardMD. The existing Ward Sync GHIS
   * integration is the SAME system: it becomes WardSynQ's first hospital-data adapter, feeding the
   * canonical model and the Clinical Event Bus. See vault/modules/WardSynQ.md.
   *
   * NOTHING HERE SHIPS ON. Every flag still defaults OFF and must be turned on deliberately.
   *
   * WHY A SHADOW PATH RATHER THAN A CUT-OVER. `ingestFromWard` in icu.js is read through by the ICU
   * flowsheet, medlist and autofetch, and `STATE.wardSync` is read directly at 22 sites in icu.js
   * alone. Rewiring that in one step would put a live mobile app behind an adapter that has never
   * seen a real GHIS bundle. So the first step observes only: with the shadow flag on, a bundle that
   * has ALREADY been ingested by the legacy path is additionally passed through the WardSynQ adapter
   * and the result logged. The legacy path is not modified, not wrapped and not reordered, and a
   * failure in the shadow path can never affect it.
   *
   * THE CUT-OVER IS NOW BUILT (wardsynq/wardsynq-ghis-live.js), approved by the owner on 2026-09-05
   * after the shadow path was run. It is a strangler fig rather than a rewrite: the adapter takes
   * ownership of the CANONICAL model while the legacy path keeps owning STATE and every screen that
   * already reads it, so turning the flag on adds a consumer and changes nothing the app displays.
   *
   * That approval is ARCHITECTURAL and is the owner's to give. It is not clinical approval: the
   * interaction, allergy, dose-ceiling and threshold packs remain UNAPPROVED seed content awaiting
   * pharmacy and the relevant committees, and no flag in this file changes that. */
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
      desc: "Feed ward data through the WardSynQ adapter into the canonical model, alongside the legacy ingest. DEFAULT OFF. IMPLEMENTED (wardsynq/wardsynq-ghis-live.js) and WIRED (wardsynq-ghis-live-boot.js, 2026-09-06) — window.SMD_WARDSYNQ_LIVE once installed. The legacy path still owns STATE and the mobile UI and is not modified: it runs FIRST and its result is returned untouched, so enabling this cannot change what the app shows. The adapter path can never throw into the caller, is idempotent on the source event identity, writes as an ADAPTER actor and is therefore capped at DRAFT, and can be halted in-process without a reload via window.SMD_WARDSYNQ_LIVE.halt(). Writes only through the tenant already opened by ?wardsynq_record=<tenantId>; with none configured this runs as a dry run (mapped and counted, nothing written)."
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
