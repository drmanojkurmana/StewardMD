/* StewardMD - Antibiogram & Antibiotic-Coverage explorer (standalone full-page module).
   Self-contained overlay; window.ABG.open() / window.ABG.close().
   TWO tabs:
     • Resistance - pick a source (ICMR 2024 national / a local hospital antibiogram) and
       read organism × antibiotic resistance rates as a colour-coded heatmap.
     • Coverage   - an interactive spectrum-of-activity grid (drug class × organism group);
       tap a drug or an organism to see, at a glance, what covers what.

   EDUCATIONAL DECISION SUPPORT ONLY. Coverage is qualitative spectrum of activity.
   Resistance figures are INDICATIVE and MUST be verified against the current ICMR AMRSN
   report and your own local antibiogram before any clinical use. Does not touch clinical
   reasoning, patient storage, secrets or Cloudflare bindings. */
(function () {
  "use strict";

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
    { cls: "Aminopenicillin + BLI", agent: "Amoxicillin-clavulanate",
      cov: { mssa:2, strep:2, efaecalis:2, ecoli:1, kleb:2, pmir:2, hflu:2, morax:2, oralana:2, bfrag:2 } },
    { cls: "Aminopenicillin + BLI", agent: "Ampicillin-sulbactam",
      cov: { mssa:2, strep:2, efaecalis:2, ecoli:1, kleb:2, pmir:2, hflu:2, bfrag:2, oralana:2, acineto:1 }, note: "Sulbactam has intrinsic Acinetobacter activity." },
    { cls: "Antipseudomonal penicillin + BLI", agent: "Piperacillin-tazobactam",
      cov: { mssa:2, strep:2, efaecalis:2, ecoli:2, kleb:2, pmir:2, escappm:1, pseud:2, hflu:2, bfrag:2, oralana:2, esbl:1 }, note: "Avoid for ESBL bacteraemia (MERINO). AmpC induction risk." },
    { cls: "Cephalosporin + sulbactam", agent: "Cefoperazone-sulbactam",
      cov: { ecoli:2, kleb:2, pmir:2, escappm:1, pseud:1, acineto:2, bfrag:1, esbl:1 }, note: "Widely used in India for MDR GNB / Acinetobacter - confirm susceptibility." },
    { cls: "Cephalosporin + novel BLI", agent: "Ceftazidime-avibactam",
      cov: { ecoli:2, kleb:2, escappm:2, pseud:2, esbl:2, cre:2 }, note: "CRE: KPC & OXA-48 - NOT metallo-β-lactamase (NDM/VIM). Add aztreonam for MBL." },
    { cls: "Cephalosporin + novel BLI", agent: "Ceftolozane-tazobactam",
      cov: { ecoli:2, kleb:2, escappm:1, pseud:2, esbl:2 }, note: "Best-in-class for MDR Pseudomonas. Not reliable for CRE." },
    { cls: "Carbapenem + novel BLI", agent: "Meropenem-vaborbactam",
      cov: { ecoli:2, kleb:2, escappm:2, pseud:1, esbl:2, cre:2 }, note: "CRE: KPC. Not MBL / OXA-48." },
    { cls: "Carbapenem + novel BLI", agent: "Imipenem-relebactam",
      cov: { ecoli:2, kleb:2, escappm:2, pseud:2, esbl:2, cre:2 }, note: "CRE: KPC. Not MBL." },
    { cls: "Monobactam + novel BLI", agent: "Aztreonam-avibactam",
      cov: { ecoli:2, kleb:2, escappm:2, esbl:2, cre:2 }, note: "Covers metallo-β-lactamase (NDM) producers - key MBL-CRE option." },
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
      cov: { ecoli:1, kleb:1, pmir:1, pseud:2, escappm:1 }, note: "Poor Gram-positive. AmpC-labile - unreliable vs ESCAPPM." },
    { cls: "4th-gen cephalosporin", agent: "Cefepime",
      cov: { mssa:2, strep:2, ecoli:2, kleb:2, pmir:2, escappm:2, pseud:2, hflu:2 }, note: "AmpC-stable (ESCAPPM). ESBL variable - inoculum effect." },
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
      cov: { mrsa:2, mssa:2, strep:2, efaecalis:2, efaecium:2 }, note: "NOT for pneumonia - inactivated by lung surfactant. Covers VRE." },
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
      cov: { mrsa:2, mssa:2, strep:2, efaecalis:2, efaecium:2, ecoli:2, kleb:2, escappm:2, esbl:2, cre:1, acineto:2, bfrag:2, oralana:2, steno:1 }, note: "Very broad EXCEPT Pseudomonas & Proteus. Low serum levels - avoid bloodstream infection." },
    // ── Polymyxins ─────────────────────────────────────────────────────────
    { cls: "Polymyxin", agent: "Colistin / Polymyxin B",
      cov: { ecoli:2, kleb:2, pseud:2, acineto:2, esbl:2, cre:2 }, note: "Last-resort GNB. Intrinsic resistance: Proteus, Serratia, Providencia, Morganella, Burkholderia. No GPC/anaerobes. Nephrotoxic." },
    // ── Folate / urinary / anaerobe / misc ─────────────────────────────────
    { cls: "Folate antagonist", agent: "Co-trimoxazole (TMP-SMX)",
      cov: { mrsa:2, mssa:2, strep:1, ecoli:1, kleb:1, pmir:1, escappm:1, hflu:2, steno:2, listeria:2 }, note: "First-line for Stenotrophomonas, Nocardia, PCP. No Pseudomonas / anaerobes / enterococci." },
    { cls: "Nitrofuran (urinary)", agent: "Nitrofurantoin",
      cov: { ecoli:2, efaecalis:2, kleb:1 }, note: "Uncomplicated cystitis only - no tissue levels. Not Proteus/Pseudomonas/Serratia. Avoid CrCl <30." },
    { cls: "Phosphonic acid", agent: "Fosfomycin",
      cov: { ecoli:2, efaecalis:2, kleb:1, esbl:2, pseud:1 }, note: "PO (trometamol) for MDR cystitis incl. ESBL; IV form broader." },
    { cls: "Nitroimidazole", agent: "Metronidazole",
      cov: { bfrag:2, oralana:2 }, note: "Anaerobes only (+ C. difficile, amoebae, Giardia). No aerobes; no Actinomyces/Propionibacterium." },
    { cls: "Amphenicol", agent: "Chloramphenicol",
      cov: { strep:2, nmen:2, hflu:2, bfrag:2, oralana:2, atyp:1 }, note: "Reserve - marrow toxicity. Broad but rarely used." },
    { cls: "Rifamycin (adjunct)", agent: "Rifampicin",
      cov: { mrsa:1, mssa:1, strep:1 }, note: "NEVER monotherapy (rapid resistance). Biofilm/prosthetic adjunct; meningococcal prophylaxis." },
    { cls: "Macrocyclic (C. difficile)", agent: "Fidaxomicin",
      cov: {}, note: "C. difficile only (narrow-spectrum, gut-selective)." }
  ];

  /* ─────────────────────────  RESISTANCE DATA  ─────────────────────────
     Uses the app's existing, sourced antibiogram (window.ASP_ABG) - the same
     ICMR AMRSN 2024 national + GIMSR hospital dataset shown in the references
     panel. Values are % SUSCEPTIBLE (higher = better); some cells are qualitative
     only. No numbers are invented here - this view just reads that data. */
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

  /* ───────────────────────────  STATE / DOM  ─────────────────────────── */
  var root = null, tab = "coverage", covSel = null, covSelType = null, srcKey = "national", tEl, tTimer;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

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
    else hideRotateHint();   // rotated to landscape - the hint has done its job
  }
  function showRotateHint() {
    if (!root || root.querySelector("#abgRotate")) return;
    var h = document.createElement("div");
    h.className = "abg-rotate"; h.id = "abgRotate";
    h.innerHTML = '<span class="abg-rotate-ic">🔄</span><span class="abg-rotate-tx">Rotate your phone for a wider view of the grid.</span><button class="abg-rotate-x" data-act="rotate-dismiss" aria-label="Dismiss">✕</button>';
    root.appendChild(h);
    requestAnimationFrame(function () { h.classList.add("on"); });
    h.addEventListener("click", function (e) { if (e.target.closest("[data-act='rotate-dismiss']")) hideRotateHint(); });
  }
  function hideRotateHint() {
    var h = root && root.querySelector("#abgRotate");
    if (!h) return;
    h.classList.remove("on");
    setTimeout(function () { if (h && h.parentNode) h.parentNode.removeChild(h); }, 220);
  }

  function shell() {
    return '' +
      '<div class="abg-top">' +
        '<button class="abg-back" data-act="close" aria-label="Back">‹ Back</button>' +
        '<div class="abg-ttl">Antibiogram</div>' +
      '</div>' +
      '<div class="abg-tabs" role="tablist">' +
        '<button class="abg-tab" data-tab="coverage" role="tab">Antibiotic coverage</button>' +
        '<button class="abg-tab" data-tab="resistance" role="tab">Resistance rates</button>' +
      '</div>' +
      '<div class="abg-body" id="abgBody"></div>';
  }

  /* ───────────────────────────  RENDER  ─────────────────────────── */
  function render() {
    [].forEach.call(root.querySelectorAll(".abg-tab"), function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === tab); });
    var body = root.querySelector("#abgBody");
    body.innerHTML = tab === "coverage" ? coverageView() : resistanceView();
    body.scrollTop = 0;
  }

  /* Coverage grid + interactive summary */
  function coverageView() {
    var h = '<div class="abg-note">Spectrum of activity - a teaching guide, <b>not</b> a substitute for susceptibility testing or your local antibiogram. Tap a drug or an organism to isolate it.</div>';

    // interactive summary bar
    h += '<div class="abg-sum" id="abgSum">' + coverageSummary() + '</div>';

    // scrollable grid
    h += '<div class="abg-scroll"><table class="abg-grid"><thead>';
    // group header row
    h += '<tr class="abg-grp"><th class="abg-rowh abg-corner" rowspan="2">Antibiotic</th>';
    GROUPS.forEach(function (g) { h += '<th class="abg-gh g-' + g.id + '" colspan="' + g.cols.length + '">' + esc(g.name) + '</th>'; });
    h += '</tr><tr class="abg-orgh">';
    COLS.forEach(function (c) {
      var on = (covSelType === "org" && covSel === c.id) ? " sel" : "";
      h += '<th class="abg-ch g-' + c.group + on + '" data-org="' + c.id + '"><span>' + esc(c.label) + '</span></th>';
    });
    h += '</tr></thead><tbody>';
    var lastCls = null;
    COVERAGE.forEach(function (d, i) {
      var rowOn = (covSelType === "drug" && covSel === i) ? " sel" : "";
      var dim = covSel !== null && !rowOn && covSelType === "drug" ? " dim" : "";
      var newCls = d.cls !== lastCls; lastCls = d.cls;
      h += '<tr class="abg-drow' + rowOn + dim + '" data-drug="' + i + '">';
      h += '<td class="abg-rowh">' + (newCls ? '<span class="abg-cls">' + esc(d.cls) + '</span>' : '') + '<span class="abg-agent">' + esc(d.agent) + '</span></td>';
      COLS.forEach(function (c) {
        var st = (d.cov && d.cov[c.id]) || 0;   // 2 = reliable · 1 = variable · 0 = not active
        var hl = "";
        if (covSelType === "org" && covSel === c.id) hl = " col";
        if ((covSelType === "org" && covSel === c.id) || (covSelType === "drug" && covSel === i)) hl += " hit";
        var cls = st === 2 ? "on" : st === 1 ? "part" : "no";
        var sym = st === 2 ? "✓" : st === 1 ? "◐" : "✕";   // ✓ active (green) · ◐ variable (amber hatch on light green) · ✕ not active (red)
        h += '<td class="abg-cell ' + cls + hl + '"><i>' + sym + '</i></td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="abg-legend"><span><i class="sw on"></i>Reliably active</span><span><i class="sw part"></i>Variable / not first-line</span><span><i class="sw no"></i>Not active</span><span class="abg-src">Spectrum reference - verify against your local antibiogram · Sanford / IDSA / CLSI M100 (2024)</span></div>';
    return h;
  }

  function coverageSummary() {
    if (covSel === null) return '<span class="abg-hint">Nothing selected - showing the full spectrum grid.</span>';
    if (covSelType === "drug") {
      var d = COVERAGE[covSel];
      var keys = Object.keys(d.cov).sort(function (a, b) { return (d.cov[b] || 0) - (d.cov[a] || 0); });   // reliable (2) first
      return '<button class="abg-clear" data-act="clearcov">✕</button><b>' + esc(d.agent) + '</b> covers: ' +
        (keys.length ? '<span class="abg-tags">' + keys.map(function (id) { return '<em class="' + (d.cov[id] === 1 ? "part" : "") + '">' + esc(colLabel(id)) + '</em>'; }).join("") + '</span>' : '-') +
        (d.note ? '<span class="abg-note-sm">' + esc(d.note) + '</span>' : '');
    }
    // org selected - any tier active, reliable (2) listed first
    var hits = COVERAGE.filter(function (x) { return x.cov[covSel]; }).sort(function (a, b) { return (b.cov[covSel] || 0) - (a.cov[covSel] || 0); });
    return '<button class="abg-clear" data-act="clearcov">✕</button><b>' + esc(colLabel(covSel)) + '</b> is covered by: ' +
      (hits.length ? '<span class="abg-tags">' + hits.map(function (x) { return '<em class="' + (x.cov[covSel] === 1 ? "part" : "") + '">' + esc(x.agent) + '</em>'; }).join("") + '</span>' : '-');
  }
  function colLabel(id) { for (var i = 0; i < COLS.length; i++) if (COLS[i].id === id) return COLS[i].label; return id; }

  /* Resistance rates - % RESISTANT (= 100 - %susceptible) from the ACTIVE profile
     (region composite / individual study / hospital / ICMR national). Data is stored as
     % susceptible; we invert only at display. Missing cells render "-". No invented values. */
  function resistanceView() {
    var src = abgData();
    if (!src || !src.org || !Object.keys(src.org).length)
      return '<div class="abg-empty"><div class="abg-empty-ic">📊</div><b>Antibiogram unavailable</b><p>The susceptibility dataset has not loaded yet, or this profile has no antibiogram. Reopen this screen in a moment.</p></div>';

    var curId = (window.HOSPITAL && window.HOSPITAL.current) ? window.HOSPITAL.current().id : "ICMR";
    var h = '<div class="abg-srcbar"><label class="abg-srclab">Source</label>' +
      '<select class="abg-srcsel" id="abgSrc" aria-label="Antibiogram source">' + sourceOptions(curId) + '</select></div>';

    h += '<div class="abg-warn"><b>' + (src.dated ? "Dated source." : (src.composite ? "Regional best-of composite." : "Reference data.")) + '</b> ' + esc(src.source || "") +
      (src.note ? ' - ' + esc(src.note) : '') + ' <b>Shown as % of isolates resistant.</b> Verify against your own local antibiogram before clinical use.</div>';

    var orgs = src.org || {};
    Object.keys(orgs).forEach(function (name) {
      var o = orgs[name], drugs = o.d || {};
      var meta = [];
      if (o.n != null) meta.push(o.n + " isolates");
      if (o.specimen) meta.push(esc(o.specimen));
      h += '<div class="abg-oc"><div class="abg-oc-h"><span class="abg-oc-n">' + esc(name) + '</span>' +
        (meta.length ? '<span class="abg-oc-m">' + meta.join(" · ") + '</span>' : '') + '</div><div class="abg-oc-rows">';
      Object.keys(drugs).forEach(function (k) {
        var v = drugs[k], s = v.s;
        var prov = v.src ? ' data-org="' + esc(name) + '" data-drug="' + esc(k) + '"' : '';
        h += '<div class="abg-dr' + (v.src ? ' abg-dr-prov' : '') + '"' + prov + '><span class="abg-dr-n">' + esc(drugLabel(k)) + (v.src ? ' <i class="abg-prov" title="tap for source">ⓘ</i>' : '') + '</span>';
        if (s == null) {
          h += '<span class="abg-dr-q">' + esc(v.q || "-") + '</span>';
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

    h += '<div class="abg-legend heat"><span><i class="hs su0"></i>≥70%</span><span><i class="hs su1"></i>50-69%</span><span><i class="hs su2"></i>25-49%</span><span><i class="hs su3"></i>10-24%</span><span><i class="hs su4"></i>&lt;10%</span><span>% resistant (red = worse)</span></div>';
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
      if (c) h += opt(c.id, (c.short || rr[1]) + " - regional composite (best-of)");
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
  // Trend on RESISTANCE: input is a %-susceptible series, so ΔR = -ΔS.
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
      var b = e.target.closest("[data-act],[data-tab],[data-drug],[data-org]");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "close") return close();
      if (act === "clearcov") { covSel = null; covSelType = null; return render(); }
      var t = b.getAttribute("data-tab");
      if (t) { tab = t; return render(); }
      if (tab === "coverage") {
        if (b.classList.contains("abg-ch") && b.hasAttribute("data-org")) {
          var oid = b.getAttribute("data-org");
          if (covSelType === "org" && covSel === oid) { covSel = null; covSelType = null; }
          else { covSel = oid; covSelType = "org"; }
          return render();
        }
        var dr = b.closest("[data-drug]");
        if (dr && dr.classList.contains("abg-drow")) {
          var di = +dr.getAttribute("data-drug");
          if (covSelType === "drug" && covSel === di) { covSel = null; covSelType = null; }
          else { covSel = di; covSelType = "drug"; }
          return render();
        }
      }
      if (tab === "resistance") {   // tap a cell with provenance → show its source study
        var pr = b.closest(".abg-dr-prov[data-drug]");
        if (pr) {
          var src = abgData(), o = src && src.org && src.org[pr.getAttribute("data-org")];
          var c = o && o.d && o.d[pr.getAttribute("data-drug")];
          if (c && c.src) toast(drugLabel(pr.getAttribute("data-drug")) + " · " + pr.getAttribute("data-org") + " - source: " + srcLabel(c.src));
          return;
        }
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
      ".abg{--bg:#F4F6F9;--panel:#fff;--ink:#0F172A;--mut:#64748B;--line:#E2E8F0;--tl:var(--teal,#0F766E);--tls:var(--teal-soft,#CCFBF1);--f:'Inter',-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;position:fixed;inset:0;z-index:950;background:var(--bg);color:var(--ink);font-family:var(--f);display:flex;flex-direction:column;opacity:0;transform:translateY(8px);transition:opacity .22s,transform .22s;pointer-events:none}",
      ".abg.on{opacity:1;transform:none;pointer-events:auto}",
      "body.dark .abg{--bg:#0A0F1A;--panel:#101827;--ink:#E6EAF2;--mut:#8A94A6;--line:#1E2B43;--tls:#0d3b36}",
      ".abg-top{display:flex;align-items:center;gap:10px;padding:calc(14px + env(safe-area-inset-top)) 16px 14px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:2}",
      ".abg-back{border:none;background:none;color:var(--tl);font:700 15px var(--f);cursor:pointer;padding:6px 6px;border-radius:8px}",
      ".abg-ttl{font:800 18px var(--f);letter-spacing:-.01em}",
      ".abg-tabs{display:flex;gap:4px;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:53px;z-index:2}",
      ".abg-tab{flex:1;border:1px solid var(--line);background:var(--bg);color:var(--mut);font:700 13px var(--f);padding:10px 8px;border-radius:11px;cursor:pointer;transition:.15s}",
      ".abg-tab.on{background:var(--tl);color:#fff;border-color:var(--tl)}",
      ".abg-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:14px 16px calc(28px + env(safe-area-inset-bottom))}",
      ".abg-note{font:500 12.5px/1.5 var(--f);color:var(--mut);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:12px}",
      ".abg-note b{color:var(--ink)}",
      ".abg-sum{font:500 13px/1.6 var(--f);color:var(--ink);background:var(--tls);border:1px solid var(--tl);border-radius:12px;padding:10px 12px;margin-bottom:12px;min-height:20px;position:relative}",
      ".abg-sum .abg-hint{color:var(--mut);font-weight:500}",
      ".abg-sum b{font-weight:800}",
      ".abg-tags{display:inline-flex;flex-wrap:wrap;gap:5px;margin-left:2px;vertical-align:middle}",
      ".abg-tags em{font-style:normal;font:700 11px var(--f);background:var(--panel);border:1px solid var(--tl);color:var(--tl);padding:2px 8px;border-radius:999px}",
      ".abg-tags em.part{background:var(--warn-soft,#fbf0dd);border-color:#e0b978;color:var(--warn,#b5720a)}",
      "body.dark .abg-tags em.part{background:#3a2e0a;border-color:#8a6a1a;color:#fbbf24}",
      ".abg-note-sm{display:block;margin-top:6px;font:500 11.5px/1.5 var(--f);color:var(--mut)}",
      ".abg-clear{position:absolute;top:8px;right:8px;border:none;background:var(--tl);color:#fff;width:22px;height:22px;border-radius:999px;font:700 12px var(--f);cursor:pointer;line-height:1}",
      ".abg-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px;background:var(--panel)}",
      ".abg-grid{border-collapse:separate;border-spacing:0;font:600 11px var(--f);width:max-content;min-width:100%}",
      ".abg-grid th,.abg-grid td{border-bottom:1px solid var(--line);border-right:1px solid var(--line)}",
      ".abg-rowh{position:sticky;left:0;z-index:1;background:var(--panel);text-align:left;padding:7px 9px;width:38vw;min-width:120px;max-width:150px;vertical-align:middle}",
      ".abg-corner{z-index:3}",
      ".abg-cls{display:block;font:800 9.5px var(--f);text-transform:uppercase;letter-spacing:.05em;color:var(--tl);margin-bottom:1px}",
      ".abg-agent{display:block;font:600 12px/1.25 var(--f);color:var(--ink)}",
      ".abg-agent.org{font-weight:700;font-style:italic}",
      ".abg-gh{padding:6px 8px;text-align:center;font:800 10px var(--f);text-transform:uppercase;letter-spacing:.04em;color:#fff}",
      ".g-gpc{background:#2563EB}.g-gnb{background:#B91C1C}.g-gnc{background:#7E22CE}.g-ana{background:#92702a}.g-aty{background:#475569}",
      ".abg-orgh th{top:0}",
      ".abg-ch{padding:6px 5px;min-width:56px;max-width:70px;vertical-align:bottom;text-align:center;background:var(--panel)}",
      ".abg-ch span{display:block;font:700 9.5px/1.15 var(--f);color:var(--ink);word-break:break-word}",
      ".abg-ch.g-gpc,.abg-ch.g-gnb,.abg-ch.g-gnc,.abg-ch.g-ana,.abg-ch.g-aty{background:var(--panel)}",
      ".abg-ch.sel{outline:2px solid var(--tl);outline-offset:-2px}",
      ".abg-ch[data-org]{cursor:pointer}",
      ".abg-drow{cursor:pointer}",
      ".abg-drow.sel .abg-rowh{background:var(--tls)}",
      ".abg-drow.dim{opacity:.4}",
      ".abg-cell{width:56px;min-width:56px;height:32px;text-align:center;background:var(--panel)}",
      ".abg-cell i{font-style:normal;font:800 12px var(--f);color:#fff;opacity:.92}",
      ".abg-cell.on{background:#059669}",
      ".abg-cell.off{background:#E15B64}",
      "body.dark .abg-cell.on{background:#0e7a5f}body.dark .abg-cell.off{background:#a83b43}",
      ".abg-cell.hit{outline:2px solid var(--ink);outline-offset:-2px}",
      ".abg-cell.hit i{opacity:1}",
      ".abg-legend{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:10px;font:600 11px var(--f);color:var(--mut)}",
      ".abg-legend .sw{display:inline-block;width:13px;height:13px;border-radius:3px;border:1px solid var(--line);vertical-align:-2px;margin-right:5px;background:var(--panel)}",
      ".abg-legend .sw.on{background:#059669;border-color:#059669}",
      ".abg-legend .sw.off{background:#E15B64;border-color:#E15B64}",
      // 3-tier cell: reliable (solid green ✓) · variable (amber hatch on LIGHT GREEN ◐) · not active (red ✕)
      ".abg-cell.part{background-color:var(--green-bg,#e7f5ec);background-image:repeating-linear-gradient(45deg,rgba(181,114,10,.5),rgba(181,114,10,.5) 4px,transparent 4px,transparent 8px)}",
      ".abg-cell.part i{color:#8a5a0a;opacity:1;font-size:13px}",
      "body.dark .abg-cell.part{background-color:#0f3a2f;background-image:repeating-linear-gradient(45deg,rgba(240,192,96,.45),rgba(240,192,96,.45) 4px,transparent 4px,transparent 8px)}",
      "body.dark .abg-cell.part i{color:#f0c060}",
      ".abg-cell.no{background:#E15B64}",
      "body.dark .abg-cell.no{background:#a83b43}",
      ".abg-legend .sw.part{background-color:var(--green-bg,#e7f5ec);background-image:repeating-linear-gradient(45deg,rgba(181,114,10,.6),rgba(181,114,10,.6) 3px,transparent 3px,transparent 6px);border-color:#bcd7c8}",
      "body.dark .abg-legend .sw.part{background-color:#0f3a2f;background-image:repeating-linear-gradient(45deg,rgba(240,192,96,.5),rgba(240,192,96,.5) 3px,transparent 3px,transparent 6px)}",
      ".abg-legend .sw.no{background:#E15B64;border-color:#E15B64}",
      ".abg-src{margin-left:auto;font-weight:500;font-size:10px}",
      ".abg-srcbar{display:flex;align-items:center;gap:10px;margin-bottom:12px}",
      ".abg-srclab{font:800 11px var(--f);text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}",
      ".abg-srcsel{flex:1;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:700 13px var(--f);padding:11px 12px;border-radius:11px;-webkit-appearance:none;appearance:none;cursor:pointer}",
      ".abg-warn{font:500 12px/1.5 var(--f);color:var(--ink);background:#FEF3C7;border:1px solid #F59E0B;border-radius:12px;padding:10px 12px;margin-bottom:12px}",
      "body.dark .abg-warn{background:#3a2e0a;border-color:#a3791d;color:#f5e6bd}",
      ".abg-warn b{color:#B45309}body.dark .abg-warn b{color:#fbbf24}",
      ".abg-oc{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:12px}",
      ".abg-oc-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding-bottom:8px;margin-bottom:6px;border-bottom:1px solid var(--line)}",
      ".abg-oc-n{font:800 15px var(--f);font-style:italic;color:var(--ink)}",
      ".abg-oc-m{font:600 10.5px var(--f);color:var(--mut);white-space:nowrap}",
      ".abg-dr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0}",
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
      ".abg-legend.heat .hs{display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:-2px;margin-right:5px}",
      ".abg-empty{text-align:center;padding:40px 20px;color:var(--mut)}",
      ".abg-empty-ic{font-size:38px;margin-bottom:8px}",
      ".abg-empty b{display:block;font:800 16px var(--f);color:var(--ink);margin-bottom:6px}",
      ".abg-empty p{font:500 13px/1.6 var(--f);max-width:320px;margin:0 auto}",
      ".abg-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%) translateY(10px);background:#0F172A;color:#fff;font:600 13px var(--f);padding:11px 18px;border-radius:12px;z-index:970;opacity:0;transition:.2s;pointer-events:none;max-width:88vw;text-align:center}",
      ".abg-toast.on{opacity:1;transform:translateX(-50%)}",
      ".abg-rotate{position:fixed;left:50%;top:calc(14px + env(safe-area-inset-top));transform:translateX(-50%) translateY(-8px);display:flex;align-items:center;gap:9px;background:var(--tl,#0f766e);color:#fff;font:600 13px/1.35 var(--f);padding:10px 10px 10px 14px;border-radius:12px;z-index:990;opacity:0;transition:opacity .2s,transform .2s;box-shadow:0 8px 26px rgba(8,15,26,.32);max-width:92vw}",
      ".abg-rotate.on{opacity:1;transform:translateX(-50%)}",
      ".abg-rotate-ic{font-size:16px;animation:abgrot 1.6s ease-in-out infinite}",
      "@keyframes abgrot{0%,60%,100%{transform:rotate(0)}75%{transform:rotate(-28deg)}88%{transform:rotate(8deg)}}",
      ".abg-rotate-tx{flex:1}",
      ".abg-rotate-x{border:none;background:rgba(255,255,255,.22);color:#fff;width:22px;height:22px;border-radius:999px;font:700 12px var(--f);cursor:pointer;line-height:1;flex:none}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  window.ABG = { open: open, close: close, _data: { COVERAGE: COVERAGE, COLS: COLS } };
})();
