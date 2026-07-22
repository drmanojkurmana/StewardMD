/* kardiox-digitize-learned.js — on-device LEARNED digitiser front-end (SMD_KARDIOX_DIGITIZE_LEARNED).
 *
 * Wraps the nnU-Net ECG-Digitiser ONNX (models.stewardmd.in/kardiox/digitiser/ecg_digitiser_m3_fp16.onnx;
 * 2D PlainConvUNet, 1-channel grayscale → 13-class segmentation = background + the 12 named leads;
 * patch 1024x1280; per-image ZScore norm; verified 99.999% faithful to PyTorch).
 *
 * Split of responsibilities (cross-platform, minimal native code):
 *   • NATIVE plugin (Swift/Kotlin, injected as `opts.segment`) = ONLY runs the model on the NPU
 *     (ONNX Runtime Mobile, CoreML EP on iOS / NNAPI EP on Android) and returns the per-pixel argmax
 *     label map (Uint8[H*W]) — the 68 MB logits never cross the JS bridge.
 *   • THIS module (pure JS, one implementation for both platforms) = preprocessing (grayscale → resize to
 *     1024x1280 → z-score) and post-processing (segmentation label map → per-lead pixel traces).
 *
 * The pure core (resize / zscore / labelMapToLeadTraces) is DOM-free and unit-testable. mV calibration +
 * per-layout time-axis mapping (porting ECG-Digitiser's postprocessing) feed the existing reconstruction
 * layer and are wired in the next increment.
 */
(function () {
  "use strict";

  var PATCH_H = 1024, PATCH_W = 1280;                 // nnU-Net 2d patch [H, W]
  // class index → lead (from the model's dataset.json labels); 0 = background
  var LABELS = ["background", "I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
  var HOST = "https://models.stewardmd.in/kardiox/digitiser";
  var MODEL_FILE = "ecg_digitiser_m3_fp16.onnx";

  // RGBA/gray pixels → flat Float32 grayscale [srcH*srcW] (0..255).
  function toGray(img) {
    var W = img.width | 0, H = img.height | 0, d = img.data, N = W * H, g = new Float32Array(N), i;
    if (d.length === N * 4) { for (i = 0; i < N; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000; }
    else if (d.length === N) { for (i = 0; i < N; i++) g[i] = d[i]; }
    else throw new Error("bad pixel buffer: " + d.length + " for " + W + "x" + H);
    return { W: W, H: H, g: g };
  }

  // Bilinear resize of a grayscale plane to (PATCH_W x PATCH_H).
  function resizeGray(g, sW, sH, dW, dH) {
    var out = new Float32Array(dW * dH), sx = sW / dW, sy = sH / dH, x, y;
    for (y = 0; y < dH; y++) {
      var fy = (y + 0.5) * sy - 0.5; if (fy < 0) fy = 0; if (fy > sH - 1) fy = sH - 1;
      var y0 = Math.floor(fy), y1 = Math.min(y0 + 1, sH - 1), wy = fy - y0;
      for (x = 0; x < dW; x++) {
        var fx = (x + 0.5) * sx - 0.5; if (fx < 0) fx = 0; if (fx > sW - 1) fx = sW - 1;
        var x0 = Math.floor(fx), x1 = Math.min(x0 + 1, sW - 1), wx = fx - x0;
        var a = g[y0 * sW + x0], b = g[y0 * sW + x1], c = g[y1 * sW + x0], e = g[y1 * sW + x1];
        out[y * dW + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + e * wx) * wy;
      }
    }
    return out;
  }

  // image → model input tensor {data:Float32[1*1*H*W], dims:[1,1,H,W]} (resize + per-image z-score).
  function preprocess(img) {
    var gi = toGray(img), r = resizeGray(gi.g, gi.W, gi.H, PATCH_W, PATCH_H), N = PATCH_W * PATCH_H, i;
    var mean = 0; for (i = 0; i < N; i++) mean += r[i]; mean /= N;
    var v = 0; for (i = 0; i < N; i++) { var d = r[i] - mean; v += d * d; } var sd = Math.sqrt(v / N) || 1e-8;
    for (i = 0; i < N; i++) r[i] = (r[i] - mean) / sd;
    return { data: r, dims: [1, 1, PATCH_H, PATCH_W] };
  }

  // Segmentation label map (Uint8[H*W], values 0..12) → per-lead pixel traces. For each lead class the
  // trace is the ink CENTRE-LINE (column centroid of that lead's pixels) across the columns it occupies —
  // robust to overlap/grid because the model already assigned each pixel to a specific lead.
  function labelMapToLeadTraces(labelMap, W, H) {
    var leads = {};
    for (var c = 1; c <= 12; c++) {
      var name = LABELS[c], sum = new Float64Array(W), cnt = new Int32Array(W), xmin = -1, xmax = -1, tot = 0, x, y;
      for (y = 0; y < H; y++) { var row = y * W; for (x = 0; x < W; x++) { if (labelMap[row + x] === c) { sum[x] += y; cnt[x]++; tot++; if (xmin < 0) xmin = x; if (x > xmax) xmax = x; if (x < xmin) xmin = x; } } }
      if (tot < W * 0.01 || xmax < 0) { leads[name] = { present: false }; continue; }
      var w = xmax - xmin + 1, trace = new Float64Array(w), lastV = NaN, j;
      for (j = 0; j < w; j++) { var cx = xmin + j; trace[j] = cnt[cx] ? (sum[cx] / cnt[cx]) : NaN; }
      // interpolate small gaps
      var lastI = -1; for (j = 0; j < w; j++) { if (!isNaN(trace[j])) { if (lastI >= 0 && j - lastI > 1) { var span = j - lastI; for (var k = lastI + 1; k < j; k++) trace[k] = lastV + (trace[j] - lastV) * (k - lastI) / span; } lastI = j; lastV = trace[j]; } }
      for (j = 0; j < w && isNaN(trace[j]); j++) trace[j] = lastV; if (lastI >= 0) for (j = lastI + 1; j < w; j++) if (isNaN(trace[j])) trace[j] = lastV;
      leads[name] = { present: true, trace: trace, xRange: [xmin, xmax], pixels: tot, widthFrac: w / W };
    }
    return leads;
  }

  // image + injected native segmenter → per-lead traces. `segment(float32, dims) -> Promise<Uint8[H*W]>`.
  function digitize(img, opts) {
    opts = opts || {}; var seg = opts.segment;
    if (typeof seg !== "function") return Promise.reject(new Error("no native segment() runner provided"));
    var pre = preprocess(img);
    return Promise.resolve(seg(pre.data, pre.dims)).then(function (labelMap) {
      if (!labelMap || labelMap.length !== PATCH_W * PATCH_H) throw new Error("segment() must return a Uint8 label map of length " + (PATCH_W * PATCH_H));
      return { leads: labelMapToLeadTraces(labelMap, PATCH_W, PATCH_H), patch: { W: PATCH_W, H: PATCH_H }, source: gi_src(img), method: "learned-nnunet-onnx" };
    });
  }
  function gi_src(img) { return { width: img.width, height: img.height }; }

  // ── native bridge (iOS Core ML plugin) ──────────────────────────────────────────────────────────
  function plugin() { try { return (typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.EcgDigitiser) || null; } catch (e) { return null; } }
  function available() { return !!plugin(); }
  function b64ToU8(b64) { var bin = (typeof atob !== "undefined") ? atob(b64) : Buffer.from(b64, "base64").toString("binary"); var u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function blobToB64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onloadend = function () { res(String(r.result)); }; r.onerror = rej; r.readAsDataURL(blob); }); }

  // Is the model downloaded on-device yet?
  function modelReady() {
    var P = plugin(); if (!P || !P.available) return Promise.resolve(false);
    return Promise.resolve(P.available()).then(function (r) { return !!(r && r.ready); }).catch(function () { return false; });
  }
  // Download the .mlpackage (3 files) to the app's Documents on first use → returns { path, ready }.
  function prepare() {
    var P = plugin(); if (!P || !P.prepare) return Promise.reject(new Error("EcgDigitiser plugin not available"));
    return Promise.resolve(P.prepare({ baseUrl: HOST + "/mlpkg" }));
  }

  // Run the on-device Core ML segmenter on an image blob → { labelMap:Uint8, W, H }. `modelPath` = the
  // downloaded .mlpackage path (from prepare()); required (the model is NOT bundled).
  function segmentBlob(blob, modelPath) {
    var P = plugin(); if (!P) return Promise.reject(new Error("EcgDigitiser plugin not available"));
    if (!modelPath) return Promise.reject(new Error("model not prepared (call prepare() first)"));
    return blobToB64(blob).then(function (b64) {
      return P.segment({ base64Image: b64, modelPath: modelPath });
    }).then(function (r) {
      if (!r || !r.labelMap) throw new Error("segment returned no labelMap");
      return { labelMap: b64ToU8(r.labelMap), W: r.width || PATCH_W, H: r.height || PATCH_H };
    });
  }

  // Honest segmentation summary — proves the model ran + segmented (before the full signal postproc).
  function summarize(leadTraces) {
    var names = [], strip = false;
    for (var c = 1; c <= 12; c++) { var L = leadTraces[LABELS[c]]; if (L && L.present) { names.push(LABELS[c]); if (L.widthFrac > 0.8) strip = true; } }
    return { leadsDetected: names.length, leads: names, hasRhythmStrip: strip };
  }

  var API = { preprocess: preprocess, labelMapToLeadTraces: labelMapToLeadTraces, digitize: digitize,
              available: available, modelReady: modelReady, prepare: prepare, segmentBlob: segmentBlob, summarize: summarize,
              LABELS: LABELS, PATCH_H: PATCH_H, PATCH_W: PATCH_W, HOST: HOST, MODEL_FILE: MODEL_FILE,
              _diag: { toGray: toGray, resizeGray: resizeGray } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_DIGITIZE_LEARNED = API;
})();
