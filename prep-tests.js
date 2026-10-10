/* PrepNucleus Tests 2 (Tests & Assessment Engine M1, 2026-10-10): the Tests tab's test types on the official exam
   profiles. window.PREP_TESTS. ES5. Flag smd_prep_tests2, default OFF: localStorage smd_prep_tests2 = "1" or ?tests2=1
   turns it on ("0" / ?tests2=0 off). Off, the Tests tab is exactly as before (prep.js MOCKS, one overall timer).

   On, the Tests segment lists, for the exam tab:
   - an interrupted test to resume (saved in IndexedDB "prep-bank" / "files" under run:t2 at every answer and every 5 s);
   - Daily 10: exactly 10 questions at the exam's own pace (10 x seconds a question), the same 10 all day (seed = exam +
     IST date), counted once a day (prep-assess.js dailyComplete; a retry is practice);
   - one card per exam profile (prep/assess/profiles via prep-profiles.js): the full exam in its official locked timed
     sections (NEET-PG 180 = 5 x 36 x 42 min; INI-CET 200 = 4 x 50 x 45 min; FMGE 2 parts x 3 x 50 x 50 min; NEET-SS
     150 = 3 x 50 x 50 min; USMLE Step 1 blocks of 20 in 30 min), one section, one FMGE part; INI-SS only as a labelled
     provisional pattern; the NEET-PG pattern of earlier years (200 questions, one timer) as "previous format practice";
   - practice tests: subject, topic, adaptive diagnostic, Today's set, weak areas, My mistakes, custom and the previous
     year papers (NEET-PG), each only when it has questions.
   A card shows the count, the time, the exam, the scope and the completion status. Before a test starts, a screen says
   what the assembly found: the size (reduced, and why, when the bank cannot fill the blueprint) and every deviation.
   Image-based and case-based test types are not offered yet: the bank index has no count of image items and items carry
   no case flag (the type filter inside a set still works). The runner, marking, timer line and review are prep.js's. */
(function (G) {
  "use strict";
  var A = G.PREP_ASSESS, D = G.document, FLAG = "smd_prep_tests2", RUN_KEY = "run:t2", REC_KEY = "t2r:";
  var P = { sess: undefined, sessP: null, cov: {}, qual: null, qualP: null, lastSave: 0, pick: null };
  var H = null;

  function on() {
    try { var q = (G.location.search.match(/[?&]tests2=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; return G.localStorage.getItem(FLAG) === "1"; } catch (e) { return false; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function mins(sec) { var m = Math.round(sec / 60), h = Math.floor(m / 60), r = m % 60; return (h ? h + " h" : "") + (h && r ? " " : "") + (r || !h ? r + " min" : ""); }
  function mark(x) { x = Math.abs(x); return Math.abs(x - 1 / 3) < 1e-6 ? "1/3" : String(Math.round(x * 100) / 100); }
  function marking(p) { var sc = p.scoring; return "+" + mark(sc.correct) + " right, " + (sc.incorrect ? "minus " + mark(sc.incorrect) + " wrong" : "no negative marking") + ", unanswered 0"; }
  function store() { var s = H.store(); if (!s.t2h || !Array.isArray(s.t2h)) s.t2h = []; if (!s.t2d || typeof s.t2d !== "object") s.t2d = {}; return s; }
  function tab() { return H.exam().id; }
  // The student's exam within the tab (plan choice: INI-CET on the NEET-PG tab, INI-SS on NEET-SS, USMLE = Step 1).
  function primary() {
    var s = H.store(), ch = s.pl && s.pl.exam, list = A.forTab(tab()).filter(function (p) { return p.status === "official" || p.id !== "ini-ss"; });
    var id = ch === "usmle" ? "usmle-step1" : ch;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || A.forTab(tab())[0] || null;
  }
  function srcLine(p) {
    var keys = Object.keys(p.sources || {});
    if (p.status !== "official" && !keys.length) return "Provisional: no official document; pattern from secondary sources.";
    var s0 = p.sources[keys[0]];
    return (p.status === "official" ? "Official format: " : "Provisional: format from ") + s0.title + ", checked " + dmy(p.verified_on) + "." + (p.status === "official" ? "" : " Some rules are not stated there and are assumed.");
  }
  function dmy(iso) { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); } catch (e) { return iso; } }
  function dm(ts) { try { return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch (e) { return ""; } }
  function typeName(t) { return { grand: "Full exam", part: "One part", mini: "One section", daily10: "Daily 10", subject_mini: "Subject test", topic: "Topic test", diagnostic: "Adaptive diagnostic", custom: "Custom" }[t] || t; }
  function lastOf(pid, type) { var h = store().t2h, r = null; h.forEach(function (x) { if (x.exam === pid && x.type === type) r = x; }); return r; }

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
      H.run(u.items, pk.mode, pk.title, { t2: pk.t2, sections: pk.t2.sections, limit: pk.limit || 0, scheme: p ? A.scheme(p) : null, resume: { i: pk.i, ans: pk.ans, mark: pk.mark, ms: pk.ms, changed: pk.changed, t0: pk.t0, sc: pk.sc, phase: pk.phase } });
    });
  }

  /* ---------- the Tests segment ---------- */
  function card(p, H0) {
    var f = p.format, secs = f.sections, n1 = secs[0], parts = f.parts, prov = p.status !== "official";
    var shape = p.id === "usmle-step1" ? "Blocks of up to " + f.block_max_items + " questions, " + n1.minutes + " min each; the full exam has " + secs.length + " blocks"
      : parts ? f.questions + " questions in " + parts + " parts of " + (f.questions / parts) + ", each in " + (secs.length / parts) + " locked sections of " + n1.questions + " questions and " + n1.minutes + " min"
      : secs.length > 1 ? f.questions + " questions in " + secs.length + " locked sections of " + n1.questions + " questions and " + n1.minutes + " min"
      : f.questions + " questions, " + mins(f.duration_min * 60);
    var pass = p.scoring.pass ? " Pass mark " + p.scoring.pass.marks + " of " + p.scoring.pass.of + "." : "";
    var bG = A.blueprint(p, "grand"), bM = A.blueprint(p, "mini"), bP = A.blueprint(p, "part");
    function btn(type, b, label, pri) { var l = lastOf(p.id, type); return '<button type="button" class="pn-btn' + (pri ? " pri" : "") + '" data-act="t2-pre" data-p="' + p.id + '" data-k="' + type + '" data-need="' + b.min_viable + '">' + H.ico("clock") + " " + esc(label) + (l ? '<small class="pn-t2last">Last ' + esc(fmtMarks(l.raw)) + " of " + l.max + " · " + dm(l.ts) + "</small>" : "") + "</button>"; }
    var btns = "";
    if (p.id === "usmle-step1") btns = btn("mini", bM, "One block: " + bM.count + " questions, " + mins(bM.duration_sec), true) + btn("grand", bG, "Full exam: " + bG.count + " questions, " + mins(bG.duration_sec));
    else {
      btns = btn("grand", bG, (prov ? "Practice test: " : "Full exam: ") + bG.count + " questions, " + mins(bG.duration_sec), true);
      if (bP) btns += btn("part", bP, "One part: " + bP.count + " questions, " + mins(bP.duration_sec));
      if (bM) btns += btn("mini", bM, "One section: " + bM.count + " questions, " + mins(bM.duration_sec));
    }
    var prev = p.legacy_mock && p.id === "neet-pg" ? '<button type="button" class="pn-link pn-t2prev" data-act="t2-legacy" data-v="' + p.legacy_mock.id + '">Previous format practice: ' + p.legacy_mock.n + " questions, one timer</button>" : "";
    return '<section class="pn-panel pn-t2c" data-p="' + p.id + '"><div class="pn-t2h"><p class="pn-big pn-mid">' + esc(p.name) + '</p><span class="pn-t2b' + (prov ? " prov" : "") + '">' + (prov ? "Provisional" : "Official format") + "</span></div>" +
      '<p class="pn-mut">' + esc(shape) + ". " + esc(marking(p)) + "." + pass + "</p>" + btns + prev +
      '<p class="pn-mut pn-small pn-t2src">' + esc(srcLine(p)) + (p.blueprint.kind === "official_counts" ? " Subject quotas from the official blueprint." : " No official subject split: questions are spread across the subjects in proportion to the bank.") + "</p></section>";
  }
  function fmtMarks(x) { return String(Math.round(x * 100) / 100); }
  function dailyHtml(p) {
    var b = A.blueprint(p, "daily10"), key = A.dailyKey(p.id, Date.now()), d = store().t2d[key];
    return '<section class="pn-panel pn-t2d" data-p="' + p.id + '"><div class="pn-t2h"><p class="pn-t2eb">Daily 10</p>' + (d ? '<span class="pn-t2b ok">' + H.ico("check") + " Done today</span>" : '<span class="pn-t2b">Not done today</span>') + "</div>" +
      '<p class="pn-big pn-mid">10 questions · about ' + mins(b.duration_sec) + "</p>" +
      '<p class="pn-mut">' + esc(p.name) + " pace (" + b.pace + " s a question) and marking. Mixed subjects; the same 10 all day.</p>" +
      (d ? '<p class="pn-mut pn-small">Today: ' + d.correct + " of 10 right, " + fmtMarks(d.raw) + " of " + d.max + " marks. A retry is practice and is not counted again.</p>" : "") +
      '<button type="button" class="pn-btn' + (d ? "" : " pri") + '" data-act="t2-pre" data-p="' + p.id + '" data-k="daily10" data-need="10">' + H.ico("play") + (d ? " Practise again" : " Start Daily 10") + "</button></section>";
  }
  function practiceHtml(p) {
    var s = H.store(), pt = H.planToday(), mt = Object.keys(s.mt || {}).length, wk = pt.weak.length;
    var rows = H.row("t2-pick", H.ico("grid"), "Subject test", "20 questions from one subject, " + esc(p.name) + " marking", ' data-k="subject_mini" data-p="' + p.id + '"') +
      H.row("t2-pick", H.ico("search"), "Topic test", "Up to 20 questions from one topic", ' data-k="topic" data-p="' + p.id + '"') +
      H.row("t2-pre", H.ico("bolt"), "Adaptive diagnostic", "20 questions across subjects, from your own history", ' data-k="diagnostic" data-p="' + p.id + '" data-need="5"') +
      (pt.due || pt.left ? H.row("t2-plan", H.ico("play"), "Today's set", (pt.due ? H.fmt(pt.due) + " reviews due, then new" : "Up to 20 new questions") + ", marked as you go") : "") +
      (wk || mt ? H.row("t2-weak", H.ico("flag"), "Weak areas", (wk ? wk + (wk === 1 ? " weak module" : " weak modules") : "") + (wk && mt ? " and " : "") + (mt ? H.fmt(mt) + " mistakes" : "")) : "") +
      (mt ? H.row("t2-mistakes", H.ico("x"), "My mistakes", H.fmt(mt) + " to fix") : "") +
      H.row("t2-custom", H.ico("plus"), "Custom test", "Your own mix of subjects and count");
    return '<h2 class="pn-h">Practice tests</h2><div class="pn-group pn-t2p">' + rows + "</div>";
  }
  function testsHtml(h) {
    H = h;
    var list = A.forTab(tab()), p0 = primary(), s = H.store();
    if (!p0) return '<p class="pn-empty">No exam profile for this exam yet.</p>';
    var pyq = G.PREP_PYQ && tab() === "neet-pg" ? '<div class="pn-group">' + G.PREP_PYQ.homeRow(H) + "</div>" : "";
    return '<div id="pnT2Res">' + (P.sess && P.sess.t2 && !P.sess.done ? resumeHtml(P.sess) : "") + "</div>" + dailyHtml(p0) +
      '<h2 class="pn-h">Exam simulations</h2>' + list.map(function (p) { return card(p); }).join("") + pyq + practiceHtml(p0) +
      '<p class="pn-mut pn-small" id="pnT2Note">Every test shows its size, time and scope before it starts. When the bank cannot fill a blueprint the test is shortened and says why; it is never padded with unrelated questions. Results use the exam\'s marking only: no rank, percentile or predicted score.</p>';
  }
  // After paint: the saved session, then coverage (subject indexes) hides tests the bank cannot fill.
  function mounted(h) {
    H = h;
    loadSess().then(function (pk) {
      var box = H.root() && H.root().querySelector("#pnT2Res");
      if (box) box.innerHTML = pk && pk.t2 ? resumeHtml(pk) : "";
    });
    var subs = H.subjectsOf(tab());
    Promise.all(subs.map(function (sb) { return H.loadIndex(sb.id); })).then(function () {
      var root = H.root(); if (!root) return;
      var ex = tab(), total = 0, ix = H.ix();
      subs.forEach(function (sb) { var x = ix[sb.id]; if (x) x.topics.forEach(function (t) { if (t.group !== "mixed") total += H.pure.countFor(t, ex); }); });
      P.cov[ex] = total;
      Array.prototype.forEach.call(root.querySelectorAll("[data-act=t2-pre][data-need]"), function (b) {
        if (total < Number(b.getAttribute("data-need"))) { b.disabled = true; b.setAttribute("aria-disabled", "true"); var sm = D.createElement("small"); sm.className = "pn-t2last"; sm.textContent = "Not enough questions in the bank yet"; b.appendChild(sm); }
      });
    });
  }

  /* ---------- pickers ---------- */
  function pickSubject(p, type) {
    H.push(function () {
      var subs = H.subjectsOf(tab()), ix = H.ix(), ex = tab();
      var rows = subs.map(function (sb) {
        var n = 0, x = ix[sb.id]; if (x) x.topics.forEach(function (t) { if (t.group !== "mixed") n += H.pure.countFor(t, ex); });
        if (x && !n) return "";
        return H.row(type === "topic" ? "t2-pickm" : "t2-pre", '<span class="pn-ic sm" style="--h:' + H.subjHue(sb.id) + '">' + H.subjIco(sb.id) + "</span>", H.tx(sb.name), x ? H.fmt(n) + " questions" : "", ' data-p="' + p.id + '" data-k="' + type + '" data-s="' + esc(sb.id) + '" data-need="5"');
      }).join("");
      H.paint(H.bar(typeName(type), esc(p.name), "back") + '<div class="pn-body"><p class="pn-mut">' + (type === "topic" ? "Pick a subject, then a topic." : "Pick a subject. 20 questions, " + esc(marking(p)) + ", " + A.paceSec(p) + " s a question.") + '</p><div class="pn-group">' + rows + "</div></div>");
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

  /* ---------- assembly and the pre-test screen ---------- */
  function seenMap() { var s = H.store(), out = {}; Object.keys(s.cards || {}).forEach(function (k) { var p = k.split(":"); if (p.length === 3) out[p[2]] = 1; }); return out; }
  function histBySubject() {
    var s = H.store(), out = {};
    Object.keys(s.mod || {}).forEach(function (m) { var sid = H.subjectOfModule(m); if (!sid) return; var o = out[sid] || (out[sid] = { t: 0, ok: 0 }); o.t += s.mod[m].t || 0; o.ok += s.mod[m].ok || 0; });
    return out;
  }
  // Item-quality sidecar (reader only): /api/prep/bank/quality/index.json names versioned per-subject files; none = {}.
  function loadQuality(subs) {
    if (G.SMD_PREP_QUALITY) return Promise.resolve(A.readQuality(G.SMD_PREP_QUALITY));
    if (!P.qualP) P.qualP = H.getJSON(H.bankApi + "quality/index.json").then(function (ix) { return ix && ix.subjects ? ix : null; }, function () { return null; });
    return P.qualP.then(function (ix) {
      if (!ix) return {};
      return Promise.all(subs.filter(function (s) { return ix.subjects[s]; }).map(function (s) { return H.getJSON(H.bankApi + "quality/" + ix.subjects[s]).then(A.readQuality, function () { return {}; }); }))
        .then(function (maps) { var out = {}; maps.forEach(function (m) { for (var k in m) out[k] = m[k]; }); return out; });
    });
  }
  // Which module files to load for a test: per subject, enough modules for its share (bank counts), seeded.
  function modulePairs(p, type, opts, R) {
    var ex = tab(), ix = H.ix(), subs = opts.subjects || H.subjectsOf(ex).map(function (s) { return s.id; });
    if (opts.module) return [{ s: opts.subjects[0], m: opts.module }];
    var per = {}, mods = {};
    subs.forEach(function (sid) { var x = ix[sid]; mods[sid] = (x ? x.topics.filter(function (t) { return t.group !== "mixed" && H.pure.countFor(t, ex) > 0; }) : []); });
    var b = A.blueprint(p, type, {}), want = b ? b.count : 20, files;
    if (type === "daily10" || type === "diagnostic") {
      var order = subs.filter(function (s) { return mods[s].length; });
      order = shuffleR(order, R);
      if (type === "diagnostic") { var hs = histBySubject(); order.sort(function (a, c) { var x = hs[a] || { t: 0 }, y = hs[c] || { t: 0 }; return (x.t >= 5 ? 1 : 0) - (y.t >= 5 ? 1 : 0) || (x.t >= 5 ? x.ok / x.t - y.ok / y.t : x.t - y.t); }); }
      return order.slice(0, type === "daily10" ? 10 : 10).map(function (s) { var l = mods[s]; return { s: s, m: l[Math.floor(R() * l.length)].id }; });
    }
    files = Math.max(4, Math.min(36, Math.ceil(want / 6)));
    var tot = 0; subs.forEach(function (s) { per[s] = 0; mods[s].forEach(function (t) { per[s] += H.pure.countFor(t, ex); }); tot += per[s]; });
    var wt = {}; if (p.blueprint.kind === "official_counts" && !opts.subjects) subs.forEach(function (s) { wt[s] = p.blueprint.subjects[s] || 0; }); else wt = per;
    var k = A.apportion(files, wt), out = [];
    subs.forEach(function (s) { var n = Math.max(wt[s] > 0 && mods[s].length ? 1 : 0, Math.min(k[s] || 0, mods[s].length)); shuffleR(mods[s].slice(), R).slice(0, n).forEach(function (t) { out.push({ s: s, m: t.id }); }); });
    return out;
  }
  function shuffleR(a, R) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(R() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function prepare(pid, type, sid, mid) {
    var p = A.profile(pid); if (!p) return;
    var daily = type === "daily10", seed = daily ? A.dailyKey(p.id, Date.now()) : String(Date.now()) + Math.random(), R = A.rng(seed + ":files");
    var opts = { seed: seed, hidden: H.hidden(), recent: seenMap() };
    if (sid) opts.subjects = [sid];
    if (mid) { opts.modules = [mid]; opts.module = mid; }
    if (type === "diagnostic") opts.history = histBySubject();
    var title = typeName(type) + (type === "grand" || type === "part" || type === "mini" ? ": " + p.name : sid ? ": " + H.tx((H.subjectById(sid) || {}).name) : "");
    H.stack().push(function () {}); H.loadingScreen(esc(title), "Choosing questions…");
    var subs = H.subjectsOf(tab()).map(function (s) { return s.id; });
    Promise.all(subs.map(function (s) { return H.loadIndex(s); })).then(function () {
      var pairs = modulePairs(p, type, opts, R);
      return Promise.all([H.loadMany(pairs, H.stepMsg), loadQuality(opts.subjects || subs)]);
    }).then(function (res) {
      var lists = res[0].map(function (l) { return { s: l.s, m: l.m, items: tab() === "usmle" ? H.pure.poolFor(l.items, "usmle", opts.hidden) : l.items }; });
      opts.quality = res[1];
      opts.subjectName = function (s) { var sb = H.subjectById(s); return sb ? (sb.name.en || s) : s; };
      var asm = A.assemble(p, type, opts, lists);
      // deviations name subjects by their names
      asm.deviations = asm.deviations.map(function (d) { return d.replace(/^([a-z][a-z-]+):/, function (m0, id) { var sb = H.subjectById(id); return sb ? (sb.name.en || id) + ":" : m0; }); });
      H.stack().pop();
      if (res[0].every(function (l) { return !l.items.length; })) asm = { ok: false, refused: "The questions did not load. Check the connection and try again; a subject downloaded for offline works without one.", deviations: [], items: [] };
      P.pick = { p: p, type: type, asm: asm, title: title, sid: sid, mid: mid };
      H.push(preScreen);
    });
  }
  function preScreen() {
    var x = P.pick, p = x.p, a = x.asm;
    var facts = [];
    if (a.ok) {
      facts.push(["Questions", a.count + (a.reduced ? " of " + a.requested + " planned" : "")]);
      facts.push(["Time", mins(a.duration_sec) + (a.sections && a.sections.length > 1 ? " in " + a.sections.length + " locked sections" : "")]);
      facts.push(["Marking", marking(p)]);
      facts.push(["Scope", x.mid ? H.tx((H.topicOf(x.sid, x.mid) || { title: x.mid }).title) : x.sid ? H.tx((H.subjectById(x.sid) || {}).name) : "All " + H.exam().label + " subjects"]);
    }
    var secs = a.sections && a.sections.length > 1 ? '<ol class="pn-t2secs">' + a.sections.map(function (s) { return "<li><b>" + esc(s.label) + "</b><span>" + s.n + " questions · " + mmss(s.sec) + "</span></li>"; }).join("") + "</ol>" +
      '<p class="pn-mut pn-small">' + H.ico("lock") + (p.navigation.early_section_submit ? " A submitted section is locked." : " Each section is locked when its time ends or when you submit it. In the exam you stay in a section until its time ends; here you may submit early, and the time left is not carried over.") + "</p>" : "";
    var dev = a.deviations && a.deviations.length ? '<section class="pn-panel pn-t2dev' + (a.reduced ? " warn" : "") + '"><h2 class="pn-sec">' + (a.reduced ? "Shorter than the blueprint" : "How it was built") + '</h2><ul class="pn-t2dl">' + a.deviations.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul></section>" : "";
    var d10 = x.type === "daily10" && store().t2d[A.dailyKey(p.id, Date.now())] ? '<p class="pn-mut pn-small">Today\'s Daily 10 is already counted. This run is practice.</p>' : "";
    H.paint(H.bar(esc(x.title), esc(p.name) + (p.status === "official" ? "" : " · provisional"), "back") + '<div class="pn-body pn-t2pre">' +
      (a.ok ? '<section class="pn-panel"><dl class="pn-t2f">' + facts.map(function (f) { return "<div><dt>" + f[0] + "</dt><dd>" + esc(f[1]) + "</dd></div>"; }).join("") + "</dl>" + secs + d10 + "</section>" + dev +
        '<p class="pn-mut pn-small">' + esc(srcLine(p)) + " Profile " + esc(p.id) + " v" + esc(p.version) + '.</p><button type="button" class="pn-btn pri" data-act="t2-go">' + H.ico("play") + " Start</button>"
        : '<section class="pn-panel pn-t2dev warn" role="alert"><h2 class="pn-sec">This test cannot be built now</h2><p>' + esc(a.refused || "Not enough eligible questions.") + "</p>" + (a.deviations && a.deviations.length ? '<ul class="pn-t2dl">' + a.deviations.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>" : "") + "</section>" +
          (x.type !== "mini" && A.blueprint(p, "mini") ? '<button type="button" class="pn-btn" data-act="t2-pre" data-p="' + p.id + '" data-k="mini">Try one section instead</button>' : "") + '<button type="button" class="pn-btn" data-act="back">Back</button>') + "</div>", a.ok ? "[data-act=t2-go]" : null);
  }
  function go() {
    var x = P.pick; if (!x || !x.asm.ok) return;
    var p = x.p, a = x.asm, now = Date.now();
    var t2 = { exam: p.id, pv: p.version, type: x.type, attempt_id: "t2-" + now.toString(36) + "-" + Math.floor(Math.random() * 46656).toString(36), idem: x.type === "daily10" ? A.dailyKey(p.id, now) : null,
      started: now, earlyOk: !!p.navigation.early_section_submit, sections: a.sections && a.sections.length ? a.sections : null, blueprint: { id: a.blueprint.id, version: a.blueprint.version },
      asm: { planned: a.planned, actual: a.actual, deviations: a.deviations, count: a.count, requested: a.requested, reduced: a.reduced, seed: a.seed } };
    H.stack().pop();   // the pre-test screen
    clearSess();
    H.run(a.items, "exam", x.title, { t2: t2, sections: t2.sections, limit: t2.sections ? 0 : a.duration_sec, scheme: A.scheme(p) });
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
      items: items, ans: ans, mark: keep.map(function (i) { return !!r.mark[i]; }), ms: keep.map(function (i) { return (r.ms || [])[i] || 0; }), changed: keep.map(function (i) { return (r.changed || [])[i] || 0; }), sections: secs, asm: { planned: t.asm.planned, actual: t.asm.actual, deviations: t.asm.deviations } }, p, { subjectName: subjectName, topicName: topicName });
    if (r.sc) rec.by_section.forEach(function (b) { var k = -1; t.sections.forEach(function (s, j) { if (s.id === b.key) k = j; }); if (k >= 0) { b.used_ms = Math.round(r.sc.used[k]); b.allowed_ms = r.sc.lim[k]; b.ended = r.sc.why[k] || "submitted"; } });
    r.t2.rec = rec;
    var s = store(), now = Date.now();
    s.t2h = s.t2h.concat([{ attempt_id: rec.attempt_id, exam: rec.exam, type: rec.test_type, pv: rec.profile_version, ts: now, raw: rec.score.raw, max: rec.score.max, correct: rec.score.correct, incorrect: rec.score.incorrect, unanswered: rec.score.unanswered, n: items.length, secs: rec.by_section.map(function (b) { return [b.key, b.raw]; }) }]).slice(-30);
    if (t.idem) { var dc = A.dailyComplete(s.t2d, t.idem, { ts: now, attempt_id: rec.attempt_id, raw: rec.score.raw, max: rec.score.max, correct: rec.score.correct, n: items.length }); r.t2.dailyFresh = dc.fresh; A.dailyPrune(s.t2d, now, 60); }
    H.save();
    H.cachePut(REC_KEY + rec.attempt_id, rec);
    clearSess();
  }
  function pct(x) { return x == null ? "-" : Math.round(x * 100) + "%"; }
  function resultHtml(r, cele) {
    var t = r.t2, rec = t.rec, p = A.profile(t.exam); if (!rec || !p) return "";
    var sc = rec.score, avg = sc.avg_ms ? Math.round(sc.avg_ms / 1000) + " s" : "-";
    var head = '<section class="pn-panel pn-score pn-t2r"' + H.celeAttrs(cele) + ">" + H.celeChip(cele) +
      (t.type === "daily10" ? '<p class="pn-t2eb">' + (t.dailyFresh ? "Daily 10 done for today" : "Practice: today's Daily 10 was already counted") + "</p>" : "") +
      '<p class="pn-big">' + fmtMarks(sc.raw) + " / " + sc.max + '</p><p class="pn-mut">' + esc(p.name) + " marking: " + esc(marking(p)) + "</p>" +
      '<dl class="pn-t2f pn-t2k"><div><dt>Right</dt><dd>' + sc.correct + "</dd></div><div><dt>Wrong</dt><dd>" + sc.incorrect + "</dd></div><div><dt>Not answered</dt><dd>" + sc.unanswered + "</dd></div><div><dt>Accuracy</dt><dd>" + pct(sc.accuracy) + "</dd></div><div><dt>Time</dt><dd>" + mmss(r.secs) + "</dd></div><div><dt>Average</dt><dd>" + avg + "</dd></div></dl>" +
      (p.scoring.pass ? '<p class="pn-mut pn-small">Pass mark in the exam: ' + p.scoring.pass.marks + " of " + p.scoring.pass.of + " (" + Math.round(p.scoring.pass.marks * 100 / p.scoring.pass.of) + "%). This test: " + (sc.max ? Math.round(Math.max(0, sc.raw) * 100 / sc.max) : 0) + "% of its marks.</p>" : "") +
      (rec.state === "auto_submitted_timeout" ? '<p class="pn-mut pn-small">' + H.ico("clock") + " Time ran out: answers given by then were marked.</p>" : "") + "</section>";
    var secs = rec.by_section.length > 1 ? '<h2 class="pn-sec">By section</h2><ul class="pn-mods pn-t2sec">' + rec.by_section.map(function (b) {
      return '<li><div class="pn-mod static"><span class="pn-mb"><b>' + esc(b.label) + "</b><small>" + b.correct + " right · " + b.incorrect + " wrong · " + b.unanswered + " not answered" + (b.used_ms ? " · " + mmss(b.used_ms / 1000) + " of " + mmss(b.allowed_ms / 1000) : "") + '</small></span><span class="pn-st">' + fmtMarks(b.raw) + "</span></div></li>";
    }).join("") + "</ul>" : "";
    var subj = rec.by_subject.slice().sort(function (a, b) { return (a.correct / a.n) - (b.correct / b.n); });
    var subs = '<h2 class="pn-sec">By subject, weakest first</h2><ul class="pn-mods">' + subj.map(function (b) {
      var pc = Math.round(b.correct * 100 / b.n), inner = '<span class="pn-mb"><b>' + esc(b.label) + "</b><small>" + b.correct + " of " + b.n + " right · " + b.incorrect + ' wrong</small><span class="pn-meter' + (pc >= 70 ? " ok" : pc < 40 ? " low" : "") + '" aria-hidden="true"><i style="transform:scaleX(' + (pc / 100) + ')"></i></span></span><span class="pn-st' + (pc >= 70 ? " done" : "") + '">' + pc + "%</span>";
      return H.subjectById(b.key) ? '<li><button type="button" class="pn-mod" data-act="subject" data-s="' + esc(b.key) + '">' + inner + "</button></li>" : '<li><div class="pn-mod static">' + inner + "</div></li>";
    }).join("") + "</ul>";
    var next = rec.next_actions.length ? '<h2 class="pn-sec">Practise next</h2><div class="pn-group">' + rec.next_actions.map(function (n) { var k = n.target_id.split("|"); return H.row("module", H.ico("play"), esc(topicName(k[0], k[1])), esc(n.why) + " in this test", ' data-s="' + esc(k[0]) + '" data-m="' + esc(k[1]) + '"'); }).join("") + "</div>" : "";
    var diff = rec.by_difficulty.length > 1 ? '<p class="pn-mut pn-small">By difficulty: ' + rec.by_difficulty.sort(function (a, b) { return a.key - b.key; }).map(function (b) { return esc(b.label) + " " + b.correct + "/" + b.n; }).join(" · ") + "</p>" : "";
    var trend = A.ownTrend(store().t2h, { exam: rec.exam, test_type: rec.test_type, attempt_id: rec.attempt_id });
    var tr = (t.type === "grand" || t.type === "part" || t.type === "mini") ? '<h2 class="pn-sec">Your earlier attempts</h2>' + (trend.length ? '<ul class="pn-mods">' + trend.slice().reverse().map(function (h) { return '<li><div class="pn-mod static"><span class="pn-mb"><b>' + dm(h.ts) + "</b><small>" + h.correct + " right · " + h.incorrect + " wrong · " + h.unanswered + ' not answered</small></span><span class="pn-st">' + fmtMarks(h.raw) + " / " + h.max + "</span></div></li>"; }).join("") + "</ul>" : '<p class="pn-mut pn-small">Your first ' + esc(typeName(t.type).toLowerCase()) + " for " + esc(p.name) + ". Later attempts are compared with this one.</p>") +
      '<p class="pn-mut pn-small">Compared only with your own attempts. No national rank or percentile is shown: no representative group of candidates exists to compare with.</p>' : "";
    var how = '<details class="pn-t2how"><summary>How this test was built</summary><p class="pn-mut pn-small">Profile ' + esc(rec.exam) + " v" + esc(rec.profile_version) + " (" + esc(p.status) + "). " + esc(srcLine(p)) + "</p>" +
      (rec.distribution.deviations.length ? '<ul class="pn-t2dl">' + rec.distribution.deviations.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>" : '<p class="pn-mut pn-small">Built as planned.</p>') +
      '<ul class="pn-t2dist">' + Object.keys(rec.distribution.actual).map(function (k) { return "<li><span>" + esc(subjectName(k)) + "</span><span>" + rec.distribution.actual[k] + (rec.distribution.planned[k] != null && rec.distribution.planned[k] !== rec.distribution.actual[k] ? " of " + rec.distribution.planned[k] + " planned" : "") + "</span></li>"; }).join("") + "</ul></details>";
    return head + secs + subs + diff + next + tr + how;
  }

  /* ---------- acts ---------- */
  function act(a, b, h) {
    H = h;
    var pid = b.getAttribute("data-p"), k = b.getAttribute("data-k");
    if (a === "t2-pre") return prepare(pid, k, b.getAttribute("data-s"), b.getAttribute("data-m"));
    if (a === "t2-go") return go();
    if (a === "t2-pick") return pickSubject(A.profile(pid), k);
    if (a === "t2-pickm") return pickModule(A.profile(pid), b.getAttribute("data-s"));
    if (a === "t2-resume") return resume();
    if (a === "t2-discard") { if (G.confirm && !G.confirm("Discard the saved test? Its answers are not marked.")) return; return Promise.resolve(clearSess()).then(function () { H.rerender(); }); }
    if (a === "t2-legacy") return H.startMock(b.getAttribute("data-v"), "full");
    if (a === "t2-plan") return H.startPlan();
    if (a === "t2-weak") return H.startWeak();
    if (a === "t2-mistakes") return H.openMistakes();
    if (a === "t2-custom") return H.openCustom();
  }
  G.PREP_TESTS = { on: on, testsHtml: testsHtml, mounted: mounted, act: act, persist: persist, left: left, finished: finished, resultHtml: resultHtml, _P: P, _clear: clearSess };
})(typeof window !== "undefined" ? window : this);
