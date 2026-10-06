/* Narkē calculator model: paediatric tracheal tube size and depth (age formulas over 1 year, weight bands in neonates). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function o(v, en, hi) { return { value: v, label: { en: en, hi: hi } }; }
  return {
    id: "paeds-ett", kind: "tool", group: "anaesthesia", level: "mbbs", review: "ai_drafted",
    title: { en: "Paediatric tracheal tube size and depth", hi: "बच्चों में ट्रेकियल ट्यूब का साइज़ और गहराई" },
    sources: [
      { label: "Endotracheal Tube. StatPearls (NCBI Bookshelf): uncuffed age/4 + 4; cuffed age/4 + 3, or age/4 + 3.5 (Duracher)", url: "https://www.ncbi.nlm.nih.gov/books/NBK539747/" },
      { label: "Lau N, et al. New formulae for predicting tracheal tube length. Paediatr Anaesth 2006;16:1238-43 (tests the APLS depths age/2 + 12 oral and age/2 + 15 nasal)", url: "https://pubmed.ncbi.nlm.nih.gov/17121553/" },
      { label: "ANZCOR Guideline 13.5: Tracheal intubation and ventilation of the newborn (tube size by weight; depth at lip = weight + 6 cm)", url: "https://www.anzcor.org/home/neonatal-resuscitation/guideline-13-5-tracheal-intubation-and-ventilation-of-the-newborn" }
    ],
    inputs: [
      { id: "mode", label: { en: "Patient", hi: "रोगी" }, type: "select", required: true,
        options: [o("child", "Child 1 to 10 years (by age)", "बच्चा 1 से 10 वर्ष (आयु से)"), o("neonate", "Newborn (by weight)", "नवजात (वज़न से)")] },
      { id: "age", label: { en: "Age (child)", hi: "आयु (बच्चा)" }, type: "number", unit: "years", min: 1, max: 10, step: 0.5 },
      { id: "weight", label: { en: "Weight (newborn)", hi: "वज़न (नवजात)" }, type: "number", unit: "kg", min: 0.4, max: 6, step: 0.1 }
    ],
    compute: function (v) {
      v = v || {};
      if (v.mode === "neonate") {
        var w = num(v.weight);
        if (w === null || w < 0.4 || w > 6) return bad("Enter the newborn's weight, 0.4 to 6 kg.", "नवजात का वज़न दें, 0.4 से 6 किग्रा।");
        var size = w < 1 ? 2.5 : w < 2 ? 3 : 3.5, txt = w > 3 ? "3.5 or 4.0" : size.toFixed(1), depth = Math.round((w + 6) * 10) / 10;
        return { ok: true, value: size, unit: "mm ID", depth: depth, label: { en: "Tube " + txt + " mm ID, " + depth + " cm at the lip", hi: "ट्यूब " + txt + " mm ID, होंठ पर " + depth + " cm" },
          lines: [
            { en: "Weight bands: under 1 kg 2.5 mm, 1 to 2 kg 3.0 mm, 2 to 3 kg 3.5 mm, over 3 kg 3.5 or 4.0 mm.", hi: "वज़न के हिसाब से: 1 किग्रा से कम 2.5 mm, 1 से 2 किग्रा 3.0 mm, 2 से 3 किग्रा 3.5 mm, 3 किग्रा से अधिक 3.5 या 4.0 mm।" },
            { en: "Oral depth from the upper lip: weight in kg + 6 cm.", hi: "ऊपरी होंठ से मुँह की गहराई: वज़न किग्रा में + 6 cm।" },
            { en: "In very preterm babies a gestation table is more precise. Confirm with capnography and chest movement.", hi: "बहुत प्रीटर्म शिशुओं में गर्भकाल तालिका अधिक सटीक है। कैप्नोग्राफी और छाती की गति से पुष्टि करें।" }
          ],
          rule: { en: "Newborn: tube size by weight band; oral depth at the lip = weight (kg) + 6 cm.", hi: "नवजात: वज़न के हिसाब से ट्यूब साइज़; होंठ पर मुँह की गहराई = वज़न (किग्रा) + 6 cm।" } };
      }
      if (v.mode !== "child") return bad("Choose child or newborn.", "बच्चा या नवजात चुनें।");
      var a = num(v.age);
      if (a === null || a < 1 || a > 10) return bad("Enter the child's age, 1 to 10 years.", "बच्चे की आयु दें, 1 से 10 वर्ष।");
      var un = r2(a / 4 + 4), cu = r2(a / 4 + 3.5), oral = r2(a / 2 + 12), nasal = r2(a / 2 + 15);
      return { ok: true, value: un, unit: "mm ID", depth: oral, label: { en: "Uncuffed " + un + " mm, cuffed " + cu + " mm ID", hi: "बिना कफ़ " + un + " mm, कफ़ वाली " + cu + " mm ID" },
        lines: [
          { en: "Oral depth at the lips " + oral + " cm; nasal depth " + nasal + " cm.", hi: "होंठ पर मुँह की गहराई " + oral + " cm; नाक से गहराई " + nasal + " cm।" },
          { en: "Pick the nearest half size. Keep a half size smaller and larger ready.", hi: "निकटतम आधा साइज़ चुनें। आधा साइज़ छोटी और बड़ी ट्यूब भी तैयार रखें।" },
          { en: "Some use age/4 + 3 for cuffed tubes. Check cuff pressure and the leak.", hi: "कुछ लोग कफ़ वाली ट्यूब के लिए age/4 + 3 लेते हैं। कफ़ प्रेशर और लीक जाँचें।" },
          { en: "Formulas are estimates. Confirm position with capnography, auscultation and chest movement.", hi: "सूत्र केवल अनुमान हैं। कैप्नोग्राफी, ऑस्कल्टेशन और छाती की गति से स्थिति की पुष्टि करें।" }
        ],
        rule: { en: "Over 1 year: uncuffed ID = age/4 + 4; cuffed ID = age/4 + 3.5; oral depth = age/2 + 12 cm; nasal depth = age/2 + 15 cm.",
          hi: "1 वर्ष से ऊपर: बिना कफ़ ID = आयु/4 + 4; कफ़ वाली ID = आयु/4 + 3.5; मुँह की गहराई = आयु/2 + 12 cm; नाक की गहराई = आयु/2 + 15 cm।" } };
    },
    examples: [
      { values: { mode: "child", age: 2 }, expect: { value: 4.5, depth: 13 } },
      { values: { mode: "child", age: 6 }, expect: { value: 5.5, depth: 15 } },
      { values: { mode: "child", age: 5 }, expect: { value: 5.25, depth: 14.5 } },
      { values: { mode: "neonate", weight: 0.8 }, expect: { value: 2.5, depth: 6.8 } },
      { values: { mode: "neonate", weight: 1.5 }, expect: { value: 3, depth: 7.5 } },
      { values: { mode: "neonate", weight: 3.5 }, expect: { value: 3.5, depth: 9.5 } }
    ]
  };
});
