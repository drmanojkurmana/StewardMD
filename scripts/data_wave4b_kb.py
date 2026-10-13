# Wave 4B KB Reference Articles (20 articles)

KB_ARTICLES = [
    # 1. sur-urolithiasis
    {
        "id": "urolithiasis_and_endourological_management",
        "name": "Urolithiasis, Acute Renal Colic, and Endourological Procedures",
        "aliases": ["Nephrolithiasis", "Renal calculi", "Ureteral colic", "Staghorn calculus", "PCNL"],
        "system": "Urology / Nephrolithiasis",
        "specialty": "Urology / Emergency Medicine",
        "source": "Sabiston Textbook of Surgery 22nd ed / Campbell-Walsh Urology 12th ed",
        "pearls": [
            "Non-contrast helical CT scan of the abdomen and pelvis is the diagnostic gold standard for urolithiasis",
            "Obstructing stone accompanied by fever, hydronephrosis, or urosepsis requires emergency decompression",
            "Distal ureteral stones smaller than 5 mm pass spontaneously in 75% under alpha-blocker expulsive therapy",
            "Struvite stones form in alkaline urine secondary to urease-producing bacteria (Proteus mirabilis)",
            "Staghorn calculi and renal stones exceeding 20 mm are managed with percutaneous nephrolithotomy (PCNL)"
        ],
        "patho": "Urolithiasis results from supersaturation of urine with lithogenic solute ions exceeding crystallization inhibitory thresholds. Calcium oxalate precipitation produces the vast majority of stones. Proteus infections produce urease, hydrolyzing urea to ammonia and carbon dioxide, elevating urine pH and driving magnesium ammonium phosphate struvite deposition into branching pelvicalyceal staghorn calculi.",
        "investigations": [
            "Non-contrast helical CT of kidneys, ureters, and bladder (NCCT KUB)",
            "Urinalysis, urine microscopy for crystals, and urine culture",
            "Serum creatinine, electrolytes, calcium, and uric acid",
            "24-hour urine metabolic evaluation (calcium, oxalate, citrate, uric acid)"
        ],
        "differentials": [
            "Acute appendicitis",
            "Ruptured or leaking abdominal aortic aneurysm",
            "Renal cell carcinoma with hematuria and clot colic",
            "Acute pyelonephritis without obstructing calculi"
        ]
    },

    # 2. sur-renal-tumours
    {
        "id": "renal_cell_carcinoma_and_nephron_sparing_surgery",
        "name": "Renal Cell Carcinoma, Stauffer Syndrome, and Partial Nephrectomy",
        "aliases": ["RCC", "Clear cell renal carcinoma", "Von Hippel-Lindau", "Gerota fascia", "IVC thrombus"],
        "system": "Urologic Oncology",
        "specialty": "Urology / Surgical Oncology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Campbell-Walsh Urology 12th ed",
        "pearls": [
            "Clear cell carcinoma represents 80% of RCC, arising from the proximal convoluted tubule with 3p VHL loss",
            "Classic triad of flank pain, hematuria, and palpable mass occurs in under 10% due to incidental CT detection",
            "Nephron-sparing partial nephrectomy is the gold standard for T1a tumors <= 4 cm, preserving renal reserve",
            "A newly discovered left varicocele failing to decompress when recumbent suggests left renal vein tumor thrombus",
            "Stauffer syndrome features reversible hepatic dysfunction in the absence of direct liver metastases"
        ],
        "patho": "Renal cell carcinoma arises from tubular epithelium, most commonly proximal convoluted tubule cells characterized by lipid- and glycogen-rich clear cytoplasm. VHL tumor suppressor gene inactivation prevents ubiquitin-mediated degradation of hypoxia-inducible factor (HIF-1alpha), driving constitutive overexpression of VEGF and PDGF that stimulates aggressive tumor angiogenesis and local vascular invasion.",
        "investigations": [
            "Triple-phase contrast-enhanced computed tomography of the abdomen and pelvis",
            "Magnetic resonance venography / MRI if caval tumor thrombus is suspected",
            "Chest computed tomography for staging pulmonary metastases",
            "Serum calcium, alkaline phosphatase, liver function panel, and hemoglobin"
        ],
        "differentials": [
            "Renal oncocytoma (benign proximal tubular tumor with central spoke-wheel scar)",
            "Renal angiomyolipoma (tuberous sclerosis association; microscopic fat on CT)",
            "Renal abscess / xanthogranulomatous pyelonephritis",
            "Transitional cell carcinoma of the renal pelvis"
        ]
    },

    # 3. sur-bladder
    {
        "id": "urothelial_carcinoma_of_the_bladder_and_radical_cystectomy",
        "name": "Urothelial Carcinoma of the Bladder, TURBT, and Radical Cystectomy",
        "aliases": ["Bladder cancer", "Transitional cell carcinoma", "TURBT", "Intravesical BCG", "Ileal conduit"],
        "system": "Urologic Oncology",
        "specialty": "Urology / Surgical Oncology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Campbell-Walsh Urology 12th ed",
        "pearls": [
            "Painless gross hematuria throughout the urinary stream represents bladder cancer until proven otherwise",
            "Cigarette smoking is the leading risk factor; aromatic industrial amines (benzidine) also strongly predispose",
            "Presence of detrusor muscularis propria in TURBT specimen is mandatory to determine muscle-invasive status",
            "Non-muscle-invasive high-risk cancer receives transurethral resection followed by intravesical BCG immunotherapy",
            "Muscle-invasive bladder cancer (T2+) requires neoadjuvant cisplatin chemotherapy and radical cystectomy"
        ],
        "patho": "Urothelial carcinoma develops along dual molecular pathways: low-grade papillary tumors driven by FGFR3 and PIK3CA activating mutations with low invasive potential, and high-grade invasive carcinomas driven by TP53 and RB1 tumor suppressor loss with high propensity for detrusor invasion, lymph node spread, and distant visceral metastasis.",
        "investigations": [
            "Flexible cystoscopy with urine cytology",
            "Transurethral resection of bladder tumor (TURBT) with muscularis propria sampling",
            "CT urography of the abdomen and pelvis to evaluate upper tracts and perivesical fat",
            "Chest computed tomography for systemic metastatic staging"
        ],
        "differentials": [
            "Urinary tract infection / hemorrhagic cystitis",
            "Benign prostatic hyperplasia with friable mucosal bleeding",
            "Urolithiasis with mucosal abrasion",
            "Schistosoma haematobium bilharzial cystitis / squamous cell carcinoma"
        ]
    },

    # 4. sur-prostate
    {
        "id": "prostatic_adenocarcinoma_and_benign_prostatic_hyperplasia",
        "name": "Prostatic Adenocarcinoma, Gleason Scoring, and Prostatic Hyperplasia",
        "aliases": ["Prostate cancer", "BPH", "Gleason score", "PSA kinetics", "Radical prostatectomy"],
        "system": "Urologic Oncology / Endocrine Surgery",
        "specialty": "Urology / Surgical Oncology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Campbell-Walsh Urology 12th ed",
        "pearls": [
            "BPH arises in the transition zone causing early obstruction; adenocarcinoma arises in the peripheral zone",
            "Gleason Grade Group system (1 to 5) defines architectural differentiation and guides therapeutic decision-making",
            "PSA velocity and free-to-total PSA ratio (< 15% suspicious) improve specificity over total PSA alone",
            "Active surveillance is the standard of care for low-risk prostate cancer (Gleason 3+3=6, Grade Group 1)",
            "Radical prostatectomy removes the prostate, seminal vesicles, and ampullae with pelvic lymphadenectomy"
        ],
        "patho": "Prostatic adenocarcinoma develops primarily in peripheral zone acinar glands through progressive accumulation of genomic alterations including TMPRSS2-ERG gene fusions and PTEN tumor suppressor deletions. Androgens (dihydrotestosterone) driving androgen receptor signaling sustain tumor cell growth, with skeletal metastases classically producing dense osteoblastic bone remodeling.",
        "investigations": [
            "Serum total PSA, free-to-total PSA ratio, and PSA density",
            "Multiparametric prostate MRI (mpMRI) with PI-RADS scoring",
            "MRI-ultrasound targeted and systematic transperineal or transrectal core biopsy",
            "Technetium-99m bone scintigraphy or PSMA PET-CT for metastatic staging"
        ],
        "differentials": [
            "Benign prostatic hyperplasia (BPH) with prominent nodular enlargement",
            "Acute or chronic bacterial prostatitis",
            "Prostatic infarction with transient severe PSA elevation",
            "High-grade prostatic intraepithelial neoplasia (HGPIN)"
        ]
    },

    # 5. sur-testis
    {
        "id": "testicular_germ_cell_tumors_and_retroperitoneal_lymphadenectomy",
        "name": "Testicular Germ Cell Tumors, Serum Markers, and Inguinal Orchiectomy",
        "aliases": ["Testicular cancer", "Seminoma", "NSGCT", "AFP & hCG", "RPLND"],
        "system": "Urologic Oncology",
        "specialty": "Urology / Surgical Oncology / Medical Oncology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Campbell-Walsh Urology 12th ed",
        "pearls": [
            "Testicular cancer represents the most common solid tumor in young men aged 15 to 35 years",
            "Radical inguinal orchiectomy with high cord ligation is mandatory; transscrotal biopsy is strictly contraindicated",
            "Pure seminomas never produce alpha-fetoprotein (AFP); elevated AFP indicates non-seminomatous elements",
            "Cryptorchidism increases testicular malignancy risk in both the undescended and contralateral descended testicle",
            "Retroperitoneal lymph node dissection (RPLND) is indicated for post-chemotherapy residual NSGCT masses > 1 cm"
        ],
        "patho": "Germ cell tumors originate from germ cell neoplasia in situ (GCNIS) following primordial germ cell developmental arrest, typically bearing isochromosome 12p (i12p). Seminomas maintain primordial germ cell markers (OCT3/4, NANOG, PLAP), while non-seminomas differentiate into embryonal carcinoma (totipotent), yolk sac elements (AFP production), or choriocarcinoma (hCG production).",
        "investigations": [
            "High-frequency scrotal Doppler ultrasound",
            "Serum tumor markers: Alpha-fetoprotein, beta-hCG, and lactate dehydrogenase (LDH)",
            "Contrast-enhanced computed tomography of chest, abdomen, and pelvis",
            "Histopathological examination of inguinal orchiectomy specimen"
        ],
        "differentials": [
            "Epididymo-orchitis with inflammatory inflammatory swelling",
            "Testicular torsion with ischemic necrosis",
            "Hydrocele, spermatocele, or varicocele",
            "Adenomatoid tumor of the epididymis (benign)"
        ]
    },

    # 6. sur-arterial
    {
        "id": "peripheral_arterial_disease_and_acute_limb_ischemia",
        "name": "Peripheral Arterial Disease, Acute Limb Ischemia, and Revascularization",
        "aliases": ["PAD", "Intermittent claudication", "Critical limb ischemia", "The 6 Ps", "Fogarty embolectomy"],
        "system": "Vascular Surgery",
        "specialty": "Vascular Surgery / Emergency Medicine",
        "source": "Sabiston Textbook of Surgery 22nd ed / Rutherford Vascular Surgery 9th ed",
        "pearls": [
            "Ankle-brachial index < 0.9 confirms PAD; < 0.5 indicates severe disease; ankle pressure < 50 mmHg denotes CLTI",
            "The 6 Ps of acute limb ischemia: Pain, Pallor, Poikilothermia, Pulselessness, Paresthesia, and Paralysis",
            "Paresthesia and motor paralysis indicate immediately threatened limb requiring emergency revascularization",
            "Emergency IV heparin bolus must be given immediately upon diagnosing acute limb ischemia to limit propagation",
            "Reperfusion swelling following acute ischemia mandates four-compartment calf fasciotomy to prevent myonecrosis"
        ],
        "patho": "Peripheral arterial disease involves chronic atherosclerotic plaque deposition within arterial intima and media, reducing distal perfusion pressure and flow reserve during muscle activity. Acute limb ischemia results from sudden embolic occlusion or in situ plaque rupture and thrombosis, abruptly halting collateral supply and producing progressive nerve and skeletal muscle ischemia within six hours.",
        "investigations": [
            "Resting and exercise ankle-brachial index (ABI) and toe pressures",
            "Arterial duplex ultrasonography with waveform analysis",
            "Computed tomography angiography (CTA) of the abdominal aorta and lower extremities",
            "Digital subtraction angiography (DSA) with catheter intervention"
        ],
        "differentials": [
            "Neurogenic claudication / lumbar spinal canal stenosis",
            "Deep vein thrombosis with phlegmasia cerulea dolens",
            "Acute compartment syndrome secondary to trauma",
            "Diabetic peripheral sensory neuropathy with foot ulceration"
        ]
    },

    # 7. sur-aneurysm
    {
        "id": "abdominal_aortic_aneurysms_evar_and_carotid_endarterectomy",
        "name": "Abdominal Aortic Aneurysms, Rupture, EVAR, and Carotid Endarterectomy",
        "aliases": ["AAA", "Ruptured aortic aneurysm", "EVAR", "Endoleak", "Carotid endarterectomy"],
        "system": "Vascular Surgery",
        "specialty": "Vascular Surgery / Cardiothoracic Surgery",
        "source": "Sabiston Textbook of Surgery 22nd ed / Rutherford Vascular Surgery 9th ed",
        "pearls": [
            "AAA is defined as aortic diameter >= 3.0 cm; Laplace law explains accelerated rupture risk with increasing size",
            "Elective repair threshold is 5.5 cm in men, 5.0 cm in women, or rapid growth exceeding 5 mm in 6 months",
            "Ruptured AAA triad: sudden severe back/flank pain, pulsatile abdominal mass, and hypotension (complete in 50%)",
            "Type I endoleak involves attachment site seal failure transmitting systemic pressure and requires immediate repair",
            "Carotid endarterectomy significantly reduces stroke risk in symptomatic internal carotid stenosis >= 70%"
        ],
        "patho": "Aortic aneurysms arise from chronic transmural inflammation, elastolysis by matrix metalloproteinases (MMP-2, MMP-9), smooth muscle apoptosis, and depletion of medial elastic lamellae. Mural wall tension increases proportionally to vessel radius (Laplace law), culminating in spontaneous full-thickness mechanical failure and retroperitoneal or intraperitoneal rupture.",
        "investigations": [
            "Abdominal ultrasound screening and serial surveillance",
            "Contrast-enhanced computed tomography angiography (CTA) from chest to groin",
            "Duplex ultrasound of carotid arteries with peak systolic velocity measurement",
            "Preoperative cardiac risk assessment with echocardiography"
        ],
        "differentials": [
            "Renal colic / acute pyelonephritis",
            "Acute diverticulitis or perforated hollow viscus",
            "Acute pancreatitis with retroperitoneal fluid collection",
            "Musculoskeletal lumbar disc herniation or spinal stenosis"
        ]
    },

    # 8. sur-venous
    {
        "id": "chronic_venous_disease_ceap_and_endovenous_ablation",
        "name": "Chronic Venous Disease, CEAP Classification, and Endovenous Thermal Ablation",
        "aliases": ["Varicose veins", "CEAP classification", "Venous stasis ulcer", "Lipodermatosclerosis", "EVLA / RFA"],
        "system": "Vascular Surgery",
        "specialty": "Vascular Surgery / Dermatology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Rutherford Vascular Surgery 9th ed",
        "pearls": [
            "CEAP classification grades venous disease from C0 to C6; C2 is varicose veins and C6 is active venous ulcer",
            "Standing duplex ultrasound is the gold standard diagnostic test; pathological reflux is > 500 ms in superficial veins",
            "Venous stasis ulcers characteristically locate over the medial gaiter region / medial malleolus",
            "Endovenous thermal ablation (RFA or EVLA) with tumescent local anesthesia is first-line for saphenous reflux",
            "Graduated compression therapy (20-30 or 30-40 mmHg) provides essential foundational conservative support"
        ],
        "patho": "Chronic venous insufficiency is driven by valvular incompetence and ambulatory venous hypertension. Retrograde gravitational pooling elevates transmural capillary pressures, causing erythrocyte extravasation, hemosiderin macrophage accumulation, pericapillary fibrin cuffs, leukocyte entrapment, and TGF-beta-mediated progressive subcutaneous fibrosis (lipodermatosclerosis).",
        "investigations": [
            "Duplex ultrasonography of lower extremity venous system in upright standing position",
            "Ankle-brachial index to exclude concomitant arterial disease prior to compression",
            "Deep vein compression ultrasound to exclude acute deep vein thrombosis",
            "Wound culture and edge biopsy if chronic atypical ulceration"
        ],
        "differentials": [
            "Arterial ischemic ulcers (punched-out, painful, distal lateral toes/foot)",
            "Neuropathic diabetic foot ulcers (painless, pressure-bearing plantar surfaces)",
            "Pyoderma gangrenosum (violaceous undermined border, inflammatory bowel association)",
            "Lymphedema (non-pitting, Stemmer sign positive, dorsal foot swelling)"
        ]
    },

    # 9. sur-lymphatic
    {
        "id": "lymphedema_staging_lymphoscintigraphy_and_surgical_restoration",
        "name": "Lymphedema Staging, Lymphoscintigraphy, and Microsurgical Restoration",
        "aliases": ["Lymphedema", "Elephantiasis", "Stemmer sign", "Lymphoscintigraphy", "Lymphovenous anastomosis"],
        "system": "Vascular Surgery / Plastic Surgery",
        "specialty": "Vascular Surgery / Plastic Surgery / Oncology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Rutherford Vascular Surgery 9th ed",
        "pearls": [
            "Stemmer sign (inability to pinch skin at base of second toe) is pathognomonic for lower limb lymphedema",
            "Primary lymphedema includes Milroy disease (congenital), Meige disease (praecox), and lymphedema tarda",
            "Technetium-99m sulfur colloid lymphoscintigraphy is the gold standard diagnostic imaging investigation",
            "Complete decongestive therapy (CDT) is the foundational conservative treatment for all clinical stages",
            "Supermicrosurgical lymphovenous anastomosis (LVA) diverts lymphatic fluid into subdermal venules in early stages"
        ],
        "patho": "Lymphedema arises from congenital hypoplasia or secondary obliteration of lymphatic channels. Interstitial macromolecular protein accumulation elevates oncotic pressure, attracting free water and triggering chronic T-cell-mediated inflammation, fibroblast activation, adipocyte hypertrophy, and irreversible non-pitting collagenous fibrosis of the dermis and subcutis.",
        "investigations": [
            "Intradermal technetium-99m sulfur colloid lymphoscintigraphy",
            "Indocyanine green (ICG) near-infrared fluorescence lymphography",
            "Bioimpedance spectroscopy to detect subclinical extracellular fluid increases",
            "Magnetic resonance lymphangiography (MRL) for lymphatic anatomical visualization"
        ],
        "differentials": [
            "Chronic venous insufficiency with dependent edema (pitting, hemosiderin)",
            "Congestive heart failure / bilateral systemic cardiac edema",
            "Cirrhotic hypoalbuminemia / nephrotic syndrome",
            "Lipidema (bilateral symmetric fat accumulation sparing feet; Stemmer sign negative)"
        ]
    },

    # 10. sur-thoracic
    {
        "id": "thoracic_oncology_lobectomy_and_pleural_empyema",
        "name": "Thoracic Oncology, Anatomic Lobectomy, and Pleural Empyema",
        "aliases": ["Lung cancer", "VATS lobectomy", "Spontaneous pneumothorax", "Pleural empyema", "Mediastinal masses"],
        "system": "Thoracic Surgery",
        "specialty": "Thoracic Surgery / Surgical Oncology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Shields General Thoracic Surgery 8th ed",
        "pearls": [
            "Anatomic lobectomy with systematic mediastinal lymph node dissection is gold standard for stage I-II NSCLC",
            "Preoperative predicted postoperative FEV1 and DLCO > 40% confirm safe physiological pulmonary reserve",
            "Spontaneous pneumothorax with persistent air leak > 3 days or second episode warrants VATS blebectomy & pleurodesis",
            "Pleural empyema progresses from exudative to fibrinopurulent to organizing trapped lung requiring decortication",
            "Anterior mediastinal masses follow the 4 Ts: Thymoma, Teratoma, Thyroid substernal, and Terrible lymphoma"
        ],
        "patho": "Lung carcinomas develop through multistep bronchial epithelial mutagenic alterations driven by tobacco carcinogens and oncogenes (EGFR, KRAS, ALK). Pleural empyema arises from parapneumonic bacterial translocation across the visceral pleura, initiating intense neutrophil influx, fibrin deposition, and intrapleural loculations that consolidate into a rigid collagenous peel trapping the lung.",
        "investigations": [
            "High-resolution chest computed tomography with IV contrast",
            "Whole-body 18F-FDG PET-CT and endobronchial ultrasound (EBUS) nodal staging",
            "Pulmonary function tests with spirometry, DLCO, and arterial blood gas",
            "Diagnostic thoracentesis with pleural fluid pH, glucose, LDH, Gram stain, and culture"
        ],
        "differentials": [
            "Benign granulomatous solitary pulmonary nodule (tuberculoma, histoplasmosis)",
            "Pulmonary hamartoma with pop-corn calcification",
            "Tension pneumothorax vs massive pulmonary embolism",
            "Parapneumonic sterile effusion vs complicated empyema thoracis"
        ]
    },

    # 11. sur-cardiac
    {
        "id": "cardiac_surgery_cabg_valvular_repair_and_cardiopulmonary_bypass",
        "name": "Cardiac Surgery, CABG Indications, Valve Procedures, and Cardiopulmonary Bypass",
        "aliases": ["CABG", "Aortic stenosis", "LIMA-LAD", "Cardiopulmonary bypass", "Mitral valve repair"],
        "system": "Cardiothoracic Surgery",
        "specialty": "Cardiothoracic Surgery / Cardiology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Kirklin/Barratt-Boyes Cardiac Surgery 4th ed",
        "pearls": [
            "CABG is indicated for left main stenosis >= 50%, triple-vessel CAD, or multivessel CAD in diabetic patients",
            "LIMA anastomosed to the LAD is the premier conduit, delivering > 90% ten-year patency and survival benefit",
            "Severe symptomatic aortic stenosis (valve area < 1.0 cm2, mean gradient > 40 mmHg) mandates prompt valve replacement",
            "Cardiopulmonary bypass requires systemic heparinization targeting activated clotting time (ACT) > 480 seconds",
            "Mitral valve repair with an annuloplasty ring achieves superior survival compared to replacement for primary MR"
        ],
        "patho": "Coronary atherosclerosis induces chronic myocardial ischemia and anginal symptoms through progressive luminal compromise. Valvular stenosis produces progressive pressure overload, concentric left ventricular hypertrophy, and diastolic dysfunction, while regurgitation produces volume overload and eccentric chamber remodeling. Cardiopulmonary bypass triggers systemic inflammatory cascades via contact activation of clotting and complement pathways.",
        "investigations": [
            "Coronary angiography with calculation of anatomical SYNTAX score",
            "Transthoracic and transesophageal echocardiography for valve area and ventricular function",
            "Intraoperative activated clotting time (ACT) monitoring",
            "Carotid duplex ultrasound to assess cerebrovascular disease prior to bypass"
        ],
        "differentials": [
            "Non-ischemic dilated cardiomyopathy",
            "Acute aortic dissection with coronary ostial involvement",
            "Hypertrophic obstructive cardiomyopathy (HOCM)",
            "Severe secondary functional mitral regurgitation from ischemic cardiomyopathy"
        ]
    },

    # 12. sur-brain-tumours
    {
        "id": "intracranial_neoplasms_craniotomy_and_glioblastoma",
        "name": "Intracranial Neoplasms, Glioblastoma, Meningioma, and Awake Craniotomy",
        "aliases": ["Brain tumor", "Glioblastoma", "Meningioma", "Awake craniotomy", "Stupp protocol"],
        "system": "Neurosurgery / Neuro-Oncology",
        "specialty": "Neurosurgery / Radiation Oncology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Youmans Neurological Surgery 7th ed",
        "pearls": [
            "Brain metastases are the most common adult intracranial neoplasms, located at the gray-white junction",
            "Glioblastoma features pseudopalisading necrosis and microvascular endothelial proliferation histopathologically",
            "Meningiomas arise from arachnoid cap cells, presenting as extra-axial masses with a characteristic dural tail",
            "Maximal safe resection with neuronavigation and awake mapping provides foundational local disease control",
            "The Stupp protocol combines surgical resection with concurrent temozolomide chemotherapy and radiotherapy"
        ],
        "patho": "Gliomas develop through astrocytic and oligodendroglial dedifferentiation driven by RTK/RAS/PI3K pathway activation and TP53/RB tumor suppressor loss. Glioblastomas proliferate rapidly along white matter tracts (corpus callosum), inducing profound vascular endothelial VEGF secretion and parenchymal edema, with high intracranial pressure culminating in cerebral herniation.",
        "investigations": [
            "Multiplanar contrast-enhanced magnetic resonance imaging (MRI brain with gadolinium)",
            "Magnetic resonance spectroscopy (elevated choline, reduced N-acetylaspartate)",
            "Functional MRI (fMRI) and diffusion tensor tractography for eloquent cortical mapping",
            "Molecular neuropathology (IDH1/2 mutation, 1p/19q codeletion, MGMT promoter methylation)"
        ],
        "differentials": [
            "Cerebral abscess with ring-enhancing capsule and restricted diffusion on DWI",
            "Primary central nervous system lymphoma (dense homogeneous enhancement, periventricular)",
            "Subacute ischemic cerebral infarction with luxury perfusion enhancement",
            "Tumefactive demyelinating lesion / multiple sclerosis with open-ring enhancement"
        ]
    },

    # 13. sur-hydrocephalus
    {
        "id": "hydrocephalus_mechanisms_vp_shunts_and_endoscopic_third_ventriculostomy",
        "name": "Hydrocephalus Dynamics, VP Shunts, and Endoscopic Third Ventriculostomy",
        "aliases": ["Hydrocephalus", "VP shunt", "Normal pressure hydrocephalus", "Adams-Hakim triad", "ETV"],
        "system": "Neurosurgery",
        "specialty": "Neurosurgery / Neurology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Youmans Neurological Surgery 7th ed",
        "pearls": [
            "Cerebrospinal fluid is produced by the choroid plexus at 500 mL/day, maintaining 150 mL circulating volume",
            "Non-communicating hydrocephalus results from intraventricular obstruction (aqueductal stenosis, colloid cyst)",
            "Communicating hydrocephalus results from impaired reabsorption at arachnoid villi post-meningitis or SAH",
            "Normal pressure hydrocephalus features Adams-Hakim triad: magnetic gait apraxia, incontinence, and dementia",
            "Endoscopic third ventriculostomy (ETV) is the preferred treatment for obstructive non-communicating hydrocephalus"
        ],
        "patho": "Hydrocephalus develops when CSF production outpaces outflow or reabsorption, generating an elevated transmantle pressure gradient that progressively dilates the cerebral ventricles. Ventriculomegaly compresses periventricular white matter, stretching corticospinal tract fibers destined for the lower extremities and compromising frontal-subcortical circuits governing executive function and micturition.",
        "investigations": [
            "Non-contrast computed tomography of the brain for rapid ventricular index (Evans ratio)",
            "High-resolution magnetic resonance imaging with CISS / FIESTA sequence for aqueductal patency",
            "Diagnostic large-volume lumbar puncture (tap test) removing 40-50 mL CSF in suspected NPH",
            "Radioisotope cisternography evaluating tracer transit and stasis in basal cisterns"
        ],
        "differentials": [
            "Ex-vacuo ventriculomegaly secondary to generalized cerebral atrophy (Alzheimer disease)",
            "Idiopathic intracranial hypertension (pseudotumor cerebri; ventricles slit-like or normal)",
            "Subdural hygroma or chronic subdural hematoma",
            "Vascular subcortical dementia (Binswanger disease)"
        ]
    },

    # 14. sur-paed-gi
    {
        "id": "paediatric_gastrointestinal_emergencies_pyloromyotomy_and_ladd_procedure",
        "name": "Paediatric Gastrointestinal Emergencies: Pyloric Stenosis, Intussusception, and Ladd Procedure",
        "aliases": ["Pyloric stenosis", "Intussusception", "Malrotation", "Midgut volvulus", "Ladd procedure"],
        "system": "Paediatric Surgery",
        "specialty": "Paediatric Surgery / Paediatric Emergency",
        "source": "Sabiston Textbook of Surgery 22nd ed / Holcomb and Ashcraft's Pediatric Surgery 7th ed",
        "pearls": [
            "Hypertrophic pyloric stenosis presents in infants aged 3-6 weeks with non-bilious projectile vomiting",
            "Loss of gastric HCl causes hypochloremic hypokalemic metabolic alkalosis; resuscitate before surgery",
            "Ileocolic intussusception presents with episodic colic, leg drawing, vomiting, and red currant jelly stool",
            "Air pneumatic reduction is first-line for intussusception in the absence of peritonitis or perforation",
            "Bilious vomiting in a newborn is midgut volvulus until proven otherwise; treated urgently with Ladd procedure"
        ],
        "patho": "Hypertrophic pyloric stenosis involves circular pyloric muscular hypertrophy causing mechanical gastric outlet obstruction. Intussusception entails telescoping of proximal bowel into distal bowel with venous congestion and ischemic mucosal sloughing (red currant jelly). Malrotation leaves a narrow mesenteric pedicle that rotates clockwise on the superior mesenteric artery, acutely strangulating the entire midgut.",
        "investigations": [
            "Abdominal ultrasound: pyloric muscle thickness >= 3 mm and channel length >= 15 mm in HPS",
            "Abdominal ultrasound: transverse target / doughnut sign in intussusception",
            "Upper gastrointestinal contrast series demonstrating corkscrew duodenum in volvulus",
            "Serum electrolytes, blood gas, and chloride quantification"
        ],
        "differentials": [
            "Gastroesophageal reflux disease (GERD) in infancy",
            "Congenital duodenal atresia with double bubble sign on radiograph",
            "Acute infectious viral gastroenteritis with diarrhea",
            "Necrotizing enterocolitis (NEC) with pneumatosis intestinalis in premature infants"
        ]
    },

    # 15. sur-neonatal
    {
        "id": "neonatal_surgical_anomalies_tef_cdh_and_abdominal_wall_defects",
        "name": "Neonatal Surgical Anomalies: Esophageal Atresia, Diaphragmatic Hernia, and Omphalocele",
        "aliases": ["Esophageal atresia", "Tracheoesophageal fistula", "Bochdalek hernia", "Omphalocele", "Gastroschisis"],
        "system": "Paediatric Surgery",
        "specialty": "Paediatric Surgery / Neonatology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Holcomb and Ashcraft's Pediatric Surgery 7th ed",
        "pearls": [
            "Gross type C (proximal atresia with distal TEF) accounts for 85%; drooling and coiled NG tube are diagnostic",
            "Systematic screening for VACTERL association (vertebral, anal, cardiac, TEF, renal, limb) is mandatory",
            "Congenital diaphragmatic hernia (Bochdalek) presents with scaphoid abdomen and severe pulmonary hypoplasia",
            "CDH repair is delayed until cardiopulmonary stabilization and pulmonary hypertension are controlled",
            "Omphalocele is a midline sac-covered defect with high chromosomal and cardiac anomalies (> 50%)"
        ],
        "patho": "Esophageal atresia results from defective foregut septation by the tracheoesophageal folds at 4-6 weeks gestation. Diaphragmatic hernia stems from failed pleuroperitoneal canal closure, allowing visceral herniation that arrests bronchial branching and alveolar development, yielding fatal pulmonary hypoplasia with hyperreactive pulmonary vascular beds.",
        "investigations": [
            "Babygram radiograph with 10 Fr radio-opaque catheter coiled in upper esophageal pouch",
            "Echocardiogram to delineate cardiac anatomy and aortic arch sidedness prior to repair",
            "Arterial blood gas, pre- and post-ductal oxygen saturation monitoring in CDH",
            "Renal ultrasound and spinal ultrasound for VACTERL malformation survey"
        ],
        "differentials": [
            "Congenital lobar emphysema or pulmonary sequestration",
            "Gastroschisis (defect right of cord, no covering sac, low chromosomal association)",
            "Choanal atresia with neonatal respiratory distress",
            "Eventration of the diaphragm"
        ]
    },

    # 16. sur-paed-uro
    {
        "id": "paediatric_urology_hypospadias_cryptorchidism_and_wilms_tumor",
        "name": "Paediatric Urology, Hypospadias, Cryptorchidism, and Wilms Tumor",
        "aliases": ["Hypospadias", "Cryptorchidism", "Posterior urethral valves", "Wilms tumor", "Orchidopexy"],
        "system": "Paediatric Urology",
        "specialty": "Paediatric Surgery / Urology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Campbell-Walsh Urology 12th ed",
        "pearls": [
            "Neonatal circumcision is strictly contraindicated in hypospadias; foreskin is required for reconstruction",
            "Surgical orchidopexy between 6 and 12 months preserves germ cells and reduces malignant degeneration risk",
            "Posterior urethral valves cause lower urinary tract obstruction in male neonates; keyhole sign on ultrasound",
            "Wilms tumor presents as a smooth, firm flank mass that rarely crosses the midline in children aged 2-4 years",
            "Biopsy of Wilms tumor is strictly contraindicated; management combines chemotherapy and radical nephrectomy"
        ],
        "patho": "Hypospadias results from failure of the urethral folds to fuse ventrally over the urethral groove. Cryptorchidism involves mechanical or endocrine failure of gubernacular testicular descent. Wilms tumor arises from persistent metanephric blastema secondary to mutations in WT1 (11p13) or WTX, expanding into a triphasic neoplasm of blastemal, epithelial, and stromal cells.",
        "investigations": [
            "High-resolution renal and bladder ultrasonography",
            "Voiding cystourethrography (VCUG) evaluating posterior urethral valves and vesicoureteral reflux",
            "Diagnostic laparoscopy for impalpable undescended testicle",
            "Abdominal and chest CT for staging and inferior vena cava patency in Wilms tumor"
        ],
        "differentials": [
            "Neuroblastoma (calcified adrenal mass crossing aortic midline, elevated urinary catecholamines)",
            "Hydronephrosis from ureteropelvic junction obstruction",
            "Polycystic kidney disease / multicystic dysplastic kidney (MCDK)",
            "Testicular retractile reflex (normal variant, manual milking into scrotum succeeds)"
        ]
    },

    # 17. sur-transplant
    {
        "id": "organ_transplantation_immunobiology_rejection_and_renal_allograft",
        "name": "Organ Transplantation, Rejection Classification, and Renal Allografts",
        "aliases": ["Renal transplantation", "Hyperacute rejection", "Calcineurin inhibitors", "HLA typing", "Lich-Gregoir"],
        "system": "Transplant Surgery",
        "specialty": "Transplant Surgery / Nephrology / Immunology",
        "source": "Sabiston Textbook of Surgery 22nd ed / Danovitch Handbook of Kidney Transplantation 6th ed",
        "pearls": [
            "Class I HLA (A, B, C) matches CD8 T cells; Class II HLA (DR, DP, DQ) matches CD4 T cells",
            "Hyperacute rejection occurs within minutes due to preformed anti-donor antibodies; prevented by crossmatching",
            "Acute cellular rejection presents with T-cell tubulitis and responds to pulsed intravenous corticosteroids",
            "Triple maintenance immunosuppression combines tacrolimus (calcineurin inhibitor), mycophenolate, and prednisone",
            "Donor renal vessels are anastomosed to the recipient external iliac vessels; ureter implanted via Lich-Gregoir"
        ],
        "patho": "Allograft rejection represents host immune destruction of donor tissue driven by polymorphic MHC disparity. Hyperacute rejection triggers classical complement activation and diffuse microvascular platelet-fibrin thrombosis. Acute cellular rejection involves direct recipient T-cell cytotoxic recognition of donor capillary and tubular cells, while antibody-mediated rejection features donor-specific antibodies and peritubular capillary C4d deposition.",
        "investigations": [
            "Complement-dependent cytotoxicity (CDC) crossmatch and donor-specific antibody (DSA) assay",
            "Percutaneous core biopsy of renal allograft with Banff criteria grading and C4d staining",
            "Doppler ultrasonography of renal allograft evaluating resistive index (RI) and vascular flow",
            "Therapeutic drug monitoring of tacrolimus or cyclosporine trough blood levels"
        ],
        "differentials": [
            "Calcineurin inhibitor acute nephrotoxicity with arteriolar hyalinosis",
            "Delayed graft function / acute tubular necrosis secondary to ischemic injury",
            "BK polyomavirus nephropathy (decoy cells in urine, intranuclear viral inclusions)",
            "Post-transplant urinary tract obstruction or anastomotic urine leak"
        ]
    },

    # 18. sur-uro-congenital
    {
        "id": "congenital_anomalies_of_the_urinary_tract_and_pyeloplasty",
        "name": "Congenital Urinary Tract Anomalies, UPJ Obstruction, and Pyeloplasty",
        "aliases": ["UPJ obstruction", "Duplex system", "Weigert-Meyer law", "ADPKD", "Anderson-Hynes pyeloplasty"],
        "system": "Urology / Congenital Anomalies",
        "specialty": "Urology / Paediatric Surgery",
        "source": "Sabiston Textbook of Surgery 22nd ed / Campbell-Walsh Urology 12th ed",
        "pearls": [
            "Pelviureteric junction obstruction is the most common cause of neonatal hydronephrosis",
            "Dietl crises feature severe episodic flank pain following excessive fluid intake and diuresis",
            "MAG3 diuretic renography with furosemide washout T1/2 > 20 minutes confirms functional obstruction",
            "Anderson-Hynes dismembered pyeloplasty is the gold standard surgical operation for UPJ obstruction",
            "Weigert-Meyer law: upper pole ureter inserts inferomedially (ureterocele); lower pole inserts laterally (reflux)"
        ],
        "patho": "Congenital pelviureteric junction obstruction results from an aperistaltic ureteral segment characterized by abnormal arrangement of circular smooth muscle fibers and collagenous ground substance, or external mechanical compression by a lower pole crossing renal artery. Upstream urinary stasis induces progressive pelvicalyceal dilation and parenchymal pressure atrophy.",
        "investigations": [
            "Serial renal ultrasonography documenting anteroposterior pelvic diameter and caliectasis",
            "99mTc-MAG3 diuretic renography with clearance curve half-time calculation",
            "Voiding cystourethrography (VCUG) to exclude concomitant vesicoureteral reflux",
            "Magnetic resonance urography (MRU) delineating crossing polar vessels and renal anatomy"
        ],
        "differentials": [
            "Non-obstructive physiological pelvic dilation / megacalycosis",
            "Primary obstructive megaureter (distal aperistaltic juxtavesical segment)",
            "Vesicoureteral reflux with secondary tortuous pelviureteric kink",
            "Multicystic dysplastic kidney (MCDK) with non-communicating cysts"
        ]
    },

    # 19. sur-urethra-penis
    {
        "id": "urethral_stricture_urethroplasty_and_penile_carcinoma",
        "name": "Urethral Stricture Disease, Urethroplasty, and Penile Carcinoma",
        "aliases": ["Urethral stricture", "Buccal mucosa graft", "Penile carcinoma", "Penile fracture", "Priapism"],
        "system": "Urology / Reconstructive Surgery",
        "specialty": "Urology / Plastic & Reconstructive Surgery",
        "source": "Sabiston Textbook of Surgery 22nd ed / Campbell-Walsh Urology 12th ed",
        "pearls": [
            "Retrograde urethrography combined with VCUG is the diagnostic gold standard for stricture disease",
            "Anastomotic urethroplasty cures short bulbar strictures (< 2 cm) by complete excision and spatulated repair",
            "Long anterior strictures require substitution urethroplasty using an autologous buccal mucosal graft",
            "Squamous cell carcinoma accounts for 95% of penile cancers; uncircumcised status and HPV are major risks",
            "Penile fracture involves rupture of the tunica albuginea of the corpus cavernosum requiring emergency repair"
        ],
        "patho": "Urethral strictures develop through dense spongiofibrosis within the vascular corpus spongiosum following mucosal disruption and urinary extravasation. Penile carcinoma arises from squamous epithelium of the glans and foreskin, driven by high-risk human papillomavirus (HPV-16/18) oncoproteins E6 and E7 degrading p53 and retinoblastoma tumor suppressor proteins.",
        "investigations": [
            "Bipolar retrograde urethrography (RUG) and voiding cystourethrography (VCUG)",
            "Uroflowmetry demonstrating a plateau-shaped obstructive urinary curve (Qmax < 15 mL/s)",
            "Incisional or punch biopsy of penile lesion confirming squamous histology and depth",
            "Pelvic MRI with artificial erection or contrast CT for corporal invasion and nodal staging"
        ],
        "differentials": [
            "Benign prostatic hyperplasia with outflow obstruction",
            "Urethral calculus impacted in anterior urethra",
            "Genital lichen sclerosus / balanitis xerotica obliterans without malignant change",
            "Syphilitic chancre or chancroid ulceration"
        ]
    },

    # 20. sur-atls
    {
        "id": "advanced_trauma_life_support_primary_survey_and_damage_control",
        "name": "Advanced Trauma Life Support, Primary Survey, and Damage Control Surgery",
        "aliases": ["ATLS", "Primary survey", "FAST exam", "Lethal triad of trauma", "Damage control laparotomy"],
        "system": "Trauma Surgery / Critical Care",
        "specialty": "Trauma Surgery / Emergency Medicine / Critical Care",
        "source": "Sabiston Textbook of Surgery 22nd ed / ATLS 10th ed",
        "pearls": [
            "Primary survey ABCDE: Airway with C-spine, Breathing, Circulation, Disability, Exposure & hypothermia",
            "Definitive airway is indicated for GCS <= 8, severe facial injury, or impending airway compromise",
            "Five hidden bleeding spaces: chest, abdomen, pelvis, retroperitoneum/extremities, and scene floor",
            "Balanced 1:1:1 resuscitation with PRBCs, FFP, and platelets plus early tranexamic acid within 3 hours",
            "Lethal triad of hypothermia, acidosis, and coagulopathy mandates abbreviated damage control surgery"
        ],
        "patho": "Severe trauma triggers catastrophic tissue injury, hemorrhagic hypovolemia, and endothelial disruption. The lethal triad self-amplifies: core hypothermia (< 35 C) impairs platelet aggregation and clotting enzymes, anaerobic tissue hypoperfusion produces lactic acidosis (pH < 7.2) that deactivates coagulation factors, and consumed clotting factors precipitate refractory microvascular coagulopathy.",
        "investigations": [
            "Extended Focused Assessment with Sonography for Trauma (eFAST: 4 abdominal spaces + bilateral pleura)",
            "Portable trauma series radiographs: supine chest radiograph and anteroposterior pelvic radiograph",
            "Arterial blood gas for lactate, base deficit, and ionized calcium",
            "Thromboelastography (TEG) or rotational thromboelastometry (ROTEM) for goal-directed hemostasis"
        ],
        "differentials": [
            "Obstructive shock: tension pneumothorax vs pericardial tamponade",
            "Neurogenic shock (cervical cord injury: hypotension with bradycardia and warm extremities)",
            "Septic shock in delayed presentation",
            "Cardiogenic shock from blunt cardiac contusion"
        ]
    }
]
