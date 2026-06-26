/* ============================================================================
   StewardMD vNext — Clinical Reasoning Engine (Layer 1) + live Differential Dx
   Modular, deferred. Reads existing globals (window.ASP / ASP_DATA / INF) and
   hands off to the antimicrobial stewardship engine when infection leads.
   Decision-support only — never diagnostic. Pending clinician sign-off.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------- *
   * 1. FINDINGS CATALOG  — id -> {label, cat}
   *    cat: symptom | sign | vital | lab | imaging | micro | risk
   * ---------------------------------------------------------------------- */
  var F = {
    // chief complaints / symptoms
    altered_sensorium: { label: "Altered sensorium", cat: "symptom" },
    fever:             { label: "Fever", cat: "symptom" },
    headache:          { label: "Headache", cat: "symptom" },
    seizure:           { label: "Seizure", cat: "symptom" },
    cough:             { label: "Cough", cat: "symptom" },
    purulent_sputum:   { label: "Purulent sputum", cat: "symptom" },
    dyspnea:           { label: "Breathlessness / dyspnea", cat: "symptom" },
    pleuritic_pain:    { label: "Pleuritic chest pain", cat: "symptom" },
    orthopnea:         { label: "Orthopnea / PND", cat: "symptom" },
    polyuria:          { label: "Polyuria / polydipsia", cat: "symptom" },
    leg_swelling_unil: { label: "Unilateral leg swelling", cat: "symptom" },
    skin_redness:      { label: "Skin redness / swelling", cat: "symptom" },
    // signs
    neck_stiffness:    { label: "Neck stiffness / meningism", cat: "sign" },
    photophobia:       { label: "Photophobia", cat: "sign" },
    focal_deficit:     { label: "Focal neuro deficit", cat: "sign" },
    papilledema:       { label: "Papilledema", cat: "sign" },
    asterixis:         { label: "Asterixis", cat: "sign" },
    jaundice:          { label: "Jaundice / stigmata CLD", cat: "sign" },
    rash:              { label: "Rash", cat: "sign" },
    crackles:          { label: "Crackles / consolidation", cat: "sign" },
    bilateral_crackles:{ label: "Bilateral basal crackles", cat: "sign" },
    raised_jvp:        { label: "Raised JVP / edema", cat: "sign" },
    calf_tenderness:   { label: "Calf tenderness", cat: "sign" },
    warm_tender_skin:  { label: "Warm, tender, spreading erythema", cat: "sign" },
    // vitals
    hypotension:       { label: "Hypotension (SBP <90 / MAP <65)", cat: "vital" },
    tachycardia:       { label: "Tachycardia", cat: "vital" },
    hypoxia:           { label: "Hypoxia (SpO₂ <92%)", cat: "vital" },
    tachypnea:         { label: "Tachypnea", cat: "vital" },
    hyperthermia:      { label: "Temp >38.3°C", cat: "vital" },
    // labs / micro / imaging
    neutrophilia:      { label: "Neutrophilic leukocytosis", cat: "lab" },
    raised_lactate:    { label: "Raised lactate (>2)", cat: "lab" },
    hypoglycemia:      { label: "Hypoglycemia (glucose <70)", cat: "lab" },
    raised_ammonia:    { label: "Deranged LFT / raised ammonia", cat: "lab" },
    ketonemia:         { label: "Ketonemia / metabolic acidosis", cat: "lab" },
    aki:               { label: "Acute kidney injury", cat: "lab" },
    csf_neutrophilic:  { label: "CSF: neutrophilic pleocytosis", cat: "micro" },
    csf_lymphocytic:   { label: "CSF: lymphocytic pleocytosis", cat: "micro" },
    blood_cx_pos:      { label: "Blood culture positive", cat: "micro" },
    malaria_smear:     { label: "Malaria smear / antigen positive", cat: "micro" },
    cxr_consolidation: { label: "CXR: lobar consolidation", cat: "imaging" },
    cxr_bilateral:     { label: "CXR: bilateral infiltrates / edema", cat: "imaging" },
    ct_infarct:        { label: "CT/MRI: acute infarct", cat: "imaging" },
    ct_ring_lesion:    { label: "CT/MRI: ring-enhancing lesion", cat: "imaging" },
    ecg_ischemia:      { label: "ECG: ischemia", cat: "imaging" },
    // risk factors
    immunocompromised: { label: "Immunocompromised", cat: "risk" },
    cirrhosis:         { label: "Known cirrhosis / CLD", cat: "risk" },
    diabetic:          { label: "Diabetes mellitus", cat: "risk" },
    travel_endemic:    { label: "Travel / endemic malaria area", cat: "risk" },
    drug_overdose_hx:  { label: "Sedative / drug overdose history", cat: "risk" },
    recent_steroids:   { label: "Chronic steroid use", cat: "risk" }
  };

  /* Chief complaints -> {finding, label}. These seed the candidate set. */
  var CHIEF = [
    { f: "altered_sensorium", label: "Altered sensorium / confusion" },
    { f: "fever",             label: "Fever" },
    { f: "dyspnea",           label: "Breathlessness" },
    { f: "cough",             label: "Cough" },
    { f: "hypotension",       label: "Shock / hypotension" },
    { f: "skin_redness",      label: "Skin redness & swelling" },
    { f: "headache",          label: "Headache" },
    { f: "seizure",           label: "Seizure" }
  ];

  /* ---------------------------------------------------------------------- *
   * 2. KNOWLEDGE BASE  — diseases with weighted features.
   *    score = clamp( sum of weights of ENTERED findings , 0 , 100 )
   *    infectious:true diseases can hand off to the stewardship engine.
   *    mimicOf links a non-infectious dx to the infection it mimics.
   * ---------------------------------------------------------------------- */
  var DISEASES = [
    /* ---- Neuro / altered sensorium cluster ---- */
    { id:"meningitis", name:"Acute bacterial meningitis", system:"Infectious / Neuro", infectious:true, treat:"MENINGITIS",
      tools:[], inv:["CSF analysis (urgent LP)","Blood cultures","CT head if focal signs / papilledema","CBC, CRP/procalcitonin"],
      red:["Do not delay empiric antibiotics ± dexamethasone for LP/CT","Purpura → meningococcemia"],
      empiric:"Ceftriaxone 2 g IV q12h + Vancomycin (± Ampicillin if >50y/immunocompromised) ± Dexamethasone",
      F:{ altered_sensorium:55, fever:33, neck_stiffness:22, headache:12, photophobia:10, neutrophilia:8,
          csf_neutrophilic:30, rash:6, seizure:6, blood_cx_pos:10, immunocompromised:5 } },

    { id:"viral_enceph", name:"Viral encephalitis", system:"Infectious / Neuro", infectious:true, treat:"",
      tools:[], inv:["CSF analysis (HSV PCR)","MRI brain","EEG"],
      red:["Start empiric Acyclovir early if HSV suspected"],
      empiric:"Acyclovir 10 mg/kg IV q8h (HSV cover) pending CSF PCR",
      F:{ altered_sensorium:48, fever:31, seizure:18, headache:12, focal_deficit:10,
          csf_lymphocytic:26, neck_stiffness:6, neutrophilia:-6 } },

    { id:"sepsis_enceph", name:"Sepsis-associated encephalopathy", system:"Critical care", infectious:true, treat:"SEPSIS",
      tools:["shock"], inv:["Septic screen / cultures","Lactate","Source identification"],
      red:["Treat the source; encephalopathy reflects systemic sepsis"],
      empiric:"Per sepsis source — broad-spectrum after cultures (see stewardship)",
      F:{ altered_sensorium:70, fever:7, neutrophilia:10, raised_lactate:14, hypotension:12, tachycardia:6, blood_cx_pos:10 } },

    { id:"metabolic_enceph", name:"Metabolic encephalopathy", system:"Neuro / Metabolic", infectious:false,
      tools:[], inv:["Electrolytes, glucose, calcium","Renal & liver panel","ABG, ammonia","TSH"],
      red:["Reversible — correct the metabolic derangement"], mimicOf:["meningitis","viral_enceph"],
      F:{ altered_sensorium:78, aki:12, raised_ammonia:8, hypoglycemia:10, fever:-14, neck_stiffness:-18 } },

    { id:"hypoglycemia", name:"Hypoglycemia", system:"Endocrine", infectious:false,
      tools:[], inv:["Capillary & lab glucose","Insulin / C-peptide if recurrent"],
      red:["Give IV dextrose immediately — rapidly reversible"], mimicOf:["meningitis","sepsis_enceph"],
      F:{ altered_sensorium:60, hypoglycemia:35, diabetic:10, seizure:8, fever:-12, neck_stiffness:-15 } },

    { id:"hepatic_enceph", name:"Hepatic encephalopathy", system:"Hepatology", infectious:false,
      tools:[], inv:["Ammonia","LFT, coagulation","Identify precipitant (infection/GI bleed/constipation)"],
      red:["Look for precipitating infection (e.g. SBP)"], mimicOf:["meningitis","sepsis_enceph"],
      F:{ altered_sensorium:45, asterixis:30, jaundice:20, raised_ammonia:22, cirrhosis:25, fever:-8, neck_stiffness:-12 } },

    { id:"stroke", name:"Acute ischemic stroke", system:"Neuro", infectious:false,
      tools:[], inv:["Non-contrast CT head (urgent)","CT/MR angiography","Glucose (mimic)"],
      red:["Time-critical — thrombolysis window","Check stroke pathway"], mimicOf:["meningitis"],
      F:{ altered_sensorium:64, focal_deficit:35, ct_infarct:30, headache:6, fever:-36, neck_stiffness:-20 } },

    { id:"drug_intox", name:"Drug intoxication / poisoning", system:"Toxicology", infectious:false,
      tools:[], inv:["Toxidrome assessment","Paracetamol/salicylate levels","ABG, osmolar gap"],
      red:["Specific antidotes where available"], mimicOf:["meningitis","sepsis_enceph"],
      F:{ altered_sensorium:41, drug_overdose_hx:40, seizure:8, fever:-10, neck_stiffness:-12 } },

    { id:"brain_abscess", name:"Brain abscess", system:"Infectious / Neuro", infectious:true, treat:"",
      tools:[], inv:["MRI with contrast","Blood cultures","Source: ENT/dental/endocarditis"],
      red:["Neurosurgical referral for drainage"],
      empiric:"Ceftriaxone + Metronidazole (± Vancomycin) IV",
      F:{ altered_sensorium:40, fever:21, headache:16, focal_deficit:18, ct_ring_lesion:34, seizure:10 } },

    { id:"cerebral_malaria", name:"Cerebral malaria", system:"Tropical / Infectious", infectious:true, treat:"",
      tools:[], inv:["Malaria smear / RDT (urgent, repeat)","Glucose","Parasite index"],
      red:["Medical emergency — IV artesunate"],
      empiric:"IV Artesunate (not an antibacterial — antimalarial)",
      F:{ altered_sensorium:18, fever:37, travel_endemic:30, malaria_smear:40, seizure:10, neck_stiffness:-6 } },

    /* ---- Respiratory cluster + mimics ---- */
    { id:"cap", name:"Community-acquired pneumonia", system:"Infectious / Pulmonary", infectious:true, treat:"CAP",
      tools:[], inv:["CXR","CBC, CRP/procalcitonin","Blood & sputum cultures","SpO₂ / ABG"],
      red:["Assess severity (CURB-65) → admission/ICU"],
      empiric:"Per severity: β-lactam + macrolide / respiratory fluoroquinolone (see stewardship)",
      F:{ cough:28, fever:24, purulent_sputum:22, dyspnea:14, crackles:20, cxr_consolidation:30,
          neutrophilia:10, tachypnea:8, hypoxia:8, pleuritic_pain:8 } },

    { id:"pulm_edema", name:"Cardiogenic pulmonary edema", system:"Cardiology", infectious:false,
      tools:[], inv:["CXR","BNP/NT-proBNP","ECG, troponin","Echocardiogram"],
      red:["Diuresis / afterload reduction, not antibiotics"], mimicOf:["cap"],
      F:{ dyspnea:38, orthopnea:30, bilateral_crackles:28, raised_jvp:26, cxr_bilateral:24, fever:-18, purulent_sputum:-12 } },

    { id:"pulm_embolism", name:"Pulmonary embolism", system:"Pulmonary / Vascular", infectious:false,
      tools:[], inv:["CT pulmonary angiogram","D-dimer (if low probability)","ECG, troponin"],
      red:["Anticoagulation; thrombolysis if massive"], mimicOf:["cap"],
      F:{ dyspnea:40, pleuritic_pain:28, hypoxia:24, tachycardia:18, leg_swelling_unil:16, fever:-10, crackles:-8 } },

    /* ---- Shock cluster + mimics ---- */
    { id:"septic_shock", name:"Septic shock", system:"Critical care / Infectious", infectious:true, treat:"SEPSIS",
      tools:["shock"], inv:["Lactate","Blood cultures ×2","Source screen","Hourly urine output"],
      red:["Bundle: cultures → broad-spectrum within 1h → 30 mL/kg fluids → vasopressors for MAP ≥65"],
      empiric:"Broad-spectrum after cultures per source & hospital policy (see stewardship)",
      F:{ hypotension:40, fever:24, raised_lactate:26, tachycardia:14, neutrophilia:12, blood_cx_pos:14, hypoxia:6 } },

    { id:"cardiogenic_shock", name:"Cardiogenic shock", system:"Cardiology", infectious:false,
      tools:["shock"], inv:["ECG, troponin","Echocardiogram","CXR"],
      red:["Revascularization / inotropes — not antibiotics"], mimicOf:["septic_shock"],
      F:{ hypotension:40, raised_jvp:24, bilateral_crackles:20, ecg_ischemia:30, fever:-16, raised_lactate:10 } },

    { id:"adrenal_crisis", name:"Adrenal crisis", system:"Endocrine", infectious:false,
      tools:["shock"], inv:["Random cortisol","Electrolytes (Na↓ K↑)","Glucose"],
      red:["Empiric IV hydrocortisone if suspected"], mimicOf:["septic_shock"],
      F:{ hypotension:38, recent_steroids:34, hypoglycemia:16, fever:-6 } },

    /* ---- Skin cluster + mimics ---- */
    { id:"cellulitis", name:"Cellulitis", system:"Infectious / Derm", infectious:true, treat:"CELLULITIS",
      tools:[], inv:["Mark borders","CBC, CRP","Blood cultures if systemic","Rule out abscess/DVT"],
      red:["Necrotizing infection if pain out of proportion, crepitus, rapid spread"],
      empiric:"Cloxacillin / Cefazolin (cover Strep & MSSA); add MRSA cover per risk (see stewardship)",
      F:{ skin_redness:34, warm_tender_skin:30, fever:18, leg_swelling_unil:8, neutrophilia:10 } },

    { id:"dvt", name:"Deep vein thrombosis", system:"Vascular", infectious:false,
      tools:[], inv:["Compression ultrasound (Doppler)","D-dimer","Wells score"],
      red:["Anticoagulation, not antibiotics"], mimicOf:["cellulitis"],
      F:{ leg_swelling_unil:36, calf_tenderness:30, skin_redness:10, warm_tender_skin:-8, fever:-12 } },

    /* ---- Metabolic emergency (activates protocol, not antibiotics) ---- */
    { id:"dka", name:"Diabetic ketoacidosis", system:"Endocrine", infectious:false,
      tools:["dka"], inv:["ABG / venous gas","Blood & urine ketones","Glucose, electrolytes","Search for precipitant (infection)"],
      red:["DKA protocol: fluids, insulin infusion, K⁺ monitoring","Look for precipitating infection"], mimicOf:["sepsis_enceph"],
      F:{ polyuria:30, ketonemia:40, diabetic:24, dyspnea:8, altered_sensorium:10, fever:-6 } }
  ];

  var DMAP = {}; DISEASES.forEach(function (d) { DMAP[d.id] = d; });

  /* ---------------------------------------------------------------------- *
   * 3. ENGINE
   * ---------------------------------------------------------------------- */
  var state = { entered: {}, chief: null, prevRank: {} }; // entered: id->true

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function score(d) {
    var s = 0, any = false;
    for (var f in d.F) {
      if (state.entered[f]) { s += d.F[f]; any = true; }
    }
    return { score: clamp(Math.round(s), 0, 100), any: any };
  }

  function supporting(d) {
    var a = [];
    for (var f in d.F) { if (state.entered[f] && d.F[f] > 0) a.push({ f: f, w: d.F[f] }); }
    return a.sort(function (x, y) { return y.w - x.w; });
  }
  function contradictory(d) {
    var a = [];
    for (var f in d.F) { if (state.entered[f] && d.F[f] < 0) a.push({ f: f, w: d.F[f] }); }
    return a.sort(function (x, y) { return x.w - y.w; });
  }
  function missing(d) {
    var a = [];
    for (var f in d.F) { if (!state.entered[f] && d.F[f] >= 12) a.push({ f: f, w: d.F[f] }); }
    return a.sort(function (x, y) { return y.w - x.w; }).slice(0, 4);
  }

  // candidate diseases = those with >=1 entered supporting finding
  function ranked() {
    var rows = [];
    DISEASES.forEach(function (d) {
      var sc = score(d);
      if (sc.any && sc.score > 0) rows.push({ d: d, score: sc.score });
    });
    rows.sort(function (a, b) { return b.score - a.score || a.d.name.localeCompare(b.d.name); });
    return rows;
  }

  // infection-likelihood gate
  function infectionGate(rows) {
    if (!rows.length) return { cls: "none", topInf: 0, lead: null };
    var topInf = 0, topNon = 0, infLead = null;
    rows.forEach(function (r) {
      if (r.d.infectious) { if (r.score > topInf) { topInf = r.score; infLead = r.d; } }
      else { if (r.score > topNon) topNon = r.score; }
    });
    var lead = rows[0];
    var leadInf = lead.d.infectious;
    var cls;
    // antibiotics are gated on infection being the LEADING diagnosis, not merely present
    if (leadInf && lead.score >= 80) cls = "very_likely";
    else if (leadInf && lead.score >= 62) cls = "likely";
    else if (topInf >= 42 && topInf >= topNon - 10) cls = "possible"; // infection competitive but not leading
    else if (topInf >= 35) cls = "possible";
    else if (topNon > topInf) cls = "noninfective";
    else if (topInf > 0) cls = "unlikely";
    else cls = "noninfective";
    return { cls: cls, topInf: topInf, lead: infLead, leadAll: lead.d, topNon: topNon };
  }

  var GATE = {
    very_likely:  { t: "Infection very likely", c: "g-red",    ab: true,  msg: "Empiric antimicrobial therapy is appropriate — see stewardship recommendation." },
    likely:       { t: "Infection likely",       c: "g-orange", ab: true,  msg: "Infection leads the differential — empiric therapy may be warranted after cultures." },
    possible:     { t: "Infection possible",      c: "g-amber",  ab: false, msg: "Infection is in the differential but not dominant — pursue targeted investigations before antibiotics." },
    unlikely:     { t: "Infection unlikely",      c: "g-teal",   ab: false, msg: "Infection is low on the differential — antibiotics not recommended yet; investigate alternatives." },
    noninfective: { t: "Non-infectious diagnosis favored", c: "g-slate", ab: false, msg: "A non-infectious cause currently leads — antibiotics not recommended. Address the leading diagnosis." },
    none:         { t: "Enter findings to begin", c: "g-slate", ab: false, msg: "" }
  };

  /* ---------------------------------------------------------------------- *
   * 4. UI
   * ---------------------------------------------------------------------- */
  var root = null, expanded = {};

  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "dxOverlay";
    root.className = "dx-overlay";
    root.innerHTML =
      '<div class="dx-top">' +
        '<button class="dx-back" id="dxClose" aria-label="Close reasoning">‹ Close</button>' +
        '<div class="dx-title">Clinical Reasoning <span class="dx-beta">beta</span></div>' +
        '<button class="dx-reset" id="dxReset" title="Start over">Reset</button>' +
      '</div>' +
      '<div class="dx-body">' +
        '<div class="dx-discl">Decision support — updates live as you add findings. StewardMD supports, but does not replace, your clinical judgment. Nothing here is a confirmed diagnosis.</div>' +
        '<div id="dxChief" class="dx-chief"></div>' +
        '<div id="dxPicker" class="dx-picker" style="display:none"></div>' +
        '<div id="dxGate" class="dx-gate"></div>' +
        '<div id="dxChanged" class="dx-changed" style="display:none"></div>' +
        '<div class="dx-ddx-h" id="dxDdxH" style="display:none">Differential diagnosis <span class="dx-sub">— ranked by Clinical Confidence Score</span></div>' +
        '<div id="dxList" class="dx-list"></div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector("#dxClose").addEventListener("click", close);
    root.querySelector("#dxReset").addEventListener("click", function(){ resetAll(); });
    return root;
  }

  function chipHTML(fid, on){
    return '<button class="dx-chip'+(on?" on":"")+'" data-f="'+fid+'">'+esc(F[fid].label)+(on?' ✓':'')+'</button>';
  }

  function renderChief() {
    var el = root.querySelector("#dxChief");
    if (state.chief) { el.style.display = "none"; return; }
    el.style.display = "";
    el.innerHTML = '<div class="dx-q">What is the chief complaint?</div><div class="dx-cc">' +
      CHIEF.map(function (c) { return '<button class="dx-cc-btn" data-f="' + c.f + '">' + esc(c.label) + '</button>'; }).join("") +
      '</div>';
    el.querySelectorAll(".dx-cc-btn").forEach(function (b) {
      b.addEventListener("click", function () { state.chief = b.getAttribute("data-f"); state.entered[state.chief] = true; recompute(); });
    });
  }

  // findings picker — grouped by category, only categories relevant to current candidates
  var CAT_ORDER = [["symptom","Symptoms"],["sign","Signs"],["vital","Vitals"],["lab","Labs"],["micro","Microbiology"],["imaging","Imaging"],["risk","Risk factors"]];
  function renderPicker() {
    var el = root.querySelector("#dxPicker");
    if (!state.chief) { el.style.display = "none"; return; }
    el.style.display = "";
    // relevant findings = union of features across current candidate diseases
    var rel = {};
    ranked().forEach(function (r) { for (var f in r.d.F) rel[f] = true; });
    // if very few candidates, include all findings
    var pool = Object.keys(rel).length >= 6 ? rel : F;
    var html = '<div class="dx-q">Add findings <span class="dx-sub">— tap what is present</span></div>';
    CAT_ORDER.forEach(function (c) {
      var ids = Object.keys(F).filter(function (f) { return F[f].cat === c[0] && (pool === F || pool[f]); });
      if (!ids.length) return;
      html += '<div class="dx-cat"><div class="dx-cat-h">' + c[1] + '</div><div class="dx-chips">' +
        ids.map(function (f) { return chipHTML(f, !!state.entered[f]); }).join("") + '</div></div>';
    });
    el.innerHTML = html;
    el.querySelectorAll(".dx-chip").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = b.getAttribute("data-f");
        if (state.entered[f]) delete state.entered[f]; else state.entered[f] = true;
        recompute();
      });
    });
  }

  function gateHTML(g) {
    var info = GATE[g.cls];
    var sourceNote = "";
    if (info.ab && g.lead) {
      sourceNote = '<div class="dx-handoff"><button class="dx-handoff-btn" id="dxHandoff">View stewardship recommendation →</button>' +
        '<div class="dx-src">Recommendation source: national / international guidance · <em>hospital policy (GIMSR) integration next</em></div></div>';
    }
    var empiric = (info.ab && g.lead && g.lead.empiric)
      ? '<div class="dx-empiric"><b>Suggested empiric (' + esc(g.lead.name) + '):</b> ' + esc(g.lead.empiric) + '</div>' : "";
    return '<div class="dx-gate-card ' + info.c + '">' +
        '<div class="dx-gate-t">' + esc(info.t) + '</div>' +
        (info.msg ? '<div class="dx-gate-m">' + esc(info.msg) + '</div>' : "") +
        empiric + sourceNote +
      '</div>';
  }

  function diseaseCard(r, idx) {
    var d = r.d, open = expanded[d.id];
    var sup = supporting(d), con = contradictory(d), mis = missing(d);
    var tag = d.infectious ? '<span class="dx-tag inf">infectious</span>' : '<span class="dx-tag non">non-infectious</span>';
    var mim = (d.mimicOf || []).map(function (m) { return DMAP[m] ? DMAP[m].name : m; });
    var head =
      '<div class="dx-row-head" data-id="' + d.id + '">' +
        '<div class="dx-rank">' + (idx + 1) + '</div>' +
        '<div class="dx-row-main">' +
          '<div class="dx-row-name">' + esc(d.name) + ' ' + tag + '</div>' +
          '<div class="dx-bar"><span style="width:' + r.score + '%"></span></div>' +
          '<div class="dx-row-sys">' + esc(d.system) + (mim.length ? ' · mimic of ' + esc(mim.join(", ")) : '') + '</div>' +
        '</div>' +
        '<div class="dx-score">' + r.score + '<small>/100</small></div>' +
      '</div>';
    if (!open) return '<div class="dx-card">' + head + '</div>';
    function line(items, cls, sign) {
      return items.map(function (x) { return '<span class="dx-f ' + cls + '">' + (sign || '') + esc(F[x.f] ? F[x.f].label : x.f) + '</span>'; }).join("");
    }
    var det =
      '<div class="dx-detail">' +
        (sup.length ? '<div class="dx-d-row"><b>Supporting</b><div>' + line(sup, "sup", "✓ ") + '</div></div>' : '') +
        (con.length ? '<div class="dx-d-row"><b>Contradictory</b><div>' + line(con, "con", "• ") + '</div></div>' : '') +
        (mis.length ? '<div class="dx-d-row"><b>Missing / would help</b><div>' + line(mis, "mis", "? ") + '</div></div>' : '') +
        (d.inv ? '<div class="dx-d-row"><b>Recommended investigations</b><ul>' + d.inv.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join("") + '</ul></div>' : '') +
        (d.red ? '<div class="dx-d-row red"><b>Red flags</b><ul>' + d.red.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join("") + '</ul></div>' : '') +
        (d.empiric && d.infectious ? '<div class="dx-d-row"><b>Empiric therapy</b><div>' + esc(d.empiric) + '</div></div>' : '') +
      '</div>';
    return '<div class="dx-card open">' + head + det + '</div>';
  }

  function renderChanged(rows, gate) {
    var el = root.querySelector("#dxChanged");
    var now = {}; rows.forEach(function (r, i) { now[r.d.id] = { rank: i + 1, score: r.score }; });
    var msgs = [];
    rows.slice(0, 6).forEach(function (r) {
      var p = state.prevRank[r.d.id];
      if (!p) { if (Object.keys(state.prevRank).length) msgs.push("▲ " + r.d.name + " entered the differential"); }
      else if (now[r.d.id].rank < p.rank) msgs.push("▲ " + r.d.name + " rose to #" + now[r.d.id].rank);
      else if (now[r.d.id].rank > p.rank) msgs.push("▼ " + r.d.name + " fell to #" + now[r.d.id].rank);
    });
    if (msgs.length) { el.style.display = ""; el.innerHTML = '<b>What changed</b> ' + msgs.slice(0, 3).map(esc).join(" · "); }
    else el.style.display = "none";
    state.prevRank = now;
  }

  function recompute() {
    if (!root) return;
    renderChief(); renderPicker();
    var rows = ranked();
    var gate = infectionGate(rows);
    root.querySelector("#dxGate").innerHTML = state.chief ? gateHTML(gate) : "";
    var h = root.querySelector("#dxDdxH"); h.style.display = rows.length ? "" : "none";
    root.querySelector("#dxList").innerHTML = rows.map(function (r, i) { return diseaseCard(r, i); }).join("") ||
      (state.chief ? '<div class="dx-empty">Add findings above to build the differential.</div>' : "");
    // wire expand
    root.querySelectorAll(".dx-row-head").forEach(function (hd) {
      hd.addEventListener("click", function () { var id = hd.getAttribute("data-id"); expanded[id] = !expanded[id]; recompute(); });
    });
    var ho = root.querySelector("#dxHandoff");
    if (ho) ho.addEventListener("click", function () { handoff(gate.lead); });
    renderChanged(rows, gate);
  }

  function handoff(d) {
    // Phase 1: open the existing stewardship console; deep syndrome-linking comes in P2.
    try {
      if (window.ASP && typeof window.ASP.open === "function") {
        if (d && d.treat && window.ASP_DATA && window.ASP_DATA[d.treat] && typeof window.ASP.openSyndrome === "function") {
          window.ASP.openSyndrome(d.treat);
        } else { window.ASP.open(); }
        return;
      }
    } catch (e) {}
    alert("Stewardship module is loading — please try again.");
  }

  function resetAll(){ state.entered = {}; state.chief = null; state.prevRank = {}; expanded = {}; recompute(); }

  function open() { ensureRoot(); root.classList.add("on"); document.body.classList.add("dx-lock"); recompute(); }
  function close() { if (root) { root.classList.remove("on"); document.body.classList.remove("dx-lock"); } }

  /* ---------------------------------------------------------------------- *
   * 5. STYLES (injected) + launch button
   * ---------------------------------------------------------------------- */
  function injectCSS() {
    var css = [
      ".dx-overlay{position:fixed;inset:0;z-index:850;background:var(--paper);display:none;flex-direction:column;overflow:hidden;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}",
      ".dx-overlay.on{display:flex}",
      "body.dx-lock{overflow:hidden}",
      ".dx-top{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel);border-bottom:1px solid var(--line);z-index:2}",
      ".dx-back,.dx-reset{background:transparent;border:1px solid var(--line);border-radius:9px;height:34px;padding:0 12px;font:600 13px var(--sans);color:var(--ink);cursor:pointer}",
      ".dx-back{color:var(--teal);border-color:var(--teal)}",
      ".dx-title{flex:1;text-align:center;font:700 16px var(--sans);color:var(--ink)}",
      ".dx-beta{font-size:10px;background:var(--teal-soft);color:var(--teal);border-radius:6px;padding:1px 6px;vertical-align:middle;font-weight:700}",
      ".dx-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;max-width:760px;margin:0 auto;width:100%;padding-bottom:calc(40px + env(safe-area-inset-bottom))}",
      ".dx-discl{font:500 11.5px var(--sans);color:var(--slate-soft);background:var(--teal-soft);border-radius:10px;padding:9px 12px;margin-bottom:14px;line-height:1.5}",
      ".dx-q{font:700 14px var(--sans);color:var(--ink);margin:6px 0 9px}",
      ".dx-sub{font-weight:500;color:var(--slate-soft);font-size:12px}",
      ".dx-cc{display:flex;flex-wrap:wrap;gap:9px}",
      ".dx-cc-btn{background:var(--panel);border:1.5px solid var(--line);border-radius:11px;padding:11px 15px;font:700 13.5px var(--sans);color:var(--ink);cursor:pointer;transition:all .15s}",
      ".dx-cc-btn:hover{border-color:var(--teal);color:var(--teal)}",
      ".dx-cat{margin:12px 0}",
      ".dx-cat-h{font:700 11px var(--sans);letter-spacing:.04em;text-transform:uppercase;color:var(--slate-soft);margin-bottom:7px}",
      ".dx-chips{display:flex;flex-wrap:wrap;gap:7px}",
      ".dx-chip{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:7px 12px;font:600 12.5px var(--sans);color:var(--slate);cursor:pointer;transition:all .12s}",
      ".dx-chip.on{background:var(--teal);border-color:var(--teal);color:#fff}",
      ".dx-gate{margin:16px 0 6px}",
      ".dx-gate-card{border-radius:13px;padding:13px 15px;border:1px solid var(--line)}",
      ".dx-gate-t{font:800 15px var(--sans)}",
      ".dx-gate-m{font:500 12.5px var(--sans);margin-top:4px;line-height:1.5;opacity:.92}",
      ".g-red{background:var(--red-bg);border-color:var(--red-line)}.g-red .dx-gate-t{color:var(--red)}",
      ".g-orange{background:var(--orange-bg);border-color:var(--orange-line)}.g-orange .dx-gate-t{color:var(--orange)}",
      ".g-amber{background:var(--yellow-bg);border-color:var(--yellow-line)}.g-amber .dx-gate-t{color:var(--yellow)}",
      ".g-teal{background:var(--teal-soft);border-color:var(--teal)}.g-teal .dx-gate-t{color:var(--teal)}",
      ".g-slate{background:var(--panel)}.g-slate .dx-gate-t{color:var(--slate)}",
      ".dx-empiric{margin-top:9px;font:500 12.5px var(--sans);color:var(--ink);background:var(--panel);border-radius:9px;padding:9px 11px;line-height:1.5}",
      ".dx-handoff{margin-top:10px}",
      ".dx-handoff-btn{background:var(--teal);border:none;color:#fff;border-radius:9px;padding:10px 14px;font:700 13px var(--sans);cursor:pointer}",
      ".dx-src{font:500 11px var(--sans);color:var(--slate-soft);margin-top:6px}",
      ".dx-changed{font:600 12px var(--sans);color:var(--slate);background:var(--panel);border:1px dashed var(--line);border-radius:9px;padding:8px 11px;margin:4px 0 10px}",
      ".dx-ddx-h{font:800 15px var(--sans);color:var(--ink);margin:14px 0 10px}",
      ".dx-list{display:flex;flex-direction:column;gap:9px}",
      ".dx-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}",
      ".dx-card.open{border-color:var(--teal)}",
      ".dx-row-head{display:flex;align-items:center;gap:11px;padding:11px 13px;cursor:pointer}",
      ".dx-rank{width:22px;height:22px;flex:0 0 auto;border-radius:50%;background:var(--teal-soft);color:var(--teal);font:800 12px var(--sans);display:flex;align-items:center;justify-content:center}",
      ".dx-row-main{flex:1;min-width:0}",
      ".dx-row-name{font:700 13.5px var(--sans);color:var(--ink)}",
      ".dx-tag{font-size:9.5px;font-weight:700;border-radius:5px;padding:1px 5px;vertical-align:middle;margin-left:5px}",
      ".dx-tag.inf{background:var(--red-bg);color:var(--red)}.dx-tag.non{background:var(--teal-soft);color:var(--teal)}",
      ".dx-bar{height:6px;border-radius:4px;background:var(--line);margin:6px 0 4px;overflow:hidden}",
      ".dx-bar span{display:block;height:100%;background:linear-gradient(90deg,var(--teal),#0a564e);border-radius:4px}",
      ".dx-row-sys{font:500 11px var(--sans);color:var(--slate-soft)}",
      ".dx-score{font:800 18px var(--sans);color:var(--ink);flex:0 0 auto}.dx-score small{font-size:10px;color:var(--slate-soft);font-weight:600}",
      ".dx-detail{padding:0 13px 13px;border-top:1px solid var(--line);margin-top:2px}",
      ".dx-d-row{margin-top:11px;font:500 12.5px var(--sans);color:var(--slate)}",
      ".dx-d-row b{display:block;font:700 11px var(--sans);text-transform:uppercase;letter-spacing:.03em;color:var(--slate-soft);margin-bottom:5px}",
      ".dx-d-row ul{margin:0;padding-left:18px}.dx-d-row li{margin:2px 0}",
      ".dx-d-row.red b{color:var(--red)}",
      ".dx-f{display:inline-block;border-radius:6px;padding:3px 8px;margin:0 5px 5px 0;font-size:12px;font-weight:600}",
      ".dx-f.sup{background:var(--green-bg);color:var(--green)}",
      ".dx-f.con{background:var(--red-bg);color:var(--red)}",
      ".dx-f.mis{background:var(--panel);border:1px dashed var(--line);color:var(--slate-soft)}",
      ".dx-empty{font:500 13px var(--sans);color:var(--slate-soft);padding:14px;text-align:center}",
      // launch button in header
      ".dx-launch{flex:0 0 auto;height:38px;border-radius:10px;border:1px solid var(--teal);background:var(--teal);color:#fff;font:700 12.5px var(--sans);padding:0 13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}"
    ].join("");
    var st = document.createElement("style");
    st.id = "dx-styles"; st.textContent = css;
    document.head.appendChild(st);
  }

  function injectLaunch() {
    var actions = document.querySelector(".app-head-actions");
    if (!actions) return;
    if (document.getElementById("dxLaunch")) return;
    var b = document.createElement("button");
    b.id = "dxLaunch"; b.className = "dx-launch"; b.type = "button";
    b.setAttribute("aria-label", "Open clinical reasoning");
    b.innerHTML = "🧠 Reasoning";
    b.addEventListener("click", open);
    actions.insertBefore(b, actions.firstChild);
  }

  function init() { injectCSS(); injectLaunch(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.DX = { open: open, close: close, reset: resetAll, _state: state, _diseases: DISEASES };
})();
