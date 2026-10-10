/* Ophthalmós: ophthalmology image reading trainer, a StewardMD module.
   DOM layer. ES5 to match the host. Pure logic lives in ophthalmos-core.js (FSRS-6, sessions),
   ophthalmos-data.js (levels, access, storage) and ophthalmos-stage.js (zoom).
   Host contract (mirrors atlas.js): open() hides home, close() restores it, back() unwinds one
   layer and is what swipe-back.js and Escape call. */
(function (G) {
  "use strict";
  var C = G.OPHTHALMOS_CORE, D = G.OPHTHALMOS_DATA, S = G.OPHTHALMOS_STAGE;
  var BASE = G.SMD_OPHTHALMOS_BASE || "/ophthalmos/";
  var SESSION_SIZE = 20, NEW_CAP = 10;

  var st = {
    view: "hub", cfg: null, decks: {}, store: null, prefs: null, loading: null, err: null,
    session: null, caseRun: null, statsTrack: null, _prevFocus: null
  };

  /* ---------- host helpers ---------- */
  function ico(n, c) {
    try { if (!G.ICONS || !G.ICONS.get || (G.ICONS.has && !G.ICONS.has(n))) return ""; return G.ICONS.get(n, c); } catch (e) { return ""; }
  }
  // StewardMD's MaiK, when the host has it. The sheet opens above this overlay with the question typed
  // in, and the learner sends it: MaiK's own engine choice, quota and local-only policy all apply.
  function maikBtn(q) {
    if (!G.SMD_askMaik) return "";
    return '<button class="oph-btn sec oph-maik" data-act="maik" data-q="' + esc(q) + '">' + (typeof window !== "undefined" && window.SMD_MAIK_MARK ? window.SMD_MAIK_MARK.html("mark", { size: 20 }) : ico("ai")) + " " + (typeof window !== "undefined" && window.SMD_MAIK_MARK ? window.SMD_MAIK_MARK.label("Ask MaiK") : "Ask MaiK") + "</button>";
  }
  function maikOpen() { try { return G.document.body.classList.contains("maik-open"); } catch (e) { return false; } }
  function haptic(k) { try { if (G.SMD_HAPTICS && G.SMD_HAPTICS[k]) G.SMD_HAPTICS[k](); } catch (e) {} }
  function isPro() { try { return !!(G.SMD_PRO && G.SMD_PRO.isProSync && G.SMD_PRO.isProSync()); } catch (e) { return false; } }
  function showPro() {
    try { if (G.SMD_PRO_NOTICE && G.SMD_PRO_NOTICE.show) return G.SMD_PRO_NOTICE.show("ophthalmos"); } catch (e) {}
    try { if (G.SMD_PRO && G.SMD_PRO.openPaywall) return G.SMD_PRO.openPaywall("ophthalmos"); } catch (e) {}
    try { if (G.toast) G.toast("This level is part of StewardMD Pro"); } catch (e) {}
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Images live in R2 bucket stewardmd-ophthalmos-img, served at this custom domain (not bundled:
  // Cloudflare Pages caps a deploy at 20,000 files). The dev harness overrides it with local files.
  var IMG_DEFAULT = "https://ophthalmos-img.stewardmd.in/";
  function imgUrl(p) { return (G.SMD_OPHTHALMOS_IMG || IMG_DEFAULT) + p; }
  function ls() { try { return G.localStorage; } catch (e) { return null; } }
  function save() { D.saveStore(ls(), st.store); }
  function today() { return D.today(Date.now()); }
  var NF = (G.Intl && G.Intl.NumberFormat) ? new G.Intl.NumberFormat() : null;
  function fmt(n) { return NF ? NF.format(n) : String(n); }
  function $(id) { return G.document.getElementById(id); }

  /* ---------- data ---------- */
  function getJSON(path) {
    return fetch(BASE + path).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }
  function loadAll() {
    if (st.loading) return st.loading;
    st.err = null;
    st.loading = getJSON("tracks.json").then(function (cfg) {
      st.cfg = cfg;
      return Promise.all(cfg.tracks.map(function (t) {
        return getJSON(t.deck).then(function (d) { st.decks[t.id] = d; });
      }).concat((G.OPHTHALMOS._reads || []).map(function (r) { return r.load && r.load(); }))  // a read's load() never rejects
        .concat(G.OPHTHALMOS._learn ? [G.OPHTHALMOS._learn.load()] : [])); // nor does Learn's
    }).catch(function (e) { st.err = e; st.loading = null; throw e; });
    return st.loading;
  }
  function track(id) { for (var i = 0; i < st.cfg.tracks.length; i++) if (st.cfg.tracks[i].id === id) return st.cfg.tracks[i]; return null; }
  function level() { return st.prefs.level === "resident" ? "resident" : "foundation"; }
  function levelLocked(lv) { return D.levelLocked(st.cfg, lv || level(), isPro()); }
  // Resident = Pro with one free trial per feature (ids in ophthalmos-data.js). Pro, or Resident unlocked by
  // tracks.json access, runs straight away; an unused trial is recorded, saved, then runs; a spent one opens the paywall.
  function trial(featureId) { return D.trialState(st.store, featureId, !levelLocked("resident")); }
  function gate(featureId, run) {
    var s = trial(featureId);
    if (s === "used") return showPro();
    if (s === "trial") { D.useTrial(st.store, featureId, today()); save(); }
    return run();
  }
  function lockBadge(featureId) {
    var s = trial(featureId);
    return s === "open" ? "" : '<span class="oph-pro' + (s === "used" ? " used" : "") + '">' + ico("lock") + (s === "trial" ? "1 free trial" : "Trial used") + "</span>";
  }
  // Language (owner decision 2026-09-28): the Learn tab and lessons are English or Hindi; D.t falls back to English.
  function lang() { return st.prefs && st.prefs.lang === "hi" ? "hi" : "en"; }
  function t(obj) { return D.t(obj, lang()); }
  function drillTracks() { return st.cfg.tracks.filter(function (t) { return !t.selfRated; }); }

  /* ---------- shell ---------- */
  function root() {
    var el = $("smdOphthalmos");
    if (!el) {
      el = G.document.createElement("div");
      el.id = "smdOphthalmos";
      el.className = "oph-overlay";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Ophthalmós");
      el.addEventListener("click", onClick);
      el.addEventListener("keydown", onKey);
      G.document.body.appendChild(el);
    }
    return el;
  }
  // The per-screen "To be verified · draft" mark was removed (owner decision 2026-09-28: no draft notes).
  var DRAFT = "";
  function paint(html, focusSel) {
    var el = root();
    el.removeAttribute("lang"); // Learn screens set lang="hi" after painting; everything else is English
    el.innerHTML = html + DRAFT;
    if (!st.onBack) relabelBack(); // a screen with its own inner back (a question -> its bank) keeps its label
    var f = focusSel && el.querySelector(focusSel);
    try { (f || el.querySelector(".oph-back")).focus({ preventScroll: true }); } catch (e) {}
  }
  function top(backLabel, title, sub, right) {
    return '<div class="oph-top"><button class="oph-back" data-act="back" aria-label="' + esc(backLabel) + '">‹</button>' +
      '<div class="oph-title"><b>' + title + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + "</div>" + (right || "") + "</div>";
  }

  // The overlay follows the host's light / dark mode (body.dark; StewardMD styles the dark palette). White overlay:
  // dark status-bar icons while it is open (Capacitor "LIGHT" = dark text). Dark overlay, and on close: the host's
  // own theme. Web and older hosts have no StatusBar plugin: nothing to do.
  function statusBar(onWhite) {
    try {
      if (onWhite && G.document.body.classList.contains("dark")) onWhite = false;
      if (!onWhite && G.SMD_THEME_REVEAL && G.SMD_THEME_REVEAL.syncSystemUI) return G.SMD_THEME_REVEAL.syncSystemUI();
      var SB = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.StatusBar;
      if (SB && SB.setStyle) SB.setStyle({ style: "LIGHT" });
      if (SB && SB.setBackgroundColor) { try { SB.setBackgroundColor({ color: "#ffffff" }); } catch (e) {} }
    } catch (e) {}
  }
  function open() {
    var el = root();
    if (!el.classList.contains("on")) { try { st._prevFocus = G.document.activeElement; } catch (e) { st._prevFocus = null; } }
    try { if (G.SMD_hideHome) G.SMD_hideHome(); } catch (e) {}
    st.store = D.loadStore(ls());
    st.prefs = D.loadPrefs(ls());
    el.classList.add("on");
    G.document.body.classList.add("oph-lock");
    statusBar(true);
    st.view = "hub";
    if (st.cfg && !st.err) return renderHub();
    paint(top("Close", "Ophthalmós", "Loading tracks…") + '<div class="oph-scroll oph-pad"><p class="oph-mut" aria-busy="true">Loading image decks…</p></div>');
    loadAll().then(renderHub, function () { renderLoadError(); });
  }
  // Simulators own an animation loop and sometimes an inner layer: st.onLeave stops the loop when
  // the view is left, st.onBack unwinds the inner layer (return true when it handled back).
  // st.ret: where back goes instead of the hub (a lesson's Test yourself / Go deeper returns to the lesson);
  // any departure (leave) or hub render drops it.
  function leave() { var f = st.onLeave; st.onLeave = null; st.onBack = null; st.ret = null; st.retLabel = null; if (f) try { f(); } catch (e) {} }
  // st.ret with the screen-reader label of where it goes ("Back to lesson", in the lesson's language): the back
  // button on screen now, and on every screen painted while st.ret holds, says so.
  function setRet(fn, label, lang) { st.ret = fn; st.retLabel = label ? { t: label, lang: lang } : null; relabelBack(); }
  function relabelBack() {
    var b = st.ret && st.retLabel && $("smdOphthalmos") && $("smdOphthalmos").querySelector(".oph-top .oph-back");
    if (!b) return;
    b.setAttribute("aria-label", st.retLabel.t);
    if (st.retLabel.lang) b.setAttribute("lang", st.retLabel.lang);
  }
  function close() {
    leave();
    var el = $("smdOphthalmos");
    if (el) { el.classList.remove("on"); el.innerHTML = ""; }
    G.document.body.classList.remove("oph-lock");
    statusBar(false);
    try { if (G.SMD_showHome) G.SMD_showHome(); } catch (e) {}
    try { if (st._prevFocus && st._prevFocus.focus) st._prevFocus.focus(); } catch (e) {}
    st._prevFocus = null; st.session = null; st.caseRun = null; st.view = "hub";
  }
  function isOpen() { var el = $("smdOphthalmos"); return !!(el && el.classList.contains("on")); }

  // Layered back: any sub-screen -> hub -> close. Answers are saved as they happen, so leaving a
  // session mid-way loses nothing.
  function back() {
    if (!isOpen()) return false;
    if (st.onBack && st.onBack()) return true;
    if (st.view === "hub") { close(); return true; }
    var ret = st.ret;
    leave();
    st.session = null; st.caseRun = null; st.view = "hub";
    if (ret) ret(); else renderHub();
    return true;
  }

  function renderLoadError() {
    paint(top("Close", "Ophthalmós", "Could not load") +
      '<div class="oph-scroll oph-pad"><p>The image decks did not load. Check the connection and try again.</p>' +
      '<button class="oph-btn pri" data-act="retry">' + ico("refresh") + " Try again</button></div>");
  }

  /* ---------- hub, drill, summary: composed per the chosen layout (see below) ---------- */
  // renderHub, startSession, renderDrill, answer, next, renderSummary are defined in the
  // layout section.

  /* ---------- statistics ---------- */
  // Overview tab (first) plus the existing per-clinic tabs, unchanged in behaviour.
  function renderStats(tab) {
    st.view = "stats";
    var lv = level();
    tab = tab || st.statsTrack || "overview";
    st.statsTrack = tab;
    var tabs = '<button data-act="statstab" data-t="overview" aria-pressed="' + (tab === "overview") + '">Overview</button>' +
      drillTracks().map(function (x) {
        return '<button data-act="statstab" data-t="' + x.id + '" aria-pressed="' + (x.id === tab) + '">' + esc(x.short ? shortTitle(x) : x.title) + "</button>";
      }).join("");
    if (tab === "overview") return renderOverview(tabs, lv);
    return renderTrackStats(tab, tabs, lv);
  }
  function shortTitle(t) { return { oct: "OCT", disc: "Disc", dr: "DR", rop: "ROP" }[t.id] || t.title; }

  function renderTrackStats(trackId, tabs, lv) {
    var t = track(trackId), key = D.levelKey(t.id, lv), deck = st.decks[t.id];
    var opts = D.optionsFor(t, deck, lv);
    var rows = C.classStats(st.store, key, opts.map(function (o) { return o.id; }));
    var label = {}; opts.forEach(function (o) { label[o.id] = o.label; });
    var total = 0, ok = 0;
    rows.forEach(function (r) { total += r.n; ok += r.ok; });
    var c = C.counts(D.levelDeck(t, deck, lv), st.store, today());
    var body = rows.map(function (r) {
      var pct = r.acc == null ? null : Math.round(r.acc * 100);
      return '<li class="oph-srow"><div class="oph-srow-h"><span>' + esc(label[r.a]) + "</span><b>" +
        (pct == null ? '<span class="oph-mut">no answers yet</span>' : pct + "%") + "</b></div>" +
        '<div class="oph-bar" aria-hidden="true"><i style="width:' + (pct || 0) + '%"></i></div>' +
        '<div class="oph-small">' + (r.n ? r.ok + " of " + r.n + " right" : "") +
        (r.confusedWith ? " · most often called " + esc(label[r.confusedWith] || r.confusedWith) : "") + "</div></li>";
    }).join("");
    paint(top("Back", "Your accuracy", esc(st.cfg.levels[lv].label) + " level") +
      '<div class="oph-scroll oph-pad"><div class="oph-seg oph-tabs" role="group" aria-label="Track">' + tabs + "</div>" +
      '<p class="oph-stat-line">' + (total ? Math.round(ok * 100 / total) + "% right over " + fmt(total) + " answers" : "No answers in this track yet") +
      " · " + fmt(c.seen) + " of " + fmt(c.total) + " images seen · " + fmt(c.due) + " due</p>" +
      '<ul class="oph-slist">' + body + "</ul>" + activityHtml() + "</div>");
  }

  // Total answers logged in store.days: drills, case ratings and simulator attempts all count a day.
  function totalAnswers() { var n = 0; Object.keys(st.store.days).forEach(function (d) { n += st.store.days[d]; }); return n; }

  function overviewSummaryLine() {
    var total = totalAnswers();
    if (!total) return null;
    var conf = 0, ok = 0;
    Object.keys(st.store.conf).forEach(function (dk) {
      var d = st.store.conf[dk];
      Object.keys(d).forEach(function (truth) {
        var row = d[truth];
        Object.keys(row).forEach(function (chosen) { conf += row[chosen]; if (chosen === truth) ok += row[chosen]; });
      });
    });
    var streakN = C.streak(st.store, today()), daysActive = Object.keys(st.store.days).length;
    var bits = [];
    if (streakN) bits.push(streakN + (streakN === 1 ? " day" : " days") + " in a row");
    bits.push(fmt(total) + (total === 1 ? " answer" : " answers"));
    if (conf) bits.push(Math.round(ok * 100 / conf) + "% right");
    bits.push(fmt(daysActive) + (daysActive === 1 ? " day" : " days") + " active");
    return bits.join(" · ");
  }

  function memoryNowHtml(lv) {
    var rows = drillTracks().map(function (t) {
      var key = D.levelKey(t.id, lv), deck = st.decks[t.id];
      var c = C.counts(D.levelDeck(t, deck, lv), st.store, today());
      var rec = C.recall(st.store, key, today());
      var pct = rec.meanR == null ? null : Math.round(rec.meanR * 100);
      return '<li><div class="oph-srow-h"><span>' + esc(t.clinic) + "</span><b>" +
        (pct == null ? '<span class="oph-mut">not started</span>' : pct + "% predicted recall") + "</b></div>" +
        '<div class="oph-small">' + fmt(c.seen) + " of " + fmt(c.total) + " images seen</div></li>";
    }).join("");
    return '<h2 class="oph-h2">Memory now</h2><ul class="oph-slist">' + rows + "</ul>" +
      '<p class="oph-small">Predicted recall is the memory model’s estimate of how many of the images you have seen you would get right today.</p>';
  }

  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function forecastHtml() {
    var days = C.forecast(st.store, today(), 7), w0 = new Date().getDay(), max = 1;
    days.forEach(function (n) { if (n > max) max = n; });
    var total = days.reduce(function (a, b) { return a + b; }, 0);
    var bars = days.map(function (n, i) {
      return '<div class="oph-fc-col"><i style="height:' + (n ? Math.max(8, Math.round(n * 100 / max)) : 3) + '%"></i><span>' + WEEKDAYS[(w0 + i) % 7] + "</span></div>";
    }).join("");
    return '<h2 class="oph-h2">Next 7 days</h2><div class="oph-fc" role="img" aria-label="Reviews due, next 7 days: ' + days.join(", ") + '">' + bars + "</div>" +
      '<p class="oph-small">' + (total ? fmt(total) + (total === 1 ? " review" : " reviews") + " due, including anything overdue today." : "Nothing due in the next week.") + "</p>";
  }

  function heatmapLevel(n, max) { if (!n) return 0; var f = n / max; return f > 0.75 ? 4 : f > 0.5 ? 3 : f > 0.25 ? 2 : 1; }
  function activityHeatmapHtml() {
    var N = 84, d0 = today(), counts = [], max = 1, i;
    for (i = N - 1; i >= 0; i--) { var n = st.store.days[d0 - i] || 0; counts.push(n); if (n > max) max = n; }
    var active = counts.filter(function (n) { return n > 0; }).length;
    var cells = counts.map(function (n) { return '<i class="oph-hm-' + heatmapLevel(n, max) + '"></i>'; }).join("");
    return '<h2 class="oph-h2">Last 12 weeks</h2>' +
      '<div class="oph-hm" role="img" aria-label="Answers per day over the last 12 weeks: ' + fmt(active) + ' active days of 84, busiest day ' + fmt(max) + (max === 1 ? " answer" : " answers") + '.">' + cells + "</div>" +
      '<div class="oph-hm-legend"><span>Less</span><i class="oph-hm-0"></i><i class="oph-hm-1"></i><i class="oph-hm-2"></i><i class="oph-hm-3"></i><i class="oph-hm-4"></i><span>More</span></div>';
  }

  // Weak spots (lowest accuracy) and Strengths (highest), any clinic, current level, at least 4 answers.
  function weakStrengthHtml(lv) {
    var all = [];
    drillTracks().forEach(function (t) {
      var key = D.levelKey(t.id, lv), opts = D.optionsFor(t, st.decks[t.id], lv), label = {};
      opts.forEach(function (o) { label[o.id] = o.label; });
      C.classStats(st.store, key, opts.map(function (o) { return o.id; })).forEach(function (r) {
        if (r.n >= 4) all.push({ t: t, a: r.a, label: label[r.a], acc: r.acc, n: r.n, cw: r.confusedWith, cwLabel: label[r.confusedWith] });
      });
    });
    if (!all.length) return "";
    function row(x, drillable) {
      var pct = Math.round(x.acc * 100), b = x.cw || x.a;
      return '<li><div class="oph-srow-h"><span>' + esc(x.label) + "</span><b>" + pct + "%</b></div>" +
        '<div class="oph-small">' + esc(x.t.clinic) + " · " + fmt(x.n) + " answers" + (x.cw ? " · most often called " + esc(x.cwLabel || x.cw) : "") + "</div>" +
        (drillable ? '<button class="oph-btn sec oph-drill" data-act="drill" data-t="' + esc(x.t.id) + '" data-a="' + esc(x.a) + '" data-b="' + esc(b) + '">Drill</button>' : "") + "</li>";
    }
    // A weak spot is below 80% right; a strength is 90% or better. Neither list pads itself out.
    var weak = all.filter(function (x) { return x.acc < 0.8; }).sort(function (x, y) { return x.acc - y.acc; }).slice(0, 3);
    var strong = all.filter(function (x) { return x.acc >= 0.9; }).sort(function (x, y) { return y.acc - x.acc; }).slice(0, 3);
    return '<h2 class="oph-h2">Weak spots</h2><ul class="oph-slist oph-ws">' + weak.map(function (x) { return row(x, true); }).join("") + "</ul>" +
      '<h2 class="oph-h2">Strengths</h2><ul class="oph-slist oph-ws">' + strong.map(function (x) { return row(x, false); }).join("") + "</ul>";
  }

  function simsStatsHtml() {
    var sims = G.OPHTHALMOS._sims || [];
    var rows = sims.map(function (s) {
      var r = (st.store.sims || {})[s.id];
      if (!r || !r.n) return "";
      var errs = s.errs || {};
      var errRows = Object.keys(r.err || {}).sort(function (a, b) { return r.err[b] - r.err[a]; }).map(function (k) {
        return "<li>" + esc(errs[k] || k) + ": " + fmt(r.err[k]) + "</li>";
      }).join("");
      return '<li><div class="oph-srow-h"><span>' + esc(s.title) + "</span><b>" + fmt(r.ok) + " of " + fmt(r.n) + "</b></div>" +
        (errRows ? '<ul class="oph-err">' + errRows + "</ul>" : '<p class="oph-small">No errors recorded.</p>') + "</li>";
    }).join("");
    if (!rows) return "";
    return '<h2 class="oph-h2">Simulators</h2><ul class="oph-slist">' + rows + "</ul>";
  }

  function renderOverview(tabs, lv) {
    var summary = overviewSummaryLine();
    var body = summary
      ? '<p class="oph-stat-line">' + summary + "</p>" + memoryNowHtml(lv) + forecastHtml() + activityHeatmapHtml() + weakStrengthHtml(lv) + simsStatsHtml()
      : '<div class="oph-today"><p class="oph-today-line">No answers yet. Start a clinic to see your memory, forecast and accuracy build up here.</p>' +
        '<button class="oph-btn pri oph-wide" data-act="today">' + ico("play") + " Start clinic</button></div>";
    paint(top("Back", "Your accuracy", esc(st.cfg.levels[lv].label) + " level") +
      '<div class="oph-scroll oph-pad"><div class="oph-seg oph-tabs" role="group" aria-label="Track">' + tabs + "</div>" + body + "</div>");
  }

  // Last 14 days of answers, as real counts. Bars scale to the busiest day.
  function activityHtml() {
    var d0 = today(), days = [], max = 1;
    for (var d = d0 - 13; d <= d0; d++) { var n = st.store.days[d] || 0; days.push(n); if (n > max) max = n; }
    var streak = C.streak(st.store, d0);
    return '<h3 class="oph-h3">Last 14 days</h3><div class="oph-days" role="img" aria-label="Answers per day, last 14 days: ' + days.join(", ") + '">' +
      days.map(function (n) { return '<i style="height:' + (n ? Math.max(8, Math.round(n * 100 / max)) : 3) + '%"></i>'; }).join("") +
      '</div><p class="oph-small">' + (streak ? streak + (streak === 1 ? " day" : " days") + " in a row" : "No study streak yet") + "</p>";
  }

  /* ---------- sources (CC BY attribution lives here) ---------- */
  function renderSources() {
    st.view = "sources";
    var src = st.cfg.sources;
    var list = st.cfg.tracks.map(function (t) {
      var s = src[t.source];
      return "<li><b>" + esc(t.title) + "</b><span>" + esc(s.name) + " · " + esc(s.license) + "</span><p>" + esc(s.cite) + "</p></li>";
    }).join("");
    paint(top("Back", "Images and sources", "Open datasets, credited") +
      '<div class="oph-scroll oph-pad"><p>Every image is a real clinical image from an openly licensed research dataset, downloaded from its authors’ repository. Answers are the dataset’s own labels.</p>' +
      '<ul class="oph-sources">' + list + "</ul>" +
      '<p class="oph-note">' + esc(st.cfg.reviewNote) + "</p></div>");
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-act]");
    if (!b || !root().contains(b)) return;
    var a = b.getAttribute("data-act");
    if (a === "back") return back();
    if (a === "maik") { try { G.SMD_askMaik(b.getAttribute("data-q")); } catch (x) {} return; }
    if (a === "retry") return open();
    if (a === "sources") return renderSources();
    if (a === "stats") return renderStats();
    if (a === "statstab") return renderStats(b.getAttribute("data-t"));
    if (ACTIONS[a]) return ACTIONS[a](b, e);
  }
  function onKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (KEYS[st.view]) KEYS[st.view](e);
  }
  var ACTIONS = {}, KEYS = {};

  if (G.document && G.document.addEventListener)
    G.document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !isOpen() || maikOpen()) return; // MaiK above us owns Escape
      e.preventDefault();
      back();
    });

  G.OPHTHALMOS = { open: open, close: close, isOpen: isOpen, back: back,
    _sims: [], // simulator files register {id, title, sub, icon, open(), line(rec)?} here
    _banks: [], // question banks register {id, title, sub, icon, open(), line()} here
    _tools: [], // calculator files register {id, title, sub, icon, src, open()} here (ophthalmos-tools.js)
    _reads: [], // reading files register {id, title, sub, icon, open(), line(), load()?, thumbs()?} here
    _st: st, _internal: { leave: leave, getJSON: getJSON, maikBtn: maikBtn, paint: paint, top: top, ico: ico, esc: esc, imgUrl: imgUrl, haptic: haptic, isPro: isPro, showPro: showPro,
      save: save, ls: ls, today: today, fmt: fmt, track: track, level: level, levelLocked: levelLocked, drillTracks: drillTracks, gate: gate, lockBadge: lockBadge, trial: trial, setRet: setRet, lang: lang, t: t,
      renderStats: renderStats, renderSources: renderSources, shortTitle: shortTitle, ACTIONS: ACTIONS, KEYS: KEYS,
      SESSION_SIZE: SESSION_SIZE, NEW_CAP: NEW_CAP } };
  // The layout layer (ophthalmos-screens.js) attaches renderHub and the drill.
  function renderHub() { return G.OPHTHALMOS._renderHub ? G.OPHTHALMOS._renderHub() : null; }
})(typeof window !== "undefined" ? window : this);
