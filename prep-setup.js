/* PrepNucleus practice setup: the sheet a student sees before a set starts. window.PREP_SETUP. ES5.
   Loaded by prep-loader.js after prep.js; draws through PREP._host. prep.js forwards every data-act starting "su-" here,
   asks back() first, and opens the sheet from a module, a subject, the custom module and My mistakes; prep-pyq.js from a
   paper, a paper's subject and a module's PYQs; prep-create.js from a deck.

   The student chooses:
     Question type   All / Image-based / Clinical scenario / One-liner / Mix
     How many        10 / 20 / 30 / 50, or a custom count (stepper), never more than the pool
     New or repeat   New / Incorrect before / Bookmarked / Due for review / All / Mix
     Difficulty      Easy / Moderate / Hard / Very hard / Mix (item.d 1, 2, 3, 4; Mix keeps the pool's own spread)
     Mode            Learning Mode (each answer explained before the next) / Test Mode (marked at the end); two cards
     Timer           A switch, on by default; Each question (60 s by default, 30, 45, 60 to 100 s) or Whole set (exam
                     pace, 1 min a question, or minutes). At 0 a Test Mode question is left unanswered and the test moves
                     on (after the last one it is marked); a Learning Mode question shows its answer and waits for Next.
                     Off: no clock (a Test Mode set is then untimed).
   The sheet (2026-10-10, "How do you want to practise?"): mode cards, the timer box, the count, then the type, repeat
   and difficulty rows behind one "Filter questions" row (open when any of them is not the default), and one Start.
   Every option shows how many questions it leaves, live. The last choice is remembered per scope (localStorage
   smd_prep_setup, "<kind>:<id>" then "<kind>"); the mode and the timer come from "*", the last choice anywhere on this
   device. Saved version 1 choices migrate on read (migrate()). An empty pool says which filter to relax.

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
  /* Timer (owner 2026-10-10): on by default, a clock for every question, 60 s each; the student may go up to 100 s.
     The earlier strict-timer sheet offered 30 and 45 s, so those stay on the stepper (nobody's saved choice is lost);
     anything else saved before snaps to the nearest step. "Whole set" (one clock for the set) stays as the second kind. */
  var TIMERS = [["off", "Off"], ["q", "Each question"], ["set", "Whole set"]], QSECS = [30, 45, 60, 70, 80, 90, 100], QS_DEF = 60, QS_MAX = 100, LOW = 0.2;
  var DEFAULTS = { type: "all", seen: "mix", d: "mix", n: 20, mode: "study", timer: "q", qs: QS_DEF, mins: 0 };
  function pickOf(list, v, d) { for (var i = 0; i < list.length; i++) if (String(list[i][0]) === String(v)) return String(v); return d; }
  // The nearest stepper value (ties go up); not a number or outside 10 to 600 s: the default.
  function snapQs(x) {
    x = Math.round(+x);
    if (!(x >= 10 && x <= 600)) return QS_DEF;
    var best = QSECS[0];
    QSECS.forEach(function (v) { if (Math.abs(v - x) < Math.abs(best - x) || (Math.abs(v - x) === Math.abs(best - x) && v > best)) best = v; });
    return best;
  }
  function stepQs(qs, dir) { var i = QSECS.indexOf(snapQs(qs)); return QSECS[Math.max(0, Math.min(QSECS.length - 1, i + (dir > 0 ? 1 : -1)))]; }
  // A saved or partial choice -> a whole valid one (version 2: the timer box).
  function normSel(sel) {
    sel = sel || {};
    var n = Math.round(+sel.n);
    var mins = Math.round(+sel.mins);
    return { type: pickOf(TYPES, sel.type, DEFAULTS.type), seen: pickOf(SEENS, sel.seen, DEFAULTS.seen), d: pickOf(DIFFS, sel.d, DEFAULTS.d),
      n: n >= 1 && n <= N_MAX ? n : DEFAULTS.n, mode: sel.mode === "exam" ? "exam" : "study", timer: pickOf(TIMERS, sel.timer, DEFAULTS.timer),
      qs: sel.qs == null ? QS_DEF : snapQs(sel.qs), mins: mins >= 1 && mins <= 600 ? mins : 0, v: 2 };
  }
  /* migrate(saved) -> a version 2 choice. Version 1 (the strict-timer sheet, 2026-10-09) had Off by default and no Off for
     a timed test (Off there meant the whole set at exam pace). A per-question or whole-set choice is kept as it was (seconds
     snapped to the stepper); a practice Off, the old default nobody chose against an on-by-default timer, becomes the new
     default (on, 60 s); a timed-test Off stays what it ran as, the whole set at exam pace. */
  function migrate(raw) {
    if (!raw || typeof raw !== "object") return raw;
    if (raw.v === 2) return raw;
    var o = {}, k; for (k in raw) o[k] = raw[k];
    if (o.timer !== "q" && o.timer !== "set") { if (o.mode === "exam") o.timer = "set"; else { o.timer = "q"; o.qs = QS_DEF; } }
    o.v = 2;
    return o;
  }
  // Off means no clock: a test with the timer off is untimed.
  function timerOf(sel) { return sel.timer; }
  /* runOpts(sel, n) -> the runner's clock options (prep.js runQuestions): { qsec } per question, { limit } seconds for
     the whole set (mins, or 1 minute a question at exam pace), { untimed } a test with no clock, {} none. */
  function runOpts(sel, n) {
    sel = normSel(sel);
    var t = timerOf(sel);
    if (t === "q") return { qsec: sel.qs };
    if (t === "set") return { limit: (sel.mins || Math.max(1, n)) * 60 };
    return sel.mode === "exam" ? { untimed: true } : {};
  }
  // The seconds left at which a question's line turns red: under 20% of its time (60 s: the last 12 s).
  function lowAt(qs) { return Math.ceil(qs * LOW); }
  // "20 questions · new · hard · test mode, 60 s a question": the last settings in one line.
  function summary(sel) {
    sel = normSel(sel);
    var parts = [sel.n + (sel.n === 1 ? " question" : " questions")], t = timerOf(sel);
    if (sel.type !== "all") parts.push(sel.type === "mix" ? "mixed types" : LABEL.type[sel.type]);
    if (sel.seen !== "all" && sel.seen !== "mix") parts.push(LABEL.seen[sel.seen]);
    if (sel.d !== "mix") parts.push(LABEL.d[sel.d]);
    var m = sel.mode === "exam" ? "test mode" : "learning mode";
    if (t === "q") m += ", " + sel.qs + " s a question"; else if (t === "set") m += ", " + (sel.mins ? sel.mins + " min" : "1 min a question"); else m += ", no timer";
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
  /* fit(lists, sel, ctx) -> { sel, moved: [rows] }: a choice that leaves no question (a remembered "Incorrect before" with
     nothing answered wrong yet, owner recording 2026-10-09) is never the default. Row by row (repeat, type, difficulty),
     a chosen option with 0 questions falls back to the row's open choice (All, or Mix for difficulty) when that has any.
     The rows a student never sees (rows: { seen: false }) are left as the scope set them. */
  function fit(lists, sel, ctx, rows) {
    var out = normSel(sel), moved = [];
    rows = rows || {};
    if (!flat(lists).length) return { sel: out, moved: moved };   // an empty scope: the sheet says so instead
    // Opening a row never loses a question, so an empty choice is opened even when the other rows still empty the pool;
    // the next row is then judged with this one open.
    [["seen", "all"], ["type", "all"], ["d", "mix"]].forEach(function (x) {
      var k = x[0];
      if (rows[k] === false || out[k] === x[1] || (k !== "d" && out[k] === "mix")) return;
      if (!counts(lists, out, ctx)[k][out[k]]) { out[k] = x[1]; moved.push(k); }
    });
    return { sel: out, moved: moved };
  }
  /* Remembered choices: { "<kind>:<id>": sel, "<kind>": sel, "*": the last choice anywhere }, newest 40 kept. The mode
     and the timer (on or off, kind, seconds) are the student's own, so they come from "*" on every scope; the question
     filters and the count are per scope. */
  var GLOBAL = ["mode", "timer", "qs"];
  function remember(map, kind, id, sel) {
    map = map && typeof map === "object" ? map : {};
    var s = normSel(sel), out = {}, keys;
    s.t = Date.now();
    map[kind] = s; if (id) map[kind + ":" + id] = s;
    map["*"] = s;
    keys = Object.keys(map).sort(function (a, b) { return ((map[b] && map[b].t) || 0) - ((map[a] && map[a].t) || 0); }).slice(0, 40);
    keys.forEach(function (k) { out[k] = map[k]; });
    return out;
  }
  function recall(map, kind, id) {
    map = map || {};
    var own = migrate((id && map[kind + ":" + id]) || map[kind] || null), all = migrate(map["*"] || null), o = {}, k;
    for (k in own || {}) o[k] = own[k];
    if (all) GLOBAL.forEach(function (g) { if (all[g] != null) o[g] = all[g]; });
    return normSel(o);
  }
  function hasLast(map, kind, id) { map = map || {}; return !!((id && map[kind + ":" + id]) || map[kind]); }

  var PURE = { CASE_MIN: CASE_MIN, LONG_WORDS: LONG_WORDS, MID_WORDS: MID_WORDS, stemScore: stemScore, stemKind: stemKind, kindOf: kindOf, hasImg: hasImg, typeOf: typeOf, dOf: dOf,
    wrongBefore: wrongBefore, seenOf: seenOf, seenMatch: seenMatch, normSel: normSel, keep: keep, counts: counts, allocate: allocate, draw: draw, relaxHint: relaxHint, fit: fit,
    remember: remember, recall: recall, hasLast: hasLast, migrate: migrate, snapQs: snapQs, stepQs: stepQs, lowAt: lowAt, timerOf: timerOf, runOpts: runOpts, summary: summary, TIMERS: TIMERS, QSECS: QSECS, QS_DEF: QS_DEF, QS_MAX: QS_MAX, LOW: LOW, TYPES: TYPES, SEENS: SEENS, DIFFS: DIFFS, COUNTS: COUNTS, N_MAX: N_MAX, DEFAULTS: DEFAULTS };
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
    if (scope.seen) sel.seen = scope.seen;
    if (scope.n) sel.n = Math.max(1, Math.min(N_MAX, Math.round(scope.n)));
    S = { scope: scope, sel: sel, lists: null, host: host, prev: G.document.activeElement, loading: true, err: "", more: filtered(sel, scope.rows || {}) };
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
      var f = fit(S.lists, S.sel, S.ctx, scope.rows);
      f.sel.mode = S.sel.mode;
      S.sel = f.sel;
      if (filtered(S.sel, scope.rows || {})) S.more = true;
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
      // An option that would leave no question cannot be chosen: it reads as off and does nothing (owner 2026-10-09).
      var on = String(o[0]) === String(v), c = cnt ? cnt[o[0]] : null, off = c === 0 && !on;
      return '<button type="button" class="su-chip' + (on ? " on" : "") + (c === 0 ? " zero" : "") + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-act="' + act + '" data-v="' + o[0] + '"' + (off ? " disabled" : "") + "><span>" + o[1] + "</span>" +
        (c != null ? '<b class="su-n">' + fmt(c) + '<span class="su-vh">' + (c === 1 ? " question" : " questions") + "</span></b>" : "") + "</button>";
    }).join("") + "</div>";
  }
  function stepper(dec, inc, val, label, lo, hi, cur, less, more) {
    var b = function (act, dis, lab, d) { return '<button type="button" class="su-sb" data-act="' + act + '" aria-label="' + lab + '"' + (dis ? " disabled" : "") + '><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="' + d + '"/></svg></button>'; };
    return '<div class="su-step" role="group" aria-label="' + label + '">' + b(dec, cur <= lo, less || "Less", "M6 12h12") + '<output class="su-sv" aria-live="off">' + val + "</output>" + b(inc, cur >= hi, more || "More", "M6 12h12M12 6v12") + "</div>";
  }
  /* The two ways to practise (owner 2026-10-10). Large radio cards: the whole card is the target (one thumb), the icon,
     the name and one line on what happens. */
  var MODES = [
    ["study", "Learning Mode", "Answer, then see the full explanation before the next question.", "learn"],
    ["exam", "Test Mode", "Answer every question. Skip or flag as you go. Results at the end.", "test"]
  ];
  IC.learn = '<path d="M4 6.5C6.6 5 9.4 5 12 6.8 14.6 5 17.4 5 20 6.5V19c-2.6-1.4-5.4-1.4-8 .4-2.6-1.8-5.4-1.8-8-.4z"/><path d="M12 6.8v12.6"/>';
  IC.test = '<rect x="5" y="3.5" width="14" height="17.5" rx="2.2"/><path d="M9 3.5V5h6V3.5M8.5 10.5l1.6 1.6 3-3M8.5 16h7"/>';
  IC.x = '<path d="M6 6l12 12M18 6L6 18"/>';
  IC.chev = '<path d="M7 10l5 5 5-5"/>';
  function modesHtml(sel) {
    return '<div class="su-modes" role="radiogroup" aria-label="How do you want to practise?">' + MODES.map(function (m) {
      var on = sel.mode === m[0];
      return '<button type="button" class="su-mc' + (on ? " on" : "") + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-act="su-mode" data-v="' + m[0] + '">' +
        '<span class="su-mci" aria-hidden="true">' + svg(m[3]) + '</span><span class="su-mct"><b>' + m[1] + "</b><small>" + m[2] + '</small></span><span class="su-mck" aria-hidden="true"></span></button>';
    }).join("") + "</div>";
  }
  /* The timer box: a switch (on by default), then for a clock per question the seconds (60 by default, up to 100) with a
     small picture of the line it will draw, red over its last 20%. "Whole set" keeps the earlier one-clock-for-the-set
     choice. What happens at 0 depends on the mode, so the note says it. */
  function timerHtml(sel, n) {
    var t = timerOf(sel), on = t !== "off", m = sel.mins || Math.max(1, n || sel.n);
    // One short line in every state, so a switch never changes the height above the controls.
    var sub = !on ? "Off. Take your time." : t === "q" ? sel.qs + "\u00a0s for each question" : m + "\u00a0min for the whole set";
    var html = '<section class="su-tbox' + (on ? " on" : "") + '" aria-labelledby="suTL"><div class="su-trow"><span class="su-tic" aria-hidden="true">' + svg("timer") + '</span>' +
      '<span class="su-tt"><b id="suTL">Timer</b><small id="suTS">' + sub + "</small></span>" +
      '<button type="button" class="su-sw" role="switch" aria-checked="' + on + '" aria-labelledby="suTL" aria-describedby="suTS" data-act="su-ton"><i aria-hidden="true"></i></button></div>';
    if (on) {
      /* The two kinds share one grid cell and only the chosen one shows, so the box keeps the taller panel's height:
         switching Each question / Whole set never changes the sheet's height, and nothing below moves or clamps the
         scroller (native pass 2 rule). The hidden panel is inert. */
      var low = lowAt(sel.qs), panel = function (k, body) { return '<div class="su-tp' + (t === k ? " on" : "") + '" data-key="tp-' + k + '"' + (t === k ? "" : ' inert aria-hidden="true"') + ">" + body + "</div>"; };
      html += seg("su-timer", "Clock", TIMERS.slice(1), t, null) + '<div class="su-tstack">' +
        panel("q", '<div class="su-qsrow"><span class="su-ql" id="suQL">Seconds per question</span>' + stepper("su-qdec", "su-qinc", sel.qs + " s", "Seconds per question", QSECS[0], QSECS[QSECS.length - 1], sel.qs, "Fewer seconds", "More seconds") + "</div>" +
          '<p class="pn-mut pn-small su-tnote">The line under the header drains for each question and turns red in the last ' + low + "\u00a0s. " +
          (sel.mode === "exam" ? "At 0 the question is left unanswered and the test moves on; after the last one you see your result." : "At 0 the answer and its explanation show, and you go on when ready.") + "</p>") +
        panel("set", '<div class="su-qsrow"><span class="su-ql">' + (sel.mins ? "Minutes for the set" : "Exam pace") + '</span>' + stepper("su-mdec", "su-minc", m + "\u00a0min", "Minutes for the set", 1, 600, m, "Fewer minutes", "More minutes") + "</div>" +
          (sel.mins ? '<button type="button" class="pn-link su-pace" data-act="su-mins" data-v="0">Back to exam pace</button>' : "") +
          '<p class="pn-mut pn-small su-tnote">One clock for the whole set.' + (sel.mode === "exam" ? " The test is marked when it runs out." : " Practice ends when the time is up.") + "</p>") + "</div>";
    }
    return html + "</section>";
  }
  function grp(k, title, body) { return '<section class="su-grp su-g-' + k + '"><h3 class="su-h"><span class="pl-sic" aria-hidden="true">' + svg(k) + "</span>" + title + "</h3>" + body + "</section>"; }
  // The filters a student changes now and then sit behind one row that says what they are set to.
  function filtSummary(sel, rows) {
    var p = [];
    if (rows.type !== false) p.push(sel.type === "all" ? "All types" : sel.type === "mix" ? "Mixed types" : cap(LABEL.type[sel.type]));
    if (rows.seen !== false) p.push(sel.seen === "all" ? "New and seen" : sel.seen === "mix" ? "New and repeat mix" : cap(LABEL.seen[sel.seen]));
    p.push(sel.d === "mix" ? "Any difficulty" : cap(LABEL.d[sel.d]));
    return p.join(" · ");
  }
  function cap(x) { x = String(x || ""); return x.charAt(0).toUpperCase() + x.slice(1); }
  function filtered(sel, rows) { return (rows.type !== false && sel.type !== "all") || (rows.seen !== false && sel.seen !== "mix") || sel.d !== "mix"; }
  function draw_(arrived) {
    if (!S) return;
    var r = S.host.root(), sh = r && r.querySelector("#pnSetup .pn-sheet");
    if (!sh) return;
    var esc = S.host.esc, sc = S.scope, sel = S.sel, rows = sc.rows || {}, qs, c = null, total = 0, hint = null;
    if (S.loading) qs = '<p class="pn-load su-count" role="status">Counting the questions…</p>';
    else if (S.err) qs = '<p class="pn-err" role="alert">' + esc(S.err) + "</p>";
    else {
      c = counts(S.lists, sel, S.ctx); total = c.total;
      if (!total) hint = relaxHint(S.lists, sel, S.ctx);
      var n = Math.min(sel.n, total), cap_ = Math.min(N_MAX, Math.max(1, total));
      qs = grp("n", "Number of questions", '<div class="su-nrow">' + seg("su-n", "Number of questions", COUNTS.map(function (x) { return [x, String(x)]; }), COUNTS.indexOf(sel.n) >= 0 ? sel.n : -1, null) +
          '<div class="su-step" role="group" aria-label="Custom count"><button type="button" class="su-sb" data-act="su-dec" aria-label="Fewer questions"' + (sel.n <= 1 ? " disabled" : "") + '><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg></button>' +
          '<output class="su-sv" id="suN" aria-live="off">' + sel.n + '</output><button type="button" class="su-sb" data-act="su-inc" aria-label="More questions"' + (sel.n >= cap_ ? " disabled" : "") + '><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg></button></div></div>' +
          (total && sel.n > total ? '<p class="pn-mut pn-small su-capn">Only ' + fmt(total) + (total === 1 ? " question matches" : " questions match") + ", so the set has " + fmt(total) + ".</p>" : "")) +
        '<button type="button" class="su-more" data-act="su-more" aria-expanded="' + !!S.more + '" aria-controls="suFilt"><span class="su-mt"><b>Filter questions</b><small>' + esc(filtSummary(sel, rows)) + '</small></span><span class="su-mchev" aria-hidden="true">' + svg("chev") + "</span></button>" +
        '<div class="su-filt" id="suFilt"' + (S.more ? "" : " hidden") + ">" + (S.more ?
          (rows.type === false ? "" : grp("type", "Question type", seg("su-type", "Question type", TYPES, sel.type, c.type))) +
          (rows.seen === false ? "" : grp("seen", "New or repeat", seg("su-seen", "New or repeat", SEENS, sel.seen, c.seen))) +
          grp("d", "Difficulty", seg("su-d", "Difficulty", DIFFS, sel.d, c.d)) : "") + "</div>";
      S.n = n;
    }
    var body = modesHtml(sel) + timerHtml(sel, S.n || sel.n) + '<div class="su-qs">' + qs + "</div>";
    var t = timerOf(sel);
    var status = S.loading || S.err ? "" : total ? "<b>" + fmt(S.n) + "</b> " + (S.n === 1 ? "question" : "questions") + (t === "q" ? " · " + sel.qs + "\u00a0s each" : t === "set" ? " · " + (sel.mins || Math.max(1, S.n)) + "\u00a0min in all" : " · no timer") : (hint ? esc(hint.msg) : "");
    var go = !S.loading && !S.err && total > 0;
    var html = '<span class="pn-grab" aria-hidden="true"></span><div class="su-head"><div class="su-ht"><h2 id="suT">How do you want to practise?</h2><p class="pn-mut pn-small">' + esc(sc.title || "") + (sc.sub ? " · " + esc(sc.sub) : "") + "</p></div>" +
      '<button type="button" class="pn-ib su-x" data-act="su-close" aria-label="Close">' + svg("x") + "</button></div>" +
      '<div class="su-body">' + body + "</div>" +
      '<div class="pn-sheet-act su-act"><p class="su-status' + (total || S.loading || S.err ? "" : " empty") + '" id="suStatus" role="status" aria-atomic="true">' + status + "</p>" +
      '<button type="button" class="pn-btn pri su-go" data-act="su-go" id="suGo"' + (go ? "" : " disabled") + ">" + (sel.mode === "exam" ? "Start test" : "Start learning") + "</button></div>";
    /* Native pass 2: the sheet is patched, never rebuilt (owner recording 2026-10-09: every chip tap rebuilt it, so its
       scroller was a new node at scrollTop 0 and the sheet jumped to the top). Same nodes, same scroll, the pressed chip
       keeps its press state; only the counts, the chosen chip, the timer's own controls and the status change. */
    if (sh.firstChild && G.PREP_DOM) G.PREP_DOM.patch(sh, html); else sh.innerHTML = html;
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
  /* The control under the finger stays under the finger: a row above it can change height (the count note under the
     stepper, the timer's own controls), so after the patch the scroller moves by however far the control moved. */
  function anchored(b, fn) {
    var r = S && S.host.root(), body = r && r.querySelector("#pnSetup .su-body"), y0 = b && b.isConnected && body ? b.getBoundingClientRect().top : null;
    fn();
    if (y0 == null || !b.isConnected || !body || !body.contains(b)) return;
    var d = b.getBoundingClientRect().top - y0;
    if (Math.abs(d) >= 0.5) body.scrollTop += d;
  }
  function act(a, b) {
    if (!S) return;
    if (b && b.disabled) return;
    if (a === "su-close") return close();
    if (a === "su-go") return start();
    anchored(b, function () { act_(a, b); });
  }
  function act_(a, b) {
    var v = b.getAttribute("data-v"), sel = S.sel;
    if (a === "su-type") sel.type = v;
    else if (a === "su-seen") sel.seen = v;
    else if (a === "su-d") sel.d = v;
    else if (a === "su-mode") sel.mode = v;
    else if (a === "su-ton") { if (sel.timer === "off") sel.timer = S.tk || "q"; else { S.tk = sel.timer; sel.timer = "off"; } draw_(); return refocus(a); }
    else if (a === "su-more") { S.more = !S.more; draw_(); return refocus(a); }
    else if (a === "su-timer") sel.timer = v;
    else if (a === "su-qs") sel.qs = snapQs(v);
    else if (a === "su-mins") sel.mins = 0;
    else if (a === "su-qdec" || a === "su-qinc") { sel.qs = stepQs(sel.qs, a === "su-qinc" ? 1 : -1); draw_(); return refocus(a); }
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
    if (!t || !t.classList || !(t.classList.contains("su-chip") || t.classList.contains("su-mc"))) return;
    var step = k === "ArrowRight" || k === "ArrowDown" ? 1 : k === "ArrowLeft" || k === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    var bs = Array.prototype.slice.call(t.parentNode.querySelectorAll(".su-chip:not([disabled]), .su-mc")), i = (bs.indexOf(t) + step + bs.length) % bs.length;
    if (bs[i]) act(bs[i].getAttribute("data-act"), bs[i]);
  }
  // A full repaint of the overlay (a screen pushed from under the sheet) takes the sheet's node away: its state goes too,
  // so back is not swallowed by a sheet that is no longer there.
  function back() {
    if (!S) return false;
    var r = S.host.root(), el = r && r.querySelector("#pnSetup");
    if (!el) { S = null; return false; }
    return close() || true;
  }
  function leave() { S = null; }
  if (G.document) G.document.addEventListener("keydown", function (e) { if (S) { S.kb = Date.now(); onKey(e); } }, true);

  G.PREP_SETUP = { enabled: enabled, open: open, quick: quick, last: last, close: close, act: act, back: back, leave: leave, isOpen: function () { return !!S; }, _pure: PURE, _st: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
