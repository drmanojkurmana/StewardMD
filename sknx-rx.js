// sknx-rx.js — SknX AI · Phase 3 clinician-confirmed Rx draft assembler + eligibility gate.
//
// HARD SAFETY CONTRACT (each has a test). An Rx affordance is offered ONLY when ALL of these hold:
//   1. analysis.rxEligible === true      (the general inflammatory/infective engine, not a lesion read)
//   2. analysis.referral   !== true      (a referral/malignant lesion NEVER gets a draft)
//   3. the smd_sknx_rx flag is ON        (def:false, R1-gated — ships OFF)
//   4. SMD_RX.canPrescribe()             (a verified prescriber only)
//   5. a curated draft exists for the top differential (draftFor !== null)
// Malignant/urgent conditions (melanoma/BCC/SCC/cellulitis) return null from draftFor — never draftable.
// SknX only DRAFTS first-line educational drug options with NO patient dose; the clinician confirms,
// edits, sets the dose, and signs EVERY line inside the existing SMD_RX pad (prescription.js). This is
// never autonomous and never patient-facing. The curated REGIMENS map must pass R1 clinical review
// before smd_sknx_rx is ever flipped on. No em-dash in UI text.
(function () {
  "use strict";

  var EVID = (typeof require !== "undefined") ? require("./sknx-evidence.js") : (typeof window !== "undefined" ? window.SMD_SKNX_EVIDENCE : null);

  function normLabel(l) { return String(l == null ? "" : l).toLowerCase().trim(); }

  // Conditions that MUST refer — never draftable. Mirrors the Phase-1 engine malignancy guardrail
  // (melanoma/BCC/SCC) plus cellulitis (urgent). Synonyms included so a label variant can't slip past.
  var REFER_ONLY = {
    "melanoma": 1, "malignant melanoma": 1,
    "bcc": 1, "basal cell carcinoma": 1,
    "scc": 1, "squamous cell carcinoma": 1,
    "cellulitis": 1
  };

  // First-line educational drug options per condition. Each entry names a therapeutic CLASS (and a
  // typical example) with NO patient dose/freq/duration — the clinician sets those in the pad, where
  // every no-dose line renders as an unverified line to confirm. R1 must review this map before the
  // flag flips on.
  var REGIMENS = {
    "psoriasis": [
      { name: "Topical corticosteroid (potent, e.g. betamethasone valerate)", class: "topical corticosteroid" },
      { name: "Topical vitamin D analogue (e.g. calcipotriol)", class: "vitamin D analogue" },
      { name: "Emollient", class: "emollient", isAdvice: true },
      { name: "Use a milder potency on the face, flexures, and genitals", class: "site caution", isAdvice: true }
    ],
    "eczema": [
      { name: "Emollient", class: "emollient", isAdvice: true },
      { name: "Topical corticosteroid (mild to moderate, e.g. hydrocortisone or clobetasone)", class: "topical corticosteroid" }
    ],
    "atopic dermatitis": [
      { name: "Emollient", class: "emollient", isAdvice: true },
      { name: "Topical corticosteroid (mild to moderate, e.g. hydrocortisone or clobetasone)", class: "topical corticosteroid" }
    ],
    "contact dermatitis": [
      { name: "Identify and avoid the causative irritant or allergen", class: "trigger avoidance", isAdvice: true },
      { name: "Emollient", class: "emollient", isAdvice: true },
      { name: "Topical corticosteroid (short course)", class: "topical corticosteroid" }
    ],
    "acne": [
      { name: "Topical retinoid (e.g. adapalene)", class: "topical retinoid" },
      { name: "Benzoyl peroxide (topical)", class: "topical antibacterial / keratolytic" },
      { name: "Avoid topical retinoids in pregnancy; benzoyl peroxide is preferred", class: "pregnancy caution", isAdvice: true }
    ],
    "tinea": [
      { name: "Topical antifungal (e.g. clotrimazole or terbinafine)", class: "topical antifungal" },
      { name: "Scalp or nail involvement needs an oral antifungal - refer or adjust", class: "site caution", isAdvice: true }
    ],
    "tinea corporis": [
      { name: "Topical antifungal (e.g. clotrimazole or terbinafine)", class: "topical antifungal" },
      { name: "Scalp or nail involvement needs an oral antifungal - refer or adjust", class: "site caution", isAdvice: true }
    ],
    "urticaria": [
      { name: "Non-sedating antihistamine (e.g. cetirizine)", class: "non-sedating antihistamine" },
      { name: "Identify and avoid triggers where possible", class: "trigger avoidance", isAdvice: true }
    ],
    "impetigo": [
      { name: "Topical hydrogen peroxide (localized, non-bullous; NICE first-line)", class: "topical antiseptic" },
      { name: "Topical antibacterial (e.g. fusidic acid) if hydrogen peroxide is unsuitable", class: "topical antibacterial" },
      { name: "Widespread or bullous impetigo needs an oral antibiotic - refer or adjust", class: "escalation caution", isAdvice: true },
      { name: "Hygiene measures to limit spread", class: "general measures", isAdvice: true }
    ],
    "rosacea": [
      { name: "Topical metronidazole or azelaic acid", class: "topical anti-inflammatory" },
      { name: "Trigger avoidance and gentle skin care", class: "general measures", isAdvice: true }
    ]
  };

  function evidenceFor(labels) {
    try { return (EVID && EVID.retrieve) ? (EVID.retrieve(labels) || []) : []; } catch (e) { return []; }
  }
  function flagOn(deps) {
    if (deps && typeof deps.flagOn === "boolean") return deps.flagOn;
    try { return !!(window.SMD_SKNX_FLAGS && window.SMD_SKNX_FLAGS.bool("smd_sknx_rx")); } catch (e) { return false; }
  }
  function canPrescribe(deps) {
    var fn = (deps && deps.canPrescribe) || (typeof window !== "undefined" && window.SMD_RX && window.SMD_RX.canPrescribe);
    try { return typeof fn === "function" ? !!fn() : false; } catch (e) { return false; }
  }
  function topLabel(analysis) {
    var d = analysis && analysis.differential && analysis.differential[0];
    return d ? d.label : null;
  }

  // draftFor(label) -> { topic, regimen:[{name, class, isAdvice}], sources:[{source,title,url}] } | null.
  // null for a refer-only (malignant/urgent) condition or one with no curated first-line.
  function draftFor(label) {
    var key = normLabel(label);
    if (REFER_ONLY[key]) return null;
    var regimen = REGIMENS[key];
    if (!regimen || !regimen.length) return null;
    return {
      topic: label,
      regimen: regimen.map(function (r) { return { name: r.name, class: r.class, isAdvice: !!r.isAdvice }; }),
      sources: evidenceFor([label]).map(function (e) { return { source: e.source, title: e.title, url: e.url }; })
    };
  }

  // eligible(analysis, deps) -> bool. ALL five conditions above must hold. deps is injectable for tests:
  // { flagOn:bool, canPrescribe:fn }.
  function eligible(analysis, deps) {
    if (!analysis) return false;
    if (analysis.rxEligible !== true) return false;
    if (analysis.referral === true) return false;
    // R1 HIGH: require the lesion/malignancy screen to have RUN before any Rx is offered. The engine
    // sets analysis.lesion ONLY at the v2beta dual-engine tier (sknx-engines.js) - at a lower tier no
    // malignancy read exists and referral rests on red-flag heuristics alone, so a general-engine
    // misread of a malignant lesion as a benign condition could otherwise reach an Rx draft. No lesion
    // read -> no draft.
    if (!analysis.lesion) return false;
    if (!flagOn(deps)) return false;
    if (!canPrescribe(deps)) return false;
    if (!draftFor(topLabel(analysis))) return false;
    return true;
  }

  // openDraft(analysis, deps) — guard with eligible(), then open the existing SMD_RX pad pre-filled with
  // the draft regimen (no dose; each line is unverified for the clinician to confirm and sign). Never
  // throws; returns true only if the pad was actually opened. deps.rx injectable for tests.
  function openDraft(analysis, deps) {
    try {
      if (!eligible(analysis, deps)) return false;
      var draft = draftFor(topLabel(analysis));
      if (!draft) return false;
      var rx = (deps && deps.rx) || (typeof window !== "undefined" && window.SMD_RX) || null;
      if (!rx || typeof rx.open !== "function") return false;
      rx.open({ topic: draft.topic, regimen: draft.regimen });
      return true;
    } catch (e) { return false; }
  }

  var API = { eligible: eligible, draftFor: draftFor, openDraft: openDraft, REGIMENS: REGIMENS, REFER_ONLY: REFER_ONLY };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_RX = API;
})();
