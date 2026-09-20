/* StewardMD — MaiK Scribe: safety review of a scribed medicine list.
 * ---------------------------------------------------------------------------
 * Runs the app's EXISTING engines over the rows scribe-rx produced. It holds no clinical
 * rules of its own: allergy cross-reactivity, paediatric limits and the high-risk
 * combinations come from SMD_RX._analyzeRegimenSafety; drug-drug interactions and
 * duplicate therapy from INTERACTIONS.checkInteractions. Both are injected.
 *
 * check(rows, ctx, opts) -> { findings:[{severity, drug, message}], summary }
 *   rows = scribe-rx rows (or pad lines) — {drug, generic?, brand?, isAdvice?}
 *   ctx  = { allergies, age, sex, pregnancy, renal }  (any subset; all optional)
 *   opts.analyzeRegimen    = window.SMD_RX._analyzeRegimenSafety   (injected, optional)
 *   opts.checkInteractions = window.INTERACTIONS.checkInteractions (injected, optional)
 *
 * NEVER CLAIMS A MEDICINE IS SAFE. An empty findings list means these engines raised
 * nothing, not that the prescription is cleared — `summary` is worded that way and is
 * meant to be shown verbatim. Degrades to an empty findings list (never throws) when an
 * engine is missing or blows up, and says so in `summary` so silence is not read as a
 * clean result.
 *
 * Clinical limits left in place: sex and pregnancy are carried into the interaction
 * context but no rule reads them today; renal only sets the ruleset's renal_impairment
 * flag and applies no dose reduction. Interaction checking needs two or more medicines.
 *
 * window.SMD_SCRIBESAFETY + module.exports (Node-testable).
 */
(function (root) {
  "use strict";

  var SEV_RANK = { critical: 0, major: 1, moderate: 2, minor: 3, monitor: 4 };

  function medName(r) { return String((r && (r.generic || r.drug || r.brand)) || "").trim(); }

  function attribute(message, names) {
    var low = String(message || "").toLowerCase();
    for (var i = 0; i < names.length; i++) {
      if (names[i] && low.indexOf(names[i].toLowerCase()) > -1) return names[i];
    }
    return "";
  }

  function check(rows, ctx, opts) {
    ctx = ctx || {};
    opts = opts || {};
    var meds = (rows || []).filter(function (r) { return r && !r.isAdvice && !r.advice && medName(r); });
    var names = meds.map(medName);
    var findings = [], engines = 0, failed = 0;

    // ── Engine 1: regimen safety (allergy cross-reactivity, age limits, risky combos) ──
    if (typeof opts.analyzeRegimen === "function" && meds.length) {
      engines++;
      try {
        var lines = meds.map(function (r) { return { drug: medName(r), brand: r.brand || "", advice: false }; });
        var res = opts.analyzeRegimen(lines, ctx.allergies || "", ctx.age == null ? "" : ctx.age) || {};
        (res.findings || []).forEach(function (f) {
          if (!f || !f.txt) return;
          findings.push({ severity: f.sev || "moderate", drug: attribute(f.txt, names), message: f.txt });
        });
      } catch (e) { failed++; }
    }

    // ── Engine 2: drug-drug interactions + duplicate therapy (needs 2+ medicines) ──
    if (typeof opts.checkInteractions === "function" && meds.length >= 2) {
      engines++;
      try {
        var context = {
          renalImpairment: !!ctx.renal,
          sex: ctx.sex || "",            // carried through; no rule reads it today
          pregnancy: ctx.pregnancy || ""
        };
        var r2 = opts.checkInteractions(names.map(function (n) { return { generic: n }; }), context) || {};
        ["critical", "major", "moderate"].forEach(function (sev) {
          (r2[sev] || []).forEach(function (f) {
            if (!f) return;
            var txt = (f.drugs || []).join(" + ") + ": " + (f.effect || f.mechanism || "interaction") +
                      (f.action ? " - " + f.action : "");
            findings.push({ severity: sev, drug: (f.drugs && f.drugs[0]) || "", message: txt });
          });
        });
        (r2.duplicates || []).forEach(function (f) {
          if (!f) return;
          findings.push({
            severity: "moderate",
            drug: (f.drugs && f.drugs[0]) || "",
            message: "Duplicate therapy: " + (f.drugs || []).join(" + ")
          });
        });
      } catch (e) { failed++; }
    }

    // analyzeRegimenSafety already folds in interactions when it can reach INTERACTIONS
    // itself, so identical messages can arrive twice. Keep the first of each.
    var seen = {}, unique = [];
    findings.forEach(function (f) {
      var k = f.severity + "|" + f.message;
      if (seen[k]) return;
      seen[k] = 1;
      unique.push(f);
    });
    unique.sort(function (a, b) {
      return (SEV_RANK[a.severity] == null ? 5 : SEV_RANK[a.severity]) -
             (SEV_RANK[b.severity] == null ? 5 : SEV_RANK[b.severity]);
    });

    return { findings: unique, summary: summarize(unique, meds.length, engines, failed) };
  }

  /* Wording is deliberate: nothing here ever states that a medicine or the list is safe. */
  function summarize(findings, medCount, engines, failed) {
    if (!medCount) return "No medicines to review.";
    if (!engines || failed === engines) {
      return "Safety checks could not run on this device. Nothing was reviewed, so check every drug, dose, allergy and interaction yourself before signing.";
    }
    if (!findings.length) {
      return "The safety checks raised nothing on these " + medCount + " medicine(s). That is not a clearance - verify each drug, dose, allergy and interaction against the patient before signing.";
    }
    return findings.length + " point(s) to review (highest: " + findings[0].severity +
      "). Reviewing these is not a clearance for the rest of the prescription.";
  }

  var API = { check: check, _version: "1.0" };
  if (root) root.SMD_SCRIBESAFETY = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
