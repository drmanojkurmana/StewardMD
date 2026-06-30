/* ============================================================================
   StewardMD vNext — Dynamic Clinical Reasoning Engine (Phase 2)
   FULLY DATA-DRIVEN. The infectious differential is generated live from the
   entire StewardMD disease database (window.SYNDROMES) — every current and
   future syndrome auto-participates with NO new reasoning code. A parallel
   non-infectious knowledge layer (DDX_NI, same schema) drives the green
   differential. Symptom-first, live-updating, two-section (🔴/🟢), with a
   transparent Clinical Confidence Score and an infection gate that controls
   when the stewardship engine activates.
   Decision support only — never diagnostic. Pending clinician sign-off.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------- *
   * EXTRA presenting findings (generic symptoms not in the infection-focused
   * ontology). Merged with window.FIELD_GROUPS to give broad symptom-first
   * coverage. Adding entries here or to FIELD_GROUPS or to DDX_NI all flow
   * into the engine automatically.
   * ---------------------------------------------------------------------- */
  var EXTRA_GROUPS = [
    { group: "Presenting symptom", fields: [
      { key: "headache", label: "Headache" },
      { key: "thunderclapHeadache", label: "Thunderclap / worst-ever headache" },
      { key: "chestPain", label: "Chest pain" },
      { key: "pleuriticChestPain", label: "Pleuritic chest pain" },
      { key: "exertionalChestPain", label: "Exertional / pressure chest pain" },
      { key: "dyspnea", label: "Breathlessness (dyspnea)" },
      { key: "orthopnea", label: "Orthopnea / PND" },
      { key: "palpitations", label: "Palpitations" },
      { key: "backPain", label: "Back pain" },
      { key: "visualDisturbance", label: "Visual disturbance / loss" },
      { key: "papilledema", label: "Papilloedema / optic disc swelling" },
      { key: "polyarthralgia", label: "Joint pain (polyarticular)" },
      { key: "legSwellingUnilateral", label: "Unilateral leg swelling" },
      { key: "legSwellingBilateral", label: "Bilateral leg swelling / edema" },
      { key: "calfTenderness", label: "Calf tenderness" },
      { key: "hematemesis", label: "Haematemesis" },
      { key: "hematuria", label: "Haematuria" },
      { key: "jointSwelling", label: "Joint swelling / hot joint" }
    ]},
    { group: "Signs & context", fields: [
      { key: "raisedJVP", label: "Raised JVP / peripheral edema" },
      { key: "bilateralCrackles", label: "Bilateral basal crackles" },
      { key: "asterixis", label: "Asterixis / flap" },
      { key: "ecgIschemia", label: "ECG: ischemic changes" },
      { key: "ketonemia", label: "Ketonemia / high anion-gap acidosis" },
      { key: "polyuriaPolydipsia", label: "Polyuria / polydipsia" },
      { key: "knownCAD", label: "Known coronary artery disease" },
      { key: "knownHeartFailure", label: "Known heart failure" },
      { key: "hypertensionHx", label: "Hypertension" },
      { key: "diabetesHx", label: "Diabetes mellitus" },
      { key: "steroidUse", label: "Chronic steroid use" },
      { key: "drugOverdose", label: "Sedative / drug overdose context" },
      { key: "anticoagulated", label: "On anticoagulation" },
      { key: "ageOver50", label: "Age > 50" },
      { key: "atrialFibHx", label: "Known atrial fibrillation" },
      { key: "pulsatileMass", label: "Pulsatile abdominal mass" },
      { key: "ascendingWeakness", label: "Ascending weakness / areflexia" },
      { key: "rigidity", label: "Muscle rigidity" },
      { key: "hypothermia", label: "Hypothermia" },
      { key: "bradycardia", label: "Bradycardia" },
      { key: "bradypnea", label: "Slow / depressed breathing" },
      { key: "miosisSecretions", label: "Miosis + excess secretions (cholinergic)" },
      { key: "mucocutaneousBleeding", label: "Mucocutaneous bleeding" },
      { key: "oliguria", label: "Oliguria / anuria" },
      { key: "mucosalLesions", label: "Mucosal erosions / skin detachment" },
      { key: "facialSwelling", label: "Facial / upper-body swelling" },
      { key: "sickleCellHx", label: "Known sickle cell disease" },
      { key: "headInjury", label: "Recent head injury / fall" },
      { key: "alcoholExcess", label: "Alcohol excess / dependence" },
      { key: "ataxia", label: "Ataxia / unsteady gait" },
      { key: "proteinuria", label: "Frothy urine / heavy proteinuria" }
    ]}
  ];

  /* ---------------------------------------------------------------------- *
   * NON-INFECTIOUS knowledge layer (data-driven, extensible).
   * find: { findingKey: weight }   positive raises, negative lowers.
   * Add entries freely — they automatically join the differential.
   * ---------------------------------------------------------------------- */
  var DDX_NI = [
    /* ---- Headache cluster ---- */
    { id:"migraine", name:"Migraine", system:"Neurology",
      find:{ headache:42, photophobia:18, visualDisturbance:16, nauseaVomiting:10, fever:-18, neckStiffness:-14, alteredSensorium:-12, focalNeuroDeficit:-6 },
      inv:["Clinical diagnosis (POUND criteria)","Neuroimaging only if red flags"], red:["New focal deficit, thunderclap onset, or fever → exclude secondary cause"],
      reason:"Recurrent headache with photophobia and nausea, no fever or meningism, favours primary migraine." },
    { id:"tension_ha", name:"Tension-type headache", system:"Neurology",
      find:{ headache:38, fever:-16, neckStiffness:-10, visualDisturbance:-6, focalNeuroDeficit:-8 },
      inv:["Clinical diagnosis"], red:["Atypical features warrant imaging"],
      reason:"Bilateral pressure-type headache without systemic or neurological red flags." },
    { id:"sah", name:"Subarachnoid hemorrhage", system:"Neurology / Vascular",
      find:{ thunderclapHeadache:55, headache:20, neckStiffness:22, alteredSensorium:18, seizure:8, ageOver50:6, fever:-6 },
      inv:["Non-contrast CT head (urgent)","LP for xanthochromia if CT negative","CT angiography"], red:["Thunderclap headache is SAH until proven otherwise — image immediately"],
      reason:"Sudden worst-ever headache ± meningism and reduced consciousness is classic for subarachnoid hemorrhage." },
    { id:"ischemic_stroke", name:"Acute ischemic stroke", system:"Neurology / Vascular",
      find:{ focalNeuroDeficit:46, alteredSensorium:16, ageOver50:10, hypertensionHx:8, headache:4, fever:-20, neckStiffness:-14 },
      inv:["Non-contrast CT head (urgent)","CT/MR angiography","Glucose (stroke mimic)"], red:["Time-critical — thrombolysis/thrombectomy window"],
      reason:"Acute focal neurological deficit favours a vascular event; image urgently and check the stroke pathway." },
    { id:"ich", name:"Intracerebral hemorrhage", system:"Neurology / Vascular",
      find:{ focalNeuroDeficit:36, headache:24, alteredSensorium:24, hypertensionHx:16, anticoagulated:16, ageOver50:6, fever:-10 },
      inv:["Non-contrast CT head (urgent)","Coagulation profile","BP control"], red:["Reverse anticoagulation; neurosurgical review"],
      reason:"Headache with focal deficit and reduced consciousness, especially with hypertension or anticoagulation, suggests intracerebral haemorrhage." },
    { id:"brain_tumour", name:"Brain tumour / mass lesion", system:"Neuro-oncology",
      find:{ headache:30, focalNeuroDeficit:22, seizure:18, visualDisturbance:12, papilledema:20, weightLoss:8, alteredSensorium:8, fever:-10 },
      inv:["MRI brain with contrast","Refer neuro-oncology"], red:["Progressive headache, morning vomiting, papilloedema"],
      reason:"Progressive headache with focal signs or new seizures raises concern for an intracranial mass." },
    { id:"iih", name:"Idiopathic intracranial hypertension", system:"Neurology",
      find:{ headache:30, visualDisturbance:24, papilledema:30, fever:-12, neckStiffness:-8 },
      inv:["Fundoscopy (papilloedema)","MRI + MR venography","LP with opening pressure"], red:["Progressive visual loss needs urgent treatment"],
      reason:"Headache with visual disturbance and papilloedema in the right demographic suggests raised intracranial pressure without a mass." },
    { id:"temporal_arteritis", name:"Giant cell (temporal) arteritis", system:"Rheumatology",
      find:{ headache:28, visualDisturbance:24, ageOver50:22, polyarthralgia:8, weightLoss:8 },
      inv:["ESR / CRP (markedly raised)","Temporal artery biopsy","Start high-dose steroids if suspected"], red:["Visual loss is an emergency — do not delay steroids"],
      reason:"New headache with visual symptoms in a patient over 50 with raised inflammatory markers suggests giant cell arteritis." },

    /* ---- Chest pain cluster ---- */
    { id:"acs", name:"Acute coronary syndrome", system:"Cardiology",
      find:{ exertionalChestPain:44, chestPain:24, ecgIschemia:30, knownCAD:18, diabetesHx:8, dyspnea:10, ageOver50:8, pleuriticChestPain:-12 },
      inv:["12-lead ECG (serial)","Troponin","Aspirin + cardiology referral"], red:["STEMI → immediate reperfusion pathway"],
      reason:"Pressure-type / exertional chest pain with ischaemic ECG or risk factors favours an acute coronary syndrome." },
    { id:"aortic_dissection", name:"Aortic dissection", system:"Vascular emergency",
      find:{ chestPain:30, backPain:30, thunderclapHeadache:6, hypertensionHx:18, ageOver50:8, syncope:10 },
      inv:["CT aortogram (urgent)","BP in both arms","Control HR & BP"], red:["Tearing chest/back pain with pulse/BP differential — emergency imaging"],
      reason:"Severe tearing chest pain radiating to the back, especially with hypertension, raises aortic dissection." },
    { id:"pe", name:"Pulmonary embolism", system:"Pulmonary / Vascular",
      find:{ pleuriticChestPain:30, dyspnea:34, hypoxia:22, tachycardia:16, legSwellingUnilateral:18, calfTenderness:12, fever:-6 },
      inv:["CT pulmonary angiogram","D-dimer (if low probability)","ECG, troponin"], red:["Haemodynamic instability → consider thrombolysis"],
      reason:"Pleuritic chest pain and dyspnoea with hypoxia or DVT features suggest pulmonary embolism." },
    { id:"pericarditis", name:"Acute pericarditis", system:"Cardiology",
      find:{ pleuriticChestPain:30, chestPain:18, fever:8, ecgIschemia:-6 },
      inv:["ECG (diffuse ST elevation, PR depression)","Echocardiogram","Inflammatory markers"], red:["Tamponade if effusion enlarges"],
      reason:"Sharp pleuritic chest pain relieved by sitting forward, with typical ECG changes, suggests pericarditis." },
    { id:"gerd_chest", name:"GERD / non-cardiac chest pain", system:"Gastroenterology",
      find:{ chestPain:20, exertionalChestPain:-10, ecgIschemia:-14, fever:-8 },
      inv:["Exclude cardiac cause first","Trial of PPI"], red:["Do not attribute to GERD until ACS excluded"],
      reason:"Chest pain without ischaemic features or risk factors may be oesophageal, but cardiac causes must be excluded first." },
    { id:"pneumothorax", name:"Pneumothorax", system:"Pulmonary",
      find:{ pleuriticChestPain:28, dyspnea:26, hypoxia:14, fever:-8 },
      inv:["CXR (or POCUS)","Decompress if tension"], red:["Tension pneumothorax → immediate needle decompression"],
      reason:"Sudden pleuritic pain with breathlessness and reduced breath sounds suggests pneumothorax." },

    /* ---- Dyspnea / edema cluster ---- */
    { id:"heart_failure", name:"Acute heart failure / pulmonary edema", system:"Cardiology",
      find:{ dyspnea:34, orthopnea:30, bilateralCrackles:28, raisedJVP:26, legSwellingBilateral:20, knownHeartFailure:18, ecgIschemia:8, fever:-16 },
      inv:["CXR","BNP/NT-proBNP","ECG, troponin","Echocardiogram"], red:["Address precipitant; not an infection"],
      reason:"Orthopnoea, raised JVP and bilateral crackles favour cardiogenic pulmonary oedema rather than infection." },
    { id:"copd_exac_ni", name:"COPD exacerbation (non-infective)", system:"Pulmonary",
      find:{ dyspnea:30, knownHeartFailure:-6, fever:-6 },
      inv:["ABG","CXR to exclude pneumonia/pneumothorax"], red:["Distinguish infective trigger — may need antibiotics"],
      reason:"Increased breathlessness in known COPD without consolidation or fever may be a non-infective exacerbation." },

    /* ---- Shock cluster (mimics of septic shock) ---- */
    { id:"cardiogenic_shock", name:"Cardiogenic shock", system:"Cardiology / Critical care",
      find:{ hypotension:40, raisedJVP:24, bilateralCrackles:20, ecgIschemia:30, dyspnea:12, fever:-16 },
      inv:["ECG, troponin","Echocardiogram","Lactate"], red:["Revascularisation/inotropes — not antibiotics"], tools:["shock"],
      reason:"Hypotension with pulmonary congestion and ischaemic ECG favours a primary cardiac cause of shock." },
    { id:"hypovolemic_shock", name:"Hypovolemic / haemorrhagic shock", system:"Critical care",
      find:{ hypotension:38, tachycardia:22, melena:18, anticoagulated:8, fever:-12 },
      inv:["Identify bleeding source","Crossmatch","Resuscitate"], red:["GI bleed / occult haemorrhage"], tools:[],
      reason:"Hypotension with tachycardia and evidence of fluid/blood loss suggests hypovolaemic shock." },
    { id:"anaphylaxis", name:"Anaphylaxis", system:"Allergy / Emergency",
      find:{ hypotension:30, dyspnea:24, rash:24, tachycardia:12 },
      inv:["Clinical diagnosis","Serum tryptase"], red:["IM adrenaline immediately"], tools:[],
      reason:"Acute hypotension with urticaria/angioedema and bronchospasm after exposure indicates anaphylaxis." },
    { id:"adrenal_crisis", name:"Adrenal crisis", system:"Endocrine",
      find:{ hypotension:36, steroidUse:34, fever:-4, alteredSensorium:8 },
      inv:["Random cortisol","Electrolytes (Na↓ K↑)","Empiric hydrocortisone"], red:["Give IV hydrocortisone if suspected"], tools:["shock"],
      reason:"Refractory hypotension in a steroid-dependent patient suggests adrenal crisis." },

    /* ---- Metabolic / neuro non-infectious ---- */
    { id:"dka", name:"Diabetic ketoacidosis", system:"Endocrine",
      find:{ ketonemia:40, polyuriaPolydipsia:28, diabetesHx:24, dyspnea:10, abdominalPain:10, alteredSensorium:10, fever:-6 },
      inv:["Venous gas","Blood & urine ketones","Glucose, electrolytes","Search for precipitant (infection)"], red:["DKA protocol; look for precipitating infection"], tools:["dka"],
      reason:"High-anion-gap acidosis with ketonaemia in a diabetic indicates DKA — search for a precipitant." },
    { id:"hypoglycemia", name:"Hypoglycemia", system:"Endocrine",
      find:{ alteredSensorium:34, diabetesHx:14, seizure:8, fever:-12, neckStiffness:-12 },
      inv:["Capillary & lab glucose","Give IV dextrose"], red:["Rapidly reversible — check glucose first in any altered patient"],
      reason:"Altered sensorium with low glucose is rapidly reversible and must be excluded first." },
    { id:"metabolic_enceph", name:"Metabolic encephalopathy", system:"Neuro / Metabolic",
      find:{ alteredSensorium:44, asterixis:18, jaundice:10, fever:-14, neckStiffness:-16 },
      inv:["Electrolytes, glucose, calcium","Renal & liver panel, ammonia","ABG"], red:["Reversible — correct the derangement"],
      reason:"Diffuse encephalopathy without meningism, driven by a metabolic derangement." },
    { id:"hepatic_enceph", name:"Hepatic encephalopathy", system:"Hepatology",
      find:{ alteredSensorium:36, asterixis:30, jaundice:24, ascites:18, fever:-6, neckStiffness:-10 },
      inv:["Ammonia, LFT, coagulation","Identify precipitant (SBP, GI bleed)"], red:["Look for precipitating infection (e.g. SBP)"],
      reason:"Encephalopathy with stigmata of chronic liver disease suggests hepatic encephalopathy — seek a precipitant." },
    { id:"drug_intox", name:"Drug intoxication / poisoning", system:"Toxicology",
      find:{ alteredSensorium:36, drugOverdose:42, seizure:8, fever:-10, neckStiffness:-12 },
      inv:["Toxidrome assessment","Paracetamol/salicylate levels","ABG, osmolar gap"], red:["Specific antidotes where available"],
      reason:"Reduced consciousness with an overdose context points to a toxicological cause." },

    /* ---- Vascular / limb ---- */
    { id:"dvt", name:"Deep vein thrombosis", system:"Vascular",
      find:{ legSwellingUnilateral:38, calfTenderness:30, anticoagulated:-8, fever:-12 },
      inv:["Compression ultrasound (Doppler)","D-dimer","Wells score"], red:["Anticoagulate; assess for PE"],
      reason:"Unilateral leg swelling and calf tenderness suggest DVT rather than cellulitis." },

    /* ---- Pulmonary / cardiac extras ---- */
    { id:"asthma_exac", name:"Asthma exacerbation", system:"Pulmonary",
      find:{ dyspnea:34, cough:14, hypoxia:12, fever:-8, purulentSputum:-8 },
      inv:["Peak flow / spirometry","ABG if severe","CXR if atypical"], red:["Silent chest / exhaustion → life-threatening"],
      reason:"Episodic breathlessness and wheeze without fever or consolidation suggests bronchospasm." },
    { id:"atrial_fib", name:"Atrial fibrillation / arrhythmia", system:"Cardiology",
      find:{ palpitations:38, dyspnea:14, syncope:12, chestPain:8, knownHeartFailure:8 },
      inv:["12-lead ECG","Electrolytes, TSH","Echocardiogram"], red:["Rate/rhythm control; anticoagulation per CHA₂DS₂-VASc"],
      reason:"Palpitations ± breathlessness suggest a tachyarrhythmia; an ECG is the key test." },
    { id:"aortic_stenosis", name:"Aortic stenosis (syncope)", system:"Cardiology",
      find:{ syncope:32, exertionalChestPain:20, dyspnea:16, ageOver50:12, palpitations:6 },
      inv:["Echocardiogram","ECG","Examine for ejection systolic murmur"], red:["Exertional syncope is a red flag"],
      reason:"Exertional syncope with an ejection systolic murmur suggests severe aortic stenosis." },

    /* ---- Abdominal cluster ---- */
    { id:"pancreatitis", name:"Acute pancreatitis", system:"Gastroenterology",
      find:{ abdominalPain:34, severeAbdominalPain:24, nauseaVomiting:18, backPain:14, fever:6 },
      inv:["Serum lipase/amylase (>3× ULN)","CT abdomen if severe/uncertain","Ultrasound for gallstones"], red:["Assess severity (organ failure) — may need ICU"],
      reason:"Severe epigastric pain radiating to the back with raised lipase indicates pancreatitis." },
    { id:"peptic_ulcer", name:"Peptic ulcer disease / upper GI bleed", system:"Gastroenterology",
      find:{ abdominalPain:24, melena:30, hematemesis:30, anticoagulated:10, fever:-10 },
      inv:["Upper GI endoscopy","CBC, crossmatch","Stop NSAIDs; start PPI infusion"], red:["Haemodynamic instability → resuscitate, urgent endoscopy"], tools:["ppi"],
      reason:"Epigastric pain with melena or haematemesis suggests bleeding peptic ulcer disease." },
    { id:"bowel_obstruction", name:"Bowel obstruction", system:"Surgical / GI",
      find:{ abdominalPain:28, abdominalDistension:30, nauseaVomiting:20, constipationOrDiarrhea:12, fever:-6 },
      inv:["Erect/supine abdominal X-ray or CT","NG decompression","Surgical review"], red:["Strangulation / perforation → emergency surgery"],
      reason:"Colicky pain with distension and vomiting and absolute constipation suggests obstruction." },
    { id:"mesenteric_ischemia", name:"Acute mesenteric ischemia", system:"Vascular / GI",
      find:{ severeAbdominalPain:36, abdominalPain:18, atrialFibHx:18, ageOver50:12, raised_lactate:16, fever:-4 },
      inv:["CT angiography (mesenteric)","Lactate","Urgent surgical/vascular review"], red:["Pain out of proportion to exam — time-critical"],
      reason:"Severe pain out of proportion to examination, especially with AF or vascular disease, suggests mesenteric ischaemia." },
    { id:"biliary_colic", name:"Biliary colic / cholelithiasis", system:"Gastroenterology",
      find:{ rightUpperQuadrantPain:34, nauseaVomiting:16, murphySign:10, fever:-12, jaundice:-6 },
      inv:["Abdominal ultrasound","LFTs"], red:["Fever/jaundice → cholecystitis/cholangitis (infective)"],
      reason:"Episodic RUQ pain after meals without fever suggests biliary colic rather than infection." },
    { id:"renal_colic", name:"Renal / ureteric colic", system:"Urology",
      find:{ flankPain:34, nauseaVomiting:14, hematuria:24, feverGU:-14, dysuria:-6 },
      inv:["Non-contrast CT KUB","Urinalysis (haematuria)"], red:["Fever with obstruction → emergency (infected obstructed system)"],
      reason:"Severe colicky flank pain radiating to the groin with haematuria and no fever suggests a stone." },
    { id:"aaa", name:"Ruptured abdominal aortic aneurysm", system:"Vascular emergency",
      find:{ abdominalPain:24, backPain:30, hypotension:26, syncope:16, ageOver50:14, pulsatileMass:30 },
      inv:["Bedside aortic ultrasound / CT","Crossmatch; vascular surgery NOW"], red:["Hypotension + back pain + pulsatile mass = surgical emergency"],
      reason:"Back/abdominal pain with hypotension in an older patient is a ruptured AAA until proven otherwise." },

    /* ---- Endocrine / metabolic / neuro ---- */
    { id:"thyroid_storm", name:"Thyroid storm", system:"Endocrine",
      find:{ fever:18, tachycardia:24, palpitations:20, alteredSensorium:16, diarrhea:10 },
      inv:["TFTs (TSH↓, free T4/T3↑)","ECG","Burch-Wartofsky score"], red:["Life-threatening — beta-blockade, antithyroid drugs"],
      reason:"Fever, tachycardia and agitation with thyrotoxic features suggest thyroid storm — a non-infectious cause of fever." },
    { id:"seizure_epilepsy", name:"Seizure / epilepsy", system:"Neurology",
      find:{ seizure:44, alteredSensorium:18, fever:-8 },
      inv:["Glucose, electrolytes, calcium","EEG","Neuroimaging if first seizure/focal"], red:["Status epilepticus → emergency"],
      reason:"Witnessed convulsion with post-ictal state; exclude metabolic and structural causes." },
    { id:"vasovagal_syncope", name:"Vasovagal / orthostatic syncope", system:"Neurology / Cardiology",
      find:{ syncope:36, palpitations:-6, exertionalChestPain:-10, fever:-10 },
      inv:["Lying/standing BP","ECG (exclude arrhythmia)"], red:["Exertional or cardiac syncope needs cardiac workup"],
      reason:"Situational syncope with prodrome and rapid recovery, without cardiac features, suggests a vasovagal cause." },

    /* ---- Haematology / oncology / rheumatology ---- */
    { id:"anemia_sympt", name:"Symptomatic anaemia", system:"Hematology",
      find:{ dyspnea:22, palpitations:16, weightLoss:8, melena:12, fever:-8 },
      inv:["CBC, peripheral smear","Iron studies, B12/folate","Identify blood loss"], red:["Active bleeding → resuscitate"],
      reason:"Exertional breathlessness and palpitations with pallor suggest anaemia; seek the cause." },
    { id:"malignancy_b", name:"Malignancy (B-symptoms)", system:"Oncology",
      find:{ weightLoss:34, prolongedFever:16, lymphadenopathy:20, nightSweats:18, hepatosplenomegaly:12 },
      inv:["Imaging directed to site","Biopsy/histology","LDH, blood film"], red:["Persistent unexplained B-symptoms warrant urgent workup"],
      reason:"Weight loss, night sweats and lymphadenopathy raise concern for lymphoma or other malignancy." },
    { id:"crystal_arthritis", name:"Crystal arthritis (gout / pseudogout)", system:"Rheumatology",
      find:{ polyarthralgia:24, jointSwelling:30, fever:8 },
      inv:["Joint aspiration + polarised microscopy","Serum urate (off-attack)"], red:["Septic arthritis must be excluded by aspiration"],
      reason:"Acute mono/oligoarticular hot joint may be crystal-induced — but exclude septic arthritis by aspiration." },

    /* ---- Further Internal Medicine breadth ---- */
    { id:"sle_flare", name:"SLE / autoimmune flare", system:"Rheumatology",
      find:{ polyarthralgia:28, rash:22, jointSwelling:16, fever:12, weightLoss:8, hematuria:8 },
      inv:["ANA / anti-dsDNA, complement","Urinalysis (active sediment)","CBC (cytopenias)"], red:["Exclude infection before escalating immunosuppression"],
      reason:"Polyarthralgia with rash, cytopenias and serositis in the right patient suggests a lupus flare rather than infection." },
    { id:"vasculitis", name:"Systemic vasculitis", system:"Rheumatology",
      find:{ rash:20, polyarthralgia:18, fever:14, hematuria:18, weightLoss:14, focalNeuroDeficit:8 },
      inv:["ANCA, complement","Urinalysis + renal function","Biopsy of affected organ"], red:["Rapidly progressive renal/pulmonary involvement is an emergency"],
      reason:"Multisystem disease with palpable purpura, glomerulonephritis and constitutional symptoms suggests a systemic vasculitis." },
    { id:"hyperthyroidism", name:"Thyrotoxicosis (uncomplicated)", system:"Endocrine",
      find:{ palpitations:28, weightLoss:22, tachycardia:18, diarrhea:8, fever:-6 },
      inv:["TFTs (TSH↓, free T4/T3↑)","ECG"], red:["Escalation to thyroid storm if fever/altered sensorium"],
      reason:"Palpitations, weight loss and tachycardia with appetite preserved suggest thyrotoxicosis." },
    { id:"ild", name:"Interstitial lung disease", system:"Pulmonary",
      find:{ dyspnea:30, hypoxia:18, bilateralCrackles:24, weightLoss:8, fever:-10 },
      inv:["High-resolution CT chest","Pulmonary function tests","Autoimmune serology"], red:["Acute exacerbation can be life-threatening"],
      reason:"Progressive exertional dyspnoea with fine bibasal crackles and no fever points to interstitial lung disease." },
    { id:"pleural_effusion", name:"Pleural effusion", system:"Pulmonary",
      find:{ dyspnea:26, pleuriticChestPain:16, hypoxia:10, fever:-4 },
      inv:["CXR / thoracic ultrasound","Diagnostic pleural tap (Light's criteria)"], red:["Empyema if infected — needs drainage"],
      reason:"Breathlessness with reduced breath sounds and stony dullness suggests a pleural effusion; tap to characterise." },
    { id:"tamponade", name:"Cardiac tamponade", system:"Cardiology / Emergency",
      find:{ dyspnea:24, hypotension:30, raisedJVP:30, tachycardia:18, chestPain:8 },
      inv:["Urgent echocardiogram","ECG (electrical alternans)"], red:["Obstructive shock — urgent pericardiocentesis"],
      reason:"Hypotension with raised JVP and muffled heart sounds (Beck's triad) suggests cardiac tamponade." },
    { id:"htn_emergency", name:"Hypertensive emergency", system:"Cardiology / Neuro",
      find:{ headache:22, hypertensionHx:24, visualDisturbance:16, papilledema:18, chestPain:12, focalNeuroDeficit:10 },
      inv:["BP (both arms), fundoscopy","ECG, troponin, renal function","CT head if neuro signs"], red:["Controlled BP reduction; identify target-organ damage"],
      reason:"Severe hypertension with headache, visual or neurological symptoms indicates a hypertensive emergency with end-organ damage." },
    { id:"glomerulonephritis", name:"Acute glomerulonephritis", system:"Nephrology",
      find:{ hematuria:30, legSwellingBilateral:22, hypertensionHx:16, headache:6, fever:-4 },
      inv:["Urinalysis (dysmorphic RBCs, casts)","Renal function, complement","ASO / autoimmune serology"], red:["Rapidly progressive GN needs urgent nephrology"],
      reason:"Haematuria with oedema and hypertension (nephritic picture) suggests acute glomerulonephritis." },
    { id:"toxic_hepatitis", name:"Drug-induced / toxic hepatitis", system:"Hepatology / Toxicology",
      find:{ jaundice:28, rightUpperQuadrantPain:18, nauseaVomiting:12, drugOverdose:18, alteredSensorium:8, fever:-6 },
      inv:["LFTs, INR (synthetic function)","Paracetamol level","Stop the offending agent"], red:["Acute liver failure (coagulopathy + encephalopathy) → transplant referral"],
      reason:"Jaundice and transaminitis after a hepatotoxic drug/overdose, without sepsis, suggests toxic hepatitis." },
    { id:"ibd_flare", name:"Inflammatory bowel disease flare", system:"Gastroenterology",
      find:{ diarrhea:26, bloodyStool:26, abdominalPain:16, weightLoss:12, fever:6 },
      inv:["Stool studies (exclude infection/C. difficile)","CRP, faecal calprotectin","Endoscopy"], red:["Toxic megacolon — surgical emergency"],
      reason:"Chronic bloody diarrhoea with weight loss suggests an IBD flare, but infective colitis must be excluded first." },
    { id:"ttp_hus", name:"Thrombotic microangiopathy (TTP/HUS)", system:"Hematology",
      find:{ thrombocytopenia:30, alteredSensorium:16, fever:10, focalNeuroDeficit:8, hematuria:6 },
      inv:["Blood film (schistocytes)","LDH, haptoglobin, bilirubin","ADAMTS13"], red:["Haematological emergency — urgent plasma exchange"],
      reason:"Microangiopathic haemolysis with thrombocytopenia and neurological signs suggests TTP — do not transfuse platelets reflexively." },

    /* ---- Neurology / neuromuscular ---- */
    { id:"gbs", name:"Guillain-Barré syndrome", system:"Neurology",
      find:{ ascendingWeakness:42, focalNeuroDeficit:12, dyspnea:12, fever:-8, neckStiffness:-6 },
      inv:["Nerve conduction studies","CSF (albuminocytologic dissociation)","Serial vital capacity / NIF"], red:["Respiratory failure & autonomic instability — monitor FVC, may need ventilation"],
      reason:"Progressive ascending weakness with areflexia and no fever suggests Guillain-Barré; watch respiratory function." },
    { id:"myasthenic_crisis", name:"Myasthenic crisis", system:"Neurology",
      find:{ dyspnea:26, visualDisturbance:18, ascendingWeakness:16, fever:-6 },
      inv:["Serial FVC/NIF","Anti-AChR / anti-MuSK","Exclude infective trigger"], red:["Bulbar/respiratory weakness — airway support; avoid precipitating drugs"],
      reason:"Fatigable weakness with diplopia and respiratory compromise suggests a myasthenic crisis." },
    { id:"cord_compression", name:"Spinal cord compression", system:"Neurology / Emergency",
      find:{ backPain:28, focalNeuroDeficit:26, urinaryRetention:18, fever:-4 },
      inv:["Urgent whole-spine MRI","Neurosurgical / oncology review"], red:["Time-critical for neurological recovery; high-dose steroids if malignant"],
      reason:"Back pain with limb weakness and bladder dysfunction is cord compression until proven otherwise — image urgently." },

    /* ---- Endocrine / metabolic ---- */
    { id:"hhs", name:"Hyperosmolar hyperglycaemic state", system:"Endocrine",
      find:{ polyuriaPolydipsia:30, alteredSensorium:26, diabetesHx:22, ketonemia:-10, fever:-4 },
      inv:["Glucose, osmolality, electrolytes","Venous gas (minimal ketosis)","Search for precipitant"], red:["Profound dehydration — careful fluid/insulin; precipitant often infection"],
      reason:"Marked hyperglycaemia with hyperosmolar altered sensorium and minimal ketosis suggests HHS rather than DKA." },
    { id:"myxedema", name:"Myxoedema coma", system:"Endocrine",
      find:{ alteredSensorium:26, hypothermia:30, bradycardia:14, fever:-8 },
      inv:["TFTs, cortisol","ECG, electrolytes (Na↓)"], red:["IV thyroxine + hydrocortisone; treat precipitant"],
      reason:"Altered sensorium with hypothermia and bradycardia in a hypothyroid patient suggests myxoedema coma." },
    { id:"pheo", name:"Phaeochromocytoma crisis", system:"Endocrine",
      find:{ palpitations:26, headache:22, hypertensionHx:18, tachycardia:10, rash:-6 },
      inv:["Plasma/urine metanephrines","CT/MRI adrenals"], red:["Paroxysmal severe hypertension — alpha-blockade before beta"],
      reason:"Episodic headache, palpitations and sweating with paroxysmal hypertension suggests a catecholamine-secreting tumour." },
    { id:"hypercalcemia", name:"Hypercalcaemia of malignancy", system:"Oncology / Metabolic",
      find:{ alteredSensorium:18, polyuriaPolydipsia:18, nauseaVomiting:12, malignancy:24, constipationOrDiarrhea:8 },
      inv:["Corrected calcium, PTH/PTHrP","Renal function"], red:["Severe hypercalcaemia — IV fluids + bisphosphonate"],
      reason:"'Stones, bones, groans, moans' with known malignancy suggests hypercalcaemia." },

    /* ---- Toxicology ---- */
    { id:"opioid_od", name:"Opioid overdose", system:"Toxicology",
      find:{ alteredSensorium:30, drugOverdose:34, bradypnea:28, fever:-8 },
      inv:["Clinical (pinpoint pupils, ↓RR)","Trial of naloxone"], red:["Respiratory depression — naloxone + airway support"],
      reason:"Reduced consciousness with depressed respiration and pinpoint pupils is opioid toxicity until proven otherwise." },
    { id:"salicylate_tox", name:"Salicylate toxicity", system:"Toxicology",
      find:{ tachypnea:24, alteredSensorium:18, drugOverdose:24, nauseaVomiting:10, fever:6 },
      inv:["Salicylate level (serial)","ABG (mixed acid-base)","Glucose, electrolytes"], red:["Consider urinary alkalinisation / dialysis"],
      reason:"Tachypnoea with a mixed respiratory alkalosis/metabolic acidosis and tinnitus suggests salicylate poisoning." },
    { id:"serotonin_nms", name:"Serotonin syndrome / NMS", system:"Toxicology / Neuro",
      find:{ fever:18, rigidity:32, alteredSensorium:18, drugOverdose:16, tachycardia:10 },
      inv:["Medication review (serotonergics/antipsychotics)","CK, renal function","Temperature"], red:["Hyperthermia + rigidity — stop agent, cooling, supportive ICU care"],
      reason:"Fever with rigidity/clonus and altered mental state after serotonergic or antipsychotic drugs suggests a toxidrome, not infection." },
    { id:"organophosphate", name:"Organophosphate / cholinergic poisoning", system:"Toxicology",
      find:{ miosisSecretions:38, drugOverdose:18, alteredSensorium:12, bradycardia:10 },
      inv:["Clinical cholinergic toxidrome","Plasma/RBC cholinesterase"], red:["Atropine + pralidoxime; airway/secretion control"],
      reason:"Miosis, hypersalivation and bradycardia after exposure suggest organophosphate poisoning." },

    /* ---- Haematology / oncology ---- */
    { id:"dic", name:"Disseminated intravascular coagulation", system:"Hematology",
      find:{ mucocutaneousBleeding:32, thrombocytopenia:24, hypotension:12, fever:6 },
      inv:["PT/APTT, fibrinogen, D-dimer","Blood film","Treat the underlying trigger"], red:["Often secondary to sepsis/malignancy — treat the cause"],
      reason:"Diffuse bleeding with thrombocytopenia and deranged coagulation suggests DIC — find and treat the trigger." },
    { id:"acute_leukemia", name:"Acute leukaemia", system:"Hematology / Oncology",
      find:{ mucocutaneousBleeding:20, lymphadenopathy:16, weightLoss:14, fever:12, hepatosplenomegaly:14, nightSweats:10 },
      inv:["CBC + peripheral smear (blasts)","Bone marrow","Coagulation (APML risk)"], red:["Febrile neutropenia / leukostasis are emergencies"],
      reason:"Cytopenias with bleeding, infections and blasts on film suggest acute leukaemia." },
    { id:"variceal_bleed", name:"Variceal bleeding", system:"Hepatology / GI",
      find:{ hematemesis:34, melena:22, jaundice:14, ascites:10, hypotension:10 },
      inv:["Urgent upper GI endoscopy","Crossmatch, coagulation","Vasoactive (terlipressin) + antibiotic prophylaxis"], red:["Major haemorrhage — resuscitate; antibiotics reduce mortality in cirrhotic GI bleed"],
      reason:"Haematemesis/melaena in a patient with chronic liver disease suggests variceal bleeding." },
    { id:"svc_obstruction", name:"Superior vena cava obstruction", system:"Oncology / Emergency",
      find:{ facialSwelling:34, dyspnea:18, malignancy:16, cough:8 },
      inv:["CT chest with contrast","Tissue diagnosis"], red:["Airway/cerebral oedema — urgent oncology/radiotherapy"],
      reason:"Facial/upper-body swelling with distended neck veins and dyspnoea suggests SVC obstruction, often malignant." },

    /* ---- Nephrology / dermatology ---- */
    { id:"aki", name:"Acute kidney injury", system:"Nephrology",
      find:{ oliguria:30, nauseaVomiting:10, legSwellingBilateral:12, alteredSensorium:8 },
      inv:["Renal function, electrolytes (K⁺)","Urinalysis, urine output","Renal ultrasound (obstruction)"], red:["Hyperkalaemia / pulmonary oedema / acidosis may need dialysis"],
      reason:"Falling urine output with rising creatinine indicates AKI — define pre-renal / renal / post-renal and act on hyperkalaemia." },
    { id:"rhabdo", name:"Rhabdomyolysis", system:"Nephrology / Metabolic",
      find:{ myalgiaArthralgia:24, darkUrine:30, oliguria:14, alteredSensorium:6 },
      inv:["Creatine kinase (markedly raised)","Renal function, K⁺","Urine myoglobin"], red:["Aggressive fluids; watch hyperkalaemia and AKI"],
      reason:"Muscle pain with tea-coloured urine and very high CK indicates rhabdomyolysis with AKI risk." },
    { id:"sjs_ten", name:"Stevens-Johnson syndrome / TEN", system:"Dermatology / Emergency",
      find:{ rash:26, mucosalLesions:34, drugOverdose:14, fever:12 },
      inv:["Stop the culprit drug","Dermatology review","SCORTEN severity"], red:["Skin detachment — manage like a burn; high mortality"],
      reason:"Painful rash with mucosal erosions and skin detachment after a new drug suggests SJS/TEN, not cellulitis." },

    /* ---- Neurology (vascular / chronic / deficiency) ---- */
    { id:"tia", name:"Transient ischaemic attack", system:"Neurology / Vascular",
      find:{ focalNeuroDeficit:38, ageOver50:12, hypertensionHx:10, atrialFibHx:10, fever:-16, neckStiffness:-12 },
      inv:["Urgent CT/MRI + carotid imaging","ECG (AF)","ABCD² risk; start antiplatelet/statin"], red:["High early stroke risk — urgent TIA clinic / admission"],
      reason:"Transient focal neurological deficit that fully resolves suggests a TIA — high short-term stroke risk." },
    { id:"subdural", name:"Subdural haematoma", system:"Neurology / Vascular",
      find:{ headache:22, alteredSensorium:22, focalNeuroDeficit:18, headInjury:26, anticoagulated:18, ageOver50:10, fever:-10 },
      inv:["Non-contrast CT head","Coagulation; reverse anticoagulation","Neurosurgical review"], red:["Expanding bleed — may need evacuation"],
      reason:"Headache and fluctuating consciousness after a fall, especially elderly/anticoagulated, suggests a subdural haematoma." },
    { id:"wernicke", name:"Wernicke encephalopathy", system:"Neurology / Nutrition",
      find:{ alteredSensorium:24, ataxia:26, visualDisturbance:16, alcoholExcess:30, fever:-8 },
      inv:["Clinical triad (confusion, ataxia, ophthalmoplegia)","Give IV thiamine BEFORE glucose"], red:["Reversible — treat empirically with thiamine, do not delay"],
      reason:"Confusion, ataxia and eye signs in an alcohol-dependent or malnourished patient is Wernicke until proven otherwise." },
    { id:"ms", name:"Multiple sclerosis (relapse)", system:"Neurology",
      find:{ focalNeuroDeficit:30, visualDisturbance:24, ataxia:12, fever:-12 },
      inv:["MRI brain/cord with contrast","CSF oligoclonal bands","Evoked potentials"], red:["Exclude infection before high-dose steroids"],
      reason:"Subacute neurological deficits disseminated in time and space (e.g. optic neuritis) suggest demyelination." },

    /* ---- Rheumatology (chronic) ---- */
    { id:"rheumatoid", name:"Rheumatoid arthritis", system:"Rheumatology",
      find:{ polyarthralgia:32, jointSwelling:26, weightLoss:6, fever:-6 },
      inv:["RF, anti-CCP, ESR/CRP","X-rays of hands/feet"], red:["Septic arthritis can complicate a known RA joint"],
      reason:"Symmetrical small-joint pain and swelling with morning stiffness suggests rheumatoid arthritis." },
    { id:"pmr", name:"Polymyalgia rheumatica", system:"Rheumatology",
      find:{ polyarthralgia:28, ageOver50:24, weightLoss:10, fever:4 },
      inv:["ESR/CRP (markedly raised)","Assess for giant cell arteritis"], red:["Watch for GCA — visual symptoms need urgent steroids"],
      reason:"Proximal shoulder/hip girdle pain and stiffness in an older patient with high ESR suggests PMR." },

    /* ---- Hepatology / GI (chronic) ---- */
    { id:"decomp_cirrhosis", name:"Decompensated cirrhosis", system:"Hepatology",
      find:{ ascites:30, jaundice:24, asterixis:14, legSwellingBilateral:14, alteredSensorium:8, fever:-6 },
      inv:["LFTs, INR, ammonia","Ascitic tap (exclude SBP)","Identify decompensation trigger"], red:["Always tap ascites to exclude SBP (an infective trigger)"],
      reason:"Ascites and jaundice with stigmata of chronic liver disease suggest decompensated cirrhosis — look for a precipitant." },
    { id:"ibs", name:"Irritable bowel syndrome", system:"Gastroenterology",
      find:{ abdominalPain:24, constipationOrDiarrhea:18, fever:-14, weightLoss:-10, bloodyStool:-12 },
      inv:["Diagnosis of exclusion (Rome criteria)","Check alarm features absent"], red:["Weight loss, bleeding or anaemia argue AGAINST IBS — investigate"],
      reason:"Chronic abdominal pain with altered bowel habit and NO alarm features suggests IBS." },

    /* ---- Nephrology (chronic) ---- */
    { id:"ckd", name:"Chronic kidney disease", system:"Nephrology",
      find:{ legSwellingBilateral:18, oliguria:10, weightLoss:6, alteredSensorium:6, fever:-8 },
      inv:["eGFR trend, urinalysis","Renal ultrasound (small kidneys)","Anaemia/bone profile"], red:["Distinguish from AKI; manage complications (K⁺, acidosis, anaemia)"],
      reason:"Longstanding reduced renal function with anaemia and small kidneys indicates CKD rather than acute injury." },
    { id:"nephrotic", name:"Nephrotic syndrome", system:"Nephrology",
      find:{ legSwellingBilateral:28, facialSwelling:22, proteinuria:30, fever:-6 },
      inv:["Urine protein:creatinine (heavy)","Serum albumin, lipids","Renal biopsy if indicated"], red:["Thrombosis & infection risk; consider underlying cause"],
      reason:"Heavy proteinuria with oedema and hypoalbuminaemia defines the nephrotic syndrome." },

    /* ---- Haematology / oncology (chronic) ---- */
    { id:"itp", name:"Immune thrombocytopenia (ITP)", system:"Hematology",
      find:{ mucocutaneousBleeding:32, thrombocytopenia:30, fever:-10, alteredSensorium:-6 },
      inv:["CBC + film (isolated thrombocytopenia)","Exclude secondary causes"], red:["Major bleeding / very low platelets need urgent treatment"],
      reason:"Isolated thrombocytopenia with mucocutaneous bleeding in a well patient suggests ITP." },
    { id:"myeloma", name:"Multiple myeloma", system:"Hematology / Oncology",
      find:{ backPain:26, ageOver50:16, weightLoss:14, oliguria:8, fever:-4 },
      inv:["Serum/urine protein electrophoresis, free light chains","Calcium, renal function, CBC","Skeletal survey/MRI"], red:["Hypercalcaemia, renal failure, cord compression are emergencies (CRAB)"],
      reason:"Bone pain, anaemia, renal impairment and hypercalcaemia (CRAB) in an older patient suggests myeloma." },
    { id:"lung_cancer", name:"Lung cancer", system:"Oncology / Pulmonary",
      find:{ hemoptysis:28, weightLoss:24, ageOver50:14, cough:14, lymphadenopathy:8, fever:-4 },
      inv:["CXR / CT chest","Bronchoscopy / biopsy","Staging imaging"], red:["Haemoptysis with weight loss in a smoker — urgent 2-week-wait pathway"],
      reason:"Haemoptysis and weight loss in an older smoker raise concern for bronchogenic carcinoma." },
    { id:"sarcoidosis", name:"Sarcoidosis", system:"Pulmonary / Multisystem",
      find:{ lymphadenopathy:22, dyspnea:16, polyarthralgia:14, cough:12, rash:10, fever:6 },
      inv:["CXR (bilateral hilar lymphadenopathy)","Serum ACE, calcium","Biopsy (non-caseating granuloma)"], red:["Exclude TB/lymphoma before steroids"],
      reason:"Bilateral hilar lymphadenopathy with multisystem involvement suggests sarcoidosis — exclude TB/lymphoma." },

    /* ---- Electrolyte / metabolic / functional ---- */
    { id:"hyponatremia", name:"Symptomatic hyponatraemia / SIADH", system:"Metabolic",
      find:{ alteredSensorium:24, seizure:14, nauseaVomiting:12, fever:-8 },
      inv:["Serum & urine osmolality, urine Na⁺","Volume status assessment"], red:["Correct slowly (osmotic demyelination risk)"],
      reason:"Confusion or seizures with low sodium suggest symptomatic hyponatraemia — establish the mechanism before correcting." },
    { id:"hyperkalemia", name:"Hyperkalaemia", system:"Metabolic / Nephrology",
      find:{ palpitations:18, ascendingWeakness:16, bradycardia:10, oliguria:10 },
      inv:["Urgent ECG (peaked T waves)","Repeat K⁺, renal function","Calcium gluconate + insulin-dextrose"], red:["Risk of fatal arrhythmia — treat empirically on ECG changes"],
      reason:"Weakness and bradyarrhythmia with renal impairment suggest hyperkalaemia — an ECG-confirmed emergency." },
    { id:"panic", name:"Panic attack / anxiety", system:"Functional",
      find:{ palpitations:28, chestPain:16, dyspnea:16, fever:-16, hypoxia:-12, ecgIschemia:-12 },
      inv:["Diagnosis of exclusion — rule out ACS/PE first","ECG normal"], red:["Do not anchor on anxiety until cardiac/pulmonary emergencies excluded"],
      reason:"Palpitations, chest tightness and breathlessness in a young patient with normal workup may be a panic attack — but exclude organic causes." },
    { id:"angioedema_acei", name:"ACE-inhibitor / hereditary angioedema", system:"Allergy / Emergency",
      find:{ facialSwelling:34, dyspnea:18, rash:-12, fever:-8 },
      inv:["Airway assessment","C1-esterase inhibitor / C4 if recurrent"], red:["Airway swelling — secure airway; not always histamine-mediated"],
      reason:"Facial/tongue swelling WITHOUT urticaria (often on an ACE inhibitor) suggests bradykinin-mediated angioedema." }
  ];

  /* ---------------------------------------------------------------------- *
   * SMART BEDSIDE-TOOL TRIGGERS — a diagnosis surfaces the relevant existing
   * StewardMD calculators/protocols. Keyed by diagnosis id (works for both
   * infectious syndrome ids and non-infectious ids).
   * ---------------------------------------------------------------------- */
  function inf(fn) { return function () { try { close(); } catch (e) {} try { if (window.INF) fn(window.INF); } catch (e) {} }; }
  var TOOLREG = {
    vaso:       { icon: "💉", label: "Vasopressor / infusion calculator", run: inf(function (I) { I.openDrug("noradrenaline"); }) },
    dashboard:  { icon: "🩺", label: "ICU dashboard — MAP · lactate · urine output", run: inf(function (I) { I.openDashboard(); }) },
    insulin:    { icon: "💉", label: "Insulin infusion (DKA)", run: inf(function (I) { I.openDrug("insulin"); }) },
    ppi:        { icon: "💊", label: "PPI infusion (pantoprazole) — GI bleed", run: inf(function (I) { I.openDrug("pantoprazole"); }) },
    furosemide: { icon: "💧", label: "Furosemide infusion", run: inf(function (I) { I.openDrug("furosemide"); }) },
    gtn:        { icon: "💊", label: "Nitroglycerin infusion", run: inf(function (I) { I.openDrug("nitroglycerin"); }) },
    heparin:    { icon: "🩸", label: "Heparin infusion", run: inf(function (I) { I.openDrug("heparin"); }) },
    amiodarone: { icon: "❤️", label: "Amiodarone infusion", run: inf(function (I) { I.openDrug("amiodarone"); }) },
    stroke:     { icon: "🧠", label: "Stroke score (A2DS2)", run: function () { try { close(); } catch (e) {} try { if (window.SB) SB.calc("a2ds2"); } catch (e) {} } }
  };
  var TOOLMAP = {
    // infectious (syndrome ids)
    SEPTIC_SHOCK: ["vaso", "dashboard"], SEPSIS: ["dashboard"], FEBRILE_NEUTROPENIA: ["dashboard"],
    // non-infectious
    cardiogenic_shock: ["vaso", "dashboard", "furosemide"], hypovolemic_shock: ["dashboard", "ppi"],
    adrenal_crisis: ["vaso", "dashboard"], anaphylaxis: ["vaso"], dka: ["insulin"],
    peptic_ulcer: ["ppi"], heart_failure: ["furosemide", "gtn"], acs: ["gtn", "heparin"],
    pe: ["heparin"], atrial_fib: ["amiodarone"], ischemic_stroke: ["stroke"], ich: ["stroke"],
    sah: ["stroke"], mesenteric_ischemia: ["dashboard"], aaa: ["vaso", "dashboard"]
  };
  function toolsFor(id) { return (TOOLMAP[id] || []).filter(function (t) { return TOOLREG[t]; }); }
  function runTool(id) { if (TOOLREG[id]) TOOLREG[id].run(); }

  // which infection each non-infectious diagnosis can mimic (spec: explain WHY)
  var MIMIC = {
    pulm_edema:"pneumonia", pe:"pneumonia", pneumothorax:"pneumonia", asthma_exac:"pneumonia", copd_exac_ni:"pneumonia",
    cardiogenic_shock:"septic shock", hypovolemic_shock:"septic shock", adrenal_crisis:"septic shock", anaphylaxis:"septic shock",
    dvt:"cellulitis", crystal_arthritis:"septic arthritis",
    sah:"meningitis", ischemic_stroke:"meningitis", ich:"meningitis", metabolic_enceph:"CNS infection",
    hepatic_enceph:"CNS infection / SBP", drug_intox:"CNS infection", seizure_epilepsy:"CNS infection",
    dka:"sepsis", thyroid_storm:"sepsis", biliary_colic:"cholangitis", mesenteric_ischemia:"intra-abdominal sepsis",
    pancreatitis:"intra-abdominal sepsis", malignancy_b:"occult infection / PUO",
    ild:"pneumonia", pleural_effusion:"empyema", tamponade:"septic shock", toxic_hepatitis:"viral hepatitis",
    ibd_flare:"infective colitis", ttp_hus:"sepsis / meningococcaemia", sle_flare:"PUO / sepsis", vasculitis:"endocarditis / PUO",
    glomerulonephritis:"UTI / post-infectious", htn_emergency:"meningitis / encephalitis",
    gbs:"CNS infection / polio", myasthenic_crisis:"aspiration pneumonia", cord_compression:"spinal/epidural abscess",
    hhs:"sepsis", myxedema:"sepsis", serotonin_nms:"meningitis / sepsis", opioid_od:"CNS infection",
    salicylate_tox:"sepsis", organophosphate:"sepsis", dic:"sepsis", acute_leukemia:"PUO / occult infection",
    variceal_bleed:"SBP", svc_obstruction:"mediastinitis", aki:"urosepsis", rhabdo:"sepsis", sjs_ten:"cellulitis / SSSS",
    tia:"meningitis / encephalitis", subdural:"meningitis", wernicke:"CNS infection", ms:"CNS infection",
    decomp_cirrhosis:"SBP", ibs:"infective colitis", nephrotic:"cellulitis (oedema)", myeloma:"vertebral osteomyelitis",
    lung_cancer:"TB / pneumonia", sarcoidosis:"TB", hyponatremia:"CNS infection", panic:"sepsis (tachypnoea)",
    angioedema_acei:"Ludwig's angina / deep-neck infection"
  };

  /* ---------------------------------------------------------------------- *
   * CONSULTANT REASONING META — weighted findings + organ-system mapping.
   * Diagnostic value is NOT equal: a disease-defining sign (neck stiffness)
   * far outweighs a non-specific one (fever). The dominant organ system,
   * derived from weighted findings, shapes the differential.
   * ---------------------------------------------------------------------- */
  var FW_VERYHIGH = {neckStiffness:1,pleuriticChestPain:1,murphySign:1,hemoptysis:1,focalNeuroDeficit:1,hypotension:1,thunderclapHeadache:1,ecgIschemia:1,ascendingWeakness:1,miosisSecretions:1,mucosalLesions:1,costovertebralTenderness:1,exertionalChestPain:1,ketonemia:1,raisedJVP:1,pulsatileMass:1,asterixis:1,petechialRash:1,oliguria:1,proteinuria:1,eschar:1,bilateralCrackles:1,hematemesis:1,facialSwelling:1,sickleCellHx:1,rigidity:1,photophobia:1,bloodyStool:1,jaundice:1,seizure:1,hematuria:1,thrombocytopenia:1};
  var FW_LOW = {fever:1,headache:1,fatigue:1,weakness:1,malaise:1,tachycardia:1,tachypnea:1,rigors:1,cough:1,nauseaVomiting:1,myalgiaArthralgia:1,weightLoss:1,ageOver50:1};
  function fw(k) { return FW_VERYHIGH[k] ? 3 : (FW_LOW[k] ? 1 : 2); }

  var GROUP_TAG = { "General / Vitals":"GEN","Respiratory":"RESP","Gastrointestinal":"GI","Genitourinary":"GU","Central Nervous System":"CNS","Cardiac":"CVS","Tropical Fever":"ID","Skin / Soft Tissue":"DERM","Sepsis / Oncology-Specific":"GEN" };
  var EXTRA_TAG = { headache:"CNS",thunderclapHeadache:"CNS",chestPain:"CVS",pleuriticChestPain:"RESP",exertionalChestPain:"CVS",dyspnea:"RESP",orthopnea:"CVS",palpitations:"CVS",backPain:"MSK",visualDisturbance:"CNS",polyarthralgia:"MSK",legSwellingUnilateral:"CVS",legSwellingBilateral:"CVS",calfTenderness:"CVS",raisedJVP:"CVS",bilateralCrackles:"RESP",asterixis:"HEP",ecgIschemia:"CVS",ketonemia:"ENDO",polyuriaPolydipsia:"ENDO",knownCAD:"CVS",knownHeartFailure:"CVS",hypertensionHx:"CVS",diabetesHx:"ENDO",steroidUse:"ENDO",drugOverdose:"TOX",anticoagulated:"HEME",atrialFibHx:"CVS",pulsatileMass:"CVS",hematemesis:"GI",hematuria:"GU",jointSwelling:"MSK",ascendingWeakness:"CNS",rigidity:"TOX",hypothermia:"GEN",bradycardia:"CVS",bradypnea:"RESP",miosisSecretions:"TOX",mucocutaneousBleeding:"HEME",oliguria:"RENAL",mucosalLesions:"DERM",facialSwelling:"GEN",sickleCellHx:"HEME",headInjury:"CNS",alcoholExcess:"GEN",ataxia:"CNS",proteinuria:"RENAL",jaundice:"HEP",rightUpperQuadrantPain:"HEP",murphySign:"HEP",ascites:"HEP",flankPain:"GU",dysuria:"GU",feverGU:"GU",costovertebralTenderness:"GU" };
  var FSYS = {}; // findingKey -> organ tag (populated in buildOntology)

  function dzTag(systemStr) {
    var s = String(systemStr || "").toLowerCase();
    if (/neuro|cns|central nervous/.test(s)) return "CNS";
    if (/cardio|cardiac|vascular/.test(s)) return "CVS";
    if (/pulmon|resp|lung/.test(s)) return "RESP";
    if (/genitourinary|urolog|urinary/.test(s)) return "GU";
    if (/hepat|liver|biliary/.test(s)) return "HEP";
    if (/gastro|gi\b|abdom/.test(s)) return "GI";
    if (/rheum|musculoskeletal|joint/.test(s)) return "MSK";
    if (/hemat|heme/.test(s)) return "HEME";
    if (/endocrin|metabolic/.test(s)) return "ENDO";
    if (/nephro|renal/.test(s)) return "RENAL";
    if (/tox/.test(s)) return "TOX";
    if (/derm|skin/.test(s)) return "DERM";
    return "GEN";
  }
  var TAG_LABEL = { CNS:"Neurological", CVS:"Cardiovascular", RESP:"Respiratory", GU:"Genitourinary", HEP:"Hepatobiliary", GI:"Gastrointestinal", MSK:"Musculoskeletal", HEME:"Haematological", ENDO:"Endocrine/Metabolic", RENAL:"Renal", TOX:"Toxicological", DERM:"Dermatological", ID:"Systemic/Infective", GEN:"General" };
  // dominant organ system(s) from the weighted findings present
  function dominantSystems() {
    var sc = {};
    for (var k in S.f) { var t = FSYS[k] || "GEN"; if (t === "GEN" || t === "ID") continue; sc[t] = (sc[t] || 0) + fw(k); }
    var max = 0, t2; for (t2 in sc) if (sc[t2] > max) max = sc[t2];
    var dom = {}; if (max >= 2) { for (t2 in sc) if (sc[t2] >= max - 1 && sc[t2] >= 2) dom[t2] = sc[t2]; }
    return { scores: sc, dom: dom, max: max };
  }
  function systemMod(tag, hasVHIsupport, dom) {
    if (!Object.keys(dom).length || tag === "GEN" || tag === "ID") return 0;
    if (dom[tag]) return 6;                 // diagnosis lies in a dominant system
    return hasVHIsupport ? 0 : -12;         // outside dominant system & no strong (very-high) evidence
  }

  /* ---------------------------------------------------------------------- *
   * ONTOLOGY — merge real FIELD_GROUPS with EXTRA_GROUPS
   * ---------------------------------------------------------------------- */
  var ONT = null, LABEL = {}, VALID = {}, GENERAL = [], SYSPICK = [];
  function buildOntology() {
    if (ONT) return ONT;
    var groups = [];
    (EXTRA_GROUPS).forEach(function (g) { groups.push(g); });
    var fg = (window.FIELD_GROUPS || []);
    fg.forEach(function (g) { if (g && g.fields) groups.push({ group: g.group, fields: g.fields }); });
    groups.forEach(function (g) {
      g.fields.forEach(function (fl) {
        LABEL[fl.key] = fl.label; VALID[fl.key] = true;
        FSYS[fl.key] = EXTRA_TAG[fl.key] || GROUP_TAG[g.group] || "GEN";
      });
    });
    ONT = groups;
    // Step-1 general findings + Step-2 body systems (from the live app ontology)
    GENERAL = (window.CORE_VITALS || ["fever","hypotension","tachycardia","tachypnea","alteredSensorium","hypoxia"]).filter(function (k) { return LABEL[k]; });
    if (LABEL.weightLoss && GENERAL.indexOf("weightLoss") < 0) GENERAL.push("weightLoss");
    SYSPICK = (window.SYSTEM_PICKER_MAP && window.SYSTEM_PICKER_MAP.length) ? window.SYSTEM_PICKER_MAP
      : fg.filter(function (g) { return g.group && g.group.indexOf("Vitals") < 0 && g.group.indexOf("MDR") < 0 && g.group.indexOf("Course") < 0; })
           .map(function (g) { return { id: g.group, label: g.group, icon: "•", groups: [g.group] }; });
    return ONT;
  }
  function fieldsForSystem(sysId) {
    var sp = null; SYSPICK.forEach(function (x) { if (x.id === sysId) sp = x; });
    if (!sp) return { sp: null, fields: [] };
    var out = [];
    (sp.groups || []).forEach(function (gn) { ONT.forEach(function (g) { if (g.group === gn) out = out.concat(g.fields); }); });
    return { sp: sp, fields: out };
  }
  function lbl(k) { return LABEL[k] || k; }

  /* ---------------------------------------------------------------------- *
   * INFECTIOUS introspection — derive each syndrome's associated finding
   * keys from its match()/baseScore() source (∩ valid keys). Cached.
   * ---------------------------------------------------------------------- */
  var ASSOC = {}, IDF = null, NSYN = 0;
  // specificity: findings shared by many syndromes (e.g. fever) carry little
  // discriminating weight; rare findings (e.g. neck stiffness) carry a lot.
  function computeIDF() {
    if (IDF) return IDF;
    IDF = {};
    var syn = window.SYNDROMES || {}, ids = Object.keys(syn), df = {};
    NSYN = ids.length || 1;
    ids.forEach(function (id) { assocKeys(syn[id]).forEach(function (k) { df[k] = (df[k] || 0) + 1; }); });
    Object.keys(VALID).forEach(function (k) { IDF[k] = Math.log((NSYN + 1) / ((df[k] || 0) + 1)) + 0.15; });
    return IDF;
  }
  function assocKeys(s) {
    var _kbc = (window.KB_CORE && KB_CORE.diseases) ? KB_CORE.diseases[s.id] : null;
    if (_kbc && _kbc.assoc) return _kbc.assoc;   // KB is the runtime source of truth (P3)
    if (ASSOC[s.id]) return ASSOC[s.id];
    var src = "";
    try { src += s.match ? s.match.toString() : ""; } catch (e) {}
    try { src += " " + (s.baseScore ? s.baseScore.toString() : ""); } catch (e) {}
    try { if (s.decision && s.decision.reasoning) src += " " + s.decision.reasoning.toString(); } catch (e) {}
    var keys = {}, m, re = /\.([a-zA-Z][a-zA-Z0-9_]*)/g;
    while ((m = re.exec(src))) { if (VALID[m[1]]) keys[m[1]] = true; }
    ASSOC[s.id] = Object.keys(keys);
    return ASSOC[s.id];
  }

  /* ---------------------------------------------------------------------- *
   * ENGINE state + scoring
   * ---------------------------------------------------------------------- */
  var S = { f: {}, fInf: {}, prev: {}, expanded: {}, started: false, system: null, showRare: false, workspace: false, advOpen: false, timeline: [], compare: [], lastAdded: null };

  // centralised finding-add so the reasoning timeline is recorded consistently
  function addFinding(k) {
    if (S.f[k]) return;
    // snapshot pre-change scores so confidence deltas persist until the next finding
    try { var dp = differential(); var snap = {}; dp.inf.concat(dp.ni).forEach(function (r) { snap[r.id] = r.score; }); S.prev = snap; } catch (e) {}
    S.f[k] = true; S.started = true; S.lastAdded = LABEL[k] || k; S.lastAddedKey = k;
    try {
      var d0 = differential(); var top = d0.inf[0] || d0.ni[0];
      S.timeline.push({ f: LABEL[k] || k, topName: top ? top.name : null, topScore: top ? top.score : null });
    } catch (e) {}
    recompute();
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* ---- KB declarative evaluator (P3 runtime source of truth; mirrors kb/engine/evaluator.mjs).
     When window.KB_CORE is present the engine scores from the KB's declarative rule/score
     instead of the per-syndrome match()/baseScore() closures. Proven byte-identical by the
     parity fuzz + golden harness; falls back to the closures if KB_CORE is absent. ---- */
  function kbEvalRule(rule, e) {
    if (rule == null) return true;
    if (typeof rule === "string") return !!e[rule];
    if (Array.isArray(rule)) return rule.every(function (r) { return kbEvalRule(r, e); });
    if (rule.allOf) return rule.allOf.every(function (r) { return kbEvalRule(r, e); });
    if (rule.anyOf) return rule.anyOf.some(function (r) { return kbEvalRule(r, e); });
    if (Object.prototype.hasOwnProperty.call(rule, "not")) return !kbEvalRule(rule.not, e);
    if (Object.prototype.hasOwnProperty.call(rule, "key")) {
      var v = e[rule.key];
      if ("gte" in rule) return v >= rule.gte; if ("gt" in rule) return v > rule.gt;
      if ("lte" in rule) return v <= rule.lte; if ("lt" in rule) return v < rule.lt;
      if ("eq" in rule) return v === rule.eq; return !!v;
    }
    return false;
  }
  function kbEvalScore(sm, e) { if (!sm) return 0; var i = sm.base || 0; var mo = sm.modifiers || []; for (var n = 0; n < mo.length; n++) if (kbEvalRule(mo[n].when, e)) i += mo[n].add; return i; }
  function kbDisease(id) { return (window.KB_CORE && KB_CORE.diseases) ? KB_CORE.diseases[id] : null; }
  // KB "why this" reason interpolator — renders the declarative template (no eval).
  function kbRenderNode(node, e) {
    if (!node) return "";
    switch (node[0]) {
      case "lit": return node[1];
      case "seq": { var s = ""; for (var i = 1; i < node.length; i++) s += kbRenderNode(node[i], e); return s; }
      case "cond": return kbEvalRule(node[1], e) ? kbRenderNode(node[2], e) : kbRenderNode(node[3], e);
      case "join": { var arr = []; node[3].forEach(function (t) { if (kbEvalRule(t[0], e)) arr.push(t[1]); }); return arr.length ? arr.join(node[1]) : node[2]; }
      case "var": return String(e[node[1]] || 0);
    }
    return "";
  }
  function kbReason(disease, e) {
    if (!disease || !disease.reason) return null;
    var ee = e;
    if (disease.derived) { ee = {}; for (var x in e) ee[x] = e[x]; for (var k in disease.derived) { var c = 0; disease.derived[k].forEach(function (r) { if (kbEvalRule(r, e)) c++; }); ee[k] = c; } }
    return kbRenderNode(disease.reason, ee);
  }
  // T2-display: make the runtime display layer read the clinical fields from the KB.
  // Overwrites SYNDROMES display fields + repoints DDX_NI from kb.clinical (data is
  // lossless vs the legacy literals -> byte-identical; tamper-provable as KB-driven).
  // Known display fields are assigned; the decision object's known fields are mutated
  // (any other fields preserved) so there is no field-loss risk. Idempotent.
  var _kbClinicalApplied = false;
  function kbApplyClinical() {
    if (_kbClinicalApplied) return;
    if (!(window.KB_CLINICAL && window.KB_CORE && window.SYNDROMES)) return;
    var clin = window.KB_CLINICAL.syndromes, core = window.KB_CORE.diseases, S = window.SYNDROMES;
    Object.keys(clin).forEach(function (id) {
      var c = clin[id], k = core[id], s = S[id]; if (!s) return;
      s.name = c.name; s.system = c.system;
      s.toxicityFactors = c.toxicityFactors; s.pathogens = c.pathogens;
      s.firstLine = c.firstLine; s.alternatives = c.alternatives;
      s.coverageMatrix = c.coverageMatrix; s.stewardship = c.stewardship;
      s.investigations = c.investigations; s.deescalation = c.deescalation;
      s.references = c.references; s.regimens = c.regimens;
      s.antibioticRelevant = c.antibioticRelevant;
      if (!s.decision) s.decision = {};
      s.decision.status = c.decisionStatus; s.decision.label = c.decisionLabel;
      s.decision.reasoning = (function (kk) { return function (e) { return kbReason(kk, e); }; })(k);
    });
    if (window.KB_CLINICAL.ddxNi && window.KB_CLINICAL.ddxNi.length) DDX_NI = window.KB_CLINICAL.ddxNi;
    _kbClinicalApplied = true;
  }
  try { kbApplyClinical(); } catch (e) {}

  // Bridge generic presenting symptoms to the infection ontology's specific
  // keys so a generic pick still engages the relevant syndromes (infectious
  // scoring only — the non-infectious layer keeps the literal findings).
  var ALIAS = { headache: ["headacheSevere"], dyspnea: ["hypoxia"], legSwellingUnilateral: ["dvtRisk"] };
  function infFindings() {
    var e = {};
    for (var k in S.f) { e[k] = true; (ALIAS[k] || []).forEach(function (a) { e[a] = true; }); }
    return e;
  }

  function scoreInfectious(s) {
    var assoc = assocKeys(s);
    var present = assoc.filter(function (k) { return S.fInf[k]; });
    if (!present.length) return null;
    var _kb = kbDisease(s.id);
    var matched = false;
    try { matched = _kb ? kbEvalRule(_kb.rule, S.fInf) : !!(s.match && s.match(S.fInf)); } catch (e) {}
    var sc;
    if (matched) {
      try { sc = clamp(Math.round(_kb ? kbEvalScore(_kb.score, S.fInf) : (s.baseScore ? s.baseScore(S.fInf) : 60)), 0, 100); } catch (e) { sc = 60; }
    } else {
      // soft pre-match suggestion weighted by finding specificity (IDF) AND
      // diagnostic weight, so a shared generic finding (fever) barely surfaces
      // a syndrome while a disease-defining one (neck stiffness) does.
      computeIDF();
      var rel = 0; present.forEach(function (k) { rel += (IDF[k] || 0.5) * (fw(k) === 3 ? 1.6 : fw(k) === 1 ? 0.6 : 1); });
      sc = clamp(Math.round(rel * 13), 0, 56);
      if (sc < 16) return null; // below the noise floor — don't list
    }
    // dominant-organ-system influence (consultant reasoning)
    var hasVHI = present.some(function (k) { return fw(k) === 3; });
    sc = clamp(sc + systemMod(dzTag(s.system), hasVHI, S._dom || {}), 0, 100);
    var missing = assoc.filter(function (k) { return !S.fInf[k]; }).slice(0, 5);
    // contradictory = entered findings whose removal RAISES the score (data-driven probe)
    var contra = [];
    if (matched && (_kb || s.baseScore)) {
      present.forEach(function (k) {
        var clone = {}; for (var x in S.fInf) clone[x] = S.fInf[x]; delete clone[k];
        var without; try { without = clamp(Math.round(_kb ? kbEvalScore(_kb.score, clone) : s.baseScore(clone)), 0, 100); } catch (e) { without = sc; }
        if (without > sc) contra.push(k);
      });
    }
    var reason = "";
    try {
      if (_kb && _kb.reason) reason = kbReason(_kb, S.fInf);                       // KB declarative template (no eval)
      else if (s.decision && s.decision.reasoning) reason = s.decision.reasoning(S.fInf); // fallback to legacy closure
    } catch (e) {}
    var red = (s.decision && (s.decision.status === "red")) ? [s.decision.label || "Time-critical infection"] : [];
    var inv = (s.investigations || []).map(function (i) { return i.test ? (i.test) : i; });
    return { id: s.id, name: s.name, system: s.system || "Infectious", inf: true, matched: matched,
      score: sc, supporting: present, contra: contra, missing: missing, reason: reason, red: red, inv: inv, _syn: s };
  }

  function scoreNI(d) {
    var _kb = kbDisease(d.id);
    var find = (_kb && _kb.find) ? _kb.find : d.find;   // KB is the runtime source of truth (P3)
    var sup = [], contra = [], sum = 0, any = false;
    for (var k in find) { if (S.f[k]) { sum += find[k]; any = true; if (find[k] > 0) sup.push(k); else if (find[k] < 0) contra.push(k); } }
    if (!any) return null;
    var sc = clamp(Math.round(sum), 0, 100);
    if (sc <= 0 && sup.length === 0) return null;
    var hasVHI = sup.some(function (k) { return fw(k) === 3; });
    sc = clamp(sc + systemMod(dzTag(d.system), hasVHI, S._dom || {}), 0, 100);
    var missing = [];
    for (var k2 in find) { if (!S.f[k2] && find[k2] >= 12) missing.push(k2); }
    missing = missing.sort(function (a, b) { return find[b] - find[a]; }).slice(0, 5);
    return { id: d.id, name: d.name, system: d.system, inf: false, matched: false,
      score: sc, supporting: sup.sort(function (a, b) { return find[b] - find[a]; }),
      contra: contra.sort(function (a, b) { return find[a] - find[b]; }),
      missing: missing, reason: d.reason || "", red: d.red || [], inv: d.inv || [], tools: d.tools || [] };
  }

  function differential() {
    buildOntology();
    S.fInf = infFindings();
    S._dom = dominantSystems().dom;
    var inf = [], ni = [];
    var syn = window.SYNDROMES || {};
    Object.keys(syn).forEach(function (id) { var r = scoreInfectious(syn[id]); if (r) inf.push(r); });
    DDX_NI.forEach(function (d) { var r = scoreNI(d); if (r) ni.push(r); });
    var by = function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); };
    inf.sort(by); ni.sort(by);
    return { inf: inf, ni: ni };
  }

  /* Infection gate — keyed off whether infection LEADS overall */
  function gate(d) {
    var topInf = d.inf.length ? d.inf[0].score : 0;
    var topNi = d.ni.length ? d.ni[0].score : 0;
    var matchedInf = d.inf.some(function (x) { return x.matched; });
    var cls;
    if (topInf >= 80 && topInf >= topNi && matchedInf) cls = "very_likely";
    else if (topInf >= 62 && topInf >= topNi - 4 && matchedInf) cls = "likely";
    else if (topInf >= 42 && topInf >= topNi - 12) cls = "possible";
    else if (topInf > 0 && topNi > topInf) cls = "noninfective";
    else if (topInf > 0) cls = "unlikely";
    else if (topNi > 0) cls = "noninfective";
    else cls = "none";
    // Sepsis physiology (Surviving Sepsis): fever/rigors + shock or organ
    // dysfunction → treat suspected sepsis as infection likely and activate
    // stewardship even if no single syndrome's criteria matched — PROVIDED an
    // infective cause is at least competitive (guards against over-calling when
    // a non-infectious cause clearly leads).
    var f = S.f || {};
    var sepsisPhys = (f.fever || f.rigors || f.feverGU || f.highFeverGI) &&
                     (f.hypotension || f.lactateElevated || f.organDysfunction || f.vasopressorRequirement);
    if (sepsisPhys && topInf >= 38 && topInf >= topNi - 8) {
      var hard = f.hypotension || f.lactateElevated || f.vasopressorRequirement;
      if (cls === "noninfective" || cls === "unlikely" || cls === "possible") cls = hard ? "very_likely" : "likely";
      else if (cls === "likely" && hard) cls = "very_likely";
    }
    // Febrile neutropenia / fever in an immunocompromised host: low threshold
    // for empiric antibiotics (oncological emergency) — flag infection likely.
    var febrileNeutropenia = (f.fever || f.rigors) && (f.absoluteNeutrophilCountLow || f.immunocompromised);
    if (febrileNeutropenia && topInf >= 30 && topInf >= topNi - 8) {
      if (cls === "noninfective" || cls === "unlikely" || cls === "possible") cls = "likely";
    }
    return { cls: cls, topInf: topInf, topNi: topNi, lead: d.inf[0] || null };
  }
  var GATEINFO = {
    very_likely:  { t: "Infection very likely", c: "g-red",    ab: true },
    likely:       { t: "Infection likely",       c: "g-orange", ab: true },
    possible:     { t: "Infection possible",      c: "g-amber",  ab: false },
    unlikely:     { t: "Infection unlikely",      c: "g-teal",   ab: false },
    noninfective: { t: "Non-infectious diagnosis favored", c: "g-green2", ab: false },
    none:         { t: "Add findings to begin reasoning", c: "g-slate", ab: false }
  };
  function gateMsg(g) {
    switch (g.cls) {
      case "very_likely": return "Infection leads the differential — empiric antimicrobial therapy is appropriate. Select the diagnosis to open its stewardship recommendation.";
      case "likely": return "Infection is the leading consideration — empiric therapy may be warranted after cultures. Confirm before prescribing.";
      case "possible": return "Infection is in the differential but not dominant — pursue targeted investigations before antibiotics.";
      case "unlikely": return "Infection is low on the differential — antibiotics are not recommended yet. Investigate the alternatives.";
      case "noninfective": return "A non-infectious diagnosis currently leads — antibiotics are not recommended. Address the leading diagnosis.";
      default: return "";
    }
  }

  /* ---------------------------------------------------------------------- *
   * UI
   * ---------------------------------------------------------------------- */
  var root = null, filter = "";
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

  function ensureRoot() {
    if (root) return root;
    buildOntology();
    root = document.createElement("div");
    root.id = "dxOverlay"; root.className = "dx-overlay";
    root.innerHTML =
      '<div class="dx-top">' +
        '<button class="dx-back" id="dxClose" aria-label="Close reasoning">‹ Close</button>' +
        '<div class="dx-title">Clinical Reasoning <span class="dx-beta">beta</span></div>' +
        '<button class="dx-reset" id="dxReset" title="Start over">Reset</button>' +
      '</div>' +
      '<div class="dx-body">' +
        '<div class="dx-discl"><b>⚠️ Beta — this clinical reasoning engine is still being built and is under active testing.</b> Treat all output as provisional. Live differential — updates as you add findings. Ranked by Clinical Confidence Score (a transparent rule-based score, not a validated probability). Nothing here is a confirmed diagnosis; StewardMD supports, not replaces, your clinical judgment.</div>' +
        '<div id="dxHosp" class="dx-hosp"></div>' +
        '<button id="dxAdvToggle" class="dx-adv-toggle" type="button">🔬 Advanced workspace ▾</button>' +
        '<div id="dxAdv" class="dx-adv" style="display:none"></div>' +
        '<div class="dx-find-wrap">' +
          '<input id="dxSearch" class="dx-search" type="text" placeholder="🔍 Search findings (e.g. pap → Papilledema, dys → Dysuria/Dysphagia)…" autocomplete="off">' +
          '<div id="dxSel" class="dx-selected"></div>' +
          '<div id="dxSuggest" class="dx-suggest"></div>' +
          '<div id="dxPicker" class="dx-picker"></div>' +
        '</div>' +
        '<div id="dxGate" class="dx-gate"></div>' +
        '<div id="dxPolicy" class="dx-policy-wrap"></div>' +
        '<div id="dxChanged" class="dx-changed" style="display:none"></div>' +
        '<div id="dxCompare" class="dx-compare"></div>' +
        '<div id="dxDom" class="dx-dom-wrap"></div>' +
        '<div id="dxCols" class="dx-cols"></div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector("#dxClose").addEventListener("click", close);
    root.querySelector("#dxReset").addEventListener("click", resetAll);
    root.querySelector("#dxAdvToggle").addEventListener("click", function () { S.advOpen = !S.advOpen; renderAdv(); });
    var si = root.querySelector("#dxSearch");
    si.addEventListener("input", function () { filter = si.value.trim().toLowerCase(); renderPicker(); });
    // Desktop-Chrome fix: stop any document/global key handler from swallowing
    // the keystrokes typed into the findings search box.
    si.addEventListener("keydown", function (e) { e.stopPropagation(); });
    si.addEventListener("keypress", function (e) { e.stopPropagation(); });
    return root;
  }

  function renderSelected() {
    var el = root.querySelector("#dxSel");
    var keys = Object.keys(S.f);
    if (!keys.length) { el.innerHTML = '<span class="dx-sel-empty">No findings yet — tap below to add.</span>'; return; }
    el.innerHTML = keys.map(function (k) {
      return '<button class="dx-sel-chip" data-f="' + k + '">' + esc(lbl(k)) + ' ✕</button>';
    }).join("");
    el.querySelectorAll(".dx-sel-chip").forEach(function (b) {
      b.addEventListener("click", function () { delete S.f[b.getAttribute("data-f")]; recompute(); });
    });
  }

  function chipBtn(key, label) { return '<button class="dx-chip" data-f="' + key + '">' + esc(label) + '</button>'; }
  function wireAddChips(el) {
    el.querySelectorAll(".dx-chip[data-f]").forEach(function (b) {
      b.addEventListener("click", function () { addFinding(b.getAttribute("data-f")); });
    });
  }
  // re-render only the picker (system / show-more toggles add no findings)
  function renderPickerOnly() { renderPicker(); }

  function renderPicker() {
    var el = root.querySelector("#dxPicker");

    // --- search mode: flat filtered results across the whole ontology ---
    if (filter) {
      // match the label OR any clinical synonym (FT_SYN) so colloquial terms
      // ("sob"→dyspnea, "creps"→crackles, "loose stool"→diarrhea) are findable.
      var matches = [], seen = {};
      function consider(fl) {
        if (!fl || S.f[fl.key] || seen[fl.key]) return;
        var lab = (fl.label || "").toLowerCase();
        var hit = lab.indexOf(filter) >= 0;
        if (!hit) { (FT_SYN[fl.key] || []).forEach(function (syn) { if (syn.indexOf(filter) >= 0 || (filter.length >= 3 && filter.indexOf(syn) >= 0)) hit = true; }); }
        if (hit) { seen[fl.key] = true; matches.push(fl); }
      }
      ONT.forEach(function (g) { g.fields.forEach(consider); });
      // also search the full disease directory (all 140) by name or system, so any
      // syndrome / diagnosis is findable — each row opens its reference + Harrison.
      var dzMatches = diseaseDirectory().filter(function (z) {
        return z.name.toLowerCase().indexOf(filter) >= 0 || (z.system || "").toLowerCase().indexOf(filter) >= 0;
      });
      el.innerHTML = '<div class="dx-cat"><div class="dx-cat-h">Findings' + (matches.length ? ' <span class="dx-sr-count">' + matches.length + '</span>' : '') + '</div><div class="dx-search-list">' +
        (matches.length ? matches.map(function (fl) { return '<button class="dx-search-row" data-f="' + fl.key + '"><span class="dx-sr-plus">+</span><span class="dx-sr-lbl">' + esc(fl.label) + '</span></button>'; }).join("") : '<div class="dx-sel-empty" style="padding:14px">No matching findings.</div>') +
        '</div></div>' +
        (dzMatches.length ? '<div class="dx-cat"><div class="dx-cat-h">Diseases <span class="dx-sr-count">' + dzMatches.length + '</span></div><div class="dx-search-list">' +
          dzMatches.slice(0, 50).map(function (z) { return '<button class="dx-search-row" data-dz="' + z.id + '"><span class="dx-sr-plus">📖</span><span class="dx-sr-lbl">' + esc(z.name) + (z.system ? '<span class="dx-sr-sys">' + esc(z.system) + (z.inf ? " · infective" : "") + '</span>' : '') + '</span></button>'; }).join("") +
          '</div></div>' : '');
      el.querySelectorAll(".dx-search-row[data-f]").forEach(function (b) { b.addEventListener("click", function () { addFinding(b.getAttribute("data-f")); }); });
      el.querySelectorAll(".dx-search-row[data-dz]").forEach(function (b) { b.addEventListener("click", function () { openDiseaseRef(b.getAttribute("data-dz")); }); });
      // suggested findings as chips BELOW the search list — contextual to the
      // current differential (same source as the always-on suggest strip).
      if (Object.keys(S.f).length) {
        try {
          var sg = suggestionKeys();
          if (sg.length) {
            el.insertAdjacentHTML("beforeend",
              '<div class="dx-cat" style="margin-top:12px"><div class="dx-cat-h">💡 Suggested findings</div><div class="dx-chips">' +
              sg.map(function (k) { return '<button class="dx-chip sug" data-f="' + k + '">+ ' + esc(LABEL[k]) + '</button>'; }).join("") +
              '</div></div>');
            el.querySelectorAll(".dx-chip.sug[data-f]").forEach(function (b) { b.addEventListener("click", function () { addFinding(b.getAttribute("data-f")); }); });
          }
        } catch (e) {}
      }
      return;
      /* legacy chip render (replaced by vertical list above):
      el.innerHTML = '<div class="dx-cat"><div class="dx-cat-h">Search results</div><div class="dx-chips">' +
        (matches.length ? matches.map(function (fl) { return chipBtn(fl.key, fl.label); }).join("") : '<span class="dx-sel-empty">No matching findings. Try the free-text “Extract findings” in the Advanced workspace below.</span>') +
        '</div></div>';
      wireAddChips(el); return; */
    }

    // --- progressive consultant workflow ---
    var html = "";
    // Step 1 · general findings
    var gen = GENERAL.filter(function (k) { return !S.f[k] && LABEL[k]; });
    html += '<div class="dx-step"><div class="dx-step-h"><span class="dx-step-n">1</span> General findings</div><div class="dx-chips">' +
      (gen.length ? gen.map(function (k) { return chipBtn(k, LABEL[k]); }).join("") : '<span class="dx-sel-empty">All added.</span>') + '</div></div>';
    // Step 2 · body system
    html += '<div class="dx-step"><div class="dx-step-h"><span class="dx-step-n">2</span> Involved system</div><div class="dx-sysrow">' +
      SYSPICK.map(function (s) { return '<button class="dx-sys' + (S.system === s.id ? " on" : "") + '" data-sys="' + s.id + '">' + esc((s.icon ? s.icon + " " : "") + s.label) + '</button>'; }).join("") +
      '</div></div>';
    // Step 3 · findings for the chosen system (common first, rare behind Show more)
    if (S.system) {
      var fs = fieldsForSystem(S.system);
      var avail = fs.fields.filter(function (fl) { return !S.f[fl.key]; });
      var common = avail.slice(0, 6), rare = avail.slice(6);
      html += '<div class="dx-step"><div class="dx-step-h"><span class="dx-step-n">3</span> ' + esc(fs.sp ? fs.sp.label : "") + ' findings</div>' +
        '<div class="dx-chips">' + (common.length ? common.map(function (fl) { return chipBtn(fl.key, fl.label); }).join("") : '<span class="dx-sel-empty">All added.</span>') + '</div>';
      if (rare.length) {
        html += '<button class="dx-more-btn" id="dxMoreBtn">' + (S.showRare ? "▲ Show fewer" : "▼ Show more (" + rare.length + ")") + '</button>';
        if (S.showRare) html += '<div class="dx-chips" style="margin-top:7px">' + rare.map(function (fl) { return chipBtn(fl.key, fl.label); }).join("") + '</div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
    el.querySelectorAll(".dx-sys").forEach(function (b) {
      b.addEventListener("click", function () { var id = b.getAttribute("data-sys"); S.system = (S.system === id ? null : id); S.showRare = false; renderPickerOnly(); });
    });
    var mb = el.querySelector("#dxMoreBtn");
    if (mb) mb.addEventListener("click", function () { S.showRare = !S.showRare; renderPickerOnly(); });
    wireAddChips(el);
  }

  // smart next-finding suggestions = top missing findings aggregated across the
  // current leading differentials (data-driven; mimics consultant questioning)
  // top missing findings aggregated across the current leading differentials
  // (shared by the always-on suggest strip and the in-search chip block).
  function suggestionKeys(d) {
    if (!d) { try { d = differential(); } catch (e) { return []; } }
    var counts = {};
    d.inf.slice(0, 5).concat(d.ni.slice(0, 5)).forEach(function (r) {
      (r.missing || []).forEach(function (k) { if (!S.f[k] && LABEL[k]) counts[k] = (counts[k] || 0) + 1; });
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 6);
  }
  function renderSuggest(d) {
    var el = root.querySelector("#dxSuggest");
    if (!el) return;
    if (!Object.keys(S.f).length) { el.innerHTML = ""; return; }
    var sug = suggestionKeys(d);
    if (!sug.length) { el.innerHTML = ""; return; }
    el.innerHTML = '<div class="dx-sugg-h">💡 Suggested next findings</div><div class="dx-chips">' +
      sug.map(function (k) { return '<button class="dx-chip sug" data-f="' + k + '">+ ' + esc(LABEL[k]) + '</button>'; }).join("") + '</div>';
    el.querySelectorAll(".dx-chip[data-f]").forEach(function (b) {
      b.addEventListener("click", function () { addFinding(b.getAttribute("data-f")); });
    });
  }

  /* ---- Advanced workspace: free-text, sessions, export/print, timeline ---- */
  var FT_SYN = {
    dyspnea:["sob","breathless","short of breath","dyspn"], alteredSensorium:["confus","drowsy","gcs","obtunded","unconscious","altered sensorium","altered mental"],
    neckStiffness:["neck stiff","stiff neck","meningism","nuchal"], headache:["headache","h/a"], fever:["fever","febrile","pyrexia"],
    seizure:["seizure","convuls","fits"], hypotension:["hypotens","low bp","septic shock","shock"], hemoptysis:["hemoptysis","coughing blood"],
    chestPain:["chest pain"], pleuriticChestPain:["pleuritic"], photophobia:["photophobia"], nauseaVomiting:["vomit","nausea"],
    diarrhea:["diarrhea","diarrhoea","loose stool"], dysuria:["dysuria","burning urine"], flankPain:["flank pain","loin pain"],
    jaundice:["jaundice","icterus"], cough:["cough"], hypoxia:["hypoxia","desaturat","spo2"], tachycardia:["tachycard"],
    melena:["melena","melaena","black stool"], hematemesis:["hematemesis","vomiting blood"], rash:["rash"], weightLoss:["weight loss"],
    palpitations:["palpitation"], syncope:["syncope","collapse","fainted"], backPain:["back pain"], focalNeuroDeficit:["weakness","hemiparesis","facial droop","slurred","focal deficit"],
    crepitations:["crackle","crepitation","creps"], consolidation:["consolidation"], purulentSputum:["purulent sputum","productive cough","sputum"],
    calfTenderness:["calf tender","calf pain"], legSwellingUnilateral:["calf swelling","leg swelling","unilateral leg"], legSwellingBilateral:["bilateral leg","pedal edema","ankle swelling","peripheral edema"],
    abdominalPain:["abdominal pain","belly pain","abdo pain","epigastric pain"], rightUpperQuadrantPain:["right upper quadrant","ruq pain"], flankPain:["flank pain","loin pain"],
    polyuriaPolydipsia:["polyuria","polydipsia"], ketonemia:["ketone","ketoacidosis"], orthopnea:["orthopnoea","orthopnea","pnd"],
    exertionalChestPain:["exertional","on exertion"], ecgIschemia:["st elevation","ischemic ecg","ischaemic ecg"], thunderclapHeadache:["thunderclap","worst headache","worst-ever"],
    hematuria:["hematuria","haematuria","blood in urine"], jointSwelling:["swollen joint","hot joint","joint swelling"],
    thrombocytopenia:["thrombocytopenia","low platelet"], polyarthralgia:["arthralgia","polyarthritis","joint pain","joint pains"],
    visualDisturbance:["visual loss","blurred vision","vision loss","diplopia"], papilledema:["papill","papilloedema","papilledema","disc swelling","disc oedema","disc edema","optic disc","swollen disc","raised icp","fundoscopy"], bloodyStool:["bloody stool","blood in stool","hematochezia","rectal bleed"],
    raisedJVP:["raised jvp","elevated jvp"], hypertensionHx:["hypertensive","high bp","htn"],
    ascendingWeakness:["ascending weakness","areflexia","ascending paralysis"], rigidity:["rigidity","rigid"],
    hypothermia:["hypothermia","hypothermic","low temperature"], bradycardia:["bradycardia","slow heart"],
    bradypnea:["bradypnea","slow breathing","depressed respiration","low respiratory rate"],
    miosisSecretions:["pinpoint pupil","miosis","salivation","cholinergic"], mucocutaneousBleeding:["bleeding","mucosal bleed","bruising","petechiae"],
    oliguria:["oliguria","anuria","reduced urine","low urine output"], mucosalLesions:["mucosal erosion","skin peeling","skin detachment","mucositis"],
    facialSwelling:["facial swelling","facial oedema","facial edema","tongue swelling","lip swelling"], darkUrine:["dark urine","tea-coloured urine","tea colored urine"],
    headInjury:["head injury","fall","fell","trauma to head"], alcoholExcess:["alcohol","alcoholic","drinks heavily","etoh"],
    ataxia:["ataxia","unsteady","unsteady gait","incoordination"], proteinuria:["frothy urine","proteinuria","heavy protein"]
  };
  function parseFreeText(text) {
    if (!text) return;
    var t = " " + text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ") + " ", added = 0;
    function present(phrase) {
      phrase = (phrase || "").trim();
      if (!phrase) return false;
      // whole-word match, tolerant of a trailing plural 's'
      return t.indexOf(" " + phrase + " ") >= 0 || t.indexOf(" " + phrase + "s ") >= 0;
    }
    Object.keys(VALID).forEach(function (k) {
      if (S.f[k]) return;
      var hit = false;
      (FT_SYN[k] || []).forEach(function (s) { if (t.indexOf(s) >= 0) hit = true; });
      if (!hit) {
        var lab = (LABEL[k] || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
        if (lab.length >= 5 && lab.length <= 26 && present(lab)) hit = true;
      }
      if (hit) { S.f[k] = true; added++; }
    });
    S.started = true;
    S.timeline.push({ f: "free-text (" + added + " findings extracted)", topName: null, topScore: null });
    recompute();
    toast(added ? (added + " finding" + (added > 1 ? "s" : "") + " extracted from the text") : "No findings recognised — try different wording or add them manually below");
  }
  function loadSessions() { try { return JSON.parse(localStorage.getItem("stewardmd_rx_sessions") || "[]"); } catch (e) { return []; } }
  function saveSession() {
    var s = loadSessions(), keys = Object.keys(S.f);
    if (!keys.length) return;
    s.unshift({ label: keys.slice(0, 3).map(lbl).join(", ") + (keys.length > 3 ? " +" + (keys.length - 3) : ""), when: new Date().toLocaleString(), findings: keys });
    try { localStorage.setItem("stewardmd_rx_sessions", JSON.stringify(s.slice(0, 12))); } catch (e) {}
    renderAdv();
  }
  function loadSession(i) {
    var s = loadSessions()[i]; if (!s) return;
    S.f = {}; (s.findings || []).forEach(function (k) { S.f[k] = true; }); S.started = true; S.timeline = []; recompute();
  }
  function buildSummary() {
    var d = differential(), g = gate(d), L = [];
    L.push("StewardMD — Clinical Reasoning summary");
    L.push("Generated: " + new Date().toLocaleString()); L.push("");
    L.push("Findings: " + (Object.keys(S.f).map(lbl).join(", ") || "—")); L.push("");
    L.push("Infection assessment: " + GATEINFO[g.cls].t); L.push("");
    L.push("Infectious differential:");
    d.inf.slice(0, 6).forEach(function (r, i) { L.push("  " + (i + 1) + ". " + r.name + " — " + r.score + "/100"); });
    if (!d.inf.length) L.push("  (none)");
    L.push("Non-infectious differential:");
    d.ni.slice(0, 6).forEach(function (r, i) { L.push("  " + (i + 1) + ". " + r.name + " — " + r.score + "/100"); });
    if (!d.ni.length) L.push("  (none)");
    if (GATEINFO[g.cls].ab && g.lead && window.HOSPITAL) {
      var pol = window.HOSPITAL.getPolicy(g.lead.id);
      L.push(""); L.push("Leading infectious diagnosis: " + g.lead.name);
      if (pol && pol.entry) {
        var e = pol.entry;
        L.push("Empiric antibiotic therapy (" + (pol.hospital ? pol.hospital.short : "policy") + "):");
        if (e.preferred && e.preferred.length) L.push("  Preferred: " + e.preferred.join("; "));
        if (e.alternatives && e.alternatives.length) L.push("  Alternatives: " + e.alternatives.join("; "));
        if (e.duration) L.push("  Duration: " + e.duration);
        if (e.comments) L.push("  Notes: " + e.comments);
        if (e.deescalation) L.push("  De-escalation: " + e.deescalation);
      } else {
        L.push("Empiric therapy: refer to local antibiogram / policy.");
      }
    }
    L.push(""); L.push("Decision support only — not a confirmed diagnosis. StewardMD supports, not replaces, clinical judgment.");
    return L.join("\n");
  }
  function exportSummary() {
    var txt = buildSummary();
    function fallback() {
      try { var ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Summary copied"); }
      catch (e2) { toast("Select the summary text to copy"); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast("Summary copied to clipboard"); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }
  function printSummary() {
    // Print the rendered clinical-reasoning OUTPUT in-page via a print stylesheet: the OS
    // print/share sheet opens OVER the app and Cancel returns here (no blank new tab).
    try {
      var old = document.getElementById("dxPrintArea"); if (old) old.remove();
      if (!document.getElementById("dx-print-style")) {
        var st = document.createElement("style"); st.id = "dx-print-style";
        // Hide the live app, show only the print area, and force legible black-on-white
        // (the app's cards use coloured/dark styles that don't print well).
        st.textContent =
          "@media print{html,body{background:#fff!important}" +
          "body>*{display:none!important}" +
          "#dxPrintArea{display:block!important;position:static!important;color:#000!important}" +
          "#dxPrintArea *{color:#000!important;background:#fff!important;box-shadow:none!important;border-color:#bbb!important}" +
          "#dxPrintArea button{display:none!important}" +
          "@page{margin:14mm}}" +
          "#dxPrintArea{display:none}";
        document.head.appendChild(st);
      }
      var area = document.createElement("div"); area.id = "dxPrintArea";
      // Prefer the rendered differential (the "webpage"); fall back to the text summary.
      var rendered = "";
      try {
        var cols = root && root.querySelector("#dxCols");
        if (cols && cols.innerHTML.trim()) {
          var clone = cols.cloneNode(true);
          clone.querySelectorAll("button, .dx-scale, input, select").forEach(function (n) { n.remove(); });
          rendered = clone.innerHTML;
        }
      } catch (e) {}
      area.innerHTML =
        '<h2 style="font:700 17px system-ui,Segoe UI,sans-serif;margin:0 0 2px">StewardMD — Clinical Reasoning</h2>' +
        '<div style="font:12px system-ui,sans-serif;color:#555;margin:0 0 12px">Decision support — verify against clinical judgement. Printed ' + esc(new Date().toLocaleString()) + '</div>' +
        (rendered
          ? '<div class="dx-print-rendered">' + rendered + '</div><hr style="margin:14px 0;border:none;border-top:1px solid #ccc">'
          : '') +
        '<pre style="white-space:pre-wrap;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#000;margin:0">' + esc(buildSummary()) + '</pre>';
      document.body.appendChild(area);
      var cleaned = false;
      function cleanup(){ if (cleaned) return; cleaned = true; try { area.remove(); } catch (e) {} window.removeEventListener("afterprint", cleanup); }
      window.addEventListener("afterprint", cleanup);
      setTimeout(function () { try { window.print(); } catch (e) { toast("Print unavailable — use Export."); cleanup(); } }, 80);
      setTimeout(cleanup, 60000);
    } catch (e) { toast("Print unavailable — use Export."); }
  }
  function shareSummary() {
    var txt = buildSummary();
    try {
      if (navigator.share) { navigator.share({ title: "StewardMD — Clinical Reasoning", text: txt }).catch(function () {}); return; }
    } catch (e) {}
    exportSummary(); // fallback: copy to clipboard
    toast("Sharing not supported here — copied instead.");
  }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "dx-toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.classList.add("on"); }, 10);
    setTimeout(function () { t.classList.remove("on"); setTimeout(function () { t.remove(); }, 300); }, 1800);
  }
  function renderAdv() {
    var el = root.querySelector("#dxAdv"); if (!el) return;
    el.style.display = S.advOpen ? "" : "none";
    var tog = root.querySelector("#dxAdvToggle"); if (tog) tog.innerHTML = "🔬 Advanced workspace " + (S.advOpen ? "▲" : "▾");
    if (!S.advOpen) return;
    var sessions = loadSessions();
    el.innerHTML =
      '<textarea id="dxFreeText" class="dx-free" rows="3" placeholder="Describe the case in plain text — e.g. 65M, 2 days fever, neck stiffness, photophobia, drowsy…"></textarea>' +
      '<div class="dx-adv-row">' +
        '<button class="dx-adv-btn primary" id="dxExtract">✨ Extract findings</button>' +
        '<button class="dx-adv-btn" id="dxSaveSess">💾 Save session</button>' +
        '<button class="dx-adv-btn" id="dxExport">📋 Export</button>' +
        '<button class="dx-adv-btn" id="dxPrint">🖨 Print</button>' +
        '<button class="dx-adv-btn" id="dxShare">📤 Share</button>' +
      '</div>' +
      (sessions.length ? '<div class="dx-sess-h">Saved sessions</div><div class="dx-sess">' + sessions.map(function (s, i) { return '<button class="dx-sess-item" data-i="' + i + '">' + esc(s.label) + ' <span>' + esc(s.when) + '</span></button>'; }).join("") + '</div>' : '') +
      (S.timeline.length ? '<div class="dx-tl-h">Reasoning timeline — leading diagnosis & confidence</div><div class="dx-tl">' + S.timeline.map(function (t, i) {
        var arrow = "";
        if (i > 0) { var pr = S.timeline[i - 1]; if (pr && pr.topName === t.topName && t.topScore != null && pr.topScore != null) { arrow = t.topScore > pr.topScore ? ' <span class="up">▲</span>' : t.topScore < pr.topScore ? ' <span class="down">▼</span>' : ""; } }
        var lead = t.topName ? ' → ' + esc(t.topName) + (t.topScore != null ? ' <b>' + t.topScore + '/100</b>' + arrow : "") : "";
        return '<div class="dx-tl-item"><span class="dx-tl-n">' + (i + 1) + '</span> + ' + esc(t.f) + lead + '</div>';
      }).join("") + '</div>' : '');
    el.querySelector("#dxExtract").addEventListener("click", function () { parseFreeText(el.querySelector("#dxFreeText").value); });
    el.querySelector("#dxSaveSess").addEventListener("click", saveSession);
    el.querySelector("#dxExport").addEventListener("click", exportSummary);
    el.querySelector("#dxPrint").addEventListener("click", printSummary);
    el.querySelector("#dxShare").addEventListener("click", shareSummary);
    el.querySelectorAll(".dx-sess-item").forEach(function (b) { b.addEventListener("click", function () { loadSession(+b.getAttribute("data-i")); }); });
  }

  // 📖 Harrison reference block for a disease card — paraphrased, page-cited
  // KNOWLEDGE from window.KB_ENRICHMENT (built from kb/diseases enrichment.harrison).
  // Display-only; returns "" if no enrichment is loaded for this id.
  /* ---------------------------------------------------------------------- *
   * EVIDENCE VIEWER — premium, reusable clinical-evidence component (gold71)
   *
   * Replaces the old "wall of Harrison text" with a structured viewer: a source
   * header, a Clinical Pearls HERO (callout cards), and independent animated
   * collapsible sections (Pathophysiology · Diagnosis · Red flags & pitfalls ·
   * Course & prognosis · Full reference). Progressive disclosure, mobile-first,
   * lazy body build. SOURCE-AGNOSTIC: evViewerHTML(src) renders ANY evidence
   * source (Harrison today; Sanford / IDSA / ESC / NICE / WHO later) — only the
   * src-builder differs. Citations are preserved verbatim inside the content.
   * ---------------------------------------------------------------------- */
  /* SMART MEDICAL HIGHLIGHTING — semantic, meaning-preserving auto-emphasis.
   * Escapes text FIRST, then a SINGLE-PASS combined regex wraps recognised terms
   * in semantic spans (ordered by priority; longer phrases first). One pass = no
   * re-matching inside inserted markup, so HTML stays balanced and the medical
   * meaning/wording is never changed — only visually emphasised. Citations kept. */
  var MED_RULES = [
    { cls: "md-cite", re: "Harrison(?:[’']s)?\\s*22e(?:\\s*pp?\\.?\\s*[\\dIVXLC]+(?:[\\u2013\\-,]\\s*\\d+)*)?" },
    // high-yield ENUMERATION phrase — "classic triad of fever, headache and nuchal
    // rigidity" etc. captured as one purple span (lazy, verb/punctuation-bounded;
    // fails safe to no-match if no boundary within range, never runs away).
    { cls: "md-hi", re: "(?:classic(?:al)?\\s+|the\\s+)?(?:clinical\\s+)?(?:triad|tetrad|pentad)\\s+of\\s+[a-z][^.;:&()]{2,70}?(?=\\s+(?:is|are|was|were|can|may|occurs?|suggests?|implies|indicates?|usually|typically|often|seen|present|presents?|consists?|comprises?|includes?|with|that|which|but|while|and is|and are)\\b|[.;:&()]|$)" },
    // ---- COMPLETE HIGH-YIELD PHRASES (matched before single terms; whole concept,
    // not isolated words). Each captures one clinically meaningful span. ----
    { cls: "md-bug", re: "\\b(?:persistent|recurrent|relapsing|breakthrough|continuous|ongoing)\\s+(?:(?:methicillin[\\u2013\\- ]resistant\\s+)?Staphylococcus aureus|S\\.\\s?aureus|MRSA|MSSA|Pseudomonas(?:\\s+aeruginosa)?|Candida(?:\\s+albicans)?|Enterococcus|Klebsiella(?:\\s+pneumoniae)?|Acinetobacter|Escherichia coli|E\\.\\s?coli|gram[\\u2013\\- ]negative|coagulase[\\u2013\\- ]negative staphylococc(?:us|i))\\s+(?:bacterae?mia|fungae?mia|candidemia|bloodstream infections?)" },
    { cls: "md-bug", re: "\\b(?:Staphylococcus aureus|S\\.\\s?aureus|MRSA|Pseudomonas(?:\\s+aeruginosa)?|Candida(?:\\s+albicans)?|Enterococcus|Klebsiella(?:\\s+pneumoniae)?|Escherichia coli|E\\.\\s?coli)\\s+(?:bacterae?mia|fungae?mia|candidemia|bloodstream infections?)" },
    { cls: "md-key", re: "\\bpain out of proportion(?:\\s+to(?:\\s+(?:the\\s+)?(?:examination|physical exam(?:ination)?|exam|clinical findings|findings))?)?" },
    { cls: "md-key", re: "\\b(?:assume|suspect|consider|treat(?:ed)? as|regard as)\\s+[\\w][\\w\\s,/\\-]{3,45}?\\s+until proven otherwise" },
    { cls: "md-key", re: "\\buntil proven otherwise" },
    { cls: "md-action", re: "\\bsource control(?:\\s+(?:is|remains)\\s+(?:essential|required|critical|key|mandatory|paramount|the priority))?" },
    { cls: "md-key", re: "\\bantibiotics?\\s+alone\\s+(?:usually\\s+|frequently\\s+|often\\s+|commonly\\s+|may\\s+|will\\s+|can\\s+)?(?:fail|are\\s+(?:insufficient|inadequate)|rarely\\s+(?:suffice|work|succeed))" },
    { cls: "md-ix", re: "\\bblood cultures?\\s+(?:before|prior to)\\s+(?:starting\\s+)?(?:antibiotics?|antimicrobials?)" },
    { cls: "md-action", re: "\\brepeat(?:\\s+blood)?\\s+cultures?\\s+every\\s+\\d{2}[\\u2013\\-]?\\d{0,2}\\s*(?:h|hours?|hrs?)\\b" },
    { cls: "md-abs", re: "\\bdo not delay\\s+[a-z]+(?:\\s+[a-z]+)?" },
    { cls: "md-action", re: "\\b(?:requires?|needs?|warrants?)\\s+urgent\\s+[a-z]+(?:\\s+[a-z]+)?" },
    { cls: "md-action", re: "\\burgent\\s+(?:surgery|surgical\\s+[a-z]+|intervention|drainage|decompression|exploration|debridement|source control)" },
    { cls: "md-action", re: "\\b(?:complete\\s+)?device\\s+(?:removal|explantation|extraction)(?:\\s+is\\s+(?:recommended|required|essential|advised|indicated)(?:\\s+wherever\\s+feasible)?)?" },
    { cls: "md-sig", re: "\\bfirst[\\u2013\\- ]line\\s+(?:therapy|treatment|agents?|options?|regimens?)" },
    { cls: "md-key", re: "\\bpoor\\s+prognos(?:is|tic(?:\\s+(?:factor|indicator|sign)s?)?)" },
    { cls: "md-key", re: "\\bhigh\\s+(?:mortality|morbidity|case[\\u2013\\- ]fatality)(?:\\s+rate)?" },
    { cls: "md-sig", re: "\\bstrongly\\s+associated\\s+with" },
    { cls: "md-sig", re: "\\b(?:diagnostic\\s+)?gold\\s+standard(?:\\s+for\\s+[a-z]+(?:\\s+[a-z]+){0,2})?" },
    { cls: "md-sig", re: "\\b(?:investigation|imaging|test|study)\\s+of\\s+choice" },
    { cls: "md-sig", re: "\\bmost\\s+common\\s+(?:cause|organism|pathogen|presentation|site|aetiology|etiology)(?:\\s+of\\s+[a-z]+(?:\\s+[a-z]+){0,2})?" },
    { cls: "md-sig", re: "\\bpathognomonic(?:\\s+(?:for|of|finding|sign))?" },
    { cls: "md-ix", re: "\\b(?:TEE|TTE|MRI|CT|PET[\\u2013\\-]CT|echocardiography)\\s+is\\s+preferred\\s+over\\s+(?:TEE|TTE|MRI|CT|echocardiography)" },
    { cls: "md-abs", re: "\\b(?:always\\s+investigate|never\\s+rely\\s+solely\\s+on|never\\s+ignore|never\\s+delay)" },
    { cls: "md-resist", re: "\\b(?:MRSA|VRE|VRSA|ESBL|CRE|CRAB|MDRO|MDR|XDR|carbapenem[\\u2013\\- ]resistant|methicillin[\\u2013\\- ]resistant|vancomycin[\\u2013\\- ]resistant|multidrug[\\u2013\\- ]resistant|extensively drug[\\u2013\\- ]resistant)\\b" },
    { cls: "md-bug", re: "\\b(?:Staphylococcus aureus|Streptococcus pneumoniae|Streptococcus pyogenes|Klebsiella pneumoniae|Pseudomonas aeruginosa|Escherichia coli|Neisseria meningitidis|Mycobacterium tuberculosis|Clostridioides difficile|Clostridium difficile|Candida albicans|coagulase[\\u2013\\- ]negative staphylococci|S\\.\\s?aureus|E\\.\\s?coli|C\\.\\s?difficile|Staphylococcus|Streptococcus|Pseudomonas|Enterococcus|Acinetobacter|Klebsiella|Candida|Pneumococcus|Enterobacterales|Enterobacteriaceae)\\b" },
    { cls: "md-emerg", re: "\\b(?:septic shock|toxic shock|sepsis|necrotizing fasciitis|endocarditis|meningitis|encephalitis|anaphylaxis|status epilepticus|cardiac arrest|respiratory failure)\\b" },
    { cls: "md-ix", re: "\\b(?:(?:CSF|blood|urine|sputum|stool|serum|synovial fluid|pleural fluid|ascitic fluid|pericardial fluid)\\s+(?:opening pressure|cell count(?: and differential)?|Gram stain|cultures?|multiplex PCR|PCR|analysis|glucose|protein|lactate|antigen(?: test)?|cytology|microscopy|smear)|transoesophageal echocardiography|transesophageal echocardiography|echocardiography|echocardiogram|lumbar puncture|chest X[\\u2013\\-]?ray|CT angiography|CT pulmonary angiography|Gram stain|blood cultures?|procalcitonin|C[\\u2013\\- ]reactive protein|D[\\u2013\\- ]dimer|TEE|TTE|MRI|PET[\\u2013\\-]CT|PET|CXR|ECG|EEG|ABG|CSF|CRP|ESR|cholinesterase)\\b" },
    { cls: "md-drug", re: "\\b(?:piperacillin[\\u2013\\-/ ]?tazobactam|pip[\\u2013\\-/ ]?tazo|amoxicillin[\\u2013\\-/ ]?clavulanate|vancomycin|meropenem|imipenem|ertapenem|linezolid|daptomycin|cefazolin|ceftriaxone|cefepime|ceftazidime|cefotaxime|ceftaroline|ciprofloxacin|levofloxacin|azithromycin|doxycycline|metronidazole|ampicillin|amoxicillin|gentamicin|amikacin|rifampicin|rifampin|isoniazid|pyrazinamide|ethambutol|atropine|pralidoxime|naloxone|fluconazole|amphotericin|acyclovir|oseltamivir|colistin|tigecycline|clindamycin)\\b" },
    { cls: "md-action", re: "\\b(?:source control|device removal|removal of the device|remove the device|repeat blood cultures|repeat cultures|surgical debridement|urgent surgery|debridement|IV antibiotics|intravenous antibiotics|empi?ric antibiotics)\\b" },
    // high-yield SIGNAL markers + named signs/scores/criteria (the points worth noticing)
    { cls: "md-sig", re: "\\b(?:classic(?:al)?\\s+(?:triad|tetrad|pentad|presentation|features?)|pathognomonic|hallmark|gold standard|drug of choice|treatment of choice|first[\\u2013\\- ]line|second[\\u2013\\- ]line|mainstay|diagnostic of|diagnostic criteria|definitive diagnosis|Kernig(?:[’']s)?|Brudzinski(?:[’']s)?|Murphy(?:[’']s)? sign|Charcot(?:[’']s)?(?: triad)?|Reynolds pentad|Beck(?:[’']s)? triad|Whipple(?:[’']s)? triad|Cushing(?:[’']s)?(?: reflex| triad)?|Janeway lesions|Osler(?:[’']s)? nodes|Roth spots|Duke criteria|CURB[\\u2013\\-]?65|qSOFA|Wells score|Centor(?: criteria| score)?|Light(?:[’']s)? criteria|Ranson(?:[’']s)?(?: criteria)?|MELD(?:[\\u2013\\-]Na)?|Child[\\u2013\\- ]Pugh|Glasgow Coma Scale|GCS)\\b" },
    // high-yield clinical CONCEPTS — bold the important medical points in context
    { cls: "md-key", re: "\\b(?:purulent|suppurative|pyogenic|abscess|empyema|vegetations?|biofilm|bacterae?mia|fungae?mia|virae?mia|septic emboli|immunocompromised|immunosuppressed|neutropeni[ac]|nuchal rigidity|meningismus|neck stiffness|subarachnoid space|blood[\\u2013\\- ]brain barrier|inflammatory reaction|foreign body|indwelling|prosthetic|necrosis|necrotic|ischae?mi[ac]|infarction|thrombosis|perforation|hydrocephalus|vasculitis|demyelination|granulomatous|granuloma|malignancy|metasta(?:sis|tic)|raised intracranial pressure|intracranial pressure|herniation|pleocytosis|coloni[sz](?:e|ed|ation)|opsoni[sz]ation|phagocytosis)\\b" },
    { cls: "md-abs", re: "\\b(?:never|always|must|contraindicated|mandatory|strongly recommended|strongly suggested|life[\\u2013\\- ]threatening)\\b" }
  ];
  var _medRe = null;
  function medRe() { if (!_medRe) _medRe = new RegExp(MED_RULES.map(function (r) { return "(" + r.re + ")"; }).join("|"), "gi"); return _medRe; }
  function medFormat(text) {
    if (text == null) return "";
    var s = esc(String(text));
    return s.replace(medRe(), function () {
      var a = arguments;                       // [match, g1..gN, offset, string]
      for (var i = 0; i < MED_RULES.length; i++) if (a[i + 1] != null) {
        var cls = MED_RULES[i].cls, mt = a[0], tail = "";
        // keep trailing punctuation AND any dangling connector word OUTSIDE the span
        var p1 = mt.match(/[\s,;:)]+$/); if (p1) { tail = p1[0]; mt = mt.slice(0, mt.length - p1[0].length); }
        var cm = mt.match(/\s+(?:and|or|to|for|with|that|than)$/i); if (cm) { tail = mt.slice(cm.index) + tail; mt = mt.slice(0, cm.index); }
        var p2 = mt.match(/[\s,;:)]+$/); if (p2) { tail = p2[0] + tail; mt = mt.slice(0, mt.length - p2[0].length); }
        return '<span class="' + cls + '">' + mt + '</span>' + tail;
      }
      return a[0];
    });
  }
  // choose a pearl card's accent + icon from the dominant clinical concept in it
  function pearlKind(t) {
    var s = (t || "").toLowerCase();
    if (/persistent\s+\w+\s+bacter|persistent bacter|\bshock\b|hypotension|deteriorat|life[\s-]?threatening|high mortality|\bfatal\b|fulminant|until proven otherwise|do not delay|requires? urgent|impending|massive|emergenc/.test(s)) return { a: "warn", ic: "🚨", label: "Red flag" };
    if (/source control|remove (?:the )?device|device removal|\bdrain\b|debridement|urgent surger|surgical|first[–\- ]line|drug of choice|mainstay|vancomycin|meropenem|linezolid|daptomycin|\bcef|piperacillin|\bantibiotics?\b|regimen|therapy is/.test(s)) return { a: "tx", ic: "💊", label: "Treatment pearl" };
    if (/culture|echocard|\btee\b|\btte\b|\bmri\b|\bct\b|imaging|biopsy|gram stain|sensitivity|specificity|diagnostic|gold standard|investigat|\bpcr\b|serolog/.test(s)) return { a: "ix", ic: "🩺", label: "Diagnostic pearl" };
    if (/most common|classic|pathognomonic|hallmark|triad|tetrad|pentad|remember|\bexam\b|associated with/.test(s)) return { a: "pearl", ic: "🎯", label: "Exam pearl" };
    return { a: "pearl", ic: "💡", label: "Clinical pearl" };
  }
  // Remove inline citations from displayed text — references are collected ONCE in
  // the source footer instead of repeating "(Harrison 22e p.1120)" on every point.
  // Only strips citation parentheticals (Harrison… / p.NNN); clinical parentheticals
  // like "(>45 mg/dL)" or "(meningoencephalitis)" are preserved.
  function stripCite(t) {
    return String(t == null ? "" : t)
      .replace(/\s*\((?:Harrison[^)]*|pp?\.?\s*[\dIVXLC][\d,\s–\-]*)\)/g, "")
      .replace(/\s*\bHarrison(?:[’']s)?\s*22e(?:\s*pp?\.?\s*[\d,\s–\-]+)?/g, "")
      .replace(/\s*\bpp?\.\s*\d{2,4}(?:[–\-]\d{2,4})?(?:\s*,\s*\d{2,4}(?:[–\-]\d{2,4})?)*/g, "") // bare "p.818" / "pp. 1118-1125" (dot required → p.o./p53 safe)
      .replace(/\s+([.;,])/g, "$1").replace(/\s{2,}/g, " ").trim();
  }
  // concise page list for the footer — prefer the curated `pages` field (already a
  // clean range like "1078, 1082-1085"); only fall back to scanning body "p.NNN"
  // citations when no curated pages exist. Dedup + numeric sort, no body-number noise.
  function evPages(e) {
    var seen = {}, out = [];
    function add(tok) { tok = String(tok).replace(/\s*[–\-]\s*/, "–").replace(/\s+/g, ""); if (/^\d{2,4}/.test(tok) && !seen[tok]) { seen[tok] = 1; out.push(tok); } }
    function ctxScan(str) { var re = /pp?\.?\s*(\d{2,4}(?:\s*[–\-]\s*\d{2,4})?)/ig, m; while ((m = re.exec(str))) add(m[1]); }
    var curated = String(e.pages || "");
    if (/p\.?\s*\d/i.test(curated)) ctxScan(curated);                 // prose with p.NNN markers (ignore chapter/table numbers)
    else if (/\d/.test(curated)) curated.replace(/[^\d,\s–\-]/g, " ").split(/[,\s]+/).forEach(add); // bare numeric list = all pages
    else [].concat(e.clinicalPearls || [], e.pathophysiology ? [e.pathophysiology] : [], e.redFlags || [], e.pitfalls || [],
      e.additionalInvestigations || [], e.additionalDifferentials || []).forEach(ctxScan);
    out.sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0); });
    return out;
  }
  function evList(arr, kind) {
    if (!arr || !arr.length) return "";
    return '<ul class="ev-ul' + (kind ? " ev-ul--" + kind : "") + '">' + arr.map(function (x) { return '<li>' + medFormat(stripCite(x)) + '</li>'; }).join("") + '</ul>';
  }
  // render prose with the opening DEFINITION sentence as a lead callout (Quick Take),
  // the rest as normal paragraphs — so the key statement is grasped at a glance.
  // group sentences into short ~2-sentence paragraphs (readability; no text removed)
  function paraChunks(text) {
    var sents = String(text).match(/[^.;]*[.;]+|\S[^.;]*$/g) || [text];
    var out = [], buf = [];
    sents.forEach(function (s) { s = s.trim(); if (!s) return; buf.push(s); if (buf.length >= 2) { out.push(buf.join(" ")); buf = []; } });
    if (buf.length) out.push(buf.join(" "));
    return out.map(function (p) { return '<p>' + medFormat(p) + '</p>'; }).join("");
  }
  function medLead(text) {
    var t = stripCite(text); if (!t) return "";
    var m = t.match(/^([\s\S]{25,300}?[.;])\s+([\s\S]+)$/);
    if (m) return '<p class="ev-lead">' + medFormat(m[1]) + '</p>' + paraChunks(m[2]);
    return '<p>' + medFormat(t) + '</p>';
  }
  function evSub(label, html) { return html ? '<div class="ev-subh">' + esc(label) + '</div>' + html : ""; }
  // red flags / pitfalls as distinct callout cards (never buried in a bullet list)
  function evCallouts(arr, kind, ic) {
    if (!arr || !arr.length) return "";
    return '<div class="ev-callouts">' + arr.map(function (x) {
      return '<div class="ev-callout ev-callout--' + kind + '"><span class="ev-callout-ic">' + ic + '</span><span>' + medFormat(stripCite(x)) + '</span></div>';
    }).join("") + '</div>';
  }
  // build a source descriptor from the Harrison enrichment for a disease id
  function evHarrisonSrc(id) {
    var H = (window.KB_ENRICHMENT && window.KB_ENRICHMENT.byId) || null;
    var e = H && H[id]; if (!e) return null;
    var pearls = (e.clinicalPearls || []).filter(Boolean);
    var sections = [];
    if (e.pathophysiology) sections.push({ ic: "🧬", title: "Pathophysiology", html: medLead(e.pathophysiology) });
    var dxh = "";
    dxh += evSub("Investigations", evList(e.additionalInvestigations));
    dxh += evSub("Other differentials", evList(e.additionalDifferentials));
    var mim = (e.infectionMimics || []).concat(e.nonInfectiousMimics || []);
    dxh += evSub("Mimics", evList(mim));
    if (dxh) sections.push({ ic: "🩺", title: "Diagnosis & workup", html: dxh });
    var rf = "";
    rf += evSub("🚨 Red flags", evCallouts(e.redFlags, "danger", "🚨"));
    rf += evSub("⚠️ Pitfalls", evCallouts(e.pitfalls, "warn", "⚠️"));
    if (rf) sections.push({ ic: "⚠️", title: "Red flags & pitfalls", danger: true, html: rf });
    var cp = "";
    if (e.severityClassification) cp += '<div class="ev-subh">Severity</div><p>' + medFormat(stripCite(e.severityClassification)) + '</p>';
    if (e.prognosis) cp += '<div class="ev-subh">Prognosis</div><p>' + medFormat(stripCite(e.prognosis)) + '</p>';
    if (cp) sections.push({ ic: "📈", title: "Course & prognosis", html: cp });
    // Original Reference — VERBATIM detail with inline page citations preserved
    // (distinct from the de-cited summary sections above; citations also in footer).
    var rawUl = function (arr) { return (arr && arr.length) ? '<ul class="ev-ul">' + arr.map(function (x) { return '<li>' + medFormat(x) + '</li>'; }).join("") + '</ul>' : ""; };
    var full = "";
    full += evSub("Clinical pearls", rawUl(pearls));
    if (e.pathophysiology) full += evSub("Pathophysiology", '<p>' + medFormat(e.pathophysiology) + '</p>');
    full += evSub("Investigations", rawUl(e.additionalInvestigations));
    full += evSub("Other differentials", rawUl(e.additionalDifferentials));
    full += evSub("Mimics", rawUl(mim));
    full += evSub("Red flags", rawUl(e.redFlags));
    full += evSub("Pitfalls", rawUl(e.pitfalls));
    if (e.severityClassification) full += '<div class="ev-subh">Severity</div><p>' + medFormat(e.severityClassification) + '</p>';
    if (e.prognosis) full += '<div class="ev-subh">Prognosis</div><p>' + medFormat(e.prognosis) + '</p>';
    if (!pearls.length && !sections.length) return null;
    var srcName = e.source ? String(e.source).replace(/,?\s*22e.*$/, "") : "Harrison's Principles of Internal Medicine";
    var pages = evPages(e);
    return {
      _id: id, srcKey: "harrison", icon: "📖",
      sourceName: srcName,
      edition: "22e", tag: "Primary Reference",
      pages: "",                              // not in the header — references live in the footer
      pearls: pearls, sections: sections, fullHTML: full,
      cite: '<strong>📖 ' + esc(srcName) + ' (22e)</strong>' + (pages.length ? ' — pp. ' + pages.join(", ") : "") +
        '<br>Reference knowledge paraphrased &amp; page-cited. Not a treatment regimen — verify against full guidelines before acting.'
    };
  }
  /* FLAGSHIP CLINICIAN-CURATED BRIEFINGS — hand-authored high-yield blocks for
   * high-traffic diseases (Don't-miss / Exam pearl / Pitfall / Key action /
   * Practice tip). Reviewed standard-IM teaching points, distinct from the
   * AI-drafted Harrison paraphrase; rendered at the TOP of the viewer. */
  var EXAM_PEARLS = {
    MENINGITIS: [
      { t: "action", x: "Do not delay antibiotics for imaging or LP — give empiric ceftriaxone + vancomycin (add ampicillin if >50y or immunocompromised, for Listeria) immediately, with dexamethasone before or with the first dose." },
      { t: "exam", x: "The classic triad of fever, headache and nuchal rigidity is often incomplete, but nearly all patients have at least one of fever, neck stiffness or altered mental status." },
      { t: "pitfall", x: "A head CT before LP is only needed for focal deficit, papilledema, new seizure, immunocompromise or reduced GCS — not for every patient." },
      { t: "dx", x: "CSF in bacterial meningitis: neutrophilic pleocytosis, high protein, low glucose (CSF/serum ratio <0.4). Send CSF Gram stain, CSF culture and CSF multiplex PCR." }
    ],
    CAP: [
      { t: "exam", x: "Decide site of care with CURB-65 / qSOFA rather than gestalt; most non-severe CAP is treated as an outpatient." },
      { t: "tip", x: "First-line outpatient therapy is amoxicillin (with a macrolide if atypical cover is needed); blood cultures are reserved for severe disease." },
      { t: "dontmiss", x: "Suspect Staphylococcus aureus (including MRSA) or Pseudomonas in post-influenza pneumonia, structural lung disease or recent hospitalization." }
    ],
    SEVERE_CAP: [
      { t: "action", x: "Severe CAP needs ICU-level care: blood cultures before antibiotics, then do not delay the first dose; add MRSA and Pseudomonas cover when risk factors are present." }
    ],
    SEPSIS: [
      { t: "action", x: "Hour-1 bundle: blood cultures before antibiotics, broad-spectrum antibiotics, lactate, and 30 mL/kg crystalloid for hypotension or lactate ≥4." },
      { t: "dontmiss", x: "Source control is essential — identify and drain or remove the source whenever feasible; antibiotics alone usually fail without it." },
      { t: "pitfall", x: "A normal early lactate or the absence of fever does not exclude sepsis, especially in the elderly or immunocompromised." }
    ],
    SEPTIC_SHOCK: [
      { t: "dontmiss", x: "Septic shock = sepsis needing vasopressors to keep MAP ≥65 with lactate >2 despite fluids — start norepinephrine first-line and do not delay." },
      { t: "action", x: "Early broad-spectrum antibiotics plus source control; reassess and de-escalate once cultures return." }
    ],
    PYELONEPHRITIS: [
      { t: "exam", x: "Flank pain with fever and pyuria suggests pyelonephritis; image with CT if there is no improvement by 48–72h to exclude obstruction or abscess." },
      { t: "dontmiss", x: "An obstructing infected stone is a urological emergency that requires urgent drainage (stent or nephrostomy) — antibiotics alone will fail." }
    ],
    CELLULITIS: [
      { t: "pitfall", x: "Bilateral lower-limb 'cellulitis' is usually stasis dermatitis, not infection — true cellulitis is almost always unilateral." },
      { t: "dontmiss", x: "Pain out of proportion to examination, rapid spread, bullae, crepitus or systemic toxicity should raise necrotizing fasciitis — get urgent surgery." }
    ],
    NECROTIZING_FASCIITIS: [
      { t: "dontmiss", x: "Pain out of proportion to examination is the classic early clue; the diagnosis is surgical, not radiologic — do not delay surgical exploration." },
      { t: "action", x: "Urgent surgical debridement plus broad-spectrum antibiotics (add clindamycin for toxin suppression); imaging must never delay the operating room." }
    ],
    IE: [
      { t: "exam", x: "Apply the modified Duke criteria; persistent Staphylococcus aureus bacteremia without another source is infective endocarditis until proven otherwise." },
      { t: "dx", x: "TEE is preferred over TTE when suspicion is high or TTE is non-diagnostic, and for prosthetic valves or intracardiac devices." },
      { t: "action", x: "Take three sets of blood cultures before antibiotics, treat with prolonged IV therapy, and involve cardiac surgery early for heart failure, abscess or large vegetations." }
    ],
    DEVICE_INFECTION: [
      { t: "dontmiss", x: "Complete device removal is recommended whenever feasible — antibiotics alone usually fail while the hardware remains." },
      { t: "exam", x: "Persistent or relapsing Staphylococcus aureus or coagulase-negative staphylococcal bacteremia without another source suggests CIED infection." }
    ],
    CHOLANGITIS: [
      { t: "dontmiss", x: "Charcot's triad (fever, jaundice, RUQ pain) and Reynolds' pentad point to acute cholangitis, which requires urgent biliary drainage — antibiotics alone are not enough." },
      { t: "action", x: "Blood cultures, broad-spectrum antibiotics and source control by biliary decompression; emergent ERCP if septic shock or no response." }
    ],
    C_DIFF: [
      { t: "tip", x: "First-line is oral vancomycin or fidaxomicin; use metronidazole only if these are unavailable, and stop the inciting antibiotic." },
      { t: "dontmiss", x: "Ileus, toxic megacolon, rising lactate or shock indicate fulminant C. difficile — get a surgical consult; do not rely on stool tests to gauge severity." },
      { t: "pitfall", x: "Do not test or treat asymptomatic carriers, and do not repeat testing to confirm cure." }
    ],
    FEBRILE_NEUTROPENIA: [
      { t: "action", x: "A medical emergency — give an empiric antipseudomonal beta-lactam (piperacillin-tazobactam or cefepime) within 1 hour of presentation." },
      { t: "pitfall", x: "Add vancomycin only for specific indications (line infection, skin/soft-tissue, severe mucositis, instability, known MRSA) — not routinely." }
    ],
    DENGUE: [
      { t: "dontmiss", x: "Watch for warning signs around defervescence (days 3–7): abdominal pain, persistent vomiting, mucosal bleeding, lethargy, and a rising haematocrit with falling platelets — these herald plasma leak." },
      { t: "pitfall", x: "Avoid NSAIDs and intramuscular injections; the danger is plasma leakage and shock, not the platelet count itself." }
    ],
    MALARIA: [
      { t: "dontmiss", x: "Any fever with recent travel to or residence in an endemic area is malaria until proven otherwise — do thick and thin smears (repeat if negative) or a rapid antigen test." },
      { t: "action", x: "Severe or falciparum malaria is a medical emergency — IV artesunate is first-line." }
    ],
    ENTERIC_FEVER: [
      { t: "exam", x: "Sustained fever with relative bradycardia, abdominal pain and altered bowel habit after endemic exposure; blood culture is the diagnostic gold standard." },
      { t: "pitfall", x: "The Widal test is unreliable — do not diagnose or exclude typhoid on Widal alone." }
    ],
    PULMONARY_TB: [
      { t: "dontmiss", x: "Cough for more than 2 weeks with weight loss and night sweats — send sputum for Xpert MTB/RIF (detects rifampicin resistance) and AFB, and start airborne isolation." },
      { t: "pitfall", x: "A normal chest X-ray does not exclude TB in HIV or immunocompromised patients." }
    ],
    SBP: [
      { t: "dx", x: "Diagnose with an ascitic fluid PMN count ≥250/µL — perform a diagnostic paracentesis in any cirrhotic with ascites who develops fever, abdominal pain or encephalopathy." },
      { t: "action", x: "Empiric ceftriaxone plus IV albumin (on day 1 and day 3) reduces hepatorenal syndrome and mortality." }
    ],
    dka: [
      { t: "action", x: "Fluids first, then an IV insulin infusion; replace potassium before insulin if K+ <3.3, and never stop insulin until the anion gap has closed." },
      { t: "pitfall", x: "Do not be reassured by glucose alone — beware euglycemic DKA in patients on SGLT2 inhibitors." }
    ],
    acs: [
      { t: "action", x: "Obtain an ECG within 10 minutes; STEMI needs immediate reperfusion (PCI preferred), and give aspirin to all unless contraindicated." },
      { t: "pitfall", x: "A normal initial troponin or ECG does not exclude ACS — serial testing is required." }
    ],
    pe: [
      { t: "exam", x: "Risk-stratify with the Wells score and an age-adjusted D-dimer; CT pulmonary angiography is the investigation of choice in most patients." },
      { t: "dontmiss", x: "Hypotension or RV strain means high-risk PE — consider thrombolysis, and do not delay anticoagulation while awaiting imaging when probability is high." }
    ],
    mesenteric_ischemia: [
      { t: "dontmiss", x: "Pain out of proportion to examination with a vascular history is acute mesenteric ischaemia until proven otherwise — get urgent CT angiography." },
      { t: "pitfall", x: "An almost normal abdominal exam and labs early on are typical and falsely reassuring; lactate rises late." }
    ],

    // ---- next tier of common presentations ----
    HAP: [
      { t: "exam", x: "Pneumonia developing ≥48h after admission; cover MRSA and Pseudomonas empirically when MDR risk factors are present (recent IV antibiotics, prior resistant isolates, high local resistance)." },
      { t: "action", x: "Send a respiratory culture and blood cultures before empiric antibiotics, then de-escalate at 48–72h on results." }
    ],
    VAP: [
      { t: "exam", x: "Suspect with a new infiltrate plus fever, leukocytosis, purulent secretions and worsening oxygenation ≥48h after intubation." },
      { t: "pitfall", x: "Tracheal colonisation is common — do not treat a positive aspirate without clinical/radiographic signs; aim for ~7-day courses to limit resistance." }
    ],
    ASPIRATION_PNEUMONIA: [
      { t: "exam", x: "Dependent-segment infiltrate after impaired consciousness or dysphagia; routine anaerobic cover is not needed unless there is abscess/empyema or poor dentition." },
      { t: "pitfall", x: "Aspiration pneumonitis (acid/chemical) is not infection — antibiotics are not needed in the first 48h unless features fail to resolve." }
    ],
    COPD_EXACERBATION: [
      { t: "action", x: "Controlled O2 (target SpO2 88–92%), inhaled bronchodilators and systemic steroids; add antibiotics when sputum is purulent or ventilatory support is needed." },
      { t: "dontmiss", x: "Rising CO2 with respiratory acidosis → start NIV early; it reduces intubation and mortality." }
    ],
    CYSTITIS: [
      { t: "tip", x: "First-line is nitrofurantoin, fosfomycin or pivmecillinam; avoid fluoroquinolones for simple cystitis, and no culture is needed in classic uncomplicated cases." },
      { t: "pitfall", x: "Do not treat asymptomatic bacteriuria except in pregnancy or before a urologic procedure." }
    ],
    COMPLICATED_UTI: [
      { t: "exam", x: "UTI with fever, or in men, pregnancy, catheter, obstruction or immunocompromise — culture-guided and longer course; image if no response by 48–72h." },
      { t: "dontmiss", x: "An obstructed, infected urinary tract needs urgent drainage — antibiotics alone will fail." }
    ],
    CHOLECYSTITIS: [
      { t: "exam", x: "RUQ pain, fever and a positive Murphy's sign; ultrasound shows wall thickening, pericholecystic fluid and a sonographic Murphy's sign." },
      { t: "action", x: "Antibiotics plus analgesia, and early laparoscopic cholecystectomy (within ~7 days) is preferred over delayed surgery." }
    ],
    GASTROENTERITIS: [
      { t: "tip", x: "Most acute gastroenteritis is viral and self-limited — oral rehydration is the mainstay and antibiotics are not routinely needed." },
      { t: "dontmiss", x: "In bloody diarrhoea, avoid antimotility agents and avoid empiric antibiotics if Shiga-toxin E. coli is possible (haemolytic-uraemic syndrome risk)." }
    ],
    DIABETIC_FOOT: [
      { t: "exam", x: "Probe-to-bone, or an ulcer >2 cm or long-standing, suggests osteomyelitis — image (MRI) and take deep/bone cultures, not superficial swabs." },
      { t: "action", x: "Debridement/drainage, offloading and vascular assessment matter as much as antibiotics." }
    ],
    ERYSIPELAS: [
      { t: "exam", x: "Sharply demarcated, raised, fiery-red plaque (unlike cellulitis' ill-defined edge); usually group A Streptococcus, and penicillin is first-line." }
    ],
    BRAIN_ABSCESS: [
      { t: "dontmiss", x: "Ring-enhancing lesion with headache, fever and focal deficit — neurosurgical aspiration gives both diagnosis and source control; avoid LP (herniation risk)." },
      { t: "action", x: "Empiric cover for streptococci, anaerobes and gram-negatives (e.g., ceftriaxone + metronidazole), then prolonged IV therapy." }
    ],
    ENCEPHALITIS: [
      { t: "dontmiss", x: "Fever with altered mental status, seizures or focal signs — start empiric IV acyclovir immediately for possible HSV; do not wait for PCR." },
      { t: "dx", x: "CSF shows a lymphocytic pleocytosis; HSV PCR can be falsely negative very early (repeat), and MRI may show temporal-lobe changes in HSV." }
    ],
    CNS_TB: [
      { t: "exam", x: "Subacute meningitis with cranial-nerve palsies and basal enhancement; CSF shows lymphocytic pleocytosis, high protein and very low glucose." },
      { t: "action", x: "Start anti-TB therapy plus adjunctive corticosteroids early — do not delay for confirmation when suspicion is high." }
    ],
    VIRAL_HEPATITIS: [
      { t: "exam", x: "Acute hepatitis with markedly raised transaminases; check A/B/C/E serologies. Hepatitis E can be severe in pregnancy." },
      { t: "dontmiss", x: "Watch for acute liver failure — coagulopathy (rising INR) and encephalopathy — and refer to a transplant centre early." }
    ],
    LEPTOSPIROSIS: [
      { t: "exam", x: "Fever with calf myalgia, conjunctival suffusion and AKI after water/soil exposure; Weil's disease = jaundice + AKI + bleeding." },
      { t: "action", x: "Treat empirically (doxycycline, or IV penicillin/ceftriaxone if severe) — do not wait for serology." }
    ],
    SCRUB_TYPHUS: [
      { t: "exam", x: "Acute undifferentiated fever with an eschar and regional lymphadenopathy in an endemic area." },
      { t: "action", x: "Doxycycline is first-line and a reasonable empiric choice for tropical acute febrile illness; the response is rapid." }
    ],
    PHARYNGITIS: [
      { t: "tip", x: "Use the Centor/McIsaac score to decide testing/treatment; most pharyngitis is viral. Treat group A Strep (penicillin/amoxicillin) to prevent rheumatic fever." },
      { t: "pitfall", x: "Avoid amoxicillin if infectious mononucleosis is possible (rash), and avoid routine antibiotics for low Centor scores." }
    ],
    covid19: [
      { t: "action", x: "Dexamethasone for patients needing oxygen; add an immunomodulator (e.g., tocilizumab or baricitinib) in rapidly progressing hypoxia per local protocol." },
      { t: "pitfall", x: "Antibiotics are not routine — bacterial co-infection at presentation is uncommon; assess VTE risk and anticoagulate per protocol." }
    ],
    hiv_aids: [
      { t: "dontmiss", x: "New HIV with hypoxia and bilateral infiltrates → think PCP (start co-trimoxazole, add steroids if PaO2 is low); consider cryptococcal disease and TB in advanced disease." },
      { t: "tip", x: "Start ART early; check CD4 and viral load and screen for opportunistic infections by CD4 stratum." }
    ],
    heart_failure: [
      { t: "action", x: "Acute pulmonary oedema: sit up, high-flow O2/NIV, IV loop diuretic, and nitrates if hypertensive; identify the precipitant (ischaemia, AF, non-adherence)." },
      { t: "pitfall", x: "Avoid fluids, and recognise the cold-and-wet (hypoperfused) patient who needs inotropes/ICU rather than diuresis alone." }
    ],
    ischemic_stroke: [
      { t: "action", x: "Time is brain — non-contrast CT to exclude haemorrhage, then IV thrombolysis within the window and thrombectomy for large-vessel occlusion. Document last-known-well." },
      { t: "pitfall", x: "Do not aggressively lower BP in acute ischaemic stroke unless thrombolysing or BP >220/120; always check glucose (a stroke mimic)." }
    ],
    ich: [
      { t: "action", x: "Reverse anticoagulation immediately, control BP (target ~140 mmHg systolic) and get neurosurgical review for posterior-fossa or large haematomas." },
      { t: "dontmiss", x: "A rapid GCS drop or a posterior-fossa bleed signals impending herniation — urgent imaging and neurosurgery." }
    ],
    sah: [
      { t: "exam", x: "Thunderclap (worst-ever, peaks in seconds) headache; CT is highly sensitive early — if negative and suspicion persists, do an LP for xanthochromia." },
      { t: "action", x: "Secure the aneurysm early (coil/clip), give nimodipine to prevent vasospasm, and manage in a specialist centre." }
    ],
    aki: [
      { t: "exam", x: "Classify pre-renal vs intrinsic vs post-renal, and always exclude obstruction with a bladder scan/ultrasound; review nephrotoxins and recent contrast." },
      { t: "action", x: "Treat the cause and restore perfusion, stop nephrotoxins; urgent dialysis for refractory hyperkalaemia, acidosis, fluid overload or uraemia." }
    ],
    pancreatitis: [
      { t: "exam", x: "Diagnose with 2 of 3: typical pain, lipase >3× upper limit, or imaging. Early aggressive fluid resuscitation is the cornerstone." },
      { t: "pitfall", x: "Do not give prophylactic antibiotics — reserve them for confirmed infected necrosis; early CT severity is unreliable in the first 72h." }
    ],
    peptic_ulcer: [
      { t: "action", x: "Resuscitate first (restrictive transfusion to Hb ~7 g/dL), IV PPI, and endoscopy within 24h; if cirrhotic, suspect varices and add a vasoactive drug plus antibiotics." },
      { t: "pitfall", x: "Do not delay endoscopy in an unstable bleeder, and always test/treat H. pylori and stop NSAIDs." }
    ],
    asthma_exac: [
      { t: "action", x: "Back-to-back salbutamol + ipratropium, early systemic steroids and controlled O2; add IV magnesium for severe or life-threatening attacks." },
      { t: "dontmiss", x: "A normalising or rising CO2 during an acute asthma attack signals fatigue and impending respiratory failure — get ICU early." }
    ],
    anaphylaxis: [
      { t: "action", x: "IM adrenaline 0.5 mg (1:1000) to the anterolateral thigh immediately is first-line; repeat at 5 minutes. Antihistamines and steroids are adjuncts, never the priority." },
      { t: "pitfall", x: "Do not delay adrenaline for IV access or steroids, and observe for a biphasic reaction." }
    ],
    hyperkalemia: [
      { t: "action", x: "ECG first — with changes (peaked T waves, wide QRS), give IV calcium to stabilise the myocardium, then insulin–glucose ± salbutamol to shift K+, and remove K+ (dialysis if severe)." },
      { t: "pitfall", x: "Calcium does not lower potassium — it protects the heart while the shifting and removal measures work." }
    ],
    hyponatremia: [
      { t: "action", x: "Symptomatic (seizures/coma) → 3% hypertonic saline boluses; otherwise correct slowly (≤8–10 mmol/L per 24h)." },
      { t: "dontmiss", x: "Over-rapid correction causes osmotic demyelination — recheck sodium frequently and cap the rate of rise." }
    ],
    thyroid_storm: [
      { t: "action", x: "Beta-blocker (propranolol), then a thionamide (PTU/methimazole), then iodine at least 1h AFTER the thionamide, plus hydrocortisone; treat the trigger." },
      { t: "pitfall", x: "Give iodine only after the thionamide — given first it fuels hormone synthesis." }
    ],
    adrenal_crisis: [
      { t: "action", x: "Give IV hydrocortisone 100 mg immediately (do not wait for cortisol), with aggressive IV fluids and glucose; treat the precipitant." },
      { t: "dontmiss", x: "Suspect in any shocked patient on or recently off steroids, or with hyponatraemia plus hyperkalaemia." }
    ],
    gbs: [
      { t: "exam", x: "Ascending symmetric weakness with areflexia after a recent infection; CSF shows albuminocytologic dissociation (high protein, normal cell count)." },
      { t: "dontmiss", x: "Monitor FVC and respiratory function serially — a falling FVC means impending respiratory failure; treat with IVIG or plasma exchange." }
    ],
    htn_emergency: [
      { t: "action", x: "Hypertensive emergency = severe BP plus acute target-organ damage — lower MAP by ~10–20% in the first hour with a titratable IV agent, not a rapid normalisation." },
      { t: "pitfall", x: "Asymptomatic severe hypertension (urgency) does not need rapid IV lowering — over-aggressive drops cause ischaemia." }
    ]
  };
  var EV_BRIEF_META = {
    dontmiss: { ic: "🚨", label: "Don't miss", a: "warn" },
    exam: { ic: "🎯", label: "Exam pearl", a: "pearl" },
    pitfall: { ic: "⚠️", label: "Pitfall", a: "pitfall" },
    tip: { ic: "📌", label: "Practice tip", a: "tip" },
    action: { ic: "🔑", label: "Key action", a: "tx" },
    dx: { ic: "🩺", label: "Diagnostic pearl", a: "ix" }
  };
  function evBriefing(id) {
    var b = EXAM_PEARLS[id]; if (!b || !b.length) return "";
    return '<div class="ev-brief"><div class="ev-brief-h"><span>⭐</span> StewardMD clinical briefing<span class="ev-brief-by">clinician-curated</span></div>' +
      b.map(function (p) {
        var m = EV_BRIEF_META[p.t] || EV_BRIEF_META.exam;
        return '<div class="ev-bc ev-bc--' + m.a + '"><span class="ev-bc-ic">' + m.ic + '</span><div class="ev-bc-bd"><span class="ev-bc-tag ev-tag--' + m.a + '">' + m.label + '</span>' + medFormat(stripCite(p.x)) + '</div></div>';
      }).join("") + '</div>';
  }
  // the collapsible body (pearls hero + sections + full reference) — lazy-built
  function evBodyHTML(src) {
    // the clinician briefing belongs to the disease — show it once, in the primary (Harrison) panel.
    var h = '<div class="ev-body">' + (src.srcKey === "harrison" ? evBriefing(src._id) : "");
    if (src.pearls && src.pearls.length) {
      h += '<div class="ev-pearls"><div class="ev-pearls-h"><span>⭐</span> ' + esc(src.pearlsLabel || "Key clinical pearls") + '</div>' +
        src.pearls.map(function (p) { var k = pearlKind(p); return '<div class="ev-pearl ev-pearl--' + k.a + '"><span class="ev-pearl-ic">' + k.ic + '</span><div class="ev-pearl-bd"><span class="ev-pearl-tag ev-tag--' + k.a + '">' + k.label + '</span>' + medFormat(stripCite(p)) + '</div></div>'; }).join("") +
        '</div>';
    }
    (src.sections || []).forEach(function (s) {
      h += '<div class="ev-sec' + (s.danger ? " danger" : "") + '"><button type="button" class="ev-sec-h">' +
        '<span class="ev-sec-ic">' + s.ic + '</span><span class="ev-sec-t">' + esc(s.title) + '</span><span class="ev-chev">⌄</span></button>' +
        '<div class="ev-sec-p"><div class="ev-sec-in">' + s.html + '</div></div></div>';
    });
    if (src.fullHTML) {
      h += '<div class="ev-sec ev-full"><button type="button" class="ev-sec-h">' +
        '<span class="ev-sec-ic">📄</span><span class="ev-sec-t">Original Reference</span><span class="ev-chev">⌄</span></button>' +
        '<div class="ev-sec-p"><div class="ev-sec-in">' + src.fullHTML + '</div></div></div>';
    }
    h += '<div class="ev-cite">' + src.cite + '</div></div>';
    return h;
  }
  function evViewerHTML(src, opts) {
    if (!src) return "";
    opts = opts || {};
    var open = !!opts.expanded;
    var sub = [src.edition, src.tag, src.pages].filter(Boolean).join(" · ");
    return '<div class="ev-wrap' + (open ? " ev-open" : "") + '" data-ev="' + src._id + '" data-ev-src="' + (src.srcKey || "harrison") + '">' +
      '<button type="button" class="ev-top"><span class="ev-top-ic">' + src.icon + '</span>' +
        '<span class="ev-top-main"><span class="ev-top-title">' + esc(src.sourceName) + '</span>' +
        (sub ? '<span class="ev-top-sub">' + esc(sub) + '</span>' : '') + '</span>' +
        '<span class="ev-chev ev-chev-top">⌄</span></button>' +
      '<div class="ev-panel"><div class="ev-panel-in">' + (open ? evBodyHTML(src) : '') + '</div></div></div>';
  }
  // delegated toggle + lazy build — wired once, works wherever the HTML is injected
  function evEnsure() {
    try { evInjectCSS(); } catch (e) {}
    if (window.__smdEvWired) return; window.__smdEvWired = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target; if (!t || !t.closest) return;
      var top = t.closest(".ev-top");
      if (top) {
        var wrap = top.parentNode;
        var pin = wrap.querySelector(".ev-panel-in");
        if (pin && !pin.firstChild && wrap.getAttribute("data-ev")) {        // lazy build on first open
          try {
            var k = wrap.getAttribute("data-ev-src") || "harrison";
            var b = EV_BUILDERS[k] || evHarrisonSrc;
            var src = b(wrap.getAttribute("data-ev"));
            if (src) { src.srcKey = k; pin.innerHTML = evBodyHTML(src); }
          } catch (e) {}
        }
        wrap.classList.toggle("ev-open"); return;
      }
      var sh = t.closest(".ev-sec-h");
      if (sh && sh.parentNode) sh.parentNode.classList.toggle("ev-open");
    }, false);
  }
  function evInjectCSS() {
    if (document.getElementById("smdEvCSS")) return;
    var st = document.createElement("style"); st.id = "smdEvCSS";
    st.textContent = [
      ".ev-wrap{border:1px solid var(--line,#e2e8f0);border-radius:14px;background:#fff;overflow:hidden;margin:8px 0;font-size:14px}",
      ".ev-top{display:flex;align-items:center;gap:11px;width:100%;border:none;background:linear-gradient(180deg,#f6fbfa,#eef6f4);padding:13px 14px;cursor:pointer;text-align:left;min-height:52px}",
      ".ev-top-ic{font-size:18px;width:34px;height:34px;flex:none;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid var(--line,#e2e8f0);border-radius:10px}",
      ".ev-top-main{display:flex;flex-direction:column;flex:1;min-width:0}",
      ".ev-top-title{font-weight:700;color:var(--ink,#0f172a);font-size:13.5px;line-height:1.25}",
      ".ev-top-sub{font-size:11.5px;color:var(--teal-d,#0b5a54);margin-top:2px}",
      ".ev-chev{font-size:16px;color:var(--slate-soft,#94a3b8);transition:transform .28s ease;flex:none}",
      ".ev-wrap.ev-open>.ev-top .ev-chev-top{transform:rotate(180deg)}",
      ".ev-panel{display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s ease}",
      ".ev-wrap.ev-open>.ev-panel{grid-template-rows:1fr}",
      ".ev-panel-in{overflow:hidden;min-height:0}",
      ".ev-body{padding:13px 13px 4px}",
      ".ev-pearls{background:linear-gradient(180deg,#faf7ff,#f4f0fe);border:1px solid #e9d5ff;border-radius:12px;padding:12px 13px;margin-bottom:13px}",
      ".ev-pearls-h{font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6d28d9;margin-bottom:9px;display:flex;align-items:center;gap:6px}",
      ".ev-pearl{display:flex;gap:9px;align-items:flex-start;background:#fff;border:1px solid #eef2f7;border-left:3px solid #c4b5fd;border-radius:10px;padding:10px 11px;margin-bottom:7px;line-height:1.55;color:var(--ink,#0f172a)}",
      ".ev-pearl:last-child{margin-bottom:0}.ev-pearl-ic{flex:none;font-size:14px;line-height:1.45}",
      ".ev-pearl--warn{border-left-color:#fb923c}.ev-pearl--tx{border-left-color:#34d399}.ev-pearl--ix{border-left-color:#60a5fa}.ev-pearl--pearl{border-left-color:#c4b5fd}",
      ".ev-pearl-bd{flex:1;min-width:0}",
      ".ev-pearl-tag{display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:1px 7px;border-radius:20px;margin-right:7px;background:#ede9fe;color:#6d28d9}",
      ".ev-tag--warn{background:#fee2e2;color:#991b1b}.ev-tag--tx{background:#dcfce7;color:#166534}.ev-tag--ix{background:#dbeafe;color:#1e40af}.ev-tag--pearl{background:#ede9fe;color:#6d28d9}",
      ".ev-callouts{display:flex;flex-direction:column;gap:7px;margin:4px 0}",
      ".ev-callout{display:flex;gap:9px;align-items:flex-start;border-radius:10px;padding:10px 11px;line-height:1.5;border:1px solid}",
      ".ev-callout-ic{flex:none;font-size:14px;line-height:1.4}",
      ".ev-callout--danger{background:#fef2f2;border-color:#fecaca;color:#7f1d1d}",
      ".ev-callout--warn{background:#fff7ed;border-color:#fed7aa;color:#7c2d12}",
      ".ev-brief{background:linear-gradient(180deg,#f8fafc,#f1f5f9);border:1px solid #e2e8f0;border-radius:13px;padding:12px 12px 9px;margin-bottom:13px}",
      ".ev-brief-h{display:flex;align-items:center;gap:6px;font-weight:800;font-size:12.5px;letter-spacing:.02em;color:#0f172a;margin-bottom:10px}",
      ".ev-brief-by{margin-left:auto;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#0b5a54;background:#d9f0eb;padding:2px 8px;border-radius:20px}",
      ".ev-bc{display:flex;gap:9px;align-items:flex-start;background:#fff;border:1px solid #eef2f7;border-left:4px solid #c4b5fd;border-radius:10px;padding:10px 11px;margin-bottom:7px;line-height:1.55;color:#0f172a}",
      ".ev-bc:last-child{margin-bottom:0}.ev-bc-ic{flex:none;font-size:15px;line-height:1.4}.ev-bc-bd{flex:1;min-width:0}",
      ".ev-bc--warn{border-left-color:#ef4444}.ev-bc--pitfall{border-left-color:#f97316}.ev-bc--pearl{border-left-color:#8b5cf6}.ev-bc--tip{border-left-color:#0ea5e9}.ev-bc--tx{border-left-color:#10b981}.ev-bc--ix{border-left-color:#3b82f6}",
      ".ev-bc-tag{display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:1px 7px;border-radius:20px;margin-right:7px}",
      ".ev-tag--pitfall{background:#ffedd5;color:#9a3412}.ev-tag--tip{background:#e0f2fe;color:#075985}",
      ".ev-ul--danger li:before{background:#dc2626}.ev-ul--warn li:before{background:#ea580c}",
      ".md-bug{color:#b91c1c;font-weight:700}",
      ".md-resist{color:#b91c1c;font-weight:700}",
      ".md-emerg{color:#c2410c;font-weight:700}",
      ".md-ix{color:#1d4ed8;font-weight:700}",
      ".md-drug{color:#047857;font-weight:700}",
      ".md-action{color:#0b5a54;font-weight:700}",
      ".md-abs{font-weight:700;color:#0f172a}",
      ".md-key{font-weight:700;color:#1e293b}",
      ".md-hi,.md-sig{font-weight:700;color:#7c3aed}",
      ".ev-wrap[data-ev-src=idsa]>.ev-top{background:linear-gradient(180deg,#f6f5ff,#eef2ff)}.ev-wrap[data-ev-src=idsa] .ev-top-sub{color:#5b21b6}",
      ".ev-wrap[data-ev-src=sanford]>.ev-top{background:linear-gradient(180deg,#f0fdf4,#ecfdf5)}.ev-wrap[data-ev-src=sanford] .ev-top-sub{color:#047857}",
      ".ev-rx-note{color:var(--slate-soft,#94a3b8);font-size:.92em}",
      ".ev-sec-in a,.ev-cite a{color:#1d4ed8;text-decoration:underline;word-break:break-word}",
      ".md-cite{font-size:.86em;color:#94a3b8}",
      ".ev-sec-in p.ev-lead{font-weight:600;color:#0f172a;font-size:14px;line-height:1.6;background:#f6f8ff;border-left:3px solid #818cf8;border-radius:8px;padding:9px 11px;margin:2px 0 10px}",
      ".ev-cite strong{color:#334155}",
      ".ev-sec{border:1px solid var(--line,#e2e8f0);border-radius:11px;margin-bottom:8px;overflow:hidden;background:#fff}",
      ".ev-sec.danger{border-color:#fecaca}",
      ".ev-sec-h{display:flex;align-items:center;gap:10px;width:100%;border:none;background:#fbfdfd;padding:12px 13px;cursor:pointer;text-align:left;min-height:48px;font:inherit}",
      ".ev-sec.danger .ev-sec-h{background:#fef4f4}",
      ".ev-sec-ic{font-size:15px;flex:none}.ev-sec-t{flex:1;font-weight:650;font-weight:600;color:var(--ink,#0f172a);font-size:13.5px}",
      ".ev-wrap .ev-sec.ev-open>.ev-sec-h .ev-chev{transform:rotate(180deg)}",
      ".ev-sec-p{display:grid;grid-template-rows:0fr;transition:grid-template-rows .26s ease}",
      ".ev-sec.ev-open>.ev-sec-p{grid-template-rows:1fr}",
      ".ev-sec-in{overflow:hidden;min-height:0}.ev-sec.ev-open>.ev-sec-p>.ev-sec-in{padding:4px 14px 13px}",
      ".ev-subh{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--slate-soft,#94a3b8);margin:11px 0 5px}",
      ".ev-sec-in p{margin:6px 0;line-height:1.6;color:#334155}",
      ".ev-ul{margin:4px 0;padding-left:2px;list-style:none}",
      ".ev-ul li{position:relative;padding:5px 0 5px 18px;line-height:1.55;color:#334155;border-bottom:1px solid #f1f5f9}",
      ".ev-ul li:last-child{border-bottom:none}",
      ".ev-ul li:before{content:'';position:absolute;left:3px;top:12px;width:5px;height:5px;border-radius:50%;background:var(--teal,#0f766e)}",
      ".ev-sec.danger .ev-ul li:before{background:#dc2626}",
      ".ev-cite{font-size:11px;color:var(--slate-soft,#94a3b8);line-height:1.5;padding:10px 2px 12px;border-top:1px solid #f1f5f9;margin-top:4px}",
      "@media(max-width:520px){.ev-body{padding:11px 10px 4px}.ev-sec.ev-open>.ev-sec-p>.ev-sec-in{padding:4px 11px 12px}}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }
  // Public, source-agnostic entry. harrisonRef keeps its name/signature for the
  // existing call sites; opts.expanded shows pearls immediately (reference panel),
  // omitted = collapsed teaser (differential cards).
  /* ---- ADDITIONAL EVIDENCE SOURCES (reusable, same viewer) ----
   * Each builder returns the same descriptor shape as evHarrisonSrc and is rendered
   * by the same evViewerHTML/evBodyHTML. Content is clinician-PARAPHRASED standard
   * recommendations + standard empiric dosing for decision support — NOT verbatim
   * proprietary text — with official source links. Future sources (ESC, ATS, NICE,
   * WHO) drop in by adding a data store + a builder to EV_BUILDERS. */
  var IDSA_GUIDELINES = {
    CAP: { society: "IDSA / ATS", title: "Community-Acquired Pneumonia in Adults", year: 2019, url: "https://www.idsociety.org/practice-guideline/community-acquired-pneumonia-cap-in-adults/", recs: [
      "Healthy outpatients: amoxicillin or doxycycline (a macrolide only where pneumococcal macrolide resistance is low).",
      "Outpatients with comorbidities: a beta-lactam plus a macrolide, or a respiratory fluoroquinolone.",
      "Do not routinely cover MRSA or Pseudomonas unless locally validated risk factors are present.",
      "Corticosteroids are not recommended in non-severe CAP; treat for a minimum of 5 days once stable." ] },
    SEVERE_CAP: { society: "IDSA / ATS", title: "Community-Acquired Pneumonia (severe / inpatient)", year: 2019, url: "https://www.idsociety.org/practice-guideline/community-acquired-pneumonia-cap-in-adults/", recs: [
      "Inpatient/ICU: a beta-lactam plus a macrolide, OR a beta-lactam plus a respiratory fluoroquinolone.",
      "Obtain blood and respiratory cultures in severe disease.",
      "Add MRSA or Pseudomonas cover only with validated risk factors (prior isolation, recent hospitalization with IV antibiotics).",
      "Reserve corticosteroids for refractory septic shock." ] },
    HAP: { society: "IDSA / ATS", title: "Hospital-Acquired & Ventilator-Associated Pneumonia", year: 2016, url: "https://www.idsociety.org/practice-guideline/hap_vap/", recs: [
      "Base empiric therapy on the local antibiogram; cover S. aureus and Pseudomonas.",
      "Add MRSA cover with MRSA risk or in units with high MRSA prevalence.",
      "Use two antipseudomonal agents only with high resistance risk or shock.",
      "Treat for 7 days and de-escalate on culture results." ] },
    VAP: { society: "IDSA / ATS", title: "Ventilator-Associated Pneumonia", year: 2016, url: "https://www.idsociety.org/practice-guideline/hap_vap/", recs: [
      "Empiric cover for S. aureus, Pseudomonas and other gram-negatives, guided by the unit antibiogram.",
      "Do not treat a positive tracheal aspirate without clinical and radiographic signs.",
      "A 7-day course is recommended for most VAP, with de-escalation.",
      "Use clinical criteria (not procalcitonin alone) to diagnose." ] },
    MENINGITIS: { society: "IDSA", title: "Bacterial Meningitis", year: 2004, url: "https://www.idsociety.org/practice-guideline/bacterial-meningitis/", recs: [
      "Start empiric vancomycin PLUS a third-generation cephalosporin (ceftriaxone/cefotaxime) immediately.",
      "Add ampicillin when Listeria is a concern (age >50, immunocompromised, pregnant).",
      "Give adjunctive dexamethasone before or with the first dose for suspected pneumococcal meningitis.",
      "Do not delay antibiotics for CT or LP." ] },
    IE: { society: "AHA / IDSA", title: "Infective Endocarditis in Adults (AHA Scientific Statement)", year: 2015, url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000000296", recs: [
      "Obtain three sets of blood cultures from separate sites before antibiotics.",
      "Apply the modified Duke criteria; echocardiography with TEE preferred when suspicion is high.",
      "Definitive therapy is pathogen-directed and prolonged (typically 4–6 weeks IV).",
      "Early surgery for heart failure, perivalvular abscess, large/mobile vegetations or persistent bacteremia." ] },
    FEBRILE_NEUTROPENIA: { society: "IDSA", title: "Antimicrobial Use in Neutropenic Patients with Cancer", year: 2010, url: "https://www.idsociety.org/practice-guideline/fever-and-neutropenia/", recs: [
      "High-risk patients: empiric monotherapy with an antipseudomonal beta-lactam within 1 hour.",
      "Add vancomycin only for specific indications (line infection, skin/soft-tissue, severe mucositis, hypotension, known MRSA).",
      "Low-risk patients (by MASCC score) may be eligible for oral outpatient therapy.",
      "Reassess at 2–4 days and adjust on cultures and clinical response." ] },
    CELLULITIS: { society: "IDSA", title: "Skin and Soft Tissue Infections", year: 2014, url: "https://www.idsociety.org/practice-guideline/skin-and-soft-tissue-infections/", recs: [
      "Non-purulent cellulitis: cover streptococci (and MSSA) with a beta-lactam.",
      "Purulent SSTI: incision and drainage; add MRSA cover for moderate/severe disease.",
      "Mark the margin, elevate the limb and treat predisposing factors.",
      "Severe or rapidly progressive infection: broaden cover and obtain surgical evaluation." ] },
    NECROTIZING_FASCIITIS: { society: "IDSA", title: "Necrotizing Soft Tissue Infections (SSTI guideline)", year: 2014, url: "https://www.idsociety.org/practice-guideline/skin-and-soft-tissue-infections/", recs: [
      "Urgent surgical exploration and debridement is the priority — do not delay for imaging.",
      "Empiric broad-spectrum cover PLUS clindamycin for toxin suppression.",
      "Narrow therapy once operative findings and cultures return.",
      "Repeat debridement as needed with supportive ICU care." ] },
    C_DIFF: { society: "IDSA / SHEA", title: "Clostridioides difficile Infection", year: 2021, url: "https://www.idsociety.org/practice-guideline/clostridioides-difficile/", recs: [
      "Initial episode: oral fidaxomicin or oral vancomycin (preferred over metronidazole).",
      "Fulminant disease: high-dose oral vancomycin plus IV metronidazole, with surgical consultation.",
      "Stop the inciting antibiotic where possible.",
      "Do not test or treat asymptomatic carriers; use fidaxomicin or a tapered regimen for recurrence." ] },
    PYELONEPHRITIS: { society: "IDSA", title: "Acute Uncomplicated Pyelonephritis", year: 2010, url: "https://www.idsociety.org/practice-guideline/uncomplicated-cystitis-and-pyelonephritis-uti/", recs: [
      "Obtain a urine culture before therapy.",
      "Outpatient: a fluoroquinolone where local resistance is low, guided by susceptibility.",
      "Hospitalized: an IV agent active against likely gram-negatives, narrowed on cultures.",
      "Image to exclude obstruction or abscess if no improvement by 48–72 hours." ] },
    COMPLICATED_UTI: { society: "IDSA", title: "Complicated Urinary Tract Infection", year: 2010, url: "https://www.idsociety.org/practice-guideline/uncomplicated-cystitis-and-pyelonephritis-uti/", recs: [
      "Always obtain a urine culture and treat based on susceptibility.",
      "Relieve any obstruction — antibiotics alone fail an obstructed, infected tract.",
      "Use a longer course than for uncomplicated cystitis.",
      "Remove or exchange an infected catheter where possible." ] },
    CYSTITIS: { society: "IDSA", title: "Acute Uncomplicated Cystitis in Women", year: 2011, url: "https://www.idsociety.org/practice-guideline/uncomplicated-cystitis-and-pyelonephritis-uti/", recs: [
      "First-line: nitrofurantoin, trimethoprim–sulfamethoxazole (resistance <20%), or fosfomycin.",
      "Reserve fluoroquinolones for when first-line agents are unsuitable.",
      "A urine culture is not required for classic uncomplicated cystitis.",
      "Do not treat asymptomatic bacteriuria except in pregnancy or before urologic procedures." ] },
    CHOLANGITIS: { society: "IDSA / SIS + Tokyo Guidelines", title: "Acute Cholangitis / Complicated Intra-abdominal Infection", year: 2010, url: "https://www.idsociety.org/practice-guideline/intra-abdominal-infections/", recs: [
      "Source control by biliary drainage (ERCP) is essential — urgently if severe.",
      "Empiric cover for enteric gram-negatives and anaerobes.",
      "Obtain blood and bile cultures and narrow on results.",
      "Tokyo severity grading guides the timing of drainage and level of care." ] },
    DIABETIC_FOOT: { society: "IDSA", title: "Diabetic Foot Infections", year: 2012, url: "https://www.idsociety.org/practice-guideline/diabetic-foot-infections/", recs: [
      "Grade severity clinically; mild infections often need only gram-positive cover.",
      "Obtain deep-tissue or bone cultures, not superficial swabs.",
      "Suspect osteomyelitis with probe-to-bone or a large/chronic ulcer; confirm with MRI or bone biopsy.",
      "Combine antibiotics with debridement, offloading and vascular assessment." ] },
    SBP: { society: "AASLD", title: "Spontaneous Bacterial Peritonitis (Ascites/Cirrhosis guidance)", year: 2021, url: "https://www.aasld.org/practice-guidelines", recs: [
      "Diagnose with an ascitic PMN count ≥250/µL; do a diagnostic paracentesis on admission.",
      "Empiric third-generation cephalosporin (ceftriaxone or cefotaxime).",
      "Add IV albumin (day 1 and day 3) to reduce hepatorenal syndrome and mortality.",
      "Start secondary prophylaxis after an episode." ] }
  };
  var SANFORD_RX = {
    CAP: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Amoxicillin", dose: "1 g", route: "PO TID", dur: "≥5 d" }, { drug: "Doxycycline", dose: "100 mg", route: "PO BID", dur: "5 d" }], alt: [{ drug: "Azithromycin", dose: "500 mg → 250 mg", route: "PO", note: "only where macrolide resistance is low" }], notes: "With comorbidities: amoxicillin–clavulanate or a cephalosporin PLUS a macrolide, or a respiratory fluoroquinolone (levofloxacin 750 mg)." },
    SEVERE_CAP: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV daily" }, { drug: "+ Azithromycin", dose: "500 mg", route: "IV daily" }], alt: [{ drug: "Levofloxacin", dose: "750 mg", route: "IV daily" }], notes: "Add vancomycin/linezolid (MRSA) or piperacillin–tazobactam/cefepime (Pseudomonas) only with risk factors." },
    HAP: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Piperacillin–tazobactam", dose: "4.5 g", route: "IV q6–8h" }, { drug: "or Cefepime", dose: "2 g", route: "IV q8h" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h" }], notes: "Add vancomycin or linezolid for MRSA; choose per unit antibiogram; 7-day course." },
    VAP: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Piperacillin–tazobactam", dose: "4.5 g", route: "IV q6h" }, { drug: "or Cefepime", dose: "2 g", route: "IV q8h" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h" }], notes: "Add vancomycin/linezolid for MRSA; de-escalate on cultures." },
    MENINGITIS: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h" }, { drug: "+ Vancomycin", dose: "15–20 mg/kg", route: "IV q8–12h" }], alt: [{ drug: "+ Ampicillin", dose: "2 g", route: "IV q4h", note: "if Listeria risk" }], notes: "Dexamethasone 10 mg IV q6h before/with the first dose for suspected pneumococcal." },
    IE: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Vancomycin", dose: "15–20 mg/kg", route: "IV q8–12h" }, { drug: "+ Ceftriaxone", dose: "2 g", route: "IV daily", note: "empiric, native valve, cultures pending" }], notes: "Definitive therapy is pathogen-directed and prolonged (4–6 weeks); add gentamicin/rifampin per organism and valve type." },
    FEBRILE_NEUTROPENIA: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Piperacillin–tazobactam", dose: "4.5 g", route: "IV q6h" }, { drug: "or Cefepime", dose: "2 g", route: "IV q8h" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h" }], notes: "Within 1 hour; add vancomycin only for specific indications." },
    CELLULITIS: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Cephalexin", dose: "500 mg", route: "PO QID", note: "mild, non-purulent" }, { drug: "or Cefazolin", dose: "1–2 g", route: "IV q8h", note: "moderate" }], alt: [{ drug: "Doxycycline / TMP–SMX", dose: "", route: "PO", note: "if MRSA suspected (purulent)" }], notes: "Purulent SSTI → incision & drainage plus MRSA cover." },
    NECROTIZING_FASCIITIS: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Piperacillin–tazobactam", dose: "4.5 g", route: "IV q6–8h" }, { drug: "+ Vancomycin", dose: "15–20 mg/kg", route: "IV q8–12h" }, { drug: "+ Clindamycin", dose: "900 mg", route: "IV q8h", note: "toxin suppression" }], notes: "Surgery is the priority; antibiotics are adjunctive." },
    C_DIFF: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Fidaxomicin", dose: "200 mg", route: "PO BID", dur: "10 d" }, { drug: "or Vancomycin", dose: "125 mg", route: "PO QID", dur: "10 d" }], alt: [{ drug: "Vancomycin 500 mg PO QID + Metronidazole 500 mg IV q8h", dose: "", route: "", note: "fulminant" }], notes: "Stop the inciting antibiotic; surgical consult if fulminant." },
    PYELONEPHRITIS: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Ceftriaxone", dose: "1–2 g", route: "IV daily" }, { drug: "or Ciprofloxacin", dose: "500 mg", route: "PO BID", note: "outpatient, low resistance" }], notes: "Narrow on culture; image if no response by 48–72h." },
    COMPLICATED_UTI: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Ceftriaxone", dose: "1–2 g", route: "IV daily" }, { drug: "or Piperacillin–tazobactam", dose: "4.5 g", route: "IV q8h", note: "resistant-organism risk" }], notes: "Relieve obstruction; culture-guided; longer course." },
    CYSTITIS: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Nitrofurantoin", dose: "100 mg", route: "PO BID", dur: "5 d" }, { drug: "or Fosfomycin", dose: "3 g", route: "PO once" }], alt: [{ drug: "TMP–SMX", dose: "160/800 mg", route: "PO BID", dur: "3 d", note: "if resistance <20%" }], notes: "Avoid fluoroquinolones for simple cystitis." },
    CHOLANGITIS: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Piperacillin–tazobactam", dose: "4.5 g", route: "IV q6–8h" }, { drug: "or Ceftriaxone + Metronidazole", dose: "2 g / 500 mg", route: "IV" }], notes: "Biliary drainage (ERCP) is essential — antibiotics are adjunctive." },
    DIABETIC_FOOT: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Amoxicillin–clavulanate", dose: "875/125 mg", route: "PO BID", note: "mild" }, { drug: "or Piperacillin–tazobactam", dose: "4.5 g", route: "IV q6–8h", note: "moderate–severe" }], alt: [{ drug: "+ Vancomycin", dose: "15–20 mg/kg", route: "IV q8–12h", note: "MRSA risk" }], notes: "Combine with debridement, offloading and vascular assessment." },
    SBP: { url: "https://www.sanfordguide.com/", firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV daily" }, { drug: "or Cefotaxime", dose: "2 g", route: "IV q8h" }], notes: "Add IV albumin: 1.5 g/kg on day 1 and 1 g/kg on day 3." }
  };
  function evIdsaSrc(id) {
    var g = IDSA_GUIDELINES[id]; if (!g) return null;
    var sections = [];
    if (g.url) sections.push({ ic: "🔗", title: "Official guideline", html: '<p><a href="' + esc(g.url) + '" target="_blank" rel="noopener noreferrer">' + esc(g.title) + (g.year ? " (" + g.year + ")" : "") + '</a></p>' });
    return {
      _id: id, srcKey: "idsa", icon: "📐", sourceName: g.society || "IDSA Clinical Practice Guideline",
      edition: g.year ? String(g.year) : "", tag: "Guideline", pages: "", pearlsLabel: "Key recommendations",
      pearls: g.recs || [], sections: sections, fullHTML: "",
      cite: '<strong>📐 ' + esc(g.title) + (g.year ? " (" + g.year + ")" : "") + '</strong>' +
        (g.url ? '<br><a href="' + esc(g.url) + '" target="_blank" rel="noopener noreferrer">' + esc(g.url) + '</a>' : '') +
        '<br>Key recommendations paraphrased for decision support — consult the full guideline before acting.'
    };
  }
  function evSanfordSrc(id) {
    var rx = SANFORD_RX[id]; if (!rx) return null;
    var rxList = function (arr) {
      return (arr && arr.length) ? '<ul class="ev-ul">' + arr.map(function (r) {
        var line = [r.drug, r.dose, r.route, r.dur].filter(Boolean).join(" · ");
        return '<li>' + medFormat(line) + (r.note ? ' <span class="ev-rx-note">— ' + esc(r.note) + '</span>' : '') + '</li>';
      }).join("") + '</ul>' : "";
    };
    var body = evSub("First-line", rxList(rx.firstLine)) + evSub("Alternative", rxList(rx.alt));
    if (rx.notes) body += '<div class="ev-subh">Notes</div><p>' + medFormat(rx.notes) + '</p>';
    return {
      _id: id, srcKey: "sanford", icon: "💊", sourceName: "Empiric antimicrobial therapy",
      edition: "", tag: "Regimens · Sanford-aligned", pages: "", pearls: [],
      sections: body ? [{ ic: "💊", title: "Empiric regimens", html: body }] : [], fullHTML: "",
      cite: '<strong>💊 Empiric regimens</strong> — standard adult dosing for decision support; <b>verify dose, route &amp; duration and adjust for renal function, allergy and local resistance.</b> ' +
        'Cross-check the Sanford Guide' + (rx.url ? ' (<a href="' + esc(rx.url) + '" target="_blank" rel="noopener noreferrer">sanfordguide.com</a>)' : '') + '.'
    };
  }
  var EV_BUILDERS = { harrison: evHarrisonSrc, idsa: evIdsaSrc, sanford: evSanfordSrc };
  // render ALL available sources for a disease, stacked (Harrison first/primary).
  function evAllSourcesHTML(id, opts) {
    opts = opts || {};
    var html = "", any = false;
    ["harrison", "idsa", "sanford"].forEach(function (k) {
      var src; try { src = EV_BUILDERS[k](id); } catch (e) { src = null; }
      if (!src) return;
      src.srcKey = k;
      html += evViewerHTML(src, { expanded: !!opts.expanded && k === "harrison" });
      any = true;
    });
    return any ? html : "";
  }
  function harrisonRef(id, opts) {
    evEnsure();
    return evAllSourcesHTML(id, opts || {});
  }

  function card(r, rank) {
    var open = S.expanded[r.id];
    var cls = r.inf ? "inf" : "ni";
    var delta = "";
    var p = S.prev[r.id];
    if (p != null && p !== r.score) delta = r.score > p ? '<span class="dx-up">▲</span>' : '<span class="dx-down">▼</span>';
    else if (p == null && S.started && Object.keys(S.prev).length) delta = '<span class="dx-new">NEW</span>';
    var head =
      '<div class="dx-row-head" data-id="' + r.id + '">' +
        '<div class="dx-rank ' + cls + '">' + rank + '</div>' +
        '<div class="dx-row-main">' +
          '<div class="dx-row-name">' + esc(r.name) + ' ' + delta + (r.matched ? ' <span class="dx-met">criteria met</span>' : '') + (!r.inf && MIMIC[r.id] ? ' <span class="dx-mimic">↔ mimics ' + esc(MIMIC[r.id]) + '</span>' : '') + '</div>' +
          '<div class="dx-bar ' + cls + '"><span style="width:' + r.score + '%"></span></div>' +
          '<div class="dx-row-sys">' + esc(r.system) + '</div>' +
        '</div>' +
        '<button class="dx-cmp' + (S.compare.indexOf(r.id) >= 0 ? " on" : "") + '" data-cmp="' + r.id + '" title="Add to compare">⚖</button>' +
        '<div class="dx-score">' + r.score + '<small>/100</small></div>' +
      '</div>';
    if (!open) return '<div class="dx-card ' + cls + '">' + head + '</div>';
    function fl(keys, c, sign) { return keys.map(function (k) { return '<span class="dx-f ' + c + '">' + (sign || "") + esc(lbl(k)) + '</span>'; }).join("") || '<span class="dx-none">—</span>'; }
    var tools = toolsFor(r.id);
    var pv = S.prev[r.id];
    var confLine = "";
    if (pv != null && pv !== r.score) {
      var eff = "";
      if (S.lastAddedKey && r.supporting && r.supporting.indexOf(S.lastAddedKey) >= 0) eff = ' · <span class="up">' + esc(S.lastAdded) + ' supports this</span>';
      else if (S.lastAddedKey && r.contra && r.contra.indexOf(S.lastAddedKey) >= 0) eff = ' · <span class="down">' + esc(S.lastAdded) + ' argues against this</span>';
      else if (S.lastAdded) eff = ' · after adding ' + esc(S.lastAdded);
      confLine = '<div class="dx-conf">Confidence ' + pv + ' → ' + r.score + eff + '</div>';
    }
    var whyNot = (rank > 1 && ((r.contra && r.contra.length) || (r.missing && r.missing.length)))
      ? '<div class="dx-d-row"><b>Why not higher</b><div class="dx-reason">' +
        ((r.contra && r.contra.length) ? "Contradicted by " + r.contra.map(lbl).join(", ") + ". " : "") +
        ((r.missing && r.missing.length) ? "Would rank higher with " + r.missing.slice(0, 3).map(lbl).join(", ") + "." : "") + '</div></div>' : "";
    var det = '<div class="dx-detail">' + confLine +
      '<div class="dx-d-row"><b>Supporting findings</b><div>' + fl(r.supporting, "sup", "✓ ") + '</div></div>' +
      (r.contra && r.contra.length ? '<div class="dx-d-row"><b>Contradictory findings</b><div>' + fl(r.contra, "con", "✕ ") + '</div></div>' : '') +
      '<div class="dx-d-row"><b>Missing / would help</b><div>' + fl(r.missing, "mis", "? ") + '</div></div>' +
      (r.reason ? '<div class="dx-d-row"><b>Why this — likely because</b><div class="dx-reason">' + esc(r.reason) + '</div></div>' : '') +
      whyNot +
      (r.red && r.red.length ? '<div class="dx-d-row red"><b>Red flags</b><ul>' + r.red.map(function (x){return '<li>'+esc(x)+'</li>';}).join("") + '</ul></div>' : '') +
      (r.inv && r.inv.length ? '<div class="dx-d-row"><b>Suggested investigations</b><ul>' + r.inv.slice(0,5).map(function (x){return '<li>'+esc(x)+'</li>';}).join("") + '</ul></div>' : '') +
      (tools.length ? '<div class="dx-d-row"><b>Related bedside tools</b><div class="dx-tools">' + tools.map(function (t){return '<button class="dx-tool" data-tool="'+t+'">'+esc(TOOLREG[t].icon+" "+TOOLREG[t].label)+'</button>';}).join("") + '</div></div>' : '') +
      harrisonRef(r.id) +
      '<button class="dx-select ' + cls + '" data-sel="' + r.id + '">Select this diagnosis →</button>' +
      '</div>';
    return '<div class="dx-card ' + cls + ' open">' + head + det + '</div>';
  }

  function renderChanged(d) {
    var el = root.querySelector("#dxChanged");
    if (!Object.keys(S.prev).length) { el.style.display = "none"; return; }
    var all = d.inf.concat(d.ni), msgs = [];
    all.slice(0, 12).forEach(function (r) {
      var p = S.prev[r.id];
      if (p == null) msgs.push("▲ " + r.name + " entered the differential");
      else if (r.score - p >= 6) msgs.push("▲ " + r.name + " rose (" + p + "→" + r.score + ")");
      else if (p - r.score >= 6) msgs.push("▼ " + r.name + " fell (" + p + "→" + r.score + ")");
    });
    if (msgs.length) { el.style.display = ""; el.innerHTML = '<b>What changed</b> ' + (S.lastAdded ? 'adding <b>' + esc(S.lastAdded) + '</b> — ' : "") + msgs.slice(0, 3).map(esc).join("  ·  "); }
    else el.style.display = "none";
  }

  var CAP = 10;
  function colHTML(title, cls, rows, emptyMsg) {
    var shown = rows.slice(0, CAP);
    var more = rows.length - shown.length;
    var body = rows.length ? shown.map(function (r, i) { return card(r, i + 1); }).join("") : '<div class="dx-empty">' + esc(emptyMsg) + '</div>';
    if (more > 0) body += '<div class="dx-more">+ ' + more + ' lower-ranked ' + (cls === "inf" ? "infectious" : "non-infectious") + ' possibilities</div>';
    return '<div class="dx-col ' + cls + '"><div class="dx-col-h">' + title + ' <span class="dx-col-n">' + rows.length + '</span></div>' + body + '</div>';
  }

  function renderHosp() {
    var el = root.querySelector("#dxHosp");
    if (!el || !window.HOSPITAL) { if (el) el.innerHTML = ""; return; }
    var h = window.HOSPITAL.current();
    var opts = window.HOSPITAL.list.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === h.id ? " selected" : "") + '>' + esc(x.name) + (x.recommended ? " ⭐ Recommended" : (x.hasPolicy ? "" : " — national guidance")) + '</option>';
    }).join("");
    el.innerHTML = '<span class="dx-hosp-l">Hospital policy</span>' +
      (h.logo ? '<img class="dx-hosp-logo" src="' + h.logo + '" alt="' + esc(h.short) + ' logo">' : "") +
      '<select id="dxHospSel" class="dx-hosp-sel" aria-label="Select hospital policy">' + opts + '</select>';
    var sel = el.querySelector("#dxHospSel");
    sel.addEventListener("change", function () { window.HOSPITAL.setProfile(sel.value); requestAntibiogram(sel.value); });
  }

  // When a clinician selects a hospital StewardMD has no local antibiogram /
  // policy for (or a "Custom hospital"), offer to email it so we can add it.
  // National ICMR guidance needs no upload.
  function requestAntibiogram(id) {
    try {
      var h = null; ((window.HOSPITAL && window.HOSPITAL.list) || []).forEach(function (x) { if (x.id === id) h = x; });
      if (!h || h.hasPolicy || h.id === "ICMR") return;
      var name = h.name || h.short || "my hospital";
      var go = window.confirm("StewardMD doesn't yet hold the local antimicrobial policy / antibiogram for " + name + ".\n\nWould you like to email it so we can add your hospital? This opens your mail app addressed to Support@StewardMD.in — attach your latest antibiogram PDF before sending.");
      if (!go) return;
      var subject = "StewardMD — Local antibiogram upload (" + name + ")";
      var body = "Hi StewardMD Support Team,\n\nI would like StewardMD to support my hospital's local antimicrobial policy / antibiogram.\n\nHospital: " + name + "\nCity / location: \nDepartment / unit: \n\nI have attached our latest local antibiogram / antibiotic policy PDF.\n(Please attach the PDF before sending.)\n\nThank you!";
      window.location.href = "mailto:Support@StewardMD.in?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    } catch (e) {}
  }

  function awareBadge(d) {
    var c = window.HOSPITAL ? window.HOSPITAL.awareClass(d) : "access";
    if (c === "reserve") return ' <span class="dx-aware res">Reserve · AMS approval</span>';
    if (c === "watch") return ' <span class="dx-aware wat">Watch</span>';
    return "";
  }
  function drugRows(arr) {
    return (arr || []).map(function (x) { return '<div class="dx-drug">' + esc(x) + awareBadge(x) + '</div>'; }).join("");
  }
  function orgHTML(syn) {
    if (!syn || !syn.pathogens) return "";
    var p = syn.pathogens, list = [].concat(p.veryLikely || [], p.likely || []).slice(0, 5);
    return list.length ? '<div class="dx-policy-line"><b>Likely organisms:</b> ' + esc(list.join(", ")) + '</div>' : "";
  }
  function deescHTML(syn) {
    if (!syn || !syn.deescalation) return "";
    return '<div class="dx-policy-note"><b>De-escalation:</b> ' + esc(syn.deescalation) + '</div>';
  }
  function renderPolicy(g) {
    var el = root.querySelector("#dxPolicy");
    if (!el) return;
    var info = GATEINFO[g.cls];
    if (!info.ab || !g.lead || !window.HOSPITAL) { el.innerHTML = ""; return; }
    var lead = g.lead, pol = window.HOSPITAL.getPolicy(lead.id), h = pol.hospital, e = pol.entry;
    var src = h.logo
      ? '<img class="dx-src-logo" src="' + h.logo + '" alt="GIMSR logo"> <b>✓ ' + esc(h.policyName) + '</b> <span>' + esc(h.version || "") + '</span>'
      : '<b>' + esc(h.policyName || h.name) + '</b>' + (h.version ? ' <span>' + esc(h.version) + '</span>' : "");
    var html;
    if (e) {
      html = '<div class="dx-policy">' +
        '<div class="dx-policy-src">' + src + '</div>' +
        '<div class="dx-policy-syn">Empiric therapy — ' + esc(lead.name) + '</div>' +
        '<div class="dx-policy-sec"><b>Preferred</b>' + drugRows(e.preferred) + '</div>' +
        (e.alternatives && e.alternatives.length ? '<div class="dx-policy-sec"><b>Alternatives</b>' + drugRows(e.alternatives) + '</div>' : "") +
        (e.duration ? '<div class="dx-policy-line"><b>Duration:</b> ' + esc(e.duration) + '</div>' : "") +
        (e.comments ? '<div class="dx-policy-note">' + esc(e.comments) + '</div>' : "") +
        orgHTML(lead._syn) + deescHTML(lead._syn) +
        '<div class="dx-policy-refs">Secondary references: ICMR AMRSN 2024 · IDSA · Surviving Sepsis Campaign</div>' +
        (e.table ? '<div class="dx-policy-cite">Source: GIMSR Antibiotic Policy ' + esc(e.table) + ', p.' + e.page + '</div>' : "") +
        '<button class="dx-select inf" data-sel="' + lead.id + '">Open full stewardship page →</button>' +
      '</div>';
    } else {
      html = '<div class="dx-policy nopol">' +
        '<div class="dx-policy-src">' + src + '</div>' +
        '<div class="dx-policy-note"><b>ICMR national guidance (AMRSN 2024)</b> is applied as the default standard for <b>' + esc(lead.name) + '</b>' + (h.id === "ICMR" ? "" : " — no " + esc(h.short || h.name) + "-specific local entry") + '. ' +
        (h.note ? esc(h.note) + " " : "") + 'StewardMD incorporates ICMR / IDSA evidence on the full disease page; institutional policies (e.g. GIMSR) are offered last as local options.</div>' +
        '<button class="dx-select inf" data-sel="' + lead.id + '">Open full stewardship page →</button>' +
      '</div>';
    }
    el.innerHTML = html;
    var b = el.querySelector(".dx-select");
    if (b) b.addEventListener("click", function () { selectDx(lead.id); });
  }

  function toggleCompare(id) {
    var i = S.compare.indexOf(id);
    if (i >= 0) S.compare.splice(i, 1);
    else { if (S.compare.length >= 3) S.compare.shift(); S.compare.push(id); }
    renderColsOnly();
  }
  function renderCompare(d) {
    var el = root.querySelector("#dxCompare"); if (!el) return;
    var all = d.inf.concat(d.ni), map = {}; all.forEach(function (r) { map[r.id] = r; });
    var cols = S.compare.map(function (id) { return map[id]; }).filter(Boolean);
    if (cols.length < 2) { el.innerHTML = ""; return; }
    function cell(r, field, sign, c) {
      var arr = r[field] || [];
      return arr.length ? arr.map(function (k) { return '<span class="dx-f ' + c + '">' + (sign || "") + esc(lbl(k)) + '</span>'; }).join("") : '<span class="dx-none">—</span>';
    }
    var html = '<div class="dx-cmp-h">⚖ Compare diagnoses <button class="dx-cmp-clear" id="dxCmpClear">clear</button></div>' +
      '<div class="dx-cmp-grid" style="grid-template-columns:repeat(' + cols.length + ',minmax(0,1fr))">';
    cols.forEach(function (r) {
      html += '<div class="dx-cmp-col">' +
        '<div class="dx-cmp-name ' + (r.inf ? "inf" : "ni") + '">' + esc(r.name) + '</div>' +
        '<div class="dx-cmp-score">' + r.score + '<small>/100</small></div>' +
        '<div class="dx-cmp-lbl">Supporting</div><div>' + cell(r, "supporting", "✓ ", "sup") + '</div>' +
        '<div class="dx-cmp-lbl">Contradictory</div><div>' + cell(r, "contra", "✕ ", "con") + '</div>' +
        '<div class="dx-cmp-lbl">Missing</div><div>' + cell(r, "missing", "? ", "mis") + '</div>' +
      '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
    var cl = el.querySelector("#dxCmpClear"); if (cl) cl.addEventListener("click", function () { S.compare = []; renderColsOnly(); });
  }

  function recompute() {
    if (!root) return;
    renderSelected(); renderPicker(); renderHosp(); renderAdv();
    var d = differential();
    renderSuggest(d);

    // --- Clinical Information Threshold ---------------------------------- *
    // Don't generate a differential after one nonspecific symptom. Require >=3
    // findings, OR a highly discriminative finding, OR a syndrome whose own
    // criteria are already met.
    var nFind = Object.keys(S.f).length;
    computeIDF();
    var discriminative = false;
    for (var fk in S.f) { if ((IDF[fk] || 0) >= 1.7) { discriminative = true; break; } }
    var ready = nFind >= 3 || discriminative || d.inf.some(function (x) { return x.matched; });
    var gateEl = root.querySelector("#dxGate"), polEl = root.querySelector("#dxPolicy"),
        chEl = root.querySelector("#dxChanged"), colEl = root.querySelector("#dxCols");
    var domEl = root.querySelector("#dxDom");
    if (!nFind) {
      gateEl.innerHTML = ""; polEl.innerHTML = ""; chEl.style.display = "none"; if (domEl) domEl.innerHTML = "";
      colEl.innerHTML = '<div class="dx-prompt">Select the general findings and the involved system above to begin reasoning.</div>';
      S.prev = {}; return;
    }
    if (!ready) {
      gateEl.innerHTML = ""; polEl.innerHTML = ""; chEl.style.display = "none"; if (domEl) domEl.innerHTML = "";
      colEl.innerHTML = '<div class="dx-threshold">🧩 Please add more clinical findings to improve diagnostic accuracy.' +
        '<span>Add at least 3 findings (or one highly specific finding) to generate a reliable differential — use the suggestions above.</span></div>';
      S.prev = {}; return;
    }
    if (domEl) {
      var domTags = Object.keys(S._dom || {});
      domEl.innerHTML = domTags.length ? '<div class="dx-dom">🧭 Dominant system: <b>' + domTags.map(function (t) { return esc(TAG_LABEL[t] || t); }).join(" · ") + '</b> — shaping the differential</div>' : "";
    }

    var g = gate(d), info = GATEINFO[g.cls];
    root.querySelector("#dxGate").innerHTML =
      '<div class="dx-gate-card ' + info.c + '"><div class="dx-gate-t">' + esc(info.t) + '</div>' +
      (gateMsg(g) ? '<div class="dx-gate-m">' + esc(gateMsg(g)) + '</div>' : '') +
      '</div>';
    renderPolicy(g);
    renderChanged(d);
    root.querySelector("#dxCols").innerHTML =
      colHTML('🔴 Infectious', 'inf', d.inf, S.started ? "No infectious cause suggested by the current findings." : "Add findings to see infectious differentials.") +
      colHTML('🟢 Non-infectious', 'ni', d.ni, S.started ? "No non-infectious cause suggested yet." : "Add findings to see non-infectious differentials.");
    // wire expand + select
    root.querySelectorAll(".dx-row-head").forEach(function (h) {
      h.addEventListener("click", function () { var id = h.getAttribute("data-id"); S.expanded[id] = !S.expanded[id]; renderColsOnly(); });
    });
    root.querySelectorAll(".dx-select").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); selectDx(b.getAttribute("data-sel")); });
    });
    root.querySelectorAll(".dx-tool").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); runTool(b.getAttribute("data-tool")); });
    });
    root.querySelectorAll(".dx-cmp").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); toggleCompare(b.getAttribute("data-cmp")); });
    });
    renderCompare(d);
    // NB: S.prev is the PRE-change snapshot taken in addFinding — do not
    // overwrite it here, or confidence deltas would vanish on the next render.
  }
  // re-render only the columns (used on expand so we don't reset prev/delta)
  function renderColsOnly() {
    var d = differential();
    root.querySelector("#dxCols").innerHTML =
      colHTML('🔴 Infectious', 'inf', d.inf, "No infectious cause suggested by the current findings.") +
      colHTML('🟢 Non-infectious', 'ni', d.ni, "No non-infectious cause suggested yet.");
    root.querySelectorAll(".dx-row-head").forEach(function (h) {
      h.addEventListener("click", function () { var id = h.getAttribute("data-id"); S.expanded[id] = !S.expanded[id]; renderColsOnly(); });
    });
    root.querySelectorAll(".dx-select").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); selectDx(b.getAttribute("data-sel")); });
    });
    root.querySelectorAll(".dx-tool").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); runTool(b.getAttribute("data-tool")); });
    });
    root.querySelectorAll(".dx-cmp").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); toggleCompare(b.getAttribute("data-cmp")); });
    });
    renderCompare(d);
  }

  function selectDx(id) {
    // infectious -> open the full StewardMD disease page with current findings
    var syn = window.SYNDROMES || {};
    if (syn[id]) {
      try {
        var vitals = {};
        if (typeof window.SMD_restoreCase === "function") {
          close();
          window.SMD_restoreCase(S.f, id, vitals);
          // bring the freshly-rendered stewardship page into view — without this the
          // overlay closes but the output stays off-screen (the "click does nothing"
          // bug). Mirrors the My-Cases restore path, which scrolls #outputArea.
          try {
            setTimeout(function () {
              var oa = document.getElementById("outputArea");
              if (oa && oa.innerHTML.trim()) oa.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 150);
          } catch (e) {}
          return;
        }
      } catch (e) {}
      alert("Opening the disease page — stewardship module is loading.");
      return;
    }
    // non-infectious -> open the management / treatment panel for this diagnosis
    var d = differential(), all = d.inf.concat(d.ni), r = null;
    for (var i = 0; i < all.length; i++) { if (all[i].id === id) { r = all[i]; break; } }
    if (r) { openMgmt(r); return; }
    // fallback: expand the card
    S.expanded[id] = true; renderColsOnly();
    var c = root.querySelector('.dx-card.open .dx-detail');
    if (c) c.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Management / treatment panel for a NON-INFECTIVE working diagnosis.
  function openMgmt(r) {
    var m = (window.DX_MGMT && window.DX_MGMT[r.id]) || null;
    var el = root.querySelector("#dxMgmt");
    if (!el) { el = document.createElement("div"); el.id = "dxMgmt"; el.className = "dx-mgmt"; root.appendChild(el); }
    var tx = (m && m.tx && m.tx.length) ? m.tx : null;
    var ix = (m && m.ix && m.ix.length) ? m.ix : (r.inv || []);
    var html = '<div class="dx-mgmt-top"><button class="dx-back" id="dxMgmtBack" type="button">‹ Back to differential</button></div>' +
      '<div class="dx-mgmt-body">' +
        '<div class="dx-mgmt-badge">Working diagnosis · non-infective</div>' +
        '<h2 class="dx-mgmt-name">' + esc(r.name) + '</h2>' +
        (r.system ? '<div class="dx-mgmt-sys">' + esc(r.system) + '</div>' : '') +
        (m && m.dx ? '<div class="dx-mgmt-sec">How to confirm</div><p>' + esc(m.dx) + '</p>'
                   : (r.reason ? '<div class="dx-mgmt-sec">Why this</div><p>' + esc(r.reason) + '</p>' : '')) +
        (tx ? '<div class="dx-mgmt-sec tx">💊 Management / Treatment</div><ol class="dx-mgmt-tx">' + tx.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ol>'
            : '<div class="dx-mgmt-sec">Management</div><p>Specialist-guided management — see the investigations and red flags below and consult full guidelines.</p>') +
        (ix && ix.length ? '<div class="dx-mgmt-sec">Key investigations</div><ul class="dx-mgmt-ul">' + ix.slice(0, 8).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' : '') +
        (m && m.dispo ? '<div class="dx-mgmt-sec">Disposition</div><p>' + esc(m.dispo) + '</p>' : '') +
        (r.red && r.red.length ? '<div class="dx-mgmt-sec red">Red flags</div><ul class="dx-mgmt-ul">' + r.red.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' : '') +
        (m && m.src ? '<div class="dx-mgmt-src">Source: ' + esc(m.src) + '</div>' : '') +
        '<div class="dx-mgmt-disc">⚠️ Decision-support only — provisional and aligned to standard guidelines / Harrison\'s 22e. Verify against full guidelines, local protocol and current prescribing references (doses, contraindications, renal/hepatic adjustment, pregnancy) before acting.</div>' +
      '</div>';
    el.innerHTML = html;
    el.classList.add("on");
    el.scrollTop = 0;
    var bk = el.querySelector("#dxMgmtBack");
    if (bk) bk.addEventListener("click", function () { el.classList.remove("on"); });
  }
  function closeMgmt() { var el = root && root.querySelector("#dxMgmt"); if (el) el.classList.remove("on"); }

  // Full searchable disease directory (all 140) — merges the enrichment manifest
  // (every disease) with the live SYNDROMES / DDX_NI so a name lookup always works.
  function diseaseDirectory() {
    var out = [], seen = {};
    var H = (window.KB_ENRICHMENT && window.KB_ENRICHMENT.byId) || null;
    if (H) for (var id in H) { out.push({ id: id, name: H[id].name || id, system: H[id].system || "", inf: H[id].class === "infective" }); seen[id] = true; }
    var syn = window.SYNDROMES || {};
    for (var sid in syn) if (!seen[sid]) { out.push({ id: sid, name: syn[sid].name || sid, system: syn[sid].system || "", inf: true }); seen[sid] = true; }
    (DDX_NI || []).forEach(function (d) { if (!seen[d.id]) { out.push({ id: d.id, name: d.name || d.id, system: d.system || "", inf: false }); seen[d.id] = true; } });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  // Self-contained reference panel for ANY disease (whether or not it is in the
  // current differential) — reuses the #dxMgmt panel. Shows the Harrison reference
  // and an action to open the full stewardship/management page.
  function openDiseaseRef(id) {
    var syn = (window.SYNDROMES || {})[id];
    var ni = null; (DDX_NI || []).forEach(function (d) { if (d.id === id) ni = d; });
    var H = (window.KB_ENRICHMENT && window.KB_ENRICHMENT.byId && window.KB_ENRICHMENT.byId[id]) || null;
    var name = (syn && syn.name) || (ni && ni.name) || (H && H.name) || id;
    var system = (syn && syn.system) || (ni && ni.system) || (H && H.system) || "";
    var inf = !!syn || !!(H && H.class === "infective");
    var reason = (ni && ni.reason) || "";
    var el = root.querySelector("#dxMgmt");
    if (!el) { el = document.createElement("div"); el.id = "dxMgmt"; el.className = "dx-mgmt"; root.appendChild(el); }
    el.innerHTML = '<div class="dx-mgmt-top"><button class="dx-back" id="dxMgmtBack" type="button">‹ Back</button></div>' +
      '<div class="dx-mgmt-body">' +
        '<div class="dx-mgmt-badge">Disease reference · ' + (inf ? "infective" : "non-infective") + '</div>' +
        '<h2 class="dx-mgmt-name">' + esc(name) + '</h2>' +
        (system ? '<div class="dx-mgmt-sys">' + esc(system) + '</div>' : '') +
        (reason ? '<div class="dx-mgmt-sec">Why this</div><p>' + esc(reason) + '</p>' : '') +
        (harrisonRef(id, { expanded: true }) || '<p class="dx-sel-empty">No Harrison reference loaded for this disease.</p>') +
        '<button class="dx-select ' + (inf ? "inf" : "ni") + '" data-sel="' + id + '">Open full ' + (inf ? "stewardship" : "management") + ' page →</button>' +
        '<div class="dx-mgmt-disc">⚠️ Decision-support only — reference knowledge paraphrased from Harrison\'s 22e and standard guidelines. Verify against full guidelines and prescribing references before acting.</div>' +
      '</div>';
    el.classList.add("on"); el.scrollTop = 0;
    var bk = el.querySelector("#dxMgmtBack"); if (bk) bk.addEventListener("click", function () { el.classList.remove("on"); });
    var sel = el.querySelector(".dx-select[data-sel]");
    if (sel) sel.addEventListener("click", function () {
      el.classList.remove("on");
      if (inf) selectDx(id);
      else openMgmt({ id: id, name: name, system: system, inf: false, reason: reason, red: (H && H.redFlags) || [], inv: (H && H.additionalInvestigations) || [] });
    });
  }

  function resetAll() { S.f = {}; S.prev = {}; S.expanded = {}; S.started = false; S.system = null; S.showRare = false; S.compare = []; S.timeline = []; filter = ""; closeMgmt(); var si = root && root.querySelector("#dxSearch"); if (si) si.value = ""; recompute(); }
  function open(opts) {
    ensureRoot();
    if (opts && opts.workspace) { S.workspace = true; S.advOpen = true; }
    // Bridge: carry over findings already entered in the legacy checkbox wizard
    if (!Object.keys(S.f).length && typeof window.SMD_getFindings === "function") {
      try { var lf = window.SMD_getFindings(), n = 0; for (var k in lf) { if (lf[k] && VALID[k]) { S.f[k] = true; n++; } } if (n) { S.started = true; S.lastAdded = null; } } catch (e) {}
    }
    root.classList.add("on"); document.body.classList.add("dx-lock"); recompute();
    // focus the findings search so the clinician can start typing immediately
    try { var sif = root.querySelector("#dxSearch"); if (sif) setTimeout(function () { try { sif.focus(); } catch (e) {} }, 60); } catch (e) {}
  }
  function openWorkspace() { open({ workspace: true }); }
  function close() {
    // sync findings back to the legacy wizard (one source of truth)
    try { if (typeof window.SMD_setFindings === "function") window.SMD_setFindings(S.f); } catch (e) {}
    closeMgmt();
    if (root) { root.classList.remove("on"); document.body.classList.remove("dx-lock"); }
  }

  /* ---------------------------------------------------------------------- *
   * STYLES + launch
   * ---------------------------------------------------------------------- */
  function injectCSS() {
    var css = [
      ".dx-overlay{position:fixed;inset:0;z-index:850;background:var(--paper);display:none;flex-direction:column;overflow:hidden;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}",
      ".dx-overlay.on{display:flex;animation:dxIn .25s ease}",
      "@keyframes dxIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
      "body.dx-lock{overflow:hidden}",
      ".dx-top{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel);border-bottom:1px solid var(--line);z-index:3}",
      ".dx-back,.dx-reset{background:transparent;border:1px solid var(--line);border-radius:9px;height:34px;padding:0 12px;font:600 13px var(--sans);color:var(--ink);cursor:pointer}",
      ".dx-back{color:var(--teal);border-color:var(--teal)}",
      ".dx-title{flex:1;text-align:center;font:800 16px var(--sans);color:var(--ink)}",
      ".dx-beta{font-size:10px;background:var(--teal-soft);color:var(--teal);border-radius:6px;padding:1px 6px;vertical-align:middle;font-weight:700}",
      ".dx-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;max-width:1100px;margin:0 auto;width:100%;padding-bottom:calc(48px + env(safe-area-inset-bottom))}",
      ".dx-discl{font:500 11.5px var(--sans);color:var(--slate-soft);background:var(--teal-soft);border-radius:10px;padding:9px 12px;margin-bottom:12px;line-height:1.5}",
      ".dx-find-wrap{margin-bottom:6px}",
      ".dx-search{width:100%;box-sizing:border-box;border:1.5px solid var(--line);border-radius:11px;padding:11px 14px;font:500 14px var(--sans);background:var(--panel);color:var(--ink);margin-bottom:9px}",
      ".dx-search:focus{outline:none;border-color:var(--teal)}",
      ".dx-selected{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:9px;min-height:4px}",
      ".dx-sel-empty{font:500 12px var(--sans);color:var(--slate-soft)}",
      ".dx-sel-chip{background:var(--teal);border:none;color:#fff;border-radius:16px;padding:6px 11px;font:600 12px var(--sans);cursor:pointer}",
      ".dx-picker{border:1px solid var(--line);border-radius:11px;padding:10px 12px;background:var(--panel)}",
      ".dx-suggest{margin-bottom:9px}",
      ".dx-sugg-h{font:700 11px var(--sans);color:var(--teal);margin-bottom:6px}",
      ".dx-chip.sug{border-color:var(--teal);color:var(--teal);background:var(--teal-soft)}",
      ".dx-step{margin:2px 0 12px}",
      ".dx-step-h{font:700 11.5px var(--sans);color:var(--ink);margin-bottom:8px;display:flex;align-items:center;gap:7px}",
      ".dx-step-n{width:18px;height:18px;border-radius:50%;background:var(--teal);color:#fff;font:800 11px var(--sans);display:inline-flex;align-items:center;justify-content:center}",
      ".dx-sysrow{display:flex;flex-wrap:wrap;gap:7px}",
      ".dx-sys{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font:600 12.5px var(--sans);color:var(--slate);cursor:pointer;transition:all .12s}",
      ".dx-sys.on{background:var(--teal);border-color:var(--teal);color:#fff}",
      ".dx-more-btn{margin-top:8px;background:transparent;border:1px dashed var(--line);border-radius:9px;padding:7px 12px;font:600 12px var(--sans);color:var(--teal);cursor:pointer}",
      ".dx-prompt{font:500 13px var(--sans);color:var(--slate-soft);padding:18px;text-align:center;border:1px dashed var(--line);border-radius:11px}",
      ".dx-threshold{font:700 13.5px var(--sans);color:var(--ink);padding:18px;text-align:center;border:1.5px dashed var(--teal);border-radius:12px;background:var(--teal-soft);line-height:1.5}",
      ".dx-threshold span{display:block;font:500 12px var(--sans);color:var(--slate-soft);margin-top:6px}",
      ".dx-cat{margin:4px 0 11px}",
      ".dx-cat-h{font:700 10.5px var(--sans);letter-spacing:.04em;text-transform:uppercase;color:var(--slate-soft);margin-bottom:6px}",
      ".dx-chips{display:flex;flex-wrap:wrap;gap:6px}",
      ".dx-sr-count{display:inline-block;background:var(--teal-soft);color:var(--teal);font:700 11px var(--sans);padding:1px 8px;border-radius:999px;margin-left:6px}",
      ".dx-search-list{display:flex;flex-direction:column;max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px;background:var(--panel);margin-top:4px}",
      ".dx-search-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--line);padding:13px 14px;cursor:pointer;font:600 14.5px var(--sans);color:var(--ink)}",
      ".dx-search-row:last-child{border-bottom:none}",
      ".dx-search-row:active{background:var(--teal-soft)}",
      ".dx-sr-plus{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--teal-soft);color:var(--teal);font-weight:800;font-size:15px;flex:0 0 auto}",
      ".dx-sr-lbl{flex:1}",
      ".dx-mgmt{position:fixed;inset:0;z-index:860;background:var(--paper);display:none;flex-direction:column;overflow:hidden;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}",
      ".dx-mgmt.on{display:flex;animation:dxIn .22s ease}",
      ".dx-mgmt-top{padding:13px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex:0 0 auto}",
      ".dx-mgmt-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:18px 16px 48px;max-width:760px;margin:0 auto;width:100%}",
      ".dx-mgmt-badge{display:inline-block;background:var(--teal-soft);color:var(--teal);font:700 11px var(--sans);padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}",
      ".dx-mgmt-name{font:800 22px var(--sans);color:var(--ink);margin:10px 0 2px;line-height:1.15}",
      ".dx-mgmt-sys{font:600 13px var(--sans);color:var(--slate-soft);margin-bottom:4px}",
      ".dx-mgmt-sec{font:800 12px var(--sans);text-transform:uppercase;letter-spacing:.05em;color:var(--slate);margin:18px 0 7px}",
      ".dx-mgmt-sec.tx{color:var(--teal)}",
      ".dx-mgmt-sec.red{color:#b5460f}",
      ".dx-mgmt-body p{font:500 14px/1.6 var(--sans);color:var(--ink);margin:0}",
      ".dx-mgmt-tx{margin:0;padding-left:20px}",
      ".dx-mgmt-tx li{font:500 14px/1.55 var(--sans);color:var(--ink);margin:8px 0;padding-left:3px}",
      ".dx-mgmt-tx li::marker{color:var(--teal);font-weight:800}",
      ".dx-mgmt-ul{margin:0;padding-left:18px}",
      ".dx-mgmt-ul li{font:500 13.5px/1.5 var(--sans);color:var(--slate);margin:4px 0}",
      ".dx-mgmt-src{margin-top:18px;font:600 11.5px var(--sans);color:var(--slate-soft)}",
      ".dx-mgmt-disc{margin-top:14px;padding:11px 13px;background:var(--panel);border:1px solid var(--line);border-radius:10px;font:500 11.5px/1.5 var(--sans);color:var(--slate-soft)}",
      ".dx-chip{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:6px 11px;font:600 12px var(--sans);color:var(--slate);cursor:pointer;transition:all .12s}",
      ".dx-chip:hover{border-color:var(--teal);color:var(--teal)}",
      ".dx-gate{margin:14px 0 8px}",
      ".dx-gate-card{border-radius:13px;padding:13px 15px;border:1px solid var(--line)}",
      ".dx-gate-t{font:800 15px var(--sans)}",
      ".dx-gate-m{font:500 12.5px var(--sans);margin-top:4px;line-height:1.5;opacity:.92}",
      ".dx-gate-hint{font:600 12px var(--sans);margin-top:8px;color:var(--ink);background:var(--panel);border-radius:8px;padding:8px 10px}",
      ".g-red{background:var(--red-bg);border-color:var(--red-line)}.g-red .dx-gate-t{color:var(--red)}",
      ".g-orange{background:var(--orange-bg);border-color:var(--orange-line)}.g-orange .dx-gate-t{color:var(--orange)}",
      ".g-amber{background:var(--yellow-bg);border-color:var(--yellow-line)}.g-amber .dx-gate-t{color:var(--yellow)}",
      ".g-teal{background:var(--teal-soft);border-color:var(--teal)}.g-teal .dx-gate-t{color:var(--teal)}",
      ".g-green2{background:var(--green-bg);border-color:var(--green-line)}.g-green2 .dx-gate-t{color:var(--green)}",
      ".g-slate{background:var(--panel)}.g-slate .dx-gate-t{color:var(--slate)}",
      ".dx-changed{font:600 12px var(--sans);color:var(--slate);background:var(--panel);border:1px dashed var(--line);border-radius:9px;padding:8px 11px;margin:0 0 12px}",
      ".dx-cols{display:grid;grid-template-columns:1fr;gap:14px}",
      "@media(min-width:760px){.dx-cols{grid-template-columns:1fr 1fr}}",
      ".dx-col-h{font:800 14px var(--sans);color:var(--ink);margin:2px 0 10px}",
      ".dx-col-n{font-size:11px;background:var(--line);color:var(--slate);border-radius:8px;padding:1px 7px;vertical-align:middle}",
      ".dx-col{display:flex;flex-direction:column;gap:9px}",
      ".dx-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden;transition:border-color .15s}",
      ".dx-card.inf{border-left:3px solid var(--red)}",
      ".dx-card.ni{border-left:3px solid var(--green)}",
      ".dx-card.open{border-color:var(--teal)}",
      ".dx-row-head{display:flex;align-items:center;gap:11px;padding:11px 13px;cursor:pointer}",
      ".dx-rank{width:22px;height:22px;flex:0 0 auto;border-radius:50%;font:800 12px var(--sans);display:flex;align-items:center;justify-content:center}",
      ".dx-rank.inf{background:var(--red-bg);color:var(--red)}.dx-rank.ni{background:var(--green-bg);color:var(--green)}",
      ".dx-row-main{flex:1;min-width:0}",
      ".dx-row-name{font:700 13.5px var(--sans);color:var(--ink)}",
      ".dx-met{font-size:9.5px;font-weight:700;background:var(--red-bg);color:var(--red);border-radius:5px;padding:1px 5px;vertical-align:middle}",
      ".dx-mimic{font-size:9.5px;font-weight:700;background:var(--red-bg);color:var(--red);border-radius:5px;padding:1px 6px;vertical-align:middle}",
      ".dx-up{color:var(--red);font-size:11px}.dx-down{color:var(--teal);font-size:11px}.dx-new{font-size:9px;font-weight:800;background:var(--teal);color:#fff;border-radius:4px;padding:1px 4px}",
      ".dx-bar{height:6px;border-radius:4px;background:var(--line);margin:6px 0 4px;overflow:hidden}",
      ".dx-bar span{display:block;height:100%;border-radius:4px;transition:width .35s cubic-bezier(.4,0,.2,1)}",
      ".dx-bar.inf span{background:linear-gradient(90deg,#d9485f,var(--red))}",
      ".dx-bar.ni span{background:linear-gradient(90deg,#3fae6b,var(--green))}",
      ".dx-row-sys{font:500 11px var(--sans);color:var(--slate-soft)}",
      ".dx-score{font:800 18px var(--sans);color:var(--ink);flex:0 0 auto}.dx-score small{font-size:10px;color:var(--slate-soft);font-weight:600}",
      ".dx-detail{padding:2px 13px 13px;border-top:1px solid var(--line);animation:dxIn .2s ease}",
      ".dx-d-row{margin-top:11px;font:500 12.5px var(--sans);color:var(--slate)}",
      ".dx-d-row b{display:block;font:700 10.5px var(--sans);text-transform:uppercase;letter-spacing:.03em;color:var(--slate-soft);margin-bottom:5px}",
      ".dx-d-row ul{margin:0;padding-left:18px}.dx-d-row li{margin:2px 0}",
      ".dx-d-row.red b{color:var(--red)}",
      ".dx-reason{line-height:1.55;color:var(--ink)}",
      ".dx-f{display:inline-block;border-radius:6px;padding:3px 8px;margin:0 5px 5px 0;font-size:12px;font-weight:600}",
      ".dx-f.sup{background:var(--green-bg);color:var(--green)}",
      ".dx-f.con{background:var(--red-bg);color:var(--red)}",
      ".dx-f.mis{background:var(--paper);border:1px dashed var(--line);color:var(--slate-soft)}",
      ".dx-tools{display:flex;flex-direction:column;gap:6px}",
      ".dx-tool{text-align:left;background:var(--teal-soft);border:1px solid var(--teal);color:var(--teal);border-radius:9px;padding:9px 11px;font:700 12.5px var(--sans);cursor:pointer}",
      ".dx-tool:hover{background:var(--teal);color:#fff}",
      ".dx-none{color:var(--slate-soft);font-size:12px}",
      ".dx-select{margin-top:13px;width:100%;border:none;border-radius:10px;padding:11px;font:800 13px var(--sans);cursor:pointer;color:#fff}",
      ".dx-select.inf{background:var(--red)}.dx-select.ni{background:var(--green)}",
      ".dx-empty{font:500 13px var(--sans);color:var(--slate-soft);padding:14px;text-align:center;border:1px dashed var(--line);border-radius:10px}",
      ".dx-hosp{display:flex;align-items:center;gap:9px;margin:0 0 12px;flex-wrap:wrap}",
      ".dx-hosp-l{font:700 10.5px var(--sans);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft)}",
      ".dx-hosp-logo{height:24px;border-radius:5px}",
      ".dx-hosp-sel{border:1px solid var(--line);border-radius:9px;padding:7px 10px;font:600 12.5px var(--sans);background:var(--panel);color:var(--ink);cursor:pointer}",
      ".dx-policy-wrap{margin:0 0 12px}",
      ".dx-policy{border:1px solid var(--teal);border-radius:13px;background:var(--panel);padding:13px 15px}",
      ".dx-policy.nopol{border-color:var(--line)}",
      ".dx-policy-src{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font:700 12.5px var(--sans);color:var(--teal);border-bottom:1px solid var(--line);padding-bottom:9px;margin-bottom:10px}",
      ".dx-src-logo{height:30px;border-radius:5px}",
      ".dx-policy-src span{font-weight:500;color:var(--slate-soft);font-size:11px}",
      ".dx-policy-syn{font:800 14px var(--sans);color:var(--ink);margin-bottom:6px}",
      ".dx-policy-sec{margin:8px 0}",
      ".dx-policy-sec>b{display:block;font:700 10.5px var(--sans);text-transform:uppercase;letter-spacing:.03em;color:var(--slate-soft);margin-bottom:4px}",
      ".dx-drug{font:600 13px var(--sans);color:var(--ink);padding:5px 0;border-bottom:1px dashed var(--line)}",
      ".dx-aware{font-size:9.5px;font-weight:800;border-radius:5px;padding:1px 6px;vertical-align:middle}",
      ".dx-aware.wat{background:var(--yellow-bg);color:var(--yellow)}",
      ".dx-aware.res{background:var(--red-bg);color:var(--red)}",
      ".dx-policy-line{font:600 12.5px var(--sans);color:var(--ink);margin:9px 0}",
      ".dx-policy-note{font:500 12px var(--sans);color:var(--slate);line-height:1.55;background:var(--paper);border-radius:8px;padding:9px 11px;margin:8px 0}",
      ".dx-policy-refs{font:700 11px var(--sans);color:var(--slate-soft);margin-top:9px}",
      ".dx-policy-cite{font:500 10.5px var(--sans);color:var(--slate-soft);margin-top:4px;font-style:italic}",
      ".dx-more{font:600 11.5px var(--sans);color:var(--slate-soft);text-align:center;padding:8px;border:1px dashed var(--line);border-radius:9px}",
      ".dx-launch{flex:0 0 auto;height:38px;border-radius:10px;border:1px solid var(--teal);background:var(--teal);color:#fff;font:700 12.5px var(--sans);padding:0 13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}",
      ".dx-adv-toggle{width:100%;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font:700 12.5px var(--sans);color:var(--ink);cursor:pointer;margin-bottom:10px}",
      ".dx-adv{border:1px solid var(--teal);border-radius:12px;background:var(--panel);padding:12px;margin-bottom:12px}",
      ".dx-free{width:100%;box-sizing:border-box;border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;font:500 13px var(--sans);background:var(--paper);color:var(--ink);resize:vertical}",
      ".dx-adv-row{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}",
      ".dx-adv-btn{background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:8px 12px;font:700 12px var(--sans);color:var(--ink);cursor:pointer}",
      ".dx-adv-btn.primary{background:var(--teal);border-color:var(--teal);color:#fff}",
      ".dx-sess-h,.dx-tl-h{font:700 10.5px var(--sans);text-transform:uppercase;letter-spacing:.03em;color:var(--slate-soft);margin:12px 0 6px}",
      ".dx-sess{display:flex;flex-direction:column;gap:6px}",
      ".dx-sess-item{text-align:left;background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:8px 11px;font:600 12.5px var(--sans);color:var(--ink);cursor:pointer}",
      ".dx-sess-item span{display:block;font:500 10.5px var(--sans);color:var(--slate-soft);margin-top:2px}",
      ".dx-tl{display:flex;flex-direction:column;gap:5px}",
      ".dx-tl-item{font:500 12px var(--sans);color:var(--slate);border-left:2px solid var(--teal);padding:4px 0 4px 10px;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}",
      ".dx-tl-item b{color:var(--ink)}",
      ".dx-tl-n{width:16px;height:16px;flex:0 0 auto;border-radius:50%;background:var(--teal);color:#fff;font:800 9.5px var(--sans);display:inline-flex;align-items:center;justify-content:center}",
      ".dx-tl-item .up{color:var(--red)}.dx-tl-item .down{color:var(--teal)}",
      ".dx-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(12px);background:var(--ink);color:var(--paper);padding:11px 18px;border-radius:10px;font:700 13px var(--sans);z-index:900;opacity:0;transition:all .3s;box-shadow:0 6px 24px rgba(0,0,0,.3);pointer-events:none}",
      ".dx-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}",
      ".dx-cmp{background:transparent;border:1px solid var(--line);border-radius:7px;width:28px;height:28px;font-size:13px;cursor:pointer;color:var(--slate-soft);flex:0 0 auto;margin-right:6px}",
      ".dx-cmp.on{background:var(--teal);border-color:var(--teal);color:#fff}",
      ".dx-compare:not(:empty){margin-bottom:14px}",
      ".dx-cmp-h{font:800 13.5px var(--sans);color:var(--ink);margin-bottom:9px;display:flex;align-items:center;gap:12px}",
      ".dx-cmp-clear{font:600 11px var(--sans);background:transparent;border:1px solid var(--line);border-radius:7px;padding:3px 9px;cursor:pointer;color:var(--slate)}",
      ".dx-cmp-grid{display:grid;gap:10px}",
      ".dx-cmp-col{border:1px solid var(--line);border-radius:12px;padding:11px;background:var(--panel)}",
      ".dx-cmp-name{font:800 12.5px var(--sans);line-height:1.3}",
      ".dx-cmp-name.inf{color:var(--red)}.dx-cmp-name.ni{color:var(--green)}",
      ".dx-cmp-score{font:800 17px var(--sans);color:var(--ink);margin:3px 0 6px}.dx-cmp-score small{font-size:10px;color:var(--slate-soft)}",
      ".dx-cmp-lbl{font:700 9.5px var(--sans);text-transform:uppercase;letter-spacing:.03em;color:var(--slate-soft);margin:8px 0 3px}",
      ".dx-dom-wrap:not(:empty){margin-bottom:10px}",
      ".dx-dom{font:600 12px var(--sans);color:var(--ink);background:var(--teal-soft);border:1px solid var(--teal);border-radius:9px;padding:8px 12px}",
      ".dx-dom b{color:var(--teal)}",
      ".dx-conf{font:700 12px var(--sans);color:var(--ink);background:var(--paper);border-radius:8px;padding:7px 10px;margin:10px 0 2px}",
      ".dx-conf .up{color:var(--green);font-weight:700}.dx-conf .down{color:var(--red);font-weight:700}",
      ".dx-mimic{font-size:9.5px}",
      ".dx-harrison{margin:10px 0;border:1px solid var(--line,#e2e8f0);border-radius:10px;background:var(--paper,#f8fafc);overflow:hidden}",
      ".dx-harrison>summary{cursor:pointer;font:700 12px var(--sans);color:var(--ink,#0f172a);padding:9px 12px;list-style:none;user-select:none}",
      ".dx-harrison>summary::-webkit-details-marker{display:none}",
      ".dx-harrison>summary::before{content:'▸ ';color:var(--teal,#0d9488)}",
      ".dx-harrison[open]>summary::before{content:'▾ '}",
      ".dx-h-pg{font-weight:500;color:var(--muted,#64748b);font-size:10px}",
      ".dx-h-body{padding:2px 14px 12px;font-size:12px;color:var(--ink,#0f172a)}",
      ".dx-h-body p{margin:3px 0 8px;line-height:1.5}",
      ".dx-h-body ul{margin:3px 0 8px;padding-left:18px}.dx-h-body li{margin:2px 0;line-height:1.45}",
      ".dx-h-sub{font-weight:700;font-size:11px;margin:8px 0 2px;color:var(--teal,#0d9488)}",
      ".dx-h-sub.red{color:var(--red,#dc2626)}",
      ".dx-h-cite{font-size:9.5px;color:var(--muted,#64748b);margin-top:8px;font-style:italic}",
      ".dx-sr-sys{display:block;font-weight:500;font-size:11px;color:var(--muted,#64748b);margin-top:1px}",
      ".sb-beta{font-size:9px;font-weight:800;background:var(--teal);color:#fff;border-radius:5px;padding:1px 5px;margin-left:6px;vertical-align:middle;letter-spacing:.02em}",
      ".sb-main-link .chev{display:none}"
    ].join("");
    var st = document.createElement("style"); st.id = "dx-styles"; st.textContent = css; document.head.appendChild(st);
  }
  function injectLaunch() {
    var actions = document.querySelector(".app-head-actions");
    if (!actions || document.getElementById("dxLaunch")) return;
    var b = document.createElement("button");
    b.id = "dxLaunch"; b.className = "dx-launch"; b.type = "button";
    b.setAttribute("aria-label", "Open clinical reasoning");
    b.innerHTML = '🧠<span class="dxl-txt"> Reasoning</span>';
    b.addEventListener("click", open);
    actions.insertBefore(b, actions.firstChild);
  }
  function init() { injectCSS(); injectLaunch(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  /* ---------------------------------------------------------------------- *
   * Smart next-question engine (Phase 3 — additive + PURE, no eval).
   *
   * Consultant-style progressive questioning: given the current differential,
   * rank the highest-yield UNENTERED findings to ask about next, by how much
   * each would change the separation between the leading diagnosis and its
   * closest rival (discrimination) and how broadly it moves the head of the
   * differential (breadth). Each candidate is simulated by CLONING the finding
   * set and re-scoring through the SAME engine (differential), after which the
   * engine state is fully restored — so this never alters _differential output
   * (golden/parity stay byte-identical). On-demand only; not in the keystroke
   * hot path. Reuses the engine's own per-disease `missing` as the candidate
   * pool, so it inherits the same KB-driven vocabulary.
   * ---------------------------------------------------------------------- */
  function scoreMapFor(extraKey) {
    var savedF = S.f, savedFInf = S.fInf, savedDom = S._dom;
    var f2 = {}; for (var x in savedF) f2[x] = savedF[x]; if (extraKey) f2[extraKey] = true;
    S.f = f2;
    var d; try { d = differential(); } catch (e) { d = { inf: [], ni: [] }; }
    S.f = savedF; S.fInf = savedFInf; S._dom = savedDom;   // restore — purity guarantee
    var m = {};
    d.inf.forEach(function (r) { m[r.id] = { score: r.score, name: r.name, inf: true }; });
    d.ni.forEach(function (r) { m[r.id] = { score: r.score, name: r.name, inf: false }; });
    return { map: m, d: d };
  }
  function nextQuestions(limit) {
    buildOntology();
    limit = limit || 5;
    var base = scoreMapFor(null);
    var combined = base.d.inf.concat(base.d.ni).sort(function (a, b) { return b.score - a.score; });
    if (!combined.length) return [];
    var head = combined.slice(0, 6);
    var A = head[0], B = head[1] || null;        // leading dx and closest rival
    var cand = {};
    head.forEach(function (r) { (r.missing || []).forEach(function (k) { if (k && !S.f[k] && VALID[k]) cand[k] = true; }); });
    var keys = Object.keys(cand);
    if (!keys.length) keys = GENERAL.filter(function (k) { return !S.f[k]; });   // fallback: offer core vitals
    var out = [];
    keys.forEach(function (k) {
      var sim = scoreMapFor(k);
      var gapChange = 0;
      if (A && B) {
        var a0 = (base.map[A.id] || {}).score || 0, b0 = (base.map[B.id] || {}).score || 0;
        var a1 = (sim.map[A.id] || {}).score || 0, b1 = (sim.map[B.id] || {}).score || 0;
        gapChange = Math.abs((a1 - b1) - (a0 - b0));
      }
      var moved = [], maxDelta = 0;
      head.forEach(function (r) {
        var s0 = (base.map[r.id] || {}).score || 0, s1 = (sim.map[r.id] || {}).score || 0, dlt = s1 - s0;
        if (Math.abs(dlt) >= 4) moved.push({ name: r.name, delta: dlt });
        if (Math.abs(dlt) > Math.abs(maxDelta)) maxDelta = dlt;
      });
      var value = gapChange * 2 + moved.length + Math.abs(maxDelta) * 0.5;
      if (value > 0) out.push({ key: k, label: lbl(k), value: Math.round(value * 10) / 10,
        discriminates: !!(A && B && gapChange >= 3), raises: maxDelta > 0, moves: moved.slice(0, 4) });
    });
    out.sort(function (a, b) { return b.value - a.value; });
    return out.slice(0, limit);
  }

  /* ---------------------------------------------------------------------- *
   * KB-WIDE SEARCH + KNOWLEDGE LIBRARY (gold70)
   * The new 444-entry KB (window.KB_ENRICHMENT) was never wired into the two
   * app.js surfaces that only knew the 51 infective syndromes: the GLOBAL search
   * (#smdSearchInput → #spResults) and the Syndrome library modal (window.SB).
   * Wire both here — full-text over every Harrison detail, Infective/NI + system
   * filters — with NO minified app.js edits. Click routes via DX.openRef / ASP.
   * ---------------------------------------------------------------------- */
  var _kbIdx = null;
  function kbBranch(sys) {
    var s = (sys || "").toLowerCase();
    if (/cardio|cardiac|vascular|heart/.test(s)) return "Cardiology";
    if (/neuro|cns|nerv|stroke|brain|seizure/.test(s)) return "Neurology";
    if (/pulmon|respir|lung|airway/.test(s)) return "Respiratory";
    if (/nephro|renal|urinary|kidney|genitourin/.test(s)) return "Renal / GU";
    if (/gastro|hepat|liver|\bgi\b|biliary|pancrea|esoph|bowel|absorption/.test(s)) return "GI / Hepatology";
    if (/endocrin|metaboli|diabet|thyroid|pituitar|adrenal|bone/.test(s)) return "Endocrine / Metabolic";
    if (/hemat|haem|onco|cancer|leukem|lymphoma|myelo|coagul|transfus/.test(s)) return "Haem / Oncology";
    if (/rheum|autoimmun|arthriti|vasculiti|connective|joint|immunolog/.test(s)) return "Rheum / Immuno";
    if (/tox|poison|envenom|overdose|snakebite/.test(s)) return "Toxicology";
    if (/derm|skin/.test(s)) return "Dermatology";
    if (/infect|tropical|fever|viral|bacter|fungal|parasit|tubercul|hiv|sepsis|helminth|protozo|mycos|rickett/.test(s)) return "Infectious Disease";
    return "General / Other";
  }
  function kbBuildIndex() {
    if (_kbIdx && _kbIdx.length) return _kbIdx;   // never cache an empty index (KB script may still be loading)
    var H = (window.KB_ENRICHMENT && window.KB_ENRICHMENT.byId) || {};
    var arr = [];
    for (var id in H) {
      var d = H[id];
      var know = [].concat(d.clinicalPearls || [], d.pathophysiology || [], d.additionalDifferentials || [],
        d.redFlags || [], d.pitfalls || [], d.prognosis || []).join(" ");
      arr.push({ id: id, name: d.name || id, sys: d.system || "", branch: kbBranch(d.system),
        cls: d.class === "infective" ? "inf" : "ni", ref: !!d.referenceOnly,
        text: ((d.name || "") + " " + id.replace(/_/g, " ") + " " + (d.system || "") + " " + know).toLowerCase() });
    }
    arr.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    if (arr.length) _kbIdx = arr;                 // only memoise once the KB is actually present
    return arr;
  }
  function kbSearch(q, limit) {
    q = (q || "").toLowerCase().trim(); if (q.length < 2) return [];
    var out = kbBuildIndex().filter(function (d) { return d.text.indexOf(q) >= 0; });
    out.sort(function (a, b) {
      var an = a.name.toLowerCase().indexOf(q) >= 0 ? 0 : 1, bn = b.name.toLowerCase().indexOf(q) >= 0 ? 0 : 1;
      return an - bn || (a.name < b.name ? -1 : 1);
    });
    return out.slice(0, limit || 40);
  }
  function kbOpen(id) {
    try { var bd = document.getElementById("spBackdrop"); if (bd) bd.classList.add("hidden"); } catch (e) {}
    try { var p = document.getElementById("smdSearchPanel"); if (p) p.classList.remove("open"); } catch (e) {}
    try { if (window.SB && SB.closeRef) SB.closeRef(); } catch (e) {}
    try { document.body.style.overflow = ""; } catch (e) {}
    // ALWAYS open the Harrison evidence viewer (works for all 444, incl. the 51
    // infective syndromes). For infective diseases the viewer itself offers a button
    // to open the full antibiotic-stewardship console, so nothing is lost.
    if (window.DX && DX.openRef) DX.openRef(id);
  }
  // ---- global search: inject a KB section into #spResults after native render ----
  function wireGlobalSearch() {
    var inp = document.getElementById("smdSearchInput");
    if (!inp || inp.__smdKbWired) return;
    inp.__smdKbWired = true;
    inp.addEventListener("input", function () { var q = inp.value; setTimeout(function () { kbInjectSearch(q); }, 0); });
  }
  function kbInjectSearch(q) {
    var box = document.getElementById("spResults"); if (!box) return;
    var old = document.getElementById("smdKbSec"); if (old && old.parentNode) old.parentNode.removeChild(old);
    // Search the FULL Harrison knowledge base — ALL 444 diseases incl. the 51 infective
    // syndromes (malaria, sepsis, CAP…). No longer deduped against the native list, so
    // every disease's Harrison reference is reachable. Clicking opens the evidence viewer.
    var hits = kbSearch(q, 30);
    if (!hits.length) return;
    var emp = box.querySelector(".sp-empty"); if (emp) box.innerHTML = "";       // native found nothing
    var html = '<div id="smdKbSec"><div class="sp-section-label">📚 Harrison Knowledge Base</div>' +
      hits.map(function (d) {
        return '<div class="sp-card" data-kb="' + d.id + '"><div class="sp-card-top">' +
          '<span class="sp-card-icon">' + (d.cls === "inf" ? "🦠" : "🩺") + '</span><div>' +
          '<div class="sp-card-type">' + (d.cls === "inf" ? "Infective" : "Non-infective") + (d.ref ? " · reference" : " · diagnostic") + '</div>' +
          '<div class="sp-card-title">' + esc(d.name) + '</div></div></div>' +
          (d.sys ? '<div class="sp-card-desc">' + esc(d.sys) + '</div>' : '') + '</div>';
      }).join("") + '</div>';
    // Prepend so the Harrison KB shows FIRST, above the legacy syndrome/drug/calc results.
    box.insertAdjacentHTML("afterbegin", html);
    box.querySelectorAll("#smdKbSec [data-kb]").forEach(function (b) { b.addEventListener("click", function () { kbOpen(b.getAttribute("data-kb")); }); });
  }
  // ---- Knowledge Library: override window.SB.openRef for the syndromes tab ----
  var _libState = { q: "", cls: "all", src: "all", branch: "all" };
  function wireSyndromeLibrary() {
    if (!window.SB || typeof window.SB.openRef !== "function" || window.SB.__smdKbWrapped) return;
    var orig = window.SB.openRef;
    window.SB.__smdKbWrapped = true;
    window.SB.openRef = function (tab) {
      var r = orig.apply(this, arguments);
      if (tab === "syndromes") { try { kbRenderLibrary(); } catch (e) {} }
      return r;
    };
  }
  function kbRenderLibrary() {
    var body = document.getElementById("sbrefBody"); if (!body) return;
    var sec = body.querySelector(".sbref-sec"); if (!sec) return;
    try { var t = document.getElementById("sbrefTitle"); if (t) t.textContent = "Knowledge Library"; } catch (e) {}
    var branches = [], seen = {};
    kbBuildIndex().forEach(function (d) { if (!seen[d.branch]) { seen[d.branch] = 1; branches.push(d.branch); } });
    branches.sort();
    var f = function (on, attr, val, label) { return '<button class="kblib-f' + (on ? " on" : "") + '" data-' + attr + '="' + val + '">' + label + '</button>'; };
    sec.innerHTML =
      '<input id="kblibQ" class="kblib-search" placeholder="🔍  Search any disease or clinical detail…" autocomplete="off" value="' + esc(_libState.q) + '">' +
      '<div class="kblib-filters">' +
        '<div class="kblib-grp"><span class="kblib-lbl">Type</span>' +
          f(_libState.cls === "all", "cls", "all", "All") + f(_libState.cls === "inf", "cls", "inf", "🔴 Infective") + f(_libState.cls === "ni", "cls", "ni", "🟢 Non-infective") + '</div>' +
        '<div class="kblib-grp"><span class="kblib-lbl">Source</span>' +
          f(_libState.src === "all", "src", "all", "All") + f(_libState.src === "dx", "src", "dx", "Diagnostic") + f(_libState.src === "ref", "src", "ref", "Reference") + '</div></div>' +
      '<div class="kblib-grp" style="margin:8px 0 4px"><span class="kblib-lbl">System</span>' +
        f(_libState.branch === "all", "br", "all", "All") +
        branches.map(function (b) { return f(_libState.branch === b, "br", b, esc(b)); }).join("") + '</div>' +
      '<div class="kblib-count" id="kblibCount"></div><div class="kblib-grid" id="kblibGrid"></div>';
    kbWireLibrary();   // ensure the (delegated) handlers exist
    kbPaintLibrary();  // fill the grid from current filters/search
    // No per-element addEventListener here: search/filter/card events are handled by ONE
    // delegated listener (kbWireLibrary) so they survive the modal re-rendering .sbref-sec.
  }
  // repaint only the results grid from the current _libState (search + filters)
  function kbPaintLibrary() {
    var grid = document.getElementById("kblibGrid"); if (!grid) return;
    var q = _libState.q.toLowerCase();
    var all = kbBuildIndex();
    var res = all.filter(function (d) {
      if (_libState.cls !== "all" && d.cls !== _libState.cls) return false;
      if (_libState.src === "ref" && !d.ref) return false;
      if (_libState.src === "dx" && d.ref) return false;
      if (_libState.branch !== "all" && d.branch !== _libState.branch) return false;
      if (q.length >= 2 && d.text.indexOf(q) < 0) return false;
      return true;
    });
    var cnt = document.getElementById("kblibCount"); if (cnt) cnt.textContent = res.length + " of " + all.length + " entries";
    grid.innerHTML = res.slice(0, 400).map(function (d) {
      return '<button class="kblib-card ' + d.cls + '" data-kb="' + d.id + '"><div class="kblib-name">' + esc(d.name) + '</div>' +
        '<div class="kblib-meta"><span class="kblib-badge ' + d.cls + '">' + (d.cls === "inf" ? "Infective" : "Non-infective") + '</span>' +
        '<span class="kblib-badge ' + (d.ref ? "ref" : "dx") + '">' + (d.ref ? "📖 Reference" : "⚙ Diagnostic") + '</span>' +
        (d.sys ? '<span class="kblib-sys">' + esc(d.sys) + '</span>' : '') + '</div></button>';
    }).join("") || '<div style="padding:30px;text-align:center;color:var(--slate-soft)">No matches.</div>';
  }
  // ONE delegated listener for the Knowledge Library — survives modal re-renders.
  function kbWireLibrary() {
    if (window.__smdKbLibWired) return; window.__smdKbLibWired = true;
    document.addEventListener("input", function (e) {
      if (e.target && e.target.id === "kblibQ") { _libState.q = String(e.target.value || "").trim(); kbPaintLibrary(); }
    }, false);
    document.addEventListener("click", function (e) {
      var t = e.target; if (!t || !t.closest) return;
      var fb = t.closest(".kblib-f");
      if (fb) {
        if (fb.hasAttribute("data-cls")) _libState.cls = fb.getAttribute("data-cls");
        if (fb.hasAttribute("data-src")) _libState.src = fb.getAttribute("data-src");
        if (fb.hasAttribute("data-br")) _libState.branch = fb.getAttribute("data-br");
        try { kbRenderLibrary(); } catch (x) {}
        return;
      }
      var card = t.closest(".kblib-card[data-kb]");
      if (card) kbOpen(card.getAttribute("data-kb"));
    }, false);
  }
  function kbInjectCSS() {
    if (document.getElementById("smdKbCSS")) return;
    var st = document.createElement("style"); st.id = "smdKbCSS";
    st.textContent =
      ".kblib-search{width:100%;border:1.5px solid var(--line,#e2e8f0);border-radius:10px;padding:11px 13px;font-size:14px;outline:none;margin-bottom:10px;box-sizing:border-box}" +
      ".kblib-filters{display:flex;flex-wrap:wrap;gap:14px}.kblib-grp{display:flex;flex-wrap:wrap;gap:6px;align-items:center}" +
      ".kblib-lbl{font-size:10.5px;font-weight:700;color:var(--slate-soft,#94a3b8);text-transform:uppercase;letter-spacing:.04em}" +
      ".kblib-f{background:#fff;border:1px solid var(--line,#e2e8f0);border-radius:20px;padding:5px 11px;font-size:12px;cursor:pointer}" +
      ".kblib-f.on{background:var(--teal,#0f766e);color:#fff;border-color:var(--teal,#0f766e)}" +
      ".kblib-count{font-size:12px;color:var(--slate,#475569);margin:10px 2px}" +
      ".kblib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}" +
      ".kblib-card{text-align:left;border:1px solid var(--line,#e2e8f0);border-left:4px solid var(--teal,#0f766e);border-radius:9px;padding:9px 11px;background:#fff;cursor:pointer}" +
      ".kblib-card.inf{border-left-color:#dc2626}.kblib-card.ni{border-left-color:#16a34a}" +
      ".kblib-name{font-weight:600;font-size:13px;margin-bottom:5px}.kblib-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center}" +
      ".kblib-badge{font-size:10px;padding:1px 7px;border-radius:20px;font-weight:600}" +
      ".kblib-badge.inf{background:#fee2e2;color:#991b1b}.kblib-badge.ni{background:#dcfce7;color:#166534}" +
      ".kblib-badge.ref{background:#eef2ff;color:#3730a3}.kblib-badge.dx{background:#fef3c7;color:#92400e}" +
      ".kblib-sys{font-size:10.5px;color:var(--slate-soft,#94a3b8)}";
    document.head.appendChild(st);
  }
  function smdWireKBSurfaces() { try { kbInjectCSS(); } catch (e) {} try { wireGlobalSearch(); } catch (e) {} try { wireSyndromeLibrary(); } catch (e) {} }

  window.DX = { open: open, openWorkspace: openWorkspace, close: close, reset: resetAll, _state: S, _ni: DDX_NI, _differential: differential,
    _nextQuestions: nextQuestions,
    // open ANY disease's reference panel from outside the reasoning workspace
    // (global search, knowledge library): open the panel, then show the ref.
    openRef: function (id) { try { open(); } catch (e) {} setTimeout(function () { try { openDiseaseRef(id); } catch (e) {} }, 90); },
    _assess: function () {
      var d = differential(), g = gate(d), info = GATEINFO[g.cls];
      return { cls: g.cls, ab: !!info.ab, lead: g.lead && g.lead.name,
        topInf: d.inf[0] ? { n: d.inf[0].name, s: d.inf[0].score, m: d.inf[0].matched } : null,
        topNi: d.ni[0] ? { n: d.ni[0].name, s: d.ni[0].score } : null,
        inf: d.inf.slice(0, 5).map(function (r) { return r.name + " " + r.score; }),
        ni: d.ni.slice(0, 5).map(function (r) { return r.name + " " + r.score; }) };
    },
    _onHospitalChange: function () { if (root && root.classList.contains("on")) recompute(); } };

  /* ---------------------------------------------------------------------- *
   * MAIN STEWARDSHIP ENGINE EXPANSION → all 140 diseases (additive, safe).
   *
   * The main app's runEngine() ranks only the 51 infective SYNDROMES and
   * renderOutput() builds an antibiotic page. app.js is a classic top-level
   * script, so runEngine/renderOutput are GLOBAL functions we can wrap from
   * here (reasoning.js loads after app.js). We DO NOT edit minified app.js and
   * DO NOT mutate window.SYNDROMES (its other consumers stay infective-only).
   *
   *  - runEngine(e): wrapped to ALSO score the 89 non-infective diagnoses (from
   *    the KB find-maps in DDX_NI) and merge them into the ranked candidate list,
   *    so the main "possible matches" list can surface any of the 140. Infective
   *    scoring is recomputed with the SAME match/baseScore closures (identical raw
   *    scores + order) — only the normalisation denominator changes, exactly as it
   *    would when any candidate is added. The sepsis-no-source fallback is left
   *    untouched. Non-infective only surface when their findings are present.
   *  - renderOutput(e,id): wrapped so selecting a non-infective diagnosis renders a
   *    management + Harrison reference page (reusing DX_MGMT + harrisonRef) instead
   *    of the antibiotic page; infective ids fall through to the original verbatim.
   *
   * Original runEngine is preserved on window.__smdOrigRunEngine for regression
   * tests (test/run-main-engine.mjs proves no infective regression).
   * ---------------------------------------------------------------------- */
  // Add the broader NON-INFECTIVE finding inputs to the MAIN app's form so the
  // 89 non-infective diagnoses can be ticked (and thus surface in the expanded
  // engine). The main form is data-driven from window.FIELD_GROUPS + the system
  // picker window.SYSTEM_PICKER_MAP — both globals from app.js. We append new
  // organ-system groups (labels reused from the reasoning ontology) WITHOUT
  // editing minified app.js. reasoning's own ontology is already built from
  // EXTRA_GROUPS, so this is purely additive to the main form. Idempotent.
  // Each NI group either MERGES into an existing infective system tab (mergeInto =
  // that tab's app.js id) so we get ONE tab per organ system — no "two Cardiac /
  // two Neuro" — or, when there is no infective counterpart (Endocrine, Toxicology),
  // adds a genuinely new tab. relabel broadens the merged tab's label to reflect it
  // now covers infective + non-infective findings.
  var NI_INPUT_GROUPS = [
    { group: "Cardiac / Vascular (non-infective)", mergeInto: "cardiac", relabel: "Cardiac / Vascular",
      keys: ["chestPain","exertionalChestPain","pleuriticChestPain","dyspnea","orthopnea","palpitations","raisedJVP","bilateralCrackles","ecgIschemia","knownCAD","knownHeartFailure","atrialFibHx","legSwellingUnilateral","calfTenderness","pulsatileMass","backPain"] },
    { group: "Neurological (non-infective)", mergeInto: "neuro", relabel: "Neuro / CNS",
      keys: ["headache","thunderclapHeadache","visualDisturbance","papilledema","ataxia","ascendingWeakness","rigidity","headInjury","anticoagulated","alcoholExcess","hypertensionHx"] },
    { group: "Gastrointestinal / Hepatic (non-infective)", mergeInto: "gastrointestinal", relabel: "Abdominal / GI / Hepatic",
      keys: ["hematemesis","asterixis","jaundice","rightUpperQuadrantPain","murphySign","ascites"] },
    { group: "Renal / Genitourinary (non-infective)", mergeInto: "genitourinary", relabel: "Renal / Urinary",
      keys: ["oliguria","hematuria","proteinuria","legSwellingBilateral"] },
    { group: "Haematology / Rheum / Skin (non-infective)", mergeInto: "skin", relabel: "Skin / Haem / Rheum",
      keys: ["mucocutaneousBleeding","mucosalLesions","facialSwelling","polyarthralgia","jointSwelling"] },
    { group: "Endocrine / Metabolic (non-infective)", id: "ni_endo", label: "Endocrine / Metabolic", icon: "🧬",
      keys: ["diabetesHx","steroidUse","ketonemia","polyuriaPolydipsia","hypothermia","bradycardia"] },
    { group: "Toxicology / General (non-infective)", id: "ni_tox", label: "Toxicology / General", icon: "⚗️",
      keys: ["drugOverdose","bradypnea","miosisSecretions","rigidity","cough","ageOver50","raised_lactate"] }
  ];
  var NI_INPUT_EXPLICIT_LABELS = { cough: "Cough", raised_lactate: "Raised lactate / hyperlactataemia" };
  function augmentFindingInputs() {
    if (window.__smdFindingsAugmented != null) return;
    if (!window.FIELD_GROUPS || !window.FIELD_GROUPS.push) return;        // app.js not ready
    try { buildOntology(); } catch (e) {}                                 // populate LABEL for reuse
    var have = {};
    window.FIELD_GROUPS.forEach(function (g) { (g.fields || []).forEach(function (f) { have[f.key] = true; }); });
    window.SYSTEM_PICKER_MAP = window.SYSTEM_PICKER_MAP || [];
    var added = 0;
    NI_INPUT_GROUPS.forEach(function (G) {
      var fields = G.keys.filter(function (k) { return !have[k]; })
        .map(function (k) { return { key: k, label: NI_INPUT_EXPLICIT_LABELS[k] || lbl(k) }; });
      if (!fields.length) return;
      window.FIELD_GROUPS.push({ group: G.group, fields: fields, nonInfective: true });
      fields.forEach(function (f) { have[f.key] = true; });               // dedupe across NI groups
      added += fields.length;
      if (G.mergeInto) {
        var tgt = null;
        window.SYSTEM_PICKER_MAP.forEach(function (x) { if (x.id === G.mergeInto) tgt = x; });
        if (tgt) { tgt.groups = (tgt.groups || []).concat([G.group]); if (G.relabel) tgt.label = G.relabel; }
        else window.SYSTEM_PICKER_MAP.push({ id: G.mergeInto, label: G.relabel || G.group, groups: [G.group], nonInfective: true });
      } else {
        window.SYSTEM_PICKER_MAP.push({ id: G.id, label: G.label, icon: G.icon, groups: [G.group], nonInfective: true });
      }
    });
    window.__smdFindingsAugmented = added;
    // CRITICAL: buildOntology() above memoised ONT/SYSPICK as a SNAPSHOT taken
    // BEFORE these groups + tabs were appended, so fieldsForSystem() could not
    // resolve them (every NI/merged tab rendered "All added."). Invalidate and
    // rebuild now that FIELD_GROUPS + SYSTEM_PICKER_MAP are complete.
    try { ONT = null; SYSPICK = []; buildOntology(); } catch (e) {}
  }

  function buildNIRegistry() {
    var reg = [], byId = {};
    (DDX_NI || []).forEach(function (d) {
      if (!d || !d.id || byId[d.id]) return;
      var syn = { id: d.id, name: d.name || d.id, system: d.system || "", nonInfective: true,
        antibioticRelevant: false, decision: { status: "green", label: "Non-infective diagnosis — management" },
        find: d.find || {}, reason: d.reason || "", red: d.red || [], inv: d.inv || [] };
      reg.push(syn); byId[d.id] = syn;
    });
    return { reg: reg, byId: byId };
  }
  function niScoreFor(e, find) {
    var sum = 0, anyPos = false;
    for (var k in find) { if (e[k]) { sum += find[k]; if (find[k] > 0) anyPos = true; } }
    return anyPos ? Math.max(1, Math.min(99, Math.round(sum))) : 0;
  }
  function renderNIPage(e, syn) {
    var n = document.getElementById("outputArea"); if (!n) return;
    var m = (window.DX_MGMT && window.DX_MGMT[syn.id]) || null;
    var tx = (m && m.tx && m.tx.length) ? m.tx : null;
    var ix = (m && m.ix && m.ix.length) ? m.ix : (syn.inv || []);
    var li = function (arr, n2) { return '<ul>' + arr.slice(0, n2 || 10).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>'; };
    n.innerHTML =
      '<div class="quick-answer-card green">' +
        '<div class="qa-header">Quick Decision · non-infective diagnosis</div>' +
        '<div class="qa-grid">' +
          '<div class="qa-item"><span class="qa-label">Diagnosis</span><span class="qa-value">' + esc(syn.name) + '</span></div>' +
          '<div class="qa-item"><span class="qa-label">Antibiotics Needed</span><span class="qa-value qa-abx-na">N/A</span></div>' +
          (syn.system ? '<div class="qa-item"><span class="qa-label">System</span><span class="qa-value">' + esc(syn.system) + '</span></div>' : '') +
        '</div>' +
      '</div>' +
      (syn.reason ? '<div class="card"><div class="simple-section-label">Why this</div><p>' + esc(syn.reason) + '</p></div>' : '') +
      (tx ? '<div class="card"><div class="simple-section-label">💊 Management / Treatment</div><ol>' + tx.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ol></div>'
          : '<div class="card"><div class="simple-section-label">Management</div><p>Specialist-guided, non-antibiotic management — see the investigations, red flags and Harrison reference below and consult full guidelines.</p></div>') +
      (ix && ix.length ? '<div class="card"><div class="simple-section-label">Key investigations</div>' + li(ix, 8) + '</div>' : '') +
      (syn.red && syn.red.length ? '<div class="card"><div class="simple-section-label">Red flags</div>' + li(syn.red, 8) + '</div>' : '') +
      (harrisonRef(syn.id, { expanded: true }) ? '<div class="card">' + harrisonRef(syn.id, { expanded: true }) + '</div>' : '') +
      '<div class="qa-pregnancy-note" style="margin-top:10px">⚠️ Decision-support only — non-infective management aligned to standard guidelines / Harrison 22e. Verify before acting.</div>';
  }
  function installMainEngineExpansion() {
    if (window.__smdEngineExpanded) return;
    if (typeof window.runEngine !== "function" || typeof window.renderOutput !== "function") return;
    var NI = buildNIRegistry();
    if (!NI.reg.length) return;                       // DDX_NI not ready yet — retry later
    var origRun = window.runEngine, origRender = window.renderOutput;
    window.__smdOrigRunEngine = origRun;
    window.runEngine = function (e) {
      var base; try { base = origRun(e); } catch (err) { return origRun(e); }
      try {
        if (!e || !base || base.isFallback) return base;
        var scored = [], syn = window.SYNDROMES || {};
        Object.keys(syn).forEach(function (id) {
          var sd = syn[id]; if (!sd || sd.nonInfective) return;
          var ok = false; try { ok = !!sd.match(e); } catch (_) {}
          if (!ok) return;
          var sc = 0; try { sc = sd.baseScore(e); } catch (_) {}
          scored.push({ syn: sd, score: Math.max(1, Math.min(99, sc)) });
        });
        NI.reg.forEach(function (sd) { var sc = niScoreFor(e, sd.find); if (sc > 0) scored.push({ syn: sd, score: sc }); });
        if (!scored.length) return base;
        scored.sort(function (a, b) { return b.score - a.score; });   // score desc — matches origRun (no tiebreak)
        var o = scored.reduce(function (t, x) { return t + x.score; }, 0) || 1;
        var r = scored.slice(0, 5).map(function (x) { return { name: x.syn.name, id: x.syn.id, probability: Math.round(x.score / o * 100), syn: x.syn }; });
        var s2 = r.reduce(function (t, x) { return t + x.probability; }, 0) || 1;
        r.forEach(function (x) { x.probability = Math.round(x.probability / s2 * 100); });
        return { toxicity: base.toxicity, toxicityOverride: base.toxicityOverride, ranked: r, top: r[0] || null, noMatch: false, isFallback: false };
      } catch (_) { return base; }
    };
    window.renderOutput = function (e, i, a) {
      try { if (i && NI.byId[i]) { renderNIPage(e, NI.byId[i]); return; } } catch (_) {}
      return origRender(e, i, a);
    };
    window.__smdEngineExpanded = true;
  }
  // app.js (classic script) runs before this; augment the main form's finding
  // inputs and install the engine expansion now, retrying on DOM ready in case a
  // global is populated slightly later.
  function smdMainAppHooks() { try { augmentFindingInputs(); } catch (e) {} try { installMainEngineExpansion(); } catch (e) {} try { smdWireKBSurfaces(); } catch (e) {} }
  smdMainAppHooks();
  if (!window.__smdEngineExpanded || window.__smdFindingsAugmented == null) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", smdMainAppHooks);
    else setTimeout(smdMainAppHooks, 0);
  }
  // the global search input + SB library object are created at/after DOMContentLoaded
  // and sometimes later — re-attempt the (idempotent) KB wiring a few times.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", smdWireKBSurfaces);
  [250, 800, 2000].forEach(function (ms) { setTimeout(smdWireKBSurfaces, ms); });
})();
