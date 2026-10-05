/* PrepNucleus: the medical exam question bank (NEET-PG, INI-CET, NEET-SS, USMLE). window.PREP. ES5.
   Plan: vault/plans/PrepNucleus.md (5.2). Loaded on first open by prep-loader.js, the only PrepNucleus file at boot.

   Data. prep/taxonomy.json (branch > subject > section > module) and prep/bank/v1/<subject>/index.json (per-module
   counts) ship with the app. A module's questions (prep/bank/v1/<subject>/mcq/<module>.json) are fetched from
   /api/prep/bank/v1/... the first time the module opens and kept in IndexedDB ("prep-bank"), so a module opened once,
   or a subject downloaded for offline, works without a network. Items carrying a flag (doubtful or disputed key) are
   never shown.

   Progress lives on the device (localStorage smd_prep_v1): FSRS memory per question through specialty-core.js (deck
   key "p:<module>"), attempts and right answers per module, bookmarks, reports. Nothing here calls an AI service.

   Screens: home (exam tabs, solve next, bookmarks, custom module, subject grid) -> subject (sections and numbered
   modules with MCQ counts, mastery stars, filters) -> module (practice with explanations, timed test, due reviews)
   -> question runner (study: marked at once with the explanation; test: marked at the end) -> results.
   Flag: smd_prep (default OFF; "1" or ?prep=1 turns it on, "0" off). Pure helpers load under node for tests. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var EXAMS = [
    { id: "neet-pg", label: "NEET-PG / INI-CET", branch: "mbbs", tag: "neet-pg", sec: 60 },
    { id: "neet-ss", label: "NEET-SS", branch: "ss-medicine", tag: "neet-ss", sec: 60 },
    { id: "usmle", label: "USMLE", branch: "mbbs", tag: "usmle", sec: 90 }
  ];
  function examOf(id) { for (var i = 0; i < EXAMS.length; i++) if (EXAMS[i].id === id) return EXAMS[i]; return EXAMS[0]; }
  function emptyStore() { return { v: 1, cards: {}, conf: {}, days: {}, mod: {}, bm: {}, rep: {}, exam: "neet-pg", last: null, dl: {}, hid: { ids: {}, ts: 0 } }; }
  function deckKey(moduleId) { return "p:" + moduleId; }
  // hidden: item ids withdrawn after repeated student reports (/api/prep/flag?hidden=1), as an id -> 1 map.
  function usable(it, hidden) { return !!it && !(it.flags && it.flags.length) && !(hidden && hidden[it.id]); }
  // Questions the app shows for a module: flagged keys and hidden items out; for USMLE, vignettes when there are enough.
  function poolFor(items, exam, hidden) {
    var ok = (items || []).filter(function (it) { return usable(it, hidden); });
    if (exam === "usmle") { var v = ok.filter(function (it) { return it.ex && it.ex.indexOf("usmle") >= 0; }); if (v.length >= 5) return v; }
    return ok;
  }
  // One pass over the FSRS cards: answered and due counts per module.
  function progressByModule(store, today) {
    var out = {}, k, parts, m, c;
    for (k in store.cards) {
      if (k.indexOf("p:") !== 0) continue;
      parts = k.split(":"); m = parts[1]; c = store.cards[k];
      var r = out[m] || (out[m] = { answered: 0, due: 0 });
      r.answered++;
      if (c[3] <= today) r.due++;
    }
    return out;
  }
  function statusOf(answered, count) { return !answered ? "new" : count && answered >= count ? "done" : "paused"; }
  // Mastery 0 to 5 stars from the share of right answers, once there are at least 5 attempts.
  function stars(ms) { if (!ms || (ms.t || 0) < 5) return null; return Math.max(0, Math.min(5, Math.round((ms.ok / ms.t) * 5))); }
  function countFor(t, exam) { return exam === "usmle" && t.usmle >= 5 ? t.usmle : t.count || 0; }
  /* What to solve next, within the exam's subjects (in taxonomy order): the module with the most reviews due; else
     the started, unfinished module with the lowest share right; else the first module never opened that has questions. */
  function solveNext(subjects, indexes, store, today, exam) {
    var prog = progressByModule(store, today), due = null, weak = null, fresh = null;
    subjects.forEach(function (s) {
      var ix = indexes[s.id];
      if (!ix) return;
      ix.topics.forEach(function (t) {
        var n = countFor(t, exam), p = prog[t.id] || { answered: 0, due: 0 }, ms = store.mod[t.id];
        if (!n) return;
        var ref = { subject: s.id, module: t.id, title: t.title };
        if (p.due && (!due || p.due > due.n)) due = { ref: ref, n: p.due };
        if (p.answered && p.answered < n) { var acc = ms && ms.t ? ms.ok / ms.t : 1; if (!weak || acc < weak.acc) weak = { ref: ref, acc: acc }; }
        if (!p.answered && !fresh) fresh = ref;
      });
    });
    if (due) return { why: "due", n: due.n, subject: due.ref.subject, module: due.ref.module, title: due.ref.title };
    if (weak) return { why: "weak", subject: weak.ref.subject, module: weak.ref.module, title: weak.ref.title };
    if (fresh) return { why: "new", subject: fresh.subject, module: fresh.module, title: fresh.title };
    return null;
  }
  function filterModules(topics, prog, filter, exam) {
    return topics.filter(function (t) {
      var n = countFor(t, exam), st = statusOf((prog[t.id] || {}).answered || 0, n);
      return filter === "all" || (filter === "paused" && st === "paused") || (filter === "done" && st === "done") || (filter === "new" && st === "new");
    });
  }
  function shuffle(a, rnd) { rnd = rnd || Math.random; for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  // Custom module: n questions from the given items, optionally one difficulty, spread across modules.
  function customDraw(lists, n, d, rnd) {
    var pools = lists.map(function (l) { return shuffle(l.filter(function (it) { return !d || it.d === d; }).slice(), rnd); }).filter(function (p) { return p.length; });
    var out = [], i = 0;
    while (out.length < n && pools.some(function (p) { return p.length; })) { var p = pools[i % pools.length]; if (p.length) out.push(p.pop()); i++; }
    return shuffle(out, rnd);
  }
  function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  var PURE = { EXAMS: EXAMS, examOf: examOf, emptyStore: emptyStore, deckKey: deckKey, usable: usable, poolFor: poolFor, progressByModule: progressByModule,
    statusOf: statusOf, stars: stars, countFor: countFor, solveNext: solveNext, filterModules: filterModules, customDraw: customDraw, shuffle: shuffle, fmtTime: fmtTime };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var D = G.document, C = G.SPECIALTY_CORE;
  var STATIC = G.SMD_PREP_BASE || "/prep/", API = G.SMD_PREP_BANK_API || "/api/prep/bank/", FLAG_API = G.SMD_PREP_FLAG_API || "/api/prep/flag", VER = "v1";
  var HID_TTL = 6 * 3600e3;
  var KEY = "smd_prep_v1", SESSION = 20;
  var st = { open: false, stack: [], tax: null, ix: {}, mem: {}, store: null, run: null, timer: 0, prevOverflow: "", prevFocus: null, sub: null, filter: "all" };
  var root = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function tx(v) { return esc(v && typeof v === "object" ? (v.en || "") : v); }
  function toast(m) { try { if (G.toast) G.toast(m); } catch (e) {} }
  function today() { return C.dayNum(Date.now(), new Date().getTimezoneOffset()); }
  function fmt(n) { try { return Number(n).toLocaleString("en-IN"); } catch (e) { return String(n); } }

  /* ---------- store ---------- */
  function load() {
    if (st.store) return st.store;
    var s = null; try { s = JSON.parse(G.localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    var e = emptyStore();
    if (!s || s.v !== 1) s = e; else for (var k in e) if (!(k in s)) s[k] = e[k];
    return (st.store = s);
  }
  function save() { try { G.localStorage.setItem(KEY, JSON.stringify(st.store)); } catch (e) { toast("Progress could not be saved: the device storage is full."); } }

  /* ---------- data ---------- */
  function getJSON(url) { return G.fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return r.json(); }); }
  function loadTax() { return st.tax ? Promise.resolve(st.tax) : getJSON(STATIC + "taxonomy.json").then(function (t) { return (st.tax = t); }); }
  function loadIndex(sid) {
    if (st.ix[sid]) return Promise.resolve(st.ix[sid]);
    return getJSON(STATIC + "bank/" + VER + "/" + sid + "/index.json").then(function (ix) { return (st.ix[sid] = ix); }, function () { return (st.ix[sid] = { id: sid, topics: [], counts: { total: 0 } }); });
  }
  function subjectsOf(exam) {
    var ex = examOf(exam), out = [];
    (st.tax ? st.tax.branches : []).forEach(function (b) { if (b.id === ex.branch) b.subjects.forEach(function (s) { if (!s.ex || s.ex.indexOf(ex.tag) >= 0) out.push(s); }); });
    return out;
  }
  function subjectById(id) { var r = null; (st.tax ? st.tax.branches : []).forEach(function (b) { b.subjects.forEach(function (s) { if (s.id === id) r = s; }); }); return r; }
  function topicOf(sid, mid) { var ix = st.ix[sid], r = null; if (ix) ix.topics.forEach(function (t) { if (t.id === mid) r = t; }); return r; }

  // IndexedDB cache of module files: db "prep-bank", store "files", key = path. Falls back to memory only.
  var idbP = null;
  function idb() {
    if (idbP) return idbP;
    idbP = new Promise(function (res) {
      try {
        var rq = G.indexedDB.open("prep-bank", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("files"); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return idbP;
  }
  function idbDo(mode, fn) {
    return idb().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try { var t = db.transaction("files", mode), os = t.objectStore("files"), rq = fn(os); t.oncomplete = function () { res(rq && rq.result); }; t.onerror = function () { res(null); }; } catch (e) { res(null); }
      });
    });
  }
  function cacheGet(path) { return idbDo("readonly", function (os) { return os.get(path); }); }
  function cachePut(path, val) { return idbDo("readwrite", function (os) { return os.put(val, path); }); }
  function cacheKeys() { return idbDo("readonly", function (os) { return os.getAllKeys ? os.getAllKeys() : null; }); }
  function cacheDel(path) { return idbDo("readwrite", function (os) { return os.delete(path); }); }
  function modulePath(sid, mid) { return VER + "/" + sid + "/mcq/" + mid + ".json"; }
  function loadModule(sid, mid) {
    var p = modulePath(sid, mid);
    if (st.mem[p]) return Promise.resolve(st.mem[p]);
    return cacheGet(p).then(function (hit) {
      if (hit && hit.items) return (st.mem[p] = hit.items);
      return getJSON(API + p).then(function (f) {
        var items = (f.items || []).map(function (it) { it._s = sid; it._m = mid; return it; });
        st.mem[p] = items;
        cachePut(p, { items: items, ts: Date.now() });
        return items;
      });
    }).then(function (items) { items.forEach(function (it) { it._s = sid; it._m = mid; }); return items; });
  }

  // Items withdrawn after repeated reports: refreshed on open at most every 6 hours; offline keeps the last list.
  function refreshHidden() {
    var s = load();
    if (s.hid && Date.now() - (s.hid.ts || 0) < HID_TTL) return;
    G.fetch(FLAG_API + "?hidden=1").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.ids) return;
      var m = {}; j.ids.forEach(function (id) { m[id] = 1; });
      s.hid = { ids: m, ts: Date.now() }; save();
    }, function () {});
  }
  function hidden() { var h = load().hid; return (h && h.ids) || {}; }

  // Subject search index (search.json, built with the bank): fetched on the first search, cached like module files.
  function loadSearch(sid) {
    var p = VER + "/" + sid + "/search.json";
    if (st.mem[p]) return Promise.resolve(st.mem[p]);
    return cacheGet(p).then(function (hit) {
      if (hit && hit.sx) return (st.mem[p] = hit.sx);
      return getJSON(API + p).then(function (sx) { st.mem[p] = sx; cachePut(p, { sx: sx, ts: Date.now() }); return sx; });
    });
  }

  /* ---------- shell ---------- */
  var ICON = {
    back: '<path d="M15 18l-6-6 6-6"/>', close: '<path d="M18 6L6 18M6 6l12 12"/>', chev: '<path d="M9 6l6 6-6 6"/>',
    bm: '<path d="M6 3h12v18l-6-4-6 4z"/>', plus: '<path d="M12 5v14M5 12h14"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>', play: '<path d="M7 5l12 7-12 7z"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', next: '<path d="M5 12h14M13 6l6 6-6 6"/>', check: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'
  };
  function ico(n, filled) { return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="' + (filled ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICON[n] || "") + "</svg>"; }
  function bar(title, sub, left, right) {
    return '<header class="pn-bar"><button type="button" class="pn-ib" data-act="' + (left || "back") + '" aria-label="' + (left === "close" ? "Close PrepNucleus" : "Back") + '">' + ico(left === "close" ? "close" : "back") + "</button>" +
      '<div class="pn-t"><h1>' + title + "</h1>" + (sub ? "<p>" + sub + "</p>" : "") + "</div>" + (right || '<span class="pn-ib-sp"></span>') + "</header>";
  }
  function paint(html, focusSel) {
    if (!root) return;
    root.innerHTML = html;
    var f = focusSel ? root.querySelector(focusSel) : root.querySelector(".pn-bar .pn-ib");
    try { if (f) f.focus(); } catch (e) {}
  }
  function push(view) { st.stack.push(view); view(); }
  function rerender() { var v = st.stack[st.stack.length - 1]; if (v) v(); }
  function back() {
    if (!st.open) return false;
    if (st.run && st.run.mode === "exam" && !st.run.done) { if (!G.confirm || G.confirm("Leave the test? Your answers in this test will be lost.")) { stopTimer(); st.run = null; } else return true; }
    stopTimer();
    if (st.stack.length > 1) { st.stack.pop(); rerender(); return true; }
    close(); return true;
  }

  function open(opts) {
    if (st.open) return true;
    load();
    st.prevFocus = D.activeElement; st.prevOverflow = D.body.style.overflow;
    root = D.createElement("div"); root.id = "smdPrep"; root.className = "pn-root";
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "PrepNucleus");
    D.body.appendChild(root); D.body.style.overflow = "hidden";
    root.addEventListener("click", onClick);
    root.addEventListener("input", function (e) {
      if (!e.target || e.target.id !== "pnSearch") return;
      srch.q = e.target.value;
      if (srch.timer) G.clearTimeout(srch.timer);
      srch.timer = G.setTimeout(runSearch, 250);
    });
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); back(); } });
    st.open = true; st.stack = [];
    refreshHidden();
    root.innerHTML = '<div class="pn-load" role="status">Loading PrepNucleus</div>';
    loadTax().then(function () {
      if (opts && opts.subject && subjectById(opts.subject)) { st.stack = [renderHome]; push(function () { renderSubject(opts.subject); }); }
      else push(renderHome);
    }, function () { paint(bar("PrepNucleus", "", "close") + '<div class="pn-body"><p class="pn-err" role="alert">PrepNucleus did not load. Check the connection and try again.</p><button type="button" class="pn-btn" data-act="retry">Try again</button></div>'); });
    return true;
  }
  function close() {
    stopTimer();
    st.open = false; st.run = null; st.stack = [];
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    D.body.style.overflow = st.prevOverflow;
    try { if (st.prevFocus && st.prevFocus.isConnected) st.prevFocus.focus(); } catch (e) {}
  }

  /* ---------- home ---------- */
  function renderHome() {
    var s = load(), ex = examOf(s.exam), subs = subjectsOf(s.exam);
    var tabs = '<div class="pn-tabs" role="tablist" aria-label="Exam">' + EXAMS.map(function (e) {
      return '<button type="button" role="tab" class="pn-tab' + (e.id === ex.id ? " on" : "") + '" aria-selected="' + (e.id === ex.id) + '" data-act="exam" data-v="' + e.id + '">' + esc(e.label) + "</button>";
    }).join("") + "</div>";
    var nb = Object.keys(s.bm).length;
    paint(bar("PrepNucleus", ex.label, "close", '<button type="button" class="pn-ib" data-act="downloads" aria-label="Offline downloads">' + ico("dl") + "</button>") +
      tabs + '<div class="pn-body" id="pnHome">' +
      '<button type="button" class="pn-next" data-act="solvenext" id="pnNext" hidden><span>Solve next</span><b id="pnNextT"></b>' + ico("chev") + "</button>" +
      '<div class="pn-cards"><button type="button" class="pn-card" data-act="bookmarks">' + ico("bm") + "<span><b>Bookmarks</b><small>" + fmt(nb) + " saved</small></span></button>" +
      '<button type="button" class="pn-card" data-act="custom">' + ico("plus") + "<span><b>Custom module</b><small>Your own mix and count</small></span></button>" +
      (G.PREP_C ? '<button type="button" class="pn-card pn-card-wide" data-act="c-home">' + ico("dl") + "<span><b>Your decks</b><small>Questions and cards from your PDF or notes</small></span></button>" : "") + "</div>" +
      '<div class="pn-grid" id="pnGrid">' + subs.map(function (sb) { return tile(sb, null); }).join("") + "</div>" +
      '<p class="pn-note">Questions: MedMCQA (MIT licence), cleaned and sorted into modules; AI-generated questions are labelled. Progress stays on this device.</p></div>');
    Promise.all(subs.map(function (sb) { return loadIndex(sb.id); })).then(function () {
      if (!st.open || st.stack[st.stack.length - 1] !== renderHome) return;
      var grid = root.querySelector("#pnGrid");
      if (grid) grid.innerHTML = subs.map(function (sb) { return tile(sb, st.ix[sb.id]); }).join("");
      var nx = solveNext(subs, st.ix, s, today(), s.exam), el = root.querySelector("#pnNext");
      if (nx && el) { el.hidden = false; el.setAttribute("data-s", nx.subject); el.setAttribute("data-m", nx.module); root.querySelector("#pnNextT").textContent = (nx.title && nx.title.en) + (nx.why === "due" ? " · " + nx.n + " due" : ""); }
    });
  }
  function tile(sb, ix) {
    var s = load(), prog = progressByModule(s, today()), mods = ix ? ix.topics.filter(function (t) { return t.group !== "mixed"; }) : [], done = 0, total = mods.length, q = 0;
    mods.forEach(function (t) { var n = countFor(t, s.exam); q += n; if (n && statusOf((prog[t.id] || {}).answered, n) === "done") done++; });
    var pct = total ? Math.round(done * 100 / total) : 0;
    return '<button type="button" class="pn-tile" data-act="subject" data-s="' + esc(sb.id) + '"><span class="pn-ic" aria-hidden="true">' + esc((sb.code || sb.id).slice(0, 3).toUpperCase()) + "</span>" +
      '<span class="pn-tb"><b>' + tx(sb.name) + '</b><span class="pn-prog" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' +
      "<small>" + (ix ? done + "/" + total + " modules · " + (q ? fmt(q) + " MCQs" : "questions coming soon") : "&nbsp;") + "</small></span></button>";
  }

  /* ---------- subject ---------- */
  function renderSubject(sid) {
    var sb = subjectById(sid), s = load();
    st.sub = sid;
    var FILTERS = [["all", "All"], ["paused", "In progress"], ["done", "Completed"], ["new", "Unattempted"]];
    paint(bar(tx(sb.name), "", "back", '<button type="button" class="pn-ib" data-act="search" data-s="' + esc(sid) + '" aria-label="Search ' + tx(sb.name) + ' questions">' + ico("search") + "</button>") + '<div class="pn-filters" role="group" aria-label="Show">' + FILTERS.map(function (f) {
      return '<button type="button" class="pn-chip' + (st.filter === f[0] ? " on" : "") + '" aria-pressed="' + (st.filter === f[0]) + '" data-act="filter" data-v="' + f[0] + '">' + f[1] + "</button>";
    }).join("") + '</div><div class="pn-body" id="pnSub"><p class="pn-load" role="status">Loading modules</p></div>');
    loadIndex(sid).then(function (ix) {
      if (!st.open || st.sub !== sid) return;
      var prog = progressByModule(s, today()), n = 0, html = "";
      sb.sections.forEach(function (sec) {
        var rows = filterModules(ix.topics.filter(function (t) { return t.group === sec.id; }), prog, st.filter, s.exam);
        var all = ix.topics.filter(function (t) { return t.group === sec.id; });
        var first = n; n += all.length;
        if (!rows.length) return;
        html += '<h2 class="pn-sec">' + tx(sec.name) + '</h2><ol class="pn-mods" start="' + (first + 1) + '">' + rows.map(function (t) { return modRow(sid, t, prog, s, all.indexOf(t) + first + 1); }).join("") + "</ol>";
      });
      var mixed = ix.topics.filter(function (t) { return t.group === "mixed"; })[0];
      if (mixed && mixed.count && st.filter === "all") html += '<h2 class="pn-sec">More</h2><ol class="pn-mods">' + modRow(sid, mixed, prog, s, null) + "</ol>";
      var box = root.querySelector("#pnSub");
      if (box) box.innerHTML = html || '<p class="pn-empty">Nothing in this filter yet.</p>';
    });
  }
  function modRow(sid, t, prog, s, num) {
    var n = countFor(t, s.exam), p = prog[t.id] || { answered: 0, due: 0 }, stt = statusOf(p.answered, n), sr = stars(s.mod[t.id]);
    var chip = stt === "done" ? '<span class="pn-st done">Completed</span>' : stt === "paused" ? '<span class="pn-st">' + fmt(Math.min(p.answered, n)) + "/" + fmt(n) + "</span>" : "";
    var line = n ? fmt(n) + " MCQs" : "Questions coming soon";
    return '<li><button type="button" class="pn-mod" data-act="module" data-s="' + esc(sid) + '" data-m="' + esc(t.id) + '"' + (n ? "" : ' aria-disabled="true"') + ">" +
      (num ? '<span class="pn-num" aria-hidden="true">' + num + "</span>" : "") +
      '<span class="pn-mb"><b>' + tx(t.title) + '</b><small>' + (sr != null ? '<span class="pn-stars" aria-label="Mastery ' + sr + ' of 5">' + ico("star", true) + sr + "/5</span> · " : "") + line + (p.due ? " · " + fmt(p.due) + " due" : "") + "</small></span>" + chip + "</button></li>";
  }

  /* ---------- module ---------- */
  function renderModule(sid, mid) {
    var t = topicOf(sid, mid), s = load(), ex = examOf(s.exam);
    if (!t) return;
    var n = countFor(t, s.exam), p = progressByModule(s, today())[mid] || { answered: 0, due: 0 }, sr = stars(s.mod[mid]);
    paint(bar(tx(t.title), tx(subjectById(sid).name), "back") + '<div class="pn-body"><section class="pn-panel">' +
      '<p class="pn-big">' + fmt(n) + ' MCQs</p><p class="pn-mut">' + fmt(Math.min(p.answered, n)) + " answered" + (sr != null ? " · mastery " + sr + "/5" : "") + (p.due ? " · " + fmt(p.due) + " due for review" : "") + "</p>" +
      (p.due ? '<button type="button" class="pn-btn pri" data-act="start" data-k="due">' + ico("play") + " Review " + fmt(p.due) + " due</button>" : "") +
      '<button type="button" class="pn-btn' + (p.due ? "" : " pri") + '" data-act="start" data-k="study">' + ico("play") + " Practice " + Math.min(SESSION, n) + " questions</button>" +
      '<button type="button" class="pn-btn" data-act="start" data-k="exam">' + ico("clock") + " Timed test: " + Math.min(SESSION, n) + " questions, " + Math.round(Math.min(SESSION, n) * ex.sec / 60) + " min</button>" +
      '<p class="pn-mut pn-small">Practice marks each answer at once with its explanation. A timed test marks everything at the end. Every answer schedules the question for spaced review.</p></section></div>');
    st.cur = { s: sid, m: mid };
  }
  function startModule(sid, mid, kind) {
    var s = load();
    paint(bar("Loading", "", "back") + '<div class="pn-body"><p class="pn-load" role="status">Loading questions</p></div>');
    loadModule(sid, mid).then(function (items) {
      var pool = poolFor(items, s.exam, hidden()), dk = deckKey(mid), td = today(), list;
      if (kind === "due") list = pool.filter(function (it) { var c = s.cards[C.key(dk, it.id)]; return c && c[3] <= td; }).slice(0, SESSION);
      // A timed test is a fresh random draw; practice follows FSRS (due, then new) and, once every question is seen
      // and none is due, becomes extra practice from the whole module.
      else if (kind === "exam") list = shuffle(pool.slice()).slice(0, SESSION);
      else { list = C.buildSession({ id: dk, items: pool }, s, td, { size: SESSION, newCap: SESSION }); if (!list.length) list = shuffle(pool.slice()).slice(0, SESSION); }
      if (!list.length) { toast("Nothing to practise here right now."); return rerender(); }
      runQuestions(list, kind === "exam" ? "exam" : "study", tx(topicOf(sid, mid).title));
    }, function () {
      paint(bar("Questions", "", "back") + '<div class="pn-body"><p class="pn-err" role="alert">The questions did not load. Check the connection and try again. A module opened once, or a downloaded subject, works offline.</p><button type="button" class="pn-btn" data-act="start" data-k="' + kind + '">Try again</button></div>');
      st.cur = { s: sid, m: mid };
    });
  }

  /* ---------- runner ---------- */
  function runQuestions(items, mode, title) {
    var ex = examOf(load().exam);
    st.run = { items: items, i: 0, mode: mode, title: title, ans: items.map(function () { return -1; }), mark: {}, done: false, t0: Date.now(), limit: mode === "exam" ? items.length * ex.sec : 0 };
    st.stack.push(renderRun);
    renderRun();
    if (mode === "exam") startTimer();
  }
  function startTimer() {
    stopTimer();
    st.timer = G.setInterval(function () {
      var r = st.run; if (!r || r.done) return stopTimer();
      var left = r.limit - (Date.now() - r.t0) / 1000, el = root && root.querySelector("#pnClock");
      if (el) el.textContent = fmtTime(left);
      if (left <= 0) finish();
    }, 1000);
  }
  function stopTimer() { if (st.timer) { G.clearInterval(st.timer); st.timer = 0; } }
  function provLine(it) { return it.gen || it.prov === "SMD" ? "AI-generated, auto-checked" : it.prov === "USR" ? "Your deck" : "Source: MedMCQA (MIT licence)"; }
  function renderRun() {
    var r = st.run; if (!r) return;
    if (r.done) return renderResult();
    var it = r.items[r.i], chosen = r.ans[r.i], shown = r.mode === "study" && chosen >= 0, s = load(), bm = !!s.bm[it.id], own = it._s === "deck";
    var L = ["A", "B", "C", "D"];
    var opts = it.o.map(function (o, k) {
      var cls = "pn-opt";
      if (shown) { if (k === it.a) cls += " right"; else if (k === chosen) cls += " wrong"; }
      else if (k === chosen) cls += " sel";
      return '<li><button type="button" class="' + cls + '" data-act="answer" data-k="' + k + '"' + (shown ? ' aria-disabled="true"' : "") + ' aria-pressed="' + (k === chosen) + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span>" +
        (shown && k === it.a ? '<span class="pn-mark">' + ico("check") + "</span>" : shown && k === chosen ? '<span class="pn-mark">' + ico("x") + "</span>" : "") + "</button></li>";
    }).join("");
    // Your own deck's questions stay on this phone: no bookmark (bookmarks reload from the bank) and no report.
    var right = r.mode === "exam" ? '<span class="pn-clock" id="pnClock" role="timer" aria-live="off">' + fmtTime(r.limit - (Date.now() - r.t0) / 1000) + "</span>" : own ? "" :
      '<button type="button" class="pn-ib' + (bm ? " on" : "") + '" data-act="bookmark" aria-pressed="' + bm + '" aria-label="' + (bm ? "Remove bookmark" : "Bookmark this question") + '">' + ico("bm", bm) + "</button>";
    var fb = "";
    if (shown) {
      var ok = chosen === it.a;
      fb = '<section class="pn-fb ' + (ok ? "ok" : "no") + '" role="status" tabindex="-1"><p class="pn-verdict">' + (ok ? "Correct" : "Incorrect") + " · Answer " + L[it.a] + ". " + esc(it.o[it.a]) + "</p>" +
        (it.exp ? '<h3>Explanation</h3><p class="pn-exp">' + esc(it.exp) + "</p>" : '<p class="pn-mut">The source gives no explanation for this question.</p>') +
        (it.kp ? '<p class="pn-kp"><b>Exam pearl:</b> ' + esc(it.kp) + "</p>" : "") +
        (it.rv && it.rv.old ? '<p class="pn-old">This may be outdated: check current guidance.</p>' : "") +
        '<p class="pn-prov">' + provLine(it) + "</p></section>";
    }
    var nav = r.mode === "exam" ?
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="prev"' + (r.i ? "" : " disabled") + ">Previous</button>" +
      '<button type="button" class="pn-btn' + (r.mark[r.i] ? " on" : "") + '" data-act="markq" aria-pressed="' + !!r.mark[r.i] + '">' + ico("flag") + " Mark for review</button>" +
      (r.i < r.items.length - 1 ? '<button type="button" class="pn-btn pri" data-act="next">Next</button>' : '<button type="button" class="pn-btn pri" data-act="submit">Submit</button>') + "</div>" +
      '<button type="button" class="pn-link" data-act="qgrid">' + ico("grid") + " All questions · " + r.ans.filter(function (a) { return a >= 0; }).length + " of " + r.items.length + " answered</button>"
      : shown ? '<div class="pn-navrow">' + (own ? "" : '<button type="button" class="pn-btn" data-act="report">' + ico("flag") + " Report</button>") +
        '<button type="button" class="pn-btn pri" data-act="next">' + (r.i < r.items.length - 1 ? "Next question" : "Finish") + " " + ico("next") + "</button></div>" : "";
    paint(bar(esc(r.title), "Question " + (r.i + 1) + " of " + r.items.length, "back", right) +
      '<div class="pn-body pn-run"><p class="pn-q">' + esc(it.q) + '</p><ol class="pn-opts" type="A">' + opts + "</ol>" + fb + nav + "</div>", shown ? ".pn-fb" : ".pn-opt");
  }
  function record(it, chosen) {
    var s = load(), ok = chosen === it.a, td = today(), dk = deckKey(it._m || it.t);
    C.review(s, dk, it.id, C.gradeFor(ok), td);
    C.recordAnswer(s, dk, String(it.a), String(chosen));
    var ms = s.mod[it._m || it.t] || (s.mod[it._m || it.t] = { t: 0, ok: 0 });
    ms.t++; if (ok) ms.ok++; ms.last = td;
    s.last = { s: it._s, m: it._m || it.t };
    save();
  }
  function answer(k) {
    var r = st.run; if (!r || r.done) return;
    if (r.mode === "study") { if (r.ans[r.i] >= 0) return; r.ans[r.i] = k; record(r.items[r.i], k); }
    else r.ans[r.i] = k;
    renderRun();
  }
  function finish() {
    var r = st.run; if (!r || r.done) return;
    stopTimer();
    // Submitted from the question grid (or timed out there): drop the grid so the results sit on the runner's entry.
    while (st.stack.length && st.stack[st.stack.length - 1] !== renderRun) st.stack.pop();
    if (r.mode === "exam") r.items.forEach(function (it, i) { if (r.ans[i] >= 0) record(it, r.ans[i]); else record(it, -1); });
    r.done = true; r.secs = Math.round((Date.now() - r.t0) / 1000);
    renderResult();
  }
  function renderResult() {
    var r = st.run, ok = 0, missed = [];
    r.items.forEach(function (it, i) { if (r.ans[i] === it.a) ok++; else missed.push(i); });
    var pct = r.items.length ? Math.round(ok * 100 / r.items.length) : 0;
    paint(bar(r.mode === "exam" ? "Test marked" : "Set finished", esc(r.title), "back") + '<div class="pn-body"><section class="pn-panel pn-score">' +
      '<p class="pn-big">' + ok + " / " + r.items.length + '</p><p class="pn-mut">' + pct + "% right" + (r.mode === "exam" ? " · " + fmtTime(r.secs) + " taken" : "") + "</p></section>" +
      (missed.length ? '<h2 class="pn-sec">Review the missed</h2><ol class="pn-missed">' + missed.map(function (i) {
        var it = r.items[i];
        return '<li><button type="button" class="pn-mod" data-act="reviewq" data-i="' + i + '"><span class="pn-mb"><b>' + esc(it.q.length > 120 ? it.q.slice(0, 117) + "..." : it.q) + "</b><small>Answer: " + esc(it.o[it.a]) + (r.ans[i] >= 0 ? " · you chose " + esc(it.o[r.ans[i]]) : " · not answered") + "</small></span></button></li>";
      }).join("") + "</ol>" : "") +
      '<div class="pn-navrow">' + (missed.length ? '<button type="button" class="pn-btn" data-act="retrymissed">Retry the missed</button>' : "") + '<button type="button" class="pn-btn pri" data-act="donerun">Done</button></div>' +
      '<p class="pn-mut pn-small">Missed questions come back sooner for review; ones you got right come back just before you would forget them.</p></div>');
  }
  function reviewQuestion(i) {
    var r = st.run, it = r.items[i];
    st.stack.push(function () {
      var L = ["A", "B", "C", "D"];
      paint(bar("Review", esc(r.title), "back") + '<div class="pn-body pn-run"><p class="pn-q">' + esc(it.q) + '</p><ol class="pn-opts">' + it.o.map(function (o, k) {
        return '<li><div class="pn-opt' + (k === it.a ? " right" : k === r.ans[i] ? " wrong" : "") + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span></div></li>";
      }).join("") + '</ol><section class="pn-fb"><h3>Explanation</h3><p class="pn-exp">' + esc(it.exp || "The source gives no explanation for this question.") + '</p><p class="pn-prov">' + provLine(it) + "</p></section></div>");
    });
    rerender();
  }

  /* ---------- search ---------- */
  var srch = { sid: null, q: "", timer: 0 };
  function renderSearch() {
    var sb = subjectById(srch.sid);
    paint(bar("Search", tx(sb.name), "back") + '<div class="pn-body"><label class="pn-sl" for="pnSearch"><span class="pn-mut pn-small">Words from the question or its options</span>' +
      '<input id="pnSearch" class="pn-in" type="search" autocomplete="off" enterkeyhint="search" value="' + esc(srch.q) + '"></label><div id="pnHits" aria-live="polite"></div></div>', "#pnSearch");
    if (srch.q) runSearch();
  }
  function runSearch() {
    var box = root && root.querySelector("#pnHits"), q = srch.q, sid = srch.sid, BANK = G.SPECIALTY && G.SPECIALTY.BANK;
    if (!box) return;
    if (q.trim().length < 3) { box.innerHTML = '<p class="pn-mut pn-small">Type at least 3 letters.</p>'; return; }
    if (!BANK) { box.innerHTML = '<p class="pn-err">Search did not load. Close and open PrepNucleus again.</p>'; return; }
    box.innerHTML = '<p class="pn-load" role="status">Searching</p>';
    loadSearch(sid).then(function (sx) {
      if (srch.q !== q || !root) return;
      var hid = hidden(), hits = BANK.searchIndex(sx, q, 60).filter(function (h) { return !hid[h.id]; }).slice(0, 40);
      var el = root.querySelector("#pnHits"); if (!el) return;
      el.innerHTML = hits.length ? '<p class="pn-mut pn-small">' + hits.length + (hits.length === 40 ? "+" : "") + " found</p><ul class=\"pn-mods\">" + hits.map(function (h) {
        var t = topicOf(sid, h.t);
        return '<li><button type="button" class="pn-mod" data-act="hit" data-m="' + esc(h.t) + '" data-i="' + esc(h.id) + '"><span class="pn-mb"><b>' + esc(h.p) + "</b><small>" + (t ? tx(t.title) : "") + "</small></span></button></li>";
      }).join("") + "</ul>" : '<p class="pn-empty">No question matches. Try fewer or other words.</p>';
    }, function () {
      var el = root && root.querySelector("#pnHits");
      if (el) el.innerHTML = '<p class="pn-err" role="alert">Search needs a connection the first time for each subject.</p>';
    });
  }
  function openHit(mid, id) {
    var sid = srch.sid;
    loadModule(sid, mid).then(function (items) {
      var it = items.filter(function (x) { return x.id === id; })[0];
      if (!it || !usable(it, hidden())) return toast("This question is not available.");
      var t = topicOf(sid, mid);
      runQuestions([it], "study", t ? tx(t.title) : "Search");
    }, function () { toast("The question did not load. Check the connection and try again."); });
  }

  /* ---------- bookmarks, report ---------- */
  function toggleBookmark() {
    var r = st.run, it = r && r.items[r.i], s = load(); if (!it || it._s === "deck") return;
    if (s.bm[it.id]) delete s.bm[it.id]; else s.bm[it.id] = [it._s, it._m || it.t, Date.now()];
    save(); renderRun();
  }
  function renderBookmarks() {
    var s = load(), ids = Object.keys(s.bm), by = {};
    ids.forEach(function (id) { var b = s.bm[id]; (by[b[0] + "|" + b[1]] = by[b[0] + "|" + b[1]] || []).push(id); });
    paint(bar("Bookmarks", fmt(ids.length) + " saved", "back") + '<div class="pn-body">' + (ids.length ?
      '<button type="button" class="pn-btn pri" data-act="practicebm">' + ico("play") + " Practise all bookmarks</button>" +
      '<ul class="pn-mods">' + Object.keys(by).map(function (k) { var p = k.split("|"), t = topicOf(p[0], p[1]), sb = subjectById(p[0]); return '<li><div class="pn-mod static"><span class="pn-mb"><b>' + (t ? tx(t.title) : esc(p[1])) + "</b><small>" + (sb ? tx(sb.name) : "") + " · " + by[k].length + " saved</small></span></div></li>"; }).join("") + "</ul>"
      : '<p class="pn-empty">Bookmark a question with the ribbon at the top while practising, and it collects here.</p>') + "</div>");
    Object.keys(by).forEach(function (k) { var p = k.split("|"); loadIndex(p[0]); });
  }
  function practiceBookmarks() {
    var s = load(), by = {}, ids = Object.keys(s.bm);
    ids.forEach(function (id) { var b = s.bm[id]; (by[b[0] + "|" + b[1]] = by[b[0] + "|" + b[1]] || {})[id] = 1; });
    Promise.all(Object.keys(by).map(function (k) { var p = k.split("|"); return loadModule(p[0], p[1]).then(function (items) { var hid = hidden(); return items.filter(function (it) { return by[k][it.id] && usable(it, hid); }); }, function () { return []; }); }))
      .then(function (lists) { var all = []; lists.forEach(function (l) { all = all.concat(l); }); if (!all.length) return toast("The bookmarked questions need a connection to load once."); runQuestions(shuffle(all).slice(0, 50), "study", "Bookmarks"); });
  }
  var REASONS = [["wrong-key", "The answer key is wrong"], ["unclear", "The question is unclear"], ["outdated", "Outdated information"], ["typo", "Typing or formatting error"], ["other", "Something else"]];
  function openReport() {
    var r = st.run, it = r && r.items[r.i]; if (!it) return;
    st.stack.push(function () {
      paint(bar("Report this question", "", "back") + '<div class="pn-body"><p class="pn-mut">What is wrong with it? Reports go to the StewardMD team with the question number only.</p><ul class="pn-mods">' +
        REASONS.map(function (x) { return '<li><button type="button" class="pn-mod" data-act="sendreport" data-v="' + x[0] + '"><span class="pn-mb"><b>' + x[1] + "</b></span></button></li>"; }).join("") + "</ul></div>");
    });
    rerender();
  }
  function sendReport(reason) {
    var r = st.run, it = r && r.items[r.i], s = load(); if (!it) return;
    s.rep[it.id] = reason; save();
    var u = G.SMD_AUTH && G.SMD_AUTH.currentUser;
    (u && u.getIdToken ? u.getIdToken() : Promise.resolve(null)).then(function (tok) {
      if (!tok) return;
      return G.fetch("/api/prep/flag", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ itemId: it.id, subject: it._s, module: it._m || it.t, reason: reason }) });
    }).then(null, function () {});
    toast("Thank you. The question has been reported.");
    st.stack.pop(); rerender();
  }

  /* ---------- custom module ---------- */
  var cm = { subs: {}, d: 0, n: 25, mode: "study" };
  function renderCustom() {
    var s = load(), subs = subjectsOf(s.exam);
    var chip = function (act, v, on, label) { return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="' + act + '" data-v="' + v + '">' + label + "</button>"; };
    paint(bar("Custom module", examOf(s.exam).label, "back") + '<div class="pn-body"><h2 class="pn-sec">Subjects</h2><div class="pn-wrap">' +
      subs.map(function (sb) { return chip("cmsub", sb.id, !!cm.subs[sb.id], tx(sb.name)); }).join("") + "</div>" +
      '<h2 class="pn-sec">Difficulty</h2><div class="pn-wrap">' + [[0, "Any"], [1, "Easy"], [2, "Medium"], [3, "Hard"]].map(function (x) { return chip("cmd", x[0], cm.d === x[0], x[1]); }).join("") + "</div>" +
      '<h2 class="pn-sec">Questions</h2><div class="pn-wrap">' + [10, 25, 50, 100].map(function (x) { return chip("cmn", x, cm.n === x, String(x)); }).join("") + "</div>" +
      '<h2 class="pn-sec">Mode</h2><div class="pn-wrap">' + chip("cmm", "study", cm.mode === "study", "Practice") + chip("cmm", "exam", cm.mode === "exam", "Timed test") + "</div>" +
      '<button type="button" class="pn-btn pri" data-act="cmstart"' + (Object.keys(cm.subs).length ? "" : " disabled") + ">" + ico("play") + " Start</button></div>");
  }
  function startCustom() {
    var s = load(), sids = Object.keys(cm.subs);
    paint(bar("Custom module", "", "back") + '<div class="pn-body"><p class="pn-load" role="status">Gathering questions</p></div>');
    Promise.all(sids.map(loadIndex)).then(function () {
      // Modules weighted by size; at most 10 module files so the draw stays light on a phone.
      var mods = [];
      sids.forEach(function (sid) { st.ix[sid].topics.forEach(function (t) { if (countFor(t, s.exam)) mods.push({ s: sid, m: t.id, n: countFor(t, s.exam) }); }); });
      shuffle(mods);
      mods = mods.slice(0, 10);
      return Promise.all(mods.map(function (x) { return loadModule(x.s, x.m).then(function (items) { return poolFor(items, s.exam, hidden()); }, function () { return []; }); }));
    }).then(function (lists) {
      var list = customDraw(lists, cm.n, cm.d || 0);
      if (!list.length) { toast("No questions match. Try another difficulty or subject."); st.stack.pop(); return rerender(); }
      st.stack.pop();
      runQuestions(list, cm.mode, "Custom module");
    });
  }

  /* ---------- offline downloads ---------- */
  function renderDownloads() {
    var s = load(), subs = subjectsOf(s.exam);
    paint(bar("Offline downloads", "", "back") + '<div class="pn-body"><p class="pn-mut">A downloaded subject opens every module without a connection. Opened modules are kept anyway.</p><ul class="pn-mods" id="pnDl">' +
      subs.map(function (sb) {
        var on = !!s.dl[sb.id];
        return '<li><div class="pn-mod static"><span class="pn-mb"><b>' + tx(sb.name) + '</b><small id="pnDl-' + esc(sb.id) + '">' + (on ? "Downloaded" : "Not downloaded") + "</small></span>" +
          '<button type="button" class="pn-btn sm" data-act="' + (on ? "dlrm" : "dlget") + '" data-s="' + esc(sb.id) + '">' + (on ? "Remove" : "Download") + "</button></div></li>";
      }).join("") + "</ul></div>");
  }
  function download(sid) {
    var s = load(), el = function () { return root && root.querySelector("#pnDl-" + sid); };
    loadIndex(sid).then(function (ix) {
      var ts = ix.topics.filter(function (t) { return t.all || t.count; }), done = 0;
      if (!ts.length) { var e0 = el(); if (e0) e0.textContent = "No questions yet"; return; }
      var step = function (i) {
        if (i >= ts.length) { s.dl[sid] = Date.now(); save(); return renderDownloads(); }
        return loadModule(sid, ts[i].id).then(function () { done++; var e = el(); if (e) e.textContent = "Downloading " + done + " of " + ts.length; return step(i + 1); }, function () { var e = el(); if (e) e.textContent = "Stopped: no connection"; });
      };
      return step(0);
    });
  }
  function removeDownload(sid) {
    var s = load();
    cacheKeys().then(function (keys) {
      (keys || []).forEach(function (k) { if (String(k).indexOf(VER + "/" + sid + "/") === 0) { cacheDel(k); delete st.mem[k]; } });
      delete s.dl[sid]; save(); renderDownloads();
    });
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b || !root.contains(b) || b.getAttribute("aria-disabled") === "true" || b.disabled) return;
    var a = b.getAttribute("data-act"), v = b.getAttribute("data-v"), s = load();
    if (a === "close") return close();
    if (a === "back") return back();
    if (a === "retry") { close(); return open(); }
    if (a === "exam") { s.exam = v; save(); return rerender(); }
    if (a === "subject") { st.filter = "all"; var sid = b.getAttribute("data-s"); return push(function () { renderSubject(sid); }); }
    if (a === "filter") { st.filter = v; return rerender(); }
    if (a === "search") { srch.sid = b.getAttribute("data-s"); srch.q = ""; return loadIndex(srch.sid).then(function () { push(renderSearch); }); }
    if (a === "hit") return openHit(b.getAttribute("data-m"), b.getAttribute("data-i"));
    if (a === "module" || a === "solvenext") { var s1 = b.getAttribute("data-s"), m1 = b.getAttribute("data-m"); return loadIndex(s1).then(function () { push(function () { renderModule(s1, m1); }); }); }
    if (a === "start") { var c = st.cur; return startModule(c.s, c.m, b.getAttribute("data-k")); }
    if (a === "answer") return answer(Number(b.getAttribute("data-k")));
    if (a === "next") { var r = st.run; if (!r) return; if (r.i < r.items.length - 1) { r.i++; return renderRun(); } return finish(); }
    if (a === "prev") { if (st.run && st.run.i) { st.run.i--; renderRun(); } return; }
    if (a === "markq") { var rr = st.run; rr.mark[rr.i] = !rr.mark[rr.i]; return renderRun(); }
    if (a === "qgrid") return openGrid();
    if (a === "goq") { st.run.i = Number(b.getAttribute("data-i")); st.stack.pop(); return renderRun(); }
    if (a === "submit") { var un = st.run.ans.filter(function (x) { return x < 0; }).length; if (un && G.confirm && !G.confirm(un + " questions are unanswered. Submit anyway?")) return; return finish(); }
    if (a === "bookmark") return toggleBookmark();
    if (a === "report") return openReport();
    if (a === "sendreport") return sendReport(v);
    if (a === "reviewq") return reviewQuestion(Number(b.getAttribute("data-i")));
    if (a === "retrymissed") { var r2 = st.run, miss = r2.items.filter(function (it, i) { return r2.ans[i] !== it.a; }); st.stack.pop(); return runQuestions(miss, "study", r2.title); }
    if (a === "donerun") { st.run = null; st.stack.pop(); return rerender(); }
    if (a === "bookmarks") return push(renderBookmarks);
    if (a === "practicebm") return practiceBookmarks();
    if (a === "custom") return push(renderCustom);
    if (a === "cmsub") { if (cm.subs[v]) delete cm.subs[v]; else cm.subs[v] = 1; return rerender(); }
    if (a === "cmd") { cm.d = Number(v); return rerender(); }
    if (a === "cmn") { cm.n = Number(v); return rerender(); }
    if (a === "cmm") { cm.mode = v; return rerender(); }
    if (a === "cmstart") { st.stack.push(function () {}); return startCustom(); }
    if (a === "downloads") return push(renderDownloads);
    if (a === "dlget") return download(b.getAttribute("data-s"));
    if (a === "dlrm") return removeDownload(b.getAttribute("data-s"));
    // Layer C (prep-create.js and friends) owns every data-act starting "c-".
    if (a.indexOf("c-") === 0 && G.PREP_C && G.PREP_C.act) return G.PREP_C.act(a, b, HOST);
  }
  function openGrid() {
    var r = st.run;
    st.stack.push(function () {
      paint(bar("All questions", esc(r.title), "back") + '<div class="pn-body"><div class="pn-qgrid">' + r.items.map(function (it, i) {
        var c = r.ans[i] >= 0 ? " ans" : ""; if (r.mark[i]) c += " mark";
        return '<button type="button" class="pn-qn' + c + '" data-act="goq" data-i="' + i + '" aria-label="Question ' + (i + 1) + (r.ans[i] >= 0 ? ", answered" : ", not answered") + (r.mark[i] ? ", marked for review" : "") + '">' + (i + 1) + "</button>";
      }).join("") + '</div><p class="pn-mut pn-small">Filled: answered. Ringed: marked for review.</p><button type="button" class="pn-btn pri" data-act="submit">Submit test</button></div>');
    });
    rerender();
  }

  /* The surface Layer C (window.PREP_C: prep-create.js, prep-cards.js) draws through, so its screens share this
     overlay, back stack, runner and store. Deck items carry _s "deck" and _m "deck-<id>": their FSRS cards live in
     the same store under deck key "p:deck-<id>". */
  var HOST = { push: push, rerender: rerender, back: back, paint: paint, bar: bar, ico: ico, esc: esc, toast: toast, fmt: fmt,
    run: runQuestions, today: today, store: load, save: save, core: function () { return C; }, root: function () { return root; },
    exam: function () { return examOf(load().exam); } };

  var API_OBJ = { open: open, close: close, back: back, isOpen: function () { return st.open; }, _pure: PURE, _st: st, _host: HOST };
  G.PREP = API_OBJ;
})(typeof window !== "undefined" ? window : this);
