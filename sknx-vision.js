// sknx-vision.js — bridge to the native capacitor-sknx-vision plugin (iOS Core ML, Neural Engine).
//
// EXPERIMENTAL native on-device classifier: gated by smd_sknx_realvision (same flag as the WASM path),
// used ONLY when that flag is on AND the native SknxVision plugin is present (i.e. an iOS build with the
// plugin compiled in). It downloads the .mlpackage on first use (native URLSession), classifies the
// captured photo on the Neural Engine, and maps the 7 HAM probs to the SknX engine raw shape - REUSING
// SMD_SKNX_REALVISION.mapProbsToRaw so the WASM and native paths share one mapping. Any failure -> the
// provider's .catch(mockRaw) falls back to the mock. The photo never leaves the device.
(function () {
  "use strict";

  // Base URL hosting the 3 .mlpackage files: <base>/Manifest.json,
  // <base>/Data/com.apple.CoreML/model.mlmodel, <base>/Data/com.apple.CoreML/weights/weight.bin
  var DEFAULT_MODEL_BASE = "https://models.stewardmd.in/sknx/derm-mnv3";

  function w() { return (typeof window !== "undefined") ? window : {}; }
  function cap(win) { win = win || w(); try { return (win.Capacitor && win.Capacitor.Plugins && win.Capacitor.Plugins.SknxVision) || null; } catch (e) { return null; } }
  function flagOn(win) { win = win || w(); try { return !!(win.SMD_SKNX_FLAGS && win.SMD_SKNX_FLAGS.bool("smd_sknx_realvision")); } catch (e) { return false; } }
  function modelBaseUrl(win) {
    win = win || w();
    try { if (win.SMD_SKNX_REALVISION_MODEL_BASE) return win.SMD_SKNX_REALVISION_MODEL_BASE; var ls = localStorage.getItem("sknx_realvision_model_base"); if (ls) return ls; } catch (e) {}
    return DEFAULT_MODEL_BASE;
  }

  // Native path is live ONLY with the experimental flag on AND the plugin compiled in.
  function available(win) { return flagOn(win) && !!cap(win); }

  // Captured image (Blob/File, or a dataURL/base64 string) -> raw base64 (no data: prefix) for the bridge.
  function toBase64(image) {
    if (typeof image === "string") { var i = image.indexOf("base64,"); return Promise.resolve(i >= 0 ? image.slice(i + 7) : image); }
    if (typeof Blob !== "undefined" && image instanceof Blob) {
      return new Promise(function (res, rej) {
        try {
          var fr = new FileReader();
          fr.onloadend = function () { var s = String(fr.result || ""); var k = s.indexOf("base64,"); res(k >= 0 ? s.slice(k + 7) : s); };
          fr.onerror = function () { rej(new Error("read_failed")); };
          fr.readAsDataURL(image);
        } catch (e) { rej(e); }
      });
    }
    return Promise.reject(new Error("unsupported_image"));
  }

  // Map the 7 HAM probs -> SknX raw. Reuse the WASM module's mapping (single source of truth); fall back
  // to an inline copy of the same akiec,bcc,bkl,df,mel,nv,vasc order if it is not loaded.
  function mapProbs(probs, win) {
    win = win || w();
    try { if (win.SMD_SKNX_REALVISION && win.SMD_SKNX_REALVISION.mapProbsToRaw) return win.SMD_SKNX_REALVISION.mapProbsToRaw(probs); } catch (e) {}
    var L = ["actinic keratosis", "BCC", "benign keratosis", "dermatofibroma", "melanoma", "nevus", "vascular lesion"];
    var m = L.map(function (lab, i) { return { label: lab, prob: (probs && probs[i]) || 0 }; });
    return { generalProbs: m.slice(), lesionProbs: m.slice(), features: {}, engine: "realvision-experimental" };
  }

  // Ensure the .mlpackage is downloaded (native), then return its model path.
  function ensureModel(p, win) {
    return Promise.resolve(p.available()).then(function (st) {
      if (st && st.ready) return st.path;
      return Promise.resolve(p.prepare({ baseUrl: modelBaseUrl(win) })).then(function (r) { return r && r.path; });
    });
  }

  // analyze(image[, win, deps]) -> Promise<raw>. deps.{plugin, modelPath, base64} injectable for tests.
  function analyze(image, win, deps) {
    deps = deps || {};
    var p = deps.plugin || cap(win);
    if (!p || !p.classify) return Promise.reject(new Error("plugin_unavailable"));
    return Promise.all([
      deps.modelPath != null ? Promise.resolve(deps.modelPath) : ensureModel(p, win),
      deps.base64 != null ? Promise.resolve(deps.base64) : toBase64(image)
    ]).then(function (r) {
      return Promise.resolve(p.classify({ base64Image: r[1], modelPath: r[0] }));
    }).then(function (out) {
      return mapProbs((out && out.probs) || [], win);
    });
  }

  var API = { available: available, analyze: analyze, mapProbs: mapProbs, modelBaseUrl: modelBaseUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_VISION = API;
})();
