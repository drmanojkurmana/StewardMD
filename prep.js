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
    { id: "usmle", label: "USMLE", branch: "mbbs", tag: "usmle", sec: 90 },
    // FMGE: the MBBS bank as is (all 19 subjects; all: true ignores the subjects' exam tags).
    { id: "fmge", label: "FMGE", branch: "mbbs", tag: "fmge", all: true, sec: 60 }
  ];
  function examOf(id) { for (var i = 0; i < EXAMS.length; i++) if (EXAMS[i].id === id) return EXAMS[i]; return EXAMS[0]; }
  // mt: mistakes { itemId: [subject, module, tag, ts, preview] }, removed when the item is next answered right.
  // goal: new questions a day for the daily plan. mh: finished mocks, newest last, at most 20 ({ ts, label, marks, max, n }).
  function emptyStore() { return { v: 1, cards: {}, conf: {}, days: {}, mod: {}, bm: {}, rep: {}, exam: "neet-pg", last: null, dl: {}, hid: { ids: {}, ts: 0 }, mt: {}, goal: 30, mh: [], ls: {}, lsp: { r: 1, au: 0 }, pl: null, pt: null, ra: [] }; }
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
      if (parts.length === 4 && parts[2] === "c") continue;   // a module flashcard (prep-flash.js), not a question
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
  /* ---- Phase 4: adapt ---- */
  // Target difficulty from the share right: 80% and over -> hard (3), 60% and over -> medium (2), else easy (1);
  // under 5 attempts -> medium.
  function targetDifficulty(ms) { if (!ms || (ms.t || 0) < 5) return 2; var acc = ms.ok / ms.t; return acc >= 0.8 ? 3 : acc >= 0.6 ? 2 : 1; }
  // n unseen items, closest to the target difficulty first (random within a level).
  function adaptiveNew(pool, cards, dk, target, n, rnd) {
    var fresh = shuffle(pool.filter(function (it) { return !cards[dk + ":" + it.id]; }), rnd);
    fresh.sort(function (a, b) { return Math.abs((a.d || 2) - target) - Math.abs((b.d || 2) - target); });
    return fresh.slice(0, n);
  }
  // Modules with at least 5 attempts and under 60% right, weakest first.
  function weakModules(store, max) {
    return Object.keys(store.mod).filter(function (m) { var x = store.mod[m]; return x.t >= 5 && x.ok / x.t < 0.6; })
      .sort(function (a, b) { var x = store.mod[a], y = store.mod[b]; return x.ok / x.t - y.ok / y.t || (a < b ? -1 : 1); }).slice(0, max || 3);
  }
  // Today's plan: due reviews by module (most first), weak modules, the new-question goal left today.
  function planToday(store, today) {
    var prog = progressByModule(store, today), due = [], total = 0;
    Object.keys(prog).forEach(function (m) { if (prog[m].due) { due.push({ m: m, n: prog[m].due }); total += prog[m].due; } });
    due.sort(function (a, b) { return b.n - a.n || (a.m < b.m ? -1 : 1); });
    var done = store.days[today] || 0, goal = store.goal || 30;
    return { due: total, dueModules: due, weak: weakModules(store, 3), done: done, goal: goal, left: Math.max(0, goal - done) };
  }
  var MISTAKE_TAGS = [["know", "Did not know"], ["misread", "Misread the question"], ["mixed", "Mixed up two options"], ["careless", "Careless slip"]];
  function mistakeCounts(mt) {
    var c = { all: 0 }; MISTAKE_TAGS.forEach(function (t) { c[t[0]] = 0; }); c.untagged = 0;
    Object.keys(mt).forEach(function (id) { c.all++; var t = mt[id][2]; if (t && c[t] != null) c[t]++; else c.untagged++; });
    return c;
  }

  /* ---- Phase 5: mock exams. Patterns as published for 2024 to 2026; confirm against the current bulletin. ---- */
  var MOCKS = {
    "neet-pg": [{ id: "neet-pg", label: "NEET-PG pattern", n: 200, min: 210, plus: 4, minus: 1 }, { id: "ini-cet", label: "INI-CET pattern", n: 200, min: 180, plus: 1, minus: 1 / 3 }],
    "neet-ss": [{ id: "neet-ss", label: "NEET-SS pattern", n: 150, min: 150, plus: 4, minus: 1 }],
    "usmle": [{ id: "usmle-block", label: "USMLE block", n: 40, min: 60, plus: 1, minus: 0 }],
    // FMGE: NBEMS FMGE October 2026 information bulletin, section 5: 300 questions in 2 parts of 150, 150 min each,
    // +1, no negative marking, pass at 150 of 300. A full mock here is one part.
    "fmge": [{ id: "fmge", label: "FMGE pattern", n: 300, min: 300, plus: 1, minus: 0, parts: 2, pass: 150 }]
  };
  function mockOf(exam, id) { var l = MOCKS[exam] || MOCKS["neet-pg"]; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return l[0]; }
  // Module picks for a mock: up to maxFiles modules, shared across subjects by their question counts (every subject
  // with questions gets at least one), the biggest modules of each subject first.
  function mockModules(subjectIndexes, exam, maxFiles, rnd) {
    var subs = [], total = 0;
    subjectIndexes.forEach(function (x) {
      var mods = x.ix.topics.filter(function (t) { return countFor(t, exam) > 0; }).map(function (t) { return { s: x.id, m: t.id, n: countFor(t, exam) }; });
      var n = mods.reduce(function (a, t) { return a + t.n; }, 0);
      if (n) { subs.push({ id: x.id, mods: shuffle(mods, rnd), n: n }); total += n; }
    });
    // one module per subject first (largest subjects first), then the rest in proportion to question counts
    var out = [], left = maxFiles;
    subs.sort(function (a, b) { return b.n - a.n; });
    subs.forEach(function (sb) { sb.k = left > 0 ? 1 : 0; left -= sb.k; });
    var spare = left;
    subs.forEach(function (sb) { var add = Math.min(sb.mods.length - sb.k, Math.floor(spare * sb.n / total), left); if (add > 0) { sb.k += add; left -= add; } });
    subs.forEach(function (sb) { out = out.concat(sb.mods.slice(0, sb.k)); });
    return out;
  }
  // Marks with the pattern's scheme; unanswered scores 0. bySubject: { s: { n, right, wrong } }.
  function scoreMock(items, ans, scheme) {
    var r = { right: 0, wrong: 0, blank: 0, marks: 0, max: items.length * scheme.plus, bySubject: {} };
    items.forEach(function (it, i) {
      var b = r.bySubject[it._s] || (r.bySubject[it._s] = { n: 0, right: 0, wrong: 0 });
      b.n++;
      if (ans[i] < 0) r.blank++; else if (ans[i] === it.a) { r.right++; b.right++; } else { r.wrong++; b.wrong++; }
    });
    r.marks = Math.round((r.right * scheme.plus - r.wrong * scheme.minus) * 100) / 100;
    return r;
  }
  // Best module for a typed topic ("brachial plexus", "lymphoma"): word overlap with module, section and subject
  // names; ties go to the earlier module. null when nothing matches.
  function findModule(subjects, query) {
    var q = String(query || "").toLowerCase().match(/[a-z0-9]+/g) || [], best = null, bestS = 0;
    if (!q.length) return null;
    subjects.forEach(function (sb) {
      sb.sections.forEach(function (sec) {
        sec.modules.forEach(function (m) {
          var mt = (m.name.en || "").toLowerCase(), ct = (sec.name.en + " " + sb.name.en).toLowerCase(), sc = 0;
          q.forEach(function (w) { if (w.length < 3) return; if (new RegExp("\\b" + w).test(mt)) sc += 3; else if (new RegExp("\\b" + w).test(ct)) sc += 1; });
          if (sc > bestS) { bestS = sc; best = { subject: sb.id, module: m.id }; }
        });
      });
    });
    return best;
  }
  function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  var PURE = { EXAMS: EXAMS, examOf: examOf, emptyStore: emptyStore, deckKey: deckKey, usable: usable, poolFor: poolFor, progressByModule: progressByModule,
    statusOf: statusOf, stars: stars, countFor: countFor, solveNext: solveNext, filterModules: filterModules, customDraw: customDraw, shuffle: shuffle, fmtTime: fmtTime,
    targetDifficulty: targetDifficulty, adaptiveNew: adaptiveNew, weakModules: weakModules, planToday: planToday, MISTAKE_TAGS: MISTAKE_TAGS, mistakeCounts: mistakeCounts,
    MOCKS: MOCKS, mockOf: mockOf, mockModules: mockModules, scoreMock: scoreMock, findModule: findModule };
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
    (st.tax ? st.tax.branches : []).forEach(function (b) { if (b.id === ex.branch) b.subjects.forEach(function (s) { if (ex.all || !s.ex || s.ex.indexOf(ex.tag) >= 0) out.push(s); }); });
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
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    deck: '<rect x="4" y="6" width="13" height="15" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v12"/>', target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>',
    stats: '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/>', bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>', cal: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    versus: '<path d="M4 4l8 8M4 4v4M4 4h4M20 4l-8 8M20 4v4M20 4h-4M7 17l-3 3M17 17l3 3M9 15l-2 2M15 15l2 2"/>', trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 21h6M10 17h4"/>',
    off: '<path d="M3 3l18 18M8.5 8.6A9 9 0 0 0 5 11M2 8a14 14 0 0 1 4-2.4M16 11.5a9 9 0 0 1 3 1.5M10.7 5.1A14 14 0 0 1 22 8M8.5 15a5 5 0 0 1 6.5-.5M12 19h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', leave: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'
  };
  /* Subject icons: one authored 24px set, 2px stroke, round caps, to match ICON. Keyed by subject id (taxonomy.json). */
  var SUBJ = {
    anatomy: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7.5v7M7 10l5-1.5 5 1.5M12 14.5l-3 6.5M12 14.5l3 6.5"/>',
    physiology: '<path d="M2 12h4.5l2.5-6 4 12 2.5-6H22"/>',
    biochemistry: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="3.5"/>',
    pathology: '<path d="M5 21h14M8 17h8M13.5 3.5l3 3-5 5-3-3zM11 12l-2 5M16.5 11a5 5 0 0 1-2.5 6"/>',
    pharmacology: '<path d="M10.5 20.5a5 5 0 0 1-7-7l7-7a5 5 0 0 1 7 7z"/><path d="M7 10l7 7"/>',
    microbiology: '<rect x="4" y="9" width="16" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="M10.5 13.5h.01M13.5 10.5h.01M17.5 6.5l2.5-2.5M6.5 17.5L4 20"/>',
    "forensic-medicine": '<path d="M12 4v16M8 20h8M5 7h14M5 7l-3 6h6zM19 7l-3 6h6z"/>',
    "community-medicine": '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5 5"/>',
    ophthalmology: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    ent: '<path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.5"/><path d="M10 9a2 2 0 0 1 4 0c0 1.5-2 2-2 3.5"/>',
    medicine: '<path d="M5 3v5a4 4 0 0 0 8 0V3"/><path d="M9 12v3a5 5 0 0 0 10 0v-2"/><circle cx="19" cy="11" r="2"/>',
    surgery: '<path d="M14 10l6.5-6.5c.6 1.6.2 4.6-2 6.8L15 13.8z"/><path d="M14 10L3 21"/>',
    "obstetrics-gynaecology": '<circle cx="4.5" cy="8" r="1.5"/><circle cx="19.5" cy="8" r="1.5"/><path d="M6 8h2c1.5 0 2 1 2 3v2.5a2 2 0 0 0 4 0V11c0-2 .5-3 2-3h2M12 15.5V21"/>',
    paediatrics: '<path d="M9 8h6v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM10 8V6a2 2 0 0 1 4 0v2M12 4V2.5M9 12h3M9 15h3"/>',
    orthopaedics: '<path d="M8.5 3v5.5a3.5 3.5 0 0 0 7 0V3M8.5 21v-4.5a3.5 3.5 0 0 1 7 0V21"/>',
    dermatology: '<path d="M3 10c3-2 6 2 9 0s6-2 9 0M3 15h18M3 20h18M9 10V4M14.5 9.5l1.5-5"/>',
    psychiatry: '<path d="M8 21v-3a7 7 0 1 1 9-6.7l1.6 3.2-2.1.5v2a2 2 0 0 1-2 2h-1v2"/><path d="M11 8.5a2 2 0 1 1 2 2"/>',
    anaesthesia: '<path d="M18 2l4 4M20 4l-3 3M17 7L7.5 16.5 4 18l1.5-3.5L15 5zM11 9l2 2M8.5 11.5l2 2M2 22l2.5-2.5"/>',
    radiology: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 6v12M8 9h8M7.5 12h9M9 15h6"/>',
    "ss-general-medicine": '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M12 9v6M9 12h6"/>',
    "ss-cardiology": '<path d="M12 20s-7-4.4-9-9a4.6 4.6 0 0 1 9-3 4.6 4.6 0 0 1 9 3c-2 4.6-9 9-9 9z"/><path d="M7 12h3l1-2 2 4 1-2h3"/>',
    "ss-neurology": '<path d="M12 5a3 3 0 0 0-6 1 3 3 0 0 0-2 5.5A3 3 0 0 0 6 17a3 3 0 0 0 6 2zM12 5a3 3 0 0 1 6 1 3 3 0 0 1 2 5.5 3 3 0 0 1-2 5.5 3 3 0 0 1-6 2"/>',
    "ss-nephrology": '<path d="M15 4c-4 0-9 3-9 9s3 8 6 8c2.5 0 3-2 3-4s-2-3-2-5 1.5-2 3-2a3 3 0 0 0 0-6z"/>',
    "ss-gastroenterology": '<path d="M10 3v4c0 1.5-1 2.5-2.5 3.5S5 13 5 15.5A5.5 5.5 0 0 0 10.5 21c3 0 4.5-2 6.5-3.5s3.5-2 3.5-4.5-2-3.5-4-3.5c-1.5 0-2.5 1-3.5 2.5"/>',
    "ss-hepatology": '<path d="M3 9c0-2 2-3 5-3h12c1 0 1.5 1 1 2-2 5-8 10-13 10-3 0-5-4-5-9z"/><path d="M12 6v6"/>',
    "ss-endocrinology": '<path d="M12 6v12M12 9c-1.5-3-7-3.5-7 2.5S9.5 19 12 15M12 9c1.5-3 7-3.5 7 2.5S14.5 19 12 15"/>',
    "ss-haematology": '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
    "ss-medical-oncology": '<path d="M9 21l5.6-9.5a4 4 0 1 0-5.2 0L15 21"/>',
    "ss-rheumatology-immunology": '<path d="M12 21v-8M12 13L6.5 6M12 13l5.5-7M6.5 6L4 8M6.5 6L8 3.5M17.5 6L20 8M17.5 6L16 3.5"/>',
    "ss-pulmonology": '<path d="M12 4v8l-3-2M12 12l3-2"/><path d="M8 7c-3 1-5 6-5 10 0 2 1.5 3 3 3 2 0 3-1 3-3V8a1 1 0 0 0-1-1zM16 7c3 1 5 6 5 10 0 2-1.5 3-3 3-2 0-3-1-3-3V8a1 1 0 0 1 1-1z"/>',
    "ss-infectious-diseases": '<circle cx="12" cy="12" r="5"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.9 2.9M15.5 15.5l2.9 2.9M5.6 18.4l2.9-2.9M15.5 8.5l2.9-2.9"/>',
    "ss-critical-care": '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M6 11h3l1.5-3 3 6 1.5-3h3"/>',
    "ss-biostatistics": '<path d="M4 20h16M7 16v-4M12 16V7M17 16v-7"/>'
  };
  function svg(body, filled, size) { return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true" fill="' + (filled ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="' + (size === 24 ? 1.75 : 2) + '" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>"; }
  function ico(n, filled) { return svg(ICON[n] || "", filled); }
  // A subject's icon at 24px; a subject without its own glyph gets the open-book fallback.
  function subjIco(id) { return svg(SUBJ[id] || '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7"/>', false, 24); }
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
    // Arena: a sheet closes first; a live battle asks before it is left.
    if (G.PREP_ARENA && G.PREP_ARENA.back && G.PREP_ARENA.back()) return true;
    if (G.PREP_FLASH && G.PREP_FLASH.back()) return true;
    // Lessons: a zoomed image closes first; leaving the reader stops the narration.
    if (G.PREP_LESSONS && G.PREP_LESSONS.back()) return true;
    // PYQ: an enlarged question image closes first.
    if (G.PREP_PYQ && G.PREP_PYQ.back()) return true;
    // Plan: a readiness or settings sheet closes first; onboarding steps back.
    if (G.PREP_PLAN && G.PREP_PLAN.back()) return true;
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
      else if (opts && opts.mode === "mistakes") { st.stack = [renderHome]; mf.tag = "all"; push(renderMistakes); }
      else if (opts && opts.mode === "plan") { st.stack = [renderHome]; renderHome(); startPlan(); }
      else if (opts && opts.query) openQuery(opts);
      // First plain open: onboarding (prep-plan.js), skippable. SMD_PREP_ONBOARD = false (UI tests) skips it.
      else if (G.PREP_PLAN && G.SMD_PREP_ONBOARD !== false && G.PREP_PLAN.needsOnboard(load())) push(function () { G.PREP_PLAN.onboard(HOST); });
      else push(renderHome);
    }, function () { paint(bar("PrepNucleus", "", "close") + '<div class="pn-body"><p class="pn-err" role="alert">PrepNucleus did not load. Check the connection and try again.</p><button type="button" class="pn-btn" data-act="retry">Try again</button></div>'); });
    return true;
  }
  // Edge "start_mcq" (e.g. "10 questions on lymphoma"): the best-matching module of the current exam's subjects,
  // else of any subject; practice (or a timed test with mode "exam") of n questions, at most 50.
  function openQuery(opts) {
    var s = load(), hit = findModule(subjectsOf(s.exam), opts.query), all = [];
    if (!hit) { (st.tax ? st.tax.branches : []).forEach(function (b) { all = all.concat(b.subjects); }); hit = findModule(all, opts.query); }
    st.stack = [renderHome];
    if (!hit) { push(renderHome); return toast("No module matches \u201c" + String(opts.query).slice(0, 60) + "\u201d. Pick one from the list."); }
    loadIndex(hit.subject).then(function () {
      push(function () { renderSubject(hit.subject); });
      push(function () { renderModule(hit.subject, hit.module); });
      startModule(hit.subject, hit.module, opts.mode === "exam" ? "exam" : "study", Math.max(1, Math.min(50, Number(opts.n) || SESSION)));
    });
  }
  function close() {
    stopTimer();
    try { if (G.PREP_ARENA && G.PREP_ARENA.leave) G.PREP_ARENA.leave(); } catch (e) {}
    try { if (G.PREP_LESSONS) G.PREP_LESSONS.leave(); } catch (e) {}
    try { if (G.PREP_PYQ) G.PREP_PYQ.leave(); } catch (e) {}
    try { if (G.PREP_PLAN) G.PREP_PLAN.leave(); } catch (e) {}
    try { if (G.PREP_FLASH) G.PREP_FLASH.leave(); } catch (e) {}
    st.open = false; st.run = null; st.stack = [];
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    D.body.style.overflow = st.prevOverflow;
    try { if (st.prevFocus && st.prevFocus.isConnected) st.prevFocus.focus(); } catch (e) {}
  }

  /* ---------- home ---------- */
  function arenaOn() { return !!(G.PREP_ARENA && G.PREP_ARENA.enabled()); }
  // A row in a grouped list: icon, title, one line of detail, chevron.
  function row(act, icon, title, sub, attrs) {
    return '<button type="button" class="pn-row" data-act="' + act + '"' + (attrs || "") + '><span class="pn-ri" aria-hidden="true">' + icon + '</span><span class="pn-rb"><b>' + title + "</b><small>" + sub + "</small></span>" + ico("chev") + "</button>";
  }
  function renderHome() {
    var s = load(), ex = examOf(s.exam), subs = subjectsOf(s.exam), arena = arenaOn();
    var tabs = '<div class="pn-tabs" role="tablist" aria-label="Exam">' + EXAMS.map(function (e) {
      return '<button type="button" role="tab" class="pn-tab' + (e.id === ex.id ? " on" : "") + '" aria-selected="' + (e.id === ex.id) + '" data-act="exam" data-v="' + e.id + '">' + esc(e.label) + "</button>";
    }).join("") + "</div>";
    var nb = Object.keys(s.bm).length;
    paint(bar("PrepNucleus", ex.label, "close", '<button type="button" class="pn-ib" data-act="downloads" aria-label="Offline downloads">' + ico("dl") + "</button>") +
      tabs + '<div class="pn-body pn-home" id="pnHome">' +
      // Readiness and Today's plan (prep-plan.js); the older Today card without it.
      (G.PREP_PLAN ? G.PREP_PLAN.homeHtml(HOST) : '<h2 class="pn-h">Today</h2>' + planCard(s)) +
      (arena ? '<h2 class="pn-h">Compete</h2><div id="pnCompete">' + G.PREP_ARENA.homeHtml(HOST) + "</div>" : "") +
      '<h2 class="pn-h">Practise</h2>' +
      '<button type="button" class="pn-next" data-act="solvenext" id="pnNext" hidden><span class="pn-ri" aria-hidden="true">' + ico("target") + '</span><span class="pn-rb"><small>Solve next</small><b id="pnNextT"></b></span>' + ico("chev") + "</button>" +
      '<div class="pn-group">' +
      row("bookmarks", ico("bm"), "Bookmarks", fmt(nb) + " saved") +
      row("custom", ico("plus"), "Custom module", "Your own mix and count") +
      row("mistakes", ico("x"), "My mistakes", fmt(Object.keys(s.mt).length) + " to fix") +
      row("mocks", ico("clock"), "Mock exam", "Full pattern, marked") +
      (G.PREP_PLAN ? row("weak", ico("target"), "Weak areas", "Mistakes and modules under 60%") : "") +
      // Previous year papers (prep-pyq.js): NEET-PG recall papers only, so the row shows on that tab.
      (G.PREP_PYQ && s.exam === "neet-pg" ? G.PREP_PYQ.homeRow(HOST) : "") +
      // Cards due (prep-flash.js): shows once the student has studied any module card.
      (G.PREP_FLASH ? G.PREP_FLASH.homeRow(HOST) : "") +
      (G.PREP_C ? row("c-home", ico("deck"), "Your decks", "Questions and cards from your PDF or notes") : "") +
      (G.PREP_ARENA ? row("a-stats", ico("stats"), "My stats", "Accuracy by subject, the last 30 days") : "") + "</div>" +
      '<h2 class="pn-h">Subjects</h2><div class="pn-subs" id="pnGrid">' + subs.map(function (sb) { return tile(sb, null); }).join("") + "</div>" +
      '<p class="pn-note">Questions: MedMCQA (MIT licence), cleaned and sorted into modules; AI-generated questions are labelled. Practice and progress stay on this device.</p></div>');
    if (arena) G.PREP_ARENA.homeMounted(HOST);
    Promise.all(subs.map(function (sb) { return loadIndex(sb.id); })).then(function () {
      if (!st.open || st.stack[st.stack.length - 1] !== renderHome) return;
      var grid = root.querySelector("#pnGrid");
      if (grid) grid.innerHTML = subs.map(function (sb) { return tile(sb, st.ix[sb.id]); }).join("");
      var nx = solveNext(subs, st.ix, s, today(), s.exam), el = root.querySelector("#pnNext");
      if (G.PREP_PLAN) G.PREP_PLAN.homeMounted(HOST);
      if (nx && el) { el.hidden = false; el.setAttribute("data-s", nx.subject); el.setAttribute("data-m", nx.module); root.querySelector("#pnNextT").textContent = (nx.title && nx.title.en) + (nx.why === "due" ? " · " + nx.n + " due" : ""); }
    });
  }
  function tile(sb, ix) {
    var s = load(), prog = progressByModule(s, today()), mods = ix ? ix.topics.filter(function (t) { return t.group !== "mixed"; }) : [], done = 0, total = mods.length, q = 0;
    mods.forEach(function (t) { var n = countFor(t, s.exam); q += n; if (n && statusOf((prog[t.id] || {}).answered, n) === "done") done++; });
    var pct = total ? Math.round(done * 100 / total) : 0;
    return '<button type="button" class="pn-tile" data-act="subject" data-s="' + esc(sb.id) + '"><span class="pn-ic" aria-hidden="true">' + subjIco(sb.id) + "</span>" +
      '<span class="pn-tb"><b>' + tx(sb.name) + "</b><small>" + (ix ? done + "/" + total + " modules · " + (q ? fmt(q) + " MCQs" : "questions coming soon") : "&nbsp;") + "</small>" +
      '<span class="pn-prog" aria-hidden="true"><i style="width:' + pct + '%"></i></span></span>' + ico("chev") + "</button>";
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
      // Summary: modules completed and MCQs in this subject for the exam.
      var mods = ix.topics.filter(function (t) { return t.group !== "mixed"; }), done = 0, q = 0;
      mods.forEach(function (t) { var c = countFor(t, s.exam); q += c; if (c && statusOf((prog[t.id] || {}).answered, c) === "done") done++; });
      var head = '<section class="pn-subhead"><span class="pn-ic" aria-hidden="true">' + subjIco(sid) + '</span><span class="pn-tb"><b>' + done + " of " + mods.length + " modules completed</b><small>" + (q ? fmt(q) + " MCQs" : "Questions coming soon") + '</small><span class="pn-prog" aria-hidden="true"><i style="width:' + (mods.length ? Math.round(done * 100 / mods.length) : 0) + '%"></i></span></span></section>';
      var mixed = ix.topics.filter(function (t) { return t.group === "mixed"; })[0];
      if (mixed && mixed.count && st.filter === "all") html += '<h2 class="pn-sec">More</h2><ol class="pn-mods">' + modRow(sid, mixed, prog, s, null) + "</ol>";
      var box = root.querySelector("#pnSub");
      if (box) box.innerHTML = head + (html || '<p class="pn-empty">Nothing in this filter yet.</p>');
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
    // Lessons (prep-lessons.js): the slot fills when the lesson index lists this module.
    // PYQ (prep-pyq.js): the slot draws "All questions / PYQ n" chips when the module has previous-year questions.
    paint(bar(tx(t.title), tx(subjectById(sid).name), "back") + '<div class="pn-body"><div id="pnLsnSlot"></div><div id="pnCardSlot"></div><div id="pnPyqSlot"></div><section class="pn-panel" id="pnModPanel">' +
      '<p class="pn-big">' + fmt(n) + ' MCQs</p><p class="pn-mut">' + fmt(Math.min(p.answered, n)) + " answered" + (sr != null ? " · mastery " + sr + "/5" : "") + (p.due ? " · " + fmt(p.due) + " due for review" : "") + "</p>" +
      (p.due ? '<button type="button" class="pn-btn pri" data-act="start" data-k="due">' + ico("play") + " Review " + fmt(p.due) + " due</button>" : "") +
      '<button type="button" class="pn-btn' + (p.due ? "" : " pri") + '" data-act="start" data-k="study">' + ico("play") + " Practice " + Math.min(SESSION, n) + " questions</button>" +
      '<button type="button" class="pn-btn" data-act="start" data-k="exam">' + ico("clock") + " Timed test: " + Math.min(SESSION, n) + " questions, " + Math.round(Math.min(SESSION, n) * ex.sec / 60) + " min</button>" +
      '<p class="pn-mut pn-small">Practice marks each answer at once with its explanation. A timed test marks everything at the end. Every answer schedules the question for spaced review.</p></section></div>');
    st.cur = { s: sid, m: mid };
    if (G.PREP_LESSONS) G.PREP_LESSONS.mount(root.querySelector("#pnLsnSlot"), sid, mid, HOST);
    if (G.PREP_PYQ) G.PREP_PYQ.mount(root.querySelector("#pnPyqSlot"), sid, mid, HOST);
    if (G.PREP_FLASH) G.PREP_FLASH.mount(root.querySelector("#pnCardSlot"), sid, mid, HOST);
  }
  function startModule(sid, mid, kind, n) {
    var s = load(), size = n || SESSION;
    paint(bar("Loading", "", "back") + '<div class="pn-body"><p class="pn-load" role="status">Loading questions</p></div>');
    loadModule(sid, mid).then(function (items) {
      var pool = poolFor(items, s.exam, hidden()), dk = deckKey(mid), td = today(), list;
      if (kind === "due") list = pool.filter(function (it) { var c = s.cards[C.key(dk, it.id)]; return c && c[3] <= td; }).slice(0, size);
      // A timed test is a fresh random draw. Practice: FSRS due reviews first, then unseen questions nearest the
      // difficulty the student's share right calls for (adaptive); once every question is seen and none is due, a
      // random set from the whole module.
      else if (kind === "exam") list = shuffle(pool.slice()).slice(0, size);
      else {
        list = C.buildSession({ id: dk, items: pool }, s, td, { size: size, newCap: 0 });
        list = list.concat(adaptiveNew(pool, s.cards, dk, targetDifficulty(s.mod[mid]), size - list.length));
        if (!list.length) list = shuffle(pool.slice()).slice(0, size);
      }
      if (!list.length) { toast("Nothing to practise here right now."); return rerender(); }
      runQuestions(list, kind === "exam" ? "exam" : "study", tx(topicOf(sid, mid).title));
    }, function () {
      paint(bar("Questions", "", "back") + '<div class="pn-body"><p class="pn-err" role="alert">The questions did not load. Check the connection and try again. A module opened once, or a downloaded subject, works offline.</p><button type="button" class="pn-btn" data-act="start" data-k="' + kind + '">Try again</button></div>');
      st.cur = { s: sid, m: mid };
    });
  }

  /* ---------- runner ---------- */
  // opts (mock exams): { limit: seconds, scheme: {plus, minus, label} }. opts.custom (Arena events): { submit(run), render(run) }:
  // the runner neither marks nor records (the items carry no key); submit sends the answers and render draws the result.
  function runQuestions(items, mode, title, opts) {
    var ex = examOf(load().exam);
    opts = opts || {};
    st.run = { items: items, i: 0, mode: mode, title: title, ans: items.map(function () { return -1; }), mark: {}, done: false, t0: Date.now(), limit: mode === "exam" ? (opts.limit || items.length * ex.sec) : 0, scheme: opts.scheme || null, custom: opts.custom || null };
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
  function provLine(it) { if (it._py && G.PREP_PYQ) return G.PREP_PYQ.prov(it); return it.gen || it.prov === "SMD" ? "AI-generated, auto-checked" : it.prov === "USR" ? "Your deck" : "Source: MedMCQA (MIT licence)"; }
  function renderRun() {
    var r = st.run; if (!r) return;
    if (r.done) return r.custom ? r.custom.render(r) : renderResult();
    var it = r.items[r.i], chosen = r.ans[r.i], shown = r.mode === "study" && chosen >= 0, s = load(), bm = !!s.bm[it.id], own = it._s === "deck";
    // PYQ items (prep-pyq.js) are not in a bank module file, so a bookmark could not reload them: no ribbon.
    var pyq = G.PREP_PYQ ? { tags: G.PREP_PYQ.chips(it, HOST), fig: G.PREP_PYQ.figure(it, HOST) } : { tags: "", fig: "" };
    var L = ["A", "B", "C", "D"];
    var opts = it.o.map(function (o, k) {
      var cls = "pn-opt";
      if (shown) { if (k === it.a) cls += " right"; else if (k === chosen) cls += " wrong"; }
      else if (k === chosen) cls += " sel";
      return '<li><button type="button" class="' + cls + '" data-act="answer" data-k="' + k + '"' + (shown ? ' aria-disabled="true"' : "") + ' aria-pressed="' + (k === chosen) + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span>" +
        (shown && k === it.a ? '<span class="pn-mark">' + ico("check") + "</span>" : shown && k === chosen ? '<span class="pn-mark">' + ico("x") + "</span>" : "") + "</button></li>";
    }).join("");
    // Your own deck's questions stay on this phone: no bookmark (bookmarks reload from the bank) and no report.
    var right = r.mode === "exam" ? '<span class="pn-clock" id="pnClock" role="timer" aria-live="off">' + fmtTime(r.limit - (Date.now() - r.t0) / 1000) + "</span>" : own || it._py ? "" :
      '<button type="button" class="pn-ib' + (bm ? " on" : "") + '" data-act="bookmark" aria-pressed="' + bm + '" aria-label="' + (bm ? "Remove bookmark" : "Bookmark this question") + '">' + ico("bm", bm) + "</button>";
    var fb = "";
    if (shown) {
      var ok = chosen === it.a;
      fb = '<section class="pn-fb ' + (ok ? "ok" : "no") + '" role="status" tabindex="-1"><p class="pn-verdict">' + ico(ok ? "check" : "x") + "<span>" + (ok ? "Correct" : "Incorrect") + " · Answer " + L[it.a] + ". " + esc(it.o[it.a]) + "</span></p>" +
        (it.exp ? '<h3>Explanation</h3><p class="pn-exp">' + esc(it.exp) + "</p>" : '<p class="pn-mut">' + (it._py ? "Explanation coming soon." : "The source gives no explanation for this question.") + "</p>") +
        (it.kp ? '<p class="pn-kp"><b>Exam pearl:</b> ' + esc(it.kp) + "</p>" : "") +
        (it.rv && it.rv.old ? '<p class="pn-old">This may be outdated: check current guidance.</p>' : "") +
        // Offline teacher (prep-teacher.js, Phase 6): only when MaiK runs on this phone; never a server call.
        (!ok && G.PREP_TEACHER && G.PREP_TEACHER.ready && G.PREP_TEACHER.ready() ? '<button type="button" class="pn-btn" data-act="teach">Why is ' + L[chosen] + " wrong? Ask MaiK offline</button>" : "") +
        (!ok && !own ? '<div class="pn-mtag" role="group" aria-label="Why did you miss it?"><span class="pn-mut pn-small">Why did you miss it?</span><div class="pn-wrap">' + MISTAKE_TAGS.map(function (t) {
          var on = (s.mt[it.id] || [])[2] === t[0];
          return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="mtag" data-v="' + t[0] + '">' + t[1] + "</button>";
        }).join("") + "</div></div>" : "") +
        '<p class="pn-prov">' + provLine(it) + "</p></section>";
    }
    var nav = r.mode === "exam" ?
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="prev"' + (r.i ? "" : " disabled") + ">Previous</button>" +
      '<button type="button" class="pn-btn' + (r.mark[r.i] ? " on" : "") + '" data-act="markq" aria-label="Mark for review" aria-pressed="' + !!r.mark[r.i] + '">' + ico("flag", !!r.mark[r.i]) + " Mark</button>" +
      (r.i < r.items.length - 1 ? '<button type="button" class="pn-btn pri" data-act="next">Next</button>' : '<button type="button" class="pn-btn pri" data-act="submit">Submit</button>') + "</div>" +
      '<button type="button" class="pn-link" data-act="qgrid">' + ico("grid") + " All questions · " + r.ans.filter(function (a) { return a >= 0; }).length + " of " + r.items.length + " answered</button>"
      : shown ? '<div class="pn-navrow">' + (own ? "" : '<button type="button" class="pn-btn" data-act="report">' + ico("flag") + " Report</button>") +
        '<button type="button" class="pn-btn pri" data-act="next">' + (r.i < r.items.length - 1 ? "Next question" : "Finish") + " " + ico("next") + "</button></div>" : "";
    paint(bar(esc(r.title), "Question " + (r.i + 1) + " of " + r.items.length, "back", right) +
      '<div class="pn-body pn-run">' + pyq.tags + '<p class="pn-q">' + esc(it.q) + "</p>" + pyq.fig + '<ol class="pn-opts" type="A">' + opts + "</ol>" + fb + nav + "</div>", shown ? ".pn-fb" : ".pn-opt");
  }
  function record(it, chosen) {
    var s = load(), ok = chosen === it.a, td = today(), dk = deckKey(it._m || it.t);
    C.review(s, dk, it.id, C.gradeFor(ok), td);
    C.recordAnswer(s, dk, String(it.a), String(chosen));
    var ms = s.mod[it._m || it.t] || (s.mod[it._m || it.t] = { t: 0, ok: 0 });
    ms.t++; if (ok) ms.ok++; ms.last = td;
    s.last = { s: it._s, m: it._m || it.t };
    // Answer log for readiness accuracy (prep-plan.js): [module, 1|0], newest last.
    if (G.PREP_PLAN) G.PREP_PLAN.noteAnswer(s, it._m || it.t, ok);
    // Mistakes (bank questions only; a deck's questions live in Layer C storage): kept until answered right.
    // PYQ items live in their paper, not a module file, so My mistakes (which reloads modules) leaves them out.
    if (it._s !== "deck" && !it._py) { if (ok) delete s.mt[it.id]; else s.mt[it.id] = [it._s, it._m || it.t, (s.mt[it.id] || [])[2] || null, Date.now(), String(it.q || "").slice(0, 140)]; }
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
    r.done = true; r.secs = Math.round((Date.now() - r.t0) / 1000);
    if (r.custom) return r.custom.submit(r);
    if (r.mode === "exam") r.items.forEach(function (it, i) { if (r.ans[i] >= 0) record(it, r.ans[i]); else record(it, -1); });
    if (r.scheme) { var sc = scoreMock(r.items, r.ans, r.scheme), s = load(); s.mh = (s.mh || []).concat([{ ts: Date.now(), label: r.title, marks: sc.marks, max: sc.max, n: r.items.length }]).slice(-20); save(); }
    renderResult();
  }
  function renderResult() {
    var r = st.run, ok = 0, missed = [];
    r.items.forEach(function (it, i) { if (r.ans[i] === it.a) ok++; else missed.push(i); });
    var pct = r.items.length ? Math.round(ok * 100 / r.items.length) : 0;
    paint(bar(r.mode === "exam" ? "Test marked" : "Set finished", esc(r.title), "back") + '<div class="pn-body">' + (r.scheme ? mockAnalysis(r) : '<section class="pn-panel pn-score">' +
      '<p class="pn-big">' + ok + " / " + r.items.length + '</p><p class="pn-mut">' + pct + "% right" + (r.mode === "exam" ? " · " + fmtTime(r.secs) + " taken" : "") + "</p></section>") +
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
      paint(bar("Review", esc(r.title), "back") + '<div class="pn-body pn-run">' + (G.PREP_PYQ ? G.PREP_PYQ.chips(it, HOST) : "") + '<p class="pn-q">' + esc(it.q) + "</p>" + (G.PREP_PYQ ? G.PREP_PYQ.figure(it, HOST) : "") + '<ol class="pn-opts">' + it.o.map(function (o, k) {
        return '<li><div class="pn-opt' + (k === it.a ? " right" : k === r.ans[i] ? " wrong" : "") + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span></div></li>";
      }).join("") + '</ol><section class="pn-fb"><h3>Explanation</h3><p class="pn-exp">' + esc(it.exp || "The source gives no explanation for this question.") + '</p><p class="pn-prov">' + provLine(it) + "</p></section></div>");
    });
    rerender();
  }

  /* ---------- Phase 4: today's plan, mistakes, weak areas ---------- */
  function planCard(s) {
    var p = planToday(s, today()), pct = p.goal ? Math.min(100, Math.round(p.done * 100 / p.goal)) : 0;
    return '<section class="pn-plan" aria-label="Today\'s plan"><div class="pn-plan-h"><p class="pn-plan-n"><b>' + fmt(p.done) + "</b> of " + fmt(p.goal) + ' answered today</p><button type="button" class="pn-link pn-goal" data-act="goal" aria-label="Daily goal ' + p.goal + ' questions, change">Goal ' + p.goal + "</button></div>" +
      '<span class="pn-prog" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' + (p.due ? '<p class="pn-mut pn-small">' + fmt(p.due) + " reviews due</p>" : "") +
      '<div class="pn-plan-act"><button type="button" class="pn-btn pri" data-act="plan"' + (p.due || p.left ? "" : " disabled") + ">" + ico("play") + (p.due ? " Start today's reviews" : " Start today's set") + "</button>" +
      '<button type="button" class="pn-link" data-act="weak"' + (p.weak.length || Object.keys(s.mt).length ? "" : " disabled") + ">Fix my weak areas</button></div></section>";
  }
  // Items for (subject, module) pairs, each module file once; modules that fail to load are skipped.
  function loadMany(pairs, onStep) {
    var done = 0;
    return Promise.all(pairs.map(function (x) {
      return loadModule(x.s, x.m).then(function (items) { done++; if (onStep) onStep(done, pairs.length); return { s: x.s, m: x.m, items: items }; }, function () { done++; return { s: x.s, m: x.m, items: [] }; });
    }));
  }
  function subjectOfModule(mid) { var r = null; (st.tax ? st.tax.branches : []).forEach(function (b) { b.subjects.forEach(function (sb) { sb.sections.forEach(function (sec) { sec.modules.forEach(function (m) { if (m.id === mid) r = sb.id; }); }); }); }); return r || (/-mixed$/.test(mid) ? subjectByCode(mid.split("-")[0]) : null); }
  function subjectByCode(code) { var r = null; (st.tax ? st.tax.branches : []).forEach(function (b) { b.subjects.forEach(function (sb) { if (sb.code === code) r = sb.id; }); }); return r; }
  function loadingScreen(title, msg) { paint(bar(title, "", "back") + '<div class="pn-body"><p class="pn-load" role="status" id="pnLoadMsg">' + msg + "</p></div>"); }
  function stepMsg(d, n) { var el = root && root.querySelector("#pnLoadMsg"); if (el) el.textContent = "Loading questions: " + d + " of " + n + " modules"; }
  // Today's set: due reviews from the modules with the most due (up to 6 files), then adaptive new questions from
  // "solve next" to reach the day's goal, 20 at a time.
  function startPlan() {
    var s = load(), td = today(), p = planToday(s, td), hid = hidden();
    st.stack.push(function () {}); loadingScreen("Today", "Loading questions");
    var pairs = p.dueModules.slice(0, 6).map(function (x) { return { s: subjectOfModule(x.m), m: x.m }; }).filter(function (x) { return x.s; });
    var nx = solveNext(subjectsOf(s.exam), st.ix, s, td, s.exam);
    if (nx && !pairs.some(function (x) { return x.m === nx.module; })) pairs.push({ s: nx.subject, m: nx.module });
    loadMany(pairs, stepMsg).then(function (lists) {
      var out = [];
      lists.forEach(function (l) { var dk = deckKey(l.m); poolFor(l.items, s.exam, hid).forEach(function (it) { var c = s.cards[C.key(dk, it.id)]; if (c && c[3] <= td && out.length < SESSION) out.push(it); }); });
      lists.forEach(function (l) { if (out.length < SESSION && nx && l.m === nx.module) out = out.concat(adaptiveNew(poolFor(l.items, s.exam, hid), s.cards, deckKey(l.m), targetDifficulty(s.mod[l.m]), Math.min(SESSION - out.length, Math.max(p.left, 1)))); });
      st.stack.pop();
      if (!out.length) { toast("Nothing due. Open a subject to learn something new."); return rerender(); }
      runQuestions(out, "study", "Today");
    });
  }
  // Weak areas: up to 10 of the mistakes, then unseen questions at the right level from the 3 weakest modules.
  function startWeak() {
    var s = load(), hid = hidden(), weak = weakModules(s, 3), mids = Object.keys(s.mt), pairs = [], seen = {};
    mids.slice(0, 40).forEach(function (id) { var b = s.mt[id]; if (!seen[b[1]] && pairs.length < 4) { seen[b[1]] = 1; pairs.push({ s: b[0], m: b[1] }); } });
    weak.forEach(function (m) { var sid = subjectOfModule(m); if (sid && !seen[m]) { seen[m] = 1; pairs.push({ s: sid, m: m }); } });
    st.stack.push(function () {}); loadingScreen("Weak areas", "Loading questions");
    loadMany(pairs, stepMsg).then(function (lists) {
      var out = [];
      lists.forEach(function (l) { l.items.forEach(function (it) { if (s.mt[it.id] && usable(it, hid) && out.length < 10) out.push(it); }); });
      lists.forEach(function (l) { if (weak.indexOf(l.m) >= 0 && out.length < SESSION) out = out.concat(adaptiveNew(poolFor(l.items, s.exam, hid), s.cards, deckKey(l.m), targetDifficulty(s.mod[l.m]), Math.ceil((SESSION - out.length) / 2))); });
      st.stack.pop();
      if (!out.length) { toast("No weak areas yet. Keep practising."); return rerender(); }
      runQuestions(shuffle(out).slice(0, SESSION), "study", "Weak areas");
    });
  }
  var mf = { tag: "all" };
  function renderMistakes() {
    var s = load(), c = mistakeCounts(s.mt), ids = Object.keys(s.mt).filter(function (id) { return mf.tag === "all" || (mf.tag === "untagged" ? !s.mt[id][2] : s.mt[id][2] === mf.tag); });
    ids.sort(function (a, b) { return s.mt[b][3] - s.mt[a][3]; });
    var chips = [["all", "All"]].concat(MISTAKE_TAGS).concat([["untagged", "Not tagged"]]).map(function (t) {
      return '<button type="button" class="pn-chip' + (mf.tag === t[0] ? " on" : "") + '" aria-pressed="' + (mf.tag === t[0]) + '" data-act="mfilter" data-v="' + t[0] + '">' + t[1] + " " + (c[t[0]] || 0) + "</button>";
    }).join("");
    paint(bar("My mistakes", fmt(c.all) + " to fix", "back") + '<div class="pn-body">' + (c.all ?
      '<div class="pn-wrap">' + chips + '</div><button type="button" class="pn-btn pri" data-act="mpractice"' + (ids.length ? "" : " disabled") + ">" + ico("play") + " Practise these " + Math.min(ids.length, 50) + "</button>" +
      '<ul class="pn-mods">' + ids.slice(0, 100).map(function (id) { var b = s.mt[id], t = topicOf(b[0], b[1]); return '<li><div class="pn-mod static"><span class="pn-mb"><b>' + esc(b[4]) + "</b><small>" + (t ? tx(t.title) : esc(b[1])) + (b[2] ? " · " + esc(tagLabel(b[2])) : "") + "</small></span></div></li>"; }).join("") + "</ul>" +
      '<p class="pn-mut pn-small">A question leaves this list when you answer it right.</p>'
      : '<p class="pn-empty">No mistakes to fix. Questions you get wrong collect here.</p>') + "</div>");
    var subs = {}; Object.keys(s.mt).forEach(function (id) { subs[s.mt[id][0]] = 1; }); Object.keys(subs).forEach(function (sid) { loadIndex(sid); });
  }
  function tagLabel(t) { for (var i = 0; i < MISTAKE_TAGS.length; i++) if (MISTAKE_TAGS[i][0] === t) return MISTAKE_TAGS[i][1]; return ""; }
  function practiceMistakes() {
    var s = load(), hid = hidden(), ids = Object.keys(s.mt).filter(function (id) { return mf.tag === "all" || (mf.tag === "untagged" ? !s.mt[id][2] : s.mt[id][2] === mf.tag); }).slice(0, 50), pairs = [], seen = {};
    ids.forEach(function (id) { var b = s.mt[id]; if (!seen[b[1]]) { seen[b[1]] = 1; pairs.push({ s: b[0], m: b[1] }); } });
    var want = {}; ids.forEach(function (id) { want[id] = 1; });
    st.stack.push(function () {}); loadingScreen("My mistakes", "Loading questions");
    loadMany(pairs.slice(0, 12), stepMsg).then(function (lists) {
      var out = []; lists.forEach(function (l) { l.items.forEach(function (it) { if (want[it.id] && usable(it, hid)) out.push(it); }); });
      st.stack.pop();
      if (!out.length) { toast("These questions need a connection to load once."); return rerender(); }
      runQuestions(shuffle(out), "study", "My mistakes");
    });
  }

  /* ---------- Phase 5: mock exams ---------- */
  function renderMocks() {
    var s = load(), list = MOCKS[s.exam] || MOCKS["neet-pg"];
    paint(bar("Mock exam", examOf(s.exam).label, "back") + '<div class="pn-body">' + list.map(function (m) {
      var mini = Math.min(50, m.n), part = m.parts ? m.n / m.parts : 0;
      return '<section class="pn-panel"><p class="pn-big pn-mid">' + esc(m.label) + '</p><p class="pn-mut">' + m.n + " questions" + (part ? " in " + m.parts + " parts of " + part + ", " + fmtMin(m.min / m.parts) + " each" : ", " + fmtMin(m.min)) + ". Right +" + fmtMark(m.plus) + (m.minus ? ", wrong minus " + fmtMark(m.minus) : ", no negative marking") + ", unanswered 0." + (m.pass ? " Pass mark " + m.pass + " of " + m.n * m.plus + "." : "") + "</p>" +
        (part ? '<button type="button" class="pn-btn pri" data-act="mock" data-v="' + m.id + '" data-k="part">' + ico("clock") + " One part: " + part + " questions, " + fmtMin(m.min / m.parts) + "</button>"
          : '<button type="button" class="pn-btn pri" data-act="mock" data-v="' + m.id + '" data-k="full">' + ico("clock") + " Full mock: " + m.n + " questions</button>") +
        (mini < m.n ? '<button type="button" class="pn-btn" data-act="mock" data-v="' + m.id + '" data-k="mini">' + ico("clock") + " Mini mock: " + mini + " questions, " + fmtMin(Math.round(m.min * mini / m.n)) + "</button>" : "") + "</section>";
    }).join("") + '<p class="pn-mut pn-small">Questions are drawn across every subject of the exam in proportion to the bank. Patterns follow the published bulletins; check the current one before your exam.</p></div>');
  }
  function fmtMin(m) { var h = Math.floor(m / 60), r = m % 60; return (h ? h + " h" : "") + (h && r ? " " : "") + (r ? r + " min" : ""); }
  function fmtMark(x) { return Math.abs(x - 1 / 3) < 1e-9 ? "1/3" : String(x); }
  function startMock(id, kind) {
    var s = load(), m = mockOf(s.exam, id), n = kind === "mini" ? Math.min(50, m.n) : kind === "part" && m.parts ? m.n / m.parts : m.n, subs = subjectsOf(s.exam), hid = hidden();
    st.stack.push(function () {}); loadingScreen(m.label, "Choosing questions");
    Promise.all(subs.map(function (sb) { return loadIndex(sb.id); })).then(function () {
      var pairs = mockModules(subs.map(function (sb) { return { id: sb.id, ix: st.ix[sb.id] }; }), s.exam, kind === "mini" ? 12 : 30);
      return loadMany(pairs, stepMsg);
    }).then(function (lists) {
      var list = customDraw(lists.map(function (l) { return poolFor(l.items, s.exam, hid); }), n, 0);
      st.stack.pop();
      if (list.length < Math.min(n, 5)) { toast("Not enough questions loaded for a mock. Check the connection and try again."); return rerender(); }
      runQuestions(list, "exam", m.label + (kind === "mini" ? " (mini)" : kind === "part" ? " (one part)" : ""), { limit: Math.round(m.min * 60 * list.length / m.n), scheme: { plus: m.plus, minus: m.minus, label: m.label, pass: m.pass ? m.pass / (m.n * m.plus) : 0 } });
    });
  }
  function mockAnalysis(r) {
    var sc = scoreMock(r.items, r.ans, r.scheme), rows = Object.keys(sc.bySubject).map(function (sid) { var b = sc.bySubject[sid], sb = subjectById(sid); return { sid: sid, sb: sb, name: sb ? tx(sb.name) : "Not sorted into a subject yet", n: b.n, right: b.right, wrong: b.wrong, pct: b.n ? Math.round(b.right * 100 / b.n) : 0 }; });
    rows.sort(function (a, b) { return a.pct - b.pct; });
    return '<section class="pn-panel pn-score"><p class="pn-big">' + fmtMark(sc.marks) + " / " + sc.max + '</p><p class="pn-mut">' + sc.right + " right · " + sc.wrong + " wrong · " + sc.blank + " unanswered · " + fmtTime(r.secs) + " taken</p>" +
      (r.scheme.pass ? '<p class="pn-mut pn-small">Pass mark in the exam: ' + Math.round(r.scheme.pass * 100) + "% of the maximum. This set: " + (sc.max ? Math.round(Math.max(0, sc.marks) * 100 / sc.max) : 0) + "%.</p>" : "") + "</section>" +
      '<h2 class="pn-sec">By subject, weakest first</h2><ul class="pn-mods">' + rows.map(function (x) {
        // A previous-year question not yet sorted into a subject (_s "pyq") has no subject screen to open.
        var inner = '<span class="pn-mb"><b>' + x.name + "</b><small>" + x.right + " of " + x.n + " right · " + x.wrong + ' wrong</small></span><span class="pn-st' + (x.pct >= 70 ? " done" : "") + '">' + x.pct + "%</span>";
        return x.sb ? '<li><button type="button" class="pn-mod" data-act="subject" data-s="' + esc(x.sid) + '">' + inner + "</button></li>" : '<li><div class="pn-mod static">' + inner + "</div></li>";
      }).join("") + "</ul>";
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
    if (a === "plan") return startPlan();
    if (a === "weak") return startWeak();
    if (a === "goal") { var G2 = [20, 30, 50, 100], gi = G2.indexOf(s.goal); s.goal = G2[(gi + 1) % G2.length]; save(); return rerender(); }
    if (a === "mistakes") { mf.tag = "all"; return push(renderMistakes); }
    if (a === "mfilter") { mf.tag = v; return rerender(); }
    if (a === "mpractice") return practiceMistakes();
    if (a === "mtag") { var rt = st.run, itm = rt && rt.items[rt.i]; if (itm && s.mt[itm.id]) { s.mt[itm.id][2] = s.mt[itm.id][2] === v ? null : v; save(); } return renderRun(); }
    if (a === "mocks") return push(renderMocks);
    if (a === "teach") { var rt3 = st.run, it3 = rt3 && rt3.items[rt3.i]; if (it3 && G.PREP_TEACHER) G.PREP_TEACHER.explain(it3, rt3.ans[rt3.i], HOST); return; }
    if (a === "mock") return startMock(v, b.getAttribute("data-k"));
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
    // Arena and My stats (prep-arena.js) own every data-act starting "a-".
    if (a.indexOf("a-") === 0 && G.PREP_ARENA && G.PREP_ARENA.act) return G.PREP_ARENA.act(a, b, HOST);
    // Lessons (prep-lessons.js) own every data-act starting "l-".
    if (a.indexOf("l-") === 0 && G.PREP_LESSONS) return G.PREP_LESSONS.act(a, b, HOST);
    // Previous year papers (prep-pyq.js) own every data-act starting "y-".
    if (a.indexOf("y-") === 0 && G.PREP_PYQ) return G.PREP_PYQ.act(a, b, HOST);
    // Onboarding, readiness and today's plan (prep-plan.js) own every data-act starting "p-".
    if (a.indexOf("p-") === 0 && G.PREP_PLAN) return G.PREP_PLAN.act(a, b, HOST);
    // Module flashcards (prep-flash.js) own every data-act starting "k-".
    if (a.indexOf("k-") === 0 && G.PREP_FLASH) return G.PREP_FLASH.act(a, b, HOST);
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
    exam: function () { return examOf(load().exam); },
    // Arena and My stats (prep-arena.js)
    subjIco: subjIco, row: row, fmtTime: fmtTime, mockOf: mockOf, subjectOfModule: subjectOfModule, subjectById: subjectById, tx: tx,
    stackTop: function () { return st.stack[st.stack.length - 1]; }, home: renderHome, run_: function () { return st.run; },
    // Lessons (prep-lessons.js)
    // Plan (prep-plan.js)
    subjectsOf: subjectsOf, loadIndex: loadIndex, ix: function () { return st.ix; }, startMock: startMock, pure: PURE,
    stack: function () { return st.stack; }, loadModule: loadModule, bankApi: API, shuffle: shuffle, pool: function (items) { var h = hidden(); return (items || []).filter(function (it) { return usable(it, h); }); }, cacheGet: cacheGet, cachePut: cachePut };

  var API_OBJ = { open: open, close: close, back: back, isOpen: function () { return st.open; }, _pure: PURE, _st: st, _host: HOST };
  G.PREP = API_OBJ;
})(typeof window !== "undefined" ? window : this);
