/* onco-favorites.js — localStorage-backed Favorites + Recent store for Onco Home (window.SMD_ONCOFAV).
 * Phase 8 P2. Buildless ES5 IIFE. Flag: smd_onco_favorites (queue-flags.js), default OFF.
 *
 * PURE UX, NO CLINICAL CONTENT. An item is just { id, label, act } where `act` is a data-oh-act string
 * Onco Home already knows how to dispatch (a tool card, a disease/calculator row). Favorites are a
 * toggled set; Recent is a capped, de-duplicated most-recent-first list. Every localStorage access is
 * wrapped in try/catch so private mode / disabled storage degrades to an in-memory no-op (never throws,
 * never blocks the UI). window.SMD_ONCOFAV + module.exports (testable in Node). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();

  var FAV_KEY = "smd_onco_fav_v1", RECENT_KEY = "smd_onco_recent_v1", RECENT_CAP = 8;
  // In-memory fallback so a private-mode session still works within the session (just not persisted).
  var mem = { fav: null, recent: null };

  function readArr(key, memKey) {
    try { var raw = LS && LS.getItem(key); if (raw) { var a = JSON.parse(raw); if (a instanceof Array) return a; } } catch (e) {}
    return (mem[memKey] instanceof Array) ? mem[memKey] : [];
  }
  function writeArr(key, memKey, arr) {
    mem[memKey] = arr;
    try { LS && LS.setItem(key, JSON.stringify(arr)); } catch (e) {}
  }
  function clean(item) {
    if (!item || item.id == null) return null;
    return { id: String(item.id), label: String(item.label == null ? item.id : item.label), act: String(item.act == null ? "" : item.act) };
  }

  function all() { return readArr(FAV_KEY, "fav"); }
  function recent() { return readArr(RECENT_KEY, "recent"); }
  function has(id) { id = String(id); return all().some(function (x) { return x.id === id; }); }

  // toggle(item) -> true if now a favorite, false if removed. Idempotent per id.
  function toggle(item) {
    var it = clean(item); if (!it) return false;
    var list = all(), out = [], found = false;
    for (var i = 0; i < list.length; i++) { if (list[i].id === it.id) { found = true; } else { out.push(list[i]); } }
    if (!found) out.unshift(it);
    writeArr(FAV_KEY, "fav", out);
    return !found;
  }

  // record(item) -> push onto Recent, most-recent-first, de-duplicated by id, capped.
  function record(item) {
    var it = clean(item); if (!it || !it.act) return;
    var list = recent().filter(function (x) { return x.id !== it.id; });
    list.unshift(it);
    if (list.length > RECENT_CAP) list = list.slice(0, RECENT_CAP);
    writeArr(RECENT_KEY, "recent", list);
  }

  function clearRecent() { writeArr(RECENT_KEY, "recent", []); }

  var API = { all: all, recent: recent, has: has, toggle: toggle, record: record, clearRecent: clearRecent, RECENT_CAP: RECENT_CAP, _version: "1.0" };
  G.SMD_ONCOFAV = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
