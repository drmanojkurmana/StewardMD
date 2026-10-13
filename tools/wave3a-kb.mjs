/**
 * Wave 3A Knowledge Library Articles (KB v2)
 * 17 Paired Reference Articles for Medical Biochemistry Chapters 1 to 20
 */

export const wave3aKbArticles = [
  {
    id: "biochemical_basis_of_disease",
    name: "Biochemical Basis of Disease and Cellular Compartmentalization",
    aliases: ["Cellular compartmentalization", "Inborn errors of metabolism", "Organelle pathology", "Mitochondrial transport"],
    system: "Metabolic / Cellular Biochemistry",
    specialty: "Biochemistry / Genetics / Internal Medicine",
    source: "Harper's Illustrated Biochemistry / Lehninger Principles of Biochemistry",
    pearls: [
      "Metabolic compartmentalization separates anabolic cytosolic pathways from catabolic mitochondrial matrix reactions",
      "Inner mitochondrial membrane is impermeable to ions and polar solutes, preserving the electrochemical proton gradient",
      "Enzyme deficiencies cause proximal toxic substrate accumulation and distal essential product depletion",
      "Peroxisomes initiate beta-oxidation of very long-chain fatty acids (C22 or longer) and synthesize plasmalogens",
      "Zellweger syndrome results from defective peroxisomal biogenesis (PEX mutations), causing death in early infancy"
    ],
    patho: "Spatial segregation within subcellular organelles prevents futile metabolic cycling and enables independent allosteric control. Inborn errors of metabolism arise from loss-of-function mutations in compartment-specific enzymes, resulting in failure of energetic product generation and toxic accumulation of upstream intermediates. Disruption of peroxisomal protein import causes multi-organ developmental failure.",
    investigations: [
      "Plasma amino acid chromatography and acylcarnitine profile via tandem mass spectrometry",
      "Urine organic acid analysis by gas chromatography-mass spectrometry (GC-MS)",
      "Plasma very long-chain fatty acid (VLCFA) levels (elevated C26:0 and C26:1)",
      "Blood lactate, pyruvate, and ammonia to distinguish mitochondrial vs urea cycle defects"
    ],
    differentials: [
      "Peroxisomal biogenesis disorders (Zellweger syndrome spectrum)",
      "Mitochondrial respiratory chain enzymopathies",
      "Lysosomal storage disorders",
      "Classical galactosemia and hereditary fructose intolerance"
    ]
  },
  {
    id: "protein_folding_and_prion_diseases",
    name: "Protein Folding, Molecular Chaperones, Amyloidosis and Prions",
    aliases: ["Amyloidosis", "Prion disease", "Molecular chaperones", "ERAD pathway"],
    system: "Molecular Pathology / Neurochemistry",
    specialty: "Biochemistry / Neurology / Hematology",
    source: "Lehninger Principles of Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Protein folding is thermodynamically driven by hydrophobic collapse, burying nonpolar residues within the core",
      "Molecular chaperones (Hsp70 and Hsp60 chaperonins) bind exposed hydrophobic patches to prevent aggregation",
      "Amyloid fibrils consist of insoluble cross-beta sheet polymers displaying apple-green birefringence under polarized Congo red microscopy",
      "Prion disease occurs when normal alpha-helical PrPC converts into protease-resistant beta-sheet rich PrPSc",
      "Endoplasmic reticulum-associated degradation (ERAD) polyubiquitinates misfolded proteins for 26S proteasomal destruction"
    ],
    patho: "Failure of chaperone-mediated protein folding or proteasomal clearance permits self-assembly of misfolded conformers into ordered cross-beta sheet amyloid fibrils. Fibrillar deposits resist normal tissue proteolysis, causing extracellular physical disruption and organ failure. In prion disorders, abnormal PrPSc acts as an autocatalytic conformational template, triggering progressive spongiform neurodegeneration.",
    investigations: [
      "Tissue biopsy (abdominal fat pad, rectum, or affected organ) with Congo red staining and polarized light microscopy",
      "Serum and urine protein electrophoresis with immunofixation for monoclonal light chains (AL amyloid)",
      "Technetium pyrophosphate (99mTc-PYP) cardiac scintigraphy for transthyretin (ATTR) amyloidosis",
      "CSF RT-QuIC (real-time quaking-induced conversion) assay for prion PrPSc"
    ],
    differentials: [
      "AL (primary) amyloidosis vs AA (secondary reactive) amyloidosis",
      "Hereditary or wild-type transthyretin (ATTR) amyloid cardiomyopathy",
      "Creutzfeldt-Jakob disease (sporadic, familial, or variant)",
      "Light chain deposition disease"
    ]
  },
  {
    id: "carbohydrate_and_lipid_chemistry",
    name: "Carbohydrate and Lipid Chemistry: Stereoisomers, Glycosidic Bonds and Lipids",
    aliases: ["Carbohydrate chemistry", "Epimers", "Fatty acid classification", "Triacylglycerols"],
    system: "Metabolic / Structural Biochemistry",
    specialty: "Biochemistry / Endocrinology / Nutrition",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "D- and L-isomers are designated by the asymmetric carbon farthest from the carbonyl; human enzymes metabolize D-sugars",
      "Glucose and galactose are C-4 epimers; glucose and mannose are C-2 epimers",
      "Sucrose contains an alpha-1,beta-2 bond joining both anomeric carbons, rendering it non-reducing",
      "Unsaturated cis-double bonds create rigid kinks that lower lipid melting point and maintain membrane fluidity",
      "Triacylglycerols yield 37 kJ/g upon complete oxidation, providing over twice the caloric density of hydrated glycogen"
    ],
    patho: "Stereochemical configuration determines enzyme-substrate recognition and membrane architecture. Monosaccharide epimerization enables interconversion between dietary hexoses. Unsaturated fatty acid incorporation into phospholipids preserves homeoviscous adaptation in biological membranes. Adipose triacylglycerols provide high-density anhydrous energy reserves mobilized during fasting.",
    investigations: [
      "Fasting lipid profile (total cholesterol, triglycerides, HDL, calculated LDL)",
      "Serum glucose and glycated hemoglobin (HbA1c)",
      "Urine reducing substances test (Benedict reaction) to screen for galactosuria or fructosuria",
      "Gas chromatography of plasma fatty acid methyl esters"
    ],
    differentials: [
      "Essential fructosuria (fructokinase deficiency, benign reducing sugar in urine)",
      "Classical galactosemia (GALT deficiency, toxic galactose-1-phosphate accumulation)",
      "Familial hypertriglyceridemia (elevated VLDL)",
      "Essential fatty acid deficiency"
    ]
  },
  {
    id: "membrane_transport_and_channelopathies",
    name: "Membrane Transport, Lipid Rafts and Channelopathies",
    aliases: ["Fluid mosaic model", "Lipid rafts", "Cystic fibrosis CFTR", "Primary active transport"],
    system: "Cellular Physiology / Membrane Biochemistry",
    specialty: "Biochemistry / Pulmonology / Gastroenterology",
    source: "Lehninger Principles of Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Membrane phospholipid asymmetry is maintained by ATP-dependent flippases and floppases; exteriorization of phosphatidylserine signals apoptosis",
      "Lipid rafts are ordered cholesterol- and sphingolipid-rich microdomains that cluster signaling receptors and GPI-anchored proteins",
      "Sodium-potassium ATPase exports 3 Na+ and imports 2 K+ per ATP hydrolyzed, generating transmembrane resting potential",
      "Cystic fibrosis results from CFTR gene mutations (most commonly F508del), an ATP-gated chloride channel",
      "CFTR dysfunction prevents chloride and water secretion into airways, causing thick dehydrated mucus and chronic infections"
    ],
    patho: "Lipid bilayers provide semipermeable barriers separating intra- and extracellular ionic environments. Integral membrane transport proteins regulate solute flux via facilitated diffusion, primary ATP-driven pumps, or secondary coupled cotransport. Channelopathies arise from mutations in ion channel pores, disrupting electrochemical homeostasis, cellular volume regulation, and epithelial fluid secretion.",
    investigations: [
      "Sweat chloride quantitative pilocarpine iontophoresis (positive if >=60 mmol/L for cystic fibrosis)",
      "CFTR genetic mutation panel and full gene sequencing",
      "Serum electrolytes and arterial blood gas for metabolic alkalosis",
      "High-resolution chest CT for bronchiectasis and mucus plugging"
    ],
    differentials: [
      "Cystic fibrosis vs primary ciliary dyskinesia (Kartagener syndrome)",
      "Hypokalemic periodic paralysis (calcium/sodium channelopathy)",
      "Congenital long QT syndromes (KCNQ1 / KCNH2 potassium channel mutations)",
      "Bartter and Gitelman syndromes (renal tubular channelopathies)"
    ]
  },
  {
    id: "hemoglobin_allostery_and_oxygen_delivery",
    name: "Hemoglobin Cooperativity, Allosteric Regulation, 2,3-BPG and the Bohr Effect",
    aliases: ["Hemoglobin allostery", "Bohr effect", "2,3-bisphosphoglycerate", "Oxygen dissociation curve"],
    system: "Hematology / Respiratory Biochemistry",
    specialty: "Biochemistry / Hematology / Critical Care",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry",
    pearls: [
      "Tetrameric hemoglobin exhibits positive cooperativity (sigmoidal curve); monomeric myoglobin displays a non-cooperative hyperbolic curve",
      "Oxygen binding transitions hemoglobin from the low-affinity tense (T) state to the high-affinity relaxed (R) state",
      "The Bohr effect right-shifts the curve in acidic, hypercapnic tissues, promoting oxygen unloading to active cells",
      "2,3-BPG nests in the central cavity of the deoxygenated T-state tetramer, stabilizing it and decreasing oxygen affinity",
      "Fetal hemoglobin (alpha2-gamma2) substitutes serine for histidine-143, lowering 2,3-BPG binding and enabling transplacental oxygen uptake"
    ],
    patho: "Hemoglobin quaternary structure coordinates allosteric conformational shifts between T and R states. In metabolically active tissues, protons, carbon dioxide, heat, and 2,3-BPG stabilize ionic salt bridges of the T state, right-shifting the P50 and enhancing peripheral oxygen delivery. In the lungs, high partial pressures of oxygen reverse this binding via the Haldane effect, discharging carbon dioxide.",
    investigations: [
      "Arterial blood gas with co-oximetry (measures PaO2, SaO2, methemoglobin, and carboxyhemoglobin)",
      "Hemoglobin electrophoresis or high-performance liquid chromatography (HPLC)",
      "Red blood cell 2,3-bisphosphoglycerate assay",
      "P50 oxygen affinity determination on whole blood"
    ],
    differentials: [
      "Carbon monoxide poisoning (left-shift and carboxyhemoglobin elevation)",
      "Methemoglobinemia (Fe3+ oxidation, chocolate cyanosis, unresponsive to supplemental oxygen)",
      "High-oxygen-affinity vs low-oxygen-affinity hemoglobin variants",
      "High altitude polycythemia (compensatory 2,3-BPG elevation)"
    ]
  },
  {
    id: "enzyme_kinetics_and_inhibitors",
    name: "Enzyme Kinetics, Michaelis-Menten Analysis and Reversible Inhibition",
    aliases: ["Michaelis-Menten kinetics", "Lineweaver-Burk plot", "Competitive inhibition", "Glucokinase vs hexokinase"],
    system: "Enzymology / Clinical Pharmacology",
    specialty: "Biochemistry / Pharmacology / Laboratory Medicine",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Km represents substrate concentration at half-maximal velocity (Vmax/2); small Km indicates high enzyme-substrate affinity",
      "Hexokinase has low Km (<0.1 mM) and is inhibited by G6P; glucokinase has high Km (~10 mM), acts as a glucose sensor and lacks G6P inhibition",
      "On Lineweaver-Burk plots, y-intercept equals 1/Vmax, x-intercept equals -1/Km, and slope equals Km/Vmax",
      "Competitive inhibitors increase apparent Km without changing Vmax; overcome by high substrate concentrations",
      "Noncompetitive inhibitors decrease Vmax without changing Km; cannot be overcome by excess substrate"
    ],
    patho: "Enzymes stabilize reaction transition states to accelerate reaction rates by many orders of magnitude. Saturation kinetics reflect finite catalytic site availability. Reversible inhibitors alter apparent affinity or catalytic turnover, forming the basis of targeted pharmacotherapy (e.g., statins competing for HMG-CoA reductase). Allosteric effectors induce cooperative sigmoidal kinetics.",
    investigations: [
      "Serum enzyme activity assays (CK, ALT, AST, ALP, amylase, lipase)",
      "Therapeutic drug monitoring of enzyme-inhibiting medications",
      "In vitro enzyme kinetic profiling (Km and Vmax determination)",
      "Maturity-onset diabetes of the young type 2 (MODY2) GCK gene sequencing"
    ],
    differentials: [
      "Competitive vs noncompetitive vs uncompetitive pharmacological inhibition",
      "Glucokinase deficiency (MODY2 mild fasting hyperglycemia) vs hyperinsulinemic hypoglycemia",
      "Organophosphate pesticide poisoning (irreversible acetylcholinesterase inhibition)",
      "Heavy metal toxicity (lead noncompetitive inhibition of ferrochelatase and ALA dehydratase)"
    ]
  },
  {
    id: "vitamin_deficiencies_and_cofactors",
    name: "Vitamins and Trace Minerals: Coenzymes, Antioxidants and Deficiency States",
    aliases: ["Vitamin B deficiencies", "Trace elements", "Folate trap", "Fat-soluble vitamins"],
    system: "Nutritional Biochemistry / Metabolism",
    specialty: "Biochemistry / Nutrition / Internal Medicine",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Thiamine pyrophosphate (TPP) is cofactor for PDH, alpha-ketoglutarate dehydrogenase, and transketolase",
      "Niacin (NAD+/NADP+) deficiency causes pellagra: the 4 Ds (diarrhea, dermatitis, dementia, death)",
      "Vitamin K is essential for gamma-glutamyl carboxylation of clotting factors II, VII, IX, X, protein C and S",
      "Cobalamin (B12) deficiency traps folate as N5-methyl-THF, halting purine/thymidylate synthesis and causing megaloblastic anemia",
      "Zinc deficiency causes acrodermatitis enteropathica with periorificial rash, diarrhea, alopecia, and impaired wound healing"
    ],
    patho: "Vitamins and trace minerals act as coenzymes and prosthetic groups essential for metabolic catalysis, cellular respiration, antioxidant defense, and gene transcription. Nutritional insufficiency, malabsorption, or genetic transporter mutations compromise enzymatic cascades, producing characteristic cutaneous, neurological, hematological, and metabolic deficiency syndromes.",
    investigations: [
      "Serum vitamin B12 and folate levels",
      "Serum methylmalonic acid (elevated in B12 deficiency; normal in isolated folate deficiency)",
      "Erythrocyte transketolase activation assay (diagnostic for thiamine deficiency)",
      "Prothrombin time / INR (prolonged in vitamin K deficiency; corrects with parenteral vitamin K)"
    ],
    differentials: [
      "Vitamin B12 deficiency vs folate deficiency (subacute combined degeneration occurs only in B12 deficiency)",
      "Wernicke encephalopathy vs Korsakoff psychosis vs hepatic encephalopathy",
      "Acrodermatitis enteropathica vs essential fatty acid deficiency",
      "Scurvy (vitamin C) vs vasculitis (perifollicular hemorrhages and corkscrew hairs)"
    ]
  },
  {
    id: "electron_transport_chain_and_uncouplers",
    name: "Mitochondrial Bioenergetics, ETC Complexes and Proton Gradient Uncoupling",
    aliases: ["Oxidative phosphorylation", "ETC inhibitors", "Proton uncoupling", "Thermogenin UCP1"],
    system: "Mitochondrial Bioenergetics / Toxicology",
    specialty: "Biochemistry / Critical Care / Toxicology",
    source: "Lehninger Principles of Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Complexes I, III, and IV pump protons from matrix to intermembrane space, generating the proton-motive force",
      "ATP synthase (Complex V) couples proton transit back into the matrix to rotational catalysis of ATP synthesis",
      "Cyanide and carbon monoxide block Complex IV (cytochrome c oxidase), halting electron transport and oxygen consumption",
      "Uncouplers (2,4-dinitrophenol, aspirin overdose) dissipate the proton gradient, collapsing ATP synthesis while maximizing heat",
      "Brown adipose tissue expresses thermogenin (UCP1) for non-shivering thermogenesis in neonates"
    ],
    patho: "Coupled oxidative phosphorylation requires an intact, ion-impermeable inner mitochondrial membrane. Inhibitors of electron transfer complexes arrest the respiratory chain, stopping both ATP generation and oxygen utilization, precipitating cytotoxic hypoxia and severe lactic acidosis. Chemical uncouplers increase membrane proton conductance, disconnecting electron transport from phosphorylation, dissipating energy as uncontrolled heat.",
    investigations: [
      "Arterial blood gas and serum lactate (severe lactic acidosis with elevated central venous oxygen saturation)",
      "Blood cyanide level and carboxyhemoglobin fraction",
      "Serum salicylate level (aspirin toxicity evaluation)",
      "Muscle biopsy with Gomori trichrome stain (ragged-red fibers in mitochondrial myopathies)"
    ],
    differentials: [
      "Cyanide toxicity (high venous SvO2 with severe lactic acidosis) vs carbon monoxide poisoning",
      "Salicylate toxicity (mixed early respiratory alkalosis and late metabolic acidosis with hyperthermia)",
      "2,4-Dinitrophenol overdose (lethal hyperpyrexia, tachycardia, diaphoresis)",
      "Mitochondrial encephalomyopathy with lactic acidosis and stroke-like episodes (MELAS)"
    ]
  },
  {
    id: "rbc_metabolism_and_g6pd_deficiency",
    name: "Erythrocyte Metabolism: Glycolysis, G6PD Shunt and Hemolytic Enzymopathies",
    aliases: ["G6PD deficiency", "Heinz bodies", "Bite cells", "Pyruvate kinase deficiency"],
    system: "Hematology / Erythrocyte Biochemistry",
    specialty: "Biochemistry / Hematology / Pediatrics",
    source: "Medical Biochemistry 5th ed / Harper's Illustrated Biochemistry",
    pearls: [
      "Mature erythrocytes lack mitochondria, depending completely on anaerobic glycolysis for 2 net ATP per glucose",
      "G6PD catalyzes the rate-limiting step of the hexose monophosphate shunt, the sole source of erythrocyte NADPH",
      "NADPH maintains reduced glutathione (GSH) to detoxify hydrogen peroxide and prevent lipid peroxidation",
      "Oxidative stress denatures hemoglobin into Heinz bodies; splenic macrophages pluck these inclusions, forming bite cells",
      "Pyruvate kinase deficiency causes chronic non-spherocytic hemolytic anemia with compensatory elevation of 2,3-BPG"
    ],
    patho: "Red blood cells require ATP to power cation pumps and maintain membrane deformability during splenic passage. In G6PD deficiency, NADPH generation fails during oxidative stress (infections, fava beans, primaquine, sulfa drugs), permitting free radical damage, membrane lipid peroxidation, and hemoglobin precipitation into rigid Heinz bodies, precipitating acute intravascular and extravascular hemolysis.",
    investigations: [
      "Complete blood count, peripheral smear (bite cells, blister cells, polychromasia)",
      "Supravital crystal violet stain of peripheral blood for Heinz bodies",
      "Hemolytic markers: serum haptoglobin (decreased), LDH (elevated), unconjugated bilirubin (elevated)",
      "Quantitative erythrocyte G6PD activity assay (performed 2 to 3 months after acute hemolytic crisis resolves)"
    ],
    differentials: [
      "G6PD deficiency vs pyruvate kinase deficiency (episodic oxidative vs chronic ongoing hemolysis)",
      "Autoimmune hemolytic anemia (positive direct Coombs / antiglobulin test)",
      "Hereditary spherocytosis (osmotic fragility test positive, negative Heinz bodies)",
      "Microangiopathic hemolytic anemia (TTP/HUS: presence of schistocytes and thrombocytopenia)"
    ]
  },
  {
    id: "glycogen_storage_diseases_and_gluconeogenesis",
    name: "Gluconeogenesis, Glycogen Metabolism and Glycogen Storage Diseases",
    aliases: ["Von Gierke disease", "Pompe disease", "McArdle disease", "Gluconeogenesis bypasses"],
    system: "Metabolic / Hepatic and Muscle Biochemistry",
    specialty: "Biochemistry / Endocrinology / Pediatrics",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Gluconeogenesis bypasses three irreversible glycolytic steps using pyruvate carboxylase, PEPCK, FBPase-1, and G6Pase",
      "Fructose-2,6-bisphosphate is the key reciprocal regulator: stimulates PFK-1 (glycolysis) and inhibits FBPase-1 (gluconeogenesis)",
      "Type I GSD (von Gierke) is glucose-6-phosphatase deficiency: severe fasting hypoglycemia, lactic acidosis, hepatomegaly, gout",
      "Type II GSD (Pompe) is lysosomal acid maltase deficiency: fatal infantile hypertrophic cardiomyopathy and hypotonia",
      "Type V GSD (McArdle) is skeletal muscle phosphorylase deficiency: exercise cramps, myoglobinuria, flat venous lactate curve"
    ],
    patho: "Glycogenolysis and gluconeogenesis maintain blood glucose during fasting. Inherited deficiencies in glycogen mobilizing enzymes trap glycogen within hepatocytes, myocytes, or lysosomes. Glucose-6-phosphatase absence prevents final glucose release into plasma, forcing accumulated glucose-6-phosphate into glycolysis (causing lactic acidosis), HMP shunt (causing hyperuricemia via PRPP), and lipogenesis (causing hyperlipidemia).",
    investigations: [
      "Fasting blood glucose, lactate, uric acid, lipid profile, and liver enzymes",
      "Forearm ischemic exercise test (flat venous lactate curve with normal ammonia rise in McArdle disease)",
      "Echocardiogram (massive symmetrical left ventricular hypertrophy in Pompe disease)",
      "Targeted genetic testing (G6PC for von Gierke, GAA for Pompe, PYGM for McArdle)"
    ],
    differentials: [
      "Von Gierke disease (Type I GSD) vs Cori disease (Type III GSD, debranching enzyme, normal blood lactate)",
      "Pompe disease vs spinal muscular atrophy vs Danon disease",
      "McArdle disease vs carnitine palmitoyltransferase II deficiency (lipid myopathy)",
      "Hereditary fructose intolerance (aldolase B deficiency, hypoglycemia upon sucrose/fructose ingestion)"
    ]
  },
  {
    id: "fatty_acid_synthesis_and_steatosis",
    name: "De Novo Lipogenesis, Citrate Shuttle and Hepatic Steatosis",
    aliases: ["Fatty acid synthesis", "Acetyl-CoA carboxylase", "Citrate shuttle", "Hepatic steatosis"],
    system: "Metabolic / Hepatic and Adipose Biochemistry",
    specialty: "Biochemistry / Gastroenterology / Endocrinology",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Cytosolic fatty acid synthesis requires the citrate shuttle to export mitochondrial acetyl-CoA across the inner membrane",
      "Acetyl-CoA carboxylase (ACC) catalyzes the rate-limiting step, adding CO2 to form malonyl-CoA using biotin and ATP",
      "ACC is allosterically activated by citrate and dephosphorylated by insulin; inhibited by palmitoyl-CoA and AMPK phosphorylation",
      "Malonyl-CoA allosterically inhibits carnitine palmitoyltransferase-1 (CPT-1), preventing simultaneous fatty acid beta-oxidation",
      "Fatty acid synthase complex performs 7 repetitive elongation cycles using NADPH, synthesizing 16-carbon palmitate"
    ],
    patho: "Under carbohydrate and energy surplus, excess mitochondrial pyruvate is converted into citrate and shuttled to the cytosol for de novo lipogenesis. Acetyl-CoA carboxylase generates malonyl-CoA, which fuels fatty acid synthase and concurrently blocks beta-oxidation via CPT-1 inhibition. When hepatocyte triacylglycerol synthesis exceeds VLDL assembly and export capacity, neutral fat accumulates, producing hepatic steatosis.",
    investigations: [
      "Liver ultrasound or magnetic resonance elastography (MRE) for hepatic fat fraction and fibrosis",
      "Serum transaminases (AST and ALT; typically ALT > AST in metabolic dysfunction-associated steatotic liver disease)",
      "Fasting lipid profile, fasting glucose, and fasting insulin (HOMA-IR calculation)",
      "Liver biopsy for histological grading of steatohepatitis and ballooning degeneration"
    ],
    differentials: [
      "Metabolic dysfunction-associated steatotic liver disease (MASLD / NAFLD)",
      "Alcoholic liver disease (AST:ALT ratio typically >2:1 with elevated GGT)",
      "Drug-induced steatosis (amiodarone, methotrexate, corticosteroids)",
      "Wilson disease and hereditary hemochromatosis"
    ]
  },
  {
    id: "cholesterol_biosynthesis_and_statins",
    name: "Cholesterol Biosynthesis, SREBP-2 Regulation, Statins and Bile Acid Metabolism",
    aliases: ["HMG-CoA reductase", "Statins", "SREBP-2 pathway", "Bile acid synthesis"],
    system: "Lipid Metabolism / Cardiovascular Biochemistry",
    specialty: "Biochemistry / Cardiology / Endocrinology",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "All 27 carbons of cholesterol originate from cytosolic acetyl-CoA; HMG-CoA reductase catalyzes the rate-limiting committed step",
      "Statins are competitive structural analogues of HMG-CoA, potently inhibiting HMG-CoA reductase",
      "Lowered intracellular sterol prompts SCAP to escort SREBP-2 to Golgi for proteolytic activation, upregulating LDL receptors",
      "Cholesterol 7-alpha-hydroxylase catalyzes the rate-limiting step in hepatic conversion of cholesterol into primary bile acids",
      "Terminal ileum reabsorbs 95% of bile acids via the apical sodium-dependent bile acid transporter (ASBT)"
    ],
    patho: "Cholesterol is synthesized from acetyl-CoA through mevalonate and squalene intermediates. Hepatic cholesterol depletion by statins triggers SREBP-2 nuclear translocation, inducing cell-surface LDL receptor expression and clearing atherogenic ApoB-containing lipoproteins from plasma. Bile acid synthesis is the principal elimination pathway for cholesterol, subject to negative feedback via the nuclear farnesoid X receptor (FXR).",
    investigations: [
      "Fasting lipid panel (total cholesterol, LDL-C, HDL-C, triglycerides, non-HDL cholesterol)",
      "Serum apolipoprotein B (ApoB) and lipoprotein(a) levels",
      "Serum creatine kinase and ALT before and during statin therapy",
      "Genetic testing for LDLR, APOB, and PCSK9 mutations in suspected familial hypercholesterolemia"
    ],
    differentials: [
      "Familial hypercholesterolemia (autosomal dominant LDLR, APOB, or PCSK9 gain-of-function)",
      "Familial dysbetalipoproteinemia (Type III hyperlipidemia, ApoE2 homozygosity)",
      "Statin-associated myopathy and immune-mediated necrotizing myopathy (anti-HMGCR antibodies)",
      "Cholestatic liver disease with impaired biliary cholesterol elimination"
    ]
  },
  {
    id: "purine_metabolism_gout_and_lesch_nyhan",
    name: "Purine and Pyrimidine Metabolism: De Novo Synthesis, Salvage, Gout and Lesch-Nyhan",
    aliases: ["Purine synthesis", "Lesch-Nyhan syndrome", "Gout", "Adenosine deaminase SCID"],
    system: "Nucleotide Metabolism / Rheumatology",
    specialty: "Biochemistry / Rheumatology / Medical Genetics",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Purine de novo synthesis builds the ring on ribose-5-phosphate; glutamine-PRPP amidotransferase is rate-limiting",
      "Pyrimidines synthesize a free orotate ring before PRPP attachment; cytosolic CPS-II is rate-limiting",
      "HGPRT salvages hypoxanthine to IMP and guanine to GMP; complete deficiency causes X-linked Lesch-Nyhan syndrome",
      "Lesch-Nyhan presents with hyperuricemia, gout, choreoathetosis, developmental delay, and compulsive self-mutilation",
      "Xanthine oxidase catabolizes hypoxanthine and xanthine to poorly soluble uric acid; inhibited by allopurinol and febuxostat"
    ],
    patho: "Purines and pyrimidines are generated via energetic de novo synthesis or high-efficiency base salvage. HGPRT deficiency blocks purine salvage, accelerating de novo purine production due to PRPP accumulation and loss of feedback inhibition. Massive purine catabolism generates excess uric acid. Monosodium urate crystals precipitate in joints, activating NLRP3 inflammasomes and triggering intense neutrophilic synovitis.",
    investigations: [
      "Serum uric acid level (hyperuricemia >6.8 mg/dL; may paradoxically normalize during acute flare)",
      "Arthrocentesis with polarized light microscopy: needle-shaped, negatively birefringent monosodium urate crystals",
      "24-hour urine uric acid excretion and uric acid-to-creatinine ratio",
      "Enzyme assay for HGPRT activity in erythrocyte lysates and HPRT1 gene sequencing"
    ],
    differentials: [
      "Acute gouty arthritis vs pseudogout (calcium pyrophosphate, rhomboid, positively birefringent)",
      "Septic arthritis (synovial fluid gram stain and culture mandatory)",
      "Lesch-Nyhan syndrome vs cerebral palsy vs Tourette syndrome",
      "Severe combined immunodeficiency (ADA deficiency causing dATP accumulation and lymphocyte toxicity)"
    ]
  },
  {
    id: "mucopolysaccharidoses_and_proteoglycans",
    name: "Glycosaminoglycans, Proteoglycan Complexes and Mucopolysaccharidoses",
    aliases: ["Mucopolysaccharidoses", "Hurler syndrome", "Hunter syndrome", "Glycosaminoglycans"],
    system: "Connective Tissue / Lysosomal Biochemistry",
    specialty: "Biochemistry / Medical Genetics / Pediatrics",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Glycosaminoglycans (GAGs) are negatively charged heteropolysaccharides of repeating amino sugar and uronic acid units",
      "Hyaluronic acid is the only non-sulfated GAG not covalently bound to protein; chondroitin sulfate is the most abundant",
      "Hurler syndrome (MPS I) is autosomal recessive alpha-L-iduronidase deficiency with corneal clouding and dysostosis",
      "Hunter syndrome (MPS II) is X-linked recessive iduronate-2-sulfatase deficiency with clear corneas and aggressive behavior",
      "Sanfilippo syndrome (MPS III) accumulates heparan sulfate, presenting with severe childhood dementia and hyperactivity"
    ],
    patho: "Proteoglycan aggregates form hydrated viscoelastic matrices that absorb mechanical stress in cartilage, bone, and heart valves. Lysosomal acid hydrolase deficiencies arrest stepwise catabolism of dermatan sulfate and heparan sulfate. Undegraded GAGs accumulate in lysosomes across connective, reticuloendothelial, and neural tissues, producing coarse facial features, skeletal dysostosis, corneal opacity, and neurodegeneration.",
    investigations: [
      "Quantitative urinary glycosaminoglycan excretion and electrophoresis (elevated dermatan/heparan sulfate)",
      "Fluorometric lysosomal enzyme activity assay in leukocytes or cultured skin fibroblasts",
      "Skeletal survey radiographs (dysostosis multiplex: bullet-shaped vertebrae, spatulate ribs, macrocephaly)",
      "Ophthalmological slit-lamp examination (corneal clouding in MPS I; clear corneas in MPS II)"
    ],
    differentials: [
      "MPS I (Hurler) vs MPS II (Hunter) (autosomal recessive vs X-linked; corneal clouding present vs absent)",
      "MPS III (Sanfilippo) vs pediatric autism spectrum and attention deficit disorders",
      "MPS IV (Morquio) vs spondyloepiphyseal dysplasia (odontoid hypoplasia, normal intellect)",
      "I-cell disease (mucolipidosis II, GlcNAc phosphotransferase deficiency, massive lysosomal enzyme release into plasma)"
    ]
  },
  {
    id: "sphingolipidoses_and_lysosomal_storage",
    name: "Sphingolipid Metabolism and Lysosomal Storage Diseases",
    aliases: ["Gaucher disease", "Tay-Sachs disease", "Niemann-Pick disease", "Fabry disease"],
    system: "Neurochemistry / Lysosomal Storage Pathology",
    specialty: "Biochemistry / Neurology / Hematology",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Sphingolipids are built upon sphingosine and ceramide; degradation occurs via stepwise lysosomal acid hydrolases",
      "Gaucher disease is glucocerebrosidase deficiency: crinkled tissue paper macrophages, avascular necrosis, hepatosplenomegaly",
      "Tay-Sachs is hexosaminidase A deficiency: GM2 ganglioside accumulation, cherry-red macula, neurodegeneration, no organomegaly",
      "Niemann-Pick is acid sphingomyelinase deficiency: foamy histiocytes, cherry-red macula, AND massive hepatosplenomegaly",
      "Fabry disease is X-linked alpha-galactosidase A deficiency: angiokeratomas, burning acroparesthesias, early renal failure"
    ],
    patho: "Sphingolipids are abundant in neuronal plasma membranes and myelin. Inherited deficiency of individual acid hydrolases halts the degradation cascade, causing un-cleaved glycolipids to accumulate within lysosomes. Engorged macrophages infiltrate bone marrow, liver, and spleen in Gaucher disease. Toxic neuronal lysosomal distension causes progressive neurodegeneration and macular cherry-red spots in Tay-Sachs and Niemann-Pick.",
    investigations: [
      "Enzyme activity assays in peripheral blood leukocytes or dried blood spots (beta-glucosidase, hexosaminidase A, sphingomyelinase)",
      "Bone marrow aspirate and biopsy (crinkled paper Gaucher cells vs foamy Niemann-Pick histiocytes)",
      "Dilated fundoscopic examination (cherry-red spot at the fovea centralis)",
      "Targeted gene sequencing (GBA for Gaucher, HEXA for Tay-Sachs, SMPD1 for Niemann-Pick, GLA for Fabry)"
    ],
    differentials: [
      "Gaucher disease vs hematologic malignancies (splenomegaly, thrombocytopenia, bone pain)",
      "Tay-Sachs vs Niemann-Pick (hepatosplenomegaly absent in Tay-Sachs; prominent in Niemann-Pick)",
      "Fabry disease vs small-fiber neuropathy, juvenile arthritis, and hereditary hemorrhagic telangiectasia",
      "Metachromatic leukodystrophy (arylsulfatase A deficiency, sulfatide accumulation, central demyelination)"
    ]
  },
  {
    id: "collagen_synthesis_and_ehlers_danlos",
    name: "Extracellular Matrix: Collagen Synthesis, Post-Translational Modification and Scurvy",
    aliases: ["Collagen biosynthesis", "Ehlers-Danlos syndrome", "Osteogenesis imperfecta", "Scurvy"],
    system: "Connective Tissue / Matrix Biochemistry",
    specialty: "Biochemistry / Medical Genetics / Rheumatology",
    source: "Harper's Illustrated Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Collagen triple helix requires Gly-X-Y repeats where glycine fits into the restricted central axial core",
      "Prolyl and lysyl hydroxylases require vitamin C, ferrous iron, and oxygen; deficiency causes scurvy",
      "Extracellular lysyl oxidase is a copper-dependent enzyme that deaminates lysine to form covalent covalent crosslinks",
      "Osteogenesis imperfecta results from COL1A1/COL1A2 glycine mutations: brittle bones, blue sclerae, hearing loss",
      "Vascular Ehlers-Danlos is caused by COL3A1 (type III collagen) mutations, predisposing to arterial and organ rupture"
    ],
    patho: "Collagen maturation involves complex intracellular modification and extracellular fibril assembly. Hydroxylation of proline and lysine residues in the ER stabilizes triple-helix formation. Terminal propeptides are cleaved extracellularly, and lysyl oxidase catalyzes covalent crosslinking between tropocollagen units. Genetic defects in collagen chains or cofactors undermine tensile strength, causing skeletal fragility, vascular rupture, or cutaneous hyperelasticity.",
    investigations: [
      "Genetic panel sequencing for COL1A1, COL1A2, COL3A1, COL5A1, and related connective tissue genes",
      "Clinical Beighton hypermobility score assessment (>=5/9 indicates generalized joint hypermobility)",
      "Echocardiogram and vascular CT/MR angiography for aortic root dilation and arterial aneurysms",
      "Plasma ascorbic acid level (severely depressed in scurvy <0.2 mg/dL)"
    ],
    differentials: [
      "Osteogenesis imperfecta vs non-accidental trauma (child abuse) in pediatric fractures",
      "Classic vs hypermobile vs vascular Ehlers-Danlos syndrome",
      "Marfan syndrome (FBN1 fibrillin-1 mutation, lens dislocation, aortic root aneurysm)",
      "Scurvy vs Henoch-Schonlein purpura (perifollicular hemorrhages and corkscrew hairs pathognomonic for scurvy)"
    ]
  },
  {
    id: "dna_repair_pathways_and_xeroderma",
    name: "DNA Replication Fork Fidelity and Genome Surveillance Repair Pathways",
    aliases: ["DNA repair", "Nucleotide excision repair", "Xeroderma pigmentosum", "Lynch syndrome MMR"],
    system: "Molecular Genetics / Genome Integrity",
    specialty: "Biochemistry / Oncology / Dermatology",
    source: "Lehninger Principles of Biochemistry / Medical Biochemistry 5th ed",
    pearls: [
      "Replicative DNA polymerases delta and epsilon possess 3' to 5' exonuclease proofreading activity",
      "Mismatch repair (MMR; MSH2, MLH1) corrects post-replicative replication errors; defects cause Lynch syndrome",
      "Nucleotide excision repair (NER) removes bulky UV-induced cyclobutane thymine dimers; endonuclease cuts on both sides",
      "Defects in nucleotide excision repair cause xeroderma pigmentosum, marked by extreme photosensitivity and skin cancer",
      "Base excision repair (BER) uses DNA glycosylases and AP endonuclease to remove non-distorting damaged bases (uracil)"
    ],
    patho: "Genomic integrity is defended by layered surveillance systems. Polymerase proofreading removes mispaired bases during synthesis. Post-replicative mismatch repair recognizes base mispairs escaping proofreading. When DNA is damaged by ultraviolet radiation, nucleotide excision repair excises the damaged oligonucleotide. Failure of NER permits mutagenic lesion persistence, predisposing to accelerated carcinogenesis.",
    investigations: [
      "Germline genetic testing for DNA repair genes (XP genes A through G, MSH2, MLH1, MSH6, PMS2)",
      "Microsatellite instability (MSI) testing and immunohistochemistry for mismatch repair proteins in tumor tissue",
      "Functional unscheduled DNA synthesis (UDS) assay in cultured fibroblasts for xeroderma pigmentosum",
      "Dermatological surveillance and regular full-body skin examinations with biopsy of suspicious lesions"
    ],
    differentials: [
      "Xeroderma pigmentosum vs Cockayne syndrome vs trichothiodystrophy",
      "Lynch syndrome (hereditary nonpolyposis colorectal cancer) vs sporadic MSI-high colorectal cancer",
      "Ataxia-telangiectasia (ATM gene mutation, defective double-strand break repair)",
      "Fanconi anemia (defective interstrand crosslink repair, marrow failure, radial ray anomalies)"
    ]
  }
];
