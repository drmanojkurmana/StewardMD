/* Tokos explorer model: the Indian national cervical screening pathway. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.TOKOS_MODELS["cervical-screening"].
   Follows the MoHFW programme: women 30 to 65 years, VIA once every 5 years, VIA-positive women go to a gynaecologist or
   lady medical officer, cryotherapy if eligible, otherwise biopsy and treatment by grade. next(step, result) walks the
   algorithm one decision at a time; ageBand(age, symptomatic) picks the entry result; cryotherapyEligibility(findings)
   applies the eligibility and exclusion lists of the algorithm. Guideline versions are in guideline.
   Pap and HPV testing are not part of the programme algorithm; see otherTests for what the opened sources allow. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.TOKOS_MODELS = root.TOKOS_MODELS || {}; root.TOKOS_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function T(en, hi) { return { en: en, hi: hi }; }
  var AGE_MIN = 30, AGE_MAX = 65, INTERVAL_YEARS = 5, FOLLOWUP_YEARS = 1;

  var STEPS = {
    start: { kind: "decision", title: T("Who is in front of you?", "आपके सामने कौन है?"),
      text: T("The programme screens women aged 30 to 65 years. A woman with symptoms is not a screening case.", "कार्यक्रम 30 से 65 साल की स्त्रियों की screening करता है। लक्षण वाली स्त्री screening का केस नहीं है।"),
      results: { "age-30-65": "via", "under-30": "outside-under-30", "over-65": "outside-over-65", symptoms: "refer-symptoms" } },
    via: { kind: "decision", title: T("VIA", "VIA (acetic acid से cervix का निरीक्षण)"),
      text: T("Visual inspection of the cervix after 3 to 5% acetic acid. A trained paramedic can do it and the result is available at once. The accuracy of VIA falls after the menopause; where there are no resources for Pap, VIA can be used up to 65 years.",
              "3 से 5% acetic acid लगाने के बाद cervix का निरीक्षण। प्रशिक्षित paramedic यह कर सकता है और परिणाम तुरंत मिलता है। Menopause के बाद VIA की सटीकता घटती है; जहाँ Pap के संसाधन नहीं हैं वहाँ VIA 65 साल तक इस्तेमाल हो सकता है।"),
      results: { negative: "repeat-5y", positive: "refer-gyn" } },
    "repeat-5y": { kind: "end", title: T("VIA negative: repeat VIA after 5 years", "VIA negative: 5 साल बाद VIA दोहराएँ"),
      text: T("Screening is once every 5 years from 30 to 65 years.", "Screening 30 से 65 साल तक हर 5 साल में एक बार होती है।") },
    "refer-gyn": { kind: "decision", title: T("VIA positive: refer to a gynaecologist or lady medical officer", "VIA positive: स्त्री रोग विशेषज्ञ या lady medical officer के पास भेजें"),
      text: T("At the PHC, CHC or district hospital where one is available. Then decide: is the lesion eligible for cryotherapy? Treatment options in the programme include cryotherapy, thermo-coagulation and surgery.",
              "जहाँ उपलब्ध हो, PHC, CHC या district hospital में। फिर तय करें: क्या घाव cryotherapy के योग्य है? कार्यक्रम में उपचार के विकल्प cryotherapy, thermo-coagulation और surgery हैं।"),
      results: { "eligible-cryo": "cryotherapy", "not-eligible": "biopsy" } },
    cryotherapy: { kind: "action", title: T("Cryotherapy", "Cryotherapy"),
      text: T("Treat the eligible lesion with cryotherapy.", "योग्य घाव का cryotherapy से उपचार करें।"), results: { done: "followup-1y" } },
    biopsy: { kind: "decision", title: T("Biopsy: naked eye or colposcopy-guided", "Biopsy: naked eye या colposcopy-guided"),
      text: T("A lesion that is not eligible for cryotherapy needs a biopsy. Treat by the result.", "जो घाव cryotherapy के योग्य नहीं है उसकी biopsy चाहिए। परिणाम के अनुसार उपचार करें।"),
      results: { cin1: "cryotherapy-cin1", "cin2-3": "leep", cancer: "refer-tcc" } },
    "cryotherapy-cin1": { kind: "action", title: T("Low grade (CIN 1): cryotherapy", "Low grade (CIN 1): cryotherapy"),
      text: T("Treat with cryotherapy.", "Cryotherapy से उपचार करें।"), results: { done: "followup-1y" } },
    leep: { kind: "action", title: T("High grade (CIN 2 and 3): LEEP", "High grade (CIN 2 और 3): LEEP"),
      text: T("Treat with loop electrosurgical excision (LEEP).", "Loop electrosurgical excision (LEEP) से उपचार करें।"), results: { done: "followup-1y" } },
    "refer-tcc": { kind: "end", title: T("Cancer: refer to a tertiary cancer centre", "Cancer: tertiary cancer centre (TCC) भेजें"),
      text: T("Refer for staging and treatment.", "Staging और उपचार के लिए भेजें।") },
    "followup-1y": { kind: "end", title: T("Follow up after one year with VIA", "एक साल बाद VIA से follow up करें"),
      text: T("The algorithm ends here. This explorer treats a positive follow-up VIA as a new VIA-positive result (a teaching assumption, not stated in the algorithm).", "Algorithm यहीं समाप्त होता है। यह explorer follow-up VIA positive आने को नया VIA-positive परिणाम मानता है (शिक्षण की मान्यता, algorithm में नहीं लिखी)।") },
    "outside-under-30": { kind: "end", title: T("Under 30: outside the programme age band", "30 से कम: कार्यक्रम की आयु सीमा से बाहर"),
      text: T("The national programme targets women 30 to 65 years. This does not stop a clinician from evaluating symptoms or an abnormality at any age.", "राष्ट्रीय कार्यक्रम 30 से 65 साल की स्त्रियों को लक्षित करता है। इससे चिकित्सक किसी भी उम्र में लक्षण या असामान्यता की जाँच करने से नहीं रुकता।") },
    "outside-over-65": { kind: "end", title: T("Over 65: outside the programme age band", "65 से अधिक: कार्यक्रम की आयु सीमा से बाहर"),
      text: T("The national programme targets women 30 to 65 years. This does not stop a clinician from evaluating symptoms or an abnormality at any age.", "राष्ट्रीय कार्यक्रम 30 से 65 साल की स्त्रियों को लक्षित करता है। इससे चिकित्सक किसी भी उम्र में लक्षण या असामान्यता की जाँच करने से नहीं रुकता।") },
    "refer-symptoms": { kind: "end", title: T("Symptoms or a suspicious lesion: refer for diagnosis", "लक्षण या संदिग्ध घाव: निदान के लिए भेजें"),
      text: T("Refer promptly for accurate diagnosis and treatment. Postcoital bleeding, postmenopausal bleeding, an overt growth, an irregular surface or bleeding on touch are not screening findings.", "सही निदान और उपचार के लिए तुरंत भेजें। Postcoital bleeding, postmenopausal bleeding, दिखता हुआ growth, अनियमित सतह या छूने पर रक्तस्राव screening के निष्कर्ष नहीं हैं।") }
  };
  var IDS = Object.keys(STEPS);
  IDS.forEach(function (id) { STEPS[id].id = id; });
  var RESULT_LABEL = {
    "age-30-65": T("30 to 65 years, no symptoms", "30 से 65 साल, कोई लक्षण नहीं"), "under-30": T("Under 30 years", "30 साल से कम"),
    "over-65": T("Over 65 years", "65 साल से अधिक"), symptoms: T("Has symptoms", "लक्षण हैं"),
    negative: T("VIA negative", "VIA negative"), positive: T("VIA positive", "VIA positive"),
    "eligible-cryo": T("Lesion eligible for cryotherapy", "घाव cryotherapy के योग्य"), "not-eligible": T("Lesion not eligible for cryotherapy", "घाव cryotherapy के योग्य नहीं"),
    done: T("Done", "हो गया"), cin1: T("Low grade (CIN 1)", "Low grade (CIN 1)"), "cin2-3": T("High grade (CIN 2 and 3)", "High grade (CIN 2 और 3)"), cancer: T("Cancer", "Cancer")
  };

  function view(id) {
    var s = STEPS[id], r = s.results ? Object.keys(s.results) : [];
    return { id: id, kind: s.kind, title: s.title, text: s.text, terminal: s.kind === "end",
      results: r.map(function (k) { return { result: k, label: RESULT_LABEL[k], next: s.results[k] }; }) };
  }
  function next(step, result) {
    if (!STEPS[step]) return { ok: false, error: T("Unknown step.", "अज्ञात चरण।") };
    var s = STEPS[step];
    if (s.kind === "end") return { ok: false, error: T("This step ends the pathway.", "यह चरण pathway का अंत है।") };
    if (!s.results[result]) return { ok: false, error: T("That result does not apply at this step.", "यह परिणाम इस चरण पर लागू नहीं होता।") };
    return { ok: true, step: view(s.results[result]) };
  }
  function walk(results) {
    var cur = "start", path = [view("start")], i, r;
    for (i = 0; i < results.length; i++) {
      r = next(cur, results[i]);
      if (!r.ok) return { ok: false, at: i, error: r.error, path: path };
      cur = r.step.id; path.push(r.step);
    }
    return { ok: true, path: path, end: cur, terminal: STEPS[cur].kind === "end" };
  }
  function ageBand(age, symptomatic) {
    if (typeof age !== "number" || age !== age || age < 0 || age > 120) return { ok: false, error: T("Age is a number of years from 0 to 120.", "आयु 0 से 120 वर्ष के बीच की संख्या होती है।") };
    var r = symptomatic === true ? "symptoms" : age < AGE_MIN ? "under-30" : age > AGE_MAX ? "over-65" : "age-30-65";
    return { ok: true, result: r, next: STEPS.start.results[r] };
  }

  /* Cryotherapy eligibility and exclusions as printed under the programme algorithm. */
  var CRYO_FAIL = {
    quadrants: T("The lesion spreads over more than 2 quadrants of the cervix.", "घाव cervix के 2 से अधिक quadrants में फैला है।"),
    ectocervix: T("The lesion is not confined to the ectocervix (it extends to the vagina or the endocervix).", "घाव केवल ectocervix तक सीमित नहीं है (vagina या endocervix तक फैला है)।"),
    visible: T("The lesion is not visible in its entire extent.", "घाव पूरा दिखाई नहीं देता।"),
    probe: T("The largest available cryotherapy probe cannot cover the lesion.", "उपलब्ध सबसे बड़ी cryotherapy probe घाव को ढक नहीं सकती।"),
    invasive: T("Invasive cancer is suspected.", "Invasive cancer का संदेह है।"),
    postcoital: T("Postcoital bleeding.", "Postcoital bleeding।"), postmenopausal: T("Postmenopausal bleeding.", "Postmenopausal bleeding।"),
    overtGrowth: T("An overt cervical growth.", "Cervix पर दिखता हुआ growth।"), irregularSurface: T("An irregular surface.", "अनियमित सतह।"), bleedsOnTouch: T("The cervix bleeds on touch.", "छूने पर cervix से खून आता है।")
  };
  function cryotherapyEligibility(f) {
    if (!f || typeof f !== "object") return { ok: false, error: T("Give the findings as an object.", "निष्कर्ष object के रूप में दें।") };
    if (typeof f.quadrants !== "number" || f.quadrants !== f.quadrants || f.quadrants < 1 || f.quadrants > 4 || f.quadrants !== Math.floor(f.quadrants)) {
      return { ok: false, error: T("Quadrants involved is a whole number from 1 to 4.", "प्रभावित quadrants 1 से 4 के बीच पूर्ण संख्या होती है।") };
    }
    var bools = ["ectocervixOnly", "fullyVisible", "coverableByProbe", "suspectInvasive", "postcoitalBleeding", "postmenopausalBleeding", "overtGrowth", "irregularSurface", "bleedsOnTouch"], i;
    for (i = 0; i < bools.length; i++) if (typeof f[bools[i]] !== "boolean") return { ok: false, error: T(bools[i] + " is true or false.", bools[i] + " true या false होता है।") };
    var why = [];
    if (f.quadrants > 2) why.push("quadrants");
    if (!f.ectocervixOnly) why.push("ectocervix");
    if (!f.fullyVisible) why.push("visible");
    if (!f.coverableByProbe) why.push("probe");
    if (f.suspectInvasive) why.push("invasive");
    if (f.postcoitalBleeding) why.push("postcoital");
    if (f.postmenopausalBleeding) why.push("postmenopausal");
    if (f.overtGrowth) why.push("overtGrowth");
    if (f.irregularSurface) why.push("irregularSurface");
    if (f.bleedsOnTouch) why.push("bleedsOnTouch");
    return { ok: true, eligible: why.length === 0, reasonIds: why, reasons: why.map(function (k) { return CRYO_FAIL[k]; }), result: why.length === 0 ? "eligible-cryo" : "not-eligible" };
  }

  return {
    id: "cervical-screening", kind: "explorer", group: "gynaecology", level: "mbbs",
    title: { en: "Cervical screening in India", hi: "भारत में cervical screening" },
    subtitle: { en: "Walk the national VIA pathway, step by step", hi: "राष्ट्रीय VIA pathway पर एक-एक कदम चलें" },
    guideline: {
      name: "Ministry of Health and Family Welfare, Government of India",
      algorithm: { title: "Operational Framework: Management of Common Cancers", version: "26 August 2016", year: 2016, annexure: "1b, Screening and Management Algorithm for cervical cancer" },
      current: { title: "NP-NCD Training Module for Medical Officers (based on the NP-NCD Operational Guidelines 2023-2030)", version: "NHM website 2025-26 update; PDF dated 25 November 2025", year: 2025 }
    },
    sources: [
      { label: "MoHFW. Operational Framework: Management of Common Cancers, 26 August 2016 (Table 1 and Annexure 1b: age 30 to 65, VIA once in 5 years, the algorithm, cryotherapy criteria)", url: "https://nhsrcindia.org/sites/default/files/2021-03/Operational%20Framework%20Management%20of%20Common%20Cancers.pdf" },
      { label: "MoHFW. National Programme for Non-Communicable Diseases (NP-NCD) Training Module for Medical Officers, NHM 2025-26 (section 2.4.3.3: VIA once every 5 years at 30 to 65; treatment options)", url: "https://nhm.gov.in/New-Update-2025-26/Whats-new/NCD-Medical-Officers.pdf" },
      { label: "NHM Odisha. National Cancer Screening guidelines: Orientation to the Operational Framework (offer screening to any woman over 30 attending; refer suspicious lesions promptly)", url: "https://nhmodisha.gov.in/wp-content/uploads/2023/08/Cancer-Screening-Rationale-Framework.pdf" },
      { label: "Bhatla N et al. FOGSI good clinical practice recommendations on screening and management of preinvasive lesions of the cervix. J Obstet Gynaecol Res 2020;46(2):201-214 (abstract only)", url: "https://pubmed.ncbi.nlm.nih.gov/31814222/" }
    ],
    review: "ai_drafted",
    notes: {
      scope: { en: "This is the government programme pathway (VIA). Professional societies and individual clinicians may use HPV testing or cytology; see the note on other tests.", hi: "यह सरकारी कार्यक्रम का pathway (VIA) है। पेशेवर संस्थाएँ और चिकित्सक HPV testing या cytology भी इस्तेमाल कर सकते हैं; अन्य जाँचों वाला नोट देखें।" },
      version: { en: "Source versions: the algorithm is from the 2016 Operational Framework; the 30 to 65 year, once in 5 years rule is repeated in the NP-NCD Training Module for Medical Officers on the NHM site (2025-26).", hi: "स्रोत संस्करण: algorithm 2016 के Operational Framework से है; 30 से 65 साल, 5 साल में एक बार का नियम NHM साइट के NP-NCD Training Module for Medical Officers (2025-26) में दोहराया गया है।" }
    },
    otherTests: {
      pap: { en: "The programme algorithm notes that VIA is less accurate in postmenopausal women, and that where there are no resources for Pap, women may be screened with VIA up to 65 years. It gives no Pap interval, so none is modelled.", hi: "Programme algorithm में लिखा है कि menopause के बाद VIA कम सटीक होती है, और जहाँ Pap के संसाधन नहीं हैं वहाँ स्त्रियों की VIA से 65 साल तक screening हो सकती है। Pap का कोई अंतराल नहीं दिया गया, इसलिए यहाँ मॉडल नहीं किया गया।" },
      hpv: { en: "The FOGSI 2018 recommendations (abstract) prefer HPV testing and suggest VIA by trained providers in low-resource settings until an affordable HPV test is available. Age bands and intervals for HPV testing are not modelled because the full text could not be opened.", hi: "FOGSI 2018 की सिफ़ारिशें (abstract) HPV testing को प्राथमिकता देती हैं और कम संसाधन वाली जगहों में सस्ता HPV test उपलब्ध होने तक प्रशिक्षित प्रदाताओं द्वारा VIA सुझाती हैं। HPV testing की आयु सीमा और अंतराल मॉडल नहीं किए गए क्योंकि पूरा पाठ नहीं खुल सका।" }
    },
    constants: { ageMin: AGE_MIN, ageMax: AGE_MAX, intervalYears: INTERVAL_YEARS, followUpYears: FOLLOWUP_YEARS },
    steps: STEPS, stepIds: IDS, resultLabels: RESULT_LABEL, start: "start",
    view: view, next: next, walk: walk, ageBand: ageBand, cryotherapyEligibility: cryotherapyEligibility
  };
});
