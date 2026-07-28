/* FollowCare AI — i18n core (Phase 2 enhancement). DETERMINISTIC, no LLM, no per-call machine translation.
 *
 * Two jobs, both pure and testable:
 *   1. detectLanguage(stateOrAddress) — map a GHIS state/city/address string to the patient's regional
 *      language, deterministically (state name → language, with city + postal-abbreviation fallbacks).
 *   2. t(key, lang, vars) — look up a REVIEWED translation string from a static registry, always falling
 *      back to English (then to the key itself). We NEVER call a translation API at runtime; strings are
 *      curated and reviewed. Adding a language = adding a column; adding a string = adding a key. English is
 *      the source of truth, so an unreviewed language degrades gracefully to English instead of breaking.
 *
 * Used by the patient portal (followcare.html), the SMS/WhatsApp/email dispatcher (_followcare_dispatch.js),
 * and enrolment auto-detection. window.FollowCareI18n + module.exports. No network, no PHI.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  // ---- language catalogue -----------------------------------------------------------------
  // reviewed:true means a human has reviewed this language's strings; false = scaffold (falls back to en
  // per-key until reviewed). English is always reviewed and is the fallback for everything.
  var LANGS = [
    { code: "en", name: "English", native: "English", reviewed: true },
    { code: "hi", name: "Hindi", native: "हिन्दी", reviewed: true },
    { code: "te", name: "Telugu", native: "తెలుగు", reviewed: true },
    { code: "ta", name: "Tamil", native: "தமிழ்", reviewed: false },
    { code: "kn", name: "Kannada", native: "ಕನ್ನಡ", reviewed: false },
    { code: "ml", name: "Malayalam", native: "മലയാളം", reviewed: false },
    { code: "mr", name: "Marathi", native: "मराठी", reviewed: false },
    { code: "gu", name: "Gujarati", native: "ગુજરાતી", reviewed: false },
    { code: "bn", name: "Bengali", native: "বাংলা", reviewed: false },
    { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ", reviewed: false },
    { code: "or", name: "Odia", native: "ଓଡ଼ିଆ", reviewed: false },
    { code: "as", name: "Assamese", native: "অসমীয়া", reviewed: false }
  ];
  var LANG_BY_CODE = {}; LANGS.forEach(function (l) { LANG_BY_CODE[l.code] = l; });

  // ---- state / city → language (deterministic) --------------------------------------------
  // Ordered list of { lang, names:[...], cities:[...] }. Names + cities are matched as whole tokens
  // (boundary-aware) against the normalized address, so "Bengaluru" never matches "bengal" (West Bengal).
  var REGIONS = [
    { lang: "te", names: ["andhra pradesh", "andhra", "telangana", "telengana"], cities: ["hyderabad", "vijayawada", "visakhapatnam", "vizag", "guntur", "warangal", "tirupati", "nellore", "rajahmundry", "kakinada", "karimnagar"] },
    { lang: "ta", names: ["tamil nadu", "tamilnadu"], cities: ["chennai", "coimbatore", "madurai", "tiruchirappalli", "trichy", "salem", "tirunelveli", "vellore", "erode", "thanjavur"] },
    { lang: "kn", names: ["karnataka"], cities: ["bengaluru", "bangalore", "mysuru", "mysore", "hubli", "hubballi", "mangaluru", "mangalore", "belagavi", "belgaum", "kalaburagi", "gulbarga", "davangere"] },
    { lang: "ml", names: ["kerala"], cities: ["thiruvananthapuram", "trivandrum", "kochi", "cochin", "kozhikode", "calicut", "thrissur", "kollam", "kannur", "kottayam", "palakkad", "malappuram"] },
    { lang: "or", names: ["odisha", "orissa"], cities: ["bhubaneswar", "cuttack", "rourkela", "berhampur", "sambalpur", "puri"] },
    { lang: "mr", names: ["maharashtra"], cities: ["mumbai", "pune", "nagpur", "nashik", "aurangabad", "solapur", "thane", "kolhapur", "amravati", "navi mumbai"] },
    { lang: "gu", names: ["gujarat"], cities: ["ahmedabad", "surat", "vadodara", "baroda", "rajkot", "bhavnagar", "jamnagar", "gandhinagar", "junagadh"] },
    { lang: "bn", names: ["west bengal", "bengal"], cities: ["kolkata", "calcutta", "howrah", "durgapur", "asansol", "siliguri", "darjeeling"] },
    { lang: "pa", names: ["punjab"], cities: ["amritsar", "ludhiana", "jalandhar", "patiala", "bathinda", "mohali"] },
    { lang: "as", names: ["assam"], cities: ["guwahati", "dibrugarh", "silchar", "jorhat", "tezpur", "nagaon"] },
    // Hindi belt — several states + Delhi/UTs, all → Hindi.
    { lang: "hi", names: ["bihar", "uttar pradesh", "madhya pradesh", "rajasthan", "haryana", "delhi", "new delhi", "chhattisgarh", "chattisgarh", "jharkhand", "uttarakhand", "uttaranchal", "himachal pradesh", "himachal", "chandigarh"],
      cities: ["patna", "lucknow", "kanpur", "varanasi", "prayagraj", "allahabad", "agra", "meerut", "bhopal", "indore", "gwalior", "jabalpur", "jaipur", "jodhpur", "udaipur", "kota", "gurugram", "gurgaon", "faridabad", "noida", "ghaziabad", "ranchi", "jamshedpur", "raipur", "bilaspur", "dehradun", "haridwar", "shimla"] }
  ];
  // Postal / common uppercase abbreviations (matched case-sensitively on the ORIGINAL string, lowest priority).
  var ABBR = [
    ["AP", "te"], ["TS", "te"], ["TG", "te"], ["TN", "ta"], ["KA", "kn"], ["KL", "ml"], ["OD", "or"], ["OR", "or"],
    ["MH", "mr"], ["GJ", "gu"], ["WB", "bn"], ["PB", "pa"], ["AS", "as"],
    ["UP", "hi"], ["MP", "hi"], ["RJ", "hi"], ["HR", "hi"], ["DL", "hi"], ["CG", "hi"], ["JH", "hi"], ["UK", "hi"], ["UA", "hi"], ["HP", "hi"], ["BR", "hi"]
  ];

  function normalize(s) {
    var str = String(s == null ? "" : s).toLowerCase();
    try { str = str.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return str.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  // Whole-token (boundary-aware) containment: does `needle` appear as a standalone word/phrase in `hay`?
  function hasToken(hay, needle) {
    if (!needle) return false;
    var i = hay.indexOf(needle);
    while (i !== -1) {
      var before = i === 0 ? " " : hay.charAt(i - 1);
      var afterIdx = i + needle.length;
      var after = afterIdx >= hay.length ? " " : hay.charAt(afterIdx);
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
      i = hay.indexOf(needle, i + 1);
    }
    return false;
  }

  // Detect the patient's language from a GHIS state / city / address string.
  // Returns { lang, method:"state"|"city"|"abbr"|"default", region, native, name }.
  function detectLanguage(stateOrAddress) {
    var norm = normalize(stateOrAddress);
    var i, j;
    // 1. Explicit state / region name (highest confidence).
    if (norm) {
      for (i = 0; i < REGIONS.length; i++) {
        for (j = 0; j < REGIONS[i].names.length; j++) {
          if (hasToken(norm, REGIONS[i].names[j])) return result(REGIONS[i].lang, "state", REGIONS[i].names[j]);
        }
      }
      // 2. Major city.
      for (i = 0; i < REGIONS.length; i++) {
        for (j = 0; j < REGIONS[i].cities.length; j++) {
          if (hasToken(norm, REGIONS[i].cities[j])) return result(REGIONS[i].lang, "city", REGIONS[i].cities[j]);
        }
      }
    }
    // 3. Uppercase postal abbreviation on the ORIGINAL text (avoids matching common lowercase words).
    var orig = String(stateOrAddress == null ? "" : stateOrAddress);
    for (i = 0; i < ABBR.length; i++) {
      if (new RegExp("\\b" + ABBR[i][0] + "\\b").test(orig)) return result(ABBR[i][1], "abbr", ABBR[i][0]);
    }
    // 4. Default → English (spec: unknown → English).
    return result("en", "default", null);
  }
  function result(lang, method, region) {
    var L = LANG_BY_CODE[lang] || LANG_BY_CODE.en;
    return { lang: L.code, method: method, region: region, native: L.native, name: L.name };
  }

  // ---- translation registry (reviewed strings) --------------------------------------------
  // STR[key] = { en:"...", hi:"...", te:"...", ... }. Missing language for a key → English fallback.
  // {placeholders} are filled by t(...vars). English is complete; hi/te reviewed for the patient-facing
  // surfaces; other languages fall back to English until a reviewer fills them in.
  var STR = {
    // Outbound messages (SMS / WhatsApp / email body). Keep PHI-light: first name + opaque link only.
    "fc.msg.send": {
      en: "Hi {name}, this is your StewardMD recovery check-in. It only takes a minute: {link}",
      hi: "नमस्ते {name}, यह आपका StewardMD रिकवरी चेक-इन है। इसमें बस एक मिनट लगेगा: {link}",
      te: "నమస్తే {name}, ఇది మీ StewardMD రికవరీ చెక్-ఇన్. ఇది ఒక నిమిషం మాత్రమే పడుతుంది: {link}"
    },
    "fc.msg.remind": {
      en: "Reminder: please complete your StewardMD recovery check-in when you can: {link}",
      hi: "याद दिलाना: कृपया समय मिलने पर अपना StewardMD रिकवरी चेक-इन पूरा करें: {link}",
      te: "గుర్తు చేయడం: వీలైనప్పుడు మీ StewardMD రికవరీ చెక్-ఇన్ పూర్తి చేయండి: {link}"
    },
    "fc.msg.reminder_med": {
      en: "Reminder from StewardMD: please take your medicines as advised by your doctor. {link}",
      hi: "StewardMD की ओर से याद दिलाना: कृपया अपने डॉक्टर की सलाह अनुसार दवाइयाँ लें। {link}",
      te: "StewardMD నుండి గుర్తు: దయచేసి మీ వైద్యుడు సూచించిన విధంగా మందులు తీసుకోండి. {link}"
    },
    "fc.msg.welcome": {
      en: "You've been enrolled in StewardMD recovery follow-up by your care team. We'll gently check in on how you're recovering. Open your secure check-in here: {link}",
      hi: "आपकी देखभाल टीम ने आपको StewardMD रिकवरी फ़ॉलो-अप में जोड़ा है। हम आपकी रिकवरी के बारे में जानने के लिए संपर्क करते रहेंगे। अपना सुरक्षित चेक-इन यहाँ खोलें: {link}",
      te: "మీ సంరక్షణ బృందం మిమ్మల్ని StewardMD రికవరీ ఫాలో-అప్‌లో చేర్చారు. మీ కోలుకోవడం గురించి మేము సున్నితంగా తెలుసుకుంటాము. మీ సురక్షిత చెక్-ఇన్‌ను ఇక్కడ తెరవండి: {link}"
    },
    "fc.msg.reminder_appt": {
      en: "Reminder from StewardMD: you have a follow-up appointment coming up. {link}",
      hi: "StewardMD की ओर से याद दिलाना: आपकी आगामी फ़ॉलो-अप अपॉइंटमेंट है। {link}",
      te: "StewardMD నుండి గుర్తు: మీకు రాబోయే ఫాలో-అప్ అపాయింట్‌మెంట్ ఉంది. {link}"
    },

    // Patient portal chrome.
    "fc.portal.title": { en: "Recovery check-in", hi: "रिकवरी चेक-इन", te: "రికవరీ చెక్-ఇన్" },
    "fc.portal.loading": { en: "Loading your check-in...", hi: "आपका चेक-इन लोड हो रहा है...", te: "మీ చెక్-ఇన్ లోడ్ అవుతోంది..." },
    "fc.portal.submit": { en: "Submit", hi: "जमा करें", te: "సమర్పించండి" },
    "fc.portal.thanks": { en: "Thank you. Your care team has your update.", hi: "धन्यवाद। आपकी देखभाल टीम को आपका अपडेट मिल गया है।", te: "ధన్యవాదాలు. మీ సంరక్షణ బృందానికి మీ నవీకరణ అందింది." },
    "fc.portal.unavailable": { en: "This check-in link is temporarily unavailable. Please try again later.", hi: "यह चेक-इन लिंक अस्थायी रूप से अनुपलब्ध है। कृपया बाद में पुनः प्रयास करें।", te: "ఈ చెక్-ఇన్ లింక్ తాత్కాలికంగా అందుబాటులో లేదు. దయచేసి తర్వాత మళ్లీ ప్రయత్నించండి." },
    "fc.portal.red_seek_care": { en: "Based on your answers, please seek urgent medical care now.", hi: "आपके उत्तरों के आधार पर, कृपया अभी तुरंत चिकित्सा सहायता लें।", te: "మీ సమాధానాల ఆధారంగా, దయచేసి ఇప్పుడే అత్యవసర వైద్య సహాయం పొందండి." },
    "fc.portal.call_hospital": { en: "Call the hospital", hi: "अस्पताल को कॉल करें", te: "ఆసుపత్రికి కాల్ చేయండి" },

    // First-run language prompt.
    "fc.lang.prompt": { en: "Would you like to continue in {lang}?", hi: "क्या आप {lang} में जारी रखना चाहेंगे?", te: "మీరు {lang}లో కొనసాగించాలనుకుంటున్నారా?" },
    "fc.lang.continue": { en: "Continue in {lang}", hi: "{lang} में जारी रखें", te: "{lang}లో కొనసాగించండి" },
    "fc.lang.english": { en: "Continue in English", hi: "अंग्रेज़ी में जारी रखें", te: "ఆంగ్లంలో కొనసాగించండి" },
    "fc.lang.choose": { en: "Choose another language", hi: "दूसरी भाषा चुनें", te: "మరో భాషను ఎంచుకోండి" },
    "fc.lang.choose_title": { en: "Choose your language", hi: "अपनी भाषा चुनें", te: "మీ భాషను ఎంచుకోండి" },
    "fc.lang.change_hint": { en: "You can change your language anytime in Settings.", hi: "आप सेटिंग्स में कभी भी अपनी भाषा बदल सकते हैं।", te: "మీరు సెట్టింగ్‌లలో ఎప్పుడైనా మీ భాషను మార్చవచ్చు." },
    "fc.lang.settings": { en: "Language", hi: "भाषा", te: "భాష" },

    // A reviewed subset of check-in question labels (portal swaps these in by i18nKey; the rest fall back to
    // the English question text carried in the pathway). Extend freely — English is always the safety net.
    "fc.q.overall": { en: "Overall, how are you feeling since discharge?", hi: "छुट्टी के बाद कुल मिलाकर आप कैसा महसूस कर रहे हैं?", te: "డిశ్చార్జ్ తర్వాత మొత్తంగా మీరు ఎలా అనిపిస్తున్నారు?" },
    "fc.q.meds": { en: "Are you taking your medicines as prescribed?", hi: "क्या आप अपनी दवाइयाँ बताए अनुसार ले रहे हैं?", te: "మీరు సూచించిన విధంగా మందులు తీసుకుంటున్నారా?" },
    "fc.q.fever": { en: "Do you have a fever today?", hi: "क्या आज आपको बुखार है?", te: "ఈ రోజు మీకు జ్వరం ఉందా?" },
    "fc.q.breathless": { en: "Breathlessness (0 none – 3 severe)", hi: "साँस फूलना (0 नहीं – 3 गंभीर)", te: "శ్వాస ఆడకపోవడం (0 లేదు – 3 తీవ్రం)" },
    "fc.q.spo2": { en: "Oxygen level if measured", hi: "ऑक्सीजन स्तर (यदि मापा हो)", te: "ఆక్సిజన్ స్థాయి (కొలిచినట్లయితే)" },
    "fc.q.newsym": { en: "Any new symptoms since discharge?", hi: "छुट्टी के बाद कोई नए लक्षण?", te: "డిశ్చార్జ్ తర్వాత ఏవైనా కొత్త లక్షణాలు?" },
    "fc.q.urgent": { en: "Fever, breathing difficulty, severe pain, or any urgent concern?", hi: "बुखार, साँस लेने में कठिनाई, तेज़ दर्द, या कोई अत्यावश्यक चिंता?", te: "జ్వరం, శ్వాస ఇబ్బంది, తీవ్రమైన నొప్పి, లేదా ఏదైనా అత్యవసర సమస్య?" },
    "fc.q.msgdoc": { en: "Anything you would like to tell your doctor?", hi: "क्या आप अपने डॉक्टर को कुछ बताना चाहते हैं?", te: "మీ వైద్యుడికి ఏదైనా చెప్పాలనుకుంటున్నారా?" },

    // ── ALL pathway question labels (en/hi/te reviewed) so a check-in is fully translated, never half-English ──
    "fc.q.abdopain": { en: "Abdominal pain (0 none – 3 severe)", hi: "पेट दर्द (0 नहीं – 3 गंभीर)", te: "కడుపు నొప్పి (0 లేదు – 3 తీవ్రం)" },
    "fc.q.anaphylaxis": { en: "Sudden rash, swelling, or trouble breathing (allergic reaction)?", hi: "अचानक चकत्ते, सूजन, या साँस लेने में तकलीफ़ (एलर्जी)?", te: "అకస్మాత్తుగా దద్దుర్లు, వాపు, లేదా శ్వాస ఇబ్బంది (అలర్జీ)?" },
    "fc.q.angina": { en: "Chest pain or tightness returning?", hi: "छाती में दर्द या जकड़न फिर से?", te: "ఛాతీ నొప్పి లేదా బిగుతు తిరిగి వస్తోందా?" },
    "fc.q.ascites": { en: "Increasing tummy swelling (0-3)", hi: "पेट की सूजन बढ़ रही है (0-3)", te: "కడుపు వాపు పెరుగుతోంది (0-3)" },
    "fc.q.bleeding": { en: "Severe bleeding?", hi: "तेज़ रक्तस्राव?", te: "తీవ్రమైన రక్తస్రావం?" },
    "fc.q.breathrest": { en: "Severe breathlessness at rest?", hi: "आराम करते समय भी तेज़ साँस फूलना?", te: "విశ్రాంతిలో కూడా తీవ్రమైన శ్వాస ఆడకపోవడం?" },
    "fc.q.chestpain": { en: "New chest pain?", hi: "नया छाती दर्द?", te: "కొత్తగా ఛాతీ నొప్పి?" },
    "fc.q.confusion": { en: "New confusion?", hi: "नया भ्रम/उलझन?", te: "కొత్తగా గందరగోళం?" },
    "fc.q.cough": { en: "Cough compared to yesterday (0 better – 3 worse)?", hi: "कल की तुलना में खांसी (0 बेहतर – 3 खराब)?", te: "నిన్నటితో పోలిస్తే దగ్గు (0 మెరుగు – 3 అధ్వాన్నం)?" },
    "fc.q.dabdo": { en: "Severe abdominal pain?", hi: "तेज़ पेट दर्द?", te: "తీవ్రమైన కడుపు నొప్పి?" },
    "fc.q.darkurine": { en: "Cola-coloured / very dark urine?", hi: "कोला रंग / बहुत गहरा पेशाब?", te: "కోలా రంగు / చాలా ముదురు మూత్రం?" },
    "fc.q.dbleed": { en: "Any bleeding (gums, nose, skin, stool)?", hi: "कोई रक्तस्राव (मसूड़े, नाक, त्वचा, मल)?", te: "ఏదైనా రక్తస్రావం (చిగుళ్ళు, ముక్కు, చర్మం, మలం)?" },
    "fc.q.dbp": { en: "Bottom BP number if measured", hi: "मापा हो तो निचला BP अंक", te: "కొలిచినట్లయితే కింది BP సంఖ్య" },
    "fc.q.deficit": { en: "New weakness, numbness, or facial droop?", hi: "नई कमज़ोरी, सुन्नपन, या चेहरा लटकना?", te: "కొత్తగా బలహీనత, తిమ్మిరి, లేదా ముఖం వాలడం?" },
    "fc.q.dizzy": { en: "Dizzy or light-headed when standing?", hi: "खड़े होने पर चक्कर या हल्कापन?", te: "నిలబడినప్పుడు తల తిరగడం లేదా తేలికగా అనిపించడం?" },
    "fc.q.dlethargy": { en: "Unusual drowsiness, restlessness, or lethargy?", hi: "असामान्य नींद, बेचैनी, या सुस्ती?", te: "అసాధారణ నిద్రమత్తు, అశాంతి, లేదా బద్ధకం?" },
    "fc.q.drowsy": { en: "Unusually drowsy or confused?", hi: "असामान्य रूप से नींद या भ्रम?", te: "అసాధారణంగా నిద్రమత్తు లేదా గందరగోళం?" },
    "fc.q.dvomit": { en: "Persistent vomiting?", hi: "लगातार उल्टी?", te: "నిరంతర వాంతులు?" },
    "fc.q.edema": { en: "Leg swelling (0 none – 3 severe)", hi: "पैरों में सूजन (0 नहीं – 3 गंभीर)", te: "కాళ్ల వాపు (0 లేదు – 3 తీవ్రం)" },
    "fc.q.enceph": { en: "Unusually drowsy, confused or sleeping too much?", hi: "असामान्य नींद, भ्रम या बहुत ज़्यादा सोना?", te: "అసాధారణ నిద్రమత్తు, గందరగోళం లేదా అతిగా నిద్రపోవడం?" },
    "fc.q.fallinj": { en: "A fall with head injury or unable to get up?", hi: "सिर की चोट के साथ गिरना या उठ न पाना?", te: "తలకు గాయంతో పడిపోవడం లేదా లేవలేకపోవడం?" },
    "fc.q.falls": { en: "Any other fall since last check?", hi: "पिछली जांच के बाद कोई और गिरना?", te: "చివరి తనిఖీ తర్వాత మరేదైనా పడిపోవడం?" },
    "fc.q.fast": { en: "New face droop, arm weakness, or speech difficulty?", hi: "नया चेहरा लटकना, बांह में कमज़ोरी, या बोलने में कठिनाई?", te: "కొత్తగా ముఖం వాలడం, చేయి బలహీనత, లేదా మాట్లాడటంలో ఇబ్బంది?" },
    "fc.q.feverdays": { en: "How many days of fever?", hi: "कितने दिनों से बुखार?", te: "ఎన్ని రోజులుగా జ్వరం?" },
    "fc.q.glucose": { en: "Latest glucose reading if available", hi: "उपलब्ध हो तो नवीनतम शुगर रीडिंग", te: "అందుబాటులో ఉంటే తాజా షుగర్ రీడింగ్" },
    "fc.q.headache": { en: "New severe or sudden headache?", hi: "नया तेज़ या अचानक सिरदर्द?", te: "కొత్తగా తీవ్రమైన లేదా ఆకస్మిక తలనొప్పి?" },
    "fc.q.hemat": { en: "Vomiting blood?", hi: "खून की उल्टी?", te: "రక్తం వాంతి?" },
    "fc.q.hemoptysis": { en: "Coughing blood?", hi: "खांसी में खून?", te: "దగ్గులో రక్తం?" },
    "fc.q.htncrisis": { en: "Severe headache, chest pain, or vision change?", hi: "तेज़ सिरदर्द, छाती दर्द, या दृष्टि में बदलाव?", te: "తీవ్రమైన తలనొప్పి, ఛాతీ నొప్పి, లేదా చూపులో మార్పు?" },
    "fc.q.hydration": { en: "Able to drink fluids?", hi: "तरल पदार्थ पी पा रहे हैं?", te: "ద్రవాలు తాగగలుగుతున్నారా?" },
    "fc.q.hyper": { en: "Very high sugar symptoms (thirst, urination, drowsy)?", hi: "बहुत ज़्यादा शुगर के लक्षण (प्यास, पेशाब, नींद)?", te: "చాలా ఎక్కువ షుగర్ లక్షణాలు (దాహం, మూత్రవిసర్జన, నిద్రమత్తు)?" },
    "fc.q.hypo": { en: "Any low-sugar symptoms (sweating, shakiness)?", hi: "कम शुगर के लक्षण (पसीना, कंपकंपी)?", te: "తక్కువ షుగర్ లక్షణాలు (చెమట, వణుకు)?" },
    "fc.q.hyposev": { en: "Any low-sugar episode with confusion or collapse?", hi: "भ्रम या बेहोशी के साथ कम शुगर का दौरा?", te: "గందరగోళం లేదా స్పృహ కోల్పోవడంతో తక్కువ షుగర్ ఘటన?" },
    "fc.q.inhaler": { en: "Inhalers used as prescribed?", hi: "इनहेलर बताए अनुसार लिए?", te: "ఇన్‌హేలర్లు సూచించిన విధంగా వాడారా?" },
    "fc.q.intake": { en: "Able to eat and drink?", hi: "खा-पी पा रहे हैं?", te: "తినగలుగుతున్నారా, తాగగలుగుతున్నారా?" },
    "fc.q.jaundice": { en: "Yellow eyes/skin worsening?", hi: "आँखें/त्वचा का पीलापन बढ़ रहा है?", te: "కళ్ళు/చర్మం పసుపు పెరుగుతోందా?" },
    "fc.q.melena": { en: "Black tarry stools?", hi: "काला चिपचिपा मल?", te: "నలుపు జిగట మలం?" },
    "fc.q.mobility": { en: "Able to move as expected?", hi: "अपेक्षा अनुसार चल-फिर पा रहे हैं?", te: "ఆశించినట్లు కదలగలుగుతున్నారా?" },
    "fc.q.mobility2": { en: "Mobility vs last week (0 better – 3 worse)", hi: "पिछले सप्ताह की तुलना में चलना-फिरना (0 बेहतर – 3 खराब)", te: "గత వారంతో పోలిస్తే కదలిక (0 మెరుగు – 3 అధ్వాన్నం)" },
    "fc.q.mood": { en: "Feeling low, hopeless, or not safe?", hi: "उदास, निराश, या असुरक्षित महसूस?", te: "నిరాశగా, నిస్సహాయంగా, లేదా సురక్షితంగా లేనట్లు అనిపిస్తోందా?" },
    "fc.q.nausea": { en: "Nausea/vomiting?", hi: "मतली/उल्टी?", te: "వికారం/వాంతులు?" },
    "fc.q.necrot": { en: "New blisters, black skin, or severe pain out of proportion?", hi: "नए छाले, काली त्वचा, या असामान्य रूप से तेज़ दर्द?", te: "కొత్త బొబ్బలు, నలుపు చర్మం, లేదా అసాధారణంగా తీవ్రమైన నొప్పి?" },
    "fc.q.night": { en: "Waking at night with breathing trouble?", hi: "रात में साँस की तकलीफ़ से नींद खुलती है?", te: "రాత్రి శ్వాస ఇబ్బందితో మెలకువ వస్తోందా?" },
    "fc.q.orthopnea": { en: "Pillows needed to breathe at night (0-3)", hi: "रात में साँस के लिए ज़रूरी तकिये (0-3)", te: "రాత్రి శ్వాస కోసం అవసరమైన దిండ్లు (0-3)" },
    "fc.q.pain": { en: "Pain (0-10)", hi: "दर्द (0-10)", te: "నొప్పి (0-10)" },
    "fc.q.painscale": { en: "Pain (0-3)", hi: "दर्द (0-3)", te: "నొప్పి (0-3)" },
    "fc.q.palp": { en: "Palpitations?", hi: "धड़कन तेज़ होना?", te: "గుండె దడ?" },
    "fc.q.pleuritic": { en: "Chest pain worse on breathing?", hi: "साँस लेने पर छाती दर्द बढ़ना?", te: "శ్వాస తీసుకున్నప్పుడు ఛాతీ నొప్పి పెరుగుతోందా?" },
    "fc.q.presyncope": { en: "Light-headed or nearly fainting?", hi: "हल्कापन या लगभग बेहोशी?", te: "తల తేలికగా లేదా దాదాపు స్పృహ తప్పడం?" },
    "fc.q.recseizure": { en: "Any further seizure/fit since discharge?", hi: "छुट्टी के बाद कोई और दौरा/मिर्गी?", te: "డిశ్చార్జ్ తర్వాత మరేదైనా మూర్ఛ/ఫిట్స్?" },
    "fc.q.reliever": { en: "Using the reliever inhaler more than usual?", hi: "राहत इनहेलर सामान्य से ज़्यादा इस्तेमाल?", te: "రిలీవర్ ఇన్‌హేలర్‌ను మామూలు కంటే ఎక్కువగా వాడుతున్నారా?" },
    "fc.q.sbp": { en: "Top BP number if measured", hi: "मापा हो तो ऊपरी BP अंक", te: "కొలిచినట్లయితే పై BP సంఖ్య" },
    "fc.q.seizure": { en: "Any seizure/fit?", hi: "कोई दौरा/मिर्गी?", te: "ఏదైనా మూర్ఛ/ఫిట్స్?" },
    "fc.q.selfharm": { en: "Any thoughts of harming yourself?", hi: "खुद को नुकसान पहुँचाने के विचार?", te: "మిమ్మల్ని మీరు హాని చేసుకోవాలనే ఆలోచనలు ఉన్నాయా?" },
    "fc.q.sideeffects": { en: "New medicine side effects?", hi: "दवा के नए दुष्प्रभाव?", te: "మందుల కొత్త దుష్ప్రభావాలు?" },
    "fc.q.speech": { en: "New speech difficulty?", hi: "बोलने में नई कठिनाई?", te: "కొత్తగా మాట్లాడటంలో ఇబ్బంది?" },
    "fc.q.spreading": { en: "Is the redness spreading / larger than before?", hi: "लाली फैल रही है / पहले से बड़ी?", te: "ఎరుపు వ్యాపిస్తోందా / ముందుకంటే పెద్దదైందా?" },
    "fc.q.sputum": { en: "Sputum colour", hi: "बलगम का रंग", te: "కఫం రంగు" },
    "fc.q.swelling": { en: "New swelling (legs/face)?", hi: "नई सूजन (पैर/चेहरा)?", te: "కొత్త వాపు (కాళ్లు/ముఖం)?" },
    "fc.q.swelling2": { en: "Body swelling (0 none – 3 severe)", hi: "शरीर में सूजन (0 नहीं – 3 गंभीर)", te: "శరీర వాపు (0 లేదు – 3 తీవ్రం)" },
    "fc.q.syncope": { en: "Fainting or collapse?", hi: "बेहोशी या गिर पड़ना?", te: "స్పృహ తప్పడం లేదా కుప్పకూలడం?" },
    "fc.q.urine": { en: "Urine output vs normal?", hi: "पेशाब की मात्रा सामान्य की तुलना में?", te: "మూత్ర విసర్జన సాధారణంతో పోలిస్తే?" },
    "fc.q.urineless": { en: "Passing much less urine?", hi: "बहुत कम पेशाब आना?", te: "చాలా తక్కువ మూత్రం వస్తోందా?" },
    "fc.q.weight": { en: "Weight CHANGE vs 3 days ago (kg, e.g. 2 for +2 kg)", hi: "3 दिन पहले की तुलना में वज़न में बदलाव (kg, जैसे +2 kg के लिए 2)", te: "3 రోజుల క్రితంతో పోలిస్తే బరువు మార్పు (kg, ఉదా. +2 kg కోసం 2)" },
    "fc.q.weightloss": { en: "Still losing weight / poor appetite?", hi: "अभी भी वज़न घट रहा है / भूख कम?", te: "ఇంకా బరువు తగ్గుతోందా / ఆకలి తక్కువగా ఉందా?" },
    "fc.q.wound": { en: "Wound: how does it look?", hi: "घाव: कैसा दिख रहा है?", te: "గాయం: ఎలా కనిపిస్తోంది?" },

    // Doctor Action Center — outbound notification nudges (SMS/WhatsApp/email). PHI-light: no clinical body,
    // just that a message is waiting + the opaque portal link. Emergency is worded urgently.
    "fc.msg.doctor_message": { en: "Your doctor has sent you a message on StewardMD. Please open it here: {link}", hi: "आपके डॉक्टर ने StewardMD पर आपको एक संदेश भेजा है। कृपया यहाँ खोलें: {link}", te: "మీ వైద్యుడు StewardMDలో మీకు ఒక సందేశం పంపారు. దయచేసి ఇక్కడ తెరవండి: {link}" },
    "fc.msg.doctor_question": { en: "Your doctor has a question for you on StewardMD. Please answer here: {link}", hi: "आपके डॉक्टर ने StewardMD पर आपसे एक सवाल पूछा है। कृपया यहाँ उत्तर दें: {link}", te: "మీ వైద్యుడు StewardMDలో మీకు ఒక ప్రశ్న అడిగారు. దయచేసి ఇక్కడ సమాధానం ఇవ్వండి: {link}" },
    "fc.msg.doctor_vitals": { en: "Your doctor has requested some measurements on StewardMD. Please submit them here: {link}", hi: "आपके डॉक्टर ने StewardMD पर कुछ माप मांगे हैं। कृपया यहाँ भेजें: {link}", te: "మీ వైద్యుడు StewardMDలో కొన్ని కొలతలను అడిగారు. దయచేసి ఇక్కడ సమర్పించండి: {link}" },
    "fc.msg.doctor_photo": { en: "Your doctor has requested a photo on StewardMD. Please upload it here: {link}", hi: "आपके डॉक्टर ने StewardMD पर एक फोटो मांगी है। कृपया यहाँ अपलोड करें: {link}", te: "మీ వైద్యుడు StewardMDలో ఒక ఫోటోను అడిగారు. దయచేసి ఇక్కడ అప్‌లోడ్ చేయండి: {link}" },
    "fc.msg.doctor_review": { en: "Your doctor would like to review you earlier. Please see the details here: {link}", hi: "आपके डॉक्टर आपको जल्दी दिखाना चाहते हैं। कृपया विवरण यहाँ देखें: {link}", te: "మీ వైద్యుడు మిమ్మల్ని త్వరగా చూడాలనుకుంటున్నారు. దయచేసి వివరాలు ఇక్కడ చూడండి: {link}" },
    "fc.msg.doctor_education": { en: "Your doctor has shared some helpful information on StewardMD: {link}", hi: "आपके डॉक्टर ने StewardMD पर कुछ उपयोगी जानकारी साझा की है: {link}", te: "మీ వైద్యుడు StewardMDలో కొంత ఉపయోగకరమైన సమాచారాన్ని పంచుకున్నారు: {link}" },
    "fc.msg.doctor_emergency": { en: "URGENT from your care team: please open this now and follow the advice: {link}", hi: "आपकी देखभाल टीम से अत्यावश्यक: कृपया इसे अभी खोलें और सलाह का पालन करें: {link}", te: "మీ సంరక్షణ బృందం నుండి అత్యవసరం: దయచేసి దీన్ని ఇప్పుడే తెరిచి సలహాను పాటించండి: {link}" },
    "fc.msg.doctor_closed": { en: "Your StewardMD recovery follow-up is complete. Thank you: {link}", hi: "आपका StewardMD रिकवरी फॉलो-अप पूरा हो गया है। धन्यवाद: {link}", te: "మీ StewardMD రికవరీ ఫాలో-అప్ పూర్తయింది. ధన్యవాదాలు: {link}" },

    // Doctor Action Center — patient portal inbox.
    "fc.inbox.title": { en: "Messages from your care team", hi: "आपकी देखभाल टीम के संदेश", te: "మీ సంరక్షణ బృందం సందేశాలు" },
    "fc.inbox.empty": { en: "No messages right now.", hi: "अभी कोई संदेश नहीं।", te: "ప్రస్తుతం సందేశాలు లేవు." },
    "fc.inbox.from": { en: "From", hi: "प्रेषक", te: "నుండి" },
    "fc.inbox.acknowledge": { en: "I have read this", hi: "मैंने इसे पढ़ लिया", te: "నేను దీన్ని చదివాను" },
    "fc.inbox.acknowledged": { en: "Acknowledged", hi: "स्वीकृत", te: "గుర్తించబడింది" },
    "fc.inbox.reply": { en: "Reply", hi: "उत्तर दें", te: "సమాధానం" },
    "fc.inbox.reply_ph": { en: "Type your reply...", hi: "अपना उत्तर लिखें...", te: "మీ సమాధానాన్ని టైప్ చేయండి..." },
    "fc.inbox.send": { en: "Send", hi: "भेजें", te: "పంపండి" },
    "fc.inbox.sent": { en: "Sent", hi: "भेजा गया", te: "పంపబడింది" },
    "fc.inbox.upload_photo": { en: "Upload photo", hi: "फोटो अपलोड करें", te: "ఫోటో అప్‌లోడ్ చేయండి" },
    "fc.inbox.uploaded": { en: "Photo sent", hi: "फोटो भेजी गई", te: "ఫోటో పంపబడింది" },
    "fc.inbox.submit_vitals": { en: "Submit measurements", hi: "माप भेजें", te: "కొలతలను సమర్పించండి" },
    "fc.inbox.accept_review": { en: "I will attend", hi: "मैं आऊंगा/आऊंगी", te: "నేను హాజరవుతాను" },
    "fc.inbox.emergency": { en: "Urgent advice from your doctor", hi: "आपके डॉक्टर की अत्यावश्यक सलाह", te: "మీ వైద్యుని అత్యవసర సలహా" },
    "fc.inbox.upload_err": { en: "Could not upload. Please try a JPG/PNG under 15 MB.", hi: "अपलोड नहीं हुआ। कृपया 15 MB से कम JPG/PNG आज़माएँ।", te: "అప్‌లోడ్ కాలేదు. దయచేసి 15 MB లోపు JPG/PNGని ప్రయత్నించండి." }
  };

  // Fill {placeholders} and tidy artifacts left by empty values (e.g. "Hi , this" → "Hi, this").
  function interpolate(s, vars) {
    var out = String(s == null ? "" : s);
    if (vars) { for (var k in vars) { if (Object.prototype.hasOwnProperty.call(vars, k)) out = out.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k] == null ? "" : vars[k])); } }
    out = out.replace(/\{[a-z0-9_]+\}/gi, "");            // drop any placeholder with no value
    return out.replace(/\s+([,.:;!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  }

  // Translate: reviewed string for lang → English → the key itself. Never throws, never empty-crashes.
  function t(key, lang, vars) {
    var row = STR[key];
    var s;
    if (row) s = (lang && row[lang] != null) ? row[lang] : row.en;
    if (s == null) s = key;
    return interpolate(s, vars);
  }
  function hasKey(key) { return Object.prototype.hasOwnProperty.call(STR, key); }
  function isSupported(lang) { return !!LANG_BY_CODE[lang]; }
  function isReviewed(lang) { var L = LANG_BY_CODE[lang]; return !!(L && L.reviewed); }
  function langName(lang) { var L = LANG_BY_CODE[lang]; return L ? L.name : lang; }
  function langNative(lang) { var L = LANG_BY_CODE[lang]; return L ? L.native : lang; }
  function languages() { return LANGS.map(function (l) { return { code: l.code, name: l.name, native: l.native, reviewed: l.reviewed }; }); }

  var API = {
    detectLanguage: detectLanguage, t: t, interpolate: interpolate, normalize: normalize,
    hasKey: hasKey, isSupported: isSupported, isReviewed: isReviewed,
    langName: langName, langNative: langNative, languages: languages,
    LANGS: LANGS, STR: STR, REGIONS: REGIONS, _version: 1
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareI18n = API;
})();
