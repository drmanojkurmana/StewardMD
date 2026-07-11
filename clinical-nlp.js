/* StewardMD - Clinical Narrative → Structured Findings (deterministic NLP layer).
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
  // finding keys that are inherently background/chronic - keep even when phrased historically
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

  function normalize(text) {
    var s = " " + String(text || "").toLowerCase() + " ";
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
  // whole-word cue match - so "no" doesn't fire inside "known"/"now", "old" not inside "cold", etc.
  function hasWord(hay, arr) { for (var i = 0; i < arr.length; i++) { if (new RegExp("(^|[^a-z])" + esc(arr[i]) + "($|[^a-z])").test(hay)) return true; } return false; }

  /* ctx = { valid:{key:1}, labels:{key:label}, syn:{key:[synonyms]} } (from reasoning.js) */
  function extract(text, ctx) {
    ctx = ctx || {}; var valid = ctx.valid || {}, labels = ctx.labels || {}, syn = ctx.syn || {};
    var norm = normalize(text);
    var byKey = {};  // key → { idx, method, srcText, display }

    function consider(key, idx, method, srcText, display) {
      if (!valid[key]) return;
      if (byKey[key] && byKey[key].conf >= 0.9) return;
      byKey[key] = { idx: idx, method: method, srcText: srcText || "", display: display || labels[key] || key,
        conf: method === "synonym" ? 0.95 : method === "vitals" ? 0.9 : method === "compound" ? 0.85 : method === "label" ? 0.82 : 0.65 };
    }

    // 1) compound phrases (highest-signal, may set red flags)
    COMPOUND.forEach(function (c) { var m = c.re.exec(norm); if (m && valid[c.eng]) { consider(c.eng, m.index, "compound", m[0].trim(), c.display); byKey[c.eng]._red = c.red; } });

    // 2) synonym + label match against the engine's own vocabulary
    Object.keys(valid).forEach(function (key) {
      var hitIdx = -1, hitSrc = "";
      (syn[key] || []).forEach(function (sv) { var i = norm.indexOf(sv); if (i >= 0 && (hitIdx < 0 || i < hitIdx)) { hitIdx = i; hitSrc = sv; } });
      if (hitIdx >= 0) { consider(key, hitIdx, "synonym", hitSrc); return; }
      var lab = (labels[key] || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      if (lab.length >= 5 && lab.length <= 26) { var li = norm.indexOf(" " + lab + " "); if (li < 0) li = norm.indexOf(" " + lab + "s "); if (li >= 0) consider(key, li + 1, "label", lab); }
    });

    // 3) fuzzy typo match against synonym vocabulary (safe: distance-gated, confirmation for red flags)
    var tokens = norm.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(function (w) { return w.length >= 6; });
    Object.keys(valid).forEach(function (key) {
      if (byKey[key]) return;
      var best = 99, bestSrc = "";
      (syn[key] || []).forEach(function (sv) { if (sv.indexOf(" ") >= 0 || sv.length < 6) return; tokens.forEach(function (tk) { var d = lev(tk, sv); if (d < best) { best = d; bestSrc = tk; } }); });
      var thresh = bestSrc.length >= 9 ? 2 : 1;
      if (best <= thresh) { var idx = norm.indexOf(bestSrc); consider(key, idx < 0 ? 0 : idx, "fuzzy", bestSrc); if (byKey[key]) byKey[key]._fuzzy = true; }
    });

    // 4) numeric vitals → findings (uses raw text; punctuation like "/" and "%" preserved)
    var raw = " " + String(text || "").toLowerCase() + " ", m2;
    function vital(key, src) { consider(key, (raw.indexOf(src) || 0), "vitals", src); }
    if ((m2 = raw.match(/(\d{2,3})\s*\/\s*(\d{2,3})/))) { var sys = +m2[1], dia = +m2[2]; if (sys >= 60 && sys <= 300 && dia >= 30 && dia <= 200) { if (sys >= 140 || dia >= 90) { vital("hypertensionHx", m2[0]); if (byKey.hypertensionHx) byKey.hypertensionHx.display = (sys >= 180 || dia >= 120 ? "Severe hypertension (BP " : "Hypertension (BP ") + sys + "/" + dia + ")"; } else if (sys < 90 || dia < 60) vital("hypotension", m2[0]); } }
    if ((m2 = raw.match(/\b(?:spo2|sao2|sats?|saturation|saturating)\s*(?:at|of|is|=|:)?\s*(\d{2,3})\s*%?/))) { if (+m2[1] <= 100 && +m2[1] < 92) vital("hypoxia", m2[0]); }
    if ((m2 = raw.match(/\b(?:hr|heart rate|pulse|pr)\s*(?:of|is|=|:)?\s*(\d{2,3})\b/))) { if (+m2[1] > 100) vital("tachycardia", m2[0]); else if (+m2[1] < 60 && +m2[1] > 20) vital("bradycardia", m2[0]); }
    if ((m2 = raw.match(/\b(?:rr|resp(?:iratory)? rate)\s*(?:of|is|=|:)?\s*(\d{1,2})\b/))) { if (+m2[1] > 22) vital("tachypnea", m2[0]); else if (+m2[1] < 10) vital("bradypnea", m2[0]); }
    if ((m2 = raw.match(/\bgcs\s*(?:of|is|=|:)?\s*(?:e\d\s*v\d\s*m\d|\d{1,2})(?:\s*\/\s*15)?/))) { var g = (m2[0].match(/(\d{1,2})\s*\/\s*15/) || [])[1] || (m2[0].match(/\d{1,2}/) || [])[0]; if (g && +g < 15 && +g >= 3) vital("alteredSensorium", m2[0]); }
    if ((m2 = raw.match(/\b(?:temp(?:erature)?|febrile at)\s*(?:of|is|=|:)?\s*(\d{2,3}(?:\.\d)?)\s*(?:c|celsius|f|fahrenheit|°|deg)/))) { var tv = +m2[1]; if ((tv >= 38 && tv <= 44) || (tv >= 100 && tv <= 110)) vital("fever", m2[0]); else if (tv > 0 && tv < 35) vital("hypothermia", m2[0]); }

    // 5) context per match: negation / uncertainty / temporality (clause-scoped)
    var findings = [], present = [], absent = [], redFlags = [];
    Object.keys(byKey).forEach(function (key) {
      var e = byKey[key], cl = e.method === "vitals" ? raw : clauseAround(norm, e.idx);
      var polarity = "present", certainty = "explicit", temporality = "current", req = false;
      if (hasWord(cl, NEG) || (key === "fever" && hasWord(norm, AFEBRILE))) polarity = "absent";
      if (hasWord(cl, EXCLUDE)) { polarity = "uncertain"; certainty = "possible"; req = true; }
      else if (hasWord(cl, CONSIDER) || cl.indexOf("?") >= 0) { certainty = "possible"; req = true; }
      if (hasWord(cl, TEMPORAL)) temporality = "historical";
      if (e._fuzzy) req = true;
      var red = !!(RED_FLAG[key] || e._red);
      var f = { canonicalFindingId: key, displayLabel: e.display, polarity: polarity, temporality: temporality,
        certainty: certainty, sourceText: e.srcText, confidence: e.conf, extractionMethod: e.method === "vitals" ? "deterministic" : "deterministic",
        requiresConfirmation: req, clinicalPriority: red ? "red_flag" : "routine" };
      findings.push(f);
      // engine gets it only if present (or a possible finding to consider) AND either current or a background/chronic condition
      var engineOk = (polarity === "present" || (polarity === "uncertain" && certainty === "possible" && key !== "meningitis")) && (temporality !== "historical" || BACKGROUND[key]) && polarity !== "absent";
      if (polarity === "absent") absent.push(key);
      else if (engineOk) { present.push(key); if (red) redFlags.push(key); }
    });

    // 6) demographics (not engine findings - display only)
    var demo = {}, dm;
    if ((dm = norm.match(/\b(\d{1,3})\s*(?:year|yr|y\/o|yo|years?)\b/)) || (dm = norm.match(/\b(\d{1,3})\s*(?:m|male|f|female)\b/))) { var a = +dm[1]; if (a > 0 && a < 120) demo.age = a; }
    if (/\b(male|gentleman|\d+\s*m\b|\bm\/\d)/.test(norm)) demo.sex = "male"; else if (/\b(female|lady|woman|\d+\s*f\b|\bf\/\d)/.test(norm)) demo.sex = "female";

    var meaningfulWords = norm.replace(/[^a-z ]/g, " ").split(/\s+/).filter(function (w) { return w.length >= 4; }).length;
    var incomplete = meaningfulWords > 8 && present.length < 2;

    return { findings: findings, present: present, absent: absent, redFlags: redFlags, demographics: demo,
      count: present.length, incomplete: incomplete, meaningfulWords: meaningfulWords };
  }

  var API = { extract: extract, normalize: normalize, _version: "1.0" };
  if (root) root.SMD_NLP = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
