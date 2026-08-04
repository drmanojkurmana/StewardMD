// sknx-llm.js — SknX reasoning contract + deterministic mock reasoner (educational report builder).
// Phase 2 = deterministic mock: every section is assembled from `analysis`/`features`/`evidence`
// only, never invented. NO-HALLUCINATION (hard): guidelineSummary/references are drawn ONLY from
// the passed evidence array (see sknx-evidence.js) - if evidence is [], both are []. NO-RX (hard):
// management is educational principles only, never a specific drug + dose + patient instruction.
(function () {
  "use strict";

  var DISCLAIMER = "This report is educational information only. It is not a diagnosis and is not a substitute for in-person clinical examination or histopathology.";

  var AUDIENCES = ["mbbs", "intern", "resident", "consultant", "patient"];

  function normLabel(l) { return String(l == null ? "" : l).toLowerCase().trim(); }
  function pct(p) { return Math.round((typeof p === "number" ? p : 0) * 100); }

  // ---- educational-principle lookup (concepts only - class names, never drug + dose) ----
  var MANAGEMENT_PRINCIPLES = {
    "psoriasis": [
      "Topical corticosteroid class as an educational first-line principle for localized plaques",
      "Emollients to reduce scale and support the skin barrier",
      "Consider specialist referral for phototherapy if disease is extensive"
    ],
    "eczema": [
      "Emollients as the mainstay of educational skin-barrier support",
      "Topical corticosteroid class for flares, as a general principle",
      "Advise avoidance of known irritants and trigger factors"
    ],
    "atopic dermatitis": [
      "Emollients as the mainstay of educational skin-barrier support",
      "Topical corticosteroid class for flares, as a general principle",
      "Advise avoidance of known irritants and trigger factors"
    ],
    "contact dermatitis": [
      "Identify and remove the offending irritant or allergen",
      "Emollients to support the skin barrier during recovery",
      "Topical anti-inflammatory class for symptomatic relief, as a general principle"
    ],
    "acne": [
      "Topical retinoid class as an educational first-line principle",
      "Gentle, non-comedogenic skin care",
      "Consider specialist referral for nodulocystic or scarring disease"
    ],
    "tinea": [
      "Topical antifungal class for localized disease, as a general principle",
      "Keep the affected area clean and dry",
      "Consider specialist referral if widespread or if nails are involved"
    ],
    "tinea corporis": [
      "Topical antifungal class for localized disease, as a general principle",
      "Keep the affected area clean and dry",
      "Consider specialist referral if widespread or if nails are involved"
    ],
    "urticaria": [
      "Non-sedating antihistamine class as an educational first-line principle",
      "Identify and avoid triggers where possible",
      "Consider specialist referral if symptoms persist beyond six weeks"
    ],
    "impetigo": [
      "Topical antibacterial class for localized lesions, as a general principle",
      "Gentle cleansing and hygiene measures to limit spread",
      "Consider specialist referral if extensive or not improving"
    ],
    "cellulitis": [
      "Specialist or urgent-care assessment is advised given the risk of spreading infection",
      "Mark and monitor the margin of erythema",
      "Seek urgent care if fever or rapid spread develops"
    ],
    "rosacea": [
      "Topical anti-inflammatory class as an educational first-line principle",
      "Advise trigger avoidance (sun exposure, heat, spicy food, alcohol)",
      "Gentle, fragrance-free skin care"
    ]
  };
  var DEFAULT_MANAGEMENT = [
    "General skin care and emollient use",
    "Advise sun protection (broad spectrum, reapplied regularly)",
    "Follow up if the lesion changes in size, shape, color, or symptoms"
  ];
  var REFERRAL_MANAGEMENT = [
    "Specialist referral is recommended before any treatment is considered",
    "Avoid delay in arranging dermatology assessment given the features noted above",
    "Protect the area from further trauma or sun exposure while awaiting specialist review"
  ];

  function topDifferential(differential) { return (differential && differential[0]) || null; }

  function buildQuality(features, context) {
    features = features || {}; context = context || {};
    if (context.quality) return String(context.quality);
    var hasMetrics = features.diameterMm != null || features.areaMm2 != null || features.borderIndex != null;
    return hasMetrics ? "usable" : "limited";
  }

  function buildVisualFindings(features) {
    features = features || {};
    var parts = [];
    if (features.diameterMm != null) parts.push("diameter approximately " + features.diameterMm + "mm");
    if (features.areaMm2 != null) parts.push("area approximately " + features.areaMm2 + "mm2");
    if (features.borderIrregular) parts.push("irregular border");
    if (features.colorVariegation) parts.push("color variegation");
    if (features.asymmetry) parts.push("asymmetry");
    if (features.evolving) parts.push("a reported change over time");
    if (!parts.length) return "No quantitative morphometric findings are available for this image.";
    return "Morphometric findings: " + parts.join(", ") + ".";
  }

  function whyText(d) {
    var p = pct(d.prob);
    if (d.band === "high") return "Ranked highest by the image analysis at approximately " + p + "% (high band), consistent with the visual pattern observed.";
    if (d.band === "moderate") return "Present at a moderate estimated likelihood of approximately " + p + "%, based on the visual pattern observed.";
    return "Included as a lower-probability possibility (approximately " + p + "%) based on overlapping visual features.";
  }

  function whyNotText(d, isTop) {
    var p = pct(d.prob);
    if (isTop) return "Cannot be confirmed from images alone; clinical correlation, and histopathology if indicated, is needed to exclude mimics.";
    return "Ranked below the leading differential (approximately " + p + "%), so it is less consistent with the dominant visual pattern than the top entry.";
  }

  function buildDifferential(differential) {
    return (differential || []).map(function (d, i) {
      return { label: d.label, why: whyText(d), whyNot: whyNotText(d, i === 0) };
    });
  }

  function buildRedFlags(analysis, features) {
    analysis = analysis || {}; features = features || {};
    var flags = [];
    if (!analysis.referral) return flags;
    if (features.asymmetry) flags.push("Asymmetry (A of ABCDE)");
    if (features.borderIrregular) flags.push("Border irregularity (B of ABCDE)");
    if (features.colorVariegation) flags.push("Color variegation (C of ABCDE)");
    if (features.diameterMm != null && features.diameterMm >= 6) flags.push("Diameter 6mm or greater (D of ABCDE)");
    if (features.evolving) flags.push("Evolving lesion (E of ABCDE)");
    if (features.bleeding) flags.push("Bleeding");
    if (features.ulceration) flags.push("Ulceration");
    if (features.rapidGrowth) flags.push("Rapid growth");
    if (features.systemicSymptoms) flags.push("Systemic symptoms");
    if (analysis.referralReason) flags.push(analysis.referralReason);
    if (!flags.length) flags.push("Specialist referral indicated by the analysis.");
    return flags;
  }

  function buildDiscussion(analysis, differential, evidence) {
    analysis = analysis || {}; evidence = evidence || [];
    var top = topDifferential(differential);
    var s = top
      ? "The leading differential is " + top.label + " (approximately " + pct(top.prob) + "%, " + top.band + " likelihood), based on the analyzed image."
      : "No differential could be ranked from the analyzed image.";
    if (analysis.referral) {
      s += " " + (analysis.referralReason || "Red-flag features were noted, and specialist referral is advised before any treatment decision.");
    } else {
      s += " No red-flag features were identified in this analysis.";
    }
    if (evidence.length) {
      s += " This is summarized against " + evidence.length + " retrieved reference" + (evidence.length === 1 ? "" : "s") + " below.";
    }
    return s;
  }

  function buildGuidelineSummary(evidence) {
    return (evidence || []).map(function (e) {
      // point/source/url come verbatim from the retrieved evidence entry - never invented.
      return { point: e.title, source: e.source, url: e.url };
    });
  }

  function buildReferences(evidence) {
    return (evidence || []).map(function (e) {
      return { source: e.source, title: e.title, url: e.url };
    });
  }

  function buildInvestigations(analysis) {
    analysis = analysis || {};
    var out = ["Dermoscopy for additional morphological assessment, where available"];
    if (analysis.referral) out.push("Skin biopsy and histopathology to confirm the diagnosis, given the features noted above");
    return out;
  }

  function buildManagement(analysis, differential) {
    analysis = analysis || {};
    if (analysis.referral) return REFERRAL_MANAGEMENT.slice();
    var top = topDifferential(differential);
    var key = top ? normLabel(top.label) : "";
    var principles = MANAGEMENT_PRINCIPLES[key] || DEFAULT_MANAGEMENT;
    return principles.slice();
  }

  function buildFollowup(analysis) {
    analysis = analysis || {};
    if (analysis.referral) {
      return [
        "Urgent dermatology referral; do not delay pending specialist assessment",
        "Reassess sooner if the lesion bleeds, ulcerates, or grows rapidly"
      ];
    }
    return [
      "Routine follow-up if the lesion changes in size, shape, color, or symptoms",
      "Re-photograph and reassess in four to six weeks if the picture is inconclusive"
    ];
  }

  function mockReport(input) {
    var analysis = input.analysis || {};
    var features = input.features || {};
    var evidence = Array.isArray(input.evidence) ? input.evidence : [];
    var context = input.context || {};
    var differential = Array.isArray(analysis.differential) ? analysis.differential : [];

    return {
      quality: buildQuality(features, context),
      visualFindings: buildVisualFindings(features),
      differential: buildDifferential(differential),
      redFlags: buildRedFlags(analysis, features),
      discussion: buildDiscussion(analysis, differential, evidence),
      guidelineSummary: buildGuidelineSummary(evidence),
      investigations: buildInvestigations(analysis),
      management: buildManagement(analysis, differential),
      followup: buildFollowup(analysis),
      references: buildReferences(evidence),
      disclaimer: DISCLAIMER
    };
  }

  function buildReport(input, deps) {
    input = input || {};
    deps = deps || {};
    if (typeof deps.remote === "function") return deps.remote(input); // REAL-GEMINI/VERTEX SWAP POINT: /api/sknx call replaces the mock below.
    return mockReport(input);
  }

  // ---- audience re-leveling: templates only re-word `discussion`, never touch citations ----
  function topLabelOf(report) {
    var d = (report.differential || [])[0];
    return d ? d.label : "this finding";
  }

  function relevelDiscussion(report, audience) {
    var top = topLabelOf(report);
    var hasFlags = (report.redFlags || []).length > 0;
    var referralNote = hasFlags ? " Red-flag features were noted here, so specialist review is advised before any treatment decision." : "";
    if (audience === "patient") {
      return "This is educational information, not a diagnosis. The picture looks most like " + top + "." +
        (hasFlags ? " Some features noted here mean you should see a doctor in person soon." : " Please discuss this with a doctor to confirm and plan next steps.");
    }
    if (audience === "mbbs") {
      return "Teaching note: the leading differential is " + top + ", derived from the analyzed visual features. " +
        "Review the ranked differential's supporting and against reasoning, and note how ABCDE-type features drive the referral decision." + referralNote;
    }
    if (audience === "intern") {
      return "Working differential: " + top + " is the top-ranked finding from this image analysis. " +
        "Review the differential list and its supporting or against reasoning before deciding on next steps." + referralNote;
    }
    if (audience === "consultant") {
      return "Leading differential " + top + ", with the ranked differential, supporting or against reasoning, and cited guideline summary below. " +
        "Correlate with history and examination, and consider histopathology if diagnostic uncertainty remains." + referralNote;
    }
    // resident (also the default/fallback for an unrecognized audience)
    return "Differential impression: " + top + " is the top-ranked finding. " +
      "Review the full differential, supporting evidence, and any red-flag features below before formulating a plan." + referralNote;
  }

  function explainAs(reportPayload, audience) {
    if (!reportPayload) return reportPayload;
    var aud = AUDIENCES.indexOf(audience) !== -1 ? audience : "resident";
    var out = {};
    for (var k in reportPayload) { if (Object.prototype.hasOwnProperty.call(reportPayload, k)) out[k] = reportPayload[k]; }
    out.discussion = relevelDiscussion(reportPayload, aud);
    return out;
  }

  var API = { buildReport: buildReport, explainAs: explainAs, AUDIENCES: AUDIENCES, DISCLAIMER: DISCLAIMER };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_LLM = API;
})();
