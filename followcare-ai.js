/* FollowCare AI — Adaptive Clinical layer (Phase 2). DETERMINISTIC, offline, no network, no PHI, no LLM.
 *
 * Sits ON TOP of the Phase-1 RecoveryEngine result and makes FollowCare adaptive without giving up the
 * safety invariant that a DETERMINISTIC engine owns every clinical decision (Phase-2 MODULE 18/19). The LLM
 * (server, functions/_followcare_ai.js) may only PHRASE the reasons produced here — it never changes them.
 *
 *  - nextInterval(result, pathway, dayOffset) — the AI decides WHEN to check in next: sooner when declining,
 *    the pathway cadence when stable, stretched when improving (MODULE 3).
 *  - doctorSummary(result, opts) — the 30-second doctor card: score, trend, top reasons, risk %, one
 *    recommendation (MODULES 6/7/15/17).
 *  - appointmentRec(result) — earlier_review | routine | teleconsult | none (MODULE 12).
 *  - riskPercent(result) — readmission risk as an explainable 0-100 (MODULE 10/17).
 *  - medicationFollowUp(answers) — the "why did you skip?" branch → action (MODULE 11).
 *  - adaptiveProbes(pathwayId, answers, opts) — extra targeted questions when an answer signals concern
 *    (a safe, data-driven slice of MODULE 1; full free-text chat is a later increment).
 *
 * window.FollowCareAI + module.exports.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var HOUR = 3600000, DAY = 86400000;

  // MODULE 3 — adaptive next check-in. Returns { deltaHours, dayOffset?, reason }. The scheduler uses
  // deltaHours from "now" for a deteriorating patient, else the pathway's next scheduled day.
  function nextInterval(result, pathway, dayOffset) {
    if (!result) return { deltaHours: 24, reason: "default" };
    var esc = result.escalation, trend = result.trend;
    if (esc === "red") return { deltaHours: 0, reason: "red — urgent, not a routine check-in" };
    if (esc === "orange" || trend === "critical") return { deltaHours: 12, reason: "concerning — recheck within 12h" };
    if (esc === "yellow" || trend === "declining") return { deltaHours: 24, reason: "watch — recheck tomorrow" };
    // stable/improving → the pathway's normal cadence (next scheduled day after this one)
    var nextDay = nextScheduledDay(pathway, dayOffset);
    if (trend === "improving" && nextDay != null) {
      // stretch: skip to the following scheduled day when clearly improving and well
      var after = nextScheduledDay(pathway, nextDay);
      if (after != null && (result.recoveryScore || 0) >= 85) return { dayOffset: after, reason: "improving — spaced out" };
    }
    return nextDay != null ? { dayOffset: nextDay, reason: "stable — normal cadence" } : { deltaHours: 24, reason: "stable" };
  }
  function nextScheduledDay(pathway, dayOffset) {
    if (!pathway || !pathway.schedule) return null;
    for (var i = 0; i < pathway.schedule.length; i++) if (pathway.schedule[i] > (dayOffset || 0)) return pathway.schedule[i];
    return null;
  }

  // MODULE 10/17 — explainable readmission risk as a percentage (never a black box: driven by the engine's
  // discrete risk + score + trend, all of which carry reasons).
  function riskPercent(result) {
    if (!result) return 0;
    var base = { very_high: 90, high: 70, moderate: 45, low: 15 }[result.readmissionRisk] || 15;
    if (result.trend === "critical") base += 8; else if (result.trend === "declining") base += 4; else if (result.trend === "improving") base -= 6;
    if ((result.recoveryScore || 100) < 50) base += 6;
    if (result.confidence === "low") base += 4;                 // uncertainty widens risk upward (safe direction)
    return Math.max(0, Math.min(99, Math.round(base)));
  }

  // MODULE 12 — what kind of review the AI recommends (a suggestion; the doctor decides).
  function appointmentRec(result) {
    if (!result) return "routine";
    if (result.escalation === "red") return "earlier_review";
    if (result.escalation === "orange") return "earlier_review";
    if (result.escalation === "yellow" || result.needsReview) return "teleconsult";
    if (result.trend === "improving" && (result.recoveryScore || 0) >= 85) return "none";
    return "routine";
  }

  // MODULE 6/7 — the doctor's 30-second card. Reasons + one recommendation, all from the deterministic result.
  function recommendation(result) {
    switch (result && result.escalation) {
      case "red": return "Advise urgent medical evaluation now; review immediately.";
      case "orange": return "Review within 24 hours.";
      case "yellow": return result.needsReview ? "Review — uncertain/low-confidence answers." : "Recheck tomorrow; review if not improving.";
      default: return (result && result.trend === "improving") ? "Recovering well — continue current plan." : "Continue current plan.";
    }
  }
  function doctorSummary(result, opts) {
    opts = opts || {};
    if (!result) return null;
    return {
      recoveryScore: result.recoveryScore, trend: result.trend, confidence: result.confidence,
      escalation: result.escalation, riskPercent: riskPercent(result),
      reasons: (result.reasons || []).slice(0, 4),
      redFlags: (result.redFlags || []).map(function (f) { return f.reason; }),
      recommendation: recommendation(result), appointment: appointmentRec(result),
      needsReview: !!result.needsReview, disease: opts.disease || null
    };
  }

  // MODULE 11 — medication non-adherence branch. Given the day's answers, if a dose was skipped/unavailable,
  // return the follow-up question + the action per reason (deterministic; no therapy change — only reinforce
  // instructions / notify). meds_reason is an optional answer the portal collects on the follow-up.
  function medicationFollowUp(answers) {
    answers = answers || {};
    var m = String(answers.meds_taken || "").toLowerCase();
    if (m !== "skipped" && m !== "unavailable") return null;
    var reason = String(answers.meds_reason || "").toLowerCase();
    var action = "notify";                                       // default: surface to the care team
    if (reason === "forgot") action = "reminder";               // set a reminder; reinforce adherence
    else if (reason === "side_effects") action = "notify_doctor"; // never change the drug — flag for the doctor
    else if (reason === "unavailable") action = "contact_hospital";
    return {
      ask: { id: "meds_reason", text: "Why was the medicine not taken?", i18nKey: "fc.q.medsreason", type: "choice", options: ["forgot", "side_effects", "unavailable"] },
      reason: reason || null, action: action,
      note: action === "side_effects" ? "Possible side effect reported — flagged for the treating team (no medicine change advised here)." : null
    };
  }

  // MODULE 1 (safe slice) — adaptive follow-up PROBES: when an answer signals concern, surface extra targeted
  // questions from the pathway's question.probes map (data-driven), so the conversation adapts without a
  // free-text LLM chat. Returns an array of question objects to append (deduped against already-asked ids).
  function adaptiveProbes(pathwayId, answers, opts) {
    var PW = (opts && opts.pathways) || G.FollowCarePathways; var pw = PW && PW.get && PW.get(pathwayId); if (!pw) return [];
    answers = answers || {};
    var out = [], seen = {};
    (pw.questions || []).forEach(function (q) {
      if (!q.probes) return;
      var val = answers[q.id];
      q.probes.forEach(function (p) {
        if (matches(p.when, val) && !seen[p.ask.id] && answers[p.ask.id] == null) { seen[p.ask.id] = 1; out.push(p.ask); }
      });
    });
    var med = medicationFollowUp(answers);
    if (med && answers.meds_reason == null && !seen[med.ask.id]) out.push(med.ask);
    return out;
  }
  function matches(when, val) {
    var s = String(val == null ? "" : val).trim().toLowerCase();
    if (when === "worse") return s === "worse";
    if (when === "yes") return s === "yes" || s === "y" || s === "true";
    var m = String(when).match(/^>=(-?\d+(?:\.\d+)?)$/); if (m) { var n = parseFloat(s); return isFinite(n) && n >= Number(m[1]); }
    m = String(when).match(/^<=(-?\d+(?:\.\d+)?)$/); if (m) { var n2 = parseFloat(s); return isFinite(n2) && n2 <= Number(m[1]); }
    return s === String(when).toLowerCase();
  }

  var API = { nextInterval: nextInterval, riskPercent: riskPercent, appointmentRec: appointmentRec, recommendation: recommendation, doctorSummary: doctorSummary, medicationFollowUp: medicationFollowUp, adaptiveProbes: adaptiveProbes, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareAI = API;
})();
