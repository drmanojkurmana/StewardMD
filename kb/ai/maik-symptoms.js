/* MaiK symptom -> approach layer (window.MAIK_SYMPTOMS). Doctors ask by PRESENTATION ("fever", "chest
 * pain") but the disease KB is keyed by diagnosis, so those miss -> slow web / "limited material". This
 * gives a fast, conservative first-approach (common + can't-miss differentials, first-line workup, red
 * flags) for the highest-frequency presentations. Consulted by maik-kb compose() ONLY on a KB-miss.
 *
 * CONTENT STATUS: educational starter, textbook-standard, CONSERVATIVE. **Pending clinician review** before
 * being treated as authoritative — every answer carries the "verify" caveat. Flag smd_maik_symptoms
 * (default ON; set localStorage smd_maik_symptoms="0" to disable). Grow entries after review.
 *
 * Node-testable: pure functions, module.exports. No network, no DOM.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis : this);

  function flagOn() { try { return G.localStorage && G.localStorage.getItem("smd_maik_symptoms") === "0" ? false : true; } catch (e) { return true; } }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(); }

  // Each entry: aliases (whole-phrase or contained keyword), + the four clinical blocks. Kept conservative.
  var SX = [
    { id: "fever", aliases: ["fever", "pyrexia", "high temperature", "high grade fever", "febrile"],
      common: "Viral URI/influenza, UTI, community-acquired pneumonia, acute gastroenteritis; in endemic areas dengue, malaria, enteric (typhoid) fever; skin/soft-tissue infection.",
      cantmiss: "Sepsis, bacterial meningitis, malaria, dengue with warning signs, febrile neutropenia, endocarditis.",
      workup: "Focused history + exam for a source; CBC with differential, urinalysis; if endemic/undifferentiated: malaria smear/RDT, dengue NS1/serology; CXR if respiratory; blood cultures if toxic; CRP/procalcitonin per context.",
      red: "Hypotension/tachycardia (sepsis), neck stiffness/photophobia/altered sensorium, petechiae/bleeding, breathlessness/SpO2 fall, no source with high fever, immunocompromise or recent chemo." },
    { id: "chest pain", aliases: ["chest pain", "chest discomfort", "chest tightness"],
      common: "Musculoskeletal/costochondritis, GERD, anxiety, stable angina.",
      cantmiss: "Acute coronary syndrome, aortic dissection, pulmonary embolism, tension pneumothorax, pericarditis with tamponade, oesophageal rupture.",
      workup: "ECG immediately + serial troponin; vitals incl. BP both arms + SpO2; CXR; consider D-dimer/CTPA if PE suspected; risk-stratify (HEART/TIMI).",
      red: "Crushing/radiating pain with sweating or dyspnoea, hypotension, tearing pain to the back, unequal arm BP, hypoxia, syncope." },
    { id: "breathlessness", aliases: ["breathlessness", "shortness of breath", "dyspnea", "dyspnoea", "difficulty breathing", "sob"],
      common: "Asthma/COPD exacerbation, LRTI/pneumonia, heart failure, anaemia, anxiety.",
      cantmiss: "Pulmonary embolism, ACS, tension pneumothorax, anaphylaxis, acute pulmonary oedema, severe asthma.",
      workup: "SpO2 + respiratory rate + ABG if severe; ECG; CXR; CBC; BNP/echo if cardiac; peak flow in asthma; D-dimer/CTPA if PE suspected.",
      red: "SpO2 <92%, RR >30 or exhaustion, unable to speak full sentences, silent chest, hypotension, one-sided absent breath sounds." },
    { id: "headache", aliases: ["headache", "head ache", "cephalgia"],
      common: "Tension-type, migraine, sinusitis, medication-overuse, refractive error.",
      cantmiss: "Subarachnoid haemorrhage, meningitis/encephalitis, raised ICP/space-occupying lesion, temporal arteritis (>50y), venous sinus thrombosis, acute glaucoma.",
      workup: "History for thunderclap/onset + red flags; BP; fundoscopy; non-contrast CT head then LP if SAH suspected; ESR/CRP if GCA; neuro exam.",
      red: "Thunderclap (worst-ever, sudden), fever + neck stiffness, focal deficit/seizure, papilloedema, new headache >50y or immunocompromised, worse on waking/valsalva." },
    { id: "abdominal pain", aliases: ["abdominal pain", "stomach pain", "belly pain", "tummy pain", "abdomen pain"],
      common: "Gastritis/dyspepsia, gastroenteritis, constipation, UTI, dysmenorrhoea, biliary colic.",
      cantmiss: "Appendicitis, perforation/peritonitis, bowel obstruction, ectopic pregnancy, AAA, mesenteric ischaemia, pancreatitis, DKA.",
      workup: "Vitals; urine pregnancy test in women of childbearing age; urinalysis; CBC, lipase, LFT, renal panel; erect CXR/USG/CT per suspicion; capillary glucose/ketones if unwell.",
      red: "Rigid/guarding abdomen, hypotension, pain out of proportion, GI bleeding, pregnancy with pain/bleeding, absolute constipation + distension + vomiting." },
    { id: "vomiting diarrhea", aliases: ["vomiting", "diarrhea", "diarrhoea", "loose motion", "loose motions", "vomiting and diarrhea", "gastroenteritis"],
      common: "Acute viral/bacterial gastroenteritis, food poisoning, medication effect.",
      cantmiss: "Dehydration/shock, DKA, surgical abdomen, sepsis, electrolyte derangement (hypokalaemia), cholera (profuse).",
      workup: "Assess hydration + vitals; oral rehydration first-line; electrolytes/renal panel if unwell; stool studies only if bloody/prolonged/immunocompromised; glucose/ketones if diabetic.",
      red: "Signs of shock/severe dehydration, blood in stool, high fever, no urine output, altered sensorium, unable to keep fluids down." },
    { id: "dizziness", aliases: ["dizziness", "giddiness", "vertigo", "lightheadedness", "light headed"],
      common: "BPPV, vestibular neuritis, orthostatic hypotension, anaemia, anxiety, dehydration.",
      cantmiss: "Posterior-circulation stroke/TIA, cardiac arrhythmia, GI bleed with anaemia, hypoglycaemia.",
      workup: "BP lying/standing; capillary glucose; ECG; HINTS exam for central vs peripheral vertigo; Hb; neuro exam.",
      red: "New neuro deficit, sudden severe headache, chest pain/palpitations/syncope, inability to walk, central-pattern nystagmus." },
    { id: "sore throat", aliases: ["sore throat", "throat pain", "pharyngitis"],
      common: "Viral pharyngitis (most), streptococcal pharyngitis, tonsillitis.",
      cantmiss: "Peritonsillar abscess, epiglottitis, retropharyngeal abscess, diphtheria (unimmunized).",
      workup: "Centor/McIsaac score; examine for exudate/unilateral swelling/trismus; RADT/throat swab where indicated; antibiotics only per score/local guidance (AMR).",
      red: "Drooling, muffled voice, stridor, trismus, severe unilateral swelling, neck swelling, difficulty breathing or swallowing." },
    { id: "low back pain", aliases: ["low back pain", "back pain", "lumbago", "lower back pain"],
      common: "Mechanical/muscular strain, degenerative disc/facet disease, sciatica.",
      cantmiss: "Cauda equina syndrome, vertebral fracture, spinal infection/abscess, malignancy/metastasis, AAA.",
      workup: "Red-flag screen; neuro exam incl. saddle sensation + anal tone if suspicious; imaging only if red flags/persistent; ESR/CRP if infection/malignancy suspected.",
      red: "Saddle anaesthesia, bladder/bowel dysfunction, bilateral leg weakness, fever + back pain, unexplained weight loss, trauma, age >50 with new pain or cancer history." },
    { id: "syncope", aliases: ["syncope", "fainting", "passed out", "loss of consciousness", "blackout", "collapse"],
      common: "Vasovagal, orthostatic hypotension, situational (cough/micturition), dehydration.",
      cantmiss: "Cardiac arrhythmia, structural heart disease/aortic stenosis, PE, GI bleed, subarachnoid haemorrhage, hypoglycaemia.",
      workup: "ECG (mandatory); lying/standing BP; capillary glucose; Hb; echo if cardiac suspected; consider troponin; risk-stratify.",
      red: "Syncope on exertion or supine, palpitations before, family history of sudden death, abnormal ECG, chest pain, no prodrome, injury." },
    // ---- common CONDITIONS (management-oriented). Same conservative, verify-labelled, review-pending status. ----
    { id: "hypertension", type: "condition", aliases: ["hypertension", "high blood pressure", "high bp", "raised bp", "htn"],
      firstline: "Lifestyle first (salt <5 g/day, weight, activity, limit alcohol/tobacco). Drug classes: ACE-inhibitor or ARB, calcium-channel blocker (e.g. amlodipine), or thiazide-like diuretic; combine as needed. Prefer ACEi/ARB if diabetic or proteinuric; CCB/thiazide often first in older/African-origin patients.",
      workup: "Confirm with repeated / out-of-office readings before labelling. Baseline: renal function + electrolytes, urine for protein, fasting glucose + lipids, ECG; assess total CV risk + end-organ damage.",
      refer: "Consider a SECONDARY cause if young, resistant to 3 drugs, or abrupt/severe. Target broadly <140/90 (individualise; tighter in diabetes/CKD per local guideline).",
      red: "Hypertensive EMERGENCY — BP >180/120 with acute organ damage (chest pain, breathlessness, neuro deficit, visual loss, pregnancy with features): urgent, do not just send home." },
    { id: "urinary tract infection", type: "condition", aliases: ["urinary tract infection", "uti", "cystitis", "urine infection", "burning micturition"],
      firstline: "Uncomplicated cystitis (non-pregnant women): a short course per LOCAL antibiogram (e.g. nitrofurantoin — avoid if CrCl <45) + hydration. Pyelonephritis: systemic antibiotics per local guidance + assess need for admission. Do NOT treat asymptomatic bacteriuria (except in pregnancy).",
      workup: "Urine dipstick/analysis; send CULTURE if complicated, recurrent, male, pregnant, or pyelonephritis (guides AMR-aware therapy). Imaging if obstruction/stone suspected.",
      refer: "Pregnancy, men, children, recurrent, or suspected obstruction/stone warrant culture ± specialist input; review antibiotic against sensitivities.",
      red: "Fever + flank pain/vomiting (pyelonephritis), sepsis signs (hypotension/tachycardia/confusion), pregnancy, known obstruction/stone, failure to improve in 48 h — escalate." }
  ];

  // strip leading + trailing intent words so "how to approach fever" / "fever workup" reduce to "fever"
  function stripIntent(n) {
    n = n.replace(/^(how (to|do i) (approach|work ?up|manage|evaluate|assess|treat|handle)|approach to|workup of|work up of|evaluation of|management of|managing|what to do (in|for)|causes? of|differential(s)? (of|for)|ddx (of|for)|red flags? (of|in|for)|treatment of|treating)\s+/i, "");
    n = n.replace(/\s+(treatment|management|workup|work ?up|approach|causes|differentials?|ddx|red flags?|evaluation|assessment|mx|ix)$/i, "");
    return n.trim();
  }
  // exactOnly=true: only when the query IS a bare presentation (residual === an alias) — so "fever" hits but
  // "pyrexia of unknown origin"/"dengue fever" fall through to the disease KB. exactOnly=false: contained
  // keyword match (used as a KB-miss fallback).
  function find(q, exactOnly) {
    var n = stripIntent(norm(q));
    for (var i = 0; i < SX.length; i++) { for (var j = 0; j < SX[i].aliases.length; j++) { if (n === SX[i].aliases[j]) return SX[i]; } }   // exact presentation
    if (exactOnly) return null;
    var best = null;
    for (var a = 0; a < SX.length; a++) { for (var b = 0; b < SX[a].aliases.length; b++) { var al = SX[a].aliases[b]; if ((" " + n + " ").indexOf(" " + al + " ") >= 0) { if (!best || al.length > best._m) { best = SX[a]; best._m = al.length; } } } }
    return best;
  }
  function title(id) { return id.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function answer(e) {
    if (e.type === "condition") {
      return "**" + title(e.id) + " — first-line approach**\n" +
        "**First-line management:** " + e.firstline + "\n" +
        "**Baseline workup:** " + e.workup + "\n" +
        "**Targets / when to refer:** " + e.refer + "\n" +
        "**Red flags (escalate):** " + e.red + "\n\n" +
        "StewardMD approach · educational, guideline-level — individualise + verify against local protocol.";
    }
    return "**" + title(e.id) + " — first approach**\n" +
      "**Common causes:** " + e.common + "\n" +
      "**Can't-miss:** " + e.cantmiss + "\n" +
      "**First-line workup:** " + e.workup + "\n" +
      "**Red flags (escalate):** " + e.red + "\n\n" +
      "StewardMD symptom guide · educational first-approach, not a diagnosis — correlate clinically and verify locally.";
  }
  function compose(q, exactOnly) {
    if (!flagOn()) return null;
    var e = find(q, exactOnly); if (!e) return null;
    return { name: e.id, text: answer(e) };
  }

  var API = { compose: compose, _find: find, _ids: function () { return SX.map(function (e) { return e.id; }); }, flagOn: flagOn };
  if (typeof module !== "undefined" && module.exports) module.exports = API;   // node tests
  G.MAIK_SYMPTOMS = API;
})();
