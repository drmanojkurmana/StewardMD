/* Tokos calculator model: magnesium sulphate regimens (Pritchard, Zuspan) with toxicity checks. Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function flag(v) { return v === true || v === "true" || v === 1 || v === "1"; }
  var TOX = { en: "Stop MgSO4, give oxygen, intubate if required, and give 10 mL of 10% calcium gluconate slow IV over 10 minutes with ECG monitoring.",
              hi: "एमजीएसओ4 रोकें, ऑक्सीजन दें, आवश्यक हो तो इंट्यूबेशन करें, और 10% कैल्शियम ग्लूकोनेट 10 मिली धीरे-धीरे 10 मिनट में शिरा से दें, ईसीजी निगरानी के साथ।" };
  var HOLD = { en: "Withhold this dose. Recheck reflexes, respiration and urine hourly. Give the next dose when all three criteria are met. Give calcium gluconate only if respiration is depressed.",
               hi: "यह खुराक रोकें। हर घंटे रिफ्लेक्स, श्वसन और मूत्र दोबारा जाँचें। तीनों शर्तें पूरी होने पर अगली खुराक दें। कैल्शियम ग्लूकोनेट केवल श्वसन दबने पर दें।" };
  var FIT = { en: "If a convulsion recurs, give a further 2 g IV (10 mL of 20% solution) over 5 minutes (WHO MCPC).",
              hi: "दौरा दोबारा आए तो 2 ग्राम और शिरा से (20% घोल का 10 मिली) 5 मिनट में दें (डब्ल्यूएचओ एमसीपीसी)।" };
  var DUR = { en: "Continue for 24 hours after delivery or the last convulsion, whichever is later. Routine serum magnesium is not needed. Keep calcium gluconate at the bedside.",
              hi: "प्रसव या अंतिम दौरे के 24 घंटे बाद तक (जो बाद में हो) जारी रखें। नियमित सीरम मैग्नीशियम आवश्यक नहीं। कैल्शियम ग्लूकोनेट बिस्तर के पास रखें।" };
  return {
    id: "mgso4", kind: "tool", group: "obstetrics", level: "resident", review: "ai_drafted",
    title: { en: "Magnesium sulphate regimens and monitoring", hi: "मैग्नीशियम सल्फेट की खुराक और निगरानी" },
    sources: [
      { label: "FOGSI-Gestosis-ICOG Hypertensive Disorders in Pregnancy GCPR 2019 (pp. 14-15)", url: "https://icogonline.org/wp-content/uploads/pdf/gcpr/hdp_fogsi_gestosis_icog_gcpr_2019.pdf" },
      { label: "Pritchard JA. The use of magnesium ion in the management of eclamptogenic toxemias (cited by the FOGSI GCPR)", url: "https://icogonline.org/wp-content/uploads/pdf/gcpr/hdp_fogsi_gestosis_icog_gcpr_2019.pdf" }
    ],
    inputs: [
      { id: "regimen", label: { en: "Regimen", hi: "पद्धति" }, type: "select", required: true,
        options: [{ value: "pritchard", label: { en: "Pritchard (IV + IM)", hi: "प्रिचर्ड (शिरा + मांसपेशी)" } }, { value: "zuspan", label: { en: "Zuspan (IV)", hi: "ज़ुस्पान (शिरा)" } }] },
      { id: "phase", label: { en: "Phase", hi: "चरण" }, type: "select", required: true,
        options: [{ value: "loading", label: { en: "Loading dose", hi: "लोडिंग खुराक" } }, { value: "maintenance", label: { en: "Maintenance check", hi: "मेंटेनेंस जाँच" } }] },
      { id: "reflex", label: { en: "Patellar reflex", hi: "घुटने की रिफ्लेक्स" }, type: "select",
        options: [{ value: "", label: { en: "Not checked", hi: "जाँच नहीं" } }, { value: "1", label: { en: "Present", hi: "मौजूद" } }, { value: "0", label: { en: "Absent", hi: "अनुपस्थित" } }] },
      { id: "rr", label: { en: "Respiratory rate", hi: "श्वसन दर" }, type: "number", unit: "/min", min: 0, max: 60, step: 1 },
      { id: "urine4h", label: { en: "Urine output in the last 4 hours", hi: "पिछले 4 घंटे में मूत्र मात्रा" }, type: "number", unit: "mL", min: 0, max: 3000, step: 10 }
    ],
    compute: function (v) {
      v = v || {};
      var pr = v.regimen === "pritchard";
      if (!pr && v.regimen !== "zuspan") return bad("Choose a regimen.", "पद्धति चुनें।");
      if (v.phase === "loading") {
        var lines = pr ? [
          { en: "IV: 4 g slow IV as 20 mL of 20% solution (4 ampoules of 50% MgSO4 plus 12 mL distilled water in a 20 mL syringe) at 1 g per minute (WHO gives it over 5 minutes).", hi: "शिरा: 4 ग्राम धीरे-धीरे, 20 मिली 20% घोल (50% एमजीएसओ4 की 4 एम्पूल + 12 मिली डिस्टिल्ड वॉटर, 20 मिली सिरिंज में) 1 ग्राम प्रति मिनट (WHO 5 मिनट में देता है)।" },
          { en: "IM: 5 g (5 ampoules of 50% plus 0.5 mL of 2% lignocaine) deep IM in each buttock.", hi: "मांसपेशी: प्रत्येक नितंब में 5 ग्राम (50% की 5 एम्पूल + 0.5 मिली 2% लिग्नोकेन) गहरी।" },
          { en: "Total loading 14 g.", hi: "कुल लोडिंग 14 ग्राम।" }] : [
          { en: "IV: 4 g slow IV as 20 mL of 20% solution (4 ampoules of 50% plus 12 mL distilled water).", hi: "शिरा: 4 ग्राम धीरे-धीरे, 20 मिली 20% घोल (50% की 4 एम्पूल + 12 मिली डिस्टिल्ड वॉटर)।" },
          { en: "Then maintenance 1 g/h: 5 g (5 ampoules of 50%) in 500 mL Ringer lactate at 100 mL/h, preferably by infusion pump.", hi: "फिर मेंटेनेंस 1 ग्राम/घंटा: 500 मिली रिंगर लैक्टेट में 5 ग्राम (50% की 5 एम्पूल) 100 मिली/घंटा, बेहतर हो तो इन्फ्यूजन पंप से।" }];
        lines.push(FIT);
        lines.push(DUR);
        return { ok: true, value: pr ? 14 : 4, unit: "g", label: { en: "Loading dose", hi: "लोडिंग खुराक" }, lines: lines, rule: rule(pr) };
      }
      if (v.phase !== "maintenance") return bad("Choose a phase.", "चरण चुनें।");
      var rr = num(v.rr), u = num(v.urine4h);
      if (rr === null || rr < 0 || rr > 60) return bad("Respiratory rate must be 0 to 60 per minute.", "श्वसन दर 0 से 60 प्रति मिनट हो।");
      if (u === null || u < 0 || u > 3000) return bad("Urine output must be 0 to 3000 mL in 4 hours.", "मूत्र मात्रा 4 घंटे में 0 से 3000 मिली हो।");
      if (v.reflex === undefined || v.reflex === null || v.reflex === "") return bad("State whether the patellar reflex is present.", "बताएँ कि घुटने की रिफ्लेक्स मौजूद है या नहीं।");
      var rf = flag(v.reflex), fails = [];
      if (!rf) fails.push({ en: "patellar reflex absent", hi: "घुटने की रिफ्लेक्स अनुपस्थित" });
      if (!(rr > 16)) fails.push({ en: "respiratory rate 16/min or below", hi: "श्वसन दर 16/मिनट या कम" });
      if (!(u > 100)) fails.push({ en: "urine 100 mL or less in 4 hours", hi: "4 घंटे में मूत्र 100 मिली या कम" });
      if (fails.length) {
        return { ok: true, value: 0, unit: "g", band: "danger", label: { en: "Withhold the next maintenance dose", hi: "अगली मेंटेनेंस खुराक रोकें" },
          lines: [{ en: "Parameter not met: " + fails.map(function (f) { return f.en; }).join("; ") + ".", hi: "पूरी न हुई शर्त: " + fails.map(function (f) { return f.hi; }).join("; ") + "।" },
                  rr < 12 ? { en: "Respiratory depression: treat as magnesium toxicity. " + TOX.en, hi: "श्वसन दबा हुआ है: मैग्नीशियम विषाक्तता मानकर उपचार करें। " + TOX.hi } : HOLD]
                  .concat(u > 100 ? [] : [{ en: "Look for the cause of low urine output, such as fluids or worsening pre-eclampsia.", hi: "मूत्र कम होने का कारण देखें, जैसे तरल या बिगड़ता प्री-एक्लेम्प्सिया।" }]), rule: rule(pr) };
      }
      return { ok: true, value: pr ? 5 : 1, unit: pr ? "g" : "g/h", band: "normal", label: { en: "Give the next maintenance dose", hi: "अगली मेंटेनेंस खुराक दें" },
        lines: [pr ? { en: "5 g (5 ampoules of 50% plus 0.5 mL of 2% lignocaine) deep IM into the alternate buttock, every 4 hours.", hi: "5 ग्राम (50% की 5 एम्पूल + 0.5 मिली 2% लिग्नोकेन) दूसरे नितंब में गहरी मांसपेशी में, हर 4 घंटे।" }
                    : { en: "Continue 1 g/h infusion (5 g in 500 mL Ringer lactate at 100 mL/h).", hi: "1 ग्राम/घंटा इन्फ्यूजन जारी रखें (500 मिली रिंगर लैक्टेट में 5 ग्राम, 100 मिली/घंटा)।" },
                DUR], rule: rule(pr) };
    },
    examples: [
      { values: { regimen: "pritchard", phase: "loading" }, expect: { value: 14 } },
      { values: { regimen: "zuspan", phase: "loading" }, expect: { value: 4 } },
      { values: { regimen: "pritchard", phase: "maintenance", reflex: "1", rr: 18, urine4h: 120 }, expect: { value: 5, band: "normal" } },
      { values: { regimen: "zuspan", phase: "maintenance", reflex: "1", rr: 18, urine4h: 120 }, expect: { value: 1, band: "normal" } },
      { values: { regimen: "pritchard", phase: "maintenance", reflex: "0", rr: 18, urine4h: 120 }, expect: { value: 0, band: "danger" } },
      { values: { regimen: "pritchard", phase: "maintenance", reflex: "1", rr: 16, urine4h: 120 }, expect: { value: 0, band: "danger" } },
      { values: { regimen: "pritchard", phase: "maintenance", reflex: "1", rr: 18, urine4h: 100 }, expect: { value: 0, band: "danger" } }
    ]
  };
  function rule(pr) {
    return { en: (pr ? "Pritchard: 4 g IV plus 5 g deep IM in each buttock, then 5 g IM 4-hourly" : "Zuspan: 4 g IV, then 1 g/h IV") + ". Give maintenance only if patellar reflexes are present, respiratory rate is above 16/min and urine output is above 100 mL in the last 4 hours (FOGSI GCPR 2019). Serum magnesium levels are not routinely required.",
             hi: (pr ? "प्रिचर्ड: 4 ग्राम शिरा और प्रत्येक नितंब में 5 ग्राम गहरी मांसपेशी, फिर हर 4 घंटे 5 ग्राम" : "ज़ुस्पान: 4 ग्राम शिरा, फिर 1 ग्राम/घंटा") + "। मेंटेनेंस तभी दें जब घुटने की रिफ्लेक्स मौजूद हो, श्वसन दर 16/मिनट से अधिक हो और पिछले 4 घंटे में मूत्र 100 मिली से अधिक हो (एफओजीएसआई जीसीपीआर 2019)। सीरम मैग्नीशियम नियमित रूप से आवश्यक नहीं।" };
  }
});
