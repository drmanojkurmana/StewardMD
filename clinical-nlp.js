/* StewardMD — Clinical Narrative → Structured Findings (deterministic NLP layer).
 * ---------------------------------------------------------------------------
 * UPSTREAM of the Internal Medicine reasoning engine. Turns a clinician's free-text
 * narrative into structured, canonical findings the existing engine already understands.
 * It does NOT diagnose, does NOT change disease scoring, and NEVER uses web search.
 *
 * Pipeline (all local / deterministic / zero-token):
 *   normalize (abbreviations + spelling) → entity match (synonym / label / fuzzy /
 *   compound phrases / vitals) → negation + uncertainty + temporality → confidence +
 *   red-flag priority → structured schema.
 *
 * Pure module: no DOM, no network. Exposed as window.SMD_NLP AND module.exports so it
 * can be unit-tested under Node (test/run-nlp.mjs). reasoning.js calls SMD_NLP.extract()
 * from parseFreeText and feeds only PRESENT, engine-valid keys to the deterministic engine.
 */
(function (root) {
  "use strict";

  // ── abbreviations / doctor shorthand → expanded phrase (word-boundary safe) ──
  var ABBREV = [
    ["k/c/o", "known case of"], ["kco", "known case of"], ["h/o", "history of"], ["ho", "history of"],
    ["c/o", "complains of"], ["s/p", "status post"], ["r/o", "rule out"], ["d/d", "differential"],
    ["b/l", "bilateral"], ["bl", "bilateral"], ["rt", "right"], ["lt", "left"],
    ["dm", "diabetes mellitus"], ["htn", "hypertension"], ["sob", "shortness of breath"],
    ["loc", "loss of consciousness"], ["rta", "road traffic accident"], ["cva", "stroke"],
    ["ich", "intracranial haemorrhage"], ["sah", "subarachnoid haemorrhage"],
    ["cad", "coronary artery disease"], ["ccf", "heart failure"], ["ckd", "chronic kidney disease"],
    ["uti", "urinary tract infection"], ["ruq", "right upper quadrant"], ["luq", "left upper quadrant"],
    ["pod", "post operative day"], ["ue", "upper limb"], ["le", "lower limb"], ["gtcs", "generalised tonic clonic seizure"],
    ["opd", "outpatient"], ["a/w", "associated with"], ["f/h", "family history"], ["p/h", "past history"]
  ];
  // common misspellings → correct term (applied as whole words)
  var SPELL = {
    quadriperesis: "quadriparesis", quadraparesis: "quadriparesis", quadreparesis: "quadriparesis",
    aniscoria: "anisocoria", anisocoia: "anisocoria", sensorioum: "sensorium", sensorim: "sensorium",
    meningtis: "meningitis", menigitis: "meningitis", cholengitis: "cholangitis",
    dyspnoea: "dyspnea", diarrhoea: "diarrhea", odema: "oedema", hemorrage: "haemorrhage",
    siezure: "seizure", siezures: "seizure", convultion: "convulsion", froting: "frothing", frothin: "frothing"
  };

  // ── negation / uncertainty / temporality cue words ──
  var NEG = ["no", "not", "denies", "denied", "without", "absent", "nil", "negative for", "free of", "ruled out"];
  var AFEBRILE = ["afebrile"]; // implicit "no fever"
  var CONSIDER = ["possible", "possibly", "probable", "likely", "suspected", "suspect", "query", "?", "impression"];
  var EXCLUDE = ["rule out", "r/o", "to exclude", "cannot exclude"];
  var TEMPORAL = ["history of", "known case of", "previous", "prior", "old", "past", "h/o", "resolved", "status post", "post operative day", "background of", "on treatment for", "on rx for"];
  // finding keys that are inherently background/chronic — keep even when phrased historically
  var BACKGROUND = { diabetesHx: 1, hypertensionHx: 1, knownCAD: 1, knownHeartFailure: 1, atrialFibHx: 1, alcoholExcess: 1, immunosuppression: 1, pregnancy: 1 };
  // neurological / systemic emergency findings → red-flag priority
  var RED_FLAG = { alteredSensorium: 1, focalNeuroDeficit: 1, seizure: 1, thunderclapHeadache: 1, ascendingWeakness: 1, neckStiffness: 1, miosisSecretions: 1, papilledema: 1, hypotension: 1, hypoxia: 1, mucocutaneousBleeding: 1, rigidity: 1 };

  // compound phrases recognised as clinical entities. eng = engine finding key it maps to
  // (closest existing canonical); display = human label to show in the review chip.
  var COMPOUND = [
    { re: /\bb(?:ilateral)?\s*(?:l\s*)?(?:plantars?\s*extensors?|extensors?\s*plantars?)\b/, eng: "focalNeuroDeficit", display: "Bilateral extensor plantar response", red: true },
    { re: /\b(?:extensor\s*plantars?|plantars?\s*extensor|upgoing\s*plantars?|babinski)\b/, eng: "focalNeuroDeficit", display: "Extensor plantar response", red: true },
    { re: /\banisocoria|unequal\s*pupils?\b/, eng: "focalNeuroDeficit", display: "Anisocoria (unequal pupils)", red: true },
    { re: /\bquadri(?:paresis|plegia)|weakness\s*(?:of|in)?\s*all\s*four\s*limbs?\b/, eng: "focalNeuroDeficit", display: "Quadriparesis", red: true },
    { re: /\b(?:para(?:paresis|plegia)|hemi(?:paresis|plegia)|mono(?:paresis|plegia))\b/, eng: "focalNeuroDeficit", display: "Limb weakness / focal deficit", red: true },
    { re: /\bfroth(?:ing)?(?:\s*at\s*(?:the\s*)?mouth)?|foaming\b/, eng: "seizure", display: "Frothing at mouth (possible seizure)", red: true },
    { re: /\bfever\s*with\s*(?:chills?|rigors?)|chills?\s*and\s*rigors?\b/, eng: "fever", display: "Fever with chills / rigors" },
    { re: /\bright\s*upper\s*quadrant\s*pain\b/, eng: "rightUpperQuadrantPain", display: "Right upper quadrant pain" }
  ];

  function lev(a, b) {
    a = a || ""; b = b || ""; var m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 3;
    var d = []; for (var i = 0; i <= m; i++) d[i] = [i]; for (var j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // smd_nlp_v2 (default ON since 2026-09-27, owner: "turn all on"): Phase 2 of kb/validation/PLAN-DX-ABX-10.md.
  // ctx.v2 overrides the flag (tests / callers that know); otherwise ?nlpv2=1|0, then localStorage
  // smd_nlp_v2 ("0" = the classic extractor, unchanged).
  function nlpV2(ctx) {
    if (ctx && ctx.v2 != null) return !!ctx.v2;
    try {
      var q = /[?&]nlpv2=([01])\b/.exec((root && root.location && root.location.search) || "");
      if (q) return q[1] === "1";
      return !(root && root.localStorage && root.localStorage.getItem("smd_nlp_v2") === "0");
    } catch (e) { return true; }
  }
  // v2: phrases the abbreviation table would otherwise mangle ("cva" -> "stroke")
  var PRE_V2 = [[/\bcva\s*(?:angle\s*)?tender(?:ness)?\b/g, "costovertebral angle tenderness"], [/\bcva\s*angle\b/g, "costovertebral angle"],
    // round 42: shorthand ("fever w/o rigors", "w/ cough", "abd pain"; a trailing sign: "fever -", "cough (-)", "vomiting +ve")
    [/(^|[^a-z])w\/o(?=[^a-z]|$)/g, "$1without"], [/(^|[^a-z])w\/\s*(?=[a-z0-9])/g, "$1with "], [/\babd\b\.?/g, "abdominal"],
    [/\s*(?:\(\s*-\s*\)|-\s?ve\b|\s-)(?=\s*(?:[,.;:]|$))/g, " negative"], [/\s*(?:\(\s*\+\s*\)|\+\s?ve\b|\s\+)(?=\s*(?:[,.;:]|$))/g, " positive"]];
  // "a 3-day history of" states the present illness, not past history
  var PRESENT_HX_V2 = /\b(?:\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|few|several)\s*-?\s*(?:d|days?|wks?|weeks?|months?|hours?|hrs?)\s*history\b/;
  // round 8: "on a background of 3 days of fever" is the present illness too (days/weeks/hours only;
  // "background of 10 years of diabetes" stays past history)
  var PRESENT_BG_V2 = /\bbackground of\s*(?:a|an|the)?\s*(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|few|several|couple of)\s*-?\s*(?:d|days?|wks?|weeks?|hours?|hrs?)\b/;
  // round 8: "over the past 12 hours", "in the last few days" dates the present illness; "past" there
  // is not past history. Removed before the temporal cue check.
  var RECENT_V2 = /\b(?:over|in|during|within|for)?\s*the\s*(?:past|last)\s*(?:\d{1,3}|one|two|three|four|five|six|seven|few|several|couple of)?\s*(?:-\s*)?(?:minutes?|mins?|hours?|hrs?|days?|nights?|weeks?|wks?|months?)\b|\bpast\s*(?:\d{1,3}|few|several|couple of)\s*(?:hours?|hrs?|days?|weeks?)\b/g;
  // round 8: "not responding to antibiotics", "no improvement" describe a course, they negate nothing
  var RESOLVED_AFTER_V2 = /^\s*(?:which\s+|that\s+)?(?:has\s+|had\s+|have\s+|was\s+|were\s+)?(?:since\s+|now\s+|then\s+|later\s+|completely\s+|fully\s+|spontaneously\s+)?(?:settled|subsided|resolved|abated|remitted|disappeared|gone|went away)\b/;
  // round 8: a test named, not a finding: "HIV serology pending / non-reactive", "HIV status unknown"
  var TEST_AFTER_V2 = /^\s*(?:\d\s*)?(?:serology|status|test(?:ing)?|screen(?:ing)?|antibod(?:y|ies)|antigen|rapid test|elisa|pcr|ab|ag)?\s*(?:is\s+|was\s+|:\s*)?(?:pending|awaited|sent|requested|ordered|unknown|non-?\s?reactive|not reactive)\b/;
  // round 8: a plan or a condition, not a finding: "blood cultures if febrile", "CXR reserved for hypoxia"
  var COND_V2 = /\b(?:if|unless|in case of|reserved for|watch for|monitor for|look(?:ing)? for|to exclude)\s+(?:(?:any|new|the|a|an|worsening|persistent|further)\s+)?$/;
  // round 8: a stopped drug or habit ("self-discontinued warfarin", "stopped alcohol 8 months ago") is past, not current
  var STOPPED_BEFORE_V2 = /\b(?:discontinued|stopped|stopping|ceased|withheld|held|quit|off)\s+(?:(?:his|her|the|all|regular)\s+)?$/;
  // round 8: a later mention that is a lab name with its value ("serum ketones (bhb) 1.2") is read by the numeric parser, not here
  var LAB_VALUE_AFTER_V2 = /^\s*(?:\([^)]{0,30}\)\s*)?(?:level\s*|of\s*|is\s*|was\s*|=|:|-)?\s*\d/;
  var NEG_IDIOM_V2 = /\b(?:not|no|without)\s+(?:(?:been|yet|fully|much|any)\s+)?(?:responding|responded|response|responsive|improving|improved|improvement|settling|settled|resolving|resolved|resolution|relieved|relief|relieving|subsiding|subsided|better|controlled|reducing|reduced|abating|abated|remitting)\b|\bnot\s+(?:passed|passing)\s+(?:any\s+)?urine\b|\bnot\s+opened\s+(?:his\s+|her\s+|their\s+)?bowels\b/g;
  // v2 numeric thresholds (clinical definitions, chosen on the train/dev split: see PLAN-DX-ABX-10.md)
  var LAB_V2 = { lactate: 2, plateletsLow: 150000, creatinineMgDl: 1.5, creatinineUmol: 133 };
  // explicit family-history phrasing only: "mother reports high fever" (a child's note) is the patient's fever
  var FAMILY_V2 = ["family history", "family h/o", "mother had", "father had", "mother has", "father has", "mother died", "father died",
    "brother had", "sister had", "sibling had", "runs in the family", "in the family"];
  // v2: background conditions kept even when phrased historically ("known cirrhosis", "h/o stroke")
  var BACKGROUND_V2 = { liverDisease: 1, cerebrovascularDisease: 1, malignancy: 1, immunocompromised: 1, anticoagulated: 1,
    nursingHomeResident: 1, hospitalizationLast90Days: 1, antibioticsLast90Days: 1, priorAntibiotics: 1, steroidUse: 1, knownCKD: 1, knownIBD: 1 };

  function spaceV2(s) { return s.replace(/[ \t\u00a0]*[\r\n]+[ \t\u00a0]*/g, ". ").replace(/[ \t\u00a0]+/g, " "); }
  function normalize(text, v2) {
    var s = " " + String(text || "").toLowerCase() + " ";
    // round 19 (metamorphic tests): a line break ends a statement and repeated spaces are one space
    // ("chest  pain" read nothing; 510 of 571 audit notes lost findings when their spaces were doubled)
    if (v2) s = spaceV2(s);
    // round 43: a bullet marker opening a statement ("- No fever, cough or dysuria") is not part of it: 155 notes read
    // differently as bullets (negated lists lost their head)
    if (v2) s = s.replace(/(^\s*|[.;:]\s+)(?:[-*\u2022\u00b7\u2013>]+|\d{1,2}[.)])\s+(?=[a-z(])/g, "$1");
    if (v2) PRE_V2.forEach(function (p) { s = s.replace(p[0], p[1]); });
    // expand abbreviations (slash-forms need literal replace before punctuation strip)
    ABBREV.forEach(function (p) {
      var re = new RegExp("(^|[^a-z])" + esc(p[0]) + "(?=$|[^a-z])", "gi");
      s = s.replace(re, function (mm, pre) { return pre + p[1]; });
    });
    // fix spellings (whole word)
    Object.keys(SPELL).forEach(function (w) { s = s.replace(new RegExp("\\b" + esc(w) + "\\b", "g"), SPELL[w]); });
    return s;
  }

  // clause the match index falls in, so negation/temporal cues don't leak across "," / "and" / "with"
  function clauseBounds(norm, idx) {
    var breaks = /[.,;]| and | with | but | then | however |, /g, start = 0, end = norm.length, m;
    while ((m = breaks.exec(norm))) { if (m.index + m[0].length <= idx) start = m.index + m[0].length; else { end = m.index; break; } }
    return [start, end];
  }
  // round 40: postfix negation, right after the finding in its clause
  var POSTFIX_NEG_V2 = /^\s*(?:[:\-\u2013]\s*)?(?:(?:is|was|were|are|has been|have been)\s+)?(?:not\s+(?:present|seen|heard|elicited|found|noted|felt|palpable|detected|demonstrated|appreciated|evident|identified|observed|reported|visuali[sz]ed)\b|absent\b|none\b|nil\b|negative\b|denied\b|denies\b)|^\s*[:\-\u2013]\s*no\b/;
  function clauseAround(norm, idx) {
    var breaks = /[.,;]| and | with | but | then | however |, /g, start = 0, end = norm.length, m;
    while ((m = breaks.exec(norm))) { if (m.index + m[0].length <= idx) start = m.index + m[0].length; else { end = m.index; break; } }
    return norm.slice(start, Math.max(end, idx + 1));
  }
  function has(hay, arr) { for (var i = 0; i < arr.length; i++) if (hay.indexOf(arr[i]) >= 0) return true; return false; }
  // whole-word cue match — so "no" doesn't fire inside "known"/"now", "old" not inside "cold", etc.
  function hasWord(hay, arr) { for (var i = 0; i < arr.length; i++) { if (new RegExp("(^|[^a-z])" + esc(arr[i]) + "($|[^a-z])").test(hay)) return true; } return false; }

  // v2: a phrase must start a word ("hiv" not inside "shivering", "stemi" not inside "systemically");
  // a short one (4 letters or fewer) must also end one ("uti" not inside "utility"). Longer phrases may
  // run on, so stems like "cirrho" and plurals still match.
  function findWord(hay, sv) {
    var from = 0, i, a = /[a-z]/.test(sv.charAt(0)), z = sv.length <= 4 && /[a-z]/.test(sv.charAt(sv.length - 1));
    while ((i = hay.indexOf(sv, from)) >= 0) {
      if (!(a && /[a-z]/.test(hay.charAt(i - 1))) && !(z && /[a-z]/.test(hay.charAt(i + sv.length)))) return i;
      from = i + 1;
    }
    return -1;
  }

  // v2: "no fever, cough, dysuria or diarrhoea" negates every short item (5 words or fewer: "chest pain on exertion") of the list.
  var LIST_STOP_V2 = /\b(?:but|however|with|then|presents?|presented|has|had|reports?|complains?|noted|developed|now|since|for)\b/;
  // Guards: a head that is a complete idiom negates nothing ("no known allergies, fever and chills"; "no
  // significant history, cough for 3 days"), and a later item that states a duration turns the list into
  // a positive statement ("no vomiting, fever and cough for 3 days").
  var LIST_HEAD_SKIP_V2 = /\b(?:allerg\w*|comorbid\w*|addictions?|complaints?|significant)\b|\bhistory\s*$/;
  var NEG_LIST_HEAD_V2 = /^\s*(?:(?:he|she|they|patient|the patient|pt|mother|father|family)\s+(?:also\s+)?)?(?:(?:has|have|had|there (?:is|was|were|are)|with)\s+)?(?:no|denies|denied|without|nil|negative for|not)\b/;
  var NEG_LIST_LEAD_V2 = /^\s*(?:(?:he|she|they|patient|the patient|pt)\s+(?:also\s+)?)?(?:(?:has|have|had|there (?:is|was|were|are)|with)\s+(?:no|nil|not)\b|without\b|(?:is|are|was|were)\s+not\b)/;
  var LIST_DUR_V2 = /\b(?:for|since|x|over)\s+(?:the\s+)?(?:\d|a |an |one|two|three|four|five|six|seven|few|several|past|last)|\b\d+\s*(?:d|days?|wks?|weeks?|hours?|hrs?|months?)\b/;
  // real words one letter from a synonym (round 29): never read as a typo of it
  var FUZZY_STOP_V2 = { dysphasia: 1, dysphasic: 1, drooping: 1, blurred: 1, palpation: 1, hypodense: 1, hyperdense: 1, following: 1, hypotensive: 1, hypertensive: 1, waking: 1, reaching: 1 };
  function negList(norm, idx) {
    var st = Math.max(norm.lastIndexOf(".", idx - 1), norm.lastIndexOf(";", idx - 1), norm.lastIndexOf(":", idx - 1)) + 1;
    var en = norm.slice(idx).search(/[.,;:]| and | or | nor /), segs = norm.slice(st, en < 0 ? norm.length : idx + en).split(/,| and | or | nor /);
    if (segs.length < 2) return false;
    var item = function (x) { return x.trim().split(/\s+/).filter(Boolean).length <= 5 && !LIST_STOP_V2.test(x); };
    var headOk = function (x) { return !LIST_HEAD_SKIP_V2.test(x) && x.replace(NEG_IDIOM_V2, "") === x; }, ok = false, k;
    // the list opens the sentence or clause ("No cough, fever or haemoptysis"; "He has no rash, headache or vomiting")
    if (NEG_LIST_HEAD_V2.test(segs[0]) && headOk(segs[0])) { ok = true; for (k = 1; k < segs.length; k++) if (!item(segs[k])) { ok = false; break; } }
    // round 28: or it starts mid-sentence with a clause lead ("passed urine in good volume, and has no jaundice,
    // breathlessness or confusion"). A bare "no X" inside a list does not negate what follows it ("cough, sputum,
    // no fever, breathlessness on exertion").
    if (!ok) for (k = segs.length - 2; k > 0; k--) {
      if (NEG_LIST_LEAD_V2.test(segs[k])) { ok = headOk(segs[k]); break; }
      if (!item(segs[k])) break;
    }
    if (!ok) return false;
    // round 38: when items carry their own "no" ("No fever, no neck stiffness, altered sensorium after seizure"), an item
    // without one is negated only inside an "or" / "nor" run ("no preceding trauma, no cough, fever, or haemoptysis")
    var lastSeg = segs[segs.length - 1], hs = k >= 0 && k < segs.length - 1 && NEG_LIST_LEAD_V2.test(segs[k]) ? k : 0;
    if (!/^\s*(?:no|not|nil|nor|without)\b/.test(lastSeg) && segs.slice(hs + 1, -1).some(function (x) { return /^\s*(?:no|not|nil|without)\b/.test(x); })) {
      var parts = norm.slice(st, en < 0 ? norm.length : idx + en).split(/(,| and | or | nor )/), sepB = parts.length > 2 ? parts[parts.length - 2] : "";
      var tail = norm.slice(idx), te = tail.search(/[.;:]/);
      if (!/^ (?:or|nor) $/.test(sepB) && !/\b(?:or|nor)\b/.test(te < 0 ? tail : tail.slice(0, te))) return false;
    }
    var rest = norm.slice(idx), se = rest.search(/[.;:]/);
    return !LIST_DUR_V2.test(se < 0 ? rest : rest.slice(0, se));
  }
  // v2: a result reported after the name ("ketones negative", "blood culture: nil growth")
  function negAfter(norm, end) {
    var m = /^[^,;.]{0,20}?\b(negative|nil|absent|not detected)\b/.exec(norm.slice(end));
    return !!m && !/gram[- ]?$/.test(m[0].slice(0, m[0].length - m[1].length));   // "gram-negative" names an organism
  }

  /* ctx = { valid:{key:1}, labels:{key:label}, syn:{key:[synonyms]} } (from reasoning.js) */
  function extract(text, ctx) {
    ctx = ctx || {}; var valid = ctx.valid || {}, labels = ctx.labels || {}, syn = ctx.syn || {};
    var v2 = nlpV2(ctx), numeric = ctx.numeric || {};
    var norm = normalize(text, v2);
    var byKey = {};  // key → { idx, method, srcText, display }
    var alts = {};   // v2: key → every mention [{ idx, method, srcText }], read when the first is negated / historical

    // mentions that are not the finding at all (read the same way for the first and every later mention)
    function skipMention(key, idx, srcText) {
      // round 29: the examination named ("fundoscopy shows choroidal tubercles") is not papilloedema unless it says swelling
      // (round 34: the swelling word must itself be affirmed: "optic discs normal, no pallor or oedema" is not)
      if (v2 && key === "papilledema" && /^(?:fundoscopy|optic dis[ck]s?)$/.test(srcText || "")) {
        var fseg = norm.slice(idx, idx + 90).split(/[.;]/)[0], fsw = /\b(?:swoll\w*|swelling|oedema\w*|edema\w*|papill\w*|blurr\w*|raised|elevated|indistinct|hyperaemi\w*)\b/.exec(fseg);
        if (!fsw || /\b(?:no|not|without|nil|normal)\b/.test(fseg.slice(0, fsw.index))) return true;
      }
      // round 34: an intimal flap is aortic dissection, not a liver flap; symmetric brisk reflexes are not a focal deficit
      if (v2 && key === "asterixis" && srcText === "flap" && (/\b(?:intimal|dissection|dissecting)\b[^.;]{0,15}$/.test(norm.slice(Math.max(0, idx - 25), idx)) ||
          /^\s*(?:valve|wound|graft|surgery|of skin)\b/.test(norm.slice(idx + 4, idx + 20)))) return true;
      if (v2 && key === "focalNeuroDeficit" && srcText === "brisk reflexes" &&
          !/\b(?:right|left|unilateral|one side|asymmetric\w*)\b/.test(norm.slice(Math.max(0, idx - 40), idx + 60).split(/[.;]/).slice(-2).join(" "))) return true;
      // round 34: "frothy urine / sputum" is proteinuria or pulmonary oedema, not a seizure ("frothing at the mouth" is)
      if (v2 && key === "seizure" && /^froth/.test(srcText || "") && /^y\b/.test(norm.slice(idx + 5, idx + 7))) return true;
      // round 28: "unresponsive to antibiotics / cell-wall agents / paracetamol" is about a treatment, not the sensorium
      if (v2 && key === "alteredSensorium" && /^(?:un|non-?)responsive$/.test(srcText || "") &&
          /^\s+to\s+(?!voice|pain|painful|verbal|stimul|command|touch|sternal|call|name)/.test(norm.slice(idx + srcText.length, idx + srcText.length + 30))) return true;
      // round 34: palmar erythema is a liver sign, erythema nodosum / multiforme / ab igne are not a red infected skin
      if (v2 && key === "skinErythema" && /^erythema$/.test(srcText || "") && (/\bpalmar\s+$/.test(norm.slice(Math.max(0, idx - 8), idx)) ||
          /^\s*(?:nodosum|multiforme|ab igne|infectiosum|marginatum|toxicum)\b/.test(norm.slice(idx + 8, idx + 24)))) return true;
      return false;
    }
    function consider(key, idx, method, srcText, display) {
      if (!valid[key]) return;
      if (v2 && skipMention(key, idx, srcText)) return;
      if (v2) (alts[key] = alts[key] || []).push({ idx: idx, method: method, srcText: srcText || "" });
      if (byKey[key] && byKey[key].conf >= 0.9) return;
      byKey[key] = { idx: idx, method: method, srcText: srcText || "", display: display || labels[key] || key,
        conf: method === "synonym" ? 0.95 : method === "vitals" ? 0.9 : method === "compound" ? 0.85 : method === "label" ? 0.82 : 0.65 };
    }

    // 1) compound phrases (highest-signal, may set red flags)
    COMPOUND.forEach(function (c) { var m = c.re.exec(norm); if (m && valid[c.eng]) { consider(c.eng, m.index, "compound", m[0].trim(), c.display); if (byKey[c.eng]) byKey[c.eng]._red = c.red; } });

    // 2) synonym + label match against the engine's own vocabulary
    Object.keys(valid).forEach(function (key) {
      if (v2 && numeric[key]) return;   // v2: a bare "platelets" / "weight" is a lab name, not a finding
      var hitIdx = -1, hitSrc = "";
      (syn[key] || []).forEach(function (sv) { var i = v2 ? findWord(norm, sv) : norm.indexOf(sv); if (i >= 0 && (hitIdx < 0 || i < hitIdx)) { hitIdx = i; hitSrc = sv; } });
      if (hitIdx >= 0) {
        consider(key, hitIdx, "synonym", hitSrc);
        // v2: later mentions of the same finding, so a negated first one does not hide them
        if (v2) (syn[key] || []).forEach(function (sv) { var from = 0, j, n = 0;
          while (n++ < 6 && (j = findWord(norm.slice(from), sv)) >= 0) { j += from; if (j !== hitIdx) { if (!byKey[key]) consider(key, j, "synonym", sv); else if (!skipMention(key, j, sv)) (alts[key] = alts[key] || []).push({ idx: j, method: "synonym", srcText: sv }); } from = j + sv.length; } });
        return;
      }
      var lab = (labels[key] || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      if (lab.length >= 5 && lab.length <= 26) { var li = norm.indexOf(" " + lab + " "); if (li < 0) li = norm.indexOf(" " + lab + "s ");
        // (round 33 tried letting punctuation follow a label, "sore throat,": right in principle, but one more antibiotic
        // overcall on the unseen notes and "erythema," reads palmar erythema as skin; not kept)
        if (li >= 0) consider(key, li + 1, "label", lab);
        // round 19 (metamorphic tests): every later occurrence too, so "no erythema ... diffuse erythema" reads the same either way round
        if (v2 && li >= 0) { var lj = li + 1, ln = 0; while (ln++ < 6 && (lj = norm.indexOf(" " + lab, lj + lab.length)) >= 0) { if (/[^a-z]/.test(norm.charAt(lj + 1 + lab.length) || " ")) if (!skipMention(key, lj + 1, lab)) (alts[key] = alts[key] || []).push({ idx: lj + 1, method: "label", srcText: lab }); } } }
    });

    // 3) fuzzy typo match against synonym vocabulary (safe: distance-gated, confirmation for red flags)
    var tokens = norm.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(function (w) { return w.length >= 6; });
    Object.keys(valid).forEach(function (key) {
      if (byKey[key] || (v2 && numeric[key])) return;
      var best = 99, bestSrc = "";
      (syn[key] || []).forEach(function (sv) { if (sv.indexOf(" ") >= 0 || sv.length < 6) return; tokens.forEach(function (tk) {
        // round 29 (v2): a typo keeps the first letter and is a real misspelling, not another word ("drenching" is not
        // "retching", "following" is not "yellowing", "palpation" is not "palpitation", "hypotensive" is not hypertension)
        if (v2 && (tk.charAt(0) !== sv.charAt(0) || FUZZY_STOP_V2[tk])) return;
        var d = lev(tk, sv); if (d < best) { best = d; bestSrc = tk; } }); });
      var thresh = v2 ? 1 : bestSrc.length >= 9 ? 2 : 1;
      if (best <= thresh) { var idx = norm.indexOf(bestSrc); consider(key, idx < 0 ? 0 : idx, "fuzzy", bestSrc); if (byKey[key]) byKey[key]._fuzzy = true; }
    });

    // 4) numeric vitals → findings (uses raw text; punctuation like "/" and "%" preserved)
    var raw = " " + String(text || "").toLowerCase() + " ", m2;
    if (v2) raw = spaceV2(raw);
    function vital(key, src) { consider(key, (raw.indexOf(src) || 0), "vitals", src); }
    // round 19 (metamorphic tests): v2 reads the WORST value of a vital or lab the note gives (SOFA's rule), not the
    // first one ("baseline creatinine 1.1 ... creatinine 4.2 today"; "HR 128 ... 88 after fluids"). dir 1 = highest,
    // -1 = lowest; val(m) puts every match on one scale (units) or returns null to skip it. Classic: the first match.
    var nv = function (x) { return parseFloat(String(x).replace(/,/g, "")); };
    function pick(re, val, dir) {
      if (!v2) return raw.match(re);
      var g = new RegExp(re.source, re.flags.indexOf("g") < 0 ? re.flags + "g" : re.flags), m, best = null, bv = 0, v;
      while ((m = g.exec(raw))) { v = val(m); if (v != null && !isNaN(v) && (best === null || (dir > 0 ? v > bv : v < bv))) { best = m; bv = v; } if (!m[0].length) g.lastIndex++; }
      return best;
    }
    var V1 = function (m) { return +m[1]; };
    var PLTV = function (m) { var q = nv(m[1]); return m[2] ? q * 100000 : q >= 1000 ? q : q * 1000; };
    var CRV = function (m) { var c = nv(m[1]); return (m[2] && /mol/.test(m[2])) || c > 25 ? c / 88.4 : c; };
    // v2: a labelled BP wins, else the first PLAUSIBLE x/y (classic took the first x/y, so "GCS 13/15" hid the BP)
    if (v2) { m2 = raw.match(/\b(?:bp|blood pressure|b\.p\.?)\s*(?:of|is|was|=|:|-)?\s*(\d{2,3})\s*\/\s*(\d{2,3})/);
      if (!m2) { var bre = /(\d{2,3})\s*\/\s*(\d{2,3})/g, bm; while ((bm = bre.exec(raw))) { if (+bm[1] >= 60 && +bm[1] <= 300 && +bm[2] >= 30 && +bm[2] <= 200) { m2 = bm; break; } } } }
    else m2 = raw.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    var bpRead = function (m) { var sys = +m[1], dia = +m[2]; if (!(sys >= 60 && sys <= 300 && dia >= 30 && dia <= 200)) return;
      if (sys >= 140 || dia >= 90) { vital("hypertensionHx", m[0]); if (byKey.hypertensionHx) byKey.hypertensionHx.display = (sys >= 180 || dia >= 120 ? "Severe hypertension (BP " : "Hypertension (BP ") + sys + "/" + dia + ")"; }
      else if (sys < 90 || dia < 60) vital("hypotension", m[0]); };
    if (m2) {
      bpRead(m2);
      // round 19: v2 also reads the lowest labelled BP ("BP 128/80 on arrival, 82/50 an hour later"): the worst one decides shock
      if (v2 && m2[0].indexOf("/") > 0) { var BP_RE = /\b(?:bp|blood pressure|b\.p\.?)\s*(?:of|is|was|=|:|-)?\s*(\d{2,3})\s*\/\s*(\d{2,3})/;
        var lo = pick(BP_RE, function (m) { return +m[1] >= 60 && +m[1] <= 300 && +m[2] >= 30 ? +m[1] : null; }, -1); if (lo && lo !== m2 && lo.index !== m2.index) bpRead(lo); }
    }
    if ((m2 = pick(/\b(?:spo2|sao2|sats?|saturation|saturating)\s*(?:at|of|is|=|:)?\s*(\d{2,3})\s*%?/, function (m) { return +m[1] <= 100 ? +m[1] : null; }, -1))) { if (+m2[1] <= 100 && +m2[1] < 92) vital("hypoxia", m2[0]); }
    var HR_RE = v2 ? /\b(?:hr|heart rate|pulse(?: rate)?)\s*(?:of|is|was|=|:|-)?\s*(\d{2,3})\b/ : /\b(?:hr|heart rate|pulse|pr)\s*(?:of|is|=|:)?\s*(\d{2,3})\b/;
    if ((m2 = pick(HR_RE, V1, 1)) && +m2[1] > 100) vital("tachycardia", m2[0]);
    if ((m2 = pick(HR_RE, function (m) { return +m[1] > 20 ? +m[1] : null; }, -1)) && +m2[1] < 60 && +m2[1] > 20) vital("bradycardia", m2[0]);
    var RR_RE = /\b(?:rr|resp(?:iratory)? rate)\s*(?:of|is|=|:)?\s*(\d{1,2})\b/;
    if ((m2 = pick(RR_RE, V1, 1)) && +m2[1] > 22) vital("tachypnea", m2[0]);
    if ((m2 = pick(RR_RE, function (m) { return +m[1] > 0 ? +m[1] : null; }, -1)) && +m2[1] < 10 && +m2[1] > 0) vital("bradypnea", m2[0]);
    if ((m2 = pick(/\bgcs\s*(?:of|is|=|:)?\s*(?:e\d\s*v\d\s*m\d|\d{1,2})(?:\s*\/\s*15)?/, function (m) { var q = (m[0].match(/(\d{1,2})\s*\/\s*15/) || [])[1] || (m[0].match(/\d{1,2}/) || [])[0]; return q ? +q : null; }, -1))) { var g = (m2[0].match(/(\d{1,2})\s*\/\s*15/) || [])[1] || (m2[0].match(/\d{1,2}/) || [])[0]; if (g && +g < 15 && +g >= 3) vital("alteredSensorium", m2[0]); }
    var T_RE = v2 ? /\b(?:temp(?:erature)?|febrile at)\s*(?:of|is|was|=|:|-)?\s*(\d{2,3}(?:\.\d)?)\s*(?:°\s*[cf]?|c\b|celsius|f\b|fahrenheit|deg)?/ : /\b(?:temp(?:erature)?|febrile at)\s*(?:of|is|=|:)?\s*(\d{2,3}(?:\.\d)?)\s*(?:c|celsius|f|fahrenheit|°|deg)/;
    var TC = function (m) { var t = +m[1]; return t >= 90 ? (t - 32) / 1.8 : t > 0 ? t : null; }, tv;   // degrees C
    if ((m2 = pick(T_RE, TC, 1))) { tv = +m2[1]; if ((tv >= 38 && tv <= 44) || (tv >= 100 && tv <= 110)) vital("fever", m2[0]); }
    if ((m2 = pick(T_RE, TC, -1))) { tv = +m2[1]; if (tv > 0 && tv < 35) vital("hypothermia", m2[0]); }

    // 4b) v2: numeric labs, MAP and durations -> findings
    if (v2) {
      var num = function (x) { return parseFloat(String(x).replace(/,/g, "")); };
      if ((m2 = pick(/\bmap\s*(?:of|is|was|=|:|-)?\s*(\d{2,3})\b/, V1, -1)) && +m2[1] < 65 && +m2[1] >= 20) vital("hypotension", m2[0]);
      if ((m2 = pick(/\b(?:lactate|lactic acid)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:\.\d+)?)\s*(mg)?/, function (m) { return nv(m[1]) / (m[2] ? 9 : 1); }, 1))) {
        var lac = num(m2[1]) / (m2[2] ? 9 : 1);                          // mg/dL -> mmol/L
        if (lac >= LAB_V2.lactate && lac < 40) vital("lactateElevated", m2[0]);
      }
      if ((m2 = pick(/\b(?:anc|absolute neutrophil(?:s| count)?)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:[.,]\d+)?)/, function (m) { var a = nv(m[1]); return a < 50 ? a * 1000 : a; }, -1))) {
        var anc = num(m2[1]); if (anc < 50) anc *= 1000;                  // 0.3 (x10^9/L) -> 300/uL
        if (anc < 500) vital("neutropenia", m2[0]); if (anc < 100) vital("absoluteNeutrophilCountLow", m2[0]);
      }
      if ((m2 = pick(/\b(?:platelets?|plt|platelet count)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:[.,]\d+)?)\s*(lakhs?|lacs?)?/, PLTV, -1))) {
        var plt = num(m2[1]); plt = m2[2] ? plt * 100000 : plt >= 1000 ? plt : plt * 1000;
        if (plt > 0 && plt < LAB_V2.plateletsLow) vital("thrombocytopenia", m2[0]);
      }
      if ((m2 = pick(/\b(?:creatinine|creat|s\.?\s?cr)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:\.\d+)?)\s*(\u00b5mol|\u03bcmol|umol|mg)?/, CRV, 1))) {
        var cr = num(m2[1]), umol = (m2[2] && /mol/.test(m2[2])) || cr > 25;
        if (umol ? cr >= LAB_V2.creatinineUmol : cr >= LAB_V2.creatinineMgDl) vital("renalImpairment", m2[0]);
      }
      // round 18: electrolytes and glucose (findings exist only under smd_kb_v2). Units inferred from the value.
      if ((m2 = pick(/\b(?:serum\s+)?(?:sodium|na\+?)\b(?:\s*(?:level|value|mmol\/l|meq\/l))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-)?\s*(\d{2,3}(?:\.\d)?)\b/, function (m) { return +m[1] >= 90 && +m[1] <= 200 ? +m[1] : null; }, -1)) &&
          +m2[1] >= 90 && +m2[1] < 130) vital("sodiumLow", m2[0]);
      if ((m2 = pick(/\b(?:serum\s+)?(?:potassium|k\+?)\b(?:\s*(?:level|value|mmol\/l|meq\/l))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-)?\s*(\d(?:\.\d{1,2})?)\b/, function (m) { return +m[1] >= 1.5 && +m[1] <= 10 ? +m[1] : null; }, 1)) &&
          +m2[1] >= 6 && +m2[1] <= 10) vital("potassiumHigh", m2[0]);
      if ((m2 = pick(/\b(?:(?:serum|corrected|adjusted|total)\s+)?(?:calcium|ca\+?)\b(?:\s*(?:level|value|corrected|mmol\/l|mg\/dl))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-)?\s*(\d{1,2}(?:\.\d{1,2})?)\b(?!\s*-\s*\d)/, function (m) { var c = +m[1]; return c > 5 ? c / 4 : c; }, 1))) {   // not "CA 19-9"
        var ca = +m2[1]; if (ca > 5 ? ca > 11 && ca < 25 : ca > 2.75 && ca < 5) vital("calciumHigh", m2[0]); }
      var GLU_RE = /\b(?:(?:random|capillary|blood|plasma|serum|fasting)\s+)?(?:glucose|sugar|grbs|rbs|cbg|bsl|fbs|glycaemia|glycemia)\b(?:\s*(?:level|value|reading))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-)?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(mg|mmol)?/;
      var GLV = function (m) { var q = +m[1], mg = m[2] ? /mg/.test(m[2]) : q > 40; q = mg ? q : q * 18; return q > 0 && q < 3000 ? q : null; }, gl;   // mg/dL
      if ((m2 = pick(GLU_RE, GLV, -1)) && (gl = GLV(m2)) < 70) vital("glucoseLow", m2[0]);
      if ((m2 = pick(GLU_RE, GLV, 1)) && (gl = GLV(m2)) >= 250) { vital("glucoseHigh", m2[0]); if (gl > 600) vital("glucoseVeryHigh", m2[0]); }
      // round 32: a low haemoglobin and a high INR, as the lab import reads them (the engine counts the entered value)
      if ((m2 = pick(/\b(?:haemoglobin|hemoglobin|hgb|hb)\b(?:\s*(?:level|value|of))?\s*(?:\([^)\d]{0,12}\))?\s*(?:is|was|at|=|:|-)?\s*(\d{1,3}(?:\.\d)?)\s*(g\/l|g\/dl|gm|g\b)?/, function (m) { var h = +m[1]; if (/^\s*(?:months?|weeks?|days?|years?|hours?|yrs?|wks?)\b/.test(m.input.slice(m.index + m[0].length))) return null; return /\/l$/.test(m[2] || "") || h > 25 ? h / 10 : h; }, -1))) {
        var hb = +m2[1]; if (/\/l$/.test(m2[2] || "") || hb > 25) hb /= 10; if (hb >= 2 && hb < 10) vital("hemoglobin", m2[0]); }
      if ((m2 = pick(/\binr\b\s*(?:of|is|was|at|=|:|-)?\s*(\d{1,2}(?:\.\d{1,2})?)\b/, V1, 1)) && +m2[1] >= 1.5 && +m2[1] < 20) vital("inr", m2[0]);
      // liver enzymes and ascitic fluid (the findings exist only under smd_kb_v2; consider() drops invalid keys)
      var CONN = "(?:\\s*(?:count|level|levels|value))?\\s*(?:\\([^)\\d]{0,12}\\))?\\s*(?:of|is|was|at|=|:|-|\\()?\\s*";
      if ((m2 = pick(new RegExp("\\b(?:alt|ast|sgpt|sgot|transaminases?)\\b" + CONN + "(\\d+(?:[.,]\\d+)?)"), function (m) { return nv(m[1]); }, 1)) && num(m2[1]) >= 1000) vital("transaminasesVeryHigh", m2[0]);
      if ((m2 = pick(new RegExp("\\b(?:alp|alkaline phosphatase)\\b" + CONN + "(\\d+(?:[.,]\\d+)?)"), function (m) { return nv(m[1]); }, 1)) && num(m2[1]) >= 250) vital("cholestaticLFT", m2[0]);
      if ((m2 = pick(/\bascitic\b[^.;\n]{0,40}?\b(?:pmn|neutrophils?|polymorphs?)\b\s*(?:count)?\s*(?:of|is|was|=|:|-)?\s*(\d+(?:[.,]\d+)?)/, function (m) { return nv(m[1]); }, 1)) && num(m2[1]) >= 250) vital("asciticPMNHigh", m2[0]);
      // durations: fever for >= 7 days -> prolonged fever; an illness of 1 to 8 weeks -> subacute onset
      var WN = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, few: 3, several: 4 };
      var DUR = "(\\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|few|several)\\s*-?\\s*(d|days?|wks?|weeks?|months?)\\b";
      var days = function (n, u) { var v = /^\d/.test(n) ? +n : (WN[n] || 0); return /^w/.test(u) ? v * 7 : /^m/.test(u) ? v * 30 : v; };
      // longest duration a pattern states, and where (negation is then read from that clause)
      var maxDur = function (re) { var best = { d: 0, i: 0, src: "" }, mm; while ((mm = re.exec(norm))) { var dd = days(mm[1], mm[2]); if (dd > best.d) best = { d: dd, i: mm.index, src: mm[0].trim() }; } return best; };
      var fA = maxDur(new RegExp("\\b(?:fever|pyrexia|febrile)\\b[^.;]{0,30}?(?:for|since|x|of|over|past|last)\\s*(?:the\\s*)?(?:past|last)?\\s*" + DUR, "g")),
        fB = maxDur(new RegExp("\\b" + DUR + "\\s*(?:of|history of)\\s*(?:[a-z-]+\\s*){0,2}(?:fever|pyrexia)", "g")), fv = fA.d >= fB.d ? fA : fB;
      // round 13 (v2): the fever later in the same list ("three weeks of worsening headache, low-grade fever and ...");
      // no other number in between, so "3 weeks of cough and 2 days of fever" stays 2 days
      var fC = maxDur(new RegExp("\\b" + DUR + "\\s*(?:of|history of)\\s*[^.;\\d]{0,45}?\\b(?:fever|pyrexia)", "g")); if (fC.d > fv.d) fv = fC;
      if (fv.d >= 7) consider("prolongedFever", fv.i, "compound", fv.src);
      // round 10: a cough of 2 weeks or more (the TB screening threshold); "chronic / persistent cough" says it in words
      var cA = maxDur(new RegExp("\\bcough(?:ing)?\\b[^.;]{0,30}?(?:for|since|x|of|over|past|last)\\s*(?:the\\s*)?(?:past|last)?\\s*(?:about|around|nearly|~)?\\s*" + DUR, "g")),
        cB = maxDur(new RegExp("\\b" + DUR + "\\s*(?:of|history of)\\s*(?:[a-z-]+\\s*){0,3}cough", "g")),
        cC = maxDur(new RegExp("\\bcough\\s*(?:began|started|since)\\s*(?:about|around|nearly|~)?\\s*" + DUR, "g")), cv = [cA, cB, cC].sort(function (x, y) { return y.d - x.d; })[0];
      if (cv.d >= 14) consider("prolongedCough2Weeks", cv.i, "compound", cv.src);
      else if ((m2 = norm.match(/\b(?:chronic|persistent|long-standing|longstanding)\s+(?:(?:dry|productive|non-productive|wet)\s+)?cough\b/))) consider("prolongedCough2Weeks", m2.index, "compound", m2[0]);
      // round 10: bilateral crackles said with words between ("bilateral fine inspiratory crackles")
      if ((m2 = norm.match(/\b(?:bilateral|bibasal|bibasilar|both bases)\b[^.;,]{0,40}?\b(?:crackles|crepitations|creps|crepts|crackle)\b/))) consider("bilateralCrackles", m2.index, "compound", m2[0]);
      // round 10: chest pain or tightness brought on by effort, either order
      if ((m2 = norm.match(/\b(?:chest (?:pain|tightness|heaviness|discomfort)|angina)\b[^.;,]{0,40}?\b(?:exertion|exercise|walking|climbing|stairs|effort)\b|\b(?:on exertion|exertional|while walking|climbing stairs|on climbing)\b[^.;,]{0,40}?\bchest (?:pain|tightness|heaviness|discomfort)\b/))) consider("exertionalChestPain", m2.index, "compound", m2[0]);
      // round 27: pressure-type ischaemic pain ("crushing central chest pain", "retrosternal pressure radiating to the left arm
      // and jaw"): the finding is "Exertional / pressure chest pain". Radiation to the back is left to dissection.
      var pcre = /\b(?:crushing|pressure[- ]like|pressing|squeezing|constricting|vice[- ]like|band[- ]like|heavy)\s+(?:[a-z-]+,?\s+){0,2}?(?:chest|retrosternal|substernal|precordial)\s+(?:pain|discomfort|pressure|heaviness|tightness)\b|\b(?:crushing|pressure[- ]like|squeezing|heavy)\s+(?:pain|discomfort|sensation|feeling|ache)\s+(?:in|over|across|behind)\s+(?:the\s+)?(?:(?:lower|central|left|mid|upper)\s+)?(?:chest|sternum|precordium)\b|\b(?:chest|retrosternal|substernal)\s+(?:heaviness|pressure)\b|\b(?:chest|retrosternal|substernal)\s+(?:pain|discomfort|pressure|heaviness|tightness)\b[^.;]{0,40}?\bradiat\w*\s+(?:in)?to\s+(?:the\s+)?(?:left\s+|both\s+)?(?:arm|arms|jaw)\b/g;
      while ((m2 = pcre.exec(norm))) consider("exertionalChestPain", m2.index, "compound", m2[0]);
      // round 27: polymyalgic girdle pain ("bilateral shoulder and hip girdle pain and stiffness")
      var gdre = /\b(?:shoulder|hip|pelvic)\s+girdles?\b|\b(?:both|bilateral)\s+shoulders?\b[^.;]{0,50}?\b(?:hips?|thighs?)\b/g;
      while ((m2 = gdre.exec(norm))) consider("polyarthralgia", m2.index, "compound", m2[0]);
      // round 11: severe pain in the abdomen, loin or flank said with words between ("severe, boring epigastric pain")
      if ((m2 = norm.match(/\b(?:severe|excruciating|intense|unbearable|agoni[sz]ing|worst)\b[^.;]{0,25}?\b(?:abdominal|epigastric|loin|flank|periumbilical|umbilical|belly|upper abdominal|lower abdominal)\s+(?:pain|colic)\b/))) consider("severeAbdominalPain", m2.index, "compound", m2[0]);
      // round 11: a swollen joint named ("right knee is markedly swollen", "first MTP joint is swollen")
      if ((m2 = norm.match(/\b(?:joint|knee|ankle|wrist|elbow|mtp|toe|shoulder|hip)\b[^.;,]{0,25}?\b(?:swollen|effusion)\b|\b(?:hot|red|swollen)\b[^.;]{0,35}?\b(?:swollen|painful|tender)\s+(?:(?:right|left)\s+)?(?:knee|ankle|wrist|elbow|shoulder|hip|joint)\b/))) consider("jointSwelling", m2.index, "compound", m2[0]);   // round 24: "hot, swollen, painful right knee"
      // round 21: an ulcer named on the foot ("ulcer over the right forefoot", "plantar ulcer")
      var fure = /\bulcers?\b[^.;,]{0,30}?\b(?:foot|feet|forefoot|toe|toes|heel|plantar|metatarsal|sole)\b|\b(?:foot|forefoot|toe|heel|plantar)\s+ulcers?\b/g;
      while ((m2 = fure.exec(norm))) consider("diabeticFootUlcer", m2.index, "compound", m2[0]);   // every mention, as for admission days
      // round 27: one swollen, tender calf said with words between ("right calf is mildly swollen and tender"); every mention
      var ulre = /\b(?:right|left|one|unilateral)\s+(?:calf|leg|lower limb|lower leg|thigh)\b[^.;,]{0,30}?\b(?:swollen|swelling|oedema|edema|oedematous|edematous)\b/g;
      while ((m2 = ulre.exec(norm))) consider("legSwellingUnilateral", m2.index, "compound", m2[0]);
      var ctre = /\bcalf\b[^.;]{0,30}?\btender(?:ness)?\b|\btender(?:ness)?\s+(?:over|in|of)\s+(?:the\s+)?(?:right\s+|left\s+)?calf\b/g;
      while ((m2 = ctre.exec(norm))) consider("calfTenderness", m2.index, "compound", m2[0]);
      // round 27: the overdose scene ("found drowsy beside empty blister packs", "possible sedative co-ingestion", "found
      // unresponsive, a used syringe beside him")
      var odre = /\b(?:empty|emptied)\s+(?:[a-z-]+\s+){0,3}?(?:blisters?|blister packs?|strips?|packets?|pill bottles?|pills|tablets?|medication|medicines?)\b|\bco-?ingestion\b/g, odn = 0;
      while ((m2 = odre.exec(norm))) { consider("drugOverdose", m2.index, "compound", m2[0]); odn++; }
      if (!odn && /\b(?:paraphernalia|syringes?|heroin|fentanyl|opioids?|opiates?)\b/.test(norm)) { var fdre = /\bfound\b[^.;]{0,40}?\b(?:unresponsive|unrousable|unarousable|obtunded|unconscious|slumped|collapsed)\b/g;
        while ((m2 = fdre.exec(norm))) consider("drugOverdose", m2.index, "compound", m2[0]); }
      // round 32: a head strike or a fall said in words ("knocked his head on the sink", "a minor fall backwards"); the
      // bare word "fall" is dropped under v2 ("a fall in blood pressure")
      var hire = /\b(?:knocked|hit|banged|struck|bumped|bashed)\s+(?:his|her|their|the)\s+head\b|\b(?:minor|recent|mechanical|unwitnessed|witnessed|ground-level|a)\s+fall\b(?!\s+(?:in|of)\b)|\bfell\s+(?:down|over|backwards|forwards|from|off|and)\b|\bslipped\s+(?:and|in|on)\b/g;
      while ((m2 = hire.exec(norm))) consider("headInjury", m2.index, "compound", m2[0]);
      // round 33: exudate on the tonsils and tender neck nodes said with words between ("tonsils with bilateral confluent
      // white-yellow exudate"; "tender, enlarged anterior cervical lymph nodes")
      var txre = /\btonsils?\b[^.;]{0,50}?\bexudates?\b|\bexudates?\b[^.;]{0,30}?\btonsils?\b/g;
      // read at the sign word itself, so "tonsils normal, no exudate" takes its "no"
      while ((m2 = txre.exec(norm))) { var xo = m2[0].search(/exudat/); consider("tonsillarExudate", m2.index + (/^tonsil/.test(m2[0]) ? xo : 0), "compound", m2[0]); }
      var tcre = /\btender\b[^.;]{0,30}?\bcervical\s+(?:lymph\s+)?(?:nodes?|lymphadenopathy|glands?)\b|\bcervical\s+(?:lymph\s+)?(?:nodes?|glands?)\b[^.;]{0,20}?\btender\b/g;
      while ((m2 = tcre.exec(norm))) consider("tenderCervicalNodes", m2.index + Math.max(0, m2[0].search(/\btender\b/)), "compound", m2[0]);
      // round 36: pain made worse by breathing said with words between ("worse when she lies flat and on deep inspiration")
      var plre = /\bworse\b[^.;]{0,40}?\bon\s+(?:deep\s+)?(?:inspiration|breathing|a deep breath)\b|\bdeep breaths?\s+(?:hurt|hurts|are painful)\b/g;
      while ((m2 = plre.exec(norm))) { consider("pleuriticChestPain", m2.index, "compound", m2[0]); consider("pleuriticPain", m2.index, "compound", m2[0]); }
      // round 36: several joints named as painful or swollen ("pain and swelling affecting the metacarpophalangeal joints")
      var jre = /\b(pain and swelling|swelling and pain|swelling|pain)\s+(?:affecting|of|in|involving)\s+(?:the\s+)?(?:small\s+joints|metacarpophalangeal|proximal interphalangeal|mcps?|pips?|wrists|hands|fingers|knuckles)\b/g;
      while ((m2 = jre.exec(norm))) { if (/swelling/.test(m2[1])) consider("jointSwelling", m2.index, "compound", m2[0]); if (/pain/.test(m2[1])) consider("polyarthralgia", m2.index, "compound", m2[0]); }
      // round 36: extra doses taken ("took two extra oxycodone doses"); slow shallow breathing
      var xdre = /\btook\s+(?:[a-z0-9-]+\s+){0,2}extra\b|\bextra\s+(?:[a-z-]+\s+){0,2}doses?\b/g;
      while ((m2 = xdre.exec(norm))) consider("drugOverdose", m2.index, "compound", m2[0]);
      var bpre = /\bslow\b[^.;]{0,15}?\b(?:respirat\w*(?:\s+effort)?|breathing|breaths)\b/g;
      while ((m2 = bpre.exec(norm))) consider("bradypnea", m2.index, "compound", m2[0]);
      // round 36: tingling with weakness of both legs is the ascending (Guillain-Barre) picture
      var gbre = /\b(?:tingling|paraesthesi\w*|paresthesi\w*|pins and needles|numbness)\b[^.;]{0,50}?\bweakness\b[^.;]{0,25}?\b(?:both legs|both lower limbs|legs|lower limbs)\b|\b(?:ascending|distal-to-proximal)\s+(?:sensory\s+)?(?:tingling|numbness|weakness)\b/g;
      while ((m2 = gbre.exec(norm))) consider("ascendingWeakness", m2.index, "compound", m2[0]);
      // round 37: coronary history said by event ("prior anterior MI with a drug-eluting stent")
      var cadre = /\b(?:prior|previous|old|known|past)\s+(?:anterior|inferior|lateral|posterior|non-st-elevation|st-elevation)?\s*(?:mi|myocardial infarction|stemi|nstemi)\b|\b(?:drug-eluting|bare-metal)\s+stents?\b|\bcoronary\s+(?:stenting|angioplasty|bypass)\b|\bpci\b/g;
      while ((m2 = cadre.exec(norm))) consider("knownCAD", m2.index, "compound", m2[0]);
      // round 37: "alcohol-related seizures / admissions" is alcohol excess; "alcohol-related cirrhosis" names the cause of the
      // liver disease, not current drinking (read as excess, it put withdrawal above meningitis in a febrile confused cirrhotic)
      var alre = /\balcohol[- ](?:related|induced)\b(?!\s+(?:cirrhosis|liver|hepatitis|chronic liver|cirrhotic))/g;
      while ((m2 = alre.exec(norm))) consider("alcoholExcess", m2.index, "compound", m2[0]);
      // round 39: pain that goes through to the back ("epigastric pain radiating to the back", "boring through to the back")
      var bkre = /\bpain\b[^.;]{0,50}?\b(?:radiat\w*|going|goes|boring|bores|through)\s+(?:(?:in)?to|through)\s+(?:to\s+)?the\s+back\b/g;
      while ((m2 = bkre.exec(norm))) consider("backPain", m2.index, "compound", m2[0]);
      // round 37: sinusitis features (one side, a second worsening, more than 10 days)
      var ufre = /\b(?:right|left|one)[- ]sided\s+(?:facial|maxillary|cheek)\s+pain\b|\b(?:facial|maxillary|cheek)\s+pain\b[^.;]{0,20}?\bon the (?:right|left)\b|\b(?:right|left)\s+(?:maxillary|cheek)\s+pain\b/g;
      while ((m2 = ufre.exec(norm))) consider("unilateralFacialPain", m2.index, "compound", m2[0]);
      var dsre = /\bworsening after (?:an?\s+)?(?:initial\s+)?improvement\b|\b(?:felt|feel|feeling|started to feel|was getting|got)\s+better\b[^.;]{0,60}?\bthen\b[^.;]{0,50}?\bwors\w*|\bdouble sickening\b|\bsecond(?:ary)? worsening\b/g;
      while ((m2 = dsre.exec(norm))) consider("doubleSickening", m2.index, "compound", m2[0]);
      var s10 = /\b(?:facial pain|nasal discharge|nasal congestion|blocked nose|sinus\w*|purulent nasal|rhinorrh\w*)\b[^.;]{0,40}?\bfor\s+(\d{1,2})\s+days\b|\b(\d{1,2})\s+days\s+of\s+(?:[a-z-]+\s+){0,3}(?:facial pain|nasal discharge|nasal congestion|sinus\w*)/g;
      while ((m2 = s10.exec(norm))) if (+(m2[1] || m2[2]) >= 10) consider("symptomsOver10Days", m2.index, "compound", m2[0]);
      // round 37: "severe left-sided headache" (words between); "urine output ... was noticeably reduced"
      var shre = /\b(?:severe|excruciating|intense|unbearable|worst)\b[^.;,]{0,25}?\bheadache\b/g;
      while ((m2 = shre.exec(norm))) consider("headacheSevere", m2.index, "compound", m2[0]);
      var uore = /\burine output\b[^.;]{0,40}?\b(?:reduced|decreased|low|fallen|dropped|declin\w*|poor|diminished)\b/g;
      while ((m2 = uore.exec(norm))) if (!/\b(?:not|no|never)\b/.test(m2[0])) consider("oliguria", m2.index, "compound", m2[0]);   // not "urine output not reduced"
      // round 10: 48 hours or more into a hospital stay (hospital-acquired territory)
      var hdre = /\b(?:admitted|hospitali[sz]ed|intubated|ventilated)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s*days?\s*(?:ago|earlier|previously|before)\b|\b(?:hospital|post-?operative|ward|icu)\s+day\s+(\d{1,2})\b|\bday\s+(\d{1,2})\s+of\s+(?:(?:a|an|the|his|her)\s+)?(?:[a-z-]+\s+){0,2}(?:admission|ventilation|hospital stay|stay)\b/g;
      while ((m2 = hdre.exec(norm))) {   // every mention (round 19): the first may be negated or under 48 h
        var hd = m2[1] ? (WN[m2[1]] || +m2[1]) : +(m2[2] || m2[3]);
        if (hd >= 2) consider("hospitalDay48", m2.index, "compound", m2[0]);
      }
      // the illness's own tempo: the longest stated duration up to 8 weeks (longer = chronic background,
      // e.g. "PSA rising over 6 months", which must not hide "back pain for 3 weeks"). A bare "3 weeks
      // ago" dates an event ("catheter changed 3 weeks ago"); it counts only after an onset word.
      var ill = { d: 0, i: 0, src: "" }, ire = new RegExp("(?:\\b(?:for|since|over|past|last|x)\\s*(?:the\\s*)?(?:past|last)?\\s*" + DUR + ")|(?:\\b" + DUR + "\\s*(?:history|of|duration))" +
        "|(?:\\b(?:started|began|begun|onset|developed|noticed|since)\\s*(?:about|around|nearly|over)?\\s*" + DUR + "\\s*ago)", "g"), im;
      while ((im = ire.exec(norm))) { var idd = im[1] ? days(im[1], im[2]) : im[3] ? days(im[3], im[4]) : days(im[5], im[6]); if (idd <= 56 && idd > ill.d) ill = { d: idd, i: im.index, src: im[0].trim() }; }
      if (ill.d >= 7) consider("subacuteOnset", ill.i, "compound", ill.src);
      // new organ dysfunction (Sepsis-3): any ONE organ at a SOFA-2 threshold, or said in words
      var od = null;
      if ((m2 = pick(/\bbilirubin\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:\.\d+)?)\s*(\u00b5mol|\u03bcmol|umol|mg)?/, function (m) { var b = nv(m[1]); return (m[2] && /mol/.test(m[2])) || b > 25 ? b / 17.1 : b; }, 1))) { var bil = num(m2[1]); if ((m2[2] && /mol/.test(m2[2])) || bil > 25 ? bil >= 34 : bil >= 2) od = od || m2[0]; }
      if ((m2 = pick(/\b(?:creatinine|creat|s\.?\s?cr)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:\.\d+)?)\s*(\u00b5mol|\u03bcmol|umol|mg)?/, CRV, 1)) && !/\b(?:ckd|chronic kidney|dialysis)\b/.test(norm)) {
        var cr2 = num(m2[1]); if ((m2[2] && /mol/.test(m2[2])) || cr2 > 25 ? cr2 >= 177 : cr2 >= 2) od = od || m2[0]; }
      if ((m2 = pick(/\b(?:platelets?|plt|platelet count)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:[.,]\d+)?)\s*(lakhs?|lacs?)?/, PLTV, -1))) { var p2 = num(m2[1]); p2 = m2[2] ? p2 * 100000 : p2 >= 1000 ? p2 : p2 * 1000; if (p2 > 0 && p2 < 100000) od = od || m2[0]; }
      if ((m2 = pick(/\bgcs\s*(?:of|is|was|=|:)?\s*(\d{1,2})\b/, V1, -1)) && +m2[1] >= 3 && +m2[1] <= 12) od = od || m2[0];
      // round 28: every mention, and not one said to be absent ("no organ failure", "before any organ failure")
      var odre = /\b(?:multi-?organ|organ (?:dysfunction|failure)|mods|end-organ|acute kidney injury|aki)\b/g;
      while (!od && (m2 = odre.exec(norm))) if (!/\b(?:no|not|without|nor|before any|prior to any|ahead of any|free of)\s+(?:[a-z-]+\s+){0,2}$/.test(norm.slice(Math.max(0, m2.index - 40), m2.index))) od = m2[0];
      if (od) vital("organDysfunction", od);
    }

    // 5) context per match: negation / uncertainty / temporality (clause-scoped)
    var findings = [], present = [], absent = [], redFlags = [];
    function readCtx(key, e) {
      // classic scoped a vital's negation to the WHOLE note, so one "no cough" anywhere made every
      // abnormal vital "absent"; v2 scopes it to the vital's own clause like every other finding
      var cl = e.method === "vitals" ? (v2 ? clauseAround(raw, Math.max(0, e.idx)) : raw) : clauseAround(norm, e.idx);
      var r = { polarity: "present", certainty: "explicit", temporality: "current", req: false };
      if (v2 && e.method !== "vitals") cl = cl.replace(NEG_IDIOM_V2, " ").replace(RECENT_V2, " ");
      // round 40 (v2): a cue AFTER the finding does not negate it ("fever without rigors", "mild nausea without vomiting",
      // "papilloedema without choroidal tubercles"); what precedes it does, and so do postfix forms ("neck stiffness was
      // not elicited", "calf tenderness: none", "chest pain - denied")
      var negHit, tcl = cl;
      if (v2 && e.method !== "vitals") {
        var cb = clauseBounds(norm, e.idx), sl = (e.srcText || "").length;
        var pre = norm.slice(cb[0], e.idx).replace(NEG_IDIOM_V2, " ").replace(RECENT_V2, " "), post = norm.slice(e.idx + sl, Math.max(cb[1], e.idx + sl)).replace(/^[a-z]*/, "");
        // a later cue other than "without" still reads as before (the clause); "X without Y" never negates X
        var postNoWithout = post.replace(/\bwithout\b.*$/, " ").replace(NEG_IDIOM_V2, " ").replace(RECENT_V2, " ");
        // a past-tense cue after "without" belongs to the other, negated finding ("fever without previous stroke")
        tcl = norm.slice(cb[0], Math.max(cb[1], e.idx + sl)).replace(/\bwithout\b.*$/, " ").replace(NEG_IDIOM_V2, " ").replace(RECENT_V2, " ");
        // a compound may carry its own "not" ("knee not swollen"); only its first clause, as before
        var inner = e.method === "compound" ? norm.slice(e.idx, e.idx + sl).split(/[.,;]| and | with | but | then | however /)[0].replace(NEG_IDIOM_V2, " ") : "";
        negHit = hasWord(pre, NEG) || hasWord(inner, NEG) || POSTFIX_NEG_V2.test(post) || hasWord(postNoWithout, NEG);
      } else negHit = hasWord(cl, NEG);
      // v2: a measured temperature of 38 or more is fever even if "afebrile" appears elsewhere in the note
      if (negHit || (key === "fever" && !(v2 && e.method === "vitals") && hasWord(norm, AFEBRILE))) r.polarity = "absent";
      // round 26: "non-erythematous", "non-tender", "non-productive": a "non-" prefix negates the word it is fused to
      else if (v2 && e.method !== "vitals" && /\bnon[-\s]?$/.test(norm.slice(Math.max(0, e.idx - 4), e.idx))) r.polarity = "absent";
      // round 28: "caught before any organ failure", "prior to any bleeding": not (yet) there
      else if (v2 && e.method !== "vitals" && /\b(?:before|prior to|ahead of)\s+(?:any|the onset of|developing)\s+(?:[a-z-]+\s+){0,2}$/.test(norm.slice(Math.max(0, e.idx - 45), e.idx))) r.polarity = "absent";
      // round 13: "constipation rather than diarrhoea", "instead of fever": the named alternative is absent
      else if (v2 && e.method !== "vitals" && /\b(?:rather than|instead of)\s+(?:[a-z-]+\s+){0,2}$/.test(norm.slice(Math.max(0, e.idx - 40), e.idx))) r.polarity = "absent";
      else if (v2 && e.method !== "vitals" && (negList(norm, e.idx) || negAfter(norm, e.idx + (e.srcText || "").length))) r.polarity = "absent";
      else if (v2 && e.method !== "vitals" && (TEST_AFTER_V2.test(norm.slice(e.idx + (e.srcText || "").length, e.idx + (e.srcText || "").length + 40)) || COND_V2.test(norm.slice(Math.max(0, e.idx - 40), e.idx)))) r.polarity = "uncertain";
      if (hasWord(cl, EXCLUDE)) { r.polarity = "uncertain"; r.certainty = "possible"; r.req = true; }
      else if (hasWord(cl, CONSIDER) || cl.indexOf("?") >= 0) { r.certainty = "possible"; r.req = true; }
      // round 41 (v2): the "old" of an age ("a 30-year-old febrile man", "61-year-old cotton farmer") is not a past-history cue
      if (v2) tcl = tcl.replace(/\b\d{1,3}\s*-?\s*(?:years?|yrs?|yr)[\s-]*old\b/g, " ").replace(/\byear[\s-]old\b/g, " ");
      if (hasWord(tcl, TEMPORAL)) r.temporality = "historical";
      // v2: "a 3-day history of fever" is the PRESENT illness; classic read "history of" as past history
      // and dropped everything in that clause
      if (v2 && r.temporality === "historical" && (PRESENT_HX_V2.test(cl) || PRESENT_BG_V2.test(cl)) && !/\b(?:known case of|past|previous|prior|resolved|status post)\b|(?:^|[^-])\bold\b/.test(cl)) r.temporality = "current";
      // round 14: "clinically improving" / "resolved completely, no residual deficit" IS the finding: resolution and the
      // "no" of "no residual" do not cancel it; only a negation right before it does ("not improving on")
      if (v2 && key === "clinicallyImproving" && e.method !== "vitals") {
        r.polarity = /\b(?:not|no|never|without)\s+(?:[a-z-]+\s+){0,1}$/.test(norm.slice(Math.max(0, e.idx - 20), e.idx)) ? "absent" : "present";
        r.temporality = "current"; r.certainty = "explicit"; r.req = false; return r;
      }
      // round 17: "aspirated" / "aspiration" as a procedure (pus from an abscess, a joint, marrow, a needle-guided tap)
      // is not an aspiration event
      if (v2 && key === "aspirationRiskFactor" && e.method !== "vitals" &&
          /\b(?:pus|abscess|needle|guided|marrow|syringe|ml of|cc of|fna|biopsy|anchovy)\b/.test(norm.slice(Math.max(0, e.idx - 40), e.idx + (e.srcText || "").length + 40))) {
        r.polarity = "uncertain"; r.certainty = "explicit"; return r;
      }
      // round 14: a ketone RESULT below the DKA threshold (3 mmol/L), trace or zero is not ketonaemia
      if (v2 && key === "ketonemia" && e.method !== "vitals") {
        var kv = /^[^.;\d]{0,35}?(\d+(?:\.\d+)?)(\s*\+)?(?!\s*-?\s*(?:d|days?|wks?|weeks?|hours?|hrs?|months?|years?)\b)|^[^.;]{0,35}?\b(trace|nil|negative|absent)\b/.exec(norm.slice(e.idx + (e.srcText || "").length));   // not "for 2 days"
        if (kv && (kv[3] || (kv[1] != null && +kv[1] < 3 && !kv[2]))) r.polarity = "absent";   // "2+" on a dipstick is positive
      }
      if (v2 && hasWord(cl, FAMILY_V2)) r.temporality = "family";   // a relative's condition is not the patient's
      else if (v2 && e.method !== "vitals" && STOPPED_BEFORE_V2.test(norm.slice(Math.max(0, e.idx - 30), e.idx))) r.temporality = "resolved";
      // round 8: "fever settled on day 3" reports a finding that has gone
      else if (v2 && e.method !== "vitals" && RESOLVED_AFTER_V2.test(norm.slice(e.idx + (e.srcText || "").length, e.idx + (e.srcText || "").length + 40))) r.temporality = "resolved";
      // round 27: a sign on its way out ("basal consolidation, resolving", "crackles from resolving infection") or healed is
      // past ("residual" tenderness is still there, round 28)
      else if (v2 && e.method !== "vitals" && (/\bhealed\s+(?:[a-z\/-]+\s+){0,3}$/.test(norm.slice(Math.max(0, e.idx - 40), e.idx)) ||
          /^[^.;]{0,6}(?:,\s*|\s+(?:from|of|due to)\s+(?:a\s+|the\s+)?)resolving\b/.test(norm.slice(e.idx + (e.srcText || "").length, e.idx + (e.srcText || "").length + 40)))) r.temporality = "resolved";
      return r;
    }
    // engine gets it only if present (or a possible finding to consider) AND either current or a background/chronic condition
    function engineOkFor(key, r) {
      return (r.polarity === "present" || (r.polarity === "uncertain" && r.certainty === "possible" && key !== "meningitis")) && (r.temporality !== "historical" || BACKGROUND[key] || (v2 && BACKGROUND_V2[key])) && r.temporality !== "family" && r.temporality !== "resolved" && r.polarity !== "absent";   // "resolved" (v2): gone or stopped, even a background drug
    }
    Object.keys(byKey).forEach(function (key) {
      var e = byKey[key], r = readCtx(key, e);
      // round 8 (v2): the first mention is not the only one. "Denies fever at home ... temp 39.3" or "no
      // fever at onset, now high fever": a later clean, current mention wins over a negated or historical first one.
      if (v2 && !engineOkFor(key, r) && alts[key]) {
        for (var ai = 0; ai < alts[key].length; ai++) {
          var alt = alts[key][ai]; if (alt.idx === e.idx && alt.method === e.method) continue;
          if (alt.method === "synonym" && LAB_VALUE_AFTER_V2.test(norm.slice(alt.idx + alt.srcText.length, alt.idx + alt.srcText.length + 40))) continue;
          var r2 = readCtx(key, alt);
          if (r2.polarity === "present" && engineOkFor(key, r2)) { r = r2; e.idx = alt.idx; e.method = alt.method; e.srcText = alt.srcText; break; }
        }
      }
      var polarity = r.polarity, certainty = r.certainty, temporality = r.temporality, req = r.req;
      if (e._fuzzy) req = true;
      var red = !!(RED_FLAG[key] || e._red);
      var f = { canonicalFindingId: key, displayLabel: e.display, polarity: polarity, temporality: temporality,
        certainty: certainty, sourceText: e.srcText, confidence: e.conf, extractionMethod: e.method === "vitals" ? "deterministic" : "deterministic",
        requiresConfirmation: req, clinicalPriority: red ? "red_flag" : "routine" };
      findings.push(f);
      var engineOk = engineOkFor(key, r);
      if (polarity === "absent") absent.push(key);
      else if (engineOk) { present.push(key); if (red) redFlags.push(key); }
    });

    // 6) demographics (not engine findings — display only)
    var demo = {}, dm;
    // round 19 (metamorphic tests): v2 prefers the explicit age ("64-year-old", "64 yo", "aged 64") and skips a duration
    // ("type 2 diabetes for 18 years", "20 years ago"), which came first in some notes and made the age 18
    if (v2) { var are = /\b(\d{1,3})\s*-?\s*(?:years?|yrs?)[\s-]*old\b|\b(\d{1,3})\s*(?:y\/o|yo|yr old)\b|\baged?\s*(\d{1,3})\b/, am = norm.match(are);
      if (!am) { var yre = /\b(\d{1,3})\s*-?\s*(?:years?|yrs?|yr)\b/g, ym;
        while ((ym = yre.exec(norm))) { var pre = norm.slice(Math.max(0, ym.index - 14), ym.index), post = norm.slice(ym.index + ym[0].length, ym.index + ym[0].length + 14);
          if (!/\b(?:for|since|over|past|last|x|of|about|nearly|almost|diagnosed)\s*$/.test(pre) && !/^\s*(?:ago|history|back|duration|earlier|previously|before)\b/.test(post)) { am = [ym[0], ym[1]]; break; } } }
      if (am) dm = [am[0], am[1] || am[2] || am[3]]; }
    if ((v2 && dm) || (dm = norm.match(v2 ? /\b(\d{1,3})\s*-?\s*(?:year|yr|y\/o|yo|years?)\b/ : /\b(\d{1,3})\s*(?:year|yr|y\/o|yo|years?)\b/)) || (dm = norm.match(/\b(\d{1,3})\s*(?:m|male|f|female)\b/)) ||
        (v2 && (dm = norm.match(/\b(?:m|f)\s*\/\s*(\d{1,3})\b|\b(\d{1,3})\s*\/\s*(?:m|f)\b/)) && (dm = [dm[0], dm[1] || dm[2]]))) { var a = +dm[1]; if (a > 0 && a < 120) demo.age = a; }
    // v2: derived engine findings (age band; fever with urinary symptoms)
    if (v2) {
      var addDerived = function (key, label) { if (valid[key] && present.indexOf(key) < 0 && absent.indexOf(key) < 0) { present.push(key);
        findings.push({ canonicalFindingId: key, displayLabel: label, polarity: "present", temporality: "current", certainty: "explicit", sourceText: "", confidence: 0.8,
          extractionMethod: "deterministic", requiresConfirmation: false, clinicalPriority: "routine" }); } };
      if (demo.age > 50) addDerived("ageOver50", "Age > 50");
      // round 27: CURB-65 of 3 or more in a coughing patient is severe pneumonia (confusion, urea > 7 mmol/L, RR >= 30,
      // SBP < 90 or DBP <= 60, age >= 65). Every part must be stated; a missing value counts as normal. The score is for
      // pneumonia, so the chest must say so (crackles, consolidation); in known COPD only consolidation or the word counts.
      var pna = present.indexOf("consolidation") >= 0 || (/\bpneumonia\b/.test(norm) && !/\b(?:no|not|without|exclud\w*|r\/o|rule out|ruled out|against)\b[^.;]{0,25}\bpneumonia\b|\bpneumonia\b[^.;]{0,20}\b(?:excluded|ruled out|unlikely)\b/.test(norm));
      if (valid.severeCriteria && present.indexOf("cough") >= 0 && (pna || (present.indexOf("crepitations") >= 0 && present.indexOf("knownCOPD") < 0))) {
        var curb = 0, um = pick(/\b(bun|blood urea nitrogen|(?:blood |serum )?urea)\b(?:\s*(?:level|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-)?\s*(\d{1,3}(?:\.\d)?)\s*(mg|mmol)?/,
          function (m) { var u = +m[2], mg = m[3] ? /mg/.test(m[3]) : /bun|nitrogen/.test(m[1]) || u > 40; return mg ? (/bun|nitrogen/.test(m[1]) ? u : u / 2.14) / 2.8 : u; }, 1), rrm = pick(RR_RE, V1, 1);
        if (present.indexOf("alteredSensorium") >= 0) curb++;
        if (um) { var uu = +um[2], umg = um[3] ? /mg/.test(um[3]) : /bun|nitrogen/.test(um[1]) || uu > 40; if ((umg ? (/bun|nitrogen/.test(um[1]) ? uu : uu / 2.14) / 2.8 : uu) > 7) curb++; }
        if (rrm && +rrm[1] >= 30) curb++;
        if (present.indexOf("hypotension") >= 0) curb++;
        if (demo.age >= 65) curb++;
        if (curb >= 3) addDerived("severeCriteria", "Severe pneumonia (CURB-65 " + curb + ")");
      }
      // round 25: with thirst and no burning, "frequent urination" is polyuria (hyperglycaemia), not a bladder symptom
      var fqi = present.indexOf("urinaryFrequency");
      if (fqi >= 0 && valid.polyuriaPolydipsia && present.indexOf("dysuria") < 0 && /\b(?:thirst\w*|polydipsia|polyuria|drinking (?:a lot|large amounts))\b/.test(norm)) {
        present.splice(fqi, 1); if (present.indexOf("polyuriaPolydipsia") < 0) present.push("polyuriaPolydipsia");
        findings.forEach(function (fd) { if (fd.canonicalFindingId === "urinaryFrequency") { fd.canonicalFindingId = "polyuriaPolydipsia"; fd.displayLabel = labels.polyuriaPolydipsia || "Polyuria / polydipsia"; } });
      }
      if (present.indexOf("fever") >= 0 && ["dysuria", "urinaryFrequency", "flankPain", "costovertebralTenderness"].some(function (k) { return present.indexOf(k) >= 0; })) addDerived("feverGU", "Fever with urinary symptoms");
    }
    if (/\b(male|gentleman|\d+\s*m\b|\bm\/\d)/.test(norm)) demo.sex = "male"; else if (/\b(female|lady|woman|\d+\s*f\b|\bf\/\d)/.test(norm)) demo.sex = "female";

    var meaningfulWords = norm.replace(/[^a-z ]/g, " ").split(/\s+/).filter(function (w) { return w.length >= 4; }).length;
    var incomplete = meaningfulWords > 8 && present.length < 2;

    return { findings: findings, present: present, absent: absent, redFlags: redFlags, demographics: demo,
      count: present.length, incomplete: incomplete, meaningfulWords: meaningfulWords };
  }

  var API = { extract: extract, normalize: normalize, _v2: nlpV2, _version: "1.0" };
  if (root) root.SMD_NLP = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
