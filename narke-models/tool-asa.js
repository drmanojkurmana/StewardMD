/* Narkē calculator model: ASA physical status (ASA statement, amended 2020). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function T(en, hi) { return { en: en, hi: hi }; }
  var ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];
  // Definitions and examples restated in original words from the ASA statement (2020 amendment), adult examples.
  var CLS = [null,
    { def: T("ASA I: a normal healthy patient.", "ASA I: सामान्य स्वस्थ रोगी।"),
      ex: [T("Example: healthy, does not smoke, drinks little or no alcohol.", "उदाहरण: स्वस्थ, धूम्रपान नहीं करता, शराब बहुत कम या नहीं पीता।")] },
    { def: T("ASA II: mild systemic disease that does not limit daily function.", "ASA II: हल्का प्रणालीगत रोग जो रोज़ के काम को सीमित नहीं करता।"),
      ex: [T("Examples: current smoker, social drinker, pregnancy, BMI 30 to below 40.", "उदाहरण: वर्तमान धूम्रपान करने वाला, कभी-कभार शराब, गर्भावस्था, BMI 30 से 40 से कम।"),
           T("Also well controlled diabetes or hypertension, and mild lung disease.", "साथ ही अच्छी तरह नियंत्रित डायबिटीज़ या हाइपरटेंशन, और हल्का फेफड़े का रोग।")] },
    { def: T("ASA III: severe systemic disease with real limits on function.", "ASA III: गंभीर प्रणालीगत रोग जो काम को वास्तव में सीमित करता है।"),
      ex: [T("Examples: poorly controlled diabetes or hypertension, COPD, BMI 40 or more, active hepatitis.", "उदाहरण: खराब नियंत्रित डायबिटीज़ या हाइपरटेंशन, COPD, BMI 40 या अधिक, सक्रिय हेपेटाइटिस।"),
           T("Also alcohol dependence, a pacemaker, moderately reduced ejection fraction, ESRD on regular dialysis.", "साथ ही शराब पर निर्भरता, पेसमेकर, मध्यम रूप से घटा इजेक्शन फ्रैक्शन, नियमित डायलिसिस पर ESRD।"),
           T("Also MI, stroke, TIA or coronary stent more than 3 months ago.", "साथ ही 3 महीने से पहले हुआ MI, स्ट्रोक, TIA या कोरोनरी स्टेंट।")] },
    { def: T("ASA IV: severe systemic disease that is a constant threat to life.", "ASA IV: गंभीर प्रणालीगत रोग जो जीवन के लिए लगातार खतरा है।"),
      ex: [T("Examples: MI, stroke, TIA or coronary stent within the last 3 months, ongoing cardiac ischaemia.", "उदाहरण: पिछले 3 महीने में MI, स्ट्रोक, TIA या कोरोनरी स्टेंट, चल रहा कार्डियक इस्कीमिया।"),
           T("Also severe valve disease, severely reduced ejection fraction, shock, sepsis, DIC.", "साथ ही गंभीर वाल्व रोग, बहुत घटा इजेक्शन फ्रैक्शन, शॉक, सेप्सिस, DIC।"),
           T("Also ESRD not on regular dialysis.", "साथ ही नियमित डायलिसिस के बिना ESRD।")] },
    { def: T("ASA V: a moribund patient not expected to survive without the operation.", "ASA V: मरणासन्न रोगी जिसके ऑपरेशन के बिना बचने की उम्मीद नहीं।"),
      ex: [T("Examples: ruptured abdominal or thoracic aneurysm, massive trauma, intracranial bleed with mass effect.", "उदाहरण: फटा हुआ उदर या वक्ष एन्यूरिज़्म, भारी चोट, मास इफेक्ट के साथ मस्तिष्क में रक्तस्राव।"),
           T("Also ischaemic bowel with major cardiac disease or failure of several organs.", "साथ ही बड़े हृदय रोग या कई अंगों की विफलता के साथ इस्कीमिक आंत।")] },
    { def: T("ASA VI: a declared brain-dead patient whose organs are being removed for donation.", "ASA VI: घोषित ब्रेन-डेड रोगी जिसके अंग दान के लिए निकाले जा रहे हैं।"), ex: [] }
  ];
  function o(v, en, hi) { return { value: v, label: { en: en, hi: hi } }; }
  return {
    id: "asa", kind: "tool", group: "anaesthesia", level: "mbbs", review: "ai_drafted",
    title: { en: "ASA physical status", hi: "ASA फिज़िकल स्टेटस" },
    sources: [
      { label: "American Society of Anesthesiologists. Statement on ASA Physical Status Classification System (amended 15 December 2020)", url: "https://www.asahq.org/standards-and-practice-parameters/statement-on-asa-physical-status-classification-system" },
      { label: "Doyle DJ, Hendrix JM, Garmon EH. American Society of Anesthesiologists Physical Status Classification System. StatPearls (NCBI Bookshelf)", url: "https://www.ncbi.nlm.nih.gov/books/NBK441940/" }
    ],
    inputs: [
      { id: "cls", label: { en: "Physical status class", hi: "फिज़िकल स्टेटस वर्ग" }, type: "select", required: true,
        options: [o("1", "I: normal healthy", "I: सामान्य स्वस्थ"), o("2", "II: mild systemic disease", "II: हल्का प्रणालीगत रोग"), o("3", "III: severe systemic disease", "III: गंभीर प्रणालीगत रोग"),
                  o("4", "IV: constant threat to life", "IV: जीवन के लिए लगातार खतरा"), o("5", "V: moribund", "V: मरणासन्न"), o("6", "VI: brain-dead organ donor", "VI: ब्रेन-डेड अंगदाता")] },
      { id: "emergency", label: { en: "Emergency (delay would increase the threat to life or a body part)", hi: "आपातकाल (देरी से जीवन या किसी अंग का खतरा बढ़ेगा)" }, type: "bool" }
    ],
    compute: function (v) {
      v = v || {}; var c = +v.cls, e = v.emergency === true || v.emergency === "true" || v.emergency === "on";
      if (!(c >= 1 && c <= 6 && c % 1 === 0)) return bad("Choose a class from I to VI.", "I से VI तक एक वर्ग चुनें।");
      var name = ROMAN[c] + (e ? " E" : ""), lines = [CLS[c].def].concat(CLS[c].ex);
      if (e) lines.push(T("E marks an emergency: delay in treatment would clearly add to the threat to life or a body part.", "E आपातकाल दर्शाता है: इलाज में देरी से जीवन या किसी अंग का खतरा साफ़ बढ़ेगा।"));
      lines.push(T("The class is a clinical judgement of health before anaesthesia. It is not a risk score by itself.", "यह वर्ग एनेस्थीसिया से पहले स्वास्थ्य का क्लिनिकल आकलन है। यह अकेले जोखिम स्कोर नहीं है।"));
      lines.push(T("Surgery type, frailty and other factors also shape perioperative risk.", "सर्जरी का प्रकार, कमज़ोरी (फ्रेल्टी) और अन्य कारक भी पेरिऑपरेटिव जोखिम तय करते हैं।"));
      return { ok: true, value: name, band: c <= 2 ? "normal" : c === 3 ? "caution" : "danger",
        label: { en: "ASA " + name, hi: "ASA " + name }, lines: lines,
        rule: { en: "Six classes, I to VI, chosen by clinical judgement from the patient's overall health. Add E when the case is an emergency.",
          hi: "छह वर्ग, I से VI, रोगी के समग्र स्वास्थ्य से क्लिनिकल आकलन द्वारा। आपातकालीन केस में E जोड़ें।" } };
    },
    examples: [
      { values: { cls: "1", emergency: false }, expect: { value: "I", band: "normal" } },
      { values: { cls: "2", emergency: true }, expect: { value: "II E", band: "normal" } },
      { values: { cls: "3", emergency: true }, expect: { value: "III E", band: "caution" } },
      { values: { cls: "4", emergency: false }, expect: { value: "IV", band: "danger" } },
      { values: { cls: "6", emergency: false }, expect: { value: "VI", band: "danger" } }
    ]
  };
});
