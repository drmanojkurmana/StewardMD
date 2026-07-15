/* calc-links.js — maps a diagnosis to the clinical calculators/scores that
   matter for it, and builds the suggestion-chip HTML. Exposes window.CALC_LINKS.
   Pure / no-DOM except chipsHTML (returns a string). Tolerates MEDCALC absent. */
(function () {
  "use strict";

  /* Curated, high-confidence: DX diagnosis id -> ordered calculator ids. */
  var LINKS = {
    acute_pancreatitis: ["bisap", "glasgow_imrie", "ranson", "apache2"],
    chronic_pancreatitis: ["bisap"],
    upper_gi_bleed: ["gbs", "rockall", "aims65"],
    variceal_bleed: ["gbs", "rockall", "childpugh", "meld"],
    cirrhosis: ["childpugh", "meld", "meld_na", "meld3"],
    alcoholic_hepatitis: ["maddrey", "meld", "childpugh"],
    nafld: ["fib4", "nafld_fibrosis", "hsi", "bard"],
    dka: ["anion_gap", "corr_na", "effective_osm"],
    sepsis: ["sofa", "qsofa", "news2", "sirs"],
    septic_shock: ["sofa", "qsofa", "news2"],
    community_acquired_pneumonia: ["curb65", "crb65", "psi", "smartcop"],
    copd_exacerbation: ["decaf", "cat_copd", "gold_group", "mmrc_dyspnoea"],
    pulmonary_embolism: ["wells_pe", "perc", "pesi", "years_pe"],
    dvt: ["wells_dvt"],
    ischemic_stroke: ["nihss", "abcd2", "dragon", "thrive"],
    subarachnoid_haemorrhage: ["hunt_hess", "wfns", "modified_fisher"],
    intracerebral_haemorrhage: ["ich", "abc2_ich_volume"],
    atrial_fibrillation: ["chadsvasc", "hasbled", "atria_bleed"],
    acute_coronary_syndrome: ["heart", "timi_nstemi"],
    heart_failure: ["nyha", "h2fpef", "epvs"],
    hepatic_encephalopathy: ["west_haven", "childpugh"],
    acute_kidney_injury: ["kdigo_aki", "fena", "feurea"],
    aki: ["kdigo_aki", "fena", "feurea"],
    appendicitis: ["alvarado", "air_score"],
    alcohol_withdrawal: ["ciwa"],
    opioid_withdrawal: ["cows"],
    subdural_haematoma: ["gcs"],
    meningitis: ["bacterial_meningitis_score"],
    febrile_neutropenia: ["mascc"],
    thrombotic_thrombocytopenic_purpura: ["plasmic"],
    heparin_induced_thrombocytopenia: ["hit_4ts"],
    disseminated_intravascular_coagulation: ["isth_dic"]
  };

  /* Keyword fallback: regex tested against disease name/text -> calculator ids. */
  var KW = [
    { re: /pancreatit/i, calcs: ["bisap", "glasgow_imrie", "ranson", "apache2"] },
    { re: /\b(sepsis|septic|septicaem)/i, calcs: ["sofa", "qsofa", "news2", "sirs"] },
    { re: /cirrhosis|hepatic failure|liver failure|decompensat/i, calcs: ["childpugh", "meld", "meld_na"] },
    { re: /alcoholic hepatitis/i, calcs: ["maddrey", "meld"] },
    { re: /(fatty liver|nafld|nash|steato)/i, calcs: ["fib4", "nafld_fibrosis", "hsi", "bard"] },
    { re: /variceal|oesophageal varic|esophageal varic/i, calcs: ["gbs", "rockall", "childpugh"] },
    { re: /(upper gi|peptic ulcer).{0,12}(bleed|haemorrh|hemorrh)|melaena|haematemesis/i, calcs: ["gbs", "rockall", "aims65"] },
    { re: /(diabetic ketoacidosis|\bdka\b|hyperosmolar|\bhhs\b)/i, calcs: ["anion_gap", "corr_na", "effective_osm"] },
    { re: /pneumonia/i, calcs: ["curb65", "crb65", "psi", "smartcop"] },
    { re: /copd|chronic obstructive/i, calcs: ["decaf", "cat_copd", "gold_group", "mmrc_dyspnoea"] },
    { re: /pulmonary embolism|\bpe\b/i, calcs: ["wells_pe", "perc", "pesi", "years_pe"] },
    { re: /deep vein thromb|\bdvt\b/i, calcs: ["wells_dvt"] },
    { re: /ischaemic stroke|ischemic stroke|cerebral infarct/i, calcs: ["nihss", "abcd2", "dragon", "thrive"] },
    { re: /transient ischaemic|transient ischemic|\btia\b/i, calcs: ["abcd2"] },
    { re: /subarachnoid/i, calcs: ["hunt_hess", "wfns", "modified_fisher"] },
    { re: /intracerebral h(a)?emorrh|\bich\b/i, calcs: ["ich", "abc2_ich_volume"] },
    { re: /atrial fibrillation|\baf\b/i, calcs: ["chadsvasc", "hasbled", "atria_bleed"] },
    { re: /acute coronary|myocardial infarct|\bnstemi\b|\bstemi\b|unstable angina/i, calcs: ["heart", "timi_nstemi"] },
    { re: /heart failure|cardiac failure/i, calcs: ["nyha", "h2fpef", "epvs"] },
    { re: /encephalopath/i, calcs: ["west_haven"] },
    { re: /(acute kidney|\baki\b|acute renal)/i, calcs: ["kdigo_aki", "fena", "feurea"] },
    { re: /appendicit/i, calcs: ["alvarado", "air_score"] },
    { re: /alcohol withdrawal/i, calcs: ["ciwa"] },
    { re: /opioid withdrawal/i, calcs: ["cows"] },
    { re: /meningitis/i, calcs: ["bacterial_meningitis_score"] },
    { re: /neutropenic (fever|sepsis)|febrile neutropen/i, calcs: ["mascc"] },
    { re: /kawasaki/i, calcs: ["kawasaki"] }
  ];

  function calcsById() {
    var m = {};
    var arr = (window.MEDCALC && window.MEDCALC._calcs) || [];
    for (var i = 0; i < arr.length; i++) m[arr[i].id] = arr[i];
    return m;
  }
  function filterExisting(ids) {
    var m = calcsById(), out = [], seen = {};
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (m[id] && !seen[id]) { seen[id] = 1; out.push(id); }
    }
    return out.slice(0, 6);
  }
  function forDisease(id, name) {
    var ids = (id && LINKS[id]) ? LINKS[id].slice() : [];
    if (name) KW.forEach(function (r) { if (r.re.test(name)) ids = ids.concat(r.calcs); });
    return filterExisting(ids);
  }
  function forText(text) {
    if (!text) return [];
    var ids = [];
    KW.forEach(function (r) { if (r.re.test(text)) ids = ids.concat(r.calcs); });
    return filterExisting(ids);
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function chipsHTML(ids) {
    if (!ids || !ids.length) return "";
    var m = calcsById();
    var chips = ids.map(function (id) {
      var c = m[id]; if (!c) return "";
      return '<button type="button" class="cl-chip" data-calc="' + esc(id) + '">' + esc(c.title || id) + '</button>';
    }).join("");
    if (!chips) return "";
    return '<div class="cl-scores"><div class="cl-scores-h">📊 Relevant scores</div><div class="cl-scores-row">' + chips + '</div></div>';
  }

  window.CALC_LINKS = { LINKS: LINKS, KW: KW, forDisease: forDisease, forText: forText, chipsHTML: chipsHTML };
})();
