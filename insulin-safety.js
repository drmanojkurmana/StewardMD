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

    if (!num(input.glucose))
      out.push(W("missing_input", "warning", "Missing glucose",
        "Enter a current blood glucose before accepting a dose."));

    if (num(input.glucose) && input.glucose < 70)
      out.push(W("hypoglycemia", "critical", "Hypoglycemia",
        "Glucose " + input.glucose + " mg/dL is low. Do not give a correction dose; treat the low first."));

    if (num(input.glucose) && input.glucose > 300)
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
        "Insulin requirements shift by trimester and glucose targets are tighter. Confirm current targets."));

    if (context.renal)
      out.push(W("renal", "caution", "Renal impairment",
        "Reduced insulin clearance raises hypoglycemia risk; consider a lower dose."));

    if (context.hepatic)
      out.push(W("hepatic", "caution", "Liver disease",
        "Altered gluconeogenesis and insulin metabolism; dose conservatively and monitor."));

    out.sort(function (a, b) { return RANK[b.severity] - RANK[a.severity]; });
    return out;
  }

  var API = { evaluate: evaluate };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_SAFETY = API;
})();
