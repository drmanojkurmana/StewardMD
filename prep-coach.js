/* PrepNucleus coach, PR-a: capture + deterministic analysis. window.PREP_COACH. ES5, pure.
   Capture: one confidence chip per question (Guessing, Confident, Confused), skippable, optionally paired
   with the mark-for-review flag; time taken and answer changes ride along from the runner. Study runs show
   the chips during the run; timed exams keep the run clean (mark-for-review only) and tag flagged questions
   at review time. Records stay small and on the device: per-item conf in the t2r attempt record (IndexedDB)
   and compact counts in the study history (localStorage smd_prep_v1: t2h rows and module tallies).
   Analysis: deterministic, no LLM, no network, no cohort. Groups are Read again, Just revise and Exam ready;
   Exam ready comes from the student's own counted answers only. N = 5 answers guards every group. */
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

  /* ---------- capture ---------- */
  var CONF = [["guessing", "Guessing"], ["confident", "Confident"], ["confused", "Confused"]];
  function cleanConf(v) { return v === "guessing" || v === "confident" || v === "confused" ? v : null; }
  /* One question's capture: the chip (null = skipped) paired with the mark flag, plus time and changes.
     ms is capped at 10 min a question, like the runner's own per-question clock. */
  function capture(conf, marked, ms, changed) {
    return { conf: cleanConf(conf), mark: !!marked, ms: Math.max(0, Math.min(600000, Math.round(ms) || 0)), changed: Math.max(0, Math.round(changed) || 0) };
  }
  function emptyCounts() { return { guessing: 0, confident: 0, confused: 0 }; }
  function confCounts(list) {
    var c = emptyCounts();
    (list || []).forEach(function (v) { v = cleanConf(v); if (v) c[v]++; });
    return c;
  }
  function topicKey(s, m) { return (s || "?") + "|" + (m || "?"); }

  /* ---------- tiers: Silver is the lowest and the default; higher tiers demand stricter evidence ----------
     minN: answers needed before a topic is grouped at all. Fixed at 5 in every tier (the N = 5 guard).
     readyAcc: accuracy at or above which a topic may be Exam ready (with the unsure cap also met).
     reviseAcc: accuracy at or above which a topic is Just revise rather than Read again.
     maxUnsure: share of counted answers tagged Guessing or Confused still allowed for Exam ready. */
  var TIERS = {
    silver: { name: "Silver", minN: 5, readyAcc: 0.8, reviseAcc: 0.6, maxUnsure: 0.25 },
    gold: { name: "Gold", minN: 5, readyAcc: 0.85, reviseAcc: 0.65, maxUnsure: 0.2 },
    platinum: { name: "Platinum", minN: 5, readyAcc: 0.9, reviseAcc: 0.7, maxUnsure: 0.15 },
    diamond: { name: "Diamond", minN: 5, readyAcc: 0.92, reviseAcc: 0.75, maxUnsure: 0.1 }
  };
  function tierIds() { return ["silver", "gold", "platinum", "diamond"]; }
  function tierOf(store) {
    var t = store && store.coachTier;
    return t && TIERS[t] ? t : "silver";
  }

  /* ---------- analysis (deterministic: same rows in, same groups out) ---------- */
  var GROUPS = { reread: "Read again", revise: "Just revise", ready: "Exam ready", fresh: "Too few answers" };
  /* rows: [{ t: "subject|module", ok: 1 | 0 | null (blank), conf, own }]. own defaults to true; a row with
     own false (a withdrawn placeholder, a practice retry that was not counted, an unmapped item) never feeds a
     group, so Exam ready is by the student's own counted answers only. Blanks are noted, not counted. */
  function summarize(rows) {
    var by = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.t) return;
      var b = by[r.t] || (by[r.t] = { t: r.t, n: 0, ok: 0, blank: 0, skipped: 0, cf: emptyCounts() });
      if (r.own === false) { b.skipped++; return; }
      if (r.ok == null) { b.blank++; return; }
      b.n++;
      if (r.ok) b.ok++;
      var c = cleanConf(r.conf);
      if (c) b.cf[c]++;
    });
    return by;
  }
  function classify(st, tierId) {
    var T = TIERS[tierId] || TIERS.silver;
    var acc = st.n ? st.ok / st.n : null;
    var unsure = st.n ? (st.cf.guessing + st.cf.confused) / st.n : 0;
    var g = "fresh", why = "Only " + st.n + " of " + T.minN + " answers so far.";
    if (st.n >= T.minN) {
      if (acc >= T.readyAcc && unsure <= T.maxUnsure) { g = "ready"; why = Math.round(acc * 100) + "% right over " + st.n + " of your own answers."; }
      else if (acc >= T.reviseAcc) { g = "revise"; why = Math.round(acc * 100) + "% right over " + st.n + " of your own answers."; }
      else { g = "reread"; why = Math.round(acc * 100) + "% right over " + st.n + " of your own answers."; }
    }
    return { t: st.t, n: st.n, ok: st.ok, blank: st.blank, skipped: st.skipped, cf: st.cf, acc: acc == null ? null : Math.round(acc * 100) / 100, unsure: Math.round(unsure * 100) / 100, group: g, label: GROUPS[g], why: why };
  }
  /* analyze(rows, tierId) -> { tier, topics: [...] } in topic-key order. Pure. */
  function analyze(rows, tierId) {
    var t = tierId && TIERS[tierId] ? tierId : "silver";
    var by = summarize(rows);
    return { tier: t, topics: Object.keys(by).sort().map(function (k) { return classify(by[k], t); }) };
  }
  /* Rows from one stored attempt record. topicOf(itemId) -> "subject|module" or null; null drops the row
     (the item cannot be tied to the student's own topic history, so it must not feed Exam ready). */
  function rowsFromAttempt(rec, topicOf) {
    var out = [];
    ((rec && rec.items) || []).forEach(function (x) {
      var t = typeof topicOf === "function" ? topicOf(x.item_id) : null;
      if (!t) return;
      out.push({ t: t, ok: x.correct === true ? 1 : x.correct === false ? 0 : null, conf: cleanConf(x.conf), own: true });
    });
    return out;
  }

  /* ---------- schedule: 1 / 7 / 21 day reviews ---------- */
  var REVIEW_1D = 1, REVIEW_7D = 7, REVIEW_21D = 21;
  var REVIEW_DAYS = { reread: REVIEW_1D, revise: REVIEW_7D, ready: REVIEW_21D };
  function nextReview(group, today) {
    return today + (REVIEW_DAYS[group] || REVIEW_7D);
  }
  /* The coach shelf (store.coach): { "subject|module": { g, next } }. noteReview files one topic's next
     review day; dueTopics lists the topics due on or before today, in key order. */
  function noteReview(store, topic, group, today) {
    if (!store.coach || typeof store.coach !== "object") store.coach = {};
    var g = REVIEW_DAYS[group] ? group : "revise";
    store.coach[topic] = { g: g, next: nextReview(g, today) };
    return store.coach[topic];
  }
  function dueTopics(coach, today) {
    return Object.keys(coach || {}).filter(function (k) { return coach[k] && coach[k].next <= today; }).sort();
  }
  /* Due today: the plan's due reviews (prep-plan.js dueNow, reused, not reimplemented) plus the coach topics. */
  function dueToday(store, today) {
    var pp = planPure();
    return { plan: pp ? pp.dueNow(store, today) : null, coach: dueTopics(store && store.coach, today) };
  }

  var API = { CONF: CONF, cleanConf: cleanConf, capture: capture, emptyCounts: emptyCounts, confCounts: confCounts, topicKey: topicKey,
    TIERS: TIERS, tierIds: tierIds, tierOf: tierOf, GROUPS: GROUPS, summarize: summarize, classify: classify, analyze: analyze, rowsFromAttempt: rowsFromAttempt,
    REVIEW_1D: REVIEW_1D, REVIEW_7D: REVIEW_7D, REVIEW_21D: REVIEW_21D, REVIEW_DAYS: REVIEW_DAYS, nextReview: nextReview, noteReview: noteReview, dueTopics: dueTopics, dueToday: dueToday };
  if (NODE) { module.exports = API; return; }
  if (G) G.PREP_COACH = API;
})(typeof window !== "undefined" ? window : this);
