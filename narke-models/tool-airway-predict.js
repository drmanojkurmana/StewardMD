/* Narkē calculator model: bedside airway assessment summary (predictors present, not a probability). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function o(v, en, hi) { return { value: v, label: { en: en, hi: hi } }; }
  return {
    id: "airway-predict", kind: "tool", group: "anaesthesia", level: "resident", review: "ai_drafted",
    title: { en: "Airway assessment summary", hi: "वायुमार्ग आकलन सारांश" },
    sources: [
      { label: "Apfelbaum JL, et al. Practice guidelines for management of the difficult airway (ASA Task Force). Anesthesiology 2013;118:251-70: uvula not visible (Mallampati over II), interincisor gap under 3 cm, chin cannot touch chest or neck cannot extend", url: "https://pubmed.ncbi.nlm.nih.gov/23364566/" },
      { label: "Samsoon GL, Young JR. Difficult tracheal intubation: a retrospective study. Anaesthesia 1987;42:487-90 (modified Mallampati, classes I to IV)", url: "https://pubmed.ncbi.nlm.nih.gov/3592174/" },
      { label: "e-Safe Anaesthesia (RCoA and NHS England e-learning). Patil test: thyromental distance under 6 cm suggests difficult laryngoscopy", url: "https://www.e-safe-anaesthesia.org/sessions/03_01/d/ELFH_Session/522/tab_623.html" },
      { label: "Khan ZH, et al. A comparison of the upper lip bite test with modified Mallampati classification. Anesth Analg 2003;96:595-9 (class III: lower incisors cannot bite the upper lip)", url: "https://pubmed.ncbi.nlm.nih.gov/12538218/" }
    ],
    inputs: [
      { id: "mp", label: { en: "Modified Mallampati class", hi: "मॉडिफ़ाइड मल्लमपाटी वर्ग" }, type: "select", required: true,
        options: [o("1", "I: soft palate, fauces, uvula, pillars seen", "I: नरम तालु, फ़ॉसेस, यूवुला, पिलर दिखते हैं"), o("2", "II: soft palate, fauces, uvula seen", "II: नरम तालु, फ़ॉसेस, यूवुला दिखते हैं"),
                  o("3", "III: soft palate, base of uvula seen", "III: नरम तालु, यूवुला का आधार दिखता है"), o("4", "IV: soft palate not seen", "IV: नरम तालु नहीं दिखता")] },
      { id: "mouth", label: { en: "Mouth opening (interincisor gap)", hi: "मुँह खुलना (दाँतों के बीच दूरी)" }, type: "number", unit: "cm", min: 0, max: 8, step: 0.1 },
      { id: "tmd", label: { en: "Thyromental distance", hi: "थायरोमेंटल दूरी" }, type: "number", unit: "cm", min: 1, max: 15, step: 0.1 },
      { id: "neck", label: { en: "Neck movement", hi: "गर्दन की गति" }, type: "select", required: true,
        options: [o("normal", "Chin touches chest and neck extends", "ठुड्डी छाती छूती है और गर्दन पीछे जाती है"), o("limited", "Cannot touch chin to chest, or cannot extend", "ठुड्डी छाती तक नहीं जाती, या गर्दन पीछे नहीं जाती")] },
      { id: "ulbt", label: { en: "Upper lip bite test", hi: "अपर लिप बाइट टेस्ट" }, type: "select", required: true,
        options: [o("1", "Class I: lower incisors bite above the vermilion line", "वर्ग I: निचले दाँत वर्मिलियन रेखा से ऊपर काटते हैं"), o("2", "Class II: bite below the vermilion line", "वर्ग II: वर्मिलियन रेखा से नीचे काटते हैं"), o("3", "Class III: cannot bite the upper lip", "वर्ग III: ऊपरी होंठ नहीं काट पाते")] }
    ],
    compute: function (v) {
      v = v || {}; var mp = +v.mp, ul = +v.ulbt, mo = num(v.mouth), tm = num(v.tmd), found = [], lines = [];
      if (!(mp >= 1 && mp <= 4 && mp % 1 === 0)) return bad("Choose a Mallampati class.", "मल्लमपाटी वर्ग चुनें।");
      if (!(ul >= 1 && ul <= 3 && ul % 1 === 0)) return bad("Choose an upper lip bite class.", "अपर लिप बाइट वर्ग चुनें।");
      if (v.neck !== "normal" && v.neck !== "limited") return bad("Choose the neck movement.", "गर्दन की गति चुनें।");
      if (mo !== null && (mo < 0 || mo > 8)) return bad("Mouth opening must be 0 to 8 cm.", "मुँह खुलना 0 से 8 cm हो।");
      if (tm !== null && (tm < 1 || tm > 15)) return bad("Thyromental distance must be 1 to 15 cm.", "थायरोमेंटल दूरी 1 से 15 cm हो।");
      if (mp >= 3) found.push({ en: "Mallampati class " + (mp === 3 ? "III" : "IV") + " (uvula not fully seen; ASA cut-off over class II).", hi: "मल्लमपाटी वर्ग " + (mp === 3 ? "III" : "IV") + " (यूवुला पूरा नहीं दिखता; ASA सीमा वर्ग II से अधिक)।" });
      if (mo !== null && mo < 3) found.push({ en: "Mouth opening " + mo + " cm (cut-off under 3 cm, ASA).", hi: "मुँह खुलना " + mo + " cm (सीमा 3 cm से कम, ASA)।" });
      if (tm !== null && tm < 6) found.push({ en: "Thyromental distance " + tm + " cm (cut-off under 6 cm, Patil).", hi: "थायरोमेंटल दूरी " + tm + " cm (सीमा 6 cm से कम, पाटिल)।" });
      if (v.neck === "limited") found.push({ en: "Limited neck movement (cannot touch chin to chest or extend, ASA).", hi: "गर्दन की सीमित गति (ठुड्डी छाती तक नहीं या पीछे नहीं जाती, ASA)।" });
      if (ul === 3) found.push({ en: "Upper lip bite class III (Khan 2003).", hi: "अपर लिप बाइट वर्ग III (ख़ान 2003)।" });
      lines = found.slice();
      if (mo === null) lines.push({ en: "Mouth opening not measured.", hi: "मुँह खुलना नहीं मापा गया।" });
      if (tm === null) lines.push({ en: "Thyromental distance not measured.", hi: "थायरोमेंटल दूरी नहीं मापी गई।" });
      if (!found.length) lines.push({ en: "No predictor present. This does not rule out a difficult airway.", hi: "कोई संकेतक नहीं। इससे कठिन वायुमार्ग की संभावना ख़त्म नहीं होती।" });
      lines.push({ en: "Single bedside tests have limited accuracy. This is a list, not a probability.", hi: "अकेली बेडसाइड जाँच सीमित सटीक होती है। यह सूची है, संभावना नहीं।" });
      lines.push({ en: "Have a rescue airway plan for every patient.", hi: "हर रोगी के लिए वायुमार्ग बचाव योजना तैयार रखें।" });
      var n = found.length;
      return { ok: true, value: n, unit: "predictors", band: n >= 3 ? "danger" : n ? "caution" : "normal",
        label: { en: n + (n === 1 ? " predictor" : " predictors") + " of difficult laryngoscopy present", hi: "कठिन लैरिंगोस्कोपी के " + n + " संकेतक मौजूद" }, lines: lines,
        rule: { en: "Predictors: Mallampati III or IV; mouth opening under 3 cm; thyromental distance under 6 cm; chin cannot touch chest or neck cannot extend; upper lip bite class III. The tool lists those present; 3 or more is flagged red.",
          hi: "संकेतक: मल्लमपाटी III या IV; मुँह खुलना 3 cm से कम; थायरोमेंटल दूरी 6 cm से कम; ठुड्डी छाती तक नहीं या गर्दन पीछे नहीं जाती; अपर लिप बाइट वर्ग III। टूल मौजूद संकेतकों की सूची देता है; 3 या अधिक पर लाल चेतावनी।" } };
    },
    examples: [
      { values: { mp: "1", mouth: 4.5, tmd: 7, neck: "normal", ulbt: "1" }, expect: { value: 0, band: "normal" } },
      { values: { mp: "3", mouth: 2.5, tmd: 7, neck: "normal", ulbt: "2" }, expect: { value: 2, band: "caution" } },
      { values: { mp: "4", mouth: 4, tmd: 5.5, neck: "limited", ulbt: "3" }, expect: { value: 4, band: "danger" } },
      { values: { mp: "4", mouth: 2, tmd: 5, neck: "limited", ulbt: "3" }, expect: { value: 5, band: "danger" } },
      { values: { mp: "3", mouth: 2.5, tmd: 5, neck: "normal", ulbt: "1" }, expect: { value: 3, band: "danger" } },
      { values: { mp: "2", neck: "normal", ulbt: "1" }, expect: { value: 0 } }
    ]
  };
});
