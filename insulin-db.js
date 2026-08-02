/* insulin-db.js - modular insulin reference database. Pure data + query API.
 * window.INSULIN_DB = { CLASSES, COUNTRIES, list, get, byClass, search, brandCountries }.
 * Designed for updates without code changes: add an object to DATA.
 *
 * IMPORTANT: pharmacokinetic values (onset/peak/duration) are approximate, label-based
 * ranges for typical subcutaneous dosing and vary by dose, site, and patient. This is
 * educational reference - always verify against the current local product information.
 * Dual export: window.INSULIN_DB (app) + module.exports (node test). */
(function () {
  "use strict";

  var CLASSES = ["Rapid-acting", "Short-acting", "Intermediate", "Long-acting", "Ultra-long-acting", "Premixed", "Concentrated"];
  var COUNTRIES = { IN: "India", US: "United States", UK: "United Kingdom", AU: "Australia", CA: "Canada", ME: "Middle East" };

  // dia = duration of insulin action (h) used for IOB when this is the active bolus insulin; null for basal/premix.
  var DATA = [
    { id: "lispro", generic: "Insulin lispro", cls: "Rapid-acting", strengths: ["U-100", "U-200"],
      onset: "15 min", peak: "1 to 2 h", duration: "3 to 5 h", timing: "0 to 15 min before a meal",
      route: "Subcutaneous; pump-compatible", devices: "Pen, vial, cartridge, pump", dia: 4,
      pregnancy: "Used in pregnancy; individualise", pediatric: "Approved from 3 years (brand-dependent)",
      renal: "Insulin requirement often falls; monitor and reduce as needed", hepatic: "May need dose reduction; monitor",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label (about 28 days)",
      notes: "Rapid analogue for meal coverage and corrections. U-200 is a concentrated pen for higher doses.",
      brands: [{ name: "Humalog", mfr: "Eli Lilly", countries: ["US", "UK", "AU", "CA", "IN", "ME"] },
               { name: "Admelog", mfr: "Sanofi", countries: ["US"] }] },

    { id: "aspart", generic: "Insulin aspart", cls: "Rapid-acting", strengths: ["U-100"],
      onset: "10 to 20 min", peak: "1 to 3 h", duration: "3 to 5 h", timing: "0 to 10 min before a meal",
      route: "Subcutaneous; pump-compatible", devices: "Pen, vial, cartridge, pump", dia: 4,
      pregnancy: "Used in pregnancy; individualise", pediatric: "Approved from 2 years (brand-dependent)",
      renal: "Insulin requirement often falls; monitor and reduce as needed", hepatic: "May need dose reduction; monitor",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label (about 28 days)",
      notes: "Rapid analogue for meal coverage and corrections.",
      brands: [{ name: "NovoRapid", mfr: "Novo Nordisk", countries: ["UK", "AU", "CA", "IN", "ME"] },
               { name: "Novolog", mfr: "Novo Nordisk", countries: ["US"] }] },

    { id: "glulisine", generic: "Insulin glulisine", cls: "Rapid-acting", strengths: ["U-100"],
      onset: "15 min", peak: "1 to 1.5 h", duration: "3 to 5 h", timing: "0 to 15 min before or just after a meal",
      route: "Subcutaneous; pump-compatible", devices: "Pen, vial, cartridge, pump", dia: 4,
      pregnancy: "Used in pregnancy; individualise", pediatric: "Approved from 4 years",
      renal: "Insulin requirement often falls; monitor", hepatic: "May need dose reduction; monitor",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label (about 28 days)",
      notes: "Rapid analogue; onset similar to other rapid analogues.",
      brands: [{ name: "Apidra", mfr: "Sanofi", countries: ["US", "UK", "AU", "CA", "IN", "ME"] }] },

    { id: "fiasp", generic: "Faster-acting insulin aspart", cls: "Rapid-acting", strengths: ["U-100"],
      onset: "About 5 min (2.5 to 5)", peak: "1 to 3 h", duration: "3 to 5 h", timing: "At meal start, up to 20 min after",
      route: "Subcutaneous; pump-compatible", devices: "Pen, vial, cartridge, pump", dia: 4,
      pregnancy: "Data limited; individualise", pediatric: "Approved from 1 to 2 years (brand-dependent)",
      renal: "Monitor; requirement often falls", hepatic: "Monitor; may need reduction",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label",
      notes: "Ultra-rapid aspart formulation with faster onset than standard aspart.",
      brands: [{ name: "Fiasp", mfr: "Novo Nordisk", countries: ["US", "UK", "AU", "CA", "IN"] }] },

    { id: "lyumjev", generic: "Ultra-rapid insulin lispro", cls: "Rapid-acting", strengths: ["U-100", "U-200"],
      onset: "About 5 to 15 min", peak: "1 to 3 h", duration: "3 to 5 h", timing: "At meal start, up to 20 min after",
      route: "Subcutaneous; pump-compatible", devices: "Pen, vial, pump", dia: 4,
      pregnancy: "Data limited; individualise", pediatric: "Adults; paediatric use per label",
      renal: "Monitor; requirement often falls", hepatic: "Monitor; may need reduction",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label",
      notes: "Ultra-rapid lispro; U-200 concentrated pen available.",
      brands: [{ name: "Lyumjev", mfr: "Eli Lilly", countries: ["US", "UK", "AU", "CA"] }] },

    { id: "regular", generic: "Regular human insulin", cls: "Short-acting", strengths: ["U-100"],
      onset: "30 min", peak: "2 to 4 h", duration: "5 to 8 h", timing: "About 30 min before a meal",
      route: "Subcutaneous; IV in supervised settings", devices: "Pen, vial, cartridge", dia: 6,
      pregnancy: "Long track record; used in pregnancy", pediatric: "Used across ages",
      renal: "Requirement often falls; monitor", hepatic: "Monitor; may need reduction",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label (about 28 to 42 days)",
      notes: "Soluble human insulin. The IV-compatible insulin for DKA and inpatient protocols.",
      brands: [{ name: "Actrapid", mfr: "Novo Nordisk", countries: ["UK", "AU", "IN", "ME"] },
               { name: "Humulin R", mfr: "Eli Lilly", countries: ["US", "CA", "IN"] },
               { name: "Novolin R", mfr: "Novo Nordisk", countries: ["US", "CA"] }] },

    { id: "nph", generic: "Isophane insulin (NPH)", cls: "Intermediate", strengths: ["U-100"],
      onset: "1 to 2 h", peak: "4 to 12 h", duration: "12 to 18 h", timing: "Once or twice daily",
      route: "Subcutaneous", devices: "Pen, vial, cartridge", dia: null,
      pregnancy: "Long track record; used in pregnancy", pediatric: "Used across ages",
      renal: "Requirement often falls; monitor for nocturnal hypoglycaemia", hepatic: "Monitor",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label. Resuspend before use.",
      notes: "Cloudy suspension - must be gently mixed before injection. Pronounced peak raises nocturnal hypo risk.",
      brands: [{ name: "Insulatard", mfr: "Novo Nordisk", countries: ["UK", "AU", "IN", "ME"] },
               { name: "Humulin N", mfr: "Eli Lilly", countries: ["US", "CA", "IN"] },
               { name: "Novolin N", mfr: "Novo Nordisk", countries: ["US", "CA"] }] },

    { id: "glargine100", generic: "Insulin glargine U-100", cls: "Long-acting", strengths: ["U-100"],
      onset: "1 to 2 h", peak: "No pronounced peak", duration: "About 24 h", timing: "Once daily, same time each day",
      route: "Subcutaneous", devices: "Pen, vial, cartridge", dia: null,
      pregnancy: "Used in pregnancy where basal analogue indicated", pediatric: "Approved from 6 years (brand-dependent)",
      renal: "Requirement often falls; monitor", hepatic: "Monitor; may need reduction",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label (about 28 days). Do not mix.",
      notes: "Flat basal analogue. Biosimilars are widely available. Do not mix with other insulins.",
      brands: [{ name: "Lantus", mfr: "Sanofi", countries: ["US", "UK", "AU", "CA", "IN", "ME"] },
               { name: "Basaglar", mfr: "Eli Lilly", countries: ["US", "UK", "CA"] },
               { name: "Semglee", mfr: "Viatris/Biocon", countries: ["US", "UK"] },
               { name: "Basalog", mfr: "Biocon", countries: ["IN"] },
               { name: "Glaritus", mfr: "Wockhardt", countries: ["IN"] }] },

    { id: "detemir", generic: "Insulin detemir", cls: "Long-acting", strengths: ["U-100"],
      onset: "1 to 2 h", peak: "Minimal (about 6 to 8 h)", duration: "Up to 24 h (dose-dependent)", timing: "Once or twice daily",
      route: "Subcutaneous", devices: "Pen, vial, cartridge", dia: null,
      pregnancy: "Used in pregnancy where basal analogue indicated", pediatric: "Approved from 1 to 2 years (brand-dependent)",
      renal: "Requirement often falls; monitor", hepatic: "Monitor; may need reduction",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label (about 42 days). Do not mix.",
      notes: "At lower doses often needs twice-daily dosing for 24 h cover.",
      brands: [{ name: "Levemir", mfr: "Novo Nordisk", countries: ["US", "UK", "AU", "CA", "IN", "ME"] }] },

    { id: "glargine300", generic: "Insulin glargine U-300", cls: "Ultra-long-acting", strengths: ["U-300"],
      onset: "About 6 h", peak: "No pronounced peak", duration: "More than 24 h (up to 36 h)", timing: "Once daily",
      route: "Subcutaneous", devices: "Pen only (SoloStar/DoubleStar)", dia: null,
      pregnancy: "Data limited; individualise", pediatric: "Approved from 6 years",
      renal: "Requirement often falls; monitor", hepatic: "Monitor; may need reduction",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label. Do not mix.",
      notes: "Concentrated glargine (U-300); flatter and longer than U-100. Not interchangeable unit-for-unit device-wise.",
      brands: [{ name: "Toujeo", mfr: "Sanofi", countries: ["US", "UK", "AU", "CA", "IN", "ME"] }] },

    { id: "degludec", generic: "Insulin degludec", cls: "Ultra-long-acting", strengths: ["U-100", "U-200"],
      onset: "About 1 h", peak: "No pronounced peak", duration: "More than 42 h", timing: "Once daily, flexible timing",
      route: "Subcutaneous", devices: "Pen", dia: null,
      pregnancy: "Increasingly used; individualise", pediatric: "Approved from 1 year",
      renal: "Requirement often falls; monitor", hepatic: "Monitor; may need reduction",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label (up to 8 weeks). Do not mix.",
      notes: "Very long, flat action; steady state after a few days. U-200 pen for higher doses.",
      brands: [{ name: "Tresiba", mfr: "Novo Nordisk", countries: ["US", "UK", "AU", "CA", "IN", "ME"] }] },

    { id: "mix7030h", generic: "Biphasic human insulin 70/30", cls: "Premixed", strengths: ["U-100"],
      onset: "30 min", peak: "Dual (2 to 12 h)", duration: "12 to 18 h", timing: "Twice daily, 30 min before meals",
      route: "Subcutaneous", devices: "Pen, vial, cartridge", dia: null,
      pregnancy: "Long track record", pediatric: "Used where premix indicated",
      renal: "Requirement often falls; monitor", hepatic: "Monitor",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label. Resuspend before use.",
      notes: "70% NPH / 30% regular. Cloudy - mix before use. Fixed ratio limits flexibility.",
      brands: [{ name: "Mixtard 30", mfr: "Novo Nordisk", countries: ["UK", "IN", "ME"] },
               { name: "Humulin 70/30", mfr: "Eli Lilly", countries: ["US", "CA", "IN"] },
               { name: "Novolin 70/30", mfr: "Novo Nordisk", countries: ["US", "CA"] }] },

    { id: "mixlispro2575", generic: "Lispro mix 25/75", cls: "Premixed", strengths: ["U-100"],
      onset: "15 min", peak: "Dual", duration: "12 to 18 h", timing: "Twice daily, within 15 min of a meal",
      route: "Subcutaneous", devices: "Pen, cartridge", dia: null,
      pregnancy: "Individualise", pediatric: "Used where premix indicated",
      renal: "Requirement often falls; monitor", hepatic: "Monitor",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label. Resuspend before use.",
      notes: "25% lispro / 75% lispro protamine. Faster meal component than human premix.",
      brands: [{ name: "Humalog Mix 25", mfr: "Eli Lilly", countries: ["UK", "AU", "IN", "ME"] },
               { name: "Humalog Mix 75/25", mfr: "Eli Lilly", countries: ["US", "CA"] }] },

    { id: "mixaspart3070", generic: "Aspart mix 30/70", cls: "Premixed", strengths: ["U-100"],
      onset: "10 to 20 min", peak: "Dual", duration: "12 to 18 h", timing: "Twice daily, within 10 min of a meal",
      route: "Subcutaneous", devices: "Pen, cartridge", dia: null,
      pregnancy: "Individualise", pediatric: "Approved from 10 years (brand-dependent)",
      renal: "Requirement often falls; monitor", hepatic: "Monitor",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label. Resuspend before use.",
      notes: "30% aspart / 70% aspart protamine.",
      brands: [{ name: "NovoMix 30", mfr: "Novo Nordisk", countries: ["UK", "AU", "CA", "IN", "ME"] },
               { name: "Novolog Mix 70/30", mfr: "Novo Nordisk", countries: ["US"] }] },

    { id: "regularu500", generic: "Regular human insulin U-500", cls: "Concentrated", strengths: ["U-500"],
      onset: "About 30 min", peak: "Delayed", duration: "Up to 24 h", timing: "Two to three times daily before meals",
      route: "Subcutaneous", devices: "Dedicated U-500 pen and U-500 syringe only", dia: null,
      pregnancy: "Specialist use", pediatric: "Rarely used; specialist only",
      renal: "Monitor closely", hepatic: "Monitor closely",
      storage: "Unopened 2 to 8 C; in-use at room temperature, discard per label",
      notes: "5x concentrated regular insulin for severe insulin resistance (large daily doses). At U-500 it behaves with a longer, intermediate-like profile. High dosing-error risk - always use U-500-specific devices.",
      brands: [{ name: "Humulin R U-500", mfr: "Eli Lilly", countries: ["US", "CA"] }] }
  ];

  function low(s) { return (s || "").toLowerCase(); }
  function get(id) { for (var i = 0; i < DATA.length; i++) if (DATA[i].id === id) return DATA[i]; return null; }
  function byClass(cls) { return DATA.filter(function (d) { return d.cls === cls; }); }
  function brandCountries(d) {
    var set = {}, out = [];
    (d.brands || []).forEach(function (b) { (b.countries || []).forEach(function (c) { if (!set[c]) { set[c] = 1; out.push(c); } }); });
    return out;
  }
  function search(q) {
    q = low(q).trim();
    if (!q) return DATA.slice();
    return DATA.filter(function (d) {
      if (low(d.generic).indexOf(q) > -1) return true;
      if (low(d.cls).indexOf(q) > -1) return true;
      for (var i = 0; i < d.strengths.length; i++) if (low(d.strengths[i]).indexOf(q) > -1) return true;
      for (var j = 0; j < (d.brands || []).length; j++) {
        var b = d.brands[j];
        if (low(b.name).indexOf(q) > -1) return true;
        if (low(b.mfr).indexOf(q) > -1) return true;
        for (var k = 0; k < (b.countries || []).length; k++) {
          var cc = b.countries[k];
          if (low(cc) === q || low(COUNTRIES[cc]).indexOf(q) > -1) return true;
        }
      }
      return false;
    });
  }

  var API = { CLASSES: CLASSES, COUNTRIES: COUNTRIES, list: function () { return DATA.slice(); },
    get: get, byClass: byClass, search: search, brandCountries: brandCountries };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_DB = API;
})();
