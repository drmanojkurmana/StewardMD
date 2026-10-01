/* Tokos explorer model: the menstrual cycle. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.TOKOS_MODELS["cycle"].
   at(day, cycleLength) returns the RELATIVE level of FSH, LH, oestradiol and progesterone (each scaled so its own
   highest point in that cycle is 1; not assay units, not comparable between hormones), the ovarian phase, the follicle
   stage and the endometrial phase. The shapes are stylised curves fitted to the timing in the cited sources:
   the luteal phase is a constant 14 days and the follicular phase carries the variation in cycle length
   (Reed and Carr, Endotext), a 28 day cycle ovulates on day 14 (OpenStax), the sub-phases are counted from the LH peak
   (Stricker 2006), the mid-luteal phase is about 7 days after ovulation when both oestradiol and progesterone are
   high (D'Souza 2023), the corpus luteum works for 10 to 12 days (OpenStax). Everything else is a teaching approximation. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.TOKOS_MODELS = root.TOKOS_MODELS || {}; root.TOKOS_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var LUTEAL = 14;            // days from ovulation to the next period, constant (Reed and Carr)
  var MIN_LEN = 21, MAX_LEN = 35, DEFAULT_LEN = 28; // eumenorrhoea 21 to 35 days (D'Souza 2023)
  var MENSES = 5;             // average length of the period, days (OpenStax: about 5, range 2 to 7)
  var CL_DAYS = 10;           // corpus luteum works for 10 to 12 days; "regressing" after the lower bound (OpenStax)
  var HORMONES = ["fsh", "lh", "e2", "p4"];

  function gauss(x, c, sl, sr) { var d = x - c, s = d < 0 ? sl : sr; return Math.exp(-0.5 * d * d / (s * s)); }
  function smooth(x, a, b) { if (x <= a) return 0; if (x >= b) return 1; var t = (x - a) / (b - a); return t * t * (3 - 2 * t); }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  function landmarksOf(L) {
    var O = L - LUTEAL;
    return { ovulationDay: O, lhPeakDay: O - 0.5 };
  }

  /* Raw (unscaled) shapes. t = days from the LH peak, tOv = days from ovulation. */
  function raw(h, day, L) {
    var lm = landmarksOf(L), t = day - lm.lhPeakDay, tOv = day - lm.ovulationDay;
    if (h === "lh") return 0.07 + 0.93 * gauss(t, 0, 0.55, 0.8);
    if (h === "fsh") {
      return 0.16 + 0.44 * Math.exp(-(day - 1) / 3.5) + 0.8 * gauss(t, 0, 0.9, 1.0)
        - 0.06 * smooth(tOv, 1, 4) * (1 - smooth(tOv, 8, 12)) + 0.3 * smooth(day, L - 6, L + 1);
    }
    if (h === "e2") {
      return 0.1 + 0.9 * gauss(t, -1, 3.2, 0.9) * smooth(day, 1, 5) + 0.45 * gauss(tOv, 7, 3.0, 3.4);
    }
    return 0.03 + 0.97 * gauss(tOv, 7, 2.6, 3.3); // p4
  }

  var cache = {};
  function scaleFor(L) {
    if (cache[L]) return cache[L];
    var mx = { fsh: 0, lh: 0, e2: 0, p4: 0 }, d, i, v;
    for (d = 1; d <= L + 1e-9; d += 0.05) {
      for (i = 0; i < 4; i++) { v = raw(HORMONES[i], d, L); if (v > mx[HORMONES[i]]) mx[HORMONES[i]] = v; }
    }
    cache[L] = mx;
    return mx;
  }

  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }

  function subphaseOf(day, L) {
    // the LH peak (half a day before ovulation) and the ovulation day itself both read as the LH peak, so the
    // whole day that the ovary shows "ovulation" never says the corpus luteum has already formed
    var lm = landmarksOf(L), x = day - lm.lhPeakDay, k = Math.round(x);
    if (x >= -0.5 && x <= 0.5) return "lh-peak";
    if (day <= MENSES && k < 0) return "early-follicular";
    if (k <= -6) return "early-follicular";
    if (k <= -1) return "late-follicular";
    if (k === 0) return "lh-peak";
    if (k <= 4) return "early-luteal";
    if (k <= 9) return "mid-luteal";
    return "late-luteal";
  }

  var NOTE_RELATIVE = {
    en: "Levels are relative: each line is scaled so its own highest point in the cycle is 1. They are not assay values, and one hormone cannot be compared with another or with a lab report.",
    hi: "स्तर सापेक्ष (relative) हैं: हर रेखा को इस तरह पैमाने पर रखा गया है कि चक्र में उसका अपना सबसे ऊँचा बिंदु 1 हो। ये lab की असली मात्रा नहीं हैं और एक hormone की दूसरे से या lab report से तुलना नहीं हो सकती।"
  };

  var PHASE_TEXT = {
    "early-follicular": { en: "Early follicular: bleeding, then a few follicles grow under FSH; oestradiol is low.", hi: "Early follicular: रक्तस्राव के बाद FSH के असर से कुछ follicles बढ़ते हैं; oestradiol कम रहता है।" },
    "late-follicular": { en: "Late follicular: one dominant follicle makes a lot of oestradiol and the lining proliferates.", hi: "Late follicular: एक dominant follicle बहुत oestradiol बनाता है और endometrium बढ़ता (proliferate) है।" },
    "lh-peak": { en: "LH peak: the LH surge triggers ovulation of the dominant follicle.", hi: "LH peak: LH surge dominant follicle के ovulation को शुरू करता है।" },
    "early-luteal": { en: "Early luteal: the ruptured follicle becomes the corpus luteum and progesterone starts to rise.", hi: "Early luteal: फटा हुआ follicle corpus luteum बन जाता है और progesterone बढ़ने लगता है।" },
    "mid-luteal": { en: "Mid-luteal: progesterone and oestradiol are both high and the lining is secretory.", hi: "Mid-luteal: progesterone और oestradiol दोनों ऊँचे रहते हैं और endometrium secretory होता है।" },
    "late-luteal": { en: "Late luteal: the corpus luteum fades, hormones fall and the period is near.", hi: "Late luteal: corpus luteum घटने लगता है, hormones गिरते हैं और माहवारी पास आती है।" }
  };

  /* at(day, cycleLength): day 1 is the first day of bleeding; day may be fractional; cycleLength 21 to 35 (default 28). */
  function at(day, cycleLength) {
    var L = cycleLength === undefined || cycleLength === null ? DEFAULT_LEN : cycleLength;
    if (typeof L !== "number" || L !== L || L < MIN_LEN || L > MAX_LEN || L !== Math.floor(L)) {
      return bad("Cycle length is a whole number of days from 21 to 35.", "चक्र की लंबाई 21 से 35 के बीच पूरे दिनों की संख्या होती है।");
    }
    if (typeof day !== "number" || day !== day || day < 1 || day > L) {
      return bad("Day is a number from 1 to the cycle length.", "दिन 1 से चक्र की लंबाई तक की संख्या होता है।");
    }
    var lm = landmarksOf(L), O = lm.ovulationDay, mx = scaleFor(L), levels = {}, i;
    for (i = 0; i < 4; i++) levels[HORMONES[i]] = round3(Math.min(1, raw(HORMONES[i], day, L) / mx[HORMONES[i]]));
    var ovarian = day < O - 0.5 ? "follicular" : day <= O + 0.5 ? "ovulation" : "luteal";
    var sub = subphaseOf(day, L);
    var endometrium = day <= MENSES && day < O - 0.5 ? "menstrual" : day <= O + 0.5 ? "proliferative" : "secretory";
    var follicle = ovarian === "luteal" ? (day - O <= CL_DAYS ? "corpus-luteum" : "corpus-luteum-regressing")
      : ovarian === "ovulation" ? "ovulating" : (sub === "late-follicular" || sub === "lh-peak" ? "dominant" : "growing");
    return {
      ok: true, day: day, cycleLength: L, ovulationDay: O, lhPeakDay: lm.lhPeakDay,
      levels: levels, ovarian: ovarian, subphase: sub, follicle: follicle, endometrium: endometrium,
      phaseText: PHASE_TEXT[sub], relative: true
    };
  }

  function curve(cycleLength, step) {
    var L = cycleLength === undefined ? DEFAULT_LEN : cycleLength, st = step || 1, out = [], d, r;
    for (d = 1; d <= L + 1e-9; d += st) {
      r = at(Math.min(d, L), L);
      if (!r.ok) return r;
      out.push(r);
    }
    return { ok: true, cycleLength: L, points: out };
  }

  function landmarks(cycleLength) {
    var L = cycleLength === undefined ? DEFAULT_LEN : cycleLength;
    var probe = at(1, L);
    if (!probe.ok) return probe;
    var best = { fsh: 1, lh: 1, e2: 1, p4: 1 }, top = { fsh: -1, lh: -1, e2: -1, p4: -1 }, d, r, i, h;
    for (d = 1; d <= L + 1e-9; d += 0.05) {
      r = at(Math.min(d, L), L);
      for (i = 0; i < 4; i++) { h = HORMONES[i]; if (r.levels[h] > top[h]) { top[h] = r.levels[h]; best[h] = Math.round(d * 100) / 100; } }
    }
    var lm = landmarksOf(L);
    return { ok: true, cycleLength: L, menstrualDays: MENSES, follicularDays: lm.ovulationDay, lutealDays: LUTEAL,
      ovulationDay: lm.ovulationDay, lhPeakDay: lm.lhPeakDay, peakDay: best };
  }

  return {
    id: "cycle", kind: "explorer", group: "gynaecology", level: "mbbs",
    title: { en: "Menstrual cycle explorer", hi: "मासिक चक्र एक्सप्लोरर" },
    subtitle: { en: "Slide through the cycle and watch the hormones, the follicle and the lining", hi: "चक्र में आगे-पीछे जाएँ और hormones, follicle और endometrium देखें" },
    sources: [
      { label: "Reed BG, Carr BR. The Normal Menstrual Cycle and the Control of Ovulation. Endotext (abstract: median cycle 28 days, luteal phase constant at 14 days, follicular phase varies)", url: "https://www.ncbi.nlm.nih.gov/books/NBK279054/" },
      { label: "Stricker R et al. Reference values for LH, FSH, estradiol and progesterone during the menstrual cycle. Clin Chem Lab Med 2006;44(7):883-887 (abstract: sub-phases counted from the LH peak)", url: "https://pubmed.ncbi.nlm.nih.gov/16776638/" },
      { label: "D'Souza AC et al. Menstrual cycle hormones and oral contraceptives. J Appl Physiol 2023;135(6):1284-1299 (idealised 28 day cycle, ovulation day 14; eumenorrhoea 21 to 35 days; mid-luteal about 7 days after ovulation)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10979803/" },
      { label: "OpenStax Anatomy and Physiology 2e, 27.2 (LH surge, feedback, luteal phase, corpus luteum 10 to 12 days, menses about 5 days)", url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/27-2-anatomy-and-physiology-of-the-ovarian-reproductive-system" },
      { label: "Wikipedia, Menstrual cycle (secondary; LH surge about 10 to 12 hours before ovulation, luteal phase 10 to 16 days)", url: "https://en.wikipedia.org/wiki/Menstrual_cycle" }
    ],
    review: "ai_drafted",
    notes: {
      relative: NOTE_RELATIVE,
      stylised: { en: "The curves are stylised teaching shapes with the timing above. Real cycles vary a lot between women and between cycles: measured levels form a wide band around the textbook line.", hi: "ये रेखाएँ ऊपर दिए समय पर बनी सरल शिक्षण आकृतियाँ हैं। असली चक्र एक स्त्री से दूसरी में और एक चक्र से दूसरे में काफ़ी बदलते हैं: मापे गए स्तर textbook की रेखा के आसपास चौड़ी पट्टी बनाते हैं।" },
      range: { en: "The model covers cycles of 21 to 35 days. Shorter or longer cycles are outside normal ovulatory cycles and are not modelled.", hi: "यह model 21 से 35 दिन के चक्र दिखाता है। इससे छोटे या लंबे चक्र सामान्य ovulatory चक्र से बाहर हैं और यहाँ नहीं दिखाए गए।" }
    },
    hormones: {
      fsh: { name: { en: "FSH", hi: "FSH (फॉलिकल-उत्तेजक हॉर्मोन)" }, role: { en: "Makes follicles grow. It falls through the follicular phase and bursts with the LH surge.", hi: "Follicles को बढ़ाता है। Follicular phase में घटता है और LH surge के साथ अचानक बढ़ता है।" } },
      lh: { name: { en: "LH", hi: "LH (ल्यूटिनाइज़िंग हॉर्मोन)" }, role: { en: "The LH surge triggers ovulation of the dominant follicle.", hi: "LH surge dominant follicle के ovulation को शुरू करता है।" } },
      e2: { name: { en: "Oestradiol", hi: "Oestradiol (ओएस्ट्राडायोल)" }, role: { en: "Made by the growing follicles. A high level switches feedback to positive and the LH surge follows. It makes the lining proliferate.", hi: "बढ़ते follicles बनाते हैं। ऊँचा स्तर feedback को positive कर देता है और LH surge आता है। यह endometrium को बढ़ाता है।" } },
      p4: { name: { en: "Progesterone", hi: "Progesterone (प्रोजेस्टेरोन)" }, role: { en: "Made by the corpus luteum after ovulation. It makes the lining secretory.", hi: "Ovulation के बाद corpus luteum बनाता है। यह endometrium को secretory बनाता है।" } }
    },
    constants: { lutealDays: LUTEAL, minLength: MIN_LEN, maxLength: MAX_LEN, defaultLength: DEFAULT_LEN, menstrualDays: MENSES },
    at: at, curve: curve, landmarks: landmarks
  };
});
