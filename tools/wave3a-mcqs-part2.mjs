/**
 * Wave 3A MCQs Part 2 (Modules 2 to 9, 80 MCQs)
 */

export const wave3aMcqsPart2 = {
  // Module 2: bio-protein-folding
  "bio-protein-folding": [
    {
      id: "bk-bio-051",
      q: "Under polarized light microscopy, a renal biopsy stained with Congo red displays pathognomonic apple-green birefringence. What structural conformation is characteristic of this protein aggregate?",
      o: ["Insoluble cross-beta sheet fibrillar structure", "Alpha-helical coiled-coil structure", "Triple-helix tropocollagen motif", "Random coil unstructured aggregate"],
      a: 0,
      exp: "Amyloid fibrils consist of antiparallel cross-beta sheet pleated sheets running perpendicular to the long axis of the fibril, conferring Congo red dye binding and green birefringence under crossed polarizers.",
      r: ["Correct. Amyloid fibrils are composed of cross-beta sheet structures.", "Incorrect. Alpha-helices are normal globular secondary structures.", "Incorrect. Triple-helices characterize collagen.", "Incorrect. Amyloid is highly ordered, not random coil."],
      kp: "Amyloid deposits consist of cross-beta sheet fibrils that display pathognomonic apple-green birefringence under polarized light with Congo red.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-052",
      q: "Which molecular chaperone family functions as a barrel-shaped isolation chamber ('chaperonin') that encapsulates nascent unfolded proteins to allow folding undisturbed by macromolecular crowding?",
      o: ["Hsp60 (GroEL/GroES in bacteria)", "Hsp70 family", "Hsp90 family", "Protein disulfide isomerase"],
      a: 0,
      exp: "The Hsp60 chaperonin family forms a double-ring cylindrical barrel with a central cavity capped by a lid (GroES or TRiC), sequestering unfolded proteins to fold without aggregating with other proteins.",
      r: ["Correct. Hsp60 chaperonins form an isolation barrel for protein folding.", "Incorrect. Hsp70 binds directly to short hydrophobic stretches of nascent chains.", "Incorrect. Hsp90 stabilizes steroid receptors and kinases.", "Incorrect. PDI rearranges disulfide bonds."],
      kp: "Hsp60 chaperonins provide a cylindrical isolation cage where unfolded polypeptides fold protected from cytosolic macromolecular crowding.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-053",
      q: "The conversion of the normal cellular prion protein (PrPC) into the infectious scrapie isoform (PrPSc) in Creutzfeldt-Jakob disease involves which primary conformational change?",
      o: ["Transition from alpha-helices to abundant beta-pleated sheets", "Cleavage of the amino-terminal signal peptide", "Hyperphosphorylation of serine residues", "Loss of covalent disulfide bridges"],
      a: 0,
      exp: "PrPC has 42% alpha-helix content and little beta-sheet. PrPSc shifts to 43% beta-sheet and reduced alpha-helix, rendering it insoluble, protease-resistant, and self-templating.",
      r: ["Correct. Prion conversion involves refolding from alpha-helices into beta-sheets.", "Incorrect. The primary sequence is unchanged; no unique peptide cleavage occurs.", "Incorrect. Prion disease is a conformational shift, not hyperphosphorylation.", "Incorrect. Disulfide bonds remain intact."],
      kp: "Prion diseases arise from conformational refolding of normal alpha-helical PrPC into protease-resistant beta-sheet rich PrPSc.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-054",
      q: "In the endoplasmic reticulum-associated degradation (ERAD) pathway, terminally misfolded glycoproteins are targeted for cytosolic destruction by which post-translational modification?",
      o: ["Polyubiquitination via lysine-48 linked ubiquitin chains", "Phosphorylation by protein kinase A", "SUMOylation of lysine residues", "Palmitoylation of cysteine residues"],
      a: 0,
      exp: "Misfolded proteins in the ER lumen are retrotranslocated into the cytosol and tagged with polyubiquitin chains linked through lysine-48 by E3 ubiquitin ligases, targeting them to the 26S proteasome.",
      r: ["Correct. Lysine-48 linked polyubiquitination targets proteins to the 26S proteasome.", "Incorrect. Phosphorylation does not directly route ERAD substrates to proteasomes.", "Incorrect. SUMOylation typically regulates localization or stability, not degradation.", "Incorrect. Palmitoylation anchors proteins to membranes."],
      kp: "Misfolded proteins retrotranslocated during ERAD are tagged with Lys48-linked polyubiquitin for degradation by 26S proteasomes.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-055",
      q: "A 68-year-old man presents with progressive heart failure, macroglossia, and bilateral carpal tunnel syndrome. Serum protein electrophoresis reveals an IgG kappa monoclonal spike. What type of amyloidosis is this?",
      o: ["AL amyloidosis (immunoglobulin light chain)", "AA amyloidosis (serum amyloid A)", "ATTR amyloidosis (transthyretin)", "A-beta-2M amyloidosis"],
      a: 0,
      exp: "AL amyloidosis is caused by monoclonal plasma cell dyscrasias producing excess immunoglobulin light chains (kappa or lambda). Macroglossia and periorbital purpura are highly specific hallmarks.",
      r: ["Correct. AL amyloidosis results from monoclonal light chains and causes macroglossia and heart failure.", "Incorrect. AA amyloidosis arises in chronic inflammatory states (RA, osteomyelitis) and rarely causes macroglossia.", "Incorrect. ATTR is transthyretin (senile or familial).", "Incorrect. Beta-2M occurs in long-term hemodialysis."],
      kp: "AL amyloidosis results from monoclonal immunoglobulin light chain deposition; macroglossia, nephrotic syndrome, and restrictive cardiomyopathy are classic.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-056",
      q: "What is the primary thermodynamic driving force governing the spontaneous folding of a globular protein in aqueous solution?",
      o: ["Hydrophobic collapse (increase in water entropy)", "Formation of covalent peptide bonds", "Interchain disulfide bond formation", "Van der Waals interactions between polar groups"],
      a: 0,
      exp: "Burying hydrophobic nonpolar side chains inside the protein interior releases ordered water molecules into the bulk solvent, causing a large favorable gain in solvent entropy (the hydrophobic effect).",
      r: ["Correct. Hydrophobic collapse driven by favorable water entropy gain is the primary force.", "Incorrect. Peptide bonds are already formed in primary structure.", "Incorrect. Disulfide bonds stabilize tertiary structure but do not drive initial folding.", "Incorrect. Polar interactions contribute but are weaker than hydrophobic effect."],
      kp: "Protein folding is primarily driven by hydrophobic collapse, which buries nonpolar residues to maximize water solvent entropy.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-057",
      q: "Which enzyme resident in the endoplasmic reticulum catalyzes the oxidation of cysteines and isomerization of non-native disulfide bonds to achieve correct protein tertiary structure?",
      o: ["Protein disulfide isomerase (PDI)", "Peptidyl prolyl cis-trans isomerase", "Glutathione reductase", "Lysyl oxidase"],
      a: 0,
      exp: "Protein disulfide isomerase (PDI) in the ER lumen oxidizes thiol groups to form disulfides and reduces non-native disulfides, isomerizing them until the thermodynamically correct native pairing is achieved.",
      r: ["Correct. PDI catalyzes formation and reshuffling of disulfide bonds in the ER.", "Incorrect. Peptidyl prolyl isomerase flips proline peptide bonds.", "Incorrect. Glutathione reductase reduces GSSG in cytosol.", "Incorrect. Lysyl oxidase crosslinks collagen extracellularly."],
      kp: "Protein disulfide isomerase (PDI) in the rough ER lumen introduces and rearranges disulfide bonds to ensure correct native folding.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-058",
      q: "Severe ER stress causes accumulation of unfolded proteins, triggering the unfolded protein response (UPR). Which ER transmembrane kinase/endoribonuclease splices XBP1 mRNA to activate UPR transcription?",
      o: ["IRE1 (Inositol-requiring enzyme 1)", "PERK", "ATF6", "mTOR"],
      a: 0,
      exp: "IRE1 is an ER transmembrane sensor that oligomerizes during ER stress, activating its cytosolic endoribonuclease domain to splice XBP1 mRNA into an active transcription factor that induces chaperone genes.",
      r: ["Correct. IRE1 splices XBP1 mRNA to drive chaperone and ERAD gene expression.", "Incorrect. PERK phosphorylates eIF2-alpha to attenuate global translation.", "Incorrect. ATF6 translocates to Golgi for proteolytic cleavage.", "Incorrect. mTOR regulates cell growth and autophagy."],
      kp: "IRE1 senses ER stress and activates endoribonuclease activity to splice XBP1 mRNA, inducing chaperones and ERAD clearance machinery.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-059",
      q: "A 55-year-old woman with a 20-year history of severe rheumatoid arthritis develops massive proteinuria (7 g/day) and hepatosplenomegaly. Renal biopsy demonstrates AA amyloid. What is the precursor protein?",
      o: ["Serum amyloid A (SAA, an acute phase reactant)", "Monoclonal lambda light chain", "Transthyretin", "Beta-amyloid protein"],
      a: 0,
      exp: "AA (secondary) amyloidosis arises from chronic inflammatory states where sustained elevation of IL-1 and IL-6 stimulates hepatic production of serum amyloid A (SAA), fragments of which deposit as amyloid.",
      r: ["Correct. SAA is an acute-phase reactant synthesized by liver during chronic inflammation.", "Incorrect. Lambda light chains cause AL amyloidosis.", "Incorrect. Transthyretin causes ATTR amyloidosis.", "Incorrect. Beta-amyloid is found in Alzheimer disease plaques."],
      kp: "AA amyloidosis complicates chronic inflammation (rheumatoid arthritis, bronchiectasis, osteomyelitis) via deposition of cleaved serum amyloid A (SAA).",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-060",
      q: "Tafamidis is a disease-modifying oral therapeutic used in transthyretin cardiac amyloidosis. What is its mechanism of action?",
      o: ["Binds and kinetically stabilizes the TTR tetramer, preventing dissociation into amyloidogenic monomers", "Directly dissolves extracellular cross-beta sheet amyloid fibrils", "Inhibits hepatic transcription of the TTR gene", "Stimulates macrophage phagocytosis of cardiac amyloid plaques"],
      a: 0,
      exp: "Tafamidis binds the thyroxine-binding sites of the transthyretin (TTR) tetramer with high affinity, kinetically stabilizing the native tetrameric structure and preventing dissociation into misfolded amyloidogenic monomers.",
      r: ["Correct. Tafamidis stabilizes the TTR tetramer, preventing monomer dissociation and amyloid formation.", "Incorrect. It does not dissolve pre-existing fibrils.", "Incorrect. It does not inhibit hepatic TTR synthesis (that is patisiran/vutrisiran RNAi).", "Incorrect. It does not act as an antibody promoting phagocytosis."],
      kp: "Tafamidis binds and kinetically stabilizes the transthyretin tetramer, preventing dissociation into amyloidogenic monomers in ATTR cardiomyopathy.",
      img: [], d: 2, cog: "application"
    }
  ],

  // Module 3: bio-carb-lipid-basics
  "bio-carb-lipid-basics": [
    {
      id: "bk-bio-061",
      q: "D-glucose and D-galactose differ stereochemically in the spatial configuration around which single carbon atom, defining them as epimers?",
      o: ["Carbon-4 (C-4)", "Carbon-2 (C-2)", "Carbon-3 (C-3)", "Carbon-1 (C-1)"],
      a: 0,
      exp: "D-glucose and D-galactose are C-4 epimers. D-glucose and D-mannose are C-2 epimers. Inversion at C-1 represents anomerism upon ring closure.",
      r: ["Correct. Glucose and galactose are C-4 epimers.", "Incorrect. Inversion at C-2 creates D-mannose.", "Incorrect. C-3 configuration is identical in both.", "Incorrect. C-1 inversion represents alpha/beta anomers."],
      kp: "D-glucose and D-galactose are C-4 epimers; D-glucose and D-mannose are C-2 epimers.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-062",
      q: "Why is sucrose considered a non-reducing sugar that yields a negative result on Benedict and Fehling copper reduction tests?",
      o: ["Both anomeric carbon atoms (C-1 of glucose and C-2 of fructose) are linked in the glycosidic bond", "It lacks hydroxyl groups on its ring carbons", "It contains only pentose sugars that cannot reduce copper", "It forms insoluble crystals that prevent reagent contact"],
      a: 0,
      exp: "Sucrose is formed by an alpha-1,beta-2 glycosidic bond between the anomeric C-1 of glucose and anomeric C-2 of fructose. With neither anomeric carbon free to open into an aldehyde/ketone, it cannot reduce Cu2+.",
      r: ["Correct. Both anomeric carbons are engaged in the glycosidic bond, leaving no free hemiacetal.", "Incorrect. It possesses numerous free hydroxyl groups.", "Incorrect. It consists of glucose (hexose) and fructose (hexose).", "Incorrect. Sucrose is highly water-soluble."],
      kp: "Sucrose is non-reducing because its alpha-1,beta-2 glycosidic bond engages the anomeric carbons of both glucose and fructose.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-063",
      q: "Which polyunsaturated fatty acid containing 18 carbons and two cis-double bonds is an essential dietary fatty acid because humans lack delta-12 and delta-15 desaturases?",
      o: ["Linoleic acid (18:2, omega-6)", "Alpha-linolenic acid (18:3, omega-3)", "Oleic acid (18:1, omega-9)", "Arachidonic acid (20:4, omega-6)"],
      a: 0,
      exp: "Linoleic acid (18:2, delta-9,12) is an essential omega-6 fatty acid. Humans cannot introduce double bonds beyond carbon 9, making dietary linoleic and alpha-linolenic acids mandatory.",
      r: ["Correct. Linoleic acid (18:2) is an essential omega-6 fatty acid.", "Incorrect. Alpha-linolenic acid has 3 double bonds (18:3).", "Incorrect. Oleic acid is monounsaturated (18:1) and non-essential.", "Incorrect. Arachidonic acid has 20 carbons and can be made from linoleic acid."],
      kp: "Linoleic acid (18:2, n-6) and alpha-linolenic acid (18:3, n-3) are essential dietary fatty acids because humans cannot desaturate beyond carbon 9.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-064",
      q: "What is the structural effect of a cis-double bond compared to a trans-double bond in a fatty acid hydrocarbon chain?",
      o: ["Introduces a 30-degree rigid kink that disrupts tight packing and increases membrane fluidity", "Straightens the carbon chain, allowing denser paracrystalline packing", "Increases the melting point above that of saturated fatty acids", "Enables spontaneous cleavage into free radical fragments"],
      a: 0,
      exp: "A cis-double bond creates a rigid 30-degree kink in the hydrocarbon chain, preventing tight parallel packing of lipids, which lowers the melting temperature and increases membrane fluidity.",
      r: ["Correct. Cis-double bonds introduce kinks that disrupt packing and boost fluidity.", "Incorrect. Trans-double bonds and saturated chains adopt straight geometries.", "Incorrect. Cis-double bonds lower the melting point.", "Incorrect. Double bonds do not spontaneously fragment under normal conditions."],
      kp: "Cis-double bonds introduce rigid kinks in fatty acid chains, preventing dense packing and increasing biological membrane fluidity.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-065",
      q: "Why are triacylglycerols a far more efficient long-term energy storage vehicle than glycogen in mammalian adipose tissue?",
      o: ["They are stored anhydrously and yield 37 kJ/g upon oxidation, compared to 17 kJ/g for hydrated glycogen", "They require zero oxygen for complete catabolic oxidation", "They can be converted directly to glucose in skeletal muscle", "They are soluble in blood without carrier proteins"],
      a: 0,
      exp: "Triacylglycerols are neutral and hydrophobic, stored without water of hydration (glycogen binds twice its weight in water) and are highly reduced, yielding 37 kJ/g (9 kcal/g) versus 17 kJ/g (4 kcal/g) for carbohydrates.",
      r: ["Correct. Triacylglycerols are anhydrous and yield over twice the caloric density per gram.", "Incorrect. Fatty acid oxidation requires substantial oxygen.", "Incorrect. Odd-chain only yields minimal propionate; muscle cannot make glucose from fats.", "Incorrect. Lipids require albumin and lipoproteins for transport."],
      kp: "Triacylglycerols provide over twice the energy density of carbohydrates (37 vs 17 kJ/g) and are stored completely anhydrously in adipocytes.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-066",
      q: "Intestinal brush border lactase hydrolyzes lactose into which two monosaccharide constituents?",
      o: ["Glucose and Galactose", "Glucose and Fructose", "Two molecules of Glucose", "Galactose and Fructose"],
      a: 0,
      exp: "Lactose is a disaccharide of beta-D-galactopyranosyl-(1->4)-D-glucopyranose. Lactase (beta-galactosidase) hydrolyzes this beta-1,4 bond to release free D-galactose and D-glucose.",
      r: ["Correct. Lactose hydrolyzes into glucose and galactose.", "Incorrect. Glucose and fructose form sucrose.", "Incorrect. Two glucose molecules form maltose.", "Incorrect. Galactose and fructose do not form lactose."],
      kp: "Brush border lactase cleaves the beta-1,4 glycosidic bond of lactose into free D-glucose and D-galactose.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-067",
      q: "In glycogen, linear chains of glucose residues are joined by alpha-1,4 bonds, whereas branch points are formed by which linkage?",
      o: ["Alpha-1,6-glycosidic bonds", "Beta-1,4-glycosidic bonds", "Alpha-1,2-glycosidic bonds", "Beta-1,6-glycosidic bonds"],
      a: 0,
      exp: "Glycogen branches occur approximately every 8 to 12 residues and are formed by alpha-1,6-glycosidic linkages introduced by the branching enzyme (amylo-alpha-1,4->1,6-transglucosidase).",
      r: ["Correct. Glycogen branch points are alpha-1,6 linkages.", "Incorrect. Beta-1,4 bonds occur in cellulose and lactose.", "Incorrect. Alpha-1,2 bonds occur in sucrose.", "Incorrect. Beta-1,6 linkages occur in certain fungal glucans."],
      kp: "Glycogen branches are joined by alpha-1,6-glycosidic linkages, introduced every 8 to 12 glucose units along alpha-1,4 linear chains.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-068",
      q: "Hormone-sensitive lipase (HSL) in adipose tissue is phosphorylated and activated during fasting in response to which hormonal stimulation?",
      o: ["Epinephrine and Glucagon via cyclic AMP and Protein Kinase A", "Insulin via Protein Phosphatase-1", "Growth hormone via JAK-STAT kinase", "Cortisol via nuclear receptor dimerization"],
      a: 0,
      exp: "During fasting or stress, glucagon and epinephrine bind Gs-coupled receptors, elevating cAMP and activating PKA. PKA phosphorylates HSL and perilipin, exposing lipid droplets to lipolysis.",
      r: ["Correct. Glucagon and epinephrine stimulate PKA phosphorylation of HSL.", "Incorrect. Insulin activates PP1, which dephosphorylates and inhibits HSL.", "Incorrect. Growth hormone has permissive long-term effects.", "Incorrect. Cortisol induces lipase expression transcriptionally."],
      kp: "Hormone-sensitive lipase is phosphorylated and activated by PKA in response to epinephrine and glucagon, promoting triacylglycerol lipolysis.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-069",
      q: "A newborn is evaluated for cataracts, hepatosplenomegaly, and failure to thrive after breast milk feeding. Urine is positive for reducing substances but negative on glucose oxidase dipstick. Which enzyme is deficient?",
      o: ["Galactose-1-phosphate uridylyltransferase (GALT)", "Galactokinase", "Fructokinase", "Aldolase B"],
      a: 0,
      exp: "Classic galactosemia results from GALT deficiency, leading to toxic accumulation of galactose-1-phosphate and galactitol. Unmetabolized galactose is a reducing sugar (Benedict positive) but glucose dipstick negative.",
      r: ["Correct. GALT deficiency causes classic galactosemia with cataracts, liver failure, and galactosuria.", "Incorrect. Galactokinase deficiency causes isolated cataracts without hepatosplenomegaly.", "Incorrect. Fructokinase deficiency is asymptomatic essential fructosuria.", "Incorrect. Aldolase B deficiency is hereditary fructose intolerance triggered by fructose/sucrose, not milk lactose."],
      kp: "Classic galactosemia (GALT deficiency) manifests after milk feeding with cataracts, liver dysfunction, and urine positive for reducing sugars but negative for glucose.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-070",
      q: "Which essential fatty acid serves as the direct biochemical precursor for the synthesis of arachidonic acid (20:4, n-6) in human hepatocytes?",
      o: ["Linoleic acid (18:2, n-6)", "Alpha-linolenic acid (18:3, n-3)", "Oleic acid (18:1, n-9)", "Palmitic acid (16:0)"],
      a: 0,
      exp: "Linoleic acid undergoes delta-6 desaturation, elongation by two carbons, and delta-5 desaturation to generate arachidonic acid (20:4, n-6), the precursor for pro-inflammatory eicosanoids.",
      r: ["Correct. Linoleic acid is elongated and desaturated to produce arachidonic acid.", "Incorrect. Alpha-linolenic acid yields EPA and DHA (omega-3).", "Incorrect. Oleic acid yields Mead acid during essential fatty acid deficiency.", "Incorrect. Palmitic acid is a saturated fatty acid."],
      kp: "Linoleic acid (18:2, n-6) is desaturated and elongated to synthesize arachidonic acid (20:4, n-6), the precursor of prostaglandins and leukotrienes.",
      img: [], d: 1, cog: "recall"
    }
  ],

  // Module 4: bio-membrane-transport
  "bio-membrane-transport": [
    {
      id: "bk-bio-071",
      q: "Which integral membrane transporter actively maintains phospholipid asymmetry by using ATP hydrolysis to translocate phosphatidylserine from the outer leaflet to the inner cytosolic leaflet?",
      o: ["P-type ATPase flippase", "ABC transporter floppase", "Calcium-activated scramblase", "Voltage-gated anion channel"],
      a: 0,
      exp: "Flippases are P-type ATPases that specifically pump aminophospholipids (phosphatidylserine and phosphatidylethanolamine) inward from outer to inner leaflet against a concentration gradient.",
      r: ["Correct. P-type flippases pump phosphatidylserine inward from the outer leaflet.", "Incorrect. Floppases pump lipids outward from inner to outer leaflet.", "Incorrect. Scramblases randomly collapse asymmetry bidirectionally without ATP.", "Incorrect. Anion channels transport ions, not lipids."],
      kp: "Flippases are P-type ATPases that use ATP to translocate phosphatidylserine inward, preserving membrane asymmetry; outer exposure triggers macrophage phagocytosis.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-072",
      q: "Lipid rafts are specialized, detergent-resistant membrane microdomains. Which two lipids are characteristically enriched within these rafts to maintain a liquid-ordered phase?",
      o: ["Cholesterol and Sphingomyelin", "Phosphatidylserine and Cardiolipin", "Triacylglycerols and Diacylglycerol", "Polyunsaturated phosphatidylcholine and Phosphatidic acid"],
      a: 0,
      exp: "Lipid rafts are tightly packed liquid-ordered domains enriched in cholesterol and saturated sphingolipids (such as sphingomyelin and glycosphingolipids), which organize transmembrane signaling complexes.",
      r: ["Correct. Cholesterol and sphingomyelin are the hallmark constituents of lipid rafts.", "Incorrect. Cardiolipin is in mitochondria.", "Incorrect. Triacylglycerols are stored in fat droplets, not plasma membranes.", "Incorrect. Polyunsaturated lipids promote liquid-disordered bulk fluid phases."],
      kp: "Lipid rafts are membrane microdomains enriched in cholesterol and sphingomyelin that cluster GPI-anchored proteins and signal transduction complexes.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-073",
      q: "The cardiac glycoside digoxin increases myocardial contractility by reversibly inhibiting the sodium-potassium ATPase. What immediate intracellular ion alteration drives this inotropic effect?",
      o: ["Elevated intracellular Na+ decreases NCX activity, raising intracellular Ca2+", "Direct activation of sarcoplasmic reticulum calcium release channels", "Blockade of L-type voltage-gated calcium channels", "Depletion of intracellular potassium activates troponin C"],
      a: 0,
      exp: "Inhibiting Na+/K+-ATPase increases intracellular Na+, which reduces the trans-sarcolemmal Na+ gradient driving the 3Na+/1Ca2+ exchanger (NCX), resulting in secondary Ca2+ accumulation and enhanced cardiac contractility.",
      r: ["Correct. Elevated intracellular Na+ inhibits NCX calcium export, elevating intracellular Ca2+.", "Incorrect. Digoxin does not bind ryanodine channels directly.", "Incorrect. It does not block L-type calcium channels.", "Incorrect. Intracellular K+ drops, but Ca2+ accumulation drives inotropy."],
      kp: "Digoxin inhibits the Na+/K+-ATPase pump, increasing intracellular Na+ and secondarily decreasing NCX Ca2+ export, boosting sarcoplasmic Ca2+ stores and contractility.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-074",
      q: "What is the most common pathogenic mutation in the CFTR gene responsible for cystic fibrosis, and what class of processing defect does it cause?",
      o: ["F508del (deletion of phenylalanine at position 508), causing Class II protein misfolding and ERAD degradation", "G542X nonsense mutation, causing Class I absent protein synthesis", "G551D missense mutation, causing Class III defective channel gating", "R117H missense mutation, causing Class IV reduced channel conductance"],
      a: 0,
      exp: "F508del is present in ~70% of CF alleles. The three-base-pair deletion of phenylalanine-508 prevents proper CFTR protein folding in the ER, routing it to ERAD proteasomal degradation so zero channel reaches the apical membrane.",
      r: ["Correct. F508del causes misfolding and premature ERAD proteasomal destruction (Class II).", "Incorrect. G542X is a Class I stop codon mutation.", "Incorrect. G551D is a Class III gating mutation treated with ivacaftor.", "Incorrect. R117H is a Class IV conductance defect."],
      kp: "CFTR F508del is a Class II mutation: the misfolded channel is caught by ER quality control and degraded by ERAD before reaching the cell surface.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-075",
      q: "Which glucose transporter isoform is insulin-responsive, undergoing translocation from intracellular vesicles to the plasma membrane in skeletal muscle and adipose tissue upon insulin signaling?",
      o: ["GLUT4", "GLUT1", "GLUT2", "GLUT3"],
      a: 0,
      exp: "GLUT4 is the insulin-sensitive glucose transporter expressed in striated muscle and adipose tissue. Insulin-stimulated Akt phosphorylation promotes exocytosis of GLUT4 storage vesicles to the cell surface.",
      r: ["Correct. GLUT4 translocates to plasma membranes in response to insulin and exercise.", "Incorrect. GLUT1 is ubiquitous (RBCs, blood-brain barrier) and insulin-independent.", "Incorrect. GLUT2 is bidirectional in liver and beta-cells, insulin-independent.", "Incorrect. GLUT3 is in neurons with high glucose affinity."],
      kp: "GLUT4 is the insulin-dependent glucose transporter in skeletal muscle and adipose tissue, mobilized to the plasma membrane via PI3K-Akt signaling.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-076",
      q: "Intestinal absorption of dietary glucose across the apical enterocyte membrane against its concentration gradient is mediated by which transporter and mechanism?",
      o: ["SGLT1 via secondary active sodium symport", "GLUT2 via facilitated diffusion", "GLUT5 via facilitated fructose transport", "Sodium-potassium ATPase primary active pump"],
      a: 0,
      exp: "SGLT1 couples the downhill entry of two sodium ions (down an electrochemical gradient created by basolateral Na+/K+-ATPase) to the uphill import of one glucose or galactose molecule across the apical enterocyte membrane.",
      r: ["Correct. SGLT1 is a secondary active symporter using the sodium gradient.", "Incorrect. GLUT2 is on the basolateral membrane for exit to blood via facilitated diffusion.", "Incorrect. GLUT5 transports fructose, not glucose.", "Incorrect. The Na+/K+-ATPase pump is basolateral."],
      kp: "Apical enterocyte glucose absorption is mediated by SGLT1 via secondary active transport coupled to the downhill sodium gradient.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-077",
      q: "Ivacaftor is a cystic fibrosis transmembrane conductance regulator (CFTR) potentiator. It is specifically indicated for which class of CFTR mutation?",
      o: ["Class III gating mutations (such as G551D) where channel reaches membrane but fails to open", "Class I nonsense mutations with premature stop codons", "Class II misfolding mutations with absent membrane expression", "Class V promoter mutations with reduced transcript levels"],
      a: 0,
      exp: "Ivacaftor is a channel potentiator that binds CFTR at the cell surface and increases channel open probability; it is highly effective for Class III gating defects like G551D.",
      r: ["Correct. Ivacaftor acts as a potentiator for gating mutations such as G551D.", "Incorrect. Class I requires read-through agents.", "Incorrect. Class II (F508del) requires correctors (lumacaftor, tezacaftor, elexacaftor) to reach membrane.", "Incorrect. Class V requires splicing modulators."],
      kp: "Ivacaftor is a CFTR potentiator that locks open the channel pore, clinically indicated for Class III gating mutations such as G551D.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-078",
      q: "Which ABC transporter family member functions as the multi-drug resistance protein 1 (MDR1 / P-glycoprotein), actively pumping lipophilic chemotherapy agents out of neoplastic cells?",
      o: ["ABCB1", "ABCA1", "ABCC2", "ABCG5"],
      a: 0,
      exp: "ABCB1 encodes P-glycoprotein (MDR1), an ATP-dependent efflux pump with broad substrate specificity that exports lipophilic xenobiotics and chemotherapy drugs (anthracyclines, vinca alkaloids), causing drug resistance.",
      r: ["Correct. ABCB1 encodes P-glycoprotein (MDR1).", "Incorrect. ABCA1 exports cholesterol to ApoA-1 in Tangier disease.", "Incorrect. ABCC2 (MRP2) exports conjugated bilirubin in Dubin-Johnson syndrome.", "Incorrect. ABCG5/ABCG8 export plant sterols into bile."],
      kp: "ABCB1 (P-glycoprotein / MDR1) is an ATP-dependent efflux pump that extrudes lipophilic chemotherapeutics, driving multi-drug resistance in cancer.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-079",
      q: "Tangier disease is an autosomal recessive disorder caused by mutations in which ATP-binding cassette transporter, resulting in virtually absent plasma HDL and orange tonsils?",
      o: ["ABCA1", "ABCB4", "ABCG8", "CFTR"],
      a: 0,
      exp: "ABCA1 mediates the efflux of cellular cholesterol and phospholipids to lipid-poor apolipoprotein A-1. ABCA1 mutations prevent nascent HDL formation, causing rapid ApoA-1 catabolism, near-zero HDL, and lipid accumulation in reticuloendothelial tissues.",
      r: ["Correct. ABCA1 mutations cause Tangier disease with absent HDL and orange tonsils.", "Incorrect. ABCB4 (MDR3) flippase pumps phosphatidylcholine into bile.", "Incorrect. ABCG8 exports sitosterol.", "Incorrect. CFTR is an epithelial chloride channel."],
      kp: "Tangier disease results from ABCA1 mutations impairing cholesterol efflux to ApoA-1, manifesting with absent HDL, enlarged orange tonsils, and hepatosplenomegaly.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-080",
      q: "Dubin-Johnson syndrome is an autosomal recessive benign conjugated hyperbilirubinemia caused by a mutation in which canalicular transporter, preventing bilirubin glucuronide excretion into bile?",
      o: ["ABCC2 (MRP2)", "OATP1B1", "SLC10A1 (NTCP)", "BSEP (ABCB11)"],
      a: 0,
      exp: "ABCC2 (multidrug resistance-associated protein 2, MRP2) exports bilirubin diglucuronide across the hepatocyte canalicular membrane into bile. Mutation causes conjugated hyperbilirubinemia and a black liver due to melanin-like pigment.",
      r: ["Correct. ABCC2 (MRP2) deficiency causes Dubin-Johnson syndrome with a black liver.", "Incorrect. OATP1B1 mediates sinusoidal bilirubin uptake from blood.", "Incorrect. NTCP takes up bile salts from portal blood.", "Incorrect. BSEP pumps bile salts into bile."],
      kp: "Dubin-Johnson syndrome is caused by ABCC2 (MRP2) canalicular transporter mutations, causing conjugated hyperbilirubinemia and grossly black liver pigmentation.",
      img: [], d: 2, cog: "recall"
    }
  ],

  // Module 5: bio-oxygen-transport
  "bio-oxygen-transport": [
    {
      id: "bk-bio-081",
      q: "What structural mechanism accounts for positive cooperativity in hemoglobin as oxygen binds sequentially to its four heme subunits?",
      o: ["Oxygen binding pulls iron into the porphyrin plane, tilting the proximal histidine and rotating alpha-beta dimers to disrupt salt bridges", "Binding of oxygen to myoglobin stimulates cross-talk via circulating hormones", "Oxygen oxidizes ferrous iron (Fe2+) to ferric iron (Fe3+) in each subunit", "Oxygen binds the central cavity, displacing 2,3-BPG from all four globin chains simultaneously"],
      a: 0,
      exp: "In the deoxygenated T-state, Fe2+ lies ~0.4 angstroms out of the porphyrin plane. Oxygen binding pulls Fe2+ into the plane, shifting the F-helix and proximal histidine-F8, rotating alpha-beta dimers 15 degrees and breaking salt bridges into the high-affinity R-state.",
      r: ["Correct. Iron movement into the porphyrin plane triggers dimer rotation into the R-state.", "Incorrect. Myoglobin does not communicate with hemoglobin.", "Incorrect. Iron must remain in the reduced ferrous Fe2+ state for reversible oxygen binding.", "Incorrect. 2,3-BPG displacement occurs as central cavity narrows, but iron movement initiates the shift."],
      kp: "Oxygen binding pulls ferrous iron into the protoporphyrin ring plane, tilting proximal histidine-F8 and transitioning hemoglobin from the tense T-state to the relaxed R-state.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-082",
      q: "Which change in physiological parameters will shift the oxygen-hemoglobin dissociation curve to the RIGHT, increasing tissue oxygen unloading?",
      o: ["Increased temperature, elevated 2,3-BPG, decreased pH (acidosis), and increased PaCO2", "Decreased temperature, low 2,3-BPG, alkalosis, and low PaCO2", "Presence of carbon monoxide and fetal hemoglobin", "Hypothermia and hypophosphatemia"],
      a: 0,
      exp: "Right-shift (increased P50, decreased affinity) occurs during exercise and metabolic demand, driven by the 'CADET, face Right' factors: CO2, Acidity/H+, 2,3-DPG, Exercise, and Temperature.",
      r: ["Correct. Hyperthermia, elevated 2,3-BPG, acidosis, and hypercapnia all shift the curve rightward.", "Incorrect. These factors shift the curve to the left.", "Incorrect. CO and HbF shift the curve to the left.", "Incorrect. Hypothermia causes a left shift."],
      kp: "The oxygen-hemoglobin curve shifts rightward (increasing P50 and tissue delivery) in response to acidosis, hypercapnia, hyperthermia, and elevated 2,3-BPG.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-083",
      q: "Why does fetal hemoglobin (HbF, alpha2-gamma2) possess a significantly higher oxygen affinity (lower P50) than adult hemoglobin (HbA, alpha2-beta2)?",
      o: ["Gamma globin chains substitute serine for positively charged histidine at position 143, reducing 2,3-BPG binding affinity", "Gamma chains contain four heme rings instead of one per subunit", "HbF remains permanently locked in the R-state and cannot adopt the T-state", "Fetal red blood cells lack glycolytic enzymes and cannot synthesize 2,3-BPG"],
      a: 0,
      exp: "Adult beta chains have histidine-143 facing the central cavity, forming ionic bonds with negative 2,3-BPG. Gamma chains replace this with neutral serine-143, dramatically weakening 2,3-BPG binding and shifting the HbF curve leftward.",
      r: ["Correct. Gamma chains replace histidine-143 with serine, lowering 2,3-BPG binding affinity.", "Incorrect. Each globin chain contains exactly one heme ring.", "Incorrect. HbF adopts both T and R conformations.", "Incorrect. Fetal red cells synthesize normal 2,3-BPG levels, but HbF does not bind it well."],
      kp: "Fetal hemoglobin (HbF) has higher oxygen affinity than HbA because its gamma chains substitute serine for histidine-143, reducing 2,3-BPG binding.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-084",
      q: "A firefighter rescued from a building fire is brought to the emergency department with confusion and cherry-red lips. Pulse oximetry reads 99%, but arterial blood gas co-oximetry reveals 35% carboxyhemoglobin. How does carbon monoxide alter hemoglobin oxygen delivery?",
      o: ["Binds heme with 200-fold higher affinity than oxygen and shifts the remaining oxyhemoglobin subunits to the LEFT, preventing tissue unloading", "Binds the central cavity and right-shifts the curve, dumping oxygen prematurely", "Converts ferrous iron (Fe2+) to ferric iron (Fe3+), preventing any oxygen binding", "Cleaves globin alpha and beta chains, destroying the tetramer"],
      a: 0,
      exp: "Carbon monoxide binds heme with ~200-250x higher affinity than oxygen. When CO binds one or more subunits, it traps hemoglobin in the high-affinity R-state, shifting the dissociation curve to the left and severely impairing oxygen release in peripheral tissues.",
      r: ["Correct. CO binds heme with 200x affinity and induces a severe left-shift that halts tissue unloading.", "Incorrect. CO causes a left shift, not a right shift.", "Incorrect. Fe2+ oxidation to Fe3+ is methemoglobinemia, not carboxyhemoglobin.", "Incorrect. The globin chains remain intact."],
      kp: "Carbon monoxide binds heme with 200-fold higher affinity and locks hemoglobin into the high-affinity R-state, causing a severe left-shift that paralyzes tissue oxygen delivery.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-085",
      q: "Following administration of topical benzocaine for an endoscopy, a patient develops cyanosis that does not improve with 100% oxygen. Blood drawn appears chocolate-brown. What is the molecular mechanism?",
      o: ["Oxidation of heme ferrous iron (Fe2+) to ferric iron (Fe3+), forming methemoglobin which cannot bind oxygen", "Covalent carbamylation of beta globin terminal amino groups", "Competitive displacement of oxygen by benzocaine molecules at the heme iron", "Massive hemolysis secondary to glucose-6-phosphate dehydrogenase consumption"],
      a: 0,
      exp: "Benzocaine and dapsone oxidize heme iron from ferrous (Fe2+) to ferric (Fe3+), producing methemoglobin. Ferric iron cannot bind oxygen, and it allosterically shifts remaining ferrous hemes to the left, worsening tissue hypoxia.",
      r: ["Correct. Oxidation of Fe2+ to Fe3+ generates methemoglobin, creating chocolate-brown blood and cyanosis.", "Incorrect. Carbamylation is associated with chronic uremia.", "Incorrect. Benzocaine is an oxidant, not a heme ligand.", "Incorrect. Hemolysis is secondary; methemoglobinemia is the direct enzymopathy."],
      kp: "Oxidation of heme iron from Fe2+ to Fe3+ forms methemoglobin, which cannot bind oxygen and produces refractory cyanosis with chocolate-brown blood.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-086",
      q: "What is the primary treatment for symptomatic or severe (>20-30%) acquired methemoglobinemia?",
      o: ["Intravenous methylene blue", "100% hyperbaric oxygen alone", "Intravenous deferoxamine", "Intravenous calcium gluconate"],
      a: 0,
      exp: "Methylene blue is the specific antidote; it acts as an electron acceptor and donor, being reduced by NADPH-methemoglobin reductase to leukomethylene blue, which then reduces ferric Fe3+ back to functional ferrous Fe2+.",
      r: ["Correct. Methylene blue acts via NADPH-dependent reductase to convert Fe3+ back to Fe2+.", "Incorrect. Oxygen alone cannot reduce ferric iron.", "Incorrect. Deferoxamine chelates free iron, not heme.", "Incorrect. Calcium gluconate treats hyperkalemia or hypocalcemia."],
      kp: "Methylene blue is the antidote for methemoglobinemia, functioning as an artificial cofactor to reduce ferric Fe3+ back to ferrous Fe2+.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-087",
      q: "The Haldane effect describes which reciprocal property of hemoglobin in the pulmonary and systemic microcirculation?",
      o: ["Deoxygenation of hemoglobin increases its capacity to carry carbon dioxide, while oxygenation in lungs promotes CO2 release", "Acidosis decreases hemoglobin affinity for oxygen in peripheral capillaries", "2,3-BPG binding directly displaces carbon dioxide from globin amino termini", "Carbon monoxide binding displaces nitric oxide from vascular endothelium"],
      a: 0,
      exp: "The Haldane effect states that deoxygenated hemoglobin has higher affinity for CO2 (as carbaminohemoglobin) and protons than oxyhemoglobin. In the lungs, oxygen binding displaces CO2 and protons, facilitating CO2 expiration.",
      r: ["Correct. Deoxygenation enhances CO2 carriage, while oxygenation promotes CO2 discharge.", "Incorrect. Acidosis right-shifting oxygen affinity is the Bohr effect.", "Incorrect. 2,3-BPG does not bind amino-terminal carbamate sites.", "Incorrect. Nitric oxide transport is a distinct phenomenon."],
      kp: "The Haldane effect describes how oxygenation of hemoglobin in the pulmonary capillaries displaces carbon dioxide and protons, driving CO2 expiration.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-088",
      q: "In what chemical form is the vast majority (approximately 70-80%) of carbon dioxide transported from peripheral tissues to the lungs in human blood?",
      o: ["Bicarbonate ions (HCO3-) dissolved in plasma", "Carbaminohemoglobin bound to globin amino groups", "Dissolved free carbon dioxide gas in physical solution", "Carbonic acid molecules inside red blood cells"],
      a: 0,
      exp: "Approximately 70-80% of CO2 is converted inside red cells by carbonic anhydrase into carbonic acid, which dissociates into protons and bicarbonate; bicarbonate is then exchanged for chloride into plasma via AE1.",
      r: ["Correct. Bicarbonate in plasma accounts for 70-80% of CO2 transport.", "Incorrect. Carbaminohemoglobin accounts for about 15-20%.", "Incorrect. Dissolved gas accounts for only 5-10%.", "Incorrect. Carbonic acid is an unstable transient intermediate."],
      kp: "The majority of blood carbon dioxide (~70-80%) is transported as plasma bicarbonate, generated inside red cells by carbonic anhydrase and exported by the chloride shift.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-089",
      q: "What is the purpose of the 'chloride shift' (Hamburger phenomenon) mediated by anion exchanger 1 (AE1 / Band 3) across the erythrocyte membrane in systemic capillary beds?",
      o: ["Maintains electrical neutrality as intracellular bicarbonate is exported to plasma in exchange for chloride", "Pumps chloride into lysosomes to activate acid hydrolases", "Exchanges sodium for chloride to maintain cell volume", "Imports chloride to displace 2,3-BPG from the central cavity"],
      a: 0,
      exp: "As carbonic anhydrase generates bicarbonate in red cells, bicarbonate is exported into plasma down its gradient. To maintain electrical neutrality, AE1 imports one chloride ion for every bicarbonate exported (the chloride shift).",
      r: ["Correct. AE1 exchanges internal bicarbonate for external chloride to preserve electrical neutrality.", "Incorrect. Red cells lack lysosomes.", "Incorrect. AE1 transports anions (Cl-/HCO3-), not sodium.", "Incorrect. Chloride does not displace 2,3-BPG."],
      kp: "The chloride shift imports chloride into erythrocytes via AE1 (Band 3) to balance electrical charge as generated bicarbonate exits into venous plasma.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-090",
      q: "Why is methylene blue contraindicated as a treatment for methemoglobinemia in patients with known severe glucose-6-phosphate dehydrogenase (G6PD) deficiency?",
      o: ["Methylene blue reduction requires NADPH generated by G6PD; without it, methylene blue is ineffective and acts as an oxidant inducing hemolysis", "Methylene blue binds and permanently inactivates pyruvate kinase", "G6PD deficiency causes baseline alkalosis that precipitates methylene blue crystals", "It inhibits the renal clearance of methylene blue, causing neurotoxicity"],
      a: 0,
      exp: "Methylene blue requires NADPH from G6PD to be converted by NADPH-methemoglobin reductase into leukomethylene blue. In G6PD deficiency, NADPH is absent, so methylene blue fails to work and its oxidized form triggers acute hemolysis.",
      r: ["Correct. Without G6PD-derived NADPH, methylene blue cannot be activated and triggers severe oxidative hemolysis.", "Incorrect. It does not inhibit pyruvate kinase.", "Incorrect. G6PD deficiency does not cause systemic alkalosis.", "Incorrect. Neurotoxicity is related to serotonin syndrome, but hemolysis is the primary danger."],
      kp: "Methylene blue requires G6PD-generated NADPH for reduction; in G6PD deficiency it is ineffective and precipitates catastrophic acute hemolytic anemia.",
      img: [], d: 2, cog: "application"
    }
  ],

  // Module 6: bio-enzymes-kinetics
  "bio-enzymes-kinetics": [
    {
      id: "bk-bio-091",
      q: "In Michaelis-Menten enzyme kinetics, what does the parameter Km represent?",
      o: ["The substrate concentration at which the reaction velocity is half of Vmax", "The maximum velocity achievable at infinite substrate concentration", "The turnover number of substrate molecules per active site per second", "The equilibrium constant for the forward chemical reaction"],
      a: 0,
      exp: "Km (the Michaelis constant) is mathematically defined as the substrate concentration [S] at which the initial velocity v0 equals Vmax/2. It serves as an inverse measure of enzyme-substrate affinity.",
      r: ["Correct. Km is the substrate concentration at half-maximal velocity.", "Incorrect. Vmax is the velocity at saturating substrate.", "Incorrect. Kcat is the turnover number.", "Incorrect. Keq is the thermodynamic equilibrium constant."],
      kp: "Km is the substrate concentration required to achieve half-maximal velocity (Vmax/2); a lower Km indicates higher enzyme-substrate affinity.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-092",
      q: "How does a reversible competitive inhibitor alter the kinetic parameters of an enzyme on a Lineweaver-Burk double-reciprocal plot?",
      o: ["Increases apparent Km (x-intercept shifts closer to origin) while Vmax remains unchanged (y-intercept unchanged)", "Decreases Vmax (y-intercept shifts upward) while Km remains unchanged", "Decreases both Km and Vmax with parallel lines", "Decreases Km while increasing Vmax"],
      a: 0,
      exp: "Competitive inhibitors compete with substrate for the active site. Saturating substrate concentrations displace the inhibitor, reaching normal Vmax (1/Vmax unchanged). However, higher substrate is needed, raising apparent Km (-1/Km shifts toward 0).",
      r: ["Correct. Competitive inhibitors increase apparent Km while leaving Vmax unchanged.", "Incorrect. Lowering Vmax with unchanged Km describes noncompetitive inhibition.", "Incorrect. Decreasing both Km and Vmax describes uncompetitive inhibition.", "Incorrect. This combination does not occur in simple reversible inhibition."],
      kp: "Competitive inhibitors increase apparent Km without changing Vmax; on Lineweaver-Burk plots, lines intersect on the y-axis at 1/Vmax.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-093",
      q: "Statins (e.g., atorvastatin) reduce plasma LDL cholesterol by acting as which kinetic class of inhibitor against HMG-CoA reductase?",
      o: ["Reversible competitive inhibitor", "Irreversible suicide inhibitor", "Pure noncompetitive inhibitor", "Uncompetitive inhibitor"],
      a: 0,
      exp: "Statins possess a bulky hydrophobic group and a dihydroxyheptanoic acid moiety structurally mimicking the HMG intermediate of HMG-CoA, competitively binding the catalytic active site of HMG-CoA reductase.",
      r: ["Correct. Statins are structural analogues that competitively inhibit HMG-CoA reductase.", "Incorrect. Suicide inhibitors covalently inactivate enzymes irreversibly (e.g., aspirin on COX-1).", "Incorrect. Noncompetitive inhibitors bind allosteric sites.", "Incorrect. Uncompetitive inhibitors bind only the ES complex."],
      kp: "Statins are competitive reversible inhibitors of HMG-CoA reductase, structurally mimicking the 3-hydroxy-3-methylglutaryl substrate.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-094",
      q: "How does a noncompetitive (allosteric) inhibitor alter the kinetic parameters of an enzyme?",
      o: ["Decreases Vmax without altering Km", "Increases Km without altering Vmax", "Decreases both Km and Vmax proportionally", "Increases both Km and Vmax"],
      a: 0,
      exp: "Noncompetitive inhibitors bind an allosteric site on both free enzyme and enzyme-substrate complex with equal affinity. Because they do not compete with substrate, Km is unchanged; however, they impair catalysis, lowering Vmax.",
      r: ["Correct. Pure noncompetitive inhibitors decrease Vmax while keeping Km constant.", "Incorrect. Increasing Km with unchanged Vmax is competitive inhibition.", "Incorrect. Decreasing both proportionally is uncompetitive inhibition.", "Incorrect. This is not observed in noncompetitive inhibition."],
      kp: "Noncompetitive inhibitors decrease Vmax without changing Km; on Lineweaver-Burk plots, lines intersect on the x-axis at -1/Km.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-095",
      q: "Aspirin exerts its antiplatelet effect for the entire 7 to 10 day lifespan of circulating platelets through which mechanism?",
      o: ["Irreversible covalent acetylation of a serine residue (Ser-529) in the active site of cyclooxygenase-1 (COX-1)", "Reversible competitive inhibition of COX-2", "Allosteric noncompetitive inhibition of thromboxane synthase", "Inhibition of phosphodiesterase-3"],
      a: 0,
      exp: "Aspirin transfers its acetyl group to Ser-529 in platelet COX-1, permanently blocking arachidonic acid access. Because anucleate platelets cannot synthesize new protein, COX-1 remains inactivated for the platelet's lifespan.",
      r: ["Correct. Aspirin covalently acetylates Ser-529 in COX-1 irreversibly.", "Incorrect. Aspirin's antiplatelet action is irreversible and primarily targets COX-1.", "Incorrect. It does not inhibit thromboxane synthase directly.", "Incorrect. Cilostazol inhibits PDE-3, not aspirin."],
      kp: "Aspirin irreversibly acetylates Ser-529 in platelet COX-1, permanently abolishing thromboxane A2 production for the 7-10 day lifespan of the platelet.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-096",
      q: "Why does hepatic glucokinase (hexokinase IV) possess a high Km (~10 mM) compared to extrahepatic hexokinase I (Km <0.1 mM)?",
      o: ["Enables the liver to clear glucose and synthesize glycogen only when portal blood glucose is high after meals", "Ensures the liver traps all glucose during fasting hypoglycemia", "Prevents the liver from synthesizing fatty acids", "Allows hepatocytes to export glucose-6-phosphate directly into blood"],
      a: 0,
      exp: "Glucokinase has a high Km (~10 mM) corresponding to postprandial portal glucose concentrations. It is not inhibited by glucose-6-phosphate, allowing hepatocytes to remove large glucose loads after meals without saturating.",
      r: ["Correct. High Km ensures glucokinase phosphorylates glucose primarily during postprandial hyperglycemia.", "Incorrect. Extrahepatic hexokinase has low Km to trap glucose during fasting.", "Incorrect. Glucokinase promotes fatty acid synthesis from excess glucose.", "Incorrect. G6P must be hydrolyzed by G6Pase to exit hepatocytes."],
      kp: "Hepatic glucokinase has a high Km (~10 mM) and lacks product inhibition, functioning as a postprandial glucose sensor and gatekeeper for glycogen and lipid synthesis.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-097",
      q: "In an uncompetitive inhibition model, the inhibitor binds exclusively to which species, causing parallel lines on a Lineweaver-Burk plot?",
      o: ["The enzyme-substrate (ES) complex only", "The free enzyme (E) only", "Both free enzyme and ES complex with equal affinity", "The product-enzyme complex"],
      a: 0,
      exp: "Uncompetitive inhibitors bind only to the enzyme-substrate complex. This shifts the equilibrium to favor substrate binding (decreasing apparent Km) while inactivating the complex (decreasing Vmax) by the same ratio, producing parallel lines.",
      r: ["Correct. Uncompetitive inhibitors bind exclusively to the ES complex, reducing both Km and Vmax.", "Incorrect. Binding free enzyme only is competitive inhibition.", "Incorrect. Binding both equally is pure noncompetitive inhibition.", "Incorrect. Product inhibition is distinct."],
      kp: "Uncompetitive inhibitors bind exclusively to the enzyme-substrate (ES) complex, decreasing both Km and Vmax proportionally and yielding parallel Lineweaver-Burk lines.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-098",
      q: "What kinetic term represents the catalytic efficiency of an enzyme, accounting for both substrate affinity and catalytic turnover?",
      o: ["Kcat / Km", "Vmax / Km", "1 / Km", "Km / Kcat"],
      a: 0,
      exp: "The specificity constant, defined as Kcat / Km, reflects catalytic efficiency at low substrate concentrations, measuring both how rapidly the enzyme turns over substrate (Kcat) and how well it binds (1/Km).",
      r: ["Correct. Kcat/Km is the specificity constant defining overall catalytic efficiency.", "Incorrect. Vmax/Km reflects initial slope but depends on enzyme concentration.", "Incorrect. 1/Km reflects only affinity.", "Incorrect. Km/Kcat is the reciprocal."],
      kp: "Catalytic efficiency is measured by the specificity constant Kcat/Km, representing the rate of catalytic turnover relative to substrate affinity.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-099",
      q: "Allosteric enzymes typically display which type of velocity-versus-substrate curve, reflecting cooperative subunit interactions rather than simple Michaelis-Menten kinetics?",
      o: ["Sigmoidal (S-shaped) curve", "Hyperbolic curve", "Linear straight line", "Exponential logarithmic curve"],
      a: 0,
      exp: "Allosteric enzymes with multiple interacting catalytic subunits (e.g., PFK-1, aspartate transcarbamoylase) exhibit sigmoidal (S-shaped) saturation curves due to positive or negative cooperativity.",
      r: ["Correct. Allosteric enzymes display sigmoidal velocity curves due to cooperativity.", "Incorrect. Hyperbolic curves characterize non-cooperative Michaelis-Menten enzymes.", "Incorrect. Linear curves indicate zero-order or simple first-order ranges.", "Incorrect. Logarithmic curves do not represent raw velocity plots."],
      kp: "Allosteric enzymes display sigmoidal (S-shaped) substrate saturation curves reflecting cooperative transitions between tense and relaxed states.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-100",
      q: "A Lineweaver-Burk plot of an enzymatic reaction reveals an x-intercept of -0.2 mM^-1 and a y-intercept of 0.05 (micromol/min)^-1. What are the Km and Vmax of this enzyme?",
      o: ["Km = 5.0 mM, Vmax = 20 micromol/min", "Km = 0.2 mM, Vmax = 0.05 micromol/min", "Km = 2.0 mM, Vmax = 10 micromol/min", "Km = 5.0 mM, Vmax = 0.05 micromol/min"],
      a: 0,
      exp: "x-intercept = -1/Km = -0.2 mM^-1 -> Km = 1 / 0.2 = 5.0 mM. y-intercept = 1/Vmax = 0.05 -> Vmax = 1 / 0.05 = 20 micromol/min.",
      r: ["Correct. Km = -1/(-0.2) = 5.0 mM; Vmax = 1/0.05 = 20 micromol/min.", "Incorrect. These are the un-inverted raw intercept values.", "Incorrect. Mathematical calculation error.", "Incorrect. Vmax was not inverted."],
      kp: "On Lineweaver-Burk plots, Km equals -1 divided by the x-intercept, and Vmax equals 1 divided by the y-intercept.",
      img: [], d: 2, cog: "application"
    }
  ],

  // Module 7: bio-vitamins-minerals
  "bio-vitamins-minerals": [
    {
      id: "bk-bio-101",
      q: "A chronic alcoholic presents with acute confusion, bilateral sixth nerve palsies, and ataxia. Administration of intravenous thiamine improves the ophthalmoplegia. What erythrocyte assay confirms thiamine deficiency?",
      o: ["Erythrocyte transketolase activity increase upon adding TPP", "Erythrocyte glutathione reductase activation by FAD", "Plasma methylmalonic acid elevation", "Serum transaminase activity assay"],
      a: 0,
      exp: "Thiamine deficiency is diagnostically confirmed by measuring erythrocyte transketolase activity before and after adding thiamine pyrophosphate (TPP). An activity increase >15-25% confirms deficiency.",
      r: ["Correct. Erythrocyte transketolase activation by TPP is the diagnostic gold standard.", "Incorrect. Glutathione reductase activation by FAD tests for riboflavin (B2) deficiency.", "Incorrect. Methylmalonic acid tests for vitamin B12 deficiency.", "Incorrect. Transaminases test for B6 or liver injury."],
      kp: "Erythrocyte transketolase activity stimulated by exogenous thiamine pyrophosphate confirms thiamine (vitamin B1) deficiency.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-102",
      q: "A patient presenting with pellagra (photosensitive dermatitis, diarrhea, and cognitive dementia) is found to have a diet deficient in niacin. Which amino acid can endogenously synthesize niacin in the liver using vitamin B6 as a cofactor?",
      o: ["Tryptophan", "Tyrosine", "Phenylalanine", "Methionine"],
      a: 0,
      exp: "Approximately 60 mg of dietary tryptophan can be converted into 1 mg of niacin (nicotinic acid). This pathway requires pyridoxal phosphate (B6) and riboflavin (B2); defects in tryptophan absorption (Hartnup disease) also cause pellagra.",
      r: ["Correct. Tryptophan is the dietary precursor converted to niacin.", "Incorrect. Tyrosine synthesizes catecholamines and melanin.", "Incorrect. Phenylalanine is converted to tyrosine.", "Incorrect. Methionine enters the SAM cycle."],
      kp: "Dietary tryptophan is converted to niacin (vitamin B3) at a 60:1 ratio in a pathway requiring pyridoxal phosphate (B6) as a cofactor.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-103",
      q: "Warfarin anticoagulation is monitored via the prothrombin time (INR). Warfarin exerts its therapeutic effect by inhibiting which enzyme required for vitamin K recycling?",
      o: ["Vitamin K epoxide reductase (VKORC1)", "Gamma-glutamyl carboxylase", "Cytochrome P450 2C9", "Prothrombinase complex"],
      a: 0,
      exp: "Warfarin competitively inhibits VKORC1, preventing reduction of vitamin K epoxide back to active hydroquinone. Lacking reduced vitamin K, gamma-glutamyl carboxylase cannot carboxylate clotting factors II, VII, IX, and X.",
      r: ["Correct. Warfarin inhibits vitamin K epoxide reductase (VKORC1).", "Incorrect. Gamma-glutamyl carboxylase uses reduced vitamin K; warfarin inhibits the reductase.", "Incorrect. CYP2C9 metabolizes warfarin.", "Incorrect. Prothrombinase is the Factor Xa/Va clotting complex."],
      kp: "Warfarin inhibits vitamin K epoxide reductase (VKORC1), blocking generation of reduced vitamin K required for gamma-carboxylation of factors II, VII, IX, and X.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-104",
      q: "A strict vegan of 6 years develops paresthesias in the feet, loss of vibratory sense, spastic gait, and macrocytic anemia. What laboratory finding differentiates vitamin B12 deficiency from folate deficiency?",
      o: ["Elevated serum methylmalonic acid (MMA)", "Elevated serum homocysteine", "Hypersegmented neutrophils on peripheral smear", "Macrocytic RBCs with MCV >100 fL"],
      a: 0,
      exp: "Both B12 and folate deficiencies cause megaloblastic anemia, hypersegmented neutrophils, and elevated homocysteine. However, methylmalonic acid is elevated ONLY in B12 deficiency because B12 is cofactor for methylmalonyl-CoA mutase.",
      r: ["Correct. Methylmalonic acid is elevated only in B12 deficiency, distinguishing it from folate deficiency.", "Incorrect. Homocysteine is elevated in both B12 and folate deficiencies.", "Incorrect. Hypersegmented neutrophils occur in both.", "Incorrect. Macrocytosis occurs in both."],
      kp: "Elevated methylmalonic acid (MMA) is specific for vitamin B12 deficiency, differentiating it from folate deficiency which features normal MMA.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-105",
      q: "Why does administration of high-dose folic acid alone in a patient with undiagnosed vitamin B12 deficiency correct the anemia while permitting irreversible neurological subacute combined degeneration to progress?",
      o: ["Folate bypasses the methyl-THF trap to restore thymidylate synthesis for erythropoiesis but cannot rescue B12-dependent methylmalonyl-CoA mutase in myelin", "Folic acid directly neurotoxic to dorsal spinal columns", "Folic acid inhibits cobalamin uptake in the ileum", "Folate accelerates myelin degradation by activating microglia"],
      a: 0,
      exp: "Folate supplies dihydrofolate directly, bypassing the B12-dependent methionine synthase step to rescue thymidylate synthesis and resolve macrocytic anemia. However, methylmalonyl-CoA mutase remains inactive, allowing myelin damage to progress undetected.",
      r: ["Correct. Folate bypasses the trap to cure anemia but leaves myelin-damaging B12 deficiency untreated.", "Incorrect. Folate is not neurotoxic.", "Incorrect. It does not block ileal B12 uptake.", "Incorrect. Folate does not activate microglia to destroy myelin."],
      kp: "Folate supplementation masks vitamin B12 deficiency by resolving megaloblastic anemia while subacute combined spinal cord degeneration progresses unchecked.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-106",
      q: "An infant born with periorificial and acral vesiculobullous and pustular dermatitis, chronic diarrhea, and alopecia is diagnosed with acrodermatitis enteropathica. Which trace element is deficient due to an intestinal transporter defect?",
      o: ["Zinc (SLC39A4 / ZIP4 mutation)", "Copper", "Selenium", "Chromium"],
      a: 0,
      exp: "Acrodermatitis enteropathica is an autosomal recessive mutation in SLC39A4 (ZIP4), the intestinal zinc uptake transporter. Zinc deficiency causes periorificial rashes, alopecia, diarrhea, and immune dysfunction.",
      r: ["Correct. Zinc deficiency causes acrodermatitis enteropathica.", "Incorrect. Copper deficiency causes Menkes disease (kinky hair, arterial aneurysms).", "Incorrect. Selenium deficiency causes Keshan cardiomyopathy.", "Incorrect. Chromium deficiency causes glucose intolerance."],
      kp: "Acrodermatitis enteropathica is caused by SLC39A4 mutations impairing intestinal zinc absorption, manifesting with periorificial rashes, alopecia, and diarrhea.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-107",
      q: "Menkes disease is an X-linked recessive disorder of copper metabolism caused by mutations in ATP7A. Defective activity of which copper-dependent enzyme accounts for brittle, sparse, kinky hair ('pili torti') and arterial aneurysms?",
      o: ["Lysyl oxidase", "Cytochrome c oxidase", "Superoxide dismutase 1", "Tyrosinase"],
      a: 0,
      exp: "ATP7A defect impairs copper export from enterocytes into blood. Lacking systemic copper, lysyl oxidase cannot crosslink collagen and elastin, causing tortuous arteries, aneurysms, bone fractures, and pili torti.",
      r: ["Correct. Lysyl oxidase requires copper; its inactivity causes connective tissue and vascular defects.", "Incorrect. Cytochrome c oxidase defect causes muscle hypotonia.", "Incorrect. SOD1 defect causes motor neuron disease.", "Incorrect. Tyrosinase failure causes albinism."],
      kp: "Menkes disease (ATP7A mutation) causes systemic copper deficiency; inactive copper-dependent lysyl oxidase impairs collagen crosslinking, causing arterial aneurysms and kinky hair.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-108",
      q: "Keshan disease is an endemic juvenile cardiomyopathy described in areas of rural China with low soil content of which trace mineral, an essential component of glutathione peroxidase?",
      o: ["Selenium", "Molybdenum", "Manganese", "Iodine"],
      a: 0,
      exp: "Selenium is incorporated as selenocysteine into glutathione peroxidase, an essential antioxidant enzyme protecting myocardium against coxackievirus-induced oxidative injury in Keshan disease.",
      r: ["Correct. Selenium deficiency causes Keshan cardiomyopathy.", "Incorrect. Molybdenum is required for xanthine oxidase and sulfite oxidase.", "Incorrect. Manganese is in mitochondrial SOD2.", "Incorrect. Iodine is required for thyroid hormones."],
      kp: "Selenium deficiency impairs selenocysteine-containing glutathione peroxidase, precipitating Keshan dilated cardiomyopathy.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-109",
      q: "Which fat-soluble vitamin acts primarily as a chain-breaking lipophilic antioxidant, intercalating into membrane phospholipid bilayers to scavenge peroxyl free radicals and protect polyunsaturated lipids?",
      o: ["Vitamin E (alpha-tocopherol)", "Vitamin A (retinol)", "Vitamin D (cholecalciferol)", "Vitamin K (phylloquinone)"],
      a: 0,
      exp: "Vitamin E (alpha-tocopherol) is the principal lipid-soluble antioxidant in cellular membranes, reacting with lipid peroxyl radicals to terminate free radical chain reactions; deficiency causes hemolytic anemia and spinocerebellar ataxia.",
      r: ["Correct. Vitamin E is the primary chain-breaking antioxidant protecting membrane lipids.", "Incorrect. Vitamin A functions in vision and gene differentiation.", "Incorrect. Vitamin D regulates calcium homeostasis.", "Incorrect. Vitamin K mediates gamma-carboxylation."],
      kp: "Vitamin E (alpha-tocopherol) functions as a chain-breaking antioxidant in lipid bilayers, protecting polyunsaturated fatty acids from free radical peroxidation.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-110",
      q: "A patient undergoing long-term total parenteral nutrition without trace element supplementation develops severe glucose intolerance and peripheral neuropathy. Deficiency of which mineral cofactor for chromodulin is responsible?",
      o: ["Chromium", "Zinc", "Copper", "Manganese"],
      a: 0,
      exp: "Chromium functions as a cofactor in chromodulin (low-molecular-weight chromium-binding substance), which potentiates insulin receptor tyrosine kinase activity; deficiency causes insulin resistance and hyperglycemia.",
      r: ["Correct. Chromium potentiates insulin action; deficiency causes glucose intolerance.", "Incorrect. Zinc deficiency causes dermatitis and diarrhea.", "Incorrect. Copper deficiency causes microcytic anemia.", "Incorrect. Manganese deficiency causes impaired glycosaminoglycan synthesis."],
      kp: "Chromium deficiency in total parenteral nutrition impairs insulin receptor sensitivity, causing hyperglycemia, glucosuria, and peripheral neuropathy.",
      img: [], d: 2, cog: "recall"
    }
  ],

  // Module 8: bio-etc-oxphos
  "bio-etc-oxphos": [
    {
      id: "bk-bio-111",
      q: "Which multi-protein complex of the mitochondrial electron transport chain does NOT pump protons across the inner mitochondrial membrane into the intermembrane space?",
      o: ["Complex II (Succinate dehydrogenase)", "Complex I (NADH-ubiquinone oxidoreductase)", "Complex III (Cytochrome bc1 complex)", "Complex IV (Cytochrome c oxidase)"],
      a: 0,
      exp: "Complexes I, III, and IV pump protons outward into the intermembrane space (4, 4, and 2 protons per electron pair, respectively). Complex II transfers electrons from FADH2 to ubiquinone without pumping any protons.",
      r: ["Correct. Complex II does not pump protons across the inner mitochondrial membrane.", "Incorrect. Complex I pumps 4 protons per electron pair.", "Incorrect. Complex III pumps 4 protons per electron pair via the Q-cycle.", "Incorrect. Complex IV pumps 2 protons per electron pair."],
      kp: "Complex II (succinate dehydrogenase) transfers electrons from FADH2 to ubiquinone without pumping protons, yielding fewer ATP per FADH2 than NADH.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-112",
      q: "A patient presents with acute collapse, metabolic lactic acidosis, and a venous oxygen saturation of 92% after inhaling smoke from burning plastic. Cyanide poisoning is suspected. Which enzyme is inhibited by cyanide binding?",
      o: ["Cytochrome c oxidase (Complex IV)", "NADH dehydrogenase (Complex I)", "ATP synthase (Complex V)", "Pyruvate dehydrogenase"],
      a: 0,
      exp: "Cyanide binds tightly to ferric iron (Fe3+) in heme a3 of cytochrome c oxidase (Complex IV), blocking the terminal reduction of oxygen to water, which arrests electron transport and causes cellular hypoxia with high venous PO2.",
      r: ["Correct. Cyanide inhibits Complex IV by binding ferric heme a3.", "Incorrect. Rotenone inhibits Complex I.", "Incorrect. Oligomycin inhibits Complex V.", "Incorrect. Arsenic inhibits pyruvate dehydrogenase."],
      kp: "Cyanide inhibits cytochrome c oxidase (Complex IV), blocking oxygen reduction and causing severe cellular histotoxic hypoxia with high venous oxygen saturation.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-113",
      q: "How does 2,4-dinitrophenol (DNP) uncouple mitochondrial oxidative phosphorylation, and what clinical manifestation is characteristic of overdose?",
      o: ["Transports protons across the inner membrane collapsing the proton gradient; causes lethal hyperpyrexia and diaphoresis", "Inhibits Complex I, causing hypothermia and bradycardia", "Directly binds ATP synthase, stopping electron transport", "Inhibits cytochrome c oxidase, causing cyanosis"],
      a: 0,
      exp: "DNP is a lipophilic weak acid that picks up protons in the intermembrane space and diffuses across the inner membrane, discharging the proton gradient without ATP generation. Energy is released entirely as heat, causing severe hyperpyrexia.",
      r: ["Correct. DNP collapses the proton gradient, producing uncontrolled thermogenesis and hyperpyrexia.", "Incorrect. Complex I inhibition does not cause hyperpyrexia.", "Incorrect. Oligomycin binds ATP synthase, but it is an inhibitor, not an uncoupler.", "Incorrect. DNP does not inhibit Complex IV."],
      kp: "2,4-Dinitrophenol (DNP) uncouples the proton gradient from ATP synthase, accelerating electron transport and oxygen consumption while converting energy to lethal hyperthermia.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-114",
      q: "Oligomycin halts mitochondrial respiration in vitro by binding to which subunit of ATP synthase, blocking proton translocation back into the matrix?",
      o: ["F0 subunit transmembrane channel", "F1 catalytic alpha-beta headpiece", "Gamma central rotating shaft", "Delta stator stalk"],
      a: 0,
      exp: "Oligomycin binds to the c-subunit of the hydrophobic F0 domain in the inner membrane, blocking the proton channel. Without proton flow, F1 rotation stops, halting both ATP synthesis and electron transport in coupled mitochondria.",
      r: ["Correct. Oligomycin inhibits the F0 proton channel of ATP synthase.", "Incorrect. Aurovertin inhibits the F1 headpiece.", "Incorrect. Gamma stalk rotates inside F1.", "Incorrect. Delta stalk anchors F1 to F0."],
      kp: "Oligomycin inhibits the F0 proton channel of ATP synthase (Complex V), arresting both ATP synthesis and coupled electron transport.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-115",
      q: "What is the physiological function of uncoupling protein 1 (UCP1 / thermogenin) localized in the inner mitochondrial membrane of brown adipose tissue?",
      o: ["Provides a regulated proton leak into the matrix to generate heat for non-shivering thermogenesis", "Pumps protons outward to maximize ATP synthesis", "Exports fatty acids from brown fat into plasma", "Converts white adipose tissue into skeletal muscle"],
      a: 0,
      exp: "Thermogenin (UCP1) is an endogenous proton channel in brown adipocytes. Activated by free fatty acids under norepinephrine stimulation, it dissipates the proton gradient to produce heat for non-shivering thermogenesis in neonates.",
      r: ["Correct. UCP1 dissipates the proton gradient into the matrix to produce heat.", "Incorrect. It does not pump protons outward.", "Incorrect. It does not export fatty acids.", "Incorrect. It is expressed in brown and beige fat, not muscle."],
      kp: "Thermogenin (UCP1) in brown adipose tissue dissipates the mitochondrial proton gradient, generating heat for non-shivering thermogenesis in newborns.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-116",
      q: "Which specific chemical compound selectively inhibits electron transport at Complex III (cytochrome bc1 complex) by binding to the Qi site?",
      o: ["Antimycin A", "Rotenone", "Cyanide", "Carbon monoxide"],
      a: 0,
      exp: "Antimycin A inhibits Complex III (cytochrome bc1) by blocking the Qi quinone reduction site, preventing electron transfer from heme bH to ubiquinone.",
      r: ["Correct. Antimycin A inhibits Complex III at the Qi site.", "Incorrect. Rotenone inhibits Complex I.", "Incorrect. Cyanide inhibits Complex IV.", "Incorrect. Carbon monoxide inhibits Complex IV."],
      kp: "Antimycin A selectively inhibits Complex III (cytochrome bc1 complex), halting electron transfer through the Q-cycle.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-117",
      q: "Carbon monoxide inhibits cellular respiration by competing with oxygen for binding to reduced heme a3 in which respiratory complex?",
      o: ["Complex IV (Cytochrome c oxidase)", "Complex I (NADH dehydrogenase)", "Complex II (Succinate dehydrogenase)", "Complex III (Cytochrome bc1)"],
      a: 0,
      exp: "Carbon monoxide competes with molecular oxygen for binding to the reduced ferrous (Fe2+) heme a3-CuB binuclear center of Complex IV, inhibiting mitochondrial respiration alongside its carboxyhemoglobin effect.",
      r: ["Correct. CO inhibits Complex IV by competing with oxygen at heme a3.", "Incorrect. Complex I does not contain heme a3.", "Incorrect. Complex II transfers electrons from FAD to ubiquinone.", "Incorrect. Complex III contains hemes b and c1."],
      kp: "Carbon monoxide inhibits cytochrome c oxidase (Complex IV) by competing with oxygen at the reduced heme a3 center.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-118",
      q: "Rotenone, a natural botanical compound previously used as a pesticide, potently blocks mitochondrial respiration by inhibiting electron transfer in which complex?",
      o: ["Complex I (NADH-ubiquinone oxidoreductase)", "Complex II", "Complex III", "Complex IV"],
      a: 0,
      exp: "Rotenone (and piericidin A) inhibits Complex I by binding the ubiquinone reduction site, blocking electron transfer from iron-sulfur cluster N2 to coenzyme Q.",
      r: ["Correct. Rotenone inhibits Complex I.", "Incorrect. Complex II is inhibited by malonate.", "Incorrect. Complex III is inhibited by antimycin A.", "Incorrect. Complex IV is inhibited by cyanide and azide."],
      kp: "Rotenone blocks electron flow in Complex I (NADH dehydrogenase), preventing oxidation of NADH-linked substrates.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-119",
      q: "Which mobile electron carrier shuttles electrons between Complex III and Complex IV along the outer surface of the inner mitochondrial membrane?",
      o: ["Cytochrome c (water-soluble hemoprotein)", "Coenzyme Q (Ubiquinone)", "FAD", "Nicotinamide adenine dinucleotide (NADH)"],
      a: 0,
      exp: "Cytochrome c is a small, water-soluble peripheral membrane hemoprotein that shuttles electrons one at a time from Complex III (cytochrome c1) to Complex IV (CuA site) in the intermembrane space.",
      r: ["Correct. Cytochrome c is the mobile peripheral carrier shuttling electrons from Complex III to IV.", "Incorrect. Coenzyme Q is a lipid-soluble quinone shuttling from Complexes I/II to III.", "Incorrect. FAD is an enzyme-bound prosthetic group.", "Incorrect. NADH donates electrons to Complex I."],
      kp: "Cytochrome c is a water-soluble hemoprotein in the intermembrane space that shuttles electrons from Complex III to Complex IV.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-120",
      q: "Atractyloside is a toxic plant glycoside that arrests mitochondrial ATP synthesis. What transport mechanism does atractyloside inhibit?",
      o: ["Adenine nucleotide translocase (ANT, ADP/ATP antiporter)", "Phosphate carrier (Pi/H+ symporter)", "Voltage-dependent anion channel (VDAC)", "Pyruvate carrier"],
      a: 0,
      exp: "Atractyloside (and bongkrekic acid) inhibits the adenine nucleotide translocase (ANT) in the inner mitochondrial membrane, stopping export of newly made ATP into cytosol and import of ADP for phosphorylation.",
      r: ["Correct. Atractyloside inhibits the adenine nucleotide translocase (ANT).", "Incorrect. The phosphate carrier transports Pi.", "Incorrect. VDAC is on the outer membrane.", "Incorrect. The pyruvate carrier transports pyruvate into matrix."],
      kp: "Atractyloside inhibits the adenine nucleotide translocase (ANT), blocking ADP entry and ATP export across the inner mitochondrial membrane.",
      img: [], d: 2, cog: "recall"
    }
  ],

  // Module 9: bio-rbc-metabolism
  "bio-rbc-metabolism": [
    {
      id: "bk-bio-121",
      q: "Why do mature erythrocytes depend solely on the hexose monophosphate (HMP) shunt for maintaining reduced glutathione (GSH) reserves?",
      o: ["Red blood cells lack mitochondria and have no alternative pathway (e.g., malic enzyme or isocitrate DH) to generate NADPH", "Erythrocytes synthesize glutathione only inside the nucleus", "Glutathione reductase can use NADH in red cells but prefers NADPH", "Glycolytic pyruvate kinase inhibits glutathione peroxidase"],
      a: 0,
      exp: "Erythrocytes lack nuclei, ribosomes, and mitochondria. Because mitochondrial and cytoplasmic malic enzymes are absent, glucose-6-phosphate dehydrogenase (G6PD) in the HMP shunt is the sole cellular source of NADPH required to reduce GSSG back to GSH.",
      r: ["Correct. Lacking mitochondria, red cells depend exclusively on G6PD for NADPH generation.", "Incorrect. Red cells are anucleate.", "Incorrect. Glutathione reductase has absolute specificity for NADPH.", "Incorrect. Pyruvate kinase does not inhibit antioxidant enzymes."],
      kp: "Mature erythrocytes depend exclusively on G6PD in the HMP shunt for NADPH because they lack mitochondria and alternative NADPH-generating enzymes.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-122",
      q: "A 24-year-old man takes primaquine before traveling to an endemic malaria zone. Three days later, he develops dark tea-colored urine, jaundice, and fatigue. Supravital staining of peripheral blood shows Heinz bodies. What do Heinz bodies consist of?",
      o: ["Precipitated aggregates of denatured hemoglobin crosslinked by disulfide bonds", "Aggregates of ribosomal RNA and polyribosomes", "Nuclear chromatin remnants (Howell-Jolly bodies)", "Iron-rich sideroblastic granules"],
      a: 0,
      exp: "Under oxidative stress in G6PD-deficient erythrocytes, depleted reduced glutathione permits free radical oxidation of hemoglobin sulfhydryl groups. Denatured hemoglobin precipitates into Heinz bodies that adhere to red cell membranes.",
      r: ["Correct. Heinz bodies are insoluble precipitates of denatured, oxidized hemoglobin.", "Incorrect. Ribosomal aggregates form basophilic stippling.", "Incorrect. Nuclear chromatin remnants are Howell-Jolly bodies.", "Incorrect. Iron granules form Pappenheimer bodies."],
      kp: "Heinz bodies are insoluble precipitates of oxidized, denatured hemoglobin that adhere to erythrocyte membranes during oxidative stress in G6PD deficiency.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-123",
      q: "In G6PD deficiency, what mechanism produces the 'bite cells' (degmacytes) observed on peripheral blood smear during acute hemolytic crises?",
      o: ["Splenic macrophages pluck out membrane-bound Heinz bodies as erythrocytes traverse the cords of Billroth", "Intravascular mechanical shearing by fibrin strands in microvilli", "Autoimmune destruction by warm IgG antibodies", "Spontaneous membrane vesiculation in hypertonic urine"],
      a: 0,
      exp: "As erythrocytes squeeze through narrow interendothelial slits into splenic sinusoids, reticuloendothelial macrophages identify rigid Heinz bodies adhering to the membrane and excise them (pitting), creating bite cells (degmacytes).",
      r: ["Correct. Splenic macrophages excise Heinz bodies, leaving bite cells (degmacytes).", "Incorrect. Fibrin shearing creates schistocytes in microangiopathies (TTP/HUS/DIC).", "Incorrect. Warm autoimmune hemolysis produces spherocytes.", "Incorrect. Urine tonicity does not create circulating bite cells."],
      kp: "Bite cells (degmacytes) form when splenic macrophages pluck out rigid Heinz bodies from erythrocytes in the splenic cords of Billroth.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-124",
      q: "Which enzyme in erythrocytes utilizes NADH to reduce methemoglobin (Fe3+) back to functional ferrous hemoglobin (Fe2+), maintaining normal methemoglobin below 1%?",
      o: ["Cytochrome b5 reductase (NADH-methemoglobin reductase)", "Glucose-6-phosphate dehydrogenase", "Glutathione peroxidase", "Superoxide dismutase"],
      a: 0,
      exp: "Cytochrome b5 reductase (diaphorase I) uses NADH generated by glycolysis to reduce cytochrome b5, which non-enzymatically reduces ferric iron (Fe3+) back to ferrous iron (Fe2+), maintaining normal methemoglobin <1%.",
      r: ["Correct. NADH-cytochrome b5 reductase is the primary physiological methemoglobin reductase.", "Incorrect. G6PD generates NADPH, used by a secondary minor reductase pathway.", "Incorrect. Glutathione peroxidase detoxifies peroxides.", "Incorrect. Superoxide dismutase dismutates superoxide to H2O2."],
      kp: "Erythrocytes use NADH-cytochrome b5 reductase to continuously reduce spontaneously formed methemoglobin back to functional ferrous hemoglobin.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-125",
      q: "Why can testing for erythrocyte G6PD enzyme activity immediately during an acute hemolytic crisis yield a falsely normal result?",
      o: ["The oldest G6PD-deficient erythrocytes have hemolyzed, leaving a reticulocyte-rich population with higher enzyme activity", "Oxidative stress allosterically activates remaining mutant enzymes", "Hemoglobinuria binds the assay reagent and gives artifactual color", "Transfused platelets synthesize G6PD in the plasma sample"],
      a: 0,
      exp: "Older red cells have the lowest G6PD activity and are selectively destroyed during acute hemolysis. The surviving marrow-released reticulocytes have high baseline G6PD activity, masking the underlying deficiency until 2-3 months later.",
      r: ["Correct. Older deficient cells hemolyze first; young reticulocytes have high enzyme levels, giving false-normal results.", "Incorrect. Mutant enzymes are not allosterically activated by oxidants.", "Incorrect. Assay interference is not the mechanism.", "Incorrect. Platelets do not alter red cell lysate enzyme testing."],
      kp: "G6PD activity testing during an acute hemolytic episode can be falsely normal because deficient older red cells have hemolyzed and reticulocytes have higher enzyme levels.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-126",
      q: "Which drug is well known for precipitating acute severe hemolytic crises in patients with G6PD deficiency?",
      o: ["Rasburicase", "Penicillin", "Acetaminophen", "Heparin"],
      a: 0,
      exp: "Rasburicase (recombinant urate oxidase) converts uric acid to allantoin and hydrogen peroxide (H2O2). In G6PD deficiency, red cells cannot detoxify the massive H2O2 load, precipitating life-threatening hemolysis and methemoglobinemia.",
      r: ["Correct. Rasburicase generates H2O2 as a byproduct, triggering severe hemolysis in G6PD deficiency.", "Incorrect. Penicillin causes drug-induced immune hemolytic anemia, not G6PD crisis.", "Incorrect. Acetaminophen is safe at therapeutic doses.", "Incorrect. Heparin does not induce oxidative stress."],
      kp: "Rasburicase is contraindicated in G6PD deficiency because its catalytic breakdown of uric acid produces hydrogen peroxide, triggering severe acute hemolysis.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-127",
      q: "In the Rapoport-Luebering glycolytic shunt, 1,3-bisphosphoglycerate is converted to 2,3-bisphosphoglycerate by bisphosphoglycerate mutase. What is the energetic sacrifice of this shunt?",
      o: ["Bypasses phosphoglycerate kinase, forfeiting 2 ATP molecules per glucose molecule", "Consumes 2 additional ATP molecules per glucose", "Prevents the reduction of NAD+ to NADH at GAPDH", "Diverts pyruvate into the tricarboxylic acid cycle"],
      a: 0,
      exp: "The Rapoport-Luebering shunt bypasses the phosphoglycerate kinase step. Normally, phosphoglycerate kinase produces 2 ATP (one per triose); by diverting through 2,3-BPG, red cells sacrifice these 2 ATP to regulate oxygen affinity.",
      r: ["Correct. Bypassing phosphoglycerate kinase yields zero net ATP for that glucose molecule.", "Incorrect. It does not consume extra ATP.", "Incorrect. GAPDH operates normally upstream.", "Incorrect. Red cells lack mitochondria and cannot run the TCA cycle."],
      kp: "The Rapoport-Luebering shunt bypasses the phosphoglycerate kinase substrate-level phosphorylation step, sacrificing 2 ATP per glucose to generate 2,3-BPG.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-128",
      q: "A 16-year-old boy presents with chronic mild jaundice, splenomegaly, and non-spherocytic hemolytic anemia. Direct Coombs test is negative. Erythrocyte 2,3-BPG levels are markedly elevated. Which enzymopathy is most likely?",
      o: ["Pyruvate kinase deficiency", "G6PD deficiency", "Glucose-6-phosphate isomerase deficiency", "Glutathione synthetase deficiency"],
      a: 0,
      exp: "Pyruvate kinase deficiency is the most common glycolytic enzymopathy. Impaired conversion of PEP to pyruvate causes upstream accumulation of glycolytic intermediates, markedly elevating 2,3-BPG, which right-shifts the Hb curve and improves oxygen delivery.",
      r: ["Correct. Pyruvate kinase deficiency causes chronic hemolysis with characteristically elevated 2,3-BPG.", "Incorrect. G6PD deficiency causes episodic hemolysis with normal 2,3-BPG.", "Incorrect. GPI deficiency is far rarer and does not specifically elevate 2,3-BPG.", "Incorrect. Glutathione synthetase deficiency impairs antioxidant defense."],
      kp: "Pyruvate kinase deficiency causes chronic non-spherocytic hemolytic anemia with upstream accumulation of glycolytic intermediates, notably elevated 2,3-BPG.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-129",
      q: "What is the primary mode of inheritance for glucose-6-phosphate dehydrogenase (G6PD) deficiency?",
      o: ["X-linked recessive", "Autosomal recessive", "Autosomal dominant", "Mitochondrial maternal inheritance"],
      a: 0,
      exp: "G6PD is encoded on the X chromosome (Xq28) and inherited in an X-linked recessive pattern. Hemizygous males manifest full disease; heterozygous females may be mildly symptomatic due to skewed lyonization (X-inactivation).",
      r: ["Correct. G6PD deficiency is an X-linked recessive disorder.", "Incorrect. Pyruvate kinase deficiency is autosomal recessive.", "Incorrect. Hereditary spherocytosis is mostly autosomal dominant.", "Incorrect. Mitochondrial encephalomyopathies show maternal inheritance."],
      kp: "G6PD deficiency is inherited in an X-linked recessive pattern, predominantly affecting males while heterozygous females show variable expression due to lyonization.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-130",
      q: "Which antioxidant enzyme uses reduced glutathione (GSH) as a hydrogen donor to reduce dangerous hydrogen peroxide into harmless water?",
      o: ["Glutathione peroxidase (a selenoprotein)", "Glutathione reductase", "Catalase", "Superoxide dismutase"],
      a: 0,
      exp: "Glutathione peroxidase is a selenoprotein that converts H2O2 + 2 GSH into 2 H2O + GSSG. Glutathione reductase then uses NADPH to reduce GSSG back to 2 GSH.",
      r: ["Correct. Glutathione peroxidase oxidizes GSH to GSSG while reducing H2O2 to water.", "Incorrect. Glutathione reductase regenerates GSH using NADPH.", "Incorrect. Catalase dismutates H2O2 to water and O2 without using glutathione.", "Incorrect. SOD converts superoxide to H2O2."],
      kp: "Glutathione peroxidase utilizes reduced glutathione (GSH) to detoxify hydrogen peroxide and lipid hydroperoxides into water and stable lipid alcohols.",
      img: [], d: 1, cog: "recall"
    }
  ]
};
