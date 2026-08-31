/* StewardMD — "StewardMD Hospital" demo dataset (offline, no GHIS login needed).
 * ---------------------------------------------------------------------------
 * Entirely fictional patients, for a live demo. Loaded via the "StewardMD Hospital"
 * entry on the Ward Sync hospital picker (ghis-ward.js: GHIS.loadDemoHospital, wired
 * from window.ghisSelectHospital('stewardmd')). Once loaded, everything downstream
 * (branch/doctor/gender filters, opening a patient, bridging into the ICU dashboard,
 * calculator auto-fill, renal/antibiotic dosing, imaging, and — for the ICU branch —
 * a multi-day vitals timeline) runs through the EXACT SAME code path a real GHIS
 * session uses; only the network fetch is swapped for this local data, inside
 * authFetch(). Nothing here touches the real GHIS integration or any live credential.
 *
 * Lab test names are drawn verbatim from icu.js's WARD_LAB_MAP (the clinician-verified
 * GHIS vocabulary) so every value actually maps into a typed analyte instead of being
 * silently dropped by the safe mapper. Units match GHIS's own convention (mg/dL, mEq/L,
 * g/dL), which icu.js keeps as-reported rather than converting.
 *
 * Every patient gets the FULL panel (electrolytes, RFT, LFT, CBC, coag, inflammatory,
 * lactate) across 6 dated days, so ICU Trends has something real to plot. Every
 * patient also gets two imaging reports (USG Abdomen, CECT Abdomen) through the same
 * /radiology + /radiology-report path a real Ward Sync imaging pull uses.
 *
 * One honest limit, not worked around: real Ward Sync has NO ingestion path for
 * arterial blood gas components (pH, pCO2, pO2) at all — icu.js's WARD_LAB_MAP only
 * carries Bicarbonate and Lactate from that panel, and ghis-ward.js never builds a
 * `vitals.abg` bundle. This dataset does not invent that capability; it gives the two
 * ABG-adjacent values the real pipeline actually supports.
 *
 * 5 branches x 5 patients. Nephrology is the deliberate dosing showcase: five patients
 * spanning normal renal function to severe CKD, so the SAME antibiotic/renal-dosing
 * calculator visibly gives a different dose for each one. The ICU branch is
 * "StewardMD MICU": a named unit head, five named residents, full vitals, and a
 * 3-day monitoring timeline — the fully-wired reference unit for the demo.
 */
(function () {
  "use strict";

  var MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  function ghDate(hoursAgo) {
    var d = new Date(Date.now() - (hoursAgo || 0) * 3600000);
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return pad(d.getDate()) + "-" + MON[d.getMonth()] + "-" + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // ---------------------------------------------------------------- labs
  // name -> { unit, low, high }. Every name below is checked against icu.js's real
  // mapWardLab() in test/demo-hospital.test.mjs, not assumed to match.
  var PANEL = {
    "Sodium": { u: "mEq/L", lo: 135, hi: 145 },
    "Potassium": { u: "mEq/L", lo: 3.5, hi: 5.0 },
    "Chloride": { u: "mEq/L", lo: 98, hi: 107 },
    "Bicarbonate": { u: "mEq/L", lo: 22, hi: 29 },
    "Serum Calcium": { u: "mg/dL", lo: 8.5, hi: 10.5 },
    "Serum Magnesium": { u: "mg/dL", lo: 1.7, hi: 2.4 },
    "Serum Phosphate": { u: "mg/dL", lo: 2.5, hi: 4.5 },
    "Serum Creatinine": { u: "mg/dL", lo: 0.6, hi: 1.3 },
    "Blood Urea": { u: "mg/dL", lo: 15, hi: 40 },
    "Random Blood Sugar": { u: "mg/dL", lo: 70, hi: 140 },
    "Haemoglobin": { u: "g/dL", lo: 12, hi: 16 },
    "Total WBC Count": { u: "/cumm", lo: 4000, hi: 11000 },
    "Platelet Count": { u: "lakhs/cumm", lo: 1.5, hi: 4.5 },
    "Haematocrit": { u: "%", lo: 36, hi: 46 },
    "Neutrophils": { u: "%", lo: 40, hi: 70 },
    "Total Bilirubin": { u: "mg/dL", lo: 0.2, hi: 1.2 },
    "Direct Bilirubin": { u: "mg/dL", lo: 0.0, hi: 0.3 },
    "SGOT (AST)": { u: "U/L", lo: 5, hi: 40 },
    "SGPT (ALT)": { u: "U/L", lo: 5, hi: 40 },
    "Serum Albumin": { u: "g/dL", lo: 3.5, hi: 5.0 },
    "PT/INR": { u: "ratio", lo: 0.8, hi: 1.2 },
    "C-Reactive Protein": { u: "mg/L", lo: 0, hi: 5 },
    "Lactate": { u: "mmol/L", lo: 0.5, hi: 2.0 }
  };
  // Every patient gets every one of these across every day: a real RFT+LFT+electrolyte
  // +CBC+coag+inflammatory panel, not a partial vignette subset.
  var FULL = Object.keys(PANEL);
  var DAYS = 6;

  function roundFor(name, v) {
    if (name === "Total WBC Count" || name === "Random Blood Sugar" || name === "Blood Urea") return Math.round(v);
    if (name === "Platelet Count") return Math.round(v * 100) / 100;
    return Math.round(v * 10) / 10;
  }
  // Trend value at day index d (0=oldest .. DAYS-1=newest). raw is either a flat number
  // (stable baseline, with a tiny deterministic wobble so 6 identical days don't look
  // machine-generated) or a [start, end] pair (a real trend across the 6 days).
  function seriesFor(raw, d, ti) {
    if (Array.isArray(raw)) { var frac = d / (DAYS - 1); return raw[0] + (raw[1] - raw[0]) * frac; }
    var wobble = Math.sin((d + ti) * 1.7) * 0.02;
    return raw * (1 + wobble);
  }
  function mkTrend(vals, endHoursAgo) {
    var rows = [];
    for (var d = 0; d < DAYS; d++) {
      var hoursAgo = (endHoursAgo || 2) + (DAYS - 1 - d) * 24;
      var dateStr = ghDate(hoursAgo);
      FULL.forEach(function (name, ti) {
        var spec = PANEL[name];
        var raw = (vals && vals[name] != null) ? vals[name] : (spec.lo + spec.hi) / 2;
        var v = roundFor(name, seriesFor(raw, d, ti));
        rows.push({ test: name, result: String(v), units: spec.u, low: spec.lo, high: spec.hi, date: dateStr });
      });
    }
    return rows;
  }

  // ---------------------------------------------------------------- imaging
  var _rid = 500000;
  function usg(report, doctor, hoursAgo) {
    _rid += 1;
    return { resultid: "THUSG" + _rid, studyName: "USG Abdomen", date: ghDate(hoursAgo != null ? hoursAgo : 30), report: report, doctor: doctor };
  }
  function cect(report, doctor, hoursAgo) {
    _rid += 1;
    return { resultid: "THCECT" + _rid, studyName: "CECT Abdomen", date: ghDate(hoursAgo != null ? hoursAgo : 20), report: report, doctor: doctor };
  }

  // ---------------------------------------------------------------- ICU vitals
  // 3 days, 3 readings/day (08:00 / 14:00 / 20:00-equivalent, oldest to newest). Each
  // reading routes through the SAME ICU.ingestMonitor() a clinician's manual vitals
  // entry uses (see ghis-ward.js: loadIntoICU, the DEMO.vitalsByPatientId branch).
  function mkVitals(spec) {
    var rows = [];
    var readingsPerDay = 3, totalDays = 3, n = readingsPerDay * totalDays;
    for (var i = 0; i < n; i++) {
      var hoursAgo = (n - 1 - i) * 8;   // newest (i=n-1) is ~0-8h ago; oldest (i=0) is ~2 days back
      var frac = i / (n - 1);
      var row = { ts: Date.now() - hoursAgo * 3600000 };
      Object.keys(spec).forEach(function (k) {
        var raw = spec[k];
        row[k] = Array.isArray(raw) ? Math.round((raw[0] + (raw[1] - raw[0]) * frac) * 10) / 10 : raw;
      });
      rows.push(row);
    }
    return rows;
  }

  var pid = 100000;
  function P(name, gender, age, bed, doctor, vals, endHoursAgo, imaging, vitals) {
    pid += 1;
    var patientId = "TH" + pid;
    return {
      patientId: patientId, episodeId: "THEP" + pid,
      name: name, gender: gender, age: age, bed: bed, doctor: doctor,
      labs: mkTrend(vals, endHoursAgo),
      imaging: imaging || [],
      vitals: vitals || null
    };
  }

  var BRANCHES = [
    { dept: "General Medicine", patients: [
      P("Ramesh Iyer", "M", 62, "GM-1", "Priya Nair",
        { Sodium: 122, Potassium: 3.8, "Serum Creatinine": 0.9, "Blood Urea": 28, Haemoglobin: 13.2 }, 3,
        [ usg("Liver, gallbladder, pancreas, spleen and both kidneys normal. No free fluid.", "Radiology"),
          cect("No acute intra-abdominal pathology. No lymphadenopathy or collection.", "Radiology") ]),
      P("Lakshmi Reddy", "F", 55, "GM-2", "Priya Nair",
        { Haemoglobin: [7.2, 8.6], Sodium: 138, Potassium: 4.1, "Serum Creatinine": 0.8 }, 3,
        [ usg("Normal liver echotexture. No splenomegaly. Kidneys normal, no calculus.", "Radiology"),
          cect("No source of occult blood loss identified. Bowel loops unremarkable.", "Radiology") ]),
      P("Suresh Babu", "M", 70, "GM-3", "Arjun Menon",
        { "Serum Creatinine": [1.5, 2.1], "Blood Urea": [42, 62], Potassium: 5.1, Haemoglobin: 11.5 }, 2,
        [ usg("Both kidneys mildly increased in echogenicity, normal size, no hydronephrosis.", "Radiology"),
          cect("No obstructive uropathy. No renal mass or calculus identified.", "Radiology") ]),
      P("Kavitha Rao", "F", 48, "GM-4", "Arjun Menon",
        { "Random Blood Sugar": [340, 302], Sodium: 133, "Serum Creatinine": 0.9 }, 3,
        [ usg("Liver shows mild fatty change. Pancreas and kidneys normal.", "Radiology"),
          cect("No acute pancreatitis. No abdominal collection.", "Radiology") ]),
      P("Narayana Swamy", "M", 66, "GM-5", "Priya Nair", {}, 4,
        [ usg("All abdominal organs normal in size and echotexture.", "Radiology"),
          cect("Unremarkable study, no acute findings.", "Radiology") ])
    ]},
    { dept: "StewardMD MICU", patients: [
      // Unit Head: Dr. Kavita Subramanian. Five named residents below, one per patient,
      // not two names shared across all five (a real ICU rotates several residents).
      P("Mohammed Ali", "M", 58, "ICU-1", "Ritika Sen",
        { "Total WBC Count": [24800, 14200], "Serum Creatinine": [2.1, 1.5], Sodium: 132, Potassium: 5.3, Haemoglobin: 10.2, "Platelet Count": 1.1,
          "C-Reactive Protein": [186, 62], Lactate: [6.4, 2.1] }, 1,
        [ usg("Mild hepatomegaly. No free fluid. No obvious intra-abdominal source of sepsis.", "Radiology", 26),
          cect("No collection. Bowel wall thickening not seen. Lungs bases show mild consolidation (correlate clinically).", "Radiology", 15) ],
        mkVitals({ hr: [128, 92], sbp: [82, 112], dbp: [50, 70], rr: [28, 18], spo2: [90, 97], temp: [39.2, 37.1], uop: [15, 45], lactate: [6.4, 2.1], gcs: [13, 15] })),
      P("Fatima Begum", "F", 71, "ICU-2", "Aditya Rao",
        { "Serum Creatinine": [2.8, 4.6], "Blood Urea": [88, 142], Potassium: [5.2, 6.1], Sodium: 129, Bicarbonate: [19, 15], Haemoglobin: 9.4 }, 1,
        [ usg("Both kidneys normal in size, mildly increased echogenicity, no hydronephrosis.", "Radiology", 24),
          cect("No obstructive cause for renal impairment. No perinephric collection.", "Radiology", 14) ],
        mkVitals({ hr: [96, 104], sbp: [128, 98], dbp: [78, 58], rr: [18, 22], spo2: [97, 94], temp: 37.0, uop: [30, 10], lactate: [1.8, 2.6], gcs: 15 })),
      P("Ravi Kumar", "M", 60, "ICU-3", "Neha Bhatt",
        { "Serum Creatinine": 1.3, Sodium: 130, Potassium: 4.0,
          "Total Bilirubin": [5.2, 8.4], "Direct Bilirubin": [3.1, 5.6], "SGOT (AST)": [260, 340], "SGPT (ALT)": [210, 298], "Serum Albumin": [2.6, 2.1], "PT/INR": [1.9, 2.4] }, 2,
        [ usg("Liver coarse echotexture, features of chronic liver disease. Mild splenomegaly. Trace ascites.", "Radiology", 28),
          cect("Cirrhotic liver morphology. Splenomegaly. Mild ascites, no focal lesion.", "Radiology", 16) ],
        mkVitals({ hr: [88, 96], sbp: [102, 96], dbp: [64, 60], rr: [16, 20], spo2: 96, temp: 37.2, uop: [40, 25], gcs: [15, 12] })),
      P("Anjali Desai", "F", 45, "ICU-4", "Karan Malhotra",
        { Sodium: [118, 128], Potassium: 3.6, "Serum Creatinine": 0.7 }, 2,
        [ usg("No abdominal abnormality. Bladder normally distended.", "Radiology", 25),
          cect("Unremarkable abdominal CECT. No mass or collection.", "Radiology", 13) ],
        mkVitals({ hr: 84, sbp: [110, 118], dbp: [70, 74], rr: 16, spo2: 98, temp: 36.9, uop: 55, gcs: [13, 15] })),
      P("Deepak Verma", "M", 52, "ICU-5", "Priyanka Iyer",
        { "Platelet Count": [0.9, 0.4], Haemoglobin: [10.2, 8.6], "Total WBC Count": [11200, 15200], "Serum Creatinine": [1.1, 1.5], "PT/INR": [1.4, 1.9], "C-Reactive Protein": [64, 118] }, 1,
        [ usg("No intra-abdominal bleed. Spleen mildly enlarged.", "Radiology", 22),
          cect("No retroperitoneal or intra-abdominal haemorrhage. Splenomegaly.", "Radiology", 12) ],
        mkVitals({ hr: [92, 118], sbp: [116, 88], dbp: [72, 54], rr: [16, 24], spo2: [97, 93], temp: [37.4, 38.6], uop: [42, 20], gcs: 15 }))
    ]},
    { dept: "Nephrology", patients: [
      // Deliberate spread of renal function for the dosing demo: normal -> mild -> moderate -> severe -> AKI-on-CKD.
      P("Krishna Murthy", "M", 50, "NEPH-5", "Meera Iyengar",
        { "Serum Creatinine": 0.9, "Blood Urea": 24, Haemoglobin: 13.8 }, 4,
        [ usg("Both kidneys normal size, normal cortical echogenicity, no hydronephrosis.", "Radiology"),
          cect("No renal or ureteric abnormality. Unremarkable study.", "Radiology") ]),
      P("Ganesh Pillai", "M", 64, "NEPH-1", "Meera Iyengar",
        { "Serum Creatinine": [1.2, 1.4], "Blood Urea": [28, 34], Haemoglobin: 12.4 }, 3,
        [ usg("Both kidneys mildly reduced in cortical thickness, no hydronephrosis or calculus.", "Radiology"),
          cect("Findings consistent with early chronic parenchymal renal disease.", "Radiology") ]),
      P("Saroja Devi", "F", 68, "NEPH-2", "Ashok Reddy",
        { "Serum Creatinine": [2.1, 2.6], "Blood Urea": [54, 68], Potassium: 5.0, Haemoglobin: 10.8 }, 2,
        [ usg("Both kidneys reduced in size, increased echogenicity, cortex thinned. No hydronephrosis.", "Radiology"),
          cect("Bilateral small contracted kidneys, chronic parenchymal disease. No obstruction.", "Radiology") ]),
      P("Chandrasekhar Rao", "M", 72, "NEPH-3", "Ashok Reddy",
        { "Serum Creatinine": [4.2, 5.8], "Blood Urea": [118, 156], Potassium: [5.2, 5.8], Bicarbonate: [19, 17], Haemoglobin: [9.8, 8.9] }, 2,
        [ usg("Both kidneys small and echogenic with loss of cortico-medullary differentiation.", "Radiology"),
          cect("End-stage renal parenchymal changes bilaterally. No obstructive cause.", "Radiology") ]),
      P("Padma Priya", "F", 58, "NEPH-4", "Meera Iyengar",
        { "Serum Creatinine": [2.4, 3.9], "Blood Urea": [64, 98], Sodium: 130, Potassium: [5.0, 5.5], Haemoglobin: [10.6, 9.6] }, 2,
        [ usg("Right kidney normal, left kidney shows mild pelvicalyceal fullness.", "Radiology"),
          cect("Mild left hydroureteronephrosis, no definite calculus seen. Correlate clinically.", "Radiology") ])
    ]},
    { dept: "Cardiology", patients: [
      P("Vijay Anand", "M", 67, "CARD-1", "Rohit Malhotra",
        { Potassium: [3.4, 2.9], "Serum Creatinine": 1.1 }, 3,
        [ usg("Liver mildly enlarged with smooth margins, congestive pattern.", "Radiology"),
          cect("No hepatic vein or IVC thrombus. Findings consistent with mild venous congestion.", "Radiology") ]),
      P("Rukmini Bai", "F", 74, "CARD-2", "Anitha George",
        { Potassium: [5.4, 6.3], "Serum Creatinine": 1.6 }, 2,
        [ usg("Both kidneys normal size, mildly echogenic cortex.", "Radiology"),
          cect("No obstructive uropathy. Adrenal glands unremarkable.", "Radiology") ]),
      P("Harish Chandra", "M", 61, "CARD-3", "Anitha George",
        { "Serum Creatinine": [1.7, 2.1], "Blood Urea": [40, 52] }, 3,
        [ usg("Hepatomegaly with congestive pattern. Mild ascites.", "Radiology"),
          cect("Passive hepatic congestion. Trace ascites. No focal liver lesion.", "Radiology") ]),
      P("Meenakshi Sundaram", "F", 69, "CARD-4", "Rohit Malhotra",
        { Haemoglobin: 9.2 }, 3,
        [ usg("Spleen and liver normal. No abdominal source for anaemia identified.", "Radiology"),
          cect("Unremarkable abdominal CECT.", "Radiology") ]),
      P("Subramaniam Iyer", "M", 55, "CARD-5", "Rohit Malhotra", {}, 4,
        [ usg("Normal abdominal ultrasound.", "Radiology"),
          cect("No acute abdominal pathology.", "Radiology") ])
    ]},
    { dept: "General Surgery", patients: [
      P("Arun Prakash", "M", 34, "SURG-1", "Divya Menon",
        { Haemoglobin: [12.8, 11.8], "Total WBC Count": [10200, 12400] }, 20,
        [ usg("Post-appendicectomy status. No collection in the right iliac fossa.", "Radiology", 30),
          cect("No post-operative collection. Bowel loops normal calibre.", "Radiology", 18) ]),
      P("Geetha Krishnan", "F", 41, "SURG-2", "Divya Menon",
        { "Total WBC Count": [10800, 16800], Haemoglobin: 11.0, "C-Reactive Protein": [20, 92] }, 8,
        [ usg("Post-cholecystectomy. Small fluid collection in the gallbladder fossa.", "Radiology", 24),
          cect("Small subhepatic collection, likely post-surgical seroma. No abscess.", "Radiology", 10) ]),
      P("Manoj Tiwari", "M", 47, "SURG-3", "Sanjay Kulkarni",
        { Sodium: 133, Potassium: 3.7 }, 12,
        [ usg("Pre-operative assessment: liver, gallbladder, kidneys normal.", "Radiology", 40),
          cect("No contraindication to surgery identified on this study.", "Radiology", 36) ]),
      P("Shalini Nambiar", "F", 29, "SURG-4", "Sanjay Kulkarni",
        { "PT/INR": [2.4, 2.1] }, 12,
        [ usg("Normal pre-operative abdominal ultrasound.", "Radiology", 38),
          cect("Unremarkable pre-operative CECT abdomen.", "Radiology", 34) ]),
      P("Ashwin Bose", "M", 39, "SURG-5", "Divya Menon", {}, 10,
        [ usg("Normal study, cleared for surgery.", "Radiology", 30),
          cect("No acute abdominal finding.", "Radiology", 28) ])
    ]}
  ];

  window.SMD_TEST_HOSPITAL = { name: "StewardMD Hospital", branches: BRANCHES };
})();
