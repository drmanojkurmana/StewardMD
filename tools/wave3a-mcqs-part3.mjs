/**
 * Wave 3A MCQs Part 3 (Modules 10 to 17, 80 MCQs)
 */

export const wave3aMcqsPart3 = {
  // Module 10: bio-glycogen-gluconeogenesis
  "bio-glycogen-gluconeogenesis": [
    {
      id: "bk-bio-131",
      q: "A 4-month-old infant presents with severe fasting hypoglycemia, hepatomegaly, lactic acidosis, and doll-like facies. Administration of glucagon fails to increase blood glucose but raises blood lactate. Which enzyme is deficient?",
      o: ["Glucose-6-phosphatase (Type I GSD / von Gierke disease)", "Lysosomal alpha-1,4-glucosidase (Pompe disease)", "Debranching enzyme (Cori disease)", "Liver glycogen phosphorylase (Hers disease)"],
      a: 0,
      exp: "Von Gierke disease (Type I GSD) is caused by glucose-6-phosphatase deficiency. G6P cannot be converted to free glucose in liver or kidney, causing profound fasting hypoglycemia. Glucagon mobilizes glycogen to G6P, which is shunted into glycolysis, causing lactic acidosis.",
      r: ["Correct. Von Gierke disease features glucose-6-phosphatase deficiency with severe hypoglycemia and lactic acidosis.", "Incorrect. Pompe disease is lysosomal acid maltase deficiency with cardiomyopathy.", "Incorrect. Cori disease (debranching enzyme) has normal lactate.", "Incorrect. Hers disease is liver phosphorylase deficiency, milder and lactate is normal."],
      kp: "Von Gierke disease (Type I GSD) is caused by glucose-6-phosphatase deficiency, presenting with profound fasting hypoglycemia, lactic acidosis, hyperuricemia, and hepatomegaly.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-132",
      q: "Which gluconeogenic enzyme requires biotin, ATP, and carbon dioxide, and is obligately allosterically activated by acetyl-CoA?",
      o: ["Pyruvate carboxylase", "Phosphoenolpyruvate carboxykinase (PEPCK)", "Fructose-1,6-bisphosphatase", "Glucose-6-phosphatase"],
      a: 0,
      exp: "Pyruvate carboxylase converts pyruvate to oxaloacetate in mitochondria using biotin, ATP, and CO2. Acetyl-CoA acts as an obligate allosteric activator, signaling that beta-oxidation is active and fueling gluconeogenesis.",
      r: ["Correct. Pyruvate carboxylase requires biotin, ATP, and CO2 and is activated by acetyl-CoA.", "Incorrect. PEPCK uses GTP and does not require biotin.", "Incorrect. FBPase-1 uses water and is inhibited by AMP.", "Incorrect. Glucose-6-phosphatase is in the ER membrane."],
      kp: "Pyruvate carboxylase converts pyruvate to oxaloacetate using biotin and ATP, obligately activated by acetyl-CoA.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-133",
      q: "What is the primary reciprocal allosteric regulator that simultaneously activates phosphofructokinase-1 (stimulating glycolysis) and inhibits fructose-1,6-bisphosphatase (suppressing gluconeogenesis)?",
      o: ["Fructose-2,6-bisphosphate (F-2,6-BP)", "Citrate", "ATP", "Glucose-6-phosphate"],
      a: 0,
      exp: "Fructose-2,6-bisphosphate is the master reciprocal regulator of hepatic carbohydrate metabolism, allosterically activating PFK-1 and potently inhibiting fructose-1,6-bisphosphatase to prevent futile cycling.",
      r: ["Correct. Fructose-2,6-bisphosphate stimulates PFK-1 and inhibits FBPase-1.", "Incorrect. Citrate inhibits PFK-1 and activates FBPase-1.", "Incorrect. ATP inhibits PFK-1.", "Incorrect. G6P regulates hexokinase."],
      kp: "Fructose-2,6-bisphosphate is the most potent allosteric activator of glycolysis (PFK-1) and inhibitor of gluconeogenesis (FBPase-1).",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-134",
      q: "A 2-month-old infant presents with profound generalized hypotonia, massive cardiomegaly on chest radiograph, and progressive heart failure. Skeletal muscle biopsy reveals abnormal lysosomal glycogen accumulation with normal cytoplasmic structure. Which enzyme is deficient?",
      o: ["Lysosomal alpha-1,4-glucosidase (acid maltase / Pompe disease)", "Glucose-6-phosphatase", "Branching enzyme (Andersen disease)", "Muscle phosphofructokinase (Tarui disease)"],
      a: 0,
      exp: "Pompe disease (Type II GSD) is caused by deficiency of lysosomal acid alpha-glucosidase (acid maltase). Glycogen accumulates inside lysosomes of cardiac and skeletal muscle, causing severe hypertrophic cardiomyopathy and hypotonia.",
      r: ["Correct. Pompe disease is lysosomal acid maltase deficiency with hypertrophic cardiomyopathy.", "Incorrect. Von Gierke disease causes hepatomegaly and hypoglycemia.", "Incorrect. Andersen disease causes hepatic cirrhosis and early death.", "Incorrect. Tarui disease affects muscle glycolysis, not lysosomes."],
      kp: "Pompe disease (Type II GSD) is caused by lysosomal acid alpha-glucosidase deficiency, causing fatal infantile hypertrophic cardiomyopathy and hypotonia.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-135",
      q: "A 22-year-old athlete experiences severe painful muscle cramps and burgundy-colored urine (myoglobinuria) after brief strenuous sprinting. A forearm ischemic exercise test demonstrates normal ammonia rise with zero venous lactate elevation. Which condition is diagnosed?",
      o: ["McArdle disease (Type V GSD, myophosphorylase deficiency)", "Cori disease (Type III GSD)", "Carnitine palmitoyltransferase II deficiency", "Mitochondrial myopathy"],
      a: 0,
      exp: "McArdle disease is muscle glycogen phosphorylase deficiency. Glycogenolysis cannot proceed in muscle, causing exercise cramps and myoglobinuria. Ischemic exercise fails to produce venous lactate (flat lactate curve) while ammonia rises normally.",
      r: ["Correct. McArdle disease presents with exercise cramps, myoglobinuria, and flat venous lactate curve.", "Incorrect. Cori disease affects debranching enzyme in liver and muscle, with hypoglycemia.", "Incorrect. CPT-II deficiency impairs lipid oxidation during prolonged fasting exercise.", "Incorrect. Mitochondrial myopathy elevates resting lactate."],
      kp: "McArdle disease (Type V GSD) features skeletal muscle glycogen phosphorylase deficiency, causing exercise-induced painful cramping, myoglobinuria, and absent venous lactate elevation.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-136",
      q: "Which enzyme is unique to gluconeogenesis and is localized to the luminal surface of the endoplasmic reticulum in liver and renal cortex, but is absent in skeletal muscle?",
      o: ["Glucose-6-phosphatase", "Fructose-1,6-bisphosphatase", "Phosphoenolpyruvate carboxykinase", "Pyruvate carboxylase"],
      a: 0,
      exp: "Glucose-6-phosphatase is located in the ER membrane of hepatocytes and renal proximal tubular cells; because skeletal muscle lacks this enzyme, muscle cannot release free glucose into the systemic circulation.",
      r: ["Correct. Glucose-6-phosphatase is present in liver and kidney ER, absent in muscle.", "Incorrect. FBPase-1 is cytosolic and present in gluconeogenic tissues.", "Incorrect. PEPCK is present in liver and kidney.", "Incorrect. Pyruvate carboxylase is mitochondrial."],
      kp: "Glucose-6-phosphatase resides in the ER lumen of liver and kidney; its absence in skeletal muscle prevents muscle glycogen from releasing free glucose into blood.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-137",
      q: "During prolonged fasting (>48 hours), which organ becomes an important secondary contributor to systemic gluconeogenesis, producing up to 40-50% of circulating glucose?",
      o: ["Renal cortex", "Skeletal muscle", "Adipose tissue", "Small intestine"],
      a: 0,
      exp: "While the liver provides nearly all glucose during early fasting, during prolonged starvation the renal cortex upregulates gluconeogenesis (using glutamine as primary substrate), supplying up to 40-50% of circulating glucose.",
      r: ["Correct. Renal cortex contributes up to 40-50% of gluconeogenesis during prolonged starvation.", "Incorrect. Muscle lacks glucose-6-phosphatase and cannot export glucose.", "Incorrect. Adipose tissue lacks gluconeogenic enzymes.", "Incorrect. Small intestine absorbs nutrients but is a minor glucose producer."],
      kp: "During prolonged starvation, renal cortical gluconeogenesis increases substantially, providing nearly half of circulating endogenous glucose using glutamine.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-138",
      q: "Cori disease (Type III GSD) differs clinically from von Gierke disease (Type I GSD) by which distinguishing feature?",
      o: ["Normal blood lactate and presence of limit dextrin-like glycogen with short outer branches", "Severe lactic acidosis and absent glycogen branches", "Absence of hepatomegaly", "Severe early infant death from cardiomyopathy"],
      a: 0,
      exp: "Cori disease (debranching enzyme deficiency) leaves abnormally structured limit dextrins (short outer branches) in liver and muscle. Because gluconeogenesis is intact, fasting blood lactate is normal, unlike von Gierke disease.",
      r: ["Correct. Cori disease features normal blood lactate and abnormal limit dextrin structures.", "Incorrect. Lactic acidosis characterizes Type I (von Gierke).", "Incorrect. Hepatomegaly is prominent in both.", "Incorrect. Cardiomyopathy characterizes Type II (Pompe)."],
      kp: "Cori disease (Type III GSD) is caused by debranching enzyme deficiency, accumulating limit dextrins; blood lactate is characteristically normal.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-139",
      q: "What activated nucleotide sugar serves as the immediate glucosyl donor for glycogen elongation catalyzed by glycogen synthase?",
      o: ["UDP-glucose", "ADP-glucose", "CDP-glucose", "Glucose-1-phosphate directly"],
      a: 0,
      exp: "Glucose-1-phosphate reacts with UTP via UDP-glucose pyrophosphorylase to form UDP-glucose, which transfers glucosyl units to the non-reducing end of glycogen chains via glycogen synthase.",
      r: ["Correct. UDP-glucose is the active glucosyl donor in glycogen synthesis.", "Incorrect. ADP-glucose is used in plant starch synthesis.", "Incorrect. CDP-diacylglycerol is used in phospholipid synthesis.", "Incorrect. G1P must be activated by UTP."],
      kp: "UDP-glucose is the activated glucosyl donor utilized by glycogen synthase to elongate glycogen chains.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-140",
      q: "Which primer protein initiates de novo glycogen synthesis by autoglucosylating its own tyrosine residue before glycogen synthase can take over?",
      o: ["Glycogenin", "Phosphorylase kinase", "Branching enzyme", "Calmodulin"],
      a: 0,
      exp: "Glycogenin is a homodimeric glucosyltransferase that attaches up to eight glucose residues to a specific tyrosine-194 residue on itself, forming the primer required by glycogen synthase.",
      r: ["Correct. Glycogenin auto-catalyzes initial glucosyl primer assembly on a tyrosine residue.", "Incorrect. Phosphorylase kinase activates glycogen phosphorylase.", "Incorrect. Branching enzyme introduces alpha-1,6 branches.", "Incorrect. Calmodulin is a calcium sensor."],
      kp: "Glycogenin is a self-glucosylating protein that forms the initial oligosaccharide primer on tyrosine-194 for glycogen chain synthesis.",
      img: [], d: 1, cog: "recall"
    }
  ],

  // Module 11: bio-fatty-acid-synthesis
  "bio-fatty-acid-synthesis": [
    {
      id: "bk-bio-141",
      q: "Acetyl-CoA generated inside the mitochondrial matrix cannot cross the inner mitochondrial membrane into the cytosol for lipogenesis. In what form is it exported?",
      o: ["Citrate, via the tricarboxylate carrier", "Carnitine, via carnitine translocase", "Acetoacetate, via monocarboxylate transporter", "Oxaloacetate, via malate-alpha-ketoglutarate carrier"],
      a: 0,
      exp: "Mitochondrial acetyl-CoA condenses with oxaloacetate to form citrate via citrate synthase. Citrate is exported to the cytosol by the tricarboxylate carrier, where ATP-citrate lyase regenerates acetyl-CoA and oxaloacetate.",
      r: ["Correct. Citrate exports acetyl units across the inner mitochondrial membrane.", "Incorrect. Carnitine imports fatty acyl groups into matrix.", "Incorrect. Acetoacetate is a ketone body.", "Incorrect. Oxaloacetate does not cross the inner membrane directly."],
      kp: "The citrate shuttle exports mitochondrial acetyl-CoA into the cytosol as citrate; cytosolic ATP-citrate lyase cleaves it back into acetyl-CoA for lipogenesis.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-142",
      q: "Which enzyme catalyzes the committed rate-limiting step of fatty acid biosynthesis, adding carbon dioxide to acetyl-CoA using biotin and ATP?",
      o: ["Acetyl-CoA carboxylase (ACC)", "Fatty acid synthase", "ATP-citrate lyase", "Malic enzyme"],
      a: 0,
      exp: "Acetyl-CoA carboxylase (ACC) catalyzes the carboxylation of acetyl-CoA to malonyl-CoA using biotin, ATP, and bicarbonate. This is the rate-limiting step of lipogenesis.",
      r: ["Correct. Acetyl-CoA carboxylase is the rate-limiting committed enzyme of fatty acid synthesis.", "Incorrect. Fatty acid synthase carries out chain elongation.", "Incorrect. ATP-citrate lyase generates cytosolic acetyl-CoA.", "Incorrect. Malic enzyme generates NADPH."],
      kp: "Acetyl-CoA carboxylase (ACC) catalyzes the committed rate-limiting step of fatty acid synthesis, converting acetyl-CoA to malonyl-CoA using biotin and ATP.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-143",
      q: "How does insulin promote de novo fatty acid synthesis in the liver after a carbohydrate-rich meal?",
      o: ["Activates protein phosphatase-2A to dephosphorylate and activate acetyl-CoA carboxylase", "Inhibits ATP-citrate lyase to preserve mitochondrial citrate", "Phosphorylates AMP-activated protein kinase (AMPK)", "Inhibits fatty acid synthase transcription"],
      a: 0,
      exp: "Insulin stimulates protein phosphatase-2A, which dephosphorylates acetyl-CoA carboxylase, shifting it into its active polymerized filamentous form. Insulin also induces ACC and FAS gene expression via SREBP-1c.",
      r: ["Correct. Insulin dephosphorylates and activates ACC via protein phosphatase-2A.", "Incorrect. Insulin stimulates ATP-citrate lyase.", "Incorrect. Insulin suppresses AMPK.", "Incorrect. Insulin strongly induces FAS transcription via SREBP-1c."],
      kp: "Insulin activates acetyl-CoA carboxylase by stimulating its dephosphorylation via protein phosphatase-2A and inducing SREBP-1c transcription.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-144",
      q: "Which two metabolic pathways provide the vast majority of the cytosolic NADPH reducing equivalents required by fatty acid synthase for palmitate elongation?",
      o: ["Pentose phosphate pathway (HMP shunt) and cytosolic malic enzyme", "Glycolysis and Citric acid cycle", "Beta-oxidation and Ketogenesis", "Electron transport chain and Glycogenolysis"],
      a: 0,
      exp: "The hexose monophosphate shunt (via G6PD and 6-phosphogluconate dehydrogenase) and cytosolic malic enzyme (converting malate to pyruvate while reducing NADP+ to NADPH) generate all NADPH for lipogenesis.",
      r: ["Correct. HMP shunt and malic enzyme are the primary cytosolic NADPH sources.", "Incorrect. Glycolysis and TCA generate NADH and FADH2, not NADPH.", "Incorrect. Beta-oxidation occurs in mitochondria.", "Incorrect. ETC does not synthesize NADPH."],
      kp: "The pentose phosphate pathway and cytosolic malic enzyme provide the NADPH reducing equivalents required for de novo fatty acid synthesis.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-145",
      q: "The mammalian fatty acid synthase (FAS) complex is a multifunctional homodimer. What prosthetic group on the acyl carrier protein (ACP) domain anchors the growing fatty acyl chain?",
      o: ["4'-phosphopantetheine (derived from pantothenic acid, Vitamin B5)", "Thiamine pyrophosphate (B1)", "Biotin (B7)", "Tetrahydrofolate (B9)"],
      a: 0,
      exp: "The ACP domain contains a covalently linked 4'-phosphopantetheine arm (identical to that in coenzyme A), whose flexible sulfhydryl terminal swings the growing acyl chain between active catalytic centers.",
      r: ["Correct. 4'-phosphopantetheine anchors the acyl chain on ACP.", "Incorrect. TPP is for decarboxylations.", "Incorrect. Biotin is in carboxylases.", "Incorrect. THF transfers single-carbon units."],
      kp: "The acyl carrier protein (ACP) domain of fatty acid synthase uses a 4'-phosphopantetheine arm derived from pantothenic acid to anchor the growing acyl chain.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-146",
      q: "What is the final enzyme activity of the fatty acid synthase complex that cleaves the completed sixteen-carbon palmitate from the acyl carrier protein?",
      o: ["Thioesterase", "Beta-ketoacyl synthase", "Enoyl-ACP reductase", "Malonyl-CoA transferase"],
      a: 0,
      exp: "When the fatty acyl chain reaches sixteen carbons (palmitoyl-ACP), the thioesterase domain specifically hydrolyzes the thioester bond, releasing free palmitic acid into the cytosol.",
      r: ["Correct. Thioesterase hydrolyzes the completed palmitoyl-S-ACP bond.", "Incorrect. Beta-ketoacyl synthase performs condensation.", "Incorrect. Enoyl reductase reduces double bonds.", "Incorrect. Malonyl transferase loads malonyl units."],
      kp: "The thioesterase domain of fatty acid synthase terminates synthesis by hydrolyzing the completed sixteen-carbon palmitate from the ACP phosphopantetheine group.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-147",
      q: "Which transcription factor is induced by insulin and carbohydrate feeding to stimulate transcription of lipogenic genes (ACC, FAS, and ATP-citrate lyase) in hepatocytes?",
      o: ["SREBP-1c (Sterol regulatory element-binding protein 1c)", "PPAR-alpha", "CREB", "FOXO1"],
      a: 0,
      exp: "SREBP-1c is transcriptionally induced by insulin and cleavage-activated to enter the nucleus, driving expression of de novo lipogenic enzymes (ACC, FAS). In contrast, SREBP-2 primarily controls cholesterol genes.",
      r: ["Correct. SREBP-1c mediates insulin-induced upregulation of lipogenic enzymes.", "Incorrect. PPAR-alpha stimulates fatty acid oxidation.", "Incorrect. CREB stimulates gluconeogenesis in fasting.", "Incorrect. FOXO1 promotes gluconeogenesis and is inhibited by insulin."],
      kp: "SREBP-1c is the master transcriptional activator of hepatic fatty acid synthesis, upregulated by insulin after carbohydrate meals.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-148",
      q: "In adipose tissue, glycerol-3-phosphate required for triacylglycerol synthesis cannot be generated from glycerol because adipocytes lack which enzyme?",
      o: ["Glycerol kinase", "Glycerol-3-phosphate dehydrogenase", "Adipose triglyceride lipase", "Diacylglycerol acyltransferase"],
      a: 0,
      exp: "Adipocytes lack glycerol kinase (which is abundant in liver). Therefore, adipose tissue must generate glycerol-3-phosphate from glycolytic dihydroxyacetone phosphate (DHAP), making adipocyte fat synthesis strictly dependent on glucose uptake.",
      r: ["Correct. Adipocytes lack glycerol kinase, requiring glucose/DHAP for triacylglycerol synthesis.", "Incorrect. Glycerol-3-phosphate dehydrogenase is present in adipocytes to convert DHAP to G3P.", "Incorrect. ATGL mediates lipolysis.", "Incorrect. DGAT completes triglyceride synthesis."],
      kp: "Adipocytes lack glycerol kinase; they must generate glycerol-3-phosphate for triacylglycerol synthesis from glycolytic dihydroxyacetone phosphate (DHAP).",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-149",
      q: "Diacylglycerol acyltransferase (DGAT) catalyzes which final committed step in triacylglycerol biosynthesis?",
      o: ["Acylation of 1,2-diacylglycerol with a fatty acyl-CoA to form triacylglycerol", "Cleavage of triacylglycerol into diacylglycerol and free fatty acid", "Hydrolysis of phosphatidic acid to diacylglycerol", "Esterification of glycerol with the first fatty acid"],
      a: 0,
      exp: "DGAT catalyzes the addition of a third fatty acyl-CoA to 1,2-diacylglycerol, forming a completely neutral triacylglycerol molecule for droplet storage or VLDL assembly.",
      r: ["Correct. DGAT adds the third fatty acid to diacylglycerol, completing triglyceride synthesis.", "Incorrect. ATGL cleaves triglycerides.", "Incorrect. Lipin (phosphatidate phosphatase) converts phosphatidate to DAG.", "Incorrect. GPAT adds the first fatty acid."],
      kp: "Diacylglycerol acyltransferase (DGAT) catalyzes the final committed reaction in triacylglycerol synthesis, acylating diacylglycerol into triacylglycerol.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-150",
      q: "Abetalipoproteinemia is an autosomal recessive disorder caused by mutations in MTTP (microsomal triglyceride transfer protein). What lipid transport particle fails to assemble in hepatocytes and enterocytes?",
      o: ["ApoB-containing lipoproteins (chylomicrons, VLDL, and LDL)", "High-density lipoproteins (HDL)", "Albumin-fatty acid complexes", "Bile salt micelles"],
      a: 0,
      exp: "MTTP is required for loading lipids onto apolipoprotein B-48 in enterocytes and B-100 in hepatocytes. MTTP deficiency prevents assembly of chylomicrons and VLDL, causing severe fat malabsorption, acanthocytosis, and absent plasma ApoB.",
      r: ["Correct. MTTP deficiency blocks assembly of ApoB-containing lipoproteins (chylomicrons, VLDL).", "Incorrect. HDL assembly requires ABCA1 and ApoA-1, which is preserved.", "Incorrect. Free fatty acid binding to albumin is unaffected.", "Incorrect. Bile salts are made normally."],
      kp: "Abetalipoproteinemia results from MTTP mutations, preventing lipid loading onto ApoB and causing failure of chylomicron and VLDL assembly.",
      img: [], d: 2, cog: "application"
    }
  ],

  // Module 12: bio-cholesterol-steroids
  "bio-cholesterol-steroids": [
    {
      id: "bk-bio-151",
      q: "HMG-CoA reductase reduces 3-hydroxy-3-methylglutaryl-CoA into mevalonate. How many molecules of NADPH are consumed during this rate-limiting committed step of cholesterol synthesis?",
      o: ["2 molecules of NADPH", "1 molecule of NADPH", "3 molecules of NADPH", "4 molecules of NADPH"],
      a: 0,
      exp: "HMG-CoA reductase performs a two-step reduction of HMG-CoA to mevalonate, consuming two molecules of NADPH and releasing one molecule of free coenzyme A (CoA-SH).",
      r: ["Correct. 2 NADPH molecules are consumed per mevalonate synthesized.", "Incorrect. 1 NADPH is insufficient for the four-electron reduction.", "Incorrect. 3 NADPH is not the stoichiometric ratio.", "Incorrect. Only 2 NADPH are required."],
      kp: "HMG-CoA reductase consumes 2 molecules of NADPH to reduce HMG-CoA into mevalonate during the committed step of cholesterol biosynthesis.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-152",
      q: "In sterol-replete hepatocytes, how is HMG-CoA reductase targeted for rapid proteasomal degradation to downregulate cholesterol synthesis?",
      o: ["Sterol binding to Insig-1 promotes recruitment of membrane E3 ubiquitin ligases (gp78 / Trc8) that polyubiquitinate HMG-CoA reductase", "High cholesterol binds the active site as an irreversible suicide substrate", "Sterols stimulate lysosomal endocytosis of ER membranes", "AMPK dephosphorylates HMGCR to trigger cleavage"],
      a: 0,
      exp: "HMG-CoA reductase contains a membrane-spanning sterol-sensing domain. Excess sterols promote binding to Insig, which recruits E3 ubiquitin ligases, polyubiquitinating HMG-CoA reductase for 26S proteasomal destruction.",
      r: ["Correct. Sterols induce Insig-mediated ubiquitination and proteasomal degradation of HMGCR.", "Incorrect. Cholesterol does not act as a suicide inhibitor.", "Incorrect. It is degraded by 26S proteasomes via ERAD, not lysosomes.", "Incorrect. AMPK phosphorylates and inactivates HMGCR."],
      kp: "Excess cellular sterols trigger Insig binding to HMG-CoA reductase, recruiting E3 ubiquitin ligases for ERAD proteasomal destruction.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-153",
      q: "Statins lower circulating LDL cholesterol primarily by which physiological mechanism?",
      o: ["Depleting intracellular hepatocyte cholesterol, which triggers SREBP-2 translocation to induce LDL receptor expression", "Directly binding and degrading circulating ApoB-100 particles in blood", "Inhibiting intestinal cholesterol absorption via NPC1L1 transporter", "Increasing biliary bile salt secretion into feces"],
      a: 0,
      exp: "By competitively inhibiting HMG-CoA reductase, statins reduce hepatocyte intracellular cholesterol. The sterol deficit prompts SREBP-2 translocation to the nucleus, inducing cell-surface LDL receptor synthesis and clearing atherogenic LDL from blood.",
      r: ["Correct. Statins upregulate hepatic LDL receptors via SREBP-2 by depleting intracellular cholesterol.", "Incorrect. Statins do not directly degrade ApoB.", "Incorrect. Ezetimibe inhibits NPC1L1, not statins.", "Incorrect. Bile acid sequestrants increase fecal bile excretion."],
      kp: "Statins lower plasma LDL by depleting hepatic cholesterol, which activates SREBP-2 to upregulate cell-surface LDL receptor expression.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-154",
      q: "Which enzyme catalyzes the initial rate-limiting hydroxylation step in the classical hepatic pathway converting cholesterol into primary bile acids?",
      o: ["Cholesterol 7-alpha-hydroxylase (CYP7A1)", "Sterol 27-hydroxylase", "HMG-CoA reductase", "17-alpha-hydroxylase"],
      a: 0,
      exp: "Cholesterol 7-alpha-hydroxylase (CYP7A1) is an ER cytochrome P450 enzyme that catalyzes the rate-limiting step in primary bile acid synthesis (cholic acid and chenodeoxycholic acid). It is subject to feedback inhibition by bile acids via FXR.",
      r: ["Correct. CYP7A1 (Cholesterol 7-alpha-hydroxylase) is the rate-limiting enzyme of bile acid synthesis.", "Incorrect. CYP27A1 operates in the alternative pathway.", "Incorrect. HMGCR synthesizes cholesterol.", "Incorrect. CYP17A1 operates in adrenal steroidogenesis."],
      kp: "Cholesterol 7-alpha-hydroxylase (CYP7A1) catalyzes the committed rate-limiting step converting cholesterol into primary bile acids in the liver.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-155",
      q: "A female infant presents on day 10 of life with ambiguous genitalia, severe dehydration, hyponatremia, and hyperkalemia. Plasma 17-hydroxyprogesterone is markedly elevated. Which enzyme is deficient?",
      o: ["21-hydroxylase (CYP21A2)", "11-beta-hydroxylase (CYP11B1)", "17-alpha-hydroxylase (CYP17A1)", "3-beta-hydroxysteroid dehydrogenase"],
      a: 0,
      exp: "21-hydroxylase deficiency accounts for >90% of congenital adrenal hyperplasia. Failure to convert 17-OHP to 11-deoxycortisol causes cortisol and aldosterone deficiency (salt wasting, shock) and shunts precursors into androgens (virilization).",
      r: ["Correct. 21-hydroxylase deficiency causes salt-wasting CAH with elevated 17-OHP and virilization.", "Incorrect. 11-beta-hydroxylase deficiency accumulates 11-DOC, causing hypertension, not salt wasting.", "Incorrect. 17-alpha-hydroxylase deficiency causes hypokalemia, hypertension, and feminization.", "Incorrect. 3-beta-HSD deficiency causes elevated DHEA."],
      kp: "21-hydroxylase (CYP21A2) deficiency is the most common CAH, presenting with salt-wasting crisis (hyponatremia, hyperkalemia) and ambiguous genitalia due to accumulated 17-hydroxyprogesterone shunted into androgens.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-156",
      q: "Which enzyme deficiency in congenital adrenal hyperplasia produces virilization in female infants accompanied by severe early-onset hypertension due to accumulation of 11-deoxycorticosterone (11-DOC)?",
      o: ["11-beta-hydroxylase (CYP11B1)", "21-hydroxylase (CYP21A2)", "17-alpha-hydroxylase (CYP17A1)", "Aromatase (CYP19A1)"],
      a: 0,
      exp: "11-beta-hydroxylase deficiency prevents conversion of 11-DOC to corticosterone and 11-deoxycortisol to cortisol. Accumulated 11-DOC has potent mineralocorticoid activity, causing low-renin hypertension and hypokalemia, alongside androgen virilization.",
      r: ["Correct. 11-beta-hydroxylase deficiency causes virilization with hypertension due to mineralocorticoid 11-DOC.", "Incorrect. 21-hydroxylase deficiency causes hypotension and salt wasting.", "Incorrect. 17-alpha-hydroxylase deficiency causes female external genitalia in males and lack of virilization.", "Incorrect. Aromatase converts androgens to estrogens."],
      kp: "11-beta-hydroxylase (CYP11B1) deficiency causes congenital adrenal hyperplasia with virilization and hypertension secondary to 11-deoxycorticosterone accumulation.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-157",
      q: "What transport protein mediates the rate-limiting entry of free cholesterol from the outer mitochondrial membrane into the inner mitochondrial matrix to initiate steroidogenesis?",
      o: ["Steroidogenic acute regulatory (StAR) protein", "Carnitine palmitoyltransferase-1", "Mitochondrial outer membrane porin", "ABCA1 transporter"],
      a: 0,
      exp: "StAR protein translocates cholesterol across the intermembrane space to the inner mitochondrial membrane, where CYP11A1 (desmolase) resides. Mutations in StAR cause lethal congenital lipoid adrenal hyperplasia.",
      r: ["Correct. StAR protein mediates the rate-limiting mitochondrial import of cholesterol for steroidogenesis.", "Incorrect. CPT-1 transports fatty acylcarnitines.", "Incorrect. VDAC transports small metabolites non-specifically.", "Incorrect. ABCA1 exports cholesterol at the plasma membrane."],
      kp: "Steroidogenic acute regulatory (StAR) protein mediates the rate-limiting entry of cholesterol into the mitochondrial matrix to initiate steroid hormone synthesis.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-158",
      q: "Farnesyl pyrophosphate (FPP) is a key intermediate in the cholesterol biosynthetic pathway. Which cellular process relies on FPP and its derivative geranylgeranyl pyrophosphate to anchor signaling proteins (such as Ras and Rho) to the inner leaflet of the plasma membrane?",
      o: ["Protein prenylation (isoprenylation)", "N-linked glycosylation", "O-linked glycosylation", "Ubiquitination"],
      a: 0,
      exp: "FPP and GGPP provide hydrophobic 15- and 20-carbon isoprenoid tails that prenyltransferases attach to C-terminal CAAX cysteines of Ras and Rho GTPases, anchoring them to membranes for active signaling.",
      r: ["Correct. Protein prenylation attaches isoprenoid anchors derived from FPP to membrane signaling proteins.", "Incorrect. N-glycosylation uses dolichol phosphate.", "Incorrect. O-glycosylation adds sugars in Golgi.", "Incorrect. Ubiquitination is for degradation."],
      kp: "Farnesyl pyrophosphate and geranylgeranyl pyrophosphate provide lipid anchors for protein prenylation, essential for membrane localization of Ras and Rho GTPases.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-159",
      q: "What is the primary mechanism of action of ezetimibe in the treatment of hypercholesterolemia?",
      o: ["Selective inhibition of the Niemann-Pick C1-Like 1 (NPC1L1) transporter in the jejunal brush border", "Competitive inhibition of HMG-CoA reductase in hepatocytes", "Binding of bile acids in the intestinal lumen to prevent reabsorption", "Monoclonal antibody blockade of PCSK9 degradation of LDL receptors"],
      a: 0,
      exp: "Ezetimibe selectively inhibits NPC1L1 on the enterocyte brush border, blocking intestinal absorption of dietary and biliary cholesterol, reducing delivery of cholesterol to the liver.",
      r: ["Correct. Ezetimibe blocks the NPC1L1 transporter to inhibit intestinal cholesterol absorption.", "Incorrect. Statins inhibit HMG-CoA reductase.", "Incorrect. Cholestyramine binds bile acids.", "Incorrect. Evolocumab and alirocumab inhibit PCSK9."],
      kp: "Ezetimibe inhibits the NPC1L1 sterol transporter at the enterocyte brush border, reducing intestinal absorption of dietary and biliary cholesterol.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-160",
      q: "Evolocumab and alirocumab are monoclonal antibodies that lower LDL cholesterol by >50-60%. What protein do they inhibit to prevent the lysosomal degradation of cell-surface LDL receptors?",
      o: ["PCSK9 (Proprotein convertase subtilisin/kexin type 9)", "Apolipoprotein B-100", "Microsomal triglyceride transfer protein", "Cholesteryl ester transfer protein (CETP)"],
      a: 0,
      exp: "PCSK9 normally binds the LDL receptor on the cell surface and escorts it into lysosomes for degradation upon endocytosis. Inhibiting PCSK9 prevents receptor destruction, recycling LDLR back to the surface to maximize LDL clearance.",
      r: ["Correct. PCSK9 monoclonal antibodies prevent lysosomal destruction of LDL receptors, boosting receptor recycling.", "Incorrect. ApoB-100 is the structural protein on LDL.", "Incorrect. MTTP assembles lipoproteins.", "Incorrect. CETP transfers cholesteryl esters between lipoproteins."],
      kp: "PCSK9 inhibitors prevent targeted lysosomal degradation of LDL receptors, increasing receptor recycling to clear circulating atherogenic LDL particles.",
      img: [], d: 2, cog: "recall"
    }
  ],

  // Module 13: bio-purine-pyrimidine
  "bio-purine-pyrimidine": [
    {
      id: "bk-bio-161",
      q: "Which enzyme catalyzes the committed rate-limiting step of de novo purine nucleotide biosynthesis, converting PRPP to 5-phosphoribosylamine?",
      o: ["Glutamine-PRPP amidotransferase", "PRPP synthetase", "Inosine monophosphate dehydrogenase", "Adenylosuccinate synthetase"],
      a: 0,
      exp: "Glutamine-PRPP amidotransferase transfers an amino group from glutamine to PRPP, forming 5-phosphoribosylamine. It is feedback inhibited by AMP, GMP, and IMP, and stimulated by PRPP.",
      r: ["Correct. Glutamine-PRPP amidotransferase catalyzes the committed step of purine synthesis.", "Incorrect. PRPP synthetase activates ribose-5-P but PRPP is also used for pyrimidines and salvage.", "Incorrect. IMPDH is the committed step for GMP specifically.", "Incorrect. Adenylosuccinate synthetase leads to AMP."],
      kp: "Glutamine-PRPP amidotransferase catalyzes the committed rate-limiting reaction of de novo purine synthesis, feedback inhibited by AMP, GMP, and IMP.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-162",
      q: "In de novo pyrimidine biosynthesis, which cytosolic enzyme catalyzes the rate-limiting formation of carbamoyl phosphate using glutamine, CO2, and two ATP molecules?",
      o: ["Carbamoyl phosphate synthetase II (CPS-II)", "Carbamoyl phosphate synthetase I (CPS-I)", "Aspartate transcarbamoylase", "Dihydroorotase"],
      a: 0,
      exp: "Cytosolic CPS-II synthesizes carbamoyl phosphate for pyrimidine synthesis using glutamine as nitrogen donor, inhibited by UTP and activated by PRPP. Mitochondrial CPS-I uses ammonium for the urea cycle.",
      r: ["Correct. CPS-II is the cytosolic rate-limiting enzyme of pyrimidine synthesis.", "Incorrect. CPS-I is mitochondrial and participates in the urea cycle.", "Incorrect. Aspartate transcarbamoylase condenses carbamoyl phosphate with aspartate.", "Incorrect. Dihydroorotase closes the pyrimidine ring."],
      kp: "Carbamoyl phosphate synthetase II (CPS-II) is cytosolic, uses glutamine, and catalyzes the rate-limiting step of de novo pyrimidine biosynthesis.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-163",
      q: "A 14-month-old boy is brought to the clinic for developmental delay, spastic cerebral palsy, dystonic posturing, and orange sandy crystals in his diapers. The mother notes he compulsively bites his lips and fingertips. Which enzyme is deficient?",
      o: ["Hypoxanthine-guanine phosphoribosyltransferase (HGPRT)", "Adenine phosphoribosyltransferase (APRT)", "Adenosine deaminase (ADA)", "Xanthine oxidase"],
      a: 0,
      exp: "Lesch-Nyhan syndrome is an X-linked recessive disorder caused by complete HGPRT deficiency. Purine salvage fails, causing PRPP accumulation, massive purine de novo synthesis, extreme hyperuricemia, gout, choreoathetosis, and compulsive self-mutilation.",
      r: ["Correct. Complete HGPRT deficiency causes Lesch-Nyhan syndrome with self-mutilation and hyperuricemia.", "Incorrect. APRT deficiency causes 2,8-dihydroxyadenine radiolucent kidney stones without self-mutilation.", "Incorrect. ADA deficiency causes severe combined immunodeficiency (SCID).", "Incorrect. Xanthine oxidase deficiency causes xanthinuria with low uric acid."],
      kp: "Lesch-Nyhan syndrome is an X-linked recessive deficiency of HGPRT, characterized by choreoathetosis, cognitive impairment, compulsive self-mutilation, and severe hyperuricemia.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-164",
      q: "Adenosine deaminase (ADA) deficiency causes severe combined immunodeficiency (SCID). What is the cellular toxic mechanism that depletes both T and B lymphocytes?",
      o: ["Accumulation of dATP allosterically inhibits ribonucleotide reductase, blocking DNA synthesis in dividing lymphoblasts", "Depletion of ATP halts T-cell receptor transcription", "Accumulation of uric acid crystals inside thymic parenchyma", "Inhibition of dihydrofolate reductase in bone marrow"],
      a: 0,
      exp: "In ADA deficiency, adenosine and deoxyadenosine accumulate; cellular kinases phosphorylate deoxyadenosine to dATP. Excess dATP allosterically binds the activity site of ribonucleotide reductase, shutting off deoxynucleotide production and killing dividing lymphocytes.",
      r: ["Correct. dATP accumulation allosterically inhibits ribonucleotide reductase, crippling DNA synthesis.", "Incorrect. ATP is not depleted.", "Incorrect. Uric acid is actually decreased in ADA deficiency.", "Incorrect. Methotrexate inhibits DHFR, not ADA."],
      kp: "Adenosine deaminase (ADA) deficiency elevates deoxyadenosine and dATP, which allosterically inhibits ribonucleotide reductase, starving lymphocytes of dNTPs and causing SCID.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-165",
      q: "A 9-month-old infant presents with megaloblastic anemia refractory to vitamin B12 and folate, failure to thrive, and developmental delay. Urinalysis shows massive excretion of orotic acid crystals. Blood ammonia is normal. Which condition is present?",
      o: ["Hereditary orotic aciduria (deficiency of UMP synthase)", "Ornithine transcarbamylase (OTC) deficiency", "Carbamoyl phosphate synthetase I deficiency", "Lesch-Nyhan syndrome"],
      a: 0,
      exp: "Hereditary orotic aciduria is an autosomal recessive deficiency of UMP synthase (bifunctional orotate phosphoribosyltransferase and OMP decarboxylase). Blood ammonia is normal (unlike OTC deficiency where hyperammonemia is prominent). Treatment is oral uridine.",
      r: ["Correct. UMP synthase deficiency causes hereditary orotic aciduria with megaloblastic anemia and normal ammonia.", "Incorrect. OTC deficiency causes marked hyperammonemia and respiratory alkalosis.", "Incorrect. CPS-I deficiency causes hyperammonemia with low orotic acid.", "Incorrect. Lesch-Nyhan causes hyperuricemia, not orotic aciduria."],
      kp: "Hereditary orotic aciduria (UMP synthase deficiency) presents with megaloblastic anemia and urinary orotic acid with normal ammonia, treated with oral uridine.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-166",
      q: "Allopurinol is metabolized by xanthine oxidase into oxypurinol (alloxanthine), which acts as which type of inhibitor against xanthine oxidase?",
      o: ["Suicide (mechanism-based) irreversible inhibitor that remains tightly bound to the molybdenum active site", "Reversible competitive inhibitor easily displaced by xanthine", "Allosteric activator of hypoxanthine salvage", "Feedback inhibitor of PRPP synthetase"],
      a: 0,
      exp: "Allopurinol is oxidized by xanthine oxidase to oxypurinol, which coordinates tightly to the reduced molybdenum(IV) center of the enzyme as a mechanism-based suicide inhibitor, inactivating it for hours.",
      r: ["Correct. Oxypurinol coordinates tightly to the active-site molybdenum as a mechanism-based inhibitor.", "Incorrect. It acts as a suicide/tight-binding inhibitor, not a simple easily displaced competitive drug.", "Incorrect. It does not activate salvage directly.", "Incorrect. It does not bind PRPP synthetase."],
      kp: "Allopurinol is converted by xanthine oxidase into oxypurinol, which acts as a mechanism-based inhibitor binding the active-site molybdenum to suppress uric acid synthesis.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-167",
      q: "Which enzyme converts ribonucleotides (NDPs) into deoxyribonucleotides (dNDPs) required for DNA replication, and is inhibited by hydroxyurea in sickle cell disease?",
      o: ["Ribonucleotide reductase", "Thymidylate synthase", "Dihydrofolate reductase", "DNA polymerase alpha"],
      a: 0,
      exp: "Ribonucleotide reductase reduces all four ribonucleoside diphosphates (ADP, GDP, CDP, UDP) to their corresponding deoxy forms (dNDPs). Hydroxyurea scavenges the tyrosyl free radical in the active site, inhibiting the enzyme.",
      r: ["Correct. Ribonucleotide reductase converts ribonucleotides to deoxyribonucleotides and is inhibited by hydroxyurea.", "Incorrect. Thymidylate synthase converts dUMP to dTMP, inhibited by 5-FU.", "Incorrect. DHFR reduces DHF to THF, inhibited by methotrexate.", "Incorrect. DNA polymerase replicates DNA."],
      kp: "Ribonucleotide reductase reduces ribonucleoside diphosphates to deoxyribonucleoside diphosphates; it is inhibited by hydroxyurea and allosterically regulated by dATP.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-168",
      q: "5-Fluorouracil (5-FU) is a widely used antineoplastic antimetabolite. Its intracellular metabolite 5-FdUMP potently inhibits which enzyme to block thymidine synthesis?",
      o: ["Thymidylate synthase", "Dihydrofolate reductase", "Ribonucleotide reductase", "PRPP amidotransferase"],
      a: 0,
      exp: "5-FdUMP covalently binds thymidylate synthase and N5,N10-methylene-THF, forming a suicide ternary inhibitory complex that permanently halts conversion of dUMP to dTMP, starving tumor cells of thymidine.",
      r: ["Correct. 5-FdUMP forms an irreversible suicide complex with thymidylate synthase.", "Incorrect. Methotrexate inhibits dihydrofolate reductase.", "Incorrect. Hydroxyurea inhibits ribonucleotide reductase.", "Incorrect. 6-mercaptopurine inhibits PRPP amidotransferase."],
      kp: "5-Fluorouracil (via 5-FdUMP) acts as a suicide inhibitor of thymidylate synthase, depleting dTMP required for DNA synthesis.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-169",
      q: "Methotrexate and trimethoprim inhibit which enzyme required to regenerate tetrahydrofolate (THF) from dihydrofolate (DHF)?",
      o: ["Dihydrofolate reductase (DHFR)", "Thymidylate synthase", "Serine hydroxymethyltransferase", "Methionine synthase"],
      a: 0,
      exp: "Dihydrofolate reductase (DHFR) reduces DHF back to active THF. Methotrexate (human) and trimethoprim (bacterial) competitively inhibit DHFR, depleting the THF pool needed for purine and thymidylate synthesis.",
      r: ["Correct. Methotrexate and trimethoprim inhibit dihydrofolate reductase (DHFR).", "Incorrect. Thymidylate synthase generates DHF from methylene-THF.", "Incorrect. Serine hydroxymethyltransferase transfers hydroxymethyl groups.", "Incorrect. Methionine synthase requires B12."],
      kp: "Methotrexate competitively inhibits dihydrofolate reductase (DHFR), trapping folate as inactive dihydrofolate and halting purine and dTMP synthesis.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-170",
      q: "Which immunosuppressive antimetabolite is metabolized to 6-thiosine monophosphate (6-TIMP) by HGPRT, inhibiting glutamine-PRPP amidotransferase and de novo purine synthesis in lymphocytes?",
      o: ["6-Mercaptopurine (and its prodrug Azathioprine)", "Mycophenolate mofetil", "Cyclophosphamide", "Tacrolimus"],
      a: 0,
      exp: "Azathioprine is converted to 6-mercaptopurine, which is activated by HGPRT to 6-TIMP. 6-TIMP inhibits PRPP amidotransferase and IMP dehydrogenase, suppressing purine synthesis in rapidly dividing lymphocytes.",
      r: ["Correct. 6-MP and azathioprine are salvaged by HGPRT to active purine synthesis inhibitors.", "Incorrect. Mycophenolate mofetil inhibits IMP dehydrogenase directly.", "Incorrect. Cyclophosphamide is an alkylating agent.", "Incorrect. Tacrolimus is a calcineurin inhibitor."],
      kp: "Azathioprine and 6-mercaptopurine require HGPRT activation to 6-TIMP to inhibit de novo purine synthesis; co-administration with allopurinol causes severe marrow toxicity.",
      img: [], d: 2, cog: "application"
    }
  ],

  // Module 14: bio-complex-carbs
  "bio-complex-carbs": [
    {
      id: "bk-bio-171",
      q: "Which glycosaminoglycan is unique because it is entirely non-sulfated, is not covalently attached to a core protein, and is synthesized at the plasma membrane rather than in the Golgi apparatus?",
      o: ["Hyaluronic acid (hyaluronan)", "Chondroitin sulfate", "Heparan sulfate", "Keratan sulfate"],
      a: 0,
      exp: "Hyaluronic acid is an enormous non-sulfated GAG composed of D-glucuronic acid and N-acetylglucosamine. It is synthesized by plasma membrane hyaluronan synthases and acts as a central backbone for proteoglycan aggregates.",
      r: ["Correct. Hyaluronic acid is non-sulfated, lacks covalent protein core attachment, and is made at the plasma membrane.", "Incorrect. Chondroitin sulfate is sulfated and linked to core proteins in Golgi.", "Incorrect. Heparan sulfate is sulfated in Golgi.", "Incorrect. Keratan sulfate is sulfated."],
      kp: "Hyaluronic acid is the only non-sulfated GAG not covalently bound to a core protein; it is synthesized at the cell surface to serve as the backbone for proteoglycan aggregates.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-172",
      q: "In articular cartilage, how do chondroitin sulfate and keratan sulfate chains attached to aggrecan confer resistance to compressive biomechanical forces?",
      o: ["Abundant negative sulfate and carboxyl charges repel each other and attract hydrated sodium cations, creating a swollen elastic cushion", "They form rigid triple helices that resist bending", "They form covalent crosslinks with mineralized hydroxyapatite", "They polymerize into insoluble cross-beta sheet fibrils"],
      a: 0,
      exp: "Dense negative charges on sulfate and carboxyl groups create charge repulsion, keeping GAG chains extended. They attract Na+ ions and water, creating osmotic swelling pressure that resists compressive joint loading.",
      r: ["Correct. Negative charge density attracts water to generate osmotic swelling pressure against compression.", "Incorrect. Triple helices are characteristic of collagen.", "Incorrect. Proteoglycans do not crosslink mineral directly in cartilage.", "Incorrect. Beta-sheet fibrils describe amyloid."],
      kp: "The high negative charge density of sulfated GAGs attracts water and sodium, generating high swelling pressure that absorbs compressive mechanical loads in articular cartilage.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-173",
      q: "A 2-year-old child presents with coarse facial features, corneal clouding, hepatosplenomegaly, umbilical hernia, and severe dysostosis multiplex on skeletal survey. What is the diagnosis and deficient enzyme?",
      o: ["Hurler syndrome (MPS I), alpha-L-iduronidase deficiency", "Hunter syndrome (MPS II), iduronate sulfatase deficiency", "Sanfilippo syndrome (MPS III), heparan sulfamidase deficiency", "Morquio syndrome (MPS IV), galactosamine-6-sulfatase deficiency"],
      a: 0,
      exp: "Hurler syndrome (MPS I) is an autosomal recessive deficiency of alpha-L-iduronidase. Dermatan and heparan sulfate accumulate, causing coarse facial features, severe corneal clouding, dysostosis multiplex, and mental deficiency.",
      r: ["Correct. Hurler syndrome features alpha-L-iduronidase deficiency with corneal clouding and dysostosis.", "Incorrect. Hunter syndrome is X-linked and lacks corneal clouding.", "Incorrect. Sanfilippo syndrome presents with childhood dementia and mild skeletal changes.", "Incorrect. Morquio syndrome features skeletal dysplasia with normal intellect and clear corneas."],
      kp: "Hurler syndrome (MPS I) is caused by autosomal recessive alpha-L-iduronidase deficiency, marked by coarse facies, corneal clouding, dysostosis multiplex, and intellectual disability.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-174",
      q: "Hunter syndrome (MPS II) is clinically distinguished from Hurler syndrome (MPS I) by which two key characteristics?",
      o: ["X-linked recessive inheritance and ABSENCE of corneal clouding (clear corneas)", "Autosomal recessive inheritance and severe corneal clouding", "Presence of hypertrophic cardiomyopathy alone", "Accumulation of keratan sulfate without heparan sulfate"],
      a: 0,
      exp: "Hunter syndrome is caused by iduronate-2-sulfatase deficiency. It is unique among the mucopolysaccharidoses in being X-linked recessive, and affected boys characteristically have clear corneas (no corneal clouding).",
      r: ["Correct. Hunter syndrome is X-linked recessive and features clear corneas without clouding.", "Incorrect. Hurler syndrome is autosomal recessive with corneal clouding.", "Incorrect. Cardiomyopathy occurs in Pompe disease and late MPS.", "Incorrect. Dermatan and heparan sulfate accumulate in both MPS I and II."],
      kp: "Hunter syndrome (MPS II) is X-linked recessive and caused by iduronate-2-sulfatase deficiency; it features clear corneas, contrasting with corneal clouding in Hurler syndrome.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-175",
      q: "A 4-year-old boy presents with progressive behavioral hyperactivity, sleep disturbances, loss of speech milestones, and aggressive outbursts, but minimal skeletal deformities and no corneal clouding. What is the diagnosis?",
      o: ["Sanfilippo syndrome (MPS III), impaired heparan sulfate degradation", "Hurler syndrome (MPS I)", "Gaucher disease", "Tay-Sachs disease"],
      a: 0,
      exp: "Sanfilippo syndrome (MPS III) involves failure to degrade heparan sulfate exclusively. It presents primarily with severe, progressive central nervous system neurodegeneration, sleep disruption, and hyperactivity with mild somatic features.",
      r: ["Correct. Sanfilippo syndrome is marked by severe progressive dementia and hyperactivity from heparan sulfate accumulation.", "Incorrect. Hurler syndrome has prominent somatic and corneal features.", "Incorrect. Gaucher disease causes splenomegaly and bone crises.", "Incorrect. Tay-Sachs causes infantile regression with cherry-red spot."],
      kp: "Sanfilippo syndrome (MPS III) is characterized by severe childhood dementia, behavioral disturbances, and sleep disruption due to isolated heparan sulfate accumulation with mild somatic signs.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-176",
      q: "Morquio syndrome (MPS IV) is distinct from other mucopolysaccharidoses because patients have severe skeletal dysplasia (short trunk dwarfism, pectus carinatum, odontoid hypoplasia) but retain which physiological attribute?",
      o: ["Completely normal intelligence and intellectual development", "Normal bone mineralization", "Normal cardiac valve architecture", "Absence of urinary glycosaminoglycans"],
      a: 0,
      exp: "Morquio syndrome (defective keratan sulfate breakdown) causes severe skeletal dysplasia and atlantoaxial instability from odontoid hypoplasia, but intelligence is completely normal because keratan sulfate is absent from brain parenchyma.",
      r: ["Correct. Morquio syndrome patients have preserved normal intellect despite severe skeletal dysplasia.", "Incorrect. Skeletal dysplasia is severe.", "Incorrect. Heart valves frequently develop regurgitation.", "Incorrect. Urine is positive for keratan sulfate."],
      kp: "Morquio syndrome (MPS IV) features severe skeletal dysplasia, odontoid hypoplasia, and corneal opacities, but intelligence remains completely preserved.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-177",
      q: "What is the specific trisaccharide linker that covalently attaches glycosaminoglycan chains to serine residues of core proteins in proteoglycans?",
      o: ["Xylose-Galactose-Galactose", "Glucose-Glucose-Mannose", "Mannose-GlcNAc-GlcNAc", "Sialic acid-Galactose-Glucose"],
      a: 0,
      exp: "Proteoglycan O-linked synthesis begins in the ER/Golgi with the attachment of xylose to a core protein serine, followed by two galactose residues, forming the universal Xylose-Gal-Gal linker.",
      r: ["Correct. Xylose-Gal-Gal is the universal linker trisaccharide.", "Incorrect. Glucose-glucose-mannose is not the linker.", "Incorrect. Mannose-GlcNAc is found in N-linked glycoprotein cores.", "Incorrect. Sialic acid is a terminal capping sugar."],
      kp: "Glycosaminoglycan chains are covalently linked to proteoglycan core proteins via a specific Xylose-Galactose-Galactose trisaccharide attached to serine.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-178",
      q: "Heparin, widely utilized as a clinical parenteral anticoagulant, exerts its therapeutic effect by binding to which circulating plasma inhibitor via a specific high-affinity pentasaccharide sequence?",
      o: ["Antithrombin III (AT-III)", "Protein C", "Tissue factor pathway inhibitor", "Alpha-2 antiplasmin"],
      a: 0,
      exp: "Heparin contains a unique pentasaccharide sequence that binds antithrombin III, inducing a conformational change that accelerates AT-III inhibition of thrombin and factor Xa by up to 1,000-fold.",
      r: ["Correct. Heparin binds antithrombin III via a specific pentasaccharide sequence.", "Incorrect. Protein C is activated by thrombomodulin.", "Incorrect. TFPI inhibits Xa/tissue factor.", "Incorrect. Alpha-2 antiplasmin inhibits plasmin."],
      kp: "Heparin binds antithrombin III via a specific pentasaccharide sequence, accelerating its irreversible inhibition of thrombin (IIa) and Factor Xa by 1,000-fold.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-179",
      q: "I-cell disease (mucolipidosis II) is a severe lysosomal storage disorder caused by deficiency of GlcNAc phosphotransferase. Why do lysosomal acid hydrolases fail to reach lysosomes?",
      o: ["Failure to phosphorylate mannose residues to mannose-6-phosphate in the Golgi routes enzymes to the extracellular default secretion pathway", "Enzymes are degraded in the proteasome by ERAD", "Lysosomal membranes lack vacuolar proton pumps", "Enzymes undergo premature peptide cleavage in rough ER"],
      a: 0,
      exp: "Mannose-6-phosphate (M6P) is the recognition tag that targets acid hydrolases from the Golgi to lysosomes. Without GlcNAc phosphotransferase, enzymes lack M6P and are default-secreted into plasma, causing empty lysosomes with inclusion bodies.",
      r: ["Correct. Absent M6P tag causes mistargeting of lysosomal hydrolases into extracellular blood.", "Incorrect. Enzymes fold normally and escape ERAD.", "Incorrect. Proton pumps are intact.", "Incorrect. Synthesis in ER is normal."],
      kp: "I-cell disease results from GlcNAc phosphotransferase deficiency; lacking the mannose-6-phosphate sorting tag, lysosomal enzymes are secreted into plasma, leaving empty inclusion-filled lysosomes.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-180",
      q: "Enzyme replacement therapy with laronidase is an approved recombinant therapeutic for which specific inborn error of metabolism?",
      o: ["Hurler syndrome (MPS I)", "Hunter syndrome (MPS II)", "Sanfilippo syndrome (MPS III)", "Fabry disease"],
      a: 0,
      exp: "Laronidase is recombinant human alpha-L-iduronidase, administered intravenously to degrade accumulated dermatan and heparan sulfate in patients with Hurler syndrome (MPS I).",
      r: ["Correct. Laronidase is recombinant alpha-L-iduronidase for Hurler syndrome (MPS I).", "Incorrect. Idursulfase is used for Hunter syndrome (MPS II).", "Incorrect. Enzyme replacement is not established for Sanfilippo.", "Incorrect. Agalsidase is used for Fabry disease."],
      kp: "Laronidase is recombinant alpha-L-iduronidase used for enzyme replacement therapy in Hurler syndrome (MPS I).",
      img: [], d: 1, cog: "recall"
    }
  ],

  // Module 15: bio-sphingolipids-lysosomal
  "bio-sphingolipids-lysosomal": [
    {
      id: "bk-bio-181",
      q: "A 32-year-old Ashkenazi Jewish woman presents with fatigue, splenomegaly, severe thrombocytopenia, and bone pain. Radiographs demonstrate an 'Erlenmeyer flask' deformity of the distal femur. Bone marrow biopsy reveals lipid-laden macrophages resembling 'wrinkled tissue paper'. Which condition is present?",
      o: ["Gaucher disease (Type 1), beta-glucocerebrosidase deficiency", "Niemann-Pick disease type A", "Tay-Sachs disease", "Fabry disease"],
      a: 0,
      exp: "Gaucher disease is the most common lysosomal storage disorder, caused by beta-glucocerebrosidase deficiency. Glucosylceramide accumulates in macrophages (Gaucher cells with wrinkled paper cytoplasm), causing splenomegaly, pancytopenia, and bone crises.",
      r: ["Correct. Gaucher disease features wrinkled paper macrophages, bone crises, and splenomegaly.", "Incorrect. Niemann-Pick cells are foamy histiocytes with sea-blue granules.", "Incorrect. Tay-Sachs has no organomegaly or bone involvement.", "Incorrect. Fabry disease presents with angiokeratomas and acroparesthesias."],
      kp: "Gaucher disease is caused by beta-glucocerebrosidase deficiency; Gaucher macrophages with 'wrinkled tissue paper' cytoplasm cause bone crises, Erlenmeyer flask deformities, and splenomegaly.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-182",
      q: "A 6-month-old infant presents with developmental regression, exaggerated startle reflex to sound (hyperacusis), and progressive blindness. Fundoscopy demonstrates a bright cherry-red spot at the macula. Abdominal examination reveals NO hepatomegaly or splenomegaly. Which enzyme is deficient?",
      o: ["Hexosaminidase A (Tay-Sachs disease)", "Acid sphingomyelinase (Niemann-Pick disease)", "Beta-glucocerebrosidase (Gaucher disease)", "Galactocerebrosidase (Krabbe disease)"],
      a: 0,
      exp: "Tay-Sachs disease is hexosaminidase A deficiency with GM2 ganglioside storage. Progressive neurodegeneration, hyperacusis, and macular cherry-red spot without hepatosplenomegaly are classic. In contrast, Niemann-Pick has prominent hepatosplenomegaly.",
      r: ["Correct. Tay-Sachs disease features cherry-red spot and neurodegeneration without hepatosplenomegaly.", "Incorrect. Niemann-Pick disease features prominent hepatosplenomegaly.", "Incorrect. Gaucher disease lacks cherry-red spot in Type 1.", "Incorrect. Krabbe disease features globoid cells without macular cherry-red spot."],
      kp: "Tay-Sachs disease (hexosaminidase A deficiency) presents with hyperacusis, neurodegeneration, and macular cherry-red spot without hepatosplenomegaly.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-183",
      q: "How does Niemann-Pick disease type A differ clinically from Tay-Sachs disease, despite both conditions presenting with a macular cherry-red spot in infancy?",
      o: ["Niemann-Pick features prominent hepatosplenomegaly and foamy histiocytes due to acid sphingomyelinase deficiency", "Niemann-Pick features normal motor development throughout childhood", "Tay-Sachs disease causes massive splenomegaly and portal hypertension", "Tay-Sachs disease is inherited as an X-linked recessive trait"],
      a: 0,
      exp: "Niemann-Pick type A (acid sphingomyelinase deficiency) accumulates sphingomyelin, causing foamy histiocytes, macular cherry-red spot, and massive hepatosplenomegaly. Tay-Sachs has identical macular appearance but normal liver/spleen size.",
      r: ["Correct. Niemann-Pick has prominent hepatosplenomegaly, unlike Tay-Sachs.", "Incorrect. Both cause fatal early neurodegeneration.", "Incorrect. Tay-Sachs has no splenomegaly.", "Incorrect. Tay-Sachs is autosomal recessive."],
      kp: "Niemann-Pick disease features both a macular cherry-red spot and prominent hepatosplenomegaly with foamy histiocytes, differentiating it from Tay-Sachs which has no organomegaly.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-184",
      q: "A 12-year-old boy presents with severe burning pain in his hands and feet triggered by warm weather or exercise (acroparesthesias), clusters of non-blanching dark red maculopapules in the groin (angiokeratomas), and hypohidrosis. Which X-linked enzyme is deficient?",
      o: ["Alpha-galactosidase A (Fabry disease)", "Arylsulfatase A (Metachromatic leukodystrophy)", "Acid sphingomyelinase", "Beta-glucosidase"],
      a: 0,
      exp: "Fabry disease is an X-linked recessive sphingolipidosis caused by alpha-galactosidase A deficiency. Globotriaosylceramide (Gb3 / ceramide trihexoside) accumulates in vascular endothelium, causing acroparesthesias, angiokeratomas, and progressive renal failure.",
      r: ["Correct. Fabry disease is X-linked alpha-galactosidase A deficiency with angiokeratomas and burning pain.", "Incorrect. Metachromatic leukodystrophy causes demyelination without angiokeratomas.", "Incorrect. Acid sphingomyelinase causes Niemann-Pick.", "Incorrect. Beta-glucosidase causes Gaucher."],
      kp: "Fabry disease is an X-linked recessive deficiency of alpha-galactosidase A, presenting with episodic acroparesthesias, angiokeratomas, hypohidrosis, and premature renal failure.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-185",
      q: "Krabbe disease (globoid cell leukodystrophy) is an autosomal recessive neurodegenerative disorder caused by deficiency of galactocerebrosidase. What toxic metabolite accumulates in oligodendrocytes, destroying myelin?",
      o: ["Psychosine (galactosylsphingosine)", "Glucosylceramide", "GM1 ganglioside", "Ceramide trihexoside"],
      a: 0,
      exp: "Galactocerebrosidase deficiency prevents degradation of galactosylceramide and its deacylated derivative psychosine. Psychosine is highly cytotoxic to oligodendrocytes and Schwann cells, causing demyelination and globoid multinucleated macrophages.",
      r: ["Correct. Psychosine accumulation destroys myelin in Krabbe disease.", "Incorrect. Glucosylceramide accumulates in Gaucher.", "Incorrect. GM1 ganglioside accumulates in GM1 gangliosidosis.", "Incorrect. Ceramide trihexoside accumulates in Fabry."],
      kp: "Krabbe disease results from galactocerebrosidase deficiency, accumulating toxic psychosine that destroys oligodendrocytes and produces globoid macrophages.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-186",
      q: "Metachromatic leukodystrophy is caused by deficiency of arylsulfatase A, leading to lysosomal accumulation of which sphingolipid that stains metachromatically with cresyl violet?",
      o: ["Cerebroside sulfate (sulfatide)", "Glucocerebroside", "Sphingomyelin", "Globotriaosylceramide"],
      a: 0,
      exp: "Arylsulfatase A cleaves sulfate from cerebroside 3-sulfate. In metachromatic leukodystrophy, sulfatides accumulate in myelin-producing cells, shifting the absorption spectrum of cresyl violet dye (metachromasia) and causing central demyelination.",
      r: ["Correct. Arylsulfatase A deficiency causes sulfatide accumulation in metachromatic leukodystrophy.", "Incorrect. Glucocerebroside accumulates in Gaucher.", "Incorrect. Sphingomyelin accumulates in Niemann-Pick.", "Incorrect. Gb3 accumulates in Fabry."],
      kp: "Metachromatic leukodystrophy is caused by arylsulfatase A deficiency, accumulating sulfatides that cause central demyelination, ataxia, and dementia.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-187",
      q: "Which sphingolipid serves as the basic hydrophobic backbone for all cerebrosides, gangliosides, and sphingomyelin?",
      o: ["Ceramide (Sphingosine + fatty acid)", "Sphinganine", "Phosphatidylcholine", "Diacylglycerol"],
      a: 0,
      exp: "Ceramide consists of sphingosine joined to a long-chain fatty acid via an amide linkage. Addition of phosphocholine yields sphingomyelin; addition of carbohydrate headgroups generates glycosphingolipids.",
      r: ["Correct. Ceramide is the common core precursor for all sphingolipids.", "Incorrect. Sphinganine is an intermediate before ceramide formation.", "Incorrect. Phosphatidylcholine is a glycerophospholipid.", "Incorrect. Diacylglycerol has a glycerol backbone."],
      kp: "Ceramide, formed by an amide linkage between sphingosine and a fatty acid, is the structural parent molecule for all complex sphingolipids.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-188",
      q: "Miglustat and eliglustat are substrate reduction therapies approved for Gaucher disease type 1. What enzyme do they inhibit to reduce glucosylceramide synthesis?",
      o: ["Glucosylceramide synthase", "Glucocerebrosidase", "Acid ceramidase", "Sphingomyelin synthase"],
      a: 0,
      exp: "Miglustat and eliglustat are substrate reduction agents that competitively inhibit glucosylceramide synthase, decreasing the cellular rate of glucosylceramide production to match residual clearance capacity.",
      r: ["Correct. They inhibit glucosylceramide synthase to reduce substrate load.", "Incorrect. Glucocerebrosidase is the deficient enzyme.", "Incorrect. Acid ceramidase cleaves ceramide in Farber disease.", "Incorrect. Sphingomyelin synthase makes sphingomyelin."],
      kp: "Substrate reduction therapy with eliglustat inhibits glucosylceramide synthase, decreasing glucosylceramide synthesis in Gaucher disease.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-189",
      q: "Farber lipogranulomatosis is a rare lysosomal disorder characterized by painful subcutaneous nodules, joint contractures, and hoarseness due to laryngeal involvement. Which enzyme is deficient?",
      o: ["Acid ceramidase", "Galactocerebrosidase", "Arylsulfatase A", "Hexosaminidase B"],
      a: 0,
      exp: "Farber disease is caused by acid ceramidase deficiency, leading to ceramide accumulation in lysosomes throughout connective tissue and granuloma formation in joints, larynx, and subcutaneous tissues.",
      r: ["Correct. Acid ceramidase deficiency causes Farber lipogranulomatosis with painful nodules and hoarseness.", "Incorrect. Galactocerebrosidase causes Krabbe.", "Incorrect. Arylsulfatase A causes metachromatic leukodystrophy.", "Incorrect. Hexosaminidase B deficiency causes Sandhoff disease."],
      kp: "Farber disease is an autosomal recessive deficiency of acid ceramidase, causing ceramide accumulation, painful subcutaneous lipogranulomas, joint contractures, and hoarseness.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-190",
      q: "Niemann-Pick disease type C (NPC) differs fundamentally from types A and B because the underlying defect involves which non-enzymatic cellular process?",
      o: ["Defective intracellular trafficking and unesterified cholesterol export from lysosomes (NPC1 / NPC2 mutations)", "Primary enzymatic deficiency of acid sphingomyelinase", "Defective endosomal acidification by V-type ATPase", "Impaired glycosylation of lysosomal enzymes"],
      a: 0,
      exp: "Niemann-Pick type C is caused by mutations in NPC1 or NPC2, which encode lysosomal cholesterol export proteins. Cholesterol and glycolipids become trapped in lysosomes, causing vertical supranuclear gaze palsy, ataxia, and dementia.",
      r: ["Correct. NPC involves defective NPC1/NPC2 lysosomal cholesterol trafficking, not sphingomyelinase deficiency.", "Incorrect. Acid sphingomyelinase deficiency causes Niemann-Pick types A and B.", "Incorrect. V-type ATPase is unaffected.", "Incorrect. Glycosylation is intact."],
      kp: "Niemann-Pick type C results from NPC1 or NPC2 mutations that impair lysosomal cholesterol export, presenting with vertical supranuclear gaze palsy and progressive ataxia.",
      img: [], d: 2, cog: "recall"
    }
  ],

  // Module 16: bio-extracellular-matrix
  "bio-extracellular-matrix": [
    {
      id: "bk-bio-191",
      q: "Why is glycine strictly required at every third position (Gly-X-Y repeating sequence) in the primary structure of all fibrillar collagen alpha chains?",
      o: ["Glycine has the smallest side chain (single hydrogen) that fits into the restricted central axial core of the triple helix", "Glycine is the only amino acid that forms covalent disulfide bridges", "Glycine undergoes post-translational hydroxylation to stabilize the helix", "Glycine contains a negative charge that repels neighboring tropocollagen fibrils"],
      a: 0,
      exp: "The collagen triple helix is wound so tightly that steric constraints permit only the smallest amino acid, glycine (with a single hydrogen atom side chain), to occupy the inward-facing central axis.",
      r: ["Correct. Glycine fits into the crowded central axis of the collagen triple helix.", "Incorrect. Cysteine forms disulfide bonds, not glycine.", "Incorrect. Proline and lysine are hydroxylated, not glycine.", "Incorrect. Glycine is neutral and uncharged."],
      kp: "Glycine occurs every third residue in collagen (Gly-X-Y) because its tiny hydrogen side chain is the only residue small enough to fit inside the triple-helix core.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-192",
      q: "A sailor on a long voyage develops bleeding spongy gums, perifollicular corkscrew hemorrhages, petechiae, and poor wound healing. What biochemical step in collagen synthesis is impaired by vitamin C deficiency?",
      o: ["Hydroxylation of proline and lysine residues in the rough endoplasmic reticulum", "Cleavage of terminal propeptides by extracellular peptidases", "Deamination of lysine by lysyl oxidase to form allysine crosslinks", "Signal peptide cleavage on the nascent pre-procollagen chain"],
      a: 0,
      exp: "Prolyl and lysyl hydroxylases require ascorbic acid (vitamin C) as a reducing agent to keep catalytic iron in the ferrous (Fe2+) state. In scurvy, unhydroxylated procollagen fails to form stable triple helices and degrades.",
      r: ["Correct. Scurvy impairs vitamin C-dependent prolyl and lysyl hydroxylation.", "Incorrect. Propeptide cleavage is extracellular and vitamin C-independent.", "Incorrect. Lysyl oxidase requires copper, not vitamin C.", "Incorrect. Signal peptidase does not require vitamin C."],
      kp: "Scurvy results from vitamin C deficiency, impairing prolyl and lysyl hydroxylation; unstable procollagen degrades, causing capillary fragility and poor wound healing.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-193",
      q: "Which extracellular enzyme requires copper as an essential cofactor to deaminate lysine and hydroxylysine residues into allysine aldehydes for covalent collagen crosslinking?",
      o: ["Lysyl oxidase", "Prolyl hydroxylase", "Lysyl hydroxylase", "Procollagen peptidase"],
      a: 0,
      exp: "Lysyl oxidase is a copper-dependent extracellular enzyme that oxidatively deaminates lysine and hydroxylysine residues into reactive aldehydes (allysine), which spontaneously condense to form covalent crosslinks.",
      r: ["Correct. Lysyl oxidase requires copper to catalyze covalent collagen crosslinking.", "Incorrect. Prolyl hydroxylase is intracellular and requires vitamin C and iron.", "Incorrect. Lysyl hydroxylase requires vitamin C and iron.", "Incorrect. Procollagen peptidase cleaves propeptides."],
      kp: "Extracellular lysyl oxidase requires copper to oxidize lysine into reactive allysine aldehydes, creating covalent crosslinks that give collagen tensile strength.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-194",
      q: "A 4-year-old child presents with multiple recurrent bone fractures after minor trauma, blue sclerae, and early conductive hearing loss. Radiographs reveal diffuse osteopenia. What is the molecular defect?",
      o: ["Defect in type I collagen synthesis due to COL1A1 or COL1A2 mutations (Osteogenesis imperfecta)", "Defect in type II collagen synthesis", "Defect in type III collagen synthesis", "Defect in fibrillin-1 microfibril scaffold"],
      a: 0,
      exp: "Osteogenesis imperfecta (brittle bone disease) is most commonly caused by autosomal dominant mutations in COL1A1 or COL1A2. Quantitative or qualitative defects in type I collagen produce fragile bones, blue sclerae, and hearing loss.",
      r: ["Correct. Type I collagen defects cause osteogenesis imperfecta with blue sclerae and fractures.", "Incorrect. Type II collagen is in cartilage and vitreous humor.", "Incorrect. Type III collagen defects cause vascular Ehlers-Danlos.", "Incorrect. Fibrillin-1 defects cause Marfan syndrome."],
      kp: "Osteogenesis imperfecta is caused by COL1A1 or COL1A2 mutations in type I collagen, presenting with recurrent fractures, blue sclerae, and hearing loss.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-195",
      q: "Vascular Ehlers-Danlos syndrome (vEDS) is characterized by severe fragility of arteries, bowel, and gravid uterus, predisposing to spontaneous fatal rupture. Mutations in which collagen gene are responsible?",
      o: ["COL3A1 (Type III collagen)", "COL1A1 (Type I collagen)", "COL5A1 (Type V collagen)", "COL4A5 (Type IV collagen)"],
      a: 0,
      exp: "Vascular Ehlers-Danlos syndrome is caused by heterozygous mutations in COL3A1 encoding type III collagen (reticulin), which forms the structural framework of blood vessels, gastrointestinal walls, and uterus.",
      r: ["Correct. COL3A1 mutations in type III collagen cause vascular Ehlers-Danlos syndrome.", "Incorrect. COL1A1 causes osteogenesis imperfecta or classic EDS.", "Incorrect. COL5A1 causes classic hypermobile/hyperextensible EDS.", "Incorrect. COL4A5 causes Alport syndrome."],
      kp: "Vascular Ehlers-Danlos syndrome results from COL3A1 mutations in type III collagen, causing life-threatening spontaneous rupture of large arteries, bowel, and uterus.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-196",
      q: "Alport syndrome is an inherited nephropathy featuring progressive hematuria, proteinuria, sensorineural deafness, and anterior lenticonus. What type of collagen is defective in the basement membrane?",
      o: ["Type IV collagen (COL4A3, COL4A4, or COL4A5)", "Type I collagen", "Type II collagen", "Type III collagen"],
      a: 0,
      exp: "Alport syndrome is most commonly an X-linked mutation in COL4A5 encoding the alpha-5 chain of type IV collagen. Type IV collagen forms the meshwork of basement membranes in glomeruli, cochlea, and lens.",
      r: ["Correct. Type IV collagen mutations cause Alport syndrome with glomerulonephritis and deafness.", "Incorrect. Type I collagen is in bone and skin.", "Incorrect. Type II collagen is in cartilage.", "Incorrect. Type III collagen is in reticular fibers."],
      kp: "Alport syndrome results from type IV collagen alpha-chain mutations, disrupting glomerular basement membranes, cochlear function, and ocular lens shape.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-197",
      q: "Marfan syndrome is caused by autosomal dominant mutations in the FBN1 gene. What glycoprotein does FBN1 encode, and what is its extracellular matrix role?",
      o: ["Fibrillin-1, which forms microfibrils that serve as a scaffold for elastin deposition and sequesters TGF-beta", "Elastin core protein", "Fibronectin cell-adhesion molecule", "Aggrecan core protein"],
      a: 0,
      exp: "FBN1 encodes fibrillin-1, an extracellular glycoprotein that forms microfibrils surrounding elastin. Defective fibrillin-1 impairs elastic tissue integrity and causes excessive TGF-beta signaling, predisposing to aortic root aneurysm.",
      r: ["Correct. Fibrillin-1 forms microfibrils for elastin assembly and regulates TGF-beta bioavailability.", "Incorrect. Elastin is encoded by ELN.", "Incorrect. Fibronectin is an integrin-binding glycoprotein.", "Incorrect. Aggrecan is a proteoglycan."],
      kp: "Marfan syndrome is caused by FBN1 mutations in fibrillin-1; defective microfibrils undermine elastin scaffolding and cause dysregulated TGF-beta signaling, predisposing to aortic dissection.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-198",
      q: "Elastin is a highly resilient extracellular protein that permits reversible stretching of lungs, large arteries, and skin. What unique covalent crosslinks between lysine residues give elastin its rubber-like recoil?",
      o: ["Desmosine and isodesmosine crosslinks", "Disulfide bridges between cysteines", "Hydrogen bonds between hydroxyprolines", "Salt bridges between arginine and aspartate"],
      a: 0,
      exp: "Lysyl oxidase deaminates three allysine residues and one unmodified lysine to condense into heterocyclic desmosine and isodesmosine rings, crosslinking four elastin polypeptides into an extensible rubber-like network.",
      r: ["Correct. Desmosine and isodesmosine crosslinks confer elasticity to elastin.", "Incorrect. Elastin is low in cysteine and lacks disulfide crosslinks.", "Incorrect. Hydroxyproline stabilizes collagen, not elastin recoil.", "Incorrect. Salt bridges do not provide rubber-like recoil."],
      kp: "Desmosine and isodesmosine crosslinks, formed by condensation of four lysine side chains via lysyl oxidase, confer elastic recoil to elastin fibers.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-199",
      q: "Classic Ehlers-Danlos syndrome is characterized by velvety hyperextensible skin, fragile skin that splits with 'cigarette-paper' scarring, and generalized joint hypermobility. Mutations in which collagen type are typical?",
      o: ["Type V collagen (COL5A1 or COL5A2)", "Type I collagen", "Type III collagen", "Type IV collagen"],
      a: 0,
      exp: "Classic Ehlers-Danlos syndrome is an autosomal dominant disorder caused by mutations in COL5A1 or COL5A2 encoding type V collagen, which regulates the fibril diameter and assembly of type I collagen fibrils.",
      r: ["Correct. Type V collagen mutations cause classic Ehlers-Danlos syndrome.", "Incorrect. Type I mutations cause osteogenesis imperfecta.", "Incorrect. Type III mutations cause vascular EDS.", "Incorrect. Type IV mutations cause Alport syndrome."],
      kp: "Classic Ehlers-Danlos syndrome results from type V collagen mutations (COL5A1/COL5A2), presenting with skin hyperextensibility, atrophic scars, and joint hypermobility.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-200",
      q: "Alpha-1 antitrypsin deficiency leads to early panacinar pulmonary emphysema and liver cirrhosis. What is the mechanism of lung destruction?",
      o: ["Unopposed destruction of alveolar elastin by neutrophil elastase", "Excessive crosslinking of collagen by lysyl oxidase", "Deposition of amyloid fibrils in bronchial cartilage", "Defective ciliary clearance of mucus"],
      a: 0,
      exp: "Alpha-1 antitrypsin is a serpin that neutralizes neutrophil elastase in lower airways. In AAT deficiency, uninhibited elastase degrades alveolar wall elastin, destroying alveolar septa and causing panacinar emphysema.",
      r: ["Correct. Unopposed neutrophil elastase destroys alveolar elastin in alpha-1 antitrypsin deficiency.", "Incorrect. Collagen crosslinking is unaffected.", "Incorrect. Amyloid is not the mechanism of emphysema.", "Incorrect. Ciliary dyskinesia is Kartagener syndrome."],
      kp: "Alpha-1 antitrypsin deficiency permits unopposed neutrophil elastase digestion of pulmonary elastin, leading to premature panacinar emphysema, exacerbated by smoking.",
      img: [], d: 2, cog: "application"
    }
  ],

  // Module 17: bio-dna-repair
  "bio-dna-repair": [
    {
      id: "bk-bio-201",
      q: "A 4-year-old child presents with extreme cutaneous sun sensitivity, marked freckling and erythema after minimal sunlight exposure, dry atrophic skin, and multiple basal cell carcinomas on the face. What repair pathway is deficient?",
      o: ["Nucleotide excision repair (NER, Xeroderma pigmentosum)", "Base excision repair (BER)", "Mismatch repair (MMR)", "Non-homologous end joining (NHEJ)"],
      a: 0,
      exp: "Xeroderma pigmentosum is caused by autosomal recessive mutations in any of eight NER genes (XPA through XPG, and XPV). Inability to excise UV-induced thymine dimers leads to accelerated mutagenesis and 1000-fold skin cancer risk.",
      r: ["Correct. Xeroderma pigmentosum results from defective nucleotide excision repair of UV damage.", "Incorrect. BER removes small deaminated bases.", "Incorrect. MMR defects cause Lynch syndrome.", "Incorrect. NHEJ defects cause radiosensitivity and SCID."],
      kp: "Xeroderma pigmentosum is caused by defective nucleotide excision repair (NER), preventing excision of UV-induced pyrimidine dimers and causing a 1000-fold increase in skin malignancies.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-202",
      q: "What specific chemical lesion is produced in DNA following absorption of ultraviolet B (UVB) radiation, requiring nucleotide excision repair for removal?",
      o: ["Cyclobutane pyrimidine dimers (e.g., thymine-thymine dimers)", "Double-strand phosphodiester backbone breaks", "Deamination of cytosine to uracil", "Depurination of guanine forming an AP site"],
      a: 0,
      exp: "UV radiation induces photochemical crosslinking between adjacent pyrimidine bases (thymine or cytosine) on the same strand, forming covalent cyclobutane pyrimidine dimers and 6,4-photoproducts that distort the double helix.",
      r: ["Correct. UV radiation produces cyclobutane pyrimidine dimers that distort the DNA helix.", "Incorrect. Ionizing radiation (X-rays) causes double-strand breaks.", "Incorrect. Spontaneous thermal hydrolysis deaminates cytosine to uracil.", "Incorrect. Spontaneous acid hydrolysis causes depurination."],
      kp: "Ultraviolet light induces covalent cyclobutane pyrimidine dimers between adjacent thymines, distorting the double helix and requiring nucleotide excision repair.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-203",
      q: "Lynch syndrome (hereditary nonpolyposis colorectal cancer, HNPCC) is an autosomal dominant cancer predisposition syndrome caused by germline mutations in which DNA repair system?",
      o: ["DNA mismatch repair (MMR: MSH2, MLH1, MSH6, PMS2)", "Nucleotide excision repair", "Homologous recombination repair", "Base excision repair"],
      a: 0,
      exp: "Lynch syndrome is caused by mutations in mismatch repair genes (MLH1, MSH2, MSH6, PMS2). Inability to correct post-replicative slippage errors causes microsatellite instability (MSI-H) and early colorectal/endometrial cancers.",
      r: ["Correct. Mismatch repair gene mutations cause Lynch syndrome and microsatellite instability.", "Incorrect. NER defects cause xeroderma pigmentosum.", "Incorrect. Homologous recombination defects cause BRCA-associated breast/ovarian cancer.", "Incorrect. BER defects cause MUTYH polyposis."],
      kp: "Lynch syndrome is caused by germline mutations in mismatch repair genes (MSH2, MLH1), leading to microsatellite instability and high risk of colorectal and endometrial carcinomas.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-204",
      q: "In base excision repair (BER), what is the first enzyme that recognizes an aberrant, damaged base (such as deaminated cytosine forming uracil in DNA) and cleaves the N-glycosidic bond?",
      o: ["DNA glycosylase (e.g., Uracil-DNA glycosylase)", "AP endonuclease", "DNA polymerase beta", "DNA ligase III"],
      a: 0,
      exp: "DNA glycosylases recognize specific damaged or deaminated bases and cleave the N-glycosidic bond between the base and deoxyribose, creating an apurinic or apyrimidinic (AP) site for subsequent AP endonuclease cleavage.",
      r: ["Correct. DNA glycosylase cleaves the N-glycosidic bond to create an AP site.", "Incorrect. AP endonuclease nicks the phosphodiester backbone at the AP site (second step).", "Incorrect. DNA polymerase fills the single-nucleotide gap.", "Incorrect. DNA ligase seals the nick."],
      kp: "Base excision repair begins with a specific DNA glycosylase that cleaves the N-glycosidic bond of the damaged base, creating an apurinic/apyrimidinic (AP) site.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-205",
      q: "Ataxia-telangiectasia is an autosomal recessive neurodegenerative and immunodeficiency disorder caused by mutations in ATM. What DNA damage response kinase does ATM encode?",
      o: ["A serine/threonine kinase that detects double-strand DNA breaks and phosphorylates p53 and CHK2", "A DNA polymerase that bypasses pyrimidine dimers", "A topoisomerase that relieves supercoiling", "A mismatch repair endonuclease"],
      a: 0,
      exp: "ATM encodes a serine/threonine kinase activated by double-strand DNA breaks (DSBs). ATM phosphorylates p53, CHK2, and BRCA1 to arrest the cell cycle and mobilize homologous recombination repair.",
      r: ["Correct. ATM is a master kinase sensing double-strand breaks and activating p53 and cell cycle checkpoints.", "Incorrect. Translesion polymerases bypass dimers.", "Incorrect. Topoisomerases relieve torsional strain.", "Incorrect. MutL homologues are mismatch endonucleases."],
      kp: "Ataxia-telangiectasia results from ATM mutations; ATM kinase senses double-strand DNA breaks and phosphorylates p53, orchestrating cell cycle arrest and repair.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-206",
      q: "Which high-fidelity repair pathway repairs double-strand DNA breaks during the late S and G2 phases of the cell cycle by using the undamaged sister chromatid as a template?",
      o: ["Homologous recombination (HR, mediated by BRCA1, BRCA2, and RAD51)", "Non-homologous end joining (NHEJ)", "Base excision repair", "Nucleotide excision repair"],
      a: 0,
      exp: "Homologous recombination utilizes the identical sister chromatid available in S/G2 phase to guide error-free repair of double-strand breaks. BRCA1, BRCA2, and RAD51 are central effectors.",
      r: ["Correct. Homologous recombination uses the sister chromatid for error-free double-strand break repair.", "Incorrect. Non-homologous end joining ligates ends without a template and is error-prone.", "Incorrect. BER repairs single-base lesions.", "Incorrect. NER repairs bulky adducts on single strands."],
      kp: "Homologous recombination is an error-free double-strand break repair pathway active in S/G2 phase that utilizes the sister chromatid as a template via BRCA1 and BRCA2.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-207",
      q: "Olaparib is a PARP (poly-ADP-ribose polymerase) inhibitor. Why does olaparib selectively kill breast and ovarian cancer cells harboring BRCA1 or BRCA2 germline mutations (synthetic lethality)?",
      o: ["Inhibiting PARP blocks single-strand base excision repair; accumulated breaks collapse replication forks into double-strand breaks, which BRCA-deficient cells cannot repair", "PARP inhibitors directly bind and mutate the p53 tumor suppressor", "PARP inhibitors prevent topoisomerase I relaxation of DNA", "PARP inhibitors directly activate caspase-9 in all cells"],
      a: 0,
      exp: "PARP is required for single-strand break repair. When PARP is inhibited, single-strand breaks persist and collide with replication forks, converting into double-strand breaks. In BRCA-deficient tumors lacking homologous recombination, cells undergo synthetic lethal apoptosis.",
      r: ["Correct. Dual loss of single-strand repair (PARP) and double-strand repair (BRCA) causes synthetic lethality.", "Incorrect. PARP inhibitors do not mutate p53.", "Incorrect. Topotecan inhibits topoisomerase I.", "Incorrect. Olaparib does not directly activate caspase-9 without DNA damage."],
      kp: "PARP inhibitors exploit synthetic lethality in BRCA-mutant tumors by blocking single-strand break repair, converting lesions into lethal double-strand breaks that BRCA-null cells cannot survive.",
      img: [], d: 2, cog: "application"
    },
    {
      id: "bk-bio-208",
      q: "Non-homologous end joining (NHEJ) repairs double-strand DNA breaks throughout the cell cycle, including G1 phase. What protein complex binds the exposed broken DNA ends to recruit DNA-PKcs and Artemis?",
      o: ["Ku70 / Ku80 heterodimer", "MSH2 / MSH6 complex", "XPC / HR23B complex", "Uracil-DNA glycosylase"],
      a: 0,
      exp: "The Ku70/Ku80 ring-shaped heterodimer encircles duplex DNA ends at double-strand breaks, protecting them from degradation and recruiting DNA-PKcs and Artemis for end processing before ligation by DNA ligase IV.",
      r: ["Correct. Ku70/Ku80 recognizes and binds exposed DNA ends in NHEJ.", "Incorrect. MSH2/6 recognizes mismatches in MMR.", "Incorrect. XPC recognizes bulky adducts in NER.", "Incorrect. Uracil-DNA glycosylase recognizes uracil in BER."],
      kp: "The Ku70/Ku80 heterodimer binds broken double-stranded DNA ends in non-homologous end joining (NHEJ), recruiting Artemis and DNA ligase IV.",
      img: [], d: 2, cog: "recall"
    },
    {
      id: "bk-bio-209",
      q: "What intrinsic enzymatic activity of replicative DNA polymerases delta and epsilon allows immediate excision of mispaired nucleotides during active replication fork progression?",
      o: ["3' to 5' exonuclease proofreading activity", "5' to 3' exonuclease primer removal activity", "Endonuclease cleavage activity", "AP lyase activity"],
      a: 0,
      exp: "High-fidelity replicative polymerases (delta and epsilon) possess 3'->5' exonuclease proofreading activity. When a mispaired base is inserted, the polymerase pauses, shifts the terminal nucleotide to the exonuclease active site, excises it, and resumes synthesis.",
      r: ["Correct. 3' to 5' exonuclease proofreading excises newly inserted mispaired bases.", "Incorrect. 5' to 3' exonuclease removes RNA primers (Pol I in bacteria, FEN1 in humans).", "Incorrect. Endonucleases cut internally.", "Incorrect. AP lyases cleave at AP sites."],
      kp: "Replicative DNA polymerases delta and epsilon possess 3' to 5' exonuclease proofreading activity that immediately excises misincorporated bases, reducing replication error rates.",
      img: [], d: 1, cog: "recall"
    },
    {
      id: "bk-bio-210",
      q: "Fanconi anemia is an autosomal recessive genomic instability syndrome characterized by bone marrow failure, cafe-au-lait spots, thumb/radial ray hypoplasia, and acute myeloid leukemia. What specific type of DNA damage repair is defective?",
      o: ["Interstrand DNA crosslink repair (FA core complex / FANC pathway)", "Mitochondrial base excision repair", "RNA primer removal by FEN1", "Mismatch repair of dinucleotide repeats"],
      a: 0,
      exp: "Fanconi anemia results from mutations in the FANC genes (FANCA, FANCC, FANCD2, etc.), which coordinate the cellular response to interstrand DNA crosslinks (ICLs) caused by endogenous aldehydes and crosslinking agents like mitomycin C.",
      r: ["Correct. Fanconi anemia impairs interstrand DNA crosslink repair.", "Incorrect. BER is intact.", "Incorrect. FEN1 primer removal is intact.", "Incorrect. Mismatch repair defects cause Lynch syndrome."],
      kp: "Fanconi anemia is caused by defective repair of interstrand DNA crosslinks, leading to chromosomal breakage, radial ray defects, bone marrow failure, and leukemia risk.",
      img: [], d: 2, cog: "recall"
    }
  ]
};
