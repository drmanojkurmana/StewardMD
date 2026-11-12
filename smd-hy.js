/* smd-hy.js: high-yield bolding for learning text. window.SMD_HY. ES5.
 * Owner, 2026-11-11 (KB reader photo): important points, words and concepts are BLACK BOLD only, no colour and no
 * tinted pill. The Knowledge Library already marks its terms through medFormat (reasoning.js, md-* classes, now ink);
 * this helper gives the same treatment to lesson text that has no formatter of its own: CliniX teaching turns and the
 * Ophthalmós / specialty-engine (Tokós, Narkē, SknX ...) lesson prose.
 *
 *   SMD_HY.html(text)  -> the text escaped, with high-yield spans wrapped in <b class="smd-hy">.
 *   SMD_HY.mark(safe)  -> the same for text that is ALREADY HTML-escaped and holds no tags.
 *   SMD_HY.RE          -> the combined pattern (for tests).
 *
 * What counts as high-yield (deliberately narrow, so a paragraph never turns into a wall of bold):
 *   - author markup **term** (CliniX / lesson content may carry it, as PrepNucleus does);
 *   - numbers with clinical units or a comparator: "2 g", "10-14 days", "<0.4", "80%", ">= 140";
 *   - signal phrases: pathognomonic, hallmark, classic triad, most common cause of X, gold standard,
 *     investigation / drug of choice, first-line, red flag, until proven otherwise, life-threatening;
 *   - absolutes and pitfalls: never, always, must, do not, avoid, contraindicated;
 *   - eponymous signs and tests: "Murphy's sign", "Romberg test", "Kernig sign";
 *   - bedside findings the lessons teach: shifting dullness, bronchial breathing, clubbing, papilloedema ...
 *   - the diagnoses, organisms and cardinal symptoms a lesson is built around: bronchiectasis, pulmonary oedema, Klebsiella ...
 * Display only. No clinical text is added, removed or reworded. */
(function (G) {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // first letter either case, so sentence-initial words match without making the whole pattern case-blind
  function ci(w) { return w.replace(/^([a-z])/, function (m, c) { return "[" + c + c.toUpperCase() + "]"; }); }
  function alt(list) { return list.map(ci).join("|"); }

  var UNITS = "mg\\/kg(?:\\/(?:day|dose|h))?|mcg\\/kg(?:\\/min)?|\\u00b5g\\/kg|mg\\/m2|mg\\/dL|mmol\\/L|mEq\\/L|g\\/dL|mL\\/kg(?:\\/h)?|units?\\/kg|IU\\/kg|" +
    "mg|mcg|\\u00b5g|g|mL|L\\/min|mmHg|cmH2O|cm|mm|IU|units?|%|\\u00b0C|bpm|breaths\\/min|beats\\/min|min|minutes?|hours?|h|days?|weeks?|months?|yrs?|years?";
  var NUM = "(?:(?:&lt;|&gt;|\\u2264|\\u2265)=?\\s*)?\\b\\d+(?:[.,]\\d+)?(?:\\s*(?:\\u2013|-|to)\\s*\\d+(?:[.,]\\d+)?)?\\s*(?:" + UNITS + ")(?![A-Za-z0-9])";
  var CMP = "(?:&lt;|&gt;|\\u2264|\\u2265)=?\\s*\\d+(?:[.,]\\d+)?";

  var SIGNAL = alt([
    "pathognomonic(?:\\s+(?:of|for))?", "hallmark(?:\\s+(?:sign|feature|finding))?",
    "classic(?:al)?\\s+(?:triad|tetrad|pentad|sign|signs|feature|features|presentation|finding)",
    "(?:triad|tetrad|pentad)", "most\\s+common\\s+(?:cause|site|type|organism|presentation|finding|sign)(?:\\s+of\\s+[a-z]+(?:\\s+[a-z]+)?)?",
    "gold\\s+standard", "(?:investigation|test|imaging|drug|treatment)\\s+of\\s+choice", "first[\\u2013\\- ]line", "second[\\u2013\\- ]line",
    "red\\s+flags?", "until\\s+proven\\s+otherwise", "life[\\u2013\\- ]threatening", "medical\\s+emergency", "surgical\\s+emergency",
    "diagnostic\\s+of", "rules?\\s+out", "rules?\\s+in"
  ]);
  var ABS = alt(["never", "always", "must(?:\\s+not)?", "do\\s+not", "don(?:[\\u2019']|&#39;)t", "avoid", "contraindicated", "mandatory", "immediately", "urgent(?:ly)?"]);
  // Eponyms: a capitalised name (optionally possessive) before sign / test / reflex ... Case-sensitive on the name.
  var EPONYM = "\\b[A-Z][a-z]{2,}(?:(?:[\\u2019']|&#39;)s)?(?:[\\u2013\\- ][A-Z][a-z]{2,}(?:(?:[\\u2019']|&#39;)s)?)?\\s+(?:sign|test|manoeuvre|maneuver|reflex|triad|phenomenon|criteria|score|scale|position|node|point)\\b";
  var FINDINGS = alt([
    "stony\\s+dull(?:ness)?", "shifting\\s+dullness", "fluid\\s+thrill", "dull(?:ness)?\\s+to\\s+percussion", "hyper[\\u2013\\- ]?resonan(?:t|ce)",
    "bronchial\\s+breath(?:ing|\\s+sounds)", "vesicular\\s+breath(?:ing|\\s+sounds)", "(?:fine|coarse)\\s+(?:crackles|crepitations)", "crackles", "crepitations",
    "wheezes?", "rhonchi", "pleural\\s+rub", "pericardial\\s+rub", "stridor", "egophony", "whispering\\s+pectoriloquy", "vocal\\s+(?:resonance|fremitus)",
    "tracheal\\s+deviation", "apex\\s+beat", "parasternal\\s+heave", "thrills?", "(?:pan)?systolic\\s+murmur", "(?:early\\s+|mid[\\u2013\\- ])?diastolic\\s+murmur",
    "gallop(?:\\s+rhythm)?", "raised\\s+JVP", "pulsus\\s+(?:paradoxus|alternans|parvus)", "collapsing\\s+pulse", "radio[\\u2013\\- ]femoral\\s+delay",
    "clubbing", "central\\s+cyanosis", "peripheral\\s+cyanosis", "cyanosis", "pallor", "icterus", "koilonychia", "pitting\\s+o?edema", "lymphadenopathy",
    "hepatomegaly", "splenomegaly", "hepatosplenomegaly", "ascites", "caput\\s+medusae", "guarding", "rebound\\s+tenderness", "board[\\u2013\\- ]like\\s+rigidity",
    "bruits?", "visible\\s+peristalsis", "succussion\\s+splash", "ballot(?:t)?able", "renal\\s+angle\\s+tenderness",
    "papill?o?edema", "nystagmus", "ptosis", "anisocoria", "RAPD", "relative\\s+afferent\\s+pupillary\\s+defect", "neck\\s+stiffness", "nuchal\\s+rigidity",
    "extensor\\s+plantar", "up[\\u2013\\- ]?going\\s+plantar", "clonus", "fasciculations?", "spasticity", "cogwheel\\s+rigidity", "lead[\\u2013\\- ]pipe\\s+rigidity",
    "hyper[\\u2013\\- ]?reflexia", "hypo[\\u2013\\- ]?reflexia", "areflexia", "intention\\s+tremor", "resting\\s+tremor", "dysdiadochokinesia", "ataxia",
    "upper\\s+motor\\s+neuron(?:e)?", "lower\\s+motor\\s+neuron(?:e)?"
  ]);

  // Diagnoses, organisms and cardinal symptoms: the concepts a lesson is built around (same spirit as the KB's md-key).
  var CONCEPTS = alt([
    "pneumonia", "(?:pneumococcal|lobar|aspiration)\\s+pneumonia", "bronchiectasis", "lung\\s+abscess", "chronic\\s+bronchitis", "bronchitis", "asthma", "COPD",
    "emphysema", "tuberculosis", "pleural\\s+effusion", "empyema", "pneumothorax", "tension\\s+pneumothorax", "pulmonary\\s+(?:o?edema|embolism|fibrosis|hypertension)",
    "lung\\s+cancer", "bronchial\\s+carcinoma", "consolidation", "collapse", "atelectasis", "cor\\s+pulmonale",
    "heart\\s+failure", "myocardial\\s+infarction", "angina", "endocarditis", "pericarditis", "cardiac\\s+tamponade", "aortic\\s+(?:stenosis|regurgitation|dissection)",
    "mitral\\s+(?:stenosis|regurgitation)", "atrial\\s+fibrillation", "hypertension", "hypotension", "shock", "sepsis", "septic\\s+shock", "anaphylaxis",
    "meningitis", "encephalitis", "stroke", "subarachnoid\\s+ha?emorrhage", "raised\\s+intracranial\\s+pressure", "epilepsy", "status\\s+epilepticus",
    "cirrhosis", "portal\\s+hypertension", "hepatitis", "pancreatitis", "appendicitis", "cholecystitis", "peritonitis", "intestinal\\s+obstruction", "perforation",
    "nephrotic\\s+syndrome", "nephritic\\s+syndrome", "acute\\s+kidney\\s+injury", "chronic\\s+kidney\\s+disease", "diabetic\\s+ketoacidosis",
    "an?a?emia", "malignancy", "lymphoma", "leuka?emia", "exacerbation", "anaerobes", "ha?emoptysis", "bronchorrho?ea", "dyspno?ea", "orthopno?ea",
    "paroxysmal\\s+nocturnal\\s+dyspno?ea", "jaundice", "ha?ematemesis", "mela?ena", "syncope", "hypoxi?a(?:emia)?", "cyanosed",
    "Klebsiella", "Pseudomonas", "Staphylococcus\\s+aureus", "Streptococcus\\s+pneumoniae", "Mycobacterium\\s+tuberculosis", "MRSA"
  ]);

  var RE = new RegExp(
    "\\*\\*([^*]+)\\*\\*" +                       // 1: author **markup**
    "|(" + NUM + "|" + CMP + ")" +                 // 2: numbers
    "|(" + EPONYM + ")" +                          // 3: eponyms
    "|\\b(" + SIGNAL + "|" + FINDINGS + "|" + CONCEPTS + ")\\b" +   // 4: signals, findings and concepts
    "|\\b(" + ABS + ")\\b",                        // 5: absolutes and pitfalls
    "g");

  function mark(safe) {
    return String(safe == null ? "" : safe).replace(RE, function (m, md) {
      return '<b class="smd-hy">' + (md != null ? md : m) + "</b>";
    });
  }
  function html(text) { return mark(esc(text)); }

  var API = { html: html, mark: mark, esc: esc, RE: RE };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = API; return; }
  G.SMD_HY = API;
  // Black bold, inheriting the paragraph's own ink (light and dark): never a colour or a pill.
  try {
    var D = G.document;
    if (D && !D.getElementById("smdHyCss")) {
      var s = D.createElement("style"); s.id = "smdHyCss";
      s.textContent = "b.smd-hy{font-weight:700;color:inherit;background:none}";
      (D.head || D.documentElement).appendChild(s);
    }
  } catch (e) {}
})(typeof window !== "undefined" ? window : this);
