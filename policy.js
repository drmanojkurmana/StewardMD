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

  window.HOSPITAL = {
    list: HOSPITALS, current: current, setProfile: setProfile, getPolicy: getPolicy,
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
