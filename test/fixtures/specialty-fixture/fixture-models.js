/* Fixture models for the specialty engine tests. NOT clinical content: arithmetic and a made-up drill, shaped
   exactly like the contract's tool and drill models (docs: tokos2 shared contract, "Model interfaces").
   Browser: window.FIXTURE_MODELS[id]. Node: module.exports = { tool, drill }. */
(function (G) {
  "use strict";
  function bi(en, hi) { return { en: en, hi: hi }; }

  var tool = {
    id: "fx-sum", kind: "tool", group: "obstetrics", level: "mbbs", review: "ai_drafted",
    title: bi("Fixture sum", "फ़िक्स्चर जोड़"),
    sources: [{ label: "Fixture rule, not clinical", url: "https://example.org/fixture" }],
    inputs: [
      { id: "a", label: bi("First number", "पहली संख्या"), type: "number", unit: "u", min: 0, max: 100, step: 1, required: true },
      { id: "b", label: bi("Second number", "दूसरी संख्या"), type: "number", unit: "u", min: 0, max: 100, step: 0.5, required: true },
      { id: "mode", label: bi("Mode", "मोड"), type: "select", options: [{ value: "plain", label: bi("Plain", "सादा") }, { value: "double", label: bi("Double", "दोगुना") }] },
      { id: "flag", label: bi("Add one", "एक जोड़ें"), type: "bool" },
      { id: "on", label: bi("A date", "एक तारीख"), type: "date" }
    ],
    compute: function (v) {
      if (v.a == null || v.b == null) return { ok: false, error: bi("Enter both numbers.", "दोनों संख्याएँ भरें।") };
      var s = (v.a + v.b) * (v.mode === "double" ? 2 : 1) + (v.flag ? 1 : 0);
      return { ok: true, value: s, unit: "u", label: bi("Sum", "जोड़"), band: s > 100 ? "danger" : s > 50 ? "caution" : "normal",
        lines: [bi("Sum of the two numbers.", "दोनों संख्याओं का जोड़।")], rule: bi("a + b, doubled in Double mode, plus one when Add one is on.", "a + b; Double मोड में दोगुना; Add one पर एक और।") };
    },
    examples: [{ values: { a: 2, b: 3, mode: "plain", flag: false }, expect: 5 }, { values: { a: 20, b: 10.5, mode: "double", flag: true }, expect: 62 }]
  };

  var drill = {
    id: "fx-drill", kind: "drill", level: "mbbs", review: "ai_drafted",
    title: bi("Fixture drill", "फ़िक्स्चर ड्रिल"),
    sources: [{ label: "Fixture scenario, not clinical", url: "https://example.org/fixture" }],
    scenario: bi("A made-up scenario with three steps.", "तीन चरणों वाली काल्पनिक स्थिति।"),
    timeLimitSec: 120,
    stages: [
      { id: "s1", prompt: bi("Step one: pick the first action.", "चरण एक: पहला काम चुनें।"), vitals: { note: "fixture" }, timeSec: 60,
        options: [
          { id: "o1", text: bi("Call for help", "मदद बुलाएँ"), correct: true, critical: true, feedback: bi("Right first step.", "सही पहला कदम।"), next: "s2" },
          { id: "o2", text: bi("Wait", "इंतज़ार करें"), correct: false, feedback: bi("Waiting loses time.", "इंतज़ार से समय जाता है।"), next: "s2" }
        ] },
      { id: "s2", prompt: bi("Step two: branch.", "चरण दो: शाखा।"),
        options: [
          { id: "o3", text: bi("Go short", "छोटा रास्ता"), correct: true, feedback: bi("Short path.", "छोटा रास्ता।"), next: "end" },
          { id: "o4", text: bi("Go long", "लंबा रास्ता"), correct: false, feedback: bi("Long path.", "लंबा रास्ता।"), next: "s3" }
        ] },
      { id: "s3", prompt: bi("Step three: finish.", "चरण तीन: समाप्त।"),
        options: [{ id: "o5", text: bi("Finish", "समाप्त"), correct: true, feedback: bi("Done.", "पूरा।") }] }
    ],
    score: function (attempt) {
      var byStage = {}, ok = 0, n = 0, crit = [];
      drill.stages.forEach(function (s) { byStage[s.id] = s; });
      attempt.choices.forEach(function (c) {
        var st = byStage[c.stage], o = null;
        st.options.forEach(function (x) { if (x.id === c.option) o = x; });
        n++; if (o && o.correct) ok++;
        st.options.forEach(function (x) { if (x.critical && x.id !== c.option) crit.push(x.id); });
      });
      return { pct: n ? Math.round(ok * 100 / n) : 0, criticalMisses: crit, lines: [bi(ok + " of " + n + " right.", n + " में से " + ok + " सही।")] };
    }
  };

  var API = { tool: tool, drill: drill };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { G.FIXTURE_MODELS = G.FIXTURE_MODELS || {}; G.FIXTURE_MODELS[tool.id] = tool; G.FIXTURE_MODELS[drill.id] = drill; }
})(typeof window !== "undefined" ? window : this);
