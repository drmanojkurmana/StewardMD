# StewardMD — Clinical Validation (Gold-Standard Case Replay)
Target: http://localhost:8903/ · 500 cases · engine + expanded KB (off) · MaiK mocked

## Metrics
- **casesTested**: 500
- **primaryDxCorrect**: 372/500 (74%)
- **top3Accuracy**: 471/500 (94%)
- **stewardshipResolved**: 470/500
- **antibioticCorrect**: 139/175 (79%)
- **investigationQualityAvg**: 3%
- **avgReasoningConfidence**: 89/100
- **maikAgreement**: mock: 500/500 pipeline-ok (agreement needs live key)
- **avgResponseMs**: 46
- **kbIntegrity**: enrichment 484 · expanded 231 · treatments 140

## Regression: OK
- improved: —
- regressed: —

## Per-case
| Case | Expected | Engine top-1 | Conf | Top-1 | Top-3 | Abx | Inv% |
|---|---|---|---|---|---|---|---|
| meningitis_bacterial_01 | Acute bacterial meningitis | Acute Bacterial Meningitis | 100 | ✅ | ✅ | ✅ | 0 |
| cap_01 | Community-acquired pneumonia | Community Acquired Pneumonia (non-severe) | 71 | ✅ | ✅ | ✅ | 0 |
| pyelonephritis_01 | Acute pyelonephritis | Acute Pyelonephritis | 81 | ✅ | ✅ | ✅ | 0 |
| acs_stemi_01 | Acute coronary syndrome (STEMI) | Acute coronary syndrome | 100 | ✅ | ✅ | n/a | 0 |
| cellulitis_01 | Cellulitis | Cellulitis | 81 | ✅ | ✅ | ✅ | 0 |
| pulmonary_embolism_01 | Pulmonary embolism | Pulmonary embolism | 100 | ✅ | ✅ | n/a | 0 |
| pulmonary_tb_01 | Pulmonary tuberculosis | Pulmonary Tuberculosis | 100 | ✅ | ✅ | ✅ | 0 |
| hlh_01 | Hemophagocytic lymphohistiocytosis (HLH) | Malaria | 75 | ❌ | ❌ | n/a | 0 |
| gc_001 | Septic shock of unknown source with elevated lactate and multi-organ dysfunction | Septic Shock | 100 | ✅ | ✅ | ✅ | 0 |
| gc_002 | Febrile neutropenia with septic shock, likely gastrointestinal/mucosal or catheter-related source, in a post-chemotherapy lymphoma patient | Febrile Neutropenia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_003 | Sepsis with septic shock secondary to complicated urosepsis (E. coli pyelonephritis/bacteremia) in an elderly patient with type 2 diabetes | Acute Pyelonephritis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_004 | Community-acquired pneumonia (typical lobar pattern, likely pneumococcal), CURB-65 = 0-1, low severity, outpatient/short-stay candidate | Community Acquired Pneumonia (non-severe) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_005 | Severe community-acquired pneumonia (CURB-65 4-5) with septic shock, requiring ICU admission | Severe Community Acquired Pneumonia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_006 | Community-acquired pneumonia, atypical presentation (Mycoplasma pneumoniae), non-severe (CURB-65 = 0) | Severe Community Acquired Pneumonia | 100 | ❌ | ✅ | ✅ | 0 |
| gc_007 | Hospital-acquired pneumonia (HAP), day 6, with risk factors for multidrug-resistant organisms | Hospital Acquired Pneumonia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_008 | Ventilator-associated pneumonia (VAP), day 5 of mechanical ventilation | Ventilator Associated Pneumonia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_009 | Acute uncomplicated cystitis | Acute Pyelonephritis | 100 | ❌ | ✅ | ❌ | 0 |
| gc_010 | Acute uncomplicated pyelonephritis due to Escherichia coli | Acute Pyelonephritis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_011 | Catheter-associated urinary tract infection, long-term catheter, with systemic inflammatory response (urosepsis) | Acute Pyelonephritis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_012 | Acute kidney injury, pre-renal, secondary to hypovolaemia | Acute Gastroenteritis | 76 | ❌ | ✅ | n/a | 17 |
| gc_013 | Acute kidney injury due to acute tubular necrosis, multifactorial (sepsis-associated hypoperfusion plus aminoglycoside nephrotoxicity) | Septic Shock | 100 | ❌ | ✅ | ✅ | 0 |
| gc_014 | Acute kidney injury, post-renal (obstructive) due to bladder outlet obstruction from benign prostatic hyperplasia with bilateral hydronephrosis | Acute Bacterial Prostatitis | 62 | ❌ | ❌ | n/a | 0 |
| gc_015 | Diabetic nephropathy (diabetic kidney disease) causing CKD stage 4 | Chronic kidney disease | 74 | ✅ | ✅ | n/a | 0 |
| gc_016 | Diabetic ketoacidosis (new-onset type 1 diabetes mellitus) | Diabetic ketoacidosis | 100 | ✅ | ✅ | n/a | 0 |
| gc_017 | Euglycemic diabetic ketoacidosis precipitated by SGLT2 inhibitor use during a perioperative fasting/reduced-intake period | Diabetic ketoacidosis | 80 | ✅ | ✅ | n/a | 0 |
| gc_018 | Hyperosmolar hyperglycaemic state (HHS) | Hyperosmolar hyperglycaemic state | 84 | ✅ | ✅ | n/a | 0 |
| gc_019 | ST-elevation myocardial infarction (anterior wall STEMI) | Acute coronary syndrome | 100 | ✅ | ✅ | n/a | 0 |
| gc_020 | Non-ST-elevation myocardial infarction (NSTEMI) with dynamic ECG changes | Acute coronary syndrome | 100 | ✅ | ✅ | n/a | 25 |
| gc_021 | Unstable angina (high-risk non-ST-elevation acute coronary syndrome) | Acute coronary syndrome | 100 | ✅ | ✅ | n/a | 0 |
| gc_022 | Acute decompensated heart failure with reduced ejection fraction, pulmonary congestion | Acute heart failure / pulmonary edema | 100 | ✅ | ✅ | n/a | 0 |
| gc_023 | Acute heart failure — flash pulmonary oedema, hypertensive | Acute heart failure / pulmonary edema | 100 | ✅ | ✅ | n/a | 0 |
| gc_024 | New-onset heart failure with preserved ejection fraction (HFpEF), likely hypertensive heart disease, in an elderly hypertensive woman | Acute heart failure / pulmonary edema | 100 | ✅ | ✅ | n/a | 0 |
| gc_025 | Acute ischaemic stroke, left MCA (M1) territory, cardioembolic (atrial fibrillation), within IV thrombolysis and mechanical thrombectomy window | Transient ischaemic attack | 76 | ❌ | ✅ | n/a | 0 |
| gc_026 | Hypertensive intracerebral haemorrhage | Intracerebral hemorrhage | 82 | ✅ | ✅ | n/a | 0 |
| gc_027 | Transient ischaemic attack (cardioembolic, secondary to atrial fibrillation), ABCD2 score 6 (high risk) | Intracerebral hemorrhage | 88 | ❌ | ✅ | n/a | 0 |
| gc_028 | Acute submassive pulmonary embolism with right ventricular strain | Pulmonary embolism | 100 | ✅ | ✅ | n/a | 14 |
| gc_029 | Massive (high-risk) pulmonary embolism with obstructive shock | Pulmonary embolism | 100 | ✅ | ✅ | n/a | 0 |
| gc_030 | Acute infective exacerbation of COPD (Anthonisen type I: increased dyspnea, increased sputum volume, increased sputum purulence) | Acute COPD Exacerbation | 91 | ✅ | ✅ | ✅ | 0 |
| gc_031 | COPD exacerbation with acute hypercapnic (Type II) respiratory failure | Acute COPD Exacerbation | 91 | ✅ | ✅ | ✅ | 0 |
| gc_032 | Acute severe asthma exacerbation | Asthma exacerbation | 82 | ✅ | ✅ | n/a | 0 |
| gc_033 | Near-fatal acute asthma exacerbation with silent chest and impending respiratory arrest | Asthma exacerbation | 82 | ✅ | ✅ | n/a | 0 |
| gc_034 | Decompensated cirrhosis (Child-Pugh C) with tense ascites, upper GI bleed (likely variceal), and grade II hepatic encephalopathy | Hepatic encephalopathy | 100 | ✅ | ✅ | ❌ | 0 |
| gc_035 | Spontaneous bacterial peritonitis | Hepatic encephalopathy | 100 | ❌ | ✅ | ❌ | 0 |
| gc_036 | Hepatic encephalopathy (Grade II) in decompensated alcohol-related cirrhosis, precipitated by constipation and lactulose non-adherence | Hepatic encephalopathy | 100 | ✅ | ✅ | n/a | 0 |
| gc_037 | Acute variceal hemorrhage (esophageal varices) in decompensated cirrhosis | Hepatic encephalopathy | 100 | ❌ | ✅ | ❌ | 0 |
| gc_038 | Acute lower gastrointestinal bleeding due to colonic diverticular haemorrhage | Hypovolemic / haemorrhagic shock | 82 | ❌ | ❌ | n/a | 0 |
| gc_039 | Acute pancreatitis, gallstone (biliary) etiology | Acute pancreatitis | 88 | ✅ | ✅ | n/a | 20 |
| gc_040 | Severe acute alcoholic pancreatitis with SIRS and early organ dysfunction | Acute pancreatitis | 88 | ✅ | ✅ | n/a | 0 |
| gc_041 | Acute bacterial meningitis (Streptococcus pneumoniae) | Acute Bacterial Meningitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_042 | Tuberculous meningitis (subacute presentation, endemic area) | Acute Bacterial Meningitis | 100 | ✅ | ✅ | ❌ | 0 |
| gc_043 | Native valve infective endocarditis (bicuspid aortic valve) due to viridans group streptococcus, with septic embolic phenomena | Infective Endocarditis | 91 | ✅ | ✅ | ✅ | 0 |
| gc_044 | Right-sided (tricuspid valve) infective endocarditis due to MRSA in a person who injects drugs, complicated by septic pulmonary emboli | Infective Endocarditis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_045 | Severe hyperkalaemia with ECG changes secondary to acute-on-chronic kidney injury (drug-induced: ACE inhibitor, potassium-sparing diuretic, NSAID) | Cardiogenic shock | 76 | ❌ | ✅ | n/a | 0 |
| gc_046 | Euvolaemic, hypotonic (low serum osmolality) hyponatraemia due to SIADH, probably paraneoplastic secondary to suspected small-cell lung carcinoma | Symptomatic hyponatraemia / SIADH | 64 | ✅ | ✅ | n/a | 0 |
| gc_047 | Malignancy-associated hypercalcemia (humoral hypercalcemia of malignancy) | Hypercalcaemia of malignancy | 68 | ✅ | ✅ | n/a | 0 |
| gc_048 | Combined hypokalaemia and hypomagnesaemia due to GI losses (diarrhoea/vomiting) compounded by chronic loop diuretic use, with arrhythmia risk | Acute Gastroenteritis | 76 | ❌ | ❌ | n/a | 0 |
| gc_049 | Cardiogenic shock due to acute anterior STEMI (post-MI pump failure) with secondary ischemic mitral regurgitation | Acute coronary syndrome | 100 | ✅ | ✅ | n/a | 0 |
| gc_050 | Hypovolaemic shock due to acute upper gastrointestinal haemorrhage (suspected variceal bleed in cirrhosis) | Variceal bleeding | 96 | ✅ | ✅ | n/a | 0 |
| gc_051 | Anaphylaxis with distributive shock and upper airway compromise, triggered by food (shellfish) ingestion | Anaphylaxis | 66 | ✅ | ✅ | n/a | 0 |
| gc_052 | Moderate-to-severe ARDS (Berlin criteria) secondary to community-acquired pneumonia, with refractory hypoxaemia | Severe Community Acquired Pneumonia | 100 | ❌ | ❌ | ✅ | 0 |
| gc_053 | Convulsive status epilepticus (&gt;5 minutes), secondary to subtherapeutic phenytoin from medication non-adherence | Seizure / epilepsy | 68 | ✅ | ✅ | n/a | 0 |
| gc_054 | Thyroid storm (thyrotoxic crisis) | Thyroid storm | 88 | ✅ | ✅ | n/a | 0 |
| gc_055 | Systemic lupus erythematosus flare with active lupus nephritis | SLE / autoimmune flare | 100 | ✅ | ✅ | n/a | 0 |
| gc_056 | Giant cell arteritis (temporal arteritis) | Giant cell (temporal) arteritis | 78 | ✅ | ✅ | n/a | 50 |
| gc_057 | Acute gout (podagra) — first MTP monoarthritis | Cellulitis | 91 | ❌ | ✅ | n/a | 0 |
| gc_058 | Septic arthritis (bacterial, non-gonococcal) of the right knee, likely Staphylococcus aureus | Cellulitis | 91 | ❌ | ❌ | ❌ | 0 |
| gc_059 | Granulomatosis with polyangiitis (pulmonary-renal syndrome, PR3-ANCA positive) | Systemic vasculitis | 84 | ✅ | ✅ | n/a | 0 |
| gc_060 | Thrombotic thrombocytopenic purpura (TTP) | Thrombotic microangiopathy (TTP/HUS) | 90 | ✅ | ✅ | n/a | 0 |
| gc_061 | Disseminated intravascular coagulation (sepsis-associated, bleeding phenotype) | Septic Shock | 100 | ❌ | ✅ | ✅ | 0 |
| gc_062 | Sickle cell vaso-occlusive crisis (severe pain crisis), uncomplicated by acute chest syndrome or sepsis | Sickle Cell Vaso-occlusive Crisis | 84 | ✅ | ✅ | n/a | 0 |
| gc_063 | Febrile neutropenia, high-risk, no identified source at presentation | Febrile Neutropenia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_064 | Tumour lysis syndrome | Metabolic encephalopathy | 84 | ❌ | ❌ | n/a | 0 |
| gc_065 | Malignant spinal cord compression secondary to metastatic prostate cancer (T8-T9 epidural disease) | CNS Tuberculosis (TB Meningitis) | 62 | ❌ | ❌ | n/a | 0 |
| gc_066 | Adrenal crisis (acute primary adrenal insufficiency decompensation) precipitated by abrupt glucocorticoid withdrawal | Adrenal crisis | 78 | ✅ | ✅ | n/a | 0 |
| gc_067 | Severe hypoglycaemia due to insulin and sulfonylurea (glimepiride) use, precipitated by reduced oral intake in a patient with worsening renal function | Diabetic ketoacidosis | 100 | ❌ | ✅ | n/a | 33 |
| gc_068 | Guillain-Barré syndrome (acute inflammatory demyelinating polyradiculoneuropathy) | Acute Gastroenteritis | 81 | ❌ | ✅ | n/a | 0 |
| gc_069 | Myasthenic crisis (antibiotic-precipitated), impending respiratory failure | Guillain-Barré syndrome | 60 | ❌ | ❌ | n/a | 0 |
| gc_070 | Falciparum malaria | Malaria | 100 | ✅ | ✅ | n/a | 0 |
| gc_071 | Dengue with warning signs (plasma leakage) | Dengue Fever | 100 | ✅ | ✅ | n/a | 0 |
| gc_072 | Pulmonary tuberculosis | Pulmonary Tuberculosis | 100 | ✅ | ✅ | n/a | 0 |
| gc_073 | Leptospirosis (Weil's disease) with jaundice and acute kidney injury | Leptospirosis | 100 | ✅ | ✅ | ✅ | 22 |
| gc_074 | Enteric fever (typhoid) due to Salmonella enterica serotype Typhi, blood culture confirmed | Enteric Fever (Typhoid) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_075 | Cellulitis (non-purulent), left lower limb | Cellulitis | 96 | ✅ | ✅ | ✅ | 0 |
| gc_076 | Necrotising fasciitis with septic shock | Necrotizing Fasciitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_077 | COVID-19 pneumonia with hypoxaemic respiratory failure (bilateral ground-glass opacities) | Community Acquired Pneumonia (non-severe) | 100 | ❌ | ❌ | n/a | 0 |
| gc_078 | DRESS syndrome (drug rash with eosinophilia and systemic symptoms) secondary to phenytoin, with hepatic and renal involvement | Scrub Typhus | 70 | ❌ | ❌ | n/a | 0 |
| gc_079 | Stevens-Johnson syndrome/toxic epidermal necrolysis overlap (SJS/TEN), drug-induced (lamotrigine) | Stevens-Johnson syndrome / TEN | 78 | ✅ | ✅ | n/a | 0 |
| gc_080 | Paracetamol (acetaminophen) toxicity with acute hepatocellular injury from staggered supratherapeutic ingestion | Drug-induced / toxic hepatitis | 90 | ✅ | ✅ | n/a | 0 |
| gc_081 | Salicylate toxicity with mixed respiratory alkalosis and high anion-gap metabolic acidosis | Salicylate toxicity | 88 | ✅ | ✅ | n/a | 33 |
| gc_082 | Opioid overdose with respiratory depression and miosis | Opioid overdose | 98 | ✅ | ✅ | n/a | 0 |
| gc_083 | Tricyclic antidepressant (amitriptyline) overdose with wide-complex QRS, hypotension, and seizure | Drug intoxication / poisoning | 92 | ✅ | ✅ | n/a | 0 |
| gc_084 | Acute ascending cholangitis with septic shock (Charcot triad plus Reynolds pentad features), secondary to choledocholithiasis | Acute Cholangitis | 100 | ✅ | ✅ | ✅ | 43 |
| gc_085 | Acute appendicitis | Bowel obstruction | 90 | ❌ | ❌ | ❌ | 0 |
| gc_086 | Acute adhesive small bowel obstruction (uncomplicated, non-strangulated) | Bowel obstruction | 96 | ✅ | ✅ | n/a | 0 |
| gc_087 | Acute severe ulcerative colitis flare (Truelove and Witts criteria met) | Dysentery (Invasive Bacterial Diarrhea) | 100 | ❌ | ✅ | n/a | 0 |
| gc_088 | Nephrotic syndrome, likely primary glomerular disease (pending renal biopsy and anti-PLA2R result) | Nephrotic syndrome | 86 | ✅ | ✅ | n/a | 0 |
| gc_089 | Rapidly progressive glomerulonephritis (ANCA-associated, pauci-immune crescentic glomerulonephritis) with acute kidney injury | Acute kidney injury | 70 | ❌ | ✅ | n/a | 33 |
| gc_090 | Primary spontaneous pneumothorax (right-sided, moderate, no tension physiology at presentation) | Pulmonary embolism | 100 | ❌ | ✅ | n/a | 0 |
| gc_091 | Exudative pleural effusion, likely tubercular aetiology | Pulmonary Tuberculosis | 100 | ✅ | ✅ | n/a | 0 |
| gc_092 | Aneurysmal subarachnoid haemorrhage (right posterior communicating artery aneurysm) presenting as thunderclap headache | Subarachnoid hemorrhage | 100 | ✅ | ✅ | n/a | 25 |
| gc_093 | Acute Type A aortic dissection | Aortic dissection | 100 | ✅ | ✅ | n/a | 0 |
| gc_094 | Atrial fibrillation with rapid ventricular response (new-onset, hemodynamically stable) | Aortic stenosis (syncope) | 72 | ❌ | ✅ | n/a | 0 |
| gc_095 | Hypertensive emergency (severe blood pressure elevation with acute target-organ damage: hypertensive encephalopathy, acute pulmonary edema/heart failure, and acute kidney injury) | Acute heart failure / pulmonary edema | 100 | ❌ | ❌ | n/a | 0 |
| gc_096 | Acute limb ischaemia (Rutherford class IIb) due to cardioembolic arterial occlusion from atrial fibrillation | Acute Limb Ischaemia | 84 | ✅ | ✅ | n/a | 0 |
| gc_097 | Heat stroke (classic/non-exertional) with multiorgan dysfunction | Seizure / epilepsy | 68 | ❌ | ❌ | n/a | 0 |
| gc_098 | Delirium tremens (severe alcohol withdrawal syndrome with withdrawal seizure) | Encephalitis | 96 | ❌ | ✅ | n/a | 0 |
| gc_099 | Graves disease (autoimmune hyperthyroidism with thyroid eye disease and new atrial fibrillation) | Thyrotoxicosis (uncomplicated) | 72 | ✅ | ✅ | n/a | 20 |
| gc_100 | Myxoedema coma (decompensated severe primary hypothyroidism) precipitated by cold exposure and thyroid hormone non-adherence | Myxoedema coma | 84 | ✅ | ✅ | n/a | 0 |
| gc_101 | Vitamin B12 (cobalamin) deficiency due to pernicious anemia, presenting with macrocytic anemia and subacute combined degeneration of the spinal cord | Vitamin B12 Deficiency (incl. SACD) | 82 | ✅ | ✅ | n/a | 0 |
| gc_102 | ACUTE_BRONCHITIS | Upper Respiratory Tract Infection (common cold) | 81 | ✅ | ✅ | n/a | 0 |
| gc_103 | AMOEBIC_LIVER_ABSCESS | Amoebic Liver Abscess | 86 | ✅ | ✅ | ✅ | 0 |
| gc_104 | ASPIRATION_PNEUMONIA | Aspiration Pneumonia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_105 | BRAIN_ABSCESS | Encephalitis | 100 | ❌ | ✅ | ✅ | 0 |
| gc_106 | BRONCHIECTASIS_EXACERBATION | Bronchiectasis Exacerbation | 100 | ✅ | ✅ | ✅ | 0 |
| gc_107 | CAP | Community Acquired Pneumonia (non-severe) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_108 | CA_UTI | Catheter-Associated Urinary Tract Infection | 81 | ✅ | ✅ | ✅ | 0 |
| gc_109 | CELLULITIS | Cellulitis | 96 | ✅ | ✅ | ✅ | 0 |
| gc_110 | CHIKUNGUNYA | Dengue Fever | 100 | ✅ | ✅ | n/a | 0 |
| gc_111 | CHOLANGITIS | Acute Cholangitis | 86 | ✅ | ✅ | ✅ | 0 |
| gc_112 | CHOLECYSTITIS | Acute Cholecystitis | 62 | ✅ | ✅ | ✅ | 0 |
| gc_113 | CNS_TB | CNS Tuberculosis (TB Meningitis) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_114 | COMPLICATED_UTI | Acute Pyelonephritis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_115 | COPD_EXACERBATION | Acute COPD Exacerbation | 91 | ✅ | ✅ | ✅ | 0 |
| gc_116 | CYSTITIS | Acute Uncomplicated Cystitis | 81 | ✅ | ✅ | ✅ | 0 |
| gc_117 | C_DIFF | Clostridioides difficile Infection | 91 | ✅ | ✅ | ✅ | 0 |
| gc_118 | DENGUE | Dengue Fever | 100 | ✅ | ✅ | n/a | 0 |
| gc_119 | DEVICE_INFECTION | Device-Related Infection (CIED / Vascular Catheter) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_120 | DIABETIC_FOOT | Diabetic Foot Infection | 100 | ✅ | ✅ | ✅ | 0 |
| gc_121 | DISSEMINATED_TB | Disseminated (Miliary) Tuberculosis | 93 | ✅ | ✅ | ✅ | 0 |
| gc_122 | DYSENTERY | Dysentery (Invasive Bacterial Diarrhea) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_123 | ENCEPHALITIS | Acute Bacterial Meningitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_124 | ENTERIC_FEVER | Enteric Fever (Typhoid) | 100 | ✅ | ✅ | ✅ | 33 |
| gc_125 | ERYSIPELAS | Erysipelas | 100 | ✅ | ✅ | ✅ | 0 |
| gc_126 | FEBRILE_NEUTROPENIA | Febrile Neutropenia | 95 | ✅ | ✅ | ✅ | 0 |
| gc_127 | GASTROENTERITIS | Acute Gastroenteritis | 76 | ✅ | ✅ | n/a | 0 |
| gc_128 | HAP | Community Acquired Pneumonia (non-severe) | 100 | ❌ | ✅ | ❌ | 0 |
| gc_129 | IE | Infective Endocarditis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_130 | LEPTOSPIROSIS | Leptospirosis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_131 | LIVER_ABSCESS | Liver Abscess | 100 | ✅ | ✅ | ✅ | 0 |
| gc_132 | LUNG_ABSCESS | Lung Abscess | 100 | ✅ | ✅ | ✅ | 0 |
| gc_133 | MALARIA | Malaria | 100 | ✅ | ✅ | ✅ | 0 |
| gc_134 | MENINGITIS | Acute Bacterial Meningitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_135 | MIXED_MALARIA | Malaria | 100 | ✅ | ✅ | ✅ | 33 |
| gc_136 | NECROTIZING_FASCIITIS | Necrotizing Fasciitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_137 | PHARYNGITIS | Acute Pharyngitis | 96 | ✅ | ✅ | ✅ | 0 |
| gc_138 | PROSTATITIS | Complicated Urinary Tract Infection | 86 | ✅ | ✅ | ✅ | 0 |
| gc_139 | PULMONARY_TB | Pulmonary Tuberculosis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_140 | PUO | Malignancy (B-symptoms) | 80 | ❌ | ❌ | n/a | 0 |
| gc_141 | PYELONEPHRITIS | Acute Pyelonephritis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_142 | RICKETTSIAL_FEVER | Scrub Typhus | 95 | ✅ | ✅ | ✅ | 0 |
| gc_143 | SBP | Hepatic encephalopathy | 100 | ❌ | ✅ | ❌ | 0 |
| gc_144 | SCRUB_TYPHUS | Scrub Typhus | 95 | ✅ | ✅ | ✅ | 0 |
| gc_145 | SEPSIS | Septic Shock | 100 | ✅ | ✅ | ✅ | 0 |
| gc_146 | SEPTIC_SHOCK | Septic Shock | 100 | ✅ | ✅ | ✅ | 0 |
| gc_147 | SEVERE_CAP | Severe Community Acquired Pneumonia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_148 | SINUSITIS | Acute Sinusitis (Rhinosinusitis) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_149 | URTI | Upper Respiratory Tract Infection (common cold) | 62 | ✅ | ✅ | n/a | 0 |
| gc_150 | VAP | Ventilator Associated Pneumonia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_151 | VIRAL_HEPATITIS | Acute Viral Hepatitis | 62 | ✅ | ✅ | n/a | 0 |
| gc_152 | VIRAL_MENINGITIS | Acute Bacterial Meningitis | 96 | ✅ | ✅ | n/a | 0 |
| gc_153 | aaa | Ruptured abdominal aortic aneurysm | 100 | ✅ | ✅ | n/a | 0 |
| gc_154 | acs | Acute coronary syndrome | 100 | ✅ | ✅ | n/a | 0 |
| gc_155 | acute_leukemia | Acute leukaemia | 98 | ✅ | ✅ | n/a | 0 |
| gc_156 | adrenal_crisis | Adrenal crisis | 78 | ✅ | ✅ | n/a | 0 |
| gc_157 | aki | Acute Gastroenteritis | 76 | ❌ | ✅ | n/a | 33 |
| gc_158 | anaphylaxis | Anaphylaxis | 90 | ✅ | ✅ | n/a | 0 |
| gc_159 | anemia_sympt | Symptomatic anaemia | 88 | ✅ | ✅ | n/a | 33 |
| gc_160 | angioedema_acei | ACE-inhibitor / hereditary angioedema | 52 | ✅ | ✅ | n/a | 0 |
| gc_161 | aortic_dissection | Aortic dissection | 100 | ✅ | ✅ | n/a | 0 |
| gc_162 | aortic_stenosis | Aortic stenosis (syncope) | 100 | ✅ | ✅ | n/a | 33 |
| gc_163 | asthma_exac | Asthma exacerbation | 82 | ✅ | ✅ | n/a | 0 |
| gc_164 | atrial_fib | Atrial fibrillation / arrhythmia | 78 | ✅ | ✅ | n/a | 0 |
| gc_165 | biliary_colic | Biliary colic / cholelithiasis | 90 | ✅ | ✅ | n/a | 0 |
| gc_166 | bowel_obstruction | Bowel obstruction | 96 | ✅ | ✅ | n/a | 0 |
| gc_167 | brain_tumour | Brain tumour / mass lesion | 100 | ✅ | ✅ | n/a | 0 |
| gc_168 | cardiogenic_shock | Acute coronary syndrome | 100 | ✅ | ✅ | n/a | 0 |
| gc_169 | ckd | Chronic kidney disease | 90 | ✅ | ✅ | n/a | 33 |
| gc_170 | copd_exac_ni | Asthma exacerbation | 82 | ✅ | ✅ | n/a | 0 |
| gc_171 | cord_compression | Spinal cord compression | 78 | ✅ | ✅ | n/a | 0 |
| gc_172 | crystal_arthritis | Cellulitis | 91 | ❌ | ✅ | n/a | 0 |
| gc_173 | decomp_cirrhosis | Decompensated cirrhosis | 88 | ✅ | ✅ | n/a | 0 |
| gc_174 | dic | Disseminated intravascular coagulation | 100 | ✅ | ✅ | n/a | 0 |
| gc_175 | dka | Diabetic ketoacidosis | 100 | ✅ | ✅ | n/a | 0 |
| gc_176 | drug_intox | Drug intoxication / poisoning | 92 | ✅ | ✅ | n/a | 0 |
| gc_177 | dvt | Pulmonary embolism | 100 | ✅ | ✅ | n/a | 50 |
| gc_178 | gbs | Guillain-Barré syndrome | 72 | ✅ | ✅ | n/a | 0 |
| gc_179 | gerd_chest | GERD / non-cardiac chest pain | 76 | ✅ | ✅ | n/a | 0 |
| gc_180 | glomerulonephritis | Chronic kidney disease | 74 | ❌ | ✅ | n/a | 33 |
| gc_181 | heart_failure | Acute heart failure / pulmonary edema | 100 | ✅ | ✅ | n/a | 0 |
| gc_182 | hepatic_enceph | Hepatic encephalopathy | 100 | ✅ | ✅ | n/a | 0 |
| gc_183 | hhs | Hyperosmolar hyperglycaemic state | 84 | ✅ | ✅ | n/a | 0 |
| gc_184 | htn_emergency | Hypertensive emergency | 64 | ✅ | ✅ | n/a | 0 |
| gc_185 | hypercalcemia | Hypercalcaemia of malignancy | 68 | ✅ | ✅ | n/a | 0 |
| gc_186 | hyperkalemia | Hyperkalaemia | 76 | ✅ | ✅ | n/a | 0 |
| gc_187 | hyperthyroidism | Acute Gastroenteritis | 81 | ❌ | ✅ | n/a | 33 |
| gc_188 | hypoglycemia | Hypoglycemia | 80 | ✅ | ✅ | n/a | 67 |
| gc_189 | hyponatremia | Symptomatic hyponatraemia / SIADH | 66 | ✅ | ✅ | n/a | 0 |
| gc_190 | hypovolemic_shock | Hypovolemic / haemorrhagic shock | 92 | ✅ | ✅ | n/a | 0 |
| gc_191 | ibd_flare | Inflammatory bowel disease flare | 100 | ✅ | ✅ | n/a | 0 |
| gc_192 | ibs | Irritable bowel syndrome | 86 | ✅ | ✅ | n/a | 0 |
| gc_193 | ich | Intracerebral hemorrhage | 88 | ✅ | ✅ | n/a | 0 |
| gc_194 | iih | Idiopathic intracranial hypertension | 100 | ✅ | ✅ | n/a | 0 |
| gc_195 | ild | Interstitial lung disease | 86 | ✅ | ✅ | n/a | 33 |
| gc_196 | ischemic_stroke | Transient ischaemic attack | 76 | ❌ | ✅ | n/a | 0 |
| gc_197 | itp | Disseminated intravascular coagulation | 74 | ❌ | ✅ | n/a | 0 |
| gc_198 | lung_cancer | Lung cancer | 100 | ✅ | ✅ | n/a | 0 |
| gc_199 | malignancy_b | Malignancy (B-symptoms) | 100 | ✅ | ✅ | n/a | 0 |
| gc_200 | mesenteric_ischemia | Acute mesenteric ischemia | 88 | ✅ | ✅ | n/a | 67 |
| gc_201 | metabolic_enceph | Metabolic encephalopathy | 90 | ✅ | ✅ | n/a | 0 |
| gc_202 | migraine | Migraine | 92 | ✅ | ✅ | n/a | 0 |
| gc_203 | ms | Multiple sclerosis (relapse) | 80 | ✅ | ✅ | n/a | 0 |
| gc_204 | myasthenic_crisis | Myasthenic crisis | 62 | ✅ | ✅ | n/a | 0 |
| gc_205 | myeloma | Multiple myeloma | 64 | ✅ | ✅ | n/a | 0 |
| gc_206 | myxedema | Myxoedema coma | 100 | ✅ | ✅ | n/a | 0 |
| gc_207 | nephrotic | Nephrotic syndrome | 86 | ✅ | ✅ | n/a | 0 |
| gc_208 | opioid_od | Opioid overdose | 98 | ✅ | ✅ | n/a | 0 |
| gc_209 | organophosphate | Organophosphate / cholinergic poisoning | 100 | ✅ | ✅ | n/a | 0 |
| gc_210 | pancreatitis | Acute pancreatitis | 100 | ✅ | ✅ | n/a | 0 |
| gc_211 | panic | Panic attack / anxiety | 78 | ✅ | ✅ | n/a | 0 |
| gc_212 | pe | Pulmonary embolism | 100 | ✅ | ✅ | n/a | 25 |
| gc_213 | peptic_ulcer | Peptic ulcer disease / upper GI bleed | 90 | ✅ | ✅ | n/a | 0 |
| gc_214 | pericarditis | Acute pericarditis | 94 | ✅ | ✅ | n/a | 0 |
| gc_215 | pheo | Phaeochromocytoma crisis | 68 | ✅ | ✅ | n/a | 0 |
| gc_216 | pleural_effusion | Pleural effusion | 90 | ✅ | ✅ | n/a | 0 |
| gc_217 | pmr | Polymyalgia rheumatica | 68 | ✅ | ✅ | n/a | 0 |
| gc_218 | pneumothorax | Pneumothorax | 86 | ✅ | ✅ | n/a | 0 |
| gc_219 | renal_colic | Renal / ureteric colic | 100 | ✅ | ✅ | n/a | 0 |
| gc_220 | rhabdo | Acute kidney injury | 68 | ❌ | ✅ | n/a | 25 |
| gc_221 | rheumatoid | Rheumatoid arthritis | 70 | ✅ | ✅ | n/a | 0 |
| gc_222 | sah | Subarachnoid hemorrhage | 100 | ✅ | ✅ | n/a | 0 |
| gc_223 | salicylate_tox | Salicylate toxicity | 70 | ✅ | ✅ | n/a | 67 |
| gc_224 | sarcoidosis | Sarcoidosis | 98 | ✅ | ✅ | n/a | 0 |
| gc_225 | seizure_epilepsy | Seizure / epilepsy | 68 | ✅ | ✅ | n/a | 0 |
| gc_226 | serotonin_nms | Serotonin syndrome / NMS | 94 | ✅ | ✅ | n/a | 0 |
| gc_227 | sjs_ten | Stevens-Johnson syndrome / TEN | 78 | ✅ | ✅ | n/a | 0 |
| gc_228 | sle_flare | SLE / autoimmune flare | 92 | ✅ | ✅ | n/a | 0 |
| gc_229 | subdural | Subdural haematoma | 100 | ✅ | ✅ | n/a | 0 |
| gc_230 | svc_obstruction | Superior vena cava obstruction | 100 | ✅ | ✅ | n/a | 0 |
| gc_231 | tamponade | Cardiac tamponade | 100 | ✅ | ✅ | n/a | 0 |
| gc_232 | temporal_arteritis | Giant cell (temporal) arteritis | 78 | ✅ | ✅ | n/a | 0 |
| gc_233 | tension_ha | Tension-type headache | 60 | ✅ | ✅ | n/a | 0 |
| gc_234 | thyroid_storm | Thyroid storm | 88 | ✅ | ✅ | n/a | 0 |
| gc_235 | tia | Transient ischaemic attack | 88 | ✅ | ✅ | n/a | 0 |
| gc_236 | toxic_hepatitis | Drug-induced / toxic hepatitis | 82 | ✅ | ✅ | n/a | 0 |
| gc_237 | ttp_hus | Thrombotic microangiopathy (TTP/HUS) | 100 | ✅ | ✅ | n/a | 0 |
| gc_238 | variceal_bleed | Variceal bleeding | 96 | ✅ | ✅ | ✅ | 0 |
| gc_239 | vasculitis | Systemic vasculitis | 64 | ✅ | ✅ | n/a | 0 |
| gc_240 | vasovagal_syncope | Acute Gastroenteritis | 50 | ❌ | ✅ | n/a | 33 |
| gc_241 | wernicke | Wernicke encephalopathy | 100 | ✅ | ✅ | n/a | 0 |
| gc_242 | ACUTE_BRONCHITIS | Upper Respiratory Tract Infection (common cold) | 81 | ❌ | ✅ | n/a | 0 |
| gc_243 | AMOEBIC_LIVER_ABSCESS | Amoebic Liver Abscess | 68 | ✅ | ✅ | ✅ | 0 |
| gc_244 | ASPIRATION_PNEUMONIA | Aspiration Pneumonia | 100 | ✅ | ✅ | ❌ | 0 |
| gc_245 | BRAIN_ABSCESS | Brain Abscess | 100 | ✅ | ✅ | ✅ | 0 |
| gc_246 | BRONCHIECTASIS_EXACERBATION | Bronchiectasis Exacerbation | 100 | ✅ | ✅ | ❌ | 0 |
| gc_247 | CAP | Community Acquired Pneumonia (non-severe) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_248 | CA_UTI | Complicated Urinary Tract Infection | 62 | ❌ | ✅ | ✅ | 0 |
| gc_249 | CELLULITIS | Cellulitis | 81 | ✅ | ✅ | ❌ | 0 |
| gc_250 | CHIKUNGUNYA | Chikungunya | 95 | ✅ | ✅ | n/a | 0 |
| gc_251 | CHOLANGITIS | Acute Cholangitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_252 | CHOLECYSTITIS | Acute Cholecystitis | 62 | ✅ | ✅ | ❌ | 0 |
| gc_253 | CNS_TB | CNS Tuberculosis (TB Meningitis) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_254 | COMPLICATED_UTI | Complicated Urinary Tract Infection | 86 | ✅ | ✅ | ✅ | 0 |
| gc_255 | COPD_EXACERBATION | Acute COPD Exacerbation | 91 | ✅ | ✅ | ✅ | 20 |
| gc_256 | CYSTITIS | Acute Uncomplicated Cystitis | 81 | ✅ | ✅ | ✅ | 0 |
| gc_257 | C_DIFF | Clostridioides difficile Infection | 91 | ✅ | ✅ | ✅ | 0 |
| gc_258 | DENGUE | Dengue Fever | 100 | ✅ | ✅ | n/a | 0 |
| gc_259 | DEVICE_INFECTION | Device-Related Infection (CIED / Vascular Catheter) | 96 | ✅ | ✅ | ✅ | 0 |
| gc_260 | DIABETIC_FOOT | Diabetic Foot Infection | 100 | ✅ | ✅ | ✅ | 0 |
| gc_261 | DISSEMINATED_TB | Disseminated (Miliary) Tuberculosis | 83 | ✅ | ✅ | ✅ | 0 |
| gc_262 | DYSENTERY | Dysentery (Invasive Bacterial Diarrhea) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_263 | ENCEPHALITIS | Encephalitis | 100 | ✅ | ✅ | ❌ | 0 |
| gc_264 | ENTERIC_FEVER | Enteric Fever (Typhoid) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_265 | ERYSIPELAS | Erysipelas | 100 | ✅ | ✅ | ❌ | 25 |
| gc_266 | FEBRILE_NEUTROPENIA | Febrile Neutropenia | 95 | ✅ | ✅ | ✅ | 0 |
| gc_267 | GASTROENTERITIS | Acute Gastroenteritis | 76 | ✅ | ✅ | ❌ | 0 |
| gc_268 | HAP | Community Acquired Pneumonia (non-severe) | 100 | ❌ | ✅ | ❌ | 0 |
| gc_269 | IE | Infective Endocarditis | 62 | ✅ | ✅ | ✅ | 0 |
| gc_270 | LEPTOSPIROSIS | Leptospirosis | 85 | ✅ | ✅ | ✅ | 0 |
| gc_271 | LIVER_ABSCESS | Liver Abscess | 100 | ✅ | ✅ | ✅ | 0 |
| gc_272 | LUNG_ABSCESS | Lung Abscess | 100 | ✅ | ✅ | ✅ | 0 |
| gc_273 | MALARIA | Malaria | 100 | ✅ | ✅ | ✅ | 0 |
| gc_274 | MENINGITIS | Acute Bacterial Meningitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_275 | MIXED_MALARIA | Malaria | 100 | ❌ | ✅ | ✅ | 0 |
| gc_276 | NECROTIZING_FASCIITIS | Cellulitis | 100 | ❌ | ✅ | ✅ | 0 |
| gc_277 | PHARYNGITIS | Acute Pharyngitis | 96 | ✅ | ✅ | ✅ | 0 |
| gc_278 | PROSTATITIS | Complicated Urinary Tract Infection | 86 | ❌ | ✅ | ✅ | 0 |
| gc_279 | PULMONARY_TB | Pulmonary Tuberculosis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_280 | PUO | Malignancy (B-symptoms) | 88 | ❌ | ❌ | n/a | 0 |
| gc_281 | PYELONEPHRITIS | Acute Pyelonephritis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_282 | RICKETTSIAL_FEVER | Scrub Typhus | 100 | ✅ | ✅ | ✅ | 0 |
| gc_283 | SBP | Hepatic encephalopathy | 100 | ❌ | ✅ | ❌ | 0 |
| gc_284 | SCRUB_TYPHUS | Enteric Fever (Typhoid) | 95 | ❌ | ✅ | ❌ | 0 |
| gc_285 | SEPSIS | Septic Shock | 100 | ❌ | ✅ | ✅ | 0 |
| gc_286 | SEPTIC_SHOCK | Septic Shock | 100 | ✅ | ✅ | ❌ | 0 |
| gc_287 | SEVERE_CAP | Community Acquired Pneumonia (non-severe) | 62 | ❌ | ✅ | ✅ | 0 |
| gc_288 | SINUSITIS | Acute Sinusitis (Rhinosinusitis) | 66 | ✅ | ✅ | ✅ | 0 |
| gc_289 | URTI | Upper Respiratory Tract Infection (common cold) | 62 | ✅ | ✅ | n/a | 0 |
| gc_290 | VAP | Ventilator Associated Pneumonia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_291 | VIRAL_HEPATITIS | Acute Viral Hepatitis | 62 | ✅ | ✅ | n/a | 0 |
| gc_292 | VIRAL_MENINGITIS | Acute Bacterial Meningitis | 96 | ❌ | ✅ | ✅ | 0 |
| gc_293 | aaa | Ruptured abdominal aortic aneurysm | 100 | ✅ | ✅ | n/a | 0 |
| gc_294 | acs | Acute coronary syndrome | 100 | ✅ | ✅ | n/a | 0 |
| gc_295 | acute_leukemia | Acute leukaemia | 100 | ✅ | ✅ | n/a | 0 |
| gc_296 | adrenal_crisis | Ruptured abdominal aortic aneurysm | 80 | ❌ | ✅ | n/a | 0 |
| gc_297 | aki | Acute Gastroenteritis | 76 | ❌ | ✅ | n/a | 17 |
| gc_298 | anaphylaxis | Anaphylaxis | 90 | ✅ | ✅ | n/a | 0 |
| gc_299 | anemia_sympt | Symptomatic anaemia | 100 | ✅ | ✅ | n/a | 0 |
| gc_300 | angioedema_acei | ACE-inhibitor / hereditary angioedema | 34 | ✅ | ✅ | n/a | 0 |
| gc_301 | aortic_dissection | Aortic dissection | 100 | ✅ | ✅ | n/a | 17 |
| gc_302 | aortic_stenosis | Aortic stenosis (syncope) | 86 | ✅ | ✅ | n/a | 0 |
| gc_303 | asthma_exac | Asthma exacerbation | 82 | ✅ | ✅ | n/a | 0 |
| gc_304 | atrial_fib | Acute heart failure / pulmonary edema | 100 | ❌ | ✅ | n/a | 0 |
| gc_305 | biliary_colic | Acute pancreatitis | 82 | ❌ | ✅ | n/a | 0 |
| gc_306 | bowel_obstruction | Bowel obstruction | 96 | ✅ | ✅ | n/a | 0 |
| gc_307 | brain_tumour | Brain tumour / mass lesion | 100 | ✅ | ✅ | n/a | 0 |
| gc_308 | cardiogenic_shock | Acute heart failure / pulmonary edema | 100 | ❌ | ✅ | n/a | 0 |
| gc_309 | ckd | Chronic kidney disease | 84 | ✅ | ✅ | n/a | 25 |
| gc_310 | copd_exac_ni | Asthma exacerbation | 82 | ❌ | ✅ | n/a | 0 |
| gc_311 | cord_compression | Spinal cord compression | 78 | ✅ | ✅ | n/a | 0 |
| gc_312 | crystal_arthritis | Cellulitis | 71 | ❌ | ❌ | n/a | 0 |
| gc_313 | decomp_cirrhosis | Hepatic encephalopathy | 100 | ❌ | ✅ | n/a | 0 |
| gc_314 | dic | Disseminated intravascular coagulation | 96 | ✅ | ✅ | n/a | 0 |
| gc_315 | dka | Diabetic ketoacidosis | 100 | ✅ | ✅ | n/a | 25 |
| gc_316 | drug_intox | Drug intoxication / poisoning | 86 | ✅ | ✅ | n/a | 0 |
| gc_317 | dvt | Pulmonary embolism | 100 | ❌ | ✅ | n/a | 0 |
| gc_318 | gbs | Acute Gastroenteritis | 81 | ❌ | ✅ | n/a | 50 |
| gc_319 | gerd_chest | Acute coronary syndrome | 82 | ❌ | ❌ | n/a | 0 |
| gc_320 | glomerulonephritis | Chronic kidney disease | 86 | ❌ | ✅ | n/a | 20 |
| gc_321 | heart_failure | Acute heart failure / pulmonary edema | 100 | ✅ | ✅ | n/a | 0 |
| gc_322 | hepatic_enceph | Hepatic encephalopathy | 100 | ✅ | ✅ | n/a | 0 |
| gc_323 | hhs | Seizure / epilepsy | 68 | ❌ | ✅ | n/a | 0 |
| gc_324 | htn_emergency | Idiopathic intracranial hypertension | 90 | ❌ | ✅ | n/a | 0 |
| gc_325 | hypercalcemia | Hypercalcaemia of malignancy | 68 | ✅ | ✅ | n/a | 0 |
| gc_326 | hyperkalemia | Hyperkalaemia | 74 | ✅ | ✅ | n/a | 0 |
| gc_327 | hyperthyroidism | Thyrotoxicosis (uncomplicated) | 80 | ✅ | ✅ | n/a | 0 |
| gc_328 | hypoglycemia | Intracerebral hemorrhage | 88 | ❌ | ✅ | n/a | 0 |
| gc_329 | hyponatremia | Symptomatic hyponatraemia / SIADH | 78 | ✅ | ✅ | n/a | 0 |
| gc_330 | hypovolemic_shock | Hypovolemic / haemorrhagic shock | 62 | ✅ | ✅ | n/a | 20 |
| gc_331 | ibd_flare | Inflammatory bowel disease flare | 100 | ✅ | ✅ | n/a | 0 |
| gc_332 | ibs | Bowel obstruction | 96 | ❌ | ✅ | n/a | 0 |
| gc_333 | ich | Intracerebral hemorrhage | 100 | ✅ | ✅ | n/a | 0 |
| gc_334 | iih | Idiopathic intracranial hypertension | 100 | ✅ | ✅ | n/a | 0 |
| gc_335 | ild | Interstitial lung disease | 86 | ✅ | ✅ | n/a | 0 |
| gc_336 | ischemic_stroke | Intracerebral hemorrhage | 80 | ❌ | ✅ | n/a | 0 |
| gc_337 | itp | Disseminated intravascular coagulation | 74 | ❌ | ✅ | n/a | 0 |
| gc_338 | lung_cancer | Lung cancer | 100 | ✅ | ✅ | n/a | 0 |
| gc_339 | malignancy_b | Malignancy (B-symptoms) | 100 | ✅ | ✅ | n/a | 0 |
| gc_340 | mesenteric_ischemia | Bowel obstruction | 84 | ❌ | ✅ | n/a | 0 |
| gc_341 | metabolic_enceph | Metabolic encephalopathy | 90 | ✅ | ✅ | n/a | 0 |
| gc_342 | migraine | Migraine | 92 | ✅ | ✅ | n/a | 0 |
| gc_343 | ms | Multiple sclerosis (relapse) | 80 | ✅ | ✅ | n/a | 0 |
| gc_344 | myasthenic_crisis | Aspiration Pneumonia | 62 | ❌ | ✅ | n/a | 0 |
| gc_345 | myeloma | Disseminated (Miliary) Tuberculosis | 56 | ❌ | ❌ | n/a | 0 |
| gc_346 | myxedema | Myxoedema coma | 84 | ✅ | ✅ | n/a | 0 |
| gc_347 | nephrotic | Pulmonary embolism | 100 | ❌ | ❌ | n/a | 0 |
| gc_348 | opioid_od | Opioid overdose | 98 | ✅ | ✅ | n/a | 0 |
| gc_349 | organophosphate | Organophosphate / cholinergic poisoning | 100 | ✅ | ✅ | n/a | 0 |
| gc_350 | pancreatitis | Bowel obstruction | 56 | ❌ | ❌ | n/a | 0 |
| gc_351 | panic | Panic attack / anxiety | 70 | ✅ | ✅ | n/a | 0 |
| gc_352 | pe | Pulmonary embolism | 100 | ✅ | ✅ | n/a | 0 |
| gc_353 | peptic_ulcer | Hypovolemic / haemorrhagic shock | 100 | ❌ | ✅ | n/a | 25 |
| gc_354 | pericarditis | Acute pericarditis | 88 | ✅ | ✅ | n/a | 0 |
| gc_355 | pheo | Acute heart failure / pulmonary edema | 100 | ❌ | ❌ | n/a | 0 |
| gc_356 | pleural_effusion | Pleural effusion | 78 | ✅ | ✅ | n/a | 0 |
| gc_357 | pmr | Polymyalgia rheumatica | 72 | ✅ | ✅ | n/a | 13 |
| gc_358 | pneumothorax | Pulmonary embolism | 100 | ❌ | ✅ | n/a | 0 |
| gc_359 | renal_colic | Renal / ureteric colic | 100 | ✅ | ✅ | n/a | 0 |
| gc_360 | rhabdo | Leptospirosis | 56 | ❌ | ✅ | n/a | 25 |
| gc_361 | rheumatoid | Rheumatoid arthritis | 70 | ✅ | ✅ | n/a | 0 |
| gc_362 | sah | Intracerebral hemorrhage | 76 | ❌ | ✅ | n/a | 0 |
| gc_363 | salicylate_tox | Salicylate toxicity | 88 | ✅ | ✅ | n/a | 40 |
| gc_364 | sarcoidosis | Sarcoidosis | 92 | ✅ | ✅ | n/a | 0 |
| gc_365 | seizure_epilepsy | Seizure / epilepsy | 68 | ✅ | ✅ | n/a | 0 |
| gc_366 | serotonin_nms | Drug intoxication / poisoning | 84 | ❌ | ✅ | n/a | 0 |
| gc_367 | sjs_ten | Stevens-Johnson syndrome / TEN | 78 | ✅ | ✅ | n/a | 0 |
| gc_368 | sle_flare | Systemic vasculitis | 70 | ❌ | ✅ | n/a | 0 |
| gc_369 | subdural | Subdural haematoma | 100 | ✅ | ✅ | n/a | 0 |
| gc_370 | svc_obstruction | Acute heart failure / pulmonary edema | 100 | ❌ | ✅ | n/a | 0 |
| gc_371 | tamponade | Cardiac tamponade | 100 | ✅ | ✅ | n/a | 0 |
| gc_372 | temporal_arteritis | Giant cell (temporal) arteritis | 96 | ✅ | ✅ | n/a | 0 |
| gc_373 | tension_ha | Idiopathic intracranial hypertension | 46 | ❌ | ✅ | n/a | 0 |
| gc_374 | thyroid_storm | Thyroid storm | 88 | ✅ | ✅ | n/a | 0 |
| gc_375 | tia | Transient ischaemic attack | 76 | ✅ | ✅ | n/a | 0 |
| gc_376 | toxic_hepatitis | Drug-induced / toxic hepatitis | 64 | ✅ | ✅ | n/a | 0 |
| gc_377 | ttp_hus | Thrombotic microangiopathy (TTP/HUS) | 100 | ✅ | ✅ | n/a | 20 |
| gc_378 | variceal_bleed | Peptic ulcer disease / upper GI bleed | 66 | ❌ | ✅ | n/a | 33 |
| gc_379 | vasculitis | Systemic vasculitis | 64 | ✅ | ✅ | n/a | 0 |
| gc_380 | vasovagal_syncope | Hypovolemic / haemorrhagic shock | 52 | ❌ | ❌ | n/a | 0 |
| gc_381 | wernicke | Wernicke encephalopathy | 72 | ✅ | ✅ | n/a | 0 |
| gc_382 | ACUTE_BRONCHITIS | Community Acquired Pneumonia (non-severe) | 81 | ❌ | ✅ | ❌ | 0 |
| gc_383 | AMOEBIC_LIVER_ABSCESS | Liver Abscess | 96 | ❌ | ✅ | ✅ | 0 |
| gc_384 | ASPIRATION_PNEUMONIA | Aspiration Pneumonia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_385 | BRAIN_ABSCESS | Septic Shock | 100 | ❌ | ✅ | ✅ | 0 |
| gc_386 | BRONCHIECTASIS_EXACERBATION | Bronchiectasis Exacerbation | 100 | ✅ | ✅ | ❌ | 0 |
| gc_387 | CAP | Community Acquired Pneumonia (non-severe) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_388 | CA_UTI | Septic Shock | 100 | ❌ | ✅ | ✅ | 0 |
| gc_389 | CELLULITIS | Cellulitis | 100 | ✅ | ✅ | ❌ | 0 |
| gc_390 | CHIKUNGUNYA | Chikungunya | 85 | ✅ | ✅ | ❌ | 0 |
| gc_391 | CHOLANGITIS | Acute Cholangitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_392 | CHOLECYSTITIS | Acute Cholecystitis | 62 | ✅ | ✅ | ❌ | 0 |
| gc_393 | CNS_TB | Acute Bacterial Meningitis | 100 | ❌ | ✅ | ✅ | 0 |
| gc_394 | COMPLICATED_UTI | Acute Pyelonephritis | 100 | ❌ | ✅ | ❌ | 0 |
| gc_395 | COPD_EXACERBATION | Acute COPD Exacerbation | 91 | ✅ | ✅ | ❌ | 0 |
| gc_396 | CYSTITIS | Acute Uncomplicated Cystitis | 81 | ✅ | ✅ | ✅ | 0 |
| gc_397 | C_DIFF | Clostridioides difficile Infection | 86 | ✅ | ✅ | ✅ | 0 |
| gc_398 | DENGUE | Dengue Fever | 100 | ✅ | ✅ | ❌ | 0 |
| gc_399 | DEVICE_INFECTION | Device-Related Infection (CIED / Vascular Catheter) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_400 | DIABETIC_FOOT | Diabetic Foot Infection | 100 | ✅ | ✅ | ✅ | 0 |
| gc_401 | DISSEMINATED_TB | Disseminated (Miliary) Tuberculosis | 100 | ✅ | ✅ | ❌ | 0 |
| gc_402 | DYSENTERY | Dysentery (Invasive Bacterial Diarrhea) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_403 | ENCEPHALITIS | Encephalitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_404 | ENTERIC_FEVER | Enteric Fever (Typhoid) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_405 | ERYSIPELAS | Erysipelas | 100 | ✅ | ✅ | ❌ | 0 |
| gc_406 | FEBRILE_NEUTROPENIA | Febrile Neutropenia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_407 | GASTROENTERITIS | Clostridioides difficile Infection | 81 | ❌ | ✅ | ❌ | 50 |
| gc_408 | HAP | Febrile Neutropenia | 75 | ❌ | ✅ | ✅ | 0 |
| gc_409 | IE | Infective Endocarditis | 62 | ✅ | ✅ | ✅ | 0 |
| gc_410 | LEPTOSPIROSIS | Leptospirosis | 100 | ✅ | ✅ | ❌ | 25 |
| gc_411 | LIVER_ABSCESS | Liver Abscess | 100 | ✅ | ✅ | ✅ | 0 |
| gc_412 | LUNG_ABSCESS | Aspiration Pneumonia | 96 | ❌ | ✅ | ✅ | 0 |
| gc_413 | MALARIA | Malaria | 100 | ✅ | ✅ | ✅ | 0 |
| gc_414 | MENINGITIS | Acute Bacterial Meningitis | 100 | ✅ | ✅ | ✅ | 0 |
| gc_415 | MIXED_MALARIA | Mixed Malaria (P. falciparum + P. vivax) | 95 | ✅ | ✅ | ❌ | 0 |
| gc_416 | NECROTIZING_FASCIITIS | Cellulitis | 62 | ❌ | ✅ | ✅ | 0 |
| gc_417 | PHARYNGITIS | Acute Pharyngitis | 96 | ✅ | ✅ | ✅ | 0 |
| gc_418 | PROSTATITIS | Complicated Urinary Tract Infection | 86 | ❌ | ✅ | ✅ | 0 |
| gc_419 | PULMONARY_TB | Pulmonary Tuberculosis | 100 | ✅ | ✅ | ❌ | 0 |
| gc_420 | PUO | Malignancy (B-symptoms) | 100 | ❌ | ❌ | ❌ | 0 |
| gc_421 | PYELONEPHRITIS | Acute Pyelonephritis | 100 | ✅ | ✅ | ❌ | 0 |
| gc_422 | RICKETTSIAL_FEVER | Scrub Typhus | 85 | ✅ | ✅ | ✅ | 0 |
| gc_423 | SBP | Spontaneous Bacterial Peritonitis | 86 | ✅ | ✅ | ✅ | 0 |
| gc_424 | SCRUB_TYPHUS | Scrub Typhus | 100 | ✅ | ✅ | ✅ | 0 |
| gc_425 | SEPSIS | Septic Shock | 100 | ❌ | ✅ | ✅ | 0 |
| gc_426 | SEPTIC_SHOCK | Febrile Neutropenia | 90 | ❌ | ✅ | ✅ | 0 |
| gc_427 | SEVERE_CAP | Severe Community Acquired Pneumonia | 62 | ✅ | ✅ | ✅ | 0 |
| gc_428 | SINUSITIS | Acute Sinusitis (Rhinosinusitis) | 100 | ✅ | ✅ | ✅ | 0 |
| gc_429 | URTI | Febrile Neutropenia | 75 | ❌ | ✅ | ✅ | 0 |
| gc_430 | VAP | Ventilator Associated Pneumonia | 100 | ✅ | ✅ | ✅ | 0 |
| gc_431 | VIRAL_HEPATITIS | Acute Viral Hepatitis | 62 | ✅ | ✅ | n/a | 0 |
| gc_432 | VIRAL_MENINGITIS | Acute Bacterial Meningitis | 96 | ❌ | ✅ | ✅ | 0 |
| gc_433 | aaa | Ruptured abdominal aortic aneurysm | 100 | ✅ | ✅ | n/a | 0 |
| gc_434 | acs | Acute coronary syndrome | 100 | ✅ | ✅ | n/a | 0 |
| gc_435 | acute_leukemia | Acute leukaemia | 92 | ✅ | ✅ | n/a | 0 |
| gc_436 | adrenal_crisis | Adrenal crisis | 74 | ✅ | ✅ | n/a | 0 |
| gc_437 | aki | Acute kidney injury | 68 | ✅ | ✅ | n/a | 20 |
| gc_438 | anaphylaxis | Anaphylaxis | 90 | ✅ | ✅ | n/a | 0 |
| gc_439 | anemia_sympt | Symptomatic anaemia | 100 | ✅ | ✅ | n/a | 0 |
| gc_440 | angioedema_acei | Pulmonary embolism | 56 | ❌ | ✅ | n/a | 0 |
| gc_441 | aortic_dissection | Aortic dissection | 100 | ✅ | ✅ | n/a | 0 |
| gc_442 | aortic_stenosis | Acute heart failure / pulmonary edema | 96 | ❌ | ✅ | n/a | 20 |
| gc_443 | asthma_exac | Asthma exacerbation | 82 | ✅ | ✅ | n/a | 0 |
| gc_444 | atrial_fib | Atrial fibrillation / arrhythmia | 78 | ✅ | ✅ | n/a | 0 |
| gc_445 | biliary_colic | Biliary colic / cholelithiasis | 82 | ✅ | ✅ | n/a | 0 |
| gc_446 | bowel_obstruction | Bowel obstruction | 96 | ✅ | ✅ | n/a | 0 |
| gc_447 | brain_tumour | Brain tumour / mass lesion | 100 | ✅ | ✅ | n/a | 0 |
| gc_448 | cardiogenic_shock | Cardiogenic shock | 100 | ✅ | ✅ | n/a | 20 |
| gc_449 | ckd | Acute heart failure / pulmonary edema | 100 | ❌ | ✅ | n/a | 0 |
| gc_450 | copd_exac_ni | Asthma exacerbation | 82 | ❌ | ✅ | n/a | 0 |
| gc_451 | cord_compression | Spinal cord compression | 78 | ✅ | ✅ | n/a | 0 |
| gc_452 | crystal_arthritis | Cellulitis | 91 | ❌ | ✅ | n/a | 0 |
| gc_453 | decomp_cirrhosis | Decompensated cirrhosis | 88 | ✅ | ✅ | n/a | 0 |
| gc_454 | dic | Disseminated intravascular coagulation | 80 | ✅ | ✅ | n/a | 0 |
| gc_455 | dka | Diabetic ketoacidosis | 84 | ✅ | ✅ | n/a | 0 |
| gc_456 | drug_intox | Drug intoxication / poisoning | 92 | ✅ | ✅ | n/a | 0 |
| gc_457 | dvt | Deep vein thrombosis | 84 | ✅ | ✅ | n/a | 25 |
| gc_458 | gbs | Myasthenic crisis | 64 | ❌ | ❌ | n/a | 0 |
| gc_459 | gerd_chest | Acute coronary syndrome | 64 | ❌ | ✅ | n/a | 0 |
| gc_460 | glomerulonephritis | Migraine | 74 | ❌ | ❌ | n/a | 0 |
| gc_461 | heart_failure | Acute heart failure / pulmonary edema | 100 | ✅ | ✅ | n/a | 0 |
| gc_462 | hepatic_enceph | Hepatic encephalopathy | 100 | ✅ | ✅ | n/a | 0 |
| gc_463 | hhs | Hyperosmolar hyperglycaemic state | 84 | ✅ | ✅ | n/a | 20 |
| gc_464 | htn_emergency | Acute heart failure / pulmonary edema | 100 | ❌ | ❌ | n/a | 0 |
| gc_465 | hypercalcemia | Hypercalcaemia of malignancy | 86 | ✅ | ✅ | n/a | 0 |
| gc_466 | hyperkalemia | Acute Viral Hepatitis | 81 | ❌ | ❌ | n/a | 0 |
| gc_467 | hyperthyroidism | Thyrotoxicosis (uncomplicated) | 80 | ✅ | ✅ | n/a | 0 |
| gc_468 | hypoglycemia | Intracerebral hemorrhage | 88 | ❌ | ✅ | n/a | 0 |
| gc_469 | hyponatremia | Symptomatic hyponatraemia / SIADH | 92 | ✅ | ✅ | n/a | 0 |
| gc_470 | hypovolemic_shock | Variceal bleeding | 96 | ❌ | ✅ | n/a | 0 |
| gc_471 | ibd_flare | Dysentery (Invasive Bacterial Diarrhea) | 96 | ❌ | ✅ | n/a | 0 |
| gc_472 | ibs | Bowel obstruction | 96 | ❌ | ✅ | n/a | 0 |
| gc_473 | ich | Intracerebral hemorrhage | 82 | ✅ | ✅ | n/a | 0 |
| gc_474 | iih | Brain tumour / mass lesion | 90 | ❌ | ✅ | n/a | 0 |
| gc_475 | ild | Interstitial lung disease | 86 | ✅ | ✅ | n/a | 0 |
| gc_476 | ischemic_stroke | Transient ischaemic attack | 70 | ❌ | ✅ | n/a | 0 |
| gc_477 | itp | Disseminated intravascular coagulation | 74 | ❌ | ✅ | n/a | 0 |
| gc_478 | lung_cancer | Lung cancer | 98 | ✅ | ✅ | n/a | 0 |
| gc_479 | malignancy_b | Malignancy (B-symptoms) | 100 | ✅ | ✅ | n/a | 0 |
| gc_480 | mesenteric_ischemia | Acute mesenteric ischemia | 88 | ✅ | ✅ | n/a | 50 |
| gc_481 | metabolic_enceph | Metabolic encephalopathy | 90 | ✅ | ✅ | n/a | 0 |
| gc_482 | migraine | Migraine | 92 | ✅ | ✅ | n/a | 0 |
| gc_483 | ms | Multiple sclerosis (relapse) | 80 | ✅ | ✅ | n/a | 0 |
| gc_484 | myasthenic_crisis | Pulmonary embolism | 100 | ❌ | ❌ | n/a | 0 |
| gc_485 | myeloma | Diabetic ketoacidosis | 68 | ❌ | ✅ | n/a | 0 |
| gc_486 | myxedema | Hepatic encephalopathy | 100 | ❌ | ✅ | n/a | 0 |
| gc_487 | nephrotic | Chronic kidney disease | 74 | ❌ | ✅ | n/a | 0 |
| gc_488 | opioid_od | Opioid overdose | 98 | ✅ | ✅ | n/a | 0 |
| gc_489 | organophosphate | Organophosphate / cholinergic poisoning | 100 | ✅ | ✅ | n/a | 0 |
| gc_490 | pancreatitis | Acute Viral Hepatitis | 75 | ❌ | ✅ | n/a | 0 |
| gc_491 | panic | Panic attack / anxiety | 70 | ✅ | ✅ | n/a | 0 |
| gc_492 | pe | Pulmonary embolism | 100 | ✅ | ✅ | n/a | 0 |
