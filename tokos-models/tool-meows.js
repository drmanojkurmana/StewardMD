/* Tokos calculator model: MEOWS track-and-trigger chart (CEMACH MEOWS, white/yellow/red zones). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function n(id, en, hi, unit, min, max, step) { return { id: id, label: { en: en, hi: hi }, type: "number", unit: unit, min: min, max: max, step: step, required: true }; }
  function o(v, en, hi) { return { value: v, label: { en: en, hi: hi } }; }
  // zone: 0 white, 1 yellow, 2 red
  var Z = {
    rr: function (x) { return x < 10 || x > 30 ? 2 : x > 20 ? 1 : 0; },
    spo2: function (x) { return x < 95 ? 2 : 0; },
    temp: function (x) { return x < 35 || x > 38 ? 2 : x < 36 ? 1 : 0; },
    hr: function (x) { return x < 40 || x > 120 ? 2 : x < 50 || x > 100 ? 1 : 0; },
    sbp: function (x) { return x < 90 || x > 160 ? 2 : x < 100 || x > 140 ? 1 : 0; },
    dbp: function (x) { return x > 100 ? 2 : x >= 90 ? 1 : 0; }
  };
  var NAME = { rr: ["Respiratory rate", "श्वसन दर"], spo2: ["Oxygen saturation", "ऑक्सीजन संतृप्ति"], temp: ["Temperature", "तापमान"], hr: ["Heart rate", "हृदय गति"], sbp: ["Systolic BP", "सिस्टोलिक बीपी"], dbp: ["Diastolic BP", "डायस्टोलिक बीपी"], prot: ["Proteinuria", "मूत्र में प्रोटीन"], neuro: ["Neural response", "तंत्रिका प्रतिक्रिया"] };
  var M = {
    id: "meows", kind: "tool", group: "obstetrics", level: "resident", review: "ai_drafted",
    title: { en: "MEOWS (Modified Early Obstetric Warning) trigger", hi: "मीओज़ (संशोधित प्रारंभिक प्रसूति चेतावनी) ट्रिगर" },
    sources: [
      { label: "Chart variant: CEMACH MEOWS white/yellow/red chart, as tabulated with the trigger rule (one red or two yellow) in an Indian tertiary-centre study, PMC10040990", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10040990/" },
      { label: "Same red/yellow bands (with a different systolic yellow upper limit of 150) in the Turkish MEOWS validation, PMC11622726", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11622726/" }
    ],
    inputs: [
      n("rr", "Respiratory rate", "श्वसन दर", "/min", 4, 60, 1), n("spo2", "Oxygen saturation", "ऑक्सीजन संतृप्ति", "%", 50, 100, 1),
      n("temp", "Temperature", "तापमान", "C", 30, 43, 0.1), n("hr", "Heart rate", "हृदय गति", "/min", 20, 220, 1),
      n("sbp", "Systolic BP", "सिस्टोलिक बीपी", "mmHg", 40, 260, 1), n("dbp", "Diastolic BP", "डायस्टोलिक बीपी", "mmHg", 20, 160, 1),
      { id: "prot", label: { en: "Proteinuria (dipstick)", hi: "मूत्र में प्रोटीन (डिपस्टिक)" }, type: "select", required: true, options: [o("0", "Nil to trace", "शून्य से ट्रेस"), o("1", "1+ to 2+", "1+ से 2+"), o("2", "More than 2+", "2+ से अधिक")] },
      { id: "neuro", label: { en: "Neural response", hi: "तंत्रिका प्रतिक्रिया" }, type: "select", required: true, options: [o("0", "Alert", "सचेत"), o("1", "Responds to voice", "आवाज़ पर प्रतिक्रिया"), o("2", "Unresponsive or responds to pain only", "अप्रतिक्रियाशील या केवल दर्द पर प्रतिक्रिया")] }
    ],
    compute: function (v) {
      v = v || {}; var k, z = {}, x, reds = [], yel = [], inp = M.inputs, i;
      for (i = 0; i < 6; i++) {
        k = inp[i].id; x = num(v[k]);
        if (x === null || x < inp[i].min || x > inp[i].max) return bad("Enter " + NAME[k][0] + " between " + inp[i].min + " and " + inp[i].max + " " + inp[i].unit + ".", NAME[k][1] + " " + inp[i].min + " से " + inp[i].max + " " + inp[i].unit + " के बीच दें।");
        z[k] = Z[k](x);
      }
      for (k in { prot: 1, neuro: 1 }) { x = typeof v[k] === "string" ? +v[k] : v[k]; if (x !== 0 && x !== 1 && x !== 2) return bad("Choose " + NAME[k][0] + ".", NAME[k][1] + " चुनें।"); z[k] = x; }
      for (k in z) { if (z[k] === 2) reds.push(NAME[k]); else if (z[k] === 1) yel.push(NAME[k]); }
      var trig = reds.length >= 1 || yel.length >= 2, band = reds.length ? "danger" : trig ? "danger" : yel.length ? "caution" : "normal";
      function names(a, j) { return a.map(function (t) { return t[j]; }).join(", "); }
      var lines = [];
      if (reds.length) lines.push({ en: "Red: " + names(reds, 0) + ".", hi: "लाल: " + names(reds, 1) + "।" });
      if (yel.length) lines.push({ en: "Yellow: " + names(yel, 0) + ".", hi: "पीला: " + names(yel, 1) + "।" });
      lines.push(trig ? { en: "Trigger: request urgent medical review and escalate per local protocol.", hi: "ट्रिगर: तुरंत चिकित्सकीय समीक्षा माँगें और स्थानीय प्रोटोकॉल के अनुसार आगे बढ़ाएँ।" } : { en: "No trigger: continue routine observations.", hi: "कोई ट्रिगर नहीं: नियमित निगरानी जारी रखें।" });
      return { ok: true, value: reds.length + yel.length, unit: "abnormal parameters", band: band, label: trig ? { en: "MEOWS trigger", hi: "मीओज़ ट्रिगर" } : { en: "No MEOWS trigger", hi: "मीओज़ ट्रिगर नहीं" }, lines: lines,
        rule: { en: "Trigger = any one red parameter or any two yellow parameters. Red: RR under 10 or over 30; SpO2 under 95; temperature under 35 or over 38; HR under 40 or over 120; SBP under 90 or over 160; DBP over 100; proteinuria over 2+; unresponsive or pain only. Yellow: RR 21 to 30; temperature 35 to under 36; HR 40 to under 50 or over 100 to 120; SBP 90 to under 100 or over 140 to 160; DBP 90 to 100; proteinuria 1+ to 2+; responds to voice. Liquor colour, lochia and general condition rows of the chart are not included.",
          hi: "ट्रिगर = कोई एक लाल या कोई दो पीले मापदंड। लाल: श्वसन दर 10 से कम या 30 से अधिक; एसपीओ2 95 से कम; तापमान 35 से कम या 38 से अधिक; हृदय गति 40 से कम या 120 से अधिक; सिस्टोलिक 90 से कम या 160 से अधिक; डायस्टोलिक 100 से अधिक; प्रोटीन 2+ से अधिक; अप्रतिक्रियाशील या केवल दर्द पर। पीला: श्वसन दर 21 से 30; तापमान 35 से 36 से कम; हृदय गति 40 से 50 से कम या 100 से अधिक से 120; सिस्टोलिक 90 से 100 से कम या 140 से अधिक से 160; डायस्टोलिक 90 से 100; प्रोटीन 1+ से 2+; आवाज़ पर प्रतिक्रिया। चार्ट की द्रव-रंग, लोकिया और सामान्य स्थिति की पंक्तियाँ शामिल नहीं।" } };
    },
    examples: [
      { values: { rr: 16, spo2: 98, temp: 36.8, hr: 80, sbp: 118, dbp: 76, prot: "0", neuro: "0" }, expect: { value: 0, band: "normal" } },
      { values: { rr: 24, spo2: 98, temp: 36.8, hr: 80, sbp: 118, dbp: 76, prot: "0", neuro: "0" }, expect: { value: 1, band: "caution" } },
      { values: { rr: 24, spo2: 98, temp: 36.8, hr: 110, sbp: 118, dbp: 76, prot: "0", neuro: "0" }, expect: { value: 2, band: "danger" } },
      { values: { rr: 16, spo2: 93, temp: 36.8, hr: 80, sbp: 118, dbp: 76, prot: "0", neuro: "0" }, expect: { value: 1, band: "danger" } },
      { values: { rr: 16, spo2: 98, temp: 36.8, hr: 80, sbp: 165, dbp: 105, prot: "1", neuro: "0" }, expect: { value: 3, band: "danger" } }
    ]
  };
  return M;
});
