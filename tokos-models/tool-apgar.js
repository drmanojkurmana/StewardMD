/* Tokos calculator model: Apgar score (ACOG/AAP Committee Opinion 644). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function o(v, en, hi) { return { value: v, label: { en: en, hi: hi } }; }
  function item(id, en, hi, a, b, c) { return { id: id, label: { en: en, hi: hi }, type: "select", required: true, options: [o("0", a[0], a[1]), o("1", b[0], b[1]), o("2", c[0], c[1])] }; }
  var IDS = ["color", "heart", "reflex", "tone", "resp"];
  return {
    id: "apgar", kind: "tool", group: "obstetrics", level: "mbbs", review: "ai_drafted",
    title: { en: "Apgar score", hi: "एपगार स्कोर" },
    sources: [{ label: "ACOG Committee Opinion 644 (with AAP): The Apgar Score, Fig. 1 and text", url: "https://www.acog.org/-/media/project/acog/acogorg/clinical/files/committee-opinion/articles/2015/10/the-apgar-score.pdf" }],
    inputs: [
      item("color", "Color", "रंग", ["Blue or pale", "नीला या पीला"], ["Acrocyanotic", "हाथ-पैर नीले"], ["Completely pink", "पूरा गुलाबी"]),
      item("heart", "Heart rate", "हृदय गति", ["Absent", "अनुपस्थित"], ["<100 per minute", "<100 प्रति मिनट"], [">100 per minute", ">100 प्रति मिनट"]),
      item("reflex", "Reflex irritability", "रिफ्लेक्स प्रतिक्रिया", ["No response", "कोई प्रतिक्रिया नहीं"], ["Grimace", "मुँह बनाना"], ["Cry or active withdrawal", "रोना या सक्रिय हटना"]),
      item("tone", "Muscle tone", "मांसपेशी तनाव", ["Limp", "ढीला"], ["Some flexion", "थोड़ा मुड़ाव"], ["Active motion", "सक्रिय गति"]),
      item("resp", "Respiration", "श्वसन", ["Absent", "अनुपस्थित"], ["Weak cry, hypoventilation", "कमज़ोर रोना, कम श्वसन"], ["Good, crying", "अच्छा, रोता है"])
    ],
    compute: function (v) {
      v = v || {}; var t = 0, i, x;
      for (i = 0; i < 5; i++) { x = v[IDS[i]]; x = typeof x === "string" ? +x : x; if (x !== 0 && x !== 1 && x !== 2) return bad("Score every sign as 0, 1 or 2.", "हर संकेत को 0, 1 या 2 अंक दें।"); t += x; }
      var b = t >= 7 ? ["normal", "Reassuring", "आश्वस्त करने वाला"] : t >= 4 ? ["caution", "Moderately abnormal", "मध्यम असामान्य"] : ["danger", "Low", "निम्न"];
      return { ok: true, value: t, unit: "points", band: b[0], label: { en: "Apgar " + t + ": " + b[1], hi: "एपगार " + t + ": " + b[2] },
        lines: [{ en: "Report at 1 and 5 minutes, then every 5 minutes to 20 minutes while the score is below 7.", hi: "1 और 5 मिनट पर दर्ज करें, स्कोर 7 से कम रहे तो 20 मिनट तक हर 5 मिनट पर।" },
                { en: "The score is not used to decide the need for resuscitation and does not by itself predict neurologic outcome.", hi: "स्कोर से पुनर्जीवन की आवश्यकता तय नहीं होती और यह अकेले तंत्रिका-परिणाम नहीं बताता।" }],
        rule: { en: "Five signs, each 0 to 2, total 0 to 10. At 5 minutes: 7 to 10 reassuring, 4 to 6 moderately abnormal, 0 to 3 low.", hi: "पाँच संकेत, प्रत्येक 0 से 2, कुल 0 से 10। 5 मिनट पर: 7 से 10 आश्वस्त करने वाला, 4 से 6 मध्यम असामान्य, 0 से 3 निम्न।" } };
    },
    examples: [
      { values: { color: "2", heart: "2", reflex: "2", tone: "2", resp: "2" }, expect: { value: 10, band: "normal" } },
      { values: { color: "1", heart: "2", reflex: "1", tone: "1", resp: "2" }, expect: { value: 7, band: "normal" } },
      { values: { color: "1", heart: "1", reflex: "1", tone: "1", resp: "1" }, expect: { value: 5, band: "caution" } },
      { values: { color: "0", heart: "1", reflex: "1", tone: "1", resp: "0" }, expect: { value: 3, band: "danger" } },
      { values: { color: "0", heart: "0", reflex: "0", tone: "0", resp: "0" }, expect: { value: 0, band: "danger" } }
    ]
  };
});
