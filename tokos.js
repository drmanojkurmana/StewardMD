/* Tokós: OBGYN CTG reading trainer, a StewardMD module. DOM layer, ES5.
   Host contract mirrors Ophthalmós: open() hides home, close() restores it, back() unwinds
   one layer (swipe-back.js and Escape call it). Content is ai_drafted; every screen carries
   the draft footer until clinical review (see .tok-draft below, matches .oph-draft). */
(function (G) {
  "use strict";
  var C = G.TOKOS_CORE, D = G.TOKOS_DATA, S = G.TOKOS_STAGE;
  var BASE = G.SMD_TOKOS_BASE || "/tokos/";

  var st = { view: "hub", cfg: null, decks: {}, store: null, prefs: null, loading: null, err: null, session: null, caseIdx: 0 };

  function $(id) { return G.document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function isPro() { try { return !!(G.SMD_PRO && G.SMD_PRO.isProSync && G.SMD_PRO.isProSync()); } catch (e) { return false; } }
  function showPro() {
    try { if (G.SMD_PRO_NOTICE && G.SMD_PRO_NOTICE.show) return G.SMD_PRO_NOTICE.show("tokos"); } catch (e) {}
    try { if (G.SMD_PRO && G.SMD_PRO.openPaywall) return G.SMD_PRO.openPaywall("tokos"); } catch (e) {}
    try { if (G.toast) G.toast("This level is part of StewardMD Pro"); } catch (e) {}
  }
  function ls() { try { return G.localStorage; } catch (e) { return null; } }
  function save() { D.saveStore(ls(), st.store); }
  function today() { return D.today(Date.now()); }
  function level() { return st.prefs.level === "resident" ? "resident" : "mbbs"; }
  function levelLocked(lv) { return D.levelLocked(st.cfg, lv || level(), isPro()); }
  function trial(featureId) { return D.trialState(st.store, featureId, !levelLocked("resident")); }

  // Trial gate: check BEFORE any fetch. A spent trial must never touch the network (Review Focus).
  function gate(featureId, run) {
    var s = trial(featureId);
    if (s === "used") return showPro();
    if (s === "trial") { D.useTrial(st.store, featureId, today()); save(); }
    return run();
  }

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
      return Promise.all(cfg.tracks.map(function (t) { return getJSON(t.deck).then(function (d) { st.decks[t.id] = d; }); }));
    }).catch(function (e) { st.err = e; st.loading = null; throw e; });
    return st.loading;
  }

  function root() {
    var el = $("smdTokos");
    if (!el) {
      el = G.document.createElement("div");
      el.id = "smdTokos";
      G.document.body.appendChild(el);
    }
    el.className = "tok-root" + (el.classList.contains("on") ? " on" : "");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Tokós");
    return el;
  }

  function render() {
    var root = $("smdTokos");
    if (!root) return;
    if (st.view === "hub") root.innerHTML = renderHub();
    else if (st.view === "clinic") root.innerHTML = renderClinic();
    else if (st.view === "reveal") root.innerHTML = renderReveal();
    bind(root);
  }

  function renderHub() {
    if (st.err) return '<div class="tok-err">Could not load Tokós. <button data-act="retry">Try again</button></div>';
    if (!st.cfg) return '<div class="tok-loading">Loading...</div>';
    var lang = st.prefs.lang;
    var t = lang === "hi" ? st.cfg.tracks[0].labelHi : st.cfg.tracks[0].labelEn;
    var locked = levelLocked("resident");
    return '<div class="tok-hub">' +
      '<h1>Tokós</h1>' +
      '<button class="tok-clinic" data-act="clinic" data-t="ctg">' + esc(t) +
      (locked ? '<span class="tok-lock">Pro</span>' : "") + "</button>" +
      '<div class="tok-draft">To be verified, draft</div>' +
      "</div>";
  }

  function renderClinic() {
    var deck = st.decks.ctg, c = deck.cases[st.caseIdx];
    if (!c) return renderHub();
    return '<div class="tok-clinic-view">' +
      '<div class="tok-stage" id="tokStage"><img id="tokTrace" src="' + BASE + "media/" + c.svg + '" alt="CTG trace"/></div>' +
      '<div class="tok-q">Baseline rate band? Variability? Any decelerations sustained 15s or more?</div>' +
      '<button class="tok-btn" data-act="reveal">Reveal</button>' +
      '</div>';
  }

  function renderReveal() {
    var deck = st.decks.ctg, c = deck.cases[st.caseIdx];
    // Review Focus: trace-based features and the real outcome are shown as separate blocks,
    // never combined into one sentence implying one predicts the other.
    return '<div class="tok-reveal">' +
      '<div class="tok-block"><h3>Computed trace features</h3>' +
      "<p>Baseline: " + c.features.baseline + " bpm</p>" +
      "<p>Variability: " + esc(c.features.variabilityBand) + "</p>" +
      "<p>Decelerations (≥15s): " + c.features.decelCount + "</p></div>" +
      '<div class="tok-block"><h3>Actual recorded outcome</h3>' +
      "<p>Umbilical artery pH: " + c.outcome.pH + "</p>" +
      "<p>Base excess: " + c.outcome.BE + "</p>" +
      "<p>Apgar: " + c.outcome.apgar1 + " / " + c.outcome.apgar5 + "</p></div>" +
      '<button class="tok-btn" data-act="next">Next case</button>' +
      "</div>";
  }

  function bind(root) {
    root.onclick = function (e) {
      var el = e.target.closest("[data-act]");
      if (!el) return;
      var act = el.getAttribute("data-act");
      if (act === "clinic") gate("clinic." + el.getAttribute("data-t"), function () {
        st.caseIdx = 0; st.view = "clinic"; render();
      });
      else if (act === "reveal") { st.view = "reveal"; render(); }
      else if (act === "next") { st.caseIdx++; st.view = "clinic"; render(); }
      else if (act === "retry") { st.loading = null; loadAll().then(render).catch(render); }
    };
  }

  function open() {
    root().classList.add("on");
    G.document.body.classList.add("tok-lock");
    try { if (G.SMD_hideHome) G.SMD_hideHome(); } catch (e) {}
    st.view = "hub";
    st.store = D.loadStore(ls());
    st.prefs = D.loadPrefs(ls());
    if (!st.cfg && !st.loading) loadAll().then(render).catch(render);
    else render();
  }
  function isOpen() { var el = $("smdTokos"); return !!(el && el.classList.contains("on")); }
  function close() {
    var el = $("smdTokos");
    if (el) { el.classList.remove("on"); el.innerHTML = ""; }
    G.document.body.classList.remove("tok-lock");
    try { if (G.SMD_showHome) G.SMD_showHome(); } catch (e) {}
    st.view = "hub";
  }
  function back() {
    if (!isOpen()) return false;
    if (st.view === "hub") { close(); return true; }
    if (st.view === "reveal" || st.view === "clinic") { st.view = "hub"; render(); return true; }
    return false;
  }

  G.TOKOS = { open: open, close: close, back: back, isOpen: isOpen, _st: st };
})(typeof window !== "undefined" ? window : this);
