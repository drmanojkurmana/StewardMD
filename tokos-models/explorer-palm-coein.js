/* Tokos explorer model: FIGO AUB classification of causes, PALM-COEIN. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.TOKOS_MODELS["palm-coein"].
   classify(findings) turns what was found (polyp, adenomyosis, leiomyoma with its FIGO type 0 to 8, malignancy or
   hyperplasia, coagulopathy, ovulatory dysfunction, endometrial, iatrogenic, not otherwise classified) into the
   PALM-COEIN categories, the leiomyoma group (SM, O or hybrid) and a written form. bleedingPattern(p) applies the
   FIGO normal limits for frequency, duration and regularity. The teaching vignettes live in
   tokos/explorer/palm-coein.json; load them with setVignettes(list), then grade(vignette, answer).
   The FIGO system classifies POTENTIAL causes in women of reproductive age who are not pregnant; several can coexist. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.TOKOS_MODELS = root.TOKOS_MODELS || {}; root.TOKOS_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function T(en, hi) { return { en: en, hi: hi }; }
  var CATEGORIES = [
    { code: "P", key: "polyp", group: "structural", name: T("Polyp", "Polyp (पॉलिप)"),
      def: T("One or more polyps seen on imaging or hysteroscopy.", "Imaging या hysteroscopy में एक या अधिक polyp दिखना।") },
    { code: "A", key: "adenomyosis", group: "structural", name: T("Adenomyosis", "Adenomyosis (एडेनोमायोसिस)"),
      def: T("Endometrial tissue within the myometrium, recognised from imaging features.", "Myometrium के अंदर endometrium जैसा ऊतक, जो imaging की विशेषताओं से पहचाना जाता है।") },
    { code: "L", key: "leiomyoma", group: "structural", name: T("Leiomyoma", "Leiomyoma (फाइब्रॉइड)"),
      def: T("Fibroid. Submucosal (SM, types 0 to 2) or other (O, types 3 to 8); a hybrid fibroid has a number for the endometrial side and one for the serosal side.", "फाइब्रॉइड। Submucosal (SM, type 0 से 2) या other (O, type 3 से 8); hybrid फाइब्रॉइड में endometrium की ओर के लिए एक और serosa की ओर के लिए एक संख्या होती है।") },
    { code: "M", key: "malignancy", group: "structural", name: T("Malignancy and hyperplasia", "Malignancy और hyperplasia (कैंसर और अतिवृद्धि)"),
      def: T("Endometrial hyperplasia, with or without atypia, or a malignancy.", "Endometrial hyperplasia (atypia के साथ या बिना) या कोई malignancy।") },
    { code: "C", key: "coagulopathy", group: "non-structural", name: T("Coagulopathy", "Coagulopathy (रक्त जमने का विकार)"),
      def: T("A systemic disorder of haemostasis; von Willebrand disease is the commonest.", "Haemostasis का एक systemic विकार; इनमें von Willebrand disease सबसे आम है।") },
    { code: "O", key: "ovulatoryDysfunction", group: "non-structural", name: T("Ovulatory dysfunction", "Ovulatory dysfunction (अंडोत्सर्ग की गड़बड़ी)"),
      def: T("Bleeding that is irregular in timing and flow, often with gaps of amenorrhoea; common at menarche, in the perimenopause and in PCOS.", "ऐसा रक्तस्राव जिसका समय और मात्रा अनियमित होती है, अक्सर बीच में amenorrhoea के अंतराल के साथ; menarche, perimenopause और PCOS में आम।") },
    { code: "E", key: "endometrial", group: "non-structural", name: T("Endometrial", "Endometrial (endometrium का प्राथमिक विकार)"),
      def: T("A primary disorder of the local mechanisms that stop menstrual bleeding. It is a diagnosis of exclusion, made when the other causes have been ruled out.", "माहवारी का रक्तस्राव रोकने वाली स्थानीय प्रक्रियाओं का प्राथमिक विकार। यह exclusion का निदान है, जो दूसरे कारण हटाने के बाद किया जाता है।") },
    { code: "I", key: "iatrogenic", group: "non-structural", name: T("Iatrogenic", "Iatrogenic (उपचार से जुड़ा)"),
      def: T("Bleeding linked to exogenous sex steroids, an intrauterine device or system, or another systemic or local agent.", "बाहर से दिए गए sex steroids, intrauterine device या system, या किसी और systemic या local दवा से जुड़ा रक्तस्राव।") },
    { code: "N", key: "notClassified", group: "non-structural", name: T("Not otherwise classified", "Not otherwise classified (अन्य वर्गीकृत नहीं)"),
      def: T("Rare or poorly defined causes, for example an arteriovenous malformation.", "दुर्लभ या अस्पष्ट कारण, जैसे arteriovenous malformation।") }
  ];
  var CODES = CATEGORIES.map(function (c) { return c.code; });

  /* FIGO leiomyoma subclassification (Munro 2011, as tabulated in Gomez 2021 Table 2). */
  var LEIOMYOMA_TYPES = {
    0: { group: "SM", desc: T("Pedunculated intracavitary", "Pedunculated, गर्भाशय गुहा के अंदर") },
    1: { group: "SM", desc: T("Less than 50% intramural", "50% से कम intramural") },
    2: { group: "SM", desc: T("50% or more intramural", "50% या अधिक intramural") },
    3: { group: "O", desc: T("100% intramural, touches the endometrium", "पूरी तरह intramural, endometrium को छूता है") },
    4: { group: "O", desc: T("100% intramural, no contact with endometrium or serosa", "पूरी तरह intramural, endometrium या serosa से संपर्क नहीं") },
    5: { group: "O", desc: T("Subserosal, 50% or more intramural", "Subserosal, 50% या अधिक intramural") },
    6: { group: "O", desc: T("Subserosal, less than 50% intramural", "Subserosal, 50% से कम intramural") },
    7: { group: "O", desc: T("Subserosal, pedunculated", "Subserosal, pedunculated") },
    8: { group: "O", desc: T("Other site, for example cervical, broad ligament or parasitic", "अन्य स्थान, जैसे cervical, broad ligament या parasitic") }
  };

  function bad(en, hi) { return { ok: false, error: T(en, hi) }; }

  /* leiomyoma: true (present, type not given), a whole number 0 to 8, or "a-b" for a hybrid (a: endometrial side, b: serosal side). */
  function leiomyomaOf(v) {
    if (v === true) return { ok: true, types: [], group: null, hybrid: false, label: "L" };
    if (typeof v === "number") {
      if (v !== Math.floor(v) || v < 0 || v > 8) return bad("Leiomyoma type is a whole number from 0 to 8.", "Leiomyoma का type 0 से 8 के बीच पूर्ण संख्या होता है।");
      return { ok: true, types: [v], group: LEIOMYOMA_TYPES[v].group, hybrid: false, label: "L(" + LEIOMYOMA_TYPES[v].group + ")" };
    }
    var m = typeof v === "string" ? /^([0-8])-([0-8])$/.exec(v) : null;
    if (!m) return bad("Leiomyoma is true, a type 0 to 8, or a hybrid such as \"2-5\".", "Leiomyoma true, type 0 से 8, या hybrid (जैसे \"2-5\") होना चाहिए।");
    var a = +m[1], b = +m[2];
    if (a === b) return bad("A hybrid leiomyoma has two different types.", "Hybrid leiomyoma में दो अलग type होते हैं।");
    var g = LEIOMYOMA_TYPES[a].group;
    return { ok: true, types: [a, b], group: g, hybrid: true, label: "L(" + g + ")" };
  }

  function classify(findings) {
    if (!findings || typeof findings !== "object") return bad("Give the findings as an object.", "निष्कर्ष object के रूप में दें।");
    var codes = [], i, c, v, leio = null, cats = [];
    for (i = 0; i < CATEGORIES.length; i++) {
      c = CATEGORIES[i]; v = findings[c.key];
      if (v === undefined || v === null || v === false) continue;
      if (c.code === "L") {
        leio = leiomyomaOf(v);
        if (!leio.ok) return leio;
      } else if (v !== true) {
        return bad("Each finding is true or false: " + c.key + ".", "हर निष्कर्ष true या false होता है: " + c.key + "।");
      }
      codes.push(c.code); cats.push(c);
    }
    var structural = [], nonStructural = [];
    cats.forEach(function (x) { (x.group === "structural" ? structural : nonStructural).push(x.code); });
    var parts = codes.map(function (k) { return k === "L" && leio ? leio.label : k; });
    return {
      ok: true, codes: codes, structural: structural, nonStructural: nonStructural,
      leiomyoma: leio ? { types: leio.types, group: leio.group, hybrid: leio.hybrid } : null,
      notation: codes.length ? "AUB-" + parts.join(" + ") : "AUB",
      categories: cats
    };
  }

  /* FIGO AUB System 1: normal limits (Watters 2021 Table 1, from the FIGO 2018 revisions). */
  var SYSTEM1 = { frequencyMin: 24, frequencyMax: 38, durationMax: 8, regularityMax: 9 };
  var TERMS = {
    frequent: T("Frequent menstrual bleeding (cycle shorter than 24 days)", "बार-बार माहवारी (चक्र 24 दिन से छोटा)"),
    infrequent: T("Infrequent menstrual bleeding (cycle longer than 38 days)", "कम बार माहवारी (चक्र 38 दिन से लंबा)"),
    prolonged: T("Prolonged menstrual bleeding (more than 8 days)", "लंबी चलने वाली माहवारी (8 दिन से अधिक)"),
    irregular: T("Irregular cycles (shortest to longest more than 9 days apart)", "अनियमित चक्र (सबसे छोटे और सबसे लंबे चक्र में 9 दिन से अधिक का अंतर)"),
    heavy: T("Heavy menstrual bleeding", "Heavy menstrual bleeding (अधिक रक्तस्राव)"),
    light: T("Light menstrual bleeding", "Light menstrual bleeding (कम रक्तस्राव)"),
    intermenstrual: T("Intermenstrual bleeding", "Intermenstrual bleeding (दो माहवारी के बीच रक्तस्राव)")
  };
  function bleedingPattern(p) {
    if (!p || typeof p.frequencyDays !== "number" || typeof p.durationDays !== "number" || typeof p.regularityRangeDays !== "number" ||
        p.frequencyDays !== p.frequencyDays || p.durationDays !== p.durationDays || p.regularityRangeDays !== p.regularityRangeDays ||
        p.frequencyDays <= 0 || p.durationDays <= 0 || p.regularityRangeDays < 0) {
      return bad("Give the cycle length in days, the days of bleeding and the shortest-to-longest range in days.", "चक्र की लंबाई (दिन), रक्तस्राव के दिन और सबसे छोटे-से-सबसे लंबे चक्र का अंतर (दिन) दें।");
    }
    if (p.volume !== undefined && ["light", "normal", "heavy"].indexOf(p.volume) < 0) return bad("Volume is light, normal or heavy.", "मात्रा light, normal या heavy होती है।");
    var flags = [];
    if (p.frequencyDays < SYSTEM1.frequencyMin) flags.push("frequent");
    if (p.frequencyDays > SYSTEM1.frequencyMax) flags.push("infrequent");
    if (p.durationDays > SYSTEM1.durationMax) flags.push("prolonged");
    if (p.regularityRangeDays > SYSTEM1.regularityMax) flags.push("irregular");
    if (p.volume === "heavy") flags.push("heavy");
    if (p.volume === "light") flags.push("light");
    if (p.intermenstrual === true) flags.push("intermenstrual");
    return { ok: true, normal: flags.length === 0, flags: flags, terms: flags.map(function (f) { return TERMS[f]; }) };
  }

  /* Vignettes: loaded from tokos/explorer/palm-coein.json by the UI. */
  function validateVignette(v) {
    var errs = [], r;
    if (!v || typeof v !== "object") return ["not an object"];
    ["id", "level"].forEach(function (k) { if (typeof v[k] !== "string" || !v[k]) errs.push("missing " + k); });
    ["title", "stem", "teach"].forEach(function (k) { if (!v[k] || !v[k].en || !v[k].hi) errs.push(k + " needs en and hi"); });
    r = classify(v.findings);
    if (!r.ok) errs.push("findings: " + r.error.en);
    else {
      if (!v.expect || JSON.stringify(v.expect.codes) !== JSON.stringify(r.codes)) errs.push("expect.codes does not match classify(findings)");
      if (r.leiomyoma && (!v.expect || !v.expect.leiomyoma || v.expect.leiomyoma.group !== r.leiomyoma.group)) errs.push("expect.leiomyoma.group does not match");
    }
    return errs;
  }
  var loaded = [];
  function setVignettes(list) {
    var bads = [];
    (list || []).forEach(function (v) { var e = validateVignette(v); if (e.length) bads.push({ id: v && v.id, errors: e }); });
    if (bads.length) return { ok: false, problems: bads };
    loaded = list.slice();
    model.vignettes = loaded;
    return { ok: true, count: loaded.length };
  }
  /* answer: { codes: ["P","L"], leiomyoma: "SM" | "O" (optional) } */
  function grade(vignette, answer) {
    var want = classify(vignette.findings);
    if (!want.ok) return want;
    var given = (answer && answer.codes ? answer.codes : []).filter(function (c) { return CODES.indexOf(c) >= 0; });
    var missing = want.codes.filter(function (c) { return given.indexOf(c) < 0; });
    var extra = given.filter(function (c, i) { return want.codes.indexOf(c) < 0 && given.indexOf(c) === i; });
    var leio = null;
    if (want.leiomyoma && want.leiomyoma.group) {
      leio = { expected: want.leiomyoma.group, given: answer && answer.leiomyoma ? answer.leiomyoma : null };
      leio.ok = leio.expected === leio.given;
    }
    var ok = !missing.length && !extra.length && (!leio || leio.ok);
    return { ok: true, correct: ok, missing: missing, extra: extra, leiomyoma: leio, expected: want };
  }

  var model = {
    id: "palm-coein", kind: "explorer", group: "gynaecology", level: "mbbs",
    title: { en: "AUB: PALM-COEIN", hi: "AUB: PALM-COEIN वर्गीकरण" },
    subtitle: { en: "Read the case, then name every cause that fits", hi: "केस पढ़ें, फिर हर उपयुक्त कारण चुनें" },
    sources: [
      { label: "MSD Manual Professional, Abnormal Uterine Bleeding (Pinkerton; updated June 2026): PALM-COEIN letters, normal menstrual parameters", url: "https://www.msdmanuals.com/professional/gynecology-and-obstetrics/abnormal-uterine-bleeding/abnormal-uterine-bleeding" },
      { label: "Watters M, Martinez-Aguilar R, Maybin JA. The Menstrual Endometrium. Front Reprod Health 2021;3:794352 (FIGO AUB System 1 normal limits, AUB-E as a diagnosis of exclusion, AUB-O mechanism)", url: "https://www.frontiersin.org/journals/reproductive-health/articles/10.3389/frph.2021.794352" },
      { label: "Gomez E et al. MRI-based pictorial review of the FIGO classification system for uterine fibroids. Abdom Radiol 2021;46:2146-2155 (Table 2: leiomyoma types 0 to 8, hybrid)", url: "https://rads.web.unc.edu/wp-content/uploads/sites/12234/2021/07/Gomez2021_Article_MRI-basedPictorialReviewOfTheF.pdf" },
      { label: "MSD Manual Professional, PALM-COEIN uterine leiomyoma subclassification table (hybrid convention; groups type 3 with the submucosal types, unlike Gomez 2021)", url: "https://www.msdmanuals.com/professional/multimedia/table/palm-coein-uterine-leiomyoma-fibroid-subclassification-system" },
      { label: "Pravatta-Rezende G et al. Diagnosis and management of acute AUB during menacme. Clinics (Sao Paulo) 2025 (age pattern of causes; biopsy risk factors)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11931224/" },
      { label: "Munro MG et al. FIGO classification system (PALM-COEIN). Int J Gynaecol Obstet 2011;113(1):3-13 (abstract only, full text not accessible)", url: "https://pubmed.ncbi.nlm.nih.gov/21345435/" },
      { label: "Munro MG, Critchley HOD, Fraser IS. The two FIGO systems ... 2018 revisions. Int J Gynaecol Obstet 2018;143(3):393-408 (abstract only, full text not accessible)", url: "https://pubmed.ncbi.nlm.nih.gov/30198563/" }
    ],
    review: "ai_drafted",
    notes: {
      scope: { en: "PALM-COEIN classifies the potential causes of abnormal uterine bleeding in women of reproductive age who are not pregnant. Several categories can be present together. Naming a category does not prove it is the cause of this woman's bleeding.", hi: "PALM-COEIN गर्भवती न होने वाली प्रजनन आयु की स्त्रियों में असामान्य गर्भाशय रक्तस्राव के संभावित कारणों को वर्गीकृत करता है। कई श्रेणियाँ साथ हो सकती हैं। किसी श्रेणी का नाम लेने से यह सिद्ध नहीं होता कि वही इस स्त्री के रक्तस्राव का कारण है।" },
      notation: { en: "The written form (for example AUB-P + L(SM)) is a teaching notation used in this explorer.", hi: "लिखा हुआ रूप (जैसे AUB-P + L(SM)) इस explorer में इस्तेमाल किया गया शिक्षण संकेतन है।" },
      type3: { en: "Sources differ on the group of leiomyoma type 3. This explorer follows the original scheme in Gomez 2021: submucosal is types 0 to 2, other is types 3 to 8.", hi: "Leiomyoma type 3 के समूह पर स्रोतों में मतभेद है। यह explorer Gomez 2021 की मूल योजना मानता है: submucosal type 0 से 2, other type 3 से 8।" },
      vignettes: { en: "The cases are original teaching scenarios written for this app. They are not real patients.", hi: "ये केस इस app के लिए लिखे गए मौलिक शिक्षण परिदृश्य हैं। ये असली मरीज़ नहीं हैं।" }
    },
    categories: CATEGORIES, codes: CODES, leiomyomaTypes: LEIOMYOMA_TYPES, system1: SYSTEM1, terms: TERMS,
    classify: classify, bleedingPattern: bleedingPattern,
    vignettes: loaded, setVignettes: setVignettes, validateVignette: validateVignette, grade: grade,
    dataFile: "tokos/explorer/palm-coein.json"
  };
  return model;
});
