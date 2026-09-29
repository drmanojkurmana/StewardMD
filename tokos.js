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
  SP.features.bank(host, { id: "mcq", index: "decks/mcq/index.json" });
  SP.features.tools(host);
  SP.features.drills(host);
  SP.features.explore(host); // after tools and drills: it lists explorer models on the same model sync
  SP.features.notes(host);
  // OSCE and viva: the O&G stations live in CliniX (clinix/systems/obgyn.json); this entry deep-links there. CliniX's
  // overlay sits above Tokós, so closing it returns here. CliniX applies its own Pro rule inside.
  var OSCE_LINE = { en: "Opens CliniX: history, examination and emergency stations", hi: "CliniX खुलता है: हिस्ट्री, जाँच और आपात स्टेशन" };
  host.registerSim({ id: "osce", icon: "stethoscope", level: "mbbs",
    title: { en: "OSCE and viva stations", hi: "OSCE और वाइवा स्टेशन" }, sub: { en: "In CliniX", hi: "CliniX में" },
    line: function () { return host._internal.tx(OSCE_LINE); },
    open: function () { var X = G.CLINIX; if (!X || !X.openDeep || !X.openDeep("tokos-osce")) host._internal.toast(D_OSCE_OFF[host._internal.lang()] || D_OSCE_OFF.en); } });
  // Clinics whose cases are built (tokos/decks/<id>.json) and whose screens come in the next update: listed as pending,
  // replaced when their plugin registers (host.registerClinic).
  host.registerClinic({ id: "fetal-planes", pending: true, icon: "image", deck: "decks/fetal-planes.json",
    title: { en: "Fetal ultrasound planes", hi: "भ्रूण अल्ट्रासाउंड प्लेन" }, sub: { en: "Name the standard plane, real scans", hi: "मानक प्लेन पहचानें, असली स्कैन" },
    source: { name: { en: "FETAL_PLANES_DB (Burgos-Artizzu et al. 2020), CC BY 4.0", hi: "FETAL_PLANES_DB (Burgos-Artizzu et al. 2020), CC BY 4.0" }, url: "https://zenodo.org/records/3904280" } });
  host.registerClinic({ id: "hc-biometry", pending: true, icon: "target", deck: "decks/hc-biometry.json",
    title: { en: "Fetal head circumference", hi: "भ्रूण के सिर की परिधि" }, sub: { en: "Fit the ellipse, read the gestational age", hi: "दीर्घवृत्त बैठाएँ, गर्भावधि पढ़ें" },
    source: { name: { en: "HC18 (van den Heuvel et al. 2018), CC BY 4.0", hi: "HC18 (van den Heuvel et al. 2018), CC BY 4.0" }, url: "https://zenodo.org/records/1322001" } });
})(typeof window !== "undefined" ? window : this);
