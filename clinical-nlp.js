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
  var PRE_V2 = [[/\bcva\s*(?:angle\s*)?tender(?:ness)?\b/g, "costovertebral angle tenderness"], [/\bcva\s*angle\b/g, "costovertebral angle"]];
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
  var NEG_IDIOM_V2 = /\b(?:not|no|without)\s+(?:(?:been|yet|fully|much|any)\s+)?(?:responding|responded|response|responsive|improving|improved|improvement|settling|settled|resolving|resolved|resolution|relieved|relief|relieving|subsiding|subsided|better|controlled|reducing|reduced|abating|abated|remitting)\b/g;
  // v2 numeric thresholds (clinical definitions, chosen on the train/dev split: see PLAN-DX-ABX-10.md)
  var LAB_V2 = { lactate: 2, plateletsLow: 150000, creatinineMgDl: 1.5, creatinineUmol: 133 };
  // explicit family-history phrasing only: "mother reports high fever" (a child's note) is the patient's fever
  var FAMILY_V2 = ["family history", "family h/o", "mother had", "father had", "mother has", "father has", "mother died", "father died",
    "brother had", "sister had", "sibling had", "runs in the family", "in the family"];
  // v2: background conditions kept even when phrased historically ("known cirrhosis", "h/o stroke")
  var BACKGROUND_V2 = { liverDisease: 1, cerebrovascularDisease: 1, malignancy: 1, immunocompromised: 1, anticoagulated: 1,
    nursingHomeResident: 1, hospitalizationLast90Days: 1, antibioticsLast90Days: 1, priorAntibiotics: 1, steroidUse: 1, knownCKD: 1 };

  function normalize(text, v2) {
    var s = " " + String(text || "").toLowerCase() + " ";
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

  // v2: "no fever, cough, dysuria or diarrhoea" negates every short item of the list, not just the first.
  var LIST_STOP_V2 = /\b(?:but|however|with|then|presents?|presented|has|had|reports?|complains?|noted|developed|now|since|for)\b/;
  // Guards: a head that is a complete idiom negates nothing ("no known allergies, fever and chills"; "no
  // significant history, cough for 3 days"), and a later item that states a duration turns the list into
  // a positive statement ("no vomiting, fever and cough for 3 days").
  var LIST_HEAD_SKIP_V2 = /\b(?:allerg\w*|comorbid\w*|addictions?|complaints?|significant)\b|\bhistory\s*$/;
  var LIST_DUR_V2 = /\b(?:for|since|x|over)\s+(?:the\s+)?(?:\d|a |an |one|two|three|four|five|six|seven|few|several|past|last)|\b\d+\s*(?:d|days?|wks?|weeks?|hours?|hrs?|months?)\b/;
  function negList(norm, idx) {
    var st = Math.max(norm.lastIndexOf(".", idx - 1), norm.lastIndexOf(";", idx - 1), norm.lastIndexOf(":", idx - 1)) + 1;
    var en = norm.slice(idx).search(/[.,;:]| and | or | nor /), segs = norm.slice(st, en < 0 ? norm.length : idx + en).split(/,| and | or | nor /);
    if (segs.length < 2 || !/^\s*(?:(?:he|she|they|patient|the patient|pt|mother|father|family)\s+(?:also\s+)?)?(?:no|denies|denied|without|nil|negative for|not)\b/.test(segs[0]) || LIST_HEAD_SKIP_V2.test(segs[0]) || segs[0].replace(NEG_IDIOM_V2, "") !== segs[0]) return false;
    for (var i = 1; i < segs.length; i++) { var w = segs[i].trim().split(/\s+/).filter(Boolean); if (w.length > 3 || LIST_STOP_V2.test(segs[i])) return false; }
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

    function consider(key, idx, method, srcText, display) {
      if (!valid[key]) return;
      if (v2) (alts[key] = alts[key] || []).push({ idx: idx, method: method, srcText: srcText || "" });
      if (byKey[key] && byKey[key].conf >= 0.9) return;
      byKey[key] = { idx: idx, method: method, srcText: srcText || "", display: display || labels[key] || key,
        conf: method === "synonym" ? 0.95 : method === "vitals" ? 0.9 : method === "compound" ? 0.85 : method === "label" ? 0.82 : 0.65 };
    }

    // 1) compound phrases (highest-signal, may set red flags)
    COMPOUND.forEach(function (c) { var m = c.re.exec(norm); if (m && valid[c.eng]) { consider(c.eng, m.index, "compound", m[0].trim(), c.display); byKey[c.eng]._red = c.red; } });

    // 2) synonym + label match against the engine's own vocabulary
    Object.keys(valid).forEach(function (key) {
      if (v2 && numeric[key]) return;   // v2: a bare "platelets" / "weight" is a lab name, not a finding
      var hitIdx = -1, hitSrc = "";
      (syn[key] || []).forEach(function (sv) { var i = v2 ? findWord(norm, sv) : norm.indexOf(sv); if (i >= 0 && (hitIdx < 0 || i < hitIdx)) { hitIdx = i; hitSrc = sv; } });
      if (hitIdx >= 0) {
        consider(key, hitIdx, "synonym", hitSrc);
        // v2: later mentions of the same finding, so a negated first one does not hide them
        if (v2) (syn[key] || []).forEach(function (sv) { var from = 0, j, n = 0;
          while (n++ < 6 && (j = findWord(norm.slice(from), sv)) >= 0) { j += from; if (j !== hitIdx) alts[key].push({ idx: j, method: "synonym", srcText: sv }); from = j + sv.length; } });
        return;
      }
      var lab = (labels[key] || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      if (lab.length >= 5 && lab.length <= 26) { var li = norm.indexOf(" " + lab + " "); if (li < 0) li = norm.indexOf(" " + lab + "s "); if (li >= 0) consider(key, li + 1, "label", lab); }
    });

    // 3) fuzzy typo match against synonym vocabulary (safe: distance-gated, confirmation for red flags)
    var tokens = norm.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(function (w) { return w.length >= 6; });
    Object.keys(valid).forEach(function (key) {
      if (byKey[key] || (v2 && numeric[key])) return;
      var best = 99, bestSrc = "";
      (syn[key] || []).forEach(function (sv) { if (sv.indexOf(" ") >= 0 || sv.length < 6) return; tokens.forEach(function (tk) { var d = lev(tk, sv); if (d < best) { best = d; bestSrc = tk; } }); });
      var thresh = bestSrc.length >= 9 ? 2 : 1;
      if (best <= thresh) { var idx = norm.indexOf(bestSrc); consider(key, idx < 0 ? 0 : idx, "fuzzy", bestSrc); if (byKey[key]) byKey[key]._fuzzy = true; }
    });

    // 4) numeric vitals → findings (uses raw text; punctuation like "/" and "%" preserved)
    var raw = " " + String(text || "").toLowerCase() + " ", m2;
    function vital(key, src) { consider(key, (raw.indexOf(src) || 0), "vitals", src); }
    // v2: a labelled BP wins, else the first PLAUSIBLE x/y (classic took the first x/y, so "GCS 13/15" hid the BP)
    if (v2) { m2 = raw.match(/\b(?:bp|blood pressure|b\.p\.?)\s*(?:of|is|was|=|:|-)?\s*(\d{2,3})\s*\/\s*(\d{2,3})/);
      if (!m2) { var bre = /(\d{2,3})\s*\/\s*(\d{2,3})/g, bm; while ((bm = bre.exec(raw))) { if (+bm[1] >= 60 && +bm[1] <= 300 && +bm[2] >= 30 && +bm[2] <= 200) { m2 = bm; break; } } } }
    else m2 = raw.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    if (m2) { var sys = +m2[1], dia = +m2[2]; if (sys >= 60 && sys <= 300 && dia >= 30 && dia <= 200) { if (sys >= 140 || dia >= 90) { vital("hypertensionHx", m2[0]); if (byKey.hypertensionHx) byKey.hypertensionHx.display = (sys >= 180 || dia >= 120 ? "Severe hypertension (BP " : "Hypertension (BP ") + sys + "/" + dia + ")"; } else if (sys < 90 || dia < 60) vital("hypotension", m2[0]); } }
    if ((m2 = raw.match(/\b(?:spo2|sao2|sats?|saturation|saturating)\s*(?:at|of|is|=|:)?\s*(\d{2,3})\s*%?/))) { if (+m2[1] <= 100 && +m2[1] < 92) vital("hypoxia", m2[0]); }
    if ((m2 = raw.match(v2 ? /\b(?:hr|heart rate|pulse(?: rate)?)\s*(?:of|is|was|=|:|-)?\s*(\d{2,3})\b/ : /\b(?:hr|heart rate|pulse|pr)\s*(?:of|is|=|:)?\s*(\d{2,3})\b/))) { if (+m2[1] > 100) vital("tachycardia", m2[0]); else if (+m2[1] < 60 && +m2[1] > 20) vital("bradycardia", m2[0]); }
    if ((m2 = raw.match(/\b(?:rr|resp(?:iratory)? rate)\s*(?:of|is|=|:)?\s*(\d{1,2})\b/))) { if (+m2[1] > 22) vital("tachypnea", m2[0]); else if (+m2[1] < 10) vital("bradypnea", m2[0]); }
    if ((m2 = raw.match(/\bgcs\s*(?:of|is|=|:)?\s*(?:e\d\s*v\d\s*m\d|\d{1,2})(?:\s*\/\s*15)?/))) { var g = (m2[0].match(/(\d{1,2})\s*\/\s*15/) || [])[1] || (m2[0].match(/\d{1,2}/) || [])[0]; if (g && +g < 15 && +g >= 3) vital("alteredSensorium", m2[0]); }
    if ((m2 = raw.match(v2 ? /\b(?:temp(?:erature)?|febrile at)\s*(?:of|is|was|=|:|-)?\s*(\d{2,3}(?:\.\d)?)\s*(?:°\s*[cf]?|c\b|celsius|f\b|fahrenheit|deg)?/ : /\b(?:temp(?:erature)?|febrile at)\s*(?:of|is|=|:)?\s*(\d{2,3}(?:\.\d)?)\s*(?:c|celsius|f|fahrenheit|°|deg)/))) { var tv = +m2[1]; if ((tv >= 38 && tv <= 44) || (tv >= 100 && tv <= 110)) vital("fever", m2[0]); else if (tv > 0 && tv < 35) vital("hypothermia", m2[0]); }

    // 4b) v2: numeric labs, MAP and durations -> findings
    if (v2) {
      var num = function (x) { return parseFloat(String(x).replace(/,/g, "")); };
      if ((m2 = raw.match(/\bmap\s*(?:of|is|was|=|:|-)?\s*(\d{2,3})\b/)) && +m2[1] < 65 && +m2[1] >= 20) vital("hypotension", m2[0]);
      if ((m2 = raw.match(/\b(?:lactate|lactic acid)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:\.\d+)?)\s*(mg)?/))) {
        var lac = num(m2[1]) / (m2[2] ? 9 : 1);                          // mg/dL -> mmol/L
        if (lac >= LAB_V2.lactate && lac < 40) vital("lactateElevated", m2[0]);
      }
      if ((m2 = raw.match(/\b(?:anc|absolute neutrophil(?:s| count)?)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:[.,]\d+)?)/))) {
        var anc = num(m2[1]); if (anc < 50) anc *= 1000;                  // 0.3 (x10^9/L) -> 300/uL
        if (anc < 500) vital("neutropenia", m2[0]); if (anc < 100) vital("absoluteNeutrophilCountLow", m2[0]);
      }
      if ((m2 = raw.match(/\b(?:platelets?|plt|platelet count)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:[.,]\d+)?)\s*(lakhs?|lacs?)?/))) {
        var plt = num(m2[1]); plt = m2[2] ? plt * 100000 : plt >= 1000 ? plt : plt * 1000;
        if (plt > 0 && plt < LAB_V2.plateletsLow) vital("thrombocytopenia", m2[0]);
      }
      if ((m2 = raw.match(/\b(?:creatinine|creat|s\.?\s?cr)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:\.\d+)?)\s*(\u00b5mol|\u03bcmol|umol|mg)?/))) {
        var cr = num(m2[1]), umol = (m2[2] && /mol/.test(m2[2])) || cr > 25;
        if (umol ? cr >= LAB_V2.creatinineUmol : cr >= LAB_V2.creatinineMgDl) vital("renalImpairment", m2[0]);
      }
      // liver enzymes and ascitic fluid (the findings exist only under smd_kb_v2; consider() drops invalid keys)
      var CONN = "(?:\\s*(?:count|level|levels|value))?\\s*(?:\\([^)\\d]{0,12}\\))?\\s*(?:of|is|was|at|=|:|-|\\()?\\s*";
      if ((m2 = raw.match(new RegExp("\\b(?:alt|ast|sgpt|sgot|transaminases?)\\b" + CONN + "(\\d+(?:[.,]\\d+)?)"))) && num(m2[1]) >= 1000) vital("transaminasesVeryHigh", m2[0]);
      if ((m2 = raw.match(new RegExp("\\b(?:alp|alkaline phosphatase)\\b" + CONN + "(\\d+(?:[.,]\\d+)?)"))) && num(m2[1]) >= 250) vital("cholestaticLFT", m2[0]);
      if ((m2 = raw.match(/\bascitic\b[^.;\n]{0,40}?\b(?:pmn|neutrophils?|polymorphs?)\b\s*(?:count)?\s*(?:of|is|was|=|:|-)?\s*(\d+(?:[.,]\d+)?)/)) && num(m2[1]) >= 250) vital("asciticPMNHigh", m2[0]);
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
      // round 11: severe pain in the abdomen, loin or flank said with words between ("severe, boring epigastric pain")
      if ((m2 = norm.match(/\b(?:severe|excruciating|intense|unbearable|agoni[sz]ing|worst)\b[^.;]{0,25}?\b(?:abdominal|epigastric|loin|flank|periumbilical|umbilical|belly|upper abdominal|lower abdominal)\s+(?:pain|colic)\b/))) consider("severeAbdominalPain", m2.index, "compound", m2[0]);
      // round 11: a swollen joint named ("right knee is markedly swollen", "first MTP joint is swollen")
      if ((m2 = norm.match(/\b(?:joint|knee|ankle|wrist|elbow|mtp|toe|shoulder|hip)\b[^.;,]{0,25}?\b(?:swollen|effusion)\b/))) consider("jointSwelling", m2.index, "compound", m2[0]);
      // round 10: 48 hours or more into a hospital stay (hospital-acquired territory)
      if ((m2 = norm.match(/\b(?:admitted|hospitali[sz]ed|intubated|ventilated)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s*days?\s*(?:ago|earlier|previously|before)\b|\b(?:hospital|post-?operative|ward|icu)\s+day\s+(\d{1,2})\b|\bday\s+(\d{1,2})\s+of\s+(?:(?:a|an|the|his|her)\s+)?(?:[a-z-]+\s+){0,2}(?:admission|ventilation|hospital stay|stay)\b/))) {
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
      if ((m2 = raw.match(/\bbilirubin\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:\.\d+)?)\s*(\u00b5mol|\u03bcmol|umol|mg)?/))) { var bil = num(m2[1]); if ((m2[2] && /mol/.test(m2[2])) || bil > 25 ? bil >= 34 : bil >= 2) od = od || m2[0]; }
      if ((m2 = raw.match(/\b(?:creatinine|creat|s\.?\s?cr)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:\.\d+)?)\s*(\u00b5mol|\u03bcmol|umol|mg)?/)) && !/\b(?:ckd|chronic kidney|dialysis)\b/.test(norm)) {
        var cr2 = num(m2[1]); if ((m2[2] && /mol/.test(m2[2])) || cr2 > 25 ? cr2 >= 177 : cr2 >= 2) od = od || m2[0]; }
      if ((m2 = raw.match(/\b(?:platelets?|plt|platelet count)\b(?:\s*(?:count|level|levels|value))?\s*(?:\([^)\d]{0,12}\))?\s*(?:of|is|was|at|=|:|-|\()?\s*(\d+(?:[.,]\d+)?)\s*(lakhs?|lacs?)?/))) { var p2 = num(m2[1]); p2 = m2[2] ? p2 * 100000 : p2 >= 1000 ? p2 : p2 * 1000; if (p2 > 0 && p2 < 100000) od = od || m2[0]; }
      if ((m2 = raw.match(/\bgcs\s*(?:of|is|was|=|:)?\s*(\d{1,2})\b/)) && +m2[1] >= 3 && +m2[1] <= 12) od = od || m2[0];
      if ((m2 = norm.match(/\b(?:multi-?organ|organ (?:dysfunction|failure)|mods|end-organ|acute kidney injury|aki)\b/))) od = od || m2[0];
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
      // v2: a measured temperature of 38 or more is fever even if "afebrile" appears elsewhere in the note
      if (hasWord(cl, NEG) || (key === "fever" && !(v2 && e.method === "vitals") && hasWord(norm, AFEBRILE))) r.polarity = "absent";
      // round 13: "constipation rather than diarrhoea", "instead of fever": the named alternative is absent
      else if (v2 && e.method !== "vitals" && /\b(?:rather than|instead of)\s+(?:[a-z-]+\s+){0,2}$/.test(norm.slice(Math.max(0, e.idx - 40), e.idx))) r.polarity = "absent";
      else if (v2 && e.method !== "vitals" && (negList(norm, e.idx) || negAfter(norm, e.idx + (e.srcText || "").length))) r.polarity = "absent";
      else if (v2 && e.method !== "vitals" && (TEST_AFTER_V2.test(norm.slice(e.idx + (e.srcText || "").length, e.idx + (e.srcText || "").length + 40)) || COND_V2.test(norm.slice(Math.max(0, e.idx - 40), e.idx)))) r.polarity = "uncertain";
      if (hasWord(cl, EXCLUDE)) { r.polarity = "uncertain"; r.certainty = "possible"; r.req = true; }
      else if (hasWord(cl, CONSIDER) || cl.indexOf("?") >= 0) { r.certainty = "possible"; r.req = true; }
      if (hasWord(cl, TEMPORAL)) r.temporality = "historical";
      // v2: "a 3-day history of fever" is the PRESENT illness; classic read "history of" as past history
      // and dropped everything in that clause
      if (v2 && r.temporality === "historical" && (PRESENT_HX_V2.test(cl) || PRESENT_BG_V2.test(cl)) && !/\b(?:known case of|past|previous|prior|resolved|status post)\b|(?:^|[^-])\bold\b/.test(cl)) r.temporality = "current";
      // round 14: "clinically improving" / "resolved completely, no residual deficit" IS the finding: resolution and the
      // "no" of "no residual" do not cancel it; only a negation right before it does ("not improving on")
      if (v2 && key === "clinicallyImproving" && e.method !== "vitals") {
        r.polarity = /\b(?:not|no|never|without)\s+(?:[a-z-]+\s+){0,1}$/.test(norm.slice(Math.max(0, e.idx - 20), e.idx)) ? "absent" : "present";
        r.temporality = "current"; r.certainty = "explicit"; r.req = false; return r;
      }
      // round 14: a ketone RESULT below the DKA threshold (3 mmol/L), trace or zero is not ketonaemia
      if (v2 && key === "ketonemia" && e.method !== "vitals") {
        var kv = /^[^.;\d]{0,35}?(\d+(?:\.\d+)?)(\s*\+)?|^[^.;]{0,35}?\b(trace|nil|negative|absent)\b/.exec(norm.slice(e.idx + (e.srcText || "").length));
        if (kv && (kv[3] || (kv[1] != null && +kv[1] < 3 && !kv[2]))) r.polarity = "absent";   // "2+" on a dipstick is positive
      }
      if (v2 && hasWord(cl, FAMILY_V2)) r.temporality = "family";   // a relative's condition is not the patient's
      else if (v2 && e.method !== "vitals" && STOPPED_BEFORE_V2.test(norm.slice(Math.max(0, e.idx - 30), e.idx))) r.temporality = "resolved";
      // round 8: "fever settled on day 3" reports a finding that has gone
      else if (v2 && e.method !== "vitals" && RESOLVED_AFTER_V2.test(norm.slice(e.idx + (e.srcText || "").length, e.idx + (e.srcText || "").length + 40))) r.temporality = "resolved";
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
    if ((dm = norm.match(v2 ? /\b(\d{1,3})\s*-?\s*(?:year|yr|y\/o|yo|years?)\b/ : /\b(\d{1,3})\s*(?:year|yr|y\/o|yo|years?)\b/)) || (dm = norm.match(/\b(\d{1,3})\s*(?:m|male|f|female)\b/)) ||
        (v2 && (dm = norm.match(/\b(?:m|f)\s*\/\s*(\d{1,3})\b|\b(\d{1,3})\s*\/\s*(?:m|f)\b/)) && (dm = [dm[0], dm[1] || dm[2]]))) { var a = +dm[1]; if (a > 0 && a < 120) demo.age = a; }
    // v2: derived engine findings (age band; fever with urinary symptoms)
    if (v2) {
      var addDerived = function (key, label) { if (valid[key] && present.indexOf(key) < 0 && absent.indexOf(key) < 0) { present.push(key);
        findings.push({ canonicalFindingId: key, displayLabel: label, polarity: "present", temporality: "current", certainty: "explicit", sourceText: "", confidence: 0.8,
          extractionMethod: "deterministic", requiresConfirmation: false, clinicalPriority: "routine" }); } };
      if (demo.age > 50) addDerived("ageOver50", "Age > 50");
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
