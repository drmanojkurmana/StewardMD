/* Ophthalmós data layer: tracks, levels, access, persistence. No DOM. ES5.
   Browser: window.OPHTHALMOS_DATA. Node (tests): module.exports.
   Depends on ophthalmos-core.js (OPHTHALMOS_CORE / require). */
(function (G) {
  "use strict";
  var C = (typeof module !== "undefined" && module.exports) ? require("./ophthalmos-core.js") : G.OPHTHALMOS_CORE;

  var STORE_KEY = "smd_ophthalmos_v1";
  var PREF_KEY = "smd_ophthalmos_prefs";

  /* ---------- levels ---------- */
  // Foundation groups fine classes into what a student should tell apart first; Resident is the
  // dataset's own classification. Each level keeps its own memory state and confusion table.
  function levelKey(trackId, level) { return trackId + (level === "resident" ? ".r" : ".f"); }

  function optionsFor(track, deck, level) {
    if (level !== "resident" && track.foundation) {
      return track.foundation.map(function (g) { return { id: g.id, label: g.label, of: g.of }; });
    }
    return (deck ? deck.options : Object.keys(track.labels || {})).map(function (a) {
      return { id: a, label: (track.labels && track.labels[a]) || a, of: [a] };
    });
  }

  function truthFor(track, level, fineAnswer) {
    if (level !== "resident" && track.foundation) {
      for (var i = 0; i < track.foundation.length; i++)
        if (track.foundation[i].of.indexOf(fineAnswer) >= 0) return track.foundation[i].id;
    }
    return fineAnswer;
  }

  // The deck as the scheduler sees it at a level: same ids, answers mapped to the level's classes.
  function levelDeck(track, deck, level) {
    return {
      id: levelKey(track.id, level),
      items: deck.items.map(function (it) { return { id: it.id, a: truthFor(track, level, it.a), it: it }; })
    };
  }

  /* ---------- access (owner decision: free core, Pro extras) ---------- */
  function levelLocked(cfg, level, pro) {
    if (pro) return false;
    var free = (cfg.access && cfg.access.freeLevels) || ["foundation"];
    return free.indexOf(level) < 0;
  }
  function caseLocked(cfg, caseIndex, pro) {
    if (pro) return false;
    var n = cfg.access && cfg.access.freeCases != null ? cfg.access.freeCases : 10;
    return caseIndex >= n;
  }

  /* ---------- persistence ---------- */
  function loadJSON(ls, k, dflt) {
    try { var v = ls && ls.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
  }
  function saveJSON(ls, k, v) { try { if (ls) ls.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function loadStore(ls) {
    var s = loadJSON(ls, STORE_KEY, null);
    if (!s || s.v !== 1 || !s.cards) s = C.emptyStore();
    if (!s.conf) s.conf = {};
    if (!s.days) s.days = {};
    return s;
  }
  function saveStore(ls, s) { saveJSON(ls, STORE_KEY, s); }
  function loadPrefs(ls) { return loadJSON(ls, PREF_KEY, { level: "foundation" }); }
  function savePrefs(ls, p) { saveJSON(ls, PREF_KEY, p); }

  /* ---------- helpers for the UI ---------- */
  function today(now) { var d = new Date(now); return C.dayNum(d.getTime(), d.getTimezoneOffset()); }

  // One representative image per class for a track's thumbnail strip: stable across renders.
  function sampleByClass(deck, max) {
    var seen = {}, out = [];
    for (var i = 0; i < deck.items.length && out.length < max; i++) {
      var it = deck.items[(i * 7919) % deck.items.length];
      if (!seen[it.a]) { seen[it.a] = 1; out.push(it); }
    }
    return out;
  }

  // Due-tomorrow forecast for the summary screen.
  function dueOn(store, prefix, day) {
    var n = 0;
    Object.keys(store.cards).forEach(function (k) {
      if (k.indexOf(prefix) === 0 && store.cards[k][3] <= day) n++;
    });
    return n;
  }

  var API = {
    STORE_KEY: STORE_KEY, PREF_KEY: PREF_KEY,
    levelKey: levelKey, optionsFor: optionsFor, truthFor: truthFor, levelDeck: levelDeck,
    levelLocked: levelLocked, caseLocked: caseLocked,
    loadStore: loadStore, saveStore: saveStore, loadPrefs: loadPrefs, savePrefs: savePrefs,
    today: today, sampleByClass: sampleByClass, dueOn: dueOn
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.OPHTHALMOS_DATA = API;
})(typeof window !== "undefined" ? window : this);
