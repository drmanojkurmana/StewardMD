/* FollowCare AI — Hospital Command Center analytics (Phase 3). PURE, deterministic, no I/O, no PHI.
 *
 * Aggregates NON-PHI episode summaries (status, escalation, risk, score, disease, specialty, timestamps)
 * into the operational + quality + executive views of MODULE 1-8/14-18. Everything is derived from data
 * FollowCare already stores; nothing here holds an identifier. window.FollowCareAnalytics + module.exports.
 *
 * Readmission/emergency-revisit metrics need the hospital's admission (ADT) feed, which is a Phase-4
 * integration — those fields are surfaced as null with a note rather than fabricated.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var DAY = 86400000;

  function riskPctOf(e) { return typeof e.riskPercent === "number" ? e.riskPercent : ({ very_high: 90, high: 70, moderate: 45, low: 15 }[e.risk] || 0); }
  function isHighRisk(e) { return riskPctOf(e) >= 70 || e.risk === "high" || e.risk === "very_high"; }
  function board(e) { return e.escalation || ""; }                 // worst-since-ack (board ranking)

  // MODULE 1 — the doctor's command-center counts for THEIR patients (or a hospital's, if pre-filtered).
  function commandCenter(eps, nowMs) {
    eps = eps || []; nowMs = nowMs || 0;
    var c = { active: 0, needReview: 0, highRisk: 0, teleconsultSuggested: 0, recoveredToday: 0, total: eps.length };
    eps.forEach(function (e) {
      if (e.status === "active" || e.status === "escalated") c.active++;
      if (e.needsReview || board(e) === "orange" || board(e) === "red") c.needReview++;
      if (isHighRisk(e)) c.highRisk++;
      if (e.appointment === "teleconsult" || board(e) === "yellow") c.teleconsultSuggested++;
      if (e.status === "recovered" && e.recoveredMs && (nowMs - e.recoveredMs) <= DAY) c.recoveredToday++;
    });
    return c;
  }

  // MODULE 2 — AI Smart Queue: sickest first (board escalation, then risk %, then soonest due).
  function smartQueue(eps) {
    var rank = { red: 3, orange: 2, yellow: 1, green: 0, "": -1 };
    return (eps || []).slice().sort(function (a, b) {
      var r = (rank[board(b)] || -1) - (rank[board(a)] || -1); if (r) return r;
      var rk = riskPctOf(b) - riskPctOf(a); if (rk) return rk;
      return (a.nextDueMs || Infinity) - (b.nextDueMs || Infinity);
    });
  }

  // MODULE 3/4 — status roll-up (department = pathway specialty; hospital = the whole set passed in).
  function rollup(eps) {
    var r = { total: (eps || []).length, active: 0, escalated: 0, recovered: 0, closed: 0, needReview: 0, highRisk: 0, critical: 0 };
    (eps || []).forEach(function (e) {
      if (r[e.status] != null) r[e.status]++;
      if (e.needsReview || board(e) === "orange") r.needReview++;
      if (board(e) === "red") r.critical++;
      if (isHighRisk(e)) r.highRisk++;
    });
    return r;
  }
  function byKey(eps, keyFn) {
    var out = {};
    (eps || []).forEach(function (e) { var k = keyFn(e) || "unknown"; (out[k] = out[k] || []).push(e); });
    return out;
  }
  function byDepartment(eps) { var g = byKey(eps, function (e) { return e.specialty; }), o = {}; Object.keys(g).forEach(function (k) { o[k] = rollup(g[k]); }); return o; }

  // MODULE 7 — per-disease analytics (recovered %, avg recovery days, high-risk %, count).
  function byDisease(eps) {
    var g = byKey(eps, function (e) { return e.disease || e.pathwayId; }), o = {};
    Object.keys(g).forEach(function (k) {
      var list = g[k], done = list.filter(function (e) { return e.status === "recovered"; });
      var days = done.map(function (e) { return (e.recoveredMs && e.createdMs) ? (e.recoveredMs - e.createdMs) / DAY : null; }).filter(function (x) { return x != null; });
      o[k] = {
        total: list.length, recovered: done.length,
        recoveredPct: list.length ? Math.round(100 * done.length / list.length) : 0,
        avgRecoveryDays: days.length ? Math.round(10 * days.reduce(function (a, b) { return a + b; }, 0) / days.length) / 10 : null,
        highRiskPct: list.length ? Math.round(100 * list.filter(isHighRisk).length / list.length) : 0
      };
    });
    return o;
  }

  // MODULE 5 — quality metrics that FollowCare's own data supports. Readmission/revisit = null (needs ADT feed, P4).
  function quality(eps) {
    eps = eps || [];
    var terminal = eps.filter(function (e) { return e.status === "recovered" || e.status === "closed"; });
    var recovered = eps.filter(function (e) { return e.status === "recovered"; });
    var days = recovered.map(function (e) { return (e.recoveredMs && e.createdMs) ? (e.recoveredMs - e.createdMs) / DAY : null; }).filter(function (x) { return x != null; });
    return {
      followUpCompletionPct: eps.length ? Math.round(100 * terminal.length / eps.length) : 0,
      avgRecoveryDays: days.length ? Math.round(10 * days.reduce(function (a, b) { return a + b; }, 0) / days.length) / 10 : null,
      escalationRatePct: eps.length ? Math.round(100 * eps.filter(function (e) { return board(e) === "orange" || board(e) === "red"; }).length / eps.length) : 0,
      highRiskPct: eps.length ? Math.round(100 * eps.filter(isHighRisk).length / eps.length) : 0,
      readmission7dPct: null, readmission30dPct: null, emergencyRevisitPct: null, _note: "readmission/revisit require the hospital ADT feed (Phase 4)"
    };
  }

  // MODULE 6 — executive top-line (high-level only).
  function executive(eps) {
    var q = quality(eps), r = rollup(eps);
    return {
      recoveryIndexPct: r.total ? Math.round(100 * r.recovered / Math.max(1, r.recovered + r.critical + r.needReview)) : 0,
      avgRecoveryDays: q.avgRecoveryDays, patientEngagementPct: engagementPct(eps), activePatients: r.active + r.escalated,
      readmissionReductionPct: null, _note: q._note
    };
  }
  function engagementPct(eps) {   // % of episodes with at least one completed check-in
    if (!eps || !eps.length) return 0;
    var engaged = eps.filter(function (e) { return (e.lastDayDone != null && e.lastDayDone >= 0) || e.status === "recovered"; }).length;
    return Math.round(100 * engaged / eps.length);
  }

  // MODULE 8 — AI Insights: plain-language, TEMPLATED from the aggregates (decision support, not a black box).
  function insights(eps) {
    var out = [], dz = byDisease(eps), q = quality(eps);
    Object.keys(dz).forEach(function (k) {
      var d = dz[k];
      if (d.total >= 5 && d.recoveredPct < 60) out.push(k + ": recovery completion is " + d.recoveredPct + "% across " + d.total + " episodes — review discharge counselling and follow-up cadence.");
      if (d.total >= 5 && d.highRiskPct >= 30) out.push(k + ": " + d.highRiskPct + "% of episodes are high readmission-risk — consider earlier review for this cohort.");
    });
    if (q.escalationRatePct >= 25) out.push("About " + q.escalationRatePct + "% of all episodes escalated for review — check whether red-flag thresholds match your protocols.");
    if (!out.length) out.push("No cohort-level concerns detected in the current period.");
    return out;
  }

  // MODULE 14 — one morning digest (no spam).
  function digest(eps, nowMs) {
    var cc = commandCenter(eps, nowMs || 0);
    return { highRisk: cc.highRisk, needReview: cc.needReview, newRecoveries: cc.recoveredToday, activePatients: cc.active };
  }

  // MODULE 18 — self-benchmarking (this period vs last), never cross-hospital.
  function benchmark(thisEps, lastEps) {
    var a = quality(thisEps), b = quality(lastEps);
    function delta(x, y) { return (x == null || y == null) ? null : Math.round(10 * (x - y)) / 10; }
    return {
      followUpCompletion: { now: a.followUpCompletionPct, prev: b.followUpCompletionPct, delta: delta(a.followUpCompletionPct, b.followUpCompletionPct) },
      avgRecoveryDays: { now: a.avgRecoveryDays, prev: b.avgRecoveryDays, delta: delta(a.avgRecoveryDays, b.avgRecoveryDays) },
      escalationRate: { now: a.escalationRatePct, prev: b.escalationRatePct, delta: delta(a.escalationRatePct, b.escalationRatePct) }
    };
  }

  // MODULE 16 — CSV export (NON-PHI operational columns only; no phone/name/mrn ever).
  function csv(eps) {
    var cols = ["episodeId", "disease", "specialty", "status", "escalation", "score", "riskPercent", "createdMs", "recoveredMs"];
    var lines = [cols.join(",")];
    (eps || []).forEach(function (e) {
      lines.push(cols.map(function (c) { var v = c === "riskPercent" ? riskPctOf(e) : e[c]; return v == null ? "" : String(v).replace(/[",\n]/g, " "); }).join(","));
    });
    return lines.join("\n");
  }

  var API = { commandCenter: commandCenter, smartQueue: smartQueue, rollup: rollup, byDepartment: byDepartment, byDisease: byDisease, quality: quality, executive: executive, insights: insights, digest: digest, benchmark: benchmark, csv: csv, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareAnalytics = API;
})();
