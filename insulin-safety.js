/* insulin-safety.js - pure insulin safety evaluation. No DOM, no storage.
 * evaluate(context, input, result) -> severity-ranked warnings (most severe first).
 *   Warning = { id, severity:"info"|"caution"|"warning"|"critical", title, detail, interrupt }
 * Dual export: window.INSULIN_SAFETY (app) + module.exports (node --test). */
(function () {
  "use strict";

  var RANK = { info: 0, caution: 1, warning: 2, critical: 3 };
  function num(x) { return typeof x === "number" && isFinite(x); }
  function W(id, severity, title, detail) {
    return { id: id, severity: severity, title: title, detail: detail, interrupt: severity === "critical" };
  }

  function evaluate(context, input, result) {
    context = context || {}; input = input || {}; result = result || {};
    var out = [];

    if (!input.noGlucose && !num(input.glucose))
      out.push(W("missing_input", "warning", "Missing glucose",
        "Enter a current blood glucose before accepting a dose."));

    if (num(input.glucose) && input.glucose < 70)
      out.push(W("hypoglycemia", "critical", "Hypoglycemia",
        "Glucose " + input.glucose + " mg/dL is low. Do not give a correction dose; treat the low first."));

    if (num(input.glucose) && input.glucose > 400)
      out.push(W("critical_hyper", "critical", "Very high glucose - rule out DKA/HHS",
        "Glucose " + input.glucose + " mg/dL. Check ketones, venous pH/bicarbonate and osmolality BEFORE a routine subcutaneous correction. If ketoacidosis or a hyperosmolar state is present, use the DKA/HHS protocol - not a correction bolus."));
    else if (num(input.glucose) && input.glucose > 300)
      out.push(W("severe_hyper", "warning", "Severe hyperglycemia",
        "Glucose " + input.glucose + " mg/dL. Check ketones and consider DKA before routine correction."));

    if (num(input.iob) && input.iob > 0 && num(result.rounded) && result.rounded > 0)
      out.push(W("stacking", "caution", "Active insulin on board",
        input.iob + " units still active. Confirm IOB was subtracted to avoid insulin stacking."));

    if (num(context.maxBolus) && num(result.rounded) && result.rounded > context.maxBolus)
      out.push(W("max_bolus", "critical", "Maximum bolus exceeded",
        "Recommended " + result.rounded + " units exceeds the configured maximum of " + context.maxBolus + " units."));

    if (num(context.maxDaily) && num(result.dailyTotal) && result.dailyTotal > context.maxDaily)
      out.push(W("max_daily", "critical", "Maximum daily dose exceeded",
        "Projected daily total exceeds the configured maximum of " + context.maxDaily + " units."));

    if (num(context.age) && context.age < 18)
      out.push(W("pediatric", "caution", "Pediatric patient",
        "Pediatric dosing is weight-based and specialist-guided. Verify against the pediatric protocol."));

    if (context.pregnancy)
      out.push(W("pregnancy", "caution", "Pregnancy",
        "Requirements rise through gestation (about 0.7 u/kg/day in the 1st trimester, 0.8 in the 2nd, 0.9 to 1.0 in the 3rd) and targets are tighter: fasting under 95 mg/dL, 1-hour post-prandial under 140, 2-hour under 120. Requirements fall abruptly after delivery."));

    if (context.renal) {                              // chip-gated: a stale eGFR must not raise a renal warning
      var e = num(context.egfr) ? context.egfr : null;
      var band = (context.dialysis || (e !== null && e < 10)) ? "about 50% of the usual dose"
        : (e === null || e < 50) ? "about 75% of the usual dose" : null;
      out.push(W("renal", "caution", "Renal impairment",
        band ? "Insulin is renally cleared, so requirements fall" + (e !== null ? " (eGFR " + e + ")" : "") +
               " - use " + band + " and monitor for hypoglycaemia." + (e === null ? " Enter an eGFR to band this properly (below 10 the reduction is 50%)." : "")
             : "eGFR " + e + " mL/min - no routine reduction above 50, but recheck if renal function is falling."));
    }

    if (context.hepatic)
      out.push(W("hepatic", "caution", "Liver disease",
        "No validated dose multiplier - requirements are unpredictable: insulin resistance raises them, while impaired gluconeogenesis and reduced hepatic insulin clearance raise hypoglycaemia risk, especially fasting and overnight. Start at the low end, avoid excess basal, monitor closely."));

    if (context.exercise)
      out.push(W("exercise", "caution", "Planned exercise",
        "Exercise increases insulin sensitivity. Consider reducing the meal bolus by about 25 to 50% and watch for delayed (post-exercise) hypoglycaemia for up to 24 hours."));

    if (context.steroids)
      out.push(W("steroids", "caution", "Steroid therapy",
        "Glucocorticoids raise insulin requirements, mainly post-prandial and daytime. Anticipate higher doses and monitor; taper insulin as steroids reduce."));

    out.sort(function (a, b) { return RANK[b.severity] - RANK[a.severity]; });
    return out;
  }

  var API = { evaluate: evaluate };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_SAFETY = API;
})();
