/* clinix-store.js — CliniX · per-skill competency and resume position.
 *
 * Deliberately NOT a fifth progress store. StewardMD already has four unconnected ones
 * (streak.js, ku.js, engagement.js, and kardiox-providers.js's private localStorage key), and the
 * KardiQ one is the cautionary tale: device-local, never synced, mastery credited on a single
 * correct answer, and a hardcoded total of 100 that the UI still displays over 1,141 lessons.
 *
 * So this file owns exactly ONE thing the others cannot: per-skill competency keyed on skill.id,
 * written by every runner (Learn, OSCE, Viva). Streaks, levels and badges are NOT reimplemented -
 * completing a lesson emits into the existing server-authoritative SMD_KU ledger so CliniX feeds
 * the shipped SMD_ENGAGE dashboard.
 *
 * Not encrypted, unlike thorex-store/kardiox-store: this is study progress, not PHI. Encrypting it
 * would also make the competency dashboard's aggregate read impossible without unwrapping every
 * record. If CliniX ever stores anything patient-identifiable, that decision must be revisited.
 *
 * The KV is injectable so the whole thing is node-testable with no browser.
 */
(function () {
  "use strict";

  var KEY_SKILLS = "smd_clinix_skills_v1";
  var KEY_POS = "smd_clinix_pos_v1";
  var KEY_LOG = "smd_clinix_log_v1";
  var MAX_DAYS = 60;      // per skill: enough to judge spacing, bounded so a record cannot grow forever
  var MAX_LOG = 200;      // recent activity, for the "what did I get wrong" view

  function lsKV() {
    return {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
      del: function (k) { try { localStorage.removeItem(k); return true; } catch (e) { return false; } }
    };
  }
  function memKV() {
    var m = {};
    return {
      get: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      set: function (k, v) { m[k] = String(v); return true; },
      del: function (k) { delete m[k]; return true; }
    };
  }

  function model() {
    try {
      if (typeof window !== "undefined" && window.SMD_CLINIX_MODEL) return window.SMD_CLINIX_MODEL;
    } catch (e) {}
    try { return require("./clinix-model.js"); } catch (e) {}
    return null;
  }

  function makeStore(deps) {
    deps = deps || {};
    var kv = deps.kv || (typeof localStorage !== "undefined" ? lsKV() : memKV());
    var M = deps.model || model();
    // Injectable so a test can pin "today" and prove the separate-days rule actually bites.
    var today = deps.today || function () {
      var d = new Date();
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    };
    function pad(n) { return n < 10 ? "0" + n : String(n); }

    function readJSON(key, fallback) {
      var raw = kv.get(key);
      if (!raw) return fallback;
      try { var v = JSON.parse(raw); return v && typeof v === "object" ? v : fallback; }
      catch (e) { return fallback; }        // a corrupt record must not take the module down
    }
    function writeJSON(key, val) {
      try { return kv.set(key, JSON.stringify(val)); } catch (e) { return false; }
    }

    function allSkills() { return readJSON(KEY_SKILLS, {}); }

    function keyFor(skillId) {
      return M ? M.competencyKey(skillId) : ("cx:" + String(skillId));
    }

    function get(skillId) {
      var all = allSkills();
      return all[keyFor(skillId)] || null;
    }

    /* Record one attempt at one skill. `correct` may be true, false, or null (unmarked, e.g. a
     * free-text answer awaiting a judge) - an unmarked attempt counts as seen but never as correct,
     * so an unjudged answer can never inflate mastery. */
    function record(skillId, correct, meta) {
      if (!skillId) return null;
      var all = allSkills();
      var k = keyFor(skillId);
      var r = all[k] || { seen: 0, correct: 0, days: [], first: null, last: null };
      var day = today();

      r.seen += 1;
      if (correct === true) r.correct += 1;
      if (correct === false) r.wrong = (r.wrong || 0) + 1;
      if (!r.first) r.first = day;
      r.last = day;

      // Separate DAYS, not separate attempts: this is what stops a single session minting mastery.
      if (r.days.indexOf(day) < 0) {
        r.days.push(day);
        if (r.days.length > MAX_DAYS) r.days = r.days.slice(-MAX_DAYS);
      }

      all[k] = r;
      writeJSON(KEY_SKILLS, all);

      if (correct === false) logMiss(skillId, meta);
      return r;
    }

    /* A miss is the most useful thing CliniX stores. "You repeatedly miss chest expansion" is only
     * possible because the wrong answers are kept, not just the score. */
    function logMiss(skillId, meta) {
      var log = readJSON(KEY_LOG, { items: [] });
      if (!log.items) log.items = [];
      log.items.push({
        skillId: skillId,
        day: today(),
        mode: (meta && meta.mode) || "learn",
        probe: (meta && meta.probe) || null,
        given: (meta && meta.given) || null
      });
      if (log.items.length > MAX_LOG) log.items = log.items.slice(-MAX_LOG);
      writeJSON(KEY_LOG, log);
    }

    function misses(limit) {
      var log = readJSON(KEY_LOG, { items: [] });
      var items = (log.items || []).slice().reverse();
      return limit ? items.slice(0, limit) : items;
    }

    /* Which skills is this student worst at, across every mode. Drives the "Weak areas" panel and
     * the personalised revision recommendation. */
    function weakest(limit) {
      var all = allSkills(), out = [];
      for (var k in all) {
        if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
        var r = all[k];
        if (!r || !r.seen) continue;
        var m = M ? M.masteryOf(r) : { level: "learning", accuracy: r.correct / r.seen };
        if (m.level === "mastered") continue;
        out.push({ key: k, skillId: k.replace(/^cx:/, ""), accuracy: m.accuracy, seen: r.seen, level: m.level });
      }
      // Worst accuracy first, and among equals the one attempted most (more evidence it is real).
      out.sort(function (a, b) { return (a.accuracy - b.accuracy) || (b.seen - a.seen); });
      return limit ? out.slice(0, limit) : out;
    }

    function competency(skillIds) {
      if (!M) return { total: (skillIds || []).length, mastered: 0, pct: 0, weak: [] };
      return M.competencyFor(skillIds || [], allSkills());
    }

    function mastery(skillId) {
      return M ? M.masteryOf(get(skillId)) : { level: "new", pct: 0, accuracy: 0 };
    }

    /* Resume. "Resume learning later from their previous position" is a definition-of-done item,
     * and it needs the turn index, not just the lesson, or a student loses their place inside a
     * long skill every time they close the app. */
    function savePosition(pos) {
      if (!pos || !pos.diseaseId) return false;
      return writeJSON(KEY_POS, {
        diseaseId: pos.diseaseId,
        chapterId: pos.chapterId || null,
        skillId: pos.skillId || null,
        turnIndex: typeof pos.turnIndex === "number" ? pos.turnIndex : 0,
        at: today()
      });
    }
    function position() { return readJSON(KEY_POS, null); }
    function clearPosition() { return kv.del(KEY_POS); }

    /* Feed the EXISTING ledger rather than inventing a parallel one. Best-effort and silent:
     * a learning module must never break because an engagement API moved. */
    function emitKU(type, refId) {
      try {
        var root = typeof window !== "undefined" ? window : null;
        if (root && root.SMD_KU && root.SMD_KU.emit) root.SMD_KU.emit(type, refId);
      } catch (e) {}
    }

    function completeLesson(skillId, diseaseId) {
      emitKU("learn", diseaseId ? (diseaseId + "/" + skillId) : skillId);
      return true;
    }

    /* Sign-out wipe. Progress is per person, so it must not survive into the next account on the
     * same device - the StewardMD ID decision of 2026-08-22 records exactly this class of bug. */
    function deleteAll() {
      kv.del(KEY_SKILLS); kv.del(KEY_POS); kv.del(KEY_LOG);
      return true;
    }

    function exportAll() {
      return { skills: allSkills(), position: position(), log: readJSON(KEY_LOG, { items: [] }) };
    }

    return {
      get: get, record: record, all: allSkills,
      mastery: mastery, competency: competency,
      weakest: weakest, misses: misses,
      savePosition: savePosition, position: position, clearPosition: clearPosition,
      completeLesson: completeLesson,
      deleteAll: deleteAll, exportAll: exportAll,
      _today: today
    };
  }

  var API = {
    makeStore: makeStore,
    _memKV: memKV,
    __testStore: function (deps) { return makeStore(Object.assign({ kv: memKV() }, deps || {})); },
    create: function () { return makeStore(); }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") {
    window.SMD_CLINIX_STORE = API;
    // One shared instance so every runner writes to the same competency record.
    try { window.SMD_CLINIX_PROGRESS = API.create(); } catch (e) {}
  }
})();
