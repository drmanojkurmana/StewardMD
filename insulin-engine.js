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

  /* Single reduction factor APPLIED to a bolus for patient context.
   * Direction rule: contexts that LOWER insulin need scale the dose; contexts that
   * RAISE it (pregnancy, steroids) are never auto-increased - silently giving more
   * insulin is the one direction that can kill, so those stay advisory (pregnancy
   * instead changes the TARGET, which raises the correction legitimately).
   *
   * NEVER MULTIPLY THE FACTORS TOGETHER. No guideline supports compounding them, and
   * a CKD + cirrhotic + walking patient is common on a ward: 0.75^3 = 0.42 is a 58%
   * cut nobody prescribed. The most restrictive SINGLE factor wins; the ones that lost
   * are still returned in `considered` so the clinician sees they were weighed.
   *   renal    eGFR 10-50 -> x0.75, <10/dialysis -> x0.5   (guideline banding, APPLIED)
   *   exercise x0.75 - cautious end of the 25-50% pre-exercise reduction (APPLIED)
   *   hepatic  ADVISORY ONLY - no validated multiplier exists, so inventing one and
   *            applying it silently is worse than saying so. See contextAdjust(). */
  function bolusContextFactor(ctx) {
    ctx = ctx || {};
    var cands = [], i;
    // STRICTLY gated on the chip: a stale eGFR left in state must never keep
    // reducing the dose after Renal is unticked.
    if (ctx.renal) {
      var e = ok(ctx.egfr) ? ctx.egfr : null;
      var m = (ctx.dialysis || (e !== null && e < 10)) ? 0.5 : (e === null || e < 50) ? 0.75 : 1;
      if (m !== 1) cands.push({ id: "renal", mult: m, why: "Renal" + (e !== null ? " (eGFR " + e + ")" : " (no eGFR entered - assuming the eGFR 10-50 band)") + ": insulin is renally cleared, requirement falls to " + Math.round(m * 100) + "%" + (e === null ? ". Enter an eGFR to refine: above 50 there is no reduction, below 10 it is 50%." : "") });
    }
    if (ctx.exercise) cands.push({ id: "exercise", mult: 0.75, why: "Exercise: 25% reduction applied (guideline range 25 to 50% - reduce further for longer or harder activity)" });
    if (!cands.length) return { factor: 1, applied: [], considered: [] };
    var win = cands[0];
    for (i = 1; i < cands.length; i++) if (cands[i].mult < win.mult) win = cands[i];
    var considered = [];
    for (i = 0; i < cands.length; i++) if (cands[i] !== win) considered.push(cands[i]);
    return { factor: win.mult, applied: [win], considered: considered };
  }
  // Apply the context factor to a computed bolus, appending transparent steps.
  function applyBolusCtx(raw, inc, ctx, steps) {
    var c = bolusContextFactor(ctx);
    if (c.factor === 1 || !(raw > 0)) return { raw: raw, rounded: roundDose(raw, inc), ctx: c };
    var adj = raw * c.factor;
    c.applied.forEach(function (a) { steps.push({ label: "Context: " + a.id, expr: "x " + a.mult + " - " + a.why, value: null }); });
    // Show what was weighed but NOT applied, so "why didn't renal reduce it too?" is answered
    // on the screen instead of being an invisible decision.
    (c.considered || []).forEach(function (a) {
      steps.push({ label: "Also considered: " + a.id, expr: "x " + a.mult + " not applied - factors are never multiplied, the most restrictive one wins", value: null });
    });
    steps.push({ label: "Context-adjusted dose", expr: r2(raw) + " x " + c.factor, value: r2(adj) });
    return { raw: adj, rounded: roundDose(adj, inc), ctx: c };
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
    var cx = applyBolusCtx(raw, inc, v.ctx, steps); raw = cx.raw; rounded = cx.rounded;
    steps.push({ label: "Round to " + inc + " unit", expr: "round(" + r2(raw) + ")", value: rounded });
    return {
      result: r1(raw),
      rounded: rounded,
      unit: "units",
      grossCorrection: r1(gross),
      iobSubtracted: iob,
      contextFactor: cx.ctx.factor, contextApplied: cx.ctx.applied,
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
    var steps = [
      { label: "Carbohydrates", expr: v.carbs + " g", value: v.carbs },
      { label: "Divide by ICR", expr: v.carbs + " / " + v.icr + " (g per unit)", value: r2(raw) }
    ];
    var cxm = applyBolusCtx(raw, inc, v.ctx, steps); raw = cxm.raw;
    var rounded = cxm.rounded;
    steps.push({ label: "Round to " + inc + " unit", expr: "round(" + r2(raw) + ")", value: rounded });
    return {
      result: r1(raw),
      rounded: rounded,
      unit: "units",
      contextFactor: cxm.ctx.factor, contextApplied: cxm.ctx.applied,
      steps: steps,
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
    var cSteps = [
      { label: "Meal bolus", expr: v.carbs + " g / " + v.icr, value: meal },
      { label: "Correction", expr: "max(0, (" + v.glucose + " - " + v.target + ") / " + v.isf + ")", value: corr },
      { label: "Subtract active insulin (IOB) from the correction", expr: "max(0, " + corr + " - " + iob + ")", value: r1(corrNet) },
      { label: "Add meal cover back", expr: meal + " + " + r1(corrNet), value: r2(rawTotal) }
    ];
    var cxc = applyBolusCtx(rawTotal, inc, v.ctx, cSteps); rawTotal = cxc.raw;
    var rounded = cxc.rounded;
    cSteps.push({ label: "Round to " + inc + " unit", expr: "round(" + r2(rawTotal) + ")", value: rounded });
    return {
      result: r1(rawTotal), rounded: rounded, unit: "units",
      mealComponent: meal, correctionComponent: corr, correctionAfterIob: r1(corrNet), iobSubtracted: iob,
      contextFactor: cxc.ctx.factor, contextApplied: cxc.ctx.applied,
      steps: cSteps,
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
      // trimester only has meaning while Pregnancy is selected (this whole block is gated on it)
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

    if (ctx.renal) {                                  // chip-gated, see bolusContextFactor
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

  /* Context advice for a BOLUS (meal / correction / combined). EXPLAINS, never re-applies.
   * There is exactly ONE place a bolus is rescaled - bolusContextFactor - and this is not
   * it. Every entry below either states what that factor already did, or gives guidance for
   * a context that deliberately has no multiplier (hepatic, pregnancy, steroids).
   * Adding a reduction here would double-count against an already-reduced dose.
   *   dose = the computed (rounded) bolus in units, AFTER the context factor. */
  function bolusContextAdvice(dose, ctx) {
    ctx = ctx || {};
    var out = [];
    if (!ok(dose) || dose <= 0) return out;

    // Renal and exercise are APPLIED to the dose (see bolusContextFactor). `dose` here is
    // ALREADY reduced, so re-suggesting a reduction of it would double-count: a 9 u dose
    // becomes 6 u, and advising "3 to 4.5 u" on top lands the patient on a third of the
    // dose. They only EXPLAIN what was done; they never restate a reduction.
    if (ctx.exercise) {
      out.push({ id: "exercise", label: "Exercise reduction already applied", value: "-25%, now " + r1(dose) + " units",
        detail: "The 25% pre-exercise reduction is already in the dose shown. Do NOT reduce again. For longer or more intense activity you may go to -50% (" + r1(dose / 0.75 * 0.5) + " units of the unreduced dose). Watch for delayed hypoglycaemia for up to 24 hours afterwards." });
    }
    if (ctx.renal) {
      out.push({ id: "renal", label: "Renal reduction already applied", value: r1(dose) + " units",
        detail: "The renal banding is already in the dose shown. Do not reduce again. Recheck if renal function is still falling." });
    }
    if (ctx.hepatic) {
      // Deliberately NOT applied as a multiplier - no validated one exists.
      out.push({ id: "hepatic", label: "Liver disease", value: "not auto-reduced",
        detail: "No validated dose multiplier exists, so nothing was applied silently. Requirements are unpredictable: insulin resistance raises them, while impaired gluconeogenesis and reduced hepatic clearance raise hypoglycaemia risk, especially fasting and overnight. Start at the low end, avoid excess basal, monitor closely." });
    }
    if (ctx.pregnancy) {
      out.push({ id: "pregnancy", label: "Pregnancy targets applied", value: "fasting <95 mg/dL",
        detail: "1-hour post-prandial under 140, 2-hour under 120 mg/dL. The correction target is tightened rather than scaling the dose, so any increase comes from the target you can see and override. Requirements RISE through gestation (ICR/ISF need frequent revision) and drop abruptly after delivery." });
    }
    if (ctx.steroids) {
      out.push({ id: "steroids", label: "On glucocorticoids", value: "not auto-increased",
        detail: "Steroid hyperglycaemia is mainly post-prandial and daytime. Insulin is never auto-increased here - raising a dose silently is the one direction that can cause harm. Increase the PRANDIAL dose yourself and taper as the steroid reduces." });
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
    // An override of the user's own explicit input must never be silent - it goes in the
    // advisories (surfaced as a clinical note) as well as the assumptions.
    var factorOverridden = adj.suggestedFactor != null && ok(v.tddFactor) && v.tddFactor !== adj.suggestedFactor;
    if (factorOverridden) {
      var swap = "Your selected factor " + v.tddFactor + " u/kg/day was REPLACED by the pregnancy factor " +
        adj.suggestedFactor + " u/kg/day. Clear the Pregnancy chip to use your own factor.";
      adj.applied.push(swap); adj.advisories.unshift(swap);
    }
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
      factorOverridden: factorOverridden,
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

  /* First-dose / no-prior-data CORRECTION.
   * A patient may need a correction before any insulin history exists. This resolves the two inputs the
   * plain correctionDose assumes are known — ISF and IOB — three ways, each carrying its PROVENANCE so an
   * estimate is never shown as a measured value, then defers the arithmetic to correctionDose (single
   * source of truth; no duplicated math). Safety-routes DKA/HHS and paediatric away from a routine bolus.
   *   ISF:  v.isf (known)  >  v.tdd (ISF = rule/TDD)  >  v.weightKg x v.tddFactor -> TDD -> ISF (estimate)
   *   IOB:  v.priorDose {units,minutesAgo}+v.dia (activeInsulin)  >  0 (first dose / naive)  >  0 (assumed) */
  function firstDoseCorrection(v) {
    v = v || {};
    var ctx = v.ctx || {};
    var formula = "correction = (glucose - target) / ISF - IOB   (ISF resolved from known ISF / TDD / weight)";
    // 1) Exclusion routing — these need a different protocol, not a routine subcutaneous correction.
    var route = v.route || (ctx.dka ? "dka" : (ctx.pediatric || v.pediatric) ? "pediatric" : null);
    if (route === "dka") return { result: null, rounded: null, unit: "units", route: "dka", formula: formula,
      routing: "DKA/HHS selected. Use the DKA/HHS protocol (fixed-rate IV insulin after fluid resuscitation and a potassium check) - a routine correction bolus is not appropriate here.",
      clinicalNotes: ["Switch to the DKA infusion pathway."], refs: ["ADA/JBDS-IP DKA; do not give a routine SC correction in DKA/HHS."] };
    if (route === "pediatric") return { result: null, rounded: null, unit: "units", route: "pediatric", formula: formula,
      routing: "Paediatric patient. Use the weight-based paediatric insulin pathway (specialist-guided); a first-dose adult correction estimate is not appropriate.",
      clinicalNotes: ["Switch to the Pediatric pathway."], refs: ["ISPAD paediatric insulin guidance."] };

    var rule = v.rule || 1800;
    // 2) Resolve ISF with provenance.
    var isf, isfSource, tddEst = null, tddSource = null;
    if (ok(v.isf) && v.isf > 0) {
      isf = v.isf; isfSource = (ok(v.tdd) || ok(v.weightKg)) ? "entered (overrides the estimate)" : "known (entered)";
    } else if (ok(v.tdd) && v.tdd > 0) {
      isf = isfFromTdd({ tdd: v.tdd, rule: rule }).result; tddEst = v.tdd;
      tddSource = "entered (known usual TDD)"; isfSource = "estimated from TDD " + v.tdd + " u/day (" + rule + " rule)";
    } else if (ok(v.weightKg) && v.weightKg > 0) {
      var factor = ok(v.tddFactor) ? v.tddFactor : 0.3;   // conservative insulin-naive default — shown as an ASSUMPTION, editable
      tddEst = Math.round(v.weightKg * factor);
      tddSource = "estimated: " + v.weightKg + " kg x " + factor + " u/kg/day (assumption, NOT a measured value)";
      isf = isfFromTdd({ tdd: tddEst, rule: rule }).result;
      isfSource = "estimated from the estimated TDD (" + rule + " rule)";
    } else {
      return { result: null, rounded: null, unit: "units", formula: formula,
        assumptions: ["Provide a known ISF, a known TDD, or a weight to estimate the ISF."] };
    }

    // 3) Resolve IOB with provenance — never fabricate.
    var iob = 0, iobSource;
    if (v.priorDose && ok(v.priorDose.units) && v.priorDose.units > 0 && ok(v.priorDose.minutesAgo) && ok(v.dia) && v.dia > 0) {
      iob = activeInsulin({ dia: v.dia, doses: [{ units: v.priorDose.units, minutesAgo: v.priorDose.minutesAgo }] }).result;
      iobSource = iob + " u active from a prior " + v.priorDose.units + " u rapid-acting dose " + v.priorDose.minutesAgo + " min ago (linear model, DIA " + v.dia + " h)";
    } else if (v.insulinNaive || v.firstDose) {
      iob = 0; iobSource = "0 u - no previous rapid-acting insulin reported";
    } else {
      iob = 0; iobSource = "0 u assumed - no prior rapid-acting dose/timing entered; if one was given within its duration of action, enter it or this may stack";
    }

    // 4) Defer the arithmetic to correctionDose (also applies the renal/hepatic/exercise context factor + floors at 0).
    var cd = correctionDose({ glucose: v.glucose, target: v.target, isf: isf, iob: iob, increment: v.increment, ctx: ctx });
    if (cd.result == null) return cd;   // propagate the guard (missing glucose/target)

    // 5) Augment with first-dose provenance so nothing estimated reads as measured.
    cd.isf = isf; cd.isfSource = isfSource; cd.iobSource = iobSource;
    cd.tddEstimated = tddEst; cd.tddSource = tddSource; cd.firstDose = true;
    cd.provenance = [{ label: "ISF", value: isf + " mg/dL/u", source: isfSource }, { label: "IOB", value: iob + " u", source: iobSource }]
      .concat(tddEst != null ? [{ label: "TDD", value: tddEst + " u/day", source: tddSource }] : []);
    cd.assumptions = ["ISF " + isf + " mg/dL/u - " + isfSource, "IOB " + iob + " u - " + iobSource]
      .concat(tddEst != null ? ["TDD " + tddEst + " u/day - " + tddSource] : []).concat(cd.assumptions || []);
    cd.clinicalNotes = (cd.clinicalNotes || []).concat(
      ["This derives a CORRECTION dose only - it does NOT set the patient's full basal-bolus regimen."]
        .concat((v.insulinNaive && tddEst != null) ? ["Insulin-naive: the estimated TDD is used ONLY to derive an ISF for this correction, not as a starting daily dose."] : []));
    return cd;
  }

  /* ==================================================================================
   * WARD WORKFLOWS
   * The carb-counting bolus calculators above answer a type 1 outpatient question.
   * These answer the questions actually asked on a ward round. Every factor here is
   * pinned to a named guideline in `refs` rather than to a house rule.
   * ================================================================================== */

  /* Basal titration - the commonest insulin decision there is: "fasting is 190 on 20 u
   * of glargine, what do I write?". Initiation alone cannot answer it.
   * ADA SoC 2026 ch.9: titrate 2 units every 3 days to a fasting target of 80-130 mg/dL;
   * for unexplained hypoglycaemia reduce 10-20%; above 0.5 u/kg/day the problem is
   * overbasalization and the answer is prandial cover, NOT more basal.
   *   v = { currentDose, fastingGlucose | fastingValues[], targetLow, targetHigh,
   *         weightKg, hypoEpisode, method:"units"|"percent" } */
  function basalTitration(v) {
    v = v || {};
    var formula = "new basal = current basal +/- titration step, judged on fasting glucose";
    var cur = v.currentDose;
    if (!ok(cur) || cur < 0) return ERR(formula);
    var vals = (v.fastingValues || []).filter(function (x) { return ok(x); });
    if (!vals.length && ok(v.fastingGlucose)) vals = [v.fastingGlucose];
    if (!vals.length) return ERR(formula);

    var lo = ok(v.targetLow) ? v.targetLow : 80, hi = ok(v.targetHigh) ? v.targetHigh : 130;
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var lowest = Math.min.apply(null, vals);
    var pct = v.method === "percent";
    var steps = [{ label: "Fasting glucose used", expr: vals.join(", ") + " mg/dL" + (vals.length > 1 ? " (mean " + r1(mean) + ")" : ""), value: r1(mean) }];
    var newDose = cur, action, why, severity = "routine";

    // Hypoglycaemia always wins over a high mean - never titrate up through a low.
    var hypo = v.hypoEpisode || lowest < 70;
    if (hypo) {
      var cut = lowest < 54 ? 0.2 : 0.1;
      newDose = Math.max(0, roundDose(cur * (1 - cut), 1));
      action = "REDUCE"; severity = "hypo";
      why = "Hypoglycaemia" + (lowest < 70 ? " (lowest fasting " + lowest + " mg/dL)" : " reported") +
        ": reduce the basal by " + Math.round(cut * 100) + "% and look for a cause before titrating up again.";
      steps.push({ label: "Reduce for hypoglycaemia", expr: cur + " x " + (1 - cut), value: newDose });
    } else if (mean > hi) {
      var step = pct ? Math.max(1, roundDose(cur * 0.1, 1)) : 2;
      newDose = cur + step;
      action = "INCREASE";
      why = "Mean fasting " + r1(mean) + " mg/dL is above the " + lo + " to " + hi + " target: increase by " +
        step + " units and hold for 3 days before the next change.";
      steps.push({ label: pct ? "Increase 10%" : "Increase by 2 units (ADA 2-by-3 rule)", expr: cur + " + " + step, value: newDose });
    } else if (mean < lo) {
      newDose = Math.max(0, roundDose(cur * 0.9, 1));
      action = "REDUCE";
      why = "Mean fasting " + r1(mean) + " mg/dL is below target: reduce by 10% to avoid a nocturnal low.";
      steps.push({ label: "Reduce 10%", expr: cur + " x 0.9", value: newDose });
    } else {
      action = "HOLD";
      why = "Mean fasting " + r1(mean) + " mg/dL is within the " + lo + " to " + hi + " target: no change.";
      steps.push({ label: "Within target", expr: "no change", value: cur });
    }

    // Overbasalization: more basal is the wrong answer above ~0.5 u/kg/day.
    var perKg = ok(v.weightKg) && v.weightKg > 0 ? r2(newDose / v.weightKg) : null;
    var over = perKg !== null && perKg > 0.5;
    var notes = [
      "Hold each change for 3 days before the next one: basal analogues need 3 to 4 days to reach steady state.",
      "Titrate on FASTING glucose only. A high post-meal reading is a prandial problem, not a basal one."
    ];
    if (over && action === "INCREASE")
      notes.unshift("OVERBASALIZATION: " + newDose + " u is " + perKg + " u/kg/day, above the 0.5 u/kg/day ceiling. " +
        "Do not keep increasing the basal - add prandial insulin or a GLP-1 receptor agonist instead. Fasting is at target while the day is not.");
    else if (over)
      notes.unshift("Basal is " + perKg + " u/kg/day, above the 0.5 u/kg/day ceiling: reassess whether prandial cover is what is actually missing.");

    return {
      result: newDose, rounded: newDose, unit: "units/day",
      action: action, previousDose: cur, changeUnits: r1(newDose - cur), meanFasting: r1(mean),
      lowestFasting: lowest, perKg: perKg, overbasalization: over, severity: severity,
      steps: steps, formula: formula,
      assumptions: [
        "Fasting target " + lo + " to " + hi + " mg/dL (ADA default 80 to 130).",
        pct ? "Percentage method: 10% steps." : "ADA 2-by-3 rule: 2 units every 3 days.",
        "Titration judged on " + vals.length + " fasting value" + (vals.length > 1 ? "s" : "") + "."
      ],
      clinicalNotes: [why].concat(notes),
      refs: ["ADA Standards of Care in Diabetes 2026, ch.9 (Pharmacologic Approaches): basal titration 2 units every 3 days to fasting 80-130 mg/dL; 10-20% reduction for unexplained hypoglycaemia; intensify rather than over-basalize above 0.5 u/kg/day."]
    };
  }

  /* Correction (supplemental) scale - the printable q6h table a ward actually runs on.
   * Derived from THIS patient's ISF rather than a photocopied chart, then banded.
   * Resistance presets follow the usual sensitive / usual / resistant columns. */
  var SCALE_BANDS = [[150, 199], [200, 249], [250, 299], [300, 349], [350, 399], [400, null]];
  function correctionScale(v) {
    v = v || {};
    var formula = "units per band = (band midpoint - target) / ISF, rounded, capped";
    var rule = v.rule || 1800;
    var isf = null, tdd = null, src;
    if (ok(v.isf) && v.isf > 0) { isf = v.isf; src = "entered ISF"; }
    else if (ok(v.tdd) && v.tdd > 0) { tdd = v.tdd; isf = rule / tdd; src = "ISF from TDD " + tdd + " u/day (" + rule + " rule)"; }
    else if (ok(v.weightKg) && v.weightKg > 0) {
      var f = { sensitive: 0.3, usual: 0.4, resistant: 0.6 }[v.resistance || "usual"];
      tdd = Math.round(v.weightKg * f);
      isf = rule / tdd;
      src = "ISF from an estimated TDD (" + v.weightKg + " kg x " + f + " u/kg/day = " + tdd + " u/day, " + (v.resistance || "usual") + " sensitivity)";
    } else return ERR(formula);

    var target = ok(v.target) ? v.target : 150;
    var cap = ok(v.maxPerDose) ? v.maxPerDose : 10;
    var rows = SCALE_BANDS.map(function (b) {
      var mid = b[1] === null ? b[0] + 50 : (b[0] + b[1]) / 2;
      var u = Math.max(0, Math.round((mid - target) / isf));
      var capped = Math.min(u, cap);
      return { from: b[0], to: b[1], label: b[1] === null ? b[0] + " and above" : b[0] + " to " + b[1],
        units: capped, cappedAt: capped < u ? cap : null };
    });
    return {
      result: rows[0].units, rounded: rows[0].units, unit: "units", rows: rows,
      isf: r1(isf), tddUsed: tdd, target: target,
      steps: rows.map(function (r) { return { label: r.label + " mg/dL", expr: "(" + (r.to === null ? r.from + 50 : (r.from + r.to) / 2) + " - " + target + ") / " + r1(isf), value: r.units }; }),
      formula: formula,
      assumptions: [
        "Scale built from " + src + ", so it is this patient's scale, not a generic chart.",
        "Correction target " + target + " mg/dL. Nothing is given below " + SCALE_BANDS[0][0] + " mg/dL.",
        "Capped at " + cap + " units per dose."
      ],
      clinicalNotes: [
        "Give with a rapid-acting analogue before meals, or every 6 hours if the patient is not eating (every 4 hours only with a rapid analogue).",
        "A correction scale is SUPPLEMENTAL. Prolonged sliding-scale insulin WITHOUT basal is explicitly discouraged: if corrections are needed repeatedly, the basal or prandial dose is wrong.",
        "Recheck the scale daily and rebuild it if the total daily requirement moves."
      ],
      refs: ["ADA Standards of Care in Diabetes 2026, ch.16 (Diabetes Care in the Hospital): correction insulin before meals or every 4-6 h if not eating; prolonged correction-only regimens without basal are discouraged."]
    };
  }

  /* Inpatient basal-bolus initiation (RABBIT-2). The ward version of basalInitiation:
   * the starting factor comes from the admission glucose, not from a preference box. */
  function inpatientInit(v) {
    v = v || {};
    var formula = "TDD = weight x factor (0.4 or 0.5 by admission glucose; 0.3 if age >=70 or creatinine >=2.0); basal 50%, prandial 50% split over 3 meals";
    if (!ok(v.weightKg) || v.weightKg <= 0) return ERR(formula);
    var g = ok(v.glucose) ? v.glucose : null;
    var reduced = (ok(v.age) && v.age >= 70) || (ok(v.creatinine) && v.creatinine >= 2.0) ||
      (ok(v.egfr) && v.egfr < 45) || v.insulinNaiveFrail;
    var factor, why;
    if (reduced) {
      factor = 0.3;
      why = "0.3 u/kg/day: " + [ok(v.age) && v.age >= 70 ? "age " + v.age : null,
        ok(v.creatinine) && v.creatinine >= 2.0 ? "creatinine " + v.creatinine : null,
        ok(v.egfr) && v.egfr < 45 ? "eGFR " + v.egfr : null].filter(Boolean).join(", ") + " - the RABBIT-2 reduced-dose arm.";
    } else if (g !== null && g > 200) { factor = 0.5; why = "0.5 u/kg/day: admission glucose " + g + " mg/dL is above 200."; }
    else { factor = 0.4; why = "0.4 u/kg/day: admission glucose " + (g === null ? "not entered, using the lower starting factor" : g + " mg/dL is 200 or below") + "."; }

    var inc = v.increment || 1;
    var tdd = Math.round(v.weightKg * factor);
    var basal = Math.round(tdd * 0.5);
    var mealEach = roundDose((tdd - basal) / 3, inc);
    return {
      result: tdd, rounded: tdd, unit: "units/day", tdd: tdd, basal: basal, mealBolusEach: mealEach,
      factorUsed: factor, reducedDose: reduced,
      steps: [
        { label: "Total daily dose", expr: v.weightKg + " kg x " + factor + " u/kg/day", value: tdd },
        { label: "Basal (glargine/degludec) once daily", expr: tdd + " x 0.5", value: basal },
        { label: "Prandial each meal (rapid analogue)", expr: "(" + tdd + " - " + basal + ") / 3", value: mealEach }
      ],
      formula: formula,
      assumptions: [why, "Half basal, half prandial split over three meals.", "Hold the prandial dose if the patient does not eat that meal."],
      clinicalNotes: [
        "Add a correction scale on top of this regimen; do not run corrections alone.",
        "Inpatient target 140 to 180 mg/dL for most patients (100 to 180 is acceptable if achieved without hypoglycaemia).",
        "Stop oral agents that are unsafe inpatient (metformin if AKI or contrast, sulfonylureas if eating poorly, SGLT2 inhibitors if acutely unwell or fasting: euglycaemic ketoacidosis risk).",
        "Reassess the whole regimen every 24 hours against the last day of readings."
      ],
      refs: ["Umpierrez et al., RABBIT-2 (Diabetes Care 2007) and RABBIT-2 Surgery (Diabetes Care 2011): 0.4 u/kg/day for BG 140-200, 0.5 for BG 201-400, reduced to 0.3 for age >=70 or creatinine >=2.0. ADA Standards of Care 2026 ch.16 for targets."]
    };
  }

  /* NPO / nil by mouth. Basal continues, prandial stops. Getting this backwards is the
   * classic ward error in both directions: stopping basal in type 1 invites ketoacidosis,
   * continuing prandial in a fasting patient invites a hypo. */
  function npoRegimen(v) {
    v = v || {};
    var formula = "NPO: continue basal (reduced if type 2 or hypoglycaemia risk), hold prandial, correction every 4 to 6 hours";
    var basal = ok(v.basalDose) ? v.basalDose : (ok(v.tdd) ? Math.round(v.tdd * 0.5) : null);
    if (basal === null) return ERR(formula);
    var t1 = v.type1 || v.dxType === "T1DM";
    // Type 1 must never lose basal entirely; type 2 fasting usually tolerates a reduction.
    var keep = t1 ? 1 : (v.hypoRisk ? 0.5 : 0.8);
    var newBasal = Math.max(t1 ? 1 : 0, roundDose(basal * keep, v.increment || 1));
    return {
      result: newBasal, rounded: newBasal, unit: "units/day", basal: newBasal, previousBasal: basal,
      prandial: 0, correctionFrequency: "every 6 hours (every 4 hours if using a rapid analogue)",
      steps: [
        { label: "Basal insulin", expr: basal + " x " + keep + (t1 ? " (type 1: never stop basal)" : v.hypoRisk ? " (hypoglycaemia risk)" : " (type 2, fasting)"), value: newBasal },
        { label: "Prandial insulin", expr: "held while nil by mouth", value: 0 },
        { label: "Correction insulin", expr: "continue, every 4 to 6 h", value: null }
      ],
      formula: formula,
      assumptions: [
        t1 ? "TYPE 1: basal continues in full. Stopping basal in type 1 causes ketoacidosis even with a normal glucose."
           : "Type 2 and nil by mouth: basal reduced to " + Math.round(keep * 100) + "% to cover the fast.",
        "All prandial (mealtime) doses are held until the patient eats.",
        "Correction insulin continues on a 4 to 6 hourly schedule."
      ],
      clinicalNotes: [
        "Check capillary glucose every 4 to 6 hours while nil by mouth.",
        "If the fast runs beyond a few hours, or glucose falls, start 5% or 10% dextrose - do not simply withhold insulin in type 1.",
        "Restart prandial insulin with the first meal actually eaten, not when the diet is merely ordered.",
        "Hold SGLT2 inhibitors before a fast or surgery: euglycaemic ketoacidosis."
      ],
      refs: ["ADA Standards of Care in Diabetes 2026, ch.16: basal, or basal plus correction, is preferred for patients with inadequate or restricted oral intake; correction every 4-6 h if no meals are given."]
    };
  }

  /* Glucocorticoid cover. Steroid hyperglycaemia is mostly daytime and post-prandial, so
   * NPH given WITH the steroid matches the drug's own curve better than extra basal. */
  var STEROID_EQUIV = { prednisolone: 5, prednisone: 5, methylprednisolone: 4, dexamethasone: 0.75, hydrocortisone: 20 };
  function steroidCover(v) {
    v = v || {};
    var formula = "NPH = 0.1 u/kg/day per 10 mg prednisolone equivalent, capped at 0.4 u/kg/day";
    if (!ok(v.weightKg) || v.weightKg <= 0 || !ok(v.steroidMg) || v.steroidMg <= 0) return ERR(formula);
    var kind = v.steroid || "prednisolone";
    var eq = STEROID_EQUIV[kind] || 5;
    var predEq = v.steroidMg * (5 / eq);                  // convert to prednisolone-equivalent mg
    var perKgDay = Math.min(0.4, 0.1 * (predEq / 10));
    var dose = roundDose(v.weightKg * perKgDay, v.increment || 1);
    var once = kind === "dexamethasone" || v.longActingSteroid;
    return {
      result: dose, rounded: dose, unit: "units/day", nph: dose, prednisoloneEquivalent: r1(predEq),
      perKgDay: r2(perKgDay), cappedAtMax: perKgDay >= 0.4,
      steps: [
        { label: "Prednisolone equivalent", expr: v.steroidMg + " mg " + kind + " x (5 / " + eq + ")", value: r1(predEq) },
        { label: "NPH per kg per day", expr: "0.1 x (" + r1(predEq) + " / 10)" + (perKgDay >= 0.4 ? ", capped at 0.4" : ""), value: r2(perKgDay) },
        { label: "NPH dose", expr: v.weightKg + " kg x " + r2(perKgDay), value: dose }
      ],
      formula: formula,
      assumptions: [
        "NPH " + dose + " units, given AT THE SAME TIME as the steroid" + (once ? "" : " (with a morning steroid, once daily)") + ".",
        once ? "Dexamethasone acts for 36 to 72 h, so cover is closer to a 24-hour requirement: consider splitting or using a basal analogue instead of NPH."
             : "NPH peaks at 4 to 8 h and fades by 12 to 16 h, which matches once-daily morning prednisolone.",
        "This is ADDITIONAL to the patient's existing basal and prandial insulin, not a replacement for it."
      ],
      clinicalNotes: [
        "Steroid hyperglycaemia is mainly post-lunch and post-dinner; fasting glucose is often normal and can be falsely reassuring. Check pre-lunch, pre-dinner and bedtime.",
        "TAPER the insulin as the steroid tapers, on the same day. This is the commonest cause of steroid-related hypoglycaemia: the steroid stops and the insulin does not.",
        "If the steroid stops abruptly, stop this cover dose with it."
      ],
      refs: ["Glucocorticoid-induced hyperglycaemia NPH protocol: 0.1 units/kg/day per 10 mg prednisolone equivalent, maximum starting dose 0.4 units/kg/day, given with the glucocorticoid. Endocrine Society inpatient hyperglycaemia guideline 2022 (NPH for glucocorticoid-associated hyperglycaemia)."]
    };
  }

  /* IV insulin infusion to subcutaneous. Get the overlap wrong and the patient rebounds
   * straight back into ketoacidosis, which is why the timing note is not optional. */
  function ivToSubcut(v) {
    v = v || {};
    var formula = "24 h requirement = mean stable infusion rate x 24; subcutaneous TDD = 60-80% of that";
    var rate = ok(v.avgRatePerHour) ? v.avgRatePerHour : null;
    if (rate === null && v.recentRates && v.recentRates.length) {
      var rr = v.recentRates.filter(function (x) { return ok(x); });
      if (rr.length) rate = rr.reduce(function (a, b) { return a + b; }, 0) / rr.length;
    }
    if (rate === null || !(rate > 0)) return ERR(formula);
    var pct = ok(v.percent) ? v.percent : 0.8;
    if (pct > 1) pct = pct / 100;
    var inc = v.increment || 1;
    var total24 = rate * 24;
    var tdd = roundDose(total24 * pct, inc);
    var basal = roundDose(tdd * 0.5, inc);
    var mealEach = roundDose((tdd - basal) / 3, inc);
    return {
      result: tdd, rounded: tdd, unit: "units/day", tdd: tdd, basal: basal, mealBolusEach: mealEach,
      infusionRate: r2(rate), total24: r1(total24), percentUsed: pct,
      steps: [
        { label: "Mean stable infusion rate", expr: r2(rate) + " units/hour (use the last 6 h of STABLE rates)", value: r2(rate) },
        { label: "24-hour requirement", expr: r2(rate) + " x 24", value: r1(total24) },
        { label: "Subcutaneous total daily dose", expr: r1(total24) + " x " + pct, value: tdd },
        { label: "Basal", expr: tdd + " x 0.5", value: basal },
        { label: "Prandial each meal", expr: "(" + tdd + " - " + basal + ") / 3", value: mealEach }
      ],
      formula: formula,
      assumptions: [
        "Using " + Math.round(pct * 100) + "% of the extrapolated 24-hour infusion requirement (published range 60 to 80%; use the lower end if the patient is eating poorly, is insulin-naive or has renal impairment).",
        "Extrapolate from the last 6 hours of STABLE infusion, not from the whole run: early high rates reflect the resuscitation, not the maintenance need.",
        "Half basal, half prandial over three meals."
      ],
      clinicalNotes: [
        "GIVE THE BASAL 2 TO 4 HOURS BEFORE STOPPING THE INFUSION. Subcutaneous basal is not active for hours; stopping the drip at the same moment is the classic cause of rebound hyperglycaemia and recurrent ketoacidosis.",
        "In diabetic ketoacidosis, do not transition until the acidosis has resolved (ketones low, pH and bicarbonate corrected) and the patient is eating.",
        "Give the first prandial dose with the first meal, at least 30 minutes before stopping if using regular insulin.",
        "Check glucose hourly for the first 4 hours after the infusion stops."
      ],
      refs: ["Transition from intravenous to subcutaneous insulin: 60-80% of the 24-hour infusion requirement extrapolated from the last 6 h of stable infusion, with subcutaneous basal given 2-4 h before the infusion is stopped. ADA Standards of Care 2026 ch.16; Endocrine Society inpatient guideline 2022."]
    };
  }

  /* Premix (30/70 and similar) initiation and titration. The most-prescribed insulin in
   * Indian practice and the module previously could only CONVERT one, never start one. */
  function premixInit(v) {
    v = v || {};
    var formula = "premix TDD = weight x factor (or the existing total daily dose); split two-thirds before breakfast, one-third before dinner";
    var tdd = ok(v.tdd) && v.tdd > 0 ? v.tdd
      : (ok(v.weightKg) && v.weightKg > 0 ? Math.round(v.weightKg * (ok(v.factor) ? v.factor : 0.3)) : null);
    if (tdd === null) return ERR(formula);
    var inc = v.increment || 1;
    var am = roundDose(tdd * (ok(v.amFraction) ? v.amFraction : 2 / 3), inc);
    var pm = roundDose(tdd - am, inc);
    return {
      result: tdd, rounded: tdd, unit: "units/day", tdd: tdd, morning: am, evening: pm,
      steps: [
        { label: "Total daily dose", expr: ok(v.tdd) ? "entered " + tdd + " u/day" : v.weightKg + " kg x " + (ok(v.factor) ? v.factor : 0.3) + " u/kg/day", value: tdd },
        { label: "Before breakfast (two-thirds)", expr: tdd + " x 2/3", value: am },
        { label: "Before dinner (one-third)", expr: tdd + " - " + am, value: pm }
      ],
      formula: formula,
      assumptions: [
        "Twice-daily premix, given 15 to 30 minutes before breakfast and dinner (with the meal for a rapid-analogue premix).",
        "Two-thirds morning, one-third evening is the usual starting split; adjust to the readings, not the ratio.",
        "Premix is a fixed ratio: you cannot move the basal and prandial components independently. If the patient needs that, use basal-bolus."
      ],
      clinicalNotes: [
        "Titrate the MORNING dose against the pre-dinner reading, and the EVENING dose against the fasting reading. Each injection is judged by the value before the next one.",
        "The patient must eat on time and not skip meals: a missed meal after a premix dose causes hypoglycaemia.",
        "A mid-morning or mid-afternoon low usually means the premix ratio is wrong, not the total dose.",
        "Not appropriate for type 1 initiation, or for anyone eating unpredictably."
      ],
      refs: ["ADA Standards of Care in Diabetes 2026, ch.9: premixed insulin regimens, twice-daily dosing and titration to the pre-meal value before the next injection."]
    };
  }

  /* Premix titration - which of the two injections to move, judged on the paired reading. */
  function premixTitration(v) {
    v = v || {};
    var formula = "morning premix titrates to the pre-dinner value; evening premix titrates to the fasting value";
    var am = v.morning, pm = v.evening;
    if (!ok(am) || !ok(pm)) return ERR(formula);
    var fasting = ok(v.fasting) ? v.fasting : null, preDinner = ok(v.preDinner) ? v.preDinner : null;
    if (fasting === null && preDinner === null) return ERR(formula);
    var lo = ok(v.targetLow) ? v.targetLow : 80, hi = ok(v.targetHigh) ? v.targetHigh : 130;
    var steps = [], notes = [], newAm = am, newPm = pm;
    function move(cur, val, which, judgedOn) {
      if (val === null) return cur;
      if (val < 70) { var d = Math.max(0, roundDose(cur * 0.8, 1));
        steps.push({ label: which + " dose", expr: "hypoglycaemia on " + judgedOn + " (" + val + "): reduce 20%", value: d });
        notes.push(which + " premix reduced for hypoglycaemia on the " + judgedOn + " reading. Find the cause before increasing anything."); return d; }
      if (val > hi) { var u = cur + 2;
        steps.push({ label: which + " dose", expr: judgedOn + " " + val + " above target: +2 units", value: u });
        notes.push(which + " premix increased by 2 units, judged on the " + judgedOn + " reading."); return u; }
      if (val < lo) { var r = Math.max(0, roundDose(cur * 0.9, 1));
        steps.push({ label: which + " dose", expr: judgedOn + " " + val + " below target: -10%", value: r });
        notes.push(which + " premix reduced 10%, judged on the " + judgedOn + " reading."); return r; }
      steps.push({ label: which + " dose", expr: judgedOn + " " + val + " in target: no change", value: cur });
      return cur;
    }
    newAm = move(am, preDinner, "Morning", "pre-dinner");
    newPm = move(pm, fasting, "Evening", "fasting");
    return {
      result: newAm + newPm, rounded: newAm + newPm, unit: "units/day",
      morning: newAm, evening: newPm, previousMorning: am, previousEvening: pm,
      steps: steps, formula: formula,
      assumptions: [
        "Each premix injection is judged on the reading BEFORE the next injection: morning dose against pre-dinner, evening dose against fasting.",
        "Target " + lo + " to " + hi + " mg/dL for the paired reading.",
        "One change at a time, held for 3 days."
      ],
      clinicalNotes: notes.length ? notes : ["Both readings are in target: no change."],
      refs: ["ADA Standards of Care in Diabetes 2026, ch.9: titration of twice-daily premixed insulin against the pre-meal value preceding the next dose."]
    };
  }

  var API = {
    roundDose: roundDose, mmol: mmol, firstDoseCorrection: firstDoseCorrection,
    basalTitration: basalTitration, correctionScale: correctionScale, inpatientInit: inpatientInit,
    npoRegimen: npoRegimen, steroidCover: steroidCover, ivToSubcut: ivToSubcut,
    premixInit: premixInit, premixTitration: premixTitration, STEROID_EQUIV: STEROID_EQUIV,
    correctionDose: correctionDose, mealBolus: mealBolus, activeInsulin: activeInsulin,
    combinedDose: combinedDose, isfFromTdd: isfFromTdd, icrFromTdd: icrFromTdd,
    contextAdjust: contextAdjust, bolusContextAdvice: bolusContextAdvice, bolusContextFactor: bolusContextFactor,
    basalInitiation: basalInitiation, pediatricInit: pediatricInit, dkaInsulin: dkaInsulin
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_ENGINE = API;
})();
