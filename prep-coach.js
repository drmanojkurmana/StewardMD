/* IQoach: confidence-aware coaching for PrepNucleus. window.PREP_COACH. ES5.
 * "Know your Medical IQ". It reports knowledge groups and tiers only: never an IQ number,
 * intelligence score, rank, percentile or predicted score. Exam ready means "ready by your
 * own answers", from the student's own counted answers on this device.
 *
 * Capture: one confidence chip per question (I'm guessing / I'm confident / I'm confused
 * between options), skippable; Confused may carry the two mixed-up options. Time taken and
 * answer changes ride along from the runner. Records stay small and on the device: per-item
 * conf (+pair) in the t2r attempt record (IndexedDB) and compact per-topic aggregates plus
 * recent confused pairs in the study history (localStorage smd_prep_v1).
 *
 * Analysis: deterministic, no LLM, no network, no cohort. Per-question outcome x confidence:
 * confident-right (mastered), confident-wrong (misconception, highest priority), guess-right
 * (lucky, not mastered), guess-wrong, confused (with the two options). Per-topic aggregates
 * use recency weighting (last HIST_N answers, newest heaviest) with an N = 5 guard.
 *
 * Groups: Read again (misconceptions, repeated wrong, confident-wrong), Just revise (mostly
 * right but guessed / slow / confused / forgotten after a gap), Exam ready (5+ answers over
 * 2+ days, confident-right, fast enough, nothing confused or misconceived lately).
 *
 * Tiers (owner definition): tier = topic priority from (exam importance) x (this student's
 * weakness). Diamond = very important for the exam AND the student's weakest; Silver = less
 * important AND less weak; Platinum and Gold are the middle levels. Revise order: Diamond >
 * Platinum > Gold > Silver. priority = weakness x importance, cut by TIER_MIN thresholds.
 * Exam importance per subject blends, when present: the exam profile blueprint weights
 * (official counts, e.g. FMGE), PYQ frequency by subject (prep-pyq cached items, sorted only),
 * the compiled yield weights (prep-knowyouriq-data.js, derived subject numbers, NEET-PG/
 * INI-CET) and the bank's own subject weighting. Missing sources are skipped; a subject with
 * no importance data anywhere gets the neutral weight and the screen says so.
 * Weakness blends, per topic: confident-wrong share (weighs most), wrong share, unsure
 * (guessing + confused) share and slow share. Tiers show only with enough data (N >= 5).
 */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  var PLAN = null;
  function planPure() {
    if (PLAN) return PLAN;
    if (NODE) { try { PLAN = require("./prep-plan.js"); } catch (e) { PLAN = null; } }
    else if (G && G.PREP_PLAN && G.PREP_PLAN._pure) PLAN = G.PREP_PLAN._pure;
    return PLAN;
  }

  /* ---------- ONE config object: names, thresholds, weights (owner-retunable) ---------- */
  var KYIQ = {
    NAME: "IQoach", TAGLINE: "Know your Medical IQ",
    NOTEST: "IQoach shows what you know and what you are only guessing. It is not an intelligence test.",
    MIN_N: 5,                 // answers on a topic before any group or tier shows
    HIST_N: 20,               // last answers kept per topic for recency weighting
    DECAY: 0.9,               // recency weight per answer back (newest 1, next 0.9, ...)
    READY_ACC: 0.8,           // recency-weighted accuracy for Exam ready
    REVISE_ACC: 0.6,          // recency-weighted accuracy for Just revise (below: Read again)
    MAX_UNSURE: 0.25,         // guessing+confused share still allowed for Exam ready
    MAX_SLOW: 0.3,            // slow-answer share still allowed for Exam ready
    SLOW_MS: 90000,           // an answer slower than this (or 1.5x the question pace, when known) counts as slow
    READY_DAYS_MIN: 2,        // distinct days of answers required for Exam ready
    REREAD_CW_MIN: 2,         // confident-wrong answers that force Read again
    STREAK_N: 3,              // trailing wrong answers that force Read again (repeated wrong)
    FORGOT_N: 8,              // answers needed before the forgotten-after-gap check runs
    FORGOT_EARLY: 0.75,       // early-half accuracy ...
    FORGOT_LATE: 0.4,         // ... vs late-5 accuracy that marks "forgotten after a gap"
    WEAK_W: { cw: 1.6, wrong: 1.0, unsure: 0.5, slow: 0.3 },  // weakness blend; confident-wrong weighs most
    IMPORT_W: { blueprint: 0.4, pyq: 0.25, yield: 0.25, bank: 0.1 },  // importance blend over present sources
    NEUTRAL: 0.5,             // importance when no source covers the subject (labelled on screen)
    TIER_MIN: { diamond: 0.45, platinum: 0.3, gold: 0.15 },  // priority cutoffs; below gold is Silver
    REVIEW_DAYS: { reread: 1, revise: 7, ready: 21 },        // spaced-revision gaps per group
    PAIR_N: 5,                // recent confused pairs kept per topic
    PAIR_TOPICS: 200,         // topics with pairs kept on the device
    PAIR_TEXT: 60,            // option characters kept per pair side (never sent anywhere)
    SUMMARY_MAX_BYTES: 1500,  // Ask MaiK context cap
    INTRO_KEY: "smd_prep_kyiq_intro"  // "1" once Don't-show-again is tapped (this device only)
  };
  var TIER_ORDER = ["diamond", "platinum", "gold", "silver"];
  var TIER_LABEL = { diamond: "Diamond", platinum: "Platinum", gold: "Gold", silver: "Silver" };
  var GROUPS = { reread: "Read again", revise: "Just revise", ready: "Exam ready", fresh: "Not enough data yet" };

  /* ---------- capture ---------- */
  var CONF = [["guessing", "I'm guessing"], ["confident", "I'm confident"], ["confused", "I'm confused between options"]];
  function cleanConf(v) { return v === "guessing" || v === "confident" || v === "confused" ? v : null; }
  /* cleanPair(a, b, n): the two mixed-up option indexes, sorted, or null. n = option count (default 4). */
  function cleanPair(a, b, n) {
    n = n || 4;
    a = Math.floor(a); b = Math.floor(b);
    if (!(a >= 0 && a < n && b >= 0 && b < n && a !== b)) return null;
    return a < b ? [a, b] : [b, a];
  }
  /* One question's capture: the chip (null = skipped) with the mark flag, time, changes and pair. */
  function capture(conf, marked, ms, changed, pair) {
    var p = pair ? cleanPair(pair[0], pair[1], pair[2] || 4) : null;
    return { conf: cleanConf(conf), mark: !!marked, ms: Math.max(0, Math.min(600000, Math.round(ms) || 0)), changed: Math.max(0, Math.round(changed) || 0), pair: p };
  }
  function emptyCounts() { return { guessing: 0, confident: 0, confused: 0 }; }
  function confCounts(list) {
    var c = emptyCounts();
    (list || []).forEach(function (v) { v = cleanConf(v); if (v) c[v]++; });
    return c;
  }
  function topicKey(s, m) { return (s || "?") + "|" + (m || "?"); }

  /* ---------- per-question outcome x confidence (deterministic labels, no scores) ---------- */
  var OUTCOMES = { mastered: "Confident and right", misconception: "Confident but wrong", lucky: "Guessed right",
    guesswrong: "Guessed wrong", confused: "Confused between options", right: "Right", wrong: "Wrong", blank: "Not answered" };
  function outcome(ok, conf) {
    if (ok == null) return "blank";
    var c = cleanConf(conf);
    if (c === "confident") return ok ? "mastered" : "misconception";
    if (c === "guessing") return ok ? "lucky" : "guesswrong";
    if (c === "confused") return "confused";
    return ok ? "right" : "wrong";
  }

  /* ---------- per-topic aggregates (small records on the device) ----------
   * agg[t] = { n, ok, cr, cw, gr, gw, cf, slow, days: {day: n}, hist: [0/1 newest last], last }.
   * noteAnswer files one counted answer; blanks never reach it. day = plan day number. */
  function emptyAgg() { return { n: 0, ok: 0, cr: 0, cw: 0, gr: 0, gw: 0, cf: 0, slow: 0, days: {}, hist: [], last: 0 }; }
  function noteAnswer(aggs, t, o) {
    if (!aggs[t]) aggs[t] = emptyAgg();
    var a = aggs[t];
    o = o || {};
    a.n++;
    if (o.ok) a.ok++;
    var oc = outcome(o.ok ? 1 : 0, o.conf);
    if (oc === "mastered") a.cr++;
    else if (oc === "misconception") a.cw++;
    else if (oc === "lucky") a.gr++;
    else if (oc === "guesswrong") a.gw++;
    else if (oc === "confused") a.cf++;
    if (o.slow) a.slow++;
    if (o.day != null) { a.days[o.day] = (a.days[o.day] || 0) + 1; pruneDays(a); }
    a.hist.push(o.ok ? 1 : 0);
    if (a.hist.length > KYIQ.HIST_N) a.hist = a.hist.slice(-KYIQ.HIST_N);
    if (o.ts) a.last = o.ts;
    return a;
  }
  function pruneDays(a) {
    var ks = Object.keys(a.days);
    if (ks.length <= 31) return;
    ks.sort();
    ks.slice(0, ks.length - 31).forEach(function (k) { delete a.days[k]; });
  }
  /* reconf(aggs, t, ok, oldConf, newConf): a retag after the answer was filed moves only the
   * confidence counters (n/ok/hist/days stay: the answer itself did not change). */
  function reconf(aggs, t, ok, oldConf, newConf) {
    var a = aggs && aggs[t];
    if (!a) return null;
    function bump(conf, d) {
      var oc = outcome(ok ? 1 : 0, conf);
      if (oc === "mastered") a.cr = Math.max(0, a.cr + d);
      else if (oc === "misconception") a.cw = Math.max(0, a.cw + d);
      else if (oc === "lucky") a.gr = Math.max(0, a.gr + d);
      else if (oc === "guesswrong") a.gw = Math.max(0, a.gw + d);
      else if (oc === "confused") a.cf = Math.max(0, a.cf + d);
    }
    bump(oldConf, -1); bump(newConf, 1);
    return a;
  }
  /* Recency-weighted accuracy over hist (newest last): weight DECAY^age. Plain accuracy when empty. */
  function wacc(hist) {
    var sw = 0, so = 0, w = 1;
    for (var i = hist.length - 1; i >= 0; i--) { so += hist[i] * w; sw += w; w *= KYIQ.DECAY; }
    return sw ? so / sw : 0;
  }
  function daySpan(a) { return Object.keys(a.days || {}).length; }
  /* Forgotten after a gap: early half mostly right, last 5 mostly wrong, enough answers. */
  function forgotten(a) {
    var h = a.hist || [];
    if (h.length < KYIQ.FORGOT_N) return false;
    var half = Math.floor(h.length / 2), e = 0, i;
    for (i = 0; i < half; i++) e += h[i];
    var late = h.slice(-5), l = 0;
    for (i = 0; i < late.length; i++) l += late[i];
    return e / half >= KYIQ.FORGOT_EARLY && l / late.length <= KYIQ.FORGOT_LATE;
  }
  function trailingWrong(a) {
    var h = a.hist || [], k = 0;
    for (var i = h.length - 1; i >= 0 && k < KYIQ.STREAK_N; i--) { if (!h[i]) k++; else break; }
    return k >= KYIQ.STREAK_N;
  }

  /* summarize(aggs) -> per-topic stats in topic-key order. Pure. */
  function summarize(aggs) {
    return Object.keys(aggs || {}).sort().map(function (t) {
      var a = aggs[t], n = a.n || 0;
      var acc = n ? a.ok / n : 0, wa = wacc(a.hist || []);
      var unsure = n ? ((a.gr + a.gw + a.cf) / n) : 0, slow = n ? a.slow / n : 0, cw = n ? a.cw / n : 0;
      return { t: t, n: n, ok: a.ok, acc: Math.round(acc * 100) / 100, wacc: Math.round(wa * 100) / 100,
        cr: a.cr, cw: a.cw, gr: a.gr, gw: a.gw, cf: a.cf, slowN: a.slow,
        unsure: Math.round(unsure * 100) / 100, slow: Math.round(slow * 100) / 100, cwShare: Math.round(cw * 100) / 100,
        days: daySpan(a), forgot: forgotten(a), streak: trailingWrong(a), last: a.last || 0 };
    });
  }
  function r2(x) { return Math.round(x * 100) / 100; }

  /* Weakness 0..1: confident-wrong share weighs most, then wrong, unsure, slow. */
  function weaknessOf(st) {
    var W = KYIQ.WEAK_W;
    var w = W.cw * st.cwShare + W.wrong * (1 - st.wacc) + W.unsure * st.unsure + W.slow * st.slow;
    return Math.max(0, Math.min(1, r2(w)));
  }

  /* Exam importance 0..1 for a subject: weighted mean over the sources that cover it.
   * src = { blueprint: {id: share} | null, pyq: {id: share} | null, data: PREP_KYIQ_DATA-ish, exam }.
   * Bank shares come from data.bank; yield from data.exams[exam]. Absent everywhere -> neutral. */
  function importanceOf(subject, exam, src) {
    src = src || {};
    var W = KYIQ.IMPORT_W, parts = [], sw = 0, so = 0;
    function take(name, map) {
      if (!map || map[subject] == null) return;
      var w = W[name] || 0;
      parts.push({ src: name, w: map[subject] });
      so += map[subject] * w; sw += w;
    }
    take("blueprint", src.blueprint);
    take("pyq", src.pyq);
    if (src.data && src.data.exams && src.data.exams[exam]) take("yield", src.data.exams[exam]);
    if (src.data) take("bank", src.data.bank);
    if (!sw) return { w: KYIQ.NEUTRAL, parts: parts, neutral: true };
    return { w: r2(so / sw), parts: parts, neutral: false };
  }

  /* Tier from priority = weakness x importance. Only with enough data (stat.n >= MIN_N). */
  function tierFor(stat, imp) {
    if (!stat || stat.n < KYIQ.MIN_N) return { id: null, label: GROUPS.fresh, score: null };
    var score = r2(weaknessOf(stat) * (imp && imp.w != null ? imp.w : KYIQ.NEUTRAL));
    var id = score >= KYIQ.TIER_MIN.diamond ? "diamond" : score >= KYIQ.TIER_MIN.platinum ? "platinum" : score >= KYIQ.TIER_MIN.gold ? "gold" : "silver";
    return { id: id, label: TIER_LABEL[id], score: score };
  }

  /* Group from the student's own counted answers. Pure. */
  function classify(st) {
    var why;
    if (st.n < KYIQ.MIN_N) return { group: "fresh", label: GROUPS.fresh, why: "Answer " + KYIQ.MIN_N + " questions on this topic to see your group." };
    if (st.cw >= KYIQ.REREAD_CW_MIN || st.streak) {
      why = st.cw >= KYIQ.REREAD_CW_MIN ? st.cw + " confident-wrong over " + st.n + " of your own answers." : "Wrong on the last " + KYIQ.STREAK_N + " answers.";
      return { group: "reread", label: GROUPS.reread, why: why };
    }
    if (st.wacc >= KYIQ.READY_ACC && st.unsure <= KYIQ.MAX_UNSURE && st.slow <= KYIQ.MAX_SLOW && st.days >= KYIQ.READY_DAYS_MIN && st.cw === 0 && !st.forgot) {
      return { group: "ready", label: GROUPS.ready, why: Math.round(st.wacc * 100) + "% right over " + st.n + " of your own answers, across " + st.days + " days." };
    }
    if (st.wacc < KYIQ.REVISE_ACC) return { group: "reread", label: GROUPS.reread, why: Math.round(st.wacc * 100) + "% right over " + st.n + " of your own answers." };
    var bits = [];
    if (st.gr) bits.push(st.gr + " guessed right");
    if (st.cf) bits.push(st.cf + " confused");
    if (st.gw) bits.push(st.gw + " guessed wrong");
    if (st.slowN) bits.push(st.slowN + " slow");
    if (st.forgot) bits.push("forgotten after a gap");
    if (st.days < KYIQ.READY_DAYS_MIN) bits.push("all on one day");
    if (st.cw) bits.push(st.cw + " confident-wrong");
    why = Math.round(st.wacc * 100) + "% right over " + st.n + " of your own answers" + (bits.length ? " (" + bits.join(", ") + ")" : "") + ".";
    return { group: "revise", label: GROUPS.revise, why: why };
  }

  /* analyze(aggs, exam, src) -> { topics: [...] } in revise order (tier first, then group).
   * Each topic: stat + group/label/why + tier/tierLabel/tierWhy. src feeds importanceOf. */
  function tierRank(id) { return id == null ? 9 : TIER_ORDER.indexOf(id); }
  function groupRank(g) { return g === "reread" ? 0 : g === "revise" ? 1 : g === "ready" ? 2 : 3; }
  function analyze(aggs, exam, src) {
    var out = summarize(aggs).map(function (st) {
      var g = classify(st);
      var subj = st.t.split("|")[0];
      var imp = importanceOf(subj, exam, src);
      var tier = tierFor(st, imp);
      var tierWhy = tier.id ? tierWhyText(st, imp, exam) : "Not enough data yet: answer " + KYIQ.MIN_N + " questions on this topic to see its tier.";
      return { t: st.t, n: st.n, ok: st.ok, acc: st.acc, wacc: st.wacc, cr: st.cr, cw: st.cw, gr: st.gr, gw: st.gw, cf: st.cf,
        unsure: st.unsure, slow: st.slow, days: st.days, forgot: st.forgot, group: g.group, label: g.label, why: g.why,
        imp: imp.w, impNeutral: imp.neutral, tier: tier.id, tierLabel: tier.label, tierWhy: tierWhy };
    });
    out.sort(function (a, b) { return tierRank(a.tier) - tierRank(b.tier) || groupRank(a.group) - groupRank(b.group) || (a.t < b.t ? -1 : 1); });
    return { topics: out };
  }
  function tierWhyText(st, imp, exam) {
    var ex = exam ? " for " + examLabel(exam) : "";
    var iw = imp.neutral ? "no exam data, counted neutrally" : imp.w >= 0.66 ? "very important" + ex : imp.w >= 0.33 ? "fairly important" + ex : "less important" + ex;
    return "This topic is " + iw + ", and you got " + st.ok + " of " + st.n + " right" + (st.cw ? " with " + st.cw + " confident-wrong" : "") + ".";
  }
  function examLabel(id) {
    var L = { "neet-pg": "NEET-PG", "ini-cet": "INI-CET", fmge: "FMGE", "neet-ss": "NEET-SS", "ini-ss": "INI-SS",
      usmle: "USMLE", "usmle-step1": "USMLE Step 1", "usmle-step2-ck": "USMLE Step 2 CK", "plab-1": "PLAB 1", "amc-mcq": "AMC MCQ",
      "mccqe-1": "MCCQE Part 1", "mrcp-part1": "MRCP Part 1", "mrcp-part2-written": "MRCP Part 2 Written", "mrcs-part-a": "MRCS Part A" };
    return L[id] || String(id || "your exam");
  }
  /* Rows from one stored attempt record (rows carry ms/ts/conf/pair for one-shot analysis).
   * topicOf(itemId) -> "subject|module" or null; null drops the row (unmapped items never feed groups). */
  function rowsFromAttempt(rec, topicOf) {
    var out = [];
    ((rec && rec.items) || []).forEach(function (x) {
      var t = typeof topicOf === "function" ? topicOf(x.item_id) : null;
      if (!t) return;
      out.push({ t: t, ok: x.correct === true ? 1 : x.correct === false ? 0 : null, conf: cleanConf(x.conf), ms: x.ms || 0, ts: x.ts || 0, pair: x.pair || null, own: true });
    });
    return out;
  }
  /* aggsFromRows(rows, slowMs): fold rows (own !== false, ok != null counted) into aggregates. */
  function aggsFromRows(rows, slowMs) {
    var aggs = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.t || r.own === false || r.ok == null) return;
      noteAnswer(aggs, r.t, { ok: !!r.ok, conf: r.conf, slow: slowMs ? (r.ms || 0) > slowMs : false, day: r.ts ? Math.floor(r.ts / 86400000) : null, ts: r.ts || 0 });
    });
    return aggs;
  }

  /* ---------- confused pairs: which two options the student mixes up, per topic ----------
   * pairs[t] = [{ q: itemId, a, b, ta, tb, ts } newest last, capped PAIR_N]. Texts are short
   * option snippets for the side-by-side; they stay on the device and are never sent. */
  function notePair(pairs, t, e) {
    if (!pairs[t]) pairs[t] = [];
    var list = pairs[t];
    list.push({ q: String(e.q || "").slice(0, 80), a: e.a, b: e.b, ta: String(e.ta || "").slice(0, KYIQ.PAIR_TEXT), tb: String(e.tb || "").slice(0, KYIQ.PAIR_TEXT), ts: e.ts || 0 });
    if (list.length > KYIQ.PAIR_N) pairs[t] = list.slice(-KYIQ.PAIR_N);
    var ks = Object.keys(pairs);
    if (ks.length > KYIQ.PAIR_TOPICS) {
      ks.sort(function (x, y) { return lastPairTs(pairs[x]) - lastPairTs(pairs[y]); });
      ks.slice(0, ks.length - KYIQ.PAIR_TOPICS).forEach(function (k) { delete pairs[k]; });
    }
    return pairs[t];
  }
  function lastPairTs(list) { return list && list.length ? list[list.length - 1].ts || 0 : 0; }
  /* topPairs(pairs, n): newest pairs across topics, [{ t, q, a, b, ta, tb, ts }]. */
  function topPairs(pairs, n) {
    var all = [];
    Object.keys(pairs || {}).forEach(function (t) {
      (pairs[t] || []).forEach(function (e) { all.push({ t: t, q: e.q, a: e.a, b: e.b, ta: e.ta, tb: e.tb, ts: e.ts }); });
    });
    all.sort(function (x, y) { return y.ts - x.ts; });
    return all.slice(0, n || 5);
  }
  function pairLine(e) { return "You mix up \u201C" + e.ta + "\u201D and \u201C" + e.tb + "\u201D."; }

  /* ---------- schedule: 1 / 7 / 21 day reviews ---------- */
  function nextReview(group, today) { return today + (KYIQ.REVIEW_DAYS[group] || KYIQ.REVIEW_DAYS.revise); }
  /* The coach shelf (store.coach): { "subject|module": { g, next } }. */
  function noteReview(store, topic, group, today) {
    if (!store.coach || typeof store.coach !== "object") store.coach = {};
    var g = KYIQ.REVIEW_DAYS[group] ? group : "revise";
    store.coach[topic] = { g: g, next: nextReview(g, today) };
    return store.coach[topic];
  }
  function dueTopics(coach, today) {
    return Object.keys(coach || {}).filter(function (k) { return coach[k] && coach[k].next <= today; }).sort();
  }
  /* Due today: the plan's due reviews (prep-plan.js dueNow, reused) plus the coach topics. */
  function dueToday(store, today) {
    var pp = planPure();
    return { plan: pp ? pp.dueNow(store, today) : null, coach: dueTopics(store && store.coach, today) };
  }

  /* ---------- intro card state (this device only, try/catch) ---------- */
  var INTRO_SEEN = false;
  function introSeen() {
    if (INTRO_SEEN) return true;
    try { if (G && G.localStorage && G.localStorage.getItem(KYIQ.INTRO_KEY) === "1") { INTRO_SEEN = true; return true; } } catch (e) {}
    return false;
  }
  function introDismiss(never) {
    if (!never) return false;
    INTRO_SEEN = true;
    try { if (G && G.localStorage) G.localStorage.setItem(KYIQ.INTRO_KEY, "1"); } catch (e) {}
    return true;
  }

  /* ---------- Ask MaiK context: compact structured summary (capped, plain text) ---------- */
  function summaryText(view, exam, due, pairs) {
    var L = [];
    L.push(KYIQ.NAME + ": what to revise (" + examLabel(exam) + "). From my own answers on this device.");
    ["reread", "revise", "ready"].forEach(function (g) {
      var ts = (view.topics || []).filter(function (x) { return x.group === g; }).slice(0, 6);
      if (!ts.length) return;
      L.push(GROUPS[g] + ": " + ts.map(function (x) { return x.t + " (" + x.ok + "/" + x.n + (x.tierLabel ? ", " + x.tierLabel : "") + ")"; }).join("; ") + ".");
    });
    var fresh = (view.topics || []).filter(function (x) { return x.group === "fresh"; }).length;
    if (fresh) L.push(fresh + " more topic(s) need " + KYIQ.MIN_N + " answers first.");
    if (due && due.length) L.push("Due today: " + due.slice(0, 8).join(", ") + ".");
    (pairs || []).slice(0, 4).forEach(function (e) { L.push("I mix up \"" + e.ta + "\" and \"" + e.tb + "\" (" + e.t + ")."); });
    L.push("Tell me what to revise first, in plain words. No scores, ranks or predictions.");
    var s = L.join("\n");
    if (s.length > KYIQ.SUMMARY_MAX_BYTES) s = s.slice(0, KYIQ.SUMMARY_MAX_BYTES - 1) + "\u2026";
    return s;
  }

  var API = { KYIQ: KYIQ, TIER_ORDER: TIER_ORDER, TIER_LABEL: TIER_LABEL, GROUPS: GROUPS, OUTCOMES: OUTCOMES,
    CONF: CONF, cleanConf: cleanConf, cleanPair: cleanPair, capture: capture, emptyCounts: emptyCounts, confCounts: confCounts,
    topicKey: topicKey, outcome: outcome, emptyAgg: emptyAgg, noteAnswer: noteAnswer, reconf: reconf, wacc: wacc, daySpan: daySpan,
    forgotten: forgotten, weaknessOf: weaknessOf, importanceOf: importanceOf, tierFor: tierFor,
    summarize: summarize, classify: classify, analyze: analyze, examLabel: examLabel,
    rowsFromAttempt: rowsFromAttempt, aggsFromRows: aggsFromRows,
    notePair: notePair, topPairs: topPairs, pairLine: pairLine,
    nextReview: nextReview, noteReview: noteReview, dueTopics: dueTopics, dueToday: dueToday,
    introSeen: introSeen, introDismiss: introDismiss, summaryText: summaryText };
  if (NODE) { module.exports = API; return; }
  if (G) G.PREP_COACH = API;
})(typeof window !== "undefined" ? window : this);
