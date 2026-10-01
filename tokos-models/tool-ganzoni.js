/* Tokos calculator model: IV iron deficit by the Ganzoni formula. Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.TOKOS_MODELS = root.TOKOS_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  return {
    id: "ganzoni", kind: "tool", group: "obstetrics", level: "mbbs", review: "ai_drafted",
    title: { en: "IV iron deficit (Ganzoni)", hi: "शिरा द्वारा दिए जाने वाले आयरन की कुल कमी (गैंज़ोनी)" },
    sources: [
      { label: "Ganzoni AM. Intravenous iron-dextran: therapeutic and experimental possibilities. Schweiz Med Wochenschr 1970;100:301-3 (formula as quoted in PMC12001210, iron sucrose vs FCM in pregnancy, India)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12001210/" },
      { label: "AGG recommendations for anaemia in pregnancy (Ganzoni formula, stores 500 mg in pregnancy), PMC12674900", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12674900/" },
      { label: "Venofer (iron sucrose) SmPC, emc: 100 to 200 mg iron, 1 to 3 times a week; maximum single dose 200 mg", url: "https://www.medicines.org.uk/emc/product/5911/smpc" },
      { label: "Ferinject (ferric carboxymaltose) SmPC, emc: single dose not over 20 mg/kg or 1000 mg; at most 1000 mg a week", url: "https://www.medicines.org.uk/emc/product/5910/smpc" }
    ],
    inputs: [
      { id: "weight", label: { en: "Body weight (pre-pregnancy weight in pregnancy)", hi: "वज़न (गर्भावस्था में गर्भधारण से पहले का वज़न)" }, type: "number", unit: "kg", min: 35, max: 200, step: 0.5, required: true },
      { id: "hb", label: { en: "Actual haemoglobin", hi: "वर्तमान हीमोग्लोबिन" }, type: "number", unit: "g/dL", min: 2, max: 20, step: 0.1, required: true },
      { id: "target", label: { en: "Target haemoglobin (11 in pregnancy per WHO; 15 is the classic value)", hi: "लक्ष्य हीमोग्लोबिन (गर्भावस्था में डब्ल्यूएचओ अनुसार 11; 15 पारंपरिक मान)" }, type: "number", unit: "g/dL", min: 10, max: 16, step: 0.1, required: true },
      { id: "stores", label: { en: "Iron stores to replenish", hi: "भंडार भरने के लिए आयरन" }, type: "select", required: true,
        options: [{ value: "500", label: { en: "500 mg (Ganzoni, adults over 35 kg)", hi: "500 मिग्रा (गैंज़ोनी, 35 किग्रा से अधिक वयस्क)" } }, { value: "1000", label: { en: "1000 mg (used by some Indian units)", hi: "1000 मिग्रा (कुछ भारतीय इकाइयों में प्रयुक्त)" } }] }
    ],
    compute: function (v) {
      v = v || {}; var w = num(v.weight), hb = num(v.hb), t = num(v.target), s = +v.stores;
      if (w === null || w < 35 || w > 200) return bad("Weight must be 35 to 200 kg (the 500 mg stores value applies above 35 kg).", "वज़न 35 से 200 किग्रा हो (500 मिग्रा भंडार मान 35 किग्रा से ऊपर लागू)।");
      if (hb === null || hb < 2 || hb > 20 || t === null || t < 10 || t > 16) return bad("Enter Hb 2 to 20 g/dL and target 10 to 16 g/dL.", "एचबी 2 से 20 ग्राम/डेसीली और लक्ष्य 10 से 16 दें।");
      if (s !== 500 && s !== 1000) return bad("Choose the stores value.", "भंडार मान चुनें।");
      if (hb >= t) return bad("Actual Hb is at or above the target; the formula gives no deficit.", "वर्तमान एचबी लक्ष्य के बराबर या अधिक है; सूत्र से कमी नहीं आती।");
      var hbPart = Math.round(w * (t - hb) * 2.4 * 10) / 10, tot = Math.round((hbPart + s) * 10) / 10;
      return { ok: true, value: tot, unit: "mg", label: { en: "Total iron deficit " + tot + " mg", hi: "कुल आयरन की कमी " + tot + " मिग्रा" },
        lines: [{ en: "Haemoglobin part " + hbPart + " mg plus stores " + s + " mg.", hi: "हीमोग्लोबिन भाग " + hbPart + " मिग्रा और भंडार " + s + " मिग्रा।" },
                { en: "Round to the nearest 100 mg and split into doses per the product label; ferric carboxymaltose and derisomaltose labels use their own dosing tables rather than Ganzoni.", hi: "निकटतम 100 मिग्रा तक पूर्णांकित करें और उत्पाद लेबल अनुसार खुराकों में बाँटें; फेरिक कार्बोक्सिमाल्टोज़ और डेरिसोमाल्टोज़ के लेबल में अपनी खुराक तालिका है।" },
                { en: "Split the deficit within each product's limits. Iron sucrose: up to 200 mg per dose, at most 3 doses a week. Ferric carboxymaltose: up to 20 mg/kg and at most 1000 mg per infusion or per week.", hi: "कमी को हर उत्पाद की सीमा में बाँटें। आयरन सुक्रोज़: प्रति खुराक 200 मिग्रा तक, सप्ताह में अधिकतम 3 खुराक। फेरिक कार्बोक्सिमाल्टोज़: 20 मिग्रा/किग्रा तक और प्रति इन्फ्यूज़न या प्रति सप्ताह अधिकतम 1000 मिग्रा।" }],
        rule: { en: "Iron deficit (mg) = weight (kg) x (target Hb - actual Hb, g/dL) x 2.4 + iron stores. The factor 2.4 comes from blood volume of 7% of body weight and Hb iron content of 0.34%. Stores 500 mg (Ganzoni); some Indian units use 1000 mg in pregnancy.",
          hi: "आयरन की कमी (मिग्रा) = वज़न (किग्रा) x (लक्ष्य एचबी - वर्तमान एचबी, ग्राम/डेसीली) x 2.4 + आयरन भंडार। 2.4 शरीर वज़न के 7% रक्त आयतन और एचबी में 0.34% आयरन से आता है। भंडार 500 मिग्रा (गैंज़ोनी); कुछ भारतीय इकाइयाँ गर्भावस्था में 1000 मिग्रा लेती हैं।" } };
    },
    examples: [
      { values: { weight: 60, hb: 7, target: 11, stores: "1000" }, expect: { value: 1576 } },
      { values: { weight: 60, hb: 7, target: 11, stores: "500" }, expect: { value: 1076 } },
      { values: { weight: 50, hb: 8.5, target: 15, stores: "500" }, expect: { value: 1280 } }
    ]
  };
});
