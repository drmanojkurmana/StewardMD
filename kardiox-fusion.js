/* kardiox-fusion.js — KardioX AI · Evidence Fusion / Consensus Engine (SMD_KARDIOX_FUSION).
 *
 * FAITHFUL JS PORT of backend/kardiox/app/services/fusion.py (same log-odds consensus, same
 * constants, same modulation) so the ONE existing Evidence Fusion Engine runs ON-DEVICE in the
 * Capacitor WebView — not a new engine. Combines independent finding proposals (EcgLib heads today;
 * fine-tuned encoders/rules later) in LOG-ODDS space, then modulates by signal quality, measurement
 * consistency, source agreement, rule concordance, rivals/conflicts; clamps to [0.02, 0.98] so the
 * engine never asserts certainty. Pure; no DOM/IO. node + browser.
 */
(function () {
  "use strict";

  var METHOD = "logodds-consensus";
  var CLAMP_LO = 0.02, CLAMP_HI = 0.98, EPS = 1e-6;
  var LOW_AGREEMENT = 0.6, CONCORDANCE_BOOST = 0.5, COMPETING_PENALTY = 0.2,
      CONFLICT_PENALTY = 0.1, DISAGREE_FLOOR = 0.5, LOW_QUALITY = 0.5, LOW_CONSISTENCY = 0.5;

  var ALIASES = {
    "af": "atrial fibrillation", "afib": "atrial fibrillation",
    "aflutter": "atrial flutter", "afl": "atrial flutter",
    "lbbb": "left bundle branch block", "rbbb": "right bundle branch block",
    "crbbb": "complete rbbb", "irbbb": "incomplete rbbb",
    "pvc": "premature ventricular contraction", "pac": "premature atrial contraction",
    "1avb": "first-degree av block", "avb": "av block", "lqt": "prolonged qtc",
    "sbrad": "sinus bradycardia", "stach": "sinus tachycardia", "nsr": "normal sinus rhythm"
  };
  var FAMILIES = ["fibrillation", "flutter", "tachycardia", "bradycardia", "block", "infarction",
    "ischemia", "hypertrophy", "elevation", "depression", "excitation", "qtc", "axis", "brugada"];

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function finite(x) { if (x === null || x === undefined || x === "") return null; x = +x; return isFinite(x) ? x : null; }
  function normLabel(label) {
    var key = String(label == null ? "" : label).trim().toLowerCase().replace(/\s+/g, " ");
    return ALIASES[key] || key;
  }
  function families(key) { var s = {}; FAMILIES.forEach(function (f) { if (key.indexOf(f) >= 0) s[f] = 1; }); return s; }
  function logit(p) { p = clamp(p, EPS, 1 - EPS); return Math.log(p / (1 - p)); }
  function sigmoid(x) { if (x >= 0) return 1 / (1 + Math.exp(-x)); var z = Math.exp(x); return z / (1 + z); }

  // Precompute label sets from the rule engine (matched criteria + any diagnoses) for concordance.
  function ruleIndex(validated) {
    var dx = {}, crit = {}, diff = {}, fam = {};
    (validated.diagnoses || []).forEach(function (d) {
      if (!d || typeof d !== "object") return;
      var lk = normLabel(d.label || ""); if (lk) { dx[lk] = 1; Object.keys(families(lk)).forEach(function (f) { fam[f] = 1; }); }
      (d.differentials || []).forEach(function (df) { if (df) { var k = normLabel(df.label || ""); if (k) { diff[k] = 1; Object.keys(families(k)).forEach(function (f) { fam[f] = 1; }); } } });
    });
    (validated.matched || []).forEach(function (m) {
      if (m && m.title) { var mk = normLabel(m.title); if (mk) { crit[mk] = 1; Object.keys(families(mk)).forEach(function (f) { fam[f] = 1; }); } }
    });
    return { dx: dx, crit: crit, diff: diff, fam: fam };
  }
  function concordance(key, idx) {
    if (!key) return 0;
    if (idx.dx[key] || idx.crit[key]) return 1;
    var d; for (d in idx.dx) { if (key.indexOf(d) >= 0 || d.indexOf(key) >= 0) return 1; }
    if (idx.diff[key]) return 0.5;
    var f = families(key); for (var k in f) { if (idx.fam[k]) return 0.5; }
    return 0;
  }

  function parseCandidates(cands) {
    var clean = [], skipped = 0;
    (cands || []).forEach(function (c, i) {
      if (!c || typeof c !== "object") { skipped++; return; }
      var conf = finite(c.confidence), label = c.label;
      if (conf === null || typeof label !== "string" || !label.trim()) { skipped++; return; }
      var w = finite(c.weight); w = (w === null) ? 1 : Math.max(0, w);
      var src = (c.source != null && String(c.source).trim()) ? String(c.source).trim() : ("source" + i);
      clean.push({ source: src, label: label.trim(), key: normLabel(label), conf: clamp(conf, 0, 1), weight: w });
    });
    return { clean: clean, skipped: skipped };
  }

  function finding(label, fused, sources, agreement, conc, modelConf, sq, mc, disagreement) {
    return { label: label, fusedConfidence: Math.round(fused * 1000) / 1000, sources: sources,
      agreement: Math.round(agreement * 1000) / 1000, ruleConcordance: Math.round(conc * 1000) / 1000,
      factors: { modelConfidence: Math.round(modelConf * 1000) / 1000, agreement: Math.round(agreement * 1000) / 1000,
        ruleConcordance: Math.round(conc * 1000) / 1000, signalQuality: Math.round(sq * 1000) / 1000,
        measurementConsistency: Math.round(mc * 1000) / 1000 }, disagreement: disagreement };
  }

  function fuse(candidates, validated, signalQuality, measurementConsistency) {
    if (candidates == null) candidates = [];
    if (!Array.isArray(candidates)) throw new Error("candidates must be a list");
    validated = (validated && typeof validated === "object") ? validated : {};

    var sqRaw = finite(signalQuality), sqProvided = sqRaw !== null, sq = sqProvided ? clamp(sqRaw, 0, 1) : 1;
    var mcRaw = finite(measurementConsistency), mcProvided = mcRaw !== null, mc = mcProvided ? clamp(mcRaw, 0, 1) : 1;

    var idx = ruleIndex(validated);
    var conflicts = (validated.conflicts || []).filter(function (c) { return c && typeof c === "object"; });
    var warnings = [];
    if (sqProvided && sq < LOW_QUALITY) warnings.push("low signal quality (" + sq.toFixed(2) + "); confidence gated toward 0.5");
    if (mcProvided && mc < LOW_CONSISTENCY) warnings.push("low measurement consistency (" + mc.toFixed(2) + ")");
    conflicts.forEach(function (cf) { if (typeof cf.note === "string" && cf.note) warnings.push("rule-engine conflict: " + cf.note); });

    var pc = parseCandidates(candidates), clean = pc.clean;
    if (pc.skipped) warnings.push("ignored " + pc.skipped + " malformed candidate(s)");

    // Fallback: no usable candidates -> surface rule diagnoses.
    if (!clean.length) {
      var f2 = [];
      (validated.diagnoses || []).filter(function (d) { return d && typeof d === "object"; }).forEach(function (d) {
        var conf = finite(d.confidence); conf = clamp(conf === null ? 0 : conf, 0, 1);
        var fused = clamp(0.5 + (conf - 0.5) * sq, CLAMP_LO, CLAMP_HI);
        f2.push(finding(String(d.label || "").trim() || "unlabelled finding", fused, ["rule-engine"], 1, 1, conf, sq, mc, []));
      });
      f2.sort(function (a, b) { return b.fusedConfidence - a.fusedConfidence || (a.label < b.label ? -1 : 1); });
      if (f2.length) { warnings.push("no model candidates; findings from the rule engine alone");
        return { findings: f2, topLabel: f2[0].label, overallConfidence: Math.round(clamp(f2[0].fusedConfidence * (0.5 + 0.5 * sq), CLAMP_LO, CLAMP_HI) * 1000) / 1000, method: METHOD, warnings: warnings }; }
      warnings.push("no candidates and no rule diagnoses; nothing to fuse");
      return { findings: [], topLabel: null, overallConfidence: 0, method: METHOD, warnings: warnings };
    }

    // Consensus path: group by normalized label.
    var srcSet = {}; clean.forEach(function (c) { srcSet[c.source] = 1; });
    var totalSources = Object.keys(srcSet).length;
    var groups = {};
    clean.forEach(function (c) {
      var g = groups[c.key] || (groups[c.key] = { display: c.label, src: {} });
      var prev = g.src[c.source];
      if (!prev || c.conf > prev.conf) g.src[c.source] = { conf: c.conf, weight: c.weight };
    });
    var labelKeys = Object.keys(groups);
    var hasRivals = labelKeys.length > 1;

    var findings = labelKeys.map(function (key) {
      var g = groups[key], srcs = Object.keys(g.src).sort();
      var agreement = totalSources ? srcs.length / totalSources : 0;
      var logOdds = 0; srcs.forEach(function (s) { logOdds += g.src[s].weight * logit(g.src[s].conf); });
      var combined = sigmoid(logOdds);
      var conc = concordance(key, idx);
      var boost = 1 + CONCORDANCE_BOOST * conc;
      var disagree = Math.max(DISAGREE_FLOOR, 1 - (hasRivals ? COMPETING_PENALTY : 0) - (conflicts.length ? CONFLICT_PENALTY : 0));
      var sharpness = sq * (0.5 + 0.5 * mc) * (0.5 + 0.5 * agreement) * boost * disagree;
      var fused = clamp(0.5 + (combined - 0.5) * sharpness, CLAMP_LO, CLAMP_HI);
      var dis = labelKeys.filter(function (k) { return k !== key; }).map(function (k) { return groups[k].display + " (sources: " + Object.keys(groups[k].src).sort().join(",") + ")"; });
      conflicts.forEach(function (cf) { if (typeof cf.note === "string") dis.push("conflict: " + cf.note); });
      return finding(g.display, fused, srcs, agreement, conc, combined, sq, mc, dis);
    });
    findings.sort(function (a, b) { return b.fusedConfidence - a.fusedConfidence || b.ruleConcordance - a.ruleConcordance || b.agreement - a.agreement || (a.label < b.label ? -1 : 1); });

    var top = findings[0];
    if (totalSources <= 1) warnings.push("only one source contributed; consensus not established");
    else if (hasRivals && top.agreement < LOW_AGREEMENT) warnings.push("sources disagree on the primary finding; consensus is weak");
    var overall = clamp(top.fusedConfidence * (0.5 + 0.5 * sq), CLAMP_LO, CLAMP_HI);
    return { findings: findings, topLabel: top.label, overallConfidence: Math.round(overall * 1000) / 1000, method: METHOD, warnings: warnings };
  }

  var API = { fuse: fuse, METHOD: METHOD };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_FUSION = API;
})();
