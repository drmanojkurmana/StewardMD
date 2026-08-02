/* insulin-engine.js - pure insulin dose math. No DOM, no storage.
 * Every function returns a transparent breakdown:
 *   { result, rounded, unit, steps:[{label,expr,value}], formula, assumptions, clinicalNotes, refs }
 * On missing/invalid input it returns { result:null, ..., error }.
 * Dual export: window.INSULIN_ENGINE (app) + module.exports (node --test). */
(function () {
  "use strict";

  function ok(x) { return typeof x === "number" && isFinite(x); }
  function roundDose(x, increment) { var inc = increment || 1; return Math.round(x / inc) * inc; }
  function mmol(mgdl) { return Math.round((mgdl / 18) * 10) / 10; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function r2(x) { return Math.round(x * 100) / 100; }

  function ERR(formula) {
    return { result: null, rounded: null, unit: "units", steps: [],
      formula: formula, assumptions: [], clinicalNotes: [],
      refs: [], error: "Enter all required values." };
  }

  function correctionDose(v) {
    var formula = "correction = (glucose - target) / ISF";
    if (!ok(v.glucose) || !ok(v.target) || !ok(v.isf) || v.isf <= 0) return ERR(formula);
    var inc = v.increment || 1;
    var gap = v.glucose - v.target;
    var raw = gap > 0 ? gap / v.isf : 0;
    var rounded = roundDose(raw, inc);
    return {
      result: r1(raw),
      rounded: rounded,
      unit: "units",
      steps: [
        { label: "Glucose above target", expr: v.glucose + " - " + v.target + " mg/dL", value: gap },
        { label: "Divide by ISF", expr: gap + " / " + v.isf + " (mg/dL per unit)", value: r2(raw) },
        { label: "Round to " + inc + " unit", expr: "round(" + r2(raw) + ")", value: rounded }
      ],
      formula: formula,
      assumptions: [
        "ISF (insulin sensitivity factor) is in mg/dL lowered per unit.",
        "No correction is given when glucose is at or below target.",
        "Target " + v.target + " mg/dL (" + mmol(v.target) + " mmol/L)."
      ],
      clinicalNotes: ["Verify the patient's current ISF; it changes with regimen, illness, and time of day."],
      refs: ["ADA Standards of Care in Diabetes - correction-factor method."]
    };
  }

  function mealBolus(v) {
    var formula = "meal bolus = carbohydrate grams / ICR";
    if (!ok(v.carbs) || !ok(v.icr) || v.icr <= 0) return ERR(formula);
    var inc = v.increment || 1;
    var raw = v.carbs / v.icr;
    var rounded = roundDose(raw, inc);
    return {
      result: r1(raw),
      rounded: rounded,
      unit: "units",
      steps: [
        { label: "Carbohydrates", expr: v.carbs + " g", value: v.carbs },
        { label: "Divide by ICR", expr: v.carbs + " / " + v.icr + " (g per unit)", value: r2(raw) },
        { label: "Round to " + inc + " unit", expr: "round(" + r2(raw) + ")", value: rounded }
      ],
      formula: formula,
      assumptions: ["ICR (insulin-to-carbohydrate ratio) is grams of carbohydrate covered by 1 unit."],
      clinicalNotes: ["Confirm carbohydrate counting is accurate; estimation error propagates directly to the dose."],
      refs: ["ADA Standards of Care - carbohydrate-ratio method (500 rule for initial estimate)."]
    };
  }

  function activeInsulin(v) {
    var formula = "IOB = sum of dose x remaining-fraction; linear remaining = 1 - (elapsed / DIA)";
    if (!ok(v.dia) || v.dia <= 0 || !v.doses || !v.doses.length) {
      return { result: 0, rounded: 0, unit: "units", model: v.model || "linear", steps: [],
        formula: formula,
        assumptions: ["No active doses recorded, or duration of insulin action missing; IOB treated as 0."],
        clinicalNotes: [], refs: [] };
    }
    var model = v.model || "linear";
    var iob = 0, steps = [];
    for (var i = 0; i < v.doses.length; i++) {
      var d = v.doses[i];
      if (!ok(d.units) || !ok(d.minutesAgo)) continue;
      var elapsedH = d.minutesAgo / 60;
      var frac = clamp01(1 - elapsedH / v.dia);   // linear model
      var contrib = d.units * frac;
      iob += contrib;
      steps.push({ label: d.units + "u given " + d.minutesAgo + " min ago",
        expr: d.units + " x (1 - " + r2(elapsedH) + "/" + v.dia + ")",
        value: r2(contrib) });
    }
    var rounded = r1(iob);
    return {
      result: rounded, rounded: rounded, unit: "units", model: model, steps: steps,
      formula: formula,
      assumptions: [
        "Linear insulin-decay model; real pharmacodynamics are curved, so this is a conservative estimate.",
        "Duration of insulin action (DIA) = " + v.dia + " h; set from the selected rapid-acting insulin."
      ],
      clinicalNotes: ["IOB should be subtracted from a new correction dose to avoid insulin stacking."],
      refs: ["Insulin-on-board / active-insulin-time pump conventions (linear and curvilinear models)."]
    };
  }

  function combinedDose(v) {
    var formula = "total = (carbs / ICR) + max(0, (glucose - target) / ISF) - IOB";
    if (!ok(v.carbs) || !ok(v.icr) || v.icr <= 0 || !ok(v.glucose) || !ok(v.target) || !ok(v.isf) || v.isf <= 0)
      return ERR(formula);
    var inc = v.increment || 1;
    var iob = ok(v.iob) ? v.iob : 0;
    var meal = r1(v.carbs / v.icr);
    var gap = v.glucose - v.target;
    var corr = r1(gap > 0 ? gap / v.isf : 0);
    var rawTotal = meal + corr - iob;
    if (rawTotal < 0) rawTotal = 0;
    var rounded = roundDose(rawTotal, inc);
    return {
      result: r1(rawTotal), rounded: rounded, unit: "units",
      mealComponent: meal, correctionComponent: corr, iobSubtracted: iob,
      steps: [
        { label: "Meal bolus", expr: v.carbs + " g / " + v.icr, value: meal },
        { label: "Correction", expr: "max(0, (" + v.glucose + " - " + v.target + ") / " + v.isf + ")", value: corr },
        { label: "Subtract active insulin (IOB)", expr: meal + " + " + corr + " - " + iob, value: r2(rawTotal) },
        { label: "Round to " + inc + " unit", expr: "round(" + r2(rawTotal) + ")", value: rounded }
      ],
      formula: formula,
      assumptions: [
        "IOB is subtracted from the correction so a stacked dose is not double-counted.",
        "Meal coverage is never reduced below what the carbohydrates require.",
        "Total is floored at 0 units."
      ],
      clinicalNotes: ["If IOB is unknown, treat this total as an overestimate and reassess before dosing."],
      refs: ["Bolus-calculator conventions (meal + correction - IOB)."]
    };
  }

  function isfFromTdd(v) {
    var rule = v.rule || 1800;
    var formula = "ISF = " + rule + " / TDD (mg/dL per unit)";
    if (!ok(v.tdd) || v.tdd <= 0) return ERR(formula);
    var isf = r1(rule / v.tdd);
    return {
      result: isf, rounded: isf, unit: "mg/dL per unit",
      steps: [{ label: "Apply the " + rule + " rule", expr: rule + " / " + v.tdd, value: isf }],
      formula: formula,
      assumptions: [
        "1800 rule for rapid-acting analogues; use 1500 for regular insulin.",
        "ISF " + isf + " mg/dL per unit is approximately " + mmol(isf) + " mmol/L per unit."
      ],
      clinicalNotes: ["An estimate only; titrate against the patient's actual glucose response."],
      refs: ["1800 / 1500 rule (Davidson); ADA Standards of Care."]
    };
  }

  function icrFromTdd(v) {
    var rule = v.rule || 500;
    var formula = "ICR = " + rule + " / TDD (g carbohydrate per unit)";
    if (!ok(v.tdd) || v.tdd <= 0) return ERR(formula);
    var icr = r1(rule / v.tdd);
    return {
      result: icr, rounded: icr, unit: "g per unit",
      steps: [{ label: "Apply the " + rule + " rule", expr: rule + " / " + v.tdd, value: icr }],
      formula: formula,
      assumptions: ["500 rule for rapid-acting analogues; use 450 for regular insulin."],
      clinicalNotes: ["An estimate only; titrate against post-prandial glucose."],
      refs: ["500 / 450 rule; ADA Standards of Care."]
    };
  }

  function basalInitiation(v) {
    var formula = "TDD = weight x factor; basal = TDD x basalFraction; meal bolus each = (TDD - basal) / 3";
    if (!ok(v.weightKg) || v.weightKg <= 0) return ERR(formula);
    var factor = ok(v.tddFactor) ? v.tddFactor : 0.4;
    var frac = ok(v.basalFraction) ? v.basalFraction : 0.5;
    var inc = v.increment || 1;
    var tdd = Math.round(v.weightKg * factor);
    var basal = Math.round(tdd * frac);
    var mealEach = roundDose((tdd - basal) / 3, inc);
    return {
      result: tdd, rounded: tdd, unit: "units/day", tdd: tdd, basal: basal, mealBolusEach: mealEach,
      steps: [
        { label: "Total daily dose", expr: v.weightKg + " kg x " + factor + " u/kg/day", value: tdd },
        { label: "Basal share", expr: tdd + " x " + frac, value: basal },
        { label: "Meal bolus each (3 meals)", expr: "(" + tdd + " - " + basal + ") / 3", value: mealEach }
      ],
      formula: formula,
      assumptions: [
        "Starting factor " + factor + " u/kg/day (typical range 0.3 to 0.5; lower in renal impairment or type 1 honeymoon).",
        "Basal fraction " + frac + " (50/50 basal-bolus split is the configurable default)."
      ],
      clinicalNotes: [
        "A conservative initiation estimate. Start low, titrate to glucose targets, and reassess within days.",
        "Not for type 1 ketosis-prone initiation without specialist input."
      ],
      refs: ["Weight-based insulin initiation; ADA / AACE inpatient and outpatient guidance."]
    };
  }

  function pediatricInit(v) {
    var formula = "TDD = weight x factor; basal = TDD x basalFraction; meal bolus = (TDD - basal) / 3";
    if (!ok(v.weightKg) || v.weightKg <= 0) return ERR(formula);
    var stageFactor = { prepubertal: 0.5, newlydx: 0.6, pubertal: 0.9 };
    var factor = ok(v.factor) ? v.factor : (stageFactor[v.stage] || 0.5);
    var frac = ok(v.basalFraction) ? v.basalFraction : 0.5;
    var inc = v.increment || 0.5;                 // paediatric doses often titrated in 0.5 u steps
    var tdd = r1(v.weightKg * factor);
    var basal = roundDose(tdd * frac, inc);
    var mealEach = roundDose((tdd - basal) / 3, inc);
    return {
      result: tdd, rounded: tdd, unit: "units/day", tdd: tdd, basal: basal, mealBolusEach: mealEach,
      steps: [
        { label: "Total daily dose", expr: v.weightKg + " kg x " + factor + " u/kg/day", value: tdd },
        { label: "Basal share", expr: tdd + " x " + frac, value: basal },
        { label: "Meal bolus each (3 meals)", expr: "(" + tdd + " - " + basal + ") / 3", value: mealEach }
      ],
      formula: formula,
      assumptions: [
        "Weight-based paediatric initiation. Starting factor " + factor + " u/kg/day (" + (v.stage || "prepubertal") +
          "); typical ranges: prepubertal 0.4 to 0.6, newly diagnosed 0.5 to 0.75, pubertal 0.7 to 1.0.",
        "Honeymoon-phase and very young children need lower doses; titrate in " + inc + " unit steps.",
        "Basal-bolus split " + frac + " (configurable)."
      ],
      clinicalNotes: [
        "Paediatric insulin is specialist-guided. Do not initiate without paediatric diabetes input.",
        "Not for diabetic ketoacidosis - use the DKA protocol instead.",
        "Monitor closely for hypoglycaemia; titrate to age-appropriate glucose targets."
      ],
      refs: ["ISPAD Clinical Practice Consensus Guidelines - weight-based paediatric insulin initiation."]
    };
  }

  function dkaInsulin(v) {
    var formula = "fixed-rate IV insulin infusion = weight x rate-per-kg (units/hour)";
    if (!ok(v.weightKg) || v.weightKg <= 0) return ERR(formula);
    var rate = ok(v.ratePerKg) ? v.ratePerKg : 0.1;   // 0.1 u/kg/h default; 0.05 an option / paediatric
    var raw = v.weightKg * rate;
    var capped = ok(v.maxRate) ? Math.min(raw, v.maxRate) : raw;
    var rounded = r1(capped);
    return {
      result: rounded, rounded: rounded, unit: "units/hour",
      steps: [{ label: "Fixed-rate infusion", expr: v.weightKg + " kg x " + rate + " u/kg/h", value: r1(raw) }]
        .concat(ok(v.maxRate) && raw > v.maxRate ? [{ label: "Capped at protocol max", expr: "min(" + r1(raw) + ", " + v.maxRate + ")", value: rounded }] : []),
      formula: formula,
      assumptions: [
        "Fixed-rate intravenous insulin infusion (FRIII) at " + rate + " units/kg/hour" + (v.paeds ? " (paediatric)" : "") + ".",
        "Start ONLY after intravenous fluid resuscitation has begun.",
        "No initial intravenous bolus in standard adult and paediatric DKA protocols."
      ],
      monitoring: [
        "Check capillary glucose and ketones hourly; potassium and venous pH / bicarbonate every 1 to 2 hours initially.",
        "Add intravenous dextrose (e.g. 10%) once glucose falls below about 250 to 300 mg/dL, continuing insulin to clear ketones.",
        "Aim to reduce glucose by about 50 to 75 mg/dL per hour; if it is not falling, review hydration and the infusion.",
        "Do not stop the infusion for glucose alone - continue until ketoacidosis resolves (ketones low, pH and bicarbonate corrected)."
      ],
      clinicalNotes: [
        "For TRAINED CLINICIANS following an institutional DKA protocol only.",
        "Potassium: do not start or continue insulin if potassium is below 3.3 mmol/L until it is replaced; add potassium to fluids per protocol.",
        v.paeds ? "Paediatric DKA: watch for cerebral oedema; use 0.05 to 0.1 u/kg/h, no bolus, and cautious fluids."
          : "Overlap with subcutaneous basal insulin before stopping the infusion to avoid rebound ketosis."
      ],
      refs: ["ADA / JBDS-IP adult DKA guidance; ISPAD paediatric DKA guidance. Follow your institutional protocol."]
    };
  }

  var API = {
    roundDose: roundDose, mmol: mmol,
    correctionDose: correctionDose, mealBolus: mealBolus, activeInsulin: activeInsulin,
    combinedDose: combinedDose, isfFromTdd: isfFromTdd, icrFromTdd: icrFromTdd,
    basalInitiation: basalInitiation, pediatricInit: pediatricInit, dkaInsulin: dkaInsulin
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_ENGINE = API;
})();
