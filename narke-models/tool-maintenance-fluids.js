/* Narkē calculator model: maintenance IV fluids by Holliday-Segar (4-2-1 hourly, 100-50-20 daily, NICE NG29 cap). Pure logic, ES5 UMD. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(v) { if (typeof v === "string" && v.replace(/\s/g, "") !== "") v = +v; return typeof v === "number" && isFinite(v) ? v : null; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function hourly(w) { return w <= 10 ? 4 * w : w <= 20 ? 40 + 2 * (w - 10) : 60 + (w - 20); }
  function daily(w) { return w <= 10 ? 100 * w : w <= 20 ? 1000 + 50 * (w - 10) : 1500 + 20 * (w - 20); }
  return {
    id: "maintenance-fluids", kind: "tool", group: "anaesthesia", level: "mbbs", review: "ai_drafted",
    title: { en: "Maintenance IV fluids (Holliday-Segar)", hi: "मेंटेनेंस IV फ्लूइड (हॉलिडे-सेगर)" },
    sources: [
      { label: "NICE NG29. Intravenous fluid therapy in children and young people in hospital (Holliday-Segar 100-50-20, 24-hour maximum 2500 mL males, 2000 mL females, isotonic fluid with sodium 131 to 154 mmol/L)", url: "https://www.nice.org.uk/guidance/ng29/chapter/Recommendations" },
      { label: "Holliday MA, Segar WE. The maintenance need for water in parenteral fluid therapy. Pediatrics 1957;19:823-32", url: "https://pubmed.ncbi.nlm.nih.gov/13431307/" },
      { label: "NICE CG174. Intravenous fluid therapy in adults in hospital (routine maintenance 25 to 30 mL/kg/day of water)", url: "https://www.nice.org.uk/guidance/cg174/chapter/recommendations" }
    ],
    inputs: [
      { id: "weight", label: { en: "Body weight", hi: "वज़न" }, type: "number", unit: "kg", min: 3, max: 150, step: 0.5, required: true },
      { id: "sex", label: { en: "Sex (sets the 24-hour cap)", hi: "लिंग (24 घंटे की सीमा तय करता है)" }, type: "select", required: true,
        options: [{ value: "m", label: { en: "Male", hi: "पुरुष" } }, { value: "f", label: { en: "Female", hi: "महिला" } }] }
    ],
    compute: function (v) {
      v = v || {}; var w = num(v.weight);
      if (w === null || w < 3 || w > 150) return bad("Weight must be 3 to 150 kg.", "वज़न 3 से 150 किग्रा हो।");
      if (v.sex !== "m" && v.sex !== "f") return bad("Choose the sex.", "लिंग चुनें।");
      var h = r1(hourly(w)), d = Math.round(daily(w)), cap = v.sex === "m" ? 2500 : 2000, capH = cap / 24;
      var out = Math.round(Math.min(hourly(w), capH)), capped = hourly(w) > capH;
      var lines = [
        { en: "4-2-1 rule: " + h + " mL/h.", hi: "4-2-1 नियम: " + h + " mL/घंटा।" },
        { en: "100-50-20 rule: " + d + " mL per day, about " + Math.round(d / 24) + " mL/h.", hi: "100-50-20 नियम: " + d + " mL प्रति दिन, लगभग " + Math.round(d / 24) + " mL/घंटा।" }
      ];
      if (capped) lines.push({ en: "Capped at " + cap + " mL a day, " + out + " mL/h. NICE NG29: " + (v.sex === "m" ? "males" : "females") + " rarely need more.", hi: "प्रति दिन " + cap + " mL, यानी " + out + " mL/घंटा पर सीमित। NICE NG29: " + (v.sex === "m" ? "पुरुषों" : "महिलाओं") + " को शायद ही इससे अधिक चाहिए।" });
      lines.push({ en: "Children: start with an isotonic crystalloid with sodium 131 to 154 mmol/L (NICE NG29).", hi: "बच्चे: 131 से 154 mmol/L सोडियम वाले आइसोटोनिक क्रिस्टलॉयड से शुरू करें (NICE NG29)।" });
      lines.push({ en: "If ADH-driven water retention is likely, consider 50 to 80% of this volume (NICE NG29).", hi: "यदि ADH के कारण पानी रुकने की संभावना हो, तो इस मात्रा का 50 से 80% सोचें (NICE NG29)।" });
      lines.push({ en: "Adults: NICE CG174 starts routine maintenance at 25 to 30 mL/kg/day of water.", hi: "वयस्क: NICE CG174 रूटीन मेंटेनेंस 25 से 30 mL/kg/दिन पानी से शुरू करता है।" });
      lines.push({ en: "Term neonates under 28 days use separate NG29 rates, not this formula.", hi: "28 दिन से छोटे पूर्ण-अवधि नवजात के लिए NG29 की अलग दरें हैं, यह सूत्र नहीं।" });
      return { ok: true, value: out, unit: "mL/h", label: { en: "Maintenance " + out + " mL/h", hi: "मेंटेनेंस " + out + " mL/घंटा" }, lines: lines,
        rule: { en: "Hourly: 4 mL/kg for the first 10 kg, 2 mL/kg for the next 10 kg, 1 mL/kg above 20 kg. Daily: 100, 50 and 20 mL/kg for the same bands. The rate never exceeds 2500 mL a day (males) or 2000 mL a day (females).",
          hi: "प्रति घंटा: पहले 10 किग्रा के लिए 4 mL/kg, अगले 10 किग्रा के लिए 2 mL/kg, 20 किग्रा से ऊपर 1 mL/kg। प्रति दिन: इन्हीं हिस्सों के लिए 100, 50 और 20 mL/kg। दर कभी 2500 mL प्रति दिन (पुरुष) या 2000 mL प्रति दिन (महिला) से अधिक नहीं।" } };
    },
    examples: [
      { values: { weight: 8, sex: "m" }, expect: { value: 32 } },
      { values: { weight: 15, sex: "f" }, expect: { value: 50 } },
      { values: { weight: 30, sex: "m" }, expect: { value: 70 } },
      { values: { weight: 70, sex: "m" }, expect: { value: 104 } },
      { values: { weight: 70, sex: "f" }, expect: { value: 83 } }
    ]
  };
});
