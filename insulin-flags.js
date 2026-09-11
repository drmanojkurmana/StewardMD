/* insulin-flags.js - Insulin module feature-flag registry (SMD_INSULIN_FLAGS).
 * Resolution per flag: ?query param -> localStorage -> default. Mirrors thorex-flags.js. */
(function () {
  "use strict";
  /* type: bool. def: default when unset. query: ?alias (or null).
   * CLINICAL SIGN-OFF: the DKA and paediatric workflows were held behind a "needs R1 review"
   * gate. That review was completed by the owner, a physician, on 2026-08-29, against the
   * clinical acceptance suite in test/insulin-scenarios.test.mjs (hypoglycaemia handling,
   * DKA/HHS routing and the potassium gate, paediatric DKA rate and cerebral-oedema warning,
   * weight-based caps). The gate is DISCHARGED, not skipped - all three flags ship ON
   * deliberately. The in-app safeguards are unchanged and remain in force: every DKA and
   * paediatric result still carries its "trained clinicians only" banner, its
   * institutional-protocol acknowledgement, and the critical-warning acknowledgement. */
  var DEFS = {
    smd_insulin:      { type: "bool", def: true, query: "insulin",      desc: "Insulin module master flag (home tile + module). DEFAULT ON (owner enabled). Hide with ?insulin=0." },
    smd_insulin_dka:  { type: "bool", def: true, query: "insulin_dka",  desc: "Clinician DKA insulin workflow. DEFAULT ON. Clinical review signed off by the owner (physician) 2026-08-29. Still gated in-app by the trained-clinician acknowledgement. Hide with ?insulin_dka=0." },
    smd_insulin_peds: { type: "bool", def: true, query: "insulin_peds", desc: "Pediatric insulin workflow. DEFAULT ON. Clinical review signed off by the owner (physician) 2026-08-29. Still gated in-app by the trained-clinician acknowledgement. Hide with ?insulin_peds=0." },
    /* Ask MaiK had NO kill switch: askAvailable() only checked that window.INSULIN_ASK existed, so
     * the one part of this module that sends a clinician's free text to an LLM could not be turned
     * off without shipping a new build. Every other risk-bearing workflow here is flag-gated; this
     * makes the LLM path match. DEFAULT ON (it is live and the owner enabled it); off with
     * ?insulin_ask=0 or localStorage smd_insulin_ask=0, which reverts to the manual form - safe,
     * because MaiK only ever FILLS that form and never answers the dose. */
    smd_insulin_ask:  { type: "bool", def: true, query: "insulin_ask",  desc: "Ask MaiK (LLM fills the insulin form; it never answers the dose). DEFAULT ON. Turn off with ?insulin_ask=0 to fall back to the manual form." }
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
