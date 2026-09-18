/* StewardMD - onco-genomics.js. Genomic Precision & ctDNA Surveillance Drawer.
 * PURE: no DOM mutation, evaluates actionable oncogenomic alterations against
 * precision therapeutic targets and tracks serial ctDNA MRD dynamics.
 * window.SMD_ONCO_GENOMICS + module.exports.
 */
(function (root) {
  "use strict";

  // Curated Actionable Genomic Biomarker Registry (FDA-approved / NCCN Category 1)
  var ACTIONABLE_TARGETS = [
    {
      gene: "EGFR",
      alteration: ["l858r", "exon 19 deletion", "ex19del"],
      diseaseScope: ["nsclc", "lung"],
      targetedTherapies: ["Osimertinib 80 mg PO daily (preferred 1st line)"],
      evidence: "Category 1 (FLAURA trial)"
    },
    {
      gene: "KRAS",
      alteration: ["g12c"],
      diseaseScope: ["nsclc", "colorectal", "crc"],
      targetedTherapies: ["Sotorasib 960 mg PO daily", "Adagrasib 600 mg PO BID ± Cetuximab"],
      evidence: "Category 2A (CodeBreaK / KRYSTAL)"
    },
    {
      gene: "BRAF",
      alteration: ["v600e"],
      diseaseScope: ["melanoma", "colorectal", "thyroid", "nsclc", "histiocytic"],
      targetedTherapies: ["Dabrafenib + Trametinib", "Encorafenib + Cetuximab (colorectal)"],
      evidence: "Category 1 (BEACON / COMBI-d)"
    },
    {
      gene: "HER2",
      alteration: ["amplification", "overexpression", "ihc 3+", "fish positive"],
      diseaseScope: ["breast", "gastric", "uppergi", "colorectal"],
      targetedTherapies: ["Trastuzumab + Pertuzumab", "Trastuzumab deruxtecan (T-DXd)"],
      evidence: "Category 1 (CLEOPATRA / DESTINY)"
    },
    {
      gene: "ALK",
      alteration: ["rearrangement", "fusion"],
      diseaseScope: ["nsclc", "lung"],
      targetedTherapies: ["Alectinib 600 mg PO BID", "Lorlatinib 100 mg PO daily", "Brigatinib"],
      evidence: "Category 1 (ALEX / CROWN)"
    },
    {
      gene: "RET",
      alteration: ["fusion", "rearrangement", "mutation"],
      diseaseScope: ["nsclc", "thyroid"],
      targetedTherapies: ["Selpercatinib 160 mg PO BID", "Pralsetinib 400 mg PO daily"],
      evidence: "Category 1 (LIBRETTO-001 / ARROW)"
    },
    {
      gene: "NTRK",
      alteration: ["fusion", "ntrk1", "ntrk2", "ntrk3"],
      diseaseScope: ["tumor-agnostic", "all"],
      targetedTherapies: ["Larotrectinib 100 mg PO BID", "Entrectinib 600 mg PO daily"],
      evidence: "Category 1 FDA Tumor-Agnostic"
    },
    {
      gene: "BRCA1",
      alteration: ["mutation", "pathogenic"],
      diseaseScope: ["breast", "ovarian", "prostate", "pancreatic"],
      targetedTherapies: ["Olaparib", "Talazoparib", "Rucaparib", "Niraparib"],
      evidence: "Category 1 (OlympiA / SOLO-1 / PROfound / POLO)"
    },
    {
      gene: "BRCA2",
      alteration: ["mutation", "pathogenic"],
      diseaseScope: ["breast", "ovarian", "prostate", "pancreatic"],
      targetedTherapies: ["Olaparib", "Talazoparib", "Rucaparib", "Niraparib"],
      evidence: "Category 1"
    },
    {
      gene: "MMR",
      alteration: ["dmmr", "msi-h", "microsatellite instability-high"],
      diseaseScope: ["tumor-agnostic", "colorectal", "rectal", "uterine", "uppergi"],
      targetedTherapies: ["Dostarlimab 500 mg IV q3w", "Pembrolizumab 200 mg IV q3w"],
      evidence: "Category 1 (KEYNOTE-177 / Cercek NEJM 2022)"
    }
  ];

  function normalize(s) {
    return String(s || "").toLowerCase().trim();
  }

  /**
   * Matches patient NGS genomic alterations against targeted oncology regimens.
   *
   * @param {Array<Object>} genomicAlterations - Array of { gene: "EGFR", alteration: "L858R", vaf: 12.4 }.
   * @param {string} [diseaseContext] - Optional disease ID or name (e.g. "lung" or "colorectal").
   * @returns {Object} Actionable matches, level of evidence, and drug recommendations.
   */
  function matchActionableTargets(genomicAlterations, diseaseContext) {
    genomicAlterations = Array.isArray(genomicAlterations) ? genomicAlterations : [];
    var ctx = normalize(diseaseContext || "all");
    var matches = [];

    for (var i = 0; i < genomicAlterations.length; i++) {
      var alt = genomicAlterations[i] || {};
      var geneNorm = normalize(alt.gene);
      var altNorm = normalize(alt.alteration);

      for (var t = 0; t < ACTIONABLE_TARGETS.length; t++) {
        var target = ACTIONABLE_TARGETS[t];
        if (normalize(target.gene) !== geneNorm) continue;

        var altMatch = target.alteration.some(function (a) {
          return altNorm.indexOf(normalize(a)) >= 0 || normalize(a).indexOf(altNorm) >= 0;
        });

        if (altMatch) {
          var diseaseMatch = target.diseaseScope.indexOf("all") >= 0 ||
                             target.diseaseScope.indexOf("tumor-agnostic") >= 0 ||
                             target.diseaseScope.some(function (ds) { return ctx.indexOf(ds) >= 0; });

          matches.push({
            gene: alt.gene,
            alteration: alt.alteration,
            vaf: alt.vaf != null ? alt.vaf : null,
            diseaseContext: diseaseContext || "Agnostic",
            diseaseMatch: diseaseMatch,
            recommendedTherapies: target.targetedTherapies,
            evidenceLevel: target.evidence
          });
        }
      }
    }

    return {
      alterationsEvaluated: genomicAlterations.length,
      actionableTargetCount: matches.length,
      matches: matches
    };
  }

  /**
   * Evaluates serial circulating tumor DNA (ctDNA) molecular response.
   *
   * @param {Array<Object>} serialSamples - Array of { timepoint: "baseline"|"post-op"|"cycle-3", date: "YYYY-MM-DD", mrdStatus: "positive"|"negative", vaf: 1.4, mtmPerMl: 42.1 }.
   * @returns {Object} Kinetic trajectory, molecular response call, and clinical guidance.
   */
  function trackCtDnaDynamics(serialSamples) {
    serialSamples = Array.isArray(serialSamples) ? serialSamples : [];
    if (!serialSamples.length) return { status: "no_data", samples: [] };

    var latest = serialSamples[serialSamples.length - 1];
    var prior = serialSamples.length > 1 ? serialSamples[serialSamples.length - 2] : null;

    var responseCall = "stable";
    var guidance = "";

    if (latest.mrdStatus === "negative") {
      if (prior && prior.mrdStatus === "positive") {
        responseCall = "molecular_clearance";
        guidance = "Complete molecular clearance (MRD-negative conversion). High probability of sustained clinical response; continue surveillance.";
      } else {
        responseCall = "mrd_negative";
        guidance = "ctDNA undetectable (MRD-negative). Low immediate recurrence risk.";
      }
    } else if (latest.mrdStatus === "positive") {
      if (prior && prior.mrdStatus === "negative") {
        responseCall = "molecular_recurrence";
        guidance = "Molecular recurrence detected (ctDNA reverted to positive). Precedes radiologic recurrence by 3-9 months; restaging PET/CT scan strongly recommended.";
      } else if (prior && prior.vaf != null && latest.vaf != null) {
        if (latest.vaf > prior.vaf * 1.3) {
          responseCall = "molecular_progression";
          guidance = "Rising ctDNA tumor fraction (>30% increase). Indicates therapeutic resistance or progressive disease.";
        } else if (latest.vaf < prior.vaf * 0.7) {
          responseCall = "molecular_response";
          guidance = "Decreasing ctDNA tumor fraction (>30% reduction). Demonstrates biochemical on-target response.";
        }
      } else {
        responseCall = "mrd_positive";
        guidance = "ctDNA detected (MRD-positive). High risk of residual microscopic disease.";
      }
    }

    return {
      sampleCount: serialSamples.length,
      latestTimepoint: latest.timepoint || "current",
      latestMrdStatus: latest.mrdStatus,
      latestVaf: latest.vaf || null,
      responseCall: responseCall,
      clinicalGuidance: guidance,
      samples: serialSamples
    };
  }

  var API = {
    matchActionableTargets: matchActionableTargets,
    trackCtDnaDynamics: trackCtDnaDynamics,
    ACTIONABLE_TARGETS: ACTIONABLE_TARGETS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  root.SMD_ONCO_GENOMICS = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
