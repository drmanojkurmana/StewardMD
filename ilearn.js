/* iLearn (window.SMD_ILEARN). ES5.
 * One page inside the Knowledge Library that lists every interactive figure in the registry (prep/figures/figures.json, read by
 * fig-viewer.js): the animated scenes and the drug-mechanism figures. Search, two filters, tap a card to open it full screen.
 *   SMD_ILEARN.open()  -> opens the Knowledge Library overlay on the iLearn tab (same as SB.openRef("ilearn"))
 * The Protocols tab is added to this strip by kb-protocols.js, as on every Knowledge Library page.
 *   SMD_ILEARN.render() -> paints into #sbrefBody (called by the SB.openRef wrapper in reasoning.js)
 */
(function (G) {
  "use strict";
  var D = G.document; if (!D) return;
  var st = { q: "", kind: "all" };
  var TABS = [["syndromes", "Syndromes", "microbe"], ["ilearn", "iLearn", "trend"], ["aware", "AWaRe", "aware"], ["guidelines", "Guidelines", "book"]];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ico(n) { try { return n && G.appIco ? G.appIco(n) : ""; } catch (e) { return ""; } }
  function tabsHTML() {
    return '<div class="sbref-tabs">' + TABS.map(function (t) {
      var on = t[0] === "ilearn";
      return '<button type="button" class="sbref-tab' + (on ? " active" : "") + '"' + (on ? ' aria-current="page"' : ' data-il-go="' + t[0] + '"') + ">" + (t[2] ? ico(t[2]) + " " : "") + esc(t[1]) + "</button>";
    }).join("") + "</div>";
  }
  function brand() {
    if (typeof G.SMD_KB_BANNER === "function") return G.SMD_KB_BANNER();
    return '<div class="smd-kb-banner"><img class="smd-kb-logo" src="/logo.png" alt="" width="34" height="34"><div class="smd-kb-brand"><strong>StewardMD</strong><span>Knowledge Base</span></div></div>';
  }
  function all() { return (G.SMD_FIG && G.SMD_FIG.list && G.SMD_FIG.list()) || []; }
  function shown() {
    var q = st.q.trim().toLowerCase();
    return all().filter(function (f) {
      if (st.kind === "scene" && !f.scene) return false;
      if (st.kind === "drug" && f.scene) return false;
      return !q || (f.title + " " + f.blurb).toLowerCase().indexOf(q) >= 0;
    });
  }
  function cardsHTML(list) {
    if (!list.length) return '<p class="il-empty">No matching figures. Try a broader search.</p>';
    return '<div class="il-grid">' + list.map(function (f) {
      return '<button type="button" class="il-card" data-il-open="' + esc(f.id) + '"><span class="il-play" aria-hidden="true">&#9654;</span><span class="il-body"><b>' + esc(f.title) + "</b>" +
        (f.blurb ? "<small>" + esc(f.blurb) + "</small>" : "") + '<i class="il-tag">' + (f.scene ? "Animated scene" : "Drug mechanism") + "</i></span></button>";
    }).join("") + "</div>";
  }
  function paintList(body) {
    var list = shown(), host = body.querySelector("#ilList"), cnt = body.querySelector("#ilCount");
    if (host) host.innerHTML = cardsHTML(list);
    if (cnt) cnt.textContent = list.length + (list.length === 1 ? " figure" : " figures");
  }
  function chip(k, label, n) { return '<button type="button" class="il-chip' + (st.kind === k ? " on" : "") + '" data-il-kind="' + k + '" aria-pressed="' + (st.kind === k) + '">' + label + " <span>" + n + "</span></button>"; }
  function render() {
    var body = D.getElementById("sbrefBody"); if (!body) return;
    var run = function () {
      var a = all(), ns = a.filter(function (f) { return f.scene; }).length;
      body.className = "sbref-body kblib-tool-page kblib-tool-ilearn";
      body.scrollTop = 0;
      var title = D.getElementById("sbrefTitle"); if (title) title.textContent = "Knowledge Library";
      body.innerHTML = tabsHTML() + '<div class="kblib-tool-intro il-intro">' + brand() + "<h1>iLearn</h1>" +
        "<p>Every interactive animation in one place. Move the sliders, change the treatment and watch what happens in the body. Tap a figure to open it.</p>" +
        '<label class="kblib-search-label" for="ilSearch">Search figures</label><div class="kblib-searchbox"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' +
        '<input id="ilSearch" class="kblib-tool-search" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search figures" value="' + esc(st.q) + '"></div>' +
        '<div class="il-chips" role="group" aria-label="Filter figures">' + chip("all", "All", a.length) + chip("scene", "Animated scenes", ns) + chip("drug", "Drug mechanisms", a.length - ns) + "</div>" +
        '<div id="ilCount" class="kblib-tool-count" role="status"></div></div><div id="ilList"></div>';
      paintList(body);
    };
    if (G.SMD_FIG && G.SMD_FIG.ready) G.SMD_FIG.ready().then(run, run); else run();
  }
  function open() { if (G.SB && G.SB.openRef) G.SB.openRef("ilearn"); }
  D.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var body = D.getElementById("sbrefBody"); if (!body || !body.classList.contains("kblib-tool-ilearn") || !body.contains(t)) return;
    var go = t.closest("[data-il-go]");
    if (go) { if (G.SB && G.SB.openRef) G.SB.openRef(go.getAttribute("data-il-go")); return; }
    var kind = t.closest("[data-il-kind]");
    if (kind) { st.kind = kind.getAttribute("data-il-kind"); Array.prototype.forEach.call(body.querySelectorAll(".il-chip"), function (c) { var on = c.getAttribute("data-il-kind") === st.kind; c.classList.toggle("on", on); c.setAttribute("aria-pressed", String(on)); }); paintList(body); return; }
    var card = t.closest("[data-il-open]");
    if (card && G.SMD_FIG && G.SMD_FIG.openFig) G.SMD_FIG.openFig(card.getAttribute("data-il-open"), "", card);
  });
  D.addEventListener("input", function (e) {
    var t = e.target; if (!t || t.id !== "ilSearch") return;
    var body = D.getElementById("sbrefBody"); st.q = t.value || ""; if (body) paintList(body);
  });
  G.SMD_ILEARN = { render: render, open: open };
})(typeof window !== "undefined" ? window : this);
