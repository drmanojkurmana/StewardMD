/* Tokos calculator model: Bishop score (Bishop 1964) with optional modifiers. Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function flag(v) { return v === true || v === "true" || v === 1 || v === "1"; }
  function opt(value, en, hi) { return { value: value, label: { en: en, hi: hi } }; }
  // Bishop 1964 table: dilation 0 / 1-2 / 3-4 / 5+; effacement 0-30 / 40-50 / 60-70 / 80+;
  // station -3 / -2 / -1,0 / +1,+2; consistency firm / medium / soft; position posterior / mid / anterior.
  function dil(c) { return c < 1 ? 0 : c <= 2 ? 1 : c <= 4 ? 2 : 3; }
  function eff(p) { return p <= 30 ? 0 : p <= 50 ? 1 : p <= 70 ? 2 : 3; }
  function stn(s) { return s <= -3 ? 0 : s === -2 ? 1 : s <= 0 ? 2 : 3; }
  return {
    id: "bishop", kind: "tool", group: "obstetrics", level: "mbbs", review: "ai_drafted",
    title: { en: "Bishop score", hi: "बिशप स्कोर" },
    sources: [
      { label: "Bishop EH. Pelvic scoring for elective induction. Obstet Gynecol 1964;24:266-8 (table as reproduced in Wikipedia, Bishop score)", url: "https://en.wikipedia.org/wiki/Bishop_score" },
      { label: "Bishop table reproduced in the Ayder Referral Hospital induction study, PMC7147044", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7147044/" },
      { label: "NICE NG207 Inducing labour, 2021, 1.4 (Bishop score 6 or less: dinoprostone or mechanical method; more than 6: amniotomy and oxytocin)", url: "https://www.nice.org.uk/guidance/ng207" },
      { label: "Modifiers (+1 pre-eclampsia, +1 each prior vaginal delivery; -1 postdates, nulliparity, PPROM), FPnotebook Bishop Score", url: "https://fpnotebook.com/OB/Exam/BshpScr.htm" }
    ],
    inputs: [
      { id: "dilation", label: { en: "Cervical dilation", hi: "गर्भाशय ग्रीवा का फैलाव" }, type: "number", unit: "cm", min: 0, max: 10, step: 0.5, required: true },
      { id: "effacement", label: { en: "Effacement", hi: "इफेसमेंट (पतलापन)" }, type: "number", unit: "%", min: 0, max: 100, step: 10, required: true },
      { id: "station", label: { en: "Fetal station", hi: "भ्रूण का स्टेशन" }, type: "select", required: true,
        options: [opt("-3", "-3", "-3"), opt("-2", "-2", "-2"), opt("-1", "-1", "-1"), opt("0", "0", "0"), opt("1", "+1", "+1"), opt("2", "+2", "+2")] },
      { id: "consistency", label: { en: "Consistency", hi: "कठोरता" }, type: "select", required: true,
        options: [opt("firm", "Firm", "कठोर"), opt("medium", "Medium", "मध्यम"), opt("soft", "Soft", "मुलायम")] },
      { id: "position", label: { en: "Position", hi: "स्थिति" }, type: "select", required: true,
        options: [opt("posterior", "Posterior", "पीछे"), opt("mid", "Mid", "मध्य"), opt("anterior", "Anterior", "आगे")] },
      { id: "preeclampsia", label: { en: "Pre-eclampsia (modifier +1)", hi: "प्री-एक्लेम्प्सिया (+1)" }, type: "bool" },
      { id: "priorVaginal", label: { en: "Previous vaginal deliveries (+1 each)", hi: "पिछली योनि प्रसव संख्या (प्रत्येक +1)" }, type: "number", min: 0, max: 15, step: 1 },
      { id: "postdates", label: { en: "Postdates (modifier -1)", hi: "पोस्टडेट्स (-1)" }, type: "bool" },
      { id: "nullip", label: { en: "Nulliparity (modifier -1)", hi: "कोई पूर्व प्रसव नहीं (नलिपैरिटी) (-1)" }, type: "bool" },
      { id: "pprom", label: { en: "PPROM (modifier -1)", hi: "पीपीरॉम (-1)" }, type: "bool" }
    ],
    compute: function (v) {
      v = v || {};
      var d = num(v.dilation), e = num(v.effacement), s = num(v.station), pv = v.priorVaginal == null || v.priorVaginal === "" ? 0 : num(v.priorVaginal);
      if (d === null || d < 0 || d > 10) return bad("Dilation must be 0 to 10 cm.", "फैलाव 0 से 10 सेमी के बीच हो।");
      if (e === null || e < 0 || e > 100) return bad("Effacement must be 0 to 100 percent.", "इफेसमेंट 0 से 100 प्रतिशत के बीच हो।");
      if (s === null || [-3, -2, -1, 0, 1, 2].indexOf(s) < 0) return bad("Station must be -3, -2, -1, 0, +1 or +2.", "स्टेशन -3, -2, -1, 0, +1 या +2 हो।");
      var c = { firm: 0, medium: 1, soft: 2 }[v.consistency], p = { posterior: 0, mid: 1, anterior: 2 }[v.position];
      if (c === undefined || p === undefined) return bad("Choose consistency and position.", "कठोरता और स्थिति चुनें।");
      if (pv === null || pv < 0 || pv % 1 !== 0) return bad("Previous vaginal deliveries must be a whole number.", "पिछली योनि प्रसव संख्या पूर्णांक हो।");
      if (flag(v.nullip) && pv > 0) return bad("Nulliparity cannot be ticked with previous vaginal deliveries.", "पिछले योनि प्रसव होने पर नलिपैरिटी नहीं चुनी जा सकती।");
      var base = dil(d) + eff(e) + stn(s) + c + p;
      var mod = (flag(v.preeclampsia) ? 1 : 0) + pv - (flag(v.postdates) ? 1 : 0) - (flag(v.nullip) ? 1 : 0) - (flag(v.pprom) ? 1 : 0);
      var total = Math.max(0, base + mod);
      var cls = total >= 9 ? ["Favourable cervix: induction likely to succeed.", "अनुकूल ग्रीवा: प्रेरण सफल होने की संभावना अधिक।", "normal"]
        : total >= 7 ? ["More than 6: amniotomy and oxytocin (NICE NG207).", "6 से अधिक: एम्नियोटॉमी और ऑक्सीटोसिन (नाइस एनजी207)।", "normal"]
        : ["6 or less: unfavourable cervix. Ripen it with dinoprostone, misoprostol or a balloon.", "6 या कम: प्रतिकूल ग्रीवा। डाइनोप्रोस्टोन, मिसोप्रोस्टॉल या बैलून से परिपक्व करें।", "caution"];
      return {
        ok: true, value: total, unit: "points", band: cls[2], label: { en: "Bishop score", hi: "बिशप स्कोर" },
        lines: [
          { en: "Cervix components: " + base + " (maximum 13).", hi: "ग्रीवा के घटक: " + base + " (अधिकतम 13)।" },
          { en: "Modifiers: " + (mod > 0 ? "+" : "") + mod + ".", hi: "संशोधक: " + (mod > 0 ? "+" : "") + mod + "।" },
          { en: cls[0], hi: cls[1] }
        ],
        rule: { en: "Sum of dilation, effacement, station (0 to 3 each), consistency and position (0 to 2 each). Score 6 or less is unfavourable and needs ripening (NICE NG207, ACOG PB 107). More than 6: amniotomy and oxytocin. 9 or more is favourable. Modifiers: +1 pre-eclampsia, +1 each prior vaginal delivery; -1 postdates, nulliparity, PPROM. The cervical-length variant (Calder) is not included because its bands differ between sources.",
          hi: "फैलाव, इफेसमेंट, स्टेशन (प्रत्येक 0 से 3), कठोरता और स्थिति (प्रत्येक 0 से 2) का योग। स्कोर 6 या कम प्रतिकूल है और परिपक्वन चाहिए (नाइस एनजी207, एसीओजी पीबी 107)। 6 से अधिक: एम्नियोटॉमी और ऑक्सीटोसिन। 9 या अधिक अनुकूल। संशोधक: प्री-एक्लेम्प्सिया +1, प्रत्येक पिछला योनि प्रसव +1; पोस्टडेट्स, नलिपैरिटी, पीपीरॉम -1। ग्रीवा-लंबाई वाला रूप (काल्डर) शामिल नहीं क्योंकि स्रोतों में उसके स्तर अलग हैं।" }
      };
    },
    examples: [
      { values: { dilation: 0, effacement: 0, station: "-3", consistency: "firm", position: "posterior" }, expect: { value: 0 } },
      { values: { dilation: 1, effacement: 40, station: "-2", consistency: "medium", position: "mid" }, expect: { value: 5 } },
      { values: { dilation: 4, effacement: 50, station: "0", consistency: "medium", position: "anterior" }, expect: { value: 8 } },
      { values: { dilation: 5, effacement: 80, station: "1", consistency: "soft", position: "anterior" }, expect: { value: 13 } },
      { values: { dilation: 3, effacement: 60, station: "-1", consistency: "soft", position: "mid", nullip: true, postdates: true }, expect: { value: 7 } }
    ]
  };
});
