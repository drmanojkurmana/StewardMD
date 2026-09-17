/* clinix-engine.js — CliniX · Clinical Reasoning & Bedside Simulation Engine
 *
 * One shared clinical simulation state connecting:
 *   Patient presentation → history → examination → findings → differential →
 *   investigations → interpretation → diagnosis → management / synthesis.
 *
 * Supports:
 *   - Incomplete information & blind patient mode
 *   - Dynamic physiological maneuvers (Valsalva, handgrip, squatting, standing, respiration, HJR)
 *   - Physical examination actions (inspect, palpate, percuss, auscultate, pulses, JVP, edema, neuro)
 *   - Differential diagnosis reasoning chain evaluation
 *   - Apple Watch structured pulse profile serialization
 *   - Strict clinical guardrails & deterministic evaluation
 */
(function () {
  "use strict";

  var MANEUVERS = {
    baseline: { id: "baseline", name: "Resting Baseline", description: "Patient at 45 degrees rest" },
    valsalva: { id: "valsalva", name: "Valsalva Strain", description: "Forced expiration against closed glottis; decreases venous return (preload)" },
    squatting: { id: "squatting", name: "Squatting", description: "Increases venous return (preload) and systemic vascular resistance (afterload)" },
    standing: { id: "standing", name: "Sudden Standing", description: "Venous pooling; decreases preload" },
    handgrip: { id: "handgrip", name: "Isometric Handgrip", description: "Sustained muscle contraction; increases systemic vascular resistance (afterload)" },
    inspiration: { id: "inspiration", name: "Deep Inspiration", description: "Decreases intrathoracic pressure; increases right heart venous return (Carvallo's sign)" },
    expiration: { id: "expiration", name: "Full Expiration", description: "Increases left ventricular filling and brings left heart closer to chest wall" },
    hjr: { id: "hjr", name: "Hepatojugular Reflux", description: "Sustained firm right upper quadrant pressure for 15 seconds" }
  };

  function createCaseState(caseData, options) {
    options = options || {};
    var blind = options.blind === true;
    var patient = caseData.patient || {
      age: 68,
      sex: "male",
      chiefComplaint: "Progressive breathlessness and fatigue for 3 months",
      presenting: "A 68-year-old retired clerk presents with increasing exertional dyspnea, orthopnea, and ankle swelling."
    };

    var baseVitals = Object.assign({
      hr: 82,
      bpSystolic: 128,
      bpDiastolic: 80,
      rr: 18,
      spo2: 95,
      temp: 36.8,
      gcs: 15
    }, caseData.initialVitals || {});

    return {
      caseId: caseData.id || "case.default",
      diseaseId: caseData.diseaseId || "",
      blind: blind,
      patient: patient,
      initialVitals: Object.assign({}, baseVitals),
      currentVitals: Object.assign({}, baseVitals),
      activeManeuver: "baseline",
      maneuverHistory: [],
      historyRevealed: {},
      examRevealed: {},
      investigationsOrdered: {},
      differential: [],
      differentialJustification: "",
      finalDiagnosis: "",
      diagnosticReasoning: "",
      reasoningTrace: [],
      penalties: [],
      status: "in_progress", // in_progress | completed
      rawCase: caseData
    };
  }

  /* ── 1. Dynamic Physiological Maneuvers ─────────────────────────────────── */

  function applyManeuver(state, maneuverId) {
    if (!state || !MANEUVERS[maneuverId]) return null;
    state.activeManeuver = maneuverId;
    if (state.maneuverHistory.indexOf(maneuverId) < 0) {
      state.maneuverHistory.push(maneuverId);
    }
    state.reasoningTrace.push({
      type: "maneuver",
      id: maneuverId,
      time: Date.now()
    });

    // Update vitals dynamically based on maneuver physiology
    var v = Object.assign({}, state.initialVitals);
    switch (maneuverId) {
      case "valsalva":
        v.hr = Math.min(150, v.hr + 14);
        v.bpSystolic = Math.max(70, v.bpSystolic - 18);
        v.bpDiastolic = Math.max(50, v.bpDiastolic - 10);
        break;
      case "squatting":
        v.hr = Math.max(45, v.hr - 8);
        v.bpSystolic = Math.min(220, v.bpSystolic + 16);
        v.bpDiastolic = Math.min(130, v.bpDiastolic + 12);
        break;
      case "standing":
        v.hr = Math.min(160, v.hr + 16);
        v.bpSystolic = Math.max(70, v.bpSystolic - 12);
        break;
      case "handgrip":
        v.hr = Math.min(150, v.hr + 10);
        v.bpSystolic = Math.min(220, v.bpSystolic + 22);
        v.bpDiastolic = Math.min(130, v.bpDiastolic + 16);
        break;
      case "inspiration":
        v.rr = Math.max(10, v.rr - 2);
        break;
      case "hjr":
        // JVP changes handled in exam query
        break;
      default:
        break;
    }
    state.currentVitals = v;
    return { maneuver: MANEUVERS[maneuverId], vitals: v };
  }

  function clearManeuvers(state) {
    return applyManeuver(state, "baseline");
  }

  /* ── 2. Physical Examination Actions ────────────────────────────────────── */

  function executeExamAction(state, actionType, targetId) {
    if (!state || !state.rawCase) return { error: "invalid_state" };
    var examKey = actionType + (targetId ? ":" + targetId : "");
    var rawCase = state.rawCase;
    var rawExam = rawCase.exam || {};

    var finding = null;
    var sound = null;
    var visual = null;
    var maneuver = state.activeManeuver || "baseline";

    // 1. Check exact maneuver override in case definition
    var maneuverKey = examKey + "@" + maneuver;
    if (rawExam[maneuverKey]) {
      finding = rawExam[maneuverKey];
    } else if (rawExam[examKey]) {
      finding = rawExam[examKey];
    } else if (rawExam[targetId]) {
      finding = rawExam[targetId];
    }

    // Dynamic physiological maneuver adaptations if not explicitly authored
    if (!finding) {
      finding = generateDefaultFinding(actionType, targetId, rawCase, maneuver);
    } else {
      finding = Object.assign({}, finding);
      finding.finding = adaptFindingToManeuver(finding.finding || "", actionType, targetId, maneuver);
    }

    state.examRevealed[examKey] = finding;
    state.reasoningTrace.push({
      type: "exam",
      actionType: actionType,
      targetId: targetId,
      maneuver: maneuver,
      finding: finding.finding,
      time: Date.now()
    });

    return finding;
  }

  function adaptFindingToManeuver(baseText, actionType, targetId, maneuver) {
    if (maneuver === "baseline" || !maneuver) return baseText;
    if (actionType === "jvp" && maneuver === "hjr") {
      return baseText + " (On sustained abdominojugular compression, JVP rises >3 cm and stays elevated — positive hepatojugular reflux).";
    }
    if (actionType === "auscultate") {
      if (targetId === "mitral" && maneuver === "handgrip") {
        return baseText + " Murmur intensity increases by 1 to 2 grades due to increased afterload.";
      }
      if (targetId === "aortic" && maneuver === "valsalva") {
        return baseText + " Murmur intensity diminishes markedly due to reduced ventricular filling.";
      }
      if (targetId === "tricuspid" && maneuver === "inspiration") {
        return baseText + " Murmur becomes notably louder on deep inspiration (Carvallo's sign).";
      }
      if (targetId === "aortic" && maneuver === "squatting") {
        return baseText + " Murmur intensifies with increased stroke volume.";
      }
    }
    return baseText;
  }

  function generateDefaultFinding(actionType, targetId, rawCase, maneuver) {
    switch (actionType) {
      case "pulse":
        return {
          label: "Radial & Carotid Pulses",
          finding: rawCase.pulseFinding || "Pulse regular, normal volume and character. No radiofemoral delay.",
          rate: rawCase.initialVitals ? rawCase.initialVitals.hr : 72
        };
      case "jvp":
        if (maneuver === "hjr") {
          return {
            label: "Jugular Venous Pressure (HJR)",
            finding: (rawCase.jvpFinding || "JVP elevated 4 cm above sternal angle at 45 degrees.") +
              " On sustained RUQ pressure, JVP rises further by 4 cm and remains sustained (positive HJR).",
            heightCm: 8,
            waveMode: rawCase.jvpWaveMode || "normal"
          };
        }
        return {
          label: "Jugular Venous Pressure",
          finding: rawCase.jvpFinding || "JVP not visibly elevated, waveform normal.",
          heightCm: rawCase.jvpHeight || 2,
          waveMode: rawCase.jvpWaveMode || "normal"
        };
      case "edema":
        return {
          label: "Peripheral Edema",
          finding: rawCase.edemaFinding || "No pedal or sacral edema."
        };
      case "neuro":
        return {
          label: "Neurological Examination",
          finding: rawCase.neuroFinding || "Cranial nerves II-XII grossly intact. Motor power 5/5 throughout. Reflexes symmetrical 2+."
        };
      case "percuss":
        return {
          label: "Chest Percussion",
          finding: "Resonant note throughout all lung zones symmetrically."
        };
      case "palpate":
        return {
          label: "Palpation",
          finding: "Apex beat located in the 5th intercostal space, midclavicular line. No parasternal heave or palpable thrills."
        };
      case "inspect":
        return {
          label: "General Inspection",
          finding: "Patient alert, comfortable at rest, no visible cyanosis, clubbing, jaundice, or peripheral stigmata."
        };
      default:
        return {
          label: targetId || actionType,
          finding: "Normal examination finding without evident focal pathology."
        };
    }
  }

  /* ── 3. History Inquiry ─────────────────────────────────────────────────── */

  function askHistory(state, questionText) {
    if (!state || !state.rawCase) return { error: "invalid_state" };
    var rawHistory = state.rawCase.history || {};
    var q = String(questionText || "").toLowerCase().trim();

    var bestHit = null;
    var bestLen = 0;

    for (var key in rawHistory) {
      var item = rawHistory[key];
      var cues = item.cues || [];
      for (var i = 0; i < cues.length; i++) {
        var cue = cues[i].toLowerCase();
        var re = new RegExp("(^|[^a-z0-9])" + cue + "([^a-z0-9]|$)", "i");
        if (re.test(q)) {
          if (cue.length > bestLen) {
            bestLen = cue.length;
            bestHit = { key: key, item: item };
          }
        }
      }
    }

    if (bestHit) {
      state.historyRevealed[bestHit.key] = bestHit.item.reply;
      state.reasoningTrace.push({
        type: "history",
        key: bestHit.key,
        question: questionText,
        reply: bestHit.item.reply,
        time: Date.now()
      });
      return { key: bestHit.key, reply: bestHit.item.reply, recognized: true };
    }

    var fallback = (state.rawCase.unmatchedReply) ||
      "I am not sure about that, doctor. Could you ask me in a different way?";
    state.reasoningTrace.push({
      type: "history_unmatched",
      question: questionText,
      reply: fallback,
      time: Date.now()
    });
    return { key: null, reply: fallback, recognized: false };
  }

  /* ── 4. Investigations ──────────────────────────────────────────────────── */

  function orderInvestigation(state, ixId) {
    if (!state || !state.rawCase) return { error: "invalid_state" };
    var rawIx = state.rawCase.investigations || {};
    var entry = rawIx[ixId];

    if (!entry) {
      var genericResult = {
        title: ixId,
        indicated: false,
        result: "Normal test result within physiological reference ranges.",
        note: "This investigation was not clinically indicated for the presenting syndrome."
      };
      state.investigationsOrdered[ixId] = genericResult;
      state.penalties.push({
        type: "unnecessary_test",
        id: ixId,
        description: "Investigation " + ixId + " ordered without clinical justification"
      });
      return genericResult;
    }

    state.investigationsOrdered[ixId] = entry;
    if (!entry.indicated) {
      state.penalties.push({
        type: "unnecessary_test",
        id: ixId,
        description: entry.note || "Investigation ordered was not indicated"
      });
    }

    state.reasoningTrace.push({
      type: "investigation",
      id: ixId,
      indicated: entry.indicated,
      result: entry.result,
      time: Date.now()
    });

    return entry;
  }

  /* ── 5. Differential & Reasoning Evaluation ──────────────────────────────── */

  function submitDifferential(state, diffArray, justification) {
    if (!state) return null;
    state.differential = Array.isArray(diffArray) ? diffArray : [diffArray];
    state.differentialJustification = justification || "";
    state.reasoningTrace.push({
      type: "differential_submitted",
      differential: state.differential,
      justification: state.differentialJustification,
      time: Date.now()
    });
    return evaluateReasoningChain(state);
  }

  function submitDiagnosis(state, diagnosis, reasoning) {
    if (!state) return null;
    state.finalDiagnosis = String(diagnosis || "").trim();
    state.diagnosticReasoning = String(reasoning || "").trim();
    state.status = "completed";
    state.reasoningTrace.push({
      type: "diagnosis_submitted",
      diagnosis: state.finalDiagnosis,
      reasoning: state.diagnosticReasoning,
      time: Date.now()
    });
    return generateSynthesis(state);
  }

  function evaluateReasoningChain(state) {
    if (!state || !state.rawCase) return { score: 0, feedback: [] };
    var rawCase = state.rawCase;
    var essentialIx = rawCase.essentialInvestigations || [];
    var expectedDiff = rawCase.expectedDifferential || [];
    var correctDiagnosis = rawCase.correctDiagnosis || rawCase.diagnosis || "";

    var feedback = [];
    var score = 100;

    // Check history coverage
    var rawHist = rawCase.history || {};
    var keyHist = Object.keys(rawHist).filter(function (k) { return rawHist[k].key; });
    var askedKey = keyHist.filter(function (k) { return !!state.historyRevealed[k]; });
    var missedKeyHist = keyHist.filter(function (k) { return !state.historyRevealed[k]; });

    if (missedKeyHist.length > 2) {
      score -= Math.min(25, missedKeyHist.length * 5);
      feedback.push("Missed " + missedKeyHist.length + " critical history items: " + missedKeyHist.slice(0, 3).join(", "));
    }

    // Check key physical exams
    var rawExam = rawCase.exam || {};
    var essentialExam = Object.keys(rawExam).filter(function (k) { return rawExam[k].essential; });
    var missedExam = essentialExam.filter(function (k) { return !state.examRevealed[k]; });

    if (missedExam.length > 0) {
      score -= Math.min(25, missedExam.length * 8);
      feedback.push("Essential examination omitted: " + missedExam.join(", "));
    }

    // Check unnecessary tests ordered
    var unindicated = Object.keys(state.investigationsOrdered).filter(function (id) {
      return !state.investigationsOrdered[id].indicated;
    });
    if (unindicated.length > 0) {
      score -= Math.min(20, unindicated.length * 6);
      feedback.push("Unnecessary investigations ordered: " + unindicated.join(", "));
    }

    // Check essential investigations ordered
    var orderedEssential = essentialIx.filter(function (id) { return !!state.investigationsOrdered[id]; });
    var missedEssentialIx = essentialIx.filter(function (id) { return !state.investigationsOrdered[id]; });
    if (missedEssentialIx.length > 0) {
      score -= Math.min(30, missedEssentialIx.length * 10);
      feedback.push("Diagnostic investigations omitted: " + missedEssentialIx.join(", "));
    }

    score = Math.max(0, Math.min(100, score));

    return {
      score: score,
      feedback: feedback,
      askedHistoryCount: Object.keys(state.historyRevealed).length,
      missedKeyHistory: missedKeyHist,
      revealedExamCount: Object.keys(state.examRevealed).length,
      missedEssentialExam: missedExam,
      orderedInvestigationsCount: Object.keys(state.investigationsOrdered).length,
      unnecessaryInvestigations: unindicated,
      missedEssentialInvestigations: missedEssentialIx
    };
  }

  function generateSynthesis(state) {
    var evalResult = evaluateReasoningChain(state);
    var rawCase = state.rawCase || {};
    var targetDx = (rawCase.correctDiagnosis || rawCase.diagnosis || "").toLowerCase();
    var givenDx = (state.finalDiagnosis || "").toLowerCase();

    var isCorrect = false;
    if (targetDx && givenDx) {
      // Check keyword overlap
      var words = targetDx.split(/[^a-z0-9]+/i).filter(function (w) { return w.length > 3; });
      var matchCount = 0;
      for (var i = 0; i < words.length; i++) {
        if (givenDx.indexOf(words[i]) >= 0) matchCount++;
      }
      isCorrect = (matchCount / Math.max(1, words.length)) >= 0.6 || givenDx.indexOf(targetDx) >= 0;
    }

    var synthesis = {
      isCorrect: isCorrect,
      correctDiagnosis: rawCase.correctDiagnosis || rawCase.diagnosis || "",
      givenDiagnosis: state.finalDiagnosis,
      score: Math.round(isCorrect ? evalResult.score : Math.min(45, evalResult.score)),
      positiveFindings: rawCase.positiveFindings || [],
      negativeFindings: rawCase.importantNegatives || [],
      missedExamSteps: evalResult.missedEssentialExam,
      unnecessaryActions: evalResult.unnecessaryInvestigations,
      reasoningFeedback: evalResult.feedback,
      suggestedNextSteps: rawCase.suggestedNextSteps || [
        "Initiate guideline-directed medical therapy",
        "Perform echocardiography or repeat chest imaging",
        "Arrange outpatient cardiology/pulmonology follow-up"
      ],
      verdict: isCorrect
        ? (evalResult.score >= 80 ? "excellent" : "pass_with_gaps")
        : "incorrect_diagnosis"
    };

    return synthesis;
  }

  /* ── 6. Apple Watch Structured Pulse Schema ─────────────────────────────── */

  function getPulseProfile(state) {
    var vitals = (state && state.currentVitals) || { hr: 72, bpSystolic: 120 };
    var rawCase = (state && state.rawCase) || {};
    var hr = vitals.hr || 72;

    var rhythm = "regular";
    var regularity = "regular";
    var amplitude = 1.0;
    var riseTime = 0.08;
    var decayTime = 0.22;
    var condition = "normal";

    if (rawCase.arrhythmia === "afib" || (rawCase.pulseCharacter || "").indexOf("irregularly irregular") >= 0) {
      rhythm = "atrial_fibrillation";
      regularity = "irregularly_irregular";
      amplitude = 0.85;
      condition = "afib";
    } else if (rawCase.pulseCharacter === "water_hammer" || (rawCase.valveLesion || "").indexOf("aortic_regurgitation") >= 0) {
      amplitude = 1.6;
      riseTime = 0.04;
      decayTime = 0.12;
      condition = "water_hammer";
    } else if (rawCase.pulseCharacter === "parvus_et_tardus" || (rawCase.valveLesion || "").indexOf("aortic_stenosis") >= 0) {
      amplitude = 0.65;
      riseTime = 0.16;
      decayTime = 0.28;
      condition = "parvus_et_tardus";
    } else if (hr >= 100) {
      condition = "tachycardia";
    } else if (hr <= 50) {
      condition = "bradycardia";
    }

    return {
      bpm: hr,
      rhythm: rhythm,
      regularity: regularity,
      amplitude: amplitude,
      riseTime: riseTime,
      decayTime: decayTime,
      s1Timing: 0.0,
      condition: condition,
      disclaimer: "Simulated educational haptics for clinical training; not for diagnostic or medical use."
    };
  }

  var API = {
    MANEUVERS: MANEUVERS,
    createCaseState: createCaseState,
    applyManeuver: applyManeuver,
    clearManeuvers: clearManeuvers,
    executeExamAction: executeExamAction,
    askHistory: askHistory,
    orderInvestigation: orderInvestigation,
    submitDifferential: submitDifferential,
    submitDiagnosis: submitDiagnosis,
    evaluateReasoningChain: evaluateReasoningChain,
    generateSynthesis: generateSynthesis,
    getPulseProfile: getPulseProfile
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_ENGINE = API;
})();
