/* thorex-ort.js — ThoreX CXR AI · REAL on-device inference engine (SMD_THOREX_ORT).
 *
 * Runs the clinical TorchXRayVision-derived DenseNet121 ONNX export (probs [1,18] + CAM [1,18,7,7])
 * via ONNX Runtime Web (onnxruntime-web / WASM) INSIDE the Capacitor WebView — genuine per-image
 * inference, no cloud, no mock. Mirrors kardiox-ort.js: lazy-loads the vendored onnxruntime-web
 * INSIDE the WebView, single-threaded/SIMD-on (the capacitor:// scheme is not cross-origin-isolated,
 * so no SharedArrayBuffer/threads), `ort` + `fetch` + the model bytes are all injectable so a Node
 * harness can drive this with onnxruntime-node against the real model file.
 *
 * Preprocessing replicates the Python reference EXACTLY (backend/thorex/app/pipeline/preprocess.py,
 * which calls xrv.datasets.normalize + XRayCenterCrop + XRayResizer(224)):
 *   1) grayscale pixels 0..255
 *   2) xrv normalize:  (2*(px/255) - 1) * 1024                          [torchxrayvision.utils.normalize]
 *   3) center-crop to a square (crop_size = min(w,h); Python floor-div start offsets)
 *   4) resize to 224x224 (bilinear; a no-op when already 224x224 — this is what makes the on-device
 *      path bit-exact-comparable against a direct onnxruntime-node run of the same tensor in tests)
 *   -> Float32 tensor [1,1,224,224]
 *
 * CAM heatmap (top clinical finding only): cam[0,classIdx] (7x7, PRE-ReLU per the export wrapper's
 * "raw feature . classifier-weight 1x1 conv" CAM head) -> ReLU -> normalize 0..1 -> bilinear-upsample
 * to 224x224 -> colorize exactly like the backend's Grad-CAM overlay (backend/thorex/app/pipeline/
 * localize.py: red channel = norm*255, alpha = norm*180) -> base64 PNG (no data: prefix — matches
 * the `finding.heatmap` contract thorex-screens.js already renders via `data:image/png;base64,` + heatmap).
 * PNG encoding is pure JS (fflate's zlibSync for the IDAT stream + a small PNG/CRC writer) so it needs
 * no canvas — works in Node for verification and in the WebView alike.
 *
 * OD-D: EDUCATIONAL engine (X-Raydar, is512, 38 classes) now also runs fully on-device, via
 * `models/thorex_xraydar.onnx` (backend/thorex/scripts/export_xraydar_onnx.py). Its preprocessing is
 * X-Raydar's OWN native pipeline (backend/thorex/app/providers/xraydar_provider.py::_to_model_input),
 * independent of the clinical xrv pipeline above:
 *   1) grayscale pixels 0..255
 *   2) aspect-preserving pad to a square canvas (centered, black-fill — matches PIL's
 *      `ImageOps.pad(img, (side,side), color=0, centering=(0.5,0.5))`)
 *   3) resize to 512x512 (bilinear)
 *   4) scale to [0,1], then X-Raydar's own `Normalize(mean=0.491, std=0.271)`
 *   -> Float32 tensor [1,1,512,512]
 * (X-Raydar's internal second-stage `_transform_input` re-normalization is baked into the exported
 * ONNX graph itself — nothing extra needed on the JS side.) `analyzeImage(input, {includeEducational:
 * true})` runs BOTH engines off one grayscale decode and returns an analysis with clinical first,
 * educational second (`engine:"xraydar"`, `educational:true`, `disclaimer_key:"educational_not_clinical"`).
 * A CAM heatmap is attached to the top educational finding too (the export wrapper produces one), but
 * the code tolerates a `cam`-less educational model (heatmap simply omitted) since CAM was optional
 * for this engine per spec. Educational-engine failure NEVER drops the clinical result — mirrors the
 * backend orchestrator's asymmetric isolation (log + continue for the educational/adjunct engine;
 * only a clinical-engine failure propagates as a rejection).
 *
 * node + browser.
 */
(function () {
  "use strict";

  function MODELS() { return (typeof window !== "undefined" && window.SMD_THOREX_MODELS) || (typeof require !== "undefined" ? require("./thorex-models.js") : null); }
  function FFLATE() {
    if (typeof window !== "undefined" && window.fflate) return window.fflate;
    if (typeof require !== "undefined") { try { return require("fflate"); } catch (e) { return null; } }
    return null;
  }

  function err(code, message, stage) { var e = new Error(message); e.code = code; e.stage = stage || "analysis"; return e; }

  var MODEL_URL_DEFAULT = "/models/thorex_clinical.onnx";
  var LABELS_URL_DEFAULT = "/models/thorex_clinical_labels.json";
  var ORT_BASE_DEFAULT = "/vendor/onnxruntime-web";

  // OD-D: educational (X-Raydar) engine defaults — separate model, separate label set, separate
  // native input size (512, not 224). Configurable so a Node harness / different static host can
  // point elsewhere; sessions are cached per-URL (see getSession below) so switching URLs in tests
  // never reuses a stale session.
  var EDU_MODEL_URL_DEFAULT = "/models/thorex_xraydar.onnx";
  var EDU_LABELS_URL_DEFAULT = "/models/thorex_xraydar_labels.json";
  var EDU_INPUT_SIZE = 512;
  var EDU_NORM_MEAN = 0.491, EDU_NORM_STD = 0.271; // X-Raydar's own Normalize(mean, std)

  // One-line clinical relevance per finding label (ported verbatim from the reviewed backend copy,
  // backend/thorex/app/pipeline/labels.py — R1 content, not re-authored here). Labels not present in
  // that map (this model's label set differs slightly) fall back to the same generic line the backend
  // uses for unmapped labels.
  var RELEVANCE = {
    "Pneumonia": "Airspace opacity; correlate with fever, WBC, CRP/procalcitonin.",
    "Consolidation": "Dense airspace filling; infective vs haemorrhage vs infarct.",
    "Effusion": "Pleural fluid; assess size and layering.",
    "Pneumothorax": "Pleural air; urgent if large or tension physiology.",
    "Edema": "Interstitial/alveolar fluid; correlate with BNP, EF, fluid status.",
    "Atelectasis": "Volume loss; distinguish from consolidation.",
    "Cardiomegaly": "Enlarged cardiac silhouette (limited on AP/portable).",
    "Emphysema": "Hyperinflation/lucency.",
    "Fibrosis": "Reticular changes; chronicity.",
    "Nodule": "Focal <3cm; needs follow-up/prior comparison.",
    "Mass": "Focal >3cm; malignancy workup.",
    "Pleural_Thickening": "Chronic pleural change.",
    "Hernia": "Diaphragmatic/hiatal.",
    "Fracture": "Rib/clavicle if visible."
  };
  function relevanceFor(label) { return RELEVANCE[label] || "Correlate clinically."; }

  // Educational (X-Raydar) findings all carry the same "educational" relevance tag, matching the
  // convention already used by thorex-providers.js's mock xraydarEngine() and the canonical PNEUMONIA
  // sample in thorex-models.js (not a per-label clinical relevance line — this engine is learning-only).
  function eduRelevanceFor(label) { return "educational"; }

  // band -> severity (must be one of SMD_THOREX_MODELS.SEVERITIES; mirrors thorex-providers.js mock's
  // High->urgent / Medium->warn convention so on-device findings render with the same weight as the
  // mock/backend ones).
  function severityForBand(band) { return band === "High" ? "urgent" : band === "Medium" ? "warn" : "info"; }

  // ── xrv preprocessing (pure; testable without a DOM) ─────────────────────────────────────────────

  // torchxrayvision.utils.normalize(img, maxval=255): "scales images to be roughly [-1024, 1024]".
  function xrvNormalize(gray /* Float32Array, in place */) {
    for (var i = 0; i < gray.length; i++) gray[i] = (2 * (gray[i] / 255) - 1) * 1024;
    return gray;
  }

  // XRayCenterCrop: crop_size = min(h,w); start = dim//2 - crop_size//2 (Python floor division).
  function centerCropSquare(data, w, h) {
    var size = Math.min(w, h);
    var startX = Math.floor(w / 2) - Math.floor(size / 2);
    var startY = Math.floor(h / 2) - Math.floor(size / 2);
    var out = new Float32Array(size * size);
    for (var y = 0; y < size; y++) {
      var srcRow = (startY + y) * w + startX;
      for (var x = 0; x < size; x++) out[y * size + x] = data[srcRow + x];
    }
    return { data: out, size: size };
  }

  // General bilinear resize (src w,h -> dst w,h). No-op fast path when sizes match, which is what
  // makes an already-224x224 input bit-identical through this pipeline (used by the Node parity test).
  function bilinearResize(src, sw, sh, dw, dh) {
    if (sw === dw && sh === dh) return Float32Array.from(src);
    var dst = new Float32Array(dw * dh);
    var xRatio = sw / dw, yRatio = sh / dh;
    for (var oy = 0; oy < dh; oy++) {
      var iy = (oy + 0.5) * yRatio - 0.5; if (iy < 0) iy = 0; if (iy > sh - 1) iy = sh - 1;
      var y0 = Math.floor(iy), y1 = Math.min(y0 + 1, sh - 1), fy = iy - y0;
      for (var ox = 0; ox < dw; ox++) {
        var ix = (ox + 0.5) * xRatio - 0.5; if (ix < 0) ix = 0; if (ix > sw - 1) ix = sw - 1;
        var x0 = Math.floor(ix), x1 = Math.min(x0 + 1, sw - 1), fx = ix - x0;
        var v00 = src[y0 * sw + x0], v01 = src[y0 * sw + x1], v10 = src[y1 * sw + x0], v11 = src[y1 * sw + x1];
        var top = v00 + (v01 - v00) * fx, bot = v10 + (v11 - v10) * fx;
        dst[oy * dw + ox] = top + (bot - top) * fy;
      }
    }
    return dst;
  }

  // gray -> normalize -> center-crop -> resize(224) -> Float32Array[224*224], ready to wrap as [1,1,224,224].
  function preprocessToTensorData(gray /* {data,width,height} raw 0..255 intensities */) {
    var norm = Float32Array.from(gray.data);
    xrvNormalize(norm);
    var crop = centerCropSquare(norm, gray.width, gray.height);
    return bilinearResize(crop.data, crop.size, crop.size, 224, 224);
  }

  // ── X-Raydar (educational, OD-D) native is512 preprocessing ─────────────────────────────────────
  // Aspect-preserving pad to a square canvas, centered, black-fill — matches PIL's
  // ImageOps.pad(img, (side,side), color=0, centering=(0.5,0.5)) as used by
  // backend/thorex/app/providers/xraydar_provider.py::_pad_to_square. Since the target side is
  // exactly max(w,h), ImageOps.pad's internal "contain" resize is always a no-op scale=1 here — it
  // only pastes centered — so a plain centered zero-fill copy reproduces it exactly. PIL's centering
  // offset is `int((side - dim) * 0.5)`, which truncates toward zero; for non-negative operands that
  // is identical to `Math.floor`, so this is exact (not an approximation).
  function padToSquareGray(gray) {
    var w = gray.width, h = gray.height, side = Math.max(w, h);
    if (w === h) return { data: Float32Array.from(gray.data), size: w };
    var out = new Float32Array(side * side); // zero-fill == black, matches color=0
    var offX = Math.floor((side - w) / 2), offY = Math.floor((side - h) / 2);
    for (var y = 0; y < h; y++) {
      var srcRow = y * w, dstRow = (offY + y) * side + offX;
      for (var x = 0; x < w; x++) out[dstRow + x] = gray.data[srcRow + x];
    }
    return { data: out, size: side };
  }

  // scale to [0,1] then X-Raydar's own Normalize(mean=0.491, std=0.271). (The model's internal
  // second-stage `_transform_input` re-normalization is baked into the exported ONNX graph itself —
  // nothing further to replicate here.)
  function normalizeXraydar(vals /* Float32Array 0..255, in place */) {
    for (var i = 0; i < vals.length; i++) vals[i] = (vals[i] / 255 - EDU_NORM_MEAN) / EDU_NORM_STD;
    return vals;
  }

  // gray -> pad-to-square -> resize(512) -> normalize -> Float32Array[512*512], ready to wrap as
  // [1,1,512,512]. Mirrors preprocessToTensorData above but for X-Raydar's own native pipeline.
  function preprocessToTensorDataEdu(gray /* {data,width,height} raw 0..255 intensities */) {
    var padded = padToSquareGray(gray);
    var resized = bilinearResize(padded.data, padded.size, padded.size, EDU_INPUT_SIZE, EDU_INPUT_SIZE);
    return normalizeXraydar(resized);
  }

  // ── image decode: ImageData-like {width,height,data} (sync, test/Node-friendly) or Blob/dataURL
  //    (browser, via canvas). RGB(A) -> grayscale uses the same luma weights as PIL's convert("L"). ──
  function grayFromImageLike(imgLike) {
    var w = imgLike.width, h = imgLike.height, data = imgLike.data, n = w * h;
    var out = new Float32Array(n);
    if (data.length === n) { for (var i = 0; i < n; i++) out[i] = +data[i]; return { data: out, width: w, height: h }; }
    if (data.length === n * 4) { for (var j = 0, p = 0; j < n; j++, p += 4) out[j] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]; return { data: out, width: w, height: h }; }
    if (data.length === n * 3) { for (var k = 0, q = 0; k < n; k++, q += 3) out[k] = 0.299 * data[q] + 0.587 * data[q + 1] + 0.114 * data[q + 2]; return { data: out, width: w, height: h }; }
    throw err("bad_image", "image data length does not match width*height (or *3/*4 for RGB/RGBA)", "quality");
  }

  function decodeViaCanvas(source) {
    return new Promise(function (resolve, reject) {
      if (typeof document === "undefined") return reject(err("runtime_unavailable", "image decode needs a DOM (canvas); pass an ImageData-like {width,height,data} instead", "quality"));
      var img = new Image();
      var revoke = null;
      img.onload = function () {
        try {
          if (revoke) try { URL.revokeObjectURL(revoke); } catch (e) {}
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
          var id = ctx.getImageData(0, 0, w, h);
          resolve({ data: id.data, width: w, height: h });
        } catch (e) { reject(err("bad_image", "canvas decode failed: " + e.message, "quality")); }
      };
      img.onerror = function () { if (revoke) try { URL.revokeObjectURL(revoke); } catch (e) {} reject(err("bad_image", "image failed to load", "quality")); };
      if (typeof Blob !== "undefined" && source instanceof Blob) { revoke = URL.createObjectURL(source); img.src = revoke; }
      else img.src = source; // data URL string
    });
  }

  function toGrayscale(input) {
    if (input && typeof input === "object" && typeof input.width === "number" && typeof input.height === "number" && input.data) {
      try { return Promise.resolve(grayFromImageLike(input)); } catch (e) { return Promise.reject(e); }
    }
    if (typeof Blob !== "undefined" && input instanceof Blob) return decodeViaCanvas(input).then(grayFromImageLike);
    if (typeof input === "string" && /^data:/.test(input)) return decodeViaCanvas(input).then(grayFromImageLike);
    return Promise.reject(err("bad_image", "unsupported image input: need an ImageData-like {width,height,data}, a Blob, or a data URL", "quality"));
  }

  // ── CAM: ReLU -> normalize 0..1 -> bilinear upsample -> colorize (matches localize.py) -> PNG ──────
  function reluNormalizeCam(vals) {
    var n = vals.length, out = new Float32Array(n), i, v, min = Infinity, max = -Infinity;
    for (i = 0; i < n; i++) { v = vals[i]; v = v > 0 ? v : 0; out[i] = v; if (v < min) min = v; if (v > max) max = v; }
    var range = (max - min) || 1e-6;
    for (i = 0; i < n; i++) out[i] = (out[i] - min) / range;
    return out;
  }

  function colorizeCam(norm /* Float32Array 0..1, size*size */) {
    var n = norm.length, rgba = new Uint8Array(n * 4);
    for (var i = 0; i < n; i++) {
      var v = norm[i];
      rgba[i * 4] = Math.round(v * 255);       // red channel — matches localize.py's `h`
      rgba[i * 4 + 1] = 0;
      rgba[i * 4 + 2] = 0;
      rgba[i * 4 + 3] = Math.round(v * 180);   // alpha by intensity — matches localize.py
    }
    return rgba;
  }

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function u32be(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function pngChunk(type, data) {
    var typeBytes = new Uint8Array(4); for (var i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
    var body = new Uint8Array(typeBytes.length + data.length); body.set(typeBytes, 0); body.set(data, 4);
    var crc = crc32(body);
    var out = new Uint8Array(4 + body.length + 4);
    out.set(u32be(data.length), 0); out.set(body, 4); out.set(u32be(crc), 4 + body.length);
    return out;
  }
  // Minimal pure-JS PNG encoder (no canvas needed — works in Node for the verification harness and in
  // the WebView alike). IDAT is zlib-compressed (fflate.zlibSync, already vendored in this repo).
  function encodePngRGBA(rgba, w, h) {
    var fflate = FFLATE(); if (!fflate) throw err("runtime_unavailable", "fflate (zlib) not available for PNG encoding", "report");
    var stride = w * 4, raw = new Uint8Array(h * (1 + stride));
    for (var y = 0; y < h; y++) { raw[y * (1 + stride)] = 0; raw.set(rgba.subarray(y * stride, y * stride + stride), y * (1 + stride) + 1); }
    var idatData = fflate.zlibSync(raw, { level: 6 });
    var sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    var ihdrBody = new Uint8Array(13);
    var wB = u32be(w), hB = u32be(h);
    ihdrBody.set(wB, 0); ihdrBody.set(hB, 4); ihdrBody[8] = 8; ihdrBody[9] = 6; // 8-bit, RGBA
    var ihdr = pngChunk("IHDR", ihdrBody), idat = pngChunk("IDAT", idatData), iend = pngChunk("IEND", new Uint8Array(0));
    var out = new Uint8Array(sig.length + ihdr.length + idat.length + iend.length), off = 0;
    out.set(sig, off); off += sig.length; out.set(ihdr, off); off += ihdr.length; out.set(idat, off); off += idat.length; out.set(iend, off);
    return out;
  }
  function base64FromBytes(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    var CHUNK = 0x8000, s = "";
    for (var i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(s);
  }

  // camPlane (Float32Array length camH*camW, PRE-ReLU raw CAM logits for one class) -> base64 PNG
  // (RGBA, outSize x outSize). Generic over the CAM grid size so both the clinical engine's 7x7 CAM
  // and the educational (X-Raydar) engine's 14x14 CAM share this one implementation (DRY) — defaults
  // preserve the original clinical 7x7 -> 224x224 behavior when called with just one argument.
  function camToBase64Png(camPlane, camH, camW, outSize) {
    camH = camH || 7; camW = camW || 7; outSize = outSize || 224;
    var norm = reluNormalizeCam(camPlane);
    var up = bilinearResize(norm, camW, camH, outSize, outSize);
    var rgba = colorizeCam(up);
    return base64FromBytes(encodePngRGBA(rgba, outSize, outSize));
  }

  // ── ONNX Runtime Web loading (mirrors kardiox-ort.js exactly) ────────────────────────────────────
  function loadOrtWeb(base) {
    base = (base || ORT_BASE_DEFAULT).replace(/\/$/, "");
    if (typeof window !== "undefined" && window.ort) return Promise.resolve(window.ort);
    if (typeof document === "undefined") return Promise.reject(err("runtime_unavailable", "onnxruntime-web needs a DOM", "analysis"));
    function cfg() { try { var o = window.ort; o.env.wasm.wasmPaths = base + "/"; o.env.wasm.numThreads = 1; o.env.wasm.simd = true; } catch (e) {} return window.ort; }
    return new Promise(function (res, rej) {
      var ex = document.getElementById("smd-thorex-ort-web");
      if (ex) { if (window.ort) return res(cfg()); ex.addEventListener("load", function () { res(cfg()); }); ex.addEventListener("error", function () { rej(err("runtime_unavailable", "onnxruntime-web load failed", "analysis")); }); return; }
      var s = document.createElement("script"); s.id = "smd-thorex-ort-web"; s.async = true; s.src = base + "/ort.wasm.min.js";
      s.onload = function () { res(cfg()); };
      s.onerror = function () { rej(err("runtime_unavailable", "failed to load onnxruntime-web from " + s.src, "analysis")); };
      document.head.appendChild(s);
    });
  }

  // Per-(modelUrl, ort-instance) session cache — avoids reloading the model on every analyzeImage()
  // call, while still letting tests swap in a fresh injected `ort` without reusing a stale session.
  var _sessionCache = Object.create(null);
  function getSession(ort, modelUrl, modelBytes) {
    var key = modelBytes ? ("bytes:" + modelUrl) : modelUrl;
    var entry = _sessionCache[key];
    if (entry && entry.ort === ort) return entry.promise;
    var p = Promise.resolve(modelBytes ? ort.InferenceSession.create(modelBytes) : ort.InferenceSession.create(modelUrl));
    _sessionCache[key] = { ort: ort, promise: p };
    return p;
  }

  function loadLabels(fetchImpl, labelsUrl, injected) {
    if (injected) return Promise.resolve(injected);
    if (!fetchImpl) return Promise.reject(err("runtime_unavailable", "no labels array injected and no fetch available", "analysis"));
    return Promise.resolve(fetchImpl(labelsUrl)).then(function (r) { return r.json(); });
  }

  // Whether real on-device inference can plausibly be attempted in this environment (an injected ort,
  // or a DOM to lazy-load onnxruntime-web into, or onnxruntime-node resolvable for a Node harness).
  // This is a capability check, NOT a network/model-reachability probe.
  function available(opts) {
    opts = opts || {};
    var ort = opts.ort || (typeof window !== "undefined" && window.ort) || null;
    if (ort && ort.InferenceSession) return true;
    if (typeof window !== "undefined" && typeof document !== "undefined") return true;
    if (typeof require !== "undefined") { try { require.resolve("onnxruntime-node"); return true; } catch (e) {} }
    return false;
  }

  // Shared result-shaping: ranked probs -> banded findings (>= "Low" only) -> optional top-finding CAM
  // heatmap -> one engine-result object (raw payload shape, `disclaimer_key` snake_case as makeAnalysis
  // expects). Used by BOTH the clinical and educational paths below (DRY) — they differ only in the
  // engine name/relevance function/disclaimer/heatmap output size, all passed in via `meta`.
  function rankAndBuildFindings(probs, labelList, relevanceFn) {
    var ranked = [];
    for (var i = 0; i < probs.length; i++) ranked.push({ label: labelList[i] || ("class" + i), idx: i, prob: Number(probs[i]) });
    ranked.sort(function (a, b) { return b.prob - a.prob; });
    var models = MODELS();
    var findings = [];
    for (var f = 0; f < ranked.length; f++) {
      var band = models ? models.band(ranked[f].prob) : null;
      if (!band) continue;
      findings.push({ label: ranked[f].label, idx: ranked[f].idx, prob: ranked[f].prob, band: band, severity: severityForBand(band), relevance: relevanceFn(ranked[f].label) });
    }
    return { ranked: ranked, findings: findings };
  }

  function attachTopHeatmap(findings, probsLength, camT, heatmapOutSize) {
    if (!findings.length || !camT || !camT.data) return;
    var camDims = camT.dims || [1, probsLength, 7, 7];
    var nClasses = camDims[1], camH = camDims[2], camW = camDims[3], camPlane = camH * camW;
    if (nClasses !== probsLength) return;
    var top = findings[0], offset = top.idx * camPlane;
    try { top.heatmap = camToBase64Png(camT.data.slice(offset, offset + camPlane), camH, camW, heatmapOutSize); }
    catch (e) { /* heatmap is an adjunct; a failure here must not sink the findings */ }
  }

  function makeEngineResultRaw(meta, ranked, findings) {
    return {
      engine: meta.engineName,
      educational: !!meta.educational,
      findings: findings.map(function (fnd) { return { label: fnd.label, band: fnd.band, severity: fnd.severity, relevance: fnd.relevance, heatmap: fnd.heatmap }; }),
      disclaimer_key: meta.disclaimerKey || null
    };
  }

  // Runs the EDUCATIONAL (X-Raydar) engine off an already-decoded grayscale image. CAM is optional for
  // this engine (per spec) — only `probs` is required; a missing `cam` output simply omits the top
  // finding's heatmap rather than failing the engine.
  function runEducationalEngine(ort, gray, eduModelUrl, opts) {
    var eduLabelsUrl = opts.eduLabelsUrl || EDU_LABELS_URL_DEFAULT;
    var fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    return Promise.all([
      getSession(ort, eduModelUrl, opts.eduModelBytes),
      loadLabels(fetchImpl, eduLabelsUrl, opts.eduLabels)
    ]).then(function (r) {
      var session = r[0], labelList = r[1] || [];
      var tensorData = preprocessToTensorDataEdu(gray);
      var tensor = new ort.Tensor("float32", tensorData, [1, 1, EDU_INPUT_SIZE, EDU_INPUT_SIZE]);
      return Promise.resolve(session.run({ input: tensor })).then(function (out) {
        var probsT = out.probs;
        if (!probsT) throw err("bad_model", "educational model did not return a `probs` output", "analysis");
        var rb = rankAndBuildFindings(probsT.data, labelList, eduRelevanceFor);
        attachTopHeatmap(rb.findings, probsT.data.length, out.cam, EDU_INPUT_SIZE);
        return {
          ranked: rb.ranked,
          engineResult: makeEngineResultRaw({ engineName: "xraydar", educational: true, disclaimerKey: "educational_not_clinical" }, rb.ranked, rb.findings)
        };
      });
    });
  }

  // imageInput: ImageData-like {width,height,data}, Blob, or data-URL string.
  // opts: { ort, fetch, modelUrl, labelsUrl, labels, modelBytes, ortBase, id,
  //         includeEducational, eduModelUrl, eduLabelsUrl, eduLabels, eduModelBytes }
  // When opts.includeEducational is true, BOTH the clinical (torchxrayvision) and educational
  // (xraydar) engines run on-device off one grayscale decode; the returned analysis has clinical
  // first, educational second. An educational-engine failure is logged and the analysis still
  // resolves with the clinical engine only (asymmetric isolation, mirrors the backend orchestrator:
  // backend/thorex/app/pipeline/orchestrator.py logs+continues on an educational-provider RuntimeError
  // but re-raises a clinical-provider failure). A CLINICAL failure (decode/session/inference) still
  // rejects the whole promise, unchanged from before.
  function analyzeImage(imageInput, opts) {
    opts = opts || {};
    var ort = opts.ort || (typeof window !== "undefined" && window.ort) || null;
    var modelUrl = opts.modelUrl || MODEL_URL_DEFAULT;
    var labelsUrl = opts.labelsUrl || LABELS_URL_DEFAULT;
    var eduModelUrl = opts.eduModelUrl || EDU_MODEL_URL_DEFAULT;
    var ortBase = opts.ortBase || ORT_BASE_DEFAULT;
    var fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    var includeEducational = !!opts.includeEducational;

    function loadRuntime() { return ort ? Promise.resolve(ort) : loadOrtWeb(ortBase).then(function (o) { ort = o; return o; }); }

    return Promise.all([
      loadRuntime().then(function (o) { if (!o) throw err("runtime_unavailable", "ONNX Runtime not loaded", "analysis"); return getSession(o, modelUrl, opts.modelBytes); }),
      loadLabels(fetchImpl, labelsUrl, opts.labels),
      toGrayscale(imageInput)
    ]).then(function (r) {
      var session = r[0], labelList = r[1] || [], gray = r[2];
      var tensorData = preprocessToTensorData(gray);
      var tensor = new ort.Tensor("float32", tensorData, [1, 1, 224, 224]);
      return Promise.resolve(session.run({ input: tensor })).then(function (out) {
        var probsT = out.probs, camT = out.cam;
        if (!probsT || !camT) throw err("bad_model", "model did not return both `probs` and `cam` outputs", "analysis");
        var rb = rankAndBuildFindings(probsT.data, labelList, relevanceFor);
        attachTopHeatmap(rb.findings, probsT.data.length, camT, 224);
        var clinicalEngineResult = makeEngineResultRaw({ engineName: "torchxrayvision", educational: false, disclaimerKey: null }, rb.ranked, rb.findings);

        function finish(engines, eduRanked) {
          var models = MODELS();
          var raw = {
            id: opts.id != null ? String(opts.id) : undefined,
            engines: engines,
            disclaimer_key: "clinical_assist_disclaimer"
          };
          var analysis = models ? models.makeAnalysis(raw) : raw;
          analysis.engine = "torchxrayvision";
          analysis.probs = rb.ranked;   // diagnostic: full clinical ranked probability list (mirrors kardiox's headProbabilities)
          if (eduRanked) analysis.eduProbs = eduRanked; // diagnostic: full educational ranked probability list
          return analysis;
        }

        if (!includeEducational) return finish([clinicalEngineResult]);

        return runEducationalEngine(ort, gray, eduModelUrl, opts).then(
          function (edu) { return finish([clinicalEngineResult, edu.engineResult], edu.ranked); },
          function (eduErr) {
            // Educational (adjunct) engine failure must NEVER drop the clinical result — log and
            // continue clinical-only, mirroring the backend orchestrator's asymmetric isolation.
            try { if (typeof console !== "undefined" && console.warn) console.warn("[ThoreX] on-device educational (xraydar) engine failed; returning clinical-only.", eduErr && eduErr.message); } catch (e) {}
            return finish([clinicalEngineResult]);
          }
        );
      });
    });
  }

  var API = {
    available: available,
    analyzeImage: analyzeImage,
    loadOrtWeb: loadOrtWeb,
    MODEL_URL_DEFAULT: MODEL_URL_DEFAULT,
    LABELS_URL_DEFAULT: LABELS_URL_DEFAULT,
    EDU_MODEL_URL_DEFAULT: EDU_MODEL_URL_DEFAULT,
    EDU_LABELS_URL_DEFAULT: EDU_LABELS_URL_DEFAULT,
    _diag: {
      xrvNormalize: xrvNormalize,
      centerCropSquare: centerCropSquare,
      bilinearResize: bilinearResize,
      preprocessToTensorData: preprocessToTensorData,
      grayFromImageLike: grayFromImageLike,
      reluNormalizeCam: reluNormalizeCam,
      colorizeCam: colorizeCam,
      camToBase64Png: camToBase64Png,
      encodePngRGBA: encodePngRGBA,
      severityForBand: severityForBand,
      relevanceFor: relevanceFor,
      eduRelevanceFor: eduRelevanceFor,
      padToSquareGray: padToSquareGray,
      normalizeXraydar: normalizeXraydar,
      preprocessToTensorDataEdu: preprocessToTensorDataEdu,
      EDU_INPUT_SIZE: EDU_INPUT_SIZE
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_ORT = API;
})();
