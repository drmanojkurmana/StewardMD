/* kardiox-ort-image.js — KardioX AI · ON-DEVICE image→diagnosis (SMD_KARDIOX_ORT_IMAGE).
 *
 * Runs the SAME efficientnet_b3 19-class model + MI-any specialist the cloud (kardiox-image/main.py)
 * runs, but ENTIRELY ON THE DEVICE via ONNX Runtime Web — the ECG photo NEVER leaves the phone
 * (DPDP: no PHI upload). Faithful JS port of main.py's preprocessing, temperature calibration, MI
 * fusion (elevate/veto) and verdict selection, so the on-device verdict == the cloud verdict.
 *
 * Models (weights, NOT PHI) are downloaded ONCE from the India model host and cached; inference is
 * then fully offline. Flag `smd_kardiox_ondevice_image` (default OFF until device-validated). The cloud
 * image analyzer stays as the fallback. window.SMD_KARDIOX_ORT_IMAGE. node(onnxruntime-node) + browser.
 */
(function () {
  "use strict";

  // ── serving contract — MUST match backend/kardiox-image/main.py exactly ──
  var CLASSES = ["NORM","AFIB","STACH","SBRAD","1AVB","CRBBB","IRBBB","CLBBB","LAFB","IMI","AMI","ASMI",
                 "LVH","ISC_","STTC","NDT","PVC","PAC","LAD"];
  var MAP = { NORM:["Normal ECG","stable"], AFIB:["Atrial fibrillation","urgent"], STACH:["Sinus tachycardia","warn"],
    SBRAD:["Sinus bradycardia","warn"], "1AVB":["First-degree AV block","info"], CRBBB:["Complete right bundle branch block","warn"],
    IRBBB:["Incomplete right bundle branch block","info"], CLBBB:["Complete left bundle branch block","warn"],
    LAFB:["Left anterior fascicular block","info"], IMI:["Inferior MI pattern","urgent"], AMI:["Anterior MI pattern","urgent"],
    ASMI:["Anteroseptal MI pattern","urgent"], LVH:["Left ventricular hypertrophy","warn"], ISC_:["Ischaemic changes","warn"],
    STTC:["ST-T changes","warn"], NDT:["Non-specific T-wave abnormality","info"], PVC:["Premature ventricular complexes","warn"],
    PAC:["Premature atrial complexes","info"], LAD:["Left axis deviation","info"] };
  var MI_CLASSES = ["IMI","AMI","ASMI"];
  var SUPPRESSED = { STTC:1, LAD:1 }, NOT_VERDICT = { SBRAD:1 };
  var TEMPERATURE = 1.781, VERDICT_THR = 0.55, FINDING_THR = 0.45, NORM_THR = 0.50, MI_THR = 0.50;
  var W_BASE = 0.90, W_MI = 0.945, _MI_AUROC = 0.986;
  var MODEL_BASE = "https://storage.googleapis.com/stewardmd-kardiox-models";   // India-hosted PUBLIC weights bucket (CORS-enabled; NOT PHI; separate from the private data bucket)

  function MODELS() { return (typeof window !== "undefined" && window.SMD_KARDIOX_MODELS) || (typeof require !== "undefined" ? require("./kardiox-models.js") : null); }
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  // Lazily load onnxruntime (vendored ort-web in the WebView; onnxruntime-node for Node tests).
  var _ort = null;
  function loadOrt() {
    if (_ort) return Promise.resolve(_ort);
    if (typeof window !== "undefined" && window.ort) { _ort = window.ort; return Promise.resolve(_ort); }
    if (typeof require !== "undefined") { try { _ort = require("onnxruntime-node"); return Promise.resolve(_ort); } catch (e) {} }
    if (typeof document === "undefined") return Promise.reject(new Error("onnxruntime unavailable"));
    return new Promise(function (res, rej) {
      var base = "/vendor/onnxruntime-web", s = document.createElement("script"); s.src = base + "/ort.wasm.min.js";
      s.onload = function () { _ort = window.ort; try { _ort.env.wasm.wasmPaths = base + "/"; _ort.env.wasm.numThreads = 1; _ort.env.wasm.simd = true; } catch (e) {} res(_ort); };
      s.onerror = function () { rej(new Error("onnxruntime-web load failed")); };
      document.head.appendChild(s);
    });
  }

  // ── preprocess: image → Float32 [1,3,320,320], (x/255 - 0.5)/0.5, CHW — matches PIL Resize+ToTensor+Normalize ──
  function toTensor320(rgb /* Uint8 RGBA or RGB length w*h*(4|3) */, w, h, chans) {
    var N = 320, out = new Float32Array(3 * N * N), st = chans || 4;
    for (var y = 0; y < N; y++) {
      var sy = Math.min(h - 1, (y * h / N) | 0);
      for (var x = 0; x < N; x++) {
        var sx = Math.min(w - 1, (x * w / N) | 0), i = (sy * w + sx) * st, o = y * N + x;
        out[o] = ((rgb[i] / 255) - 0.5) / 0.5;                 // R
        out[N * N + o] = ((rgb[i + 1] / 255) - 0.5) / 0.5;     // G
        out[2 * N * N + o] = ((rgb[i + 2] / 255) - 0.5) / 0.5; // B
      }
    }
    return out;
  }
  // Browser: Blob/HTMLImage → RGBA via canvas. (Node parity tests pass a raw {data,w,h,chans}.)
  function blobToTensor(blob) {
    return new Promise(function (res, rej) {
      try {
        var url = URL.createObjectURL(blob), img = new Image();
        img.onload = function () {
          try {
            var c = document.createElement("canvas"); c.width = 320; c.height = 320;
            var ctx = c.getContext("2d");
            // High-quality (antialiased/area) downscale to best match the cloud's torchvision Resize
            // (bilinear + antialias=True). Default canvas smoothing can alias on large ECG photos -> flips
            // borderline verdicts vs the server.
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, 320, 320);
            var d = ctx.getImageData(0, 0, 320, 320);
            URL.revokeObjectURL(url); res(toTensor320(d.data, 320, 320, 4));
          } catch (e) { rej(e); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("image decode failed")); };
        img.src = url;
      } catch (e) { rej(e); }
    });
  }

  // ── sessions (lazy, cached) ──
  var _sess = { ecg: null, mi: null }, _loading = null;
  function loadSessions(base) {
    if (_sess.ecg && _sess.mi) return Promise.resolve(_sess);
    if (_loading) return _loading;
    base = base || MODEL_BASE;
    _loading = loadOrt().then(function (O) {
      var opt = { executionProviders: ["wasm"] };
      return Promise.all([O.InferenceSession.create(base + "/ecg19.onnx", opt), O.InferenceSession.create(base + "/mi.onnx", opt)]);
    }).then(function (s) { _sess.ecg = s[0]; _sess.mi = s[1]; _loading = null; return _sess; })
      .catch(function (e) { _loading = null; throw e; });
    return _loading;
  }

  function run(sess, tensor) {
    var t = new _ort.Tensor("float32", tensor, [1, 3, 320, 320]);
    var feed = {}; feed[sess.inputNames[0]] = t;
    return sess.run(feed).then(function (o) { return o[sess.outputNames[0]].data; });
  }

  // ── the port of main.py analyze_image: fusion + verdict + analysis object ──
  function decide(logits19, logitMi) {
    var probs = {}, i;
    for (i = 0; i < CLASSES.length; i++) probs[CLASSES[i]] = sigmoid(logits19[i] / TEMPERATURE);
    var mi_p = sigmoid(logitMi[0]);
    var base_mi = Math.max(probs.IMI, probs.AMI, probs.ASMI);
    var mi_fused = (W_BASE * base_mi + W_MI * mi_p) / (W_BASE + W_MI);
    var mi_positive = mi_fused >= MI_THR;
    var mi_veto = mi_fused < FINDING_THR;
    function elig(c) { if (SUPPRESSED[c]) return false; if (MI_CLASSES.indexOf(c) >= 0 && mi_veto) return false; return true; }
    var ranked = CLASSES.map(function (c) { return [c, probs[c]]; }).filter(function (kv) { return elig(kv[0]); })
      .sort(function (a, b) { return b[1] - a[1]; });
    var norm_p = probs.NORM || 0;
    var abn = ranked.filter(function (kv) { return kv[0] !== "NORM" && !NOT_VERDICT[kv[0]] && kv[1] >= VERDICT_THR; });
    var top_c, top_p, label, severity, review;
    if (mi_positive) {
      top_c = MI_CLASSES.reduce(function (a, c) { return probs[c] > probs[a] ? c : a; }, MI_CLASSES[0]);
      top_p = mi_fused; label = MAP[top_c][0]; severity = "urgent"; review = true;
    } else if (abn.length) {
      top_c = abn[0][0]; top_p = abn[0][1]; label = MAP[top_c][0]; severity = MAP[top_c][1]; review = true;
    } else if (norm_p >= NORM_THR) {
      top_c = "NORM"; top_p = norm_p; label = "Normal ECG (screening - confirm clinically)"; severity = "stable"; review = false;
    } else {
      var r0 = ranked[0] || ["NORM", norm_p]; top_c = r0[0]; top_p = r0[1];
      label = "Inconclusive - physician review recommended"; severity = "warn"; review = true;
    }
    var findings = ranked.filter(function (kv) { return kv[0] !== "NORM" && kv[1] >= FINDING_THR; }).slice(0, 5)
      .map(function (kv, i) { return { id: "f" + i, title: MAP[kv[0]][0],
        detail: "possible - calibrated score " + kv[1].toFixed(2) + "; confirm on 12-lead" + (NOT_VERDICT[kv[0]] ? " (rhythm output experimental)" : ""),
        matched: true, weight: Math.round(kv[1] * 100) / 100, severity: MAP[kv[0]][1] }; });
    findings.unshift({ id: "mi_any", title: "MI-any (specialist screen)",
      detail: "dedicated MI detector: fused score " + mi_fused.toFixed(2) + " (specialist " + mi_p.toFixed(2) + ", base " + base_mi.toFixed(2) + "; val AUROC ~" + _MI_AUROC + "). "
        + (mi_positive ? "POSITIVE - correlate clinically for infarction and confirm on 12-lead." : "below the MI threshold."),
      matched: !!mi_positive, weight: Math.round(mi_fused * 100) / 100, severity: mi_positive ? "urgent" : "info" });
    var diffs = ranked.filter(function (kv) { return kv[1] >= 0.15; }).slice(0, 6)
      .map(function (kv) { return { label: MAP[kv[0]][0], probability: Math.round(kv[1] * 1000) / 1000 }; });
    var lead = (mi_positive || abn.length) ? ("Most likely finding: " + MAP[top_c][0] + " (score " + Math.round(top_p * 100) + "%).") : (label + ".");
    var band = (top_p >= 0.8 && (mi_positive || abn.length)) ? "high" : (top_p >= 0.6 ? "medium" : "low");
    var M = MODELS();
    var raw = { engine: "kardiox-ondevice-efficientnetb3", verdict: label, severity: severity, confidence: top_p,
      confidenceBand: band, reviewRecommended: review, findings: findings, differentials: diffs,
      clinicalInterpretation: lead + " On-device screen; confirm on a 12-lead ECG.",
      miAny: { fused: Math.round(mi_fused * 1000) / 1000, specialist: Math.round(mi_p * 1000) / 1000, base: Math.round(base_mi * 1000) / 1000, positive: !!mi_positive, valAuroc: _MI_AUROC },
      whatToVerify: "On-device experimental screen. Confirm every finding on the original 12-lead ECG." };
    return M ? M.makeAnalysis(raw) : raw;
  }

  // Public: analyze an image (Blob or {data,w,h,chans}) fully on-device.
  function analyzeImage(image, onStage, opts) {
    opts = opts || {};
    function stage(s, p) { try { if (typeof onStage === "function") onStage(s, p); } catch (e) {} }
    stage("upload", 10);
    var blob = (image && image.data instanceof Blob) ? image.data : (image instanceof Blob ? image : null);
    var pre = blob ? blobToTensor(blob) : (image && image.data && image.w ? Promise.resolve(toTensor320(image.data, image.w, image.h, image.chans || 4)) : Promise.reject(new Error("no image")));
    return pre.then(function (tensor) {
      stage("enhancement", 40);
      return loadSessions(opts.modelBase).then(function (s) {
        stage("digitization", 70);
        return Promise.all([run(s.ecg, tensor), run(s.mi, tensor)]);
      }).then(function (out) { stage("signalExtraction", 95); var a = decide(out[0], out[1]); if (image && image.id) a.image = image; return a; });
    });
  }

  // ── Parity capture: run the REAL on-device path (canvas + ONNX + fusion) on the same image and
  // compare its verdict to the cloud verdict, accumulating a running agreement tally in localStorage.
  // This measures the ACTUAL canvas-vs-cloud parity on the device (the VM A/Bs cannot). ──
  function _norm(s) { return String(s == null ? "" : s).split("(")[0].trim().toLowerCase(); }
  function tally() { try { var t = JSON.parse(localStorage.getItem("smd_kardiox_parity_tally") || "{}"); return { agree: t.agree || 0, total: t.total || 0 }; } catch (e) { return { agree: 0, total: 0 }; } }
  function resetTally() { try { localStorage.removeItem("smd_kardiox_parity_tally"); } catch (e) {} }
  function captureParity(image, cloudVerdict) {
    return analyzeImage(image).then(function (od) {
      var odv = (od && od.verdict) || "";
      var agree = _norm(odv) === _norm(cloudVerdict);
      var t = tally(); t.total += 1; if (agree) t.agree += 1;
      try { localStorage.setItem("smd_kardiox_parity_tally", JSON.stringify(t)); } catch (e) {}
      var r = { onDevice: odv, cloud: cloudVerdict, agree: agree, tally: t, agreementPct: Math.round(100 * t.agree / Math.max(1, t.total)) };
      try { console.log("[KardiQ X parity] onDevice=%s | cloud=%s | agree=%s | running %d/%d (%d%%)", odv, cloudVerdict, agree, t.agree, t.total, r.agreementPct); } catch (e) {}
      return r;
    }).catch(function (e) { try { console.warn("[KardiQ X parity] on-device run failed:", e && e.message); } catch (_) {} return null; });
  }

  var API = { analyzeImage: analyzeImage, decide: decide, toTensor320: toTensor320, loadSessions: loadSessions, CLASSES: CLASSES,
              captureParity: captureParity, parityTally: tally, resetParityTally: resetTally };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_ORT_IMAGE = API;
})();
