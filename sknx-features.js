// sknx-features.js — SknX morphometrics from the segmentation mask into structured findings.
(function () {
  "use strict";
  function derive(g) {
    g = g || {};
    var pxPerMm = g.pxPerMm || 0;
    var diameterMm = pxPerMm ? Math.round((g.diameterPx || 0) / pxPerMm) : null;
    var areaMm2 = pxPerMm ? Math.round((g.maskAreaPx || 0) / (pxPerMm * pxPerMm)) : null;
    var area = g.maskAreaPx || 0, per = g.perimeterPx || 0;
    var borderIndex = area > 0 ? (per * per) / (4 * Math.PI * area) : 1; // 1 = perfect circle
    var colors = (g.colors || []);
    return {
      diameterMm: diameterMm,
      areaMm2: areaMm2,
      borderIndex: Math.round(borderIndex * 100) / 100,
      borderIrregular: borderIndex > 1.2,
      colorVariegation: colors.length >= 3
    };
  }
  var API = { derive: derive };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_FEATURES = API;
})();
