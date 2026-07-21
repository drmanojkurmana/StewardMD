/* kardiox-engines.js — KardioX AI · Multi-Engine registry + Evidence Fusion v2 + routing + unified
 * clinical report (SMD_KARDIOX_ENGINES). ADDITIVE — reuses (does NOT rewrite) kardiox-fusion.js's
 * log-odds consensus; each model (EcgLib, ECG-Diagnosis, NSTEMI, encoder heads) is an INDEPENDENT
 * diagnostic engine. Never hides disagreement. Engines are lazy-loaded via ONNX Runtime (web on device,
 * node in validation); a Not-Ready engine (no ONNX file) is skipped, never faked. node + browser.
 */
(function () {
  "use strict";
  function FUSION() { return (typeof window !== "undefined" && window.SMD_KARDIOX_FUSION) || (typeof require !== "undefined" ? require("./kardiox-fusion.js") : null); }

  // Canonical clinical labels (so "AF" from one engine fuses with "AFIB" from another).
  // group: rhythm | conduction | morphology | ischemia. severity drives emergency flags + verdict rank.
  var LABEL = {
    AFIB: { canon: "atrial fibrillation", label: "Atrial fibrillation", severity: "urgent", group: "rhythm" },
    AF:   { canon: "atrial fibrillation", label: "Atrial fibrillation", severity: "urgent", group: "rhythm" },
    STACH:{ canon: "sinus tachycardia", label: "Sinus tachycardia", severity: "warn", group: "rhythm" },
    SBRAD:{ canon: "sinus bradycardia", label: "Sinus bradycardia", severity: "warn", group: "rhythm" },
    SNR:  { canon: "sinus rhythm", label: "Sinus rhythm", severity: "info", group: "rhythm" },
    "1AVB":{ canon: "first-degree av block", label: "First-degree AV block", severity: "info", group: "conduction" },
    IAVB: { canon: "first-degree av block", label: "First-degree AV block", severity: "info", group: "conduction" },
    CRBBB:{ canon: "complete rbbb", label: "Complete RBBB", severity: "warn", group: "conduction" },
    RBBB: { canon: "right bundle branch block", label: "Right bundle branch block", severity: "warn", group: "conduction" },
    IRBBB:{ canon: "incomplete rbbb", label: "Incomplete RBBB", severity: "info", group: "conduction" },
    LBBB: { canon: "left bundle branch block", label: "Left bundle branch block", severity: "warn", group: "conduction" },
    PVC:  { canon: "premature ventricular complex", label: "Premature ventricular complex", severity: "warn", group: "morphology" },
    PAC:  { canon: "premature atrial complex", label: "Premature atrial complex", severity: "info", group: "morphology" },
    STD:  { canon: "st depression", label: "ST depression", severity: "urgent", group: "ischemia" },
    STE:  { canon: "st elevation", label: "ST elevation (STEMI pattern)", severity: "critical", group: "ischemia" },
    NSTEMI:{ canon: "nstemi", label: "NSTEMI", severity: "critical", group: "ischemia" }
  };
  function meta(code) { return LABEL[code] || { canon: String(code).toLowerCase(), label: String(code), severity: "info", group: "morphology" }; }
  var SEVRANK = { critical: 4, urgent: 3, warn: 2, stable: 1, info: 0 };

  // Engine registry. Each engine declares its outputs + reliability weight + which dx groups it is a
  // preferred/authoritative source for (routing). `heads` = one ONNX per code (EcgLib); `model` = one
  // ONNX emitting `codes` (ECG-Diagnosis/NSTEMI). ready() = its ONNX assets are actually present.
  var ENGINES = [
    { name: "ecglib", weight: 0.6, authoritative: ["rhythm", "conduction"],
      inputSpec: { leads: 12, samples: 5000, fs: 500, norm: "perlead_zscore" },
      heads: ["AFIB", "1AVB", "SBRAD", "STACH", "PVC", "CRBBB", "IRBBB"], activation: "sigmoid" },
    { name: "ecg-diagnosis", weight: 0.55, authoritative: ["ischemia", "morphology"],
      inputSpec: { leads: 12, samples: 2500, sourceSamples: 15000, downsample: 6, fs: 500, norm: "perlead_zscore" },
      model: { file: "engines/ecg_diagnosis.onnx", codes: ["SNR", "AF", "IAVB", "LBBB", "RBBB", "PAC", "PVC", "STD", "STE"] }, activation: "sigmoid" },
    { name: "nstemi", weight: 0.5, authoritative: ["ischemia"],
      inputSpec: { leads: 12, samples: 4096, fs: 400, norm: "perlead_zscore" },
      model: { file: "engines/nstemi.onnx", codes: ["NSTEMI"] }, activation: "sigmoid" },
    // HeartGPT: single-lead (lead II) nanoGPT → 500 int tokens; ONNX already emits a probability
    // (probOut). Mask-friendly for partial paper layouts / missing leads.
    { name: "heartgpt", weight: 0.5, authoritative: ["rhythm"],
      inputSpec: { kind: "tokens", lead: 1, downsample: 5, tokens: 500, fs: 500 },
      model: { file: "engines/heartgpt_afib.onnx", codes: ["AFIB"], inputName: "tokens", probOut: true }, activation: "prob" }
  ];

  // Per-engine preprocessing: right-align to sourceSamples (front-pad 0), downsample by `downsample`,
  // yielding `samples`, then per-lead z-norm. Faithfully reproduces each model's training pipeline
  // (EcgLib: 5000@500,ds1; ECG-Diagnosis: pad-15000→ds6→2500) from a single raw 12-lead input.
  function prepFloat(leads, spec) {
    var N = spec.samples, ds = spec.downsample || 1, src = spec.sourceSamples || N, C = 12;
    var out = new Float32Array(C * N);
    for (var c = 0; c < C; c++) {
      var L = leads[c] || [], n = Math.min(L.length, src);
      var seg = new Float64Array(src);
      for (var i = 0; i < n; i++) seg[src - n + i] = L[L.length - n + i];   // right-align, front-pad 0
      var mean = 0, j;
      for (j = 0; j < N; j++) { var k = j * ds; mean += (k < src ? seg[k] : 0); }
      mean /= N;
      var v = 0; for (j = 0; j < N; j++) { var kk = j * ds, d = (kk < src ? seg[kk] : 0) - mean; v += d * d; }
      var sd = Math.sqrt(v / N) || 1e-6;
      for (j = 0; j < N; j++) { var k2 = j * ds; out[c * N + j] = ((k2 < src ? seg[k2] : 0) - mean) / sd; }
    }
    return out;
  }
  function sigmoid(x) { return x >= 0 ? 1 / (1 + Math.exp(-x)) : (function () { var z = Math.exp(x); return z / (1 + z); })(); }

  // HeartGPT-style tokeniser: lead-II → downsample → last-T samples → min-max 0..100 int tokens.
  function buildTokens(leads, spec) {
    var lead = leads[spec.lead || 0] || leads[0] || [];
    var ds = spec.downsample || 1, T = spec.tokens || 500, s = [];
    for (var i = 0; i < lead.length; i += ds) s.push(lead[i]);
    s = s.slice(-T);
    var mn = Math.min.apply(null, s), mx = Math.max.apply(null, s), rng = (mx - mn) || 1;
    var tok = new BigInt64Array(T), pad = T - s.length;
    for (var j = 0; j < T; j++) { var k = j - pad, v = k >= 0 ? Math.round((s[k] - mn) / rng * 100) : 0; tok[j] = BigInt(v < 0 ? 0 : v > 100 ? 100 : v); }
    return tok;
  }

  // Run one engine → [{code, prob}]. ort + load(file)->session are injected (web/node). Lazy+cached.
  // Handles 3 input contracts: multi-head float (EcgLib), single-model float (ECG-Diagnosis/NSTEMI),
  // and single-lead int64 tokens (HeartGPT). probOut engines already emit a probability (no sigmoid).
  function runEngine(engine, leads, ctx) {
    var ort = ctx.ort, sess = ctx.sessions || (ctx.sessions = {});
    function one(file) { if (!sess[file]) sess[file] = ctx.load(file); return Promise.resolve(sess[file]); }
    var probOut = engine.model && engine.model.probOut;
    function act(v) { return probOut ? v : sigmoid(v); }

    if (engine.inputSpec && engine.inputSpec.kind === "tokens") {
      var xt = new ort.Tensor("int64", buildTokens(leads, engine.inputSpec), [1, engine.inputSpec.tokens || 500]);
      var feed = {}; feed[engine.model.inputName || "tokens"] = xt;
      return one(engine.model.file).then(function (s) {
        return Promise.resolve(s.run(feed)).then(function (o) {
          var arr = o[Object.keys(o)[0]].data, out = [];
          engine.model.codes.forEach(function (code, i) { out.push({ code: code, prob: act(Number(arr[i])) }); });
          return out;
        });
      });
    }

    var N = engine.inputSpec.samples;
    var x = new ort.Tensor("float32", prepFloat(leads, engine.inputSpec), [1, 12, N]);
    if (engine.heads) {
      return engine.heads.reduce(function (chain, code) {
        return chain.then(function (acc) {
          return one("models/ecglib_" + code + ".onnx").then(function (s) {
            return Promise.resolve(s.run({ ecg: x })).then(function (o) {
              acc.push({ code: code, prob: act(Number(o[Object.keys(o)[0]].data[0])) }); return acc;
            });
          });
        });
      }, Promise.resolve([]));
    }
    return one(engine.model.file).then(function (s) {
      return Promise.resolve(s.run({ ecg: x })).then(function (o) {
        var arr = o[Object.keys(o)[0]].data, out = [];
        engine.model.codes.forEach(function (code, i) { out.push({ code: code, prob: act(Number(arr[i])) }); });
        return out;
      });
    });
  }

  // Analyze a 12-lead signal across ALL ready engines → Evidence Fusion v2 → unified clinical report.
  // ctx = { ort, load(file)->session, ready(file)->bool, threshold?, ruleValidated?, quality?, reconstruction? }
  function analyze(leads, ctx) {
    var fuse = FUSION();
    var routed = ENGINES.filter(function (e) {
      var files = e.heads ? e.heads.map(function (c) { return "models/ecglib_" + c + ".onnx"; }) : [e.model.file];
      return files.every(function (f) { return ctx.ready ? ctx.ready(f) : true; });
    });
    var skipped = ENGINES.filter(function (e) { return routed.indexOf(e) < 0; }).map(function (e) { return e.name; });
    var thr = ctx.threshold != null ? ctx.threshold : 0.5;

    return routed.reduce(function (chain, e) {
      return chain.then(function (results) {
        return runEngine(e, leads, ctx).then(function (dx) {
          results.push({ engine: e.name, weight: e.weight, dx: dx }); return results;
        });
      });
    }, Promise.resolve([])).then(function (engineResults) {
      // Candidates for the EXISTING fusion engine — one per (engine, fired code).
      var candidates = [];
      engineResults.forEach(function (r) {
        r.dx.forEach(function (d) {
          if (d.prob >= thr) candidates.push({ source: r.engine, label: meta(d.code).canon, confidence: d.prob, weight: r.weight, _code: d.code });
        });
      });
      var fused = fuse ? fuse.fuse(candidates, ctx.ruleValidated || {}, ctx.quality != null ? ctx.quality : null, null)
        : { findings: [], topLabel: null, overallConfidence: 0, warnings: [] };
      var rep = report(fused, engineResults, candidates, skipped, ctx, thr);
      // Optional Vertex AI secondary-opinion fallback (only fires on its own gate; never overwrites the
      // specialist consensus). Additive: no ctx.vertex → the specialist report is returned unchanged.
      if (ctx.vertex && typeof ctx.vertex.consult === "function") {
        return ctx.vertex.consult(rep, ctx.patient || { quality: ctx.quality }).then(function (vr) { return ctx.vertex.mergeIntoReport(rep, vr); });
      }
      return rep;
    });
  }

  // Evidence Fusion v2 output → unified clinical report (Phase 5). Never hides disagreement.
  function report(fused, engineResults, candidates, skipped, ctx, thr) {
    // canonical → {label, severity, group, engines:[{engine,prob}]}
    var byCanon = {};
    engineResults.forEach(function (r) {
      r.dx.forEach(function (d) {
        var m = meta(d._code || d.code), key = m.canon;
        var g = byCanon[key] || (byCanon[key] = { label: m.label, severity: m.severity, group: m.group, engines: [] });
        g.engines.push({ engine: r.engine, prob: Math.round(d.prob * 1000) / 1000 });
      });
    });
    // fused findings carry the log-odds consensus + rival disagreement already.
    var findings = (fused.findings || []).map(function (f) {
      var canon = f.label.toLowerCase(), g = byCanon[canon] || {};
      return { diagnosis: g.label || f.label, canonical: canon, group: g.group || "morphology", severity: g.severity || "info",
        probability: f.fusedConfidence, confidence: f.fusedConfidence, agreement: f.agreement,
        supportingModels: f.sources, disagreement: f.disagreement };
    });
    // primary = highest clinical severity among fused findings, tie-broken by fused confidence.
    var ranked = findings.slice().sort(function (a, b) { return (SEVRANK[b.severity] || 0) - (SEVRANK[a.severity] || 0) || b.probability - a.probability; });
    var primary = ranked[0] || null;
    // agreement/disagreement surfacing across engines
    var agree = [], disagree = [];
    Object.keys(byCanon).forEach(function (k) {
      var g = byCanon[k], hi = g.engines.filter(function (e) { return e.prob >= thr; }), lo = g.engines.filter(function (e) { return e.prob < thr; });
      if (hi.length >= 2) agree.push({ diagnosis: g.label, models: hi });
      if (hi.length && lo.length) disagree.push({ diagnosis: g.label, supporting: hi, against: lo });
    });
    var emergency = ranked.filter(function (f) { return f.severity === "critical" || f.severity === "urgent"; }).map(function (f) { return f.diagnosis; });
    return {
      primaryDiagnosis: primary ? primary.diagnosis : "No high-probability abnormality",
      primaryConfidence: primary ? primary.probability : (fused.overallConfidence || 0),
      differentials: ranked.map(function (f) { return { diagnosis: f.diagnosis, probability: f.probability, group: f.group, severity: f.severity, supportingModels: f.supportingModels }; }),
      confidence: fused.overallConfidence || 0,
      modelContributions: engineResults.map(function (r) { return { model: r.engine, weight: r.weight, diagnoses: r.dx.filter(function (d) { return d.prob >= thr; }).map(function (d) { return { code: d.code, label: meta(d._code || d.code).label, probability: Math.round(d.prob * 1000) / 1000 }; }) }; }),
      agreement: agree, disagreement: disagree,
      emergencyFlags: emergency,
      leadQuality: ctx.reconstruction ? ctx.reconstruction.confidence : undefined,
      explanation: "Fused " + engineResults.length + " engine(s) via log-odds consensus (" + (fused.method || "n/a") + "). " +
        (agree.length ? agree.length + " diagnosis(es) corroborated by >=2 engines. " : "") +
        (disagree.length ? disagree.length + " under disagreement (all shown). " : "") +
        (skipped.length ? "Not-ready engines skipped: " + skipped.join(", ") + ". " : "") + "Decision support, not a diagnosis.",
      recommendations: emergency.length ? ["Urgent clinician review — " + emergency.join(", ")] : ["Correlate with clinical context; confirm findings on the full trace."],
      warnings: fused.warnings || [],
      enginesRun: engineResults.map(function (r) { return r.engine; }), enginesSkipped: skipped
    };
  }

  var API = { ENGINES: ENGINES, LABEL: LABEL, analyze: analyze, runEngine: runEngine, meta: meta };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_ENGINES = API;
})();
