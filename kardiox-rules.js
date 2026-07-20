/* kardiox-rules.js — KardioX AI · deterministic RuleValidator (SMD_KARDIOX_RULES).
 *
 * SAFETY-CRITICAL (README M6, ≥95% coverage). Takes structured ECG features (from the AI/mock pipeline)
 * and produces the DETERMINISTIC explainability layer that screen 07 renders: matched criteria with
 * weights, a rhythm-confidence, detected conflicts, a confidence CAP when findings disagree, and a
 * "what to verify" note. It NEVER diagnoses beyond validated findings — it validates + explains.
 *
 * Pure; no DOM/IO. Uses SMD_KARDIOX_SIGNAL for interval/axis categories. node + browser.
 */
(function () {
  "use strict";

  function SIG() { return (typeof window !== "undefined" && window.SMD_KARDIOX_SIGNAL) || (typeof require !== "undefined" ? require("./kardiox-signal.js") : null); }

  // Rule set. Each: id, title, weight (contribution to rhythm confidence), severity, cluster, test(f), detail(f).
  // `cluster` groups mutually-reinforcing criteria (e.g. the AF cluster). weight 0 = advisory flag (no
  // confidence contribution) that still surfaces as a finding/red-flag.
  var RULES = [
    { id: "RHY-AF-01", title: "Irregularly irregular R-R", weight: 0.34, severity: "urgent", cluster: "af",
      test: function (f) { return f.regularity === "irregular"; },
      detail: function (f) { return "RR variance " + (f.rrSdSec != null ? f.rrSdSec : "-") + "s"; } },
    { id: "RHY-PWAVE-ABSENT", title: "Absent P waves", weight: 0.29, severity: "urgent", cluster: "af",
      test: function (f) { return f.pWaves === "absent" || f.prMs === null; },   // known-absent, not merely unknown
      detail: function () { return "No consistent atrial activity"; } },
    { id: "MOR-FWAVE-01", title: "Fibrillatory baseline", weight: 0.19, severity: "info", cluster: "af",
      test: function (f) { return f.fWaves === true; },
      detail: function () { return "f-waves in V1"; } },
    { id: "MEA-QTC-PROLONG", title: "Prolonged QTc", weight: 0, severity: "warn", cluster: "interval",
      test: function (f) { var s = SIG(); return s && s.qtcCategory(f.qtcMs, f.sex) === "prolonged"; },
      detail: function (f) { return "QTc " + f.qtcMs + " ms"; } },
    { id: "MEA-QRS-WIDE", title: "Wide QRS", weight: 0, severity: "warn", cluster: "interval",
      test: function (f) { var s = SIG(); return s && s.qrsCategory(f.qrsMs) === "wide"; },
      detail: function (f) { return "QRS " + f.qrsMs + " ms - consider BBB / ventricular origin"; } },
    { id: "RATE-TACHY", title: "Tachycardia", weight: 0, severity: "warn", cluster: "rate",
      test: function (f) { var s = SIG(); return s && s.rateCategory(f.ventRateBpm) === "tachy"; },
      detail: function (f) { return f.ventRateBpm + " bpm"; } },
    { id: "RATE-BRADY", title: "Bradycardia", weight: 0, severity: "warn", cluster: "rate",
      test: function (f) { var s = SIG(); return s && s.rateCategory(f.ventRateBpm) === "brady"; },
      detail: function (f) { return f.ventRateBpm + " bpm"; } }
  ];

  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (isFinite(n) ? n : 0); }

  // Detect conflicts that should CAP confidence (findings that disagree with the leading rhythm cluster).
  function conflicts(f, matched) {
    var out = [];
    var afMatched = matched.some(function (m) { return m.cluster === "af"; });
    // AF vs organised flutter: an AF pattern alongside discrete flutter waves is contradictory.
    if (afMatched && f.flutterWaves === true) {
      out.push({ id: "CONF-AF-FLUTTER", note: "Flutter waves with an atrial-fibrillation pattern - reconcile AF vs atrial flutter." });
    }
    // Absent P waves but a measured PR interval is internally inconsistent.
    if (f.pWaves === "absent" && typeof f.prMs === "number" && f.prMs > 0) {
      out.push({ id: "CONF-P-PR", note: "PR interval measured despite absent P waves - verify atrial activity." });
    }
    return out;
  }

  function validate(features) {
    var f = features || {};
    var matched = [];
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      var hit = false; try { hit = !!r.test(f); } catch (e) { hit = false; }
      if (hit) matched.push({ ruleId: r.id, title: r.title, detail: r.detail(f), weight: r.weight, severity: r.severity, cluster: r.cluster });
    }
    // Rhythm confidence = sum of matched rhythm-cluster (weighted) contributions, capped just below 1.
    var rhythmWeight = matched.filter(function (m) { return m.cluster === "af"; }).reduce(function (a, m) { return a + (m.weight || 0); }, 0);
    var conf = clamp01(rhythmWeight);
    var confl = conflicts(f, matched);
    // Each conflict caps confidence (never let a contradicted read look certain).
    var cap = confl.length ? Math.min(conf, 0.6) : conf;
    var whatToVerify = confl.length
      ? confl.map(function (c) { return c.note; }).join(" ")
      : "Confirm no flutter waves in inferior leads and correlate with pulse & symptoms.";
    return {
      matched: matched,
      confidence: Math.round(cap * 100) / 100,
      confidenceCapped: cap < conf,
      conflicts: confl,
      whatToVerify: whatToVerify
    };
  }

  // Convenience: derive validator features from an ECGAnalysis-like object (measurements + morphology).
  function featuresFromAnalysis(a) {
    a = a || {}; var m = a.measurements || {};
    var morph = {}; (a.morphology || []).forEach(function (row) { morph[(row.label || "").toLowerCase()] = (row.value || "").toLowerCase(); });
    return {
      regularity: /irreg/.test(m.rhythm || "") ? "irregular" : "regular",
      pWaves: /absent/.test(morph["p waves"] || "") ? "absent" : "present",
      fWaves: /present/.test(morph["fibrillatory waves"] || ""),
      flutterWaves: false,
      prMs: m.prMs, qrsMs: m.qrsMs, qtcMs: m.qtcMs, axisDeg: m.axisDeg, ventRateBpm: m.ventRateBpm,
      rhythmLabel: m.rhythm, sex: a.sex
    };
  }

  var API = { validate: validate, featuresFromAnalysis: featuresFromAnalysis, RULES: RULES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_RULES = API;
})();
