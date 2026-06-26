/* ============================================================================
   StewardMD vNext — Dynamic Clinical Reasoning Engine (Phase 2)
   FULLY DATA-DRIVEN. The infectious differential is generated live from the
   entire StewardMD disease database (window.SYNDROMES) — every current and
   future syndrome auto-participates with NO new reasoning code. A parallel
   non-infectious knowledge layer (DDX_NI, same schema) drives the green
   differential. Symptom-first, live-updating, two-section (🔴/🟢), with a
   transparent Clinical Confidence Score and an infection gate that controls
   when the stewardship engine activates.
   Decision support only — never diagnostic. Pending clinician sign-off.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------- *
   * EXTRA presenting findings (generic symptoms not in the infection-focused
   * ontology). Merged with window.FIELD_GROUPS to give broad symptom-first
   * coverage. Adding entries here or to FIELD_GROUPS or to DDX_NI all flow
   * into the engine automatically.
   * ---------------------------------------------------------------------- */
  var EXTRA_GROUPS = [
    { group: "Presenting symptom", fields: [
      { key: "headache", label: "Headache" },
      { key: "thunderclapHeadache", label: "Thunderclap / worst-ever headache" },
      { key: "chestPain", label: "Chest pain" },
      { key: "pleuriticChestPain", label: "Pleuritic chest pain" },
      { key: "exertionalChestPain", label: "Exertional / pressure chest pain" },
      { key: "dyspnea", label: "Breathlessness (dyspnea)" },
      { key: "orthopnea", label: "Orthopnea / PND" },
      { key: "palpitations", label: "Palpitations" },
      { key: "backPain", label: "Back pain" },
      { key: "visualDisturbance", label: "Visual disturbance / loss" },
      { key: "polyarthralgia", label: "Joint pain (polyarticular)" },
      { key: "legSwellingUnilateral", label: "Unilateral leg swelling" },
      { key: "legSwellingBilateral", label: "Bilateral leg swelling / edema" },
      { key: "calfTenderness", label: "Calf tenderness" }
    ]},
    { group: "Signs & context", fields: [
      { key: "raisedJVP", label: "Raised JVP / peripheral edema" },
      { key: "bilateralCrackles", label: "Bilateral basal crackles" },
      { key: "asterixis", label: "Asterixis / flap" },
      { key: "ecgIschemia", label: "ECG: ischemic changes" },
      { key: "ketonemia", label: "Ketonemia / high anion-gap acidosis" },
      { key: "polyuriaPolydipsia", label: "Polyuria / polydipsia" },
      { key: "knownCAD", label: "Known coronary artery disease" },
      { key: "knownHeartFailure", label: "Known heart failure" },
      { key: "hypertensionHx", label: "Hypertension" },
      { key: "diabetesHx", label: "Diabetes mellitus" },
      { key: "steroidUse", label: "Chronic steroid use" },
      { key: "drugOverdose", label: "Sedative / drug overdose context" },
      { key: "anticoagulated", label: "On anticoagulation" },
      { key: "ageOver50", label: "Age > 50" }
    ]}
  ];

  /* ---------------------------------------------------------------------- *
   * NON-INFECTIOUS knowledge layer (data-driven, extensible).
   * find: { findingKey: weight }   positive raises, negative lowers.
   * Add entries freely — they automatically join the differential.
   * ---------------------------------------------------------------------- */
  var DDX_NI = [
    /* ---- Headache cluster ---- */
    { id:"migraine", name:"Migraine", system:"Neurology",
      find:{ headache:42, photophobia:18, visualDisturbance:16, nauseaVomiting:10, fever:-18, neckStiffness:-14, alteredSensorium:-12, focalNeuroDeficit:-6 },
      inv:["Clinical diagnosis (POUND criteria)","Neuroimaging only if red flags"], red:["New focal deficit, thunderclap onset, or fever → exclude secondary cause"],
      reason:"Recurrent headache with photophobia and nausea, no fever or meningism, favours primary migraine." },
    { id:"tension_ha", name:"Tension-type headache", system:"Neurology",
      find:{ headache:38, fever:-16, neckStiffness:-10, visualDisturbance:-6, focalNeuroDeficit:-8 },
      inv:["Clinical diagnosis"], red:["Atypical features warrant imaging"],
      reason:"Bilateral pressure-type headache without systemic or neurological red flags." },
    { id:"sah", name:"Subarachnoid hemorrhage", system:"Neurology / Vascular",
      find:{ thunderclapHeadache:55, headache:20, neckStiffness:22, alteredSensorium:18, seizure:8, ageOver50:6, fever:-6 },
      inv:["Non-contrast CT head (urgent)","LP for xanthochromia if CT negative","CT angiography"], red:["Thunderclap headache is SAH until proven otherwise — image immediately"],
      reason:"Sudden worst-ever headache ± meningism and reduced consciousness is classic for subarachnoid hemorrhage." },
    { id:"ischemic_stroke", name:"Acute ischemic stroke", system:"Neurology / Vascular",
      find:{ focalNeuroDeficit:46, alteredSensorium:16, ageOver50:10, hypertensionHx:8, headache:4, fever:-20, neckStiffness:-14 },
      inv:["Non-contrast CT head (urgent)","CT/MR angiography","Glucose (stroke mimic)"], red:["Time-critical — thrombolysis/thrombectomy window"],
      reason:"Acute focal neurological deficit favours a vascular event; image urgently and check the stroke pathway." },
    { id:"ich", name:"Intracerebral hemorrhage", system:"Neurology / Vascular",
      find:{ focalNeuroDeficit:36, headache:24, alteredSensorium:24, hypertensionHx:16, anticoagulated:16, ageOver50:6, fever:-10 },
      inv:["Non-contrast CT head (urgent)","Coagulation profile","BP control"], red:["Reverse anticoagulation; neurosurgical review"],
      reason:"Headache with focal deficit and reduced consciousness, especially with hypertension or anticoagulation, suggests intracerebral haemorrhage." },
    { id:"brain_tumour", name:"Brain tumour / mass lesion", system:"Neuro-oncology",
      find:{ headache:30, focalNeuroDeficit:22, seizure:18, visualDisturbance:12, weightLoss:8, alteredSensorium:8, fever:-10 },
      inv:["MRI brain with contrast","Refer neuro-oncology"], red:["Progressive headache, morning vomiting, papilloedema"],
      reason:"Progressive headache with focal signs or new seizures raises concern for an intracranial mass." },
    { id:"iih", name:"Idiopathic intracranial hypertension", system:"Neurology",
      find:{ headache:30, visualDisturbance:24, fever:-12, neckStiffness:-8 },
      inv:["Fundoscopy (papilloedema)","MRI + MR venography","LP with opening pressure"], red:["Progressive visual loss needs urgent treatment"],
      reason:"Headache with visual disturbance and papilloedema in the right demographic suggests raised intracranial pressure without a mass." },
    { id:"temporal_arteritis", name:"Giant cell (temporal) arteritis", system:"Rheumatology",
      find:{ headache:28, visualDisturbance:24, ageOver50:22, polyarthralgia:8, weightLoss:8 },
      inv:["ESR / CRP (markedly raised)","Temporal artery biopsy","Start high-dose steroids if suspected"], red:["Visual loss is an emergency — do not delay steroids"],
      reason:"New headache with visual symptoms in a patient over 50 with raised inflammatory markers suggests giant cell arteritis." },

    /* ---- Chest pain cluster ---- */
    { id:"acs", name:"Acute coronary syndrome", system:"Cardiology",
      find:{ exertionalChestPain:44, chestPain:24, ecgIschemia:30, knownCAD:18, diabetesHx:8, dyspnea:10, ageOver50:8, pleuriticChestPain:-12 },
      inv:["12-lead ECG (serial)","Troponin","Aspirin + cardiology referral"], red:["STEMI → immediate reperfusion pathway"],
      reason:"Pressure-type / exertional chest pain with ischaemic ECG or risk factors favours an acute coronary syndrome." },
    { id:"aortic_dissection", name:"Aortic dissection", system:"Vascular emergency",
      find:{ chestPain:30, backPain:30, thunderclapHeadache:6, hypertensionHx:18, ageOver50:8, syncope:10 },
      inv:["CT aortogram (urgent)","BP in both arms","Control HR & BP"], red:["Tearing chest/back pain with pulse/BP differential — emergency imaging"],
      reason:"Severe tearing chest pain radiating to the back, especially with hypertension, raises aortic dissection." },
    { id:"pe", name:"Pulmonary embolism", system:"Pulmonary / Vascular",
      find:{ pleuriticChestPain:30, dyspnea:34, hypoxia:22, tachycardia:16, legSwellingUnilateral:18, calfTenderness:12, fever:-6 },
      inv:["CT pulmonary angiogram","D-dimer (if low probability)","ECG, troponin"], red:["Haemodynamic instability → consider thrombolysis"],
      reason:"Pleuritic chest pain and dyspnoea with hypoxia or DVT features suggest pulmonary embolism." },
    { id:"pericarditis", name:"Acute pericarditis", system:"Cardiology",
      find:{ pleuriticChestPain:30, chestPain:18, fever:8, ecgIschemia:-6 },
      inv:["ECG (diffuse ST elevation, PR depression)","Echocardiogram","Inflammatory markers"], red:["Tamponade if effusion enlarges"],
      reason:"Sharp pleuritic chest pain relieved by sitting forward, with typical ECG changes, suggests pericarditis." },
    { id:"gerd_chest", name:"GERD / non-cardiac chest pain", system:"Gastroenterology",
      find:{ chestPain:20, exertionalChestPain:-10, ecgIschemia:-14, fever:-8 },
      inv:["Exclude cardiac cause first","Trial of PPI"], red:["Do not attribute to GERD until ACS excluded"],
      reason:"Chest pain without ischaemic features or risk factors may be oesophageal, but cardiac causes must be excluded first." },
    { id:"pneumothorax", name:"Pneumothorax", system:"Pulmonary",
      find:{ pleuriticChestPain:28, dyspnea:26, hypoxia:14, fever:-8 },
      inv:["CXR (or POCUS)","Decompress if tension"], red:["Tension pneumothorax → immediate needle decompression"],
      reason:"Sudden pleuritic pain with breathlessness and reduced breath sounds suggests pneumothorax." },

    /* ---- Dyspnea / edema cluster ---- */
    { id:"heart_failure", name:"Acute heart failure / pulmonary edema", system:"Cardiology",
      find:{ dyspnea:34, orthopnea:30, bilateralCrackles:28, raisedJVP:26, legSwellingBilateral:20, knownHeartFailure:18, ecgIschemia:8, fever:-16 },
      inv:["CXR","BNP/NT-proBNP","ECG, troponin","Echocardiogram"], red:["Address precipitant; not an infection"],
      reason:"Orthopnoea, raised JVP and bilateral crackles favour cardiogenic pulmonary oedema rather than infection." },
    { id:"copd_exac_ni", name:"COPD exacerbation (non-infective)", system:"Pulmonary",
      find:{ dyspnea:30, knownHeartFailure:-6, fever:-6 },
      inv:["ABG","CXR to exclude pneumonia/pneumothorax"], red:["Distinguish infective trigger — may need antibiotics"],
      reason:"Increased breathlessness in known COPD without consolidation or fever may be a non-infective exacerbation." },

    /* ---- Shock cluster (mimics of septic shock) ---- */
    { id:"cardiogenic_shock", name:"Cardiogenic shock", system:"Cardiology / Critical care",
      find:{ hypotension:40, raisedJVP:24, bilateralCrackles:20, ecgIschemia:30, dyspnea:12, fever:-16 },
      inv:["ECG, troponin","Echocardiogram","Lactate"], red:["Revascularisation/inotropes — not antibiotics"], tools:["shock"],
      reason:"Hypotension with pulmonary congestion and ischaemic ECG favours a primary cardiac cause of shock." },
    { id:"hypovolemic_shock", name:"Hypovolemic / haemorrhagic shock", system:"Critical care",
      find:{ hypotension:38, tachycardia:22, melena:18, anticoagulated:8, fever:-12 },
      inv:["Identify bleeding source","Crossmatch","Resuscitate"], red:["GI bleed / occult haemorrhage"], tools:[],
      reason:"Hypotension with tachycardia and evidence of fluid/blood loss suggests hypovolaemic shock." },
    { id:"anaphylaxis", name:"Anaphylaxis", system:"Allergy / Emergency",
      find:{ hypotension:30, dyspnea:24, rash:24, tachycardia:12 },
      inv:["Clinical diagnosis","Serum tryptase"], red:["IM adrenaline immediately"], tools:[],
      reason:"Acute hypotension with urticaria/angioedema and bronchospasm after exposure indicates anaphylaxis." },
    { id:"adrenal_crisis", name:"Adrenal crisis", system:"Endocrine",
      find:{ hypotension:36, steroidUse:34, fever:-4, alteredSensorium:8 },
      inv:["Random cortisol","Electrolytes (Na↓ K↑)","Empiric hydrocortisone"], red:["Give IV hydrocortisone if suspected"], tools:["shock"],
      reason:"Refractory hypotension in a steroid-dependent patient suggests adrenal crisis." },

    /* ---- Metabolic / neuro non-infectious ---- */
    { id:"dka", name:"Diabetic ketoacidosis", system:"Endocrine",
      find:{ ketonemia:40, polyuriaPolydipsia:28, diabetesHx:24, dyspnea:10, abdominalPain:10, alteredSensorium:10, fever:-6 },
      inv:["Venous gas","Blood & urine ketones","Glucose, electrolytes","Search for precipitant (infection)"], red:["DKA protocol; look for precipitating infection"], tools:["dka"],
      reason:"High-anion-gap acidosis with ketonaemia in a diabetic indicates DKA — search for a precipitant." },
    { id:"hypoglycemia", name:"Hypoglycemia", system:"Endocrine",
      find:{ alteredSensorium:34, diabetesHx:14, seizure:8, fever:-12, neckStiffness:-12 },
      inv:["Capillary & lab glucose","Give IV dextrose"], red:["Rapidly reversible — check glucose first in any altered patient"],
      reason:"Altered sensorium with low glucose is rapidly reversible and must be excluded first." },
    { id:"metabolic_enceph", name:"Metabolic encephalopathy", system:"Neuro / Metabolic",
      find:{ alteredSensorium:44, asterixis:18, jaundice:10, fever:-14, neckStiffness:-16 },
      inv:["Electrolytes, glucose, calcium","Renal & liver panel, ammonia","ABG"], red:["Reversible — correct the derangement"],
      reason:"Diffuse encephalopathy without meningism, driven by a metabolic derangement." },
    { id:"hepatic_enceph", name:"Hepatic encephalopathy", system:"Hepatology",
      find:{ alteredSensorium:36, asterixis:30, jaundice:24, ascites:18, fever:-6, neckStiffness:-10 },
      inv:["Ammonia, LFT, coagulation","Identify precipitant (SBP, GI bleed)"], red:["Look for precipitating infection (e.g. SBP)"],
      reason:"Encephalopathy with stigmata of chronic liver disease suggests hepatic encephalopathy — seek a precipitant." },
    { id:"drug_intox", name:"Drug intoxication / poisoning", system:"Toxicology",
      find:{ alteredSensorium:36, drugOverdose:42, seizure:8, fever:-10, neckStiffness:-12 },
      inv:["Toxidrome assessment","Paracetamol/salicylate levels","ABG, osmolar gap"], red:["Specific antidotes where available"],
      reason:"Reduced consciousness with an overdose context points to a toxicological cause." },

    /* ---- Vascular / limb ---- */
    { id:"dvt", name:"Deep vein thrombosis", system:"Vascular",
      find:{ legSwellingUnilateral:38, calfTenderness:30, anticoagulated:-8, fever:-12 },
      inv:["Compression ultrasound (Doppler)","D-dimer","Wells score"], red:["Anticoagulate; assess for PE"],
      reason:"Unilateral leg swelling and calf tenderness suggest DVT rather than cellulitis." }
  ];

  /* ---------------------------------------------------------------------- *
   * ONTOLOGY — merge real FIELD_GROUPS with EXTRA_GROUPS
   * ---------------------------------------------------------------------- */
  var ONT = null, LABEL = {}, VALID = {};
  function buildOntology() {
    if (ONT) return ONT;
    var groups = [];
    (EXTRA_GROUPS).forEach(function (g) { groups.push(g); });
    var fg = (window.FIELD_GROUPS || []);
    fg.forEach(function (g) { if (g && g.fields) groups.push({ group: g.group, fields: g.fields }); });
    groups.forEach(function (g) { g.fields.forEach(function (fl) { LABEL[fl.key] = fl.label; VALID[fl.key] = true; }); });
    ONT = groups;
    return ONT;
  }
  function lbl(k) { return LABEL[k] || k; }

  /* ---------------------------------------------------------------------- *
   * INFECTIOUS introspection — derive each syndrome's associated finding
   * keys from its match()/baseScore() source (∩ valid keys). Cached.
   * ---------------------------------------------------------------------- */
  var ASSOC = {}, IDF = null, NSYN = 0;
  // specificity: findings shared by many syndromes (e.g. fever) carry little
  // discriminating weight; rare findings (e.g. neck stiffness) carry a lot.
  function computeIDF() {
    if (IDF) return IDF;
    IDF = {};
    var syn = window.SYNDROMES || {}, ids = Object.keys(syn), df = {};
    NSYN = ids.length || 1;
    ids.forEach(function (id) { assocKeys(syn[id]).forEach(function (k) { df[k] = (df[k] || 0) + 1; }); });
    Object.keys(VALID).forEach(function (k) { IDF[k] = Math.log((NSYN + 1) / ((df[k] || 0) + 1)) + 0.15; });
    return IDF;
  }
  function assocKeys(s) {
    if (ASSOC[s.id]) return ASSOC[s.id];
    var src = "";
    try { src += s.match ? s.match.toString() : ""; } catch (e) {}
    try { src += " " + (s.baseScore ? s.baseScore.toString() : ""); } catch (e) {}
    try { if (s.decision && s.decision.reasoning) src += " " + s.decision.reasoning.toString(); } catch (e) {}
    var keys = {}, m, re = /\.([a-zA-Z][a-zA-Z0-9_]*)/g;
    while ((m = re.exec(src))) { if (VALID[m[1]]) keys[m[1]] = true; }
    ASSOC[s.id] = Object.keys(keys);
    return ASSOC[s.id];
  }

  /* ---------------------------------------------------------------------- *
   * ENGINE state + scoring
   * ---------------------------------------------------------------------- */
  var S = { f: {}, fInf: {}, prev: {}, expanded: {}, started: false };
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // Bridge generic presenting symptoms to the infection ontology's specific
  // keys so a generic pick still engages the relevant syndromes (infectious
  // scoring only — the non-infectious layer keeps the literal findings).
  var ALIAS = { headache: ["headacheSevere"], dyspnea: ["hypoxia"], legSwellingUnilateral: ["dvtRisk"] };
  function infFindings() {
    var e = {};
    for (var k in S.f) { e[k] = true; (ALIAS[k] || []).forEach(function (a) { e[a] = true; }); }
    return e;
  }

  function scoreInfectious(s) {
    var assoc = assocKeys(s);
    var present = assoc.filter(function (k) { return S.fInf[k]; });
    if (!present.length) return null;
    var matched = false;
    try { matched = !!(s.match && s.match(S.fInf)); } catch (e) {}
    var sc;
    if (matched) {
      try { sc = clamp(Math.round(s.baseScore ? s.baseScore(S.fInf) : 60), 0, 100); } catch (e) { sc = 60; }
    } else {
      // soft pre-match suggestion weighted by finding specificity (IDF), so a
      // shared generic finding (fever) barely surfaces a syndrome while a
      // specific one (neck stiffness) does. Capped below matched scores.
      computeIDF();
      var rel = 0; present.forEach(function (k) { rel += (IDF[k] || 0.5); });
      sc = clamp(Math.round(rel * 13), 0, 56);
      if (sc < 16) return null; // below the noise floor — don't list
    }
    var missing = assoc.filter(function (k) { return !S.fInf[k]; }).slice(0, 5);
    var reason = "";
    try { if (s.decision && s.decision.reasoning) reason = s.decision.reasoning(S.fInf); } catch (e) {}
    var red = (s.decision && (s.decision.status === "red")) ? [s.decision.label || "Time-critical infection"] : [];
    var inv = (s.investigations || []).map(function (i) { return i.test ? (i.test) : i; });
    return { id: s.id, name: s.name, system: s.system || "Infectious", inf: true, matched: matched,
      score: sc, supporting: present, missing: missing, reason: reason, red: red, inv: inv, _syn: s };
  }

  function scoreNI(d) {
    var sup = [], sum = 0, any = false;
    for (var k in d.find) { if (S.f[k]) { sum += d.find[k]; any = true; if (d.find[k] > 0) sup.push(k); } }
    if (!any) return null;
    var sc = clamp(Math.round(sum), 0, 100);
    if (sc <= 0 && sup.length === 0) return null;
    var missing = [];
    for (var k2 in d.find) { if (!S.f[k2] && d.find[k2] >= 12) missing.push(k2); }
    missing = missing.sort(function (a, b) { return d.find[b] - d.find[a]; }).slice(0, 5);
    return { id: d.id, name: d.name, system: d.system, inf: false, matched: false,
      score: sc, supporting: sup.sort(function (a, b) { return d.find[b] - d.find[a]; }),
      missing: missing, reason: d.reason || "", red: d.red || [], inv: d.inv || [], tools: d.tools || [] };
  }

  function differential() {
    buildOntology();
    S.fInf = infFindings();
    var inf = [], ni = [];
    var syn = window.SYNDROMES || {};
    Object.keys(syn).forEach(function (id) { var r = scoreInfectious(syn[id]); if (r) inf.push(r); });
    DDX_NI.forEach(function (d) { var r = scoreNI(d); if (r) ni.push(r); });
    var by = function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); };
    inf.sort(by); ni.sort(by);
    return { inf: inf, ni: ni };
  }

  /* Infection gate — keyed off whether infection LEADS overall */
  function gate(d) {
    var topInf = d.inf.length ? d.inf[0].score : 0;
    var topNi = d.ni.length ? d.ni[0].score : 0;
    var matchedInf = d.inf.some(function (x) { return x.matched; });
    var cls;
    if (topInf >= 80 && topInf >= topNi && matchedInf) cls = "very_likely";
    else if (topInf >= 62 && topInf >= topNi - 4 && matchedInf) cls = "likely";
    else if (topInf >= 42 && topInf >= topNi - 12) cls = "possible";
    else if (topInf > 0 && topNi > topInf) cls = "noninfective";
    else if (topInf > 0) cls = "unlikely";
    else if (topNi > 0) cls = "noninfective";
    else cls = "none";
    return { cls: cls, topInf: topInf, topNi: topNi, lead: d.inf[0] || null };
  }
  var GATEINFO = {
    very_likely:  { t: "Infection very likely", c: "g-red",    ab: true },
    likely:       { t: "Infection likely",       c: "g-orange", ab: true },
    possible:     { t: "Infection possible",      c: "g-amber",  ab: false },
    unlikely:     { t: "Infection unlikely",      c: "g-teal",   ab: false },
    noninfective: { t: "Non-infectious diagnosis favored", c: "g-green2", ab: false },
    none:         { t: "Add findings to begin reasoning", c: "g-slate", ab: false }
  };
  function gateMsg(g) {
    switch (g.cls) {
      case "very_likely": return "Infection leads the differential — empiric antimicrobial therapy is appropriate. Select the diagnosis to open its stewardship recommendation.";
      case "likely": return "Infection is the leading consideration — empiric therapy may be warranted after cultures. Confirm before prescribing.";
      case "possible": return "Infection is in the differential but not dominant — pursue targeted investigations before antibiotics.";
      case "unlikely": return "Infection is low on the differential — antibiotics are not recommended yet. Investigate the alternatives.";
      case "noninfective": return "A non-infectious diagnosis currently leads — antibiotics are not recommended. Address the leading diagnosis.";
      default: return "";
    }
  }

  /* ---------------------------------------------------------------------- *
   * UI
   * ---------------------------------------------------------------------- */
  var root = null, filter = "";
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

  function ensureRoot() {
    if (root) return root;
    buildOntology();
    root = document.createElement("div");
    root.id = "dxOverlay"; root.className = "dx-overlay";
    root.innerHTML =
      '<div class="dx-top">' +
        '<button class="dx-back" id="dxClose" aria-label="Close reasoning">‹ Close</button>' +
        '<div class="dx-title">Clinical Reasoning <span class="dx-beta">live</span></div>' +
        '<button class="dx-reset" id="dxReset" title="Start over">Reset</button>' +
      '</div>' +
      '<div class="dx-body">' +
        '<div class="dx-discl">Live differential — updates as you add findings. Ranked by Clinical Confidence Score (a transparent rule-based score, not a validated probability). Nothing here is a confirmed diagnosis; StewardMD supports, not replaces, your clinical judgment.</div>' +
        '<div id="dxHosp" class="dx-hosp"></div>' +
        '<div class="dx-find-wrap">' +
          '<input id="dxSearch" class="dx-search" type="text" placeholder="Search findings (e.g. fever, headache, dysuria)…" autocomplete="off">' +
          '<div id="dxSel" class="dx-selected"></div>' +
          '<div id="dxPicker" class="dx-picker"></div>' +
        '</div>' +
        '<div id="dxGate" class="dx-gate"></div>' +
        '<div id="dxPolicy" class="dx-policy-wrap"></div>' +
        '<div id="dxChanged" class="dx-changed" style="display:none"></div>' +
        '<div id="dxCols" class="dx-cols"></div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector("#dxClose").addEventListener("click", close);
    root.querySelector("#dxReset").addEventListener("click", resetAll);
    var si = root.querySelector("#dxSearch");
    si.addEventListener("input", function () { filter = si.value.trim().toLowerCase(); renderPicker(); });
    return root;
  }

  function renderSelected() {
    var el = root.querySelector("#dxSel");
    var keys = Object.keys(S.f);
    if (!keys.length) { el.innerHTML = '<span class="dx-sel-empty">No findings yet — tap below to add.</span>'; return; }
    el.innerHTML = keys.map(function (k) {
      return '<button class="dx-sel-chip" data-f="' + k + '">' + esc(lbl(k)) + ' ✕</button>';
    }).join("");
    el.querySelectorAll(".dx-sel-chip").forEach(function (b) {
      b.addEventListener("click", function () { delete S.f[b.getAttribute("data-f")]; recompute(); });
    });
  }

  function renderPicker() {
    var el = root.querySelector("#dxPicker");
    var html = "";
    ONT.forEach(function (g) {
      var fields = g.fields.filter(function (fl) {
        if (S.f[fl.key]) return false;
        if (!filter) return true;
        return (fl.label || "").toLowerCase().indexOf(filter) >= 0;
      });
      if (!fields.length) return;
      html += '<div class="dx-cat"><div class="dx-cat-h">' + esc(g.group) + '</div><div class="dx-chips">' +
        fields.map(function (fl) { return '<button class="dx-chip" data-f="' + fl.key + '">' + esc(fl.label) + '</button>'; }).join("") +
        '</div></div>';
    });
    el.innerHTML = html || '<div class="dx-empty">No matching findings.</div>';
    el.querySelectorAll(".dx-chip").forEach(function (b) {
      b.addEventListener("click", function () { S.f[b.getAttribute("data-f")] = true; S.started = true; recompute(); });
    });
  }

  function card(r, rank) {
    var open = S.expanded[r.id];
    var cls = r.inf ? "inf" : "ni";
    var delta = "";
    var p = S.prev[r.id];
    if (p != null && p !== r.score) delta = r.score > p ? '<span class="dx-up">▲</span>' : '<span class="dx-down">▼</span>';
    else if (p == null && S.started && Object.keys(S.prev).length) delta = '<span class="dx-new">NEW</span>';
    var head =
      '<div class="dx-row-head" data-id="' + r.id + '">' +
        '<div class="dx-rank ' + cls + '">' + rank + '</div>' +
        '<div class="dx-row-main">' +
          '<div class="dx-row-name">' + esc(r.name) + ' ' + delta + (r.matched ? ' <span class="dx-met">criteria met</span>' : '') + '</div>' +
          '<div class="dx-bar ' + cls + '"><span style="width:' + r.score + '%"></span></div>' +
          '<div class="dx-row-sys">' + esc(r.system) + '</div>' +
        '</div>' +
        '<div class="dx-score">' + r.score + '<small>/100</small></div>' +
      '</div>';
    if (!open) return '<div class="dx-card ' + cls + '">' + head + '</div>';
    function fl(keys, c, sign) { return keys.map(function (k) { return '<span class="dx-f ' + c + '">' + (sign || "") + esc(lbl(k)) + '</span>'; }).join("") || '<span class="dx-none">—</span>'; }
    var det = '<div class="dx-detail">' +
      '<div class="dx-d-row"><b>Supporting findings</b><div>' + fl(r.supporting, "sup", "✓ ") + '</div></div>' +
      '<div class="dx-d-row"><b>Missing / would help</b><div>' + fl(r.missing, "mis", "? ") + '</div></div>' +
      (r.reason ? '<div class="dx-d-row"><b>Reasoning</b><div class="dx-reason">' + esc(r.reason) + '</div></div>' : '') +
      (r.red && r.red.length ? '<div class="dx-d-row red"><b>Red flags</b><ul>' + r.red.map(function (x){return '<li>'+esc(x)+'</li>';}).join("") + '</ul></div>' : '') +
      (r.inv && r.inv.length ? '<div class="dx-d-row"><b>Suggested investigations</b><ul>' + r.inv.slice(0,5).map(function (x){return '<li>'+esc(x)+'</li>';}).join("") + '</ul></div>' : '') +
      '<button class="dx-select ' + cls + '" data-sel="' + r.id + '">Select this diagnosis →</button>' +
      '</div>';
    return '<div class="dx-card ' + cls + ' open">' + head + det + '</div>';
  }

  function renderChanged(d) {
    var el = root.querySelector("#dxChanged");
    if (!Object.keys(S.prev).length) { el.style.display = "none"; return; }
    var all = d.inf.concat(d.ni), msgs = [];
    all.slice(0, 12).forEach(function (r) {
      var p = S.prev[r.id];
      if (p == null) msgs.push("▲ " + r.name + " entered the differential");
      else if (r.score - p >= 6) msgs.push("▲ " + r.name + " rose (" + p + "→" + r.score + ")");
      else if (p - r.score >= 6) msgs.push("▼ " + r.name + " fell (" + p + "→" + r.score + ")");
    });
    if (msgs.length) { el.style.display = ""; el.innerHTML = '<b>What changed</b> ' + msgs.slice(0, 3).map(esc).join("  ·  "); }
    else el.style.display = "none";
  }

  var CAP = 10;
  function colHTML(title, cls, rows, emptyMsg) {
    var shown = rows.slice(0, CAP);
    var more = rows.length - shown.length;
    var body = rows.length ? shown.map(function (r, i) { return card(r, i + 1); }).join("") : '<div class="dx-empty">' + esc(emptyMsg) + '</div>';
    if (more > 0) body += '<div class="dx-more">+ ' + more + ' lower-ranked ' + (cls === "inf" ? "infectious" : "non-infectious") + ' possibilities</div>';
    return '<div class="dx-col ' + cls + '"><div class="dx-col-h">' + title + ' <span class="dx-col-n">' + rows.length + '</span></div>' + body + '</div>';
  }

  function renderHosp() {
    var el = root.querySelector("#dxHosp");
    if (!el || !window.HOSPITAL) { if (el) el.innerHTML = ""; return; }
    var h = window.HOSPITAL.current();
    var opts = window.HOSPITAL.list.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === h.id ? " selected" : "") + '>' + esc(x.name) + (x.hasPolicy ? "" : " — national guidance") + '</option>';
    }).join("");
    el.innerHTML = '<span class="dx-hosp-l">Hospital policy</span>' +
      (h.logo ? '<img class="dx-hosp-logo" src="' + h.logo + '" alt="' + esc(h.short) + ' logo">' : "") +
      '<select id="dxHospSel" class="dx-hosp-sel" aria-label="Select hospital policy">' + opts + '</select>';
    var sel = el.querySelector("#dxHospSel");
    sel.addEventListener("change", function () { window.HOSPITAL.setProfile(sel.value); });
  }

  function awareBadge(d) {
    var c = window.HOSPITAL ? window.HOSPITAL.awareClass(d) : "access";
    if (c === "reserve") return ' <span class="dx-aware res">Reserve · AMS approval</span>';
    if (c === "watch") return ' <span class="dx-aware wat">Watch</span>';
    return "";
  }
  function drugRows(arr) {
    return (arr || []).map(function (x) { return '<div class="dx-drug">' + esc(x) + awareBadge(x) + '</div>'; }).join("");
  }
  function renderPolicy(g) {
    var el = root.querySelector("#dxPolicy");
    if (!el) return;
    var info = GATEINFO[g.cls];
    if (!info.ab || !g.lead || !window.HOSPITAL) { el.innerHTML = ""; return; }
    var lead = g.lead, pol = window.HOSPITAL.getPolicy(lead.id), h = pol.hospital, e = pol.entry;
    var src = h.logo
      ? '<img class="dx-src-logo" src="' + h.logo + '" alt="GIMSR logo"> <b>✓ ' + esc(h.policyName) + '</b> <span>' + esc(h.version || "") + '</span>'
      : '<b>' + esc(h.policyName || h.name) + '</b>' + (h.version ? ' <span>' + esc(h.version) + '</span>' : "");
    var html;
    if (e) {
      html = '<div class="dx-policy">' +
        '<div class="dx-policy-src">' + src + '</div>' +
        '<div class="dx-policy-syn">Empiric therapy — ' + esc(lead.name) + '</div>' +
        '<div class="dx-policy-sec"><b>Preferred</b>' + drugRows(e.preferred) + '</div>' +
        (e.alternatives && e.alternatives.length ? '<div class="dx-policy-sec"><b>Alternatives</b>' + drugRows(e.alternatives) + '</div>' : "") +
        (e.duration ? '<div class="dx-policy-line"><b>Duration:</b> ' + esc(e.duration) + '</div>' : "") +
        (e.comments ? '<div class="dx-policy-note">' + esc(e.comments) + '</div>' : "") +
        '<div class="dx-policy-refs">Secondary references: ICMR AMRSN 2024 · IDSA · Surviving Sepsis Campaign</div>' +
        (e.table ? '<div class="dx-policy-cite">Source: GIMSR Antibiotic Policy ' + esc(e.table) + ', p.' + e.page + '</div>' : "") +
        '<button class="dx-select inf" data-sel="' + lead.id + '">Open full stewardship page →</button>' +
      '</div>';
    } else {
      html = '<div class="dx-policy nopol">' +
        '<div class="dx-policy-src">' + src + '</div>' +
        '<div class="dx-policy-note">No ' + esc(h.short || h.name) + ' syndrome-specific empiric entry for <b>' + esc(lead.name) + '</b>. ' +
        (h.note ? esc(h.note) + " " : "") + 'StewardMD shows national/international (ICMR/IDSA) guidance on the full disease page.</div>' +
        '<button class="dx-select inf" data-sel="' + lead.id + '">Open full stewardship page →</button>' +
      '</div>';
    }
    el.innerHTML = html;
    var b = el.querySelector(".dx-select");
    if (b) b.addEventListener("click", function () { selectDx(lead.id); });
  }

  function recompute() {
    if (!root) return;
    renderSelected(); renderPicker(); renderHosp();
    var d = differential();
    var g = gate(d), info = GATEINFO[g.cls];
    root.querySelector("#dxGate").innerHTML =
      '<div class="dx-gate-card ' + info.c + '"><div class="dx-gate-t">' + esc(info.t) + '</div>' +
      (gateMsg(g) ? '<div class="dx-gate-m">' + esc(gateMsg(g)) + '</div>' : '') +
      '</div>';
    renderPolicy(g);
    renderChanged(d);
    root.querySelector("#dxCols").innerHTML =
      colHTML('🔴 Infectious', 'inf', d.inf, S.started ? "No infectious cause suggested by the current findings." : "Add findings to see infectious differentials.") +
      colHTML('🟢 Non-infectious', 'ni', d.ni, S.started ? "No non-infectious cause suggested yet." : "Add findings to see non-infectious differentials.");
    // wire expand + select
    root.querySelectorAll(".dx-row-head").forEach(function (h) {
      h.addEventListener("click", function () { var id = h.getAttribute("data-id"); S.expanded[id] = !S.expanded[id]; renderColsOnly(); });
    });
    root.querySelectorAll(".dx-select").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); selectDx(b.getAttribute("data-sel")); });
    });
    // snapshot scores for delta
    var snap = {}; d.inf.concat(d.ni).forEach(function (r) { snap[r.id] = r.score; });
    S.prev = snap;
  }
  // re-render only the columns (used on expand so we don't reset prev/delta)
  function renderColsOnly() {
    var d = differential();
    root.querySelector("#dxCols").innerHTML =
      colHTML('🔴 Infectious', 'inf', d.inf, "No infectious cause suggested by the current findings.") +
      colHTML('🟢 Non-infectious', 'ni', d.ni, "No non-infectious cause suggested yet.");
    root.querySelectorAll(".dx-row-head").forEach(function (h) {
      h.addEventListener("click", function () { var id = h.getAttribute("data-id"); S.expanded[id] = !S.expanded[id]; renderColsOnly(); });
    });
    root.querySelectorAll(".dx-select").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); selectDx(b.getAttribute("data-sel")); });
    });
  }

  function selectDx(id) {
    // infectious -> open the full StewardMD disease page with current findings
    var syn = window.SYNDROMES || {};
    if (syn[id]) {
      try {
        var vitals = {};
        if (typeof window.SMD_restoreCase === "function") {
          close();
          window.SMD_restoreCase(S.f, id, vitals);
          return;
        }
      } catch (e) {}
      alert("Opening the disease page — stewardship module is loading.");
      return;
    }
    // non-infectious -> expand its card (no antimicrobial recommendation)
    S.expanded[id] = true; renderColsOnly();
    var c = root.querySelector('.dx-card.open .dx-detail');
    if (c) c.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetAll() { S.f = {}; S.prev = {}; S.expanded = {}; S.started = false; filter = ""; var si = root && root.querySelector("#dxSearch"); if (si) si.value = ""; recompute(); }
  function open() { ensureRoot(); root.classList.add("on"); document.body.classList.add("dx-lock"); recompute(); }
  function close() { if (root) { root.classList.remove("on"); document.body.classList.remove("dx-lock"); } }

  /* ---------------------------------------------------------------------- *
   * STYLES + launch
   * ---------------------------------------------------------------------- */
  function injectCSS() {
    var css = [
      ".dx-overlay{position:fixed;inset:0;z-index:850;background:var(--paper);display:none;flex-direction:column;overflow:hidden;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}",
      ".dx-overlay.on{display:flex;animation:dxIn .25s ease}",
      "@keyframes dxIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
      "body.dx-lock{overflow:hidden}",
      ".dx-top{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel);border-bottom:1px solid var(--line);z-index:3}",
      ".dx-back,.dx-reset{background:transparent;border:1px solid var(--line);border-radius:9px;height:34px;padding:0 12px;font:600 13px var(--sans);color:var(--ink);cursor:pointer}",
      ".dx-back{color:var(--teal);border-color:var(--teal)}",
      ".dx-title{flex:1;text-align:center;font:800 16px var(--sans);color:var(--ink)}",
      ".dx-beta{font-size:10px;background:var(--teal-soft);color:var(--teal);border-radius:6px;padding:1px 6px;vertical-align:middle;font-weight:700}",
      ".dx-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;max-width:1100px;margin:0 auto;width:100%;padding-bottom:calc(48px + env(safe-area-inset-bottom))}",
      ".dx-discl{font:500 11.5px var(--sans);color:var(--slate-soft);background:var(--teal-soft);border-radius:10px;padding:9px 12px;margin-bottom:12px;line-height:1.5}",
      ".dx-find-wrap{margin-bottom:6px}",
      ".dx-search{width:100%;box-sizing:border-box;border:1.5px solid var(--line);border-radius:11px;padding:11px 14px;font:500 14px var(--sans);background:var(--panel);color:var(--ink);margin-bottom:9px}",
      ".dx-search:focus{outline:none;border-color:var(--teal)}",
      ".dx-selected{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:9px;min-height:4px}",
      ".dx-sel-empty{font:500 12px var(--sans);color:var(--slate-soft)}",
      ".dx-sel-chip{background:var(--teal);border:none;color:#fff;border-radius:16px;padding:6px 11px;font:600 12px var(--sans);cursor:pointer}",
      ".dx-picker{max-height:212px;overflow-y:auto;border:1px solid var(--line);border-radius:11px;padding:10px 12px;background:var(--panel)}",
      ".dx-cat{margin:4px 0 11px}",
      ".dx-cat-h{font:700 10.5px var(--sans);letter-spacing:.04em;text-transform:uppercase;color:var(--slate-soft);margin-bottom:6px}",
      ".dx-chips{display:flex;flex-wrap:wrap;gap:6px}",
      ".dx-chip{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:6px 11px;font:600 12px var(--sans);color:var(--slate);cursor:pointer;transition:all .12s}",
      ".dx-chip:hover{border-color:var(--teal);color:var(--teal)}",
      ".dx-gate{margin:14px 0 8px}",
      ".dx-gate-card{border-radius:13px;padding:13px 15px;border:1px solid var(--line)}",
      ".dx-gate-t{font:800 15px var(--sans)}",
      ".dx-gate-m{font:500 12.5px var(--sans);margin-top:4px;line-height:1.5;opacity:.92}",
      ".dx-gate-hint{font:600 12px var(--sans);margin-top:8px;color:var(--ink);background:var(--panel);border-radius:8px;padding:8px 10px}",
      ".g-red{background:var(--red-bg);border-color:var(--red-line)}.g-red .dx-gate-t{color:var(--red)}",
      ".g-orange{background:var(--orange-bg);border-color:var(--orange-line)}.g-orange .dx-gate-t{color:var(--orange)}",
      ".g-amber{background:var(--yellow-bg);border-color:var(--yellow-line)}.g-amber .dx-gate-t{color:var(--yellow)}",
      ".g-teal{background:var(--teal-soft);border-color:var(--teal)}.g-teal .dx-gate-t{color:var(--teal)}",
      ".g-green2{background:var(--green-bg);border-color:var(--green-line)}.g-green2 .dx-gate-t{color:var(--green)}",
      ".g-slate{background:var(--panel)}.g-slate .dx-gate-t{color:var(--slate)}",
      ".dx-changed{font:600 12px var(--sans);color:var(--slate);background:var(--panel);border:1px dashed var(--line);border-radius:9px;padding:8px 11px;margin:0 0 12px}",
      ".dx-cols{display:grid;grid-template-columns:1fr;gap:14px}",
      "@media(min-width:760px){.dx-cols{grid-template-columns:1fr 1fr}}",
      ".dx-col-h{font:800 14px var(--sans);color:var(--ink);margin:2px 0 10px}",
      ".dx-col-n{font-size:11px;background:var(--line);color:var(--slate);border-radius:8px;padding:1px 7px;vertical-align:middle}",
      ".dx-col{display:flex;flex-direction:column;gap:9px}",
      ".dx-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden;transition:border-color .15s}",
      ".dx-card.inf{border-left:3px solid var(--red)}",
      ".dx-card.ni{border-left:3px solid var(--green)}",
      ".dx-card.open{border-color:var(--teal)}",
      ".dx-row-head{display:flex;align-items:center;gap:11px;padding:11px 13px;cursor:pointer}",
      ".dx-rank{width:22px;height:22px;flex:0 0 auto;border-radius:50%;font:800 12px var(--sans);display:flex;align-items:center;justify-content:center}",
      ".dx-rank.inf{background:var(--red-bg);color:var(--red)}.dx-rank.ni{background:var(--green-bg);color:var(--green)}",
      ".dx-row-main{flex:1;min-width:0}",
      ".dx-row-name{font:700 13.5px var(--sans);color:var(--ink)}",
      ".dx-met{font-size:9.5px;font-weight:700;background:var(--red-bg);color:var(--red);border-radius:5px;padding:1px 5px;vertical-align:middle}",
      ".dx-up{color:var(--red);font-size:11px}.dx-down{color:var(--teal);font-size:11px}.dx-new{font-size:9px;font-weight:800;background:var(--teal);color:#fff;border-radius:4px;padding:1px 4px}",
      ".dx-bar{height:6px;border-radius:4px;background:var(--line);margin:6px 0 4px;overflow:hidden}",
      ".dx-bar span{display:block;height:100%;border-radius:4px;transition:width .35s cubic-bezier(.4,0,.2,1)}",
      ".dx-bar.inf span{background:linear-gradient(90deg,#d9485f,var(--red))}",
      ".dx-bar.ni span{background:linear-gradient(90deg,#3fae6b,var(--green))}",
      ".dx-row-sys{font:500 11px var(--sans);color:var(--slate-soft)}",
      ".dx-score{font:800 18px var(--sans);color:var(--ink);flex:0 0 auto}.dx-score small{font-size:10px;color:var(--slate-soft);font-weight:600}",
      ".dx-detail{padding:2px 13px 13px;border-top:1px solid var(--line);animation:dxIn .2s ease}",
      ".dx-d-row{margin-top:11px;font:500 12.5px var(--sans);color:var(--slate)}",
      ".dx-d-row b{display:block;font:700 10.5px var(--sans);text-transform:uppercase;letter-spacing:.03em;color:var(--slate-soft);margin-bottom:5px}",
      ".dx-d-row ul{margin:0;padding-left:18px}.dx-d-row li{margin:2px 0}",
      ".dx-d-row.red b{color:var(--red)}",
      ".dx-reason{line-height:1.55;color:var(--ink)}",
      ".dx-f{display:inline-block;border-radius:6px;padding:3px 8px;margin:0 5px 5px 0;font-size:12px;font-weight:600}",
      ".dx-f.sup{background:var(--green-bg);color:var(--green)}",
      ".dx-f.mis{background:var(--paper);border:1px dashed var(--line);color:var(--slate-soft)}",
      ".dx-none{color:var(--slate-soft);font-size:12px}",
      ".dx-select{margin-top:13px;width:100%;border:none;border-radius:10px;padding:11px;font:800 13px var(--sans);cursor:pointer;color:#fff}",
      ".dx-select.inf{background:var(--red)}.dx-select.ni{background:var(--green)}",
      ".dx-empty{font:500 13px var(--sans);color:var(--slate-soft);padding:14px;text-align:center;border:1px dashed var(--line);border-radius:10px}",
      ".dx-hosp{display:flex;align-items:center;gap:9px;margin:0 0 12px;flex-wrap:wrap}",
      ".dx-hosp-l{font:700 10.5px var(--sans);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft)}",
      ".dx-hosp-logo{height:24px;border-radius:5px}",
      ".dx-hosp-sel{border:1px solid var(--line);border-radius:9px;padding:7px 10px;font:600 12.5px var(--sans);background:var(--panel);color:var(--ink);cursor:pointer}",
      ".dx-policy-wrap{margin:0 0 12px}",
      ".dx-policy{border:1px solid var(--teal);border-radius:13px;background:var(--panel);padding:13px 15px}",
      ".dx-policy.nopol{border-color:var(--line)}",
      ".dx-policy-src{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font:700 12.5px var(--sans);color:var(--teal);border-bottom:1px solid var(--line);padding-bottom:9px;margin-bottom:10px}",
      ".dx-src-logo{height:30px;border-radius:5px}",
      ".dx-policy-src span{font-weight:500;color:var(--slate-soft);font-size:11px}",
      ".dx-policy-syn{font:800 14px var(--sans);color:var(--ink);margin-bottom:6px}",
      ".dx-policy-sec{margin:8px 0}",
      ".dx-policy-sec>b{display:block;font:700 10.5px var(--sans);text-transform:uppercase;letter-spacing:.03em;color:var(--slate-soft);margin-bottom:4px}",
      ".dx-drug{font:600 13px var(--sans);color:var(--ink);padding:5px 0;border-bottom:1px dashed var(--line)}",
      ".dx-aware{font-size:9.5px;font-weight:800;border-radius:5px;padding:1px 6px;vertical-align:middle}",
      ".dx-aware.wat{background:var(--yellow-bg);color:var(--yellow)}",
      ".dx-aware.res{background:var(--red-bg);color:var(--red)}",
      ".dx-policy-line{font:600 12.5px var(--sans);color:var(--ink);margin:9px 0}",
      ".dx-policy-note{font:500 12px var(--sans);color:var(--slate);line-height:1.55;background:var(--paper);border-radius:8px;padding:9px 11px;margin:8px 0}",
      ".dx-policy-refs{font:700 11px var(--sans);color:var(--slate-soft);margin-top:9px}",
      ".dx-policy-cite{font:500 10.5px var(--sans);color:var(--slate-soft);margin-top:4px;font-style:italic}",
      ".dx-more{font:600 11.5px var(--sans);color:var(--slate-soft);text-align:center;padding:8px;border:1px dashed var(--line);border-radius:9px}",
      ".dx-launch{flex:0 0 auto;height:38px;border-radius:10px;border:1px solid var(--teal);background:var(--teal);color:#fff;font:700 12.5px var(--sans);padding:0 13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}"
    ].join("");
    var st = document.createElement("style"); st.id = "dx-styles"; st.textContent = css; document.head.appendChild(st);
  }
  function injectLaunch() {
    var actions = document.querySelector(".app-head-actions");
    if (!actions || document.getElementById("dxLaunch")) return;
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

  window.DX = { open: open, close: close, reset: resetAll, _state: S, _ni: DDX_NI, _differential: differential,
    _onHospitalChange: function () { if (root && root.classList.contains("on")) recompute(); } };
})();
