/* medcore-flags.js - Medical Core feature-flag registry (SMD_MEDCORE_FLAGS).
 * Sibling of wardsynq-flags.js / surgx-flags.js / clinix-flags.js.
 * Resolution per flag: ?query param -> localStorage -> default. Persistence is localStorage only.
 * Dual export: module.exports for node tests, window.SMD_MEDCORE_FLAGS for the browser.
 *
 * WHAT MEDICAL CORE IS. A small ML decision layer that will sit between the existing WardSynQ
 * pipeline and the existing recognition/orchestrator layers, producing calibrated probabilities
 * with honest abstentions for a handful of named clinical outcomes. It is not a platform: it owns
 * no alerting, no escalation, no scoring and no rules, because all of those already exist and stay
 * where they are. Plan: vault/modules/Medical Core.md.
 *
 * WHAT THIS FILE IS TODAY. The registry for the DETERMINISTIC Medical Core layer, which is built
 * and shipped: medcore/ (units, patient state, missing information, what changed, features,
 * outcomes), medcore-boot.js, and the panel in icu.js. `smd_medcore` DEFAULTS ON and the panel
 * carries a BETA badge; owner decision, recorded in vault/decisions/Decisions.md. Off is still a
 * COMPLETE no-op: medcore-boot.js checks the flag before its first dynamic import and its first
 * fetch, so `?medcore=0` removes the feature with no edit to revert.
 *
 * WHAT DEFAULT ON DOES NOT INCLUDE: any model. `smd_medcore_shadow` stays DEFAULT OFF and there is
 * no admitted artifact. Every candidate trained on the available public ICU data was REFUSED by
 * the admission gates - a measurement-frequency-only probe matched or beat the model, which is the
 * shortcut hazard HAZ-ML-01 showing up in real data. So there is no probability to display and
 * nothing that could gate, relax or override a deterministic rule. See vault/modules/Medical
 * Core.md for the gate results and vault/Flags.md for the register.
 *
 * NO CLINICAL PATH. A Medical Core probability never gates, relaxes or overrides a deterministic
 * rule, score or refusal, and there is no code path from a probability to an order, a dose or a
 * prescription change. That is a property of the architecture, not of these defaults.
 */
(function () {
  "use strict";

  // type: bool. def: default when unset. query: ?alias (or null for no query override).
  var DEFS = {
    smd_medcore: {
      type: "bool", def: true, query: "medcore",
      desc: "Medical Core master flag. DEFAULT ON, labelled BETA in the UI. What it enables is the " +
        "DETERMINISTIC layer only: patient state, what changed, missing information, unit and " +
        "freshness checks. No model and no probability - see smd_medcore_shadow. Off must be a " +
        "COMPLETE no-op: `?medcore=0` stops medcore-boot.js before its first import and its first " +
        "fetch, removing the feature entirely with no edit to revert."
    },
    smd_medcore_shadow: {
      type: "bool", def: false, query: "medcore_shadow",
      desc: "Evaluate Medical Core decisions alongside the existing deterministic path, for " +
        "comparison only. DEFAULT OFF, and it stays off: no model artifact has passed the " +
        "admission gates on the available data, so there is nothing to shadow. Shadow means the " +
        "output reaches NOBODY: no panel, no recognition prompt, no notification, no " +
        "clinician-visible log, exactly as wardsynq-mlops.js requires of a model in shadow. " +
        "Requires smd_medcore. The evaluator is installed from outside the host file so that not " +
        "loading it removes the change completely (the wardsynq-shadow.js pattern)."
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

  /* The shadow flag is meaningless without the master flag, and a shadow evaluation running while
   * the master flag is off would be a second, unregistered entry point. Every future consumer asks
   * this question rather than reading smd_medcore_shadow directly. */
  function shadowActive() { return get("smd_medcore") === true && get("smd_medcore_shadow") === true; }

  var API = {
    DEFS: DEFS, defs: DEFS, get: get, set: set, all: all,
    bool: function (k) { return !!get(k); },
    shadowActive: shadowActive
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_MEDCORE_FLAGS = API;
})();
