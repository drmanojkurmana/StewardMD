/* Tokos calculator model: gestational weight gain by pre-pregnancy BMI (IOM 2009). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function flag(v) { return v === true || v === "true" || v === 1 || v === "1"; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function r2(x) { return Math.round(x * 100) / 100; }
  // IOM 2009: total kg, weekly rate kg (mean, low, high) in 2nd and 3rd trimesters; twins kg (ACOG CO 548).
  var CAT = [
    { id: "under", en: "Underweight", hi: "कम वज़न", tot: [12.5, 18], rate: [0.44, 0.58], mean: 0.51, twin: null },
    { id: "normal", en: "Normal weight", hi: "सामान्य वज़न", tot: [11.5, 16], rate: [0.35, 0.5], mean: 0.42, twin: [16.8, 24.5] },
    { id: "over", en: "Overweight", hi: "अधिक वज़न", tot: [7, 11.5], rate: [0.23, 0.33], mean: 0.28, twin: [14.1, 22.7] },
    { id: "obese", en: "Obese", hi: "मोटापा", tot: [5, 9], rate: [0.17, 0.27], mean: 0.22, twin: [11.3, 19.1] }
  ];
  return {
    id: "weightgain", kind: "tool", group: "obstetrics", level: "mbbs", review: "ai_drafted",
    title: { en: "Gestational weight gain (IOM 2009)", hi: "गर्भावस्था में वज़न वृद्धि (आईओएम 2009)" },
    sources: [
      { label: "ACOG Committee Opinion 548: Weight Gain During Pregnancy (IOM 2009 Table 1; twin ranges)", url: "https://www.acog.org/-/media/project/acog/acogorg/clinical/files/committee-opinion/articles/2013/01/weight-gain-during-pregnancy.pdf" },
      { label: "IOM 2009 kg ranges and kg/week rates quoted in PMC6693141", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6693141/" },
      { label: "Same values quoted in PMC12303350 (western India cohort)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12303350/" }
    ],
    inputs: [
      { id: "weight", label: { en: "Pre-pregnancy weight", hi: "गर्भधारण से पहले वज़न" }, type: "number", unit: "kg", min: 30, max: 200, step: 0.1, required: true },
      { id: "height", label: { en: "Height", hi: "ऊँचाई" }, type: "number", unit: "cm", min: 120, max: 200, step: 0.5, required: true },
      { id: "twins", label: { en: "Twin pregnancy", hi: "जुड़वाँ गर्भावस्था" }, type: "bool" },
      { id: "current", label: { en: "Current weight (optional)", hi: "वर्तमान वज़न (वैकल्पिक)" }, type: "number", unit: "kg", min: 30, max: 250, step: 0.1 },
      { id: "ga", label: { en: "Gestational age (optional)", hi: "गर्भावस्था की अवधि (वैकल्पिक)" }, type: "number", unit: "weeks", min: 4, max: 42, step: 1 }
    ],
    compute: function (v) {
      v = v || {}; var w = num(v.weight), h = num(v.height);
      if (w === null || w < 30 || w > 200 || h === null || h < 120 || h > 200) return bad("Enter weight 30 to 200 kg and height 120 to 200 cm.", "वज़न 30 से 200 किग्रा और ऊँचाई 120 से 200 सेमी दें।");
      var bmi = r1(w / Math.pow(h / 100, 2)), c = bmi < 18.5 ? CAT[0] : bmi < 25 ? CAT[1] : bmi < 30 ? CAT[2] : CAT[3];
      var tw = flag(v.twins);
      if (tw && !c.twin) return bad("IOM gives no twin range for underweight women; data are insufficient.", "कम वज़न वाली महिलाओं के लिए आईओएम जुड़वाँ सीमा नहीं देता; आँकड़े अपर्याप्त हैं।");
      var rg = tw ? c.twin : c.tot;
      var lines = [{ en: "BMI " + bmi + " kg/m2: " + c.en + ".", hi: "बीएमआई " + bmi + " किग्रा/मी2: " + c.hi + "।" },
        { en: "Recommended total gain " + rg[0] + " to " + rg[1] + " kg" + (tw ? " (twins)" : "") + ".", hi: "अनुशंसित कुल वृद्धि " + rg[0] + " से " + rg[1] + " किग्रा" + (tw ? " (जुड़वाँ)" : "") + "।" }];
      if (!tw) lines.push({ en: "Second and third trimester rate " + c.rate[0] + " to " + c.rate[1] + " kg per week (mean " + c.mean + "); first trimester assumed gain 0.5 to 2 kg.", hi: "दूसरी और तीसरी तिमाही में दर " + c.rate[0] + " से " + c.rate[1] + " किग्रा प्रति सप्ताह (औसत " + c.mean + "); पहली तिमाही में 0.5 से 2 किग्रा मानी गई।" });
      var band;
      var cur = v.current === undefined || v.current === "" ? null : num(v.current), ga = v.ga === undefined || v.ga === "" ? null : num(v.ga);
      if (tw && (cur !== null || ga !== null)) lines.push({ en: "Progress against weekly rates is not checked for twins; IOM gives only total ranges.", hi: "जुड़वाँ में साप्ताहिक दर से प्रगति नहीं जाँची जाती; आईओएम केवल कुल सीमा देता है।" });
      if (bmi >= 23 && bmi < 25) lines.push({ en: "Indian guidance often uses Asian cut-offs: BMI 23 to 24.9 is overweight, and 25 or more is obese.", hi: "भारतीय मार्गदर्शन अक्सर एशियाई सीमाएँ लेता है: बीएमआई 23 से 24.9 अधिक वज़न, और 25 या अधिक मोटापा।" });
      if (!tw && cur !== null && ga !== null) {
        if (cur < 30 || cur > 250 || ga < 4 || ga > 42) return bad("Current weight 30 to 250 kg and gestational age 4 to 42 weeks.", "वर्तमान वज़न 30 से 250 किग्रा और अवधि 4 से 42 सप्ताह हो।");
        var g = r1(cur - w), n = Math.max(0, ga - 13), lo = r1(0.5 + c.rate[0] * n), hi = r1(2 + c.rate[1] * n);
        if (ga <= 13) { lo = 0.5; hi = 2; }
        band = g < lo ? "caution" : g > hi ? "danger" : "normal";
        lines.push({ en: "Gain so far " + g + " kg; expected to date about " + lo + " to " + hi + " kg (derived: 0.5 to 2 kg by 13 weeks plus the weekly rate after). " + (g < lo ? "Below range." : g > hi ? "Above range." : "Within range."), hi: "अब तक वृद्धि " + g + " किग्रा; अब तक अपेक्षित लगभग " + lo + " से " + hi + " किग्रा (गणना: 13 सप्ताह तक 0.5 से 2 किग्रा और उसके बाद साप्ताहिक दर)। " + (g < lo ? "सीमा से कम।" : g > hi ? "सीमा से अधिक।" : "सीमा के भीतर।") });
      }
      var out = { ok: true, value: bmi, unit: "kg/m2", label: { en: c.en + ": gain " + rg[0] + " to " + rg[1] + " kg", hi: c.hi + ": वृद्धि " + rg[0] + " से " + rg[1] + " किग्रा" }, lines: lines,
        rule: { en: "IOM 2009 by WHO pre-pregnancy BMI: under 18.5 gain 12.5 to 18 kg; 18.5 to 24.9 gain 11.5 to 16 kg; 25 to 29.9 gain 7 to 11.5 kg; 30 or more gain 5 to 9 kg. Twins: normal 16.8 to 24.5, overweight 14.1 to 22.7, obese 11.3 to 19.1 kg. Applies to all ages, parity and ethnic groups per IOM; Asian-specific BMI cut-offs are not used. Indian guidance often classes BMI 23 to 24.9 as overweight and 25 or more as obese.",
          hi: "आईओएम 2009, डब्ल्यूएचओ बीएमआई के अनुसार: 18.5 से कम पर 12.5 से 18 किग्रा; 18.5 से 24.9 पर 11.5 से 16 किग्रा; 25 से 29.9 पर 7 से 11.5 किग्रा; 30 या अधिक पर 5 से 9 किग्रा। जुड़वाँ: सामान्य 16.8 से 24.5, अधिक वज़न 14.1 से 22.7, मोटापा 11.3 से 19.1 किग्रा। आईओएम के अनुसार सभी आयु, प्रसव संख्या और जातीय समूहों पर लागू; एशियाई बीएमआई सीमाएँ प्रयुक्त नहीं। भारतीय मार्गदर्शन में अक्सर बीएमआई 23 से 24.9 अधिक वज़न और 25 या अधिक मोटापा माना जाता है।" } };
      if (band) out.band = band;
      return out;
    },
    examples: [
      { values: { weight: 50, height: 170 }, expect: { value: 17.3 } },
      { values: { weight: 60, height: 165 }, expect: { value: 22, label: "Normal weight: gain 11.5 to 16 kg" } },
      { values: { weight: 75, height: 165 }, expect: { value: 27.5, label: "Overweight: gain 7 to 11.5 kg" } },
      { values: { weight: 95, height: 165 }, expect: { value: 34.9, label: "Obese: gain 5 to 9 kg" } },
      { values: { weight: 60, height: 165, twins: true }, expect: { label: "Normal weight: gain 16.8 to 24.5 kg" } },
      { values: { weight: 60, height: 165, current: 68, ga: 30 }, expect: { band: "normal" } }
    ]
  };
});
