/**
 * Wave 3B Lessons Part 3: Chapters 35 to 43 (9 Lessons)
 */

export const wave3bLessonsPart3 = [
  // Ch 35: Water and Electrolytes Homeostasis
  {
    module: "bio-fluids-electrolytes",
    subject: "biochemistry",
    title: "Fluid compartments, plasma osmolality, Starling forces, and hyponatremia",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Total body water constitutes approximately 60 percent of lean body mass, partitioned between intracellular fluid (two-thirds) and extracellular fluid (one-third). The extracellular fluid further divides into interstitial fluid (three-quarters) and intravascular plasma volume (one-quarter). Plasma **osmolality** is tightly maintained between 275 and 295 mOsm/kg, calculated primarily by sodium, glucose, and urea. Free water shifts rapidly across cell membranes through aquaporin channels to equalize intracellular and extracellular osmolality.",
        say: "Total body water comprises sixty percent of mass, divided into intracellular and extracellular compartments. Normal plasma osmolality ranges from 275 to 295 milliosmoles per kilogram, determined by sodium, glucose, and urea, with water shifting via aquaporins to maintain equilibrium.",
        vis: {
          kind: "table",
          cols: ["Fluid compartment", "Fraction of body water", "Dominant ions"],
          rows: [
            ["Intracellular fluid (ICF)", "2/3 (~28 L in 70kg)", "Potassium (K+), Magnesium (Mg2+), Phosphates"],
            ["Extracellular fluid (ECF)", "1/3 (~14 L in 70kg)", "Sodium (Na+), Chloride (Cl-), Bicarbonate (HCO3-)"],
            ["Interstitial space", "3/4 of ECF (~10.5 L)", "Identical to plasma, low protein content"],
            ["Intravascular plasma", "1/4 of ECF (~3.5 L)", "High albumin, colloid oncotic pressure 25 mmHg"]
          ]
        }
      },
      {
        tx: "Microvascular fluid exchange across capillaries is governed by **Starling** forces: capillary hydrostatic pressure, interstitial hydrostatic pressure, plasma colloid oncotic pressure, and interstitial oncotic pressure. Capillary hydrostatic pressure promotes filtration of water into the interstitium, opposed by plasma oncotic pressure exerted predominantly by serum albumin. Derangements in these forces precipitate peripheral pitting edema or pulmonary edema when lymphatic clearance capacity is exceeded.",
        say: "Starling forces govern capillary fluid filtration. Hydrostatic pressure drives water out of capillaries, while albumin colloid oncotic pressure retains intravascular fluid. Imbalances or lymphatic obstruction lead directly to clinical edema.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "s1", label: "Capillary hydrostatic pressure pushes outward" },
            { id: "s2", label: "Plasma oncotic pressure (albumin) pulls inward" },
            { id: "s3", label: "Net filtration exceeds venous reabsorption" },
            { id: "s4", label: "Lymphatic vessels clear excess fluid" },
            { id: "s5", label: "High hydrostatic or low oncotic pressure causes Edema" }
          ],
          edges: [
            ["s1", "s3"],
            ["s2", "s3"],
            ["s3", "s4"],
            ["s3", "s5"]
          ]
        }
      },
      {
        tx: "Disorders of water balance manifest as hypo- or hypernatremia. **Hyponatremia** represents an excess of water relative to sodium. Hypotonic hyponatremia is categorized by extracellular volume status: hypovolemic (vomiting, diuretics), euvolemic (SIADH, psychogenic polydipsia), and hypervolemic (heart failure, cirrhosis, nephrotic syndrome). The syndrome of inappropriate ADH secretion (SIADH) features concentrated urine (osmolality >100 mOsm/kg, sodium >20-40 mEq/L) despite plasma hypo-osmolality.",
        say: "Hyponatremia reflects relative water excess. Hypotonic hyponatremia divides into hypovolemic, euvolemic, and hypervolemic states. SIADH presents with euvolemic hyponatremia, concentrated urine, and inappropriately high urinary sodium excretion.",
        vis: {
          kind: "table",
          cols: ["Volume state", "Clinical etiologies", "Urine sodium diagnostic finding"],
          rows: [
            ["Hypovolemic", "Dehydration, GI loss, thiazides", "Urine Na+ <20 (extrarenal) vs >20 (renal loss)"],
            ["Euvolemic", "SIADH, hypothyroidism, adrenal crisis", "Urine Na+ >20-40 mEq/L, high urine osmolality"],
            ["Hypervolemic", "Heart failure, cirrhosis, nephrotic", "Urine Na+ <20 mEq/L (avid renal retention)"],
            ["Pseudohyponatremia", "Severe hyperlipidemia, paraproteinemia", "Normal measured plasma osmolality"]
          ]
        }
      },
      {
        tx: "Rapid correction of chronic hyponatremia carries lethal neurological danger. Raising serum sodium faster than 8 to 10 mEq/L in 24 hours draws free water out of brain cells, precipitating **osmotic demyelination** syndrome (central pontine myelinolysis), presenting with spastic quadriplegia, pseudobulbar palsy, and locked-in syndrome. Conversely, overly rapid correction of severe hypernatremia causes acute cerebral edema and herniation from excessive water influx into brain cells.",
        say: "Correcting chronic hyponatremia too rapidly causes osmotic demyelination syndrome with spastic quadriplegia and locked-in state. Sodium correction must never exceed 8 to 10 milliequivalents per liter in twenty-four hours.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "c1", label: "Chronic hyponatremia: brain expels idiogenic osmolytes" },
            { id: "c2", label: "Overly rapid hypertonic saline infusion" },
            { id: "c3", label: "Acute rise in extracellular osmolality" },
            { id: "c4", label: "Rapid cellular water efflux from pontine glial cells" },
            { id: "c5", label: "Osmotic demyelination syndrome (Locked-in state)" }
          ],
          edges: [
            ["c1", "c2"],
            ["c2", "c3"],
            ["c3", "c4"],
            ["c4", "c5"]
          ]
        }
      }
    ]
  },

  // Ch 36: Acid–Base Balance
  {
    module: "bio-acid-base-balance",
    subject: "biochemistry",
    title: "Acid-base homeostasis: Henderson-Hasselbalch, the anion gap, and renal compensation",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Physiological arterial blood pH is tightly defended between 7.35 and 7.45 by chemical buffers, respiratory ventilation, and renal tubular transport. The primary extracellular buffer is the **bicarbonate-carbonic** acid system, governed by the Henderson-Hasselbalch equation: pH equals 6.1 plus the logarithm of bicarbonate divided by 0.03 times PaCO2. Alveolar ventilation alters PaCO2 within minutes, whereas renal tubular bicarbonate reabsorption and net acid excretion (titratable acid and ammonium) require several days for full compensation.",
        say: "Blood pH is strictly maintained between 7.35 and 7.45. The bicarbonate-carbonic acid buffer governs extracellular pH. Respiratory compensation adjusts PaCO2 within minutes, while renal reclamation of bicarbonate and ammonium excretion takes several days.",
        vis: {
          kind: "table",
          cols: ["Primary disorder", "Initial chemical disturbance", "Compensatory physiological response"],
          rows: [
            ["Metabolic acidosis", "Decreased HCO3- (<22 mEq/L)", "Hyperventilation lowers PaCO2 (Winter formula)"],
            ["Metabolic alkalosis", "Elevated HCO3- (>26 mEq/L)", "Hypoventilation raises PaCO2 (0.7 mmHg per 1 mEq/L)"],
            ["Respiratory acidosis", "Elevated PaCO2 (>45 mmHg)", "Renal retention of HCO3- (1 acute, 3.5 chronic per 10)"],
            ["Respiratory alkalosis", "Decreased PaCO2 (<35 mmHg)", "Renal excretion of HCO3- (2 acute, 5 chronic per 10)"]
          ]
        }
      },
      {
        tx: "Metabolic acidosis is classified according to the serum **anion gap**, calculated as serum sodium minus the sum of chloride and bicarbonate (normal range 8 to 12 mEq/L). An elevated anion gap indicates the presence of unmeasured organic anions that titrate away plasma bicarbonate. Classic causes are remembered by the mnemonic **MUDPILES**: methanol, uremia, diabetic ketoacidosis, propylene glycol, isoniazid/iron, lactic acidosis, ethylene glycol, and salicylates.",
        say: "Metabolic acidosis divides into high anion gap and normal anion gap types. An elevated anion gap indicates unmeasured anions like ketoacids, lactate, or toxins titrating bicarbonate. Common etiologies include DKA, lactic acidosis, and toxic alcohols.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "a1", label: "Patient with metabolic acidosis (low HCO3-)" },
            { id: "a2", label: "Calculate serum Anion Gap = Na - (Cl + HCO3)" },
            { id: "a3", label: "Anion gap > 12: High Anion Gap Acidosis (MUDPILES)" },
            { id: "a4", label: "Anion gap 8-12: Normal Anion Gap / Hyperchloremic" },
            { id: "a5", label: "Calculate urine anion gap to distinguish RTA vs diarrhea" }
          ],
          edges: [
            ["a1", "a2"],
            ["a2", "a3"],
            ["a2", "a4"],
            ["a4", "a5"]
          ]
        }
      },
      {
        tx: "Normal anion gap (hyperchloremic) metabolic acidosis arises from either gastrointestinal bicarbonate loss (severe diarrhea) or renal tubular acidosis (RTA). In Type 1 (distal) RTA, intercalated cells fail to excrete hydrogen ions, causing nephrocalcinosis, hypokalemia, and urine pH above 5.5. In Type 2 (proximal) RTA, impaired proximal bicarbonate reabsorption causes Fanconi syndrome with hypokalemia. In Type 4 RTA, **hypoaldosteronism** or aldosterone resistance impairs distal potassium and proton excretion, producing hyperkalemia.",
        say: "Normal anion gap acidosis results from GI bicarbonate wasting or renal tubular acidosis. Type 1 distal RTA features urine pH above 5.5 and stones. Type 2 proximal RTA impairs bicarbonate salvage. Type 4 RTA is marked by hyperkalemia due to aldosterone deficiency.",
        vis: {
          kind: "table",
          cols: ["RTA Subtype", "Tubular site & defect", "Serum K+ & Urine pH"],
          rows: [
            ["Type 1 (Distal RTA)", "Alpha-intercalated cell H+-ATPase failure", "Hypokalemia; Urine pH > 5.5 (nephrolithiasis)"],
            ["Type 2 (Proximal RTA)", "Defective proximal HCO3- reabsorption", "Hypokalemia; Urine pH < 5.5 variable"],
            ["Type 4 (Hyperkalemic RTA)", "Aldosterone deficiency or resistance", "Hyperkalemia; Urine pH < 5.5 (diabetic nephropathy)"],
            ["Severe diarrhea", "GI bicarbonate wasting with normal kidneys", "Hypokalemia; negative urine anion gap (NH4+ present)"]
          ]
        }
      },
      {
        tx: "Toxic alcohol ingestion generates distinctive **osmolal** and anion gaps. Ethylene glycol is metabolized by alcohol dehydrogenase into glycolic and oxalic acids, precipitating envelope-shaped calcium oxalate crystals that cause acute tubular necrosis and renal failure. Methanol oxidizes into formic acid, causing optic disc hyperemia and permanent blindness. Treatment requires immediate competitive inhibition of alcohol dehydrogenase with fomepizole or ethanol, coupled with hemodialysis.",
        say: "Ethylene glycol and methanol generate severe anion gap acidosis and high osmolal gaps. Ethylene glycol forms oxalic acid causing renal failure with oxalate crystals, while methanol yields formic acid causing blindness. Fomepizole blocks alcohol dehydrogenase.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "t1", label: "Toxic alcohol ingestion" },
            { id: "t2", label: "Alcohol dehydrogenase bioactivation" },
            { id: "t3", label: "Formic acid (Methanol) or Oxalic acid (Ethylene glycol)" },
            { id: "t4", label: "High anion gap & high osmolal gap" },
            { id: "t5", label: "Fomepizole blockade + Emergent hemodialysis" }
          ],
          edges: [
            ["t1", "t2"],
            ["t2", "t3"],
            ["t3", "t4"],
            ["t4", "t5"]
          ]
        }
      }
    ]
  },

  // Ch 37: Muscle Energy Metabolism
  {
    module: "bio-muscle-metabolism",
    subject: "biochemistry",
    title: "Muscle bioenergetics: creatine phosphate shuttle, glycogenolysis, and rhabdomyolysis",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Lehninger Principles of Biochemistry 8th ed"],
    steps: [
      {
        tx: "Skeletal muscle utilizes distinct energetic pathways tailored to exercise duration and intensity. During the initial four to six seconds of maximal sprint, cytosolic **ATP** and phosphocreatine provide immediate high-energy phosphate transfer via creatine kinase without requiring oxygen. Creatine is synthesized from arginine, glycine, and SAM in the kidneys and liver, then transported to muscle. Phosphocreatine regenerates ATP rapidly, buffering cellular ATP concentrations during sudden contraction onset.",
        say: "Muscle contraction relies on immediate ATP and phosphocreatine buffering via creatine kinase during the initial seconds of exercise. Creatine is synthesized in kidneys and liver from arginine and glycine, then phosphorylated in muscle to form high-energy phosphocreatine.",
        vis: {
          kind: "table",
          cols: ["Energy system", "Substrate utilized", "Duration of maximal power"],
          rows: [
            ["Phosphagen system", "Phosphocreatine + ADP -> ATP + Creatine", "0 to 10 seconds (maximal explosive burst)"],
            ["Anaerobic glycolysis", "Muscle glycogen to lactate", "10 seconds to 2 minutes (high intensity)"],
            ["Aerobic oxidation", "Glycogen, glucose, fatty acid beta-oxidation", ">2 minutes to hours (endurance exercise)"],
            ["Creatinine excretion", "Spontaneous non-enzymatic cyclization", "Constant daily urinary excretion proportional to muscle mass"]
          ]
        }
      },
      {
        tx: "During vigorous anaerobic contraction, muscle **glycogenolysis** supplies glucose-6-phosphate for rapid glycolytic ATP generation. Epinephrine stimulates protein kinase A, which activates phosphorylase kinase to convert inactive glycogen phosphorylase b into active phosphorylase a. In exercising muscle, allosteric activation by AMP and calcium-calmodulin activates phosphorylase b directly, ensuring glycogen breakdown occurs synchronously with cross-bridge cycling even before hormonal signaling arrives.",
        say: "Anaerobic exercise activates muscle glycogenolysis. Epinephrine drives phosphorylation to activate glycogen phosphorylase. Intracellular AMP and calcium-calmodulin directly allosterically activate phosphorylase b, coupling contraction immediately to energy release.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "m1", label: "Muscle contraction & action potential" },
            { id: "m2", label: "Sarcoplasmic reticulum calcium release" },
            { id: "m3", label: "Elevated intracellular AMP from adenylate kinase" },
            { id: "m4", label: "Allosteric activation of glycogen phosphorylase" },
            { id: "m5", label: "Rapid anaerobic glycolysis yielding ATP + lactate" }
          ],
          edges: [
            ["m1", "m2"],
            ["m2", "m4"],
            ["m3", "m4"],
            ["m4", "m5"]
          ]
        }
      },
      {
        tx: "Inherited metabolic myopathies impair muscle fuel utilization. McArdle disease (Glycogen storage disease Type V) is an autosomal recessive deficiency of **muscle glycogen phosphorylase** (myophosphorylase). Patients develop painful muscle cramps and fatigue during initial strenuous exercise. With continued rest or low-intensity exercise, a characteristic **second-wind** phenomenon occurs as increased blood flow delivers circulating free fatty acids and hepatic glucose to exercising muscle.",
        say: "McArdle disease is muscle glycogen phosphorylase deficiency, causing painful exercise-induced cramps and myoglobinuria. Patients demonstrate a second-wind phenomenon as circulating fatty acids bypass the glycogen block.",
        vis: {
          kind: "table",
          cols: ["Metabolic myopathy", "Enzymatic defect", "Key diagnostic features"],
          rows: [
            ["McArdle disease (GSD V)", "Muscle glycogen phosphorylase", "Exercise cramps, second wind, flat lactate curve on forearm test"],
            ["Tarui disease (GSD VII)", "Phosphofructokinase-1 (muscle M-isoform)", "Exercise intolerance, cramps, mild hemolytic anemia"],
            ["Carnitine palmitoyltransferase II", "CPT-II mitochondrial fatty acid transport", "Prolonged exercise or fasting myoglobinuria, normal forearm lactate"],
            ["Mitochondrial myopathy (MELAS)", "Mitochondrial tRNA-Leu mutation", "Lactic acidosis, ragged-red fibers on Gomori trichrome"]
          ]
        }
      },
      {
        tx: "Severe muscle breakdown causes life-threatening **rhabdomyolysis**. Massive myocyte necrosis releases intracellular contents into circulation, elevating serum creatine kinase above 5 to 50 times normal. Released **myoglobin** filters freely through glomeruli, precipitating with Tamm-Horsfall protein within distal tubules and generating toxic free radicals via ferrous iron, causing acute tubular necrosis. Aggressive intravenous isotonic saline hydration is required to maintain high urine output and prevent renal failure.",
        say: "Rhabdomyolysis releases massive amounts of creatine kinase and myoglobin into circulation. Myoglobin causes acute tubular necrosis through cast obstruction and heme iron cytotoxicity. Treatment mandates vigorous saline resuscitation.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "r1", label: "Trauma, crush injury, or prolonged ischemia" },
            { id: "r2", label: "Sarcolemmal rupture & calcium influx" },
            { id: "r3", label: "Massive CK, K+, and myoglobin release" },
            { id: "r4", label: "Myoglobin casts obstruct renal tubules" },
            { id: "r5", label: "Pigment nephropathy & acute kidney injury" }
          ],
          edges: [
            ["r1", "r2"],
            ["r2", "r3"],
            ["r3", "r4"],
            ["r4", "r5"]
          ]
        }
      }
    ]
  },

  // Ch 38: Bone Metabolism and Calcium Homeostasis
  {
    module: "bio-calcium-bone",
    subject: "biochemistry",
    title: "Calcium homeostasis: parathyroid hormone, vitamin D activation, and metabolic bone disease",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Extracellular ionized **calcium** is regulated by parathyroid hormone (PTH), 1,25-dihydroxyvitamin D (calcitriol), and calcitonin. Calcium-sensing receptors on parathyroid chief cells detect hypocalcemia, triggering rapid PTH release. Parathyroid hormone increases renal distal tubular calcium reabsorption, promotes renal proximal tubular phosphate excretion to prevent calcium-phosphate precipitation, stimulates 1-alpha-hydroxylase to synthesize calcitriol, and stimulates osteocytic osteolysis.",
        say: "Calcium homeostasis is defended by parathyroid hormone, calcitriol, and calcitonin. Parathyroid hormone responds to hypocalcemia by reabsorbing renal calcium, wasting phosphate, activating vitamin D, and mobilizing bone calcium.",
        vis: {
          kind: "table",
          cols: ["Endocrine regulator", "Target organ actions", "Net biochemical effect"],
          rows: [
            ["Parathyroid hormone (PTH)", "Kidney: raises Ca2+, lowers PO4; Bone: resorption", "Raises serum Ca2+, lowers serum PO4"],
            ["Calcitriol (1,25-(OH)2-D3)", "Intestine: absorbs Ca2+ & PO4; Bone: mineralization", "Raises both serum Ca2+ and PO4"],
            ["Calcitonin", "Bone: inhibits osteoclasts; Kidney: wastes Ca2+", "Lowers serum Ca2+ (physiologically minor)"],
            ["FGF-23", "Kidney: downregulates 1-alpha-hydroxylase, wastes PO4", "Lowers serum PO4, suppresses calcitriol"]
          ]
        }
      },
      {
        tx: "Vitamin D activation is a multi-organ **photochemical** and enzymatic cascade. Ultraviolet B radiation converts 7-dehydrocholesterol in the epidermis into cholecalciferol (vitamin D3). Hepatic 25-hydroxylase (CYP2R1) converts vitamin D into circulating 25-hydroxyvitamin D (calcidiol), the primary storage form. In renal proximal tubules, PTH-stimulated **1-alpha-hydroxylase** (CYP27B1) adds a second hydroxyl group to form active 1,25-dihydroxyvitamin D (calcitriol), which stimulates intestinal calbindin-mediated calcium absorption.",
        say: "Vitamin D synthesis starts in skin where ultraviolet B creates cholecalciferol. Hepatic 25-hydroxylase produces storage calcidiol. In kidneys, PTH stimulates 1-alpha-hydroxylase to generate active calcitriol, driving intestinal calcium absorption.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "v1", label: "7-Dehydrocholesterol (skin UVB exposure)" },
            { id: "v2", label: "Cholecalciferol (Vitamin D3)" },
            { id: "v3", label: "Hepatic 25-hydroxylase forms 25-OH-D" },
            { id: "v4", label: "Renal 1-alpha-hydroxylase forms 1,25-(OH)2-D" },
            { id: "v5", label: "Intestinal calbindin drives Ca2+ and PO4 absorption" }
          ],
          edges: [
            ["v1", "v2"],
            ["v2", "v3"],
            ["v3", "v4"],
            ["v4", "v5"]
          ]
        }
      },
      {
        tx: "Bone remodeling requires cross-talk between osteoblasts and osteoclasts via the **RANKL-RANK** signaling axis. Osteoblasts express receptor activator of nuclear factor-kB ligand (RANKL), which binds RANK on osteoclast precursors, driving osteoclastogenesis and bone resorption. Osteoprotegerin (OPG), a soluble decoy receptor secreted by osteoblasts, binds RANKL and prevents RANK engagement. Denosumab, a human monoclonal antibody against RANKL, mimics osteoprotegerin to treat postmenopausal osteoporosis and giant cell tumor of bone.",
        say: "Bone remodeling centers on osteoblast-osteoclast communication. Osteoblast RANKL binds osteoclast RANK to stimulate bone resorption. Osteoprotegerin acts as a decoy to block RANKL. Denosumab mimics osteoprotegerin to suppress osteoclastic resorption.",
        vis: {
          kind: "table",
          cols: ["Pathway component", "Cellular source", "Biological effect on bone"],
          rows: [
            ["RANKL", "Osteoblasts, osteocytes, T-cells", "Stimulates osteoclast differentiation and bone resorption"],
            ["RANK receptor", "Osteoclast precursors and mature osteoclasts", "Mediates osteoclast survival and bone erosion"],
            ["Osteoprotegerin (OPG)", "Osteoblasts and marrow stromal cells", "Decoy receptor blocking RANKL, preserving bone mass"],
            ["Denosumab", "Monoclonal anti-RANKL antibody", "Blocks RANKL, markedly increasing bone mineral density"]
          ]
        }
      },
      {
        tx: "Disorders of bone mineralization present with distinctive biochemical patterns. **Rickets** in children and osteomalacia in adults stem from vitamin D deficiency or defective phosphate reabsorption, causing failure of osteoid matrix calcification, rachitic rosary, and craniotabes. In Paget disease of bone (osteitis deformans), dysregulated osteoclastic resorption followed by chaotic osteoblastic bone formation causes elevated serum **alkaline phosphatase** with completely normal serum calcium and phosphate.",
        say: "Rickets and osteomalacia reflect defective osteoid mineralization due to vitamin D or phosphate deficiency, exhibiting low calcium and high PTH. Paget disease shows marked alkaline phosphatase elevation with normal calcium and phosphate.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "b1", label: "Vitamin D deficiency" },
            { id: "b2", label: "Impaired intestinal calcium and phosphate uptake" },
            { id: "b3", label: "Secondary hyperparathyroidism (high PTH)" },
            { id: "b4", label: "Renal phosphate wasting & uncalcified osteoid" },
            { id: "b5", label: "Rickets (children) or Osteomalacia (adults)" }
          ],
          edges: [
            ["b1", "b2"],
            ["b2", "b3"],
            ["b3", "b4"],
            ["b4", "b5"]
          ]
        }
      }
    ]
  },

  // Ch 39: Neurochemistry and Blood-Brain Barrier
  {
    module: "bio-neurochemistry-bbb",
    subject: "biochemistry",
    title: "Neurochemistry: blood-brain barrier transport, myelin lipids, and glutamate excitotoxicity",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "The **blood-brain barrier** protects neural parenchyma from systemic fluctuations, toxins, and peripheral neurotransmitters. It is formed by non-fenestrated brain capillary endothelial cells linked by complex tight junctions (claudin-5 and occludin), supported by pericytes and astrocyte end-feet. Lipophilic molecules like oxygen, carbon dioxide, and ethanol cross freely by simple diffusion. In contrast, essential water-soluble nutrients require dedicated transport carriers: glucose crosses via facilitated diffusion through **GLUT1**, while large neutral amino acids use LAT1.",
        say: "The blood-brain barrier consists of continuous capillary endothelium sealed by tight junctions and astrocyte foot processes. Lipophilic gases diffuse freely, while glucose crosses via GLUT1 and neutral amino acids via LAT1 transporters.",
        vis: {
          kind: "table",
          cols: ["BBB component", "Molecular structure", "Physiological barrier role"],
          rows: [
            ["Tight junctions", "Claudin-5, occludin, JAMs", "Prevents paracellular solute flux"],
            ["Astrocyte end-feet", "Aquaporin-4 water channels", "Induces tight junction formation and neurovascular coupling"],
            ["GLUT1 transporter", "Facilitated hexose transporter", "Supplies 100% of cerebral glucose needs"],
            ["P-glycoprotein (MDR1)", "ATP-binding cassette efflux pump", "Actively pumps lipophilic xenobiotics back into blood"]
          ]
        }
      },
      {
        tx: "**Myelin** is an electrical insulator generated by oligodendrocytes in the central nervous system and Schwann cells in the peripheral nervous system. It possesses an exceptionally high lipid-to-protein ratio (80 percent lipid to 20 percent protein). Characteristic myelin lipids include galactosylceramide, sulfatides, and plasmalogens. In multiple sclerosis, autoimmune CD4 T-cell infiltration and autoantibodies destroy myelin basic protein and proteolipid protein, slowing saltatory conduction and causing focal neurological deficits.",
        say: "Myelin insulates axons with an eighty percent lipid composition rich in galactosylceramides and sulfatides. Synthesized by oligodendrocytes in the brain and Schwann cells peripherally, autoimmune destruction of myelin proteins causes multiple sclerosis.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "y1", label: "Autoimmune T-cell crossing of disrupted BBB" },
            { id: "y2", label: "Targeting of myelin basic protein and PLP" },
            { id: "y3", label: "Microglial and complement-mediated demyelination" },
            { id: "y4", label: "Loss of saltatory nerve conduction" },
            { id: "y5", label: "Focal neurological deficits in multiple sclerosis" }
          ],
          edges: [
            ["y1", "y2"],
            ["y2", "y3"],
            ["y3", "y4"],
            ["y4", "y5"]
          ]
        }
      },
      {
        tx: "Glutamate is the primary excitatory neurotransmitter in the brain, but excessive synaptic accumulation causes lethal **excitotoxicity**. Following release, glutamate is cleared from the synaptic cleft into astrocytes by excitatory amino acid transporters (EAAT2). Within astrocytes, glutamine synthetase converts glutamate into non-toxic glutamine, which is safely shuttled back to neurons. In acute cerebral ischemia, ATP depletion halts glial EAAT2 transport, causing massive extracellular glutamate accumulation.",
        say: "Glutamate is cleared from synapses by astrocyte EAAT2 transporters and converted to glutamine by glutamine synthetase. In stroke, ATP exhaustion reverses glutamate uptake, flooding synapses and triggering neurotoxic calcium overload.",
        vis: {
          kind: "table",
          cols: ["Glutamate receptor / transporter", "Ion selectivity", "Role in excitotoxic injury"],
          rows: [
            ["NMDA receptor", "High calcium (Ca2+) permeability", "Massive Ca2+ influx activates calpains and nNOS"],
            ["AMPA receptor", "Sodium (Na+) permeability", "Depolarizes membrane to relieve Mg2+ block on NMDA"],
            ["EAAT2 transporter", "Na+-coupled glutamate uptake into astrocytes", "Downregulated / reversed during cerebral ischemia"],
            ["Glutamine synthetase", "ATP-dependent amination of glutamate", "Inactivated by oxidative stress, elevating free glutamate"]
          ]
        }
      },
      {
        tx: "Massive synaptic glutamate over-activates **NMDA** receptors, relieving the physiological magnesium block and flooding neurons with toxic amounts of calcium. Intracellular calcium overload activates calpains, caspases, phospholipase A2, and neuronal nitric oxide synthase (nNOS), generating reactive peroxynitrite and triggering apoptosis. Neuroprotective NMDA antagonists like memantine provide symptomatic cognitive stabilization in moderate-to-severe Alzheimer disease without blocking physiological basal synaptic transmission.",
        say: "Excessive glutamate drives calcium through NMDA receptors, activating destructive proteases and nitric oxide synthase to cause neuronal necrosis. Memantine is an uncompetitive NMDA receptor antagonist used to stabilize Alzheimer disease.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "e1", label: "Ischemic ATP depletion & glutamate release" },
            { id: "e2", label: "Membrane depolarization relieves Mg2+ block" },
            { id: "e3", label: "Sustained toxic Ca2+ influx via NMDA receptors" },
            { id: "e4", label: "Activation of calpain proteases and nNOS" },
            { id: "e5", label: "Neuronal necrosis and penumbral infarct expansion" }
          ],
          edges: [
            ["e1", "e2"],
            ["e2", "e3"],
            ["e3", "e4"],
            ["e4", "e5"]
          ]
        }
      }
    ]
  },

  // Ch 40: Blood and Plasma Proteins
  {
    module: "bio-plasma-proteins",
    subject: "biochemistry",
    title: "Plasma proteins: albumin oncotic pressure, alpha-1 antitrypsin, and Wilson disease",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Serum **protein electrophoresis** separates plasma proteins into five major fractions: albumin, alpha-1, alpha-2, beta, and gamma globulins. Albumin is synthesized exclusively by hepatocytes and accounts for 55 to 60 percent of total plasma protein. It generates 80 percent of intravascular colloid oncotic pressure, preventing interstitial edema. Albumin also serves as an indispensable non-specific carrier for unconjugated bilirubin, free fatty acids, calcium, thyroid hormones, and hydrophobic drugs like warfarin.",
        say: "Protein electrophoresis separates plasma proteins into albumin and alpha, beta, and gamma globulins. Albumin generates eighty percent of plasma oncotic pressure and transports bilirubin, fatty acids, calcium, and lipophilic medications.",
        vis: {
          kind: "table",
          cols: ["Electrophoretic band", "Key constituent proteins", "Clinical diagnostic changes"],
          rows: [
            ["Albumin", "Serum albumin (3.5 - 5.0 g/dL)", "Decreased in cirrhosis, nephrotic syndrome, burns"],
            ["Alpha-1 globulins", "Alpha-1 antitrypsin, alpha-1 acid glycoprotein", "Decreased in AAT deficiency; elevated in inflammation"],
            ["Alpha-2 globulins", "Haptoglobin, alpha-2 macroglobulin, ceruloplasmin", "Massive rise in nephrotic syndrome (macroglobulin retained)"],
            ["Beta globulins", "Transferrin, beta-lipoprotein (LDL), complement C3", "Beta-gamma bridging in alcoholic cirrhosis (high IgA)"],
            ["Gamma globulins", "Immunoglobulins (IgG, IgM, IgA)", "Monoclonal M-spike in multiple myeloma"]
          ]
        }
      },
      {
        tx: "Alpha-1 **antitrypsin** (AAT) is a serine protease inhibitor (serpin) that neutralizes neutrophil elastase in pulmonary alveoli. In autosomal codominant AAT deficiency, the mutant Z allele (Glu342Lys) causes abnormal protein misfolding and polymerization within the endoplasmic reticulum of hepatocytes. Trapped polymers cannot be secreted, causing neonatal cholestasis and adult cirrhosis. In the lungs, unchecked neutrophil elastase destroys elastin fibers in alveolar septa, precipitating severe **panacinar** emphysema in young adults.",
        say: "Alpha-1 antitrypsin inhibits neutrophil elastase. The mutant Z allele causes misfolded polymers to accumulate in hepatocytes, causing cirrhosis, while absent serum antitrypsin allows neutrophil elastase to destroy lung elastin, causing panacinar emphysema.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "a1", label: "PiZZ mutation in SERPINA1 gene" },
            { id: "a2", label: "Protein misfolding in hepatocyte ER" },
            { id: "a3", label: "Periodic acid-Schiff positive diastase-resistant globules" },
            { id: "a4", label: "Hepatic cirrhosis from trapped polymers" },
            { id: "a5", label: "Unchecked neutrophil elastase causes Panacinar Emphysema" }
          ],
          edges: [
            ["a1", "a2"],
            ["a2", "a3"],
            ["a3", "a4"],
            ["a2", "a5"]
          ]
        }
      },
      {
        tx: "**Ceruloplasmin** is an alpha-2 globulin containing six copper atoms that functions as a ferroxidase, oxidizing toxic Fe2+ into Fe3+ to enable transferrin binding. In **Wilson disease** (hepatolenticular degeneration), autosomal recessive mutations in ATP7B impair copper incorporation into ceruloplasmin and block biliary copper excretion. Toxic free copper accumulates in hepatocytes, spills into blood, and deposits in the basal ganglia (choreoathetosis, parkinsonism), cornea (Kayser-Fleischer rings), and renal tubules.",
        say: "Ceruloplasmin is a copper-binding ferroxidase. Wilson disease results from ATP7B mutations preventing copper excretion and ceruloplasmin synthesis. Toxic copper deposits in liver, basal ganglia, and cornea, forming Kayser-Fleischer rings.",
        vis: {
          kind: "table",
          cols: ["Diagnostic test", "Wilson disease finding", "Pathophysiological rationale"],
          rows: [
            ["Serum ceruloplasmin", "Markedly decreased (<20 mg/dL)", "Apo-ceruloplasmin without copper is rapidly degraded"],
            ["24-Hour urinary copper", "Significantly elevated (>100 ug/day)", "Increased non-ceruloplasmin bound free copper filtering"],
            ["Slit-lamp examination", "Kayser-Fleischer rings present", "Copper deposition in corneal Descemet membrane"],
            ["Hepatic copper content", "Markedly elevated (>250 ug/g dry wt)", "Gold standard diagnostic threshold on liver biopsy"]
          ]
        }
      },
      {
        tx: "During acute systemic inflammation, cytokines (IL-6, IL-1, TNF-alpha) dramatically reshape hepatic protein synthesis. Positive **acute-phase** reactants surge: C-reactive protein activates complement, fibrinogen elevates the erythrocyte sedimentation rate (ESR), haptoglobin binds free hemoglobin to sequester iron from microbes, and ferritin stores iron. Concurrently, negative acute-phase reactants decline: albumin, transferrin, and transthyretin synthesis drops to conserve amino acids for immune protein production.",
        say: "Inflammatory cytokines IL-6 and TNF stimulate hepatic acute-phase reactants. C-reactive protein, fibrinogen, and ferritin rise sharply, while negative acute-phase proteins like albumin and transferrin decline to divert amino acids to immune defenses.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "i1", label: "Infection, tissue necrosis, or trauma" },
            { id: "i2", label: "Macrophage release of IL-6 and TNF-alpha" },
            { id: "i3", label: "Hepatic reprogramming of gene expression" },
            { id: "i4", label: "Surge in CRP, Fibrinogen (elevated ESR), Ferritin" },
            { id: "i5", label: "Decline in Albumin, Transferrin (negative reactants)" }
          ],
          edges: [
            ["i1", "i2"],
            ["i2", "i3"],
            ["i3", "i4"],
            ["i3", "i5"]
          ]
        }
      }
    ]
  },

  // Ch 41: Hemostasis and Thrombosis
  {
    module: "bio-coagulation-cascade",
    subject: "biochemistry",
    title: "Hemostasis: tissue factor pathway, contact activation, and natural anticoagulants",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Hemostasis seals vascular injury through coordinated primary and secondary cascades. Primary hemostasis forms a platelet plug: subendothelial collagen binds von Willebrand factor, which anchors platelet GPIb receptors, triggering platelet activation, ADP release, and **GPIIb/IIIa** cross-linking by fibrinogen. Secondary hemostasis stabilizes the plug through the coagulation cascade, assembling calcium-dependent serine proteases on phosphatidylserine surfaces of activated platelets to generate **thrombin**.",
        say: "Hemostasis couples platelet plug formation with the coagulation cascade. Platelets adhere via von Willebrand factor and GPIb, aggregating through GPIIb/IIIa and fibrinogen. Secondary hemostasis cleaves prothrombin into thrombin on platelet surfaces to form a fibrin clot.",
        vis: {
          kind: "table",
          cols: ["Hemostatic phase", "Key molecular factors", "Clinical manifestation when deficient"],
          rows: [
            ["Primary hemostasis", "vWF, Platelet GPIb, GPIIb/IIIa, ADP", "Mucocutaneous bleeding, petechiae, epistaxis"],
            ["Extrinsic cascade", "Tissue Factor + Factor VIIa -> Factor X", "Prolonged Prothrombin Time (PT / INR)"],
            ["Intrinsic cascade", "Factors XII, XI, IX, VIII -> Factor X", "Prolonged Activated Partial Thromboplastin Time (aPTT)"],
            ["Common pathway", "Factor Xa + Va (prothrombinase) -> Thrombin", "Hemarthroses, deep muscle hematomas (Hemophilia)"]
          ]
        }
      },
      {
        tx: "In vivo coagulation is initiated primarily by the **extrinsic** tissue factor pathway. Vascular injury exposes subendothelial tissue factor to circulating Factor VII. The Tissue Factor-VIIa complex activates Factor X directly and Factor IX of the intrinsic pathway. Factor Xa associates with cofactor Va, calcium, and phospholipids to form the **prothrombinase** complex, which cleaves prothrombin (Factor II) into thrombin (Factor IIa). Thrombin then cleaves soluble fibrinogen into insoluble fibrin monomers.",
        say: "Vascular injury exposes tissue factor to Factor VII, triggering Factor X and Factor IX activation. Factor Xa joins Factor Va to form the prothrombinase complex, converting prothrombin into thrombin, which cleaves fibrinogen into fibrin.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "e1", label: "Vascular endothelial injury exposes Tissue Factor" },
            { id: "e2", label: "TF-VIIa complex activates Factor X and Factor IX" },
            { id: "e3", label: "Factor Xa + Va + Ca2+ form Prothrombinase" },
            { id: "e4", label: "Thrombin (IIa) cleaves Fibrinogen to Fibrin" },
            { id: "e5", label: "Factor XIIIa cross-links fibrin into stable mesh" }
          ],
          edges: [
            ["e1", "e2"],
            ["e2", "e3"],
            ["e3", "e4"],
            ["e4", "e5"]
          ]
        }
      },
      {
        tx: "Excessive thrombosis is restrained by natural anticoagulant systems. **Antithrombin** III is a circulating serpin that directly neutralizes thrombin, Factor Xa, and IXa; its inhibitory rate is accelerated over 1,000-fold by endothelial heparin-like glycosaminoglycans. The **protein C** pathway is activated when excess thrombin binds endothelial thrombomodulin. The thrombin-thrombomodulin complex activates protein C, which, alongside cofactor protein S, proteolytically degrades activated cofactors Va and VIIIa.",
        say: "Natural anticoagulants prevent pathological thrombosis. Antithrombin III neutralizes thrombin and Factor Xa, boosted a thousand-fold by heparin. Thrombin binding to thrombomodulin activates Protein C, which destroys cofactors Va and VIIIa.",
        vis: {
          kind: "table",
          cols: ["Anticoagulant mechanism", "Primary target inactivated", "Hypercoagulable defect"],
          rows: [
            ["Antithrombin III", "Thrombin (IIa), Factor Xa, Factor IXa", "Antithrombin deficiency (heparin resistance)"],
            ["Activated Protein C", "Factor Va and Factor VIIIa", "Protein C deficiency (warfarin skin necrosis)"],
            ["Protein S cofactor", "Assists activated protein C cleavage", "Protein S deficiency (venous thromboembolism)"],
            ["Factor V Leiden", "Factor V with Arg506Gln mutation", "Resistant to cleavage by activated Protein C (most common VTE)"]
          ]
        }
      },
      {
        tx: "Fibrinolysis dissolves established clots once vascular integrity is restored. Endothelial tissue plasminogen activator (tPA) cleaves plasminogen into **plasmin**, a serine protease that cleaves cross-linked fibrin into fibrin degradation products, including **D-dimer**. Recombinant tPA (alteplase) is administered in acute ischemic stroke and massive pulmonary embolism. Vitamin K epoxide reductase (VKORC1), required for gamma-carboxylation of Factors II, VII, IX, X, Protein C, and Protein S, is competitively inhibited by warfarin.",
        say: "Fibrinolysis removes clots via plasmin, which cleaves cross-linked fibrin to release D-dimers. Recombinant tPA activates plasminogen for acute stroke thrombolysis. Warfarin inhibits vitamin K epoxide reductase, preventing gamma-carboxylation of clotting factors.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "f1", label: "Endothelial release of tPA" },
            { id: "f2", label: "Plasminogen cleaved to active Plasmin" },
            { id: "f3", label: "Plasmin digests cross-linked fibrin mesh" },
            { id: "f4", label: "Release of specific D-dimer fragments" },
            { id: "f5", label: "Clot resolution & lumen restoration" }
          ],
          edges: [
            ["f1", "f2"],
            ["f2", "f3"],
            ["f3", "f4"],
            ["f4", "f5"]
          ]
        }
      }
    ]
  },

  // Ch 42: Oxidative Stress and Inflammation
  {
    module: "bio-ros-antioxidants",
    subject: "biochemistry",
    title: "Reactive oxygen species: generation, antioxidant defenses, and reperfusion injury",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Reactive oxygen species (ROS) are inevitable byproducts of aerobic metabolism. In mitochondria, electron leakage at Complexes I and III transfers single electrons to molecular oxygen, generating **superoxide** radical (O2-). Superoxide is dismutated by superoxide dismutase (SOD) into hydrogen peroxide (H2O2). In the presence of free ferrous iron (Fe2+), hydrogen peroxide undergoes the **Fenton** reaction to generate the hydroxyl radical (OH.), the most reactive and damaging biological free radical known.",
        say: "Mitochondrial electron leakage generates superoxide radicals, which superoxide dismutase converts to hydrogen peroxide. Free ferrous iron drives the Fenton reaction, generating highly toxic hydroxyl radicals that attack lipids, proteins, and DNA.",
        vis: {
          kind: "table",
          cols: ["Reactive species", "Enzyme / Chemical reaction", "Biological reactivity & threat"],
          rows: [
            ["Superoxide (O2-)", "Formed by electron leak at Complex I & III", "Moderate; converted by SOD to H2O2"],
            ["Hydrogen peroxide (H2O2)", "Formed by Superoxide dismutase (SOD)", "Membrane-permeable; substrate for Fenton reaction"],
            ["Hydroxyl radical (OH.)", "Fenton reaction (Fe2+ + H2O2 -> Fe3+ + OH. + OH-)", "Extremely reactive; causes lipid peroxidation & DNA breaks"],
            ["Hypochlorous acid (HOCl)", "Myeloperoxidase (MPO) in neutrophil phagosomes", "Potent microbicidal oxidant (bleach)"]
          ]
        }
      },
      {
        tx: "Cellular **antioxidant** defenses neutralize reactive oxygen species through tiered enzymatic systems. Superoxide dismutase converts superoxide to hydrogen peroxide. Peroxisomal **catalase** decomposes hydrogen peroxide directly into water and oxygen. Glutathione peroxidase utilizes reduced glutathione (GSH) to reduce hydrogen peroxide and lipid hydroperoxides to water and lipid alcohols, generating oxidized glutathione (GSSG). Glutathione reductase then regenerates GSH using NADPH supplied by the pentose phosphate pathway.",
        say: "Antioxidant enzymes protect cells from oxidative stress. Superoxide dismutase creates hydrogen peroxide, catalase converts it to water, and glutathione peroxidase reduces peroxides using reduced glutathione, which glutathione reductase regenerates via NADPH.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "o1", label: "Superoxide radical generated by metabolism" },
            { id: "o2", label: "Superoxide dismutase yields Hydrogen Peroxide" },
            { id: "o3", label: "Glutathione peroxidase reduces H2O2 to H2O" },
            { id: "o4", label: "GSSG converted to GSH by Glutathione Reductase" },
            { id: "o5", label: "NADPH from HMP shunt (G6PD) drives reduction" }
          ],
          edges: [
            ["o1", "o2"],
            ["o2", "o3"],
            ["o3", "o4"],
            ["o4", "o5"]
          ]
        }
      },
      {
        tx: "Phagocytic cells intentionally generate massive ROS to kill engulfed pathogens via the **respiratory burst**. Membrane-bound **NADPH oxidase** transfers electrons from NADPH to oxygen, producing superoxide within the phagosome. Superoxide dismutates to hydrogen peroxide, which neutrophil myeloperoxidase combines with chloride to generate hypochlorous acid (bleach). In Chronic Granulomatous Disease, X-linked deficiency of NADPH oxidase prevents ROS generation, leading to recurrent catalase-positive bacterial and fungal infections.",
        say: "Neutrophils generate respiratory bursts via NADPH oxidase to produce superoxide and hypochlorous acid via myeloperoxidase. Defects in NADPH oxidase cause Chronic Granulomatous Disease, causing recurrent infections from catalase-positive organisms like Staphylococcus.",
        vis: {
          kind: "table",
          cols: ["Respiratory burst enzyme", "Substrates & products", "Clinical deficiency state"],
          rows: [
            ["NADPH oxidase", "NADPH + 2 O2 -> NADP+ + 2 O2-", "Chronic Granulomatous Disease (negative NBT/DHR)"],
            ["Superoxide dismutase", "2 O2- + 2 H+ -> H2O2 + O2", "Mutations in SOD1 cause familial ALS"],
            ["Myeloperoxidase (MPO)", "H2O2 + Cl- -> HOCl (hypochlorous acid)", "MPO deficiency (usually asymptomatic, Candida risk)"],
            ["G6PD", "Glucose-6-P -> 6-Phosphogluconate + NADPH", "G6PD deficiency (acute hemolytic anemia under stress)"]
          ]
        }
      },
      {
        tx: "Ischemia-reperfusion injury exemplifies destructive oxidative pathology. During tissue ischemia, cellular ATP degrades to hypoxanthine while xanthine dehydrogenase converts to **xanthine oxidase**. Upon restoration of oxygenated blood flow, xanthine oxidase metabolizes accumulated hypoxanthine, producing a massive burst of superoxide and hydrogen peroxide. Unchecked free radicals peroxidize membrane polyunsaturated fatty acids, forming malondialdehyde and triggering myocardial stunning or endothelial microvascular plugging.",
        say: "Reperfusion injury occurs when re-oxygenation allows xanthine oxidase to oxidize accumulated hypoxanthine, unleasing a burst of superoxide. Free radicals induce lipid peroxidation, damaging cell membranes and worsening ischemic injury.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "r1", label: "Ischemia: ATP depletes to Hypoxanthine" },
            { id: "r2", label: "Reperfusion restores molecular oxygen" },
            { id: "r3", label: "Xanthine oxidase unleashes Superoxide burst" },
            { id: "r4", label: "Lipid peroxidation of sarcolemmal membranes" },
            { id: "r5", label: "Myocardial stunning, arrhythmias & microvascular failure" }
          ],
          edges: [
            ["r1", "r2"],
            ["r2", "r3"],
            ["r3", "r4"],
            ["r4", "r5"]
          ]
        }
      }
    ]
  },

  // Ch 43: The Immune Response
  {
    module: "bio-immunochemistry-mhc",
    subject: "biochemistry",
    title: "Immunochemistry: V(D)J recombination, MHC antigen processing, and complement cascades",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Antibody diversity is generated during lymphocyte development by somatic **V(D)J recombination**. The recombination activating gene products RAG-1 and RAG-2 introduce double-strand DNA breaks at recombination signal sequences flanking variable, diversity, and joining gene segments. Non-homologous end joining repairs the breaks, during which terminal deoxynucleotidyl transferase (**TdT**) randomly inserts template-independent N-nucleotides, creating immense junctional diversity within complementarity-determining regions.",
        say: "Antibody diversity arises through somatic V(D)J recombination driven by RAG-1 and RAG-2. Terminal deoxynucleotidyl transferase inserts random nucleotides at junctions, creating billions of unique antigen receptor combinations.",
        vis: {
          kind: "table",
          cols: ["Diversity mechanism", "Enzyme / Molecular process", "Diversity contribution"],
          rows: [
            ["Combinatorial diversity", "RAG-1 and RAG-2 segment joining", "Random assembly of V, D, and J germline segments"],
            ["Junctional diversity", "Terminal deoxynucleotidyl transferase (TdT)", "Random N-nucleotide insertion at segment joints"],
            ["Somatic hypermutation", "Activation-induced cytidine deaminase (AID)", "Point mutations in germinal centers driving affinity maturation"],
            ["Isotype class switching", "AID-dependent switch region recombination", "Shifts IgM/IgD to IgG, IgA, or IgE constant regions"]
          ]
        }
      },
      {
        tx: "Antigen presentation is mediated by two distinct classes of major histocompatibility complex (**MHC**) proteins. MHC Class I molecules, expressed on all nucleated cells, present endogenous cytoplasmic peptides to CD8+ cytotoxic T-lymphocytes. Endogenous proteins are degraded by the proteasome and transported into the endoplasmic reticulum via **TAP** (transporter associated with antigen processing). MHC Class II molecules, restricted to professional antigen-presenting cells, present exogenous endocytosed antigens to CD4+ helper T-cells.",
        say: "MHC Class I displays endogenous cytosolic antigens processed by proteasomes and loaded via TAP to CD8 cytotoxic T-cells. MHC Class II on dendritic cells and macrophages presents endocytosed exogenous peptides to CD4 helper T-cells.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "m1", label: "Cytosolic viral protein synthesized" },
            { id: "m2", label: "26S Proteasome cleaves into 8-10 aa peptides" },
            { id: "m3", label: "TAP transporter pumps peptides into ER" },
            { id: "m4", label: "Peptide loaded onto MHC Class I with Beta-2M" },
            { id: "m5", label: "Surface display & recognition by CD8+ T-cells" }
          ],
          edges: [
            ["m1", "m2"],
            ["m2", "m3"],
            ["m3", "m4"],
            ["m4", "m5"]
          ]
        }
      },
      {
        tx: "The **complement** system comprises three converging cascades: classical, lectin, and alternative pathways. The classical pathway is triggered when C1q binds antigen-antibody complexes (IgM or IgG). The lectin pathway activates via mannose-binding lectin binding microbial carbohydrates. The alternative pathway spontaneously hydrolyzes C3 (tick-over). All pathways converge to generate **C3 convertase**, which cleaves C3 into anaphylatoxin C3a and opsonin C3b. C3b initiates C5 convertase to assemble the membrane attack complex (C5b-9).",
        say: "Complement activates through classical, lectin, and alternative pathways. All pathways converge on C3 convertase to generate opsonin C3b and anaphylatoxin C3a. C5 convertase then launches the membrane attack complex C5b-9 to lyse targets.",
        vis: {
          kind: "table",
          cols: ["Complement pathway", "Initiating stimulus", "C3 Convertase composition"],
          rows: [
            ["Classical pathway", "IgM or IgG bound to antigen (C1qrs)", "C4b2a (cleaves C3 to C3a + C3b)"],
            ["Lectin pathway", "Mannose-binding lectin bound to pathogen mannose", "C4b2a (identical to classical convertase)"],
            ["Alternative pathway", "Spontaneous C3 tick-over on microbial surface", "C3bBb (stabilized by properdin)"],
            ["Terminal pathway", "C5 convertase cleaves C5 into C5a + C5b", "C5b-6-7-8-9 Membrane Attack Complex (MAC)"]
          ]
        }
      },
      {
        tx: "Regulatory complement proteins prevent host bystander lysis. Decay-accelerating factor (CD55) and CD59 (protectin) are anchored to host erythrocyte membranes via **GPI** anchors. CD55 accelerates convertase decay, while CD59 blocks membrane attack complex assembly. In paroxysmal nocturnal hemoglobinuria, acquired PIGA mutations prevent GPI anchor synthesis, leaving red cells vulnerable to complement-mediated intravascular hemolysis, thrombosis, and dark morning hemoglobinuria.",
        say: "Host cells express GPI-anchored CD55 and CD59 to inhibit complement attack. Acquired PIGA mutations cause paroxysmal nocturnal hemoglobinuria, lacking CD55 and CD59, causing episodic complement-mediated hemolytic anemia and thrombosis.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "p1", label: "Acquired somatic PIGA mutation in HSC" },
            { id: "p2", label: "Absence of GPI anchor biosynthesis" },
            { id: "p3", label: "Erythrocytes lack CD55 (DAF) and CD59 (Protectin)" },
            { id: "p4", label: "Nocturnal alternative complement activation" },
            { id: "p5", label: "Intravascular hemolysis, hemoglobinuria & thrombosis" }
          ],
          edges: [
            ["p1", "p2"],
            ["p2", "p3"],
            ["p3", "p4"],
            ["p4", "p5"]
          ]
        }
      }
    ]
  }
];
