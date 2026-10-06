/* Narkē calculator model: dosing weights (Devine IBW, Janmahasatian LBW, adjusted weight, BMI). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function r1(x) { return Math.round(x * 10) / 10; }
  return {
    id: "dosing-weight", kind: "tool", group: "anaesthesia", level: "resident", review: "ai_drafted",
    title: { en: "Dosing weight (IBW, LBW, adjusted, BMI)", hi: "खुराक के लिए वज़न (IBW, LBW, एडजस्टेड, BMI)" },
    sources: [
      { label: "Pai MP, Paloucek FP. The origin of the ideal body weight equations. Ann Pharmacother 2000;34:1066-9 (Devine: 50 kg men, 45.5 kg women, plus 2.3 kg per inch over 5 feet)", url: "https://pubmed.ncbi.nlm.nih.gov/10981254/" },
      { label: "Janmahasatian S, et al. Quantification of lean bodyweight. Clin Pharmacokinet 2005;44:1051-65", url: "https://pubmed.ncbi.nlm.nih.gov/16176118/" },
      { label: "Ingrande J, Brodsky JB, Lemmens HJ. Lean body weight scalar for the anesthetic induction dose of propofol in morbidly obese subjects. Anesth Analg 2011;113:57-62", url: "https://pubmed.ncbi.nlm.nih.gov/20861415/" },
      { label: "Lemmens HJ, Brodsky JB. The dose of succinylcholine in morbid obesity. Anesth Analg 2006;102:438-42", url: "https://pubmed.ncbi.nlm.nih.gov/16428539/" }
    ],
    inputs: [
      { id: "sex", label: { en: "Sex", hi: "लिंग" }, type: "select", required: true, options: [{ value: "m", label: { en: "Male", hi: "पुरुष" } }, { value: "f", label: { en: "Female", hi: "महिला" } }] },
      { id: "height", label: { en: "Height", hi: "लंबाई" }, type: "number", unit: "cm", min: 120, max: 230, step: 1, required: true },
      { id: "weight", label: { en: "Actual body weight", hi: "वास्तविक वज़न" }, type: "number", unit: "kg", min: 30, max: 300, step: 0.5, required: true }
    ],
    compute: function (v) {
      v = v || {}; var h = num(v.height), w = num(v.weight), male = v.sex === "m";
      if (v.sex !== "m" && v.sex !== "f") return bad("Choose the sex.", "लिंग चुनें।");
      if (h === null || h < 120 || h > 230) return bad("Height must be 120 to 230 cm.", "लंबाई 120 से 230 cm हो।");
      if (w === null || w < 30 || w > 300) return bad("Weight must be 30 to 300 kg.", "वज़न 30 से 300 किग्रा हो।");
      var bmi = w / Math.pow(h / 100, 2), ibw = (male ? 50 : 45.5) + 2.3 * (h / 2.54 - 60);
      var lbw = male ? 9270 * w / (6680 + 216 * bmi) : 9270 * w / (8780 + 244 * bmi), lines = [];
      lines.push({ en: "BMI " + r1(bmi) + " kg/m2.", hi: "BMI " + r1(bmi) + " kg/m2।" });
      lines.push({ en: "Ideal body weight (Devine) " + r1(ibw) + " kg.", hi: "आदर्श वज़न (डिवाइन) " + r1(ibw) + " किग्रा।" });
      if (w > ibw) lines.push({ en: "Adjusted body weight " + r1(ibw + 0.4 * (w - ibw)) + " kg (IBW + 0.4 x excess).", hi: "एडजस्टेड वज़न " + r1(ibw + 0.4 * (w - ibw)) + " किग्रा (IBW + 0.4 x अतिरिक्त वज़न)।" });
      else lines.push({ en: "Actual weight is at or below IBW, so no adjusted weight is needed.", hi: "वास्तविक वज़न IBW के बराबर या कम है, एडजस्टेड वज़न की ज़रूरत नहीं।" });
      if (h < 152.4) lines.push({ en: "Devine is defined above 152.4 cm (5 feet). Below that it is only an extrapolation.", hi: "डिवाइन सूत्र 152.4 cm (5 फ़ुट) से ऊपर के लिए है। उससे कम पर यह केवल अनुमान है।" });
      lines.push({ en: "Morbid obesity: propofol induction on lean body weight (Ingrande 2011).", hi: "गंभीर मोटापा: प्रोपोफोल इंडक्शन लीन बॉडी वेट पर (इंग्रांडे 2011)।" });
      lines.push({ en: "Morbid obesity: suxamethonium 1 mg/kg on total body weight (Lemmens 2006).", hi: "गंभीर मोटापा: सक्सामेथोनियम 1 mg/kg कुल वज़न पर (लेमेन्स 2006)।" });
      lines.push({ en: "Local anaesthetic maximum dose: use lean body weight in obesity (app LAST protocol).", hi: "लोकल एनेस्थेटिक की अधिकतम खुराक: मोटापे में लीन बॉडी वेट लें (ऐप का LAST प्रोटोकॉल)।" });
      lines.push({ en: "These formulas are for adults.", hi: "ये सूत्र वयस्कों के लिए हैं।" });
      return { ok: true, value: r1(lbw), unit: "kg", bmi: r1(bmi), ibw: r1(ibw), label: { en: "Lean body weight " + r1(lbw) + " kg", hi: "लीन बॉडी वेट " + r1(lbw) + " किग्रा" }, lines: lines,
        rule: { en: "IBW (Devine) = 50 kg (men) or 45.5 kg (women) + 2.3 kg per inch over 60 inches. LBW (Janmahasatian) = 9270 x weight / (6680 + 216 x BMI) in men, or / (8780 + 244 x BMI) in women. Adjusted = IBW + 0.4 x (weight - IBW). BMI = weight / height in m squared.",
          hi: "IBW (डिवाइन) = 50 किग्रा (पुरुष) या 45.5 किग्रा (महिला) + 60 इंच से ऊपर हर इंच पर 2.3 किग्रा। LBW (जनमहासथियन) = 9270 x वज़न / (6680 + 216 x BMI) पुरुषों में, या / (8780 + 244 x BMI) महिलाओं में। एडजस्टेड = IBW + 0.4 x (वज़न - IBW)। BMI = वज़न / लंबाई (मीटर) का वर्ग।" } };
    },
    examples: [
      { values: { sex: "m", height: 175, weight: 100 }, expect: { value: 67.5, bmi: 32.7, ibw: 70.5 } },
      { values: { sex: "f", height: 160, weight: 90 }, expect: { value: 48.1, bmi: 35.2, ibw: 52.4 } },
      { values: { sex: "m", height: 180, weight: 70 }, expect: { value: 57.2, bmi: 21.6, ibw: 75 } }
    ]
  };
});
