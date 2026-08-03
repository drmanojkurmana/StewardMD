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
    var withIob = ok(v.iob) && v.iob > 0;
    var formula = withIob ? "correction = max(0, (glucose - target) / ISF - IOB)"
                          : "correction = (glucose - target) / ISF";
    if (!ok(v.glucose) || !ok(v.target) || !ok(v.isf) || v.isf <= 0) return ERR(formula);
    var inc = v.increment || 1;
    var iob = withIob ? v.iob : 0;
    var gap = v.glucose - v.target;
    var gross = gap > 0 ? gap / v.isf : 0;
    // Insulin already acting is working on THIS glucose, so it must be netted off the
    // correction — giving the gross dose on top of active insulin is textbook stacking
    // and a leading cause of iatrogenic hypoglycaemia.
    var raw = gross - iob; if (raw < 0) raw = 0;
    var rounded = roundDose(raw, inc);
    var steps = [
      { label: "Glucose above target", expr: v.glucose + " - " + v.target + " mg/dL", value: gap },
      { label: "Divide by ISF", expr: gap + " / " + v.isf + " (mg/dL per unit)", value: r2(gross) }
    ];
    if (withIob) steps.push({ label: "Subtract active insulin (IOB)", expr: r2(gross) + " - " + iob, value: r2(raw) });
    steps.push({ label: "Round to " + inc + " unit", expr: "round(" + r2(raw) + ")", value: rounded });
    return {
      result: r1(raw),
      rounded: rounded,
      unit: "units",
      grossCorrection: r1(gross),
      iobSubtracted: iob,
      steps: steps,
      formula: formula,
      assumptions: [
        "ISF (insulin sensitivity factor) is in mg/dL lowered per unit.",
        "No correction is given when glucose is at or below target.",
        withIob ? "Active insulin (" + iob + " u) is netted off the correction to prevent stacking."
                : "No active insulin entered - if a bolus was given within the insulin's duration of action, enter it or this dose may stack.",
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
    var formula = "total = (carbs / ICR) + max(0, (glucose - target) / ISF - IOB)";
    if (!ok(v.carbs) || !ok(v.icr) || v.icr <= 0 || !ok(v.glucose) || !ok(v.target) || !ok(v.isf) || v.isf <= 0)
      return ERR(formula);
    var inc = v.increment || 1;
    var iob = (ok(v.iob) && v.iob > 0) ? v.iob : 0;
    var meal = r1(v.carbs / v.icr);
    var gap = v.glucose - v.target;
    var corr = r1(gap > 0 ? gap / v.isf : 0);
    // IOB is netted off the CORRECTION ONLY, never off carbohydrate cover: the food about
    // to be eaten still needs its full bolus, whereas active insulin is already working on
    // the current glucose. Subtracting IOB from the total under-doses the meal and causes
    // post-prandial hyperglycaemia (standard bolus-calculator behaviour).
    var corrNet = corr - iob; if (corrNet < 0) corrNet = 0;
    var rawTotal = meal + corrNet;
    var rounded = roundDose(rawTotal, inc);
    return {
      result: r1(rawTotal), rounded: rounded, unit: "units",
      mealComponent: meal, correctionComponent: corr, correctionAfterIob: r1(corrNet), iobSubtracted: iob,
      steps: [
        { label: "Meal bolus", expr: v.carbs + " g / " + v.icr, value: meal },
        { label: "Correction", expr: "max(0, (" + v.glucose + " - " + v.target + ") / " + v.isf + ")", value: corr },
        { label: "Subtract active insulin (IOB) from the correction", expr: "max(0, " + corr + " - " + iob + ")", value: r1(corrNet) },
        { label: "Add meal cover back", expr: meal + " + " + r1(corrNet), value: r2(rawTotal) },
        { label: "Round to " + inc + " unit", expr: "round(" + r2(rawTotal) + ")", value: rounded }
      ],
      formula: formula,
      assumptions: [
        "IOB is subtracted from the correction only, so a stacked correction is not double-counted.",
        "Meal coverage is never reduced below what the carbohydrates require.",
        "The correction component is floored at 0 units."
      ],
      clinicalNotes: [
        "If IOB is unknown, treat the correction part as an overestimate and reassess before dosing.",
        iob > 0 && corr > 0 && corr - iob <= 0
          ? "Active insulin already covers the whole correction - only the meal bolus is advised."
          : "Recheck glucose before giving any further correction within the insulin's duration of action."
      ],
      refs: ["Bolus-calculator conventions (meal bolus + [correction - IOB])."]
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

  /* Guideline-based adjustment of the WEIGHT-BASED starting dose for patient context.
   * Only conditions with a quantified, guideline-backed adjustment change the number:
   *   Renal  - insulin is renally cleared, so requirements FALL as GFR falls:
   *            eGFR 10-50 -> 75% of dose, eGFR <10 (or dialysis) -> 50%.
   *   Pregnancy - requirements RISE through gestation; standard initiation is
   *            ~0.7 (T1), 0.8 (T2), 0.9 (T3) u/kg/day, with tighter targets.
   * Hepatic disease and glucocorticoids have NO validated multiplier (direction is
   * real but the magnitude is patient-specific), so they never silently scale the
   * dose - they return explicit guidance instead. */
  function contextAdjust(ctx) {
    ctx = ctx || {};
    var out = { suggestedFactor: null, multiplier: 1, applied: [], advisories: [] };

    if (ctx.pregnancy) {
      var tri = ctx.trimester === 1 ? 1 : ctx.trimester === 2 ? 2 : ctx.trimester === 3 ? 3 : null;
      var triFactor = { 1: 0.7, 2: 0.8, 3: 0.9 };
      if (tri) {
        out.suggestedFactor = triFactor[tri];
        out.applied.push("Pregnancy (trimester " + tri + "): starting factor " + triFactor[tri] +
          " u/kg/day - insulin requirement rises through gestation.");
      } else {
        out.advisories.push("Pregnancy: requirements rise through gestation (about 0.7 u/kg/day in the 1st trimester, 0.8 in the 2nd, 0.9 to 1.0 in the 3rd). Select a trimester to apply the right starting factor.");
      }
      out.advisories.push("Pregnancy targets are tighter: fasting under 95 mg/dL (5.3 mmol/L), 1-hour post-prandial under 140 (7.8), 2-hour under 120 (6.7).");
      out.advisories.push("Requirements often DIP in early pregnancy (hypoglycaemia risk) and FALL abruptly after delivery - reduce the dose immediately post-partum.");
    }

    if (ctx.renal || ok(ctx.egfr)) {
      var e = ok(ctx.egfr) ? ctx.egfr : null;
      if (ctx.dialysis || (e !== null && e < 10)) {
        out.multiplier *= 0.5;
        out.applied.push("Renal" + (e !== null ? " (eGFR " + e + ")" : " (dialysis)") + ": dose reduced to 50% - insulin clearance is markedly reduced.");
      } else if (e !== null && e < 50) {
        out.multiplier *= 0.75;
        out.applied.push("Renal (eGFR " + e + "): dose reduced to 75% - reduced insulin clearance raises hypoglycaemia risk.");
      } else if (e !== null) {
        out.advisories.push("eGFR " + e + " mL/min: no reduction applied (reduction starts below 50).");
      } else {
        out.multiplier *= 0.75;
        out.applied.push("Renal impairment flagged without an eGFR: dose reduced to 75% (the eGFR 10-50 band). Enter an eGFR to refine - below 10 the reduction is 50%.");
      }
    }

    if (ctx.hepatic) {
      out.advisories.push("Liver disease: no validated dose multiplier exists - requirements are unpredictable (insulin resistance raises them, while impaired gluconeogenesis and reduced hepatic insulin clearance raise hypoglycaemia risk, especially overnight/fasting). Start at the low end, avoid excess basal, and monitor closely.");
    }
    if (ctx.steroids) {
      out.advisories.push("Glucocorticoids: requirements rise, mainly post-prandial and daytime with morning steroid. Expect to increase PRANDIAL insulin first (basal often changes little) and to taper insulin as the steroid is reduced - no fixed multiplier applies.");
    }
    return out;
  }

  /* Context advice for a BOLUS (meal / correction / combined).
   * Deliberately does NOT silently rescale the bolus: ICR and ISF are entered per
   * patient and may already reflect renal function or gestation, so multiplying on
   * top would double-count and under-dose. Instead each active context returns a
   * CONCRETE suggested figure plus the condition under which it applies, so the
   * clinician can see the adjusted number and decide.
   *   dose = the computed (rounded) bolus in units. */
  function bolusContextAdvice(dose, ctx) {
    ctx = ctx || {};
    var out = [];
    if (!ok(dose) || dose <= 0) return out;

    if (ctx.exercise) {
      // The one context with a direct, guideline-backed bolus adjustment.
      out.push({ id: "exercise", label: "Before exercise", value: r1(dose * 0.5) + " to " + r1(dose * 0.75) + " units",
        detail: "Reduce the pre-exercise meal bolus by 25 to 50% (more for longer or more intense activity). Watch for delayed hypoglycaemia for up to 24 hours afterwards." });
    }
    if (ctx.renal || ok(ctx.egfr)) {
      var e = ok(ctx.egfr) ? ctx.egfr : null;
      var mult = (ctx.dialysis || (e !== null && e < 10)) ? 0.5 : (e === null || e < 50) ? 0.75 : 1;
      if (mult !== 1) {
        out.push({ id: "renal", label: "If ICR/ISF not already renal-adjusted", value: r1(dose * mult) + " units",
          detail: "Insulin is renally cleared" + (e !== null ? " (eGFR " + e + ")" : "") + ", so requirements fall to about " +
            Math.round(mult * 100) + "% . Apply this ONLY if the ICR/ISF above were not already derived for this renal function - otherwise the reduction is already included and cutting again will under-dose." });
      }
    }
    if (ctx.pregnancy) {
      out.push({ id: "pregnancy", label: "Pregnancy targets", value: "fasting <95 mg/dL",
        detail: "1-hour post-prandial under 140, 2-hour under 120 mg/dL. Requirements RISE through gestation, so ICR and ISF need frequent revision (ratios fall); they drop abruptly after delivery." });
    }
    if (ctx.steroids) {
      out.push({ id: "steroids", label: "On glucocorticoids", value: "expect higher prandial need",
        detail: "Steroid hyperglycaemia is mainly post-prandial and daytime. Increase the PRANDIAL dose first and taper as the steroid reduces - no fixed multiplier applies." });
    }
    if (ctx.hepatic) {
      out.push({ id: "hepatic", label: "Liver disease", value: "no fixed adjustment",
        detail: "Requirements are unpredictable: resistance raises them, while impaired gluconeogenesis and reduced hepatic clearance raise hypoglycaemia risk (especially fasting/overnight). Dose at the low end and monitor." });
    }
    return out;
  }

  function basalInitiation(v) {
    var formula = "TDD = weight x factor (context-adjusted); basal = TDD x basalFraction; meal bolus each = (TDD - basal) / 3";
    if (!ok(v.weightKg) || v.weightKg <= 0) return ERR(formula);
    var adj = contextAdjust(v.ctx);
    var userFactor = ok(v.tddFactor) ? v.tddFactor : 0.4;
    // A guideline factor for pregnancy supersedes the generic default, but is stated openly.
    var factor = adj.suggestedFactor != null ? adj.suggestedFactor : userFactor;
    if (adj.suggestedFactor != null && ok(v.tddFactor) && v.tddFactor !== adj.suggestedFactor)
      adj.applied.push("Selected factor " + v.tddFactor + " u/kg/day replaced by the pregnancy factor " + adj.suggestedFactor + ".");
    var frac = ok(v.basalFraction) ? v.basalFraction : 0.5;
    var inc = v.increment || 1;
    var preTdd = v.weightKg * factor;
    var tdd = Math.round(preTdd * adj.multiplier);
    var basal = Math.round(tdd * frac);
    var mealEach = roundDose((tdd - basal) / 3, inc);
    var steps = [{ label: "Total daily dose", expr: v.weightKg + " kg x " + factor + " u/kg/day", value: r1(preTdd) }];
    if (adj.multiplier !== 1)
      steps.push({ label: "Context adjustment", expr: r1(preTdd) + " x " + adj.multiplier, value: tdd });
    steps.push({ label: "Basal share", expr: tdd + " x " + frac, value: basal });
    steps.push({ label: "Meal bolus each (3 meals)", expr: "(" + tdd + " - " + basal + ") / 3", value: mealEach });
    return {
      result: tdd, rounded: tdd, unit: "units/day", tdd: tdd, basal: basal, mealBolusEach: mealEach,
      contextFactor: factor, contextMultiplier: adj.multiplier, contextApplied: adj.applied,
      steps: steps,
      formula: formula,
      assumptions: [
        "Starting factor " + factor + " u/kg/day (typical range 0.3 to 0.5 outside pregnancy; lower in renal impairment or type 1 honeymoon)." +
          (adj.multiplier !== 1 ? " Context multiplier " + adj.multiplier + " applied." : ""),
        "Basal fraction " + frac + " (50/50 basal-bolus split is the configurable default)."
      ].concat(adj.applied),
      clinicalNotes: [
        "A conservative initiation estimate. Start low, titrate to glucose targets, and reassess within days.",
        "Not for type 1 ketosis-prone initiation without specialist input."
      ].concat(adj.advisories),
      refs: ["Weight-based insulin initiation; ADA / AACE guidance. Renal banding (eGFR 10-50 -> 75%, <10 -> 50%). Pregnancy: ADA Standards of Care / ACOG - trimester factors and targets."]
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
    contextAdjust: contextAdjust, bolusContextAdvice: bolusContextAdvice,
    basalInitiation: basalInitiation, pediatricInit: pediatricInit, dkaInsulin: dkaInsulin
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_ENGINE = API;
})();
