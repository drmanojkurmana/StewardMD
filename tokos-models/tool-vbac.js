/* Tokos calculator model: MFMU 2021 VBAC (TOLAC success) calculator without race and ethnicity. Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function flag(v) { return v === true || v === "true" || v === 1 || v === "1"; }
  return {
    id: "vbac", kind: "tool", group: "obstetrics", level: "resident", review: "ai_drafted",
    title: { en: "VBAC success (MFMU 2021)", hi: "वीबीएसी सफलता (एमएफएमयू 2021)" },
    sources: [
      { label: "Grobman WA et al. Prediction of vaginal birth after cesarean in term gestations: a calculator without race and ethnicity. Am J Obstet Gynecol 2021;225:664.e1-7 (equation and Table 3)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8611105/" },
      { label: "MFMU Network VBAC calculator", url: "https://mfmunetwork.bsc.gwu.edu/web/mfmunetwork/vaginal-birth-after-cesarean-calculator" }
    ],
    inputs: [
      { id: "age", label: { en: "Maternal age", hi: "माँ की आयु" }, type: "number", unit: "years", min: 14, max: 55, step: 1, required: true },
      { id: "weight", label: { en: "Pre-pregnancy weight", hi: "गर्भधारण से पहले वज़न" }, type: "number", unit: "kg", min: 30, max: 200, step: 1, required: true },
      { id: "height", label: { en: "Height", hi: "ऊँचाई" }, type: "number", unit: "cm", min: 120, max: 200, step: 1, required: true },
      { id: "arrest", label: { en: "Arrest of dilation or descent was the indication for the prior cesarean", hi: "पिछले सिज़ेरियन का कारण फैलाव या अवतरण का रुकना था" }, type: "bool" },
      { id: "priorVaginal", label: { en: "Previous vaginal birth", hi: "पहले योनि प्रसव" }, type: "select", required: true,
        options: [{ value: "none", label: { en: "No previous vaginal birth", hi: "कोई पूर्व योनि प्रसव नहीं" } },
                  { value: "before", label: { en: "Vaginal birth only before the prior cesarean", hi: "योनि प्रसव केवल पिछले सिज़ेरियन से पहले" } },
                  { value: "vbac", label: { en: "Previous VBAC", hi: "पहले वीबीएसी हो चुका" } }] },
      { id: "htn", label: { en: "Treated chronic hypertension", hi: "उपचारित दीर्घकालिक उच्च रक्तचाप" }, type: "bool" }
    ],
    compute: function (v) {
      v = v || {}; var a = num(v.age), w = num(v.weight), h = num(v.height);
      if (a === null || a < 14 || a > 55 || w === null || w < 30 || w > 200 || h === null || h < 120 || h > 200) return bad("Enter age 14 to 55 years, weight 30 to 200 kg and height 120 to 200 cm.", "आयु 14 से 55 वर्ष, वज़न 30 से 200 किग्रा और ऊँचाई 120 से 200 सेमी दें।");
      var pv = v.priorVaginal; if (pv !== "none" && pv !== "before" && pv !== "vbac") return bad("Choose the previous vaginal birth history.", "पूर्व योनि प्रसव का इतिहास चुनें।");
      var x = -5.952 - 0.023 * a - 0.024 * w + 0.056 * h - 0.597 * (flag(v.arrest) ? 1 : 0) + (pv === "before" ? 0.868 : pv === "vbac" ? 1.869 : 0) - 0.966 * (flag(v.htn) ? 1 : 0);
      var p = Math.round(1000 * Math.exp(x) / (1 + Math.exp(x))) / 10;
      return { ok: true, value: p, unit: "%", label: { en: "Predicted chance of VBAC " + p + "%", hi: "वीबीएसी की अनुमानित संभावना " + p + "%" },
        lines: [{ en: "Derived in term, singleton, cephalic pregnancies with one prior low-transverse cesarean, using data available at the first prenatal visit. It does not use race or ethnicity.", hi: "एक पिछले निम्न अनुप्रस्थ सिज़ेरियन वाली पूर्ण-अवधि, एकल, सिर-प्रस्तुति गर्भावस्थाओं पर विकसित, पहली प्रसवपूर्व विज़िट के आँकड़ों से। इसमें नस्ल या जातीयता का उपयोग नहीं।" },
                { en: "A probability to inform counselling, not a decision by itself. The published coefficients are rounded, so results can differ from the MFMU web calculator by up to about 0.5 percentage points.", hi: "परामर्श के लिए संभावना है, अकेले निर्णय नहीं। प्रकाशित गुणांक पूर्णांकित हैं, इसलिए परिणाम एमएफएमयू वेब कैलकुलेटर से लगभग 0.5 प्रतिशत अंक तक भिन्न हो सकते हैं।" },
                { en: "Derived in a US cohort and not validated in Indian women. Their shorter height lowers the predicted value.", hi: "अमेरिकी समूह पर विकसित, भारतीय महिलाओं में मान्य नहीं। कम ऊँचाई से अनुमानित मान घटता है।" }],
        rule: { en: "P = 100 x exp(w) / (1 + exp(w)); w = -5.952 - 0.023 age - 0.024 weight(kg) + 0.056 height(cm) - 0.597 arrest indication + 0.868 vaginal birth only before prior cesarean + 1.869 previous VBAC - 0.966 treated chronic hypertension (yes = 1).",
          hi: "P = 100 x exp(w) / (1 + exp(w)); w = -5.952 - 0.023 आयु - 0.024 वज़न(किग्रा) + 0.056 ऊँचाई(सेमी) - 0.597 रुकना-कारण + 0.868 केवल पिछले सिज़ेरियन से पहले योनि प्रसव + 1.869 पूर्व वीबीएसी - 0.966 उपचारित उच्च रक्तचाप (हाँ = 1)।" } };
    },
    examples: [
      { values: { age: 30, weight: 71, height: 171, priorVaginal: "vbac" }, expect: { value: 95.6 }, tol: 0.5 },
      { values: { age: 30, weight: 71, height: 156, priorVaginal: "vbac" }, expect: { value: 90.5 }, tol: 0.5 },
      { values: { age: 30, weight: 71, height: 156, priorVaginal: "before" }, expect: { value: 77.7 }, tol: 0.5 },
      { values: { age: 30, weight: 71, height: 171, priorVaginal: "none" }, expect: { value: 77.2 }, tol: 0.5 },
      { values: { age: 30, weight: 44, height: 156, priorVaginal: "none" }, expect: { value: 73.4 }, tol: 0.5 },
      { values: { age: 23, weight: 71, height: 156, priorVaginal: "none" }, expect: { value: 63.3 }, tol: 0.5 },
      { values: { age: 30, weight: 71, height: 156, priorVaginal: "none" }, expect: { value: 59.4 }, tol: 0.5 },
      { values: { age: 37, weight: 71, height: 156, priorVaginal: "none" }, expect: { value: 55.4 }, tol: 0.5 },
      { values: { age: 23, weight: 71, height: 156, priorVaginal: "none", arrest: true }, expect: { value: 48.7 }, tol: 0.5 },
      { values: { age: 30, weight: 71, height: 156, priorVaginal: "none", arrest: true }, expect: { value: 44.6 }, tol: 0.5 },
      { values: { age: 30, weight: 71, height: 156, priorVaginal: "none", htn: true }, expect: { value: 35.8 }, tol: 0.5 },
      { values: { age: 37, weight: 71, height: 156, priorVaginal: "none", htn: true }, expect: { value: 32.1 }, tol: 0.5 }
    ]
  };
});
