/* StewardMD - oncology dose engine. PURE: no DOM, no fetch, no window. Decision-support only.
 * Every computed value is clinician-confirmed downstream; a missing input yields a warning and a
 * null final, NEVER a guessed number (never-invent). Physician modification is layered by the caller,
 * not here. Formulas re-derived locally (2 lines each) because calculators.js exposes only
 * window.MEDCALC (no module.exports); calculators.js is the cited source of truth per function.
 * window.SMD_ONCODOSE + module.exports. */
(function (root) {
  "use strict";

  function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

  // BSA (Mosteller). Source: calculators.js:878-889; NCCN Chemotherapy Order Templates Appendix A/B.
  function bsaMosteller(hCm, wKg) {
    if (!(hCm > 0) || !(wKg > 0)) return null;
    return Math.sqrt((hCm * wKg) / 3600);
  }

  // Creatinine clearance (Cockcroft-Gault), mL/min, x0.85 for female.
  // Source: calculators.js:539-552; NCCN Chemotherapy Order Templates Appendix A/B.
  // OPT-IN creatinine floor (o.creatinineFloor, mg/dL; default undefined/OFF): when supplied, a serum
  // creatinine below the floor is clamped UP to it, so GFR is not overestimated in low-muscle-mass /
  // elderly / cachectic patients. The floor VALUE is caller-supplied (commonly cited choices are 0.7 or
  // 0.8 mg/dL); this engine never hardcodes one as universal. Ref: standard oncology pharmacy practice;
  // NCCN Chemotherapy Order Templates Appendix A/B.
  function gfrCockcroft(o) {
    o = o || {};
    var age = o.age, wKg = o.wKg, scr = o.scr;
    if (!(age >= 1 && age <= 120) || !(wKg > 0) || !(scr > 0)) return null;  // age bound mirrors calculators.js:549 (age>140 would give a negative GFR)
    var scrEff = (o.creatinineFloor > 0 && scr < o.creatinineFloor) ? o.creatinineFloor : scr;  // opt-in floor: OFF unless a floor is supplied
    var g = ((140 - age) * wKg) / (72 * scrEff);
    if (String(o.sex || "").toLowerCase().charAt(0) === "f") g *= 0.85;
    return g;
  }

  // Carboplatin (Calvert), mg. GFR capped at 125. Source: calculators.js:2369-2381; NCCN Chemotherapy Order Templates Appendix A/B.
  // An OPT-IN absolute mg cap on the FINAL carboplatin dose is applied downstream in doseForDrug
  // (params.carboplatinMaxDoseMg), in addition to this GFR<=125 cap. That cap VALUE is caller-supplied
  // (pharmacy AUC-dosing safety practice); it is never defaulted here.
  function calvert(auc, gfr) {
    if (!(auc > 0) || !(gfr > 0)) return null;
    return auc * (Math.min(gfr, 125) + 25);
  }

  function roundDose(mg, rule) {
    if (mg == null) return null;
    if (!rule || !rule.increment) return mg;
    return Math.round(mg / rule.increment) * rule.increment;
  }

  // Only applies a cap the drug/protocol data explicitly defines. No universal cap.
  function applyCap(mg, capSpec) {
    if (mg == null) return { mg: null, capApplied: false };
    var cap = capSpec ? capSpec.perDose : null;
    if (cap != null && mg > cap) return { mg: cap, capApplied: true };
    return { mg: mg, capApplied: false };
  }

  // --- OPT-IN obese-patient weight adjustment (default OFF) ------------------------------------
  // Devine ideal body weight (IBW), kg: males 50 + 2.3 per inch over 60 in; females 45.5 + 2.3 per inch
  // over 60 in (inches under 60 add nothing). Source: Devine (1974) IBW formula; NCCN Chemotherapy Order
  // Templates Appendix A/B. sex defaults to male when not "f", matching gfrCockcroft's convention.
  function ibwDevine(hCm, sex) {
    if (!(hCm > 0)) return null;
    var over60 = Math.max(0, (hCm / 2.54) - 60);
    var base = String(sex || "").toLowerCase().charAt(0) === "f" ? 45.5 : 50;
    return base + 2.3 * over60;
  }
  // Adjusted (adjusted-ideal) body weight: AIBW = IBW + 0.4 * (actual - IBW).
  // Source: standard adjusted body weight formula; NCCN Chemotherapy Order Templates Appendix A/B.
  function aibwCalc(actualKg, ibwKg) {
    if (!(actualKg > 0) || !(ibwKg > 0)) return null;
    return ibwKg + 0.4 * (actualKg - ibwKg);
  }
  // Resolve the weight input for dosing. weightStrategy unset => actual weight (legacy, byte-identical).
  // weightStrategy "aibw" => AIBW for the obese, but ONLY once actual weight exceeds IBW by a
  // caller-supplied aibwThreshold (kg); the obesity threshold is NEVER hardcoded here. Requires height,
  // sex, actual weight AND aibwThreshold; any missing => never-invent warning + null weight (dose
  // withheld), NEVER a silent fall back to actual weight. Below threshold => actual weight is used.
  function resolveWeight(params) {
    if (params.weightStrategy !== "aibw") return { weight: params.weight, warnings: [] };
    var warns = [];
    var s = String(params.sex || "").toLowerCase().charAt(0);
    if (!(params.height > 0) || (s !== "m" && s !== "f") || !(params.weight > 0) || !(params.aibwThreshold >= 0)) {
      warns.push("weightStrategy 'aibw' requires height, sex, actual weight and a caller-supplied aibwThreshold (kg over IBW) - not computable, dose withheld (never-invent). Devine IBW + Adjusted Body Weight; NCCN Chemotherapy Order Templates Appendix A/B.");
      return { weight: null, warnings: warns };
    }
    var ibw = ibwDevine(params.height, params.sex);
    if (params.weight > ibw + params.aibwThreshold) {
      var adj = aibwCalc(params.weight, ibw);
      warns.push("weight adjusted to AIBW " + round2(adj) + " kg (Devine IBW " + round2(ibw) + " kg; actual " + params.weight + " kg exceeds IBW + caller threshold " + params.aibwThreshold + " kg); AIBW = IBW + 0.4*(actual - IBW); NCCN Chemotherapy Order Templates Appendix A/B.");
      return { weight: adj, warnings: warns };
    }
    warns.push("weightStrategy 'aibw': actual weight " + params.weight + " kg does not exceed Devine IBW " + round2(ibw) + " kg + caller threshold " + params.aibwThreshold + " kg; actual weight used. NCCN Chemotherapy Order Templates Appendix A/B.");
    return { weight: params.weight, warnings: warns };
  }

  // Full dose lineage for one drug: protocol -> calculated -> rounded -> (cap) -> final.
  function doseForDrug(drug, params) {
    drug = drug || {}; params = params || {};
    var lin = {
      drugId: drug.id, basis: drug.basis, protocolDose: drug.dosePerUnit, unit: drug.unit,
      inputs: {}, calculated: null, rounded: null, capApplied: false, final: null,
      source: drug.source || null, warnings: []
    };
    // OPT-IN weight strategy (default OFF): resolve the effective weight input BEFORE any basis math.
    // With weightStrategy unset, wEff === params.weight, so behavior is byte-identical to the legacy path.
    var wr = resolveWeight(params);
    var wEff = wr.weight;
    for (var wi = 0; wi < wr.warnings.length; wi++) lin.warnings.push(wr.warnings[wi]);
    var scrFloored = (params.creatinineFloor > 0 && params.creatinine > 0 && params.creatinine < params.creatinineFloor);  // opt-in: OFF unless a floor is supplied
    var bsa, gfr, calc = null;
    switch (drug.basis) {
      case "bsa":
        bsa = (params.bsa > 0) ? params.bsa : bsaMosteller(params.height, wEff);
        lin.inputs.bsa = round2(bsa);
        if (bsa == null) { lin.warnings.push("Missing height/weight - BSA not computable"); break; }
        calc = drug.dosePerUnit * bsa; break;
      case "auc":
        gfr = (params.gfr > 0) ? params.gfr : gfrCockcroft({ age: params.age, wKg: wEff, scr: params.creatinine, sex: params.sex, creatinineFloor: params.creatinineFloor });
        lin.inputs.gfr = round2(gfr);
        if (gfr == null) { lin.warnings.push("Missing creatinine/age/weight - Calvert (AUC) not computable"); break; }
        if (scrFloored && !(params.gfr > 0)) lin.warnings.push("creatinine floored from " + params.creatinine + " to " + params.creatinineFloor + " mg/dL per Cockcroft-Gault low-muscle-mass pharmacy practice (commonly cited floors 0.7-0.8 mg/dL; NCCN Chemotherapy Order Templates Appendix A/B).");
        calc = calvert(drug.dosePerUnit, gfr); break;
      case "mgkg":
        lin.inputs.weight = wEff;
        if (!(wEff > 0)) { lin.warnings.push("Missing weight - mg/kg not computable"); break; }
        calc = drug.dosePerUnit * wEff; break;
      case "flat":
        calc = drug.dosePerUnit; break;
      default:
        lin.warnings.push("Unknown dosing basis: " + drug.basis); break;
    }
    if (calc == null || !isFinite(calc)) {        // never-invent: missing OR malformed input -> no guessed number (NaN != null, so isFinite guards a bad dosePerUnit)
      if (!lin.warnings.length) lin.warnings.push("Invalid or missing dose input");
      return lin;
    }
    lin.calculated = round2(calc);
    lin.rounded = roundDose(calc, drug.roundingRule);
    var capped = applyCap(lin.rounded, drug.caps);
    lin.capApplied = capped.capApplied;
    lin.final = capped.mg;
    // OPT-IN carboplatin absolute mg cap (params.carboplatinMaxDoseMg; default OFF): pharmacy AUC-dosing
    // safety practice, in addition to the Calvert GFR<=125 cap. The cap VALUE is caller-supplied; never defaulted.
    if (drug.basis === "auc" && params.carboplatinMaxDoseMg > 0 && lin.final != null && lin.final > params.carboplatinMaxDoseMg) {
      lin.final = params.carboplatinMaxDoseMg;
      lin.capApplied = true;
      lin.warnings.push("carboplatin final dose capped at absolute " + params.carboplatinMaxDoseMg + " mg (caller-supplied pharmacy AUC-dosing safety cap; NCCN Chemotherapy Order Templates Appendix A/B). Calvert GFR is separately capped at 125 mL/min.");
    }
    // A cumulative lifetime cap (e.g. anthracyclines) is NOT auto-enforced in v1 (needs cross-encounter
    // history, Phase 5). Surface it so the absence of enforcement is never silent (R1 requirement).
    var cl = drug.caps && drug.caps.cumulativeLifetime;
    if (cl) lin.warnings.push("Cumulative lifetime dose (warn " + cl.warn + " / hard " + cl.hard + " " + (cl.unit || "mg/m2") + ") is NOT auto-enforced in v1 - verify prior exposure manually.");
    return lin;
  }

  // Every drug in a template -> lineage[]; drives the matrix and the PDF from one call.
  function planDoses(template, params) {
    template = template || {};
    return (template.drugs || []).map(function (d) { return doseForDrug(d, params); });
  }

  var API = {
    bsaMosteller: bsaMosteller, gfrCockcroft: gfrCockcroft, calvert: calvert,
    ibwDevine: ibwDevine, aibwCalc: aibwCalc,
    roundDose: roundDose, applyCap: applyCap, doseForDrug: doseForDrug, planDoses: planDoses,
    _version: "1.0"
  };
  if (root) root.SMD_ONCODOSE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
