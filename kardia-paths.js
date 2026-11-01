/* kardia-paths.js: exam paths (thin overlays on existing content) and the Cases shelf.
   ES5 IIFE. Loaded by kardia-loader.js after kardia-calc.js.
   Design contract (Operate mode, existing Kardia tokens only):
   purpose: a revision evening in order (lesson, view, measurement, formula,
   case, questions), not an index. Paths shelf sits at the top of Learn;
   Cases shelf groups Cases by presentation above the existing list.
   Composition: one scroll column; path rows with a plain progress line,
   a meter and one Resume button; runner shows one current step card plus
   a short step list. States: loading (plain status line), error (retry),
   empty (no paths yet), offline (local files, so the error state says to
   check the app files), long titles wrap and are never cut. Every target
   is at least 44px, press feedback is scale 0.97 on the existing ease,
   transform and opacity only, off under reduced motion. No new palette.
   Progress lives in the engine store like other Kardia progress
   (store.paths[pathId] = { done: {stepIndex: 1}, step: n }) and is saved
   with I.save(). Pure helpers load under node for tests. */
(function (G) {
  "use strict";

  /* ---------- pure helpers (node tests use these) ---------- */
  var PRESENTATIONS = [
    { id: "chest-pain", label: "Chest pain" },
    { id: "breathlessness", label: "Breathlessness" },
    { id: "shock", label: "Shock" },
    { id: "murmur", label: "Murmur" },
    { id: "trauma", label: "Trauma" },
    { id: "other", label: "Other" }
  ];
  /* One presentation per case, judged from the stem (the first complaint
     or the reason for referral). Trauma has no case yet: the group is
     shown with an honest empty line, never filled with a wrong case. */
  var CASE_PRESENTATION = {
    kd11a_ar_moderate_01: "murmur", kd11a_ar_severe_01: "breathlessness",
    kd11a_as_moderate_01: "murmur", kd11a_as_severe_01: "chest-pain",
    kd11a_asd_large_01: "other", kd11a_dcm_moderate_01: "breathlessness",
    kd11a_dcm_severe_01: "breathlessness", kd11a_dissection_surgical_01: "chest-pain",
    kd11a_dissection_uncomplicated_01: "chest-pain", kd11a_effusion_large_01: "breathlessness",
    kd11a_endo_severe_01: "breathlessness", kd11a_hcm_nonobs_definite_01: "chest-pain",
    kd11a_hcm_obs_marked_01: "other", kd11a_lvh_severe_01: "other",
    kd11a_mr_severe_01: "breathlessness", kd11a_ms_mild_01: "murmur",
    kd11a_ms_moderate_01: "breathlessness", kd11a_ms_severe_01: "breathlessness",
    kd11a_pda_moderate_01: "murmur", kd11a_ph_high_01: "breathlessness",
    kd11a_ph_intermediate_01: "breathlessness", kd11a_ph_low_01: "other",
    kd11a_rwma_large_01: "breathlessness", kd11a_rwma_moderate_01: "chest-pain",
    kd11a_tamponade_established_01: "shock", kd11a_tamponade_severe_01: "shock",
    kd11a_thrombus_large_01: "other", kd11a_tof_moderate_01: "other",
    kd11a_tr_severe_01: "breathlessness", kd11a_vsd_moderate_01: "murmur"
  };
  var DIFFICULTY = { mbbs: "Core", resident: "Intermediate", fellow: "Advanced", sonographer: "Focused" };
  var MINUTES = { mbbs: 15, resident: 20, fellow: 25, sonographer: 20 };
  function difficultyLabel(entry) { return DIFFICULTY[entry && entry.level] || "Core"; }
  function expectedMinutes(entry) { return MINUTES[entry && entry.level] || 15; }
  function groupCases(cases) {
    var by = {};
    PRESENTATIONS.forEach(function (p) { by[p.id] = []; });
    (cases || []).forEach(function (c) {
      var g = CASE_PRESENTATION[c.id] || "other";
      by[g].push(c);
    });
    return PRESENTATIONS.map(function (p) { return { id: p.id, label: p.label, cases: by[p.id] }; });
  }
  function pathProgress(path, saved) {
    var total = path && path.steps ? path.steps.length : 0;
    var done = 0, cur = total;
    if (path && path.steps) path.steps.forEach(function (s, i) {
      if (saved && saved.done && saved.done[i]) done++;
      else if (cur === total) cur = i;
    });
    if (done === total && total) cur = total - 1;
    return { done: done, total: total, current: total ? cur : 0, complete: !!total && done === total };
  }
  var HELPERS = { PRESENTATIONS: PRESENTATIONS, CASE_PRESENTATION: CASE_PRESENTATION, groupCases: groupCases, difficultyLabel: difficultyLabel, expectedMinutes: expectedMinutes, pathProgress: pathProgress };
  if (typeof module !== "undefined" && module.exports) module.exports = HELPERS;
  if (!G || typeof G.document === "undefined") return;

  /* ---------- app: Paths shelf, runner and Cases shelf ---------- */
  var S = { paths: null, cases: null, err: false, loading: false, casesErr: false, open: null, navLearn: null, navTab: null, navCases: null };
  var hostRef = null, I = null, st = null;
  function esc(s) { return I ? I.esc(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function humanise(id) { return String(id || "").replace(/^(tte_|pocus_|tee_)/, "").replace(/_/g, " "); }
  function saved(pathId) { return (st && st.store && st.store.paths && st.store.paths[pathId]) || null; }
  function saveSaved(pathId, v) {
    if (!st) return;
    if (!st.store.paths) st.store.paths = {};
    st.store.paths[pathId] = v;
    try { I.save(); } catch (e) {}
  }
  function repaint(f) { if (S.navLearn) S.navLearn(typeof f === "string" ? f : null); }
  function load() {
    if (S.paths || S.loading) return;
    S.loading = true; S.err = false;
    I.getJSON("paths.json").then(function (d) {
      S.paths = d && d.paths ? d : { paths: [] }; S.loading = false; repaint();
    }, function () { S.err = true; S.loading = false; repaint(); });
    if (!S.cases && !S.casesLoading) { S.casesLoading = true; I.getJSON("cases/index.json").then(function (d) {
      S.casesLoading = false; S.cases = d && d.cases ? d.cases : []; if (S.navCases) S.navCases();
    }, function () { S.casesLoading = false; S.casesErr = true; if (S.navCases) S.navCases(); }); }
  }
  function pathById(id) {
    var r = null;
    if (S.paths) S.paths.paths.forEach(function (p) { if (p.id === id) r = p; });
    return r;
  }
  function lessonTitle(id) {
    try {
      var W = hostRef && hostRef._learn && hostRef._learn._w;
      var m = W && W.ix && W.ix.lessons && W.ix.lessons[id];
      if (m) return I.t(m.title);
    } catch (e) {}
    return humanise(id);
  }
  function caseTitle(id) {
    var r = id;
    (S.cases || []).forEach(function (c) { if (c.id === id) r = c.title; });
    return r;
  }
  function stepTitle(step) {
    if (step.type === "lesson") return lessonTitle(step.id);
    if (step.type === "case") return caseTitle(step.id);
    if (step.type === "calc") {
      try { var c = G.KARDIA_CALC && G.KARDIA_CALC.calcById(step.id); if (c) return c.name; } catch (e) {}
      return humanise(step.id);
    }
    if (step.type === "view" && step.title) return step.title;
    if (step.type === "mcq") return (step.ids ? step.ids.length : 0) + " questions to finish";
    return humanise(step.id);
  }
  var STEP_LABEL = { lesson: "Lesson", view: "Echo Lab view", calc: "Calculator", case: "Case", mcq: "Questions" };
  function meterHtml(done, total) {
    var pct = total ? Math.round(done * 100 / total) : 0;
    return '<div class="krd-meter" role="meter" aria-label="Path progress" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + done + '"><span style="width:' + pct + '%"></span></div>';
  }
  function shelfHtml() {
    var head = '<h2 class="sp-h2">Exam paths</h2><p class="sp-small">Short paths in revision order: lesson, view, measurement, formula, then a case and questions. Draft, to be verified.</p>';
    if (S.err) return head + '<div class="sp-err krd-err" role="alert"><p>Exam paths did not load. Check the app files and try again.</p><button type="button" class="sp-btn pri kpath-btn" data-act="kpath-retry">Try again</button></div>';
    if (!S.paths) { load(); return head + '<p class="sp-mut" role="status">Loading exam paths.</p>'; }
    if (!S.paths.paths.length) return head + '<p class="sp-small">No exam paths yet.</p>';
    var rows = S.paths.paths.map(function (p) {
      var pr = pathProgress(p, saved(p.id));
      var line = pr.complete ? "Done. " + pr.total + " of " + pr.total + " steps." :
        pr.done ? "Step " + (pr.current + 1) + " of " + pr.total + ". " + pr.done + " done." : "Not started. " + pr.total + " steps.";
      var btn = pr.complete ? "Review path" : pr.done ? "Resume path" : "Start path";
      return '<li class="kpath-row"><div class="kpath-row-b"><b>' + esc(p.title) + '</b><span class="sp-small">' + esc(p.sub || "") + '</span>' +
        '<span class="sp-small" role="status">' + esc(line) + "</span>" + meterHtml(pr.done, pr.total) + "</div>" +
        '<button type="button" class="sp-btn ' + (pr.done && !pr.complete ? "pri" : "sec") + ' kpath-btn" data-act="kpath-open" data-p="' + esc(p.id) + '">' + btn + "</button></li>";
    }).join("");
    return head + '<ul class="kpath-list">' + rows + "</ul>";
  }
  function runnerHtml(p) {
    var pr = pathProgress(p, saved(p.id));
    var cur = p.steps[pr.current];
    var steps = p.steps.map(function (s, i) {
      var done = !!(saved(p.id) && saved(p.id).done && saved(p.id).done[i]);
      return '<li class="kpath-step' + (i === pr.current ? " on" : "") + '"><span class="kpath-dot" aria-hidden="true">' + (done ? "Done" : (i + 1)) + '</span><span class="kpath-step-b"><b>' + esc(STEP_LABEL[s.type] || s.type) + "</b><span>" + esc(stepTitle(s)) + "</span></span>" +
        (i === pr.current ? '<span class="sp-small">Step ' + (i + 1) + " of " + p.steps.length + "</span>" : "") + "</li>";
    }).join("");
    var doneCur = !!(saved(p.id) && saved(p.id).done && saved(p.id).done[pr.current]);
    return '<button type="button" class="sp-btn sec kpath-btn" data-act="kpath-close">Back to paths</button>' +
      '<h2 class="sp-h2">' + esc(p.title) + '</h2><p class="sp-small">' + esc(p.sub || "") + "</p>" +
      '<p role="status"><b>Step ' + (pr.current + 1) + " of " + p.steps.length + ".</b> " + pr.done + " of " + p.steps.length + " done.</p>" + meterHtml(pr.done, pr.total) +
      '<div class="kpath-cur"><h3 class="sp-h3">' + esc(STEP_LABEL[cur.type] || cur.type) + ": " + esc(stepTitle(cur)) + "</h3>" +
      (cur.type === "mcq" ? '<p class="sp-small">Answer ' + (cur.ids ? cur.ids.length : 0) + " questions on this topic in the question bank, then mark this step done.</p>" : "") +
      '<div class="kpath-actions"><button type="button" class="sp-btn pri kpath-btn" data-act="kpath-go" data-p="' + esc(p.id) + '" data-i="' + pr.current + '">Open this step</button>' +
      '<button type="button" class="sp-btn sec kpath-btn" data-act="kpath-done" data-p="' + esc(p.id) + '" data-i="' + pr.current + '" aria-pressed="' + doneCur + '">' + (doneCur ? "Done. Tap to undo" : "Mark done") + "</button></div></div>" +
      '<ol class="kpath-steps">' + steps + "</ol>" +
      (pr.complete ? '<p class="sp-small" role="status">Path done. You can review any step from the list above.</p>' : "") +
      '<p class="sp-small">Draft, to be verified.</p>';
  }
  function learnHtml() {
    if (S.open) {
      if (!S.paths) { load(); return '<p class="sp-mut" role="status">Loading exam paths.</p>'; }
      var p = pathById(S.open);
      if (p) return runnerHtml(p);
      S.open = null;
    }
    return shelfHtml();
  }
  function casesShelfHtml() {
    var head = '<h2 class="sp-h2">Cases by presentation</h2><p class="sp-small">Pick by how the patient presents. Difficulty and time are a guide. Draft, to be verified.</p>';
    if (S.casesErr && !S.cases) return head + '<div class="sp-err krd-err" role="alert"><p>Cases did not load. Check the app files and try again.</p><button type="button" class="sp-btn pri kpath-btn" data-act="kpath-retry">Try again</button></div>';
    if (!S.cases) { load(); return head + '<p class="sp-mut" role="status">Loading cases.</p>'; }
    if (!S.cases.length) return head + '<p class="sp-small">No cases yet.</p>';
    return head + groupCases(S.cases).map(function (g) {
      if (!g.cases.length) return '<h3 class="sp-h3">' + esc(g.label) + '</h3><p class="sp-small">No cases in this group yet.</p>';
      var rows = g.cases.map(function (c) {
        return '<li><button type="button" class="sp-row kpath-case" data-act="kcase-shelf-open" data-id="' + esc(c.id) + '"><span class="sp-row-b"><b>' + esc(c.title) + '</b><span class="sp-small">' + esc(difficultyLabel(c)) + " · About " + expectedMinutes(c) + " min</span></span></button></li>";
      }).join("");
      return '<h3 class="sp-h3">' + esc(g.label) + '</h3><ul class="sp-rows">' + rows + "</ul>";
    }).join("");
  }
  function goStep(p, i) {
    var s = p.steps[i]; if (!s) return;
    if (s.type === "lesson") {
      if (I.ACTIONS.lesson) I.ACTIONS.lesson({ getAttribute: function (n) { return n === "data-l" ? s.id : null; } });
      return;
    }
    if (s.type === "view") {
      try { if (hostRef && hostRef._kardia && hostRef._kardia.echoLab) hostRef._kardia.echoLab.setView(s.id); } catch (e) {}
      if (S.navTab) S.navTab("echo");
      return;
    }
    if (s.type === "calc") {
      try { if (G.KARDIA_CALC && G.KARDIA_CALC.openCalc) G.KARDIA_CALC.openCalc(s.id); } catch (e) {}
      if (S.navTab) S.navTab("calc");
      return;
    }
    if (s.type === "case") {
      if (S.navTab) S.navTab("cases");
      try { if (G.KARDIA_CASES && G.KARDIA_CASES.openShelf) G.KARDIA_CASES.openShelf(s.id); } catch (e) {}
      return;
    }
    if (s.type === "mcq") {
      var topic = String((s.ids && s.ids[0]) || "").replace(/[0-9]+$/, "");
      if (S.navTab) S.navTab("practice");
      try {
        var bank = hostRef && hostRef._banks && hostRef._banks[0];
        if (bank && bank.topic && topic) bank.topic(topic);
      } catch (e) {}
    }
  }
  function attach(h) {
    if (!h || !h._internal || hostRef === h) { if (h && h._internal) { hostRef = h; I = h._internal; st = h._st; } else return; }
    hostRef = h; I = h._internal; st = h._st;
    var A = I.ACTIONS;
    A["kpath-retry"] = function () { S.err = false; S.casesErr = false; S.paths = null; S.cases = null; S.loading = false; load(); repaint(); if (S.navCases) S.navCases(); };
    A["kpath-open"] = function (b) { S.open = b.getAttribute("data-p"); repaint('[data-act="kpath-close"]'); };
    A["kpath-close"] = function () { S.open = null; repaint(); };
    A["kpath-done"] = function (b) {
      var p = pathById(b.getAttribute("data-p")); if (!p) return;
      var i = +b.getAttribute("data-i");
      var v = saved(p.id) || { done: {}, step: 0 };
      if (!v.done) v.done = {};
      if (v.done[i]) delete v.done[i]; else v.done[i] = 1;
      v.step = pathProgress(p, v).current;
      saveSaved(p.id, v); repaint();
    };
    A["kpath-go"] = function (b) { var p = pathById(b.getAttribute("data-p")); if (p) goStep(p, +b.getAttribute("data-i")); };
    A["kcase-shelf-open"] = function (b) {
      var id = b.getAttribute("data-id");
      try { if (G.KARDIA_CASES && G.KARDIA_CASES.openShelf) { G.KARDIA_CASES.openShelf(id); return; } } catch (e) {}
      if (I.ACTIONS["kcase-open"]) I.ACTIONS["kcase-open"](b);
    };
  }
  G.KARDIA_PATHS = { attach: attach, learnHtml: learnHtml, casesShelfHtml: casesShelfHtml, helpers: HELPERS,
    setNavigator: function (learn, tab, cases) { S.navLearn = learn; S.navTab = tab; S.navCases = cases; },
    isOpen: function () { return !!S.open; }, _state: S };
  if (G.KARDIA && G.KARDIA._internal) attach(G.KARDIA);
})(typeof window !== "undefined" ? window : this);
