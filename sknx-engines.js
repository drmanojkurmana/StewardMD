// sknx-engines.js — SknX dual-engine result logic + malignancy/red-flag referral guardrail.
(function () {
  "use strict";
  var MALIGNANT = ["melanoma", "BCC", "SCC"];
  var REFER_THRESHOLD = 0.15; // false-negative-averse: refer on even a low malignancy signal
  // Synonym/case map -> canonical MALIGNANT entry. A real classifier may emit "Melanoma",
  // "bcc", "basal cell carcinoma", "squamous cell carcinoma", etc.; normalize before matching
  // so the referral guardrail below can't be slipped past by casing/label-text drift.
  var MALIGNANT_SYNONYMS = {
    "melanoma": "melanoma",
    "malignant melanoma": "melanoma",
    "bcc": "BCC",
    "basal cell carcinoma": "BCC",
    "scc": "SCC",
    "squamous cell carcinoma": "SCC"
  };
  function normalizeMalignantLabel(label) {
    var k = String(label == null ? "" : label).toLowerCase().trim();
    return MALIGNANT_SYNONYMS[k] || null;
  }
  function band(p) { return p >= 0.66 ? "high" : p >= 0.33 ? "moderate" : "low"; }
  function rank(arr) { return (arr || []).slice().sort(function (a, b) { return b.prob - a.prob; }).map(function (x) { return { label: x.label, prob: x.prob, band: band(x.prob) }; }); }
  function redFlag(f) {
    if (!f) return false;
    var abcde = (f.asymmetry ? 1 : 0) + (f.borderIrregular ? 1 : 0) + (f.colorVariegation ? 1 : 0) + ((f.diameterMm || 0) >= 6 ? 1 : 0) + (f.evolving ? 1 : 0);
    return abcde >= 2 || !!f.bleeding || !!f.ulceration || !!f.rapidGrowth || !!f.systemicSymptoms;
  }
  function makeAnalysis(raw, entitlement) {
    raw = raw || {};
    var differential = rank(raw.generalProbs);
    var lesion = null, referral = false, reason = null;
    if (entitlement === "v2beta") {
      var lr = rank(raw.lesionProbs)[0] || null;
      if (lr) { lesion = { top: lr.label, prob: lr.prob, band: lr.band }; }
      var malig = (raw.lesionProbs || []).filter(function (x) { return !!normalizeMalignantLabel(x.label); }).sort(function (a, b) { return b.prob - a.prob; })[0];
      if (malig && malig.prob >= REFER_THRESHOLD) { referral = true; reason = "Possible " + malig.label + " - specialist referral, do not prescribe."; }
    }
    if (redFlag(raw.features)) { referral = true; reason = reason || "Red-flag features (ABCDE / bleeding / ulceration) - specialist referral, do not prescribe."; }
    return {
      differential: differential,
      lesion: lesion,
      referral: referral,
      referralReason: reason,
      rxEligible: !referral,
      disclaimerKey: "educational_not_clinical"
    };
  }
  var API = { makeAnalysis: makeAnalysis, MALIGNANT: MALIGNANT, REFER_THRESHOLD: REFER_THRESHOLD };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_ENGINES = API;
})();
