/* clinix-lexicon.js — CliniX · what the student actually typed
 * ============================================================================================
 * WHY THIS EXISTS. A simulated patient answers only what the case author scripted, and the author
 * scripts a TOPIC ("orthopnea") with a handful of cue phrases. Students do not type cue phrases.
 * They type "do u get breathless on lying down", "how many pillows u sleep with", "sob on lying
 * flat?", "since how many days breathing problem", "kya raat me saans phoolti hai". The old matcher
 * was a whole-word substring test against those cues, so every phrasing the author did not think of
 * fell through to "I am not sure what you mean, doctor" - which reads to the student as a broken
 * app, not as a missed question. Reported 2026-09-19: "each student talks english differently how
 * will he ask exact question as we programmed".
 *
 * WHAT THIS IS NOT. It is not a model and it never invents a reply. It decides WHICH AUTHORED TOPIC
 * a question is asking about, and how confident it is. If nothing is confident enough the caller
 * still shows the author's fallback; the new part is that it can also offer the near misses, so the
 * student is redirected instead of stonewalled. A patient that improvises would be teaching a
 * clinical fact nobody wrote, which is the one thing the case engine must never do.
 *
 * HOW IT MATCHES, in order of weight:
 *   1. normalise     lowercase, strip punctuation, expand contractions and chat-speak (u, ur, r, y)
 *   2. phrase map    multi-word lay language to one canonical medical token, longest phrase first
 *                    ("short of breath" / "cannot breathe" / "saans phoolna" -> dyspnea)
 *   3. token synonym single-word equivalences ("swelling" -> edema, "beedi" -> smoking)
 *   4. stopwords     drop the question scaffolding ("do you have any", "sir", "please tell me")
 *   5. containment   a cue matches when its canonical tokens are present in the question's, with
 *                    fuzzy equality for typos (edit distance scaled to word length)
 *   6. specificity   a longer, more specific cue outranks a vague one that also fits
 *   7. guards        ownership ("does your FATHER smoke" is family history, not smoking) and
 *                    temporal intent ("since when" is duration, not the symptom itself)
 *
 * Deterministic, offline, no DOM, no fetch. Node-testable (test/clinix-lexicon.test.mjs).
 * ============================================================================================ */
(function () {
  "use strict";

  /* ── 0. text plumbing ───────────────────────────────────────────────────────────────────── */

  // Chat-speak and contractions students actually type. Applied before anything else so "u r"
  // becomes "you are" and the phrase map below can see a normal sentence.
  var CONTRACTIONS = {
    "u": "you", "ur": "your", "urs": "yours", "r": "are", "y": "why", "n": "and", "k": "ok",
    "abt": "about", "b4": "before", "pls": "please", "plz": "please", "thru": "through",
    "wat": "what", "wht": "what", "wen": "when", "wer": "where", "hw": "how", "d": "the",
    "dont": "do not", "doesnt": "does not", "didnt": "did not", "cant": "can not",
    "couldnt": "could not", "wont": "will not", "wouldnt": "would not", "isnt": "is not",
    "arent": "are not", "wasnt": "was not", "havent": "have not", "hasnt": "has not",
    "im": "i am", "ive": "i have", "youre": "you are", "youve": "you have", "whats": "what is",
    "hows": "how is", "wheres": "where is", "theres": "there is", "lets": "let us"
  };

  /* Multi-word lay language to ONE canonical token. Longest phrase wins, so "short of breath on
   * exertion" contributes both dyspnea and exertion rather than colliding.
   *
   * Sources for the phrasings: how patients and students in Indian teaching hospitals actually
   * speak, including Indian-English constructions ("loose motions", "vomitings", "giddiness",
   * "burning micturition", "since how many days") which a textbook synonym list does not contain
   * and which are the single commonest reason a typed question missed its topic. */
  var PHRASES = [
    // ── breathlessness family ──
    ["short of breath", "dyspnea"], ["shortness of breath", "dyspnea"], ["shortness of breathing", "dyspnea"],
    ["out of breath", "dyspnea"], ["cannot breathe", "dyspnea"], ["can not breathe", "dyspnea"],
    ["unable to breathe", "dyspnea"], ["difficulty breathing", "dyspnea"], ["difficulty in breathing", "dyspnea"],
    ["trouble breathing", "dyspnea"], ["hard to breathe", "dyspnea"], ["breathing problem", "dyspnea"],
    ["breathing difficulty", "dyspnea"], ["breathing trouble", "dyspnea"], ["breathless", "dyspnea"],
    ["breathlessness", "dyspnea"], ["winded", "dyspnea"], ["huffing", "dyspnea"], ["puffing", "dyspnea"],
    ["gasping for air", "dyspnea"], ["catch your breath", "dyspnea"], ["saans phoolna", "dyspnea"],
    ["saans phool", "dyspnea"], ["dum ghutna", "dyspnea"], ["air hunger", "dyspnea"],
    // ── orthopnea / PND ──
    ["lie flat", "orthopnea"], ["lying flat", "orthopnea"], ["lay flat", "orthopnea"],
    ["lie down flat", "orthopnea"], ["sleep flat", "orthopnea"], ["sleeping flat", "orthopnea"],
    ["how many pillows", "orthopnea"], ["number of pillows", "orthopnea"], ["extra pillow", "orthopnea"],
    ["propped up", "orthopnea"], ["sit up to breathe", "orthopnea"], ["sitting up to breathe", "orthopnea"],
    ["wake up at night", "pnd orthopnea night"], ["wake up gasping", "pnd orthopnea"], ["woke up gasping", "pnd orthopnea"],
    ["wake up breathless", "pnd orthopnea dyspnea"], ["night time breathlessness", "pnd orthopnea dyspnea night"], ["breathless at night", "pnd orthopnea dyspnea night"],
    ["paroxysmal nocturnal dyspnoea", "pnd orthopnea dyspnea"], ["paroxysmal nocturnal dyspnea", "pnd orthopnea dyspnea"],
    ["how do you sleep", "orthopnea"], ["how is your sleep", "orthopnea"],
    // ── exertion / functional class ──
    ["on exertion", "exertion"], ["with exertion", "exertion"], ["on walking", "exertion"],
    ["while walking", "exertion"], ["when you walk", "exertion"], ["how far can you walk", "exertion"],
    ["how much can you walk", "exertion"], ["how much can you do", "exertion"],
    ["climbing stairs", "exertion"], ["climb stairs", "exertion"], ["going upstairs", "exertion"],
    ["flight of stairs", "exertion"], ["day to day activities", "exertion"],
    ["daily activities", "exertion"], ["routine work", "exertion"], ["at rest", "rest"],
    ["even at rest", "rest"], ["effort tolerance", "exertion"], ["exercise tolerance", "exertion"],
    // ── chest pain ──
    ["chest pain", "chest pain"], ["pain in chest", "chest pain"], ["pain in the chest", "chest pain"],
    ["chest discomfort", "chest pain"], ["chest tightness", "chest pain tightness"], ["tightness in chest", "chest pain tightness"],
    ["heaviness in chest", "chest pain heaviness"], ["chest heaviness", "chest pain heaviness"], ["chest burning", "chest pain burning"],
    ["seene me dard", "chest pain"], ["crushing pain", "chest pain crushing"], ["pressure in chest", "chest pain"],
    // ── swelling ──
    ["swelling of legs", "edema"], ["swelling in legs", "edema"], ["swelling of feet", "edema"],
    ["swollen legs", "edema"], ["swollen feet", "edema"], ["swollen ankles", "edema"],
    ["leg swelling", "edema"], ["ankle swelling", "edema"], ["pedal edema", "edema"],
    ["pedal oedema", "edema"], ["puffiness of face", "face edema puffiness"], ["face swelling", "face edema puffiness"],
    ["abdominal distension", "abdomen ascites distension"], ["abdominal distention", "abdomen ascites distension"], ["belly swelling", "abdomen ascites edema"],
    ["tummy swelling", "abdomen ascites edema"], ["stomach swelling", "abdomen ascites edema"], ["pet me pani", "abdomen ascites"],
    // ── cough / sputum / haemoptysis ──
    ["bringing up phlegm", "sputum"], ["coughing up phlegm", "sputum"], ["coughing up sputum", "sputum"],
    ["bring up anything", "sputum"], ["any phlegm", "sputum"], ["productive cough", "sputum"],
    ["dry cough", "cough dry"], ["coughing blood", "hemoptysis cough blood"], ["cough up blood", "hemoptysis cough blood"],
    ["coughing up blood", "hemoptysis cough blood"], ["cough with blood", "hemoptysis cough blood"],
    ["cough out blood", "hemoptysis cough blood"], ["blood with cough", "hemoptysis cough blood"],
    ["blood while coughing", "hemoptysis cough blood"], ["blood in cough", "hemoptysis cough blood"],
    ["spitting blood", "hemoptysis sputum blood"], ["sputum with blood", "hemoptysis sputum blood"],
    ["blood stained sputum", "hemoptysis sputum blood"], ["streaks of blood", "hemoptysis blood"],
    ["blood in sputum", "hemoptysis sputum blood"], ["blood in phlegm", "hemoptysis sputum blood"], ["haemoptysis", "hemoptysis"],
    ["khoon ki ulti", "hematemesis vomiting blood"], ["vomiting blood", "hematemesis vomiting blood"], ["blood in vomit", "hematemesis vomiting blood"],
    // ── constitutional ──
    ["weight loss", "weight loss"], ["losing weight", "weight loss"], ["lost weight", "weight loss"],
    ["weight gain", "weight gain"], ["put on weight", "weight gain"], ["gaining weight", "weight gain"],
    ["loss of appetite", "appetite"], ["appetite loss", "appetite"], ["not eating well", "appetite"],
    ["how is your appetite", "appetite"], ["night sweats", "night sweats"], ["sweating at night", "night sweats"],
    ["evening rise", "fever"], ["evening rise of temperature", "fever"], ["low grade fever", "fever"],
    ["feeling tired", "fatigue"], ["get tired", "fatigue"], ["tiredness", "fatigue"], ["generalised weakness", "fatigue weakness"],
    ["lack of energy", "fatigue"], ["kamzori", "fatigue"], ["thakan", "fatigue"],
    // ── GI ──
    ["loose motions", "diarrhea"], ["loose stools", "diarrhea"], ["motions", "diarrhea"],
    ["watery stools", "diarrhea"], ["passing stool", "bowel"], ["bowel habit", "bowel"],
    ["bowel movements", "bowel"], ["black stools", "melena"], ["tarry stools", "melena"],
    ["blood in stool", "bowel blood bleeding"], ["blood in stools", "bowel blood bleeding"],
    ["feeling sick", "nausea"], ["throwing up", "vomiting"], ["vomitings", "vomiting"],
    ["yellow eyes", "jaundice"], ["yellowing of eyes", "jaundice"], ["yellow discoloration", "jaundice"],
    ["yellowness of eyes", "jaundice"], ["peeli aankhein", "jaundice"], ["itching all over", "pruritus"],
    // ── urinary ──
    ["burning micturition", "dysuria urine burning"], ["burning urination", "dysuria urine burning"], ["burning while passing urine", "dysuria urine burning"],
    ["pain while passing urine", "dysuria urine pain"], ["passing water", "urine"], ["passing urine", "urine"],
    ["urine output", "urine"], ["how much urine", "urine"], ["frothy urine", "urine frothy"],
    ["high coloured urine", "urine"], ["dark urine", "urine"], ["getting up at night to pass urine", "nocturia urine night"],
    // ── neuro ──
    ["loss of consciousness", "syncope"], ["black out", "syncope"], ["blacked out", "syncope"],
    ["passed out", "syncope"], ["fainting", "syncope"], ["fainted", "syncope"], ["giddiness", "dizziness"],
    ["light headed", "dizziness"], ["head spinning", "dizziness"], ["room spinning", "vertigo"],
    ["fits", "seizure"], ["convulsions", "seizure"], ["jerky movements", "seizure"],
    ["pins and needles", "paresthesia numbness tingling"], ["numbness", "paresthesia numbness"], ["tingling", "paresthesia tingling"],
    ["weakness of limbs", "weakness limb"], ["cannot move", "weakness limb"], ["difficulty walking", "gait"],
    ["unsteady walking", "gait"], ["difficulty in walking", "gait"], ["slurred speech", "speech"],
    ["difficulty speaking", "speech"], ["memory problems", "memory"], ["forgetful", "memory"],
    ["double vision", "diplopia vision"], ["blurring of vision", "vision blurring"], ["blurred vision", "vision blurring"],
    // ── duration / onset / course (INTENT, not a symptom) ──
    ["since when", "duration"], ["since how many days", "duration"], ["since how long", "duration"],
    ["how many days", "duration"], ["how many months", "duration"], ["how many weeks", "duration"],
    ["how many years", "duration"], ["how long", "duration"], ["for how long", "duration"],
    ["when did it start", "onset"], ["when did this start", "onset"], ["when did it begin", "onset"],
    ["how did it start", "onset"], ["sudden or gradual", "onset"], ["suddenly or slowly", "onset"],
    ["getting worse", "progression"], ["worse over time", "progression"], ["is it increasing", "progression"],
    ["getting better", "progression"], ["same or worse", "progression"],
    ["what makes it worse", "aggravating"], ["what worsens it", "aggravating"],
    ["anything makes it worse", "aggravating"], ["what brings it on", "aggravating"],
    ["what makes it better", "relieving"], ["what relieves it", "relieving"],
    ["anything makes it better", "relieving"], ["does anything help", "relieving"],
    // ── the opening question ──
    ["what brings you", "presenting"], ["what brought you", "presenting"],
    ["what is the problem", "presenting"], ["what is your problem", "presenting"],
    ["why have you come", "presenting"], ["why did you come", "presenting"],
    ["what is troubling you", "presenting"], ["what is bothering you", "presenting"],
    ["how can i help", "presenting"], ["what happened", "presenting"],
    ["tell me about your problem", "presenting"], ["tell me about your complaints", "presenting"],
    ["tell me your problem", "presenting"], ["tell me what happened", "presenting"],
    ["main complaint", "presenting"], ["chief complaint", "presenting"],
    ["presenting complaint", "presenting"], ["kya takleef hai", "presenting"], ["kya hua", "presenting"],
    // ── past / family / drugs / social ──
    ["past history", "past history"], ["medical history", "past history"], ["known case of", "past history known"],
    ["any other illness", "past history illness"], ["any other disease", "past history illness"],
    ["previous illness", "past history illness"], ["previously diagnosed", "past history diagnosed"],
    ["any surgery", "surgery"], ["operated before", "surgery"], ["past surgery", "surgery"],
    ["family history", "family history"], ["anyone in your family", "family history"],
    ["runs in the family", "family history"], ["anyone at home", "family contact"],
    ["what medicines", "medications"], ["which medicines", "medications"], ["what tablets", "medications"],
    ["any medication", "medications"], ["taking any medicine", "medications"], ["on any drugs", "medications"],
    ["regular medicines", "medications"], ["missed your medicines", "adherence"],
    ["stopped your medicines", "adherence"], ["taking them regularly", "adherence"],
    ["taking it regularly", "adherence"], ["do you take them daily", "adherence"],
    ["pain killers", "nsaid"], ["pain killer", "nsaid"], ["painkiller", "nsaid"],
    ["any allergy", "allergy"], ["allergic to", "allergy"],
    ["do you smoke", "smoking"], ["smoking history", "smoking"], ["how many cigarettes", "smoking"],
    ["pack years", "smoking"], ["chew tobacco", "tobacco"], ["gutka", "tobacco"], ["khaini", "tobacco"],
    ["do you drink", "alcohol"], ["alcohol intake", "alcohol"], ["how much do you drink", "alcohol"],
    ["drinking habit", "alcohol"], ["sharab", "alcohol"],
    ["what do you do", "occupation"], ["your work", "occupation"], ["your job", "occupation"],
    ["what work do you do", "occupation"], ["what is your work", "occupation"],
    ["line of work", "occupation"], ["where do you work", "occupation"],
    ["what work", "occupation"], ["kind of work", "occupation"],
    ["occupational exposure", "occupation"], ["cooking fuel", "biomass"], ["chulha", "biomass"], ["what fuel", "biomass"],
    ["cook with", "biomass"], ["cooking with", "biomass"], ["cook food", "biomass"],
    ["wood stove", "biomass"], ["gas stove", "biomass"], ["cow dung", "biomass"],
    ["firewood", "biomass"], ["biomass exposure", "biomass"],
    ["contact with tb", "tuberculosis contact"], ["tb contact", "tuberculosis contact"], ["anyone with tb", "tuberculosis contact family"],
    ["recent travel", "travel"], ["travelled recently", "travel"],
    ["salt intake", "salt"], ["salty food", "salt"], ["pickle", "salt"], ["papad", "salt"],
    ["how much water", "fluid water intake"], ["fluid intake", "fluid water intake"],
    ["sexual history", "sexual history"], ["menstrual history", "menstrual"], ["periods", "menstrual"],
    ["last menstrual period", "menstrual"]
  ];

  // Single-word equivalences applied after the phrase map.
  var SYNONYMS = {
    // breathlessness
    sob: "dyspnea", dyspnoea: "dyspnea", dyspneic: "dyspnea", winded: "dyspnea",
    orthopnoea: "orthopnea", stairs: "exertion", staircase: "exertion", walk: "exertion",
    walking: "exertion", climb: "exertion", climbing: "exertion", exercise: "exertion",
    activity: "exertion", activities: "exertion", effort: "exertion", exert: "exertion",
    pillow: "orthopnea", pillows: "orthopnea",
    // swelling
    swelling: "edema", swollen: "edema", swell: "edema", oedema: "edema", puffy: "edema",
    ankle: "edema", ankles: "edema", feet: "edema", foot: "edema", legs: "edema", leg: "edema",
    // pain / chest
    pain: "pain", ache: "pain", aching: "pain", dard: "pain", discomfort: "pain",
    chest: "chest", seene: "chest",
    // cough
    cough: "cough", coughing: "cough", khansi: "cough", phlegm: "sputum", sputum: "sputum",
    expectoration: "sputum", mucus: "sputum",
    // constitutional
    fever: "fever", temperature: "fever", bukhar: "fever", chills: "rigors", rigors: "rigors",
    shivering: "rigors", sweating: "sweats", sweats: "sweats", appetite: "appetite",
    weight: "weight", kilos: "weight", kg: "weight", tired: "fatigue", fatigue: "fatigue",
    fatigued: "fatigue", lethargy: "fatigue", lethargic: "fatigue", malaise: "fatigue",
    // GI
    vomit: "vomiting", vomiting: "vomiting", vomited: "vomiting", nausea: "nausea",
    nauseated: "nausea", stool: "bowel", stools: "bowel", bowels: "bowel", constipation: "constipation",
    constipated: "constipation", diarrhea: "diarrhea", diarrhoea: "diarrhea", melena: "melena",
    melaena: "melena", jaundice: "jaundice", icterus: "jaundice", itching: "pruritus",
    pruritus: "pruritus", abdomen: "abdomen", belly: "abdomen", tummy: "abdomen", stomach: "abdomen",
    // urinary
    urine: "urine", urination: "urine", micturition: "urine", peeing: "urine", pee: "urine",
    nocturia: "nocturia", oliguria: "urine", haematuria: "hematuria", hematuria: "hematuria",
    // neuro
    dizzy: "dizziness", dizziness: "dizziness", giddy: "dizziness", vertigo: "vertigo",
    faint: "syncope", syncope: "syncope", collapse: "syncope", seizure: "seizure", seizures: "seizure",
    fit: "seizure", headache: "headache", numb: "paresthesia", tingle: "paresthesia",
    // habits
    smoke: "smoking", smoking: "smoking", smoker: "smoking", cigarette: "smoking",
    cigarettes: "smoking", beedi: "smoking", bidi: "smoking", tobacco: "tobacco", smokes: "smoking",
    alcohol: "alcohol", drink: "alcohol", drinking: "alcohol", drinks: "alcohol", liquor: "alcohol",
    // drugs
    medicine: "medications", medicines: "medications", medication: "medications",
    medications: "medications", tablet: "medications", tablets: "medications", drug: "medications",
    drugs: "medications", pills: "medications", nsaid: "nsaid", nsaids: "nsaid",
    ibuprofen: "nsaid", diclofenac: "nsaid", brufen: "nsaid", combiflam: "nsaid",
    compliance: "adherence", adherent: "adherence", adherence: "adherence", regularly: "adherence",
    // comorbidity words that are also topics
    diabetes: "diabetes", diabetic: "diabetes", sugar: "diabetes", dm: "diabetes",
    hypertension: "hypertension", bp: "hypertension", hypertensive: "hypertension",
    tb: "tuberculosis", tuberculosis: "tuberculosis", koch: "tuberculosis",
    asthma: "asthma", copd: "copd", stroke: "stroke", cva: "stroke", mi: "infarct",
    infarct: "infarct", attack: "infarct", palpitation: "palpitations", palpitations: "palpitations",
    // family words (used by the ownership guard too)
    family: "family", father: "family", mother: "family", brother: "family",
    sister: "family", parents: "family", relatives: "family", siblings: "family",
    // duration words
    duration: "duration", long: "duration", days: "duration", weeks: "duration",
    months: "duration", years: "duration", since: "duration", onset: "onset", started: "onset",
    start: "onset", began: "onset", begin: "onset", progression: "progression",
    worse: "progression", worsening: "progression", increasing: "progression",
    aggravating: "aggravating", aggravate: "aggravating", relieving: "relieving", relieve: "relieving",
    relief: "relieving", better: "relieving",
    // misc
    travel: "travel", travelled: "travel", traveled: "travel", occupation: "occupation",
    job: "occupation", allergy: "allergy", allergic: "allergy",
    surgery: "surgery", operation: "surgery", operated: "surgery", sleep: "sleep",
    night: "night", nocturnal: "night", morning: "morning", evening: "evening",
    // Identity entries. These exist so the fuzzy snap below has a target to pull a misspelling
    // onto: "exersion" is two edits from "exertion", but only if "exertion" is in the vocabulary.
    exertion: "exertion", dyspnea: "dyspnea", orthopnea: "orthopnea", edema: "edema",
    ascites: "ascites", sputum: "sputum", hemoptysis: "hemoptysis", jaundice: "jaundice",
    syncope: "syncope", seizure: "seizure", paresthesia: "paresthesia", wheeze: "wheeze",
    wheezing: "wheeze", inhaler: "inhaler", inhalers: "inhaler", nebuliser: "nebuliser",
    nebulizer: "nebuliser", exacerbation: "exacerbation", exacerbations: "exacerbation",
    admission: "admission", admissions: "admission", hospitalisation: "admission",
    hospitalization: "admission", admitted: "admission", vaccination: "vaccination",
    vaccinated: "vaccination", immunisation: "vaccination", immunization: "vaccination",
    biomass: "biomass", fuel: "biomass", firewood: "biomass", stove: "biomass",
    kerosene: "biomass", cooking: "biomass", tuberculosis: "tuberculosis", contact: "contact", history: "history",
    past: "past", family: "family", pnd: "pnd", dysuria: "dysuria", nocturia: "nocturia",
    melena: "melena", hematemesis: "hematemesis", hematuria: "hematuria", vertigo: "vertigo",
    dizziness: "dizziness", headache: "headache", fatigue: "fatigue", fever: "fever",
    cough: "cough", chest: "chest", pain: "pain", weight: "weight", urine: "urine",
    bowel: "bowel", appetite: "appetite", smoking: "smoking", alcohol: "alcohol",
    tobacco: "tobacco", medications: "medications", adherence: "adherence", allergies: "allergy",
    weakness: "weakness", numbness: "paresthesia", vision: "vision", speech: "speech",
    memory: "memory", gait: "gait", limb: "limb", limbs: "limb", joint: "joint",
    joints: "joint", rash: "rash", bleeding: "bleeding", blood: "blood", sweats: "sweats",
    rigors: "rigors", palpitations: "palpitations", diabetes: "diabetes",
    hypertension: "hypertension", asthma: "asthma", copd: "copd", stroke: "stroke"
  };

  /* One lookup table for single words: the synonym map plus every SINGLE-word phrase entry.
   * Built once. It is also the vocabulary the fuzzy snap pulls misspellings onto. */
  var _wordMap = null, _vocab = null;
  function wordMap() {
    if (_wordMap) return _wordMap;
    _wordMap = {};
    for (var k in SYNONYMS) if (Object.prototype.hasOwnProperty.call(SYNONYMS, k)) _wordMap[k] = SYNONYMS[k];
    for (var i = 0; i < PHRASES.length; i++) {
      if (PHRASES[i][0].indexOf(" ") < 0 && !Object.prototype.hasOwnProperty.call(_wordMap, PHRASES[i][0])) {
        _wordMap[PHRASES[i][0]] = PHRASES[i][1];
      }
    }
    _vocab = [];
    for (var w in _wordMap) if (Object.prototype.hasOwnProperty.call(_wordMap, w) && w.length >= 5) _vocab.push(w);
    return _wordMap;
  }
  function vocab() { if (!_vocab) wordMap(); return _vocab; }

  // Question scaffolding. Dropped so "do you have any swelling sir" and "swelling?" are the same
  // question. Deliberately does NOT include clinically loaded words (no, not, never, blood, pain).
  var STOP = {
    a: 1, an: 1, the: 1, is: 1, are: 1, was: 1, were: 1, am: 1, be: 1, been: 1, being: 1,
    do: 1, does: 1, did: 1, doing: 1, have: 1, has: 1, had: 1, having: 1, can: 1, could: 1,
    will: 1, would: 1, shall: 1, should: 1, may: 1, might: 1, must: 1, you: 1, your: 1,
    yours: 1, i: 1, me: 1, my: 1, we: 1, us: 1, our: 1, he: 1, she: 1, it: 1, its: 1,
    they: 1, them: 1, their: 1, this: 1, that: 1, these: 1, those: 1, there: 1, here: 1,
    and: 1, or: 1, but: 1, if: 1, then: 1, so: 1, as: 1, of: 1, in: 1, on: 1, at: 1, to: 1,
    for: 1, with: 1, from: 1, by: 1, about: 1, into: 1, over: 1, under: 1, up: 1, out: 1,
    any: 1, some: 1, all: 1, more: 1, most: 1, much: 1, many: 1, very: 1, too: 1, also: 1,
    please: 1, sir: 1, madam: 1, maam: 1, doctor: 1, ok: 1, okay: 1, yes: 1, hello: 1, hi: 1,
    tell: 1, say: 1, said: 1, ask: 1, asking: 1, know: 1, like: 1, get: 1, got: 1, getting: 1,
    feel: 1, feeling: 1, felt: 1, come: 1, came: 1, go: 1, going: 1, went: 1, take: 1,
    taking: 1, took: 1, give: 1, given: 1, make: 1, made: 1, want: 1, need: 1, let: 1,
    what: 1, when: 1, where: 1, which: 1, who: 1, whom: 1, whose: 1, how: 1, why: 1,
    kind: 1, type: 1, sort: 1, thing: 1, things: 1, just: 1, now: 1, ever: 1, still: 1,
    use: 1, uses: 1, using: 1, used: 1, put: 1, keep: 1, kept: 1, seem: 1, look: 1,
    me2: 1, ji: 1, na: 1, hai: 1, kya: 1, aap: 1, ko: 1, se: 1
  };

  // Ownership words: their presence means the question is about somebody OTHER than the patient,
  // so a habit topic ("do you smoke") must not win over a family topic ("does your father smoke").
  var OTHERS = ["father", "mother", "brother", "sister", "parents", "family", "son", "daughter",
    "wife", "husband", "relative", "relatives", "anyone", "anybody", "home", "household"];

  // Intent tokens: these describe the SHAPE of the question rather than a symptom. A topic whose
  // cues carry the same intent gets a boost; this is what makes "since when" land on a duration
  // topic rather than on whichever symptom topic happens to share a word.
  var INTENTS = { duration: 1, onset: 1, progression: 1, aggravating: 1, relieving: 1, presenting: 1 };

  function str(s) { return s == null ? "" : String(s); }

  function basic(s) {
    return str(s).toLowerCase()
      .replace(/[‘’“”]/g, " ")
      .replace(/[^a-z0-9\s]+/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function expandContractions(s) {
    var w = basic(s).split(" "), out = [], i;
    for (i = 0; i < w.length; i++) {
      var t = w[i];
      if (!t) continue;
      out.push(Object.prototype.hasOwnProperty.call(CONTRACTIONS, t) ? CONTRACTIONS[t] : t);
    }
    return out.join(" ");
  }

  // Phrase map, longest first so a longer phrase is never eaten by a shorter one inside it.
  var _phrasesSorted = null;
  function phrasesSorted() {
    if (_phrasesSorted) return _phrasesSorted;
    _phrasesSorted = PHRASES.slice().sort(function (a, b) { return b[0].length - a[0].length; });
    return _phrasesSorted;
  }

  /* Replace each phrase wherever it occurs. Scanning FORWARD past each replacement is load-bearing:
   * several phrases map to a string that CONTAINS the phrase itself ("chest pain" -> "chest pain",
   * kept so an authored cue of just "chest" still matches), and a restart-from-zero replace loop on
   * those never terminates. The identity skip and the forward index are both the fix. */
  function applyPhrases(s) {
    var out = " " + s + " ";
    var list = phrasesSorted();
    for (var i = 0; i < list.length; i++) {
      var from = " " + list[i][0] + " ";
      var to = " " + list[i][1] + " ";
      if (from === to) continue;
      var at = out.indexOf(from), guard = 0;
      while (at >= 0 && guard++ < 40) {
        out = out.slice(0, at) + to + out.slice(at + from.length);
        at = out.indexOf(from, at + to.length - 1);
      }
    }
    return out.replace(/\s+/g, " ").trim();
  }

  // Crude but adequate plural/verb stemming for the words the synonym table does not list.
  function stem(t) {
    if (t.length > 4 && /ies$/.test(t)) return t.slice(0, -3) + "y";
    if (t.length > 4 && /(ses|xes|zes|ches|shes)$/.test(t)) return t.slice(0, -2);
    if (t.length > 3 && /s$/.test(t) && !/ss$/.test(t)) return t.slice(0, -1);
    if (t.length > 5 && /ing$/.test(t)) return t.slice(0, -3);
    if (t.length > 4 && /ed$/.test(t)) return t.slice(0, -2);
    return t;
  }

  // Nearest vocabulary word within the length-scaled tolerance, or "" when nothing is close.
  // Only tried for words of 5+ characters: below that an edit is as likely to be a different word.
  function snap(t) {
    if (t.length < 5) return "";
    var v = vocab(), tol = t.length >= 8 ? 2 : 1, i, c0 = t.charAt(0), c1 = t.charAt(1);
    for (i = 0; i < v.length; i++) {
      /* The first TWO letters must match. Typos rarely touch a word's opening, and requiring it
       * kills the two false positives this otherwise produces: "scoughs" acquiring a leading
       * character to become "cough", and "spell" (as in "can you spell your name") landing one edit
       * from "swell" and turning small talk into a question about oedema. */
      if (v[i].charAt(0) !== c0 || v[i].charAt(1) !== c1) continue;
      if (Math.abs(v[i].length - t.length) > tol) continue;
      if (within(t, v[i], tol)) return v[i];
    }
    return "";
  }

  /* Canonical token list for any text: the shape everything downstream compares.
   * Returns { tokens: [..], set: {tok:1}, raw: "normalised string" }. */
  function canon(text) {
    var s = applyPhrases(expandContractions(text));
    var w = s.split(" "), tokens = [], set = {}, i;
    var WM = wordMap();
    for (i = 0; i < w.length; i++) {
      var t = w[i];
      if (!t) continue;
      // Check the raw word against the stop list BEFORE stemming: "this" stems to "thi", which is
      // not in the list, so it used to survive as a token.
      if (Object.prototype.hasOwnProperty.call(STOP, t)) continue;
      if (Object.prototype.hasOwnProperty.call(WM, t)) t = WM[t];
      else {
        var st = stem(t);
        if (Object.prototype.hasOwnProperty.call(WM, st)) t = WM[st];
        else {
          // A word the vocabulary does not know, and long enough that a typo is likely: snap it to
          // the nearest known word. This is what turns "breathlessnes" into dyspnea and "exersion"
          // into exertion, which the phrase map alone (an exact string replace) can never do.
          var snapped = snap(st);
          t = snapped ? WM[snapped] : st;
        }
      }
      // A replacement may itself be several tokens ("chest pain", "weight gain").
      var parts = t.indexOf(" ") >= 0 ? t.split(" ") : [t];
      for (var pi = 0; pi < parts.length; pi++) {
        var pt = parts[pi];
        if (!pt || Object.prototype.hasOwnProperty.call(STOP, pt) || pt.length < 2) continue;
        if (!Object.prototype.hasOwnProperty.call(set, pt)) { set[pt] = 1; tokens.push(pt); }
      }
    }
    return { tokens: tokens, set: set, raw: s };
  }

  /* ── 1. fuzzy equality (typos) ──────────────────────────────────────────────────────────── */

  // Bounded Levenshtein: returns true when a and b are within the tolerance for their length.
  // Tolerance scales with length so "sob" needs an exact match while "breathlessnes" still reads
  // as "breathlessness". Bounded early-exit keeps it cheap enough to run per token pair.
  function within(a, b, max) {
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return false;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      var best = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return false;
      for (j = 0; j <= lb; j++) prev[j] = cur[j];
    }
    return prev[lb] <= max;
  }

  function tolerance(t) { return t.length >= 8 ? 2 : (t.length >= 5 ? 1 : 0); }

  // Is this canonical token present in the question's token set, allowing typos?
  function has(qSet, qTokens, token) {
    if (Object.prototype.hasOwnProperty.call(qSet, token)) return 1;
    var tol = tolerance(token);
    if (!tol) return 0;
    for (var i = 0; i < qTokens.length; i++) {
      if (within(token, qTokens[i], tol)) return 0.85;   // a typo is worth slightly less than an exact hit
    }
    return 0;
  }

  /* ── 2. matching a question against authored topics ─────────────────────────────────────── */

  // How well does ONE cue fit the question? 0..1 by containment of the cue's tokens.
  function cueFit(q, cueTokens) {
    if (!cueTokens.length) return 0;
    var hit = 0;
    for (var i = 0; i < cueTokens.length; i++) hit += has(q.set, q.tokens, cueTokens[i]);
    return hit / cueTokens.length;
  }

  /* How DISCRIMINATING is a token within this case? "cough" appears in the cough, sputum and
   * haemoptysis topics of a respiratory case and settles nothing; "hemoptysis" appears in one and
   * settles everything. Without this, "coughing up blood" tied cough against haemoptysis at exactly
   * the same score and the matcher correctly but uselessly refused to answer. Document frequency is
   * counted over the case's own topics, so it adapts per case with no authoring. */
  function rarityTable(prepared) {
    var df = {}, i, j, k;
    for (i = 0; i < prepared.length; i++) {
      var seen = {};
      for (j = 0; j < prepared[i].cues.length; j++) {
        var cue = prepared[i].cues[j];
        for (k = 0; k < cue.length; k++) seen[cue[k]] = 1;
      }
      for (var t in seen) if (Object.prototype.hasOwnProperty.call(seen, t)) df[t] = (df[t] || 0) + 1;
    }
    return df;
  }
  function rarityOf(cueTokens, df) {
    if (!cueTokens.length) return 0.55;
    var sum = 0;
    for (var i = 0; i < cueTokens.length; i++) {
      var n = df[cueTokens[i]] || 1;
      sum += n <= 1 ? 1 : (n === 2 ? 0.82 : (n === 3 ? 0.62 : 0.5));
    }
    return sum / cueTokens.length;
  }

  /* Topics come in as the case's history map { key: { cues: [...] } }. Everything is precomputed
   * per call; a case has tens of topics, so this is microseconds, and caching would only add a
   * staleness bug when an author edits content. */
  function prepareTopics(topics) {
    var out = [];
    for (var key in topics) {
      if (!Object.prototype.hasOwnProperty.call(topics, key)) continue;
      var t = topics[key] || {};
      var cues = [];
      var raw = t.cues || [];
      for (var i = 0; i < raw.length; i++) {
        var c = canon(raw[i]);
        if (c.tokens.length) cues.push(c.tokens);
      }
      // The topic KEY itself is a cue ("orthopnea", "dyspnea_grade", "family_history"). Authors name
      // keys in medical language, which is exactly the language a confident student types.
      var keyTokens = canon(String(key).replace(/[_.]+/g, " ")).tokens;
      var keyIdx = -1;
      if (keyTokens.length) { keyIdx = cues.length; cues.push(keyTokens); }
      // The topic's own label, when the author gave one.
      if (t.label) { var lc = canon(t.label).tokens; if (lc.length) cues.push(lc); }
      out.push({ key: key, topic: t, cues: cues, keyTokens: keyTokens, keyIdx: keyIdx });
    }
    return out;
  }

  function mentionsOther(q) {
    for (var i = 0; i < OTHERS.length; i++) if (Object.prototype.hasOwnProperty.call(q.set, OTHERS[i])) return true;
    return false;
  }

  function hasIntent(tokens) {
    for (var i = 0; i < tokens.length; i++) if (Object.prototype.hasOwnProperty.call(INTENTS, tokens[i])) return tokens[i];
    return null;
  }

  /* rank(topics, question) -> [{ key, topic, score, why }] best first.
   *
   * score is 0..1 and comparable across cases, so a single confidence threshold works everywhere:
   *   >= 0.62  answer it
   *   0.34..0.62  offer it as "did you mean", never answer silently
   *   < 0.34  not asked
   */
  // Does the question contain at least one canonical clinical concept? Everything the vocabulary
  // maps ONTO is a concept ("dyspnea", "edema", "smoking", "duration"); the words it does not know
  // ("colour", "weather", "cost", "cricket") are not. A question with none of them is small talk,
  // and answering it from a case script would be inventing clinical content.
  var _concepts = null;
  function concepts() {
    if (_concepts) return _concepts;
    var WM = wordMap();
    _concepts = {};
    for (var k in WM) {
      if (!Object.prototype.hasOwnProperty.call(WM, k)) continue;
      var parts = String(WM[k]).split(" ");
      for (var i = 0; i < parts.length; i++) { if (!parts[i]) continue; _concepts[parts[i]] = 1; _concepts[stem(parts[i])] = 1; }
    }
    for (var it in INTENTS) if (Object.prototype.hasOwnProperty.call(INTENTS, it)) { _concepts[it] = 1; _concepts[stem(it)] = 1; }
    return _concepts;
  }
  function isConcept(t) { return Object.prototype.hasOwnProperty.call(concepts(), t); }

  function rank(topics, question) {
    var q = canon(question);
    if (!q.tokens.length) return [];
    var prepared = prepareTopics(topics || {});
    var df = rarityTable(prepared);
    var other = mentionsOther(q);
    var qIntent = hasIntent(q.tokens);
    var scored = [], i, j;

    for (i = 0; i < prepared.length; i++) {
      var p = prepared[i];
      var best = 0, bestLen = 0, bestRarity = 0.5, bestFromKey = false, bestKeyBoosted = false;
      for (j = 0; j < p.cues.length; j++) {
        var cue = p.cues[j];
        var fit = cueFit(q, cue);
        if (fit <= 0) continue;
        // Specificity: a 3-token cue fully matched beats a 1-token cue fully matched. Partial
        // matches of long cues still count, which is what lets a student's shorter phrasing land.
        var spec = 1 + Math.min(0.5, (cue.length - 1) * 0.18);
        var s = fit * spec;
        // A single-token cue that only fuzzy-matched is too weak to carry a topic on its own.
        if (cue.length === 1 && fit < 1) s *= 0.6;
        // The topic KEY is the author's own label for this topic, in medical language. A student
        // who types it exactly ("inhalers") means THAT topic, not a longer authored cue that merely
        // shares a word with it ("how do you use your inhaler" under inhaler_technique).
        var fromKey = (j === p.keyIdx);
        if (fromKey && fit === 1) s *= 1.3;
        if (cue.length === 1 && !fromKey && q.tokens.length > 1 && !isConcept(cue[0])) s *= 0.35;
        if (s > best) { best = s; bestLen = cue.length; bestRarity = rarityOf(cue, df); bestFromKey = fromKey; bestKeyBoosted = fromKey && fit === 1; }
      }
      if (best <= 0) continue;

      var score = Math.min(1, best / 1.5);
      var why = [];

      /* A token the student typed that belongs to exactly ONE topic in this case is the strongest
       * evidence there is, and it must outrank a generic topic whose KEY happens to match a common
       * word. "coughing up blood" contains both cough (three topics) and hemoptysis (one), and
       * without this the cough topic won on its exact key match and the student was answered about
       * the wrong symptom. */
      var uniqueHit = false;
      for (j = 0; j < p.cues.length && !uniqueHit; j++) {
        for (var ui = 0; ui < p.cues[j].length; ui++) {
          var ut = p.cues[j][ui];
          if (ut.length >= 5 && (df[ut] || 0) === 1 && Object.prototype.hasOwnProperty.call(q.set, ut)) { uniqueHit = true; break; }
        }
      }
      if (uniqueHit) {
        // MAX, not product: a topic already boosted for an exact key match must not compound it.
        var already = bestKeyBoosted ? 1.3 : 1;
        score = Math.min(1, score * (1.4 / already));
        why.push("unique term");
      }

      // Ownership guard: "does your father smoke" must not answer the patient's own smoking topic.
      var topicIsFamily = Object.prototype.hasOwnProperty.call(p.topic, "about")
        ? p.topic.about === "family"
        : (p.keyTokens.indexOf("family") >= 0 || p.keyTokens.indexOf("contact") >= 0
           || /famil|contact|household|home|hereditar/.test(p.key));
      if (other && !topicIsFamily) { score *= 0.45; why.push("asked about someone else"); }
      if (other && topicIsFamily) { score = Math.min(1, score * 1.35); why.push("family"); }

      // Intent agreement: a "since when" question prefers a topic whose cues carry duration/onset.
      if (qIntent) {
        var topicIntent = false;
        for (j = 0; j < p.cues.length; j++) if (hasIntent(p.cues[j])) { topicIntent = true; break; }
        if (topicIntent) { score = Math.min(1, score * 1.25); why.push("intent:" + qIntent); }
      }

      // The opening question is generic by nature and would otherwise shadow specific topics.
      if (p.key === "presenting" && q.tokens.length > 4 && !Object.prototype.hasOwnProperty.call(q.set, "presenting")) score *= 0.7;

      scored.push({ key: p.key, topic: p.topic, score: Math.round(score * 1000) / 1000, rarity: bestRarity, cueLen: bestLen, fromKey: bestFromKey, why: why });
    }

    /* Sort by score, then by how DISCRIMINATING the matched cue was, then by cue length. Rarity is
     * a tie-breaker and not a multiplier on purpose: as a multiplier it dragged every score under
     * the answer threshold, turning good matches into "I am not sure what you mean". As a
     * tie-breaker it does the one job it is needed for, which is "coughing up blood" landing on
     * haemoptysis rather than on the cough topic they both fit equally well. */
    scored.sort(function (a, b) {
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      if (b.cueLen !== a.cueLen) return b.cueLen - a.cueLen;
      if (Math.abs(b.rarity - a.rarity) > 0.001) return b.rarity - a.rarity;
      // A cue the AUTHOR wrote is stronger evidence than the key we derived from the topic name.
      if (a.fromKey !== b.fromKey) return a.fromKey ? 1 : -1;
      return 0;
    });
    return scored;
  }

  var ANSWER_AT = 0.62;     // confident enough for the patient to answer
  var SUGGEST_AT = 0.34;    // worth offering as "did you mean"

  /* match(topics, question) -> { key, topic, score, confident, suggestions:[{key,topic,score}] }
   * key is null when nothing was confident; suggestions is then what the UI offers instead of a
   * dead end. The caller decides what to show; this module never produces patient speech. */
  function match(topics, question, opts) {
    opts = opts || {};
    var answerAt = typeof opts.answerAt === "number" ? opts.answerAt : ANSWER_AT;
    var suggestAt = typeof opts.suggestAt === "number" ? opts.suggestAt : SUGGEST_AT;
    var ranked = rank(topics, question);
    var top = ranked[0] || null;
    var confident = !!(top && top.score >= answerAt);

    // A clear winner matters as much as a high score: two topics tied at 0.7 means the question was
    // ambiguous ("swelling" when the case has both pedal oedema and abdominal distension), and the
    // right move is to ask which, not to pick one.
    /* Refuse only when the two really are interchangeable. Rarity and "authored cue vs derived
     * key" are qualitative separations, so when either of them broke the tie the winner stands:
     * "I smoke but mainly I feel breathless" is about the breathlessness the author wrote a cue
     * for, not about the smoking topic whose KEY happens to appear in the sentence. */
    if (confident && ranked.length > 1 && (top.score - ranked[1].score) < 0.06 && ranked[1].score >= answerAt
        && top.cueLen === ranked[1].cueLen
        && (top.rarity - ranked[1].rarity) < 0.15 && top.fromKey === ranked[1].fromKey) {
      confident = false;
    }

    var suggestions = [];
    for (var i = confident ? 1 : 0; i < ranked.length && suggestions.length < 3; i++) {
      if (ranked[i].score >= suggestAt) suggestions.push(ranked[i]);
    }

    return {
      key: confident ? top.key : null,
      topic: confident ? top.topic : null,
      score: top ? top.score : 0,
      confident: confident,
      best: top,
      suggestions: suggestions,
      ranked: ranked
    };
  }

  var API = {
    canon: canon,
    rank: rank,
    match: match,
    within: within,
    ANSWER_AT: ANSWER_AT,
    SUGGEST_AT: SUGGEST_AT,
    _phrases: PHRASES,
    _synonyms: SYNONYMS
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_LEXICON = API;
})();
