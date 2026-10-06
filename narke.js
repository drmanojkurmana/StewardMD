/* Narkē: the Anaesthesia learning module, a StewardMD specialty host on the specialty engine (specialty-*.js).
   This file is the host config and the features it switches on; content lives in narke/ (tracks.json, decks/,
   learn/, drill/) and models in narke-models/ (window.NARKE_MODELS, listed in narke/models.json).
   Loaded on first open by narke-loader.js, which is the only Narkē file the app loads at boot.
   Kill switch (same as the home tile): localStorage smd_narke = "0" or ?narke=0 for the current load.
   Content is ai_drafted: every screen carries the "To be verified, draft" footer until clinical review. */
(function (G) {
  "use strict";
  var SP = G.SPECIALTY;
  var D_OSCE_OFF = { en: "CliniX is not available on this device.", hi: "इस डिवाइस पर CliniX उपलब्ध नहीं है।" };
  if (!SP || !SP.createHost) return;
  var host = SP.createHost({
    id: "narke", global: "NARKE", base: G.SMD_NARKE_BASE || "/narke/", rootId: "smdNarke", rootClass: "nrk-root",
    storeKey: "smd_narke_v1", prefKey: "smd_narke_prefs", flag: "smd_narke",
    title: { en: "Narkē", hi: "नार्के" }, subtitle: { en: "Anaesthesia", hi: "एनेस्थीसिया" },
    levels: { free: ["mbbs"] }, proFeature: "narke", models: "NARKE_MODELS",
    statusBg: "#faf8f3", draft: true,
    strings: {
      learn: {
        learnLine: { en: "Short lessons on anaesthesia, the airway, pain and resuscitation, with pictures. Start here if you are new.", hi: "एनेस्थीसिया, वायुमार्ग, दर्द और पुनर्जीवन पर तस्वीरों के साथ छोटे पाठ। नए हैं तो यहीं से शुरू करें।" },
        testLine: { en: "Questions, crisis drills, monitor clinics and calculators to practise on.", hi: "अभ्यास के लिए प्रश्न, आपात ड्रिल, मॉनिटर क्लिनिक और कैलकुलेटर।" }
      }
    }
  });
  SP.features.learn(host);
  SP.features.bank(host, { id: "mcq", index: "decks/mcq/index.json", search: "decks/mcq/search.json" });
  SP.features.explore(host);
  SP.features.tools(host);
  SP.features.drills(host);
  SP.features.notes(host);
  // OSCE and viva: the anaesthesia stations live in CliniX (clinix/systems/anaesthesia.json); this entry deep-links
  // there. CliniX's overlay sits above Narkē, so closing it returns here. CliniX applies its own Pro rule inside.
  var OSCE_LINE = { en: "Opens CliniX: preoperative, airway, consent, spinal and BLS stations", hi: "CliniX खुलता है: प्री-ऑपरेटिव, एयरवे, सहमति, स्पाइनल और BLS स्टेशन" };
  host.registerSim({ id: "osce", icon: "stethoscope", level: "mbbs",
    title: { en: "OSCE and viva stations", hi: "OSCE और वाइवा स्टेशन" }, sub: { en: "In CliniX", hi: "CliniX में" },
    line: function () { return host._internal.tx(OSCE_LINE); },
    open: function () { var X = G.CLINIX; if (!X || !X.openDeep || !X.openDeep("narke-osce")) host._internal.toast(D_OSCE_OFF[host._internal.lang()] || D_OSCE_OFF.en); } });
})(typeof window !== "undefined" ? window : this);
