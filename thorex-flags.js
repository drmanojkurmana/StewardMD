/* thorex-flags.js — ThoreX AI · central feature-flag registry.
 *
 * Sibling of kardiox-flags.js (SMD_KARDIOX_FLAGS). One source of truth for every ThoreX flag: key, type,
 * default, ?query alias, description. Resolution order per flag: ?query param (if defined) wins, else
 * localStorage, else the default.
 *
 * ADDITIVE + non-breaking: defining this namespace changes nothing on its own. ThoreX is gated by
 * `smd_thorex` (DEFAULT OFF) exactly like KardioX's `smd_kardiox`; when off, thorex.js returns early and
 * the whole module is a no-op. Exposed as window.SMD_THOREX_FLAGS.
 *
 * NOTE — `smd_thorex_model_base` is NOT a flag in DEFS below, and deliberately so: this registry only
 * supports bool/int/tri/enum values, and the on-device model base is a free-form string (a path, or a
 * hosted/CDN URL like "https://models.stewardmd.in/thorex") that would not fit any of those types
 * cleanly. Instead thorex-ort.js reads localStorage.getItem("smd_thorex_model_base") directly (default
 * "/models" — the static files vendored in this repo) via its own modelBase()/defaultModelUrl() helpers.
 * Set it once (e.g. `localStorage.setItem("smd_thorex_model_base", "https://models.stewardmd.in/thorex")`)
 * to point a native app / different static host at hosted or bundled model files without a code change;
 * thorex-ort.js then downloads each model once from that base and caches it on-device (Cache API, else
 * IndexedDB — see thorex-model-cache.js) so every later run is fully offline.
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
    smd_thorex_backend:    { type: "bool", def: false,      query: "thorexbackend", desc: "Use the live ThoreX pipeline backend (RemoteAnalyzer via /api/thorex) instead of the on-device mock. Health-gated: falls back to mock if the pipeline is unreachable. DEFAULT ON." },
    smd_thorex_demo:       { type: "bool", def: false,     query: "thorexdemo",    desc: "EXPLICIT demo mode — use the deterministic mock analyzer (canned sample, no real inference). Off by default: Analyze runs the REAL pipeline (backend/on-device ONNX) or reports 'inference unavailable', never a fabricated result." },
    smd_thorex_ondevice:   { type: "bool", def: true,     query: "thorexondevice", desc: "Prefer FULLY ON-DEVICE inference (onnxruntime-web via thorex-ort.js) — no upload, runs in the WebView. Clinical (torchxrayvision) always; the educational V2 Beta (X-Raydar) engine also runs on-device when v2beta is enabled. DEFAULT ON." },
    smd_thorex_v2beta:     { type: "bool", def: false,    query: "thorexv2beta",   desc: "Enable the V2 Beta educational engine (X-Raydar) alongside ThoreX v1. Adds the collapsible V2 Beta panel + educational appendix. EDUCATIONAL / non-commercial license, Pro required — resolves entitlement to v2beta. DEFAULT OFF." }
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
