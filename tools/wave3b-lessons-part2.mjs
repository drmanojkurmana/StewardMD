/**
 * Wave 3B Lessons Part 2: Chapters 26 to 34 (9 Lessons)
 */

export const wave3bLessonsPart2 = [
  // Ch 26: Neurotransmitters
  {
    module: "bio-neurotransmitters",
    subject: "biochemistry",
    title: "Neurotransmitter biosynthesis, catecholamine metabolism, and phaeochromocytoma",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Catecholamine **biosynthesis** originates from the essential amino acid tyrosine. Tyrosine hydroxylase catalyzes the rate-limiting conversion of tyrosine to L-DOPA, requiring tetrahydrobiopterin (BH4) and molecular oxygen as essential cofactors. DOPA decarboxylase converts L-DOPA to dopamine utilizing pyridoxal phosphate (vitamin B6). Dopamine beta-hydroxylase oxidizes dopamine to norepinephrine within chromaffin vesicles using ascorbic acid. Finally, phenylethanolamine N-methyltransferase in the adrenal medulla methylates norepinephrine to epinephrine using S-adenosylmethionine, stimulated by cortisol.",
        say: "Catecholamine synthesis begins with tyrosine hydroxylase, the rate-limiting enzyme requiring tetrahydrobiopterin to produce L-DOPA. DOPA decarboxylase forms dopamine, dopamine beta-hydroxylase generates norepinephrine using vitamin C, and PNMT converts norepinephrine to epinephrine under cortisol stimulation.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "c1", label: "Tyrosine" },
            { id: "c2", label: "L-DOPA (via Tyrosine hydroxylase + BH4)" },
            { id: "c3", label: "Dopamine (via DOPA decarboxylase + B6)" },
            { id: "c4", label: "Norepinephrine (via DBH + Vitamin C)" },
            { id: "c5", label: "Epinephrine (via PNMT + SAM)" }
          ],
          edges: [
            ["c1", "c2"],
            ["c2", "c3"],
            ["c3", "c4"],
            ["c4", "c5"]
          ]
        }
      },
      {
        tx: "Degradation of catecholamines occurs through two major enzymes: monoamine oxidase (MAO) and catechol-O-methyltransferase (COMT). Monoamine oxidase oxidatively deaminates catecholamines within outer mitochondrial membranes, while COMT transfers methyl groups from SAM in the cytosol. Epinephrine and norepinephrine are sequentially degraded into **vanillylmandelic** acid (VMA), whereas dopamine is converted into homovanillic acid (HVA). Elevated urinary free metanephrines and VMA serve as diagnostic clinical cornerstones for neuroendocrine tumors.",
        say: "Catecholamine catabolism involves monoamine oxidase and catechol-O-methyltransferase. Epinephrine and norepinephrine degrade into metanephrines and vanillylmandelic acid, whereas dopamine catabolizes to homovanillic acid. Elevated urinary metanephrines confirm neuroendocrine tumors.",
        vis: {
          kind: "table",
          cols: ["Neurotransmitter", "Degradation pathway", "Primary excreted metabolite"],
          rows: [
            ["Norepinephrine", "MAO-A + COMT deamination & methylation", "Vanillylmandelic acid (VMA) + Normetanephrine"],
            ["Epinephrine", "COMT methylation followed by MAO", "Vanillylmandelic acid (VMA) + Metanephrine"],
            ["Dopamine", "Sequential MAO-B + COMT action", "Homovanillic acid (HVA)"],
            ["Serotonin (5-HT)", "MAO-A oxidative deamination", "5-Hydroxyindoleacetic acid (5-HIAA)"]
          ]
        }
      },
      {
        tx: "Excessive, episodic catecholamine secretion characterizes **phaeochromocytoma** and paraganglioma, which arise from chromaffin tissue of the adrenal medulla or sympathetic chains. Patients present with the classic triad of paroxysmal severe headaches, diaphoresis, and tachycardic palpitations accompanied by malignant hypertension. Carcinoid tumors arising from enterochromaffin cells overproduce serotonin from tryptophan, yielding elevated urinary **5-HIAA**, cutaneous flushing, watery diarrhea, and right-sided valvular cardiac fibrosis.",
        say: "Phaeochromocytomas hypersecrete catecholamines, producing paroxysmal headaches, sweating, and severe hypertension. Carcinoid tumors overproduce serotonin from tryptophan, causing flushing, diarrhea, and right heart fibrotic lesions with elevated urinary 5-HIAA.",
        vis: {
          kind: "table",
          cols: ["Tumor entity", "Secreted molecule", "Diagnostic laboratory test"],
          rows: [
            ["Phaeochromocytoma", "Norepinephrine, epinephrine", "Plasma free metanephrines, 24-hour urine VMA"],
            ["Neuroblastoma", "Dopamine, norepinephrine", "Urinary HVA and VMA in young children"],
            ["Carcinoid tumor", "Serotonin (5-HT)", "24-Hour urinary 5-HIAA excretion"],
            ["Medullary thyroid ca", "Calcitonin", "Serum calcitonin and CEA levels"]
          ]
        }
      },
      {
        tx: "Pharmacological blockade is strictly sequenced before surgical resection in phaeochromocytoma. Irreversible non-selective alpha-adrenergic **blockade** with phenoxybenzamine or selective alpha-1 blockade must be established for at least 10 to 14 days prior to surgery to expand contracted intravascular volume. Beta-blockers like propranolol should never be administered alone before alpha-blockade, as unopposed alpha-1 stimulation causes catastrophic hypertensive crisis and acute pulmonary edema.",
        say: "Preoperative management of phaeochromocytoma requires strict sequence: alpha-blockade with phenoxybenzamine must precede beta-blockers by at least ten days. Beta-blockers given without prior alpha-blockade cause fatal hypertensive crisis from unopposed alpha-receptor vasoconstriction.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "rx1", label: "Diagnosis of phaeochromocytoma" },
            { id: "rx2", label: "Initiate phenoxybenzamine (alpha-block)" },
            { id: "rx3", label: "Volume expansion & blood pressure control" },
            { id: "rx4", label: "Add beta-blocker for reflex tachycardia" },
            { id: "rx5", label: "Safe laparoscopic adrenalectomy" }
          ],
          edges: [
            ["rx1", "rx2"],
            ["rx2", "rx3"],
            ["rx3", "rx4"],
            ["rx4", "rx5"]
          ]
        }
      }
    ]
  },

  // Ch 27: Biochemical Endocrinology
  {
    module: "bio-endocrine-biochemistry",
    subject: "biochemistry",
    title: "Biochemical endocrinology: hormone receptors, feedback loops, and steroidogenesis defects",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Endocrine signaling coordinates systemic homeostasis through chemical messengers categorized by biochemical **solubility**. Hydrophilic peptide hormones and catecholamines circulate freely in plasma, binding cell-surface receptors to initiate rapid second messenger cascades. Lipophilic steroid hormones and thyroid hormones travel bound to specific carrier proteins like thyroid-binding globulin and albumin. Upon cellular entry, lipophilic hormones bind intracellular nuclear receptors that act as ligand-activated transcription factors.",
        say: "Hormones divide into hydrophilic peptides and lipophilic steroids. Hydrophilic messengers bind cell surface receptors to activate rapid second messenger cascades. Lipophilic steroids enter cells to bind intracellular nuclear receptors that directly modulate gene transcription.",
        vis: {
          kind: "table",
          cols: ["Hormone class", "Plasma transport", "Receptor localization & mechanism"],
          rows: [
            ["Peptides (Insulin, PTH)", "Free dissolved in plasma", "Plasma membrane receptors (GPCR, RTK)"],
            ["Catecholamines", "Free in plasma", "Surface GPCRs (alpha and beta adrenergic)"],
            ["Steroids (Cortisol, Estrogen)", "Bound to CBG, SHBG, albumin", "Cytosolic / nuclear receptors with zinc fingers"],
            ["Thyroid hormones (T3, T4)", "Bound to TBG, transthyretin", "Nuclear receptors bound to thyroid response elements"]
          ]
        }
      },
      {
        tx: "Steroidogenesis takes place within the adrenal cortex and gonads, converting cholesterol into mineralocorticoids, glucocorticoids, and sex steroids. Inborn errors of adrenal steroidogenesis cause congenital adrenal **hyperplasia**. 21-Hydroxylase deficiency accounts for over 90 percent of cases, blocking cortisol and aldosterone synthesis. Accumulated 17-hydroxyprogesterone shunts into adrenal androgens, causing ambiguous genitalia in female newborns, salt-wasting crisis, hyperkalemia, and hypotension.",
        say: "Congenital adrenal hyperplasia results from defective steroidogenesis enzymes. 21-Hydroxylase deficiency blocks cortisol and aldosterone production, shunting precursors into androgens to produce virilization, salt wasting, hypotension, and hyperkalemia.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "s1", label: "Cholesterol to Pregnenolone" },
            { id: "s2", label: "21-Hydroxylase block" },
            { id: "s3", label: "Failure of Cortisol & Aldosterone" },
            { id: "s4", label: "Compensatory ACTH surge" },
            { id: "s5", label: "Shunt to Androgens: Virilization & Salt-wasting" }
          ],
          edges: [
            ["s1", "s2"],
            ["s2", "s3"],
            ["s3", "s4"],
            ["s4", "s5"]
          ]
        }
      },
      {
        tx: "Different enzyme blocks in steroidogenesis produce distinct biochemical and clinical profiles. In 11-beta-hydroxylase deficiency, absent cortisol causes ACTH excess, but accumulation of **11-deoxycorticosterone** (a potent mineralocorticoid) produces severe hypertension and hypokalemia despite virilization. In contrast, 17-alpha-hydroxylase deficiency prevents sex steroid and cortisol synthesis, resulting in primary amenorrhea, female external genitalia in XY individuals, hypertension, and hypokalemia.",
        say: "11-Beta-hydroxylase deficiency causes virilization with hypertension due to 11-deoxycorticosterone mineralocorticoid accumulation. In 17-alpha-hydroxylase deficiency, sex steroids are absent while mineralocorticoids predominate, yielding hypertension with sexual infantilism.",
        vis: {
          kind: "table",
          cols: ["Enzyme deficiency", "Blood pressure / Mineralocorticoids", "Virilization / Androgens"],
          rows: [
            ["21-Hydroxylase", "Low BP, salt-wasting, high K+", "Elevated (virilization in XX)"],
            ["11-Beta-hydroxylase", "High BP (elevated DOC), low K+", "Elevated (virilization in XX)"],
            ["17-Alpha-hydroxylase", "High BP (elevated corticosterone), low K+", "Decreased (XY pseudohermaphroditism)"],
            ["3-Beta-HSD", "Low BP, severe salt wasting", "Decreased overall; mild DHEA elevation"]
          ]
        }
      },
      {
        tx: "Multiple endocrine neoplasia (MEN) syndromes represent autosomal dominant disorders of coordinated endocrine **hyperplasia**. MEN1 involves tumors of the parathyroids, pancreatic islets, and pituitary gland due to menin gene mutations. MEN2A causes medullary thyroid carcinoma, phaeochromocytoma, and parathyroid hyperplasia via activating RET proto-oncogene mutations. MEN2B combines medullary thyroid carcinoma and phaeochromocytoma with mucosal neuromas and marfanoid habitus, managed by prophylactic thyroidectomy.",
        say: "MEN syndromes cause familial endocrine tumors. MEN1 involves parathyroid, pancreas, and pituitary lesions. MEN2 is caused by RET proto-oncogene mutations, manifesting with medullary thyroid cancer and phaeochromocytoma, requiring early prophylactic thyroidectomy.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "m1", label: "Germline RET mutation identified" },
            { id: "m2", label: "Calcitonin surveillance & ultrasound" },
            { id: "m3", label: "Rule out phaeochromocytoma first" },
            { id: "m4", label: "Alpha-blockade before neck surgery if positive" },
            { id: "m5", label: "Total thyroidectomy & central neck dissection" }
          ],
          edges: [
            ["m1", "m2"],
            ["m2", "m3"],
            ["m3", "m4"],
            ["m4", "m5"]
          ]
        }
      }
    ]
  },

  // Ch 28: Cellular Homeostasis: Apoptosis and Cell Cycle
  {
    module: "bio-apoptosis-cell-cycle",
    subject: "biochemistry",
    title: "Cellular homeostasis: apoptosis cascades, caspases, and cell cycle checkpoints",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Lehninger Principles of Biochemistry 8th ed"],
    steps: [
      {
        tx: "Programmed cell death, or **apoptosis**, maintains tissue homeostasis and eliminates damaged or neoplastic cells without inducing inflammatory necrosis. The process is executed by cysteine-dependent aspartate-directed proteases called **caspases**. Initiator caspases (caspase-8 and caspase-9) possess specialized protein interaction domains that respond to apoptotic triggers, cleaving and activating downstream executioner caspases (caspase-3, caspase-6, caspase-7) to degrade cytoskeletal and nuclear substrates.",
        say: "Apoptosis is orderly programmed cell death executed by caspases without provoking inflammation. Initiator caspases 8 and 9 activate executioner caspases 3, 6, and 7 to cleave cellular substrates, fragment DNA, and orchestrate apoptotic body formation.",
        vis: {
          kind: "table",
          cols: ["Caspase category", "Key caspase members", "Primary activation mechanism"],
          rows: [
            ["Extrinsic initiator", "Caspase-8, Caspase-10", "Fas / TNF death receptor DISC complex"],
            ["Intrinsic initiator", "Caspase-9", "Cytochrome c release + Apaf-1 apoptosome"],
            ["Executioner caspases", "Caspase-3, Caspase-6, Caspase-7", "Cleavage of ICAD, lamin, and actin"],
            ["Inflammatory caspases", "Caspase-1, Caspase-4, Caspase-5", "NLRP3 inflammasome activation (pyroptosis)"]
          ]
        }
      },
      {
        tx: "The intrinsic **mitochondrial** pathway is regulated by the balance between pro-apoptotic and anti-apoptotic Bcl-2 family proteins. Intracellular stresses like DNA damage or growth factor deprivation activate BH3-only sensors (Bim, Bid, Puma), which inhibit anti-apoptotic Bcl-2 and Bcl-xL while activating Bax and Bak. Bax and Bak oligomerize within the outer mitochondrial membrane, creating permeability pores that release **cytochrome** c into the cytoplasm to assemble the apoptosome with Apaf-1.",
        say: "The intrinsic apoptotic pathway hinges on mitochondrial outer membrane permeability. Stress-induced BH3-only proteins neutralize Bcl-2, allowing Bax and Bak to pore the outer mitochondrial membrane. Released cytochrome c binds Apaf-1 and procaspase-9 to form the apoptosome.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "i1", label: "DNA damage or oxidative stress" },
            { id: "i2", label: "Bax and Bak pore formation" },
            { id: "i3", label: "Cytochrome c release into cytosol" },
            { id: "i4", label: "Apaf-1 + dATP apoptosome assembly" },
            { id: "i5", label: "Procaspase-9 cleavage to Caspase-3 activation" }
          ],
          edges: [
            ["i1", "i2"],
            ["i2", "i3"],
            ["i3", "i4"],
            ["i4", "i5"]
          ]
        }
      },
      {
        tx: "The extrinsic pathway is triggered by cell-surface **death receptors** of the tumor necrosis factor receptor superfamily, such as Fas (CD95) and TNFR1. Ligand binding by FasL induces receptor trimerization and recruitment of the adaptor FADD via death domains, forming the death-inducing signaling complex (DISC). Procaspase-8 molecules undergo autocatalytic activation at the DISC. Active caspase-8 directly cleaves executioner caspase-3, or cleaves Bid into tBid to cross-activate the intrinsic mitochondrial pathway.",
        say: "Extrinsic apoptosis activates via Fas and TNF death receptors. Ligand engagement forms the DISC with FADD, autoactivating caspase-8. Caspase-8 directly activates caspase-3 or cleaves Bid to engage mitochondrial amplification.",
        vis: {
          kind: "table",
          cols: ["Pathway step", "Extrinsic pathway", "Intrinsic pathway"],
          rows: [
            ["Initial trigger", "FasL, TNF-alpha binding death receptors", "DNA damage, ROS, oncogene activation"],
            ["Sensor / Adaptor", "FADD death domain adaptor", "BH3-only proteins (Puma, Noxa, Bim)"],
            ["Initiator caspase", "Caspase-8", "Caspase-9"],
            ["Convergence point", "Active Caspase-3 cleaves ICAD", "Active Caspase-3 cleaves ICAD"]
          ]
        }
      },
      {
        tx: "Cell cycle progression is guarded by cyclin-dependent kinases (CDKs) and checkpoint tumor suppressors. Retinoblastoma protein (pRb) binds and sequesters E2F transcription factors. Cyclin D-CDK4/6 complexes phosphorylate pRb, releasing E2F to transcribe genes necessary for S-phase entry. In response to DNA breaks, the **p53** tumor suppressor upregulates p21 (CDKN1A), which potently inhibits CDK complexes, arresting cells at the G1/S boundary to allow repair or provoke apoptosis.",
        say: "Cell cycle checkpoints prevent aberrant division. Cyclin D-CDK4/6 phosphorylates Rb to release E2F for S-phase transition. DNA damage stabilizes p53, which induces p21 to halt CDKs at the G1/S checkpoint.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "k1", label: "DNA double-strand breaks" },
            { id: "k2", label: "ATM/ATR kinase phosphorylates p53" },
            { id: "k3", label: "p53 transactivates p21 (CDKN1A)" },
            { id: "k4", label: "p21 arrests Cyclin D-CDK4/6" },
            { id: "k5", label: "Unphosphorylated Rb blocks E2F (G1 arrest)" }
          ],
          edges: [
            ["k1", "k2"],
            ["k2", "k3"],
            ["k3", "k4"],
            ["k4", "k5"]
          ]
        }
      }
    ]
  },

  // Ch 29: Aging and Cellular Senescence
  {
    module: "bio-aging-cellular-senescence",
    subject: "biochemistry",
    title: "Biochemical aging: telomere dynamics, sirtuins, and cellular senescence",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Replicative **aging** in somatic cells is bounded by the Hayflick limit, governed by progressive telomere attrition. Telomeres consist of tandem hexanucleotide repeats (TTAGGG) capped by the shelterin protein complex. Because conventional DNA polymerases cannot replicate the extreme 5-prime ends of lagging strands (the end-replication problem), telomeres shorten by 50 to 100 base pairs per cell cycle, eventually unmasking bare DNA ends that trigger permanent growth arrest.",
        say: "Replicative senescence is enforced by progressive telomere erosion. Telomeres contain TTAGGG repeats capped by shelterin. The lagging strand end-replication problem causes telomeres to shorten with every mitosis, ultimately unmasking DNA ends that halt division.",
        vis: {
          kind: "table",
          cols: ["Telomere feature", "Molecular structure / Enzyme", "Biological significance"],
          rows: [
            ["Tandem repeats", "5'-TTAGGG-3' sequence (thousands of copies)", "Protective buffer against coding loss"],
            ["Shelterin complex", "TRF1, TRF2, POT1, TIN2, TPP1, RAP1", "Forms t-loop to hide double-strand ends"],
            ["Telomerase (TERT/TERC)", "Reverse transcriptase with RNA template", "Active in germ, stem, and 90% cancer cells"],
            ["Critical shortening", "Telomere length below threshold (<3-5 kb)", "Triggers p53-mediated replicative senescence"]
          ]
        }
      },
      {
        tx: "Telomerase is a specialized ribonucleoprotein **reverse transcriptase** containing catalytic telomerase reverse transcriptase (hTERT) and an internal RNA template (hTERC). Telomerase elongates the 3-prime G-rich overhang of telomeres de novo. While repressed in mature differentiated somatic cells, telomerase is constitutively active in embryonic stem cells, adult germline tissues, and over 85 to 90 percent of human malignancies, conferring infinite proliferative immortality.",
        say: "Telomerase maintains telomere length using an intrinsic RNA template and reverse transcriptase. Absent in adult somatic tissues, telomerase reactivation occurs in over 85% of human cancers, bestowing limitless proliferative potential.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "t1", label: "Telomerase hTERC anneals telomere 3-prime end" },
            { id: "t2", label: "hTERT reverse transcribes TTAGGG repeat" },
            { id: "t3", label: "Translocation of telomerase enzyme" },
            { id: "t4", label: "Repeat synthesis extends overhang" },
            { id: "t5", label: "DNA polymerase alpha-primase fills lagging strand" }
          ],
          edges: [
            ["t1", "t2"],
            ["t2", "t3"],
            ["t3", "t4"],
            ["t4", "t5"]
          ]
        }
      },
      {
        tx: "Cellular **senescence** represents a stable, irreversible exit from the cell cycle accompanied by the senescence-associated secretory phenotype (SASP). Senescent cells secrete pro-inflammatory cytokines (IL-6, IL-1beta), chemokines, and matrix metalloproteinases that degrade extracellular matrices and promote paracrine tissue dysfunction. Sirtuins (SIRT1-7) are NAD-dependent deacetylases that oppose senescence by deacetylating p53, histones, and PGC-1alpha, promoting mitochondrial biogenesis and longevity during caloric restriction.",
        say: "Senescence permanently halts replication while producing the senescence-associated secretory phenotype. Senescent cells release IL-6 and matrix proteases, accelerating tissue aging. NAD-dependent sirtuins oppose aging by deacetylating histones and promoting mitochondrial health.",
        vis: {
          kind: "table",
          cols: ["Aging regulator", "Biochemical mechanism", "Physiological impact"],
          rows: [
            ["p16-INK4a (CDKN2A)", "Inhibits CDK4/6, sustaining hypophosphorylated Rb", "Primary biomarker of cellular senescence"],
            ["SASP secretome", "IL-6, IL-8, MMP-1, MMP-3 secretion", "Chronic sterile tissue inflammation and fibrosis"],
            ["SIRT1 deacetylase", "NAD+-dependent deacetylation of p53 and NF-kB", "Suppresses inflammation and promotes repair"],
            ["Mitochondrial ROS", "Complex I/III electron leakage oxidizes mtDNA", "Vicious cycle of energetic failure and senescence"]
          ]
        }
      },
      {
        tx: "Inherited defects in telomere maintenance cause premature **aging** syndromes termed telomeropathies. Dyskeratosis congenita arises from mutations in DKC1 (dyskerin), TERT, or TERC, presenting with the clinical triad of reticular skin pigmentation, oral leukoplakia, and nail dystrophy, complicated by bone marrow failure and idiopathic pulmonary fibrosis. Werner syndrome, caused by mutations in the WRN RecQ DNA helicase, causes rapid accelerated aging, bilateral cataracts, atherosclerosis, and osteoporosis starting in adolescence.",
        say: "Telomeropathies cause premature aging syndromes. Dyskeratosis congenita manifests with oral leukoplakia, nail dystrophy, and fatal bone marrow failure. Werner syndrome, a RecQ helicase defect, produces rapid adult-onset progeria and premature atherosclerosis.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "w1", label: "Inherited telomere / helicase mutation" },
            { id: "w2", label: "Premature telomere collapse & DNA breaks" },
            { id: "w3", label: "Accelerated stem cell senescence" },
            { id: "w4", label: "Bone marrow failure & tissue atrophy" },
            { id: "w5", label: "Premature multisystem morbidity" }
          ],
          edges: [
            ["w1", "w2"],
            ["w2", "w3"],
            ["w3", "w4"],
            ["w4", "w5"]
          ]
        }
      }
    ]
  },

  // Ch 30: Digestion and Absorption of Nutrients
  {
    module: "bio-digestion-absorption",
    subject: "biochemistry",
    title: "Nutrient assimilation: luminal digestion, enterocyte transporters, and malabsorption",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Carbohydrate **digestion** begins with salivary and pancreatic alpha-amylases, which cleave internal alpha-1,4-glycosidic bonds in starch, yielding maltose, maltotriose, and alpha-limit dextrins. Brush-border disaccharidases in the duodenal and jejunal microvilli complete digestion: lactase splits lactose into glucose and galactose, sucrase hydrolyzes sucrose into glucose and fructose, and maltase cleaves maltose into two glucose units. Free monosaccharides are then transported across the apical enterocyte membrane.",
        say: "Carbohydrate breakdown utilizes luminal alpha-amylase followed by brush border disaccharidases: lactase, sucrase, and maltase. These hydrolyze disaccharides into glucose, galactose, and fructose ready for enterocyte transport.",
        vis: {
          kind: "table",
          cols: ["Enzyme", "Substrate cleaved", "Products absorbed"],
          rows: [
            ["Pancreatic amylase", "Amylose and amylopectin (starch)", "Maltose, maltotriose, alpha-limit dextrins"],
            ["Lactase-phlorizin", "Lactose (galactose-beta-1,4-glucose)", "D-Glucose + D-Galactose"],
            ["Sucrase-isomaltase", "Sucrose (alpha-1,2) and isomaltose (alpha-1,6)", "D-Glucose + D-Fructose"],
            ["Maltase-glucoamylase", "Maltose and maltotriose (alpha-1,4)", "D-Glucose units"]
          ]
        }
      },
      {
        tx: "Monosaccharide absorption relies on specialized **transporters** in enterocytes. Glucose and galactose are actively transported across the apical microvillar membrane via the sodium-glucose cotransporter 1 (SGLT1), driven by the secondary active sodium gradient maintained by basolateral Na+/K+-ATPase. Fructose is absorbed independently through facilitated diffusion mediated by GLUT5. All three monosaccharides exit the basolateral membrane into mesenteric capillaries via facilitated diffusion through **GLUT2**.",
        say: "Glucose and galactose enter enterocytes via sodium-coupled SGLT1 secondary active transport. Fructose enters by facilitated diffusion via GLUT5. All three hexoses exit basolaterally into the portal circulation via GLUT2.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "g1", label: "Luminal Glucose/Galactose + 2 Na+" },
            { id: "g2", label: "Apical SGLT1 active symport" },
            { id: "g3", label: "Apical GLUT5 facilitated Fructose transport" },
            { id: "g4", label: "Basolateral GLUT2 exit into portal blood" },
            { id: "g5", label: "Basolateral Na+/K+-ATPase energizes gradient" }
          ],
          edges: [
            ["g1", "g2"],
            ["g2", "g4"],
            ["g3", "g4"],
            ["g4", "g5"]
          ]
        }
      },
      {
        tx: "Lipid assimilation requires **micellar** solubilization by bile salts. Pancreatic lipase, assisted by colipase, hydrolyzes triacylglycerols into 2-monoacylglycerol and free fatty acids. These hydrophobic products associate with conjugated bile salts and phospholipids to form mixed micelles that diffuse across the unstirred water layer to the enterocyte membrane. Inside enterocytes, fatty acids are re-esterified into triacylglycerols and packaged with apolipoprotein B-48 into **chylomicrons** for lymphatic exocytosis.",
        say: "Dietary lipids undergo emulsification and cleavage by pancreatic lipase and colipase. Mixed bile salt micelles deliver monoacylglycerols and fatty acids to enterocytes, where they are re-synthesized into triacylglycerols and exported in chylomicrons.",
        vis: {
          kind: "table",
          cols: ["Lipid digestive step", "Enzyme / Factor", "Enterocyte handling"],
          rows: [
            ["Triglyceride lipolysis", "Pancreatic lipase + colipase", "2-Monoacylglycerol + 2 free fatty acids"],
            ["Phospholipid cleavage", "Phospholipase A2 (proenzyme)", "Lysophospholipid + free fatty acid"],
            ["Cholesterol ester cleavage", "Cholesterol esterase", "Unesterified free cholesterol"],
            ["Chylomicron export", "Microsomal triglyceride transfer protein", "Apo B-48 packaging into lacteals"]
          ]
        }
      },
      {
        tx: "Malabsorption syndromes arise from mucosal, digestive, or transport defects. Celiac disease is an immune-mediated enteropathy triggered by dietary **gluten** (gliadin peptides), causing intraepithelial lymphocytosis, crypt hyperplasia, and blunting of duodenal villi with secondary iron deficiency and steatorrhea. Abetalipoproteinemia is an autosomal recessive deficiency of microsomal triglyceride transfer protein (MTTP); enterocytes cannot assemble Apo B-48 chylomicrons, resulting in lipid-laden enterocytes, acanthocytosis, ataxia, and fat-soluble vitamin deficiency.",
        say: "Celiac disease causes gluten-induced villous blunting and malabsorption with anti-tTG antibodies. Abetalipoproteinemia results from MTTP mutation, preventing chylomicron assembly and causing lipid-stuffed enterocytes, thorny acanthocytes, and ataxia.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "m1", label: "Dietary gluten ingestion" },
            { id: "m2", label: "Tissue transglutaminase deamidates gliadin" },
            { id: "m3", label: "HLA-DQ2/DQ8 CD4 T-cell activation" },
            { id: "m4", label: "Villous atrophy & crypt hyperplasia" },
            { id: "m5", label: "Pan-malabsorption: anemia, osteopenia, diarrhea" }
          ],
          edges: [
            ["m1", "m2"],
            ["m2", "m3"],
            ["m3", "m4"],
            ["m4", "m5"]
          ]
        }
      }
    ]
  },

  // Ch 31: Glucose Homeostasis and Fuel Metabolism
  {
    module: "bio-fuel-metabolism",
    subject: "biochemistry",
    title: "Fuel homeostasis: the feed-fast cycle, hormonal counter-regulation, and ketoacidosis",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Lehninger Principles of Biochemistry 8th ed"],
    steps: [
      {
        tx: "Fuel metabolism in humans is dynamically coordinated through the **feed-fast** cycle to maintain plasma glucose within tight physiological limits (70 to 100 mg/dL). In the well-fed state, postprandial glucose stimulates pancreatic beta-cell insulin secretion while suppressing glucagon. Insulin promotes glucose uptake into skeletal muscle and adipose tissue via GLUT4 translocation, stimulates hepatic glycogenesis, activates glycolysis, and stimulates de novo lipogenesis while suppressing hormone-sensitive lipase.",
        say: "The feed-fast cycle maintains blood glucose between 70 and 100 mg per deciliter. Following a meal, insulin drives GLUT4-mediated glucose entry into muscle and fat, promotes hepatic glycogen and lipid synthesis, and shuts off lipolysis.",
        vis: {
          kind: "table",
          cols: ["Metabolic state", "Primary hormone", "Dominant metabolic pathways"],
          rows: [
            ["Well-fed (absorptive)", "High Insulin, Low Glucagon", "Glycogenesis, glycolysis, lipogenesis, protein synthesis"],
            ["Early fasting (12-24 h)", "Low Insulin, High Glucagon", "Hepatic glycogenolysis, gluconeogenesis, lipolysis"],
            ["Prolonged fasting (>48 h)", "Low Insulin, High Glucagon, Cortisol", "Adipose lipolysis, hepatic ketogenesis, muscle proteolysis"],
            ["Starvation (>1-2 wk)", "Suppressed thyroid / metabolic rate", "Brain ketone oxidation, reduced muscle wasting"]
          ]
        }
      },
      {
        tx: "During fasting, declining insulin and elevated glucagon activate hepatic glycogen phosphorylase to release glucose via **glycogenolysis**. Hepatic glycogen stores deplete within 18 to 24 hours, after which gluconeogenesis becomes the exclusive endogenous glucose source. Gluconeogenesis utilizes lactate from erythrocytes, glycerol from adipose lipolysis, and glucogenic amino acids (predominantly alanine and glutamine) mobilized from skeletal muscle proteolysis.",
        say: "Fasting triggers hepatic glycogenolysis, which exhausts within 24 hours. Gluconeogenesis then supplies all circulating glucose, consuming lactate, glycerol from fat breakdown, and alanine from muscle proteolysis.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "f1", label: "Insulin drops & Glucagon rises" },
            { id: "f2", label: "Hepatic glycogenolysis sustains first 24h" },
            { id: "f3", label: "Adipose HSL releases free fatty acids & glycerol" },
            { id: "f4", label: "Muscle releases alanine & lactate" },
            { id: "f5", label: "Hepatic gluconeogenesis becomes essential" }
          ],
          edges: [
            ["f1", "f2"],
            ["f2", "f3"],
            ["f3", "f4"],
            ["f4", "f5"]
          ]
        }
      },
      {
        tx: "Prolonged fasting and uncontrolled type 1 diabetes drive unrestrained **ketogenesis**. Accelerated adipose lipolysis floods the liver with free fatty acids. Hepatic beta-oxidation generates copious acetyl-CoA, which allosterically inhibits pyruvate dehydrogenase while stimulating pyruvate carboxylase to drive gluconeogenesis. Depletion of oxaloacetate for gluconeogenesis diverts surplus acetyl-CoA into acetoacetate and beta-hydroxybutyrate. After several days of starvation, the brain adapts to utilize **ketone bodies** for up to two-thirds of its energy requirements.",
        say: "Starvation stimulates hepatic ketogenesis. Massive fatty acid beta-oxidation creates excess acetyl-CoA, which diverts into acetoacetate and beta-hydroxybutyrate as oxaloacetate is consumed for gluconeogenesis. Brain tissue adapts to oxidize ketones, sparing muscle protein.",
        vis: {
          kind: "table",
          cols: ["Organ", "Well-fed fuel source", "Prolonged starvation fuel adaptation"],
          rows: [
            ["Brain", "Glucose exclusively", "Acetoacetate and beta-hydroxybutyrate (60-70%)"],
            ["Skeletal muscle", "Glucose (postprandial)", "Fatty acids (ketone sparing for brain)"],
            ["Cardiac muscle", "Fatty acids (60-80%)", "Fatty acids and ketone bodies"],
            ["Red blood cells", "Glucose (anaerobic only)", "Glucose exclusively (lack mitochondria)"]
          ]
        }
      },
      {
        tx: "Absolute insulin deficiency produces life-threatening diabetic **ketoacidosis** (DKA). Unchecked glucagon, epinephrine, and cortisol stimulate massive lipolysis and uninhibited hepatic ketogenesis. Accumulating acetoacetic and beta-hydroxybutyric acids exhaust plasma bicarbonate buffers, generating a high anion gap metabolic acidosis with compensatory Kussmaul respirations. Severe hyperglycemia creates profound osmotic diuresis, precipitating dehydration, hypovolemic shock, and total body potassium depletion.",
        say: "Diabetic ketoacidosis stems from absolute insulin lack. Unopposed counter-regulatory hormones unleash lipolysis and ketogenesis, creating a severe high anion gap acidosis. Osmotic diuresis induces dehydration and severe total-body potassium deficit.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "d1", label: "Absolute insulin deficiency + counter-regulatory surge" },
            { id: "d2", label: "Massive lipolysis & uninhibited ketogenesis" },
            { id: "d3", label: "Acetoacetate + Beta-hydroxybutyrate acidosis" },
            { id: "d4", label: "Severe hyperglycemia & osmotic diuresis" },
            { id: "d5", label: "High anion gap acidosis, shock, K+ depletion" }
          ],
          edges: [
            ["d1", "d2"],
            ["d2", "d3"],
            ["d3", "d4"],
            ["d4", "d5"]
          ]
        }
      }
    ]
  },

  // Ch 32: Nutrients and Diets
  {
    module: "bio-nutrition-energy",
    subject: "biochemistry",
    title: "Nutritional bioenergetics: energy expenditure, nitrogen balance, and protein-energy malnutrition",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Total daily energy expenditure comprises basal metabolic rate, the thermic effect of food, and physical activity. **Basal** metabolic rate accounts for 60 to 75 percent of daily expenditure, representing the obligatory energy expended to maintain resting membrane gradients, protein turnover, and cardiac-respiratory function. The respiratory quotient (RQ), defined as CO2 produced divided by O2 consumed, reflects fuel oxidation: pure carbohydrate yields an RQ of 1.0, protein yields 0.8, and pure fat yields 0.7.",
        say: "Daily energy expenditure divides into basal metabolic rate, food thermogenesis, and physical activity. Basal metabolic rate accounts for roughly seventy percent of expenditure. The respiratory quotient reflects substrate use: 1.0 for carbohydrates, 0.8 for protein, and 0.7 for fat.",
        vis: {
          kind: "table",
          cols: ["Oxidized substrate", "Energy yield (kcal/g)", "Respiratory quotient (RQ)"],
          rows: [
            ["Carbohydrate", "4.0 kcal / g", "1.00 (equal CO2 produced to O2 consumed)"],
            ["Fat (Triacylglycerol)", "9.0 kcal / g", "0.71 (highly reduced carbon backbone)"],
            ["Protein", "4.0 kcal / g", "0.82 (incomplete urea oxidation)"],
            ["Ethanol", "7.0 kcal / g", "0.67 (rapidly oxidized in liver)"]
          ]
        }
      },
      {
        tx: "**Nitrogen** balance quantifies protein metabolism by comparing dietary nitrogen intake against total excreted nitrogen (primarily urinary urea, plus fecal and cutaneous losses). Healthy adults maintain zero nitrogen balance, where intake precisely equals excretion. Positive nitrogen balance occurs during growth, pregnancy, and recovery from illness. Negative nitrogen balance reflects accelerated catabolism during trauma, severe burns, sepsis, or prolonged starvation, where muscle proteolysis exceeds dietary protein intake.",
        say: "Nitrogen balance compares dietary protein nitrogen against urinary urea excretion. Positive balance occurs during childhood growth and tissue repair. Negative balance marks severe catabolism during burns, trauma, sepsis, or fasting.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "n1", label: "Dietary protein intake (g protein / 6.25)" },
            { id: "n2", label: "Total nitrogen intake" },
            { id: "n3", label: "Urinary urea nitrogen + 4g unmeasured loss" },
            { id: "n4", label: "Nitrogen balance calculation" },
            { id: "n5", label: "Catabolic negative vs anabolic positive state" }
          ],
          edges: [
            ["n1", "n2"],
            ["n2", "n4"],
            ["n3", "n4"],
            ["n4", "n5"]
          ]
        }
      },
      {
        tx: "Protein-energy malnutrition manifests as two distinct clinical syndromes. **Kwashiorkor** results from selective dietary protein deficiency despite adequate caloric intake, typically when a child is weaned onto a carbohydrate-rich starch gruel. Hypoalbuminemia precipitates severe peripheral pitting edema and ascites, while reduced apolipoprotein B-100 synthesis prevents hepatic VLDL export, causing dramatic hepatomegaly with fatty liver. Patients exhibit flaky-paint dermatitis, flag-sign dyspigmented hair, and profound apathy.",
        say: "Kwashiorkor stems from selective protein lack despite adequate calories. Severe hypoalbuminemia produces widespread edema, while impaired apolipoprotein synthesis causes fatty liver and hepatomegaly, accompanied by dermatitis and flag-sign hair.",
        vis: {
          kind: "table",
          cols: ["Clinical feature", "Kwashiorkor (Protein deficiency)", "Marasmus (Caloric starvation)"],
          rows: [
            ["Primary dietary deficit", "Protein deficiency with normal carbohydrate", "Total caloric and protein deficiency"],
            ["Edema / Ascites", "Present (pitting edema, hypoalbuminemia)", "Absent (no edema)"],
            ["Subcutaneous fat & muscle", "Subcutaneous fat preserved; muscle wasted", "Severe loss of both fat and muscle"],
            ["Liver pathology", "Enlarged fatty liver (impaired VLDL export)", "No fatty liver"],
            ["Skin & hair changes", "Flaky-paint dermatosis, flag-sign hair", "Dry, wrinkled skin, alert elderly facies"]
          ]
        }
      },
      {
        tx: "In contrast, **marasmus** results from global caloric starvation with deficiency of both protein and energy. Patients exhibit severe wasting of somatic muscle and subcutaneous adipose tissue, resulting in a broomstick-limb appearance, sunken eyes, and an alert, anxious, elderly facies without edema. Treatment of severe malnutrition requires cautious nutritional rehabilitation: rapid refeeding triggers **refeeding** syndrome, where carbohydrate-driven insulin surges drive phosphate, potassium, and magnesium into cells, precipitating fatal cardiac arrhythmias and cardiopulmonary collapse.",
        say: "Marasmus is severe caloric emaciation with loss of all muscle and fat, presenting with an elderly facies and no edema. Refeeding must be gradual to prevent refeeding syndrome, where insulin drives phosphate intracellularly, causing fatal cardiac arrest.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "r1", label: "Starved state with depleted intracellular minerals" },
            { id: "r2", label: "Rapid carbohydrate administration" },
            { id: "r3", label: "Surge in insulin secretion" },
            { id: "r4", label: "Massive cellular uptake of PO4, K+, Mg2+" },
            { id: "r5", label: "Severe hypophosphatemia, arrhythmias & heart failure" }
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

  // Ch 33: Lipoprotein Metabolism and Atherogenesis
  {
    module: "bio-lipoproteins",
    subject: "biochemistry",
    title: "Lipoprotein metabolism: apolipoproteins, receptor pathways, and dyslipidemias",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Lipoproteins transport insoluble triacylglycerols and cholesterol esters through the bloodstream encapsulated by an amphipathic monolayer of phospholipids, free cholesterol, and apolipoproteins. **Apolipoproteins** provide structural stability, serve as enzyme cofactors, and act as ligands for receptor-mediated clearance. Chylomicrons carry dietary lipids via Apo B-48. VLDL delivers endogenous hepatic triacylglycerols via Apo B-100. LDL transports cholesterol esters to peripheral tissues, and HDL mediates reverse cholesterol transport.",
        say: "Lipoproteins transport hydrophobic lipids encapsulated by phospholipids and apolipoproteins. Chylomicrons transport dietary fat via Apo B-48, VLDL carries hepatic triglycerides via Apo B-100, LDL delivers cholesterol, and HDL drives reverse cholesterol transport.",
        vis: {
          kind: "table",
          cols: ["Lipoprotein particle", "Major core lipid", "Signature apolipoprotein"],
          rows: [
            ["Chylomicron", "Dietary triacylglycerols (85%)", "Apo B-48, Apo C-II, Apo E"],
            ["VLDL", "Endogenous triacylglycerols (60%)", "Apo B-100, Apo C-II, Apo E"],
            ["IDL", "Triglycerides & cholesterol esters", "Apo B-100, Apo E"],
            ["LDL", "Cholesterol esters (50%)", "Apo B-100 (sole apoprotein)"],
            ["HDL", "Phospholipids & cholesterol esters", "Apo A-I (activates LCAT), Apo A-II"]
          ]
        }
      },
      {
        tx: "Capillary endothelial **lipoprotein lipase** (LPL) hydrolyzes core triacylglycerols in chylomicrons and VLDL, releasing free fatty acids for muscular oxidation and adipose storage. LPL requires apolipoprotein C-II as an obligatory cofactor. Depleted chylomicrons become chylomicron remnants, cleared by hepatic LDL-receptor-related protein via apolipoprotein E. VLDL remnants (IDL) are either cleared by the liver or further hydrolyzed by hepatic lipase to yield **LDL**, which contains solely Apo B-100.",
        say: "Endothelial lipoprotein lipase hydrolyzes triglycerides in chylomicrons and VLDL, activated by Apo C-II. Remnants are cleared via Apo E. IDL undergoes hepatic lipase cleavage to generate LDL containing only Apo B-100.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "l1", label: "Chylomicrons / VLDL enter capillaries" },
            { id: "l2", label: "Apo C-II activates Lipoprotein Lipase" },
            { id: "l3", label: "Core triglyceride hydrolysis & FFA release" },
            { id: "l4", label: "Hepatic lipase converts IDL into LDL" },
            { id: "l5", label: "Apo B-100 mediates peripheral LDL uptake" }
          ],
          edges: [
            ["l1", "l2"],
            ["l2", "l3"],
            ["l3", "l4"],
            ["l4", "l5"]
          ]
        }
      },
      {
        tx: "Reverse cholesterol transport is driven by **HDL** particles. Liver and intestine synthesize lipid-poor Apo A-I, which acquires free cholesterol from peripheral tissues via ABCA1 transporters. Lecithin-cholesterol acyltransferase (LCAT), activated by Apo A-I, esterifies free cholesterol into hydrophobic cholesterol esters, driving them into the HDL core. Cholesterol ester transfer protein (CETP) exchanges HDL cholesterol esters for VLDL triacylglycerols, directing cholesterol toward hepatic clearance via scavenger receptor BI.",
        say: "Reverse cholesterol transport moves peripheral cholesterol to the liver via HDL. Apo A-I activates LCAT to trap cholesterol as core esters. CETP exchanges HDL cholesterol esters with VLDL triglycerides, while hepatic SR-BI mediates final clearance.",
        vis: {
          kind: "table",
          cols: ["Enzyme / Transporter", "Apolipoprotein cofactor", "Biochemical action"],
          rows: [
            ["Lipoprotein lipase (LPL)", "Apo C-II", "Capillary triglyceride hydrolysis"],
            ["LCAT", "Apo A-I", "Esterifies free cholesterol in HDL"],
            ["CETP", "None (plasma protein)", "Transfers HDL cholesterol esters to VLDL/LDL"],
            ["ABCA1", "Apo A-I", "Effluxes cellular cholesterol to nascent HDL"]
          ]
        }
      },
      {
        tx: "Familial **hypercholesterolemia** (Type IIa dyslipidemia) results from autosomal dominant loss-of-function mutations in the LDL receptor or Apo B-100, or gain-of-function mutations in PCSK9. Impaired LDL clearance causes profound hypercholesterolemia, tendon xanthomas (especially Achilles tendon), xanthelasma, and premature coronary artery atherosclerosis. Heterozygotes suffer myocardial infarction in their 30s to 40s, while homozygotes manifest fatal coronary disease before age 20 unless treated with PCSK9 inhibitors or LDL apheresis.",
        say: "Familial hypercholesterolemia stems from defective LDL receptors or Apo B-100, causing severe hypercholesterolemia, Achilles tendon xanthomas, and premature myocardial infarction. PCSK9 monoclonal antibodies prevent receptor destruction, lowering LDL.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "h1", label: "Mutant LDL receptor or PCSK9 excess" },
            { id: "h2", label: "Failure of hepatic LDL endocytosis" },
            { id: "h3", label: "Severe elevation of circulating plasma LDL" },
            { id: "h4", label: "Endothelial lipid oxidation & foam cell formation" },
            { id: "h5", label: "Tendon xanthomas & premature myocardial infarction" }
          ],
          edges: [
            ["h1", "h2"],
            ["h2", "h3"],
            ["h3", "h4"],
            ["h4", "h5"]
          ]
        }
      }
    ]
  },

  // Ch 34: Role of the Liver in Metabolism: Heme and Detoxification
  {
    module: "bio-liver-heme-detox",
    subject: "biochemistry",
    title: "Heme biosynthesis, porphyrias, bilirubin metabolism, and xenobiotic detoxification",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Heme **biosynthesis** initiates in mitochondria and requires glycine and succinyl-CoA. The rate-limiting enzyme aminolevulinic acid (ALA) synthase condenses glycine with succinyl-CoA to form delta-ALA, requiring pyridoxal phosphate (vitamin B6). Heme exerts negative feedback allosteric inhibition and transcriptional repression on hepatic ALA synthase-1. In contrast, erythroid ALA synthase-2 is regulated by iron response elements and unaffected by heme, but defective in X-linked sideroblastic anemia.",
        say: "Heme synthesis begins in mitochondria with ALA synthase, condensing glycine and succinyl-CoA with vitamin B6. Hepatic ALA synthase-1 is feedback-inhibited by heme, whereas erythroid ALA synthase-2 is iron-regulated, deficient in X-linked sideroblastic anemia.",
        vis: {
          kind: "table",
          cols: ["Enzyme", "Cellular compartment", "Pathology when deficient / poisoned"],
          rows: [
            ["ALA synthase-2", "Mitochondrial matrix", "X-linked sideroblastic anemia (ringed sideroblasts)"],
            ["ALA dehydratase", "Cytosol", "Inhibited by Lead poisoning (elevates ALA)"],
            ["Porphobilinogen deaminase", "Cytosol", "Acute Intermittent Porphyria (neurovisceral attacks)"],
            ["Uroporphyrinogen decarboxylase", "Cytosol", "Porphyria Cutanea Tarda (blistering photosensitivity)"],
            ["Ferrochelatase", "Inner mitochondrial membrane", "Inhibited by Lead; elevated free erythrocyte protoporphyrin"]
          ]
        }
      },
      {
        tx: "Inherited defects in heme synthetic enzymes cause **porphyrias**. Acute intermittent porphyria results from autosomal dominant porphobilinogen deaminase deficiency. Accumulation of neurotoxic ALA and PBG triggers episodic severe abdominal pain, peripheral motor neuropathy, red-wine urine upon light exposure, and psychosis without cutaneous photosensitivity. Attacks are precipitated by CYP450 inducers (barbiturates, antiepileptics), fasting, or alcohol, which deplete heme and derepress ALA synthase-1. Intravenous **hemin** treats attacks by restoring feedback inhibition.",
        say: "Acute intermittent porphyria is caused by porphobilinogen deaminase deficiency. Toxic accumulation of ALA and PBG causes severe abdominal pain, motor neuropathy, port-wine urine, and psychosis without photosensitivity. Hemin infusions abort attacks by repressing ALA synthase.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "p1", label: "Porphobilinogen deaminase deficiency" },
            { id: "p2", label: "CYP450 inducer triggers heme depletion" },
            { id: "p3", label: "Massive derepression of ALA synthase-1" },
            { id: "p4", label: "Accumulation of neurotoxic ALA and PBG" },
            { id: "p5", label: "Abdominal pain, motor neuropathy, psychiatric crisis" }
          ],
          edges: [
            ["p1", "p2"],
            ["p2", "p3"],
            ["p3", "p4"],
            ["p4", "p5"]
          ]
        }
      },
      {
        tx: "Senescent erythrocyte hemoglobin degrades in splenic reticuloendothelial macrophages. Heme oxygenase cleaves heme into biliverdin, releasing iron and carbon monoxide; biliverdin reductase reduces biliverdin to insoluble unconjugated bilirubin. Bound to albumin, unconjugated bilirubin travels to hepatocytes, where uridine diphosphate-glucuronosyltransferase (UGT1A1) conjugates it with two glucuronic acid molecules. Water-soluble **conjugated** bilirubin is actively excreted into bile by the MRP2 canalicular transporter, the rate-limiting step in clearance.",
        say: "Heme catabolizes to biliverdin and unconjugated bilirubin in macrophages. Albumin-bound bilirubin enters hepatocytes, where UGT1A1 conjugates it with glucuronic acid. MRP2 actively secretes conjugated bilirubin into bile, representing the rate-limiting step.",
        vis: {
          kind: "table",
          cols: ["Disorder of bilirubin handling", "Enzymatic / Transport defect", "Bilirubin profile"],
          rows: [
            ["Gilbert syndrome", "UGT1A1 promoter mutation (decreased ~70%)", "Mild unconjugated hyperbilirubinemia in fasting/stress"],
            ["Crigler-Najjar Type I", "Total absence of UGT1A1 activity", "Severe unconjugated jaundice, fatal kernicterus"],
            ["Dubin-Johnson syndrome", "Mutated MRP2 canalicular transporter", "Conjugated hyperbilirubinemia, black pigmented liver"],
            ["Rotor syndrome", "Mutated OATP1B1/1B3 organic anion uptake", "Conjugated hyperbilirubinemia, normal histology"]
          ]
        }
      },
      {
        tx: "Hepatic **xenobiotic** detoxification converts lipophilic toxins and pharmaceuticals into excretable polar metabolites. Phase I reactions (oxidation, reduction, hydrolysis) are catalyzed by microsomal Cytochrome P450 monooxygenases in the smooth endoplasmic reticulum, creating reactive functional groups. Phase II reactions conjugate these intermediates with glucuronic acid, glutathione, sulfate, or acetate. In acetaminophen toxicity, CYP2E1 generates toxic **NAPQI**, which depletes hepatic glutathione; N-acetylcysteine restores glutathione pools to prevent fatal hepatic necrosis.",
        say: "Hepatic biotransformation uses Phase I CYP450 oxidation followed by Phase II conjugation with glucuronide or glutathione. In acetaminophen overdose, toxic NAPQI exhausts glutathione; early N-acetylcysteine restores glutathione to prevent liver failure.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "x1", label: "Acetaminophen overdose" },
            { id: "x2", label: "CYP2E1 generates toxic NAPQI" },
            { id: "x3", label: "Hepatic glutathione stores exhausted" },
            { id: "x4", label: "NAPQI binds hepatocyte macromolecules" },
            { id: "x5", label: "Centrilobular hepatic necrosis (prevented by NAC)" }
          ],
          edges: [
            ["x1", "x2"],
            ["x2", "x3"],
            ["x3", "x4"],
            ["x4", "x5"]
          ]
        }
      }
    ]
  }
];
