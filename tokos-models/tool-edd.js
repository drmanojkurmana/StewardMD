/* Tokos calculator model: EDD and gestational age (Naegele from LMP, CRL dating by Robinson). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  var DAY = 86400000;
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function parse(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]), d = new Date(t);
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
  }
  function iso(t) { var d = new Date(t), p = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()); }
  // Naegele: LMP + 7 days + 9 calendar months (day clamped to the last day of the target month).
  function naegele(lmp) {
    var d = new Date(lmp + 7 * DAY), y = d.getUTCFullYear(), mo = d.getUTCMonth() + 9, day = d.getUTCDate();
    y += Math.floor(mo / 12); mo = mo % 12;
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return Date.UTC(y, mo, Math.min(day, last));
  }
  // Robinson and Fleming 1975 as tabulated by the BC Women's chart: GA days = 8.052 * sqrt(CRL mm * 1.037) + 23.73
  function robinsonDays(crl) { return Math.floor(8.052 * Math.sqrt(crl * 1.037) + 23.73 + 0.5); }
  function wd(days) { return Math.floor(days / 7) + "w " + (days % 7) + "d"; }
  function redate(lmpGA, diff) {
    var lim = lmpGA <= 62 ? 5 : lmpGA <= 97 ? 7 : null;
    return lim === null ? null : { lim: lim, change: diff > lim };
  }
  return {
    id: "edd", kind: "tool", group: "obstetrics", level: "mbbs", review: "ai_drafted",
    title: { en: "EDD and gestational age", hi: "प्रसव की संभावित तिथि और गर्भावस्था की अवधि" },
    sources: [
      { label: "Naegele's rule: LMP + 7 days + 9 months (Wikipedia, Estimated date of delivery)", url: "https://en.wikipedia.org/wiki/Estimated_date_of_delivery" },
      { label: "Darwish et al. Modified Naegele's rule, cycle length correction. Med J Cairo Univ 1994;62:39-47", url: "https://applications.emro.who.int/imemrf/med_j_cairo_univ_1994_62_1_39.pdf" },
      { label: "Robinson and Fleming 1975, BJOG 82:702-710 (CRL to GA chart, BC Women's)", url: "https://www.bcwomens.ca/Pregnancy-Prenatal-Care-Site/Documents/10.2023%20FHA%20MFM%20Robinson%20CRL%20Chart.pdf" },
      { label: "ACOG Committee Opinion 700: Methods for Estimating the Due Date (Table 1, redating)", url: "https://www.acog.org/-/media/project/acog/acogorg/clinical/files/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date.pdf" }
    ],
    inputs: [
      { id: "method", label: { en: "Method", hi: "विधि" }, type: "select", required: true,
        options: [{ value: "lmp", label: { en: "From LMP (Naegele)", hi: "अंतिम माहवारी से (नेगेले)" } }, { value: "crl", label: { en: "From CRL (Robinson)", hi: "सीआरएल से (रॉबिन्सन)" } }] },
      { id: "lmp", label: { en: "First day of LMP", hi: "अंतिम माहवारी का पहला दिन" }, type: "date" },
      { id: "cycle", label: { en: "Cycle length (LMP method)", hi: "माहवारी चक्र की लंबाई (एलएमपी विधि)" }, type: "number", unit: "days", min: 21, max: 35, step: 1 },
      { id: "crl", label: { en: "Crown-rump length", hi: "क्राउन-रम्प लंबाई" }, type: "number", unit: "mm", min: 5, max: 85, step: 0.1 },
      { id: "scan", label: { en: "Scan date (CRL method)", hi: "स्कैन की तिथि (सीआरएल विधि)" }, type: "date" },
      { id: "asof", label: { en: "Gestational age as of (optional)", hi: "इस तिथि पर गर्भावस्था की अवधि (वैकल्पिक)" }, type: "date" }
    ],
    compute: function (v) {
      v = v || {};
      var asof = v.asof ? parse(v.asof) : null;
      if (v.asof && asof === null) return bad("Enter the as-of date as YYYY-MM-DD.", "तिथि YYYY-MM-DD रूप में दें।");
      var lmp = v.lmp ? parse(v.lmp) : null;
      if (v.lmp && lmp === null) return bad("Enter the LMP as YYYY-MM-DD.", "एलएमपी YYYY-MM-DD रूप में दें।");
      var lines = [], eddT, gaT;
      if (v.method === "lmp") {
        if (lmp === null) return bad("LMP date is required.", "एलएमपी की तिथि आवश्यक है।");
        var cyc = v.cycle === undefined || v.cycle === null || v.cycle === "" ? 28 : num(v.cycle);
        if (cyc === null || cyc < 21 || cyc > 35 || cyc % 1 !== 0) return bad("Cycle length must be a whole number from 21 to 35 days; outside this range use ultrasound dating.", "चक्र की लंबाई 21 से 35 दिन के बीच पूर्णांक हो; इससे बाहर अल्ट्रासाउंड से तिथि तय करें।");
        var adj = cyc - 28;
        eddT = naegele(lmp) + adj * DAY;
        lines.push({ en: "Naegele: LMP + 7 days + 9 months = " + iso(naegele(lmp)) + "; cycle adjustment " + (adj >= 0 ? "+" : "") + adj + " days.", hi: "नेगेले: एलएमपी + 7 दिन + 9 माह = " + iso(naegele(lmp)) + "; चक्र समायोजन " + (adj >= 0 ? "+" : "") + adj + " दिन।" });
        lines.push({ en: "280 days from LMP (with same adjustment): " + iso(lmp + (280 + adj) * DAY) + ". Calendar method can differ by a day or two.", hi: "एलएमपी से 280 दिन (समान समायोजन सहित): " + iso(lmp + (280 + adj) * DAY) + "। कैलेंडर विधि में एक-दो दिन का अंतर हो सकता है।" });
        if (asof !== null) gaT = Math.round((asof - (lmp + adj * DAY)) / DAY);
      } else if (v.method === "crl") {
        var crl = num(v.crl), scan = v.scan ? parse(v.scan) : null;
        if (crl === null || crl < 5 || crl > 85) return bad("CRL must be 5 to 85 mm (chart range, about 6 to 14 weeks).", "सीआरएल 5 से 85 मिमी के बीच हो (चार्ट की सीमा, लगभग 6 से 14 सप्ताह)।");
        if (scan === null) return bad("Scan date is required as YYYY-MM-DD.", "स्कैन की तिथि YYYY-MM-DD रूप में आवश्यक है।");
        var g = robinsonDays(crl);
        eddT = scan + (280 - g) * DAY;
        lines.push({ en: "CRL " + crl + " mm gives GA " + g + " days (" + wd(g) + ") on the scan date.", hi: "सीआरएल " + crl + " मिमी से स्कैन के दिन गर्भावस्था " + g + " दिन (" + wd(g) + ")।" });
        if (lmp !== null) {
          var lg = Math.round((scan - lmp) / DAY), diff = Math.abs(lg - g), r = redate(lg, diff);
          lines.push({ en: "LMP dating at scan: " + wd(lg) + "; difference " + diff + " days.", hi: "स्कैन पर एलएमपी अनुसार: " + wd(lg) + "; अंतर " + diff + " दिन।" });
          if (r) lines.push({ en: "ACOG CO 700: change the EDD if the difference is more than " + r.lim + " days. Here: " + (r.change ? "change EDD to the ultrasound date." : "keep LMP dating."), hi: "एसीओजी सीओ 700: अंतर " + r.lim + " दिन से अधिक हो तो ईडीडी बदलें। यहाँ: " + (r.change ? "ईडीडी अल्ट्रासाउंड के अनुसार बदलें।" : "एलएमपी की तिथि रखें।") });
        }
        if (asof !== null) gaT = Math.round((asof - (eddT - 280 * DAY)) / DAY);
      } else return bad("Choose a method.", "विधि चुनें।");
      if (gaT !== undefined) lines.push({ en: "Gestational age on " + iso(asof) + ": " + (gaT < 0 ? "before conception dating" : wd(gaT)) + ".", hi: iso(asof) + " को गर्भावस्था: " + (gaT < 0 ? "गणना से पहले की तिथि" : wd(gaT)) + "।" });
      return {
        ok: true, value: iso(eddT), label: { en: "Estimated date of delivery", hi: "प्रसव की संभावित तिथि" }, lines: lines,
        rule: { en: "LMP: Naegele adds 7 days and 9 months (assumes a 28-day cycle; add or subtract the days the cycle is longer or shorter). CRL: GA in days = 8.052 x sqrt(CRL mm x 1.037) + 23.73 (Robinson and Fleming, as tabulated by BC Women's); EDD = scan date + (280 - GA) days.",
          hi: "एलएमपी: नेगेले में 7 दिन और 9 माह जोड़ते हैं (28 दिन के चक्र की मान्यता; चक्र जितने दिन लंबा या छोटा हो उतने दिन जोड़ें या घटाएँ)। सीआरएल: दिनों में अवधि = 8.052 x sqrt(सीआरएल मिमी x 1.037) + 23.73 (रॉबिन्सन और फ्लेमिंग); ईडीडी = स्कैन तिथि + (280 - अवधि) दिन।" }
      };
    },
    examples: [
      { values: { method: "lmp", lmp: "2000-03-18" }, expect: { value: "2000-12-25" } },
      { values: { method: "lmp", lmp: "2020-05-08" }, expect: { value: "2021-02-15" } },
      { values: { method: "lmp", lmp: "2020-05-08", cycle: 35 }, expect: { value: "2021-02-22" } },
      { values: { method: "crl", crl: 10, scan: "2026-01-01" }, expect: { value: "2026-08-19" } },
      { values: { method: "crl", crl: 40, scan: "2026-01-01" }, expect: { value: "2026-07-24" } }
    ]
  };
});
