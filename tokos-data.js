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

  /* ---------- FIGO checklist (v2). MBBS: 5 reading questions. Resident: plus the FIGO action, and the
     deceleration type only where an obstetrician confirmed it (case.review.decelType). ---------- */
  var QUESTIONS = {
    uc: ["normal", "tachysystole"],
    baseline: ["severe_bradycardia", "bradycardia", "normal", "tachycardia"],
    variability: ["reduced", "normal", "increased"],
    decels: ["none", "present", "prolonged", "over5"],
    decelType: ["early", "late", "variable", "prolonged"],
    figo: ["normal", "suspicious", "pathological"],
    action: ["normal", "suspicious", "pathological"] // answer ids reuse the category; labels carry the FIGO action text
  };
  function checklistFor(c, level) {
    var q = ["uc", "baseline", "variability", "decels", "figo"];
    if (level !== "resident") return q;
    if (rev(c.review || {}, "decelType", "decelType")) q.push("decelType");
    q.push("action");
    return q;
  }
  /* A reviewer's label (case.review.<field>) wins over the rule for every graded field: uc, baselineClass,
     variability, decels, decelType, figo (action always follows figo). A value outside QUESTIONS is ignored. */
  function rev(r, field, q) { return r[field] != null && QUESTIONS[q].indexOf(r[field]) >= 0 ? r[field] : null; }
  function truthFor(c) {
    var f = c.features, r = c.review || {}, maxD = 0;
    (f.decels || []).forEach(function (d) { if (d.durationSec > maxD) maxD = d.durationSec; });
    var figo = rev(r, "figo", "figo") || c.figo;
    var t = {
      uc: rev(r, "uc", "uc") || (f.contractions.tachysystole ? "tachysystole" : "normal"),
      baseline: rev(r, "baselineClass", "baseline") || f.baselineClass,
      variability: rev(r, "variability", "variability") || f.variability.band,
      decels: rev(r, "decels", "decels") || (!f.decels || !f.decels.length ? "none" : maxD > 300 ? "over5" : maxD >= 180 ? "prolonged" : "present"),
      figo: figo, action: figo
    };
    if (rev(r, "decelType", "decelType")) t.decelType = r.decelType;
    return t;
  }
  // Complete review: the obstetrician confirmed every graded field of this case and set review.complete = true.
  // Only then does the reveal drop the "Rule-based, pending obstetrician review" banner.
  function reviewComplete(c) { return !!(c && c.review && c.review.complete === true); }
  function gradeChecklist(ids, answers, truth) {
    var perQ = {}, m = 0;
    ids.forEach(function (q) { perQ[q] = answers[q] === truth[q]; if (perQ[q]) m++; });
    var pct = ids.length ? m / ids.length : 0, g;
    if (pct < 0.5) g = C.AGAIN;
    else if (!perQ.figo) g = C.HARD; // the overall category is the clinically critical call
    else if (pct < 0.8) g = C.HARD;
    else if (pct < 1) g = C.GOOD;
    else g = C.EASY;
    return { matches: m, total: ids.length, pct: pct, grade: g, perQ: perQ };
  }
  function rationaleKeys(c) {
    var t = truthFor(c), k = [];
    if (t.baseline !== "normal") k.push("baseline." + t.baseline);
    if (t.variability !== "normal") k.push("variability." + t.variability);
    if (t.decels !== "none") k.push("decels." + t.decels);
    if (t.uc === "tachysystole") k.push("uc.tachysystole");
    if (c.acidosis === "metabolic" || c.acidosis === "acidaemia_not_metabolic") k.push("acidosis." + c.acidosis);
    ((c.vignette && c.vignette.risks) || []).forEach(function (r) { if (r === "pyrexia" || r === "preeclampsia") k.push("risk." + r); });
    k.push("trace_vs_outcome");
    return k;
  }

  var API = {
    STORE_KEY: STORE_KEY, PREF_KEY: PREF_KEY,
    levelLocked: levelLocked, trialState: trialState, useTrial: useTrial,
    loadStore: loadStore, saveStore: saveStore, loadPrefs: loadPrefs, savePrefs: savePrefs,
    today: today,
    QUESTIONS: QUESTIONS, checklistFor: checklistFor, truthFor: truthFor, reviewComplete: reviewComplete, gradeChecklist: gradeChecklist, rationaleKeys: rationaleKeys
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.TOKOS_DATA = API;
})(typeof window !== "undefined" ? window : this);
