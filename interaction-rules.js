/* ============================================================================
   StewardMD — Drug–Drug Interaction Ruleset (versioned, browser module)
   ----------------------------------------------------------------------------
   ⚠️  CURATED STARTER DATASET — REQUIRES CLINICIAN SIGN-OFF BEFORE CLINICAL USE.
   This is a small, hand-curated STARTER set of well-established, clinically
   important drug–drug interactions. It is NOT exhaustive and does NOT replace a
   maintained interaction database, a pharmacist, or the primary drug label.
   Absence of a rule here does NOT mean two drugs are safe together.

   Sources are OPEN / permissioned only. Rules were curated (not copied verbatim)
   from:
     • ONC / NLM "High-Priority Drug–Drug Interactions" list (public domain, US
       Federal Government work),
     • openFDA structured drug labeling (public domain US Government data),
     • CredibleMeds QTdrugs categories (used for QT-prolongation class membership
       under their public educational terms — verify licence before commercial use).
   No proprietary interaction database (e.g. commercial DDI compendia) was copied.

   Every rule carries a reviewDate and sourceId. All rules MUST be reviewed and
   signed off by a qualified clinician / pharmacist before being surfaced as
   clinical guidance. Severities are indicative and follow common conventions
   (contraindicated > major > moderate > minor; "monitor" = monitoring advised).

   Exposes: window.INTERACTION_RULES (read-only data; no engine here).
   Load order: this file MUST load BEFORE medlist.js.
   ========================================================================== */
(function () {
  "use strict";

  /* --------------------------------------------------------------------------
     Pharmacologic class map.
     Maps a lowercase generic name -> array of class tags used by the rules
     below. Kept intentionally minimal: only the generics needed to fire the
     curated rules. Class tags are internal identifiers (snake_case).
     A drug may belong to several classes (e.g. citalopram is an SSRI, is
     serotonergic, and prolongs the QT interval).
     -------------------------------------------------------------------------- */
  var drugClasses = {
    // --- Antiplatelets / NSAIDs ---
    // Aspirin is an antiplatelet AND has NSAID pharmacology; tagged as both so
    // it contributes to both antiplatelet and NSAID/bleeding logic.
    "aspirin":        ["antiplatelet", "nsaid"],
    "ibuprofen":      ["nsaid"],
    "diclofenac":     ["nsaid"],
    "naproxen":       ["nsaid"],
    "ketorolac":      ["nsaid"],
    "clopidogrel":    ["antiplatelet"],

    // --- Anticoagulants ---
    "warfarin":       ["anticoagulant", "vitamin_k_antagonist"],
    "enoxaparin":     ["anticoagulant", "lmwh"],
    "heparin":        ["anticoagulant"],
    "dabigatran":     ["anticoagulant", "doac"],
    "rivaroxaban":    ["anticoagulant", "doac"],
    "apixaban":       ["anticoagulant", "doac"],

    // --- RAAS: ACE inhibitors / ARBs ---
    "ramipril":       ["ace_inhibitor", "raas"],
    "enalapril":      ["ace_inhibitor", "raas"],
    "lisinopril":     ["ace_inhibitor", "raas"],
    "perindopril":    ["ace_inhibitor", "raas"],
    "telmisartan":    ["arb", "raas"],
    "losartan":       ["arb", "raas"],
    "valsartan":      ["arb", "raas"],

    // --- Diuretics ---
    "furosemide":     ["loop_diuretic", "diuretic"],
    "bumetanide":     ["loop_diuretic", "diuretic"],
    "torasemide":     ["loop_diuretic", "diuretic"],
    "hydrochlorothiazide": ["thiazide_diuretic", "diuretic"],
    "indapamide":     ["thiazide_diuretic", "diuretic"],
    "spironolactone": ["potassium_sparing_diuretic", "diuretic", "aldosterone_antagonist"],
    "eplerenone":     ["potassium_sparing_diuretic", "diuretic", "aldosterone_antagonist"],
    "amiloride":      ["potassium_sparing_diuretic", "diuretic"],

    // --- QT-prolonging drugs (CredibleMeds categories) ---
    "ondansetron":    ["qt_prolonging"],
    "haloperidol":    ["qt_prolonging", "antipsychotic"],
    "amiodarone":     ["qt_prolonging", "antiarrhythmic"],
    "sotalol":        ["qt_prolonging", "antiarrhythmic"],
    "moxifloxacin":   ["qt_prolonging", "fluoroquinolone"],
    "erythromycin":   ["qt_prolonging", "macrolide", "cyp3a4_inhibitor"],

    // --- SSRIs / serotonergic ---
    "citalopram":     ["ssri", "serotonergic", "qt_prolonging"],
    "escitalopram":   ["ssri", "serotonergic", "qt_prolonging"],
    "sertraline":     ["ssri", "serotonergic"],
    "fluoxetine":     ["ssri", "serotonergic"],
    "paroxetine":     ["ssri", "serotonergic"],
    "venlafaxine":    ["snri", "serotonergic"],
    "duloxetine":     ["snri", "serotonergic"],
    "linezolid":      ["mao_inhibitor", "serotonergic", "antibiotic"],

    // --- Opioids / CNS depressants ---
    "tramadol":       ["opioid", "serotonergic"],
    "morphine":       ["opioid"],
    "fentanyl":       ["opioid"],
    "oxycodone":      ["opioid"],
    "codeine":        ["opioid"],
    "diazepam":       ["benzodiazepine", "cns_depressant"],
    "lorazepam":      ["benzodiazepine", "cns_depressant"],
    "midazolam":      ["benzodiazepine", "cns_depressant"],
    "clonazepam":     ["benzodiazepine", "cns_depressant"],

    // --- Statins ---
    "atorvastatin":   ["statin"],
    "simvastatin":    ["statin"],
    "rosuvastatin":   ["statin"],
    "pravastatin":    ["statin"],

    // --- Macrolides / azoles (CYP3A4 inhibitors) ---
    "clarithromycin": ["macrolide", "cyp3a4_inhibitor"],
    "azithromycin":   ["macrolide"],
    "ketoconazole":   ["azole_antifungal", "cyp3a4_inhibitor"],
    "itraconazole":   ["azole_antifungal", "cyp3a4_inhibitor"],
    "fluconazole":    ["azole_antifungal", "cyp3a4_inhibitor"],
    "voriconazole":   ["azole_antifungal", "cyp3a4_inhibitor"],

    // --- Others referenced by pair rules ---
    "methotrexate":   ["dmard", "antifolate"],
    "digoxin":        ["cardiac_glycoside"]
  };

  /* --------------------------------------------------------------------------
     Rule definitions.
     Rule shape:
       { id, type, subjects:[{kind,value}], severity, mechanism, effect,
         action, monitoring, sourceId, evidence, reviewDate,
         doseTimingSeparation, specialistReview }
     type:      "pair" | "duplicate_generic" | "duplicate_class"
                | "combination" | "context"
     subjects:  kind is "generic" | "class"; value is a generic name or a
                class tag. For "context" rules a subject may be a
                kind:"context" pseudo-value describing patient state.
     -------------------------------------------------------------------------- */
  var rules = [
    /* ==================== PAIR RULES ==================== */
    {
      id: "pair-warfarin-nsaid",
      type: "pair",
      subjects: [{ kind: "generic", value: "warfarin" }, { kind: "class", value: "nsaid" }],
      severity: "major",
      mechanism: "NSAIDs inhibit platelet function and cause gastric mucosal injury; some also displace warfarin from protein binding and inhibit its metabolism, increasing anticoagulant effect.",
      effect: "Markedly increased risk of gastrointestinal and other serious bleeding; INR may rise.",
      action: "Avoid the combination where possible. If an NSAID is unavoidable, use the lowest dose for the shortest time, add gastroprotection (PPI), and monitor closely.",
      monitoring: "Check INR within a few days of starting/stopping the NSAID; watch for GI bleeding (melaena, drop in haemoglobin).",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "pair-warfarin-aspirin",
      type: "pair",
      subjects: [{ kind: "generic", value: "warfarin" }, { kind: "generic", value: "aspirin" }],
      severity: "major",
      mechanism: "Additive haemostatic impairment: warfarin inhibits vitamin-K–dependent clotting factors while aspirin irreversibly inhibits platelet aggregation and injures gastric mucosa.",
      effect: "Substantially increased risk of major and gastrointestinal bleeding.",
      action: "Use together only for a clear evidence-based indication (e.g. certain mechanical valves or recent ACS on specialist advice). Otherwise avoid; add gastroprotection when combined.",
      monitoring: "Monitor INR and for signs of bleeding; confirm the combination remains indicated at each review.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: true
    },
    {
      id: "pair-warfarin-macrolide-azole",
      type: "pair",
      subjects: [{ kind: "generic", value: "warfarin" }, { kind: "class", value: "cyp3a4_inhibitor" }],
      severity: "major",
      mechanism: "Macrolide and azole antimicrobials inhibit CYP enzymes (notably CYP3A4/CYP2C9) that metabolise warfarin, and may also disturb gut flora that produce vitamin K, potentiating anticoagulation.",
      effect: "Rise in INR with increased bleeding risk during and shortly after the course.",
      action: "Anticipate an INR rise; consider a pre-emptive warfarin dose reduction and choose a lower-interaction antimicrobial where feasible.",
      monitoring: "Check INR 3–5 days after starting the antimicrobial and again after it finishes; adjust warfarin dose accordingly.",
      sourceId: "openfda-labeling",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "pair-ace-potassium-sparing",
      type: "pair",
      subjects: [{ kind: "class", value: "ace_inhibitor" }, { kind: "class", value: "potassium_sparing_diuretic" }],
      severity: "major",
      mechanism: "ACE inhibitors reduce aldosterone and thus renal potassium excretion; potassium-sparing diuretics independently retain potassium. The effects are additive.",
      effect: "Risk of significant hyperkalaemia, which can cause life-threatening arrhythmias, especially in renal impairment.",
      action: "Use together only with a clear indication (e.g. heart failure). Start low, avoid potassium supplements/salt substitutes, and correct renal impairment first.",
      monitoring: "Check serum potassium and renal function within 1 week of starting or dose change, then periodically.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "pair-methotrexate-nsaid",
      type: "pair",
      subjects: [{ kind: "generic", value: "methotrexate" }, { kind: "class", value: "nsaid" }],
      severity: "major",
      mechanism: "NSAIDs reduce renal blood flow and compete for renal tubular secretion of methotrexate, reducing its clearance and raising plasma levels — most dangerous with high-dose methotrexate.",
      effect: "Methotrexate accumulation causing myelosuppression, mucositis, hepatotoxicity and nephrotoxicity.",
      action: "Avoid NSAIDs with high-dose methotrexate. With low-dose weekly methotrexate, use NSAIDs cautiously at stable doses with monitoring.",
      monitoring: "Monitor full blood count, renal and liver function; watch for mucositis and signs of toxicity.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: true
    },
    {
      id: "pair-digoxin-amiodarone",
      type: "pair",
      subjects: [{ kind: "generic", value: "digoxin" }, { kind: "generic", value: "amiodarone" }],
      severity: "major",
      mechanism: "Amiodarone inhibits P-glycoprotein–mediated renal and biliary elimination of digoxin, raising serum digoxin concentrations.",
      effect: "Digoxin toxicity (nausea, visual disturbance, bradyarrhythmias, heart block) as levels roughly double.",
      action: "Reduce the digoxin dose (commonly by about half) when starting amiodarone and re-titrate to level and clinical response.",
      monitoring: "Check serum digoxin level and ECG/heart rate after starting amiodarone; monitor for toxicity.",
      sourceId: "openfda-labeling",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "pair-statin-macrolide-azole",
      type: "pair",
      subjects: [{ kind: "class", value: "statin" }, { kind: "class", value: "cyp3a4_inhibitor" }],
      severity: "major",
      mechanism: "Macrolide and azole CYP3A4 inhibitors reduce metabolism of CYP3A4-dependent statins (notably simvastatin and atorvastatin), raising statin exposure.",
      effect: "Increased risk of myopathy and rhabdomyolysis.",
      action: "Suspend simvastatin/atorvastatin during a short interacting course, or switch to a statin not dependent on CYP3A4 (e.g. pravastatin/rosuvastatin). Avoid high statin doses with strong inhibitors.",
      monitoring: "Advise the patient to report muscle pain/weakness or dark urine; check creatine kinase if symptomatic.",
      sourceId: "openfda-labeling",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },

    /* ==================== DUPLICATE-CLASS RULES ==================== */
    {
      id: "dup-nsaid",
      type: "duplicate_class",
      subjects: [{ kind: "class", value: "nsaid" }],
      severity: "moderate",
      mechanism: "Two NSAIDs give no additional analgesia but additive inhibition of protective prostaglandins in the GI tract and kidney.",
      effect: "Increased risk of GI ulceration/bleeding and renal impairment without added benefit.",
      action: "Do not co-prescribe two systemic NSAIDs. Consolidate to a single NSAID at the lowest effective dose.",
      monitoring: "Review renal function and for GI symptoms if any NSAID is continued.",
      sourceId: "openfda-labeling",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "dup-anticoagulant",
      type: "duplicate_class",
      subjects: [{ kind: "class", value: "anticoagulant" }],
      severity: "major",
      mechanism: "Two systemic anticoagulants produce additive impairment of coagulation.",
      effect: "Substantially increased bleeding risk.",
      action: "Avoid concurrent anticoagulants except during a deliberate, monitored bridging strategy. Review whether both are intended.",
      monitoring: "Monitor relevant coagulation parameters and for bleeding; confirm bridging is intentional.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: true
    },
    {
      id: "dup-antiplatelet",
      type: "duplicate_class",
      subjects: [{ kind: "class", value: "antiplatelet" }],
      severity: "moderate",
      mechanism: "Two antiplatelet agents additively inhibit platelet function.",
      effect: "Increased bleeding risk; justified only for defined indications (e.g. dual antiplatelet therapy after ACS/stent).",
      action: "Confirm dual antiplatelet therapy is intended and time-limited per guideline; otherwise reduce to one agent.",
      monitoring: "Monitor for bleeding; document the planned DAPT duration.",
      sourceId: "openfda-labeling",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "dup-raas",
      type: "duplicate_class",
      subjects: [{ kind: "class", value: "raas" }],
      severity: "major",
      mechanism: "Combining an ACE inhibitor and an ARB (dual RAAS blockade) produces additive suppression of angiotensin II.",
      effect: "Increased risk of hyperkalaemia, hypotension and acute kidney injury with little added benefit for most patients.",
      action: "Avoid routine dual RAAS blockade. Use only under specialist direction for selected indications.",
      monitoring: "If unavoidable, monitor potassium, renal function and blood pressure closely.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: true
    },
    {
      id: "dup-qt",
      type: "duplicate_class",
      subjects: [{ kind: "class", value: "qt_prolonging" }],
      severity: "major",
      mechanism: "Two QT-prolonging drugs additively delay cardiac repolarisation.",
      effect: "Increased risk of QT prolongation and torsades de pointes.",
      action: "Avoid combining QT-prolonging drugs where possible; correct electrolytes and minimise other QT risk factors.",
      monitoring: "Obtain a baseline and follow-up ECG (QTc); monitor and replete potassium and magnesium.",
      sourceId: "crediblemeds-qtdrugs",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "dup-cns-depressant",
      type: "duplicate_class",
      subjects: [{ kind: "class", value: "cns_depressant" }],
      severity: "major",
      mechanism: "Two centrally acting depressants (e.g. benzodiazepine plus another sedative) produce additive suppression of the central nervous system.",
      effect: "Excess sedation, respiratory depression and fall risk.",
      action: "Avoid stacking CNS depressants; use the lowest effective dose of a single agent and deprescribe where possible.",
      monitoring: "Monitor sedation level and respiratory rate; review need regularly.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "dup-serotonergic",
      type: "duplicate_class",
      subjects: [{ kind: "class", value: "serotonergic" }],
      severity: "major",
      mechanism: "Two serotonergic drugs additively increase central and peripheral serotonergic activity.",
      effect: "Risk of serotonin syndrome (agitation, clonus, hyperthermia, autonomic instability).",
      action: "Avoid combining serotonergic agents where possible; if combined, start low and counsel on warning symptoms.",
      monitoring: "Monitor for neuromuscular excitability, autonomic changes and mental-state change, especially after dose increases.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "dup-loop-diuretic",
      type: "duplicate_class",
      subjects: [{ kind: "class", value: "loop_diuretic" }],
      severity: "moderate",
      mechanism: "Two loop diuretics act at the same nephron site with additive diuresis.",
      effect: "Risk of volume depletion, hypotension, and electrolyte disturbance (hypokalaemia, hyponatraemia).",
      action: "Use a single loop diuretic titrated to effect; do not co-prescribe two.",
      monitoring: "Monitor fluid status, renal function and electrolytes.",
      sourceId: "openfda-labeling",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },

    /* ==================== COMBINATION (N-WAY) RULES ==================== */
    {
      id: "combo-bleeding-triad",
      type: "combination",
      subjects: [
        { kind: "class", value: "anticoagulant" },
        { kind: "class", value: "antiplatelet" },
        { kind: "class", value: "nsaid" }
      ],
      severity: "contraindicated",
      mechanism: "An anticoagulant, an antiplatelet and an NSAID together impair coagulation, platelet function and gastric mucosal protection simultaneously.",
      effect: "Very high risk of major and gastrointestinal haemorrhage.",
      action: "Avoid this triple combination. Review each agent's indication and stop the NSAID first; add gastroprotection while any overlap persists.",
      monitoring: "If temporarily unavoidable, monitor haemoglobin, coagulation and for overt bleeding, and set a firm stop date.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: true
    },
    {
      id: "combo-triple-whammy",
      type: "combination",
      subjects: [
        { kind: "class", value: "raas" },
        { kind: "class", value: "diuretic" },
        { kind: "class", value: "nsaid" }
      ],
      severity: "major",
      mechanism: "The 'triple whammy': a RAAS blocker (ACE inhibitor/ARB) plus a diuretic plus an NSAID together reduce renal perfusion (afferent and efferent) and volume, overwhelming renal autoregulation.",
      effect: "Acute kidney injury, especially in older or volume-depleted patients.",
      action: "Avoid adding an NSAID to a patient on a RAAS blocker plus a diuretic; if unavoidable use the shortest course with hydration.",
      monitoring: "Check renal function and electrolytes shortly after starting and during the NSAID course.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "combo-opioid-benzodiazepine",
      type: "combination",
      subjects: [
        { kind: "class", value: "opioid" },
        { kind: "class", value: "benzodiazepine" }
      ],
      severity: "major",
      mechanism: "Opioids and benzodiazepines both depress the central nervous system and respiratory drive through different mechanisms, producing additive/synergistic sedation.",
      effect: "Profound sedation, respiratory depression, coma and death.",
      action: "Avoid co-prescribing where possible (carries a boxed warning). If both are needed, use the lowest doses for the shortest duration and consider prescribing naloxone.",
      monitoring: "Monitor respiratory rate and sedation; counsel patient/carers on overdose signs.",
      sourceId: "openfda-labeling",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "combo-serotonin-syndrome",
      type: "combination",
      subjects: [
        { kind: "class", value: "serotonergic" },
        { kind: "class", value: "serotonergic" }
      ],
      severity: "major",
      mechanism: "Two or more serotonergic agents together markedly increase synaptic serotonin.",
      effect: "Serotonin syndrome: neuromuscular excitability (clonus, hyperreflexia), autonomic instability and altered mental state.",
      action: "Minimise the number of serotonergic agents; avoid combinations with MAO inhibitors (e.g. linezolid). Counsel on early warning symptoms.",
      monitoring: "Monitor for clonus, agitation, tremor, fever and autonomic changes, particularly after starting or increasing a dose.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "combo-qt-multi",
      type: "combination",
      subjects: [
        { kind: "class", value: "qt_prolonging" },
        { kind: "class", value: "qt_prolonging" }
      ],
      severity: "major",
      mechanism: "Two or more QT-prolonging drugs additively delay ventricular repolarisation; risk rises further with hypokalaemia, hypomagnesaemia and bradycardia.",
      effect: "Marked QTc prolongation with risk of torsades de pointes and sudden cardiac death.",
      action: "Reduce the number of QT-prolonging drugs; correct electrolytes and avoid combining known high-risk agents.",
      monitoring: "Baseline and follow-up ECG (QTc); maintain potassium >4.0 mmol/L and magnesium in range.",
      sourceId: "crediblemeds-qtdrugs",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },

    /* ==================== CONTEXT RULES ==================== */
    {
      id: "ctx-nsaid-renal-impairment",
      type: "context",
      subjects: [
        { kind: "class", value: "nsaid" },
        { kind: "context", value: "renal_impairment" }
      ],
      severity: "major",
      mechanism: "In renal impairment, prostaglandin-mediated renal perfusion becomes critical; NSAIDs block this compensatory vasodilation.",
      effect: "Worsening renal function, sodium/fluid retention and hyperkalaemia.",
      action: "Avoid NSAIDs in significant renal impairment; use alternative analgesia (e.g. paracetamol).",
      monitoring: "If unavoidable, monitor renal function, potassium and fluid status closely.",
      sourceId: "openfda-labeling",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "ctx-qt-prolonged-qtc",
      type: "context",
      subjects: [
        { kind: "class", value: "qt_prolonging" },
        { kind: "context", value: "prolonged_qtc" }
      ],
      severity: "major",
      mechanism: "Adding a QT-prolonging drug to a patient with an already prolonged QTc further delays repolarisation.",
      effect: "Increased risk of torsades de pointes.",
      action: "Avoid QT-prolonging drugs when the baseline QTc is prolonged; choose an alternative and correct reversible causes.",
      monitoring: "Repeat ECG; correct potassium and magnesium before and during therapy.",
      sourceId: "crediblemeds-qtdrugs",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    },
    {
      id: "ctx-ace-hyperkalaemia",
      type: "context",
      subjects: [
        { kind: "class", value: "ace_inhibitor" },
        { kind: "context", value: "hyperkalaemia" }
      ],
      severity: "major",
      mechanism: "ACE inhibitors reduce aldosterone-driven renal potassium excretion; in a patient who is already hyperkalaemic this compounds potassium retention.",
      effect: "Worsening hyperkalaemia with risk of cardiac arrhythmia.",
      action: "Do not start or up-titrate an ACE inhibitor during hyperkalaemia; correct potassium first and review contributory drugs.",
      monitoring: "Recheck serum potassium and renal function; obtain an ECG if potassium is markedly elevated.",
      sourceId: "onc-nlm-hpddi",
      evidence: "established",
      reviewDate: "2026-07-04",
      doseTimingSeparation: false,
      specialistReview: false
    }
  ];

  window.INTERACTION_RULES = {
    version: "0.1.0-starter",
    generated: "2026-07-04",
    sources: [
      {
        id: "onc-nlm-hpddi",
        title: "High-Priority Drug–Drug Interactions list",
        org: "ONC / U.S. National Library of Medicine",
        version: "public list (curated)",
        license: "U.S. Government work — public domain"
      },
      {
        id: "openfda-labeling",
        title: "openFDA Structured Product Labeling",
        org: "U.S. Food & Drug Administration",
        version: "openFDA drug/label endpoint",
        license: "U.S. Government work — public domain"
      },
      {
        id: "crediblemeds-qtdrugs",
        title: "QTdrugs List (QT-prolongation risk categories)",
        org: "CredibleMeds / AZCERT",
        version: "educational categories (curated)",
        license: "CredibleMeds public educational terms — verify licence before commercial use"
      }
    ],
    drugClasses: drugClasses,
    rules: rules
  };
})();
