// sknx-providers.js — screens talk ONLY to this seam. Mock in Phase 1; native plugin later.
(function () {
  "use strict";
  var STAGES = ["quality", "detect", "segment", "classify", "report"];
  var NULL_VISION = { available: function () { return false; }, analyze: function () { return Promise.reject(new Error("plugin_unavailable")); } };
  // Prefer, in order: an injected vision (tests) > the CLOUD Derm Foundation classifier (SMD_SKNX_CLOUDVISION,
  // gated on smd_sknx_cloud - the only engine spanning 59 general-derm conditions, so it wins when opted in)
  // > the native iOS Core ML plugin (SMD_SKNX_VISION, gated on smd_sknx_realvision + plugin present - Neural
  // Engine, fastest) > the EXPERIMENTAL WASM ONNX classifier (SMD_SKNX_REALVISION, flag on + available) >
  // nothing (-> mock). A real engine's failure surfaces an honest error (analyze() below), never the mock.
  function pickVision(injected) {
    if (injected && injected.vision) return injected.vision;
    try {
      if (typeof window !== "undefined" && window.SMD_SKNX_CLOUDVISION && window.SMD_SKNX_CLOUDVISION.available && window.SMD_SKNX_CLOUDVISION.available()) {
        return window.SMD_SKNX_CLOUDVISION;
      }
    } catch (e) {}
    try {
      if (typeof window !== "undefined" && window.SMD_SKNX_VISION && window.SMD_SKNX_VISION.available && window.SMD_SKNX_VISION.available()) {
        return window.SMD_SKNX_VISION;
      }
    } catch (e) {}
    try {
      if (typeof window !== "undefined" && window.SMD_SKNX_REALVISION && window.SMD_SKNX_FLAGS &&
          window.SMD_SKNX_FLAGS.bool("smd_sknx_realvision") && window.SMD_SKNX_REALVISION.available()) {
        return window.SMD_SKNX_REALVISION;
      }
    } catch (e) {}
    return NULL_VISION;
  }
  function deps(injected) {
    injected = injected || {};
    return {
      vision: pickVision(injected),
      engines: injected.engines || (typeof window !== "undefined" && window.SMD_SKNX_ENGINES) || (typeof require !== "undefined" ? require("./sknx-engines.js") : null)
    };
  }
  function historyApi() {
    try { return (typeof window !== "undefined" && window.SMD_SKNX_HISTORY) || (typeof require !== "undefined" ? require("./sknx-history.js") : null); } catch (e) { return null; }
  }
  function mockRaw(entitlement, image) {
    if (image && image.__mock === "melanoma") {
      return { generalProbs: [{ label: "benign keratosis", prob: 0.5 }], lesionProbs: [{ label: "melanoma", prob: 0.35 }, { label: "nevus", prob: 0.5 }], features: {} };
    }
    return { generalProbs: [{ label: "psoriasis", prob: 0.71 }, { label: "eczema", prob: 0.16 }], lesionProbs: [{ label: "nevus", prob: 0.92 }, { label: "melanoma", prob: 0.02 }], features: { diameterMm: 4 } };
  }
  function analyze(image, entitlement, onStage, injected, history) {
    var d = deps(injected);
    function stage(i) { try { if (onStage) onStage(STAGES[i], Math.round(((i + 1) / STAGES.length) * 100)); } catch (e) {} }
    stage(0); stage(1); stage(2);
    // The capture pipeline (sknx-screens runPipeline) wraps the captured Blob as { id, source, data: Blob }.
    // Every vision provider (cloud/WASM/native) expects the RAW Blob/dataURL, so unwrap .data here at the
    // single seam. Without this the provider rejects "unsupported_image" synchronously (the photo never
    // leaves the device). The mock still receives the original wrapper (it reads image.__mock).
    var visImg = (image && image.data && ((typeof Blob !== "undefined" && image.data instanceof Blob) || typeof image.data === "string")) ? image.data : image;
    var v = d.vision, rawP;
    if (v.available()) {
      // A REAL classifier is selected (native Core ML or WASM). Do NOT mask a failure with the canned
      // mock - showing fake data (e.g. "psoriasis") for a failed real analysis is worse than an honest
      // error. Surface + log it; the screen then shows "result unavailable, try again".
      rawP = Promise.resolve(v.analyze(visImg)).catch(function (err) {
        try { console.warn("[SknX] on-device analysis failed:", (err && err.message) || err); } catch (e) {}
        var e2 = new Error("analysis_failed"); e2.cause = err; throw e2;
      });
    } else {
      rawP = Promise.resolve(mockRaw(entitlement, image)); // no real vision configured -> dev/mock default
    }
    return rawP.then(function (raw) {
      stage(3);
      // Merge optional clinical-history danger-signs into features so the deterministic red-flag guardrail
      // fires regardless of engine (the cloud engine sends features:{}). No-op when history is absent.
      try {
        var hf = historyApi(); var extra = hf ? hf.historyToFeatures(history) : null;
        if (extra && Object.keys(extra).length) { raw.features = Object.assign({}, raw.features || {}, extra); }
      } catch (e) {}
      var a = d.engines.makeAnalysis(raw, entitlement);
      try { a.engine = (raw && raw.engine) || "mock"; } catch (e) {} // "realvision-experimental" | "mock" | plugin engine — for the UI badge
      stage(4);
      return a;
    });
  }
  // warmup(): preload the active real-vision engine (WASM or native) when SknX opens, so the first
  // analyze after a capture is just inference, not a ~10s cold download+init. No-op for the mock.
  function warmup(injected) {
    try {
      var v = pickVision(injected || {});
      if (v && typeof v.warmup === "function") return Promise.resolve(v.warmup()).catch(function () {});
    } catch (e) {}
    return Promise.resolve();
  }

  var API = { analyze: analyze, warmup: warmup, mockRaw: mockRaw, STAGES: STAGES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_PROVIDERS = API;
})();
