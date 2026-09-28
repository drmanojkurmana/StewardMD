/* Tokós data layer: levels, trials, persistence. No DOM. ES5.
   Browser: window.TOKOS_DATA. Node (tests): module.exports.
   Depends on tokos-core.js (TOKOS_CORE / require). */
(function (G) {
  "use strict";
  var C = (typeof module !== "undefined" && module.exports) ? require("./tokos-core.js") : G.TOKOS_CORE;

  var STORE_KEY = "smd_tokos_v1";
  var PREF_KEY = "smd_tokos_prefs";

  /* Owner decision (mirrors Ophthalmós, 2026-09-28): MBBS free core, Resident = Pro with
     one free trial per feature. Feature ids: clinic.ctg (more added as tracks are added). */
  function levelLocked(cfg, level, pro) {
    if (pro) return false;
    var free = (cfg.access && cfg.access.freeLevels) || ["mbbs"];
    return free.indexOf(level) < 0;
  }
  function trialState(store, featureId, pro) {
    if (pro) return "open";
    return store && store.trials && store.trials[featureId] != null ? "used" : "trial";
  }
  function useTrial(store, featureId, day) {
    if (!store.trials) store.trials = {};
    if (store.trials[featureId] != null) return false;
    store.trials[featureId] = day;
    return true;
  }

  function loadJSON(ls, k, dflt) {
    try { var v = ls && ls.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
  }
  function saveJSON(ls, k, v) { try { if (ls) ls.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function loadStore(ls) {
    var s = loadJSON(ls, STORE_KEY, null);
    if (!s || s.v !== 1 || !s.cards) s = C.emptyStore();
    if (!s.conf) s.conf = {};
    if (!s.days) s.days = {};
    if (!s.trials) s.trials = {};
    return s;
  }
  function saveStore(ls, s) { saveJSON(ls, STORE_KEY, s); }

  function loadPrefs(ls) {
    var p = loadJSON(ls, PREF_KEY, null) || {};
    if (p.level !== "resident") p.level = "mbbs";
    if (p.lang !== "hi") p.lang = "en";
    if (p.tab !== "learn" && p.tab !== "test") delete p.tab;
    return p;
  }
  function savePrefs(ls, p) { saveJSON(ls, PREF_KEY, p); }

  function today(now) { var d = new Date(now); return C.dayNum(d.getTime(), d.getTimezoneOffset()); }

  var API = {
    STORE_KEY: STORE_KEY, PREF_KEY: PREF_KEY,
    levelLocked: levelLocked, trialState: trialState, useTrial: useTrial,
    loadStore: loadStore, saveStore: saveStore, loadPrefs: loadPrefs, savePrefs: savePrefs,
    today: today
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.TOKOS_DATA = API;
})(typeof window !== "undefined" ? window : this);
