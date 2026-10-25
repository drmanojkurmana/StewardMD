/* kardia-flags.js: Kardia central feature-flag registry.
 *
 * Sibling of kardiox-flags.js (SMD_KARDIOX_FLAGS) and clinix-flags.js. One source of truth for every
 * Kardia flag: key, type, default, ?query alias, description. Resolution order per flag: ?query param
 * (if defined) wins, else localStorage, else the default.
 *
 * ADDITIVE + non-breaking: defining this namespace changes nothing on its own. Kardia is gated by
 * `smd_kardia` (OWNER DECISION 2026-10-26: ON for everyone; was DEFAULT OFF for everyone; a tester turns it on per device with ?kardia=1 or
 * localStorage smd_kardia = "1", the same tester mechanism the other module flags use). There is no
 * early-access tier: unlike the imaging-AI tiles, Kardia must stay off until a tester opts in.
 * Exposed as window.SMD_KARDIA_FLAGS.
 */
(function () {
  "use strict";

  // type: bool | int | tri (true/false/null) | enum. def: default when unset. query: ?alias (or null).
  var DEFS = {
    smd_kardia: {
      type: "bool", def: true, query: "kardia",
      desc: "Kardia module master flag (Home tile + module). OWNER DECISION 2026-10-26: ON for everyone (def:true). Pro lock and free preview unchanged; KardiQ X AI reading stays behind its access code; all Kardia clinical content remains ai_drafted until clinical sign-off. A device turns it off with localStorage smd_kardia 0 or ?kardia=0."
    }
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
    var s = store(), raw = s ? s.getItem(key) : null;
    return coerce(def, raw);
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
  if (typeof window !== "undefined") window.SMD_KARDIA_FLAGS = API;            // browser
})();
