/* steward-id-flags.js — StewardMD ID · feature-flag registry (SMD_STEWARD_ID_FLAGS).
 * One source of truth for the universal-identity flag. Resolution per flag: ?query (if defined)
 * wins, else localStorage, else default. ADDITIVE: with smd_steward_id OFF nothing changes —
 * ICU keeps its existing lazy Doctor-ID mint; the universal mint + anchor-email flow stay dormant. */
(function () {
  "use strict";
  var DEFS = {
    smd_steward_id: { type: "bool", def: false, query: "stewardid", desc: "Verified-email / Apple-proxy anchor capture UI. DEFAULT OFF." },
    // The ID itself is UNIVERSAL: every signed-in user gets an SMD-XXXXXX, whether or not they ever
    // open ICU or turn on Group mode. This is the kill switch for that mint (default ON), kept so the
    // per-user Firestore write can be stopped without a redeploy — not a rollout gate.
    smd_steward_id_mint: { type: "bool", def: true, query: "stewardidmint", desc: "Mint the universal StewardMD ID on sign-in. DEFAULT ON." }
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
      default: return raw;
    }
  }
  function get(key) {
    var def = DEFS[key]; if (!def) return null;
    var q = rawQuery(def.query); if (q != null) return coerce(def, q);
    var s = store(); return coerce(def, s ? s.getItem(key) : null);
  }
  function set(key, val) {
    var def = DEFS[key], s = store(); if (!def || !s) return false;
    var out = def.type === "bool" ? (val ? "1" : "0") : String(val);
    try { s.setItem(key, out); return true; } catch (e) { return false; }
  }
  function all() { var o = {}; for (var k in DEFS) { if (DEFS.hasOwnProperty(k)) o[k] = get(k); } return o; }
  var API = { get: get, set: set, all: all, bool: function (k) { return !!get(k); } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_STEWARD_ID_FLAGS = API;
})();
