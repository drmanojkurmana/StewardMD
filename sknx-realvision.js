// sknx-realvision.js — SknX EXPERIMENTAL on-device image classifier (ONNX Runtime Web / WASM).
//
// A real-inference stand-in for the not-yet-sourced production model: runs a public HAM10000
// dermatology classifier (MobileNetV3, 7-class) INSIDE the Capacitor WebView via the vendored
// onnxruntime-web (/vendor/onnxruntime-web), so a captured photo produces a REAL classification that
// feeds the real SknX guardrail. Mirrors thorex-ort.js's ORT-Web loading and REUSES
// SMD_THOREX_MODEL_CACHE (download-once, then fully offline). Exposes the SAME shape as the native
// SMD_SKNX_VISION plugin ({available(), analyze(image)}), so sknx-providers.js can swap it in.
//
// EXPERIMENTAL / UNCALIBRATED: this public model is NOT validated for clinical use (it mislabels and
// misses cancers - see the guardrail; the guardrail is what makes a miss route to referral, not this
// model). Flag-gated (smd_sknx_realvision, def:false); on ANY failure the provider falls back to the
// mock. Every raw it emits is tagged engine:"realvision-experimental" so the UI can badge it.
//
// The model is fetched from a CONFIGURABLE URL (host it on stewardmd.in / R2, per the ThoreX pattern);
// default "/models/sknx/derm-mnv3-ham10000.onnx". Class order + preprocessing come from the model's
// clarity/class_info.json (ImageNet norm, 224x224, softmax over akiec,bcc,bkl,df,mel,nv,vasc).
(function () {
  "use strict";

  var SIZE = 224;
  var MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225]; // ImageNet (MobileNetV3 default)
  var ORT_BASE_DEFAULT = "/vendor/onnxruntime-web";
  var DEFAULT_MODEL_URL = "https://models.stewardmd.in/sknx/derm-mnv3-ham10000.onnx"; // absolute so it resolves inside the native WebView (Android/iOS), not just the web origin

  // HAM10000 class order (alphabetical, from the model's class_info.json) -> SknX engine label. The
  // malignant ones (BCC, melanoma) map to the exact strings sknx-engines.js's guardrail recognizes.
  var CLASSES = [
    { ham: "Actinic keratosis",    sknx: "actinic keratosis" }, // 0 akiec
    { ham: "Basal cell carcinoma", sknx: "BCC" },               // 1 bcc
    { ham: "Benign keratosis",     sknx: "benign keratosis" },  // 2 bkl
    { ham: "Dermatofibroma",       sknx: "dermatofibroma" },    // 3 df
    { ham: "Melanoma",             sknx: "melanoma" },          // 4 mel
    { ham: "Melanocytic nevi",     sknx: "nevus" },             // 5 nv
    { ham: "Vascular lesion",      sknx: "vascular lesion" }    // 6 vasc
  ];

  function modelUrl() {
    try {
      if (typeof window !== "undefined") {
        if (window.SMD_SKNX_REALVISION_MODEL_URL) return window.SMD_SKNX_REALVISION_MODEL_URL;
        var ls = null; try { ls = localStorage.getItem("sknx_realvision_model_url"); } catch (e) {}
        if (ls) return ls;
      }
    } catch (e) {}
    return DEFAULT_MODEL_URL;
  }

  function softmax(a) {
    var m = -Infinity, i;
    for (i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    var e = [], s = 0;
    for (i = 0; i < a.length; i++) { var v = Math.exp(a[i] - m); e.push(v); s += v; }
    for (i = 0; i < e.length; i++) e[i] = e[i] / (s || 1);
    return e;
  }
  // Model output may be raw logits or already-softmaxed probs; normalize to probabilities either way.
  function toProbs(a) {
    var s = 0, ok = true, i;
    for (i = 0; i < a.length; i++) { if (a[i] < 0 || a[i] > 1.001) ok = false; s += a[i]; }
    return (ok && Math.abs(s - 1) < 0.05) ? a.slice() : softmax(a);
  }

  // rgba (Uint8/Uint8Clamped [SIZE*SIZE*4]) -> Float32 NCHW [1,3,SIZE,SIZE], ImageNet-normalized. Pure.
  function rgbaToTensorData(rgba) {
    var plane = SIZE * SIZE, out = new Float32Array(3 * plane);
    for (var i = 0, p = 0; p < plane; i += 4, p++) {
      out[p]             = (rgba[i]     / 255 - MEAN[0]) / STD[0];
      out[plane + p]     = (rgba[i + 1] / 255 - MEAN[1]) / STD[1];
      out[2 * plane + p] = (rgba[i + 2] / 255 - MEAN[2]) / STD[2];
    }
    return out;
  }

  // 7-class probs -> SknX raw {generalProbs, lesionProbs, features, engine}. Both engines are fed the
  // real classifier output; the malignancy guardrail reads lesionProbs at v2beta.
  function mapProbsToRaw(probs) {
    var mapped = [];
    for (var i = 0; i < CLASSES.length; i++) mapped.push({ label: CLASSES[i].sknx, prob: (probs && probs[i]) || 0 });
    return { generalProbs: mapped.slice(), lesionProbs: mapped.slice(), features: {}, engine: "realvision-experimental" };
  }

  // ── ONNX Runtime Web lazy-load (mirrors thorex-ort.js loadOrtWeb) ──
  function loadOrt(base) {
    base = (base || ORT_BASE_DEFAULT).replace(/\/$/, "");
    function cfg() { try { var o = window.ort; o.env.wasm.wasmPaths = base + "/"; o.env.wasm.numThreads = 1; o.env.wasm.simd = true; } catch (e) {} return window.ort; }
    if (typeof window !== "undefined" && window.ort) return Promise.resolve(cfg());
    if (typeof document === "undefined") return Promise.reject(new Error("ort_needs_dom"));
    return new Promise(function (res, rej) {
      var ex = document.getElementById("smd-sknx-ort-web");
      if (ex) { if (window.ort) return res(cfg()); ex.addEventListener("load", function () { res(cfg()); }); ex.addEventListener("error", function () { rej(new Error("ort_load_failed")); }); return; }
      var s = document.createElement("script"); s.id = "smd-sknx-ort-web"; s.async = true; s.src = base + "/ort.wasm.min.js";
      s.onload = function () { res(cfg()); };
      s.onerror = function () { rej(new Error("ort_load_failed")); };
      document.head.appendChild(s);
    });
  }

  function modelCache() {
    try {
      if (typeof window !== "undefined" && window.SMD_THOREX_MODEL_CACHE) return window.SMD_THOREX_MODEL_CACHE;
      if (typeof require !== "undefined") return require("./thorex-model-cache.js");
    } catch (e) {}
    return null;
  }

  // Session is cached per process/WebView so the model is only compiled once.
  var _sessionP = null;
  function getSession(ort) {
    if (_sessionP) return _sessionP;
    var url = modelUrl(), mc = modelCache();
    var bytesP = (mc && mc.loadModelBytes) ? Promise.resolve(mc.loadModelBytes(url)) : Promise.reject(new Error("no_model_cache"));
    _sessionP = bytesP.then(function (bytes) { return ort.InferenceSession.create(new Uint8Array(bytes)); });
    _sessionP.catch(function () { _sessionP = null; }); // let a failed load be retried next time
    return _sessionP;
  }

  // Decode a captured image (Blob/File, dataURL string, or <img>) to 224x224 RGBA via canvas. DOM-only;
  // injected in node tests. Never mutates the source.
  function decodeToRGBA(image) {
    return new Promise(function (resolve, reject) {
      if (typeof document === "undefined") { reject(new Error("decode_needs_dom")); return; }
      function draw(src) {
        try {
          var c = document.createElement("canvas"); c.width = SIZE; c.height = SIZE;
          var ctx = c.getContext("2d"); ctx.drawImage(src, 0, 0, SIZE, SIZE);
          resolve(ctx.getImageData(0, 0, SIZE, SIZE).data);
        } catch (e) { reject(e); }
      }
      try {
        if (image && image.nodeName === "IMG") { return draw(image); }
        if (typeof image === "string") { var im = new Image(); im.onload = function () { draw(im); }; im.onerror = function () { reject(new Error("img_load")); }; im.src = image; return; }
        if (typeof Blob !== "undefined" && image instanceof Blob) {
          var url = URL.createObjectURL(image), im2 = new Image();
          im2.onload = function () { draw(im2); try { URL.revokeObjectURL(url); } catch (e) {} };
          im2.onerror = function () { reject(new Error("img_load")); };
          im2.src = url; return;
        }
        reject(new Error("unsupported_image"));
      } catch (e) { reject(e); }
    });
  }

  // analyze(image, opts) -> Promise<raw>. opts.{ort, session, decode, ortBase} are injectable for tests
  // (and let a caller reuse an already-loaded runtime). Rejects on any failure so the provider's
  // .catch(mockRaw) falls back cleanly.
  function analyze(image, opts) {
    opts = opts || {};
    var decodeFn = opts.decode || decodeToRGBA;
    var ortP = opts.ort ? Promise.resolve(opts.ort) : loadOrt(opts.ortBase);
    return ortP.then(function (ort) {
      var sessP = opts.session ? Promise.resolve(opts.session) : getSession(ort);
      return Promise.all([sessP, Promise.resolve(decodeFn(image))]).then(function (r) {
        var session = r[0], rgba = r[1];
        var tensor = new ort.Tensor("float32", rgbaToTensorData(rgba), [1, 3, SIZE, SIZE]);
        var inName = (session.inputNames && session.inputNames[0]) || "input";
        var feeds = {}; feeds[inName] = tensor;
        return Promise.resolve(session.run(feeds)).then(function (out) {
          var outName = (session.outputNames && session.outputNames[0]) || Object.keys(out)[0];
          var logits = Array.prototype.slice.call(out[outName].data);
          return mapProbsToRaw(toProbs(logits));
        });
      });
    });
  }

  // available(): cheap sync gate the provider calls. True only in a DOM (WebView) with a model URL set.
  function available() { try { return typeof document !== "undefined" && !!modelUrl(); } catch (e) { return false; } }

  // warmup(): preload the runtime + model + session AHEAD of the first analyze (call when SknX opens),
  // so the classification itself is just inference (~50ms) instead of a ~10s cold download+init. The
  // download+session happen while the clinician is framing the photo. Idempotent (getSession caches),
  // fire-and-forget safe (never rejects).
  function warmup(opts) {
    opts = opts || {};
    if (typeof document === "undefined") return Promise.resolve(false);
    return loadOrt(opts.ortBase).then(function (ort) { return getSession(ort); }).then(function () { return true; }).catch(function () { return false; });
  }

  var API = {
    available: available, analyze: analyze, warmup: warmup,
    rgbaToTensorData: rgbaToTensorData, mapProbsToRaw: mapProbsToRaw, softmax: softmax, toProbs: toProbs,
    CLASSES: CLASSES, modelUrl: modelUrl, SIZE: SIZE
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_REALVISION = API;
})();
