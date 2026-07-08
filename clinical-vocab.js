/* StewardMD — Clinical Vocabulary Registry (window.SMD_VOCAB)
 *
 * A CURATED, deterministic, offline finding vocabulary for the ICU complaint/finding autocomplete
 * picker. It is DELIBERATELY SEPARATE from disease scoring: it maps clinician language → EXISTING
 * canonical engine finding IDs where they exist (so a picked chip lines up with the reasoning
 * engine's vocabulary), and marks concepts the engine does not yet score as inReasoning:false. It
 * NEVER changes scoring, ranking, or any disease signature — it is search + display only.
 *
 * Entry: { id, label, cid|cids, group, sys, ws:[...], red, syn:[...] }
 *   id     picker id (stable); label = display; cid = canonical engine finding id (reuse) or null;
 *   cids   for a COMPOUND suggestion → selecting adds several chips.
 *   group  Symptoms | Signs | Red flags | Vitals | Labs | Imaging | History
 *   sys    body-system tag (display helper): Neuro/Cardiac/Resp/GI/Hepatobiliary/Renal-GU/ENT/Eye/OBGYN/General
 *   ws     workspaces where it is prioritised (im/surgery/ent/ophthalmology/obgyn/urology). Empty = broadly relevant.
 *   red    emergency red flag — always allowed in every workspace.
 *   syn    synonyms / abbreviations / doctor shorthand / typo-prone forms (all lowercase).
 */
(function () {
  "use strict";
  var IM = "im", SURG = "surgery", ENT = "ent", EYE = "ophthalmology", OBG = "obgyn", URO = "urology";

  // ---- curated registry (reuse engine finding ids as `cid` wherever they exist) ----
  var F = [
    // ===== Neurology =====
    { id: "headache", label: "Headache", cid: "headache", group: "Symptoms", sys: "Neuro", ws: [IM], syn: ["h/a", "ha", "cephalgia", "head pain", "headach"] },
    { id: "headacheSevere", label: "Severe headache", cid: "headacheSevere", group: "Symptoms", sys: "Neuro", ws: [IM], syn: ["severe headache", "very bad headache", "excruciating headache"] },
    { id: "thunderclapHeadache", label: "Thunderclap / worst-ever headache", cid: "thunderclapHeadache", group: "Red flags", sys: "Neuro", ws: [], red: true, syn: ["thunderclap", "worst headache", "worst-ever headache", "sudden severe headache"] },
    { id: "headache_vomiting", label: "Headache with vomiting", cids: ["headache", "nauseaVomiting"], group: "Symptoms", sys: "Neuro", ws: [IM], syn: ["headache and vomiting", "headache with vomit", "raised icp"] },
    { id: "headache_fever", label: "Headache with fever", cids: ["headache", "fever"], group: "Symptoms", sys: "Neuro", ws: [IM], syn: ["headache and fever", "febrile headache"] },
    { id: "headache_visual", label: "Headache with visual symptoms", cids: ["headache", "visualDisturbance"], group: "Symptoms", sys: "Neuro", ws: [IM], syn: ["headache with blurring", "headache with vision"] },
    { id: "headInjury", label: "Head injury / recent fall", cid: "headInjury", group: "History", sys: "Neuro", ws: [], syn: ["head injury", "trauma to head", "fell", "fall", "rta head"] },
    { id: "alteredSensorium", label: "Altered sensorium / mental status", cid: "alteredSensorium", group: "Signs", sys: "Neuro", ws: [IM], red: true, syn: ["ams", "altered sensorium", "sensorium", "altered mental status", "altered mentation", "altered sensorium/mental status", "confusion", "confused", "drowsy", "obtunded", "encephalopathy", "gcs drop", "unresponsive", "stupor", "disoriented"] },
    { id: "reducedGCS", label: "Reduced GCS / loss of consciousness", cid: "alteredSensorium", group: "Signs", sys: "Neuro", ws: [IM], red: true, syn: ["loc", "loss of consciousness", "low gcs", "poor gcs", "e1", "unconscious", "coma", "comatose"] },
    { id: "seizure", label: "Seizure / convulsion", cid: "seizure", group: "Red flags", sys: "Neuro", ws: [IM], red: true, syn: ["seizure", "convulsion", "convulsing", "fits", "fit", "tonic clonic", "gtcs", "status epilepticus"] },
    { id: "frothing", label: "Frothing at mouth / seizure-like activity", cid: "seizure", group: "Red flags", sys: "Neuro", ws: [IM], red: true, syn: ["frothing", "frothing at mouth", "foaming", "foaming at mouth", "froting", "seizure-like", "tongue bite", "up-rolling eyes"] },
    { id: "focalNeuroDeficit", label: "Focal neurological deficit", cid: "focalNeuroDeficit", group: "Signs", sys: "Neuro", ws: [IM], red: true, syn: ["focal deficit", "focal neuro", "facial droop", "slurred speech", "dysarthria", "aphasia", "dysphasia"] },
    { id: "hemiparesis", label: "Hemiparesis / hemiplegia", cid: "focalNeuroDeficit", group: "Signs", sys: "Neuro", ws: [IM], red: true, syn: ["hemiparesis", "hemiplegia", "one-sided weakness", "one sided weakness", "left weakness", "right weakness", "hemipEresis"] },
    { id: "quadriparesis", label: "Quadriparesis / weakness in all four limbs", cid: "focalNeuroDeficit", group: "Signs", sys: "Neuro", ws: [IM], red: true, syn: ["quadriparesis", "quadriplegia", "weakness in all four limbs", "all four limb weakness", "quadriperesis", "quadraparesis", "tetraparesis"] },
    { id: "anisocoria", label: "Anisocoria / unequal pupils", cid: "focalNeuroDeficit", group: "Red flags", sys: "Neuro", ws: [IM, EYE], red: true, syn: ["anisocoria", "unequal pupils", "unequal pupil", "aniscoria", "asymmetric pupils", "blown pupil", "fixed dilated pupil"] },
    { id: "extensorPlantar", label: "Bilateral extensor plantar response", cid: "focalNeuroDeficit", group: "Signs", sys: "Neuro", ws: [IM], syn: ["extensor plantar", "plantar extensor", "b/l plantar", "bilateral plantar", "upgoing plantar", "babinski", "bilateral babinski", "umn signs"] },
    { id: "neckStiffness", label: "Neck stiffness / meningism", cid: "neckStiffness", group: "Signs", sys: "Neuro", ws: [IM], syn: ["neck stiffness", "stiff neck", "meningism", "nuchal rigidity", "neck rigidity"] },
    { id: "photophobia", label: "Photophobia", cid: "photophobia", group: "Symptoms", sys: "Neuro", ws: [IM, EYE], syn: ["photophobia", "light sensitivity", "light hurts eyes"] },
    { id: "papilledema", label: "Papilloedema / optic disc swelling", cid: "papilledema", group: "Signs", sys: "Eye", ws: [IM, EYE], syn: ["papilledema", "papilloedema", "papill", "disc swelling", "disc oedema", "optic disc swelling", "swollen disc", "raised icp fundus"] },
    { id: "visualDisturbance", label: "Visual disturbance / loss", cid: "visualDisturbance", group: "Symptoms", sys: "Eye", ws: [IM, EYE], syn: ["visual loss", "vision loss", "blurred vision", "blurring of vision", "diplopia", "double vision"] },
    { id: "ataxia", label: "Ataxia / unsteady gait", cid: "ataxia", group: "Signs", sys: "Neuro", ws: [IM], syn: ["ataxia", "unsteady gait", "incoordination", "imbalance"] },
    { id: "ascendingWeakness", label: "Ascending weakness / areflexia", cid: "ascendingWeakness", group: "Signs", sys: "Neuro", ws: [IM], syn: ["ascending weakness", "ascending paralysis", "areflexia"] },
    { id: "asterixis", label: "Asterixis / flap", cid: "asterixis", group: "Signs", sys: "Neuro", ws: [IM], syn: ["asterixis", "flap", "flapping tremor"] },

    // ===== Cardiovascular =====
    { id: "chestPain", label: "Chest pain", cid: "chestPain", group: "Symptoms", sys: "Cardiac", ws: [IM], syn: ["chest pain", "cp", "chest discomfort"] },
    { id: "exertionalChestPain", label: "Exertional / pressure chest pain", cid: "exertionalChestPain", group: "Symptoms", sys: "Cardiac", ws: [IM], syn: ["exertional chest pain", "chest pain on exertion", "pressure chest pain", "angina"] },
    { id: "pleuriticChestPain", label: "Pleuritic chest pain", cid: "pleuriticChestPain", group: "Symptoms", sys: "Resp", ws: [IM], syn: ["pleuritic", "pleuritic chest pain", "chest pain on breathing"] },
    { id: "palpitations", label: "Palpitations", cid: "palpitations", group: "Symptoms", sys: "Cardiac", ws: [IM], syn: ["palpitation", "palpitations", "racing heart"] },
    { id: "syncope", label: "Syncope / collapse", cid: "syncope", group: "Symptoms", sys: "Cardiac", ws: [IM], syn: ["syncope", "collapse", "fainted", "passed out", "blackout"] },
    { id: "orthopnea", label: "Orthopnea / PND", cid: "orthopnea", group: "Symptoms", sys: "Cardiac", ws: [IM], syn: ["orthopnea", "orthopnoea", "pnd", "paroxysmal nocturnal dyspnea"] },
    { id: "raisedJVP", label: "Raised JVP / peripheral oedema", cid: "raisedJVP", group: "Signs", sys: "Cardiac", ws: [IM], syn: ["raised jvp", "elevated jvp", "pedal edema", "peripheral oedema"] },
    { id: "severeHypertension", label: "Severe hypertension (BP > 180/120)", cid: "hypertensionHx", group: "Red flags", sys: "Cardiac", ws: [IM], red: true, syn: ["severe hypertension", "hypertensive emergency", "hypertensive urgency", "very high bp", "malignant hypertension", "bp very high"] },

    // ===== Respiratory =====
    { id: "dyspnea", label: "Breathlessness (dyspnoea)", cid: "dyspnea", group: "Symptoms", sys: "Resp", ws: [IM], syn: ["sob", "shortness of breath", "short of breath", "breathless", "breathlessness", "dyspnoea", "difficulty breathing"] },
    { id: "cough", label: "Cough", cid: "cough", group: "Symptoms", sys: "Resp", ws: [IM], syn: ["cough", "coughing"] },
    { id: "purulentSputum", label: "Productive / purulent sputum", cid: "purulentSputum", group: "Symptoms", sys: "Resp", ws: [IM], syn: ["purulent sputum", "productive cough", "sputum", "phlegm"] },
    { id: "hemoptysis", label: "Haemoptysis", cid: "hemoptysis", group: "Red flags", sys: "Resp", ws: [IM], red: true, syn: ["hemoptysis", "haemoptysis", "coughing blood", "blood in sputum"] },
    { id: "hypoxia", label: "Hypoxia / low SpO₂", cid: "hypoxia", group: "Vitals", sys: "Resp", ws: [IM], red: true, syn: ["hypoxia", "desaturation", "desaturating", "low spo2", "low sats", "low saturation", "cyanosis"] },
    { id: "crepitations", label: "Crackles / crepitations", cid: "crepitations", group: "Signs", sys: "Resp", ws: [IM], syn: ["crackle", "crackles", "crepitation", "creps", "rales"] },

    // ===== Gastrointestinal / hepatobiliary =====
    { id: "abdominalPain", label: "Abdominal pain", cid: "abdominalPain", group: "Symptoms", sys: "GI", ws: [IM, SURG], syn: ["abdominal pain", "abdo pain", "belly pain", "stomach pain", "tummy pain"] },
    { id: "severeAbdominalPain", label: "Severe abdominal pain", cid: "severeAbdominalPain", group: "Symptoms", sys: "GI", ws: [IM, SURG], red: true, syn: ["severe abdominal pain", "severe abdo pain", "acute abdomen"] },
    { id: "epigastricPain", label: "Epigastric pain", cid: "abdominalPain", group: "Symptoms", sys: "GI", ws: [IM, SURG], syn: ["epigastric pain", "epigastric", "upper abdominal pain"] },
    { id: "rightUpperQuadrantPain", label: "Right upper quadrant pain", cid: "rightUpperQuadrantPain", group: "Symptoms", sys: "Hepatobiliary", ws: [IM, SURG], syn: ["right upper quadrant", "ruq pain", "ruq", "right hypochondrium"] },
    { id: "vomiting", label: "Vomiting", cid: "nauseaVomiting", group: "Symptoms", sys: "GI", ws: [IM, SURG], syn: ["vomiting", "vomit", "vomited", "emesis", "throwing up", "nausea"] },
    { id: "persistentVomiting", label: "Persistent vomiting", cid: "nauseaVomiting", group: "Symptoms", sys: "GI", ws: [IM, SURG], syn: ["persistent vomiting", "recurrent vomiting", "repeated vomiting", "intractable vomiting"] },
    { id: "projectileVomiting", label: "Projectile vomiting", cid: "nauseaVomiting", group: "Symptoms", sys: "GI", ws: [IM, SURG], syn: ["projectile vomiting", "forceful vomiting"] },
    { id: "hematemesis", label: "Blood-stained vomiting / haematemesis", cid: "hematemesis", group: "Red flags", sys: "GI", ws: [IM, SURG], red: true, syn: ["hematemesis", "haematemesis", "vomiting blood", "blood in vomit", "coffee-ground vomit", "blood-stained vomit"] },
    { id: "vomiting_headache", label: "Vomiting with headache", cids: ["nauseaVomiting", "headache"], group: "Symptoms", sys: "Neuro", ws: [IM], syn: ["vomiting with headache", "vomiting and headache"] },
    { id: "vomiting_abdopain", label: "Vomiting with abdominal pain", cids: ["nauseaVomiting", "abdominalPain"], group: "Symptoms", sys: "GI", ws: [IM, SURG], syn: ["vomiting with abdominal pain", "vomiting and abdo pain"] },
    { id: "jaundice", label: "Jaundice / icterus", cid: "jaundice", group: "Signs", sys: "Hepatobiliary", ws: [IM, SURG], syn: ["jaundice", "icterus", "yellow eyes", "yellowish discoloration"] },
    { id: "ascites", label: "Ascites / abdominal distension", cid: "ascites", group: "Signs", sys: "GI", ws: [IM, SURG], syn: ["ascites", "abdominal distension", "distended abdomen", "fluid in abdomen"] },
    { id: "melena", label: "Melaena / black stool", cid: "melena", group: "Red flags", sys: "GI", ws: [IM, SURG], red: true, syn: ["melena", "melaena", "black stool", "tarry stool"] },
    { id: "bloodyStool", label: "Bloody stool / haematochezia", cid: "bloodyStool", group: "Red flags", sys: "GI", ws: [IM, SURG], red: true, syn: ["bloody stool", "blood in stool", "hematochezia", "rectal bleed", "per rectal bleed"] },
    { id: "diarrhea", label: "Diarrhoea", cid: "diarrhea", group: "Symptoms", sys: "GI", ws: [IM], syn: ["diarrhea", "diarrhoea", "loose stool", "loose motions"] },
    { id: "guarding", label: "Guarding / rigidity / peritonism", cid: null, group: "Signs", sys: "GI", ws: [SURG], red: true, syn: ["guarding", "rigidity abdomen", "board-like rigidity", "peritonism", "peritonitis", "rebound tenderness"] },
    { id: "murphySign", label: "Murphy's sign positive", cid: null, group: "Signs", sys: "Hepatobiliary", ws: [SURG, IM], syn: ["murphy sign", "murphy's sign", "positive murphy"] },
    { id: "drainOutput", label: "Drain output / abnormal drain", cid: null, group: "Signs", sys: "GI", ws: [SURG], syn: ["drain output", "drain draining", "high drain output", "drain content"] },
    { id: "woundDischarge", label: "Wound discharge / gaping", cid: null, group: "Signs", sys: "General", ws: [SURG], syn: ["wound discharge", "wound gaping", "wound infection", "pus from wound", "surgical site discharge"] },

    // ===== Renal / genitourinary =====
    { id: "dysuria", label: "Dysuria / burning micturition", cid: "dysuria", group: "Symptoms", sys: "Renal-GU", ws: [IM, URO], syn: ["dysuria", "burning urine", "burning micturition", "painful urination"] },
    { id: "flankPain", label: "Flank / loin pain", cid: "flankPain", group: "Symptoms", sys: "Renal-GU", ws: [IM, URO], syn: ["flank pain", "loin pain", "renal angle pain", "kidney pain"] },
    { id: "hematuria", label: "Haematuria / blood in urine", cid: "hematuria", group: "Symptoms", sys: "Renal-GU", ws: [IM, URO], syn: ["hematuria", "haematuria", "blood in urine", "red urine"] },
    { id: "oliguria", label: "Oliguria / anuria / low urine output", cid: "oliguria", group: "Signs", sys: "Renal-GU", ws: [IM, URO], red: true, syn: ["oliguria", "anuria", "low urine output", "reduced urine", "not passing urine"] },
    { id: "urinaryRetention", label: "Urinary retention", cid: null, group: "Symptoms", sys: "Renal-GU", ws: [URO], syn: ["urinary retention", "retention of urine", "unable to pass urine", "cannot pass urine", "blocked catheter"] },
    { id: "catheterIssue", label: "Catheter problem / blockage", cid: null, group: "History", sys: "Renal-GU", ws: [URO], syn: ["catheter blocked", "catheter issue", "catheter not draining", "foley problem"] },
    { id: "costovertebralTenderness", label: "Costovertebral angle tenderness", cid: null, group: "Signs", sys: "Renal-GU", ws: [IM, URO], syn: ["cva tenderness", "costovertebral tenderness", "renal angle tenderness"] },
    { id: "proteinuria", label: "Frothy urine / proteinuria", cid: "proteinuria", group: "Labs", sys: "Renal-GU", ws: [IM], syn: ["frothy urine", "proteinuria", "heavy protein"] },

    // ===== ENT =====
    { id: "earDischarge", label: "Ear discharge / otorrhoea", cid: null, group: "Symptoms", sys: "ENT", ws: [ENT], syn: ["ear discharge", "otorrhoea", "otorrhea", "pus from ear", "ear pus"] },
    { id: "mastoidTenderness", label: "Mastoid tenderness / swelling", cid: null, group: "Signs", sys: "ENT", ws: [ENT], red: true, syn: ["mastoid tenderness", "mastoid swelling", "behind ear swelling", "mastoiditis"] },
    { id: "soreThroat", label: "Sore throat / odynophagia", cid: null, group: "Symptoms", sys: "ENT", ws: [ENT], syn: ["sore throat", "throat pain", "odynophagia", "painful swallowing"] },
    { id: "neckSwelling", label: "Neck swelling / mass", cid: null, group: "Signs", sys: "ENT", ws: [ENT, SURG], syn: ["neck swelling", "neck mass", "neck lump", "cervical swelling"] },
    { id: "stridor", label: "Stridor / airway compromise", cid: null, group: "Red flags", sys: "ENT", ws: [ENT], red: true, syn: ["stridor", "noisy breathing", "airway obstruction", "airway compromise"] },

    // ===== Ophthalmology =====
    { id: "redEye", label: "Red eye", cid: null, group: "Symptoms", sys: "Eye", ws: [EYE], syn: ["red eye", "eye redness", "conjunctival injection"] },
    { id: "cornealOpacity", label: "Corneal opacity / ulcer", cid: null, group: "Signs", sys: "Eye", ws: [EYE], syn: ["corneal opacity", "corneal ulcer", "hazy cornea", "white spot cornea"] },
    { id: "acuteVisionLoss", label: "Acute vision loss", cid: "visualDisturbance", group: "Red flags", sys: "Eye", ws: [EYE], red: true, syn: ["acute vision loss", "sudden vision loss", "sudden blindness"] },

    // ===== OBGYN =====
    { id: "vaginalDischarge", label: "Vaginal discharge", cid: null, group: "Symptoms", sys: "OBGYN", ws: [OBG], syn: ["vaginal discharge", "pv discharge", "per vaginal discharge"] },
    { id: "pelvicPain", label: "Pelvic / lower abdominal pain", cid: "abdominalPain", group: "Symptoms", sys: "OBGYN", ws: [OBG], syn: ["pelvic pain", "lower abdominal pain", "lower abdo pain"] },
    { id: "pvBleeding", label: "Vaginal bleeding", cid: null, group: "Red flags", sys: "OBGYN", ws: [OBG], red: true, syn: ["vaginal bleeding", "pv bleeding", "per vaginal bleeding", "bleeding pv"] },
    { id: "pregnancySymptoms", label: "Pregnancy / amenorrhoea", cid: null, group: "History", sys: "OBGYN", ws: [OBG], syn: ["pregnant", "pregnancy", "amenorrhoea", "missed period", "positive upt"] },

    // ===== Vitals =====
    { id: "fever", label: "Fever", cid: "fever", group: "Vitals", sys: "General", ws: [IM], syn: ["fever", "febrile", "pyrexia", "high temperature", "temperature"] },
    { id: "hypotension", label: "Hypotension / shock", cid: "hypotension", group: "Red flags", sys: "Cardiac", ws: [IM], red: true, syn: ["hypotension", "low bp", "shock", "septic shock", "low blood pressure"] },
    { id: "tachycardia", label: "Tachycardia", cid: "tachycardia", group: "Vitals", sys: "Cardiac", ws: [IM], syn: ["tachycardia", "fast heart rate", "high hr", "racing pulse"] },
    { id: "bradycardia", label: "Bradycardia", cid: "bradycardia", group: "Vitals", sys: "Cardiac", ws: [IM], syn: ["bradycardia", "slow heart rate", "low hr", "slow pulse"] },
    { id: "hypothermia", label: "Hypothermia", cid: "hypothermia", group: "Vitals", sys: "General", ws: [IM], syn: ["hypothermia", "low temperature", "hypothermic"] },

    // ===== Laboratory =====
    { id: "thrombocytopenia", label: "Thrombocytopenia / low platelets", cid: "thrombocytopenia", group: "Labs", sys: "General", ws: [IM], syn: ["thrombocytopenia", "low platelet", "low platelets", "low plt"] },
    { id: "ketonemia", label: "Ketonaemia / high anion-gap acidosis", cid: "ketonemia", group: "Labs", sys: "General", ws: [IM], syn: ["ketonemia", "ketoacidosis", "ketones", "high anion gap"] },
    { id: "lactateElevated", label: "Raised lactate", cid: "lactateElevated", group: "Labs", sys: "General", ws: [IM], red: true, syn: ["raised lactate", "high lactate", "lactataemia", "elevated lactate"] },
    { id: "renalImpairment", label: "Raised creatinine / renal impairment", cid: "renalImpairment", group: "Labs", sys: "Renal-GU", ws: [IM, URO], syn: ["raised creatinine", "high creatinine", "renal impairment", "aki", "acute kidney injury", "deranged rft"] },

    // ===== Imaging (not yet scored — inReasoning:false) =====
    { id: "consolidation", label: "Consolidation on chest imaging", cid: "consolidation", group: "Imaging", sys: "Resp", ws: [IM], syn: ["consolidation", "lobar consolidation", "infiltrate", "opacity chest"] },
    { id: "pleuralEffusion", label: "Pleural effusion", cid: null, group: "Imaging", sys: "Resp", ws: [IM, SURG], syn: ["pleural effusion", "effusion chest", "fluid in chest"] },
    { id: "pneumothorax", label: "Pneumothorax", cid: null, group: "Imaging", sys: "Resp", ws: [IM, SURG], red: true, syn: ["pneumothorax", "collapsed lung", "air in pleura"] },
    { id: "ctHaemorrhage", label: "Intracranial haemorrhage on CT", cid: null, group: "Imaging", sys: "Neuro", ws: [IM], red: true, syn: ["ct haemorrhage", "intracranial bleed", "brain bleed on ct", "ich on ct", "intracerebral haemorrhage"] },
    { id: "hydronephrosis", label: "Hydronephrosis on USG/CT", cid: null, group: "Imaging", sys: "Renal-GU", ws: [IM, URO], syn: ["hydronephrosis", "dilated pelvicalyceal", "obstructed kidney", "back pressure changes"] },
    { id: "freeAir", label: "Free air / pneumoperitoneum", cid: null, group: "Imaging", sys: "GI", ws: [SURG, IM], red: true, syn: ["free air", "pneumoperitoneum", "gas under diaphragm", "free gas"] },

    // ===== History / comorbidities =====
    { id: "hypertensionHx", label: "Hypertension (history)", cid: "hypertensionHx", group: "History", sys: "Cardiac", ws: [IM], syn: ["hypertension", "hypertensive", "htn", "high bp history"] },
    { id: "diabetesHx", label: "Diabetes mellitus (history)", cid: "diabetesHx", group: "History", sys: "General", ws: [IM], syn: ["diabetes", "diabetic", "dm", "t2dm", "t1dm", "on insulin"] },
    { id: "knownCAD", label: "Known coronary artery disease", cid: "knownCAD", group: "History", sys: "Cardiac", ws: [IM], syn: ["cad", "coronary artery disease", "known ihd", "prior mi", "old mi"] },
    { id: "anticoagulated", label: "On anticoagulation", cid: "anticoagulated", group: "History", sys: "General", ws: [IM], syn: ["anticoagulated", "on warfarin", "on doac", "on blood thinner", "on acitrom"] },
    { id: "alcoholExcess", label: "Alcohol excess / dependence", cid: "alcoholExcess", group: "History", sys: "General", ws: [IM], syn: ["alcohol", "alcoholic", "etoh", "drinks heavily", "alcohol dependence"] },
    { id: "steroidUse", label: "Chronic steroid use", cid: "steroidUse", group: "History", sys: "General", ws: [IM], syn: ["steroid", "on steroids", "chronic steroid", "immunosuppressed"] }
  ];

  // Global abbreviation expansions applied to the QUERY before matching (not findings themselves).
  var Q_EXPAND = [[/\bb\s*\/\s*l\b/g, "bilateral"], [/\bh\s*\/\s*o\b/g, ""], [/\bc\s*\/\s*o\b/g, ""], [/\bk\s*\/\s*c\s*\/\s*o\b/g, ""]];
  // Temporality/polarity cues stripped from the query (they are chip modifiers, not findings).
  var CUE = /\b(no|without|denies|absent|h\/o|history of|old|previous|resolved|rule out|r\/o|possible|query|\?)\b/gi;

  function norm(s) { s = " " + String(s == null ? "" : s).toLowerCase().trim() + " "; Q_EXPAND.forEach(function (r) { s = s.replace(r[0], " " + r[1] + " "); }); return s.replace(/[^\w\s\/-]/g, " ").replace(/\s+/g, " ").trim(); }
  function lev(a, b) { var m = a.length, n = b.length, i, j, d = []; if (!m) return n; if (!n) return m; for (i = 0; i <= m; i++) d[i] = [i]; for (j = 0; j <= n; j++) d[0][j] = j; for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
  function tokens(s) { return String(s || "").toLowerCase().split(/[^\w]+/).filter(function (t) { return t.length > 1; }); }

  // Score one entry against a normalized query.
  function scoreEntry(e, q, qToks) {
    var label = e.label.toLowerCase(), best = 0, hitSyn = "";
    function consider(str, base, isSyn) { if (!str) return; str = str.toLowerCase(); var sc = 0;
      // Word-boundary matching only (no bare substring) so "ear" can't match inside "heart".
      if (str === q) sc = base + 40; else if (str.indexOf(q) === 0) sc = base + 24; else if ((" " + str).indexOf(" " + q) >= 0) sc = base + 16;
      if (sc > best) { best = sc; if (isSyn) hitSyn = str; } }
    consider(label, 40, false);
    (e.syn || []).forEach(function (s) { consider(s, 34, true); });
    // token prefix (each query token must prefix-match some label/syn token)
    if (!best && qToks.length) {
      var pool = tokens(label).concat((e.syn || []).join(" ").split(/[^\w]+/)).filter(Boolean);
      var all = qToks.every(function (qt) { return pool.some(function (pt) { return pt.indexOf(qt) === 0; }); });
      if (all) best = 30;
    }
    // typo-tolerant fuzzy (only for q>=4 and only vs curated words; never for very short queries)
    if (!best && q.length >= 4) {
      var words = tokens(label).concat((e.syn || []).join(" ").split(/[^\w]+/)).filter(function (w) { return w.length >= 4; });
      var min = 99; words.forEach(function (w) { var d = lev(q, w); if (d < min) min = d; });
      var thr = q.length >= 7 ? 2 : 1;
      if (min <= thr) best = 22 - min * 4;
    }
    return { score: best, syn: hitSyn };
  }

  var GROUP_ORDER = { "Red flags": 0, "Symptoms": 1, "Signs": 2, "Vitals": 3, "Laboratory": 4, "Labs": 4, "Imaging": 5, "History": 6 };

  function search(query, opts) {
    opts = opts || {};
    var ws = opts.workspace || "im", limit = opts.limit || 8;
    var q = norm(String(query || "").replace(CUE, " "));
    if (!q || q.length < 1) return [];
    var out = [];
    F.forEach(function (e) {
      var r = scoreEntry(e, q, tokens(q));
      if (r.score <= 0) return;
      var wsMatch = !e.ws || !e.ws.length || e.ws.indexOf(ws) >= 0;
      var sc = r.score + (wsMatch ? 12 : 0) + (e.red ? 6 : 0);   // active-workspace + red-flag boosts; red flags never filtered
      out.push({ id: e.id, label: e.label, cid: e.cid || null, cids: e.cids || null, group: e.group, sys: e.sys, red: !!e.red, inReasoning: !!(e.cid || (e.cids && e.cids.length)), syn: r.syn && r.syn !== e.label.toLowerCase() ? r.syn : "", _s: sc, _b: r.score, _g: GROUP_ORDER[e.group] == null ? 9 : GROUP_ORDER[e.group] });
    });
    // Rank by boosted score, then by RAW match quality (a cleaner prefix/exact match beats a
    // substring match that only tied via the red-flag/workspace nudge), then group, then label.
    out.sort(function (a, b) { return b._s - a._s || b._b - a._b || a._g - b._g || a.label.localeCompare(b.label); });
    var total = out.length, top = out.slice(0, limit);
    top.forEach(function (x) { delete x._s; delete x._b; delete x._g; });
    return { results: top, total: total, more: total > limit };
  }

  // Resolve a picker entry → the chip(s) to add (reuse canonical engine ids; else a note: id).
  function toChips(entry) {
    var e = null; for (var i = 0; i < F.length; i++) if (F[i].id === entry.id || F[i].id === entry) { e = F[i]; break; }
    if (!e) return [];
    if (e.cids && e.cids.length) return e.cids.map(function (cid) { var m = null; for (var j = 0; j < F.length; j++) if (F[j].cid === cid) { m = F[j]; break; } return { canonicalFindingId: cid, displayLabel: (m ? m.label : cid), inReasoning: true }; });
    return [{ canonicalFindingId: e.cid || ("note:" + e.id), displayLabel: e.label, inReasoning: !!e.cid }];
  }

  var API = { search: search, toChips: toChips, all: function () { return F.slice(); }, _norm: norm, _lev: lev };
  var root = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this);
  if (root) root.SMD_VOCAB = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
