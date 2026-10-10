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
  function emptyStore() { return { v: 1, cards: {}, conf: {}, days: {}, mod: {}, bm: {}, rep: {}, exam: "neet-pg", last: null, dl: {}, hid: { ids: {}, ts: 0 }, mt: {}, goal: 30, mh: [], ls: {}, lsp: { r: 1, au: 0 }, pl: null, pt: null, ra: [], ask: null, cel: null, ml: null, ps: {} }; }
  function deckKey(moduleId) { return "p:" + moduleId; }
  // hidden: item ids withdrawn after repeated student reports (/api/prep/flag?hidden=1), as an id -> 1 map.
  /* mergeOverlay(bank, extra) -> bank items, then overlay items whose id the bank (or an earlier overlay item) does not
     have. Items are kept as they are (x, r, img, imgPlace, prov, set, sid and the key untouched). */
  function mergeOverlay(bank, extra) {
    var seen = {}, out = [];
    (bank || []).forEach(function (it) { if (it && !seen[it.id]) { seen[it.id] = 1; out.push(it); } });
    (extra || []).forEach(function (it) { if (it && it.id && !seen[it.id]) { seen[it.id] = 1; out.push(it); } });
    return out;
  }
  /* ovFor(sets, setIds, sid, mid) -> overlay items a module adds: the sum over the subject's sets of
     sets[set][sid][mid] (prep/bank/overlay-counts.json "sets"). */
  function ovFor(sets, setIds, sid, mid) {
    var n = 0;
    (setIds || []).forEach(function (set) { var m = sets && sets[set] && sets[set][sid]; n += (m && +m[mid]) || 0; });
    return n;
  }
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
  // A module's MCQs: the bank count plus its overlay items (t.ov, from prep/bank/overlay-counts.json via loadIndex), the
  // same questions loadModule draws. USMLE with 5 or more vignettes counts those only.
  function countFor(t, exam) { return exam === "usmle" && t.usmle >= 5 ? t.usmle : (t.count || 0) + (t.ov || 0); }
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
  /* Difficulty levels: 1 easy, 2 medium, 3 hard, 4 very hard. Bank and overlay files keep d 1 to 3 and mark very hard
     items vh: true; markLevels sets d 4 on those at load time (the files are not rewritten). levelOf reads either. */
  function levelOf(it) { return it.vh === true || it.d === 4 ? 4 : it.d === 1 || it.d === 3 ? it.d : 2; }
  function markLevels(items) { (items || []).forEach(function (it) { if (it && it.vh === true) it.d = 4; }); return items; }
  function shuffle(a, rnd) { rnd = rnd || Math.random; for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  // Custom module: n questions from the given items, optionally one difficulty, spread across modules.
  function customDraw(lists, n, d, rnd) {
    var pools = lists.map(function (l) { return shuffle(l.filter(function (it) { return !d || levelOf(it) === d; }).slice(), rnd); }).filter(function (p) { return p.length; });
    var out = [], i = 0;
    while (out.length < n && pools.some(function (p) { return p.length; })) { var p = pools[i % pools.length]; if (p.length) out.push(p.pop()); i++; }
    return shuffle(out, rnd);
  }
  /* ---- Phase 4: adapt ---- */
  // Target difficulty from the share right: 90% and over after 10 attempts -> very hard (4), 80% and over -> hard (3),
  // 60% and over -> medium (2), else easy (1); under 5 attempts -> medium.
  function targetDifficulty(ms) { if (!ms || (ms.t || 0) < 5) return 2; var acc = ms.ok / ms.t; return acc >= 0.9 && ms.t >= 10 ? 4 : acc >= 0.8 ? 3 : acc >= 0.6 ? 2 : 1; }
  // n unseen items, closest to the target difficulty first (random within a level).
  function adaptiveNew(pool, cards, dk, target, n, rnd) {
    var fresh = shuffle(pool.filter(function (it) { return !cards[dk + ":" + it.id]; }), rnd);
    fresh.sort(function (a, b) { return Math.abs(levelOf(a) - target) - Math.abs(levelOf(b) - target); });
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
  /* A clock per question (owner 2026-10-09 strict, 2026-10-10 timer box). Each question has one budget of sec seconds,
     spent only while that question is on screen and the app is in front with no sheet over it, never given back: a
     revisit carries on where it stopped. rem[i] is what is left and used[i] what was spent, in ms; on is the question
     whose clock runs (-1 none) since the timestamp at. Times come from a monotonic clock (performance.now in the app).
     Visible time only: the app pauses the clock when it goes to the background or a sheet opens, and as a backstop a
     gap of more than QC_GAP between two readings (the page was frozen, the phone locked before any event arrived) is
     not charged. A clock that steps backwards adds nothing. When a budget reaches 0 the question is locked for good
     (out[i]). */
  var QC_GAP = 3000;
  function qcNew(n, sec) {
    var c = { sec: sec, rem: [], out: [], used: [], on: -1, at: 0 };
    for (var i = 0; i < n; i++) { c.rem.push(sec * 1000); c.out.push(false); c.used.push(0); }
    return c;
  }
  // Charge the running question up to now.
  function qcStep(c, now) {
    if (!c || c.on < 0) return;
    var d = now - c.at, i = c.on;
    c.at = now;
    if (!(d > 0) || d > QC_GAP) return;
    var take = Math.min(d, c.rem[i]);
    c.rem[i] -= take; if (c.used) c.used[i] = (c.used[i] || 0) + take;
    if (c.rem[i] <= 0) { c.rem[i] = 0; c.out[i] = true; }
  }
  // Stop the running clock and keep what is left (a budget used up here locks the question).
  function qcPause(c, now) {
    if (!c || c.on < 0) return;
    qcStep(c, now);
    c.on = -1;
  }
  // Question i is on screen from now: its clock runs, unless it is locked.
  function qcShow(c, i, now) {
    if (!c) return;
    if (c.on === i) return qcStep(c, now);
    qcPause(c, now);
    if (!c.out[i] && c.rem[i] > 0) { c.on = i; c.at = now; }
  }
  function qcLeft(c, i, now) {
    if (!c) return 0;
    var d = c.on === i ? now - c.at : 0;
    if (!(d > 0) || d > QC_GAP) d = 0;
    return Math.max(0, c.rem[i] - d);
  }
  // qcTick(c, now) -> the index locked by this tick (its time ran out), or -1.
  function qcTick(c, now) {
    if (!c || c.on < 0) return -1;
    var i = c.on;
    qcStep(c, now);
    if (!c.out[i]) return -1;
    c.on = -1;
    return i;
  }
  /* qcLevel(left, total) -> the line's state: "ok" over half the time left, "mid" down to 20%, "low" under 20% (owner:
     red when less than 20% remains; at 60 s that is the last 12 s), "out" at 0. */
  function qcLevel(left, total) { return !(left > 0) ? "out" : left < total * 0.2 ? "low" : left <= total * 0.5 ? "mid" : "ok"; }
  /* qcAfter(c, from) -> where Test Mode goes when a question's time runs out: the next question after it that still has
     time, or -1 when there is none (the test is marked). Learning Mode never moves by itself. */
  function qcAfter(c, from) { for (var i = from + 1; c && i < c.out.length; i++) if (!c.out[i]) return i; return -1; }
  /* qcStats(c) -> { avg, n, out }: seconds spent per question that was on screen (rounded), how many, how many timed out. */
  function qcStats(c) {
    var t = 0, n = 0, o = 0;
    if (!c || !c.used) return null;
    c.used.forEach(function (u, i) { if (u > 0) { t += u; n++; } if (c.out[i]) o++; });
    return { avg: n ? Math.round(t / n / 1000) : 0, n: n, out: o };
  }
  /* qcNext(c, from, open) -> where a timed-out question hands over: the next question after from that is still open
     (open(i): not locked and, in practice, not answered), else the first open one before it, else -1 (the set is done). */
  function qcNext(c, from, open) {
    var n = c ? c.rem.length : 0, i;
    for (i = from + 1; i < n; i++) if (!c.out[i] && open(i)) return i;
    for (i = 0; i < from; i++) if (!c.out[i] && open(i)) return i;
    return -1;
  }
  /* Result review (owner 2026-10-09): every question of a finished set under a filter. reviewSplit -> { all, wrong,
     right, skip, bm, out }: index lists; wrong = answered and wrong, skip = not answered (skipped or time up), bm =
     bookmarked now, out = timed out. reviewDefault: Wrong when any, else All. */
  function reviewSplit(items, ans, out, bm) {
    var r = { all: [], wrong: [], right: [], skip: [], bm: [], out: [] };
    (items || []).forEach(function (it, i) {
      r.all.push(i);
      if (ans[i] < 0 || ans[i] == null) r.skip.push(i); else if (ans[i] === it.a) r.right.push(i); else r.wrong.push(i);
      if (bm && it && bm[it.id]) r.bm.push(i);
      if (out && out[i]) r.out.push(i);
    });
    return r;
  }
  function reviewDefault(sp) { return sp.wrong.length ? "wrong" : "all"; }
  /* Saved practice sets (owner 2026-10-09): every set made in the practice setup sheet or as a custom module is kept
     7 days from creation, as item ids and answers only (never item bodies), in the synced store map s.ps (prep-sync
     MAPS). Entry: { t title, k kind, md mode, c created, x expires, f finished, m ["subject|module"], q [[module index,
     item id]], a answers, o timed-out indices, ok right, n questions }. Only bank items can be reopened from their
     module file, so previous-year and own-deck items are left out of the saved copy. */
  var PS_DAYS = 7, PS_MAX = 20, PS_ITEMS = 200, DAY_MS = 864e5;
  function psKeepable(it) { return !!(it && it.id != null && it._s && it._s !== "deck" && !it._py && (it._m || it.t)); }
  function psPack(items, ans, out, meta, now) {
    var m = [], mi = {}, q = [], a = [], o = [], ok = 0;
    (items || []).forEach(function (it, i) {
      if (!psKeepable(it) || q.length >= PS_ITEMS) return;
      var k = it._s + "|" + (it._m || it.t);
      if (!(k in mi)) { mi[k] = m.length; m.push(k); }
      if (out && out[i]) o.push(q.length);
      var x = ans && ans[i] != null ? ans[i] : -1;
      if (x >= 0 && x === it.a) ok++;
      q.push([mi[k], String(it.id)]); a.push(x);
    });
    if (!q.length) return null;
    return { t: String(meta.title || "Practice set").slice(0, 80), k: meta.kind || "", md: meta.mode === "exam" ? "exam" : "study", c: now, x: now + PS_DAYS * DAY_MS, f: now, m: m, q: q, a: a, o: o, ok: ok, n: q.length };
  }
  // psPurge(map, now) -> the ids removed: expired (or broken) entries go.
  function psPurge(map, now) {
    var gone = [];
    for (var id in map || {}) { var e = map[id]; if (!e || typeof e !== "object" || !(e.x > now)) { delete map[id]; gone.push(id); } }
    return gone;
  }
  // psCap(map, max) -> the ids removed: the oldest beyond max.
  function psCap(map, max) {
    var ids = Object.keys(map || {}).sort(function (x, y) { return (map[y].c || 0) - (map[x].c || 0); }), gone = ids.slice(max || PS_MAX);
    gone.forEach(function (id) { delete map[id]; });
    return gone;
  }
  function psList(map, now) { return Object.keys(map || {}).filter(function (id) { return map[id] && map[id].x > now; }).sort(function (x, y) { return map[y].c - map[x].c; }).map(function (id) { return { id: id, e: map[id] }; }); }
  function psDaysLeft(e, now) { return Math.max(0, Math.ceil((e.x - now) / DAY_MS)); }
  // psUnpack(entry, lists) -> { items, ans, out }: lists maps "subject|module" to that module's items; a question no
  // longer in its module (or hidden) is dropped with its answer.
  function psUnpack(e, lists) {
    var items = [], ans = [], out = [], by = {};
    (e.m || []).forEach(function (k, j) { by[j] = {}; ((lists && lists[k]) || []).forEach(function (it) { by[j][String(it.id)] = it; }); });
    (e.q || []).forEach(function (p, i) {
      var it = by[p[0]] && by[p[0]][p[1]];
      if (!it) return;
      items.push(it); ans.push(e.a && e.a[i] != null ? e.a[i] : -1); out.push((e.o || []).indexOf(i) >= 0);
    });
    return { items: items, ans: ans, out: out };
  }

  /* Explanations (2026-10-08, tools/prep-explain.mjs). An item may carry x = { key, notes, others: { letter: reason },
     pearl }; notes use a tiny Markdown subset and nothing else is ever turned into HTML: every character is escaped
     first, then "## " headings, **bold**, "- " / "* " bullets, "1. " steps and pipe tables (header row, "| --- |" row)
     become tags. Old MedMCQA explanations use "*" as an inline bullet ("*Corkscrew ... *Represents ..."): legacyExp
     turns two or more of those into list lines and drops a lone leading one. */
  function escH(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function inlineMd(s) { return escH(s).replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, "<b>$1</b>").replace(/\*/g, ""); }
  function cellsOf(l) { return l.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); }); }
  var TBL_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  function mdLite(src) {
    var lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n"), out = [], para = [], list = null, i = 0, m;
    function flushP() { if (para.length) { out.push("<p>" + inlineMd(para.join(" ")) + "</p>"); para = []; } }
    function flushL() {
      if (!list) return;
      out.push("<" + list.t + (list.start > 1 ? ' start="' + list.start + '"' : "") + ">" + list.items.map(function (x) { return "<li>" + inlineMd(x) + "</li>"; }).join("") + "</" + list.t + ">");
      list = null;
    }
    while (i < lines.length) {
      var t = lines[i].trim();
      if (!t) { flushP(); flushL(); i++; continue; }
      if ((m = /^#{1,6}\s+(.+?)\s*#*$/.exec(t))) { flushP(); flushL(); out.push('<h4 class="pn-xh">' + inlineMd(m[1]) + "</h4>"); i++; continue; }
      if (t.charAt(0) === "|" && i + 1 < lines.length && TBL_SEP.test(lines[i + 1].trim())) {
        flushP(); flushL();
        var head = cellsOf(t), rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim().charAt(0) === "|") rows.push(cellsOf(lines[i++]));
        var w = head.length;
        out.push('<div class="pn-xt" role="region" tabindex="0" aria-label="Table: ' + escH(head.join(", ").replace(/\*/g, "")) + '"><table><thead><tr>' + head.map(function (c) { return '<th scope="col">' + inlineMd(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.map(function (r) { var cs = []; for (var k = 0; k < w; k++) cs.push(k ? "<td>" + inlineMd(r[k] || "") + "</td>" : '<th scope="row">' + inlineMd(r[k] || "") + "</th>"); return "<tr>" + cs.join("") + "</tr>"; }).join("") + "</tbody></table></div>");
        continue;
      }
      var b = /^[-*\u2022]\s+(.*)$/.exec(t), n = /^(\d{1,2})[.)]\s+(.*)$/.exec(t);
      if (b || n) {
        flushP();
        var ty = b ? "ul" : "ol";
        if (!list || list.t !== ty) { flushL(); list = { t: ty, items: [], start: n ? +n[1] : 1 }; }
        list.items.push(b ? b[1] : n[2]);
        i++; continue;
      }
      flushL(); para.push(t); i++;
    }
    flushP(); flushL();
    return out.join("");
  }
  function legacyExp(s) {
    var t = String(s == null ? "" : s).replace(/\r\n?/g, "\n").trim(), re = /(^|\s)\*(?!\*)(?=[^\s*])/g;
    var hits = t.match(re);
    if (hits && hits.length >= 2) return t.replace(re, "\n- ").trim();
    return t.replace(/^\*(?!\*)\s*/, "");
  }
  /* explainOf(item) -> { x, r } the parts the feedback draws: x when it is whole, r one reason per option (the item's own,
     else built from x). */
  function explainOf(it) {
    var L4 = ["A", "B", "C", "D"], x = it && it.x && typeof it.x === "object" && typeof it.x.key === "string" && it.x.key.trim() ? it.x : null;
    var r = it && it.r && it.r.length === it.o.length ? it.r : null;
    if (!r && x && x.others) r = it.o.map(function (o, k) { return k === it.a ? x.key : String(x.others[L4[k]] || ""); });
    return { x: x, r: r };
  }
  /* Module files of a bank version can be republished in place (explanations added to v5 items), but a module once
     opened is kept in IndexedDB. bankStamps(manifest) -> { subject: stamp } from prep/bank/<ver>/manifest.json (each
     subject's bytes and items, which change when its files do); cacheFresh(hit, stamp) says whether a cached copy can be
     used as is. No stamp (manifest not loaded, offline, a subject outside the manifest) keeps the cached copy. */
  function bankStamps(m) {
    var o = {};
    ((m && m.subjects) || []).forEach(function (s) { if (s && s.id && s.bytes) o[s.id] = s.bytes + "." + (s.items || 0); });
    return o;
  }
  function cacheFresh(hit, stamp) { return !!hit && (!stamp || hit.s === stamp); }
  /* ---- MaiK lines (prep/maik-lines.json, owner-approved 2026-10-09): one warm line after a set of 5 or more, never in
     mocks or battles. Lookup: module, then subject, then the exam's branch; unknown ids give nothing. ---- */
  function pickLine(lines, ids, n) {
    if (!lines || !ids) return null;
    var list = (ids.module && lines.module && lines.module[ids.module]) || (ids.subject && lines.subject && lines.subject[ids.subject]) || (ids.branch && lines.branch && lines.branch[ids.branch]) || null;
    if (!list || !list.length) return null;
    var k = Math.max(0, Math.floor(Number(n) || 0)) % list.length;
    return { text: list[k], key: ids.module && lines.module && lines.module[ids.module] ? "m:" + ids.module : ids.subject && lines.subject && lines.subject[ids.subject] ? ids.subject : "b:" + ids.branch };
  }
  // The set's one subject (every item from the same taxonomy subject), else null (mixed, decks, papers).
  function setSubject(items, isSubject) {
    var sid = null;
    for (var i = 0; i < (items || []).length; i++) { var x = items[i] && items[i]._s; if (!x || (sid && x !== sid)) return null; sid = x; }
    return sid && (!isSubject || isSubject(sid)) ? sid : null;
  }
  /* ---- Balloons (plan section 2): milestones only, at most one release a day except a level-up or a new rank. XP and
     level follow prep-plan.js (1 per answer, 1 more when right, plus lesson XP; level n from 50 n (n - 1) XP). ---- */
  var RANKS = [[1, "Fresher"], [3, "Intern"], [5, "Resident"], [8, "Registrar"], [12, "Consultant"]];
  var Q_MILES = [100, 500, 1000, 2500, 5000, 10000];
  function xpOfStore(s) { var x = 0, k; for (k in (s && s.mod) || {}) x += (s.mod[k].t || 0) + (s.mod[k].ok || 0); for (k in (s && s.ls) || {}) x += s.ls[k].xp || 0; return x; }
  function levelN(xp) { var n = 1; while (50 * (n + 1) * n <= xp) n++; return n; }
  function rankOf(n) { var r = RANKS[0][1]; RANKS.forEach(function (x) { if (n >= x[0]) r = x[1]; }); return r; }
  function mileSnap(s, streak) {
    var q = 0, k; for (k in (s && s.mod) || {}) q += s.mod[k].t || 0;
    var lv = levelN(xpOfStore(s));
    return { lv: lv, rank: rankOf(lv), streak: streak || 0, q: q, mocks: ((s && s.mh) || []).length };
  }
  function streakMile(a, b) { var m = 0; [7, 30, 100].forEach(function (x) { if (a < x && b >= x) m = x; }); if (b >= 200 && Math.floor(b / 100) > Math.floor(a / 100)) m = Math.floor(b / 100) * 100; return m; }
  /* milestone(m0, m1, cel, day) -> { key, label, big } | null: the biggest milestone crossed between two snapshots that
     has not fired before (cel.keys) and fits the day's budget (cel.day: one a day, a level-up or rank always). */
  function milestone(m0, m1, cel, day) {
    if (!m0 || !m1) return null;
    var seen = {}, list = [];
    ((cel && cel.keys) || []).forEach(function (k) { seen[k] = 1; });
    if (m1.rank !== m0.rank && m1.lv > m0.lv) list.push({ key: "rk-" + m1.rank, label: "New rank: " + m1.rank, big: 2, lvl: 1 });
    if (m1.lv > m0.lv) list.push({ key: "lv" + m1.lv, label: "Level " + m1.lv, big: 0, lvl: 1 });
    var sm = streakMile(m0.streak, m1.streak); if (sm) list.push({ key: "st" + sm, label: sm + " day streak", big: 0 });
    Q_MILES.forEach(function (x) { if (m0.q < x && m1.q >= x) list.push({ key: "q" + x, label: fmtN(x) + " questions answered", big: 0 }); });
    if (m0.mocks === 0 && m1.mocks >= 1) list.push({ key: "mock1", label: "First mock exam finished", big: 0 });
    var free = !cel || cel.day !== day;
    for (var i = 0; i < list.length; i++) { var x0 = list[i]; if (!seen[x0.key] && (free || x0.lvl)) return x0; }
    return null;
  }
  function fmtN(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  // Record a fired milestone (and every other key crossed with it, so none fires late).
  function noteCele(s, m, day, alsoKeys) {
    var c = s.cel && typeof s.cel === "object" ? s.cel : { day: null, keys: [] };
    var keys = (c.keys || []).slice();
    [m.key].concat(alsoKeys || []).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    s.cel = { day: day, keys: keys.slice(-200) };
    return s.cel;
  }
  var PURE = { dayHash: dayHash, selfShare: selfShare, buildSearch: buildSearch, searchFile: searchFile, pickLine: pickLine, setSubject: setSubject, mileSnap: mileSnap, milestone: milestone, noteCele: noteCele, levelN: levelN, xpOfStore: xpOfStore, streakMile: streakMile, EXAMS: EXAMS, examOf: examOf, emptyStore: emptyStore, deckKey: deckKey, usable: usable, poolFor: poolFor, progressByModule: progressByModule,
    statusOf: statusOf, stars: stars, countFor: countFor, ovFor: ovFor, solveNext: solveNext, filterModules: filterModules, customDraw: customDraw, oldOverlays: oldOverlays, levelOf: levelOf, markLevels: markLevels, shuffle: shuffle, fmtTime: fmtTime, qcNew: qcNew, qcPause: qcPause, qcShow: qcShow, qcLeft: qcLeft, qcTick: qcTick, qcNext: qcNext, qcStep: qcStep, qcLevel: qcLevel, qcAfter: qcAfter, qcStats: qcStats, QC_GAP: QC_GAP, reviewSplit: reviewSplit, reviewDefault: reviewDefault, psPack: psPack, psPurge: psPurge, psCap: psCap, psList: psList, psDaysLeft: psDaysLeft, psUnpack: psUnpack, PS_DAYS: PS_DAYS, PS_MAX: PS_MAX,
    targetDifficulty: targetDifficulty, adaptiveNew: adaptiveNew, weakModules: weakModules, planToday: planToday, MISTAKE_TAGS: MISTAKE_TAGS, mistakeCounts: mistakeCounts,
    MOCKS: MOCKS, mockOf: mockOf, mockModules: mockModules, scoreMock: scoreMock, findModule: findModule,
    mdLite: mdLite, inlineMd: inlineMd, legacyExp: legacyExp, explainOf: explainOf, mergeOverlay: mergeOverlay, bankStamps: bankStamps, cacheFresh: cacheFresh };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var D = G.document, C = G.SPECIALTY_CORE;
  var STATIC = G.SMD_PREP_BASE || "/prep/", API = G.SMD_PREP_BANK_API || "/api/prep/bank/", FLAG_API = G.SMD_PREP_FLAG_API || "/api/prep/flag", VER = G.SMD_PREP_BANK_VER || "v5", PYQ_VER = G.SMD_PREP_PYQ_VER || "v5";
  var HID_TTL = 6 * 3600e3;
  var KEY = "smd_prep_v1", SESSION = 20;
  var st = { open: false, stack: [], tax: null, ix: {}, mem: {}, store: null, run: null, timer: 0, prevOverflow: "", prevFocus: null, sub: null, filter: "all" };
  var root = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function tx(v) { return esc(v && typeof v === "object" ? (v.en || "") : v); }
  function toast(m) { try { if (G.toast) G.toast(m); } catch (e) {} }
  function today() { return C.dayNum(Date.now(), new Date().getTimezoneOffset()); }
  function fmt(n) { try { return Number(n).toLocaleString("en-IN"); } catch (e) { return String(n); } }
  function dayMonth(t) { try { return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch (e) { return ""; } }

  /* ---------- store ---------- */
  function load() {
    if (st.store) return st.store;
    var s = null; try { s = JSON.parse(G.localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    var e = emptyStore();
    if (!s || s.v !== 1) s = e; else for (var k in e) if (!(k in s)) s[k] = e[k];
    if (!s.ps || typeof s.ps !== "object") s.ps = {};
    // Saved practice sets expire 7 days after they were made: gone on the first load after that.
    if (psPurge(s.ps, Date.now()).length) { st.store = s; save(); }
    return (st.store = s);
  }
  function save() { try { G.localStorage.setItem(KEY, JSON.stringify(st.store)); } catch (e) { toast("Progress could not be saved: the device storage is full."); } }

  /* ---------- data ---------- */
  function getJSON(url) { return G.fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return r.json(); }); }
  function loadTax() { return st.tax ? Promise.resolve(st.tax) : getJSON(STATIC + "taxonomy.json").then(function (t) { return (st.tax = t); }); }
  // MaiK lines: fetched once per open, cached like the taxonomy; a miss shows no line.
  function loadLines() { if (st.lines || st.linesP) return; st.linesP = getJSON(STATIC + "maik-lines.json").then(function (j) { st.lines = j && j.subject ? j : null; }, function () { st.linesP = null; }); }
  // A subject's index; modules with overlay items (OVERLAYS) carry t.ov, their count from prep/bank/overlay-counts.json
  // (tools/prep-overlay-counts.mjs), so the counts on screen match what practice draws. No counts file: bank counts only.
  function loadIndex(sid) {
    if (st.ix[sid]) return Promise.resolve(st.ix[sid]);
    return Promise.all([getJSON(STATIC + "bank/" + bvOf(sid) + "/" + sid + "/index.json"), (OVERLAYS[sid] || []).length ? loadOvc() : {}]).then(function (r) {
      var ix = r[0];
      (ix.topics || []).forEach(function (t) { var n = ovFor(r[1], OVERLAYS[sid], sid, t.id); if (n) t.ov = n; });
      return (st.ix[sid] = ix);
    }, function () { return (st.ix[sid] = { id: sid, topics: [], counts: { total: 0 } }); });
  }
  function loadOvc() {
    if (!st.ovcP) st.ovcP = getJSON(STATIC + "bank/overlay-counts.json").then(function (j) { return (j && j.sets) || {}; }, function () { return {}; });
    return st.ovcP;
  }
  function subjectsOf(exam) {
    var ex = examOf(exam), out = [];
    (st.tax ? st.tax.branches : []).forEach(function (b) { if (b.id === ex.branch) b.subjects.forEach(function (s) { if (ex.all || !s.ex || s.ex.indexOf(ex.tag) >= 0) out.push(s); }); });
    return out;
  }
  // A subject piloted in its own bank path (taxonomy `bv`, e.g. ss-radiology in v6) reads from there; the rest from VER.
  function bvOf(sid) { var s = subjectById(sid); return (s && s.bv) || VER; }
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
  function modulePath(sid, mid) { return bvOf(sid) + "/" + sid + "/mcq/" + mid + ".json"; }
  // Stamps of the main bank version (bankStamps), loaded once a session; a failed load (offline) gives none.
  function loadStamps() {
    if (!st.stampsP) st.stampsP = getJSON(STATIC + "bank/" + VER + "/manifest.json").then(bankStamps, function () { return {}; });
    return st.stampsP;
  }
  function loadBank(sid, mid) {
    var p = modulePath(sid, mid);
    if (st.mem[p]) return Promise.resolve(st.mem[p]);
    return Promise.all([cacheGet(p), bvOf(sid) === VER ? loadStamps() : {}]).then(function (r) {
      var hit = r[0] && r[0].items ? r[0] : null, stamp = r[1][sid] || "";
      if (cacheFresh(hit, stamp)) return (st.mem[p] = hit.items);
      return getJSON(API + p).then(function (f) {
        var items = (f.items || []).map(function (it) { it._s = sid; it._m = mid; return it; });
        st.mem[p] = items;
        cachePut(p, { items: items, ts: Date.now(), s: stamp });
        return items;
      }, function (e) { if (hit) return (st.mem[p] = hit.items); throw e; });
    });
  }
  /* Overlay sets: extra MCQs for a module from outside the bank (the owner's radiology notes and licensed review books, sets "radnotes3" and "radmax7"; new
     Medicine questions for topics the bank covered thinly, set "medcov"), at overlay/<set>/<subject>/<module>.json
     { topic, set, v, items }, immutable once uploaded. A file is cached for good under its path, so a changed release
     goes to a new folder (medcov4, radnotes3 and radmax7 now, de-identified figures 2026-10-10; the earlier folders' copies are removed) and the folder named here moves with it.
     Only subjects listed here are asked for; a module without a file (404) or offline without a copy adds nothing. */
  var OVERLAYS = G.SMD_PREP_OVERLAYS || { radiology: ["radnotes3", "radmax7"], medicine: ["medcov4"], "ss-pulmonology": ["medcov4"] };
  // Earlier releases of a set (medcov4 -> medcov, medcov2, medcov3), whose cached copies a new release replaces.
  function oldOverlays(set) { var m = /^(.*?[a-z])(\d+)$/.exec(set), out = []; if (!m || +m[2] < 2) return out; out.push(m[1]); for (var k = 2; k < +m[2]; k++) out.push(m[1] + k); return out; }
  function loadOverlay(sid, mid, miss) {
    var sets = OVERLAYS[sid] || [];
    return Promise.all(sets.map(function (set) {
      var p = "overlay/" + set + "/" + sid + "/" + mid + ".json";
      if (st.mem[p]) return st.mem[p];
      return cacheGet(p).then(function (hit) {
        if (hit && hit.items) return (st.mem[p] = hit.items);
        return getJSON(API + p).then(function (f) {
          var items = (f && f.items) || [];
          st.mem[p] = items;
          cachePut(p, { items: items, ts: Date.now() });
          oldOverlays(set).forEach(function (o) { cacheDel("overlay/" + o + "/" + sid + "/" + mid + ".json"); });
          return items;
        }, function (e) { if (e && e.status === 404) return (st.mem[p] = []); if (miss) miss.n++; return []; });
      }).then(function (items) { items.forEach(function (it) { it._ov = set; }); return items; });
    })).then(function (r) { return [].concat.apply([], r); });
  }
  // A module's questions: the bank file plus its overlay items (mergeOverlay). A bank failure with overlay items still
  // gives the overlay items; with none, the failure stands.
  function loadModule(sid, mid) {
    var k = "mod:" + sid + "/" + mid;
    if (st.mem[k]) return Promise.resolve(st.mem[k]);
    var bankErr = null, miss = { n: 0 };
    return Promise.all([loadBank(sid, mid).then(null, function (e) { bankErr = e; return []; }), loadOverlay(sid, mid, miss)]).then(function (r) {
      if (bankErr && !r[1].length) throw bankErr;
      var items = markLevels(mergeOverlay(r[0], r[1]));
      items.forEach(function (it) { it._s = sid; it._m = mid; });
      if (!bankErr && !miss.n) st.mem[k] = items;   // offline overlay miss: ask again next time
      return items;
    });
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
  // The subject index may name the file (search: "search-<hash>.json", a rebuilt index under a new immutable name, e.g. with
  // the overlay sets' items), so a phone that cached the older search.json fetches the new one; no name: search.json.
  function searchFile(ix) { var n = ix && ix.search; return typeof n === "string" && /^search-[0-9a-f]{8}\.json$/.test(n) ? n : "search.json"; }
  function loadSearch(sid) {
    return loadIndex(sid).then(function (ix) { return loadSearchAt(sid, bvOf(sid) + "/" + sid + "/" + searchFile(ix)); });
  }
  function loadSearchAt(sid, p) {
    if (st.mem[p]) return Promise.resolve(st.mem[p]);
    return cacheGet(p).then(function (hit) {
      if (hit && hit.sx) return (st.mem[p] = hit.sx);
      return getJSON(API + p).then(function (sx) {
        st.mem[p] = sx; cachePut(p, { sx: sx, ts: Date.now() });
        // a named index replaces the subject's plain search.json, whose cached copy is dropped
        if (!/\/search\.json$/.test(p)) cacheDel(p.replace(/[^/]+$/, "search.json"));
        return sx;
      }, function (e) {
        // No search.json for this bank (ss-radiology v6 to v10 shipped without one): build the same index here from the
        // subject's module files (cached like any opened module). Kept for the session only, so a published file wins later.
        if (!e || e.status !== 404) throw e;
        return loadIndex(sid).then(function (ix) {
          var ts = (ix.topics || []).filter(function (t) { return t.group !== "mixed" && (t.count || 0) + (t.ov || 0) > 0; });
          return Promise.all(ts.map(function (t) { return loadModule(sid, t.id).then(function (items) { return { id: t.id, items: items }; }, function () { return { id: t.id, items: [] }; }); }));
        }).then(function (topics) { return (st.mem[p] = buildSearch(topics)); });
      });
    });
  }
  /* buildSearch([{ id, items }]) -> the search.json shape (tools/tokos-build-mcq-search.mjs, same tokeniser and preview,
     no document-frequency cut: a subject built here is small). */
  function buildSearch(topics, bank) {
    var BANK = bank || (G.SPECIALTY && G.SPECIALTY.BANK), ids = [], pv = [], start = [], post = {}, w = {};
    topics.forEach(function (t) {
      start.push(ids.length);
      t.items.forEach(function (it) {
        if (!usable(it, null) || !it.id || !it.o) return;
        var o = ids.length, q = String(it.q || "").replace(/\s+/g, " ").trim(), cut = q.slice(0, 80), sp = cut.lastIndexOf(" ");
        ids.push(it.id); pv.push(q.length <= 80 ? q : (sp > 45 ? cut.slice(0, sp) : cut) + "\u2026");
        BANK.tokens(it.q + " " + it.o.join(" ")).forEach(function (k) { (post[k] = post[k] || []).push(o); });
      });
    });
    Object.keys(post).sort().forEach(function (k) { var prev = 0; w[k] = post[k].map(function (o) { var d = o - prev; prev = o; return d.toString(36); }).join(","); });
    return { v: 1, deck: "mcq", n: ids.length, topics: topics.map(function (t) { return t.id; }), start: start, ids: ids, p: pv, w: w };
  }

  /* ---------- shell ---------- */
  var ICON = {
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h11"/>', back: '<path d="M15 18l-6-6 6-6"/>', close: '<path d="M18 6L6 18M6 6l12 12"/>', chev: '<path d="M9 6l6 6-6 6"/>',
    bm: '<path d="M6 3h12v18l-6-4-6 4z"/>', plus: '<path d="M12 5v14M5 12h14"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>', play: '<path d="M7 5l12 7-12 7z"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', next: '<path d="M5 12h14M13 6l6 6-6 6"/>', check: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    deck: '<rect x="4" y="6" width="13" height="15" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v12"/>', target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>',
    stats: '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/>', bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>', cal: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    versus: '<path d="M4 4l8 8M4 4v4M4 4h4M20 4l-8 8M20 4v4M20 4h-4M7 17l-3 3M17 17l3 3M9 15l-2 2M15 15l2 2"/>', trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 21h6M10 17h4"/>',
    off: '<path d="M3 3l18 18M8.5 8.6A9 9 0 0 0 5 11M2 8a14 14 0 0 1 4-2.4M16 11.5a9 9 0 0 1 3 1.5M10.7 5.1A14 14 0 0 1 22 8M8.5 15a5 5 0 0 1 6.5-.5M12 19h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7M8 11h5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', leave: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'
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
  // Drawn duotone on the gradient tile: a soft fill of the shape under the stroke (open strokes only get the stroke).
  var SUBJ_OPEN = { physiology: 1, pathology: 1, "forensic-medicine": 1, ent: 1, surgery: 1, dermatology: 1, anaesthesia: 1, "ss-rheumatology-immunology": 1, "ss-biostatistics": 1, "ss-medical-oncology": 1, "ss-endocrinology": 1, "obstetrics-gynaecology": 1, anatomy: 1, orthopaedics: 1 };
  function subjIco(id) {
    var p = SUBJ[id] || '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7"/>';
    return svg((SUBJ_OPEN[id] || !SUBJ[id] ? "" : '<g fill="currentColor" fill-opacity=".28" stroke="none">' + p + "</g>") + p, false, 24);
  }
  // A subject's tile hue (--h): a fixed categorical set, cycled in taxonomy order so neighbours never match.
  var HUES = [172, 212, 262, 334, 16, 34, 146, 192, 292, 230];
  function subjHue(id) { var k = Object.keys(SUBJ), i = k.indexOf(id); return HUES[(i < 0 ? 0 : i) % HUES.length]; }
  // A small progress ring with its figure inside (subject head, module panel, downloads). Drawn once on arrival (CSS).
  function mring(pct, label) {
    pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
    return '<span class="pn-mring" aria-hidden="true"><svg viewBox="0 0 44 44"><circle class="rt" cx="22" cy="22" r="18" pathLength="100"/>' + (pct > 0 ? '<circle class="rv" cx="22" cy="22" r="18" pathLength="100" stroke-dasharray="' + pct + ' 100"/>' : "") + "</svg><b>" + label + "</b></span>";
  }
  // A list screen's figure card (2026-10-10: plain card, no painted art): one large figure and its label, an optional
  // line under them. The art key stays as a class for older styles.
  function hband(art, fig, label, sub) {
    return '<section class="pn-hband pn-hb-' + art + '"><p class="pn-hbt"><b class="pn-hbn">' + fig + '</b> <span class="pn-hbl">' + label + "</span></p>" + (sub ? '<p class="pn-hbs">' + sub + "</p>" : "") + "</section>";
  }
  function bar(title, sub, left, right) {
    var isPN = title === "PrepNucleus";
    var tHtml = isPN
      ? '<h1 class="pn-t-brand"><img class="pn-bar-logo pn-lg-l" src="/prep/art/logo-mark-prussian-96.webp" alt="" width="24" height="24" decoding="async"><img class="pn-bar-logo pn-lg-d" src="/prep/art/logo-mark-amber-96.webp" alt="" width="24" height="24" decoding="async"><span>' + title + "</span></h1>"
      : "<h1>" + title + "</h1>";
    return '<header class="pn-bar' + (isPN ? " pn-bar-brand" : "") + '"><button type="button" class="pn-ib" data-act="' + (left || "back") + '" aria-label="' + (left === "close" ? "Close PrepNucleus" : "Back") + '">' + ico(left === "close" ? "close" : "back") + "</button>" +
      '<div class="pn-t">' + tHtml + (sub ? "<p>" + sub + "</p>" : "") + "</div>" + (right || '<span class="pn-ib-sp"></span>') + "</header>";
  }
  // Round 4: a navigation (push, back, a tab) marks the next paint so prep-motion.js can play the shared-axis slide or
  // the cross-fade on it. The mark lapses after 1.5 s, so an unrelated repaint later never slides.
  // A key press (Escape) never animates: it is repeated often and must feel instant.
  function nav(dir) { st.nav = st.navKey ? null : { d: dir, t: Date.now() }; }
  /* paint(html, focusSel): every screen draws through here. Mobile-native pass (2026-10-09), the cause of "the page
     jumps up when I tap": each paint replaced the whole overlay, so the scrolling body was new (scrollTop 0) and then
     focus() scrolled the focused element into view, a two-step jump on every tap that repaints in place (an answer, a
     bookmark, a tag, a filter). Now:
     - a repaint of the same screen keeps the body's scroll position (set before the frame is drawn, so no flash);
     - a push starts the new screen at the top; a pop returns to where that screen was left (kept per stack depth);
     - a new question (st.run.i changed) starts at the top; a tab or filter (nav 0) keeps the place when it can;
     - focus moves without scrolling (preventScroll);
     - a push or pop keeps the leaving body for one cross-fade (.pn-ghost), so the frame is never empty. */
  /* Native pass 2 (owner screen recording 2026-10-09, after OTA v244): a repaint of the same screen, and the setup sheet
     on every chip, still rebuilt the DOM. A rebuilt node is a new node: every inner scroller (a sideways chip row, a
     sheet's own body) restarts at 0, a pressed chip loses its :active state mid-press, images decode again, and WebKit
     relayouts the lot. morph(a, b) patches the live tree a to match the parsed tree b instead: same tag and id at the
     same place = the same node, its attributes and text updated in place; anything else is inserted or removed. Inputs
     keep what the student is typing (a focused field's value is never overwritten). PREP_DOM.on(el, site, type, fn)
     binds a listener once per element and site and swaps the handler on later calls, so code that wires a node after
     each paint keeps working when the node survives the patch. */
  function sameNode(x, y) {
    if (!x || !y || x.nodeType !== y.nodeType) return false;
    if (x.nodeType !== 1) return true;
    return x.nodeName === y.nodeName && (x.id || "") === (y.id || "") && x.getAttribute("data-key") === y.getAttribute("data-key");
  }
  function morphAttrs(a, b) {
    var i, n, ba = b.attributes, aa = a.attributes;
    for (i = aa.length - 1; i >= 0; i--) { n = aa[i].name; if (!b.hasAttribute(n)) a.removeAttribute(n); }
    for (i = 0; i < ba.length; i++) { n = ba[i]; if (a.getAttribute(n.name) !== n.value) a.setAttribute(n.name, n.value); }
    var tag = a.nodeName;
    if ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") && a !== D.activeElement) {
      if (tag === "TEXTAREA") { if (a.value !== b.value) a.value = b.value; }
      else if (tag === "INPUT" && (a.type === "checkbox" || a.type === "radio")) { if (a.checked !== b.hasAttribute("checked")) a.checked = b.hasAttribute("checked"); }
      else if (b.hasAttribute("value") && a.value !== b.getAttribute("value")) a.value = b.getAttribute("value");
    }
  }
  function morphKids(a, b) {
    var ac = a.firstChild, bc = b.firstChild, next, m;
    // Decoration added at run time (sparkles, confetti, balloons, the lessons' Learn button) carries __pnKeep: the patch
    // walks past it and never removes it, as the markup does not know it.
    var skip = function (n) { while (n && n.__pnKeep) n = n.nextSibling; return n; };
    while (bc) {
      next = bc.nextSibling;
      ac = skip(ac);
      if (!ac) { a.appendChild(bc); bc = next; continue; }
      if (sameNode(ac, bc)) { morphOne(ac, bc); ac = ac.nextSibling; bc = next; continue; }
      // An old node that is gone in the new tree (the next new node matches the one after it): drop it.
      if (sameNode(ac.nextSibling, bc) && !sameNode(ac, next)) { m = ac.nextSibling; a.removeChild(ac); ac = m; continue; }
      // A node with an id further on: move it here (keeps its state) rather than rebuild everything between.
      m = null;
      if (bc.nodeType === 1 && bc.id) for (var s = ac.nextSibling; s; s = s.nextSibling) if (s.nodeType === 1 && s.id === bc.id && sameNode(s, bc)) { m = s; break; }
      if (m) { a.insertBefore(m, ac); morphOne(m, bc); }
      else a.insertBefore(bc, ac);
      bc = next;
    }
    while (ac) { next = ac.nextSibling; if (!ac.__pnKeep) a.removeChild(ac); ac = next; }
  }
  function morphOne(a, b) {
    if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    morphAttrs(a, b);
    if (a.nodeName === "TEXTAREA") return;
    morphKids(a, b);
  }
  // patch(el, html): el's children become html, patched in place.
  function patchHtml(el, html) {
    var t = D.createElement(el.nodeName === "svg" ? "div" : el.nodeName);
    t.innerHTML = html;
    morphKids(el, t);
  }
  function onOnce(el, site, type, fn, opts) {
    if (!el) return;
    var k = "__pn_" + site + "_" + type;
    if (!el[k]) el.addEventListener(type, function (e) { var f = el[k]; if (f) return f.call(this, e); }, opts);
    el[k] = fn;
  }
  G.PREP_DOM = { patch: patchHtml, morph: morphKids, on: onOnce };
  function bodyOf(r) { return r ? r.querySelector(":scope > .pn-body") : null; }
  function screenKey() { var r = st.run; return st.stack.length + "|" + (r && !r.done && st.stack[st.stack.length - 1] === renderRun ? "q" + r.i : ""); }
  function paint(html, focusSel) {
    if (!root) return;
    var nv = st.nav; st.nav = null;
    var live = nv && Date.now() - nv.t < 1500 ? nv : null;
    var old = bodyOf(root), oldY = old ? old.scrollTop : 0, key = screenKey(), top = st.stack[st.stack.length - 1];
    if (!st.scr) st.scr = {};
    // Remember where the screen being left was (its depth before this paint).
    if (st.pk && old) st.scr[st.pk.depth] = { fn: st.pk.fn, y: oldY };
    var y = 0;
    if (live && live.d < 0) { var m = st.scr[st.stack.length]; y = m && m.fn === top ? m.y : 0; }
    else if (!live || live.d === 0) y = st.pk && st.pk.key === key ? oldY : 0;
    // A screen restored by back that first paints a short loading state: its next paint still goes to the kept place.
    if (st.want && st.want.key === key && Date.now() - st.want.t < 2000 && (!live || live.d === 0)) y = Math.max(y, st.want.y);
    var ghost = null;
    if (old && live && live.d !== 0 && !st.navKey) {
      // Outside the overlay (so the new screen's text, ids and queries are the only ones in #smdPrep), fixed over the
      // body's place, in the overlay's styles. Sizes in CSS px: the app may zoom html (text size), so divide by it.
      var ob = old.getBoundingClientRect(), z = (old.offsetWidth ? ob.width / old.offsetWidth : 1) || 1;
      ghost = D.createElement("div"); ghost.className = "pn-root pn-ghost"; ghost.setAttribute("aria-hidden", "true"); ghost.inert = true;
      ghost.style.cssText = "left:" + (ob.left / z) + "px;top:" + (ob.top / z) + "px;width:" + (ob.width / z) + "px;height:" + (ob.height / z) + "px";
      old.parentNode.removeChild(old);
      Array.prototype.forEach.call(old.querySelectorAll("[id]"), function (n) { n.removeAttribute("id"); });
      old.removeAttribute("id");
      ghost.appendChild(old);
    }
    // The same screen again (an answer, a tag, a filter, a toggle): patch it, so the body and every inner scroller keep
    // their place without being set back, and a pressed control stays the same node. A new screen is built afresh.
    var inPlace = !ghost && old && st.pk && st.pk.key === key && st.pk.fn === top && (!live || live.d === 0), keep = inPlace ? D.activeElement : null;
    if (inPlace) patchHtml(root, html); else root.innerHTML = html;
    var nb = bodyOf(root);
    // Patched: its scroll position never changed (and is not read here: no forced layout). Unless a screen restored by
    // back is still owed its kept place (its first paint was a short loading state).
    var owed = st.want && st.want.key === key && Date.now() - st.want.t < 2000;
    if (nb && nb === old && !owed) st.want = null;
    else {
      if (nb) { nb.scrollTop = y; if (y && nb.scrollTop < y - 1) settleScroll(nb, y); }
      st.want = nb && y && nb.scrollTop < y - 1 ? { key: key, y: y, t: Date.now() } : null;
    }
    st.pk = { key: key, depth: st.stack.length, fn: top };
    if (ghost) {
      D.body.appendChild(ghost); old.scrollTop = oldY;
      var gx = live.d > 0 ? -18 : 18, ga = null;
      try { ga = ghost.animate([{ opacity: 1, transform: "translateX(0px)" }, { opacity: 0, transform: "translateX(" + (reducedMo() ? 0 : gx) + "px)" }], { duration: reducedMo() ? 140 : 200, easing: "cubic-bezier(.23, 1, .32, 1)", fill: "forwards" }); } catch (e) {}
      var drop = function () { if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost); ghost = null; };
      if (ga) ga.onfinish = drop;
      G.setTimeout(drop, 450);
    }
    if (live && G.PREP_MOTION && G.PREP_MOTION.nav) { try { G.PREP_MOTION.nav(root, live.d); } catch (e) {} }
    // A patched screen keeps the focus where it was (the control just pressed is the same node).
    var f = focusSel ? root.querySelector(focusSel) : inPlace && keep && keep !== D.body && root.contains(keep) ? null : root.querySelector(".pn-bar .pn-ib");
    try { if (f) f.focus({ preventScroll: true }); } catch (e) {}
    lessonZoomToViewer();
    try { if (G.PREP_TIDE) G.PREP_TIDE.sync(root); } catch (e) {}
    try { if (G.PREP_NAV) G.PREP_NAV.sync(root); } catch (e) {}   // the floating tab bar (prep-nav.js)
  }
  function reducedMo() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  // A screen that fills in after its paint (a list read from storage) is not yet tall enough for the kept position:
  // try again on the next frames for up to 600 ms, and stop as soon as the student scrolls.
  function settleScroll(el, y) {
    var t0 = Date.now(), moved = false, mark = function () { moved = true; };
    el.addEventListener("touchstart", mark, { once: true, passive: true }); el.addEventListener("wheel", mark, { once: true, passive: true });
    (function again() {
      if (moved || !el.isConnected || Date.now() - t0 > 600) return;
      if (el.scrollTop < y - 1 && el.scrollHeight - el.clientHeight >= y - 1) { el.scrollTop = y; return; }
      if (el.scrollTop < y - 1) G.requestAnimationFrame(again);
    })();
  }
  /* The lesson reader (prep-lessons.js) draws its own enlarged image (.pn-zoom#pnZoom) inside the screen. It is shown in
     the one shared viewer (prep-viewer.js) instead; closing the viewer presses the lesson's own close, so the lesson's
     state stays its own. */
  function lessonZoomToViewer() {
    var z = root && root.querySelector(":scope > #pnZoom.pn-zoom, :scope > .pn-zoom#pnZoom");
    if (!z || !G.PREP_VIEWER || G.PREP_VIEWER.isOpen()) return;
    var im = z.querySelector("img"), cap = z.querySelector(".pn-zoom-top p");
    if (!im) return;
    z.hidden = true;
    var from = root.querySelector("[data-act=l-zoom]");
    G.PREP_VIEWER.open({ src: im.getAttribute("src"), alt: im.getAttribute("alt"), caption: cap ? cap.textContent : "", from: from,
      onClose: function () { var u = root && root.querySelector("#pnZoom [data-act=l-unzoom]"); if (u) u.click(); } });
  }
  function push(view) { st.stack.push(view); nav(1); view(); }
  function rerender() { var v = st.stack[st.stack.length - 1]; if (v) v(); }
  function back() {
    if (!st.open) return false;
    if (G.PREP_VIEWER && G.PREP_VIEWER.close()) return true;   // an enlarged image (prep-viewer.js) closes first
    if (G.PREP_IDS && G.PREP_IDS.back()) return true;   // the share sheet (prep-ids.js) closes first
    if (G.PREP_ASK && G.PREP_ASK.back()) return true;   // the Ask MaiK sheet (prep-ask.js) closes first
    if (G.PrepPro && G.PrepPro.back && G.PrepPro.back()) return true;   // PrepNucleus Pro: the limit sheet closes first
    if (G.PREP_SETUP && G.PREP_SETUP.back()) return true;   // the practice setup sheet (prep-setup.js)
    // Arena: a sheet closes first; a live battle asks before it is left.
    if (G.PREP_ARENA && G.PREP_ARENA.back && G.PREP_ARENA.back()) return true;
    if (G.PREP_FLASH && G.PREP_FLASH.back()) return true;
    // Lessons: a zoomed image closes first; leaving the reader stops the narration.
    if (G.PREP_LESSONS && G.PREP_LESSONS.back()) return true;
    // PYQ: an enlarged question image closes first.
    if (G.PREP_PYQ && G.PREP_PYQ.back()) return true;
    // Radiology: an enlarged image series closes first.
    if (G.PREP_RAD && G.PREP_RAD.back()) return true;
    // Plan: a readiness or settings sheet closes first; onboarding steps back.
    if (G.PREP_PLAN && G.PREP_PLAN.back()) return true;
    if (st.run && st.run.mode === "exam" && !st.run.done) { if (!G.confirm || G.confirm("Leave the test? Your answers in this test will be lost.")) { stopTimer(); st.run = null; } else return true; }
    stopTimer();
    if (st.stack.length > 1) { st.stack.pop(); nav(-1); rerender(); return true; }
    close(); return true;
  }

  function open(opts) {
    // A shared ID (deep link stewardmd://prep/<ID>) while PrepNucleus is already open: open it over the current screen.
    // Still loading (the taxonomy): kept for the first screen, which opens it.
    if (st.open) { if (opts && opts.id && G.PREP_IDS) { if (st.tax && st.stack.length) G.PREP_IDS.open(String(opts.id), HOST); else st.pendId = String(opts.id); } return true; }
    load();
    st.prevFocus = D.activeElement; st.prevOverflow = D.body.style.overflow;
    root = D.createElement("div"); root.id = "smdPrep"; root.className = "pn-root";
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "PrepNucleus");
    D.body.appendChild(root); D.body.style.overflow = "hidden";
    D.documentElement.classList.add("pn-open");   // prep.css: the document under the overlay never scrolls or rubber-bands
    try { if (G.PREP_MOTION) G.PREP_MOTION.attach(root); } catch (e) {}
    try { if (G.PREP_TIDE) G.PREP_TIDE.attach(root); } catch (e) {}
    try { if (G.PREP_NAV) G.PREP_NAV.attach(root, HOST); } catch (e) {}
    root.addEventListener("click", onClick);
    bindSheetDrag();
    // A sheet over the runner (Ask MaiK, share, the Pro limit) stops the per-question clock; closing it starts it again.
    try { new G.MutationObserver(function () { var r = st.run; if (r && r.qc && r.qc.used && !r.done) { syncClock(r); tlSync(r); } }).observe(root, { childList: true }); } catch (e) {}
    root.addEventListener("input", function (e) {
      if (!e.target || e.target.id !== "pnSearch") return;
      srch.q = e.target.value;
      if (srch.timer) G.clearTimeout(srch.timer);
      srch.timer = G.setTimeout(runSearch, 250);
    });
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); st.navKey = 1; try { back(); } finally { st.navKey = 0; } } else onRunKey(e); });
    st.open = true; st.stack = [];
    refreshHidden(); loadLines();
    // Reminder, widget, Live Activity and sync on open (prep-native.js).
    if (G.PREP_NATIVE) G.PREP_NATIVE.opened(HOST);
    // MaiK modules (prep-qgen.js): ask the server once whether the feature is on for this account (shows the entry rows).
    if (G.PREP_QGEN) G.PREP_QGEN.refresh(HOST);
    root.innerHTML = '<div class="pn-load" role="status">Loading PrepNucleus…</div>';
    st.pendId = opts && opts.id ? String(opts.id) : null;
    loadTax().then(function () {
      var pid = st.pendId; st.pendId = null;
      if (pid && G.PREP_IDS) { push(renderHome); G.PREP_IDS.open(pid, HOST); }
      else if (opts && opts.subject && subjectById(opts.subject)) { st.stack = [renderHome]; push(function () { renderSubject(opts.subject); }); }
      else if (opts && opts.mode === "mistakes") { st.stack = [renderHome]; mf.tag = "all"; push(renderMistakes); }
      else if (opts && opts.mode === "plan") { st.stack = [renderHome]; renderHome(); startPlan(); }
      else if (opts && opts.query) openQuery(opts);
      // A friends or boards nudge (server push, prep-nudges.js): home, then that tab.
      else if (opts && opts.social && G.PrepSocial) { push(renderHome); G.PrepSocial.open(String(opts.social)); }
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
      var n = Math.max(1, Math.min(50, Number(opts.n) || SESSION)), md = opts.mode === "exam" ? "exam" : "study";
      push(function () { renderSubject(hit.subject); });
      // With the mode sheet the deep link opens the module and the sheet, set to the asked count and mode.
      if (setupOn()) return openModule(hit.subject, hit.module, { n: n, mode: md });
      push(function () { renderModule(hit.subject, hit.module); });
      startModule(hit.subject, hit.module, md, n);
    });
  }
  function close() {
    stopTimer();
    try { if (G.PREP_ARENA && G.PREP_ARENA.leave) G.PREP_ARENA.leave(); } catch (e) {}
    try { if (G.PREP_LESSONS) G.PREP_LESSONS.leave(); } catch (e) {}
    try { if (G.PREP_PYQ) G.PREP_PYQ.leave(); } catch (e) {}
    try { if (G.PREP_RAD) G.PREP_RAD.leave(); } catch (e) {}
    try { if (G.PREP_PLAN) G.PREP_PLAN.leave(); } catch (e) {}
    try { if (G.PREP_FLASH) G.PREP_FLASH.leave(); } catch (e) {}
    try { if (G.PREP_SETUP) G.PREP_SETUP.leave(); } catch (e) {}
    try { if (G.PREP_ASK) G.PREP_ASK.leave(); } catch (e) {}
    try { if (G.PREP_IDS) G.PREP_IDS.leave(); } catch (e) {}
    try { if (G.PREP_MOTION) G.PREP_MOTION.detach(); } catch (e) {}
    try { if (G.PREP_TIDE) G.PREP_TIDE.detach(); } catch (e) {}
    try { if (G.PREP_NAV) G.PREP_NAV.detach(); } catch (e) {}
    try { if (G.PREP_VIEWER && G.PREP_VIEWER.isOpen()) G.PREP_VIEWER.close(); } catch (e) {}
    D.documentElement.classList.remove("pn-open");
    st.scr = {}; st.pk = null;
    st.open = false; st.run = null; st.stack = [];
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    D.body.style.overflow = st.prevOverflow;
    try { if (st.prevFocus && st.prevFocus.isConnected) st.prevFocus.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- home ---------- */
  function arenaOn() { return !!(G.PREP_ARENA && G.PREP_ARENA.enabled()); }
  // A row in a grouped list: icon, title, one line of detail, chevron.
  function row(act, icon, title, sub, attrs) {
    return '<button type="button" class="pn-row" data-act="' + act + '"' + (attrs || "") + '><span class="pn-ri" aria-hidden="true">' + icon + '</span><span class="pn-rb"><b>' + title + "</b><small>" + sub + "</small></span>" + ico("chev") + "</button>";
  }
  function renderHome() {
    var s = load(), ex = examOf(s.exam), subs = subjectsOf(s.exam), arena = arenaOn();
    // The exam is asked once (onboarding, prep-plan.js) and kept in the synced store; it changes only in Settings (the
    // plan sheet's Exam row), so home shows no exam switcher. Without prep-plan.js the old exam tabs stay.
    var plan = !!G.PREP_PLAN, choice = plan && s.pl && s.pl.exam && G.PREP_PLAN._pure.choiceOf(s.pl.exam), exLabel = choice && choice.tab === ex.id ? choice.label : ex.label;
    var tabs = plan ? "" : '<div class="pn-tabs" role="tablist" aria-label="Exam">' + EXAMS.map(function (e) {
      return '<button type="button" role="tab" class="pn-tab' + (e.id === ex.id ? " on" : "") + '" aria-selected="' + (e.id === ex.id) + '" data-act="exam" data-v="' + e.id + '">' + esc(e.label) + "</button>";
    }).join("") + "</div>";
    var nb = Object.keys(s.bm).length;
    // Back on home with every index already read: the subject rows and Solve next draw complete in the first paint, so
    // nothing above the kept scroll position grows after it is restored (no anchoring jump).
    var known = subs.every(function (sb) { return !!st.ix[sb.id]; }), nx0 = known ? solveNext(subs, st.ix, s, today(), s.exam) : null;
    var you = (G.PREP_ARENA ? row("a-stats", ico("stats"), "My stats", "Accuracy by subject, the last 30 days") : "") +
      (G.PrepSocial ? row("soc-open", ico("user"), "Friends and groups", "Challenge a friend, college boards") + row("soc-acc", ico("check"), "Accuracy", "Your public accuracy page") : "") +
      (plan ? row("p-settings", ico("gear"), "Settings", "Exam: " + esc(exLabel) + " · plan and reminder") : "");
    /* Quiet home (2026-10-10, owner brief): the brand is the mark and the name in the bar (no banner, no painted sky).
       Top down: readiness and days to the exam, today's next task and the rest of the plan, practice, subjects, then
       the secondary figures (streak, today, level) and Compete. */
    paint(bar("PrepNucleus", esc(exLabel), "close", '<button type="button" class="pn-ib" data-act="menu" aria-label="Menu">' + ico("menu") + "</button>") +
      tabs + '<div class="pn-body pn-home" id="pnHome">' +
      // Readiness and Today's plan (prep-plan.js); the older Today card without it.
      (G.PREP_PLAN ? G.PREP_PLAN.homeHtml(HOST) : '<h2 class="pn-h">Today</h2>' + planCard(s)) +
      // Question of the day (prep50): one bank question a day, the same for the whole day; drawn once the subject indexes
      // are read (below). Hidden offline when its module is not on this phone.
      (st.qotd && st.qotdDay === today() && st.qotdEx === s.exam ? '<section class="pn-qotd" id="pnQotd">' + qotdHtml(st.qotd) + "</section>" : '<section class="pn-qotd" id="pnQotd" hidden></section>') +
      '<h2 class="pn-h">Practise</h2>' +
      '<button type="button" class="pn-next" data-act="solvenext" id="pnNext"' + (nx0 ? ' data-s="' + esc(nx0.subject) + '" data-m="' + esc(nx0.module) + '"' : " hidden") + '><span class="pn-ri" aria-hidden="true">' + ico("target") + '</span><span class="pn-rb"><small>Solve next</small><b id="pnNextT">' + (nx0 ? esc(nextLabel(nx0)) : "") + "</b></span>" + ico("chev") + "</button>" +
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
      "</div>" +
      psHomeHtml(s) +
      '<h2 class="pn-h">Subjects</h2><div class="pn-subs" id="pnGrid">' + subs.map(function (sb) { return tile(sb, known ? st.ix[sb.id] : null); }).join("") + "</div>" +
      // Secondary: streak, today and level (prep-plan.js), then the student's own pages and settings.
      (G.PREP_PLAN && G.PREP_PLAN.progressHtml ? G.PREP_PLAN.progressHtml(HOST) : '<h2 class="pn-h">You</h2>') +
      (you ? '<div class="pn-group pn-you">' + you + "</div>" : "") +
      (arena ? '<h2 class="pn-h">Compete</h2><div id="pnCompete">' + G.PREP_ARENA.homeHtml(HOST) + "</div>" : "") +
      (G.PrepPro ? G.PrepPro.homeHtml(HOST) : "") +
      '<p class="pn-note">Practice and progress stay on this device.</p></div>');
    if (arena) G.PREP_ARENA.homeMounted(HOST);
    if (G.PrepPro) G.PrepPro.homeMounted(HOST);
    Promise.all(subs.map(function (sb) { return loadIndex(sb.id); })).then(function () {
      if (!st.open || st.stack[st.stack.length - 1] !== renderHome) return;
      var grid = root.querySelector("#pnGrid");
      if (grid) grid.innerHTML = subs.map(function (sb) { return tile(sb, st.ix[sb.id]); }).join("");
      var nx = solveNext(subs, st.ix, s, today(), s.exam), el = root.querySelector("#pnNext");
      if (G.PREP_PLAN) G.PREP_PLAN.homeMounted(HOST);
      if (nx && el) { el.hidden = false; el.setAttribute("data-s", nx.subject); el.setAttribute("data-m", nx.module); root.querySelector("#pnNextT").textContent = nextLabel(nx); }
      qotdMount(subs, s);
    });
  }
  /* ---------- question of the day (prep50) ----------
     One real bank question a day: the day picks a module of the exam's subjects already on this phone, the day
     again picks a usable text-only question in it. The same question all day on this phone; the answer is kept for the
     day (smd_prep_qotd, this device only) and goes through the normal runner, so it schedules review like any answer. */
  var QOTD_KEY = "smd_prep_qotd";
  function dayHash(d, salt) { var h = 2166136261 ^ salt; String(d).split("").forEach(function (c) { h = Math.imul(h ^ c.charCodeAt(0), 16777619); }); return h >>> 0; }
  function qotdState() { try { var v = JSON.parse(G.localStorage.getItem(QOTD_KEY) || "null"); return v && v.d === today() ? v : null; } catch (e) { return null; } }
  function qotdPick(subs, s) {
    var pool = [];
    subs.forEach(function (sb) { var ix = st.ix[sb.id]; if (ix) ix.topics.forEach(function (t) { if (t.group !== "mixed" && countFor(t, s.exam) > 0) pool.push({ s: sb.id, m: t.id }); }); });
    if (!pool.length) return Promise.resolve(null);
    var d = today(), hid = hidden(), pick = null;
    // Only modules already on this phone (opened or downloaded): no download for it, and it works offline.
    return Promise.resolve(cacheKeys()).then(null, function () { return null; }).then(function (keys) {
      var have = {}; (keys || []).forEach(function (k) { have[k] = 1; });
      var mine = pool.filter(function (x) { var p = modulePath(x.s, x.m); return have[p] || st.mem[p]; });
      if (!mine.length) return null;
      pick = mine[dayHash(d, 7) % mine.length];
      return loadModule(pick.s, pick.m);
    }).then(function (items) {
      if (!items) return null;
      var ok = (items || []).filter(function (it) {
        return usable(it, hid) && it.o && it.o.length === 4 && !(it.img && it.img.length) && !it._py && !/\b(image|shown|figure|photograph|picture|x-?ray below|graph)\b/i.test(it.q || "") &&
          !(G.PREP_RAD && G.PREP_RAD.figure(it, HOST));
      });
      return ok.length ? ok[dayHash(d, 13) % ok.length] : null;
    }).then(null, function () { return null; });
  }
  function qotdHtml(it) {
    var q = qotdState(), done = q && q.id === it.id ? q : null, L = ["A", "B", "C", "D"], sb = subjectById(it._s);
    return '<p class="pn-qd-h"><span class="pn-qd-dot" aria-hidden="true"></span>Question of the day<span class="pn-qd-s">' + (sb ? tx(sb.name) : "") + "</span></p>" +
      '<p class="pn-qd-q">' + esc(it.q) + "</p>" +
      '<ol class="pn-qd-o">' + it.o.map(function (o, k) {
        var c = done ? (k === it.a ? " right" : k === done.k ? " wrong" : "") : "";
        return '<li><button type="button" class="pn-qd-b' + c + '" data-act="' + (done ? "qotd-why" : "qotd") + '" data-k="' + k + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span></button></li>";
      }).join("") + "</ol>" +
      (done ? '<button type="button" class="pn-link pn-qd-more" data-act="qotd-why">' + (done.k === it.a ? "Correct. " : "Answer: " + L[it.a] + ". ") + "See the explanation " + ico("chev") + "</button>" : "");
  }
  function qotdMount(subs, s) {
    var box = root && root.querySelector("#pnQotd");
    if (!box) return;
    qotdPick(subs, s).then(function (it) {
      box = root && root.querySelector("#pnQotd");
      if (!box || !it || !st.open) return;
      st.qotd = it; st.qotdDay = today(); st.qotdEx = s.exam;
      patchHtml(box, qotdHtml(it)); box.hidden = false;
    });
  }
  // Answer from home: the question opens in the runner (study mode), already answered, so the verdict and the
  // explanation show at once and the answer is recorded the normal way.
  function qotdAnswer(k) {
    var it = st.qotd; if (!it) return;
    var q = qotdState(), prev = q && q.id === it.id ? q.k : -1;
    if (prev < 0 && k >= 0) { try { G.localStorage.setItem(QOTD_KEY, JSON.stringify({ d: today(), id: it.id, k: k })); } catch (e) {} }
    runQuestions([it], "study", "Question of the day");
    if (st.run && st.run.items[0] === it) {
      if (prev < 0 && k >= 0) answer(k);
      else if (prev >= 0) { st.run.ans[0] = prev; st.run.fresh = -1; renderRun(); }
    }
  }
  /* ---------- menu (prep50) ----------
     Everything PrepNucleus has outside the daily path, in one list from the home bar: the course (exam) and plan,
     Pro, downloads, stats, friends. Rows appear only for features that are loaded. */
  function renderMenu() {
    var s = load(), ex = examOf(s.exam), plan = !!G.PREP_PLAN, choice = plan && s.pl && s.pl.exam && G.PREP_PLAN._pure.choiceOf(s.pl.exam), exLabel = choice && choice.tab === ex.id ? choice.label : ex.label;
    var lv = levelN(xpOfStore(s)), rank = rankOf(lv);
    paint(bar("Menu", "", "back") + '<div class="pn-body pn-menu">' +
      '<section class="pn-me"><span class="pn-me-av" aria-hidden="true"><img src="/prep/art/logo-mark-prussian-96.webp" alt="" width="28" height="28" class="pn-lg-l"><img src="/prep/art/logo-mark-amber-96.webp" alt="" width="28" height="28" class="pn-lg-d"></span>' +
      '<span class="pn-tb"><b>' + esc(exLabel) + "</b><small>Level " + lv + " · " + esc(rank) + "</small></span></section>" +
      '<h2 class="pn-sec">Your course</h2><div class="pn-group">' +
      (plan ? row("p-settings", ico("gear"), "Exam and plan", "Exam: " + esc(exLabel) + " · daily goal and reminder") : "") +
      (G.PrepPro ? row("pro-open", ico("star"), "PrepNucleus Pro", "Your plan and what it includes") : "") +
      row("downloads", ico("dl"), "Offline downloads", "Subjects kept on this phone") +
      (G.PREP_IDS ? row("id-screen", ico("search"), "Open a shared ID", "A question or lesson a friend sent you") : "") +
      (G.PREP_QGEN && G.PREP_QGEN.canCreate() ? row("g-new", ico("bolt"), "Create a module with MaiK", G.PREP_QGEN.sub()) : "") +
      (G.PREP_QGEN && G.PREP_QGEN.isOwner() ? row("g-author", ico("gear"), "Author", "Owner only: write, check and stage new questions") : "") + "</div>" +
      '<h2 class="pn-sec">You</h2><div class="pn-group">' +
      (G.PREP_ARENA ? row("a-stats", ico("stats"), "My stats", "Accuracy by subject, the last 30 days, share your progress") : "") +
      row("bookmarks", ico("bm"), "Bookmarks", fmt(Object.keys(s.bm).length) + " saved") +
      row("mistakes", ico("x"), "My mistakes", fmt(Object.keys(s.mt).length) + " to fix") +
      (G.PrepSocial ? row("soc-open", ico("user"), "Friends and groups", "Challenge a friend, college boards") + row("soc-acc", ico("check"), "Accuracy", "Your public accuracy page") : "") + "</div>" +
      '<p class="pn-note">Practice and progress stay on this device.</p></div>');
  }
  function nextLabel(nx) { return (nx.title && nx.title.en) + (nx.why === "due" ? " · " + nx.n + " due" : ""); }
  function tile(sb, ix) {
    var s = load(), prog = progressByModule(s, today()), mods = ix ? ix.topics.filter(function (t) { return t.group !== "mixed"; }) : [], done = 0, total = mods.length, q = 0;
    mods.forEach(function (t) { var n = countFor(t, s.exam); q += n; if (n && statusOf((prog[t.id] || {}).answered, n) === "done") done++; });
    var pct = total ? Math.round(done * 100 / total) : 0;
    // Tide pass (prep50): a tile, the subject's icon on a disc ringed by its modules completed (the ring is the progress).
    return '<button type="button" class="pn-tile' + (total && done === total ? " full" : "") + '" data-act="subject" data-s="' + esc(sb.id) + '" style="--h:' + subjHue(sb.id) + '">' +
      '<span class="pn-disc" aria-hidden="true"><svg viewBox="0 0 48 48"><circle class="rt" cx="24" cy="24" r="22" pathLength="100"/>' + (pct > 0 ? '<circle class="rv" cx="24" cy="24" r="22" pathLength="100" stroke-dasharray="' + pct + ' 100"/>' : "") + "</svg>" +
      '<span class="pn-ic">' + subjIco(sb.id) + "</span></span>" +
      '<span class="pn-tb"><b>' + tx(sb.name) + "</b><small>" + (ix ? done + "/" + total + " modules" + "<br>" + (q ? fmt(q) + " MCQs" : "questions coming soon") : "&nbsp;") + "</small></span>" + "</button>";
  }

  /* ---------- subject ---------- */
  function renderSubject(sid) {
    var sb = subjectById(sid), s = load();
    st.sub = sid;
    var FILTERS = [["all", "All"], ["paused", "In progress"], ["done", "Completed"], ["new", "Unattempted"]];
    // Tide pass (prep50): the filters are one segmented control; its thumb slides to the chosen segment (--i).
    var fi = 0; FILTERS.forEach(function (f, i) { if (st.filter === f[0]) fi = i; });
    paint(bar(tx(sb.name), "", "back", '<button type="button" class="pn-ib" data-act="search" data-s="' + esc(sid) + '" aria-label="Search ' + tx(sb.name) + ' questions">' + ico("search") + "</button>") + '<div class="pn-filters pn-seg" role="group" aria-label="Show" style="--n:' + FILTERS.length + ";--i:" + fi + '"><span class="pn-seg-th" aria-hidden="true"></span>' + FILTERS.map(function (f) {
      return '<button type="button" class="pn-chip' + (st.filter === f[0] ? " on" : "") + '" aria-pressed="' + (st.filter === f[0]) + '" data-act="filter" data-v="' + f[0] + '">' + f[1] + "</button>";
    }).join("") + '</div><div class="pn-body" id="pnSub"><p class="pn-load" role="status">Loading modules…</p></div>');
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
      var mods = ix.topics.filter(function (t) { return t.group !== "mixed"; }), done = 0, q = 0, part = 0;
      mods.forEach(function (t) { var c = countFor(t, s.exam), k = c ? statusOf((prog[t.id] || {}).answered, c) : "new"; q += c; if (k === "done") done++; else if (k === "paused") part++; });
      // Round 4: the subject's own hero, tinted with its hue: the icon large, modules done, MCQs and reviews due, a ring.
      // Round 6: over the library art, with a map of the modules (completed, in progress, not started) as one bar.
      var due = 0; mods.forEach(function (t) { due += (prog[t.id] || {}).due || 0; });
      var dpct = mods.length ? Math.round(done * 100 / mods.length) : 0, nm = mods.length || 1;
      var seg = function (k, n) { return n ? '<i class="' + k + '" style="flex-grow:' + n + '"></i>' : ""; };
      var head = '<section class="pn-subhead" style="--h:' + subjHue(sid) + '"><div class="pn-subtop"><span class="pn-ic" aria-hidden="true">' + subjIco(sid) + "</span>" + mring(dpct, dpct + "%") + '</div><span class="pn-tb"><b>' + done + " of " + mods.length + " modules completed</b><small>" + (q ? fmt(q) + " MCQs" : "Questions coming soon") + (due ? " · " + fmt(due) + " due" : "") + "</small></span>" +
        (mods.length ? '<span class="pn-subbar pn-fills" aria-hidden="true">' + seg("d", done) + seg("p", part) + seg("n", nm - done - part) + '</span><span class="pn-subkey"><span><i class="d"></i>' + done + ' completed</span><span><i class="p"></i>' + part + ' in progress</span><span><i class="n"></i>' + (mods.length - done - part) + " not started</span></span>" : "") + "</section>";
      var mixed = ix.topics.filter(function (t) { return t.group === "mixed"; })[0];
      if (mixed && mixed.count && st.filter === "all") html += '<h2 class="pn-sec">More</h2><ol class="pn-mods">' + modRow(sid, mixed, prog, s, null) + "</ol>";
      var box = root.querySelector("#pnSub");
      // The subject's actions sit in one block in the same column as the hero and the module grid: Practise, then
      // Learn (prep-lessons.js, only when a module of this subject has a lesson), then "Start with last settings".
      var go = setupOn() && q ? '<button type="button" class="pn-btn pri pn-subgo" data-act="su-subject" data-s="' + esc(sid) + '">' + ico("play") + " Practise " + tx(sb.name) + "</button>" : "";
      var acts = go + lastBtn("subject", sid, ' data-s="' + esc(sid) + '"');
      if (box) patchHtml(box, head + '<div class="pn-subacts" id="pnSubActs"' + (acts ? "" : " hidden") + ">" + acts + "</div>" + (html || '<p class="pn-empty">Nothing in this filter yet.</p>'));
      if (G.PREP_LESSONS && G.PREP_LESSONS.subjectButton) G.PREP_LESSONS.subjectButton(box && box.querySelector("#pnSubActs"), sid, ix.topics, HOST);
    });
  }
  function modRow(sid, t, prog, s, num) {
    var n = countFor(t, s.exam), p = prog[t.id] || { answered: 0, due: 0 }, stt = statusOf(p.answered, n), sr = stars(s.mod[t.id]);
    var chip = stt === "done" ? '<span class="pn-st done">Completed</span>' : stt === "paused" ? '<span class="pn-st">' + fmt(Math.min(p.answered, n)) + "/" + fmt(n) + "</span>" : "";
    var line = n ? fmt(n) + " MCQs" : "Questions coming soon";
    return '<li class="pn-tl-' + stt + '"><button type="button" class="pn-mod" data-act="module" data-s="' + esc(sid) + '" data-m="' + esc(t.id) + '"' + (n ? "" : ' aria-disabled="true"') + ">" +
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
    var apct = n ? Math.min(100, Math.round(Math.min(p.answered, n) * 100 / n)) : 0;
    paint(bar(tx(t.title), tx(subjectById(sid).name), "back") + '<div class="pn-body"><div id="pnLsnSlot"></div><div id="pnCardSlot"></div><div id="pnPyqSlot"></div><section class="pn-panel pn-modp" id="pnModPanel" style="--h:' + subjHue(sid) + '">' +
      '<div class="pn-modh"><div class="pn-modt"><span class="pn-ic sm pn-modi" aria-hidden="true">' + subjIco(sid) + '</span><p class="pn-big">' + fmt(n) + ' MCQs</p><p class="pn-mut">' + fmt(Math.min(p.answered, n)) + " answered" + (sr != null ? " · mastery " + sr + "/5" : "") + (p.due ? " · " + fmt(p.due) + " due for review" : "") + "</p></div>" + mring(apct, apct + "%") + "</div>" +
      (setupOn() ?
        // Timer box (owner 2026-10-10): one Practise button opens the mode sheet (Learning or Test Mode, the timer, the
        // filters); "Review N due" opens it set to the questions due.
        '<button type="button" class="pn-btn pri" data-act="start" data-k="study">' + ico("play") + " Practise</button>" +
        (p.due ? '<button type="button" class="pn-btn" data-act="start" data-k="due">' + ico("clock") + " Review " + fmt(p.due) + " due</button>" : "") + lastBtn("module", mid) +
        '<p class="pn-mut pn-small">Learning Mode explains each answer before the next question. Test Mode marks everything at the end. Every answer schedules the question for spaced review.</p></section></div>'
      : (p.due ? '<button type="button" class="pn-btn pri" data-act="start" data-k="due">' + ico("play") + " Review " + fmt(p.due) + " due</button>" : "") +
      '<button type="button" class="pn-btn' + (p.due ? "" : " pri") + '" data-act="start" data-k="study">' + ico("play") + " Practice " + Math.min(SESSION, n) + " questions</button>" +
      '<button type="button" class="pn-btn" data-act="start" data-k="exam">' + ico("clock") + " Timed test: " + Math.min(SESSION, n) + " questions, " + Math.round(Math.min(SESSION, n) * ex.sec / 60) + " min</button>" +
      '<p class="pn-mut pn-small">Practice marks each answer at once with its explanation. A timed test marks everything at the end. Every answer schedules the question for spaced review.</p></section></div>'));
    st.cur = { s: sid, m: mid };
    if (G.PREP_LESSONS) G.PREP_LESSONS.mount(root.querySelector("#pnLsnSlot"), sid, mid, HOST);
    if (G.PREP_PYQ) G.PREP_PYQ.mount(root.querySelector("#pnPyqSlot"), sid, mid, HOST);
    if (G.PREP_FLASH) G.PREP_FLASH.mount(root.querySelector("#pnCardSlot"), sid, mid, HOST);
  }
  /* Opening a module (from Home, a subject in the Tests tab's QBank, Solve next, a deep link) shows the module and asks
     how to practise at once: the mode sheet over it (owner 2026-10-10: "each module when open should ask"). Closing the
     sheet leaves the module screen (lessons, cards, PYQs). A module with no questions opens without it. opts: { n, mode }. */
  function openModule(sid, mid, opts) {
    push(function () { renderModule(sid, mid); });
    var t = topicOf(sid, mid);
    if (setupOn() && t && countFor(t, load().exam) > 0 && st.cur && st.cur.m === mid) setupModule(sid, mid, null, opts);
  }
  function startModule(sid, mid, kind, n) {
    var s = load(), size = n || SESSION;
    paint(bar("Loading", "", "back") + '<div class="pn-body"><p class="pn-load" role="status">Loading questions…</p></div>');
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
  // opts (mock exams): { limit: seconds, scheme: {plus, minus, label} }. Practice setup (prep-setup.js): { limit } a clock for
  // the whole set in either mode, { qsec } a clock per question (qcNew: one budget a question, spent only while it is on
  // screen, never reset; when it runs out the question locks and the set moves on, in practice and in a timed test),
  // { untimed: true } a test with no clock. opts.custom (Arena events): { submit(run), render(run) }:
  // the runner neither marks nor records (the items carry no key); submit sends the answers and render draws the result.
  function runQuestions(items, mode, title, opts) {
    var ex = examOf(load().exam);
    opts = opts || {};
    // PrepNucleus Pro (prep-pro.js): the free tier is checked when a set starts, never mid-set. Arena runs (custom) are free.
    if (!opts.custom && G.PrepPro && !G.PrepPro.can("questions", { items: items })) { rerender(); return G.PrepPro.openLimit("questions"); }
    st.run = { m0: opts.custom ? null : snapNow(), items: items, i: 0, mode: mode, title: title, ans: items.map(function () { return -1; }), mark: {}, done: false, t0: Date.now(), limit: opts.untimed || opts.qsec ? 0 : opts.limit || (mode === "exam" ? items.length * ex.sec : 0), qsec: opts.qsec || 0, scheme: opts.scheme || null, custom: opts.custom || null };
    if (st.run.qsec) st.run.qc = qcNew(items.length, st.run.qsec);
    // A set made by the student (practice setup sheet, custom module) is saved when it finishes (psSave); a re-practise
    // of a whole saved set updates that set (psId).
    if (opts.save && !opts.custom) st.run.save = opts.save;
    if (opts.psId) st.run.psId = opts.psId;
    st.stack.push(renderRun);
    nav(1); renderRun();
    if (st.run.limit || st.run.qsec) startTimer();
  }
  // A clock per question ticks 4 times a second (the line's colour and the figure change on time; the line itself drains
  // on the compositor); a whole-set clock once a second.
  function startTimer() {
    stopTimer();
    st.timer = G.setInterval(runTick, st.run && st.run.qc ? 250 : 1000);
  }
  // The per-question clock reads a monotonic clock (SMD_PREP_NOW: a test clock).
  function pnow() { try { if (G.SMD_PREP_NOW) return G.SMD_PREP_NOW(); return G.performance && G.performance.now ? G.performance.now() : Date.now(); } catch (e) { return Date.now(); } }
  function runTick() {
      var r = st.run; if (!r || r.done) return stopTimer();
      if (r.qc) return qtick(r);
      var left = r.limit - (Date.now() - r.t0) / 1000, el = root && root.querySelector("#pnClock");
      if (el) { el.textContent = fmtTime(left); if (el.parentNode) el.parentNode.classList.toggle("over", (Date.now() - (r.qt0 || r.t0)) / 1000 > r.limit / r.items.length); }
      if (left <= 0) finish();
  }
  // Is a question open to answer? Not after its time ran out, and in practice not once answered.
  function qOpen(r, i) { return !(r.qc && r.qc.out[i]) && !(r.mode === "study" && r.ans[i] >= 0); }
  /* The per-question clock runs only for the question on screen: the runner on top of the stack, the question still open,
     the app in front and no sheet over the runner (Ask MaiK, share, the Pro limit: timer box rule, owner 2026-10-10). The
     question grid, a screen pushed over the runner, an answered Learning Mode question, the background and a locked
     screen all stop it, and nothing is lost: it resumes where it stopped. */
  function sheetUp() { return !!(root && root.querySelector(":scope > .pn-sheet-wrap")); }
  function docHidden() { try { return D.visibilityState === "hidden" || st.frozen; } catch (e) { return false; } }
  function syncClock(r) {
    if (!r || !r.qc || !r.qc.used) return;
    var now = pnow();
    if (!r.done && st.stack[st.stack.length - 1] === renderRun && qOpen(r, r.i) && !docHidden() && !sheetUp()) qcShow(r.qc, r.i, now); else qcPause(r.qc, now);
  }
  function qclockText(r, i) { return fmtTime(Math.ceil(qcLeft(r.qc, i, pnow()) / 1000)); }
  /* A clock per question: the figure and the line count this question's own budget down. At 0 the question locks.
     Test Mode records it unanswered at the end (as any blank) and moves to the next question that still has time; after
     the last one the test is marked. Learning Mode records it as not answered, shows the right answer and the
     explanation, and waits for Next (never moves by itself). Called 4 times a second and when the app comes back. */
  function qtick(r) {
    var x = qcTick(r.qc, pnow()), el = root && root.querySelector("#pnClock");
    syncClock(r);
    if (el && st.stack[st.stack.length - 1] === renderRun) el.textContent = qclockText(r, r.i);
    tlSync(r);
    if (x < 0) return;
    if (r.mode === "study") {
      if (!r.custom) record(r.items[x], -1);
      if (st.stack[st.stack.length - 1] === renderRun && r.i === x) { r.fresh = x; renderRun(); }
      return;
    }
    if (st.stack[st.stack.length - 1] !== renderRun || r.i !== x) return;
    var nx = qcAfter(r.qc, x);
    if (nx < 0) return finish();
    toast("Time up on question " + (x + 1) + ". Moved to question " + (nx + 1) + ".");
    r.i = nx; st.swipeIn = 1; renderRun();
  }
  /* The timer line (owner 2026-10-10): a thin line across the full width under the header, full at the start of the
     question's time and empty at 0, linear. It drains on the compositor (one Web Animation from the remaining fraction to
     0 over the remaining time), restarted from the clock at every pause, resume, new question or drift over 150 ms, so it
     never runs ahead of the clock. Over half left it is green, then amber, and red under 20%; the figure in the bar says
     the seconds, and a polite live region says "12 seconds left" once at 20% and at 10 s, and "Time up" at 0. Reduced
     motion: no drain animation, the line steps once a second with the figure. */
  function tlHtml(r) {
    if (!r.qc || !r.qc.used) return "";
    var c = r.qc, tot = c.sec * 1000, left = qcLeft(c, r.i, pnow()), lv = qcLevel(left, tot), s = Math.ceil(left / 1000);
    return '<div class="pn-tl" id="pnTl" data-lvl="' + lv + '" role="progressbar" aria-label="Time left for this question" aria-valuemin="0" aria-valuemax="' + c.sec + '" aria-valuenow="' + s + '" aria-valuetext="' + s + (s === 1 ? " second" : " seconds") + ' left"><i class="pn-tl-f" style="transform:scaleX(' + (tot ? left / tot : 0).toFixed(4) + ')"></i></div>' +
      '<span class="pn-sr" id="pnTlLive" aria-live="polite" aria-atomic="true"></span>';
  }
  function tlSync(r) {
    var el = root && root.querySelector("#pnTl");
    if (!el || !r || !r.qc || !r.qc.used) return;
    var c = r.qc, i = r.i, tot = c.sec * 1000, now = pnow(), left = qcLeft(c, i, now), lv = qcLevel(left, tot), s = Math.ceil(left / 1000), run = c.on === i;
    var ck = root.querySelector(".pn-qck");
    if (el.getAttribute("data-lvl") !== lv) el.setAttribute("data-lvl", lv);
    if (ck && ck.getAttribute("data-lvl") !== lv) ck.setAttribute("data-lvl", lv);
    if (el.getAttribute("aria-valuenow") !== String(s)) { el.setAttribute("aria-valuenow", s); el.setAttribute("aria-valuetext", s + (s === 1 ? " second" : " seconds") + " left"); }
    // Spoken once per question: entering the red, 10 s, time up.
    var said = r.tlSaid || (r.tlSaid = {}), k = "", msg = "";
    if (lv === "out") { k = i + ":0"; msg = "Time up"; }
    else if (run && left <= 10000 && left > 0 && tot > 10000) { k = i + ":10"; msg = "10 seconds left"; }
    else if (run && lv === "low") { k = i + ":low"; msg = s + " seconds left"; }
    if (k && !said[k]) { said[k] = 1; var lr = root.querySelector("#pnTlLive"); if (lr) lr.textContent = msg; }
    var f = el.firstChild; if (!f) return;
    var frac = tot ? left / tot : 0;
    if (reducedMo() || !f.animate) {
      if (f.__a) { try { f.__a.cancel(); } catch (e) {} f.__a = null; }
      f.style.transform = "scaleX(" + (tot ? Math.min(1, s * 1000 / tot) : 0).toFixed(4) + ")";
      return;
    }
    if (!run) {
      if (f.__a) { try { f.__a.cancel(); } catch (e) {} f.__a = null; }
      f.style.transform = "scaleX(" + frac.toFixed(4) + ")";
      return;
    }
    // Running: keep one animation going; restart it from the clock when the question changed, it was paused, or it drifted.
    // Drift: the animation's own progress against the clock's (both in ms since the animation started).
    var at = f.__a ? +f.__a.currentTime : NaN;
    if (f.__a && f.__q === i && f.__a.playState !== "idle" && isFinite(at) && Math.abs(at - (now - f.__t0)) <= 150) return;
    if (f.__a) { try { f.__a.cancel(); } catch (e) {} }
    f.style.transform = "scaleX(" + frac.toFixed(4) + ")";
    f.__q = i; f.__t0 = now; f.__l0 = left;
    try { f.__a = f.animate([{ transform: "scaleX(" + frac.toFixed(4) + ")" }, { transform: "scaleX(0)" }], { duration: Math.max(1, left), easing: "linear", fill: "forwards" }); } catch (e) { f.__a = null; }
  }
  // Away and back: the background, a locked screen, a frozen page stop the per-question clock; coming back starts it again
  // where it stopped (no time lost, none charged). A whole-set clock catches up from timestamps as before.
  function onAway(away) {
    var r = st.run;
    st.frozen = !!away;
    if (!r || r.done || !st.timer) return;
    if (r.qc && r.qc.used) { syncClock(r); tlSync(r); if (!st.frozen) qtick(r); return; }
    if (!st.frozen) runTick();
  }
  if (G.document && G.document.addEventListener) {
    G.document.addEventListener("visibilitychange", function () { onAway(G.document.visibilityState === "hidden"); });
    G.document.addEventListener("freeze", function () { onAway(true); });
    G.document.addEventListener("resume", function () { onAway(false); });
    if (G.addEventListener) { G.addEventListener("pagehide", function () { onAway(true); }); G.addEventListener("pageshow", function () { onAway(G.document.visibilityState === "hidden"); }); }
  }
  function stopTimer() { if (st.timer) { G.clearInterval(st.timer); st.timer = 0; } }
  // Owner rule (2026-10-07): no authorship or source line on questions; content credits live in the Terms and Privacy pages.
  // A previous-year question still names its paper (exam, year, memory-based recall), which is the paper type, not the origin.
  function provLine(it) { return it._py && G.PREP_PYQ ? G.PREP_PYQ.prov(it) : ""; }
  function provHtml(it) { var l = provLine(it); return l ? '<p class="pn-prov">' + l + "</p>" : ""; }
  /* Round 3 focus mode. The progress strip: one segment per question up to 30 (right, wrong or answered, the current one
     lit), a plain fill beyond that. The streak counts right answers in a row in this set, ending at the current question. */
  function runStreak(r) {
    var n = 0;
    if (r.mode !== "study") return 0;
    for (var i = r.i; i >= 0 && r.ans[i] >= 0 && r.ans[i] === r.items[i].a; i--) n++;
    return n;
  }
  function qprogHtml(r) {
    var n = r.items.length, done = r.ans.filter(function (a) { return a >= 0; }).length, sk = runStreak(r), segs;
    if (n <= 30) segs = r.items.map(function (it, i) {
      var c = i === r.i ? "cur" : "";
      if (r.ans[i] >= 0) c += r.mode === "study" ? (r.ans[i] === it.a ? " ok" : " no") : " ans";
      else if (r.mode === "study" && r.qc && r.qc.out[i]) c += " no";
      if (r.mark[i]) c += " mark";
      return "<i" + (c ? ' class="' + c.trim() + '"' : "") + "></i>";
    }).join("");
    else segs = '<i class="fill" style="transform:scaleX(' + (done / n).toFixed(3) + ')"></i>';
    return '<div class="pn-qprog' + (n > 30 ? " long" : "") + '"><div class="pn-qseg" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="' + n + '" aria-valuenow="' + done + '">' + segs + "</div>" +
      (sk >= 3 ? '<span class="pn-streak" data-n="' + sk + '">' + ico("bolt", true) + sk + " in a row</span>" : "") + (r.qc && r.qc.used ? clockHtml(r) : "") + "</div>";
  }
  // Timed mode: the clock sits in a pace ring that empties over this question's share of the time (limit / questions).
  // Per question: the ring empties over this question's own budget from where it stands, and holds still while the
  // clock is stopped (answered in practice, or locked).
  function clockHtml(r) {
    // Per question: the figure only (the line under the header is the picture of it).
    if (r.qc && r.qc.used) { var lft = qcLeft(r.qc, r.i, pnow()); return '<span class="pn-qck" data-lvl="' + qcLevel(lft, r.qc.sec * 1000) + '">' + svg(ICON.clock, false, 16) + '<span class="pn-clock" id="pnClock" aria-hidden="true">' + fmtTime(Math.ceil(lft / 1000)) + "</span></span>"; }
    var per, spent, run = true, txt;
    if (r.qc) { per = r.qsec; spent = per - qcLeft(r.qc, r.i, pnow()) / 1000; run = r.qc.on === r.i; txt = qclockText(r, r.i); }
    else { per = r.limit / r.items.length; spent = (Date.now() - (r.qt0 || r.t0)) / 1000; txt = fmtTime(r.limit - (Date.now() - r.t0) / 1000); }
    var over = r.qc ? r.qc.out[r.i] : spent > per;
    return '<span class="pn-clockw' + (over ? " over" : "") + '"><svg class="pn-pace" viewBox="0 0 40 40" aria-hidden="true"><circle class="rt" cx="20" cy="20" r="17" pathLength="100"/>' +
      '<circle class="rv" cx="20" cy="20" r="17" pathLength="100" style="animation-duration:' + Math.max(1, per).toFixed(1) + "s;animation-delay:-" + Math.max(0, Math.min(per, spent)).toFixed(1) + "s" + (run ? "" : ";animation-play-state:paused") + '"/></svg>' +
      '<span class="pn-clock" id="pnClock" role="timer" aria-live="off"' + (r.qc ? ' aria-label="Time left for this question ' + txt + '"' : "") + ">" + txt + "</span></span>";
  }
  /* The explanation under the answer: the key line and topic notes when the item has x, else its stored text (old "*"
     bullets made into a list), else a plain "not written yet" line. */
  function whyHtml(it, xo, why, L) {
    // images placed in the explanation (imgPlace "exp") follow the notes, with the same tap to enlarge
    var fig = G.PREP_PYQ ? G.PREP_PYQ.figure(it, HOST, "exp") : "";
    if (xo.x) return "<h3>Why " + L[it.a] + ' is right</h3><p class="pn-xkey">' + inlineMd(xo.x.key) + "</p>" + (xo.x.notes ? '<div class="pn-xnotes">' + mdLite(xo.x.notes) + "</div>" : "") + fig;
    if (why) return "<h3>" + (xo.r ? "Why " + L[it.a] + " is right" : "Explanation") + '</h3><div class="pn-exp">' + mdLite(legacyExp(why)) + "</div>" + fig;
    if (fig) return "<h3>Explanation</h3>" + fig;
    return '<p class="pn-mut">' + (it._py ? "Explanation coming soon." : "No explanation is stored for this question yet.") + "</p>";
  }
  function pearlHtml(it, xo) {
    var p = xo.x && xo.x.pearl ? xo.x.pearl : it.kp;
    return p ? '<aside class="pn-kp" aria-label="Remember"><b>Remember</b><span>' + inlineMd(p) + "</span></aside>" : "";
  }
  // The MaiK AI mark (maik-ai-mark.js, one SVG for every Ask MaiK entry); without it, the old avatar picture.
  function mkAv(size) { var M = G.SMD_MAIK_MARK, m = M ? M.html("tile", { size: size || 34 }) : ""; return '<span class="pt-av' + (m ? " mk" : "") + '" aria-hidden="true">' + m + "</span>"; }
  function askBtn(act, label, attrs) { return '<button type="button" class="pn-btn pa-ask" data-act="' + act + '"' + (attrs || "") + '>' + mkAv(32) + '<span>' + (G.SMD_MAIK_MARK ? G.SMD_MAIK_MARK.label(label) : label) + "</span></button>"; }
  function renderRun() {
    var r = st.run; if (!r) return;
    if (r.done) return r.custom ? r.custom.render(r) : renderResult();
    if (r.qi !== r.i) { r.qi = r.i; r.qt0 = Date.now(); }
    syncClock(r);
    var locked = !!(r.qc && r.qc.out[r.i]);
    // Learning Mode: an answer, or the time running out, shows the answer and the explanation.
    var it = r.items[r.i], chosen = r.ans[r.i], shown = r.mode === "study" && (chosen >= 0 || locked), s = load(), bm = !!s.bm[it.id], own = it._s === "deck";
    // PYQ items (prep-pyq.js) are not in a bank module file, so a bookmark could not reload them: no ribbon.
    var pyq = G.PREP_PYQ ? { tags: G.PREP_PYQ.chips(it, HOST), fig: G.PREP_PYQ.figure(it, HOST) } : { tags: "", fig: "" };
    // Radiology image series (prep-rad.js): the scroll stack sits under the image slot.
    if (G.PREP_RAD) pyq.fig += G.PREP_RAD.figure(it, HOST);
    var L = ["A", "B", "C", "D"];
    var opts = it.o.map(function (o, k) {
      var cls = "pn-opt";
      if (shown) { if (k === it.a) cls += " right"; else if (k === chosen) cls += " wrong"; }
      else if (k === chosen) cls += " sel";
      return '<li><button type="button" class="' + cls + '" data-act="answer" data-k="' + k + '"' + (locked ? " disabled" : shown ? ' aria-disabled="true"' : "") + ' aria-pressed="' + (k === chosen) + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span>" +
        (shown && k === it.a ? '<span class="pn-mark">' + ico("check") + "</span>" : shown && k === chosen ? '<span class="pn-mark">' + ico("x") + "</span>" : !shown && k === chosen ? '<span class="pn-mark pn-pick" aria-hidden="true">' + ico("check") + "</span>" : "") + "</button></li>";
    }).join("");
    // Your own deck's questions stay on this phone: no bookmark (bookmarks reload from the bank) and no report.
    // Study: bookmark and, once answered, report, as labelled icon buttons in the bar.
    // Share IDs (prep-ids.js): share in the bar, the ID itself under the question (tap copies). Not your own deck's items.
    var IDS = !own && G.PREP_IDS ? G.PREP_IDS : null, qid = IDS ? IDS.ofItem(it) : null;
    var acts = (qid ? IDS.shareBtn(qid) : "") + (own || it._py ? "" : '<button type="button" class="pn-ib' + (bm ? " on" : "") + '" data-act="bookmark" aria-pressed="' + bm + '" aria-label="' + (bm ? "Remove bookmark" : "Bookmark this question") + '">' + ico("bm", bm) + "</button>") +
      (shown && (!own || it.qg) ? '<button type="button" class="pn-ib" data-act="report" aria-label="Report this question">' + ico("flag") + "</button>" : "");
    // A clock per question shows its figure in the progress row, at the end of the line (the bar keeps the title room).
    var clk = r.limit || r.qsec ? (r.qc && r.qc.used ? "" : clockHtml(r)) : "";
    var right = r.mode === "exam" ? clk : acts || clk ? '<span class="pn-acts">' + clk + acts + "</span>" : "";
    var fb = "", revealFb = false;
    if (shown) {
      var ok = chosen === it.a, fresh = r.fresh === r.i, tup = chosen < 0;
      revealFb = fresh;
      r.fresh = -1;   // the reveal plays once, on the paint right after the answer (a bookmark or tag repaint keeps still)
      // Round 7: verdict, then the answer on its own line, then why it is right and, when the item carries a reason
      // per option (r: PYQ and deck items), why each other option is wrong, the student's pick first.
      var xo = explainOf(it), rs = xo.r, why = it.exp || (rs && rs[it.a]) || "";
      var others = rs ? it.o.map(function (o, k) { return k; }).filter(function (k) { return k !== it.a && rs[k] && String(rs[k]).trim(); }) : [];
      others.sort(function (x, y) { return (y === chosen) - (x === chosen) || x - y; });
      fb = '<section class="pn-fb ' + (ok ? "ok" : "no") + (fresh ? " pn-new" : "") + '" role="status" tabindex="-1">';
      fb += '<p class="pn-verdict' + (tup ? " pn-vtu" : "") + '"><span class="pn-vb" aria-hidden="true">' + ico(ok ? "check" : tup ? "clock" : "x") + "</span><span><b>" + (ok ? "Correct" : tup ? "Time up" : "Incorrect") + "</b>" + (ok ? "" : "<small>" + (tup ? "Not answered in time" : "You chose " + L[chosen]) + "</small>") + "</span></p>" +
        '<p class="pn-ans"><span class="pn-l">' + L[it.a] + '</span><span><small>Right answer</small>' + esc(it.o[it.a]) + "</span></p>" +
        whyHtml(it, xo, why, L) +
        (others.length ? "<h3>Why the others are wrong</h3><ul class=\"pn-why\">" + others.map(function (k) {
          return "<li" + (k === chosen ? ' class="mine"' : "") + '><span class="pn-l">' + L[k] + "</span><p><small>" + (k === chosen ? "Your pick: " : "") + esc(it.o[k]) + "</small><span>" + inlineMd(rs[k]) + "</span></p></li>";
        }).join("") + "</ul>" : "") +
        pearlHtml(it, xo) +
        (it.rv && it.rv.old ? '<p class="pn-old">This may be outdated: check current guidance.</p>' : "") +
        // Ask MaiK (prep-ask.js): on every answer, right or wrong, on this phone or online. Without prep-ask.js the
        // older offline-only button, shown only when MaiK runs on this phone.
        (G.PREP_ASK ? askBtn("ask", ok || tup ? "Ask MaiK why " + L[it.a] + " is right" : "Why is " + L[chosen] + " wrong? Ask MaiK") :
          !ok && !tup && G.PREP_TEACHER && G.PREP_TEACHER.ready && G.PREP_TEACHER.ready() ? '<button type="button" class="pn-btn" data-act="teach">Why is ' + L[chosen] + " wrong? Ask MaiK offline</button>" : "") +
        (!ok && !own ? '<div class="pn-mtag" role="group" aria-label="Why did you miss it?"><span class="pn-mut pn-small">Why did you miss it?</span><div class="pn-wrap">' + MISTAKE_TAGS.map(function (t) {
          var on = (s.mt[it.id] || [])[2] === t[0];
          return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="mtag" data-v="' + t[0] + '">' + t[1] + "</button>";
        }).join("") + "</div></div>" : "") +
        provHtml(it) + (it.qg && G.PREP_QGEN ? G.PREP_QGEN.provLine(it, HOST) : "") + (qid ? IDS.chip(qid) : "") + "</section>";
    }
    // Time up: the question stays locked for the rest of the set, answered or not.
    var lockNote = locked && !shown ? '<p class="pn-timeup" role="status">' + ico("lock") + "<span><b>Time up</b>" + (chosen >= 0 ? "Your answer " + L[chosen] + " is kept and can no longer be changed." : "This question can no longer be answered.") + "</span></p>" : "";
    var nav = r.mode === "exam" ?
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="prev"' + (r.i ? "" : " disabled") + ">Previous</button>" +
      '<button type="button" class="pn-btn' + (r.mark[r.i] ? " on" : "") + '" data-act="markq" aria-label="Mark for review" aria-pressed="' + !!r.mark[r.i] + '">' + ico("flag", !!r.mark[r.i]) + " Mark</button>" +
      (r.i < r.items.length - 1 ? '<button type="button" class="pn-btn pri" data-act="next">Next</button>' : '<button type="button" class="pn-btn pri" data-act="submit">Submit</button>') + "</div>" +
      '<button type="button" class="pn-link" data-act="qgrid">' + ico("grid") + " All questions · " + r.ans.filter(function (a) { return a >= 0; }).length + " of " + r.items.length + " answered</button>"
      : shown || locked ? '<div class="pn-navrow"><button type="button" class="pn-btn pri" data-act="next">' + (r.i < r.items.length - 1 ? "Next question" : "Finish") + " " + ico("next") + "</button></div>" : "";
    // A swipe arrives from the side it was thrown toward (shared axis); taps and keys change the question in place.
    var enter = st.swipeIn ? (st.swipeIn > 0 ? " in-r" : " in-l") : "";
    st.swipeIn = 0;
    paint(bar(esc(r.title), "Question " + (r.i + 1) + " of " + r.items.length, "back", right) + tlHtml(r) + qprogHtml(r) +
      '<div class="pn-body pn-run"><div class="pn-qw' + enter + '" id="pnQw">' + pyq.tags + '<p class="pn-q">' + esc(it.q) + "</p>" + pyq.fig + '<ol class="pn-opts" type="A">' + opts + "</ol>" + lockNote + (qid && !fb && r.mode !== "exam" ? IDS.chip(qid) : "") + fb + nav + "</div></div>", shown ? ".pn-fb" : ".pn-opt");
    if (revealFb) revealFeedback();
    tlSync(r);
    bindRunSwipe();
    if (G.PREP_RAD) G.PREP_RAD.mount(root);
  }
  /* A fresh answer: the page stays where the finger was. When the verdict card starts below the fold, the body glides
     just far enough to show its first lines (never up, never past the card's top), 280 ms, instant under reduced motion. */
  function revealFeedback() {
    var body = bodyOf(root), fbEl = body && body.querySelector(".pn-fb");
    if (!fbEl) return;
    var br = body.getBoundingClientRect(), fr = fbEl.getBoundingClientRect(), want = fr.top - br.top - Math.max(80, br.height * 0.45);
    if (fr.top < br.bottom - 120 || want <= 0) return;
    var to = Math.min(body.scrollTop + want, body.scrollHeight - body.clientHeight);
    try { body.scrollTo({ top: to, behavior: reducedMo() ? "auto" : "smooth" }); } catch (e) { body.scrollTop = to; }
  }
  /* Swipe (touch and pen; the mouse has the buttons): left goes to the next question once this one is answered (or any
     time in a timed test), right goes back in a timed test. The page follows the finger 1:1, resists where it cannot
     go, and settles back on a spring when the throw is short; a throw past 80 px or faster than 0.5 px/ms commits. */
  function canSwipe(dir) {
    var r = st.run; if (!r || r.done) return false;
    if (dir > 0) return r.mode === "exam" ? r.i < r.items.length - 1 : r.ans[r.i] >= 0 || !!(r.qc && r.qc.out[r.i]);
    return r.mode === "exam" && r.i > 0;
  }
  function bindRunSwipe() {
    var body = root && root.querySelector(".pn-run"), qw = body && body.querySelector("#pnQw");
    if (!qw) return;
    // Bound once per body (a patched repaint keeps the body); the question card is looked up at each press.
    if (body.__pnSwipe) return;
    body.__pnSwipe = 1;
    var x0 = 0, y0 = 0, t0 = 0, id = null, on = false, moved = false, dx = 0, vx = 0, lt = 0, lx = 0;
    body.addEventListener("pointerdown", function (e) {
      qw = body.querySelector("#pnQw") || qw;
      st.dragAt = 0;   // a new press is a new intent
      if (on || e.pointerType === "mouse" || e.clientX < 24 || (e.target.closest && e.target.closest(".pn-yq-fig,.pn-stack,.pn-mtag,.pn-wrap"))) return;
      on = true; moved = false; id = e.pointerId; x0 = lx = e.clientX; y0 = e.clientY; t0 = lt = Date.now(); dx = vx = 0;
    });
    body.addEventListener("pointermove", function (e) {
      if (!on || e.pointerId !== id) return;
      var mx = e.clientX - x0, my = e.clientY - y0, now = Date.now();
      if (!moved) { if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my)) { if (Math.abs(my) > 12) on = false; return; } moved = true; try { body.setPointerCapture(id); } catch (x) {} qw.classList.add("drag"); }
      // A direction that leads nowhere follows the finger with rising resistance.
      var dir = mx < 0 ? 1 : -1, w = body.clientWidth || 360;
      dx = canSwipe(dir) ? mx : (mx * w * 0.55) / (w + 0.55 * Math.abs(mx)) * 0.5;
      if (now > lt) { vx = (e.clientX - lx) / (now - lt); lx = e.clientX; lt = now; }
      qw.style.transform = "translateX(" + dx.toFixed(1) + "px)";
      qw.style.opacity = String(Math.max(0.55, 1 - Math.abs(dx) / 900));
    });
    var end = function (e) {
      if (!on || e.pointerId !== id) return;
      on = false;
      if (!moved) return;
      qw.classList.remove("drag");
      var dir = dx < 0 ? 1 : -1, fast = Math.abs(vx) > 0.5 && (vx < 0 ? 1 : -1) === dir;
      if (e.type === "pointerup" && canSwipe(dir) && (Math.abs(dx) > 80 || fast)) {
        st.swipeIn = dir;
        if (G.PREP_MOTION && G.PREP_MOTION.haptic) G.PREP_MOTION.haptic("light");
        if (dir > 0) { var r = st.run; if (r.i < r.items.length - 1) { r.i++; return renderRun(); } return finish(); }
        st.run.i--; return renderRun();
      }
      // Settle back from where the finger left it; the click that may end this drag is not an answer.
      st.dragAt = Date.now();
      if (!(G.PREP_MOTION && G.PREP_MOTION.settle && G.PREP_MOTION.settle(qw, "translateX(" + dx.toFixed(1) + "px)", "translateX(0px)"))) { qw.style.transform = ""; }
      qw.style.opacity = "";
    };
    body.addEventListener("pointerup", end);
    body.addEventListener("pointercancel", end);
  }
  /* Round 5: every sheet (.pn-sheet in a .pn-sheet-wrap: plan, readiness, reminder and sync, the Pro limit, the Arena
     consent) follows a finger down 1:1 and leaves past 30% of its height (at most 160 px) or on a downward flick
     (0.5 px/ms), continuing at the finger's speed; anything less springs back. Upward is a rubber band. The dismissal
     taps the sheet's own scrim, so each module closes it its own way (focus return included). Touch and pen only; a
     sheet scrolled into its content scrolls first; form fields never start a drag. Transform and opacity only. */
  function bindSheetDrag() {
    var g = null;
    var rm = function () { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
    var scrolled = function (t, sh) { for (var n = t; n && n !== sh.parentNode; n = n.parentNode) if (n.scrollTop > 0) return true; return false; };
    var put = function (d, y) {
      d.y = y; d.sh.style.transform = "translateY(" + y.toFixed(1) + "px)";
      if (d.scrim) d.scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - y / (d.h * 1.1))).toFixed(3));
    };
    root.addEventListener("pointerdown", function (e) {
      if (g || e.pointerType === "mouse" || !e.target.closest) return;
      var sh = e.target.closest(".pn-sheet-wrap > .pn-sheet");
      if (!sh || e.target.closest("input, select, textarea, label")) return;
      g = { sh: sh, id: e.pointerId, x0: e.clientX, y0: e.clientY, y: 0, v: 0, on: false, top: !!e.target.closest(".pn-grab") || !scrolled(e.target, sh), h: sh.offsetHeight || 400, t0: Date.now(), hist: [], scrim: sh.parentNode.querySelector(".pn-scrim") };
    });
    root.addEventListener("pointermove", function (e) {
      if (!g || e.pointerId !== g.id) return;
      var dy = e.clientY - g.y0, dx = e.clientX - g.x0, now = Date.now();
      if (!g.on) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (!g.top || dy < 0 || Math.abs(dx) > Math.abs(dy)) { g = null; return; }
        g.on = true; g.sh.classList.add("pn-drag");
        try { g.sh.setPointerCapture(g.id); } catch (x) {}
      }
      g.hist.push([now, e.clientY]); while (g.hist.length > 2 && now - g.hist[0][0] > 100) g.hist.shift();
      put(g, dy >= 0 ? dy : -(-dy * 0.55 * g.h) / (g.h + 0.55 * -dy) * 0.4);
    });
    // Without this the page would claim a downward drag at the top of a scrolling sheet as an overscroll. Native pass 2:
    // the non-passive touchmove sits on each sheet, not on the whole overlay. On iOS a non-passive touch listener makes
    // WebKit wait for JavaScript before every scroll it covers; on the root that was every screen, so a busy main thread
    // (a repaint, an image decode) made all scrolling stutter.
    var tm = function (e) {
      if (g && g.top && e.touches && e.touches.length === 1 && (g.on || e.touches[0].clientY > g.y0) && e.cancelable) e.preventDefault();
    };
    var arm = function (w) { if (w && w.nodeType === 1 && w.classList.contains("pn-sheet-wrap") && !w.__pnTouch) { w.__pnTouch = 1; w.addEventListener("touchmove", tm, { passive: false }); } };
    Array.prototype.forEach.call(root.querySelectorAll(":scope > .pn-sheet-wrap"), arm);
    if (G.MutationObserver) new G.MutationObserver(function (ms) { ms.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, arm); }); }).observe(root, { childList: true });
    var end = function (e) {
      if (!g || e.pointerId !== g.id) return;
      var d = g; g = null;
      if (!d.on) return;
      st.sheetDragAt = Date.now(); d.sh.classList.remove("pn-drag");
      // Release speed over the last 100 ms of movement; a window under 16 ms is too short to trust, so the whole drag.
      var h0 = d.hist[0], h1 = d.hist[d.hist.length - 1], now = Date.now();
      d.v = h0 && h1[0] - h0[0] >= 16 ? (h1[1] - h0[1]) / (h1[0] - h0[0]) : d.y / Math.max(16, now - d.t0);
      var close = function () { if (d.scrim && d.scrim.isConnected) d.scrim.click(); };
      if (e.type === "pointerup" && d.y > 0 && (d.y > Math.min(160, d.h * 0.3) || d.v > 0.5)) {
        if (G.PREP_MOTION && G.PREP_MOTION.haptic) G.PREP_MOTION.haptic("light");
        if (rm() || !d.sh.animate) return close();
        var ms = Math.round(Math.max(140, Math.min(260, (d.h - d.y) / Math.max(d.v, 1.4)))), a;
        try {
          a = d.sh.animate([{ transform: "translateY(" + d.y.toFixed(1) + "px)" }, { transform: "translateY(100%)" }], { duration: ms, easing: "cubic-bezier(.32, .72, 0, 1)", fill: "forwards" });
          if (d.scrim) d.scrim.animate([{ opacity: d.scrim.style.opacity || 1 }, { opacity: 0 }], { duration: ms, easing: "ease-out", fill: "forwards" });
        } catch (x) { return close(); }
        var once = function () { if (once.done) return; once.done = 1; close(); };
        a.onfinish = once; G.setTimeout(once, ms + 80);
        return;
      }
      var from = "translateY(" + d.y.toFixed(1) + "px)";
      if (d.scrim) d.scrim.style.opacity = "";
      if (!(G.PREP_MOTION && G.PREP_MOTION.settle && G.PREP_MOTION.settle(d.sh, from, "translateY(0px)"))) d.sh.style.transform = "";
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
  }
  // Keys on a tablet or laptop: A to D (or 1 to 4) answer, Enter or the right arrow goes on, the left arrow goes back in a
  // timed test. No motion for keys.
  function onRunKey(e) {
    var r = st.run;
    if (!r || r.done || st.stack[st.stack.length - 1] !== renderRun || e.ctrlKey || e.metaKey || e.altKey) return;
    if (root && root.querySelector(".pn-sheet-wrap")) return;   // a sheet over the runner keeps the keys
    var t = e.target, tag = t && t.tagName, k = String(e.key || "").toLowerCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
    var idx = "abcd".indexOf(k); if (idx < 0 && /^[1-4]$/.test(k)) idx = Number(k) - 1;
    // B answers option B until the question is answered; after that (practice) it bookmarks, below.
    if (idx >= 0 && idx < r.items[r.i].o.length && !(k === "b" && r.mode === "study" && r.ans[r.i] >= 0)) {
      if (r.mode === "study" && r.ans[r.i] >= 0) return;
      e.preventDefault(); st.kb = true; answer(idx); st.kb = false; return;
    }
    if ((k === "enter" && !(t && t.closest && t.closest("button"))) || k === "arrowright") {
      if (!canSwipe(1) && !(r.mode === "study" && (r.ans[r.i] >= 0 || (r.qc && r.qc.out[r.i])))) return;
      e.preventDefault(); st.kb = true;
      if (r.i < r.items.length - 1) { r.i++; renderRun(); } else if (r.mode === "study") finish();
      st.kb = false; return;
    }
    if (k === "arrowleft" && canSwipe(-1)) { e.preventDefault(); r.i--; renderRun(); return; }
    // B bookmarks (bank questions), G opens the question grid in a timed test.
    if (k === "b" && !(r.items[r.i]._s === "deck" || r.items[r.i]._py)) { e.preventDefault(); toggleBookmark(); return; }
    if (k === "g" && r.mode === "exam") { e.preventDefault(); openGrid(); }
  }
  function record(it, chosen) {
    var s = load(), ok = chosen === it.a, td = today(), dk = deckKey(it._m || it.t);
    C.review(s, dk, it.id, C.gradeFor(ok), td);
    C.recordAnswer(s, dk, String(it.a), String(chosen));
    if (G.PrepPro) G.PrepPro.use("questions", { items: [it] });
    var ms = s.mod[it._m || it.t] || (s.mod[it._m || it.t] = { t: 0, ok: 0 });
    ms.t++; if (ok) ms.ok++; ms.last = td;
    s.last = { s: it._s, m: it._m || it.t };
    // Answer log for readiness accuracy (prep-plan.js): [module, 1|0], newest last.
    if (G.PREP_PLAN) G.PREP_PLAN.noteAnswer(s, it._m || it.t, ok);
    if (G.PREP_NUDGES) G.PREP_NUDGES.studied();
    if (G.PREP_NATIVE) G.PREP_NATIVE.changed();
    // Mistakes (bank questions only; a deck's questions live in Layer C storage): kept until answered right.
    // PYQ items live in their paper, not a module file, so My mistakes (which reloads modules) leaves them out.
    if (it._s !== "deck" && !it._py) { if (ok) delete s.mt[it.id]; else s.mt[it.id] = [it._s, it._m || it.t, (s.mt[it.id] || [])[2] || null, Date.now(), String(it.q || "").slice(0, 140)]; }
    save();
  }
  function answer(k) {
    var r = st.run; if (!r || r.done) return;
    if (r.qc) { var i0 = r.i; qtick(r); if (r.done || r.i !== i0 || r.qc.out[i0]) return; }   // the time ran out first: no answer after it
    if (r.mode === "study") { if (r.ans[r.i] >= 0) return; r.ans[r.i] = k; r.fresh = st.kb ? -1 : r.i; record(r.items[r.i], k); }
    else r.ans[r.i] = k;
    renderRun();
  }
  function finish() {
    var r = st.run; if (!r || r.done) return;
    stopTimer();
    // Submitted from the question grid (or timed out there): drop the grid so the results sit on the runner's entry.
    while (st.stack.length && st.stack[st.stack.length - 1] !== renderRun) st.stack.pop();
    r.done = true; r.secs = Math.round((Date.now() - r.t0) / 1000);
    // A clock per question: the time taken is the time the questions were on screen (pauses left out).
    if (r.qc && r.qc.used) { qcPause(r.qc, pnow()); r.secs = Math.round(r.qc.used.reduce(function (a, b) { return a + b; }, 0) / 1000); }
    if (r.custom) return r.custom.submit(r);
    if (r.qc) qcPause(r.qc, pnow());
    if (r.mode === "exam") r.items.forEach(function (it, i) { if (r.ans[i] >= 0) record(it, r.ans[i]); else record(it, -1); });
    if (r.save || r.psId) psSave(r);
    if (r.scheme) { var sc = scoreMock(r.items, r.ans, r.scheme), s = load(); s.mh = (s.mh || []).concat([{ ts: Date.now(), label: r.title, marks: sc.marks, max: sc.max, n: r.items.length }]).slice(-20); save(); }
    if (!st.kb) nav(1);   // the result arrives like a pushed screen (a key finish stays still)
    renderResult();
    if (G.PREP_NATIVE) G.PREP_NATIVE.finished();
  }
  // Timer box (2026-10-10): the time a question took on average and how many ran out, when the set had a clock per question.
  function tstatHtml(r) {
    var x = r.qc && !r.saved ? qcStats(r.qc) : null;
    if (!x || !x.n) return "";
    return '<p class="pn-tstat"><span><b>' + x.avg + " s</b> average a question</span><span><b>" + x.out + "</b> timed out (" + r.qsec + "\u00a0s each)</span></p>";
  }
  // Round 7: the set at a glance under the score, one mark a question in order (up to 30): right, missed, not answered.
  function recapHtml(r) {
    var n = r.items.length; if (n < 2 || n > 30) return "";
    var ok = 0, no = 0;
    var marks = r.items.map(function (it, i) { var c = r.ans[i] < 0 ? "skip" : r.ans[i] === it.a ? "ok" : "no"; if (c === "ok") ok++; else no++; return '<i class="' + c + '"></i>'; }).join("");
    return '<div class="pn-recap" role="img" aria-label="' + ok + " right, " + no + ' missed, in question order">' + marks + "</div>";
  }
  /* ---------- celebrations and MaiK lines ---------- */
  function snapNow() { var s = load(); var sk = 0; try { sk = C.streak ? C.streak(s, today()) : 0; } catch (e) {} return mileSnap(s, sk); }
  // The milestone a finish crossed (once, on the first paint of that result): { key, label, big } or null. Records it.
  function celeFor(m0, holder) {
    if (holder.cele !== undefined) return holder.cele;
    var s = load(), m = milestone(m0, snapNow(), s.cel, today());
    if (m) { noteCele(s, m, today()); save(); }
    return (holder.cele = m);
  }
  function celeAttrs(m) { return m ? ' data-cele="balloons"' + (m.big ? ' data-big="' + m.big + '"' : "") : ""; }
  function celeChip(m) { return m ? '<p class="pn-mile"><span>' + esc(m.label) + "</span></p>" : ""; }
  var ML_SS = "smd_prep_ml_shown";
  function lineShown() { if (st.mlShown) return true; try { return G.sessionStorage.getItem(ML_SS) === "1"; } catch (e) { return false; } }
  /* maikLine(ids, holder) -> HTML: one line per app session, the next one for that subject each time. holder keeps the
     chosen line so a repaint of the same result shows it again. */
  function maikLine(ids, holder) {
    if (holder.ml !== undefined) return holder.ml;
    holder.ml = "";
    if (lineShown() || !st.lines) return "";
    var s = load(), ml = s.ml && typeof s.ml === "object" ? s.ml : (s.ml = {});
    ids.branch = ids.branch || examOf(s.exam).branch;
    var probe = pickLine(st.lines, ids, 0); if (!probe) return "";
    var pick = pickLine(st.lines, ids, ml[probe.key] || 0);
    ml[probe.key] = (ml[probe.key] || 0) + 1; save();
    st.mlShown = true; try { G.sessionStorage.setItem(ML_SS, "1"); } catch (e) {}
    return (holder.ml = '<p class="pn-maikline" role="status">' + mkAv(32) + '<span>' + esc(pick.text) + "</span></p>");
  }
  /* Review every question of the set under a filter (All, Wrong, Correct, Skipped or Time up, Bookmarked), with counts;
     Wrong first when there is any. A filter with nothing in it stays visible but disabled. */
  var RV_LIST_MAX = 200;
  function reviewHtml(r) {
    var sp = reviewSplit(r.items, r.ans, r.qc && r.qc.out, load().bm), f = r.rf && sp[r.rf] ? r.rf : (r.rf = reviewDefault(sp));
    var skipL = sp.out.length ? (sp.out.length === sp.skip.length ? "Time up" : "Skipped or time up") : "Skipped";
    var F = [["all", "All"], ["wrong", "Wrong"], ["right", "Correct"], ["skip", skipL], ["bm", "Bookmarked"]];
    var list = sp[f].slice(0, RV_LIST_MAX);
    return '<h2 class="pn-sec" id="pnRvH">Review</h2><div class="pn-filters pn-rvf" role="group" aria-labelledby="pnRvH">' + F.map(function (x) {
      var n = sp[x[0]].length, on = x[0] === f;
      return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="rfilter" data-v="' + x[0] + '"' + (n || on ? "" : " disabled") + ">" + x[1] + ' <span class="pn-rvn">' + n + "</span></button>";
    }).join("") + "</div>" +
      (list.length ? '<ol class="pn-missed" aria-live="polite">' + list.map(function (i) {
        var it = r.items[i], a = r.ans[i], to = !!(r.qc && r.qc.out && r.qc.out[i]);
        var st0 = a >= 0 ? (a === it.a ? "Right" : "You chose " + esc(it.o[a])) : to ? "Time ran out, not answered" : "Not answered";
        var cls = a >= 0 ? (a === it.a ? "ok" : "no") : "skip";
        return '<li><button type="button" class="pn-mod pn-rv-' + cls + '" data-act="reviewq" data-i="' + i + '"><span class="pn-rvq" aria-hidden="true">' + (i + 1) + '</span><span class="pn-mb"><b><span class="pn-sr">' + (i + 1) + ". </span>" + esc(it.q.length > 120 ? it.q.slice(0, 119) + "…" : it.q) + "</b><small>" + st0 + " · answer: " + esc(it.o[it.a]) + "</small></span>" + ico("chev") + "</button></li>";
      }).join("") + "</ol>" : '<p class="pn-mut">Nothing here.</p>');
  }
  function psExpiry(e) { var d = psDaysLeft(e, Date.now()); return d <= 1 ? "Expires within a day" : "Expires in " + d + " days"; }
  // Keep a finished set the student made (ids and answers only). A re-practise of a whole saved set updates it in place.
  function psSave(r) {
    var s = load(), now = Date.now(), e = psPack(r.items, r.ans, r.qc && r.qc.out, { title: r.title, kind: r.save, mode: r.mode }, now);
    if (!e) return;
    s.ps = s.ps || {};
    var old = r.psId && s.ps[r.psId];
    if (old && old.n === e.n) { e.c = old.c; e.x = old.x; e.t = old.t; e.k = old.k; s.ps[r.psId] = e; }
    else { r.psId = "s" + now.toString(36) + Math.floor(Math.random() * 1296).toString(36); s.ps[r.psId] = e; }
    psCap(s.ps, PS_MAX);
    save();
  }
  // Reopen a saved set on its result: every question reloads from its module file by id.
  function openSet(id) {
    var s = load(), e = s.ps[id];
    if (!e || !(e.x > Date.now())) { toast("This practice set has expired."); return rerender(); }
    st.stack.push(function () {}); loadingScreen(esc(e.t), "Loading your set…");
    var pairs = e.m.map(function (k) { var p = k.split("|"); return { s: p[0], m: p[1] }; });
    loadMany(pairs, stepMsg).then(function (lists) {
      var by = {}; lists.forEach(function (l) { by[l.s + "|" + l.m] = l.items; });
      var u = psUnpack(e, by);
      st.stack.pop();
      if (!u.items.length) { toast("The questions of this set did not load. Check the connection and try again."); return rerender(); }
      st.run = { m0: null, items: u.items, i: 0, mode: e.md, title: e.t, ans: u.ans, mark: {}, done: true, t0: e.f, secs: 0, limit: 0, qsec: 0, scheme: null, custom: null, psId: id, saved: true,
        qc: u.out.some(Boolean) ? { sec: 0, rem: [], out: u.out, on: -1, at: 0 } : null, cele: null, ml: "" };
      st.stack.push(renderRun); nav(1); renderRun();
    });
  }
  function psHomeHtml(s) {
    var L = psList(s.ps, Date.now());
    if (!L.length) return "";
    return '<p class="pn-eb" aria-hidden="true">Kept for 7 days</p><h2 class="pn-h">Your practice sets</h2><div class="pn-group" id="pnSets">' + L.slice(0, 6).map(function (x) {
      var e = x.e;
      return row("psopen", ico("clock"), esc(e.t) + " · " + dayMonth(e.c), e.n + (e.n === 1 ? " question" : " questions") + " · " + e.ok + " right · " + psExpiry(e), ' data-id="' + esc(x.id) + '"');
    }).join("") + "</div>";
  }
  function renderResult() {
    var r = st.run, ok = 0, missed = [];
    r.items.forEach(function (it, i) { if (r.ans[i] === it.a) ok++; else missed.push(i); });
    var pct = r.items.length ? Math.round(ok * 100 / r.items.length) : 0;
    var cele = r.m0 ? celeFor(r.m0, r) : null, answered = r.ans.filter(function (a) { return a >= 0; }).length;
    var line = !r.scheme && answered >= 5 ? maikLine({ subject: setSubject(r.items, subjectById) }, r) : "";
    paint(bar(r.mode === "exam" ? "Test marked" : "Set finished", esc(r.title), "back") + '<div class="pn-body">' + (r.scheme ? mockAnalysis(r, cele) : '<section class="pn-panel pn-score"' + celeAttrs(cele) + ">" + celeChip(cele) +
      '<div class="pn-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="rt" cx="60" cy="60" r="52" pathLength="100"/>' + (pct > 0 ? '<circle class="rv" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="' + pct + ' 100"/>' : "") + '</svg>' +
      '<p class="pn-big">' + ok + " / " + r.items.length + '</p></div><p class="pn-mut">' + pct + "% right" + (r.mode === "exam" && !r.saved ? " · " + fmtTime(r.secs) + " taken" : "") + "</p>" + tstatHtml(r) + recapHtml(r) + "</section>" + splitHtml(r) + selfCurveHtml(pct, r)) + line +
      reviewHtml(r) +
      '<div class="pn-navrow pn-again">' + (missed.length ? '<button type="button" class="pn-btn" data-act="retrymissed">' + (missed.length === r.items.length ? "Practise again" : "Practise the missed (" + missed.length + ")") + "</button>" : "") +
      (missed.length < r.items.length ? '<button type="button" class="pn-btn" data-act="retryall">Practise all again (' + r.items.length + ")</button>" : "") +
      '<button type="button" class="pn-btn pri" data-act="donerun">Done</button></div>' +
      (r.psId && load().ps[r.psId] ? '<p class="pn-mut pn-small">Saved in Your practice sets. ' + psExpiry(load().ps[r.psId]) + ".</p>" : "") +
      '<p class="pn-mut pn-small">Missed questions come back sooner for review; ones you got right come back just before you would forget them.</p></div>');
  }
  /* Tide pass (prep50). The set split: one bar, right / wrong / not answered, with counts and shares. */
  function splitHtml(r) {
    var n = r.items.length; if (!n) return "";
    var ok = 0, no = 0, sk = 0;
    r.items.forEach(function (it, i) { if (r.ans[i] < 0) sk++; else if (r.ans[i] === it.a) ok++; else no++; });
    var pc = function (x) { return Math.round(x * 1000 / n) / 10; };
    var seg = function (k, x) { return x ? '<i class="' + k + '" style="flex-grow:' + x + '"></i>' : ""; };
    return '<section class="pn-split" aria-label="' + ok + " right, " + no + " wrong, " + sk + ' not answered"><span class="pn-split-bar pn-fills" aria-hidden="true">' + seg("ok", ok) + seg("no", no) + seg("sk", sk) + "</span>" +
      '<span class="pn-split-key" aria-hidden="true"><span><i class="ok"></i>' + ok + " right (" + pc(ok) + "%)</span><span><i class=\"no\"></i>" + no + " wrong (" + pc(no) + "%)</span><span><i class=\"sk\"></i>" + sk + " not answered (" + pc(sk) + "%)</span></span></section>";
  }
  /* Where this set sits among the student's own modules: the spread of their accuracy across every module answered at
     least 5 times (a smoothed curve), this set marked on it. Their own history only; no other students' data exists. */
  // The share of the student's module accuracies strictly below this set's (0 to 100, whole percent).
  function selfShare(acc, pct) { return acc.length ? Math.round(acc.filter(function (a) { return a < pct; }).length * 100 / acc.length) : 0; }
  function selfCurveHtml(pct, r) {
    if (r.items.length < 5) return "";
    var s = load(), acc = [];
    Object.keys(s.mod || {}).forEach(function (k) { var m = s.mod[k]; if (m && m.t >= 5) acc.push(m.ok * 100 / m.t); });
    if (acc.length < 5) return "";
    var share = selfShare(acc, pct);
    var W = 300, H = 92, ys = [], max = 0, bw = 9;
    for (var x = 0; x <= 100; x += 2) { var y = 0; acc.forEach(function (a) { var z = (x - a) / bw; y += Math.exp(-0.5 * z * z); }); ys.push(y); if (y > max) max = y; }
    var pt = function (i) { return (i * 2 * W / 100).toFixed(1) + "," + (H - 4 - ys[i] / max * (H - 12)).toFixed(1); };
    var line = ys.map(function (y, i) { return (i ? "L" : "M") + pt(i); }).join(""), area = line + "L" + W + "," + H + "L0," + H + "Z", px = (pct * W / 100).toFixed(1);
    return '<section class="pn-self"><p class="pn-sec">This set among your modules</p>' +
      '<svg class="pn-self-c" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + pct + "% right, better than " + share + "% of your " + acc.length + ' modules"><defs><clipPath id="pnSelfL"><rect x="0" y="0" width="' + px + '" height="' + H + '"/></clipPath></defs>' +
      '<path class="a0" d="' + area + '"/><path class="a1" d="' + area + '" clip-path="url(#pnSelfL)"/><path class="ln" d="' + line + '"/><line class="mk" x1="' + px + '" x2="' + px + '" y1="6" y2="' + H + '"/></svg>' +
      '<p class="pn-self-t">Higher than <b>' + share + "%</b> of your modules</p>" +
      '<p class="pn-mut pn-small">From your own answers in ' + acc.length + " modules (5 or more answers each), on this device.</p></section>";
  }
  function reviewQuestion(i) {
    var r = st.run, it = r.items[i];
    st.stack.push(function () {
      var L = ["A", "B", "C", "D"];
      var rid = G.PREP_IDS && it._s !== "deck" ? G.PREP_IDS.ofItem(it) : null;
      var tu = r.qc && r.qc.out[i] ? '<p class="pn-timeup">' + ico("lock") + "<span><b>Time ran out</b>" + (r.ans[i] >= 0 ? "Your answer was kept." : "Not answered.") + "</span></p>" : "";
      paint(bar("Review", esc(r.title), "back", rid ? G.PREP_IDS.shareBtn(rid) : "") + '<div class="pn-body pn-run">' + tu + (G.PREP_PYQ ? G.PREP_PYQ.chips(it, HOST) : "") + '<p class="pn-q">' + esc(it.q) + "</p>" + (G.PREP_PYQ ? G.PREP_PYQ.figure(it, HOST) : "") + (G.PREP_RAD ? G.PREP_RAD.figure(it, HOST) : "") + '<ol class="pn-opts">' + it.o.map(function (o, k) {
        return '<li><div class="pn-opt' + (k === it.a ? " right" : k === r.ans[i] ? " wrong" : "") + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span></div></li>";
      }).join("") + '</ol><section class="pn-fb">' + (function () {
        var xo = explainOf(it), others = xo.r ? it.o.map(function (o, k) { return k; }).filter(function (k) { return k !== it.a && String(xo.r[k] || "").trim(); }) : [];
        return whyHtml(it, xo, it.exp || (xo.r && xo.r[it.a]) || "", L) + (others.length ? '<h3>Why the others are wrong</h3><ul class="pn-why">' + others.map(function (k) {
          return "<li" + (k === r.ans[i] ? ' class="mine"' : "") + '><span class="pn-l">' + L[k] + "</span><p><small>" + (k === r.ans[i] ? "Your pick: " : "") + esc(it.o[k]) + "</small><span>" + inlineMd(xo.r[k]) + "</span></p></li>";
        }).join("") + "</ul>" : "") + pearlHtml(it, xo) + (G.PREP_ASK ? askBtn("ask-rv", r.ans[i] >= 0 && r.ans[i] !== it.a ? "Why is " + L[r.ans[i]] + " wrong? Ask MaiK" : "Ask MaiK why " + L[it.a] + " is right", ' data-i="' + i + '"') : "");
      })() + provHtml(it) + "</section>" + (rid ? G.PREP_IDS.chip(rid) : "") + "</div>");
      if (G.PREP_RAD) G.PREP_RAD.mount(root);
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
  function stepMsg(d, n) { var el = root && root.querySelector("#pnLoadMsg"); if (el) el.textContent = "Loading questions: " + d + " of " + n + " modules…"; }
  // Today's set: due reviews from the modules with the most due (up to 6 files), then adaptive new questions from
  // "solve next" to reach the day's goal, 20 at a time.
  function startPlan() {
    var s = load(), td = today(), p = planToday(s, td), hid = hidden();
    st.stack.push(function () {}); loadingScreen("Today", "Loading questions…");
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
    st.stack.push(function () {}); loadingScreen("Weak areas", "Loading questions…");
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
    var top = MISTAKE_TAGS.filter(function (t) { return c[t[0]]; }).sort(function (a, b) { return c[b[0]] - c[a[0]]; })[0];
    paint(bar("My mistakes", fmt(c.all) + " to fix", "back") + '<div class="pn-body pn-mtl">' + (c.all ?
      hband("mt", fmt(c.all), c.all === 1 ? "question to fix" : "questions to fix", top ? "Most often: " + esc(top[1].toLowerCase()) + " (" + c[top[0]] + ")." : "Tag each one in the runner to see a pattern.") +
      '<div class="pn-wrap pn-scroll" role="group" aria-label="Filter by reason">' + chips + '</div><button type="button" class="pn-btn pri" data-act="mpractice"' + (ids.length ? "" : " disabled") + ">" + ico("play") + (setupOn() ? " Practise these" : " Practise these " + Math.min(ids.length, 50)) + "</button>" + (ids.length ? lastBtn("mistakes", mf.tag) : "") +
      '<ul class="pn-mods">' + ids.slice(0, 100).map(function (id) { var b = s.mt[id], t = topicOf(b[0], b[1]); return '<li><div class="pn-mod static pn-mx"' + (b[2] ? ' data-tag="' + esc(b[2]) + '"' : "") + '><span class="pn-ri" aria-hidden="true">' + ico("x") + '</span><span class="pn-mb"><b>' + esc(b[4]) + "</b><small>" + (t ? tx(t.title) : esc(b[1])) + (b[2] ? " · " + esc(tagLabel(b[2])) : "") + "</small></span></div></li>"; }).join("") + "</ul>" +
      '<p class="pn-mut pn-small">A question leaves this list when you answer it right.</p>'
      : '<p class="pn-empty pn-art-mt">No mistakes to fix. Questions you get wrong collect here.</p>') + "</div>");
    var subs = {}; Object.keys(s.mt).forEach(function (id) { subs[s.mt[id][0]] = 1; }); Object.keys(subs).forEach(function (sid) { loadIndex(sid); });
  }
  function tagLabel(t) { for (var i = 0; i < MISTAKE_TAGS.length; i++) if (MISTAKE_TAGS[i][0] === t) return MISTAKE_TAGS[i][1]; return ""; }
  function practiceMistakes() {
    var s = load(), hid = hidden(), ids = Object.keys(s.mt).filter(function (id) { return mf.tag === "all" || (mf.tag === "untagged" ? !s.mt[id][2] : s.mt[id][2] === mf.tag); }).slice(0, 50), pairs = [], seen = {};
    ids.forEach(function (id) { var b = s.mt[id]; if (!seen[b[1]]) { seen[b[1]] = 1; pairs.push({ s: b[0], m: b[1] }); } });
    var want = {}; ids.forEach(function (id) { want[id] = 1; });
    st.stack.push(function () {}); loadingScreen("My mistakes", "Loading questions…");
    loadMany(pairs.slice(0, 12), stepMsg).then(function (lists) {
      var out = []; lists.forEach(function (l) { l.items.forEach(function (it) { if (want[it.id] && usable(it, hid)) out.push(it); }); });
      st.stack.pop();
      if (!out.length) { toast("These questions need a connection to load once."); return rerender(); }
      runQuestions(shuffle(out), "study", "My mistakes");
    });
  }

  /* ---------- Phase 5: mock exams ---------- */
  /* The Tests tab (owner 2026-10-10: "Test menu should contain both Tests and QBank modules (all subjects)"): one screen,
     a segmented control on top. Tests = the mock exams with the previous year papers row (NEET-PG). QBank = every subject
     of the exam as the same tiles as Home (progress ring, modules done, MCQs), with Custom module, Bookmarks and My
     mistakes; a subject opens its modules and a module asks how to practise. The last section is remembered on this
     device (smd_prep_tt); Mock exam on Home always opens Tests. */
  var TT_KEY = "smd_prep_tt";
  function ttGet() { if (st.tt) return st.tt; try { var v = G.localStorage.getItem(TT_KEY); return (st.tt = v === "qbank" ? "qbank" : "tests"); } catch (e) { return (st.tt = "tests"); } }
  function ttSet(v) { st.tt = v === "qbank" ? "qbank" : "tests"; try { G.localStorage.setItem(TT_KEY, st.tt); } catch (e) {} }
  function renderMocks() {
    var s = load(), sec = ttGet(), q = sec === "qbank", subs = subjectsOf(s.exam);
    var SEC = [["tests", "Tests"], ["qbank", "QBank"]];
    var segHtml = '<div class="pn-filters pn-seg pn-ttseg" role="group" aria-label="Show" style="--n:2;--i:' + (q ? 1 : 0) + '"><span class="pn-seg-th" aria-hidden="true"></span>' + SEC.map(function (x) {
      return '<button type="button" class="pn-chip' + (sec === x[0] ? " on" : "") + '" aria-pressed="' + (sec === x[0]) + '" data-act="tt" data-v="' + x[0] + '">' + x[1] + "</button>";
    }).join("") + "</div>";
    var body;
    if (!q) {
      var list = MOCKS[s.exam] || MOCKS["neet-pg"];
      // The previous year papers row (NEET-PG) sits on top.
      var pyq = G.PREP_PYQ && s.exam === "neet-pg" ? '<div class="pn-group">' + G.PREP_PYQ.homeRow(HOST) + "</div>" : "";
      body = '<div class="pn-banner pn-art-mock" aria-hidden="true"></div>' + pyq + list.map(function (m) {
        var mini = Math.min(50, m.n), part = m.parts ? m.n / m.parts : 0;
        return '<section class="pn-panel"><p class="pn-big pn-mid">' + esc(m.label) + '</p><p class="pn-mut">' + m.n + " questions" + (part ? " in " + m.parts + " parts of " + part + ", " + fmtMin(m.min / m.parts) + " each" : ", " + fmtMin(m.min)) + ". Right +" + fmtMark(m.plus) + (m.minus ? ", wrong minus " + fmtMark(m.minus) : ", no negative marking") + ", unanswered 0." + (m.pass ? " Pass mark " + m.pass + " of " + m.n * m.plus + "." : "") + "</p>" +
          (part ? '<button type="button" class="pn-btn pri" data-act="mock" data-v="' + m.id + '" data-k="part">' + ico("clock") + " One part: " + part + " questions, " + fmtMin(m.min / m.parts) + "</button>"
            : '<button type="button" class="pn-btn pri" data-act="mock" data-v="' + m.id + '" data-k="full">' + ico("clock") + " Full mock: " + m.n + " questions</button>") +
          (mini < m.n ? '<button type="button" class="pn-btn" data-act="mock" data-v="' + m.id + '" data-k="mini">' + ico("clock") + " Mini mock: " + mini + " questions, " + fmtMin(Math.round(m.min * mini / m.n)) + "</button>" : "") + "</section>";
      }).join("") + '<p class="pn-mut pn-small">Questions are drawn across every subject of the exam in proportion to the bank. Patterns follow the published bulletins; check the current one before your exam.</p>';
    } else {
      var known = subs.every(function (sb) { return !!st.ix[sb.id]; });
      body = '<div class="pn-group">' + row("custom", ico("plus"), "Custom module", "Your own mix of subjects and count") +
        (G.PREP_QGEN && G.PREP_QGEN.canCreate() ? row("g-new", ico("bolt"), "Create a module with MaiK", G.PREP_QGEN.sub()) : "") +
        row("bookmarks", ico("bm"), "Bookmarks", fmt(Object.keys(s.bm).length) + " saved") +
        row("mistakes", ico("x"), "My mistakes", fmt(Object.keys(s.mt).length) + " to fix") + "</div>" +
        '<h2 class="pn-h">Subjects</h2><p class="pn-mut pn-small pn-qbs" id="pnQbS">' + qbSummary(subs, known) + '</p><div class="pn-subs" id="pnGrid">' + subs.map(function (sb) { return tile(sb, known ? st.ix[sb.id] : null); }).join("") + "</div>";
    }
    paint(bar("Tests", examOf(s.exam).label, "back") + segHtml + '<div class="pn-body pn-mocks' + (q ? " pn-qbank" : "") + '" id="pnTests">' + body + "</div>");
    if (q) Promise.all(subs.map(function (sb) { return loadIndex(sb.id); })).then(function () {
      if (!st.open || st.stack[st.stack.length - 1] !== renderMocks || ttGet() !== "qbank") return;
      var grid = root.querySelector("#pnGrid"), sm = root.querySelector("#pnQbS");
      if (grid) patchHtml(grid, subs.map(function (sb) { return tile(sb, st.ix[sb.id]); }).join(""));
      if (sm) sm.textContent = qbSummary(subs, true);
    });
  }
  // "19 subjects · 147,310 MCQs" once the subject indexes are read.
  function qbSummary(subs, known) {
    if (!known) return subs.length + (subs.length === 1 ? " subject" : " subjects");
    var q = 0, e = load().exam; subs.forEach(function (sb) { (st.ix[sb.id].topics || []).forEach(function (t) { if (t.group !== "mixed") q += countFor(t, e); }); });
    return subs.length + (subs.length === 1 ? " subject" : " subjects") + " · " + fmt(q) + " MCQs";
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
  function mockAnalysis(r, cele) {
    var sc = scoreMock(r.items, r.ans, r.scheme), rows = Object.keys(sc.bySubject).map(function (sid) { var b = sc.bySubject[sid], sb = subjectById(sid); return { sid: sid, sb: sb, name: sb ? tx(sb.name) : "Not sorted into a subject yet", n: b.n, right: b.right, wrong: b.wrong, pct: b.n ? Math.round(b.right * 100 / b.n) : 0 }; });
    rows.sort(function (a, b) { return a.pct - b.pct; });
    return '<section class="pn-panel pn-score"' + celeAttrs(cele) + ">" + celeChip(cele) + '<p class="pn-big">' + fmtMark(sc.marks) + " / " + sc.max + '</p><p class="pn-mut">' + sc.right + " right · " + sc.wrong + " wrong · " + sc.blank + " unanswered · " + fmtTime(r.secs) + " taken</p>" +
      (r.scheme.pass ? '<p class="pn-mut pn-small">Pass mark in the exam: ' + Math.round(r.scheme.pass * 100) + "% of the maximum. This set: " + (sc.max ? Math.round(Math.max(0, sc.marks) * 100 / sc.max) : 0) + "%.</p>" : "") + "</section>" +
      '<h2 class="pn-sec">By subject, weakest first</h2><ul class="pn-mods">' + rows.map(function (x) {
        // A previous-year question not yet sorted into a subject (_s "pyq") has no subject screen to open.
        var inner = '<span class="pn-mb"><b>' + x.name + "</b><small>" + x.right + " of " + x.n + " right · " + x.wrong + ' wrong</small><span class="pn-meter' + (x.pct >= 70 ? " ok" : x.pct < 40 ? " low" : "") + '" aria-hidden="true"><i style="transform:scaleX(' + (x.pct / 100) + ')"></i></span></span><span class="pn-st' + (x.pct >= 70 ? " done" : "") + '">' + x.pct + "%</span>";
        return x.sb ? '<li><button type="button" class="pn-mod" data-act="subject" data-s="' + esc(x.sid) + '">' + inner + "</button></li>" : '<li><div class="pn-mod static">' + inner + "</div></li>";
      }).join("") + "</ul>";
  }

  /* ---------- search ---------- */
  var srch = { sid: null, q: "", timer: 0 };
  function renderSearch() {
    var sb = subjectById(srch.sid);
    paint(bar("Search", tx(sb.name), "back") + '<div class="pn-body"><label class="pn-sl" for="pnSearch"><span class="pn-mut pn-small">Words from the question or its options</span>' +
      '<span class="pn-srch">' + ico("search") + '<input id="pnSearch" class="pn-in" type="search" autocomplete="off" enterkeyhint="search" value="' + esc(srch.q) + '"></span></label>' + (G.PREP_IDS ? G.PREP_IDS.searchExtra() : "") + '<div id="pnHits" aria-live="polite">' +
      (srch.q ? "" : '<p class="pn-empty pn-art-sc pn-hint">Search every question in ' + tx(sb.name) + ' by a word from its stem or options.</p>') + "</div></div>", "#pnSearch");
    if (srch.q) runSearch();
  }
  function runSearch() {
    var box = root && root.querySelector("#pnHits"), q = srch.q, sid = srch.sid, BANK = G.SPECIALTY && G.SPECIALTY.BANK;
    if (!box) return;
    // A shared ID (prep-ids.js) typed or pasted here opens that question or lesson, from any subject.
    var idh = G.PREP_IDS ? G.PREP_IDS.searchHtml(q) : null;
    if (idh) { box.innerHTML = idh; return; }
    if (q.trim().length < 3) { box.innerHTML = q.trim() ? '<p class="pn-mut pn-small">Type at least 3 letters.</p>' : '<p class="pn-empty pn-art-sc pn-hint">Search every question by a word from its stem or options.</p>'; return; }
    if (!BANK) { box.innerHTML = '<p class="pn-err">Search did not load. Close and open PrepNucleus again.</p>'; return; }
    box.innerHTML = '<p class="pn-load" role="status">Searching…</p>';
    loadSearch(sid).then(function (sx) {
      if (srch.q !== q || !root) return;
      var hid = hidden(), hits = BANK.searchIndex(sx, q, 60).filter(function (h) { return !hid[h.id]; }).slice(0, 40);
      var el = root.querySelector("#pnHits"); if (!el) return;
      el.innerHTML = hits.length ? '<p class="pn-mut pn-small">' + hits.length + (hits.length === 40 ? "+" : "") + " found</p><ul class=\"pn-mods\">" + hits.map(function (h) {
        var t = topicOf(sid, h.t);
        return '<li><button type="button" class="pn-mod" data-act="hit" data-m="' + esc(h.t) + '" data-i="' + esc(h.id) + '"><span class="pn-ic sm" style="--h:' + subjHue(sid) + '" aria-hidden="true">' + ico("search") + '</span><span class="pn-mb"><b>' + hl(esc(h.p), q) + "</b><small>" + (t ? tx(t.title) : "") + "</small></span>" + ico("chev") + "</button></li>";
      }).join("") + "</ul>" : '<p class="pn-empty pn-art-sc">No question matches. Try fewer or other words.</p>';
    }, function () {
      var el = root && root.querySelector("#pnHits");
      if (el) el.innerHTML = '<p class="pn-err" role="alert">Search needs a connection the first time for each subject.</p>';
    });
  }
  // Round 6: the words that matched light up in each hit (on the escaped text, never inside an entity).
  function hl(html, q) {
    var w = String(q).toLowerCase().split(/[^a-z0-9]+/).filter(function (x) { return x.length >= 3; });
    if (!w.length) return html;
    var re = new RegExp("(" + w.join("|") + ")", "gi");
    return html.split(/(&[#a-z0-9]+;)/i).map(function (part) { return /^&[#a-z0-9]+;$/i.test(part) ? part : part.replace(re, "<mark>$1</mark>"); }).join("");
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
    var nbs = {}; ids.forEach(function (id) { nbs[s.bm[id][0]] = 1; }); nbs = Object.keys(nbs).length;
    paint(bar("Bookmarks", fmt(ids.length) + " saved", "back") + '<div class="pn-body pn-bml">' + (ids.length ?
      hband("bm", fmt(ids.length), ids.length === 1 ? "question saved" : "questions saved", "From " + Object.keys(by).length + (Object.keys(by).length === 1 ? " module" : " modules") + " in " + nbs + (nbs === 1 ? " subject" : " subjects") + ". Practise them as one set.") +
      '<button type="button" class="pn-btn pri" data-act="practicebm">' + ico("play") + (setupOn() ? " Practise bookmarks" : " Practise all bookmarks") + "</button>" + lastBtn("bookmarks", "") +
      '<ul class="pn-mods">' + Object.keys(by).map(function (k) { var p = k.split("|"), t = topicOf(p[0], p[1]), sb = subjectById(p[0]); var last = 0; by[k].forEach(function (id) { last = Math.max(last, +s.bm[id][2] || 0); }); return '<li><div class="pn-mod static"><span class="pn-ic sm" style="--h:' + subjHue(p[0]) + '" aria-hidden="true">' + subjIco(p[0]) + '</span><span class="pn-mb"><b>' + (t ? tx(t.title) : esc(p[1])) + "</b><small>" + (sb ? tx(sb.name) : "") + (last ? " · last saved " + dayMonth(last) : "") + '</small></span><span class="pn-st" aria-label="' + by[k].length + ' saved">' + by[k].length + "</span></div></li>"; }).join("") + "</ul>"
      : '<p class="pn-empty pn-art-bm">Bookmark a question with the ribbon at the top while practising, and it collects here.</p>') + "</div>");
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
    // A MaiK module question (prep-qgen.js): hidden from that module on this phone and counted on the server, no text sent.
    if (it.qg && G.PREP_QGEN) { G.PREP_QGEN.report(it, reason); toast("Thank you. This question is hidden from your module."); st.stack.pop(); return rerender(); }
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
    var nsub = Object.keys(cm.subs).length;
    paint(bar("Custom module", examOf(s.exam).label, "back") + '<div class="pn-body pn-cm">' +
      hband("cm", setupOn() ? String(nsub) : String(cm.n), setupOn() ? (nsub === 1 ? "subject" : "subjects") : "questions", setupOn() ? "Pick the subjects, then the kind of questions and how many." : nsub ? (cm.mode === "exam" ? "A timed test" : "Practice") + (cm.d ? ", " + ["", "easy", "medium", "hard", "very hard"][cm.d] + " questions" : "") + ", from " + nsub + (nsub === 1 ? " subject" : " subjects") + "." : "Pick the subjects, then how hard and how many.") +
      '<section class="pn-panel"><h2 class="pn-sec">Subjects</h2><div class="pn-wrap">' +
      subs.map(function (sb) { return chip("cmsub", sb.id, !!cm.subs[sb.id], tx(sb.name)); }).join("") + "</div></section>" +
      (setupOn() ? "" : '<section class="pn-panel"><h2 class="pn-sec">Difficulty</h2><div class="pn-wrap pn-seg4">' + [[0, "Any"], [1, "Easy"], [2, "Medium"], [3, "Hard"], [4, "Very hard"]].map(function (x) { return chip("cmd", x[0], cm.d === x[0], x[1]); }).join("") + "</div>" +
      '<h2 class="pn-sec">Questions</h2><div class="pn-wrap pn-seg4">' + [10, 25, 50, 100].map(function (x) { return chip("cmn", x, cm.n === x, String(x)); }).join("") + "</div>" +
      '<h2 class="pn-sec">Mode</h2><div class="pn-wrap pn-seg4">' + chip("cmm", "study", cm.mode === "study", "Practice") + chip("cmm", "exam", cm.mode === "exam", "Timed test") + "</div></section>") +
      '<p class="pn-cm-sum" aria-live="polite">' + (nsub && setupOn() ? "Questions from " + nsub + (nsub === 1 ? " subject" : " subjects") + ". Choose the type, count and difficulty next." : nsub ? cm.n + " questions from " + nsub + (nsub === 1 ? " subject" : " subjects") + ", " + (cm.mode === "exam" ? "timed" : "marked as you go") : "Pick at least one subject") + "</p>" +
      '<button type="button" class="pn-btn pri" data-act="cmstart"' + (nsub ? "" : " disabled") + ">" + ico("play") + (setupOn() ? " Choose questions" : " Start") + "</button></div>");
  }
  function startCustom() {
    var s = load(), sids = Object.keys(cm.subs);
    paint(bar("Custom module", "", "back") + '<div class="pn-body"><p class="pn-load" role="status">Gathering questions…</p></div>');
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
      runQuestions(list, cm.mode, "Custom module", { save: "custom" });
    });
  }

  /* ---------- offline downloads ---------- */
  function renderDownloads() {
    var s = load(), subs = subjectsOf(s.exam);
    var ndl = subs.filter(function (sb) { return !!s.dl[sb.id]; }).length;
    paint(bar("Offline downloads", "", "back") + '<div class="pn-body pn-dll">' + hband("dl", ndl + " of " + subs.length, subs.length === 1 ? "subject offline" : "subjects offline", "A downloaded subject opens every module without a connection. Opened modules are kept anyway.") + '<ul class="pn-mods" id="pnDl">' +
      subs.map(function (sb) {
        var on = !!s.dl[sb.id];
        return '<li><div class="pn-mod static' + (on ? " on" : "") + '"><span class="pn-ic sm" style="--h:' + subjHue(sb.id) + '" aria-hidden="true">' + subjIco(sb.id) + '</span><span class="pn-mb"><b>' + tx(sb.name) + '</b><small id="pnDl-' + esc(sb.id) + '">' + (on ? "Downloaded" + (typeof s.dl[sb.id] === "number" ? " " + dayMonth(s.dl[sb.id]) : "") : "Not downloaded") + '</small><span class="pn-dlbar" id="pnDlb-' + esc(sb.id) + '" aria-hidden="true"><i></i></span></span>' +
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
        return loadModule(sid, ts[i].id).then(function () { done++; var e = el(), b = root && root.querySelector("#pnDlb-" + sid); if (e) e.textContent = "Downloading " + done + " of " + ts.length + "…"; if (b) { b.classList.add("on"); b.firstChild.style.transform = "scaleX(" + (done / ts.length).toFixed(3) + ")"; } return step(i + 1); }, function () { var e = el(); if (e) e.textContent = "Stopped: no connection"; });
      };
      return step(0);
    });
  }
  function removeDownload(sid) {
    var s = load();
    cacheKeys().then(function (keys) {
      (keys || []).forEach(function (k) { k = String(k); if (k.indexOf(bvOf(sid) + "/" + sid + "/") === 0 || (k.indexOf("overlay/") === 0 && k.split("/")[2] === sid)) { cacheDel(k); delete st.mem[k]; } });
      Object.keys(st.mem).forEach(function (k) { if (k.indexOf("mod:" + sid + "/") === 0) delete st.mem[k]; });
      delete s.dl[sid]; save(); renderDownloads();
    });
  }

  /* ---------- practice setup (prep-setup.js): the sheet before a set from a module, a subject, custom, mistakes, bookmarks ----------
     Each scope says how to load its pool (one list per module file, so the draw spreads across modules) and how to start.
     "Last settings" (su-last) starts the same scope at once with the remembered choice. */
  function setupOn() { return !!(G.PREP_SETUP && G.PREP_SETUP.enabled()); }
  // The runner options of a set the student made: saved for 7 days when it finishes.
  function saveOpt(ro, kind) { var o = {}, k; for (k in ro || {}) o[k] = ro[k]; o.save = kind; return o; }
  function scopeModule(sid, mid, kind, o) {
    var s = load(), t = topicOf(sid, mid), title = t ? tx(t.title) : "Practice";
    o = o || {};
    return { kind: "module", id: mid, title: title, sub: tx((subjectById(sid) || {}).name), hue: subjHue(sid), mode: o.mode || (kind === "exam" ? "exam" : kind === "study" ? "study" : null), seen: kind === "due" ? "due" : null, n: o.n || 0,
      load: function () { return loadModule(sid, mid).then(function (items) { return [poolFor(items, s.exam, hidden())]; }); },
      start: function (list, mode, ro) { runQuestions(list, mode, title, saveOpt(ro, "module")); } };
  }
  // A subject: every module when it is downloaded; otherwise the modules opened before plus others, 16 files at most.
  var SUBJECT_FILES = 16;
  function scopeSubject(sid) {
    var s = load(), sb = subjectById(sid), title = sb ? tx(sb.name) : "Practice";
    return { kind: "subject", id: sid, title: title, sub: "Whole subject", hue: subjHue(sid),
      load: function () {
        return loadIndex(sid).then(function (ix) {
          var prog = progressByModule(s, today()), mods = ix.topics.filter(function (t) { return countFor(t, s.exam); });
          if (!s.dl[sid] && mods.length > SUBJECT_FILES) {
            var seen = shuffle(mods.filter(function (t) { return prog[t.id]; })), rest = shuffle(mods.filter(function (t) { return !prog[t.id]; }));
            mods = seen.concat(rest).slice(0, SUBJECT_FILES);
          }
          return loadMany(mods.map(function (t) { return { s: sid, m: t.id }; }));
        }).then(function (lists) { return lists.map(function (l) { return poolFor(l.items, s.exam, hidden()); }); });
      },
      start: function (list, mode, ro) { runQuestions(list, mode, title, saveOpt(ro, "subject")); } };
  }
  // Custom module: the subjects picked on the screen, 10 module files at most (as startCustom).
  function scopeCustom() {
    var s = load(), sids = Object.keys(cm.subs).sort();
    return { kind: "custom", id: sids.join(","), title: "Custom module", sub: sids.length + (sids.length === 1 ? " subject" : " subjects"),
      load: function () {
        return Promise.all(sids.map(loadIndex)).then(function () {
          var mods = [];
          sids.forEach(function (sid) { st.ix[sid].topics.forEach(function (t) { if (countFor(t, s.exam)) mods.push({ s: sid, m: t.id }); }); });
          return loadMany(shuffle(mods).slice(0, 10));
        }).then(function (lists) { return lists.map(function (l) { return poolFor(l.items, s.exam, hidden()); }); });
      },
      start: function (list, mode, ro) { runQuestions(list, mode, "Custom module", saveOpt(ro, "custom")); } };
  }
  // My mistakes under the chosen reason: every one is "incorrect before", so that row is left out.
  function scopeMistakes() {
    var s = load(), ids = Object.keys(s.mt).filter(function (id) { return mf.tag === "all" || (mf.tag === "untagged" ? !s.mt[id][2] : s.mt[id][2] === mf.tag); }), pairs = [], seen = {}, want = {};
    ids.forEach(function (id) { var b = s.mt[id]; want[id] = 1; if (!seen[b[1]]) { seen[b[1]] = 1; pairs.push({ s: b[0], m: b[1] }); } });
    return { kind: "mistakes", id: mf.tag, title: "My mistakes", sub: mf.tag === "all" ? "All reasons" : tagLabel(mf.tag) || "Not tagged", hue: 16, rows: { seen: false },
      load: function () { return loadMany(pairs.slice(0, 12)).then(function (lists) { var hid = hidden(); return lists.map(function (l) { return l.items.filter(function (it) { return want[it.id] && usable(it, hid); }); }); }); },
      start: function (list, mode, ro) { runQuestions(list, mode, "My mistakes", saveOpt(ro, "mistakes")); } };
  }
  // Bookmarks: every bookmarked question (all bookmarked, so that choice stays in the repeat row but is the whole pool).
  function scopeBookmarks() {
    var s = load(), by = {};
    Object.keys(s.bm).forEach(function (id) { var b = s.bm[id], k = b[0] + "|" + b[1]; (by[k] = by[k] || {})[id] = 1; });
    return { kind: "bookmarks", id: "", title: "Bookmarks", sub: Object.keys(s.bm).length + " saved", hue: 212,
      load: function () {
        return Promise.all(Object.keys(by).map(function (k) { var p = k.split("|"); return loadModule(p[0], p[1]).then(function (items) { var hid = hidden(); return items.filter(function (it) { return by[k][it.id] && usable(it, hid); }); }, function () { return []; }); }));
      },
      start: function (list, mode, ro) { runQuestions(list, mode, "Bookmarks", saveOpt(ro, "bookmarks")); } };
  }
  function scopeFor(kind, b) {
    if (kind === "module") return st.cur ? scopeModule(st.cur.s, st.cur.m, null) : null;
    if (kind === "subject") return scopeSubject(b.getAttribute("data-s"));
    if (kind === "mistakes") return scopeMistakes();
    if (kind === "bookmarks") return scopeBookmarks();
    if (kind === "custom") return scopeCustom();
    return null;
  }
  function setupModule(sid, mid, kind, o) { return G.PREP_SETUP.open(scopeModule(sid, mid, kind, o), HOST); }
  function setupSubject(sid) { return G.PREP_SETUP.open(scopeSubject(sid), HOST); }
  function setupCustom() { if (Object.keys(cm.subs).length) return G.PREP_SETUP.open(scopeCustom(), HOST); }
  function setupMistakes() { return G.PREP_SETUP.open(scopeMistakes(), HOST); }
  function setupBookmarks() { return G.PREP_SETUP.open(scopeBookmarks(), HOST); }
  // The one-tap button beside a Practice button, when this scope has remembered settings.
  function lastBtn(kind, id, attrs) {
    var l = setupOn() && G.PREP_SETUP.last ? G.PREP_SETUP.last(kind, id) : "";
    return l ? '<button type="button" class="pn-btn su-lastb" data-act="su-last" data-k="' + kind + '"' + (attrs || "") + ">" + ico("bolt") + '<span><b>Start with last settings</b><small>' + esc(l) + "</small></span></button>" : "";
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b || !root.contains(b) || b.getAttribute("aria-disabled") === "true" || b.disabled) return;
    // The tap that ends a sheet drag is not a press on whatever it lifted over.
    if (e.isTrusted && Date.now() - (st.sheetDragAt || 0) < 350 && b.closest(".pn-sheet-wrap")) return;
    var a = b.getAttribute("data-act"), v = b.getAttribute("data-v"), s = load();
    // Starting an item of today's plan may start the Live Activity (prep-native.js).
    if (G.PREP_NATIVE && b.classList.contains("pl-item")) G.PREP_NATIVE.planStarted();
    if (a === "close") return close();
    if (a.indexOf("n-") === 0 && G.PREP_NAV) return G.PREP_NAV.act(a, b, HOST);
    if (a === "back") return back();
    if (a === "retry") { close(); return open(); }
    if (a === "exam") { s.exam = v; save(); nav(0); return rerender(); }
    if (a === "subject") { st.filter = "all"; var sid = b.getAttribute("data-s"); return push(function () { renderSubject(sid); }); }
    if (a === "filter") { st.filter = v; nav(0); return rerender(); }
    if (a === "search") { srch.sid = b.getAttribute("data-s"); srch.q = ""; return loadIndex(srch.sid).then(function () { push(renderSearch); }); }
    if (a === "hit") return openHit(b.getAttribute("data-m"), b.getAttribute("data-i"));
    if (a === "module" || a === "solvenext") { var s1 = b.getAttribute("data-s"), m1 = b.getAttribute("data-m"); return loadIndex(s1).then(function () { openModule(s1, m1); }); }
    if (a === "start") { var c = st.cur, k0 = b.getAttribute("data-k"); if (setupOn()) return setupModule(c.s, c.m, k0 === "due" ? "due" : null); return startModule(c.s, c.m, k0); }
    if (a === "answer") { if (Date.now() - (st.dragAt || 0) < 350) return; return answer(Number(b.getAttribute("data-k"))); }
    // Round 7: a tapped Next or Previous slides the question in like a swipe; a key press (click detail 0) stays still.
    if (a === "next") { var r = st.run; if (!r) return; if (r.i < r.items.length - 1) { r.i++; if (e.detail) st.swipeIn = 1; return renderRun(); } return finish(); }
    if (a === "prev") { if (st.run && st.run.i) { st.run.i--; if (e.detail) st.swipeIn = -1; renderRun(); } return; }
    if (a === "markq") { var rr = st.run; rr.mark[rr.i] = !rr.mark[rr.i]; return renderRun(); }
    if (a === "qgrid") return openGrid();
    if (a === "goq") { st.run.i = Number(b.getAttribute("data-i")); st.stack.pop(); return renderRun(); }
    if (a === "submit") { var un = st.run.ans.filter(function (x) { return x < 0; }).length; if (un && G.confirm && !G.confirm(un + " questions are unanswered. Submit anyway?")) return; return finish(); }
    if (a === "bookmark") return toggleBookmark();
    if (a === "report") return openReport();
    if (a === "sendreport") return sendReport(v);
    if (a === "reviewq") return reviewQuestion(Number(b.getAttribute("data-i")));
    if (a === "retrymissed") { var r2 = st.run, miss = r2.items.filter(function (it, i) { return r2.ans[i] !== it.a; }); st.stack.pop(); return runQuestions(miss, "study", r2.title); }
    // Practise the whole set again in the same order; a saved set keeps its place and gets the new answers.
    if (a === "retryall") { var r5 = st.run; st.stack.pop(); return runQuestions(r5.items.slice(), "study", r5.title, r5.psId ? { psId: r5.psId } : r5.save ? { save: r5.save } : {}); }
    if (a === "rfilter") { if (st.run && st.run.done) { st.run.rf = v; nav(0); renderRun(); var fb = root && root.querySelector('[data-act=rfilter][data-v="' + v + '"]'); if (fb) fb.focus({ preventScroll: true }); } return; }
    if (a === "psopen") return openSet(b.getAttribute("data-id"));
    if (a === "donerun") { st.run = null; st.stack.pop(); nav(-1); return rerender(); }
    if (a === "bookmarks") return push(renderBookmarks);
    if (a === "plan") return startPlan();
    if (a === "weak") return startWeak();
    if (a === "goal") { var G2 = [20, 30, 50, 100], gi = G2.indexOf(s.goal); s.goal = G2[(gi + 1) % G2.length]; save(); return rerender(); }
    if (a === "mistakes") { mf.tag = "all"; return push(renderMistakes); }
    if (a === "mfilter") { mf.tag = v; nav(0); return rerender(); }
    if (a === "mpractice") return setupOn() ? setupMistakes() : practiceMistakes();
    if (a === "mtag") { var rt = st.run, itm = rt && rt.items[rt.i]; if (itm && s.mt[itm.id]) { s.mt[itm.id][2] = s.mt[itm.id][2] === v ? null : v; save(); } return renderRun(); }
    if (a === "mocks") { ttSet("tests"); return push(renderMocks); }
    if (a === "tt") { ttSet(v); nav(0); return rerender(); }
    if (a === "ask") { var rt4 = st.run, it4 = rt4 && rt4.items[rt4.i]; if (it4 && G.PREP_ASK) G.PREP_ASK.open({ kind: "mcq", item: it4, chosen: rt4.ans[rt4.i], n: rt4.i + 1, side: true, topic: rt4.title }, HOST); return; }
    if (a === "ask-rv") { var rt5 = st.run, i5 = Number(b.getAttribute("data-i")), it5 = rt5 && rt5.items[i5]; if (it5 && G.PREP_ASK) G.PREP_ASK.open({ kind: "mcq", item: it5, chosen: rt5.ans[i5], n: i5 + 1, side: true, topic: rt5.title }, HOST); return; }
    if (a.indexOf("ak-") === 0 && G.PREP_ASK) return G.PREP_ASK.act(a, b, HOST);
    if (a === "teach") { var rt3 = st.run, it3 = rt3 && rt3.items[rt3.i]; if (it3 && G.PREP_TEACHER) G.PREP_TEACHER.explain(it3, rt3.ans[rt3.i], HOST); return; }
    if (a === "mock") return startMock(v, b.getAttribute("data-k"));
    if (a === "practicebm") return setupOn() ? setupBookmarks() : practiceBookmarks();
    if (a === "custom") return push(renderCustom);
    if (a === "cmsub") { if (cm.subs[v]) delete cm.subs[v]; else cm.subs[v] = 1; return rerender(); }
    if (a === "cmd") { cm.d = Number(v); return rerender(); }
    if (a === "cmn") { cm.n = Number(v); return rerender(); }
    if (a === "cmm") { cm.mode = v; return rerender(); }
    if (a === "cmstart") { if (setupOn()) return setupCustom(); st.stack.push(function () {}); return startCustom(); }
    if (a === "downloads") return push(renderDownloads);
    if (a === "menu") return push(renderMenu);
    if (a === "qotd") return qotdAnswer(+b.getAttribute("data-k"));
    if (a === "qotd-why") return qotdAnswer(-1);
    if (a === "dlget") return download(b.getAttribute("data-s"));
    if (a === "dlrm") return removeDownload(b.getAttribute("data-s"));
    // PrepNucleus Pro (prep-pro.js): a lesson or card batch checks the free tier before it starts; "pro-" acts are its own.
    if (G.PrepPro && (a === "l-open" || a === "k-open" || a === "k-due")) { var pf = a === "l-open" ? "lessons" : "cards", pm = b.getAttribute("data-m"); if (!G.PrepPro.can(pf, pm ? { module: pm } : null)) return G.PrepPro.openLimit(pf); if (pf === "lessons") G.PrepPro.use(pf, { module: pm }); }
    if (a.indexOf("pro-") === 0) return G.PrepPro && G.PrepPro.act(a, b, HOST);
    // Share IDs (prep-ids.js) own every data-act starting "id-".
    if (a.indexOf("id-") === 0 && G.PREP_IDS) return G.PREP_IDS.act(a, b, HOST);
    // MaiK modules and the owner's Author screen (prep-qgen.js) own every data-act starting "g-".
    if (a.indexOf("g-") === 0 && G.PREP_QGEN) return G.PREP_QGEN.act(a, b, HOST);
    // Friends, groups and the accuracy page (prep-social.js).
    if (a === "soc-open") return G.PrepSocial && G.PrepSocial.open && G.PrepSocial.open(HOST);
    if (a === "soc-acc") return G.PrepSocial && G.PrepSocial.openAccuracy && G.PrepSocial.openAccuracy(HOST);
    // The practice setup sheet (prep-setup.js) owns every data-act starting "su-"; su-subject opens it for a subject.
    if (a === "su-subject") return setupSubject(b.getAttribute("data-s"));
    if (a === "su-last") { var sc0 = scopeFor(b.getAttribute("data-k"), b); return sc0 && G.PREP_SETUP.quick(sc0, HOST); }
    if (a.indexOf("su-") === 0 && G.PREP_SETUP) return G.PREP_SETUP.act(a, b, HOST);
    // Layer C (prep-create.js and friends) owns every data-act starting "c-".
    if (a.indexOf("c-") === 0 && G.PREP_C && G.PREP_C.act) return G.PREP_C.act(a, b, HOST);
    // Arena and My stats (prep-arena.js) own every data-act starting "a-".
    if (a.indexOf("a-") === 0 && G.PREP_ARENA && G.PREP_ARENA.act) return G.PREP_ARENA.act(a, b, HOST);
    // Lessons (prep-lessons.js) own every data-act starting "l-".
    if (a.indexOf("l-") === 0 && G.PREP_LESSONS) return G.PREP_LESSONS.act(a, b, HOST);
    // Previous year papers (prep-pyq.js) own every data-act starting "y-".
    if (a.indexOf("y-") === 0 && G.PREP_PYQ) return G.PREP_PYQ.act(a, b, HOST);
    // Radiology image series (prep-rad.js) own every data-act starting "rd-".
    if (a.indexOf("rd-") === 0 && G.PREP_RAD) return G.PREP_RAD.act(a, b, HOST);
    // Onboarding, readiness and today's plan (prep-plan.js) own every data-act starting "p-".
    if (a.indexOf("p-") === 0 && G.PREP_PLAN) return G.PREP_PLAN.act(a, b, HOST);
    // Module flashcards (prep-flash.js) own every data-act starting "k-".
    if (a.indexOf("k-") === 0 && G.PREP_FLASH) return G.PREP_FLASH.act(a, b, HOST);
  }
  function openGrid() {
    var r = st.run;
    if (r && r.qc) qtick(r);   // catch up first: a budget that ran out locks before the grid shows
    if (!st.run || st.run.done) return;
    st.stack.push(function () {
      var na = r.ans.filter(function (x) { return x >= 0; }).length, nm = Object.keys(r.mark).filter(function (k) { return r.mark[k]; }).length;
      paint(bar("All questions", esc(r.title), "back") + '<div class="pn-body">' + hband("grid", na + " of " + r.items.length, "answered", nm ? nm + (nm === 1 ? " question" : " questions") + " marked for review." : "Tap a number to go to that question.") + '<div class="pn-qgrid">' + r.items.map(function (it, i) {
        var to = !!(r.qc && r.qc.out[i]), c = r.ans[i] >= 0 ? " ans" : ""; if (r.mark[i]) c += " mark"; if (to) c += " out";
        return '<button type="button" class="pn-qn' + c + '" data-act="goq" data-i="' + i + '" aria-label="Question ' + (i + 1) + (r.ans[i] >= 0 ? ", answered" : ", not answered") + (to ? ", time up" : "") + (r.mark[i] ? ", marked for review" : "") + '">' + (i + 1) + "</button>";
      }).join("") + '</div><p class="pn-mut pn-small pn-qkey"><span><i class="ans" aria-hidden="true"></i>Answered</span><span><i class="mark" aria-hidden="true"></i>Marked for review</span><span><i aria-hidden="true"></i>Not answered</span>' + (r.qc && r.qc.out.some(Boolean) ? '<span><i class="out" aria-hidden="true"></i>Time up</span>' : "") + '</p><button type="button" class="pn-btn pri" data-act="submit">Submit test</button></div>');
    });
    syncClock(r);   // the grid hides the question: its clock stops
    rerender();
  }

  /* The surface Layer C (window.PREP_C: prep-create.js, prep-cards.js) draws through, so its screens share this
     overlay, back stack, runner and store. Deck items carry _s "deck" and _m "deck-<id>": their FSRS cards live in
     the same store under deck key "p:deck-<id>". */
  var HOST = { bankVer: function () { return VER; }, pyqVer: function () { return PYQ_VER; }, push: push, rerender: rerender, back: back, paint: paint, nav: nav, bar: bar, hband: hband, ico: ico, esc: esc, toast: toast, fmt: fmt,
    run: runQuestions, today: today, store: load, save: save, core: function () { return C; }, root: function () { return root; },
    exam: function () { return examOf(load().exam); },
    // setExam(id): what the Settings exam row does to the exam tab (tests use it to switch exams without the sheet).
    setExam: function (id) { var s = load(); s.exam = examOf(id).id; save(); nav(0); rerender(); },
    // Arena and My stats (prep-arena.js)
    subjIco: subjIco, subjHue: subjHue, row: row, fmtTime: fmtTime, mockOf: mockOf, subjectOfModule: subjectOfModule, subjectById: subjectById, tx: tx,
    stackTop: function () { return st.stack[st.stack.length - 1]; }, home: renderHome,
    // Tab roots for the floating tab bar (prep-nav.js): Tests and You.
    screens: { mocks: renderMocks, menu: renderMenu }, run_: function () { return st.run; },
    // Lessons (prep-lessons.js)
    // Plan (prep-plan.js)
    subjectsOf: subjectsOf, loadIndex: loadIndex, ix: function () { return st.ix; }, startMock: startMock, pure: PURE,
    // Celebrations and MaiK lines (lessons): celeFor(m0, holder), celeAttrs, celeChip, maikLine({ subject }, holder), snap().
    snap: snapNow, celeFor: celeFor, celeAttrs: celeAttrs, celeChip: celeChip, maikLine: maikLine,
    stack: function () { return st.stack; }, loadModule: loadModule, bankApi: API, shuffle: shuffle, pool: function (items) { var h = hidden(); return (items || []).filter(function (it) { return usable(it, h); }); }, cacheGet: cacheGet, cachePut: cachePut, cacheKeys: cacheKeys,
    // MaiK modules (prep-qgen.js): the bank and overlay files of a module, for the owner's duplicate check on the server.
    modulePath: modulePath, overlaysOf: function (sid) { return (OVERLAYS[sid] || []).slice(); } };

  var API_OBJ = { open: open, close: close, back: back, isOpen: function () { return st.open; }, _pure: PURE, _st: st, _host: HOST };
  G.PREP = API_OBJ;
})(typeof window !== "undefined" ? window : this);
