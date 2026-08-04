// sknx-store.js — local, on-device SknX analysis history (no PHI beyond the session's own record).
(function () {
  "use strict";
  var KEY = "smd_sknx_history_v1";
  function store(impl) { if (impl) return impl; try { return localStorage; } catch (e) { return null; } }
  function readAll(s) { try { var v = s.getItem(KEY); var parsed = v ? JSON.parse(v) : []; return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; } }
  function writeAll(s, a) { try { s.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  function save(analysis, impl) {
    var s = store(impl); if (!s) return null;
    var all = readAll(s);
    var id = "skn_" + (analysis.at || 0) + "_" + ((analysis.differential && analysis.differential[0] && analysis.differential[0].label) || "x") + "_" + all.length;
    all.unshift(Object.assign({ id: id }, analysis)); writeAll(s, all.slice(0, 100)); return id;
  }
  function list(impl) { var s = store(impl); if (!s) return []; return readAll(s).map(function (r) { return { id: r.id, at: r.at, top: (r.differential && r.differential[0] && r.differential[0].label) || null }; }); }
  function get(id, impl) { var s = store(impl); if (!s) return null; return readAll(s).filter(function (r) { return r.id === id; })[0] || null; }
  var API = { save: save, list: list, get: get };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_STORE = API;
})();
