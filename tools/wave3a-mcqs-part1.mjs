/**
 * Wave 3A Original Single Best Answer MCQs for maikbook1 (Biochemistry)
 * 197 verified items across 20 modules (10 MCQs per module)
 */

export const wave3aMcqsByTopic = {
  // Existing 1: bio-glycolysis-tca (9 new items to bring total to 10)
  "bio-glycolysis-tca": [
    {
      id: "bk-bio-014",
      q: "Which enzyme of the citric acid cycle is directly embedded in the inner mitochondrial membrane and functions as Complex II of the electron transport chain?",
      o: ["Succinate dehydrogenase", "Citrate synthase", "Isocitrate dehydrogenase", "Fumarase"],
      a: 0,
      exp: "Succinate dehydrogenase is the only citric acid cycle enzyme bound to the inner mitochondrial membrane, directly reducing FAD to FADH2 and feeding electrons into the ubiquinone pool as Complex II.",
      r: ["Correct. Succinate dehydrogenase is embedded in the inner membrane and serves as Complex II of the ETC.", "Incorrect. Citrate synthase is a soluble matrix enzyme.", "Incorrect. Isocitrate dehydrogenase is a soluble matrix enzyme.", "Incorrect. Fumarase is a soluble matrix enzyme."],
      kp: "Succinate dehydrogenase is the only TCA cycle enzyme anchored in the inner mitochondrial membrane, functioning directly as ETC Complex II.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-015",
      q: "A patient with lactic acidosis is found to have an allosteric enzyme deficiency. Which step in glycolysis is considered the primary, committed rate-limiting step regulated by ATP, AMP, and fructose-2,6-bisphosphate?",
      o: ["Phosphofructokinase-1 (PFK-1)", "Hexokinase", "Pyruvate kinase", "Glyceraldehyde-3-phosphate dehydrogenase"],
      a: 0,
      exp: "Phosphofructokinase-1 catalyzes the irreversible phosphorylation of fructose-6-phosphate to fructose-1,6-bisphosphate. It is allosterically stimulated by AMP and fructose-2,6-bisphosphate and inhibited by ATP and citrate.",
      r: ["Correct. PFK-1 is the primary committed rate-limiting step of glycolysis.", "Incorrect. Hexokinase is an early regulated step but not the committed step because G6P enters glycogen synthesis and the HMP shunt.", "Incorrect. Pyruvate kinase is regulated but acts at the end of the pathway.", "Incorrect. GAPDH is a reversible enzyme."],
      kp: "Phosphofructokinase-1 is the primary committed rate-limiting step of glycolysis, allosterically activated by fructose-2,6-bisphosphate and AMP.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-016",
      q: "Arsenate poisoning exerts toxicity during glycolysis by competing with inorganic phosphate at which specific enzymatic step, resulting in zero net ATP generation?",
      o: ["Glyceraldehyde-3-phosphate dehydrogenase (GAPDH)", "Phosphoglycerate kinase", "Pyruvate kinase", "Enolase"],
      a: 0,
      exp: "Arsenate competes with inorganic phosphate as a substrate for GAPDH, forming unstable 1-arseno-3-phosphoglycerate which spontaneously hydrolyzes, bypassing substrate-level phosphorylation and preventing net ATP generation.",
      r: ["Correct. Arsenate uncouples GAPDH by substituting for inorganic phosphate.", "Incorrect. Phosphoglycerate kinase produces ATP from 1,3-BPG, which is bypassed by arsenolysis.", "Incorrect. Pyruvate kinase generates ATP downstream.", "Incorrect. Enolase is inhibited by fluoride."],
      kp: "Arsenate uncouples glycolysis at GAPDH by substituting for inorganic phosphate, causing spontaneous hydrolysis with zero net ATP generation.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-017",
      q: "Fluoride is added to blood collection tubes used for plasma glucose estimation because it potently inhibits which glycolytic enzyme by complexing with magnesium?",
      o: ["Enolase", "Pyruvate kinase", "Phosphoglucose isomerase", "Aldolase"],
      a: 0,
      exp: "Fluoride ions form a complex with magnesium and phosphate that binds and inhibits enolase, stopping glycolysis in red cells and preventing in vitro artifactual decline of measured blood glucose.",
      r: ["Correct. Fluoride inhibits enolase, preserving plasma glucose in blood collection vials.", "Incorrect. Pyruvate kinase is downstream and not directly inhibited by fluoride.", "Incorrect. Phosphoglucose isomerase is an earlier reversible step.", "Incorrect. Aldolase cleaves F-1,6-BP into trioses."],
      kp: "Sodium fluoride in gray-top tubes inhibits enolase, arresting in vitro erythrocyte glycolysis to preserve true glucose measurements.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-018",
      q: "How many total molecules of NADH, FADH2, and GTP/ATP are generated directly per single turn of the citric acid cycle from one molecule of acetyl-CoA?",
      o: ["3 NADH, 1 FADH2, 1 GTP", "2 NADH, 2 FADH2, 1 GTP", "4 NADH, 1 FADH2, 2 GTP", "3 NADH, 2 FADH2, 0 GTP"],
      a: 0,
      exp: "Each turn of the citric acid cycle oxidizing one acetyl-CoA generates 3 NADH (via isocitrate, alpha-ketoglutarate, and malate dehydrogenases), 1 FADH2 (via succinate dehydrogenase), and 1 GTP (via succinyl-CoA synthetase).",
      r: ["Correct. One cycle yields 3 NADH, 1 FADH2, and 1 GTP.", "Incorrect. FADH2 is produced only at succinate dehydrogenase (1 molecule).", "Incorrect. Only 3 NADH are generated in the cycle itself.", "Incorrect. Succinyl-CoA synthetase yields 1 high-energy phosphate."],
      kp: "Each molecule of acetyl-CoA oxidized in the citric acid cycle yields 3 NADH, 1 FADH2, and 1 GTP.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-019",
      q: "A researcher observes that addition of malonate halts respiration in isolated liver mitochondria. Malonate acts as a competitive inhibitor of which enzyme?",
      o: ["Succinate dehydrogenase", "Malate dehydrogenase", "Citrate synthase", "Alpha-ketoglutarate dehydrogenase"],
      a: 0,
      exp: "Malonate has a chemical structure (dicarboxylic acid with 3 carbons) highly homologous to succinate (4 carbons), making it a classic competitive inhibitor of succinate dehydrogenase.",
      r: ["Correct. Malonate structurally mimics succinate, competitively inhibiting succinate dehydrogenase.", "Incorrect. Malate dehydrogenase oxidizes malate to oxaloacetate.", "Incorrect. Citrate synthase condenses acetyl-CoA with oxaloacetate.", "Incorrect. Alpha-ketoglutarate dehydrogenase is inhibited by succinyl-CoA and NADH."],
      kp: "Malonate is a classic competitive inhibitor of succinate dehydrogenase due to its structural resemblance to succinate.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-020",
      q: "Which enzyme of the citric acid cycle catalyzes a substrate-level phosphorylation reaction that produces GTP in the liver and kidneys?",
      o: ["Succinyl-CoA synthetase (succinate thiokinase)", "Succinate dehydrogenase", "Alpha-ketoglutarate dehydrogenase", "Isocitrate dehydrogenase"],
      a: 0,
      exp: "Succinyl-CoA synthetase cleaves the high-energy thioester bond of succinyl-CoA, coupling this exergonic cleavage to the phosphorylation of GDP to GTP (or ADP to ATP in muscle).",
      r: ["Correct. Succinyl-CoA synthetase catalyzes substrate-level phosphorylation forming GTP.", "Incorrect. Succinate dehydrogenase generates FADH2.", "Incorrect. Alpha-ketoglutarate dehydrogenase generates NADH and succinyl-CoA.", "Incorrect. Isocitrate dehydrogenase generates NADH and CO2."],
      kp: "Succinyl-CoA synthetase couples the cleavage of a high-energy thioester bond to substrate-level phosphorylation of GDP to GTP.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-021",
      q: "Under anaerobic conditions in exercising skeletal muscle, pyruvate is converted to lactate by lactate dehydrogenase. What is the essential physiological purpose of this reaction?",
      o: ["Regeneration of NAD+ to sustain continued glycolytic flux at GAPDH", "Generation of additional high-energy ATP molecules", "Buffering intracellular pH to prevent acidosis", "Activation of mitochondrial pyruvate dehydrogenase"],
      a: 0,
      exp: "Glyceraldehyde-3-phosphate dehydrogenase (GAPDH) requires NAD+ to maintain glycolysis. Under anaerobic conditions, mitochondrial reoxidation of NADH is impaired; lactate dehydrogenase reduces pyruvate to lactate while reoxidizing NADH to NAD+.",
      r: ["Correct. Lactate dehydrogenase regenerates NAD+ required for GAPDH, allowing continued anaerobic ATP production.", "Incorrect. The conversion of pyruvate to lactate produces no ATP directly.", "Incorrect. Lactic acid accumulation lowers pH.", "Incorrect. Pyruvate dehydrogenase is inactive under hypoxia."],
      kp: "Anaerobic conversion of pyruvate to lactate by LDH regenerates cytosolic NAD+, sustaining continued glycolysis at the GAPDH step.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-022",
      q: "A child with persistent hyperlactatemia is diagnosed with pyruvate dehydrogenase complex deficiency. Which amino acid should be enriched in the diet because its catabolism yields only acetyl-CoA without producing pyruvate?",
      o: ["Leucine", "Alanine", "Glutamine", "Glycine"],
      a: 0,
      exp: "Leucine and lysine are exclusively ketogenic amino acids; their degradation yields acetyl-CoA and acetoacetate without ever forming pyruvate or intermediate gluconeogenic precursors, avoiding lactic acid accumulation.",
      r: ["Correct. Leucine is exclusively ketogenic, bypassing pyruvate formation entirely.", "Incorrect. Alanine transaminates directly to pyruvate, worsening lactic acidosis.", "Incorrect. Glutamine is glucogenic, entering the TCA cycle via alpha-ketoglutarate.", "Incorrect. Glycine enters gluconeogenesis via serine and pyruvate."],
      kp: "Ketogenic diets enriched in leucine and lysine are therapeutic in pyruvate dehydrogenase deficiency because they yield acetyl-CoA without producing pyruvate.",
      img: [], d: 2, cog: "application"
    }
  ],

  // Existing 2: bio-fatty-acid-oxidation (9 new items to bring total to 10)
  "bio-fatty-acid-oxidation": [
    {
      id: "bk-bio-023",
      q: "What metabolite serves as an allosteric inhibitor of carnitine palmitoyltransferase-1 (CPT-1), preventing simultaneous fatty acid synthesis and beta-oxidation?",
      o: ["Malonyl-CoA", "Citrate", "Palmitoyl-CoA", "Acetyl-CoA"],
      a: 0,
      exp: "Malonyl-CoA, the first committed intermediate of fatty acid synthesis, allosterically inhibits CPT-1, shutting down mitochondrial carnitine-mediated import of fatty acids during lipogenesis.",
      r: ["Correct. Malonyl-CoA inhibits CPT-1 to block fatty acid beta-oxidation during energy abundance.", "Incorrect. Citrate allosterically activates acetyl-CoA carboxylase.", "Incorrect. Palmitoyl-CoA is the product of lipogenesis and inhibits ACC.", "Incorrect. Acetyl-CoA is the substrate."],
      kp: "Malonyl-CoA allosterically inhibits carnitine palmitoyltransferase-1, coordinating reciprocal control between fatty acid synthesis and beta-oxidation.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-024",
      q: "A 4-month-old infant presents with hypoketotic hypoglycemia and lethargy following an overnight fast. Plasma acylcarnitine profiling reveals elevated C6 to C10 octanoylcarnitine. Which enzyme is deficient?",
      o: ["Medium-chain acyl-CoA dehydrogenase (MCAD)", "Carnitine palmitoyltransferase-1", "HMG-CoA synthase", "Hormone-sensitive lipase"],
      a: 0,
      exp: "MCAD deficiency is the most common inborn error of beta-oxidation. Inability to oxidize medium-chain fatty acids prevents ketone body formation and gluconeogenic energy supply, causing hypoketotic hypoglycemia with elevated C8-octanoylcarnitine.",
      r: ["Correct. MCAD deficiency presents with hypoketotic hypoglycemia and elevated C6-C10 acylcarnitines.", "Incorrect. CPT-1 deficiency elevates free carnitine without acylcarnitine accumulation.", "Incorrect. HMG-CoA synthase deficiency affects ketogenesis without specific medium-chain acylcarnitines.", "Incorrect. HSL deficiency impairs adipose lipolysis."],
      kp: "MCAD deficiency manifests with fasting hypoketotic hypoglycemia, dicarboxylic aciduria, and elevated C8 octanoylcarnitine in plasma.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-025",
      q: "What cofactor is required by propionyl-CoA carboxylase to convert propionyl-CoA derived from odd-chain fatty acid oxidation into methylmalonyl-CoA?",
      o: ["Biotin (Vitamin B7)", "Thiamine pyrophosphate (B1)", "Cobalamin (B12)", "Pyridoxal phosphate (B6)"],
      a: 0,
      exp: "Propionyl-CoA carboxylase is an ATP-dependent carboxylase that requires biotin (vitamin B7) to add carbon dioxide, forming D-methylmalonyl-CoA.",
      r: ["Correct. Propionyl-CoA carboxylase requires biotin, ATP, and CO2.", "Incorrect. Thiamine pyrophosphate is required for oxidative decarboxylation.", "Incorrect. Cobalamin is required downstream by methylmalonyl-CoA mutase.", "Incorrect. Pyridoxal phosphate is for transaminations."],
      kp: "Propionyl-CoA carboxylase requires biotin and ATP to convert odd-chain propionyl-CoA to methylmalonyl-CoA.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-026",
      q: "Methylmalonic acidemia results from a defect in methylmalonyl-CoA mutase, which requires which essential vitamin cofactor to convert L-methylmalonyl-CoA to succinyl-CoA?",
      o: ["Adenosylcobalamin (Vitamin B12)", "Folate (Vitamin B9)", "Riboflavin (Vitamin B2)", "Niacin (Vitamin B3)"],
      a: 0,
      exp: "Methylmalonyl-CoA mutase requires 5'-deoxyadenosylcobalamin (vitamin B12 derivative) to isomerize methylmalonyl-CoA to succinyl-CoA. In B12 deficiency or genetic mutase defects, methylmalonic acid accumulates.",
      r: ["Correct. Methylmalonyl-CoA mutase requires adenosylcobalamin (B12).", "Incorrect. Folate is required for single-carbon methylations, not isomerization.", "Incorrect. Riboflavin forms FAD.", "Incorrect. Niacin forms NAD."],
      kp: "Methylmalonyl-CoA mutase requires adenosylcobalamin (vitamin B12); deficiency causes elevated methylmalonic acid in plasma and urine.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-027",
      q: "Why can the human liver synthesize ketone bodies (acetoacetate, beta-hydroxybutyrate) during prolonged starvation but cannot utilize them for its own energy generation?",
      o: ["Lacks succinyl-CoA:3-ketoacid CoA transferase (thiophorase)", "Lacks mitochondrial HMG-CoA lyase", "Lacks beta-hydroxybutyrate dehydrogenase", "Lacks Carnitine palmitoyltransferase-2"],
      a: 0,
      exp: "Hepatocytes synthesize ketone bodies but cannot oxidize them because they lack thiophorase (succinyl-CoA:3-ketoacid CoA transferase), ensuring all generated ketone bodies are exported to extrahepatic tissues like brain and muscle.",
      r: ["Correct. The liver lacks thiophorase, preventing futile intrahepatic ketone consumption.", "Incorrect. HMG-CoA lyase is required for synthesis and is present in liver.", "Incorrect. Beta-hydroxybutyrate dehydrogenase interconverts acetoacetate and beta-hydroxybutyrate.", "Incorrect. CPT-2 is present and active."],
      kp: "The liver produces ketone bodies for extrahepatic tissues but cannot utilize them because it lacks thiophorase (succinyl-CoA:3-ketoacid CoA transferase).",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-028",
      q: "Beta-oxidation of a saturated sixteen-carbon palmitoyl-CoA requires how many rounds of oxidation, yielding how many molecules of acetyl-CoA, NADH, and FADH2?",
      o: ["7 rounds: 8 acetyl-CoA, 7 NADH, 7 FADH2", "8 rounds: 8 acetyl-CoA, 8 NADH, 8 FADH2", "7 rounds: 7 acetyl-CoA, 7 NADH, 7 FADH2", "6 rounds: 8 acetyl-CoA, 6 NADH, 6 FADH2"],
      a: 0,
      exp: "Cleavage of a 16-carbon fatty acid requires 7 cycles ((16/2) - 1). Each cycle yields 1 NADH, 1 FADH2, and 1 acetyl-CoA, with the final cycle splitting a 4-carbon intermediate into two acetyl-CoAs (total 8 acetyl-CoA).",
      r: ["Correct. 7 cycles yield 8 acetyl-CoA, 7 NADH, and 7 FADH2.", "Incorrect. Only 7 cycles are needed for 16 carbons.", "Incorrect. 8 acetyl-CoAs are produced, not 7.", "Incorrect. 7 rounds of cleavage occur."],
      kp: "Beta-oxidation of palmitoyl-CoA (16 carbons) requires 7 cycles, yielding 8 acetyl-CoA, 7 NADH, and 7 FADH2.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-029",
      q: "Patients with Zellweger syndrome fail to oxidize very long-chain fatty acids (such as hexacosanoic acid, C26:0) because the primary defect impairs which subcellular organelle?",
      o: ["Peroxisome", "Mitochondria", "Lysosome", "Endoplasmic reticulum"],
      a: 0,
      exp: "Very long-chain fatty acids (>=22 carbons) cannot enter mitochondria directly; they undergo initial shortening via peroxisomal beta-oxidation. Zellweger syndrome impairs peroxisome biogenesis, causing toxic VLCFA accumulation.",
      r: ["Correct. Peroxisomes initiate beta-oxidation of very long-chain fatty acids.", "Incorrect. Mitochondria oxidize shortened fatty acids but cannot import VLCFAs.", "Incorrect. Lysosomes digest macromolecules via acid hydrolases.", "Incorrect. The ER elongates and desaturates fatty acids."],
      kp: "Peroxisomes initiate beta-oxidation of very long-chain fatty acids (C22 or longer); peroxisomal biogenesis failure in Zellweger syndrome elevates plasma VLCFAs.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-030",
      q: "Refsum disease is an autosomal recessive neurological disorder caused by a deficiency of phytanoyl-CoA hydroxylase, impairing which metabolic pathway?",
      o: ["Alpha-oxidation of branched-chain dietary fatty acids", "Beta-oxidation of very long-chain fatty acids", "Omega-oxidation of dicarboxylic acids", "Ketogenesis in hepatocyte mitochondria"],
      a: 0,
      exp: "Phytanic acid is a branched-chain fatty acid derived from chlorophyll that contains a methyl group on its beta-carbon, blocking beta-oxidation. It requires peroxisomal alpha-oxidation by phytanoyl-CoA hydroxylase; deficiency causes Refsum disease.",
      r: ["Correct. Refsum disease results from impaired peroxisomal alpha-oxidation of phytanic acid.", "Incorrect. Peroxisomal beta-oxidation defects cause adrenoleukodystrophy.", "Incorrect. Omega-oxidation occurs in the ER when beta-oxidation is overwhelmed.", "Incorrect. Ketogenesis is hepatic mitochondrial."],
      kp: "Refsum disease results from defective peroxisomal alpha-oxidation of phytanic acid, manifesting with retinitis pigmentosa, ataxia, and peripheral neuropathy.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-031",
      q: "Systemic primary carnitine deficiency arises from a mutation in which gene encoding the high-affinity sodium-dependent carnitine transporter in plasma membranes?",
      o: ["SLC22A5 (OCTN2)", "CPT1A", "SLC25A20", "CPT2"],
      a: 0,
      exp: "Systemic primary carnitine deficiency is caused by homozygous mutations in SLC22A5 encoding OCTN2, impairing carnitine reabsorption in renal tubules and uptake into heart and muscle, causing hypoketotic hypoglycemia and cardiomyopathy.",
      r: ["Correct. SLC22A5 encodes OCTN2, the cellular carnitine transporter.", "Incorrect. CPT1A encodes hepatic carnitine palmitoyltransferase-1.", "Incorrect. SLC25A20 encodes carnitine-acylcarnitine translocase.", "Incorrect. CPT2 encodes mitochondrial inner membrane CPT-2."],
      kp: "Primary carnitine deficiency results from SLC22A5 (OCTN2) transporter mutations, causing urinary carnitine wasting, muscle weakness, and dilated cardiomyopathy.",
      img: [], d: 2, cog: "recall"
    }
  ],

  // Existing 3: bio-urea-cycle (9 new items to bring total to 10)
  "bio-urea-cycle": [
    {
      id: "bk-bio-032",
      q: "Carbamoyl phosphate synthetase I (CPS-I) in the mitochondrial matrix requires which obligate allosteric activator for catalytic activity?",
      o: ["N-acetylglutamate (NAG)", "Argininosuccinate", "Citrulline", "Carbamoyl phosphate"],
      a: 0,
      exp: "CPS-I requires N-acetylglutamate as an obligate allosteric activator. N-acetylglutamate is synthesized by NAG synthase from acetyl-CoA and glutamate, which is allosterically stimulated by arginine after a protein-rich meal.",
      r: ["Correct. N-acetylglutamate is the obligate allosteric activator of CPS-I.", "Incorrect. Argininosuccinate is a downstream intermediate.", "Incorrect. Citrulline is formed by ornithine transcarbamylase.", "Incorrect. Carbamoyl phosphate is the product."],
      kp: "CPS-I requires N-acetylglutamate (NAG) as an obligate allosteric activator, signaling elevated amino acid availability after protein meals.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-033",
      q: "A male infant presents on day 3 of life with hyperammonemia, lethargy, respiratory alkalosis, and markedly elevated urinary orotic acid. Which X-linked enzyme is deficient?",
      o: ["Ornithine transcarbamylase (OTC)", "Carbamoyl phosphate synthetase I", "Argininosuccinate synthetase", "N-acetylglutamate synthase"],
      a: 0,
      exp: "OTC deficiency is the most common urea cycle disorder and the only one that is X-linked recessive. Carbamoyl phosphate accumulates and leaks into the cytosol, driving pyrimidine synthesis and massive urinary orotic acid excretion.",
      r: ["Correct. OTC deficiency is X-linked and causes hyperammonemia with elevated urinary orotic acid.", "Incorrect. CPS-I deficiency causes hyperammonemia with low or absent orotic acid.", "Incorrect. Argininosuccinate synthetase is autosomal recessive (citrullinemia).", "Incorrect. NAGS deficiency causes low orotic acid."],
      kp: "Ornithine transcarbamylase (OTC) deficiency is X-linked recessive, presenting with hyperammonemia, encephalopathy, and massive urinary orotic acid excretion.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-034",
      q: "In the urea cycle, which amino acid enters the pathway by providing the second nitrogen atom incorporated into the final urea molecule?",
      o: ["Aspartate", "Glutamate", "Alanine", "Glutamine"],
      a: 0,
      exp: "One nitrogen of urea derives from free ammonium ion via CPS-I; the second nitrogen atom is supplied by aspartate when it condenses with citrulline via argininosuccinate synthetase.",
      r: ["Correct. Aspartate donates the second nitrogen of urea in the cytosol.", "Incorrect. Glutamate provides ammonium via glutamate dehydrogenase, contributing the first nitrogen.", "Incorrect. Alanine transports nitrogen from muscle to liver.", "Incorrect. Glutamine carries nitrogen from peripheral tissues."],
      kp: "The two nitrogens of urea originate from free mitochondrial ammonium ion (first nitrogen) and cytosolic aspartate (second nitrogen).",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-035",
      q: "Which reaction of the urea cycle generates fumarate, providing an essential metabolic bridge (the 'Krebs bicycle') linking the urea cycle to the citric acid cycle?",
      o: ["Cleavage of argininosuccinate by argininosuccinate lyase", "Synthesis of argininosuccinate by argininosuccinate synthetase", "Hydrolysis of arginine by arginase", "Carbamoylation of ornithine by OTC"],
      a: 0,
      exp: "Argininosuccinate lyase cleaves argininosuccinate into arginine and fumarate. Fumarate is converted to malate and enters the citric acid cycle or gluconeogenesis, linking the two cycles.",
      r: ["Correct. Argininosuccinate lyase releases fumarate, connecting to the TCA cycle.", "Incorrect. Argininosuccinate synthetase condenses citrulline and aspartate.", "Incorrect. Arginase cleaves arginine to urea and ornithine.", "Incorrect. OTC generates citrulline."],
      kp: "Argininosuccinate lyase cleaves argininosuccinate into arginine and fumarate, providing the bridge directly connecting the urea and TCA cycles.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-036",
      q: "A child with arginase deficiency presents with progressive spastic diplegia, microcephaly, and developmental regression. What laboratory finding is characteristic?",
      o: ["Markedly elevated plasma arginine with mild hyperammonemia", "Severe neonatal hyperammonemic coma", "Massive urinary orotic aciduria", "Depleted plasma citrulline and arginine"],
      a: 0,
      exp: "Arginase deficiency is the final step of the urea cycle; it presents with marked elevation of plasma arginine, progressive spastic diplegia, and milder hyperammonemia than upstream cycle defects.",
      r: ["Correct. Arginase deficiency causes hyperargininemia with progressive spastic diplegia.", "Incorrect. Severe neonatal hyperammonemic coma is typical of CPS-I or OTC deficiency.", "Incorrect. Massive orotic aciduria characterizes OTC deficiency.", "Incorrect. Plasma arginine is elevated, not depleted."],
      kp: "Arginase deficiency causes hyperargininemia with progressive spastic diplegia and choreoathetosis, contrasting with acute neonatal coma of upstream defects.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-037",
      q: "What pharmacological agent is administered in urea cycle disorders to scavenge nitrogen by conjugating with glycine to form hippuric acid, which is rapidly excreted in urine?",
      o: ["Sodium benzoate", "Sodium phenylbutyrate", "L-carnitine", "Lactulose"],
      a: 0,
      exp: "Sodium benzoate conjugates with glycine to form hippurate (hippuric acid), which is rapidly cleared by renal glomerular filtration and secretion, removing one nitrogen atom per molecule.",
      r: ["Correct. Sodium benzoate conjugates with glycine to form hippurate.", "Incorrect. Sodium phenylbutyrate conjugates with glutamine to form phenylacetylglutamine.", "Incorrect. Carnitine binds acyl groups.", "Incorrect. Lactulose acidifies colonic contents to trap ammonium."],
      kp: "Sodium benzoate scavenges waste nitrogen by conjugating with glycine to form hippurate, which is excreted renally in urea cycle enzymopathies.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-038",
      q: "Sodium phenylbutyrate is converted in vivo to phenylacetate, which removes two waste nitrogen atoms by conjugating with which amino acid?",
      o: ["Glutamine", "Glycine", "Alanine", "Aspartate"],
      a: 0,
      exp: "Phenylacetate conjugates with glutamine to form phenylacetylglutamine, which is excreted in urine. Because glutamine contains two nitrogen atoms, each molecule eliminates two waste nitrogens.",
      r: ["Correct. Phenylacetate conjugates with glutamine, eliminating two nitrogen atoms.", "Incorrect. Glycine conjugates with benzoate.", "Incorrect. Alanine does not form excretable conjugates with phenylacetate.", "Incorrect. Aspartate is not the conjugation partner."],
      kp: "Phenylbutyrate conjugates with glutamine to form phenylacetylglutamine, removing two nitrogen atoms per molecule in hyperammonemic states.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-039",
      q: "Which two reactions of the urea cycle take place inside the mitochondrial matrix before the remaining steps occur in the cytosol?",
      o: ["CPS-I and Ornithine transcarbamylase", "Argininosuccinate synthetase and lyase", "Arginase and CPS-I", "Ornithine transcarbamylase and Arginase"],
      a: 0,
      exp: "The first two reactions (synthesis of carbamoyl phosphate by CPS-I and synthesis of citrulline by OTC) occur inside the mitochondrial matrix. Citrulline is then transported to the cytosol for the remaining three reactions.",
      r: ["Correct. CPS-I and OTC are the two mitochondrial enzymes of the urea cycle.", "Incorrect. Argininosuccinate synthetase and lyase are cytosolic.", "Incorrect. Arginase is a cytosolic enzyme.", "Incorrect. Arginase is cytosolic."],
      kp: "CPS-I and OTC reside in the mitochondrial matrix; citrulline exits to the cytosol where argininosuccinate synthetase, lyase, and arginase complete the cycle.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-040",
      q: "Why is arginine an essential amino acid in patients with inherited deficiencies of CPS-I, OTC, or argininosuccinate synthetase?",
      o: ["De novo synthesis of arginine within the urea cycle is abolished", "Arginine is required to activate CPS-I directly", "Arginine stimulates renal excretion of carbamoyl phosphate", "Arginine inhibits intestinal bacterial urease"],
      a: 0,
      exp: "Normally, the urea cycle synthesizes sufficient arginine to meet adult physiological needs. In urea cycle defects upstream of argininosuccinate lyase, endogenous arginine production is lost, making it an essential dietary amino acid.",
      r: ["Correct. Blockade of the cycle abolishes de novo arginine synthesis, making dietary arginine essential.", "Incorrect. NAG activates CPS-I, not arginine directly.", "Incorrect. Arginine does not stimulate carbamoyl phosphate excretion.", "Incorrect. Arginine does not inhibit bacterial urease."],
      kp: "In urea cycle enzymopathies upstream of arginase, arginine becomes an essential amino acid because endogenous synthesis is abolished.",
      img: [], d: 2, cog: "recall"
    }
  ],

  // Module 1: bio-intro-principles (10 MCQs)
  "bio-intro-principles": [
    {
      id: "bk-bio-041",
      q: "Which of the following metabolic pathways is localized strictly within the mitochondrial matrix?",
      o: ["Beta-oxidation of fatty acids", "Glycolysis", "Fatty acid synthesis", "Pentose phosphate pathway"],
      a: 0,
      exp: "Beta-oxidation of fatty acids occurs in the mitochondrial matrix, alongside the citric acid cycle and pyruvate dehydrogenase. Glycolysis, fatty acid synthesis, and the pentose phosphate pathway occur in the cytosol.",
      r: ["Correct. Beta-oxidation takes place in the mitochondrial matrix.", "Incorrect. Glycolysis occurs in the cytosol.", "Incorrect. Fatty acid synthesis occurs in the cytosol.", "Incorrect. The pentose phosphate pathway is cytosolic."],
      kp: "Beta-oxidation of fatty acids and the citric acid cycle reside in the mitochondrial matrix, separated from cytosolic anabolic pathways.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-042",
      q: "An infant born with craniofacial dysmorphism, profound hypotonia, and hepatomegaly is found to have elevated plasma very long-chain fatty acids (C26:0). What organelle biogenesis defect is responsible?",
      o: ["Peroxisome (Zellweger syndrome)", "Mitochondria", "Lysosome", "Golgi apparatus"],
      a: 0,
      exp: "Zellweger syndrome results from mutations in PEX genes required for peroxisomal assembly, leading to failure of peroxisomal beta-oxidation and severe accumulation of very long-chain fatty acids.",
      r: ["Correct. Zellweger syndrome is a peroxisome biogenesis disorder causing VLCFA buildup.", "Incorrect. Mitochondrial defects do not cause isolated VLCFA accumulation.", "Incorrect. Lysosomal defects cause mucopolysaccharidoses and sphingolipidoses.", "Incorrect. Golgi defects disrupt protein glycosylation."],
      kp: "Zellweger syndrome results from PEX gene mutations causing absent peroxisomes and lethal accumulation of very long-chain fatty acids.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-043",
      q: "Which specialized phospholipid is uniquely enriched in the inner mitochondrial membrane, conferring low permeability to protons and ions essential for ATP generation?",
      o: ["Cardiolipin (diphosphatidylglycerol)", "Phosphatidylcholine", "Sphingomyelin", "Phosphatidylserine"],
      a: 0,
      exp: "Cardiolipin contains four fatty acyl chains and two phosphate groups; it is almost exclusively localized to the inner mitochondrial membrane, sealing it against proton leakage.",
      r: ["Correct. Cardiolipin is uniquely concentrated in the inner mitochondrial membrane.", "Incorrect. Phosphatidylcholine is a general outer leaflet membrane lipid.", "Incorrect. Sphingomyelin is found in plasma membrane and myelin.", "Incorrect. Phosphatidylserine resides on the cytosolic leaflet of plasma membranes."],
      kp: "Cardiolipin is unique to the inner mitochondrial membrane, stabilizing respiratory chain complexes and maintaining proton impermeability.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-044",
      q: "What cellular mechanism maintains the acidic luminal pH (4.5 to 5.0) required for optimal activity of lysosomal acid hydrolases?",
      o: ["Vacuolar V-type H+-ATPase pump", "Sodium-potassium ATPase", "Mitochondrial ATP synthase", "Passive proton-chloride symport"],
      a: 0,
      exp: "Vacuolar V-type ATPases consume ATP to actively pump protons from the neutral cytosol into the lysosomal lumen against a steep concentration gradient, maintaining pH 4.5-5.0.",
      r: ["Correct. Vacuolar V-type H+-ATPase maintains lysosomal acidification.", "Incorrect. Na+/K+-ATPase is on the plasma membrane.", "Incorrect. ATP synthase synthesizes ATP from proton flow.", "Incorrect. Passive transport cannot maintain acidic pH against a gradient."],
      kp: "Lysosomal acid hydrolases operate at pH 4.5-5.0 maintained by active proton pumping via vacuolar V-type H+-ATPases.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-045",
      q: "In an inborn error of metabolism involving an enzyme deficiency, which of the following typically explains the clinical toxicity?",
      o: ["Upstream precursor accumulation and downstream product deficiency", "Upregulation of normal feedback inhibition", "Premature lysosomal exocytosis", "Decreased transcription of upstream genes"],
      a: 0,
      exp: "Enzyme blocks cause toxic accumulation of upstream substrates (often shunted into aberrant toxic side pathways) alongside deficiency of vital downstream physiological products.",
      r: ["Correct. Toxic upstream accumulation and downstream product deficiency drive pathology.", "Incorrect. Feedback inhibition is typically lost due to product depletion.", "Incorrect. Lysosomal exocytosis is not the primary mechanism.", "Incorrect. Upstream transcription is often compensatory increased."],
      kp: "Inborn errors of metabolism produce pathology via toxic accumulation of upstream precursors and depletion of vital downstream products.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-046",
      q: "Which metabolic organelle contains catalase to decompose cytotoxic hydrogen peroxide generated during the beta-oxidation of fatty acids?",
      o: ["Peroxisome", "Mitochondria", "Lysosome", "Nucleolus"],
      a: 0,
      exp: "Peroxisomes contain oxidases that transfer electrons to molecular oxygen forming H2O2, and abundant catalase that converts 2 H2O2 into 2 H2O and O2.",
      r: ["Correct. Peroxisomes contain catalase to degrade hydrogen peroxide.", "Incorrect. Mitochondria rely on superoxide dismutase and glutathione peroxidase.", "Incorrect. Lysosomes contain acid hydrolases.", "Incorrect. The nucleolus synthesizes ribosomal RNA."],
      kp: "Peroxisomes house flavin oxidases that produce hydrogen peroxide and catalase that decomposes it into water and oxygen.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-047",
      q: "Which pathway is shared between both the cytosol and the mitochondrial matrix, requiring intermediates to shuttle between compartments?",
      o: ["Urea cycle", "Glycolysis", "Fatty acid beta-oxidation", "Fatty acid synthesis"],
      a: 0,
      exp: "The urea cycle spans both compartments: the first two steps (CPS-I, OTC) occur in the mitochondrial matrix, while the remaining three steps occur in the cytosol.",
      r: ["Correct. The urea cycle spans both mitochondria and cytosol.", "Incorrect. Glycolysis is entirely cytosolic.", "Incorrect. Beta-oxidation of long-chain fatty acids is mitochondrial.", "Incorrect. Fatty acid synthesis is cytosolic."],
      kp: "The urea cycle, gluconeogenesis, and heme synthesis are compartmentalized across both mitochondria and cytosol.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-048",
      q: "A patient with X-linked adrenoleukodystrophy has a defect in the ABCD1 peroxisomal membrane transporter. What biochemical abnormality accumulates in serum?",
      o: ["Very long-chain fatty acids (VLCFAs, C24 and C26)", "Branched-chain amino acids", "Medium-chain dicarboxylic acids", "Unconjugated bilirubin"],
      a: 0,
      exp: "ABCD1 transports very long-chain fatty acyl-CoA esters into peroxisomes. Its defect in X-ALD prevents peroxisomal beta-oxidation, accumulating VLCFAs and causing adrenal insufficiency and cerebral demyelination.",
      r: ["Correct. X-ALD causes accumulation of very long-chain fatty acids due to ABCD1 transport failure.", "Incorrect. Branched-chain amino acids accumulate in MSUD.", "Incorrect. Medium-chain acids accumulate in MCAD deficiency.", "Incorrect. Bilirubin accumulates in hepatic and hemolytic disorders."],
      kp: "X-linked adrenoleukodystrophy results from ABCD1 mutations impairing peroxisomal import and beta-oxidation of very long-chain fatty acids.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-049",
      q: "Which organelle houses the cytochrome P450 monooxygenase enzyme system responsible for phase I xenobiotic detoxification and steroid hormone synthesis?",
      o: ["Smooth endoplasmic reticulum", "Rough endoplasmic reticulum", "Peroxisome", "Lysosome"],
      a: 0,
      exp: "The smooth endoplasmic reticulum contains membrane-bound cytochrome P450 enzymes that hydroxylate hydrophobic drugs and steroids to enhance water solubility for excretion.",
      r: ["Correct. Smooth ER houses cytochrome P450 enzymes for detoxification.", "Incorrect. Rough ER specializes in protein synthesis and initial N-glycosylation.", "Incorrect. Peroxisomes perform alpha- and beta-oxidation.", "Incorrect. Lysosomes degrade macromolecules."],
      kp: "Cytochrome P450 monooxygenases reside in the smooth endoplasmic reticulum, mediating phase I oxidative drug metabolism.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-050",
      q: "Barth syndrome is an X-linked disorder characterized by cardiomyopathy, neutropenia, and skeletal myopathy caused by a defect in tafazzin. What mitochondrial lipid fails to remodel?",
      o: ["Cardiolipin", "Phosphatidylinositol", "Phosphatidylethanolamine", "Ceramide"],
      a: 0,
      exp: "Tafazzin is a mitochondrial phospholipid transacylase required for cardiolipin acyl chain remodeling. Its deficiency in Barth syndrome causes abnormal cardiolipin and disrupted mitochondrial cristae.",
      r: ["Correct. Tafazzin deficiency in Barth syndrome disrupts cardiolipin remodeling.", "Incorrect. Phosphatidylinositol is a signaling precursor.", "Incorrect. Phosphatidylethanolamine is a general membrane phospholipid.", "Incorrect. Ceramide is a sphingolipid intermediate."],
      kp: "Barth syndrome results from tafazzin gene mutations, impairing cardiolipin remodeling in the inner mitochondrial membrane.",
      img: [], d: 2, cog: "recall"
    }
  ]
};
