/**
 * Wave 3B Generator: Medical Biochemistry Part 2 (Chapters 21 to 43)
 * 23 Interactive Lessons in prep/lessons/v1/
 */

const wave3bLessonsPart1 = [
  // Ch 21: Ribonucleic Acid & Transcription
  {
    module: "bio-transcription-splicing",
    subject: "biochemistry",
    title: "RNA transcription, post-transcriptional processing, and spliceosome defects",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Eukaryotic **transcription** is orchestrated by three distinct nuclear RNA polymerases. RNA polymerase I synthesizes 28S, 18S, and 5.8S ribosomal RNAs. RNA polymerase II transcribes messenger RNAs and microRNAs, but is selectively inhibited by alpha-amanitin from death cap mushrooms. RNA polymerase III produces transfer RNAs and 5S ribosomal RNA. Initiation requires TATA-binding protein and general transcription factors assembling at core promoter elements.",
        say: "Eukaryotic transcription utilizes three nuclear RNA polymerases. RNA polymerase one synthesizes ribosomal RNAs, RNA polymerase two generates messenger RNAs and is poisoned by alpha-amanitin, while RNA polymerase three produces transfer RNAs. Promoter assembly requires TATA-binding protein.",
        vis: {
          kind: "table",
          cols: ["Polymerase", "Primary RNA transcripts", "Alpha-amanitin sensitivity"],
          rows: [
            ["RNA Pol I", "28S, 18S, 5.8S ribosomal RNA", "Insensitive / resistant"],
            ["RNA Pol II", "Pre-mRNA, microRNAs, snRNAs", "Extremely sensitive (lethal toxicity)"],
            ["RNA Pol III", "5S rRNA, transfer RNAs (tRNAs)", "Sensitive only at high concentrations"],
            ["Mitochondrial Pol", "Mitochondrial rRNAs, tRNAs, mRNAs", "Rifampin and amanitin resistant"]
          ]
        }
      },
      {
        tx: "Primary mRNA transcripts undergo essential **post-transcriptional** modifications within the nucleus prior to export. A 7-methylguanosine cap is added to the 5-prime end to ensure ribonuclease protection and ribosome recognition. Polyadenylate polymerase attaches a 200-nucleotide poly-A tail to the 3-prime terminus. The **spliceosome**, composed of small nuclear ribonucleoproteins, precisely excises non-coding introns at invariant GU-5-prime and AG-3-prime donor-acceptor splice junctions.",
        say: "Primary transcripts require three nuclear processing steps: addition of a 5-prime 7-methylguanosine cap, 3-prime polyadenylation by poly-A polymerase, and spliceosomal removal of non-coding introns at GU and AG consensus junctions by small nuclear ribonucleoproteins.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "p1", label: "Pre-mRNA synthesis" },
            { id: "p2", label: "5-prime 7-methylguanosine cap" },
            { id: "p3", label: "3-prime cleavage & poly-A tail" },
            { id: "p4", label: "Spliceosome intron excision" },
            { id: "p5", label: "Mature mRNA nuclear export" }
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
        tx: "Mutations altering consensus splice sites cause severe human **pathology**. Splicing mutations in the beta-globin gene disrupt normal exon assembly, generating aberrant transcripts and severe beta-thalassemia major. In systemic lupus erythematosus, autoantibodies target **snRNPs** (anti-Smith antibodies), directly impeding spliceosome assembly. Alternative splicing enables a single pre-mRNA to yield distinct tissue-specific protein isoforms, including membrane-bound versus secreted immunoglobulins.",
        say: "Splice site mutations cause aberrant exon inclusion, underlying beta-thalassemia. Anti-Smith antibodies in lupus specifically target snRNPs, impairing spliceosomal machinery. Alternative splicing allows a single gene to encode diverse tissue-specific isoforms.",
        vis: {
          kind: "table",
          cols: ["Disorder / Condition", "Molecular splicing defect", "Clinical consequence"],
          rows: [
            ["Beta-thalassemia", "Splice junction GU to AU or AG mutation", "Absent or deficient beta-globin synthesis"],
            ["Systemic lupus erythematosus", "Autoantibodies against Smith (Sm) snRNPs", "Spliceosomal auto-inflammation and nephritis"],
            ["Spinal muscular atrophy", "SMN2 exon 7 alternative skipping", "Motor neuron degeneration in anterior horn"],
            ["Tropomyosin diversity", "Alternative exon selection across tissues", "Striated vs smooth muscle isoform specialization"]
          ]
        }
      },
      {
        tx: "Therapeutic modulation of RNA splicing represents a major **pharmacological** breakthrough. Nusinersen, an antisense oligonucleotide, binds pre-mRNA of the SMN2 gene, forcing exon 7 inclusion to restore functional motor protein in spinal muscular atrophy. Duchenne muscular dystrophy is treated by antisense morpholinos that induce exon-skipping to restore an in-frame dystrophin reading frame, converting fatal muscular dystrophy into a milder Becker phenotype.",
        say: "Therapeutic splice modulation uses antisense oligonucleotides like nusinersen to promote exon inclusion in spinal muscular atrophy, or exon-skipping morpholinos to restore in-frame dystrophin reading frames in Duchenne muscular dystrophy.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "t1", label: "Antisense oligonucleotide" },
            { id: "t2", label: "Hybridizes pre-mRNA exon junction" },
            { id: "t3", label: "Steric block of splicing silencer" },
            { id: "t4", label: "Exon inclusion / frame restored" },
            { id: "t5", label: "Functional protein expression" }
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

  // Ch 22: Protein Synthesis and Turnover
  {
    module: "bio-translation-proteasome",
    subject: "biochemistry",
    title: "Ribosomal translation, genetic code fidelity, and the ubiquitin-proteasome system",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Lehninger Principles of Biochemistry 8th ed"],
    steps: [
      {
        tx: "Eukaryotic **translation** translates messenger RNA codons into polypeptide sequences on 80S ribosomes composed of 40S and 60S subunits. Aminoacyl-tRNA synthetases guarantee fidelity by charging specific amino acids onto matching tRNAs using ATP hydrolysis; these enzymes possess hydrolytic proofreading sites that destroy misactivated amino acids. The genetic code is universal, degenerate, and non-overlapping, with AUG serving as the near-universal initiator codon encoding methionine.",
        say: "Translation occurs on 80S cytoplasmic ribosomes. Aminoacyl-tRNA synthetases ensure genetic fidelity by coupling amino acids to cognate tRNAs with proofreading capability. The triplet code is degenerate and unambiguous, initiating at AUG codons encoding methionine.",
        vis: {
          kind: "table",
          cols: ["Translational step", "Required factors", "Energy consumer"],
          rows: [
            ["Initiation", "eIF2, eIF4F cap-binding complex", "GTP hydrolysis (eIF2-GTP)"],
            ["Elongation", "eEF1A (tRNA delivery), eEF2 (translocation)", "GTP per incoming tRNA and translocation"],
            ["Termination", "eRF1, eRF3 (recognize UAA, UAG, UGA)", "GTP hydrolysis releasing peptide"],
            ["tRNA charging", "Aminoacyl-tRNA synthetase", "ATP cleaved to AMP and pyrophosphate"]
          ]
        }
      },
      {
        tx: "Ribosomal elongation proceeds through three sequential tRNA binding sites: the **aminoacyl** (A) site, the **peptidyl** (P) site, and the exit (E) site. Peptidyl transferase, an intrinsic 28S ribosomal RNA ribozyme within the large 60S subunit, catalyzes peptide bond formation without external protein enzymes. Eukaryotic elongation factor 2 then drives ribosome translocation along the mRNA by exactly three nucleotides, utilizing GTP hydrolysis.",
        say: "Elongation cycles through A, P, and E ribosomal sites. Peptidyl transferase ribozyme activity in the large subunit forms the peptide bond, while elongation factor 2 consumes GTP to translocate the ribosome by three nucleotides.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "e1", label: "Aminoacyl-tRNA binds A site" },
            { id: "e2", label: "Peptidyl transferase peptide bond" },
            { id: "e3", label: "eEF2-GTP driven translocation" },
            { id: "e4", label: "Deacylated tRNA exits E site" },
            { id: "e5", label: "Empty A site accepts next codon" }
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
        tx: "Bacterial and bacterial-derived toxins exploit ribosomal vulnerability. Diphtheria toxin and Pseudomonas exotoxin A transfer ADP-ribose from NAD+ onto elongation factor 2, inactivating it and completely shutting down host protein synthesis. Ricin toxin catalytic subunit depurinates a specific adenine residue in the 28S rRNA ribozyme, irreversibly destroying peptidyl transferase capacity. In contrast, aminoglycosides, macrolides, and tetracyclines selectively bind prokaryotic **70S** ribosomes.",
        say: "Diphtheria toxin and Pseudomonas exotoxin inactivate eEF2 by ADP-ribosylation, halting host translation. Ricin depurinates 28S rRNA, killing ribozyme function. Clinical antibiotics selectively target bacterial 70S ribosomes.",
        vis: {
          kind: "table",
          cols: ["Inhibitor / Toxin", "Molecular target", "Mechanism of arrest"],
          rows: [
            ["Diphtheria toxin", "eEF2 (diphthamide residue)", "ADP-ribosylation halts translocation"],
            ["Exotoxin A (Pseudomonas)", "eEF2", "Identical ADP-ribosylation of eEF2"],
            ["Ricin (Ricinus communis)", "28S rRNA (adenine 4324)", "Depurination destroys peptidyl transferase"],
            ["Cycloheximide", "60S ribosomal subunit", "Inhibits eukaryotic peptidyl transferase"]
          ]
        }
      },
      {
        tx: "Short-lived, regulatory, and misfolded proteins undergo targeted degradation via the **ubiquitin-proteasome** system. Ubiquitin is covalently linked to target lysine residues through sequential E1 activating, E2 conjugating, and E3 ligase enzymes. Polyubiquitin chains of four or more ubiquitin units target the substrate to the 26S proteasome for ATP-dependent unfolding and peptide cleavage. Proteasome inhibitors like bortezomib induce apoptotic death in malignant plasma cells in multiple myeloma.",
        say: "The ubiquitin-proteasome pathway regulates cellular proteostasis. E1, E2, and E3 ligases polyubiquitinate target proteins, directing them to the 26S proteasome for degradation. Bortezomib inhibits proteasomal degradation, treating multiple myeloma.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "u1", label: "E1 enzyme activates ubiquitin" },
            { id: "u2", label: "E2 transfers ubiquitin moiety" },
            { id: "u3", label: "E3 ligase confers substrate specificity" },
            { id: "u4", label: "Polyubiquitinated substrate to 26S" },
            { id: "u5", label: "Proteasomal cleavage to oligopeptides" }
          ],
          edges: [
            ["u1", "u2"],
            ["u2", "u3"],
            ["u3", "u4"],
            ["u4", "u5"]
          ]
        }
      }
    ]
  },

  // Ch 23: Regulation of Gene Expression
  {
    module: "bio-gene-regulation",
    subject: "biochemistry",
    title: "Epigenetic mechanisms, chromatin remodeling, and transcriptional regulation",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Lehninger Principles of Biochemistry 8th ed"],
    steps: [
      {
        tx: "Gene expression in multicellular organisms is fundamentally governed by **chromatin** structure. Genomic DNA wraps around octamers of core histones (H2A, H2B, H3, H4) to form nucleosomes. Dense, transcriptionally silent heterochromatin resists transcription factor access, whereas relaxed, open euchromatin facilitates gene activation. Histone acetyltransferases add acetyl groups to basic lysine tails, neutralizing positive charges and loosening histone-DNA electrostatic interactions.",
        say: "Chromatin structure regulates genomic accessibility. DNA wraps around histone octamers forming nucleosomes. Condensed heterochromatin is transcriptionally inert, whereas open euchromatin permits transcription factor binding. Histone acetyltransferases neutralize lysine charges to relax chromatin.",
        vis: {
          kind: "table",
          cols: ["Chromatin state", "Histone modification", "Transcriptional consequence"],
          rows: [
            ["Euchromatin", "High acetylation, H3K4 methylation", "Open, active transcription"],
            ["Heterochromatin", "Deacetylation, H3K9/H3K27 methylation", "Condensed, transcriptionally repressed"],
            ["CpG methylation", "DNA methyltransferase (DNMT)", "Gene silencing, genomic imprinting"],
            ["SWI/SNF complex", "ATP-dependent chromatin remodeling", "Nucleosome sliding exposes promoters"]
          ]
        }
      },
      {
        tx: "DNA **methylation** constitutes a stable, heritable epigenetic mark. DNA methyltransferases transfer methyl groups from S-adenosylmethionine onto cytosine bases within CpG dinucleotide islands located in gene promoters. Methylated CpG motifs recruit methyl-CpG-binding domain proteins (MeCP2) that recruit histone deacetylases, cementing transcriptional silencing. Rett syndrome is caused by loss-of-function mutations in MeCP2, causing progressive neurodevelopmental regression in young girls.",
        say: "DNA methyltransferases transfer methyl groups to promoter CpG islands, recruiting MeCP2 and histone deacetylases to maintain gene silencing. Mutations in MeCP2 cause Rett syndrome, characterized by neurodevelopmental regression and hand-wringing stereotypic movements.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "m1", label: "SAM donates methyl to CpG cytosine" },
            { id: "m2", label: "DNA methyltransferase 1 maintains mark" },
            { id: "m3", label: "MeCP2 binds methylated CpG islands" },
            { id: "m4", label: "Recruitment of histone deacetylases" },
            { id: "m5", label: "Chromatin compaction & gene silencing" }
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
        tx: "Genomic **imprinting** represents parent-of-origin specific gene expression mediated by differential DNA methylation. In Prader-Willi syndrome, deletion or maternal uniparental disomy of the paternal 15q11-q13 region deprives the patient of paternally expressed genes, resulting in neonatal hypotonia and compulsive hyperphagia. Conversely, deletion or paternal uniparental disomy of the maternal 15q11-q13 locus (inactivating the maternal UBE3A ubiquitin ligase) produces Angelman syndrome, manifesting with paroxysmal laughter and ataxia.",
        say: "Genomic imprinting selectively silences maternal or paternal alleles via methylation. Loss of paternal 15q11-q13 produces Prader-Willi syndrome with hyperphagia, while loss of maternal 15q11-q13 UBE3A yields Angelman syndrome with ataxia and inappropriate laughter.",
        vis: {
          kind: "table",
          cols: ["Syndrome", "Chromosomal defect", "Key clinical phenotype"],
          rows: [
            ["Prader-Willi", "Paternal 15q11-q13 deletion or maternal UPD", "Hypotonia, hyperphagia, obesity, hypogonadism"],
            ["Angelman", "Maternal 15q11-q13 deletion (UBE3A) or paternal UPD", "Severe intellectual deficit, ataxia, puppet gait, laughter"],
            ["Beckwith-Wiedemann", "11p15 imprinting defect (IGF2 overexpression)", "Macrosomia, omphalocele, Wilms tumor risk"],
            ["Russell-Silver", "11p15 loss of methylation or maternal UPD 7", "Intrauterine growth restriction, triangular face"]
          ]
        }
      },
      {
        tx: "Epigenetic therapies provide potent **antineoplastic** tools. DNA hypomethylating agents like 5-azacitidine and decitabine incorporate into DNA, trapping DNA methyltransferases and re-activating silenced tumor suppressor genes in myelodysplastic syndromes. Histone deacetylase inhibitors like vorinostat and romidepsin promote hyperacetylation of histone lysines, forcing chromatin relaxation and inducing cell cycle arrest in cutaneous T-cell lymphomas.",
        say: "Hypomethylating agents azacitidine and decitabine trap DNA methyltransferases to reactivate silenced tumor suppressors in myelodysplastic syndromes. Histone deacetylase inhibitors like vorinostat enforce hyperacetylation, treating cutaneous T-cell lymphoma.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "e1", label: "Azacitidine incorporates into DNA" },
            { id: "e2", label: "Covalent trapping of DNMT1 enzyme" },
            { id: "e3", label: "Passive hypomethylation across replication" },
            { id: "e4", label: "Tumor suppressor promoter re-opening" },
            { id: "e5", label: "Cell differentiation & apoptosis" }
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

  // Ch 24: Genomics, Proteomics, and Metabolomics
  {
    module: "bio-omics-diagnostics",
    subject: "biochemistry",
    title: "Clinical genomics, mass spectrometry proteomics, and pharmacogenomic diagnostics",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Modern molecular pathology relies on high-throughput **genomic** technologies. Next-generation sequencing utilizes massively parallel clonal amplification to interrogate whole exomes or targeted gene panels simultaneously. Genomic hybridization microarrays detect copy number variations across chromosomes, diagnosing submicroscopic deletions and duplications. Polymerase chain reaction amplifies specific target loci, whereas digital droplet PCR enables absolute quantification of low-frequency circulating tumor DNA in liquid biopsies.",
        say: "High-throughput genomics has transformed molecular diagnostics. Next-generation sequencing performs massively parallel exome or panel sequencing. Microarrays detect submicroscopic copy number variants, while digital droplet PCR quantifies circulating tumor DNA from liquid biopsies.",
        vis: {
          kind: "table",
          cols: ["Genomic platform", "Diagnostic target", "Clinical utility"],
          rows: [
            ["Next-generation sequencing", "Point mutations, small indels, fusions", "Oncology panels, rare Mendelian diseases"],
            ["Chromosomal microarray", "Copy number variations (>50-100 kb)", "Unexplained developmental delay, autism"],
            ["Digital droplet PCR", "Absolute copy number / rare variants", "Minimal residual disease, cell-free liquid biopsy"],
            ["Sanger sequencing", "Targeted single amplicon read (500-800 bp)", "Gold standard variant confirmation"]
          ]
        }
      },
      {
        tx: "Proteomics investigates the complete protein complement of biological samples using **mass spectrometry**. Matrix-assisted laser desorption/ionization time-of-flight (MALDI-TOF) mass spectrometry analyzes intact bacterial and fungal proteins, identifying infectious pathogens within minutes of positive blood culture. Liquid chromatography tandem mass spectrometry (LC-MS/MS) separates and fragments peptides, enabling multiplexed newborn screening for dozens of inborn errors of amino acid and fatty acid metabolism from a single blood spot.",
        say: "Mass spectrometry drives clinical proteomics. MALDI-TOF identifies positive microbiological cultures in minutes by spectral fingerprinting. Tandem mass spectrometry enables universal newborn screening of amino acid and acylcarnitine disorders from dried blood spots.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "p1", label: "Dried newborn blood spot elution" },
            { id: "p2", label: "Electrospray ionization (ESI)" },
            { id: "p3", label: "MS1 precursor ion mass filter" },
            { id: "p4", label: "Collision cell fragmentation" },
            { id: "p5", label: "MS2 diagnostic acylcarnitine readout" }
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
        tx: "Pharmacogenomics evaluates how genetic variation influences drug response and **toxicity**. Cytochrome P450 2D6 polymorphisms govern the bioactivation of codeine into morphine; ultrarapid metabolizers experience fatal opioid intoxication at therapeutic doses, while poor metabolizers obtain no analgesia. Thiopurine methyltransferase (TPMT) deficiency prevents 6-mercaptopurine degradation, triggering life-threatening myelosuppression unless the dose is reduced by 90 percent. Dihydropyrimidine dehydrogenase deficiency produces lethal 5-fluorouracil neurotoxicity and pancytopenia.",
        say: "Pharmacogenomics predicts therapeutic efficacy and toxicity. CYP2D6 ultrarapid metabolizers risk opioid toxicity from codeine. TPMT deficiency prevents 6-mercaptopurine breakdown causing fatal bone marrow suppression, while DPD deficiency makes 5-FU lethal.",
        vis: {
          kind: "table",
          cols: ["Gene / Enzyme", "Substrate medication", "Adverse outcome if deficient / altered"],
          rows: [
            ["CYP2D6", "Codeine, tamoxifen", "Ultra: opioid overdose; Poor: lack of prodrug activation"],
            ["TPMT / NUDT15", "6-Mercaptopurine, azathioprine", "Severe pancytopenia, fatal myelosuppression"],
            ["DPYD (DPD)", "5-Fluorouracil, capecitabine", "Severe mucositis, neutropenia, neurotoxicity"],
            ["HLA-B*57:01", "Abacavir (antiretroviral)", "Severe hypersensitivity reaction (fatal if rechallenged)"]
          ]
        }
      },
      {
        tx: "Pre-therapeutic genetic screening prevents preventable adverse drug reactions. The **HLA-B-5701** allele is tested prior to initiating abacavir; carrier status mandates absolute contraindication to prevent fatal multiorgan hypersensitivity. Similarly, HLA-B*15:02 screening in Asian populations prevents carbamazepine-induced Stevens-Johnson syndrome and toxic epidermal necrolysis. VKORC1 and CYP2C9 testing guides warfarin dosing, preventing major hemorrhage during anticoagulation initiation.",
        say: "Mandatory pharmacogenetic tests protect patients: HLA-B-5701 screening prevents fatal abacavir hypersensitivity, HLA-B-1502 prevents carbamazepine-induced Stevens-Johnson syndrome, and VKORC1/CYP2C9 testing prevents warfarin-induced hemorrhage.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "s1", label: "Patient scheduled for pharmacotherapy" },
            { id: "s2", label: "Genotype allele screening" },
            { id: "s3", label: "High-risk variant identified" },
            { id: "s4", label: "Select alternative safe agent" },
            { id: "s5", label: "Complete prevention of severe reaction" }
          ],
          edges: [
            ["s1", "s2"],
            ["s2", "s3"],
            ["s3", "s4"],
            ["s4", "s5"]
          ]
        }
      }
    ]
  },

  // Ch 25: Membrane Receptors and Signal Transduction
  {
    module: "bio-signal-transduction",
    subject: "biochemistry",
    title: "G-protein coupled receptors, second messengers, and receptor tyrosine kinase signaling",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Lehninger Principles of Biochemistry 8th ed"],
    steps: [
      {
        tx: "Transmembrane signaling translates extracellular endocrine cues into intracellular **responses**. G-protein coupled receptors contain seven membrane-spanning alpha helices coupled to heterotrimeric G-proteins (alpha, beta, gamma). Agonist binding induces GDP-GTP exchange on the G-alpha subunit, triggering dissociation from beta-gamma dimers. G-alpha-s activates adenylyl cyclase to generate cyclic AMP, which stimulates protein kinase A. G-alpha-i inhibits adenylyl cyclase, lowering cyclic AMP levels.",
        say: "GPCRs possess seven transmembrane helices coupled to heterotrimeric G-proteins. Agonist binding drives GTP loading onto G-alpha subunits. G-alpha-s activates adenylyl cyclase to generate cAMP and stimulate PKA, whereas G-alpha-i inhibits cAMP production.",
        vis: {
          kind: "table",
          cols: ["G-alpha subunit", "Primary effector", "Second messenger / downstream kinase"],
          rows: [
            ["G-alpha-s", "Adenylyl cyclase activation", "Elevates cAMP -> activates Protein Kinase A"],
            ["G-alpha-i", "Adenylyl cyclase inhibition", "Decreases cAMP -> inhibits Protein Kinase A"],
            ["G-alpha-q", "Phospholipase C-beta activation", "Cleaves PIP2 to IP3 (Ca2+ release) and DAG (PKC)"],
            ["G-alpha-12/13", "Rho guanine nucleotide exchange", "Cytoskeletal remodeling and cell motility"]
          ]
        }
      },
      {
        tx: "The **phospholipase C** pathway mediates hormones signaling via G-alpha-q, such as angiotensin II, vasopressin (V1 receptor), and alpha-1 adrenergic agonists. Active G-alpha-q activates phospholipase C-beta, which hydrolyzes membrane phosphatidylinositol 4,5-bisphosphate into inositol 1,4,5-trisphosphate (IP3) and diacylglycerol (DAG). Soluble IP3 diffuses to endoplasmic reticulum IP3-gated channels, releasing calcium into the cytosol. Elevated calcium and membrane DAG synergistically activate **protein kinase C**.",
        say: "The G-alpha-q pathway couples angiotensin II and alpha-1 receptors to phospholipase C, cleaving PIP2 into IP3 and DAG. IP3 triggers endoplasmic reticulum calcium release, while DAG and calcium activate protein kinase C.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "q1", label: "Hormone binds G-alpha-q receptor" },
            { id: "q2", label: "Phospholipase C-beta activation" },
            { id: "q3", label: "PIP2 cleaved to IP3 + DAG" },
            { id: "q4", label: "IP3 opens ER calcium channels" },
            { id: "q5", label: "Calcium + DAG stimulate Protein Kinase C" }
          ],
          edges: [
            ["q1", "q2"],
            ["q2", "q3"],
            ["q3", "q4"],
            ["q4", "q5"]
          ]
        }
      },
      {
        tx: "Receptor **tyrosine kinases** mediate responses to growth factors like insulin, epidermal growth factor, and VEGF. Ligand binding triggers receptor dimerization and autophosphorylation of intracellular tyrosine residues. Phosphotyrosines recruit SH2-domain adaptors like Grb2 and SOS, which stimulate membrane-bound Ras to exchange GDP for GTP. Active Ras initiates the sequential Raf-MEK-ERK kinase cascade, driving nuclear transcription factors that promote cell cycle entry and proliferation.",
        say: "Receptor tyrosine kinases dimerize and autophosphorylate on tyrosine residues upon growth factor binding. Phosphotyrosines recruit Grb2-SOS to activate Ras-GTP, launching the Raf-MEK-ERK mitogen-activated protein kinase cascade to drive cell proliferation.",
        vis: {
          kind: "table",
          cols: ["Pathway component", "Molecular function", "Oncogenic mutation / targeted drug"],
          rows: [
            ["EGFR / HER2", "Receptor tyrosine kinase", "Trastuzumab (HER2 mAb), Osimertinib (EGFR TKI)"],
            ["Ras (K-Ras, N-Ras)", "Small GTPase molecular switch", "G12D/C mutations lock in GTP state; Sotorasib"],
            ["B-Raf", "Serine/threonine kinase", "V600E mutation in melanoma; Vemurafenib"],
            ["PI3K / Akt / mTOR", "Survival and growth signaling", "Everolimus, Alpelisib (PI3K inhibitor)"]
          ]
        }
      },
      {
        tx: "Mutations disrupting signaling cascades underlie human **endocrinopathies**. Albright hereditary osteodystrophy (pseudohypoparathyroidism type 1A) results from inactivating mutations in the GNAS1 gene encoding G-alpha-s; target tissues fail to respond to parathyroid hormone, TSH, and gonadotropins despite elevated circulating hormone levels. Activating somatic GNAS1 mutations during embryogenesis cause McCune-Albright syndrome, characterized by polyostotic fibrous dysplasia, cafe-au-lait macules, and precocious puberty.",
        say: "Inactivating GNAS mutations encoding G-alpha-s cause pseudohypoparathyroidism with end-organ hormone resistance. Somatic activating GNAS mutations produce McCune-Albright syndrome with fibrous dysplasia, cafe-au-lait spots, and precocious puberty.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "g1", label: "GNAS gene mutation" },
            { id: "g2", label: "Altered G-alpha-s subunit activity" },
            { id: "g3", label: "Constitutive cAMP vs lack of cAMP" },
            { id: "g4", label: "Endocrine hyperfunction vs resistance" },
            { id: "g5", label: "McCune-Albright vs Albright osteodystrophy" }
          ],
          edges: [
            ["g1", "g2"],
            ["g2", "g3"],
            ["g3", "g4"],
            ["g4", "g5"]
          ]
        }
      }
    ]
  }
];

import { wave3bLessonsPart2 } from "./wave3b-lessons-part2.mjs";
import { wave3bLessonsPart3 } from "./wave3b-lessons-part3.mjs";

export const wave3bLessons = [
  ...wave3bLessonsPart1,
  ...wave3bLessonsPart2,
  ...wave3bLessonsPart3
];
