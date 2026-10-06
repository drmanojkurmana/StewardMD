/* Narkē calculator model: preoperative fasting fluid deficit and the classic replacement schedule. Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function hourly(w) { return w <= 10 ? 4 * w : w <= 20 ? 40 + 2 * (w - 10) : 60 + (w - 20); }
  return {
    id: "fasting-deficit", kind: "tool", group: "anaesthesia", level: "mbbs", review: "ai_drafted",
    title: { en: "Fasting fluid deficit", hi: "उपवास से तरल की कमी" },
    sources: [
      { label: "e-Safe Anaesthesia (RCoA and NHS England e-learning). Fluid deficit: deficit = maintenance rate x hours starved; replace 50% in hour 1, 25% in each of hours 2 and 3", url: "https://e-safe-anaesthesia.org/sessions/06_01/d/ELFH_Session/479/tab_578.html" },
      { label: "Furman EB, Roman DG, Lemmer LA, et al. Specific therapy in water, electrolyte and blood-volume replacement during pediatric surgery. Anesthesiology 1975;42:187-93", url: "https://pubmed.ncbi.nlm.nih.gov/1115368/" },
      { label: "ASA Practice Guidelines for Preoperative Fasting, Anesthesiology 2017;126:376-93 (clear liquids up to 2 hours before)", url: "https://pubmed.ncbi.nlm.nih.gov/28045707/" },
      { label: "Frykholm P, et al. Pre-operative fasting in children: a guideline from the European Society of Anaesthesiology and Intensive Care. Eur J Anaesthesiol 2022 (clear fluids up to 1 hour before)", url: "https://esaic.org/wp-content/uploads/2023/12/pre_operative_fasting_in_children__a_guidelin.pdf" }
    ],
    inputs: [
      { id: "weight", label: { en: "Body weight", hi: "वज़न" }, type: "number", unit: "kg", min: 3, max: 150, step: 0.5, required: true },
      { id: "hours", label: { en: "Hours without fluid", hi: "बिना तरल के घंटे" }, type: "number", unit: "h", min: 1, max: 24, step: 0.5, required: true }
    ],
    compute: function (v) {
      v = v || {}; var w = num(v.weight), t = num(v.hours);
      if (w === null || w < 3 || w > 150) return bad("Weight must be 3 to 150 kg.", "वज़न 3 से 150 किग्रा हो।");
      if (t === null || t < 1 || t > 24) return bad("Hours without fluid must be 1 to 24.", "बिना तरल के घंटे 1 से 24 हों।");
      var m = hourly(w), d = Math.round(m * t), mr = Math.round(m), h1 = Math.round(d * 0.5 + m), h23 = Math.round(d * 0.25 + m);
      return { ok: true, value: d, unit: "mL", label: { en: "Fasting deficit " + d + " mL", hi: "उपवास की कमी " + d + " mL" },
        lines: [
          { en: "Maintenance by 4-2-1: " + mr + " mL/h, for " + t + " hours.", hi: "4-2-1 से मेंटेनेंस: " + mr + " mL/घंटा, " + t + " घंटे के लिए।" },
          { en: "Hour 1: half the deficit plus maintenance, " + h1 + " mL.", hi: "पहला घंटा: कमी का आधा और मेंटेनेंस, " + h1 + " mL।" },
          { en: "Hours 2 and 3: a quarter of the deficit plus maintenance, " + h23 + " mL each.", hi: "दूसरा और तीसरा घंटा: कमी का एक चौथाई और मेंटेनेंस, हर घंटे " + h23 + " mL।" },
          { en: "Use an isotonic fluid. Replace blood loss and other ongoing losses separately.", hi: "आइसोटोनिक तरल दें। रक्त और अन्य चल रहे नुकसान अलग से पूरा करें।" },
          { en: "Modern fasting allows clear fluids until 2 hours before surgery, or 1 hour in children.", hi: "आधुनिक नियमों में सर्जरी से 2 घंटे पहले तक, बच्चों में 1 घंटे पहले तक साफ़ तरल दिया जा सकता है।" },
          { en: "The true deficit is then often small. Many anaesthetists now replace less than this classic schedule.", hi: "तब वास्तविक कमी अक्सर कम होती है। कई एनेस्थेटिस्ट अब इस पुराने क्रम से कम तरल देते हैं।" }
        ],
        rule: { en: "Deficit = hourly maintenance (4-2-1) x hours without fluid. Classic schedule: 50% in the first hour, 25% in each of the second and third hours, each on top of maintenance.",
          hi: "कमी = प्रति घंटा मेंटेनेंस (4-2-1) x बिना तरल के घंटे। पुराना क्रम: पहले घंटे में 50%, दूसरे और तीसरे घंटे में 25-25%, हर बार मेंटेनेंस के ऊपर।" } };
    },
    examples: [
      { values: { weight: 20, hours: 6 }, expect: { value: 360 } },
      { values: { weight: 10, hours: 4 }, expect: { value: 160 } },
      { values: { weight: 70, hours: 8 }, expect: { value: 880 } },
      { values: { weight: 25, hours: 2 }, expect: { value: 130 } }
    ]
  };
});
