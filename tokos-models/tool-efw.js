/* Tokos calculator model: Hadlock estimated fetal weight (Hadlock 1985, four-parameter BPD/HC/AC/FL). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function inp(id, en, hi, min, max) { return { id: id, label: { en: en, hi: hi }, type: "number", unit: "cm", min: min, max: max, step: 0.1, required: true }; }
  // log10(EFW g) = 1.3596 + 0.0064 HC + 0.0424 AC + 0.174 FL + 0.00061 BPD AC - 0.00386 AC FL (all cm)
  function efw(bpd, hc, ac, fl) { return Math.pow(10, 1.3596 + 0.0064 * hc + 0.0424 * ac + 0.174 * fl + 0.00061 * bpd * ac - 0.00386 * ac * fl); }
  return {
    id: "efw", kind: "tool", group: "obstetrics", level: "mbbs", review: "ai_drafted",
    title: { en: "Estimated fetal weight (Hadlock)", hi: "अनुमानित भ्रूण भार (हैडलॉक)" },
    sources: [
      { label: "Hadlock FP et al. Estimation of fetal weight with the use of head, body, and femur measurements. Am J Obstet Gynecol 1985;151:333-7 (four-parameter equation as quoted in open-access papers)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11217594/" },
      { label: "Same equation quoted in PMC12909411 and PMC13604655", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12909411/" }
    ],
    inputs: [
      inp("bpd", "Biparietal diameter (BPD)", "बाइपैराइटल डायमीटर (बीपीडी)", 2, 11),
      inp("hc", "Head circumference (HC)", "सिर की परिधि (एचसी)", 8, 37),
      inp("ac", "Abdominal circumference (AC)", "पेट की परिधि (एसी)", 6, 39),
      inp("fl", "Femur length (FL)", "फीमर की लंबाई (एफएल)", 1, 9)
    ],
    compute: function (v) {
      v = v || {}; var b = num(v.bpd), h = num(v.hc), a = num(v.ac), f = num(v.fl);
      if (b === null || h === null || a === null || f === null || b < 2 || b > 11 || h < 8 || h > 37 || a < 6 || a > 39 || f < 1 || f > 9)
        return bad("Enter BPD 2 to 11, HC 8 to 37, AC 6 to 39 and FL 1 to 9 cm.", "बीपीडी 2 से 11, एचसी 8 से 37, एसी 6 से 39 और एफएल 1 से 9 सेमी दें।");
      var g = Math.round(efw(b, h, a, f));
      return { ok: true, value: g, unit: "g", label: { en: "Estimated fetal weight " + g + " g", hi: "अनुमानित भ्रूण भार " + g + " ग्राम" },
        lines: [{ en: "Hadlock 1985, four parameters (BPD, HC, AC, FL). Ultrasound weight is an estimate; interpret it on a growth chart with gestational age.", hi: "हैडलॉक 1985, चार मापदंड (बीपीडी, एचसी, एसी, एफएल)। अल्ट्रासाउंड भार एक अनुमान है; इसे गर्भावस्था अवधि के साथ वृद्धि चार्ट पर देखें।" }],
        rule: { en: "log10(EFW in g) = 1.3596 + 0.0064 HC + 0.0424 AC + 0.174 FL + 0.00061 BPD x AC - 0.00386 AC x FL, all in cm.", hi: "log10(ईएफडब्ल्यू ग्राम में) = 1.3596 + 0.0064 एचसी + 0.0424 एसी + 0.174 एफएल + 0.00061 बीपीडी x एसी - 0.00386 एसी x एफएल, सब सेमी में।" } };
    },
    examples: [
      { values: { bpd: 9, hc: 32, ac: 32, fl: 7 }, expect: { value: 2820 } },
      { values: { bpd: 6, hc: 22, ac: 20, fl: 4.5 }, expect: { value: 720 } }
    ]
  };
});
