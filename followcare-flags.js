/* FollowCare AI — feature flags (mirrors thorex-flags.js). Resolution: ?query → localStorage → default.
 * Master flag smd_followcare DEFAULT ON (owner enabled it after all phases were built + reviewed). It fails
 * SAFE if the server secrets (FOLLOWCARE_TOKEN_SECRET/FOLLOWCARE_PHI_KEY) aren't provisioned: the module +
 * portal show a clean "being set up / temporarily unavailable" state (isConfigured() guard) and NO PHI is
 * processed and NO message is sent until the secrets exist. Set ?fc=0 (or localStorage) to hide it again.
 * Exposes window.SMD_FOLLOWCARE_FLAGS. No PHI, no network. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  // key → { type, def, query, desc }
  var DEFS = {
    smd_followcare: { type: "bool", def: true, query: "fc", desc: "FollowCare AI master flag" },
    smd_followcare_portal: { type: "bool", def: true, query: "fcportal", desc: "Patient web portal" },
    smd_followcare_actions: { type: "bool", def: true, query: "fcactions", desc: "Doctor Action Center (doctor↔patient messaging)" },
    smd_followcare_ui2: { type: "bool", def: true, query: "fcui", desc: "FollowCare premium UI redesign (v2)" },
    smd_followcare_sms: { type: "bool", def: false, query: "fcsms", desc: "SMS channel (needs provider config)" },
    smd_followcare_ai_summary: { type: "bool", def: true, query: "fcai", desc: "AI doctor summary (Phase 2). PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on' 2026-08-16)" },
    smd_followcare_adaptive: { type: "bool", def: true, query: "fcadapt", desc: "Adaptive AI conversation (Phase 2). PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on' 2026-08-16)" },
    smd_followcare_voice: { type: "bool", def: false, query: "fcvoice", desc: "AI voice fallback call (needs per-hospital enable + voice service)" }
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
  function on() { return bool("smd_followcare"); }              // convenience: master
  function defs() { return DEFS; }

  var API = { bool: bool, set: set, on: on, defs: defs, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_FOLLOWCARE_FLAGS = API;
})();
