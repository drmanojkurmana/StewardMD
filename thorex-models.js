/* thorex-models.js — ThoreX CXR AI · value types + DTO normalizer (SMD_THOREX_MODELS).
 *
 * Serializable value types. `makeAnalysis(raw)` decodes an API/mock payload into a safe CxrAnalysis:
 * forward-compatible (ignores unknown fields; missing fields get sane defaults) per the Networking
 * contract. Also exports the canonical pneumonia sample used by the mock analyzer and test suite.
 * Pure; node + browser.
 */
(function () {
  "use strict";

  var SEVERITIES = ["critical", "urgent", "warn", "stable", "info"];
  function sev(v) { return SEVERITIES.indexOf(v) >= 0 ? v : "info"; }
  function str(v, d) { return typeof v === "string" ? v : (d || ""); }
  function numOr(v, d) { if (v == null || v === "") return d == null ? null : d; v = +v; return isFinite(v) ? v : (d == null ? null : d); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (isFinite(n) ? n : 0); }
  function uuid() { return "thor-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9); }
  function isoNow() { return new Date().toISOString(); }

  // Band mapping: ≥0.60 "High", ≥0.30 "Medium", ≥0.10 "Low", else null (mirrors backend)
  function band(prob) {
    prob = clamp01(prob);
    if (prob >= 0.60) return "High";
    if (prob >= 0.30) return "Medium";
    if (prob >= 0.10) return "Low";
    return null;
  }

  function makeFinding(f) {
    f = f || {};
    return {
      label: str(f.label),
      band: f.band ? str(f.band) : null,
      severity: sev(f.severity),
      relevance: f.relevance == null ? undefined : str(f.relevance),
      heatmap: f.heatmap == null ? undefined : str(f.heatmap)
    };
  }

  function makeQuality(q) {
    q = q || {};
    return {
      view: q.view == null ? undefined : str(q.view),
      adequate: q.adequate == null ? undefined : !!q.adequate,
      issues: arr(q.issues)
    };
  }

  function makeEngine(e) {
    e = e || {};
    return {
      engine: str(e.engine),
      educational: !!e.educational,
      findings: arr(e.findings).map(makeFinding),
      disclaimerKey: e.disclaimer_key ? str(e.disclaimer_key) : (e.disclaimerKey ? str(e.disclaimerKey) : undefined)
    };
  }

  // Normalize any payload → CxrAnalysis. Never throws on partial/unknown input (forward-compatible).
  function makeAnalysis(raw) {
    raw = raw || {};
    return {
      id: str(raw.id) || uuid(),
      createdAt: str(raw.createdAt) || isoNow(),
      engines: arr(raw.engines).map(makeEngine),
      quality: raw.quality && typeof raw.quality === "object" ? makeQuality(raw.quality) : undefined,
      disclaimerKey: raw.disclaimer_key ? str(raw.disclaimer_key) : (raw.disclaimerKey ? str(raw.disclaimerKey) : undefined)
    };
  }

  // Helper: does this analysis have a clinical (non-educational) engine?
  function hasClinicalEngine(a) {
    return a && arr(a.engines).some(function (e) { return e.educational === false; });
  }

  // Helper: get the clinical (non-educational) engine, or undefined
  function clinicalEngine(a) {
    return a && arr(a.engines).find(function (e) { return e.educational === false; });
  }

  // Helper: get the learning (educational) engine, or undefined
  function learningEngine(a) {
    return a && arr(a.engines).find(function (e) { return e.educational === true; });
  }

  // Canonical pneumonia sample (deterministic, matches README spec / golden tests).
  var PNEUMONIA = {
    createdAt: "2024-12-15T14:30:00Z",
    engines: [
      {
        engine: "torchxrayvision",
        educational: false,
        findings: [
          { label: "Right lower lobe consolidation", band: "High", severity: "urgent", relevance: "diagnostic" },
          { label: "Air bronchogram", band: "Medium", severity: "warn", relevance: "supportive" }
        ],
        disclaimer_key: "clinical_validated"
      },
      {
        engine: "xraydar",
        educational: true,
        findings: [
          { label: "Bilateral lower lobe interstitial opacities", band: "Medium", severity: "warn", relevance: "educational" }
        ],
        disclaimer_key: "educational_not_clinical"
      }
    ],
    quality: { view: "PA upright", adequate: true, issues: [] },
    disclaimerKey: "general_clinical_notice"
  };

  var API = {
    makeAnalysis: makeAnalysis,
    band: band,
    hasClinicalEngine: hasClinicalEngine,
    clinicalEngine: clinicalEngine,
    learningEngine: learningEngine,
    SEVERITIES: SEVERITIES,
    samples: { pneumonia: PNEUMONIA }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_MODELS = API;
})();
