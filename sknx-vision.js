// sknx-vision.js — bridge to the native capacitor-sknx-vision plugin (Core ML / TFLite).
(function () {
  "use strict";
  function cap(win) { win = win || (typeof window !== "undefined" ? window : {}); return (win.Capacitor && win.Capacitor.Plugins && win.Capacitor.Plugins.SknxVision) || null; }
  function available(win) { return !!cap(win); }
  function analyze(imageInput, win) {
    var p = cap(win);
    if (!p) return Promise.reject(new Error("plugin_unavailable"));
    return Promise.resolve(p.analyze({ image: imageInput })); // native returns { generalProbs, lesionProbs, features, heatmap, quality, boxes }
  }
  var API = { available: available, analyze: analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_VISION = API;
})();
