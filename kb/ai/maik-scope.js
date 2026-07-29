/* MaiK Scope Gate — window.MaiKScope  (UMD: browser + node-testable)
 *
 * MaiK is a CLINICIAN-ONLY clinical assistant. This is a DETERMINISTIC, instant, client-side
 * gate that runs at the very top of the ask flow — BEFORE the KB engine, the semantic router, and
 * any Vertex call — so an obviously non-clinical request ("write me some code", "write a poem",
 * "integrate Gemini into my project", lay self-help) is refused INSTANTLY and never fuzzy-matches a
 * disease name in the local KB.
 *
 * Design: HIGH PRECISION over recall. A false-refusal of a real clinical question is worse than
 * occasionally letting a borderline query through to the (grounded, disclaimered) engine, so the
 * default is ALLOW. We only block on strong, essentially-never-clinical signals:
 *   • hard non-medical nouns (programming languages, web/IT stack, AI-vendor/API terms) that never
 *     appear in a genuine clinical question;
 *   • a coding/creative VERB + its OBJECT (write code / build a website / compose a poem);
 *   • "integrate/add X into my project/app/website" (the exact case that slipped through);
 *   • narrow first-person LAY self-help ("I have a headache, what should I do?").
 * A clinical anchor anywhere in the query (patient, dose, drug, diagnosis, guideline, an ICD-ish
 * term…) VETOES the block — belt-and-suspenders against false-refusals.
 *
 * Pure + fully unit-tested (test/maik-scope.test.mjs). No I/O, no globals beyond the export.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;   // node / tests
  if (root) root.MaiKScope = api;                                              // browser
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  function norm(q) {
    return String(q == null ? "" : q)
      .toLowerCase()
      .replace(/[‘’]/g, "'")      // smart quotes → '
      .replace(/\s+/g, " ")
      .trim();
  }

  // ── Clinical VETO: if any of these appear, we NEVER block (a real clinical query). ──────────────
  // Broad on purpose — recall here protects against false-refusals; precision here is not important.
  var CLINICAL = new RegExp("\\b(" + [
    "patient", "pt\\b", "dose", "dosing", "dosage", "mg\\b", "mcg", "iu\\b", "ml\\b", "tablet",
    "drug", "medication", "medicine", "antibiotic", "antibiotics", "abx", "prescri",
    "diagnos", "differential", "\\bddx\\b", "\\bdx\\b", "workup", "work-up", "investigat",
    "treat", "therap", "manage", "management", "regimen", "guideline", "protocol",
    "symptom", "sign\\b", "syndrome", "disease", "disorder", "infection", "sepsis",
    "clinical", "medical", "surg", "icu", "ward", "admit", "discharge", "referral",
    "fever", "cough", "dyspn", "chest pain", "abdominal", "renal", "hepatic", "cardiac",
    "pneumonia", "diabet", "hypertens", "sepsis", "shock", "stroke", "mi\\b", "acs\\b",
    "ecg", "\\bx-?ray\\b", "\\bct\\b", "\\bmri\\b", "\\blab\\b", "troponin", "creatinine",
    "culture", "sensitivity", "resistance", "organism", "pathogen", "bacteria", "virus",
    "contraindicat", "interaction", "adverse", "side effect", "titrat", "taper",
    "dvt\\b", "\\bpe\\b", "\\bcap\\b", "\\bckd\\b", "\\bcopd\\b", "\\bhf\\b"
  ].join("|") + ")");

  // ── Hard non-medical NOUNS: their mere presence blocks (never in a genuine clinical question). ──
  var HARD_NON_MEDICAL = new RegExp("\\b(" + [
    "javascript", "typescript", "html", "css", "reactjs", "react\\.js", "angular", "vue\\.js",
    "vuejs", "node\\.?js", "jquery", "python", "golang", "rust lang", "kotlin",
    "regex", "regular expression", "docker", "kubernetes", "github", "gitlab",
    "compiler", "frontend", "front-end", "backend", "back-end", "fullstack", "full-stack",
    "chatgpt", "openai", "\\bgpt-?\\d", "\\bllm\\b", "\\bnpm\\b", "pip install", "yarn add",
    "xcode", "swiftui", "\\bapk\\b", "webpage", "web page", "web ?site", "web ?app",
    "landing page", "css grid", "flexbox", "boilerplate", "leetcode", "stack ?overflow",
    "react component", "react native", "react app", "react hook", "web dev"
  ].join("|") + ")");

  // ── Coding VERB + OBJECT (softer object nouns that need an action verb to be non-medical). ──────
  var CODE_VERB = "write|create|generate|build|make|give me|show me|develop|design|fix|debug|refactor|optimi[sz]e|implement|integrate|add|program|deploy|host";
  var CODE_OBJ = "code|program|programme|script|website|web app|app\\b|application|software|algorithm|api\\b|sdk\\b|endpoint|component|react native|database schema|sql query|function that|class that|for a website|for the website|for my (site|app|website)";
  var CODE_VERB_OBJ = new RegExp("\\b(" + CODE_VERB + ")\\b[\\s\\S]{0,32}\\b(" + CODE_OBJ + ")");

  // "integrate / add / connect / use X into|to|in my project|app|website|codebase"
  var INTEGRATE = /\b(integrate|add|connect|hook up|wire up|use|call|embed)\b[\s\S]{0,48}\b(into|in|to|with)\b[\s\S]{0,24}\b(my|the|our|this|your)\b[\s\S]{0,16}\b(project|app|application|web ?site|web ?app|code ?base|repo|repository|backend|frontend|program|software|website)\b/;

  // ── Creative-writing / general-assistant requests. ─────────────────────────────────────────────
  var CREATIVE = new RegExp("\\b(write|compose|create|generate|make me)\\b[\\s\\S]{0,24}\\b(" + [
    "poem", "poems", "essay", "essays", "story", "stories", "joke", "jokes", "song", "songs",
    "rap\\b", "lyrics", "screenplay", "novel", "tweet", "blog post", "blog", "haiku", "limerick",
    "cover letter", "resume", "\\bcv\\b", "speech", "birthday", "wedding"
  ].join("|") + ")");

  var GENERAL = new RegExp("\\b(" + [
    "weather", "forecast today", "who won", "score of", "cricket match", "football match",
    "stock price", "share price", "recipe for", "how to cook", "capital of", "population of",
    "\\btranslate\\b", "movie", "netflix", "song lyrics", "tell me a joke", "flirt", "roast me",
    "meaning of life", "your (name|creator|model|version)", "who made you", "who created you",
    "are you (chatgpt|gpt|gemini|claude|an ai|a robot)", "ignore (all )?previous", "system prompt"
  ].join("|") + ")");

  // ── Narrow first-person LAY self-help ("I have a headache, what should I do?"). ─────────────────
  // Requires first-person symptom framing + advice-seeking, and MUST NOT mention a patient/clinical
  // term (a clinician writes "approach to headache", not "I have a headache what do I do").
  var LAY_FIRST_PERSON = /^(i|i've|ive|i have|i had|i am|i'm|im|my)\b/;
  var LAY_ADVICE = /\b(what should i (do|take|use)|what (do|can) i (do|take)|is (it|this) serious|should i (worry|be worried|see|go|take)|how do i (get rid of|cure|treat) my|home remed|help me feel|what medicine should i)\b/;
  // A clinician frames a case professionally; this VETOES the lay-self-help block.
  var PROFESSIONAL = /\b(patient|\bpt\b|case|workup|work-up|differential|\bddx\b|\bdx\b|manage(ment)?|guideline|protocol|regimen|dose|dosing|prescrib|admit|discharge|indicated|contraindicat)\b/;

  function reason(q) {
    var s = norm(q);
    if (!s || s.length < 3) return null;                 // too short → let the normal flow decide

    // Lay self-help runs FIRST — a symptom word ("fever") must not veto "I have a fever, is it serious?".
    if (LAY_FIRST_PERSON.test(s) && LAY_ADVICE.test(s) && !PROFESSIONAL.test(s)) return "lay";

    if (CLINICAL.test(s)) return null;                   // clinical anchor present → NEVER block

    if (HARD_NON_MEDICAL.test(s)) return "code";
    if (CODE_VERB_OBJ.test(s)) return "code";
    if (INTEGRATE.test(s)) return "code";
    if (CREATIVE.test(s)) return "creative";
    if (GENERAL.test(s)) return "general";
    return null;
  }

  function isNonMedical(q) { return reason(q) !== null; }

  return { isNonMedical: isNonMedical, reason: reason, norm: norm };
});
