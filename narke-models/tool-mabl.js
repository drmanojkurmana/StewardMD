/* Narkē calculator model: maximum allowable blood loss, EBV x (Hi - Hf) / Hi, with the Gross average-haematocrit variant. Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function o(v, en, hi) { return { value: v, label: { en: en, hi: hi } }; }
  // mL/kg. Adults: Morgan and Mikhail 7e average blood volumes. Children: SPA table (Litman 3e), midpoint of each range.
  var EBV = { m: 75, f: 65, c: 70, i: 75, n: 85, p: 95 };
  return {
    id: "mabl", kind: "tool", group: "anaesthesia", level: "mbbs", review: "ai_drafted",
    title: { en: "Maximum allowable blood loss", hi: "अधिकतम स्वीकार्य रक्त हानि" },
    sources: [
      { label: "Society for Pediatric Anesthesia, Question of the Week 176: Allowable Blood Loss (EBV table from Litman's Basics of Pediatric Anesthesia 3e; worked case 6 kg, Hct 36 to 21%)", url: "https://pedsanesthesia.org/wp-content/uploads/2024/01/Week-176-Allowable-Blood-Loss-REV.pdf" },
      { label: "Gross JB. Estimating allowable blood loss: corrected for dilution. Anesthesiology 1983;58:277-80", url: "https://pubmed.ncbi.nlm.nih.gov/6829965/" },
      { label: "Butterworth JF, Mackey DC, Wasnick JD. Morgan and Mikhail's Clinical Anesthesiology 7e, Fluid Management and Blood Component Therapy (average blood volume: adult men 75, women 65 mL/kg)", url: "https://accessanesthesiology.mhmedical.com/book.aspx?bookid=3194" }
    ],
    inputs: [
      { id: "weight", label: { en: "Body weight", hi: "वज़न" }, type: "number", unit: "kg", min: 0.4, max: 200, step: 0.1, required: true },
      { id: "group", label: { en: "Age group (blood volume)", hi: "आयु वर्ग (रक्त आयतन)" }, type: "select", required: true,
        options: [o("m", "Adult man, 75 mL/kg", "वयस्क पुरुष, 75 mL/kg"), o("f", "Adult woman, 65 mL/kg", "वयस्क महिला, 65 mL/kg"), o("c", "Child over 1 year, 70 mL/kg", "1 वर्ष से बड़ा बच्चा, 70 mL/kg"),
                  o("i", "Infant 3 months to 1 year, 75 mL/kg", "शिशु 3 महीने से 1 वर्ष, 75 mL/kg"), o("n", "Term neonate, 85 mL/kg", "पूर्ण-अवधि नवजात, 85 mL/kg"), o("p", "Preterm neonate, 95 mL/kg", "समय से पहले जन्मा नवजात, 95 mL/kg")] },
      { id: "hi", label: { en: "Starting haematocrit", hi: "शुरुआती हीमैटोक्रिट" }, type: "number", unit: "%", min: 15, max: 70, step: 1, required: true },
      { id: "hf", label: { en: "Lowest acceptable haematocrit", hi: "न्यूनतम स्वीकार्य हीमैटोक्रिट" }, type: "number", unit: "%", min: 10, max: 60, step: 1, required: true }
    ],
    compute: function (v) {
      v = v || {}; var w = num(v.weight), f = EBV[v.group], a = num(v.hi), b = num(v.hf);
      if (w === null || w < 0.4 || w > 200) return bad("Weight must be 0.4 to 200 kg.", "वज़न 0.4 से 200 किग्रा हो।");
      if (!f) return bad("Choose the age group.", "आयु वर्ग चुनें।");
      if (a === null || a < 15 || a > 70 || b === null || b < 10 || b > 60) return bad("Enter haematocrit as a percent: start 15 to 70, lowest 10 to 60.", "हीमैटोक्रिट प्रतिशत में दें: शुरुआती 15 से 70, न्यूनतम 10 से 60।");
      if (b >= a) return bad("The lowest acceptable haematocrit must be below the starting value.", "न्यूनतम स्वीकार्य हीमैटोक्रिट शुरुआती मान से कम हो।");
      var ebv = Math.round(w * f * 10) / 10, abl = Math.round(ebv * (a - b) / a), gross = Math.round(ebv * (a - b) / ((a + b) / 2));
      return { ok: true, value: abl, unit: "mL", label: { en: "Allowable blood loss " + abl + " mL", hi: "स्वीकार्य रक्त हानि " + abl + " mL" },
        lines: [
          { en: "Estimated blood volume " + ebv + " mL (" + f + " mL/kg).", hi: "अनुमानित रक्त आयतन " + ebv + " mL (" + f + " mL/kg)।" },
          { en: "Gross variant, average haematocrit in the denominator: " + gross + " mL.", hi: "ग्रॉस रूप, हर में औसत हीमैटोक्रिट: " + gross + " mL।" },
          { en: "The Gross variant allows for dilution as losses are replaced with clear fluid.", hi: "ग्रॉस रूप, साफ़ तरल से नुकसान पूरा करने पर होने वाले डाइल्यूशन का ध्यान रखता है।" },
          { en: "This is an estimate, not a transfusion trigger. Judge by haemoglobin, ongoing loss and haemodynamics.", hi: "यह अनुमान है, ट्रांसफ्यूज़न का नियम नहीं। हीमोग्लोबिन, चल रही हानि और हीमोडायनामिक्स देखकर तय करें।" }
        ],
        rule: { en: "MABL = EBV x (Hi - Hf) / Hi, where EBV = weight x mL/kg for the age group. Gross 1983 uses (Hi + Hf) / 2 as the denominator.",
          hi: "MABL = EBV x (Hi - Hf) / Hi, जहाँ EBV = वज़न x आयु वर्ग का mL/kg। ग्रॉस 1983 हर में (Hi + Hf) / 2 लेते हैं।" } };
    },
    examples: [
      { values: { weight: 70, group: "m", hi: 42, hf: 30 }, expect: { value: 1500 } },
      { values: { weight: 60, group: "f", hi: 39, hf: 27 }, expect: { value: 1200 } },
      { values: { weight: 6, group: "i", hi: 36, hf: 21 }, expect: { value: 188 } },
      { values: { weight: 1.5, group: "p", hi: 45, hf: 35 }, expect: { value: 32 } }
    ]
  };
});
