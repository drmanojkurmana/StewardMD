/* StewardMD — Initial Assessment schema (mirrors the GHIS Initial Assessment form).
 * ---------------------------------------------------------------------------
 * Pure data: the field inventory of ghis.gitam.edu /Doctor/Home/GetInitialAssessmentnew.
 * Consumed by assessment.js (renders the StewardMD form), voice-emr-map.js (autofill target),
 * and the GHIS write-back (Task 4 fills each field's `ghis` name once discovered from the
 * live form HTML). No DOM, no network. window.SMD_ASSESS + module.exports (Node-testable).
 *
 * Field types: text | textarea | num | radio | select | check.
 *   radio/select options → `opts` (first = unset/default where relevant).
 *   `voice:true` marks fields the ambient extractor is allowed to populate.
 *   `subjective:true` marks patient-reportable fields (cc/history) — see voice-emr-map gating.
 *   `ghis` = the live form's input name for write-back (null until discovered — Task 4).
 */
(function (root) {
  "use strict";

  // Ordered sections → fields. Kept flat-ish; the form renders section by section.
  var SECTIONS = [
    { id: "complaints", title: "Complaints & History", fields: [
      { id: "cc",           label: "Chief complaints",  type: "textarea", required: true, voice: true, subjective: true, ghis: null },
      { id: "presentHx",    label: "Present history",   type: "textarea", required: true, voice: true, subjective: true, ghis: null },
      { id: "pastHx",       label: "Past history",      type: "textarea", required: true, voice: true, subjective: true, ghis: null }
    ]},
    { id: "vitals", title: "Vital parameters", fields: [
      { id: "temp",        label: "Temperature (°F)",       type: "num",   required: true, voice: true, min: 90, max: 110, ghis: null },
      { id: "bpSys",       label: "BP systolic (mmHg)",     type: "num",   required: true, voice: true, min: 50, max: 300, ghis: null },
      { id: "bpDia",       label: "BP diastolic (mmHg)",    type: "num",   required: true, voice: true, min: 20, max: 200, ghis: null },
      { id: "pulse",       label: "Pulse rate (/min)",      type: "num",   required: true, voice: true, min: 20, max: 250, ghis: null },
      { id: "pulseRhythm", label: "Pulse rhythm",           type: "radio", opts: ["Regular", "Irregular"], voice: true, ghis: null },
      { id: "rr",          label: "Respiratory rate (/min)",type: "num",   required: true, voice: true, min: 4, max: 80, ghis: null },
      { id: "rrRhythm",    label: "Respiration rhythm",     type: "radio", opts: ["Regular", "Irregular"], voice: true, ghis: null },
      { id: "nutrition",   label: "Nutrition",              type: "text",  ghis: null },
      { id: "hydration",   label: "Hydration",              type: "text",  ghis: null },
      { id: "genCondition",label: "General condition",      type: "select",opts: ["", "Fair", "Poor", "Moribund"], voice: true, ghis: null }
    ]},
    { id: "genexam", title: "General examination", fields: [
      // GHIS renders these as presence checkboxes; voice sets true/false explicitly.
      { id: "pallor",         label: "Pallor",         type: "check", voice: true, ghis: null },
      { id: "icterus",        label: "Icterus",        type: "check", voice: true, ghis: null },
      { id: "cyanosis",       label: "Cyanosis",       type: "check", voice: true, ghis: null },
      { id: "clubbing",       label: "Clubbing",       type: "check", voice: true, ghis: null },
      { id: "oedema",         label: "Oedema",         type: "check", voice: true, ghis: null },
      { id: "lymphadenopathy",label: "Lymphadenopathy",type: "check", voice: true, ghis: null },
      { id: "rash",           label: "Rash",           type: "check", voice: true, ghis: null },
      { id: "goitre",         label: "Goitre",         type: "check", voice: true, ghis: null },
      { id: "systemicExam",   label: "Systemic examination", type: "textarea", voice: true, ghis: null }
    ]},
    { id: "cns", title: "Central nervous system", fields: [
      { id: "loc",           label: "Level of consciousness", type: "select", opts: ["", "Conscious", "Drowsy", "Stuporous", "Coma"], voice: true, ghis: null },
      { id: "orientation",   label: "Oriented",     type: "radio", opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "gcs",           label: "Glasgow scale",type: "num",  min: 3, max: 15, voice: true, ghis: null },
      { id: "neckStiffness", label: "Neck stiffness",type: "radio",opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "kernig",        label: "Kernig's sign",type: "radio", opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "cranialNerves", label: "Cranial nerves", type: "text", ghis: null },
      { id: "motor",         label: "Motor system",   type: "text", ghis: null },
      { id: "sensory",       label: "Sensory system", type: "text", ghis: null },
      { id: "reflexes",      label: "Reflexes",       type: "text", ghis: null },
      { id: "plantars",      label: "Plantars",       type: "text", ghis: null }
    ]},
    { id: "cvs", title: "Cardiovascular system", fields: [
      { id: "cardiacSounds", label: "Cardiac sounds", type: "text",  voice: true, ghis: null },
      { id: "jvp",           label: "JVP",            type: "text",  ghis: null },
      { id: "murmurs",       label: "Cardiac murmurs",type: "radio", opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "thrills",       label: "Thrills",        type: "radio", opts: ["Yes", "No"], voice: true, ghis: null }
    ]},
    { id: "resp", title: "Respiratory system", fields: [
      { id: "dyspnoea",     label: "Dyspnoea",     type: "radio",  opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "breathSounds", label: "Breath sounds",type: "select", opts: ["", "Vesicular", "Tubular", "Amphoric"], voice: true, ghis: null },
      { id: "wheeze",       label: "Wheeze",       type: "radio",  opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "adventitious", label: "Adventitious sounds", type: "select", opts: ["", "None", "Rhonchi", "Rales(crepts)", "Pleural rub"], voice: true, ghis: null }
    ]},
    { id: "abdomen", title: "Abdomen", fields: [
      { id: "abdoShape",    label: "Shape",        type: "select", opts: ["", "Scaphoid", "Flat", "Distended"], voice: true, ghis: null },
      { id: "tenderness",   label: "Tenderness",   type: "radio",  opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "abdoMass",     label: "Palpable mass",type: "radio",  opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "bowelSounds",  label: "Bowel sounds", type: "select", opts: ["", "Normal", "Absent", "Exaggerated"], voice: true, ghis: null },
      { id: "freeFluid",    label: "Free fluid",   type: "radio",  opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "liver",        label: "Liver",        type: "select", opts: ["", "Not palpable", "Palpable"], voice: true, ghis: null },
      { id: "spleen",       label: "Spleen",       type: "select", opts: ["", "Not palpable", "Palpable"], voice: true, ghis: null },
      { id: "bruits",       label: "Bruits",       type: "radio",  opts: ["Yes", "No"], voice: true, ghis: null }
    ]},
    { id: "other", title: "Other systems", fields: [
      { id: "msk",     label: "Musculoskeletal", type: "text", ghis: null },
      { id: "skin",    label: "Skin",            type: "text", ghis: null },
      { id: "ent",     label: "ENT",             type: "text", ghis: null },
      { id: "pain",    label: "Pain score (0-10)",type: "num", min: 0, max: 10, voice: true, ghis: null }
    ]},
    { id: "nutrition", title: "Nutritional screening", fields: [
      { id: "diet",     label: "Diet",         type: "select", opts: ["", "Vegetarian", "Non-vegetarian"], voice: true, ghis: null },
      { id: "heightCm", label: "Height (cm)",  type: "num", min: 30, max: 250, voice: true, ghis: null },
      { id: "weightKg", label: "Weight (kg)",  type: "num", min: 1, max: 400, voice: true, ghis: null },
      { id: "bmi",      label: "BMI",          type: "num", ghis: null }
    ]},
    { id: "comorbid", title: "Co-morbid conditions", fields: [
      { id: "dm",       label: "Diabetes",        type: "radio", opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "htn",      label: "Hypertension",    type: "radio", opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "cardiac",  label: "Cardiac illness",  type: "radio", opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "asthma",   label: "Bronchial asthma", type: "radio", opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "tb",       label: "Tuberculosis",     type: "radio", opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "thyroid",  label: "Thyroid disorder", type: "radio", opts: ["Yes", "No"], voice: true, ghis: null },
      { id: "epilepsy", label: "Epilepsy",         type: "radio", opts: ["Yes", "No"], voice: true, ghis: null }
    ]},
    { id: "plan", title: "Assessment & plan", fields: [
      { id: "provisionalDx",  label: "Provisional diagnosis", type: "textarea", voice: true, ghis: null },
      { id: "managementPlan", label: "Management plan",       type: "textarea", voice: true, ghis: null },
      { id: "referral",       label: "Referred to & plan",    type: "textarea", ghis: null }
    ]}
    // History blocks (Personal / Family / Menstrual-Obstetric / Immunisation) are prefill/manual —
    // rarely dictated at the bedside. Added to the form in Task 3; not voice-targeted.
  ];

  // Flatten → byId lookup + the set of voice-fillable and subjective (patient-reportable) ids.
  var byId = {}, VOICE = {}, SUBJECTIVE = {};
  SECTIONS.forEach(function (sec) {
    sec.fields.forEach(function (f) {
      f.section = sec.id; byId[f.id] = f;
      if (f.voice) VOICE[f.id] = 1;
      if (f.subjective) SUBJECTIVE[f.id] = 1;
    });
  });

  var API = { sections: SECTIONS, byId: byId, voiceFields: VOICE, subjectiveFields: SUBJECTIVE, _version: "1.0" };
  if (root) root.SMD_ASSESS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
