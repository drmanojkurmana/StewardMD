/* Kardia Teach pack: five 30 minute bedside session plans, one per unit.
   ES5 IIFE. Content status ai_drafted: every objective and description below
   is draft teaching content, shown with the draft note on the screen until
   the owner reviews it. Never mark anything here as reviewed.
   Links are {kind, id} pairs; kardia.js resolves titles and opens them, so
   this file holds no DOM ids and no host state. */
(function (G) {
  "use strict";
  var UNITS = [
    {
      id: "views",
      name: { en: "First views", hi: "First views" },
      time: { en: "30 minutes at the bedside", hi: "30 minutes at the bedside" },
      blurb: {
        en: "Find the three basic windows and name what each shows. One probe, one student, one view at a time.",
        hi: "Find the three basic windows and name what each shows. One probe, one student, one view at a time."
      },
      objectives: [
        { en: "Place the probe for parasternal long axis and name the chambers.", hi: "Place the probe for parasternal long axis and name the chambers." },
        { en: "Find apical four chamber and keep the apex on screen.", hi: "Find apical four chamber and keep the apex on screen." },
        { en: "Find the papillary muscle short axis and grade the image.", hi: "Find the papillary muscle short axis and grade the image." },
        { en: "Say the probe position and marker direction for each view.", hi: "Say the probe position and marker direction for each view." }
      ],
      links: [
        { kind: "view", id: "tte_plax" },
        { kind: "view", id: "tte_a4c" },
        { kind: "view", id: "tte_psax_papillary" },
        { kind: "lesson", id: "view_plax" },
        { kind: "lesson", id: "view_a4c" },
        { kind: "lesson", id: "view_psax_papillary" },
        { kind: "calc", id: "bsa" }
      ],
      desc: {
        en: "A 30 minute bedside starter on probe handling. Students take turns finding parasternal long axis, apical four chamber and the papillary short axis, then say the probe position and marker aloud. Close with the three matching lessons. Fits a ward round gap or a skills lab slot.",
        hi: "A 30 minute bedside starter on probe handling. Students take turns finding parasternal long axis, apical four chamber and the papillary short axis, then say the probe position and marker aloud. Close with the three matching lessons. Fits a ward round gap or a skills lab slot."
      }
    },
    {
      id: "lv",
      name: { en: "LV function", hi: "LV function" },
      time: { en: "30 minutes at the bedside", hi: "30 minutes at the bedside" },
      blurb: {
        en: "Measure ejection fraction, mass and atrial size, then read one dilated heart.",
        hi: "Measure ejection fraction, mass and atrial size, then read one dilated heart."
      },
      objectives: [
        { en: "Trace end diastole and end systole for Simpson ejection fraction.", hi: "Trace end diastole and end systole for Simpson ejection fraction." },
        { en: "Measure wall thickness and chamber size for LV mass.", hi: "Measure wall thickness and chamber size for LV mass." },
        { en: "Grade one dilated cardiomyopathy case against the norms.", hi: "Grade one dilated cardiomyopathy case against the norms." },
        { en: "State when to prefer strain over ejection fraction.", hi: "State when to prefer strain over ejection fraction." }
      ],
      links: [
        { kind: "lesson", id: "meas_simpson_ef" },
        { kind: "lesson", id: "meas_lv_mass" },
        { kind: "lesson", id: "meas_la_volume" },
        { kind: "lesson", id: "path_dilated_cardiomyopathy" },
        { kind: "calc", id: "lv-ef" },
        { kind: "calc", id: "lv-mass" },
        { kind: "calc", id: "lv-gls" },
        { kind: "view", id: "tte_a4c" },
        { kind: "view", id: "tte_a5c" },
        { kind: "case", id: "kd11a_dcm_severe_01" }
      ],
      desc: {
        en: "A 30 minute bedside session on systolic function. Work the Simpson and LV mass lessons, check each number in its calculator, then read the severe dilated cardiomyopathy case together. End by asking when strain adds to ejection fraction. Suits post take teaching.",
        hi: "A 30 minute bedside session on systolic function. Work the Simpson and LV mass lessons, check each number in its calculator, then read the severe dilated cardiomyopathy case together. End by asking when strain adds to ejection fraction. Suits post take teaching."
      }
    },
    {
      id: "valves",
      name: { en: "Valves", hi: "Valves" },
      time: { en: "30 minutes at the bedside", hi: "30 minutes at the bedside" },
      blurb: {
        en: "Grade one stenotic and one regurgitant valve with continuity and PISA.",
        hi: "Grade one stenotic and one regurgitant valve with continuity and PISA."
      },
      objectives: [
        { en: "Record peak velocity and mean gradient across the aortic valve.", hi: "Record peak velocity and mean gradient across the aortic valve." },
        { en: "Work one continuity aortic area and one PISA mitral area.", hi: "Work one continuity aortic area and one PISA mitral area." },
        { en: "Read one severe aortic stenosis and one severe mitral stenosis case.", hi: "Read one severe aortic stenosis and one severe mitral stenosis case." },
        { en: "State the severe cut offs for area, velocity and gradient.", hi: "State the severe cut offs for area, velocity and gradient." }
      ],
      links: [
        { kind: "lesson", id: "dop_continuity_ava" },
        { kind: "lesson", id: "dop_pisa_eroa" },
        { kind: "lesson", id: "path_aortic_stenosis" },
        { kind: "lesson", id: "path_mitral_stenosis" },
        { kind: "calc", id: "as-continuity" },
        { kind: "calc", id: "mr-pisa" },
        { kind: "calc", id: "mitral-pht" },
        { kind: "view", id: "tte_a5c" },
        { kind: "case", id: "kd11a_as_severe_01" },
        { kind: "case", id: "kd11a_ms_severe_01" }
      ],
      desc: {
        en: "A 30 minute bedside session on valve grading. Pair each lesson with its calculator, check the numbers against the severe cut offs, then read the two severe cases. Ask students to defend each grade aloud. Suits a valve clinic afternoon.",
        hi: "A 30 minute bedside session on valve grading. Pair each lesson with its calculator, check the numbers against the severe cut offs, then read the two severe cases. Ask students to defend each grade aloud. Suits a valve clinic afternoon."
      }
    },
    {
      id: "right",
      name: { en: "Right heart", hi: "Right heart" },
      time: { en: "30 minutes at the bedside", hi: "30 minutes at the bedside" },
      blurb: {
        en: "Estimate pulmonary pressure from the tricuspid jet and the IVC.",
        hi: "Estimate pulmonary pressure from the tricuspid jet and the IVC."
      },
      objectives: [
        { en: "Measure TAPSE and S prime in the RV focused view.", hi: "Measure TAPSE and S prime in the RV focused view." },
        { en: "Size the IVC and assign right atrial pressure.", hi: "Size the IVC and assign right atrial pressure." },
        { en: "Combine TR velocity and atrial pressure into RV pressure.", hi: "Combine TR velocity and atrial pressure into RV pressure." },
        { en: "Read one high probability pulmonary hypertension case.", hi: "Read one high probability pulmonary hypertension case." }
      ],
      links: [
        { kind: "lesson", id: "meas_pasp" },
        { kind: "lesson", id: "meas_rv_tapse" },
        { kind: "lesson", id: "path_pulmonary_hypertension" },
        { kind: "calc", id: "rvsp" },
        { kind: "calc", id: "rap" },
        { kind: "calc", id: "rv-function" },
        { kind: "view", id: "tte_a4c_rv_focus" },
        { kind: "view", id: "tte_subcostal_ivc" },
        { kind: "case", id: "kd11a_ph_high_01" }
      ],
      desc: {
        en: "A 30 minute bedside session on the right heart. Measure TAPSE, size the IVC, then build RV systolic pressure step by step in the calculators. Close with the pulmonary hypertension case. Suits ICU rounds where right heart failure is on the list.",
        hi: "A 30 minute bedside session on the right heart. Measure TAPSE, size the IVC, then build RV systolic pressure step by step in the calculators. Close with the pulmonary hypertension case. Suits ICU rounds where right heart failure is on the list."
      }
    },
    {
      id: "pocus",
      name: { en: "POCUS", hi: "POCUS" },
      time: { en: "30 minutes at the bedside", hi: "30 minutes at the bedside" },
      blurb: {
        en: "Run FAST, eFAST, BLUE and RUSH on the acutely ill patient.",
        hi: "Run FAST, eFAST, BLUE and RUSH on the acutely ill patient."
      },
      objectives: [
        { en: "Complete the four FAST windows in under five minutes.", hi: "Complete the four FAST windows in under five minutes." },
        { en: "Add lung sliding for eFAST and name the BLUE points.", hi: "Add lung sliding for eFAST and name the BLUE points." },
        { en: "Run the RUSH sequence for undifferentiated shock.", hi: "Run the RUSH sequence for undifferentiated shock." },
        { en: "Read one tamponade and one large effusion case.", hi: "Read one tamponade and one large effusion case." }
      ],
      links: [
        { kind: "lesson", id: "pocus_fast_protocol" },
        { kind: "lesson", id: "pocus_efast_protocol" },
        { kind: "lesson", id: "pocus_blue_protocol" },
        { kind: "lesson", id: "pocus_rush" },
        { kind: "view", id: "pocus_fast_ruq" },
        { kind: "view", id: "pocus_fast_subxiphoid" },
        { kind: "calc", id: "rap" },
        { kind: "case", id: "kd11a_tamponade_severe_01" },
        { kind: "case", id: "kd11a_effusion_large_01" }
      ],
      desc: {
        en: "A 30 minute bedside drill session for point of care ultrasound. Walk each protocol once, then time the students on the FAST windows. Finish with the tamponade and effusion cases to show why speed matters. Suits emergency posting induction.",
        hi: "A 30 minute bedside drill session for point of care ultrasound. Walk each protocol once, then time the students on the FAST windows. Finish with the tamponade and effusion cases to show why speed matters. Suits emergency posting induction."
      }
    }
  ];

  function unitById(id) {
    for (var i = 0; i < UNITS.length; i++) if (UNITS[i].id === id) return UNITS[i];
    return null;
  }

  var API = { UNITS: UNITS, unitById: unitById, review: "ai_drafted" };
  if (G) G.KARDIA_TEACH = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
