/* PrepNucleus plan: onboarding, exam readiness and today's plan. window.PREP_PLAN. ES5.
   Plan: vault/plans/PrepNucleus-Plan2.md (sections 1, 4, 5 phase 1). Loaded by prep-loader.js after prep.js and drawn
   through PREP._host (same overlay, back stack, runner and store). prep.js forwards every data-act starting "p-" here,
   asks back() first on back, shows onboard() on the first plain open and draws homeHtml() where the Today card was.

   Store (smd_prep_v1): pl { ob, exam, date, min, rem } = onboarding answers (ob 1 once finished or skipped; exam is one
   of EXAM_CHOICES; date "YYYY-MM-DD" or null; min daily minutes; rem "HH:MM" or null: the daily reminder time,
   scheduled by prep-native.js when the student turns the reminder on). pt { d, ex, items } = today's plan, made once per local day and exam tab. ra = the last answers as
   [module, 1|0] (written by prep.js record()), read by readiness.

   Readiness per exam = geometric mean of coverage (share of the exam's modules attempted, weighted by the exam's
   blueprint per subject, else by module count), retention (mean FSRS retrievability today of the seen cards) and
   accuracy (the last 200 answers), x 100. Pure helpers load under node for tests. Nothing here calls a server.
   snapshot() feeds prep-native.js (widget, Live Activity, reminder count); the settings sheet carries its reminder switch
   and sync controls ("p-n-*" acts go to it). */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  var CORE = NODE ? require("./specialty-core.js") : G.SPECIALTY_CORE;

  /* ================= pure ================= */
  // Exams a student can pick; tab = the exam tab in prep.js (INI-CET shares the NEET-PG bank and tab).
  var EXAM_CHOICES = [
    { id: "neet-pg", tab: "neet-pg", label: "NEET-PG", sub: "MD, MS and DNB entrance, 19 MBBS subjects" },
    { id: "ini-cet", tab: "neet-pg", label: "INI-CET", sub: "AIIMS, JIPMER, PGIMER and NIMHANS entrance" },
    { id: "neet-ss", tab: "neet-ss", label: "NEET-SS", sub: "Superspeciality entrance, medicine group" },
    { id: "usmle", tab: "usmle", label: "USMLE", sub: "Clinical vignettes where the bank has them" },
    { id: "fmge", tab: "fmge", label: "FMGE", sub: "Screening test for foreign medical graduates" }
  ];
  var MINUTES = [15, 30, 60, 90, 120];
  /* Blueprints: marks per subject as published. FMGE: NBEMS FMGE October 2026 information bulletin, section 12.2
     (pre and para clinical 100, clinical 200). Radiotherapy (5) has no subject in the bank and is left out. */
  var BLUEPRINT = {
    fmge: { anatomy: 17, physiology: 17, biochemistry: 17, pathology: 13, microbiology: 13, pharmacology: 13, "forensic-medicine": 10,
      medicine: 33, psychiatry: 5, dermatology: 5, surgery: 32, anaesthesia: 5, orthopaedics: 5, radiology: 5, paediatrics: 15,
      ophthalmology: 15, ent: 15, "obstetrics-gynaecology": 30, "community-medicine": 30 }
  };
  var RECENT = 200, RA_MAX = 600, REV_MIN = 0.5;

  function choiceOf(id) { for (var i = 0; i < EXAM_CHOICES.length; i++) if (EXAM_CHOICES[i].id === id) return EXAM_CHOICES[i]; return null; }
  function emptyCfg() { return { ob: 0, exam: null, date: null, min: 30, rem: null }; }
  function needsOnboard(store) { return !(store && store.pl && store.pl.ob); }
  // "YYYY-MM-DD" -> local day number on the same scale as SPECIALTY_CORE.dayNum; null when not a date.
  function dayOfDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null; }
  // Days to the exam: null without a date or once it has passed; 0 on the day.
  function daysLeft(date, today) { var d = dayOfDate(date); return d == null || d < today ? null : d - today; }
  function geo(a, b, c) { return a > 0 && b > 0 && c > 0 ? Math.pow(a * b * c, 1 / 3) : 0; }
  function cardModule(k) { if (k.indexOf("p:") !== 0) return null; var p = k.split(":"); return p.length >= 3 ? p[1] : null; }

  /* readiness({ subjects: [{ id, name, mods: [moduleId] }], weights?, store, today, recent? }) ->
     { score 0-100, cov, ret, acc (0-1), cards, answers, attempted, modules, empty, subjects: [...], weakest: [3] }.
     weights: { subjectId: blueprint marks }; a subject missing from it weighs 0. Without weights a subject weighs
     its module count, so coverage is simply attempted / all modules. */
  function readiness(o) {
    var s = o.store, today = o.today, recent = o.recent || RECENT, modSub = {}, by = {}, tw = 0, list = [];
    o.subjects.forEach(function (sb) {
      var w = o.weights ? (o.weights[sb.id] || 0) : sb.mods.length;
      var r = by[sb.id] = { id: sb.id, name: sb.name, w: w, mods: sb.mods.length, att: 0, rs: 0, cards: 0, ok: 0, n: 0, log: [] };
      sb.mods.forEach(function (m) { modSub[m] = sb.id; });
      tw += w; list.push(r);
    });
    var touched = {};
    Object.keys(s.mod || {}).forEach(function (m) { if (modSub[m] && s.mod[m].t > 0) touched[m] = 1; });
    var R = 0, nc = 0;
    Object.keys(s.cards || {}).forEach(function (k) {
      var m = cardModule(k), sid = m && modSub[m]; if (!sid) return;
      var c = s.cards[k], r = CORE.retrievability(Math.max(0, today - c[2]), c[1]);
      touched[m] = 1; by[sid].rs += r; by[sid].cards++; R += r; nc++;
    });
    Object.keys(touched).forEach(function (m) { by[modSub[m]].att++; });
    // Accuracy: the answer log, newest last; before the log existed, the module totals.
    var log = (s.ra || []).filter(function (e) { return modSub[e[0]]; }), all = log.slice(-recent), ok = 0, n = all.length;
    all.forEach(function (e) { ok += e[1] ? 1 : 0; });
    log.forEach(function (e) { by[modSub[e[0]]].log.push(e[1]); });
    if (!n) Object.keys(s.mod || {}).forEach(function (m) { var x = s.mod[m]; if (modSub[m] && x.t) { n += x.t; ok += x.ok; } });
    var attempted = 0, modules = 0, cov = 0;
    list.forEach(function (r) {
      attempted += r.att; modules += r.mods;
      r.cov = r.mods ? r.att / r.mods : 0;
      cov += tw ? r.w * r.cov / tw : 0;
      r.ret = r.cards ? r.rs / r.cards : 0;
      var sl = r.log.slice(-recent);
      if (sl.length) { r.n = sl.length; r.ok = sl.reduce(function (a, b) { return a + b; }, 0); }
      else { var t = 0, k = 0; Object.keys(s.mod || {}).forEach(function (m) { if (modSub[m] === r.id && s.mod[m].t) { t += s.mod[m].t; k += s.mod[m].ok; } }); r.n = t; r.ok = k; }
      r.acc = r.n ? r.ok / r.n : 0;
      r.score = Math.round(100 * geo(r.cov, r.ret, r.acc));
      delete r.log; delete r.rs;
    });
    var ret = nc ? R / nc : 0, acc = n ? ok / n : 0;
    var weakest = list.filter(function (r) { return r.w > 0; }).sort(function (a, b) { return a.score - b.score || b.w - a.w || (a.id < b.id ? -1 : 1); }).slice(0, 3);
    return { score: Math.round(100 * geo(cov, ret, acc)), cov: cov, ret: ret, acc: acc, cards: nc, answers: n, attempted: attempted, modules: modules,
      empty: !nc && !n, subjects: list, weakest: weakest };
  }

  /* One next step for a subject: the module with the most reviews due; else the weakest module with 5+ answers under
     60% right; else the first module with questions never attempted; else the weakest started module.
     mods: [{ id, title, n }] (n = questions for the exam). -> { k: "due"|"weak"|"start", m, title, n? } or null. */
  function subjectAction(mods, store, today) {
    var due = {}, seen = {};
    Object.keys(store.cards || {}).forEach(function (k) { var m = cardModule(k); if (!m) return; seen[m] = 1; if (store.cards[k][3] <= today) due[m] = (due[m] || 0) + 1; });
    var best = null, weak = null, fresh = null, any = null;
    mods.forEach(function (t) {
      if (!t.n) return;
      var ms = (store.mod || {})[t.id], acc = ms && ms.t ? ms.ok / ms.t : null;
      if (due[t.id] && (!best || due[t.id] > best.n)) best = { k: "due", m: t.id, title: t.title, n: due[t.id] };
      if (acc != null && ms.t >= 5 && acc < 0.6 && (!weak || acc < weak.a)) weak = { k: "weak", m: t.id, title: t.title, a: acc };
      if (!fresh && !seen[t.id] && !(ms && ms.t)) fresh = { k: "start", m: t.id, title: t.title };
      if (acc != null && (!any || acc < any.a)) any = { k: "weak", m: t.id, title: t.title, a: acc };
    });
    var r = best || weak || fresh || any;
    if (r) delete r.a;
    return r;
  }

  /* The first unfinished lesson in the weakest subject that has one. lessons: [{ m, s, title, minutes }];
     order: subject ids, weakest first. */
  function pickLesson(lessons, order, store) {
    var ls = store.ls || {};
    for (var i = 0; i < order.length; i++) for (var j = 0; j < lessons.length; j++) {
      var l = lessons[j];
      if (l.s === order[i] && !(ls[l.m] && ls[l.m].done)) return l;
    }
    return null;
  }

  /* Today's checklist. o: { minutes, due, perQ (minutes a new question), lesson: {m,s,title,minutes}|null,
     mock: {id,label,min}|null (a mini mock), weekend, daysLeft (null = no date), weak: [{ s, m }] }.
     Budget order: due reviews (30 s each, as many as fit), then a weekend mock (every day in the last 14 days) when it
     fits, then the lesson when it fits (not in the last 14 days: revise, do not open new chapters), then new questions
     in the weak modules (at least 5, else none). The list reads reviews, lesson, new questions, mock.
     -> { items: [{ k, n?, min, ... }], total, minutes }. Every total fits the minutes. */
  function planDay(o) {
    var left = o.minutes, rev = null, lesson = null, mock = null, fresh = null, late = o.daysLeft != null && o.daysLeft <= 14;
    if (o.due > 0) {
      var nr = Math.min(o.due, Math.floor(left / REV_MIN));
      if (nr > 0) { rev = { k: "rev", n: nr, min: Math.ceil(nr * REV_MIN) }; left -= rev.min; }
    }
    if (o.mock && (o.weekend || late) && left >= o.mock.min) { mock = { k: "mock", id: o.mock.id, label: o.mock.label, min: o.mock.min }; left -= mock.min; }
    if (o.lesson && !late && left >= o.lesson.minutes) { lesson = { k: "lsn", m: o.lesson.m, s: o.lesson.s, title: o.lesson.title, min: o.lesson.minutes }; left -= lesson.min; }
    var per = o.perQ || 1, nn = Math.floor(left / per);
    if (nn >= 5) { fresh = { k: "new", n: nn, min: Math.ceil(nn * per), mods: (o.weak || []).slice(0, 3) }; left -= fresh.min; }
    var items = [rev, lesson, fresh, mock].filter(Boolean);
    return { items: items, total: items.reduce(function (a, it) { return a + it.min; }, 0), minutes: o.minutes };
  }

  /* Question keys only: "p:<module>:<qid>". Module flashcards (prep-flash.js) live under "p:<module>:c:<cardId>" and
     never count as plan questions; the Flashcards home row shows their due count. */
  function isQ(k) { if (k.indexOf("p:") !== 0) return false; var p = k.split(":"); return !(p.length === 4 && p[2] === "c"); }
  // New questions first answered today (FSRS cards made today with one review).
  function newToday(store, today) { var n = 0; Object.keys(store.cards || {}).forEach(function (k) { var c = store.cards[k]; if (isQ(k) && c[2] === today && c[4] === 1) n++; }); return n; }
  function dueNow(store, today) { var n = 0; Object.keys(store.cards || {}).forEach(function (k) { if (isQ(k) && store.cards[k][3] <= today) n++; }); return n; }
  /* Progress of one plan item: { x, of, done }. Items carry what they were planned against: rev.due0 (due when
     planned), new.base (new answered today when planned). dayOf(ms) -> local day number. */
  function itemProgress(it, store, today, dayOf) {
    if (it.k === "rev") { var x = Math.min(it.n, Math.max(0, (it.due0 || 0) - dueNow(store, today))); return { x: x, of: it.n, done: x >= it.n }; }
    if (it.k === "new") { var y = Math.min(it.n, Math.max(0, newToday(store, today) - (it.base || 0))); return { x: y, of: it.n, done: y >= it.n }; }
    if (it.k === "lsn") { var l = (store.ls || {})[it.m], d = !!(l && l.done && dayOf(l.done) === today); return { x: d ? 1 : 0, of: 1, done: d }; }
    if (it.k === "mock") { var m = (store.mh || []).some(function (h) { return dayOf(h.ts) === today && h.ts >= (it.t0 || 0); }); return { x: m ? 1 : 0, of: 1, done: m }; }
    return { x: 0, of: 1, done: false };
  }
  // The answer log prep.js keeps: [module, 1|0], newest last, at most RA_MAX.
  function noteAnswer(store, mid, ok) { var ra = store.ra || (store.ra = []); ra.push([mid, ok ? 1 : 0]); if (ra.length > RA_MAX) ra.splice(0, ra.length - RA_MAX); }

  var PURE = { EXAM_CHOICES: EXAM_CHOICES, MINUTES: MINUTES, BLUEPRINT: BLUEPRINT, choiceOf: choiceOf, emptyCfg: emptyCfg, needsOnboard: needsOnboard,
    dayOfDate: dayOfDate, daysLeft: daysLeft, geo: geo, readiness: readiness, subjectAction: subjectAction, pickLesson: pickLesson, planDay: planDay,
    newToday: newToday, dueNow: dueNow, itemProgress: itemProgress, noteAnswer: noteAnswer };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var H = null;
  var P = { ob: null, sheet: null };
  var ICO = {
    check: '<path d="M5 12l5 5 9-10"/>', cal: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    redo: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', plus: '<path d="M12 5v14M5 12h14"/>', chev: '<path d="M9 6l6 6-6 6"/>'
  };
  function ic(n) { return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICO[n] + "</svg>"; }
  function esc(s) { return H.esc(s); }
  function store() { return H.store(); }
  function cfg() { var s = store(); if (!s.pl) s.pl = emptyCfg(); return s.pl; }
  function dayOf(ms) { return CORE.dayNum(ms, new Date(ms).getTimezoneOffset()); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function root() { return H.root(); }
  // The exam the readiness and plan are for: the tab, named after the student's own choice when it shares the tab.
  function examLabel() { var tab = H.exam(), c = choiceOf(cfg().exam); return c && c.tab === tab.id ? c.label : tab.label; }
  function examDays() { var c = choiceOf(cfg().exam); return c && c.tab === H.exam().id ? daysLeft(cfg().date, H.today()) : null; }

  /* ---------- readiness from the loaded tree ---------- */
  function examSubjects() {
    var ex = H.exam(), ix = H.ix();
    return H.subjectsOf(ex.id).map(function (sb) {
      var t = ix[sb.id], mods;
      // With the subject's index: modules that have questions for this exam. Before it loads: every module in the tree.
      if (t && t.topics && t.topics.length) mods = t.topics.filter(function (x) { return x.group !== "mixed" && H.pure.countFor(x, ex.id) > 0; }).map(function (x) { return x.id; });
      else { mods = []; sb.sections.forEach(function (sec) { sec.modules.forEach(function (m) { mods.push(m.id); }); }); }
      return { id: sb.id, name: H.tx(sb.name), mods: mods };
    });
  }
  function computeReadiness() { var ex = H.exam(); return readiness({ subjects: examSubjects(), weights: BLUEPRINT[ex.id] || null, store: store(), today: H.today() }); }

  /* ---------- today's plan ---------- */
  function mockFor() {
    var ex = H.exam(), c = choiceOf(cfg().exam), list = H.pure.MOCKS[ex.id] || [], m = list[0];
    list.forEach(function (x) { if (c && x.id === c.id) m = x; });
    if (!m) return null;
    var n = Math.min(50, m.n);
    return { id: m.id, label: m.label, min: Math.round(m.min * n / m.n) };
  }
  // Lessons listed in prep/lessons/v1/index.json, with their subject. [] without prep-lessons.js or offline.
  function lessonList() {
    if (!G.PREP_LESSONS || !G.PREP_LESSONS.index) return Promise.resolve([]);
    return G.PREP_LESSONS.index().then(function (ix) {
      return Object.keys((ix && ix.modules) || {}).map(function (m) { var x = ix.modules[m]; return { m: m, s: H.subjectOfModule(m), title: x.title, minutes: x.minutes || 5 }; }).filter(function (l) { return l.s; });
    }, function () { return []; });
  }
  function makePlan(lessons) {
    var s = store(), td = H.today(), ex = H.exam(), rd = computeReadiness();
    var order = rd.subjects.slice().filter(function (r) { return r.w > 0; }).sort(function (a, b) { return a.score - b.score || b.w - a.w; }).map(function (r) { return r.id; });
    var inExam = {}; order.forEach(function (id) { inExam[id] = 1; });
    var weak = H.pure.weakModules(s, 6).map(function (m) { return { s: H.subjectOfModule(m), m: m }; }).filter(function (x) { return x.s && inExam[x.s]; });
    var wd = new Date().getDay();
    var p = planDay({ minutes: cfg().min || 30, due: dueNow(s, td), perQ: ex.sec / 60, lesson: pickLesson(lessons.filter(function (l) { return inExam[l.s]; }), order, s),
      mock: mockFor(), weekend: wd === 0 || wd === 6, daysLeft: examDays(), weak: weak });
    var due0 = dueNow(s, td), base = newToday(s, td), t0 = Date.now();
    p.items.forEach(function (it) { if (it.k === "rev") it.due0 = due0; if (it.k === "new") it.base = base; if (it.k === "mock") it.t0 = t0; });
    s.pt = { d: td, ex: ex.id, min: cfg().min, items: p.items, total: p.total };
    H.save();
    return s.pt;
  }
  function planValid(s) { return s.pt && s.pt.d === H.today() && s.pt.ex === H.exam().id && s.pt.min === cfg().min; }

  /* ---------- home ---------- */
  function heroHtml(rd) {
    var dl = examDays(), name = examLabel();
    var when = dl == null ? "" : dl === 0 ? "Exam day" : plural(dl, "day", "days") + " to the exam";
    var line = [when, rd.empty ? "Your first answers start it moving" : ""].filter(Boolean).join(". ") || "How this is computed";
    var label = "Readiness " + rd.score + " of 100 for " + name + (when ? ", " + when : "") + ". How this is computed";
    return '<button type="button" class="pl-hero" data-act="p-why" aria-label="' + esc(label) + '"><span class="pl-num" aria-hidden="true">' + rd.score + '<small>/100</small></span>' +
      '<span class="pl-hb" aria-hidden="true"><b>' + esc(name) + " readiness</b><small>" + esc(line) + "</small></span>" + H.ico("chev") + "</button>";
  }
  // The item's one-line name: the plan row, the widget's "next" and the Live Activity.
  function itemTitle(it) {
    return it.k === "rev" ? "Review " + plural(it.n, "due question", "due questions") : it.k === "lsn" ? "Lesson: " + it.title :
      it.k === "new" ? plural(it.n, "new question", "new questions") : "Mini mock: " + String(it.label || "").replace(/ pattern$/, "");
  }
  function itemHtml(it, pr) {
    var t = itemTitle(it), sub, attrs = "";
    if (it.k === "rev") { sub = "About " + it.min + " min" + (pr.x && !pr.done ? " · " + pr.x + " of " + it.n + " done" : ""); }
    else if (it.k === "lsn") { sub = "About " + it.min + " min, then 3 quick questions"; attrs = ' data-s="' + esc(it.s) + '" data-m="' + esc(it.m) + '"'; }
    else if (it.k === "new") { sub = (it.mods && it.mods.length ? "In your weakest modules" : "Where you left off") + " · about " + it.min + " min" + (pr.x && !pr.done ? " · " + pr.x + " of " + it.n + " done" : ""); }
    else { sub = "50 questions, " + it.min + " min, marked like the exam"; }
    var act = it.k === "lsn" ? "l-open" : "p-go";
    return '<li><button type="button" class="pn-row pl-item' + (pr.done ? " done" : "") + '" data-act="' + act + '" data-k="' + it.k + '"' + attrs + '>' +
      '<span class="pl-tick" aria-hidden="true">' + (pr.done ? ic("check") : "") + '</span><span class="pn-rb"><b>' + (pr.done ? '<span class="pl-sr">Done: </span>' : "") + esc(t) + "</b><small>" + esc(sub) + "</small></span>" + H.ico("chev") + "</button></li>";
  }
  function planHtml(pt) {
    if (!pt) return '<div class="pl-plan pl-wait" role="status"><p class="pn-mut pn-small">Working out today\'s plan</p></div>';
    var s = store(), td = H.today(), prs = pt.items.map(function (it) { return itemProgress(it, s, td, dayOf); }), done = prs.filter(function (p) { return p.done; }).length;
    var foot = !pt.items.length ? "Nothing to plan yet for this exam." : done === pt.items.length ? "Today's plan is done. Anything more still counts." : "About " + pt.total + " of your " + pt.min + " minutes";
    return '<div class="pl-plan">' + (pt.items.length ? '<ul class="pn-group pl-list">' + pt.items.map(function (it, i) { return itemHtml(it, prs[i]); }).join("") + "</ul>" : "") +
      '<div class="pl-foot"><span class="pn-mut pn-small">' + esc(foot) + '</span><button type="button" class="pn-link pl-set" data-act="p-settings">Change plan</button></div></div>';
  }
  // Home's top: the readiness line, then Today's plan. Drawn at once from what is known; homeMounted() redraws it
  // once the subject indexes and the lesson index are in.
  function homeHtml(h) {
    H = h;
    var s = store();
    return '<div id="pnPlanTop" class="pl-top">' + heroHtml(computeReadiness()) + '<h2 class="pn-h">Today\'s plan</h2>' + planHtml(planValid(s) ? s.pt : null) + "</div>";
  }
  function homeMounted(h) {
    H = h;
    lessonList().then(function (lessons) {
      var box = root() && root().querySelector("#pnPlanTop");
      if (!box) return;
      var s = store(), pt = planValid(s) ? s.pt : makePlan(lessons);
      box.innerHTML = heroHtml(computeReadiness()) + '<h2 class="pn-h">Today\'s plan</h2>' + planHtml(pt);
      if (G.PREP_NATIVE) G.PREP_NATIVE.changed();
    });
  }
  /* For prep-native.js: { score, exam, daysLeft, items: [{ label, done }], planDay "YYYY-MM-DD" | null }. items = today's
     plan when it is made for today, else []. */
  function snapshot(h) {
    H = h;
    var s = store(), td = H.today(), pt = planValid(s) ? s.pt : null, d = new Date(td * 864e5);
    return { score: computeReadiness().score, exam: examLabel(), daysLeft: examDays(),
      items: pt ? pt.items.map(function (it) { return { label: itemTitle(it), done: itemProgress(it, s, td, dayOf).done }; }) : [],
      planDay: pt ? d.toISOString().slice(0, 10) : null };
  }

  /* ---------- starting an item ---------- */
  function go(k) {
    var s = store(), pt = s.pt; if (!pt) return;
    var it = pt.items.filter(function (x) { return x.k === k; })[0]; if (!it) return;
    var pr = itemProgress(it, s, H.today(), dayOf);
    if (k === "mock") return H.startMock(it.id, "mini");
    if (k === "rev") return startReviews(Math.max(1, it.n - pr.x));
    if (k === "new") return startNew(it, Math.max(5, it.n - pr.x));
  }
  function loadingScreen(t) { H.stack().push(function () {}); H.paint(H.bar(t, "", "back") + '<div class="pn-body"><p class="pn-load" role="status">Loading questions</p></div>'); }
  function loadPairs(pairs) { return Promise.all(pairs.map(function (x) { return H.loadModule(x.s, x.m).then(function (items) { return { s: x.s, m: x.m, items: items }; }, function () { return { s: x.s, m: x.m, items: [] }; }); })); }
  function done(list, title, empty) {
    H.stack().pop();
    if (!list.length) { H.toast(empty); return H.rerender(); }
    H.run(list.slice(0, 50), "study", title);
  }
  // Due reviews, least retrievable first, from the modules with the most due (at most 8 module files).
  function startReviews(n) {
    var s = store(), td = H.today(), by = {};
    Object.keys(s.cards).forEach(function (k) { var m = isQ(k) && k.split(":")[1]; if (m && s.cards[k][3] <= td) by[m] = (by[m] || 0) + 1; });
    var pairs = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (m) { return { s: H.subjectOfModule(m), m: m }; }).filter(function (x) { return x.s; }).slice(0, 8);
    loadingScreen("Reviews");
    loadPairs(pairs).then(function (lists) {
      var out = [];
      lists.forEach(function (l) { H.pool(l.items).forEach(function (it) { var c = s.cards["p:" + l.m + ":" + it.id]; if (c && c[3] <= td) out.push({ it: it, r: CORE.retrievability(Math.max(0, td - c[2]), c[1]) }); }); });
      out.sort(function (a, b) { return a.r - b.r; });
      done(out.slice(0, n).map(function (x) { return x.it; }), "Today's reviews", "Nothing is due. The reviews are done.");
    });
  }
  // New questions at the right level, spread over the planned weak modules; without any, where "solve next" points.
  function startNew(it, n) {
    var s = store(), ex = H.exam(), pairs = (it.mods || []).filter(function (x) { return x.s; });
    var go2 = function (pp) {
      loadingScreen("New questions");
      loadPairs(pp).then(function (lists) {
        var per = Math.ceil(Math.min(n, 50) / Math.max(1, lists.length)), out = [];
        lists.forEach(function (l) { out = out.concat(H.pure.adaptiveNew(H.pure.poolFor(l.items, ex.id, s.hid && s.hid.ids), s.cards, "p:" + l.m, H.pure.targetDifficulty(s.mod[l.m]), per)); });
        done(H.pure.shuffle(out), "New questions", "No new questions left in these modules. Pick a subject below.");
      });
    };
    if (pairs.length) return go2(pairs);
    var subs = H.subjectsOf(ex.id);
    Promise.all(subs.map(function (sb) { return H.loadIndex(sb.id); })).then(function () {
      var nx = H.pure.solveNext(subs, H.ix(), s, H.today(), ex.id);
      if (!nx) return H.toast("Every module is started. Open a subject below.");
      go2([{ s: nx.subject, m: nx.module }]);
    });
  }

  /* ---------- sheets ---------- */
  function openSheet(id, html, label) {
    closeSheet(true);
    var el = G.document.createElement("div");
    el.className = "pn-sheet-wrap"; el.id = "pnPlanSheet";
    el.innerHTML = '<div class="pn-scrim" data-act="p-close"></div><section class="pn-sheet pl-sheet" role="dialog" aria-modal="true" aria-labelledby="' + label + '" tabindex="-1">' + html + "</section>";
    P.sheet = { id: id, prev: G.document.activeElement };
    root().appendChild(el);
    try { el.querySelector(".pn-sheet").focus(); } catch (e) {}
    return el;
  }
  function closeSheet(quiet) {
    var el = root() && root().querySelector("#pnPlanSheet"), s = P.sheet;
    if (el) el.parentNode.removeChild(el);
    P.sheet = null;
    if (!quiet && s && s.prev && s.prev.isConnected) try { s.prev.focus(); } catch (e) {}
  }
  function pct(x) { return Math.round(x * 100); }
  function factor(name, v, line) {
    return '<li class="pl-f"><div class="pl-fh"><b>' + name + '</b><span class="pl-fv">' + pct(v) + '%</span></div><span class="pn-prog" aria-hidden="true"><i style="width:' + pct(v) + '%"></i></span><small>' + line + "</small></li>";
  }
  function actionFor(sid) {
    var ex = H.exam(), t = H.ix()[sid], mods = t && t.topics ? t.topics.filter(function (x) { return x.group !== "mixed"; }).map(function (x) { return { id: x.id, title: H.tx(x.title), n: H.pure.countFor(x, ex.id) }; }) : [];
    return subjectAction(mods, store(), H.today());
  }
  function whySheet() {
    var rd = computeReadiness(), ex = H.exam(), bp = !!BLUEPRINT[ex.id], name = examLabel();
    var weak = rd.weakest.map(function (r) {
      var a = actionFor(r.id), lab = !a ? "Open subject" : a.k === "due" ? "Review " + a.n + " due" : a.k === "weak" ? "Practise " + a.title : "Start " + a.title;
      var detail = !r.att ? "Not started" : pct(r.cov) + "% covered · " + (r.n ? pct(r.acc) + "% right" : "no answers yet");
      return '<li class="pl-w"><div class="pl-wh"><b>' + esc(r.name) + '</b><span class="pl-fv">' + r.score + '</span></div><small class="pn-mut">' + esc(detail) + "</small>" +
        (a ? '<button type="button" class="pn-btn sm" data-act="p-mod" data-s="' + esc(r.id) + '" data-m="' + esc(a.m) + '">' + esc(lab) + "</button>" : '<button type="button" class="pn-btn sm" data-act="p-sub" data-s="' + esc(r.id) + '">Open subject</button>') + "</li>";
    }).join("");
    var html = '<span class="pn-grab" aria-hidden="true"></span><h2 id="pnWhyT">' + esc(name) + " readiness: " + rd.score + "</h2>" +
      '<p class="pn-mut">' + (rd.empty ? "Nothing answered yet, so all three parts are at zero. Each question you answer moves them." : "Three parts, each from 0 to 100%, combined as a geometric mean: a low part pulls the score down more than a high one lifts it.") + "</p>" +
      '<ul class="pl-fs">' +
      factor("Coverage", rd.cov, rd.attempted + " of " + H.fmt(rd.modules) + " modules attempted" + (bp ? ", weighted by the " + esc(name) + " blueprint" : ", each subject weighted by its module count")) +
      factor("Retention", rd.ret, rd.cards ? "Chance you recall the " + H.fmt(rd.cards) + " questions you have seen, today (spaced-review model)" : "No questions seen yet") +
      factor("Accuracy", rd.acc, rd.answers ? "Right in your last " + H.fmt(Math.min(rd.answers, RECENT)) + " answers" : "No answers yet") + "</ul>" +
      '<h3 class="pl-sh">Weakest subjects</h3><ul class="pl-ws">' + weak + "</ul>" +
      '<button type="button" class="pn-btn" data-act="p-close">Close</button>';
    openSheet("why", html, "pnWhyT");
  }

  /* Plan settings (also the onboarding answers): exam, exam date, daily minutes, reminder time. */
  var SET = null;
  function fieldsHtml(c, step) {
    var chip = function (act, v, on, label) { return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="' + act + '" data-v="' + esc(v) + '">' + label + "</button>"; };
    var out = {};
    out.exam = '<div class="pl-opts" role="radiogroup" aria-label="Exam">' + EXAM_CHOICES.map(function (e) {
      var on = c.exam === e.id;
      return '<button type="button" class="pl-opt' + (on ? " on" : "") + '" role="radio" aria-checked="' + on + '" data-act="p-f-exam" data-v="' + e.id + '"><span class="pn-rb"><b>' + esc(e.label) + "</b><small>" + esc(e.sub) + '</small></span><span class="pl-dot" aria-hidden="true">' + (on ? ic("check") : "") + "</span></button>";
    }).join("") + "</div>";
    var d = new Date(H.today() * 864e5), iso = d.toISOString().slice(0, 10);
    out.date = '<label class="pn-sl"><span class="pn-mut pn-small">Exam date</span><input class="pn-in" type="date" id="plDate" name="examDate" min="' + iso + '" value="' + esc(c.date || "") + '"></label>' +
      '<div class="pn-wrap">' + chip("p-f-nodate", "1", !c.date, "Not decided yet") + "</div>";
    out.min = '<div class="pl-opts" role="radiogroup" aria-label="Minutes a day">' + MINUTES.map(function (m) {
      var on = c.min === m;
      return '<button type="button" class="pl-opt' + (on ? " on" : "") + '" role="radio" aria-checked="' + on + '" data-act="p-f-min" data-v="' + m + '"><span class="pn-rb"><b>' + (m < 60 ? m + " min" : m === 60 ? "1 hour" : m === 90 ? "1 h 30 min" : "2 hours") + "</b><small>About " + m + " questions, or reviews and a lesson</small></span><span class=\"pl-dot\" aria-hidden=\"true\">" + (on ? ic("check") : "") + "</span></button>";
    }).join("") + "</div>";
    out.rem = '<label class="pn-sl"><span class="pn-mut pn-small">Reminder time</span><input class="pn-in" type="time" id="plRem" name="reminderTime" value="' + esc(c.rem || "") + '"></label>' +
      '<div class="pn-wrap">' + chip("p-f-norem", "1", !c.rem, "No reminder") + "</div>" +
      (G.PREP_NATIVE ? G.PREP_NATIVE.remHtml(c) : '<p class="pn-mut pn-small">Your reminder time is kept on this phone.</p>');
    return step ? out[step] : out;
  }
  function settingsSheet() {
    SET = JSON.parse(JSON.stringify(cfg()));
    if (!SET.exam) SET.exam = H.exam().id;
    drawSettings(true);
  }
  function drawSettings(first) {
    var f = fieldsHtml(SET);
    var html = '<span class="pn-grab" aria-hidden="true"></span><h2 id="pnSetT">Your plan</h2><div class="pl-setbody">' +
      '<h3 class="pl-sh">Exam</h3>' + f.exam + '<h3 class="pl-sh">Exam date</h3>' + f.date + '<h3 class="pl-sh">Time a day</h3>' + f.min + '<h3 class="pl-sh">Reminder</h3>' + f.rem + (G.PREP_NATIVE ? G.PREP_NATIVE.syncHtml() : "") + "</div>" +
      '<div class="pn-sheet-act"><button type="button" class="pn-btn pri" data-act="p-save">Save</button><button type="button" class="pn-btn" data-act="p-close">Cancel</button></div>';
    if (first) openSheet("set", html, "pnSetT");
    else { var sh = root().querySelector("#pnPlanSheet .pn-sheet"), body = sh && sh.querySelector(".pl-setbody"), y = body ? body.scrollTop : 0; if (sh) sh.innerHTML = html; body = sh && sh.querySelector(".pl-setbody"); if (body) body.scrollTop = y; }
    wireInputs(SET, function () { drawSettings(false); });
  }
  // Native date and time inputs report on change; the chips beside them clear the value.
  function wireInputs(c, redraw) {
    var r = root(), d = r && r.querySelector("#plDate"), t = r && r.querySelector("#plRem");
    if (d) d.addEventListener("change", function () { c.date = dayOfDate(d.value) != null ? d.value : null; redraw(); });
    if (t) t.addEventListener("change", function () { c.rem = /^\d{2}:\d{2}$/.test(t.value) ? t.value : null; redraw(); });
  }
  function apply(c) {
    var s = store(), ch = choiceOf(c.exam);
    s.pl = { ob: 1, exam: ch ? ch.id : null, date: c.date || null, min: MINUTES.indexOf(c.min) >= 0 ? c.min : 30, rem: c.rem || null };
    if (ch) s.exam = ch.tab;
    s.pt = null;
    H.save();
    if (G.PREP_NATIVE) G.PREP_NATIVE.changed();
  }

  /* ---------- onboarding: exam, date, minutes, reminder ---------- */
  var STEPS = [
    ["exam", "Which exam are you preparing for?", "PrepNucleus sets the subjects, the mock pattern and your readiness score by it."],
    ["date", "When is your exam?", "We count the days and turn the last two weeks into revision and mocks."],
    ["min", "How much time a day?", "Today's plan fits into it: due reviews first, then a lesson or new questions."],
    ["rem", "When should we remind you?", "Pick a time that already belongs to study."]
  ];
  function onboard(h) {
    H = h;
    if (!P.ob) P.ob = { i: 0, c: { exam: null, date: null, min: 30, rem: null } };
    var o = P.ob, st = STEPS[o.i], last = o.i === STEPS.length - 1, can = st[0] !== "exam" || !!o.c.exam;
    H.paint(H.bar("PrepNucleus", "Step " + (o.i + 1) + " of 4", "close", '<button type="button" class="pn-link pl-skip" data-act="p-skip">Skip</button>') +
      '<div class="pn-lsn-prog" aria-hidden="true">' + STEPS.map(function (x, i) { return "<i" + (i <= o.i ? ' class="on"' : "") + "></i>"; }).join("") + "</div>" +
      '<div class="pn-body pl-ob"><h2 class="pl-q" id="plQ" tabindex="-1">' + st[1] + '</h2><p class="pn-mut">' + st[2] + "</p>" + fieldsHtml(o.c, st[0]) +
      '<div class="pn-navrow pl-obnav">' + (o.i ? '<button type="button" class="pn-btn" data-act="p-ob-back">Back</button>' : "") +
      '<button type="button" class="pn-btn pri" data-act="p-ob-next"' + (can ? "" : " disabled") + ">" + (last ? "Start preparing" : "Continue") + "</button></div></div>", "#plQ");
    wireInputs(o.c, function () { onboard(H); });
  }
  function finishOnboard(skip) {
    var c = P.ob ? P.ob.c : { exam: null };
    if (skip) apply({ exam: c.exam || null, date: c.date, min: c.min || 30, rem: c.rem });
    else apply(c);
    P.ob = null;
    var stk = H.stack(); stk.length = 0; stk.push(H.home); H.home();
  }

  /* ---------- events ---------- */
  function act(a, b, h) {
    H = h;
    var v = b.getAttribute("data-v");
    if (a === "p-why") return whySheet();
    if (a === "p-settings") return settingsSheet();
    if (a === "p-close") return closeSheet();
    if (a === "p-go") return go(b.getAttribute("data-k"));
    if (a === "p-mod" || a === "p-sub") {
      var sid = b.getAttribute("data-s"), mid = b.getAttribute("data-m");
      closeSheet(true);
      // Hand over to prep.js's own subject and module rows.
      var x = G.document.createElement("button"); x.setAttribute("data-act", mid ? "module" : "subject"); x.setAttribute("data-s", sid); if (mid) x.setAttribute("data-m", mid);
      x.hidden = true; root().appendChild(x); x.click(); if (x.parentNode) x.parentNode.removeChild(x);
      return;
    }
    // Onboarding fields edit P.ob.c; the settings sheet edits SET.
    var c = P.sheet && P.sheet.id === "set" ? SET : P.ob && P.ob.c, redraw = P.sheet && P.sheet.id === "set" ? function () { drawSettings(false); } : function () { onboard(H); };
    if (a.indexOf("p-n-") === 0) return G.PREP_NATIVE && G.PREP_NATIVE.act(a, b, H, c && redraw);
    if (a.indexOf("p-f-") === 0 && c) {
      if (a === "p-f-exam") c.exam = v;
      if (a === "p-f-nodate") c.date = null;
      if (a === "p-f-min") c.min = Number(v);
      if (a === "p-f-norem") c.rem = null;
      return redraw();
    }
    if (a === "p-save") { apply(SET); closeSheet(true); return H.rerender(); }
    if (a === "p-skip") return finishOnboard(true);
    if (a === "p-ob-back") { if (P.ob && P.ob.i) { P.ob.i--; onboard(H); } return; }
    if (a === "p-ob-next") { if (!P.ob) return; if (P.ob.i < STEPS.length - 1) { P.ob.i++; return onboard(H); } return finishOnboard(false); }
  }
  // PREP.back() asks first: a sheet closes; inside onboarding a step goes back.
  function back() {
    if (P.sheet) { closeSheet(); return true; }
    if (P.ob && H && H.stackTop && H.stack().length === 1 && P.ob.i > 0) { P.ob.i--; onboard(H); return true; }
    return false;
  }
  function leave() { P.sheet = null; P.ob = null; SET = null; if (G.PREP_NATIVE) G.PREP_NATIVE.leave(); }

  G.PREP_PLAN = { needsOnboard: needsOnboard, onboard: onboard, homeHtml: homeHtml, homeMounted: homeMounted, snapshot: snapshot, act: act, back: back, leave: leave, noteAnswer: noteAnswer, _pure: PURE, _p: P };
})(typeof window !== "undefined" ? window : this);
