# Part 2a Data: Modules 11 to 15
# sur-cardiac, sur-brain-tumours, sur-hydrocephalus, sur-paed-gi, sur-neonatal

LESSONS_11_15 = [
    # 11. sur-cardiac
    {
        "module": "sur-cardiac",
        "subject": "surgery",
        "title": "Coronary artery bypass grafting, valvular heart disease, and cardiopulmonary bypass",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Kirklin/Barratt-Boyes Cardiac Surgery 4th ed"],
        "steps": [
            {
                "tx": "Coronary artery bypass grafting represents the definitive surgical revascularization modality for complex multivessel **coronary** artery disease. Established anatomical indications include significant left main coronary artery stenosis exceeding fifty percent, three-vessel coronary disease with proximal left anterior descending involvement, or two-vessel disease in diabetic patients with impaired left ventricular ejection fraction. The SYNTAX score quantifies coronary lesion complexity, guiding multidisciplinary Heart Team decisions between percutaneous coronary intervention and surgical bypass.",
                "say": "Coronary artery bypass grafting is indicated for left main stenosis exceeding fifty percent, three-vessel disease, or multivessel disease in diabetic patients. The SYNTAX score assesses lesion complexity to direct treatment between stenting and bypass.",
                "vis": {
                    "kind": "table",
                    "cols": ["Anatomical lesion pattern", "Clinical indication threshold", "Recommended revascularization"],
                    "rows": [
                        ["Left main coronary stenosis", "Stenosis >= 50 percent", "Coronary artery bypass grafting (CABG)"],
                        ["Three-vessel CAD with diabetes", "Multivessel diffuse disease", "CABG provides superior survival"],
                        ["Single or two-vessel disease", "Isolated non-LAD stenosis", "Percutaneous coronary intervention (PCI)"],
                        ["Acute coronary syndrome / shock", "Emergent cardiogenic collapse", "Emergency bypass or primary PCI"]
                    ]
                }
            },
            {
                "tx": "Conduit selection determines long-term graft **patency** following coronary bypass surgery. The left internal mammary artery anastomosed to the left anterior descending coronary artery represents the undisputed gold standard conduit, demonstrating ten-year patency rates exceeding ninety percent and conferring significant long-term survival advantage. Supplemental arterial conduits include the radial artery, which achieves higher patency than saphenous veins when target stenosis exceeds seventy percent. Autologous great saphenous veins remain widely utilized for multivessel grafting.",
                "say": "The left internal mammary artery grafted to the left anterior descending artery is the gold standard conduit, providing ninety percent ten-year patency. Supplemental conduits include the radial artery and autologous great saphenous vein.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Multivessel coronary disease identified"},
                        {"id": "n2", "label": "Harvest left internal mammary artery (LIMA)"},
                        {"id": "n3", "label": "Supplemental radial artery or saphenous vein"},
                        {"id": "n4", "label": "LIMA to LAD anastomosis constructed"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Surgical intervention for aortic stenosis is indicated upon onset of angina, syncope, or heart failure **symptoms**, or in asymptomatic patients with aortic valve area under one square centimeter and mean transvalvular gradient exceeding forty millimeters of mercury. Transcatheter aortic valve replacement represents the preferred approach in elderly or high-risk surgical candidates. For severe primary mitral regurgitation, surgical mitral valve repair utilizing an annuloplasty ring and leaflet reconstruction achieves superior survival compared to complete valve replacement.",
                "say": "Aortic valve replacement is indicated for symptomatic severe stenosis with valve area under one square centimeter. Transcatheter replacement is favored in high-risk patients. Mitral valve repair is preferred over replacement for primary mitral regurgitation.",
                "vis": {
                    "kind": "table",
                    "cols": ["Valvular heart lesion", "Surgical indication criteria", "Preferred operative procedure"],
                    "rows": [
                        ["Severe aortic stenosis", "Valve area < 1.0 cm2 & symptoms", "Surgical (SAVR) or transcatheter (TAVR)"],
                        ["Severe mitral regurgitation", "Symptomatic or EF <= 60%", "Mitral valve repair with annuloplasty"],
                        ["Aortic regurgitation", "LV end-systolic dimension > 50 mm", "Aortic valve replacement / root repair"],
                        ["Tricuspid regurgitation", "Severe secondary annular dilation", "Tricuspid annuloplasty ring repair"]
                    ]
                }
            },
            {
                "tx": "Cardiopulmonary bypass temporarily assumes the physiological **functions** of the heart and lungs, consisting of venous cannulation, a membrane oxygenator, a roller or centrifugal systemic perfusion pump, and an arterial return cannula in the ascending aorta. Systemic anticoagulation with high-dose heparin targeting an activated clotting time exceeding four hundred and eighty seconds is mandatory before initiating bypass. Hypothermic potassium cardioplegia arrests the heart in diastole, while protamine sulfate neutralizes heparin following separation.",
                "say": "Cardiopulmonary bypass oxygenates and pumps blood during cardiac arrest. High-dose heparin maintains activated clotting time above four hundred and eighty seconds. Potassium cardioplegia arrests the myocardium in diastole, neutralized with protamine after bypass.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "On-Pump Cardiac Surgery", "bullets": ["Cardiopulmonary bypass with cardiac arrest", "Still, bloodless surgical operative field", "Requires full heparinization (ACT > 480 s)"]},
                    "b": {"title": "Off-Pump Coronary Surgery", "bullets": ["Beating heart surgery using stabilizers", "Avoids aortic cross-clamping & CPB circuit", "Technically challenging for circumflex vessels"]}
                }
            }
        ]
    },

    # 12. sur-brain-tumours
    {
        "module": "sur-brain-tumours",
        "subject": "surgery",
        "title": "Intracranial neoplasms, glioblastoma multiforme, meningioma, and maximal safe resection",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Youmans Neurological Surgery 7th ed"],
        "steps": [
            {
                "tx": "Secondary brain metastases represent the most frequent intracranial **neoplasms** in adult patients, originating predominantly from primary carcinomas of the lung, breast, skin melanoma, kidney, and colon. Among primary brain tumors, glioblastoma represents the most common and aggressive malignant histological subtype. Histopathological hallmarks include dense nuclear pleomorphism, microvascular endothelial proliferation, and prominent pseudopalisading geographic necrosis. Mutations in isocitrate dehydrogenase define distinct molecular prognostic subgroups, with IDH-wildtype conferring worse clinical outcomes.",
                "say": "Metastatic brain tumors from lung, breast, and melanoma are the most common adult intracranial neoplasms. Glioblastoma is the most frequent primary malignant brain tumor, characterized histologically by pseudopalisading necrosis and microvascular proliferation.",
                "vis": {
                    "kind": "table",
                    "cols": ["Brain tumor category", "Microscopic histopathology", "Molecular / genetic marker"],
                    "rows": [
                        ["Glioblastoma (Grade 4)", "Pseudopalisading necrosis & vessels", "IDH-wildtype / MGMT promoter"],
                        ["Oligodendroglioma", "Fried-egg cells with round nuclei", "1p/19q co-deletion & IDH mutant"],
                        ["Meningioma (Grade 1)", "Psammoma bodies & whorled cells", "NF2 gene alteration (chromosome 22)"],
                        ["Vestibular schwannoma", "Antoni A & Antoni B spindle cells", "Bilateral tumors indicate NF2"]
                    ]
                }
            },
            {
                "tx": "Meningiomas arise from arachnoid cap **cells** of the leptomeninges, representing the most common benign extra-axial intracranial tumor. They demonstrate a characteristic dural tail of enhancement on contrast-enhanced magnetic resonance imaging and contain laminated calcified psammoma bodies microscopically. Vestibular schwannomas develop from the Schwann cell sheath of the inferior vestibular nerve within the internal auditory canal, producing progressive unilateral sensorineural hearing loss and tinnitus, with bilateral lesions serving as the pathognomonic hallmark of neurofibromatosis type 2.",
                "say": "Meningiomas arise from arachnoid cap cells, presenting as extra-axial masses with a characteristic dural tail on MRI. Vestibular schwannomas arise from the vestibular nerve, producing progressive unilateral sensorineural hearing loss.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "New onset focal deficit or seizure"},
                        {"id": "n2", "label": "Gadolinium-enhanced brain MRI"},
                        {"id": "n3", "label": "Differentiate intra-axial from extra-axial"},
                        {"id": "n4", "label": "Image-guided stereotactic craniotomy"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Patients present clinically with generalized features of raised intracranial **pressure** including morning headaches, nausea, projectile vomiting, and bilateral papilledema, alongside focal neurological deficits or new-onset adult epileptic seizures. Magnetic resonance imaging with intravenous gadolinium contrast constitutes the definitive imaging modality of choice. High-grade gliomas display intense peripheral rim enhancement with central non-enhancing necrosis and extensive surrounding vasogenic edema that characteristically respects the cortical grey-white matter boundary.",
                "say": "Brain tumors present with morning headaches, vomiting, papilledema, and seizures. Contrast-enhanced MRI is the diagnostic gold standard, displaying peripheral rim enhancement and central necrosis in glioblastomas.",
                "vis": {
                    "kind": "table",
                    "cols": ["Clinical presentation feature", "Underlying neurological mechanism", "Diagnostic evaluation"],
                    "rows": [
                        ["Morning headache & vomiting", "Raised ICP peaking with recumbency", "Fundoscopy for papilledema"],
                        ["New-onset adult seizures", "Cortical irritation & vasogenic edema", "Electroencephalography & MRI"],
                        ["Unilateral hearing loss", "Cerebellopontine angle compression", "Pure tone audiometry & MRI IAC"],
                        ["Bitemporal hemianopia", "Optic chiasm compression by pituitary", "Visual field testing & sella MRI"]
                    ]
                }
            },
            {
                "tx": "The cornerstone of surgical management is maximal safe **resection**, utilizing stereotactic neuronavigation, intraoperative functional MRI, and awake craniotomy with cortical mapping when tumors abut eloquent motor or language cortex. Oral 5-aminolevulinic acid facilitates intraoperative fluorescence-guided visualization of infiltrating tumor margins under blue light. For glioblastoma, the Stupp protocol following surgical debulking combines fractionated focal external beam radiation with concurrent and adjuvant temozolomide chemotherapy, yielding superior survival when the MGMT promoter is methylated.",
                "say": "Maximal safe surgical resection utilizing neuronavigation and awake mapping provides the foundation of care. Glioblastoma is treated adjuvantly with the Stupp protocol of radiation and temozolomide chemotherapy.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Intra-Axial Glioma Surgery", "bullets": ["Maximal safe resection within parenchyma", "Awake mapping for eloquent speech areas", "5-ALA fluorescence identifies tumor edges"]},
                    "b": {"title": "Extra-Axial Meningioma Surgery", "bullets": ["Simpson grade complete excision of dural base", "Cavitron ultrasonic aspirator debulking", "Curative when complete resection achieved"]}
                }
            }
        ]
    },

    # 13. sur-hydrocephalus
    {
        "module": "sur-hydrocephalus",
        "subject": "surgery",
        "title": "Cerebrospinal fluid dynamics, hydrocephalus classification, ventriculoperitoneal shunting, and ETV",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Youmans Neurological Surgery 7th ed"],
        "steps": [
            {
                "tx": "Cerebrospinal fluid is produced continuously by choroid plexus ependymal **cells** within the lateral, third, and fourth cerebral ventricles at an average rate of five hundred milliliters daily. The total circulating adult cerebrospinal fluid volume approximates one hundred and fifty milliliters. Cerebrospinal fluid circulates from the lateral ventricles through the paired foramina of Monro into the third ventricle, passes down the narrow cerebral aqueduct of Sylvius into the fourth ventricle, and exits through the median Magendie and lateral Luschka foramina.",
                "say": "Cerebrospinal fluid is produced by the choroid plexus at five hundred milliliters per day, maintaining a circulating volume of one hundred and fifty milliliters. It circulates through the ventricles and aqueduct before entering the subarachnoid space.",
                "vis": {
                    "kind": "table",
                    "cols": ["Anatomical CSF pathway", "Connection / conduit structure", "Drainage destination"],
                    "rows": [
                        ["Lateral ventricles", "Foramina of Monro (interventricular)", "Third ventricle lumen"],
                        ["Third ventricle", "Cerebral aqueduct of Sylvius (midbrain)", "Fourth ventricle lumen"],
                        ["Fourth ventricle", "Foramina of Luschka and Magendie", "Basal cisterns & subarachnoid space"],
                        ["Subarachnoid space", "Arachnoid granulations / villi", "Superior sagittal dural venous sinus"]
                    ]
                }
            },
            {
                "tx": "Hydrocephalus is fundamentally classified as non-communicating or **communicating** based upon the anatomical site of flow disruption. Non-communicating obstructive hydrocephalus arises from internal ventricular obstruction, most commonly aqueductal stenosis, posterior fossa neoplasms compressing the fourth ventricle, or colloid cysts of the third ventricle. Communicating hydrocephalus results from impaired cerebrospinal fluid reabsorption at the level of arachnoid granulations, classically developing secondary to post-meningitic fibrosis, subarachnoid hemorrhage, or diffuse carcinomatous leptomeningeal infiltration.",
                "say": "Non-communicating hydrocephalus results from physical blockage within the ventricular system such as aqueductal stenosis. Communicating hydrocephalus arises from impaired absorption at the arachnoid villi following meningitis or hemorrhage.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Ventriculomegaly on neuroimaging"},
                        {"id": "n2", "label": "Assess fourth ventricle size & patency"},
                        {"id": "n3", "label": "Distinguish obstructive from communicating"},
                        {"id": "n4", "label": "Select VP shunt vs endoscopic third ventriculostomy"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Normal pressure hydrocephalus represents a distinct communicating **syndrome** occurring in elderly adults, characterized by the pathognomonic clinical triad of Adams and Hakim: progressive gait apraxia, urinary urge incontinence, and subcortical dementia. The classic gait is magnetic, wide-based, and short-stepped. Neuroimaging reveals marked ventriculomegaly disproportionate to sulcal cerebral atrophy. A diagnostic lumbar puncture removing forty to fifty milliliters of fluid yielding temporary clinical gait improvement strongly predicts favorable responsiveness to ventriculoperitoneal shunting.",
                "say": "Normal pressure hydrocephalus presents with gait apraxia, urinary incontinence, and dementia. Significant ventriculomegaly with normal opening pressure on lumbar puncture and gait improvement after tap test predicts surgical shunt success.",
                "vis": {
                    "kind": "table",
                    "cols": ["Clinical triad component", "Physical examination manifestation", "Expected response to shunt"],
                    "rows": [
                        ["Gait disturbance", "Magnetic, shuffling, wide-based steps", "Most responsive to CSF diversion"],
                        ["Urinary incontinence", "Urgency advancing to complete loss", "Moderately responsive to diversion"],
                        ["Cognitive impairment", "Psychomotor slowing & executive defect", "Least responsive / variable recovery"],
                        ["Lumbar tap test", "Removal of 40-50 mL cerebrospinal fluid", "Confirms dynamic gait improvement"]
                    ]
                }
            },
            {
                "tx": "Ventriculoperitoneal shunting represents the primary definitive treatment for communicating hydrocephalus, **diverting** excess fluid from the lateral ventricle into the peritoneal cavity through a subcutaneous valve-regulated silicone catheter. Complications include mechanical catheter obstruction, overdrainage with chronic subdural hematomas, and shunt infection predominantly caused by Staphylococcus epidermidis. For obstructive non-communicating hydrocephalus, endoscopic third ventriculostomy creates an opening in the floor of the third ventricle into the prepontine cistern, providing physiological internal diversion without permanent prosthetic hardware.",
                "say": "Ventriculoperitoneal shunts divert fluid from the lateral ventricle into the peritoneal cavity. For obstructive hydrocephalus, endoscopic third ventriculostomy creates a bypass fenestration in the floor of the third ventricle, avoiding foreign shunt hardware.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Ventriculoperitoneal (VP) Shunt", "bullets": ["Diverts CSF to peritoneal cavity via valve", "Standard therapy for communicating hydrocephalus", "Risks: blockage, infection & subdural hematoma"]},
                    "b": {"title": "Endoscopic Third Ventriculostomy", "bullets": ["Fenestrates floor of third ventricle into cistern", "Procedure of choice for aqueductal stenosis", "Zero foreign hardware implanted"]}
                }
            }
        ]
    },

    # 14. sur-paed-gi
    {
        "module": "sur-paed-gi",
        "subject": "surgery",
        "title": "Paediatric gastrointestinal emergencies, hypertrophic pyloric stenosis, intussusception, and Ladd procedure",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Holcomb and Ashcraft's Pediatric Surgery 7th ed"],
        "steps": [
            {
                "tx": "Infantile hypertrophic pyloric stenosis arises from hypertrophy and hyperplasia of the circular pyloric smooth **muscle**, producing severe gastric outlet obstruction in infants aged three to six weeks. It occurs predominantly in first-born males, manifesting with non-bilious projectile vomiting immediately after feeding and a palpable olive-shaped mass in the right epigastrium. Persistent gastric loss of hydrochloric acid causes classic hypochloremic, hypokalemic metabolic alkalosis with paradoxical aciduria. Transverse abdominal ultrasonography demonstrates pyloric muscle thickness exceeding three millimeters and channel length exceeding fifteen millimeters.",
                "say": "Hypertrophic pyloric stenosis presents in infants aged three to six weeks with non-bilious projectile vomiting and an epigastric olive mass. It produces hypochloremic hypokalemic metabolic alkalosis, with ultrasound showing muscle thickness over three millimeters.",
                "vis": {
                    "kind": "table",
                    "cols": ["Diagnostic parameter", "Threshold diagnostic criterion", "Clinical / laboratory significance"],
                    "rows": [
                        ["Pyloric muscle thickness", "Greater than or equal to 3.0 mm", "Confirms hypertrophic circular muscle"],
                        ["Pyloric channel length", "Greater than or equal to 15 mm", "Elongated gastric outlet channel"],
                        ["Serum chloride level", "Less than 98 mmol/L", "Profound hypochloremia from vomitus"],
                        ["Blood gas evaluation", "Elevated serum bicarbonate & pH", "Metabolic alkalosis requiring saline"]
                    ]
                }
            },
            {
                "tx": "Electrolyte and fluid resuscitation with isotonic saline takes absolute precedence over operative **intervention**, because performing general anesthesia in an alkalotic infant risks severe postoperative apnea. Once serum chloride exceeds one hundred milliequivalents per liter, Ramstedt extramucosal pyloromyotomy is curative. The surgeon divides the hypertrophic circular pyloric muscle down to the bulging, intact submucosa. Meticulous inspection for mucosal perforation followed by air insufflation through an orogastric tube is mandatory prior to abdominal wall closure.",
                "say": "Isotonic saline resuscitation to normalize chloride and acid-base status is mandatory before surgery to avoid anesthetic apnea. Ramstedt pyloromyotomy divides the circular muscle down to intact submucosa without entering the mucosal lumen.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Non-bilious projectile vomiting in infant"},
                        {"id": "n2", "label": "Diagnose hypochloremic alkalosis on labs"},
                        {"id": "n3", "label": "Resuscitate with normal saline & potassium"},
                        {"id": "n4", "label": "Ramstedt extramucosal pyloromyotomy"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Intussusception involves the invagination of a proximal bowel segment into an immediately distal bowel **lumen**, most commonly ileocolic in infants aged six to twenty-four months. The classic triad includes intermittent severe colicky abdominal pain with drawing up of legs, vomiting, and passage of red currant jelly stools containing mucus and blood. Abdominal ultrasound displays the pathognomonic target or doughnut sign. Non-operative reduction utilizing pneumatic or hydrostatic enema is the primary treatment of choice, provided peritonitis, bowel perforation, and septic shock are absent.",
                "say": "Ileocolic intussusception presents in toddlers with severe colicky pain, leg flexion, vomiting, and red currant jelly stools. Ultrasonography reveals a target sign. Pneumatic enema reduction is first-line in the absence of peritonitis.",
                "vis": {
                    "kind": "table",
                    "cols": ["Intussusception feature", "Clinical manifestation", "Management rule"],
                    "rows": [
                        ["Classic triad", "Colicky pain, vomiting, red currant jelly stool", "Present complete in under 50%"],
                        ["Ultrasound appearance", "Transverse target / longitudinal pseudokidney", "Diagnostic sensitivity > 98%"],
                        ["Pneumatic reduction", "Air insufflation up to 120 mmHg under fluoroscopy", "Successful reduction in > 85%"],
                        ["Operative indication", "Peritonitis, perforation, or failed enema", "Manual reduction or segmental resection"]
                    ]
                }
            },
            {
                "tx": "Midgut malrotation results from failure of normal embryonic 270-degree counterclockwise gut **rotation** around the superior mesenteric artery, leaving a narrow mesenteric base prone to clockwise torsion and catastrophic midgut volvulus. Sudden onset of bilious vomiting in a previously thriving neonate represents midgut volvulus until proven otherwise. Upper gastrointestinal contrast radiography reveals the duodenojejunal junction displaced to the right of the spine and a corkscrew duodenum. Emergency surgical exploration via the Ladd procedure detorses the volvulus, divides adhesive Ladd bands, widens the mesenteric base, and performs appendectomy.",
                "say": "Bilious vomiting in a newborn is midgut volvulus until proven otherwise. Upper gastrointestinal contrast series demonstrates a corkscrew duodenum. Emergency Ladd procedure detorses the bowel, divides Ladd bands, and widens the mesenteric base.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Pyloric Stenosis", "bullets": ["Non-bilious projectile vomiting", "Age 3 to 6 weeks; olive mass", "Hypochloremic metabolic alkalosis"]},
                    "b": {"title": "Midgut Volvulus", "bullets": ["Acute bilious green vomiting in newborn", "Narrow mesenteric root twists on SMA", "Surgical emergency: Ladd procedure"]}
                }
            }
        ]
    },

    # 15. sur-neonatal
    {
        "module": "sur-neonatal",
        "subject": "surgery",
        "title": "Neonatal surgical anomalies, esophageal atresia, diaphragmatic hernia, and abdominal wall defects",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Holcomb and Ashcraft's Pediatric Surgery 7th ed"],
        "steps": [
            {
                "tx": "Esophageal atresia occurs in one in three thousand live births, with eighty-five percent **exhibiting** Gross type C anomaly characterized by a blind proximal esophageal pouch and a distal tracheoesophageal fistula. Neonates present immediately after birth with copious foaming saliva, frothing at the mouth, and coughing, choking, and cyanosis upon feeding. Inability to pass a rigid 10 French nasogastric tube into the stomach, with the catheter coiling in the upper thoracic pouch on plain radiograph, establishes the diagnosis. Presence of gastrointestinal gas confirms a distal tracheoesophageal fistula.",
                "say": "Esophageal atresia with distal tracheoesophageal fistula presents with excessive frothy salivation, choking on feeding, and an inability to pass an orogastric tube. Plain radiography confirms coiling in the upper pouch, while abdominal gas indicates a distal fistula.",
                "vis": {
                    "kind": "table",
                    "cols": ["EA/TEF anatomical subtype", "Gross anatomical arrangement", "Abdominal bowel gas status"],
                    "rows": [
                        ["Type C (85% of cases)", "Proximal atresia with distal TEF", "Gas present in stomach & bowel"],
                        ["Type A (Isolated EA 8%)", "Pure atresia without fistula", "Gasless abdomen on radiograph"],
                        ["Type E (H-type TEF 4%)", "Fistula without esophageal atresia", "Normal gas; recurrent aspirations"],
                        ["Type B (Proximal TEF 2%)", "Proximal fistula with distal atresia", "Gasless abdomen on radiograph"]
                    ]
                }
            },
            {
                "tx": "Concomitant congenital anomalies occur in over half of infants with esophageal atresia, **necessitating** systematic screening for the VACTERL association: vertebral defects, anal atresia, cardiac anomalies, tracheoesophageal fistula, renal dysplasia, and limb radial abnormalities. Preoperative care focuses on continuous suctioning of the proximal pouch with a Replogle tube and upright positioning to minimize acid reflux into the tracheobronchial tree. Primary surgical repair through a right extrapleural thoracotomy or thoracoscopy ligates the fistula and achieves end-to-end esophageal anastomosis.",
                "say": "Infants with esophageal atresia require evaluation for the VACTERL association, especially echocardiography for congenital cardiac defects. Preoperative Replogle pouch suction prevents aspiration before extrapleural fistula division and esophageal repair.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Frothing saliva in newborn infant"},
                        {"id": "n2", "label": "NG tube coils in upper pouch on X-ray"},
                        {"id": "n3", "label": "Echocardiogram & VACTERL screening"},
                        {"id": "n4", "label": "Extrapleural fistula ligation & repair"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Congenital diaphragmatic hernia arises from failure of the pleuroperitoneal **membrane** to close at eight to ten weeks gestation, most frequently occurring through the posterolateral foramen of Bochdalek on the left side in eighty-five percent of cases. Abdominal viscera herniate into the thoracic cavity, impairing lung bud branching and producing profound ipsilateral and contralateral pulmonary hypoplasia with persistent pulmonary hypertension of the newborn. Neonates present with severe respiratory distress, a scaphoid abdomen, and bowel sounds audible in the hemithorax.",
                "say": "Congenital diaphragmatic hernia results from failure of pleuroperitoneal membrane closure, usually left-sided through the foramen of Bochdalek. Evisceration of viscera causes severe pulmonary hypoplasia and persistent pulmonary hypertension with a scaphoid abdomen.",
                "vis": {
                    "kind": "table",
                    "cols": ["Diaphragmatic defect type", "Anatomical defect location", "Pathophysiological consequence"],
                    "rows": [
                        ["Bochdalek hernia (85%)", "Posterolateral pleuroperitoneal canal", "Severe bilateral pulmonary hypoplasia"],
                        ["Morgagni hernia (5%)", "Anterior retrosternal parasternal space", "Often asymptomatic until late childhood"],
                        ["Pulmonary hypoplasia", "Decreased bronchial branching & alveoli", "Hypercarbic respiratory failure"],
                        ["Persistent PPHN", "Hypertrophied pulmonary vascular media", "Severe right-to-left ductal shunting"]
                    ]
                }
            },
            {
                "tx": "Omphalocele represents a midline abdominal wall defect at the **umbilicus** covered by a three-layer sac composed of peritoneum, Wharton jelly, and amnion, with the umbilical cord inserting directly onto the apex of the sac. Over fifty percent of omphalocele infants harbor severe associated chromosomal anomalies, congenital heart defects, or Beckwith-Wiedemann syndrome. Gastroschisis, by contrast, is a full-thickness defect located immediately to the right of an intact umbilical cord without a covering membrane, leaving thickened, edematous bowel eviscerated into amniotic fluid.",
                "say": "Omphalocele is a midline defect covered by a sac with high chromosomal and cardiac associations. Gastroschisis is a full-thickness defect to the right of an intact umbilical ring without a sac, with low chromosomal associations.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Omphalocele", "bullets": ["Midline defect at the umbilical ring", "Covered by intact peritoneal/amniotic sac", "Umbilical cord inserts onto the sac", "High chromosomal/cardiac association (> 50%)"]},
                    "b": {"title": "Gastroschisis", "bullets": ["Full-thickness defect to right of cord", "No covering sac; bowel exposed to amniotic fluid", "Umbilical cord inserts normally on body wall", "Rarely associated with extraintestinal anomalies"]}
                }
            }
        ]
    }
]
