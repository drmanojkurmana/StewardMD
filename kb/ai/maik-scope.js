/* MaiK Intent Firewall — window.MaiKScope  (UMD: browser + node-testable)
 *
 * MaiK is a CLINICIAN-ONLY clinical assistant, NOT a general chatbot. This is a DETERMINISTIC,
 * zero-cost, client-side gate that runs at the very top of the ask flow — BEFORE the KB engine,
 * the semantic router, web research, and any Gemini/Vertex call — so a non-clinical request is
 * refused INSTANTLY, saving tokens + latency and preventing "Researching apple…"-style leaks.
 *
 * ARCHITECTURE (allow-list, not block-list):
 *   A block-list ("reject code / weather / …") always has gaps — "how to eat apple", "who is X",
 *   "movie" slip through. So the firewall REQUIRES A POSITIVE MEDICAL SIGNAL and rejects everything
 *   else. Order:
 *     1. Lay self-help ("I have a headache, what should I do?")            → block (lay)
 *     2. Positive MEDICAL signal (morphology + lexicon + clinical anchor)  → ALLOW
 *     3. Hard non-medical category (code / creative / general)             → block (labelled)
 *     4. No medical signal at all                                          → block (non_medical)
 *
 * FALSE-REFUSALS are the worst outcome for a doctor, so MEDICAL is built BROAD (disease/drug
 * morphology, symptoms, drugs, investigations, scores, abbreviations, systems, clinical verbs) and
 * is unit-tested against a large clinical corpus (test/maik-scope.test.mjs) for ZERO false-refusals.
 * In the browser it is further widened by the app's own lexicons (MEDDRUGS / MaiKKB) at runtime.
 *
 * CONFIGURABLE without a code change: window.MAIK_SCOPE_CONFIG = { allow:[...], block:[...] } (or
 * MaiKScope.configure({...})) adds extra allow / block terms — no rebuild, no JSON loader needed.
 *
 * SECURITY: this is an APPLICATION-LAYER boundary, not a system-prompt. It runs regardless of what
 * any model would do. (The server refiner ALSO returns outOfScope as a second, independent layer.)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;   // node / tests
  if (root) root.MaiKScope = api;                                              // browser
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  function norm(q) {
    return String(q == null ? "" : q).toLowerCase()
      .replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  }
  function rx(list, flags) { return new RegExp("(" + list.join("|") + ")", flags || ""); }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // POSITIVE MEDICAL SIGNAL — a query is clinical if ANY of these fire. Broad on purpose (recall
  // protects doctors from false-refusals). Grouped for readability; word-boundaried where a token
  // is short/ambiguous. Ambiguous 2-letter abbreviations (ms/ra/pe/mi/dm/hf) are intentionally
  // EXCLUDED — "MS Dhoni", "PE teacher" must NOT read as medical; a doctor types the full term.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // Disease / drug MORPHOLOGY — generative coverage of the long tail (…itis, …emia, …cillin, …pril).
  var MORPH = [
    "itis\\b", "os[ie]s\\b", "aemia\\b", "emia\\b", "a?emic\\b", "pathy\\b", "opathy\\b",
    "ectomy\\b", "[o]?tomy\\b", "ostomy\\b", "plasty\\b", "oma\\b", "omas\\b", "megaly\\b",
    "penia\\b", "cytosis\\b", "\\buria\\b", "algia\\b", "dynia\\b", "plegia\\b", "paresis\\b",
    "pnea\\b", "pnoea\\b", "ptysis\\b", "phagia\\b", "rrh?ea\\b", "rrh?oea\\b", "sclerosis\\b",
    "stenosis\\b", "thrombo", "embol", "isch[ae]mi", "infarct", "necros", "sepsis", "septic",
    "edema\\b", "oedema\\b", "trophy\\b", "genic\\b", "cidal\\b", "static\\b", "lytic\\b",
    // congenital anomaly morphology (owner report, 2026-09-05: "Portal agenesis?" fell through
    // to "clarify" for having no matched signal - a 2-word query gets no second chance).
    "agenesis\\b", "aplasia\\b", "hypoplasia\\b", "dysplasia\\b", "atresia\\b", "malformation",
    // drug stems
    "cillin", "mycin", "cycline", "oxacin", "penem", "cef[a-z]*", "ceph[a-z]*", "conazole",
    "[a-z]azole\\b", "pril\\b", "prils\\b", "sartan", "[a-z]olol\\b", "dipine", "statin",
    "parin\\b", "xaban\\b", "gliptin", "gliflozin", "tinib\\b", "\\w+mab\\b", "prazole",
    "\\wvir\\b", "navir", "caine\\b", "curonium", "cort[a-z]*", "sone\\b", "olone\\b", "pam\\b"
  ];

  // Symptoms / presentations.
  var SYMPTOM = [
    "fever", "pyrexia", "\\bpain\\b", "\\bache", "headache", "chest pain", "abdominal",
    "cough", "dyspn", "breathless", "wheeze", "orthopn", "palpitation", "syncope", "seizure",
    "convuls", "dizz", "vertigo", "nausea", "vomit", "diarrh", "constipat", "bleed", "haemorrhage",
    "hemorrhage", "bruis", "\\brash\\b", "pruritus", "\\bitch", "swelling", "jaundice", "pallor",
    "cyanos", "weakness", "fatigue", "malaise", "anorexia", "dysuria", "h[ae]maturia", "oliguria",
    "polyuria", "dysphagia", "h[ae]moptysis", "melena", "h[ae]matemesis", "numbness", "tingling",
    "paralysis", "\\btremor", "confusion", "delirium", "\\bcoma\\b", "unconscious", "lethargic",
    "night sweats", "weight loss", "shortness of breath", "loss of consciousness", "\\bcramp"
  ];

  // Conditions / entities + strong (3+ letter) abbreviations.
  var CONDITION = [
    "\\bmedic", "clinical", "\\bhealth", "disease", "disorder", "syndrome", "\\bcondition",
    "infection", "inflamm", "injur", "trauma", "fracture", "\\bwound", "ulcer", "lesion",
    "tumou?r", "cancer", "malignan", "carcinoma", "metasta", "diabet", "hypertens", "pneumon",
    "asthma", "\\bcopd\\b", "\\bckd\\b", "\\baki\\b", "\\bcap\\b", "\\bhap\\b", "\\buti\\b",
    "\\bdvt\\b", "\\bdka\\b", "\\bhhs\\b", "\\bards\\b", "\\bcva\\b", "\\btia\\b", "\\bsah\\b",
    "stemi", "\\bacs\\b", "\\bchf\\b", "\\bcld\\b", "\\bild\\b", "\\btb\\b", "\\bhiv\\b", "aids\\b",
    "\\bsle\\b", "\\bibd\\b", "gerd", "cirrhos", "hepatitis", "encephalo", "meningitis", "stroke",
    "arrhythmia", "fibrillation", "flutter\\b.*(atrial|cardiac)", "atrial (fib|flutter)",
    "tachycard", "bradycard", "hypoglyc", "hyperglyc", "hypona", "hyperna", "hypokal", "hyperkal",
    "hypercal", "hypocal", "acidosis", "alkalosis", "poison", "overdose", "\\btoxic", "envenom",
    "snake bite", "anaphyla", "shock", "\\bhf\\b.*(heart|cardiac)", "heart failure", "renal failure",
    "liver failure", "respiratory failure", "pneumothorax", "\\bpneumo", "epilep", "status epilepticus",
    "code status", "\\bdnr\\b", "sliding scale", "ketoacidosis", "\\bpe\\b.*(pulmonary|emboli)"
  ];

  // Investigations, labs, scores, imaging.
  var INVESTIGATION = [
    "\\becg\\b", "\\bekg\\b", "\\becho\\b", "echocardiogra", "\\bct\\b", "\\bmri\\b", "x-?ray",
    "ultrasound", "\\busg\\b", "doppler", "angiogr", "endoscop", "colonoscop", "bronchoscop",
    "biopsy", "\\bcbc\\b", "\\bfbc\\b", "\\babg\\b", "\\bvbg\\b", "\\blft\\b", "\\brft\\b",
    "\\bkft\\b", "\\btft\\b", "\\bcrp\\b", "\\besr\\b", "procalcitonin", "troponin", "creatinine",
    "\\burea\\b", "\\bbun\\b", "electrolyte", "sodium", "potassium", "calcium", "magnesium",
    "phosphate", "bicarbonate", "lactate", "\\bglucose\\b", "hba1c", "\\binr\\b", "\\baptt\\b",
    "d-?dimer", "ferritin", "bilirubin", "albumin", "ammonia", "culture", "sensitivity",
    "gram stain", "blood gas", "urinalysis", "\\bhb\\b", "platelet", "\\bwbc\\b", "\\btlc\\b",
    // scores
    "\\bgcs\\b", "\\btimi\\b", "heart score", "grace score", "cha2ds2", "\\bchads", "wells score",
    "\\bqsofa\\b", "\\bsofa\\b", "apache", "\\bmeld\\b", "child-?pugh", "curb-?65", "\\bnihss\\b",
    "glasgow coma", "ranson", "centor", "padua", "caprini"
  ];

  // Body systems / anatomy / specialties.
  var SYSTEM = [
    "cardiac", "cardio", "coronary", "cerebral", "\\brenal\\b", "hepatic", "pulmonary",
    "respiratory", "neuro", "gastro", "gastrointestinal", "endocrine", "h[ae]matolog", "oncolog",
    "rheumat", "dermat", "\\bent\\b", "urolog", "gyn[ae]c", "obstetric", "p[ae]diatric",
    "geriatric", "psychiatr", "orthop", "vascular", "gastric", "intestinal", "pancrea", "thyroid",
    "adrenal", "pituitary", "\\bbone\\b", "\\bjoint\\b", "\\bmuscle\\b", "\\bnerve\\b", "\\bartery\\b",
    "\\bvein\\b", "\\bkidney", "\\bliver\\b", "\\blung", "\\bcardiac\\b", "myocard", "pericard"
  ];

  // Clinical actions / verbs / vocabulary (these + a noun make almost any real clinical query).
  var CLINICAL_ACTION = [
    "\\bpatient", "\\bpt\\b", "\\bdose\\b", "dosing", "dosage", "\\bmg\\b", "\\bmcg\\b", "\\bµg\\b",
    "\\bml\\b", "\\biu\\b", "tablet", "\\bdrug\\b", "medication", "medicine", "antibiotic",
    "\\babx\\b", "prescri", "diagnos", "differential", "\\bddx\\b", "\\bdx\\b", "workup", "work-up",
    "investigat", "\\btreat", "therap", "\\bmanage", "management", "regimen", "guideline",
    "protocol", "\\bstewardship", "contraindicat", "indicat", "interaction", "adverse",
    "side effect", "titrat", "taper", "monitor", "resuscitat", "intubat", "ventilat", "\\bsedat",
    "\\badmit", "discharge", "referral", "prognos", "etiolog", "aetiolog", "pathophysiolog",
    "epidemiolog", "screening", "prophylax", "vaccin", "immuni[sz]", "\\bicu\\b", "critical care",
    "intensive care", "\\bward\\b", "\\bsurg", "operat", "an[ae]sthe", "\\bnursing\\b",
    "clinical calculator", "\\bmap target", "\\bbp\\b.*(target|control|manage)",
    // Pharmacology. A doctor asking how a drug WORKS is the single most common reference query and
    // none of it was covered, so "mechanism of action" was read as non-clinical.
    "mechanism of action", "\\bmoa\\b", "mode of action", "pharmacokinetic", "pharmacodynamic",
    "pharmacolog", "half.?life", "bioavailab", "\\bclearance\\b", "metabolis", "\\bexcretion\\b",
    "\\bagonist", "\\bantagonist", "\\binhibitor", "\\bblocker", "\\breceptor", "\\benzyme\\b",
    "\\bpotency\\b", "\\befficacy\\b", "\\bloading dose", "maintenance dose", "\\bmic\\b",
    "first.?line", "second.?line", "drug of choice", "\\bdoc\\b.*(drug|choice)", "off.?label"
  ];

  // Drug CLASSES and receptor targets. A clinician names the class as often as a molecule, and the
  // suffix rules in MORPH only catch individual generics (…gliflozin), never the class ("SGLT2").
  var DRUG_CLASS = [
    "\\bsglt.?2\\b", "\\bsglt2i\\b", "\\bdpp.?4\\b", "\\bglp.?1\\b", "\\bgip\\b",
    "\\bace.?inhibitor", "\\bacei\\b", "\\barb\\b", "\\barni\\b", "\\bmra\\b",
    "beta.?blocker", "alpha.?blocker", "calcium channel", "\\bccb\\b", "\\bppi\\b",
    "\\bnsaid", "\\bssri\\b", "\\bsnri\\b", "\\btca\\b", "\\bmaoi?\\b",
    "\\bbenzodiazepine", "\\bopioid", "\\bopiate", "\\bdiuretic", "\\bloop diuretic",
    "thiazide", "\\bstatins?\\b", "fibrate", "\\banticoagul", "antiplatelet", "\\bdoac\\b",
    "\\bnoac\\b", "thrombolytic", "fibrinolytic", "\\binotrope", "vasopressor", "vasodilator",
    "antiemetic", "antipyretic", "analgesic", "antihistamine", "corticosteroid", "\\bsteroid",
    "immunosuppress", "biologic", "\\btnf\\b", "\\bil-?\\d", "\\bpd-?[l]?1\\b",
    "checkpoint inhibitor", "chemotherap", "antiviral", "antifungal", "antimalarial", "anthelmint",
    "antitubercular", "\\batt\\b", "bronchodilator", "\\bsaba\\b", "\\blaba\\b",
    "\\bics\\b", "\\blama\\b", "anticonvulsant", "antiepileptic", "antipsychotic",
    "antidepressant", "\\bhrt\\b", "\\bocp\\b", "oral contraceptive", "insulin analog"
  ];

  // Abbreviations a clinician types constantly that carried NO signal - every one of these was a
  // false refusal. PCOD/PCOS is the one a doctor actually hit in testing.
  var ABBREV_COMMON = [
    "\\bpcod\\b", "\\bpcos\\b", "\\bpid\\b", "\\bpph\\b", "\\biugr\\b",
    "\\bprom\\b", "\\bpprom\\b", "\\blscs\\b", "\\bivf\\b", "\\biui\\b",
    "\\bbph\\b", "\\bgdm\\b", "\\bt1dm\\b", "\\bt2dm\\b", "\\bdm2\\b",
    "\\bcad\\b", "\\bihd\\b", "\\bhfpef\\b", "\\bhfref\\b", "\\bafib\\b",
    "\\bavnrt\\b", "\\bsvt\\b", "\\bvt\\b", "\\bvf\\b", "\\blvh\\b",
    "\\bgtt\\b", "\\bogtt\\b", "\\bfbs\\b", "\\bppbs\\b", "\\brbs\\b",
    "\\bnafld\\b", "\\bnash\\b", "\\bgi\\s?bleed", "\\bosa\\b", "\\bra\\b\\s+(rx|tx|mx|treat|manage|drug)",
    "\\bckd.?epi\\b", "\\bnephrotic\\b", "\\bnephritic\\b", "\\bhus\\b", "\\bttp\\b",
    "\\bitp\\b", "\\bdic\\b", "\\bg6pd\\b", "\\bcopd\\b", "\\bpcp\\b"
  ];

  // High-frequency drugs whose names carry no giveaway stem (the suffix rules cover the long tail).
  var DRUG_COMMON = [
    "insulin", "digoxin", "warfarin", "heparin", "amiodarone", "adrenaline", "epinephrine",
    "noradrenaline", "norepinephrine", "atropine", "aspirin", "paracetamol", "acetaminophen",
    "ibuprofen", "metformin", "furosemide", "frusemide", "salbutamol", "albuterol", "morphine",
    "fentanyl", "propofol", "dopamine", "dobutamine", "vancomycin", "meropenem", "piperacillin",
    "tazobactam", "metronidazole", "gentamicin", "clindamycin", "hydrocortisone", "dexamethasone",
    "prednisolone", "amoxicillin", "azithromycin", "ceftriaxone", "ciprofloxacin", "\\bivig\\b",
    "\\bkcl\\b", "\\bnac\\b", "naloxone", "flumazenil", "labetalol", "nitroglycerin", "nitrate"
  ];

  // Common diseases whose names carry NO morphology giveaway (…itis/…osis already covered). Heavy on
  // the India/tropical everyday load so a bare "dengue" / "typhoid warning signs" is never refused.
  var COMMON_DISEASE = [
    "dengue", "malaria", "typhoid", "enteric fever", "cholera", "chikungunya", "leptospir",
    "\\bkala.?azar\\b", "leishman", "filaria", "brucellos", "\\brabies\\b", "tetanus", "\\bmeasles\\b",
    "\\bmumps\\b", "chickenpox", "varicella", "\\bshingles\\b", "pertussis", "whooping cough",
    "diphtheria", "\\bpolio", "scabies", "\\bleprosy\\b", "\\bplague\\b", "anthrax", "dysentery",
    "giardia", "amoeb", "\\bworms?\\b", "helminth", "\\bcovid", "influenza", "\\bflu\\b", "\\bzika\\b",
    "\\bebola\\b", "nipah", "\\bh1n1\\b", "\\bmigraine", "\\bgout\\b", "goitre", "goiter", "\\beczema\\b",
    "vitiligo", "urticaria", "gastroenter", "hypothyroid", "hyperthyroid", "\\bpud\\b", "\\bgord\\b"
  ];

  // Vitals, fluids, and "what is normal …" reference queries — core bedside terms the allow-list missed.
  var VITALS_FLUIDS = [
    "blood pressure", "\\bbp\\b", "heart rate", "pulse rate", "\\bpulse\\b", "respiratory rate",
    "oxygen saturation", "\\bspo2\\b", "\\bsats\\b", "\\bsaturation\\b", "\\btemperature\\b",
    "vital sign", "\\bvitals\\b", "oral rehydration", "\\bors\\b", "\\bivf\\b", "\\biv fluid",
    "intravenous fluid", "normal saline", "ringer", "\\bdextrose\\b", "\\bfluid\\b",
    "normal range", "normal value", "reference range", "normal (bp|hr|pulse|temperature|value|range)"
  ];

  var MEDICAL_GROUPS = [MORPH, SYMPTOM, CONDITION, INVESTIGATION, SYSTEM, CLINICAL_ACTION, DRUG_COMMON, DRUG_CLASS, ABBREV_COMMON, COMMON_DISEASE, VITALS_FLUIDS];
  var MEDICAL = rx([].concat.apply([], MEDICAL_GROUPS));

  // ── Explicit NON-medical categories (only used to LABEL the block; the allow-list already rejects
  // anything with no medical signal, but these give a precise reason + belt-and-suspenders). ──────
  var HARD_NON_MEDICAL = rx([
    "javascript", "typescript", "\\bhtml\\b", "\\bcss\\b", "reactjs", "react\\.js", "react component",
    "react native", "react app", "react hook", "\\bangular\\b", "vue\\.?js", "node\\.?js", "jquery",
    "\\bpython\\b", "golang", "\\bkotlin\\b", "\\bregex\\b", "regular expression", "\\bdocker\\b",
    "kubernetes", "github", "gitlab", "compiler", "frontend", "front-end", "backend", "back-end",
    "fullstack", "full-stack", "chatgpt", "openai", "\\bgpt-?\\d", "\\bllm\\b", "\\bnpm\\b",
    "pip install", "yarn add", "xcode", "swiftui", "\\bflutter\\b", "\\bapk\\b", "webpage",
    "web page", "web ?site", "web ?app", "landing page", "css grid", "flexbox", "boilerplate",
    "leetcode", "stack ?overflow", "web dev", "\\bsql\\b", "\\bcoding\\b",
    "how to (code|program)", "learn to (code|program)", "how do i (code|program)"
  ]);
  var CODE_VERB = "write|create|generate|build|make|give me|show me|develop|design|fix|debug|refactor|optimi[sz]e|implement|integrate|program|deploy|host";
  var CODE_OBJ = "\\bcode\\b|program|programme|script|application|software|algorithm|\\bapi\\b|\\bsdk\\b|endpoint|component|for a website|for my (site|app|website)";
  var CODE_VERB_OBJ = new RegExp("\\b(" + CODE_VERB + ")\\b[\\s\\S]{0,32}(" + CODE_OBJ + ")");
  var INTEGRATE = /\b(integrate|add|connect|hook up|wire up|embed)\b[\s\S]{0,48}\b(into|in|to|with)\b[\s\S]{0,24}\b(my|the|our|this|your)\b[\s\S]{0,16}\b(project|app|application|web ?site|web ?app|code ?base|repo|repository|backend|frontend|program|software)\b/;
  var CREATIVE = new RegExp("\\b(write|compose|create|generate|make me)\\b[\\s\\S]{0,24}\\b(poem|essay|story|stories|joke|song|rap\\b|lyrics|screenplay|novel|tweet|blog|haiku|limerick|cover letter|resume|\\bcv\\b|speech)\\b");
  var GENERAL = rx([
    "\\bweather\\b", "forecast", "who won", "score of", "\\bipl\\b", "cricket", "football",
    "\\bmatch\\b", "stock (price|market)", "share price", "bitcoin", "crypto", "\\brecipe\\b",
    "how to cook", "how to eat", "how do i eat", "capital of", "\\bcapital\\b", "population of",
    // Travel/food shapes that previously relied on the default-deny fall-through. Now that an
    // unrecognised query goes to the model instead of being refused, these need naming outright.
    "plan my (trip|holiday|vacation|itinerary)", "\\btrip to\\b", "\\bitinerary\\b",
    "\\bsightsee", "\\btourist", "book (a )?(flight|hotel|ticket)", "\\btranslate\\b", "\\bmovie\\b", "netflix",
    "song lyrics", "tell me a joke", "\\bflirt\\b", "roast me", "meaning of life", "\\btravel\\b",
    "\\bvacation\\b", "\\bholiday\\b", "who is [a-z]", "your (name|creator|model|version)",
    "who (made|created) you", "are you (chatgpt|gpt|gemini|claude|an ai|a robot)",
    "ignore (all )?previous", "system prompt", "\\bapple (fruit|iphone|watch|mac)"
  ]);

  var LAY_FIRST = /^(i|i've|ive|i have|i had|i am|i'm|im|my)\b/;
  var LAY_ADVICE = /\b(what should i (do|take|use)|what (do|can) i (do|take)|is (it|this) serious|should i (worry|be worried|see|go|take)|how do i (get rid of|cure|treat) my|home remed|help me feel|what medicine should i)\b/;
  var PROFESSIONAL = /\b(patient|\bpt\b|case|workup|work-up|differential|\bddx\b|\bdx\b|manage(ment)?|guideline|protocol|regimen|dose|dosing|prescrib|admit|discharge|indicated|contraindicat)\b/;

  // ── Runtime augmentation (browser only): the app's own lexicons widen MEDICAL for free. Exact-ish
  // resolution only (never fuzzy) so it cannot re-introduce the "write"→"Writer's cramp" leak. ─────
  // Question wrappers a clinician puts around a bare term. Stripped before the lexicon lookup, which
  // is EXACT: without this, "PCOD" resolved but "What is PCOD?" did not, so the runtime widening
  // silently did nothing for any real sentence. Observed on device as a refusal for "What is PCOD?".
  var WRAPPER = /^(what|whats|what's|which|who|how|why|when|where|is|are|does|do|can|tell|explain|define|describe|about|give|show|list|the|a|an|of|for|in|on|to|me|us|info|information|details?|treatment|treat|management|manage|rx|tx|mx|dose|dosing|dosage|signs?|symptoms?|diagnosis|workup|causes?|side|effects?|mechanism|action|moa|uses?|indications?)$/;

  /** Strip leading/trailing wrapper words so an EXACT lexicon lookup sees the bare clinical term. */
  function core(s) {
    var t = norm(s).replace(/[?!.,;:]+$/g, "").trim().split(/\s+/).filter(Boolean);
    while (t.length && WRAPPER.test(t[0])) t.shift();
    while (t.length && WRAPPER.test(t[t.length - 1])) t.pop();
    return t.join(" ");
  }

  function lexiconMedical(s) {
    try {
      if (typeof window === "undefined") return false;
      var w = window;
      // Try the query as typed, then with the question wrapper removed. Both are EXACT lookups, so
      // this cannot re-introduce the "write" -> "Writer's cramp" fuzzy leak.
      var cands = [s], c = core(s);
      if (c && c !== s) cands.push(c);
      for (var i = 0; i < cands.length; i++) {
        var q = cands[i];
        if (!q) continue;
        if (w.MEDDRUGS && typeof w.MEDDRUGS.isKnownGeneric === "function" && w.MEDDRUGS.isKnownGeneric(q)) return true;
        if (w.MaiKKB && typeof w.MaiKKB.isKnownConcept === "function" && w.MaiKKB.isKnownConcept(q)) return true;
      }
    } catch (e) {}
    return false;
  }

  // Clinical shorthand MODIFIERS — a doctor's "rx X / X tx / X meds / X ppx / X exac" IS a clinical
  // query. Used TWO-FACTOR only (modifier + a medical/known token), never standalone: "rx apple" stays
  // blocked while "rx malaria" / "mi rx" / "htn meds" pass.
  var MODIFIER = /\b(rx|tx|mx|ddx|mgmt|meds?|medications?|exac|exacerbation|pep|ppx|prophylax\w*|protocol|workup|work-up|w[-\/]u|dose|dosing|dosage|abx|antibiotics?|empiric|screening|monitoring|complications?|staging)\b/;
  function expandAbbrevSafe(s) { try { return (typeof window !== "undefined" && window.MaiKKB && window.MaiKKB.expandAbbrev) ? window.MaiKKB.expandAbbrev(s) : s; } catch (e) { return s; } }

  // ── User-configurable extra terms (no code change / no rebuild). ────────────────────────────────
  var extraAllow = null, extraBlock = null;
  function configure(cfg) {
    if (!cfg) return;
    if (cfg.allow && cfg.allow.length) extraAllow = rx(cfg.allow.map(String), "i");
    if (cfg.block && cfg.block.length) extraBlock = rx(cfg.block.map(String), "i");
  }
  try { if (typeof window !== "undefined" && window.MAIK_SCOPE_CONFIG) configure(window.MAIK_SCOPE_CONFIG); } catch (e) {}

  // ── The firewall. Returns { medical, category }. category ∈ {medical, lay, code, creative,
  //    general, non_medical}. `medical:true` ⇒ proceed to the AI pipeline; else refuse. ────────────
  function classify(q) {
    var s = norm(q);
    if (!s || s.length < 3) return { medical: true, category: "medical", certain: false }; // trivial → normal flow

    if (extraBlock && extraBlock.test(s)) return { medical: false, category: "blocked", certain: true };
    if (LAY_FIRST.test(s) && LAY_ADVICE.test(s) && !PROFESSIONAL.test(s)) return { medical: false, category: "lay", certain: true };

    if ((extraAllow && extraAllow.test(s)) || MEDICAL.test(s) || lexiconMedical(s)) return { medical: true, category: "medical", certain: true };

    // Runtime widening (browser): a clinical MODIFIER paired with a medical/KB-known token — TWO-FACTOR
    // so "MS Dhoni"/"PE teacher" (no modifier) stay blocked while "mi rx"/"htn meds"/"rx malaria" pass.
    // (The abbrev-expanded morphology is checked ONLY behind the modifier gate, never standalone, so
    // ms->"multiple sclerosis" / pe->"...embolism" can't leak on their own.)
    if (MODIFIER.test(s)) {
      var xp = expandAbbrevSafe(s);
      if (lexiconMedical(s) || (xp !== s && (lexiconMedical(xp) || MEDICAL.test(xp)))) return { medical: true, category: "medical", certain: true };
    }

    if (HARD_NON_MEDICAL.test(s) || CODE_VERB_OBJ.test(s) || INTEGRATE.test(s)) return { medical: false, category: "code", certain: true };
    if (CREATIVE.test(s)) return { medical: false, category: "creative", certain: true };
    if (GENERAL.test(s)) return { medical: false, category: "general", certain: true };
    // NO SIGNAL EITHER WAY. This is NOT the same as "not medical", and treating it as a refusal was
    // the bug a doctor hit: "PCOD?" and "SGLT2 mechanism of action" are perfectly good clinical
    // questions that simply were not in the vocabulary, and MaiK told the doctor it only answers
    // medical questions. No finite allow-list can hold all of medicine, so an unrecognised query is
    // marked UNCERTAIN and the caller decides. The cheap deterministic layer refuses only what it can
    // positively identify as non-clinical; anything it cannot name goes to the model, which has the
    // world knowledge to tell PCOD from a state capital and refuses non-medical itself.
    return { medical: false, category: "non_medical", certain: false };
  }

  function isNonMedical(q) { return classify(q).medical === false; }
  /** TRUE only for a query we can positively identify as non-clinical. An unrecognised query is NOT
   *  refused here - it goes to the model. This is the predicate every gate should use. */
  function isRefusable(q) { var c = classify(q); return c.medical === false && c.certain === true; }
  function reason(q) { var c = classify(q); return c.medical ? null : c.category; }

  return { classify: classify, isNonMedical: isNonMedical, isRefusable: isRefusable, reason: reason, norm: norm, core: core, configure: configure };
});
