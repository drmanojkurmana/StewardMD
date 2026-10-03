/* Tokos calculator model: anti-D dose from Kleihauer-estimated fetomaternal haemorrhage (FOGSI/ICOG and BSH). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function r2(x) { return Math.round(x * 100) / 100; }
  return {
    id: "antid", kind: "tool", group: "obstetrics", level: "resident", review: "ai_drafted",
    title: { en: "Anti-D dose by fetomaternal haemorrhage", hi: "भ्रूण-मातृ रक्तस्राव से एंटी-डी खुराक" },
    sources: [
      { label: "ICOG-FOGSI Recommendations for Good Clinical Practice: Use of Anti-D Immunoglobulin for Rh Prophylaxis (300 mcg covers 15 mL fetal RBC; 10 mcg per extra 0.5 mL)", url: "https://icogonline.org/wp-content/uploads/pdf/gcpr/for_Rh_Prophylaxis.pdf" },
      { label: "BSH/BCSH guideline for the use of anti-D immunoglobulin, 2014 (500 IU covers 4 mL; 125 IU per mL fetal red cells IM)", url: "https://transfusionontario.org/wp-content/uploads/2020/06/BCSH-Guideline-for-the-use-of-anti-D-immunoglobulin-for-the-prevention-of-HDFN_Trans-Med_2014.pdf" },
      { label: "BCSH guidelines for the estimation of fetomaternal haemorrhage, 2009 (Mollison: % fetal cells x 18 x 1.22)", url: "https://b-s-h.org.uk/media/15705/transfusion-austin-the-estimation-of-fetomaternal-haemorrhage.pdf" }
    ],
    inputs: [
      { id: "guideline", label: { en: "Guideline", hi: "दिशानिर्देश" }, type: "select", required: true,
        options: [{ value: "fogsi", label: { en: "FOGSI/ICOG (mcg)", hi: "एफओजीएसआई/आईसीओजी (एमसीजी)" } }, { value: "bsh", label: { en: "BSH/BCSH (IU)", hi: "बीएसएच/बीसीएसएच (आईयू)" } }] },
      { id: "pct", label: { en: "Fetal cells on Kleihauer-Betke film", hi: "क्लेहाउर-बेटके फिल्म पर भ्रूण कोशिकाएँ" }, type: "number", unit: "%", min: 0, max: 20, step: 0.01, required: true },
      { id: "mbv", label: { en: "Maternal blood volume (FOGSI formula)", hi: "माँ का रक्त आयतन (एफओजीएसआई सूत्र)" }, type: "number", unit: "mL", min: 2000, max: 9000, step: 100 },
      { id: "hct", label: { en: "Maternal haematocrit (FOGSI formula)", hi: "माँ का हेमैटोक्रिट (एफओजीएसआई सूत्र)" }, type: "number", unit: "%", min: 15, max: 60, step: 1 },
      { id: "given", label: { en: "Standard dose already given (BSH, IU)", hi: "दी जा चुकी मानक खुराक (बीएसएच, आईयू)" }, type: "number", unit: "IU", min: 0, max: 5000, step: 50 }
    ],
    compute: function (v) {
      v = v || {}; var p = num(v.pct);
      if (p === null || p < 0 || p > 20) return bad("Fetal cells must be 0 to 20 percent.", "भ्रूण कोशिकाएँ 0 से 20 प्रतिशत के बीच हों।");
      if (v.guideline === "bsh") {
        var g = v.given == null || v.given === "" ? 500 : num(v.given);
        if (g === null || g < 0 || g > 5000) return bad("Dose already given must be 0 to 5000 IU.", "दी गई खुराक 0 से 5000 आईयू हो।");
        var rbc = r2(p * 18 * 1.22), total = Math.max(500, r2(125 * rbc)), extra = Math.max(0, r2(total - g));
        return { ok: true, value: extra, unit: "IU", band: rbc > 4 ? "caution" : "normal", label: { en: "Additional anti-D IM: " + extra + " IU", hi: "अतिरिक्त एंटी-डी (मांसपेशी): " + extra + " आईयू" },
          lines: [{ en: "Fetal red cells: " + p + " x 18 x 1.22 = " + rbc + " mL.", hi: "भ्रूण लाल कोशिकाएँ: " + p + " x 18 x 1.22 = " + rbc + " मिली।" },
                  { en: "Total IM dose 125 IU per mL (minimum 500 IU) = " + total + " IU; less " + g + " IU already given.", hi: "कुल मांसपेशी खुराक 125 आईयू प्रति मिली (न्यूनतम 500 आईयू) = " + total + " आईयू; दी जा चुकी " + g + " आईयू घटाकर।" },
                  { en: "Round up to the nearest vial size of your product; repeat the FMH test at 72 h after an IM dose.", hi: "अपने उत्पाद की निकटतम शीशी के आकार तक बढ़ाएँ; मांसपेशी खुराक के 72 घंटे बाद एफएमएच जाँच दोहराएँ।" }],
          rule: { en: "BSH: 500 IU covers up to 4 mL fetal red cells; for larger bleeds give 125 IU per mL fetal red cells IM, less the dose already given. Volume by Mollison: % fetal cells x 1800 mL x 1.22 / 100.", hi: "बीएसएच: 500 आईयू 4 मिली भ्रूण लाल कोशिकाओं तक पर्याप्त; बड़े रक्तस्राव में 125 आईयू प्रति मिली भ्रूण लाल कोशिका मांसपेशी में, दी जा चुकी खुराक घटाकर। आयतन (मॉलिसन): % भ्रूण कोशिकाएँ x 1800 मिली x 1.22 / 100।" } };
      }
      if (v.guideline !== "fogsi") return bad("Choose a guideline.", "दिशानिर्देश चुनें।");
      var mv = num(v.mbv), h = num(v.hct);
      if (mv === null || mv < 2000 || mv > 9000) return bad("Enter maternal blood volume, 2000 to 9000 mL.", "माँ का रक्त आयतन 2000 से 9000 मिली दें।");
      if (h === null || h < 15 || h > 60) return bad("Enter maternal haematocrit, 15 to 60 percent.", "माँ का हेमैटोक्रिट 15 से 60 प्रतिशत दें।");
      var f = r2(mv * h / 100 * p / 100), add = f > 15 ? Math.ceil((f - 15) / 0.5 - 1e-9) * 10 : 0, tot = 300 + add;
      return { ok: true, value: tot, unit: "mcg", band: f > 15 ? "caution" : "normal", label: { en: "Total anti-D: " + tot + " mcg", hi: "कुल एंटी-डी: " + tot + " एमसीजी" },
        lines: [{ en: "Fetal red cells = maternal blood volume x haematocrit x % fetal cells = " + f + " mL (fetal blood volume = this / newborn haematocrit).", hi: "भ्रूण लाल कोशिकाएँ = माँ का रक्त आयतन x हेमैटोक्रिट x % भ्रूण कोशिकाएँ = " + f + " मिली (भ्रूण रक्त आयतन = यह / नवजात हेमैटोक्रिट)।" },
                { en: "Standard 300 mcg covers 15 mL fetal red cells (30 mL fetal blood); extra " + add + " mcg at 10 mcg per additional 0.5 mL.", hi: "मानक 300 एमसीजी 15 मिली भ्रूण लाल कोशिकाएँ (30 मिली भ्रूण रक्त) कवर करता है; अतिरिक्त " + add + " एमसीजी, हर अतिरिक्त 0.5 मिली पर 10 एमसीजी।" },
                { en: "Give within 72 hours of the sensitising event or delivery of an Rh D positive baby.", hi: "संवेदीकरण करने वाली घटना या आरएच डी पॉज़िटिव शिशु के प्रसव के 72 घंटे के भीतर दें।" }],
        rule: { en: "FOGSI/ICOG: 300 mcg anti-D at least; it covers 15 mL fetal RBC. Add 10 mcg for every additional 0.5 mL. Fetal blood volume = maternal blood volume x maternal haematocrit x % fetal cells / newborn haematocrit.", hi: "एफओजीएसआई/आईसीओजी: कम से कम 300 एमसीजी एंटी-डी; यह 15 मिली भ्रूण आरबीसी कवर करता है। हर अतिरिक्त 0.5 मिली पर 10 एमसीजी जोड़ें। भ्रूण रक्त आयतन = माँ का रक्त आयतन x हेमैटोक्रिट x % भ्रूण कोशिकाएँ / नवजात हेमैटोक्रिट।" } };
    },
    examples: [
      { values: { guideline: "bsh", pct: 0.5 }, expect: { value: 872.5, band: "caution" } },
      { values: { guideline: "bsh", pct: 0.1 }, expect: { value: 0, band: "normal" } },
      { values: { guideline: "fogsi", pct: 0.2, mbv: 5000, hct: 40 }, expect: { value: 300, band: "normal" } },
      { values: { guideline: "fogsi", pct: 1, mbv: 5000, hct: 40 }, expect: { value: 400, band: "caution" } }
    ]
  };
});
