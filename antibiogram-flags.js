/* Antibiogram rebuild - feature flag (mirrors kb-protocols-flags.js). Resolution:
 * ?abg2= query -> localStorage -> default. DEFAULT ON: the rebuilt Antibiogram screen (validated
 * sources, strata, pooled India and regions, sources census, the hospital's own import). Off
 * restores the previous resistance view, which reads the same validated data. Force off per device
 * with ?abg2=0 or localStorage smd_abg_v2=0.
 * Exposes window.SMD_ABG_FLAGS. No PHI, no network. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  var DEFS = {
    smd_abg_v2: { type: "bool", def: true, query: "abg2", desc: "Antibiogram screen v2 (validated Indian antibiograms by specimen and setting, pooled views, sources census, own-hospital import). DEFAULT ON. Force off per device with ?abg2=0; the previous view then reads the same validated data." }
  };

  function raw(key) {
    var d = DEFS[key]; if (!d) return null;
    var q = null; try { q = Q.get(d.query); } catch (e) {}
    if (q === "1" || q === "true") return "1";
    if (q === "0" || q === "false") return "0";
    var v = null; try { v = LS && LS.getItem(key); } catch (e) {}
    if (v === "1" || v === "0") return v;
    return d.def ? "1" : "0";
  }
  function bool(key) { return raw(key) === "1"; }
  function set(key, on) { try { LS && LS.setItem(key, on ? "1" : "0"); } catch (e) {} }
  function on() { return bool("smd_abg_v2"); }
  function defs() { return DEFS; }

  var API = { bool: bool, set: set, on: on, defs: defs, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_ABG_FLAGS = API;
})();
