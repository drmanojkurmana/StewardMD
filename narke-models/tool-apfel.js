/* Narkē calculator model: simplified Apfel score for postoperative nausea and vomiting (Apfel 1999). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function on(x) { return x === true || x === "true" || x === "on"; }
  function b(id, en, hi) { return { id: id, label: { en: en, hi: hi }, type: "bool" }; }
  var RISK = [10, 20, 40, 60, 80], PUB = [10, 21, 39, 61, 79];
  return {
    id: "apfel", kind: "tool", group: "anaesthesia", level: "mbbs", review: "ai_drafted",
    title: { en: "Apfel PONV score", hi: "एपफ़ेल PONV स्कोर" },
    sources: [
      { label: "Apfel CC, et al. A simplified risk score for predicting postoperative nausea and vomiting. Anesthesiology 1999;91:693-700", url: "https://pubmed.ncbi.nlm.nih.gov/10485781/" },
      { label: "Gan TJ, et al. Fourth consensus guidelines for the management of postoperative nausea and vomiting. Anesth Analg 2020;131:411-48", url: "https://pubmed.ncbi.nlm.nih.gov/32467512/" }
    ],
    inputs: [
      b("female", "Female", "महिला"), b("nonsmoker", "Non-smoker", "धूम्रपान नहीं करता"),
      b("history", "Past PONV or motion sickness", "पहले PONV या मोशन सिकनेस"), b("opioids", "Opioids expected after surgery", "सर्जरी के बाद ओपिऑइड की संभावना")
    ],
    compute: function (v) {
      v = v || {}; var s = (on(v.female) ? 1 : 0) + (on(v.nonsmoker) ? 1 : 0) + (on(v.history) ? 1 : 0) + (on(v.opioids) ? 1 : 0);
      var band = s <= 1 ? "normal" : s === 2 ? "caution" : "danger";
      var name = band === "normal" ? ["low", "कम"] : band === "caution" ? ["moderate", "मध्यम"] : ["high", "उच्च"];
      return { ok: true, value: s, unit: "points", risk: RISK[s], band: band,
        label: { en: "Apfel " + s + ": about " + RISK[s] + "% PONV risk (" + name[0] + ")", hi: "एपफ़ेल " + s + ": लगभग " + RISK[s] + "% PONV जोखिम (" + name[1] + ")" },
        lines: [
          { en: "Published risk for " + s + " factors: " + PUB[s] + "%.", hi: s + " कारकों पर प्रकाशित जोखिम: " + PUB[s] + "%।" },
          { en: "The 2020 consensus advises 2 antiemetic measures for adults with 1 or 2 risk factors.", hi: "2020 सहमति दिशानिर्देश 1 या 2 जोखिम कारक वाले वयस्कों में 2 एंटीइमेटिक उपाय सुझाता है।" },
          { en: "This adult score is not for children.", hi: "यह वयस्क स्कोर बच्चों के लिए नहीं है।" }
        ],
        rule: { en: "One point each for female sex, non-smoking, past PONV or motion sickness, and postoperative opioids. 0, 1, 2, 3 and 4 points give about 10, 20, 40, 60 and 80% risk.",
          hi: "महिला, धूम्रपान न करना, पहले PONV या मोशन सिकनेस, और सर्जरी के बाद ओपिऑइड, हर एक का 1 अंक। 0, 1, 2, 3 और 4 अंक पर लगभग 10, 20, 40, 60 और 80% जोखिम।" } };
    },
    examples: [
      { values: {}, expect: { value: 0, risk: 10, band: "normal" } },
      { values: { history: true }, expect: { value: 1, risk: 20, band: "normal" } },
      { values: { female: true, nonsmoker: true }, expect: { value: 2, risk: 40, band: "caution" } },
      { values: { female: true, nonsmoker: true, opioids: true }, expect: { value: 3, risk: 60, band: "danger" } },
      { values: { female: true, nonsmoker: true, history: true, opioids: true }, expect: { value: 4, risk: 80, band: "danger" } }
    ]
  };
});
