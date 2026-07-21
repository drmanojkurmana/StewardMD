/* kardiox-ort.js — KardioX AI · REAL on-device inference provider (SMD_KARDIOX_ORT).
 *
 * Runs the EcgLib multi-head ensemble (AFIB/1AVB/SBRAD/STACH/PVC/CRBBB/IRBBB) as ONNX models via
 * ONNX Runtime Web (onnxruntime-web / WASM) INSIDE the Capacitor WebView — genuine per-ECG inference,
 * no mock. Implements the existing ECGAnalyzer interface { analyze(input, onStage) -> ECGAnalysis }
 * so it drops into SMD_KARDIOX_PROVIDERS with zero view changes. Pipeline:
 *   signal (12×N @500Hz)  [image→signal digitiser is injected via opts.digitize]
 *     → real R-peak DSP (rate + RR regularity, lead II)
 *     → run every ONNX head → per-pathology probability
 *     → Evidence Fusion Engine (SMD_KARDIOX_FUSION, log-odds consensus)
 *     → Rule Engine (SMD_KARDIOX_RULES) + measurements
 *     → ECGAnalysis (SMD_KARDIOX_MODELS.makeAnalysis)  → the report renders REAL results.
 * Never fabricates: without a signal AND without a digitiser it raises a typed error (no mock).
 * ort + fetch are injectable (Node verification uses onnxruntime-node). node + browser.
 */
(function () {
  "use strict";

  function MODELS() { return (typeof window !== "undefined" && window.SMD_KARDIOX_MODELS) || (typeof require !== "undefined" ? require("./kardiox-models.js") : null); }
  function FUSION() { return (typeof window !== "undefined" && window.SMD_KARDIOX_FUSION) || (typeof require !== "undefined" ? require("./kardiox-fusion.js") : null); }
  function RULES() { return (typeof window !== "undefined" && window.SMD_KARDIOX_RULES) || (typeof require !== "undefined" ? require("./kardiox-rules.js") : null); }
  function SIG() { return (typeof window !== "undefined" && window.SMD_KARDIOX_SIGNAL) || (typeof require !== "undefined" ? require("./kardiox-signal.js") : null); }
  function RECON() { return (typeof window !== "undefined" && window.SMD_KARDIOX_RECONSTRUCT) || (typeof require !== "undefined" ? require("./kardiox-reconstruct.js") : null); }

  function err(code, message, stage) { var e = new Error(message); e.code = code; e.stage = stage || "rhythm"; return e; }

  // 12-lead order the ensemble expects; PTB-XL / EcgLib standard.
  var LEAD_ORDER = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

  // Coerce input into 12 lead arrays. Accepts [12][N] or [N][12].
  function toLeads(signal) {
    if (!signal) return null;
    if (Array.isArray(signal) && signal.length === 12 && Array.isArray(signal[0])) return signal;               // [12][N]
    if (Array.isArray(signal) && Array.isArray(signal[0]) && signal[0].length === 12) {                          // [N][12]
      var N = signal.length, out = []; for (var c = 0; c < 12; c++) { var lead = new Float64Array(N); for (var i = 0; i < N; i++) lead[i] = signal[i][c]; out.push(lead); } return out;
    }
    if (signal.leads && signal.leads.length === 12) return signal.leads;
    return null;
  }

  // Per-lead z-normalised [1,12,5000] tensor payload (matches the export/verification preprocessing).
  function preprocess(signal) {
    var leads = toLeads(signal); if (!leads) throw err("needs_signal", "signal must be 12 leads", "signalExtraction");
    var C = 12, N = 5000, out = new Float32Array(C * N);
    for (var c = 0; c < C; c++) {
      var lead = leads[c] || [], n = Math.min(lead.length, N), mean = 0, i;
      for (i = 0; i < n; i++) { if (!isFinite(lead[i])) throw err("needs_signal", "non-finite sample in lead " + c + "; route paper ECGs through analyzePaper() (never feed a masked canvas directly)", "signalExtraction"); mean += lead[i]; }
      mean /= (n || 1);
      var v = 0; for (i = 0; i < n; i++) { var d = lead[i] - mean; v += d * d; }
      var sd = Math.sqrt(v / (n || 1)) || 1e-6;
      for (i = 0; i < N; i++) out[c * N + i] = (i < n) ? (lead[i] - mean) / sd : 0;
    }
    return { data: out, dims: [1, C, N] };
  }

  // Real R-peak detection (Pan-Tompkins-style: derivative → square → moving-window integrate →
  // adaptive threshold). Returns heart rate + RR series + regularity. NON-diagnostic measurement.
  function rpeaks(lead, fs) {
    fs = fs || 500; lead = lead || []; var n = lead.length; if (n < fs) return { bpm: null, rrMs: [], regularity: "unknown" };
    var d = new Float64Array(n), i;
    for (i = 2; i < n - 2; i++) { var g = (2 * lead[i + 1] + lead[i + 2] - lead[i - 2] - 2 * lead[i - 1]); d[i] = g * g; }
    var w = Math.round(0.15 * fs), integ = new Float64Array(n), acc = 0;
    for (i = 0; i < n; i++) { acc += d[i]; if (i >= w) acc -= d[i - w]; integ[i] = acc / w; }
    var max = 0; for (i = 0; i < n; i++) if (integ[i] > max) max = integ[i];
    if (max <= 0) return { bpm: null, rrMs: [], regularity: "unknown" };
    var thr = 0.3 * max, minRR = Math.round(0.25 * fs), peaks = [], last = -minRR;
    for (i = 1; i < n - 1; i++) { if (integ[i] > thr && integ[i] >= integ[i - 1] && integ[i] > integ[i + 1] && (i - last) >= minRR) { peaks.push(i); last = i; } }
    if (peaks.length < 2) return { bpm: null, rrMs: [], regularity: "unknown" };
    var rr = []; for (i = 1; i < peaks.length; i++) rr.push((peaks[i] - peaks[i - 1]) * 1000 / fs);
    var sorted = rr.slice().sort(function (a, b) { return a - b; }), med = sorted[Math.floor(sorted.length / 2)];
    var bpm = med > 0 ? Math.round(60000 / med) : null;
    var s = SIG(); return { bpm: bpm, rrMs: rr, regularity: s ? s.regularity(rr) : "unknown" };
  }

  function makeOrtAnalyzer(opts) {
    opts = opts || {};
    var ort = opts.ort || (typeof window !== "undefined" && window.ort) || null;
    var baseUrl = opts.baseUrl || "kardiox-models";
    var fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    var digitize = opts.digitize || null;          // optional image→signal hook (ECG-Digitiser export)
    var _manifest = opts.manifest || null, _sessions = null;

    function resolve(file) { return baseUrl + "/" + String(file).split("/").pop(); }

    function ensure() {
      if (_sessions) return Promise.resolve();
      if (!ort) return Promise.reject(err("runtime_unavailable", "ONNX Runtime not loaded", "rhythm"));
      var manP = _manifest ? Promise.resolve(_manifest)
        : (fetchImpl ? Promise.resolve(fetchImpl(resolve("manifest.json"))).then(function (r) { return r.json(); })
          : Promise.reject(err("runtime_unavailable", "no manifest and no fetch", "rhythm")));
      return manP.then(function (man) {
        _manifest = man; _sessions = {};
        var heads = (man.heads || []).filter(function (h) { return h.file; });
        return Promise.all(heads.map(function (h) {
          return Promise.resolve(ort.InferenceSession.create(resolve(h.file))).then(function (s) { _sessions[h.pathology] = s; });
        }));
      });
    }

    function stage(onStage, name, pct) { try { if (typeof onStage === "function") onStage(name, pct); } catch (e) {} }

    function assemble(headResults, fused, rp, ruleRes, image) {
      var models = MODELS();
      var ranked = headResults.slice().sort(function (a, b) { return b.prob - a.prob; });
      var differentials = ranked.slice(0, 6).map(function (h) { return { label: h.label, probability: h.prob }; });
      var positives = ranked.filter(function (h) { return h.prob >= (h.threshold || 0.5); });
      // Headline verdict: among FIRED findings prefer the highest clinical severity, then fused
      // confidence (so AF-with-RVR headlines as AF, not the co-firing "sinus tachycardia"). The full
      // ranked probability list is preserved in differentials + fusion below.
      var SEVRANK = { critical: 4, urgent: 3, warn: 2, stable: 1, info: 0 };
      var fired = (fused && fused.findings ? fused.findings : []).map(function (f) {
        var h = headResults.filter(function (x) { return x.label === f.label; })[0];
        return { label: f.label, fused: f.fusedConfidence, severity: h ? h.severity : "info" };
      }).sort(function (a, b) { return (SEVRANK[b.severity] || 0) - (SEVRANK[a.severity] || 0) || b.fused - a.fused; });

      var verdict, severity, confidence;
      if (fired.length) {
        verdict = fired[0].label; severity = fired[0].severity; confidence = fired[0].fused;
      } else {
        // Nothing fired: honest, measurement-derived summary (never a fabricated diagnosis).
        var reg = rp.regularity, rate = rp.bpm;
        verdict = (reg === "regular" && rate && rate >= 60 && rate <= 100) ? "Sinus rhythm" : "No high-probability abnormality detected";
        severity = "info"; confidence = fused ? fused.overallConfidence : 0;
      }

      var findings = (fused && fused.findings ? fused.findings : []).map(function (f, i) {
        var h = headResults.filter(function (x) { return x.label === f.label; })[0];
        return { id: "ml" + i, title: f.label, detail: "EcgLib P=" + (h ? h.prob.toFixed(2) : "?") + " · fused " + f.fusedConfidence,
                 matched: true, weight: f.fusedConfidence, severity: h ? h.severity : "info", evidence: [] };
      });
      (ruleRes.matched || []).forEach(function (m, i) {
        findings.push({ id: "rule" + i, title: m.title, detail: m.detail, matched: true, weight: m.weight, severity: m.severity, evidence: [{ ruleId: m.ruleId }] });
      });

      var probLine = ranked.map(function (h) { return h.pathology + " " + Math.round(h.prob * 100) + "%"; }).join(", ");
      var raw = {
        id: (image && image.id) ? String(image.id) : "",
        verdict: verdict, severity: severity, confidence: confidence,
        engine: "ecglib-ensemble-1.1.0",
        measurements: { ventRateBpm: rp.bpm, rhythm: rp.regularity === "irregular" ? "Irregular" : (rp.regularity === "regular" ? "Regular" : "-"),
                        prMs: null, qrsMs: null, qtcMs: null, axisDeg: null },
        findings: findings, differentials: differentials,
        clinicalInterpretation: "EcgLib 7-head ensemble (real inference). Rate " + (rp.bpm != null ? rp.bpm + " bpm" : "n/a") +
          ", RR " + rp.regularity + ". Per-head P(pathology): " + probLine + ". Fusion: " + (fused ? fused.method : "n/a") +
          " overall " + (fused ? fused.overallConfidence : 0) + ". Decision support, not a diagnosis; PR/QRS/QTc delineation not computed on-device.",
        whatToVerify: ruleRes.whatToVerify || "Correlate with the full 12-lead trace, pulse and symptoms.",
        schemaVersion: "1.0"
      };
      if (image && image.id) raw.image = image;
      var a = models.makeAnalysis(raw);
      a.engine = "ecglib-ensemble-1.1.0"; a.fusion = fused; a.headProbabilities = ranked;
      return a;
    }

    function analyze(image, onStage) {
      stage(onStage, "upload", 5);
      var signal = (image && image.signal) || null;
      stage(onStage, "quality", 15);
      var pre = signal ? Promise.resolve(signal)
        : (digitize ? (stage(onStage, "digitization", 30), Promise.resolve(digitize(image)))
          : Promise.reject(err("needs_signal", "No 12-lead signal: on-device image digitiser not configured yet.", "digitization")));
      return pre.then(function (sig) {
        signal = sig; if (!toLeads(signal)) throw err("needs_signal", "digitiser returned no usable signal", "digitization");
        stage(onStage, "signalExtraction", 45);
        return ensure().then(function () {
          var fs = (_manifest.input && _manifest.input.fs_hz) || 500;
          stage(onStage, "measurement", 55);
          var leads = toLeads(signal), rp = rpeaks(leads[1] || leads[0], fs);
          stage(onStage, "rhythm", 65);
          var pp = preprocess(signal), tensor = new ort.Tensor("float32", pp.data, pp.dims);
          var heads = (_manifest.heads || []).filter(function (h) { return h.file && _sessions[h.pathology]; });
          return heads.reduce(function (chain, h) {
            return chain.then(function (acc) {
              return Promise.resolve(_sessions[h.pathology].run({ ecg: tensor })).then(function (out) {
                var key = Object.keys(out)[0], logit = Number(out[key].data[0]), p = 1 / (1 + Math.exp(-logit));
                acc.push({ pathology: h.pathology, label: h.label, severity: h.severity, prob: p, threshold: h.threshold || 0.5 });
                return acc;
              });
            });
          }, Promise.resolve([])).then(function (headResults) {
            stage(onStage, "ruleValidation", 78);
            var rules = RULES();
            var features = { regularity: rp.regularity, ventRateBpm: rp.bpm, prMs: null, qrsMs: null, qtcMs: null };
            var ruleRes = rules ? rules.validate(features) : { matched: [], conflicts: [], whatToVerify: "" };
            stage(onStage, "clinicalExplanation", 88);
            var weight = (_manifest.source_weight != null) ? _manifest.source_weight : 0.6;
            var candidates = headResults.filter(function (h) { return h.prob >= (h.threshold || 0.5); })
              .map(function (h) { return { source: "ecglib", label: h.label, confidence: h.prob, weight: weight }; });
            var fusion = FUSION();
            var fused = fusion ? fusion.fuse(candidates, { matched: ruleRes.matched, conflicts: ruleRes.conflicts, diagnoses: [] }, null, null)
              : { findings: [], topLabel: null, overallConfidence: 0, method: "none", warnings: [] };
            var analysis = assemble(headResults, fused, rp, ruleRes, image);
            stage(onStage, "report", 100);
            return analysis;
          });
        });
      });
    }

    // ── Paper-ECG entry (ADDITIVE) ────────────────────────────────────────────────────────────────
    // Photo/PDF → digitiser → per-lead traces → RECONSTRUCTION LAYER → (full coverage → the SAME
    // analyze()/ensemble path unchanged) OR (partial layout → safe low-confidence WARN, ensemble NOT
    // run on fabricated data). `digitized` = { leads:{name:{mv,fs}}, rhythmLead?, layoutHint?, calibration }.
    function safePartial(recon, digitized, onStage) {
      var models = MODELS(), R = RECON();
      var rp = { bpm: null, rrMs: [], regularity: "unknown" };
      var strip = R && R.rhythmLeadSignal ? R.rhythmLeadSignal(recon) : null;
      if (strip) rp = rpeaks(strip, recon.fs);      // rate/rhythm from the continuous 10s strip only
      stage(onStage, "report", 100);
      var raw = {
        id: (digitized && digitized.id) ? String(digitized.id) : "",
        verdict: "Insufficient lead coverage for AI analysis",
        severity: "info", confidence: recon.confidence.overall, engine: "ecglib-ensemble-1.1.0+reconstruct",
        measurements: { ventRateBpm: rp.bpm, rhythm: rp.regularity === "irregular" ? "Irregular" : (rp.regularity === "regular" ? "Regular" : "-"),
                        prMs: null, qrsMs: null, qtcMs: null, axisDeg: null },
        findings: [], differentials: [],
        clinicalInterpretation: "Layout " + recon.layout + " reconstructed at " + Math.round(recon.confidence.coverage * 100) +
          "% lead coverage. A dense 10s x 12 signal is not available without fabricating data, so the diagnostic ensemble was NOT run. " +
          (strip ? ("Rhythm strip present: rate " + (rp.bpm != null ? rp.bpm + " bpm, " + rp.regularity : "n/a") + ". ") : "No continuous rhythm strip. ") +
          "Decision support only — clinician review required.",
        whatToVerify: (recon.warnings || []).join(" "),
        schemaVersion: "1.0"
      };
      var a = models.makeAnalysis(raw);
      a.engine = "ecglib-ensemble-1.1.0+reconstruct"; a.reconstruction = { layout: recon.layout, coverage: recon.confidence.coverage, confidence: recon.confidence, warnings: recon.warnings, contemporaneityGroups: recon.contemporaneityGroups };
      return a;
    }

    function analyzePaper(digitized, onStage) {
      var R = RECON(); if (!R) return Promise.reject(err("runtime_unavailable", "reconstruction layer missing", "digitization"));
      stage(onStage, "upload", 5); stage(onStage, "digitization", 25);
      var recon;
      try { recon = R.reconstruct(digitized); } catch (e) { return Promise.reject(err("layout_undetected", "could not reconstruct layout: " + e.message, "digitization")); }
      stage(onStage, "signalExtraction", 45);
      if (recon.samples !== 5000 || recon.fs !== 500) return Promise.reject(err("bad_image", "reconstruction " + recon.fs + "Hz/" + recon.samples + " samples != EcgLib 500Hz/5000; resample required before inference", "signalExtraction"));
      var dense = R.toDense(recon);
      if (!dense.dense) return Promise.resolve(safePartial(recon, digitized, onStage));   // partial → safe warn, no fabrication
      return analyze({ id: digitized && digitized.id, signal: dense.dense }, onStage).then(function (a) {
        a.reconstruction = { layout: recon.layout, coverage: recon.confidence.coverage, confidence: recon.confidence, warnings: recon.warnings, contemporaneityGroups: recon.contemporaneityGroups };
        a.confidence = Math.min(a.confidence, recon.confidence.overall);   // gate the AI confidence by digitisation/calibration confidence
        return a;
      });
    }

    return { kind: "ecglib-ort", analyze: analyze, analyzePaper: analyzePaper, ensure: ensure,
             _diag: { preprocess: preprocess, rpeaks: rpeaks, toLeads: toLeads } };
  }

  var API = { makeOrtAnalyzer: makeOrtAnalyzer, preprocess: preprocess, rpeaks: rpeaks, LEAD_ORDER: LEAD_ORDER };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_ORT = API;
})();
