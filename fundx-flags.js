/* fundx-flags.js — FundX AI · central feature-flag registry (README 06).
 *
 * One source of truth for every FundX flag: key, type, default, ?query alias, and description.
 * Resolution order per flag: ?query param (if defined) wins, else localStorage, else the default.
 *
 * ADDITIVE + non-breaking: existing modules keep reading localStorage directly (their behaviour is
 * unchanged); this registry makes the flags discoverable, typed, and defaulted in one place so new
 * code (and Developer Settings / diagnostics) has a single, documented entry point. Reversible:
 * defining this namespace changes nothing on its own. Exposed as window.SMD_FUNDX_FLAGS.
 */
(function () {
  "use strict";

  // type: bool | int | tri (true/false/null) | enum. def: default when unset. query: ?alias (or null).
  var DEFS = {
    smd_fundx:                   { type: "bool", def: false,      query: "fundx",      desc: "FundX master flag (home tile + module)" },
    smd_fundx_depth:             { type: "bool", def: false,      query: "fundxdepth", desc: "Native depth fusion (ARCore / ARKit + LiDAR)" },
    smd_fundx_gpu_preview:       { type: "bool", def: false,      query: "fundxgpu",   desc: "Full-res GPU camera preview" },
    smd_fundx_dev:               { type: "bool", def: false,      query: "fundxdev",   desc: "Developer mode overlay + telemetry HUD" },
    smd_fundx_sensors:           { type: "bool", def: false,      query: null,         desc: "IMU sensor fusion" },
    smd_fundx_flash:             { type: "bool", def: true,       query: null,         desc: "Auto torch during capture" },
    smd_fundx_cloud:             { type: "tri",  def: null,       query: null,         desc: "Cloud AI consent (null = ask once)" },
    smd_fundx_clinical:          { type: "bool", def: false,      query: null,         desc: "Clinical advisory engine (post-acquisition)" },
    smd_fundx_telemetry:         { type: "bool", def: false,      query: null,         desc: "Acquisition telemetry (no PHI)" },
    smd_fundx_lens_confirm:      { type: "bool", def: false,      query: null,         desc: "Optional operator lens-confirm fallback" },
    smd_fundx_capture_threshold: { type: "int",  def: 60,         query: null,         desc: "Manual capture-best-frame readiness %" },
    smd_fundx_quality_warn:      { type: "int",  def: 50,         query: null,         desc: "Below-recommended quality warn %" },
    smd_fundx_mode:              { type: "enum", def: "standard",  query: "fundxmode",  values: ["beginner", "standard", "expert"], desc: "Guidance verbosity mode" },
    smd_fundx_a11y_contrast:     { type: "bool", def: false,       query: null,         desc: "Accessibility: high-contrast UI" },
    smd_fundx_a11y_large:        { type: "bool", def: false,       query: null,         desc: "Accessibility: large text" },
    smd_fundx_a11y_cvd:          { type: "bool", def: false,       query: null,         desc: "Accessibility: color-blind-safe cues (tone icons, not colour alone)" },
    smd_fundx_autocapture:       { type: "bool", def: true,        query: null,         desc: "Auto-capture when diagnostic quality is held (off = manual shutter only)" },
    smd_fundx_ar_guidance:       { type: "bool", def: true,        query: null,         desc: "AR overlays (arrows / ring / chips); off = camera + text coach only" },
    smd_fundx_upload:            { type: "bool", def: true,        query: null,         desc: "Workflow 2: analyze an existing/uploaded fundus image (same downstream as live capture)" },
    smd_fundx_corridor:          { type: "bool", def: false,       query: "fundxcorridor", desc: "Optical Corridor HUD (SVG spatial-AR acquisition overlay). Off = the legacy flat ring." },
    smd_fundx_spatial_ar:        { type: "bool", def: false,       query: "fundxspatial",  desc: "TRUE 3D AR corridor: native SceneKit guide world-anchored to the eye via ARKit (iOS + ARKit only). Off = the 2D SVG corridor / flat ring." },
    smd_fundx_require_alignment: { type: "bool", def: true,        query: "fundxreqalign", desc: "Phase 4 fusion: require native ARKit spatial alignment (on the optical axis) before auto-capture. Only tightens FSM capture timing; no-op unless spatial AR is active." }
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
  if (typeof window !== "undefined") window.SMD_FUNDX_FLAGS = API;             // browser
})();
