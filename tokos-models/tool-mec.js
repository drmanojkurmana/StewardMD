/* Tokos calculator model: contraception eligibility, US MEC 2024 (CDC, public domain). Pure logic, ES5 UMD.
   Data: MMWR Recomm Rep 2024;73(4) Table K1 (summary of classifications for hormonal methods and IUDs). */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  // Row: [id, English condition, Hindi condition, Cu-IUD, LNG-IUD, Implant, DMPA, POP, CHC].
  // Cell: "I" or "I|C" (initiation | continuation) as printed in the chart; "*" means a clarification exists in the source; null = row not classified for that method.
  var ROWS = [
    ["pp_bf_lt21", "Postpartum, breastfeeding, under 21 days", "प्रसवोत्तर, स्तनपान, 21 दिन से कम", null, null, "2*", "2*", "2*", "4*"],
    ["pp_bf_21_30_vte", "Postpartum, breastfeeding, 21 to under 30 days, with other VTE risk factors", "प्रसवोत्तर, स्तनपान, 21 से 30 दिन से कम, अन्य वीटीई जोखिम कारकों सहित", null, null, "2*", "2*", "2*", "3*"],
    ["pp_bf_21_30", "Postpartum, breastfeeding, 21 to under 30 days, without other VTE risk factors", "प्रसवोत्तर, स्तनपान, 21 से 30 दिन से कम, अन्य वीटीई जोखिम कारकों के बिना", null, null, "2*", "2*", "2*", "3*"],
    ["pp_bf_30_42_vte", "Postpartum, breastfeeding, 30 to 42 days, with other VTE risk factors", "प्रसवोत्तर, स्तनपान, 30 से 42 दिन, अन्य वीटीई जोखिम कारकों सहित", null, null, "1*", "2*", "1*", "3*"],
    ["pp_bf_30_42", "Postpartum, breastfeeding, 30 to 42 days, without other VTE risk factors", "प्रसवोत्तर, स्तनपान, 30 से 42 दिन, अन्य वीटीई जोखिम कारकों के बिना", null, null, "1*", "1*", "1*", "2*"],
    ["pp_bf_gt42", "Postpartum, breastfeeding, over 42 days", "प्रसवोत्तर, स्तनपान, 42 दिन से अधिक", null, null, "1*", "1*", "1*", "2*"],
    ["pp_nbf_lt21", "Postpartum, not breastfeeding, under 21 days", "प्रसवोत्तर, स्तनपान नहीं, 21 दिन से कम", null, null, "1", "2", "1", "4"],
    ["pp_nbf_21_42_vte", "Postpartum, not breastfeeding, 21 to 42 days, with other VTE risk factors", "प्रसवोत्तर, स्तनपान नहीं, 21 से 42 दिन, अन्य वीटीई जोखिम कारकों सहित", null, null, "1", "2", "1", "3*"],
    ["pp_nbf_21_42", "Postpartum, not breastfeeding, 21 to 42 days, without other VTE risk factors", "प्रसवोत्तर, स्तनपान नहीं, 21 से 42 दिन, अन्य वीटीई जोखिम कारकों के बिना", null, null, "1", "1", "1", "2"],
    ["pp_nbf_gt42", "Postpartum, not breastfeeding, over 42 days", "प्रसवोत्तर, स्तनपान नहीं, 42 दिन से अधिक", null, null, "1", "1", "1", "1"],
    ["iud_pp_lt10min", "IUD insertion within 10 minutes of delivery of the placenta (IUD rows only)", "प्लेसेंटा निकलने के 10 मिनट के भीतर आईयूडी (केवल आईयूडी पंक्तियाँ)", "2*", "2*", null, null, null, null],
    ["iud_pp_10min_4wk", "IUD insertion from 10 minutes after the placenta to under 4 weeks postpartum (IUD rows only)", "प्लेसेंटा के 10 मिनट बाद से 4 सप्ताह से कम प्रसवोत्तर आईयूडी (केवल आईयूडी पंक्तियाँ)", "2*", "2*", null, null, null, null],
    ["iud_pp_ge4wk", "IUD insertion at 4 weeks or more postpartum (IUD rows only)", "4 सप्ताह या अधिक प्रसवोत्तर आईयूडी (केवल आईयूडी पंक्तियाँ)", "1*", "1*", null, null, null, null],
    ["pp_sepsis", "Postpartum sepsis (IUD rows only)", "प्रसवोत्तर सेप्सिस (केवल आईयूडी पंक्तियाँ)", "4", "4", null, null, null, null],
    ["pa_t1_surgical", "Post-abortion, first trimester, procedural", "गर्भपात के बाद, पहली तिमाही, प्रक्रिया द्वारा", "1*", "1*", "1*", "1*", "1*", "1*"],
    ["pa_t2", "Post-abortion, second trimester, procedural", "गर्भपात के बाद, दूसरी तिमाही, प्रक्रिया द्वारा", "2*", "2*", "1*", "1*", "1*", "1*"],
    ["pa_septic", "Immediate post-septic abortion", "सेप्टिक गर्भपात के तुरंत बाद", "4", "4", "1*", "1*", "1*", "1*"],
    ["ectopic", "Past ectopic pregnancy", "पहले एक्टोपिक गर्भावस्था", "1", "1", "1", "1", "2", "1"],
    ["nullip", "Nulliparous", "कोई पूर्व प्रसव नहीं (नलिपैरस)", "2", "2", "1", "1", "1", "1"],
    ["age_lt18", "Age under 18 (menarche to under 18)", "आयु 18 से कम (पहली माहवारी से 18 से कम)", "2", "2", "1", "2", "1", "1"],
    ["age_18_19", "Age 18 to 19", "आयु 18 से 19", "2", "2", "1", "1", "1", "1"],
    ["age_20_39", "Age 20 to 39", "आयु 20 से 39", "1", "1", "1", "1", "1", "1"],
    ["age_40_45", "Age 40 to 45", "आयु 40 से 45", "1", "1", "1", "1", "1", "2"],
    ["age_gt45", "Age over 45", "आयु 45 से अधिक", "1", "1", "1", "2", "1", "2"],
    ["smoke_lt35", "Smoking, age under 35", "धूम्रपान, आयु 35 से कम", "1", "1", "1", "1", "1", "2"],
    ["smoke_35_lt15", "Smoking, age 35 or more, under 15 cigarettes a day", "धूम्रपान, आयु 35 या अधिक, प्रतिदिन 15 सिगरेट से कम", "1", "1", "1", "1", "1", "3"],
    ["smoke_35_ge15", "Smoking, age 35 or more, 15 or more cigarettes a day", "धूम्रपान, आयु 35 या अधिक, प्रतिदिन 15 या अधिक सिगरेट", "1", "1", "1", "1", "1", "4"],
    ["obesity", "Obesity, BMI 30 or more", "मोटापा, बीएमआई 30 या अधिक", "1", "1", "1", "1", "1", "2*"],
    ["multi_cvd", "Multiple risk factors for atherosclerotic cardiovascular disease", "हृदय-धमनी रोग के कई जोखिम कारक", "1", "2", "2*", "3*", "2*", "3/4*"],
    ["htn_controlled", "Hypertension, adequately controlled", "उच्च रक्तचाप, पर्याप्त नियंत्रित", "1*", "1*", "1*", "2*", "1*", "3*"],
    ["htn_mild", "Hypertension, systolic 140 to 159 or diastolic 90 to 99 mmHg", "उच्च रक्तचाप, सिस्टोलिक 140 से 159 या डायस्टोलिक 90 से 99 मिमी एचजी", "1*", "1*", "1*", "2*", "1*", "3*"],
    ["htn_severe", "Hypertension, systolic 160 or more or diastolic 100 or more mmHg", "उच्च रक्तचाप, सिस्टोलिक 160 या अधिक या डायस्टोलिक 100 या अधिक मिमी एचजी", "1*", "2*", "2*", "3*", "2*", "4*"],
    ["htn_vascular", "Hypertension with vascular disease", "उच्च रक्तचाप के साथ रक्तवाहिनी रोग", "1*", "2*", "2*", "3*", "2*", "4*"],
    ["hdp_hist", "History of high blood pressure in pregnancy, blood pressure now normal", "गर्भावस्था में उच्च रक्तचाप का इतिहास, अब रक्तचाप सामान्य", "1", "1", "1", "1", "1", "2"],
    ["dvt_current", "Current or past DVT/PE on therapeutic anticoagulation", "वर्तमान या पूर्व डीवीटी/पीई, चिकित्सीय थक्कारोधी पर", "2*", "2*", "2*", "2*", "2*", "3*"],
    ["dvt_hist_high", "Past DVT/PE, no anticoagulation, higher risk of recurrence", "पूर्व डीवीटी/पीई, थक्कारोधी नहीं, पुनरावृत्ति का उच्च जोखिम", "1", "2", "2", "3", "2", "4"],
    ["dvt_hist_low", "Past DVT/PE, no anticoagulation, lower risk of recurrence", "पूर्व डीवीटी/पीई, थक्कारोधी नहीं, पुनरावृत्ति का कम जोखिम", "1", "2", "2", "2", "2", "3"],
    ["dvt_family", "Family history of DVT/PE (first-degree relative)", "डीवीटी/पीई का पारिवारिक इतिहास (प्रथम श्रेणी रिश्तेदार)", "1", "1", "1", "1", "1", "2"],
    ["thrombophilia", "Known thrombogenic mutation or thrombophilia", "ज्ञात थ्रोम्बोजेनिक म्यूटेशन या थ्रोम्बोफीलिया", "1*", "2*", "2*", "3*", "2*", "4*"],
    ["ihd", "Current or past ischaemic heart disease", "वर्तमान या पूर्व इस्केमिक हृदय रोग", "1", "2|3", "2|3", "3", "2|3", "4"],
    ["stroke", "Stroke (history of cerebrovascular accident)", "स्ट्रोक (सेरेब्रोवैस्कुलर दुर्घटना का इतिहास)", "1", "2", "2|3", "3", "2|3", "4"],
    ["sle_apl", "SLE with positive or unknown antiphospholipid antibodies", "एसएलई, एंटीफॉस्फोलिपिड एंटीबॉडी पॉज़िटिव या अज्ञात", "1*", "2*", "2*", "3*", "2*", "4*"],
    ["mig_noaura", "Migraine without aura", "बिना ऑरा माइग्रेन", "1", "1", "1", "1", "1", "2*"],
    ["mig_aura", "Migraine with aura", "ऑरा सहित माइग्रेन", "1", "1", "1", "1", "1", "4*"],
    ["epilepsy", "Epilepsy", "मिर्गी", "1", "1", "1*", "1*", "1*", "1*"],
    ["depression", "Depressive disorders", "अवसादग्रस्तता विकार", "1*", "1*", "1*", "1*", "1*", "1*"],
    ["bleed_heavy", "Heavy or prolonged vaginal bleeding", "भारी या लंबे समय तक योनि रक्तस्राव", "2*", "1*|2*", "2*", "2*", "2*", "1*"],
    ["bleed_unexpl", "Unexplained vaginal bleeding before evaluation", "जाँच से पहले अस्पष्ट योनि रक्तस्राव", "4*|2*", "4*|2*", "3*", "3*", "2*", "2*"],
    ["fibroids", "Uterine fibroids", "गर्भाशय फाइब्रॉइड", "2", "2", "1", "1", "1", "1"],
    ["uterine_distort", "Distorted uterine cavity (IUD rows only)", "विकृत गर्भाशय गुहा (केवल आईयूडी पंक्तियाँ)", "4", "4", null, null, null, null],
    ["cervical_ca", "Cervical cancer awaiting treatment", "उपचार की प्रतीक्षा में गर्भाशय-ग्रीवा कैंसर", "4|2", "4|2", "2", "2", "1", "2"],
    ["breast_ca_cur", "Breast cancer, current", "स्तन कैंसर, वर्तमान", "1", "4", "4", "4", "4", "4"],
    ["breast_ca_past", "Breast cancer, past, no evidence of disease for 5 years", "स्तन कैंसर, पूर्व, 5 वर्ष से रोग का प्रमाण नहीं", "1", "3", "3", "3", "3", "3"],
    ["pid_current", "Current pelvic inflammatory disease", "वर्तमान पेल्विक इन्फ्लेमेटरी रोग", "4|2*", "4|2*", "1", "1", "1", "1"],
    ["cervicitis", "Current purulent cervicitis, chlamydia or gonorrhoea", "वर्तमान पीपयुक्त सर्वाइसाइटिस, क्लैमाइडिया या गोनोरिया", "4|2*", "4|2*", "1", "1", "1", "1"],
    ["gdm_hist", "History of gestational diabetes", "जेस्टेशनल डायबिटीज़ का इतिहास", "1", "1", "1", "1", "1", "1"],
    ["dm_nonvasc", "Diabetes without vascular disease", "डायबिटीज़, रक्तवाहिनी रोग के बिना", "1", "2", "2", "2", "2", "2"],
    ["dm_vasc", "Diabetes with nephropathy, retinopathy or neuropathy", "डायबिटीज़ के साथ नेफ्रोपैथी, रेटिनोपैथी या न्यूरोपैथी", "1", "2", "2", "3", "2", "3/4*"],
    ["hep_acute", "Viral hepatitis, acute or flare", "वायरल हेपेटाइटिस, तीव्र या उभार", "1", "1", "1", "1", "1", "3/4*|2"],
    ["cirrhosis_dec", "Decompensated cirrhosis", "विघटित सिरोसिस", "1", "2", "2", "3", "2", "4"],
    ["sickle", "Sickle cell disease", "सिकल सेल रोग", "2", "1", "1", "2/3*", "1", "4"],
    ["iron_def", "Iron-deficiency anaemia", "आयरन की कमी से एनीमिया", "2", "1", "1", "1", "1", "1"],
    ["anticonv", "Certain anticonvulsants (phenytoin, carbamazepine, barbiturates, primidone, topiramate, oxcarbazepine)", "कुछ मिर्गी-रोधी दवाएँ (फ़िनाइटोइन, कार्बामाज़ेपाइन, बार्बिट्यूरेट, प्राइमिडोन, टोपिरामेट, ऑक्सकार्बामाज़ेपाइन)", "1", "1", "2*", "1*", "3*", "3*"],
    ["rifampin", "Rifampicin or rifabutin therapy", "रिफैम्पिसिन या रिफाब्यूटिन उपचार", "1", "1", "2*", "1*", "3*", "3*"]
  ];
  var METHODS = [
    ["cu", "Copper IUD", "कॉपर आईयूडी"], ["lng", "Levonorgestrel IUD (LNG-IUD)", "लेवोनॉर्जेस्ट्रेल आईयूडी (एलएनजी-आईयूडी)"], ["imp", "Implant", "इम्प्लांट"],
    ["dmpa", "DMPA injectable", "डीएमपीए इंजेक्शन"], ["pop", "Progestin-only pill (POP)", "केवल प्रोजेस्टिन गोली (पीओपी)"], ["chc", "Combined hormonal contraceptive (pill, patch, ring)", "संयुक्त हार्मोनल गर्भनिरोधक (गोली, पैच, रिंग)"]
  ];
  var CAT = {
    1: ["No restriction for the use of the method.", "विधि के उपयोग पर कोई प्रतिबंध नहीं।"],
    2: ["The advantages of using the method generally outweigh the theoretical or proven risks.", "विधि के लाभ आमतौर पर सैद्धांतिक या सिद्ध जोखिम से अधिक हैं।"],
    3: ["The theoretical or proven risks usually outweigh the advantages of using the method.", "सैद्धांतिक या सिद्ध जोखिम आमतौर पर विधि के लाभ से अधिक हैं।"],
    4: ["Unacceptable health risk if the method is used.", "विधि का उपयोग करने पर अस्वीकार्य स्वास्थ्य जोखिम।"]
  };
  var byId = {}, i;
  for (i = 0; i < ROWS.length; i++) byId[ROWS[i][0]] = ROWS[i];
  function cell(s) {
    var p = s.split("|"), a = p[0].replace("*", ""), b = (p.length > 1 ? p[1] : p[0]).replace("*", "");
    return { i: a, c: b, star: s.indexOf("*") >= 0 };
  }
  function top(x) { return Math.max.apply(null, x.replace("/", ",").split(",").map(Number)); }
  var M = {
    id: "mec", kind: "tool", group: "gynaecology", level: "mbbs", review: "ai_drafted",
    title: { en: "Contraception eligibility (US MEC 2024)", hi: "गर्भनिरोधक पात्रता (यूएस एमईसी 2024)" },
    sources: [
      { label: "CDC. U.S. Medical Eligibility Criteria for Contraceptive Use, 2024. MMWR Recomm Rep 2024;73(No. RR-4), Table K1 summary chart (public domain)", url: "https://www.cdc.gov/mmwr/volumes/73/rr/rr7304a1.htm" },
      { label: "Same report in PubMed Central (full text and tables)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11315372/" }
    ],
    inputs: [
      { id: "condition", label: { en: "Condition", hi: "स्थिति" }, type: "select", required: true,
        options: ROWS.map(function (r) { return { value: r[0], label: { en: r[1], hi: r[2] } }; }) },
      { id: "method", label: { en: "Method", hi: "विधि" }, type: "select", required: true,
        options: METHODS.map(function (m) { return { value: m[0], label: { en: m[1], hi: m[2] } }; }) }
    ],
    // Conditions included (64 rows) cover postpartum and post-abortion timing, age, parity, smoking, obesity, hypertension, thromboembolism,
    // ischaemic heart disease, stroke, SLE, migraine, epilepsy, depression, bleeding patterns, fibroids, uterine distortion, cervical and breast cancer,
    // PID and cervicitis, diabetes, hepatitis, cirrhosis, sickle cell disease, iron-deficiency anaemia, enzyme-inducing drugs and rifampicin.
    // Not included: barrier, emergency contraception and fertility-awareness methods; HIV and antiretroviral rows; and the remaining chart rows.
    compute: function (v) {
      v = v || {};
      var r = byId[v.condition], mi = -1, k;
      if (!r) return bad("Choose a condition from the list.", "सूची से स्थिति चुनें।");
      for (k = 0; k < METHODS.length; k++) if (METHODS[k][0] === v.method) mi = k;
      if (mi < 0) return bad("Choose a method.", "विधि चुनें।");
      var raw = r[3 + mi];
      if (raw === null) return bad("The US MEC chart does not classify this method for this row (IUD-only rows apply to IUDs; the breastfeeding and postpartum time rows apply to hormonal methods).", "यूएस एमईसी चार्ट इस पंक्ति के लिए इस विधि का वर्गीकरण नहीं देता (आईयूडी-विशेष पंक्तियाँ आईयूडी पर, स्तनपान और प्रसवोत्तर समय की पंक्तियाँ हार्मोनल विधियों पर लागू)।");
      var c = cell(raw), split = c.i !== c.c, mx = Math.max(top(c.i), top(c.c));
      var val = c.i.indexOf("/") >= 0 ? c.i : +c.i, catI = CAT[top(c.i)], m = METHODS[mi];
      var lab = split ? { en: "US MEC category " + c.i + " at initiation, " + c.c + " at continuation", hi: "यूएस एमईसी श्रेणी: शुरू करने पर " + c.i + ", जारी रखने पर " + c.c }
        : { en: "US MEC category " + c.i, hi: "यूएस एमईसी श्रेणी " + c.i };
      var lines = [{ en: r[1] + " with " + m[1] + ".", hi: r[2] + " और " + m[2] + "।" }];
      if (c.i.indexOf("/") >= 0) lines.push({ en: "Category " + c.i + " depends on severity or type; read the source clarification.", hi: "श्रेणी " + c.i + " गंभीरता या प्रकार पर निर्भर; स्रोत का स्पष्टीकरण देखें।" });
      if (split) lines.push({ en: "Initiation " + c.i + ", continuation " + c.c + ": " + CAT[top(c.c)][0], hi: "शुरू करना " + c.i + ", जारी रखना " + c.c + ": " + CAT[top(c.c)][1] });
      if (c.star) lines.push({ en: "The source has a clarification for this classification (asterisk); check it in the full US MEC table.", hi: "स्रोत में इस वर्गीकरण का स्पष्टीकरण है (तारांकन); पूरी यूएस एमईसी तालिका में देखें।" });
      lines.push({ en: "India follows WHO MEC 2015, and some categories differ from US MEC. WHO: copper IUD within 48 hours postpartum is category 1; 48 hours to under 4 weeks is category 3. WHO: DMPA while breastfeeding under 6 weeks is category 3. WHO: combined pills while breastfeeding 6 weeks to 6 months are category 3.",
        hi: "भारत डब्ल्यूएचओ एमईसी 2015 अपनाता है, और कुछ श्रेणियाँ यूएस एमईसी से अलग हैं। डब्ल्यूएचओ: प्रसव के 48 घंटे के भीतर कॉपर आईयूडी श्रेणी 1; 48 घंटे से 4 सप्ताह से कम श्रेणी 3। डब्ल्यूएचओ: 6 सप्ताह से कम स्तनपान में डीएमपीए श्रेणी 3। डब्ल्यूएचओ: 6 सप्ताह से 6 माह स्तनपान में संयुक्त गोली श्रेणी 3।" });
      if (r[0].indexOf("age_") === 0) lines.push({ en: "Age bands combine the per-method age ranges printed in the chart.", hi: "आयु वर्ग चार्ट में छपी विधि-वार आयु सीमाओं को मिलाकर बने हैं।" });
      return { ok: true, value: val, band: mx === 1 ? "normal" : mx === 4 ? "danger" : "caution", label: lab, lines: lines,
        rule: { en: "Category " + c.i + ": " + catI[0] + " Categories: 1 no restriction; 2 advantages generally outweigh risks; 3 risks usually outweigh advantages; 4 unacceptable health risk.",
                hi: "श्रेणी " + c.i + ": " + catI[1] + " श्रेणियाँ: 1 कोई प्रतिबंध नहीं; 2 लाभ आमतौर पर जोखिम से अधिक; 3 जोखिम आमतौर पर लाभ से अधिक; 4 अस्वीकार्य स्वास्थ्य जोखिम।" } };
    },
    examples: [
      { values: { condition: "htn_severe", method: "chc" }, expect: { value: 4, band: "danger" } },
      { values: { condition: "htn_severe", method: "dmpa" }, expect: { value: 3, band: "caution" } },
      { values: { condition: "htn_severe", method: "imp" }, expect: { value: 2, band: "caution" } },
      { values: { condition: "htn_severe", method: "lng" }, expect: { value: 2, band: "caution" } },
      { values: { condition: "htn_severe", method: "cu" }, expect: { value: 1, band: "normal" } },
      { values: { condition: "mig_aura", method: "chc" }, expect: { value: 4, band: "danger" } },
      { values: { condition: "mig_aura", method: "pop" }, expect: { value: 1, band: "normal" } },
      { values: { condition: "pp_bf_lt21", method: "chc" }, expect: { value: 4, band: "danger" } },
      { values: { condition: "pp_bf_lt21", method: "dmpa" }, expect: { value: 2, band: "caution" } },
      { values: { condition: "bleed_unexpl", method: "cu" }, expect: { value: 4, band: "danger" } },
      { values: { condition: "smoke_35_ge15", method: "chc" }, expect: { value: 4, band: "danger" } },
      { values: { condition: "smoke_35_ge15", method: "pop" }, expect: { value: 1, band: "normal" } },
      { values: { condition: "age_gt45", method: "dmpa" }, expect: { value: 2, band: "caution" } },
      { values: { condition: "hdp_hist", method: "chc" }, expect: { value: 2, band: "caution" } },
      { values: { condition: "sickle", method: "dmpa" }, expect: { value: "2/3", band: "caution" } },
      { values: { condition: "pp_sepsis", method: "lng" }, expect: { value: 4, band: "danger" } },
      { values: { condition: "iron_def", method: "chc" }, expect: { value: 1, band: "normal" } }
    ]
  };
  return M;
});
