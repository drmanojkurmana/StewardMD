/* PrepNucleus previous-year questions (PYQ). ES5. window.PREP_PYQ, loaded by prep-loader.js after prep.js; draws through
   PREP._host. prep.js forwards every data-act starting "y-" here, asks back() first, and calls chips(), figure() and
   prov() while drawing a question.
   Data (tools/prep-pyq.mjs, served from R2 through /api/prep/bank/v2/pyq/): index.json { papers, file, tags, mods } and
   the items file it names. Both are kept in IndexedDB prep-bank so papers open offline after the first time.
   Honesty: every paper here is a memory-based recall, labelled "recall" everywhere; NBEMS does not publish NEET-PG
   papers. Flagged items (key unclear, image missing, disputed, papers that disagree) never show.
   Screens: Previous year papers (home row) -> a paper (timed test in the NEET-PG pattern from MOCKS, or practice);
   a PYQ chip on a module; "Asked in NEET-PG 2025 (recall)" chips on bank and PYQ items; question images with tap to
   enlarge (tap again for 2.2x; back or Escape closes). */
(function (G) {
  "use strict";
  var EXAM_LABEL = { "neet-pg": "NEET-PG", "ini-cet": "INI-CET", "neet-ss": "NEET-SS", usmle: "USMLE" };

  /* ================= pure ================= */
  // [exam, year, kind] or { exam, year, kind } -> one line per exam and kind: "Asked in NEET-PG 2025, 2024 (recall)".
  function tagLabel(list) {
    var by = {}, order = [];
    (list || []).forEach(function (t) {
      var exam = t.exam || t[0], year = t.year || t[1], kind = t.kind || t[2], k = exam + "|" + kind;
      if (!by[k]) { by[k] = []; order.push(k); }
      if (by[k].indexOf(year) < 0) by[k].push(year);
    });
    return order.map(function (k) {
      var p = k.split("|"), ys = by[k].sort(function (a, b) { return b - a; });
      return "Asked in " + (EXAM_LABEL[p[0]] || p[0]) + " " + ys.join(", ") + (p[1] === "official" ? "" : " (recall)");
    });
  }
  function paperTitle(p) {
    var s = p.session ? " · " + String(p.session).replace(/^shift-(\d+)$/, "Shift $1") : "";
    return (EXAM_LABEL[p.exam] || p.exam) + " " + p.year + s;
  }
  // The timed test follows the exam's real pattern (MOCKS in prep.js): the pattern's time per question and marking.
  function paperScheme(mock, n) {
    return { limit: Math.round(n * mock.min * 60 / mock.n), plus: mock.plus, minus: mock.minus, label: mock.label };
  }
  function usable(it, hidden) { return !!it && !(it.flags && it.flags.length) && !(hidden && hidden[it.id]); }
  // A paper's questions in paper order (an item asked in two papers carries both numbers in pyq).
  function paperItems(items, pid) {
    var out = [];
    (items || []).forEach(function (it) { (it.pyq || []).forEach(function (x) { if (x.src === pid) out.push({ it: it, n: x.n }); }); });
    out.sort(function (a, b) { return a.n - b.n; });
    var seen = {};
    return out.filter(function (x) { if (seen[x.it.id]) return false; seen[x.it.id] = 1; return true; }).map(function (x) { return x.it; });
  }
  // PYQ count of a module: recall items mapped to it (not copies of a bank item) + bank items tagged as asked.
  function moduleCount(ix, mid) {
    if (!ix) return 0;
    var n = (ix.mods && ix.mods[mid]) || 0;
    Object.keys(ix.tags || {}).forEach(function (id) { if (ix.tags[id][0] === mid) n++; });
    return n;
  }
  function bySubject(items) { var c = {}; items.forEach(function (it) { var s = it.subject || "unsorted"; c[s] = (c[s] || 0) + 1; }); return c; }
  var PURE = { tagLabel: tagLabel, paperTitle: paperTitle, paperScheme: paperScheme, usable: usable, paperItems: paperItems, moduleCount: moduleCount, bySubject: bySubject };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var P = { ix: null, ixP: null, items: null, itP: null, zoom: null, mf: {}, host: null };
  function base(host) { return (host.bankApi || "/api/prep/bank/") + "v2/pyq/"; }
  function getJSON(url) { return G.fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  // index.json: network first (it names the current items file), the IndexedDB copy when offline.
  function loadIndex(host) {
    if (P.ix) return Promise.resolve(P.ix);
    if (P.ixP) return P.ixP;
    P.ixP = getJSON(base(host) + "index.json").then(function (ix) { host.cachePut("pyq/index.json", ix); return ix; }, function () {
      return host.cacheGet("pyq/index.json").then(function (hit) { if (!hit) throw new Error("offline"); return hit; });
    }).then(function (ix) { P.ix = ix; P.ixP = null; return ix; }, function (e) { P.ixP = null; throw e; });
    return P.ixP;
  }
  function loadItems(host) {
    if (P.items) return Promise.resolve(P.items);
    if (P.itP) return P.itP;
    P.itP = loadIndex(host).then(function (ix) {
      var key = "pyq/" + ix.file;
      return host.cacheGet(key).then(function (hit) {
        return hit || getJSON(base(host) + ix.file).then(function (f) { host.cachePut(key, f); return f; });
      });
    }).then(function (f) {
      // _s/_m: the subject and module FSRS and the mock analysis file it under; "pyq" until the mapping sorts it.
      P.items = (f.items || []).map(function (it) { it._py = 1; it._s = it.ts || it.subject || "pyq"; it._m = it.t || "pyq"; return it; });
      P.itP = null; return P.items;
    }, function (e) { P.itP = null; throw e; });
    return P.itP;
  }
  function warm(host) { P.host = host; loadIndex(host).then(null, function () {}); }

  var ICO = {
    papers: '<rect x="4" y="3" width="13" height="17" rx="2"/><path d="M8 8h5M8 12h5M8 16h3M20 7v12a2 2 0 0 1-2 2H8"/>',
    tag: '<path d="M12 7v5l3 2"/><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 4v4.5H8"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6"/>'
  };
  function svg(n, size) { return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICO[n] + "</svg>"; }
  function icon() { return svg("papers"); }
  function mockFor(host, exam) { return host.mockOf(exam, exam); }

  // Home: one row in the Practise group (NEET-PG only: the papers we hold are NEET-PG).
  function homeRow(host) {
    warm(host);
    return host.row("y-home", icon(), "Previous year papers", "NEET-PG recall papers by year, timed or practice");
  }

  var NOTE = '<section class="pn-yq-note" aria-label="About these papers"><span class="pn-yq-ni">' + svg("info", 18) + "</span><p><b>Recall papers, not official ones.</b> NBEMS does not publish NEET-PG papers. These were put together from memory after each exam, so wording and options can differ from the real paper. Questions whose answer key is unclear or whose image is missing are held back.</p></section>";
  function renderPapers(host) {
    var esc = host.esc;
    host.paint(host.bar("Previous year papers", "NEET-PG · recall", "back") + '<div class="pn-body" id="pnYq">' + NOTE + '<p class="pn-load" role="status">Loading papers</p></div>');
    Promise.all([loadIndex(host), loadItems(host)]).then(function (r) {
      var box = host.root() && host.root().querySelector("#pnYq"); if (!box) return;
      var ix = r[0], items = r[1], hid = hiddenOf(host), years = {}, html = "";
      ix.papers.filter(function (p) { return p.exam === "neet-pg"; }).forEach(function (p) { (years[p.year] = years[p.year] || []).push(p); });
      var ys = Object.keys(years).sort(function (a, b) { return b - a; });
      if (!ys.length) { box.innerHTML = NOTE + '<p class="pn-empty">No previous year papers for this exam yet.</p>'; return; }
      ys.forEach(function (y) {
        html += '<h2 class="pn-sec">' + esc(y) + '</h2><div class="pn-group">' + years[y].map(function (p) {
          var list = paperItems(items, p.id), ok = list.filter(function (it) { return usable(it, hid); }), img = ok.filter(function (it) { return it.img; }).length;
          return '<button type="button" class="pn-row pn-yq-row" data-act="y-paper" data-v="' + esc(p.id) + '"><span class="pn-ri" aria-hidden="true">' + icon() + '</span><span class="pn-rb"><b>' + esc(paperTitle(p)) + "</b><small>" + host.fmt(ok.length) + " questions" + (img ? " · " + img + " with images" : "") + '</small></span><span class="pn-yq-kind">' + (p.kind === "official" ? "Official" : "Recall") + "</span>" + host.ico("chev") + "</button>";
        }).join("") + "</div>";
      });
      box.innerHTML = NOTE + html;
    }, function () {
      var box = host.root() && host.root().querySelector("#pnYq"); if (!box) return;
      box.innerHTML = NOTE + '<p class="pn-err" role="alert">Previous year papers need a connection the first time. Once opened they work offline.</p><button type="button" class="pn-btn" data-act="y-home-retry">Try again</button>';
    });
  }
  function hiddenOf(host) { try { var h = host.store().hid; return (h && h.ids) || {}; } catch (e) { return {}; } }
  function fmtMin(m) { var h = Math.floor(m / 60), r = m % 60; return (h ? h + " h" : "") + (h && r ? " " : "") + (r ? r + " min" : ""); }
  function fmtMark(x) { return Math.abs(x - 1 / 3) < 1e-9 ? "1/3" : String(x); }
  function renderPaper(host, pid) {
    var esc = host.esc, p = null;
    (P.ix ? P.ix.papers : []).forEach(function (x) { if (x.id === pid) p = x; });
    if (!p || !P.items) return;
    var list = paperItems(P.items, pid), hid = hiddenOf(host), ok = list.filter(function (it) { return usable(it, hid); });
    var held = list.length - ok.length, mock = mockFor(host, "neet-pg"), sc = paperScheme(mock, ok.length), subj = bySubject(ok);
    var subs = Object.keys(subj).sort(function (a, b) { return subj[b] - subj[a]; }).map(function (sid) {
      var sb = host.subjectById(sid);
      return '<li><span class="pn-yq-sn">' + (sb ? host.tx(sb.name) : "Not sorted yet") + '</span><span class="pn-st">' + subj[sid] + "</span></li>";
    }).join("");
    host.paint(host.bar(esc(paperTitle(p)), "Recall paper", "back") + '<div class="pn-body"><section class="pn-panel">' +
      '<p class="pn-big">' + host.fmt(ok.length) + ' questions</p><p class="pn-mut">' + (held ? held + " held back (unclear key or missing image) · " : "") + "memory-based recall</p>" +
      '<button type="button" class="pn-btn pri" data-act="y-start" data-v="' + esc(pid) + '" data-k="exam"' + (ok.length ? "" : " disabled") + ">" + host.ico("clock") + " Timed test: " + fmtMin(Math.round(sc.limit / 60)) + ", +" + mock.plus + " / −" + fmtMark(mock.minus) + "</button>" +
      '<button type="button" class="pn-btn" data-act="y-start" data-v="' + esc(pid) + '" data-k="study"' + (ok.length ? "" : " disabled") + ">" + host.ico("play") + " Practice in paper order</button>" +
      '<p class="pn-mut pn-small">The timed test uses the ' + esc(mock.label) + " (" + mock.n + " questions in " + fmtMin(mock.min) + "), scaled to this paper. Practice shows each answer with its explanation.</p></section>" +
      (subs ? '<h2 class="pn-sec">By subject</h2><ul class="pn-yq-subs">' + subs + "</ul>" : "") + "</div>");
  }
  function startPaper(host, pid, kind) {
    var p = null; P.ix.papers.forEach(function (x) { if (x.id === pid) p = x; });
    var hid = hiddenOf(host), ok = paperItems(P.items, pid).filter(function (it) { return usable(it, hid); });
    if (!p || !ok.length) return host.toast("This paper has no questions to show yet.");
    var title = paperTitle(p) + " (recall)";
    if (kind === "exam") { var sc = paperScheme(mockFor(host, "neet-pg"), ok.length); return host.run(ok.slice(), "exam", title, { limit: sc.limit, scheme: { plus: sc.plus, minus: sc.minus, label: sc.label } }); }
    host.run(ok.slice(), "study", title);
  }

  // Module screen: "All questions" / "PYQ n" chips; PYQ swaps the module's panel for its own.
  function mount(slot, sid, mid, host) {
    if (!slot) return;
    P.host = host;
    loadIndex(host).then(function (ix) {
      var n = moduleCount(ix, mid);
      if (!n || !slot.isConnected) return;
      drawSlot(slot, sid, mid, n, host);
    }, function () {});
  }
  function drawSlot(slot, sid, mid, n, host) {
    var on = P.mf[mid] === "pyq", main = host.root().querySelector("#pnModPanel");
    if (main) main.hidden = on;
    slot.innerHTML = '<div class="pn-wrap pn-yq-chips" role="group" aria-label="Show questions">' +
      '<button type="button" class="pn-chip' + (on ? "" : " on") + '" aria-pressed="' + !on + '" data-act="y-mf" data-v="all" data-s="' + host.esc(sid) + '" data-m="' + host.esc(mid) + '">All questions</button>' +
      '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="y-mf" data-v="pyq" data-s="' + host.esc(sid) + '" data-m="' + host.esc(mid) + '">PYQ · ' + n + "</button></div>" +
      (on ? '<section class="pn-panel"><p class="pn-big">' + n + ' PYQs</p><p class="pn-mut">Asked in NEET-PG, from recall papers</p>' +
        '<button type="button" class="pn-btn pri" data-act="y-mstart" data-k="study" data-s="' + host.esc(sid) + '" data-m="' + host.esc(mid) + '">' + host.ico("play") + " Practice PYQs</button>" +
        '<button type="button" class="pn-btn" data-act="y-mstart" data-k="exam" data-s="' + host.esc(sid) + '" data-m="' + host.esc(mid) + '">' + host.ico("clock") + " Timed test of PYQs</button></section>" : "");
  }
  function startModulePyq(host, sid, mid, kind) {
    Promise.all([loadItems(host), host.loadModule(sid, mid).then(null, function () { return []; })]).then(function (r) {
      var hid = hiddenOf(host), tags = P.ix.tags || {};
      var own = r[0].filter(function (it) { return it.t === mid && !it.bank && usable(it, hid); });
      var bank = host.pool(r[1]).filter(function (it) { return tags[it.id]; });
      var list = bank.concat(own);
      if (!list.length) return host.toast("No previous-year questions to show here yet.");
      var t = host.subjectById(sid), title = "PYQs" + (t ? " · " + host.tx(t.name) : "");
      host.run(list, kind === "exam" ? "exam" : "study", title);
    }, function () { host.toast("The questions did not load. Check the connection and try again."); });
  }

  // While a question is drawn (prep.js renderRun / reviewQuestion).
  function chips(it, host) {
    if (host) P.host = host;
    var list = it._py ? it.pyq : (P.ix && P.ix.tags && P.ix.tags[it.id] ? P.ix.tags[it.id][1] : null);
    if (!list || !list.length) return "";
    var e = P.host ? P.host.esc : function (s) { return s; };
    return '<p class="pn-yq-tags">' + tagLabel(list).map(function (l) { return '<span class="pn-yq-tag">' + svg("tag", 14) + "<span>" + e(l) + "</span></span>"; }).join("") + "</p>";
  }
  function figure(it, host) {
    if (host) P.host = host;
    if (!it.img || !it.img.length || !P.host) return "";
    var e = P.host.esc, b = base(P.host);
    return it.img.map(function (f, k) {
      return '<figure class="pn-vfig pn-yq-fig"><button type="button" class="pn-vimg" data-act="y-zoom" data-v="' + e(f) + '" aria-label="Enlarge image ' + (k + 1) + ' of this question"><img src="' + e(b + "img/" + f) + '" alt="Image for this question (' + (k + 1) + " of " + it.img.length + ')" loading="lazy" decoding="async"></button>' +
        '<figcaption><span class="pn-vzi" aria-hidden="true">' + svg("zoom", 16) + "</span><span>Tap to enlarge.</span></figcaption></figure>";
    }).join("");
  }
  function prov(it) {
    var p = it.pyq && it.pyq[0], what = p ? (EXAM_LABEL[p.exam] || p.exam) + " " + p.year + " recall question (memory-based, not an official paper)" : "Recall question";
    return what + (it.r ? ". Explanation written by StewardMD AI and checked." : ".");
  }
  function zoomOpen(host, f) {
    zoomClose();
    var root = host.root(), e = host.esc, el = G.document.createElement("div");
    el.className = "pn-zoom"; el.id = "pnYqZoom"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Image, enlarged");
    el.innerHTML = '<div class="pn-zoom-top"><p>Question image</p><button type="button" class="pn-ib" data-act="y-unzoom" aria-label="Close image">' + host.ico("close") + "</button></div>" +
      '<div class="pn-zoom-sc"><button type="button" class="pn-zoom-b" data-act="y-zoom2" aria-pressed="false" aria-label="Enlarge further"><img src="' + e(base(host) + "img/" + f) + '" alt="Image for this question, enlarged"></button></div><p class="pn-zoom-h">Tap the image to enlarge it further</p>';
    root.appendChild(el);
    P.zoom = { el: el, from: f };
    var c = el.querySelector("[data-act=y-unzoom]"); if (c) c.focus();
  }
  function zoomClose() {
    if (!P.zoom) return false;
    var z = P.zoom; P.zoom = null;
    if (z.el.parentNode) z.el.parentNode.removeChild(z.el);
    var r = P.host && P.host.root(), t = r && r.querySelector('[data-act=y-zoom][data-v="' + z.from + '"]'); if (t) t.focus();
    return true;
  }

  function act(a, b, host) {
    P.host = host;
    var v = b.getAttribute("data-v");
    if (a === "y-home") return host.push(function () { renderPapers(host); });
    if (a === "y-home-retry") return renderPapers(host);
    if (a === "y-paper") return loadItems(host).then(function () { host.push(function () { renderPaper(host, v); }); }, function () { host.toast("The paper did not load. Check the connection and try again."); });
    if (a === "y-start") return startPaper(host, v, b.getAttribute("data-k"));
    if (a === "y-mf") { P.mf[b.getAttribute("data-m")] = v; var slot = host.root().querySelector("#pnPyqSlot"); return drawSlot(slot, b.getAttribute("data-s"), b.getAttribute("data-m"), moduleCount(P.ix, b.getAttribute("data-m")), host); }
    if (a === "y-mstart") return startModulePyq(host, b.getAttribute("data-s"), b.getAttribute("data-m"), b.getAttribute("data-k"));
    if (a === "y-zoom") return zoomOpen(host, v);
    if (a === "y-zoom2") { var big = b.classList.toggle("big"); b.setAttribute("aria-pressed", String(big)); return; }
    if (a === "y-unzoom") return zoomClose();
  }
  // back(): true when handled here (an enlarged image closes first).
  function back() { return zoomClose(); }
  function leave() { P.zoom = null; P.mf = {}; }

  G.PREP_PYQ = { homeRow: homeRow, warm: warm, mount: mount, chips: chips, figure: figure, prov: prov, act: act, back: back, leave: leave, _pure: PURE, _st: P };
})(typeof window !== "undefined" ? window : this);
