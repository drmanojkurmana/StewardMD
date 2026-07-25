/* thorex-flags.js — ThoreX AI · central feature-flag registry.
 *
 * Sibling of kardiox-flags.js (SMD_KARDIOX_FLAGS). One source of truth for every ThoreX flag: key, type,
 * default, ?query alias, description. Resolution order per flag: ?query param (if defined) wins, else
 * localStorage, else the default.
 *
 * ADDITIVE + non-breaking: defining this namespace changes nothing on its own. ThoreX is gated by
 * `smd_thorex` (DEFAULT OFF) exactly like KardioX's `smd_kardiox`; when off, thorex.js returns early and
 * the whole module is a no-op. Exposed as window.SMD_THOREX_FLAGS.
 */
(function () {
  "use strict";

  // type: bool | int | tri (true/false/null) | enum. def: default when unset. query: ?alias (or null).
  var DEFS = {
    smd_thorex:            { type: "bool", def: false,     query: "thorex",        desc: "ThoreX AI master flag (home card + module). DEFAULT OFF." },
    smd_thorex_cloud:      { type: "tri",  def: null,      query: null,            desc: "Cloud analysis consent (null = ask once). Off = offline only." },
    smd_thorex_confidence: { type: "bool", def: true,      query: null,            desc: "Always show the AI confidence % (Settings · Intelligence)." },
    smd_thorex_haptics:    { type: "bool", def: true,      query: null,            desc: "Haptic feedback for taps / result-ready / urgent." },
    smd_thorex_dev:        { type: "bool", def: false,     query: "thorexdev",     desc: "Developer overlay (pipeline stages, provider, timings)." },
    smd_thorex_backend:    { type: "bool", def: true,      query: "thorexbackend", desc: "Use the live ThoreX pipeline backend (RemoteAnalyzer via /api/thorex) instead of the on-device mock. Health-gated: falls back to mock if the pipeline is unreachable. DEFAULT ON." },
    smd_thorex_demo:       { type: "bool", def: false,     query: "thorexdemo",    desc: "EXPLICIT demo mode — use the deterministic mock analyzer (canned sample, no real inference). Off by default: Analyze runs the REAL pipeline (backend/on-device ONNX) or reports 'inference unavailable', never a fabricated result." }
  };

  function store() { try { return localStorage; } catch (e) { return null; } }
  function search() { try { return (location && location.search) || ""; } catch (e) { return ""; } }
  function rawQuery(alias) {
    if (!alias) return null;
    var m = search().match(new RegExp("[?&]" + alias + "=([^&]+)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function coerce(def, raw) {
    if (raw == null) return def.def;
    switch (def.type) {
      case "bool": return raw === "1" || raw === "on" || raw === "true";
      case "int": { var n = parseInt(raw, 10); return isNaN(n) ? def.def : n; }
      case "tri": return raw === "1" ? true : raw === "0" ? false : def.def;
      case "enum": return def.values.indexOf(raw) >= 0 ? raw : def.def;
      default: return raw;
    }
  }
  function get(key) {
    var def = DEFS[key]; if (!def) return null;
    var q = rawQuery(def.query); if (q != null) return coerce(def, q);   // ?query wins
    var s = store(); return coerce(def, s ? s.getItem(key) : null);
  }
  function set(key, val) {
    var def = DEFS[key], s = store(); if (!def || !s) return false;
    var out = def.type === "bool" ? (val ? "1" : "0")
      : def.type === "tri" ? (val === true ? "1" : val === false ? "0" : "")
      : String(val);
    try { s.setItem(key, out); return true; } catch (e) { return false; }
  }
  function all() { var o = {}; for (var k in DEFS) { if (DEFS.hasOwnProperty(k)) o[k] = get(k); } return o; }

  var API = {
    DEFS: DEFS,
    get: get, set: set, all: all,
    bool: function (k) { return !!get(k); },
    int: function (k) { var v = get(k); return typeof v === "number" ? v : (DEFS[k] ? DEFS[k].def : 0); }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;   // node/test
  if (typeof window !== "undefined") window.SMD_THOREX_FLAGS = API;            // browser
})();
