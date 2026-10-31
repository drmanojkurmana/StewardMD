/* Kardia calculator trust blocks (EchoSuite edge): plain text formula, input units,
   acquisition steps, guideline reference and worked example per calculator.
   ES5 IIFE, no DOM. Content status ai_drafted: every entry carries the
   "Draft, awaiting review" status until the owner reviews it. References reuse
   only the guideline source already cited in that calculator grade detail text.
   Loaded in Node by tests and in the app by kardia-loader.js as KCALC_TRUST,
   keyed by calculator id, after kardia-calc-data.js. */
(function (G) {
  "use strict";
  var T = {};
  T["bsa"] = {
    formula: "BSA = square root of (height in cm times weight in kg divided by 3600).",
    units: { h: "cm", w: "kg" },
    steps: ["Measure height without shoes, to the nearest cm.", "Weigh on calibrated scales in light clothes.", "Use the same scales for serial studies."],
    ref: "Du Bois 1916; Mosteller 1987",
    example: { h: 170, w: 70 },
    status: "Draft, awaiting review"
  };
  T["lv-mass"] = {
    formula: "LV mass = 0.8 times 1.04 times ((LVIDd + IVSd + PWd) cubed minus LVIDd cubed) + 0.6, then divided by BSA.",
    units: { lvid: "cm", ivs: "cm", pw: "cm", bsa: "m²" },
    steps: ["Freeze a PLAX frame at end diastole, beam square to the walls at the leaflet tips.", "Measure septum, cavity and posterior wall, leading edge to leading edge.", "Enter the BSA used for the rest of the study."],
    ref: "ASE/EACVI Chamber Quantification 2015",
    example: { lvid: 5, ivs: 1, pw: 1, bsa: 1.9 },
    status: "Draft, awaiting review"
  };
  T["lv-ef"] = {
    formula: "LVEF = (EDV minus ESV) divided by EDV, times 100.",
    units: { edv: "mL", esv: "mL" },
    steps: ["Trace endocardium in apical four and two chamber views.", "Take EDV at the largest cavity and ESV at the smallest.", "Average both views and state contrast use if any."],
    ref: "ASE/EACVI Chamber Quantification 2015",
    example: { edv: 120, esv: 50 },
    status: "Draft, awaiting review"
  };
  T["lv-volume-index"] = {
    formula: "Indexed volume = Simpson volume divided by BSA. EF = (EDV minus ESV) divided by EDV, times 100.",
    units: { edv: "mL", esv: "mL", bsa: "m²" },
    steps: ["Measure EDV and ESV by biplane Simpson as for EF.", "Enter the BSA from the same visit.", "Report absolute volumes beside the indexed ones."],
    ref: "ASE/EACVI Chamber Quantification 2015",
    example: { edv: 120, esv: 50, bsa: 1.8 },
    status: "Draft, awaiting review"
  };
  T["lv-linear"] = {
    formula: "Fractional shortening = (LVIDd minus LVIDs) divided by LVIDd, times 100.",
    units: { lvid: "cm", lvids: "cm", bsa: "m²" },
    steps: ["Measure at the mitral leaflet tips, square to the long axis.", "Take LVIDd at end diastole and LVIDs at end systole.", "Enter BSA so the indexed diameter can be shown."],
    ref: "ASE/EACVI Chamber Quantification 2015",
    example: { lvid: 5, lvids: 3.2, bsa: 1.8 },
    status: "Draft, awaiting review"
  };
  T["fractional-shortening"] = {
    formula: "Fractional shortening = (LVIDd minus LVIDs) divided by LVIDd, times 100.",
    units: { lvid: "cm", lvids: "cm" },
    steps: ["Measure at the mitral leaflet tips, square to the long axis.", "Take LVIDd at end diastole and LVIDs at end systole."],
    ref: "ASE/EACVI Chamber Quantification 2015",
    example: { lvid: 5, lvids: 3.2 },
    status: "Draft, awaiting review"
  };
  T["lv-gls"] = {
    formula: "GLS = average longitudinal strain of 17 segments. Enter the size as a positive number; the result restores the minus sign.",
    units: { gls: "%" },
    steps: ["Track speckles in three apical views at a steady frame rate.", "Check tracking on every wall before accepting.", "Use the same vendor for serial studies."],
    ref: "ASE/EACVI Chamber Quantification 2015",
    example: { gls: 18 },
    status: "Draft, awaiting review"
  };
  T["la-size"] = {
    formula: "LA volume index = biplane LA volume at end systole divided by BSA.",
    units: { lavi: "mL/m²", lad: "cm" },
    steps: ["Trace LA in dedicated four and two chamber views at end systole.", "Leave out the appendage and vein openings.", "Index to the visit BSA; do not grade on diameter alone."],
    ref: "ASE/EACVI Chamber Quantification 2015",
    example: { lavi: 28, lad: 3.8 },
    status: "Draft, awaiting review"
  };
  T["ra-size"] = {
    formula: "RA size grades on area at end systole, with indexed volume as backup.",
    units: { raa: "cm²", ravi: "mL/m²" },
    steps: ["Use an RV focused apical view at end systole.", "Trace RA area inside the wall.", "Index the volume to the visit BSA."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { raa: 16, ravi: 25 },
    status: "Draft, awaiting review"
  };
  T["rv-size"] = {
    formula: "RV size grades on the basal diameter at end diastole, backed by mid diameter and length.",
    units: { rvd1: "mm", rvd2: "mm", rvl: "mm" },
    steps: ["Use an RV focused view at end diastole.", "Measure basal width at the widest point, mid width halfway up, length to the apex.", "Recheck focus if the length looks short."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { rvd1: 38, rvd2: 30, rvl: 75 },
    status: "Draft, awaiting review"
  };
  T["rv-function"] = {
    formula: "FAC = (EDA minus ESA) divided by EDA, times 100, read with TAPSE and S prime.",
    units: { eda: "cm²", esa: "cm²", tapse: "mm", sp: "cm/s" },
    steps: ["Trace RV areas at end diastole and end systole in the focused view.", "Measure TAPSE by M mode at the lateral annulus.", "Sample S prime by tissue Doppler at the same annulus."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { eda: 20, esa: 12, tapse: 20, sp: 12 },
    status: "Draft, awaiting review"
  };
  T["aortic-size"] = {
    formula: "Indexed size = aortic diameter divided by BSA, measured leading edge to leading edge.",
    units: { ann: "mm", sinus: "mm", stj: "mm", asc: "mm", bsa: "m²" },
    steps: ["Freeze PLAX at end diastole, wall square to the beam.", "Measure annulus, sinuses, junction and ascending aorta.", "Enter the visit BSA for indexing."],
    ref: "ASE/EACVI Chamber Quantification 2015",
    example: { ann: 24, sinus: 34, stj: 30, asc: 34, bsa: 1.8 },
    status: "Draft, awaiting review"
  };
  T["annulus-reversus"] = {
    formula: "Reversus = septal e prime minus lateral e prime. A positive value flags reversus.",
    units: { sept: "cm/s", lat: "cm/s" },
    steps: ["Sample tissue Doppler at the septal annulus.", "Sample tissue Doppler at the lateral annulus.", "Read with breathing and hepatic vein signs, never alone."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { sept: 6, lat: 5 },
    status: "Draft, awaiting review"
  };
  T["wmsi"] = {
    formula: "WMSI = sum of segment scores divided by the number of segments seen. 1.0 is normal.",
    units: { s1: "count", s2: "count", s3: "count", s4: "count" },
    steps: ["Score only segments you can see in the 17 segment model.", "Count each segment once, at its worst grade.", "State how many segments were seen in the report."],
    ref: "ASE/EACVI Chamber Quantification 2015",
    example: { s1: 12, s2: 3, s3: 2, s4: 0 },
    status: "Draft, awaiting review"
  };
  T["diastolic-sinus"] = {
    formula: "Average E/e prime = E divided by the mean of septal and lateral e prime. Majority rule with LA volume index and TR velocity.",
    units: { e: "m/s", a: "m/s", sept: "cm/s", lat: "cm/s", lavi: "mL/m²", trv: "m/s" },
    steps: ["Record mitral E and A by pulsed Doppler at the leaflet tips.", "Sample septal and lateral e prime by tissue Doppler.", "Measure LA volume index and TR velocity on the same study."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 0.8, a: 0.6, sept: 8, lat: 10, lavi: 28, trv: 2.4 },
    status: "Draft, awaiting review"
  };
  T["lap-ee"] = {
    formula: "Average E/e prime = E times 100 divided by the mean of septal and lateral e prime. 8 or less is normal, 14 or more is raised.",
    units: { e: "m/s", sept: "cm/s", lat: "cm/s" },
    steps: ["Record mitral E at the leaflet tips.", "Sample septal and lateral e prime by tissue Doppler.", "Average at least 3 beats in sinus rhythm."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 0.9, sept: 7, lat: 9 },
    status: "Draft, awaiting review"
  };
  T["diastolic-af"] = {
    formula: "Septal E/e prime = E times 100 divided by septal e prime. Vote with TR velocity, LA volume and deceleration time.",
    units: { e: "m/s", sept: "cm/s", trv: "m/s", lavi: "mL/m²", dt: "ms" },
    steps: ["Average 5 to 10 beats at matched cycle lengths.", "Record septal e prime, TR velocity and deceleration time.", "Measure LA volume index on the same study."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 1, sept: 7, trv: 2.6, lavi: 36, dt: 170 },
    status: "Draft, awaiting review"
  };
  T["diastolic-hcm"] = {
    formula: "Average E/e prime = E times 100 divided by the mean of septal and lateral e prime, read with LA volume and TR velocity.",
    units: { e: "m/s", sept: "cm/s", lat: "cm/s", lavi: "mL/m²", trv: "m/s" },
    steps: ["Record mitral E and both annular e prime values.", "Measure LA volume index and TR velocity.", "Record the outflow gradient alongside."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 0.9, sept: 6, lat: 7, lavi: 38, trv: 2.6 },
    status: "Draft, awaiting review"
  };
  T["diastolic-mac"] = {
    formula: "Average E/e prime = E times 100 divided by the mean of septal and lateral e prime, with LA volume and TR velocity carrying more weight.",
    units: { e: "m/s", sept: "cm/s", lat: "cm/s", lavi: "mL/m²", trv: "m/s" },
    steps: ["Record mitral E clear of the calcium shadow.", "Sample both annular e prime values.", "Add LA volume, TR velocity and pulmonary vein flow."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 1, sept: 6, lat: 6, lavi: 36, trv: 2.6 },
    status: "Draft, awaiting review"
  };
  T["diastolic-mr"] = {
    formula: "Average E/e prime = E times 100 divided by the mean of septal and lateral e prime, read with LA volume in MR.",
    units: { e: "m/s", sept: "cm/s", lat: "cm/s", lavi: "mL/m²", trv: "m/s" },
    steps: ["Record mitral E and both annular e prime values.", "Measure LA volume index and TR velocity.", "State MR severity beside the pressure read."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 1.1, sept: 8, lat: 10, lavi: 40, trv: 2.7 },
    status: "Draft, awaiting review"
  };
  T["diastolic-ms"] = {
    formula: "Grade by mitral valve area with the mean gradient at a stated heart rate.",
    units: { mva: "cm²", mg: "mmHg", lavi: "mL/m²", trv: "m/s" },
    steps: ["Measure valve area by planimetry where possible.", "Record the mean gradient with the heart rate.", "Add LA volume and TR velocity for pressure context."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { mva: 1.4, mg: 8, lavi: 42, trv: 2.8 },
    status: "Draft, awaiting review"
  };
  T["diastolic-ph"] = {
    formula: "Average E/e prime = E times 100 divided by the mean of septal and lateral e prime, read with PASP.",
    units: { e: "m/s", sept: "cm/s", lat: "cm/s", lavi: "mL/m²", pasp: "mmHg" },
    steps: ["Record mitral E and both annular e prime values.", "Measure LA volume index for left sided pressure.", "Estimate PASP from the TR jet on the same study."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 0.7, sept: 7, lat: 8, lavi: 26, pasp: 55 },
    status: "Draft, awaiting review"
  };
  T["diastolic-restrictive"] = {
    formula: "E/A = E divided by A. Restrictive = E/A of 2 or more with deceleration time under 160 ms and low e prime.",
    units: { e: "m/s", a: "m/s", sept: "cm/s", lat: "cm/s", dt: "ms" },
    steps: ["Record mitral E, A and deceleration time.", "Sample septal and lateral e prime.", "Compare with the athletic heart before calling restriction."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 1.2, a: 0.4, sept: 5, lat: 5, dt: 140 },
    status: "Draft, awaiting review"
  };
  T["diastolic-transplant"] = {
    formula: "Average E/e prime = E times 100 divided by the mean of septal and lateral e prime, trended over serial studies.",
    units: { e: "m/s", sept: "cm/s", lat: "cm/s", lavi: "mL/m²", trv: "m/s" },
    steps: ["Record mitral E and both annular e prime values.", "Measure LA volume index and TR velocity.", "Compare with the last study, not with one cut off."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 1, sept: 7, lat: 8, lavi: 34, trv: 2.5 },
    status: "Draft, awaiting review"
  };
  T["diastolic-lvad"] = {
    formula: "Average E/e prime = E times 100 divided by the mean of septal and lateral e prime, read at a stated pump speed.",
    units: { e: "m/s", sept: "cm/s", lat: "cm/s", lavi: "mL/m²", trv: "m/s" },
    steps: ["Record device speed and aortic valve opening first.", "Record mitral E and both annular e prime values.", "Note septal position beside the numbers."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 0.8, sept: 7, lat: 8, lavi: 32, trv: 2.5 },
    status: "Draft, awaiting review"
  };
  T["diastolic-exercise"] = {
    formula: "Exercise septal E/e prime = exercise E times 100 divided by exercise septal e prime. Positive with TR over 2.8 m/s.",
    units: { e: "m/s", sept: "cm/s", trv: "m/s", restEe: "ratio" },
    steps: ["Record resting E/e prime before exercise.", "Acquire E and septal e prime early in recovery.", "Add exercise TR velocity on the same stage."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 1.2, sept: 8, trv: 3, restEe: 9 },
    status: "Draft, awaiting review"
  };
  T["diastolic-tachycardia"] = {
    formula: "Average E/e prime = E times 100 divided by the mean of septal and lateral e prime, read with heart rate.",
    units: { e: "m/s", sept: "cm/s", lat: "cm/s", trv: "m/s", hr: "bpm" },
    steps: ["Record the heart rate with every fused inflow.", "Sample both annular e prime values.", "Add LA volume and TR velocity where E and A fuse."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 1, sept: 7, lat: 8, trv: 2.6, hr: 110 },
    status: "Draft, awaiting review"
  };
  T["lap-mr"] = {
    formula: "Average E/e prime with Ar minus A duration. 30 ms or more supports raised LA pressure.",
    units: { e: "m/s", sept: "cm/s", lat: "cm/s", ardur: "ms" },
    steps: ["Record mitral E and both annular e prime values.", "Sample pulmonary vein Ar in sinus rhythm.", "Measure mitral A duration on the same beats."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 1.1, sept: 8, lat: 10, ardur: 20 },
    status: "Draft, awaiting review"
  };
  T["hepatic-reversal"] = {
    formula: "Reversal ratio = expiratory reversal velocity divided by expiratory forward velocity. 0.79 or more meets the constriction mark.",
    units: { fwd: "cm/s", rev: "cm/s" },
    steps: ["Sample hepatic vein pulsed Doppler during free breathing.", "Freeze an expiratory beat, not a breath hold.", "Measure forward then reversal velocity on the same beat."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { fwd: 40, rev: 18 },
    status: "Draft, awaiting review"
  };
  T["as-continuity"] = {
    formula: "AVA = LVOT area times LVOT VTI divided by aortic VTI. LVOT area = pi times (diameter over 2) squared.",
    units: { lvotd: "cm", lvotvti: "cm", avvti: "cm", peakv: "m/s", meanG: "mmHg" },
    steps: ["Measure LVOT diameter inner edge to inner edge in systole.", "Trace LVOT VTI just below the valve, laminar and parallel.", "Trace the aortic VTI through the valve with the peak velocity."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { lvotd: 2, lvotvti: 22, avvti: 95, peakv: 4.2, meanG: 42 },
    status: "Draft, awaiting review"
  };
  T["lvot-flow"] = {
    formula: "Stroke volume = LVOT area times LVOT VTI. Index = stroke volume divided by BSA. Low flow is 35 or less.",
    units: { lvotd: "cm", lvotvti: "cm", bsa: "m²", hr: "bpm" },
    steps: ["Measure LVOT diameter in systole as for continuity.", "Trace LVOT VTI just below the valve.", "Enter BSA and heart rate for index and output."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { lvotd: 2, lvotvti: 22, bsa: 1.8, hr: 70 },
    status: "Draft, awaiting review"
  };
  T["ar-continuity"] = {
    formula: "Regurgitant volume = LVOT forward stroke volume minus Simpson stroke volume, valid with lone AR.",
    units: { lvotd: "cm", lvotvti: "cm", svVol: "mL" },
    steps: ["Measure LVOT forward stroke volume as for continuity.", "Enter the Simpson biplane stroke volume.", "Rule out MR or shunt before trusting the number."],
    ref: "ASE Native Valve Regurgitation 2017",
    example: { lvotd: 2.1, lvotvti: 26, svVol: 95 },
    status: "Draft, awaiting review"
  };
  T["ar-pisa"] = {
    formula: "Flow = 2 times pi times radius squared times aliasing velocity. EROA = flow divided by peak velocity. Volume = EROA times VTI.",
    units: { r: "cm", va: "cm/s", peakv: "m/s", vti: "cm" },
    steps: ["Zoom on the AR jet and lower the aliasing velocity.", "Measure the PISA radius at mid systole.", "Trace peak velocity and VTI through the jet."],
    ref: "ASE Native Valve Regurgitation 2017",
    example: { r: 0.7, va: 35, peakv: 4, vti: 180 },
    status: "Draft, awaiting review"
  };
  T["mr-pisa"] = {
    formula: "Flow = 2 times pi times radius squared times aliasing velocity. EROA = flow divided by peak MR velocity. Volume = EROA times MR VTI.",
    units: { r: "cm", va: "cm/s", peakv: "m/s", vti: "cm" },
    steps: ["Zoom on the MR jet and set aliasing near 35 cm/s.", "Measure the PISA radius at mid systole.", "Trace peak MR velocity and VTI through the jet."],
    ref: "ASE Native Valve Regurgitation 2017",
    example: { r: 0.8, va: 35, peakv: 5, vti: 150 },
    status: "Draft, awaiting review"
  };
  T["mr-continuity"] = {
    formula: "Regurgitant volume = mitral stroke volume minus LVOT stroke volume, valid without AR or shunt.",
    units: { mvd: "cm", mvvti: "cm", lvotd: "cm", lvotvti: "cm" },
    steps: ["Measure mitral annulus diameter and inflow VTI.", "Measure LVOT stroke volume as for continuity.", "Remember the annulus is elliptical, so treat as backup."],
    ref: "ASE Native Valve Regurgitation 2017",
    example: { mvd: 3.2, mvvti: 28, lvotd: 2, lvotvti: 22 },
    status: "Draft, awaiting review"
  };
  T["mitral-pht"] = {
    formula: "MVA = 220 divided by pressure half time in ms.",
    units: { pht: "ms" },
    steps: ["Trace the mitral E deceleration slope on continuous Doppler.", "Read pressure half time off the same envelope.", "Record the heart rate beside the area."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { pht: 150 },
    status: "Draft, awaiting review"
  };
  T["mitral-pisa"] = {
    formula: "Flow = 2 times pi times radius squared times aliasing velocity times (angle over 180). MVA = flow divided by peak velocity.",
    units: { r: "cm", va: "cm/s", peakv: "m/s", angle: "degrees" },
    steps: ["Zoom on the mitral inflow and set aliasing low.", "Measure the PISA radius and the leaflet opening angle.", "Trace peak E velocity through the valve."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { r: 0.9, va: 30, peakv: 1.8, angle: 110 },
    status: "Draft, awaiting review"
  };
  T["mitral-continuity"] = {
    formula: "MVA = LVOT stroke volume divided by mitral VTI, valid without regurgitation.",
    units: { lvotd: "cm", lvotvti: "cm", mvvti: "cm" },
    steps: ["Measure LVOT stroke volume as for continuity.", "Trace mitral inflow VTI on the same study.", "Rule out MR and AR before trusting the number."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { lvotd: 2, lvotvti: 22, mvvti: 55 },
    status: "Draft, awaiting review"
  };
  T["tr-pisa"] = {
    formula: "Flow = 2 times pi times radius squared times aliasing velocity. EROA = flow divided by peak TR velocity. Volume = EROA times VTI.",
    units: { r: "cm", va: "cm/s", peakv: "m/s", vti: "cm" },
    steps: ["Zoom on the TR jet, usually at a low aliasing velocity.", "Measure the PISA radius at mid systole.", "Trace peak TR velocity and VTI through the jet."],
    ref: "ASE Native Valve Regurgitation 2017",
    example: { r: 0.7, va: 28, peakv: 3, vti: 90 },
    status: "Draft, awaiting review"
  };
  T["tricuspid-stenosis"] = {
    formula: "Significant TS = mean gradient 5 mmHg or more at a normal rate. PHT area is backup only.",
    units: { meanG: "mmHg", vti: "cm", pht: "ms" },
    steps: ["Trace tricuspid inflow on continuous Doppler.", "Record the mean gradient with the heart rate.", "Average 5 beats across the breath cycle."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { meanG: 6, vti: 60, pht: 220 },
    status: "Draft, awaiting review"
  };
  T["pulmonic-stenosis"] = {
    formula: "Peak gradient = 4 times peak velocity squared. Grade by peak velocity with the gradient.",
    units: { peakv: "m/s", meanG: "mmHg" },
    steps: ["Align continuous Doppler with the pulmonic jet.", "Record peak velocity and mean gradient together.", "Inspect whether obstruction is valvar or infundibular."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { peakv: 3.2, meanG: 22 },
    status: "Draft, awaiting review"
  };
  T["pulmonic-regurg"] = {
    formula: "Diastolic PA pressure = 4 times end PR velocity squared plus RAP. Jet width ratio backs severity.",
    units: { prEndV: "m/s", rapEst: "mmHg", jetW: "ratio" },
    steps: ["Trace the PR jet to end diastole on continuous Doppler.", "Enter RAP from the IVC on the same study.", "Measure jet width against RVOT width."],
    ref: "ASE Native Valve Regurgitation 2017",
    example: { prEndV: 1.8, rapEst: 8, jetW: 0.5 },
    status: "Draft, awaiting review"
  };
  T["lv-pressure"] = {
    formula: "LV systolic = 4 times MR velocity squared plus LA pressure. LVEDP = diastolic pressure minus 4 times AR velocity squared.",
    units: { mrv: "m/s", lapEst: "mmHg", sbp: "mmHg", arv: "m/s", dbp: "mmHg" },
    steps: ["Trace full MR and AR envelopes with clean edges.", "Enter cuff systolic and diastolic pressure.", "Enter LA pressure from the diastolic grade."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { mrv: 5, lapEst: 15, sbp: 120, arv: 4, dbp: 70 },
    status: "Draft, awaiting review"
  };
  T["aortic-prosthesis"] = {
    formula: "DVI = LVOT VTI divided by prosthesis VTI. EOA = LVOT area times DVI.",
    units: { peakv: "m/s", meanG: "mmHg", lvotvti: "cm", avvti: "cm", lvotd: "cm" },
    steps: ["Sample LVOT VTI just below the sewing ring.", "Trace prosthesis VTI and peak velocity through the valve.", "Compare with the early baseline study."],
    ref: "ASE Prosthetic Valves 2024",
    example: { peakv: 2.8, meanG: 18, lvotvti: 22, avvti: 48, lvotd: 2 },
    status: "Draft, awaiting review"
  };
  T["aortic-prosthesis-screen"] = {
    formula: "Screen flags: peak 3 m/s or more, DVI under 0.35, acceleration time 100 ms or more. Two flags fail the screen.",
    units: { peakv: "m/s", meanG: "mmHg", dvi: "ratio", at: "ms" },
    steps: ["Record peak velocity and mean gradient.", "Enter DVI from the last full study or measure it.", "Measure acceleration time on the prosthesis jet."],
    ref: "ASE Prosthetic Valves 2024",
    example: { peakv: 2.4, meanG: 12, dvi: 0.45, at: 80 },
    status: "Draft, awaiting review"
  };
  T["aortic-prosthesis-serial"] = {
    formula: "Rise = current mean gradient minus baseline mean gradient, read with the peak velocity change.",
    units: { curG: "mmHg", baseG: "mmHg", curV: "m/s", baseV: "m/s" },
    steps: ["Find the early baseline study at matched flow.", "Enter current and baseline gradients.", "Enter current and baseline peak velocities."],
    ref: "ASE Prosthetic Valves 2024",
    example: { curG: 22, baseG: 12, curV: 3.2, baseV: 2.4 },
    status: "Draft, awaiting review"
  };
  T["mitral-prosthesis"] = {
    formula: "No single number grades a mitral prosthesis. Combine E velocity, mean gradient, PHT area and VTI ratio.",
    units: { peakE: "m/s", meanG: "mmHg", pht: "ms", vtiRatio: "ratio" },
    steps: ["Trace E velocity and mean gradient with the heart rate.", "Read pressure half time off the same envelope.", "Measure prosthesis VTI over LVOT VTI for the ratio."],
    ref: "ASE Prosthetic Valves 2024",
    example: { peakE: 1.8, meanG: 6, pht: 130, vtiRatio: 1.8 },
    status: "Draft, awaiting review"
  };
  T["mitral-prosthesis-screen"] = {
    formula: "Screen flags: E 1.9 m/s or more, mean gradient 6 or more. PHT area flags but never rules.",
    units: { peakE: "m/s", meanG: "mmHg", pht: "ms" },
    steps: ["Record E velocity and mean gradient.", "Read pressure half time on the same beats.", "Send abnormal screens for leaflet imaging."],
    ref: "ASE Prosthetic Valves 2024",
    example: { peakE: 1.9, meanG: 7, pht: 160 },
    status: "Draft, awaiting review"
  };
  T["rap"] = {
    formula: "RAP is 3, 8 or 15 mmHg from IVC size and collapse. Small with good collapse is 3; big with poor collapse is 15.",
    units: { ivcd: "mm", collapse: "%" },
    steps: ["Image the IVC 1 to 2 cm below the right atrium.", "Measure diameter in expiration.", "Watch collapse on a sniff or quiet breath in."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { ivcd: 18, collapse: 60 },
    status: "Draft, awaiting review"
  };
  T["rvsp"] = {
    formula: "RVSP = 4 times TR velocity squared plus RAP. It equals PASP without RVOT obstruction.",
    units: { trv: "m/s", rap: "mmHg" },
    steps: ["Trace the full TR envelope, parallel to the jet.", "Record the peak TR velocity.", "Enter RAP from the IVC on the same study."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { trv: 3, rap: 8 },
    status: "Draft, awaiting review"
  };
  T["pa-pressure"] = {
    formula: "Systolic = 4 times TR velocity squared plus RAP. Diastolic = 4 times end PR velocity squared plus RAP. Mean blends systolic and diastolic.",
    units: { trv: "m/s", rap: "mmHg", prend: "m/s", pat: "ms" },
    steps: ["Trace TR and end PR jets on the same study.", "Enter RAP from the IVC.", "Record acceleration time as a cross check."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { trv: 3, rap: 8, prend: 1.5, pat: 110 },
    status: "Draft, awaiting review"
  };
  T["mpap-rvot"] = {
    formula: "Mean PA pressure = 4 times peak early PR velocity squared plus RAP.",
    units: { pat: "ms", peakpr: "m/s", rap: "mmHg" },
    steps: ["Trace the early PR jet on continuous Doppler.", "Record peak early velocity and acceleration time.", "Enter RAP from the IVC."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { pat: 95, peakpr: 2.2, rap: 8 },
    status: "Draft, awaiting review"
  };
  T["pvr"] = {
    formula: "PVR = (TR velocity divided by RVOT VTI) times 10 plus 0.16, in Wood units. A screen only.",
    units: { trv: "m/s", rvotvti: "cm" },
    steps: ["Record peak TR velocity as for RVSP.", "Trace RVOT VTI just below the pulmonic valve.", "Send raised values for catheter study."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { trv: 3.2, rvotvti: 14 },
    status: "Draft, awaiting review"
  };
  T["mpi"] = {
    formula: "MPI = (closure to opening time minus ejection time) divided by ejection time.",
    units: { tco: "ms", et: "ms" },
    steps: ["Record valve timings on the same beats.", "Measure closure to opening time.", "Measure ejection time on the outflow trace."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { tco: 380, et: 280 },
    status: "Draft, awaiting review"
  };
  T["qpqs"] = {
    formula: "Qp = RVOT area times RVOT VTI. Qs = LVOT area times LVOT VTI. Ratio = Qp divided by Qs.",
    units: { rvotd: "cm", rvotvti: "cm", lvotd: "cm", lvotvti: "cm" },
    steps: ["Measure RVOT and LVOT diameters in systole.", "Trace RVOT and LVOT VTI with parallel jets.", "Use one consistent method and state it."],
    ref: "BSE and ASE Right Heart Guidelines",
    example: { rvotd: 2.4, rvotvti: 18, lvotd: 2, lvotvti: 22 },
    status: "Draft, awaiting review"
  };
  T["asd"] = {
    formula: "Closure referral = Qp/Qs of 1.5 or more with RV volume load. This screen grades burden, never device size.",
    units: { defect: "mm", rvd1: "mm", qpqs: "ratio" },
    steps: ["Measure the defect in two planes.", "Record basal RV diameter for volume load.", "Enter Qp/Qs from the shunt study."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { defect: 14, rvd1: 44, qpqs: 1.8 },
    status: "Draft, awaiting review"
  };
  T["vsd-pressure"] = {
    formula: "RV systolic pressure = cuff systolic minus 4 times VSD velocity squared.",
    units: { vsdv: "m/s", sbp: "mmHg" },
    steps: ["Align continuous Doppler with the VSD jet.", "Record the peak VSD velocity.", "Enter cuff systolic pressure taken with the study."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { vsdv: 4.5, sbp: 115 },
    status: "Draft, awaiting review"
  };
  T["pda-pressure"] = {
    formula: "PA systolic = cuff systolic minus 4 times peak PDA velocity squared. PA diastolic uses end diastolic velocity.",
    units: { pdav: "m/s", sbp: "mmHg", pdavd: "m/s", dbp: "mmHg" },
    steps: ["Find the ductal view with parallel alignment.", "Trace peak then end diastolic PDA velocity.", "Enter cuff systolic and diastolic pressure."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { pdav: 3.5, sbp: 110, pdavd: 1.2, dbp: 65 },
    status: "Draft, awaiting review"
  };
  T["coarctation"] = {
    formula: "Peak gradient = 4 times (peak squared minus proximal squared). Arm to leg gap backs the call.",
    units: { peakv: "m/s", proxv: "m/s", meanG: "mmHg", dbp: "mmHg", sbpArm: "mmHg", sbpLeg: "mmHg" },
    steps: ["Trace descending aorta Doppler from the suprasternal notch.", "Record proximal velocity above the narrowing.", "Take arm and leg pressure with the study."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { peakv: 3, proxv: 1, meanG: 18, dbp: 70, sbpArm: 130, sbpLeg: 100 },
    status: "Draft, awaiting review"
  };
  T["fontan-gradient"] = {
    formula: "Peak gradient = 4 times peak velocity squared. The mean gradient decides in a Fontan circuit.",
    units: { peakv: "m/s", meanG: "mmHg" },
    steps: ["Trace the pathway jet with a low Doppler scale.", "Record peak velocity and mean gradient.", "Note breathing phase and fenestration flow."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { peakv: 1.2, meanG: 3 },
    status: "Draft, awaiting review"
  };
  T["effusion-size"] = {
    formula: "End diastolic depth: under 10 small, 10 to 20 moderate, over 20 mm large. Tamponade is clinical, not size alone.",
    units: { dias: "mm" },
    steps: ["Freeze at end diastole in the view with the largest space.", "Measure the echo free space square to the wall.", "Look for tamponade signs whatever the size."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { dias: 14 },
    status: "Draft, awaiting review"
  };
  T["mitral-respiratory"] = {
    formula: "Fall = (expiration E minus inspiration E) divided by expiration E, times 100. 25 percent or more meets the mark.",
    units: { expE: "m/s", inspE: "m/s" },
    steps: ["Record mitral E during free breathing.", "Freeze a clean expiratory then inspiratory beat.", "Measure E on matched beats only."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { expE: 0.9, inspE: 0.6 },
    status: "Draft, awaiting review"
  };
  T["tricuspid-respiratory"] = {
    formula: "Rise = (inspiration E minus expiration E) divided by expiration E, times 100. 40 percent or more meets the mark.",
    units: { expE: "m/s", inspE: "m/s" },
    steps: ["Record tricuspid E during free breathing.", "Freeze matched expiratory and inspiratory beats.", "Read with the clinical picture for tamponade or constriction."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { expE: 0.5, inspE: 0.75 },
    status: "Draft, awaiting review"
  };
  T["lvot-respiratory"] = {
    formula: "Fall = (expiration VTI minus inspiration VTI) divided by expiration VTI, times 100. 10 percent or more is exaggerated.",
    units: { expV: "cm", inspV: "cm" },
    steps: ["Trace LVOT VTI during free breathing.", "Freeze matched expiratory and inspiratory beats.", "Remember ventilation flips the pattern."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { expV: 22, inspV: 19 },
    status: "Draft, awaiting review"
  };
  T["doppler-equation"] = {
    formula: "Shift = 2 times frequency times blood velocity times cos(angle) divided by sound speed.",
    units: { f0: "MHz", v: "m/s", theta: "degrees", c: "m/s" },
    steps: ["Keep the beam to flow angle at 20 degrees or less.", "Enter the probe transmit frequency.", "Use 1540 m/s for soft tissue sound speed."],
    ref: "Ultrasound physics (ASE physics reviews)",
    example: { f0: 3, v: 1.5, theta: 20, c: 1540 },
    status: "Draft, awaiting review"
  };
  T["bernoulli"] = {
    formula: "Simplified = 4 times distal velocity squared. Extended subtracts 4 times proximal velocity squared.",
    units: { v2: "m/s", v1: "m/s" },
    steps: ["Record the peak distal velocity through the valve.", "Record the proximal velocity below the valve.", "Use the extended form when proximal reaches 1.5 m/s."],
    ref: "Ultrasound physics (ASE physics reviews)",
    example: { v2: 4, v1: 1 },
    status: "Draft, awaiting review"
  };
  T["poiseuille"] = {
    formula: "Teaching index = radius to the fourth power. Doubling radius raises flow sixteen fold at the same pressure.",
    units: { dp: "mmHg", r: "mm", eta: "relative", len: "cm" },
    steps: ["Enter the vessel radius in mm.", "Enter pressure drop, viscosity and length for context.", "Read as teaching, not as a patient flow value."],
    ref: "Ultrasound physics (ASE physics reviews)",
    example: { dp: 10, r: 2, eta: 3.5, len: 5 },
    status: "Draft, awaiting review"
  };
  T["pulse-repetition"] = {
    formula: "Max PRF = 154000 divided by twice the depth in cm. Nyquist is half the PRF, shown as velocity.",
    units: { depth: "cm", f0: "MHz", theta: "degrees" },
    steps: ["Enter the depth of the sample in cm.", "Enter the probe frequency and beam angle.", "Lower frequency or shift the baseline if it aliases."],
    ref: "Ultrasound physics (ASE physics reviews)",
    example: { depth: 16, f0: 3, theta: 0 },
    status: "Draft, awaiting review"
  };
  T["pulse-geometry"] = {
    formula: "Axial resolution = pulse length over 2. Lateral resolution = wavelength times depth over aperture.",
    units: { f0: "MHz", cycles: "count", aperture: "mm", depth: "mm" },
    steps: ["Enter the probe frequency in MHz.", "Enter pulse cycles and aperture width.", "Enter the focus depth in mm."],
    ref: "Ultrasound physics (ASE physics reviews)",
    example: { f0: 3.5, cycles: 3, aperture: 20, depth: 120 },
    status: "Draft, awaiting review"
  };
  T["acoustic"] = {
    formula: "Wavelength = 1540 divided by frequency. Reflection comes from the impedance mismatch at the boundary.",
    units: { f0: "MHz", z1: "MRayl", z2: "MRayl" },
    steps: ["Enter the probe frequency in MHz.", "Enter the first tissue impedance.", "Enter the second tissue impedance."],
    ref: "Ultrasound physics (ASE physics reviews)",
    example: { f0: 3, z1: 1.65, z2: 1.45 },
    status: "Draft, awaiting review"
  };
  T["wave-relations"] = {
    formula: "Period = 1 over frequency. Wavelength = sound speed over frequency, set by the medium not the probe.",
    units: { f0: "MHz", c: "m/s" },
    steps: ["Enter the probe frequency in MHz.", "Enter the medium sound speed.", "Compare soft tissue, fat and bone speeds."],
    ref: "Ultrasound physics (ASE physics reviews)",
    example: { f0: 2.5, c: 1540 },
    status: "Draft, awaiting review"
  };
  T["pathway-diastology"] = {
    formula: "Vote across average E/e prime, LA volume and TR velocity, then read the E/A and deceleration pattern beside the vote.",
    units: { e: "m/s", a: "m/s", sept: "cm/s", lat: "cm/s", lavi: "mL/m²", trv: "m/s" },
    steps: ["Record E, A and both annular e prime values.", "Measure LA volume index and TR velocity.", "Read the inflow pattern against the vote before grading."],
    ref: "ASE/EACVI Diastolic Function 2016",
    example: { e: 0.95, a: 0.6, sept: 6.5, lat: 8, lavi: 36, trv: 2.7 },
    status: "Draft, awaiting review"
  };
  T["pathway-as"] = {
    formula: "High gradient severe = peak 4 and mean 40 with area under 1. Low flow low gradient splits by flow and EF to the next test.",
    units: { peakv: "m/s", meanG: "mmHg", ava: "cm²", svi: "mL/m²", lvef: "%" },
    steps: ["Enter peak velocity, mean gradient and valve area.", "Enter stroke volume index and ejection fraction.", "Follow the named next step for low gradient cases."],
    ref: "ESC/EACTS Valvular Heart Disease 2021",
    example: { peakv: 4.3, meanG: 44, ava: 0.85, svi: 32, lvef: 48 },
    status: "Draft, awaiting review"
  };
  T["pathway-mr"] = {
    formula: "Primary severe = EROA 0.40 with volume 60. Secondary MR grades lower. Mechanism decides.",
    units: { eroa: "cm²", rvol: "mL", vc: "mm", lavi: "mL/m²" },
    steps: ["Enter EROA and regurgitant volume.", "Measure vena contracta on a zoomed jet.", "State the mechanism before the final grade."],
    ref: "ASE Native Valve Regurgitation 2017",
    example: { eroa: 0.42, rvol: 62, vc: 7, lavi: 44 },
    status: "Draft, awaiting review"
  };
  G.KCALC_TRUST = T;
  if (typeof module !== "undefined" && module.exports) module.exports = T;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
