/* Image Library: ONE central bank of every captioned image in the app.
 * window.SMD_IMGLIB. ES5 IIFE, no dependencies. Index built by
 * tools/build-image-library.mjs into kb/dist/imglib/ (index.json + one file
 * per system, lazy loaded). Images load from their existing URLs; nothing is
 * copied. Flag smd_imglib, default ON: ?imglib=0 or localStorage "0" is off. */
(function (G) {
  "use strict";

  function enabled() {
    try {
      var q = (G.location.search.match(/[?&]imglib=([^&]+)/) || [])[1];
      if (q != null) return q !== "0" && q !== "off" && q !== "false";
      return G.localStorage.getItem("smd_imglib") !== "0";
    } catch (e) { return true; }
  }
  function imgUrl(src) {
    var s = String(src || "");
    if (/^https?:\/\//.test(s)) return s;
    var base = G.SMD_API_BASE || (typeof globalThis !== "undefined" && globalThis.SMD_API_BASE);
    if (s.charAt(0) === "/" && base && (s.indexOf("/api/") === 0 || s.indexOf("/assets/") === 0)) {
      return String(base).replace(/\/$/, "") + s;
    }
    return s;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  /* Pure helpers, unit tested in test/image-library.test.mjs. */
  function matches(e, q) {
    if (!q) return true;
    var hay = ((e.t || "") + " " + (e.c || "")).toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return !w || hay.indexOf(w) >= 0; });
  }
  function filterItems(items, f) {
    return (items || []).filter(function (e) {
      if (f.from && e.f !== f.from) return false;
      if (f.kind && e.k !== f.kind) return false;
      if (f.origin && e.o !== f.origin) return false;
      return matches(e, f.q);
    });
  }

  /* Pure gesture maths from prep-viewer.js (or fallback if not yet loaded) */
  var PURE_MATH = {
    MIN: 1, MAX: 5, DT: 2.5,
    zoomAt: function (t, s, s2, f) {
      var k = s2 / s;
      return { x: f.x - k * (f.x - t.x), y: f.y - k * (f.y - t.y) };
    },
    bounds: function (s, w, h, W, H) {
      return { x: Math.max(0, (w * s - W) / 2), y: Math.max(0, (h * s - H) / 2) };
    },
    clampPan: function (t, s, w, h, W, H) {
      var b = PURE_MATH.bounds(s, w, h, W, H);
      return { x: Math.max(-b.x, Math.min(b.x, t.x)) + 0, y: Math.max(-b.y, Math.min(b.y, t.y)) + 0 };
    },
    rubber: function (over, dim) {
      var c = 0.55;
      return (1 - 1 / ((over * c / (dim || 1)) + 1)) * dim / 3 * Math.sign(over || 0);
    },
    softPan: function (t, s, w, h, W, H) {
      var b = PURE_MATH.bounds(s, w, h, W, H), o = { x: t.x, y: t.y };
      if (t.x > b.x) o.x = b.x + PURE_MATH.rubber(t.x - b.x, W);
      else if (t.x < -b.x) o.x = -b.x + PURE_MATH.rubber(t.x + b.x, W);
      if (t.y > b.y) o.y = b.y + PURE_MATH.rubber(t.y - b.y, H);
      else if (t.y < -b.y) o.y = -b.y + PURE_MATH.rubber(t.y + b.y, H);
      return o;
    },
    softScale: function (s) {
      return s > 5 ? 5 + (s - 5) * 0.3 : s < 1 ? 1 - (1 - s) * 0.45 : s;
    }
  };
  function getViewerPure() {
    if (G.PREP_VIEWER && G.PREP_VIEWER._pure) return G.PREP_VIEWER._pure;
    return PURE_MATH;
  }
  function shouldSwipeNav(scale, dx, dy) {
    return scale <= 1.01 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4;
  }

  var PURE = {
    enabled: enabled,
    imgUrl: imgUrl,
    matches: matches,
    filterItems: filterItems,
    zoomAt: PURE_MATH.zoomAt,
    bounds: PURE_MATH.bounds,
    clampPan: PURE_MATH.clampPan,
    rubber: PURE_MATH.rubber,
    softPan: PURE_MATH.softPan,
    softScale: PURE_MATH.softScale,
    getViewerPure: getViewerPure,
    shouldSwipeNav: shouldSwipeNav
  };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }
  if (!enabled()) { G.SMD_IMGLIB = { enabled: enabled, open: function () { return false; }, close: function () {}, back: function () { return false; }, _pure: PURE }; return; }

  var BASE = "/kb/dist/imglib/";
  var ix = null, cache = {}, loading = {};
  var S = null; /* { view, slug, name, items, shown, q, from, kind, origin, vi, scale } */

  function fetchJSON(url) {
    if (window.SMD_CONTENT && window.SMD_CONTENT.fetchJSON) {
      return window.SMD_CONTENT.fetchJSON(url);
    }
    return G.fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function loadIndex() {
    if (ix) return Promise.resolve(ix);
    return fetchJSON(BASE + "index.json").then(function (j) { ix = j; return j; });
  }
  function loadSystem(slug) {
    if (cache[slug]) return Promise.resolve(cache[slug]);
    if (loading[slug]) return loading[slug];
    loading[slug] = fetchJSON(BASE + slug + ".json").then(function (j) {
      cache[slug] = j.items || []; delete loading[slug]; return cache[slug];
    }, function (e) { delete loading[slug]; throw e; });
    return loading[slug];
  }
  function loadAll() {
    return loadIndex().then(function (j) {
      return Promise.all(j.systems.map(function (s) { return loadSystem(s.slug); })).then(function () {
        var all = [];
        j.systems.forEach(function (s) { cache[s.slug].forEach(function (e) { all.push(e); }); });
        return all;
      });
    });
  }

  function root() { return G.document.getElementById("smdImgLib"); }
  function ensureRoot() {
    var r = root();
    if (r) return r;
    r = G.document.createElement("div");
    r.id = "smdImgLib";
    r.className = "igl-overlay";
    r.setAttribute("role", "dialog");
    r.setAttribute("aria-modal", "true");
    r.setAttribute("aria-label", "Image Library");
    r.innerHTML = '<div class="igl-bar"><button type="button" class="igl-back" data-igl="back" aria-label="Back">‹</button>' +
      '<h1 class="igl-title">Image Library</h1><span class="igl-count" role="status"></span></div>' +
      '<div class="igl-tools"><label class="igl-search"><span class="igl-sr">Search images</span>' +
      '<input type="search" class="igl-q" placeholder="Search title or caption" autocomplete="off"></label>' +
      '<div class="igl-chips" role="group" aria-label="Filters"></div></div>' +
      '<div class="igl-body"></div><div class="igl-viewer" hidden></div>';
    G.document.body.appendChild(r);
    r.addEventListener("click", onClick);
    var q = r.querySelector(".igl-q"), t = null;
    q.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { S.q = q.value.trim(); S.shown = 60; paintGrid(); }, 180);
    });
    q.addEventListener("search", function () { S.q = q.value.trim(); S.shown = 60; paintGrid(); });
    return r;
  }

  function filtered() { return filterItems(S.items, S); }
  function chipsHTML(list, key, label) {
    if (!list.length) return "";
    return '<span class="igl-chipset"><span class="igl-chiplab">' + label + '</span>' +
      '<button type="button" class="igl-chip' + (!S[key] ? " on" : "") + '" data-igl="chip" data-k="' + key + '" data-v="">All</button>' +
      list.map(function (v) {
        return '<button type="button" class="igl-chip' + (S[key] === v ? " on" : "") + '" data-igl="chip" data-k="' +
          key + '" data-v="' + esc(v) + '">' + esc(v) + "</button>";
      }).join("") + "</span>";
  }
  function paintChips() {
    var box = root().querySelector(".igl-chips");
    var froms = [], kinds = [], seenF = {}, seenK = {};
    (S.items || []).forEach(function (e) {
      if (!seenF[e.f]) { seenF[e.f] = 1; froms.push(e.f); }
      if (!seenK[e.k]) { seenK[e.k] = 1; kinds.push(e.k); }
    });
    froms.sort(); kinds.sort();
    box.innerHTML = chipsHTML(froms, "from", "From") + chipsHTML(kinds, "kind", "Kind") +
      '<span class="igl-chipset"><span class="igl-chiplab">Source</span>' +
      '<button type="button" class="igl-chip' + (!S.origin ? " on" : "") + '" data-igl="chip" data-k="origin" data-v="">All</button>' +
      '<button type="button" class="igl-chip' + (S.origin === "commons" ? " on" : "") + '" data-igl="chip" data-k="origin" data-v="commons">Commons image</button>' +
      '<button type="button" class="igl-chip' + (S.origin === "stewardmd" ? " on" : "") + '" data-igl="chip" data-k="origin" data-v="stewardmd">StewardMD</button></span>';
  }

  function paintSystems() {
    var r = root(); if (!r || !ix) return;
    r.querySelector(".igl-title").textContent = "Image Library";
    r.querySelector(".igl-count").textContent = ix.total.toLocaleString() + " images";
    r.querySelector(".igl-tools").hidden = true;
    r.querySelector(".igl-body").innerHTML = '<p class="igl-intro">Every captioned image in the app, in one place. Pick a system to browse, or search across all of them.</p>' +
      '<div class="igl-sysgrid">' + ix.systems.map(function (s) {
        return '<button type="button" class="igl-sys" data-igl="sys" data-v="' + esc(s.slug) + '">' +
          '<span class="igl-sysimg"><img src="' + esc(imgUrl(s.sample)) + '" alt="" loading="lazy" decoding="async"></span>' +
          '<span class="igl-sysname">' + esc(s.name) + '</span><span class="igl-syscount">' + s.count.toLocaleString() + " images</span></button>";
      }).join("") + "</div>";
  }

  function paintGrid() {
    var r = root(); if (!r) return;
    r.querySelector(".igl-tools").hidden = false;
    paintChips();
    var list = filtered();
    r.querySelector(".igl-title").textContent = S.name || "Images";
    r.querySelector(".igl-count").textContent = list.length.toLocaleString() + " images";
    var shown = list.slice(0, S.shown);
    r.querySelector(".igl-body").innerHTML =
      (shown.length ? '<div class="igl-grid">' + shown.map(function (e, i) {
        return '<button type="button" class="igl-card" data-igl="open" data-i="' + i + '">' +
          '<span class="igl-thumb smd-wm-host"><img src="' + esc(imgUrl(e.s)) +
          '" alt="' + esc(e.a || e.t) + '" loading="lazy" decoding="async">' + (G.SMD_WM ? G.SMD_WM.html(e.s) : "") + '</span>' +
          '<span class="igl-cardt">' + esc(e.t) + '</span><span class="igl-cardf">' + esc(e.f) + " · " + esc(e.k) + "</span></button>";
      }).join("") + "</div>" : '<p class="igl-empty">No images match. Try a shorter search or clear a filter.</p>') +
      (list.length > S.shown ? '<button type="button" class="igl-more" data-igl="more">Show more (' +
        (list.length - S.shown).toLocaleString() + " left)</button>" : "");
    S.list = list;
  }

  function openSystem(slug, name) {
    S.view = "grid"; S.slug = slug; S.name = name; S.items = []; S.shown = 60; S.list = [];
    root().querySelector(".igl-body").innerHTML = '<p class="igl-loading" role="status">Loading images</p>';
    loadSystem(slug).then(function (items) {
      if (!S || S.slug !== slug) return;
      S.items = items; paintGrid();
    }, function () {
      if (root()) root().querySelector(".igl-body").innerHTML =
        '<p class="igl-empty">These images did not load. Check your connection and try again.</p>';
    });
  }
  function openSearchAll() {
    S.view = "grid"; S.slug = "__all"; S.name = "All systems"; S.items = []; S.shown = 60; S.list = [];
    root().querySelector(".igl-body").innerHTML = '<p class="igl-loading" role="status">Loading images</p>';
    loadAll().then(function (items) { if (S && S.slug === "__all") { S.items = items; paintGrid(); } }, function () {});
  }

  var LINK_LABEL = { kb: "Read the article", lesson: "Open the lesson", ecg: "Open in KardiqX", eye: "Open in Ophthalmós",
    ophthalmos: "Open in Ophthalmós", prep: "Open in PrepNucleus", clinix: "Open in CliniX", tokos: "Open in Tokós", narke: "Open in Narkē",
    commons: "Open on Wikimedia Commons" };
  /* A Commons file page opens outside the app (Capacitor Browser in the app, a new window in the test harness). */
  function openExternal(url) {
    try { var P = G.Capacitor && G.Capacitor.Plugins; if (P && P.Browser && P.Browser.open) { P.Browser.open({ url: url }); return true; } } catch (x) {}
    try { if (G.open && G.open(url, "_blank")) return true; } catch (x) {}
    return false;
  }
  /* Every image says where to read about it (owner 2026-11-13): its PrepNucleus lesson, opened at the step that shows
     it, for Pro; without Pro that button asks to subscribe, and "Read the article" opens the Knowledge Library article
     that holds the image (the builder only names an article the app ships, never a bare page). */
  function isPro() { try { return !!(G.SMD_PRO && G.SMD_PRO.isProSync && G.SMD_PRO.isProSync()); } catch (x) { return false; } }
  function openLesson(e) {
    if (!isPro()) {
      try { if (G.SMD_PRO && G.SMD_PRO.openPaywall) { G.SMD_PRO.openPaywall("lessons"); return; } } catch (x) {}
      try { if (G.toast) G.toast("Lessons are part of StewardMD Pro"); } catch (x) {}
      return;
    }
    try { if (G.PREP && G.PREP.open) { close(); G.PREP.open({ lesson: { s: e.lsj, m: e.lm, key: e.ls, step: e.lst } }); return; } } catch (x) {}
    openRef(e);
  }
  function openArticle(e) {
    if (!e.ka || !(G.SMD_KB && G.SMD_KB.open)) return openRef(e);
    close(); G.SMD_KB.open(e.ka);
    // Bring the figure into view once the article has drawn it (figures load with the page's v2 data).
    var file = String(e.s || "").split("/").pop(), tries = 0;
    (function find() {
      var ov = document.getElementById("dxOverlay"), img = null;
      if (ov && file) img = [].filter.call(ov.querySelectorAll("img"), function (i) { return String(i.getAttribute("src") || "").indexOf(file) >= 0 && i.getClientRects().length; })[0];
      if (img) { try { img.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) { img.scrollIntoView(); } return; }
      if (++tries < 25) setTimeout(find, 200);
    })();
  }
  function openRef(e) {
    try {
      if (e.lk === "kb" && G.SMD_KB && G.SMD_KB.open) { close(); G.SMD_KB.open(e.ri); return; }
      if (e.lk === "ecg" && G.KARDIOX && G.KARDIOX.openLearn) { close(); G.KARDIOX.openLearn(e.ri); return; }
      if ((e.lk === "eye" || e.lk === "ophthalmos") && G.OPHTHALMOS && G.OPHTHALMOS.open) { close(); G.OPHTHALMOS.open(); return; }
      if ((e.lk === "lesson" || e.lk === "prep") && G.PREP && G.PREP.open) { close(); G.PREP.open({}); return; }
      if (e.lk === "clinix" && G.CLINIX && G.CLINIX.open) { close(); G.CLINIX.open(); return; }
      if (e.lk === "commons" && /^https:\/\/commons\.wikimedia\.org\//.test(String(e.u || "")) && openExternal(e.u)) return;
    } catch (x) {}
    try { if (G.toast) G.toast("Open it from " + (e.f || "its module") + ": " + (e.rn || e.t)); } catch (x) {}
  }

  function viewerLinks(e) {
    var out = "";
    if (e.ls) out += '<button type="button" class="igl-vlink" data-igl="vlesson">Open the lesson' + (isPro() ? "" : ' <span class="igl-pro">Pro</span>') + "</button>";
    if (e.ka) out += '<button type="button" class="igl-vlink' + (e.ls ? " igl-vlink2" : "") + '" data-igl="varticle">Read the article</button>';
    if (!out) out = '<button type="button" class="igl-vlink" data-igl="vlink">' + esc(LINK_LABEL[e.lk] || "Open where it is from") + "</button>";
    return '<div class="igl-vlinks">' + out + "</div>";
  }
  function paintViewer() {
    var v = root().querySelector(".igl-viewer"), e = S.list[S.vi];
    if (!e) { v.hidden = true; return; }
    S.scale = 1;
    var credit = [e.cr, e.li].filter(Boolean).join(" · ");
    v.hidden = false;
    v.innerHTML = '<div class="igl-vbar"><button type="button" class="igl-vclose" data-igl="vclose" aria-label="Close viewer">‹</button>' +
      '<span class="igl-vpos">' + (S.vi + 1) + " of " + S.list.length.toLocaleString() + '</span>' +
      '<button type="button" class="igl-vnav" data-igl="vprev" aria-label="Previous image">‹ Prev</button>' +
      '<button type="button" class="igl-vnav" data-igl="vnext" aria-label="Next image">Next ›</button>' +
      (G.SMD_IMGZOOM ? '<button type="button" class="igl-vnav" data-igl="vreport" aria-label="Report this image">Report</button>' : "") + '</div>' +
      '<div class="igl-vstage"><img class="igl-vimg" src="' + esc(imgUrl(e.s)) + '" alt="' + esc(e.a || e.t) + '" draggable="false"></div>' +
      '<div class="igl-vmeta"><h2>' + esc(e.t) + '</h2><p class="igl-vcap">' + esc(e.c) + "</p>" +
      '<p class="igl-vfrom">From ' + esc(e.f) + (e.rn && e.rn !== e.t ? ": " + esc(e.lk === "kb" && e.kn ? e.kn : e.rn) : "") + " · " + esc(e.k) + "</p>" +
      (credit ? '<p class="igl-vcredit">' + esc(credit) + "</p>" : "") + viewerLinks(e) + "</div>";
    bindViewerTouch(v);
  }
  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  function viewerDims(V) {
    var r = V.stage.getBoundingClientRect(), ow = V.stage.offsetWidth || r.width || 1, z = (r.width || ow) / ow, cs = G.getComputedStyle(V.stage);
    var pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    var oh = V.stage.offsetHeight || 1, W = Math.max(1, ow - pl - pr), H = Math.max(1, oh - pt - pb);
    return { W: W, H: H, w: V.img.offsetWidth || 1, h: V.img.offsetHeight || 1, cx: pl + W / 2, cy: pt + H / 2, z: z || 1, left: r.left, top: r.top };
  }
  function viewerLoc(V, x, y) { var d = viewerDims(V); return { x: (x - d.left) / d.z, y: (y - d.top) / d.z }; }

  function viewerApply(V, ease) {
    V.img.style.transition = ease && !reduced() ? "transform 260ms cubic-bezier(.23, 1, .32, 1)" : "none";
    V.img.style.transform = "translate3d(" + V.t.x.toFixed(1) + "px," + V.t.y.toFixed(1) + "px,0) scale(" + V.s.toFixed(4) + ")";
    V.stage.classList.toggle("zoomed", V.s > 1.01);
    V.el.classList.toggle("igl-zoomed", V.s > 1.01);
    S.scale = V.s;
  }

  function viewerFit(V) {
    if (!V.img || !V.stage) return;
    var cs = G.getComputedStyle(V.stage);
    var W = V.stage.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    var H = V.stage.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    var nw = V.img.naturalWidth, nh = V.img.naturalHeight;
    if (!nw || !nh || W <= 0 || H <= 0) return;
    var k = Math.min(W / nw, H / nh);
    V.img.style.maxWidth = "none"; V.img.style.maxHeight = "none";
    V.img.style.width = Math.floor(nw * k) + "px"; V.img.style.height = Math.floor(nh * k) + "px";
  }

  function viewerZoomTo(V, s2, px, py, ease) {
    var pure = getViewerPure();
    var d = viewerDims(V), f = px == null ? { x: 0, y: 0 } : { x: px - d.cx, y: py - d.cy };
    var min = pure.MIN || 1, max = pure.MAX || 5;
    s2 = Math.max(min, Math.min(max, s2));
    V.t = pure.clampPan(pure.zoomAt(V.t, V.s, s2, f), s2, d.w, d.h, d.W, d.H);
    V.s = s2;
    viewerApply(V, ease);
  }

  function viewerSettle(V) {
    var pure = getViewerPure();
    var d = viewerDims(V);
    var min = pure.MIN || 1, max = pure.MAX || 5;
    var s = Math.max(min, Math.min(max, V.s));
    if (s !== V.s) {
      var f = V.g && V.g.mid ? { x: V.g.mid.x - d.cx, y: V.g.mid.y - d.cy } : { x: 0, y: 0 };
      V.t = pure.zoomAt(V.t, V.s, s, f);
      V.s = s;
    }
    V.t = pure.clampPan(V.t, V.s, d.w, d.h, d.W, d.H);
    if (V.s <= 1.001) { V.s = 1; V.t = { x: 0, y: 0 }; }
    viewerApply(V, true);
  }

  function viewerGrab(V) {
    try {
      var m = new G.DOMMatrixReadOnly(G.getComputedStyle(V.img).transform);
      if (m && m.a > 0) { V.s = m.a; V.t = { x: m.e, y: m.f }; viewerApply(V, false); }
    } catch (e) {}
  }

  function viewerList(V) {
    return Object.keys(V.pts).map(function (k) { return V.pts[k]; });
  }

  function viewerBegin(V) {
    var p = viewerList(V);
    if (p.length >= 2) {
      V.g = {
        kind: "pinch",
        d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1,
        s0: V.s,
        t0: { x: V.t.x, y: V.t.y },
        m0: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 },
        mid: null
      };
    } else if (p.length === 1) {
      V.g = {
        kind: "one",
        x0: p[0].x,
        y0: p[0].y,
        t0: { x: V.t.x, y: V.t.y },
        moved: false,
        dx: 0,
        dy: 0,
        hist: [{ x: p[0].x, y: p[0].y, t: Date.now() }]
      };
    } else {
      V.g = null;
    }
  }

  function viewerTap(V, x, y) {
    var now = Date.now(), p = V.tap, pure = getViewerPure();
    V.g = null;
    if (p && now - p.t < 320 && Math.abs(p.x - x) < 32 && Math.abs(p.y - y) < 32) {
      V.tap = null;
      var dt = pure.DT || 2.5;
      return V.s > 1.01 ? viewerZoomTo(V, 1, null, null, true) : viewerZoomTo(V, dt, x, y, true);
    }
    V.tap = { t: now, x: x, y: y };
  }

  function bindViewerTouch(v) {
    if (v._cleanup) { try { v._cleanup(); } catch (x) {} }
    var stage = v.querySelector(".igl-vstage"), img = v.querySelector(".igl-vimg");
    if (!stage || !img) return;
    if (G.SMD_WM) G.SMD_WM.follow(img);   // the watermark rides the image's zoom

    var V = {
      el: v,
      stage: stage,
      img: img,
      s: 1,
      t: { x: 0, y: 0 },
      pts: {},
      g: null,
      tap: null,
      destroyed: false
    };
    v._V = V;
    S.scale = 1;

    stage.style.touchAction = "none";
    img.style.transformOrigin = "50% 50%";
    img.style.willChange = "transform";
    img.style.pointerEvents = "none";
    img.style.userSelect = "none";
    if (img.style.webkitUserSelect !== undefined) img.style.webkitUserSelect = "none";
    if (img.style.webkitUserDrag !== undefined) img.style.webkitUserDrag = "none";

    var onPointerDown = function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!viewerList(V).length) viewerGrab(V);
      V.pts[e.pointerId] = viewerLoc(V, e.clientX, e.clientY);
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      viewerBegin(V);
    };

    var onPointerMove = function (e) {
      if (!V.pts[e.pointerId] || !V.g) return;
      var lp = V.pts[e.pointerId] = viewerLoc(V, e.clientX, e.clientY);
      var p = viewerList(V), g = V.g, d = viewerDims(V), pure = getViewerPure();
      if (g.kind === "pinch" && p.length >= 2) {
        var dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        var s2 = pure.softScale(g.s0 * dist / g.d0);
        var m = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        var k = s2 / g.s0;
        V.t = pure.softPan({
          x: (m.x - d.cx) - k * (g.m0.x - d.cx - g.t0.x),
          y: (m.y - d.cy) - k * (g.m0.y - d.cy - g.t0.y)
        }, s2, d.w, d.h, d.W, d.H);
        V.s = s2;
        g.mid = m;
        V.tap = null;
        viewerApply(V, false);
      } else if (g.kind === "one") {
        var dx = lp.x - g.x0, dy = lp.y - g.y0;
        g.dx = dx;
        g.dy = dy;
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
        g.moved = true;
        V.tap = null;
        g.hist.push({ x: lp.x, y: lp.y, t: Date.now() });
        if (g.hist.length > 6) g.hist.shift();
        if (V.s > 1.01) {
          V.t = pure.softPan({ x: g.t0.x + dx, y: g.t0.y + dy }, V.s, d.w, d.h, d.W, d.H);
          viewerApply(V, false);
        }
      }
    };

    var onPointerUp = function (e) {
      if (!V.pts[e.pointerId]) return;
      var g = V.g, wasOne = g && g.kind === "one", n0 = viewerList(V).length;
      delete V.pts[e.pointerId];
      if (V.destroyed) return;
      if (n0 >= 2) {
        if (viewerList(V).length < 2) { viewerSettle(V); viewerBegin(V); }
        return;
      }
      if (wasOne && !g.moved && e.type === "pointerup") {
        var tp = viewerLoc(V, e.clientX, e.clientY);
        return viewerTap(V, tp.x, tp.y);
      }
      if (wasOne && g.moved && V.s <= 1.01) {
        var h = g.hist, a = h[0], b = h[h.length - 1];
        var dt = b ? b.t - a.t : 0, vx = dt > 0 ? (b.x - a.x) / dt : 0;
        var dx = g.dx, dy = g.dy;
        if (shouldSwipeNav(V.s, dx, dy) || (Math.abs(vx) > 0.35 && Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.4)) {
          stepViewer(dx < 0 ? 1 : -1);
          return;
        }
      }
      viewerSettle(V);
      V.g = null;
    };

    var onWheel = function (e) {
      e.preventDefault();
      var wp = viewerLoc(V, e.clientX, e.clientY), pure = getViewerPure();
      if (e.ctrlKey) {
        viewerZoomTo(V, V.s * Math.exp(-e.deltaY * 0.01), wp.x, wp.y, false);
      } else if (V.s > 1.01) {
        var d = viewerDims(V);
        V.t = pure.clampPan({ x: V.t.x - e.deltaX / d.z, y: V.t.y - e.deltaY / d.z }, V.s, d.w, d.h, d.W, d.H);
        viewerApply(V, false);
      }
    };

    var onPrevent = function (e) { e.preventDefault(); };
    var onTouchMove = function (e) {
      if (!e.target.closest || !e.target.closest(".igl-vmeta")) e.preventDefault();
    };

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("touchmove", onPrevent, { passive: false });
    stage.addEventListener("gesturestart", onPrevent);
    v.addEventListener("gesturestart", onPrevent);
    v.addEventListener("touchmove", onTouchMove, { passive: false });

    V.onResize = function () {
      if (!V.destroyed) { viewerFit(V); viewerSettle(V); }
    };
    G.addEventListener("resize", V.onResize);

    if (img.complete && img.naturalWidth) viewerFit(V);
    else img.addEventListener("load", function () { if (!V.destroyed) { viewerFit(V); viewerApply(V, false); } });

    v._cleanup = function () {
      V.destroyed = true;
      G.removeEventListener("resize", V.onResize);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("touchmove", onPrevent);
      stage.removeEventListener("gesturestart", onPrevent);
      v.removeEventListener("gesturestart", onPrevent);
      v.removeEventListener("touchmove", onTouchMove);
    };
  }
  function viewerState() {
    var v = root() && root().querySelector(".igl-viewer");
    if (v && v._V) {
      return { s: v._V.s, x: v._V.t.x, y: v._V.t.y };
    }
    return null;
  }
  function stepViewer(d) {
    var n = S.vi + d;
    if (n < 0 || n >= S.list.length) return;
    S.vi = n; paintViewer();
  }

  function onClick(ev) {
    var b = ev.target.closest ? ev.target.closest("[data-igl]") : null;
    if (!b) return;
    var a = b.getAttribute("data-igl");
    if (a === "back") { back(); return; }
    if (a === "sys") {
      var slug = b.getAttribute("data-v");
      var sys = (ix.systems || []).filter(function (s) { return s.slug === slug; })[0];
      openSystem(slug, sys ? sys.name : slug); return;
    }
    if (a === "chip") { S[b.getAttribute("data-k")] = b.getAttribute("data-v") || ""; S.shown = 60; paintGrid(); return; }
    if (a === "more") { S.shown += 60; paintGrid(); return; }
    if (a === "open") { S.vi = +b.getAttribute("data-i"); paintViewer(); return; }
    if (a === "vclose") {
      var cv = root().querySelector(".igl-viewer");
      if (cv) {
        if (cv._cleanup) { try { cv._cleanup(); } catch (x) {} }
        cv.hidden = true;
      }
      return;
    }
    if (a === "vprev") { stepViewer(-1); return; }
    if (a === "vnext") { stepViewer(1); return; }
    if (a === "vlink") { openRef(S.list[S.vi]); return; }
    if (a === "vlesson") { openLesson(S.list[S.vi]); return; }
    if (a === "varticle") { openArticle(S.list[S.vi]); return; }
    // Report (image-zoom.js): a correction, a copyright concern or a better image, checked by an admin.
    if (a === "vreport") { var re = S.list[S.vi]; if (re && G.SMD_IMGZOOM) G.SMD_IMGZOOM.report({ src: /^https:/.test(re.s) ? re.s : String(re.s || ""), title: re.t, where: "Image Library: " + (S.name || "") }); return; }
  }
  function onKey(ev) { if (ev.key === "Escape") back(); }

  function open(opts) {
    if (!enabled()) return false;
    opts = opts || {};
    ensureRoot();
    S = { view: "systems", slug: "", name: "", items: [], shown: 60, list: [], q: "", from: opts.from || "",
      kind: opts.kind || "", origin: "", vi: 0, scale: 1 };
    root().hidden = false;
    G.document.body.classList.add("igl-open");
    var q = root().querySelector(".igl-q"); if (q) q.value = "";
    loadIndex().then(function () {
      if (!root() || root().hidden) return;
      if (opts.system) {
        var sys = (ix.systems || []).filter(function (s) { return s.slug === opts.system; })[0];
        if (sys) { openSystem(sys.slug, sys.name); return; }
      }
      if (opts.searchAll) { openSearchAll(); return; }
      paintSystems();
    }, function () {
      if (root()) root().querySelector(".igl-body").innerHTML =
        '<p class="igl-empty">The image index did not load. Check your connection and try again.</p>';
    });
    G.document.addEventListener("keydown", onKey);
    return true;
  }
  function close() {
    var r = root(); if (r) r.hidden = true;
    G.document.body.classList.remove("igl-open");
    G.document.removeEventListener("keydown", onKey);
  }
  function back() {
    var v = root() && root().querySelector(".igl-viewer");
    if (v && !v.hidden) {
      if (v._cleanup) { try { v._cleanup(); } catch (x) {} }
      v.hidden = true;
      return true;
    }
    if (S && S.view === "grid") { S.view = "systems"; paintSystems(); return true; }
    close(); return true;
  }
  function isOpen() { var r = root(); return !!(r && !r.hidden); }

  G.SMD_IMGLIB = { enabled: enabled, open: open, close: close, back: back, isOpen: isOpen, _pure: PURE, _state: viewerState };
})(typeof window !== "undefined" ? window : this);
