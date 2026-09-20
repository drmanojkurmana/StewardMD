/* clinix-dx.js — CliniX · the differential picker, the diagnosis picker and the management MCQ
 * ============================================================================================
 * WHY. The case used to ask three open questions in a row ("what are your differentials", "what is
 * your diagnosis", "how would you manage this patient") and mark the free text by keyword overlap.
 * A student who wrote a perfectly good differential in their own words could be marked wrong, and a
 * student who wrote nothing useful but happened to include an accepted keyword could be marked
 * right. Owner, 2026-09-19: "in ddx, dx give him 100s of diagnosis and he will pickup one and give
 * hints too, and plan also give mcq options so he will select".
 *
 * WHAT IS HERE (all pure: no DOM, no fetch, deterministic):
 *   search(vocab, q)      hundreds of diagnoses, searched by name, synonym and typo
 *   shortlist(...)        what to show BEFORE the student searches: the plausible candidates for
 *                         this case's system, so the picker is never an empty box
 *   hints(caseDef, level) three escalating hints, each derived from the case, each recorded
 *   scoreDifferential()   credit for the diagnoses that belong, a note for the ones that do not,
 *                         and an explicit shotgun flag so listing everything cannot score well
 *   scoreDiagnosis()      one pick against the case's accepted answers
 *   planOptions()         select-all-that-apply management options built from the case's own model
 *                         answer plus distractors that are wrong for THIS case by construction
 *   scorePlan()           credit, penalty for the harmful ones, and what was missed
 *
 * The vocabulary is clinix/dx-vocabulary.json (365 diagnoses, 17 systems), fetched on first use.
 * Nothing here is parsed at launch.
 * ============================================================================================ */
(function () {
  "use strict";

  function lex() {
    try { if (typeof window !== "undefined" && window.SMD_CLINIX_LEXICON) return window.SMD_CLINIX_LEXICON; } catch (e) {}
    try { if (typeof require === "function") return require("./clinix-lexicon.js"); } catch (e) {}
    return null;
  }
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function isArr(x) { return Object.prototype.toString.call(x) === "[object Array]"; }

  /* ── 1. searching the vocabulary ─────────────────────────────────────────────────────────── */

  // Every searchable string for one entry: the name, each synonym, and the name's own words.
  function terms(entry) {
    var out = [norm(entry.n)];
    var syn = entry.syn || [];
    for (var i = 0; i < syn.length; i++) out.push(norm(syn[i]));
    return out;
  }

  /* Ranked search. A prefix match on the full name beats a prefix match on a synonym, which beats a
   * word-start match inside the name, which beats a typo-tolerant match. Ranking matters more than
   * recall here: a student typing "hf" wants heart failure at the top, not somewhere in 40 rows. */
  function search(vocab, query, opts) {
    opts = opts || {};
    var limit = opts.limit || 40;
    var list = (vocab && vocab.dx) || [];
    var q = norm(query);
    if (!q) return [];
    var L = lex();
    var hits = [], i, j;

    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (opts.system && e.s !== opts.system) continue;
      var t = terms(e), best = 0;
      for (j = 0; j < t.length; j++) {
        var term = t[j], score = 0;
        if (term === q) score = 100;
        else if (term.indexOf(q) === 0) score = j === 0 ? 90 : 84;
        else if ((" " + term).indexOf(" " + q) >= 0) score = j === 0 ? 70 : 66;
        else if (term.indexOf(q) >= 0) score = 50;
        else if (L && L.within && q.length >= 5 && Math.abs(term.length - q.length) <= 2 && L.within(q, term, q.length >= 8 ? 2 : 1)) score = 40;
        // Every word of the query present somewhere in the term ("heart fail" -> heart failure).
        else if (q.indexOf(" ") > 0) {
          var w = q.split(" "), all = true;
          for (var k = 0; k < w.length; k++) if (w[k] && (" " + term).indexOf(" " + w[k]) < 0) { all = false; break; }
          if (all) score = 60;
        }
        if (score > best) best = score;
      }
      if (best > 0) hits.push({ n: e.n, s: e.s, syn: e.syn || [], score: best });
    }
    hits.sort(function (a, b) { return b.score - a.score || a.n.length - b.n.length || (a.n < b.n ? -1 : 1); });
    return hits.slice(0, limit);
  }

  function bySystem(vocab, systemId, limit) {
    var list = (vocab && vocab.dx) || [], out = [];
    for (var i = 0; i < list.length && (!limit || out.length < limit); i++) {
      if (list[i].s === systemId) out.push({ n: list[i].n, s: list[i].s, syn: list[i].syn || [] });
    }
    return out;
  }
  function systems(vocab) { return (vocab && vocab.systems) || []; }

  /* Map a CliniX content system id ("respiratory") onto a vocabulary system id ("resp"). The two
   * vocabularies were written for different purposes and a lookup table is honest about that. */
  var SYSTEM_MAP = {
    respiratory: "resp", cardiovascular: "cvs", cvs: "cvs", abdomen: "gi", gastrointestinal: "gi",
    git: "gi", hepatobiliary: "hepbil", liver: "hepbil", renal: "renal", genitourinary: "renal",
    neurology: "neuro", neuro: "neuro", endocrine: "endo", haematology: "heme", hematology: "heme",
    blood: "heme", infectious: "id", infection: "id", rheumatology: "rheum", oncology: "onc",
    dermatology: "derm", skin: "derm", psychiatry: "psych", obstetrics: "obgy", gynaecology: "obgy",
    paediatrics: "paeds", pediatrics: "paeds", emergency: "emerg", critical: "emerg", general: "misc"
  };
  function vocabSystemFor(systemId) {
    var k = norm(systemId).replace(/ /g, "");
    return Object.prototype.hasOwnProperty.call(SYSTEM_MAP, k) ? SYSTEM_MAP[k] : "";
  }

  /* ── 2. the shortlist the picker opens on ────────────────────────────────────────────────── */

  /* An empty search box is a worse question than the free text it replaced. The picker opens on a
   * plausible shortlist for the case's system: the student still has to choose, and can still
   * search all 365, but is not made to guess what vocabulary the app will accept. */
  function shortlist(vocab, caseDef, systemId, n) {
    n = n || 12;
    var vs = vocabSystemFor(systemId || (caseDef && caseDef.system) || "");
    var out = [], seen = {}, i;
    function push(e) { if (e && !seen[e.n]) { seen[e.n] = 1; out.push(e); } }
    // The case's own accepted differentials come first when they exist in the vocabulary, so the
    // right answers are reachable without searching. They are NOT marked, and they are shuffled in
    // among the rest of the system by the caller's ordering.
    var accept = (caseDef && caseDef.differentialModel && caseDef.differentialModel.accept) || [];
    for (i = 0; i < accept.length; i++) {
      var f = findByTerm(vocab, accept[i]);
      if (f) push({ n: f.n, s: f.s, syn: f.syn || [] });
    }
    if (vs) { var sys = bySystem(vocab, vs); for (i = 0; i < sys.length && out.length < n; i++) push(sys[i]); }
    for (i = 0; out.length < n && i < ((vocab && vocab.dx) || []).length; i++) push({ n: vocab.dx[i].n, s: vocab.dx[i].s, syn: vocab.dx[i].syn || [] });
    out.sort(function (a, b) { return a.n < b.n ? -1 : (a.n > b.n ? 1 : 0); });
    return out.slice(0, n);
  }

  // The vocabulary entry whose name or synonym IS this term (not merely contains it).
  function findByTerm(vocab, term) {
    var t = norm(term), list = (vocab && vocab.dx) || [], i, j;
    if (!t) return null;
    for (i = 0; i < list.length; i++) {
      var ts = terms(list[i]);
      for (j = 0; j < ts.length; j++) if (ts[j] === t) return list[i];
    }
    return null;
  }

  /* ── 3. hints ────────────────────────────────────────────────────────────────────────────── */

  /* Three levels, escalating, each derived from the case itself so nothing is invented, and each
   * one weaker than simply being told. Level 3 names a category, never the diagnosis: a hint that
   * gives the answer is not a hint, it is the answer with extra steps. */
  function hints(caseDef, vocab, systemId) {
    var out = [];
    var vs = vocabSystemFor(systemId || (caseDef && caseDef.system) || "");
    var sysName = "";
    var ss = systems(vocab);
    for (var i = 0; i < ss.length; i++) if (ss[i].id === vs) sysName = ss[i].name;
    if (sysName) out.push({ level: 1, text: "This patient's problem is " + sysName.toLowerCase() + ". Filter the list to that system." });

    // Level 2: the single most useful thing the case already told them.
    var tp = (caseDef && caseDef.teachingPoints) || [];
    if (tp.length) out.push({ level: 2, text: tp[0] });

    // Level 3: how many of the listed diagnoses are actually on the model differential, and the
    // first letter of one of them. Enough to break a deadlock, not enough to skip the thinking.
    var accept = (caseDef && caseDef.differentialModel && caseDef.differentialModel.accept) || [];
    var need = (caseDef && caseDef.differentialModel && caseDef.differentialModel.minMatch) || Math.ceil(accept.length / 2);
    if (accept.length) {
      out.push({
        level: 3,
        text: "The model answer lists " + accept.length + " reasonable possibilities and expects at least " +
          need + " of them. One of them begins with “" + String(accept[0]).charAt(0).toUpperCase() + "”."
      });
    }
    return out;
  }

  /* ── 4. marking the picks ────────────────────────────────────────────────────────────────── */

  // Does this picked diagnosis satisfy an accepted term? Matching is on whole terms in both
  // directions plus the vocabulary's own synonyms, so "CCF" satisfies "heart failure".
  function satisfies(vocab, pick, term) {
    var p = norm(pick), t = norm(term);
    if (!p || !t) return false;
    if (p === t) return true;
    if ((" " + p + " ").indexOf(" " + t + " ") >= 0) return true;
    if ((" " + t + " ").indexOf(" " + p + " ") >= 0) return true;
    var e = findByTerm(vocab, pick);
    if (e) {
      var ts = terms(e);
      for (var i = 0; i < ts.length; i++) {
        if (ts[i] === t) return true;
        if ((" " + ts[i] + " ").indexOf(" " + t + " ") >= 0) return true;
      }
    }
    return false;
  }

  /* British and American spellings of the same word are the same concept. The accept lists carry
   * both on purpose (they were written for keyword marking), and counting them twice would tell a
   * student they missed two things when they missed one. */
  function anglicise(t) {
    return norm(t).replace(/ae/g, "e").replace(/oe/g, "e").replace(/\bhaem/g, "hem");
  }
  /* Collapse a case's accept list into CONCEPTS: terms that resolve to the same vocabulary entry,
   * or to the same anglicised string, are one thing to have thought of. */
  function conceptKey(vocab, term) {
    var e = findByTerm(vocab, term);
    return e ? "v:" + e.n : "t:" + anglicise(term);
  }

  /* Score a picked differential. Reported as parts, never as one percentage: which picks landed,
   * which concepts were missed, and what was added that does not belong. A student who selects
   * twenty diagnoses has not made a differential, so `shotgun` is set and the verdict is never
   * "good". Scoring counts PICKS, not accept terms: an accept list that spells one concept three
   * ways must not let one correct pick read as three. */
  function scoreDifferential(caseDef, picks, vocab, opts) {
    opts = opts || {};
    picks = isArr(picks) ? picks : [];
    var model = (caseDef && caseDef.differentialModel) || {};
    var accept = model.accept || [];
    var need = typeof model.minMatch === "number" ? model.minMatch : Math.ceil(accept.length / 2);
    var matched = [], extra = [], i, j;
    var hitConcept = {};

    for (i = 0; i < picks.length; i++) {
      var onList = false;
      for (j = 0; j < accept.length; j++) {
        if (satisfies(vocab, picks[i], accept[j])) { onList = true; hitConcept[conceptKey(vocab, accept[j])] = 1; }
      }
      (onList ? matched : extra).push(picks[i]);
    }
    var missed = [], seenMiss = {};
    for (i = 0; i < accept.length; i++) {
      var ck = conceptKey(vocab, accept[i]);
      if (hitConcept[ck] || seenMiss[ck]) continue;
      seenMiss[ck] = 1;
      var ent = findByTerm(vocab, accept[i]);
      missed.push(ent ? ent.n : accept[i]);
    }
    // The true diagnosis must be somewhere in the differential. Missing it is the one failure that
    // no amount of breadth makes up for.
    var dxTerms = (caseDef && caseDef.diagnosis && caseDef.diagnosis.accept) || [];
    var hasTruth = false;
    for (i = 0; i < dxTerms.length && !hasTruth; i++) {
      for (j = 0; j < picks.length; j++) if (satisfies(vocab, picks[j], dxTerms[i])) { hasTruth = true; break; }
    }
    var shotgun = picks.length >= 8 || (extra.length > matched.length && extra.length >= 3);
    return {
      picked: picks.slice(),
      matched: matched, missed: missed, extra: extra,
      need: need, hasTruth: hasTruth, shotgun: shotgun,
      hintsUsed: opts.hintsUsed || 0,
      correct: matched.length >= need && hasTruth && !shotgun
    };
  }

  function scoreDiagnosis(caseDef, pick, vocab) {
    var accept = (caseDef && caseDef.diagnosis && caseDef.diagnosis.accept) || [];
    var hit = null;
    for (var i = 0; i < accept.length; i++) if (satisfies(vocab, pick, accept[i])) { hit = accept[i]; break; }
    return { given: pick || "", correct: !!hit, matched: hit, answer: (caseDef && caseDef.diagnosis && caseDef.diagnosis.answer) || "" };
  }

  /* ── 5. the management MCQ ───────────────────────────────────────────────────────────────── */

  /* Readable option text for the terse action keys the cases use in managementModel.accept
   * ("diuretic", "sglt2", "arni"). A key with no entry here still becomes an option, using the
   * author's own wording, so the bank can never silently drop a correct answer. */
  var ACTION_TEXT = {
    /* Added 2026-09-19 when the plan stage became an MCQ: these are the accept terms the disease
     * bank actually uses. Without a reading here an option printed as the marking fragment itself
     * ("Replace", "Treatable", "88"), which is unanswerable. */
    "antibiotic": "Start empiric antibiotics guided by the local policy",
    "culture": "Send cultures before the first antibiotic dose",
    "blood gas": "Take an arterial blood gas and repeat it after treatment",
    "chest radiograph": "Request a chest radiograph",
    "non-invasive": "Start non invasive ventilation if the pH and PaCO2 warrant it",
    "airway": "Secure the airway and assess the swallow before anything is given by mouth",
    "swallow": "Keep the patient nil by mouth until a swallow screen is passed",
    "glucose": "Check the capillary glucose and correct hypoglycaemia",
    "blood pressure": "Measure and manage the blood pressure to the target for this presentation",
    "reperfusion": "Arrange reperfusion within the treatment window",
    "percutaneous": "Refer for primary percutaneous coronary intervention",
    "antiplatelet": "Start antiplatelet therapy",
    "anticoagulate": "Start therapeutic anticoagulation",
    "dvt prophylaxis": "Prescribe venous thromboembolism prophylaxis",
    "rehabilitation": "Refer for early multidisciplinary rehabilitation",
    "secondary prevention": "Set up secondary prevention before discharge",
    "rate control": "Control the ventricular rate",
    "atrial fibrillation": "Treat the atrial fibrillation and assess the stroke risk",
    "sit up": "Sit the patient upright",
    "fluids": "Give intravenous fluids and reassess the response",
    "hydration": "Hydrate adequately before and during treatment",
    "monitor": "Admit for observation with a clear monitoring plan",
    "high dependency": "Escalate to a high dependency bed",
    "intensive care": "Refer to intensive care early",
    "respiratory": "Monitor the respiratory function with serial bedside measurements",
    "reassess": "Reassess after treatment rather than assuming a response",
    "review": "Arrange a review with a named clinician and a stated date",
    "follow-up": "Arrange structured follow up with a named clinician",
    "follow-up endoscopy": "Arrange follow up endoscopy to confirm healing",
    "follow-up sputum": "Arrange follow up sputum examination to confirm conversion",
    "red flag": "Give clear red flag advice on when to return",
    "education": "Explain the condition and its course to the patient and family",
    "action plan": "Give a written action plan for the next attack",
    "reassurance": "Explain that no intervention is needed and why",
    "no intervention": "Explain that no intervention is needed and why",
    "spontaneous closure": "Watch for spontaneous closure rather than intervening",
    "notify": "Notify the case to the public health programme",
    "notification": "Notify the case to the public health programme",
    "contact tracing": "Screen the household contacts",
    "dots": "Enrol the patient in directly observed therapy",
    "directly observed": "Enrol the patient in directly observed therapy",
    "multidrug": "Start multidrug antituberculous therapy",
    "antituberculous": "Start antituberculous therapy",
    "anti-tuberculous": "Start antituberculous therapy",
    "tb treatment": "Start antituberculous therapy",
    "alcohol cessation": "Support alcohol cessation and treat withdrawal",
    "cessation": "Support cessation and treat withdrawal",
    "sodium restriction": "Restrict dietary sodium",
    "aldosterone": "Add an aldosterone antagonist",
    "precipitant": "Look for and treat the precipitant",
    "encephalopathy": "Treat the encephalopathy and its trigger",
    "spontaneous bacterial peritonitis": "Tap the ascites to exclude spontaneous bacterial peritonitis",
    "aspiration": "Aspirate the collection for diagnosis and relief",
    "drain": "Insert a drain",
    "drainage": "Arrange drainage of the collection",
    "biliary decompression": "Arrange urgent biliary decompression",
    "ercp": "Refer for ERCP",
    "cholecystectomy": "Plan cholecystectomy on the same admission or soon after",
    "iron replacement": "Replace iron and recheck the response",
    "iron supplementation": "Replace iron and recheck the response",
    "proton pump inhibitor": "Start a proton pump inhibitor",
    "h pylori": "Test for and eradicate Helicobacter pylori",
    "helicobacter": "Test for and eradicate Helicobacter pylori",
    "b12": "Replace vitamin B12 and recheck the level",
    "allopurinol": "Start allopurinol with adequate hydration",
    "tumour lysis": "Anticipate and prevent tumour lysis syndrome",
    "tyrosine kinase inhibitor": "Start a tyrosine kinase inhibitor under specialist care",
    "imatinib": "Start imatinib under specialist care",
    "haematology referral": "Refer to haematology",
    "cardiology referral": "Refer to cardiology",
    "heart failure treatment": "Treat the underlying heart failure",
    "tricuspid": "Assess the tricuspid valve and the right heart",
    "immunoglobulin": "Give intravenous immunoglobulin",
    "ivig": "Give intravenous immunoglobulin",
    "plasma exchange": "Arrange plasma exchange",
    "plasmapheresis": "Arrange plasma exchange",
    "dopaminergic": "Start dopaminergic therapy titrated to function",
    "levodopa": "Start levodopa titrated to function",
    "physiotherapy": "Refer for physiotherapy",
    "gait training": "Arrange gait and balance training",
    "falls": "Assess and reduce the falls risk",
    "non-motor": "Ask about and treat the non motor symptoms",
    "eye protection": "Protect the eye with lubricant and taping overnight",
    "lubricant": "Protect the eye with lubricant and taping overnight",
    "emergency": "Treat this as a time critical emergency",
    "mri": "Arrange urgent MRI of the whole spine",
    "decompression": "Arrange urgent surgical decompression",
    "surgical": "Refer for surgery",
    "surgery": "Refer for surgery",
    "neurosurg": "Refer to neurosurgery",
    "orthopaedic": "Refer to orthopaedics",
    "bladder": "Manage the bladder and document the residual volume",
    "prophylaxis": "Start secondary prophylaxis and state its duration",
    "penicillin": "Give long acting penicillin prophylaxis",
    "valvotomy": "Refer for balloon valvotomy assessment",
    "balloon": "Refer for balloon valvotomy assessment",
    "endocarditis": "Give endocarditis prevention advice",
    "dental": "Arrange a dental review to find the portal of entry",
    "portal of entry": "Look for the portal of entry",
    "avoid trauma": "Advise avoiding contact sport and abdominal trauma",
    "oxygen": "Give controlled supplemental oxygen and sit the patient up",
    "diuretic": "Start an intravenous loop diuretic for decongestion",
    "loop diuretic": "Start an intravenous loop diuretic for decongestion",
    "furosemide": "Start intravenous furosemide, titrated to urine output",
    "fluid restriction": "Restrict fluid and salt intake",
    "salt restriction": "Restrict dietary salt",
    "ace inhibitor": "Start an ACE inhibitor once the patient is stable",
    "arb": "Start an angiotensin receptor blocker once stable",
    "arni": "Start an angiotensin receptor neprilysin inhibitor once stable",
    "beta blocker": "Start a beta blocker once decongested and euvolaemic",
    "mineralocorticoid": "Add a mineralocorticoid receptor antagonist",
    "spironolactone": "Add spironolactone with potassium monitoring",
    "sglt2": "Add an SGLT2 inhibitor",
    "statin": "Start a high intensity statin",
    "aspirin": "Give aspirin",
    "dual antiplatelet": "Start dual antiplatelet therapy",
    "anticoagulation": "Start therapeutic anticoagulation",
    "heparin": "Start low molecular weight heparin",
    "thrombolysis": "Consider thrombolysis within the treatment window",
    "pci": "Refer for primary percutaneous coronary intervention",
    "antibiotics": "Start empiric antibiotics guided by the local policy",
    "blood cultures": "Take blood cultures before the first antibiotic dose",
    "bronchodilator": "Give nebulised short acting bronchodilators",
    "nebulisation": "Give nebulised short acting bronchodilators",
    "steroid": "Give a short course of systemic corticosteroid",
    "corticosteroid": "Give a short course of systemic corticosteroid",
    "inhaled steroid": "Start or step up inhaled corticosteroid",
    "niv": "Start non invasive ventilation if the pH and PaCO2 warrant it",
    "ventilation": "Escalate to invasive ventilation if the patient tires",
    "pulmonary rehabilitation": "Refer for pulmonary rehabilitation",
    "smoking cessation": "Offer smoking cessation support and pharmacotherapy",
    "vaccination": "Offer influenza and pneumococcal vaccination",
    "inhaler technique": "Check and correct the inhaler technique before changing the drug",
    "att": "Start weight based anti-tubercular therapy after sputum confirmation",
    "anti tubercular": "Start weight based anti-tubercular therapy after sputum confirmation",
    "insulin": "Start an intravenous insulin infusion with hourly glucose monitoring",
    "fluids": "Give intravenous fluid resuscitation guided by perfusion",
    "potassium": "Replace potassium before and during insulin therapy",
    "lactulose": "Start lactulose titrated to two or three soft stools a day",
    "rifaximin": "Add rifaximin for secondary prophylaxis",
    "albumin": "Give intravenous albumin as indicated",
    "paracentesis": "Perform a diagnostic ascitic tap before starting antibiotics",
    "ppi": "Start a proton pump inhibitor infusion",
    "endoscopy": "Arrange upper gastrointestinal endoscopy",
    "transfusion": "Transfuse to the restrictive threshold, not to a normal haemoglobin",
    "iron": "Start iron replacement and find the cause of the loss",
    "dialysis": "Refer for renal replacement therapy if the indications are met",
    "stop nephrotoxics": "Stop every nephrotoxic drug, including NSAIDs",
    "stop nsaid": "Stop the NSAID",
    "withhold nsaid": "Stop the NSAID",
    "physiotherapy": "Refer for physiotherapy and early mobilisation",
    "follow up": "Arrange structured follow up with a named clinician",
    "counselling": "Counsel the patient and the family about the diagnosis and the plan",
    "adherence": "Address adherence explicitly and simplify the regimen where possible",
    "monitor renal function": "Monitor renal function and electrolytes daily",
    "monitor electrolytes": "Monitor renal function and electrolytes daily",
    "thromboprophylaxis": "Start thromboprophylaxis unless contraindicated",
    "analgesia": "Give adequate analgesia and reassess",
    "oxygen target": "Set an oxygen saturation target appropriate to the disease"
  };

  /* Distractors. Each one is wrong in essentially any case where it is not specifically indicated,
   * which is what makes them safe to offer against a case they were not written for. `harm` marks
   * the ones that would actively hurt the patient, so choosing them costs more than a plain miss. */
  var DISTRACTORS = [
    { t: "Start broad spectrum antibiotics before any assessment for infection", harm: true },
    { t: "Give a rapid intravenous fluid bolus regardless of the volume state", harm: true },
    { t: "Give a beta blocker during acute decompensation with fluid overload", harm: true },
    { t: "Prescribe an NSAID for symptom relief", harm: true },
    { t: "Send the patient home with reassurance and review in a month", harm: true },
    { t: "Start high dose oral steroids indefinitely", harm: true },
    { t: "Give intramuscular sedation so the patient settles", harm: true },
    { t: "Correct the sodium rapidly to the normal range today", harm: true },
    { t: "Transfuse to a haemoglobin above 12 g/dL", harm: false },
    { t: "Order a whole body CT before the basic tests are back", harm: false },
    { t: "Start anti-tubercular therapy without any microbiological support", harm: true },
    { t: "Add a second antihypertensive at every visit until the target is met today", harm: true },
    { t: "Ask the patient to stop all their regular medicines until review", harm: true },
    { t: "Arrange a repeat scan in six months and take no action now", harm: false },
    { t: "Prescribe a cough suppressant and nothing else", harm: false },
    { t: "Start an antidepressant for the somatic symptoms", harm: false }
  ];

  // Small deterministic PRNG so the option order is stable for a given case but not the same for
  // every case. A reshuffle on every render would move the answers under the student's finger.
  function seededOrder(list, seed) {
    var arr = list.slice(), s = 0, i, j, t;
    for (i = 0; i < String(seed).length; i++) s = (s * 31 + String(seed).charCodeAt(i)) % 2147483647;
    if (s <= 0) s = 12345;
    for (i = arr.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648;
      j = s % (i + 1);
      t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function titleCase(s) { s = String(s || "").trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* Build the select-all-that-apply list for a case. Correct options come from the case's own
   * managementModel.accept, so the marking and the options can never disagree. Distractors are
   * filtered against that same list, so an option can never be both a distractor and correct. */
  /* Some accept lists are keyword fragments rather than actions ("treatable", "88", "ventilat"):
   * they exist so a free-text answer can be keyword marked. They cannot become options, so they are
   * skipped, and a case left with too few real options falls back to the free-text plan stage. */
  var NOT_AN_ACTION = {
    "correct": 1, "replace": 1, "treatable": 1, "recovery": 1, "sepsis": 1, "immobilis": 1,
    "ventilat": 1, "dietary": 1, "reassess": 0
  };
  function actionTextFor(term) {
    var key = norm(term);
    if (!key) return "";
    if (Object.prototype.hasOwnProperty.call(ACTION_TEXT, key)) return ACTION_TEXT[key];
    if (NOT_AN_ACTION[key]) return "";
    if (/^[0-9.]+$/.test(key)) return "";                 // a target number, not a step
    if (key.length < 10 || key.indexOf(" ") < 0) return ""; // a single terse keyword with no reading
    return titleCase(term);
  }

  function planOptions(caseDef, opts) {
    opts = opts || {};
    var model = (caseDef && caseDef.managementModel) || {};
    var accept = model.accept || [];
    var maxDistractors = typeof opts.distractors === "number" ? opts.distractors : 5;
    /* Cap the correct answers too. A case whose model answer lists eleven actions would otherwise
     * produce a sixteen-item checklist where selecting almost everything scores well. The author's
     * order is their priority order, so the cap keeps the first and most important ones. */
    var maxCorrect = typeof opts.correct === "number" ? opts.correct : 6;
    var out = [], seenText = {}, i;

    for (i = 0; i < accept.length && out.length < maxCorrect; i++) {
      var text = actionTextFor(accept[i]);
      if (!text || seenText[text]) continue;
      seenText[text] = 1;
      out.push({ id: "a" + i, text: text, correct: true, term: accept[i] });
    }
    /* Fewer than three real actions is not a multiple choice question. Return nothing and let the
     * screen fall back to the free-text plan rather than show a two-option stub. */
    if (out.length < 3) return [];

    var pool = [];
    for (i = 0; i < DISTRACTORS.length; i++) {
      var d = DISTRACTORS[i];
      // A distractor that happens to name something this case actually wants is not a distractor.
      var clashes = false;
      for (var j = 0; j < accept.length; j++) {
        if (norm(d.t).indexOf(norm(accept[j])) >= 0) { clashes = true; break; }
      }
      if (!clashes && !seenText[d.t]) pool.push(d);
    }
    pool = seededOrder(pool, (caseDef && caseDef.id) || "case");
    for (i = 0; i < pool.length && i < maxDistractors; i++) {
      out.push({ id: "d" + i, text: pool[i].t, correct: false, harm: !!pool[i].harm });
    }
    return seededOrder(out, ((caseDef && caseDef.id) || "case") + "-order");
  }

  /* Mark the selection. Choosing a harmful option is reported separately from simply missing a
   * correct one: they are different mistakes and a student needs to see which they made. */
  function scorePlan(caseDef, chosenIds, options) {
    options = options || planOptions(caseDef);
    chosenIds = isArr(chosenIds) ? chosenIds : [];
    var picked = {}, i;
    for (i = 0; i < chosenIds.length; i++) picked[chosenIds[i]] = 1;
    var right = [], missed = [], wrong = [], harmful = [];
    for (i = 0; i < options.length; i++) {
      var o = options[i], on = !!picked[o.id];
      if (o.correct && on) right.push(o);
      else if (o.correct && !on) missed.push(o);
      else if (!o.correct && on) { wrong.push(o); if (o.harm) harmful.push(o); }
    }
    var total = right.length + missed.length;
    return {
      right: right, missed: missed, wrong: wrong, harmful: harmful,
      total: total,
      pct: total ? Math.round((right.length / total) * 100) : 0,
      // Harm is disqualifying on purpose: a plan that would hurt the patient is not a pass with a
      // deduction, and the result screen says which option it was.
      correct: total > 0 && right.length >= Math.ceil(total * 0.6) && harmful.length === 0,
      answer: (caseDef && caseDef.managementModel && caseDef.managementModel.answer) || ""
    };
  }

  var API = {
    search: search,
    bySystem: bySystem,
    systems: systems,
    shortlist: shortlist,
    findByTerm: findByTerm,
    vocabSystemFor: vocabSystemFor,
    hints: hints,
    satisfies: satisfies,
    scoreDifferential: scoreDifferential,
    scoreDiagnosis: scoreDiagnosis,
    planOptions: planOptions,
    scorePlan: scorePlan,
    ACTION_TEXT: ACTION_TEXT,
    DISTRACTORS: DISTRACTORS
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_DX = API;
})();
