/* StewardMD - neonatal layer flags (window.SMD_NEO_FLAGS). Plan 2026-09-30, vault/modules/Neonatal.md.
 *
 * Master flag smd_neo, DEFAULT ON under a Beta label (owner 2026-10-01: "Make it default on for everyone
 * under beta label"; was default OFF 2026-09-30). Content is still ai_drafted with a Draft badge.
 * Off per device: Settings > Experimental Features > Neonatal layer, ?neo=0, or localStorage
 * smd_neo = "0". Off, nothing neonatal shows and dose-calc.js behaves as before the layer.
 *
 * Per-feature flags (default ON, but only take effect while the master is on) let one tool ship or be
 * pulled without the rest: ?neo_<name>=0 or localStorage smd_neo_<name> = "0".
 * Resolution order everywhere: query param, then localStorage, then default.
 */
(function (G) {
  "use strict";
  var MASTER = "smd_neo";
  var FEATURES = {
    dose: "Neonatal dosing (GA, PNA, PMA bands)",
    prep: "Dose preparation (vials, dilution, draw-up)",
    inf: "Neonatal infusions (mcg/kg/min to mL/h)",
    fluids: "Fluids and GIR",
    growth: "Growth, milestones and reflexes",
    bili: "Bilirubin plotter",
    scores: "Neonatal scores",
    ref: "Reference values",
    proc: "Procedures and line lengths",
    tdm: "Vancomycin and aminoglycoside TDM"
  };
  function q(name) {
    try { var m = (G.location.search.match(new RegExp("[?&]" + name + "=([^&]+)")) || [])[1]; if (m != null) return m === "1" || m === "on" || m === "true"; } catch (e) {}
    return null;
  }
  function ls(k) { try { return G.localStorage.getItem(k); } catch (e) { return null; } }
  function on() {
    var v = q("neo"); if (v != null) return v;
    return ls(MASTER) !== "0";
  }
  function feature(name) {
    if (!on()) return false;
    if (!FEATURES[name]) return false;
    var v = q("neo_" + name); if (v != null) return v;
    return ls(MASTER + "_" + name) !== "0";
  }
  function set(name, val) {
    try { G.localStorage.setItem(name === "master" || name === MASTER ? MASTER : MASTER + "_" + name, val ? "1" : "0"); } catch (e) {}
  }
  /* The layer's scripts load only when the master flag is on, so a device with it off pays nothing
   * beyond this file. Order matters (the record and hub first); async=false keeps insertion order. */
  var VER = "neo3-pm1";
  var FILES = ["neo-patient", "neo-hub", "neo-dose", "neo-prep", "neo-infusions", "neo-fluids", "neo-growth", "neo-bili", "neo-scores", "neo-ref", "neo-proc", "neo-tdm"];
  var loaded = false;
  function load() {
    if (loaded || !on() || !G.document) return loaded;
    loaded = true;
    FILES.forEach(function (f) { var s = G.document.createElement("script"); s.src = "/" + f + ".js?v=" + VER; s.async = false; G.document.head.appendChild(s); });
    return true;
  }
  G.SMD_NEO_FLAGS = { on: on, feature: feature, set: set, load: load, FEATURES: FEATURES, MASTER: MASTER, FILES: FILES, VER: VER };
  load();
})(typeof window !== "undefined" ? window : globalThis);
