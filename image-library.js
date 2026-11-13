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
  var PURE = { enabled: enabled, imgUrl: imgUrl, matches: matches, filterItems: filterItems };
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
  function bindViewerTouch(v) {
    var stage = v.querySelector(".igl-vstage"), img = v.querySelector(".igl-vimg");
    if (G.SMD_WM) G.SMD_WM.follow(img);   // the watermark rides the image's zoom
    var x0 = null, y0 = null, d0 = 0, moved = false, lastTap = 0;
    function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    stage.addEventListener("touchstart", function (ev) {
      if (ev.touches.length === 2) { d0 = dist(ev.touches); moved = true; }
      else if (ev.touches.length === 1) { x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; moved = false; }
    }, { passive: true });
    stage.addEventListener("touchmove", function (ev) {
      if (ev.touches.length === 2 && d0) {
        S.scale = Math.min(4, Math.max(1, S.scale * (dist(ev.touches) / d0)));
        d0 = dist(ev.touches);
        img.style.transform = "scale(" + S.scale + ")";
        moved = true;
      }
    }, { passive: true });
    stage.addEventListener("touchend", function (ev) {
      if (x0 == null) return;
      var t = ev.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      var now = Date.now();
      if (!moved && Math.abs(dx) < 12 && Math.abs(dy) < 12 && now - lastTap < 320) {
        S.scale = S.scale > 1 ? 1 : 2.2; img.style.transform = "scale(" + S.scale + ")";
      } else if (S.scale <= 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        stepViewer(dx < 0 ? 1 : -1);
      }
      lastTap = now; x0 = y0 = null; d0 = 0;
    }, { passive: true });
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
    if (a === "vclose") { root().querySelector(".igl-viewer").hidden = true; return; }
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
    if (v && !v.hidden) { v.hidden = true; return true; }
    if (S && S.view === "grid") { S.view = "systems"; paintSystems(); return true; }
    close(); return true;
  }
  function isOpen() { var r = root(); return !!(r && !r.hidden); }

  G.SMD_IMGLIB = { enabled: enabled, open: open, close: close, back: back, isOpen: isOpen, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
