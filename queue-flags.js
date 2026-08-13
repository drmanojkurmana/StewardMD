/* Smart OPD Queue — feature flags (mirrors followcare-flags.js). Resolution: ?query → localStorage → default.
 * Master flag smd_opd_queue DEFAULT ON (go-live 2026-08-10: server QUEUE_ENABLED=1, secrets configured,
 * Firestore TTL set; ready:{enabled,configured}=true). Still fails SAFE: with the
 * flag on but server secrets unprovisioned, the module shows a clean "being set up" state and does nothing
 * (isQueueConfigured() guard) — no PHI processed, no message sent. Set ?q=1 (or localStorage) to preview.
 * Exposes window.SMD_QUEUE_FLAGS. No PHI, no network. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  // PUBLIC-RELEASE-GATE: OPD Queue + EMR are DEV/TESTING features (server provisioning + clinical validation
  // pending). Flipped ON here for owner/device testing per the "enable everything implemented" dev posture.
  // Set these back to def:false before ANY App-Store/Play/public release. Writes are STILL doubly gated:
  // server needs QUEUE_EMR_WRITE=1 (assessment + investigation orders), and PRESCRIBE stays server-hard-blocked
  // (QUEUE_EMR_PRESCRIBE_OK) until the CreateDrugs payload is captured/verified. Every submit needs a confirm().
  var DEFS = {
    smd_opd_queue: { type: "bool", def: true, query: "q", desc: "Smart OPD Queue master flag" },
    smd_opd_queue_patient: { type: "bool", def: true, query: "qpatient", desc: "Patient live tracking page" },
    smd_opd_queue_import: { type: "bool", def: true, query: "qimport", desc: "GHIS/EMR roster auto-import" },
    smd_opd_emr: { type: "bool", def: true, query: "qemr", desc: "Read-only OPD patient profile + reports (P1)" },
    smd_opd_emr_write: { type: "bool", def: true, query: "qemrwrite", desc: "OPD write-back submit buttons (assessment + investigation orders live w/ QUEUE_EMR_WRITE; prescribe server-blocked). PUBLIC-RELEASE-GATE" },
    smd_onco_protocols: { type: "bool", def: false, query: "qonco", desc: "Oncology treatment-plan engine (Protocol/Plan/Cycle/Administration). Writes double-gated by server QUEUE_ONCO_WRITE. PUBLIC-RELEASE-GATE" }
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
