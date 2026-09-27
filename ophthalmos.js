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
      }));
    }).catch(function (e) { st.err = e; st.loading = null; throw e; });
    return st.loading;
  }
  function track(id) { for (var i = 0; i < st.cfg.tracks.length; i++) if (st.cfg.tracks[i].id === id) return st.cfg.tracks[i]; return null; }
  function level() { return st.prefs.level === "resident" ? "resident" : "foundation"; }
  function levelLocked(lv) { return D.levelLocked(st.cfg, lv || level(), isPro()); }
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
  function paint(html, focusSel) {
    var el = root();
    el.innerHTML = html;
    var f = focusSel && el.querySelector(focusSel);
    try { (f || el.querySelector(".oph-back")).focus({ preventScroll: true }); } catch (e) {}
  }
  function top(backLabel, title, sub, right) {
    return '<div class="oph-top"><button class="oph-back" data-act="back" aria-label="' + esc(backLabel) + '">‹</button>' +
      '<div class="oph-title"><b>' + title + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + "</div>" + (right || "") + "</div>";
  }

  function open() {
    var el = root();
    if (!el.classList.contains("on")) { try { st._prevFocus = G.document.activeElement; } catch (e) { st._prevFocus = null; } }
    try { if (G.SMD_hideHome) G.SMD_hideHome(); } catch (e) {}
    st.store = D.loadStore(ls());
    st.prefs = D.loadPrefs(ls());
    el.classList.add("on");
    G.document.body.classList.add("oph-lock");
    st.view = "hub";
    if (st.cfg && !st.err) return renderHub();
    paint(top("Close", "Ophthalmós", "Loading tracks…") + '<div class="oph-scroll oph-pad"><p class="oph-mut" aria-busy="true">Loading image decks…</p></div>');
    loadAll().then(renderHub, function () { renderLoadError(); });
  }
  function close() {
    var el = $("smdOphthalmos");
    if (el) { el.classList.remove("on"); el.innerHTML = ""; }
    G.document.body.classList.remove("oph-lock");
    try { if (G.SMD_showHome) G.SMD_showHome(); } catch (e) {}
    try { if (st._prevFocus && st._prevFocus.focus) st._prevFocus.focus(); } catch (e) {}
    st._prevFocus = null; st.session = null; st.caseRun = null; st.view = "hub";
  }
  function isOpen() { var el = $("smdOphthalmos"); return !!(el && el.classList.contains("on")); }

  // Layered back: any sub-screen -> hub -> close. Answers are saved as they happen, so leaving a
  // session mid-way loses nothing.
  function back() {
    if (!isOpen()) return false;
    if (st.view === "hub") { close(); return true; }
    st.session = null; st.caseRun = null; st.view = "hub";
    renderHub();
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
  function renderStats(trackId) {
    var t = track(trackId || st.statsTrack || "oct");
    st.statsTrack = t.id; st.view = "stats";
    var lv = level(), key = D.levelKey(t.id, lv), deck = st.decks[t.id];
    var opts = D.optionsFor(t, deck, lv);
    var rows = C.classStats(st.store, key, opts.map(function (o) { return o.id; }));
    var label = {}; opts.forEach(function (o) { label[o.id] = o.label; });
    var total = 0, ok = 0;
    rows.forEach(function (r) { total += r.n; ok += r.ok; });
    var c = C.counts(D.levelDeck(t, deck, lv), st.store, today());
    var tabs = drillTracks().map(function (x) {
      return '<button data-act="statstab" data-t="' + x.id + '" aria-pressed="' + (x.id === t.id) + '">' + esc(x.short ? shortTitle(x) : x.title) + "</button>";
    }).join("");
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
  function shortTitle(t) { return { oct: "OCT", disc: "Disc", dr: "DR", rop: "ROP" }[t.id] || t.title; }

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
      if (e.key !== "Escape" || !isOpen()) return;
      e.preventDefault();
      back();
    });

  G.OPHTHALMOS = { open: open, close: close, isOpen: isOpen, back: back,
    _st: st, _internal: { paint: paint, top: top, ico: ico, esc: esc, imgUrl: imgUrl, haptic: haptic, isPro: isPro, showPro: showPro,
      save: save, ls: ls, today: today, fmt: fmt, track: track, level: level, levelLocked: levelLocked, drillTracks: drillTracks,
      renderStats: renderStats, renderSources: renderSources, shortTitle: shortTitle, ACTIONS: ACTIONS, KEYS: KEYS,
      SESSION_SIZE: SESSION_SIZE, NEW_CAP: NEW_CAP } };
  // The layout layer (ophthalmos-screens.js) attaches renderHub and the drill.
  function renderHub() { return G.OPHTHALMOS._renderHub ? G.OPHTHALMOS._renderHub() : null; }
})(typeof window !== "undefined" ? window : this);
