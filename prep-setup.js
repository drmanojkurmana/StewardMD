/* PrepNucleus practice setup: the sheet a student sees before a set starts. window.PREP_SETUP. ES5.
   Loaded by prep-loader.js after prep.js; draws through PREP._host. prep.js forwards every data-act starting "su-" here,
   asks back() first, and opens the sheet from a module, a subject, the custom module and My mistakes; prep-pyq.js from a
   paper, a paper's subject and a module's PYQs; prep-create.js from a deck.

   The student chooses:
     Question type   All / Image-based / Clinical scenario / One-liner / Mix
     How many        10 / 20 / 30 / 50, or a custom count (stepper), never more than the pool
     New or repeat   New / Incorrect before / Bookmarked / Due for review / All / Mix
     Difficulty      Easy / Moderate / Hard / Very hard / Mix (item.d 1, 2, 3, 4; Mix keeps the pool's own spread)
     Mode            Practice (marked at once) / Timed test
     Timer           Off / Per question (30, 45, 60, 90 s or custom) / Whole set (exam pace, 1 min a question, or custom
                     minutes). Per question: a timed test moves on when the time is up (the question stays unanswered);
                     practice only shows the ring. A timed test always has a clock (Off is not offered there).
   Every option shows how many questions it leaves, live. The last choice is remembered per scope (localStorage
   smd_prep_setup, "<kind>:<id>" then "<kind>"). An empty pool says which filter to relax.

   Image-based: the item has an image placed with the stem (img + imgPlace "stem"); a previous-year item with an image
   counts too. Clinical scenario or one-liner: stemKind() below, cached on the item as _k.
   One tap for repeat users: quick() starts a set with the scope's remembered settings without the sheet (prep.js puts a
   "Last settings" button next to Practice on a module, a subject, bookmarks and My mistakes).

   The draw reuses prep.js customDraw (n questions spread across modules, one difficulty or any) as its only picker. A
   "Mix" splits the count first: type Mix in equal thirds, repeat Mix 50% new, 30% due, 20% incorrect before (a short
   group's share goes to the others), difficulty Mix in proportion to the pool. Pure helpers load under node. */
(function (G) {
  "use strict";
  var isNode = typeof module !== "undefined" && module.exports && !(G && G.document);
  function core() { return isNode ? require("./prep.js") : (G.PREP && G.PREP._pure); }

  /* ================= pure ================= */
  /* Clinical scenario vs one-liner, from the stem alone. Points:
       age ("45-year-old", "45 yrs/M", "aged 60")                      +2
       a person ("man", "woman", "child", "patient", "primigravida")    +1
       a strong vignette cue ("presents with", "complains of", "brought to", "admitted with", "on examination",
         "examination reveals", "investigations show", "came with")    +2, +1 more for a second different cue
       a weak cue ("history of", "h/o", "developed", "noticed", "for the past", "since")  +1
       vital signs with a number ("BP 90/60", "pulse 120")              +1
       length: 35 words or more +2, 22 to 34 words +1
     3 points or more is a clinical scenario; anything else a one-liner. An item tagged as a USMLE vignette (ex has
     "usmle") is a scenario whatever its score. Examples: "A 45-year-old man presents with chest pain" = 5;
     "Drug of choice for absence seizures in a child" = 1; "In a patient with history of MI, which drug" = 2. */
  var CASE_MIN = 3, LONG_WORDS = 35, MID_WORDS = 22;
  var AGE = [/\b\d{1,3}\s*[- ]?\s*(?:years?|yrs?|months?|mo|weeks?|wks?|days?)\s*[- ]?\s*old\b/i,
    /\b\d{1,3}\s*(?:y|yr|yrs|years?)\s*[\/,-]?\s*(?:m|f|male|female)\b/i, /\baged?\s+\d{1,3}\b/i];
  var PERSON = /\b(?:man|woman|men|women|male|female|boy|girl|child|infant|neonate|newborn|baby|lady|gentleman|patient|primigravida|multigravida|primi|gravida|toddler|adolescent|teenager|mother|elderly)\b/i;
  var STRONG = [/\bpresent(?:s|ed|ing)? (?:to [^.]{0,40})?with\b/i, /\bcomplain(?:s|ed|ing)? of\b/i, /\bc\/o\b/i, /\bbrought (?:to|with|by)\b/i,
    /\badmitted (?:with|for|to)\b/i, /\bon examination\b|\bo\/e\b/i, /\bexamination (?:reveals|revealed|shows|showed)\b/i,
    /\binvestigations? (?:reveal|revealed|show|showed)\b|\blabs? (?:show|showed|reveal)\b/i, /\b(?:came|comes) (?:to [^.]{0,30})?with\b/i];
  var WEAK = [/\bhistory of\b|\bh\/o\b/i, /\bdevelop(?:s|ed)\b/i, /\bnoticed\b/i, /\bfor the (?:past|last)\b/i, /\bsince \d/i];
  var VITALS = /\b(?:BP|blood pressure|pulse|heart rate|HR|temperature|RR|respiratory rate|SpO2|saturation)\b[^.]{0,20}\d/i;
  function stemScore(q) {
    var s = String(q || ""), n = 0, strong = 0, words = (s.match(/\S+/g) || []).length;
    if (AGE.some(function (r) { return r.test(s); })) n += 2;
    if (PERSON.test(s)) n += 1;
    STRONG.forEach(function (r) { if (r.test(s)) strong++; });
    if (strong) n += strong > 1 ? 3 : 2;
    if (WEAK.some(function (r) { return r.test(s); })) n += 1;
    if (VITALS.test(s)) n += 1;
    if (words >= LONG_WORDS) n += 2; else if (words >= MID_WORDS) n += 1;
    return n;
  }
  function stemKind(q, ex) { return (ex && ex.indexOf && ex.indexOf("usmle") >= 0) || stemScore(q) >= CASE_MIN ? "case" : "line"; }
  // Cached on the item (bank items live in memory for the session, deck items are re-read each time).
  function kindOf(it) { if (!it._k) it._k = stemKind(it.q, it.ex); return it._k; }
  function hasImg(it) { return !!(it && it.img && it.img.length && (it.imgPlace === "stem" || it._py)); }
  function typeOf(it) { return hasImg(it) ? "img" : kindOf(it); }

  /* ---------- repeat state from the FSRS store ----------
     ctx = { cards, today, mt, bm }. cards[key] = [d, s, lastDay, dueDay, reps, lapses] (specialty-core.js).
     Incorrect before: in My mistakes, a lapse on the card, or the last answer was wrong (a miss is scheduled for the
     next day, dueDay - lastDay = 1; a right first answer is at least 2 days out). */
  function cardOf(it, ctx) { return ctx && ctx.cards ? ctx.cards["p:" + (it._m || it.t) + ":" + it.id] : null; }
  function wrongBefore(it, ctx, c) { c = c === undefined ? cardOf(it, ctx) : c; return !!((ctx && ctx.mt && ctx.mt[it.id]) || (c && (c[5] > 0 || c[3] - c[2] === 1))); }
  // One bucket per item for the repeat Mix: due, else incorrect before, else new, else seen (none of those).
  function seenOf(it, ctx) {
    var c = cardOf(it, ctx);
    if (!c) return "new";
    if (c[3] <= ctx.today) return "due";
    return wrongBefore(it, ctx, c) ? "wrong" : "seen";
  }
  function seenMatch(it, v, ctx) {
    if (v === "all" || v === "mix") return true;
    var c = cardOf(it, ctx);
    if (v === "new") return !c;
    if (v === "due") return !!c && c[3] <= ctx.today;
    if (v === "wrong") return wrongBefore(it, ctx, c);
    if (v === "bm") return !!(ctx && ctx.bm && ctx.bm[it.id]);
    return true;
  }
  // Very hard items carry vh: true in the bank files (d 3 there); the app counts them as level 4.
  function dOf(it) { return it.vh === true || it.d === 4 ? 4 : it.d === 1 || it.d === 3 ? it.d : 2; }

  var TYPES = [["all", "All"], ["img", "Image-based"], ["case", "Clinical scenario"], ["line", "One-liner"], ["mix", "Mix"]];
  var SEENS = [["new", "New"], ["wrong", "Incorrect before"], ["bm", "Bookmarked"], ["due", "Due for review"], ["all", "All"], ["mix", "Mix"]];
  var DIFFS = [["1", "Easy"], ["2", "Moderate"], ["3", "Hard"], ["4", "Very hard"], ["mix", "Mix"]];
  var COUNTS = [10, 20, 30, 50], N_MAX = 200;
  var TIMERS = [["off", "Off"], ["q", "Per question"], ["set", "Whole set"]], QSECS = [30, 45, 60, 90];
  var DEFAULTS = { type: "all", seen: "mix", d: "mix", n: 20, mode: "study", timer: "off", qs: 60, mins: 0 };
  function pickOf(list, v, d) { for (var i = 0; i < list.length; i++) if (String(list[i][0]) === String(v)) return String(v); return d; }
  // A saved or partial choice -> a whole valid one.
  function normSel(sel) {
    sel = sel || {};
    var n = Math.round(+sel.n);
    var qs = Math.round(+sel.qs), mins = Math.round(+sel.mins);
    return { type: pickOf(TYPES, sel.type, DEFAULTS.type), seen: pickOf(SEENS, sel.seen, DEFAULTS.seen), d: pickOf(DIFFS, sel.d, DEFAULTS.d),
      n: n >= 1 && n <= N_MAX ? n : DEFAULTS.n, mode: sel.mode === "exam" ? "exam" : "study", timer: pickOf(TIMERS, sel.timer, DEFAULTS.timer),
      qs: qs >= 10 && qs <= 600 ? qs : DEFAULTS.qs, mins: mins >= 1 && mins <= 600 ? mins : 0 };
  }
  // A timed test always runs a clock: Off there means the whole set at exam pace.
  function timerOf(sel) { return sel.mode === "exam" && sel.timer === "off" ? "set" : sel.timer; }
  /* runOpts(sel, n) -> the runner's clock options (prep.js runQuestions): { qsec } per question, { limit } seconds for
     the whole set (mins, or 1 minute a question at exam pace), {} none. */
  function runOpts(sel, n) {
    sel = normSel(sel);
    var t = timerOf(sel);
    if (t === "q") return { qsec: sel.qs };
    if (t === "set") return { limit: (sel.mins || Math.max(1, n)) * 60 };
    return {};
  }
  // "20 questions · new · hard · timed test, 60 s a question": the last settings in one line.
  function summary(sel) {
    sel = normSel(sel);
    var parts = [sel.n + (sel.n === 1 ? " question" : " questions")], t = timerOf(sel);
    if (sel.type !== "all") parts.push(sel.type === "mix" ? "mixed types" : LABEL.type[sel.type]);
    if (sel.seen !== "all" && sel.seen !== "mix") parts.push(LABEL.seen[sel.seen]);
    if (sel.d !== "mix") parts.push(LABEL.d[sel.d]);
    var m = sel.mode === "exam" ? "timed test" : "practice";
    if (t === "q") m += ", " + sel.qs + " s a question"; else if (t === "set") m += ", " + (sel.mins ? sel.mins + " min" : "1 min a question");
    parts.push(m);
    return parts.join(" \u00b7 ");
  }
  // Does the item pass every row (skip: a row left out, for that row's own counts).
  function keep(it, sel, ctx, skip) {
    if (skip !== "type" && sel.type !== "all" && sel.type !== "mix" && typeOf(it) !== sel.type) return false;
    if (skip !== "seen" && !seenMatch(it, sel.seen, ctx)) return false;
    if (skip !== "d" && sel.d !== "mix" && String(dOf(it)) !== sel.d) return false;
    return true;
  }
  function flat(lists) { var out = []; (lists || []).forEach(function (l) { out = out.concat(l || []); }); return out; }
  /* counts(lists, sel, ctx) -> { total, type: { all, img, ... }, seen: {...}, d: {...} }: the pool each option would
     leave with the other rows as chosen. All and Mix leave their row open, so they share a count. */
  function counts(lists, sel, ctx) {
    var items = flat(lists), out = { total: 0, type: {}, seen: {}, d: {} };
    TYPES.forEach(function (t) { out.type[t[0]] = 0; }); SEENS.forEach(function (t) { out.seen[t[0]] = 0; }); DIFFS.forEach(function (t) { out.d[t[0]] = 0; });
    items.forEach(function (it) {
      if (keep(it, sel, ctx)) out.total++;
      if (keep(it, sel, ctx, "type")) { out.type.all++; out.type.mix++; out.type[typeOf(it)]++; }
      if (keep(it, sel, ctx, "seen")) {
        out.seen.all++; out.seen.mix++;
        SEENS.forEach(function (s) { if (s[0] !== "all" && s[0] !== "mix" && seenMatch(it, s[0], ctx)) out.seen[s[0]]++; });
      }
      if (keep(it, sel, ctx, "d")) { out.d.mix++; out.d[String(dOf(it))]++; }
    });
    return out;
  }
  /* allocate(caps, n, w) -> quotas: n shared across groups by weight (largest remainder), never more than a group holds;
     what a full group cannot take goes to the others by weight, then to any group with room (weight 0 included). */
  function allocate(caps, n, w) {
    var keys = Object.keys(caps), q = {}, left = n;
    keys.forEach(function (k) { q[k] = 0; });
    for (var round = 0; round < 8 && left > 0; round++) {
      var open = keys.filter(function (k) { return q[k] < caps[k] && (+w[k] || 0) > 0; }), tot = 0;
      if (!open.length) break;
      open.forEach(function (k) { tot += +w[k]; });
      var give = {}, used = 0, rest = [];
      open.forEach(function (k) { var x = left * (+w[k]) / tot, g = Math.min(caps[k] - q[k], Math.floor(x)); give[k] = g; used += g; rest.push({ k: k, r: x - Math.floor(x) }); });
      rest.sort(function (a, b) { return b.r - a.r || (a.k < b.k ? -1 : 1); });
      for (var i = 0; used < left && i < rest.length; i++) { var k = rest[i].k; if (q[k] + give[k] < caps[k]) { give[k]++; used++; } }
      open.forEach(function (k) { q[k] += give[k]; });
      if (!used) break;
      left -= used;
    }
    keys.forEach(function (k) { var room = caps[k] - q[k], t = Math.min(room, left); if (t > 0) { q[k] += t; left -= t; } });
    return q;
  }
  var DIMS = {
    type: { keys: ["img", "case", "line"], of: function (it) { return typeOf(it); }, w: { img: 1, "case": 1, line: 1 } },
    seen: { keys: ["new", "due", "wrong", "seen"], of: function (it, ctx) { return seenOf(it, ctx); }, w: { "new": 0.5, due: 0.3, wrong: 0.2, seen: 0 } },
    d: { keys: ["1", "2", "3", "4"], of: function (it) { return String(dOf(it)); }, w: null }   // null: in proportion to the pool
  };
  function pick(lists, n, dims, ctx, rnd) {
    if (n <= 0) return [];
    if (!dims.length) return core().customDraw(lists, n, 0, rnd);
    var dim = DIMS[dims[0]], rest = dims.slice(1), groups = {}, caps = {};
    dim.keys.forEach(function (k) {
      groups[k] = lists.map(function (l) { return l.filter(function (it) { return dim.of(it, ctx) === k; }); });
      caps[k] = 0; groups[k].forEach(function (l) { caps[k] += l.length; });
    });
    var q = allocate(caps, n, dim.w || caps), out = [];
    dim.keys.forEach(function (k) { out = out.concat(pick(groups[k], q[k], rest, ctx, rnd)); });
    return out;
  }
  /* draw(lists, sel, ctx, rnd) -> up to sel.n items: lists are the pool per module (so customDraw can spread them). */
  function draw(lists, sel, ctx, rnd) {
    sel = normSel(sel);
    var L = (lists || []).map(function (l) { return (l || []).filter(function (it) { return keep(it, sel, ctx); }); }).filter(function (l) { return l.length; });
    var dims = [];
    if (sel.seen === "mix") dims.push("seen");
    if (sel.type === "mix") dims.push("type");
    if (sel.d === "mix") dims.push("d");
    return core().shuffle(pick(L, sel.n, dims, ctx, rnd), rnd);
  }
  var LABEL = { type: { img: "image-based", "case": "clinical scenario", line: "one-liner" }, seen: { "new": "new", wrong: "incorrect before", bm: "bookmarked", due: "due for review" }, d: { 1: "easy", 2: "moderate", 3: "hard", 4: "very hard" } };
  var RELAX = { type: "Question type: All", seen: "New or repeat: All", d: "Difficulty: Mix" };
  /* An empty pool: which one row to open up, the one that frees the most questions. { msg, dim } or null when the
     scope itself has nothing. */
  function relaxHint(lists, sel, ctx) {
    sel = normSel(sel);
    var c = counts(lists, sel, ctx), best = null;
    if (c.total) return null;
    [["type", "all"], ["seen", "all"], ["d", "mix"]].forEach(function (x) {
      if (sel[x[0]] === x[1] || (x[0] !== "d" && sel[x[0]] === "mix")) return;
      var n = x[0] === "type" ? c.type.all : x[0] === "seen" ? c.seen.all : c.d.mix;
      if (n && (!best || n > best.n)) best = { dim: x[0], n: n };
    });
    if (!best) return flat(lists).length ? { dim: null, msg: "No question here fits these choices together. Set every row to All or Mix." } : { dim: null, msg: "This set has no questions to practise yet." };
    var what = LABEL[best.dim][sel[best.dim]] || "";
    return { dim: best.dim, n: best.n, msg: "No " + what + " questions match. Choose " + RELAX[best.dim] + " for " + best.n + (best.n === 1 ? " question." : " questions.") };
  }
  // Remembered choices: { "<kind>:<id>": sel, "<kind>": sel }, newest 40 kept.
  function remember(map, kind, id, sel) {
    map = map && typeof map === "object" ? map : {};
    var s = normSel(sel), out = {}, keys;
    s.t = Date.now();
    map[kind] = s; if (id) map[kind + ":" + id] = s;
    keys = Object.keys(map).sort(function (a, b) { return ((map[b] && map[b].t) || 0) - ((map[a] && map[a].t) || 0); }).slice(0, 40);
    keys.forEach(function (k) { out[k] = map[k]; });
    return out;
  }
  function recall(map, kind, id) { map = map || {}; return normSel((id && map[kind + ":" + id]) || map[kind] || null); }
  function hasLast(map, kind, id) { map = map || {}; return !!((id && map[kind + ":" + id]) || map[kind]); }

  var PURE = { CASE_MIN: CASE_MIN, LONG_WORDS: LONG_WORDS, MID_WORDS: MID_WORDS, stemScore: stemScore, stemKind: stemKind, kindOf: kindOf, hasImg: hasImg, typeOf: typeOf, dOf: dOf,
    wrongBefore: wrongBefore, seenOf: seenOf, seenMatch: seenMatch, normSel: normSel, keep: keep, counts: counts, allocate: allocate, draw: draw, relaxHint: relaxHint,
    remember: remember, recall: recall, hasLast: hasLast, timerOf: timerOf, runOpts: runOpts, summary: summary, TIMERS: TIMERS, QSECS: QSECS, TYPES: TYPES, SEENS: SEENS, DIFFS: DIFFS, COUNTS: COUNTS, N_MAX: N_MAX, DEFAULTS: DEFAULTS };
  if (isNode) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var KEY = "smd_prep_setup";
  var S = null;   // the open sheet: { scope, sel, lists, ctx, host, prev, loading, err }
  function readMap() { try { return JSON.parse(G.localStorage.getItem(KEY) || "null") || {}; } catch (e) { return {}; } }
  function writeMap(m) { try { G.localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {} }
  // Older suites and quick paths start at once: SMD_PREP_SETUP = false skips the sheet.
  function enabled() { return G.SMD_PREP_SETUP !== false; }
  var IC = {
    type: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
    seen: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
    d: '<path d="M4 20h16M7 16v-3M12 16V9M17 16V5"/>',
    n: '<path d="M5 7h14M5 12h14M5 17h9"/>',
    mode: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
    head: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17" cy="6" r="2.2"/><circle cx="14" cy="18" r="2.2"/>'
  };
  function svg(n) { return '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + IC[n] + "</svg>"; }

  /* open(scope, host). scope = { kind, id, title, sub?, rows?: { seen: false, type: false }, load() -> Promise([items] per module),
     start(list, mode, sel) }. The sheet sits over the screen that opened it; Start closes it and starts the set. */
  function open(scope, host) {
    close(true);
    var map = readMap(), sel = recall(map, scope.kind, scope.id);
    if (scope.mode) sel.mode = scope.mode;
    if (scope.rows && scope.rows.seen === false) sel.seen = "all";
    S = { scope: scope, sel: sel, lists: null, host: host, prev: G.document.activeElement, loading: true, err: "" };
    var s = host.store();
    S.ctx = { cards: s.cards || {}, today: host.today(), mt: s.mt || {}, bm: s.bm || {} };
    var el = G.document.createElement("div");
    el.className = "pn-sheet-wrap su-wrap"; el.id = "pnSetup";
    el.innerHTML = '<div class="pn-scrim" data-act="su-close"></div><section class="pn-sheet su-sheet" role="dialog" aria-modal="true" aria-labelledby="suT" tabindex="-1"></section>';
    host.root().appendChild(el);
    draw_();
    try { el.querySelector(".pn-sheet").focus(); } catch (e) {}
    var mine = S;
    Promise.resolve().then(scope.load).then(function (lists) {
      if (S !== mine) return;
      S.lists = (lists || []).map(function (l) { return (l || []).filter(Boolean); });
      S.loading = false; draw_(true);
    }, function () {
      if (S !== mine) return;
      S.loading = false; S.err = "The questions did not load. Check the connection and try again. A module opened once, or a downloaded subject, works offline."; draw_(true);
    });
    return true;
  }
  function close(quiet) {
    var r = S && S.host && S.host.root(), el = r && r.querySelector("#pnSetup"), prev = S && S.prev;
    if (el) el.parentNode.removeChild(el);
    S = null;
    if (!quiet && prev && prev.isConnected) try { prev.focus(); } catch (e) {}
    return !!el;
  }
  function fmt(n) { return S && S.host ? S.host.fmt(n) : String(n); }
  function seg(act, label, opts, v, cnt) {
    return '<div class="su-chips" role="radiogroup" aria-label="' + label + '">' + opts.map(function (o) {
      var on = String(o[0]) === String(v), c = cnt ? cnt[o[0]] : null;
      return '<button type="button" class="su-chip' + (on ? " on" : "") + (c === 0 ? " zero" : "") + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-act="' + act + '" data-v="' + o[0] + '"><span>' + o[1] + "</span>" +
        (c != null ? '<b class="su-n">' + fmt(c) + '<span class="su-vh">' + (c === 1 ? " question" : " questions") + "</span></b>" : "") + "</button>";
    }).join("") + "</div>";
  }
  function stepper(dec, inc, val, label, lo, hi, cur, less, more) {
    var b = function (act, dis, lab, d) { return '<button type="button" class="su-sb" data-act="' + act + '" aria-label="' + lab + '"' + (dis ? " disabled" : "") + '><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="' + d + '"/></svg></button>'; };
    return '<div class="su-step" role="group" aria-label="' + label + '">' + b(dec, cur <= lo, less || "Less", "M6 12h12") + '<output class="su-sv" aria-live="off">' + val + "</output>" + b(inc, cur >= hi, more || "More", "M6 12h12M12 6v12") + "</div>";
  }
  function timerHtml(sel, n) {
    var t = timerOf(sel), opts = sel.mode === "exam" ? TIMERS.slice(1) : TIMERS, sub;
    var body = seg("su-timer", "Timer", opts, t, null);
    if (t === "q") {
      body += '<div class="su-nrow">' + seg("su-qs", "Seconds a question", QSECS.map(function (x) { return [x, x + " s"]; }), QSECS.indexOf(sel.qs) >= 0 ? sel.qs : -1, null) + stepper("su-qdec", "su-qinc", sel.qs + " s", "Custom seconds", 10, 600, sel.qs, "5 seconds less", "5 seconds more") + "</div>";
      sub = "Each question has its own time, counted only while it is on screen and never reset. When it runs out the question locks and the set moves on.";
    } else if (t === "set") {
      var m = sel.mins || Math.max(1, n);
      body += '<div class="su-nrow">' + seg("su-mins", "Time for the set", [["0", "Exam pace"]], sel.mins ? -1 : "0", null) + stepper("su-mdec", "su-minc", m + " min", "Custom minutes", 1, 600, m, "Fewer minutes", "More minutes") + "</div>";
      sub = (sel.mins ? m + " minutes" : "Exam pace: 1 minute a question, " + m + " min") + " for the whole set." + (sel.mode === "exam" ? "" : " Practice ends when the time is up.");
    } else sub = "No clock. Take your time.";
    return body + '<p class="pn-mut pn-small su-modesub">' + sub + "</p>";
  }
  function grp(k, title, body) { return '<section class="su-grp su-g-' + k + '"><h3 class="su-h"><span class="pl-sic" aria-hidden="true">' + svg(k) + "</span>" + title + "</h3>" + body + "</section>"; }
  function draw_(arrived) {
    if (!S) return;
    var r = S.host.root(), sh = r && r.querySelector("#pnSetup .pn-sheet");
    if (!sh) return;
    var esc = S.host.esc, sc = S.scope, sel = S.sel, rows = sc.rows || {}, body, c = null, total = 0, hint = null;
    if (S.loading) body = '<p class="pn-load" role="status">Counting the questions…</p>';
    else if (S.err) body = '<p class="pn-err" role="alert">' + esc(S.err) + "</p>";
    else {
      c = counts(S.lists, sel, S.ctx); total = c.total;
      if (!total) hint = relaxHint(S.lists, sel, S.ctx);
      var n = Math.min(sel.n, total), cap = Math.min(N_MAX, Math.max(1, total));
      body = (rows.type === false ? "" : grp("type", "Question type", seg("su-type", "Question type", TYPES, sel.type, c.type))) +
        (rows.seen === false ? "" : grp("seen", "New or repeat", seg("su-seen", "New or repeat", SEENS, sel.seen, c.seen))) +
        grp("d", "Difficulty", seg("su-d", "Difficulty", DIFFS, sel.d, c.d)) +
        grp("n", "Number of questions", '<div class="su-nrow">' + seg("su-n", "Number of questions", COUNTS.map(function (x) { return [x, String(x)]; }), COUNTS.indexOf(sel.n) >= 0 ? sel.n : -1, null) +
          '<div class="su-step" role="group" aria-label="Custom count"><button type="button" class="su-sb" data-act="su-dec" aria-label="Fewer questions"' + (sel.n <= 1 ? " disabled" : "") + '><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg></button>' +
          '<output class="su-sv" id="suN" aria-live="off">' + sel.n + '</output><button type="button" class="su-sb" data-act="su-inc" aria-label="More questions"' + (sel.n >= cap ? " disabled" : "") + '><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg></button></div></div>' +
          (total && sel.n > total ? '<p class="pn-mut pn-small su-capn">Only ' + fmt(total) + (total === 1 ? " question matches" : " questions match") + ", so the set has " + fmt(total) + ".</p>" : "")) +
        grp("mode", "Mode", seg("su-mode", "Mode", [["study", "Practice"], ["exam", "Timed test"]], sel.mode, null) + '<p class="pn-mut pn-small su-modesub">' + (sel.mode === "exam" ? "Marked at the end, with a question grid." : "Each answer is marked at once, with its explanation.") + "</p>") +
        grp("timer", "Timer", timerHtml(sel, n));
      S.n = n;
    }
    var status = S.loading || S.err ? "" : total ? '<b>' + fmt(total) + "</b> " + (total === 1 ? "question matches" : "questions match") : (hint ? esc(hint.msg) : "");
    var go = !S.loading && !S.err && total > 0;
    sh.innerHTML = '<span class="pn-grab" aria-hidden="true"></span><div class="su-head"><span class="pn-ic xs su-hic" style="--h:' + (sc.hue == null ? 172 : sc.hue) + '" aria-hidden="true">' + svg("head") + '</span><div><h2 id="suT">Set up practice</h2><p class="pn-mut pn-small">' + esc(sc.title || "") + (sc.sub ? " · " + esc(sc.sub) : "") + "</p></div></div>" +
      '<div class="su-body">' + body + "</div>" +
      '<div class="pn-sheet-act su-act"><p class="su-status' + (total || S.loading || S.err ? "" : " empty") + '" id="suStatus" role="status" aria-atomic="true">' + status + "</p>" +
      '<div class="su-btns"><button type="button" class="pn-btn" data-act="su-close">Cancel</button><button type="button" class="pn-btn pri" data-act="su-go" id="suGo"' + (go ? "" : " disabled") + ">" + (go ? "Start " + S.n + (S.n === 1 ? " question" : " questions") : "Start") + "</button></div></div>";
    if (arrived && G.PREP_MOTION && G.PREP_MOTION.nav) { /* the sheet's own entrance already played; counts swap in place */ }
  }
  // After a redraw the same control gets the focus back, for keyboard use only (a tap never leaves a focus ring).
  function refocus(act, v) {
    if (!S || Date.now() - (S.kb || 0) > 1500) return;
    var r = S && S.host.root(), el = r && r.querySelector('#pnSetup [data-act="' + act + '"]' + (v != null ? '[data-v="' + v + '"]' : ""));
    if (el) try { el.focus(); } catch (e) {}
  }
  function start() {
    if (!S || !S.lists) return;
    var sc = S.scope, sel = S.sel, list = draw(S.lists, sel, S.ctx), host = S.host;
    if (!list.length) return;
    writeMap(remember(readMap(), sc.kind, sc.id, sel));
    close(true);
    sc.start(list, sel.mode, runOpts(sel, list.length), sel);
  }
  /* quick(scope, host): one tap, the remembered settings, no sheet. When nothing matches them any more the sheet opens
     instead (it explains which choice to relax). */
  function quick(scope, host) {
    var sel = recall(readMap(), scope.kind, scope.id), s = host.store();
    var ctx = { cards: s.cards || {}, today: host.today(), mt: s.mt || {}, bm: s.bm || {} };
    if (scope.rows && scope.rows.seen === false) sel.seen = "all";
    return Promise.resolve().then(scope.load).then(function (lists) {
      var list = draw((lists || []).map(function (l) { return (l || []).filter(Boolean); }), sel, ctx);
      if (!list.length) return open(scope, host);
      writeMap(remember(readMap(), scope.kind, scope.id, sel));
      scope.start(list, sel.mode, runOpts(sel, list.length), sel);
    }, function () { host.toast("The questions did not load. Check the connection and try again."); });
  }
  function last(kind, id) { var m = readMap(); return hasLast(m, kind, id) ? summary(recall(m, kind, id)) : ""; }
  function act(a, b) {
    if (!S) return;
    var v = b.getAttribute("data-v"), sel = S.sel;
    if (a === "su-close") return close();
    if (a === "su-go") return start();
    if (a === "su-type") sel.type = v;
    else if (a === "su-seen") sel.seen = v;
    else if (a === "su-d") sel.d = v;
    else if (a === "su-mode") sel.mode = v;
    else if (a === "su-timer") sel.timer = v;
    else if (a === "su-qs") sel.qs = +v;
    else if (a === "su-mins") sel.mins = 0;
    else if (a === "su-qdec" || a === "su-qinc") { sel.qs = Math.max(10, Math.min(600, sel.qs + (a === "su-qinc" ? 5 : -5))); draw_(); return refocus(a); }
    else if (a === "su-mdec" || a === "su-minc") {
      var cur = sel.mins || Math.max(1, S.n || sel.n), st5 = cur >= 30 ? 5 : 1;
      sel.mins = Math.max(1, Math.min(600, cur + (a === "su-minc" ? st5 : -st5))); draw_(); return refocus(a);
    }
    else if (a === "su-n") sel.n = +v;
    else if (a === "su-dec" || a === "su-inc") {
      var cap = S.lists ? Math.min(N_MAX, Math.max(1, counts(S.lists, sel, S.ctx).total)) : N_MAX, step = sel.n >= 50 || (a === "su-inc" && sel.n >= 45) ? 10 : 5;
      if (a === "su-dec") sel.n = sel.n > 5 && sel.n <= 10 ? 5 : Math.max(1, sel.n - (sel.n <= 5 ? 1 : step));
      else sel.n = Math.min(cap, sel.n < 5 ? sel.n + 1 : sel.n + step);
      if (sel.n > cap) sel.n = cap;
      draw_(); return refocus(a);
    } else return;
    draw_(); refocus(a, v);
  }
  // Arrow keys move the choice inside a row (radio group), as the plan sheet's segmented controls do.
  function onKey(e) {
    if (!S) return;
    var t = e.target, k = e.key;
    if (!t || !t.classList || !t.classList.contains("su-chip")) return;
    var step = k === "ArrowRight" || k === "ArrowDown" ? 1 : k === "ArrowLeft" || k === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    var bs = Array.prototype.slice.call(t.parentNode.querySelectorAll(".su-chip")), i = (bs.indexOf(t) + step + bs.length) % bs.length;
    act(bs[i].getAttribute("data-act"), bs[i]);
  }
  function back() { return S ? close() || true : false; }
  function leave() { S = null; }
  if (G.document) G.document.addEventListener("keydown", function (e) { if (S) { S.kb = Date.now(); onKey(e); } }, true);

  G.PREP_SETUP = { enabled: enabled, open: open, quick: quick, last: last, close: close, act: act, back: back, leave: leave, isOpen: function () { return !!S; }, _pure: PURE, _st: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
