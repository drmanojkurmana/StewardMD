/* Smart OPD Queue — feature flags (mirrors followcare-flags.js). Resolution: ?query → localStorage → default.
 * Master flag smd_opd_queue DEFAULT OFF (feature in development; not approved for prod). Fails SAFE: with the
 * flag on but server secrets unprovisioned, the module shows a clean "being set up" state and does nothing
 * (isQueueConfigured() guard) — no PHI processed, no message sent. Set ?q=1 (or localStorage) to preview.
 * Exposes window.SMD_QUEUE_FLAGS. No PHI, no network. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  var DEFS = {
    smd_opd_queue: { type: "bool", def: false, query: "q", desc: "Smart OPD Queue master flag" },
    smd_opd_queue_patient: { type: "bool", def: false, query: "qpatient", desc: "Patient live tracking page" },
    smd_opd_queue_import: { type: "bool", def: false, query: "qimport", desc: "GHIS/EMR roster auto-import" },
    smd_opd_emr: { type: "bool", def: false, query: "qemr", desc: "Read-only OPD patient profile + reports (P1)" },
    smd_opd_emr_write: { type: "bool", def: false, query: "qemrwrite", desc: "OPD write-back: order/prescribe/assessment (P2-P4)" }
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
  function on() { return bool("smd_opd_queue"); }
  function defs() { return DEFS; }

  var API = { bool: bool, set: set, on: on, defs: defs, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_QUEUE_FLAGS = API;
})();
