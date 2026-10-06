/* Narkē calculator model: STOP-Bang screening for obstructive sleep apnoea (Chung 2008, 2016). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function on(x) { return x === true || x === "true" || x === "on"; }
  function b(id, en, hi) { return { id: id, label: { en: en, hi: hi }, type: "bool" }; }
  var STOP = ["snore", "tired", "observed", "pressure"], BANG = ["bmi35", "age50", "neck40", "male"];
  return {
    id: "stopbang", kind: "tool", group: "anaesthesia", level: "mbbs", review: "ai_drafted",
    title: { en: "STOP-Bang (sleep apnoea screen)", hi: "STOP-Bang (स्लीप एप्निया जाँच)" },
    sources: [
      { label: "Chung F, et al. STOP questionnaire: a tool to screen patients for obstructive sleep apnea. Anesthesiology 2008;108:812-21", url: "https://pubmed.ncbi.nlm.nih.gov/18431116/" },
      { label: "Chung F, Abdullah HR, Liao P. STOP-Bang Questionnaire: a practical approach to screen for obstructive sleep apnea. Chest 2016;149:631-8", url: "https://pubmed.ncbi.nlm.nih.gov/26378880/" }
    ],
    inputs: [
      b("snore", "Snores loudly", "ज़ोर से खर्राटे"), b("tired", "Tired or sleepy in the daytime", "दिन में थकान या नींद"),
      b("observed", "Someone has seen breathing stop in sleep", "किसी ने नींद में साँस रुकते देखी"), b("pressure", "Treated for high blood pressure", "हाई ब्लड प्रेशर का इलाज"),
      b("bmi35", "BMI over 35 kg/m2", "BMI 35 kg/m2 से अधिक"), b("age50", "Age over 50 years", "आयु 50 वर्ष से अधिक"),
      b("neck40", "Neck circumference over 40 cm", "गर्दन की परिधि 40 cm से अधिक"), b("male", "Male", "पुरुष")
    ],
    compute: function (v) {
      v = v || {}; var s = 0, stop = 0, i;
      for (i = 0; i < 4; i++) { if (on(v[STOP[i]])) { s++; stop++; } if (on(v[BANG[i]])) s++; }
      var plus = stop >= 2 && (on(v.male) || on(v.bmi35) || on(v.neck40));
      var band = s >= 5 || (s >= 3 && plus) ? "danger" : s >= 3 ? "caution" : "normal";
      var name = band === "danger" ? ["High risk", "उच्च जोखिम"] : band === "caution" ? ["Intermediate risk", "मध्यम जोखिम"] : ["Low risk", "कम जोखिम"];
      var lines = [{ en: "STOP part " + stop + " of 4; total " + s + " of 8.", hi: "STOP भाग 4 में से " + stop + "; कुल 8 में से " + s + "।" }];
      if (s >= 3 && s <= 4 && plus) lines.push({ en: "Score 3 to 4 is high risk with 2 or more STOP items. It also needs male sex, BMI over 35 or a large neck (Chung 2016).", hi: "स्कोर 3 से 4 हो और 2 या अधिक STOP बिंदु के साथ पुरुष, BMI 35 से अधिक या मोटी गर्दन हो, तो उच्च जोखिम (चुंग 2016)।" });
      lines.push({ en: "This is a screen, not a diagnosis. Confirm OSA with a sleep study.", hi: "यह जाँच है, निदान नहीं। स्लीप स्टडी से OSA की पुष्टि करें।" });
      if (band !== "normal") lines.push({ en: "Plan for a possibly difficult mask airway and opioid sensitivity after surgery.", hi: "मास्क से कठिन वायुमार्ग और सर्जरी के बाद ओपिऑइड संवेदनशीलता की तैयारी रखें।" });
      return { ok: true, value: s, unit: "points", band: band, label: { en: "STOP-Bang " + s + ": " + name[0], hi: "STOP-Bang " + s + ": " + name[1] }, lines: lines,
        rule: { en: "One point each for snoring, tiredness, observed apnoea, treated hypertension, BMI over 35, age over 50, neck over 40 cm and male sex. 0 to 2 low, 3 to 4 intermediate, 5 to 8 high risk of moderate to severe OSA.",
          hi: "खर्राटे, थकान, देखी गई एप्निया, इलाज वाला हाइपरटेंशन, BMI 35 से अधिक, आयु 50 से अधिक, गर्दन 40 cm से अधिक और पुरुष, हर एक का 1 अंक। 0 से 2 कम, 3 से 4 मध्यम, 5 से 8 मध्यम से गंभीर OSA का उच्च जोखिम।" } };
    },
    examples: [
      { values: {}, expect: { value: 0, band: "normal" } },
      { values: { snore: true, tired: true, observed: true }, expect: { value: 3, band: "caution" } },
      { values: { snore: true, tired: true, male: true }, expect: { value: 3, band: "danger" } },
      { values: { tired: true, age50: true, male: true, neck40: true }, expect: { value: 4, band: "caution" } },
      { values: { snore: true, pressure: true, bmi35: true, age50: true, neck40: true }, expect: { value: 5, band: "danger" } }
    ]
  };
});
