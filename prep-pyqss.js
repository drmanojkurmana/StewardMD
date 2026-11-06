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
  var PURE = { paperTitle: paperTitle, byIds: byIds, inDomain: inDomain, mustItems: mustItems };
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
    return host.row("ys-home", host.ico("play"), "Medical Oncology PYQs", "NEET-SS recall papers, every question with its explanation") +
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
  function renderDomain(host, name) {
    var e = host.esc, d = null; S.ix.analysis.domains.forEach(function (x) { if (x.name === name) d = x; });
    if (!d) return;
    host.paint(host.bar(e(d.name), TIER[d.tier], "back") + '<div class="pn-body"><section class="pn-panel pn-modp" style="--h:262"><p class="pn-big">' + d.n + ' questions · ' + d.pct + '%</p><p class="pn-mut">2025: ' + d.y2025 + " · 2024: " + d.y2024 + "</p>" +
      '<button type="button" class="pn-btn pri" data-act="ys-pdom" data-v="' + e(d.name) + '" data-k="study">' + host.ico("play") + " Practise this topic</button>" +
      '<button type="button" class="pn-btn" data-act="ys-pdom" data-v="' + e(d.name) + '" data-k="exam">' + host.ico("clock") + " Timed test</button></section>" +
      '<h2 class="pn-sec">Subtopics</h2><div class="pn-group">' + d.topics.map(function (t) {
        return '<div class="pn-row"><span class="pn-rb"><b>' + e(t.name) + "</b><small>" + (t.must ? "Must do · " : "") + "asked " + t.n + (t.n > 1 ? " times" : " time") + " (2025: " + t.y[2025] + ", 2024: " + t.y[2024] + ")" + (t.kp ? "<br>" + e(t.kp) : "") + "</small></span></div>";
      }).join("") + "</div></div>");
  }
  function renderMust(host) {
    var e = host.esc, an = S.ix.analysis;
    host.paint(host.bar("Must-do topics", "Asked 2+ times, in both years, or repeated", "back") + '<div class="pn-body"><section class="pn-panel pn-modp" style="--h:262"><p class="pn-big">' + an.mustDo.length + ' topics</p>' +
      '<button type="button" class="pn-btn pri" data-act="ys-pmust" data-k="study">' + host.ico("play") + " Practise their questions</button></section>" +
      '<div class="pn-group">' + an.mustDo.map(function (t) {
        return '<div class="pn-row"><span class="pn-rb"><b>' + e(t.name) + "</b><small>" + e(t.dom) + " · asked " + t.n + "× (2025: " + t.y2025 + ", 2024: " + t.y2024 + ")" + (t.kp ? "<br>" + e(t.kp) : "") + "</small></span></div>";
      }).join("") + "</div></div>");
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
  }
  G.PREP_PYQSS = { homeRow: homeRow, warm: warm, act: act, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
