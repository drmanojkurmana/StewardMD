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
    },
    // 2026-09-25: one template per specialty kit (specialty-kits.js). Picking a kit in the OPD Specialty
    // tab selects the matching template, so the scribe listens for what that kit documents. Same rule
    // as above: documentation prompts only, never a diagnosis, grade or dose that was not said.
    {
      id: "orthopaedics", label: "Orthopaedics",
      description: "Mechanism of injury, joint and spine examination, neurovascular status, fracture and immobilisation.",
      promptLines: [
        "This is an ORTHOPAEDIC consultation.",
        "- presentHx: record the site and side, the mechanism of injury or mode of onset, duration, pain pattern and weight bearing, as stated.",
        "- musculoskeletal: record the joint or limb examination as dictated (swelling, deformity, tenderness, range of movement in degrees, special tests such as Lachman or McMurray, gait), naming the side.",
        "- localExam: record a fracture or wound description and the distal neurovascular status (pulses, capillary refill, sensation, movement) exactly as stated.",
        "- motorSystem / sensorySystem / reflexes / plantars: for spine complaints, record myotome power, dermatomal sensation, reflexes and plantar response as dictated.",
        "- managementPlan: record any splint, slab or cast applied, the weight-bearing instruction and the review date as stated. Never state a fracture classification that was not said.",
        "- painScore: the pain score only if a number out of 10 was stated."
      ],
      requiredFields: ["cc", "presentHx", "musculoskeletal"],
      checklist: ["Side, site and mechanism recorded", "Joint or spine examination documented", "Distal neurovascular status documented", "Immobilisation and weight bearing documented"]
    },
    {
      id: "ophthalmology", label: "Ophthalmology",
      description: "Visual acuity for each eye, anterior segment, pupils, intraocular pressure and fundus.",
      promptLines: [
        "This is an OPHTHALMOLOGY consultation.",
        "- presentHx: record which eye (right, left or both), onset, change in vision, pain, redness, discharge, photophobia, floaters or flashes, and any injury, as stated.",
        "- localExam: record visual acuity for EACH eye exactly as stated (e.g. 'RE 6/9, LE 6/60, pinhole 6/12'), intraocular pressure for each eye with the method, and anterior segment, pupil (including RAPD) and fundus findings for each eye as dictated. Never convert or infer an acuity or a pressure.",
        "- headNeckExam: record lid, lacrimal and orbit findings as dictated.",
        "- managementPlan: record eye drops or medicines exactly as stated, including which eye and how often."
      ],
      requiredFields: ["cc", "presentHx", "localExam"],
      checklist: ["Visual acuity recorded for each eye", "Pupils and RAPD checked", "Intraocular pressure recorded where measured", "Fundus findings documented"]
    },
    {
      id: "ent", label: "ENT",
      description: "Ear, nose and throat symptoms, otoscopy, rhinoscopy, oral cavity, neck and hearing tests.",
      promptLines: [
        "This is an ENT consultation.",
        "- presentHx: record ear pain, discharge, hearing loss, tinnitus, vertigo, nasal obstruction, nosebleeds, sore throat, swallowing and voice symptoms with side and duration, as stated.",
        "- entExam: record otoscopy for each ear (canal, tympanic membrane, perforation), anterior rhinoscopy (septum, turbinates, discharge, polyps) and laryngoscopy findings as dictated, and tuning-fork results (Rinne each ear, Weber) and audiometry values exactly as stated. Never infer a hearing grade.",
        "- teethExam: record oral cavity and oropharynx findings (tonsils, oral mucosa, any lesion) as dictated.",
        "- headNeckExam: record neck nodes, thyroid, other neck swellings and the facial nerve grade as dictated.",
        "- tobacco: record tobacco and areca nut use only as stated."
      ],
      requiredFields: ["cc", "presentHx", "entExam"],
      checklist: ["Side of ear or nose symptoms recorded", "Otoscopy documented for both ears", "Neck examined", "Tobacco and areca nut use asked"]
    },
    {
      id: "dermatology", label: "Dermatology",
      description: "Lesion history, morphology and distribution, special signs, drug history and leprosy screen.",
      promptLines: [
        "This is a DERMATOLOGY consultation.",
        "- presentHx: record onset, duration, spread, itch (including night itch or itching contacts), triggers and treatment already used, including steroid or mixed creams, as stated.",
        "- treatmentReceived: record every medicine taken recently, including over-the-counter and traditional remedies, with start dates if stated.",
        "- localExam: record the lesions as dictated: primary lesion, colour, size, surface change, border, arrangement, distribution and body sites, and special signs (Nikolsky, Auspitz, Koebner) as stated. For a hypopigmented or red patch, record sensation over the patch and any thickened nerve exactly as examined; never infer a leprosy classification.",
        "- skin: record hair, nail and mucosal findings as dictated."
      ],
      requiredFields: ["cc", "presentHx", "localExam"],
      checklist: ["Morphology and distribution documented", "Recent drug history taken", "Topical steroid use asked", "Mucosa, hair and nails examined"]
    },
    {
      id: "psychiatry", label: "Psychiatry",
      description: "History from patient and informant, mental status examination, risk, and the Mental Healthcare Act 2017.",
      promptLines: [
        "This is a PSYCHIATRY consultation.",
        "- presentHx: record the symptoms in time order from the patient and the informant, saying who reported what where stated, with onset, course and precipitants.",
        "- systemicExam: record the mental status examination as dictated: appearance and behaviour, psychomotor activity, speech, mood in the patient's own words, affect, thought form and content, perception, cognition, insight and judgement. Quote the patient's words where the doctor does.",
        "- managementPlan: record any suicidal thoughts, plan, intent, self-harm or thoughts of harming others EXACTLY as stated, and the safety plan agreed. Never omit a stated risk, and never write a risk level (low, medium or high) that was not said.",
        "- habits, alcohol, tobacco, recDrug: record substance use, amounts and last use only as stated.",
        "- familyPsych: 'Yes'/'No' for psychiatric illness in the family only if it was discussed."
      ],
      requiredFields: ["cc", "presentHx", "systemicExam"],
      checklist: ["Informant and reliability noted", "Mental status examination documented", "Suicide and self-harm risk asked", "Capacity and consent (MHCA 2017) considered"]
    },
    {
      id: "dental", label: "Dental",
      description: "Dental pain history, medical risks for dental care, oral soft tissues, tooth chart and periodontal status.",
      promptLines: [
        "This is a DENTAL consultation.",
        "- presentHx: record the pain (character, trigger, duration), swelling, bleeding gums and previous dental treatment, as stated.",
        "- pastHx: record anticoagulant, antiplatelet, bisphosphonate or denosumab use, heart valve disease or endocarditis, diabetes and bleeding disorders, if stated.",
        "- teethExam: record teeth findings with FDI tooth numbers exactly as dictated (e.g. '36 deep caries, 46 missing'), plus oral soft tissue and periodontal findings. Never renumber or infer a tooth.",
        "- headNeckExam: record facial swelling, lymph nodes, the temporomandibular joint and mouth opening in mm, as dictated.",
        "- tobacco: record tobacco and areca nut use (type, how often) only as stated."
      ],
      requiredFields: ["cc", "presentHx", "teethExam"],
      checklist: ["Tooth numbers recorded (FDI)", "Anticoagulants and bleeding risk asked", "Oral soft tissues examined", "Tobacco and areca nut use asked"]
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
