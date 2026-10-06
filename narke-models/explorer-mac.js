/* Narkē explorer model: inhalational agents and MAC. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.NARKE_MODELS["mac"].
   MAC at age 40 and the age equation are from Mapleson's meta-analysis (Br J Anaesth 1996):
     MAC(age) = MAC40 x 10^(-0.00269 x (age - 40)), about 6% less per decade.
   Blood:gas partition coefficients are from Morgan and Mikhail 7e (Table 8-3).
   MAC fractions of agents given together add (Eger): the total is the sum of end-tidal % / age-adjusted MAC.
   MAC is the end-tidal concentration at 1 atmosphere that stops movement to skin incision in 50% of patients. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.NARKE_MODELS = root.NARKE_MODELS || {}; root.NARKE_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var AGE_K = -0.00269;          // Mapleson 1996: log10 MAC falls 0.00269 per year
  var AGE_MIN = 1, AGE_MAX = 90; // Mapleson's fit used ages 1 year and over
  var AGENTS = {
    sevoflurane: { mac40: 1.80, bloodGas: 0.65, name: { en: "Sevoflurane", hi: "Sevoflurane" },
      line: { en: "Sweet smelling and not irritant: the usual choice for gas induction.", hi: "मीठी गंध, irritant नहीं: gas induction के लिए आम पसंद।" } },
    isoflurane: { mac40: 1.17, bloodGas: 1.4, name: { en: "Isoflurane", hi: "Isoflurane" },
      line: { en: "Pungent, so poor for induction. Cheap and widely used for maintenance.", hi: "तीखी गंध, induction के लिए ठीक नहीं। सस्ता, maintenance में बहुत प्रयोग।" } },
    desflurane: { mac40: 6.6, bloodGas: 0.42, name: { en: "Desflurane", hi: "Desflurane" },
      line: { en: "Lowest blood solubility: fastest wake up. Irritant to the airway; needs a heated vaporiser.", hi: "सबसे कम blood solubility: सबसे जल्दी होश। Airway को irritate करता है; heated vaporiser चाहिए।" } },
    halothane: { mac40: 0.75, bloodGas: 2.4, name: { en: "Halothane", hi: "Halothane" },
      line: { en: "Most soluble and most potent here. Slow onset and offset; sensitises the heart to adrenaline.", hi: "यहाँ सबसे soluble और सबसे potent। धीमा असर और धीमी वापसी; दिल को adrenaline के प्रति संवेदनशील करता है।" } },
    n2o: { mac40: 104, bloodGas: 0.47, name: { en: "Nitrous oxide", hi: "Nitrous oxide (N2O)" },
      line: { en: "MAC is above 100%, so it cannot give 1 MAC alone at sea level. Used to add MAC to a volatile.", hi: "MAC 100% से ज़्यादा है, इसलिए समुद्र तल पर अकेले 1 MAC नहीं दे सकता। Volatile के साथ MAC जोड़ने के लिए।" } }
  };
  var ORDER = ["sevoflurane", "isoflurane", "desflurane", "halothane", "n2o"];

  function r2(x) { return Math.round(x * 100) / 100; }
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function okAge(a) { return typeof a === "number" && a === a && a >= AGE_MIN && a <= AGE_MAX; }

  /* macForAge(agent, age): age-adjusted MAC in % atm (rounded to 2 places; exact in .exact). */
  function macForAge(agent, age) {
    var a = AGENTS[agent];
    if (!a) return bad("Unknown agent.", "अज्ञात agent।");
    if (!okAge(age)) return bad("Age is 1 to 90 years.", "उम्र 1 से 90 वर्ष होती है।");
    var v = a.mac40 * Math.pow(10, AGE_K * (age - 40));
    return { ok: true, agent: agent, age: age, mac: r2(v), exact: v };
  }

  /* combine(age, mix): mix = {agent: end-tidal %}. Returns each agent's MAC fraction and the total. */
  function combine(age, mix) {
    if (!okAge(age)) return bad("Age is 1 to 90 years.", "उम्र 1 से 90 वर्ष होती है।");
    var parts = [], total = 0, k, et, m;
    mix = mix || {};
    for (k in mix) {
      if (!Object.prototype.hasOwnProperty.call(mix, k)) continue;
      if (!AGENTS[k]) return bad("Unknown agent.", "अज्ञात agent।");
      et = mix[k];
      if (typeof et !== "number" || et !== et || et < 0 || et > 100) return bad("End-tidal % is 0 to 100.", "End-tidal % 0 से 100 होता है।");
      if (!et) continue;
      m = macForAge(k, age).exact;
      parts.push({ agent: k, et: et, mac: r2(m), fraction: r2(et / m) });
      total += et / m;
    }
    var vol = 0, n = 0, i;
    for (i = 0; i < parts.length; i++) if (parts[i].agent !== "n2o") vol++; else n++;
    var warn = [];
    if (vol > 1) warn.push({ en: "Two volatile agents at once is unusual outside a changeover.", hi: "एक साथ दो volatile agents आम नहीं हैं, सिवाय बदलाव के समय।" });
    if (n && mix.n2o + 21 > 100) warn.push({ en: "This N2O leaves less than 21% for oxygen.", hi: "इतना N2O oxygen के लिए 21% से कम जगह छोड़ता है।" });
    return { ok: true, age: age, parts: parts, total: r2(total), totalExact: total, band: band(total), warnings: warn };
  }

  // Teaching bands for the total MAC fraction. 1.0 MAC: half do not move; about 1.3 MAC: about 95% do not move.
  function band(t) {
    if (t < 0.5) return { id: "light", text: { en: "Below 0.5 MAC: too light to rely on alone for surgery; awareness is possible.", hi: "0.5 MAC से कम: surgery के लिए अकेले पर्याप्त नहीं; awareness हो सकती है।" } };
    if (t < 1.0) return { id: "sub", text: { en: "Below 1 MAC: more than half would move to incision without other drugs (opioid, N2O).", hi: "1 MAC से कम: दूसरी दवाओं (opioid, N2O) के बिना आधे से ज़्यादा incision पर हिलेंगे।" } };
    if (t < 1.3) return { id: "mac", text: { en: "1 MAC: half of patients do not move to incision.", hi: "1 MAC: आधे मरीज़ incision पर नहीं हिलते।" } };
    return { id: "ed95", text: { en: "About 1.3 MAC: about 95% do not move to incision.", hi: "लगभग 1.3 MAC: लगभग 95% incision पर नहीं हिलते।" } };
  }

  /* compare(): agents ordered by blood:gas coefficient, lowest (fastest) first. */
  function compare() {
    return ORDER.slice().sort(function (a, b) { return AGENTS[a].bloodGas - AGENTS[b].bloodGas; }).map(function (k) {
      return { agent: k, bloodGas: AGENTS[k].bloodGas, mac40: AGENTS[k].mac40 };
    });
  }

  return {
    id: "mac", kind: "explorer", group: "pharmacology", level: "mbbs",
    title: { en: "Inhalational agents and MAC", hi: "Inhalational agents और MAC" },
    subtitle: { en: "Compare potency and speed, adjust MAC for age and add agents together", hi: "Potency और गति की तुलना करें, उम्र के अनुसार MAC बदलें और agents जोड़ें" },
    sources: [
      { label: "Mapleson WW. Effect of age on MAC in humans: a meta-analysis. Br J Anaesth 1996;76(2):179-185 (MAC at age 40; MAC falls by a factor of 10^(-0.00269 x (age - 40)))", url: "https://pubmed.ncbi.nlm.nih.gov/8777094/" },
      { label: "Butterworth JF, Mackey DC, Wasnick JD. Morgan and Mikhail's Clinical Anesthesiology, 7th edition, chapter 8, Table 8-3 (blood:gas partition coefficients)" },
      { label: "Eger EI 2nd. Age, minimum alveolar anesthetic concentration, and minimum alveolar anesthetic concentration-awake. Anesth Analg 2001;93(4):947-953 (MAC fractions of agents add)", url: "https://pubmed.ncbi.nlm.nih.gov/11574362/" },
      { label: "Miller's Anesthesia, 9th edition, chapter on inhaled anesthetics: uptake and distribution (low blood:gas solubility gives faster induction and recovery)" }
    ],
    review: "ai_drafted",
    notes: {
      definition: { en: "MAC is the end-tidal concentration at 1 atmosphere that stops movement to skin incision in half of patients.", hi: "MAC वह end-tidal concentration है (1 atmosphere पर) जिस पर आधे मरीज़ skin incision पर नहीं हिलते।" },
      values: { en: "MAC values are Mapleson's for age 40. Textbook tables for ages 30 to 55 differ a little (sevoflurane 2.0, desflurane 6.0).", hi: "MAC मान Mapleson के 40 वर्ष की उम्र के हैं। 30 से 55 वर्ष की textbook तालिकाएँ थोड़ी अलग हैं (sevoflurane 2.0, desflurane 6.0)।" },
      solubility: { en: "A low blood:gas coefficient means the alveolar level rises fast, so induction and wake up are fast. It is not potency.", hi: "कम blood:gas coefficient का मतलब alveolar स्तर जल्दी बढ़ता है, इसलिए induction और होश जल्दी। यह potency नहीं है।" },
      other: { en: "Other things lower MAC too: opioids, pregnancy, hypothermia and acute alcohol. The model only adjusts for age.", hi: "दूसरी चीज़ें भी MAC घटाती हैं: opioids, गर्भावस्था, hypothermia और तुरंत लिया alcohol। यह model केवल उम्र के लिए बदलता है।" }
    },
    agents: AGENTS, order: ORDER,
    constants: { ageK: AGE_K, ageMin: AGE_MIN, ageMax: AGE_MAX },
    macForAge: macForAge, combine: combine, band: band, compare: compare
  };
});
