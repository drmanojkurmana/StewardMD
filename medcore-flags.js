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
 * WHAT THIS FILE IS TODAY. The registry only, created as step 1 of that plan (the pre-integration
 * step, tag `medcore-pre-integration`). NOTHING reads these flags yet: there is no medcore/
 * runtime, no boot file, no event subscription, no panel, and this file is not loaded by
 * index.html. Turning either flag on today changes nothing anywhere, which is the point - the flag
 * exists before the code it gates so that every later commit lands behind an already-registered
 * switch rather than adding a switch and a clinical path in the same change.
 *
 * BOTH FLAGS DEFAULT OFF AND MUST STAY OFF until the Definition of Done in the module note is met.
 * There is no model, no artifact and no validated outcome in the repository, so there is nothing
 * either flag could honestly enable. See vault/Flags.md for the register.
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
      type: "bool", def: false, query: "medcore",
      desc: "Medical Core master flag. DEFAULT OFF and nothing reads it yet. When the deterministic " +
        "feature layer lands (Phase 1: patient state, what changed, missing information, unit and " +
        "freshness checks) this is what makes it reachable. Off must be a COMPLETE no-op: not " +
        "loading the medcore files removes the feature entirely, with no edit to revert."
    },
    smd_medcore_shadow: {
      type: "bool", def: false, query: "medcore_shadow",
      desc: "Evaluate Medical Core decisions alongside the existing deterministic path, for " +
        "comparison only. DEFAULT OFF. Shadow means the output reaches NOBODY: no panel, no " +
        "recognition prompt, no notification, no clinician-visible log, exactly as " +
        "wardsynq-mlops.js requires of a model in shadow. Requires smd_medcore. Nothing reads it " +
        "yet; when it does, the evaluator is installed from outside the host file so that not " +
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
