/* kardia-sim-measure.js - Kardia measurement lab with ground truth grading (WP6).
 *
 * ES5 IIFE, window.KARDIA_MEASURE, module.exports for the pure parts.
 * Does not depend on kardia-sim-us.js or kardia-sim-doppler.js (built in
 * parallel). It depends only on two small source interfaces:
 *
 * Image source (B-mode or M-mode-like strip):
 *   { draw(ctx, w, h, tMs), mmPerPx:Number,
 *     sectorGeometry:{apexX,apexY,depthMm,widthMm} (px apex, mm extents),
 *     frameAt(phase) -> {phase, cycleTimeMs, timeMs, polygons} }
 *   phase is "endDiastole" (at the QRS) or "endSystole" (at aortic valve
 *   closure). Polygons, when present, are cut() output in mm plane coords.
 *
 * Spectrum source (PW or CW Doppler):
 *   { draw(ctx, w, h), velocityAt(yPx) -> m/s at that pixel row,
 *     timeAt(xPx) -> seconds at that pixel column,
 *     velocityAtTime(tSec) -> m/s (stub only) }
 *   Note: velocityAt takes a pixel row and timeAt takes a pixel column.
 *   They are named for the quantity they return, not the axis passed in.
 *
 * British spelling throughout. No em or en dashes.
 */
(function (G) {
  "use strict";

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function distPx(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  /* ================= pure measurement maths ================= */

  function distanceMm(p1, p2, mmPerPx) { return distPx(p1, p2) * mmPerPx; }

  /* Shoelace area of a closed polyline given in pixels. */
  function polygonAreaMm2(points, mmPerPx) {
    if (!points || points.length < 3) return 0;
    var s = 0, i, a, b;
    for (i = 0; i < stepsLen(points); i++) { a = points[i]; b = points[(i + 1) % points.length]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2 * mmPerPx * mmPerPx;
  }
  function stepsLen(p) { return p.length; }
  function polygonAreaCm2(points, mmPerPx) { return polygonAreaMm2(points, mmPerPx) / 100; }

  function toMm(points, mmPerPx) {
    return points.map(function (p) { return { x: p.x * mmPerPx, y: p.y * mmPerPx }; });
  }

  /* Long axis of a traced cavity polygon (mm points): the farthest pair.
   * Returns {apex, base, lengthMm, ux, uy, vx, vy} with u along the axis
   * (apex to base) and v perpendicular. */
  function longAxis(ptsMm) {
    var i, j, best = -1, bi = 0, bj = 1;
    for (i = 0; i < ptsMm.length; i++) for (j = i + 1; j < ptsMm.length; j++) {
      var dx = ptsMm[j].x - ptsMm[i].x, dy = ptsMm[j].y - ptsMm[i].y, d = dx * dx + dy * dy;
      if (d > best) { best = d; bi = i; bj = j; }
    }
    var a = ptsMm[bi], b = ptsMm[bj];
    var ux = b.x - a.x, uy = b.y - a.y, L = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= L; uy /= L;
    return { apex: a, base: b, lengthMm: L, ux: ux, uy: uy, vx: -uy, vy: ux };
  }

  /* Diameter (mm) of a polygon at a fractional position f (0 apex, 1 base)
   * along its long axis: width of the polygon on that cross line. */
  function diameterAt(ptsMm, axis, f) {
    var target = f * axis.lengthMm, hits = [], i, p, q, sp, sq;
    for (i = 0; i < ptsMm.length; i++) {
      p = ptsMm[i]; q = ptsMm[(i + 1) % ptsMm.length];
      sp = (p.x - axis.apex.x) * axis.ux + (p.y - axis.apex.y) * axis.uy;
      sq = (q.x - axis.apex.x) * axis.ux + (q.y - axis.apex.y) * axis.uy;
      if ((sp < target && sq >= target) || (sq < target && sp >= target)) {
        var t = (target - sp) / (sq - sp), hx = p.x + (q.x - p.x) * t, hy = p.y + (q.y - p.y) * t;
        hits.push((hx - axis.apex.x) * axis.vx + (hy - axis.apex.y) * axis.vy);
      }
    }
    if (hits.length < 2) return 0;
    return Math.max.apply(null, hits) - Math.min.apply(null, hits);
  }

  /* Method of discs, 20 discs (ASE 2015 chamber quantification).
   * traceAPx and traceBPx are closed endocardial traces in pixels from two
   * orthogonal apical views at the same phase. Each disc is an ellipse
   * with diameters a (view A) and b (view B); disc height is the mean
   * long axis length divided by 20. Returns millilitres. */
  function simpsonBiplane(traceAPx, traceBPx, mmPerPx, nDiscs) {
    var n = nDiscs || 20;
    var A = toMm(traceAPx, mmPerPx), B = toMm(traceBPx, mmPerPx);
    var axA = longAxis(A), axB = longAxis(B);
    var L = (axA.lengthMm + axB.lengthMm) / 2, h = L / n;
    var volMm3 = 0, discs = [], i, da, db;
    for (i = 0; i < n; i++) {
      var f = (i + 0.5) / n;
      da = diameterAt(A, axA, f); db = diameterAt(B, axB, f);
      var dv = Math.PI / 4 * da * db * h;
      volMm3 += dv;
      discs.push({ aMm: da, bMm: db, hMm: h, volumeMl: dv / 1000 });
    }
    return { volumeMl: volMm3 / 1000, lengthMm: L, lengthAMm: axA.lengthMm, lengthBMm: axB.lengthMm, discs: discs };
  }
  function simpsonSinglePlane(tracePx, mmPerPx, nDiscs) {
    var r = simpsonBiplane(tracePx, tracePx, mmPerPx, nDiscs);
    return r;
  }
  /* Simpson biplane volumes and ejection fraction from four traces. */
  function simpsonEF(edA, edB, esA, esB, mmPerPx) {
    var ed = simpsonBiplane(edA, edB, mmPerPx), es = simpsonBiplane(esA, esB, mmPerPx);
    var ef = ed.volumeMl > 0 ? (ed.volumeMl - es.volumeMl) / ed.volumeMl * 100 : 0;
    return { EDV: ed.volumeMl, ESV: es.volumeMl, EF: ef, SV: ed.volumeMl - es.volumeMl, ed: ed, es: es };
  }

  function lvotAreaCm2(diameterMm) { var rCm = diameterMm / 20; return Math.PI * rCm * rCm; }
  function lvotDiameterMm(areaCm2) { return 20 * Math.sqrt(areaCm2 / Math.PI); }
  function strokeVolumeMl(areaCm2, vtiCm) { return areaCm2 * vtiCm; }
  function continuityAvaCm2(lvotDiamMm, lvotVtiCm, avVtiCm) {
    if (!(avVtiCm > 0)) return 0;
    return lvotAreaCm2(lvotDiamMm) * lvotVtiCm / avVtiCm;
  }

  /* Velocity time integral of a traced spectrum envelope.
   * Points are pixels; the spectrum source converts pixels to seconds
   * and metres per second. Result in centimetres. */
  function vtiCm(points, spectrumSource) {
    if (!points || points.length < 2) return 0;
    var pts = points.slice().sort(function (a, b) { return a.x - b.x; });
    var sum = 0, i;
    for (i = 1; i < pts.length; i++) {
      var t0 = spectrumSource.timeAt(pts[i - 1].x), t1 = spectrumSource.timeAt(pts[i].x);
      var v0 = Math.abs(spectrumSource.velocityAt(pts[i - 1].y)), v1 = Math.abs(spectrumSource.velocityAt(pts[i].y));
      sum += (t1 - t0) * (v0 + v1) / 2; /* metre */
    }
    return sum * 100;
  }

  function bernoulliGradientMmHg(velocityMs) { return 4 * velocityMs * velocityMs; }
  function velocityFromGradientMmHg(gradientMmHg) { return Math.sqrt(Math.max(0, gradientMmHg) / 4); }

  /* Pressure half time from two points on the early diastolic E slope.
   * Each point is {tSec, vMs}. The slope is fitted as a straight line and
   * extrapolated to the velocity at which pressure has halved, namely the
   * peak velocity divided by root two. Returns milliseconds from the
   * first (peak) point. If the second point already sits at or below the
   * half pressure velocity, its own interval is returned. */
  function pressureHalfTimeMs(p1, p2) {
    var target = p1.vMs / Math.SQRT2;
    if (p2.vMs <= target) {
      if (p2.vMs === p1.vMs) return 0;
      var f = (p1.vMs - target) / (p1.vMs - p2.vMs);
      return (p1.tSec + f * (p2.tSec - p1.tSec) - p1.tSec) * 1000;
    }
    var slope = (p2.vMs - p1.vMs) / (p2.tSec - p1.tSec); /* m/s per s, negative */
    if (!(slope < 0)) return Infinity;
    return (target - p1.vMs) / slope * 1000;
  }
  function mvaFromPressureHalfTimeCm2(phtMs) { return phtMs > 0 ? 220 / phtMs : 0; } /* Hatle */

  /* PISA: hemispheric flow convergence. Radius in cm, aliasing velocity
   * in cm per s, peak regurgitant velocity in m per s. */
  function pisa(radiusCm, aliasVelocityCmS, peakVelocityMs, regurgitantVtiCm) {
    var flowMlS = 2 * Math.PI * radiusCm * radiusCm * aliasVelocityCmS;
    var eroa = peakVelocityMs > 0 ? flowMlS / (peakVelocityMs * 100) : 0;
    return { flowMlPerSec: flowMlS, EROAcm2: eroa, regurgitantVolumeMl: regurgitantVtiCm ? eroa * regurgitantVtiCm : null };
  }

  function tapseMm(pSystole, pDiastole, mmPerPx) {
    /* TAPSE is longitudinal excursion: use the vertical (long axis) move,
     * falling back to full distance if the points share a row. */
    var dy = Math.abs(pSystole.y - pDiastole.y) * mmPerPx;
    return dy > 0 ? dy : distanceMm(pSystole, pDiastole, mmPerPx);
  }

  /* ================= cardiac phase and frames ================= */

  /* End diastole is at the QRS; end systole is at aortic valve closure. */
  function frameForPhase(events, phase) {
    var want = phase === "endSystole" ? "AVC" : "QRS";
    var found = null, i;
    for (i = 0; i < (events || []).length; i++) if (events[i].type === want) found = events[i];
    return found ? { phase: phase, event: want, cycleTimeMs: found.cycleTimeMs, timeMs: found.timeMs, cycle: found.cycle } : null;
  }
  function phaseName(cycleTimeMs, events) {
    var qrs = frameForPhase(events, "endDiastole"), avc = frameForPhase(events, "endSystole");
    if (!qrs || !avc) return "unknown";
    var dEd = Math.abs(cycleTimeMs - qrs.cycleTimeMs), dEs = Math.abs(cycleTimeMs - avc.cycleTimeMs);
    if (dEd <= 40) return "endDiastole";
    if (dEs <= 40) return "endSystole";
    return cycleTimeMs > qrs.cycleTimeMs && cycleTimeMs < avc.cycleTimeMs ? "systole" : "diastole";
  }

  /* ================= tolerances and grading ================= */

  /* Tolerance table. Sources are guideline reproducibility data, quoted
   * as published inter observer variability; see TOLERANCE_SOURCES. */
  var TOLERANCE_SOURCES = [
    "Lang RM et al. Recommendations for Cardiac Chamber Quantification by Echocardiography in Adults: An Update from the American Society of Echocardiography and the European Association of Cardiovascular Imaging. J Am Soc Echocardiogr 2015;28:1-39 (ASE 2015 chamber quantification).",
    "Nagueh SF et al. Recommendations for the Evaluation of Left Ventricular Diastolic Function by Echocardiography: An Update from ASE and EACVI. J Am Soc Echocardiogr 2016;29:277-314.",
    "Baumgartner H et al. Echocardiographic Assessment of Valve Stenosis: EAE ASE Recommendations for Clinical Practice (continuity equation, planimetry and pressure half time reproducibility).",
    "Zoghbi WA et al. Recommendations for Noninvasive Evaluation of Native Valvular Regurgitation (PISA effective orifice reproducibility). ASE 2017."
  ];
  var TOLERANCES = {
    EF: { kind: "absolute", value: 5, unit: "percentage points", label: "Ejection fraction", source: TOLERANCE_SOURCES[0] },
    EDV: { kind: "relative", value: 0.10, unit: "ml", label: "End diastolic volume", source: TOLERANCE_SOURCES[0] },
    ESV: { kind: "relative", value: 0.10, unit: "ml", label: "End systolic volume", source: TOLERANCE_SOURCES[0] },
    SV: { kind: "relative", value: 0.10, unit: "ml", label: "Stroke volume", source: TOLERANCE_SOURCES[0] },
    LVIDd: { kind: "linear", absMm: 2, rel: 0.05, unit: "mm", label: "LV internal dimension, diastole", source: TOLERANCE_SOURCES[0] },
    LVIDs: { kind: "linear", absMm: 2, rel: 0.05, unit: "mm", label: "LV internal dimension, systole", source: TOLERANCE_SOURCES[0] },
    LVOTDiameter: { kind: "linear", absMm: 2, rel: 0.05, unit: "mm", label: "LVOT diameter", source: TOLERANCE_SOURCES[0] },
    IVSd: { kind: "linear", absMm: 2, rel: 0.05, unit: "mm", label: "Septal thickness", source: TOLERANCE_SOURCES[0] },
    LVPWd: { kind: "linear", absMm: 2, rel: 0.05, unit: "mm", label: "Posterior wall thickness", source: TOLERANCE_SOURCES[0] },
    AorticRoot: { kind: "linear", absMm: 2, rel: 0.05, unit: "mm", label: "Aortic root diameter", source: TOLERANCE_SOURCES[0] },
    LADiameter: { kind: "linear", absMm: 2, rel: 0.05, unit: "mm", label: "Left atrial diameter", source: TOLERANCE_SOURCES[0] },
    TAPSE: { kind: "linear", absMm: 2, rel: 0.05, unit: "mm", label: "TAPSE", source: TOLERANCE_SOURCES[0] },
    MVA: { kind: "absoluteOrRelative", abs: 0.2, rel: 0.10, unit: "cm2", label: "Mitral valve area", source: TOLERANCE_SOURCES[2] },
    AVA: { kind: "absoluteOrRelative", abs: 0.2, rel: 0.10, unit: "cm2", label: "Aortic valve area", source: TOLERANCE_SOURCES[2] },
    LAarea: { kind: "relative", value: 0.10, unit: "cm2", label: "Left atrial area", source: TOLERANCE_SOURCES[0] },
    LAVolume: { kind: "relative", value: 0.10, unit: "ml", label: "Left atrial volume", source: TOLERANCE_SOURCES[0] },
    LVOTVTI: { kind: "relative", value: 0.10, unit: "cm", label: "LVOT velocity time integral", source: TOLERANCE_SOURCES[0] },
    AVVTI: { kind: "relative", value: 0.10, unit: "cm", label: "Aortic valve velocity time integral", source: TOLERANCE_SOURCES[2] },
    MVVTI: { kind: "relative", value: 0.10, unit: "cm", label: "Mitral velocity time integral", source: TOLERANCE_SOURCES[2] },
    VTI: { kind: "relative", value: 0.10, unit: "cm", label: "Velocity time integral", source: TOLERANCE_SOURCES[0] },
    PeakVelocity: { kind: "absoluteOrRelative", abs: 0.1, rel: 0.05, unit: "m/s", label: "Peak velocity", source: TOLERANCE_SOURCES[2] },
    PeakGradient: { kind: "relative", value: 0.10, unit: "mmHg", label: "Peak gradient", source: TOLERANCE_SOURCES[2] },
    MeanGradient: { kind: "relative", value: 0.10, unit: "mmHg", label: "Mean gradient", source: TOLERANCE_SOURCES[2] },
    PHT: { kind: "absoluteOrRelative", abs: 20, rel: 0.10, unit: "ms", label: "Pressure half time", source: TOLERANCE_SOURCES[2] },
    PISARadius: { kind: "linear", absMm: 1, rel: 0.10, unit: "mm", label: "PISA radius", source: TOLERANCE_SOURCES[3] },
    EROA: { kind: "relative", value: 0.20, unit: "cm2", label: "Effective regurgitant orifice area", source: TOLERANCE_SOURCES[3] },
    RegurgitantVolume: { kind: "relative", value: 0.20, unit: "ml", label: "Regurgitant volume", source: TOLERANCE_SOURCES[3] },
    EVelocity: { kind: "absoluteOrRelative", abs: 0.1, rel: 0.10, unit: "m/s", label: "E velocity", source: TOLERANCE_SOURCES[1] },
    AVelocity: { kind: "absoluteOrRelative", abs: 0.1, rel: 0.10, unit: "m/s", label: "A velocity", source: TOLERANCE_SOURCES[1] }
  };
  function toleranceFor(quantity, truth) {
    var t = TOLERANCES[quantity] || TOLERANCES.VTI;
    if (t.kind === "absolute") return t.value;
    if (t.kind === "relative") return Math.abs(truth) * t.value;
    if (t.kind === "linear") return Math.max(t.absMm, Math.abs(truth) * t.rel);
    return Math.max(t.abs, Math.abs(truth) * t.rel);
  }

  /* Grade one measured quantity against its true value.
   * context (all optional): {phase, expectedPhase, lengthMm, trueLengthMm,
   * view, angleDeg}. Frame and foreshortening faults are named first,
   * because no tracing skill can rescue the wrong frame. */
  function grade(quantity, measured, truth, context) {
    context = context || {};
    var tol = toleranceFor(quantity, truth);
    var err = measured - truth;
    var pass = Math.abs(err) <= tol;
    var feedback = "", code = pass ? "correct" : "outOfTolerance";
    if (context.expectedPhase && context.phase && context.phase !== context.expectedPhase) {
      pass = false; code = "wrongFrame";
      feedback = context.expectedPhase === "endDiastole"
        ? "Wrong frame: not end diastole. Freeze at the QRS, when the ventricle is largest, and trace again."
        : "Wrong frame: not end systole. Freeze at aortic valve closure, when the ventricle is smallest, and trace again.";
    } else if (!pass && context.trueLengthMm && context.lengthMm && context.lengthMm < 0.92 * context.trueLengthMm) {
      code = "foreshortened";
      feedback = "Foreshortened apex. Your traced length is shorter than the true length, so the volume is understated. Slide to the true apex and include it in the trace.";
    } else if (!pass && err < 0 && (quantity === "EDV" || quantity === "ESV" || quantity === "EF" || quantity === "LAarea" || quantity === "LAVolume" || quantity === "MVA")) {
      code = "undertrace";
      feedback = "Traced inside the trabeculations. Follow the compact endocardial border and exclude trabeculae and papillary muscles from the cavity.";
    } else if (!pass && err > 0 && (quantity === "EDV" || quantity === "ESV" || quantity === "LAarea" || quantity === "MVA")) {
      code = "overtrace";
      feedback = "Traced outside the endocardium. Keep the line on the blood and tissue boundary, not in the wall.";
    } else if (!pass && err < 0) {
      code = "low";
      feedback = "Undermeasured. Check the caliper sits on the inner edge of the border and that the frame and view are correct.";
    } else if (!pass && err > 0) {
      code = "high";
      feedback = "Overmeasured. Check the caliper sits on the inner edge of the border and that the frame and view are correct.";
    } else {
      feedback = "Within tolerance. ";
      if (quantity === "EF") feedback += "Simpson biplane ejection fraction agrees with the model.";
      else feedback += TOLERANCES[quantity] ? (TOLERANCES[quantity].label + " agrees with the model.") : "Measurement agrees with the model.";
    }
    return { quantity: quantity, measured: measured, truth: truth, error: err, errorPct: truth ? err / truth * 100 : 0, tolerance: tol, pass: pass, code: code, feedback: feedback };
  }

  /* ================= tools and task mapping ================= */

  var TOOLS = {
    caliper: { id: "caliper", label: "Linear caliper", kind: "twoPoint", quantity: "LVIDd", unit: "mm", instruction: "Place two points on the inner edges to measure the distance." },
    areaTrace: { id: "areaTrace", label: "Area trace", kind: "trace", quantity: "LAarea", unit: "cm2", instruction: "Trace the closed border. Lift to close the shape." },
    simpson: { id: "simpson", label: "Simpson biplane", kind: "simpson", quantity: "EF", unit: "%", instruction: "Trace the LV endocardium in four steps: end diastole then end systole, in the four chamber then the two chamber view." },
    lvotDiameter: { id: "lvotDiameter", label: "LVOT diameter", kind: "twoPoint", quantity: "LVOTDiameter", unit: "mm", instruction: "Measure the LVOT inner edge to inner edge, just below the aortic valve in systole." },
    vtiTrace: { id: "vtiTrace", label: "VTI trace", kind: "spectrumTrace", quantity: "LVOTVTI", unit: "cm", instruction: "Trace the outer edge of the spectral envelope from its start to its end." },
    peakVelocity: { id: "peakVelocity", label: "Peak velocity", kind: "peakPoint", quantity: "PeakVelocity", unit: "m/s", instruction: "Tap the highest point of the dense spectral envelope." },
    pressureHalfTime: { id: "pressureHalfTime", label: "Pressure half time", kind: "twoSpectrumPoints", quantity: "PHT", unit: "ms", instruction: "Tap the E wave peak, then a second point on its deceleration slope." },
    pisaRadius: { id: "pisaRadius", label: "PISA radius", kind: "twoPoint", quantity: "PISARadius", unit: "mm", instruction: "Place one point at the orifice and one at the aliasing shell edge." },
    tapse: { id: "tapse", label: "TAPSE", kind: "twoPoint", quantity: "TAPSE", unit: "mm", instruction: "Place points at the tricuspid annulus in diastole and in systole on the M mode strip." },
    continuityAva: { id: "continuityAva", label: "Aortic valve area by continuity", kind: "spectrumTrace", quantity: "AVA", unit: "cm2", instruction: "Trace the aortic valve envelope. The area follows from the LVOT diameter and LVOT VTI by the continuity equation." }
  };
  var QUANTITY_TO_TOOL = {
    EF: "simpson", LVEF: "simpson", EDV: "simpson", LVEDV: "simpson", ESV: "simpson", LVESV: "simpson", SV: "simpson",
    MVA: "areaTrace", MitralValveArea: "areaTrace", LAarea: "areaTrace", LAArea: "areaTrace",
    LAVolume: "simpson", LAvolume: "simpson",
    LVOTDiameter: "lvotDiameter", LVOTdiameter: "lvotDiameter",
    LVIDd: "caliper", LVIDs: "caliper", IVSd: "caliper", LVPWd: "caliper", AorticRoot: "caliper", LADiameter: "caliper", RVDimension: "caliper",
    LVOTVTI: "vtiTrace", AVVTI: "vtiTrace", MVVTI: "vtiTrace", VTI: "vtiTrace", AVA: "continuityAva", AorticValveArea: "continuityAva",
    PeakVelocity: "peakVelocity", PeakGradient: "peakVelocity", MeanGradient: "peakVelocity", EVelocity: "peakVelocity", AVelocity: "peakVelocity", TRVelocity: "peakVelocity",
    PHT: "pressureHalfTime", PressureHalfTime: "pressureHalfTime",
    PISARadius: "pisaRadius", EROA: "pisaRadius", RegurgitantVolume: "pisaRadius",
    TAPSE: "tapse"
  };
  function toolForQuantity(quantity) {
    var id = QUANTITY_TO_TOOL[quantity];
    return id ? TOOLS[id] : null;
  }
  /* Every quantity an echoTask may ask for, with its tool. A case file
   * uses echoTasks: [{quantity, view, ...}]; this is the coverage check. */
  function echoTaskCoverage(cases) {
    var missing = [], seen = {};
    (cases || []).forEach(function (c) {
      (c.echoTasks || []).forEach(function (t) {
        var q = t.quantity || t.measure;
        if (q && !toolForQuantity(q) && !seen[q]) { seen[q] = 1; missing.push(q); }
      });
    });
    return { ok: missing.length === 0, missing: missing };
  }

  /* ================= ground truth ================= */

  /* True values from the cycle model. heart is a KARDIA_HEART instance.
   * Extra true values (LA volume, dimensions from a cut) may be supplied
   * in opts and are passed through under their quantity names. */
  function groundTruth(heart, opts) {
    opts = opts || {};
    var s = heart.summary(), p = heart.getParams ? heart.getParams() : heart.params;
    var out = {
      EF: s.EF, EDV: s.EDV, ESV: s.ESV, SV: s.forwardSV,
      LVOTVTI: s.LVOTVTI, VTI: s.LVOTVTI,
      PeakVelocity: s.peakAorticVelocity, PeakGradient: s.peakAorticGradient,
      EVelocity: s.Evelocity, AVelocity: s.Avelocity,
      MVA: p.mitralValveAreaCm2, AVA: p.aorticValveAreaCm2,
      LVOTDiameter: lvotDiameterMm(p.lvotAreaCm2),
      LVOTArea: p.lvotAreaCm2
    };
    var st = heart.state();
    out.LAVolume = st.volumes.LA;
    out.RVEDV = s.RVEDV;
    for (var k in opts) out[k] = opts[k];
    return out;
  }
  /* True area, length and width of one cut() polygon in mm plane coords. */
  function cutTruth(poly) {
    if (!poly || !poly.points || poly.points.length < 3) return null;
    var pts = poly.points.map(function (p) { return { x: p[0], y: p[1] }; });
    var ax = longAxis(pts);
    var maxW = 0, i;
    for (i = 1; i < 10; i++) maxW = Math.max(maxW, diameterAt(pts, ax, i / 10));
    return { areaCm2: polygonAreaCm2(pts, 1), lengthMm: ax.lengthMm, maxWidthMm: maxW, points: pts };
  }
  function lvCutTruth(polys) {
    for (var i = 0; i < (polys || []).length; i++) if (polys[i].id === "lv_cavity") return cutTruth(polys[i]);
    return null;
  }

  /* ================= stub sources (for tests; not the real renderers) ================= */

  /* Stub image source: draws the geom cut() polygons directly.
   * Requires KARDIA_HEART and KARDIA_GEOM instances in opts. Works with
   * no DOM: call frameAt or cutPolygons without draw. */
  function createStubImageSource(opts) {
    opts = opts || {};
    var heart = opts.heart, geom = opts.geom;
    var view = opts.view || null; /* views.json view object or id string */
    var widthMm = opts.widthMm || 190, depthMm = opts.depthMm || 190;
    var src = {
      mmPerPx: opts.mmPerPx || 0.5,
      sectorGeometry: { apexX: 0, apexY: 8, depthMm: depthMm, widthMm: widthMm },
      polygons: [], view: view,
      setView: function (v) { view = v; src.view = v; return src; },
      cutPolygons: function () {
        if (!geom) return [];
        geom.update(heart.state());
        var plane = geom.viewPlane(view || "tte_a4c");
        src.polygons = geom.cut(plane.origin, plane.normal, plane.up, widthMm, depthMm);
        return src.polygons;
      },
      frameAt: function (phase) {
        /* Step in 5 ms increments until the named event fires. */
        var want = phase === "endSystole" ? "AVC" : "QRS";
        var before = heart.state().timeMs, i, st;
        for (i = 0; i < 400; i++) {
          heart.step(5); st = heart.state();
          var evs = st.events;
          for (var j = 0; j < evs.length; j++) if (evs[j].type === want && evs[j].timeMs > before) {
            return { phase: phase, event: want, cycleTimeMs: evs[j].cycleTimeMs, timeMs: evs[j].timeMs, cycle: evs[j].cycle, polygons: src.cutPolygons() };
          }
        }
        return { phase: phase, event: want, cycleTimeMs: st.cycleTimeMs, timeMs: st.timeMs, polygons: src.cutPolygons() };
      },
      mmToPx: function (ptMm, w, h) {
        var mpp = depthMm / Math.max(1, h);
        return { x: w / 2 + ptMm[0] / mpp, y: h * 0.08 + ptMm[1] / mpp * -1 + h * 0.55 };
      },
      pxToMm: function (pt, w, h) {
        var mpp = depthMm / Math.max(1, h);
        return [(pt.x - w / 2) * mpp, (h * 0.63 - pt.y) * mpp];
      },
      draw: function (ctx, w, h, tMs) {
        if (typeof tMs === "number" && heart) { var cur = heart.state().timeMs; if (tMs > cur) heart.step(Math.min(100, tMs - cur)); }
        var mpp = depthMm / Math.max(1, h); src.mmPerPx = mpp;
        src.sectorGeometry = { apexX: w / 2, apexY: Math.round(h * 0.08), depthMm: depthMm, widthMm: widthMm };
        var polys = src.cutPolygons();
        ctx.fillStyle = "#06090b"; ctx.fillRect(0, 0, w, h);
        polys.forEach(function (poly) {
          if (poly.points.length < 2) return;
          ctx.beginPath();
          poly.points.forEach(function (p, i) { var q = src.mmToPx(p, w, h); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
          ctx.closePath();
          if (poly.acoustic && poly.acoustic.isBlood) { ctx.fillStyle = "#10161a"; ctx.fill(); ctx.strokeStyle = "#5b6b72"; }
          else if (poly.kind === "valve") ctx.strokeStyle = "#c9d4d8";
          else ctx.strokeStyle = "#39464d";
          ctx.lineWidth = 1; ctx.stroke();
        });
        return src;
      }
    };
    return src;
  }

  /* Stub spectrum source: a synthetic triangular envelope.
   * velocityAt(yPx) and timeAt(xPx) need the drawn size; draw records it,
   * and setSize can set it without a canvas (headless tests). */
  function createStubSpectrumSource(opts) {
    opts = opts || {};
    var peak = opts.peakVelocityMs || 1.2, dur = opts.durationSec || 0.32, rise = opts.riseSec || 0.10;
    var maxV = opts.maxVelocityMs || peak * 1.25, W = 390, H = 300;
    function velAtTime(t) {
      if (t < 0 || t > dur) return 0;
      return t < rise ? peak * t / rise : peak * (1 - (t - rise) / (dur - rise));
    }
    var src = {
      peakVelocityMs: peak, durationSec: dur,
      setSize: function (w, h) { W = w; H = h; return src; },
      velocityAtTime: velAtTime,
      timeAt: function (xPx) { return xPx / W * (dur * 1.6); },
      velocityAt: function (yPx) { return (H - yPx) / H * maxV; },
      timeToPx: function (t) { return t / (dur * 1.6) * W; },
      velocityToPx: function (v) { return H - v / maxV * H; },
      trueVtiCm: function () {
        /* Exact integral of the triangle: half base times height. */
        return 0.5 * dur * peak * 100;
      },
      envelopePoints: function (n) {
        var out = [], i;
        for (i = 0; i <= (n || 24); i++) { var t = dur * i / (n || 24); out.push({ x: src.timeToPx(t), y: src.velocityToPx(velAtTime(t)) }); }
        return out;
      },
      draw: function (ctx, w, h) {
        if (w) { W = w; H = h; }
        ctx.fillStyle = "#06090b"; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = "#2c353d"; ctx.beginPath(); ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
        ctx.beginPath();
        for (var t = 0; t <= dur; t += dur / 60) { var x = src.timeToPx(t), y = src.velocityToPx(velAtTime(t)); if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.lineTo(src.timeToPx(dur), H); ctx.lineTo(0, H); ctx.closePath();
        ctx.fillStyle = "rgba(62,224,122,0.25)"; ctx.fill();
        ctx.strokeStyle = "#3ee07a"; ctx.stroke();
        return src;
      }
    };
    return src;
  }

  /* ================= touch user interface ================= */
  /* Design contract (StewardMD Kardia tokens from kardia.css):
   * Monitor dark theme by default, paper light theme via body class;
   * the canvas is the hero, chrome is quiet; every control is at least
   * 44 px with 44 px trace handle hit areas; feedback appears beside the
   * canvas, never over the trace. Grading appears once, in the card with
   * role status: bold verdict, then measured versus true value, then the
   * one line reason. Traces are a 2 px accent line with 6 px handles at
   * the start, end and dragged point only; closed traces carry a faint
   * fill. The End diastole and End systole buttons carry aria-pressed for
   * the current frame; Done stays disabled until a full measurement exists.
   * States: loading (image draws synchronously, no skeleton invented),
   * empty (instruction plus Nothing traced yet), tracing, ready (Done
   * enabled), graded (pass or fail with the reason), error (too few
   * points or missing inputs, in the card). Offline: static trainer, no
   * network calls, so the lab keeps working. Long text: the card wraps,
   * verdict on its own line. Motion: 140 ms ease-out on buttons only,
   * removed under prefers-reduced-motion; drag tracking is 1 to 1 with no
   * added animation. The loupe follows the finger while dragging and
   * shows the source enlarged two times with a crosshair. Finish gate:
   * one feedback card, 2 px traces, pressed frame buttons, gated Done,
   * 44 px targets, no overflow at 390 and 820 px. */

  var STYLE_ID = "krdm-style";
  function injectStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement("style"); st.id = STYLE_ID;
    st.textContent = [
      ".krdm{font-family:-apple-system,system-ui,sans-serif;color:var(--kd-text,#eef3f1);background:var(--kd-bg,#06090b)}",
      ".krdm-h{font-size:15px;font-weight:650;line-height:1.4;margin:0 0 4px}",
      ".krdm-sub{font-size:14px;line-height:1.5;color:var(--kd-mut,#a3adb3);margin:0 0 10px}",
      ".krdm-stage{position:relative;border:1px solid var(--kd-line,#2c353d);border-radius:12px;overflow:hidden;background:#06090b;touch-action:none}",
      ".krdm-stage canvas{display:block;width:100%}",
      ".krdm-ov{position:absolute;inset:0;touch-action:none}",
      ".krdm-bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;padding-bottom:env(safe-area-inset-bottom,0px)}",
      ".krdm-btn{min-height:44px;min-width:44px;padding:10px 16px;border-radius:10px;border:1px solid var(--kd-line,#2c353d);background:var(--kd-s1,#0e1316);color:var(--kd-text,#eef3f1);font-size:15px;font-weight:650;touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;transition:transform 140ms cubic-bezier(0.23,1,0.32,1),background-color 140ms cubic-bezier(0.23,1,0.32,1)}",
      ".krdm-btn:active{transform:scale(0.97)}",
      ".krdm-btn[disabled]{opacity:0.45}",
      ".krdm-btn.pri{background:var(--kd-acc,#3ee07a);color:var(--kd-on-acc,#04160a);border-color:transparent}",
      ".krdm-btn[aria-pressed=true]{border-color:var(--kd-acc,#3ee07a);color:var(--kd-acc,#3ee07a);background:var(--kd-acc-soft,rgba(62,224,122,.14))}",
      "@media (hover:hover) and (pointer:fine){.krdm-btn:hover{background:var(--kd-s2,#171e23)}.krdm-btn.pri:hover{background:var(--kd-acc,#3ee07a)}}",
      ".krdm-read{font-size:15px;line-height:1.5;margin-top:10px;min-height:24px}",
      ".krdm-fb{margin-top:8px;padding:12px 14px;border-radius:12px;background:var(--kd-s1,#0e1316);font-size:14px;line-height:1.55;display:none}",
      ".krdm-fb.show{display:block}.krdm-fb.ok{border:1px solid var(--kd-ok,#34c759)}.krdm-fb.bad{border:1px solid var(--kd-bad,#ff6961)}",
      ".krdm-fb strong{display:block;font-weight:700;margin-bottom:2px}",
      ".krdm-btn:focus-visible{outline:2px solid var(--kd-acc,#3ee07a);outline-offset:2px}",
      "@media (prefers-reduced-motion:reduce){.krdm-btn{transition:none}}"
    ].join("");
    doc.head.appendChild(st);
  }

  function createUI(root, opts) {
    opts = opts || {};
    var doc = root.ownerDocument || G.document;
    injectStyle(doc);
    var tool = typeof opts.tool === "string" ? TOOLS[opts.tool] : (opts.tool || TOOLS.caliper);
    var source = opts.source;
    var isSpectrum = tool.kind === "spectrumTrace" || tool.kind === "twoSpectrumPoints" || tool.kind === "peakPoint";
    var quantity = opts.quantity || tool.quantity;
    root.classList.add("krdm");
    root.innerHTML = "";
    var title = doc.createElement("p"); title.className = "krdm-h"; title.textContent = tool.label;
    var sub = doc.createElement("p"); sub.className = "krdm-sub"; sub.textContent = opts.instruction || tool.instruction;
    var stage = doc.createElement("div"); stage.className = "krdm-stage";
    var cv = doc.createElement("canvas"); cv.setAttribute("aria-label", tool.label + " image");
    var ov = doc.createElement("canvas"); ov.className = "krdm-ov"; ov.setAttribute("aria-label", tool.label + " tracing overlay");
    stage.appendChild(cv); stage.appendChild(ov);
    var bar = doc.createElement("div"); bar.className = "krdm-bar";
    var read = doc.createElement("div"); read.className = "krdm-read"; read.setAttribute("aria-live", "polite");
    var fb = doc.createElement("div"); fb.className = "krdm-fb"; fb.setAttribute("role", "status");
    function btn(label, cls) { var b = doc.createElement("button"); b.type = "button"; b.className = "krdm-btn" + (cls ? " " + cls : ""); b.textContent = label; bar.appendChild(b); return b; }
    var edBtn = null, esBtn = null;
    if (!isSpectrum && source && source.frameAt) {
      edBtn = btn("End diastole"); esBtn = btn("End systole");
      edBtn.setAttribute("aria-pressed", "false"); esBtn.setAttribute("aria-pressed", "false");
      edBtn.addEventListener("click", function () { snap("endDiastole"); });
      esBtn.addEventListener("click", function () { snap("endSystole"); });
    }
    var undoBtn = btn("Undo"), clearBtn = btn("Clear"), doneBtn = btn("Done", "pri");
    root.appendChild(title); root.appendChild(sub); root.appendChild(stage); root.appendChild(bar); root.appendChild(read); root.appendChild(fb);

    var W = root.clientWidth || opts.width || 390, H = opts.height || Math.round(W * 0.78);
    var steps = simpsonSteps(tool);
    var stepIdx = 0, traces = [], points = [], dragging = false, dragPt = null, frame = null, phase = null;
    var dragHandle = -1, grabbedHandle = false;
    var HANDLE_PX = 22; /* 44 px touch hit area around a handle */
    function simpsonSteps(t) {
      if (t.id !== "simpson") return [{ label: t.label, phase: null }];
      return [
        { label: "End diastole, four chamber", phase: "endDiastole", view: opts.viewA4C || "tte_a4c" },
        { label: "End systole, four chamber", phase: "endSystole", view: opts.viewA4C || "tte_a4c" },
        { label: "End diastole, two chamber", phase: "endDiastole", view: opts.viewA2C || "tte_a2c" },
        { label: "End systole, two chamber", phase: "endSystole", view: opts.viewA2C || "tte_a2c" }
      ];
    }
    function resize(w) {
      W = w || root.clientWidth || W; H = opts.height || Math.round(W * 0.78);
      var dpr = (G.devicePixelRatio || 1);
      [cv, ov].forEach(function (c) { c.width = W * dpr; c.height = H * dpr; c.style.height = H + "px"; var x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); });
      if (source && source.setSize) source.setSize(W, H);
      redraw();
    }
    function snap(ph) {
      if (!source || !source.frameAt) return;
      if (source.setView && steps[stepIdx] && steps[stepIdx].view) source.setView(steps[stepIdx].view);
      frame = source.frameAt(ph); phase = ph; redraw();
      if (edBtn) edBtn.setAttribute("aria-pressed", ph === "endDiastole" ? "true" : "false");
      if (esBtn) esBtn.setAttribute("aria-pressed", ph === "endSystole" ? "true" : "false");
    }
    function isClosedKind() { return tool.kind === "trace" || tool.id === "simpson"; }
    function drawHandle(o, p) {
      o.beginPath(); o.arc(p.x, p.y, 3, 0, 6.2832);
      o.fillStyle = "#3ee07a"; o.fill();
      o.lineWidth = 1; o.strokeStyle = "#04160a"; o.stroke();
    }
    function drawTrace(o, tr, active) {
      if (!tr.length) return;
      var closed = isClosedKind();
      o.beginPath(); tr.forEach(function (p, i) { if (i === 0) o.moveTo(p.x, p.y); else o.lineTo(p.x, p.y); });
      if (closed) o.closePath();
      if (closed && tr.length >= 3) {
        o.save();
        o.fillStyle = "rgba(62,224,122,0.14)";
        o.fill();
        o.restore();
      }
      o.beginPath(); tr.forEach(function (p, i) { if (i === 0) o.moveTo(p.x, p.y); else o.lineTo(p.x, p.y); });
      if (closed) o.closePath();
      o.strokeStyle = "#3ee07a"; o.lineWidth = 2; o.lineJoin = "round"; o.lineCap = "round";
      o.stroke();
      var ends = [];
      if (tr.length === 1) ends.push(0);
      else { ends.push(0); ends.push(tr.length - 1); }
      if (active && dragging && dragHandle >= 0 && dragHandle < tr.length && ends.indexOf(dragHandle) < 0) ends.push(dragHandle);
      ends.forEach(function (i) { drawHandle(o, tr[i]); });
    }
    function updateDone() {
      if (tool.id === "simpson" && stepIdx < steps.length - 1) { doneBtn.disabled = points.length < 3; return; }
      var r = compute();
      doneBtn.disabled = !!r.error;
    }
    function redraw() {
      var ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      if (source && source.draw) { try { source.draw(ctx, W, H); } catch (e) { ctx.fillStyle = "#06090b"; ctx.fillRect(0, 0, W, H); } }
      var o = ov.getContext("2d");
      o.clearRect(0, 0, W, H);
      traces.forEach(function (tr) { drawTrace(o, tr, false); });
      if (points.length) drawTrace(o, points, true);
      if (dragging && dragPt) drawLoupe(o);
      var stepLabel = steps.length > 1 ? " Step " + (stepIdx + 1) + " of " + steps.length + ": " + steps[stepIdx].label + "." : "";
      read.textContent = stepLabel + (points.length ? " " + points.length + " points." : " Nothing traced yet.");
      updateDone();
    }
    function drawLoupe(o) {
      var r = 52, lx = clamp(dragPt.x, r + 2, W - r - 2), ly = Math.max(r + 2, dragPt.y - r - 46);
      o.save();
      o.beginPath(); o.arc(lx, ly, r, 0, 6.2832); o.clip();
      o.fillStyle = "#06090b"; o.fillRect(lx - r, ly - r, r * 2, r * 2);
      try { o.drawImage(cv, dragPt.x - r / 2, dragPt.y - r / 2, r, r, lx - r, ly - r, r * 2, r * 2); } catch (e) {}
      o.restore();
      o.strokeStyle = "#eef3f1"; o.lineWidth = 1.5;
      o.beginPath(); o.arc(lx, ly, r, 0, 6.2832); o.stroke();
      o.beginPath(); o.moveTo(lx - 10, ly); o.lineTo(lx + 10, ly); o.moveTo(lx, ly - 10); o.lineTo(lx, ly + 10); o.stroke();
    }
    function evtPt(e) { var r = ov.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function nearHandle(p) {
      var best = -1, bd = HANDLE_PX + 1, i, d;
      var cands = [];
      if (points.length === 1) cands.push(0);
      else if (points.length > 1) { cands.push(0); cands.push(points.length - 1); }
      for (i = 0; i < cands.length; i++) {
        d = distPx(points[cands[i]], p);
        if (d <= HANDLE_PX && d < bd) { bd = d; best = cands[i]; }
      }
      return best;
    }
    ov.addEventListener("pointerdown", function (e) {
      e.preventDefault(); try { ov.setPointerCapture(e.pointerId); } catch (err) {}
      var p = evtPt(e); dragging = true; dragPt = p; grabbedHandle = false;
      var h = nearHandle(p);
      if (h >= 0) { dragHandle = h; grabbedHandle = true; points[h] = p; redraw(); return; }
      if (tool.kind === "twoPoint" || tool.kind === "twoSpectrumPoints" || tool.id === "pisaRadius" || tool.id === "tapse") {
        if (points.length >= 2) points = [];
        points.push(p); dragHandle = points.length - 1;
      } else if (tool.kind === "peakPoint") { points = [p]; dragHandle = 0; }
      else { points.push(p); dragHandle = points.length - 1; }
      redraw();
    });
    ov.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var p = evtPt(e); dragPt = p;
      if (grabbedHandle && dragHandle >= 0 && dragHandle < points.length) { points[dragHandle] = p; redraw(); return; }
      if (tool.kind === "trace" || tool.kind === "spectrumTrace" || tool.id === "simpson") {
        dragHandle = points.length - 1;
        if (!points.length || distPx(points[points.length - 1], p) > 4) { points.push(p); dragHandle = points.length - 1; }
      } else if (points.length) { points[points.length - 1] = p; dragHandle = points.length - 1; }
      redraw();
    });
    function endDrag() { dragging = false; dragPt = null; dragHandle = -1; grabbedHandle = false; redraw(); }
    ov.addEventListener("pointerup", endDrag);
    ov.addEventListener("pointercancel", endDrag);
    undoBtn.addEventListener("click", function () {
      if (points.length) points.pop();
      else if (traces.length) { traces.pop(); stepIdx = Math.max(0, stepIdx - 1); }
      dragHandle = -1; grabbedHandle = false;
      fb.className = "krdm-fb"; fb.innerHTML = ""; redraw();
    });
    clearBtn.addEventListener("click", function () { points = []; traces = []; stepIdx = 0; dragHandle = -1; grabbedHandle = false; fb.className = "krdm-fb"; fb.innerHTML = ""; redraw(); });

    function compute() {
      var mmPerPx = (source && source.mmPerPx) || opts.mmPerPx || 0.5;
      if (tool.id === "simpson") {
        var all = traces.concat(points.length ? [points] : []);
        if (all.length < 4) return { error: "Trace all four steps before pressing Done." };
        var r = simpsonEF(all[0], all[2], all[1], all[3], mmPerPx);
        return { value: r.EF, unit: "%", all: r, extra: "EDV " + r.EDV.toFixed(1) + " ml, ESV " + r.ESV.toFixed(1) + " ml" };
      }
      if (points.length < 1) return { error: "Place at least one point first." };
      if (tool.kind === "twoPoint" || tool.id === "lvotDiameter") {
        if (points.length < 2) return { error: "Place two points first." };
        var d = distanceMm(points[0], points[1], mmPerPx);
        var out = { value: d, unit: "mm" };
        if (tool.id === "lvotDiameter") out.extra = "LVOT area " + lvotAreaCm2(d).toFixed(2) + " cm2";
        if (tool.id === "pisaRadius") {
          out.value = d; /* graded in mm against PISARadius */
          if (opts.aliasVelocityCmS && opts.peakVelocityMs) { var pz = pisa(d / 10, opts.aliasVelocityCmS, opts.peakVelocityMs, opts.regurgitantVtiCm); out.extra = "EROA " + pz.EROAcm2.toFixed(2) + " cm2"; out.pisa = pz; }
        }
        if (tool.id === "tapse") out.value = tapseMm(points[0], points[1], mmPerPx);
        return out;
      }
      if (tool.kind === "trace") return { value: polygonAreaCm2(points, mmPerPx), unit: "cm2" };
      if (tool.kind === "spectrumTrace") {
        if (points.length < 2) return { error: "Trace the envelope first." };
        var tracedVti = vtiCm(points, source);
        if (tool.id === "continuityAva") {
          if (!(opts.lvotDiameterMm > 0) || !(opts.lvotVtiCm > 0)) return { error: "This area needs the LVOT diameter and LVOT VTI first." };
          return { value: continuityAvaCm2(opts.lvotDiameterMm, opts.lvotVtiCm, tracedVti), unit: "cm2", extra: "Aortic valve VTI " + tracedVti.toFixed(1) + " cm" };
        }
        return { value: tracedVti, unit: "cm" };
      }
      if (tool.kind === "peakPoint") {
        var v = Math.abs(source.velocityAt(points[0].y));
        return { value: v, unit: "m/s", extra: "Gradient " + bernoulliGradientMmHg(v).toFixed(1) + " mmHg" };
      }
      if (tool.kind === "twoSpectrumPoints") {
        if (points.length < 2) return { error: "Tap the peak, then a point on the slope." };
        var p1 = { tSec: source.timeAt(points[0].x), vMs: Math.abs(source.velocityAt(points[0].y)) };
        var p2 = { tSec: source.timeAt(points[1].x), vMs: Math.abs(source.velocityAt(points[1].y)) };
        var pht = pressureHalfTimeMs(p1, p2);
        return { value: pht, unit: "ms", extra: "Mitral valve area by pressure half time " + mvaFromPressureHalfTimeCm2(pht).toFixed(2) + " cm2" };
      }
      return { error: "Unknown tool." };
    }
    function reasonLine(g) {
      if (!g) return "";
      if (g.pass) {
        var i = g.feedback.indexOf(". ");
        return i >= 0 ? g.feedback.slice(i + 2) : g.feedback;
      }
      return g.feedback;
    }
    function renderGrade(r, g) {
      fb.innerHTML = "";
      var verdict = doc.createElement("strong");
      verdict.textContent = g.pass ? "Within tolerance" : "Outside tolerance";
      fb.appendChild(verdict);
      var vals = doc.createElement("span");
      vals.textContent = tool.label + ": " + r.value.toFixed(2) + " " + r.unit +
        (r.extra ? ". " + r.extra + "." : "") +
        " True value " + g.truth.toFixed(2) + " " + r.unit +
        " (tolerance " + g.tolerance.toFixed(2) + ").";
      fb.appendChild(vals);
      var why = doc.createElement("span");
      why.textContent = " " + reasonLine(g);
      fb.appendChild(why);
    }
    doneBtn.addEventListener("click", function () {
      if ((tool.kind === "trace" || tool.id === "simpson") && stepIdx < steps.length - 1 && points.length >= 3) {
        traces.push(points.slice()); points = []; dragHandle = -1; grabbedHandle = false; stepIdx++;
        if (steps[stepIdx].phase) snap(steps[stepIdx].phase);
        redraw(); return;
      }
      if (tool.id === "simpson" && points.length >= 3 && traces.length === 3) { traces.push(points.slice()); points = []; dragHandle = -1; grabbedHandle = false; }
      var r = compute();
      if (r.error) { fb.className = "krdm-fb show bad"; fb.textContent = r.error; return; }
      var g = null;
      if (typeof opts.truth === "number") g = grade(quantity, r.value, opts.truth, { phase: phase || opts.phase, expectedPhase: opts.expectedPhase, lengthMm: r.all ? r.all.ed.lengthMm : opts.lengthMm, trueLengthMm: opts.trueLengthMm });
      if (!g) { fb.className = "krdm-fb show"; fb.textContent = tool.label + ": " + r.value.toFixed(2) + " " + r.unit + (r.extra ? ". " + r.extra + "." : ""); }
      else { fb.className = "krdm-fb show " + (g.pass ? "ok" : "bad"); renderGrade(r, g); }
      /* Grading does not redraw, so the step line would still say the last step is empty. */
      read.textContent = traces.length > 1 ? " All " + traces.length + " traces measured." : " Measured.";
      if (typeof opts.onGrade === "function") opts.onGrade({ result: r, grade: g, points: points, traces: traces });
    });

    var api = {
      resize: resize, redraw: redraw, compute: compute, snap: snap,
      setPoints: function (pts) { points = pts.slice(); dragHandle = -1; grabbedHandle = false; redraw(); return api; },
      getPoints: function () { return points.slice(); },
      setTraces: function (tr) { traces = tr.map(function (t) { return t.slice(); }); points = []; dragHandle = -1; grabbedHandle = false; stepIdx = steps.length - 1; redraw(); return api; },
      getState: function () { return { tool: tool.id, quantity: quantity, step: stepIdx, points: points, traces: traces, phase: phase, width: W, height: H }; },
      elements: { canvas: cv, overlay: ov, done: doneBtn, undo: undoBtn, clear: clearBtn, feedback: fb, readout: read },
      destroy: function () { root.innerHTML = ""; }
    };
    resize(opts.width || W);
    if (steps[0] && steps[0].phase) snap(steps[0].phase);
    return api;
  }

  var API = {
    TOOLS: TOOLS, QUANTITY_TO_TOOL: QUANTITY_TO_TOOL, TOLERANCES: TOLERANCES, TOLERANCE_SOURCES: TOLERANCE_SOURCES,
    grade: grade, toleranceFor: toleranceFor, groundTruth: groundTruth, cutTruth: cutTruth, lvCutTruth: lvCutTruth,
    toolForQuantity: toolForQuantity, echoTaskCoverage: echoTaskCoverage,
    createStubImageSource: createStubImageSource, createStubSpectrumSource: createStubSpectrumSource,
    createUI: createUI,
    _pure: {
      distanceMm: distanceMm, polygonAreaCm2: polygonAreaCm2, polygonAreaMm2: polygonAreaMm2,
      longAxis: longAxis, diameterAt: diameterAt, simpsonBiplane: simpsonBiplane, simpsonSinglePlane: simpsonSinglePlane, simpsonEF: simpsonEF,
      lvotAreaCm2: lvotAreaCm2, lvotDiameterMm: lvotDiameterMm, strokeVolumeMl: strokeVolumeMl, continuityAvaCm2: continuityAvaCm2,
      vtiCm: vtiCm, bernoulliGradientMmHg: bernoulliGradientMmHg, velocityFromGradientMmHg: velocityFromGradientMmHg,
      pressureHalfTimeMs: pressureHalfTimeMs, mvaFromPressureHalfTimeCm2: mvaFromPressureHalfTimeCm2,
      pisa: pisa, tapseMm: tapseMm, frameForPhase: frameForPhase, phaseName: phaseName
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_MEASURE = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

