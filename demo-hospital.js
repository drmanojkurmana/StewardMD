/* StewardMD — "Test Hospital" demo dataset (offline, no GHIS login needed).
 * ---------------------------------------------------------------------------
 * Entirely fictional patients, for a live demo. Loaded via the "Load Demo: Test
 * Hospital" button on the Ward Sync sign-in screen (ghis-ward.js: GHIS.loadDemoHospital).
 * Once loaded, everything downstream (branch/doctor/gender filters, opening a patient,
 * bridging into the ICU dashboard, calculator auto-fill, renal/antibiotic dosing) runs
 * through the EXACT SAME code path a real GHIS session uses — only the network fetch is
 * swapped for this local data, inside authFetch(). Nothing here touches the real GHIS
 * integration or any live credential.
 *
 * Test names are drawn verbatim from icu.js's WARD_LAB_MAP (the clinician-verified GHIS
 * vocabulary) so every value actually maps into a typed analyte instead of being silently
 * dropped by the safe mapper. Units match GHIS's own convention (mg/dL, mEq/L, g/dL),
 * which icu.js keeps as-reported rather than converting.
 *
 * 5 branches x 5 patients. Nephrology is the deliberate dosing showcase: five patients
 * spanning normal renal function to severe CKD, so the SAME antibiotic/renal-dosing
 * calculator visibly gives a different dose for each one.
 */
(function () {
  "use strict";

  // "DD-MON-YYYY HH:MM", matching icu.js's parseWardDate — always "today", however
  // long after this file is written the demo actually runs.
  var MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  function ghDate(hoursAgo) {
    var d = new Date(Date.now() - (hoursAgo || 0) * 3600000);
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return pad(d.getDate()) + "-" + MON[d.getMonth()] + "-" + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // Standard panel: test name -> { unit, low, high }. A patient supplies only the
  // numeric values that differ from the panel default; mk() fills in the rest.
  var PANEL = {
    "Sodium": { u: "mEq/L", lo: 135, hi: 145 },
    "Potassium": { u: "mEq/L", lo: 3.5, hi: 5.0 },
    "Chloride": { u: "mEq/L", lo: 98, hi: 107 },
    "Bicarbonate": { u: "mEq/L", lo: 22, hi: 29 },
    "Serum Creatinine": { u: "mg/dL", lo: 0.6, hi: 1.3 },
    "Blood Urea": { u: "mg/dL", lo: 15, hi: 40 },
    "Random Blood Sugar": { u: "mg/dL", lo: 70, hi: 140 },
    "Haemoglobin": { u: "g/dL", lo: 12, hi: 16 },
    "Total WBC Count": { u: "/cumm", lo: 4000, hi: 11000 },
    "Platelet Count": { u: "lakhs/cumm", lo: 1.5, hi: 4.5 },
    "Total Bilirubin": { u: "mg/dL", lo: 0.2, hi: 1.2 },
    "SGOT (AST)": { u: "U/L", lo: 5, hi: 40 },
    "SGPT (ALT)": { u: "U/L", lo: 5, hi: 40 },
    "Serum Albumin": { u: "g/dL", lo: 3.5, hi: 5.0 },
    "PT/INR": { u: "ratio", lo: 0.8, hi: 1.2 },
    "C-Reactive Protein": { u: "mg/L", lo: 0, hi: 5 },
    "Lactate": { u: "mmol/L", lo: 0.5, hi: 2.0 }
  };
  // Every patient gets this base panel; vignette-specific extras (bilirubin, INR, CRP,
  // lactate) are added only where clinically relevant, same as a real ordered panel.
  var BASE = ["Sodium", "Potassium", "Chloride", "Bicarbonate", "Serum Creatinine",
              "Blood Urea", "Random Blood Sugar", "Haemoglobin", "Total WBC Count", "Platelet Count"];

  function mk(vals, extraTests, hoursAgo) {
    var rows = [];
    BASE.concat(extraTests || []).forEach(function (name) {
      var spec = PANEL[name];
      var v = (vals && vals[name] != null) ? vals[name] : (spec.lo + spec.hi) / 2;
      rows.push({ test: name, result: String(v), units: spec.u, low: spec.lo, high: spec.hi, date: ghDate(hoursAgo || 3) });
    });
    return rows;
  }

  var pid = 100000;
  function P(name, gender, age, bed, doctor, vals, extraTests, hoursAgo) {
    pid += 1;
    return {
      patientId: "TH" + pid, episodeId: "THEP" + pid,
      name: name, gender: gender, age: age, bed: bed, doctor: doctor,
      labs: mk(vals, extraTests, hoursAgo)
    };
  }

  var BRANCHES = [
    { dept: "General Medicine", patients: [
      P("Ramesh Iyer", "M", 62, "GM-1", "Dr. Priya Nair",
        { Sodium: 122, Potassium: 3.8, "Serum Creatinine": 0.9, "Blood Urea": 28, Haemoglobin: 13.2 }),
      P("Lakshmi Reddy", "F", 55, "GM-2", "Dr. Priya Nair",
        { Haemoglobin: 7.8, Sodium: 138, Potassium: 4.1, "Serum Creatinine": 0.8 }),
      P("Suresh Babu", "M", 70, "GM-3", "Dr. Arjun Menon",
        { "Serum Creatinine": 1.9, "Blood Urea": 58, Potassium: 5.1, Haemoglobin: 11.5 }),
      P("Kavitha Rao", "F", 48, "GM-4", "Dr. Arjun Menon",
        { "Random Blood Sugar": 312, Sodium: 133, "Serum Creatinine": 0.9 }),
      P("Narayana Swamy", "M", 66, "GM-5", "Dr. Priya Nair", {})
    ]},
    { dept: "ICU", patients: [
      P("Mohammed Ali", "M", 58, "ICU-1", "Dr. Sneha Kapoor",
        { "Total WBC Count": 22400, "Serum Creatinine": 1.8, Sodium: 132, Potassium: 5.3, Haemoglobin: 10.2, "Platelet Count": 1.1 },
        ["C-Reactive Protein", "Lactate"], 1),
      P("Fatima Begum", "F", 71, "ICU-2", "Dr. Sneha Kapoor",
        { "Serum Creatinine": 4.6, "Blood Urea": 142, Potassium: 6.1, Sodium: 129, Bicarbonate: 15, Haemoglobin: 9.4 }, [], 1),
      P("Ravi Kumar", "M", 60, "ICU-3", "Dr. Vikram Shah",
        { "Serum Creatinine": 1.3, Sodium: 130, Potassium: 4.0 },
        ["Total Bilirubin", "SGOT (AST)", "SGPT (ALT)", "Serum Albumin", "PT/INR"], 2),
      P("Anjali Desai", "F", 45, "ICU-4", "Dr. Vikram Shah",
        { Sodium: 118, Potassium: 3.6, "Serum Creatinine": 0.7 }, [], 2),
      P("Deepak Verma", "M", 52, "ICU-5", "Dr. Sneha Kapoor",
        { "Platelet Count": 0.4, Haemoglobin: 8.6, "Total WBC Count": 15200, "Serum Creatinine": 1.5 }, ["PT/INR"], 1)
    ]},
    { dept: "Nephrology", patients: [
      // Deliberate spread of renal function for the dosing demo: normal -> mild -> moderate -> severe -> AKI-on-CKD.
      P("Krishna Murthy", "M", 50, "NEPH-5", "Dr. Meera Iyengar",
        { "Serum Creatinine": 0.9, "Blood Urea": 24, Haemoglobin: 13.8 }),
      P("Ganesh Pillai", "M", 64, "NEPH-1", "Dr. Meera Iyengar",
        { "Serum Creatinine": 1.4, "Blood Urea": 34, Haemoglobin: 12.4 }),
      P("Saroja Devi", "F", 68, "NEPH-2", "Dr. Meera Iyengar",
        { "Serum Creatinine": 2.6, "Blood Urea": 68, Potassium: 5.0, Haemoglobin: 10.8 }),
      P("Chandrasekhar Rao", "M", 72, "NEPH-3", "Dr. Ashok Reddy",
        { "Serum Creatinine": 5.8, "Blood Urea": 156, Potassium: 5.8, Bicarbonate: 17, Haemoglobin: 8.9 }),
      P("Padma Priya", "F", 58, "NEPH-4", "Dr. Ashok Reddy",
        { "Serum Creatinine": 3.9, "Blood Urea": 98, Sodium: 130, Potassium: 5.5, Haemoglobin: 9.6 })
    ]},
    { dept: "Cardiology", patients: [
      P("Vijay Anand", "M", 67, "CARD-1", "Dr. Rohit Malhotra", { Potassium: 2.9, "Serum Creatinine": 1.1 }),
      P("Rukmini Bai", "F", 74, "CARD-2", "Dr. Rohit Malhotra", { Potassium: 6.3, "Serum Creatinine": 1.6 }),
      P("Harish Chandra", "M", 61, "CARD-3", "Dr. Anitha George", { "Serum Creatinine": 2.1, "Blood Urea": 52 }),
      P("Meenakshi Sundaram", "F", 69, "CARD-4", "Dr. Anitha George", { Haemoglobin: 9.2 }),
      P("Subramaniam Iyer", "M", 55, "CARD-5", "Dr. Rohit Malhotra", {})
    ]},
    { dept: "General Surgery", patients: [
      P("Arun Prakash", "M", 34, "SURG-1", "Dr. Divya Menon", { Haemoglobin: 11.8, "Total WBC Count": 12400 }, [], 20),
      P("Geetha Krishnan", "F", 41, "SURG-2", "Dr. Divya Menon", { "Total WBC Count": 16800, Haemoglobin: 11.0 }, ["C-Reactive Protein"], 8),
      P("Manoj Tiwari", "M", 47, "SURG-3", "Dr. Sanjay Kulkarni", { Sodium: 133, Potassium: 3.7 }, [], 12),
      P("Shalini Nambiar", "F", 29, "SURG-4", "Dr. Sanjay Kulkarni", {}, ["PT/INR"], 12),
      P("Ashwin Bose", "M", 39, "SURG-5", "Dr. Divya Menon", {}, [], 10)
    ]}
  ];

  window.SMD_TEST_HOSPITAL = { name: "Test Hospital (Demo)", branches: BRANCHES };
})();
