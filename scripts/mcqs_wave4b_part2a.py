# Wave 4B MCQs Part 2A: Modules 11 to 15 (bk-sur-311 to bk-sur-360)
# sur-cardiac, sur-brain-tumours, sur-hydrocephalus, sur-paed-gi, sur-neonatal

MCQS_11_15 = [
    # 11. sur-cardiac (bk-sur-311 to bk-sur-320)
    ("sur-cardiac", [
        (
            "A 65-year-old diabetic male undergoes coronary angiography demonstrating severe triple-vessel coronary artery disease with 90 percent proximal left anterior descending (LAD) stenosis, 85 percent circumflex stenosis, and 90 percent right coronary artery stenosis. Left ventricular ejection fraction is 42 percent and SYNTAX score is 34. What is the standard revascularization strategy with proven long-term survival advantage?",
            ["Coronary artery bypass grafting (CABG) with left internal mammary artery (LIMA) to LAD",
             "Percutaneous coronary intervention (PCI) with multiple drug-eluting stents",
             "Medical management with high-dose statins and beta-blockers alone",
             "Transmyocardial laser revascularization"],
            "In patients with complex multivessel coronary artery disease, particularly diabetics and those with high SYNTAX scores (> 32) or impaired LV function, CABG demonstrates superior long-term survival, reduced myocardial infarction, and lower repeat revascularization compared to PCI.",
            "CABG using LIMA to LAD is the gold standard revascularization for complex multivessel disease and diabetic patients."
        ),
        (
            "Which vascular conduit provides the highest long-term patency rate exceeding 90 to 95 percent at 10 to 15 years in coronary artery bypass surgery?",
            ["Left internal mammary artery (LIMA) / internal thoracic artery",
             "Reversed saphenous vein graft (SVG)",
             "Radial artery graft",
             "Right gastroepiploic artery"],
            "The internal mammary artery (specifically LIMA anastomosed to LAD) is the premier conduit in cardiac surgery, with > 90-95% patency at 10 to 15 years owing to resistance to atherosclerosis and endothelial nitric oxide production.",
            "The left internal mammary artery (LIMA) exhibits superior long-term patency (> 90% at 10 years) due to active endothelial protection."
        ),
        (
            "An 80-year-old female presents with exertional syncope, angina, and dyspnea. Echocardiography demonstrates a calcified bicuspid aortic valve with an aortic valve area of 0.6 cm2 and mean transvalvular gradient of 52 mmHg. Society of Thoracic Surgeons (STS) surgical risk score is 7.5 percent (intermediate-to-high risk). What is the preferred minimally invasive intervention?",
            ["Transcatheter aortic valve implantation (TAVI / TAVR)",
             "Balloon aortic valvuloplasty as definitive monotherapy",
             "Medical therapy with vasodilators and digoxin",
             "Mitral valve transcatheter edge-to-edge repair"],
            "For elderly patients with severe symptomatic aortic stenosis who are at intermediate or high surgical risk (STS score > 4-8%), TAVI is non-inferior or superior to surgical aortic valve replacement with reduced hospital stays and lower morbidity.",
            "TAVI is the preferred valve replacement strategy for elderly patients with symptomatic severe aortic stenosis at elevated surgical risk."
        ),
        (
            "During cardiopulmonary bypass (CPB), what medication is administered prior to aortic cannulation to achieve systemic anticoagulation, monitored by maintaining an activated clotting time (ACT) > 480 seconds?",
            ["Unfractionated heparin sodium (300 to 400 units/kg)",
             "Low molecular weight heparin (enoxaparin)",
             "Warfarin sodium",
             "Aspirin combined with clopidogrel"],
            "Full-dose unfractionated heparin is administered intravenously prior to initiating CPB to prevent catastrophic clot formation inside the oxygenator circuit, titrating the ACT to greater than 400 to 480 seconds.",
            "Unfractionated heparin is the mandatory anticoagulant for cardiopulmonary bypass, targeting an activated clotting time exceeding 480 seconds."
        ),
        (
            "What pharmacological agent is administered at the conclusion of cardiopulmonary bypass to rapidly reverse the systemic anticoagulant effect of heparin?",
            ["Protamine sulfate",
             "Vitamin K1 (phytonadione)",
             "Idarucizumab",
             "Fresh frozen plasma alone"],
            "Protamine sulfate, a positively charged polycationic protein derived from salmon sperm, binds electrostatically to negatively charged heparin to form a stable, inactive salt complex, reversing anticoagulation.",
            "Protamine sulfate rapidly neutralizes heparin anticoagulation via stable salt complex formation at the end of cardiopulmonary bypass."
        ),
        (
            "A 58-year-old male develops sudden hypotension, distant muffled heart sounds, and elevated jugular venous pressure with pulsus paradoxus 6 hours following coronary bypass surgery. Chest tube drainage abruptly ceased 1 hour ago. What is the clinical diagnosis and urgent management?",
            ["Cardiac tamponade mandating immediate surgical re-exploration / sternotomy decompression",
             "Acute pulmonary embolism requiring intravenous thrombolysis",
             "Myocardial infarction requiring urgent coronary angiography",
             "Tension pneumothorax requiring needle thoracostomy"],
            "The classic Beck triad (hypotension, jugular venous distension, muffled heart tones) combined with abrupt cessation of mediastinal chest tube output indicates clot obstruction of drainage tubes causing acute cardiac tamponade. Immediate emergency sternotomy and evacuation of hemopericardium is required.",
            "Acute post-cardiac surgery cardiac tamponade presents with Beck triad and demands immediate emergency surgical mediastinal exploration."
        ),
        (
            "In patients undergoing mechanical prosthetic valve replacement, what is the mandatory lifelong postoperative pharmacological therapy?",
            ["Lifelong oral anticoagulation with a vitamin K antagonist (warfarin) targeting INR 2.5 to 3.5",
             "Single antiplatelet therapy with aspirin 81 mg daily for 6 months only",
             "Direct oral anticoagulant (DOAC) like dabigatran or apixaban",
             "Prophylactic intravenous heparin administered once monthly"],
            "Mechanical prosthetic heart valves are highly thrombogenic and mandate lifelong anticoagulation with vitamin K antagonists (warfarin). DOACs (such as dabigatran) are strictly contraindicated with mechanical valves due to excess thromboembolic and bleeding events.",
            "Mechanical prosthetic valves require lifelong warfarin anticoagulation; direct oral anticoagulants are strictly contraindicated."
        ),
        (
            "What is the classical clinical triad of symptoms in severe aortic stenosis, indicating a dramatic decline in average life expectancy if left untreated without valve replacement?",
            ["Angina, Syncope, and Dyspnea (Heart failure)",
             "Fever, Murmur, and Splenomegaly",
             "Claudication, Rest pain, and Tissue loss",
             "Palpitations, Hemoptysis, and Hoarseness"],
            "The classic symptom triad of severe aortic stenosis is Angina (average survival 5 years), Syncope (survival 3 years), and Dyspnea / heart failure (survival 2 years). Their onset warrants prompt aortic valve replacement.",
            "The classic triad of aortic stenosis is angina, syncope, and dyspnea, signaling an urgent need for valve replacement."
        ),
        (
            "Which surgical technique is widely preferred over mitral valve replacement for severe degenerative (myxomatous) mitral regurgitation due to superior preservation of left ventricular geometry and survival?",
            ["Mitral valve repair (annuloplasty ring plus leaflet resection or artificial chordae)",
             "Bioprosthetic mitral valve replacement without chordal preservation",
             "Mechanical mitral valve replacement with complete chordal resection",
             "Closed transvenous mitral commissurotomy"],
            "Mitral valve repair is the gold standard for degenerative mitral regurgitation, preserving the subvalvular apparatus and left ventricular geometry with lower operative mortality and freedom from prosthetic-related complications.",
            "Mitral valve repair is superior to replacement for degenerative mitral regurgitation, preserving left ventricular function and geometry."
        ),
        (
            "What is the temperature of the cold hyperkalemic cardioplegia solution infused into the coronary arteries to arrest the heart in diastole during cardiac operations?",
            ["4 degrees Celsius (cold blood or crystalloid cardioplegia)",
             "37 degrees Celsius (normothermic isotonic fluid)",
             "25 degrees Celsius warm crystalloid",
             "Zero degrees Kelvin"],
            "Cold cardioplegia (infused at 4 C) achieves electrochemical arrest in diastole via high potassium concentration while simultaneously cooling myocardium to suppress metabolic oxygen consumption by over 90 percent.",
            "Cold hyperkalemic cardioplegia solution (4 C) arrests myocardial contraction in diastole, providing hypothermic metabolic protection."
        )
    ]),

    # 12. sur-brain-tumours (bk-sur-321 to bk-sur-330)
    ("sur-brain-tumours", [
        (
            "A 56-year-old male presents with a new-onset generalized tonic-clonic seizure followed by progressive left hemiparesis and morning headache. Brain MRI reveals a 4.5 cm ring-enhancing mass in the right frontal lobe with thick, irregular walls, central necrosis, and extensive surrounding vasogenic edema with midline shift. What is the most likely diagnosis?",
            ["Glioblastoma (IDH-wildtype, WHO CNS Grade 4)",
             "Low-grade diffuse astrocytoma (WHO Grade 2)",
             "Primary CNS lymphoma",
             "Cerebral toxoplasmosis"],
            "A solitary thick, irregularly ring-enhancing cerebral mass with central necrosis and surrounding vasogenic edema in an adult over 50 is the classic neuroimaging appearance of glioblastoma (WHO Grade 4), the most common and aggressive primary malignant brain tumor.",
            "Glioblastoma presents characteristically as an irregular, thick ring-enhancing cerebral mass with central necrosis and marked vasogenic edema."
        ),
        (
            "What molecular biomarker in glioblastoma predicts significantly improved response and prolonged overall survival following alkylating chemotherapy with temozolomide (TMZ)?",
            ["MGMT (O6-methylguanine-DNA methyltransferase) promoter hypermethylation",
             "EGFR gene amplification alone",
             "p53 missense mutation",
             "Loss of chromosome 10q alone"],
            "Hypermethylation of the MGMT promoter silences the DNA repair enzyme MGMT, preventing repair of alkylated DNA lesions produced by temozolomide and correlating with significantly superior treatment response and survival (Stupp protocol).",
            "MGMT promoter methylation silences DNA repair, predicting enhanced sensitivity to temozolomide chemotherapy in glioblastoma."
        ),
        (
            "What is the standard first-line multimodal treatment regimen (the Stupp protocol) for newly diagnosed glioblastoma following maximal safe surgical resection?",
            ["Concurrent temozolomide chemotherapy with focal radiotherapy followed by adjuvant temozolomide for 6 cycles",
             "Focal external beam radiation therapy monotherapy without chemotherapy",
             "Whole brain radiation therapy combined with high-dose methotrexate",
             "Procarbazine, CCNU, and vincristine (PCV) regimen without radiation"],
            "The Stupp protocol is the global standard for newly diagnosed glioblastoma: maximal safe surgical resection followed by concurrent daily temozolomide with fractionated focal radiation (60 Gy in 30 fractions), followed by 6 cycles of adjuvant maintenance temozolomide.",
            "The Stupp protocol (radiotherapy with concurrent and adjuvant temozolomide) is the standard postoperative regimen for glioblastoma."
        ),
        (
            "A 48-year-old female presents with anosmia, progressive visual loss, and personality changes. Contrast MRI reveals a 4 cm homogeneously enhancing, extra-axial mass arising from the dura of the olfactory groove with a prominent 'dural tail'. What is the diagnosis?",
            ["Olfactory groove meningioma (WHO Grade 1)",
             "Pituitary macroadenoma",
             "Craniopharyngioma",
             "Glioblastoma multiforme"],
            "Meningiomas are slow-growing, benign (WHO Grade 1 in 80-85%) extra-axial tumors originating from arachnoid cap cells. Contrast MRI characteristically shows an extra-axial, homogeneously enhancing mass with a classic dural tail.",
            "Meningiomas are extra-axial dura-based tumors that characteristically display intense homogeneous contrast enhancement with a dural tail."
        ),
        (
            "Which histopathological grading system classification is used to predict the recurrence risk of meningiomas following surgical resection?",
            ["Simpson grading of resection (Grades I through V)",
             "Spetzler-Martin arteriovenous malformation grade",
             "Hunt and Hess clinical grade",
             "Fisher CT hemorrhage scale"],
            "The Simpson grading scale evaluates the completeness of meningioma surgical excision, ranging from Simpson Grade I (complete tumor removal with excision of dural attachment and abnormal bone; lowest recurrence) to Grade V (simple decompression/biopsy; highest recurrence).",
            "The Simpson grading system defines the extent of meningioma surgical resection and directly correlates with long-term recurrence rates."
        ),
        (
            "A 38-year-old male presents with unilateral sensorineural hearing loss, tinnitus, and mild balance impairment. Brain MRI demonstrates an enhancing mass centered in the left cerebellopontine angle extending into the internal acoustic meatus ('ice-cream cone' appearance). What is the diagnosis?",
            ["Vestibular schwannoma (acoustic neuroma)",
             "Trigeminal schwannoma",
             "Ependymoma of the fourth ventricle",
             "Brainstem pontine glioma"],
            "Vestibular schwannoma arises from Schwann cells of the vestibular nerve (CN VIII) at the Obersteiner-Redlich transition zone in the internal auditory canal, presenting with unilateral progressive sensorineural hearing loss and tinnitus.",
            "Vestibular schwannoma characteristically occupies the cerebellopontine angle with intracanalicular meatal extension and causes unilateral hearing loss."
        ),
        (
            "Which hereditary tumor syndrome is characterized by the development of bilateral vestibular schwannomas, caused by mutations in the NF2 gene (merlin protein) on chromosome 22q?",
            ["Neurofibromatosis type 2 (NF2)",
             "Neurofibromatosis type 1 (von Recklinghausen disease)",
             "Tuberous sclerosis complex",
             "Von Hippel-Lindau disease"],
            "Bilateral vestibular schwannomas are pathognomonic for Neurofibromatosis Type 2 (NF2), caused by inactivating mutations of the NF2 tumor suppressor gene (merlin/schwannomin) on chromosome 22q12.",
            "Bilateral vestibular schwannomas are pathognomonic of Neurofibromatosis Type 2, resulting from NF2 mutations on chromosome 22q."
        ),
        (
            "What is the most common intracranial tumor in adult patients overall, far exceeding the incidence of all primary brain neoplasms combined?",
            ["Metastatic brain tumors (secondary cerebral metastases)",
             "Glioblastoma multiforme",
             "Pituitary adenoma",
             "Acoustic neuroma"],
            "Metastatic brain tumors are the most common intracranial neoplasms in adults, occurring up to 10 times more frequently than primary brain tumors. The most common primary origins are lung cancer, breast cancer, and melanoma.",
            "Metastatic brain lesions represent the most frequent intracranial tumors in adults, predominantly originating from lung, breast, and melanoma."
        ),
        (
            "A 10-year-old child presents with morning vomiting, gait ataxia, and papilledema. MRI reveals a cystic mass with a bright enhancing mural nodule in the right cerebellar hemisphere. Histology reveals Rosenthal fibers and eosinophilic granular bodies. What is the diagnosis?",
            ["Pilocytic astrocytoma (WHO CNS Grade 1)",
             "Medulloblastoma",
             "Atypical teratoid rhabdoid tumor (ATRT)",
             "Glioblastoma"],
            "Pilocytic astrocytoma is a benign, slow-growing WHO Grade 1 glioma characteristically located in the cerebellum of children. MRI shows a cystic lesion with an intensely enhancing mural nodule; histology demonstrates bipolar piloid cells and Rosenthal fibers.",
            "Pilocytic astrocytoma is a benign pediatric cerebellar tumor featuring a cyst with enhancing mural nodule and Rosenthal fibers."
        ),
        (
            "Which malignant pediatric brain tumor arises in the cerebellar vermis, fills the fourth ventricle, frequently disseminates along the neuraxis ('drop metastases'), and displays Homer Wright rosettes on histology?",
            ["Medulloblastoma (WHO CNS Grade 4)",
             "Craniopharyngioma",
             "Choroid plexus papilloma",
             "Vestibular schwannoma"],
            "Medulloblastoma is an embryonal neuroepithelial tumor arising in the roof of the fourth ventricle (cerebellar vermis) in children, prone to CSF drop metastases throughout the spinal cord, requiring craniospinal irradiation alongside surgical resection and chemotherapy.",
            "Medulloblastoma is a malignant pediatric posterior fossa embryonal tumor prone to CSF seeding along the entire craniospinal axis."
        )
    ]),

    # 13. sur-hydrocephalus (bk-sur-331 to bk-sur-340)
    ("sur-hydrocephalus", [
        (
            "A 72-year-old male is brought by his family due to a 6-month history of insidious progressive memory impairment, a broad-based magnetic gait with difficulty lifting his feet off the floor ('feet glued to the floor'), and urinary urgency with occasional incontinence. Brain MRI reveals marked ventriculomegaly disproportionate to sulcal cerebral atrophy. What is the clinical triad and condition?",
            ["Normal pressure hydrocephalus (NPH) presenting with Adams-Hakim triad (gait disturbance, dementia, urinary incontinence)",
             "Alzheimer disease with advanced apraxia",
             "Parkinson disease with freezing of gait",
             "Creutzfeldt-Jakob disease with rapid decline"],
            "Normal pressure hydrocephalus (NPH) is characterized by the classic Adams-Hakim triad: gait ataxia ('magnetic' or glued gait), cognitive impairment/dementia, and urinary incontinence. Gait disturbance is typically the earliest and most responsive symptom to CSF shunting.",
            "Normal pressure hydrocephalus is characterized by the Adams-Hakim triad of gait disturbance, cognitive decline, and urinary incontinence."
        ),
        (
            "What bedside diagnostic procedure confirms the diagnosis and predicts clinical improvement following ventriculoperitoneal shunt placement in suspected normal pressure hydrocephalus?",
            ["Large-volume lumbar puncture tap test (removal of 30 to 50 mL of CSF) with pre- and post-gait assessment",
             "Electroencephalography (EEG) monitoring",
             "Carotid Doppler ultrasonography",
             "Transcranial magnetic stimulation"],
            "A diagnostic high-volume lumbar puncture (removing 30-50 mL of CSF) with objective pre- and post-tap quantitative gait evaluation has high positive predictive value for sustained clinical recovery after permanent CSF shunting.",
            "A high-volume lumbar tap test with documented gait improvement is the standard test predicting shunt responsiveness in NPH."
        ),
        (
            "In non-communicating (obstructive) hydrocephalus caused by primary aqueductal stenosis, which neuroendoscopic procedure provides an effective alternative to permanent ventriculoperitoneal shunting?",
            ["Endoscopic third ventriculostomy (ETV)",
             "Stereotactic radiosurgery of the pineal gland",
             "Endoscopic choroid plexus coagulopathy alone",
             "Microvascular decompression of the fourth ventricle"],
            "Endoscopic third ventriculostomy (ETV) fenestrates the floor of the third ventricle (tuber cinereum) between the mamillary bodies and infundibular recess, allowing CSF to bypass an obstructed aqueduct directly into the prepontine subarachnoid cisterns.",
            "Endoscopic third ventriculostomy creates an internal CSF bypass from the third ventricle to the prepontine cistern in aqueductal stenosis."
        ),
        (
            "What is the most frequent acute mechanical complication of a ventriculoperitoneal (VP) shunt requiring surgical revision, classically presenting with headache, vomiting, and lethargy?",
            ["Proximal ventricular catheter obstruction by choroid plexus or brain tissue debris",
             "Peritoneal pseudocyst formation",
             "Inadvertent bowel perforation by distal tubing",
             "Subdural hygroma from overdrainage"],
            "Mechanical occlusion of the ventricular catheter by choroid plexus, ingrown ependymal glia, or blood/proteinaceous debris is the single most common cause of shunt failure, accounting for over 50 percent of revisions.",
            "Proximal ventricular catheter obstruction is the leading cause of ventriculoperitoneal shunt malfunction and failure."
        ),
        (
            "Which bacterial organism is the most common pathogen responsible for ventriculoperitoneal shunt colonization and biofilm infection within the first 6 months following implantation?",
            ["Staphylococcus epidermidis (coagulase-negative Staphylococci)",
             "Pseudomonas aeruginosa",
             "Escherichia coli",
             "Streptococcus pneumoniae"],
            "Coagulase-negative staphylococci (especially Staphylococcus epidermidis) produce slime and extracellular biofilms on prosthetic silastic tubing, causing indolent, persistent shunt hardware colonization and infection.",
            "Staphylococcus epidermidis is the predominant organism causing ventriculoperitoneal shunt infections via biofilm formation."
        ),
        (
            "What is the management of choice for a proven ventriculoperitoneal shunt hardware infection with positive CSF cultures?",
            ["Complete surgical removal of the infected shunt hardware, placement of an external ventricular drain (EVD), targeted IV antibiotics, and subsequent delayed shunt replacement",
             "Intravenous antibiotics alone while leaving the hardware in place",
             "Irrigation of the peritoneal cavity with antibiotic saline",
             "Increasing the programmable valve opening pressure"],
            "Curing hardware infection requires complete removal of the colonized shunt system, temporary external ventricular drainage (EVD) with targeted intrathecal/IV antibiotics, and delayed re-implantation of a new shunt once CSF cultures remain sterile for 10-14 days.",
            "Management of shunt infection requires complete hardware removal, temporary external ventricular drainage, and targeted antibiotics."
        ),
        (
            "What physiological phenomenon causes the formation of bilateral chronic subdural hematomas in an elderly patient following placement of a low-pressure ventriculoperitoneal shunt?",
            ["CSF overdrainage causing ventricular collapse, cortical sinking, and tearing of fragile bridging veins",
             "Acute occlusion of the superior sagittal sinus",
             "Sudden expansion of the choroid plexus",
             "Direct vascular laceration during catheter tunneling"],
            "Shunt overdrainage (low opening pressure or siphon effect while standing) leads to intracranial hypotension, brain collapse away from the inner skull table, and stretching with subsequent rupture of fragile bridging veins traversing the subdural space.",
            "Shunt overdrainage causes brain collapse and tensile rupture of bridging veins, leading to subdural hematomas."
        ),
        (
            "What congenital malformation is characterized by cystic dilatation of the fourth ventricle, agenesis or hypoplasia of the cerebellar vermis, and hydrocephalus?",
            ["Dandy-Walker malformation",
             "Chiari I malformation",
             "Arnold-Chiari II malformation",
             "Holoprosencephaly"],
            "The classic Dandy-Walker malformation is defined by the triad of complete or partial vermian agenesis, cystic expansion of the fourth ventricle occupying the posterior fossa, and upward displacement of the tentorium and torcula.",
            "Dandy-Walker malformation consists of fourth ventricle cystic dilatation, cerebellar vermis agenesis, and hydrocephalus."
        ),
        (
            "In infants with congenital hydrocephalus presenting before suture closure, which clinical sign describes downward deviation of both eyes with scleral exposure above the irises due to tectal compression?",
            ["'Setting sun' eye phenomenon",
             "Argyll Robertson sign",
             "Horner syndrome",
             "Macewen cracked-pot sign"],
            "The 'setting sun' sign (downward gaze palsy with upper eyelid retraction revealing sclera above the limbus) occurs in infants with hydrocephalus secondary to increased intracranial pressure compressing the mesencephalic tectum and Parinaud center.",
            "The setting-sun eye sign reflects tectal midbrain compression by increased ICP, causing upward gaze palsy in infants with hydrocephalus."
        ),
        (
            "Where is cerebrospinal fluid (CSF) primarily produced within the human ventricular system, and at what approximate physiological rate in a healthy adult?",
            ["Choroid plexus of the lateral, third, and fourth ventricles, at approximately 20 mL/hour (450-500 mL/day)",
             "Arachnoid granulations of the sagittal sinus at 100 mL/day",
             "Subependymal microglia at 1500 mL/day",
             "Cerebellar Purkinje cells at 5 mL/hour"],
            "CSF is actively secreted by choroid plexus epithelial cells in the lateral, third, and fourth ventricles at approximately 0.35 to 0.40 mL/minute (around 20 mL/hour or 500 mL per 24 hours), replacing the 150 mL total volume roughly 3 to 4 times daily.",
            "CSF is secreted by choroid plexus epithelia at roughly 500 mL per day (20 mL/hour), replacing the CSF volume several times daily."
        )
    ]),

    # 14. sur-paed-gi (bk-sur-341 to bk-sur-350)
    ("sur-paed-gi", [
        (
            "A 4-week-old male infant presents with non-bilious projectile vomiting immediately after every feeding. He is voraciously hungry after vomiting. Physical examination reveals a small, olive-shaped, mobile mass palpable in the right upper quadrant. Serum chemistry shows hypochloremic, hypokalemic metabolic alkalosis with paradoxical aciduria. What is the diagnosis?",
            ["Infantile hypertrophic pyloric stenosis",
             "Duodenal atresia",
             "Midgut volvulus",
             "Gastroesophageal reflux disease"],
            "Hypertrophic pyloric stenosis classically presents at 3 to 6 weeks of age with non-bilious projectile vomiting, an 'olive' mass, and hypochloremic hypokalemic metabolic alkalosis from recurrent gastric hydrochloric acid loss.",
            "Hypertrophic pyloric stenosis presents with projectile non-bilious emesis, a palpable olive mass, and hypochloremic metabolic alkalosis."
        ),
        (
            "What is the definitive surgical procedure of choice for hypertrophic pyloric stenosis once fluid and electrolyte derangements are completely corrected?",
            ["Ramstedt extramucosal pyloromyotomy",
             "Billroth I gastroduodenostomy",
             "Nissen fundoplication",
             "Gastrojejunostomy bypass"],
            "Ramstedt pyloromyotomy involves longitudinal incision through the hypertrophied seromuscular cylinder down to bulging, intact submucosa without perforating the mucosa, relieving pyloric outlet obstruction.",
            "Ramstedt extramucosal pyloromyotomy is the definitive curative surgical operation for hypertrophic pyloric stenosis."
        ),
        (
            "A 7-month-old infant presents with sudden episodic bouts of severe crampy abdominal pain during which he draws his knees to his chest and screams inconsolably, alternating with periods of lethargy. Several hours later, he passes a bowel movement containing dark red blood and mucus ('red currant jelly stool'). Abdominal ultrasound confirms a 'target' or 'doughnut' sign in the right upper quadrant. What is the diagnosis?",
            ["Ileocolic intussusception",
             "Necrotizing enterocolitis",
             "Meckel diverticulitis",
             "Acute appendicitis"],
            "Intussusception is the invagination of an intestinal loop into an adjacent segment (most commonly ileum into cecum/colon). It characteristically presents in infants 5 to 10 months old with paroxysmal colic, lethargy, 'target' sign on ultrasound, and red currant jelly stools.",
            "Ileocolic intussusception presents with paroxysmal colic, target sign on ultrasound, and classic red currant jelly stools."
        ),
        (
            "In an infant with ileocolic intussusception without signs of peritonitis, intestinal perforation, or shock, what is the standard first-line diagnostic and therapeutic intervention?",
            ["Air (pneumatic) or hydrostatic contrast enema reduction under fluoroscopic or sonographic monitoring",
             "Immediate emergency laparotomy",
             "Colonoscopic polypectomy",
             "Oral barium swallow with small bowel follow-through"],
            "Non-operative pneumatic (air) or hydrostatic enema reduction is the first-line treatment for uncomplicated intussusception, achieving successful reduction in 80 to 90 percent of cases without general anesthesia.",
            "Pneumatic or hydrostatic enema reduction is the first-line therapy for uncomplicated intussusception, successful in 80-90% of cases."
        ),
        (
            "What is the embryological remnant responsible for Meckel diverticulum, and what is its classic anatomical distance from the ileocecal valve in adults?",
            ["Incomplete obliteration of the vitelline (omphalomesenteric) duct, located approximately 2 feet (60 cm) proximal to the ileocecal valve",
             "Failure of urachus involution located at the bladder apex",
             "Persistent sinus venosus located in the right atrium",
             "Persistence of the left umbilical vein"],
            "Meckel diverticulum is a true diverticulum arising from incomplete obliteration of the vitelline (omphalomesenteric) duct, located on the antimesenteric border of the ileum roughly 2 feet proximal to the ileocecal valve ('rule of 2s').",
            "Meckel diverticulum is a persistent vitelline duct remnant located on the antimesenteric ileal border roughly 2 feet from the ileocecal valve."
        ),
        (
            "What type of ectopic heterotopic tissue is most commonly found in Meckel diverticulum, responsible for causing painless lower gastrointestinal bleeding by acid ulceration of adjacent normal ileal mucosa?",
            ["Ectopic gastric mucosa (and pancreatic tissue)",
             "Ectopic thyroid tissue",
             "Ectopic hepatic tissue",
             "Ectopic bronchial respiratory epithelium"],
            "Ectopic gastric mucosa produces hydrochloric acid that ulcerates adjacent normal ileal mucosa lacking protective bicarbonate mucus, leading to painless lower gastrointestinal bleeding in young children (visualized on Technetium-99m pertechnetate scan).",
            "Ectopic gastric mucosa in Meckel diverticulum produces acid that ulcerates adjacent ileum, causing painless rectal bleeding."
        ),
        (
            "A 3-day-old full-term infant presents with abdominal distension and failure to pass meconium within the first 48 hours of life. Digital rectal examination reveals a snug anal canal followed by an explosive burst of flatus and foul liquid stool upon finger withdrawal. What is the underlying pathology and gold standard diagnostic test?",
            ["Hirschsprung disease; diagnosis confirmed by rectal suction mucosal biopsy demonstrating absence of ganglion cells and hypertrophied nerve trunks",
             "Cystic fibrosis meconium ileus; sweat chloride test",
             "Anorectal malformation; cross-table lateral radiography",
             "Intestinal malrotation; upper GI contrast series"],
            "Hirschsprung disease is congenital aganglionosis of the myenteric (Auerbach) and submucosal (Meissner) plexuses due to failure of cranial-to-caudal neural crest cell migration. Rectal suction biopsy showing absent ganglion cells and acetylcholinesterase-positive nerve bundles is the gold standard.",
            "Hirschsprung disease results from neural crest migration failure; rectal suction biopsy showing absent ganglion cells is diagnostic."
        ),
        (
            "Which anatomical level of the gastrointestinal tract is always involved in classic short-segment Hirschsprung disease (accounting for 80 percent of cases)?",
            ["The internal anal sphincter and rectosigmoid colon",
             "The cecum and terminal ileum",
             "The splenic flexure exclusively",
             "The entire gastrointestinal tract from duodenum to anus"],
            "Because neural crest migration progresses in a cranial-to-caudal direction, aganglionosis always starts at the internal anal sphincter and extends proximally for a variable distance, involving the rectosigmoid colon in 80 percent of cases.",
            "Hirschsprung aganglionosis always starts at the internal anal sphincter and involves the rectosigmoid in eighty percent of patients."
        ),
        (
            "What is the life-threatening acute complication of untreated or post-operative Hirschsprung disease presenting with toxic abdominal distension, explosive diarrhea, fever, and leukocytosis?",
            ["Hirschsprung-associated enterocolitis (HAEC)",
             "Intestinal volvulus",
             "Necrotizing pancreatitis",
             "Pyloric mucosal prolapse"],
            "Hirschsprung-associated enterocolitis (HAEC) is the major cause of mortality in Hirschsprung disease, caused by stasis, dysbiosis, and mucosal barrier breakdown, treated with rectal washouts and IV broad-spectrum antibiotics.",
            "Hirschsprung-associated enterocolitis is a life-threatening complication characterized by toxic dilation and sepsis requiring urgent washouts."
        ),
        (
            "Which surgical pull-through technique for Hirschsprung disease mobilizes the ganglionic bowel endorectally through a submucosal rectal sleeve to preserve pelvic autonomic nerves and the anal sphincter complex?",
            ["Soave endorectal pull-through procedure",
             "Swenson abdominoperineal resection",
             "Duhamel retrorectal transanal pull-through",
             "Hartmann procedure"],
            "The Soave procedure is an endorectal pull-through where mucosal stripping creates a muscular rectal cuff, through which normal ganglionic bowel is pulled and anastomosed, avoiding damage to pelvic parasympathetic nerves.",
            "The Soave endorectal pull-through leaves a native muscular rectal cuff, preserving autonomic pelvic nerves and sphincter function."
        )
    ]),

    # 15. sur-neonatal (bk-sur-351 to bk-sur-360)
    ("sur-neonatal", [
        (
            "A 12-hour-old neonate develops persistent excessive oral drooling, frothing at the mouth, and chokes with coughing and cyanosis upon the very first feeding. A nasogastric tube cannot be advanced beyond 10 cm from the alveolar ridge. Abdominal radiograph demonstrates abundant gas within the stomach and intestines. What is the most common anatomical type of esophageal atresia / tracheoesophageal fistula (Type C)?",
            ["Esophageal atresia with a distal tracheoesophageal fistula (Gross Type C)",
             "Pure esophageal atresia without fistula (Gross Type A)",
             "Isolated 'H-type' tracheoesophageal fistula without atresia (Gross Type E)",
             "Esophageal atresia with a proximal tracheoesophageal fistula (Gross Type B)"],
            "Gross Type C (esophageal atresia with a distal tracheoesophageal fistula) accounts for approximately 85 to 87 percent of all cases. Air enters the gastrointestinal tract through the distal fistula, explaining stomach distension despite upper esophageal obstruction.",
            "Gross Type C (atresia with distal tracheoesophageal fistula) is the most common variant, presenting with proximal obstruction and gastric gas."
        ),
        (
            "What multi-system congenital syndrome is frequently associated with esophageal atresia and anorectal malformations, mandating echocardiography, vertebral radiographs, and renal ultrasound before surgical repair?",
            ["VACTERL association (Vertebral, Anal, Cardiac, Tracheoesophageal, Renal, Limb anomalies)",
             "CHARGE syndrome",
             "Beckwith-Wiedemann syndrome",
             "Alagille syndrome"],
            "Esophageal atresia occurs with associated anomalies in over 50 percent of cases, most commonly VACTERL association (at least 3 components: Vertebral defects, Anal atresia, Cardiac anomalies, TEF, Renal anomalies, Limb dysplasias).",
            "VACTERL association frequently accompanies esophageal atresia, mandating pre-repair screening for cardiac and renal anomalies."
        ),
        (
            "A newborn infant with Trisomy 21 (Down syndrome) presents with bilious vomiting on the first day of life without abdominal distension. Abdominal radiograph demonstrates the classic 'double-bubble' sign with absence of distal bowel gas. What is the definitive diagnosis and surgical repair?",
            ["Duodenal atresia; treated with duodenoduodenostomy (diamond-shaped anastomosis)",
             "Jejunal atresia; treated with primary resection and stoma",
             "Hypertrophic pyloric stenosis; treated with pyloromyotomy",
             "Midgut volvulus; treated with Ladd procedure"],
            "Duodenal atresia results from failure of recanalization of the embryonic duodenum during the 8th-10th week, strongly associated with Down syndrome (30%). Plain X-ray demonstrates the 'double bubble' sign (gastric and duodenal bulb gas). Kimura diamond-shaped duodenoduodenostomy is the definitive repair.",
            "Duodenal atresia presents with the double-bubble sign and bilious emesis, treated curatively by diamond-shaped duodenoduodenostomy."
        ),
        (
            "A 14-day-old previously healthy infant suddenly develops acute bilious vomiting, abdominal tenderness, and signs of septic shock. Upper GI fluoroscopic contrast series shows the duodenal C-loop failing to cross the midline and a 'corkscrew' twisted appearance of the duodenum. What is the diagnosis and urgent surgical operation?",
            ["Intestinal malrotation with midgut volvulus; emergency Ladd procedure",
             "Hypertrophic pyloric stenosis; Ramstedt pyloromyotomy",
             "Hirschsprung disease; Soave pull-through",
             "Necrotizing enterocolitis; peritoneal drain"],
            "Malrotation with midgut volvulus is a life-threatening surgical emergency. Twisting of the narrow mesentery around the superior mesenteric vessels leads to total midgut ischemia. Immediate emergency Ladd procedure (counterclockwise detorsion, division of Ladd bands, widening of the mesentery, appendectomy, placement of bowel in non-rotated position) is required.",
            "Midgut volvulus is a catastrophic surgical emergency requiring immediate Ladd procedure to relieve mesenteric vascular torsion."
        ),
        (
            "What are the classical surgical steps of the Ladd procedure for intestinal malrotation with midgut volvulus?",
            ["Counterclockwise detorsion of the volvulus, division of peritoneal Ladd bands, widening of the narrow mesenteric base, and incidental appendectomy",
             "Primary resection of the entire small bowel with end-to-end anastomosis",
             "Clockwise twisting of the cecum with cecopexy to the right iliac fossa",
             "Duodenoduodenostomy with retroperitoneal fixation"],
            "The Ladd procedure comprises four essential steps: 1) counterclockwise detorsion of the midgut; 2) division of peritoneal Ladd bands compressing the duodenum; 3) widening of the mesenteric base to prevent recurrent volvulus; and 4) incidental appendectomy (placing cecum in the left abdomen).",
            "The Ladd procedure consists of counterclockwise detorsion, division of Ladd bands, widening of the mesentery, and appendectomy."
        ),
        (
            "A premature infant born at 28 weeks gestation weighing 950 grams on formula feedings develops feeding intolerance, abdominal distension, and hematochezia. Abdominal radiograph reveals linear gas bubbles within the bowel wall (pneumatosis intestinalis) and branching gas in the portal vein. What is the diagnosis?",
            ["Necrotizing enterocolitis (NEC, Bell Stage II/III)",
             "Meconium peritonitis",
             "Spontaneous intestinal perforation",
             "Congenital megacolon"],
            "Necrotizing enterocolitis (NEC) is the most common gastrointestinal emergency in premature infants, triggered by immaturity of intestinal barrier, enteral feedings, and bacterial colonization. Pathognomonic radiographic signs include pneumatosis intestinalis and portal venous gas.",
            "Pneumatosis intestinalis and branching portal venous gas are pathognomonic hallmarks of acute necrotizing enterocolitis (NEC)."
        ),
        (
            "In an extremely low birth weight (< 1000 g) critically unstable infant with perforated necrotizing enterocolitis showing pneumoperitoneum on cross-table radiography, what initial bedside surgical procedure is indicated?",
            ["Bedside peritoneal drainage (peritoneal drain placement in the right lower quadrant under local anesthesia)",
             "Immediate transport to the operating room for total bowel resection",
             "High-pressure barium enema",
             "Immediate placement of a feeding jejunostomy"],
            "For critically ill, unstable extremely low birth weight infants (< 1000 g) too fragile to tolerate general anesthesia and laparotomy, primary bedside peritoneal drain placement decompresses tension pneumoperitoneum and stabilizes the infant.",
            "Primary bedside peritoneal drainage is indicated for extremely low birth weight, unstable neonates with perforated NEC."
        ),
        (
            "What clinical feature distinguishes gastroschisis from omphalocele at birth?",
            ["Gastroschisis is a full-thickness right paraumbilical abdominal wall defect without a protective covering sac, whereas omphalocele is a midline defect covered by a three-layer amnioperitoneal membrane",
             "Gastroschisis is covered by an intact peritoneal membrane while omphalocele is naked",
             "Gastroschisis is strongly associated with trisomies 13 and 18 while omphalocele is not",
             "Gastroschisis always contains the liver within the defect"],
            "Gastroschisis is an uncovered full-thickness defect to the right of an intact umbilical cord, with eviscerated bowel exposed to amniotic fluid (inflamed and thickened). Omphalocele is a midline umbilical ring defect enclosed by a protective membrane (peritoneum, Wharton jelly, amnion) with high associated chromosomal/cardiac anomalies.",
            "Gastroschisis is a naked right paraumbilical defect lacking a sac, whereas omphalocele is a membrane-covered midline defect."
        ),
        (
            "A newborn infant born with severe respiratory distress, scaphoid abdomen, and absent left breath sounds with heart sounds shifted to the right hemithorax is diagnosed with congenital diaphragmatic hernia (CDH). What is the primary determinant of mortality and initial resuscitation priority?",
            ["Pulmonary hypoplasia and persistent pulmonary hypertension (PPHN); immediate endotracheal intubation avoiding bag-mask ventilation",
             "Size of the diaphragmatic defect alone; immediate emergency repair in the delivery room",
             "Bowel ischemia within the chest; immediate laparotomy within 1 hour",
             "Right ventricular outflow tract obstruction; urgent balloon valvuloplasty"],
            "Mortality in CDH is driven by pulmonary hypoplasia and persistent pulmonary hypertension (PPHN). Initial management prioritizes gentle ventilation (avoiding bag-mask which inflates bowel and worsens lung compression) and medical stabilization; surgery is elective once pulmonary pressures normalize.",
            "Survival in CDH is determined by pulmonary hypoplasia and hypertension; bag-mask ventilation is contraindicated."
        ),
        (
            "Through which anatomical defect in the diaphragm do approximately 85 to 90 percent of congenital diaphragmatic hernias occur?",
            ["Posterolateral pleuroperitoneal foramen of Bochdalek (predominantly left-sided)",
             "Anteromedial retrosternal space of Morgagni",
             "Esophageal hiatus",
             "Central tendon of the diaphragm"],
            "Bochdalek hernias account for 85 to 90 percent of CDH cases, resulting from failure of pleuroperitoneal canal closure posterolaterally, occurring on the left side in 85 percent of cases due to earlier closure of the right pleuroperitoneal canal.",
            "Bochdalek diaphragmatic hernia occurs through the posterolateral pleuroperitoneal canal, predominantly on the left side."
        )
    ])
]
