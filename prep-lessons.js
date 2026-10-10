/* PrepNucleus Lessons: short chapter lessons (text on top, one visual below, read aloud, then 3 quick questions).
   window.PREP_LESSONS. ES5. Loaded by prep-loader.js after prep.js and drawn through PREP._host (the same overlay,
   back stack, runner and store). prep.js forwards every data-act starting "l-" here and asks back() first on back.

   Data: prep/lessons/v1/index.json { v, modules: { <key>: { title, minutes, steps, module?, set? } } } and
   prep/lessons/v1/<key>.json. A key is the module id for the module's own lesson; other lessons (the owner's radiology
   notes, set "radnotes", key "radnotes-<section>") name their module inside the entry, and a module lists every
   lesson whose key or module matches (lessonsFor). Progress (store.ls) is kept per key. Files:
   prep/lessons/v1/<key>.json { v, module, title, minutes, steps: [{ tx, say, vis }], quiz: [item ids], src, gen, checks }.
   tx marks key terms with **bold**; say is the plain narration; vis is null or one of
   { kind: "table", cols, rows } | { kind: "flow", nodes: [{ id, label, sub? }], edges: [[from, to, label?]] } |
   { kind: "compare", left: { title, points }, right: { title, points } } | { kind: "image", src, alt, caption }.
   Built by tools/prep-lessons.mjs (gates there) or by hand (gen "hand"). Files ship in www/prep/lessons and are kept
   in IndexedDB after the first open, like the bank's module files.

   Interactive lessons (2026-10-09, tools/prep-radlx.mjs). Every field below is optional and a file that has them still
   passes the old checkLesson (an image step stays kind "image"), so an older reader shows plain figures:
     image vis + spot  { q: "Tap the ...", box: [x, y, w, h] (0..1 of the image), label, why }   spot the sign
     image vis + marks [{ x, y, label }] (0..1)                                                 labels toggled on tap
     image vis + pair  { src, alt, tag, tagA?, why?, ar? }                                     compare two images
     image vis + ar    width / height of the image (reserves its space)
     step.qc           { q, o: [2 to 4], a, why }  a quick check under the step (o ["True", "False"] for true/false)
     lesson.cards      [{ f, b }]  classic signs, a deck of flip cards after the last step
     lesson.keys       [string]    key points, the last page before the finish
   tidyLesson() drops any malformed optional part instead of failing the lesson. An index entry with "r": 2 lives at
   v2/lessons/<key>.json (a new path, since a lesson file is cached forever per path); older readers ignore "r".

   Narration: @capacitor-community/text-to-speech on native (the plugin maik-ask.js and CliniX viva use), else the
   browser's speechSynthesis. Neither sends audio or text anywhere. Pure helpers load under node for tests. */
(function (G) {
  "use strict";
  // Bound once per element and site; a later call swaps the handler (prep.js PREP_DOM.on: a patched repaint keeps nodes).
  function ON(el, site, type, fn, opts) { if (G.PREP_DOM && G.PREP_DOM.on) return G.PREP_DOM.on(el, site, type, fn, opts); el.addEventListener(type, fn, opts); }

  /* ================= pure ================= */
  var SPEEDS = [0.75, 1, 1.25, 1.5];
  var XP_STEP = 10;
  var LIM = { steps: [4, 8], txWords: [40, 90], sayWords: 120, cols: [2, 5], rows: [2, 8], nodes: [3, 8], perLevel: 3, points: [1, 6] };
  var IMG_RE = /^(?!.*\.\.)[a-z0-9][a-z0-9_\/.-]*\.(?:webp|png|jpe?g|svg)$/i;

  function str(s) { return s == null ? "" : String(s); }
  function words(s) { var t = str(s).trim(); return t ? t.split(/\s+/).length : 0; }
  function plain(tx) { return str(tx).replace(/\*\*/g, ""); }
  function escH(s) { return str(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /* boldHtml("a **b** c") -> "a <b>b</b> c", everything escaped. An unmatched ** is shown as text. */
  function boldHtml(tx) {
    var parts = str(tx).split("**");
    if (parts.length % 2 === 0) return escH(tx);
    return parts.map(function (p, i) { return i % 2 ? "<b>" + escH(p) + "</b>" : escH(p); }).join("");
  }
  function boldTerms(tx) { var out = [], re = /\*\*([^*]+)\*\*/g, m; while ((m = re.exec(str(tx))) !== null) out.push(m[1]); return out; }
  /* visText(vis) -> every string the visual shows (for gates and the teacher's grounding). */
  function visText(v) {
    if (!v) return "";
    if (v.kind === "table") return [].concat(v.cols || [], [].concat.apply([], v.rows || [])).join(" \n");
    if (v.kind === "flow") return (v.nodes || []).map(function (n) { return n.label + (n.sub ? " " + n.sub : ""); }).concat((v.edges || []).map(function (e) { return e[2] || ""; })).join(" \n");
    if (v.kind === "compare") return [v.left.title].concat(v.left.points, [v.right.title], v.right.points).join(" \n");
    if (v.kind === "image") {
      var t = [str(v.alt), str(v.caption)];
      if (v.spot) t.push(str(v.spot.label), str(v.spot.why));
      if (v.marks) v.marks.forEach(function (m) { t.push(str(m.label)); });
      if (v.pair) t.push(str(v.pair.tagA), str(v.pair.tag), str(v.pair.alt), str(v.pair.why));
      return t.filter(Boolean).join(" \n");
    }
    return "";
  }
  /* flowLevels(nodes, edges) -> [[id, ...], ...] by longest path from the roots, in node order; null on a cycle or an
     edge to an unknown node. */
  function flowLevels(nodes, edges) {
    var ids = {}, lv = {}, indeg = {}, out = {}, order = [], i;
    for (i = 0; i < nodes.length; i++) { ids[nodes[i].id] = 1; indeg[nodes[i].id] = 0; out[nodes[i].id] = []; }
    for (i = 0; i < edges.length; i++) {
      var a = edges[i][0], b = edges[i][1];
      if (!ids[a] || !ids[b] || a === b) return null;
      out[a].push(b); indeg[b]++;
    }
    var q = nodes.filter(function (n) { return !indeg[n.id]; }).map(function (n) { lv[n.id] = 0; return n.id; });
    while (q.length) {
      var x = q.shift(); order.push(x);
      out[x].forEach(function (y) { lv[y] = Math.max(lv[y] || 0, lv[x] + 1); if (--indeg[y] === 0) q.push(y); });
    }
    if (order.length !== nodes.length) return null;
    var rows = [];
    nodes.forEach(function (n) { (rows[lv[n.id]] || (rows[lv[n.id]] = [])).push(n.id); });
    return rows;
  }
  function inRange(n, r) { return n >= r[0] && n <= r[1]; }
  function nonEmpty(s) { return typeof s === "string" && s.trim().length > 0; }
  /* checkVis(vis) -> "" when the visual can be drawn on a phone, else the reason. null is fine (no visual). */
  function checkVis(v) {
    if (v == null) return "";
    if (typeof v !== "object") return "vis is not an object";
    if (v.kind === "table") {
      if (!Array.isArray(v.cols) || !inRange(v.cols.length, LIM.cols) || !v.cols.every(nonEmpty)) return "table needs 2 to 5 named columns";
      if (!Array.isArray(v.rows) || !inRange(v.rows.length, LIM.rows)) return "table needs 2 to 8 rows";
      for (var i = 0; i < v.rows.length; i++) if (!Array.isArray(v.rows[i]) || v.rows[i].length !== v.cols.length || !v.rows[i].every(nonEmpty)) return "table row " + (i + 1) + " does not match the columns";
      return "";
    }
    if (v.kind === "flow") {
      if (!Array.isArray(v.nodes) || !inRange(v.nodes.length, LIM.nodes)) return "flow needs 3 to 8 nodes";
      var seen = {};
      for (var j = 0; j < v.nodes.length; j++) {
        var n = v.nodes[j];
        if (!n || !nonEmpty(n.id) || !nonEmpty(n.label) || seen[n.id]) return "flow node " + (j + 1) + " needs a unique id and a label";
        seen[n.id] = 1;
      }
      if (!Array.isArray(v.edges) || !v.edges.length || !v.edges.every(function (e) { return Array.isArray(e) && e.length >= 2; })) return "flow needs edges [from, to, label?]";
      var lv = flowLevels(v.nodes, v.edges);
      if (!lv) return "flow edges must join known nodes without a cycle";
      var linked = {}; v.edges.forEach(function (e) { linked[e[0]] = linked[e[1]] = 1; });
      if (!v.nodes.every(function (x) { return linked[x.id]; })) return "every flow node needs an edge";
      if (lv.some(function (r) { return r.length > LIM.perLevel; })) return "a flow level has more than 3 nodes (too wide for a phone)";
      return "";
    }
    if (v.kind === "compare") {
      var ok = function (c) { return c && nonEmpty(c.title) && Array.isArray(c.points) && inRange(c.points.length, LIM.points) && c.points.every(nonEmpty); };
      return ok(v.left) && ok(v.right) ? "" : "compare needs a title and 1 to 6 points on each side";
    }
    if (v.kind === "image") {
      if (!IMG_RE.test(str(v.src))) return "image src must be an in-app media path";
      return nonEmpty(v.alt) && nonEmpty(v.caption) ? "" : "image needs alt text and a caption";
    }
    return "unknown vis kind";
  }
  /* checkStep(step) -> [problems]. */
  function checkStep(s) {
    var p = [];
    if (!s || !nonEmpty(s.tx)) return ["no text"];
    var w = words(plain(s.tx));
    if (!inRange(w, LIM.txWords)) p.push("text is " + w + " words (40 to 90)");
    if (!boldTerms(s.tx).length) p.push("no bold key term");
    if (str(s.tx).split("**").length % 2 === 0) p.push("unmatched **");
    if (!nonEmpty(s.say)) p.push("no narration");
    else if (words(s.say) >= LIM.sayWords) p.push("narration is " + words(s.say) + " words (under 120)");
    if (/\*\*|[<>#]/.test(str(s.say))) p.push("narration has markup");
    var vr = checkVis(s.vis);
    if (vr) p.push(vr);
    return p;
  }
  /* checkLesson(lesson) -> [problems]; [] = drawable. */
  function checkLesson(l) {
    var p = [];
    if (!l || l.v !== 1) return ["not a v1 lesson"];
    if (!nonEmpty(l.module) || !nonEmpty(l.title)) p.push("module and title are required");
    if (!Array.isArray(l.steps) || !inRange(l.steps.length, LIM.steps)) p.push("a lesson has 4 to 8 steps");
    else l.steps.forEach(function (s, i) { checkStep(s).forEach(function (x) { p.push("step " + (i + 1) + ": " + x); }); });
    if (!Array.isArray(l.quiz)) p.push("quiz must be a list of bank item ids");
    if (l.gen !== "AI" && l.gen !== "hand") p.push('gen must be "AI" or "hand"');
    return p;
  }
  /* ---- interactive parts (all optional) ---- */
  var XP_HIT = 5, BOX_PAD = 0.04;
  function num01(v) { return typeof v === "number" && isFinite(v) && v >= 0 && v <= 1; }
  function spotOk(sp) {
    if (!sp || !nonEmpty(sp.q) || !nonEmpty(sp.label) || !Array.isArray(sp.box) || sp.box.length !== 4 || !sp.box.every(num01)) return false;
    return sp.box[2] > 0 && sp.box[3] > 0 && sp.box[0] + sp.box[2] <= 1.001 && sp.box[1] + sp.box[3] <= 1.001;
  }
  function marksOk(m) { return Array.isArray(m) && m.length >= 1 && m.length <= 6 && m.every(function (k) { return k && num01(k.x) && num01(k.y) && nonEmpty(k.label); }); }
  function pairOk(p) { return !!p && IMG_RE.test(str(p.src)) && nonEmpty(p.tag); }
  function qcOk(q) {
    if (!q || !nonEmpty(q.q) || !Array.isArray(q.o) || q.o.length < 2 || q.o.length > 4 || !q.o.every(nonEmpty)) return false;
    return typeof q.a === "number" && q.a === Math.floor(q.a) && q.a >= 0 && q.a < q.o.length;
  }
  function isTF(q) { return !!q && q.o && q.o.length === 2 && /^true$/i.test(q.o[0]) && /^false$/i.test(q.o[1]); }
  /* tidyLesson(lesson) -> a copy without the malformed optional parts (spot, marks, pair, ar, qc, cards, keys), so one bad
     overlay never costs the whole lesson. Required fields are left for checkLesson. */
  function tidyLesson(l) {
    if (!l || typeof l !== "object" || !Array.isArray(l.steps)) return l;
    var out = {}, k;
    for (k in l) out[k] = l[k];
    out.steps = l.steps.map(function (s) {
      if (!s || typeof s !== "object") return s;
      var c = {}, j; for (j in s) c[j] = s[j];
      if (c.qc != null && !qcOk(c.qc)) delete c.qc;
      var v = c.vis;
      if (v && v.kind === "image" && (v.spot != null || v.marks != null || v.pair != null || v.ar != null)) {
        var w = {}; for (j in v) w[j] = v[j];
        if (w.spot != null && !spotOk(w.spot)) delete w.spot;
        if (w.marks != null && !marksOk(w.marks)) delete w.marks;
        if (w.pair != null && !pairOk(w.pair)) delete w.pair;
        if (w.spot && (w.marks || w.pair)) { delete w.marks; delete w.pair; }      // one interaction a figure
        if (w.marks && w.pair) delete w.pair;
        if (w.ar != null && !(typeof w.ar === "number" && w.ar > 0.2 && w.ar < 5)) delete w.ar;
        c.vis = w;
      }
      return c;
    });
    var cards = Array.isArray(l.cards) ? l.cards.filter(function (x) { return x && nonEmpty(x.f) && nonEmpty(x.b); }).slice(0, 8) : [];
    var keys = Array.isArray(l.keys) ? l.keys.filter(nonEmpty).slice(0, 8) : [];
    if (cards.length) out.cards = cards; else delete out.cards;
    if (keys.length) out.keys = keys; else delete out.keys;
    return out;
  }
  /* hitBox(box, x, y) -> true when (x, y), 0..1 of the image, falls in the box or within 4% of its edge. */
  function hitBox(b, x, y, pad) {
    var p = pad == null ? BOX_PAD : pad;
    return x >= b[0] - p && x <= b[0] + b[2] + p && y >= b[1] - p && y <= b[1] + b[3] + p;
  }
  /* pages(lesson) -> the reader's pages: every step, then "cards" (when the lesson has sign cards), then "keys". */
  function pages(l) {
    var out = ((l && l.steps) || []).map(function (s, i) { return i; });
    if (l && l.cards && l.cards.length) out.push("cards");
    if (l && l.keys && l.keys.length) out.push("keys");
    return out;
  }
  /* interactions(lesson) -> { spot, marks, pair, qc, cards } counts as the reader draws them. */
  function interactions(l) {
    var n = { spot: 0, marks: 0, pair: 0, qc: 0, cards: l && l.cards && l.cards.length ? 1 : 0 };
    ((l && l.steps) || []).forEach(function (s) {
      var v = s && s.vis;
      if (v && v.kind === "image") { if (v.spot) n.spot++; else if (v.marks) n.marks++; else if (v.pair) n.pair++; }
      if (s && s.qc) n.qc++;
    });
    return n;
  }
  /* sliderPair(v) -> true when the two images of a compare have near equal shapes (within 12%), so a swipe slider over
     one frame reads well; otherwise they sit side by side. */
  function sliderPair(v) { return !!(v && v.pair && v.ar && v.pair.ar && Math.abs(v.ar / v.pair.ar - 1) <= 0.12); }
  function nextSpeed(r) { var i = SPEEDS.indexOf(r); return SPEEDS[(i + 1) % SPEEDS.length]; }
  function speedLabel(r) { return String(r).replace(/^0\./, ".") + "x"; }
  function xpFor(l) { return (l && l.steps ? l.steps.length : 0) * XP_STEP; }
  /* swipeDir(dx, dy) -> 1 (next), -1 (back) or 0: a clear horizontal swipe of 56 px or more. */
  function swipeDir(dx, dy) { return Math.abs(dx) >= 56 && Math.abs(dx) > 1.5 * Math.abs(dy) ? (dx < 0 ? 1 : -1) : 0; }
  /* lessonImgUrl(src, api) -> the URL a lesson figure loads from. A bank path ("v7/ss-radiology/img/x.webp", a figure a
     subject's own bank serves, PREP_RAD items) goes through the bank API; anything else is in-app media from the web root. */
  function lessonImgUrl(src, api) {
    var p = str(src).replace(/^\/+/, "");
    return /^v\d{1,3}\//.test(p) ? str(api || "/api/prep/bank/").replace(/\/?$/, "/") + p : "/" + p;
  }
  /* lessonsFor(ix, mid) -> [[key, meta]] for a module: its own lesson (key === mid) first, then every entry whose
     "module" is mid, by key. */
  function lessonsFor(ix, mid) {
    var mods = (ix && ix.modules) || {}, own = [], rest = [], k;
    for (k in mods) { if (k === mid) own.push([k, mods[k]]); else if (mods[k] && mods[k].module === mid) rest.push([k, mods[k]]); }
    rest.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    return own.concat(rest);
  }
  /* subjectLessons(ix, topics) -> [{ mid, topic, list }] for a subject, in the subject's module order: each module that
     has a lesson, with its lessons (lessonsFor). */
  function subjectLessons(ix, topics) {
    var out = [];
    (topics || []).forEach(function (t) { var list = lessonsFor(ix, t.id); if (list.length) out.push({ mid: t.id, topic: t, list: list }); });
    return out;
  }
  /* moduleOf(key, meta) -> the module a lesson belongs to. */
  function moduleOf(key, meta) { return (meta && meta.module) || key; }
  /* imgUrl(src, bankApi, apiBase) -> where an image step loads from. "api/prep/bank/..." goes through the bank API base
     (tests point it at fixtures); a root path on native gets the API origin (the app runs at https://localhost and
     only stewardmd.in/api is served). */
  function imgUrl(src, bankApi, apiBase) {
    var u = "/" + str(src).replace(/^\/+/, "");
    if (u.indexOf("/api/prep/bank/") === 0 && bankApi) u = bankApi + u.slice("/api/prep/bank/".length);
    return u.indexOf("/api/") === 0 && apiBase ? apiBase + u : u;
  }
  /* lessonImages(les) -> the image srcs of a lesson's steps, in order, each once. */
  function lessonImages(l) {
    var out = [];
    ((l && l.steps) || []).forEach(function (s) {
      var v = s && s.vis;
      if (v && v.kind === "image" && v.src && out.indexOf(v.src) < 0) out.push(v.src);
      if (v && v.kind === "image" && v.pair && v.pair.src && out.indexOf(v.pair.src) < 0) out.push(v.pair.src);
    });
    return out;
  }
  function pickQuiz(items, ids) { var by = {}; (items || []).forEach(function (it) { by[it.id] = it; }); return (ids || []).map(function (id) { return by[id]; }).filter(Boolean); }

  /* Bundled index (pilot files in the app) + bank index (generated, from R2 through /api/prep/bank): the bank copy
     wins, except a hand-written bundled file ("gen":"hand") always wins for its module. Each entry says where its
     file lives ("from": "app" or "bank"). */
  function mergeIx(app, bank) {
    var out = {}, a = (app && app.modules) || {}, b = (bank && bank.modules) || {}, m, k, e;
    for (m in b) { e = { from: "bank" }; for (k in b[m]) e[k] = b[m][k]; out[m] = e; }
    for (m in a) if (!out[m] || a[m].gen === "hand") { e = { from: "app" }; for (k in a[m]) e[k] = a[m][k]; out[m] = e; }
    return { v: 1, modules: out };
  }
  var PURE = { mergeIx: mergeIx, SPEEDS: SPEEDS, XP_STEP: XP_STEP, LIM: LIM, IMG_RE: IMG_RE, plain: plain, words: words, boldHtml: boldHtml, boldTerms: boldTerms, visText: visText,
    flowLevels: flowLevels, checkVis: checkVis, checkStep: checkStep, checkLesson: checkLesson, nextSpeed: nextSpeed, speedLabel: speedLabel, xpFor: xpFor,
    swipeDir: swipeDir, pickQuiz: pickQuiz, lessonImages: lessonImages, lessonsFor: lessonsFor, subjectLessons: subjectLessons, moduleOf: moduleOf, imgUrl: imgUrl, lessonImgUrl: lessonImgUrl,
    XP_HIT: XP_HIT, spotOk: spotOk, marksOk: marksOk, pairOk: pairOk, qcOk: qcOk, isTF: isTF, tidyLesson: tidyLesson, hitBox: hitBox, pages: pages, interactions: interactions, sliderPair: sliderPair };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= app ================= */
  var BASE = G.SMD_PREP_LESSONS_BASE || (G.SMD_PREP_BASE || "/prep/") + "lessons/";
  var VER = "v1";
  // ans: this sitting's answers per page (spot, labels, compare, quick check, cards); sc: right answers and the streak.
  var L = { ix: null, ixP: null, mem: {}, les: null, sid: null, mid: null, key: null, more: {}, i: 0, fin: false, playing: false, tok: 0, zoom: null, dir: 0, view: null, firstXp: 0,
    ans: {}, sc: { ok: 0, n: 0, run: 0, best: 0 } };
  var host = null;

  function getJSON(url) { return G.fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  // Generated lessons live in R2: /api/prep/bank/v1/lessons/... (the same API base as the bank, so tests can point it at fixtures).
  function api() { return ((host && host.bankApi) || G.SMD_PREP_BANK_API || "/api/prep/bank/") + VER + "/lessons/"; }
  // The network copy, else the IndexedDB copy (offline); null when neither.
  function fresh(url, key) {
    return getJSON(url).then(function (x) { if (host && host.cachePut) host.cachePut(key, x); return x; }, function () {
      return host && host.cacheGet ? host.cacheGet(key).then(null, function () { return null; }) : null;
    });
  }
  function index() {
    if (L.ix) return Promise.resolve(L.ix);
    if (L.ixP) return L.ixP;
    L.ixP = Promise.all([fresh(BASE + VER + "/index.json", "lessons/" + VER + "/index.json"), fresh(api() + "index.json", VER + "/lessons/index.json")])
      .then(function (r) { L.ix = mergeIx(r[0], r[1]); L.ixP = null; return L.ix; });
    return L.ixP;
  }
  // Bundled file: memory, then the shipped file (refreshing the IndexedDB copy), then IndexedDB when offline.
  function appFile(mid) {
    var key = "lessons/" + VER + "/" + mid + ".json";
    return getJSON(BASE + VER + "/" + encodeURIComponent(mid) + ".json").then(function (f) { if (host.cachePut) host.cachePut(key, f); return f; }, function (e) {
      return (host.cacheGet ? host.cacheGet(key) : Promise.resolve(null)).then(function (hit) { if (!hit) throw e; return hit; });
    });
  }
  // Bank file: immutable once uploaded, so IndexedDB first (like the bank's module files), then the API; the bundled
  // file when the bank one cannot be had (offline before first open, or a 404).
  // A revised lesson ("r": 2 in the index) lives at v2/lessons/<key>.json; when that cannot be had the v1 copy stands in.
  function bankFile(mid, rev) {
    var ver = rev ? "v" + rev : VER, key = ver + "/lessons/" + mid + ".json", url = api().replace(/\/v\d{1,3}\/lessons\/$/, "/" + ver + "/lessons/");
    return (host.cacheGet ? host.cacheGet(key).then(null, function () { return null; }) : Promise.resolve(null)).then(function (hit) {
      return hit || getJSON(url + encodeURIComponent(mid) + ".json").then(function (f) { if (host.cachePut) host.cachePut(key, f); return f; });
    }).then(null, function () { return rev ? bankFile(mid, 0) : appFile(mid); });
  }
  function lessonFile(mid) {
    if (L.mem[mid]) return Promise.resolve(L.mem[mid]);
    return index().then(function (ix) { var m = ix.modules[mid]; return m && m.from === "bank" ? bankFile(mid, m.r > 1 && m.r < 100 ? m.r | 0 : 0) : appFile(mid); }).then(function (f) {
      f = tidyLesson(f);
      if (checkLesson(f).length) throw new Error("bad lesson");
      return (L.mem[mid] = f);
    });
  }
  function store() { var s = host.store(); if (!s.ls) s.ls = {}; if (!s.lsp) s.lsp = { r: 1, au: 0 }; return s; }

  /* ---------- narration ---------- */
  function plugin() { try { var C = G.Capacitor; return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.TextToSpeech || null; } catch (e) { return null; } }
  function canSpeak() { return !!(plugin() || (G.speechSynthesis && G.SpeechSynthesisUtterance)); }
  function stopVoice() {
    L.tok++;
    try { var P = plugin(); if (P && P.stop) P.stop().catch(function () {}); else if (G.speechSynthesis) G.speechSynthesis.cancel(); } catch (e) {}
  }
  function speak(text, rate, done) {
    stopVoice();
    var tok = ++L.tok, fin = function () { if (tok === L.tok) done(); };
    try {
      var P = plugin();
      if (P) { P.speak({ text: text, lang: "en-IN", rate: rate, pitch: 1, volume: 1, category: "playback" }).then(fin, function () { if (tok === L.tok) { L.playing = false; draw(); } }); return; }
      var u = new G.SpeechSynthesisUtterance(text);
      u.lang = "en-IN"; u.rate = rate; u.onend = fin;
      u.onerror = function () { if (tok === L.tok) { L.playing = false; draw(); } };
      G.speechSynthesis.speak(u);
    } catch (e) { L.playing = false; }
  }
  function narrate() {
    var s = store();
    speak(pageSay(), s.lsp.r, function () {
      if (!L.playing || L.fin) return;
      if (s.lsp.au && L.i < pages(L.les).length - 1) { go(L.i + 1, true); return; }
      L.playing = false; drawBar();
    });
  }
  function setPlaying(on) { L.playing = on && canSpeak(); if (L.playing) narrate(); else stopVoice(); drawBar(); }

  /* ---------- drawing ---------- */
  function ico(n) { return host.ico(n); }
  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  var ICO = {
    pause: '<path d="M8 5v14M16 5v14"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7M8 11h5"/>', ask: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 16.5h.01"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6"/>', redo: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.7M4 4v4.7h4.7"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    tick: '<path d="M20 6L9 17l-5-5"/>', cross: '<path d="M18 6L6 18M6 6l12 12"/>',
    tagl: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    cmp: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>', lr: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    cards: '<rect x="3" y="6" width="13" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v12"/>', list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>'
  };
  function svg(body, size) { return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>"; }
  function ic(n) { return ICO[n] ? svg(ICO[n]) : ico(n); }

  function tableHtml(v) {
    return '<div class="pn-vtbl" tabindex="0" role="region" aria-label="Table"><table><thead><tr>' + v.cols.map(function (c) { return '<th scope="col">' + boldHtml(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      v.rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return i ? "<td>" + boldHtml(c) + "</td>" : '<th scope="row">' + boldHtml(c) + "</th>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }
  // Layered flow: one row per level (longest path), nodes share a row equally, so a node's centre is (k + 0.5) / n
  // of the width. The gap under a row draws each edge as a line from the parent's centre to the child's centre, an
  // arrowhead on the child and the edge label at the midpoint.
  function flowHtml(v) {
    var rows = flowLevels(v.nodes, v.edges), pos = {}, by = {};
    v.nodes.forEach(function (n) { by[n.id] = n; });
    rows.forEach(function (r, li) { r.forEach(function (id, k) { pos[id] = { l: li, x: (k + 0.5) * 100 / r.length }; }); });
    var last = rows.length - 1, out = "";
    rows.forEach(function (r, li) {
      if (li) {
        var into = v.edges.filter(function (e) { return pos[e[1]].l === li; }), lab = into.some(function (e) { return e[2]; });
        out += '<div class="pn-fl-gap' + (lab ? " lab" : "") + '" aria-hidden="true"><svg viewBox="0 0 100 10" preserveAspectRatio="none">' +
          into.map(function (e) { return '<line x1="' + pos[e[0]].x + '" y1="0" x2="' + pos[e[1]].x + '" y2="10" vector-effect="non-scaling-stroke"/>'; }).join("") + "</svg>" +
          into.map(function (e) { return e[2] ? '<span class="pn-fl-lb" style="left:' + ((pos[e[0]].x + pos[e[1]].x) / 2).toFixed(2) + '%">' + escH(e[2]) + "</span>" : ""; }).join("") +
          r.map(function (id) { return '<i class="pn-fl-ah" style="left:' + pos[id].x.toFixed(2) + '%"></i>'; }).join("") + "</div>";
      }
      out += '<div class="pn-fl-row">' + r.map(function (id) {
        var n = by[id];
        return '<div class="pn-fn' + (li === 0 ? " root" : li === last ? " end" : "") + '"><b>' + boldHtml(n.label) + "</b>" + (n.sub ? "<small>" + boldHtml(n.sub) + "</small>" : "") + "</div>";
      }).join("") + "</div>";
    });
    // Screen readers get the same flow as a list of steps.
    var txt = v.edges.map(function (e) { return escH(by[e[0]].label) + " leads to " + escH(by[e[1]].label) + (e[2] ? " (" + escH(e[2]) + ")" : ""); });
    return '<div class="pn-flow" aria-hidden="true">' + out + '</div><ul class="pn-sr">' + txt.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul>";
  }
  function compareHtml(v) {
    var side = function (c) { return '<div class="pn-cmp-c"><h3>' + boldHtml(c.title) + "</h3><ul>" + c.points.map(function (p) { return "<li>" + boldHtml(p) + "</li>"; }).join("") + "</ul></div>"; };
    return '<div class="pn-cmp">' + side(v.left) + side(v.right) + "</div>";
  }
  // A bank path ("v7/ss-radiology/img/x.webp") goes through the bank API (lessonImgUrl); a root path on native gets the
  // API origin (imgUrl).
  function imgSrc(src) {
    var api = (host && host.bankApi) || G.SMD_PREP_BANK_API || "/api/prep/bank/", base = G.SMD_API_BASE || "";
    if (/^v\d{1,3}\//.test(str(src).replace(/^\/+/, ""))) { var u = lessonImgUrl(src, api); return u.charAt(0) === "/" && base ? base + u : u; }
    return imgUrl(src, api, base);
  }
  // Every figure of a lesson is fetched when it opens (not only as the reader reaches it), so a lesson opened once
  // online keeps its X-rays offline: figures are immutable and served with a one-year cache.
  function warm(les) {
    try { lessonImages(les).forEach(function (src) { var im = new G.Image(); im.decoding = "async"; im.src = imgSrc(src); }); } catch (e) {}
  }
  // width and height from the image's shape reserve its box before it loads (no jump under the text).
  function imgTag(src, alt, ar) {
    return '<img src="' + escH(imgSrc(src)) + '" alt="' + escH(alt) + '"' + (ar ? ' width="' + Math.round(ar * 1000) + '" height="1000"' : "") + ' loading="lazy" decoding="async">';
  }
  function imageHtml(v, i) {
    if (v.spot) return spotHtml(v, i);
    if (v.marks) return marksHtml(v, i);
    if (v.pair) return pairHtml(v, i);
    return '<figure class="pn-vfig"><button type="button" class="pn-vimg" data-act="l-zoom" aria-label="Enlarge image: ' + escH(v.alt) + '">' + imgTag(v.src, v.alt, v.ar) + "</button>" +
      '<figcaption><span class="pn-vzi" aria-hidden="true">' + ic("zoom") + "</span><span>" + escH(v.caption) + " Tap to enlarge.</span></figcaption></figure>";
  }
  function visHtml(v, i) {
    if (!v) return "";
    var inner = v.kind === "table" ? tableHtml(v) : v.kind === "flow" ? flowHtml(v) : v.kind === "compare" ? compareHtml(v) : v.kind === "image" ? imageHtml(v, i) : "";
    if (!inner) return "";
    return '<section class="pn-vis pn-vis-' + v.kind + '" aria-label="' + (v.kind === "image" ? (v.spot ? "Spot the sign" : v.marks ? "Labelled figure" : v.pair ? "Compare two images" : "Figure") : v.kind === "flow" ? "Flow diagram" : v.kind === "compare" ? "Comparison" : "Table") + '">' + inner + "</section>";
  }

  /* ---------- interactive parts ----------
     Answers live in L.ans[page] for this sitting, so going back shows what was done. A tap updates the part in place
     (classes and the feedback line), never the whole screen, so the figure does not reload or jump. */
  function ansOf(i) { return L.ans[i] || (L.ans[i] = {}); }
  function arVar(ar) { return ar ? ' style="--ar:' + ar + '"' : ""; }
  function pc(x) { return (x * 100).toFixed(2) + "%"; }
  function tag(icon, t) { return '<span class="pn-ix-tag">' + svg(ICO[icon], 15) + escH(t) + "</span>"; }
  function zoomBtn(z, alt) { return '<button type="button" class="pn-ix-zb" data-act="l-zoom" data-z="' + z + '" aria-label="Enlarge image: ' + escH(alt) + '">' + svg(ICO.expand, 18) + "</button>"; }
  function streakHtml() { return L.sc.run >= 2 ? '<p class="pn-streak">' + svg(ICO.bolt, 15) + "<b>" + L.sc.run + "</b> in a row</p>" : ""; }
  function score(ok) {
    L.sc.n++;
    if (ok) { L.sc.ok++; L.sc.run++; if (L.sc.run > L.sc.best) L.sc.best = L.sc.run; } else L.sc.run = 0;
    try { if (G.PREP_MOTION && G.PREP_MOTION.haptic) G.PREP_MOTION.haptic(ok ? "success" : "error"); } catch (e) {}
  }

  // Spot the sign: tap where the finding is. Right (inside the box, or within 4% of it) lights the box and its label;
  // a miss leaves a ring where the tap fell; the second miss, or "Show me", shows the answer.
  function spotFb(sp, a) {
    if (a.done) {
      return '<p class="pn-ix-res' + (a.hit ? " ok" : "") + '">' + (a.hit ? svg(ICO.tick, 18) + "<b>Found it.</b> " : "<b>Here it is:</b> ") + escH(sp.label) + "</p>" +
        '<p class="pn-ix-why">' + escH(sp.why) + "</p>" + (a.hit ? streakHtml() : "");
    }
    return (a.miss && a.miss.length ? '<p class="pn-ix-res bad">' + svg(ICO.cross, 18) + "<b>Not there.</b> One more try.</p>" : '<p class="pn-ix-hint">Tap the image where you see it.</p>') +
      '<button type="button" class="pn-btn pn-ix-show" data-act="l-show">Show me</button>';
  }
  function missHtml(m) { return '<i class="pn-spot-miss" style="left:' + pc(m[0]) + ";top:" + pc(m[1]) + '" aria-hidden="true"></i>'; }
  function spotHtml(v, i) {
    var a = ansOf(i), sp = v.spot, b = sp.box;
    return '<figure class="pn-vfig pn-ix pn-spot' + (a.done ? " done" + (a.hit ? " hit" : "") : "") + '">' +
      '<div class="pn-ix-head">' + tag("target", "Spot the sign") + '<p class="pn-ix-q">' + escH(sp.q) + "</p></div>" +
      '<div class="pn-ix-stage" data-spot="' + i + '"' + arVar(v.ar) + ">" + imgTag(v.src, v.alt, v.ar) +
      '<span class="pn-spot-box' + (b[1] < 0.14 ? " lo" : "") + '" style="left:' + pc(b[0]) + ";top:" + pc(b[1]) + ";width:" + pc(b[2]) + ";height:" + pc(b[3]) + '" aria-hidden="true"><b>' + escH(sp.label) + "</b></span>" +
      '<span class="pn-spot-ms">' + (a.miss || []).map(missHtml).join("") + "</span>" + zoomBtn("a", v.alt) + "</div>" +
      '<div class="pn-ix-fb" role="status" aria-live="polite">' + spotFb(sp, a) + "</div>" +
      "<figcaption>" + escH(v.caption) + "</figcaption></figure>";
  }
  function spotTap(stage, e) {
    var i = +stage.getAttribute("data-spot"), st = L.les.steps[i], sp = st && st.vis && st.vis.spot, a = ansOf(i), img = stage.querySelector("img");
    if (!sp || a.done || !img || (e.target.closest && e.target.closest(".pn-ix-zb"))) return;
    var r = img.getBoundingClientRect(), x = (e.clientX - r.left) / (r.width || 1), y = (e.clientY - r.top) / (r.height || 1);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    if (hitBox(sp.box, x, y)) { a.done = 1; a.hit = 1; score(true); }
    else {
      (a.miss = a.miss || []).push([x, y]);
      if (a.miss.length >= 2) { a.done = 1; score(false); }
      else try { if (G.PREP_MOTION && G.PREP_MOTION.haptic) G.PREP_MOTION.haptic("error"); } catch (x2) {}
      if (!reduced()) { stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake"); }
    }
    spotPaint(stage.closest(".pn-spot"), sp, a);
  }
  function spotPaint(fig, sp, a) {
    if (!fig) return;
    fig.className = "pn-vfig pn-ix pn-spot" + (a.done ? " done" + (a.hit ? " hit" : "") : "");
    var ms = fig.querySelector(".pn-spot-ms"), fb = fig.querySelector(".pn-ix-fb");
    if (ms) ms.innerHTML = (a.miss || []).map(missHtml).join("");
    if (fb) fb.innerHTML = spotFb(sp, a);
    if (a.done) { var nx = host.root && host.root().querySelector("[data-act=l-next]"); if (nx && G.document.activeElement && G.document.activeElement.getAttribute && G.document.activeElement.getAttribute("data-act") === "l-show") nx.focus(); }
  }

  // Reveal: numbered points on the figure; a tap on a number names that structure, "Show all" names every one.
  function marksHtml(v, i) {
    var a = ansOf(i), all = !!a.all, open = a.open || {};
    return '<figure class="pn-vfig pn-ix pn-reveal' + (all ? " all" : "") + '">' +
      '<div class="pn-ix-head">' + tag("tagl", "Label it") + '<p class="pn-ix-q">Tap a number to name it.</p>' +
      '<button type="button" class="pn-ix-tog" data-act="l-marks" aria-pressed="' + all + '">' + (all ? "Hide all" : "Show all") + "</button></div>" +
      '<div class="pn-ix-stage"' + arVar(v.ar) + ">" + imgTag(v.src, v.alt, v.ar) + v.marks.map(function (m, k) {
        var on = all || !!open[k];
        return '<button type="button" class="pn-mk' + (on ? " on" : "") + (m.x > 0.6 ? " l" : "") + '" style="left:' + pc(m.x) + ";top:" + pc(m.y) + '" data-act="l-mark" data-k="' + k + '" aria-expanded="' + on + '" aria-label="Point ' + (k + 1) + (on ? ": " + escH(m.label) : ", show its name") + '">' +
          "<i>" + (k + 1) + '</i><span class="pn-mk-l" aria-hidden="true">' + escH(m.label) + "</span></button>";
      }).join("") + zoomBtn("a", v.alt) + "</div>" +
      '<ol class="pn-mk-key">' + v.marks.map(function (m, k) { var on = all || !!open[k]; return '<li class="' + (on ? "on" : "") + '"><i>' + (k + 1) + "</i><span>" + (on ? escH(m.label) : "") + "</span></li>"; }).join("") + "</ol>" +
      "<figcaption>" + escH(v.caption) + "</figcaption></figure>";
  }
  function marksPaint(fig, v, a) {
    if (!fig) return;
    var all = !!a.all, open = a.open || {};
    fig.classList.toggle("all", all);
    var tg = fig.querySelector(".pn-ix-tog"); if (tg) { tg.setAttribute("aria-pressed", String(all)); tg.textContent = all ? "Hide all" : "Show all"; }
    [].forEach.call(fig.querySelectorAll(".pn-mk"), function (b, k) {
      var on = all || !!open[k], m = v.marks[k];
      b.classList.toggle("on", on); b.setAttribute("aria-expanded", String(on)); b.setAttribute("aria-label", "Point " + (k + 1) + (on ? ": " + m.label : ", show its name"));
    });
    [].forEach.call(fig.querySelectorAll(".pn-mk-key li"), function (li, k) { var on = all || !!open[k]; li.className = on ? "on" : ""; li.lastChild.textContent = on ? v.marks[k].label : ""; });
  }

  // Compare: a swipe slider over one frame when both images have the same shape, else the two side by side. The
  // slider also moves by keys (a range input) and by the three buttons under it (single-tap alternative to dragging).
  function pairHtml(v, i) {
    var p = v.pair, a = ansOf(i), ta = p.tagA || "This image", why = p.why ? '<p class="pn-ix-why">' + escH(p.why) + "</p>" : "";
    var head = '<div class="pn-ix-head">' + tag("cmp", "Compare") + '<p class="pn-ix-q">' + escH(ta) + " and " + escH(p.tag) + "</p></div>";
    if (sliderPair(v)) {
      var pos = a.pos == null ? 50 : a.pos;
      return '<figure class="pn-vfig pn-ix pn-pair sl">' + head +
        '<div class="pn-ix-stage pn-cmp-sl" data-cmp="' + i + '" style="--pos:' + pos + "%" + (v.ar ? ";--ar:" + v.ar : "") + '">' + imgTag(p.src, p.alt || p.tag, p.ar) +
        '<div class="pn-cmp-top" aria-hidden="true">' + imgTag(v.src, v.alt, v.ar) + "</div>" +
        '<span class="pn-cmp-h" aria-hidden="true"><i>' + svg(ICO.lr, 18) + "</i></span>" +
        '<span class="pn-cmp-t a" aria-hidden="true">' + escH(ta) + '</span><span class="pn-cmp-t b" aria-hidden="true">' + escH(p.tag) + "</span>" +
        '<input type="range" class="pn-cmp-r" min="0" max="100" step="1" value="' + pos + '" aria-label="Slide between ' + escH(ta) + " and " + escH(p.tag) + '" aria-valuetext="' + escH(cmpText(pos, ta, p.tag)) + '"></div>' +
        '<div class="pn-cmp-go" role="group" aria-label="Show">' + [[100, ta], [50, "Half and half"], [0, p.tag]].map(function (x) {
          return '<button type="button" class="pn-chip' + (pos === x[0] ? " on" : "") + '" data-act="l-cmp" data-v="' + x[0] + '" aria-pressed="' + (pos === x[0]) + '">' + escH(x[1]) + "</button>";
        }).join("") + "</div>" + why + "<figcaption>" + escH(v.caption) + "</figcaption></figure>";
    }
    var cell = function (z, src, alt, ar, t) { return '<button type="button" class="pn-cmp-cell" data-act="l-zoom" data-z="' + z + '" aria-label="Enlarge: ' + escH(t) + '"><span class="pn-cmp-t">' + escH(t) + "</span>" + imgTag(src, alt, ar) + "</button>"; };
    return '<figure class="pn-vfig pn-ix pn-pair">' + head + '<div class="pn-cmp2">' + cell("a", v.src, v.alt, v.ar, ta) + cell("b", p.src, p.alt || p.tag, p.ar, p.tag) + "</div>" +
      why + "<figcaption>" + escH(v.caption) + " Tap an image to enlarge.</figcaption></figure>";
  }
  function cmpText(pos, a, b) { return pos >= 95 ? a : pos <= 5 ? b : a + " " + pos + " percent, " + b + " " + (100 - pos) + " percent"; }
  function cmpSet(stage, pos, ease) {
    var i = +stage.getAttribute("data-cmp"), st = L.les.steps[i], p = st && st.vis && st.vis.pair;
    pos = Math.max(0, Math.min(100, Math.round(pos)));
    ansOf(i).pos = pos;
    stage.classList.toggle("ease", !!ease && !reduced());
    stage.style.setProperty("--pos", pos + "%");
    var r = stage.querySelector(".pn-cmp-r"); if (r) { r.value = String(pos); if (p) r.setAttribute("aria-valuetext", cmpText(pos, p.tagA || "This image", p.tag)); }
    var fig = stage.closest(".pn-pair");
    if (fig) [].forEach.call(fig.querySelectorAll("[data-act=l-cmp]"), function (b) { var on = +b.getAttribute("data-v") === pos; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  }
  function bindCmp(stage) {
    var on = false, x0 = 0, y0 = 0, lock = 0, last = null;
    var at = function (e) { var r = stage.getBoundingClientRect(); return (e.clientX - r.left) / (r.width || 1) * 100; };
    ON(stage, "lsn-cmp", "pointerdown", function (e) { if (e.target.closest && e.target.closest(".pn-cmp-r")) return; on = true; lock = 0; x0 = e.clientX; y0 = e.clientY; if (e.pointerType === "mouse") { cmpSet(stage, at(e), true); lock = 1; } });
    ON(stage, "lsn-cmp", "pointermove", function (e) {
      if (!on) return;
      if (!lock) { var dx = Math.abs(e.clientX - x0), dy = Math.abs(e.clientY - y0); if (dx < 6 && dy < 6) return; lock = dx > dy ? 1 : -1; if (lock > 0) { try { stage.setPointerCapture(e.pointerId); } catch (x) {} } }
      if (lock > 0) { e.preventDefault(); last = at(e); cmpSet(stage, last, false); }
    });
    var up = function (e) { if (on && !lock && e.type === "pointerup") cmpSet(stage, at(e), true); else if (on && lock > 0 && last != null) cmpSet(stage, last, false); on = false; last = null; };
    ON(stage, "lsn-cmp", "pointerup", up); ON(stage, "lsn-cmp", "pointercancel", up);
    var r = stage.querySelector(".pn-cmp-r"); if (r) ON(r, "lsn-cmp", "input", function () { cmpSet(stage, +r.value, false); });
  }

  // Quick check: one tap answers; the right option lights, a wrong pick is marked, the reason shows under it.
  function qcFb(q, k) {
    var ok = k === q.a;
    return '<p class="pn-ix-res ' + (ok ? "ok" : "bad") + '">' + svg(ok ? ICO.tick : ICO.cross, 18) + (ok ? "<b>Right.</b>" : "<b>Not quite.</b> The answer is " + escH(q.o[q.a]) + ".") + "</p>" +
      '<p class="pn-ix-why">' + escH(q.why || "") + "</p>" + (ok ? streakHtml() : "");
  }
  function qcHtml(q, i) {
    var a = ansOf(i), k = a.qc, done = k != null, tf = isTF(q);
    return '<section class="pn-qc' + (done ? " done" : "") + '" aria-label="Quick check" data-qc="' + i + '">' + tag("bolt", "Quick check") + '<p class="pn-qc-q">' + escH(q.q) + "</p>" +
      '<div class="pn-qc-o' + (tf ? " tf" : "") + '">' + q.o.map(function (o, j) {
        var cls = done ? (j === q.a ? " ok" : j === k ? " bad" : " dim") : "";
        return '<button type="button" class="pn-qc-b' + cls + '" data-act="l-qc" data-k="' + j + '"' + (done ? ' aria-disabled="true"' : "") + ">" +
          (done && j === q.a ? svg(ICO.tick, 18) : done && j === k ? svg(ICO.cross, 18) : "") + "<span>" + escH(o) + "</span></button>";
      }).join("") + '</div><div class="pn-ix-fb" role="status" aria-live="polite">' + (done ? qcFb(q, k) : "") + "</div></section>";
  }

  // Classic signs deck and key points: pages after the last step.
  function cardsPage() {
    var a = ansOf(L.i), f = a.flip || {};
    return '<div class="pn-pg-h">' + tag("cards", "Classic signs") + '<h2 class="pn-pg-t">What does each sign mean?</h2><p class="pn-pg-s">Say it to yourself, then tap the card to check.</p></div>' +
      '<div class="pn-flips">' + L.les.cards.map(function (c, k) {
        var on = !!f[k];
        return '<button type="button" class="pn-flip' + (on ? " on" : "") + '" data-act="l-flip" data-k="' + k + '" aria-pressed="' + on + '" aria-label="' + escH(c.f) + (on ? ": " + escH(c.b) : ", turn to see the meaning") + '">' +
          '<span class="pn-flip-in" aria-hidden="true"><span class="pn-flip-f"><small>Sign ' + (k + 1) + " of " + L.les.cards.length + "</small><b>" + escH(c.f) + "</b><em>" + svg(ICO.redo, 14) + "Tap to turn</em></span>" +
          '<span class="pn-flip-b"><small>' + escH(c.f) + "</small><span>" + escH(c.b) + "</span></span></span></button>";
      }).join("") + "</div>";
  }
  function scoreHtml() {
    var sc = L.sc;
    if (!sc.n) return "";
    return '<div class="pn-lsn-sc"><span><b>' + sc.ok + "</b> of " + sc.n + " right</span>" + (sc.best >= 2 ? "<span>Best streak <b>" + sc.best + "</b></span>" : "") + "</div>";
  }
  function keysPage() {
    return '<div class="pn-pg-h">' + tag("list", "Key points") + '<h2 class="pn-pg-t">' + escH(L.les.title) + "</h2></div>" +
      '<ol class="pn-keys">' + L.les.keys.map(function (k) { return "<li><i>" + svg(ICO.tick, 16) + "</i><span>" + boldHtml(k) + "</span></li>"; }).join("") + "</ol>" + scoreHtml();
  }
  function page() { return pages(L.les)[L.i]; }
  function pageSay() {
    var p = page(), les = L.les;
    if (p === "cards") return "Classic signs. " + les.cards.map(function (c) { return c.f + ". " + c.b; }).join(" ");
    if (p === "keys") return "Key points. " + les.keys.join(" ").replace(/\*\*/g, "");
    return les.steps[p].say;
  }

  // Ask MaiK (prep-ask.js) is always offered: on this phone or online, and the sheet says which works here. Without it,
  // the older offline-only teacher, only when MaiK runs on this phone.
  function askable() { if (G.PREP_ASK) return true; var T = G.PREP_TEACHER; try { return !!(T && T.explainStep && T.ready && T.ready()); } catch (e) { return false; } }
  function barHtml() {
    var s = store(), last = L.i === pages(L.les).length - 1, speak = canSpeak();
    return '<div class="pn-lsn-bar" id="pnLsnBar"><div class="pn-lsn-bin">' +
      (askable() ? '<button type="button" class="pn-ib" data-act="l-ask" aria-label="Ask MaiK about this step">' + (G.SMD_MAIK_MARK ? G.SMD_MAIK_MARK.html("mark", { size: 24, cls: "pl-mkai" }) : ic("ask")) + "</button>" : "") +
      '<button type="button" class="pn-ib" data-act="l-prev" aria-label="Previous step"' + (L.i ? "" : " disabled") + ">" + ic("back") + "</button>" +
      // Play is a pill: the icon and a small waveform that moves only while the voice speaks.
      (speak ? '<button type="button" class="pn-lsn-play' + (L.playing ? " on" : "") + '" data-act="l-play" aria-pressed="' + L.playing + '" aria-label="' + (L.playing ? "Pause narration" : "Play narration") + '">' + ic(L.playing ? "pause" : "play") +
        '<span class="pn-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></button>' +
        '<button type="button" class="pn-lsn-spd" data-act="l-speed" aria-label="Narration speed ' + s.lsp.r + ' times, change">' + speedLabel(s.lsp.r) + "</button>" : "") +
      '<button type="button" class="pn-btn pri pn-lsn-next" data-act="l-next">' + (last ? "Finish" : "Next") + " " + ic(last ? "check" : "next") + "</button></div></div>";
  }
  function drawBar() { var r = host.root && host.root(), el = r && r.querySelector("#pnLsnBar"); if (el) el.outerHTML = barHtml(); }
  function readerHtml() {
    var les = L.les, pg = pages(les), n = pg.length, p = pg[L.i], s = store(), step = typeof p === "number" ? les.steps[p] : null;
    var autoBtn = canSpeak() ? '<button type="button" class="pn-lsn-auto' + (s.lsp.au ? " on" : "") + '" data-act="l-auto" aria-pressed="' + !!s.lsp.au + '" aria-label="Auto-advance with narration">Auto</button>' : "";
    var anim = L.dir ? (L.dir > 0 ? " fwd" : " rev") : "";
    var body = step ? '<article class="pn-lsn-step' + anim + '" tabindex="-1" aria-roledescription="lesson step">' +
        '<p class="pn-lsn-tx">' + boldHtml(step.tx) + "</p>" + visHtml(step.vis, p) + (step.qc ? qcHtml(step.qc, p) : "") + "</article>"
      : '<article class="pn-lsn-step pn-lsn-pg pn-pg-' + p + anim + '" tabindex="-1" aria-roledescription="lesson step">' + (p === "cards" ? cardsPage() : keysPage()) + "</article>";
    // Share IDs (prep-ids.js): share in the bar, the lesson's ID at the foot of the page (tap copies).
    var IDS = G.PREP_IDS, lid = IDS ? IDS.ofLesson(L.key) : null, shareB = lid ? IDS.shareBtn(lid, "Share this lesson") : "";
    return host.bar(escH(les.title), (step ? "Step " : "Page ") + (L.i + 1) + " of " + n, "back", autoBtn && shareB ? '<span class="pn-acts">' + autoBtn + shareB + "</span>" : autoBtn || shareB) +
      '<div class="pn-lsn-prog" role="progressbar" aria-label="Lesson progress" aria-valuemin="1" aria-valuemax="' + n + '" aria-valuenow="' + (L.i + 1) + '">' +
      pg.map(function (x, k) { var ix = typeof x !== "number" || interactive(les.steps[x]); return "<i" + (k <= L.i || ix ? ' class="' + (k <= L.i ? "on" : "") + (k === L.i ? " cur" : "") + (ix ? " ix" : "") + '"' : "") + "></i>"; }).join("") + "</div>" +
      '<div class="pn-body pn-lsn" id="pnLsn">' + body +
      (L.i === 0 && canSpeak() ? '<p class="pn-note">Narration uses this device\'s own voice.</p>' : "") +
      (lid ? IDS.chip(lid) : "") + "</div>" + barHtml();
  }
  function finishHtml() {
    var les = L.les, s = store(), total = 0;
    for (var k in s.ls) total += s.ls[k].xp || 0;
    var nq = (les.quiz || []).length;
    var fx = L.fx || {}, cele = fx.m0 && host.celeFor ? host.celeFor(fx.m0, fx) : null;
    var line = host.maikLine ? host.maikLine({ subject: L.sid }, fx) : "";
    return host.bar(escH(les.title), "Lesson finished", "back") + '<div class="pn-body"><section class="pn-panel pn-lsn-fin" role="status" tabindex="-1"' + (fx.cf && L.firstXp ? ' data-cf="1"' : "") + (host.celeAttrs ? host.celeAttrs(cele) : "") + ">" + (host.celeChip ? host.celeChip(cele) : "") +
      (L.sc.n ? '<p class="pn-mut pn-lsn-fsc">' + L.sc.ok + " of " + L.sc.n + " answers right" + (L.sc.best >= 2 ? ", best streak " + L.sc.best : "") + "</p>" : "") +
      (L.firstXp ? '<p class="pn-lsn-xp"><b>+' + L.firstXp + '</b> XP</p><p class="pn-mut">' + les.steps.length + " steps read. Lesson XP so far: " + host.fmt(total) + "</p>"
        : '<p class="pn-lsn-xp"><b>Done</b></p><p class="pn-mut">Read again. XP counts the first time through; lesson XP so far: ' + host.fmt(total) + "</p>") +
      (nq ? '<button type="button" class="pn-btn pri" data-act="l-quiz">' + ico("play") + " " + nq + " quick questions</button>" : "") +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="l-again">' + ic("redo") + ' Read again</button><button type="button" class="pn-btn" data-act="back">Done</button></div>' +
      (nq ? '<p class="pn-mut pn-small">The questions come from this module\'s bank and are scheduled for spaced review like any other answer.</p>' : "") + "</section>" + line + "</div>";
  }
  function interactive(s) { var v = s && s.vis; return !!(s && (s.qc || (v && v.kind === "image" && (v.spot || v.marks || v.pair)))); }
  // L.zoom: { src, alt, caption } of the figure being enlarged (the main image, or the second one of a compare).
  function zoomHtml() {
    var z = L.zoom;
    return '<div class="pn-zoom" role="dialog" aria-modal="true" aria-label="Image, enlarged" id="pnZoom"><div class="pn-zoom-top"><p>' + escH(z.caption) + '</p><button type="button" class="pn-ib" data-act="l-unzoom" aria-label="Close image">' + ic("close") + "</button></div>" +
      '<div class="pn-zoom-sc"><button type="button" class="pn-zoom-b" data-act="l-zoom2" aria-pressed="false" aria-label="Enlarge further"><img src="' + escH(imgSrc(z.src)) + '" alt="' + escH(z.alt) + '"></button></div><p class="pn-zoom-h">Pinch or tap to zoom, drag to look around</p></div>';
  }
  function zoomOf(z) {
    var p = page(), v = typeof p === "number" && L.les.steps[p].vis;
    if (!v || v.kind !== "image") return null;
    if (z === "b" && v.pair) return { src: v.pair.src, alt: v.pair.alt || v.pair.tag, caption: v.pair.tag + ". " + (v.pair.why || v.caption) };
    return { src: v.src, alt: v.alt, caption: v.pair ? (v.pair.tagA || "This image") + ". " + v.caption : v.caption };
  }
  function draw(focus) {
    if (!L.les || !host) return;
    var r = host.root && host.root(); if (!r) return;
    host.paint(L.fin ? finishHtml() : readerHtml() + (L.zoom ? zoomHtml() : ""), focus || (L.fin ? ".pn-lsn-fin" : L.zoom ? "[data-act=l-unzoom]" : null));
    L.dir = 0;
    if (!L.fin) { bindSwipe(r.querySelector("#pnLsn")); bindIx(r); }
    if (L.zoom) bindPinch(r.querySelector(".pn-zoom-sc"));
  }
  function bindIx(r) {
    [].forEach.call(r.querySelectorAll("[data-spot]"), function (st) { ON(st, "lsn-spot", "click", function (e) { spotTap(st, e); }); });
    [].forEach.call(r.querySelectorAll("[data-cmp]"), bindCmp);
  }
  /* The enlarged image: pinch between 1x and 4x around the fingers' midpoint, drag to pan once zoomed, tap to toggle
     2.2x (the button, so keys work too). Transform only; it eases back to 1x when let go under 1.05x. */
  var Z = { s: 1, x: 0, y: 0, moved: 0 };
  function zoomTo(img, s, x, y, ease) {
    var w = img.offsetWidth || 1, h = img.offsetHeight || 1, mx = (s - 1) * w / 2, my = (s - 1) * h / 2;
    Z.s = s; Z.x = Math.max(-mx, Math.min(mx, x)); Z.y = Math.max(-my, Math.min(my, y));
    img.style.transition = ease ? "transform 240ms cubic-bezier(.23, 1, .32, 1)" : "none";
    img.style.transform = "translate(" + Z.x.toFixed(1) + "px, " + Z.y.toFixed(1) + "px) scale(" + Z.s.toFixed(3) + ")";
  }
  function bindPinch(sc) {
    var btn = sc && sc.querySelector(".pn-zoom-b"), img = btn && btn.querySelector("img");
    if (!img) return;
    Z = { s: 1, x: 0, y: 0, moved: 0 };
    var pts = {}, g = null;
    var list = function () { return Object.keys(pts).map(function (k) { return pts[k]; }); };
    var start = function () {
      var p = list(), r = img.getBoundingClientRect(), cx = r.left + r.width / 2 - Z.x, cy = r.top + r.height / 2 - Z.y;
      if (p.length >= 2) g = { pinch: 1, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, s: Z.s, x: Z.x, y: Z.y, mx: (p[0].x + p[1].x) / 2 - cx, my: (p[0].y + p[1].y) / 2 - cy };
      else if (p.length === 1) g = { pinch: 0, px: p[0].x, py: p[0].y, x: Z.x, y: Z.y };
      else g = null;
    };
    ON(sc, "lsn", "pointerdown", function (e) { pts[e.pointerId] = { x: e.clientX, y: e.clientY }; try { sc.setPointerCapture(e.pointerId); } catch (x) {} start(); });
    ON(sc, "lsn", "pointermove", function (e) {
      if (!pts[e.pointerId] || !g) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var p = list();
      if (g.pinch && p.length >= 2) {
        var s = Math.max(1, Math.min(4, g.s * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / g.d)), k = s / g.s;
        zoomTo(img, s, g.mx - (g.mx - g.x) * k, g.my - (g.my - g.y) * k, false); Z.moved = Date.now();
      } else if (!g.pinch && Z.s > 1) {
        var dx = e.clientX - g.px, dy = e.clientY - g.py;
        if (Math.abs(dx) + Math.abs(dy) > 6) { zoomTo(img, Z.s, g.x + dx, g.y + dy, false); Z.moved = Date.now(); }
      }
    });
    var up = function (e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      if (!list().length && Z.s < 1.05) { zoomTo(img, 1, 0, 0, true); btn.classList.remove("big"); btn.setAttribute("aria-pressed", "false"); }
      else if (Z.s > 1.05) { btn.classList.add("big"); btn.setAttribute("aria-pressed", "true"); }
      start();
    };
    ON(sc, "lsn", "pointerup", up); ON(sc, "lsn", "pointercancel", up);
  }
  function bindSwipe(el) {
    if (!el) return;
    var x0 = 0, y0 = 0, on = false;
    ON(el, "lsn", "pointerdown", function (e) { if (e.pointerType === "mouse" || (e.target.closest && e.target.closest(".pn-vtbl,.pn-cmp-sl,.pn-flips"))) return; on = true; x0 = e.clientX; y0 = e.clientY; });
    ON(el, "lsn", "pointerup", function (e) { if (!on) return; on = false; var d = swipeDir(e.clientX - x0, e.clientY - y0); if (d > 0) next(); else if (d < 0 && L.i) go(L.i - 1); });
    ON(el, "lsn", "pointercancel", function () { on = false; });
  }

  /* ---------- navigation ---------- */
  function save() {
    var s = store(), n = pages(L.les).length, p = s.ls[L.key] || (s.ls[L.key] = { i: 0, n: n, done: 0, xp: 0 });
    p.i = L.i; p.n = n; host.save();
  }
  function go(i, keepVoice) {
    L.dir = i > L.i ? 1 : -1; L.i = i; save();
    draw(L.dir > 0 ? "[data-act=l-next]" : "[data-act=l-prev]");
    if (L.playing) narrate(); else if (!keepVoice) stopVoice();
  }
  function next() {
    if (L.i < pages(L.les).length - 1) return go(L.i + 1);
    var s = store(), p = s.ls[L.key];
    L.playing = false; stopVoice();
    L.firstXp = 0;
    // Celebrations: the level before this lesson's XP (balloons on a milestone), and whether another lesson was already
    // finished today (confetti only for the first lesson of the day). A repaint of the same finish keeps L.fx.
    var m0 = host.snap ? host.snap() : null, td = host.today(), core = host.core && host.core(), dayOf = function (ms) { try { return core.dayNum(ms, new Date(ms).getTimezoneOffset()); } catch (e) { return -1; } };
    var earlier = Object.keys(s.ls).some(function (k) { return k !== L.key && s.ls[k].done && dayOf(s.ls[k].done) === td; });
    L.fx = { m0: m0, cf: !earlier };
    if (!p.done) { p.xp = xpFor(L.les) + XP_HIT * L.sc.ok; L.firstXp = p.xp; }
    p.done = Date.now(); p.i = 0; host.save();
    L.fin = true; draw();
  }
  function startQuiz() {
    var les = L.les;
    host.loadModule(L.sid, L.mid).then(function (items) {
      var list = pickQuiz(host.pool(items), les.quiz);
      if (!list.length) return host.toast("These questions are not available right now. Practise the module instead.");
      host.run(list, "study", "Quick questions: " + les.title);
    }, function () { host.toast("The questions need a connection the first time. Try again online."); });
  }

  /* ---------- public ---------- */
  function entrySub(key, meta, s) {
    // a lesson keyed apart from its module (radnotes) may carry fewer than 3 questions, and the index does not say how many
    var p = s.ls && s.ls[key], sub = meta.minutes + " min · " + meta.steps + " steps" + (meta.module && meta.module !== key ? "" : ", then 3 quick questions");
    if (p && p.done) sub = "Finished · read again or take the questions";
    else if (p && p.i) sub = "Continue from step " + (p.i + 1) + " of " + meta.steps;
    return sub;
  }
  function rowHtml(sid, mid, key, meta, s, label) {
    return '<button type="button" class="pn-row" data-act="l-open" data-s="' + escH(sid) + '" data-m="' + escH(mid) + '" data-l="' + escH(key) + '"><span class="pn-ri" aria-hidden="true">' + ic("book") +
      '</span><span class="pn-rb"><b>' + escH(label) + "</b><small>" + escH(entrySub(key, meta, s)) + "</small></span>" + ico("chev") + "</button>";
  }
  var SHOW = 3;
  /* The module's lessons: one row reads "Lesson"; several are listed by title, the first 3 then "Show all". */
  function entryHtml(sid, mid, list, s) {
    if (list.length === 1) return '<h2 class="pn-sec pn-lsn-h">Learn</h2><div class="pn-group pn-lsn-entry">' + rowHtml(sid, mid, list[0][0], list[0][1], s, list[0][1].title || "Lesson") + "</div>";
    var all = L.more[mid] || list.length <= SHOW + 1, shown = all ? list : list.slice(0, SHOW);
    return '<h2 class="pn-sec pn-lsn-h">Learn <span class="pn-mut">' + list.length + " lessons</span></h2>" +
      '<div class="pn-group pn-lsn-entry">' + shown.map(function (x) { return rowHtml(sid, mid, x[0], x[1], s, x[0] === mid ? "Lesson" : x[1].title || "Lesson"); }).join("") +
      (all ? "" : '<button type="button" class="pn-row" data-act="l-more" data-s="' + escH(sid) + '" data-m="' + escH(mid) + '"><span class="pn-rb"><b>Show all ' + list.length + " lessons</b></span>" + ico("chev") + "</button>") + "</div>";
  }
  /* mount(slotEl, sid, mid, h): fills the module screen's lesson slot once the index is known (empty when none). */
  function mount(slot, sid, mid, h) {
    host = h;
    if (!slot) return;
    index().then(function (ix) {
      var list = lessonsFor(ix, mid);
      if (!list.length || !slot.isConnected) return;
      slot.innerHTML = entryHtml(sid, mid, list, store());
    });
  }
  /* subjectButton(wrap, sid, topics, h): on the subject screen, a secondary Learn button in the actions block (under
     Practise, before "Start with last settings") when any module of the subject has a lesson; nothing otherwise. */
  function subjectButton(wrap, sid, topics, h) {
    host = h;
    if (!wrap) return;
    index().then(function (ix) {
      var mods = subjectLessons(ix, topics), n = 0;
      mods.forEach(function (m) { n += m.list.length; });
      if (!n || !wrap.isConnected) return;
      if (wrap.querySelector("[data-act=l-subject]")) { wrap.hidden = false; return; }
      var b = G.document.createElement("button");
      b.type = "button"; b.__pnKeep = 1; b.className = "pn-btn pn-sublearn"; b.setAttribute("data-act", "l-subject"); b.setAttribute("data-s", sid);
      b.innerHTML = ic("book") + '<span class="pn-sl-t">Learn</span><span class="pn-sl-n">' + n + (n === 1 ? " lesson" : " lessons") + "</span>";
      var last = wrap.querySelector(".su-lastb");
      wrap.insertBefore(b, last || null);
      wrap.hidden = false;
    });
  }
  /* openSubject(sid, h): the subject's lessons, grouped by module in module order. */
  function openSubject(sid, h) {
    host = h;
    var view = function () {
      var ixs = host.ix ? host.ix() : {}, topics = (ixs[sid] && ixs[sid].topics) || [], sb = host.subjectById(sid), name = sb ? host.tx(sb.name) : "";
      index().then(function (ix) {
        if (host.stackTop() !== view) return;
        var mods = subjectLessons(ix, topics), s = store(), n = 0, done = 0;
        mods.forEach(function (m) { m.list.forEach(function (x) { n++; if (s.ls[x[0]] && s.ls[x[0]].done) done++; }); });
        host.paint(host.bar("Learn", escH(name), "back") + '<div class="pn-body pn-lsn-all">' +
          (n ? '<p class="pn-mut pn-lsn-sum">' + n + (n === 1 ? " lesson" : " lessons") + " in " + mods.length + (mods.length === 1 ? " module" : " modules") + (done ? ", " + done + " finished" : "") + ". Each is a few short steps you can listen to, then quick questions.</p>" : '<p class="pn-empty">No lessons for this subject yet.</p>') +
          mods.map(function (m) {
            return '<section class="pn-lsn-mod"><h2 class="pn-sec">' + host.tx(m.topic.title) + '</h2><div class="pn-group">' + m.list.map(function (x) { return rowHtml(sid, m.mid, x[0], x[1], s, x[1].title || "Lesson"); }).join("") + "</div></section>";
          }).join("") + "</div>");
      });
    };
    host.push(view);
  }
  /* open(sid, mid, h, key): key defaults to the module's own lesson. */
  // fromStart: a shared lesson ID opens at the first step, whatever this phone's saved place.
  function open(sid, mid, h, key, fromStart) {
    host = h;
    key = key || mid;
    L.sid = sid; L.mid = mid; L.key = key; L.fin = false; L.zoom = null; L.playing = false; L.ans = {}; L.sc = { ok: 0, n: 0, run: 0, best: 0 };
    var view = function () { if (L.les && L.key === key) draw(); };
    var loading = function () { host.paint(host.bar("Lesson", "", "back") + '<div class="pn-body"><p class="pn-load" role="status">Loading the lesson…</p></div>'); };
    L.view = view; L.loading = loading;
    host.push(loading);
    lessonFile(key).then(function (les) {
      if (host.stackTop() !== loading) return;   // left while loading
      var s = store(), p = s.ls[key];
      L.les = les; L.i = !fromStart && p && !p.done && p.i < pages(les).length ? p.i : 0; L.dir = 0;
      save(); warm(les);
      var stk = host.stack(); stk[stk.length - 1] = view;
      draw();
    }, function () {
      if (host.stackTop() !== loading) return;
      host.paint(host.bar("Lesson", "", "back") + '<div class="pn-body"><p class="pn-err" role="alert">The lesson did not load. Check the connection and try again. A lesson opened once works offline.</p><button type="button" class="pn-btn" data-act="l-open" data-s="' + escH(sid) + '" data-m="' + escH(mid) + '" data-l="' + escH(key) + '">Try again</button></div>');
    });
  }
  function act(a, b, h) {
    host = h;
    if (a === "l-subject") return openSubject(b.getAttribute("data-s"), h);
    if (a === "l-open") { if (L.loading && host.stackTop() === L.loading) host.stack().pop(); return open(b.getAttribute("data-s"), b.getAttribute("data-m"), h, b.getAttribute("data-l") || ""); }
    if (a === "l-more") {
      var mm = b.getAttribute("data-m"), slot = b.closest && b.closest("#pnLsnSlot");
      L.more[mm] = 1;
      if (slot) return index().then(function (ix) { slot.innerHTML = entryHtml(b.getAttribute("data-s"), mm, lessonsFor(ix, mm), store()); var r = slot.querySelectorAll("[data-act=l-open]")[SHOW]; if (r && r.focus) r.focus(); });
      return;
    }
    if (!L.les) return;
    if (a === "l-next") return next();
    if (a === "l-prev") { if (L.i) go(L.i - 1); return; }
    if (a === "l-play") return setPlaying(!L.playing);
    if (a === "l-speed") { var s = store(); s.lsp.r = nextSpeed(s.lsp.r); host.save(); if (L.playing) narrate(); return drawBar(); }
    if (a === "l-auto") { var s2 = store(); s2.lsp.au = s2.lsp.au ? 0 : 1; host.save(); return draw("[data-act=l-auto]"); }
    if (a === "l-zoom") {
      // The shared PrepNucleus image viewer when it is loaded (window.PREP_VIEWER.open), else the reader's own enlarge.
      var zz = zoomOf(b.getAttribute("data-z") || "a"), PV = G.PREP_VIEWER;
      if (zz && PV && typeof PV.open === "function") { try { PV.open({ src: imgSrc(zz.src), alt: zz.alt, caption: zz.caption, from: b }); return; } catch (e) {} }
      L.zoom = zz; if (L.zoom) { L.zret = b.getAttribute("data-z") ? '[data-act=l-zoom][data-z="' + b.getAttribute("data-z") + '"]' : "[data-act=l-zoom]"; draw(); } return; }
    if (a === "l-show" || a === "l-qc" || a === "l-marks" || a === "l-mark" || a === "l-flip" || a === "l-cmp") return ixAct(a, b);
    if (a === "l-zoom2") {
      if (Date.now() - Z.moved < 350) return;   // the click that ends a pinch or a pan is not a tap
      var big = Z.s <= 1.05, img = b.querySelector("img");
      b.classList.toggle("big", big); b.setAttribute("aria-pressed", String(big));
      if (img) zoomTo(img, big ? 2.2 : 1, 0, 0, !reduced());
      return;
    }
    if (a === "l-unzoom") { L.zoom = null; return draw(L.zret || "[data-act=l-zoom]"); }
    if (a === "l-again") { L.fin = false; L.i = 0; L.dir = 0; L.ans = {}; L.sc = { ok: 0, n: 0, run: 0, best: 0 }; save(); return draw(); }
    if (a === "l-quiz") return startQuiz();
    if (a === "l-ask") { var pg = page(), st = typeof pg === "number" ? L.les.steps[pg] : { tx: pageSay(), say: pageSay(), vis: null }; L.playing = false; stopVoice(); if (G.PREP_ASK) return G.PREP_ASK.open({ kind: "step", step: st, title: L.les.title }, host); return G.PREP_TEACHER.explainStep(st, L.les.title, host); }
  }
  /* back(): true when handled here (the zoomed image closes first). Leaving the reader stops the voice. */
  function back() {
    if (!host || !L.les) return false;
    if (L.zoom && host.stackTop() === L.view) { L.zoom = null; draw(L.zret || "[data-act=l-zoom]"); return true; }
    if (host.stackTop() === L.view) { L.playing = false; stopVoice(); }
    return false;
  }
  function leave() { L.playing = false; L.zoom = null; stopVoice(); }
  /* Taps on the interactive parts. Each updates its own part in place and keeps the focus on the control. */
  function ixAct(a, b) {
    var r = host.root && host.root(), p = page(), step = typeof p === "number" ? L.les.steps[p] : null, v = step && step.vis, ans = ansOf(L.i), k = +b.getAttribute("data-k");
    if (a === "l-show") {
      if (!v || !v.spot || ans.done) return;
      ans.done = 1; score(false);
      var fig = b.closest(".pn-spot");
      spotPaint(fig, v.spot, ans);
      var nx = r && r.querySelector("[data-act=l-next]"); if (nx) nx.focus();
      return;
    }
    if (a === "l-qc") {
      var q = step && step.qc; if (!q || ans.qc != null || !(k >= 0 && k < q.o.length)) return;
      ans.qc = k; score(k === q.a);
      var sec = b.closest(".pn-qc"); if (!sec) return;
      sec.outerHTML = qcHtml(q, p);
      var nb = r && r.querySelector('.pn-qc [data-k="' + k + '"]'); if (nb) nb.focus();
      return;
    }
    if (a === "l-marks" || a === "l-mark") {
      if (!v || !v.marks) return;
      if (a === "l-marks") { ans.all = !ans.all; if (!ans.all) ans.open = {}; }
      else { ans.open = ans.open || {}; if (ans.all) { ans.all = false; ans.open = {}; v.marks.forEach(function (m, j) { ans.open[j] = 1; }); } ans.open[k] = ans.open[k] ? 0 : 1; }
      marksPaint(b.closest(".pn-reveal"), v, ans);
      return;
    }
    if (a === "l-cmp") { var stage = b.closest(".pn-pair") && b.closest(".pn-pair").querySelector("[data-cmp]"); if (stage) cmpSet(stage, +b.getAttribute("data-v"), true); return; }
    if (a === "l-flip") {
      var f = ans.flip || (ans.flip = {}), c = L.les.cards && L.les.cards[k]; if (!c) return;
      f[k] = f[k] ? 0 : 1;
      b.classList.toggle("on", !!f[k]); b.setAttribute("aria-pressed", String(!!f[k]));
      b.setAttribute("aria-label", c.f + (f[k] ? ": " + c.b : ", turn to see the meaning"));
      if (f[k]) try { if (G.PREP_MOTION && G.PREP_MOTION.haptic) G.PREP_MOTION.haptic("light"); } catch (e) {}
    }
  }
  /* Keys in the reader (an iPad with a keyboard, a laptop): ArrowRight next step, ArrowLeft previous, Space play or
     pause. Only while the reader is the top screen with no sheet or enlarged image over it; never while typing, never
     on a table that scrolls sideways (its arrows scroll it), and Space stays the button's own key on a focused control. */
  function onKey(e) {
    if (!host || !L.les || L.fin || L.zoom || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var k = e.key, r = host.root && host.root(), t = e.target;
    if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== " " && k !== "Spacebar") return;
    if (!r || !r.querySelector("#pnLsn") || host.stackTop() !== L.view || r.querySelector(".pn-sheet-wrap,.pn-zoom")) return;
    if (t && t.closest && (t.closest("input,textarea,select,[contenteditable]") || (k !== " " && k !== "Spacebar" && t.closest(".pn-vtbl")))) return;
    if (k === "ArrowRight") { e.preventDefault(); return next(); }
    if (k === "ArrowLeft") { e.preventDefault(); if (L.i) go(L.i - 1); return; }
    if (!canSpeak() || (t && t.closest && t.closest("button,a,[role=button]"))) return;
    e.preventDefault(); setPlaying(!L.playing);
  }
  if (G.document && G.document.addEventListener) G.document.addEventListener("keydown", onKey);

  G.PREP_LESSONS = { mount: mount, subjectButton: subjectButton, openSubject: openSubject, open: open, act: act, back: back, leave: leave, index: index, _pure: PURE, _l: L };
})(typeof window !== "undefined" ? window : this);
