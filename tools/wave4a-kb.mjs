/**
 * Wave 4A Knowledge Library Reference Articles (KB v2)
 * 20 Paired Clinical Reference Articles for Sabiston Surgery Part 1
 */

export const wave4aKbArticles = [
  // 1. sur-infections
  {
    id: "surgical_site_infections_and_necrotizing_fasciitis",
    name: "Surgical Site Infections, Necrotizing Soft-Tissue Infections, and Antimicrobial Prophylaxis",
    aliases: ["SSI", "Necrotizing fasciitis", "LRINEC score", "Hospital-acquired surgical infection", "Fournier gangrene"],
    system: "General Surgery / Surgical Infections",
    specialty: "General Surgery / Critical Care / Infectious Disease",
    source: "Sabiston Textbook of Surgery 22nd ed / CDC Surgical Site Infection Guidelines",
    pearls: [
      "Surgical site infections are classified into superficial incisional, deep incisional, and organ/space infections",
      "Preoperative antimicrobial prophylaxis must be administered within 60 minutes prior to surgical incision",
      "Necrotizing fasciitis presents with severe pain out of proportion to physical exam findings and dishwater exudate",
      "A LRINEC score >= 6 suggests necrotizing soft-tissue infection; >= 8 carries > 90% positive predictive value",
      "Immediate emergency radical surgical debridement down to bleeding tissue is mandatory; second look within 24 hours"
    ],
    patho: "Surgical site infections result from microbial contamination during operation exceeding host defense thresholds. Necrotizing soft-tissue infections involve rapid bacterial proliferation along deep fascial planes, producing endarteritis, microvascular thrombosis, liquefactive tissue necrosis, and systemic toxin-mediated septic shock.",
    investigations: [
      "Laboratory Risk Indicator for Necrotizing Fasciitis (LRINEC) score calculation",
      "Complete blood count with differential and serial serum lactate",
      "Immediate operative exploration with frozen-section fascial biopsy",
      "Blood cultures and intraoperative deep tissue aerobic and anaerobic Gram stain"
    ],
    differentials: [
      "Non-necrotizing severe cellulitis / erysipelas",
      "Clostridial gas gangrene (myonecrosis)",
      "Pyoderma gangrenosum",
      "Deep vein thrombosis with phlegmasia cerulea dolens"
    ]
  },

  // 2. sur-skin
  {
    id: "cutaneous_malignancies_melanoma_and_non_melanoma",
    name: "Cutaneous Malignancies: Melanoma Staging, Mohs Surgery, and Margins",
    aliases: ["Malignant melanoma", "Breslow thickness", "Sentinel lymph node biopsy", "Basal cell carcinoma", "Squamous cell carcinoma"],
    system: "Surgical Oncology / Plastic Surgery",
    specialty: "Surgical Oncology / Dermatology / Plastic Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / NCCN Cutaneous Melanoma Guidelines",
    pearls: [
      "Breslow thickness measured microscopically in millimeters is the primary prognostic factor in cutaneous melanoma",
      "Excision margins: 0.5-1 cm for in situ, 1 cm for <= 1 mm, 1-2 cm for 1.01-2 mm, and 2 cm for > 2 mm depth",
      "Sentinel lymph node biopsy (SLNB) is indicated for clinically N0 melanomas > 1.0 mm or 0.8-1.0 mm with ulceration",
      "Basal cell carcinoma displays peripheral palisading and pearly rolled borders with arborizing telangiectasias",
      "Mohs micrographic surgery evaluates 100% of peripheral and deep margins with maximal normal tissue conservation"
    ],
    patho: "Melanoma arises from malignant transformation of melanocytes driven by ultraviolet radiation damage and activating BRAF, NRAS, or KIT mutations. Tumor thickness correlates with lymphatic invasion risk. Non-melanoma skin cancers develop from basal keratinocytes (BCC) or stratified squamous cells (SCC).",
    investigations: [
      "Excisional biopsy with 1 to 3 mm narrow margins for suspected melanoma",
      "Histopathological measurement of Breslow depth, ulceration, and mitotic rate",
      "Sentinel lymph node biopsy using technetium-99m and vital blue dye",
      "Molecular testing for BRAF V600E/K mutations in regional or metastatic disease"
    ],
    differentials: [
      "Dysplastic / atypical melanocytic nevus",
      "Pigmented basal cell carcinoma",
      "Seborrheic keratosis",
      "Pyogenic granuloma"
    ]
  },

  // 3. sur-burns
  {
    id: "burn_resuscitation_inhalation_injury_and_escharotomy",
    name: "Burn Resuscitation, Inhalation Injury, Escharotomy, and Wound Excision",
    aliases: ["Parkland formula", "Rule of Nines", "Circumferential burn", "Smoke inhalation injury", "Full-thickness burn"],
    system: "Trauma / Critical Care / Plastic Surgery",
    specialty: "Burns Surgery / Critical Care / Trauma Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / American Burn Association Practice Guidelines",
    pearls: [
      "Burn fluid resuscitation is calculated using the Parkland formula: 4 mL x kg x %TBSA burn of lactated Ringer solution",
      "50% of the calculated volume is infused during the first 8 hours post-injury; titrate to urine output of 0.5 mL/kg/hr",
      "Circumferential full-thickness burns require immediate bedside escharotomy if compartmental pressures exceed 30 mmHg",
      "Facial burns, singed nasal hairs, carbonaceous sputum, and stridor mandate proactive early endotracheal intubation",
      "Full-thickness burns appear leathery, thrombosed, white, and anesthetic, requiring tangential excision and grafting"
    ],
    patho: "Thermal trauma disrupts capillary membrane integrity, precipitating massive systemic third-space plasma extravasation, intravascular volume depletion, and burn shock. Rigid non-distensible full-thickness eschar combined with progressive sub-eschar edema produces neurovascular and thoracic compartment syndromes.",
    investigations: [
      "Total body surface area (TBSA) calculation utilizing the Lund-Browder chart",
      "Serial hourly urine output monitoring via indwelling bladder catheter",
      "Arterial blood gas with co-oximetry measuring carboxyhemoglobin and lactate",
      "Fiberoptic bronchoscopy for direct visualization of subglottic inhalation injury"
    ],
    differentials: [
      "Toxic epidermal necrolysis (TEN / Lyell syndrome)",
      "Staphylococcal scalded skin syndrome",
      "Deep frostbite",
      "Chemical caustic dermal injury"
    ]
  },

  // 4. sur-head-injury
  {
    module: "sur-head-injury",
    id: "traumatic_brain_injury_hematomas_and_icp",
    name: "Traumatic Brain Injury, Intracranial Hematomas, and Elevated ICP",
    aliases: ["Epidural hematoma", "Subdural hematoma", "Monro-Kellie doctrine", "Uncal herniation", "Cerebral perfusion pressure"],
    system: "Neurosurgery / Trauma Surgery",
    specialty: "Neurosurgery / Critical Care / Trauma Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / Brain Trauma Foundation Guidelines",
    pearls: [
      "Epidural hematoma arises from middle meningeal artery rupture at the pterion, appearing as a biconvex lenticular CT mass",
      "Classic lucid interval in epidural hematoma is followed by rapid ipsilateral blown pupil and contralateral hemiparesis",
      "Subdural hematoma results from tearing of bridging cortical veins, appearing as a crescentic mass crossing suture lines",
      "The Monro-Kellie doctrine dictates that total intracranial volume of brain, CSF, and blood remains constant",
      "Uncal herniation compresses cranial nerve III (blown pupil) and ipsilateral peduncle; Kernohan notch causes ipsilateral hemiparesis"
    ],
    patho: "Traumatic skull fractures or rotational deceleration forces rupture intracranial vessels. Hematoma expansion exhausts compensatory CSF and venous buffering mechanisms, precipitating exponential increases in intracranial pressure, decreased cerebral perfusion pressure (CPP = MAP - ICP), and brainstem herniation.",
    investigations: [
      "Emergency non-contrast cranial CT scan",
      "Invasive intracranial pressure (ICP) monitoring via external ventricular drain",
      "Continuous arterial blood pressure monitoring for cerebral perfusion pressure maintenance",
      "Serial Glasgow Coma Scale (GCS) and bilateral pupillary light reflex assessments"
    ],
    differentials: [
      "Acute ischemic stroke",
      "Spontaneous intracranial hemorrhage (aneurysm / AVM)",
      "Diffuse axonal injury (DAI)",
      "Severe post-traumatic cerebral edema"
    ]
  },

  // 5. sur-chest-trauma
  {
    id: "thoracic_trauma_tension_pneumothorax_and_tamponade",
    name: "Thoracic Trauma: Tension Pneumothorax, Hemothorax, Tamponade, and Flail Chest",
    aliases: ["Tension pneumothorax", "Beck triad", "Massive hemothorax", "Cardiac tamponade", "Flail chest"],
    system: "Trauma Surgery / Cardiothoracic Surgery",
    specialty: "Trauma Surgery / Thoracic Surgery / Critical Care",
    source: "Sabiston Textbook of Surgery 22nd ed / ATLS 10th edition",
    pearls: [
      "Tension pneumothorax causes obstructive shock by kinking the vena cava; immediate needle decompression precedes radiography",
      "Massive hemothorax (> 1,500 mL or > 200 mL/hr for 2-4 hours) represents an absolute indication for emergency thoracotomy",
      "Beck triad of cardiac tamponade comprises hypotension, jugular venous distension, and muffled heart sounds",
      "Pulsus paradoxus is an inspiratory decline in systolic blood pressure exceeding 10 mmHg",
      "Flail chest requires >= 3 contiguous ribs fractured in >= 2 places, with underlying contusion driving severe hypoxemia"
    ],
    patho: "Thoracic trauma impairs gas exchange and cardiac preload. One-way pleural air accumulation creates tension pneumothorax, kinking the inferior vena cava and causing obstructive arrest. Hemopericardium restricts diastolic filling, while flail chest with underlying pulmonary contusion creates ventilation-perfusion mismatch.",
    investigations: [
      "Extended Focused Assessment with Sonography for Trauma (eFAST) for pericardial/pleural fluid",
      "Portable anteroposterior chest radiograph following initial airway/breathing stabilization",
      "Serial chest tube output recording and volume quantification",
      "Contrast-enhanced CT of thorax to evaluate aortic disruption and pulmonary contusion"
    ],
    differentials: [
      "Traumatic aortic disruption / transection",
      "Simple pneumothorax or simple hemothorax",
      "Acute myocardial infarction in trauma",
      "Tracheobronchial tree disruption"
    ]
  },

  // 6. sur-oral
  {
    id: "oral_cavity_squamous_cell_carcinoma",
    name: "Oral Cavity Squamous Cell Carcinoma, Premalignant Lesions, and Neck Dissection",
    aliases: ["Oral cancer", "Leukoplakia", "Erythroplakia", "Depth of invasion", "Supraomohyoid neck dissection"],
    system: "Surgical Oncology / Head and Neck Surgery",
    specialty: "Surgical Oncology / Otolaryngology / Oral and Maxillofacial Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / AJCC Cancer Staging Manual 8th ed",
    pearls: [
      "Over 90% of oral malignancies are squamous cell carcinomas, most commonly on lateral tongue and floor of mouth",
      "Erythroplakia carries a 90% risk of harboring severe dysplasia or invasive carcinoma on microscopic biopsy",
      "AJCC 8th edition incorporates depth of invasion (DOI) into T-staging: each 5 mm increment upstages the tumor",
      "Clear microscopic surgical margins of at least 5 mm are required; 1.0 to 1.5 cm gross margins are resected",
      "Elective supraomohyoid neck dissection (levels I-III) is indicated for clinically N0 necks with DOI > 3 to 4 mm"
    ],
    patho: "Chronic exposure to tobacco, alcohol, and betel quid induces field cancerization across oral mucosa. Genomic alterations include TP53 inactivation and p16 loss. Malignant keratinocytes invade beyond the basement membrane; microscopic depth of invasion strongly correlates with occult cervical nodal metastasis.",
    investigations: [
      "Incisional or punch biopsy of representative non-necrotic mucosal lesion",
      "Contrast-enhanced CT or MRI of head and neck to evaluate cortical bone invasion and nodes",
      "Complete panendoscopy (pharyngoscopy, laryngoscopy, esophagoscopy) to rule out second primaries",
      "Orthopantomogram (OPG) or dental CT for mandibular cortical involvement"
    ],
    differentials: [
      "Oral lichen planus (erosive form)",
      "Traumatic ulcerative granuloma with stromal eosinophilia (TUGSE)",
      "Minor salivary gland adenocarcinoma",
      "Aphthous stomatitis"
    ]
  },

  // 7. sur-salivary
  {
    id: "salivary_gland_neoplasms_and_parotidectomy",
    name: "Salivary Gland Neoplasms: Pleomorphic Adenoma, Parotidectomy, and Facial Nerve",
    aliases: ["Pleomorphic adenoma", "Warthin tumor", "Mucoepidermoid carcinoma", "Adenoid cystic carcinoma", "Frey syndrome"],
    system: "Head and Neck Surgery / Surgical Oncology",
    specialty: "Otolaryngology / Surgical Oncology / General Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / Blumgart's Surgery",
    pearls: [
      "Rule of 80: 80% of salivary tumors are parotid, 80% of parotid tumors are benign, and 80% are pleomorphic adenomas",
      "Pleomorphic adenoma requires formal superficial parotidectomy with nerve dissection; enucleation causes high recurrence",
      "Landmarks to locate the facial nerve trunk: tragal pointer, tympanomastoid suture, and posterior belly of digastric",
      "Adenoid cystic carcinoma exhibits pathognomonic perineural invasion along cranial nerves and late lung metastases",
      "Frey syndrome (gustatory sweating) results from aberrant reinnervation of sweat glands by auriculotemporal parasympathetics"
    ],
    patho: "Salivary neoplasms originate from ductal or acinar epithelial-myoepithelial units. Pleomorphic adenomas exhibit mixed epithelial and chondromyxoid stroma with microscopic capsular pseudopodia. Malignant tumors invade adjacent facial nerve branches, causing perineural dissemination and local destruction.",
    investigations: [
      "Ultrasound-guided fine-needle aspiration biopsy (FNAB) of salivary mass",
      "Contrast-enhanced MRI of neck/parotid to evaluate deep lobe extension and nerve involvement",
      "Minor starch-iodine test for post-parotidectomy gustatory sweating (Frey syndrome)",
      "Chest CT to rule out late pulmonary metastases in adenoid cystic carcinoma"
    ],
    differentials: [
      "Warthin tumor (papillary cystadenoma lymphomatosum)",
      "Intraparotid lymphadenopathy / lymphoma",
      "Branchial cleft cyst (first cleft)",
      "Chronic sialadenitis with sialolithiasis"
    ]
  },

  // 8. sur-neck
  {
    id: "congenital_neck_masses_and_cervical_lymphadenopathy",
    name: "Congenital Neck Masses: Thyroglossal Duct Cysts, Branchial Cleft Anomalies, and Nodal Staging",
    aliases: ["Thyroglossal duct cyst", "Sistrunk procedure", "Branchial cleft cyst", "Radical neck dissection", "Cervical lymph node levels"],
    system: "Head and Neck Surgery / Pediatric Surgery",
    specialty: "Otolaryngology / General Surgery / Pediatric Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / Cummings Otolaryngology",
    pearls: [
      "In adults > 40 years, an asymptomatic lateral neck mass is metastatic squamous cell carcinoma until proven otherwise",
      "Thyroglossal duct cyst presents as a midline mass elevating on tongue protrusion; requires Sistrunk hyoid resection",
      "Second branchial cleft anomalies account for 95% of cases, located along the anterior border of the sternocleidomastoid",
      "Open incisional biopsy of an undiagnosed adult neck mass is contraindicated due to tumor seeding and compromised cure",
      "Radical neck dissection resects levels I-V, spinal accessory nerve, internal jugular vein, and sternocleidomastoid"
    ],
    patho: "Congenital neck masses result from failure of obliteration of embryonic branchial clefts or the thyroglossal descent tract. In adults, metastatic carcinoma deposits within cervical lymph node sinuses; primary mucosal origins in the oropharynx, larynx, or hypopharynx must be identified.",
    investigations: [
      "Ultrasound of neck with fine-needle aspiration biopsy (FNAB)",
      "Contrast-enhanced CT of neck and skull base to delineate cystic wall and internal fistulae",
      "Thyroid ultrasound to confirm orthotopic thyroid presence prior to thyroglossal cyst excision",
      "Mucosal panendoscopy and tonsillectomy/biopsy for occult unknown primary metastatic neck nodes"
    ],
    differentials: [
      "Cervical tuberculous lymphadenitis (scrofula)",
      "Dermoid and epidermoid cysts",
      "Carotid body tumor (paraganglioma / chemodectoma)",
      "Cystic hygroma (lymphangioma)"
    ]
  },

  // 9. sur-parathyroid-adrenal
  {
    id: "primary_hyperparathyroidism_and_pheochromocytoma",
    name: "Surgical Endocrinology: Primary Hyperparathyroidism, Pheochromocytoma, and Adrenalectomy",
    aliases: ["Parathyroid adenoma", "Minimally invasive parathyroidectomy", "Miami criterion", "Conn syndrome", "Phenoxybenzamine"],
    system: "Endocrine Surgery / Surgical Oncology",
    specialty: "Endocrine Surgery / Surgical Oncology / Urology",
    source: "Sabiston Textbook of Surgery 22nd ed / AAES Guidelines",
    pearls: [
      "Primary hyperparathyroidism is caused by a single adenoma in 85% of cases, producing hypercalcemia and hypophosphatemia",
      "The Miami criterion confirms surgical cure: a >= 50% drop in serum PTH 10 minutes following adenoma excision",
      "Pheochromocytoma mandates alpha-blockade (phenoxybenzamine) for 10-14 days prior to surgery; beta-blockers follow alpha blockade",
      "Laparoscopic adrenalectomy is indicated for benign functional tumors < 6 cm (aldosteronoma, pheochromocytoma)",
      "Open transabdominal adrenalectomy is mandatory for suspected adrenocortical carcinoma to prevent capsular violation"
    ],
    patho: "Autonomous parathyroid adenoma secretion of PTH increases osteoclast bone resorption and renal tubular calcium reabsorption. Pheochromocytoma produces excessive catecholamines from chromaffin cells, inducing paroxysmal hypertension, peripheral vasoconstriction, and contracted plasma volume.",
    investigations: [
      "Serum intact PTH, ionized calcium, phosphate, and 24-hour urinary calcium excretion",
      "Technetium-99m sestamibi SPECT scintigraphy and high-resolution cervical ultrasound",
      "24-hour urinary fractionated metanephrines and plasma free metanephrines",
      "Adrenal-protocol contrast-enhanced CT measuring Hounsfield units (unenhanced HU < 10 indicates benign adenoma)"
    ],
    differentials: [
      "Familial hypocalciuric hypercalcemia (FHH; urinary calcium clearance < 0.01)",
      "Hypercalcemia of malignancy (PTHrP mediated)",
      "Secondary / tertiary hyperparathyroidism of renal failure",
      "Adrenal incidentaloma (non-functioning myelolipoma / cyst)"
    ]
  },

  // 10. sur-oesophagus
  {
    id: "esophageal_motility_gerd_and_esophagectomy",
    name: "Esophageal Disease: Achalasia, Nissen Fundoplication, and Esophagectomy",
    aliases: ["Heller myotomy", "Achalasia", "GERD", "Barrett esophagus", "Ivor Lewis esophagectomy"],
    system: "Upper Gastrointestinal Surgery / Thoracic Surgery",
    specialty: "Upper GI Surgery / Thoracic Surgery / General Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / SAGES Antireflux Guidelines",
    pearls: [
      "Achalasia is characterized by aperistalsis and incomplete LES relaxation due to loss of myenteric inhibitory neurons",
      "Laparoscopic Heller myotomy divides esophageal muscle down to bulging mucosa, coupled with a partial Dor or Toupet wrap",
      "Nissen fundoplication constructs a 360-degree loose 2 cm wrap over a large bougie following crural repair",
      "Barrett esophagus is specialized intestinal metaplasia with goblet cells, carrying elevated risk for adenocarcinoma",
      "Ivor Lewis esophagectomy combines laparotomy (gastric conduit) and right thoracotomy (intrathoracic anastomosis)"
    ],
    patho: "Loss of nitric oxide-synthesizing ganglionic neurons in the Auerbach plexus produces achalasia. Chronic acid and bile reflux injures squamous mucosa, triggering columnar glandular metaplasia (Barrett esophagus) that progresses through dysplasia to invasive adenocarcinoma.",
    investigations: [
      "High-resolution esophageal manometry (gold standard for motility disorders)",
      "Barium swallow esophagram displaying classic bird-beak tapering at GE junction",
      "Upper endoscopy (EGD) with four-quadrant Seattle protocol biopsies for Barrett esophagus",
      "24-hour ambulatory esophageal pH-impedance monitoring for GERD quantification"
    ],
    differentials: [
      "Pseudoachalasia (GE junction adenocarcinoma obstructing lumen)",
      "Diffuse esophageal spasm (jackhammer esophagus)",
      "Eosinophilic esophagitis",
      "Systemic sclerosis (scleroderma esophagus with absent peristalsis and hypotensive LES)"
    ]
  },

  // 11. sur-liver
  {
    id: "hepatic_resection_and_hepatocellular_carcinoma",
    name: "Hepatic Resection, Couinaud Anatomy, and Hepatocellular Carcinoma",
    aliases: ["HCC", "Couinaud liver segments", "Milan criteria", "Hepatic adenoma", "Focal nodular hyperplasia"],
    system: "Hepatobiliary Surgery / Surgical Oncology",
    specialty: "HPB Surgery / Transplant Surgery / Surgical Oncology",
    source: "Sabiston Textbook of Surgery 22nd ed / Blumgart's Surgery",
    pearls: [
      "Couinaud anatomy divides the liver into eight independent segments, each with autonomous portal pedicle supply",
      "The Cantlie line extends from gallbladder fossa to IVC, dividing functional right and left hemilivers",
      "Focal nodular hyperplasia displays a central stellate scar with delayed enhancement, requiring no surgical resection",
      "Hepatic adenomas carry hemorrhage and malignant risks; resect if > 5 cm, male patient, or beta-catenin mutated",
      "Milan criteria for liver transplant in HCC: 1 lesion <= 5 cm or up to 3 lesions <= 3 cm without vascular invasion"
    ],
    patho: "Cirrhosis secondary to hepatitis B, C, or NASH drives chronic inflammation, regenerative nodules, and dysplastic malignant transformation into hepatocellular carcinoma. Tumors derive arterial blood supply from hepatic artery branches, showing early arterial enhancement and delayed venous washout.",
    investigations: [
      "Triphasic contrast-enhanced liver CT or MRI (LI-RADS staging)",
      "Serum alpha-fetoprotein (AFP) quantitative tumor marker assay",
      "Child-Pugh and MELD-Na score assessment for underlying hepatic functional reserve",
      "Indocyanine green (ICG) clearance testing to predict post-hepatectomy liver failure"
    ],
    differentials: [
      "Intrahepatic cholangiocarcinoma",
      "Colorectal cancer liver metastases",
      "Hepatic cavernous hemangioma",
      "Amebic or pyogenic liver abscess"
    ]
  },

  // 12. sur-portal-hypertension
  {
    id: "portal_hypertension_and_variceal_hemorrhage",
    name: "Portal Hypertension, Acute Variceal Hemorrhage, and Portosystemic Shunts",
    aliases: ["Esophageal varices", "HVPG", "TIPS", "Sengstaken-Blakemore tube", "Endoscopic variceal ligation"],
    system: "Hepatobiliary Surgery / Vascular Surgery",
    specialty: "HPB Surgery / Gastroenterology / Critical Care",
    source: "Sabiston Textbook of Surgery 22nd ed / AASLD Guidelines",
    pearls: [
      "Portal hypertension is defined as HVPG > 5 mmHg; variceal bleeding risk becomes significant when HVPG exceeds 10-12 mmHg",
      "Acute variceal hemorrhage resuscitation mandates restrictive transfusion targeting hemoglobin 7 to 8 g/dL",
      "Immediate intravenous octreotide splanchnic vasoconstriction and ceftriaxone antibiotic prophylaxis improve survival",
      "Sengstaken-Blakemore balloon tamponade provides a 24-hour temporary bridge for refractory torrential bleeding",
      "TIPS deploys an expandable covered stent between a portal vein branch and hepatic vein, decompressing portal pressure"
    ],
    patho: "Cirrhotic architectural distortion, regenerative nodules, and sinusoidal endothelial dysfunction elevate intrahepatic vascular resistance. Elevated portal pressures dilate submucosal collateral portosystemic vessels at the GE junction, culminating in wall tension rupture and torrential hemorrhage.",
    investigations: [
      "Emergency diagnostic and therapeutic esophagogastroduodenoscopy (EGD)",
      "Hepatic venous pressure gradient (HVPG) catheter measurement",
      "Abdominal Doppler ultrasound evaluating portal vein patency and flow direction",
      "Coagulation profile, thromboelastography (TEG), and platelet count"
    ],
    differentials: [
      "Peptic ulcer hemorrhage in cirrhotic patient",
      "Gastric antral vascular ectasia (GAVE / watermelon stomach)",
      "Portal hypertensive gastropathy (mosaic pattern)",
      "Mallory-Weiss mucosal tear"
    ]
  },

  // 13. sur-bile-duct
  {
    id: "biliary_tract_obstruction_and_bile_duct_injury",
    name: "Choledocholithiasis, Cholangitis, and Strasberg Bile Duct Injury Classification",
    aliases: ["Acute cholangitis", "Charcot triad", "Reynolds pentad", "Strasberg classification", "Klatskin tumor"],
    system: "Hepatobiliary Surgery / Emergency Surgery",
    specialty: "HPB Surgery / General Surgery / Gastroenterology",
    source: "Sabiston Textbook of Surgery 22nd ed / Tokyo Guidelines",
    pearls: [
      "Choledocholithiasis presents with fluctuating obstructive jaundice, biliary colic, and elevated alkaline phosphatase",
      "Charcot triad of cholangitis (pain, jaundice, fever) progresses to Reynolds pentad with shock and altered mental status",
      "Acute suppurative cholangitis mandates emergency biliary decompression via ERCP or PTBD within hours",
      "Strasberg type E bile duct injury involves circumferential CBD transection, requiring Roux-en-Y hepaticojejunostomy",
      "Bismuth-Corlette classifies perihilar cholangiocarcinoma (Klatskin tumor) based on hepatic confluence duct involvement"
    ],
    patho: "Calculous or neoplastic ductal occlusion produces upstream stasis, biliary hyperpressure, and rapid bacterial translocation across hepatocyte canaliculi into hepatic sinusoids. Iatrogenic duct injuries arise from mistaking the common bile duct for the cystic duct during laparoscopy.",
    investigations: [
      "Magnetic resonance cholangiopancreatography (MRCP) for non-invasive ductal mapping",
      "Endoscopic retrograde cholangiopancreatography (ERCP) for diagnostic and therapeutic extraction",
      "Serum total and conjugated bilirubin, alkaline phosphatase, and GGT levels",
      "Blood cultures to identify enteric bacteremia in acute cholangitis"
    ],
    differentials: [
      "Acute cholecystitis with Mirizzi syndrome",
      "Pancreatic head adenocarcinoma compressing intrapancreatic CBD",
      "Primary sclerosing cholangitis (beaded appearance)",
      "Sphincter of Oddi dysfunction"
    ]
  },

  // 14. sur-pancreas
  {
    id: "acute_pancreatitis_and_pancreaticoduodenectomy",
    name: "Acute Pancreatitis, Walled-Off Necrosis Step-Up Approach, and Whipple Procedure",
    aliases: ["Atlanta classification", "Walled-off pancreatic necrosis", "Whipple procedure", "Courvoisier sign", "Pancreatic fistula"],
    system: "Pancreatic Surgery / Surgical Oncology",
    specialty: "HPB Surgery / General Surgery / Critical Care",
    source: "Sabiston Textbook of Surgery 22nd ed / IAP/APA Guidelines",
    pearls: [
      "Acute pancreatitis diagnosis requires 2 of 3: epigastric pain radiating to back, lipase >= 3x ULN, or imaging findings",
      "The revised Atlanta classification defines severe pancreatitis by persistent organ failure exceeding 48 hours",
      "Infected necrosis is managed with the step-up approach: delayed drainage at 4 weeks before considering necrosectomy",
      "Pancreatic head adenocarcinoma classically presents with painless obstructive jaundice and palpable gallbladder (Courvoisier sign)",
      "The Whipple procedure resects pancreatic head and duodenum, requiring pancreatic, biliary, and enteric reconstructions"
    ],
    patho: "Premature intra-acinar activation of trypsinogen produces autodigestion of pancreatic parenchyma and peripancreatic fat necrosis. Microvascular thrombosis precipitates parenchymal necrosis. Pancreatic adenocarcinoma invades neural plexuses and retroperitoneal vasculature.",
    investigations: [
      "Serum lipase and amylase enzymatic levels",
      "Pancreatic-protocol contrast-enhanced triphasic CT or MRI",
      "Serum CA 19-9 tumor marker quantification for adenocarcinoma monitoring",
      "Percutaneous drain fluid amylase on postoperative day 3 for pancreatic fistula audit"
    ],
    differentials: [
      "Perforated peptic ulcer with elevated serum amylase",
      "Acute mesenteric ischemia",
      "Acute cholecystitis / ascending cholangitis",
      "Autoimmune pancreatitis (elevated IgG4)"
    ]
  },

  // 15. sur-spleen
  {
    id: "splenic_trauma_and_post_splenectomy_sepsis",
    name: "Splenic Trauma Management, Splenectomy, and Overwhelming Post-Splenectomy Infection",
    aliases: ["Splenic rupture", "AAST spleen scale", "Kehr sign", "OPSI", "Splenic artery embolization"],
    system: "Trauma Surgery / Hematologic Surgery",
    specialty: "Trauma Surgery / General Surgery / Critical Care",
    source: "Sabiston Textbook of Surgery 22nd ed / AAST Injury Scaling",
    pearls: [
      "The spleen is the most frequently injured solid organ in blunt abdominal trauma; Kehr sign indicates diaphragmatic blood",
      "Non-operative management succeeds in > 90% of hemodynamically stable blunt splenic injuries",
      "Vascular contrast blush on arterial-phase CT indicates pseudoaneurysm requiring catheter splenic artery embolization",
      "Emergency splenectomy is mandatory for persistent hemodynamic shock or peritonitis refractory to blood products",
      "Overwhelming post-splenectomy infection (OPSI) carries > 50% mortality; vaccinate against pneumococcus, meningococcus, Hib"
    ],
    patho: "Blunt decelerating force tears the fragile splenic capsule and vascular red pulp parenchymal sinusoids. Splenectomy removes the principal site of IgM production, tuftsin synthesis, and reticuloendothelial macrophage clearance of un-opsonized encapsulated bacteria.",
    investigations: [
      "Abdominal CT with intravenous contrast (arterial and portal venous phases)",
      "Bedside eFAST examination evaluating splenorenal recess fluid accumulation",
      "Serial hemoglobin and hematocrit monitoring every 4 to 6 hours during non-operative care",
      "Blood cultures and peripheral smear for Howell-Jolly bodies post-splenectomy"
    ],
    differentials: [
      "Left renal laceration or retroperitoneal hematoma",
      "Left diaphragmatic rupture",
      "Mesenteric tear with hemoperitoneum",
      "Spontaneous splenic rupture (infectious mononucleosis / malaria)"
    ]
  },

  // 16. sur-obstruction
  {
    id: "intestinal_obstruction_and_colonic_volvulus",
    name: "Small Bowel Obstruction, Strangulation, Adhesive Disease, and Colonic Volvulus",
    aliases: ["SBO", "Closed-loop obstruction", "Sigmoid volvulus", "Gastrografin challenge", "Bowel strangulation"],
    system: "General Surgery / Colorectal Surgery",
    specialty: "General Surgery / Emergency Surgery / Colorectal Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / WSES Guidelines",
    pearls: [
      "Postoperative adhesions cause 75% of small bowel obstructions, followed by incarcerated hernias and neoplasms",
      "Closed-loop obstruction and strangulation produce localized peritonitis, fever, leukocytosis, and lactic acidosis",
      "Conservative management of adhesive SBO with NG tube decompression and Gastrografin challenge succeeds in 80%",
      "Sigmoid volvulus displays the pathognomonic coffee-bean sign pointing to RUQ; decompress with rigid sigmoidoscopy",
      "Cecal volvulus results from mobile cecal mesentery, appearing as a comma loop in LUQ; requires surgical resection"
    ],
    patho: "Luminal occlusion prompts proximal fluid accumulation, bowel distension, and elevated wall tension. When intraluminal pressure exceeds venous capillary pressure, microvascular thrombosis, mural ischemia, bacterial translocation, and gangrenous perforation occur.",
    investigations: [
      "Abdominal CT with intravenous and oral water-soluble contrast (triaging transition point)",
      "Plain abdominal radiographs in supine and erect positions",
      "Serial serum lactate, venous blood gas base deficit, and electrolyte panel",
      "Abdominal radiography at 8 and 24 hours post-Gastrografin challenge"
    ],
    differentials: [
      "Paralytic ileus (generalized bowel dilation without discrete transition point)",
      "Acute mesenteric ischemia",
      "Ogilvie syndrome (acute colonic pseudo-obstruction)",
      "Incarcerated femoral or obturator hernia"
    ]
  },

  // 17. sur-appendix
  {
    id: "acute_appendicitis_and_appendiceal_neoplasms",
    name: "Acute Appendicitis, Alvarado Scoring, Laparoscopic Appendectomy, and Carcinoid",
    aliases: ["Appendicitis", "McBurney point", "Alvarado score", "Appendiceal carcinoid", "Mucocele of appendix"],
    system: "General Surgery / Emergency Surgery",
    specialty: "General Surgery / Emergency Surgery / Pediatric Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / WSES Appendicitis Guidelines",
    pearls: [
      "Acute appendicitis begins with luminal obstruction by a fecalith, causing progressive ischemia and perforation",
      "Pain shifts from visceral periumbilical discomfort (T10) to somatic right lower quadrant pain at McBurney point",
      "An Alvarado score >= 7 strongly indicates acute appendicitis warranting surgical intervention",
      "Laparoscopic appendectomy requires skeletonization and division of the mesoappendix containing the appendicular artery",
      "Appendiceal neuroendocrine carcinoid > 2 cm or involving the base mandates oncologic right hemicolectomy"
    ],
    patho: "Luminal obstruction by a fecalith or lymphoid tissue increases intraluminal pressure, compromising mucosal venous return. Bacterial invasion triggers transmural infarction, gangrene, and localized or free perforation with peritonitis.",
    investigations: [
      "Contrast-enhanced abdominal and pelvic CT (diameter > 6 mm, wall thickening, fat stranding)",
      "Graded compression abdominal ultrasound (first-line in children and pregnant women)",
      "Complete blood count with differential and C-reactive protein level",
      "Routine histopathological examination of resected appendix for occult neoplasia"
    ],
    differentials: [
      "Mesenteric adenitis in pediatric patients",
      "Meckel diverticulitis",
      "Ruptured ovarian cyst / ectopic pregnancy / pelvic inflammatory disease",
      "Cecal diverticulitis / Crohn terminal ileitis"
    ]
  },

  // 18. sur-colorectal-cancer
  {
    id: "colorectal_carcinoma_and_total_mesorectal_excision",
    name: "Colorectal Carcinoma: Staging, Total Mesorectal Excision, and Genetic Syndromes",
    aliases: ["Colorectal cancer", "TME", "Lynch syndrome", "Low anterior resection", "Abdominoperineal resection"],
    system: "Colorectal Surgery / Surgical Oncology",
    specialty: "Colorectal Surgery / Surgical Oncology / Medical Oncology",
    source: "Sabiston Textbook of Surgery 22nd ed / NCCN Guidelines",
    pearls: [
      "Adenoma-carcinoma sequence involves progressive APC, KRAS, and p53 mutations; Lynch syndrome features MSI-high",
      "Oncologic colectomy requires high vascular pedicle ligation and retrieval of a minimum of 12 regional lymph nodes",
      "Total mesorectal excision (TME) requires sharp dissection in the holy plane, preserving pelvic autonomic nerves",
      "Negative circumferential resection margin (CRM > 1 mm) reduces local rectal cancer recurrence below 5%",
      "Abdominoperineal resection (APR) is mandatory for distal rectal tumors invading the levator ani or external sphincter"
    ],
    patho: "Chromosomal instability or defective DNA mismatch repair drives malignant progression of glandular epithelium. Colon cancer disseminates via mesenteric lymphatics along axial arteries to regional nodes and via the portal venous circulation to the liver.",
    investigations: [
      "Colonoscopy with tissue biopsy and ink tattooing of primary lesion",
      "High-resolution pelvic MRI for rectal cancer depth of invasion and mesorectal fascia relation",
      "Contrast-enhanced CT of chest, abdomen, and pelvis for distant metastasis staging",
      "Baseline serum carcinoembryonic antigen (CEA) and tumor mismatch repair IHC"
    ],
    differentials: [
      "Complicated diverticulitis with inflammatory mass",
      "Ischemic colitis with luminal stricture",
      "Crohn colitis or ulcerative colitis flare",
      "Gastrointestinal stromal tumor (GIST) / lymphoma"
    ]
  },

  // 19. sur-anorectal
  {
    id: "anorectal_disorders_hemorrhoids_and_fistula",
    name: "Anorectal Disease: Hemorrhoids, Anal Fissure, Goodsall Rule, and Fistula-in-Ano",
    aliases: ["Internal hemorrhoids", "Anal fissure", "Goodsall rule", "Fistula-in-ano", "Lateral internal sphincterotomy"],
    system: "Colorectal Surgery / General Surgery",
    specialty: "Colorectal Surgery / General Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / ASCRS Guidelines",
    pearls: [
      "Internal hemorrhoids are graded I (bleed), II (spontaneous reduce), III (manual reduce), and IV (permanently prolapsed)",
      "Chronic anal fissures feature an indurated ulcer, exposed internal sphincter fibers, hypertrophied papilla, and sentinel tag",
      "Lateral internal sphincterotomy reduces resting anal hypertonicity to heal refractory posterior anal fissures",
      "Goodsall rule: anterior external fistula openings track radially; posterior openings follow a curved tract to posterior midline",
      "Anorectal abscesses arise from cryptoglandular infections and mandate immediate surgical incision and drainage"
    ],
    patho: "Degeneration of supporting fibroelastic connective tissue causes engorgement and descent of normal vascular anal cushions. Cryptoglandular infection in the intersphincteric space forms perianal or ischiorectal abscesses, creating epithelized fistulous tracts.",
    investigations: [
      "Digital rectal examination and direct anoscopy / proctoscopy",
      "Pelvic MRI with endoanal coil for complex, recurrent, or high transsphincteric fistulas",
      "Examination under anesthesia (EUA) with fistula probe and hydrogen peroxide injection",
      "Colonoscopy to rule out Crohn disease in patients with complex or atypical fissures/fistulas"
    ],
    differentials: [
      "Anal canal squamous cell carcinoma",
      "Crohn disease anorectal manifestations",
      "Hidradenitis suppurativa",
      "Pilonidal sinus disease"
    ]
  },

  // 20. sur-peritoneum
  {
    id: "acute_peritonitis_damage_control_and_compartment_syndrome",
    name: "Acute Peritonitis, Damage Control Surgery, and Abdominal Compartment Syndrome",
    aliases: ["Secondary peritonitis", "Damage control laparotomy", "Lethal triad", "Abdominal compartment syndrome", "Open abdomen"],
    system: "Trauma Surgery / Emergency General Surgery",
    specialty: "General Surgery / Trauma Surgery / Critical Care",
    source: "Sabiston Textbook of Surgery 22nd ed / WSACS Guidelines",
    pearls: [
      "Secondary peritonitis results from visceral perforation, requiring emergency operative source control and washout",
      "Damage control surgery abbreviates laparotomy in the presence of the lethal triad: hypothermia, acidosis, and coagulopathy",
      "Intra-abdominal hypertension is sustained IAP >= 12 mmHg; abdominal compartment syndrome is IAP > 20 mmHg with organ failure",
      "Intra-abdominal pressure is monitored non-invasively via transvesical urinary bladder catheter manometry",
      "Negative-pressure temporary abdominal closure prevents fascial retraction and enables delayed primary closure"
    ],
    patho: "Visceral perforation floods the peritoneal cavity with enteric bacteria and digestive enzymes, causing massive inflammatory exudation, capillary leak, and third-spacing. Elevated intra-abdominal pressure compresses the inferior vena cava, restricts diaphragmatic excursion, and impairs visceral perfusion.",
    investigations: [
      "Transvesical intra-abdominal pressure (IAP) measurement via Foley catheter manometer",
      "Contrast-enhanced abdominal CT demonstrating pneumoperitoneum or visceral defect",
      "Serial arterial blood gases assessing lactate, base deficit, and coagulation parameters",
      "Intraoperative peritoneal fluid cultures for aerobic and anaerobic organisms"
    ],
    differentials: [
      "Spontaneous bacterial peritonitis in end-stage cirrhosis (monomicrobial)",
      "Acute pancreatitis with severe retroperitoneal third-spacing",
      "Tension pneumoperitoneum",
      "Ruptured abdominal aortic aneurysm"
    ]
  }
];
