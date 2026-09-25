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
    },
    // 2026-09-25 (wave 1 of the every-branch plan): templates for the medical, acute and care kits.
    // Same rule as above: what to listen for and where to file it, never a dose, diagnosis or plan.
    {
      id: "general-surgery", label: "General Surgery",
      description: "Surgical history of the lump, pain or bleeding, abdominal and hernial examination, and the operative plan discussed.",
      promptLines: [
        "This is a GENERAL SURGERY consultation.",
        "- presentHx: record the lump, pain, bleeding or obstruction symptoms with site, duration and progression, as stated.",
        "- abdoExam: record inspection, palpation (tenderness, guarding, rigidity, organomegaly), percussion and bowel sounds as dictated.",
        "- localExam: record a lump or ulcer description (site, size in cm, shape, surface, consistency, fixity, overlying skin) exactly as dictated.",
        "- hernialOrifices / perRectalExam: record hernial orifice and per rectal findings only if examined.",
        "- managementPlan: record the operation or procedure discussed, the consent discussion and any pre-operative work-up as stated. Never add an operation that was not said."
      ],
      requiredFields: ["cc", "presentHx", "abdoExam"],
      checklist: ["Lump or pain characterised", "Abdomen and hernial orifices examined", "Per rectal examination done or deferred with a reason", "Operation and consent discussed"]
    },
    {
      id: "anaesthesia", label: "Pre-anaesthetic check",
      description: "Pre-anaesthetic assessment: previous anaesthesia, airway, cardiorespiratory risk, fasting and consent.",
      promptLines: [
        "This is a PRE-ANAESTHETIC CHECK.",
        "- surgicalHistory: record previous operations and anaesthetics, and any problem with them (difficult airway, reaction, nausea), as stated.",
        "- homeMeds: record current medicines, especially anticoagulants, antiplatelets, insulin and other diabetes drugs, as stated.",
        "- headNeckExam: record the airway examination as dictated (Mallampati class, mouth opening, thyromental distance, neck movement, teeth). Never assign a Mallampati class that was not said.",
        "- cvsExam / respiratoryExam: record heart and chest findings as dictated.",
        "- managementPlan: record the ASA class, planned anaesthesia, fasting instructions and medicines to stop or continue exactly as stated."
      ],
      requiredFields: ["cc", "headNeckExam", "managementPlan"],
      checklist: ["Previous anaesthetic problems asked", "Airway assessed", "Anticoagulants and diabetes medicines addressed", "Fasting instructions and consent recorded"]
    },
    {
      id: "emergency", label: "Emergency",
      description: "Emergency assessment: triage, ABCDE, time course, and the treatment already given.",
      promptLines: [
        "This is an EMERGENCY consultation.",
        "- presentHx: record the time of onset, mechanism of injury or events, and who gave the history, as stated.",
        "- treatmentReceived: record treatment given before arrival and in the department with times, as stated.",
        "- gcs: the Glasgow Coma Scale only if a number or its components were stated.",
        "- systemicExam: record the primary survey in ABCDE order as dictated.",
        "- managementPlan: record the disposition (admit, refer, observe, discharge) and the reason exactly as stated. For a medico-legal case record who brought the patient and whether the police were informed, if stated."
      ],
      requiredFields: ["cc", "presentHx", "systemicExam"],
      checklist: ["Time of onset recorded", "Primary survey (ABCDE) documented", "Treatment given with times recorded", "Disposition and medico-legal status recorded"]
    },
    {
      id: "cardiology", label: "Cardiology",
      description: "Chest pain, breathlessness and palpitations history, cardiovascular examination and risk factors.",
      promptLines: [
        "This is a CARDIOLOGY consultation.",
        "- presentHx: record chest pain character, radiation, exertional relation and duration, breathlessness grade, palpitations, syncope and orthopnoea, as stated.",
        "- cvsExam: record pulse, JVP, apex, heart sounds and murmurs exactly as dictated.",
        "- jvp: the JVP only if stated.",
        "- htn / dm / dyslipidemia: 'Yes'/'No' only if the risk factor was discussed.",
        "- managementPlan: record the ECG, echo or stress test findings and the plan exactly as stated. Never state an ejection fraction that was not said."
      ],
      requiredFields: ["cc", "presentHx", "cvsExam"],
      checklist: ["Chest pain characterised", "Breathlessness graded", "Risk factors asked", "ECG findings recorded"]
    },
    {
      id: "pulmonology", label: "Respiratory",
      description: "Cough, breathlessness and wheeze history, smoking and exposures, chest examination and spirometry.",
      promptLines: [
        "This is a RESPIRATORY consultation.",
        "- presentHx: record cough (duration, sputum, blood), breathlessness grade, wheeze, fever, weight loss and night symptoms, as stated.",
        "- smoking: record smoking with pack-years only if stated.",
        "- respiratoryExam: record chest findings (air entry, breath sounds, crackles, wheeze) with the side, as dictated.",
        "- spo2: the oxygen saturation only if a number was stated, and whether on room air or oxygen.",
        "- managementPlan: record inhaler technique checked, spirometry or X-ray findings and the plan exactly as stated."
      ],
      requiredFields: ["cc", "presentHx", "respiratoryExam"],
      checklist: ["Cough and sputum characterised", "Smoking and exposures asked", "TB symptoms screened", "Inhaler technique checked"]
    },
    {
      id: "neurology", label: "Neurology",
      description: "Onset and course of neurological symptoms, full neurological examination and seizure details.",
      promptLines: [
        "This is a NEUROLOGY consultation.",
        "- presentHx: record the onset (sudden or gradual), time last known well, course, and for seizures what was seen before, during and after, with the witness, as stated.",
        "- cranialNerves / motorSystem / sensorySystem / reflexes / plantars / cerebellar / gait / speech: record each finding exactly as dictated, naming the side. Never infer a power grade that was not said.",
        "- gcs: the Glasgow Coma Scale only if stated.",
        "- managementPlan: record the imaging, EEG or nerve study findings and the plan exactly as stated."
      ],
      requiredFields: ["cc", "presentHx", "motorSystem"],
      checklist: ["Onset and time last known well recorded", "Witness account for seizures", "Cranial nerves, power, reflexes and plantars documented", "Driving advice given for seizures"]
    },
    {
      id: "nephrology-urology", label: "Nephrology and Urology",
      description: "Urinary symptoms, kidney function history, fluid status, and urological examination.",
      promptLines: [
        "This is a NEPHROLOGY or UROLOGY consultation.",
        "- presentHx: record urinary symptoms (frequency, urgency, poor stream, retention, blood, stones), swelling and urine output, as stated.",
        "- micturition: record the voiding pattern only as stated.",
        "- oedema: record oedema and its extent only as stated.",
        "- genitalExam / perRectalExam: record genital and prostate findings only if examined.",
        "- managementPlan: record creatinine, eGFR, urine and imaging results and the plan exactly as stated. Never compute an eGFR or stage that was not said."
      ],
      requiredFields: ["cc", "presentHx", "managementPlan"],
      checklist: ["Urinary symptoms characterised", "Blood pressure and oedema recorded", "Nephrotoxic medicines asked", "Latest creatinine and urine results recorded"]
    },
    {
      id: "diabetes-endocrine", label: "Diabetes and Endocrine",
      description: "Glucose control, complications screening, thyroid symptoms and foot examination.",
      promptLines: [
        "This is a DIABETES or ENDOCRINE consultation.",
        "- presentHx: record glucose readings, hypoglycaemia episodes, and thyroid or other hormonal symptoms, as stated.",
        "- homeMeds: record the diabetes and thyroid medicines with doses exactly as stated, including insulin type and units.",
        "- localExam: record the foot examination (pulses, monofilament sensation, ulcers, deformity) as dictated.",
        "- dm / thyroid: 'Yes'/'No' and details only as stated.",
        "- managementPlan: record HbA1c and other results and the plan exactly as stated. Never adjust or suggest a dose."
      ],
      requiredFields: ["cc", "presentHx", "homeMeds"],
      checklist: ["Glucose readings and hypoglycaemia asked", "Foot examined", "Eye and kidney screening dates recorded", "Latest HbA1c recorded"]
    },
    {
      id: "gastro-hepatology", label: "Gastroenterology and Hepatology",
      description: "Abdominal symptoms, bleeding and liver history, abdominal examination and alarm features.",
      promptLines: [
        "This is a GASTROENTEROLOGY or HEPATOLOGY consultation.",
        "- presentHx: record abdominal pain, heartburn, vomiting, blood in vomit or stool, black stools, jaundice, change in bowel habit and weight loss, as stated.",
        "- alcohol: record alcohol use and amount only as stated.",
        "- abdoExam: record abdominal findings (tenderness, liver and spleen size in cm, ascites) as dictated.",
        "- icterus: record jaundice only as stated.",
        "- managementPlan: record endoscopy, liver tests and imaging findings and the plan exactly as stated."
      ],
      requiredFields: ["cc", "presentHx", "abdoExam"],
      checklist: ["Alarm features asked (bleeding, weight loss, dysphagia)", "Alcohol use recorded", "Liver and spleen examined", "Endoscopy and liver test results recorded"]
    },
    {
      id: "rheumatology", label: "Rheumatology",
      description: "Joint pain pattern, morning stiffness, extra-articular features and joint examination.",
      promptLines: [
        "This is a RHEUMATOLOGY consultation.",
        "- presentHx: record the joints involved, pattern, morning stiffness in minutes, swelling and extra-articular features (rash, mouth ulcers, eye symptoms), as stated.",
        "- musculoskeletal: record the joint examination as dictated, with tender and swollen joints named by side.",
        "- homeMeds: record DMARDs, steroids and biologics with doses exactly as stated.",
        "- managementPlan: record inflammatory markers, antibody results, disease activity scores and the plan exactly as stated. Never compute a score that was not said."
      ],
      requiredFields: ["cc", "presentHx", "musculoskeletal"],
      checklist: ["Morning stiffness duration recorded", "Tender and swollen joints named", "Extra-articular features asked", "DMARD monitoring results recorded"]
    },
    {
      id: "geriatrics", label: "Geriatrics",
      description: "Function, falls, memory, medicines review and carer support.",
      promptLines: [
        "This is a GERIATRIC consultation.",
        "- presentHx: record falls, memory change, continence, mobility and daily activities, with who gave the history, as stated.",
        "- homeMeds: record every current medicine exactly as stated, including over-the-counter and traditional medicines.",
        "- gait: record the gait and walking aid only as dictated.",
        "- managementPlan: record the frailty or cognition scores, medicines stopped or reviewed, and the carer plan exactly as stated. Never stop or change a medicine that was not said."
      ],
      requiredFields: ["cc", "presentHx", "homeMeds"],
      checklist: ["Falls asked", "Memory and mood screened", "All medicines reviewed", "Carer and home support recorded"]
    },
    {
      id: "palliative", label: "Palliative care",
      description: "Symptom burden, pain, goals of care and family communication.",
      promptLines: [
        "This is a PALLIATIVE CARE consultation.",
        "- presentHx: record each symptom (pain, breathlessness, nausea, constipation, low mood) with its severity as stated.",
        "- painScore: the pain score only if a number out of 10 was stated.",
        "- homeMeds: record opioids and other symptom medicines with doses and breakthrough use exactly as stated.",
        "- managementPlan: record the goals of care, preferred place of care and the family discussion exactly as stated. Never record a resuscitation decision that was not said."
      ],
      requiredFields: ["cc", "presentHx", "managementPlan"],
      checklist: ["Symptoms scored", "Opioid and breakthrough use recorded", "Goals of care discussed", "Family and carer informed"]
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
