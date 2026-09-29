/* Tokos calculator model: GDM by DIPSI single-step 75 g test (India). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  return {
    id: "dipsi", kind: "tool", group: "obstetrics", level: "mbbs", review: "ai_drafted",
    title: { en: "GDM by DIPSI (75 g, one step)", hi: "डिप्सी से जीडीएम (75 ग्राम, एक चरण)" },
    sources: [
      { label: "MoHFW Maternal Health Division. National Guidelines for Diagnosis & Management of Gestational Diabetes Mellitus, Dec 2014, section 3.5", url: "https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/National_Guidelines_for_Diagnosis_&_Management_of_Gestational_Diabetes_Mellitus.pdf" },
      { label: "DIPSI. Diagnosis & Management of Gestational Diabetes Mellitus (2021), ICOG GCPR", url: "https://icogonline.org/wp-content/uploads/pdf/gcpr/gdm-dipsi-guidline.pdf" }
    ],
    inputs: [{ id: "pg2h", label: { en: "Plasma glucose 2 hours after 75 g glucose", hi: "75 ग्राम ग्लूकोज के 2 घंटे बाद प्लाज्मा ग्लूकोज" }, type: "number", unit: "mg/dL", min: 40, max: 600, step: 1, required: true }],
    compute: function (v) {
      var g = num((v || {}).pg2h);
      if (g === null || g < 40 || g > 600) return bad("Enter the 2-hour plasma glucose as 40 to 600 mg/dL.", "2 घंटे का प्लाज्मा ग्लूकोज 40 से 600 मिग्रा/डेसीली में दें।");
      var gdm = g >= 140;
      return {
        ok: true, value: g, unit: "mg/dL", band: gdm ? "danger" : "normal",
        label: gdm ? { en: "GDM: 2-hour plasma glucose 140 mg/dL or more", hi: "जीडीएम: 2 घंटे का प्लाज्मा ग्लूकोज 140 मिग्रा/डेसीली या अधिक" } : { en: "Normal: below 140 mg/dL", hi: "सामान्य: 140 मिग्रा/डेसीली से कम" },
        lines: gdm ? [{ en: "Start medical nutrition therapy for 2 weeks, then a 2-hour post-meal glucose (MoHFW).", hi: "2 सप्ताह मेडिकल न्यूट्रिशन थेरेपी शुरू करें, फिर भोजन के 2 घंटे बाद ग्लूकोज (एमओएचएफडब्ल्यू)।" }]
          : [{ en: "If the first test was at the first antenatal visit, repeat at 24 to 28 weeks.", hi: "यदि पहला परीक्षण पहली प्रसवपूर्व विज़िट पर हुआ हो तो 24 से 28 सप्ताह पर दोहराएँ।" }],
        rule: { en: "Give 75 g glucose in about 300 mL water, fasting or non-fasting, irrespective of the last meal, finished within 5 minutes. Measure plasma glucose at 2 hours; 140 mg/dL or more (140 counts) is GDM. Test at the first antenatal contact and again at 24 to 28 weeks if negative. Repeat the test next day if vomiting occurs within 30 minutes.",
          hi: "लगभग 300 मिली पानी में 75 ग्राम ग्लूकोज, खाली पेट या भोजन के बाद, पिछले भोजन से स्वतंत्र, 5 मिनट में पिलाएँ। 2 घंटे पर प्लाज्मा ग्लूकोज मापें; 140 मिग्रा/डेसीली या अधिक (140 सहित) जीडीएम है। पहली प्रसवपूर्व मुलाकात पर जाँचें और नकारात्मक हो तो 24 से 28 सप्ताह पर दोहराएँ। 30 मिनट के भीतर उल्टी हो तो अगले दिन दोहराएँ।" }
      };
    },
    examples: [
      { values: { pg2h: 139 }, expect: { band: "normal" } },
      { values: { pg2h: 140 }, expect: { band: "danger" } },
      { values: { pg2h: 182 }, expect: { band: "danger" } }
    ]
  };
});
