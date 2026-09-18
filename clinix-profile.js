/* clinix-profile.js — CliniX · Mistake Memory, Adaptive Difficulty & Clinical Coach
 *
 * Tracks individual clinical skill mastery rather than mere lesson completion.
 * Records mistake patterns across examination, reasoning, investigations, and viva.
 * Prescribes targeted remediation micro-sessions and calculates adaptive difficulty.
 */
(function () {
  "use strict";

  var ERROR_CATEGORIES = {
    missedJVP: "Missed JVP Assessment",
    incorrectMurmur: "Murmur Characterisation Error",
    poorNeuroSequence: "Unsystematic Neurological Sequence",
    missedRedFlags: "Omitted Red Flag Safety Assessment",
    incorrectDifferential: "Flawed Differential Diagnosis Formulation",
    investigationMisuse: "Indiscriminate / Non-indicated Investigations",
    safetyOmissions: "Patient Safety / Infection Control Omission",
    repeatedVivaMistakes: "Viva Knowledge Gaps Under Challenge"
  };

  function createSkillProfile(existingData) {
    var p = existingData || {};
    return {
      version: 1,
      skills: p.skills || {},
      errorTaxonomy: Object.assign({
        missedJVP: 0,
        incorrectMurmur: 0,
        poorNeuroSequence: 0,
        missedRedFlags: 0,
        incorrectDifferential: 0,
        investigationMisuse: 0,
        safetyOmissions: 0,
        repeatedVivaMistakes: 0
      }, p.errorTaxonomy || {}),
      encounters: p.encounters || [],
      adaptiveLevel: p.adaptiveLevel || 1, // 1 to 5
      lastUpdated: p.lastUpdated || Date.now()
    };
  }

  function recordEncounter(profile, encounter) {
    if (!profile || !encounter) return profile;
    profile.encounters.push({
      caseId: encounter.caseId,
      score: encounter.score,
      verdict: encounter.verdict,
      timestamp: Date.now()
    });

    // Record error taxonomy updates
    var errors = encounter.errors || [];
    for (var i = 0; i < errors.length; i++) {
      var errCat = errors[i].category;
      if (profile.errorTaxonomy[errCat] != null) {
        profile.errorTaxonomy[errCat]++;
      }
    }

    // Update individual skill stats
    var testedSkills = encounter.testedSkills || {};
    for (var skillId in testedSkills) {
      var item = testedSkills[skillId];
      if (!profile.skills[skillId]) {
        profile.skills[skillId] = { attempts: 0, correct: 0, score: 0, lastSeen: 0 };
      }
      var s = profile.skills[skillId];
      s.attempts++;
      if (item.success) s.correct++;
      s.lastSeen = Date.now();
      s.score = Math.round((s.correct / s.attempts) * 100);
    }

    profile.adaptiveLevel = calculateAdaptiveDifficulty(profile);
    profile.lastUpdated = Date.now();
    return profile;
  }

  function detectWeaknesses(profile) {
    if (!profile) return [];
    var weaknesses = [];

    // Check error taxonomy frequencies
    for (var cat in profile.errorTaxonomy) {
      var count = profile.errorTaxonomy[cat];
      if (count >= 2) {
        weaknesses.push({
          category: cat,
          label: ERROR_CATEGORIES[cat] || cat,
          frequency: count,
          severity: count >= 4 ? "high" : "moderate"
        });
      }
    }

    // Check lowest scoring skills with at least 2 attempts
    for (var sId in profile.skills) {
      var s = profile.skills[sId];
      if (s.attempts >= 2 && s.score < 60) {
        weaknesses.push({
          skillId: sId,
          label: "Low Mastery in " + sId,
          score: s.score,
          attempts: s.attempts,
          severity: s.score < 40 ? "high" : "moderate"
        });
      }
    }

    // Sort highest severity/frequency first
    weaknesses.sort(function (a, b) {
      var scoreA = (a.frequency || 0) * 10 + (100 - (a.score || 50));
      var scoreB = (b.frequency || 0) * 10 + (100 - (b.score || 50));
      return scoreB - scoreA;
    });

    return weaknesses;
  }

  function generatePracticePlan(profile) {
    var weaknesses = detectWeaknesses(profile);
    if (!weaknesses.length) {
      return {
        status: "proficient",
        recommendedDifficulty: profile ? profile.adaptiveLevel : 3,
        plan: [
          { type: "case", title: "Comprehensive Multi-system Bedside Challenge", durationMins: 15 }
        ]
      };
    }

    var topWeakness = weaknesses[0];
    var plan = [];

    if (topWeakness.category === "missedJVP") {
      plan.push({
        step: 1,
        type: "micro_session",
        title: "5-minute JVP Masterclass: Angle, Lighting, Waveforms & Abdominojugular Reflux",
        focus: "skill.exam.cv.jvp",
        durationMins: 5
      });
      plan.push({
        step: 2,
        type: "osce_station",
        title: "Targeted JVP Measurement & Waveform Identification OSCE",
        stationId: "station.jvp.rapid",
        durationMins: 7
      });
      plan.push({
        step: 3,
        type: "reasoning_case",
        title: "Clinical Reasoning Case: Acute Breathlessness with Elevated Venous Pressure",
        caseId: "case.heart_failure_decompensated",
        durationMins: 12
      });
    } else if (topWeakness.category === "incorrectMurmur") {
      plan.push({
        step: 1,
        type: "micro_session",
        title: "Systolic vs Diastolic Murmurs & Dynamic Physiological Maneuver Drill",
        focus: "skill.exam.cv.auscultation",
        durationMins: 5
      });
      plan.push({
        step: 2,
        type: "osce_station",
        title: "Precordial Auscultation & Radiation OSCE",
        stationId: "station.murmur.identification",
        durationMins: 7
      });
      plan.push({
        step: 3,
        type: "reasoning_case",
        title: "Clinical Reasoning Case: Syncope on Exertion (Valvular Heart Disease)",
        caseId: "case.aortic_stenosis_severe",
        durationMins: 12
      });
    } else {
      plan.push({
        step: 1,
        type: "micro_session",
        title: "Focused Review: " + topWeakness.label,
        focus: topWeakness.skillId || topWeakness.category,
        durationMins: 5
      });
      plan.push({
        step: 2,
        type: "osce_station",
        title: "Competency Verification Station",
        durationMins: 7
      });
      plan.push({
        step: 3,
        type: "reasoning_case",
        title: "Diagnostic Reasoning Encounter",
        durationMins: 12
      });
    }

    return {
      topWeakness: topWeakness,
      recommendedDifficulty: profile ? profile.adaptiveLevel : 1,
      prescription: plan
    };
  }

  function calculateAdaptiveDifficulty(profile) {
    if (!profile || !profile.encounters || !profile.encounters.length) return 1;
    var encs = profile.encounters.slice(-6); // look at last 6 encounters
    var totalScore = 0;
    var passes = 0;

    for (var i = 0; i < encs.length; i++) {
      totalScore += (encs[i].score || 0);
      if ((encs[i].score || 0) >= 75) passes++;
    }

    var avgScore = totalScore / encs.length;

    if (encs.length >= 4 && avgScore >= 88 && passes >= 4) {
      return 5; // Unpredictable viva + complex multi-morbidity case
    } else if (encs.length >= 3 && avgScore >= 78) {
      return 4; // Timed OSCE
    } else if (encs.length >= 2 && avgScore >= 68) {
      return 3; // Blind patient mode
    } else if (avgScore >= 50) {
      return 2; // Semi-guided examination
    }
    return 1; // Guided learning
  }

  var API = {
    ERROR_CATEGORIES: ERROR_CATEGORIES,
    createSkillProfile: createSkillProfile,
    recordEncounter: recordEncounter,
    detectWeaknesses: detectWeaknesses,
    generatePracticePlan: generatePracticePlan,
    calculateAdaptiveDifficulty: calculateAdaptiveDifficulty
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_PROFILE = API;
})();
