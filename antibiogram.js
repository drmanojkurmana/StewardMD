/* StewardMD — Antibiogram & Antibiotic-Coverage explorer (standalone full-page module).
   Self-contained overlay; window.ABG.open() / window.ABG.close().
   TWO tabs:
     • Resistance — pick a source (ICMR 2024 national / a local hospital antibiogram) and
       read organism × antibiotic resistance rates as a colour-coded heatmap.
     • Coverage   — an interactive spectrum-of-activity grid (drug class × organism group);
       tap a drug or an organism to see, at a glance, what covers what.

   EDUCATIONAL DECISION SUPPORT ONLY. Coverage is qualitative spectrum of activity.
   Resistance figures are INDICATIVE and MUST be verified against the current ICMR AMRSN
   report and your own local antibiogram before any clinical use. Does not touch clinical
   reasoning, patient storage, secrets or Cloudflare bindings. */
(function () {
  "use strict";

  function abIco(n){ return (window.ICONS && ICONS.get) ? ICONS.get(n) : ""; }

  /* ─────────────────────────  COVERAGE DATA  ─────────────────────────
     Organism columns grouped; coverage is the classic spectrum-of-activity
     (ref: github.com/aetherist/antibiogram, educational). */
  // Organism + key resistance-phenotype columns, grouped.
  var GROUPS = [
    { id: "gpc", name: "Gram-positive", cols: [
      { id: "mrsa", label: "MRSA" }, { id: "mssa", label: "MSSA" }, { id: "strep", label: "Streptococci" },
      { id: "efaecalis", label: "E. faecalis" }, { id: "efaecium", label: "E. faecium / VRE" },
      { id: "listeria", label: "Listeria" } ] },
    { id: "entero", name: "Enterobacterales", cols: [
      { id: "ecoli", label: "E. coli" }, { id: "kleb", label: "Klebsiella" }, { id: "pmir", label: "P. mirabilis" },
      { id: "escappm", label: "ESCAPPM (AmpC)" }, { id: "esbl", label: "ESBL" }, { id: "cre", label: "CRE" } ] },
    { id: "nonferm", name: "Non-fermenters", cols: [
      { id: "pseud", label: "P. aeruginosa" }, { id: "acineto", label: "A. baumannii" },
      { id: "steno", label: "S. maltophilia" } ] },
    { id: "fast", name: "Fastidious / GN cocci", cols: [
      { id: "hflu", label: "H. influenzae" }, { id: "morax", label: "Moraxella" },
      { id: "ngon", label: "N. gonorrhoeae" }, { id: "nmen", label: "N. meningitidis" } ] },
    { id: "ana", name: "Anaerobes", cols: [
      { id: "bfrag", label: "B. fragilis" }, { id: "oralana", label: "Oral anaerobes" } ] },
    { id: "aty", name: "Atypicals", cols: [
      { id: "atyp", label: "Mycoplasma / Chlamydia" }, { id: "legio", label: "Legionella" } ] }
  ];
  // Tier-1 Gram-stain bands over the organism groups. Many clinicians don't recognise that
  // Enterobacterales (E. coli, Klebsiella…), non-fermenters and fastidious GN rods are all
  // Gram-negative, so those three families sit under an explicit "Gram-negative" banner.
  // Single-family bands (gpc / ana / aty) span both header rows.
  var BANDS = [
    { id: "gpc", name: "Gram-positive", groups: ["gpc"] },
    { id: "gneg", name: "Gram-negative", groups: ["entero", "nonferm", "fast"] },
    { id: "ana", name: "Anaerobes", groups: ["ana"] },
    { id: "aty", name: "Atypicals", groups: ["aty"] }
  ];
  var COLS = [];
  GROUPS.forEach(function (g) { g.cols.forEach(function (c) { c.group = g.id; COLS.push(c); }); });

  // Drug rows: class + agent + a MAP of organism-column → tier.
  // 2 = reliably active (first-line spectrum) · 1 = variable / inducible / not-first-line / partial.
  // Omitted key = not active (intrinsic or usual acquired resistance). No cell asserts a susceptibility %.
  var COVERAGE = [
    // ── Natural / aminopenicillins ─────────────────────────────────────────
    { cls: "Natural penicillin", agent: "Penicillin G / V",
      cov: { strep:2, nmen:2, oralana:2, listeria:1 }, note: "Also T. pallidum, Actinomyces. Pneumococcal resistance regional." },
    { cls: "Aminopenicillin", agent: "Ampicillin / Amoxicillin",
      cov: { strep:2, efaecalis:2, listeria:2, ecoli:1, pmir:1, hflu:1, nmen:2 }, note: "Enterococcus faecalis drug of choice (± gentamicin synergy). Many E. coli now resistant." },
    { cls: "Anti-staphylococcal penicillin", agent: "Cloxacillin / Flucloxacillin / Nafcillin / Oxacillin",
      cov: { mssa:2, strep:2 }, note: "MSSA drug of choice. No MRSA, no Gram-negatives, no enterococci." },
    // ── β-lactam / β-lactamase-inhibitor ───────────────────────────────────
    { cls: "Aminopenicillin + BLI", agent: "Amoxicillin–clavulanate",
      cov: { mssa:2, strep:2, efaecalis:2, ecoli:1, kleb:2, pmir:2, hflu:2, morax:2, oralana:2, bfrag:2 } },
    { cls: "Aminopenicillin + BLI", agent: "Ampicillin–sulbactam",
      cov: { mssa:2, strep:2, efaecalis:2, ecoli:1, kleb:2, pmir:2, hflu:2, bfrag:2, oralana:2, acineto:1 }, note: "Sulbactam has intrinsic Acinetobacter activity." },
    { cls: "Antipseudomonal penicillin + BLI", agent: "Piperacillin–tazobactam",
      cov: { mssa:2, strep:2, efaecalis:2, ecoli:2, kleb:2, pmir:2, escappm:1, pseud:2, hflu:2, bfrag:2, oralana:2, esbl:1 }, note: "Avoid for ESBL bacteraemia (MERINO). AmpC induction risk." },
    { cls: "Cephalosporin + sulbactam", agent: "Cefoperazone–sulbactam",
      cov: { ecoli:2, kleb:2, pmir:2, escappm:1, pseud:1, acineto:2, bfrag:1, esbl:1 }, note: "Widely used in India for MDR GNB / Acinetobacter — confirm susceptibility." },
    { cls: "Cephalosporin + novel BLI", agent: "Ceftazidime–avibactam",
      cov: { ecoli:2, kleb:2, escappm:2, pseud:2, esbl:2, cre:2 }, note: "CRE: KPC & OXA-48 — NOT metallo-β-lactamase (NDM/VIM). Add aztreonam for MBL." },
    { cls: "Cephalosporin + novel BLI", agent: "Ceftolozane–tazobactam",
      cov: { ecoli:2, kleb:2, escappm:1, pseud:2, esbl:2 }, note: "Best-in-class for MDR Pseudomonas. Not reliable for CRE." },
    { cls: "Carbapenem + novel BLI", agent: "Meropenem–vaborbactam",
      cov: { ecoli:2, kleb:2, escappm:2, pseud:1, esbl:2, cre:2 }, note: "CRE: KPC. Not MBL / OXA-48." },
    { cls: "Carbapenem + novel BLI", agent: "Imipenem–relebactam",
      cov: { ecoli:2, kleb:2, escappm:2, pseud:2, esbl:2, cre:2 }, note: "CRE: KPC. Not MBL." },
    { cls: "Monobactam + novel BLI", agent: "Aztreonam–avibactam",
      cov: { ecoli:2, kleb:2, escappm:2, esbl:2, cre:2 }, note: "Covers metallo-β-lactamase (NDM) producers — key MBL-CRE option." },
    // ── Cephalosporins (by generation) ─────────────────────────────────────
    { cls: "1st-gen cephalosporin", agent: "Cefazolin / Cephalexin",
      cov: { mssa:2, strep:2, ecoli:1, kleb:1, pmir:1 }, note: "Surgical prophylaxis, MSSA, simple UTI/SSTI." },
    { cls: "2nd-gen cephalosporin", agent: "Cefuroxime",
      cov: { mssa:1, strep:2, ecoli:1, kleb:1, pmir:1, hflu:2, morax:2 } },
    { cls: "2nd-gen cephamycin", agent: "Cefoxitin / Cefotetan",
      cov: { mssa:1, strep:1, ecoli:1, kleb:1, pmir:1, bfrag:2, oralana:2 }, note: "Anaerobe activity; stable to some ESBL but not a clinical ESBL option." },
    { cls: "3rd-gen cephalosporin", agent: "Ceftriaxone / Cefotaxime",
      cov: { mssa:1, strep:2, ecoli:2, kleb:2, pmir:2, hflu:2, morax:2, ngon:2, nmen:2 }, note: "No Pseudomonas, no AmpC/ESBL, no enterococci/Listeria." },
    { cls: "3rd-gen cephalosporin (oral)", agent: "Cefixime / Cefpodoxime",
      cov: { strep:2, ecoli:1, kleb:1, pmir:1, hflu:2, morax:2, ngon:2 } },
    { cls: "3rd-gen antipseudomonal", agent: "Ceftazidime",
      cov: { ecoli:1, kleb:1, pmir:1, pseud:2, escappm:1 }, note: "Poor Gram-positive. AmpC-labile — unreliable vs ESCAPPM." },
    { cls: "4th-gen cephalosporin", agent: "Cefepime",
      cov: { mssa:2, strep:2, ecoli:2, kleb:2, pmir:2, escappm:2, pseud:2, hflu:2 }, note: "AmpC-stable (ESCAPPM). ESBL variable — inoculum effect." },
    { cls: "5th-gen (anti-MRSA) cephalosporin", agent: "Ceftaroline",
      cov: { mrsa:2, mssa:2, strep:2, ecoli:1, kleb:1, hflu:2 }, note: "MRSA-active cephalosporin. No Pseudomonas / AmpC / ESBL." },
    { cls: "Siderophore cephalosporin", agent: "Cefiderocol",
      cov: { ecoli:2, kleb:2, escappm:2, pseud:2, acineto:2, steno:2, esbl:2, cre:2 }, note: "Broadest GNB incl. MBL/NDM & carbapenem-resistant non-fermenters. Reserve." },
    // ── Carbapenems ────────────────────────────────────────────────────────
    { cls: "Carbapenem (limited)", agent: "Ertapenem",
      cov: { mssa:2, strep:2, ecoli:2, kleb:2, pmir:2, escappm:2, esbl:2, hflu:2, bfrag:2, oralana:2 }, note: "NO Pseudomonas, Acinetobacter, or enterococci." },
    { cls: "Antipseudomonal carbapenem", agent: "Imipenem / Meropenem / Doripenem",
      cov: { mssa:2, strep:2, efaecalis:1, ecoli:2, kleb:2, pmir:2, escappm:2, esbl:2, pseud:2, acineto:2, hflu:2, bfrag:2, oralana:2 }, note: "Broadest empiric β-lactam. Not CRE, not S. maltophilia, not MRSA/VRE." },
    // ── Monobactam ─────────────────────────────────────────────────────────
    { cls: "Monobactam", agent: "Aztreonam",
      cov: { ecoli:2, kleb:2, pmir:2, pseud:2, escappm:1 }, note: "Gram-negative only. Safe in penicillin anaphylaxis. Stable to MBLs." },
    // ── Fluoroquinolones ───────────────────────────────────────────────────
    { cls: "Fluoroquinolone", agent: "Ciprofloxacin",
      cov: { ecoli:2, kleb:2, pmir:2, escappm:2, pseud:2, acineto:1, hflu:2, morax:2, ngon:1, nmen:2, atyp:2, legio:2 }, note: "Most antipseudomonal FQ. Rising Enterobacterales & gonococcal resistance." },
    { cls: "Respiratory fluoroquinolone", agent: "Levofloxacin",
      cov: { mssa:1, strep:2, ecoli:2, kleb:2, pmir:2, escappm:2, pseud:2, acineto:1, hflu:2, morax:2, steno:2, atyp:2, legio:2 } },
    { cls: "Respiratory fluoroquinolone", agent: "Moxifloxacin",
      cov: { mssa:1, strep:2, ecoli:1, kleb:1, escappm:1, hflu:2, morax:2, bfrag:1, oralana:2, atyp:2, legio:2 }, note: "Adds anaerobe cover; NO Pseudomonas." },
    // ── Aminoglycosides ────────────────────────────────────────────────────
    { cls: "Aminoglycoside", agent: "Gentamicin / Tobramycin",
      cov: { ecoli:2, kleb:2, pmir:2, escappm:2, pseud:2, acineto:1, efaecalis:1 }, note: "Enterococcal/staph SYNERGY only (not monotherapy). Tobramycin best vs Pseudomonas." },
    { cls: "Aminoglycoside", agent: "Amikacin",
      cov: { ecoli:2, kleb:2, pmir:2, escappm:2, pseud:2, acineto:2 }, note: "Most stable to aminoglycoside-modifying enzymes." },
    { cls: "Aminoglycoside (next-gen)", agent: "Plazomicin",
      cov: { ecoli:2, kleb:2, escappm:2, esbl:2, cre:1 }, note: "Retains activity vs many ESBL/AmpC and some CRE." },
    // ── Glyco- / lipo-peptides ─────────────────────────────────────────────
    { cls: "Glycopeptide", agent: "Vancomycin",
      cov: { mrsa:2, mssa:2, strep:2, efaecalis:2, listeria:1 }, note: "Oral (non-absorbed) for C. difficile. VRE resistant." },
    { cls: "Glycopeptide", agent: "Teicoplanin",
      cov: { mrsa:2, mssa:2, strep:2, efaecalis:2 } },
    { cls: "Lipopeptide", agent: "Daptomycin",
      cov: { mrsa:2, mssa:2, strep:2, efaecalis:2, efaecium:2 }, note: "NOT for pneumonia — inactivated by lung surfactant. Covers VRE." },
    { cls: "Lipoglycopeptide (long-acting)", agent: "Dalbavancin / Oritavancin",
      cov: { mrsa:2, mssa:2, strep:2, efaecalis:1 }, note: "Single/weekly dosing for SSTI." },
    // ── Oxazolidinone ──────────────────────────────────────────────────────
    { cls: "Oxazolidinone", agent: "Linezolid / Tedizolid",
      cov: { mrsa:2, mssa:2, strep:2, efaecalis:2, efaecium:2 }, note: "Covers VRE & MRSA; good lung penetration. Bacteriostatic; marrow suppression on prolonged use." },
    // ── Lincosamide / macrolide / tetracyclines ────────────────────────────
    { cls: "Lincosamide", agent: "Clindamycin",
      cov: { mrsa:1, mssa:2, strep:2, oralana:2, bfrag:1 }, note: "CA-MRSA if D-test negative. Rising B. fragilis resistance. Toxin suppression in TSS/nec-fasc." },
    { cls: "Macrolide", agent: "Azithromycin / Clarithromycin",
      cov: { mssa:1, strep:1, hflu:1, morax:2, ngon:1, atyp:2, legio:2 }, note: "Atypical cover. High pneumococcal macrolide resistance in India." },
    { cls: "Tetracycline", agent: "Doxycycline / Minocycline",
      cov: { mrsa:2, mssa:2, strep:1, ecoli:1, hflu:2, morax:2, ngon:1, atyp:2, legio:1, steno:2, acineto:1 }, note: "Minocycline adds Stenotrophomonas & Acinetobacter. Also rickettsia, Brucella, Leptospira." },
    { cls: "Glycylcycline", agent: "Tigecycline",
      cov: { mrsa:2, mssa:2, strep:2, efaecalis:2, efaecium:2, ecoli:2, kleb:2, escappm:2, esbl:2, cre:1, acineto:2, bfrag:2, oralana:2, steno:1 }, note: "Very broad EXCEPT Pseudomonas & Proteus. Low serum levels — avoid bloodstream infection." },
    // ── Polymyxins ─────────────────────────────────────────────────────────
    { cls: "Polymyxin", agent: "Colistin / Polymyxin B",
      cov: { ecoli:2, kleb:2, pseud:2, acineto:2, esbl:2, cre:2 }, note: "Last-resort GNB. Intrinsic resistance: Proteus, Serratia, Providencia, Morganella, Burkholderia. No GPC/anaerobes. Nephrotoxic." },
    // ── Folate / urinary / anaerobe / misc ─────────────────────────────────
    { cls: "Folate antagonist", agent: "Co-trimoxazole (TMP–SMX)",
      cov: { mrsa:2, mssa:2, strep:1, ecoli:1, kleb:1, pmir:1, escappm:1, hflu:2, steno:2, listeria:2 }, note: "First-line for Stenotrophomonas, Nocardia, PCP. No Pseudomonas / anaerobes / enterococci." },
    { cls: "Nitrofuran (urinary)", agent: "Nitrofurantoin",
      cov: { ecoli:2, efaecalis:2, kleb:1 }, note: "Uncomplicated cystitis only — no tissue levels. Not Proteus/Pseudomonas/Serratia. Avoid CrCl <30." },
    { cls: "Phosphonic acid", agent: "Fosfomycin",
      cov: { ecoli:2, efaecalis:2, kleb:1, esbl:2, pseud:1 }, note: "PO (trometamol) for MDR cystitis incl. ESBL; IV form broader." },
    { cls: "Nitroimidazole", agent: "Metronidazole",
      cov: { bfrag:2, oralana:2 }, note: "Anaerobes only (+ C. difficile, amoebae, Giardia). No aerobes; no Actinomyces/Propionibacterium." },
    { cls: "Amphenicol", agent: "Chloramphenicol",
      cov: { strep:2, nmen:2, hflu:2, bfrag:2, oralana:2, atyp:1 }, note: "Reserve — marrow toxicity. Broad but rarely used." },
    { cls: "Rifamycin (adjunct)", agent: "Rifampicin",
      cov: { mrsa:1, mssa:1, strep:1 }, note: "NEVER monotherapy (rapid resistance). Biofilm/prosthetic adjunct; meningococcal prophylaxis." },
    { cls: "Macrocyclic (C. difficile)", agent: "Fidaxomicin",
      cov: {}, note: "C. difficile only (narrow-spectrum, gut-selective)." }
  ];

  /* ─────────────────────────  RESISTANCE DATA  ─────────────────────────
     Uses the app's existing, sourced antibiogram (window.ASP_ABG) — the same
     ICMR AMRSN 2024 national + GIMSR hospital dataset shown in the references
     panel. Values are % SUSCEPTIBLE (higher = better); some cells are qualitative
     only. No numbers are invented here — this view just reads that data. */
  // The ACTIVE profile's antibiogram (region composite / individual study / hospital / ICMR
  // national), driven by the global HOSPITAL profile selector. Falls back to ICMR national.
  function abgData() {
    try { if (window.HOSPITAL && window.HOSPITAL.getAntibiogram) { var a = window.HOSPITAL.getAntibiogram(); if (a && a.org) return a; } } catch (e) {}
    return (typeof window !== "undefined" && window.ASP_ABG) ? (window.ASP_ABG.national || window.ASP_ABG.hospital || null) : null;
  }

  // Pretty labels for the terse drug keys used in ASP_ABG.
  var DRUG_LABEL = {
    piptazo: "Piperacillin-tazobactam", cefotaxime: "Cefotaxime", ceftazidime: "Ceftazidime",
    ceftriaxone: "Ceftriaxone", cefepime: "Cefepime", cefuroxime: "Cefuroxime", cefoperazone: "Cefoperazone",
    cefixime: "Cefixime", cefazolin: "Cefazolin", ciprofloxacin: "Ciprofloxacin", levofloxacin: "Levofloxacin",
    norfloxacin: "Norfloxacin", imipenem: "Imipenem", meropenem: "Meropenem", ertapenem: "Ertapenem",
    doripenem: "Doripenem", amikacin: "Amikacin", gentamicin: "Gentamicin", colistin: "Colistin",
    nitrofurantoin: "Nitrofurantoin", fosfomycin: "Fosfomycin", minocycline: "Minocycline",
    cotrimoxazole: "Co-trimoxazole", doxycycline: "Doxycycline", cloxacillin: "Cloxacillin",
    clindamycin: "Clindamycin", vancomycin: "Vancomycin", teicoplanin: "Teicoplanin", linezolid: "Linezolid",
    daptomycin: "Daptomycin", amoxicillin: "Amoxicillin", amoxiclav: "Amoxicillin-clavulanate",
    ampicillin: "Ampicillin", azithromycin: "Azithromycin"
  };
  function drugLabel(k) { return DRUG_LABEL[k] || (k.charAt(0).toUpperCase() + k.slice(1)); }

  /* ───────────────────────  ORGANISM MICROBIOLOGY DATA  ───────────────────────
     Clinical microbiology & antimicrobial resistance reference for ID specialists,
     microbiologists and ward clinicians. */
  var ORGANISM_DATA = {
    mrsa: {
      name: "Methicillin-Resistant Staphylococcus aureus (MRSA)",
      group: "Gram-Positive / Staphylococci",
      groupClass: "gpc",
      gram: "Gram-positive cocci in clusters",
      microbiology: "Catalase-positive, coagulase-positive, golden-yellow colonies on blood agar, mannitol-fermenting on MSA. Key virulence factors: protein A, Panton-Valentine leukocidin (PVL; severe necrotizing pneumonia / SSTI), enterotoxins, and toxic shock syndrome toxin-1 (TSST-1).",
      mechanism: "mecA or mecC gene on SCCmec element encodes altered penicillin-binding protein PBP2a, conferring low binding affinity to virtually all standard β-lactams.",
      intrinsic: "All standard penicillins, cephalosporins (1st–4th gen), carbapenems, and monobactams. (Only 5th-gen cephalosporins like ceftaroline bind PBP2a).",
      regimens: [
        { indication: "Bacteraemia / Endocarditis / Sepsis", drug: "Vancomycin (target AUC/MIC 400–600 or trough 15–20 µg/mL) OR Daptomycin (8–10 mg/kg/day)", alt: "Ceftaroline, Teicoplanin" },
        { indication: "MRSA Pneumonia (HAP/VAP)", drug: "Linezolid (600 mg IV/PO q12h) OR Vancomycin", alt: "Daptomycin is INACTIVATED by lung surfactant — never use for pneumonia" },
        { indication: "Mild / Moderate SSTI (Oral)", drug: "Co-trimoxazole (TMP-SMX), Doxycycline, or Clindamycin (if D-test negative)", alt: "Linezolid" }
      ],
      pearls: "Perform D-zone test if erythromycin-resistant and clindamycin-susceptible (screens for inducible MLSB resistance via erm genes). If vancomycin MIC is ≥2 µg/mL, switch to Daptomycin or Ceftaroline due to vancomycin failure risk. In S. aureus bacteraemia, repeat blood cultures every 48–72h until negative and perform echocardiography to rule out infective endocarditis."
    },
    mssa: {
      name: "Methicillin-Susceptible Staphylococcus aureus (MSSA)",
      group: "Gram-Positive / Staphylococci",
      groupClass: "gpc",
      gram: "Gram-positive cocci in clusters",
      microbiology: "Catalase-positive, coagulase-positive. Staphylococcal β-lactamase (penicillinase, blaZ) positive in >90% of isolates, inactivating natural penicillins.",
      mechanism: "blaZ β-lactamase hydrolyzes natural penicillins and aminopenicillins without an inhibitor.",
      intrinsic: "Penicillin G, Penicillin V, Ampicillin, and Amoxicillin (due to blaZ).",
      regimens: [
        { indication: "Severe / Bacteraemia / Endocarditis", drug: "Cloxacillin (2g IV q4h) OR Flucloxacillin / Nafcillin / Oxacillin", alt: "Cefazolin (2g IV q8h; preferred for non-severe penicillin allergy)" },
        { indication: "Oral Step-Down / Mild SSTI", drug: "Cephalexin, Amoxicillin-clavulanate, or Cloxacillin PO", alt: "Clindamycin" }
      ],
      pearls: "Anti-staphylococcal β-lactams (Cloxacillin / Cefazolin) demonstrate significantly lower 30-day mortality and relapse rates compared to Vancomycin for MSSA bacteraemia. De-escalate promptly from empiric MRSA coverage once MSSA is confirmed. Beware cefazolin inoculum effect in high-titer endocarditis with type A blaZ."
    },
    strep: {
      name: "Streptococci (S. pneumoniae, GAS, GBS, Viridans)",
      group: "Gram-Positive / Streptococci",
      groupClass: "gpc",
      gram: "Gram-positive cocci in pairs/chains",
      microbiology: "Catalase-negative. S. pneumoniae: lancet-shaped diplococci, α-hemolytic, optochin-sensitive, bile-soluble. S. pyogenes (GAS): β-hemolytic, PYR-positive, bacitracin-sensitive. S. agalactiae (GBS): CAMP-positive, hippurate-positive. Viridans: α-hemolytic, optochin-resistant.",
      mechanism: "S. pneumoniae resistance mediated by mosaic PBP genes (PBP1a, PBP2b, PBP2x). S. pyogenes remains universally susceptible to Penicillin.",
      intrinsic: "Aminoglycosides (ineffective as monotherapy; requires cell-wall active agent synergy).",
      regimens: [
        { indication: "CAP / Pneumococcal Pneumonia", drug: "Amoxicillin / Penicillin G (susceptible) OR Ceftriaxone", alt: "Levofloxacin / Moxifloxacin" },
        { indication: "Invasive GAS / Strep Toxic Shock", drug: "Penicillin G + Clindamycin (inhibits ribosome to shut down SpeA/B/C exotoxin synthesis)", alt: "Ceftriaxone + Clindamycin" },
        { indication: "Pneumococcal Meningitis", drug: "Ceftriaxone (2g IV q12h) + Vancomycin + Dexamethasone (until MIC confirmed)", alt: "Meropenem" }
      ],
      pearls: "Clindamycin suppresses exotoxin production (SpeA/B/C) and M-protein synthesis in invasive S. pyogenes (Eagle effect). Macrolide resistance in Indian S. pneumoniae isolates exceeds 50% — avoid empiric macrolide monotherapy for pneumococcal pneumonia."
    },
    efaecalis: {
      name: "Enterococcus faecalis",
      group: "Gram-Positive / Enterococci",
      groupClass: "gpc",
      gram: "Gram-positive cocci in pairs/short chains",
      microbiology: "Catalase-negative, bile-esculin positive, grows in 6.5% NaCl, PYR-positive, Lancefield group D antigen.",
      mechanism: "Intrinsic PBP4 with low affinity for β-lactams. Rare plasmid-mediated β-lactamase or vanA/vanB resistance.",
      intrinsic: "All cephalosporins, clindamycin, co-trimoxazole (in vivo), and low-level aminoglycosides.",
      regimens: [
        { indication: "Bacteraemia / Endocarditis", drug: "Ampicillin (2g IV q4h) + Ceftriaxone (2g IV q12h) OR Ampicillin + Gentamicin", alt: "Vancomycin (if penicillin-allergic)" },
        { indication: "UTI / Cystitis", drug: "Amoxicillin PO OR Nitrofurantoin PO", alt: "Fosfomycin" }
      ],
      pearls: "Never use cephalosporins or ertapenem against Enterococcus (intrinsic non-susceptibility). Dual β-lactam therapy (Ampicillin + Ceftriaxone) saturates PBP4 and PBP2/3 to produce synergistic bactericidal killing with equivalent cure to aminoglycosides and zero nephrotoxicity."
    },
    efaecium: {
      name: "Enterococcus faecium / VRE",
      group: "Gram-Positive / Enterococci",
      groupClass: "gpc",
      gram: "Gram-positive cocci in pairs/chains",
      microbiology: "More intrinsically resistant and resilient than E. faecalis. Bile-esculin positive, PYR-positive.",
      mechanism: "vanA (replaces D-Ala-D-Ala with D-Ala-D-Lac; high resistance to Vancomycin & Teicoplanin) or vanB (Vancomycin-resistant, Teicoplanin-sensitive). Over 85% carry altered PBP5 conferring ampicillin resistance.",
      intrinsic: "Cephalosporins, clindamycin, co-trimoxazole, and low-level aminoglycosides.",
      regimens: [
        { indication: "VRE Bacteraemia / Severe Sepsis", drug: "Daptomycin (high-dose 10–12 mg/kg/day) OR Linezolid (600 mg IV/PO q12h)", alt: "Tedizolid, Oritavancin" },
        { indication: "Intra-abdominal / SSTI (Non-bacteraemic)", drug: "Tigecycline (100 mg load, then 50 mg q12h)", alt: "Linezolid" },
        { indication: "VRE Cystitis", drug: "Nitrofurantoin OR Fosfomycin", alt: "Linezolid" }
      ],
      pearls: "Tigecycline has very low serum concentrations and should NOT be used for VRE bloodstream infections or endocarditis. E. faecium is almost always Ampicillin-resistant, unlike E. faecalis. Strict contact precautions are required to prevent hospital transmission."
    },
    listeria: {
      name: "Listeria monocytogenes",
      group: "Gram-Positive / Bacilli",
      groupClass: "gpc",
      gram: "Gram-positive non-sporeforming bacillus",
      microbiology: "Tumbling motility at 25°C, catalase-positive, narrow zone of β-hemolysis, umbrella motility in motility agar, cold enrichment capable.",
      mechanism: "Facultative intracellular pathogen surviving within macrophages via listeriolysin O and ActA.",
      intrinsic: "All cephalosporins (1st–5th gen)! Carbapenems have variable bactericidal activity.",
      regimens: [
        { indication: "Meningitis / Rhombencephalitis / Sepsis", drug: "Ampicillin (2g IV q4h) ± Gentamicin (synergy)", alt: "Co-trimoxazole (TMP-SMX 15 mg/kg/day IV divided q6–8h if penicillin-allergic)" },
        { indication: "Maternal / Neonatal Listeriosis", drug: "Ampicillin (high dose)", alt: "Co-trimoxazole" }
      ],
      pearls: "Cephalosporins (including Ceftriaxone) have ZERO activity against Listeria. Always add Ampicillin to empiric bacterial meningitis regimens in patients aged ≥50, pregnant women, neonates, and immunocompromised hosts."
    },
    ecoli: {
      name: "Escherichia coli",
      group: "Enterobacterales",
      groupClass: "entero",
      gram: "Gram-negative bacillus",
      microbiology: "Lactose fermenter (bright pink colonies on MacConkey agar with bile salt precipitation), indole-positive, oxidase-negative, methyl red-positive (IMViC: ++--).",
      mechanism: "Commonly acquires plasmid-mediated TEM, SHV, or CTX-M (ESBL); AmpC; or NDM/OXA-48 carbapenemases. Fluoroquinolone resistance via gyrA/parC mutations.",
      intrinsic: "None to standard broad-spectrum agents. High acquired resistance in India to ampicillin (>75%) and fluoroquinolones (>60%).",
      regimens: [
        { indication: "Uncomplicated Cystitis", drug: "Nitrofurantoin (100 mg BD × 5d) OR Fosfomycin (3g single dose)", alt: "Pivmecillinam, Amoxicillin-clavulanate" },
        { indication: "Pyelonephritis / Sepsis (Non-ESBL)", drug: "Ceftriaxone (1–2g IV OD) OR Piperacillin-tazobactam", alt: "Amikacin" },
        { indication: "ESBL E. coli Sepsis / Bacteraemia", drug: "Ertapenem (1g IV OD) OR Meropenem (1g IV q8h)", alt: "Amikacin, Fosfomycin" }
      ],
      pearls: "Leading cause of community-acquired UTI and Gram-negative bacteraemia. The MERINO trial demonstrated that Piperacillin-tazobactam is inferior to Meropenem for ESBL E. coli bacteraemia."
    },
    kleb: {
      name: "Klebsiella pneumoniae / oxytoca",
      group: "Enterobacterales",
      groupClass: "entero",
      gram: "Gram-negative bacillus",
      microbiology: "Non-motile, prominent polysaccharide capsule, heavy mucoid lactose-fermenting colonies on MacConkey agar. Indole-negative (K. pneumoniae), indole-positive (K. oxytoca). Hypervirulent strains demonstrate string test ≥5mm.",
      mechanism: "Chromosomal SHV-1 penicillinase. Readily acquires CTX-M ESBLs and carbapenemases (NDM, OXA-48, KPC).",
      intrinsic: "Ampicillin, Amoxicillin, and Carbenicillin (due to chromosomal SHV-1).",
      regimens: [
        { indication: "Susceptible Sepsis / Pneumonia", drug: "Ceftriaxone OR Piperacillin-tazobactam", alt: "Amikacin, Ciprofloxacin" },
        { indication: "ESBL Sepsis", drug: "Meropenem OR Ertapenem", alt: "Amikacin" },
        { indication: "Carbapenem-Resistant (CRE)", drug: "Ceftazidime-avibactam + Aztreonam (if NDM/MBL) OR Cefiderocol", alt: "Colistin, Polymyxin B, Plazomicin" }
      ],
      pearls: "Hypervirulent K. pneumoniae (hvKp; serotypes K1/K2) causes community-acquired invasive liver abscesses, endophthalmitis, and CNS metastatic seeding in non-compromised hosts. Prompt ophthalmology consult is required if bacteremic with visual symptoms."
    },
    pmir: {
      name: "Proteus mirabilis (& indole-positive Proteus)",
      group: "Enterobacterales",
      groupClass: "entero",
      gram: "Gram-negative bacillus",
      microbiology: "Swarming motility on non-inhibitory media (concentric rings on blood agar), strong urease producer (splits urea into ammonia and CO2, raising urinary pH >7.5 and forming magnesium ammonium phosphate struvite stones).",
      mechanism: "P. mirabilis is indole-negative; P. vulgaris is indole-positive and carries chromosomal AmpC.",
      intrinsic: "COLISTIN / POLYMYXIN B, TIGECYCLINE, and NITROFURANTOIN! Inherently non-susceptible.",
      regimens: [
        { indication: "UTI / Pyelonephritis / Sepsis", drug: "Ceftriaxone (1–2g IV OD) OR Ciprofloxacin (if sensitive)", alt: "Piperacillin-tazobactam, Meropenem" },
        { indication: "ESBL / AmpC Proteus", drug: "Carbapenem (Meropenem / Ertapenem)", alt: "Piperacillin-tazobactam (if non-AmpC)" }
      ],
      pearls: "CRITICAL PRESCRIBING PITFALL: Colistin and Tigecycline are INTRINSICALLY INACTIVE against Proteus, Morganella, and Providencia. Using polymyxin or tigecycline for suspected Proteus sepsis leads to rapid fatal breakthrough."
    },
    escappm: {
      name: "ESCAPPM Group (Inducible AmpC β-lactamase)",
      group: "Enterobacterales / AmpC",
      groupClass: "entero",
      gram: "Gram-negative bacilli",
      microbiology: "Enterobacter cloacae, Serratia marcescens, Citrobacter freundii, Aeromonas, Proteus vulgaris, Providencia, Morganella morganii.",
      mechanism: "Carries inducible chromosomal ampC gene. Exposure to 3rd-generation cephalosporins (ceftriaxone, ceftazidime) induces AmpC or selects for stably derepressed AmpC hyperproducers, causing clinical failure despite in-vitro susceptibility.",
      intrinsic: "Aminopenicillins, Amoxicillin-clavulanate, 1st/2nd generation cephalosporins.",
      regimens: [
        { indication: "Severe Sepsis / Bacteraemia", drug: "Cefepime (2g IV q8h extended infusion) OR Meropenem", alt: "Ertapenem" },
        { indication: "Step-Down / UTI", drug: "Fluoroquinolones (Ciprofloxacin / Levofloxacin) OR Co-trimoxazole (if susceptible)", alt: "Amikacin" }
      ],
      pearls: "AVOID 3rd-generation cephalosporins (ceftriaxone, ceftazidime) even if lab AST reports 'SUSCEPTIBLE' for invasive infections (high risk of on-treatment emergence of AmpC derepressed resistance). Cefepime is structurally stable against AmpC hydrolysis."
    },
    esbl: {
      name: "Extended-Spectrum Beta-Lactamases (ESBL)",
      group: "Resistance Phenotype / Enterobacterales",
      groupClass: "entero",
      gram: "Gram-negative bacilli (mainly E. coli, Klebsiella)",
      microbiology: "Plasmid-mediated enzymes (CTX-M, SHV, TEM variants) that hydrolyze penicillins, cephalosporins (1st–4th gen), and aztreonam. Inhibited in vitro by clavulanic acid and avibactam.",
      mechanism: "Enzymatic hydrolysis of oxyimino-β-lactams. Plasmids frequently co-transfer resistance genes for fluoroquinolones, aminoglycosides, and co-trimoxazole.",
      intrinsic: "All penicillins and cephalosporins without effective inhibitor.",
      regimens: [
        { indication: "Severe Sepsis / Bacteraemia", drug: "Meropenem (1g IV q8h) OR Ertapenem (1g IV OD)", alt: "Imipenem" },
        { indication: "Uncomplicated Lower UTI", drug: "Nitrofurantoin OR Fosfomycin OR Amikacin", alt: "Co-trimoxazole (if MIC tested susceptible)" }
      ],
      pearls: "The landmark MERINO trial proved that Piperacillin-tazobactam has higher 30-day mortality than Meropenem in ESBL bacteraemia. Carbapenems remain the gold standard for invasive ESBL infections."
    },
    cre: {
      name: "Carbapenem-Resistant Enterobacterales (CRE)",
      group: "Resistance Phenotype / Enterobacterales",
      groupClass: "entero",
      gram: "Gram-negative bacilli",
      microbiology: "Enterobacterales resistant to at least one carbapenem (meropenem, imipenem, ertapenem) or producing a carbapenemase. Class B Metallo-β-lactamases (NDM-1, VIM, IMP) are highly prevalent in India.",
      mechanism: "Ambler Class A (KPC), Class B (NDM, VIM, IMP; zinc-dependent metallo-β-lactamases), or Class D (OXA-48-like).",
      intrinsic: "Almost all β-lactams and carbapenems.",
      regimens: [
        { indication: "Metallo-β-lactamase (NDM / MBL) — Predominant in India", drug: "Ceftazidime-avibactam + Aztreonam (dual agent: avibactam protects aztreonam from ESBL/AmpC while aztreonam bypasses NDM) OR Cefiderocol", alt: "Polymyxin / Colistin + Meropenem combination" },
        { indication: "KPC / OXA-48 Producers", drug: "Ceftazidime-avibactam (2.5g IV q8h extended infusion) OR Meropenem-vaborbactam", alt: "Cefiderocol" },
        { indication: "Complicated UTI (CRE)", drug: "Plazomicin OR Ceftazidime-avibactam", alt: "Fosfomycin, Colistin" }
      ],
      pearls: "Determine the carbapenemase class (Xpert Carba-R or phenotypic tests like mCIM/eCIM). Ceftazidime-avibactam ALONE is INACTIVE against NDM; Aztreonam MUST be combined with it for NDM/VIM MBLs."
    },
    pseud: {
      name: "Pseudomonas aeruginosa",
      group: "Non-Fermenters",
      groupClass: "nonferm",
      gram: "Gram-negative bacillus",
      microbiology: "Strict aerobe, motile (polar flagella), non-lactose fermenter, oxidase-positive, produces pyocyanin (blue-green pigment) and pyoverdine (fluorescent), characteristic grape-like sweet odor.",
      mechanism: "High baseline resistance via low outer-membrane permeability (OprF), inducible AmpC (blaPDC), and constitutive MexAB-OprM efflux pumps. DTR strains acquire metallo-β-lactamases or porin loss (OprD).",
      intrinsic: "Ampicillin, Amoxicillin-clavulanate, Ceftriaxone, Cefotaxime, Ertapenem, Co-trimoxazole, Tetracyclines, Tigecycline.",
      regimens: [
        { indication: "Empiric / Susceptible Sepsis / HAP / VAP", drug: "Piperacillin-tazobactam (4.5g IV q6h extended infusion) OR Cefepime (2g IV q8h) OR Meropenem (1g IV q8h)", alt: "Ceftazidime, Ciprofloxacin" },
        { indication: "Difficult-to-Treat Resistance (DTR-P. aeruginosa)", drug: "Ceftolozane-tazobactam (3g IV q8h) — preferred first-line agent for DTR strains", alt: "Ceftazidime-avibactam, Cefiderocol, Imipenem-relebactam" },
        { indication: "Severe Septic Shock / Neutropenic Sepsis", drug: "Combine β-lactam + Tobramycin/Amikacin OR Ciprofloxacin until susceptibilities return", alt: "Colistin (last line)" }
      ],
      pearls: "Ertapenem has ZERO activity against Pseudomonas. Extended infusions (over 3–4 hours) of antipseudomonal β-lactams significantly optimize time above MIC (fT > MIC) and reduce mortality in ICU patients."
    },
    acineto: {
      name: "Acinetobacter baumannii (CRAB)",
      group: "Non-Fermenters",
      groupClass: "nonferm",
      gram: "Gram-negative coccobacillus",
      microbiology: "Pleomorphic, non-motile, strictly aerobic, oxidase-negative, non-lactose fermenting. Survives desiccation and persists on dry hospital surfaces for months.",
      mechanism: "Carbapenem-resistant A. baumannii (CRAB) produces OXA-type carbapenemases (OXA-23, OXA-24, OXA-58), upregulated AdeABC efflux, and modified PBP/porins.",
      intrinsic: "Ampicillin, 1st/2nd gen cephalosporins, aztreonam, ertapenem.",
      regimens: [
        { indication: "Carbapenem-Resistant (CRAB) Sepsis / VAP", drug: "High-dose Ampicillin-sulbactam (sulbactam component 6g–9g/day IV divided q8h — sulbactam has direct bactericidal affinity for PBP1a/PBP3 of Acinetobacter)", alt: "Cefoperazone-sulbactam (3g IV BD)" },
        { indication: "Combination Regimens for Severe CRAB", drug: "Sulbactam backbone + Polymyxin/Colistin OR Minocycline OR Tigecycline", alt: "Cefiderocol" }
      ],
      pearls: "Sulbactam is NOT just a β-lactamase inhibitor for Acinetobacter; it has direct bactericidal activity. Standard ampicillin-sulbactam dosing is insufficient — IDSA 2024 recommends targeting 6g–9g of sulbactam daily in divided doses."
    },
    steno: {
      name: "Stenotrophomonas maltophilia",
      group: "Non-Fermenters",
      groupClass: "nonferm",
      gram: "Gram-negative bacillus",
      microbiology: "Opportunistic Gram-negative non-fermenter, motile, lavendar-green colonies on blood agar with ammonia odor. Predilection for ICU patients with prolonged broad-spectrum carbapenem exposure, mechanical ventilation, or central lines.",
      mechanism: "Produces two chromosomal β-lactamases: L1 (metallo-β-lactamase conferring resistance to ALL carbapenems) and L2 (serine cephalosporinase conferring resistance to cephalosporins/penicillins).",
      intrinsic: "ALL CARBAPENEMS (Meropenem, Imipenem, Ertapenem) and most aminoglycosides.",
      regimens: [
        { indication: "Drug of Choice", drug: "Co-trimoxazole (TMP-SMX 15 mg/kg/day IV divided q6–8h)", alt: "First-line preferred in all international guidelines" },
        { indication: "Alternative / TMP-SMX Intolerance", drug: "Minocycline (200 mg loading, then 100 mg q12h IV/PO) OR Levofloxacin (750 mg OD)", alt: "Cefiderocol, Ceftazidime-avibactam + Aztreonam" }
      ],
      pearls: "CARBAPENEMS ARE COMPLETELY INEFFECTIVE due to chromosomal L1 metallo-β-lactamase. Breakthrough infection while on meropenem strongly suggests Stenotrophomonas or Enterococcus. Discontinue carbapenem and initiate TMP-SMX."
    },
    hflu: {
      name: "Haemophilus influenzae",
      group: "Fastidious / Respiratory",
      groupClass: "fast",
      gram: "Gram-negative pleomorphic coccobacillus",
      microbiology: "Fastidious, requires Factor X (hemin) and Factor V (NAD) for growth (chocolate agar / satellite phenomenon around S. aureus streak on blood agar). Encapsulated type b (Hib) causes invasive meningitis/epiglottitis; non-typeable causes CAP, COPD exacerbations, and otitis.",
      mechanism: "TEM-1 or ROB-1 β-lactamase production in 30–40% of strains. BLNAR strains carry mutated PBP3.",
      intrinsic: "Macrolides have borderline/weak activity in vitro.",
      regimens: [
        { indication: "Severe / Meningitis / Invasive", drug: "Ceftriaxone (2g IV q12h) OR Cefotaxime", alt: "Ampicillin (only if documented β-lactamase negative)" },
        { indication: "CAP / COPD Exacerbation", drug: "Amoxicillin-clavulanate (625 mg–1g PO TDS) OR Cefuroxime", alt: "Azithromycin, Levofloxacin" }
      ],
      pearls: "Hib vaccine has dramatically reduced invasive childhood disease. In adult respiratory disease, non-typeable H. influenzae predominates. β-lactamase testing (nitrocefin disk) provides rapid 5-minute guidance on ampicillin susceptibility."
    },
    morax: {
      name: "Moraxella catarrhalis",
      group: "Fastidious / Respiratory",
      groupClass: "fast",
      gram: "Gram-negative diplococcus",
      microbiology: "Kidney bean-shaped Gram-negative diplococci, 'hockey puck' sign on agar (colonies can be pushed intact across the plate), butyrate esterase-positive, DNase-positive.",
      mechanism: ">95% produce BRO-1 or BRO-2 β-lactamase, conferring complete resistance to ampicillin and amoxicillin.",
      intrinsic: "Unprotected aminopenicillins (Ampicillin, Amoxicillin), Trimethoprim alone.",
      regimens: [
        { indication: "Respiratory Infection / COPD Exacerbation", drug: "Amoxicillin-clavulanate OR 2nd/3rd-gen Cephalosporin (Cefuroxime, Cefixime)", alt: "Azithromycin, Doxycycline, Respiratory Fluoroquinolones" }
      ],
      pearls: "Do not use plain ampicillin or amoxicillin: >95% produce BRO β-lactamases. Excellent response to β-lactamase inhibitor combinations, macrolides, and oral cephalosporins."
    },
    ngon: {
      name: "Neisseria gonorrhoeae",
      group: "Fastidious / Genitourinary",
      groupClass: "fast",
      gram: "Gram-negative intracellular diplococci",
      microbiology: "Gram-negative diplococci with adjacent flat sides (kidney bean), intracellular within polymorphonuclear neutrophils (PMNs) on urethral/cervical smear. Superoxol-positive, glucose-fermenting, maltose-negative.",
      mechanism: "High-level chromosomal penA, mtrR efflux, and gyrA mutations conferring multi-drug resistance worldwide.",
      intrinsic: "High acquired resistance to penicillins, tetracyclines, and fluoroquinolones.",
      regimens: [
        { indication: "Uncomplicated Urogenital / Anorectal / Pharyngeal", drug: "Ceftriaxone (500 mg–1g IM single dose) + Azithromycin 1g PO (or Doxycycline 100 mg BD × 7d if chlamydia not excluded)", alt: "Gentamicin 240 mg IM + Azithromycin 2g PO (if severe cephalosporin allergy)" },
        { indication: "Disseminated Gonococcal Infection (DGI)", drug: "Ceftriaxone 1g IV daily × 7 days", alt: "Cefotaxime" }
      ],
      pearls: "Ciprofloxacin and Penicillin should NOT be used for empiric gonorrhea due to massive worldwide resistance. Always treat for co-infecting Chlamydia trachomatis unless ruled out by NAAT."
    },
    nmen: {
      name: "Neisseria meningitidis",
      group: "Fastidious / CNS",
      groupClass: "fast",
      gram: "Gram-negative diplococci",
      microbiology: "Gram-negative diplococci, encapsulated (polysaccharide serogroups A, B, C, W, Y, X), ferments both glucose and maltose.",
      mechanism: "Rare intermediate penicillin resistance via altered PBP2.",
      intrinsic: "None to standard meningitis agents.",
      regimens: [
        { indication: "Meningitis / Meningococcemia", drug: "Ceftriaxone (2g IV q12h) OR Cefotaxime (2g IV q4h)", alt: "Penicillin G (high-dose if MIC confirmed susceptible)" },
        { indication: "Post-Exposure Chemoprophylaxis", drug: "Rifampicin (600 mg PO BD × 2d) OR Ciprofloxacin (500 mg PO single dose) OR Ceftriaxone (250 mg IM single dose)", alt: "Treat close contacts within 24h" }
      ],
      pearls: "Droplet precautions mandatory until 24 hours of effective antimicrobial therapy. Fulminant meningococcemia with bilateral adrenal hemorrhage (Waterhouse-Friderichsen syndrome) presents with petechial/purpuric rash and rapid septic shock."
    },
    bfrag: {
      name: "Bacteroides fragilis Group",
      group: "Anaerobes",
      groupClass: "ana",
      gram: "Gram-negative obligate anaerobic bacillus",
      microbiology: "Pleomorphic Gram-negative rod, aerotolerant anaerobe, bile-resistant (grows on 20% bile / BBE agar with black colonies), prominent polysaccharide capsule inducing intra-abdominal abscesses.",
      mechanism: "Produces cephalosporinases and metallo-β-lactamase (cfiA in 2–5%). High clindamycin (>35%) and moxifloxacin (>40%) resistance.",
      intrinsic: "Aminoglycosides (require oxygen-dependent uptake), 1st–4th gen cephalosporins without inhibitor.",
      regimens: [
        { indication: "Intra-Abdominal / Pelvic Sepsis", drug: "Metronidazole (500 mg IV/PO q8h) OR Piperacillin-tazobactam OR Meropenem", alt: "Amoxicillin-clavulanate" }
      ],
      pearls: "Metronidazole remains the most reliably active anti-anaerobic agent (<1% resistance worldwide). Clindamycin and fluoroquinolones can no longer be trusted for empiric B. fragilis coverage due to extensive resistance."
    },
    oralana: {
      name: "Oral Anaerobes (Peptostreptococcus, Prevotella, Fusobacterium)",
      group: "Anaerobes / Oral",
      groupClass: "ana",
      gram: "Mixed Gram-positive & Gram-negative anaerobes",
      microbiology: "Fusobacterium necrophorum, F. nucleatum, Prevotella melaninogenica, Peptostreptococcus. Fusobacterium: long, slender spindle-shaped rods with tapered ends. Prevotella: black pigment on blood agar under UV fluorescence.",
      mechanism: "Prevotella frequently produces β-lactamases; Fusobacterium remains largely β-lactam susceptible.",
      intrinsic: "Aminoglycosides (lack of oxidative transport).",
      regimens: [
        { indication: "Aspiration Pneumonia / Lung Abscess", drug: "Ampicillin-sulbactam (1.5–3g IV q6h) OR Amoxicillin-clavulanate", alt: "Clindamycin, Moxifloxacin" },
        { indication: "Lemierre Syndrome (F. necrophorum septic thrombophlebitis)", drug: "Ampicillin-sulbactam OR Ceftriaxone + Metronidazole", alt: "Piperacillin-tazobactam" }
      ],
      pearls: "Lemierre syndrome features internal jugular vein septic thrombophlebitis and septic pulmonary emboli following acute pharyngitis/tonsillitis in young healthy adults. Prolonged IV therapy (3–6 weeks) required."
    },
    atyp: {
      name: "Atypicals (Mycoplasma pneumoniae, Chlamydia pneumoniae / psittaci)",
      group: "Atypicals",
      groupClass: "aty",
      gram: "No Gram stain / Intracellular",
      microbiology: "Mycoplasma pneumoniae: lacks peptidoglycan cell wall entirely, bounded only by a sterol-containing membrane (pleomorphic, completely invisible on Gram stain). Chlamydia: obligate intracellular, elementary bodies (infectious) and reticulate bodies (replicating).",
      mechanism: "Macrolide resistance in M. pneumoniae via 23S rRNA mutations.",
      intrinsic: "ALL β-LACTAMS (penicillins, cephalosporins, carbapenems, monobactams) and GLYCOPEPTIDES (vancomycin) have ZERO activity (no cell wall target)!",
      regimens: [
        { indication: "Atypical CAP / Bronchitis", drug: "Azithromycin (500 mg OD × 3–5d) OR Clarithromycin (500 mg BD)", alt: "Doxycycline (100 mg BD), Levofloxacin / Moxifloxacin" }
      ],
      pearls: "CRITICAL PHARMACOLOGIC PRINCIPLE: Never use penicillins or cephalosporins for Mycoplasma or Chlamydia; they have zero cell-wall target. Cold agglutinins, erythema multiforme, and autoimmune hemolytic anemia are classic Mycoplasma associations."
    },
    legio: {
      name: "Legionella pneumophila",
      group: "Atypicals / Waterborne",
      groupClass: "aty",
      gram: "Poorly-staining Gram-negative bacillus",
      microbiology: "Fastidious, aerobic, requires buffered charcoal yeast extract (BCYE) agar supplemented with L-cysteine and iron. Stains poorly with standard Gram stain; best seen with silver or Dieterle stain.",
      mechanism: "Facultative intracellular parasite of alveolar macrophages, avoiding lysosomal fusion.",
      intrinsic: "Penicillins and cephalosporins have poor intracellular penetration and are clinically ineffective.",
      regimens: [
        { indication: "Legionnaires' Disease (Severe CAP)", drug: "Levofloxacin (750 mg IV/PO OD) OR Azithromycin (500 mg IV/PO OD)", alt: "Moxifloxacin" }
      ],
      pearls: "Classic triad: severe pneumonia + gastrointestinal symptoms (diarrhea) + CNS symptoms (confusion) with hyponatremia and elevated hepatic transaminases. Urinary antigen test detects L. pneumophila serogroup 1 with high specificity within minutes."
    }
  };

  function fallbackOrgData(id) {
    var label = colLabel(id);
    return {
      name: label,
      group: "Organism Reference",
      groupClass: "gpc",
      gram: "Reference Organism",
      microbiology: "Identified organism in antimicrobial spectrum and resistance monitoring.",
      mechanism: "Refer to local clinical microbiology and susceptibility testing (CLSI / EUCAST).",
      intrinsic: "",
      regimens: [
        { indication: "Targeted Therapy", drug: "Direct therapy guided by in-vitro susceptibility / MIC reports.", alt: "" }
      ],
      pearls: "Verify pathogen identification, specimen quality, and clinical correlation before finalizing targeted antimicrobial therapy."
    };
  }

  function getOrgDossierData(id) {
    return ORGANISM_DATA[id] || fallbackOrgData(id);
  }

  function findOrgIdByName(name) {
    if (!name) return null;
    var n = String(name).toLowerCase().trim();
    if (n.indexOf("a. baumannii") !== -1 || n.indexOf("acinetobacter") !== -1 || n.indexOf("crab") !== -1) return "acineto";
    if (n.indexOf("p. aeruginosa") !== -1 || n.indexOf("pseudomonas") !== -1) return "pseud";
    if (n.indexOf("e. coli") !== -1 || n.indexOf("escherichia") !== -1) return "ecoli";
    if (n.indexOf("klebsiella") !== -1 || n.indexOf("k. pneumoniae") !== -1 || n.indexOf("k. oxytoca") !== -1) return "kleb";
    if (n.indexOf("mrsa") !== -1) return "mrsa";
    if (n.indexOf("mssa") !== -1) return "mssa";
    if (n.indexOf("s. aureus") !== -1 || n.indexOf("staphylococcus aureus") !== -1 || n.indexOf("staph aureus") !== -1) return "mrsa";
    if (n.indexOf("pneumococc") !== -1 || n.indexOf("s. pneumoniae") !== -1 || n.indexOf("streptococc") !== -1 || n.indexOf("pyogenes") !== -1 || n.indexOf("agalactiae") !== -1) return "strep";
    if (n.indexOf("faecium") !== -1 || n.indexOf("vre") !== -1) return "efaecium";
    if (n.indexOf("faecalis") !== -1 || n.indexOf("enterococc") !== -1) return "efaecalis";
    if (n.indexOf("proteus") !== -1 || n.indexOf("p. mirabilis") !== -1) return "pmir";
    if (n.indexOf("stenotrophomonas") !== -1 || n.indexOf("s. maltophilia") !== -1) return "steno";
    if (n.indexOf("salmonella") !== -1 || n.indexOf("shigella") !== -1) return "ecoli";
    if (n.indexOf("listeria") !== -1 || n.indexOf("l. monocytogenes") !== -1) return "listeria";
    if (n.indexOf("haemophilus") !== -1 || n.indexOf("h. influenzae") !== -1) return "hflu";
    if (n.indexOf("moraxella") !== -1 || n.indexOf("m. catarrhalis") !== -1) return "morax";
    if (n.indexOf("gonorrh") !== -1 || n.indexOf("n. gonorrhoeae") !== -1) return "ngon";
    if (n.indexOf("meningit") !== -1 || n.indexOf("n. meningitidis") !== -1) return "nmen";
    if (n.indexOf("bacteroides") !== -1 || n.indexOf("b. fragilis") !== -1) return "bfrag";
    if (n.indexOf("mycoplasma") !== -1 || n.indexOf("chlamydia") !== -1) return "atyp";
    if (n.indexOf("legionella") !== -1 || n.indexOf("l. pneumophila") !== -1) return "legio";
    if (n.indexOf("enterobacter") !== -1 || n.indexOf("serratia") !== -1 || n.indexOf("citrobacter") !== -1 || n.indexOf("ampc") !== -1) return "escappm";
    if (n.indexOf("esbl") !== -1) return "esbl";
    if (n.indexOf("cre") !== -1 || n.indexOf("carbapenem-resistant") !== -1) return "cre";
    return null;
  }

  /* ───────────────────────────  STATE / DOM  ─────────────────────────── */
  var root = null, tab = "coverage", covSel = null, covSelType = null, srcKey = "national", tEl, tTimer;
  var filterQuery = "", filterBand = "all";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ─────────────── DRUG DATABASE REDIRECTION ─────────────── */
  function cleanSingleDrugName(agent) {
    if (!agent) return "";
    var s = String(agent).trim();
    s = s.replace(/\s*\([^)]*\)/g, "").trim(); // remove e.g. (TMP–SMX) or (AmpC)
    if (/^co-trimoxazole/i.test(s)) return "Co-trimoxazole";
    if (s.indexOf("–") !== -1) {
      s = s.split("–")[0].trim();
    }
    if (s.indexOf(" / ") !== -1) {
      s = s.split(" / ")[0].trim();
    }
    return s.trim();
  }

  function redirectDrugDB(drugName) {
    var q = String(drugName || "").trim();
    if (!q) return;
    try {
      if (window.MEDDB) {
        if (typeof window.MEDDB.openComposition === "function") {
          window.MEDDB.openComposition(q);
          return;
        }
        if (typeof window.MEDDB.openList === "function") {
          window.MEDDB.openList(q);
          return;
        }
      }
    } catch (e) {
      console.warn("MEDDB redirect error", e);
    }
    toast("Drug database loading: " + q);
  }

  function openAntibiotic(agentStr) {
    if (!agentStr) return;
    showDrugModal(agentStr);
  }

  function showDrugPicker(title, drugs) {
    if (!root) return;
    var el = root.querySelector("#abgDrugPicker");
    if (!el) return;
    var h = '<div class="abg-picker-card">' +
      '<div class="abg-sheet-grabber"></div>' +
      '<div class="abg-picker-head">' +
        '<div class="abg-picker-title">Select Molecule</div>' +
        '<button class="abg-picker-close" data-act="dismiss-picker" aria-label="Close">' + abIco("close") + '</button>' +
      '</div>' +
      '<div class="abg-picker-sub">This coverage group includes multiple antimicrobial agents in the Drugs Database:</div>' +
      '<div class="abg-picker-list">';
    drugs.forEach(function (d) {
      var clean = cleanSingleDrugName(d);
      h += '<button class="abg-picker-item" data-act="pick-abx" data-target-abx="' + esc(clean || d) + '">' +
        '<span class="abg-picker-icon">' + abIco("pills") + '</span>' +
        '<span class="abg-picker-name">' + esc(d) + '</span>' +
        '<span class="abg-picker-arrow">↗</span>' +
      '</button>';
    });
    h += '</div></div>';
    el.innerHTML = h;
    el.classList.add("on");
  }

  function hideDrugPicker() {
    if (!root) return;
    var el = root.querySelector("#abgDrugPicker");
    if (el) {
      el.classList.remove("on");
      setTimeout(function () { if (!el.classList.contains("on")) el.innerHTML = ""; }, 220);
    }
  }

  /* ─────────────── ANTIBIOTIC COVERAGE & DRUG DB MODAL ─────────────── */
  function showDrugModal(drugIndexOrName) {
    if (!root) return;
    var el = root.querySelector("#abgDrugModal");
    if (!el) return;
    var d = null, di = -1;
    if (typeof drugIndexOrName === "number") {
      di = drugIndexOrName;
      d = COVERAGE[di];
    } else {
      var searchName = String(drugIndexOrName).toLowerCase().trim();
      for (var i = 0; i < COVERAGE.length; i++) {
        if (COVERAGE[i].agent.toLowerCase().indexOf(searchName) !== -1 ||
            searchName.indexOf(COVERAGE[i].agent.toLowerCase()) !== -1) {
          di = i;
          d = COVERAGE[i];
          break;
        }
      }
    }
    if (!d) return;

    var clean = cleanSingleDrugName(d.agent) || d.agent;
    var raw = String(d.agent).trim();
    var multiParts = [];
    if (raw.indexOf("/") !== -1) {
      multiParts = raw.split("/").map(function (p) { return p.trim(); }).filter(Boolean);
    }

    var keys = Object.keys(d.cov || {});
    var relOrgs = keys.filter(function (id) { return d.cov[id] === 2; });
    var partOrgs = keys.filter(function (id) { return d.cov[id] === 1; });

    var h = '<div class="abg-dossier-card">' +
      '<div class="abg-sheet-grabber"></div>' +
      '<div class="abg-dossier-head g-drug">' +
        '<div class="abg-dossier-meta">' +
          '<span class="abg-dossier-badge">' + esc(d.cls) + '</span>' +
          '<span class="abg-dossier-gram">Antimicrobial Agent</span>' +
        '</div>' +
        '<div class="abg-dossier-title">' + esc(d.agent) + '</div>' +
        '<button class="abg-dossier-close" data-act="dismiss-drug-modal" aria-label="Close">' + abIco("close") + '</button>' +
      '</div>' +
      '<div class="abg-dossier-body">';

    // HERO CTA: Know More - Open in Drug Database
    h += '<button class="abg-know-more-hero" data-act="open-abx-direct" data-agent="' + esc(clean) + '">' +
      abIco("pills") + ' <span>Know More — Open ' + esc(clean) + ' in Drug Database</span> ↗' +
    '</button>';

    if (multiParts.length > 1) {
      h += '<div class="abg-multi-molecules">' +
        '<span class="abg-multi-lbl">Specific Molecules in Drug Database:</span>' +
        '<div class="abg-multi-btns">' +
        multiParts.map(function (p) {
          var cp = cleanSingleDrugName(p);
          return '<button class="abg-multi-btn" data-act="open-abx-direct" data-agent="' + esc(cp || p) + '">' +
            abIco("pills") + ' ' + esc(p) + ' ↗</button>';
        }).join("") +
        '</div></div>';
    }

    if (d.note) {
      h += '<div class="abg-dossier-section pearls">' +
        '<div class="abg-dossier-sec-h">' + abIco("info") + ' Spectrum Highlights &amp; Clinical Note</div>' +
        '<div class="abg-dossier-sec-p">' + esc(d.note) + '</div>' +
      '</div>';
    }

    // Organisms Covered Section
    h += '<div class="abg-dossier-section">' +
      '<div class="abg-dossier-sec-h">' + abIco("microbe") + ' Organisms Covered by ' + esc(d.agent) + '</div>' +
      '<div class="abg-dossier-sec-p" style="margin-bottom:8px">Tap any organism below to inspect complete microbiology, intrinsic resistance, and treatment regimens:</div>';

    if (relOrgs.length) {
      h += '<div class="abg-cov-group-lbl"><b>Reliably Active (First-line / High Susceptibility):</b></div>' +
        '<div class="abg-tags" style="margin-bottom:10px">' +
        relOrgs.map(function (id) {
          return '<em class="abg-tag-org rel" data-act="dossier-open-org" data-org-id="' + esc(id) + '" title="View complete pathogen dossier">' +
            '✓ ' + esc(colLabel(id)) + ' <i class="abg-tag-info">' + abIco("microbe") + '</i></em>';
        }).join("") + '</div>';
    }

    if (partOrgs.length) {
      h += '<div class="abg-cov-group-lbl"><b>Variable / Inducible / Partial Activity:</b></div>' +
        '<div class="abg-tags">' +
        partOrgs.map(function (id) {
          return '<em class="abg-tag-org part" data-act="dossier-open-org" data-org-id="' + esc(id) + '" title="View complete pathogen dossier">' +
            '◐ ' + esc(colLabel(id)) + ' <i class="abg-tag-info">' + abIco("microbe") + '</i></em>';
        }).join("") + '</div>';
    }

    if (!relOrgs.length && !partOrgs.length) {
      h += '<span class="abg-note-sm">No coverage defined in standard spectrum.</span>';
    }
    h += '</div>';

    // Highlight on Spectrum Grid button + Done button
    h += '<div class="abg-dossier-actions">' +
      '<button class="abg-dossier-btn-isolate" data-act="isolate-drug-from-modal" data-drug-idx="' + di + '">Highlight on Spectrum Grid</button>' +
      '<button class="abg-dossier-btn-done" data-act="dismiss-drug-modal">Done</button>' +
    '</div>';

    h += '</div></div>';
    el.innerHTML = h;
    el.classList.add("on");
  }

  function hideDrugModal() {
    if (!root) return;
    var el = root.querySelector("#abgDrugModal");
    if (el) {
      el.classList.remove("on");
      setTimeout(function () { if (!el.classList.contains("on")) el.innerHTML = ""; }, 220);
    }
  }

  /* ─────────────── CELL CLICK ACTION MODAL ─────────────── */
  function showCellAction(di, orgId) {
    if (!root) return;
    var el = root.querySelector("#abgCellAction");
    if (!el) return;
    var d = COVERAGE[di];
    if (!d) return;
    var st = (d.cov && d.cov[orgId]) || 0; // 2 = reliable, 1 = variable, 0 = not active
    var statusClass = st === 2 ? "on" : st === 1 ? "part" : "no";
    var statusIcon = st === 2 ? abIco("check") : st === 1 ? "◐" : "✕";
    var statusText = st === 2 ? "Reliably Active (First-line spectrum)" :
                     st === 1 ? "Variable / Partial Activity (Verify against local susceptibility)" :
                     "Not Active (No activity or inherent resistance)";

    var h = '<div class="abg-cell-action-card">' +
      '<div class="abg-sheet-grabber"></div>' +
      '<div class="abg-cell-action-head">' +
        '<div class="abg-cell-action-title">' + esc(d.agent) + ' × ' + esc(colLabel(orgId)) + '</div>' +
        '<button class="abg-picker-close" data-act="dismiss-cell-action" aria-label="Close">' + abIco("close") + '</button>' +
      '</div>' +
      '<div class="abg-cell-banner ' + statusClass + '">' +
        '<span style="display:inline-flex;align-items:center">' + statusIcon + '</span>' +
        '<span>' + esc(statusText) + '</span>' +
      '</div>' +
      '<div class="abg-cell-actions">' +
        '<button class="abg-cell-btn-dossier" data-act="cell-open-org" data-org-id="' + esc(orgId) + '">' +
          abIco("microbe") + ' View ' + esc(colLabel(orgId)) + ' Pathogen &amp; AMR Dossier ↗' +
        '</button>' +
        '<button class="abg-cell-btn-drug" data-act="cell-open-drug" data-drug-idx="' + di + '">' +
          abIco("pills") + ' View ' + esc(d.agent) + ' Spectrum &amp; Drug Database ↗' +
        '</button>' +
      '</div>' +
    '</div>';
    el.innerHTML = h;
    el.classList.add("on");
  }

  function hideCellAction() {
    if (!root) return;
    var el = root.querySelector("#abgCellAction");
    if (el) {
      el.classList.remove("on");
      setTimeout(function () { if (!el.classList.contains("on")) el.innerHTML = ""; }, 220);
    }
  }

  /* ─────────────── ORGANISM MICROBIOLOGY DOSSIER MODAL ─────────────── */
  function showOrgDossier(orgId) {
    if (!root) return;
    var el = root.querySelector("#abgOrgDossier");
    if (!el) return;
    var d = getOrgDossierData(orgId);
    var hits = COVERAGE.filter(function (x) { return x.cov && x.cov[orgId]; }).sort(function (a, b) { return (b.cov[orgId] || 0) - (a.cov[orgId] || 0); });
    var relHits = hits.filter(function (x) { return x.cov[orgId] === 2; });
    var partHits = hits.filter(function (x) { return x.cov[orgId] === 1; });

    var h = '<div class="abg-dossier-card">' +
      '<div class="abg-sheet-grabber"></div>' +
      '<div class="abg-dossier-head g-' + esc(d.groupClass || "gpc") + '">' +
        '<div class="abg-dossier-meta">' +
          '<span class="abg-dossier-badge">' + esc(d.group) + '</span>' +
          '<span class="abg-dossier-gram">' + esc(d.gram) + '</span>' +
        '</div>' +
        '<div class="abg-dossier-title">' + esc(d.name) + '</div>' +
        '<button class="abg-dossier-close" data-act="dismiss-dossier" aria-label="Close">' + abIco("close") + '</button>' +
      '</div>' +
      '<div class="abg-dossier-body">';

    if (d.intrinsic) {
      h += '<div class="abg-dossier-alert">' +
        '<div class="abg-dossier-alert-title">' + abIco("warn") + ' Intrinsic / Inherent Resistance</div>' +
        '<div class="abg-dossier-alert-text">' + esc(d.intrinsic) + '</div>' +
      '</div>';
    }

    h += '<div class="abg-dossier-section">' +
      '<div class="abg-dossier-sec-h">' + abIco("microbe") + ' Microbiology, Morphology &amp; Virulence</div>' +
      '<div class="abg-dossier-sec-p">' + esc(d.microbiology) + '</div>' +
    '</div>';

    if (d.mechanism) {
      h += '<div class="abg-dossier-section">' +
        '<div class="abg-dossier-sec-h">' + abIco("flask") + ' AMR Mechanisms &amp; Phenotypes</div>' +
        '<div class="abg-dossier-sec-p">' + esc(d.mechanism) + '</div>' +
      '</div>';
    }

    if (d.regimens && d.regimens.length) {
      h += '<div class="abg-dossier-section">' +
        '<div class="abg-dossier-sec-h">' + abIco("pills") + ' Clinical Regimens &amp; Targeted Therapy</div>' +
        '<div class="abg-dossier-regimens">';
      d.regimens.forEach(function (r) {
        h += '<div class="abg-dossier-reg-item">' +
          '<div class="abg-dossier-reg-ind">' + esc(r.indication) + '</div>' +
          '<div class="abg-dossier-reg-drug"><b>Preferred:</b> ' + esc(r.drug) + '</div>' +
          (r.alt ? '<div class="abg-dossier-reg-alt"><b>Alternative:</b> ' + esc(r.alt) + '</div>' : '') +
        '</div>';
      });
      h += '</div></div>';
    }

    if (d.pearls) {
      h += '<div class="abg-dossier-section pearls">' +
        '<div class="abg-dossier-sec-h">' + abIco("info") + ' Clinical Pearls for Clinicians &amp; Microbiologists</div>' +
        '<div class="abg-dossier-sec-p">' + esc(d.pearls) + '</div>' +
      '</div>';
    }

    if (hits.length) {
      h += '<div class="abg-dossier-section">' +
        '<div class="abg-dossier-sec-h">' + abIco("pills") + ' Active Antibiotics from Spectrum Grid</div>' +
        '<div class="abg-dossier-sec-p" style="margin-bottom:8px">Tap any antibiotic to inspect coverage details &amp; open in Drug Database:</div>';

      if (relHits.length) {
        h += '<div class="abg-cov-group-lbl"><b>Reliably Active (First-line):</b></div>' +
          '<div class="abg-tags" style="margin-bottom:8px">' +
          relHits.map(function (x) {
            return '<em class="abg-tag-drug rel" data-act="dossier-open-abx" data-agent="' + esc(x.agent) + '" title="Inspect ' + esc(x.agent) + ' &amp; open in Drug DB">' +
              '✓ ' + esc(x.agent) + ' <i class="abg-tag-arrow">↗</i></em>';
          }).join("") + '</div>';
      }

      if (partHits.length) {
        h += '<div class="abg-cov-group-lbl"><b>Variable / Second-line:</b></div>' +
          '<div class="abg-tags">' +
          partHits.map(function (x) {
            return '<em class="abg-tag-drug part" data-act="dossier-open-abx" data-agent="' + esc(x.agent) + '" title="Inspect ' + esc(x.agent) + ' &amp; open in Drug DB">' +
              '◐ ' + esc(x.agent) + ' <i class="abg-tag-arrow">↗</i></em>';
          }).join("") + '</div>';
      }

      h += '</div>';
    }

    h += '<div class="abg-dossier-actions">' +
      '<button class="abg-dossier-btn-isolate" data-act="isolate-from-dossier" data-org-id="' + esc(orgId) + '">Highlight on Spectrum Grid</button>' +
      '<button class="abg-dossier-btn-done" data-act="dismiss-dossier">Done</button>' +
    '</div>';

    h += '</div></div>';
    el.innerHTML = h;
    el.classList.add("on");
  }

  function hideOrgDossier() {
    if (!root) return;
    var el = root.querySelector("#abgOrgDossier");
    if (el) {
      el.classList.remove("on");
      setTimeout(function () { if (!el.classList.contains("on")) el.innerHTML = ""; }, 220);
    }
  }

  function showOrgDossierByName(name) {
    var orgId = findOrgIdByName(name);
    if (orgId) {
      showOrgDossier(orgId);
    } else {
      var d = fallbackOrgData(name);
      d.name = name;
      showOrgDossierCustom(d);
    }
  }

  function showOrgDossierCustom(d) {
    if (!root) return;
    var el = root.querySelector("#abgOrgDossier");
    if (!el) return;
    var hits = COVERAGE.filter(function (x) {
      var oid = findOrgIdByName(d.name);
      return oid && x.cov && x.cov[oid];
    });

    var h = '<div class="abg-dossier-card">' +
      '<div class="abg-sheet-grabber"></div>' +
      '<div class="abg-dossier-head g-' + esc(d.groupClass || "gpc") + '">' +
        '<div class="abg-dossier-meta">' +
          '<span class="abg-dossier-badge">' + esc(d.group) + '</span>' +
          '<span class="abg-dossier-gram">' + esc(d.gram) + '</span>' +
        '</div>' +
        '<div class="abg-dossier-title">' + esc(d.name) + '</div>' +
        '<button class="abg-dossier-close" data-act="dismiss-dossier" aria-label="Close">' + abIco("close") + '</button>' +
      '</div>' +
      '<div class="abg-dossier-body">';

    if (d.intrinsic) {
      h += '<div class="abg-dossier-alert">' +
        '<div class="abg-dossier-alert-title">' + abIco("warn") + ' Intrinsic / Inherent Resistance</div>' +
        '<div class="abg-dossier-alert-text">' + esc(d.intrinsic) + '</div>' +
      '</div>';
    }

    h += '<div class="abg-dossier-section">' +
      '<div class="abg-dossier-sec-h">' + abIco("microbe") + ' Microbiology &amp; Clinical Summary</div>' +
      '<div class="abg-dossier-sec-p">' + esc(d.microbiology) + '</div>' +
    '</div>';

    if (d.pearls) {
      h += '<div class="abg-dossier-section pearls">' +
        '<div class="abg-dossier-sec-h">' + abIco("info") + ' Clinical Pearls</div>' +
        '<div class="abg-dossier-sec-p">' + esc(d.pearls) + '</div>' +
      '</div>';
    }

    if (hits.length) {
      h += '<div class="abg-dossier-section">' +
        '<div class="abg-dossier-sec-h">' + abIco("pills") + ' Active Antibiotics from Spectrum Grid</div>' +
        '<div class="abg-tags">' +
        hits.map(function (x) {
          return '<em class="abg-tag-drug rel" data-act="dossier-open-abx" data-agent="' + esc(x.agent) + '" title="View coverage &amp; Drug DB">' +
            '✓ ' + esc(x.agent) + ' <i class="abg-tag-arrow">↗</i></em>';
        }).join("") +
        '</div></div>';
    }

    h += '<div class="abg-dossier-actions">' +
      '<button class="abg-dossier-btn-done" data-act="dismiss-dossier">Done</button>' +
    '</div>' +
    '</div></div>';
    el.innerHTML = h;
    el.classList.add("on");
  }

  function open() {
    if (root) { root.classList.add("on"); document.body.style.overflow = "hidden"; enableRotate(); return; }
    injectCSS();
    root = document.createElement("div"); root.className = "abg"; root.id = "abgOverlay";
    root.innerHTML = shell();
    document.body.appendChild(root);
    render();
    bind();
    requestAnimationFrame(function () { root.classList.add("on"); });
    document.body.style.overflow = "hidden";
    enableRotate();
  }
  function close() { if (root) { root.classList.remove("on"); document.body.style.overflow = ""; } disableRotate(); }

  /* ─────────────── Rotation: unlock for the wide grid + rotate hint ─────────────── */
  var _isPortrait = function () {
    try { return window.matchMedia("(orientation: portrait)").matches; } catch (e) { return (window.innerHeight || 0) >= (window.innerWidth || 0); }
  };
  function enableRotate() {
    try { if (window.SMD_NATIVE && SMD_NATIVE.unlockRotation) SMD_NATIVE.unlockRotation(); } catch (e) {}
    if (_isPortrait()) showRotateHint();
    window.addEventListener("orientationchange", onOrient);
    window.addEventListener("resize", onOrient);
  }
  function disableRotate() {
    window.removeEventListener("orientationchange", onOrient);
    window.removeEventListener("resize", onOrient);
    hideRotateHint();
    try { if (window.SMD_NATIVE && SMD_NATIVE.lockPortrait) SMD_NATIVE.lockPortrait(); } catch (e) {}
  }
  function onOrient() {
    if (_isPortrait()) { if (root && root.classList.contains("on")) showRotateHint(); }
    else hideRotateHint();   // rotated to landscape — the hint has done its job
  }
  var _rotateTimer = null;
  function showRotateHint() {
    if (!root || root.querySelector("#abgRotate")) return;
    var h = document.createElement("div");
    h.className = "abg-rotate"; h.id = "abgRotate";
    h.innerHTML = '<div class="abg-rotate-pill">' +
      '<svg class="abg-rotate-phone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="3"/><path d="M12 18h.01"/><path class="abg-rotate-arrow" d="M20 8l2-2m0 0l-2-2m2 2h-4a4 4 0 00-4 4" stroke-width="1.6"/></svg>' +
      '<span class="abg-rotate-tx">Rotate for a wider view</span>' +
      '</div>' +
      '<div class="abg-rotate-progress"><div class="abg-rotate-bar"></div></div>';
    root.appendChild(h);
    /* swipe-up dismiss */
    var startY = 0;
    h.addEventListener("touchstart", function (e) { startY = e.touches[0].clientY; }, {passive: true});
    h.addEventListener("touchend", function (e) { if (startY - e.changedTouches[0].clientY > 20) hideRotateHint(); }, {passive: true});
    h.addEventListener("click", function () { hideRotateHint(); });
    requestAnimationFrame(function () { h.classList.add("on"); });
    /* auto-dismiss after 4s */
    if (_rotateTimer) clearTimeout(_rotateTimer);
    _rotateTimer = setTimeout(function () { _rotateTimer = null; hideRotateHint(); }, 4000);
  }
  function hideRotateHint() {
    if (_rotateTimer) { clearTimeout(_rotateTimer); _rotateTimer = null; }
    var h = root && root.querySelector("#abgRotate");
    if (!h) return;
    h.classList.remove("on");
    setTimeout(function () { if (h && h.parentNode) h.parentNode.removeChild(h); }, 400);
  }

  function shell() {
    return '' +
      '<div class="abg-top">' +
        '<button class="abg-back" data-act="close" aria-label="Back">‹ Back</button>' +
        '<div class="abg-ttl-wrap">' +
          '<div class="abg-ttl">Antibiogram</div>' +
          '<div class="abg-subttl">Spectrum &amp; Susceptibility Guide</div>' +
        '</div>' +
        '<button class="abg-reset-btn" data-act="reset-all" title="Reset selections and filters">Reset</button>' +
      '</div>' +
      '<div class="abg-tabs" role="tablist">' +
        '<button class="abg-tab on" data-tab="coverage" role="tab">Antibiotic coverage</button>' +
        '<button class="abg-tab" data-tab="resistance" role="tab">Resistance rates</button>' +
      '</div>' +
      '<div class="abg-body" id="abgBody"></div>' +
      '<div class="abg-modal-sheet" id="abgDrugPicker"></div>' +
      '<div class="abg-modal-sheet" id="abgCellAction"></div>' +
      '<div class="abg-modal-sheet" id="abgDrugModal"></div>' +
      '<div class="abg-modal-sheet" id="abgOrgDossier"></div>';
  }

  /* ───────────────────────────  RENDER  ─────────────────────────── */
  function render() {
    [].forEach.call(root.querySelectorAll(".abg-tab"), function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === tab); });
    var body = root.querySelector("#abgBody");
    body.innerHTML = tab === "coverage" ? coverageView() : resistanceView();
    body.scrollTop = 0;
  }

  /* Coverage grid + interactive summary + search & category filters */
  function coverageView() {
    var h = '<div class="abg-filter-bar">' +
      '<div class="abg-search-box">' +
        '<span class="abg-search-icon">' + abIco("search") + '</span>' +
        '<input type="search" class="abg-search-input" id="abgSearch" placeholder="Filter antibiotic (e.g. Meropenem) or organism..." value="' + esc(filterQuery) + '" autocomplete="off" autocorrect="off" spellcheck="false" />' +
        (filterQuery ? '<button class="abg-search-clear" data-act="clear-search" aria-label="Clear">' + abIco("close") + '</button>' : '') +
      '</div>' +
      '<div class="abg-filter-pills">' +
        '<button class="abg-filter-pill' + (filterBand === "all" ? " active" : "") + '" data-act="set-band" data-band="all">All Spectrum</button>' +
        '<button class="abg-filter-pill' + (filterBand === "gpc" ? " active" : "") + '" data-act="set-band" data-band="gpc"><span class="abg-dot gpc"></span>Gram (+)</button>' +
        '<button class="abg-filter-pill' + (filterBand === "gneg" ? " active" : "") + '" data-act="set-band" data-band="gneg"><span class="abg-dot entero"></span>Gram (-)</button>' +
        '<button class="abg-filter-pill' + (filterBand === "nonferm" ? " active" : "") + '" data-act="set-band" data-band="nonferm"><span class="abg-dot nonferm"></span>Non-ferm</button>' +
        '<button class="abg-filter-pill' + (filterBand === "ana" ? " active" : "") + '" data-act="set-band" data-band="ana"><span class="abg-dot ana"></span>Anaerobes</button>' +
        '<button class="abg-filter-pill' + (filterBand === "aty" ? " active" : "") + '" data-act="set-band" data-band="aty"><span class="abg-dot aty"></span>Atypicals</button>' +
      '</div>' +
    '</div>';

    h += '<div class="abg-note">Spectrum of activity — qualitative clinical teaching guide. Tap any drug, organism, or cell to inspect coverage &amp; details.</div>';
    h += '<div class="abg-sum" id="abgSum">' + coverageSummary() + '</div>';
    h += '<div id="abgGridContainer">' + gridTableHtml() + '</div>';
    return h;
  }

  function updateGridOnly() {
    if (!root) return;
    var container = root.querySelector("#abgGridContainer");
    if (container) container.innerHTML = gridTableHtml();
    var sum = root.querySelector("#abgSum");
    if (sum) sum.innerHTML = coverageSummary();
    var searchBox = root.querySelector(".abg-search-box");
    if (searchBox) {
      var clearBtn = searchBox.querySelector(".abg-search-clear");
      if (filterQuery && !clearBtn) {
        var b = document.createElement("button");
        b.className = "abg-search-clear";
        b.setAttribute("data-act", "clear-search");
        b.setAttribute("aria-label", "Clear");
        b.innerHTML = abIco("close");
        searchBox.appendChild(b);
      } else if (!filterQuery && clearBtn) {
        clearBtn.remove();
      }
    }
  }

  function gridTableHtml() {
    var q = filterQuery.toLowerCase().trim();
    // 1. Columns according to filterBand
    var viewCols = COLS;
    if (filterBand === "gpc") viewCols = COLS.filter(function (c) { return c.group === "gpc"; });
    else if (filterBand === "gneg") viewCols = COLS.filter(function (c) { return c.group === "entero" || c.group === "fast"; });
    else if (filterBand === "nonferm") viewCols = COLS.filter(function (c) { return c.group === "nonferm"; });
    else if (filterBand === "ana") viewCols = COLS.filter(function (c) { return c.group === "ana"; });
    else if (filterBand === "aty") viewCols = COLS.filter(function (c) { return c.group === "aty"; });

    // 2. Filter drugs if filterQuery is set
    var viewDrugs = [];
    COVERAGE.forEach(function (d, i) {
      if (!q) { viewDrugs.push({ d: d, i: i }); return; }
      var matchDrug = d.agent.toLowerCase().indexOf(q) !== -1 || d.cls.toLowerCase().indexOf(q) !== -1 || (d.note && d.note.toLowerCase().indexOf(q) !== -1);
      var matchOrg = Object.keys(d.cov || {}).some(function (oid) {
        return colLabel(oid).toLowerCase().indexOf(q) !== -1;
      });
      if (matchDrug || matchOrg) viewDrugs.push({ d: d, i: i });
    });

    if (!viewDrugs.length) {
      return '<div class="abg-empty-filter">' +
        '<div class="abg-empty-ic">' + abIco("search") + '</div>' +
        '<b>No matching antibiotics or organisms</b>' +
        '<p>No results found for &ldquo;' + esc(filterQuery) + '&rdquo;.</p>' +
        '<button class="abg-reset-filter-btn" data-act="clear-search">Clear Search Filter</button>' +
      '</div>';
    }

    var h = '<div class="abg-scroll"><table class="abg-grid"><thead>';
    if (filterBand === "all") {
      var solo = {}; BANDS.forEach(function (b) { if (b.groups.length === 1) solo[b.groups[0]] = 1; });
      var span = {}; GROUPS.forEach(function (g) { span[g.id] = g.cols.length; });
      h += '<tr class="abg-band"><th class="abg-rowh abg-corner" rowspan="3">Antibiotic</th>';
      BANDS.forEach(function (b) {
        var cs = 0; b.groups.forEach(function (gid) { cs += span[gid] || 0; });
        var rs = b.groups.length === 1 ? ' rowspan="2"' : '';
        h += '<th class="abg-gh abg-band-h g-' + b.id + '"' + rs + ' colspan="' + cs + '">' + esc(b.name) + '</th>';
      });
      h += '</tr><tr class="abg-grp">';
      GROUPS.forEach(function (g) { if (!solo[g.id]) h += '<th class="abg-gh g-' + g.id + '" colspan="' + g.cols.length + '">' + esc(g.name) + '</th>'; });
      h += '</tr>';
    } else {
      h += '<tr class="abg-band"><th class="abg-rowh abg-corner" rowspan="2">Antibiotic</th>' +
        '<th class="abg-gh abg-band-h g-' + filterBand + '" colspan="' + viewCols.length + '">' +
          esc(filterBand === "gpc" ? "Gram-Positive Organisms" :
              filterBand === "gneg" ? "Gram-Negative Organisms" :
              filterBand === "nonferm" ? "Non-Fermenters" :
              filterBand === "ana" ? "Anaerobic Organisms" :
              filterBand === "aty" ? "Atypical Organisms" : "Selected Spectrum") +
        '</th></tr>';
    }

    h += '<tr class="abg-orgh">';
    viewCols.forEach(function (c) {
      var on = (covSelType === "org" && covSel === c.id) ? " sel" : "";
      h += '<th class="abg-ch g-' + c.group + on + '" data-org="' + c.id + '" title="Tap to isolate column or view pathogen details">' +
        '<button class="abg-ch-btn" data-act="show-org-dossier" data-org-id="' + esc(c.id) + '" title="View complete microbiology dossier">' +
          esc(c.label) +
        '</button>' +
      '</th>';
    });
    h += '</tr></thead><tbody>';

    var lastCls = null;
    viewDrugs.forEach(function (item) {
      var d = item.d, i = item.i;
      var rowOn = (covSelType === "drug" && covSel === i) ? " sel" : "";
      var dim = covSel !== null && !rowOn && covSelType === "drug" ? " dim" : "";
      var newCls = d.cls !== lastCls; lastCls = d.cls;
      h += '<tr class="abg-drow' + rowOn + dim + '" data-drug="' + i + '">';
      h += '<td class="abg-rowh">' +
        (newCls ? '<span class="abg-cls">' + esc(d.cls) + '</span>' : '') +
        '<div class="abg-agent-wrap">' +
          '<button class="abg-agent-btn" data-act="open-abx" data-agent="' + esc(d.agent) + '" title="Inspect coverage &amp; open in Drug Database">' +
            esc(d.agent) +
          '</button>' +
          '<button class="abg-drug-link-btn" data-act="open-abx" data-agent="' + esc(d.agent) + '" title="Open in Drug Database" aria-label="Open in Drug Database">' +
            abIco("pills") + ' <span class="abg-link-arrow">↗</span>' +
          '</button>' +
        '</div>' +
      '</td>';
      viewCols.forEach(function (c) {
        var st = (d.cov && d.cov[c.id]) || 0;
        var hl = "";
        if (covSelType === "org" && covSel === c.id) hl = " col";
        if ((covSelType === "org" && covSel === c.id) || (covSelType === "drug" && covSel === i)) hl += " hit";
        var cls = st === 2 ? "on" : st === 1 ? "part" : "no";
        var sym = st === 2 ? abIco("check") : st === 1 ? "◐" : "✕";
        h += '<td class="abg-cell ' + cls + hl + '" data-org-id="' + esc(c.id) + '"><i class="abg-cell-sym">' + sym + '</i></td>';
      });
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    h += '<div class="abg-legend"><span><i class="sw on"></i>Reliably active</span><span><i class="sw part"></i>Variable / not first-line</span><span><i class="sw no"></i>Not active</span><span class="abg-src">Spectrum reference — verify against local antibiogram · Sanford / IDSA / CLSI M100 (2024)</span></div>';
    return h;
  }

  function coverageSummary() {
    if (covSel === null) return '<span class="abg-hint">Nothing selected — showing the full spectrum grid. Tap any organism header to inspect pathogen details, or any antibiotic row for coverage &amp; drug database links.</span>';
    if (covSelType === "drug") {
      var d = COVERAGE[covSel];
      var keys = Object.keys(d.cov).sort(function (a, b) { return (d.cov[b] || 0) - (d.cov[a] || 0); });   // reliable (2) first
      var clean = cleanSingleDrugName(d.agent) || d.agent;
      var h = '<button class="abg-clear" data-act="clearcov" aria-label="Clear selection">' + abIco("close") + '</button>' +
        '<div class="abg-sum-header">' +
          '<div class="abg-sum-meta-row">' +
            '<span class="abg-cls-badge">' + esc(d.cls) + '</span>' +
          '</div>' +
          '<div class="abg-sum-title-text">' + esc(d.agent) + '</div>' +
        '</div>' +
        '<button class="abg-know-more-hero" data-act="open-abx" data-agent="' + esc(d.agent) + '">' +
          abIco("pills") + ' <span>Know More — Open ' + esc(clean) + ' in Drug Database</span> ↗' +
        '</button>' +
        (d.note ? '<div class="abg-sum-note"><span class="abg-sum-note-ic">' + abIco("info") + '</span> <div><b>Spectrum &amp; Clinical Note:</b> ' + esc(d.note) + '</div></div>' : '') +
        '<div class="abg-sum-body">' +
          '<div class="abg-sum-cov-label"><b>Organisms covered</b> (tap any for pathogen details):</div>' +
          (keys.length ? '<div class="abg-tags">' + keys.map(function (id) {
            var rel = d.cov[id] === 2;
            return '<em class="abg-tag-org ' + (rel ? "rel" : "part") + '" data-act="select-org-show" data-org-id="' + esc(id) + '" title="View pathogen details for ' + esc(colLabel(id)) + '">' +
              (rel ? "✓ " : "◐ ") + esc(colLabel(id)) + ' <i class="abg-tag-info">' + abIco("microbe") + '</i></em>';
          }).join("") + '</div>' : '<span class="abg-note-sm">No coverage defined in standard spectrum.</span>') +
        '</div>';
      return h;
    }
    // org selected
    var d = getOrgDossierData(covSel);
    var hits = COVERAGE.filter(function (x) { return x.cov[covSel]; }).sort(function (a, b) { return (b.cov[covSel] || 0) - (a.cov[covSel] || 0); });
    var h = '<button class="abg-clear" data-act="clearcov" aria-label="Clear selection">' + abIco("close") + '</button>' +
      '<div class="abg-sum-header">' +
        '<div class="abg-sum-meta-row">' +
          '<span class="abg-dossier-badge g-' + esc(d.groupClass || "gpc") + '">' + esc(d.group) + '</span>' +
          '<span class="abg-gram-badge">' + esc(d.gram) + '</span>' +
        '</div>' +
        '<div class="abg-sum-title-text org">' + esc(d.name) + '</div>' +
      '</div>' +
      '<button class="abg-dossier-hero-btn" data-act="show-org-dossier" data-org-id="' + esc(covSel) + '">' +
        abIco("microbe") + ' <span>View Complete Pathogen &amp; Microbiology Dossier</span> ↗' +
      '</button>' +
      '<div class="abg-sum-pathogen-card">' +
        '<div class="abg-sum-pathogen-sec"><b>Type &amp; Microbiology:</b> ' + esc(d.microbiology) + '</div>' +
        (d.intrinsic ? '<div class="abg-sum-pathogen-intrinsic"><span class="abg-sum-alert-ic">' + abIco("warn") + '</span> <div><b>Intrinsic Resistance:</b> ' + esc(d.intrinsic) + '</div></div>' : '') +
      '</div>' +
      '<div class="abg-sum-body">' +
        '<div class="abg-sum-cov-label"><b>Antibiotics with activity</b> (tap any to inspect &amp; open in Drug DB):</div>' +
        (hits.length ? '<div class="abg-tags">' + hits.map(function (x) {
          var rel = x.cov[covSel] === 2;
          return '<em class="abg-tag-drug ' + (rel ? "rel" : "part") + '" data-act="select-drug-name" data-agent="' + esc(x.agent) + '" title="Inspect ' + esc(x.agent) + '">' +
            (rel ? "✓ " : "◐ ") + esc(x.agent) + ' <i class="abg-tag-arrow">↗</i></em>';
        }).join("") + '</div>' : '<span class="abg-note-sm">No standard antibiotics active against this resistance profile.</span>') +
      '</div>';
    return h;
  }
  function colLabel(id) { for (var i = 0; i < COLS.length; i++) if (COLS[i].id === id) return COLS[i].label; return id; }

  /* Resistance rates — % RESISTANT (= 100 − %susceptible) from the ACTIVE profile
     (region composite / individual study / hospital / ICMR national). Data is stored as
     % susceptible; we invert only at display. Missing cells render "—". No invented values. */
  function resistanceView() {
    var src = abgData();
    if (!src || !src.org || !Object.keys(src.org).length)
      return '<div class="abg-empty"><div class="abg-empty-ic">' + abIco("trend") + '</div><b>Antibiogram unavailable</b><p>The susceptibility dataset has not loaded yet, or this profile has no antibiogram. Reopen this screen in a moment.</p></div>';

    var curId = (window.HOSPITAL && window.HOSPITAL.current) ? window.HOSPITAL.current().id : "ICMR";
    var h = '<div class="abg-srcbar"><label class="abg-srclab">Source</label>' +
      '<select class="abg-srcsel" id="abgSrc" aria-label="Antibiogram source">' + sourceOptions(curId) + '</select></div>';

    h += '<div class="abg-warn"><b>' + (src.dated ? "Dated source." : (src.composite ? "Regional best-of composite." : "Reference data.")) + '</b> ' + esc(src.source || "") +
      (src.note ? ' — ' + esc(src.note) : '') + ' <b>Shown as % of isolates resistant.</b> Tap any organism for microbiology and AMR profile, or any antibiotic to view prescribing details in the Drug Database.</div>';

    var orgs = src.org || {};
    Object.keys(orgs).forEach(function (name) {
      var o = orgs[name], drugs = o.d || {};
      var meta = [];
      if (o.n != null) meta.push(o.n + " isolates");
      if (o.specimen) meta.push(esc(o.specimen));
      h += '<div class="abg-oc"><div class="abg-oc-h">' +
        '<button class="abg-oc-n-btn" data-act="show-org-dossier-name" data-org-name="' + esc(name) + '" title="View Microbiology & Clinical Dossier">' +
          '<span class="abg-oc-n">' + esc(name) + '</span>' +
          '<span class="abg-oc-badge">' + abIco("microbe") + ' Info ↗</span>' +
        '</button>' +
        (meta.length ? '<span class="abg-oc-m">' + meta.join(" · ") + '</span>' : '') +
      '</div><div class="abg-oc-rows">';
      Object.keys(drugs).forEach(function (k) {
        var v = drugs[k], s = v.s;
        var drugName = drugLabel(k);
        var prov = v.src ? ' data-org="' + esc(name) + '" data-drug="' + esc(k) + '"' : '';
        h += '<div class="abg-dr' + (v.src ? ' abg-dr-prov' : '') + '"' + prov + '>' +
          '<button class="abg-dr-n-btn" data-act="open-abx" data-agent="' + esc(drugName) + '" title="Open in Drug Database">' +
            '<span class="abg-dr-n">' + esc(drugName) + '</span>' +
            '<span class="abg-dr-link-arrow">↗</span>' +
          '</button>' +
          (v.src ? ' <i class="abg-prov" title="tap for source">' + abIco("info") + '</i>' : '');
        if (s == null) {
          h += '<span class="abg-dr-q">' + esc(v.q || "—") + '</span>';
        } else {
          var R = Math.round(100 - s);
          var pct = (v.approx ? "~" : "") + R + "% R";
          h += '<span class="abg-dr-v"><span class="abg-pill ' + rClass(R) + '">' + pct + '</span>' + trendArrowR(v.trend) + '</span>';
        }
        h += '</div>';
        if (s != null && v.q) h += '<div class="abg-dr-note">' + esc(v.q) + '</div>';
      });
      h += '</div></div>';
    });

    h += '<div class="abg-legend heat"><span><i class="hs su0"></i>≥70%</span><span><i class="hs su1"></i>50–69%</span><span><i class="hs su2"></i>25–49%</span><span><i class="hs su3"></i>10–24%</span><span><i class="hs su4"></i>&lt;10%</span><span>% resistant (red = worse)</span></div>';
    return h;
  }

  /* Source dropdown built from HOSPITAL.list: ICMR national + national studies, then each
     region's composite with its individual studies nested (grouped by <optgroup>), then GIMSR.
     Changing it calls HOSPITAL.setProfile so the whole app (reasoning too) stays in sync. */
  function sourceOptions(cur) {
    if (!(window.HOSPITAL && window.HOSPITAL.list)) return '<option value="ICMR" selected>ICMR AMRSN 2024 · National</option>';
    var list = window.HOSPITAL.list;
    function opt(id, label) { return '<option value="' + id + '"' + (id === cur ? " selected" : "") + '>' + esc(label) + '</option>'; }
    function studiesOf(rg) {
      return list.filter(function (x) { return x.type === "study" && x.region === rg; })
        .sort(function (a, b) { return (a.credibility || 9) - (b.credibility || 9); });
    }
    var comp = {}; list.forEach(function (x) { if (x.type === "region") comp[x.region] = x; });
    var h = '<optgroup label="National">';
    if (list.some(function (x) { return x.id === "ICMR"; })) h += opt("ICMR", "ICMR AMRSN 2024 · National (default)");
    studiesOf("national").forEach(function (s) { h += opt(s.id, "↳ " + s.name); });
    h += '</optgroup>';
    [["south", "South India"], ["north", "North India"], ["east", "East & NE India"], ["west", "West & Central India"]].forEach(function (rr) {
      var c = comp[rr[0]], sts = studiesOf(rr[0]);
      if (!c && !sts.length) return;
      h += '<optgroup label="' + rr[1] + '">';
      if (c) h += opt(c.id, (c.short || rr[1]) + " — regional composite (best-of)");
      sts.forEach(function (s) { h += opt(s.id, "↳ " + s.name); });
      h += '</optgroup>';
    });
    if (list.some(function (x) { return x.id === "GIMSR"; }) && window.ASP_ABG && window.ASP_ABG.hospital && window.ASP_ABG.hospital.org && Object.keys(window.ASP_ABG.hospital.org).length)
      h += '<optgroup label="Hospital">' + opt("GIMSR", "GIMSR, Visakhapatnam") + '</optgroup>';
    return h;
  }
  function srcLabel(id) {
    try { var st = window.ABG_DATA && window.ABG_DATA.getStudy && window.ABG_DATA.getStudy(id); if (st) return st.label; } catch (e) {}
    return id;
  }

  // Resistance colour bands (red = high R). Reuses su0..su4 tokens (su0 red … su4 green).
  function rClass(R) { return R >= 70 ? "su0" : R >= 50 ? "su1" : R >= 25 ? "su2" : R >= 10 ? "su3" : "su4"; }
  // Trend on RESISTANCE: input is a %-susceptible series, so ΔR = −ΔS.
  // Rising R = worsening = red ▲; falling R = improving = green ▼.
  function trendArrowR(t) {
    if (!t || t.length < 2) return "";
    var dR = -(t[t.length - 1][1] - t[t.length - 2][1]);
    if (Math.abs(dR) < 0.5) return "";
    var worse = dR > 0;
    return '<span class="abg-trend ' + (worse ? "down" : "up") + '" title="' + (worse ? "resistance rising" : "resistance falling") + '">' + (worse ? "▲" : "▼") + Math.abs(Math.round(dR)) + '</span>';
  }

  /* ───────────────────────────  EVENTS  ─────────────────────────── */
  function bind() {
    root.addEventListener("click", function (e) {
      // 0. Backdrop click dismiss for all modal sheets
      if (e.target && e.target.classList && e.target.classList.contains("abg-modal-sheet")) {
        hideDrugModal();
        hideOrgDossier();
        hideCellAction();
        hideDrugPicker();
        return;
      }

      // 1. Direct interactive action buttons
      var btn = e.target.closest("[data-act]");
      if (btn) {
        var act = btn.getAttribute("data-act");
        if (act === "close") return close();
        if (act === "clearcov") { covSel = null; covSelType = null; return render(); }
        if (act === "set-band") {
          filterBand = btn.getAttribute("data-band") || "all";
          return render();
        }
        if (act === "clear-search") {
          filterQuery = "";
          var inp = root.querySelector("#abgSearch");
          if (inp) inp.value = "";
          return render();
        }
        if (act === "reset-all") {
          filterQuery = "";
          filterBand = "all";
          covSel = null;
          covSelType = null;
          return render();
        }
        if (act === "open-abx") {
          var ag = btn.getAttribute("data-agent");
          if (ag) showDrugModal(ag);
          return;
        }
        if (act === "open-abx-direct") {
          var agDirect = btn.getAttribute("data-agent");
          if (agDirect) redirectDrugDB(agDirect);
          return;
        }
        if (act === "select-org-show") {
          var soid = btn.getAttribute("data-org-id");
          if (soid) {
            covSel = soid;
            covSelType = "org";
            render();
            showOrgDossier(soid);
          }
          return;
        }
        if (act === "select-drug-name") {
          var agName = btn.getAttribute("data-agent");
          if (agName) {
            for (var ki = 0; ki < COVERAGE.length; ki++) {
              if (COVERAGE[ki].agent === agName) {
                covSel = ki;
                covSelType = "drug";
                render();
                showDrugModal(ki);
                return;
              }
            }
            showDrugModal(agName);
          }
          return;
        }
        if (act === "dossier-open-abx") {
          var doAg = btn.getAttribute("data-agent");
          hideOrgDossier();
          if (doAg) showDrugModal(doAg);
          return;
        }
        if (act === "dossier-open-org") {
          var doOid = btn.getAttribute("data-org-id");
          hideDrugModal();
          if (doOid) showOrgDossier(doOid);
          return;
        }
        if (act === "show-org-dossier") {
          var oid = btn.getAttribute("data-org-id");
          if (oid) {
            covSel = oid;
            covSelType = "org";
            render();
            showOrgDossier(oid);
          }
          return;
        }
        if (act === "show-org-dossier-name") {
          var onm = btn.getAttribute("data-org-name");
          if (onm) showOrgDossierByName(onm);
          return;
        }
        if (act === "dismiss-dossier") {
          hideOrgDossier();
          return;
        }
        if (act === "dismiss-drug-modal") {
          hideDrugModal();
          return;
        }
        if (act === "dismiss-cell-action") {
          hideCellAction();
          return;
        }
        if (act === "cell-open-org") {
          var cellOid = btn.getAttribute("data-org-id");
          hideCellAction();
          if (cellOid) showOrgDossier(cellOid);
          return;
        }
        if (act === "cell-open-drug") {
          var cellDi = +btn.getAttribute("data-drug-idx");
          hideCellAction();
          showDrugModal(cellDi);
          return;
        }
        if (act === "dismiss-picker") {
          hideDrugPicker();
          return;
        }
        if (act === "pick-abx") {
          var targetAbx = btn.getAttribute("data-target-abx");
          hideDrugPicker();
          if (targetAbx) redirectDrugDB(targetAbx);
          return;
        }
        if (act === "isolate-drug-from-modal") {
          var isDrugIdx = +btn.getAttribute("data-drug-idx");
          hideDrugModal();
          tab = "coverage";
          covSel = isDrugIdx;
          covSelType = "drug";
          render();
          var sumEl = root.querySelector("#abgSum");
          if (sumEl) sumEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }
        if (act === "isolate-from-dossier") {
          var isOrgId = btn.getAttribute("data-org-id");
          hideOrgDossier();
          tab = "coverage";
          covSel = isOrgId;
          covSelType = "org";
          render();
          var sumEl = root.querySelector("#abgSum");
          if (sumEl) sumEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }
      }

      // 2. Tab switching
      var tBtn = e.target.closest("[data-tab]");
      if (tBtn) {
        tab = tBtn.getAttribute("data-tab");
        return render();
      }

      // 3. Grid interactions
      if (tab === "coverage") {
        var colHeader = e.target.closest(".abg-ch[data-org]");
        if (colHeader) {
          var oid = colHeader.getAttribute("data-org");
          covSel = oid;
          covSelType = "org";
          render();
          showOrgDossier(oid);
          return;
        }
        var cell = e.target.closest(".abg-cell");
        if (cell) {
          var tr = cell.closest("tr[data-drug]");
          if (tr) {
            var di = +tr.getAttribute("data-drug");
            var targetOid = cell.getAttribute("data-org-id");
            if (targetOid) {
              covSel = di;
              covSelType = "drug";
              render();
              showCellAction(di, targetOid);
              return;
            }
          }
        }
        var dr = e.target.closest("[data-drug]");
        if (dr && dr.classList.contains("abg-drow")) {
          var di = +dr.getAttribute("data-drug");
          covSel = di;
          covSelType = "drug";
          render();
          showDrugModal(di);
          return;
        }
      }

      // 4. Resistance view cell provenance
      if (tab === "resistance") {
        var pr = e.target.closest(".abg-dr-prov[data-drug]");
        if (pr && !e.target.closest(".abg-dr-n-btn")) {
          var src = abgData(), o = src && src.org && src.org[pr.getAttribute("data-org")];
          var c = o && o.d && o.d[pr.getAttribute("data-drug")];
          if (c && c.src) toast(drugLabel(pr.getAttribute("data-drug")) + " · " + pr.getAttribute("data-org") + " — source: " + srcLabel(c.src));
          return;
        }
      }
    });

    root.addEventListener("input", function (e) {
      if (e.target && e.target.id === "abgSearch") {
        filterQuery = e.target.value;
        updateGridOnly();
      }
    });

    root.addEventListener("change", function (e) {
      if (e.target && e.target.id === "abgSrc") {
        if (window.HOSPITAL && window.HOSPITAL.setProfile) window.HOSPITAL.setProfile(e.target.value);
        render();
      }
    });
  }

  function toast(m) {
    if (!tEl) { tEl = document.createElement("div"); tEl.className = "abg-toast"; document.body.appendChild(tEl); }
    tEl.textContent = m; tEl.classList.add("on"); clearTimeout(tTimer);
    tTimer = setTimeout(function () { tEl.classList.remove("on"); }, 2400);
  }

  /* ───────────────────────────  STYLES  ─────────────────────────── */
  function injectCSS() {
    if (document.getElementById("abg-css")) return;
    var s = document.createElement("style"); s.id = "abg-css";
    s.textContent = [
      ".abg{--bg:#F8FAFC;--panel:#FFFFFF;--ink:#0F172A;--mut:#64748B;--line:#E2E8F0;--tl:#0F766E;--tls:#CCFBF1;--f:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;position:fixed;inset:0;z-index:950;background:var(--bg);color:var(--ink);font-family:var(--f);display:flex;flex-direction:column;opacity:0;transform:translateY(8px);transition:opacity .22s cubic-bezier(.2,.8,.2,1),transform .22s cubic-bezier(.2,.8,.2,1);pointer-events:none}",
      ".abg.on{opacity:1;transform:none;pointer-events:auto}",
      "body.dark .abg{--bg:#0B0F19;--panel:#111827;--ink:#F1F5F9;--mut:#94A3B8;--line:#1E293B;--tls:#0d3b36}",
      ".abg-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.88);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);position:sticky;top:0;z-index:20}",
      "body.dark .abg-top{background:rgba(17,24,39,.88)}",
      ".abg-back{display:inline-flex;align-items:center;gap:4px;border:none;background:var(--tls);color:var(--tl);font:700 13px var(--f);cursor:pointer;padding:6px 12px;border-radius:20px;transition:transform .12s,background .12s}",
      ".abg-back:active{transform:scale(.95);background:var(--tl);color:#fff}",
      ".abg-ttl-wrap{display:flex;flex-direction:column;align-items:center;text-align:center}",
      ".abg-ttl{font:800 17px/1.2 var(--f);letter-spacing:-.02em;color:var(--ink)}",
      ".abg-subttl{font:600 10.5px var(--f);color:var(--mut);letter-spacing:.02em;text-transform:uppercase;margin-top:1px}",
      ".abg-reset-btn{border:none;background:rgba(100,116,139,.1);color:var(--mut);font:700 12px var(--f);padding:6px 11px;border-radius:20px;cursor:pointer;transition:background .15s,color .15s}",
      ".abg-reset-btn:active{background:var(--tls);color:var(--tl)}",
      ".abg-tabs{display:flex;gap:4px;padding:5px;margin:8px 16px 6px;background:rgba(0,0,0,.05);border-radius:14px;position:relative;z-index:10}",
      "body.dark .abg-tabs{background:rgba(255,255,255,.07)}",
      ".abg-tab{flex:1;border:none;background:none;color:var(--mut);font:700 12.5px var(--f);padding:8px 10px;border-radius:10px;cursor:pointer;transition:all .18s cubic-bezier(.2,.8,.2,1);text-align:center}",
      ".abg-tab.on{background:var(--panel);color:var(--tl);box-shadow:0 2px 8px rgba(0,0,0,.08)}",
      "body.dark .abg-tab.on{background:#1E293B;color:#2DD4BF;box-shadow:0 2px 8px rgba(0,0,0,.4)}",
      ".abg-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:8px 16px calc(28px + env(safe-area-inset-bottom))}",
      /* Filter Bar & Search */
      ".abg-filter-bar{margin-bottom:10px;display:flex;flex-direction:column;gap:8px}",
      ".abg-search-box{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px 12px;box-shadow:0 1px 3px rgba(0,0,0,.02);transition:border-color .15s,box-shadow .15s}",
      ".abg-search-box:focus-within{border-color:var(--tl);box-shadow:0 0 0 3px rgba(15,118,110,.12)}",
      ".abg-search-icon{color:var(--mut);display:flex;align-items:center;flex:none}",
      ".abg-search-icon svg{width:15px;height:15px}",
      ".abg-search-input{flex:1;border:none;background:none;font:600 13px var(--f);color:var(--ink);outline:none;padding:0}",
      ".abg-search-input::placeholder{color:var(--mut);font-weight:400}",
      ".abg-search-clear{border:none;background:rgba(0,0,0,.08);color:var(--mut);width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}",
      "body.dark .abg-search-clear{background:rgba(255,255,255,.14)}",
      ".abg-search-clear svg{width:11px;height:11px}",
      ".abg-filter-pills{display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:3px}",
      ".abg-filter-pills::-webkit-scrollbar{display:none}",
      ".abg-filter-pill{white-space:nowrap;border:1px solid var(--line);background:var(--panel);color:var(--mut);font:700 11px var(--f);padding:5px 11px;border-radius:20px;cursor:pointer;transition:all .14s;display:inline-flex;align-items:center;gap:5px;flex:none}",
      ".abg-filter-pill:active{transform:scale(.95)}",
      ".abg-filter-pill.active{background:var(--tl);color:#fff;border-color:var(--tl);box-shadow:0 2px 6px rgba(15,118,110,.25)}",
      ".abg-dot{width:6px;height:6px;border-radius:50%;display:inline-block}",
      ".abg-dot.gpc{background:#2563EB}.abg-dot.entero{background:#DC2626}.abg-dot.nonferm{background:#EA580C}.abg-dot.ana{background:#92702A}.abg-dot.aty{background:#475569}",
      ".abg-note{font:500 12px/1.5 var(--f);color:var(--mut);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:10px}",
      ".abg-note b{color:var(--ink)}",
      /* Summary Box */
      ".abg-sum{font:500 13px/1.6 var(--f);color:var(--ink);background:var(--tls);border:1px solid var(--tl);border-radius:14px;padding:12px 14px;margin-bottom:12px;min-height:20px;position:relative;box-shadow:0 2px 8px rgba(15,118,110,.08)}",
      ".abg-sum .abg-hint{color:var(--mut);font-weight:500}",
      ".abg-sum b{font-weight:800}",
      ".abg-clear{position:absolute;top:10px;right:10px;border:none;background:var(--tl);color:#fff;width:24px;height:24px;border-radius:50%;font:700 12px var(--f);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}",
      ".abg-clear svg{width:13px;height:13px}",
      ".abg-sum-header{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:6px;padding-right:26px}",
      ".abg-sum-meta-row{display:flex;align-items:center;gap:6px;margin-bottom:2px}",
      ".abg-cls-badge{font:800 10px var(--f);text-transform:uppercase;letter-spacing:.05em;background:rgba(15,118,110,.12);color:var(--tl);padding:2px 8px;border-radius:6px}",
      "body.dark .abg-cls-badge{background:rgba(20,184,166,.2);color:#2dd4bf}",
      ".abg-gram-badge{font:600 11px var(--f);color:var(--mut)}",
      ".abg-sum-title-text{font:800 16px/1.25 var(--f);color:var(--ink);margin:3px 0 2px}",
      ".abg-sum-title-text.org{font-style:italic}",
      ".abg-sum-note{display:flex;align-items:flex-start;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 11px;font:500 12px/1.45 var(--f);color:var(--ink);margin:8px 0}",
      ".abg-sum-note-ic{color:var(--tl);display:flex;margin-top:1px}.abg-sum-note-ic svg{width:14px;height:14px}",
      ".abg-sum-pathogen-card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin:8px 0 10px;font:500 12px/1.5 var(--f);color:var(--ink)}",
      ".abg-sum-pathogen-intrinsic{display:flex;align-items:flex-start;gap:7px;margin-top:8px;padding:8px 10px;border-radius:8px;background:#FEF2F2;border:1px solid #F87171;color:#991B1B;font:600 11.5px/1.4 var(--f)}",
      "body.dark .abg-sum-pathogen-intrinsic{background:#3B1212;border-color:#991B1B;color:#FCA5A5}",
      ".abg-sum-alert-ic{color:#DC2626;display:flex;margin-top:1px}.abg-sum-alert-ic svg{width:14px;height:14px}",
      ".abg-sum-cov-label{font:700 11.5px var(--f);color:var(--mut);margin:8px 0 4px}",
      ".abg-tags{display:inline-flex;flex-wrap:wrap;gap:6px;vertical-align:middle}",
      ".abg-tags em{font-style:normal;font:700 11px var(--f);background:var(--panel);border:1px solid var(--tl);color:var(--tl);padding:3px 9px;border-radius:999px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;transition:transform .12s}",
      ".abg-tags em:active{transform:scale(.95)}",
      ".abg-tags em.rel{background:var(--panel);border-color:#059669;color:#047857}",
      "body.dark .abg-tags em.rel{background:#0d281e;border-color:#059669;color:#34d399}",
      ".abg-tags em.part{background:#FEF3C7;border-color:#F59E0B;color:#B45309}",
      "body.dark .abg-tags em.part{background:#3a2e0a;border-color:#8a6a1a;color:#fbbf24}",
      ".abg-tag-info{display:inline-flex;align-items:center;opacity:.7}.abg-tag-info svg{width:10px;height:10px}",
      ".abg-tag-arrow{font-style:normal;font-size:9px;font-weight:700;opacity:.8}",
      /* Empty Filter State */
      ".abg-empty-filter{text-align:center;padding:36px 20px;background:var(--panel);border:1px solid var(--line);border-radius:14px;color:var(--mut)}",
      ".abg-empty-filter .abg-empty-ic{color:var(--mut);display:flex;justify-content:center;margin-bottom:8px}",
      ".abg-empty-filter .abg-empty-ic svg{width:32px;height:32px}",
      ".abg-empty-filter b{display:block;font:800 15px var(--f);color:var(--ink);margin-bottom:4px}",
      ".abg-empty-filter p{font:500 12.5px var(--f);margin-bottom:12px}",
      ".abg-reset-filter-btn{border:none;background:var(--tl);color:#fff;font:700 12px var(--f);padding:8px 16px;border-radius:20px;cursor:pointer}",
      /* Grid Table */
      ".abg-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:0 4px 16px rgba(0,0,0,.03)}",
      ".abg-grid{border-collapse:separate;border-spacing:0;font:600 11px var(--f);width:max-content;min-width:100%}",
      ".abg-grid th,.abg-grid td{border-bottom:1px solid var(--line);border-right:1px solid var(--line)}",
      ".abg-rowh{position:sticky;left:0;z-index:2;background:var(--panel);text-align:left;padding:7px 10px;width:38vw;min-width:124px;max-width:154px;vertical-align:middle;box-shadow:2px 0 5px rgba(0,0,0,.02)}",
      ".abg-corner{z-index:4;font:800 11px var(--f);text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}",
      ".abg-cls{display:block;font:800 9px var(--f);text-transform:uppercase;letter-spacing:.05em;color:var(--tl);margin-bottom:1px}",
      ".abg-agent-wrap{display:flex;align-items:center;justify-content:space-between;gap:4px}",
      ".abg-agent-btn{border:none;background:none;padding:0;text-align:left;font:700 12px/1.25 var(--f);color:var(--ink);cursor:pointer;flex:1}",
      ".abg-agent-btn:hover,.abg-agent-btn:active{color:var(--tl);text-decoration:underline}",
      ".abg-drug-link-btn{border:none;background:rgba(15,118,110,.08);color:var(--tl);border-radius:6px;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;transition:all .14s}",
      ".abg-drug-link-btn:active{transform:scale(.92);background:var(--tl);color:#fff}",
      ".abg-drug-link-btn svg{width:11px;height:11px}",
      ".abg-link-arrow{font-size:9px;margin-left:1px;font-weight:700}",
      ".abg-gh{padding:6px 8px;text-align:center;font:800 10px var(--f);text-transform:uppercase;letter-spacing:.04em;color:#fff}",
      ".g-gpc{background:#2563EB}.g-entero{background:#B91C1C}.g-nonferm{background:#C2410C}.g-fast{background:#7E22CE}.g-ana{background:#92702A}.g-aty{background:#475569}.g-gneg{background:#991B1B}",
      ".abg-band-h{font-size:10px;letter-spacing:.07em;border-bottom:1px solid rgba(255,255,255,.25)}",
      ".abg-ch{padding:7px 5px;min-width:58px;max-width:74px;vertical-align:bottom;text-align:center;background:var(--panel)}",
      ".abg-ch-btn{border:none;background:none;padding:0;font:700 9.5px/1.15 var(--f);color:var(--ink);cursor:pointer;word-break:break-word;width:100%}",
      ".abg-ch-btn:hover,.abg-ch-btn:active{color:#2563EB;text-decoration:underline}",
      ".abg-ch.sel{outline:2px solid var(--tl);outline-offset:-2px}",
      ".abg-drow{cursor:pointer;transition:background .12s}",
      ".abg-drow.sel .abg-rowh{background:var(--tls)}",
      ".abg-drow.dim{opacity:.35}",
      /* Grid Cells */
      ".abg-cell{width:56px;min-width:56px;height:34px;text-align:center;background:var(--panel);cursor:pointer;user-select:none;transition:transform .12s,filter .12s}",
      ".abg-cell:active{transform:scale(.88);opacity:.8}",
      ".abg-cell-sym{display:inline-flex;align-items:center;justify-content:center;font-style:normal}",
      ".abg-cell-sym svg{width:12px;height:12px;stroke-width:2.8}",
      ".abg-cell.on{background:linear-gradient(135deg,#059669 0%,#047857 100%);color:#fff}",
      "body.dark .abg-cell.on{background:linear-gradient(135deg,#0D9488 0%,#0F766E 100%)}",
      ".abg-cell.part{background:#FEF3C7;color:#B45309}",
      ".abg-cell.part .abg-cell-sym{font-size:13px;font-weight:800;color:#B45309}",
      "body.dark .abg-cell.part{background:#382606;color:#FCD34D}",
      "body.dark .abg-cell.part .abg-cell-sym{color:#FCD34D}",
      ".abg-cell.no{background:var(--bg);color:var(--mut);opacity:.45}",
      ".abg-cell.no .abg-cell-sym{font-size:11px;font-weight:600;color:var(--mut)}",
      ".abg-cell.hit{box-shadow:inset 0 0 0 2px var(--ink)}",
      /* Legend */
      ".abg-legend{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:10px;font:600 11px var(--f);color:var(--mut)}",
      ".abg-legend .sw{display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid var(--line);vertical-align:-2px;margin-right:5px;background:var(--panel)}",
      ".abg-legend .sw.on{background:#059669;border-color:#059669}",
      ".abg-legend .sw.part{background:#FEF3C7;border-color:#F59E0B}",
      ".abg-legend .sw.no{background:var(--bg);border-color:var(--line)}",
      ".abg-src{margin-left:auto;font-weight:500;font-size:10px}",
      /* Bottom Sheet Common */
      ".abg-sheet-grabber{width:36px;height:4px;border-radius:2px;background:rgba(0,0,0,.2);margin:0 auto 10px;flex:none}",
      "body.dark .abg-sheet-grabber{background:rgba(255,255,255,.24)}",
      ".abg-modal-sheet{position:fixed;inset:0;z-index:960;background:rgba(15,23,42,.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);display:flex;flex-direction:column;justify-content:flex-end;opacity:0;pointer-events:none;transition:opacity .22s cubic-bezier(.2,.8,.2,1)}",
      ".abg-modal-sheet.on{opacity:1;pointer-events:auto}",
      /* Molecule Picker */
      ".abg-picker-card{background:var(--panel);border-radius:22px 22px 0 0;padding:14px 20px calc(24px + env(safe-area-inset-bottom));max-height:80vh;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .24s cubic-bezier(.16,1,.3,1);box-shadow:0 -12px 36px rgba(0,0,0,.25)}",
      ".abg-modal-sheet.on .abg-picker-card{transform:translateY(0)}",
      ".abg-picker-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}",
      ".abg-picker-title{font:800 17px var(--f);color:var(--ink)}",
      ".abg-picker-close{border:none;background:var(--bg);color:var(--ink);width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer}",
      ".abg-picker-close svg{width:15px;height:15px}",
      ".abg-picker-sub{font:500 12px/1.4 var(--f);color:var(--mut);margin-bottom:12px}",
      ".abg-picker-list{display:flex;flex-direction:column;gap:8px;overflow-y:auto}",
      ".abg-picker-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);cursor:pointer;text-align:left;font:700 13.5px var(--f);color:var(--ink);transition:background .15s}",
      ".abg-picker-item:active{background:var(--tls)}",
      ".abg-picker-icon{color:var(--tl);display:flex;align-items:center}.abg-picker-icon svg{width:17px;height:17px}",
      ".abg-picker-name{flex:1}",
      ".abg-picker-arrow{font-size:12px;color:var(--mut);font-weight:700}",
      /* Dossier Card Sheet */
      ".abg-dossier-card{background:var(--panel);border-radius:24px 24px 0 0;max-height:88vh;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .26s cubic-bezier(.16,1,.3,1);box-shadow:0 -12px 36px rgba(0,0,0,.32);overflow:hidden;padding-top:10px}",
      ".abg-modal-sheet.on .abg-dossier-card{transform:translateY(0)}",
      ".abg-dossier-head{padding:14px 18px 14px;color:#fff;position:relative;flex:none;margin-top:2px;border-radius:14px 14px 0 0}",
      ".abg-dossier-meta{display:flex;align-items:center;gap:8px;margin-bottom:4px}",
      ".abg-dossier-badge{font:800 10px var(--f);text-transform:uppercase;letter-spacing:.05em;background:rgba(255,255,255,.24);padding:2px 7px;border-radius:5px}",
      ".abg-dossier-gram{font:600 11px var(--f);opacity:.9}",
      ".abg-dossier-title{font:800 17px/1.3 var(--f);font-style:italic;padding-right:32px}",
      ".abg-dossier-close{position:absolute;top:14px;right:14px;border:none;background:rgba(0,0,0,.2);color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer}",
      ".abg-dossier-close svg{width:15px;height:15px}",
      ".abg-dossier-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 18px calc(24px + env(safe-area-inset-bottom))}",
      ".abg-dossier-alert{background:#FEF2F2;border:1px solid #F87171;border-radius:12px;padding:10px 12px;margin-bottom:14px}",
      "body.dark .abg-dossier-alert{background:#3B1212;border-color:#991B1B}",
      ".abg-dossier-alert-title{display:flex;align-items:center;gap:6px;font:800 12px var(--f);color:#B91C1C;margin-bottom:3px}",
      ".abg-dossier-alert-title svg{width:14px;height:14px}",
      "body.dark .abg-dossier-alert-title{color:#FCA5A5}",
      ".abg-dossier-alert-text{font:600 11.5px/1.45 var(--f);color:#7F1D1D}",
      "body.dark .abg-dossier-alert-text{color:#FECACA}",
      ".abg-dossier-section{margin-bottom:14px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 14px}",
      ".abg-dossier-sec-h{display:flex;align-items:center;gap:6px;font:800 12px var(--f);text-transform:uppercase;letter-spacing:.04em;color:var(--tl);margin-bottom:6px}",
      ".abg-dossier-sec-h svg{width:13px;height:13px}",
      ".abg-dossier-sec-p{font:500 12.5px/1.55 var(--f);color:var(--ink)}",
      ".abg-dossier-section.pearls{background:var(--tls);border-color:var(--tl)}",
      ".abg-dossier-section.pearls .abg-dossier-sec-h{color:var(--tl)}",
      ".abg-dossier-regimens{display:flex;flex-direction:column;gap:8px}",
      ".abg-dossier-reg-item{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 10px}",
      ".abg-dossier-reg-ind{font:700 12px var(--f);color:var(--ink);margin-bottom:2px}",
      ".abg-dossier-reg-drug{font:500 11.5px/1.4 var(--f);color:#047857}",
      "body.dark .abg-dossier-reg-drug{color:#34D399}",
      ".abg-dossier-reg-drug b{font-weight:700}",
      ".abg-dossier-reg-alt{font:500 11px/1.4 var(--f);color:var(--mut);margin-top:2px}",
      ".abg-dossier-reg-alt b{font-weight:700}",
      ".abg-dossier-actions{display:flex;gap:10px;margin-top:16px}",
      ".abg-dossier-btn-isolate{flex:1;border:1px solid var(--tl);background:var(--tls);color:var(--tl);font:700 13px var(--f);padding:11px 12px;border-radius:11px;cursor:pointer}",
      ".abg-dossier-btn-done{flex:1;border:none;background:var(--tl);color:#fff;font:700 13px var(--f);padding:11px 12px;border-radius:11px;cursor:pointer}",
      ".abg-dossier-head.g-drug{background:linear-gradient(135deg,#0F766E 0%,#115E59 100%)}",
      ".abg-multi-molecules{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:6px 0 12px}",
      ".abg-multi-lbl{font:700 11px var(--f);color:var(--mut);display:block;margin-bottom:6px}",
      ".abg-multi-btns{display:flex;flex-wrap:wrap;gap:6px}",
      ".abg-multi-btn{display:inline-flex;align-items:center;gap:5px;background:var(--panel);border:1px solid var(--line);color:var(--tl);font:600 12px var(--f);padding:5px 9px;border-radius:7px;cursor:pointer}",
      ".abg-multi-btn:active{background:var(--tls)}",
      ".abg-multi-btn svg{width:12px;height:12px}",
      ".abg-cov-group-lbl{font:700 11.5px var(--f);color:var(--mut);margin:8px 0 4px}",
      /* Hero CTA Buttons */
      ".abg-know-more-hero{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;background:linear-gradient(135deg,#0F766E 0%,#115E59 100%);color:#fff;font:700 13px var(--f);padding:11px 14px;border:none;border-radius:12px;margin:8px 0;cursor:pointer;box-shadow:0 3px 10px rgba(15,118,110,.25);transition:all .15s}",
      ".abg-know-more-hero:active{transform:scale(.98);filter:brightness(.95)}",
      ".abg-know-more-hero svg{width:15px;height:15px}",
      ".abg-dossier-hero-btn{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);color:#fff;font:700 13px var(--f);padding:11px 14px;border:none;border-radius:12px;margin:8px 0;cursor:pointer;box-shadow:0 3px 10px rgba(37,99,235,.25);transition:all .15s}",
      ".abg-dossier-hero-btn:active{transform:scale(.98);filter:brightness(.95)}",
      ".abg-dossier-hero-btn svg{width:15px;height:15px}",
      /* Cell Action Modal */
      ".abg-cell-action-card{background:var(--panel);border-radius:24px 24px 0 0;padding:12px 20px calc(24px + env(safe-area-inset-bottom));max-height:80vh;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .24s cubic-bezier(.16,1,.3,1);box-shadow:0 -12px 36px rgba(0,0,0,.3)}",
      ".abg-modal-sheet.on .abg-cell-action-card{transform:translateY(0)}",
      ".abg-cell-action-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}",
      ".abg-cell-action-title{font:800 16px var(--f);color:var(--ink)}",
      ".abg-cell-banner{padding:10px 12px;border-radius:12px;font:700 12.5px/1.4 var(--f);margin-bottom:14px;display:flex;align-items:center;gap:8px}",
      ".abg-cell-banner.on{background:#ECFDF5;border:1px solid #10B981;color:#047857}",
      "body.dark .abg-cell-banner.on{background:#064E3B;border-color:#059669;color:#6EE7B7}",
      ".abg-cell-banner.part{background:#FFFBEB;border:1px solid #F59E0B;color:#B45309}",
      "body.dark .abg-cell-banner.part{background:#78350F;border-color:#D97706;color:#FDE68A}",
      ".abg-cell-banner.no{background:#FEF2F2;border:1px solid #EF4444;color:#B91C1C}",
      "body.dark .abg-cell-banner.no{background:#7F1D1D;border-color:#DC2626;color:#FCA5A5}",
      ".abg-cell-banner svg{width:15px;height:15px;flex:none}",
      ".abg-cell-actions{display:flex;flex-direction:column;gap:9px}",
      ".abg-cell-btn-dossier{display:flex;align-items:center;justify-content:center;gap:7px;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);color:#fff;font:700 13px var(--f);padding:11px 14px;border:none;border-radius:11px;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.2)}",
      ".abg-cell-btn-dossier:active{transform:scale(.98);filter:brightness(.95)}",
      ".abg-cell-btn-dossier svg{width:15px;height:15px}",
      ".abg-cell-btn-drug{display:flex;align-items:center;justify-content:center;gap:7px;background:linear-gradient(135deg,#0F766E 0%,#115E59 100%);color:#fff;font:700 13px var(--f);padding:11px 14px;border:none;border-radius:11px;cursor:pointer;box-shadow:0 2px 8px rgba(15,118,110,.2)}",
      ".abg-cell-btn-drug:active{transform:scale(.98);filter:brightness(.95)}",
      ".abg-cell-btn-drug svg{width:15px;height:15px}",
      /* Resistance View */
      ".abg-srcbar{display:flex;align-items:center;gap:10px;margin-bottom:12px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px 12px}",
      ".abg-srclab{font:800 11px var(--f);text-transform:uppercase;letter-spacing:.06em;color:var(--mut);display:flex;align-items:center;gap:5px}",
      ".abg-srclab-ic svg{width:14px;height:14px;color:var(--tl)}",
      ".abg-srcsel{flex:1;border:none;background:none;color:var(--ink);font:700 13px var(--f);padding:4px 0;outline:none;cursor:pointer}",
      ".abg-warn{font:500 12px/1.5 var(--f);color:var(--ink);background:#FEF3C7;border:1px solid #F59E0B;border-radius:12px;padding:10px 12px;margin-bottom:12px}",
      "body.dark .abg-warn{background:#3a2e0a;border-color:#a3791d;color:#f5e6bd}",
      ".abg-warn b{color:#B45309}body.dark .abg-warn b{color:#fbbf24}",
      ".abg-oc{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.02)}",
      ".abg-oc-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding-bottom:8px;margin-bottom:6px;border-bottom:1px solid var(--line)}",
      ".abg-oc-n{font:800 15px var(--f);font-style:italic;color:var(--ink)}",
      ".abg-oc-m{font:600 10.5px var(--f);color:var(--mut);white-space:nowrap}",
      ".abg-dr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0}",
      ".abg-dr-n{font:600 13px var(--f);color:var(--ink)}",
      ".abg-dr-v{display:inline-flex;align-items:center;gap:7px;flex-shrink:0}",
      ".abg-dr-q{font:600 11.5px var(--f);color:var(--mut);text-align:right;max-width:58%}",
      ".abg-pill{font:800 12px var(--f);color:#fff;padding:3px 9px;border-radius:999px;min-width:52px;text-align:center}",
      ".su4{background:#047857}.su3{background:#65a30d}.su2{background:#D97706}.su1{background:#EA580C}.su0{background:#B91C1C}",
      ".abg-trend{font:800 10px var(--f);padding:1px 4px;border-radius:5px}",
      ".abg-trend.up{color:#047857;background:rgba(4,120,87,.12)}",
      ".abg-trend.down{color:#B91C1C;background:rgba(185,28,28,.12)}",
      ".abg-dr-note{font:500 11px/1.4 var(--f);color:var(--mut);padding:0 0 4px 2px}",
      ".abg-prov{font-style:normal;color:var(--tl);font-size:11px;opacity:.65;margin-left:3px}",
      ".abg-dr-prov{cursor:pointer}",
      ".abg-legend.heat .hs{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:5px}",
      ".abg-oc-n-btn{display:inline-flex;align-items:center;gap:8px;border:none;background:none;padding:0;cursor:pointer;text-align:left}",
      ".abg-oc-badge{display:inline-flex;align-items:center;gap:3px;font:700 10px var(--f);background:rgba(37,99,235,.12);color:#2563EB;padding:2px 7px;border-radius:6px}",
      ".abg-oc-badge svg{width:10px;height:10px}",
      "body.dark .abg-oc-badge{background:rgba(59,130,246,.25);color:#93C5FD}",
      ".abg-dr-n-btn{display:inline-flex;align-items:center;gap:4px;border:none;background:none;padding:0;cursor:pointer;text-align:left;font:600 13px var(--f);color:var(--ink)}",
      ".abg-dr-n-btn:active{color:var(--tl)}",
      ".abg-dr-link-arrow{font-size:10px;color:var(--tl);font-weight:700;opacity:.65}",
      /* System Toasts & Rotate Hint */
      ".abg-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%) translateY(10px);background:#0F172A;color:#fff;font:600 13px var(--f);padding:11px 18px;border-radius:12px;z-index:970;opacity:0;transition:.2s;pointer-events:none;max-width:88vw;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.3)}",
      ".abg-toast.on{opacity:1;transform:translateX(-50%)}",
      /* Rotate Hint — Apple Dynamic Island capsule */
      ".abg-rotate{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%) translateY(-60px) scale(.85);display:flex;flex-direction:column;align-items:stretch;background:#1C1C1E;border-radius:22px;z-index:990;opacity:0;transition:opacity .35s cubic-bezier(.4,.0,.2,1),transform .5s cubic-bezier(.175,.885,.32,1.275);max-width:88vw;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.35),0 0 0 .5px rgba(255,255,255,.08) inset;cursor:pointer;-webkit-tap-highlight-color:transparent;will-change:transform,opacity}",
      ".abg-rotate.on{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}",
      ".abg-rotate-pill{display:flex;align-items:center;gap:10px;padding:11px 16px 9px}",
      ".abg-rotate-phone{width:20px;height:20px;color:rgba(255,255,255,.9);flex:none;animation:abgPhoneRock 2s ease-in-out infinite}",
      ".abg-rotate-arrow{opacity:.7}",
      "@keyframes abgPhoneRock{0%,100%{transform:rotate(0)}25%{transform:rotate(-20deg)}50%{transform:rotate(0)}75%{transform:rotate(20deg)}}",
      ".abg-rotate-tx{font:600 13.5px/1 -apple-system,BlinkMacSystemFont,var(--f);color:rgba(255,255,255,.92);letter-spacing:-.01em;white-space:nowrap}",
      ".abg-rotate-progress{height:3px;background:rgba(255,255,255,.08);border-radius:0 0 22px 22px;overflow:hidden}",
      ".abg-rotate-bar{height:100%;width:100%;background:rgba(255,255,255,.28);border-radius:0 0 22px 22px;animation:abgBar 4s linear forwards}",
      "@keyframes abgBar{from{width:100%}to{width:0%}}",
      /* Drug DB Overlay Integration */
      ".db-overlay{position:fixed;inset:0;z-index:1000!important;background:var(--paper,#f7f7f5);display:none;flex-direction:column;overflow:hidden}",
      ".db-overlay.on{display:flex!important;z-index:1000!important}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  window.ABG = { open: open, close: close, _data: { COVERAGE: COVERAGE, COLS: COLS } };
})();
