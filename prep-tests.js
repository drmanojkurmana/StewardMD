/* PrepNucleus Tests 2 (Tests & Assessment Engine M1, 2026-10-10): the Tests tab's test types on the official exam
   profiles. window.PREP_TESTS. ES5. Flag smd_prep_tests2, default ON for all (owner 2026-10-11): localStorage
   smd_prep_tests2 = "0" or ?tests2=0 turns it off; "1" or ?tests2=1 turns it on. Off, the Tests tab is exactly as
   before (prep.js MOCKS, one overall timer).

   On, the Tests segment lists, for the exam tab, grouped by exam then by format (owner 2026-10-11, collapsible):
   - an interrupted test to resume (saved in IndexedDB "prep-bank" / "files" under run:t2 at every answer and every 5 s);
   - one collapsible exam section per profile (prep/assess/profiles via prep-profiles.js), the student's exam first and
     open, the rest closed: the full exam in its official locked timed sections (NEET-PG 180 = 5 x 36 x 42 min; INI-CET
     200 = 4 x 50 x 45 min; FMGE 2 parts x 3 x 50 x 50 min; NEET-SS 150 = 3 x 50 x 50 min; USMLE Step 1 blocks of 20 in
     30 min), one section, one FMGE part; the NEET-PG pattern of earlier years (200 questions, one timer) as "previous
     format practice" in Grand tests;
   - inside each exam, one collapsible group per format (Daily 10, Grand, Part, Mini, Subject, Topic, Image, PYQ,
     Custom/diagnostic), each with its engine starter and its ready-made papers (tools/prep-fixed-tests.mjs, R2
     prep-bank/v1/tests/, same for every student) with completion status; Daily 10 and Grand open by default, the rest
     closed; big groups show the first 6 with Show all, and a filter box past 20; a sticky jump bar jumps to a format;
   - Daily 10: exactly 10 questions at the exam's own pace (10 x seconds a question), the same 10 all day (seed = exam +
     IST date), counted once a day (prep-assess.js dailyComplete; a retry is practice);
   - practice: subject and topic pickers inside their groups, adaptive diagnostic and custom inside Custom/diagnostic,
     Today's set, weak areas, My mistakes and the statistics switch once under Your practice, the previous year papers
     (NEET-PG recall) inside that exam's PYQ group, each only when it has questions.
   Collapsed groups render lazily (no paper rows until opened) so the tab opens instantly with 800+ papers; open state
   persists per exam in localStorage smd_prep_t2grp. A group header shows the name, the paper count and the done count.
   Before a test starts, a screen says what the assembly found: the size (reduced, and why, when the bank cannot fill
   the blueprint) and every deviation. The runner, marking, timer line and review are prep.js's. */
(function (G) {
  "use strict";
  var A = G.PREP_ASSESS, D = G.document, FLAG = "smd_prep_tests2", RUN_KEY = "run:t2", REC_KEY = "t2r:";
  var FX_VER = "v1";   // fixed papers version (tools/prep-fixed-tests.mjs TESTS_VER; bumped together)
  var P = { sess: undefined, sessP: null, cov: {}, qual: null, qualP: null, lastSave: 0, pick: null, fx: null, fxP: null, fxm: {}, grpShow: {}, grpQ: {}, grpLis: false };
  var H = null;

  function on() {
    try { var q = (G.location.search.match(/[?&]tests2=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; var v = G.localStorage.getItem(FLAG); return v !== "0"; } catch (e) { return true; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function mins(sec) { var m = Math.round(sec / 60), h = Math.floor(m / 60), r = m % 60; return (h ? h + " h" : "") + (h && r ? " " : "") + (r || !h ? r + " min" : ""); }
  function mark(x) { x = Math.abs(x); return Math.abs(x - 1 / 3) < 1e-6 ? "1/3" : String(Math.round(x * 100) / 100); }
  function marking(p) { var sc = p.scoring; return "+" + mark(sc.correct) + " right, " + (sc.incorrect ? "minus " + mark(sc.incorrect) + " wrong" : "no negative marking") + ", unanswered 0"; }
  function store() { var s = H.store(); if (!s.t2h || !Array.isArray(s.t2h)) s.t2h = []; if (!s.t2d || typeof s.t2d !== "object") s.t2d = {}; return s; }
  function tab() { return H.exam().id; }
  // Exam-owned pools (profile bank.pool, e.g. "usmle-step2-ck"): a pooled exam draws only items carrying
  // its tag, however few; every other exam drops items owned by a pool, so pooled banks never leak.
  function poolOf(p) { return p && p.bank && p.bank.pool; }
  function poolTags() { var out = {}; try { A.profileIds().forEach(function (id) { var q = A.profile(id); if (q && q.bank && q.bank.pool) out[q.bank.pool] = 1; }); } catch (e) {} return out; }
  function poolItems(items, p, hidden) {
    var pt = poolOf(p);
    if (pt) return H.pure.poolFor(items, pt, hidden, true);
    var tags = poolTags(), any = false, k;
    for (k in tags) { any = true; break; }
    if (!any) return items;
    return (items || []).filter(function (it) {
      if (!it.ex || !it.ex.length) return true;
      for (var i = 0; i < it.ex.length; i++) if (tags[it.ex[i]]) return false;
      return true;
    });
  }
  // The plan's subjects on this tab (the NEET-SS group, the one INI-SS subject); the whole tab without a plan host.
  function planSubs() {
    try { if (H.planSubjects) { var r = H.planSubjects(); if (r) return r; } } catch (e) {}
    try { return H.subjectsOf(tab()); } catch (e2) { return []; }
  }
  // The student's exam: the selected plan's exam profile, wherever it sits (plan choice INI-SS on the NEET-SS tab,
  // USMLE Step 1 or Step 2 CK as selected). The tab's first profile only when no plan is stored.
  function primary() {
    var s = H.store(), ch = s.pl && s.pl.exam, list = A.forTab(tab());
    var PP = G.PREP_PLAN && G.PREP_PLAN._pure;
    var id = PP && ch ? PP.planProfileId(ch) : (ch === "usmle" ? "usmle-step1" : ch);
    if (id) {
      var hit = null;
      try { hit = A.profile(id); } catch (e) { hit = null; }
      if (hit) return hit;
    }
    var sub = list.filter(function (p) { return p.status === "official" || p.id !== "ini-ss"; });
    for (var i = 0; i < sub.length; i++) if (sub[i].id === id) return sub[i];
    return sub[0] || list[0] || null;
  }
  // The plan's paper scope for an exam: null = the whole exam; else { subs, names, all } and ready-made papers
  // narrow to these subjects (subject and topic papers by their bank subject, exam-wide papers need the whole exam).
  function planScope(p0) {
    var subs = null, all = null;
    try { subs = H.planSubjects ? H.planSubjects() : H.subjectsOf(tab()); } catch (e) { subs = null; }
    try { all = H.subjectsOf(tab()); } catch (e2) { all = null; }
    if (!subs || !all) return null;
    var sids = subs.map(function (x) { return x.id; }), aids = all.map(function (x) { return x.id; });
    if (sids.length === aids.length) return null;
    var names = {};
    sids.forEach(function (id) {
      var sb = null;
      try { sb = H.subjectById(id); } catch (e3) { sb = null; }
      var nm = "";
      try { nm = sb ? (H.tx ? H.tx(sb.name) : (sb.name && sb.name.en) || sb.name) : id; } catch (e4) { nm = id; }
      names[id] = String(nm || id).toLowerCase();
    });
    return { subs: sids, names: names, all: aids };
  }
  function srcLine(p) {
    var keys = Object.keys(p.sources || {});
    if (p.status !== "official" && !keys.length) return "Provisional: no official document; pattern from secondary sources.";
    var s0 = p.sources[keys[0]];
    return (p.status === "official" ? "Official format: " : "Provisional: format from ") + s0.title + ", checked " + dmy(p.verified_on) + "." + (p.status === "official" ? "" : " Some rules are not stated there and are assumed.");
  }
  function dmy(iso) { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); } catch (e) { return iso; } }
  function dm(ts) { try { return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch (e) { return ""; } }
  function typeName(t) { return { grand: "Full exam", part: "One part", mini: "One section", daily10: "Daily 10", daily_mixed: "Daily mixed", subject_mini: "Subject test", topic: "Topic test", image: "Image test", case: "Clinical cases", diagnostic: "Adaptive diagnostic", weak_area: "Weak areas", incorrect: "Incorrect questions", custom: "Custom" }[t] || t; }
  function lastOf(pid, type) { var h = store().t2h, r = null; h.forEach(function (x) { if (x.exam === pid && x.type === type) r = x; }); return r; }
  function lastOfPaper(id) { var h = store().t2h, r = null; h.forEach(function (x) { if (x.paper === id) r = x; }); return r; }
  function fxFormatName(f) { return { grand: "Grand tests", part: "Part tests", mini: "Mini tests", subject_mini: "Subject tests", topic: "Topic tests", daily10: "Daily 10", image: "Image tests", pyq: "PYQ papers" }[f] || f; }
  /* Collapsible grouping (pure helpers, tested in test/prep-tests-collapse.test.mjs). */
  var GRP_KEY = "smd_prep_t2grp";
  var GRP_ORDER = ["daily10", "grand", "part", "mini", "subject_mini", "topic", "image", "case", "weak_area", "incorrect", "pyq", "custom"];
  var GRP_NAME = { daily10: "Daily sets", grand: "Grand tests", part: "Part tests", mini: "Mini tests", subject_mini: "Subject tests", topic: "Topic tests", image: "Image tests", case: "Clinical cases", weak_area: "Weak areas", incorrect: "Incorrect questions", pyq: "PYQ papers", custom: "Custom/diagnostic" };
  var GRP_SHORT = { daily10: "Daily", grand: "Grand", part: "Part", mini: "Mini", subject_mini: "Subject", topic: "Topic", image: "Image", case: "Cases", weak_area: "Weak", incorrect: "Incorrect", pyq: "PYQ", custom: "Custom" };
  var GRP_FIRST = 6, GRP_SEARCH_AT = 20;
  function grpName(f) { return GRP_NAME[f] || fxFormatName(f); }
  function grpShort(f) { return GRP_SHORT[f] || f; }
  function examOrder(list, primaryId) { var out = [], rest = []; (list || []).forEach(function (p) { if (p.id === primaryId) out.push(p); else rest.push(p); }); return out.concat(rest); }
  /* The bank subject a ready-made paper belongs to, from its id (<exam>-sub-<sid>-<n>, <exam>-topic-<sid>-...):
     the subject id, false for a subject paper whose subject is not in sids, null when the paper is exam-wide
     (grand, mini, general image) or its id is unknown. Exam-wide papers stay exam-wide. */
  function paperSubject(r, sids) {
    if (!r || !r.id) return null;
    var pre = null;
    if (r.format === "subject_mini") pre = r.exam + "-sub-";
    else if (r.format === "topic") pre = r.exam + "-topic-";
    else return null;
    if (r.id.indexOf(pre) !== 0) return null;
    var rest = r.id.slice(pre.length);
    if (r.format === "subject_mini") { var m = /^(.*)-\d+$/.exec(rest), sid = m ? m[1] : rest; return (sids || []).indexOf(sid) >= 0 ? sid : false; }
    var best = null;
    (sids || []).forEach(function (sid) { if ((rest === sid || rest.indexOf(sid + "-") === 0) && (!best || sid.length > best.length)) best = sid; });
    return best || false;
  }
  // A paper under a plan scope ({ subs, names, all } from planScope, else null = the whole exam): subject and topic
  // papers keep the plan's subjects; a subject image paper keeps its named subject; exam-wide papers need the plan
  // to cover the whole exam (so a filtered group never shows a paper built from other subjects).
  function fxInPlan(r, format, plan) {
    if (!plan || !plan.subs) return true;
    if (format === "subject_mini" || format === "topic") { var sid = paperSubject(r, plan.all); return !!sid && plan.subs.indexOf(sid) >= 0; }
    if (format === "image") {
      var sc = String(r.scope || "").toLowerCase(), hit = false;
      plan.subs.forEach(function (id) { var nm = plan.names && plan.names[id]; if (nm && sc.indexOf(nm) >= 0) hit = true; });
      return hit;
    }
    return false;
  }
  function fxFor(papers, examId, format, plan) { return (papers || []).filter(function (r) { return r.exam === examId && r.format === format && fxInPlan(r, format, plan); }); }
  function paperDone(t2h, paperId) { var d = false; (t2h || []).forEach(function (x) { if (x.paper === paperId) d = true; }); return d; }
  function engineDone(t2h, pid, type) { var d = false; (t2h || []).forEach(function (x) { if (x.exam === pid && x.type === type && !x.paper) d = true; }); return d; }
  function dailyDoneByKey(t2d, key) { return !!(t2d && key && t2d[key]); }
  function countFxDone(list, t2h) { var n = 0; (list || []).forEach(function (r) { if (paperDone(t2h, r.id)) n++; }); return n; }
  function defaultExamOpen(examId, primaryId) { return examId === primaryId; }
  function defaultGrpOpen(examId, primaryId, format) { return examId === primaryId && (format === "daily10" || format === "grand"); }
  function loadGrp() { try { var v = G.localStorage.getItem(GRP_KEY); if (!v) return { v: 1, exams: {} }; var o = JSON.parse(v); if (!o || typeof o !== "object" || !o.exams) return { v: 1, exams: {} }; return o; } catch (e) { return { v: 1, exams: {} }; } }
  function saveGrp(st) { try { G.localStorage.setItem(GRP_KEY, JSON.stringify(st)); } catch (e) {} return st; }
  function grpIsOpen(st, examId, primaryId, format) { try { var e = st && st.exams && st.exams[examId]; if (e && e.groups && Object.prototype.hasOwnProperty.call(e.groups, format)) return !!e.groups[format]; } catch (e2) {} return defaultGrpOpen(examId, primaryId, format); }
  function examIsOpen(st, examId, primaryId) { try { var e = st && st.exams && st.exams[examId]; if (e && Object.prototype.hasOwnProperty.call(e, "open")) return !!e.open; } catch (e2) {} return defaultExamOpen(examId, primaryId); }
  function setGrpOpen(st, examId, format, open) { st = st && st.exams ? st : { v: 1, exams: {} }; var e = st.exams[examId] || (st.exams[examId] = {}); var g = e.groups || (e.groups = {}); g[format] = !!open; return saveGrp(st); }
  function setExamOpen(st, examId, open) { st = st && st.exams ? st : { v: 1, exams: {} }; var e = st.exams[examId] || (st.exams[examId] = {}); e.open = !!open; return saveGrp(st); }
  function filterFx(papers, q) { q = String(q || "").toLowerCase().replace(/^\s+|\s+$/g, ""); if (!q) return papers || []; return (papers || []).filter(function (r) { return String(r.title + " " + (r.scope || "") + " " + r.id).toLowerCase().indexOf(q) >= 0; }); }
  function visibleFx(papers, showAll) { papers = papers || []; if (showAll || papers.length <= GRP_FIRST) return papers; return papers.slice(0, GRP_FIRST); }
  function grpKey(pid, f) { return pid + "|" + f; }

  /* ---------- saved session ---------- */
  function loadSess() {
    if (P.sessP) return P.sessP;
    P.sessP = Promise.resolve(H.cacheGet(RUN_KEY)).then(function (pk) { P.sess = pk && pk.v === 1 && pk.t2 && pk.t2.exam === tab() ? pk : pk && pk.v === 1 ? pk : null; return P.sess; }, function () { P.sess = null; return null; });
    return P.sessP;
  }
  function persist(r, force) {
    var now = Date.now();
    if (!force && now - P.lastSave < A.SAVE_EVERY_MS) return;
    P.lastSave = now;
    var pk = A.sessPack(r, now); P.sess = pk; P.sessP = Promise.resolve(pk);
    H.cachePut(RUN_KEY, pk);
  }
  function clearSess() { P.sess = null; P.sessP = Promise.resolve(null); return H.cacheDel(RUN_KEY); }
  function left() { P.sessP = null; }
  // "Section C · 12:40 left", from the saved clock (the time away counted, rule 3).
  function sessWhere(pk) {
    var t = pk.t2, now = Date.now();
    if (pk.sc) {
      var c = pk.sc, k = c.k, sec = t.sections[k];
      if (pk.phase === "between" || !c.run) { var nx = t.sections[k + 1]; return nx ? sec.label + " submitted · " + nx.label + " next" : "All sections submitted"; }
      var lf = Math.max(0, c.lim[k] - c.used[k] - Math.max(0, now - c.wall));
      return sec.label + (lf > 0 ? " · " + mmss(lf / 1000) + " left" : " · time up, submits on resume");
    }
    if (pk.limit) { var l2 = pk.limit - (now - pk.t0) / 1000; return l2 > 0 ? mmss(l2) + " left" : "Time up, marks on resume"; }
    return pk.ans.filter(function (a) { return a >= 0; }).length + " of " + pk.q.length + " answered";
  }
  function resumeHtml(pk) {
    return '<section class="pn-panel pn-t2res" aria-labelledby="pnT2ResH"><p class="pn-t2eb">Interrupted test</p><h2 class="pn-h" id="pnT2ResH">Resume your ' + esc(pk.title) + "</h2>" +
      '<p class="pn-mut" id="pnT2ResW">' + esc(sessWhere(pk)) + ". Saved " + esc(agoTxt(pk.saved)) + ".</p>" +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="t2-discard">Discard</button><button type="button" class="pn-btn pri" data-act="t2-resume">' + H.ico("play") + " Resume</button></div></section>";
  }
  function agoTxt(ts) { var m = Math.round((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : dm(ts); }
  function resume() {
    var pk = P.sess; if (!pk) return;
    var pairs = [], seen = {};
    pk.q.forEach(function (x) { var k = x[0] + "|" + x[1]; if (!seen[k]) { seen[k] = 1; pairs.push({ s: x[0], m: x[1] }); } });
    H.stack().push(function () {}); H.loadingScreen(esc(pk.title), "Loading your test…");
    H.loadMany(pairs, H.stepMsg).then(function (lists) {
      var by = {}; lists.forEach(function (l) { by[l.s + "|" + l.m] = l.items; });
      var u = A.sessUnpack(pk, by);
      H.stack().pop();
      if (u.missing === u.items.length) { H.toast("The questions of this test did not load. Check the connection and try again."); return H.rerender(); }
      if (u.missing) H.toast(u.missing + (u.missing === 1 ? " question was" : " questions were") + " withdrawn since; " + (u.missing === 1 ? "it is" : "they are") + " left out of the marks.");
      var p = A.profile(pk.t2.exam);
      H.run(u.items, pk.mode, pk.title, { t2: pk.t2, sections: pk.t2.sections, limit: pk.limit || 0, scheme: p ? A.scheme(p) : null, resume: { i: pk.i, ans: pk.ans, mark: pk.mark, ms: pk.ms, changed: pk.changed, conf: pk.conf, pair: pk.pair, t0: pk.t0, sc: pk.sc, phase: pk.phase } });
    });
  }

  /* ---------- the Tests segment ---------- */
  function examShape(p) {
    var f = p.format, secs = f.sections, n1 = secs[0], parts = f.parts;
    if (p.id === "usmle-step1" || p.id === "usmle-step2-ck") return "Blocks of up to " + f.block_max_items + " questions, " + n1.minutes + " min each; the full exam has " + secs.length + " blocks";
    if (parts) { var per = secs.length / parts; return f.questions + " questions in " + parts + " parts of " + (f.questions / parts) + (per > 1 ? ", each in " + per + " locked sections of " + n1.questions + " questions and " + n1.minutes + " min" : ", each one locked section of " + n1.questions + " questions and " + n1.minutes + " min"); }
    if (secs.length > 1) return f.questions + " questions in " + secs.length + " locked sections of " + n1.questions + " questions and " + n1.minutes + " min";
    return f.questions + " questions, " + mins(f.duration_min * 60);
  }
  function examPass(p) { return p.scoring.pass ? " " + (p.scoring.pass.label || "Pass mark") + " " + p.scoring.pass.marks + " of " + p.scoring.pass.of + "." : ""; }
  function examInfoHtml(p, coming) {
    return '<p class="pn-mut pn-small">' + esc(examShape(p)) + ". " + esc(marking(p)) + "." + esc(examPass(p)) + "</p>" +
      '<p class="pn-mut pn-small pn-t2src">' + esc(srcLine(p)) + (coming ? "" : (p.blueprint.kind === "official_counts" ? " Subject quotas from the official blueprint." : " No official subject split: questions are spread across the subjects in proportion to the bank.")) + "</p>";
  }
  function covKnown() { try { var v = P.cov[tab()]; return typeof v === "number" ? v : null; } catch (e) { return null; } }
  function engineBtn(p, type, b, label, pri) {
    var l = lastOf(p.id, type), cov = covKnown(), short = cov != null && cov < b.min_viable;
    return '<button type="button" class="pn-btn pn-t2btn' + (pri ? " pri" : "") + '" data-act="t2-pre" data-p="' + p.id + '" data-k="' + type + '" data-need="' + b.min_viable + '"' + (short ? ' disabled aria-disabled="true"' : "") + '><span class="pn-t2bl">' + H.ico("clock") + "<span>" + esc(label) + "</span></span>" +
      (l ? '<small class="pn-t2last">Last ' + esc(fmtMarks(l.raw)) + " of " + l.max + " · " + dm(l.ts) + "</small>" : "") +
      (short ? '<small class="pn-t2last">Not enough questions in the bank yet</small>' : "") + "</button>";
  }
  function grandEngineHtml(p) {
    var prov = p.status !== "official", b = A.blueprint(p, "grand");
    if (!b) return "";
    if (p.id === "usmle-step1") return engineBtn(p, "grand", b, "Full exam: " + b.count + " questions, " + mins(b.duration_sec), false);
    return engineBtn(p, "grand", b, (prov ? "Practice test: " : "Full exam: ") + b.count + " questions, " + mins(b.duration_sec), true);
  }
  function partEngineHtml(p) { var b = A.blueprint(p, "part"); if (!b) return ""; return engineBtn(p, "part", b, "One part: " + b.count + " questions, " + mins(b.duration_sec), false); }
  function miniEngineHtml(p) {
    var b = A.blueprint(p, "mini"); if (!b) return "";
    if (p.id === "usmle-step1") return engineBtn(p, "mini", b, "One block: " + b.count + " questions, " + mins(b.duration_sec), true);
    return engineBtn(p, "mini", b, "One section: " + b.count + " questions, " + mins(b.duration_sec), false);
  }
  function dailyBlockHtml(p, kind, count, head, scopeTxt, startTxt) {
    var b = A.blueprint(p, kind), key = A.dailyKey(p.id, Date.now(), kind), d = null;
    try { d = store().t2d[key]; } catch (e) { d = null; }
    var cov = covKnown(), short = cov != null && cov < count;
    return '<div class="pn-t2dline"><div class="pn-t2h"><p class="pn-t2eb">' + head + ": " + count + " questions, about " + mins(b.duration_sec) + "</p>" + (d ? '<span class="pn-t2b ok">' + H.ico("check") + " Done today</span>" : '<span class="pn-t2b">Not done today</span>') + "</div>" +
      '<p class="pn-mut pn-small">' + esc(p.name) + " pace (" + b.pace + " s a question) and marking. " + scopeTxt + (d ? " Today: " + d.correct + " of " + count + " right, " + fmtMarks(d.raw) + " of " + d.max + " marks. A retry is practice and is not counted again." : "") + "</p>" +
      '<button type="button" class="pn-btn' + (d ? "" : " pri") + '" data-act="t2-pre" data-p="' + p.id + '" data-k="' + kind + '" data-need="' + count + '"' + (short ? ' disabled aria-disabled="true"' : "") + ">" + H.ico("play") + (d ? " Practise again" : " " + startTxt) + "</button>" +
      (short ? '<p class="pn-mut pn-small">Not enough questions in the bank yet.</p>' : "") + "</div>";
  }
  function dailyEngineHtml(p) {
    return dailyBlockHtml(p, "daily10", 10, "Today's set", "Mixed subjects; the same 10 all day.", "Start Daily 10") +
      dailyBlockHtml(p, "daily_mixed", 25, "Today's mixed set", "Balanced across subjects; the same 25 all day.", "Start Daily mixed");
  }
  function pickerRowHtml(p, format) {
    if (format === "subject_mini") return H.row("t2-pick", H.ico("grid"), "Build a subject test", "20 questions from one subject, " + esc(p.name) + " marking", ' data-k="subject_mini" data-p="' + p.id + '"');
    if (format === "topic") return H.row("t2-pick", H.ico("search"), "Build a topic test", "Up to 20 questions from one topic", ' data-k="topic" data-p="' + p.id + '"');
    if (format === "image") return H.row("t2-pick", H.ico("grid"), "Build an image test by subject", "20 image questions from one subject", ' data-k="image" data-p="' + p.id + '"');
    if (format === "case") return H.row("t2-pick", H.ico("grid"), "Build a clinical case test by subject", "20 clinical case questions from one subject", ' data-k="case" data-p="' + p.id + '"');
    return "";
  }
  function imageEngineHtml(p) { var b = A.blueprint(p, "image"); if (!b) return ""; return engineBtn(p, "image", b, "Image test: " + b.count + " questions, " + mins(b.duration_sec), false); }
  function caseEngineHtml(p) { var b = A.blueprint(p, "case"); if (!b) return ""; return engineBtn(p, "case", b, "Clinical cases: " + b.count + " questions, " + mins(b.duration_sec), false); }
  // Weak-area and incorrect-question starters: real engine tests from the student's own history (prep.js weakModules
  // and the mistakes list), narrowed to the plan's subjects. With too little history the starter stays visible but
  // disabled and says why.
  function planSubjectIds() {
    try {
      if (H.planSubjects) { var keep = {}; H.planSubjects().forEach(function (x) { keep[x.id] = 1; }); return keep; }
    } catch (e) {}
    return null;
  }
  function mistakeIds() {
    var mt = {}, keep = planSubjectIds();
    try { mt = H.store().mt || {}; } catch (e) { mt = {}; }
    return Object.keys(mt).filter(function (id) { var b = mt[id]; return b && (!keep || keep[b[0]]); });
  }
  function weakEngineHtml(p) {
    var weak = [];
    try { weak = H.pure.weakModules(H.store(), 3); } catch (e) { weak = []; }
    var keep = planSubjectIds();
    if (keep) weak = weak.filter(function (m) { try { return keep[H.subjectOfModule(m)]; } catch (e2) { return false; } });
    var l = lastOf(p.id, "weak_area"), dis = weak.length ? "" : " disabled aria-disabled=\"true\"";
    var sub = weak.length ? "20 questions from your " + weak.length + (weak.length === 1 ? " weak module" : " weak modules") : "No weak modules yet: a module turns weak after 5 tries under 60% right";
    if (l) sub += " · Last " + fmtMarks(l.raw) + " of " + l.max + " · " + dm(l.ts);
    return H.row("t2-pre", H.ico("flag"), "Weak-area test", sub, ' data-k="weak_area" data-p="' + p.id + '" data-need="5"' + dis);
  }
  function incorrectEngineHtml(p) {
    var n = mistakeIds().length;
    var ok = n >= 5, l = lastOf(p.id, "incorrect"), dis = ok ? "" : " disabled aria-disabled=\"true\"";
    var sub = ok ? "Up to 20 of your " + H.fmt(n) + " mistakes, exam marking and timer" : H.fmt(n) + " of 5 mistakes needed for a scored test; questions you get wrong collect here";
    if (l) sub += " · Last " + fmtMarks(l.raw) + " of " + l.max + " · " + dm(l.ts);
    return H.row("t2-pre", H.ico("x"), "Incorrect-questions test", sub, ' data-k="incorrect" data-p="' + p.id + '" data-need="5"' + dis);
  }
  function diagCustomHtml(p) {
    var cov = covKnown(), dis = cov != null && cov < 5;
    var l = null;
    try { var h = store().t2h; for (var i = 0; i < h.length; i++) if (h[i].exam === p.id && h[i].type === "diagnostic" && !h[i].paper) l = h[i]; } catch (e) {}
    return H.row("t2-pre", H.ico("bolt"), "Adaptive diagnostic", "20 questions across subjects, from your own history" + (l ? " · Last " + fmtMarks(l.raw) + " of " + l.max + " · " + dm(l.ts) : "") + (dis ? " · Not enough questions yet" : ""), ' data-k="diagnostic" data-p="' + p.id + '" data-need="5"' + (dis ? ' disabled aria-disabled="true"' : "")) +
      H.row("t2-ccpick", H.ico("gear"), "Custom test", "Your subjects, count, difficulty and images, exam marking and timer", ' data-p="' + p.id + '"') +
      H.row("t2-custom", H.ico("plus"), "Custom module", "Your own mix of subjects and count, practise or timed");
  }
  function recallRowHtml(p) { if (p.id !== "neet-pg" || !G.PREP_PYQ) return ""; return G.PREP_PYQ.homeRow(H); }
  function prevLinkHtml(p) { if (!(p.legacy_mock && p.id === "neet-pg")) return ""; return '<button type="button" class="pn-link pn-t2prev" data-act="t2-legacy" data-v="' + p.legacy_mock.id + '">Previous format practice: ' + p.legacy_mock.n + " questions, one timer</button>"; }
  function fxRowHtml(r) {
    var l = lastOfPaper(r.id);
    var sub = r.count + " questions · " + mins(r.duration_sec) + " · " + r.scope + (l ? " · Done " + fmtMarks(l.raw) + " of " + l.max + " · " + dm(l.ts) : " · Not done");
    return H.row("t2-fixed", l ? H.ico("check") : H.ico("play"), esc(r.title), esc(sub), ' data-fx="' + esc(r.id) + '"');
  }
  function fmtMarks(x) { return String(Math.round(x * 100) / 100); }
  function groupCounts(p, format) {
    var s = null, t2h = [], t2d = {};
    try { s = store(); t2h = s.t2h || []; t2d = s.t2d || {}; } catch (e) {}
    var fx = fxFor(P.fx, p.id, format === "custom" ? "__none__" : format, P.plan);
    var fxDone = countFxDone(fx, t2h), eng = 0, engDone = 0;
    if (format === "daily10") { eng = 2; try { if (dailyDoneByKey(t2d, A.dailyKey(p.id, Date.now(), "daily10"))) engDone++; if (dailyDoneByKey(t2d, A.dailyKey(p.id, Date.now(), "daily_mixed"))) engDone++; } catch (e2) {} }
    else if (format === "grand" || format === "part" || format === "mini") { var b = null; try { b = A.blueprint(p, format); } catch (e3) {} if (b) { eng = 1; if (engineDone(t2h, p.id, format)) engDone = 1; } }
    else if (format === "image" || format === "case" || format === "weak_area" || format === "incorrect") { eng = 1; if (engineDone(t2h, p.id, format)) engDone = 1; }
    else if (format === "custom") { eng = 3; if (engineDone(t2h, p.id, "diagnostic")) engDone++; if (engineDone(t2h, p.id, "custom")) engDone++; }
    return { total: fx.length + eng, done: fxDone + engDone, fx: fx.length, fxDone: fxDone, eng: eng, engDone: engDone };
  }
  function examCounts(p) {
    var t = 0, d = 0;
    for (var i = 0; i < GRP_ORDER.length; i++) { var c = groupCounts(p, GRP_ORDER[i]); t += c.total; d += c.done; }
    return { total: t, done: d };
  }
  function metaTxt(c) { return c.total + ", " + c.done + " done"; }
  function fixedListHtml(p, format) {
    var key = grpKey(p.id, format), q = P.grpQ[key] || "", showAll = !!P.grpShow[key];
    if (P.fx == null) return '<p class="pn-load" role="status">Loading papers…</p>';
    var all = fxFor(P.fx, p.id, format, P.plan), found = filterFx(all, q), vis = q ? found : visibleFx(found, showAll);
    var out = "";
    if (q && all.length) out += '<p class="pn-mut pn-small" role="status">' + found.length + " of " + all.length + " match</p>";
    if (!all.length) {
      if (format === "part") return '<p class="pn-empty">One-part tests apply only to FMGE.</p>';
      if (format === "image") return "";
      if (format === "pyq") return (recallRowHtml(p) ? "" : '<p class="pn-empty">No PYQ papers for this exam yet.</p>');
      return "";
    }
    if (!found.length) return out + '<p class="pn-empty">No papers match.</p>';
    out += '<div class="pn-group">' + vis.map(fxRowHtml).join("") + "</div>";
    if (!q && all.length > GRP_FIRST) out += '<button type="button" class="pn-btn pn-t2more" data-act="t2-more" data-p="' + p.id + '" data-f="' + format + '">' + (showAll ? "Show less" : "Show all " + all.length) + "</button>";
    return out;
  }
  function engineHtml(p, format) {
    if (format === "daily10") return dailyEngineHtml(p);
    if (format === "grand") return grandEngineHtml(p) + prevLinkHtml(p);
    if (format === "part") return partEngineHtml(p);
    if (format === "mini") return miniEngineHtml(p);
    if (format === "subject_mini" || format === "topic") return '<div class="pn-group pn-t2p">' + pickerRowHtml(p, format) + "</div>";
    if (format === "image") return imageEngineHtml(p) + '<div class="pn-group pn-t2p">' + pickerRowHtml(p, format) + "</div>";
    if (format === "case") return caseEngineHtml(p) + '<div class="pn-group pn-t2p">' + pickerRowHtml(p, format) + "</div>";
    if (format === "weak_area") return '<div class="pn-group pn-t2p">' + weakEngineHtml(p) + "</div>";
    if (format === "incorrect") return '<div class="pn-group pn-t2p">' + incorrectEngineHtml(p) + "</div>";
    if (format === "pyq") { var r = recallRowHtml(p); return r ? '<div class="pn-group pn-t2p">' + r + "</div>" : ""; }
    if (format === "custom") return '<div class="pn-group pn-t2p">' + diagCustomHtml(p) + "</div>";
    return "";
  }
  function groupBodyInner(p, format) {
    var key = grpKey(p.id, format), eng = engineHtml(p, format), fx = "";
    if (format === "custom") return eng;
    var all = P.fx == null ? null : fxFor(P.fx, p.id, format, P.plan);
    var search = all != null && all.length > GRP_SEARCH_AT ? '<div class="pn-t2sbox">' + H.ico("search") + '<input type="search" class="pn-in pn-t2search" data-p="' + p.id + '" data-f="' + format + '" name="filter-papers" value="' + esc(P.grpQ[key] || "") + '" placeholder="Filter papers…" aria-label="Filter ' + esc(grpName(format)) + '" autocomplete="off" inputmode="search" spellcheck="false"></div>' : "";
    fx = '<div class="pn-t2fxwrap">' + fixedListHtml(p, format) + "</div>";
    if (!eng && all != null && !all.length && (format === "subject_mini" || format === "topic")) return eng + search + fx;
    return eng + search + fx;
  }
  function groupSection(p, format, primaryId, st) {
    var open = grpIsOpen(st, p.id, primaryId, format), c = groupCounts(p, format);
    var gid = "pnT2G-" + p.id + "-" + format;
    var body = open ? '<div class="pn-t2ginner">' + groupBodyInner(p, format) + "</div>" : '<div class="pn-t2ginner"></div>';
    return '<section class="pn-t2grp" data-p="' + p.id + '" data-f="' + format + '" aria-label="' + esc(grpName(format)) + '">' +
      '<h3 class="pn-t2gh"><button type="button" class="pn-t2ghead" data-act="t2-g" data-p="' + p.id + '" data-f="' + format + '" aria-expanded="' + open + '" aria-controls="' + gid + '">' +
      '<span class="pn-t2gt">' + esc(grpName(format)) + '</span><span class="pn-t2gm" data-m="' + p.id + "|" + format + '">' + esc(metaTxt(c)) + '</span><span class="pn-t2chev" aria-hidden="true">' + H.ico("chev") + "</span></button></h3>" +
      '<div class="pn-t2gbody" id="' + gid + '" data-open="' + (open ? "1" : "0") + '" data-p="' + p.id + '" data-f="' + format + '" data-lazy="' + (open ? "0" : "1") + '">' + body + "</div></section>";
  }
  // A format group with nothing in it (no starter, no builder, no paper, no PYQ row) is not shown at all.
  function groupVisible(p, format) {
    if (engineHtml(p, format)) return true;
    if (format === "subject_mini" || format === "topic") return true;
    if (format === "pyq" && recallRowHtml(p)) return true;
    if (P.fx == null) return true;
    return fxFor(P.fx, p.id, format === "custom" ? "__none__" : format, P.plan).length > 0;
  }
  function visibleFormats(p) { return GRP_ORDER.filter(function (f) { return groupVisible(p, f); }); }
  function jumpBar(p, formats) {
    return '<div class="pn-t2jump" role="navigation" aria-label="Jump to test type"><div class="pn-t2jrow">' + (formats || GRP_ORDER).map(function (f) {
      return '<button type="button" class="pn-chip pn-t2j" data-act="t2-jump" data-p="' + p.id + '" data-f="' + f + '" aria-label="Jump to ' + esc(grpName(f)) + '">' + esc(grpShort(f)) + "</button>";
    }).join("") + "</div></div>";
  }
  // The one short state for an exam whose bank is not ready: the same card shell as an exam section (one title
  // size, one badge style), one short line, and the format and provenance notes behind an info row.
  function comingSection(p) {
    var prov = p.status !== "official";
    return '<section class="pn-t2exam pn-t2coming" data-p="' + p.id + '" aria-label="' + esc(p.name) + ' format">' +
      '<div class="pn-t2xstatic"><span class="pn-t2xt"><b>' + esc(p.name) + '</b><span class="pn-t2b' + (prov ? " prov" : "") + '">' + (prov ? "Provisional" : "Official format") + "</span></span></div>" +
      '<div class="pn-t2xinfo"><p class="pn-mut">No questions for this exam in the bank yet.</p>' +
      '<details class="pn-t2how"><summary>Exam format</summary>' + examInfoHtml(p, true) +
      ((p.bank && p.bank.note) ? '<p class="pn-mut pn-small">' + esc(p.bank.note) + "</p>" : "") + "</details></div></section>";
  }
  // A plan group with no bank subjects yet (rare): the same shell, clearly worded for the group.
  function groupComingHtml(p, gl) {
    return '<section class="pn-t2exam pn-t2coming" aria-label="' + esc(p.name + (gl ? " " + gl : "")) + '">' +
      '<div class="pn-t2xstatic"><span class="pn-t2xt"><b>' + esc(p.name) + (gl ? " · " + esc(gl) : "") + '</b><span class="pn-t2b">No questions yet</span></span></div>' +
      '<div class="pn-t2xinfo"><p class="pn-mut">No questions for the ' + esc(gl || "group") + " in the bank yet.</p></div></section>";
  }
  // One small line under the segment: the plan's exam and scope, with the one way to change it.
  function planCtxHtml(p0) {
    var exam = p0.name, scope = "";
    try { exam = H.planExamLabel ? H.planExamLabel() : p0.name; } catch (e) { exam = p0.name; }
    try { scope = H.planScopeLabel ? H.planScopeLabel() : ""; } catch (e2) { scope = ""; }
    return '<p class="pn-mut pn-small pn-t2ctx">' + esc(exam) + (scope ? " · " + esc(scope) : "") + ' · <button type="button" class="pn-link" data-act="p-settings">Change exam</button></p>';
  }
  function needSubjectHtml() {
    return '<section class="pn-panel"><p class="pn-big pn-mid">Pick your INI-SS subject</p><p class="pn-mut">INI-SS is set per superspeciality: Tests and QBank follow the one subject you pick.</p>' +
      '<button type="button" class="pn-btn pri" data-act="p-settings">' + H.ico("plus") + " Choose subject</button></section>";
  }
  function examSection(p, primaryId, st) {
    if (A.bankStatus(p) === "coming") return comingSection(p);
    var open = examIsOpen(st, p.id, primaryId), c = examCounts(p), prov = p.status !== "official";
    var xid = "pnT2X-" + p.id, vis = visibleFormats(p);
    var inner = '<div class="pn-t2xinfo">' + examInfoHtml(p) + "</div>" + jumpBar(p, vis) + vis.map(function (f) { return groupSection(p, f, primaryId, st); }).join("");
    return '<section class="pn-t2exam" data-p="' + p.id + '" aria-label="' + esc(p.name) + ' tests">' +
      '<h2 class="pn-t2xh"><button type="button" class="pn-t2xhead" data-act="t2-x" data-p="' + p.id + '" aria-expanded="' + open + '" aria-controls="' + xid + '">' +
      '<span class="pn-t2xt"><b>' + esc(p.name) + '</b><span class="pn-t2b' + (prov ? " prov" : "") + '">' + (prov ? "Provisional" : "Official format") + "</span></span>" +
      '<span class="pn-t2xm" data-xm="' + p.id + '">' + esc(metaTxt(c)) + '</span><span class="pn-t2chev" aria-hidden="true">' + H.ico("chev") + "</span></button></h2>" +
      '<div class="pn-t2xbody" id="' + xid + '" data-open="' + (open ? "1" : "0") + '" data-p="' + p.id + '"><div class="pn-t2xinner">' + inner + "</div></div></section>";
  }
  function globalPracticeHtml() {
    var s = H.store(), pt = null, mt = 0, wk = 0;
    try { pt = H.planToday(); mt = Object.keys(s.mt || {}).length; wk = pt.weak.length; } catch (e) { pt = { due: 0, left: 0, weak: [] }; }
    var rows = (pt.due || pt.left ? H.row("t2-plan", H.ico("play"), "Today's set", (pt.due ? H.fmt(pt.due) + " reviews due, then new" : "Up to 20 new questions") + ", marked as you go") : "") +
      (wk || mt ? H.row("t2-weak", H.ico("flag"), "Weak areas", (wk ? wk + (wk === 1 ? " weak module" : " weak modules") : "") + (wk && mt ? " and " : "") + (mt ? H.fmt(mt) + " mistakes" : "")) : "") +
      (mt ? H.row("t2-mistakes", H.ico("x"), "My mistakes", H.fmt(mt) + " to fix") : "") +
      (statsChoice() != null ? H.row("t2-statsw", H.ico("flag"), "Anonymous statistics", statsChoice() === "1" ? "On: tap to stop sharing" : "Off: tap to share anonymously") : "");
    if (!rows) return "";
    return '<h2 class="pn-h">Your practice</h2><div class="pn-group pn-t2p">' + rows + "</div>";
  }
  /* ---------- ready-made tests (fixed papers, same for every student) ---------- */
  function fxLoad() {
    if (P.fxP) return P.fxP;
    P.fxP = H.getJSON(H.bankApi + FX_VER + "/tests/index.json").then(function (ix) {
      P.fx = ix && Array.isArray(ix.papers) ? ix.papers : [];
      return P.fx;
    }, function () { P.fx = []; return P.fx; });
    return P.fxP;
  }
  function grpBodyEl(pid, format) { try { var r = H.root(); return r ? r.querySelector('.pn-t2gbody[data-p="' + pid + '"][data-f="' + format + '"]') : null; } catch (e) { return null; } }
  function grpHeadEl(pid, format) { try { var r = H.root(); return r ? r.querySelector('.pn-t2ghead[data-p="' + pid + '"][data-f="' + format + '"]') : null; } catch (e) { return null; } }
  function examBodyEl(pid) { try { var r = H.root(); return r ? r.querySelector('.pn-t2xbody[data-p="' + pid + '"]') : null; } catch (e) { return null; } }
  function examHeadEl(pid) { try { var r = H.root(); return r ? r.querySelector('.pn-t2xhead[data-p="' + pid + '"]') : null; } catch (e) { return null; } }
  function ensureGrpBuilt(p, format) {
    var body = grpBodyEl(p.id, format);
    if (!body || body.getAttribute("data-lazy") !== "1") return body;
    body.setAttribute("data-lazy", "0");
    var inner = body.querySelector(".pn-t2ginner");
    if (inner) inner.innerHTML = groupBodyInner(p, format);
    else body.innerHTML = '<div class="pn-t2ginner">' + groupBodyInner(p, format) + "</div>";
    applyCov(body);
    return body;
  }
  function setGrpDom(p, format, open) {
    var head = grpHeadEl(p.id, format), body = grpBodyEl(p.id, format);
    if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
    if (!body) return;
    if (open) ensureGrpBuilt(p, format);
    body.setAttribute("data-open", open ? "1" : "0");
  }
  function setExamDom(p, open, primaryId, st) {
    var head = examHeadEl(p.id), body = examBodyEl(p.id);
    if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
    if (!body) return;
    body.setAttribute("data-open", open ? "1" : "0");
    if (open) {
      for (var i = 0; i < GRP_ORDER.length; i++) {
        var f = GRP_ORDER[i], gb = grpBodyEl(p.id, f);
        if (gb && gb.getAttribute("data-open") === "1") ensureGrpBuilt(p, f);
      }
    }
  }
  function applyCov(scope) {
    var total = covKnown(); if (total == null || !scope || !scope.querySelectorAll) return;
    var btns = scope.querySelectorAll("[data-act=t2-pre][data-need]");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.disabled) continue;
      if (total < Number(b.getAttribute("data-need"))) {
        b.disabled = true; b.setAttribute("aria-disabled", "true");
        if (b.className.indexOf("pn-t2btn") >= 0 && D) { var sm = D.createElement("small"); sm.className = "pn-t2last"; sm.textContent = "Not enough questions in the bank yet"; b.appendChild(sm); }
      }
    }
  }
  function reducedMotion() { try { return G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function refreshGrpDom() {
    var root = null;
    try { root = H.root(); } catch (e) { root = null; }
    if (!root) return;
    var list = [];
    try { list = A.forTab(tab()); } catch (e2) { list = []; }
    list.forEach(function (p) {
      var xm = null;
      try { xm = root.querySelector('[data-xm="' + p.id + '"]'); } catch (e3) {}
      if (xm) xm.textContent = metaTxt(examCounts(p));
      GRP_ORDER.forEach(function (f) {
        var m = null;
        try { m = root.querySelector('[data-m="' + p.id + "|" + f + '"]'); } catch (e4) {}
        if (m) m.textContent = metaTxt(groupCounts(p, f));
        // The papers arrived after the first paint: groups that stayed empty leave the view with their jump chip.
        if (P.fx != null && !groupVisible(p, f)) {
          var sec = null, chip = null;
          try { sec = root.querySelector('section.pn-t2grp[data-p="' + p.id + '"][data-f="' + f + '"]'); } catch (e5) {}
          try { chip = root.querySelector('[data-act="t2-jump"][data-p="' + p.id + '"][data-f="' + f + '"]'); } catch (e6) {}
          if (sec) sec.style.display = "none";
          if (chip) chip.style.display = "none";
        }
        var body = grpBodyEl(p.id, f);
        if (body && body.getAttribute("data-open") === "1" && body.getAttribute("data-lazy") !== "1") {
          var inner = body.querySelector(".pn-t2ginner");
          var html = groupBodyInner(p, f);
          if (inner) inner.innerHTML = html; else body.innerHTML = '<div class="pn-t2ginner">' + html + "</div>";
          applyCov(body);
          var q = P.grpQ[grpKey(p.id, f)];
          if (q) { var inp = body.querySelector(".pn-t2search"); if (inp) { inp.value = q; try { inp.setSelectionRange(q.length, q.length); } catch (e5) {} } }
        }
      });
    });
  }
  function fxMount() { fxLoad().then(function () { refreshGrpDom(); }); }
  function onGrpInput(ev) {
    var t = ev && ev.target;
    if (!t || !t.className || String(t.className).indexOf("pn-t2search") < 0) return;
    var pid = t.getAttribute("data-p"), f = t.getAttribute("data-f");
    if (!pid || !f) return;
    P.grpQ[grpKey(pid, f)] = t.value || "";
    var p = null;
    try { p = A.profile(pid); } catch (e) { p = null; }
    if (!p) return;
    var body = grpBodyEl(pid, f);
    if (!body) return;
    var wrap = body.querySelector(".pn-t2fxwrap");
    if (wrap) wrap.innerHTML = fixedListHtml(p, f);
  }
  // Resolve a paper's [subject, module, id] triples to items in paper order, from the bank versions the paper
  // names (so papers keep working when the live bank moves on). A question no longer there, or hidden by the
  // student, becomes a placeholder left out of the marks (like an interrupted test's withdrawn questions).
  function fxFile(sid, mid, ver) {
    var u = H.bankApi + ver + "/" + sid + "/mcq/" + mid + ".json";
    if (!P.fxm[u]) P.fxm[u] = H.getJSON(u).then(function (j) { return j.items || []; }, function () { return []; });
    return P.fxm[u];
  }
  function fxPyq(ver) {
    var u = H.bankApi + ver + "/index.json";
    if (!P.fxm[u]) P.fxm[u] = H.getJSON(u).then(function (ix) { return H.getJSON(H.bankApi + ver + "/" + ix.file).then(function (j) { return j.items || []; }, function () { return []; }); }, function () { return []; });
    return P.fxm[u];
  }
  // One module's overlay items for the paper's sets, in the paper's set order, deduplicated by id.
  function fxOverlays(sid, mid, sets) {
    return Promise.all((sets || []).map(function (set) {
      var u = H.bankApi + "overlay/" + set + "/" + sid + "/" + mid + ".json";
      if (!P.fxm[u]) P.fxm[u] = H.getJSON(u).then(function (j) { return j.items || []; }, function () { return []; });
      return P.fxm[u];
    })).then(function (rs) {
      var out = [], seen = {};
      rs.forEach(function (items) { (items || []).forEach(function (it) { if (it && it.id != null && !seen[it.id]) { seen[it.id] = 1; out.push(it); } }); });
      return out;
    });
  }
  function fxResolve(paper) {
    var verOf = {}, ver;
    for (ver in paper.bank || {}) (paper.bank[ver] || []).forEach(function (sid) { verOf[sid] = ver; });
    var files = {}, seen = {};
    (paper.items || []).forEach(function (t) {
      var k = t[0] + "|" + t[1];
      if (!seen[k]) { seen[k] = 1; files[k] = t[0] === "pyq" ? fxPyq(verOf.pyq || "v5/pyq") : fxFile(t[0], t[1], verOf[t[0]] || "v5"); }
    });
    return Promise.all(Object.keys(files).map(function (k) { return files[k].then(function (items) { return [k, items]; }); })).then(function (got) {
      var by = {};
      got.forEach(function (g) { var m = {}; g[1].forEach(function (it) { m[String(it.id)] = it; }); by[g[0]] = m; });
      // Papers with overlay items (paper.overlays { subject: [sets] }): modules with ids the bank file
      // lacks fetch their overlay files, merged bank-first like the app's mergeOverlay. Papers without
      // overlays never pay for this: no missing ids, no extra fetch.
      var miss = {};
      (paper.items || []).forEach(function (t) { if (t[0] !== "pyq" && !(by[t[0] + "|" + t[1]] || {})[t[2]]) miss[t[0] + "|" + t[1]] = 1; });
      var keys = Object.keys(miss).filter(function (k) { return paper.overlays && paper.overlays[k.split("|")[0]]; });
      if (!keys.length) return by;
      return Promise.all(keys.map(function (k) {
        var p = k.split("|");
        return fxOverlays(p[0], p[1], paper.overlays[p[0]]).then(function (items) { return [k, items]; });
      })).then(function (ovs) {
        ovs.forEach(function (o) { o[1].forEach(function (it) { if (!by[o[0]][String(it.id)]) by[o[0]][String(it.id)] = it; }); });
        return by;
      });
    }).then(function (by) {
      // A paper built before an item was flagged still resolves it: re-check every item against the live
      // sidecar, so requires_review/rejected/retired items become placeholders left out of the marks.
      var subs = {}, hid = H.hidden();
      (paper.items || []).forEach(function (t) { subs[t[0]] = 1; });
      return loadQuality(Object.keys(subs)).then(function (qual) {
        var items = [], missing = 0;
        (paper.items || []).forEach(function (t) {
          var it = (by[t[0] + "|" + t[1]] || {})[t[2]];
          if (!it || hid[t[2]] || A.eligible(it, { hidden: hid, quality: qual }, paper.test_type)) { missing++; items.push({ id: t[2], q: "This question is no longer available.", o: ["-", "-", "-", "-"], a: -9, _s: t[0], _m: t[1], _gone: true }); return; }
          it._s = t[0]; it._m = t[1]; items.push(it);
        });
        return { items: items, missing: missing };
      });
    });
  }
  function prepareFixed(id) {
    var row = null;
    (P.fx || []).forEach(function (r) { if (r.id === id) row = r; });
    if (!row) return;
    var p = A.profile(row.exam);
    if (!p) { H.toast("This paper's exam is not on this tab."); return; }
    H.stack().push(function () {}); H.loadingScreen(esc(row.title), "Loading your test…");
    H.getJSON(H.bankApi + FX_VER + "/tests/" + row.path).then(function (paper) {
      return fxResolve(paper).then(function (u) { return [paper, u]; });
    }).then(function (pu) {
      var paper = pu[0], u = pu[1];
      H.stack().pop();
      if (!u.items.length || u.missing === u.items.length) { H.toast("The questions of this test did not load. Check the connection and try again."); return H.rerender(); }
      var secs = (paper.sections || []).map(function (s) { return { id: s.id, label: s.label, n: s.n, sec: s.sec, from: s.from, to: s.to }; });
      P.pick = { p: p, type: paper.test_type, title: paper.title, fixed: paper, fixedMissing: u.missing,
        asm: { ok: true, count: u.items.length, requested: paper.reduced_from || paper.count, reduced: !!paper.reduced_from,
          duration_sec: paper.duration_sec, sections: secs.length ? secs : null, deviations: paper.deviations || [],
          planned: paper.planned || {}, actual: paper.actual || {}, seed: paper.seed, items: u.items,
          blueprint: paper.blueprint || { id: p.id + ":" + paper.test_type, version: "1" } } };
      H.push(preScreen);
    }, function () { H.stack().pop(); H.toast("This paper did not load. Check the connection and try again."); H.rerender(); });
  }
  // The Tests segment shows ONLY the selected plan's exam: its ready-made papers and engine tests, grouped by
  // format. Other exams stay reachable only through the Change exam link (the plan setup), never as cards here.
  function testsHtml(h) {
    H = h;
    var p0 = primary();
    if (!p0) return '<p class="pn-empty">No exam profile for this exam yet.</p>';
    var st = loadGrp(), need = null;
    try { need = H.planNeed ? H.planNeed() : null; } catch (e) { need = null; }
    P.grpQ = {}; P.plan = planScope(p0);
    var resume = '<div id="pnT2Res">' + (P.sess && P.sess.t2 && !P.sess.done ? resumeHtml(P.sess) : "") + "</div>";
    var coach = H.coachSec ? H.coachSec("tests") : "";
    var pract = globalPracticeHtml();
    var note = '<p class="pn-mut pn-small" id="pnT2Note">Every test shows its size, time and scope before it starts. When the bank cannot fill a blueprint the test is shortened and says why; it is never padded with unrelated questions. Results use the exam\'s marking only: no rank, percentile or predicted score.</p>';
    if (need) return resume + coach + planCtxHtml(p0) + needSubjectHtml() + pract + note;
    if (A.bankStatus(p0) === "coming") return resume + coach + planCtxHtml(p0) + comingSection(p0) + pract + note;
    if (P.plan && !P.plan.subs.length) {
      var gl = "";
      try { gl = H.planScopeLabel ? H.planScopeLabel() : ""; } catch (e2) { gl = ""; }
      return resume + coach + planCtxHtml(p0) + groupComingHtml(p0, gl) + pract + note;
    }
    return resume + coach + planCtxHtml(p0) + examSection(p0, p0.id, st) + pract + note;
  }
  // After paint: the saved session, the fixed papers, then coverage (subject indexes) hides tests the bank cannot fill.
  function mounted(h) {
    H = h;
    fxMount();
    try {
      var root0 = H.root();
      if (root0 && !P.grpLis) { P.grpLis = true; if (root0.addEventListener) root0.addEventListener("input", onGrpInput); }
    } catch (e) {}
    loadSess().then(function (pk) {
      var box = H.root() && H.root().querySelector("#pnT2Res");
      if (box) box.innerHTML = pk && pk.t2 ? resumeHtml(pk) : "";
    });
    var subs = planSubs();
    Promise.all(subs.map(function (sb) { return H.loadIndex(sb.id); })).then(function () {
      var root = H.root(); if (!root) return;
      var ex = tab(), total = 0, ix = H.ix();
      subs.forEach(function (sb) { var x = ix[sb.id]; if (x) x.topics.forEach(function (t) { if (t.group !== "mixed") total += H.pure.countFor(t, ex); }); });
      P.cov[ex] = total;
      applyCov(root);
    });
  }

  /* ---------- pickers ---------- */
  function pickSubject(p, type) {
    H.push(function () {
      var subs = planSubs(), ix = H.ix(), ex = tab();
      var rows = subs.map(function (sb) {
        var n = 0, x = ix[sb.id]; if (x) x.topics.forEach(function (t) { if (t.group !== "mixed") n += H.pure.countFor(t, ex); });
        if (x && !n) return "";
        return H.row(type === "topic" ? "t2-pickm" : "t2-pre", '<span class="pn-ic sm" style="--h:' + H.subjHue(sb.id) + '">' + H.subjIco(sb.id) + "</span>", H.tx(sb.name), x ? H.fmt(n) + " questions" : "", ' data-p="' + p.id + '" data-k="' + type + '" data-s="' + esc(sb.id) + '" data-need="5"');
      }).join("");
      var what = type === "image" ? "20 image questions" : type === "case" ? "20 clinical case questions" : "20 questions";
      H.paint(H.bar(typeName(type), esc(p.name), "back") + '<div class="pn-body"><p class="pn-mut">' + (type === "topic" ? "Pick a subject, then a topic." : "Pick a subject. " + what + ", " + esc(marking(p)) + ", " + A.paceSec(p) + " s a question.") + '</p><div class="pn-group">' + rows + "</div></div>");
    });
  }
  function pickModule(p, sid) {
    H.loadIndex(sid).then(function (x) {
      H.push(function () {
        var ex = tab(), sb = H.subjectById(sid);
        var rows = (x.topics || []).filter(function (t) { return t.group !== "mixed" && H.pure.countFor(t, ex) >= 5; }).map(function (t) {
          return H.row("t2-pre", H.ico("search"), H.tx(t.title), H.fmt(H.pure.countFor(t, ex)) + " questions", ' data-p="' + p.id + '" data-k="topic" data-s="' + esc(sid) + '" data-m="' + esc(t.id) + '" data-need="5"');
        }).join("");
        H.paint(H.bar("Topic test", sb ? H.tx(sb.name) : "", "back") + '<div class="pn-body"><div class="pn-group">' + (rows || '<p class="pn-empty">No topic here has enough questions yet.</p>') + "</div></div>");
      });
    });
  }

  /* ---------- engine custom picker (subjects, count, difficulty, images) ----------
     The study Custom module (prep.js renderCustom, act t2-custom) is untouched; this builds an engine custom test
     with the exam's marking, timer and results screen. Chips mirror the study picker's look and keyboard behaviour. */
  function pickCustomEngine(p) {
    P.ccfg = { pid: p.id, subs: {}, n: 20, d: 0, img: 0 };
    H.push(ccScreen);
  }
  function ccScreen() {
    var c = P.ccfg, p = A.profile(c.pid), subs = planSubs();
    var chip = function (act, v, on, label) { return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="' + act + '" data-v="' + v + '">' + label + "</button>"; };
    var nsub = Object.keys(c.subs).length;
    var sum = nsub ? c.n + " questions from " + nsub + (nsub === 1 ? " subject" : " subjects") + (c.d ? ", " + ["", "easy", "medium", "hard", "very hard"][c.d] : "") + (c.img ? ", images only" : "") + ", " + p.name + " marking" : "Pick at least one subject";
    H.paint(H.bar("Custom test", esc(p.name), "back") + '<div class="pn-body pn-cm">' +
      '<section class="pn-panel"><h2 class="pn-sec">Subjects</h2><div class="pn-wrap">' +
      subs.map(function (sb) { return chip("t2-ccsub", esc(sb.id), !!c.subs[sb.id], H.tx(sb.name)); }).join("") + "</div></section>" +
      '<section class="pn-panel"><h2 class="pn-sec">Questions</h2><div class="pn-wrap pn-seg4">' + [10, 20, 30, 50].map(function (x) { return chip("t2-ccn", x, c.n === x, String(x)); }).join("") + "</div>" +
      '<h2 class="pn-sec">Difficulty</h2><div class="pn-wrap pn-seg4">' + [[0, "Any"], [1, "Easy"], [2, "Medium"], [3, "Hard"], [4, "Very hard"]].map(function (x) { return chip("t2-ccd", x[0], c.d === x[0], x[1]); }).join("") + "</div>" +
      '<h2 class="pn-sec">Images</h2><div class="pn-wrap pn-seg4">' + chip("t2-cci", "any", !c.img, "Any") + chip("t2-cci", "img", !!c.img, "Images only") + "</div></section>" +
      '<p class="pn-cm-sum" aria-live="polite">' + esc(sum) + "</p>" +
      '<button type="button" class="pn-btn pri" data-act="t2-ccgo" data-p="' + p.id + '"' + (nsub ? "" : " disabled") + ">" + H.ico("play") + " Start</button></div>");
  }
  function ccGo() {
    var c = P.ccfg, sids = Object.keys(c.subs);
    if (!sids.length) return;
    var names = sids.map(function (s) { var sb = H.subjectById(s); return sb && sb.name ? (sb.name.en || sb.name) : s; });
    var scopeTxt = names.length <= 2 ? names.join(", ") : names.slice(0, 2).join(", ") + " +" + (names.length - 2) + " more";
    return prepare(c.pid, "custom", null, null, { subjects: sids, count: c.n, difficulty: c.d || undefined, image: c.img ? true : undefined, scopeTxt: scopeTxt });
  }

  /* ---------- assembly and the pre-test screen ---------- */
  function seenMap() { var s = H.store(), out = {}; Object.keys(s.cards || {}).forEach(function (k) { var p = k.split(":"); if (p.length === 3) out[p[2]] = 1; }); return out; }
  function histBySubject() {
    var s = H.store(), out = {};
    Object.keys(s.mod || {}).forEach(function (m) { var sid = H.subjectOfModule(m); if (!sid) return; var o = out[sid] || (out[sid] = { t: 0, ok: 0 }); o.t += s.mod[m].t || 0; o.ok += s.mod[m].ok || 0; });
    return out;
  }
  // Item-quality sidecar (reader only): the host loads and caches quality/index.json + the per-subject files;
  // none = {} (every visible item stays eligible, as before the sidecar existed).
  function loadQuality(subs) {
    if (G.SMD_PREP_QUALITY) return Promise.resolve(A.readQuality(G.SMD_PREP_QUALITY));
    if (H.loadQuality) return H.loadQuality(subs);
    if (!P.qualP) P.qualP = H.getJSON(H.bankApi + "quality/index.json").then(function (ix) { return ix && ix.subjects ? ix : null; }, function () { return null; });
    return P.qualP.then(function (ix) {
      if (!ix) return {};
      return Promise.all(subs.filter(function (s) { return ix.subjects[s]; }).map(function (s) { return H.getJSON(H.bankApi + "quality/" + ix.subjects[s]).then(A.readQuality, function () { return {}; }); }))
        .then(function (maps) { var out = {}; maps.forEach(function (m) { for (var k in m) out[k] = m[k]; }); return out; });
    });
  }
  // Which module files to load for a test: per subject, enough modules for its share (bank counts), seeded.
  function modulePairs(p, type, opts, R) {
    var ex = tab(), ix = H.ix(), subs = opts.subjects || planSubs().map(function (s) { return s.id; });
    if (opts.module) return [{ s: opts.subjects[0], m: opts.module }];
    if (opts.pairs && opts.pairs.length) return opts.pairs.slice();
    if (opts.modules && opts.modules.length) return opts.modules.map(function (m) { var sid = null; try { sid = H.subjectOfModule(m); } catch (e) { sid = null; } return { s: sid || (opts.subjects && opts.subjects[0]) || subs[0], m: m }; });
    var per = {}, mods = {};
    subs.forEach(function (sid) { var x = ix[sid]; mods[sid] = (x ? x.topics.filter(function (t) { return t.group !== "mixed" && H.pure.countFor(t, ex) > 0; }) : []); });
    var b = A.blueprint(p, type, {}), want = b ? b.count : 20, files;
    if (type === "daily10" || type === "daily_mixed" || type === "diagnostic") {
      var order = subs.filter(function (s) { return mods[s].length; });
      order = shuffleR(order, R);
      if (type === "diagnostic") { var hs = histBySubject(); order.sort(function (a, c) { var x = hs[a] || { t: 0 }, y = hs[c] || { t: 0 }; return (x.t >= 5 ? 1 : 0) - (y.t >= 5 ? 1 : 0) || (x.t >= 5 ? x.ok / x.t - y.ok / y.t : x.t - y.t); }); }
      var take = type === "daily_mixed" ? order.length : 10;
      return order.slice(0, take).map(function (s) { var l = mods[s]; return { s: s, m: l[Math.floor(R() * l.length)].id }; });
    }
    files = Math.max(4, Math.min(36, Math.ceil(want / 6)));
    var tot = 0; subs.forEach(function (s) { per[s] = 0; mods[s].forEach(function (t) { per[s] += H.pure.countFor(t, ex); }); tot += per[s]; });
    var wt = {}; if (p.blueprint.kind === "official_counts" && !opts.subjects) subs.forEach(function (s) { wt[s] = p.blueprint.subjects[s] || 0; }); else wt = per;
    var k = A.apportion(files, wt), out = [];
    subs.forEach(function (s) { var n = Math.max(wt[s] > 0 && mods[s].length ? 1 : 0, Math.min(k[s] || 0, mods[s].length)); shuffleR(mods[s].slice(), R).slice(0, n).forEach(function (t) { out.push({ s: s, m: t.id }); }); });
    return out;
  }
  function shuffleR(a, R) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(R() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function prepare(pid, type, sid, mid, extra) {
    var p = A.profile(pid); if (!p) return;
    if (A.bankStatus(p) === "coming") { H.toast("No " + p.name + " questions in the bank yet."); return; }
    var dailyKind = type === "daily10" ? "daily10" : type === "daily_mixed" ? "daily_mixed" : null;
    var seed = dailyKind ? A.dailyKey(p.id, Date.now(), dailyKind) : String(Date.now()) + Math.random(), R = A.rng(seed + ":files");
    var opts = { seed: seed, hidden: H.hidden(), recent: dailyKind ? null : seenMap(), diverse: true };   // daily: the same set all day, seen or not; diverse: concepts spread inside each blueprint quota
    if (sid) opts.subjects = [sid];
    if (mid) { opts.modules = [mid]; opts.module = mid; }
    if (type === "diagnostic") opts.history = histBySubject();
    if (type === "image") opts.image = true;
    if (type === "case") opts.caseOnly = true;
    if (extra) {
      if (extra.subjects) opts.subjects = extra.subjects;
      if (extra.count) opts.count = extra.count;
      if (extra.difficulty) opts.difficulty = extra.difficulty;
      if (extra.image) opts.image = true;
      if (extra.modules) opts.modules = extra.modules;
      if (extra.pairs) opts.pairs = extra.pairs;
      if (extra.only) opts.only = extra.only;
    }
    var scopeTxt = extra && extra.scopeTxt, earlyRefuse = null;
    if (type === "weak_area") scopeTxt = scopeTxt || historyScope(opts, "weak");
    if (type === "weak_area" && !opts.modules) earlyRefuse = "No weak modules yet. A module turns weak after 5 tries with under 60% right; mistakes and practise feed it.";
    if (type === "incorrect") scopeTxt = scopeTxt || historyScope(opts, "incorrect");
    if (type === "incorrect" && !opts.only) earlyRefuse = incorrectShortfall();
    var title = typeName(type) + (type === "grand" || type === "part" || type === "mini" ? ": " + p.name : sid ? ": " + H.tx((H.subjectById(sid) || {}).name) : "");
    if (earlyRefuse) { P.pick = { p: p, type: type, asm: { ok: false, refused: earlyRefuse, deviations: [], items: [] }, title: title, sid: sid, mid: mid, scopeTxt: scopeTxt }; H.push(preScreen); return; }
    H.stack().push(function () {}); H.loadingScreen(esc(title), "Choosing questions…");
    var subs = planSubs().map(function (s) { return s.id; });
    Promise.all(subs.map(function (s) { return H.loadIndex(s); })).then(function () {
      var pairs = modulePairs(p, type, opts, R);
      return Promise.all([H.loadMany(pairs, H.stepMsg), loadQuality(opts.subjects || subs)]);
    }).then(function (res) {
      var lists = res[0].map(function (l) { var base = (poolOf(p) || tab() !== "usmle") ? l.items : H.pure.poolFor(l.items, "usmle", opts.hidden); return { s: l.s, m: l.m, items: poolItems(base, p, opts.hidden) }; });
      opts.quality = res[1];
      opts.subjectName = function (s) { var sb = H.subjectById(s); return sb ? (sb.name.en || s) : s; };
      var asm = A.assemble(p, type, opts, lists);
      // deviations name subjects by their names
      asm.deviations = asm.deviations.map(function (d) { return d.replace(/^([a-z][a-z-]+):/, function (m0, id) { var sb = H.subjectById(id); return sb ? (sb.name.en || id) + ":" : m0; }); });
      if (type === "incorrect" && opts.only) missingMistakesNote(lists, opts.only, asm);
      if (!asm.ok && !asm.count && (type === "image" || type === "case")) asm.refused = (asm.refused || "This test cannot be built now.") + (type === "image" ? " No image questions in the modules checked." : " No clinical cases in the modules checked.");
      H.stack().pop();
      if (res[0].every(function (l) { return !l.items.length; })) asm = { ok: false, refused: "Questions need a connection. Check the connection and try again.", deviations: [], items: [] };
      P.pick = { p: p, type: type, asm: asm, title: title, sid: sid, mid: mid, scopeTxt: scopeTxt };
      H.push(preScreen);
    });
  }
  // Weak-area scope from the student's own history: the weakest modules (prep.js weakModules, at most 3) that sit in
  // this exam's subjects. Incorrect scope: the mistake ids (at most 50, like practise) with their exact module files.
  function historyScope(opts, which) {
    var st = null;
    try { st = H.store(); } catch (e) { st = null; }
    if (!st) return null;
    if (which === "weak") {
      var weak = [];
      try { weak = H.pure.weakModules(st, 3); } catch (e2) { weak = []; }
      var keep = planSubjectIds();
      var known = weak.filter(function (m) { try { var sid = H.subjectOfModule(m); return !!sid && (!keep || keep[sid]); } catch (e3) { return false; } });
      if (!known.length) return null;
      opts.modules = known;
      var ss = {}, subs = [];
      known.forEach(function (m) { var s = null; try { s = H.subjectOfModule(m); } catch (e4) {} if (s && !ss[s]) { ss[s] = 1; subs.push(s); } });
      opts.subjects = subs;
      return "Your weak modules";
    }
    var mt = st.mt || {}, ids = mistakeIds();
    if (ids.length < 5) return null;
    ids = ids.slice(0, 50);
    var seen = {}, pairs = [];
    ids.forEach(function (id) { var b = mt[id]; if (!b || !b[0] || !b[1] || seen[b[1]]) return; seen[b[1]] = 1; pairs.push({ s: b[0], m: b[1] }); });
    var keep = pairs.slice(0, 12), keepM = {}, ps = {}, psubs = [];
    keep.forEach(function (x) { keepM[x.m] = 1; if (!ps[x.s]) { ps[x.s] = 1; psubs.push(x.s); } });
    ids = ids.filter(function (id) { var b = mt[id]; return b && keepM[b[1]]; });
    var only = {};
    ids.forEach(function (id) { only[id] = 1; });
    opts.only = only;
    opts.count = Math.min(20, ids.length);
    opts.pairs = keep;
    opts.subjects = psubs;
    return "Questions you got wrong";
  }
  function incorrectShortfall() {
    var n = mistakeIds().length;
    return "Only " + n + (n === 1 ? " mistake" : " mistakes") + " so far: a scored test needs at least 5. Questions you get wrong collect here.";
  }
  function missingMistakesNote(lists, only, asm) {
    var want = Object.keys(only).length, found = 0;
    lists.forEach(function (l) { (l.items || []).forEach(function (it) { if (only[it.id]) found++; }); });
    if (found < want) asm.deviations.push((want - found) + " of " + want + " mistakes " + ((want - found) === 1 ? "is" : "are") + " no longer in " + ((want - found) === 1 ? "its" : "their") + " module and " + ((want - found) === 1 ? "was" : "were") + " left out.");
  }
  function preScreen() {
    var x = P.pick, p = x.p, a = x.asm;
    var facts = [];
    if (a.ok) {
      facts.push(["Questions", a.count + (a.reduced ? " of " + a.requested + " planned" : "")]);
      facts.push(["Time", mins(a.duration_sec) + (a.sections && a.sections.length > 1 ? " in " + a.sections.length + " locked sections" : "")]);
      facts.push(["Marking", marking(p)]);
      facts.push(["Scope", x.scopeTxt ? x.scopeTxt : x.fixed ? x.fixed.scope : x.mid ? H.tx((H.topicOf(x.sid, x.mid) || { title: x.mid }).title) : x.sid ? H.tx((H.subjectById(x.sid) || {}).name) : "All " + H.exam().label + " subjects"]);
      if (x.fixed) facts.push(["Paper", "The same for every student"]);
      if (x.fixedMissing) facts.push(["Unavailable", x.fixedMissing + " of " + a.count + " left out of the marks (withdrawn, hidden or under review)"]);
    }
    var secs = a.sections && a.sections.length > 1 ? '<ol class="pn-t2secs">' + a.sections.map(function (s) { return "<li><b>" + esc(s.label) + "</b><span>" + s.n + " questions · " + mmss(s.sec) + "</span></li>"; }).join("") + "</ol>" +
      '<p class="pn-mut pn-small">' + H.ico("lock") + (p.navigation.early_section_submit ? " A submitted section is locked." : " Each section is locked when its time ends or when you submit it. In the exam you stay in a section until its time ends; here you may submit early, and the time left is not carried over.") + "</p>" : "";
    var dev = a.deviations && a.deviations.length ? '<section class="pn-panel pn-t2dev' + (a.reduced ? " warn" : "") + '"><h2 class="pn-sec">' + (a.reduced ? "Shorter than the blueprint" : "How it was built") + '</h2><ul class="pn-t2dl">' + a.deviations.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul></section>" : "";
    var dKey = x.type === "daily10" || x.type === "daily_mixed" ? A.dailyKey(p.id, Date.now(), x.type) : null;
    var d10 = dKey && store().t2d[dKey] ? '<p class="pn-mut pn-small">Today\'s ' + (x.type === "daily10" ? "Daily 10" : "Daily mixed") + ' is already counted. This run is practice.</p>' : "";
    H.paint(H.bar(esc(x.title), esc(p.name) + (p.status === "official" ? "" : " · provisional"), "back") + '<div class="pn-body pn-t2pre">' +
      (a.ok ? '<section class="pn-panel"><dl class="pn-t2f">' + facts.map(function (f) { return "<div><dt>" + f[0] + "</dt><dd>" + esc(f[1]) + "</dd></div>"; }).join("") + "</dl>" + secs + d10 + "</section>" + dev +
        '<p class="pn-mut pn-small">' + esc(srcLine(p)) + " Profile " + esc(p.id) + " v" + esc(p.version) + '.</p><button type="button" class="pn-btn pri" data-act="t2-go">' + H.ico("play") + " Start</button>"
        : '<section class="pn-panel pn-t2dev warn" role="alert"><h2 class="pn-sec">This test cannot be built now</h2><p>' + esc(a.refused || "Not enough eligible questions.") + "</p>" + (a.deviations && a.deviations.length ? '<ul class="pn-t2dl">' + a.deviations.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>" : "") + "</section>" +
          (x.type !== "mini" && A.blueprint(p, "mini") ? '<button type="button" class="pn-btn" data-act="t2-pre" data-p="' + p.id + '" data-k="mini">Try one section instead</button>' : "") + '<button type="button" class="pn-btn" data-act="back">Back</button>') + "</div>", a.ok ? "[data-act=t2-go]" : null);
  }
  function go() {
    var x = P.pick; if (!x || !x.asm.ok) return;
    var p = x.p, a = x.asm, now = Date.now();
    var dk = !x.fixed && (x.type === "daily10" || x.type === "daily_mixed") ? A.dailyKey(p.id, now, x.type) : null;
    var t2 = { exam: p.id, pv: p.version, type: x.type, attempt_id: "t2-" + now.toString(36) + "-" + Math.floor(Math.random() * 46656).toString(36), idem: dk,
      paper: x.fixed ? x.fixed.id : null,
      started: now, earlyOk: !!p.navigation.early_section_submit, sections: a.sections && a.sections.length ? a.sections : null, blueprint: { id: a.blueprint.id, version: a.blueprint.version },
      asm: { planned: a.planned, actual: a.actual, deviations: a.deviations, count: a.count, requested: a.requested, reduced: a.reduced, seed: a.seed } };
    H.stack().pop();   // the pre-test screen
    clearSess();
    H.run(a.items, "exam", x.title, { t2: t2, sections: t2.sections, limit: t2.sections ? 0 : a.duration_sec, scheme: A.scheme(p) });
  }

  /* ---------- opt-in, de-identified item statistics (owner decision 10) ----------
     Asked once, on a Tests 2 result. Yes: each later marked test sends [item id, right/wrong/blank, seconds, option] to
     /api/prep/stats with no sign-in, user, device or attempt id (functions/api/prep/stats.js). No: nothing is sent. */
  var STATS = "smd_prep_stats";
  function statsChoice() { try { return G.localStorage.getItem(STATS); } catch (e) { return "0"; } }
  function sendStats(rec) {
    if (statsChoice() !== "1" || !rec || !G.fetch) return;
    // IQoach: the confidence tag id only (guessing/confident/confused), never any text.
    var rows = rec.items.map(function (x) { return [x.item_id, x.chosen == null ? null : x.correct ? 1 : 0, Math.min(3600, Math.round((x.ms || 0) / 1000)), x.chosen == null ? -1 : x.chosen, A.cleanConf(x.conf)]; });
    try { G.fetch((G.SMD_PREP_STATS_API || "/api/prep/stats"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, exam: rec.exam, type: rec.test_type, items: rows }), keepalive: rows.length <= 60, credentials: "omit" }).then(null, function () {}); } catch (e) {}
  }
  function statsAsk() {
    if (statsChoice() != null) return "";
    return '<section class="pn-panel pn-t2ask" aria-labelledby="pnT2AskH"><h2 class="pn-sec" id="pnT2AskH">Help improve the questions?</h2><p class="pn-mut pn-small">Share anonymous answer statistics from your tests: the question number, right or wrong, the time taken, the option chosen and your confidence tag (guessing, confident or confused). Nothing that identifies you is sent. They are used only to flag questions for review, never to change or remove them by themselves. You can change this in the Tests tab.</p>' +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="t2-stats" data-v="0">No thanks</button><button type="button" class="pn-btn pri" data-act="t2-stats" data-v="1">Share</button></div></section>';
  }

  /* ---------- finish and results ---------- */
  function subjectName(s) { var sb = H.subjectById(s); return sb ? (sb.name.en || s) : s === "pyq" ? "Not sorted into a subject yet" : s; }
  function topicName(s, m) { var t = H.topicOf(s, m); return t ? (t.title.en || m) : m; }
  function finished(r) {
    var t = r.t2, p = A.profile(t.exam); if (!p) return;
    var keep = []; r.items.forEach(function (it, i) { if (!it._gone) keep.push(i); });
    var items = keep.map(function (i) { return r.items[i]; }), ans = keep.map(function (i) { return r.ans[i]; });
    var secs = t.sections ? t.sections.map(function (s) { var from = 0, to = 0; keep.forEach(function (i, j) { if (i < s.from) from = j + 1; if (i < s.to) to = j + 1; }); return { id: s.id, label: s.label, from: from, to: to, sec: s.sec }; }) : null;
    var timedOut = r.sc ? r.sc.why.some(function (w) { return w === "timeout" || w === "away" || w === "clock"; }) : r.limit && (Date.now() - r.t0) / 1000 >= r.limit - 1;
    var rec = A.result({ attempt_id: t.attempt_id, idempotency_key: t.idem || undefined, test_type: t.type, blueprint: t.blueprint, started: t.started, finished: Date.now(), state: timedOut ? "auto_submitted_timeout" : "submitted",
      items: items, ans: ans, mark: keep.map(function (i) { return !!r.mark[i]; }), ms: keep.map(function (i) { return (r.ms || [])[i] || 0; }), changed: keep.map(function (i) { return (r.changed || [])[i] || 0; }), conf: keep.map(function (i) { return (r.conf || [])[i] || null; }), pair: keep.map(function (i) { return (r.confPair || [])[i] || null; }), sections: secs, asm: { planned: t.asm.planned, actual: t.asm.actual, deviations: t.asm.deviations } }, p, { subjectName: subjectName, topicName: topicName });
    if (r.sc) rec.by_section.forEach(function (b) { var k = -1; t.sections.forEach(function (s, j) { if (s.id === b.key) k = j; }); if (k >= 0) { b.used_ms = Math.round(r.sc.used[k]); b.allowed_ms = r.sc.lim[k]; b.ended = r.sc.why[k] || "submitted"; } });
    r.t2.rec = rec;
    var s = store(), now = Date.now();
    s.t2h = s.t2h.concat([{ attempt_id: rec.attempt_id, exam: rec.exam, type: rec.test_type, pv: rec.profile_version, paper: t.paper || null, ts: now, raw: rec.score.raw, max: rec.score.max, correct: rec.score.correct, incorrect: rec.score.incorrect, unanswered: rec.score.unanswered, n: items.length, cf: confCounts(rec.items), secs: rec.by_section.map(function (b) { return [b.key, b.raw]; }) }]).slice(-30);
    if (t.idem) { var dc = A.dailyComplete(s.t2d, t.idem, { ts: now, attempt_id: rec.attempt_id, raw: rec.score.raw, max: rec.score.max, correct: rec.score.correct, n: items.length }); r.t2.dailyFresh = dc.fresh; A.dailyPrune(s.t2d, now, 60); }
    H.save();
    H.cachePut(REC_KEY + rec.attempt_id, rec);
    sendStats(rec);
    clearSess();
  }
  function pct(x) { return x == null ? "-" : Math.round(x * 100) + "%"; }
  /* IQoach capture: compact chip counts for a t2h row, from the attempt record's items. */
  function confCounts(items) {
    var c = { guessing: 0, confident: 0, confused: 0 };
    (items || []).forEach(function (x) { var v = A.cleanConf(x && x.conf); if (v) c[v]++; });
    return c;
  }
  /* Review-time tag on a flagged question (Solutions tab): toggles the chip, writes it back to the stored attempt
     record (IndexedDB t2r) and to the study history (the t2h row's counts, the module tally and the coach
     aggregate via reconf), then repaints. A complement for chips skipped during the run. */
  function tagConf(b) {
    var r = H.run_ ? H.run_() : null;
    if (!r || !r.t2 || !r.t2.rec) return;
    var i = Number(b.getAttribute("data-i")), v = A.cleanConf(b.getAttribute("data-v"));
    if (!(i >= 0) || !r.mark[i] || (r.items[i] || {})._gone) return;
    r.conf = r.conf || [];
    var old = A.cleanConf(r.conf[i]), nv = old === v || !v ? null : v;
    r.conf[i] = nv;
    var rec = r.t2.rec;
    if (rec.items[i]) { if (nv) rec.items[i].conf = nv; else delete rec.items[i].conf; }
    H.cachePut(REC_KEY + rec.attempt_id, rec);
    try {
      var s = store(), it = r.items[i], mid = it && (it._m || it.t), mm = mid && s.mod[mid];
      if (mm) { mm.cf = mm.cf || { guessing: 0, confident: 0, confused: 0 }; if (old && mm.cf[old] > 0) mm.cf[old]--; if (nv) mm.cf[nv] = (mm.cf[nv] || 0) + 1; }
      var CO = G.PREP_COACH, corr = rec.items[i] ? rec.items[i].correct : null;
      if (CO && corr != null && it && it._s && mid) { if (!s.coach_t) s.coach_t = {}; CO.reconf(s.coach_t, CO.topicKey(it._s, mid), corr, old, nv); }
      s.t2h.forEach(function (x) { if (x.attempt_id === rec.attempt_id) x.cf = confCounts(rec.items); });
      H.save();
    } catch (e) {}
    H.rerender();
  }

  /* ---------- richer results (Tests 2 ON): Analysis / Graphs / Solutions tabs ----------
     Honesty: counts, accuracy labelled "practice mastery", per-question outcomes and the student's own earlier
     attempts only. Never a rank, percentile, readiness score or prediction. Under 5 questions the trend and the
     bars hide behind a plain "too few questions" note. Everything renders from the stored attempt record
     offline; the only network is the pre-existing opt-in anonymous stats and cached link shards. */
  function r2tab(r) {
    var v = r.t2.tab;
    if (v !== "analysis" && v !== "graphs" && v !== "solutions") {
      try { var m = String(G.location.hash || "").match(/tab=(analysis|graphs|solutions)/); v = m ? m[1] : "analysis"; }
      catch (e) { v = "analysis"; }
      r.t2.tab = v;
    }
    return v;
  }
  function r2setTab(r, v) {
    if (v !== "analysis" && v !== "graphs" && v !== "solutions") return;
    r.t2.tab = v;
    try { G.location.hash = "tab=" + v; } catch (e) {}
    H.rerender();
    try { var b = H.root().querySelector('[data-act=t2-tab][data-v="' + v + '"]'); if (b) b.focus({ preventScroll: true }); } catch (e) {}
  }
  // Per-question status from the live run: ok / no / skip / unseen. Unseen = never answered and no time
  // recorded, or a withdrawn placeholder (_gone, left out of the marks).
  function r2status(r, i) {
    var it = r.items[i];
    if (it._gone) return "unseen";
    var a = r.ans[i];
    if (a >= 0) return a === it.a ? "ok" : "no";
    return (r.ms || [])[i] > 0 ? "skip" : "unseen";
  }
  var R2ST = { ok: "Correct", no: "Incorrect", skip: "Skipped", unseen: "Unseen" };
  // Answers bar: one stacked inline-SVG bar, right / wrong / not answered.
  function r2answersBar(sc, n) {
    var w = function (x) { return n ? x * 100 / n : 0; };
    var c = w(sc.correct), g = w(sc.incorrect), u = Math.max(0, 100 - c - g);
    return '<svg class="t2bar" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="' +
      sc.correct + " right, " + sc.incorrect + " wrong, " + sc.unanswered + ' not answered"><rect class="b-ok" x="0" y="0" width="' + c.toFixed(1) + '" height="10"/>' +
      '<rect class="b-no" x="' + c.toFixed(1) + '" y="0" width="' + g.toFixed(1) + '" height="10"/>' +
      '<rect class="b-sk" x="' + (c + g).toFixed(1) + '" y="0" width="' + u.toFixed(1) + '" height="10"/></svg>';
  }
  // Time donut: used vs allowed when the test had a clock, else average a question vs the exam pace.
  function r2donut(r, rec, p) {
    var sc = rec.score, used = r.secs, allowed = 0;
    if (r.t2.sections) allowed = r.t2.sections.reduce(function (a, s) { return a + s.sec; }, 0);
    else if (r.limit) allowed = r.limit;
    var frac, cap, sub;
    if (allowed > 0) { frac = Math.min(1, used / allowed); cap = mmss(used) + " of " + mmss(allowed); sub = "of the test time used"; }
    else { var pace = A.paceSec(p), avg = sc.avg_ms ? sc.avg_ms / 1000 : 0; frac = pace ? Math.min(1, avg / pace) : 0; cap = avg ? Math.round(avg) + " s" : "-"; sub = "average a question, exam pace " + pace + " s"; }
    var v = Math.round(frac * 100);
    return '<div class="t2donut"><svg viewBox="0 0 120 120" role="img" aria-label="' + esc(cap + ", " + sub) + '"><circle class="dt" cx="60" cy="60" r="52" pathLength="100"/>' +
      (v > 0 ? '<circle class="dv" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="' + v + ' 100"/>' : "") + "</svg>" +
      '<p class="t2donut-c"><b>' + esc(cap) + "</b><span>" + esc(sub) + "</span></p></div>";
  }
  // Per-question strip: one dot a question in order; a tap jumps to its solution card.
  function r2strip(r) {
    var dots = r.items.map(function (it, i) {
      var s = r2status(r, i);
      return '<li><button type="button" class="t2dot ' + s + '" data-act="t2-goto" data-i="' + i + '" aria-label="Question ' + (i + 1) + ": " + R2ST[s] + '"><i aria-hidden="true"></i></button></li>';
    }).join("");
    return '<ol class="t2strip" aria-label="Every question in order">' + dots + "</ol>";
  }
  // Time per question: one bar a question coloured by outcome, with an average line. Capped at 3x the
  // average so one long pause does not flatten the rest.
  function r2timeSvg(r, rec) {
    var ms = r.items.map(function (it, i) { return Math.max(0, Math.round(((r.ms || [])[i]) || 0) / 1000); });
    var n = ms.length, W = Math.max(n * 10, 10), HT = 64, avg = rec.score.avg_ms ? rec.score.avg_ms / 1000 : 0;
    var cap = Math.max(avg * 3, 1);
    var bars = ms.map(function (s, i) {
      var h = Math.max(2, Math.min(HT - 8, s / cap * (HT - 8)));
      return '<rect class="t-' + r2status(r, i) + '" x="' + (i * 10 + 1) + '" y="' + (HT - 4 - h).toFixed(1) + '" width="8" height="' + h.toFixed(1) + '"><title>Q' + (i + 1) + ": " + Math.round(s) + " s</title></rect>";
    }).join("");
    var ay = avg ? (HT - 4 - Math.min(HT - 8, avg / cap * (HT - 8))).toFixed(1) : null;
    return '<div class="t2scroll"><svg class="t2time" viewBox="0 0 ' + W + " " + HT + '" style="min-width:' + Math.min(W * 2, 640) + 'px" role="img" aria-label="Time per question' + (avg ? ", average " + Math.round(avg) + " seconds" : "") + '">' + bars +
      (ay != null ? '<line class="t-avg" x1="0" x2="' + W + '" y1="' + ay + '" y2="' + ay + '"/>' : "") + "</svg></div>";
  }
  function r2meter(pc) { return '<span class="t2meter" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, Math.round(pc))) + '%"></i></span>'; }
  function r2subjRows(rec) {
    var rows = rec.by_subject.slice().sort(function (a, b) { return (a.correct / a.n) - (b.correct / b.n); });
    return rows.map(function (b) {
      var pc = Math.round(b.correct * 100 / b.n);
      var inner = '<span class="t2row-t"><b>' + esc(b.label) + "</b><small>" + b.correct + " of " + b.n + " right, " + b.incorrect + " wrong</small>" + r2meter(pc) + '</span><span class="t2row-v">' + pc + "%</span>";
      return H.subjectById(b.key) ? '<li><button type="button" class="t2row" data-act="subject" data-s="' + esc(b.key) + '">' + inner + "</button></li>" : '<li><div class="t2row static">' + inner + "</div></li>";
    }).join("");
  }
  function r2topicRows(rec) {
    var rows = rec.by_topic.filter(function (b) { return b.n - b.correct > 0; }).sort(function (a, b) { return (a.correct / a.n) - (b.correct / b.n) || b.n - a.n; }).slice(0, 8);
    if (!rows.length) return "";
    return rows.map(function (b) {
      var k = b.key.split("|"), pc = Math.round(b.correct * 100 / b.n);
      return '<li><button type="button" class="t2row" data-act="module" data-s="' + esc(k[0]) + '" data-m="' + esc(k[1]) + '"><span class="t2row-t"><b>' + esc(b.label) + "</b><small>" + (b.n - b.correct) + " of " + b.n + " missed</small>" + r2meter(pc) + '</span><span class="t2row-v">' + pc + "%</span></button></li>";
    }).join("");
  }
  // Patterns: best streak, longest slip and recovery rate from the attempt's question order.
  function r2patterns(rec) {
    var pat = A.streaks(rec.items);
    var recB = pat.rec_d ? pat.rec_n + " of " + pat.rec_d : "-", recS = pat.rec_d ? "answered right after a wrong one" : "no wrong answer to recover from";
    return '<ul class="t2pat">' +
      "<li><b>" + pat.best + "</b><span>Best streak, right in a row</span></li>" +
      "<li><b>" + pat.slip + "</b><span>Longest slip, wrong in a row</span></li>" +
      "<li><b>" + recB + "</b><span>Recoveries: " + recS + "</span></li></ul>" +
      "<p class=\"t2note\">From this test's question order. Skipped questions break a run.</p>";
  }
  // Knowledge gaps: the weakest topics (next_actions, at most 3) with the stored learning objective and
  // revision summary of a missed question there, its share ID, one-tap Revise (the topic) and Practise
  // (a topic test), plus a links slot that PREP_REASON.fill() resolves via the PR#1458 links index.
  function r2gaps(r, rec, pid) {
    var acts = rec.next_actions || [];
    if (!acts.length) return '<p class="t2note">No clear gap yet: every topic had at most one missed question.</p>';
    return '<ul class="t2gaps">' + acts.map(function (n) {
      var k = n.target_id.split("|"), sid = k[0], mid = k[1], rep = -1, any = -1;
      r.items.forEach(function (it, i) {
        if (it._gone || it._s !== sid || (it._m || it.t) !== mid || r.ans[i] === it.a) return;
        if (any < 0) any = i;
        if (rep < 0 && it.x && (it.x.lo || it.x.rev)) rep = i;
      });
      if (rep < 0) rep = any;
      var it = rep >= 0 ? r.items[rep] : null, x = (it && it.x) || {};
      var lo = typeof x.lo === "string" && x.lo.trim() ? x.lo.trim() : "";
      var rev = typeof x.rev === "string" && x.rev.trim() ? x.rev.trim() : "";
      var chip = "";
      try { if (it && G.PREP_IDS) { var id = G.PREP_IDS.ofItem(it); if (id) chip = G.PREP_IDS.chip(id); } } catch (e) {}
      var slot = it ? '<div class="pn-rx" data-i="' + esc(it.id) + '" data-s="' + esc(sid) + '" data-m="' + esc(mid) + '"></div>' : "";
      return '<li class="t2gap"><p class="t2gap-h"><b>' + esc(topicName(sid, mid)) + "</b><span>" + esc(n.why) + " in this test</span></p>" +
        (lo ? '<p class="t2lo"><span>Learning objective</span>' + esc(lo) + "</p>" : "") +
        (rev ? '<p class="t2rev"><span>Revision summary</span>' + esc(rev) + "</p>" : "") +
        (rep >= 0 ? '<p class="t2note">From question ' + (rep + 1) + ".</p>" : "") + chip + slot +
        '<div class="t2gap-act"><button type="button" class="t2btn" data-act="module" data-s="' + esc(sid) + '" data-m="' + esc(mid) + '">Revise this topic</button>' +
        '<button type="button" class="t2btn pri" data-act="t2-pre" data-p="' + esc(pid) + '" data-k="topic" data-s="' + esc(sid) + '" data-m="' + esc(mid) + '" data-need="5">Practise related questions</button></div></li>';
    }).join("") + "</ul>";
  }
  // Pearls: stored pearls only (x.pearl or kp), never generated. At most 5, deduplicated.
  function r2pearls(r) {
    var seen = {}, out = [];
    r.items.forEach(function (it, i) {
      var p = (it.x && it.x.pearl) || it.kp;
      if (typeof p !== "string" || !p.trim() || seen[p.trim()]) return;
      seen[p.trim()] = 1;
      if (out.length < 5) out.push({ i: i, p: p.trim() });
    });
    if (!out.length) return "";
    return '<h3 class="t2h">Exam pearls</h3><ul class="t2pearls">' + out.map(function (o) {
      return '<li><aside aria-label="Exam pearl from question ' + (o.i + 1) + '"><b>Q' + (o.i + 1) + "</b><span>" + esc(o.p) + "</span></aside></li>";
    }).join("") + "</ul>";
  }
  // Ask MaiK about this result: the existing sheet (prep-ask.js) with the attempt summary as its context,
  // answered on this phone when MaiK runs there, else online behind its one-tap consent (never a silent switch).
  function askCtx(r) {
    var rec = r.t2.rec, sc = rec.score;
    var weak = (rec.next_actions || []).slice(0, 3).map(function (n) { var k = n.target_id.split("|"); return topicName(k[0], k[1]) + " (" + n.why + ")"; });
    var miss = [];
    r.items.forEach(function (it, i) { if (!it._gone && r.ans[i] !== it.a && miss.length < 12) miss.push("Q" + (i + 1)); });
    var tx = r.title + ": " + sc.correct + " right, " + sc.incorrect + " wrong, " + sc.unanswered + " not answered out of " + r.items.length + " (" + fmtMarks(sc.raw) + " of " + sc.max + " marks)." +
      (weak.length ? " Weakest topics: " + weak.join("; ") + "." : " No topic had more than one missed question.") +
      (miss.length ? " Missed: " + miss.join(", ") + "." : " Nothing missed.");
    return { kind: "step", step: { tx: tx }, title: "Test result: " + r.title };
  }
  function resultHtml(r, cele) {
    var t = r.t2, rec = t.rec, p = A.profile(t.exam); if (!rec || !p) return "";
    var sc = rec.score, n = r.items.length, small = n < 5, tab = r2tab(r);
    var tabs = [["analysis", "Analysis"], ["graphs", "Graphs"], ["solutions", "Solutions"]];
    var head = '<section class="pn-panel pn-score pn-t2r2" aria-label="Test result"' + H.celeAttrs(cele) + ">" + H.celeChip(cele) +
      '<p class="pn-t2eb">' + esc(p.name) + " · " + esc(typeName(t.type)) + (t.type === "daily10" ? " · " + (t.dailyFresh ? "counted today" : "practice, already counted today") : "") + "</p>" +
      '<p class="pn-big">' + fmtMarks(sc.raw) + " / " + sc.max + "</p>" +
      '<p class="t2mut">' + esc(p.name) + " marking: " + esc(marking(p)) + " · " + mmss(r.secs) + " taken</p>" +
      r2answersBar(sc, n) +
      '<ul class="t2key"><li><i class="b-ok" aria-hidden="true"></i>' + sc.correct + " right</li><li><i class=\"b-no\" aria-hidden=\"true\"></i>" + sc.incorrect + " wrong</li><li><i class=\"b-sk\" aria-hidden=\"true\"></i>" + sc.unanswered + " not answered</li></ul>" +
      '<p class="t2mastery">Practice mastery ' + pct(sc.accuracy) + (sc.accuracy == null ? " · nothing answered" : " right of answered") + " · this test only</p>" +
      (p.scoring.pass ? '<p class="t2mut t2small-p">' + esc(p.scoring.pass.label || "Pass mark") + " in the exam: " + p.scoring.pass.marks + " of " + p.scoring.pass.of + ". This test: " + (sc.max ? Math.round(Math.max(0, sc.raw) * 100 / sc.max) : 0) + "% of its marks.</p>" : "") +
      (rec.state === "auto_submitted_timeout" ? '<p class="t2mut">' + H.ico("clock") + " Time ran out: answers given by then were marked.</p>" : "") +
      (small ? '<p class="t2small" role="note">Too few questions to say much: the trend and the subject bars stay hidden until 5 questions.</p>' : "") +
      '<div class="t2tabs" role="tablist" aria-label="Result views">' + tabs.map(function (x) {
        return '<button type="button" role="tab" id="t2tab-' + x[0] + '" aria-selected="' + (tab === x[0]) + '" aria-controls="t2p-' + x[0] + '" class="t2tab' + (tab === x[0] ? " on" : "") + '" data-act="t2-tab" data-v="' + x[0] + '">' + x[1] + "</button>";
      }).join("") + "</div>";
    var panel = "";
    if (tab === "graphs") {
      var tops = r2topicRows(rec);
      var secs = rec.by_section.length > 1 ? '<h3 class="t2h">By section</h3><ul class="t2list">' + rec.by_section.map(function (b) {
        return '<li><div class="t2row static"><span class="t2row-t"><b>' + esc(b.label) + "</b><small>" + b.correct + " right · " + b.incorrect + " wrong · " + b.unanswered + " not answered" + (b.used_ms ? " · " + mmss(b.used_ms / 1000) + " of " + mmss(b.allowed_ms / 1000) : "") + '</small></span><span class="t2row-v">' + fmtMarks(b.raw) + "</span></div></li>";
      }).join("") + "</ul>" : "";
      var diff = rec.by_difficulty.length > 1 ? '<p class="t2note">By difficulty: ' + rec.by_difficulty.slice().sort(function (a, b) { return a.key - b.key; }).map(function (b) { return esc(b.label) + " " + b.correct + "/" + b.n; }).join(" · ") + "</p>" : "";
      panel = '<div role="tabpanel" id="t2p-graphs" aria-labelledby="t2tab-graphs" tabindex="0">' +
        '<h3 class="t2h">Time</h3>' + r2donut(r, rec, p) +
        '<h3 class="t2h">Every question in order</h3>' + r2strip(r) +
        '<h3 class="t2h">Time per question</h3>' + r2timeSvg(r, rec) +
        (small ? "" : '<h3 class="t2h">By subject, weakest first</h3><ul class="t2list">' + r2subjRows(rec) + "</ul>") +
        (small || !tops ? "" : '<h3 class="t2h">Missed topics</h3><ul class="t2list">' + tops + "</ul>") +
        secs + diff + "</div>";
    } else if (tab === "solutions") {
      panel = '<div role="tabpanel" id="t2p-solutions" aria-labelledby="t2tab-solutions" tabindex="0">' + (H.t2solutions ? H.t2solutions(r) : "") + "</div>";
    } else {
      var trend = small ? [] : A.ownTrend(store().t2h, { exam: rec.exam, test_type: rec.test_type, attempt_id: rec.attempt_id });
      var tr = (t.type === "grand" || t.type === "part" || t.type === "mini") && !small ? '<h3 class="t2h">Your earlier attempts</h3>' + (trend.length ? '<ul class="t2list">' + trend.slice().reverse().map(function (h) { return '<li><div class="t2row static"><span class="t2row-t"><b>' + dm(h.ts) + "</b><small>" + h.correct + " right · " + h.incorrect + " wrong · " + h.unanswered + ' not answered</small></span><span class="t2row-v">' + fmtMarks(h.raw) + " / " + h.max + "</span></div></li>"; }).join("") + "</ul>" : '<p class="t2note">Your first ' + esc(typeName(t.type).toLowerCase()) + " for " + esc(p.name) + ". Later attempts are compared with this one.</p>") +
        '<p class="t2note">Compared only with your own attempts. No national rank or percentile is shown: no representative group of candidates exists to compare with.</p>' : "";
      var how = '<details class="t2how"><summary>How this test was built</summary><p class="t2note">Profile ' + esc(rec.exam) + " v" + esc(rec.profile_version) + " (" + esc(p.status) + "). " + esc(srcLine(p)) + "</p>" +
        (rec.distribution.deviations.length ? '<ul class="t2dl">' + rec.distribution.deviations.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>" : '<p class="t2note">Built as planned.</p>') +
        '<ul class="t2dist">' + Object.keys(rec.distribution.actual).map(function (k) { return "<li><span>" + esc(subjectName(k)) + "</span><span>" + rec.distribution.actual[k] + (rec.distribution.planned[k] != null && rec.distribution.planned[k] !== rec.distribution.actual[k] ? " of " + rec.distribution.planned[k] + " planned" : "") + "</span></li>"; }).join("") + "</ul></details>";
      panel = '<div role="tabpanel" id="t2p-analysis" aria-labelledby="t2tab-analysis" tabindex="0">' +
        (small ? "" : '<h3 class="t2h">Patterns</h3>' + r2patterns(rec)) +
        '<h3 class="t2h">Knowledge gaps</h3>' + r2gaps(r, rec, p.id) + r2pearls(r) + (H.coachResult ? H.coachResult(r) : "") +
        (G.PREP_ASK ? '<button type="button" class="t2btn pri t2ask" data-act="ask-sum">Ask MaiK about this result</button><p class="t2note">MaiK answers from this result on your phone, or online with your say-so.</p>' : "") +
        tr + how + statsAsk() + "</div>";
    }
    return head + panel + "</section>";
  }

  /* ---------- acts ---------- */
  function act(a, b, h) {
    H = h;
    var pid = b.getAttribute("data-p"), k = b.getAttribute("data-k");
    if (a === "t2-tab") { var rt = H.run_(); if (rt && rt.t2) r2setTab(rt, b.getAttribute("data-v")); return; }
    if (a === "t2-sol") { var rs = H.run_(); if (rs && rs.t2) { rs.t2.solf = b.getAttribute("data-v"); H.rerender(); try { var fb = H.root().querySelector('[data-act=t2-sol][data-v="' + rs.t2.solf + '"]'); if (fb) fb.focus({ preventScroll: true }); } catch (e) {} } return; }
    if (a === "t2-goto") { var rg = H.run_(); if (rg && rg.t2) { rg.t2.tab = "solutions"; rg.t2.solf = "all"; try { G.location.hash = "tab=solutions"; } catch (e) {} H.rerender(); try { var el = H.root().querySelector("#t2q" + b.getAttribute("data-i")); if (el) { el.setAttribute("open", ""); el.scrollIntoView(); } } catch (e) {} } return; }
    if (a === "t2-conftag") return tagConf(b);
    if (a === "t2-pre") return prepare(pid, k, b.getAttribute("data-s"), b.getAttribute("data-m"));
    if (a === "t2-fixed") return prepareFixed(b.getAttribute("data-fx"));
    if (a === "t2-go") return go();
    if (a === "t2-stats") { try { G.localStorage.setItem(STATS, b.getAttribute("data-v") === "1" ? "1" : "0"); } catch (e) {} var r0 = H.run_ && H.run_(); if (b.getAttribute("data-v") === "1" && r0 && r0.t2 && r0.t2.rec) sendStats(r0.t2.rec); var box = b.closest(".pn-t2ask"); if (box) box.innerHTML = '<p class="pn-mut pn-small" role="status">' + (b.getAttribute("data-v") === "1" ? "Thank you. Anonymous statistics are on." : "Nothing will be sent.") + "</p>"; return; }
    if (a === "t2-pick") return pickSubject(A.profile(pid), k);
    if (a === "t2-pickm") return pickModule(A.profile(pid), b.getAttribute("data-s"));
    if (a === "t2-ccpick") return pickCustomEngine(A.profile(pid));
    if (a === "t2-ccsub") { var cs = P.ccfg.subs, cv = b.getAttribute("data-v"); if (cs[cv]) delete cs[cv]; else cs[cv] = 1; return H.rerender(); }
    if (a === "t2-ccn") { P.ccfg.n = Number(b.getAttribute("data-v")) || 20; return H.rerender(); }
    if (a === "t2-ccd") { P.ccfg.d = Number(b.getAttribute("data-v")) || 0; return H.rerender(); }
    if (a === "t2-cci") { P.ccfg.img = b.getAttribute("data-v") === "img" ? 1 : 0; return H.rerender(); }
    if (a === "t2-ccgo") return ccGo();
    if (a === "t2-resume") return resume();
    if (a === "t2-discard") { if (G.confirm && !G.confirm("Discard the saved test? Its answers are not marked.")) return; return Promise.resolve(clearSess()).then(function () { H.rerender(); }); }
    if (a === "t2-legacy") return H.startMock(b.getAttribute("data-v"), "full");
    if (a === "t2-statsw") { try { G.localStorage.setItem(STATS, statsChoice() === "1" ? "0" : "1"); } catch (e) {} return H.rerender(); }
    if (a === "t2-plan") return H.startPlan();
    if (a === "t2-weak") return H.startWeak();
    if (a === "t2-mistakes") return H.openMistakes();
    if (a === "t2-custom") return H.openCustom();
    if (a === "t2-x") {
      var px = null; try { px = A.profile(pid); } catch (eX) { px = null; }
      if (!px) return;
      var xh = examHeadEl(pid), xOpen = xh && xh.getAttribute("aria-expanded") === "true";
      var sx = loadGrp(); setExamOpen(sx, pid, !xOpen); setExamDom(px, !xOpen);
      return;
    }
    if (a === "t2-g") {
      var gf = b.getAttribute("data-f"), pg = null; try { pg = A.profile(pid); } catch (eG) { pg = null; }
      if (!pg || !gf) return;
      var gh = grpHeadEl(pid, gf), gOpen = gh && gh.getAttribute("aria-expanded") === "true";
      var sg = loadGrp(); setGrpOpen(sg, pid, gf, !gOpen); setGrpDom(pg, gf, !gOpen);
      return;
    }
    if (a === "t2-more") {
      var mf = b.getAttribute("data-f"), pm = null; try { pm = A.profile(pid); } catch (eM) { pm = null; }
      if (!pm || !mf) return;
      var mk = grpKey(pid, mf); P.grpShow[mk] = !P.grpShow[mk];
      var mb = grpBodyEl(pid, mf);
      if (mb) { var mw = mb.querySelector(".pn-t2fxwrap"); if (mw) mw.innerHTML = fixedListHtml(pm, mf); }
      return;
    }
    if (a === "t2-jump") {
      var jf = b.getAttribute("data-f"), pj = null; try { pj = A.profile(pid); } catch (eJ) { pj = null; }
      if (!pj || !jf) return;
      var sj = loadGrp(), xhj = examHeadEl(pid);
      if (xhj && xhj.getAttribute("aria-expanded") !== "true") { setExamOpen(sj, pid, true); setExamDom(pj, true); sj = loadGrp(); }
      var ghj = grpHeadEl(pid, jf);
      if (ghj && ghj.getAttribute("aria-expanded") !== "true") { setGrpOpen(sj, pid, jf, true); setGrpDom(pj, jf, true); }
      try {
        var tgt = grpHeadEl(pid, jf);
        if (tgt) {
          if (tgt.scrollIntoView) tgt.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
          if (tgt.focus) { try { tgt.focus({ preventScroll: true }); } catch (eF) { tgt.focus(); } }
        }
      } catch (eS) {}
      return;
    }
  }
  G.PREP_TESTS = { on: on, testsHtml: testsHtml, mounted: mounted, act: act, persist: persist, left: left, finished: finished, resultHtml: resultHtml, askCtx: askCtx, _P: P, _clear: clearSess, poolOf: poolOf, poolItems: poolItems,
    _grp: { ORDER: GRP_ORDER, FIRST: GRP_FIRST, SEARCH_AT: GRP_SEARCH_AT, name: grpName, short: grpShort, examOrder: examOrder, fxFor: fxFor, paperSubject: paperSubject, fxInPlan: fxInPlan, groupVisible: groupVisible, visibleFormats: visibleFormats, paperDone: paperDone, engineDone: engineDone, dailyDoneByKey: dailyDoneByKey, countFxDone: countFxDone, defaultExamOpen: defaultExamOpen, defaultGrpOpen: defaultGrpOpen, loadGrp: loadGrp, saveGrp: saveGrp, grpIsOpen: grpIsOpen, examIsOpen: examIsOpen, setGrpOpen: setGrpOpen, setExamOpen: setExamOpen, filterFx: filterFx, visibleFx: visibleFx, grpKey: grpKey, groupCounts: groupCounts, examCounts: examCounts, metaTxt: metaTxt } };
})(typeof window !== "undefined" ? window : this);
