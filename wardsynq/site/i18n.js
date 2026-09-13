/* wardsynq/site/i18n.js - the words AROUND a patient's record, in the patient's language. P2.7.
 *
 * Buildless ES5, no dependency. window.WSQI18n, and module.exports for tests.
 *
 * WHAT IS TRANSLATED: labels, headings, instructions and states that this product wrote ("Your
 * medicines", "No allergies are recorded"). WHAT IS NEVER TRANSLATED: anything a clinician or a
 * coding system recorded - drug names, doses, routes, frequencies, diagnosis text and codes, test
 * names, units, results, free-text instructions. Those are shown exactly as recorded, inside
 * translated labels. A machine-translated dose or drug name is a medication error waiting to happen,
 * so there is no function here that takes clinical text at all: t() only looks up keys.
 *
 * FALLBACK IS ENGLISH, PER KEY. A key missing from a language shows the English string, never the
 * key and never a blank. missingKeys(lang) lists them, and test/wardsynq-i18n.test.mjs prints that
 * list, so a gap is visible rather than silent.
 *
 * PLUGGABLE. register(code, name, catalog) adds a language; nothing else changes. The Hindi catalog
 * below is marked reviewed:false - it was written without a native-speaker clinical review and must
 * get one before it is relied on.
 *
 * t() returns PLAIN TEXT. Variables are substituted as given; the caller escapes the result.
 */
(function (root) {
  "use strict";

  var EN = {
    "lang.label": "Language",
    "lang.codedNote": "Medicine names, doses, test names, results and diagnoses are shown exactly as your care team recorded them. They are not translated.",

    "portal.title.yours": "Your record",
    "portal.title.proxy": "Record of {name}",
    "portal.thePatient": "the patient",
    "portal.proxyNote": "You are viewing as {relationship}, with the patient's agreement. You can see only what they agreed to share.",
    "portal.familyMember": "a family member",
    "section.failed": "We could not load this part of your record. This does not mean there is nothing here. Try again later.",

    "appt.title": "Appointments",
    "appt.tbc": "Time to be confirmed",
    "appt.with": "with {who}",
    "appt.empty": "No appointments are booked.",
    "appt.ask": "Ask for an appointment",
    "appt.askNote": "This sends a request. Nothing is booked until the hospital contacts you.",
    "appt.reason": "What is it for?",
    "appt.pref": "Days or times that suit you (optional)",
    "appt.send": "Send request",
    "appt.sent": "Request sent.",

    "meds.title": "Prescriptions and medicines",
    "meds.empty": "No current medicines are listed.",
    "results.title": "Lab and radiology results",
    "results.empty": "No results have been shared with you yet.",
    "dx.title": "Diagnoses",
    "dx.empty": "No diagnoses are listed.",
    "allergy.title": "Allergies",
    "allergy.empty": "No allergies are recorded.",

    "dc.title": "Discharge summaries and care instructions",
    "dc.stay": "Your stay",
    "dc.meds": "Medicines",
    "dc.care": "Care instructions",
    "dc.empty": "No discharge summary has been shared with you.",

    "bills.title": "Bills and payments",
    "bills.cancelled": "Cancelled",
    "bills.paid": "Paid",
    "bills.due": "Balance due {amount}",
    "bills.summary": "Charged {charged}, paid {paid}",
    "bills.empty": "You have no bills.",

    "consents.title": "Consents",
    "consents.withdraw": "Withdraw this consent",
    "consents.speak": "To withdraw this, speak to your care team.",
    "consents.empty": "No consents are recorded.",
    "consents.confirm": "Withdraw this consent from now? Your care team will see this.",

    "msg.title": "Messages to your care team",
    "msg.notEmergency": "This is not a way to get urgent help.",
    "msg.label": "Your message",
    "msg.send": "Send message",
    "msg.sent": "Sent.",
    "msg.reply": "Reply {when}:",
    "msg.unanswered": "Not answered yet.",
    "msg.empty": "You have not sent any messages.",
    "msg.writeFirst": "Write a message first.",

    "phase.loading": "Loading your record...",
    "phase.failed": "We could not load your record. This is a connection or server problem, not an empty record.",
    "phase.retry": "Try again",
    "phase.ended": "Your session has ended.",
    "phase.newCode": "Ask your care team for a new code.",
    "phase.startAgain": "Start again",
    "signout": "Sign out",

    "signin.title": "Sign in to your record",
    "signin.intro": "Use the access ID and code your care team gave you in person. The code works once.",
    "signin.hospital": "Hospital ID",
    "signin.access": "Access ID",
    "signin.code": "Code",
    "signin.submit": "Sign in",
    "signin.checking": "Checking...",
    "signin.invalid": "That code is not valid.",
    "signin.unreachable": "We could not reach the hospital. Check your connection and try again.",

    "action.failed": "That did not go through. Nothing was sent.",
    "action.failedShort": "That did not go through.",

    "pcopy.noAllergies": "No allergies are recorded for you. Tell your care team if you know of any.",
    "pcopy.dx": "Your diagnoses",
    "pcopy.dxEmpty": "No diagnoses are recorded.",
    "pcopy.meds": "Your medicines",
    "pcopy.medsEmpty": "No medicines are recorded.",
    "pcopy.results": "Your results",
    "pcopy.resultsEmpty": "No results are ready to be given to you yet.",
    "pcopy.withheld": "Not included here",
    "pcopy.appts": "Next appointments",
    "pcopy.apptsEmpty": "No appointment is booked.",
    "pcopy.print": "Print",

    "nav.map": "Map",
    "nav.workstation": "Workstation",
    "nav.ward": "Ward",
    "nav.beds": "Bed board",
    "nav.emergency": "Emergency",
    "nav.criticals": "Critical results",
    "nav.lab": "Laboratory",
    "nav.radiology": "Radiology",
    "nav.opd": "OPD desk",
    "nav.patients": "Patients",
    "nav.command": "Command",
    "nav.commandCenter": "Command center",
    "nav.twin": "Digital twin",
    "nav.reports": "Reports",
    "nav.billing": "Billing",
    "nav.integration": "Integration",
    "nav.maik": "MaiK",
    "nav.administration": "Administration",
    "nav.adminCenter": "Admin Center",
    "nav.audit": "Audit and security",
    "nav.security": "Sign-in security",
    "nav.rota": "Staff rota",
    "nav.accounts": "Accounts"
  };

  /* Hindi. reviewed:false - NOT yet checked by a native speaker with clinical context. */
  var HI = {
    "lang.label": "भाषा",
    "lang.codedNote": "दवाओं के नाम, खुराक, जाँच के नाम, रिपोर्ट और निदान ठीक वैसे ही दिखाए जाते हैं जैसे आपकी देखभाल टीम ने दर्ज किए हैं। इनका अनुवाद नहीं किया जाता।",

    "portal.title.yours": "आपका रिकॉर्ड",
    "portal.title.proxy": "{name} का रिकॉर्ड",
    "portal.thePatient": "मरीज़",
    "portal.proxyNote": "आप {relationship} के रूप में, मरीज़ की सहमति से देख रहे हैं। आप केवल वही देख सकते हैं जो उन्होंने साझा करने की सहमति दी है।",
    "portal.familyMember": "परिवार के सदस्य",
    "section.failed": "हम आपके रिकॉर्ड का यह हिस्सा लोड नहीं कर सके। इसका मतलब यह नहीं है कि यहाँ कुछ नहीं है। बाद में फिर से कोशिश करें।",

    "appt.title": "अपॉइंटमेंट",
    "appt.tbc": "समय की पुष्टि होनी बाकी है",
    "appt.with": "{who} के साथ",
    "appt.empty": "कोई अपॉइंटमेंट बुक नहीं है।",
    "appt.ask": "अपॉइंटमेंट का अनुरोध करें",
    "appt.askNote": "इससे केवल एक अनुरोध भेजा जाता है। जब तक अस्पताल आपसे संपर्क नहीं करता, कुछ भी बुक नहीं होता।",
    "appt.reason": "यह किस लिए है?",
    "appt.pref": "आपके लिए सुविधाजनक दिन या समय (वैकल्पिक)",
    "appt.send": "अनुरोध भेजें",
    "appt.sent": "अनुरोध भेज दिया गया।",

    "meds.title": "पर्चे और दवाइयाँ",
    "meds.empty": "अभी कोई दवा सूचीबद्ध नहीं है।",
    "results.title": "लैब और रेडियोलॉजी रिपोर्ट",
    "results.empty": "अभी तक आपके साथ कोई रिपोर्ट साझा नहीं की गई है।",
    "dx.title": "निदान",
    "dx.empty": "कोई निदान सूचीबद्ध नहीं है।",
    "allergy.title": "एलर्जी",
    "allergy.empty": "कोई एलर्जी दर्ज नहीं है।",

    "dc.title": "डिस्चार्ज सारांश और देखभाल के निर्देश",
    "dc.stay": "अस्पताल में आपका समय",
    "dc.meds": "दवाइयाँ",
    "dc.care": "देखभाल के निर्देश",
    "dc.empty": "आपके साथ कोई डिस्चार्ज सारांश साझा नहीं किया गया है।",

    "bills.title": "बिल और भुगतान",
    "bills.cancelled": "रद्द",
    "bills.paid": "भुगतान हो गया",
    "bills.due": "बकाया राशि {amount}",
    "bills.summary": "कुल शुल्क {charged}, भुगतान {paid}",
    "bills.empty": "आपका कोई बिल नहीं है।",

    "consents.title": "सहमतियाँ",
    "consents.withdraw": "यह सहमति वापस लें",
    "consents.speak": "इसे वापस लेने के लिए अपनी देखभाल टीम से बात करें।",
    "consents.empty": "कोई सहमति दर्ज नहीं है।",
    "consents.confirm": "क्या आप अभी से यह सहमति वापस लेना चाहते हैं? आपकी देखभाल टीम इसे देखेगी।",

    "msg.title": "आपकी देखभाल टीम को संदेश",
    "msg.notEmergency": "यह तुरंत मदद पाने का तरीका नहीं है।",
    "msg.label": "आपका संदेश",
    "msg.send": "संदेश भेजें",
    "msg.sent": "भेज दिया गया।",
    "msg.reply": "जवाब {when}:",
    "msg.unanswered": "अभी तक जवाब नहीं आया है।",
    "msg.empty": "आपने अभी तक कोई संदेश नहीं भेजा है।",
    "msg.writeFirst": "पहले संदेश लिखें।",

    "phase.loading": "आपका रिकॉर्ड लोड हो रहा है...",
    "phase.failed": "हम आपका रिकॉर्ड लोड नहीं कर सके। यह कनेक्शन या सर्वर की समस्या है, इसका मतलब यह नहीं कि रिकॉर्ड खाली है।",
    "phase.retry": "फिर से कोशिश करें",
    "phase.ended": "आपका सत्र समाप्त हो गया है।",
    "phase.newCode": "नए कोड के लिए अपनी देखभाल टीम से पूछें।",
    "phase.startAgain": "फिर से शुरू करें",
    "signout": "साइन आउट करें",

    "signin.title": "अपने रिकॉर्ड में साइन इन करें",
    "signin.intro": "वह एक्सेस आईडी और कोड इस्तेमाल करें जो आपकी देखभाल टीम ने आपको स्वयं दिया था। कोड केवल एक बार काम करता है।",
    "signin.hospital": "अस्पताल आईडी",
    "signin.access": "एक्सेस आईडी",
    "signin.code": "कोड",
    "signin.submit": "साइन इन करें",
    "signin.checking": "जाँच हो रही है...",
    "signin.invalid": "यह कोड मान्य नहीं है।",
    "signin.unreachable": "हम अस्पताल से संपर्क नहीं कर सके। अपना कनेक्शन जाँचें और फिर से कोशिश करें।",

    "action.failed": "यह पूरा नहीं हुआ। कुछ भी नहीं भेजा गया।",
    "action.failedShort": "यह पूरा नहीं हुआ।",

    "pcopy.noAllergies": "आपके लिए कोई एलर्जी दर्ज नहीं है। अगर आपको किसी एलर्जी के बारे में पता है तो अपनी देखभाल टीम को बताएँ।",
    "pcopy.dx": "आपके निदान",
    "pcopy.dxEmpty": "कोई निदान दर्ज नहीं है।",
    "pcopy.meds": "आपकी दवाइयाँ",
    "pcopy.medsEmpty": "कोई दवा दर्ज नहीं है।",
    "pcopy.results": "आपकी रिपोर्ट",
    "pcopy.resultsEmpty": "अभी आपको देने के लिए कोई रिपोर्ट तैयार नहीं है।",
    "pcopy.withheld": "यहाँ शामिल नहीं है",
    "pcopy.appts": "अगले अपॉइंटमेंट",
    "pcopy.apptsEmpty": "कोई अपॉइंटमेंट बुक नहीं है।",
    "pcopy.print": "प्रिंट करें",

    "nav.map": "मैप",
    "nav.workstation": "वर्कस्टेशन",
    "nav.ward": "वार्ड",
    "nav.beds": "बेड बोर्ड",
    "nav.emergency": "इमरजेंसी",
    "nav.criticals": "क्रिटिकल रिपोर्ट",
    "nav.lab": "लैब",
    "nav.radiology": "रेडियोलॉजी",
    "nav.opd": "ओपीडी डेस्क",
    "nav.patients": "मरीज़",
    "nav.command": "कमांड",
    "nav.commandCenter": "कमांड सेंटर",
    "nav.twin": "डिजिटल ट्विन",
    "nav.reports": "रिपोर्ट",
    "nav.billing": "बिलिंग",
    "nav.integration": "इंटीग्रेशन",
    "nav.administration": "प्रशासन",
    "nav.adminCenter": "एडमिन सेंटर",
    "nav.audit": "ऑडिट और सुरक्षा",
    "nav.security": "साइन-इन सुरक्षा",
    "nav.rota": "स्टाफ रोस्टर",
    "nav.accounts": "अकाउंट"
  };

  var CATALOGS = { en: EN, hi: HI };
  var LANGS = [{ code: "en", name: "English", reviewed: true }, { code: "hi", name: "हिन्दी", reviewed: false }];
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  /** A supported language code, or "en". */
  function normalize(code) { var c = String(code || "").toLowerCase().split("-")[0]; return has(CATALOGS, c) ? c : "en"; }

  /** PURE. The string for key in lang, English when that language lacks it, the key itself only when
   *  English lacks it too (a programming error, which the test catches). {name} placeholders filled. */
  function t(key, vars, lang) {
    var cat = CATALOGS[normalize(lang)];
    var s = has(cat, key) ? cat[key] : has(EN, key) ? EN[key] : key;
    return vars ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return has(vars, k) && vars[k] != null ? String(vars[k]) : m; }) : String(s);
  }

  /** PURE. English keys this language does not have, sorted. */
  function missingKeys(lang) {
    var cat = CATALOGS[normalize(lang)];
    return Object.keys(EN).filter(function (k) { return !has(cat, k); }).sort();
  }

  /** Adds or replaces a language. Keys not in English are ignored by t(), so a typo cannot hide. */
  function register(code, name, catalog, reviewed) {
    var c = String(code || "").toLowerCase();
    if (!/^[a-z]{2,3}$/.test(c) || !catalog || typeof catalog !== "object") return false;
    CATALOGS[c] = catalog;
    LANGS = LANGS.filter(function (l) { return l.code !== c; }).concat([{ code: c, name: String(name || c), reviewed: reviewed === true }]);
    return true;
  }

  function languages() { return LANGS.slice(); }

  var api = { t: t, normalize: normalize, missingKeys: missingKeys, register: register, languages: languages, _catalogs: CATALOGS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WSQI18n = api;
})(typeof window !== "undefined" ? window : null);
