// sknx-flags.js — SknX AI feature-flag registry (sibling of thorex-flags.js).
(function () {
  "use strict";
  var DEFS = {
    smd_sknx:          { type: "bool", def: false, query: "sknx" }, // OFF by default while Phase 1 is mock-only; enable per-device with ?sknx=1 or localStorage. PUBLIC-RELEASE stays gated behind R1 clinical review + real models.
    smd_sknx_ondevice: { type: "bool", def: true, query: "sknxondevice" },
    smd_sknx_cloud:    { type: "tri",  def: null, query: null },
    smd_sknx_haptics:  { type: "bool", def: true, query: null },
    smd_sknx_rx:         { type: "bool", def: false, query: "sknxrx" }, // Phase 3 clinician-confirmed Rx. HARD-GATED: def:false; must NOT ship on without R1 clinical + R3-DPDP + R7 sign-off. Only ever surfaces a draft on a NON-referral rxEligible case for a verified prescriber (see sknx-rx.js).
    smd_sknx_realvision: { type: "bool", def: false, query: "sknxrv" } // EXPERIMENTAL on-device ONNX classifier (sknx-realvision.js) instead of the mock. def:false; uncalibrated public model - for testing/validation only. Falls back to the mock on any failure.
  };
  function readStore(opts) { if (opts && opts.store) return opts.store; try { return localStorage; } catch (e) { return {}; } }
  function readQuery(opts) { if (opts && typeof opts.query === "string") return opts.query; try { return location.search || ""; } catch (e) { return ""; } }
  function bool(key, opts) {
    var d = DEFS[key]; if (!d) return false;
    var q = readQuery(opts), alias = d.query;
    if (alias) { if (new RegExp("[?&]" + alias + "=0\\b").test(q)) return false; if (new RegExp("[?&]" + alias + "=1\\b").test(q)) return true; }
    var s = readStore(opts), v = null; try { v = s.getItem ? s.getItem(key) : s[key]; } catch (e) {}
    if (v === "0") return false; if (v === "1") return true;
    return !!d.def;
  }
  var API = { DEFS: DEFS, bool: bool };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_FLAGS = API;
})();
