/* insulin-convert.js - clinician-guided insulin switch suggestions. Pure, conservative.
 * NEVER a plain mathematical replacement: every result carries assumptions, monitoring,
 * follow-up and a verify-against-protocol note; the UI requires confirmation.
 * convert({fromId, toId, dose, reason, db?}) -> structured suggestion.
 * Dual export: window.INSULIN_CONVERT (app) + module.exports (node test). */
(function () {
  "use strict";

  var BASAL = { "Intermediate": 1, "Long-acting": 1, "Ultra-long-acting": 1 };
  var BOLUS = { "Rapid-acting": 1, "Short-acting": 1 };
  function r(x) { return Math.round(x); }
  function isConc(d) { return d && /U-?(200|300|500)/.test((d.strengths || []).join(" ")); }

  function convert(v) {
    var db = (typeof window !== "undefined" && window.INSULIN_DB) || v.db;
    var out = { fromId: v.fromId, toId: v.toId, reason: v.reason || "", dose: Number(v.dose),
      kind: "", ratio: null, suggested: null, steps: [], assumptions: [], monitoring: [], warnings: [], refs: [], followUp: "" };
    if (!db) { out.error = "Insulin database not loaded."; return out; }
    var from = db.get(v.fromId), to = db.get(v.toId), dose = Number(v.dose);
    if (!from || !to) { out.error = "Select both the current and target insulin."; return out; }
    if (!(dose > 0)) { out.error = "Enter the current total daily dose in units."; return out; }
    if (from.id === to.id) { out.error = "Choose a different target insulin."; return out; }
    out.fromName = from.generic; out.toName = to.generic;

    var fb = !!BASAL[from.cls], tb = !!BASAL[to.cls], fo = !!BOLUS[from.cls], tbo = !!BOLUS[to.cls];

    if (fo && tbo) {
      out.kind = "Rapid / short bolus switch"; out.ratio = 1; out.suggested = r(dose);
      out.steps.push({ label: "Unit-for-unit total", expr: dose + " x 1.0", value: r(dose) });
      out.assumptions.push("Rapid and short-acting bolus insulins are switched 1:1 by total daily units.");
      if (from.cls === "Short-acting" && to.cls === "Rapid-acting")
        out.assumptions.push("Timing changes: give the rapid analogue at the start of the meal, not 30 minutes before.");
      if (from.cls === "Rapid-acting" && to.cls === "Short-acting")
        out.assumptions.push("Timing changes: give regular insulin about 30 minutes before the meal.");
      out.monitoring.push("Check pre-meal and 2-hour post-meal glucose; adjust the meal ratio to the post-prandial response.");
    } else if (fb && tb) {
      out.kind = "Basal switch";
      // Product labelling gives TWO distinct 80% rules here, and they depend on
      // different things - applying either one blindly causes harm:
      //  (a) NPH -> long-acting analogue: reduce 20% ONLY when coming off
      //      TWICE-daily NPH. From once-daily NPH the starting dose is the SAME
      //      (glargine labelling); reducing there under-doses the patient.
      //  (b) Coming OFF glargine U-300 (Toujeo) to any other basal: start at 80%
      //      of the U-300 dose. U-300 units are not interchangeable 1:1 - a
      //      straight swap OVERDOSES and causes hypoglycaemia.
      var fromNph = from.cls === "Intermediate";
      var twiceDaily = v.fromFreq !== "od";                  // default to BD (the safer assumption)
      var nphReduce = fromNph && twiceDaily;
      var u300Off = from.id === "glargine300";
      out.ratio = (nphReduce || u300Off) ? 0.8 : 1;
      out.suggested = r(dose * out.ratio);
      out.steps.push({
        label: u300Off ? "Reduce 20% (off glargine U-300)" : nphReduce ? "Reduce 20% (twice-daily NPH to analogue)" : "Unit-for-unit total",
        expr: dose + " x " + out.ratio, value: r(dose * out.ratio) });
      if (u300Off)
        out.assumptions.push("Switching OFF glargine U-300: start at about 80% of the U-300 dose. U-300 units are not interchangeable unit-for-unit with other basal insulins - a straight swap risks hypoglycaemia.");
      else if (nphReduce)
        out.assumptions.push("Switching from TWICE-daily NPH to a long-acting analogue: start about 20% lower to reduce hypoglycaemia, then titrate up.");
      else if (fromNph)
        out.assumptions.push("Switching from ONCE-daily NPH: the starting dose is usually the SAME total daily units (the 20% reduction applies only when coming off twice-daily NPH), then titrate.");
      else out.assumptions.push("Long-acting basal analogues are started roughly 1:1 by total daily units, then titrated.");
      if (fromNph) out.assumptions.push("Confirm whether the NPH was once- or twice-daily - it changes the starting dose.");
      if (to.id === "glargine300" || to.id === "degludec")
        out.assumptions.push("Ultra-long analogues (U-300 glargine, degludec) reach steady state over several days; do not up-titrate faster than every 3 to 4 days.");
      if (from.id === "detemir")
        out.assumptions.push("If the patient was on twice-daily detemir, the once-daily total may need review.");
      out.monitoring.push("Monitor fasting glucose; titrate the basal every 3 to 4 days to the fasting target.");
    } else if (from.cls === "Premixed" && to.cls === "Premixed") {
      out.kind = "Premix switch"; out.ratio = 1; out.suggested = r(dose);
      out.steps.push({ label: "Same total, redistribute", expr: dose + " x 1.0", value: r(dose) });
      out.assumptions.push("Keep the same total daily dose and split it per the new premix ratio (commonly two-thirds in the morning, one-third in the evening); adjust to response.");
      out.monitoring.push("Monitor pre-breakfast and pre-dinner glucose; adjust each injection to the next pre-meal value.");
    } else if (fb && tbo) {
      out.kind = "Basal to basal-bolus (intensification)";
      var newBasal = r(dose * 0.8), prand = Math.max(2, r(dose * 0.1));
      out.suggested = { basal: newBasal, bolusEach: prand, bolusInsulin: to.generic };
      out.steps.push({ label: "Reduce basal about 20%", expr: dose + " x 0.8", value: newBasal });
      out.steps.push({ label: "Add prandial at each meal", expr: "about 10% of basal", value: prand });
      out.assumptions.push("Intensifying to basal-bolus: reduce the basal by about 20% and add a conservative prandial dose (" + to.generic + ") at each meal, then titrate.");
      out.assumptions.push("Continue a long-acting basal for the basal component; this suggestion covers the reduced basal plus the new prandial insulin.");
      out.monitoring.push("Monitor pre-meal and bedtime glucose; titrate each prandial dose to the next pre-meal value and the basal to fasting.");
    } else {
      out.kind = "Complex switch";
      out.warnings.push("This transition is not auto-calculated. Follow your institutional conversion protocol and seek specialist advice.");
    }

    if (!out.error && (isConc(from) || isConc(to)))
      out.warnings.push("A concentrated insulin (U-200 / U-300 / U-500) is involved: the unit dose may hold but the device and concentration differ. Confirm the correct pen or syringe and never transfer between concentrations by volume.");
    if (out.reason === "Reduce hypoglycaemia" && out.kind && out.kind !== "Complex switch")
      out.monitoring.push("Goal is fewer lows: start at the lower end of the suggestion and titrate slowly.");

    out.followUp = "Review within 3 to 7 days (sooner if unstable), titrate to target, confirm the switch with the patient, and document it.";
    out.refs.push("General insulin-conversion principles (ADA Standards of Care; product labelling). Verify against your institutional protocol.");
    if (out.kind && out.kind !== "Complex switch")
      out.assumptions.unshift("This is a conservative STARTING estimate, not a fixed replacement - the dose is deliberately cautious to avoid hypoglycaemia.");
    return out;
  }

  var API = { convert: convert };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_CONVERT = API;
})();
