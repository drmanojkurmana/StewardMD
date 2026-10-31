/* Kardia calculators (Kardia 2.0): searchable echo calculator suite on KCALC data.
   ES5 IIFE. Content ai_drafted pending owner review; every result names its source.
   Design: Operate mode on Kardia tokens; single column; states covered: loading
   (data missing), empty search, invalid input, offline (all local, note shown),
   long names wrap. Motion: 140ms var(--kd-ease), transform/opacity only. */
(function (G) {
  "use strict";
  var S = { host: null, I: null, cur: null, q: "", cat: "All", favs: {}, recent: [], vals: {}, units: {}, nav: null };
  try { var raw = G.localStorage && G.localStorage.getItem("smd_kcalc_v1"); if (raw) { var p = JSON.parse(raw); S.favs = p.favs || {}; S.recent = p.recent || []; } } catch (e) {}
  function save() { try { G.localStorage.setItem("smd_kcalc_v1", JSON.stringify({ favs: S.favs, recent: S.recent })); } catch (e) {} }
  function esc(s) { return S.I ? S.I.esc(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function data() { return G.KCALC || null; }
  function calcById(id) { var d = data(); if (!d) return null; for (var i = 0; i < d.calcs.length; i++) if (d.calcs[i].id === id) return d.calcs[i]; return null; }
  function cats() { var d = data(), out = ["All"], seen = { All: 1 }; if (d) d.calcs.forEach(function (c) { if (!seen[c.cat]) { seen[c.cat] = 1; out.push(c.cat); } }); return out; }
  function filtered() { var d = data(); if (!d) return []; var q = S.q.toLowerCase(); return d.calcs.filter(function (c) { return (S.cat === "All" || c.cat === S.cat) && (!q || (c.name + " " + c.id + " " + c.cat).toLowerCase().indexOf(q) >= 0); }); }
  var FIG = {
    plax: "Parasternal long axis. Measure LV and aorta perpendicular to the long axis at the mitral leaflet tips.",
    a4c: "Apical four chamber, RV or LV focused as named. Trace or measure at end diastole and end systole as the formula states.",
    a5c: "Apical five chamber. LVOT diameter in PLAX systole; pulsed Doppler just below the aortic valve; continuous wave through the valve.",
    rv: "RV focused apical four chamber. Keep the RV apex in view; avoid foreshortening.",
    psax: "Parasternal short axis at the aortic valve. Align RVOT and pulmonic Doppler with flow.",
    subcostal: "Subcostal window. IVC just below the right atrium; hepatic vein pulsed Doppler during free breathing.",
    ivc: "Subcostal IVC, 1 to 2 cm below the right atrium, through a sniff or quiet inspiration.",
    arch: "Suprasternal arch long axis. Continuous wave down the descending aorta; compare arm and leg cuff pressures.",
    ductal: "Ductal view from high parasternal or suprasternal. Align with ductal flow.",
    physics: "Doppler and physics: keep the angle at 20 degrees or less and set scale so the envelope fills the display.",
    body: "Height and weight measured today, same scales for serial indexed values.",
    generic: "Standard echo windows for this measure. Keep the Doppler angle at 20 degrees or less."
  };
  function figLoaded() { return !!(G.KCALC_FIG && G.KCALC_FIG_DATA); }
  function loadFigs() {
    if (figLoaded() || S.figLoading) return; S.figLoading = 1;
    var pending = ["kardia-calc-fig-data.js", "kardia-calc-fig.js"], i = 0;
    function next() {
      if (i >= pending.length) { S.figLoading = 0; repaint(); return; }
      var tok = (G.KARDIA_LOADER && G.KARDIA_LOADER.V) || "krd16";
      var s = G.document.createElement("script"); s.src = "/" + pending[i++] + "?v=" + tok; s.async = false;
      s.onload = next; s.onerror = next; G.document.head.appendChild(s);
    }
    if (G.document && G.document.head) next(); else S.figLoading = 0;
  }
  function figureHtml(c) {
    if (!figLoaded()) { loadFigs(); return '<div class="kcalc-figload" role="status">Loading the measurement figure. It works offline once loaded.</div>'; }
    var f = G.KCALC_FIG.get(c.id);
    if (!f) return figSvg(c);
    var reduced = G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return '<figure class="kcalc-figure">' +
      '<canvas class="kcalc-canvas" data-kcalc-fig="' + esc(c.id) + '" width="640" height="420" role="img" aria-label="' + esc(f.caption + " Key frame: " + f.keyLabel + ".") + '"></canvas>' +
      '<p class="kcalc-phase" data-kcalc-phase="' + esc(c.id) + '">' + (reduced ? "Key frame: " + esc(f.keyLabel) : "Playing: one ECG clock") + "</p>" +
      '<figcaption class="kcalc-figcap">' + esc(f.caption) + "</figcaption>" +
      '<p class="kcalc-measure"><strong>What to measure:</strong> ' + esc(f.measure) + "</p>" +
      '<p class="kcalc-pitfall"><strong>Common pitfall:</strong> ' + esc(f.pitfall) + "</p>" +
      '<p class="kcalc-attr">' + esc(f.attribution) + "</p>" +
      '<button type="button" class="kcalc-figbtn" data-act="kcalc-fig-toggle" aria-pressed="' + (!reduced && S.figPlay !== false) + '">' + (reduced ? "Reduced motion: key frame shown" : S.figPlay === false ? "Play figure" : "Pause figure") + "</button></figure>";
  }
  function figSvg(c) {
    var t = c.fig || "generic";
    return '<svg class="kcalc-fig" viewBox="0 0 320 150" role="img" aria-label="' + esc(FIG[t] || FIG.generic) + '">' +
      '<path d="M160 12 L62 132 A118 118 0 0 0 258 132 Z" fill="none" stroke="currentColor" stroke-width="2" opacity="0.55"/>' +
      '<ellipse cx="138" cy="88" rx="42" ry="30" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<ellipse cx="196" cy="82" rx="28" ry="24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.75"/>' +
      '<line x1="96" y1="88" x2="180" y2="88" stroke="var(--sp-acc)" stroke-width="3"/>' +
      '<line x1="160" y1="12" x2="160" y2="46" stroke="var(--sp-warn)" stroke-width="3"/>' +
      '<circle cx="160" cy="12" r="5" fill="var(--sp-acc)"/></svg>' +
      '<p class="kcalc-figcap">' + esc(FIG[t] || FIG.generic) + "</p>";
  }
  var ALT = { "cm": { u: "mm", f: 10 }, "mm": { u: "cm", f: 0.1 }, "m/s": { u: "cm/s", f: 100 }, "cm/s": { u: "m/s", f: 0.01 }, "kg": { u: "lb", f: 2.20462 } };
  function valOf(c, inp) { var v = S.vals[c.id + ":" + inp.k]; if (v == null || v === "") v = inp.d; var n = parseFloat(v); var u = S.units[c.id + ":" + inp.k]; if (u && ALT[inp.u] && u === ALT[inp.u].u) n = n / ALT[inp.u].f; return n; }
  function computeCurrent(c) { var ins = {}; c.inputs.forEach(function (inp) { ins[inp.k] = valOf(c, inp); }); return data().compute(c.id, ins); }
  function invalid(c) { for (var i = 0; i < c.inputs.length; i++) { var inp = c.inputs[i], n = valOf(c, inp); if (!isFinite(n) || n < inp.lo * 0.2 || n > inp.hi * 3) return inp; } return null; }
  function resultHtml(c) {
    var bad = invalid(c);
    if (bad) return '<div class="kcalc-result kcalc-err" id="kcalc-result-' + c.id + '" role="alert">Check ' + esc(bad.l) + ": value is outside the sensible range (" + bad.lo + " to " + bad.hi + " " + esc(bad.u) + ").</div>";
    var r = computeCurrent(c); if (!r) return '<div class="kcalc-result" id="kcalc-result-' + c.id + '">Result unavailable.</div>';
    var tone = r.g ? r.g.tone : "ok";
    return '<div class="kcalc-result" id="kcalc-result-' + c.id + '"><div class="kcalc-rrow"><span class="kcalc-rlabel">' + esc(c.out.l) + '</span>' +
      '<span class="kcalc-rval">' + r.v + " <small>" + esc(c.out.u) + "</small></span></div>" +
      (r.extra ? '<p class="kcalc-extra">' + esc(r.extra) + "</p>" : "") +
      (r.g ? '<p class="kcalc-grade kcalc-t-' + tone + '">' + esc(r.g.grade) + '</p><p class="kcalc-gdetail">' + esc(r.g.detail) + "</p>" : "") +
      '<p class="kcalc-src">Source: ' + esc(c.source) + ". Draft, to be verified.</p></div>";
  }
  function formulaHtml(c) {
    var chips = c.inputs.map(function (inp, i) { return '<span class="kcalc-var kcalc-v' + (i % 4) + '">' + esc(inp.l) + "</span>"; }).join(' <span aria-hidden="true">·</span> ');
    return '<p class="kcalc-formula"><span class="kcalc-var kcalc-vout">' + esc(c.out.l) + "</span> <span aria-hidden=\"true\">= f(</span>" + chips + '<span aria-hidden="true">)</span></p><p class="kcalc-how">' + esc(c.how) + "</p>";
  }
  function listHtml() {
    var d = data();
    if (!d) return '<div class="kcalc-empty" role="alert"><h2>Calculators could not load</h2><p>Check the app files and try again. No connection is needed once loaded.</p><button type="button" class="sp-btn sec" data-act="kcalc-retry">Try again</button></div>';
    var list = filtered();
    var favList = d.calcs.filter(function (c) { return S.favs[c.id]; });
    var recentList = S.recent.map(calcById).filter(Boolean).slice(0, 6);
    var h = '<div class="kcalc-head"><h2>Calculators</h2><p class="kcalc-sub">Echo calculators with grading, worked examples and the view to measure in. Works offline.</p></div>';
    h += '<label class="kcalc-searchlab" for="kcalc-search">Search calculators</label><input id="kcalc-search" class="kcalc-search" type="search" autocomplete="off" placeholder="Search stenosis, strain, pressure" value="' + esc(S.q) + '">';
    h += '<div class="kcalc-chips" role="group" aria-label="Category">' + cats().map(function (cat) { return '<button type="button" class="kcalc-chip" data-act="kcalc-cat" data-v="' + esc(cat) + '" aria-pressed="' + (S.cat === cat) + '">' + esc(cat) + "</button>"; }).join("") + "</div>";
    if (!S.q && S.cat === "All" && favList.length) h += '<h3 class="kcalc-sec">Favourites</h3>' + favList.map(rowHtml).join("");
    if (!S.q && S.cat === "All" && recentList.length) h += '<h3 class="kcalc-sec">Recently used</h3>' + recentList.map(rowHtml).join("");
    h += '<h3 class="kcalc-sec">' + (S.q || S.cat !== "All" ? list.length + " found" : "All calculators") + "</h3>";
    if (!list.length) h += '<div class="kcalc-empty"><h2>No calculators found</h2><p>Try a shorter word, for example stenosis, strain or pressure. Long names wrap and are never cut off.</p><button type="button" class="sp-btn sec" data-act="kcalc-clear">Clear search</button></div>';
    else h += list.map(rowHtml).join("");
    return h;
  }
  function rowHtml(c) {
    return '<div class="kcalc-row"><button type="button" class="kcalc-item" id="kcalc-item-' + c.id + '" data-act="kcalc-open" data-id="' + c.id + '"><span class="kcalc-itemname">' + esc(c.name) + '</span><span class="kcalc-itemcat">' + esc(c.cat) + " · " + esc(c.source) + '</span></button>' +
      '<button type="button" class="kcalc-fav" data-act="kcalc-fav" data-id="' + c.id + '" aria-pressed="' + !!S.favs[c.id] + '" aria-label="Favourite ' + esc(c.name) + '">' + (S.favs[c.id] ? "Saved" : "Save") + "</button></div>";
  }
  function detailHtml(c) {
    var h = '<button type="button" class="sp-btn sec kcalc-back" data-act="kcalc-list">Back to calculators</button>';
    h += '<div class="kcalc-head"><h2>' + esc(c.name) + '</h2><p class="kcalc-sub">' + esc(c.cat) + " · " + esc(c.source) + "</p></div>";
    h += '<button type="button" class="kcalc-fav kcalc-favbig" data-act="kcalc-fav" data-id="' + c.id + '" aria-pressed="' + !!S.favs[c.id] + '">' + (S.favs[c.id] ? "Saved as favourite" : "Save as favourite") + "</button>";
    h += '<button type="button" class="sp-btn sec kcalc-copy" data-act="kcalc-copylink" data-id="' + c.id + '" aria-label="Copy link to ' + esc(c.name) + '">Copy link</button>';
    h += '<section aria-label="Where to measure"><h3 class="kcalc-sec">Where to measure</h3>' + figureHtml(c) + "</section>";
    h += '<section aria-label="Inputs"><h3 class="kcalc-sec">Inputs</h3>';
    c.inputs.forEach(function (inp, i) {
      var key = c.id + ":" + inp.k, curUnit = S.units[key] || inp.u, alt = ALT[inp.u];
      var shown = S.vals[key] != null ? S.vals[key] : inp.d;
      h += '<div class="kcalc-field"><label for="kcalc-input-' + c.id + "-" + inp.k + '"><span class="kcalc-var kcalc-v' + (i % 4) + '">' + esc(inp.l) + '</span> <span class="kcalc-range">' + inp.lo + " to " + inp.hi + " " + esc(inp.u) + '</span></label>' +
        '<div class="kcalc-inrow"><input id="kcalc-input-' + c.id + "-" + inp.k + '" data-kcalc-input="' + inp.k + '" type="number" inputmode="decimal" step="any" min="' + inp.lo + '" max="' + inp.hi + '" value="' + esc(shown) + '">' +
        (alt ? '<button type="button" class="kcalc-unit" data-act="kcalc-unit" data-id="' + c.id + '" data-k="' + inp.k + '" data-u="' + esc(inp.u) + '" aria-label="Switch unit for ' + esc(inp.l) + ", now " + esc(curUnit) + '">' + esc(curUnit) + "</button>" : '<span class="kcalc-unitlab">' + esc(curUnit) + "</span>") + "</div></div>";
    });
    h += "</section>";
    h += '<div id="kcalc-live-' + c.id + '">' + resultHtml(c) + "</div>";
    h += '<section aria-label="Formula"><h3 class="kcalc-sec">Formula</h3>' + formulaHtml(c) + "</section>";
    h += '<div class="kcalc-actions"><button type="button" class="sp-btn pri" data-act="kcalc-example" data-id="' + c.id + '">Worked example</button>' +
      '<button type="button" class="sp-btn sec" data-act="kcalc-scan" data-view="' + esc(c.view) + '">Measure this in Scan Lab</button></div>';
    h += '<section aria-label="Sources and limitations"><h3 class="kcalc-sec">Sources and limitations</h3><p class="kcalc-how">Source: ' + esc(c.source) + '.</p><p class="kcalc-how">' + esc(c.limits) + '</p><p class="kcalc-how">Draft content, to be verified by the owner before clinical use. Check the primary guideline for the full pathway.</p></section>';
    return h;
  }
  function html() { if (!S.I) return ""; var c = S.cur ? calcById(S.cur) : null; return '<div class="sp-scroll sp-pad"><div class="sp-col kcalc">' + (c ? detailHtml(c) : listHtml()) + "</div></div>"; }
  function repaint(focus) { if (S.nav) S.nav(focus || null); else if (S.host && S.host._st) S.host._st.again && S.host._st.again(focus); }
  function touchRecent(id) { S.recent = [id].concat(S.recent.filter(function (x) { return x !== id; })).slice(0, 8); save(); }
  function bindLive() {
    var d = G.document; if (!d) return;
    var inputs = d.querySelectorAll("[data-kcalc-input]");
    for (var i = 0; i < inputs.length; i++) (function (el) {
      if (el.getAttribute("data-kcalc-bound")) return; el.setAttribute("data-kcalc-bound", "1");
      el.addEventListener("input", function () {
        var c = calcById(S.cur); if (!c) return;
        S.vals[c.id + ":" + el.getAttribute("data-kcalc-input")] = el.value;
        var slot = d.getElementById("kcalc-live-" + c.id); if (slot) slot.innerHTML = resultHtml(c);
      });
    })(inputs[i]);
    var search = d.getElementById("kcalc-search");
    if (search && !search.getAttribute("data-kcalc-bound")) { search.setAttribute("data-kcalc-bound", "1"); search.addEventListener("input", function () { S.q = search.value; var pos = search.selectionStart; repaint("#kcalc-search"); var s2 = d.getElementById("kcalc-search"); if (s2) { s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (e) {} } }); }
  }
  function startFig() {
    var d = G.document; if (!d || !figLoaded() || !S.cur) return;
    var cv = d.querySelector("[data-kcalc-fig]"); if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d"); if (!ctx) return;
    var fig = G.KCALC_FIG.get(S.cur); if (!fig) return;
    var reduced = G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || S.figPlay === false) { G.KCALC_FIG.render(ctx, S.cur, fig.keyPhase, 640, 420); return; }
    if (S.figRaf && G.cancelAnimationFrame) G.cancelAnimationFrame(S.figRaf);
    var t0 = Date.now(), lastPhase = "";
    function frame() {
      if (!cv.isConnected && cv.parentNode === null) return;
      var phase = ((Date.now() - t0) % 1600) / 1600;
      var out = G.KCALC_FIG.render(ctx, S.cur, phase, 640, 420);
      var slot = d.querySelector("[data-kcalc-phase]");
      if (slot && out && out.phaseName !== lastPhase) { lastPhase = out.phaseName; slot.textContent = out.phaseName + ": ECG, image and trace share one clock"; }
      S.figRaf = G.requestAnimationFrame ? G.requestAnimationFrame(frame) : null;
    }
    frame();
  }
  function mount() { bindLive(); startFig(); }
  function attach(h) {
    if (!h || !h._internal) return; S.host = h; S.I = h._internal;
    var A = S.I.ACTIONS;
    A["kcalc-retry"] = function () { repaint(); };
    A["kcalc-clear"] = function () { S.q = ""; S.cat = "All"; repaint("#kcalc-search"); };
    A["kcalc-cat"] = function (b) { S.cat = b.getAttribute("data-v"); repaint(); };
    A["kcalc-open"] = function (b) { S.cur = b.getAttribute("data-id"); touchRecent(S.cur); repaint("#kcalc-input-" + S.cur + "-" + (calcById(S.cur) ? calcById(S.cur).inputs[0].k : "")); };
    A["kcalc-list"] = function () { S.cur = null; repaint("#kcalc-search"); };
    A["kcalc-fav"] = function (b) { var id = b.getAttribute("data-id"); S.favs[id] = !S.favs[id]; if (!S.favs[id]) delete S.favs[id]; save(); repaint(); };
    A["kcalc-example"] = function (b) { var c = calcById(b.getAttribute("data-id")); if (!c) return; Object.keys(c.example).forEach(function (k) { S.vals[c.id + ":" + k] = c.example[k]; delete S.units[c.id + ":" + k]; }); repaint(); };
    A["kcalc-unit"] = function (b) { var c = calcById(b.getAttribute("data-id")); if (!c) return; var k = b.getAttribute("data-k"); var inp = null; c.inputs.forEach(function (x) { if (x.k === k) inp = x; }); if (!inp) return; var key = c.id + ":" + k; var alt = ALT[inp.u]; var cur = S.units[key] || inp.u; var curVal = parseFloat(S.vals[key] != null ? S.vals[key] : inp.d); if (cur === inp.u) { S.units[key] = alt.u; S.vals[key] = Math.round(curVal * alt.f * 100) / 100; } else { delete S.units[key]; S.vals[key] = Math.round(curVal / alt.f * 100) / 100; } repaint("#kcalc-input-" + c.id + "-" + k); };
    A["kcalc-copylink"] = function (b) {
      var id = b.getAttribute("data-id"), L = G.KARDIA_LINKS;
      if (!id || !L || !L.link || !S.I) return;
      L.copy(L.link("calc", id), function (m) { S.I.toast(m); });
    };
    A["kcalc-fig-toggle"] = function (b) { S.figPlay = S.figPlay === false ? true : false; if (S.figPlay === false && S.figRaf && G.cancelAnimationFrame) G.cancelAnimationFrame(S.figRaf); repaint(); };
    A["kcalc-scan"] = function (b) { var view = b.getAttribute("data-view"); try { if (S.host._kardia && S.host._kardia.echoLab) S.host._kardia.echoLab.setView(view); } catch (e) {} if (S.nav) S.nav("echo"); };
  }
  /* Open one calculator by id for a deep link. Selects it and repaints
   * through the host navigator when one is set. Returns false when unknown. */
  function openCalc(id) {
    var c = calcById(id);
    if (!c) return false;
    S.cur = c.id; touchRecent(c.id);
    repaint();
    return true;
  }
  G.KARDIA_CALC = { attach: attach, html: html, mount: mount, openCalc: openCalc, setNavigator: function (fn) { S.nav = fn; }, _state: S, calcById: calcById, filtered: filtered };
  if (G.KARDIA && G.KARDIA._internal) attach(G.KARDIA);
})(typeof window !== "undefined" ? window : this);
