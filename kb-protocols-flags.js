/* Knowledge Base clinical protocols - feature flag (mirrors govschemes-flags.js). Resolution:
 * ?kbproto= query -> localStorage -> default. DEFAULT ON: the Protocols tab is additive (a fifth tab in
 * the Knowledge Library) and every protocol renders its review status; content is ai_drafted pending
 * clinical review. Force off per device with ?kbproto=0 or localStorage smd_kb_protocols=0.
 * Exposes window.SMD_KBPROTO_FLAGS. No PHI, no network. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  var DEFS = {
    smd_kb_protocols: { type: "bool", def: true, query: "kbproto", desc: "Knowledge Library Protocols tab (clinical protocols across specialties). DEFAULT ON; content ai_drafted pending clinical review. Force off per device with ?kbproto=0." }
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
  function on() { return bool("smd_kb_protocols"); }
  function defs() { return DEFS; }

  var API = { bool: bool, set: set, on: on, defs: defs, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_KBPROTO_FLAGS = API;
})();
