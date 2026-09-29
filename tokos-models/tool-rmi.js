/* Tokos calculator model: Risk of Malignancy Index I (Jacobs 1990). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function flag(v) { return v === true || v === "true" || v === 1 || v === "1"; }
  function feat(id, en, hi) { return { id: id, label: { en: en, hi: hi }, type: "bool" }; }
  var F = ["multilocular", "solid", "bilateral", "ascites", "metastases"];
  return {
    id: "rmi", kind: "tool", group: "gynaecology", level: "resident", review: "ai_drafted",
    title: { en: "Risk of Malignancy Index (RMI I)", hi: "मैलिग्नेंसी रिस्क इंडेक्स (आरएमआई I)" },
    sources: [
      { label: "NICE CG122 Ovarian cancer: Appendix, Risk of malignancy index (RMI I) and recommendation to refer at 250 or more", url: "https://www.nice.org.uk/guidance/cg122/chapter/appendix-risk-of-malignancy-index-rmi-i" },
      { label: "Jacobs I et al. A risk of malignancy index incorporating CA 125, ultrasound and menopausal status. Br J Obstet Gynaecol 1990;97:922-9 (cut-off 200)", url: "https://pubmed.ncbi.nlm.nih.gov/2223684/" }
    ],
    inputs: [
      feat("multilocular", "Multilocular cyst", "बहुकक्षीय सिस्ट"), feat("solid", "Solid areas", "ठोस भाग"), feat("bilateral", "Bilateral lesions", "दोनों ओर घाव"),
      feat("ascites", "Ascites", "जलोदर (एसाइटीज़)"), feat("metastases", "Intra-abdominal metastases", "पेट के भीतर मेटास्टेसिस"),
      { id: "post", label: { en: "Postmenopausal (no period for over 1 year, or over 50 after hysterectomy)", hi: "रजोनिवृत्ति के बाद (1 वर्ष से अधिक माहवारी नहीं, या गर्भाशय निकालने के बाद 50 से अधिक आयु)" }, type: "bool" },
      { id: "ca125", label: { en: "Serum CA125", hi: "सीरम सीए125" }, type: "number", unit: "IU/mL", min: 0, max: 100000, step: 1, required: true }
    ],
    compute: function (v) {
      v = v || {}; var ca = num(v.ca125);
      if (ca === null || ca < 0 || ca > 100000) return bad("Enter CA125 as 0 to 100000 IU/mL.", "सीए125 0 से 100000 आईयू/मिली में दें।");
      var n = 0, i; for (i = 0; i < F.length; i++) if (flag(v[F[i]])) n++;
      var u = n === 0 ? 0 : n === 1 ? 1 : 3, m = flag(v.post) ? 3 : 1, r = u * m * ca;
      var hi = r >= 250, mid = !hi && r >= 200;
      return { ok: true, value: r, band: hi ? "danger" : mid ? "caution" : "normal", label: { en: "RMI I = " + r, hi: "आरएमआई I = " + r },
        lines: [{ en: "U = " + u + " (" + n + " ultrasound features), M = " + m + ", CA125 = " + ca + ".", hi: "यू = " + u + " (" + n + " अल्ट्रासाउंड लक्षण), एम = " + m + ", सीए125 = " + ca + "।" },
                hi ? { en: "250 or more: refer to a specialist gynaecological cancer multidisciplinary team (NICE CG122).", hi: "250 या अधिक: विशेषज्ञ स्त्री-कैंसर बहुविषयक टीम को रेफर करें (नाइस सीजी122)।" }
                   : mid ? { en: "200 to 249: above the original Jacobs cut-off of 200 but below the NICE referral level of 250; use clinical judgement.", hi: "200 से 249: जैकब्स के मूल कट-ऑफ 200 से ऊपर पर नाइस रेफरल स्तर 250 से नीचे; नैदानिक निर्णय लें।" }
                   : { en: "Below 200: lower risk on this index.", hi: "200 से कम: इस सूचकांक पर कम जोखिम।" }],
        rule: { en: "RMI I = U x M x CA125. U: 0 for no feature, 1 for one, 3 for two to five of multilocular cyst, solid areas, bilateral lesions, ascites, metastases. M: 1 premenopausal, 3 postmenopausal. Jacobs cut-off 200 (sensitivity 85%, specificity 97%); NICE refers at 250 or more.",
          hi: "आरएमआई I = यू x एम x सीए125। यू: कोई लक्षण नहीं तो 0, एक हो तो 1, बहुकक्षीय सिस्ट, ठोस भाग, दोनों ओर घाव, जलोदर, मेटास्टेसिस में से दो से पाँच हों तो 3। एम: रजोनिवृत्ति से पहले 1, बाद में 3। जैकब्स कट-ऑफ 200 (संवेदनशीलता 85%, विशिष्टता 97%); नाइस 250 या अधिक पर रेफर करता है।" } };
    },
    examples: [
      { values: { ca125: 40 }, expect: { value: 0, band: "normal" } },
      { values: { solid: true, ca125: 40 }, expect: { value: 40, band: "normal" } },
      { values: { solid: true, bilateral: true, post: true, ca125: 30 }, expect: { value: 270, band: "danger" } },
      { values: { solid: true, bilateral: true, ca125: 35 }, expect: { value: 105, band: "normal" } },
      { values: { multilocular: true, post: true, ca125: 70 }, expect: { value: 210, band: "caution" } }
    ]
  };
});
