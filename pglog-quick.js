/* pglog-quick.js — NMC eLOGBook · 15-to-20-second case entry.
 * ==========================================================================================
 * WHY THIS EXISTS
 * The logbook already captured everything PGMER-2023 asks for, and that was the problem: a resident
 * coming out of theatre at 2 a.m. faced a form with a dozen fields, so the entry was made "later",
 * which in practice means reconstructed from memory at the end of the month. The regulation wants a
 * WEEKLY record (5.2(vi)); a form that takes two minutes does not get one.
 *
 * So this module is the fast path, not a second logbook. It produces a DRAFT in the exact shape
 * pglog-model.normaliseEntry() already validates, hands it to the same store, and it travels the
 * same verification route. Nothing here can write a verified record, skip a supervisor, or invent a
 * number — a quick entry is just a slow entry with better defaults.
 *
 * THE THREE THINGS THAT MAKE IT FAST
 *   1. TEMPLATES. Per specialty, the procedures and presentations a resident in that department
 *      actually logs, so the first field is one tap instead of typing. Ranked by how often THIS
 *      resident picked them (recents beat the catalogue), then alphabetically.
 *   2. DEFAULTS THAT ARE NOT GUESSES. Date = today, setting/supervisor/rotation = the last ones
 *      used (the store already keeps these in prefs), role = unset. Role is deliberately NOT
 *      defaulted: "assisted or done independently" is the claim the examiner relies on and 9.2(c)
 *      penalises, so it is always an explicit tap.
 *   3. DICTATION. parseDictation() turns one spoken sentence into the same fields. It is a
 *      vocabulary matcher, not an AI: every field it fills is traceable to words that were said,
 *      and it returns `heard` so the UI can show what it matched before anything is saved.
 *
 * THE TEMPLATE LISTS ARE A CONVENIENCE, NOT A CURRICULUM. Requirements and counts still come from
 * pglog/curricula/*.json. A template entry is a suggested label for a free-text field: the resident
 * can type anything, and nothing here decides whether a requirement is met.
 *
 * Pure. No DOM, no fetch, no storage. window.SMD_PGLOG_QUICK + module.exports.
 * ========================================================================================== */
(function () {
  "use strict";

  /* ── specialty templates ──────────────────────────────────────────────────────────────────
   * Keyed by the `packId` used in pglog/specialties.json (so a specialty with no pack of its own
   * falls back through FALLBACK_BY_DEGREE to a sensible general list rather than to nothing).
   * `p` = procedures/operations, `c` = clinical presentations and diagnoses, `a` = academic items.
   * Kept to what is commonly logged in an Indian PG programme; a resident types anything else. */
  var T = {
    "general-surgery": {
      p: ["Appendicectomy", "Inguinal hernia repair (open)", "Inguinal hernia repair (laparoscopic)",
        "Laparoscopic cholecystectomy", "Open cholecystectomy", "Exploratory laparotomy",
        "Perforation closure", "Haemorrhoidectomy", "Fissurectomy", "Fistulectomy",
        "Excision of lump / lipoma", "Modified radical mastectomy", "Thyroidectomy",
        "Incision and drainage of abscess", "Wound debridement", "Skin grafting",
        "Intercostal drainage", "Central line insertion", "Tracheostomy", "Colostomy / ileostomy",
        "Hydrocelectomy", "Circumcision", "Diagnostic laparoscopy", "Split-thickness graft harvest"],
      c: ["Acute appendicitis", "Acute cholecystitis", "Obstructive jaundice", "Intestinal obstruction",
        "Hollow viscus perforation", "Blunt abdominal trauma", "Penetrating abdominal trauma",
        "Breast lump for evaluation", "Thyroid swelling", "Diabetic foot", "Cellulitis / abscess",
        "Burns", "Haemorrhoids", "Varicose veins", "Carcinoma stomach", "Carcinoma colon",
        "Acute pancreatitis", "Peripheral vascular disease"]
    },
    "general-medicine": {
      p: ["Lumbar puncture", "Pleural tap / thoracocentesis", "Ascitic tap / paracentesis",
        "Central line insertion", "Arterial blood gas sampling", "Ryle's tube insertion",
        "Urinary catheterisation", "Bone marrow aspiration", "Liver biopsy", "Pleural biopsy",
        "Endotracheal intubation", "Defibrillation / cardioversion", "Temporary pacing",
        "ECG interpretation", "Bedside echocardiography", "Bedside ultrasound (POCUS)"],
      c: ["Diabetic ketoacidosis", "Acute coronary syndrome", "Heart failure", "Stroke",
        "Community acquired pneumonia", "COPD exacerbation", "Bronchial asthma", "Tuberculosis",
        "Sepsis / septic shock", "Acute kidney injury", "Chronic kidney disease", "Cirrhosis with decompensation",
        "Upper GI bleed", "Dengue", "Malaria", "Enteric fever", "Snake bite", "Organophosphate poisoning",
        "Hypertensive emergency", "Seizure disorder", "Thyroid disorder", "Anaemia for evaluation",
        "Pyrexia of unknown origin", "HIV with opportunistic infection"]
    },
    "critical-care": {
      p: ["Endotracheal intubation", "Central venous catheterisation", "Arterial line insertion",
        "Mechanical ventilation initiation", "Ventilator weaning / SBT", "Percutaneous tracheostomy",
        "Intercostal drainage", "Bronchoscopy / bronchial toilet", "Prone positioning",
        "Vasopressor titration", "Renal replacement therapy initiation", "Bedside echocardiography",
        "POCUS (lung / abdomen)", "Defibrillation / cardioversion", "Advanced cardiac life support",
        "Nasogastric / feeding tube placement", "Targeted temperature management"],
      c: ["Septic shock", "ARDS", "Acute respiratory failure", "Cardiogenic shock",
        "Severe traumatic brain injury", "Polytrauma", "Post-operative critical care",
        "Diabetic ketoacidosis", "Acute kidney injury on CRRT", "Acute liver failure",
        "Status epilepticus", "Poisoning / overdose", "Post-cardiac-arrest care",
        "Ventilator-associated pneumonia", "Delirium in ICU", "Brain-stem death evaluation"]
    },
    "dermatology": {
      p: ["Skin biopsy (punch)", "Skin biopsy (excisional)", "Cryotherapy",
        "Electrocautery / radiofrequency ablation", "Intralesional injection", "Chemical peel",
        "Dermatoscopy", "Patch testing", "Slit-skin smear", "KOH mount", "Tzanck smear",
        "Wood's lamp examination", "Comedone extraction", "Nail biopsy / avulsion",
        "Platelet-rich plasma", "Microneedling", "Laser therapy", "Phototherapy (NB-UVB)"],
      c: ["Psoriasis", "Atopic dermatitis", "Contact dermatitis", "Acne vulgaris", "Vitiligo",
        "Melasma", "Lichen planus", "Pemphigus vulgaris", "Bullous pemphigoid", "Leprosy",
        "Dermatophytosis", "Scabies", "Urticaria", "Alopecia areata", "Androgenetic alopecia",
        "Drug reaction (SJS / TEN)", "Cutaneous tuberculosis", "STI evaluation",
        "Cutaneous malignancy", "Connective tissue disease with skin involvement"]
    },
    "endocrinology": {
      p: ["Fine-needle aspiration of thyroid", "Thyroid ultrasound", "Insulin initiation / titration",
        "Continuous glucose monitoring interpretation", "Insulin pump initiation",
        "Dynamic endocrine testing (GTT)", "Dexamethasone suppression test", "ACTH stimulation test",
        "Water deprivation test", "GH stimulation test", "Bone densitometry interpretation",
        "Diabetic foot assessment", "Fundus examination for retinopathy"],
      c: ["Type 1 diabetes mellitus", "Type 2 diabetes mellitus", "Diabetic ketoacidosis",
        "Hyperosmolar hyperglycaemic state", "Hypoglycaemia for evaluation", "Hypothyroidism",
        "Thyrotoxicosis", "Thyroid nodule", "Cushing syndrome", "Addison disease", "Acromegaly",
        "Prolactinoma", "Hypogonadism", "Polycystic ovary syndrome", "Osteoporosis",
        "Primary hyperparathyroidism", "Short stature", "Obesity / metabolic syndrome",
        "Disorders of sexual development", "Diabetes in pregnancy"]
    },
    "gastroenterology": {
      p: ["Upper GI endoscopy (diagnostic)", "Variceal band ligation", "Sclerotherapy",
        "Colonoscopy (diagnostic)", "Polypectomy", "ERCP", "Biliary stenting",
        "Endoscopic ultrasound", "Oesophageal dilatation", "PEG tube placement",
        "Liver biopsy", "Ascitic tap / paracentesis", "Large-volume paracentesis",
        "Capsule endoscopy", "Manometry / pH study", "Haemostasis for GI bleed",
        "Foreign body removal", "Transient elastography (FibroScan)"],
      c: ["Cirrhosis with portal hypertension", "Upper GI bleed", "Lower GI bleed",
        "Acute pancreatitis", "Chronic pancreatitis", "Inflammatory bowel disease",
        "Coeliac disease", "GERD", "Peptic ulcer disease", "Irritable bowel syndrome",
        "Acute viral hepatitis", "Chronic hepatitis B", "Chronic hepatitis C",
        "Non-alcoholic fatty liver disease", "Alcoholic liver disease", "Acute liver failure",
        "Obstructive jaundice", "Hepatocellular carcinoma", "Achalasia cardia", "Chronic diarrhoea"]
    },
    "paediatrics": {
      p: ["Neonatal resuscitation", "Umbilical vessel catheterisation", "Lumbar puncture (paediatric)",
        "Exchange transfusion", "Surfactant administration", "CPAP initiation",
        "Peripheral IV / intraosseous access", "Ryle's tube insertion", "Bladder catheterisation",
        "Phototherapy initiation", "Growth monitoring / anthropometry", "Developmental assessment",
        "Immunisation counselling", "Nebulisation and inhaler technique"],
      c: ["Neonatal sepsis", "Neonatal jaundice", "Respiratory distress of the newborn",
        "Birth asphyxia", "Prematurity / low birth weight", "Severe acute malnutrition",
        "Bronchiolitis", "Pneumonia", "Acute gastroenteritis with dehydration", "Febrile seizure",
        "Nephrotic syndrome", "Acute glomerulonephritis", "Congenital heart disease",
        "Thalassemia", "Childhood tuberculosis", "Dengue in children", "Seizure disorder",
        "Developmental delay", "Type 1 diabetes in children", "Rheumatic heart disease"]
    },
    "obstetrics-gynaecology": {
      p: ["Normal vaginal delivery", "Lower segment caesarean section", "Instrumental delivery",
        "Episiotomy and repair", "Manual removal of placenta", "Dilatation and curettage",
        "Medical termination of pregnancy", "Cervical cerclage", "Hysterectomy (abdominal)",
        "Hysterectomy (vaginal)", "Laparoscopic sterilisation", "Ovarian cystectomy",
        "Myomectomy", "Hysteroscopy", "Colposcopy", "Pap smear", "IUCD insertion",
        "Obstetric ultrasound", "Non-stress test interpretation"],
      c: ["Normal antenatal care", "Pre-eclampsia", "Eclampsia", "Gestational diabetes",
        "Antepartum haemorrhage", "Postpartum haemorrhage", "Preterm labour", "Anaemia in pregnancy",
        "Ectopic pregnancy", "Abortion / miscarriage", "Abnormal uterine bleeding", "Fibroid uterus",
        "Polycystic ovary syndrome", "Infertility", "Pelvic inflammatory disease",
        "Carcinoma cervix", "Ovarian mass", "Menopausal symptoms", "Prolapse uterus"]
    },
    orthopaedics: {
      p: ["Closed reduction and casting", "Open reduction and internal fixation",
        "Intramedullary nailing", "External fixator application", "K-wire fixation",
        "Hemiarthroplasty", "Total hip replacement", "Total knee replacement",
        "Arthroscopy (knee)", "Debridement for osteomyelitis", "Tendon repair",
        "Skeletal traction", "Spinal fixation", "Amputation", "Carpal tunnel release",
        "Joint aspiration / injection", "Fasciotomy"],
      c: ["Fracture shaft of femur", "Intertrochanteric fracture", "Neck of femur fracture",
        "Distal radius fracture", "Supracondylar humerus fracture", "Ankle fracture",
        "Spine injury", "Polytrauma", "Osteoarthritis knee", "Rheumatoid arthritis",
        "Osteomyelitis", "Septic arthritis", "Bone tumour", "Tuberculosis of spine",
        "Compartment syndrome", "Club foot", "Developmental dysplasia of hip", "Low back pain"]
    },
    anaesthesiology: {
      p: ["General anaesthesia (induction and maintenance)", "Endotracheal intubation",
        "Supraglottic airway insertion", "Spinal anaesthesia", "Epidural anaesthesia",
        "Combined spinal-epidural", "Brachial plexus block", "Ultrasound-guided nerve block",
        "Central venous catheterisation", "Arterial line insertion", "Rapid sequence induction",
        "Paediatric anaesthesia", "Obstetric anaesthesia", "Difficult airway management",
        "Post-operative pain management", "Monitored anaesthesia care", "One-lung ventilation"],
      c: ["Pre-anaesthetic evaluation", "ASA III/IV patient for surgery", "Difficult airway",
        "Anaphylaxis under anaesthesia", "Perioperative hypotension", "Malignant hyperthermia",
        "Post-operative nausea and vomiting", "Chronic pain referral", "Obstetric emergency",
        "Trauma anaesthesia", "Day-care surgery", "Critically ill for emergency surgery"]
    },
    "emergency-medicine": {
      p: ["Endotracheal intubation", "Rapid sequence intubation", "Defibrillation / cardioversion",
        "Advanced cardiac life support", "Central line insertion", "Intraosseous access",
        "Intercostal drainage", "Needle thoracostomy", "FAST scan", "Pericardiocentesis",
        "Wound suturing", "Fracture reduction and splinting", "Procedural sedation",
        "Lumbar puncture", "Gastric lavage", "Cricothyroidotomy"],
      c: ["Cardiac arrest", "Polytrauma", "Head injury", "Acute coronary syndrome", "Stroke (thrombolysis window)",
        "Acute breathlessness", "Anaphylaxis", "Poisoning / overdose", "Snake bite",
        "Status epilepticus", "Septic shock", "Gastrointestinal bleed", "Acute abdomen",
        "Burns", "Drowning", "Heat stroke", "Psychiatric emergency", "Mass casualty triage"]
    },
    ent: {
      p: ["Tonsillectomy", "Adenoidectomy", "Myringotomy with grommet", "Tympanoplasty",
        "Mastoidectomy", "Septoplasty", "Functional endoscopic sinus surgery", "Turbinate reduction",
        "Direct laryngoscopy", "Microlaryngeal surgery", "Tracheostomy", "Foreign body removal (ear / nose / throat)",
        "Nasal packing for epistaxis", "Diagnostic nasal endoscopy", "Ear syringing", "Thyroglossal cyst excision"],
      c: ["Chronic suppurative otitis media", "Otitis media with effusion", "Hearing loss for evaluation",
        "Vertigo", "Allergic rhinitis", "Chronic rhinosinusitis", "Nasal polyposis", "Epistaxis",
        "Deviated nasal septum", "Chronic tonsillitis", "Obstructive sleep apnoea", "Hoarseness of voice",
        "Head and neck malignancy", "Neck swelling", "Foreign body aerodigestive tract"]
    },
    ophthalmology: {
      p: ["Cataract surgery (phacoemulsification)", "Cataract surgery (SICS)", "Pterygium excision",
        "Trabeculectomy", "Intravitreal injection", "Laser photocoagulation", "YAG capsulotomy",
        "Chalazion incision and curettage", "Dacryocystorhinostomy", "Squint surgery",
        "Slit-lamp examination", "Indirect ophthalmoscopy", "Applanation tonometry",
        "Refraction", "Corneal scraping", "Foreign body removal (cornea)"],
      c: ["Cataract", "Glaucoma", "Diabetic retinopathy", "Hypertensive retinopathy",
        "Age-related macular degeneration", "Retinal detachment", "Corneal ulcer", "Conjunctivitis",
        "Uveitis", "Refractive error", "Squint", "Ocular trauma", "Optic neuritis",
        "Dry eye disease", "Retinopathy of prematurity"]
    },
    psychiatry: {
      p: ["Mental status examination", "Structured diagnostic interview", "Electroconvulsive therapy",
        "Cognitive behavioural therapy session", "Supportive psychotherapy", "Family therapy session",
        "Psychoeducation session", "Clozapine initiation and monitoring", "Lithium monitoring",
        "Detoxification supervision", "Suicide risk assessment", "Capacity assessment",
        "Neuropsychological testing", "Rating scale administration (HAM-D / YMRS / PANSS)"],
      c: ["Major depressive disorder", "Bipolar affective disorder", "Schizophrenia",
        "Acute and transient psychotic disorder", "Generalised anxiety disorder", "Panic disorder",
        "Obsessive compulsive disorder", "Post-traumatic stress disorder", "Alcohol use disorder",
        "Opioid use disorder", "Delirium", "Dementia", "Somatoform disorder",
        "Childhood behavioural disorder", "Deliberate self-harm", "Sleep disorder"]
    },
    radiodiagnosis: {
      p: ["Ultrasound abdomen", "Obstetric ultrasound", "Doppler study", "CT reporting",
        "MRI reporting", "Chest radiograph reporting", "Barium study", "Intravenous urography",
        "Mammography reporting", "Ultrasound-guided FNAC", "Ultrasound-guided biopsy",
        "Ultrasound-guided drainage", "CT-guided biopsy", "Fluoroscopy procedure",
        "Interventional angiography", "Contrast reaction management"],
      c: ["Acute abdomen imaging", "Trauma imaging (polytrauma)", "Stroke imaging",
        "Chest infection imaging", "Tuberculosis imaging", "Oncology staging", "Obstetric anomaly scan",
        "Hepatobiliary imaging", "Musculoskeletal imaging", "Neuroimaging for seizures",
        "Renal imaging", "Paediatric imaging"]
    },
    pathology: {
      p: ["Gross specimen examination", "Frozen section", "Histopathology reporting",
        "Fine-needle aspiration cytology", "Cytology reporting (fluid)", "Pap smear reporting",
        "Bone marrow aspiration and reporting", "Peripheral smear examination",
        "Immunohistochemistry interpretation", "Special stains", "Autopsy / post-mortem",
        "Blood bank cross-match", "Transfusion reaction workup", "Coagulation profile interpretation"],
      c: ["Malignancy reporting", "Lymphoma / leukaemia workup", "Anaemia workup",
        "Tuberculosis on histology", "Renal biopsy reporting", "Liver biopsy reporting",
        "Thyroid cytology", "Breast lesion reporting", "Gastrointestinal biopsy",
        "Placental examination", "Quality control and internal audit"]
    },
    "respiratory-medicine": {
      p: ["Flexible bronchoscopy", "Bronchoalveolar lavage", "Transbronchial lung biopsy",
        "EBUS-guided sampling", "Pleural tap / thoracocentesis", "Intercostal drainage",
        "Pleural biopsy", "Medical thoracoscopy", "Spirometry interpretation",
        "Diffusion study interpretation", "Non-invasive ventilation initiation",
        "Polysomnography interpretation", "Six-minute walk test", "Allergy skin testing"],
      c: ["Bronchial asthma", "COPD", "Pulmonary tuberculosis", "Drug-resistant tuberculosis",
        "Community acquired pneumonia", "Interstitial lung disease", "Bronchiectasis",
        "Pleural effusion", "Pneumothorax", "Lung cancer", "Obstructive sleep apnoea",
        "Pulmonary embolism", "Occupational lung disease", "Haemoptysis for evaluation"]
    },
    "community-medicine": {
      p: ["Field visit / household survey", "Immunisation session", "Antenatal clinic in the field",
        "School health check-up", "Outbreak investigation", "Epidemiological data analysis",
        "Health education session", "Nutritional assessment", "Water sanitation inspection",
        "Family study", "Vital statistics compilation", "Programme evaluation visit"],
      c: ["National health programme review", "Communicable disease outbreak", "Malnutrition in the community",
        "Maternal and child health", "Immunisation coverage evaluation", "Vector-borne disease control",
        "Tuberculosis programme (NTEP)", "Non-communicable disease screening", "Occupational health",
        "Disaster preparedness", "Health economics / costing study"]
    },
    "generic-pg": {
      p: ["Ward procedure", "Outpatient procedure", "Bedside procedure", "Emergency procedure",
        "Diagnostic procedure", "Therapeutic procedure", "Assisted in theatre"],
      c: ["Outpatient consultation", "Inpatient admission", "Emergency presentation",
        "Follow-up review", "Referral consultation", "Discharge and counselling"]
    }
  };

  // Academic items are the same everywhere: PGMER-2023 5.2(x) names them.
  var ACADEMIC = ["Seminar", "Journal club", "Case presentation", "Clinical meeting",
    "Grand round", "Mortality / morbidity meeting", "Undergraduate teaching", "Skills workshop",
    "CME / conference", "Research methodology session", "Thesis presentation"];

  // A specialty with no list of its own borrows the nearest one. Degree is the last resort.
  var PACK_ALIAS = {
    "md-general-medicine": "general-medicine", "md-paediatrics": "paediatrics",
    "md-dermatology-venereology-and-leprosy": "dermatology", "md-emergency-medicine": "emergency-medicine",
    "md-anaesthesiology": "anaesthesiology", "md-radio-diagnosis": "radiodiagnosis",
    "md-respiratory-medicine": "respiratory-medicine", "md-community-medicine": "community-medicine",
    "md-pathology": "pathology", "md-psychiatry": "psychiatry",
    "ms-general-surgery": "general-surgery", "ms-orthopaedics": "orthopaedics",
    "ms-obstetrics-and-gynaecology": "obstetrics-gynaecology", "ms-ophthalmology": "ophthalmology",
    "ms-ent": "ent", "ms-oto-rhino-laryngology": "ent",
    "dm-critical-care-medicine": "critical-care", "dm-endocrinology": "endocrinology",
    "dm-medical-gastroenterology": "gastroenterology", "dm-hepatology": "gastroenterology",
    "dm-neonatology": "paediatrics", "dm-infectious-disease": "general-medicine",
    "dm-pulmonary-medicine": "respiratory-medicine",
    "mch-general-surgery": "general-surgery", "mch-surgical-gastroenterology": "gastroenterology"
  };

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  /* Resolve a specialty (id, packId or plain name) to a template key. Never throws, never returns
   * null: an unknown specialty gets the generic list, which is still faster than an empty field. */
  function packFor(specialty) {
    var s = slug(specialty);
    if (!s) return "generic-pg";
    if (T[s]) return s;
    if (PACK_ALIAS[s]) return PACK_ALIAS[s];
    // "md-general-medicine" -> "general-medicine"; "ms-general-surgery" -> "general-surgery"
    var stripped = s.replace(/^(md|ms|dm|mch|dnb|diploma)-/, "");
    if (T[stripped]) return stripped;
    if (PACK_ALIAS[stripped]) return PACK_ALIAS[stripped];
    // last chance: a contained name ("critical care medicine" -> critical-care)
    for (var k in T) {
      if (Object.prototype.hasOwnProperty.call(T, k) && (s.indexOf(k) >= 0 || k.indexOf(stripped) >= 0)) return k;
    }
    return "generic-pg";
  }

  function templatesFor(specialty) {
    var key = packFor(specialty), t = T[key] || T["generic-pg"];
    return {
      packId: key,
      procedure: (t.p || []).slice(),
      clinical: (t.c || []).slice(),
      academic: ACADEMIC.slice()
    };
  }

  /* The picker list for one kind: this resident's recents first (most used, then most recent), then
   * the rest of the catalogue alphabetically. `recents` is [{ title, n, at }] kept by the caller. */
  function suggestions(specialty, kind, recents, limit) {
    var t = templatesFor(specialty);
    var base = kind === "procedure" ? t.procedure : kind === "academic" ? t.academic : t.clinical;
    var seen = {}, out = [];
    (recents || []).slice()
      .sort(function (a, b) { return (b.n || 0) - (a.n || 0) || (b.at || 0) - (a.at || 0); })
      .forEach(function (r) {
        var title = String((r && r.title) || "").trim(); if (!title) return;
        var k = norm(title); if (seen[k]) return; seen[k] = 1;
        out.push({ title: title, recent: true });
      });
    base.slice().sort(function (a, b) { return a.localeCompare(b); }).forEach(function (title) {
      var k = norm(title); if (seen[k]) return; seen[k] = 1;
      out.push({ title: title, recent: false });
    });
    return (limit && limit > 0) ? out.slice(0, limit) : out;
  }

  /* Type-ahead over the same list. Prefix matches rank above contained matches; a recent outranks a
   * catalogue item at the same match quality. */
  function search(specialty, kind, query, recents, limit) {
    var q = norm(query);
    var all = suggestions(specialty, kind, recents, 0);
    if (!q) return (limit ? all.slice(0, limit) : all);
    var scored = [];
    all.forEach(function (it) {
      var n = norm(it.title), at = n.indexOf(q);
      if (at < 0) {
        // word-initials: "lscs" should find "Lower segment caesarean section"
        var initials = n.split(/[^a-z0-9]+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join("");
        if (initials.indexOf(q) < 0) return;
        scored.push({ it: it, score: 40 + (it.recent ? 5 : 0) });
        return;
      }
      scored.push({ it: it, score: (at === 0 ? 100 : 70 - Math.min(at, 30)) + (it.recent ? 5 : 0) });
    });
    scored.sort(function (a, b) { return b.score - a.score || a.it.title.localeCompare(b.it.title); });
    var out = scored.map(function (s) { return s.it; });
    return (limit && limit > 0) ? out.slice(0, limit) : out;
  }

  /* ── dictation ────────────────────────────────────────────────────────────────────────────
   * One spoken sentence -> the same fields the form collects. A VOCABULARY MATCHER, not a model:
   * each field is filled only when a listed phrase was actually said, and `heard` reports which
   * phrase produced which field so the UI can show the resident what it understood BEFORE saving.
   * Anything it cannot place stays in `remainder` and becomes the note, never a silent drop. */
  var ROLE_CUES = [
    ["performed_independent", ["independently", "on my own", "by myself", "solo", "i performed", "i did the whole", "unsupervised", "primary surgeon", "as primary"]],
    ["performed_supervised", ["under supervision", "supervised", "with supervision", "under guidance", "guided by", "under the consultant", "performed under"]],
    ["assisted", ["assisted", "i assisted", "as assistant", "second assistant", "first assistant", "helped with"]],
    ["observed", ["observed", "i observed", "watched", "as an observer", "only observed"]]
  ];
  var SETTING_CUES = [
    ["emergency", ["emergency", "casualty", "er", "a and e", "trauma bay", "after hours"]],
    ["ipd", ["ward", "inpatient", "in patient", "ipd", "admitted", "icu", "intensive care", "theatre", "operation theatre", "ot"]],
    ["opd", ["opd", "outpatient", "out patient", "clinic", "consultation"]]
  ];
  var KIND_CUES = [
    ["procedure", ["procedure", "operation", "operated", "surgery", "did a", "performed", "assisted in", "scope", "scopy", "ectomy", "otomy", "ostomy", "plasty", "biopsy", "intubation", "catheter", "block", "tap", "drain"]],
    ["academic", ["seminar", "journal club", "presentation", "presented", "teaching", "lecture", "workshop", "cme", "conference", "grand round", "case presentation"]],
    ["clinical", ["saw", "admitted", "reviewed", "examined", "case of", "patient with", "follow up", "consultation"]]
  ];
  // Said when there was NO complication. Checked before the positive cues so "no complications"
  // can never be read as a complication.
  var NEG_COMPLICATION = ["no complication", "no complications", "uneventful", "without complication",
    "no intra operative complication", "no intraoperative complication", "nil complications", "no adverse"];
  var COMPLICATION_CUES = ["complication", "complications", "bleeding", "haemorrhage", "hemorrhage",
    "infection", "wound infection", "sepsis", "leak", "perforation", "injury", "conversion to open",
    "re exploration", "reintubation", "arrest", "death", "mortality", "hypotension", "desaturation",
    "aspiration", "dehiscence", "seroma", "haematoma", "hematoma"];

  function firstCue(hay, cues) {
    for (var i = 0; i < cues.length; i++) { if (hay.indexOf(cues[i]) >= 0) return cues[i]; }
    return null;
  }
  // " a b c " so a cue matches on word boundaries rather than inside another word.
  function padded(s) { return " " + norm(s).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " "; }
  function hasPhrase(hay, phrase) { return hay.indexOf(" " + padded(phrase).trim() + " ") >= 0; }

  function parseDictation(text, opts) {
    opts = opts || {};
    var raw = String(text == null ? "" : text).trim();
    var hay = padded(raw);
    var out = { title: "", kind: "", role: "", setting: "", complications: [], notes: "", heard: [], remainder: raw };
    if (!raw) return out;

    var i, j;
    for (i = 0; i < ROLE_CUES.length && !out.role; i++) {
      for (j = 0; j < ROLE_CUES[i][1].length; j++) {
        if (hasPhrase(hay, ROLE_CUES[i][1][j])) { out.role = ROLE_CUES[i][0]; out.heard.push({ field: "role", phrase: ROLE_CUES[i][1][j] }); break; }
      }
    }
    for (i = 0; i < SETTING_CUES.length && !out.setting; i++) {
      for (j = 0; j < SETTING_CUES[i][1].length; j++) {
        if (hasPhrase(hay, SETTING_CUES[i][1][j])) { out.setting = SETTING_CUES[i][0]; out.heard.push({ field: "setting", phrase: SETTING_CUES[i][1][j] }); break; }
      }
    }

    // Title: the best template match anywhere in the sentence wins; otherwise the longest run of
    // words that is not a cue phrase, so an unlisted procedure still lands in the field.
    var cand = search(opts.specialty, "procedure", "", opts.recents, 0)
      .concat(search(opts.specialty, "clinical", "", opts.recents, 0))
      .concat(ACADEMIC.map(function (a) { return { title: a, recent: false }; }));
    var best = null;
    cand.forEach(function (c) {
      var p = padded(c.title);
      if (p.trim() && hay.indexOf(p.replace(/^\s|\s$/g, " ")) >= 0) {
        if (!best || c.title.length > best.title.length) best = c;
      }
    });
    if (best) { out.title = best.title; out.heard.push({ field: "title", phrase: best.title }); }

    for (i = 0; i < KIND_CUES.length && !out.kind; i++) {
      for (j = 0; j < KIND_CUES[i][1].length; j++) {
        if (hay.indexOf(" " + KIND_CUES[i][1][j]) >= 0 || hay.indexOf(KIND_CUES[i][1][j] + " ") >= 0) {
          out.kind = KIND_CUES[i][0]; out.heard.push({ field: "kind", phrase: KIND_CUES[i][1][j] }); break;
        }
      }
    }
    // A matched title from the procedure list settles the kind even if no verb was said.
    if (best && !out.kind) {
      var t = templatesFor(opts.specialty);
      if (t.procedure.indexOf(best.title) >= 0) out.kind = "procedure";
      else if (t.academic.indexOf(best.title) >= 0) out.kind = "academic";
      else out.kind = "clinical";
    }
    if (!out.kind) out.kind = "clinical";

    var negated = !!firstCue(hay, NEG_COMPLICATION.map(function (s) { return padded(s).trim(); }));
    if (negated) {
      out.heard.push({ field: "complications", phrase: "none stated" });
    } else {
      COMPLICATION_CUES.forEach(function (c) {
        if (hasPhrase(hay, c) && out.complications.indexOf(c) < 0) out.complications.push(c);
      });
      if (out.complications.length) out.heard.push({ field: "complications", phrase: out.complications.join(", ") });
    }

    // Whatever is left after removing the phrases we consumed becomes the note.
    var rest = raw;
    out.heard.forEach(function (h) {
      if (!h.phrase || h.phrase === "none stated") return;
      try { rest = rest.replace(new RegExp(h.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " "); } catch (e) {}
    });
    rest = rest.replace(/\s{2,}/g, " ").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "");
    out.remainder = rest;
    out.notes = rest;
    if (!out.title && rest) out.title = rest.split(/[,.;]/)[0].trim().slice(0, 160);
    return out;
  }

  /* Build the DRAFT. Shape matches pglog-model.normaliseEntry() exactly; it is validated and
   * submitted through the ordinary store path. Role is never defaulted — see the header. */
  function quickDraft(pick, ctx) {
    pick = pick || {}; ctx = ctx || {};
    var prefs = ctx.prefs || {};
    var kind = pick.kind || prefs.lastKind || "clinical";
    var d = {
      // The model's normaliser requires an id on every entry, and the store's localId() is what the
      // long form uses. A quick draft is an ordinary draft; it carries an ordinary local id.
      id: pick.id || ctx.localId || "",
      kind: kind,
      occurredAt: pick.occurredAt || ctx.today || "",
      residentId: ctx.residentId || "",
      programmeId: ctx.programmeId || "",
      rotationId: pick.rotationId || prefs.lastRotationId || "",
      departmentId: pick.departmentId || prefs.lastDepartmentId || "",
      supervisor: pick.supervisor || prefs.lastSupervisor || "",
      notes: pick.notes || ""
      /* Deliberately no `source: "quick"`. The entry schema in pglog-model.js is the regulated
       * record; adding a field to it so the UI can say how the entry was typed would change what
       * the server stores and what an examiner's document contains, for no clinical gain. A quick
       * entry is indistinguishable from a long one on purpose — it IS one. */
    };
    /* FIELD NAMES ARE THE MODEL'S, NOT THIS MODULE'S. pglog-model validates a procedure on
     * procedureId/procedureText, a clinical entry on title, and an academic one on topic/title.
     * A quick entry writes those exact fields, which is what makes it the same record as a long
     * one rather than a parallel shape that happens to look similar. */
    var title = pick.title || "";
    if (kind === "procedure") {
      d.procedureText = title;
      if (pick.procedureId) d.procedureId = pick.procedureId;
      d.setting = pick.setting || "ot";
      d.role = pick.role || "";
      d.complications = pick.complications || [];
      if (pick.complicationNotes) d.complicationNotes = pick.complicationNotes;
    } else if (kind === "academic") {
      d.title = title;
      d.topic = title;
      d.academicType = pick.academicType || "seminar";
      d.role = pick.role || "presented";
    } else {
      // The examiner reads the title; the diagnosis field is what the analytics group on.
      d.title = title;
      d.diagnosis = title;
      d.setting = pick.setting || prefs.lastSetting || "opd";
      d.role = pick.role || "";
    }
    return d;
  }

  /* The fields a quick draft still needs before Submit will be allowed. The authority is
   * pglog-model.validateEntry(); this is the same question asked early so the UI can show a chip
   * rather than a validation error after the fact. */
  function missingFor(draft, ctx) {
    draft = draft || {}; ctx = ctx || {};
    var need = [];
    var title = draft.procedureText || draft.procedureId || draft.diagnosis || draft.title || "";
    if (!String(title).trim()) need.push("title");
    if (!draft.occurredAt) need.push("occurredAt");
    if (draft.kind === "procedure" || draft.kind === "clinical") { if (!draft.role) need.push("role"); }
    if (draft.kind === "procedure" && ctx.requiresSupervisor && !String(draft.supervisor || "").trim()) need.push("supervisor");
    return need;
  }

  var API = {
    templatesFor: templatesFor, packFor: packFor, suggestions: suggestions, search: search,
    parseDictation: parseDictation, quickDraft: quickDraft, missingFor: missingFor,
    TEMPLATES: T, ACADEMIC: ACADEMIC, PACK_ALIAS: PACK_ALIAS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_PGLOG_QUICK = API;
})();
