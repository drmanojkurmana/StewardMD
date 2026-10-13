/**
 * Wave 3B Knowledge Library Reference Articles (KB v2)
 * 23 Paired Reference Articles for Medical Biochemistry Chapters 21 to 43
 */

export const wave3bKbArticles = [
  // Ch 21
  {
    id: "rna_processing_and_splicing_defects",
    name: "RNA Transcription, Post-Transcriptional Processing, and Spliceosome Defects",
    aliases: ["RNA polymerase", "Alternative splicing", "Spliceosome mutations", "Alpha-amanitin poisoning", "Beta-thalassemia splicing"],
    system: "Molecular Genetics / Cellular Biochemistry",
    specialty: "Biochemistry / Genetics / Hematology",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "RNA polymerase II is selectively and lethally inhibited by alpha-amanitin from Amanita phalloides",
      "Eukaryotic pre-mRNA processing requires 5'-capping (7-methylguanosine), 3'-polyadenylation, and intron splicing",
      "Spliceosome assembly utilizes U1-U6 snRNPs recognizing consensus GU (5'-donor) and AG (3'-acceptor) splice junctions",
      "Anti-Smith (Sm) antibodies in systemic lupus erythematosus specifically target snRNP core proteins",
      "Antisense oligonucleotides (nusinersen) modulate splicing to promote exon inclusion in spinal muscular atrophy"
    ],
    patho: "Eukaryotic transcription requires assembly of pre-initiation complexes at core promoter elements. Following synthesis by RNA polymerase II, nascent transcripts undergo capping, polyadenylation, and spliceosomal removal of non-coding introns. Point mutations within donor or acceptor splice sites disrupt normal exon joining, generating aberrant frame-shifted proteins or premature stop codons as observed in beta-thalassemia.",
    investigations: [
      "RT-PCR and cDNA sequencing for aberrant splice junction transcript identification",
      "Anti-Smith (Sm) and anti-U1-RNP antibody titers via ELISA or immunoblotting",
      "Targeted gene sequencing for splice-site donor (GU) and acceptor (AG) mutations",
      "Northern blot or RNA-seq for quantitative transcript isoform profiling"
    ],
    differentials: [
      "Beta-thalassemia major / intermedia (splice junction mutations)",
      "Systemic lupus erythematosus (autoantibodies to spliceosomal snRNPs)",
      "Spinal muscular atrophy (SMN2 alternative splicing defect)",
      "Alpha-amanitin mushroom hepatotoxicity"
    ]
  },

  // Ch 22
  {
    id: "translation_ribosomes_and_proteasome",
    name: "Ribosomal Translation, Genetic Code Fidelity, and Ubiquitin-Proteasome Degradation",
    aliases: ["Protein synthesis", "Aminoacyl-tRNA synthetase", "Ubiquitin proteasome", "Diphtheria toxin", "Bortezomib"],
    system: "Molecular Pathology / Cellular Biochemistry",
    specialty: "Biochemistry / Hematology / Pharmacology",
    source: "Medical Biochemistry 5th ed / Lehninger Principles of Biochemistry 8th ed",
    pearls: [
      "Aminoacyl-tRNA synthetases ensure genetic code fidelity through hydrolytic proofreading of misactivated amino acids",
      "Peptidyl transferase is an intrinsic 28S rRNA ribozyme within the 60S large ribosomal subunit",
      "Diphtheria toxin and Pseudomonas exotoxin A inactivate eukaryotic EF-2 via ADP-ribosylation",
      "Targeted proteolysis requires covalent polyubiquitination (E1-E2-E3 cascade) directing substrates to the 26S proteasome",
      "Bortezomib is a selective 26S proteasome inhibitor that induces apoptotic death in multiple myeloma plasma cells"
    ],
    patho: "Translation decodes mRNA into polypeptides on 80S cytoplasmic ribosomes through initiation, elongation, and termination cycles. Diphtheria toxin ADP-ribosylates a unique diphthamide residue on eEF2, arresting translocation. Proteostasis requires continuous ubiquitin-mediated destruction of damaged or regulatory proteins; proteasome blockade leads to toxic intracellular misfolded protein aggregation and apoptosis.",
    investigations: [
      "Serum protein electrophoresis (SPEP) and immunofixation for monoclonal paraproteins",
      "Bone marrow aspirate and biopsy for clonal plasma cell infiltration (>10%)",
      "Serum free light chain ratio (kappa/lambda)",
      "Elek immunodiffusion test or PCR for toxigenic Corynebacterium diphtheriae"
    ],
    differentials: [
      "Multiple myeloma and plasma cell dyscrasias",
      "Respiratory diphtheria (membranous pharyngitis with systemic toxin toxicity)",
      "Pseudomonas aeruginosa severe sepsis (exotoxin A mediated)",
      "Endoplasmic reticulum stress-induced apoptotic myopathies"
    ]
  },

  // Ch 23
  {
    id: "epigenetics_and_chromatin_regulation",
    name: "Epigenetic Regulation, Chromatin Remodeling, and Genomic Imprinting",
    aliases: ["DNA methylation", "Histone acetylation", "Genomic imprinting", "Prader-Willi syndrome", "Angelman syndrome", "Rett syndrome"],
    system: "Genetics / Molecular Biology",
    specialty: "Biochemistry / Medical Genetics / Pediatric Neurology",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Histone acetylation by HATs relaxes chromatin (euchromatin), promoting transcription; HDACs reverse this mark",
      "DNA methylation at promoter CpG islands by DNMTs silences transcription by recruiting MeCP2 and corepressors",
      "Rett syndrome is an X-linked dominant disorder caused by de novo loss-of-function mutations in MeCP2",
      "Prader-Willi syndrome results from loss of paternal 15q11-q13 expression, causing neonatal hypotonia and hyperphagia",
      "Angelman syndrome results from loss of maternal 15q11-q13 (UBE3A) expression, manifesting with ataxia and paroxysmal laughter"
    ],
    patho: "Epigenetic modifications regulate transcriptional competence without altering genomic DNA nucleotide sequence. Methylation of promoter CpG islands stabilizes gene silencing. Failure of methyl-CpG-binding protein MeCP2 disrupts neuronal synaptic maturation in Rett syndrome. Imprinting defects or uniparental disomy at 15q11-q13 abolish essential monoallelic gene expression, causing parent-of-origin neurodevelopmental syndromes.",
    investigations: [
      "Methylation-specific PCR and MS-MLPA for 15q11-q13 imprinting analysis",
      "Chromosomal microarray for 15q11-q13 microdeletions or uniparental disomy",
      "Sanger or NGS sequencing of the MECP2 gene for Rett syndrome",
      "Bisulfite sequencing for promoter CpG island hypermethylation"
    ],
    differentials: [
      "Prader-Willi syndrome vs Angelman syndrome",
      "Rett syndrome vs typical autism spectrum disorder",
      "Beckwith-Wiedemann syndrome (11p15 imprinting defect)",
      "Myelodysplastic syndromes (responsive to hypomethylating azacitidine)"
    ]
  },

  // Ch 24
  {
    id: "clinical_genomics_and_metabolomics",
    name: "Clinical Genomics, Proteomics, Tandem Mass Spectrometry, and Pharmacogenomics",
    aliases: ["Next-generation sequencing", "Tandem mass spectrometry", "Pharmacogenomics", "TPMT deficiency", "HLA-B*57:01"],
    system: "Laboratory Medicine / Genetics",
    specialty: "Biochemistry / Clinical Pharmacology / Pathology",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Liquid chromatography-tandem mass spectrometry (LC-MS/MS) enables multiplexed newborn screening from dried blood spots",
      "MALDI-TOF mass spectrometry rapidly identifies bacterial and fungal species directly from blood culture aliquots",
      "TPMT and NUDT15 deficiency prevent 6-mercaptopurine inactivation, triggering lethal myelosuppression unless dose-reduced",
      "Pre-treatment HLA-B*57:01 screening is mandatory to prevent fatal multi-organ abacavir hypersensitivity reactions",
      "CYP2D6 poor metabolizers fail to activate codeine into morphine, while ultrarapid metabolizers risk fatal respiratory depression"
    ],
    patho: "High-throughput genomics and mass spectrometry decipher human molecular diversity. Pharmacogenomic single nucleotide polymorphisms alter xenobiotic clearance kinetics or HLA immune presentation. Homozygous deficiency of TPMT impairs thiopurine methylation, forcing toxic thioguanine nucleotide accumulation in bone marrow stem cells. Genetic screening allows individualized therapy and prevents severe adverse reactions.",
    investigations: [
      "Tandem mass spectrometry acylcarnitine and amino acid newborn screen profile",
      "Pre-treatment TPMT and NUDT15 genotype or red cell enzyme activity",
      "HLA-B*57:01 allele screening prior to abacavir initiation",
      "CYP2D6 and CYP2C19 genotype panels for personalized analgesia and antiplatelet selection"
    ],
    differentials: [
      "Thiopurine-induced severe myelosuppression (TPMT deficiency)",
      "Abacavir hypersensitivity syndrome (HLA-B*57:01 mediated)",
      "Codeine opioid toxicity in CYP2D6 ultrarapid metabolizers",
      "Stevens-Johnson syndrome in HLA-B*15:02 carriers receiving carbamazepine"
    ]
  },

  // Ch 25
  {
    id: "gpcr_and_tyrosine_kinase_signaling",
    name: "Transmembrane Signal Transduction: GPCRs, Second Messengers, and Receptor Tyrosine Kinases",
    aliases: ["G-protein coupled receptors", "Receptor tyrosine kinase", "Cyclic AMP", "Protein kinase A", "McCune-Albright syndrome"],
    system: "Endocrine / Cellular Signaling",
    specialty: "Biochemistry / Endocrinology / Oncology",
    source: "Medical Biochemistry 5th ed / Lehninger Principles of Biochemistry 8th ed",
    pearls: [
      "G-alpha-s stimulates adenylyl cyclase to elevate cAMP and activate Protein Kinase A; G-alpha-i inhibits this pathway",
      "G-alpha-q activates phospholipase C-beta, hydrolyzing PIP2 into IP3 (releasing ER Ca2+) and DAG (activating PKC)",
      "Receptor tyrosine kinases dimerize and autophosphorylate, recruiting Grb2-SOS to activate the Ras-Raf-MEK-ERK cascade",
      "Inactivating GNAS mutations cause pseudohypoparathyroidism 1A with Albright hereditary osteodystrophy",
      "Post-zygotic activating GNAS mutations cause McCune-Albright syndrome (fibrous dysplasia, cafe-au-lait, precocious puberty)"
    ],
    patho: "Extracellular hormones and growth factors engage cell surface receptors to transduce intracellular cascades. Heterotrimeric G-proteins cycle between GDP-bound inactive and GTP-bound active states. Inactivating GNAS mutations impair G-alpha-s coupling, conferring end-organ resistance to PTH and TSH. Somatic activating GNAS mutations produce constitutive adenylyl cyclase activation, driving autonomous endocrine hypersecretion and skeletal fibrous dysplasia.",
    investigations: [
      "Serum calcium, phosphate, and intact PTH levels (elevated PTH with hypocalcemia in PHP)",
      "Urinary cyclic AMP excretion in response to exogenous PTH infusion (Ellsworth-Howard test)",
      "Skeletal survey and bone scan for polyostotic fibrous dysplasia",
      "Targeted GNAS gene mutation analysis from peripheral blood or affected tissue"
    ],
    differentials: [
      "Pseudohypoparathyroidism type 1A (Albright hereditary osteodystrophy)",
      "Pseudopseudohypoparathyroidism (paternal GNAS mutation, normal biochemistry)",
      "McCune-Albright syndrome (mosaic somatic GNAS activation)",
      "Primary hyperparathyroidism vs secondary hyperparathyroidism"
    ]
  },

  // Ch 26
  {
    id: "catecholamine_metabolism_and_phaeochromocytoma",
    name: "Catecholamine Biosynthesis, Catabolism, and Phaeochromocytoma Diagnostics",
    aliases: ["Tyrosine hydroxylase", "Metanephrines", "Vanillylmandelic acid", "Phaeochromocytoma", "Carcinoid syndrome"],
    system: "Neurochemistry / Endocrine",
    specialty: "Biochemistry / Endocrinology / Surgical Oncology",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Tyrosine hydroxylase is the rate-limiting step in catecholamine synthesis, requiring tetrahydrobiopterin (BH4)",
      "Dopamine beta-hydroxylase requires ascorbic acid (vitamin C); PNMT requires SAM and is induced by cortisol",
      "Catecholamines are degraded by MAO and COMT into metanephrines and vanillylmandelic acid (VMA)",
      "Plasma free metanephrines and 24-hour urine metanephrines provide >97% sensitivity for phaeochromocytoma",
      "Preoperative management of phaeochromocytoma strictly mandates alpha-blockade (phenoxybenzamine) prior to beta-blockade"
    ],
    patho: "Catecholamines are synthesized in chromaffin tissue and central neurons. Phaeochromocytomas hypersecrete norepinephrine and epinephrine autonomously, precipitating paroxysmal alpha-1 mediated arterial vasoconstriction and beta-1 mediated tachycardia. Breakdown by COMT within the tumor produces metanephrines, which enter the circulation. Carcinoid tumors overproduce serotonin from tryptophan, yielding elevated urinary 5-HIAA and endocardial fibrosis.",
    investigations: [
      "Fractionated plasma free metanephrines and normetanephrines (fasting, supine draw)",
      "24-Hour urinary fractionated metanephrines, VMA, and creatinine",
      "24-Hour urinary 5-hydroxyindoleacetic acid (5-HIAA) for carcinoid tumors",
      "Adrenal contrast CT / MRI, followed by 123I-MIBG or 68Ga-DOTATATE PET scan"
    ],
    differentials: [
      "Phaeochromocytoma and functional paraganglioma",
      "Essential or renovascular malignant hypertension",
      "Panic disorder and autonomic hyperreflexia",
      "Carcinoid syndrome (flushing, diarrhea, bronchospasm)"
    ]
  },

  // Ch 27
  {
    id: "hormone_receptors_and_signaling_defects",
    name: "Steroidogenesis Pathways, Congenital Adrenal Hyperplasia, and MEN Syndromes",
    aliases: ["21-hydroxylase deficiency", "Congenital adrenal hyperplasia", "Steroidogenesis", "MEN1", "MEN2"],
    system: "Endocrine / Biochemical Genetics",
    specialty: "Biochemistry / Pediatric Endocrinology / Medical Genetics",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "21-Hydroxylase deficiency accounts for >90% of CAH, causing cortisol/aldosterone deficiency and androgen excess",
      "Severe 21-hydroxylase deficiency presents in neonates with salt-wasting shock, hyperkalemia, and ambiguous genitalia in females",
      "11-Beta-hydroxylase deficiency causes virilization with hypertension due to 11-deoxycorticosterone mineralocorticoid excess",
      "MEN1 (menin mutation) features pituitary adenomas, parathyroid hyperplasia, and pancreatic neuroendocrine tumors",
      "MEN2 (RET proto-oncogene) features medullary thyroid carcinoma and phaeochromocytoma, requiring early thyroidectomy"
    ],
    patho: "Adrenal steroidogenesis converts cholesterol into mineralocorticoids, glucocorticoids, and sex steroids. Inactivating mutations in 21-hydroxylase abolish cortisol synthesis; absent negative feedback drives excessive pituitary ACTH secretion, hyperplastic adrenal cortical enlargement, and shunting of steroid precursors into androgen pathways. In MEN2, germline gain-of-function RET mutations induce constitutive receptor tyrosine kinase firing in neural crest-derived endocrine tissues.",
    investigations: [
      "Serum 17-hydroxyprogesterone (17-OHP) baseline and post-ACTH stimulation test",
      "Serum electrolytes: sodium, potassium, and plasma renin activity (salt-wasting state)",
      "Genetic analysis of CYP21A2 gene for deletions and point mutations",
      "RET proto-oncogene germline mutation testing and serum calcitonin for MEN2"
    ],
    differentials: [
      "Classical salt-wasting 21-hydroxylase deficiency CAH",
      "11-Beta-hydroxylase deficiency vs 17-alpha-hydroxylase deficiency",
      "Multiple endocrine neoplasia Type 1 vs Type 2A/2B",
      "Primary adrenal insufficiency (Addison disease)"
    ]
  },

  // Ch 28
  {
    id: "apoptosis_pathways_and_caspases",
    name: "Apoptosis Mechanisms, Caspase Cascades, and Cell Cycle Checkpoints",
    aliases: ["Programmed cell death", "Intrinsic apoptotic pathway", "Bcl-2 family", "Caspase-3", "p53 tumor suppressor"],
    system: "Cellular Biology / Oncology",
    specialty: "Biochemistry / Pathology / Oncology",
    source: "Medical Biochemistry 5th ed / Lehninger Principles of Biochemistry 8th ed",
    pearls: [
      "Apoptosis is executed by initiator (caspase-8, -9) and executioner (caspase-3, -6, -7) cysteine proteases",
      "Intrinsic apoptosis involves Bax/Bak pore formation, outer mitochondrial membrane permeabilization, and cytochrome c release",
      "Cytochrome c binds Apaf-1 in the presence of dATP to form the wheel-shaped apoptosome, activating procaspase-9",
      "Extrinsic apoptosis is initiated by FasL/TNF binding death receptors, assembling the DISC to activate caspase-8",
      "The p53 tumor suppressor arrests cells at the G1/S checkpoint by transactivating p21 (CDKN1A), which inhibits CDK4/6"
    ],
    patho: "Programmed cell death balances cellular proliferation to maintain tissue architecture. DNA double-strand breaks activate ATM/ATR kinases that stabilize p53, upregulating pro-apoptotic Puma, Noxa, and Bax. Bax and Bak oligomerize within the outer mitochondrial membrane, releasing cytochrome c into the cytosol. Cytosolic cytochrome c recruits Apaf-1 to assemble the apoptosome, activating caspase-9 and executioner caspase-3 to cleave cellular substrates without inflammatory necrosis.",
    investigations: [
      "Immunohistochemistry for cleaved (active) Caspase-3 in tissue biopsy specimens",
      "TUNEL assay (terminal deoxynucleotidyl transferase dUTP nick end labeling) for DNA fragmentation",
      "Flow cytometric Annexin V / Propidium Iodide dual staining for early apoptotic cells",
      "TP53 gene sequencing in malignant and premalignant lesions"
    ],
    differentials: [
      "Apoptosis vs secondary necrosis / necroptosis",
      "Follicular lymphoma (t(14;18) BCL2 overexpression evading apoptosis)",
      "Li-Fraumeni syndrome (germline TP53 loss predisposing to diverse malignancies)",
      "Pyroptosis (caspase-1 mediated inflammatory cell death)"
    ]
  },

  // Ch 29
  {
    id: "telomere_biology_and_cellular_senescence",
    name: "Telomere Dynamics, Telomerase Regulation, and Cellular Senescence",
    aliases: ["Telomere shortening", "Shelterin complex", "Human telomerase reverse transcriptase", "SASP", "Dyskeratosis congenita"],
    system: "Molecular Genetics / Gerontology",
    specialty: "Biochemistry / Medical Genetics / Hematology",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Telomeres comprise tandem TTAGGG repeats capped by the six-protein shelterin complex to prevent DNA damage signaling",
      "The end-replication problem causes somatic telomere erosion, enforcing the Hayflick limit and replicative senescence",
      "Telomerase (hTERT + hTERC RNA template) is repressed in somatic tissues but reactivated in >85-90% of human cancers",
      "Senescent cells exhibit the SASP (senescence-associated secretory phenotype), secreting IL-6, IL-8, and matrix proteases",
      "Dyskeratosis congenita is an inherited telomeropathy causing oral leukoplakia, nail dystrophy, and fatal aplastic anemia"
    ],
    patho: "Inability of DNA polymerases to replicate the extreme 5'-terminus of the lagging strand leads to progressive telomere attrition with each cell division. Once telomeres reach a critical threshold, uncapped chromosome ends trigger persistent p53-dependent DNA damage responses, driving cells into irreversible senescence or apoptosis. Reactivation of telomerase reverse transcriptase (TERT) bypasses this barrier, conferring infinite replicative potential in malignant neoplasms.",
    investigations: [
      "Flow-FISH (fluorescence in situ hybridization) for leukocyte telomere length measurement",
      "TRAP assay (telomeric repeat amplification protocol) for telomerase enzymatic activity",
      "Targeted gene panel sequencing for telomeropathy genes (DKC1, TERC, TERT, TINF2)",
      "Senescence-associated beta-galactosidase (SA-beta-gal) staining on tissue sections"
    ],
    differentials: [
      "Dyskeratosis congenita (classical inherited telomeropathy)",
      "Idiopathic pulmonary fibrosis and familial bone marrow failure syndromes",
      "Werner syndrome (adult progeria due to WRN RecQ DNA helicase defect)",
      "Hutchinson-Gilford progeria syndrome (LMNA lamin A mutation / progerin)"
    ]
  },

  // Ch 30
  {
    id: "nutrient_digestion_and_malabsorption",
    name: "Luminal Digestion, Brush-Border Hydrolases, Enterocyte Transport, and Malabsorption",
    aliases: ["Carbohydrate absorption", "SGLT1", "Celiac disease", "Abetalipoproteinemia", "Lactase deficiency"],
    system: "Gastroenterology / Nutrition",
    specialty: "Biochemistry / Gastroenterology / Pediatrics",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Glucose and galactose are actively absorbed via apical SGLT1 driven by the Na+/K+-ATPase gradient; exit is via GLUT2",
      "Fructose is absorbed independently via facilitated diffusion mediated by apical GLUT5 transporters",
      "Lipid absorption requires mixed bile salt micelles delivering 2-MAG and FFAs for re-esterification into chylomicrons",
      "Celiac disease is triggered by dietary gluten, causing anti-tTG IgA elevation, duodenal villous atrophy, and malabsorption",
      "Abetalipoproteinemia is an MTTP deficiency preventing Apo B-48/B-100 assembly, causing fat-stuffed enterocytes and acanthocytes"
    ],
    patho: "Dietary macromolecules require luminal enzymatic cleavage followed by enterocyte microvillar hydrolysis and carrier transport. In celiac disease, deamidated gliadin peptides provoke an HLA-DQ2/DQ8 restricted T-cell response, causing enterocyte apoptosis, villous blunting, and secondary disaccharidase and nutrient loss. In abetalipoproteinemia, failure of microsomal triglyceride transfer protein halts chylomicron and VLDL export, trapping neutral lipids within enterocytes.",
    investigations: [
      "Serum anti-tissue transglutaminase (anti-tTG) IgA antibody and total serum IgA level",
      "Upper endoscopy with multiple oriented duodenal bulb and distal duodenal biopsies",
      "Fecal fat quantification (72-hour collection) and fecal elastase-1 (exocrine pancreas)",
      "Peripheral blood smear examination for acanthocytes (spurred red cells) and lipid panel"
    ],
    differentials: [
      "Celiac disease (gluten-sensitive enteropathy)",
      "Primary lactase deficiency (adult-type hypolactasia)",
      "Abetalipoproteinemia (congenital MTTP deficiency)",
      "Exocrine pancreatic insufficiency (chronic pancreatitis, cystic fibrosis)"
    ]
  },

  // Ch 31
  {
    id: "fuel_metabolism_feed_fast_cycle_and_dka",
    name: "Fuel Metabolism: The Feed-Fast Cycle, Hepatic Ketogenesis, and Diabetic Ketoacidosis",
    aliases: ["Insulin-glucagon ratio", "Ketone body synthesis", "Diabetic ketoacidosis", "Starvation biochemistry", "Beta-hydroxybutyrate"],
    system: "Metabolic / Endocrine",
    specialty: "Biochemistry / Endocrinology / Critical Care Medicine",
    source: "Medical Biochemistry 5th ed / Lehninger Principles of Biochemistry 8th ed",
    pearls: [
      "In the well-fed state, high insulin drives glycogenesis, lipogenesis, and GLUT4-mediated glucose entry into muscle and fat",
      "Fasting hepatic glycogen depletes within 24 hours, after which gluconeogenesis sustains blood glucose from alanine, lactate, and glycerol",
      "In starvation, oxaloacetate is consumed for gluconeogenesis, diverting excess beta-oxidation acetyl-CoA into ketogenesis",
      "Ketone bodies (acetoacetate, beta-hydroxybutyrate) supply up to two-thirds of cerebral energy requirements in prolonged starvation",
      "Diabetic ketoacidosis features severe insulin lack, high counter-regulatory hormones, high anion gap acidosis, and osmotic diuresis"
    ],
    patho: "The feed-fast transition is orchestrated by the insulin-to-glucagon ratio. When insulin is absent or low, adipose hormone-sensitive lipase hydrolyzes triglycerides, releasing free fatty acids. Hepatic beta-oxidation saturates the TCA cycle; depleted oxaloacetate forces excess acetyl-CoA into HMG-CoA synthase-mediated synthesis of acetoacetate and beta-hydroxybutyrate. In DKA, uncontrolled acid accumulation exhausts plasma bicarbonate buffers, generating severe high anion gap ketoacidosis.",
    investigations: [
      "Serum beta-hydroxybutyrate quantitative assay (superior to urine dipstick for acetoacetate)",
      "Arterial or venous blood gas (pH < 7.30, HCO3 < 18 mEq/L in DKA)",
      "Serum electrolytes, calculated anion gap, and plasma glucose",
      "Serum and urine osmolality, and hourly bedside glucose monitoring"
    ],
    differentials: [
      "Diabetic ketoacidosis (DKA) vs Hyperosmolar hyperglycemic state (HHS)",
      "Alcoholic ketoacidosis (depleted glycogen + elevated NADH/NAD+ ratio)",
      "Starvation ketosis (mild acidosis, normal or low glucose)",
      "Lactic acidosis (hypoperfusion, metformin toxicity)"
    ]
  },

  // Ch 32
  {
    id: "energy_balance_and_protein_energy_malnutrition",
    name: "Nutritional Bioenergetics: Energy Expenditure, Nitrogen Balance, and Malnutrition Syndromes",
    aliases: ["Basal metabolic rate", "Respiratory quotient", "Kwashiorkor", "Marasmus", "Refeeding syndrome"],
    system: "Clinical Nutrition / Metabolism",
    specialty: "Biochemistry / Pediatrics / Critical Care Medicine",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Basal metabolic rate accounts for 60-75% of daily energy expenditure; respiratory quotient reflects fuel (CHO=1.0, fat=0.7)",
      "Negative nitrogen balance occurs when urinary nitrogen excretion exceeds intake, reflecting severe catabolism in trauma and burns",
      "Kwashiorkor results from selective protein deficiency with adequate calories, presenting with edema, fatty liver, and dermatitis",
      "Marasmus stems from global caloric starvation, causing severe muscle and fat wasting with an alert, elderly facies and no edema",
      "Refeeding syndrome occurs upon reintroducing carbohydrates in starvation, triggering insulin surges and fatal hypophosphatemia"
    ],
    patho: "Energy balance requires matching caloric and protein intake to basal demands and physical activity. In kwashiorkor, protein deficiency impairs hepatic apolipoprotein B-100 synthesis, blocking VLDL secretion and creating severe hepatic steatosis; concurrently, hypoalbuminemia collapses capillary oncotic pressure, producing ascites and anasarca. In starved patients, rapid carbohydrate feeding provokes insulin release, which drives phosphate, potassium, and magnesium into cells, precipitating cardiac arrest.",
    investigations: [
      "Serum albumin, prealbumin (transthyretin), and transferrin levels",
      "24-Hour urinary urea nitrogen for nitrogen balance calculation",
      "Baseline and serial serum phosphate, potassium, and magnesium during nutritional support",
      "Liver function tests and abdominal ultrasound for hepatic steatosis in kwashiorkor"
    ],
    differentials: [
      "Kwashiorkor vs Marasmus vs Marasmic Kwashiorkor",
      "Refeeding syndrome (acute hypophosphatemia, cardiac arrhythmias)",
      "Nephrotic syndrome (proteinuria-induced hypoalbuminemic edema)",
      "Cachexia of malignancy or chronic heart failure"
    ]
  },

  // Ch 33
  {
    id: "lipoprotein_metabolism_and_hyperlipidemias",
    name: "Lipoprotein Pathways, Apolipoproteins, Reverse Cholesterol Transport, and Dyslipidemias",
    aliases: ["Apolipoprotein B", "Lipoprotein lipase", "Familial hypercholesterolemia", "HDL cholesterol", "PCSK9"],
    system: "Cardiovascular / Lipid Biochemistry",
    specialty: "Biochemistry / Cardiology / Endocrinology",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Lipoprotein lipase requires Apo C-II as a cofactor to hydrolyze core triacylglycerols in chylomicrons and VLDL",
      "LDL contains solely Apo B-100, which binds LDL receptors on hepatocytes and peripheral tissues for endocytosis",
      "HDL mediates reverse cholesterol transport via Apo A-I, which activates LCAT to esterify free cholesterol into core esters",
      "Familial hypercholesterolemia (Type IIa) is an autosomal dominant LDL receptor mutation causing tendon xanthomas and early MI",
      "Type I dyslipidemia (familial chylomicronemia) is a deficiency of LPL or Apo C-II causing eruptive xanthomas and acute pancreatitis"
    ],
    patho: "Lipoproteins maintain lipid transport through receptor-mediated and enzymatic clearance circuits. Heterozygous or homozygous mutations in the LDL receptor gene abolish endocytosis of Apo B-100 particles, producing marked elevations in circulating LDL. Oxidized LDL penetrates subendothelial spaces, engulfed by macrophage scavenger receptors to form foam cells and atherosclerotic plaques. PCSK9 binds LDL receptors on the cell surface, directing them toward lysosomal destruction.",
    investigations: [
      "Fasting lipid panel: Total cholesterol, LDL-C, HDL-C, and Triglycerides",
      "Apolipoprotein B and Lipoprotein(a) quantitative measurement",
      "Genetic panel for LDLR, APOB, and PCSK9 familial hypercholesterolemia mutations",
      "Coronary artery calcium (CAC) scoring and carotid intima-media thickness"
    ],
    differentials: [
      "Familial hypercholesterolemia (Type IIa) vs Combined hyperlipidemia (Type IIb)",
      "Familial dysbetalipoproteinemia (Type III, Apo E2/E2, palmar xanthomas)",
      "Familial chylomicronemia syndrome (Type I, LPL or Apo C-II deficiency)",
      "Secondary hyperlipidemias (hypothyroidism, nephrotic syndrome, cholestasis)"
    ]
  },

  // Ch 34
  {
    id: "porphyrias_and_bilirubin_metabolism",
    name: "Heme Synthesis, Porphyrias, Bilirubin Conjugation, and Phase I/II Detoxification",
    aliases: ["ALA synthase", "Acute intermittent porphyria", "Gilbert syndrome", "Crigler-Najjar syndrome", "Acetaminophen toxicity"],
    system: "Hepatology / Hematology",
    specialty: "Biochemistry / Gastroenterology / Hematology",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "ALA synthase-1 is the rate-limiting enzyme of hepatic heme synthesis, requiring vitamin B6 and feedback-inhibited by heme",
      "Acute intermittent porphyria results from porphobilinogen deaminase deficiency, causing neurovisceral attacks without photosensitivity",
      "Porphyria cutanea tarda results from uroporphyrinogen decarboxylase deficiency, presenting with cutaneous blistering photosensitivity",
      "Gilbert syndrome is a benign promoter mutation in UGT1A1 causing mild unconjugated hyperbilirubinemia during fasting or stress",
      "In acetaminophen toxicity, CYP2E1 generates toxic NAPQI which depletes glutathione; N-acetylcysteine restores glutathione pools"
    ],
    patho: "Heme synthesis spans mitochondria and cytoplasm. Porphobilinogen deaminase deficiency leads to upstream accumulation of neurotoxic delta-ALA and PBG during CYP450 induction, triggering autonomic instability and peripheral motor neuropathy. Bilirubin from macrophage heme breakdown is conjugated by hepatic UGT1A1 with glucuronate and secreted by MRP2. Acetaminophen overdose saturates glucuronidation, driving CYP2E1 synthesis of electrophilic NAPQI that causes centrilobular necrosis.",
    investigations: [
      "Urinary porphobilinogen (PBG) and delta-aminolevulinic acid (ALA) during acute attack",
      "Fractionated serum bilirubin (total, direct/conjugated, and indirect/unconjugated)",
      "Plasma acetaminophen level plotted on the Rumack-Matthew nomogram",
      "Serum ALT, AST, prothrombin time / INR to assess acute hepatic synthetic failure"
    ],
    differentials: [
      "Acute intermittent porphyria (neurovisceral attacks, red-wine urine) vs acute abdomen",
      "Porphyria cutanea tarda vs pseudoporphyria",
      "Gilbert syndrome vs Crigler-Najjar Type I/II vs hemolysis",
      "Dubin-Johnson syndrome (MRP2 defect, black liver) vs Rotor syndrome"
    ]
  },

  // Ch 35
  {
    id: "sodium_water_balance_and_osmolality",
    name: "Fluid Compartments, Plasma Osmolality, Starling Forces, and Hyponatremia",
    aliases: ["Plasma osmolality", "SIADH", "Starling forces", "Osmotic demyelination syndrome", "Hypotonic hyponatremia"],
    system: "Renal / Fluid and Electrolytes",
    specialty: "Biochemistry / Nephrology / Critical Care Medicine",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Total body water is 60% of weight: 2/3 intracellular, 1/3 extracellular (3/4 interstitial, 1/4 plasma volume)",
      "Serum osmolality normally ranges from 275 to 295 mOsm/kg, calculated as 2*Na + Glucose/18 + BUN/2.8",
      "Microvascular fluid flux depends on Starling forces: hydrostatic outward push versus albumin oncotic inward pull",
      "SIADH presents with euvolemic hypotonic hyponatremia, high urine osmolality (>100 mOsm/kg), and urine sodium >20-40 mEq/L",
      "Overly rapid correction of chronic hyponatremia (>8-10 mEq/L per 24 hours) causes fatal osmotic demyelination syndrome"
    ],
    patho: "Osmoreceptors in the anterior hypothalamus regulate thirst and posterior pituitary ADH secretion to maintain plasma osmolality. In SIADH, unsuppressed ADH acts on renal principal cell V2 receptors to insert aquaporin-2 channels, reabsorbing free water and causing dilutional hyponatremia. When chronic hyponatremia is corrected too rapidly, water rapidly leaves brain astrocytes, precipitating oligodendroglial apoptosis and central pontine myelinolysis.",
    investigations: [
      "Paired serum and urine osmolality",
      "Urine sodium concentration (distinguishes hypovolemic <20 from euvolemic/renal >40 mEq/L)",
      "Serum electrolytes, blood urea nitrogen, creatinine, glucose, and uric acid",
      "Serum TSH and morning cortisol to exclude hypothyroidism and adrenal crisis as causes of euvolemic hyponatremia"
    ],
    differentials: [
      "SIADH (euvolemic hyponatremia)",
      "Hypovolemic hyponatremia (dehydration, thiazide diuretics, cerebral salt wasting)",
      "Hypervolemic hyponatremia (congestive heart failure, decompensated cirrhosis)",
      "Pseudohyponatremia (severe hypertriglyceridemia, paraproteinemia)"
    ]
  },

  // Ch 36
  {
    id: "acid_base_disorders_and_anion_gap",
    name: "Acid-Base Homeostasis, Henderson-Hasselbalch, the Anion Gap, and Renal Tubular Acidosis",
    aliases: ["Metabolic acidosis", "Anion gap", "Renal tubular acidosis", "MUDPILES", "Ethylene glycol toxicity"],
    system: "Renal / Acid-Base Homeostasis",
    specialty: "Biochemistry / Nephrology / Emergency Medicine",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "The bicarbonate buffer system governs extracellular pH: pH = 6.1 + log([HCO3-] / 0.03*PaCO2)",
      "The serum anion gap equals Na - (Cl + HCO3); normal range is 8-12 mEq/L (high gap signifies unmeasured organic acids)",
      "Etiologies of high anion gap acidosis are remembered by MUDPILES (Methanol, Uremia, DKA, Propylene glycol, INH/Iron, Lactic, Ethylene glycol, Salicylates)",
      "Type 1 distal RTA features failure of intercalated cell proton secretion, urine pH > 5.5, nephrocalcinosis, and hypokalemia",
      "Ethylene glycol causes severe anion gap acidosis and acute tubular necrosis with envelope-shaped calcium oxalate crystals"
    ],
    patho: "Arterial pH is defended by chemical buffers, respiratory ventilation, and renal tubular proton secretion. High anion gap acidosis occurs when unmeasured organic acids (lactic, ketoacids, glycolic acid) dissociate, titrating plasma bicarbonate. In distal RTA (Type 1), alpha-intercalated cells cannot secrete protons via apical H+-ATPases, preventing urinary acidification below pH 5.5 and promoting calcium phosphate precipitation. Toxic alcohols yield toxic acids via alcohol dehydrogenase.",
    investigations: [
      "Arterial blood gas (pH, PaCO2, HCO3-) and serum electrolytes for anion gap calculation",
      "Serum lactate, beta-hydroxybutyrate, and blood urea nitrogen / creatinine",
      "Measured serum osmolality and calculated osmolal gap (normal <10 mOsm/kg)",
      "Urinalysis with microscopic examination for calcium oxalate crystals and urine pH"
    ],
    differentials: [
      "High anion gap metabolic acidosis (DKA, lactic acidosis, toxic alcohol ingestion)",
      "Normal anion gap (hyperchloremic) acidosis: severe diarrhea vs RTA Type 1, 2, or 4",
      "Mixed acid-base disturbances (e.g. salicylate toxicity causing respiratory alkalosis and metabolic acidosis)",
      "Metabolic alkalosis (saline-responsive vomiting vs saline-unresponsive hyperaldosteronism)"
    ]
  },

  // Ch 37
  {
    id: "muscle_bioenergetics_and_rhabdomyolysis",
    name: "Muscle Bioenergetics, Phosphocreatine Shuttle, Glycogen Storage Diseases, and Rhabdomyolysis",
    aliases: ["Creatine kinase", "Phosphocreatine", "McArdle disease", "Rhabdomyolysis", "Myoglobinuria"],
    system: "Musculoskeletal / Bioenergetics",
    specialty: "Biochemistry / Rheumatology / Emergency Medicine",
    source: "Medical Biochemistry 5th ed / Lehninger Principles of Biochemistry 8th ed",
    pearls: [
      "Phosphocreatine regenerates ATP via creatine kinase during the initial seconds of maximal contraction",
      "Creatine is synthesized in kidneys and liver from arginine, glycine, and SAM, and cyclizes non-enzymatically to creatinine",
      "McArdle disease (GSD Type V) is myophosphorylase deficiency causing exercise cramps, myoglobinuria, and second-wind effect",
      "Forearm ischemic exercise testing in McArdle disease reveals flat lactate curve with normal rise in ammonia",
      "Rhabdomyolysis releases massive creatine kinase and myoglobin, causing pigment nephropathy and acute tubular necrosis"
    ],
    patho: "Skeletal muscle utilizes phosphocreatine, anaerobic glycolysis, and aerobic oxidation in temporal succession. In McArdle disease, muscle glycogen phosphorylase absence arrests glycogenolysis, starving myocytes of glycolytic ATP during sudden exercise. Massive muscle breakdown from trauma, statins, or exertion ruptures the sarcolemma, releasing toxic myoglobin. Free myoglobin precipitates with Tamm-Horsfall proteins in renal tubules and causes ferrous iron-mediated free radical acute tubular necrosis.",
    investigations: [
      "Serum total creatine kinase (CK) level (often >5,000 to >50,000 U/L in rhabdomyolysis)",
      "Urinalysis: positive blood on dipstick with absent red blood cells on microscopy (myoglobinuria)",
      "Forearm ischemic exercise test (lactate and ammonia serial levels)",
      "Serum potassium, phosphate, calcium, and creatinine for complications of myocyte lysis"
    ],
    differentials: [
      "Rhabdomyolysis (trauma, compartment syndrome, statin-induced, exertional)",
      "McArdle disease (Glycogen storage disease Type V)",
      "Tarui disease (Phosphofructokinase deficiency, GSD Type VII)",
      "Carnitine palmitoyltransferase II (CPT-II) deficiency (mitochondrial lipid myopathy)"
    ]
  },

  // Ch 38
  {
    id: "calcium_homeostasis_pth_and_rickets",
    name: "Calcium and Phosphate Homeostasis: Parathyroid Hormone, Vitamin D, and Mineralization Defects",
    aliases: ["Parathyroid hormone", "Calcitriol", "Rickets", "Osteomalacia", "Paget disease of bone"],
    system: "Endocrine / Mineral Metabolism",
    specialty: "Biochemistry / Endocrinology / Orthopedics",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "PTH raises serum calcium and lowers phosphate by stimulating renal Ca2+ reabsorption, phosphate wasting, and 1-alpha-hydroxylase",
      "Calcitriol (1,25-(OH)2-D3) increases intestinal absorption of both calcium and phosphate, promoting bone mineralization",
      "Osteoblast RANKL binds osteoclast RANK to stimulate resorption; osteoprotegerin (OPG) acts as a protective decoy receptor",
      "Rickets and osteomalacia result from vitamin D or phosphate deficiency, causing failure of osteoid matrix calcification",
      "Paget disease of bone features disordered bone remodeling with markedly elevated alkaline phosphatase and normal Ca2+ and PO4"
    ],
    patho: "Calcium-sensing receptors on parathyroid cells stimulate PTH secretion during hypocalcemia. In kidneys, PTH induces CYP27B1 (1-alpha-hydroxylase) to convert 25-OH-vitamin D into active calcitriol. In vitamin D deficiency, impaired intestinal calcium and phosphate uptake causes secondary hyperparathyroidism; elevated PTH drives renal phosphate wasting, starving growth plates and bone matrix of hydroxyapatite minerals, producing uncalcified osteoid in rickets and osteomalacia.",
    investigations: [
      "Serum calcium, phosphate, and intact parathyroid hormone (PTH)",
      "Serum 25-hydroxyvitamin D (calcidiol, storage marker) and 1,25-dihydroxyvitamin D (calcitriol)",
      "Serum alkaline phosphatase (bone-specific ALP)",
      "Plain radiographs of wrists/knees for cupping and fraying of metaphyses in rickets"
    ],
    differentials: [
      "Nutritional rickets vs X-linked hypophosphatemic rickets (PHEX mutation)",
      "Osteomalacia vs Osteoporosis (osteomalacia has abnormal mineralization; osteoporosis has reduced normal bone)",
      "Primary hyperparathyroidism vs Secondary hyperparathyroidism",
      "Paget disease of bone (isolated high alkaline phosphatase)"
    ]
  },

  // Ch 39
  {
    id: "blood_brain_barrier_and_excitotoxicity",
    name: "Neurochemistry: The Blood-Brain Barrier, Myelin Composition, and Glutamate Excitotoxicity",
    aliases: ["Blood-brain barrier", "GLUT1 deficiency", "Myelin basic protein", "Excitotoxicity", "NMDA receptor"],
    system: "Neurochemistry / Neurobiology",
    specialty: "Biochemistry / Neurology / Neurocritical Care",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "The blood-brain barrier is formed by non-fenestrated capillary endothelium with claudin tight junctions and astrocyte foot processes",
      "Cerebral glucose transport is mediated by facilitated diffusion via GLUT1; amino acids cross via LAT1",
      "Central myelin is synthesized by oligodendrocytes and is 80% lipid, containing galactosylceramide and sulfatides",
      "Glutamate clearance from synapses is driven by astrocyte EAAT2 transporters; stroke causes transporter failure and excitotoxicity",
      "Excessive NMDA receptor activation drives massive calcium influx, activating calpains and nNOS to cause neuronal necrosis"
    ],
    patho: "The blood-brain barrier restricts solute transit to dedicated carrier systems. In cerebral ischemia, ATP depletion impairs astrocyte EAAT2 Na+-coupled glutamate reuptake. Sustained synaptic glutamate over-activates NMDA receptors, relieving the magnesium block and causing unrestrained calcium influx. Intracellular calcium overload activates calpain proteases, caspases, and neuronal nitric oxide synthase, producing peroxynitrite radicals that drive ischemic penumbral infarction.",
    investigations: [
      "CSF analysis: glucose, protein, oligoclonal bands, and IgG index in multiple sclerosis",
      "CSF-to-serum glucose ratio (markedly decreased <0.4 in GLUT1 deficiency syndrome)",
      "Brain MRI with diffusion-weighted imaging (DWI) for acute ischemic excitotoxic cytotoxic edema",
      "Genetic testing for SLC2A1 mutations in suspected GLUT1 deficiency"
    ],
    differentials: [
      "Acute ischemic stroke (glutamate excitotoxicity in ischemic penumbra)",
      "GLUT1 deficiency syndrome (infantile seizures, developmental delay, low CSF glucose)",
      "Multiple sclerosis (autoimmune demyelination of central myelin)",
      "Hepatic encephalopathy (astrocyte swelling from glutamine accumulation)"
    ]
  },

  // Ch 40
  {
    id: "acute_phase_proteins_and_serum_electrophoresis",
    name: "Serum Protein Electrophoresis, Alpha-1 Antitrypsin Deficiency, and Wilson Disease",
    aliases: ["Serum protein electrophoresis", "Albumin", "Alpha-1 antitrypsin", "Wilson disease", "Ceruloplasmin"],
    system: "Hematology / Hepatology",
    specialty: "Biochemistry / Gastroenterology / Internal Medicine",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Serum albumin generates 80% of intravascular colloid oncotic pressure and acts as a transport carrier for bilirubin and drugs",
      "Alpha-1 antitrypsin deficiency (PiZZ genotype) causes protein misfolding in hepatocytes (cirrhosis) and panacinar emphysema",
      "Hepatocyte PAS-positive, diastase-resistant globules confirm trapped alpha-1 antitrypsin polymers",
      "Wilson disease (ATP7B mutation) causes impaired copper excretion, low ceruloplasmin, and toxic copper deposition in basal ganglia",
      "Acute-phase response elevates positive reactants (CRP, fibrinogen, ferritin) and lowers negative reactants (albumin, transferrin)"
    ],
    patho: "Protein electrophoresis separates plasma proteins into albumin, alpha-1, alpha-2, beta, and gamma bands. The mutant PiZZ variant of alpha-1 antitrypsin forms insoluble loop-sheet polymers that trap in the hepatocyte endoplasmic reticulum, leading to chronic liver injury, while absent circulating protease inhibition permits elastase digestion of lung alveoli. In Wilson disease, mutated ATP7B halts copper excretion into bile and ceruloplasmin assembly, spilling toxic free copper into brain and cornea.",
    investigations: [
      "Serum protein electrophoresis (SPEP) and immunofixation",
      "Serum alpha-1 antitrypsin level and SERPINA1 Pi-phenotyping / genotyping",
      "Serum ceruloplasmin level (decreased <20 mg/dL in Wilson disease)",
      "24-Hour urinary copper excretion and slit-lamp examination for Kayser-Fleischer rings"
    ],
    differentials: [
      "Alpha-1 antitrypsin deficiency (panacinar emphysema and hepatic cirrhosis)",
      "Wilson disease (hepatolenticular degeneration)",
      "Nephrotic syndrome (hypoalbuminemia with elevated alpha-2 macroglobulin)",
      "Multiple myeloma (monoclonal gamma globulin M-spike)"
    ]
  },

  // Ch 41
  {
    id: "coagulation_cascade_and_anticoagulants",
    name: "The Coagulation Cascade, Fibrinolysis, Natural Anticoagulants, and Thrombophilia",
    aliases: ["Tissue factor", "Thrombin", "Antithrombin III", "Protein C", "Factor V Leiden", "D-dimer"],
    system: "Hematology / Hemostasis",
    specialty: "Biochemistry / Hematology / Vascular Medicine",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Coagulation is initiated in vivo by the extrinsic Tissue Factor-VIIa complex, which activates Factors X and IX",
      "The prothrombinase complex (Factor Xa + Va + Ca2+ + phospholipids) cleaves prothrombin (II) into thrombin (IIa)",
      "Antithrombin III inhibits thrombin and Factor Xa, an effect accelerated over 1,000-fold by heparin",
      "Thrombin-thrombomodulin complexes activate Protein C, which with Protein S degrades cofactors Va and VIIIa",
      "Factor V Leiden (Arg506Gln mutation) confers resistance to cleavage by activated Protein C, the most common inherited thrombophilia"
    ],
    patho: "Endothelial rupture exposes tissue factor, forming the TF-VIIa complex to initiate clotting. Thrombin cleaves fibrinogen into fibrin monomers that are cross-linked by Factor XIIIa. Natural anticoagulants balance this process: antithrombin neutralizes serine proteases, while activated protein C degrades cofactors Va and VIIIa. In Factor V Leiden, a single amino acid substitution prevents protein C-mediated cleavage, shifting the hemostatic balance toward venous thrombosis.",
    investigations: [
      "Prothrombin Time (PT / INR) and activated Partial Thromboplastin Time (aPTT)",
      "D-dimer quantitative ELISA (rules out deep vein thrombosis / pulmonary embolism when negative)",
      "Activated Protein C resistance assay and Factor V Leiden genetic PCR testing",
      "Functional assays for Antithrombin III, Protein C, and Protein S activity"
    ],
    differentials: [
      "Factor V Leiden thrombophilia vs Prothrombin G20210A mutation",
      "Antiphospholipid syndrome (lupus anticoagulant, anti-cardiolipin)",
      "Disseminated intravascular coagulation (DIC: prolonged PT/aPTT, low platelets, high D-dimer)",
      "Hemophilia A (Factor VIII) vs Hemophilia B (Factor IX deficiency)"
    ]
  },

  // Ch 42
  {
    id: "reactive_oxygen_species_and_antioxidants",
    name: "Reactive Oxygen Species Generation, Antioxidant Defense Systems, and Reperfusion Injury",
    aliases: ["Superoxide dismutase", "Fenton reaction", "Glutathione peroxidase", "NADPH oxidase", "Chronic granulomatous disease"],
    system: "Cellular Biochemistry / Pathology",
    specialty: "Biochemistry / Immunology / Critical Care Medicine",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "Superoxide is converted by superoxide dismutase into H2O2; ferrous iron catalyzes the Fenton reaction generating toxic OH.",
      "Catalase in peroxisomes and glutathione peroxidase in cytosol/mitochondria reduce hydrogen peroxide to water",
      "Glutathione reductase regenerates reduced glutathione (GSH) using NADPH supplied by the G6PD-driven HMP shunt",
      "Phagocytic NADPH oxidase generates the respiratory burst; its genetic deficiency causes Chronic Granulomatous Disease",
      "Reperfusion restores oxygen to ischemic tissue where xanthine oxidase metabolizes hypoxanthine, unleasing destructive ROS"
    ],
    patho: "Mitochondrial electron transport and inflammatory enzymes generate reactive oxygen species. In phagosomes, NADPH oxidase generates superoxide, converted to hypochlorous acid by myeloperoxidase. In Chronic Granulomatous Disease, defective NADPH oxidase prevents ROS generation, impairing killing of catalase-positive microbes. During reperfusion, hypoxanthine accumulated during ischemia is rapidly oxidized by xanthine oxidase, unleasing massive superoxide that peroxidizes sarcolemmal lipids.",
    investigations: [
      "Dihydrorhodamine (DHR) flow cytometry or Nitroblue Tetrazolium (NBT) reduction test for CGD",
      "G6PD quantitative enzymatic activity assay (measured outside of acute hemolytic crisis)",
      "Serum malondialdehyde or F2-isoprostanes as biomarkers of lipid peroxidation",
      "Myeloperoxidase (MPO) staining on peripheral blood or bone marrow smears"
    ],
    differentials: [
      "Chronic Granulomatous Disease (recurrent Staphylococcus, Aspergillus infections)",
      "G6PD deficiency (oxidative stress-induced hemolysis with Heinz bodies and bite cells)",
      "Myocardial ischemia-reperfusion injury",
      "Myeloperoxidase deficiency (impaired hypochlorous acid production)"
    ]
  },

  // Ch 43
  {
    id: "mhc_antigen_processing_and_complement",
    name: "Immunochemistry: V(D)J Recombination, MHC Antigen Presentation, and Complement Pathways",
    aliases: ["RAG recombinase", "MHC Class I and II", "Complement cascade", "C3 convertase", "Paroxysmal nocturnal hemoglobinuria"],
    system: "Immunology / Molecular Pathology",
    specialty: "Biochemistry / Immunology / Hematology",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry 32nd ed",
    pearls: [
      "V(D)J recombination requires RAG-1 and RAG-2; TdT adds template-independent N-nucleotides at segment junctions",
      "MHC Class I displays endogenous proteasomal peptides loaded via TAP to CD8+ cytotoxic T-lymphocytes",
      "MHC Class II displays exogenous endocytosed peptides processed in lysosomes to CD4+ helper T-lymphocytes",
      "Classical, lectin, and alternative complement pathways converge on C3 convertase, generating C3b opsonin and the MAC",
      "Paroxysmal nocturnal hemoglobinuria arises from somatic PIGA mutations, lacking GPI-anchored CD55 and CD59 regulators"
    ],
    patho: "Antigen receptor diversity is established by RAG-mediated V(D)J joining and TdT nucleotide addition. Cytosolic viral peptides are cleaved by proteasomes, transported by TAP, and presented on MHC Class I. Complement cascades activate on microbial surfaces to generate the C5b-9 membrane attack complex. Erythrocytes express GPI-anchored CD55 and CD59 to inhibit convertases and the MAC; loss of PIGA in PNH leaves erythrocytes unprotected, causing chronic complement-mediated intravascular hemolysis.",
    investigations: [
      "Flow cytometry for CD55 and CD59 on peripheral blood granulocytes and erythrocytes (PNH clone detection)",
      "Total hemolytic complement assay (CH50 for classical pathway; AH50 for alternative pathway)",
      "Serum complement C3 and C4 quantitative levels",
      "HLA high-resolution DNA typing for transplant matching and autoimmune disease associations"
    ],
    differentials: [
      "Paroxysmal nocturnal hemoglobinuria (Coombs-negative hemolytic anemia, thrombosis)",
      "Severe combined immunodeficiency (SCID due to RAG1/RAG2 or IL2RG mutations)",
      "Complement component deficiencies (C1q/C2/C4 lupus risk; C5-C9 recurrent Neisseria)",
      "Bare lymphocyte syndrome (MHC Class I [TAP deficiency] or MHC Class II deficiency)"
    ]
  }
];
