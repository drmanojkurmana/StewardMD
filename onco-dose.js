/* StewardMD - oncology dose engine. PURE: no DOM, no fetch, no window. Decision-support only.
 * Every computed value is clinician-confirmed downstream; a missing input yields a warning and a
 * null final, NEVER a guessed number (never-invent). Physician modification is layered by the caller,
 * not here. Formulas re-derived locally (2 lines each) because calculators.js exposes only
 * window.MEDCALC (no module.exports); calculators.js is the cited source of truth per function.
 * window.SMD_ONCODOSE + module.exports. */
(function (root) {
  "use strict";

  function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

  // BSA (Mosteller). Source: calculators.js:878-889.
  function bsaMosteller(hCm, wKg) {
    if (!(hCm > 0) || !(wKg > 0)) return null;
    return Math.sqrt((hCm * wKg) / 3600);
  }

  // Creatinine clearance (Cockcroft-Gault), mL/min, x0.85 for female. Source: calculators.js:539-552.
  function gfrCockcroft(o) {
    o = o || {};
    var age = o.age, wKg = o.wKg, scr = o.scr;
    if (!(age >= 1 && age <= 120) || !(wKg > 0) || !(scr > 0)) return null;  // age bound mirrors calculators.js:549 (age>140 would give a negative GFR)
    var g = ((140 - age) * wKg) / (72 * scr);
    if (String(o.sex || "").toLowerCase().charAt(0) === "f") g *= 0.85;
    return g;
  }

  // Carboplatin (Calvert), mg. GFR capped at 125. Source: calculators.js:2369-2381.
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

  // Full dose lineage for one drug: protocol -> calculated -> rounded -> (cap) -> final.
  function doseForDrug(drug, params) {
    drug = drug || {}; params = params || {};
    var lin = {
      drugId: drug.id, basis: drug.basis, protocolDose: drug.dosePerUnit, unit: drug.unit,
      inputs: {}, calculated: null, rounded: null, capApplied: false, final: null,
      source: drug.source || null, warnings: []
    };
    var bsa, gfr, calc = null;
    switch (drug.basis) {
      case "bsa":
        bsa = (params.bsa > 0) ? params.bsa : bsaMosteller(params.height, params.weight);
        lin.inputs.bsa = round2(bsa);
        if (bsa == null) { lin.warnings.push("Missing height/weight - BSA not computable"); break; }
        calc = drug.dosePerUnit * bsa; break;
      case "auc":
        gfr = (params.gfr > 0) ? params.gfr : gfrCockcroft({ age: params.age, wKg: params.weight, scr: params.creatinine, sex: params.sex });
        lin.inputs.gfr = round2(gfr);
        if (gfr == null) { lin.warnings.push("Missing creatinine/age/weight - Calvert (AUC) not computable"); break; }
        calc = calvert(drug.dosePerUnit, gfr); break;
      case "mgkg":
        lin.inputs.weight = params.weight;
        if (!(params.weight > 0)) { lin.warnings.push("Missing weight - mg/kg not computable"); break; }
        calc = drug.dosePerUnit * params.weight; break;
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
    roundDose: roundDose, applyCap: applyCap, doseForDrug: doseForDrug, planDoses: planDoses,
    _version: "1.0"
  };
  if (root) root.SMD_ONCODOSE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
