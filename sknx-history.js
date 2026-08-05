// sknx-history.js - SknX structured clinical-history model + the history->engine-features mapping.
//
// Phase 1: the danger-sign fields (changing/bleeding/rapidGrowth/systemic + ABCDE) map onto the EXACT
// feature keys sknx-engines.redFlag() reads, so an optional history can force a referral the image model
// cannot trigger on its own (the melanoma/cancer safety net). The non-danger fields (itch/scale/onset/
// pain/site/note) are carried for the Phase-2 LLM reasoner and are deliberately NOT features here.
(function () {
  "use strict";

  function historyToFeatures(h) {
    h = h || {};
    var f = {};
    if (h.changing) f.evolving = true;
    if (h.bleeding) { f.bleeding = true; f.ulceration = true; }   // "bleeding / non-healing"
    if (h.rapidGrowth) f.rapidGrowth = true;
    if (h.systemic) f.systemicSymptoms = true;
    var a = h.abcde || {};
    if (a.asymmetry) f.asymmetry = true;
    if (a.border) f.borderIrregular = true;
    if (a.color) f.colorVariegation = true;
    if (a.diameter6) f.diameterMm = 6;   // redFlag counts diameterMm>=6 as one ABCDE point
    return f;
  }

  var API = { historyToFeatures: historyToFeatures, EMPTY: {} };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_HISTORY = API;
})();
