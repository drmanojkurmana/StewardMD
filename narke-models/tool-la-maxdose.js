/* Narkē calculator model: maximum local anaesthetic dose in mg and mL, figures from the app's LAST protocol. Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function o(v, en, hi) { return { value: v, label: { en: en, hi: hi } }; }
  // mg/kg and mg cap, exactly as kb/clinical-protocols/local-anaesthetic-systemic-toxicity.json states them.
  // Plain lidocaine uses the conservative UK figure (3 mg/kg, max 200 mg), as the Anaesthesia kit does; the US/ASRA figure is shown as a note.
  var D = {
    lido: { k: 3, cap: 200, en: "Lidocaine plain", hi: "लिडोकेन (सादा)" },
    lidoadr: { k: 7, cap: 500, en: "Lidocaine with adrenaline", hi: "एड्रेनालिन के साथ लिडोकेन" },
    bupi: { k: 2, cap: 150, en: "Bupivacaine", hi: "बुपिवाकेन" },
    levo: { k: 2, cap: 150, en: "Levobupivacaine", hi: "लेवोबुपिवाकेन" },
    ropi: { k: 3, cap: 200, en: "Ropivacaine", hi: "रोपिवाकेन" }
  };
  return {
    id: "la-maxdose", kind: "tool", group: "anaesthesia", level: "mbbs", review: "ai_drafted",
    title: { en: "Local anaesthetic maximum dose", hi: "लोकल एनेस्थेटिक की अधिकतम खुराक" },
    sources: [
      { label: "Maximum doses as stated in the app's LAST protocol (kb/clinical-protocols/local-anaesthetic-systemic-toxicity.json, 2026), which cites ASRA Pain Medicine LAST checklist 2020", url: "https://asra.com/news-publications/asra-updates/blog-landing/guidelines/2020/11/01/checklist-for-treatment-of-local-anesthetic-systemic-toxicity" },
      { label: "El-Boghdadly K, Pawa A, Chin KJ. Local anesthetic systemic toxicity: current perspectives. Local Reg Anesth 2018", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6087022/" },
      { label: "Association of Anaesthetists. A nomogram for calculating the maximum dose of local anaesthetic. Anaesthesia 2014", url: "https://associationofanaesthetists-publications.onlinelibrary.wiley.com/doi/10.1111/anae.12679" }
    ],
    inputs: [
      { id: "drug", label: { en: "Drug", hi: "दवा" }, type: "select", required: true,
        options: [o("lido", "Lidocaine plain, 3 mg/kg, max 200 mg (US/ASRA: 4.5 mg/kg, max 300 mg)", "लिडोकेन सादा, 3 mg/kg, अधिकतम 200 mg (US/ASRA: 4.5 mg/kg, अधिकतम 300 mg)"), o("lidoadr", "Lidocaine with adrenaline, 7 mg/kg, max 500 mg", "एड्रेनालिन के साथ लिडोकेन, 7 mg/kg, अधिकतम 500 mg"),
                  o("bupi", "Bupivacaine, 2 mg/kg, max 150 mg", "बुपिवाकेन, 2 mg/kg, अधिकतम 150 mg"), o("levo", "Levobupivacaine, 2 mg/kg, max 150 mg", "लेवोबुपिवाकेन, 2 mg/kg, अधिकतम 150 mg"),
                  o("ropi", "Ropivacaine, 3 mg/kg, max 200 mg", "रोपिवाकेन, 3 mg/kg, अधिकतम 200 mg")] },
      { id: "weight", label: { en: "Weight (lean body weight in obesity)", hi: "वज़न (मोटापे में लीन बॉडी वेट)" }, type: "number", unit: "kg", min: 2, max: 200, step: 0.5, required: true },
      { id: "conc", label: { en: "Concentration (optional, for mL)", hi: "सांद्रता (वैकल्पिक, mL के लिए)" }, type: "number", unit: "%", min: 0.1, max: 5, step: 0.05 }
    ],
    compute: function (v) {
      v = v || {}; var d = D[v.drug], w = num(v.weight), c = num(v.conc);
      if (!d) return bad("Choose the drug.", "दवा चुनें।");
      if (w === null || w < 2 || w > 200) return bad("Weight must be 2 to 200 kg.", "वज़न 2 से 200 किग्रा हो।");
      if (c !== null && (c < 0.1 || c > 5)) return bad("Concentration must be 0.1 to 5%.", "सांद्रता 0.1 से 5% हो।");
      var byKg = r1(d.k * w), mg = Math.min(byKg, d.cap), ml = c === null ? null : r1(mg / (c * 10)), lines = [];
      lines.push(byKg > d.cap
        ? { en: d.k + " mg/kg gives " + byKg + " mg, above the " + d.cap + " mg cap, so the cap applies.", hi: d.k + " mg/kg से " + byKg + " mg आता है, जो " + d.cap + " mg की सीमा से अधिक है, इसलिए सीमा लागू।" }
        : { en: d.k + " mg/kg x " + w + " kg = " + byKg + " mg, under the " + d.cap + " mg cap.", hi: d.k + " mg/kg x " + w + " किग्रा = " + byKg + " mg, " + d.cap + " mg की सीमा से कम।" });
      if (ml !== null) lines.push({ en: c + "% is " + r1(c * 10) + " mg/mL, so at most " + ml + " mL.", hi: c + "% यानी " + r1(c * 10) + " mg/mL, इसलिए अधिकतम " + ml + " mL।" });
      else lines.push({ en: "Enter the concentration to see the volume in mL.", hi: "mL में मात्रा देखने के लिए सांद्रता भरें।" });
      if (v.drug === "lido") lines.push({ en: "This is the UK figure. US/ASRA references allow 4.5 mg/kg, max 300 mg.", hi: "यह UK सीमा है। US/ASRA संदर्भ 4.5 mg/kg, अधिकतम 300 mg तक मानते हैं।" });
      if (v.drug === "bupi") lines.push({ en: "The 150 mg cap follows UK labelling; some references allow 175 mg.", hi: "150 mg की सीमा UK लेबल अनुसार है; कुछ संदर्भ 175 mg तक मानते हैं।" });
      lines.push({ en: "Doses of different local anaesthetics add up. Use lean body weight in obesity.", hi: "अलग-अलग लोकल एनेस्थेटिक की खुराक जुड़ती है। मोटापे में लीन बॉडी वेट लें।" });
      lines.push({ en: "Keep 20% lipid emulsion ready wherever blocks are done.", hi: "जहाँ ब्लॉक किए जाते हैं वहाँ 20% लिपिड इमल्शन तैयार रखें।" });
      return { ok: true, value: mg, unit: "mg", ml: ml, label: { en: d.en + ": max " + mg + " mg" + (ml !== null ? " (" + ml + " mL)" : ""), hi: d.hi + ": अधिकतम " + mg + " mg" + (ml !== null ? " (" + ml + " mL)" : "") },
        lines: lines,
        rule: { en: "Maximum dose = mg/kg x weight, never above the mg cap. Volume (mL) = dose (mg) / (concentration % x 10).",
          hi: "अधिकतम खुराक = mg/kg x वज़न, mg सीमा से कभी अधिक नहीं। मात्रा (mL) = खुराक (mg) / (सांद्रता % x 10)।" } };
    },
    examples: [
      { values: { drug: "lido", weight: 70, conc: 1 }, expect: { value: 200, ml: 20 } },
      { values: { drug: "bupi", weight: 50, conc: 0.5 }, expect: { value: 100, ml: 20 } },
      { values: { drug: "ropi", weight: 60, conc: 0.75 }, expect: { value: 180, ml: 24 } },
      { values: { drug: "lidoadr", weight: 80, conc: 2 }, expect: { value: 500, ml: 25 } },
      { values: { drug: "levo", weight: 20, conc: 0.25 }, expect: { value: 40, ml: 16 } }
    ]
  };
});
