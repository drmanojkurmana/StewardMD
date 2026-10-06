// Narkē (Anaesthesia) question-bank taxonomy for tools/tokos-build-mcq.mjs --host narke. Dev-only, never shipped.
// Same scoring model as the Tokós tables there (see that file): topic_name table first, then keyword scoring, then the fallback.
// Subtopic ids are fixed by the Narkē brief ("Bank topics"). `general` is the fallback and must stay small.
export const NARKE = {
  subject: "Anaesthesia",
  outSub: "narke",
  name: "Narkē",
  fallback: "general",
  subtopics: [
    { id: "airway", group: "practice", title: { en: "Airway management", hi: "वायुमार्ग प्रबंधन" } },
    { id: "iv-agents", group: "agents", title: { en: "Intravenous anaesthetic agents", hi: "अंतःशिरा निश्चेतक औषधियाँ" } },
    { id: "inhalational", group: "agents", title: { en: "Inhalational anaesthetic agents", hi: "श्वसन द्वारा दी जाने वाली निश्चेतक औषधियाँ" } },
    { id: "nmb", group: "agents", title: { en: "Neuromuscular blockers and reversal", hi: "न्यूरोमस्कुलर ब्लॉकर और उनका प्रतिकार" } },
    { id: "local-regional", group: "agents", title: { en: "Local and regional anaesthesia", hi: "स्थानीय और क्षेत्रीय निश्चेतना" } },
    { id: "monitoring-equipment", group: "practice", title: { en: "Monitoring and anaesthesia equipment", hi: "निगरानी और निश्चेतना उपकरण" } },
    { id: "preop", group: "practice", title: { en: "Pre-anaesthetic evaluation and premedication", hi: "निश्चेतना-पूर्व मूल्यांकन और पूर्व-औषधि" } },
    { id: "fluids-blood", group: "practice", title: { en: "Fluids, blood and electrolytes", hi: "द्रव, रक्त और विद्युत-अपघट्य" } },
    { id: "pain", group: "critical", title: { en: "Pain and analgesia", hi: "दर्द और पीड़ाहरण" } },
    { id: "icu-ventilation", group: "critical", title: { en: "ICU and mechanical ventilation", hi: "आईसीयू और यांत्रिक वेंटिलेशन" } },
    { id: "cpr", group: "critical", title: { en: "Resuscitation and emergencies", hi: "पुनर्जीवन और आपातकाल" } },
    { id: "special-populations", group: "practice", title: { en: "Special populations and surgeries", hi: "विशेष रोगी और शल्यक्रियाएँ" } },
    { id: "basic-science", group: "science", title: { en: "Physics, physiology and pharmacology", hi: "भौतिकी, शरीरक्रिया और औषधि-विज्ञान" } },
    { id: "general", group: "general", title: { en: "General anaesthesia and miscellaneous", hi: "सामान्य निश्चेतना और विविध" } },
  ],
  // MedMCQA topic_name (lower-cased). First match wins. Exam labels and generic names fall through to the keywords.
  topicTable: [
    ["nmb", /neuromuscular|muscle relax|depolari[sz]ing|nmj/],
    ["iv-agents", /intravenous an/],
    ["inhalational", /inhalational/],
    ["airway", /^airway/],
    ["local-regional", /regional|neuraxial|spinal, epidural|nerve block|local an/],
    ["preop", /pre ?-?an(a)?esthetic|preoperative/],
    ["monitoring-equipment", /equipment|anesthesia machine|breathing system|anesthesia circuit|monitoring/],
    ["icu-ventilation", /modes of ventilation|mechanical ventilation/],
    ["cpr", /cardiopulmonary cerebral/],
    ["fluids-blood", /fluids/],
    ["special-populations", /special situations|anesthesia for|pediatric an|geriatric an|obstetric an/],
    ["basic-science", /fundamental concepts/],
  ],
  // Score per subtopic: 3 per stem hit, 2 per key-option hit, 2 per topic_name hit, +1 per explanation hit (max 3); strong x2, weak x0.5.
  // Ties go to the earlier subtopic above. Nothing scored -> `general`.
  keywords: {
    "airway": {
      strong: ["airway", "intubat", "laryngoscop", "\\blma\\b", "laryngeal mask", "i-?gel", "endotracheal", "\\bett\\b", "tracheostomy", "cricothyr", "mallampati", "cormack", "\\bcico\\b", "bougie", "fibreoptic", "fiberoptic", "mask ventilation", "oropharyngeal", "nasopharyngeal", "laryngospasm", "tracheal tube", "double lumen", "bronchial blocker", "epiglottis", "glottis", "extubat", "cricoid", "sellick", "rapid sequence", "aspiration"],
      weak: ["larynx", "trachea", "cuff", "tube size", "thyromental", "jaw thrust", "head tilt"],
    },
    "iv-agents": {
      strong: ["propofol", "thiopent", "etomidate", "ketamine", "dexmedetomidine", "methohexit", "midazolam", "diazepam", "lorazepam", "flumazenil", "benzodiazepine", "barbiturate", "induction agent", "intravenous (anaesthe|anesthe)", "\\biv (anaesthe|anesthe|induction)", "total intravenous", "\\btiva\\b", "pain on injection", "dissociative", "neuroleptanalgesia", "droperidol"],
      weak: ["induction", "sedation", "sedative", "hypnotic"],
    },
    "inhalational": {
      strong: ["halothane", "isoflurane", "sevoflurane", "desflurane", "enflurane", "methoxyflurane", "nitrous oxide", "\\bn2o\\b", "xenon", "\\bether\\b", "\\bmac\\b", "minimum alveolar", "blood.?gas partition", "partition coefficient", "inhalation(al)? (agent|anaesthe|anesthe)", "volatile", "vaporizer", "vaporiser", "malignant hyperthermia", "second gas", "diffusion hypoxia", "concentration effect", "chloroform", "cyclopropane"],
      weak: ["inhalation", "vapour", "vapor", "emergence"],
    },
    "nmb": {
      strong: ["succinylcholine", "suxamethonium", "rocuronium", "vecuronium", "atracurium", "cisatracurium", "pancuronium", "mivacurium", "pipecuronium", "tubocurarine", "gallamine", "neostigmine", "sugammadex", "edrophonium", "pyridostigmine", "neuromuscular", "muscle relaxant", "train.of.four", "\\btof\\b", "tetanic", "phase (i|ii|1|2) block", "dual block", "depolari[sz]ing", "non.?depolari", "fasciculation", "pseudocholinesterase", "plasma cholinesterase", "dibucaine", "residual (block|paralysis)", "dantrolene", "myasthenia", "eaton"],
      weak: ["relaxant", "paralysis", "paralys", "curare", "anticholinesterase", "reversal"],
    },
    "local-regional": {
      strong: ["lignocaine", "lidocaine", "bupivacaine", "ropivacaine", "levobupivacaine", "chloroprocaine", "prilocaine", "procaine", "mepivacaine", "tetracaine", "cocaine", "benzocaine", "eutectic", "\\bemla\\b", "local (anaesthe|anesthe)", "spinal", "epidural", "caudal", "subarachnoid", "intrathecal", "neuraxial", "brachial plexus", "nerve block", "plexus block", "interscalene", "supraclavicular", "axillary block", "infraclavicular", "\\bbier", "intravenous regional", "\\btap block\\b", "paravertebral", "stellate", "coeliac plexus", "celiac plexus", "retrobulbar", "peribulbar", "sub-?tenon", "dural puncture", "post.?dural", "high spinal", "total spinal", "cauda equina", "dermatome", "sympathetic block", "local infiltration", "saddle block", "combined spinal", "lipid emulsion", "intralipid", "tuohy", "whitacre", "quincke", "sprotte", "ultrasound.guided", "regional", "ankle block", "wrist block", "femoral nerve", "sciatic", "adductor canal", "erector spinae", "scalp block", "intercostal"],
      weak: ["block", "needle", "infiltration"],
    },
    "monitoring-equipment": {
      strong: ["capnograph", "capnogram", "etco2", "end.tidal", "pulse oximet", "oximeter", "spo2", "\\becg\\b", "ecg lead", "\\bnibp\\b", "arterial line", "invasive (blood pressure|bp)", "central venous pressure", "\\bcvp\\b", "swan.?ganz", "pulmonary artery catheter", "cardiac output", "\\bbis\\b", "bispectral", "entropy", "depth of anaesthesia", "depth of anesthesia", "anaesthesia machine", "anesthesia machine", "boyle", "circle system", "circle absorber", "\\bbain\\b", "mapleson", "jackson.?rees", "\\bayre", "t.?piece", "magill", "lack system", "breathing (system|circuit)", "co2 absorber", "soda lime", "baralyme", "rebreathing", "flowmeter", "rotameter", "cylinder", "pin index", "oxygen failure", "scavenging", "pipeline", "humidif", "heat and moisture", "\\bhme\\b", "ambu", "temperature monitor", "pressure gauge", "regulator", "bobbin", "fail.?safe", "alarm", "oxygen analy[sz]er", "colour code", "color code", "monitoring", "transducer", "nerve stimulator"],
      weak: ["monitor", "waveform", "trace", "machine", "circuit", "gauge", "probe"],
    },
    "preop": {
      strong: ["pre.?anaesthetic", "pre.?anesthetic", "pre.?operative", "preoperative", "premedication", "\\basa (class|physical|grade|status|ps)", "\\basa\\b", "fasting", "nil per oral", "\\bnpo\\b", "\\bnbm\\b", "risk (index|assessment|stratification)", "\\brcri\\b", "goldman", "\\bmets\\b", "functional capacity", "stop.?bang", "obstructive sleep ap", "\\bosa\\b", "apfel", "ponv", "post.?operative nausea", "aspiration prophylaxis", "ranitidine", "metoclopramide", "discontinued before", "informed consent"],
      weak: ["premed", "optimi[sz]ation", "assessment", "evaluation", "risk"],
    },
    "fluids-blood": {
      strong: ["crystalloid", "colloid", "ringer", "normal saline", "dextrose", "hartmann", "plasmalyte", "albumin", "gelatin", "hydroxyethyl", "\\bhes\\b", "dextran", "blood (transfusion|product|loss|component|group)", "transfusion", "packed red", "\\bprbc\\b", "fresh frozen", "\\bffp\\b", "platelet", "cryoprecipitate", "massive transfusion", "hyperkal", "hypokal", "hyponatr", "hypernatr", "hypocalc", "hypercalc", "hypomagnes", "hypermagnes", "electrolyte", "acid.?base", "metabolic (acidosis|alkalosis)", "respiratory (acidosis|alkalosis)", "anion gap", "maintenance fluid", "fluid (therapy|management|resuscitation|deficit|replacement)", "hypovol", "haemorrhagic shock", "hemorrhagic shock", "blood volume", "allowable blood loss", "citrate", "storage lesion", "tranexamic", "cell salvage", "autologous", "haemodilution", "hemodilution", "tur syndrome", "glycine"],
      weak: ["fluid", "blood", "saline", "sodium", "potassium"],
    },
    "pain": {
      strong: ["analges", "opioid", "morphine", "fentanyl", "remifentanil", "sufentanil", "alfentanil", "pethidine", "meperidine", "tramadol", "tapentadol", "buprenorphine", "butorphanol", "nalbuphine", "pentazocine", "methadone", "naloxone", "naltrexone", "codeine", "\\bnsaid", "paracetamol", "acetaminophen", "ketorolac", "diclofenac", "ibuprofen", "gabapentin", "pregabalin", "neuropathic", "\\bcrps\\b", "complex regional", "trigeminal neuralgia", "post.?herpetic", "phantom", "chronic pain", "cancer pain", "analgesic ladder", "\\bpca\\b", "patient.controlled", "visual analogue", "pain (score|scale|relief|management|pathway|clinic)", "nociception", "nociceptor", "substance p", "gate control", "referred pain", "migraine", "myofascial", "radiofrequency", "neurolysis", "opiate"],
      weak: ["pain", "painful"],
    },
    "icu-ventilation": {
      strong: ["ventilator", "mechanical ventilation", "\\bpeep\\b", "\\bcpap\\b", "\\bbipap\\b", "\\bsimv\\b", "pressure support", "pressure control", "volume control", "modes? of ventilation", "tidal volume", "\\bards\\b", "acute respiratory distress", "lung.?protective", "weaning", "\\bicu\\b", "intensive care", "critical care", "\\bsofa\\b", "\\bapache\\b", "sepsis", "septic", "vasopressor", "noradrenaline", "norepinephrine", "inotrope", "dobutamine", "dopamine", "vasopressin", "prone position", "\\becmo\\b", "non.?invasive ventilation", "\\bniv\\b", "high.flow", "respiratory failure", "barotrauma", "volutrauma", "plateau pressure", "auto.?peep", "brain death", "organ donor", "ventilator.associated", "inverse ratio", "\\bhfov\\b", "oscillat", "delirium", "glasgow coma", "intracranial pressure", "\\bicp\\b"],
      weak: ["ventilat", "oxygen therapy", "critically ill", "shock", "intubated"],
    },
    "cpr": {
      strong: ["\\bcpr\\b", "\\bbls\\b", "\\bacls\\b", "\\bals\\b", "cardiac arrest", "resuscitat", "cardiopulmonary", "chest compression", "defibrillat", "ventricular fibrillation", "pulseless", "asystole", "\\bpea\\b", "\\broscs?\\b", "return of spontaneous", "anaphyla", "amiodarone", "post.?cardiac arrest", "targeted temperature", "therapeutic hypothermia", "drowning", "choking", "heimlich", "recovery position", "cardioversion", "emergency (drug|situation|management)", "local anaesthetic systemic toxicity", "air embolism", "venous air", "fat embolism", "amniotic fluid embolism", "pulmonary embol", "tension pneumothorax", "anaphylactoid", "bronchospasm"],
      weak: ["emergency", "collapse", "unconscious", "arrest", "complication"],
    },
    "special-populations": {
      strong: ["paediatric", "pediatric", "infant", "neonat", "newborn", "children", "\\bchild\\b", "geriatric", "elderly", "obstetric", "caesarean", "cesarean", "pregnan", "parturient", "labour", "preeclampsia", "pre-eclampsia", "eclampsia", "day.?care", "ambulatory", "outpatient", "cardiac surgery", "cardiopulmonary bypass", "\\bcpb\\b", "neurosurg", "craniotomy", "thoracic surg", "one.lung", "lung resection", "thoracotomy", "liver (disease|transplant)", "hepatic", "renal (disease|failure)", "kidney", "dialysis", "diabet", "thyroid", "thyrotoxic", "phaeochromocytoma", "pheochromocytoma", "carcinoid", "porphyria", "obesity", "obese", "bariatric", "trauma", "\\bburns?\\b", "head injury", "ophthalm", "eye surgery", "laparoscop", "pneumoperitoneum", "tonsillectomy", "\\bect\\b", "electroconvulsive", "\\bmri\\b", "remote location", "transplant", "full stomach", "pyloric stenosis", "congenital heart", "mitral stenosis", "aortic stenosis", "pulmonary hypertension", "\\bcopd\\b", "asthma", "muscular dystrophy", "ischaemic heart", "ischemic heart", "coronary", "pacemaker", "sickle", "haemophilia", "hemophilia", "orthopaedic", "orthopedic", "tourniquet", "bone cement", "\\bturp\\b", "cystoscop", "lithotomy", "sitting position", "lateral decubitus"],
      weak: ["surgery", "operation"],
    },
    "basic-science": {
      strong: ["boyle'?s law", "charles'?s? law", "gay.?lussac", "dalton", "henry'?s law", "graham'?s law", "fick", "poiseuille", "reynolds", "bernoulli", "venturi", "coanda", "laminar", "turbulent", "critical temperature", "critical pressure", "adiabatic", "isothermal", "latent heat", "specific heat", "humidity", "vapou?r pressure", "solubility", "diffusion", "osmotic", "osmosis", "oncotic", "starling", "henderson", "buffer", "oxyhaemoglobin", "oxyhemoglobin", "dissociation curve", "\\bp50\\b", "bohr", "haldane", "shunt", "dead space", "v/q", "ventilation.perfusion", "functional residual", "\\bfrc\\b", "closing capacity", "vital capacity", "lung volume", "compliance", "surfactant", "hypoxic pulmonary vasoconstriction", "baroreceptor", "autonomic", "sympathetic", "parasympathetic", "cholinergic", "adrenergic", "muscarinic", "nicotinic", "receptor", "pharmacokinetic", "pharmacodynamic", "half.?life", "context.sensitive", "volume of distribution", "clearance", "bioavailability", "protein binding", "first.pass", "hofmann", "\\bed50\\b", "\\bed95\\b", "therapeutic index", "agonist", "antagonist", "meyer.?overton", "unitary theory", "\\bgaba\\b", "\\bnmda\\b", "mechanism of action", "cerebral blood flow", "autoregulation", "coronary blood flow", "renal blood flow", "stress response", "neuroendocrine", "action potential", "resting membrane", "synaptic", "acetylcholine", "neurotransmitter", "anticholinergic", "atropine", "glycopyrrolate", "scopolamine", "hyoscine", "ephedrine", "phenylephrine", "isoprenaline", "beta.?blocker", "esmolol", "labetalol", "clonidine", "antiemetic", "ondansetron"],
      weak: ["physics", "physiology", "pharmacology", "theory", "law", "pressure", "flow"],
    },
  },
};
