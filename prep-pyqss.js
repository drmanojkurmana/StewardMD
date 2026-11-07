/* PrepNucleus NEET-SS Medical Oncology previous-year questions + analysis. ES5. window.PREP_PYQSS, loaded by prep-loader.js
   after prep-pyq.js; draws through PREP._host. prep.js forwards every data-act starting "ys-" here.
   Data (tools/pyq-ss-build.mjs, R2 v5/pyq-ss/, gated like all bank paths): index.json { papers, file, analysis } and the items
   file it names, in the same item shape as prep-pyq.js, so prep.js runs them and PREP_PYQ.chips/prov label them.
   No source (publisher, channel, faculty, video) is named anywhere: papers are "NEET-SS 2025 - Recall set 1".
   Screens: Medical Oncology PYQs (home row) -> paper -> practice / timed test; Analysis -> topic domains by frequency and
   tier -> one domain's topics; Must-do topics (asked 2+ times, in both years, or repeated). */
(function (G) {
  "use strict";
  var SUBJECT = "ss-medical-oncology", TIER = { 1: "Tier 1 · very high yield", 2: "Tier 2 · frequent", 3: "Tier 3 · occasional" };
  var S = { ix: null, items: null, p: null };

  /* ================= pure ================= */
  function paperTitle(p) { return "NEET-SS " + p.year + " · Recall set " + String(p.session).replace(/\D/g, ""); }
  function byIds(items, ids) { var m = {}; (ids || []).forEach(function (i) { m[i] = 1; }); return items.filter(function (it) { return m[it.id]; }); }
  function inDomain(items, name) { return items.filter(function (it) { return it.dom === name; }); }
  function mustItems(items, an) { var ids = []; an.mustDo.forEach(function (t) { ids = ids.concat(t.ids); }); return byIds(items, ids); }
  /* ---- 30-day plan: every topic asked, most important first. Days 1-27 learn (a topic area's days follow its share of the
     questions, at least one), day 28 revises the Tier 1 must-do topics, day 29 the Tier 2-3 ones, day 30 is a timed test of
     all must-do questions. Worked out once when the student starts and kept in the store, so it never shifts. ---- */
  var DAYS = 30, LEARN = 27;
  function allot(doms) {
    var tot = doms.reduce(function (a, d) { return a + d.n; }, 0), a = doms.map(function (d) { var x = d.n / tot * LEARN; return { b: Math.max(1, Math.floor(x)), f: x - Math.floor(x) }; });
    var sum = function () { return a.reduce(function (t, x) { return t + x.b; }, 0); }, i, best;
    while (sum() < LEARN) { best = 0; for (i = 1; i < a.length; i++) if (a[i].f > a[best].f) best = i; a[best].b++; a[best].f = -1; }
    while (sum() > LEARN) { best = -1; for (i = 0; i < a.length; i++) if (a[i].b > 1 && (best < 0 || a[i].f < a[best].f)) best = i; if (best < 0) break; a[best].b--; a[best].f = 2; }
    return a.map(function (x) { return x.b; });
  }
  function makePlan(an) {
    var doms = an.domains.slice().sort(function (x, y) { return x.tier - y.tier || y.n - x.n; }), k = allot(doms), days = [];
    doms.forEach(function (d, i) {
      var left = d.topics.slice(), rest = d.n, parts = k[i];
      for (var p = 0; p < parts; p++) {
        var want = rest / (parts - p), take = [], q = 0;
        while (left.length > parts - p - 1 && (!take.length || q < want)) { var t = left.shift(); take.push(t.name); q += t.n; }
        rest -= q; days.push({ n: days.length + 1, k: "learn", dom: d.name, tp: take, q: q });
      }
    });
    var tierOf = {}; an.domains.forEach(function (d) { tierOf[d.name] = d.tier; });
    var m1 = an.mustDo.filter(function (t) { return tierOf[t.dom] === 1; }), m2 = an.mustDo.filter(function (t) { return tierOf[t.dom] !== 1; }), cnt = function (l) { return l.reduce(function (a, t) { return a + t.n; }, 0); };
    days.push({ n: 28, k: "rev", dom: "Revise Tier 1 must-do topics", tier: 1, tp: m1.map(function (t) { return t.name; }), q: cnt(m1) });
    days.push({ n: 29, k: "rev", dom: "Revise Tier 2 and 3 must-do topics", tier: 2, tp: m2.map(function (t) { return t.name; }), q: cnt(m2) });
    days.push({ n: 30, k: "test", dom: "Timed test: all must-do questions", tp: [], q: cnt(an.mustDo) });
    return days;
  }
  // The day's questions. A learn day is its area's questions on its topics; revision days come from the must-do list.
  function itemsOfDay(items, an, day) {
    if (day.k === "learn") { var m = {}; day.tp.forEach(function (t) { m[t] = 1; }); return items.filter(function (it) { return it.dom === day.dom && m[it.topic]; }); }
    var tierOf = {}; an.domains.forEach(function (d) { tierOf[d.name] = d.tier; });
    var ids = []; an.mustDo.forEach(function (t) { if (day.k === "test" || (day.tier === 1) === (tierOf[t.dom] === 1)) ids = ids.concat(t.ids); });
    return byIds(items, ids);
  }
  function short(n) { return String(n).split(/ [—(&] ?|, /)[0].replace(/\s+$/, ""); }
  // The day's reminder line, true on the day: what to read and how many questions.
  function noticeOf(plan, n) {
    var d = plan && plan[n - 1]; if (!d) return null;
    if (d.k === "test") return { k: "rev", title: "Day 30: timed test", body: "Take the timed test of all must-do questions (" + d.q + " questions)." };
    var names = d.tp.slice(0, 3).map(function (t) { t = short(t); return t.length > 42 ? t.slice(0, 40).replace(/\s+\S*$/, "") + "..." : t; }).join(", ") + (d.tp.length > 3 ? " and " + (d.tp.length - 3) + " more" : "");
    return { k: d.k === "rev" ? "rev" : "learn", title: "Day " + d.n + (d.k === "learn" ? ": " + short(d.dom).slice(0, 40) : ": revision"), body: (d.k === "learn" ? "Read " : "Revise ") + names + ". Then practise " + d.q + " questions." };
  }
  function dayOf(ys, today) { return ys && ys.start != null ? today - ys.start + 1 : 0; }
  var PURE = { paperTitle: paperTitle, byIds: byIds, inDomain: inDomain, mustItems: mustItems, makePlan: makePlan, itemsOfDay: itemsOfDay, noticeOf: noticeOf, dayOf: dayOf, short: short };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  function base(host) { return (host.bankApi || "/api/prep/bank/") + (host.pyqVer ? host.pyqVer() : "v5") + "/pyq-ss/"; }
  function load(host) {
    if (S.items) return Promise.resolve();
    return host.getJSON(base(host) + "index.json").then(function (ix) {
      S.ix = ix; return host.getJSON(base(host) + ix.file);
    }).then(function (f) {
      S.items = (f.items || []).map(function (it) { it._py = 1; it._s = SUBJECT; it._m = "pyq"; return it; });
    });
  }
  function warm(host) { load(host).then(null, function () {}); }
  function homeRow(host) {
    warm(host);
    var ys = host.store().ys, n = dayOf(ys, host.today()), d = ys && ys.days && ys.days[n - 1];
    return host.row("ys-plan", host.ico("clock"), "30-day Medical Oncology plan", d ? "Day " + n + ": " + host.esc(short(d.dom)) : ys && n > DAYS ? "Plan finished. Open to restart" : "Every topic asked, most important first, one day at a time") +
      host.row("ys-home", host.ico("play"), "Medical Oncology PYQs", "NEET-SS recall papers, every question with its explanation") +
      host.row("ys-an", host.ico("next"), "PYQ analysis", "Topics asked, how often, and which to do first");
  }
  function failed(host) {
    var b = host.root() && host.root().querySelector("#pnYs"); if (!b) return;
    b.innerHTML = '<p class="pn-err" role="alert">These papers need a connection the first time.</p><button type="button" class="pn-btn" data-act="ys-home">Try again</button>';
  }
  function shell(host, title, sub, body) { host.paint(host.bar(title, sub, "back") + '<div class="pn-body" id="pnYs">' + body + "</div>"); }
  function box(host) { return host.root() && host.root().querySelector("#pnYs"); }

  function renderHome(host) {
    var e = host.esc;
    shell(host, "Medical Oncology PYQs", "NEET-SS · recall", '<p class="pn-load" role="status">Loading papers…</p>');
    load(host).then(function () {
      var b = box(host); if (!b) return;
      var html = '<section class="pn-yq-note"><p><b>Recall papers, not official ones.</b> NBEMS does not publish NEET-SS papers. These sets were put together from memory after each exam, so wording can differ from the real paper.</p></section>' +
        '<div class="pn-group">' + S.ix.papers.map(function (p) {
          return '<button type="button" class="pn-row pn-yq-row" data-act="ys-paper" data-v="' + e(p.id) + '"><span class="pn-rb"><b>' + e(paperTitle(p)) + "</b><small>" + host.fmt(p.n) + ' questions</small></span><span class="pn-yq-kind">Recall</span>' + host.ico("chev") + "</button>";
        }).join("") + "</div>" +
        '<div class="pn-group"><button type="button" class="pn-row" data-act="ys-all"><span class="pn-rb"><b>All ' + host.fmt(S.items.length) + ' questions</b><small>Practise every set together</small></span>' + host.ico("chev") + "</button>" +
        '<button type="button" class="pn-row" data-act="ys-an"><span class="pn-rb"><b>PYQ analysis</b><small>Topics, frequency, importance</small></span>' + host.ico("chev") + "</button></div>";
      b.innerHTML = html;
    }, function () { failed(host); });
  }
  function runList(host, list, kind, title) {
    if (!list.length) return host.toast("No questions to show here yet.");
    if (kind === "exam") {
      var n = list.length, mock = host.mockOf("neet-ss", "neet-ss") || { n: 100, min: 150, plus: 1, minus: 0.25, label: "NEET-SS pattern" };
      var lim = Math.round(n * mock.min * 60 / mock.n);
      return host.run(host.shuffle(list.slice()), "exam", title, { limit: lim, scheme: { plus: mock.plus, minus: mock.minus, label: mock.label } });
    }
    host.run(list.slice(), "study", title);
  }
  function renderPaper(host, pid) {
    var p = null; S.ix.papers.forEach(function (x) { if (x.id === pid) p = x; });
    if (!p) return;
    var list = byIds(S.items, p.items);
    host.paint(host.bar(host.esc(paperTitle(p)), "Recall paper", "back") + '<div class="pn-body"><section class="pn-panel pn-modp" style="--h:262"><p class="pn-big">' + host.fmt(list.length) + ' questions</p><p class="pn-mut">Memory-based recall. Each answer comes with its explanation.</p>' +
      '<button type="button" class="pn-btn pri" data-act="ys-start" data-v="' + host.esc(pid) + '" data-k="study">' + host.ico("play") + " Practice in paper order</button>" +
      '<button type="button" class="pn-btn" data-act="ys-start" data-v="' + host.esc(pid) + '" data-k="exam">' + host.ico("clock") + " Timed test</button></section></div>");
  }
  function bar(p) { return '<span class="pn-yq-bar" aria-hidden="true"><i style="transform:scaleX(' + p.toFixed(3) + ')"></i></span>'; }
  function renderAnalysis(host) {
    var e = host.esc;
    shell(host, "PYQ analysis", "Medical Oncology · NEET-SS", '<p class="pn-load" role="status">Loading…</p>');
    load(host).then(function () {
      var b = box(host); if (!b) return; var an = S.ix.analysis, top = an.domains[0].n, html;
      html = '<section class="pn-panel pn-modp" style="--h:262"><p class="pn-big">' + host.fmt(an.total) + ' questions</p><p class="pn-mut">' + an.y2025 + " from 2025 · " + an.y2024 + " from 2024. Tier 1 topics make up " + Math.round(an.domains.filter(function (d) { return d.tier === 1; }).reduce(function (a, d) { return a + d.pct; }, 0)) + '% of all questions.</p>' +
        '<button type="button" class="pn-btn pri" data-act="ys-must">' + host.ico("play") + " Must-do topics · " + an.mustDo.length + "</button></section>" +
        '<h2 class="pn-sec">Topics by how often they were asked</h2><ul class="pn-yq-subs pn-fills">' + an.domains.map(function (d) {
          return '<li><button type="button" class="pn-yq-subb" data-act="ys-dom" data-v="' + e(d.name) + '"><span class="pn-yq-sn">' + e(d.name) + bar(d.n / top) + "<small>" + e(TIER[d.tier]) + " · 2025: " + d.y2025 + " · 2024: " + d.y2024 + '</small></span><span class="pn-st">' + d.n + " · " + d.pct + "%</span></button></li>";
        }).join("") + "</ul>";
      b.innerHTML = html;
    }, function () { failed(host); });
  }
  /* A topic row (owner 2026-11-07): a tick box that remembers the topic is done (store.ys.tick, synced with ys), and the
   * topic itself opens the Learn lesson that teaches it (t.les, from tools/pyq-ss-build.mjs). */
  function ticks(host) { var s = host.store(); s.ys = s.ys || {}; return (s.ys.tick = s.ys.tick || {}); }
  function topicRow(host, t, meta) {
    var e = host.esc, k = (t.dom || "") + "|" + t.name, on = !!ticks(host)[k];
    var body = "<b>" + e(t.name) + "</b><small>" + meta + (t.kp ? "<br>" + e(t.kp) : "") + "</small>";
    return '<div class="pn-row pn-yq-trow' + (on ? " on" : "") + '"><button type="button" class="pn-yq-tick" data-act="ys-tick" data-v="' + e(k) + '" aria-pressed="' + on + '" aria-label="Mark ' + e(t.name) + ' done">' + host.ico("check") + "</button>" +
      (t.les ? '<button type="button" class="pn-rb pn-yq-tgo" data-act="l-open" data-s="' + SUBJECT + '" data-m="' + e(t.les) + '">' + body + '<span class="pn-st">Lesson ' + host.ico("chev") + "</span></button>" : '<span class="pn-rb">' + body + "</span>") + "</div>";
  }
  function renderDomain(host, name) {
    var e = host.esc, d = null; S.ix.analysis.domains.forEach(function (x) { if (x.name === name) d = x; });
    if (!d) return;
    host.paint(host.bar(e(d.name), TIER[d.tier], "back") + '<div class="pn-body"><section class="pn-panel pn-modp" style="--h:262"><p class="pn-big">' + d.n + ' questions · ' + d.pct + '%</p><p class="pn-mut">2025: ' + d.y2025 + " · 2024: " + d.y2024 + "</p>" +
      '<button type="button" class="pn-btn pri" data-act="ys-pdom" data-v="' + e(d.name) + '" data-k="study">' + host.ico("play") + " Practise this topic</button>" +
      '<button type="button" class="pn-btn" data-act="ys-pdom" data-v="' + e(d.name) + '" data-k="exam">' + host.ico("clock") + " Timed test</button></section>" +
      '<h2 class="pn-sec">Subtopics</h2><div class="pn-group">' + d.topics.map(function (t) {
        return topicRow(host, { dom: d.name, name: t.name, kp: t.kp, les: t.les }, (t.must ? "Must do · " : "") + "asked " + t.n + (t.n > 1 ? " times" : " time") + " (2025: " + t.y[2025] + ", 2024: " + t.y[2024] + ")");
      }).join("") + "</div></div>");
  }
  function renderMust(host) {
    var e = host.esc, an = S.ix.analysis, tk = ticks(host), nd = an.mustDo.filter(function (t) { return tk[t.dom + "|" + t.name]; }).length;
    host.paint(host.bar("Must-do topics", "Asked 2+ times, in both years, or repeated", "back") + '<div class="pn-body"><section class="pn-panel pn-modp" style="--h:262"><p class="pn-big">' + nd + " of " + an.mustDo.length + ' done</p><p class="pn-mut">Tap a topic to open its lesson. Tick it when you have read it.</p>' +
      '<button type="button" class="pn-btn pri" data-act="ys-pmust" data-k="study">' + host.ico("play") + " Practise their questions</button></section>" +
      '<div class="pn-group">' + an.mustDo.map(function (t) {
        return topicRow(host, t, e(t.dom) + " · asked " + t.n + "× (2025: " + t.y2025 + ", 2024: " + t.y2024 + ")");
      }).join("") + "</div></div>");
  }
  /* ---- the 30-day plan screens (state: store.ys = { start: day number, days, done: { day: 1 } }) ---- */
  function planOf(host) { var ys = host.store().ys; return ys && ys.days && ys.days.length === DAYS ? ys : null; }
  function stat(ys, n, td) { var c = dayOf(ys, td); return ys.done && ys.done[n] ? "done" : n === c ? "today" : n < c ? "missed" : "next"; }
  var STAT = { done: "Done", today: "Today", missed: "Missed", next: "" };
  function renderPlan(host) {
    var e = host.esc, ys = planOf(host);
    shell(host, "30-day plan", "Medical Oncology · NEET-SS", '<p class="pn-load" role="status">Loading…</p>');
    load(host).then(function () {
      var b = box(host); if (!b) return;
      if (!ys) {
        b.innerHTML = '<section class="pn-panel pn-modp" style="--h:262"><p class="pn-big">All ' + host.fmt(S.items.length) + ' questions in 30 days</p><p class="pn-mut">Days 1 to 27 cover every topic asked, most important first (about ' + Math.round(S.items.length / 27) + ' questions a day). Days 28 and 29 revise the must-do topics and day 30 is a timed test. The app reminds you each morning with the topic of the day (turn on Smart nudges in Settings).</p>' +
          '<button type="button" class="pn-btn pri" data-act="ys-pstart">' + host.ico("play") + " Start today</button></section>";
        return;
      }
      var td = host.today(), c = dayOf(ys, td), missed = ys.days.filter(function (d) { return stat(ys, d.n, td) === "missed"; }), done = Object.keys(ys.done || {}).length;
      b.innerHTML = '<section class="pn-panel pn-modp" style="--h:262"><p class="pn-big">' + (c > DAYS ? "Plan finished" : "Day " + Math.max(c, 1) + " of 30") + '</p><p class="pn-mut">' + done + " days done" + (missed.length ? " · " + missed.length + " missed" : "") + "</p>" +
        (c >= 1 && c <= DAYS ? '<button type="button" class="pn-btn pri" data-act="ys-pday" data-v="' + c + '">' + host.ico("play") + " Open today: " + e(short(ys.days[c - 1].dom)) + "</button>" : "") +
        (missed.length ? '<button type="button" class="pn-btn" data-act="ys-pday" data-v="' + missed[0].n + '">Catch up on the first missed day</button>' : "") + "</section>" +
        '<h2 class="pn-sec">All 30 days</h2><div class="pn-group">' + ys.days.map(function (d) {
          return '<button type="button" class="pn-row" data-act="ys-pday" data-v="' + d.n + '"><span class="pn-rb"><b>Day ' + d.n + " · " + e(d.dom) + "</b><small>" + (d.k === "test" ? d.q + " questions, timed" : d.tp.length + " topics · " + d.q + " questions") + '</small></span><span class="pn-yq-kind">' + STAT[stat(ys, d.n, td)] + "</span>" + host.ico("chev") + "</button>";
        }).join("") + '</div><button type="button" class="pn-btn" data-act="ys-prestart">Restart from today</button>';
    }, function () { failed(host); });
  }
  function renderDay(host, n) {
    var e = host.esc, ys = planOf(host), d = ys && ys.days[n - 1]; if (!d) return;
    var list = itemsOfDay(S.items, S.ix.analysis, d), isDone = ys.done && ys.done[n];
    host.paint(host.bar("Day " + n, e(d.dom), "back") + '<div class="pn-body"><section class="pn-panel pn-modp" style="--h:262"><p class="pn-big">' + list.length + ' questions</p><p class="pn-mut">' + (d.k === "test" ? "A timed test of every must-do question." : "Read the key points below, then practise.") + "</p>" +
      '<button type="button" class="pn-btn pri" data-act="ys-pgo" data-v="' + n + '" data-k="' + (d.k === "test" ? "exam" : "study") + '">' + host.ico(d.k === "test" ? "clock" : "play") + (d.k === "test" ? " Start the timed test" : " Practise today's questions") + "</button>" +
      (d.k === "test" ? "" : '<button type="button" class="pn-btn" data-act="ys-pgo" data-v="' + n + '" data-k="exam">' + host.ico("clock") + " Timed test of these</button>") +
      '<button type="button" class="pn-btn" data-act="ys-pdone" data-v="' + n + '">' + (isDone ? "Done. Tap to undo" : "Mark day done") + "</button></section>" +
      (d.tp.length ? '<h2 class="pn-sec">Topics and key points</h2><div class="pn-group">' + d.tp.map(function (t) {
        var it = list.filter(function (x) { return x.topic === t; })[0];
        return '<div class="pn-row"><span class="pn-rb"><b>' + e(t) + "</b>" + (it && it.kp ? "<small>" + e(it.kp) + "</small>" : "") + "</span></div>";
      }).join("") + "</div>" : "") + "</div>");
  }
  function startPlan(host) { var old = host.store().ys; host.store().ys = { start: host.today(), days: makePlan(S.ix.analysis), done: {}, tick: (old && old.tick) || {} }; host.save(); if (G.PREP_NATIVE) G.PREP_NATIVE.changed(); host.toast("Plan started. Day 1 is today."); }
  // For prep-plan.js: [today, tomorrow] reminder lines, same shape as the ReWise notice; none when no plan, a done day or outside 1-30.
  function notice(host, k) {
    var ys = planOf(host); if (!ys) return null;
    var n = dayOf(ys, host.today()) + (k || 0); if (n < 1 || n > DAYS || (!k && ys.done && ys.done[n])) return null;
    return noticeOf(ys.days, n);
  }
  function act(a, b, host) {
    var v = b.getAttribute("data-v"), k = b.getAttribute("data-k");
    if (a === "ys-home") return host.push(function () { renderHome(host); });
    if (a === "ys-an") return host.push(function () { renderAnalysis(host); });
    var need = function (fn) { return load(host).then(fn, function () { host.toast("The questions did not load. Check the connection and try again."); }); };
    if (a === "ys-paper") return need(function () { host.push(function () { renderPaper(host, v); }); });
    if (a === "ys-dom") return need(function () { host.push(function () { renderDomain(host, v); }); });
    if (a === "ys-must") return need(function () { host.push(function () { renderMust(host); }); });
    if (a === "ys-all") return need(function () { runList(host, S.items, "study", "Medical Oncology PYQs"); });
    if (a === "ys-start") return need(function () { var p = S.ix.papers.filter(function (x) { return x.id === v; })[0]; runList(host, byIds(S.items, p.items), k, paperTitle(p) + " (recall)"); });
    if (a === "ys-pdom") return need(function () { runList(host, inDomain(S.items, v), k, v); });
    if (a === "ys-pmust") return need(function () { runList(host, mustItems(S.items, S.ix.analysis), k, "Must-do topics"); });
    if (a === "ys-plan") return need(function () { host.push(function () { renderPlan(host); }); });
    if (a === "ys-pstart") return need(function () { startPlan(host); renderPlan(host); });
    if (a === "ys-prestart") { if (G.confirm && !G.confirm("Restart the 30-day plan from today? Your ticks will be cleared.")) return; return need(function () { startPlan(host); renderPlan(host); }); }
    if (a === "ys-pday") return need(function () { host.push(function () { renderDay(host, +v); }); });
    if (a === "ys-tick") { var tk = ticks(host); if (tk[v]) delete tk[v]; else tk[v] = 1; host.save(); var row = b.closest && b.closest(".pn-yq-trow"); if (row) { row.classList.toggle("on", !!tk[v]); b.setAttribute("aria-pressed", String(!!tk[v])); } var big = host.root() && host.root().querySelector(".pn-big"); if (big && S.ix && /done$/.test(big.textContent)) big.textContent = S.ix.analysis.mustDo.filter(function (t) { return tk[t.dom + "|" + t.name]; }).length + " of " + S.ix.analysis.mustDo.length + " done"; return; }
    if (a === "ys-pdone") { var y = planOf(host); if (!y) return; y.done = y.done || {}; if (y.done[v]) delete y.done[v]; else y.done[v] = 1; host.save(); if (G.PREP_NATIVE) G.PREP_NATIVE.changed(); return need(function () { renderDay(host, +v); }); }
    if (a === "ys-pgo") return need(function () { var y = planOf(host), d = y && y.days[+v - 1]; if (d) runList(host, itemsOfDay(S.items, S.ix.analysis, d), k, "Day " + v + " · " + d.dom); });
  }
  G.PREP_PYQSS = { homeRow: homeRow, warm: warm, act: act, notice: notice, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
