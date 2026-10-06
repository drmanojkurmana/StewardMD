/* Narkē calculator model: Revised Cardiac Risk Index (Lee 1999). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function on(x) { return x === true || x === "true" || x === "on"; }
  function b(id, en, hi) { return { id: id, label: { en: en, hi: hi }, type: "bool" }; }
  var IDS = ["surgery", "ihd", "chf", "cvd", "insulin", "creat"];
  // Lee 1999 validation cohort: major cardiac complication rate by class.
  var CLS = [["I", 0.4], ["II", 0.9], ["III", 6.6], ["IV", 11]];
  return {
    id: "rcri", kind: "tool", group: "anaesthesia", level: "resident", review: "ai_drafted",
    title: { en: "Revised Cardiac Risk Index (Lee)", hi: "रिवाइज़्ड कार्डियक रिस्क इंडेक्स (ली)" },
    sources: [
      { label: "Lee TH, et al. Derivation and prospective validation of a simple index for prediction of cardiac risk of major noncardiac surgery. Circulation 1999;100:1043-9", url: "https://pubmed.ncbi.nlm.nih.gov/10477528/" },
      { label: "Fleisher LA, et al. 2014 ACC/AHA guideline on perioperative cardiovascular evaluation and management of patients undergoing noncardiac surgery. Circulation 2014;130:e278-333", url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000000106" },
      { label: "Halvorsen S, et al. 2022 ESC Guidelines on cardiovascular assessment and management of patients undergoing non-cardiac surgery. Eur Heart J 2022;43:3826-924", url: "https://academic.oup.com/eurheartj/article/43/39/3826/6675076" }
    ],
    inputs: [
      b("surgery", "High-risk surgery: intraperitoneal, intrathoracic or suprainguinal vascular", "उच्च जोखिम सर्जरी: इंट्रापेरिटोनियल, इंट्राथोरेसिक या सुप्राइंग्विनल वैस्कुलर"),
      b("ihd", "Ischaemic heart disease", "इस्कीमिक हृदय रोग"), b("chf", "Congestive heart failure", "कंजेस्टिव हार्ट फेल्योर"),
      b("cvd", "Cerebrovascular disease (stroke or TIA)", "सेरेब्रोवैस्कुलर रोग (स्ट्रोक या TIA)"), b("insulin", "Diabetes treated with insulin", "इंसुलिन से इलाज वाली डायबिटीज़"),
      b("creat", "Preoperative creatinine over 2.0 mg/dL (177 micromol/L)", "सर्जरी से पहले क्रिएटिनिन 2.0 mg/dL (177 micromol/L) से अधिक")
    ],
    compute: function (v) {
      v = v || {}; var s = 0, i;
      for (i = 0; i < IDS.length; i++) if (on(v[IDS[i]])) s++;
      var c = CLS[Math.min(s, 3)], band = s <= 1 ? "normal" : s === 2 ? "caution" : "danger";
      return { ok: true, value: s, unit: "points", cls: c[0], risk: c[1], band: band,
        label: { en: "RCRI " + s + ", class " + c[0] + ": " + c[1] + "% risk", hi: "RCRI " + s + ", वर्ग " + c[0] + ": " + c[1] + "% जोखिम" },
        lines: [
          { en: "Lee 1999 validation cohort, rate of major cardiac complications: class I 0.4%, II 0.9%, III 6.6%, IV 11%.", hi: "ली 1999 वैलिडेशन समूह, बड़ी हृदय जटिलताओं की दर: वर्ग I 0.4%, II 0.9%, III 6.6%, IV 11%।" },
          { en: "Events were MI, pulmonary oedema, VF or cardiac arrest, and complete heart block.", hi: "घटनाएँ थीं MI, पल्मोनरी एडिमा, VF या कार्डियक अरेस्ट, और कम्प्लीट हार्ट ब्लॉक।" },
          { en: "The 2014 ACC/AHA and 2022 ESC guidelines use RCRI with surgical risk and functional capacity to decide on further tests.", hi: "2014 ACC/AHA और 2022 ESC दिशानिर्देश आगे की जाँच तय करने के लिए RCRI को सर्जरी के जोखिम और कार्य क्षमता के साथ उपयोग करते हैं।" },
          { en: "Later cohorts with routine troponin testing found higher event rates.", hi: "नियमित ट्रोपोनिन जाँच वाले बाद के समूहों में घटनाओं की दर अधिक मिली।" }
        ],
        rule: { en: "One point each for high-risk surgery, ischaemic heart disease, heart failure, cerebrovascular disease, insulin-treated diabetes and creatinine over 2.0 mg/dL. 0 points class I, 1 class II, 2 class III, 3 or more class IV.",
          hi: "उच्च जोखिम सर्जरी, इस्कीमिक हृदय रोग, हार्ट फेल्योर, सेरेब्रोवैस्कुलर रोग, इंसुलिन वाली डायबिटीज़ और क्रिएटिनिन 2.0 mg/dL से अधिक, हर एक का 1 अंक। 0 अंक वर्ग I, 1 वर्ग II, 2 वर्ग III, 3 या अधिक वर्ग IV।" } };
    },
    examples: [
      { values: {}, expect: { value: 0, cls: "I", risk: 0.4 } },
      { values: { surgery: true }, expect: { value: 1, cls: "II", risk: 0.9 } },
      { values: { surgery: true, ihd: true }, expect: { value: 2, cls: "III", risk: 6.6, band: "caution" } },
      { values: { surgery: true, ihd: true, chf: true, insulin: true }, expect: { value: 4, cls: "IV", risk: 11, band: "danger" } }
    ]
  };
});
