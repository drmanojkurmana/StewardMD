/* Interactive figure viewer (window.SMD_FIG). ES5.
 * Opens a self-contained figure page (prep/figures/<name>.html, built with the Anima kit, MIT: prep/figures/ANIMA-LICENSE.txt)
 * full screen over whatever is open, in the app's theme: <name>.html is the dark build, <name>-light.html the light one.
 *   SMD_FIG.open({ src: "prep/figures/beta-blockers.html", title, from: element, query: "d=2&name=Metoprolol" })
 *   SMD_FIG.close() -> true when one was open;  SMD_FIG.isOpen()
 * The page is our own static file (same origin), so it runs in an iframe that is sized to its content; the sheet scrolls and
 * is at least 760 px wide, so a phone scrolls sideways instead of shrinking the drawing to unreadable text.
 */
(function (G) {
  "use strict";
  var D = G.document; if (!D) return;
  var FIG_RE = /^prep\/figures\/[a-z0-9-]{2,60}\.html$/, cur = null;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function css() {
    if (D.getElementById("smdFigCss")) return;
    var st = D.createElement("style"); st.id = "smdFigCss";
    st.textContent = ".smdfig{position:fixed;inset:0;z-index:2000;display:flex;flex-direction:column;background:#111;color:#eee;font:15px/1.4 system-ui,sans-serif}" +
      ".smdfig.lt{background:#f6f7f5;color:#14202b}" +
      ".smdfig-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px 16px}" +
      ".smdfig-top p{margin:0;font-weight:600}.smdfig-x{min-width:44px;min-height:44px;border:0;border-radius:22px;background:rgba(128,128,128,.25);color:inherit;font:600 20px/1 system-ui;cursor:pointer}" +
      ".smdfig-sc{flex:1;overflow:auto;-webkit-overflow-scrolling:touch}.smdfig-fr{display:block;width:max(100%,760px);height:1900px;border:0}" +
      ".smdfig-h{display:block;font-weight:400;font-size:12px;opacity:.7}.smdfig-x:focus-visible{outline:2px solid currentColor;outline-offset:2px}";
    D.head.appendChild(st);
  }
  function pageOf(src, dark) {
    var base = (G.SMD_PREP_BASE || "/prep/").replace(/prep\/$/, "");
    return (base || "/") + (dark ? src : src.replace(/\.html$/, "-light.html"));
  }
  function close() {
    if (!cur) return false;
    try { cur.el.parentNode && cur.el.parentNode.removeChild(cur.el); } catch (e) {}
    D.removeEventListener("keydown", cur.key, true);
    var from = cur.from; cur = null;
    try { if (from && from.focus) from.focus(); } catch (e) {}
    return true;
  }
  function open(o) {
    o = o || {};
    var src = String(o.src || "");
    if (!FIG_RE.test(src) || cur) return false;
    css();
    var dark = D.body.classList.contains("dark"), q = String(o.query || "").replace(/[^A-Za-z0-9=&%._ -]/g, "").slice(0, 120);
    var el = D.createElement("div");
    el.className = "smdfig" + (dark ? "" : " lt"); el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", String(o.title || "Interactive figure"));
    el.innerHTML = '<div class="smdfig-top"><p>' + esc(o.title || "Interactive figure") + (G.innerWidth < 760 ? '<small class="smdfig-h">Scroll sideways to see all of it</small>' : "") + '</p><button type="button" class="smdfig-x" aria-label="Close the figure">&#10005;</button></div>' +
      '<div class="smdfig-sc"><iframe class="smdfig-fr" title="' + esc(o.title || "Interactive figure") + '" src="' + esc(pageOf(src, dark) + (q ? "?" + q : "")) + '" sandbox="allow-scripts allow-same-origin"></iframe></div>';
    var fr = el.querySelector("iframe");
    fr.addEventListener("load", function () { try { var h = fr.contentDocument.documentElement.scrollHeight; if (h > 200) fr.style.height = h + "px"; } catch (e) {} });
    el.querySelector(".smdfig-x").addEventListener("click", close);
    var key = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    D.addEventListener("keydown", key, true);
    D.body.appendChild(el);
    cur = { el: el, from: o.from || null, key: key };
    try { el.querySelector(".smdfig-x").focus(); } catch (e) {}
    return true;
  }
  /* ---- registry (prep/figures/figures.json): one figure, every place it helps ----
   * A figure lists the drug names it explains (name -> preset query) and class phrases. The same text match serves the Drugs
   * page (forDrug), MCQ explanations, lesson steps and Knowledge Library articles (matchText on the text shown there).
   * Names match whole words, case-insensitive; a class phrase counts as a hit too. Nothing shows until the registry is loaded. */
  var REG = null, regP = null;
  function esc2(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function build(j) {
    var figs = (j && j.figures) || [];
    return figs.filter(function (f) { return f && FIG_RE.test(String(f.page || "")); }).map(function (f) {
      var names = Object.keys(f.drugs || {});
      var parts = names.map(esc2).concat((f.terms || []).map(String));
      var rx = null; try { rx = parts.length ? new RegExp("(?:^|[^a-z])(" + parts.join("|") + ")(?![a-z])", "gi") : null; } catch (e) { rx = null; }
      return { id: String(f.id), title: String(f.title || "Interactive figure"), blurb: String(f.blurb || ""), page: String(f.page), drugs: f.drugs || {}, rx: rx };
    });
  }
  function ready() {
    if (REG) return Promise.resolve(REG);
    if (regP) return regP;
    var base = (G.SMD_PREP_BASE || "/prep/").replace(/prep\/$/, "");
    regP = G.fetch((base || "/") + "prep/figures/figures.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { REG = build(j); return REG; }, function () { REG = []; return REG; });
    return regP;
  }
  function byId(id) { for (var i = 0; REG && i < REG.length; i++) if (REG[i].id === id) return REG[i]; return null; }
  /* matchText(text, max) -> [{ id, title, blurb, hits, query }] most hits first (sync; [] until ready()). query presets the figure
     to the first drug of that figure named in the text. */
  function matchText(text, max) {
    var t = String(text || ""), out = [];
    (REG || []).forEach(function (f) {
      if (!f.rx) return;
      f.rx.lastIndex = 0;
      var m, hits = 0, first = "";
      while ((m = f.rx.exec(t))) { hits++; var nm = String(m[1]).toLowerCase(); if (!first && f.drugs[nm]) first = f.drugs[nm] + "&name=" + encodeURIComponent(nm.charAt(0).toUpperCase() + nm.slice(1)); if (hits > 50) break; }
      if (hits) out.push({ id: f.id, title: f.title, blurb: f.blurb, hits: hits, query: first });
    });
    out.sort(function (a, b) { return b.hits - a.hits; });
    return out.slice(0, max || 1);
  }
  function forDrug(name) {
    var w = String(name || "").toLowerCase().replace(/[^a-z ]/g, " ").trim().split(/\s+/)[0] || "";
    for (var i = 0; REG && i < REG.length; i++) if (w && REG[i].drugs[w]) return { id: REG[i].id, title: REG[i].title, blurb: REG[i].blurb, name: w, query: REG[i].drugs[w] + "&name=" + encodeURIComponent(w.charAt(0).toUpperCase() + w.slice(1)) };
    return null;
  }
  function openFig(id, query, from) {
    var f = byId(id); if (!f) return false;
    return open({ src: f.page, title: f.title, from: from, query: query || "" });
  }
  /* chipHtml(m): the "See how it works" button for a matchText hit; the host's click handler calls openFig(data-f, data-q). */
  function chipHtml(m, cls, act) {
    if (!m) return "";
    return '<button type="button" class="' + esc(cls || "smdfig-chip") + '" data-act="' + (act || "fig-open") + '" data-f="' + esc(m.id) + '" data-q="' + esc(m.query || "") + '"><span aria-hidden="true">&#9654;</span> <b>' + esc(m.title) + "</b></button>";
  }
  G.SMD_FIG = { open: open, close: close, isOpen: function () { return !!cur; }, _re: FIG_RE, ready: ready, matchText: matchText, forDrug: forDrug, openFig: openFig, chipHtml: chipHtml, _build: build };
  ready();
})(typeof window !== "undefined" ? window : this);
