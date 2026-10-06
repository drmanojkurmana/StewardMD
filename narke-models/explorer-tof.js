/* Narkē explorer model: train-of-four and neuromuscular block depth. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.NARKE_MODELS["tof"].
   Depth names follow the ASA 2023 practice guideline (Thilen et al): intense (PTC 0), deep (PTC 1 or more, TOF count 0),
   moderate (TOF count 1 to 3), shallow (TOF count 4, ratio below 0.4), minimal (ratio 0.4 to below 0.9),
   recovered (ratio 0.9 or more). Advice by depth follows the same guideline: sugammadex over neostigmine for deep,
   moderate and shallow block from rocuronium or vecuronium; neostigmine is a reasonable alternative at minimal depth;
   confirm a ratio of 0.9 or more with a quantitative monitor before extubation.
   Sugammadex doses are from the app's reviewed protocol kb/clinical-protocols/rapid-sequence-intubation.json
   (2 mg/kg once T2 has reappeared, 4 mg/kg for deep block, 16 mg/kg for immediate reversal of rocuronium 1.2 mg/kg).
   The neostigmine dose (40 to 50 mcg/kg, at most 5 mg, with glycopyrrolate) is from Miller's Anesthesia. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.NARKE_MODELS = root.NARKE_MODELS || {}; root.NARKE_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var RESIDUAL = 0.9;        // TOF ratio below this is residual block (ASA 2023)
  var QUAL_LIMIT = 0.4;      // fade cannot be felt or seen above about this ratio (ASA 2023, Miller)
  var NEO = { mcgPerKgLow: 40, mcgPerKgHigh: 50, maxMg: 5 };
  var SUG = { shallow: 2, deep: 4, immediate: 16 };
  var DEPTHS = ["intense", "deep", "moderate", "shallow", "minimal", "recovered"];

  var T = function (en, hi) { return { en: en, hi: hi }; };
  var NAMES = {
    intense: T("Intense block", "Intense block"), deep: T("Deep block", "Deep block"), moderate: T("Moderate block", "Moderate block"),
    shallow: T("Shallow block", "Shallow block"), minimal: T("Minimal block", "Minimal block"), recovered: T("Recovered", "Recovery पूरी")
  };
  var READS = {
    intense: T("No twitch to train-of-four and no twitch after tetanus (PTC 0).", "Train-of-four पर कोई twitch नहीं और tetanus के बाद भी नहीं (PTC 0)।"),
    deep: T("No twitch to train-of-four, but twitches after tetanus (PTC 1 or more).", "Train-of-four पर twitch नहीं, पर tetanus के बाद twitches (PTC 1 या ज़्यादा)।"),
    moderate: T("One to three of the four twitches.", "चार में से एक से तीन twitches।"),
    shallow: T("All four twitches, with a ratio below 0.4.", "चारों twitches, ratio 0.4 से कम।"),
    minimal: T("All four twitches, ratio 0.4 to below 0.9. Fade may not be felt or seen.", "चारों twitches, ratio 0.4 से 0.9 से कम। Fade महसूस या दिख नहीं सकता।"),
    recovered: T("Ratio 0.9 or more: adequate recovery for extubation.", "Ratio 0.9 या ज़्यादा: extubation के लिए पर्याप्त recovery।")
  };

  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function int(x, a, b) { return typeof x === "number" && x === Math.floor(x) && x >= a && x <= b; }

  /* depth({count, ratio, ptc}): count 0..4; ratio 0..1 when count is 4; ptc 0..20 when count is 0. */
  function depth(r) {
    r = r || {};
    if (!int(r.count, 0, 4)) return bad("TOF count is a whole number from 0 to 4.", "TOF count 0 से 4 तक पूरी संख्या है।");
    var id;
    if (r.count === 0) {
      if (!int(r.ptc, 0, 20)) return bad("With TOF count 0, give the post-tetanic count (0 to 20).", "TOF count 0 पर post-tetanic count (0 से 20) दें।");
      id = r.ptc === 0 ? "intense" : "deep";
    } else if (r.count < 4) id = "moderate";
    else {
      if (typeof r.ratio !== "number" || r.ratio !== r.ratio || r.ratio < 0 || r.ratio > 1.2) return bad("With all four twitches, give the TOF ratio (0 to 1.2).", "चारों twitches पर TOF ratio (0 से 1.2) दें।");
      id = r.ratio < QUAL_LIMIT ? "shallow" : r.ratio < RESIDUAL ? "minimal" : "recovered";
    }
    return { ok: true, depth: id, name: NAMES[id], reads: READS[id], residual: id !== "recovered", qualitativeBlind: id === "minimal", rank: DEPTHS.indexOf(id) };
  }

  /* reverse(depthId, drug, kg): drug "aminosteroid" (rocuronium, vecuronium) or "benzyl" (atracurium, cisatracurium). */
  function reverse(id, drug, kg) {
    if (DEPTHS.indexOf(id) < 0) return bad("Unknown depth.", "अज्ञात depth।");
    if (drug !== "aminosteroid" && drug !== "benzyl") return bad("Pick the blocker family.", "Blocker का परिवार चुनें।");
    var w = typeof kg === "number" && kg > 0 && kg <= 250 ? kg : null;
    function sug(mgkg) { return { drug: "sugammadex", mgPerKg: mgkg, doseMg: w ? Math.round(mgkg * w) : null }; }
    function neo() {
      return { drug: "neostigmine", mcgPerKg: [NEO.mcgPerKgLow, NEO.mcgPerKgHigh], maxMg: NEO.maxMg,
        doseMg: w ? [r1(Math.min(NEO.maxMg, NEO.mcgPerKgLow * w / 1000)), r1(Math.min(NEO.maxMg, NEO.mcgPerKgHigh * w / 1000))] : null,
        with: T("Give with glycopyrrolate (or atropine) to block the muscarinic effects.", "Muscarinic असर रोकने के लिए glycopyrrolate (या atropine) साथ दें।") };
    }
    if (id === "recovered") return { ok: true, action: "extubate", plan: null, text: T("No reversal needed for the block. Extubate when the other criteria are met.", "Block के लिए reversal की ज़रूरत नहीं। बाकी मानदंड पूरे होने पर extubate करें।") };
    if (drug === "aminosteroid") {
      if (id === "intense") return { ok: true, action: "wait-or-immediate", plan: sug(SUG.immediate),
        text: T("Wait for PTC to return. Sugammadex 16 mg/kg is only for immediate reversal soon after rocuronium 1.2 mg/kg.", "PTC लौटने तक रुकें। Sugammadex 16 mg/kg केवल rocuronium 1.2 mg/kg के तुरंत बाद immediate reversal के लिए है।") };
      if (id === "deep") return { ok: true, action: "sugammadex", plan: sug(SUG.deep), text: T("Sugammadex 4 mg/kg. Neostigmine does not work at this depth.", "Sugammadex 4 mg/kg। इस depth पर neostigmine काम नहीं करता।") };
      if (id === "moderate" || id === "shallow") return { ok: true, action: "sugammadex", plan: sug(SUG.shallow), text: T("Sugammadex 2 mg/kg once T2 has reappeared. Prefer it to neostigmine at this depth.", "T2 लौटने पर sugammadex 2 mg/kg। इस depth पर इसे neostigmine से बेहतर मानें।") };
      return { ok: true, action: "either", plan: sug(SUG.shallow), alt: neo(), text: T("Sugammadex 2 mg/kg, or neostigmine as a reasonable alternative at this minimal depth.", "Sugammadex 2 mg/kg, या इस minimal depth पर neostigmine एक उचित विकल्प।") };
    }
    // benzylisoquinoliniums: sugammadex does not bind them
    if (id === "minimal") return { ok: true, action: "neostigmine", plan: neo(), text: T("Neostigmine. Sugammadex does not reverse atracurium or cisatracurium.", "Neostigmine। Sugammadex atracurium या cisatracurium को reverse नहीं करता।") };
    return { ok: true, action: "wait", plan: null, text: T("Wait and keep monitoring. Neostigmine has a ceiling effect and may not reach a ratio of 0.9 from here. Sugammadex does not work on this family.", "रुकें और monitoring जारी रखें। Neostigmine का ceiling effect है और यहाँ से ratio 0.9 तक नहीं पहुँचा सकता। Sugammadex इस परिवार पर काम नहीं करता।") };
  }

  /* twitches({count, ratio}): relative heights of the four twitches (T1 = 1) for drawing. */
  function twitches(r) {
    var c = r && r.count, q = r && typeof r.ratio === "number" ? Math.min(1, r.ratio) : 1, out = [], i;
    if (!int(c, 0, 4)) return out;
    if (c === 4) { for (i = 0; i < 4; i++) out.push(Math.round((1 - (1 - q) * i / 3) * 1000) / 1000); return out; }
    // fewer than four: the remaining twitches fade steeply; heights are illustrative
    for (i = 0; i < 4; i++) out.push(i < c ? Math.round((0.5 - 0.15 * i) * 1000) / 1000 : 0);
    return out;
  }

  return {
    id: "tof", kind: "explorer", group: "pharmacology", level: "mbbs",
    title: { en: "Train-of-four and reversal", hi: "Train-of-four और reversal" },
    subtitle: { en: "Read the twitches, name the depth of block and choose the reversal", hi: "Twitches पढ़ें, block की depth पहचानें और reversal चुनें" },
    sources: [
      { label: "Thilen SR et al. 2023 ASA Practice Guidelines for Monitoring and Antagonism of Neuromuscular Blockade. Anesthesiology 2023;138(1):13-41 (depths, sugammadex over neostigmine, quantitative monitoring, ratio 0.9)", url: "https://pubmed.ncbi.nlm.nih.gov/36520073/" },
      { label: "StewardMD reviewed protocol: rapid sequence intubation (kb/clinical-protocols/rapid-sequence-intubation.json): sugammadex 2, 4 and 16 mg/kg" },
      { label: "Miller's Anesthesia, 9th edition, chapter on reversal of neuromuscular blockade (neostigmine 40 to 50 mcg/kg, maximum 5 mg; ceiling effect; fade not detectable by touch above a ratio of about 0.4)" },
      { label: "Naguib M et al. Consensus statement on perioperative use of neuromuscular monitoring. Anesth Analg 2018;127(1):71-80", url: "https://pubmed.ncbi.nlm.nih.gov/29200077/" }
    ],
    review: "ai_drafted",
    notes: {
      residual: { en: "A TOF ratio below 0.9 is residual block. It raises the risk of aspiration, airway obstruction and low oxygen after surgery.", hi: "TOF ratio 0.9 से कम residual block है। इससे surgery के बाद aspiration, airway रुकावट और कम oxygen का ख़तरा बढ़ता है।" },
      feel: { en: "Fade above a ratio of about 0.4 cannot be reliably felt or seen. Use a quantitative monitor to confirm 0.9.", hi: "लगभग 0.4 ratio से ऊपर fade भरोसे से महसूस या देखा नहीं जा सकता। 0.9 की पुष्टि के लिए quantitative monitor लें।" },
      ptc: { en: "Post-tetanic count: a 50 Hz tetanus for 5 seconds, then single twitches; count the responses.", hi: "Post-tetanic count: 5 seconds का 50 Hz tetanus, फिर single twitches; responses गिनें।" },
      weight: { en: "Doses are per kg. Check the weight to use (actual or adjusted) in the drug's label and your local protocol.", hi: "Doses प्रति kg हैं। कौन सा वज़न (actual या adjusted) लेना है, दवा के label और local protocol में देखें।" }
    },
    depths: DEPTHS, names: NAMES,
    constants: { residual: RESIDUAL, qualitativeLimit: QUAL_LIMIT, neostigmine: NEO, sugammadex: SUG },
    depth: depth, reverse: reverse, twitches: twitches
  };
});
