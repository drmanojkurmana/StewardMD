// sknx-store.js — local, on-device SknX analysis history (no PHI beyond the session's own record).
(function () {
  "use strict";
  var KEY = "smd_sknx_history_v1";
  function store(impl) { if (impl) return impl; try { return localStorage; } catch (e) { return null; } }
  function readAll(s) { try { var v = s.getItem(KEY); var parsed = v ? JSON.parse(v) : []; return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; } }
  function writeAll(s, a) { try { s.setItem(KEY, JSON.stringify(a)); return true; } catch (e) { return false; } }
  function save(analysis, impl) {
    var s = store(impl); if (!s) return null;
    var all = readAll(s);
    var nonce = Math.random().toString(36).slice(2, 8);
    var id = "skn_" + (analysis.at || 0) + "_" + ((analysis.differential && analysis.differential[0] && analysis.differential[0].label) || "x") + "_" + nonce;
    all.unshift(Object.assign({}, analysis, { id: id })); return writeAll(s, all.slice(0, 100)) ? id : null;
  }
  function list(impl) { var s = store(impl); if (!s) return []; return readAll(s).map(function (r) { return { id: r.id, at: r.at, top: (r.differential && r.differential[0] && r.differential[0].label) || null }; }); }
  function get(id, impl) { var s = store(impl); if (!s) return null; return readAll(s).filter(function (r) { return r.id === id; })[0] || null; }
  /* Sign-out has to be able to empty this. The history holds up to 100 dermatology analyses -
   * clinical findings about whoever was photographed - and the module's wipe() was a comment
   * saying "no bulk-delete API yet", so it silently kept them for the next account on the device.
   * (Harmless while nothing dispatched the sign-out event; a real leak now that something does.) */
  function deleteAll(impl) { var s = store(impl); if (!s) return false; try { s.removeItem(KEY); return true; } catch (e) { return false; } }
  var API = { save: save, list: list, get: get, deleteAll: deleteAll };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_STORE = API;
})();
