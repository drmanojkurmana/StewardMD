/* Narkē calculator model: PaO2/FiO2 ratio with Berlin ARDS severity bands (ARDS Definition Task Force 2012). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  var KPA = 7.50062;
  return {
    id: "pf-ratio", kind: "tool", group: "anaesthesia", level: "resident", review: "ai_drafted",
    title: { en: "PaO2/FiO2 ratio (Berlin ARDS)", hi: "PaO2/FiO2 अनुपात (बर्लिन ARDS)" },
    sources: [{ label: "ARDS Definition Task Force. Acute respiratory distress syndrome: the Berlin Definition. JAMA 2012;307:2526-33", url: "https://pubmed.ncbi.nlm.nih.gov/22797452/" }],
    inputs: [
      { id: "pao2", label: { en: "PaO2", hi: "PaO2" }, type: "number", min: 2, max: 700, step: 1, required: true },
      { id: "unit", label: { en: "PaO2 unit", hi: "PaO2 की इकाई" }, type: "select", required: true, options: [{ value: "mmHg", label: { en: "mmHg", hi: "mmHg" } }, { value: "kPa", label: { en: "kPa", hi: "kPa" } }] },
      { id: "fio2", label: { en: "FiO2 as a fraction", hi: "FiO2 (भिन्न में)" }, type: "number", min: 0.21, max: 1, step: 0.01, required: true },
      { id: "peep", label: { en: "PEEP or CPAP (optional)", hi: "PEEP या CPAP (वैकल्पिक)" }, type: "number", unit: "cmH2O", min: 0, max: 30, step: 1 }
    ],
    compute: function (v) {
      v = v || {}; var p = num(v.pao2), f = num(v.fio2), peep = num(v.peep);
      if (v.unit !== "mmHg" && v.unit !== "kPa") return bad("Choose the PaO2 unit.", "PaO2 की इकाई चुनें।");
      if (p !== null && v.unit === "kPa") p = p * KPA;
      if (p === null || p < 20 || p > 700) return bad("PaO2 must be 20 to 700 mmHg (2.7 to 93 kPa).", "PaO2 20 से 700 mmHg (2.7 से 93 kPa) हो।");
      if (f === null || f < 0.21 || f > 1) return bad("FiO2 must be a fraction from 0.21 to 1.0.", "FiO2 0.21 से 1.0 के बीच भिन्न में हो।");
      if (peep !== null && (peep < 0 || peep > 30)) return bad("PEEP must be 0 to 30 cmH2O.", "PEEP 0 से 30 cmH2O हो।");
      var r = Math.round(p / f), lines = [], band, grade;
      if (r > 300) { band = "normal"; grade = ["above the ARDS range", "ARDS सीमा से ऊपर"]; }
      else if (peep === null || peep < 5) { grade = ["not graded: Berlin needs PEEP 5 or more", "ग्रेड नहीं: बर्लिन के लिए PEEP 5 या अधिक चाहिए"]; }
      else if (r > 200) { band = "caution"; grade = ["mild ARDS range", "हल्का ARDS"]; }
      else if (r > 100) { band = "danger"; grade = ["moderate ARDS range", "मध्यम ARDS"]; }
      else { band = "danger"; grade = ["severe ARDS range", "गंभीर ARDS"]; }
      if (r <= 300 && (peep === null || peep < 5)) lines.push({ en: "Berlin grading needs PEEP or CPAP of at least 5 cmH2O. Enter it to grade.", hi: "बर्लिन ग्रेडिंग के लिए कम से कम 5 cmH2O PEEP या CPAP चाहिए। ग्रेड के लिए इसे भरें।" });
      lines.push({ en: "Mild may be on CPAP; moderate and severe need PEEP of 5 or more.", hi: "हल्का CPAP पर हो सकता है; मध्यम और गंभीर के लिए 5 या अधिक PEEP चाहिए।" });
      lines.push({ en: "Berlin also needs onset within 1 week and bilateral opacities on imaging.", hi: "बर्लिन में 1 सप्ताह के भीतर शुरुआत और इमेजिंग पर दोनों तरफ़ धुंधलापन भी चाहिए।" });
      lines.push({ en: "The 2024 global definition also accepts SpO2/FiO2 and patients on HFNO at 30 L/min or more.", hi: "2024 की वैश्विक परिभाषा SpO2/FiO2 और 30 L/min या अधिक HFNO वाले मरीज़ भी स्वीकार करती है।" });
      lines.push({ en: "Respiratory failure must not be fully explained by heart failure or fluid overload.", hi: "श्वसन विफलता पूरी तरह हार्ट फेल्योर या अधिक तरल से न समझाई जा सके।" });
      var out = { ok: true, value: r, unit: "mmHg", label: { en: "P/F " + r + " mmHg: " + grade[0], hi: "P/F " + r + " mmHg: " + grade[1] }, lines: lines,
        rule: { en: "Berlin definition (2012): P/F = PaO2 (mmHg) / FiO2. On PEEP or CPAP of 5 or more: 201 to 300 mild, 101 to 200 moderate, 100 or less severe. 1 kPa = 7.5 mmHg.",
          hi: "बर्लिन परिभाषा (2012): P/F = PaO2 (mmHg) / FiO2। 5 या अधिक PEEP या CPAP पर: 201 से 300 हल्का, 101 से 200 मध्यम, 100 या कम गंभीर। 1 kPa = 7.5 mmHg।" } };
      if (band) out.band = band;
      return out;
    },
    examples: [
      { values: { pao2: 80, unit: "mmHg", fio2: 0.5, peep: 10 }, expect: { value: 160, band: "danger", label: "P/F 160 mmHg: moderate ARDS range" } },
      { values: { pao2: 60, unit: "mmHg", fio2: 1, peep: 12 }, expect: { value: 60, label: "P/F 60 mmHg: severe ARDS range" } },
      { values: { pao2: 120, unit: "mmHg", fio2: 0.4, peep: 5 }, expect: { value: 300, band: "caution" } },
      { values: { pao2: 95, unit: "mmHg", fio2: 0.21 }, expect: { value: 452, band: "normal" } },
      { values: { pao2: 10, unit: "kPa", fio2: 0.4, peep: 8 }, expect: { value: 188, band: "danger" } }
    ]
  };
});
