/* PrepNucleus Lessons: short chapter lessons (text on top, one visual below, read aloud, then 3 quick questions).
   window.PREP_LESSONS. ES5. Loaded by prep-loader.js after prep.js and drawn through PREP._host (the same overlay,
   back stack, runner and store). prep.js forwards every data-act starting "l-" here and asks back() first on back.

   Data: prep/lessons/v1/index.json { v, modules: { <module>: { title, minutes, steps } } } and
   prep/lessons/v1/<module>.json { v, module, title, minutes, steps: [{ tx, say, vis }], quiz: [item ids], src, gen, checks }.
   tx marks key terms with **bold**; say is the plain narration; vis is null or one of
   { kind: "table", cols, rows } | { kind: "flow", nodes: [{ id, label, sub? }], edges: [[from, to, label?]] } |
   { kind: "compare", left: { title, points }, right: { title, points } } | { kind: "image", src, alt, caption }.
   Built by tools/prep-lessons.mjs (gates there) or by hand (gen "hand"). Files ship in www/prep/lessons and are kept
   in IndexedDB after the first open, like the bank's module files.

   Narration: @capacitor-community/text-to-speech on native (the plugin maik-ask.js and CliniX viva use), else the
   browser's speechSynthesis. Neither sends audio or text anywhere. Pure helpers load under node for tests. */
(function (G) {
  "use strict";

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
    if (v.kind === "image") return str(v.alt) + " \n" + str(v.caption);
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
  function nextSpeed(r) { var i = SPEEDS.indexOf(r); return SPEEDS[(i + 1) % SPEEDS.length]; }
  function speedLabel(r) { return String(r).replace(/^0\./, ".") + "x"; }
  function xpFor(l) { return (l && l.steps ? l.steps.length : 0) * XP_STEP; }
  /* swipeDir(dx, dy) -> 1 (next), -1 (back) or 0: a clear horizontal swipe of 56 px or more. */
  function swipeDir(dx, dy) { return Math.abs(dx) >= 56 && Math.abs(dx) > 1.5 * Math.abs(dy) ? (dx < 0 ? 1 : -1) : 0; }
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
    swipeDir: swipeDir, pickQuiz: pickQuiz };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= app ================= */
  var BASE = G.SMD_PREP_LESSONS_BASE || (G.SMD_PREP_BASE || "/prep/") + "lessons/";
  var VER = "v1";
  var L = { ix: null, ixP: null, mem: {}, les: null, sid: null, mid: null, i: 0, fin: false, playing: false, tok: 0, zoom: false, dir: 0, view: null, firstXp: 0 };
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
  function bankFile(mid) {
    var key = VER + "/lessons/" + mid + ".json";
    return (host.cacheGet ? host.cacheGet(key).then(null, function () { return null; }) : Promise.resolve(null)).then(function (hit) {
      return hit || getJSON(api() + encodeURIComponent(mid) + ".json").then(function (f) { if (host.cachePut) host.cachePut(key, f); return f; });
    }).then(null, function () { return appFile(mid); });
  }
  function lessonFile(mid) {
    if (L.mem[mid]) return Promise.resolve(L.mem[mid]);
    return index().then(function (ix) { var m = ix.modules[mid]; return m && m.from === "bank" ? bankFile(mid) : appFile(mid); }).then(function (f) {
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
    var s = store(), step = L.les.steps[L.i];
    speak(step.say, s.lsp.r, function () {
      if (!L.playing || L.fin) return;
      if (s.lsp.au && L.i < L.les.steps.length - 1) { go(L.i + 1, true); return; }
      L.playing = false; drawBar();
    });
  }
  function setPlaying(on) { L.playing = on && canSpeak(); if (L.playing) narrate(); else stopVoice(); drawBar(); }

  /* ---------- drawing ---------- */
  function ico(n) { return host.ico(n); }
  var ICO = {
    pause: '<path d="M8 5v14M16 5v14"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7M8 11h5"/>', ask: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 16.5h.01"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6"/>', redo: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.7M4 4v4.7h4.7"/>'
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
  function imgSrc(src) { return "/" + str(src).replace(/^\/+/, ""); }
  function imageHtml(v) {
    return '<figure class="pn-vfig"><button type="button" class="pn-vimg" data-act="l-zoom" aria-label="Enlarge image: ' + escH(v.alt) + '"><img src="' + escH(imgSrc(v.src)) + '" alt="' + escH(v.alt) + '" loading="lazy" decoding="async"></button>' +
      '<figcaption><span class="pn-vzi" aria-hidden="true">' + ic("zoom") + "</span><span>" + escH(v.caption) + " Tap to enlarge.</span></figcaption></figure>";
  }
  function visHtml(v) {
    if (!v) return "";
    var inner = v.kind === "table" ? tableHtml(v) : v.kind === "flow" ? flowHtml(v) : v.kind === "compare" ? compareHtml(v) : v.kind === "image" ? imageHtml(v) : "";
    return '<section class="pn-vis pn-vis-' + v.kind + '" aria-label="' + (v.kind === "image" ? "Figure" : v.kind === "flow" ? "Flow diagram" : v.kind === "compare" ? "Comparison" : "Table") + '">' + inner + "</section>";
  }

  function askable() { var T = G.PREP_TEACHER; try { return !!(T && T.explainStep && T.ready && T.ready()); } catch (e) { return false; } }
  function barHtml() {
    var s = store(), last = L.i === L.les.steps.length - 1, speak = canSpeak();
    return '<div class="pn-lsn-bar" id="pnLsnBar">' +
      (askable() ? '<button type="button" class="pn-ib" data-act="l-ask" aria-label="Ask MaiK about this step">' + ic("ask") + "</button>" : "") +
      '<button type="button" class="pn-ib" data-act="l-prev" aria-label="Previous step"' + (L.i ? "" : " disabled") + ">" + ic("back") + "</button>" +
      (speak ? '<button type="button" class="pn-lsn-play' + (L.playing ? " on" : "") + '" data-act="l-play" aria-pressed="' + L.playing + '" aria-label="' + (L.playing ? "Pause narration" : "Play narration") + '">' + ic(L.playing ? "pause" : "play") + "</button>" +
        '<button type="button" class="pn-lsn-spd" data-act="l-speed" aria-label="Narration speed ' + s.lsp.r + ' times, change">' + speedLabel(s.lsp.r) + "</button>" : "") +
      '<button type="button" class="pn-btn pri pn-lsn-next" data-act="l-next">' + (last ? "Finish" : "Next") + " " + ic(last ? "check" : "next") + "</button></div>";
  }
  function drawBar() { var r = host.root && host.root(), el = r && r.querySelector("#pnLsnBar"); if (el) el.outerHTML = barHtml(); }
  function readerHtml() {
    var les = L.les, n = les.steps.length, step = les.steps[L.i], s = store();
    var autoBtn = canSpeak() ? '<button type="button" class="pn-lsn-auto' + (s.lsp.au ? " on" : "") + '" data-act="l-auto" aria-pressed="' + !!s.lsp.au + '" aria-label="Auto-advance with narration">Auto</button>' : "";
    return host.bar(escH(les.title), "Step " + (L.i + 1) + " of " + n, "back", autoBtn) +
      '<div class="pn-lsn-prog" role="progressbar" aria-label="Lesson progress" aria-valuemin="1" aria-valuemax="' + n + '" aria-valuenow="' + (L.i + 1) + '">' +
      les.steps.map(function (x, k) { return "<i" + (k <= L.i ? ' class="on"' : "") + "></i>"; }).join("") + "</div>" +
      '<div class="pn-body pn-lsn" id="pnLsn"><article class="pn-lsn-step' + (L.dir ? (L.dir > 0 ? " fwd" : " rev") : "") + '" tabindex="-1" aria-roledescription="lesson step">' +
      '<p class="pn-lsn-tx">' + boldHtml(step.tx) + "</p>" + visHtml(step.vis) + "</article>" +
      (L.i === 0 && canSpeak() ? '<p class="pn-note">Narration uses this device\'s own voice.</p>' : "") +
      "</div>" + barHtml();
  }
  function finishHtml() {
    var les = L.les, s = store(), total = 0;
    for (var k in s.ls) total += s.ls[k].xp || 0;
    var nq = (les.quiz || []).length;
    return host.bar(escH(les.title), "Lesson finished", "back") + '<div class="pn-body"><section class="pn-panel pn-lsn-fin" role="status" tabindex="-1">' +
      (L.firstXp ? '<p class="pn-lsn-xp"><b>+' + L.firstXp + '</b> XP</p><p class="pn-mut">' + les.steps.length + " steps read. Lesson XP so far: " + host.fmt(total) + "</p>"
        : '<p class="pn-lsn-xp"><b>Done</b></p><p class="pn-mut">Read again. XP counts the first time through; lesson XP so far: ' + host.fmt(total) + "</p>") +
      (nq ? '<button type="button" class="pn-btn pri" data-act="l-quiz">' + ico("play") + " " + nq + " quick questions</button>" : "") +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="l-again">' + ic("redo") + ' Read again</button><button type="button" class="pn-btn" data-act="back">Done</button></div>' +
      (nq ? '<p class="pn-mut pn-small">The questions come from this module\'s bank and are scheduled for spaced review like any other answer.</p>' : "") + "</section></div>";
  }
  function zoomHtml() {
    var v = L.les.steps[L.i].vis;
    return '<div class="pn-zoom" role="dialog" aria-modal="true" aria-label="Image, enlarged" id="pnZoom"><div class="pn-zoom-top"><p>' + escH(v.caption) + '</p><button type="button" class="pn-ib" data-act="l-unzoom" aria-label="Close image">' + ic("close") + "</button></div>" +
      '<div class="pn-zoom-sc"><button type="button" class="pn-zoom-b" data-act="l-zoom2" aria-pressed="false" aria-label="Enlarge further"><img src="' + escH(imgSrc(v.src)) + '" alt="' + escH(v.alt) + '"></button></div><p class="pn-zoom-h">Tap the image to enlarge it further</p></div>';
  }
  function draw(focus) {
    if (!L.les || !host) return;
    var r = host.root && host.root(); if (!r) return;
    host.paint(L.fin ? finishHtml() : readerHtml() + (L.zoom ? zoomHtml() : ""), focus || (L.fin ? ".pn-lsn-fin" : L.zoom ? "[data-act=l-unzoom]" : null));
    L.dir = 0;
    if (!L.fin) bindSwipe(r.querySelector("#pnLsn"));
  }
  function bindSwipe(el) {
    if (!el) return;
    var x0 = 0, y0 = 0, on = false;
    el.addEventListener("pointerdown", function (e) { if (e.pointerType === "mouse" || (e.target.closest && e.target.closest(".pn-vtbl"))) return; on = true; x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener("pointerup", function (e) { if (!on) return; on = false; var d = swipeDir(e.clientX - x0, e.clientY - y0); if (d > 0) next(); else if (d < 0 && L.i) go(L.i - 1); });
    el.addEventListener("pointercancel", function () { on = false; });
  }

  /* ---------- navigation ---------- */
  function save() {
    var s = store(), p = s.ls[L.mid] || (s.ls[L.mid] = { i: 0, n: L.les.steps.length, done: 0, xp: 0 });
    p.i = L.i; p.n = L.les.steps.length; host.save();
  }
  function go(i, keepVoice) {
    L.dir = i > L.i ? 1 : -1; L.i = i; save();
    draw(L.dir > 0 ? "[data-act=l-next]" : "[data-act=l-prev]");
    if (L.playing) narrate(); else if (!keepVoice) stopVoice();
  }
  function next() {
    if (L.i < L.les.steps.length - 1) return go(L.i + 1);
    var s = store(), p = s.ls[L.mid];
    L.playing = false; stopVoice();
    L.firstXp = 0;
    if (!p.done) { p.xp = xpFor(L.les); L.firstXp = p.xp; }
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
  function entryHtml(sid, mid, meta, s) {
    var p = s.ls && s.ls[mid], sub = meta.minutes + " min · " + meta.steps + " steps, then 3 quick questions";
    if (p && p.done) sub = "Finished · read again or take the questions";
    else if (p && p.i) sub = "Continue from step " + (p.i + 1) + " of " + meta.steps;
    return '<div class="pn-group pn-lsn-entry"><button type="button" class="pn-row" data-act="l-open" data-s="' + escH(sid) + '" data-m="' + escH(mid) + '"><span class="pn-ri" aria-hidden="true">' + ic("book") +
      '</span><span class="pn-rb"><b>Lesson</b><small>' + escH(sub) + "</small></span>" + ico("chev") + "</button></div>";
  }
  /* mount(slotEl, sid, mid, h): fills the module screen's lesson slot once the index is known (empty when none). */
  function mount(slot, sid, mid, h) {
    host = h;
    if (!slot) return;
    index().then(function (ix) {
      var meta = ix.modules[mid];
      if (!meta || !slot.isConnected) return;
      slot.innerHTML = entryHtml(sid, mid, meta, store());
    });
  }
  function open(sid, mid, h) {
    host = h;
    L.sid = sid; L.mid = mid; L.fin = false; L.zoom = false; L.playing = false;
    var view = function () { if (L.les && L.les.module === mid) draw(); };
    var loading = function () { host.paint(host.bar("Lesson", "", "back") + '<div class="pn-body"><p class="pn-load" role="status">Loading the lesson</p></div>'); };
    L.view = view; L.loading = loading;
    host.push(loading);
    lessonFile(mid).then(function (les) {
      if (host.stackTop() !== loading) return;   // left while loading
      var s = store(), p = s.ls[mid];
      L.les = les; L.i = p && !p.done && p.i < les.steps.length ? p.i : 0; L.dir = 0;
      save();
      var stk = host.stack(); stk[stk.length - 1] = view;
      draw();
    }, function () {
      if (host.stackTop() !== loading) return;
      host.paint(host.bar("Lesson", "", "back") + '<div class="pn-body"><p class="pn-err" role="alert">The lesson did not load. Check the connection and try again. A lesson opened once works offline.</p><button type="button" class="pn-btn" data-act="l-open" data-s="' + escH(sid) + '" data-m="' + escH(mid) + '">Try again</button></div>');
    });
  }
  function act(a, b, h) {
    host = h;
    if (a === "l-open") { if (L.loading && host.stackTop() === L.loading) host.stack().pop(); return open(b.getAttribute("data-s"), b.getAttribute("data-m"), h); }
    if (!L.les) return;
    if (a === "l-next") return next();
    if (a === "l-prev") { if (L.i) go(L.i - 1); return; }
    if (a === "l-play") return setPlaying(!L.playing);
    if (a === "l-speed") { var s = store(); s.lsp.r = nextSpeed(s.lsp.r); host.save(); if (L.playing) narrate(); return drawBar(); }
    if (a === "l-auto") { var s2 = store(); s2.lsp.au = s2.lsp.au ? 0 : 1; host.save(); return draw("[data-act=l-auto]"); }
    if (a === "l-zoom") { L.zoom = true; return draw(); }
    if (a === "l-zoom2") { var big = b.classList.toggle("big"); b.setAttribute("aria-pressed", String(big)); return; }
    if (a === "l-unzoom") { L.zoom = false; return draw("[data-act=l-zoom]"); }
    if (a === "l-again") { L.fin = false; L.i = 0; L.dir = 0; save(); return draw(); }
    if (a === "l-quiz") return startQuiz();
    if (a === "l-ask") { var st = L.les.steps[L.i]; L.playing = false; stopVoice(); return G.PREP_TEACHER.explainStep(st, L.les.title, host); }
  }
  /* back(): true when handled here (the zoomed image closes first). Leaving the reader stops the voice. */
  function back() {
    if (!host || !L.les) return false;
    if (L.zoom && host.stackTop() === L.view) { L.zoom = false; draw("[data-act=l-zoom]"); return true; }
    if (host.stackTop() === L.view) { L.playing = false; stopVoice(); }
    return false;
  }
  function leave() { L.playing = false; L.zoom = false; stopVoice(); }

  G.PREP_LESSONS = { mount: mount, open: open, act: act, back: back, leave: leave, index: index, _pure: PURE, _l: L };
})(typeof window !== "undefined" ? window : this);
