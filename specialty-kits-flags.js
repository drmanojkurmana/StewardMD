/* Specialty kits - feature flag (mirrors kb-protocols-flags.js). Resolution:
 * ?kits= query -> localStorage -> default. DEFAULT ON: the kits are additive (a Specialty tab in the OPD
 * EMR and a Home tile); a kit only adds editable text to the assessment and every kit shows its review
 * status (content ai_drafted pending clinical review). Force off per device with ?kits=0 or
 * localStorage smd_specialty_kits=0. Exposes window.SMD_KITS_FLAGS. No PHI, no network. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  var DEFS = {
    smd_specialty_kits: { type: "bool", def: true, query: "kits", desc: "Specialty kits (O&G, Paediatrics, Orthopaedics, Ophthalmology, ENT, Dermatology, Psychiatry, Dental): OPD Specialty tab + Home tile. DEFAULT ON; content ai_drafted pending clinical review. Force off per device with ?kits=0." }
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
  function on() { return bool("smd_specialty_kits"); }
  function defs() { return DEFS; }

  var API = { bool: bool, set: set, on: on, defs: defs, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_KITS_FLAGS = API;
})();
