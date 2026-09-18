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
        context: "Initial findings synthesis"
      };
    }

    // Turn 1: Differential and rationale
    if (turn === 1) {
      var topDx = diff.length > 0 ? diff[0] : (finalDx || "your primary diagnosis");
      return {
        turn: 1,
        type: "differential_rationale",
        question: "Examiner: You have prioritized " + topDx + ". What specific findings on your examination support this diagnosis over the alternatives?",
        context: "Defending primary differential"
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
          context: "Testing clinical coherence"
        };
      }

      // If no contradiction, ask about a dynamic maneuver
      return {
        turn: 2,
        type: "dynamic_maneuver",
        question: "Examiner: How would you use a dynamic physiological maneuver (such as handgrip, Valsalva, or respiration) to confirm the hemodynamic significance of your findings?",
        context: "Physiological maneuvers"
      };
    }

    // Turn 3: Diagnostic investigation interpretation
    if (turn === 3) {
      return {
        turn: 3,
        type: "investigation_priority",
        question: "Examiner: What is the single most urgent investigation you would order right now, and what specific abnormality would change your immediate management within the next hour?",
        context: "Investigation prioritization and emergency management"
      };
    }

    // Turn 4: Patient safety & red flags
    if (turn === 4) {
      return {
        turn: 4,
        type: "red_flags_safety",
        question: "Examiner: What clinical red flags or deterioration markers must the ward team monitor for in this patient overnight?",
        context: "Patient safety and disposition"
      };
    }

    vivaSession.status = "completed";
    return null;
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

    var scoreDelta = 20;
    var feedback = "Good clinical articulation.";
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
    evaluateAnswer: evaluateAnswer,
    finalizeViva: finalizeViva
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_EXAMINER = API;
})();
