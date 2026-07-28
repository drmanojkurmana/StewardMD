/* FollowCare AI — Recovery Intelligence (Phase 5). PURE, deterministic/heuristic, no I/O, no PHI, no ML.
 *
 * The buildable heart of Phase 5: a Recovery Twin (expected vs actual recovery — MODULE 1), a trend-based
 * deterioration predictor (MODULE 2), and explainable readmission-PREVENTION actions (MODULE 3). v1 is a
 * transparent heuristic over the episode's own assessment history + the pathway's expected recovery curve
 * — NOT a trained model (MODULE 15: no auto-retrain on patient data). A future ML model can replace the
 * heuristic behind this same interface. window.FollowCareIntel + module.exports.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  // Expected recovery score at a given day: a monotonic curve from an assumed low start to ~100 by the
  // pathway's follow-up horizon. Data-driven if the pathway carries `expectedCurve`; else derived from
  // followUpDays. This is the "twin's" expectation to compare the patient against (MODULE 1).
  function expectedScore(pathway, dayOffset) {
    if (!pathway) return null;
    if (pathway.expectedCurve) {                                // [{day,score}] → linear interpolate
      var c = pathway.expectedCurve, prev = c[0];
      for (var i = 0; i < c.length; i++) { if (c[i].day >= dayOffset) { if (i === 0) return c[0].score; var a = c[i - 1], b = c[i]; return Math.round(a.score + (b.score - a.score) * (dayOffset - a.day) / Math.max(1, b.day - a.day)); } prev = c[i]; }
      return prev.score;
    }
    var horizon = pathway.followUpDays || (pathway.schedule && pathway.schedule[pathway.schedule.length - 1]) || 14;
    var start = 55;                                             // assumed just-discharged baseline
    var frac = Math.max(0, Math.min(1, (dayOffset || 0) / horizon));
    return Math.round(start + (100 - start) * frac);
  }

  // MODULE 1 — Recovery Twin: expected vs actual + the gap + why. reasons come from the latest engine result.
  function recoveryTwin(pathway, dayOffset, latest) {
    var expected = expectedScore(pathway, dayOffset);
    var actual = latest ? latest.recoveryScore : null;
    var gap = (expected != null && actual != null) ? (actual - expected) : null;
    return {
      expected: expected, actual: actual, gap: gap,
      onTrack: gap == null ? null : gap >= -10,                 // >10 points below expected = behind
      status: gap == null ? "unknown" : gap >= -3 ? "on_track" : gap >= -10 ? "slightly_behind" : "behind",
      reasons: latest ? (latest.reasons || []).slice(0, 4) : []
    };
  }

  // MODULE 2 — Predictive deterioration from the recent score trajectory + current red/soft signals. history
  // = ascending [{dayOffset, score, escalation}]. Deterministic: a sustained downslope + concerning current
  // state → a bounded, EXPLAINED prediction. Never a diagnosis; always "possible", always with reasons.
  function predictDeterioration(history, latest, pathway) {
    history = (history || []).slice().sort(function (a, b) { return a.dayOffset - b.dayOffset; });
    var reasons = [], score = 0;                                // 0..100 likelihood of near-term deterioration
    if (latest && latest.escalation === "red") { return { likelihood: "high", windowHours: 24, reasons: ["Current red-flag finding"], _note: "already critical — urgent evaluation advised" }; }
    if (history.length >= 2) {
      var last = history[history.length - 1].score, prev = history[history.length - 2].score;
      var slope = last - prev;
      if (slope <= -12) { score += 45; reasons.push("Recovery score dropping fast (" + prev + "→" + last + ")"); }
      else if (slope <= -5) { score += 25; reasons.push("Recovery score declining (" + prev + "→" + last + ")"); }
      // sustained multi-point decline
      if (history.length >= 3 && history[history.length - 3].score > prev && prev > last) { score += 15; reasons.push("Sustained downward trend over 3 check-ins"); }
    }
    if (latest) {
      if (latest.escalation === "orange") { score += 25; reasons.push("Current amber escalation"); }
      if (latest.readmissionRisk === "high" || latest.readmissionRisk === "very_high") { score += 20; reasons.push("High readmission risk"); }
      if ((latest.redFlags || []).length) { score += 10; }
      if (latest.trend === "declining" || latest.trend === "critical") { score += 10; }
    }
    score = Math.max(0, Math.min(95, score));
    var likelihood = score >= 60 ? "high" : score >= 35 ? "moderate" : score >= 15 ? "low" : "minimal";
    var windowHours = likelihood === "high" ? 72 : likelihood === "moderate" ? 120 : null;
    if (!reasons.length) reasons.push("No deterioration signal in the current trajectory");
    return { likelihood: likelihood, score: score, windowHours: windowHours, reasons: reasons };
  }

  // MODULE 3 — Readmission PREVENTION: explain the risk + suggest reviewable actions (never orders). Actions
  // are suggestions for the treating team; the doctor decides. Disease-aware where useful.
  function preventionPlan(latest, pathwayId) {
    if (!latest) return { risk: "low", reasons: [], actions: [] };
    var actions = [], reasons = (latest.reasons || []).slice(0, 5);
    var esc = latest.escalation, risk = latest.readmissionRisk;
    if (esc === "red") actions.push("Advise urgent in-person evaluation now");
    if (esc === "orange" || risk === "high" || risk === "very_high") { actions.push("Earlier OP review or teleconsult"); }
    if ((latest.redFlags || []).some(function (f) { return /adherence|not taken|medication/i.test(f.reason || ""); })) actions.push("Reinforce medication adherence; check for barriers");
    // disease-specific reviewable investigations (suggestions only)
    var byDz = {
      pneumonia: ["Consider repeat CBC/CRP and chest imaging if not improving"],
      heart_failure: ["Review weight/fluid status; consider diuretic review by the treating team"],
      copd: ["Assess inhaler technique; consider review if SpO₂ falling"],
      aki: ["Review renal function and hydration"],
      diabetes: ["Review glucose logs; check for hypo/hyper pattern"],
      dengue: ["Ensure hydration; watch for warning signs"],
      asthma: ["Assess inhaler technique and adherence; review if reliever over-used"],
      tuberculosis: ["Reinforce daily ATT adherence (consider DOT); watch for drug toxicity"],
      pleural_effusion: ["Follow up imaging; review if breathlessness or fever recurs"],
      acs: ["Reinforce antiplatelet/statin adherence; low threshold to review recurrent chest pain"],
      arrhythmia: ["Review rate/rhythm control and anticoagulation adherence"],
      stroke: ["Reinforce secondary-prevention meds; ensure rehab follow-up"],
      seizure: ["Confirm anti-seizure medication adherence; review levels if indicated"],
      ckd: ["Review renal function, fluid status and nephrotoxin avoidance"],
      nephrotic: ["Monitor oedema/proteinuria; review diuretic and immunosuppression per team"],
      cld: ["Watch for encephalopathy/bleeding; reinforce lactulose/diuretic adherence"],
      hepatitis: ["Monitor for worsening jaundice/encephalopathy; ensure hydration and nutrition"],
      pancreatitis: ["Advance diet as tolerated; risk-factor (alcohol/gallstone) counselling"],
      ugib: ["Reinforce PPI/beta-blocker adherence; watch for re-bleeding"],
      malaria: ["Complete full antimalarial course; watch for haemolysis/severe features"],
      cellulitis: ["Complete antibiotic course; mark and monitor the margin for spread"],
      sepsis: ["Complete antibiotic course; monitor for recurrent fever/organ dysfunction"],
      poisoning: ["Arrange mental-health / toxicology follow-up as appropriate"],
      hypertension: ["Review home BP log; consider medication review if persistently high"],
      post_op: ["Monitor wound for infection; review analgesia and mobilisation"],
      generic: ["Confirm the scheduled follow-up appointment and safety-netting advice"]
    };
    if (byDz[pathwayId] && (esc === "orange" || esc === "yellow" || risk !== "low")) actions = actions.concat(byDz[pathwayId]);
    if (!actions.length) actions.push("Continue current recovery plan");
    return { risk: risk || "low", reasons: reasons, actions: uniq(actions) };
  }
  function uniq(a) { var o = {}, r = []; a.forEach(function (x) { if (!o[x]) { o[x] = 1; r.push(x); } }); return r; }

  // MODULE 9/10 — an executive recovery brief number-set from a cohort (reuses analytics-style aggregates but
  // adds the predicted-readmission count from the per-patient predictions supplied by the caller).
  function executiveBrief(cohort) {
    cohort = cohort || {};
    return {
      highRisk: cohort.highRisk || 0, predictedReadmissions: cohort.predictedReadmissions || 0,
      teleconsultSuggested: cohort.teleconsultSuggested || 0, medicationCompliancePct: cohort.medicationCompliancePct == null ? null : cohort.medicationCompliancePct,
      avgRecoveryDays: cohort.avgRecoveryDays == null ? null : cohort.avgRecoveryDays,
      topConcerns: cohort.topConcerns || []
    };
  }

  var API = { expectedScore: expectedScore, recoveryTwin: recoveryTwin, predictDeterioration: predictDeterioration, preventionPlan: preventionPlan, executiveBrief: executiveBrief, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareIntel = API;
})();
