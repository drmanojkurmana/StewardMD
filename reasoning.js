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
      { key: "sickleCellHx", label: "Known sickle cell disease" }
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
      find:{ headache:30, focalNeuroDeficit:22, seizure:18, visualDisturbance:12, weightLoss:8, alteredSensorium:8, fever:-10 },
      inv:["MRI brain with contrast","Refer neuro-oncology"], red:["Progressive headache, morning vomiting, papilloedema"],
      reason:"Progressive headache with focal signs or new seizures raises concern for an intracranial mass." },
    { id:"iih", name:"Idiopathic intracranial hypertension", system:"Neurology",
      find:{ headache:30, visualDisturbance:24, fever:-12, neckStiffness:-8 },
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
      find:{ headache:22, hypertensionHx:24, visualDisturbance:16, chestPain:12, focalNeuroDeficit:10 },
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
      reason:"Painful rash with mucosal erosions and skin detachment after a new drug suggests SJS/TEN, not cellulitis." }
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
    variceal_bleed:"SBP", svc_obstruction:"mediastinitis", aki:"urosepsis", rhabdo:"sepsis", sjs_ten:"cellulitis / SSSS"
  };

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
    groups.forEach(function (g) { g.fields.forEach(function (fl) { LABEL[fl.key] = fl.label; VALID[fl.key] = true; }); });
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
    S.f[k] = true; S.started = true; S.lastAdded = LABEL[k] || k;
    try {
      var d0 = differential(); var top = d0.inf[0] || d0.ni[0];
      S.timeline.push({ f: LABEL[k] || k, top: top ? (top.name + " · " + top.score + "/100") : "—" });
    } catch (e) {}
    recompute();
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

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
    var matched = false;
    try { matched = !!(s.match && s.match(S.fInf)); } catch (e) {}
    var sc;
    if (matched) {
      try { sc = clamp(Math.round(s.baseScore ? s.baseScore(S.fInf) : 60), 0, 100); } catch (e) { sc = 60; }
    } else {
      // soft pre-match suggestion weighted by finding specificity (IDF), so a
      // shared generic finding (fever) barely surfaces a syndrome while a
      // specific one (neck stiffness) does. Capped below matched scores.
      computeIDF();
      var rel = 0; present.forEach(function (k) { rel += (IDF[k] || 0.5); });
      sc = clamp(Math.round(rel * 13), 0, 56);
      if (sc < 16) return null; // below the noise floor — don't list
    }
    var missing = assoc.filter(function (k) { return !S.fInf[k]; }).slice(0, 5);
    // contradictory = entered findings whose removal RAISES the score (data-driven probe)
    var contra = [];
    if (matched && s.baseScore) {
      present.forEach(function (k) {
        var clone = {}; for (var x in S.fInf) clone[x] = S.fInf[x]; delete clone[k];
        var without; try { without = clamp(Math.round(s.baseScore(clone)), 0, 100); } catch (e) { without = sc; }
        if (without > sc) contra.push(k);
      });
    }
    var reason = "";
    try { if (s.decision && s.decision.reasoning) reason = s.decision.reasoning(S.fInf); } catch (e) {}
    var red = (s.decision && (s.decision.status === "red")) ? [s.decision.label || "Time-critical infection"] : [];
    var inv = (s.investigations || []).map(function (i) { return i.test ? (i.test) : i; });
    return { id: s.id, name: s.name, system: s.system || "Infectious", inf: true, matched: matched,
      score: sc, supporting: present, contra: contra, missing: missing, reason: reason, red: red, inv: inv, _syn: s };
  }

  function scoreNI(d) {
    var sup = [], contra = [], sum = 0, any = false;
    for (var k in d.find) { if (S.f[k]) { sum += d.find[k]; any = true; if (d.find[k] > 0) sup.push(k); else if (d.find[k] < 0) contra.push(k); } }
    if (!any) return null;
    var sc = clamp(Math.round(sum), 0, 100);
    if (sc <= 0 && sup.length === 0) return null;
    var missing = [];
    for (var k2 in d.find) { if (!S.f[k2] && d.find[k2] >= 12) missing.push(k2); }
    missing = missing.sort(function (a, b) { return d.find[b] - d.find[a]; }).slice(0, 5);
    return { id: d.id, name: d.name, system: d.system, inf: false, matched: false,
      score: sc, supporting: sup.sort(function (a, b) { return d.find[b] - d.find[a]; }),
      contra: contra.sort(function (a, b) { return d.find[a] - d.find[b]; }),
      missing: missing, reason: d.reason || "", red: d.red || [], inv: d.inv || [], tools: d.tools || [] };
  }

  function differential() {
    buildOntology();
    S.fInf = infFindings();
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
        '<div class="dx-title">Clinical Reasoning <span class="dx-beta">live</span></div>' +
        '<button class="dx-reset" id="dxReset" title="Start over">Reset</button>' +
      '</div>' +
      '<div class="dx-body">' +
        '<div class="dx-discl">Live differential — updates as you add findings. Ranked by Clinical Confidence Score (a transparent rule-based score, not a validated probability). Nothing here is a confirmed diagnosis; StewardMD supports, not replaces, your clinical judgment.</div>' +
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
        '<div id="dxCols" class="dx-cols"></div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector("#dxClose").addEventListener("click", close);
    root.querySelector("#dxReset").addEventListener("click", resetAll);
    root.querySelector("#dxAdvToggle").addEventListener("click", function () { S.advOpen = !S.advOpen; renderAdv(); });
    var si = root.querySelector("#dxSearch");
    si.addEventListener("input", function () { filter = si.value.trim().toLowerCase(); renderPicker(); });
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
      var matches = [];
      ONT.forEach(function (g) { g.fields.forEach(function (fl) {
        if (!S.f[fl.key] && (fl.label || "").toLowerCase().indexOf(filter) >= 0) matches.push(fl);
      }); });
      el.innerHTML = '<div class="dx-cat"><div class="dx-cat-h">Search results</div><div class="dx-chips">' +
        (matches.length ? matches.map(function (fl) { return chipBtn(fl.key, fl.label); }).join("") : '<span class="dx-sel-empty">No matching findings.</span>') +
        '</div></div>';
      wireAddChips(el); return;
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
  function renderSuggest(d) {
    var el = root.querySelector("#dxSuggest");
    if (!el) return;
    if (!Object.keys(S.f).length) { el.innerHTML = ""; return; }
    var counts = {};
    d.inf.slice(0, 5).concat(d.ni.slice(0, 5)).forEach(function (r) {
      (r.missing || []).forEach(function (k) { if (!S.f[k] && LABEL[k]) counts[k] = (counts[k] || 0) + 1; });
    });
    var sug = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 6);
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
    visualDisturbance:["visual loss","blurred vision","vision loss","diplopia"], bloodyStool:["bloody stool","blood in stool","hematochezia","rectal bleed"],
    raisedJVP:["raised jvp","elevated jvp"], hypertensionHx:["hypertensive","high bp","htn"],
    ascendingWeakness:["ascending weakness","areflexia","ascending paralysis"], rigidity:["rigidity","rigid"],
    hypothermia:["hypothermia","hypothermic","low temperature"], bradycardia:["bradycardia","slow heart"],
    bradypnea:["bradypnea","slow breathing","depressed respiration","low respiratory rate"],
    miosisSecretions:["pinpoint pupil","miosis","salivation","cholinergic"], mucocutaneousBleeding:["bleeding","mucosal bleed","bruising","petechiae"],
    oliguria:["oliguria","anuria","reduced urine","low urine output"], mucosalLesions:["mucosal erosion","skin peeling","skin detachment","mucositis"],
    facialSwelling:["facial swelling","facial oedema","facial edema"], darkUrine:["dark urine","tea-coloured urine","tea colored urine"]
  };
  function parseFreeText(text) {
    if (!text) return;
    var t = " " + text.toLowerCase().replace(/[^a-z0-9 ]/g, " ") + " ", added = 0;
    Object.keys(VALID).forEach(function (k) {
      if (S.f[k]) return;
      var hit = false;
      (FT_SYN[k] || []).forEach(function (s) { if (t.indexOf(s) >= 0) hit = true; });
      if (!hit) { var lab = (LABEL[k] || "").toLowerCase(); if (lab.length >= 5 && lab.length <= 22 && t.indexOf(" " + lab + " ") >= 0) hit = true; }
      if (hit) { S.f[k] = true; added++; }
    });
    S.started = true;
    S.timeline.push({ f: "free-text (" + added + " findings extracted)", top: "" });
    recompute();
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
      if (pol.entry) L.push("Empiric (" + pol.hospital.short + " policy): " + (pol.entry.preferred || []).join("; "));
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
    try { var w = window.open("", "_blank"); w.document.write("<title>StewardMD reasoning</title><pre style='font:13px monospace;white-space:pre-wrap;padding:18px'>" + esc(buildSummary()) + "</pre>"); w.document.close(); w.focus(); w.print(); } catch (e) {}
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
      '</div>' +
      (sessions.length ? '<div class="dx-sess-h">Saved sessions</div><div class="dx-sess">' + sessions.map(function (s, i) { return '<button class="dx-sess-item" data-i="' + i + '">' + esc(s.label) + ' <span>' + esc(s.when) + '</span></button>'; }).join("") + '</div>' : '') +
      (S.timeline.length ? '<div class="dx-tl-h">Reasoning timeline</div><div class="dx-tl">' + S.timeline.map(function (t) { return '<div class="dx-tl-item"><b>+ ' + esc(t.f) + '</b>' + (t.top ? ' → leading: ' + esc(t.top) : '') + '</div>'; }).join("") + '</div>' : '');
    el.querySelector("#dxExtract").addEventListener("click", function () { parseFreeText(el.querySelector("#dxFreeText").value); });
    el.querySelector("#dxSaveSess").addEventListener("click", saveSession);
    el.querySelector("#dxExport").addEventListener("click", exportSummary);
    el.querySelector("#dxPrint").addEventListener("click", printSummary);
    el.querySelectorAll(".dx-sess-item").forEach(function (b) { b.addEventListener("click", function () { loadSession(+b.getAttribute("data-i")); }); });
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
    var det = '<div class="dx-detail">' +
      '<div class="dx-d-row"><b>Supporting findings</b><div>' + fl(r.supporting, "sup", "✓ ") + '</div></div>' +
      (r.contra && r.contra.length ? '<div class="dx-d-row"><b>Contradictory findings</b><div>' + fl(r.contra, "con", "✕ ") + '</div></div>' : '') +
      '<div class="dx-d-row"><b>Missing / would help</b><div>' + fl(r.missing, "mis", "? ") + '</div></div>' +
      (r.reason ? '<div class="dx-d-row"><b>Reasoning</b><div class="dx-reason">' + esc(r.reason) + '</div></div>' : '') +
      (r.red && r.red.length ? '<div class="dx-d-row red"><b>Red flags</b><ul>' + r.red.map(function (x){return '<li>'+esc(x)+'</li>';}).join("") + '</ul></div>' : '') +
      (r.inv && r.inv.length ? '<div class="dx-d-row"><b>Suggested investigations</b><ul>' + r.inv.slice(0,5).map(function (x){return '<li>'+esc(x)+'</li>';}).join("") + '</ul></div>' : '') +
      (tools.length ? '<div class="dx-d-row"><b>Related bedside tools</b><div class="dx-tools">' + tools.map(function (t){return '<button class="dx-tool" data-tool="'+t+'">'+esc(TOOLREG[t].icon+" "+TOOLREG[t].label)+'</button>';}).join("") + '</div></div>' : '') +
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
      return '<option value="' + x.id + '"' + (x.id === h.id ? " selected" : "") + '>' + esc(x.name) + (x.hasPolicy ? "" : " — national guidance") + '</option>';
    }).join("");
    el.innerHTML = '<span class="dx-hosp-l">Hospital policy</span>' +
      (h.logo ? '<img class="dx-hosp-logo" src="' + h.logo + '" alt="' + esc(h.short) + ' logo">' : "") +
      '<select id="dxHospSel" class="dx-hosp-sel" aria-label="Select hospital policy">' + opts + '</select>';
    var sel = el.querySelector("#dxHospSel");
    sel.addEventListener("change", function () { window.HOSPITAL.setProfile(sel.value); });
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
        '<div class="dx-policy-note">No ' + esc(h.short || h.name) + ' syndrome-specific empiric entry for <b>' + esc(lead.name) + '</b>. ' +
        (h.note ? esc(h.note) + " " : "") + 'StewardMD shows national/international (ICMR/IDSA) guidance on the full disease page.</div>' +
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
    if (!nFind) {
      gateEl.innerHTML = ""; polEl.innerHTML = ""; chEl.style.display = "none";
      colEl.innerHTML = '<div class="dx-prompt">Select the general findings and the involved system above to begin reasoning.</div>';
      S.prev = {}; return;
    }
    if (!ready) {
      gateEl.innerHTML = ""; polEl.innerHTML = ""; chEl.style.display = "none";
      colEl.innerHTML = '<div class="dx-threshold">🧩 Please add more clinical findings to improve diagnostic accuracy.' +
        '<span>Add at least 3 findings (or one highly specific finding) to generate a reliable differential — use the suggestions above.</span></div>';
      S.prev = {}; return;
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
    // snapshot scores for delta
    var snap = {}; d.inf.concat(d.ni).forEach(function (r) { snap[r.id] = r.score; });
    S.prev = snap;
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
          return;
        }
      } catch (e) {}
      alert("Opening the disease page — stewardship module is loading.");
      return;
    }
    // non-infectious -> expand its card (no antimicrobial recommendation)
    S.expanded[id] = true; renderColsOnly();
    var c = root.querySelector('.dx-card.open .dx-detail');
    if (c) c.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetAll() { S.f = {}; S.prev = {}; S.expanded = {}; S.started = false; S.system = null; S.showRare = false; S.compare = []; S.timeline = []; filter = ""; var si = root && root.querySelector("#dxSearch"); if (si) si.value = ""; recompute(); }
  function open(opts) {
    ensureRoot();
    if (opts && opts.workspace) { S.workspace = true; S.advOpen = true; }
    // Bridge: carry over findings already entered in the legacy checkbox wizard
    if (!Object.keys(S.f).length && typeof window.SMD_getFindings === "function") {
      try { var lf = window.SMD_getFindings(), n = 0; for (var k in lf) { if (lf[k] && VALID[k]) { S.f[k] = true; n++; } } if (n) { S.started = true; S.lastAdded = null; } } catch (e) {}
    }
    root.classList.add("on"); document.body.classList.add("dx-lock"); recompute();
  }
  function openWorkspace() { open({ workspace: true }); }
  function close() { if (root) { root.classList.remove("on"); document.body.classList.remove("dx-lock"); } }

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
      ".dx-tl-item{font:500 12px var(--sans);color:var(--slate);border-left:2px solid var(--teal);padding:3px 0 3px 10px}",
      ".dx-tl-item b{color:var(--ink)}",
      ".dx-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(12px);background:var(--ink);color:var(--paper);padding:11px 18px;border-radius:10px;font:700 13px var(--sans);z-index:900;opacity:0;transition:all .3s;box-shadow:0 6px 24px rgba(0,0,0,.3)}",
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
      ".dx-cmp-lbl{font:700 9.5px var(--sans);text-transform:uppercase;letter-spacing:.03em;color:var(--slate-soft);margin:8px 0 3px}"
    ].join("");
    var st = document.createElement("style"); st.id = "dx-styles"; st.textContent = css; document.head.appendChild(st);
  }
  function injectLaunch() {
    var actions = document.querySelector(".app-head-actions");
    if (!actions || document.getElementById("dxLaunch")) return;
    var b = document.createElement("button");
    b.id = "dxLaunch"; b.className = "dx-launch"; b.type = "button";
    b.setAttribute("aria-label", "Open clinical reasoning");
    b.innerHTML = "🧠 Reasoning";
    b.addEventListener("click", open);
    actions.insertBefore(b, actions.firstChild);
  }
  function init() { injectCSS(); injectLaunch(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.DX = { open: open, openWorkspace: openWorkspace, close: close, reset: resetAll, _state: S, _ni: DDX_NI, _differential: differential,
    _onHospitalChange: function () { if (root && root.classList.contains("on")) recompute(); } };
})();
