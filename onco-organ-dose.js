/* StewardMD - onco-organ-dose.js. Pure Renal & Hepatic Auto-Dose Modification Engine.
 * PURE: no DOM, no fetch, no window dependencies. Decision-support only.
 * Evaluates patient renal/hepatic function against guideline-established dose adjustment criteria.
 * Clinician confirms downstream; never silently overrides doses (never-invent).
 * window.SMD_ONCO_ORGAN_DOSE + module.exports.
 */
(function (root) {
  "use strict";

  function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

  // Standard organ impairment guidelines library (NCCN Chemotherapy Order Templates & DeVita 12th ed.)
  var ORGAN_RULES = {
    "capecitabine": [
      {
        organ: "renal",
        metric: "crcl",
        condition: function (crcl) { return crcl >= 30 && crcl <= 50; },
        recommendedPercent: 75,
        action: "reduce",
        text: "Moderate renal impairment (CrCl 30-50 mL/min): Reduce capecitabine dose by 25% (administer 75% of standard dose).",
        citation: "Standard Guidelines (NCCN), Chemotherapy Order Templates / DeVita 12th ed."
      },
      {
        organ: "renal",
        metric: "crcl",
        condition: function (crcl) { return crcl < 30; },
        recommendedPercent: 0,
        action: "contraindicated",
        text: "Severe renal impairment (CrCl < 30 mL/min): Capecitabine is contraindicated. Withhold or select non-renal alternative regimen.",
        citation: "Standard Guidelines (NCCN), Chemotherapy Order Templates / DeVita 12th ed."
      }
    ],
    "cisplatin": [
      {
        organ: "renal",
        metric: "crcl",
        condition: function (crcl) { return crcl >= 45 && crcl < 60; },
        recommendedPercent: 75,
        action: "reduce/evaluate",
        text: "Mild-to-moderate renal impairment (CrCl 45-59 mL/min): High nephrotoxicity risk. Reduce cisplatin dose by 25% (administer 75%) or consider switching to Carboplatin (Calvert AUC).",
        citation: "Standard Guidelines (NCCN) / DeVita 12th ed."
      },
      {
        organ: "renal",
        metric: "crcl",
        condition: function (crcl) { return crcl < 45; },
        recommendedPercent: 0,
        action: "switch/omit",
        text: "Renal impairment (CrCl < 45 mL/min): Cisplatin is contraindicated due to irreversible nephrotoxicity. Strongly recommend switching to Carboplatin dosed by Calvert formula.",
        citation: "Standard Guidelines (NCCN) / DeVita 12th ed."
      }
    ],
    "oxaliplatin": [
      {
        organ: "renal",
        metric: "crcl",
        condition: function (crcl) { return crcl < 30; },
        recommendedPercent: 75,
        action: "reduce",
        text: "Severe renal impairment (CrCl < 30 mL/min): Reduce initial oxaliplatin dose to 65-70 mg/m2 (approx 20-25% reduction). Monitor closely for neurotoxicity and myelosuppression.",
        citation: "Standard Guidelines (NCCN) / DeVita 12th ed."
      }
    ],
    "pemetrexed": [
      {
        organ: "renal",
        metric: "crcl",
        condition: function (crcl) { return crcl < 45; },
        recommendedPercent: 0,
        action: "contraindicated",
        text: "Renal impairment (CrCl < 45 mL/min): Pemetrexed clearance is severely compromised. Do not administer if CrCl < 45 mL/min.",
        citation: "Standard Guidelines (NCCN), Non-Small Cell Lung Cancer / DeVita 12th ed."
      }
    ],
    "doxorubicin": [
      {
        organ: "hepatic",
        metric: "totalBili",
        condition: function (bili) { return bili >= 1.5 && bili <= 3.0; },
        recommendedPercent: 50,
        action: "reduce",
        text: "Moderate hepatic impairment (Serum total bilirubin 1.5-3.0 mg/dL): Reduce doxorubicin dose by 50% due to impaired biliary excretion and extreme cardiotoxicity/myelosuppression risk.",
        citation: "DeVita 12th ed. / Standard Guidelines (NCCN), Invasive Breast Cancer"
      },
      {
        organ: "hepatic",
        metric: "totalBili",
        condition: function (bili) { return bili > 3.0 && bili <= 5.0; },
        recommendedPercent: 25,
        action: "reduce",
        text: "Severe hepatic impairment (Serum total bilirubin 3.1-5.0 mg/dL): Reduce doxorubicin dose by 75% (administer 25% of standard dose).",
        citation: "DeVita 12th ed. / Standard Guidelines (NCCN)"
      },
      {
        organ: "hepatic",
        metric: "totalBili",
        condition: function (bili) { return bili > 5.0; },
        recommendedPercent: 0,
        action: "contraindicated",
        text: "Severe hepatic dysfunction (Serum total bilirubin > 5.0 mg/dL): Doxorubicin is contraindicated. Omit anthracycline.",
        citation: "DeVita 12th ed. / Standard Guidelines (NCCN)"
      }
    ],
    "docetaxel": [
      {
        organ: "hepatic",
        metric: "hepaticEnzymes",
        condition: function (labs) {
          var bili = labs.totalBili || labs.totalBilirubin || 0;
          var ast = labs.ast || 0;
          var ulnAst = labs.ulnAst || 35;
          return bili > 1.2 || ast > (1.5 * ulnAst);
        },
        recommendedPercent: 75,
        action: "reduce/caution",
        text: "Hepatic enzyme elevation (Bilirubin > ULN or AST > 1.5x ULN): Reduce docetaxel dose by 20-25% (e.g., 75 mg/m2 reduced to 60 mg/m2 or 100 mg/m2 reduced to 75 mg/m2) due to high risk of treatment-related mortality.",
        citation: "Standard Guidelines (NCCN) / DeVita 12th ed."
      }
    ],
    "irinotecan": [
      {
        organ: "hepatic",
        metric: "totalBili",
        condition: function (bili) { return bili > 1.5 && bili <= 3.0; },
        recommendedPercent: 75,
        action: "reduce",
        text: "Hyperbilirubinemia (Total bilirubin 1.5-3.0 mg/dL): Reduce irinotecan dose by 25-30% due to reduced glucuronidation to inactive SN-38G.",
        citation: "Standard Guidelines (NCCN), Colon/Rectal Cancer / DeVita 12th ed."
      },
      {
        organ: "hepatic",
        metric: "totalBili",
        condition: function (bili) { return bili > 3.0; },
        recommendedPercent: 0,
        action: "omit",
        text: "Severe hyperbilirubinemia (Total bilirubin > 3.0 mg/dL): Irinotecan is contraindicated due to life-threatening neutropenia and diarrhea.",
        citation: "Standard Guidelines (NCCN), Colon/Rectal Cancer / DeVita 12th ed."
      }
    ],
    "vincristine": [
      {
        organ: "hepatic",
        metric: "totalBili",
        condition: function (bili) { return bili > 1.5 && bili <= 3.0; },
        recommendedPercent: 50,
        action: "reduce",
        text: "Hepatic impairment (Total bilirubin 1.5-3.0 mg/dL): Reduce vincristine dose by 50% to mitigate severe neurotoxicity and paralytic ileus.",
        citation: "DeVita 12th ed. / Pediatric Oncology Standards (COG)"
      },
      {
        organ: "hepatic",
        metric: "totalBili",
        condition: function (bili) { return bili > 3.0; },
        recommendedPercent: 25,
        action: "reduce/omit",
        text: "Severe hepatic impairment (Total bilirubin > 3.0 mg/dL): Reduce vincristine dose by 75% or omit.",
        citation: "DeVita 12th ed. / Pediatric Oncology Standards (COG)"
      }
    ],
    "carboplatin": [
      {
        organ: "renal",
        metric: "crcl",
        condition: function (crcl) { return crcl < 20; },
        recommendedPercent: 50,
        action: "reduce/evaluate",
        text: "Severe renal impairment (CrCl < 20 mL/min): High myelosuppression and prolonged clearance risk. Recalculate Calvert AUC dose using Cockcroft-Gault CrCl with close hematologic monitoring.",
        citation: "Standard Guidelines (NCCN) / DeVita 12th ed."
      }
    ]
  };

  /**
   * Cockcroft-Gault Creatinine Clearance Calculator (mL/min)
   * Formula: ((140 - Age) * Weight(kg)) / (72 * SerumCreatinine(mg/dL)) * (0.85 if female)
   * Source: Cockcroft DW, Gault MH. Nephron 1976; NCCN Chemotherapy Order Templates Appendix A/B
   */
  function calculateCockcroftGault(params) {
    params = params || {};
    var age = Number(params.age);
    var weightKg = Number(params.weightKg != null ? params.weightKg : params.weight);
    var scr = Number(params.serumCreatinine != null ? params.serumCreatinine : params.creatinine);
    var sex = String(params.sex || "").toLowerCase();
    var isFemale = (sex === "f" || sex === "female");

    if (!(age >= 1 && age <= 120) || !(weightKg > 0) || !(scr > 0)) {
      return { crcl: null, warnings: ["Incomplete parameters for Cockcroft-Gault (requires age [1-120], weight > 0 kg, creatinine > 0)."] };
    }

    // Auto-detect umol/L vs mg/dL: values > 25 are almost universally umol/L in clinical lab ranges
    var scrMgDl = scr;
    if (params.unit === "umol/L" || params.unit === "µmol/L" || scr > 25) {
      scrMgDl = scr / 88.4;
    }

    var scrEff = scrMgDl;
    var isFloored = false;
    if (params.creatinineFloor > 0 && scrMgDl < params.creatinineFloor) {
      scrEff = params.creatinineFloor;
      isFloored = true;
    }

    var crcl = ((140 - age) * weightKg) / (72 * scrEff);
    if (isFemale) crcl *= 0.85;

    var warnings = [];
    if (isFloored) {
      warnings.push("Serum creatinine floored from " + round2(scrMgDl) + " to " + params.creatinineFloor + " mg/dL (low-muscle-mass safety convention).");
    }

    return {
      crcl: round2(crcl),
      serumCreatinineMgDl: round2(scrMgDl),
      isFloored: isFloored,
      formula: "Cockcroft-Gault: ((140 - age) x weight) / (72 x SCr) x (0.85 if female)",
      citation: "Cockcroft DW, Gault MH. Nephron 1976; NCCN Chemotherapy Order Templates Appendix A/B",
      warnings: warnings
    };
  }

  /**
   * Calvert Formula for Carboplatin Total Dose (mg)
   * Formula: Total Dose (mg) = Target AUC * (min(GFR, 125) + 25)
   * Standard safety rule: GFR is capped at 125 mL/min per ASCO / FDA / NCCN guidelines to prevent lethal myelosuppression.
   * Source: Calvert AH et al. J Clin Oncol 1989; FDA Carboplatin Dosing Guidance; NCCN Appendix A/B
   */
  function calculateCalvertCarboplatin(params) {
    params = params || {};
    var auc = Number(params.targetAuc != null ? params.targetAuc : params.auc);
    var gfr = params.gfr != null ? Number(params.gfr) : (params.crcl != null ? Number(params.crcl) : null);
    var warnings = [];

    // If GFR/CrCl not directly provided, try computing via Cockcroft-Gault
    if (gfr == null && (params.serumCreatinine != null || params.creatinine != null) && params.age && (params.weightKg || params.weight)) {
      var cg = calculateCockcroftGault(params);
      gfr = cg.crcl;
      if (cg.warnings && cg.warnings.length) warnings = warnings.concat(cg.warnings);
    }

    if (!(auc > 0) || !(gfr > 0)) {
      return { totalDoseMg: null, warnings: ["Requires valid target AUC (> 0) and GFR/CrCl (> 0) to calculate Calvert Carboplatin dose."] };
    }

    // Standard safety capping at GFR = 125 mL/min (ASCO / FDA / NCCN Chemotherapy Order Templates)
    var capGfr = params.capGfrAt125 !== false; // default true
    var gfrUsed = gfr;
    var isGfrCapped = false;

    if (capGfr && gfr > 125) {
      gfrUsed = 125;
      isGfrCapped = true;
      warnings.push("GFR capped at 125 mL/min per ASCO/FDA/NCCN safety guidance (maximum GFR for Calvert formula).");
    }

    var uncappedDose = auc * (gfr + 25);
    var totalDose = auc * (gfrUsed + 25);

    var maxDoseCapApplied = false;
    if (params.maxDoseMg > 0 && totalDose > params.maxDoseMg) {
      totalDose = params.maxDoseMg;
      maxDoseCapApplied = true;
      warnings.push("Dose capped at maximum limit of " + params.maxDoseMg + " mg.");
    }

    return {
      totalDoseMg: round2(totalDose),
      uncappedDoseMg: round2(uncappedDose),
      targetAuc: auc,
      gfrUsed: round2(gfrUsed),
      originalGfr: round2(gfr),
      isGfrCapped: isGfrCapped,
      maxDoseCapApplied: maxDoseCapApplied,
      formula: "Calvert: Total Dose (mg) = Target AUC x (min(GFR, 125) + 25)",
      citation: "Calvert AH et al. J Clin Oncol 1989; FDA Carboplatin Labeling; NCCN Appendix A/B",
      warnings: warnings
    };
  }

  /**
   * WardSync / EMR Patient Labs & Vitals Ingestion Adapter
   * Safely reads patient identity, vitals, and latest laboratory results from GHIS / WardSynQ / OPDEMR
   */
  function fetchWardSyncPatientLabs(source) {
    source = source || (typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
    var out = {
      patient: null,
      vitals: { age: null, sex: null, weightKg: null, heightCm: null },
      labs: { serumCreatinine: null, crcl: null, totalBilirubin: null, anc: null, platelets: null, ast: null, alt: null },
      source: "none"
    };
    if (!source) return out;

    try {
      var pt = null;
      if (source.GHIS && source.GHIS.getSelectedPatient) pt = source.GHIS.getSelectedPatient();
      else if (source.GHISMEDS && source.GHISMEDS.getSelectedPatient) pt = source.GHISMEDS.getSelectedPatient();
      else if (source.WARD && source.WARD.getSelectedPatient) pt = source.WARD.getSelectedPatient();
      else if (source.OPDEMR && source.OPDEMR.currentPatient) pt = source.OPDEMR.currentPatient();

      if (pt) {
        out.patient = { id: pt.patientId || pt.id || "", name: pt.name || "" };
        out.vitals.age = pt.age != null ? Number(pt.age) : null;
        out.vitals.sex = pt.sex || pt.gender || null;
        out.vitals.weightKg = pt.weightKg != null ? Number(pt.weightKg) : (pt.weight != null ? Number(pt.weight) : null);
        out.vitals.heightCm = pt.heightCm != null ? Number(pt.heightCm) : (pt.height != null ? Number(pt.height) : null);
        out.source = "WardSynQ/EMR";

        var l = pt.labs || pt.latestLabs || {};
        out.labs.serumCreatinine = l.creatinine != null ? Number(l.creatinine) : (l.scr != null ? Number(l.scr) : null);
        out.labs.totalBilirubin = l.totalBilirubin != null ? Number(l.totalBilirubin) : (l.bili != null ? Number(l.bili) : null);
        out.labs.anc = l.anc != null ? Number(l.anc) : null;
        out.labs.platelets = l.platelets != null ? Number(l.platelets) : (l.plt != null ? Number(l.plt) : null);

        if (out.labs.serumCreatinine && out.vitals.age && out.vitals.weightKg) {
          var cg = calculateCockcroftGault({
            age: out.vitals.age,
            weightKg: out.vitals.weightKg,
            serumCreatinine: out.labs.serumCreatinine,
            sex: out.vitals.sex
          });
          out.labs.crcl = cg.crcl;
        }
      }
    } catch (e) {}

    return out;
  }

  function evaluateOrganDoseModifications(protocol, labs, calculatedDoses, patientContext) {
    protocol = protocol || {};
    labs = labs || {};
    calculatedDoses = calculatedDoses || {};
    patientContext = patientContext || {};

    var drugs = protocol.drugs || [];
    var adjustments = [];
    var warnings = [];

    var crcl = labs.crcl != null ? Number(labs.crcl) : null;
    var scr = labs.serumCreatinine != null ? labs.serumCreatinine : (labs.creatinine != null ? labs.creatinine : null);
    var pt = patientContext.patient ? patientContext : (labs.patient ? labs.patient : patientContext);
    var age = labs.age != null ? labs.age : pt.age;
    var weightKg = labs.weightKg != null ? labs.weightKg : (labs.weight != null ? labs.weight : pt.weightKg || pt.weight);
    var sex = labs.sex != null ? labs.sex : pt.sex;

    // Direct Creatinine in box -> auto-derive Cockcroft-Gault CrCl
    if (crcl == null && scr != null && age && weightKg) {
      var cg = calculateCockcroftGault({
        age: age,
        weightKg: weightKg,
        serumCreatinine: scr,
        sex: sex,
        creatinineFloor: labs.creatinineFloor
      });
      if (cg.crcl != null) {
        crcl = cg.crcl;
        if (cg.warnings && cg.warnings.length) {
          warnings = warnings.concat(cg.warnings);
        }
      }
    }

    var totalBili = labs.totalBili != null ? Number(labs.totalBili) : (labs.totalBilirubin != null ? Number(labs.totalBilirubin) : null);
    var anc = labs.anc != null ? Number(labs.anc) : null;
    var platelets = labs.platelets != null ? Number(labs.platelets) : null;

    if (anc != null && anc < 1500) {
      warnings.push("Day 1 Neutropenia: ANC " + anc + "/mcL is below 1,500/mcL threshold. Cytotoxic cycle delay recommended until ANC >= 1,500/mcL.");
    }
    if (platelets != null && platelets < 100000) {
      warnings.push("Day 1 Thrombocytopenia: Platelet count " + platelets + "/mcL is below 100,000/mcL threshold. Cytotoxic cycle delay recommended until Platelets >= 100,000/mcL.");
    }

    // Calvert Carboplatin evaluation
    var calvertResult = null;
    for (var d = 0; d < drugs.length; d++) {
      var cd = drugs[d];
      var cdId = String(cd.id || "").toLowerCase();
      if (cdId === "carboplatin" || cd.basis === "auc") {
        var aucVal = cd.dosePerUnit || 5;
        if (crcl != null && aucVal > 0) {
          calvertResult = calculateCalvertCarboplatin({
            targetAuc: aucVal,
            gfr: crcl,
            capGfrAt125: true,
            maxDoseMg: cd.caps ? cd.caps.perDose : null
          });
        }
        break;
      }
    }

    for (var i = 0; i < drugs.length; i++) {
      var drug = drugs[i];
      var drugId = String(drug.id || "").toLowerCase();
      var drugRules = ORGAN_RULES[drugId] || [];

      for (var r = 0; r < drugRules.length; r++) {
        var rule = drugRules[r];
        var triggered = false;

        if (rule.metric === "crcl" && crcl != null) {
          if (rule.condition(crcl)) triggered = true;
        } else if (rule.metric === "totalBili" && totalBili != null) {
          if (rule.condition(totalBili)) triggered = true;
        } else if (rule.metric === "hepaticEnzymes") {
          if (rule.condition(labs)) triggered = true;
        }

        if (triggered) {
          var origDose = calculatedDoses[drug.id] != null ? calculatedDoses[drug.id] : (drug.basis === "flat" ? drug.dosePerUnit : null);
          var suggestedDose = origDose != null ? round2(origDose * (rule.recommendedPercent / 100)) : null;

          adjustments.push({
            drugId: drug.id,
            drugName: drug.name || drug.id,
            organ: rule.organ,
            metric: rule.metric,
            action: rule.action,
            recommendedPercent: rule.recommendedPercent,
            originalDose: origDose,
            suggestedDose: suggestedDose,
            unit: drug.unit,
            text: rule.text,
            citation: rule.citation
          });
          break;
        }
      }
    }

    return {
      protocolId: protocol.id,
      protocolName: protocol.name,
      labsEvaluated: {
        serumCreatinine: scr != null ? Number(scr) : null,
        crcl: crcl,
        totalBili: totalBili,
        anc: anc,
        platelets: platelets
      },
      hasModifications: adjustments.length > 0,
      adjustments: adjustments,
      warnings: warnings,
      calvertCarboplatin: calvertResult
    };
  }

  var API = {
    evaluateOrganDoseModifications: evaluateOrganDoseModifications,
    calculateCockcroftGault: calculateCockcroftGault,
    calculateCalvertCarboplatin: calculateCalvertCarboplatin,
    fetchWardSyncPatientLabs: fetchWardSyncPatientLabs,
    ORGAN_RULES: ORGAN_RULES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  root.SMD_ONCO_ORGAN_DOSE = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
