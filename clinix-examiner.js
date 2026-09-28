/* clinix-examiner.js — CliniX · Dynamic AI Examiner & Viva Engine
 *
 * Simulates a realistic bedside clinical viva examiner.
 * Reacts to the learner's actual elicited findings, differential diagnosis, and reasoning.
 * Challenges assumptions, asks follow-up questions, detects clinical contradictions,
 * and checks for patient safety / red flag omissions.
 */
(function () {
  "use strict";

  function createVivaSession(caseState, options) {
    options = options || {};
    return {
      id: "viva." + Date.now(),
      caseId: caseState ? caseState.caseId : "",
      turnIndex: 0,
      history: [],
      score: 100,
      contradictionsFound: [],
      safetyAlerts: [],
      status: "active" // active | completed
    };
  }

  /* ── 1. Generate Next Examiner Question ─────────────────────────────────── */

  function getNextQuestion(vivaSession, caseState) {
    if (!vivaSession || !caseState) return null;
    var turn = vivaSession.turnIndex;
    var rawCase = caseState.rawCase || {};
    var diff = caseState.differential || [];
    var finalDx = caseState.finalDiagnosis || "";
    var examRevealed = caseState.examRevealed || {};
    var questions = [];

    // Turn 0: Elicit findings synthesis
    if (turn === 0) {
      return {
        turn: 0,
        type: "findings_summary",
        question: "Examiner: You have completed your physical examination. What were your key positive and negative findings in this patient?",
        context: "Initial findings synthesis",
        expectedPoints: findingPoints(caseState)
      };
    }

    // Turn 1: Differential and rationale
    if (turn === 1) {
      var topDx = diff.length > 0 ? diff[0] : (finalDx || "your primary diagnosis");
      return {
        turn: 1,
        type: "differential_rationale",
        question: "Examiner: You have prioritized " + topDx + ". What specific findings on your examination support this diagnosis over the alternatives?",
        context: "Defending primary differential",
        expectedPoints: findingPoints(caseState).concat(diagnosisPoints(rawCase)),
        needed: 2
      };
    }

    // Turn 2: Check for contradictions or omitted essential exams
    if (turn === 2) {
      var contradictionQ = checkContradictions(caseState);
      if (contradictionQ) {
        vivaSession.contradictionsFound.push(contradictionQ);
        return {
          turn: 2,
          type: "contradiction_challenge",
          question: "Examiner: " + contradictionQ.question,
          context: "Testing clinical coherence",
          expectedPoints: sentences(contradictionQ.expectedExplanation),
          needed: 1
        };
      }

      // If no contradiction, ask about a dynamic maneuver
      return {
        turn: 2,
        type: "dynamic_maneuver",
        question: "Examiner: How would you use a dynamic physiological maneuver (such as handgrip, Valsalva, or respiration) to confirm the hemodynamic significance of your findings?",
        context: "Physiological maneuvers",
        expectedPoints: MANEUVER_POINTS.slice()
      };
    }

    // Turn 3: Diagnostic investigation interpretation
    if (turn === 3) {
      return {
        turn: 3,
        type: "investigation_priority",
        question: "Examiner: What is the single most urgent investigation you would order right now, and what specific abnormality would change your immediate management within the next hour?",
        context: "Investigation prioritization and emergency management",
        expectedPoints: investigationPoints(rawCase)
      };
    }

    // Turn 4: Patient safety & red flags
    if (turn === 4) {
      return {
        turn: 4,
        type: "red_flags_safety",
        question: "Examiner: What clinical red flags or deterioration markers must the ward team monitor for in this patient overnight?",
        context: "Patient safety and disposition",
        expectedPoints: RED_FLAG_POINTS.slice()
      };
    }

    vivaSession.status = "completed";
    return null;
  }

  /* ── 1b. What a good answer contains ─────────────────────────────────────── */

  /* A viva answer is marked on CONTENT: each turn carries the concepts a competent answer names,
   * and the score is the share of them the student actually mentions. Length, confidence and
   * filler earn nothing, so "banana" five times is a fail, not honours. */

  var MANEUVER_POINTS = [
    "handgrip afterload", "valsalva preload", "squatting venous return", "standing preload",
    "inspiration right sided carvallo", "expiration left sided", "murmur louder intensity",
    "murmur softer quieter", "hepatojugular reflux abdominojugular", "mitral regurgitation",
    "aortic stenosis", "hypertrophic cardiomyopathy obstruction"
  ];

  var GENERIC_INVESTIGATIONS = [
    "ecg electrocardiogram", "troponin", "chest xray radiograph", "echocardiogram echo",
    "arterial blood gas abg", "blood culture", "full blood count haemoglobin", "glucose",
    "electrolytes potassium sodium", "renal function creatinine urea", "lactate", "ct scan", "mri",
    "ultrasound", "management change treatment"
  ];

  var RED_FLAG_POINTS = [
    "hypotension blood pressure falling", "hypoxia oxygen saturation spo2", "respiratory rate tachypnoea",
    "heart rate tachycardia arrhythmia", "urine output oliguria", "conscious gcs confusion drowsy",
    "chest pain", "breathlessness worsening", "fever sepsis", "bleeding", "early warning news score",
    "escalate senior icu", "telemetry monitoring", "fluid balance"
  ];

  var STOP = {};
  ("the and for with that this was were are has have had not but his her its any all our your you " +
   "from into over under than then them they there their which what when where who why how would " +
   "could should will can may might must also very more most some such each other only just been " +
   "being patient findings finding examination exam noted note normal").split(" ").forEach(function (w) { STOP[w] = 1; });

  /* Tiny synonym folding so "raised JVP" meets "JVP elevated". */
  var SYN = {
    raised: "elevat", high: "elevat", increased: "elevat", elevated: "elevat", elevation: "elevat",
    reduced: "reduc", decreased: "reduc", diminished: "reduc", low: "reduc",
    xray: "xray", cxr: "xray", radiograph: "xray", ekg: "ecg", electrocardiogram: "ecg",
    echocardiography: "echo", echocardiogram: "echo", saturation: "spo2", sats: "spo2", oxygen: "spo2",
    tachypnea: "tachypnoea", hypoxaemia: "hypoxia", hypoxemia: "hypoxia", louder: "loud", softer: "soft", quieter: "soft"
  };

  function stems(text) {
    var words = String(text || "").toLowerCase().replace(/x-ray/g, "xray").replace(/[^a-z0-9]+/g, " ").split(" ");
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 3 || STOP[w]) continue;
      if (SYN[w]) w = SYN[w];
      w = w.length > 6 ? w.slice(0, 6) : w;
      if (out.indexOf(w) < 0) out.push(w);
    }
    return out;
  }

  function sentences(text) {
    return String(text || "").split(/[.;]\s+|\.$/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 2; });
  }

  function findingPoints(caseState) {
    var rawCase = caseState.rawCase || {};
    var pts = [];
    (rawCase.positiveFindings || []).forEach(function (f) { pts.push(String(f)); });
    var revealed = caseState.examRevealed || {};
    var src = Object.keys(revealed).length ? revealed : (rawCase.exam || {});
    var abnormal = Object.keys(src).filter(function (k) { return src[k] && src[k].abnormal === true; });
    var keys = abnormal.length ? abnormal : Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      var f = src[keys[i]];
      sentences(f && (f.finding || (typeof f === "string" ? f : ""))).forEach(function (x) { pts.push(x); });
    }
    (rawCase.importantNegatives || []).forEach(function (f) { pts.push(String(f)); });
    return pts;
  }

  function diagnosisPoints(rawCase) {
    var d = rawCase.correctDiagnosis || rawCase.diagnosis;
    if (d && typeof d === "object") return (d.accept || []).map(String).concat(d.answer ? [String(d.answer)] : []);
    return d ? [String(d)] : [];
  }

  function investigationPoints(rawCase) {
    var pts = [];
    var ix = rawCase.investigations || {};
    (rawCase.essentialInvestigations || []).forEach(function (id) {
      var e = ix[id];
      pts.push(String(id).replace(/[._-]+/g, " ") + (e && e.title ? " " + e.title : ""));
    });
    return pts.concat(GENERIC_INVESTIGATIONS);
  }

  /* One concept counts as named when enough of its content words appear: any one word for a short
   * concept, about 40% of them for a long authored sentence. */
  function pointHit(point, answerStems) {
    var ps = stems(point);
    if (!ps.length) return false;
    var hits = 0;
    for (var i = 0; i < ps.length; i++) if (answerStems.indexOf(ps[i]) >= 0) hits++;
    var need = ps.length <= 3 ? 1 : Math.ceil(ps.length * 0.4);
    return hits >= need;
  }

  function scoreContent(turnObj, ans) {
    var points = (turnObj && turnObj.expectedPoints) || [];
    var aStems = stems(ans);
    if (!aStems.length || !points.length) return { fraction: 0, matched: [], missed: points.slice(0, 2) };
    var matched = [], missed = [];
    for (var i = 0; i < points.length; i++) (pointHit(points[i], aStems) ? matched : missed).push(points[i]);
    var needed = Math.max(1, Math.min(turnObj.needed || 3, points.length));
    return { fraction: Math.min(1, matched.length / needed), matched: matched, missed: missed };
  }

  /* ── 2. Check for Clinical Contradictions ────────────────────────────────── */

  function checkContradictions(caseState) {
    if (!caseState) return null;
    var rawCase = caseState.rawCase || {};
    var diff = (caseState.differential || []).map(function (d) { return String(d).toLowerCase(); });
    var finalDx = (caseState.finalDiagnosis || "").toLowerCase();
    var exam = caseState.examRevealed || {};

    // Example Contradiction 1: Diagnosing Heart Failure when JVP was checked and normal or not elevated
    var claimsHF = diff.some(function (d) { return d.indexOf("heart failure") >= 0 || d.indexOf("ccf") >= 0; }) ||
                   finalDx.indexOf("heart failure") >= 0;
    if (claimsHF && exam["jvp"]) {
      var jvpFinding = (exam["jvp"].finding || "").toLowerCase();
      if (jvpFinding.indexOf("not visibly elevated") >= 0 || jvpFinding.indexOf("normal") >= 0) {
        return {
          type: "jvp_heart_failure_mismatch",
          question: "You have placed Heart Failure high on your differential, but you noted the JVP was not visibly elevated. How do you reconcile that finding with decompensated congestive failure?",
          expectedExplanation: "Could indicate isolated left heart failure without right ventricular backpressure, or severe chronic venous disease / dehydration."
        };
      }
    }

    // Example Contradiction 2: Diagnosing Aortic Stenosis when pulse was bounding
    var claimsAS = diff.some(function (d) { return d.indexOf("aortic stenosis") >= 0; }) ||
                   finalDx.indexOf("aortic stenosis") >= 0;
    if (claimsAS && exam["pulse"]) {
      var pulseFinding = (exam["pulse"].finding || "").toLowerCase();
      if (pulseFinding.indexOf("water-hammer") >= 0 || pulseFinding.indexOf("bounding") >= 0) {
        return {
          type: "pulse_as_mismatch",
          question: "Aortic stenosis characteristically presents with a slow-rising, low-amplitude pulse (pulsus parvus et tardus). Your examination noted a bounding pulse. How do you explain this discrepancy?",
          expectedExplanation: "A bounding pulse is characteristic of aortic regurgitation or high-output states, directly arguing against isolated severe aortic stenosis."
        };
      }
    }

    // Example Contradiction 3: Diagnosing COPD when percussion was stony dull
    var claimsCOPD = diff.some(function (d) { return d.indexOf("copd") >= 0; });
    if (claimsCOPD && exam["percuss"]) {
      var percFinding = (exam["percuss"].finding || "").toLowerCase();
      if (percFinding.indexOf("stony dull") >= 0) {
        return {
          type: "percussion_copd_mismatch",
          question: "COPD typically demonstrates generalized hyperresonance. You noted a stony dull percussion note. What co-existing complication does this signify?",
          expectedExplanation: "Stony dullness indicates a pleural effusion rather than uncomplicated COPD hyperinflation."
        };
      }
    }

    return null;
  }

  /* ── 3. Evaluate Viva Turn Answer ────────────────────────────────────────── */

  function evaluateAnswer(vivaSession, turnObj, answerText) {
    if (!vivaSession || !turnObj) return { score: 0, feedback: "Session invalid" };
    var ans = String(answerText || "").toLowerCase().trim();
    if (!ans) {
      return {
        verdict: "incomplete",
        score: 0,
        feedback: "No answer provided. In a clinical viva, silence is scored as an omission."
      };
    }

    var content = scoreContent(turnObj, ans);
    var scoreDelta = Math.round(20 * content.fraction);
    var feedback;
    if (scoreDelta >= 15) feedback = "Good clinical articulation: the key points are there.";
    else if (scoreDelta > 0) feedback = "Partly there. Also address: " + content.missed.slice(0, 2).join("; ") + ".";
    else feedback = "That does not answer the question. A good answer would address: " + content.missed.slice(0, 2).join("; ") + ".";
    var isSafe = true;

    // Safety checks: check for dangerous omissions or lethal errors
    if (turnObj.type === "investigation_priority" || turnObj.type === "red_flags_safety") {
      if (ans.indexOf("discharge home") >= 0 || ans.indexOf("no investigations") >= 0) {
        scoreDelta = 0;
        isSafe = false;
        feedback = "Unsafe management decision: discharging an acute cardiopulmonary patient without stabilization.";
        vivaSession.safetyAlerts.push(feedback);
      }
    }

    vivaSession.history.push({
      turn: turnObj.turn,
      type: turnObj.type,
      question: turnObj.question,
      answer: answerText,
      feedback: feedback,
      score: scoreDelta,
      matchedPoints: content.matched.length,
      safe: isSafe
    });

    vivaSession.turnIndex++;

    return {
      verdict: scoreDelta >= 15 ? "correct" : (scoreDelta >= 10 ? "partially_correct" : "unsatisfactory"),
      score: scoreDelta,
      feedback: feedback,
      isSafe: isSafe
    };
  }

  /* ── 4. Synthesize Final Viva Scorecard ──────────────────────────────────── */

  function finalizeViva(vivaSession) {
    if (!vivaSession) return { totalScore: 0, verdict: "incomplete" };
    var total = 0;
    for (var i = 0; i < vivaSession.history.length; i++) {
      total += (vivaSession.history[i].score || 0);
    }

    var verdict = "pass";
    if (vivaSession.safetyAlerts.length > 0) {
      verdict = "fail_safety";
      total = Math.min(45, total);
    } else if (total >= 80) {
      verdict = "honours";
    } else if (total < 50) {
      verdict = "fail_knowledge";
    }

    return {
      caseId: vivaSession.caseId,
      totalScore: total,
      maxScore: 100,
      verdict: verdict,
      turnsCompleted: vivaSession.history.length,
      contradictionsEncountered: vivaSession.contradictionsFound.length,
      safetyAlerts: vivaSession.safetyAlerts,
      history: vivaSession.history
    };
  }

  var API = {
    createVivaSession: createVivaSession,
    getNextQuestion: getNextQuestion,
    checkContradictions: checkContradictions,
    scoreContent: scoreContent,
    evaluateAnswer: evaluateAnswer,
    finalizeViva: finalizeViva
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_EXAMINER = API;
})();
