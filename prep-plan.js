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
  // Bound once per element and site; a later call swaps the handler (prep.js PREP_DOM.on: a patched repaint keeps nodes).
  function ON(el, site, type, fn, opts) { if (G.PREP_DOM && G.PREP_DOM.on) return G.PREP_DOM.on(el, site, type, fn, opts); el.addEventListener(type, fn, opts); }
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  var CORE = NODE ? require("./specialty-core.js") : G.SPECIALTY_CORE;

  /* ================= pure ================= */
  // Exams a student can pick; tab = the exam tab in prep.js (INI-CET shares the NEET-PG bank and tab).
  var EXAM_CHOICES = [
    { id: "neet-pg", tab: "neet-pg", label: "NEET-PG", sub: "MD, MS and DNB entrance, 19 MBBS subjects" },
    { id: "ini-cet", tab: "neet-pg", label: "INI-CET", sub: "AIIMS, JIPMER, PGIMER and NIMHANS entrance" },
    { id: "neet-ss", tab: "neet-ss", label: "NEET-SS", sub: "Superspeciality entrance, medicine group" },
    { id: "ini-ss", tab: "neet-ss", label: "INI-SS", sub: "Superspeciality entrance of AIIMS, JIPMER and PGIMER, medicine group" },
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

  /* The first unfinished lesson in the weakest subject that has one. lessons: [{ m, k?, s, title, minutes }] (k: the
     lesson key when it is not the module id, e.g. "radnotes-<section>"; progress is kept per key);
     order: subject ids, weakest first. */
  function pickLesson(lessons, order, store) {
    var ls = store.ls || {};
    for (var i = 0; i < order.length; i++) for (var j = 0; j < lessons.length; j++) {
      var l = lessons[j];
      var lk = l.k || l.m;
      if (l.s === order[i] && !(ls[lk] && ls[lk].done)) return l;
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
    if (o.lesson && !late && left >= o.lesson.minutes) { lesson = { k: "lsn", m: o.lesson.m, s: o.lesson.s, title: o.lesson.title, min: o.lesson.minutes }; if (o.lesson.k && o.lesson.k !== o.lesson.m) lesson.l = o.lesson.k; left -= lesson.min; }
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
    if (it.k === "lsn") { var l = (store.ls || {})[it.l || it.m], d = !!(l && l.done && dayOf(l.done) === today); return { x: d ? 1 : 0, of: 1, done: d }; }
    if (it.k === "mock") { var m = (store.mh || []).some(function (h) { return dayOf(h.ts) === today && h.ts >= (it.t0 || 0); }); return { x: m ? 1 : 0, of: 1, done: m }; }
    return { x: 0, of: 1, done: false };
  }
  // The answer log prep.js keeps: [module, 1|0], newest last, at most RA_MAX.
  function noteAnswer(store, mid, ok) { var ra = store.ra || (store.ra = []); ra.push([mid, ok ? 1 : 0]); if (ra.length > RA_MAX) ra.splice(0, ra.length - RA_MAX); }

  /* Level: XP = 1 per answer, 1 more when it is right, plus lesson XP (all from the store, nothing invented). Level n
     starts at 50 * n * (n - 1) XP (0, 100, 300, 600, 1000...); the rank names a band of levels. */
  var RANKS = [[1, "Fresher"], [3, "Intern"], [5, "Resident"], [8, "Registrar"], [12, "Consultant"]];
  function xpOf(store) {
    var x = 0, k;
    for (k in (store && store.mod) || {}) x += (store.mod[k].t || 0) + (store.mod[k].ok || 0);
    for (k in (store && store.ls) || {}) x += store.ls[k].xp || 0;
    return x;
  }
  function levelOf(xp) {
    var n = 1; while (50 * (n + 1) * n <= xp) n++;
    var lo = 50 * n * (n - 1), hi = 50 * (n + 1) * n, rank = RANKS[0][1];
    RANKS.forEach(function (r) { if (n >= r[0]) rank = r[1]; });
    return { n: n, rank: rank, xp: xp, lo: lo, hi: hi, p: (xp - lo) / (hi - lo) };
  }

  var PURE = { xpOf: xpOf, levelOf: levelOf, EXAM_CHOICES: EXAM_CHOICES, MINUTES: MINUTES, BLUEPRINT: BLUEPRINT, choiceOf: choiceOf, emptyCfg: emptyCfg, needsOnboard: needsOnboard,
    dayOfDate: dayOfDate, daysLeft: daysLeft, geo: geo, readiness: readiness, subjectAction: subjectAction, pickLesson: pickLesson, planDay: planDay,
    newToday: newToday, dueNow: dueNow, itemProgress: itemProgress, noteAnswer: noteAnswer, isQ: isQ };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var H = null;
  var P = { ob: null, sheet: null };
  var ICO = {
    check: '<path d="M5 12l5 5 9-10"/>', cal: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    redo: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    flame: '<path d="M12 21c-3.9 0-7-2.8-7-6.6 0-3.1 2-5.2 3.6-7 .4 1.8 1.5 3 2.6 3.4C11 7.4 12.6 4.6 15 3c-.3 2.6.9 4.4 2.2 6 1.1 1.4 1.8 3 1.8 4.9C19 18 15.9 21 12 21z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>', cap: '<path d="M2 9l10-5 10 5-10 5zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6"/>',
    spark: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>', plus: '<path d="M12 5v14M5 12h14"/>', chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 18l-6-6 6-6"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>'
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
      return Object.keys((ix && ix.modules) || {}).map(function (k) { var x = ix.modules[k], m = x.module || k; return { m: m, k: k, s: H.subjectOfModule(m), title: x.title, minutes: x.minutes || 5 }; }).filter(function (l) { return l.s; });
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
  // The readiness card (2026-10-10 quiet pass): the score and the days to the exam as two figures, one bar for the score,
  // one line. Streak, today's answers and the level moved to "Your progress" lower on home (progressHtml). One button:
  // the whole card opens "How this is computed".
  // Tests 2 (smd_prep_tests2, owner 2026-10-10): "readiness" reads like a chance of passing; with the flag on it is named
  // what it is, a progress score of coverage, retention and accuracy.
  function t2() { return !!(G.PREP_TESTS && G.PREP_TESTS.on && G.PREP_TESTS.on()); }
  function rdWord(cap) { return t2() ? (cap ? "Progress score" : "progress score") : (cap ? "Readiness" : "readiness"); }
  function heroHtml(rd) {
    var dl = examDays(), name = examLabel();
    var when = dl == null ? "" : dl === 0 ? "Exam day" : plural(dl, "day", "days") + " to the exam";
    var line = rd.empty ? "Your first answers start it moving" : "How this is computed";
    var label = rdWord(true) + " " + rd.score + " of 100 for " + name + (when ? ", " + when : "") + ". " + line;
    // Tide pass (prep50): the readiness ring sits on the live background (prep-tide.js) with the nucleus, an amber dot
    // riding the arc's end; the figure counts up with the ring the first time (prep-motion.js). Same data as before.
    var sc = Math.max(0, Math.min(100, rd.score));
    return '<button type="button" class="pl-hero pl-orb" data-act="p-why" aria-label="' + esc(label) + '">' +
      '<span class="pl-ring" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="rt" cx="60" cy="60" r="50" pathLength="100"/>' +
      (sc > 0 ? '<circle class="rv" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="' + sc + ' 100"/>' : "") +
      '<g class="pl-nuc" style="transform:rotate(' + (sc * 3.6).toFixed(1) + 'deg)"><circle cx="110" cy="60" r="6.5"/></g></svg>' +
      '<span class="pl-num">' + rd.score + "<small>/100</small></span></span>" +
      '<span class="pl-hs" aria-hidden="true"><span class="pl-k">' + esc(name).replace(/-/g, "\u2011") + " " + rdWord() + '</span>' +
      '<span class="pl-hd">' + (dl == null ? '<span class="pl-dn pl-dn-none">Exam date not set</span>' : dl === 0 ? '<span class="pl-dn">Exam day</span>' : '<span class="pl-k">Exam in</span> <span class="pl-dn">' + H.fmt(dl) + "<small>" + (dl === 1 ? "day" : "days") + "</small></span>") + "</span>" +
      '<span class="pl-hl"><small>' + esc(line) + "</small>" + H.ico("chev") + "</span></span></button>";
  }
  // Your progress: the secondary figures, from real data only (CORE.streak, today's answers, xpOf/levelOf).
  function progressHtml(h) {
    H = h;
    var s = store(), td = H.today(), streak = CORE && CORE.streak ? CORE.streak(s, td) : 0, todayN = (s.days && s.days[td]) || 0, lv = levelOf(xpOf(s));
    var p = Math.max(0, Math.min(1, lv.p)).toFixed(3);
    return '<h2 class="pn-h">Your progress</h2><div class="pl-prog">' +
      '<div class="pl-pc"><small>Streak</small><b>' + H.fmt(streak) + "<span>" + (streak === 1 ? " day" : " days") + "</span></b></div>" +
      '<div class="pl-pc"><small>Today</small><b>' + H.fmt(todayN) + "<span> answered</span></b></div>" +
      '<div class="pl-pc pl-pclv"><small>Level ' + lv.n + " · " + esc(lv.rank) + "</small><b>" + H.fmt(lv.xp - lv.lo) + "<span> / " + H.fmt(lv.hi - lv.lo) + ' XP</span></b><span class="pl-lvbar" aria-hidden="true"><i style="transform:scaleX(' + p + ')"></i></span></div></div>';
  }
  // Section heads: a small line above each, from real data (today's date for the plan).
  function eyebrow() { try { return new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }); } catch (e) { return ""; } }
  function planHead() { return '<p class="pn-eb" aria-hidden="true">' + esc(eyebrow()) + '</p><h2 class="pn-h">Today\'s plan</h2>'; }
  // The item's one-line name: the plan row, the widget's "next" and the Live Activity.
  function itemTitle(it) {
    return it.k === "rev" ? "Review " + plural(it.n, "due question", "due questions") : it.k === "lsn" ? "Lesson: " + it.title :
      it.k === "new" ? plural(it.n, "new question", "new questions") : "Mini mock: " + String(it.label || "").replace(/ pattern$/, "");
  }
  function itemHtml(it, pr, nextUp) {
    var t = itemTitle(it), sub, attrs = "";
    if (it.k === "rev") { sub = "About " + it.min + " min" + (pr.x && !pr.done ? " · " + pr.x + " of " + it.n + " done" : ""); }
    else if (it.k === "lsn") { sub = "About " + it.min + " min" + (it.l ? "" : ", then 3 quick questions"); attrs = ' data-s="' + esc(it.s) + '" data-m="' + esc(it.m) + '"' + (it.l ? ' data-l="' + esc(it.l) + '"' : ""); }
    else if (it.k === "new") { sub = (it.mods && it.mods.length ? "In your weakest modules" : "Where you left off") + " · about " + it.min + " min" + (pr.x && !pr.done ? " · " + pr.x + " of " + it.n + " done" : ""); }
    else { sub = "50 questions, " + it.min + " min, marked like the exam"; }
    var act = it.k === "lsn" ? "l-open" : "p-go";
    // The first task not yet done is the one filled control on home ("Up next").
    var now = !pr.done && nextUp;
    return '<li><button type="button" class="pn-row pl-item' + (pr.done ? " done" : "") + (now ? " pl-upnext" : "") + '" data-act="' + act + '" data-k="' + it.k + '"' + attrs + '>' +
      '<span class="pl-tick" aria-hidden="true">' + (pr.done ? ic("check") : "") + '</span><span class="pn-rb">' + (now ? '<span class="pl-up">Up next</span>' : "") + "<b>" + (pr.done ? '<span class="pl-sr">Done: </span>' : "") + esc(t) + "</b><small>" + esc(sub) + "</small></span>" + H.ico("chev") + "</button></li>";
  }
  // Balloons the first time a day's plan is ever finished (plan section 2.2), within the one-a-day budget shared with
  // prep.js (store.cel). Recorded once; later finishes keep the plain "Today's plan is done" line.
  function celePlan() {
    var s = store(), td = H.today(), c = s.cel && typeof s.cel === "object" ? s.cel : { day: null, keys: [] }, keys = c.keys || [];
    if (keys.indexOf("plan1") >= 0 || c.day === td) return false;
    s.cel = { day: td, keys: keys.concat(["plan1"]).slice(-200) }; H.save();
    return true;
  }
  function planHtml(pt, live) {
    if (!pt) return '<div class="pl-plan pl-wait" role="status"><p class="pn-mut pn-small">Working out today\'s plan</p></div>';
    var s = store(), td = H.today(), prs = pt.items.map(function (it) { return itemProgress(it, s, td, dayOf); }), done = prs.filter(function (p) { return p.done; }).length;
    var foot = !pt.items.length ? "Nothing to plan yet for this exam." : done === pt.items.length ? "Today's plan is done. Anything more still counts." : "About " + pt.total + " of your " + pt.min + " minutes";
    var cele = !!(live && pt.items.length && done === pt.items.length && celePlan());
    var firstOpen = -1; prs.some(function (p, i) { if (!p.done) { firstOpen = i; return true; } return false; });
    return '<div class="pl-plan"' + (cele ? ' data-cele="balloons"' : "") + ">" + (pt.items.length ? '<ul class="pn-group pl-list">' + pt.items.map(function (it, i) { return itemHtml(it, prs[i], i === firstOpen); }).join("") + "</ul>" : "") +
      '<div class="pl-foot"><span class="pn-mut pn-small">' + esc(foot) + '</span><button type="button" class="pn-link pl-set" data-act="p-settings">Change plan</button></div></div>';
  }
  // Home's top: the readiness line, then Today's plan. Drawn at once from what is known; homeMounted() redraws it
  // once the subject indexes and the lesson index are in.
  function homeHtml(h) {
    H = h;
    var s = store();
    return '<div id="pnPlanTop" class="pl-top">' + heroHtml(computeReadiness()) + planHead() + planHtml(planValid(s) ? s.pt : null) + "</div>";
  }
  function homeMounted(h) {
    H = h;
    lessonList().then(function (lessons) {
      var box = root() && root().querySelector("#pnPlanTop");
      if (!box) return;
      var s = store(), pt = planValid(s) ? s.pt : makePlan(lessons);
      box.innerHTML = heroHtml(computeReadiness()) + planHead() + planHtml(pt, true);
      if (G.PREP_NATIVE) G.PREP_NATIVE.changed();
    });
  }
  /* For prep-native.js and prep-nudges.js: { score, exam, examId, daysLeft, items: [{ label, done, k, x, of, min }],
     planDay "YYYY-MM-DD" | null, weak: { id, name, score } | null }. items = today's plan when it is made for today,
     else []. weak = the weakest blueprint subject the student has answered 5+ questions in. */
  function snapshot(h) {
    H = h;
    var s = store(), td = H.today(), pt = planValid(s) ? s.pt : null, d = new Date(td * 864e5), rd = computeReadiness();
    var w = rd.weakest.filter(function (r) { return r.att > 0 && r.n >= 5; })[0], sb = w && H.subjectById(w.id);
    return { score: rd.score, exam: examLabel(), examId: H.exam().id, daysLeft: examDays(),
      items: pt ? pt.items.map(function (it) { var p = itemProgress(it, s, td, dayOf); return { label: itemTitle(it), done: p.done, k: it.k, x: p.x, of: p.of, min: it.min }; }) : [],
      planDay: pt ? d.toISOString().slice(0, 10) : null,
      weak: sb ? { id: w.id, name: String(sb.name && typeof sb.name === "object" ? sb.name.en || "" : sb.name || ""), score: w.score } : null };
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
  function loadingScreen(t) { H.stack().push(function () {}); H.paint(H.bar(t, "", "back") + '<div class="pn-body"><p class="pn-load" role="status">Loading questions…</p></div>'); }
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
  // Round 5: the readiness sheet is a visual breakdown. A painted band carries the score; three rings (coverage x
  // retention x accuracy, the order of the formula) draw from empty on arrival (CSS, off under reduced motion); each
  // part then has its own line with a meter, then the level and the three weakest subjects with one action each.
  var FAC = [["cov", "Coverage"], ["ret", "Retention"], ["acc", "Accuracy"]];
  function meter(k, label, v) {
    return '<span class="pl-m pl-m-' + k + '"><span class="pl-mr"><svg viewBox="0 0 64 64"><circle class="rt" cx="32" cy="32" r="27" pathLength="100"/>' + (v > 0 ? '<circle class="rv" cx="32" cy="32" r="27" pathLength="100" stroke-dasharray="' + pct(v) + ' 100"/>' : "") + "</svg><b>" + pct(v) + '<small>%</small></b></span><span class="pl-ml">' + label + "</span></span>";
  }
  function factor(k, name, v, line) {
    return '<li class="pl-f pl-f-' + k + '"><div class="pl-fh"><b>' + name + '</b><span class="pl-fv">' + pct(v) + '%</span></div><span class="pn-prog pl-fbar" aria-hidden="true"><i style="transform:scaleX(' + Math.max(0, Math.min(1, v)).toFixed(3) + ')"></i></span><small>' + line + "</small></li>";
  }
  function actionFor(sid) {
    var ex = H.exam(), t = H.ix()[sid], mods = t && t.topics ? t.topics.filter(function (x) { return x.group !== "mixed"; }).map(function (x) { return { id: x.id, title: H.tx(x.title), n: H.pure.countFor(x, ex.id) }; }) : [];
    return subjectAction(mods, store(), H.today());
  }
  function whySheet() {
    var rd = computeReadiness(), ex = H.exam(), bp = !!BLUEPRINT[ex.id], name = examLabel(), lv = levelOf(xpOf(store()));
    var weak = rd.weakest.map(function (r) {
      var a = actionFor(r.id), lab = !a ? "Open subject" : a.k === "due" ? "Review " + a.n + " due" : a.k === "weak" ? "Practise " + a.title : "Start " + a.title;
      var detail = !r.att ? "Not started" : pct(r.cov) + "% covered · " + (r.n ? pct(r.acc) + "% right" : "no answers yet");
      return '<li class="pl-w"><div class="pl-wh"><span class="pn-ic sm" style="--h:' + H.subjHue(r.id) + '" aria-hidden="true">' + H.subjIco(r.id) + '</span><span class="pl-wn"><b>' + esc(r.name) + '</b><small class="pn-mut">' + esc(detail) + '</small></span><span class="pl-fv pl-wsc" aria-label="Score ' + r.score + '">' + r.score + "</span></div>" +
        (a ? '<button type="button" class="pn-btn sm" data-act="p-mod" data-s="' + esc(r.id) + '" data-m="' + esc(a.m) + '">' + esc(lab) + ic("chev") + "</button>" : '<button type="button" class="pn-btn sm" data-act="p-sub" data-s="' + esc(r.id) + '">Open subject' + ic("chev") + "</button>") + "</li>";
    }).join("");
    var html = '<span class="pn-grab" aria-hidden="true"></span>' +
      '<div class="pl-rhead"><h2 id="pnWhyT"><span class="pl-rk">' + esc(name) + " " + rdWord() + '<span class="pl-sr">: </span></span><b class="pl-rnum">' + rd.score + "</b></h2>" +
      '<div class="pl-meters" aria-hidden="true">' + meter("cov", "Coverage", rd.cov) + '<i class="pl-x">\u00d7</i>' + meter("ret", "Retention", rd.ret) + '<i class="pl-x">\u00d7</i>' + meter("acc", "Accuracy", rd.acc) + "</div></div>" +
      '<p class="pn-mut pl-rwhy">' + (rd.empty ? "Nothing answered yet, so all three parts are at zero. Each question you answer moves them." : "Three parts, each from 0 to 100%, combined as a geometric mean: a low part pulls the score down more than a high one lifts it.") + (t2() ? " It measures your preparation in this app; it is not a chance of passing or a predicted exam score." : "") + "</p>" +
      '<ul class="pl-fs">' +
      factor("cov", "Coverage", rd.cov, rd.attempted + " of " + H.fmt(rd.modules) + " modules attempted" + (bp ? ", weighted by the " + esc(name) + " blueprint" : ", each subject weighted by its module count")) +
      factor("ret", "Retention", rd.ret, rd.cards ? "Chance you recall the " + H.fmt(rd.cards) + " questions you have seen, today (spaced-review model)" : "No questions seen yet") +
      factor("acc", "Accuracy", rd.acc, rd.answers ? "Right in your last " + H.fmt(Math.min(rd.answers, RECENT)) + " answers" : "No answers yet") + "</ul>" +
      '<h3 class="pl-sh">Level</h3><div class="pl-rlv"><span class="pl-rlvart" aria-hidden="true"></span><div class="pl-rlvb"><p><b>Level ' + lv.n + "</b> · " + esc(lv.rank) + '</p><span class="pl-lvbar" aria-hidden="true"><i style="transform:scaleX(' + Math.max(0, Math.min(1, lv.p)).toFixed(3) + ')"></i></span>' +
      '<p class="pn-mut pn-small">' + H.fmt(lv.xp) + " XP. You earn 1 XP for each answer, 1 more when it is right, plus lesson XP. Level " + (lv.n + 1) + " starts at " + H.fmt(lv.hi) + " XP.</p></div></div>" +
      (weak ? '<h3 class="pl-sh">Weakest subjects</h3><ul class="pl-ws">' + weak + "</ul>" : "") +
      '<div class="pn-sheet-act"><button type="button" class="pn-btn" data-act="p-close">Close</button></div>';
    openSheet("why", html, "pnWhyT");
  }

  /* Plan settings (also the onboarding answers): exam, exam date, daily minutes, reminder time. */
  var SET = null;
  // Round 6 pickers. The exam and minutes are segmented controls in the settings sheet (onboarding keeps the rows with
  // their explanations); the exam date is a calendar (a cell that opens it in the sheet), the reminder a pair of
  // spin wheels. All are buttons or spinbuttons with arrow keys; the native date and time inputs stay as
  // "Type a date" / "Type a time" for exact entry. Nothing here changes what is stored.
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var WD = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  function isoOf(day) { return new Date(day * 864e5).toISOString().slice(0, 10); }
  function dateLabel(iso) { var d = dayOfDate(iso); if (d == null) return ""; var x = new Date(d * 864e5); return x.getUTCDate() + " " + MON[x.getUTCMonth()].slice(0, 3) + " " + x.getUTCFullYear(); }
  function minLabel(m) { return m < 60 ? m + " min" : m === 60 ? "1 hour" : m === 90 ? "1 h 30 min" : "2 hours"; }
  function segHtml(act, label, opts, cur) {
    return '<div class="pl-seg" role="radiogroup" aria-label="' + label + '">' + opts.map(function (o) {
      var on = String(cur) === String(o[0]);
      return '<button type="button" class="pl-segb' + (on ? " on" : "") + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-act="' + act + '" data-v="' + esc(o[0]) + '">' + o[1] + "</button>";
    }).join("") + "</div>";
  }
  function calHtml(c) {
    var td = H.today(), sel = dayOfDate(c.date), base = new Date((sel != null ? sel : td) * 864e5);
    if (!P.cal) P.cal = { y: base.getUTCFullYear(), m: base.getUTCMonth() };
    var y = P.cal.y, m = P.cal.m, first = Math.floor(Date.UTC(y, m, 1) / 864e5), n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var lead = (new Date(first * 864e5).getUTCDay() + 6) % 7, tdd = new Date(td * 864e5), atMin = y < tdd.getUTCFullYear() || (y === tdd.getUTCFullYear() && m <= tdd.getUTCMonth());
    var focusDay = sel != null && sel >= first && sel < first + n ? sel : td >= first && td < first + n ? td : Math.max(first, td);
    var cells = "";
    for (var i = 0; i < lead; i++) cells += '<span class="pl-cd pl-cd-x" aria-hidden="true"></span>';
    for (var d = 0; d < n; d++) {
      var day = first + d, iso = isoOf(day), past = day < td, on = day === sel;
      cells += '<button type="button" class="pl-cd' + (on ? " on" : "") + (day === td ? " td" : "") + '" data-act="p-f-cal" data-v="' + iso + '" tabindex="' + (day === focusDay ? 0 : -1) + '" aria-pressed="' + on + '"' + (past ? " disabled" : "") +
        ' aria-label="' + WD[(lead + d) % 7] + " " + (d + 1) + " " + MON[m] + " " + y + (day === td ? ", today" : "") + '">' + (d + 1) + "</button>";
    }
    return '<div class="pl-cal"><div class="pl-calh"><button type="button" class="pn-ib pl-calnav" data-act="p-f-calm" data-v="-1" aria-label="Previous month"' + (atMin ? " disabled" : "") + ">" + ic("back") + '</button><b aria-live="polite">' + MON[m] + " " + y + '</b><button type="button" class="pn-ib pl-calnav" data-act="p-f-calm" data-v="1" aria-label="Next month">' + ic("chev") + "</button></div>" +
      '<div class="pl-cwd" aria-hidden="true">' + WD.map(function (w) { return "<span>" + w.charAt(0) + "</span>"; }).join("") + '</div><div class="pl-cgrid" role="group" aria-label="Days of ' + MON[m] + " " + y + '">' + cells + "</div></div>";
  }
  function spin(part, v, max, label, off) {
    var pad = function (x) { return (x < 10 ? "0" : "") + x; }, st = part === "h" ? 1 : 5, pv = (v - st + max) % max, nv = (v + st) % max;
    return '<div class="pl-spin"><button type="button" class="pl-spb" data-act="p-f-t" data-v="' + part + '+1" aria-label="' + label + ' up" tabindex="-1">' + ic("up") + "</button>" +
      '<span class="pl-spw" aria-hidden="true"><i>' + pad(pv) + "</i></span>" +
      '<span class="pl-spv' + (off ? " off" : "") + '" role="spinbutton" tabindex="0" data-spin="' + part + '" aria-label="' + label + '" aria-valuenow="' + v + '" aria-valuemin="0" aria-valuemax="' + (max - st) + '" aria-valuetext="' + (off ? "Off" : pad(v)) + '">' + pad(v) + "</span>" +
      '<span class="pl-spw" aria-hidden="true"><i>' + pad(nv) + "</i></span>" +
      '<button type="button" class="pl-spb" data-act="p-f-t" data-v="' + part + '-1" aria-label="' + label + ' down" tabindex="-1">' + ic("down") + "</button></div>";
  }
  function timeStep(rem, arg) {
    var t = /^(\d{2}):(\d{2})$/.exec(rem || "") || [0, "07", "30"], h = +t[1], m = Math.round(+t[2] / 5) * 5 % 60, d = arg.slice(1) === "+1" ? 1 : arg.slice(1) === "-1" ? -1 : 0;
    if (arg.charAt(0) === "h") h = (h + d + 24) % 24; else m = (m + 5 * d + 60) % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  function fieldsHtml(c, step) {
    var chip = function (act, v, on, label) { return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="' + act + '" data-v="' + esc(v) + '">' + label + "</button>"; };
    var out = {}, ch = choiceOf(c.exam);
    out.exam = step ? '<div class="pl-opts" role="radiogroup" aria-label="Exam">' + EXAM_CHOICES.map(function (e) {
      var on = c.exam === e.id;
      return '<button type="button" class="pl-opt' + (on ? " on" : "") + '" role="radio" aria-checked="' + on + '" data-act="p-f-exam" data-v="' + e.id + '"><span class="pn-rb"><b>' + esc(e.label) + "</b><small>" + esc(e.sub) + '</small></span><span class="pl-dot" aria-hidden="true">' + (on ? ic("check") : "") + "</span></button>";
    }).join("") + "</div>" : segHtml("p-f-exam", "Exam", EXAM_CHOICES.map(function (e) { return [e.id, esc(e.label)]; }), c.exam) + '<p class="pn-mut pn-small pl-segsub">' + esc(ch ? ch.sub : "") + "</p>";
    var d = new Date(H.today() * 864e5), iso = d.toISOString().slice(0, 10), left = c.date ? dayOfDate(c.date) - H.today() : null;
    var exact = '<details class="pl-exact"><summary>Type a date</summary><label class="pn-sl"><span class="pn-mut pn-small">Exam date</span><input class="pn-in" type="date" id="plDate" name="examDate" min="' + iso + '" value="' + esc(c.date || "") + '"></label></details>';
    var calBody = calHtml(c) + '<div class="pn-wrap">' + chip("p-f-nodate", "1", !c.date, "Not decided yet") + "</div>" + exact;
    out.date = step ? calBody :
      '<button type="button" class="pl-cell" data-act="p-f-calopen" aria-expanded="' + !!P.calOpen + '" aria-controls="plCalBox"><span class="pn-rb"><b>' + (c.date ? esc(dateLabel(c.date)) : "Not decided yet") + "</b><small>" + (c.date ? (left > 1 ? "In " + left + " days" : left === 1 ? "Tomorrow" : "Today") : "Pick the day to count down to") + '</small></span><span class="pl-chev" aria-hidden="true">' + ic("chev") + "</span></button>" +
      '<div id="plCalBox" class="pl-calbox' + (P.calJust ? " pl-in" : "") + '"' + (P.calOpen ? "" : " hidden") + ">" + calBody + "</div>";
    out.min = step ? '<div class="pl-opts" role="radiogroup" aria-label="Minutes a day">' + MINUTES.map(function (m) {
      var on = c.min === m;
      return '<button type="button" class="pl-opt' + (on ? " on" : "") + '" role="radio" aria-checked="' + on + '" data-act="p-f-min" data-v="' + m + '"><span class="pn-rb"><b>' + minLabel(m) + "</b><small>About " + m + " questions, or reviews and a lesson</small></span><span class=\"pl-dot\" aria-hidden=\"true\">" + (on ? ic("check") : "") + "</span></button>";
    }).join("") + "</div>" : segHtml("p-f-min", "Minutes a day", MINUTES.map(function (m) { return [m, m < 60 ? m + " min" : m === 60 ? "1 h" : m === 90 ? "1 h 30" : "2 h"]; }), c.min) + '<p class="pn-mut pn-small pl-segsub">About ' + c.min + " questions, or reviews and a lesson.</p>";
    var rt = /^(\d{2}):(\d{2})$/.exec(c.rem || "") || [0, "07", "30"];
    out.rem = '<div class="pl-time' + (c.rem ? "" : " off") + '" role="group" aria-label="Reminder time">' + spin("h", +rt[1], 24, "Hour", !c.rem) + '<b class="pl-tsep" aria-hidden="true">:</b>' + spin("m", Math.round(+rt[2] / 5) * 5 % 60, 60, "Minutes", !c.rem) + "</div>" +
      '<div class="pn-wrap">' + chip("p-f-norem", "1", !c.rem, "No reminder") + "</div>" +
      '<details class="pl-exact"><summary>Type a time</summary><label class="pn-sl"><span class="pn-mut pn-small">Reminder time</span><input class="pn-in" type="time" id="plRem" name="reminderTime" value="' + esc(c.rem || "") + '"></label></details>' +
      (G.PREP_NATIVE ? G.PREP_NATIVE.remHtml(c, !step) : '<p class="pn-mut pn-small">Your reminder time is kept on this phone.</p>');
    return step ? out[step] : out;
  }
  function settingsSheet() {
    SET = JSON.parse(JSON.stringify(cfg())); P.cal = null; P.calOpen = false;
    if (!SET.exam) SET.exam = H.exam().id;
    drawSettings(true);
  }
  function drawSettings(first) {
    var f = fieldsHtml(SET);
    var ch = choiceOf(SET.exam), mins = SET.min < 60 ? SET.min + " min" : SET.min === 60 ? "1 hour" : SET.min === 90 ? "1 h 30 min" : "2 hours";
    var sec = function (k, icon, title, body) { return '<section class="pl-grp pl-g-' + k + '"><h3 class="pl-sh"><span class="pl-sic" aria-hidden="true">' + ic(icon) + "</span>" + title + "</h3>" + body + "</section>"; };
    var html = '<span class="pn-grab" aria-hidden="true"></span><div class="pl-shead"><span class="pl-shart" aria-hidden="true"></span><div><h2 id="pnSetT">Your plan</h2><p class="pn-mut pn-small">' + esc((ch ? ch.label : "Your exam") + " · " + mins + " a day" + (SET.rem ? " · reminder " + SET.rem : "")) + '</p></div></div><div class="pl-setbody">' +
      sec("exam", "cap", "Exam", f.exam) + sec("date", "cal", "Exam date", f.date) + sec("min", "clock", "Time a day", f.min) + sec("rem", "bell", "Reminder", f.rem) + (G.PREP_ASK ? G.PREP_ASK.settingsHtml(H) : "") + (G.PREP_NATIVE ? G.PREP_NATIVE.syncHtml() : "") + "</div>" +
      '<div class="pn-sheet-act"><button type="button" class="pn-btn pri" data-act="p-save">Save</button><button type="button" class="pn-btn" data-act="p-close">Cancel</button></div>';
    if (first) openSheet("set", html, "pnSetT");
    else {
      // Patched in place (native pass 2): the scroller is the same node, so it never jumps; rebuilt only without prep.js.
      var sh = root().querySelector("#pnPlanSheet .pn-sheet"), body = sh && sh.querySelector(".pl-setbody"), y = body ? body.scrollTop : 0;
      if (sh && G.PREP_DOM) G.PREP_DOM.patch(sh, html);
      else if (sh) { sh.innerHTML = html; body = sh.querySelector(".pl-setbody"); if (body) body.scrollTop = y; }
    }
    wireInputs(SET, function () { drawSettings(false); });
    if (G.PREP_NATIVE && G.PREP_NATIVE.wire) G.PREP_NATIVE.wire(root());
  }
  // Native date and time inputs report on change; the chips beside them clear the value.
  function wireInputs(c, redraw) {
    var r = root(), d = r && r.querySelector("#plDate"), t = r && r.querySelector("#plRem");
    if (d) ON(d, "pl", "change", function () { c.date = dayOfDate(d.value) != null ? d.value : null; P.cal = null; redraw(); });
    if (t) ON(t, "pl", "change", function () { c.rem = /^\d{2}:\d{2}$/.test(t.value) ? t.value : null; redraw(); });
    var box = r && (r.querySelector("#pnPlanSheet .pl-setbody") || r.querySelector(".pl-ob"));
    if (box) ON(box, "pl", "keydown", function (e) { pickKey(e, c, redraw); });
  }
  // After a picker redraws, the same control (or the new day) keeps the focus.
  function refocus(sel) { var r = root(), el = r && r.querySelector(sel); if (el) try { el.focus(); } catch (e) {} }
  // Arrow keys: days move by one or a week (Page Up and Down by a month), segments move the choice, spin wheels step.
  function pickKey(e, c, redraw) {
    var t = e.target, k = e.key, act = t.getAttribute && t.getAttribute("data-act");
    if (act === "p-f-cal") {
      var dd = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[k], day = dayOfDate(t.getAttribute("data-v"));
      if (!dd && (k === "PageUp" || k === "PageDown")) { e.preventDefault(); P.cal.m += k === "PageUp" ? -1 : 1; normCal(); redraw(); var b0 = root().querySelector(".pl-cgrid [tabindex='0']"); if (b0) b0.focus(); return; }
      if (!dd) return;
      e.preventDefault();
      var nd = day + dd; if (nd < H.today()) return;
      var x = new Date(nd * 864e5);
      if (x.getUTCMonth() !== P.cal.m || x.getUTCFullYear() !== P.cal.y) { P.cal = { y: x.getUTCFullYear(), m: x.getUTCMonth() }; redraw(); }
      var nb = root().querySelector('[data-act=p-f-cal][data-v="' + isoOf(nd) + '"]');
      if (nb) { Array.prototype.forEach.call(root().querySelectorAll(".pl-cgrid [tabindex='0']"), function (o) { o.tabIndex = -1; }); nb.tabIndex = 0; nb.focus(); }
      return;
    }
    if (t.hasAttribute && t.hasAttribute("data-spin") && (k === "ArrowUp" || k === "ArrowDown")) {
      e.preventDefault(); var part = t.getAttribute("data-spin");
      c.rem = timeStep(c.rem, part + (k === "ArrowUp" ? "+1" : "-1")); redraw(); refocus('[data-spin="' + part + '"]'); return;
    }
    if (t.classList && t.classList.contains("pl-segb")) {
      var step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[k]; if (!step) return;
      e.preventDefault();
      var bs = Array.prototype.slice.call(t.parentNode.querySelectorAll(".pl-segb")), i = (bs.indexOf(t) + step + bs.length) % bs.length;
      bs[i].click();
    }
  }
  function normCal() { while (P.cal.m < 0) { P.cal.m += 12; P.cal.y--; } while (P.cal.m > 11) { P.cal.m -= 12; P.cal.y++; } var td = new Date(H.today() * 864e5); if (P.cal.y * 12 + P.cal.m < td.getUTCFullYear() * 12 + td.getUTCMonth()) P.cal = { y: td.getUTCFullYear(), m: td.getUTCMonth() }; }
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
    if (!P.ob) { P.ob = { i: 0, c: { exam: null, date: null, min: 30, rem: null } }; P.cal = null; }
    var o = P.ob, st = STEPS[o.i], last = o.i === STEPS.length - 1, can = st[0] !== "exam" || !!o.c.exam;
    H.paint('<div class="pn-sky" aria-hidden="true"></div>' + H.bar("PrepNucleus", "Step " + (o.i + 1) + " of 4", "close", st[0] === "exam" ? "" : '<button type="button" class="pn-link pl-skip" data-act="p-skip">Skip</button>') +
      '<div class="pn-lsn-prog" aria-hidden="true">' + STEPS.map(function (x, i) { return "<i" + (i <= o.i ? ' class="on"' : "") + "></i>"; }).join("") + "</div>" +
      '<div class="pn-body pl-ob"><img class="pl-art" src="/prep/art/ob-' + st[0] + '.webp" alt="" width="640" height="640" decoding="async"><h2 class="pl-q" id="plQ" tabindex="-1">' + st[1] + '</h2><p class="pn-mut">' + st[2] + "</p>" + fieldsHtml(o.c, st[0]) +
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
      if (a === "p-f-cal") c.date = v;
      if (a === "p-f-calm") { P.cal.m += Number(v); normCal(); }
      if (a === "p-f-calopen") { P.calOpen = !P.calOpen; P.calJust = P.calOpen; }
      if (a === "p-f-t") c.rem = timeStep(c.rem, v);
      redraw(); P.calJust = false;
      // The control that was pressed keeps the focus; a pressed day keeps it on that day.
      if (a === "p-f-calm") refocus('[data-act=p-f-calm][data-v="' + v + '"]:not([disabled])');
      else if (a === "p-f-t") refocus('[data-spin="' + v.charAt(0) + '"]');
      else refocus('[data-act="' + a + '"]' + (a === "p-f-calopen" ? "" : '[data-v="' + v + '"]'));
      return;
    }
    if (a === "p-save") { apply(SET); closeSheet(true); return H.rerender(); }
    if (a === "p-skip") return finishOnboard(true);
    if (a === "p-ob-back") { if (P.ob && P.ob.i) { P.ob.i--; if (H.nav) H.nav(-1); onboard(H); } return; }
    if (a === "p-ob-next") { if (!P.ob) return; if (P.ob.i < STEPS.length - 1) { P.ob.i++; if (H.nav) H.nav(1); return onboard(H); } return finishOnboard(false); }
  }
  // PREP.back() asks first: a sheet closes; inside onboarding a step goes back.
  function back() {
    if (P.sheet) { closeSheet(); return true; }
    if (P.ob && H && H.stackTop && H.stack().length === 1 && P.ob.i > 0) { P.ob.i--; onboard(H); return true; }
    return false;
  }
  function leave() { P.sheet = null; P.ob = null; SET = null; if (G.PREP_NATIVE) G.PREP_NATIVE.leave(); }

  G.PREP_PLAN = { needsOnboard: needsOnboard, onboard: onboard, homeHtml: homeHtml, progressHtml: progressHtml, homeMounted: homeMounted, snapshot: snapshot, act: act, back: back, leave: leave, noteAnswer: noteAnswer, _pure: PURE, _p: P };
})(typeof window !== "undefined" ? window : this);
