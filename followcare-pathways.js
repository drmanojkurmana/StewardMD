/* FollowCare AI — Disease Recovery Pathways (DATA)
 *
 * Versioned, doctor-editable recovery-follow-up templates. Red-flag + escalation rules are DATA, so the
 * deterministic RecoveryEngine stays generic. Thresholds hardened after adversarial clinical review;
 * ALL thresholds require final clinician sign-off before production (docs/followcare/phase0).
 * window.FollowCarePathways + module.exports. No network, no PHI.
 *
 * question: { id, text, i18nKey, type(overall|scale|yesno|number|choice), options?, unit?, weight?,
 *             redFlag?:{when,level,reason} | redFlags?:[...], soft?(when-expr for graded deterioration),
 *             worseDir?('down'|'up'), worseDelta?, max?(scale upper bound, default 3), plausible?:[min,max] }
 * pathway.blockGreenIfMissing:[qId]  — critical vitals whose absence must block a Green. NOTE: the engine
 *   ALSO auto-blocks Green whenever ANY red-tier question is unanswered (C1 fix), so this list is now only
 *   for extra must-have vitals beyond the red-flag set.
 * pathway.missedEscalateAt:N  — # of missed check-ins that escalates to a clinician Orange (default 3;
 *   high-acuity pathways set 1–2). when ops: 'worse' | '>=N' | '<=N' | '==V' | 'yes' | 'no' | 'in:[a,b]'
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  // Global hard red flags — apply to EVERY pathway (any one → Red).
  var GLOBAL_RED = [
    { id: "g_chestpain", text: "New chest pain?", i18nKey: "fc.q.chestpain", type: "yesno", redFlag: { when: "yes", level: "red", reason: "Chest pain" } },
    { id: "g_breathless_rest", text: "Severe breathlessness at rest?", i18nKey: "fc.q.breathrest", type: "yesno", redFlag: { when: "yes", level: "red", reason: "Severe breathlessness at rest" } },
    { id: "g_syncope", text: "Fainting or collapse?", i18nKey: "fc.q.syncope", type: "yesno", redFlag: { when: "yes", level: "red", reason: "Syncope/collapse" } },
    { id: "g_confusion", text: "New confusion?", i18nKey: "fc.q.confusion", type: "yesno", redFlag: { when: "yes", level: "red", reason: "New confusion" } },
    { id: "g_bleeding", text: "Severe bleeding?", i18nKey: "fc.q.bleeding", type: "yesno", redFlag: { when: "yes", level: "red", reason: "Severe bleeding" } },
    { id: "g_seizure", text: "Any seizure/fit?", i18nKey: "fc.q.seizure", type: "yesno", redFlag: { when: "yes", level: "red", reason: "Seizure" } },
    { id: "g_stroke_fast", text: "New face droop, arm weakness, or speech difficulty?", i18nKey: "fc.q.fast", type: "yesno", redFlag: { when: "yes", level: "red", reason: "Stroke signs (FAST)" } },
    { id: "g_anaphylaxis", text: "Sudden rash, swelling, or trouble breathing (allergic reaction)?", i18nKey: "fc.q.anaphylaxis", type: "yesno", redFlag: { when: "yes", level: "red", reason: "Possible severe allergic reaction" } },
    { id: "g_selfharm", text: "Any thoughts of harming yourself?", i18nKey: "fc.q.selfharm", type: "yesno", redFlag: { when: "yes", level: "red", reason: "Thoughts of self-harm" } }
  ];

  var overall = { id: "overall", text: "Overall, how are you today?", i18nKey: "fc.q.overall", type: "overall", weight: 25 };
  var adherence = { id: "meds_taken", text: "Did you take today's medicines?", i18nKey: "fc.q.meds", type: "choice", options: ["taken", "skipped", "unavailable"], weight: 15, redFlag: { when: "in:[skipped,unavailable]", level: "orange", reason: "Medication not taken" } };

  var PATHWAYS = {
    pneumonia: {
      id: "pneumonia", name: "Pneumonia", specialty: "Respiratory", version: 1, followUpDays: 14, schedule: [1, 3, 5, 7, 10, 14],
      questions: [
        overall,
        { id: "fever", text: "Fever today?", i18nKey: "fc.q.fever", type: "yesno", weight: 8, soft: "yes" },
        { id: "fever_days", text: "How many days of fever?", i18nKey: "fc.q.feverdays", type: "number", unit: "days", weight: 10, redFlag: { when: ">=4", level: "orange", reason: "Persistent fever ≥4 days" } },
        { id: "cough", text: "Cough compared to yesterday (0 better – 3 worse)?", i18nKey: "fc.q.cough", type: "scale", weight: 8 },
        { id: "breathless", text: "Breathlessness (0 none – 3 severe)?", i18nKey: "fc.q.breathless", type: "scale", weight: 18, redFlag: { when: ">=3", level: "red", reason: "Severe breathlessness" } },
        { id: "spo2", text: "Oxygen level if you have a meter", i18nKey: "fc.q.spo2", type: "number", unit: "%", weight: 20, plausible: [40, 100], redFlag: { when: "<=91", level: "red", reason: "Low SpO₂" }, worseDir: "down", worseDelta: 3 },
        adherence
      ],
      completion: { needAfebrile: true, needImproving: true, minScore: 80, byDay: 14 }, recoveryInputs: ["fever", "breathless", "spo2", "meds_taken"], blockGreenIfMissing: ["spo2"]
    },
    heart_failure: {
      id: "heart_failure", name: "Heart Failure", specialty: "Cardiology", version: 1, followUpDays: 30, schedule: [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30], missedEscalateAt: 2,
      questions: [
        overall,
        { id: "weight_delta", text: "Weight CHANGE vs 3 days ago (kg, e.g. 2 for +2 kg)", i18nKey: "fc.q.weight", type: "number", unit: "kg change", weight: 22, plausible: [-15, 15], redFlags: [{ when: ">=3", level: "red", reason: "Rapid weight gain ≥3 kg" }, { when: ">=2", level: "orange", reason: "Weight gain ≥2 kg / 3 days" }] },
        { id: "orthopnea", text: "Pillows needed to breathe at night (0-3)", i18nKey: "fc.q.orthopnea", type: "scale", weight: 15, redFlag: { when: ">=3", level: "orange", reason: "Worsening orthopnea" } },
        { id: "edema", text: "Leg swelling (0 none – 3 severe)", i18nKey: "fc.q.edema", type: "scale", weight: 15, redFlag: { when: ">=3", level: "orange", reason: "Worsening peripheral edema (fluid overload)" } },
        { id: "breathless", text: "Breathlessness (0-3)", i18nKey: "fc.q.breathless", type: "scale", weight: 18, redFlag: { when: ">=3", level: "red", reason: "Severe breathlessness" } },
        adherence
      ],
      completion: { needImproving: true, minScore: 80, byDay: 30 }, recoveryInputs: ["weight_delta", "orthopnea", "breathless", "meds_taken"]
    },
    copd: {
      id: "copd", name: "COPD", specialty: "Respiratory", version: 1, followUpDays: 14, schedule: [1, 3, 5, 7, 10, 14],
      questions: [
        overall,
        { id: "breathless", text: "Breathlessness vs baseline (0-3)", i18nKey: "fc.q.breathless", type: "scale", weight: 18, redFlag: { when: ">=3", level: "red", reason: "Severe breathlessness" } },
        { id: "sputum", text: "Sputum colour", i18nKey: "fc.q.sputum", type: "choice", options: ["clear", "yellow", "green"], weight: 12, redFlag: { when: "==green", level: "orange", reason: "Purulent sputum" } },
        { id: "fever", text: "Fever today?", i18nKey: "fc.q.fever", type: "yesno", weight: 8, soft: "yes" },
        { id: "spo2", text: "Oxygen level if measured", i18nKey: "fc.q.spo2", type: "number", unit: "%", weight: 20, plausible: [40, 100], redFlags: [{ when: "<=88", level: "red", reason: "Low SpO₂ (COPD)" }, { when: "<=91", level: "orange", reason: "Falling SpO₂" }], worseDir: "down", worseDelta: 3 },
        { id: "inhaler", text: "Inhalers used as prescribed?", i18nKey: "fc.q.inhaler", type: "yesno", weight: 12, redFlag: { when: "no", level: "orange", reason: "Inhaler non-adherence" } }
      ],
      completion: { needImproving: true, minScore: 80, byDay: 14 }, recoveryInputs: ["breathless", "sputum", "spo2", "inhaler"], blockGreenIfMissing: ["spo2"]
    },
    dengue: {
      id: "dengue", name: "Dengue (convalescence)", specialty: "Infectious disease", version: 1, followUpDays: 7, schedule: [1, 2, 3, 4, 5, 7], missedEscalateAt: 1,
      questions: [
        overall,
        { id: "warning_bleed", text: "Any bleeding (gums, nose, skin, stool)?", i18nKey: "fc.q.dbleed", type: "yesno", weight: 20, redFlag: { when: "yes", level: "red", reason: "Dengue warning sign: bleeding" } },
        { id: "warning_abdo", text: "Severe abdominal pain?", i18nKey: "fc.q.dabdo", type: "yesno", weight: 18, redFlag: { when: "yes", level: "red", reason: "Dengue warning sign: abdominal pain" } },
        { id: "warning_vomit", text: "Persistent vomiting?", i18nKey: "fc.q.dvomit", type: "yesno", weight: 18, redFlag: { when: "yes", level: "red", reason: "Dengue warning sign: persistent vomiting" } },
        { id: "warning_lethargy", text: "Unusual drowsiness, restlessness, or lethargy?", i18nKey: "fc.q.dlethargy", type: "yesno", weight: 18, redFlag: { when: "yes", level: "red", reason: "Dengue warning sign: lethargy/restlessness" } },
        { id: "fever", text: "Fever today?", i18nKey: "fc.q.fever", type: "yesno", weight: 8, soft: "yes" },
        { id: "hydration", text: "Able to drink fluids?", i18nKey: "fc.q.hydration", type: "yesno", weight: 12, redFlag: { when: "no", level: "orange", reason: "Poor oral intake" } }
      ],
      completion: { needAfebrile: true, minScore: 85, byDay: 7 }, recoveryInputs: ["warning_bleed", "warning_abdo", "warning_vomit", "warning_lethargy", "hydration"]
    },
    post_op: {
      id: "post_op", name: "Post-operative", specialty: "Surgery", version: 1, followUpDays: 21, schedule: [1, 3, 5, 7, 14, 21],
      questions: [
        overall,
        { id: "wound", text: "Wound: how does it look?", i18nKey: "fc.q.wound", type: "choice", options: ["healing", "redness", "discharge", "opening"], weight: 22, redFlags: [{ when: "in:[opening]", level: "red", reason: "Wound dehiscence" }, { when: "in:[discharge]", level: "orange", reason: "Possible wound infection" }, { when: "==redness", level: "orange", reason: "Wound redness / early infection" }] },
        { id: "fever", text: "Fever today?", i18nKey: "fc.q.fever", type: "yesno", weight: 12, redFlag: { when: "yes", level: "orange", reason: "Post-op fever" } },
        { id: "pain", text: "Pain (0-10)", i18nKey: "fc.q.pain", type: "number", weight: 15, redFlag: { when: ">=8", level: "orange", reason: "Severe pain" } },
        { id: "mobility", text: "Able to move as expected?", i18nKey: "fc.q.mobility", type: "yesno", weight: 10, soft: "no" },
        adherence
      ],
      completion: { needAfebrile: true, needImproving: true, minScore: 80, byDay: 21 }, recoveryInputs: ["wound", "fever", "pain", "mobility"]
    },
    aki: {
      id: "aki", name: "Acute Kidney Injury", specialty: "Nephrology", version: 1, followUpDays: 30, schedule: [2, 5, 9, 14, 21, 30], missedEscalateAt: 2,
      questions: [
        overall,
        { id: "urine", text: "Urine output vs normal?", i18nKey: "fc.q.urine", type: "choice", options: ["normal", "reduced", "none"], weight: 22, redFlags: [{ when: "==none", level: "red", reason: "Anuria (no urine)" }, { when: "==reduced", level: "orange", reason: "Reduced urine output" }] },
        { id: "swelling", text: "New swelling (legs/face)?", i18nKey: "fc.q.swelling", type: "yesno", weight: 12, soft: "yes" },
        { id: "breathless", text: "Breathlessness (0-3)", i18nKey: "fc.q.breathless", type: "scale", weight: 18, redFlag: { when: ">=3", level: "red", reason: "Severe breathlessness" } },
        { id: "nausea", text: "Nausea/vomiting?", i18nKey: "fc.q.nausea", type: "yesno", weight: 8, soft: "yes" },
        adherence
      ],
      completion: { needImproving: true, minScore: 80, byDay: 30 }, recoveryInputs: ["urine", "breathless", "meds_taken"], blockGreenIfMissing: ["urine"]
    },
    stroke: {
      id: "stroke", name: "Stroke", specialty: "Neurology", version: 1, followUpDays: 90, schedule: [2, 5, 12, 19, 26, 40, 60, 90],
      questions: [
        overall,
        { id: "new_deficit", text: "New weakness, numbness, or facial droop?", i18nKey: "fc.q.deficit", type: "yesno", weight: 25, redFlag: { when: "yes", level: "red", reason: "New focal deficit (FAST)" } },
        { id: "speech", text: "New speech difficulty?", i18nKey: "fc.q.speech", type: "yesno", weight: 20, redFlag: { when: "yes", level: "red", reason: "New speech change" } },
        { id: "headache", text: "New severe or sudden headache?", i18nKey: "fc.q.headache", type: "yesno", weight: 18, redFlag: { when: "yes", level: "red", reason: "New severe/sudden headache" } },
        { id: "fall_injury", text: "A fall with head injury or unable to get up?", i18nKey: "fc.q.fallinj", type: "yesno", weight: 15, redFlag: { when: "yes", level: "red", reason: "Fall with injury" } },
        { id: "falls", text: "Any other fall since last check?", i18nKey: "fc.q.falls", type: "yesno", weight: 10, redFlag: { when: "yes", level: "orange", reason: "Fall (injury risk)" } },
        { id: "mobility", text: "Mobility vs last week (0 better – 3 worse)", i18nKey: "fc.q.mobility2", type: "scale", weight: 8 },
        adherence
      ],
      completion: { needImproving: true, minScore: 80, byDay: 90 }, recoveryInputs: ["new_deficit", "speech", "falls", "meds_taken"]
    },
    diabetes: {
      id: "diabetes", name: "Diabetes", specialty: "Endocrinology", version: 1, followUpDays: 30, schedule: [2, 5, 12, 19, 26, 30],
      questions: [
        overall,
        { id: "hypo_severe", text: "Any low-sugar episode with confusion or collapse?", i18nKey: "fc.q.hyposev", type: "yesno", weight: 24, redFlag: { when: "yes", level: "red", reason: "Severe hypoglycaemia (confusion/collapse)" } },
        { id: "hypo", text: "Any low-sugar symptoms (sweating, shakiness)?", i18nKey: "fc.q.hypo", type: "yesno", weight: 15, redFlag: { when: "yes", level: "orange", reason: "Possible hypoglycaemia" } },
        { id: "hyper", text: "Very high sugar symptoms (thirst, urination, drowsy)?", i18nKey: "fc.q.hyper", type: "yesno", weight: 15, redFlag: { when: "yes", level: "orange", reason: "Possible severe hyperglycaemia" } },
        { id: "glucose", text: "Latest glucose reading if available", i18nKey: "fc.q.glucose", type: "number", unit: "mg/dL", weight: 15, plausible: [20, 900], redFlags: [{ when: "<=54", level: "red", reason: "Severe hypoglycaemia (<54 mg/dL)" }, { when: "<=70", level: "orange", reason: "Hypoglycaemia (<70 mg/dL)" }, { when: ">=400", level: "red", reason: "Severe hyperglycaemia" }, { when: ">=300", level: "orange", reason: "High glucose" }] },
        adherence
      ],
      completion: { needImproving: true, minScore: 80, byDay: 30 }, recoveryInputs: ["hypo_severe", "hypo", "hyper", "glucose", "meds_taken"]
    },
    hypertension: {
      id: "hypertension", name: "Hypertension", specialty: "Cardiology", version: 1, followUpDays: 30, schedule: [3, 10, 17, 24, 30],
      questions: [
        overall,
        { id: "crisis", text: "Severe headache, chest pain, or vision change?", i18nKey: "fc.q.htncrisis", type: "yesno", weight: 25, redFlag: { when: "yes", level: "red", reason: "Possible hypertensive emergency" } },
        { id: "sbp", text: "Top BP number if measured", i18nKey: "fc.q.sbp", type: "number", unit: "mmHg", weight: 15, plausible: [60, 300], redFlags: [{ when: ">=220", level: "red", reason: "Severe hypertension" }, { when: ">=180", level: "orange", reason: "Very high blood pressure" }, { when: "<=90", level: "orange", reason: "Low blood pressure" }] },
        { id: "dbp", text: "Bottom BP number if measured", i18nKey: "fc.q.dbp", type: "number", unit: "mmHg", weight: 12, plausible: [30, 200], redFlags: [{ when: ">=120", level: "red", reason: "Severe diastolic hypertension" }, { when: ">=110", level: "orange", reason: "High diastolic BP" }] },
        { id: "side_effects", text: "New medicine side effects?", i18nKey: "fc.q.sideeffects", type: "yesno", weight: 8, soft: "yes" },
        adherence
      ],
      completion: { needImproving: true, minScore: 80, byDay: 30 }, recoveryInputs: ["crisis", "sbp", "meds_taken"]
    }
  };

  function get(id) { return PATHWAYS[id] || null; }
  function list() { return Object.keys(PATHWAYS).map(function (k) { return { id: k, name: PATHWAYS[k].name, specialty: PATHWAYS[k].specialty, followUpDays: PATHWAYS[k].followUpDays }; }); }
  function questionsFor(id) { var p = get(id); if (!p) return []; return p.questions.concat(GLOBAL_RED); }

  var API = { get: get, list: list, questionsFor: questionsFor, GLOBAL_RED: GLOBAL_RED, _all: PATHWAYS, _version: 2 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCarePathways = API;
})();
