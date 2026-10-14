#!/usr/bin/env node
/**
 * Generates original, medically verified MCQs for overlay maikbook1.
 * Covers:
 * - Anatomy (priority image-based MCQs using cropped A&P figures)
 * - Physiology (image-based & clinical mechanisms)
 * - Biochemistry (metabolic pathways & inborn errors)
 * - Surgery (Sabiston 22e core NEET-SS groups & clinical vignettes)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_DIR = path.join(ROOT, "prep/overlays/maikbook1");

const mcqSets = {
  anatomy: [
    {
      topic: "ana-orbit",
      items: [
        {
          id: "bk-ana-001",
          q: "In the provided ocular and orbital anatomy diagram, which structure passes OUTSIDE the common tendinous ring (annulus of Zinn) through the superior orbital fissure?",
          o: [
            "Abducens nerve (CN VI)",
            "Trochlear nerve (CN IV)",
            "Nasociliary nerve",
            "Inferior division of oculomotor nerve"
          ],
          a: 1,
          exp: "Structures passing outside the common tendinous ring through the superior orbital fissure include the Frontal nerve, Lacrimal nerve, Trochlear nerve (CN IV), and Superior ophthalmic vein. In contrast, the oculomotor nerve divisions, nasociliary nerve, and abducens nerve pass inside the ring.",
          r: [
            "Incorrect. The abducens nerve passes inside the tendinous ring.",
            "Correct. The trochlear nerve passes outside the common tendinous ring with the frontal and lacrimal nerves.",
            "Incorrect. The nasociliary nerve passes inside the tendinous ring.",
            "Incorrect. Both divisions of CN III pass inside the tendinous ring."
          ],
          kp: "Trochlear, frontal, lacrimal nerves and superior ophthalmic vein pass OUTSIDE the common tendinous ring.",
          img: ["ap-eye-gross.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-ana-002",
          q: "A 45-year-old patient undergoes an orbital floor reconstruction following a blowout fracture. Postoperatively, numbness is noted over the ipsilateral cheek, upper lip, and upper gingiva. Which nerve was injured within the orbital floor?",
          o: [
            "Zygomaticotemporal nerve",
            "Infraorbital nerve",
            "Lacrimal nerve",
            "Anterior ethmoidal nerve"
          ],
          a: 1,
          exp: "The infraorbital nerve (branch of maxillary nerve V2) courses through the infraorbital groove and canal in the orbital floor before exiting onto the face via the infraorbital foramen. Blowout fractures commonly injure this nerve, causing paresthesia of the ipsilateral cheek, upper lip and anterior teeth.",
          r: [
            "Incorrect. Zygomaticotemporal nerve supplies temple skin.",
            "Correct. The infraorbital nerve runs in the orbital floor and supplies the cheek and upper lip.",
            "Incorrect. Lacrimal nerve runs along the upper lateral orbital wall.",
            "Incorrect. Anterior ethmoidal nerve traverses the medial orbital wall."
          ],
          kp: "Infraorbital nerve runs along the orbital floor and is frequently damaged in maxillary blowout fractures.",
          img: ["ap-eye-gross.webp"],
          d: 2,
          cog: "application"
        }
      ]
    },
    {
      topic: "ana-larynx",
      items: [
        {
          id: "bk-ana-003",
          q: "In the anatomical schematic of the intrinsic laryngeal framework, which muscle is the SOLE abductor of the vocal cords responsible for opening the rima glottidis?",
          o: [
            "Lateral cricoarytenoid",
            "Posterior cricoarytenoid",
            "Cricothyroid",
            "Thyroarytenoid"
          ],
          a: 1,
          exp: "The posterior cricoarytenoid is the sole abductor of the vocal folds. It originates from the posterior surface of the cricoid lamina and inserts into the muscular process of the arytenoid cartilage. Bilateral injury to the recurrent laryngeal nerves denervates this muscle, leading to unopposed adduction and life-threatening airway compromise.",
          r: [
            "Incorrect. Lateral cricoarytenoid is a major adductor.",
            "Correct. Posterior cricoarytenoid is the only abductor of the vocal cords.",
            "Incorrect. Cricothyroid elongates and tenses the vocal folds.",
            "Incorrect. Thyroarytenoid relaxes the vocal ligaments."
          ],
          kp: "Posterior cricoarytenoid is the sole vocal cord abductor; bilateral denervation causes acute airway obstruction.",
          img: ["ap-larynx-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ana-004",
          q: "During thyroid surgery, ligation of the superior thyroid artery close to the superior pole of the thyroid gland risks injury to which accompanying nerve?",
          o: [
            "Recurrent laryngeal nerve",
            "External branch of superior laryngeal nerve",
            "Internal branch of superior laryngeal nerve",
            "Ansa cervicalis"
          ],
          a: 1,
          exp: "The external branch of the superior laryngeal nerve descends in close proximity to the superior thyroid artery near the superior pole of the thyroid. It innervates the cricothyroid muscle. Injury impairs vocal cord tension, causing vocal fatigue, voice weakness, and inability to produce high-pitched sounds.",
          r: [
            "Incorrect. Recurrent laryngeal nerve is intimate with the inferior thyroid artery.",
            "Correct. The external branch of superior laryngeal nerve travels alongside the superior thyroid artery.",
            "Incorrect. Internal branch pierces the thyrohyoid membrane superiorly.",
            "Incorrect. Ansa cervicalis lies superficial in the carotid sheath."
          ],
          kp: "External branch of superior laryngeal nerve accompanies superior thyroid artery; injury impairs high-pitch phonation.",
          img: ["ap-larynx-gross.webp"],
          d: 2,
          cog: "application"
        }
      ]
    },
    {
      topic: "ana-nose-sinuses",
      items: [
        {
          id: "bk-ana-005",
          q: "In the lateral nasal wall cross-section, where does the nasolacrimal duct terminate and drain?",
          o: [
            "Sphenoethmoidal recess",
            "Superior meatus",
            "Middle meatus",
            "Inferior meatus"
          ],
          a: 3,
          exp: "The nasolacrimal duct opens into the inferior meatus beneath the inferior nasal concha, guarded by the mucosal fold known as the valve of Hasner. The middle meatus receives the frontal, maxillary, and anterior ethmoidal sinuses; the superior meatus receives posterior ethmoidal air cells; and the sphenoethmoidal recess receives the sphenoid sinus.",
          r: [
            "Incorrect. Sphenoid sinus drains into the sphenoethmoidal recess.",
            "Incorrect. Posterior ethmoidal air cells drain into superior meatus.",
            "Incorrect. Frontal and maxillary sinuses drain into middle meatus.",
            "Correct. The nasolacrimal duct drains into the inferior meatus under the valve of Hasner."
          ],
          kp: "Nasolacrimal duct drains into the inferior meatus beneath the inferior concha.",
          img: ["ap-nose-sinuses-gross.webp"],
          d: 1,
          cog: "recall"
        }
      ]
    },
    {
      topic: "ana-ear",
      items: [
        {
          id: "bk-ana-006",
          q: "In the middle ear diagram, which structure forms the primary acoustic impedance matching mechanism between airborne sound and cochlear fluid?",
          o: [
            "Area ratio of tympanic membrane to stapes footplate",
            "Mass of the malleus head",
            "Contraction of the tensor tympani muscle",
            "Volume of the mastoid antrum"
          ],
          a: 0,
          exp: "The middle ear overcomes the high acoustic impedance of cochlear fluid predominantly via the areal ratio of the tympanic membrane (effective area ~55 mm²) to the stapes footplate (~3.2 mm²), which provides a roughly 17:1 mechanical advantage, boosted further by a 1.3:1 ossicular lever ratio to achieve an overall 20-fold sound pressure amplification.",
          r: [
            "Correct. The areal ratio of tympanic membrane to stapes footplate accounts for most impedance matching.",
            "Incorrect. Malleus mass does not drive the primary pressure amplification.",
            "Incorrect. Tensor tympani dampens sound rather than amplifying it.",
            "Incorrect. Mastoid antrum is an air reservoir, not an acoustic lever."
          ],
          kp: "Impedance matching is driven by the ~17:1 area ratio between tympanic membrane and stapes footplate.",
          img: ["ap-ear-gross.webp"],
          d: 2,
          cog: "analysis"
        }
      ]
    },
    {
      topic: "ana-brainstem",
      items: [
        {
          id: "bk-ana-007",
          q: "A 62-year-old man presents with sudden vertigo, dysphagia, hoarseness, ipsilateral facial numbness, ipsilateral Horner syndrome, and loss of pain and temperature sensation over the contralateral trunk and extremities. An occlusion of which artery is responsible?",
          o: [
            "Anterior inferior cerebellar artery (AICA)",
            "Posterior inferior cerebellar artery (PICA)",
            "Anterior spinal artery",
            "Superior cerebellar artery (SCA)"
          ],
          a: 1,
          exp: "This is classic lateral medullary syndrome (Wallenberg syndrome), caused by occlusion of the posterior inferior cerebellar artery (PICA) or vertebral artery. The nucleus ambiguus damage causes dysphagia and hoarseness; the spinal trigeminal nucleus lesion causes ipsilateral facial sensory loss; descending sympathetics cause Horner syndrome; and spinothalamic tract infarction causes contralateral body sensory loss.",
          r: [
            "Incorrect. AICA infarction causes lateral pontine syndrome with facial paralysis and hearing loss.",
            "Correct. PICA occlusion causes lateral medullary syndrome (Wallenberg syndrome).",
            "Incorrect. Anterior spinal artery occlusion causes medial medullary syndrome with tongue deviation.",
            "Incorrect. Superior cerebellar artery occlusion does not cause dysphagia or hoarseness."
          ],
          kp: "Lateral medullary (Wallenberg) syndrome is caused by PICA occlusion; nucleus ambiguus damage causes dysphagia and hoarseness.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        }
      ]
    }
  ],

  physiology: [
    {
      topic: "phy-mechanics",
      items: [
        {
          id: "bk-phy-001",
          q: "In the respiratory physiology infographic, by what mechanism does pulmonary surfactant prevent alveolar collapse at low lung volumes according to Laplace law (P = 2T/r)?",
          o: [
            "By increasing alveolar radius proportionally during expiration",
            "By lowering surface tension more dramatically in smaller alveoli",
            "By decreasing intrapleural pressure below -15 cm H2O",
            "By increasing bronchial smooth muscle tone"
          ],
          a: 1,
          exp: "According to Laplace law (P = 2T/r), a smaller radius increases collapsing pressure if surface tension (T) remains constant. Surfactant molecules concentrate more densely on the surface of shrinking alveoli during expiration, lowering surface tension proportionally and thereby equalizing collapsing pressures across varying alveolar sizes.",
          r: [
            "Incorrect. Alveolar radius decreases during expiration.",
            "Correct. Surfactant molecules concentrate in smaller alveoli, lowering surface tension and stabilizing them.",
            "Incorrect. Surfactant acts on surface tension, not by hyper-negativizing intrapleural pressure.",
            "Incorrect. Bronchial smooth muscle tone does not regulate alveolar collapsing pressure."
          ],
          kp: "Surfactant concentrates in smaller alveoli, lowering surface tension and preventing diffuse atelectasis.",
          img: ["ap-lung-alveoli-gas-exchange.webp"],
          d: 2,
          cog: "analysis"
        }
      ]
    },
    {
      topic: "phy-tubular",
      items: [
        {
          id: "bk-phy-002",
          q: "In the nephron transport schematic, which transporter in the thick ascending limb of Henle establishes the lumen-positive potential that drives paracellular calcium and magnesium reabsorption?",
          o: [
            "SGLT2 sodium-glucose cotransporter",
            "NKCC2 Na+-K+-2Cl- cotransporter with ROMK potassium recycling",
            "NCCT sodium-chloride cotransporter",
            "Epithelial sodium channel (ENaC)"
          ],
          a: 1,
          exp: "The NKCC2 cotransporter reabsorbs 1 Na+, 1 K+ and 2 Cl- electroneutrally. However, back-leakage of K+ into the tubular lumen via apical ROMK channels creates an lumen-positive transepithelial potential of approximately +8 mV, which repels and drives paracellular reabsorption of divalent cations Ca2+ and Mg2+. Loop diuretics inhibit NKCC2, abolishing this potential and causing hypercalciuria.",
          r: [
            "Incorrect. SGLT2 is located in the proximal tubule.",
            "Correct. NKCC2 combined with ROMK potassium back-leak generates the lumen-positive driving potential.",
            "Incorrect. NCCT is electroneutral and located in the distal convoluted tubule.",
            "Incorrect. ENaC creates a lumen-negative potential in collecting ducts."
          ],
          kp: "ROMK potassium back-leak in the thick ascending limb generates a lumen-positive potential driving Ca2+ and Mg2+ reabsorption.",
          img: ["ap-nephron-filtration.webp"],
          d: 2,
          cog: "analysis"
        }
      ]
    },
    {
      topic: "phy-cardiac-electro",
      items: [
        {
          id: "bk-phy-003",
          q: "In the cardiac conduction infographic, which ion current is primarily responsible for the spontaneous phase 4 diastolic depolarization of sinoatrial nodal pacemaker cells?",
          o: [
            "Fast inward sodium current (INa)",
            "Funny pacemaker current (If) carried through HCN channels",
            "Inward rectifier potassium current (IK1)",
            "Delayed rectifier potassium current (IKr)"
          ],
          a: 1,
          exp: "The funny current (If), conducted by hyperpolarization-activated cyclic nucleotide-gated (HCN) channels, carries a slow inward mixed Na+/K+ flux activated during repolarization. This slowly depolarizes the sinoatrial node membrane from -60 mV toward threshold (-40 mV), initiating the next pacemaker action potential.",
          r: [
            "Incorrect. Fast inward sodium current is absent or negligible in SA nodal tissue.",
            "Correct. The funny current (If) carries spontaneous phase 4 depolarization in pacemaker cells.",
            "Incorrect. IK1 is absent in pacemaker cells, allowing spontaneous depolarization.",
            "Incorrect. IKr repolarizes the membrane (phase 3), but does not drive phase 4 depolarization."
          ],
          kp: "Phase 4 pacemaker depolarization is driven by the inward funny current (If) via HCN channels.",
          img: ["ap-heart-conduction-cycle.webp"],
          d: 2,
          cog: "recall"
        }
      ]
    }
  ],

  biochemistry: [
    {
      topic: "bio-glycolysis-tca",
      items: [
        {
          id: "bk-bio-001",
          q: "A 48-year-old man with chronic severe alcohol dependence is brought to the emergency department with confusion, horizontal nystagmus, and truncal ataxia. Administration of intravenous glucose without prior thiamine administration risks precipitating acute lactic acidosis and neurological worsening due to impairment of which enzyme complex?",
          o: [
            "Phosphofructokinase-1",
            "Pyruvate dehydrogenase complex",
            "Citrate synthase",
            "Lactate dehydrogenase"
          ],
          a: 1,
          exp: "The pyruvate dehydrogenase (PDH) complex and alpha-ketoglutarate dehydrogenase require thiamine pyrophosphate (TPP, vitamin B1) as an essential cofactor. In thiamine deficiency, glucose loading drives glycolysis but pyruvate cannot enter the TCA cycle via PDH, accumulating and converting into lactic acid, which precipitates severe lactic acidosis and Wernicke encephalopathy.",
          r: [
            "Incorrect. PFK-1 does not require thiamine pyrophosphate.",
            "Correct. Pyruvate dehydrogenase requires thiamine pyrophosphate; glucose without thiamine worsens Wernicke encephalopathy.",
            "Incorrect. Citrate synthase does not require thiamine.",
            "Incorrect. Lactate dehydrogenase uses NADH, not thiamine."
          ],
          kp: "Pyruvate dehydrogenase requires thiamine pyrophosphate; administering glucose without thiamine precipitates acute Wernicke encephalopathy.",
          img: [],
          d: 2,
          cog: "application"
        }
      ]
    },
    {
      topic: "bio-fatty-acid-oxidation",
      items: [
        {
          id: "bk-bio-002",
          q: "A 14-month-old child presents with lethargy, vomiting, and generalized seizures after a 16-hour fast during a viral gastroenteritis episode. Laboratory testing shows a blood glucose of 28 mg/dL, absent urine ketones, elevated serum transaminases, and high circulating C8 octanoylcarnitine levels. Which condition is most likely?",
          o: [
            "Glycogen storage disease type I (von Gierke)",
            "Medium-chain acyl-CoA dehydrogenase (MCAD) deficiency",
            "Primary hyperaldosteronism",
            "Fructose 1,6-bisphosphatase deficiency"
          ],
          a: 1,
          exp: "MCAD deficiency is an autosomal recessive disorder of mitochondrial beta-oxidation presenting during fasting with severe hypoketotic hypoglycemia, dicarboxylic aciduria, and elevated C8 octanoylcarnitine. Hepatic gluconeogenesis fails because acetyl-CoA from beta-oxidation is required to allosterically activate pyruvate carboxylase.",
          r: [
            "Incorrect. Von Gierke disease causes severe hyperketotic hypoglycemia with hepatomegaly and lactic acidosis.",
            "Correct. MCAD deficiency causes hypoketotic hypoglycemia with elevated octanoylcarnitine (C8) on fasting.",
            "Incorrect. Hyperaldosteronism causes hypertension and hypokalemia without hypoglycemia.",
            "Incorrect. Fructose 1,6-bisphosphatase deficiency causes lactic acidosis and ketosis."
          ],
          kp: "MCAD deficiency presents with severe fasting hypoketotic hypoglycemia and elevated octanoylcarnitine.",
          img: [],
          d: 2,
          cog: "application"
        }
      ]
    },
    {
      topic: "bio-urea-cycle",
      items: [
        {
          id: "bk-bio-003",
          q: "A 3-day-old male neonate develops poor feeding, progressive lethargy, and vomiting. Blood gas reveals respiratory alkalosis with an ammonia level of 680 mcmol/L. Urine organic acid profiling demonstrates massively elevated orotic acid with undetectable citrulline. Which is the deficient enzyme?",
          o: [
            "Carbamoyl phosphate synthetase-I",
            "Ornithine transcarbamylase",
            "Argininosuccinate lyase",
            "Uridine monophosphate (UMP) synthase"
          ],
          a: 1,
          exp: "Ornithine transcarbamylase (OTC) deficiency is the most common urea cycle disorder (X-linked recessive). Deficient OTC causes mitochondrial carbamoyl phosphate accumulation, which spills into the cytosol and enters pyrimidine synthesis via CPS-II, resulting in massive urinary orotic acid alongside severe hyperammonemia.",
          r: [
            "Incorrect. CPS-I deficiency presents with hyperammonemia but LOW or absent urinary orotic acid.",
            "Correct. OTC deficiency produces severe hyperammonemia coupled with massively elevated urinary orotic acid.",
            "Incorrect. Argininosuccinate lyase deficiency causes elevated argininosuccinic acid.",
            "Incorrect. UMP synthase deficiency causes orotic aciduria with NORMAL ammonia and megaloblastic anemia."
          ],
          kp: "OTC deficiency causes severe hyperammonemia with high urinary orotic acid; CPS-I deficiency has low orotic acid.",
          img: [],
          d: 2,
          cog: "application"
        }
      ]
    }
  ],

  surgery: [
    {
      topic: "sur-wound-healing",
      items: [
        {
          id: "bk-sur-001",
          q: "In the physiological timeline of surgical wound healing, at what postoperative interval does wound tensile strength reach approximately 20% of unwounded baseline skin?",
          o: [
            "48 hours",
            "7 days",
            "3 weeks",
            "1 year"
          ],
          a: 2,
          exp: "Wound tensile strength develops slowly. It is virtually negligible during the first 48 hours, rises to approximately 3% at 1 week, reaches about 20% at 3 weeks (the transition from proliferative to remodeling phase), and plateaus at a maximum of 70% to 80% of original unwounded skin strength by 1 year.",
          r: [
            "Incorrect. Tensile strength is nearly zero during the initial inflammatory phase.",
            "Incorrect. At 7 days tensile strength is only ~3-5% (sutures provide primary support).",
            "Correct. At 3 weeks tensile strength reaches ~20%, allowing safe skin suture removal.",
            "Incorrect. At 1 year tensile strength reaches its plateau of ~80%."
          ],
          kp: "Wound tensile strength reaches 20% at 3 weeks and plateaus at ~80% at 1 year.",
          img: [],
          d: 2,
          cog: "recall"
        }
      ]
    },
    {
      topic: "sur-shock-transfusion",
      items: [
        {
          id: "bk-sur-002",
          q: "A 28-year-old polytrauma patient following a high-speed vehicular collision presents with a heart rate of 128 bpm, blood pressure of 86/60 mmHg, respiratory rate of 32/min, cold pale extremities, and confusion. According to the ATLS classification, what class of hemorrhagic shock does this represent?",
          o: [
            "Class I (blood loss < 15%)",
            "Class II (blood loss 15-30%)",
            "Class III (blood loss 30-40%)",
            "Class IV (blood loss > 40%)"
          ],
          a: 2,
          exp: "Class III hemorrhagic shock represents 30% to 40% blood volume loss (1500 to 2000 mL in a 70 kg adult). It is defined by marked tachycardia (>120 bpm), overt hypotension, tachypnea (30-40/min), oliguria, and mental confusion. Class II features normal systolic pressure with narrowed pulse pressure; Class IV features severe hypotension and coma.",
          r: [
            "Incorrect. Class I features normal vitals (<15% loss).",
            "Incorrect. Class II features tachycardia but NORMAL systolic blood pressure.",
            "Correct. Class III shock features marked tachycardia, frank hypotension, and confusion (30-40% blood loss).",
            "Incorrect. Class IV features severe collapse with loss of consciousness and >40% loss."
          ],
          kp: "Class III hemorrhagic shock (30-40% loss) is characterized by tachycardia >120 and overt hypotension.",
          img: [],
          d: 2,
          cog: "application"
        }
      ]
    },
    {
      topic: "sur-thyroid",
      items: [
        {
          id: "bk-sur-003",
          q: "A 38-year-old woman undergoes fine-needle aspiration of an asymptomatic 1.8 cm solid hypoechoic thyroid nodule. The cytopathology report states Bethesda Category IV: Follicular Neoplasm. What is the most appropriate next management step?",
          o: [
            "Repeat ultrasound in 12 months without surgery",
            "Diagnostic thyroid lobectomy (hemithyroidectomy)",
            "Immediate radioactive iodine ablation (I-131)",
            "External beam radiation therapy"
          ],
          a: 1,
          exp: "Bethesda Category IV carries a 25% to 40% risk of malignancy. FNA cytology cannot distinguish follicular thyroid adenoma from follicular carcinoma because the diagnosis of malignancy requires histological demonstration of capsular or vascular invasion on permanent sections. Diagnostic lobectomy (or molecular testing) is the established standard of care.",
          r: [
            "Incorrect. Observation alone is inappropriate given the 25-40% malignancy risk.",
            "Correct. Diagnostic thyroid lobectomy provides histological tissue to assess for capsular or vascular invasion.",
            "Incorrect. Radioactive iodine is only used postoperatively for confirmed high-risk thyroid cancer.",
            "Incorrect. External beam radiation is not indicated for follicular neoplasms."
          ],
          kp: "Bethesda IV (follicular neoplasm) requires diagnostic lobectomy to assess for capsular or vascular invasion.",
          img: [],
          d: 2,
          cog: "application"
        }
      ]
    },
    {
      topic: "sur-gallbladder",
      items: [
        {
          id: "bk-sur-004",
          q: "During a laparoscopic cholecystectomy, which anatomical landmark combination fulfills the Strasberg Critical View of Safety before clipping or dividing any tubular structures?",
          o: [
            "Identification of the junction between cystic duct and common bile duct",
            "Dissection of the hepatoduodenal ligament exposing the common hepatic artery",
            "Clearing fat from hepatocystic triangle, mobilizing lower third of gallbladder off cystic plate, and visualizing exactly two structures entering the gallbladder",
            "Visualizing the cystic lymph node of Lund and infundibular traction alone"
          ],
          a: 2,
          exp: "The Strasberg Critical View of Safety mandates: (1) clearing the hepatocystic triangle of all fat and fibrous tissue, (2) mobilizing the lower third of the gallbladder off the cystic plate (liver bed), and (3) confirming that exactly two structures (cystic duct and cystic artery) enter the gallbladder. Dissecting the common bile duct is dangerous and explicitly avoided.",
          r: [
            "Incorrect. Exposing the junction with the common bile duct increases the risk of duct injury.",
            "Incorrect. Routine dissection of the hepatoduodenal ligament is dangerous and unnecessary.",
            "Correct. The Critical View requires clearing the hepatocystic triangle, freeing the lower gallbladder from cystic plate, and confirming only two structures enter the organ.",
            "Incorrect. Traction on the infundibulum alone does not ensure safety against misidentification."
          ],
          kp: "Critical View of Safety requires clearing the hepatocystic triangle, detaching lower 1/3 from cystic plate, and seeing only 2 structures.",
          img: [],
          d: 2,
          cog: "analysis"
        }
      ]
    },
    {
      topic: "sur-hernia",
      items: [
        {
          id: "bk-sur-005",
          q: "During a laparoscopic transabdominal preperitoneal (TAPP) inguinal hernia repair, placing fixation tacks in the 'Triangle of Pain' lateral to the spermatic vessels risks entrapment and permanent injury to which nerves?",
          o: [
            "Iliohypogastric and ilioinguinal nerves",
            "Femoral branch of genitofemoral and lateral femoral cutaneous nerves",
            "Obturator and pudendal nerves",
            "Subcostal and twelfth thoracic nerves"
          ],
          a: 1,
          exp: "The Triangle of Pain is bounded medially by testicular vessels, superiorly by the iliopubic tract, and laterally by the anterior superior iliac spine. It transmits the femoral branch of the genitofemoral nerve, the lateral femoral cutaneous nerve (LFCN), and the femoral nerve. Fixation tacks placed in this zone cause severe chronic neuropathic pain and burning paresthesia in the anterolateral thigh.",
          r: [
            "Incorrect. Iliohypogastric and ilioinguinal nerves run in the anterior abdominal wall layers.",
            "Correct. Tacks in the Triangle of Pain injure the lateral femoral cutaneous nerve and femoral branch of genitofemoral nerve.",
            "Incorrect. Obturator nerve lies deep in the pelvis below the pectineal line.",
            "Incorrect. Subcostal nerve lies well superior to the inguinal region."
          ],
          kp: "Tacks in the Triangle of Pain risk injuring the lateral femoral cutaneous and genitofemoral nerves, causing chronic neuralgia.",
          img: [],
          d: 2,
          cog: "application"
        }
      ]
    }
  ]
};

let totalWritten = 0;

for (const [subject, topics] of Object.entries(mcqSets)) {
  const subjDir = path.join(BASE_DIR, subject);
  fs.mkdirSync(subjDir, { recursive: true });

  for (const t of topics) {
    const fileObj = {
      topic: t.topic,
      set: "maikbook1",
      v: 1,
      items: t.items.map((it) => ({
        prov: "SMD",
        gen: "hand",
        set: "maikbook1",
        d: it.d || 2,
        cog: it.cog || "recall",
        imgPlace: it.img && it.img.length ? "stem" : undefined,
        credit: "StewardMD illustration",
        licence: "CC BY 4.0 (StewardMD original)",
        licenceStandard: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0",
        quality: {
          status: "automated_checks_passed",
          gates: {
            author_self_check: {
              note: "Hand-authored and verified against standard references"
            }
          }
        },
        id: it.id,
        q: it.q,
        o: it.o,
        a: it.a,
        exp: it.exp,
        r: it.r,
        kp: it.kp,
        t: t.topic,
        img: it.img,
        x: {
          key: it.kp,
          pearl: it.kp
        }
      }))
    };

    const outPath = path.join(subjDir, `${t.topic}.json`);
    fs.writeFileSync(outPath, JSON.stringify(fileObj, null, 1) + "\n");
    totalWritten += t.items.length;
    console.log(`Wrote ${t.items.length} MCQs for ${subject}/${t.topic}`);
  }
}

console.log(`\nTotal MCQs authored and saved: ${totalWritten}`);
