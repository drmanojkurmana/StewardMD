// sknx-providers.js — screens talk ONLY to this seam. Mock in Phase 1; native plugin later.
(function () {
  "use strict";
  var STAGES = ["quality", "detect", "segment", "classify", "report"];
  var NULL_VISION = { available: function () { return false; }, analyze: function () { return Promise.reject(new Error("plugin_unavailable")); } };
  // Prefer, in order: an injected vision (tests) > the EXPERIMENTAL on-device ONNX classifier when its
  // flag (smd_sknx_realvision) is on and it reports available > the native SMD_SKNX_VISION plugin >
  // nothing (-> mock). analyze()'s .catch(mockRaw) makes any real-vision failure fall back to the mock.
  function pickVision(injected) {
    if (injected && injected.vision) return injected.vision;
    try {
      if (typeof window !== "undefined" && window.SMD_SKNX_REALVISION && window.SMD_SKNX_FLAGS &&
          window.SMD_SKNX_FLAGS.bool("smd_sknx_realvision") && window.SMD_SKNX_REALVISION.available()) {
        return window.SMD_SKNX_REALVISION;
      }
    } catch (e) {}
    return (typeof window !== "undefined" && window.SMD_SKNX_VISION) || NULL_VISION;
  }
  function deps(injected) {
    injected = injected || {};
    return {
      vision: pickVision(injected),
      engines: injected.engines || (typeof window !== "undefined" && window.SMD_SKNX_ENGINES) || (typeof require !== "undefined" ? require("./sknx-engines.js") : null)
    };
  }
  function mockRaw(entitlement, image) {
    if (image && image.__mock === "melanoma") {
      return { generalProbs: [{ label: "benign keratosis", prob: 0.5 }], lesionProbs: [{ label: "melanoma", prob: 0.35 }, { label: "nevus", prob: 0.5 }], features: {} };
    }
    return { generalProbs: [{ label: "psoriasis", prob: 0.71 }, { label: "eczema", prob: 0.16 }], lesionProbs: [{ label: "nevus", prob: 0.92 }, { label: "melanoma", prob: 0.02 }], features: { diameterMm: 4 } };
  }
  function analyze(image, entitlement, onStage, injected) {
    var d = deps(injected);
    function stage(i) { try { if (onStage) onStage(STAGES[i], Math.round(((i + 1) / STAGES.length) * 100)); } catch (e) {} }
    stage(0); stage(1); stage(2);
    var rawP = d.vision.available() ? d.vision.analyze(image).catch(function () { return mockRaw(entitlement, image); }) : Promise.resolve(mockRaw(entitlement, image));
    return rawP.then(function (raw) {
      stage(3);
      var a = d.engines.makeAnalysis(raw, entitlement);
      try { a.engine = (raw && raw.engine) || "mock"; } catch (e) {} // "realvision-experimental" | "mock" | plugin engine — for the UI badge
      stage(4);
      return a;
    });
  }
  var API = { analyze: analyze, mockRaw: mockRaw, STAGES: STAGES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_PROVIDERS = API;
})();
