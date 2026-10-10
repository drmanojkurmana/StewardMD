/* PrepNucleus tab bar (prep-nav.js, 2026-10-10, owner: "a floating liquid glass menu bar at the footer, to make it more
   user friendly"). ES5, no library, optional (prep-loader.js skips it on a 404; without it nothing changes).

   Tabs come from what PrepNucleus already has, nothing invented:
     Home  - the home screen (plan, question of the day, practice rows, subjects).
     Learn - every lesson, by subject (prep-lessons.js; the tab is left out when that file is missing). Lessons were
             reachable only from inside a subject; this is the first place that lists them all.
     Tests - mock exams (renderMocks) with the previous year papers row on top for NEET-PG.
     You   - the menu (renderMenu: exam and plan, Pro, downloads, stats, bookmarks, mistakes, friends).
   Navigation: a tab resets the stack to [home] or [home, tab root], so Android back from a tab goes home and back from
   home closes PrepNucleus. Tapping the current tab pops to its root (back slide); tapping it at its root scrolls to the
   top. Each tab root keeps its own scroll position. The current tab is the nearest tab root down the stack, so a subject
   opened from Home keeps Home lit, bookmarks opened from You keep You lit.

   Where it shows: browse screens only (the tab roots, a subject, a module, a subject's lessons, PYQ papers, mistakes,
   bookmarks, downloads; see SCREENS). Anywhere else (question runner, feedback, results, review, lesson reader, cards,
   onboarding, create flows, search) and whenever a sheet, an enlarged image, a dialog or the on-screen keyboard is up,
   it slides down out of the way and is inert. The screen's own primary footers therefore never share the bottom with it.
   While it shows, #smdPrep gets .pn-navon: the scrolling body is padded by the bar's height + its float + the safe area,
   so the last row always ends above the bar, and the home bar's Menu button steps aside (You is the same screen).

   The glass: one element with one backdrop-filter. Everywhere: blur + saturate + brightness over a theme tint that is
   opaque enough for 4.5:1 text over any page colour (checked by PURE.worst over white, midnight, Prussian and amber),
   a 1 px specular rim, and a static top sheen. Chromium (Android WebView, desktop Chrome) adds an SVG lens
   (feDisplacementMap) to the backdrop so the content under the rim bends like a thick edge; WebKit (iOS WKWebView,
   Safari) and Firefox do not support url() in backdrop-filter, so they keep the frosted layer only (never the url()
   value, which would paint nothing). The lens map is rebuilt only when the bar's size changes.
   Selection: a glass pill under the current tab, moved by a CSS transform on a spring (retargets mid-flight); while it
   travels the drop inside stretches along the path. Press: the tab's icon sinks on touch-down, releases on a spring.
   Haptics: data-tgl makes haptics.js fire its selection tick on press (native only), so nothing is called here.
   Reduced motion: no slide, stretch or press scale (the pill and the bar change in place). Reduced transparency or more
   contrast: a solid card-coloured bar with a hairline, no blur.
   API: PREP_NAV.attach(root, host) on open, sync(root) after every paint, detach() on close; _pure for tests. */
(function (G) {
  "use strict";

  var ICONS = {
    home: '<path class="f" d="M3.5 10.4L12 3.6l8.5 6.8V19.5a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    learn: '<path class="f" d="M12 6.2C9.6 4.6 6.4 4.2 3 5v13.6c3.4-.8 6.6-.4 9 1.2 2.4-1.6 5.6-2 9-1.2V5c-3.4-.8-6.6-.4-9 1.2z"/><path d="M12 6.2v13.6"/>',
    tests: '<circle class="f" cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.6M9.6 2.8h4.8M12 2.8v3.2M18.2 6.6l1.4-1.4"/>',
    you: '<circle class="f" cx="12" cy="8" r="4"/><path class="f" d="M4.5 20.5a7.5 7.5 0 0 1 15 0z"/>'
  };
  var TABS = [
    { id: "home", label: "Home" },
    { id: "learn", label: "Learn" },
    { id: "tests", label: "Tests" },
    { id: "you", label: "You" }
  ];
  // Browse screens: the scrolling body (#smdPrep > .pn-body) matches one of these, or holds the module panel.
  var SCREENS = "#pnHome, #pnLearn, .pn-menu, .pn-mocks, #pnSub, .pn-lsn-all, #pnYq, .pn-mtl, .pn-bml, .pn-dll";
  var KB = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=""], [contenteditable="true"]';

  /* ---------- pure ---------- */
  function tabsFor(hasLearn) { return TABS.filter(function (t) { return t.id !== "learn" || hasLearn; }); }
  // ids: for each stack entry, the tab it is the root of (or null), bottom first. The current tab is the nearest root.
  function tabOf(ids) { for (var i = ids.length - 1; i >= 0; i--) if (ids[i]) return ids[i]; return "home"; }
  // s: { screen, sheet, viewer, keyboard }: shown on a browse screen with nothing over it.
  function showOn(s) { return !!(s && s.screen && !s.sheet && !s.viewer && !s.keyboard); }
  // What a tab press does: "top" (scroll to top), "pop" (pop to the tab's root at index i), "go" (switch tab).
  function pressOf(cur, id, rootIx, depth) {
    if (id !== cur) return { k: "go" };
    if (rootIx < 0) return { k: "go" };
    return rootIx === depth - 1 ? { k: "top" } : { k: "pop", i: rootIx };
  }
  // WCAG contrast helpers. Colours are [r, g, b] 0-255, alpha 0-1.
  function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function over(top, a, bottom) { return [0, 1, 2].map(function (i) { return Math.round(top[i] * a + bottom[i] * (1 - a)); }); }
  // The lowest contrast of ink on the glass (tint at alpha over each page colour), optionally under the pill too.
  function worst(ink, tint, alpha, pages, pill, pillA) {
    var m = Infinity;
    pages.forEach(function (p) { var g = over(tint, alpha, p); if (pill) g = over(pill, pillA, g); m = Math.min(m, contrast(ink, g)); });
    return m;
  }
  // The lens map for feDisplacementMap (R = x shift, G = y shift, 128 = none): a ramp across the whole bar, flattened to
  // neutral in the middle by a blurred inner capsule, so only a rim of about `edge` px bends.
  function lensMap(w, h, edge) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); edge = Math.max(4, Math.min(edge, h / 2 - 2));
    var r = h / 2, ir = Math.max(1, r - edge);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
      '<defs><linearGradient id="x" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#000"/></linearGradient>' +
      '<linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0f0"/><stop offset="1" stop-color="#000"/></linearGradient>' +
      '<filter id="b" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="' + (edge / 2.4).toFixed(1) + '"/></filter></defs>' +
      '<rect width="' + w + '" height="' + h + '" fill="url(#x)"/>' +
      '<rect width="' + w + '" height="' + h + '" fill="url(#y)" style="mix-blend-mode:screen"/>' +
      '<rect x="' + edge + '" y="' + edge + '" width="' + (w - 2 * edge) + '" height="' + (h - 2 * edge) + '" rx="' + ir + '" fill="rgb(128,128,0)" filter="url(#b)"/></svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }
  // Chromium only: url() in backdrop-filter. WebKit parses it but paints nothing, Firefox has no backdrop url().
  function lensOk(ua, supports) {
    ua = String(ua || "");
    if (!/Chrome\/|Chromium\//.test(ua) || /CriOS|FxiOS|EdgiOS|Firefox\//.test(ua)) return false;
    return !!supports;
  }
  var PURE = { TABS: TABS, SCREENS: SCREENS, tabsFor: tabsFor, tabOf: tabOf, showOn: showOn, pressOf: pressOf, lum: lum, contrast: contrast, over: over, worst: worst, lensMap: lensMap, lensOk: lensOk };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ---------- app ---------- */
  var D = G.document;
  var root = null, host = null, el = null, pill = null, drop = null, tabs = [], cur = "home", shown = false, kb = false;
  var tabY = {}, want = null, refocus = null, mo = null, ro = null, lens = false, mapW = 0, mapH = 0, mvT = 0, lastI = -1;

  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function esc(s) { return host && host.esc ? host.esc(s) : String(s); }
  function svg(id) { return '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[id] + "</svg>"; }
  function hasLearn() { return !!(G.PREP_LESSONS && G.PREP_LESSONS.openSubject && G.PREP_LESSONS.index); }
  function rootFn(id) {
    var sc = (host && host.screens) || {};
    return id === "home" ? host.home : id === "tests" ? sc.mocks : id === "you" ? sc.menu : id === "learn" ? learnView : null;
  }
  function idOfFn(fn) {
    if (!fn || !host) return null;
    if (fn === learnView) return "learn";
    var sc = host.screens || {};
    return fn === sc.mocks ? "tests" : fn === sc.menu ? "you" : fn === host.home ? "home" : null;
  }
  function stack() { return host && host.stack ? host.stack() : []; }
  function bodyOf() { return root ? root.querySelector(":scope > .pn-body") : null; }

  function build() {
    el = D.createElement("nav");
    el.className = "pnv pnv-off";
    el.setAttribute("aria-label", "PrepNucleus");
    el.__pnKeep = 1;   // PREP_DOM.patch walks past it
    var list = tabsFor(hasLearn());
    el.style.setProperty("--n", list.length);
    el.innerHTML = '<svg class="pnv-defs" width="0" height="0" aria-hidden="true" focusable="false"><filter id="pnvLens" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="360" height="64" color-interpolation-filters="sRGB">' +
      '<feImage id="pnvMap" x="0" y="0" width="360" height="64" preserveAspectRatio="none" result="m"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="m" scale="26" xChannelSelector="R" yChannelSelector="G"/></filter></svg>' +
      '<span class="pnv-sheen" aria-hidden="true"></span>' +
      '<span class="pnv-pill" aria-hidden="true"><span class="pnv-drop"></span></span>' +
      '<div class="pnv-tabs">' + list.map(function (t, i) {
        return '<button type="button" class="pnv-tab" data-tab="' + t.id + '" data-tgl="1" data-i="' + i + '"><span class="pnv-ic">' + svg(t.id) + '</span><span class="pnv-l">' + t.label + "</span></button>";
      }).join("") + "</div>";
    pill = el.querySelector(".pnv-pill"); drop = el.querySelector(".pnv-drop");
    tabs = Array.prototype.slice.call(el.querySelectorAll(".pnv-tab"));
    el.addEventListener("click", onTap);
    el.addEventListener("keydown", onKey);
    try { lens = lensOk(G.navigator && G.navigator.userAgent, G.CSS && G.CSS.supports && G.CSS.supports("backdrop-filter", "url(#pnvLens) blur(2px)")); } catch (e) { lens = false; }
    if (lens) el.classList.add("pnv-lens");
  }
  // The lens map follows the bar's size (ResizeObserver; never per frame).
  function sizeLens() {
    if (!lens || !el) return;
    var w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h || (w === mapW && h === mapH)) return;
    mapW = w; mapH = h;
    // Sizes in user space (the bar's own px): percentages resolve against the wrong box in a backdrop filter.
    var im = el.querySelector("#pnvMap"), fl = el.querySelector("#pnvLens");
    if (fl) { fl.setAttribute("width", w); fl.setAttribute("height", h); }
    if (im) { var u = lensMap(w, h, 13); im.setAttribute("width", w); im.setAttribute("height", h); im.setAttribute("href", u); im.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", u); }
  }

  function onTap(e) {
    var b = e.target && e.target.closest ? e.target.closest(".pnv-tab") : null;
    if (!b || !shown) return;
    e.preventDefault(); e.stopPropagation();
    go(b.getAttribute("data-tab"), e.detail === 0);
  }
  function onKey(e) {
    var k = e.key, i = tabs.indexOf(D.activeElement);
    if (i < 0 || (k !== "ArrowLeft" && k !== "ArrowRight" && k !== "Home" && k !== "End")) return;
    e.preventDefault();
    var n = tabs.length, j = k === "Home" ? 0 : k === "End" ? n - 1 : (i + (k === "ArrowRight" ? 1 : -1) + n) % n;
    tabs[j].focus();
  }
  function rootIndex(id) {
    var s = stack(), fn = rootFn(id);
    if (id === "home") return s[0] === host.home ? 0 : -1;
    for (var i = s.length - 1; i >= 0; i--) if (s[i] === fn) return i;
    return -1;
  }
  function onRoot() { var s = stack(); return idOfFn(s[s.length - 1]) === cur && (cur !== "home" || s.length === 1); }
  function go(id, byKey) {
    if (!host || !rootFn(id)) return;
    var s = stack(), p = pressOf(cur, id, rootIndex(id), s.length), b = bodyOf();
    refocus = byKey || (D.activeElement && el.contains(D.activeElement)) ? id : null;
    if (p.k === "top") {
      if (b && b.scrollTop > 0) { try { b.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" }); } catch (e) { b.scrollTop = 0; } }
      refocus = null; return;
    }
    if (p.k === "pop") { s.length = p.i + 1; host.nav(-1); host.rerender(); return; }
    if (b && onRoot()) tabY[cur] = b.scrollTop;
    s.length = 0; s.push(host.home); if (id !== "home") s.push(rootFn(id));
    want = { id: id, y: tabY[id] || 0, t: Date.now() };
    host.nav(0); host.rerender();
  }

  // Which tab is current and whether the bar shows; called after every paint, on sheets opening or closing, and on
  // keyboard focus changes.
  function update() {
    if (!root || !el) return;
    var s = stack(), ids = s.map(idOfFn);
    cur = tabOf(ids);
    var b = bodyOf(), screen = !!(b && (b.matches(SCREENS) || b.querySelector("#pnModPanel")));
    var sheet = !!root.querySelector(":scope > .pn-sheet-wrap, :scope > .pn-zoom, :scope > .pv, :scope > [aria-modal=\"true\"]");
    var viewer = !!(G.PREP_VIEWER && G.PREP_VIEWER.isOpen && G.PREP_VIEWER.isOpen());
    var show = showOn({ screen: screen, sheet: sheet, viewer: viewer, keyboard: kb });
    var list = tabsFor(hasLearn()), i = 0;
    list.forEach(function (t, k) { if (t.id === cur) i = k; });
    tabs.forEach(function (t, k) {
      var on = k === i;
      t.classList.toggle("on", on);
      if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    if (i !== lastI) {
      // The drop stretches along the way while the pill travels (not on the first placement, not under reduced motion).
      if (lastI >= 0 && shown && !reduced() && drop) { drop.classList.add("pnv-mv"); G.clearTimeout(mvT); mvT = G.setTimeout(function () { if (drop) drop.classList.remove("pnv-mv"); }, 170); }
      pill.style.transform = "translateX(" + (i * 100) + "%)";
      lastI = i;
    }
    if (show !== shown) {
      shown = show;
      el.classList.toggle("pnv-off", !show);
      el.inert = !show;
      if (show) el.removeAttribute("aria-hidden"); else el.setAttribute("aria-hidden", "true");
      root.classList.toggle("pn-navon", show);
      if (show) sizeLens();
    }
  }
  function placeY(b, y) {
    var t0 = Date.now();
    (function again() {
      if (!b.isConnected || Date.now() - t0 > 600) return;
      b.scrollTop = y;
      if (b.scrollTop < y - 1) G.requestAnimationFrame(again);
    })();
  }
  function sync(r) {
    if (!el || r !== root) return;
    // A full paint (root.innerHTML) took the bar out; put the same node back, last, so it follows the screen in
    // focus order. A patch walks past it (__pnKeep).
    if (el.parentNode !== root) root.appendChild(el);
    update();
    var b = bodyOf();
    if (want && b && Date.now() - want.t < 2000 && cur === want.id && onRoot()) { if (want.y > 0) placeY(b, want.y); else b.scrollTop = 0; }
    want = null;
    if (refocus) { var t = el.querySelector('.pnv-tab[data-tab="' + refocus + '"]'); refocus = null; try { if (t && shown) t.focus({ preventScroll: true }); } catch (e) {} }
  }
  function onFocusIn(e) { var t = e.target; if (t && t.matches && t.matches(KB) && root && root.contains(t)) { kb = true; update(); } }
  function onFocusOut() { G.setTimeout(function () { var a = D.activeElement, k = !!(a && a.matches && a.matches(KB) && root && root.contains(a)); if (k !== kb) { kb = k; update(); } }, 0); }
  function onVV() {
    var vv = G.visualViewport; if (!vv) return;
    var k = G.innerHeight - vv.height > 150 && !!(D.activeElement && D.activeElement.matches && D.activeElement.matches(KB));
    if (k !== kb) { kb = k; update(); }
  }
  function attach(r, h) {
    root = r; host = h;
    if (!el) build();
    cur = "home"; shown = false; kb = false; lastI = -1; want = null; tabY = {};
    el.classList.add("pnv-off"); el.inert = true; el.setAttribute("aria-hidden", "true");
    root.appendChild(el);
    D.addEventListener("focusin", onFocusIn, true);
    D.addEventListener("focusout", onFocusOut, true);
    if (G.visualViewport) G.visualViewport.addEventListener("resize", onVV);
    // Sheets, enlarged images and dialogs are added straight to #smdPrep: watch its children only (no subtree).
    try { mo = new G.MutationObserver(function () { update(); }); mo.observe(root, { childList: true }); } catch (e) { mo = null; }
    try { if (lens && G.ResizeObserver) { ro = new G.ResizeObserver(sizeLens); ro.observe(el); } } catch (e) { ro = null; }
  }
  function detach() {
    D.removeEventListener("focusin", onFocusIn, true);
    D.removeEventListener("focusout", onFocusOut, true);
    if (G.visualViewport) G.visualViewport.removeEventListener("resize", onVV);
    if (mo) { mo.disconnect(); mo = null; }
    if (ro) { ro.disconnect(); ro = null; }
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (root) root.classList.remove("pn-navon");
    root = null; shown = false; mapW = mapH = 0;
  }

  /* ---------- Learn: every subject's lessons ---------- */
  var lx = { counts: null, exam: "" };
  function learnView() {
    var s = host.store(), ex = host.exam(), subs = host.subjectsOf(s.exam), P = G.PREP_LESSONS && G.PREP_LESSONS._pure;
    draw(s, ex, subs, lx.exam === s.exam ? lx.counts : null, lx.cont);
    Promise.all([G.PREP_LESSONS.index()].concat(subs.map(function (sb) { return host.loadIndex(sb.id).then(null, function () { return null; }); }))).then(function (res) {
      if (host.stackTop() !== learnView) return;
      var ix = res[0], ixs = host.ix(), counts = {}, done = {};
      subs.forEach(function (sb) {
        var topics = (ixs[sb.id] && ixs[sb.id].topics) || [], n = 0, d = 0;
        (P ? P.subjectLessons(ix, topics) : []).forEach(function (m) { m.list.forEach(function (x) { n++; if (s.ls[x[0]] && s.ls[x[0]].done) d++; }); });
        counts[sb.id] = n; done[sb.id] = d;
      });
      // Lessons started and not finished, most recent first (the store keeps them in the order they were opened).
      var cont = Object.keys(s.ls || {}).filter(function (k) { var p = s.ls[k]; return p && !p.done && p.i > 0 && ix && ix.modules && ix.modules[k]; }).reverse().slice(0, 3).map(function (k) {
        var meta = ix.modules[k], mid = P ? P.moduleOf(k, meta) : k, sid = host.subjectOfModule(mid);
        return sid ? { k: k, m: mid, s: sid, t: meta.title || "Lesson", i: s.ls[k].i, n: s.ls[k].n } : null;
      }).filter(Boolean);
      lx = { counts: { n: counts, d: done }, exam: s.exam, cont: cont };
      draw(s, ex, subs, lx.counts, cont);
    }, function () { if (host.stackTop() === learnView) draw(s, ex, subs, { err: 1 }, null); });
  }
  function draw(s, ex, subs, c, cont) {
    var head = host.bar("Learn", esc(ex.label), "back"), body;
    if (!c) body = '<p class="pn-load" role="status">Loading lessons…</p>';
    else if (c.err) body = '<p class="pn-err" role="alert">Lessons did not load. Check the connection and try again. A lesson opened once works offline.</p><button type="button" class="pn-btn" data-act="n-learn">Try again</button>';
    else {
      var with_ = subs.filter(function (sb) { return c.n[sb.id] > 0; }), total = 0;
      with_.forEach(function (sb) { total += c.n[sb.id]; });
      body = (total ? '<p class="pn-mut pn-lsn-sum">' + host.fmt(total) + " lessons in " + with_.length + (with_.length === 1 ? " subject" : " subjects") + ". Each is a few short steps you can listen to, then quick questions.</p>" : '<p class="pn-empty">No lessons for this exam’s subjects yet.</p>') +
        (cont && cont.length ? '<h2 class="pn-sec">Continue</h2><div class="pn-group">' + cont.map(function (x) {
          return host.row("l-open", host.ico("play"), esc(x.t), "Step " + (x.i + 1) + (x.n ? " of " + x.n : ""), ' data-s="' + esc(x.s) + '" data-m="' + esc(x.m) + '" data-l="' + esc(x.k) + '"');
        }).join("") + "</div>" : "") +
        (with_.length ? '<h2 class="pn-sec">Subjects</h2><div class="pn-group">' + with_.map(function (sb) {
          var n = c.n[sb.id], d = c.d[sb.id];
          return host.row("l-subject", host.subjIco(sb.id), host.tx(sb.name), host.fmt(n) + (n === 1 ? " lesson" : " lessons") + (d ? " · " + host.fmt(d) + " finished" : ""), ' data-s="' + esc(sb.id) + '" style="--h:' + host.subjHue(sb.id) + '"');
        }).join("") + "</div>" : "");
    }
    host.paint(head + '<div class="pn-body pn-learn" id="pnLearn">' + body + "</div>");
  }
  function act(a) { if (a === "n-learn" && host && host.stackTop() === learnView) { lx = { counts: null, exam: "" }; learnView(); return true; } return false; }

  G.PREP_NAV = { attach: attach, sync: sync, detach: detach, act: act, go: function (id) { go(id, false); }, current: function () { return cur; }, shown: function () { return shown; }, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
