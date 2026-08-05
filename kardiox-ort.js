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
  // Pan-Tompkins-style R-peak detector, hardened for DIGITISED strips (which carry baseline wander +
  // occasional edge/step artifacts from the trace centre-line). Two robustness fixes vs a textbook impl:
  //  (1) BASELINE REMOVAL — subtract a ~0.6s moving average before differentiating, so slow wander/steps
  //      don't create a dominant derivative spike that starves the QRS threshold (the "0 beats" bug).
  //  (2) PERCENTILE THRESHOLD — gate on 0.35×(95th-percentile of the integrated signal), not 0.3×max, so
  //      a single outlier spike can't raise the bar above the real QRS complexes.
  function rpeaks(lead, fs) {
    fs = fs || 500; lead = lead || []; var n = lead.length; if (n < fs) return { bpm: null, rrMs: [], regularity: "unknown" };
    var i, acc = 0;
    // (1) baseline removal via a causal ~0.6s moving average
    var bw = Math.max(1, Math.round(0.6 * fs)), y = new Float64Array(n);
    for (i = 0; i < n; i++) { acc += lead[i]; if (i >= bw) acc -= lead[i - bw]; y[i] = lead[i] - acc / Math.min(i + 1, bw); }
    // derivative² + 0.15s moving-window integration
    var d = new Float64Array(n);
    for (i = 2; i < n - 2; i++) { var g = (2 * y[i + 1] + y[i + 2] - y[i - 2] - 2 * y[i - 1]); d[i] = g * g; }
    var w = Math.round(0.15 * fs), integ = new Float64Array(n); acc = 0;
    for (i = 0; i < n; i++) { acc += d[i]; if (i >= w) acc -= d[i - w]; integ[i] = acc / w; }
    // (2) robust threshold from the 95th percentile of the integrated signal
    var srt = Array.prototype.slice.call(integ).sort(function (a, b) { return a - b; });
    var p95 = srt[Math.floor((n - 1) * 0.95)] || 0;
    if (p95 <= 0) return { bpm: null, rrMs: [], regularity: "unknown" };
    var thr = 0.35 * p95, minRR = Math.round(0.25 * fs), peaks = [], last = -minRR;
    for (i = 1; i < n - 1; i++) { if (integ[i] > thr && integ[i] >= integ[i - 1] && integ[i] > integ[i + 1] && (i - last) >= minRR) { peaks.push(i); last = i; } }
    if (peaks.length < 2) return { bpm: null, rrMs: [], regularity: "unknown" };
    var rr = []; for (i = 1; i < peaks.length; i++) rr.push((peaks[i] - peaks[i - 1]) * 1000 / fs);
    var sorted = rr.slice().sort(function (a, b) { return a - b; }), med = sorted[Math.floor(sorted.length / 2)];
    var bpm = med > 0 ? Math.round(60000 / med) : null;
    var s = SIG(); return { bpm: bpm, rrMs: rr, regularity: s ? s.regularity(rr) : "unknown" };
  }

  // Inline head manifest (the 7 EcgLib densenet1d121 binary classifiers). Used on-device so no
  // manifest.json round-trip is needed; mirrors the exported models/manifest.json verbatim.
  var DEFAULT_MANIFEST = {
    model: "ecglib", source: "ispras/EcgLib v1.1.0 (Apache-2.0)",
    input: { leads: 12, samples: 5000, fs_hz: 500, norm: "perlead_zscore", lead_order: LEAD_ORDER },
    source_weight: 0.6,
    heads: [
      { pathology: "AFIB", label: "Atrial fibrillation", severity: "urgent", file: "ecglib_AFIB.onnx", threshold: 0.5 },
      { pathology: "1AVB", label: "First-degree AV block", severity: "info", file: "ecglib_1AVB.onnx", threshold: 0.5 },
      { pathology: "SBRAD", label: "Sinus bradycardia", severity: "warn", file: "ecglib_SBRAD.onnx", threshold: 0.5 },
      { pathology: "STACH", label: "Sinus tachycardia", severity: "warn", file: "ecglib_STACH.onnx", threshold: 0.5 },
      { pathology: "PVC", label: "Premature ventricular complex", severity: "warn", file: "ecglib_PVC.onnx", threshold: 0.5 },
      { pathology: "CRBBB", label: "Complete RBBB", severity: "warn", file: "ecglib_CRBBB.onnx", threshold: 0.5 },
      { pathology: "IRBBB", label: "Incomplete RBBB", severity: "info", file: "ecglib_IRBBB.onnx", threshold: 0.5 }
    ]
  };

  // Lazily load onnxruntime-web (vendored, CPU/WASM) INSIDE the WebView, only when on-device inference
  // is actually invoked — so users who never run KardioX on-device pay no startup cost. Single-threaded
  // (capacitor scheme is not cross-origin-isolated → no SharedArrayBuffer); SIMD on. Sets window.ort.
  function loadOrtWeb(base) {
    base = (base || "/vendor/onnxruntime-web").replace(/\/$/, "");
    if (typeof window !== "undefined" && window.ort) return Promise.resolve(window.ort);
    if (typeof document === "undefined") return Promise.reject(err("runtime_unavailable", "onnxruntime-web needs a DOM", "rhythm"));
    function cfg() { try { var o = window.ort; o.env.wasm.wasmPaths = base + "/"; o.env.wasm.numThreads = 1; o.env.wasm.simd = true; } catch (e) {} return window.ort; }
    return new Promise(function (res, rej) {
      var ex = document.getElementById("smd-ort-web");
      if (ex) { if (window.ort) return res(cfg()); ex.addEventListener("load", function () { res(cfg()); }); ex.addEventListener("error", function () { rej(err("runtime_unavailable", "onnxruntime-web load failed", "rhythm")); }); return; }
      var s = document.createElement("script"); s.id = "smd-ort-web"; s.async = true; s.src = base + "/ort.wasm.min.js";
      s.onload = function () { res(cfg()); };
      s.onerror = function () { rej(err("runtime_unavailable", "failed to load onnxruntime-web from " + s.src, "rhythm")); };
      document.head.appendChild(s);
    });
  }

  function makeOrtAnalyzer(opts) {
    opts = opts || {};
    var ort = opts.ort || (typeof window !== "undefined" && window.ort) || null;
    var baseUrl = opts.baseUrl || "kardiox-models";
    var ortBase = opts.ortBase || "/vendor/onnxruntime-web";
    var fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    var digitize = opts.digitize || null;          // optional image→signal hook (ECG-Digitiser export)
    var modelManager = opts.modelManager || null;  // SMD_KARDIOX_MODELMGR → sessions from cached bytes
    var _manifest = opts.manifest || (modelManager ? DEFAULT_MANIFEST : null), _sessions = null;

    function resolve(file) { return baseUrl + "/" + String(file).split("/").pop(); }

    // A session per head: on-device → from the model-manager's cached bytes; else from a URL (web/node).
    function sessionFor(file) {
      if (modelManager) return Promise.resolve(modelManager.source(file)).then(function (src) {
        return src && src.bytes ? ort.InferenceSession.create(src.bytes) : ort.InferenceSession.create((src && src.url) || resolve(file));
      });
      return Promise.resolve(ort.InferenceSession.create(resolve(file)));
    }

    function loadRuntime() { return ort ? Promise.resolve() : loadOrtWeb(ortBase).then(function (o) { ort = o; }); }

    function ensure() {
      if (_sessions) return Promise.resolve();
      return loadRuntime().then(function () {
        if (!ort) throw err("runtime_unavailable", "ONNX Runtime not loaded", "rhythm");
        var manP = _manifest ? Promise.resolve(_manifest)
          : (fetchImpl ? Promise.resolve(fetchImpl(resolve("manifest.json"))).then(function (r) { return r.json(); })
            : Promise.reject(err("runtime_unavailable", "no manifest and no fetch", "rhythm")));
        return manP.then(function (man) {
          _manifest = man;
          var heads = (man.heads || []).filter(function (h) { return h.file; });
          // Load the ensemble heads SEQUENTIALLY, not with Promise.all (CR4): creating all ~7 ONNX
          // sessions at once briefly holds several models' decode buffers simultaneously, spiking peak
          // memory on a phone. One-at-a-time keeps the transient footprint to a single model; the sessions
          // are cached (reused across analyses) so this one-time load cost is paid once.
          // Build into a LOCAL dict and commit to _sessions ONLY after every head loads (R6): otherwise a
          // single head failure would leave a truthy, partial _sessions that the ensure() guard treats as
          // "loaded" forever - silently running a smaller ensemble (e.g. a missing AFIB head) for the rest
          // of the session. All-or-nothing: a rejection leaves _sessions null, so the next call retries
          // cleanly and we never run a clinically-incomplete ensemble without surfacing it.
          var loaded = {};
          return heads.reduce(function (chain, h) {
            return chain.then(function () { return sessionFor(h.file).then(function (s) { loaded[h.pathology] = s; }); });
          }, Promise.resolve()).then(function () { _sessions = loaded; });
        });
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
    // Median (baseline) of a numeric array.
    function mvMedian(a) { if (!a || !a.length) return 0; var s = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
    // Net QRS deflection (dominant positive + negative excursion vs baseline). A RATIO of two such nets
    // (I vs aVF) gives axis quadrant and is GAIN-INDEPENDENT — so it survives the classical digitiser's
    // amplitude error, unlike absolute ST millivolts.
    function netQrs(mv) {
      if (!mv || mv.length < 5) return null;
      var base = mvMedian(mv), up = 0, dn = 0;
      for (var i = 0; i < mv.length; i++) { var d = mv[i] - base; if (d > up) up = d; if (d < dn) dn = d; }
      return up + dn;
    }
    // Rhythm read-out from the continuous lead-II strip (TIMING only — reliable regardless of amplitude).
    // Plausibility-gated: a digitised paper strip whose R-peak detection yields an implausible rate
    // (< 30 or > 180 bpm) or too few clean beats is a digitisation ARTIFACT (grid/noise → false peaks) —
    // we DEFER rather than report a false tachycardia / AF. { unreliable:true } → honest "unclear".
    function rhythmReadout(rp) {
      if (rp.bpm == null) return null;
      var rr = rp.rrMs || [];
      if (rp.bpm < 30 || rp.bpm > 180 || rr.length < 4) return { unreliable: true };
      var bpm = rp.bpm, reg = rp.regularity, v, sev = "info", detail;
      // A DIGITISED photo strip is too unreliable to CONFIRM AF: digitisation noise mimics irregular R-R,
      // so a regular ECG can read as "irregular". Report the observation + explicitly defer AF to the
      // clinician's read of the original trace — NEVER a confident/urgent AF from a photo.
      if (reg === "irregular") { v = "Irregular R-R, ~" + bpm + " bpm — rhythm not confirmable from a photo (read the trace)"; sev = "info"; detail = "R-R appeared irregular on the digitised strip, but digitisation noise can mimic irregularity — atrial fibrillation cannot be confirmed from an image; confirm the rhythm on the original ECG."; }
      else if (bpm < 50) { v = "Marked bradycardia, ~" + bpm + " bpm"; sev = "warn"; }
      else if (bpm < 60) { v = "Bradycardia, ~" + bpm + " bpm"; sev = "info"; }
      else if (bpm > 120) { v = "Tachycardia, ~" + bpm + " bpm"; sev = "warn"; }
      else if (bpm > 100) { v = "Mild tachycardia, ~" + bpm + " bpm"; sev = "info"; }
      else { v = "Regular rhythm, ~" + bpm + " bpm"; sev = "info"; }
      return { verdict: v, severity: sev, detail: detail || ((reg === "regular" ? "Regular" : "Measured") + " R-R on the lead-II strip, " + bpm + " bpm."), bpm: bpm, regularity: reg };
    }

    function safePartial(recon, digitized, onStage) {
      var models = MODELS(), R = RECON(), SIGe = SIG();
      var rp = { bpm: null, rrMs: [], regularity: "unknown" };
      var strip = R && R.rhythmLeadSignal ? R.rhythmLeadSignal(recon) : null;
      if (strip) rp = rpeaks(strip, recon.fs);      // rate/rhythm from the continuous 10s strip only
      var rhy = rhythmReadout(rp);
      try { console.log("KXDBG rpeaks: rhythmLead", recon.rhythmLead, "| strip samples", strip ? strip.length : 0, "| bpm", rp.bpm, "| beats~", rp.rrMs ? rp.rrMs.length + 1 : 0, "| reg", rp.regularity, "| unreliable", !!(rhy && rhy.unreliable)); } catch (_) {}

      // Axis from the limb-lead cells (gain-independent). Advisory — the ONLY morphology we trust from a
      // classical digitiser; ST-segment / QRS-width / conduction are NOT computed (amplitude + delineation
      // are unreliable → a false STEMI is the worst failure, so those stay deferred, not guessed).
      var dl = (digitized && digitized.leads) || {};
      var axisDeg = null, axisCat = null;
      var netI = dl.I && dl.I.mv ? netQrs(dl.I.mv) : null, netAvf = dl.aVF && dl.aVF.mv ? netQrs(dl.aVF.mv) : null;
      if (netI != null && netAvf != null && SIGe && SIGe.axisDegrees) {
        axisDeg = SIGe.axisDegrees(netI, netAvf);
        axisCat = SIGe.axisCategory ? SIGe.axisCategory(axisDeg) : null;
        if (!isFinite(axisDeg)) { axisDeg = null; axisCat = null; }
        // An "extreme"/indeterminate axis from a partial (2.5 s-cell) digitisation is far more likely a
        // digitisation artifact than a true northwest axis (clinically rare) → DEFER, don't assert it.
        else if (axisCat === "extreme" || axisCat === "unknown") { axisDeg = null; axisCat = null; }
      }

      var rhyOk = rhy && !rhy.unreliable, rhyUnclear = rhy && rhy.unreliable;
      var findings = [];
      if (rhyOk) findings.push({ id: "rhy0", title: rhy.verdict, detail: rhy.detail, matched: true, weight: rhy.severity === "warn" ? 0.5 : 0.3, severity: rhy.severity, evidence: [] });
      if (axisCat) findings.push({ id: "axis0", title: "QRS axis: " + axisCat + (axisDeg != null ? " (~" + Math.round(axisDeg) + "°)" : ""), detail: "From limb-lead net QRS direction (I vs aVF). Advisory — direction is gain-independent; confirm on the trace.", matched: true, weight: 0.2, severity: "info", evidence: [] });

      stage(onStage, "report", 100);
      var deferNote = "ST-segment, QRS-width and conduction (BBB) analysis were NOT computed: a " + recon.layout +
        " printout gives only ~2.5 s per lead and the digitiser recovers timing and shape but not calibration-grade amplitudes, so those would be unreliable (a full-disclosure 12x1 trace is required to run the 12-lead ensemble).";
      var verdict = rhyOk ? rhy.verdict : (rhyUnclear ? "Rhythm not reliably measurable from this image" : "Insufficient lead coverage for AI analysis");
      var raw = {
        id: (digitized && digitized.id) ? String(digitized.id) : "",
        verdict: verdict, severity: rhyOk ? rhy.severity : "info", confidence: recon.confidence.overall, engine: "ecglib-ensemble-1.1.0+reconstruct",
        measurements: { ventRateBpm: rhyOk ? rp.bpm : null, rhythm: rhyOk ? (rp.regularity === "irregular" ? "Irregular" : "Regular") : "-",
                        prMs: null, qrsMs: null, qtcMs: null, axisDeg: axisDeg != null ? Math.round(axisDeg) : null },
        findings: findings, differentials: [],
        clinicalInterpretation: "Layout " + recon.layout + " (partial): the 12-lead neural ensemble was NOT run (no continuous 10 s x 12). " +
          (rhyOk ? ("Rhythm from the lead-II strip: " + rhy.verdict.toLowerCase() + ". ")
            : rhyUnclear ? ("A rhythm strip is present but R-peak detection was unreliable (detected ~" + (rp.rrMs ? rp.rrMs.length + 1 : 0) + " beats" + (rp.bpm != null ? ", ~" + rp.bpm + " bpm" : "") + " — image quality / grid noise), so rate + rhythm are NOT reported — read the strip directly. ")
            : (strip ? "" : "No continuous rhythm strip. ")) +
          (axisCat ? ("Limb-lead QRS axis: " + axisCat + (axisDeg != null ? " (~" + Math.round(axisDeg) + "°)" : "") + ". ") : "") +
          deferNote + " Decision support only — clinician review required.",
        whatToVerify: [(recon.warnings || []).join(" "), "Rhythm read from lead II only; confirm P-waves + the full 12-lead. Morphology/ST NOT assessed — read the trace directly."].filter(Boolean).join(" "),
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

    // Release the cached ONNX sessions (onnxruntime-web InferenceSession.release) and reset so the next
    // ensure() reloads cleanly. Lets the provider cache free a superseded ensemble instead of holding it
    // resident for the whole app session (R6).
    function dispose() {
      try { if (_sessions) Object.keys(_sessions).forEach(function (k) { var s = _sessions[k]; try { if (s && typeof s.release === "function") s.release(); } catch (e) {} }); } catch (e) {}
      _sessions = null;
    }
    return { kind: "ecglib-ort", analyze: analyze, analyzePaper: analyzePaper, ensure: ensure, dispose: dispose,
             _diag: { preprocess: preprocess, rpeaks: rpeaks, toLeads: toLeads } };
  }

  var API = { makeOrtAnalyzer: makeOrtAnalyzer, loadOrtWeb: loadOrtWeb, DEFAULT_MANIFEST: DEFAULT_MANIFEST,
              preprocess: preprocess, rpeaks: rpeaks, LEAD_ORDER: LEAD_ORDER };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_ORT = API;
})();
