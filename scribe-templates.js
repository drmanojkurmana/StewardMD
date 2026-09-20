/* StewardMD — MaiK Scribe specialty templates (item 17).
 * ---------------------------------------------------------------------------
 * A small registry of specialty-specific documentation prompts for the ambient scribe. Each
 * template's promptLines are extra instruction lines meant to be appended to the LLM extraction
 * prompt built by scribeExtractPrompt() in functions/api/ai/_opd-scribe.js -- same bullet-list
 * style as that prompt's own "STRUCTURED EMR FIELDS" section, e.g.
 *   var tpl = SMD_SCRIBETPL.get(specialtyId);
 *   var extra = tpl.promptLines.length ? "\n" + tpl.promptLines.join("\n") + "\n" : "";
 *   // ... splice `extra` into the prompt text before "=== TRANSCRIPT ===" ...
 * These are DOCUMENTATION prompts only: they tell the scribe what to listen for and where to file
 * it, never what to prescribe or diagnose. Nothing here invents a dose, a diagnosis or a plan --
 * scribeExtractPrompt's own "use ONLY what is explicitly said" rule still governs every field.
 *
 * requiredFields lists the voice/EMR field keys (opd-emr.js VOICE_MAP namespace -- the same keys
 * u.field carries in SMD_AMBIENT/_voiceMerge, e.g. "cc", "lmp", "diet") that this specialty should
 * not leave blank, so a review screen can prompt for them when the consult is over. A key not in
 * this list is not treated as required by this registry; it says nothing about whether opd-emr.js's
 * own EMR schema shows it.
 *
 * window.SMD_SCRIBETPL + module.exports.
 */
(function (root) {
  "use strict";

  var TEMPLATES = [
    {
      id: "general", label: "General OPD",
      description: "Default outpatient consultation. No extra prompting beyond the standard scribe.",
      promptLines: [],
      requiredFields: ["cc", "presentHx"],
      checklist: ["Chief complaint noted", "History of present illness recorded"]
    },
    {
      id: "paediatrics", label: "Paediatrics",
      description: "Weight-based dosing, feeding, immunisation and developmental milestones.",
      promptLines: [
        "This is a PAEDIATRIC consultation.",
        "- treatmentReceived / managementPlan: if a medication dose is stated as an amount PER KILOGRAM (e.g. 'paracetamol 15 mg/kg'), record it exactly as stated, together with the child's weight if given. Never calculate, convert or invent a dose yourself.",
        "- diet: record feeding history (breast milk, formula, weaning, type and frequency) when discussed.",
        "- immunization: record vaccination status against the age-appropriate schedule when discussed.",
        "- presentHx: include developmental milestones (motor, speech, social) when discussed, alongside the presenting illness."
      ],
      requiredFields: ["cc", "diet", "immunization"],
      checklist: ["Weight recorded", "Feeding history documented", "Immunisation status documented", "Developmental milestones asked"]
    },
    {
      id: "obgyn", label: "Obstetrics & Gynaecology",
      description: "LMP, gravida and para, EDD, and obstetric history.",
      promptLines: [
        "This is an OBSTETRIC / GYNAECOLOGY consultation.",
        "- lmp: record the Last Menstrual Period date exactly as stated.",
        "- presentHx: include gravida and para (e.g. 'G2P1'), the estimated date of delivery (EDD) if stated or directly calculable from a stated LMP by Naegele's rule, and relevant obstetric history (previous pregnancies, deliveries, complications, miscarriages) when discussed.",
        "- provisionalDx: never invent a gestational age or EDD that was not stated or directly calculable from a stated LMP."
      ],
      requiredFields: ["lmp", "presentHx"],
      checklist: ["LMP recorded", "Gravida and para recorded", "EDD calculated or recorded", "Obstetric history documented"]
    },
    {
      id: "surgery-followup", label: "Surgery follow-up",
      description: "Wound, drain, suture removal and pathology review.",
      promptLines: [
        "This is a POST-OPERATIVE follow-up consultation.",
        "- localExam: record wound condition (clean / infected / discharge), any drain present and its output, and suture or staple status when examined or discussed.",
        "- managementPlan: record whether sutures/staples were removed, or a removal date/plan, and any pathology/histopathology result discussed.",
        "- comorbidsNote: record the operation performed and the post-operative day, if stated."
      ],
      requiredFields: ["localExam", "managementPlan"],
      checklist: ["Wound examined", "Drain output recorded (if a drain is present)", "Suture/staple removal status recorded", "Pathology report reviewed"]
    }
  ];
  var DEFAULT_ID = "general";
  var BY_ID = {};
  TEMPLATES.forEach(function (t) { BY_ID[t.id] = t; });

  function list() {
    return TEMPLATES.map(function (t) { return { id: t.id, label: t.label, description: t.description }; });
  }
  // Falsy or unrecognised id -> the general/default template, so a caller that has not asked the
  // doctor to pick a specialty yet (or gets a stale/typo'd id) still gets a working, safe prompt
  // set rather than nothing. Always returns a fresh copy: callers may push onto promptLines etc.
  // without mutating the registry.
  function get(id) {
    var t = (id && BY_ID[id]) || BY_ID[DEFAULT_ID];
    return {
      id: t.id, label: t.label,
      promptLines: t.promptLines.slice(),
      requiredFields: t.requiredFields.slice(),
      checklist: t.checklist.slice()
    };
  }

  var API = { list: list, get: get, DEFAULT_ID: DEFAULT_ID, _version: "1.0" };
  if (root) root.SMD_SCRIBETPL = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null));
