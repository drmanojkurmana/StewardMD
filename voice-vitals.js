/* StewardMD — Deterministic vitals + exam-phrase extractor (voice → assessment fields).
 * ---------------------------------------------------------------------------
 * Zero-token, no-network, no-LLM. Turns explicitly-spoken numbers and stereotyped clinical
 * exam phrases into structured records targeting assessment-schema field ids. This is the
 * FIRST-PASS layer of the ambient pipeline; the LLM (/api/ai/extract) only handles the
 * complex narrative this layer can't. It NEVER invents a value it did not hear.
 *
 * extract(text) → [ { field, value, srcText, confidence } ]
 *   field  = an assessment-schema field id (temp, bpSys, tenderness, pallor, …)
 *   value  = number | enum-string | boolean
 *   Records are candidates; voice-emr-map.js applies speaker/conflict/override gating.
 *
 * window.SMD_VVITALS + module.exports (Node-testable). Reuses SMD_NLP.normalize when present.
 */
(function (root) {
  "use strict";

  // reuse the clinical normalizer (abbrev + spelling) if it's loaded; else a light fallback
  var NLP = (root && root.SMD_NLP) ||
    (typeof module !== "undefined" && typeof require !== "undefined" ? tryReq() : null);
  function tryReq() { try { return require("./clinical-nlp.js"); } catch (e) { return null; } }
  function norm(t) { return NLP && NLP.normalize ? NLP.normalize(t) : (" " + String(t || "").toLowerCase() + " "); }

  function num(x) { return parseFloat(x); }
  function inRange(v, lo, hi) { return v >= lo && v <= hi; }

  // ── spoken numbers -> digits, so "BP one twenty by eighty, pulse eighty eight" fills like the
  // digit form. SAFE by construction: this only exposes digits; a vital is still only extracted when
  // a cue word (bp/pulse/temp/...) sits next to it, so a stray conversion elsewhere invents nothing.
  var ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  var TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  function parseNumber(t, i) {
    function c(k) { return k < t.length ? String(t[k] || "").replace(/[.,;:!?]+$/, "") : ""; }
    var w = c(i), start = i, value, hundredBase = false;
    if ((w === "a" || w === "an") && c(i + 1) === "hundred") { value = 100; i += 2; hundredBase = true; }
    else if (w in ONES && c(i + 1) === "hundred") { value = ONES[w] * 100; i += 2; hundredBase = true; }
    else if (w === "hundred") { value = 100; i += 1; hundredBase = true; }
    else if (w in ONES && c(i + 1) in TENS) { value = ONES[w] * 100 + TENS[c(i + 1)]; i += 2; if (c(i) in ONES) { value += ONES[c(i)]; i += 1; } }   // colloquial "one twenty [five]" = 120/125
    else if (w in ONES && c(i + 1) in TEENS) { value = ONES[w] * 100 + TEENS[c(i + 1)]; i += 2; }   // colloquial "one ten/one fifteen" = 110/115
    else if (w in TENS) { value = TENS[w]; i += 1; if (c(i) in ONES) { value += ONES[c(i)]; i += 1; } }
    else if (w in TEENS) { value = TEENS[w]; i += 1; }
    else if (w in ONES) { value = ONES[w]; i += 1; }
    else return null;
    if (hundredBase) { if (c(i) === "and") i += 1; var w2 = c(i);
      if (w2 in TENS) { value += TENS[w2]; i += 1; if (c(i) in ONES) { value += ONES[c(i)]; i += 1; } }
      else if (w2 in TEENS) { value += TEENS[w2]; i += 1; }
      else if (w2 in ONES) { value += ONES[w2]; i += 1; } }
    if (c(i) === "point") { var dec = "", k = i + 1, any = false; while (c(k) in ONES) { dec += String(ONES[c(k)]); k++; any = true; } if (any) { value = parseFloat(value + "." + dec); i = k; } }
    return { value: value, end: i, took: i - start };
  }
  function wordsToNumbers(text) {
    var orig = String(text == null ? "" : text).split(/\s+/), lc = orig.map(function (t) { return t.toLowerCase(); });
    var out = [], i = 0;
    while (i < orig.length) {
      var r = parseNumber(lc, i);
      if (r && r.value != null && r.took > 0) { out.push(String(r.value)); i = r.end; }
      else { out.push(orig[i]); i++; }
    }
    return out.join(" ");
  }

  // ── clause-scoped negation (so "no pallor" ≠ pallor; cue must sit in the SAME clause) ──
  var NEG = /(^|[^a-z])(no|not|without|nil|denies|denied|absent|free of|negative for|n\/a)([^a-z]|$)/;
  function clauses(n) { return n.split(/[.,;]| and | with | but | who /); }
  // is `term` present in a clause, and if so is that clause negated (before the term)?
  // returns true (present+affirmed) / false (present+negated) / undefined (not mentioned)
  function signed(n, terms) {
    var cls = clauses(n), i, j, cl, idx;
    for (i = 0; i < cls.length; i++) {
      cl = cls[i];
      for (j = 0; j < terms.length; j++) {
        idx = cl.indexOf(terms[j]);
        if (idx >= 0) { return !NEG.test(cl.slice(0, idx + terms[j].length)); }
      }
    }
    return undefined;
  }

  function extract(text) {
    text = wordsToNumbers(text);                       // "pulse eighty eight" -> "pulse 88" before the digit regexes run
    var raw = " " + String(text || "").toLowerCase() + " ";
    var n = norm(text);
    var out = [], m;
    function push(field, value, srcText, conf) { out.push({ field: field, value: value, srcText: (srcText || "").trim(), confidence: conf }); }

    // ── numeric vitals (use RAW: "/", "%", "." preserved) ──
    // BP — labeled ("bp 100/60", "blood pressure 100 by 60") OR a bare systolic/diastolic pair
    m = raw.match(/\b(?:bp|blood\s*pressure)\b[^0-9]{0,15}(\d{2,3})\s*(?:\/|by|over)\s*(\d{2,3})/);
    if (!m) m = raw.match(/(?:^|[^0-9.\/])(\d{2,3})\s*\/\s*(\d{2,3})(?![0-9.\/])/);
    if (m) { var sys = num(m[1]), dia = num(m[2]);
      if (inRange(sys, 50, 300) && inRange(dia, 20, 200) && sys > dia) { push("bpSys", sys, m[0], 0.95); push("bpDia", dia, m[0], 0.95); } }

    m = raw.match(/\b(?:pulse|heart\s*rate|hr|pr)\b\s*(?:rate)?\s*(?:is|of|was|=|:|at)?\s*(\d{2,3})\b/);
    if (m && inRange(num(m[1]), 20, 250)) { push("pulse", num(m[1]), m[0], 0.9);
      var rhy = signed(n, ["irregular"]); if (rhy === true) push("pulseRhythm", "Irregular", "irregular", 0.85);
      else if (signed(n, ["regular"]) === true) push("pulseRhythm", "Regular", "regular", 0.8); }

    m = raw.match(/\b(?:rr|resp(?:iratory)?\s*rate|respiration)\b\s*(?:is|of|was|=|:|at)?\s*(\d{1,2})\b/);
    if (m && inRange(num(m[1]), 4, 80)) push("rr", num(m[1]), m[0], 0.9);

    // Temperature → GHIS wants °F. Convert if spoken in °C or a plausible C value.
    m = raw.match(/\b(?:temp(?:erature)?|febrile\s*at)\b\s*(?:is|of|was|=|:)?\s*(\d{2,3}(?:\.\d)?)\s*(?:°|deg(?:ree)?s?)?\s*(c|celsius|centigrade|f|fahrenheit)?/);
    if (m) { var tv = num(m[1]), unit = m[2] || "";
      if (/^c/.test(unit) || (!unit && inRange(tv, 35, 43))) tv = Math.round((tv * 9 / 5 + 32) * 10) / 10; // °C→°F
      if (inRange(tv, 94, 110)) push("temp", tv, m[0], unit ? 0.95 : 0.85); }
    // "afebrile" — spoken finding, but do NOT invent a number; note it in systemic exam
    if (/\bafebrile\b/.test(n)) push("systemicExam", "Afebrile", "afebrile", 0.9);

    m = raw.match(/\bgcs\b\s*(?:is|of|=|:)?\s*(?:e\d\s*v\d\s*m\d\s*)?(\d{1,2})(?:\s*\/\s*15)?/);
    if (m && inRange(num(m[1]), 3, 15)) push("gcs", num(m[1]), m[0], 0.9);

    m = raw.match(/\b(?:pain(?:\s*score)?)\b\s*(?:is|of|=|:)?\s*(\d{1,2})\s*(?:\/\s*10|out of ten|on ten)?/);
    if (m && inRange(num(m[1]), 0, 10)) push("pain", num(m[1]), m[0], 0.85);

    m = raw.match(/\b(?:ht|height)\b\s*(?:is|of|=|:)?\s*(\d{2,3}(?:\.\d)?)\s*(?:cm|cms|centimet)/);
    if (m && inRange(num(m[1]), 30, 250)) push("heightCm", num(m[1]), m[0], 0.9);
    m = raw.match(/\b(?:wt|weight)\b\s*(?:is|of|=|:)?\s*(\d{2,3}(?:\.\d)?)\s*(?:kg|kgs|kilo)/);
    if (m && inRange(num(m[1]), 1, 400)) push("weightKg", num(m[1]), m[0], 0.9);

    // ── general-examination checkboxes (uniform "no X" negation) ──
    var SIGNS = {
      pallor: ["pallor", "pale", "pallour"], icterus: ["icterus", "jaundice", "icteric"],
      cyanosis: ["cyanosis", "cyanosed", "cyanotic"], clubbing: ["clubbing", "clubbed"],
      oedema: ["pedal oedema", "pedal edema", "oedema", "edema", "leg swelling"],
      lymphadenopathy: ["lymphadenopathy", "lymph node", "enlarged lymph"],
      rash: ["rash", "eruption"], goitre: ["goitre", "goiter", "thyroid swelling"]
    };
    Object.keys(SIGNS).forEach(function (f) { var s = signed(n, SIGNS[f]); if (s !== undefined) push(f, s, SIGNS[f][0], 0.85); });

    // ── stereotyped system phrases → GHIS enums (explicit; each guarded) ──
    // Abdomen
    var tnd = signed(n, ["tenderness", "tender"]);
    if (/\bnon[\s-]?tender/.test(n)) tnd = false;
    if (tnd !== undefined) push("tenderness", tnd ? "Yes" : "No", "tenderness", 0.85);
    if (/\bdistend/.test(n)) push("abdoShape", "Distended", "distended", 0.85);
    else if (/\bscaphoid\b/.test(n)) push("abdoShape", "Scaphoid", "scaphoid", 0.85);
    else if (/\b(?:abdomen|per abdomen|p\/a)\b[^.,;]*\bflat\b/.test(n)) push("abdoShape", "Flat", "flat", 0.8);
    var bs = signed(n, ["bowel sound", "bowel sounds"]);
    if (/\bexaggerated bowel|hyperactive bowel/.test(n)) push("bowelSounds", "Exaggerated", "exaggerated bowel sounds", 0.85);
    else if (bs !== undefined) push("bowelSounds", bs ? "Normal" : "Absent", "bowel sounds", 0.8);
    var ff = signed(n, ["free fluid", "ascites", "shifting dullness"]); if (ff !== undefined) push("freeFluid", ff ? "Yes" : "No", "free fluid", 0.8);
    var hep = signed(n, ["hepatomegaly", "liver palpable", "palpable liver"]);
    if (/no organomegaly|no hepatosplenomegaly/.test(n)) { push("liver", "Not palpable", "no organomegaly", 0.85); push("spleen", "Not palpable", "no organomegaly", 0.85); }
    else { if (hep !== undefined) push("liver", hep ? "Palpable" : "Not palpable", "liver", 0.8);
      var spl = signed(n, ["splenomegaly", "spleen palpable", "palpable spleen"]); if (spl !== undefined) push("spleen", spl ? "Palpable" : "Not palpable", "spleen", 0.8); }
    var mass = signed(n, ["palpable mass", "abdominal mass", "lump"]); if (mass !== undefined) push("abdoMass", mass ? "Yes" : "No", "mass", 0.8);

    // CVS
    if (/\bs1\s*s2\b|\bs1\s*,?\s*s2\b|first and second heart sound|normal heart sounds?\b/.test(n)) push("cardiacSounds", "S1 S2 heard, normal", "s1 s2", 0.85);
    var mur = signed(n, ["murmur"]); if (mur !== undefined) push("murmurs", mur ? "Yes" : "No", "murmur", 0.85);
    var thr = signed(n, ["thrill"]); if (thr !== undefined) push("thrills", thr ? "Yes" : "No", "thrill", 0.8);

    // Respiratory
    if (/bilateral air entry|air entry equal|\bbae\b|vesicular breath|normal breath sounds?\b/.test(n)) push("breathSounds", "Vesicular", "vesicular / BAE equal", 0.85);
    else if (/tubular breath|bronchial breath/.test(n)) push("breathSounds", "Tubular", "tubular breath sounds", 0.85);
    var whz = signed(n, ["wheeze", "wheezing", "rhonchi"]); if (whz !== undefined) push("wheeze", whz ? "Yes" : "No", "wheeze", 0.8);
    if (/\brhonchi\b/.test(n) && whz !== false) push("adventitious", "Rhonchi", "rhonchi", 0.8);
    else if (signed(n, ["crepts", "crackles", "rales", "creps"]) === true) push("adventitious", "Rales(crepts)", "crepts", 0.8);
    else if (/no added sounds|no crepts|no crackles|clear lung|chest clear/.test(n)) push("adventitious", "None", "no added sounds", 0.8);
    var dysp = signed(n, ["dyspnoea", "dyspnea", "breathless", "shortness of breath"]); if (dysp !== undefined) push("dyspnoea", dysp ? "Yes" : "No", "dyspnoea", 0.8);

    // CNS
    if (/\bcomatose\b|\bin coma\b|\bunconscious\b/.test(n)) push("loc", "Coma", "comatose", 0.85);
    else if (/\bstuporous\b|\bstupor\b/.test(n)) push("loc", "Stuporous", "stuporous", 0.85);
    else if (/\bdrowsy\b|\bobtunded\b/.test(n)) push("loc", "Drowsy", "drowsy", 0.85);
    else if (signed(n, ["conscious", "alert"]) === true) push("loc", "Conscious", "conscious", 0.85);
    var ori = signed(n, ["oriented", "orientated"]); if (/disorient|not oriented|confused/.test(n)) ori = false; if (ori !== undefined) push("orientation", ori ? "Yes" : "No", "oriented", 0.85);
    var nst = signed(n, ["neck stiffness", "nuchal rigidity", "neck rigidity"]); if (/neck supple|no neck stiffness/.test(n)) nst = false; if (nst !== undefined) push("neckStiffness", nst ? "Yes" : "No", "neck stiffness", 0.85);
    var krn = signed(n, ["kernig"]); if (krn !== undefined) push("kernig", krn ? "Yes" : "No", "kernig", 0.8);

    // ── dedupe: keep the highest-confidence record per field ──
    var best = {};
    out.forEach(function (r) { if (!best[r.field] || r.confidence > best[r.field].confidence) best[r.field] = r; });
    return Object.keys(best).map(function (k) { return best[k]; });
  }

  var API = { extract: extract, wordsToNumbers: wordsToNumbers, _version: "1.0" };
  if (root) root.SMD_VVITALS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
