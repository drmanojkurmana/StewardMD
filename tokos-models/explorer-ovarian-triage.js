/* Tokos explorer model: ovarian mass triage with the IOTA simple rules. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.TOKOS_MODELS["ovarian-triage"].
   The learner describes the ultrasound appearance (no images); features(desc) turns the description into the five
   B-features (benign) and five M-features (malignant) of Timmerman et al. 2008, and classify(desc) applies the three
   rules: M without B is malignant, B without M is benign, both or neither is inconclusive (a second-stage test is
   recommended). It is a teaching triage aid and does not replace expert ultrasound assessment or clinical judgement. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.TOKOS_MODELS = root.TOKOS_MODELS || {}; root.TOKOS_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function T(en, hi) { return { en: en, hi: hi }; }
  var TYPES = {
    unilocular: T("Unilocular cyst: one cavity, no solid part", "Unilocular cyst: एक गुहा, कोई solid हिस्सा नहीं"),
    "unilocular-solid": T("Unilocular with a solid component", "Unilocular, solid हिस्से के साथ"),
    multilocular: T("Multilocular cyst: septa, no solid part", "Multilocular cyst: septa, कोई solid हिस्सा नहीं"),
    "multilocular-solid": T("Multilocular with a solid component", "Multilocular, solid हिस्से के साथ"),
    solid: T("Solid tumour", "Solid ट्यूमर")
  };
  var SOLID_TYPES = ["unilocular-solid", "multilocular-solid"];
  var FEATURES = {
    B1: { side: "B", name: T("Unilocular cyst", "Unilocular cyst (एक गुहा वाला cyst)") },
    B2: { side: "B", name: T("Solid components, the largest less than 7 mm", "Solid हिस्से, सबसे बड़ा 7 mm से छोटा") },
    B3: { side: "B", name: T("Acoustic shadows", "Acoustic shadows (ध्वनि की छाया)") },
    B4: { side: "B", name: T("Smooth multilocular tumour, largest diameter less than 100 mm", "चिकना multilocular ट्यूमर, सबसे बड़ा व्यास 100 mm से कम") },
    B5: { side: "B", name: T("No detectable blood flow (colour score 1)", "रक्त प्रवाह नहीं दिखता (colour score 1)") },
    M1: { side: "M", name: T("Irregular solid tumour", "अनियमित solid ट्यूमर") },
    M2: { side: "M", name: T("Ascites", "Ascites (पेट में पानी)") },
    M3: { side: "M", name: T("At least four papillary structures", "कम से कम चार papillary structures") },
    M4: { side: "M", name: T("Irregular multilocular-solid tumour, largest diameter 100 mm or more", "अनियमित multilocular-solid ट्यूमर, सबसे बड़ा व्यास 100 mm या अधिक") },
    M5: { side: "M", name: T("Very strong blood flow (colour score 4)", "बहुत तेज़ रक्त प्रवाह (colour score 4)") }
  };
  var IDS = ["B1", "B2", "B3", "B4", "B5", "M1", "M2", "M3", "M4", "M5"];
  var RULES = {
    malignant: T("Rule 1: one or more M-features and no B-feature, so the mass is classified as malignant.", "Rule 1: एक या अधिक M-feature और कोई B-feature नहीं, इसलिए mass malignant वर्गीकृत होता है।"),
    benign: T("Rule 2: one or more B-features and no M-feature, so the mass is classified as benign.", "Rule 2: एक या अधिक B-feature और कोई M-feature नहीं, इसलिए mass benign वर्गीकृत होता है।"),
    inconclusive: T("Rule 3: both M- and B-features are present, or none is, so the result is inconclusive and a second-stage test is recommended.", "Rule 3: M- और B- दोनों features मौजूद हैं, या कोई नहीं है, इसलिए परिणाम inconclusive है और दूसरे चरण की जाँच की सलाह है।")
  };

  function bad(en, hi, errors) { return { ok: false, error: T(en, hi), errors: errors || [] }; }
  function num(x) { return typeof x === "number" && x === x && x !== Infinity && x !== -Infinity; }

  /* desc: { type, outline: "smooth" | "irregular", largestDiameterMm, largestSolidMm, acousticShadows, ascites, papillaryStructures, colourScore 1 to 4 } */
  function features(d) {
    var errs = [];
    if (!d || typeof d !== "object") return bad("Give the description as an object.", "वर्णन object के रूप में दें।");
    if (!TYPES[d.type]) errs.push("type is one of " + Object.keys(TYPES).join(", "));
    if (d.colourScore !== 1 && d.colourScore !== 2 && d.colourScore !== 3 && d.colourScore !== 4) errs.push("colourScore is 1, 2, 3 or 4");
    var needsOutline = d.type === "solid" || d.type === "multilocular" || d.type === "multilocular-solid";
    if (needsOutline && d.outline !== "smooth" && d.outline !== "irregular") errs.push("outline is smooth or irregular for this type");
    if ((d.type === "multilocular" || d.type === "multilocular-solid") && !(num(d.largestDiameterMm) && d.largestDiameterMm > 0)) errs.push("largestDiameterMm (above 0) is needed for a multilocular tumour");
    if (SOLID_TYPES.indexOf(d.type) >= 0 && !(num(d.largestSolidMm) && d.largestSolidMm > 0)) errs.push("largestSolidMm (above 0) is needed when there is a solid component");
    if (d.papillaryStructures !== undefined && !(num(d.papillaryStructures) && d.papillaryStructures >= 0 && d.papillaryStructures === Math.floor(d.papillaryStructures))) errs.push("papillaryStructures is a whole number, 0 or more");
    // papillary projections are solid components (IOTA terms), so a cyst with no solid part cannot have them
    if ((d.type === "unilocular" || d.type === "multilocular") && num(d.papillaryStructures) && d.papillaryStructures > 0) errs.push("papillary structures are solid components: use unilocular-solid or multilocular-solid");
    ["acousticShadows", "ascites"].forEach(function (k) { if (d[k] !== undefined && typeof d[k] !== "boolean") errs.push(k + " is true or false"); });
    if (errs.length) return bad("The description is incomplete or out of range.", "वर्णन अधूरा है या सीमा से बाहर है।", errs);
    var f = {
      B1: d.type === "unilocular",
      B2: SOLID_TYPES.indexOf(d.type) >= 0 && d.largestSolidMm < 7,
      B3: d.acousticShadows === true,
      B4: d.type === "multilocular" && d.outline === "smooth" && d.largestDiameterMm < 100,
      B5: d.colourScore === 1,
      M1: d.type === "solid" && d.outline === "irregular",
      M2: d.ascites === true,
      M3: (d.papillaryStructures || 0) >= 4,
      M4: d.type === "multilocular-solid" && d.outline === "irregular" && d.largestDiameterMm >= 100,
      M5: d.colourScore === 4
    };
    return { ok: true, flags: f, B: IDS.filter(function (k) { return k[0] === "B" && f[k]; }), M: IDS.filter(function (k) { return k[0] === "M" && f[k]; }) };
  }

  function decide(B, M) { return M.length && !B.length ? "malignant" : B.length && !M.length ? "benign" : "inconclusive"; }
  function result(B, M) {
    var outcome = decide(B, M);
    return { ok: true, outcome: outcome, B: B, M: M, rule: RULES[outcome], conclusive: outcome !== "inconclusive", secondStage: outcome === "inconclusive" };
  }
  function classify(d) {
    var f = features(d);
    if (!f.ok) return f;
    return result(f.B, f.M);
  }
  /* For a learner who picks the features directly: ids is a list such as ["B1", "M5"]. */
  function fromFeatures(ids) {
    if (!Array.isArray(ids)) return bad("Give a list of feature ids.", "Feature ids की सूची दें।");
    for (var i = 0; i < ids.length; i++) if (IDS.indexOf(ids[i]) < 0) return bad("Unknown feature: " + ids[i], "अज्ञात feature: " + ids[i]);
    var uniq = IDS.filter(function (k) { return ids.indexOf(k) >= 0; });
    return result(uniq.filter(function (k) { return k[0] === "B"; }), uniq.filter(function (k) { return k[0] === "M"; }));
  }

  return {
    id: "ovarian-triage", kind: "explorer", group: "gynaecology", level: "mbbs",
    title: { en: "Ovarian mass triage: IOTA simple rules", hi: "अंडाशय की गाँठ का triage: IOTA simple rules" },
    subtitle: { en: "Describe the scan, apply the ten features, read the rule", hi: "Scan का वर्णन करें, दस features लगाएँ और rule पढ़ें" },
    sources: [
      { label: "Timmerman D et al. Simple ultrasound-based rules for the diagnosis of ovarian cancer. Ultrasound Obstet Gynecol 2008;31(6):681-690 (the ten rules; abstract)", url: "https://pubmed.ncbi.nlm.nih.gov/18504770/" },
      { label: "Timmerman D et al. Simple ultrasound rules to distinguish between benign and malignant adnexal masses before surgery: prospective validation by IOTA group. BMJ 2010;341:c6839 (the three decision rules; performance)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3001703/" }
    ],
    review: "ai_drafted",
    notes: {
      aid: { en: "This is a teaching triage aid built on published rules. It does not replace an expert ultrasound examination, tumour markers, or clinical judgement, and an inconclusive result needs a second-stage test.", hi: "यह प्रकाशित rules पर बना शिक्षण triage साधन है। यह विशेषज्ञ ultrasound जाँच, tumour markers या नैदानिक निर्णय की जगह नहीं लेता, और inconclusive परिणाम पर दूसरे चरण की जाँच चाहिए।" },
      colour: { en: "Colour score is the amount of blood flow on colour Doppler: 1 none, 2 minimal, 3 moderate, 4 very strong.", hi: "Colour score colour Doppler में रक्त प्रवाह की मात्रा है: 1 कोई नहीं, 2 न्यूनतम, 3 मध्यम, 4 बहुत तेज़।" },
      noImages: { en: "Inputs are descriptions only. No scan images are shown here.", hi: "इनपुट केवल वर्णन हैं। यहाँ कोई scan image नहीं दिखाई गई है।" }
    },
    performance: {
      derivation2008: { applicable: "76% of tumours", sensitivity: "93%", specificity: "90%", prospective: { applicable: "76% (386/507)", sensitivity: "95% (106/112)", specificity: "91% (249/274)" } },
      validation2010: { patients: 1938, conclusive: "77% (1501/1938)", sensitivity: "92% (340/369)", specificity: "96% (1083/1132)" }
    },
    types: TYPES, features: FEATURES, featureIds: IDS, rules: RULES,
    describe: features, classify: classify, fromFeatures: fromFeatures
  };
});
