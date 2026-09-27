/* Ophthalmós core: pure logic, no DOM. ES5 to match StewardMD.
   - FSRS-6 memory model, ported from ts-fsrs 5.4.2 (MIT, open-spaced-repetition/ts-fsrs):
     next_state / forgetting_curve / interval with default parameters, short-term on.
   - Session builder (due reviews first, then class-balanced new items), grading, stats.
   Exported as window.OPHTHALMOS_CORE in the browser and module.exports under node (tests). */
(function (G) {
  "use strict";

  /* ---------- FSRS-6 (ts-fsrs 5.4.2 default_w, FSRS6_DEFAULT_DECAY) ---------- */
  var W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
    1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
  var S_MIN = 0.001, S_MAX = 36500, MAX_IVL = 36500;
  var AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;

  function roundTo(x, n) { var p = Math.pow(10, n); return Math.round(x * p) / p; }
  function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }

  var DECAY = -W[20];
  var FACTOR = roundTo(Math.exp(Math.log(0.9) / DECAY) - 1, 8);

  function retrievability(elapsedDays, s) {
    return roundTo(Math.pow(1 + FACTOR * elapsedDays / s, DECAY), 8);
  }
  function initDifficulty(g) { return roundTo(W[4] - Math.exp((g - 1) * W[5]) + 1, 8); }
  function nextDifficulty(d, g) {
    var delta = -W[6] * (g - 3);
    var next = d + roundTo(delta * (10 - d) / 9, 8);
    return clamp(roundTo(W[7] * initDifficulty(EASY) + (1 - W[7]) * next, 8), 1, 10);
  }
  function recallStability(d, s, r, g) {
    var hard = g === HARD ? W[15] : 1, easy = g === EASY ? W[16] : 1;
    return roundTo(clamp(s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
      (Math.exp((1 - r) * W[10]) - 1) * hard * easy), S_MIN, S_MAX), 8);
  }
  function forgetStability(d, s, r) {
    return roundTo(clamp(W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) *
      Math.exp((1 - r) * W[14]), S_MIN, S_MAX), 8);
  }
  function shortTermStability(s, g) {
    var sinc = Math.pow(s, -W[19]) * Math.exp(W[17] * (g - 3 + W[18]));
    return roundTo(clamp(s * (g >= HARD ? Math.max(sinc, 1) : sinc), S_MIN, S_MAX), 8);
  }

  // mem: null for a new card, else {d, s}. t: whole days since the last review. g: 1..4.
  function nextState(mem, t, g) {
    if (!mem) return { d: clamp(initDifficulty(g), 1, 10), s: Math.max(W[g - 1], 0.1) };
    var d = mem.d, s = mem.s, ns;
    var r = retrievability(t, s);
    if (t === 0) ns = shortTermStability(s, g);
    else if (g === AGAIN) ns = clamp(roundTo(s / Math.exp(W[17] * W[18]), 8), S_MIN, forgetStability(d, s, r));
    else ns = recallStability(d, s, r, g);
    return { d: nextDifficulty(d, g), s: ns };
  }
  // Request retention 0.9 makes the interval modifier exactly 1 for this curve, so the
  // interval is the stability rounded. ponytail: no learning steps and no fuzz; an Again
  // is re-shown later in the same session and comes back tomorrow.
  function intervalDays(s) { return Math.min(Math.max(1, Math.round(s)), MAX_IVL); }

  /* ---------- days ---------- */
  // Local calendar day number, so "due today" flips at local midnight.
  function dayNum(ms, tzOffsetMin) { return Math.floor((ms - tzOffsetMin * 60000) / 864e5); }

  /* ---------- store (plain object, persisted by the DOM layer) ---------- */
  // cards[key] = [d, s, lastDay, dueDay, reps, lapses]; conf[deck][truth][chosen] = n; days[day] = answers
  function emptyStore() { return { v: 1, cards: {}, conf: {}, days: {} }; }
  function key(deckId, itemId) { return deckId + ":" + itemId; }

  function review(store, deckId, itemId, g, today) {
    var k = key(deckId, itemId), c = store.cards[k];
    var mem = c ? { d: c[0], s: c[1] } : null;
    var next = nextState(mem, c ? Math.max(0, today - c[2]) : 0, g);
    var due = today + (g === AGAIN ? 1 : intervalDays(next.s));
    store.cards[k] = [next.d, next.s, today, due, (c ? c[4] : 0) + 1, (c ? c[5] : 0) + (g === AGAIN && c ? 1 : 0)];
    store.days[today] = (store.days[today] || 0) + 1;
    return store.cards[k];
  }

  // Simulator attempt: sims[id] = {n, ok, err: {type: count}}; counts toward the day and the streak.
  function recordSim(store, simId, ok, errType, today) {
    var all = store.sims || (store.sims = {});
    var r = all[simId] || (all[simId] = { n: 0, ok: 0, err: {} });
    r.n++; r.last = today;
    if (ok) r.ok++;
    else if (errType) r.err[errType] = (r.err[errType] || 0) + 1;
    store.days[today] = (store.days[today] || 0) + 1;
    return r;
  }

  function recordAnswer(store, deckId, truth, chosen) {
    var d = store.conf[deckId] || (store.conf[deckId] = {});
    var row = d[truth] || (d[truth] = {});
    row[chosen] = (row[chosen] || 0) + 1;
  }

  // Classification drills: a wrong answer is Again, a right one Good. Self-rated cases pass g directly.
  function gradeFor(correct) { return correct ? GOOD : AGAIN; }

  /* ---------- session ---------- */
  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Due reviews first (least retrievable first), then new items taken round-robin across
  // answer classes so a rare class (e.g. RAO: 22 of 2,064 scans) still appears.
  function buildSession(deck, store, today, opts) {
    opts = opts || {};
    var size = opts.size || 20, newCap = opts.newCap == null ? 10 : opts.newCap, rnd = opts.rnd || Math.random;
    var due = [], fresh = {}, classes = [];
    deck.items.forEach(function (it) {
      var c = store.cards[key(deck.id, it.id)];
      if (c) { if (c[3] <= today) due.push({ it: it, r: retrievability(Math.max(0, today - c[2]), c[1]) }); }
      else {
        var a = it.a == null ? "_" : it.a;
        if (!fresh[a]) { fresh[a] = []; classes.push(a); }
        fresh[a].push(it);
      }
    });
    due.sort(function (x, y) { return x.r - y.r; });
    var out = due.slice(0, size).map(function (x) { return x.it; });
    classes.forEach(function (a) { shuffle(fresh[a], rnd); });
    shuffle(classes, rnd);
    var picked = [], progress = true;
    while (out.length + picked.length < size && picked.length < newCap && progress) {
      progress = false;
      for (var i = 0; i < classes.length && out.length + picked.length < size && picked.length < newCap; i++) {
        var pool = fresh[classes[i]];
        if (pool.length) { picked.push(pool.pop()); progress = true; }
      }
    }
    return out.concat(shuffle(picked, rnd));
  }

  function counts(deck, store, today) {
    var due = 0, seen = 0;
    deck.items.forEach(function (it) {
      var c = store.cards[key(deck.id, it.id)];
      if (c) { seen++; if (c[3] <= today) due++; }
    });
    return { total: deck.items.length, seen: seen, due: due, fresh: deck.items.length - seen };
  }

  // Per-class accuracy from the confusion table, plus the most common wrong pick.
  function classStats(store, deckId, options) {
    var d = store.conf[deckId] || {};
    return options.map(function (a) {
      var row = d[a] || {}, n = 0, ok = row[a] || 0, worst = null, worstN = 0;
      Object.keys(row).forEach(function (k) {
        n += row[k];
        if (k !== a && row[k] > worstN) { worst = k; worstN = row[k]; }
      });
      return { a: a, n: n, ok: ok, acc: n ? ok / n : null, confusedWith: worst };
    });
  }

  function streak(store, today) {
    var n = 0;
    for (var d = store.days[today] ? today : today - 1; store.days[d]; d--) n++;
    return n;
  }

  // Predicted recall right now: FSRS retrievability of every card of this deck key the learner
  // has actually seen, as of today. {seen, meanR, strong}: strong = R >= 0.9 (about to forget: R low).
  function recall(store, deckKey, today) {
    var prefix = deckKey + ":", seen = 0, sum = 0, strong = 0;
    Object.keys(store.cards).forEach(function (k) {
      if (k.indexOf(prefix) !== 0) return;
      var c = store.cards[k], r = retrievability(Math.max(0, today - c[2]), c[1]);
      seen++; sum += r; if (r >= 0.9) strong++;
    });
    return { seen: seen, meanR: seen ? sum / seen : null, strong: strong };
  }

  // Review forecast: due count for each of today..today+days-1 (overdue cards land on today).
  // prefix, if given, keeps only cards whose key starts with it (e.g. one clinic's level).
  function forecast(store, today, days, prefix) {
    var out = new Array(days); for (var i = 0; i < days; i++) out[i] = 0;
    Object.keys(store.cards).forEach(function (k) {
      if (prefix && k.indexOf(prefix) !== 0) return;
      var due = store.cards[k][3], i2 = due <= today ? 0 : due - today;
      if (i2 < days) out[i2]++;
    });
    return out;
  }

  var API = {
    W: W, FACTOR: FACTOR, AGAIN: AGAIN, HARD: HARD, GOOD: GOOD, EASY: EASY,
    retrievability: retrievability, nextState: nextState, intervalDays: intervalDays,
    dayNum: dayNum, emptyStore: emptyStore, key: key, review: review, recordAnswer: recordAnswer, recordSim: recordSim,
    gradeFor: gradeFor, buildSession: buildSession, counts: counts, classStats: classStats, streak: streak,
    recall: recall, forecast: forecast
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.OPHTHALMOS_CORE = API;
})(typeof window !== "undefined" ? window : this);
