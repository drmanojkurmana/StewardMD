/* Scheme Search — feature flags (mirrors queue-flags.js). Resolution: ?query -> localStorage -> default.
 * DEFAULT ON as of 2026-09-04 (owner approved going live for all devices). Can still be forced off
 * per device with ?gs=0 or localStorage smd_govt_schemes=0. Exposes window.SMD_GOVSCHEMES_FLAGS.
 * No PHI, no network beyond the module's own read-only lookups. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  var DEFS = {
    smd_govt_schemes: { type: "bool", def: true, query: "gs", desc: "Scheme Search module master flag. DEFAULT ON as of 2026-09-04 (owner approved). Force off per device with ?gs=0." }
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
  function on() { return bool("smd_govt_schemes"); }
  function defs() { return DEFS; }

  var API = { bool: bool, set: set, on: on, defs: defs, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_GOVSCHEMES_FLAGS = API;
})();
