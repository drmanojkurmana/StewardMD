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
    { id:"ICMR", name:"ICMR (National): AMRSN 2024", short:"ICMR", logo:null, abgScope:"src:ICMR_AMRSN_2024_SUMMARY",
      policyName:"ICMR National AMR Treatment Guidelines", version:"AMRSN 2024",
      hasPolicy:false, recommended:true, note:"National guidance, recommended wherever possible. StewardMD already incorporates ICMR/IDSA evidence in each syndrome page." },
    { id:"AIIMS", name:"AIIMS", short:"AIIMS", logo:null, hasPolicy:false },
    { id:"CMC", name:"CMC Vellore", short:"CMC", logo:null, hasPolicy:false },
    { id:"APOLLO", name:"Apollo Hospitals", short:"Apollo", logo:null, hasPolicy:false },
    { id:"MANIPAL", name:"Manipal Hospitals", short:"Manipal", logo:null, hasPolicy:false },
    { id:"NIMS", name:"NIMS Hyderabad", short:"NIMS", logo:null, hasPolicy:false },
    { id:"CUSTOM", name:"Custom hospital", short:"Custom", logo:null, hasPolicy:false, note:"Import your hospital's antibiogram in Antibiogram, My hospital. A hospital antibiotic policy import is not available yet." },
    { id:"GIMSR", name:"GIMSR, Visakhapatnam", short:"GIMSR", logo:"/gimsr-logo.png",
      policyName:"GIMSR Hospital Antimicrobial Policy", version:"HIC-3e · 04.11.2024 (ref NABH/ICMR)",
      hasPolicy:true, policy:P, watch:WATCH, reserve:RESERVE, abgScope:"inst:GIMSR" }
  ];

  /* ---- Antibiogram profiles (data-driven from antibiogram-data.js / antibiogram-store.js) -- *
   * One Active-profile selector drives the Antibiogram screen, the stewardship console and
   * syndrome reasoning. Profiles: India pooled, each region pooled, every surveillance network,
   * the latest edition of every institution or study, and the hospital's own imported
   * antibiogram ("My hospital", device-local). A profile carries abgScope (an ABG_STORE scope);
   * ICMR stays the default. Ids of older builds (REGION_SOUTH, ABG_<study id>) still resolve. */
  var BASE_COUNT = HOSPITALS.length;
  var RMETA = {
    north: { name: "North India (pooled)", short: "North" }, south: { name: "South India (pooled)", short: "South" },
    east: { name: "East & NE India (pooled)", short: "East/NE" }, west: { name: "West & Central India (pooled)", short: "West/Central" }
  };
  function buildAbgProfiles() {
    HOSPITALS.length = BASE_COUNT;
    var I = window.ABG_INDEX; if (!I || !I.sources) return;
    HOSPITALS.push({ id: "INDIA_POOLED", name: "India: all institutions (pooled)", short: "India", type: "region", region: "india", hasPolicy: false, abgScope: "india" });
    var poolFrom = I.stats && I.stats.poolFrom;
    ["north", "south", "east", "west"].forEach(function (rg) {
      if (!I.sources.some(function (x) { return x.region === rg && x.kind === "institution" && !x.focus && (!poolFrom || x.year >= poolFrom); })) return;
      HOSPITALS.push({ id: "REGION_" + rg.toUpperCase(), name: RMETA[rg].name, short: RMETA[rg].short, type: "region", region: rg, hasPolicy: false, abgScope: "region:" + rg });
    });
    // The ICMR profile reads the newest ICMR AMRSN report that carries isolate numbers, else
    // the transcribed national summary.
    var icmr = I.sources.filter(function (x) { return x.inst === "ICMR_AMRSN"; })
      .sort(function (a, b) { return (b.year - a.year) || ((a.verification === "transcribed" ? 1 : 0) - (b.verification === "transcribed" ? 1 : 0)) || (String(b.end || "") > String(a.end || "") ? 1 : -1); })[0];
    if (icmr) { HOSPITALS[0].abgScope = "src:" + icmr.id; HOSPITALS[0].abgSource = icmr.id; }
    var latest = {};
    var ord = function (x) { return String(x.end || (x.year + "-12")); }, perYear = {};
    I.sources.forEach(function (x) { var k = x.inst + "|" + x.year; perYear[k] = (perYear[k] || 0) + 1; });
    I.sources.forEach(function (x) { if (!latest[x.inst] || ord(x) > ord(latest[x.inst])) latest[x.inst] = x; });
    I.sources.forEach(function (x) {
      if (x.inst === "ICMR_AMRSN") return;                           // the ICMR profile carries it
      if (x.inst === "GIMSR") return;                                 // the GIMSR profile carries it
      if (latest[x.inst] !== x) return;                               // older editions live in the Antibiogram screen
      if (x.focus) return;                                            // an outbreak or single-pathogen report is not a hospital profile
      if (!(x.usable >= 3)) return;                                   // too little to stand in for a hospital (one organism, all under 30)
      var net = x.kind === "network";
      // The id is the institution, not the edition, so a saved choice survives next year's report.
      HOSPITALS.push({ id: "ABG_" + x.inst, source: x.id, name: x.name + " (" + x.year + ")", short: x.city || x.short, type: net ? "network" : "study",
        label: x.short + (x.city && x.short.indexOf(x.city) < 0 ? ", " + x.city : "") + " (" + (x.kind === "study" ? "study, " : "") + x.year + (perYear[x.inst + "|" + x.year] > 1 ? (+String(x.end).slice(5, 7) <= 6 ? " H1" : " H2") : "") + ")",
        region: x.region, credibility: net ? 1 : 2, hasPolicy: false, abgScope: net ? "src:" + x.id : "inst:" + x.inst, inst: x.inst });
    });
    var loc = null; try { loc = window.ABG_STORE && window.ABG_STORE.localGet && window.ABG_STORE.localGet(); } catch (e) {}
    if (loc && loc.rows && loc.rows.length) HOSPITALS.push({ id: "LOCAL", name: (loc.name || "My hospital") + " (this device)", short: "My hospital", type: "local", hasPolicy: false, abgScope: "local" });
  }
  buildAbgProfiles();

  var HMAP = {};
  function rebuildMap() { HMAP = {}; HOSPITALS.forEach(function (h) { HMAP[h.id] = h; }); }
  rebuildMap();
  // Legacy ids from before the antibiogram rebuild map to their successors.
  var ALIAS = { ABG_SGRD_KLEB: "ABG_SGRD_KLEB_2022" };
  function refreshProfiles() { buildAbgProfiles(); rebuildMap(); }
  if (window.ABG_STORE && window.ABG_STORE.onReady) window.ABG_STORE.onReady(function () { refreshProfiles(); });
  try { document.addEventListener("smd:abg-ready", function () { refreshProfiles(); }); } catch (e) {}

  var KEY = "stewardmd_hospital";
  // Ids saved by older builds: ALIAS, then "ABG_<source id>" (one edition) to that source's
  // institution profile.
  function resolve(id) {
    if (HMAP[id]) return HMAP[id];
    if (ALIAS[id]) { id = ALIAS[id]; if (HMAP[id]) return HMAP[id]; }
    var I = window.ABG_INDEX, sid = /^ABG_/.test(String(id)) ? String(id).slice(4) : null;
    var src = sid && I && I.sources ? I.sources.filter(function (x) { return x.id === sid; })[0] : null;
    return (src && HMAP["ABG_" + src.inst]) || null;
  }
  function current() {
    var id = null;
    try { id = localStorage.getItem(KEY); } catch (e) {}
    return resolve(id) || HMAP.ICMR;
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
  /* ctx (optional): {spec, set} to ask for a specimen (urine for a UTI) and setting. */
  // Kill switch (antibiogram-flags.js smd_abg_data, default on): off, decision support ignores
  // the validated store and uses the built-in ICMR 2024 national summary, as before the rebuild.
  // Read directly when the flag module has not run yet (it loads after this file).
  function dataOn() {
    var F = window.SMD_ABG_FLAGS; if (F && F.data) return F.data();
    try { var q = new URLSearchParams(location.search).get("abgdata"); if (q === "0" || q === "false") return false; if (q === "1" || q === "true") return true; } catch (e) {}
    try { return localStorage.getItem("smd_abg_data") !== "0"; } catch (e) { return true; }
  }
  function getAntibiogram(ctx) {
    var h = current(), S = window.ABG_STORE;
    ctx = ctx || {};
    if (dataOn() && h && h.abgScope && S && S.loaded && S.loaded()) {
      try { var a = S.legacyAbg(h.abgScope, ctx.spec, ctx.set); if (a && a.org && Object.keys(a.org).length) return a; } catch (e) {}
    }
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
  /* {s, n, k, src, spec, set, pooled, intrinsic} from the active profile (validated, at least
   * 30 isolates), else the ICMR national summary ({..., national:true}), else null. */
  function getSusceptibility(orgName, drugKey, ctx) {
    var h = current(), S = window.ABG_STORE, useStore = dataOn() && h && h.abgScope && S && S.loaded && S.loaded();
    ctx = ctx || {};
    if (useStore) {
      try {
        var r = S.susceptibility(orgName, drugKey, { scope: h.abgScope, spec: ctx.spec, set: ctx.set, cohort: ctx.cohort, only: ctx.only, noAll: ctx.noAll });
        if (r && r.intrinsic) return { s: 0, intrinsic: true, why: r.why, spec: r.spec, set: r.set };
        // as/asKey: the report printed an equivalent agent (cefotaxime for ceftriaxone, oxacillin for cefoxitin).
        if (r && !r.lowN) return { s: r.s, n: r.n, k: r.k, src: r.src, spec: r.spec, set: r.set, cohort: r.cohort, specMatch: r.specMatch, pooled: r.pooled, combined: r.combined, as: r.as || null, asKey: r.asKey || null };
      } catch (e) {}
    }
    var ab = getAntibiogram(ctx), nat = window.ASP_ABG && window.ASP_ABG.national;
    // The national summary is never passed off as the profile's own figures.
    var hit = (useStore || ab === nat) ? null : (lookIn(ab, orgName, drugKey) || lookIn(ab, canonOrg(orgName), drugKey));
    if (hit) return hit;
    var nh = lookIn(nat, orgName, drugKey) || lookIn(nat, canonOrg(orgName), drugKey);
    if (nh) { nh.national = true; return nh; }
    return null;
  }
  /* Grouped options for every profile picker (reasoning, the console, the Antibiogram screen):
   * national first, then pooled views, each region's institutions and networks, the hospital's
   * own import, then hospitals StewardMD holds a policy (or nothing yet) for. */
  var RGROUP = { north: "North India", south: "South India", east: "East and North-East India", west: "West and Central India" };
  function optionGroups() {
    function by(f) { return HOSPITALS.filter(f); }
    function item(h, label) { return { id: h.id, label: label || h.label || h.name }; }
    var g = [];
    g.push({ label: "National", items: by(function (h) { return h.id === "ICMR"; }).map(function (h) { return item(h, h.name + " (default)"); })
      .concat(by(function (h) { return h.type === "network" && h.region === "national"; }).map(function (h) { return item(h); })) });
    var pooled = by(function (h) { return h.type === "region"; });
    if (pooled.length) g.push({ label: "Pooled", items: pooled.map(function (h) { return item(h, h.name); }) });
    ["north", "south", "east", "west"].forEach(function (rg) {
      var xs = by(function (h) { return (h.type === "study" || h.type === "network") && h.region === rg; })
        .sort(function (a, b) { return (a.type === "network" ? 0 : 1) - (b.type === "network" ? 0 : 1) || ((a.label || a.name) < (b.label || b.name) ? -1 : 1); });
      if (rg === "south" && HMAP.GIMSR) xs.push(HMAP.GIMSR);
      if (xs.length) g.push({ label: RGROUP[rg], items: xs.map(function (h) { return item(h, h.id === "GIMSR" ? "GIMSR, Visakhapatnam (hospital policy)" : null); }) });
    });
    var loc = by(function (h) { return h.type === "local"; });
    if (loc.length) g.push({ label: "My hospital", items: loc.map(function (h) { return item(h, h.name); }) });
    var hosp = by(function (h) { return !h.type && h.id !== "ICMR" && h.id !== "GIMSR"; });
    if (hosp.length) g.push({ label: "Other hospitals (no data yet)", items: hosp.map(function (h) { return item(h, h.name); }) });
    return g;
  }
  function optionsHTML(cur) {
    function e(x) { return String(x == null ? "" : x).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    cur = cur || current().id;
    return optionGroups().map(function (g) {
      return '<optgroup label="' + e(g.label) + '">' + g.items.map(function (it) { return '<option value="' + e(it.id) + '"' + (it.id === cur ? " selected" : "") + '>' + e(it.label) + '</option>'; }).join("") + '</optgroup>';
    }).join("");
  }
  function profileForScope(scope) {
    for (var i = 0; i < HOSPITALS.length; i++) if (HOSPITALS[i].abgScope === scope && HOSPITALS[i].id !== "GIMSR") return HOSPITALS[i].id;
    for (i = 0; i < HOSPITALS.length; i++) if (HOSPITALS[i].abgScope === scope) return HOSPITALS[i].id;
    return null;
  }

  window.HOSPITAL = {
    list: HOSPITALS, current: current, setProfile: setProfile, getPolicy: getPolicy,
    getAntibiogram: getAntibiogram, getSusceptibility: getSusceptibility, canonOrg: canonOrg, abgDataOn: dataOn,
    profileForScope: profileForScope, refreshProfiles: refreshProfiles, optionGroups: optionGroups, optionsHTML: optionsHTML,
    awareClass: awareClass,
    stewardshipRules: [
      "Prescribe antibiotics only when clinically indicated; send cultures before the first dose.",
      "De-escalate daily and at the earliest opportunity once susceptibilities are available.",
      "Reserve-group agents (colistin, polymyxin B, linezolid, ceftazidime-avibactam, IV fosfomycin, cefiderocol, tigecycline) require prior approval of the Antimicrobial Stewardship Team.",
      "Use the shortest effective duration: 7 to 10 days is adequate for most infections.",
      "Avoid piperacillin–tazobactam in septic shock until cephalosporin-resistant bacteraemia is excluded (MERINO)."
    ]
  };
})();
