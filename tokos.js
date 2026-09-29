/* Tokós: the Obstetrics and Gynaecology learning module, a StewardMD specialty host on the specialty engine
   (specialty-*.js). This file is the host config and the features it switches on; content lives in tokos/ (tracks.json,
   decks/, learn/, drill/, notes.json when present) and models in tokos-models/ (window.TOKOS_MODELS, listed in
   tokos/models.json). The CTG clinic is a clinic plugin (tokos-ctg.js); calipers are tokos-calipers.js.
   Loaded on first open by tokos-loader.js, which is the only Tokós file the app loads at boot.
   Kill switch (same as the home tile): localStorage smd_tokos = "0" or ?tokos=0 for the current load.
   Content is ai_drafted: every screen carries the "To be verified, draft" footer until clinical review. */
(function (G) {
  "use strict";
  var SP = G.SPECIALTY;
  var D_OSCE_OFF = { en: "CliniX is not available on this device.", hi: "इस डिवाइस पर CliniX उपलब्ध नहीं है।" };
  if (!SP || !SP.createHost) return;
  var host = SP.createHost({
    id: "tokos", global: "TOKOS", base: G.SMD_TOKOS_BASE || "/tokos/", rootId: "smdTokos", rootClass: "tok-root",
    storeKey: "smd_tokos_v1", prefKey: "smd_tokos_prefs", flag: "smd_tokos",
    title: { en: "Tokós", hi: "टोकोस" }, subtitle: { en: "Obstetrics and Gynaecology", hi: "प्रसूति एवं स्त्री रोग" },
    levels: { free: ["mbbs"] }, proFeature: "tokos", models: "TOKOS_MODELS", caseClinic: "ctg",
    statusBg: "#fbf9f4", draft: true,
    strings: {
      learn: {
        learnLine: { en: "Short lessons on pregnancy, labour and women's health, with pictures. Start here if you are new.", hi: "गर्भावस्था, प्रसव और महिला स्वास्थ्य पर तस्वीरों के साथ छोटे पाठ। नए हैं तो यहीं से शुरू करें।" },
        testLine: { en: "CTG clinic, questions, emergency drills and calculators to practise on.", hi: "अभ्यास के लिए CTG क्लिनिक, प्रश्न, आपात ड्रिल और कैलकुलेटर।" }
      }
    }
  });
  SP.features.learn(host);
  SP.features.bank(host, { id: "mcq", index: "decks/mcq/index.json", search: "decks/mcq/search.json" });
  SP.features.explore(host);
  SP.features.tools(host);
  SP.features.drills(host);
  SP.features.notes(host);
  // OSCE and viva: the O&G stations live in CliniX (clinix/systems/obgyn.json); this entry deep-links there. CliniX's
  // overlay sits above Tokós, so closing it returns here. CliniX applies its own Pro rule inside.
  var OSCE_LINE = { en: "Opens CliniX: history, examination and emergency stations", hi: "CliniX खुलता है: हिस्ट्री, जाँच और आपात स्टेशन" };
  host.registerSim({ id: "osce", icon: "stethoscope", level: "mbbs",
    title: { en: "OSCE and viva stations", hi: "OSCE और वाइवा स्टेशन" }, sub: { en: "In CliniX", hi: "CliniX में" },
    line: function () { return host._internal.tx(OSCE_LINE); },
    open: function () { var X = G.CLINIX; if (!X || !X.openDeep || !X.openDeep("tokos-osce")) host._internal.toast(D_OSCE_OFF[host._internal.lang()] || D_OSCE_OFF.en); } });
})(typeof window !== "undefined" ? window : this);
