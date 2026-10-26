/* Kardia calculator figures: data only (ES5, no DOM). Loaded lazily by
   kardia-calc.js when a calculator is first opened, and in Node by tests.
   Design contract: Operate mode on Kardia tokens. Every figure shows the
   named view, the exact caliper, trace, sample or envelope for its
   calculator, an ECG strip sharing one clock, a caption, what to measure,
   the common pitfall and an attribution line. Reduced motion draws the
   key frame named in keyPhase. No patient image is bundled: chamber
   contours are original teaching overlays drawn from standard ASE window
   anatomy (see work/calc-media/manifest.json for clinical sources the
   lead can upload). Coordinates are normalised 0 to 1 inside the sector:
   x left to right, y near field (top) to far field (bottom). ed and es
   are end diastolic and end systolic contours of the same chamber. */
(function (G) {
  "use strict";
  var ATTR = "Original teaching overlay for StewardMD, drawn from standard ASE window anatomy. No patient image is shown.";
  function C(n, ed, es) { return { n: n, ed: ed, es: es || ed }; }
  var VIEWS = {
    plax: { label: "Parasternal long axis", chambers: [
      C("RVOT", [0.30,0.16, 0.52,0.13, 0.55,0.30, 0.33,0.34]),
      C("LV", [0.28,0.38, 0.60,0.34, 0.86,0.52, 0.84,0.72, 0.34,0.70], [0.32,0.42, 0.60,0.38, 0.80,0.52, 0.78,0.66, 0.38,0.65]),
      C("LA", [0.62,0.36, 0.88,0.38, 0.90,0.62, 0.64,0.64]),
      C("Ao", [0.56,0.14, 0.68,0.12, 0.70,0.36, 0.58,0.38]) ] },
    a4c: { label: "Apical four chamber", chambers: [
      C("LV", [0.40,0.12, 0.58,0.30, 0.57,0.62, 0.42,0.62, 0.36,0.34], [0.42,0.16, 0.55,0.32, 0.54,0.58, 0.44,0.58, 0.39,0.36]),
      C("RV", [0.60,0.30, 0.76,0.38, 0.74,0.62, 0.59,0.62], [0.61,0.33, 0.73,0.40, 0.71,0.59, 0.60,0.59]),
      C("LA", [0.40,0.64, 0.57,0.64, 0.56,0.86, 0.42,0.86]),
      C("RA", [0.59,0.64, 0.74,0.64, 0.73,0.86, 0.60,0.86]) ] },
    a5c: { label: "Apical five chamber", chambers: [
      C("LV", [0.36,0.12, 0.52,0.28, 0.51,0.60, 0.38,0.60, 0.33,0.32], [0.38,0.16, 0.50,0.30, 0.49,0.56, 0.40,0.56, 0.35,0.34]),
      C("RV", [0.58,0.30, 0.74,0.38, 0.72,0.60, 0.57,0.60], [0.59,0.33, 0.71,0.40, 0.69,0.57, 0.58,0.57]),
      C("LA", [0.36,0.62, 0.51,0.62, 0.50,0.84, 0.38,0.84]),
      C("RA", [0.57,0.62, 0.72,0.62, 0.71,0.84, 0.58,0.84]),
      C("LVOT and Ao", [0.50,0.30, 0.60,0.28, 0.64,0.52, 0.54,0.56]) ] },
    a2c: { label: "Apical two chamber", chambers: [
      C("LV", [0.42,0.12, 0.60,0.30, 0.59,0.62, 0.43,0.62, 0.37,0.34], [0.44,0.16, 0.57,0.32, 0.56,0.58, 0.45,0.58, 0.40,0.36]),
      C("LA", [0.42,0.64, 0.59,0.64, 0.58,0.87, 0.44,0.87]) ] },
    rv: { label: "RV focused apical four chamber", chambers: [
      C("RV", [0.34,0.14, 0.58,0.26, 0.60,0.62, 0.36,0.62, 0.28,0.36], [0.37,0.18, 0.56,0.29, 0.57,0.58, 0.39,0.58, 0.31,0.38]),
      C("LV", [0.61,0.28, 0.76,0.34, 0.75,0.62, 0.62,0.62], [0.62,0.31, 0.74,0.36, 0.73,0.59, 0.63,0.59]),
      C("RA", [0.36,0.64, 0.60,0.64, 0.59,0.87, 0.38,0.87]),
      C("LA", [0.62,0.64, 0.75,0.64, 0.74,0.87, 0.63,0.87]) ] },
    psaxAv: { label: "Parasternal short axis at the aortic valve", chambers: [
      C("AV", [0.42,0.34, 0.58,0.34, 0.58,0.56, 0.42,0.56]),
      C("RVOT", [0.16,0.30, 0.40,0.26, 0.44,0.48, 0.24,0.60, 0.14,0.48]),
      C("LA", [0.40,0.60, 0.62,0.60, 0.64,0.84, 0.42,0.84]),
      C("RA and TV", [0.60,0.30, 0.84,0.34, 0.82,0.58, 0.62,0.56]) ] },
    psaxMv: { label: "Parasternal short axis at the mitral valve", chambers: [
      C("LV", [0.28,0.22, 0.68,0.20, 0.76,0.48, 0.66,0.76, 0.34,0.76, 0.22,0.48], [0.33,0.28, 0.64,0.27, 0.70,0.48, 0.62,0.69, 0.38,0.69, 0.28,0.48]),
      C("MV orifice", [0.36,0.42, 0.62,0.40, 0.64,0.54, 0.38,0.56]),
      C("RV", [0.14,0.18, 0.30,0.16, 0.34,0.40, 0.18,0.46]) ] },
    subcostal: { label: "Subcostal four chamber", chambers: [
      C("LV", [0.46,0.20, 0.62,0.34, 0.61,0.64, 0.47,0.64, 0.41,0.38], [0.48,0.24, 0.60,0.36, 0.59,0.60, 0.49,0.60, 0.44,0.40]),
      C("RV", [0.24,0.32, 0.44,0.26, 0.46,0.64, 0.28,0.64, 0.18,0.44], [0.27,0.35, 0.43,0.30, 0.44,0.60, 0.30,0.60, 0.21,0.46]),
      C("LA", [0.47,0.66, 0.61,0.66, 0.60,0.86, 0.48,0.86]),
      C("RA", [0.28,0.66, 0.45,0.66, 0.44,0.86, 0.30,0.86]) ] },
    ivc: { label: "Subcostal inferior vena cava", chambers: [
      C("IVC", [0.40,0.30, 0.52,0.30, 0.54,0.86, 0.42,0.86], [0.43,0.30, 0.50,0.30, 0.51,0.86, 0.44,0.86]),
      C("RA", [0.36,0.08, 0.62,0.08, 0.60,0.30, 0.38,0.30]),
      C("Liver", [0.10,0.34, 0.38,0.32, 0.40,0.88, 0.12,0.90]) ] },
    arch: { label: "Suprasternal aortic arch", chambers: [
      C("Arch", [0.16,0.62, 0.24,0.30, 0.46,0.16, 0.68,0.22, 0.80,0.44, 0.78,0.78, 0.66,0.78, 0.64,0.48, 0.52,0.32, 0.36,0.34, 0.30,0.62]),
      C("Branches", [0.40,0.16, 0.46,0.06, 0.52,0.16, 0.54,0.06, 0.60,0.16]) ] },
    ductal: { label: "Ductal view", chambers: [
      C("Main PA", [0.20,0.30, 0.48,0.26, 0.52,0.46, 0.24,0.52]),
      C("Ductus", [0.48,0.34, 0.68,0.42, 0.64,0.56, 0.46,0.48]),
      C("Descending Ao", [0.62,0.50, 0.80,0.54, 0.76,0.86, 0.60,0.82]) ] },
    body: { label: "Height and weight today", chambers: [] },
    physics: { label: "Doppler beam and flow", chambers: [
      C("Vessel", [0.14,0.56, 0.86,0.50, 0.86,0.66, 0.14,0.72]) ] }
  };
  /* Spectral envelopes: [phase, velocity] pairs, velocity normalised.
     kind pw is a filled envelope, cw is a dense envelope, inflow has
     E and A waves, tdi is a small tissue signal below the baseline. */
  var WAVES = {
    lvot: { mode: "pw", pts: [[0.14,0],[0.20,0.55],[0.26,0.72],[0.34,0.30],[0.40,0]] },
    av: { mode: "cw", pts: [[0.14,0],[0.22,0.70],[0.30,0.98],[0.38,0.55],[0.44,0]] },
    avLow: { mode: "cw", pts: [[0.14,0],[0.24,0.45],[0.32,0.60],[0.40,0.25],[0.46,0]] },
    mvInflow: { mode: "pw", pts: [[0.46,0],[0.54,0.80],[0.62,0.15],[0.78,0],[0.84,0.55],[0.90,0.05],[0.94,0]] },
    mvCw: { mode: "cw", pts: [[0.46,0],[0.54,0.85],[0.63,0.20],[0.72,0.45],[0.80,0.60],[0.88,0.10],[0.94,0]] },
    mr: { mode: "cw", pts: [[0.12,0.10],[0.18,0.95],[0.36,0.92],[0.44,0.10]] },
    ar: { mode: "cw", pts: [[0.46,0.95],[0.60,0.70],[0.78,0.45],[0.92,0.28]] },
    tr: { mode: "cw", pts: [[0.12,0.05],[0.20,0.80],[0.32,0.75],[0.42,0.05]] },
    pr: { mode: "cw", pts: [[0.14,0.55],[0.24,0.85],[0.36,0.40],[0.44,0],[0.46,0.55],[0.66,0.20],[0.86,0.05]] },
    rvot: { mode: "pw", pts: [[0.14,0],[0.20,0.60],[0.27,0.70],[0.34,0.20],[0.40,0]] },
    hepatic: { mode: "pw", pts: [[0.10,0.55],[0.24,0.10],[0.34,-0.45],[0.48,0.05],[0.60,0.65],[0.76,0.10],[0.86,-0.35],[0.96,0.05]] },
    tdi: { mode: "tdi", pts: [[0.16,0.45],[0.24,0.55],[0.32,0.10],[0.52,-0.75],[0.64,-0.10],[0.82,-0.50],[0.92,-0.05]] },
    ductal: { mode: "cw", pts: [[0.05,0.55],[0.30,0.80],[0.55,0.65],[0.80,0.75],[0.98,0.55]] },
    shunt: { mode: "cw", pts: [[0.12,0.10],[0.20,0.90],[0.34,0.85],[0.44,0.10],[0.50,-0.30],[0.62,-0.10]] },
    respMv: { mode: "pw", pts: [[0.08,0],[0.14,0.85],[0.22,0.10],[0.34,0],[0.40,0.50],[0.48,0.05],[0.58,0],[0.64,0.80],[0.72,0.10],[0.84,0],[0.90,0.45],[0.96,0.05]] },
    fontan: { mode: "pw", pts: [[0.05,0.30],[0.30,0.45],[0.55,0.28],[0.80,0.42],[0.98,0.30]] }
  };
  /* [id, kind, viewOrWave, what to measure, common pitfall] */
  var ROWS = [
    ["bsa","body","body","Height and weight measured today, then Mosteller BSA.","Old height or estimated weight; remeasure for serial indexed values."],
    ["lv-mass","linear","plax","IVS, LVID and posterior wall at end diastole, perpendicular at the mitral tips in PLAX.","Oblique PLAX or measuring at the papillary muscles cubes a small error."],
    ["lv-ef","trace","a4c","Trace LV endocardium at end diastole and end systole in A4C and A2C for Simpson volumes.","Foreshortened apex or tracing trabeculae as compacted wall."],
    ["lv-volume-index","trace","a4c","Trace LV at end diastole and end systole, then index both volumes to BSA.","Foreshortening changes volume far more than a linear measure."],
    ["lv-linear","linear","plax","LVID at end diastole and end systole in PLAX at the mitral tips.","Off axis PLAX overstates diameter; keep the septum horizontal."],
    ["fractional-shortening","mmode","plax","M-mode through the LV at the mitral tips: end diastolic and end systolic diameters.","M-mode cursor not perpendicular, or a regional wall problem read as global function."],
    ["lv-gls","trace","a4c","Speckle trace the LV endocardium in A4C, A2C and A3C at a stable frame rate.","Foreshortening or drifting region of interest outside the myocardium."],
    ["la-size","trace","a4c","Trace the LA at end systole in A4C and A2C for volume, then index to BSA.","Including the appendage or pulmonary veins, or tracing at end diastole."],
    ["ra-size","trace","rv","Trace the RA at end systole in the RV focused view for area and volume.","A foreshortened RA or tracing in a standard A4C that cuts the RA."],
    ["rv-size","linear","rv","Basal, mid and longitudinal RV diameters at end diastole in the RV focused view.","Measuring RV in a LV focused A4C; the RV must be the largest chamber."],
    ["rv-function","mmode","rv","M-mode TAPSE at the lateral tricuspid annulus, plus FAC trace and tissue S wave.","TAPSE falls with translation; never grade RV function on TAPSE alone."],
    ["aortic-size","linear","plax","Annulus in systole, sinuses, junction and ascending aorta at end diastole, leading edge to leading edge.","Mixing inner edge and leading edge conventions between serial studies."],
    ["annulus-reversus","tdi","tdi","Tissue Doppler at septal and lateral mitral annulus: compare e prime at the two sites.","Sample volume off the annulus or comparing signals from different beats."],
    ["wmsi","wmsi","a4c","Score every segment 1 to 4 in PLAX, short axis and apical views on the segment map.","Scoring unseen segments as normal; mark them not visualised instead."],
    ["diastolic-sinus","diastolic","mvInflow","Mitral inflow E and A, septal and lateral e prime, TR velocity and LA volume.","Applying the sinus pathway in atrial fibrillation or mitral disease."],
    ["lap-ee","diastolic","mvInflow","Mitral E at the leaflet tips, then e prime septal and lateral; average E over e prime.","E and e prime from different loading states or a fused E and A."],
    ["diastolic-af","diastolic","mvInflow","In AF average E, e prime, TR and deceleration over 5 to 10 beats.","Single beat values in AF; cycle length changes every index."],
    ["diastolic-hcm","diastolic","mvInflow","E and e prime, TR velocity, LA volume and pulmonary vein Ar duration.","Reading E over e prime alone in HCM; use the full evidence set."],
    ["diastolic-mac","diastolic","mvInflow","Inflow pattern, IVRT and e prime read with the calcium burden in view.","Treating e prime as reliable when the annulus is heavily calcified."],
    ["diastolic-mr","diastolic","mvInflow","E wave, IVRT, Ar minus A duration and e prime only when EF is reduced.","A tall E from severe MR alone does not prove raised filling pressure."],
    ["diastolic-ms","diastolic","mvInflow","IVRT, A wave velocity and IVRT over T E minus e prime in mitral stenosis.","Using standard E over e prime cut offs across a stenotic mitral valve."],
    ["diastolic-ph","diastolic","mvInflow","E and A, lateral e prime and LA strain to separate pre and post capillary PH.","Substituting average E over e prime where the pathway asks for lateral."],
    ["diastolic-restrictive","diastolic","mvInflow","E and A, deceleration time, IVRT and E over e prime in restriction.","Short deceleration from a stiff chest wall or tachycardia, not restriction."],
    ["diastolic-transplant","diastolic","mvInflow","Average E over e prime, E over early strain rate and TR after transplant.","Reading the pathway as a rejection test; it estimates pressure only."],
    ["diastolic-lvad","diastolic","mvInflow","E and A, E over e prime, LA volume, RAP and PASP in LVAD follow up.","Ignoring pump speed and septal position when grading filling."],
    ["diastolic-exercise","diastolic","mvInflow","E over e prime and TR at rest and at peak exercise, same sites both times.","Comparing rest and exercise signals sampled at different annulus sites."],
    ["diastolic-tachycardia","diastolic","mvInflow","Fused inflow, IVRT and pulmonary vein filling fraction in tachycardia.","Calling a fused E and A an E over A ratio; slow the rate if you can."],
    ["lap-mr","doppler","mr","Peak MR velocity by CW through the densest part of the jet, then cuff systolic pressure.","An incomplete or eccentric MR envelope understates LV systolic pressure."],
    ["hepatic-reversal","doppler","hepatic","Hepatic vein S, D and atrial reversal by PW 1 to 2 cm into the vein.","Sampling in the IVC itself, or reading reversal during held inspiration."],
    ["as-continuity","doppler","av","LVOT diameter and LVOT VTI, then CW aortic VTI, peak and mean gradient.","LVOT diameter squared is the largest error; zoom and measure in systole."],
    ["lvot-flow","doppler","lvot","LVOT diameter in PLAX systole and PW VTI just below the aortic valve.","Sample too far into the valve picks up acceleration and overstates stroke volume."],
    ["ar-continuity","doppler","ar","CW AR envelope for end diastolic velocity, with LVOT stroke volume for regurgitant volume.","AR envelope contaminated by mitral inflow in the apical window."],
    ["ar-pisa","pisa","plax","Colour PISA radius at the aliasing velocity in PLAX or A3C, then CW AR peak and VTI.","Measuring the radius in one frame only; average over systole."],
    ["mr-pisa","pisa","a4c","Colour PISA radius in a zoomed A4C, aliasing velocity, CW MR peak and VTI.","A hemispheric assumption on an eccentric or multiple jet."],
    ["mr-continuity","doppler","mr","Mitral inflow stroke volume minus LVOT stroke volume for MR volume and fraction.","Any rhythm or valve lesion that breaks the two site comparison."],
    ["mitral-pht","doppler","mvCw","CW mitral envelope: trace the deceleration slope for pressure half time.","A non linear slope or fused A wave; 220 over PHT fails after intervention."],
    ["mitral-pisa","pisa","a4c","PISA radius with the convergence angle, then CW mitral peak for valve area.","Ignoring the angle correction when leaflets constrain the hemisphere."],
    ["mitral-continuity","doppler","mvInflow","LVOT stroke volume divided by mitral CW VTI for mitral valve area.","Significant MR or AR invalidates the LVOT stroke volume reference."],
    ["tr-pisa","pisa","rv","Colour PISA radius in the RV focused view, CW TR peak and VTI.","TR PISA is often non hemispheric and understates the orifice."],
    ["tricuspid-stenosis","doppler","mvCw","CW tricuspid inflow mean gradient, pressure half time and VTI.","Respiratory variation missed by tracing one beat only."],
    ["pulmonic-stenosis","doppler","rvot","CW through the pulmonary valve from PSAX or RVOT long axis, aligned with the jet.","Confusing RVOT dynamic signal with fixed valvar stenosis."],
    ["pulmonic-regurg","doppler","pr","CW PR envelope: end diastolic velocity and pressure half time, plus RVOT and LVOT volumes.","A short PR envelope in a stiff, hypertensive pulmonary circuit."],
    ["lv-pressure","doppler","mr","CW MR peak for LV systolic pressure, AR end diastolic velocity for LVEDP.","Estimating LAP from the same MR jet you are testing; circular logic."],
    ["aortic-prosthesis","doppler","av","LVOT and prosthesis VTI for DVI and effective orifice area, peak and mean gradient.","High gradient from high flow or pressure recovery read as obstruction."],
    ["aortic-prosthesis-screen","doppler","avLow","Screen velocity, mean gradient, DVI, acceleration time and ratio together.","Screening on gradient alone in a small or normally functioning prosthesis."],
    ["aortic-prosthesis-serial","doppler","av","Compare velocity, DVI and orifice area with the baseline study at matched flow.","Calling progression on gradient alone when flow has also risen."],
    ["mitral-prosthesis","doppler","mvCw","CW mitral prosthesis peak, mean gradient, pressure half time and VTI ratio.","Raised gradient from tachycardia or MR, not obstruction; check heart rate."],
    ["mitral-prosthesis-screen","doppler","mvCw","Screen peak velocity, mean gradient, VTI ratio, orifice area and PHT together.","A normal PHT does not exclude prosthetic regurgitation."],
    ["rap","ivc","ivc","IVC diameter 1 to 2 cm below the RA and collapse on a sniff, in the subcostal long axis.","Measuring at the hepatic vein junction or in M-mode off axis."],
    ["rvsp","doppler","tr","Peak TR velocity by CW from several windows; add the IVC based RAP.","An incomplete TR envelope needs contrast, not a guessed peak."],
    ["pa-pressure","doppler","pr","PR end diastolic and peak velocities for PA diastolic and mean pressure, plus RAP.","PR signal sought only in PSAX; try RVOT and subcostal windows too."],
    ["mpap-rvot","doppler","rvot","RVOT PW acceleration time to the peak, at a sweep of 100 mm per second.","Acceleration time shortens with tachycardia; state the heart rate."],
    ["pvr","doppler","tr","TR peak velocity and RVOT VTI for the Abbas PVR estimate.","Using the estimate above 8 Wood units, where it is unreliable."],
    ["mpi","doppler","lvot","Closure to opening time minus ejection time, over ejection time, by PW or tissue Doppler.","Mixing PW and tissue Doppler intervals in one index."],
    ["qpqs","doppler","rvot","RVOT and LVOT diameters and VTIs for pulmonary over systemic flow.","One diameter error is squared twice; zoom both outflow tracts."],
    ["asd","trace","subcostal","Subcostal bicaval and four chamber defect size, rims and shunt direction on colour.","A sinus venosus defect missed by staying in the four chamber plane."],
    ["vsd-pressure","doppler","shunt","CW VSD peak for the interventricular gradient, then cuff systolic pressure.","A restrictive jet read in a low output state understates RV pressure."],
    ["pda-pressure","doppler","ductal","Continuous ductal CW: peak systolic and end diastolic velocities and direction.","Continuous signal from an aortopulmonary window or collateral, not the duct."],
    ["coarctation","doppler","ductal","CW down the descending aorta from suprasternal: peak, corrected gradient and diastolic run off.","Peak gradient overstated by a proximal velocity above 1 metre per second."],
    ["fontan-gradient","doppler","fontan","PW in the Fontan pathway and fenestration: mean gradient at quiet respiration.","A small gradient in a Fontan pathway can still matter; read with saturations."],
    ["effusion-size","linear","plax","Largest end diastolic echo free space, in PLAX and subcostal, in millimetres.","Epicardial fat read as effusion; fat moves with the heart and sits anteriorly."],
    ["mitral-respiratory","resp","respMv","Mitral inflow peak at first beat of inspiration and expiration for percent variation.","Variation read across ectopic beats or during irregular breathing."],
    ["tricuspid-respiratory","resp","respMv","Tricuspid inflow peak at first beat of inspiration and expiration, reversed convention.","Applying the mitral direction of change to the tricuspid valve."],
    ["lvot-respiratory","resp","respMv","LVOT VTI across respiration with septal shift on the same loop.","Variation without the septal shift does not make constriction."],
    ["doppler-equation","physics","lvot","Beam to flow angle at the sample: keep it at 20 degrees or less.","Angle above 60 degrees; the cosine error explodes and no correction rescues it."],
    ["bernoulli","physics","av","Peak CW velocity at the valve, proximal velocity when it exceeds 1 metre per second.","Dropping the proximal term in subvalvar or serial stenoses."],
    ["poiseuille","physics","lvot","Vessel radius and length in the flow model; radius enters to the fourth power.","Applying a laminar tube model to a turbulent stenotic jet."],
    ["pulse-repetition","physics","lvot","Imaging depth sets the pulse repetition limit and the Nyquist velocity.","Aliasing read as flow reversal; raise the scale or shift the baseline."],
    ["pulse-geometry","physics","lvot","Crystal diameter and wavelength set pulse length and near field length.","Expecting axial resolution better than half the spatial pulse length."],
    ["acoustic","physics","lvot","Frequency, cycles per pulse and propagation speed for wavelength and period.","Raising frequency for penetration; attenuation rises with frequency."],
    ["wave-relations","physics","lvot","Wave period, wavelength and duration from frequency and cycle count.","Confusing period in microseconds with pulse duration."],
    ["pathway-diastology","pathway","a4c","Work the pathway in order: inflow, e prime, TR, LA volume, then the supplements.","Leaving the pathway when one primary measure is missing; state indeterminate."],
    ["pathway-as","pathway","a5c","Work the AS pathway: AVA, gradient, stroke volume index and flow state together.","Grading severity on peak velocity alone in low flow."],
    ["pathway-mr","pathway","a4c","Work the MR pathway: jet, PISA quantities, chamber response, then concordance.","A single discordant quantity graded alone; seek TEE or CMR."]
  ];
  var KEY = { trace: "end diastole and end systole pair", linear: "end diastole", mmode: "end diastole to end systole sweep", doppler: "peak envelope", diastolic: "E wave", tdi: "e prime wave", pisa: "mid systole", ivc: "end expiration", resp: "first inspiratory beat", wmsi: "end systole", pathway: "decision end point", physics: "sample at peak flow", body: "standing measure" };
  var FIGURES = {};
  ROWS.forEach(function (r) {
    var kind = r[1];
    FIGURES[r[0]] = { id: r[0], kind: kind, ref: r[2],
      view: WAVES[r[2]] ? null : r[2], wave: WAVES[r[2]] ? r[2] : null,
      caption: (WAVES[r[2]] ? "Spectral trace. " : (VIEWS[r[2]] ? VIEWS[r[2]].label + ". " : "")) + r[3],
      measure: r[3], pitfall: r[4], attribution: ATTR, source: null,
      keyPhase: kind === "doppler" || kind === "diastolic" || kind === "resp" ? 0.30 : kind === "pisa" ? 0.28 : kind === "ivc" ? 0.05 : 0.02,
      keyLabel: KEY[kind] || "key frame" };
  });
  var API = { views: VIEWS, waves: WAVES, figures: FIGURES, attribution: ATTR };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.KCALC_FIG_DATA = API;
})(typeof window !== "undefined" ? window : this);
