/* Tokos explorer model: POP-Q (Pelvic Organ Prolapse Quantification). Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.TOKOS_MODELS["popq"].
   stage(points) takes the nine measurements in cm (Aa, Ba, C, D, Ap, Bp, gh, pb, tvl; D is omitted after a total
   hysterectomy) and returns the stage 0 to IV. Points are measured against the hymen (0): negative is inside, positive
   is beyond it. The leading edge is the most distal of Aa, Ba, C, D, Ap and Bp.
   Stage criteria and point ranges are those of Bump et al. 1996 (ICS, AUGS, SGS), as tabulated on the NIDDK TOMUS
   form F354; validate() enforces the ranges printed on that form. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.TOKOS_MODELS = root.TOKOS_MODELS || {}; root.TOKOS_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function T(en, hi) { return { en: en, hi: hi }; }
  var ROMAN = ["0", "I", "II", "III", "IV"];
  var POINTS = [
    { id: "Aa", compartment: "anterior", range: "-3 to +3", name: T("Aa: anterior vaginal wall, 3 cm from the external urethral meatus", "Aa: anterior vaginal दीवार, external urethral meatus से 3 cm") },
    { id: "Ba", compartment: "anterior", range: "-3 to +tvl", name: T("Ba: most dependent part of the anterior vaginal wall", "Ba: anterior vaginal दीवार का सबसे नीचे वाला हिस्सा") },
    { id: "C", compartment: "apical", range: "-tvl to +tvl", name: T("C: cervix or vaginal cuff", "C: cervix या vaginal cuff") },
    { id: "D", compartment: "apical", range: "-tvl to +tvl", optional: true, name: T("D: posterior fornix (only if the cervix is present)", "D: posterior fornix (केवल यदि cervix मौजूद हो)") },
    { id: "Ap", compartment: "posterior", range: "-3 to +3", name: T("Ap: posterior vaginal wall, 3 cm from the hymen", "Ap: posterior vaginal दीवार, hymen से 3 cm") },
    { id: "Bp", compartment: "posterior", range: "-3 to +tvl", name: T("Bp: most dependent part of the posterior vaginal wall", "Bp: posterior vaginal दीवार का सबसे नीचे वाला हिस्सा") },
    { id: "gh", compartment: null, range: "no limit", name: T("gh: genital hiatus (external urethral meatus to the posterior fourchette)", "gh: genital hiatus (external urethral meatus से posterior fourchette तक)") },
    { id: "pb", compartment: null, range: "no limit", name: T("pb: perineal body (posterior fourchette to the middle of the anal opening)", "pb: perineal body (posterior fourchette से गुदा द्वार के बीच तक)") },
    { id: "tvl", compartment: null, range: "no limit", name: T("tvl: total vaginal length", "tvl: कुल vaginal लंबाई") }
  ];
  var STAGES = [
    { stage: 0, rule: T("No prolapse: Aa, Ap, Ba and Bp are all at -3 cm and C or D is at -(tvl - 2) cm or higher.", "Prolapse नहीं: Aa, Ap, Ba और Bp सभी -3 cm पर हैं और C या D -(tvl - 2) cm या उससे ऊपर है।") },
    { stage: 1, rule: T("Stage 0 is not met and the leading edge is more than 1 cm above the hymen (less than -1).", "Stage 0 पूरा नहीं होता और leading edge hymen से 1 cm से अधिक ऊपर है (-1 से कम)।") },
    { stage: 2, rule: T("The leading edge is between 1 cm above and 1 cm beyond the hymen (-1 to +1, both included).", "Leading edge hymen से 1 cm ऊपर और 1 cm आगे के बीच है (-1 से +1, दोनों शामिल)।") },
    { stage: 3, rule: T("The leading edge is more than 1 cm beyond the hymen but less than +(tvl - 2).", "Leading edge hymen से 1 cm से अधिक आगे है पर +(tvl - 2) से कम।") },
    { stage: 4, rule: T("The leading edge is +(tvl - 2) cm or further: complete or almost complete eversion.", "Leading edge +(tvl - 2) cm या उससे आगे है: पूरा या लगभग पूरा eversion।") }
  ];

  function bad(en, hi, errors) { return { ok: false, error: T(en, hi), errors: errors || [] }; }
  function isNum(x) { return typeof x === "number" && x === x && x !== Infinity && x !== -Infinity; }

  /* Ranges as printed on the TOMUS form F354. D may be missing (null, undefined) after a total hysterectomy. */
  function validate(p) {
    var errs = [];
    if (!p || typeof p !== "object") return bad("Give the points as an object.", "Points को object के रूप में दें।");
    var ids = ["Aa", "Ba", "C", "Ap", "Bp", "gh", "pb", "tvl"], i, k;
    for (i = 0; i < ids.length; i++) if (!isNum(p[ids[i]])) errs.push(ids[i] + " is required and must be a number");
    if (p.D !== undefined && p.D !== null && !isNum(p.D)) errs.push("D must be a number or left out");
    if (errs.length) return bad("Some points are missing or not numbers.", "कुछ points गायब हैं या संख्या नहीं हैं।", errs);
    if (p.tvl <= 0) errs.push("tvl must be above 0");
    if (p.gh < 0) errs.push("gh must be 0 or more");
    if (p.pb < 0) errs.push("pb must be 0 or more");
    if (p.Aa < -3 || p.Aa > 3) errs.push("Aa is from -3 to +3");
    if (p.Ap < -3 || p.Ap > 3) errs.push("Ap is from -3 to +3");
    if (p.Ba < -3 || p.Ba > p.tvl) errs.push("Ba is from -3 to +tvl");
    if (p.Bp < -3 || p.Bp > p.tvl) errs.push("Bp is from -3 to +tvl");
    if (p.C < -p.tvl || p.C > p.tvl) errs.push("C is from -tvl to +tvl");
    if (p.D !== undefined && p.D !== null && (p.D < -p.tvl || p.D > p.tvl)) errs.push("D is from -tvl to +tvl");
    if (errs.length) return bad("Some points are outside the allowed range.", "कुछ points मान्य सीमा से बाहर हैं।", errs);
    k = null;
    return { ok: true };
  }

  /* Measurements that cannot both be right (Bump 1996): Ba is the most dependent point of the upper anterior wall, so it
     is never above Aa; Bp likewise against Ap; D normally lies above C. */
  function warningsOf(p, hasD) {
    var w = [];
    if (hasD && p.D > p.C) w.push(T("D is the posterior fornix and normally lies above (more negative than) C. Check the two measurements.", "D posterior fornix है और आमतौर पर C से ऊपर (C से अधिक negative) होता है। दोनों माप दोबारा जाँचें।"));
    if (p.Ba < p.Aa) w.push(T("Ba is the most dependent part of the anterior wall and cannot be higher than Aa. Check the two measurements.", "Ba anterior दीवार का सबसे नीचे वाला हिस्सा है और Aa से ऊपर नहीं हो सकता। दोनों माप दोबारा जाँचें।"));
    if (p.Bp < p.Ap) w.push(T("Bp is the most dependent part of the posterior wall and cannot be higher than Ap. Check the two measurements.", "Bp posterior दीवार का सबसे नीचे वाला हिस्सा है और Ap से ऊपर नहीं हो सकता। दोनों माप दोबारा जाँचें।"));
    return w;
  }

  function stage(p) {
    var v = validate(p);
    if (!v.ok) return v;
    var hasD = p.D !== undefined && p.D !== null, edge = { point: "Aa", value: p.Aa }, all = [["Aa", p.Aa], ["Ba", p.Ba], ["C", p.C], ["Ap", p.Ap], ["Bp", p.Bp]], i;
    if (hasD) all.push(["D", p.D]);
    for (i = 0; i < all.length; i++) if (all[i][1] > edge.value) edge = { point: all[i][0], value: all[i][1] };
    var lim = p.tvl - 2, s;
    // "either C or D" as printed on the form; the leading edge guard stops an inconsistent D from hiding a prolapsed C
    var stage0 = p.Aa === -3 && p.Ap === -3 && p.Ba === -3 && p.Bp === -3 && (p.C <= -lim || (hasD && p.D <= -lim)) && edge.value < -1;
    if (stage0) s = 0;
    else if (edge.value < -1) s = 1;
    else if (edge.value <= 1) s = 2;
    else if (edge.value < lim) s = 3;
    else s = 4;
    return {
      ok: true, stage: s, roman: ROMAN[s], leadingEdge: edge, tvl: p.tvl, limit: lim, hasD: hasD,
      compartments: {
        anterior: Math.max(p.Aa, p.Ba), apical: hasD ? Math.max(p.C, p.D) : p.C, posterior: Math.max(p.Ap, p.Bp)
      },
      rule: STAGES[s].rule,
      warnings: warningsOf(p, hasD)
    };
  }

  return {
    id: "popq", kind: "explorer", group: "gynaecology", level: "mbbs",
    title: { en: "POP-Q staging", hi: "POP-Q staging (श्रोणि अंग prolapse का मापन)" },
    subtitle: { en: "Set the nine measurements and read the stage", hi: "नौ माप भरें और stage पढ़ें" },
    sources: [
      { label: "Bump RC et al. The standardization of terminology of female pelvic organ prolapse and pelvic floor dysfunction. Am J Obstet Gynecol 1996;175(1):10-17 (abstract only)", url: "https://pubmed.ncbi.nlm.nih.gov/8694033/" },
      { label: "NIDDK TOMUS study form F354, Follow-Up POP-Q Exam (point definitions, ranges and the stage 0 to IV criteria)", url: "https://repository.niddk.nih.gov/media/studies/tomus/Forms/F354%20Follow-Up%20POP-Q%20Exam.pdf" },
      { label: "Samantray SR, Mohapatra I. POP-Q staging and decubitus ulcer in pelvic organ prolapse. Cureus 2021;13(1):e12443 (stage criteria, second check)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7852569/" }
    ],
    review: "ai_drafted",
    notes: {
      how: { en: "Measure at maximal descent (for example straining). Points are in centimetres against the hymen: negative is inside the vagina, positive is beyond the hymen. Stage 0 needs all of Aa, Ap, Ba and Bp at -3.", hi: "Maximal descent पर (जैसे ज़ोर लगाने पर) मापें। Points सेंटीमीटर में hymen के सापेक्ष हैं: negative का मतलब vagina के अंदर, positive का मतलब hymen के आगे। Stage 0 के लिए Aa, Ap, Ba और Bp सभी -3 पर होने चाहिए।" },
      noD: { en: "After a total hysterectomy there is no D: leave it out and C is the vaginal cuff.", hi: "Total hysterectomy के बाद D नहीं होता: उसे छोड़ दें और C vaginal cuff होता है।" },
      teaching: { en: "The stage describes anatomy only. It does not say whether the prolapse bothers the woman or what treatment she needs.", hi: "Stage केवल शरीर-रचना बताता है। यह नहीं बताता कि prolapse स्त्री को परेशान करता है या उसे कौन-सा इलाज चाहिए।" }
    },
    points: POINTS, stages: STAGES, roman: ROMAN,
    validate: validate, stage: stage
  };
});
