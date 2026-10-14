/**
 * Wave 4B Surgical Lessons: Part 2 (Modules 11-20)
 */

export const wave4bLessonsPart2 = [
  {
    "module": "sur-cardiac",
    "subject": "surgery",
    "title": "Coronary artery bypass grafting, valvular heart disease, and cardiopulmonary bypass",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Kirklin/Barratt-Boyes Cardiac Surgery 4th ed"
    ],
    "steps": [
      {
        "tx": "Coronary artery bypass grafting represents the definitive surgical revascularization modality for complex multivessel **coronary** artery disease. Established anatomical indications include significant left main coronary artery stenosis exceeding fifty percent, three-vessel coronary disease with proximal left anterior descending involvement, or two-vessel disease in diabetic patients with impaired left ventricular ejection fraction. The SYNTAX score quantifies coronary lesion complexity, guiding multidisciplinary Heart Team decisions between percutaneous coronary intervention and surgical bypass.",
        "say": "Coronary artery bypass grafting is indicated for left main stenosis exceeding fifty percent, three-vessel disease, or multivessel disease in diabetic patients. The SYNTAX score assesses lesion complexity to direct treatment between stenting and bypass.",
        "vis": {
          "kind": "table",
          "cols": [
            "Anatomical lesion pattern",
            "Clinical indication threshold",
            "Recommended revascularization"
          ],
          "rows": [
            [
              "Left main coronary stenosis",
              "Stenosis >= 50 percent",
              "Coronary artery bypass grafting (CABG)"
            ],
            [
              "Three-vessel CAD with diabetes",
              "Multivessel diffuse disease",
              "CABG provides superior survival"
            ],
            [
              "Single or two-vessel disease",
              "Isolated non-LAD stenosis",
              "Percutaneous coronary intervention (PCI)"
            ],
            [
              "Acute coronary syndrome / shock",
              "Emergent cardiogenic collapse",
              "Emergency bypass or primary PCI"
            ]
          ]
        }
      },
      {
        "tx": "Conduit selection determines long-term graft **patency** following coronary bypass surgery. The left internal mammary artery anastomosed to the left anterior descending coronary artery represents the undisputed gold standard conduit, demonstrating ten-year patency rates exceeding ninety percent and conferring significant long-term survival advantage. Supplemental arterial conduits include the radial artery, which achieves higher patency than saphenous veins when target stenosis exceeds seventy percent. Autologous great saphenous veins remain widely utilized for multivessel grafting.",
        "say": "The left internal mammary artery grafted to the left anterior descending artery is the gold standard conduit, providing ninety percent ten-year patency. Supplemental conduits include the radial artery and autologous great saphenous vein.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Multivessel coronary disease identified"
            },
            {
              "id": "n2",
              "label": "Harvest left internal mammary artery (LIMA)"
            },
            {
              "id": "n3",
              "label": "Supplemental radial artery or saphenous vein"
            },
            {
              "id": "n4",
              "label": "LIMA to LAD anastomosis constructed"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Surgical intervention for aortic stenosis is indicated upon onset of angina, syncope, or heart failure **symptoms**, or in asymptomatic patients with aortic valve area under one square centimeter and mean transvalvular gradient exceeding forty millimeters of mercury. Transcatheter aortic valve replacement represents the preferred approach in elderly or high-risk surgical candidates. For severe primary mitral regurgitation, surgical mitral valve repair utilizing an annuloplasty ring and leaflet reconstruction achieves superior survival compared to complete valve replacement.",
        "say": "Aortic valve replacement is indicated for symptomatic severe stenosis with valve area under one square centimeter. Transcatheter replacement is favored in high-risk patients. Mitral valve repair is preferred over replacement for primary mitral regurgitation.",
        "vis": {
          "kind": "table",
          "cols": [
            "Valvular heart lesion",
            "Surgical indication criteria",
            "Preferred operative procedure"
          ],
          "rows": [
            [
              "Severe aortic stenosis",
              "Valve area < 1.0 cm2 & symptoms",
              "Surgical (SAVR) or transcatheter (TAVR)"
            ],
            [
              "Severe mitral regurgitation",
              "Symptomatic or EF <= 60%",
              "Mitral valve repair with annuloplasty"
            ],
            [
              "Aortic regurgitation",
              "LV end-systolic dimension > 50 mm",
              "Aortic valve replacement / root repair"
            ],
            [
              "Tricuspid regurgitation",
              "Severe secondary annular dilation",
              "Tricuspid annuloplasty ring repair"
            ]
          ]
        }
      },
      {
        "tx": "Cardiopulmonary bypass temporarily assumes the physiological **functions** of the heart and lungs, consisting of venous cannulation, a membrane oxygenator, a roller or centrifugal systemic perfusion pump, and an arterial return cannula in the ascending aorta. Systemic anticoagulation with high-dose heparin targeting an activated clotting time exceeding four hundred and eighty seconds is mandatory before initiating bypass. Hypothermic potassium cardioplegia arrests the heart in diastole, while protamine sulfate neutralizes heparin following separation.",
        "say": "Cardiopulmonary bypass oxygenates and pumps blood during cardiac arrest. High-dose heparin maintains activated clotting time above four hundred and eighty seconds. Potassium cardioplegia arrests the myocardium in diastole, neutralized with protamine after bypass.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "On-Pump Cardiac Surgery",
            "points": [
              "Cardiopulmonary bypass with cardiac arrest",
              "Still, bloodless surgical operative field",
              "Requires full heparinization (ACT > 480 s)"
            ]
          },
          "right": {
            "title": "Off-Pump Coronary Surgery",
            "points": [
              "Beating heart surgery using stabilizers",
              "Avoids aortic cross-clamping & CPB circuit",
              "Technically challenging for circumflex vessels"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-brain-tumours",
    "subject": "surgery",
    "title": "Intracranial neoplasms, glioblastoma multiforme, meningioma, and maximal safe resection",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Youmans Neurological Surgery 7th ed"
    ],
    "steps": [
      {
        "tx": "Secondary brain metastases represent the most frequent intracranial **neoplasms** in adult patients, originating predominantly from primary carcinomas of the lung, breast, skin melanoma, kidney, and colon. Among primary brain tumors, glioblastoma represents the most common and aggressive malignant histological subtype. Histopathological hallmarks include dense nuclear pleomorphism, microvascular endothelial proliferation, and prominent pseudopalisading geographic necrosis. Mutations in isocitrate dehydrogenase define distinct molecular prognostic subgroups, with IDH-wildtype conferring worse clinical outcomes.",
        "say": "Metastatic brain tumors from lung, breast, and melanoma are the most common adult intracranial neoplasms. Glioblastoma is the most frequent primary malignant brain tumor, characterized histologically by pseudopalisading necrosis and microvascular proliferation.",
        "vis": {
          "kind": "table",
          "cols": [
            "Brain tumor category",
            "Microscopic histopathology",
            "Molecular / genetic marker"
          ],
          "rows": [
            [
              "Glioblastoma (Grade 4)",
              "Pseudopalisading necrosis & vessels",
              "IDH-wildtype / MGMT promoter"
            ],
            [
              "Oligodendroglioma",
              "Fried-egg cells with round nuclei",
              "1p/19q co-deletion & IDH mutant"
            ],
            [
              "Meningioma (Grade 1)",
              "Psammoma bodies & whorled cells",
              "NF2 gene alteration (chromosome 22)"
            ],
            [
              "Vestibular schwannoma",
              "Antoni A & Antoni B spindle cells",
              "Bilateral tumors indicate NF2"
            ]
          ]
        }
      },
      {
        "tx": "Meningiomas arise from arachnoid cap **cells** of the leptomeninges, representing the most common benign extra-axial intracranial tumor. They demonstrate a characteristic dural tail of enhancement on contrast-enhanced magnetic resonance imaging and contain laminated calcified psammoma bodies microscopically. Vestibular schwannomas develop from the Schwann cell sheath of the inferior vestibular nerve within the internal auditory canal, producing progressive unilateral sensorineural hearing loss and tinnitus, with bilateral lesions serving as the pathognomonic hallmark of neurofibromatosis type 2.",
        "say": "Meningiomas arise from arachnoid cap cells, presenting as extra-axial masses with a characteristic dural tail on MRI. Vestibular schwannomas arise from the vestibular nerve, producing progressive unilateral sensorineural hearing loss.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "New onset focal deficit or seizure"
            },
            {
              "id": "n2",
              "label": "Gadolinium-enhanced brain MRI"
            },
            {
              "id": "n3",
              "label": "Differentiate intra-axial from extra-axial"
            },
            {
              "id": "n4",
              "label": "Image-guided stereotactic craniotomy"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Patients present clinically with generalized features of raised intracranial **pressure** including morning headaches, nausea, projectile vomiting, and bilateral papilledema, alongside focal neurological deficits or new-onset adult epileptic seizures. Magnetic resonance imaging with intravenous gadolinium contrast constitutes the definitive imaging modality of choice. High-grade gliomas display intense peripheral rim enhancement with central non-enhancing necrosis and extensive surrounding vasogenic edema that characteristically respects the cortical grey-white matter boundary.",
        "say": "Brain tumors present with morning headaches, vomiting, papilledema, and seizures. Contrast-enhanced MRI is the diagnostic gold standard, displaying peripheral rim enhancement and central necrosis in glioblastomas.",
        "vis": {
          "kind": "table",
          "cols": [
            "Clinical presentation feature",
            "Underlying neurological mechanism",
            "Diagnostic evaluation"
          ],
          "rows": [
            [
              "Morning headache & vomiting",
              "Raised ICP peaking with recumbency",
              "Fundoscopy for papilledema"
            ],
            [
              "New-onset adult seizures",
              "Cortical irritation & vasogenic edema",
              "Electroencephalography & MRI"
            ],
            [
              "Unilateral hearing loss",
              "Cerebellopontine angle compression",
              "Pure tone audiometry & MRI IAC"
            ],
            [
              "Bitemporal hemianopia",
              "Optic chiasm compression by pituitary",
              "Visual field testing & sella MRI"
            ]
          ]
        }
      },
      {
        "tx": "The cornerstone of surgical management is maximal safe **resection**, utilizing stereotactic neuronavigation, intraoperative functional MRI, and awake craniotomy with cortical mapping when tumors abut eloquent motor or language cortex. Oral 5-aminolevulinic acid facilitates intraoperative fluorescence-guided visualization of infiltrating tumor margins under blue light. For glioblastoma, the Stupp protocol following surgical debulking combines fractionated focal external beam radiation with concurrent and adjuvant temozolomide chemotherapy, yielding superior survival when the MGMT promoter is methylated.",
        "say": "Maximal safe surgical resection utilizing neuronavigation and awake mapping provides the foundation of care. Glioblastoma is treated adjuvantly with the Stupp protocol of radiation and temozolomide chemotherapy.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Intra-Axial Glioma Surgery",
            "points": [
              "Maximal safe resection within parenchyma",
              "Awake mapping for eloquent speech areas",
              "5-ALA fluorescence identifies tumor edges"
            ]
          },
          "right": {
            "title": "Extra-Axial Meningioma Surgery",
            "points": [
              "Simpson grade complete excision of dural base",
              "Cavitron ultrasonic aspirator debulking",
              "Curative when complete resection achieved"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-hydrocephalus",
    "subject": "surgery",
    "title": "Cerebrospinal fluid dynamics, hydrocephalus classification, ventriculoperitoneal shunting, and ETV",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Youmans Neurological Surgery 7th ed"
    ],
    "steps": [
      {
        "tx": "Cerebrospinal fluid is produced continuously by choroid plexus ependymal **cells** within the lateral, third, and fourth cerebral ventricles at an average rate of five hundred milliliters daily. The total circulating adult cerebrospinal fluid volume approximates one hundred and fifty milliliters. Cerebrospinal fluid circulates from the lateral ventricles through the paired foramina of Monro into the third ventricle, passes down the narrow cerebral aqueduct of Sylvius into the fourth ventricle, and exits through the median Magendie and lateral Luschka foramina.",
        "say": "Cerebrospinal fluid is produced by the choroid plexus at five hundred milliliters per day, maintaining a circulating volume of one hundred and fifty milliliters. It circulates through the ventricles and aqueduct before entering the subarachnoid space.",
        "vis": {
          "kind": "table",
          "cols": [
            "Anatomical CSF pathway",
            "Connection / conduit structure",
            "Drainage destination"
          ],
          "rows": [
            [
              "Lateral ventricles",
              "Foramina of Monro (interventricular)",
              "Third ventricle lumen"
            ],
            [
              "Third ventricle",
              "Cerebral aqueduct of Sylvius (midbrain)",
              "Fourth ventricle lumen"
            ],
            [
              "Fourth ventricle",
              "Foramina of Luschka and Magendie",
              "Basal cisterns & subarachnoid space"
            ],
            [
              "Subarachnoid space",
              "Arachnoid granulations / villi",
              "Superior sagittal dural venous sinus"
            ]
          ]
        }
      },
      {
        "tx": "Hydrocephalus is fundamentally classified as non-communicating or **communicating** based upon the anatomical site of flow disruption. Non-communicating obstructive hydrocephalus arises from internal ventricular obstruction, most commonly aqueductal stenosis, posterior fossa neoplasms compressing the fourth ventricle, or colloid cysts of the third ventricle. Communicating hydrocephalus results from impaired cerebrospinal fluid reabsorption at the level of arachnoid granulations, classically developing secondary to post-meningitic fibrosis, subarachnoid hemorrhage, or diffuse carcinomatous leptomeningeal infiltration.",
        "say": "Non-communicating hydrocephalus results from physical blockage within the ventricular system such as aqueductal stenosis. Communicating hydrocephalus arises from impaired absorption at the arachnoid villi following meningitis or hemorrhage.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Ventriculomegaly on neuroimaging"
            },
            {
              "id": "n2",
              "label": "Assess fourth ventricle size & patency"
            },
            {
              "id": "n3",
              "label": "Distinguish obstructive from communicating"
            },
            {
              "id": "n4",
              "label": "Select VP shunt vs endoscopic third ventriculostomy"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Normal pressure hydrocephalus represents a distinct communicating **syndrome** occurring in elderly adults, characterized by the pathognomonic clinical triad of Adams and Hakim: progressive gait apraxia, urinary urge incontinence, and subcortical dementia. The classic gait is magnetic, wide-based, and short-stepped. Neuroimaging reveals marked ventriculomegaly disproportionate to sulcal cerebral atrophy. A diagnostic lumbar puncture removing forty to fifty milliliters of fluid yielding temporary clinical gait improvement strongly predicts favorable responsiveness to ventriculoperitoneal shunting.",
        "say": "Normal pressure hydrocephalus presents with gait apraxia, urinary incontinence, and dementia. Significant ventriculomegaly with normal opening pressure on lumbar puncture and gait improvement after tap test predicts surgical shunt success.",
        "vis": {
          "kind": "table",
          "cols": [
            "Clinical triad component",
            "Physical examination manifestation",
            "Expected response to shunt"
          ],
          "rows": [
            [
              "Gait disturbance",
              "Magnetic, shuffling, wide-based steps",
              "Most responsive to CSF diversion"
            ],
            [
              "Urinary incontinence",
              "Urgency advancing to complete loss",
              "Moderately responsive to diversion"
            ],
            [
              "Cognitive impairment",
              "Psychomotor slowing & executive defect",
              "Least responsive / variable recovery"
            ],
            [
              "Lumbar tap test",
              "Removal of 40-50 mL cerebrospinal fluid",
              "Confirms dynamic gait improvement"
            ]
          ]
        }
      },
      {
        "tx": "Ventriculoperitoneal shunting represents the primary definitive treatment for communicating hydrocephalus, **diverting** excess fluid from the lateral ventricle into the peritoneal cavity through a subcutaneous valve-regulated silicone catheter. Complications include mechanical catheter obstruction, overdrainage with chronic subdural hematomas, and shunt infection predominantly caused by Staphylococcus epidermidis. For obstructive non-communicating hydrocephalus, endoscopic third ventriculostomy creates an opening in the floor of the third ventricle into the prepontine cistern, providing physiological internal diversion without permanent prosthetic hardware.",
        "say": "Ventriculoperitoneal shunts divert fluid from the lateral ventricle into the peritoneal cavity. For obstructive hydrocephalus, endoscopic third ventriculostomy creates a bypass fenestration in the floor of the third ventricle, avoiding foreign shunt hardware.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Ventriculoperitoneal (VP) Shunt",
            "points": [
              "Diverts CSF to peritoneal cavity via valve",
              "Standard therapy for communicating hydrocephalus",
              "Risks: blockage, infection & subdural hematoma"
            ]
          },
          "right": {
            "title": "Endoscopic Third Ventriculostomy",
            "points": [
              "Fenestrates floor of third ventricle into cistern",
              "Procedure of choice for aqueductal stenosis",
              "Zero foreign hardware implanted"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-paed-gi",
    "subject": "surgery",
    "title": "Paediatric gastrointestinal emergencies, hypertrophic pyloric stenosis, intussusception, and Ladd procedure",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Holcomb and Ashcraft's Pediatric Surgery 7th ed"
    ],
    "steps": [
      {
        "tx": "Infantile hypertrophic pyloric stenosis arises from hypertrophy and hyperplasia of the circular pyloric smooth **muscle**, producing severe gastric outlet obstruction in infants aged three to six weeks. It occurs predominantly in first-born males, manifesting with non-bilious projectile vomiting immediately after feeding and a palpable olive-shaped mass in the right epigastrium. Persistent gastric loss of hydrochloric acid causes classic hypochloremic, hypokalemic metabolic alkalosis with paradoxical aciduria. Transverse abdominal ultrasonography demonstrates pyloric muscle thickness exceeding three millimeters and channel length exceeding fifteen millimeters.",
        "say": "Hypertrophic pyloric stenosis presents in infants aged three to six weeks with non-bilious projectile vomiting and an epigastric olive mass. It produces hypochloremic hypokalemic metabolic alkalosis, with ultrasound showing muscle thickness over three millimeters.",
        "vis": {
          "kind": "table",
          "cols": [
            "Diagnostic parameter",
            "Threshold diagnostic criterion",
            "Clinical / laboratory significance"
          ],
          "rows": [
            [
              "Pyloric muscle thickness",
              "Greater than or equal to 3.0 mm",
              "Confirms hypertrophic circular muscle"
            ],
            [
              "Pyloric channel length",
              "Greater than or equal to 15 mm",
              "Elongated gastric outlet channel"
            ],
            [
              "Serum chloride level",
              "Less than 98 mmol/L",
              "Profound hypochloremia from vomitus"
            ],
            [
              "Blood gas evaluation",
              "Elevated serum bicarbonate & pH",
              "Metabolic alkalosis requiring saline"
            ]
          ]
        }
      },
      {
        "tx": "Electrolyte and fluid resuscitation with isotonic saline takes absolute precedence over operative **intervention**, because performing general anesthesia in an alkalotic infant risks severe postoperative apnea. Once serum chloride exceeds one hundred milliequivalents per liter, Ramstedt extramucosal pyloromyotomy is curative. The surgeon divides the hypertrophic circular pyloric muscle down to the bulging, intact submucosa. Meticulous inspection for mucosal perforation followed by air insufflation through an orogastric tube is mandatory prior to abdominal wall closure.",
        "say": "Isotonic saline resuscitation to normalize chloride and acid-base status is mandatory before surgery to avoid anesthetic apnea. Ramstedt pyloromyotomy divides the circular muscle down to intact submucosa without entering the mucosal lumen.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Non-bilious projectile vomiting in infant"
            },
            {
              "id": "n2",
              "label": "Diagnose hypochloremic alkalosis on labs"
            },
            {
              "id": "n3",
              "label": "Resuscitate with normal saline & potassium"
            },
            {
              "id": "n4",
              "label": "Ramstedt extramucosal pyloromyotomy"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Intussusception involves the invagination of a proximal bowel segment into an immediately distal bowel **lumen**, most commonly ileocolic in infants aged six to twenty-four months. The classic triad includes intermittent severe colicky abdominal pain with drawing up of legs, vomiting, and passage of red currant jelly stools containing mucus and blood. Abdominal ultrasound displays the pathognomonic target or doughnut sign. Non-operative reduction utilizing pneumatic or hydrostatic enema is the primary treatment of choice, provided peritonitis, bowel perforation, and septic shock are absent.",
        "say": "Ileocolic intussusception presents in toddlers with severe colicky pain, leg flexion, vomiting, and red currant jelly stools. Ultrasonography reveals a target sign. Pneumatic enema reduction is first-line in the absence of peritonitis.",
        "vis": {
          "kind": "table",
          "cols": [
            "Intussusception feature",
            "Clinical manifestation",
            "Management rule"
          ],
          "rows": [
            [
              "Classic triad",
              "Colicky pain, vomiting, red currant jelly stool",
              "Present complete in under 50%"
            ],
            [
              "Ultrasound appearance",
              "Transverse target / longitudinal pseudokidney",
              "Diagnostic sensitivity > 98%"
            ],
            [
              "Pneumatic reduction",
              "Air insufflation up to 120 mmHg under fluoroscopy",
              "Successful reduction in > 85%"
            ],
            [
              "Operative indication",
              "Peritonitis, perforation, or failed enema",
              "Manual reduction or segmental resection"
            ]
          ]
        }
      },
      {
        "tx": "Midgut malrotation results from failure of normal embryonic 270-degree counterclockwise gut **rotation** around the superior mesenteric artery, leaving a narrow mesenteric base prone to clockwise torsion and catastrophic midgut volvulus. Sudden onset of bilious vomiting in a previously thriving neonate represents midgut volvulus until proven otherwise. Upper gastrointestinal contrast radiography reveals the duodenojejunal junction displaced to the right of the spine and a corkscrew duodenum. Emergency surgical exploration via the Ladd procedure detorses the volvulus, divides adhesive Ladd bands, widens the mesenteric base, and performs appendectomy.",
        "say": "Bilious vomiting in a newborn is midgut volvulus until proven otherwise. Upper gastrointestinal contrast series demonstrates a corkscrew duodenum. Emergency Ladd procedure detorses the bowel, divides Ladd bands, and widens the mesenteric base.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Pyloric Stenosis",
            "points": [
              "Non-bilious projectile vomiting",
              "Age 3 to 6 weeks; olive mass",
              "Hypochloremic metabolic alkalosis"
            ]
          },
          "right": {
            "title": "Midgut Volvulus",
            "points": [
              "Acute bilious green vomiting in newborn",
              "Narrow mesenteric root twists on SMA",
              "Surgical emergency: Ladd procedure"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-neonatal",
    "subject": "surgery",
    "title": "Neonatal surgical anomalies, esophageal atresia, diaphragmatic hernia, and abdominal wall defects",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Holcomb and Ashcraft's Pediatric Surgery 7th ed"
    ],
    "steps": [
      {
        "tx": "Esophageal atresia occurs in one in three thousand live births, with eighty-five percent **exhibiting** Gross type C anomaly characterized by a blind proximal esophageal pouch and a distal tracheoesophageal fistula. Neonates present immediately after birth with copious foaming saliva, frothing at the mouth, and coughing, choking, and cyanosis upon feeding. Inability to pass a rigid 10 French nasogastric tube into the stomach, with the catheter coiling in the upper thoracic pouch on plain radiograph, establishes the diagnosis. Presence of gastrointestinal gas confirms a distal tracheoesophageal fistula.",
        "say": "Esophageal atresia with distal tracheoesophageal fistula presents with excessive frothy salivation, choking on feeding, and an inability to pass an orogastric tube. Plain radiography confirms coiling in the upper pouch, while abdominal gas indicates a distal fistula.",
        "vis": {
          "kind": "table",
          "cols": [
            "EA/TEF anatomical subtype",
            "Gross anatomical arrangement",
            "Abdominal bowel gas status"
          ],
          "rows": [
            [
              "Type C (85% of cases)",
              "Proximal atresia with distal TEF",
              "Gas present in stomach & bowel"
            ],
            [
              "Type A (Isolated EA 8%)",
              "Pure atresia without fistula",
              "Gasless abdomen on radiograph"
            ],
            [
              "Type E (H-type TEF 4%)",
              "Fistula without esophageal atresia",
              "Normal gas; recurrent aspirations"
            ],
            [
              "Type B (Proximal TEF 2%)",
              "Proximal fistula with distal atresia",
              "Gasless abdomen on radiograph"
            ]
          ]
        }
      },
      {
        "tx": "Concomitant congenital anomalies occur in over half of infants with esophageal atresia, **necessitating** systematic screening for the VACTERL association: vertebral defects, anal atresia, cardiac anomalies, tracheoesophageal fistula, renal dysplasia, and limb radial abnormalities. Preoperative care focuses on continuous suctioning of the proximal pouch with a Replogle tube and upright positioning to minimize acid reflux into the tracheobronchial tree. Primary surgical repair through a right extrapleural thoracotomy or thoracoscopy ligates the fistula and achieves end-to-end esophageal anastomosis.",
        "say": "Infants with esophageal atresia require evaluation for the VACTERL association, especially echocardiography for congenital cardiac defects. Preoperative Replogle pouch suction prevents aspiration before extrapleural fistula division and esophageal repair.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Frothing saliva in newborn infant"
            },
            {
              "id": "n2",
              "label": "NG tube coils in upper pouch on X-ray"
            },
            {
              "id": "n3",
              "label": "Echocardiogram & VACTERL screening"
            },
            {
              "id": "n4",
              "label": "Extrapleural fistula ligation & repair"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Congenital diaphragmatic hernia arises from failure of the pleuroperitoneal **membrane** to close at eight to ten weeks gestation, most frequently occurring through the posterolateral foramen of Bochdalek on the left side in eighty-five percent of cases. Abdominal viscera herniate into the thoracic cavity, impairing lung bud branching and producing profound ipsilateral and contralateral pulmonary hypoplasia with persistent pulmonary hypertension of the newborn. Neonates present with severe respiratory distress, a scaphoid abdomen, and bowel sounds audible in the hemithorax.",
        "say": "Congenital diaphragmatic hernia results from failure of pleuroperitoneal membrane closure, usually left-sided through the foramen of Bochdalek. Evisceration of viscera causes severe pulmonary hypoplasia and persistent pulmonary hypertension with a scaphoid abdomen.",
        "vis": {
          "kind": "table",
          "cols": [
            "Diaphragmatic defect type",
            "Anatomical defect location",
            "Pathophysiological consequence"
          ],
          "rows": [
            [
              "Bochdalek hernia (85%)",
              "Posterolateral pleuroperitoneal canal",
              "Severe bilateral pulmonary hypoplasia"
            ],
            [
              "Morgagni hernia (5%)",
              "Anterior retrosternal parasternal space",
              "Often asymptomatic until late childhood"
            ],
            [
              "Pulmonary hypoplasia",
              "Decreased bronchial branching & alveoli",
              "Hypercarbic respiratory failure"
            ],
            [
              "Persistent PPHN",
              "Hypertrophied pulmonary vascular media",
              "Severe right-to-left ductal shunting"
            ]
          ]
        }
      },
      {
        "tx": "Omphalocele represents a midline abdominal wall defect at the **umbilicus** covered by a three-layer sac composed of peritoneum, Wharton jelly, and amnion, with the umbilical cord inserting directly onto the apex of the sac. Over fifty percent of omphalocele infants harbor severe associated chromosomal anomalies, congenital heart defects, or Beckwith-Wiedemann syndrome. Gastroschisis, by contrast, is a full-thickness defect located immediately to the right of an intact umbilical cord without a covering membrane, leaving thickened, edematous bowel eviscerated into amniotic fluid.",
        "say": "Omphalocele is a midline defect covered by a sac with high chromosomal and cardiac associations. Gastroschisis is a full-thickness defect to the right of an intact umbilical ring without a sac, with low chromosomal associations.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Omphalocele",
            "points": [
              "Midline defect at the umbilical ring",
              "Covered by intact peritoneal/amniotic sac",
              "Umbilical cord inserts onto the sac",
              "High chromosomal/cardiac association (> 50%)"
            ]
          },
          "right": {
            "title": "Gastroschisis",
            "points": [
              "Full-thickness defect to right of cord",
              "No covering sac; bowel exposed to amniotic fluid",
              "Umbilical cord inserts normally on body wall",
              "Rarely associated with extraintestinal anomalies"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-paed-uro",
    "subject": "surgery",
    "title": "Paediatric urology, hypospadias, cryptorchidism, and Wilms tumor",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Campbell-Walsh Urology 12th ed"
    ],
    "steps": [
      {
        "tx": "Hypospadias represents a common congenital penile **anomaly** characterized by incomplete development of the anterior urethra, resulting in a ventrally displaced urethral meatus, ventral fibrous chordee curvature, and a deficient ventral prepuce creating a dorsal hood. Neonatal circumcision is strictly contraindicated because the vascularized dorsal prepuce provides essential tissue for future surgical reconstruction. Surgical repair utilizing tubularized incised plate urethroplasty is ideally scheduled between six and eighteen months of age to minimize psychological awareness.",
        "say": "Hypospadias features a ventrally displaced urethral meatus, ventral chordee, and a dorsal prepuce hood. Neonatal circumcision is strictly contraindicated to preserve foreskin for reconstruction, with urethroplasty scheduled between six and eighteen months.",
        "vis": {
          "kind": "table",
          "cols": [
            "Hypospadias anatomic class",
            "Urethral meatus position",
            "Surgical reconstructive approach"
          ],
          "rows": [
            [
              "Distal (Glandular/coronal)",
              "Glans or coronal sulcus (65%)",
              "Tubularized incised plate (Snodgrass)"
            ],
            [
              "Midshaft penile",
              "Mid-pendulous shaft (15%)",
              "Onlay island flap or incised plate"
            ],
            [
              "Proximal (Penoscrotal)",
              "Scrotum or perineum (20%)",
              "Staged buccal mucosa graft urethroplasty"
            ],
            [
              "Associated chordee",
              "Ventral tunical tethering",
              "Dorsal plication / degloving release"
            ]
          ]
        }
      },
      {
        "tx": "Cryptorchidism denotes failure of normal testicular **descent** into the scrotal sac, increasing risks of impaired spermatogenesis, testicular torsion, inguinal hernia, and malignant testicular germ cell degeneration. The increased risk of testicular cancer persists throughout life, involving both the undescended and contralateral descended testicles. Diagnostic laparoscopy represents the definitive investigation for non-palpable intra-abdominal testicles. Surgical orchidopexy with fixation within a subdartos pouch is recommended between six and twelve months of age to preserve germinal epithelium.",
        "say": "Cryptorchidism increases the risk of subfertility and testicular cancer in both testes. Diagnostic laparoscopy is the gold standard for non-palpable intra-abdominal testes. Surgical orchidopexy is performed between six and twelve months of age.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Undescended testis on neonatal exam"
            },
            {
              "id": "n2",
              "label": "Palpate inguinal canal carefully"
            },
            {
              "id": "n3",
              "label": "Diagnostic laparoscopy if non-palpable"
            },
            {
              "id": "n4",
              "label": "Orchidopexy between 6 and 12 months"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Posterior urethral valves represent the most common cause of congenital lower urinary **tract** obstruction in newborn boys, consisting of obstructing mucosal folds within the prostatic urethra. Fetal ultrasound reveals bilateral hydroureteronephrosis, distended thick-walled bladder with a dilated posterior urethra termed the keyhole sign, and oligohydramnios producing secondary pulmonary hypoplasia. Urgent neonatal decompression with a small feeding tube followed by cystoscopic transurethral valve ablation restores urinary outflow and preserves renal function.",
        "say": "Posterior urethral valves produce severe urinary outflow obstruction in male neonates, displaying the keyhole bladder sign and hydronephrosis on ultrasound. Prompt transurethral valve ablation prevents progressive chronic renal failure.",
        "vis": {
          "kind": "table",
          "cols": [
            "Pathological entity",
            "Diagnostic imaging sign",
            "Clinical management priority"
          ],
          "rows": [
            [
              "Posterior urethral valves",
              "Keyhole sign on bladder ultrasound",
              "Primary endoscopic valve ablation"
            ],
            [
              "Vesicoureteral reflux (VUR)",
              "Retrograde contrast into ureter on VCUG",
              "Prophylactic antibiotics or ureteral reimplantation"
            ],
            [
              "Reflux nephropathy",
              "Cortical scarring on DMSA scintigraphy",
              "Control hypertension & prevent infection"
            ],
            [
              "Antenatal hydronephrosis",
              "Renal pelvis AP diameter > 10 mm",
              "Postnatal ultrasound & MAG3 renography"
            ]
          ]
        }
      },
      {
        "tx": "Wilms tumor represents the most frequent malignant renal **tumor** of childhood, presenting at a median age of three years with an asymptomatic, smooth, firm abdominal flank mass that rarely crosses the midline. Neuroblastoma, by contrast, arises from sympathetic neuroblasts in the adrenal gland or retroperitoneum, presenting as a hard, irregular mass that frequently crosses the aortic midline and encases major vascular structures. Wilms tumor is treated by multimodality chemotherapy and radical nephrectomy without prior needle biopsy.",
        "say": "Wilms tumor presents in toddlers as a smooth painless flank mass that rarely crosses the midline. Neuroblastoma arises from sympathetic tissue, is calcified, and characteristically crosses the aortic midline. Multimodal therapy achieves high cure rates.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Wilms Tumor (Nephroblastoma)",
            "points": [
              "Smooth, firm mass; rarely crosses midline",
              "Arises from metanephric renal blastema",
              "Biopsy contraindicated; radical nephrectomy",
              "WT1 gene deletion on chromosome 11p13"
            ]
          },
          "right": {
            "title": "Neuroblastoma",
            "points": [
              "Irregular, nodular mass; crosses midline",
              "Arises from neural crest adrenal medulla",
              "Elevated urinary VMA and HVA catecholamines",
              "Frequent encasement of mesenteric vessels"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-transplant",
    "subject": "surgery",
    "title": "Organ transplantation, allorecognition, rejection mechanisms, and renal allografting",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Danovitch Handbook of Kidney Transplantation 6th ed"
    ],
    "steps": [
      {
        "tx": "Allogeneic organ transplantation requires matching of human leukocyte **antigens** encoded within the major histocompatibility complex on chromosome 6. Class I molecules including HLA-A, B, and C are expressed on all nucleated cells and present endogenous antigens to CD8 cytotoxic T lymphocytes. Class II molecules including HLA-DR, DP, and DQ are restricted to antigen-presenting cells and present exogenous antigens to CD4 helper T lymphocytes. Direct allorecognition occurs when recipient T cells recognize intact intact donor MHC molecules directly.",
        "say": "Organ transplantation relies on matching HLA class I and class II antigens. Class I antigens present to CD8 cytotoxic T cells, while class II molecules present to CD4 helper cells. Direct allorecognition drives acute allograft rejection.",
        "vis": {
          "kind": "table",
          "cols": [
            "MHC / HLA category",
            "Tissue expression pattern",
            "Target T lymphocyte subset"
          ],
          "rows": [
            [
              "Class I (HLA-A, B, C)",
              "All nucleated somatic cells",
              "CD8+ cytotoxic T lymphocytes"
            ],
            [
              "Class II (HLA-DR, DP, DQ)",
              "Dendritic cells, macrophages, B cells",
              "CD4+ helper T lymphocytes"
            ],
            [
              "Direct allorecognition",
              "Recipient T cells bind donor intact MHC",
              "Drives early acute cellular rejection"
            ],
            [
              "Indirect allorecognition",
              "Recipient APCs process donor peptides",
              "Drives chronic antibody-mediated rejection"
            ]
          ]
        }
      },
      {
        "tx": "Allograft rejection is categorized into hyperacute, acute cellular, acute **antibody-mediated**, and chronic rejection. Hyperacute rejection occurs within minutes to hours, driven by pre-existing circulating anti-donor antibodies that activate complement, producing microvascular thrombosis, graft cyanosis, and cortical necrosis; it is prevented by complement-dependent cytotoxicity crossmatching. Acute cellular rejection develops within weeks to months, featuring T-lymphocyte tubulitis and interstitial infiltrate that responds to pulsed methylprednisolone. Chronic rejection manifests with progressive obliterative graft vasculopathy and interstitial fibrosis.",
        "say": "Hyperacute rejection occurs within minutes from preformed antibodies and is prevented by crossmatching. Acute cellular rejection manifests as T-cell tubulitis responsive to intravenous corticosteroids, while chronic rejection causes irreversible graft fibrosis.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Donor-recipient HLA typing & crossmatch"
            },
            {
              "id": "n2",
              "label": "Negative crossmatch confirms suitability"
            },
            {
              "id": "n3",
              "label": "Induction therapy with basiliximab / ATG"
            },
            {
              "id": "n4",
              "label": "Maintenance triple immunosuppression"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Maintenance immunosuppression typically incorporates a triple-drug **regimen** consisting of a calcineurin inhibitor, an antimetabolite, and a corticosteroid. Tacrolimus binds FK-binding protein 12 to inhibit calcineurin phosphatase, blocking interleukin-2 transcription; therapeutic monitoring of trough blood levels is mandatory to prevent nephrotoxicity and neurotoxicity. Mycophenolate mofetil reversibly inhibits inosine monophosphate dehydrogenase, blocking de novo purine synthesis in proliferating lymphocytes. Basiliximab or anti-thymocyte globulin provides biological induction therapy during the perioperative implantation window.",
        "say": "Triple maintenance immunosuppression includes tacrolimus, mycophenolate mofetil, and prednisone. Tacrolimus blocks interleukin-2 transcription, requiring trough monitoring to avoid nephrotoxicity. Mycophenolate inhibits de novo purine synthesis in lymphocytes.",
        "vis": {
          "kind": "table",
          "cols": [
            "Immunosuppressive agent",
            "Molecular pharmacological target",
            "Primary clinical adverse effect"
          ],
          "rows": [
            [
              "Tacrolimus (CNI)",
              "Inhibits calcineurin phosphatase / IL-2",
              "Nephrotoxicity, tremor, new-onset diabetes"
            ],
            [
              "Cyclosporine (CNI)",
              "Binds cyclophilin / blocks calcineurin",
              "Nephrotoxicity, gingival hyperplasia, hirsutism"
            ],
            [
              "Mycophenolate mofetil",
              "Inhibits IMPDH / blocks purine synthesis",
              "Gastrointestinal diarrhea, leukopenia"
            ],
            [
              "Corticosteroids",
              "Inhibits NF-kB & cytokine transcription",
              "Hypertension, hyperglycemia, osteoporosis"
            ]
          ]
        }
      },
      {
        "tx": "Renal transplantation involves heterotopic placement of the donor **allograft** within the recipient iliac fossa extraperitoneally. Vascular reconstruction anastomoses the donor renal vein end-to-side to the external iliac vein, and the donor renal artery end-to-side to the external iliac artery. Urinary continuity is re-established via an extravesical Lich-Gregoir ureteroneocystostomy over an internal double-J stent. Early postoperative oliguria warrants immediate Doppler ultrasonography to rule out renal artery thrombosis, renal vein kinking, or perigraft fluid collections such as urinoma or lymphocele.",
        "say": "Renal transplantation places the kidney extraperitoneally in the iliac fossa. Vascular anastomoses connect to the external iliac vessels, and the ureter is implanted into the bladder. Postoperative oliguria mandates Doppler ultrasound to exclude vascular thrombosis.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Renal Vascular Anastomosis",
            "points": [
              "Donor renal vein to external iliac vein",
              "Donor renal artery to external iliac artery",
              "Meticulous de-airing prior to clamp release"
            ]
          },
          "right": {
            "title": "Ureteral Reimplantation",
            "points": [
              "Extravesical Lich-Gregoir ureteroneocystostomy",
              "Submucosal anti-reflux tunneling into bladder",
              "Protected by internal double-J ureteral stent"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-uro-congenital",
    "subject": "surgery",
    "title": "Congenital urinary tract anomalies, ureteropelvic obstruction, duplex ureter, and pyeloplasty",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Campbell-Walsh Urology 12th ed"
    ],
    "steps": [
      {
        "tx": "Congenital pelviureteric junction obstruction represents the most frequent **cause** of significant pediatric hydronephrosis, characterized by impaired urine transport from the renal pelvis into the proximal ureter. Intrinsic aperistaltic ureteral segments or extrinsic mechanical compression by lower pole crossing accessory renal vessels account for the obstruction. Infants present with palpable abdominal masses or urinary tract infections, while older children develop intermittent Dietl crises with severe episodic flank pain following excessive fluid consumption and diuresis.",
        "say": "Pelviureteric junction obstruction is the most common cause of neonatal hydronephrosis. Aperistaltic ureteral segments or crossing vessels impede flow, causing Dietl crises with flank pain after heavy fluid intake.",
        "vis": {
          "kind": "table",
          "cols": [
            "Etiological mechanism",
            "Underlying pathological defect",
            "Typical age of clinical detection"
          ],
          "rows": [
            [
              "Intrinsic UPJ obstruction",
              "Aperistaltic collagenous muscular segment",
              "Antenatal ultrasound or newborn period"
            ],
            [
              "Extrinsic crossing vessel",
              "Lower pole accessory renal artery compression",
              "Older children and young adults"
            ],
            [
              "High ureteral insertion",
              "Angulation at pelvic-ureteral junction",
              "Childhood intermittent flank fullness"
            ],
            [
              "Secondary UPJ stricture",
              "Chronic reflux-induced pelvic tortuosity",
              "Associated with high-grade VUR"
            ]
          ]
        }
      },
      {
        "tx": "Evaluation requires renal ultrasonography and dynamic diuretic **renography** utilizing technetium-99m mercaptoacetyltriglycine (MAG3) with intravenous furosemide challenge. A persistent non-clearing excretion curve with an elimination half-time exceeding twenty minutes confirms functional obstruction. The surgical gold standard for symptomatic or progressive functional obstruction is the Anderson-Hynes dismembered pyeloplasty, excising the aperistaltic segment, trimming the redundant renal pelvis, and reconstructing a widely spatulated, tension-free pelviureteric anastomosis over an internal double-J stent.",
        "say": "Diuretic MAG3 renography confirms obstruction when clearance half-time exceeds twenty minutes. Anderson-Hynes dismembered pyeloplasty represents the gold standard surgical repair, excising the aperistaltic segment and constructing a spatulated anastomosis.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Hydronephrosis on renal ultrasound"
            },
            {
              "id": "n2",
              "label": "MAG3 diuretic renogram with furosemide"
            },
            {
              "id": "n3",
              "label": "Obstructive washout curve (T1/2 > 20 min)"
            },
            {
              "id": "n4",
              "label": "Anderson-Hynes dismembered pyeloplasty"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Duplex collecting systems follow the classic Weigert-Meyer **law** of embryological development in complete ureteral duplication. The upper pole moiety ureter inserts ectopically into the bladder more inferomedially than normal, frequently terminating in an obstructing ureterocele. The lower pole moiety ureter inserts orthotopically into the bladder higher and more laterally, possessing a shortened intramural tunnel that strongly predisposes to vesicoureteral reflux and recurrent pyelonephritis. Ectopic ureter insertion distal to the external urinary sphincter produces continuous incontinence in females.",
        "say": "In duplex systems, the Weigert-Meyer law dictates that the upper pole ureter inserts inferomedially and tends to obstruct with a ureterocele. The lower pole ureter inserts laterally and refluxes. Ectopic insertion distal to the sphincter causes continuous female dribbling.",
        "vis": {
          "kind": "table",
          "cols": [
            "Duplex renal moiety",
            "Bladder insertion location",
            "Pathological complication"
          ],
          "rows": [
            [
              "Upper pole moiety ureter",
              "Inferomedial ectopic insertion",
              "Ureterocele and urinary obstruction"
            ],
            [
              "Lower pole moiety ureter",
              "Superolateral orthotopic insertion",
              "Vesicoureteral reflux & pyelonephritis"
            ],
            [
              "Ectopic ureter in females",
              "Vagina or urethra below sphincter",
              "Continuous urinary dribbling"
            ],
            [
              "Ectopic ureter in males",
              "Prostatic urethra / seminal vesicle",
              "Epididymitis without incontinence"
            ]
          ]
        }
      },
      {
        "tx": "Autosomal dominant polycystic kidney disease results from mutations in the **PKD1** gene on chromosome 16 or PKD2 on chromosome 4, manifesting in adult life with bilateral palpable renal enlargement, flank pain, microscopic hematuria, hypertension, and progressive renal insufficiency. Extrarenal manifestations include hepatic cysts, mitral valve prolapse, and intracranial berry aneurysms of the circle of Willis. Bladder exstrophy represents a severe midline infraumbilical defect with an open exposed bladder plate and pubic diastasis, treated by multidisciplinary staged functional closure.",
        "say": "Autosomal dominant polycystic kidney disease produces bilateral massive cyst formation, hypertension, and intracranial berry aneurysms. Bladder exstrophy features an exposed bladder wall and wide pubic diastasis requiring staged reconstructive closure.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "ADPKD (Adult Form)",
            "points": [
              "PKD1 (16p13) or PKD2 (4q21) mutations",
              "Massive bilateral cysts in adult life",
              "Associated with cerebral berry aneurysms"
            ]
          },
          "right": {
            "title": "ARPKD (Infantile Form)",
            "points": [
              "PKHD1 fibrocystin gene mutation",
              "Congenital bilateral enlarged spongy kidneys",
              "Obligatory congenital hepatic fibrosis"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-urethra-penis",
    "subject": "surgery",
    "title": "Urethral stricture disease, urethroplasty techniques, and penile carcinoma",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Campbell-Walsh Urology 12th ed"
    ],
    "steps": [
      {
        "tx": "Urethral stricture disease arises from ischemic scarring and progressive spongiofibrosis within the corpus **spongiosum** surrounding the urethral epithelium. Etiologies include iatrogenic trauma from traumatic catheterization or transurethral instrumentation, straddle pelvic perineal trauma, chronic urethritis from Neisseria gonorrhoeae, and lichen sclerosus balanitis xerotica obliterans. The bulbar urethra represents the most frequent anatomical site of anterior urethral strictures, producing progressive obstructive voiding symptoms, decreased urinary stream force, and post-void dribbling.",
        "say": "Urethral strictures result from spongiofibrosis in the corpus spongiosum, commonly following catheterization, straddle trauma, or gonococcal infection. The bulbar urethra is the most frequent site, causing decreased urinary flow and post-void dribbling.",
        "vis": {
          "kind": "table",
          "cols": [
            "Stricture anatomical region",
            "Etiological causal mechanism",
            "Preferred reconstructive approach"
          ],
          "rows": [
            [
              "Bulbar urethra",
              "Straddle injury / iatrogenic instrumentation",
              "Excision & primary anastomosis (< 2 cm)"
            ],
            [
              "Penile pendulous urethra",
              "Lichen sclerosus / failed hypospadias",
              "Buccal mucosa graft substitution"
            ],
            [
              "Membranous urethra",
              "Pelvic fracture urethral distraction (PFUI)",
              "Delayed anastomotic perineal repair"
            ],
            [
              "Fossa navicularis / meatus",
              "Chronic balanitis xerotica obliterans",
              "Extended meatoplasty / graft onlay"
            ]
          ]
        }
      },
      {
        "tx": "Retrograde urethrography combined with voiding cystourethrography constitutes the gold standard diagnostic **imaging** modality, delineating stricture length, caliber, anatomical location, and associated false passages or diverticula. For short bulbar strictures under two centimeters, primary anastomotic urethroplasty provides long-term success rates exceeding ninety percent by excising the fibrotic segment and performing a spatulated end-to-end anastomosis. Long or complex penile strictures require substitution urethroplasty utilizing autologous buccal mucosal graft onlays, which possess a thick elastin-rich lamina propria facilitating robust vascular inosculation.",
        "say": "Retrograde urethrography is the diagnostic gold standard, mapping stricture length and location. Short bulbar strictures are cured by primary anastomotic urethroplasty, while long strictures require substitution urethroplasty with buccal mucosal grafts.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Obstructive lower urinary voiding symptoms"
            },
            {
              "id": "n2",
              "label": "Retrograde urethrogram & cystourethrogram"
            },
            {
              "id": "n3",
              "label": "Measure stricture length & spongiofibrosis"
            },
            {
              "id": "n4",
              "label": "Anastomotic repair (< 2 cm) vs buccal graft"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Penile carcinoma represents an uncommon malignancy in developed nations, with squamous cell carcinoma accounting for ninety-five **percent** of cases. Uncircumcised status with chronic phimosis, poor hygiene, smegma accumulation, and high-risk human papillomavirus infection (types 16 and 18) are primary risk factors. Premalignant lesions include erythroplasia of Queyrat on the glans and Bowen disease on the shaft. Tumors present as painless, non-healing ulcerations or exophytic verrucous masses on the glans penis or prepuce.",
        "say": "Squamous cell carcinoma accounts for ninety-five percent of penile cancers, linked to uncircumcised status with phimosis, poor hygiene, and human papillomavirus infection. Lesions present as painless non-healing ulcers on the glans or foreskin.",
        "vis": {
          "kind": "table",
          "cols": [
            "Penile lesion type",
            "Clinical morphology & site",
            "Malignancy potential"
          ],
          "rows": [
            [
              "Erythroplasia of Queyrat",
              "Velvety red plaque on glans / prepuce",
              "Carcinoma in situ (10-30% invasive)"
            ],
            [
              "Bowen disease",
              "Crusted solitary plaque on penile shaft",
              "Carcinoma in situ"
            ],
            [
              "Buschke-Lowenstein tumor",
              "Giant verrucous condyloma of glans",
              "Locally aggressive non-metastasizing"
            ],
            [
              "Invasive squamous carcinoma",
              "Ulcerated or fungating glans lesion",
              "Regional inguinal nodal metastases"
            ]
          ]
        }
      },
      {
        "tx": "Surgical management prioritizes complete oncological clearance while preserving maximum penile length for upright micturition and sexual **function**. Superficial low-grade tumors are managed with organ-sparing glansectomy or wide local excision, whereas invasive corporal lesions necessitate partial penectomy with a minimum clear margin of two to three millimeters, or total penectomy with perineal urethrostomy. Bilateral inguinal lymphadenectomy is indicated for intermediate- and high-risk primary tumors or palpable adenopathy persisting after antimicrobial therapy.",
        "say": "Surgical treatment aims for oncological clearance with functional length preservation. Low-grade lesions undergo organ-sparing glansectomy, while deep corporal invasion requires partial or total penectomy with inguinal lymph node dissection.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Organ-Sparing Surgery",
            "points": [
              "Wide local excision or glansectomy",
              "Indicated for superficial T1 disease",
              "Preserves corporal length & function"
            ]
          },
          "right": {
            "title": "Radical Resection",
            "points": [
              "Partial penectomy or total penectomy",
              "Indicated for T2+ corporal cavernous invasion",
              "Bilateral inguinal lymph node staging"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-atls",
    "subject": "surgery",
    "title": "Advanced Trauma Life Support, primary survey, definitive airway, and lethal triad",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "ATLS Advanced Trauma Life Support 10th ed"
    ],
    "steps": [
      {
        "tx": "The Advanced Trauma Life Support primary survey organizes resuscitation into an orderly sequence designed to rapidly identify and treat immediately life-threatening **injuries**. The survey follows the ABCDE mnemonic: airway with cervical spine motion restriction, breathing and ventilation, circulation with hemorrhage control, disability and neurological status, and exposure with environmental hypothermia prevention. Resuscitative interventions occur concurrently with assessment, and deterioration at any stage mandates immediate reversion to airway re-evaluation.",
        "say": "The ATLS primary survey follows the ABCDE sequence: airway with cervical protection, breathing, circulation with hemorrhage control, neurological disability, and environmental exposure. Deterioration mandates immediate return to airway re-evaluation.",
        "vis": {
          "kind": "table",
          "cols": [
            "Primary survey step",
            "Clinical assessment target",
            "Immediate life-saving intervention"
          ],
          "rows": [
            [
              "Airway with C-spine",
              "Vocal responsiveness & airway patency",
              "Chin lift, jaw thrust, endotracheal tube"
            ],
            [
              "Breathing",
              "Tension pneumothorax, open chest wound",
              "Needle thoracostomy, chest tube, 3-sided dressing"
            ],
            [
              "Circulation",
              "External exsanguination & internal shock",
              "Direct pressure, pelvic binder, 1:1:1 blood"
            ],
            [
              "Disability",
              "Glasgow Coma Scale & pupillary light",
              "Correct hypoxia, hypotension, herniation"
            ],
            [
              "Exposure",
              "Complete body inspection & hypothermia",
              "Warm blankets, fluid warmers, room control"
            ]
          ]
        }
      },
      {
        "tx": "Establishing a definitive airway is indicated for apnea, severe neurological depression with Glasgow Coma Scale score of eight or **less**, impending airway compromise from inhalation burns, severe maxillofacial fractures, or inability to maintain oxygenation. Endotracheal intubation with rapid sequence induction and in-line manual cervical stabilization represents the primary approach. When endotracheal intubation fails or is anatomically impossible, surgical cricothyroidotomy through the cricothyroid membrane provides emergency surgical access in adults, whereas needle cricothyroidotomy is preferred in children under twelve.",
        "say": "Definitive airway placement is indicated for coma with GCS eight or less, apnea, or severe facial trauma. Endotracheal intubation with manual in-line cervical stabilization is first-line, followed by surgical cricothyroidotomy if intubation fails.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Severe trauma with airway compromise"
            },
            {
              "id": "n2",
              "label": "Rapid sequence intubation with C-spine control"
            },
            {
              "id": "n3",
              "label": "Failed intubation / cannot oxygenate"
            },
            {
              "id": "n4",
              "label": "Emergency surgical cricothyroidotomy"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Hemorrhagic shock is the leading preventable cause of early post-injury death. The five anatomical compartments capable of hiding major internal **bleeding** are the chest, abdomen, pelvis, retroperitoneum with long-bone fractures, and the external scene floor. Hemostatic resuscitation avoids excessive crystalloid infusion, employing early balanced blood component therapy utilizing packed red blood cells, fresh frozen plasma, and platelets in an equal one-to-one-to-one ratio alongside intravenous tranexamic acid administered within three hours of injury.",
        "say": "Hemorrhagic shock is assessed across five major compartments: chest, abdomen, pelvis, retroperitoneum, and floor. Resuscitation avoids crystalloids, prioritizing balanced one-to-one-to-one blood components and tranexamic acid within three hours.",
        "vis": {
          "kind": "table",
          "cols": [
            "Major bleeding compartment",
            "Bedside physical / radiological sign",
            "Emergency hemostatic control"
          ],
          "rows": [
            [
              "Thoracic cavity",
              "Dullness to percussion / hemothorax on X-ray",
              "Tube thoracostomy (thoracotomy if > 1500 mL)"
            ],
            [
              "Peritoneal cavity",
              "Abdominal distension / fluid on FAST scan",
              "Emergency exploratory laparotomy"
            ],
            [
              "Pelvic ring fracture",
              "Mechanically unstable open-book pelvis",
              "Immediate pelvic circumferential binder"
            ],
            [
              "Femoral / long bones",
              "Deformity, tense swelling, shortening",
              "Traction splinting & compartment monitoring"
            ]
          ]
        }
      },
      {
        "tx": "The lethal triad of trauma comprises hypothermia, metabolic acidosis, and coagulopathy, creating a self-reinforcing vicious physiological **cycle** that drives cellular shock and microvascular failure. Resuscitation room hypothermia impairs platelet aggregation and enzymatic clotting cascades, worsening hemorrhage and hypoperfusion. Damage control surgery interrupts this lethal spiral by prioritizing rapid operative control of active exsanguination and enteric contamination, temporary abdominal wall closure, and transfer to the intensive care unit for physiological correction.",
        "say": "The lethal triad of hypothermia, acidosis, and coagulopathy drives mortality in severe trauma. Damage control surgery interrupts this cycle by rapidly controlling bleeding and contamination, delaying definitive reconstruction until physiological stabilization.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Lethal Triad Cycle",
            "points": [
              "Hypothermia inhibits coagulation enzymes",
              "Acidosis reduces clotting factor activity",
              "Coagulopathy perpetuates exsanguinating hemorrhage",
              "Drive end-organ ischemia and death"
            ]
          },
          "right": {
            "title": "Damage Control Surgery",
            "points": [
              "Abbreviated laparotomy (< 60 minutes)",
              "Pack bleeding liver & staple hollow viscera",
              "Temporary abdominal closure with negative pressure",
              "ICU resuscitation of warmth & pH prior to re-exploration"
            ]
          }
        }
      }
    ]
  }
];
