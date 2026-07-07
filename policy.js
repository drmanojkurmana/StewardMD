/* ============================================================================
   StewardMD vNext — Hospital Antimicrobial Policy Engine (Phase 3)
   Flexible, extensible hospital-profile system. Default GIMSR policy is
   transcribed faithfully from the GIMSR Antibiotic Policy HIC-3e (issued
   04.11.2024; ref NABH/ICMR). Other hospitals can be added with zero code
   changes — drop a profile into HOSPITALS and a policy map keyed by syndrome.
   Recommendations always carry a transparent source; local policy is never
   silently overridden. Decision support only — pending clinician sign-off.
   ========================================================================== */
(function () {
  "use strict";

  /* ---- AWaRe classification (verbatim from GIMSR policy, WHO AWaRe) ------ */
  var WATCH = ["cefuroxime","cefotaxime","azithromycin","clarithromycin","ceftriaxone","ceftazidime","cefixime","ciprofloxacin","piperacillin-tazobactam","piperacillin–tazobactam","meropenem","vancomycin"];
  var RESERVE = ["ceftazidime-avibactam","ceftazidime–avibactam","meropenem-vaborbactam","colistin","polymyxin b","fosfomycin(iv)","fosfomycin (iv)","linezolid","cefiderocol","cefidercol","plazomicin","tigecycline","imipenem"];
  function awareClass(drug) {
    var d = String(drug || "").toLowerCase();
    for (var i = 0; i < RESERVE.length; i++) if (d.indexOf(RESERVE[i]) >= 0) return "reserve";
    for (var j = 0; j < WATCH.length; j++) if (d.indexOf(WATCH[j]) >= 0) return "watch";
    return "access";
  }

  /* ---- GIMSR policy, keyed by StewardMD syndrome id ---------------------- *
   * Faithful transcription of empiric drug CHOICE, duration & comments from
   * the policy tables. Doses come from StewardMD's own syndrome pages; this
   * layer adds hospital choice + AWaRe + stewardship context.
   * ---------------------------------------------------------------------- */
  var P = {}; // helper to register one regimen for many syndrome ids
  function reg(ids, obj) { ids.forEach(function (id) { P[id] = obj; }); }

  reg(["MENINGITIS"], { preferred:["Ceftriaxone + Vancomycin"],
    alternatives:["Cefotaxime + Vancomycin","Add Ampicillin if >50y / impaired cell-mediated immunity (Listeria cover)","Meropenem + Vancomycin"],
    duration:"Per pathogen (typically 10–14 days)",
    comments:"Do not delay empiric therapy ± dexamethasone for imaging/LP. Healthcare-associated: cloxacillin (MSSA) / vancomycin (MRSA) / meropenem (ESBL).",
    table:"Table 2.17", page:45 });

  reg(["CYSTITIS"], { preferred:["Nitrofurantoin","Fosfomycin"],
    alternatives:["Co-trimoxazole","Ertapenem","Amikacin"],
    duration:"Short course (3–7 days)",
    comments:"Avoid nitrofurantoin/fosfomycin if pyelonephritis/prostatitis or systemic features suspected. Reserve fosfomycin for Gram-negative MDR / drug-resistant enterococcus. Adjust by eGFR.",
    table:"Table 2.21", page:48 });

  reg(["PYELONEPHRITIS","COMPLICATED_UTI","CA_UTI"], { preferred:["Piperacillin–tazobactam","Ertapenem"],
    alternatives:["Imipenem","Meropenem","Amikacin"],
    duration:"≥7 days (7–14 days if complicated; 14 days in children)",
    comments:"Same regimen for complicated UTI with extended duration. Adjust by eGFR. De-escalate on culture.",
    table:"Table 2.21", page:48 });

  reg(["PROSTATITIS"], { preferred:["Ertapenem 1 g IV once daily"],
    alternatives:["Piperacillin–tazobactam","Imipenem","Meropenem","Trimethoprim–sulfamethoxazole"],
    duration:"Minimum 21 days",
    comments:"Collect urine and post-prostatic-massage specimen for culture before antibiotics.",
    table:"Table 2.21", page:48 });

  reg(["CAP"], { preferred:["Outpatient: Co-amoxiclav","Inpatient (non-ICU): Ceftriaxone + macrolide/doxycycline"],
    alternatives:["Outpatient + comorbidity: Co-amoxiclav + macrolide/doxycycline","Cefuroxime / cefpodoxime + macrolide/doxycycline","β-lactam hypersensitivity: respiratory fluoroquinolone (exclude TB first)"],
    duration:"5–7 days (guided by response)",
    comments:"β-lactam preferred over macrolide alone (high pneumococcal macrolide resistance in India). Add vancomycin/teicoplanin if CA-MRSA suspected; add oseltamivir during influenza season.",
    table:"Table 2.7", page:25 });

  reg(["SEVERE_CAP","VAP","HAP","ASPIRATION_PNEUMONIA"], { preferred:["Ceftriaxone + macrolide/doxycycline","ICU + Pseudomonas risk: Piperacillin–tazobactam + macrolide/doxycycline"],
    alternatives:["Cefepime / Imipenem + macrolide/doxycycline","Cefotaxime or piperacillin–tazobactam + macrolide"],
    duration:"7 days (longer if non-resolving / specific pathogens)",
    comments:"Carbapenems preferred over BL-BLI in septic shock. Add vancomycin/teicoplanin if CA-MRSA suspected. De-escalate on culture.",
    table:"Table 2.7", page:25 });

  reg(["SEPSIS","SEPTIC_SHOCK","FEBRILE_NEUTROPENIA"], { preferred:["Imipenem–cilastatin ± Amikacin"],
    alternatives:["Meropenem","Cefoperazone–sulbactam","± Vancomycin if MRSA risk"],
    duration:"7–10 days (adequate for most cases)",
    comments:"Septic shock: ≥2 antibiotics of different classes. AVOID piperacillin–tazobactam in septic shock until cephalosporin-resistant bacteraemia excluded (MERINO trial). Add MRSA / CR-GNB / antifungal cover per risk. De-escalate daily once cultures available.",
    table:"Table 2.4", page:21 });

  reg(["CELLULITIS","ERYSIPELAS"], { preferred:["Cefazolin","Cephalexin","Amoxicillin–clavulanate"],
    alternatives:["± Clindamycin","Add MRSA cover per risk factors"],
    duration:"5–7 days (longer if clinically indicated)",
    comments:"Obtain blood/pus cultures before antibiotics. Consider polymicrobial pathogens in diabetics. Weigh MRSA risk and TSS before clindamycin.",
    table:"Table 2.12", page:34 });

  reg(["NECROTIZING_FASCIITIS"], { preferred:["Piperacillin–tazobactam + Clindamycin"],
    alternatives:["Aeromonas/V. vulnificus exposure: Ciprofloxacin + Doxycycline","Consider IVIG for streptococcal NF/TSS"],
    duration:"~14 days with adequate source control",
    comments:"Early surgical debridement is essential. Send blood and intraoperative cultures.",
    table:"Table 2.12", page:34 });

  reg(["ENTERIC_FEVER"], { preferred:["Oral: Co-trimoxazole or Azithromycin","Parenteral: Ceftriaxone"],
    alternatives:["Cefixime","Chloramphenicol","Ciprofloxacin (only if susceptible)"],
    duration:"10–14 days",
    comments:"Change empiric regimen on susceptibility. Avoid empiric fluoroquinolones (widespread resistance).",
    table:"Table 2.1", page:16 });

  reg(["CHOLANGITIS","CHOLECYSTITIS","SBP","LIVER_ABSCESS","AMOEBIC_LIVER_ABSCESS"], { preferred:["Mild–moderate (community): Cefoperazone–sulbactam","High severity: Imipenem or Meropenem"],
    alternatives:["Piperacillin–tazobactam","Healthcare-associated: Imipenem/Meropenem + Vancomycin","MDR: Colistin / Tigecycline per susceptibility"],
    duration:"Per source control (typically 4–7 days after control)",
    comments:"Separate anaerobic cover usually unnecessary with these agents. Add echinocandin/fluconazole if Candida risk. Amoebic liver abscess also needs metronidazole + luminal agent.",
    table:"Table 2.9", page:29 });

  /* ---- Hospital profiles (extensible) ----------------------------------- */
  var HOSPITALS = [
    { id:"ICMR", name:"ICMR (National) — AMRSN 2024", short:"ICMR", logo:null,
      policyName:"ICMR National AMR Treatment Guidelines", version:"AMRSN 2024",
      hasPolicy:false, recommended:true, note:"National guidance — recommended wherever possible. StewardMD already incorporates ICMR/IDSA evidence in each syndrome page." },
    { id:"AIIMS", name:"AIIMS", short:"AIIMS", logo:null, hasPolicy:false },
    { id:"CMC", name:"CMC Vellore", short:"CMC", logo:null, hasPolicy:false },
    { id:"APOLLO", name:"Apollo Hospitals", short:"Apollo", logo:null, hasPolicy:false },
    { id:"MANIPAL", name:"Manipal Hospitals", short:"Manipal", logo:null, hasPolicy:false },
    { id:"NIMS", name:"NIMS Hyderabad", short:"NIMS", logo:null, hasPolicy:false },
    { id:"CUSTOM", name:"Custom hospital", short:"Custom", logo:null, hasPolicy:false, note:"Import your hospital's antibiogram & policy (coming soon)." },
    { id:"GIMSR", name:"GIMSR, Visakhapatnam", short:"GIMSR", logo:"/gimsr-logo.png",
      policyName:"GIMSR Hospital Antimicrobial Policy", version:"HIC-3e · 04.11.2024 (ref NABH/ICMR)",
      hasPolicy:true, policy:P, watch:WATCH, reserve:RESERVE }
  ];

  /* ---- Regional antibiogram profiles (data-driven from antibiogram-data.js) ---------- *
   * Adds "South/North/East & NE/West & Central India (regional composite)" plus each
   * individual study as a drill-down profile, so ONE Active-profile selector drives the
   * Antibiogram screen and syndrome reasoning everywhere ICMR does. A profile carries only
   * an `abg` (no `policy`); ICMR stays the default. Studies without per-drug data are skipped. */
  (function () {
    var D = window.ABG_DATA; if (!D) return;
    var RMETA = {
      south: { name: "South India (regional composite)", short: "South" },
      north: { name: "North India (regional composite)", short: "North" },
      east:  { name: "East & NE India (regional composite)", short: "East/NE" },
      west:  { name: "West & Central India (regional composite)", short: "West/Central" }
    };
    ["south", "north", "east", "west"].forEach(function (rg) {
      var abg = D.region && D.region[rg];
      if (!abg || !abg.org || !Object.keys(abg.org).length) return;
      HOSPITALS.push({ id: "REGION_" + rg.toUpperCase(), name: RMETA[rg].name, short: RMETA[rg].short,
        type: "region", region: rg, hasPolicy: false, abg: abg, sources: abg.sources || [] });
    });
    (D.studies || []).forEach(function (st) {
      if (!st.org || !Object.keys(st.org).length) return;   // e.g. ANDHRA_UTI reported MDR% only
      HOSPITALS.push({ id: "ABG_" + st.id, name: st.label, short: st.city || st.id,
        type: "study", region: st.region, credibility: st.credibility, hasPolicy: false, abg: st });
    });
  })();

  var HMAP = {}; HOSPITALS.forEach(function (h) { HMAP[h.id] = h; });

  var KEY = "stewardmd_hospital";
  function current() {
    var id = null;
    try { id = localStorage.getItem(KEY); } catch (e) {}
    return HMAP[id] || HMAP.ICMR;
  }
  function setProfile(id) {
    if (!HMAP[id]) return;
    try { localStorage.setItem(KEY, id); } catch (e) {}
    if (window.DX && typeof window.DX._onHospitalChange === "function") window.DX._onHospitalChange();
  }
  function getPolicy(synId) {
    var h = current();
    if (h.hasPolicy && h.policy && h.policy[synId]) return { hospital: h, entry: h.policy[synId] };
    return { hospital: h, entry: null };
  }

  /* ---- Antibiogram accessors — active profile drives resistance data everywhere -------- *
   * getAntibiogram(): the active profile's antibiogram object ({source,note?,org}); falls
   *   back to the ICMR national dataset so nothing breaks if a profile lacks data.
   * getSusceptibility(org, drugKey): {s, src} (% susceptible + provenance) from the active
   *   profile, else the ICMR national dataset (national:true), else null. Never invents. */
  var ORG_ALIAS = {
    "e. coli": "Escherichia coli", "e.coli": "Escherichia coli", "escherichia coli": "Escherichia coli",
    "klebsiella": "Klebsiella pneumoniae", "k. pneumoniae": "Klebsiella pneumoniae", "klebsiella pneumoniae": "Klebsiella pneumoniae",
    "pseudomonas": "Pseudomonas aeruginosa", "p. aeruginosa": "Pseudomonas aeruginosa", "pseudomonas aeruginosa": "Pseudomonas aeruginosa",
    "acinetobacter": "Acinetobacter baumannii", "a. baumannii": "Acinetobacter baumannii", "acinetobacter baumannii": "Acinetobacter baumannii",
    "s. aureus": "Staphylococcus aureus", "staph aureus": "Staphylococcus aureus", "staphylococcus aureus": "Staphylococcus aureus",
    "mrsa": "Staphylococcus aureus", "mssa": "Staphylococcus aureus",
    "enterococcus": "Enterococcus", "enterococcus faecium": "Enterococcus faecium", "enterococcus faecalis": "Enterococcus faecalis",
    "proteus": "Proteus mirabilis", "p. mirabilis": "Proteus mirabilis", "proteus mirabilis": "Proteus mirabilis"
  };
  function canonOrg(name) { var k = String(name || "").toLowerCase().trim(); return ORG_ALIAS[k] || name; }
  function getAntibiogram() {
    var h = current();
    if (h && h.abg) return h.abg;
    if (h && h.id === "GIMSR" && window.ASP_ABG && window.ASP_ABG.hospital) return window.ASP_ABG.hospital;
    return (window.ASP_ABG && window.ASP_ABG.national) || null;
  }
  function lookIn(ab, orgName, drugKey) {
    if (!ab || !ab.org) return null;
    var o = ab.org[orgName];
    if (!o) { // canonical + case-insensitive match
      var cn = canonOrg(orgName), keys = Object.keys(ab.org), i;
      for (i = 0; i < keys.length; i++) { if (keys[i] === cn || keys[i].toLowerCase() === String(orgName).toLowerCase()) { o = ab.org[keys[i]]; break; } }
    }
    if (!o || !o.d) return null;
    var c = o.d[drugKey];
    return (c && c.s != null) ? { s: c.s, src: c.src || null, approx: !!c.approx } : null;
  }
  function getSusceptibility(orgName, drugKey) {
    var ab = getAntibiogram();
    var hit = lookIn(ab, orgName, drugKey) || lookIn(ab, canonOrg(orgName), drugKey);
    if (hit) return hit;
    var nat = window.ASP_ABG && window.ASP_ABG.national;
    var nh = lookIn(nat, orgName, drugKey) || lookIn(nat, canonOrg(orgName), drugKey);
    if (nh) { nh.national = true; return nh; }
    return null;
  }

  window.HOSPITAL = {
    list: HOSPITALS, current: current, setProfile: setProfile, getPolicy: getPolicy,
    getAntibiogram: getAntibiogram, getSusceptibility: getSusceptibility, canonOrg: canonOrg,
    awareClass: awareClass,
    stewardshipRules: [
      "Prescribe antibiotics only when clinically indicated; send cultures before the first dose.",
      "De-escalate daily and at the earliest opportunity once susceptibilities are available.",
      "Reserve-group agents (colistin, polymyxin B, linezolid, ceftazidime-avibactam, IV fosfomycin, cefiderocol, tigecycline) require prior approval of the Antimicrobial Stewardship Team.",
      "Use the shortest effective duration — 7–10 days is adequate for most infections.",
      "Avoid piperacillin–tazobactam in septic shock until cephalosporin-resistant bacteraemia is excluded (MERINO)."
    ]
  };
})();
