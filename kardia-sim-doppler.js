/* kardia-sim-doppler.js - Kardia Doppler (WP5): spectral PW/CW and colour
 * flow data from the WP1 cycle model (kardia-sim-heart.js).
 *
 * ES5 IIFE, window.KARDIA_DOPPLER, module.exports under node. No DOM except
 * the optional canvas renderer (drawSpectrum). Not wired into screens.
 *
 * Physics and thresholds are cited to ASE/EACVI guidance, restated:
 * - Simplified Bernoulli: peak gradient (mmHg) = 4 * v^2, v in m/s; mean
 *   gradient = time average of 4*v(t)^2 over ejection/filling. Extended
 *   form subtracts 4*vProximal^2 when proximal velocity exceeds 1.5 m/s.
 *   (Baumgartner et al., ASE/EACVI 2017 aortic stenosis recommendations;
 *   dop_bernoulli lesson.)
 * - Severe AS: peak jet velocity >= 4 m/s and mean gradient >= 40 mmHg,
 *   AVA < 1.0 cm2. (ASE/EACVI 2017 stenosis grading; dop_cw lesson.)
 * - PW Nyquist limit = PRF/2 in Doppler shift; unambiguous range sets the
 *   maximum PRF = c / (2 * depth), c = 1540 m/s, so the beam Nyquist
 *   velocity is c^2 / (8 * f0 * depth). Flow above it wraps (aliasing);
 *   baseline shift moves the wrap window, lower depth raises the limit.
 *   CW has no Nyquist limit and no range gating. (ASE 2019 complete TTE
 *   guideline, spectral Doppler optimisation; dop_pw / dop_cw lessons.)
 * - Angle: measured velocity = v * cos(theta). Without correction a 60
 *   degree angle reads half the true velocity; keep theta under 20 deg.
 *   (ASE 2019, Doppler alignment; dop_pw lesson.)
 * - Continuity: AVA = LVOT area * LVOT VTI / AV VTI; LVOT area from the
 *   LVOT diameter (default 2.2 cm, the parametric LVOT tube radius of
 *   11 mm in kardia-sim-geom.js). (ASE/EACVI 2017; dop_continuity_ava.)
 * - Mitral stenosis: pressure half-time PHT (ms), MVA = 220 / PHT (cm2),
 *   severe MS MVA < 1.0 cm2 so PHT > 220 ms; PHT = 0.29 * deceleration
 *   time. (Hatle method; ASE 2009 stenosis guidance; dop lessons.)
 * - PISA: EROA = 2 * pi * r^2 * Va / Vpeak, r = aliasing radius (cm),
 *   Va = aliasing velocity, Vpeak = peak jet velocity (same units).
 *   Severe primary MR is EROA >= 0.40 cm2. (Zoghbi et al., ASE 2017
 *   native valvular regurgitation; dop_pisa_eroa lesson.)
 * - PASP = 4 * vTR^2 + RA pressure; RA pressure 3 / 8 / 15 mmHg from IVC
 *   size and collapse. (ASE right heart guidance; meas_pasp lesson.)
 * - Display: toward the probe above the spectral baseline, away below
 *   (apical: mitral inflow up, LVOT/aortic/MR down); CW autoscales so the
 *   peak is ~80% of half-scale and never clips; default PW Nyquist is
 *   ~1.25x the expected peak (explicit PRF/depth still use the physics).
 * - Colour: red toward the probe, blue away; the colour Nyquist (scale,
 *   typically 0.5 to 0.6 m/s for valve jets) sets aliasing, and high
 *   variance (turbulence) paints a mosaic. (ASE 2019 colour Doppler;
 *   dop_colour lesson.)
 * - Normal LVOT VTI is about 18 to 25 cm and normal mitral E is about
 *   0.6 to 1.0 m/s with E/A 1.0 to 2.0. (ASE/EACVI chamber and diastolic
 *   guidance, Nagueh et al. 2016; kardia-sim-heart.test.mjs citations.)
 *
 * Flow areas: forward velocities use the annulus or outflow area the cycle
 * model itself uses (mitralAnnulusAreaCm2 for mitral inflow E/A, the valve
 * areas for RV inflow and pulmonary flow). Jet velocities use the
 * effective orifice (valve area for stenotic jets, regurgitant orifice
 * EROA for regurgitant jets), i.e. the vena contracta, so 4*v^2 returns
 * the pressure drop the model generates (its orifice law is
 * Q = 50 * A * sqrt(dP) ml/s, hence v = Q/A gives dP = 4*v^2 exactly).
 * LVOT velocity uses the geometric LVOT area above, not the cycle model's
 * lvotAreaCm2 bookkeeping area (3.14 cm2); stroke volume is unchanged, so
 * continuity AVA is exact either way and LVOT VTI lands in the ASE band.
 *
 * Patient frame (kardia-sim-geom.js): x left, y anterior, z cranial, mm,
 * origin at the LV cavity centroid. Flow origins and directions below are
 * the parametric anchor points the geometry builder uses (mitral annulus
 * on APEX_DIR, aortic valve centre, tricuspid centre, pulmonary centre).
 */
(function (G) {
  "use strict";

  var C_SOUND = 1540; /* m/s, soft tissue sound speed (ASE Doppler physics) */

  /* ---- vec helpers (same shapes as kardia-sim-geom.js) ---- */
  function v3(x, y, z) { return [x, y, z]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(dot(a, a)) || 1; }
  function norm(a) { var l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  var APEX_DIR = norm(v3(0.12, -0.12, -0.986)); /* LV base to apex (geom) */

  /* Anchor points (mm) mirroring kardia-sim-geom.js build(): LV centroid
   * at the origin, long semi-axis 42 mm at the 120 ml reference volume,
   * annulus at -0.92 * axis on APEX_DIR, AV centre annulus + [3,-2,13],
   * LA centre base + [-2,-8,10], RA centre [-34,2,30], RV centre
   * [-26,14,10], TV centre RV + [4,-2,26], PV centre [-12,10,49]. */
  var ANCHOR = {
    mitral: mul(APEX_DIR, -38.6),
    lvot: mul(APEX_DIR, -24),
    aortic: add(mul(APEX_DIR, -38.6), v3(3, -2, 13)),
    tricuspid: v3(-22, 12, 36),
    rvot: v3(-14, 16, 38),
    pulmonary: v3(-12, 10, 49),
    la: add(mul(APEX_DIR, -42), v3(-2, -8, 10)),
    ra: v3(-34, 2, 30),
    lv: v3(0, 0, 0),
    rv: v3(-26, 14, 10),
    septumV: v3(-13, 7, 0),
    septumA: v3(-25, -8, 36),
    ductus: v3(-16, -10, 52)
  };

  /* ---- pure physics helpers (also exposed on the API) ---- */
  function bernoulli(vMs, proximalMs) {
    var g = 4 * vMs * vMs;
    if (proximalMs) g -= 4 * proximalMs * proximalMs;
    return g;
  }
  function velocityFromGradient(dPMmHg) { return 0.5 * Math.sqrt(Math.max(0, dPMmHg)); }
  function lvotAreaCm2(diameterCm) { var r = diameterCm / 2; return Math.PI * r * r; }
  function continuityAVA(lvotArea, lvotVtiCm, avVtiCm) {
    return avVtiCm > 0 ? lvotArea * lvotVtiCm / avVtiCm : 0;
  }
  function pisaEROA(radiusCm, aliasingMs, peakMs) {
    return peakMs > 0 ? 2 * Math.PI * radiusCm * radiusCm * aliasingMs / peakMs : 0;
  }
  function pisaRadiusCm(eroaCm2, aliasingMs, peakMs) {
    return aliasingMs > 0 ? Math.sqrt(Math.max(0, eroaCm2 * peakMs / (2 * Math.PI * aliasingMs))) : 0;
  }
  function pisaFlowMlPerSec(radiusCm, aliasingMs) {
    return 2 * Math.PI * radiusCm * radiusCm * (aliasingMs * 100);
  }
  function mvaFromPHT(phtMs) { return phtMs > 0 ? 220 / phtMs : 0; }
  function phtFromMVA(mvaCm2) { return mvaCm2 > 0 ? 220 / mvaCm2 : 0; }
  function estimatePASP(trVelocityMs, raPressureMmHg) {
    return bernoulli(trVelocityMs) + (raPressureMmHg || 0);
  }
  /* Maximum unambiguous PRF (Hz) for a gate depth, and the beam Nyquist
   * velocity (m/s) it supports at transducer frequency f0Hz. */
  function maxPrfHz(depthMm) { return C_SOUND / (2 * (depthMm / 1000)); }
  function nyquistFromDepth(depthMm, freqMHz) {
    var f0 = (freqMHz || 2) * 1e6, d = depthMm / 1000;
    return (C_SOUND * C_SOUND) / (8 * f0 * d);
  }
  function nyquistFromPrf(prfHz, freqMHz) {
    var f0 = (freqMHz || 2) * 1e6;
    return C_SOUND * prfHz / (4 * f0);
  }
  function wrapVelocity(v, nyquist, baselineShift) {
    if (!(nyquist > 0)) return v;
    var b = baselineShift || 0, w = 2 * nyquist;
    var x = (v - b + nyquist) % w; if (x < 0) x += w;
    return x - nyquist + b;
  }
  function angleDegBetween(a, b) {
    var c = clamp(dot(norm(a), norm(b)), -1, 1);
    return Math.acos(c) * 180 / Math.PI;
  }

  function defaults() {
    return {
      lvotDiameterCm: 2.2,          /* geom LVOT tube diameter (22 mm) */
      transducerMHz: 2.0,
      depthMm: 160,                 /* PW gate depth (drives Nyquist) */
      prfHz: 0,                     /* 0 = derive max PRF from depth */
      nyquistMs: 0,                 /* 0 = derive from PRF and frequency */
      colourNyquistMs: 0.6,         /* colour scale (ASE 0.5 to 0.6 m/s) */
      raPressureMmHg: 8,            /* IVC based RAP step (3 / 8 / 15) */
      defect: null                  /* {type:"VSD"|"ASD"|"PDA", sizeMm} */
    };
  }
  function merge(dst, src) {
    if (!src) return dst;
    for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k]; }
    return dst;
  }

  function create(heart, options) {
    if (!heart || typeof heart.state !== "function" || typeof heart.step !== "function")
      throw new Error("KARDIA_DOPPLER.create: a KARDIA_HEART instance is required");
    var opts = merge(defaults(), options || {});
    var events = []; /* heart events seen since create (ECG/valve timing) */
    ["P", "QRS", "T", "MVC", "AVO", "AVC", "MVO", "TVC", "PVC"].forEach(function (t) {
      if (typeof heart.on === "function") heart.on(t, function (e) {
        events.push({ type: t, timeMs: e.timeMs, cycleTimeMs: e.cycleTimeMs, cycle: e.cycle });
        if (events.length > 512) events.shift();
      });
    });

    function params() { return heart.getParams ? heart.getParams() : heart.params; }

    /* Velocity (m/s, signed along the flow direction) and volume flow
     * (ml/s) of every stream for one heart state. Forward streams read
     * zero while their regurgitant counterpart is flowing and vice versa,
     * because the cycle model carries one signed flow per valve. */
    function flowsAt(state) {
      var p = params(), f = state.flows, pr = state.pressures;
      var lvotA = lvotAreaCm2(opts.lvotDiameterCm);
      var fwd = function (flow, area) { return flow > 0 ? flow / area / 100 : 0; };
      var reg = function (flow, area) { return (flow < 0 && area > 0) ? -flow / area / 100 : 0; };
      var out = [];
      function push(id, name, kind, valve, origin, direction, velocity, flow, area, turbulent) {
        out.push({ id: id, name: name, kind: kind, valve: valve, origin: origin.slice(),
          direction: norm(direction), velocityMs: velocity, flowMlPerSec: flow,
          areaCm2: area, turbulent: !!turbulent, active: Math.abs(velocity) > 0.01 });
      }
      var asTurbulent = p.aorticValveAreaCm2 < 2.0, msTurbulent = p.mitralValveAreaCm2 < 2.5;
      push("mitralInflow", "Mitral inflow", "forward", "mitral", ANCHOR.mitral, APEX_DIR,
        fwd(f.mitral, p.mitralAnnulusAreaCm2), Math.max(0, f.mitral), p.mitralAnnulusAreaCm2, msTurbulent);
      push("lvot", "LV outflow tract", "forward", "aortic", ANCHOR.lvot, norm(v3(-0.05, 0.05, 1)),
        fwd(f.aortic, lvotA), Math.max(0, f.aortic), lvotA, false);
      push("aorticJet", "Aortic valve jet", "forward", "aortic", ANCHOR.aortic, v3(0, 0, 1),
        fwd(f.aortic, p.aorticValveAreaCm2), Math.max(0, f.aortic), p.aorticValveAreaCm2, asTurbulent);
      push("tricuspidInflow", "Tricuspid inflow", "forward", "tricuspid", ANCHOR.tricuspid,
        norm(v3(-0.15, 0.08, -0.99)), fwd(f.tricuspid, p.tricuspidValveAreaCm2),
        Math.max(0, f.tricuspid), p.tricuspidValveAreaCm2, false);
      push("rvot", "RV outflow tract", "forward", "pulmonary", ANCHOR.rvot,
        norm(sub(ANCHOR.pulmonary, ANCHOR.rv)), fwd(f.pulmonary, lvotA), Math.max(0, f.pulmonary), lvotA, false);
      push("pulmonaryJet", "Pulmonary valve jet", "forward", "pulmonary", ANCHOR.pulmonary,
        norm(v3(-0.1, -0.2, 1)), fwd(f.pulmonary, p.pulmonaryValveAreaCm2),
        Math.max(0, f.pulmonary), p.pulmonaryValveAreaCm2, false);
      if (p.mitralRegurgAreaCm2 > 0)
        push("mrJet", "Mitral regurgitant jet", "regurgitant", "mitral", ANCHOR.mitral, sub(ANCHOR.la, ANCHOR.mitral),
          reg(f.mitral, p.mitralRegurgAreaCm2), Math.min(0, f.mitral), p.mitralRegurgAreaCm2, true);
      if (p.aorticRegurgAreaCm2 > 0)
        push("arJet", "Aortic regurgitant jet", "regurgitant", "aortic", ANCHOR.aortic, APEX_DIR,
          reg(f.aortic, p.aorticRegurgAreaCm2), Math.min(0, f.aortic), p.aorticRegurgAreaCm2, true);
      if (p.tricuspidRegurgAreaCm2 > 0)
        push("trJet", "Tricuspid regurgitant jet", "regurgitant", "tricuspid", ANCHOR.tricuspid,
          norm(sub(ANCHOR.ra, ANCHOR.rv)), reg(f.tricuspid, p.tricuspidRegurgAreaCm2),
          Math.min(0, f.tricuspid), p.tricuspidRegurgAreaCm2, true);
      if (p.pulmonaryRegurgAreaCm2 > 0)
        push("prJet", "Pulmonary regurgitant jet", "regurgitant", "pulmonary", ANCHOR.pulmonary,
          norm(sub(ANCHOR.rv, ANCHOR.pulmonary)), reg(f.pulmonary, p.pulmonaryRegurgAreaCm2),
          Math.min(0, f.pulmonary), p.pulmonaryRegurgAreaCm2, true);
      var defect = opts.defect;
      if (defect && defect.type === "VSD") {
        var dP = pr.LV - pr.RV, area = Math.PI * Math.pow((defect.sizeMm || 8) / 20, 2);
        push("vsdJet", "Ventricular septal defect jet", "shunt", "septum", ANCHOR.septumV,
          norm(sub(ANCHOR.rv, ANCHOR.lv)), dP > 0 ? velocityFromGradient(dP) : 0,
          dP > 0 ? velocityFromGradient(dP) * 100 * area : 0, area, true);
      }
      if (defect && defect.type === "ASD") {
        var dPa = pr.LA - pr.RA, areaA = Math.PI * Math.pow((defect.sizeMm || 15) / 20, 2);
        push("asdFlow", "Atrial septal defect flow", "shunt", "septum", ANCHOR.septumA,
          norm(sub(ANCHOR.ra, ANCHOR.la)), velocityFromGradient(Math.abs(dPa)) * (dPa < 0 ? -1 : 1),
          velocityFromGradient(Math.abs(dPa)) * 100 * areaA, areaA, false);
      }
      if (defect && defect.type === "PDA") {
        var dPd = pr.Ao - pr.PA, areaD = Math.PI * Math.pow((defect.sizeMm || 3) / 20, 2);
        push("pdaJet", "Patent ductus arteriosus jet", "shunt", "ductus", ANCHOR.ductus,
          norm(sub(ANCHOR.pulmonary, ANCHOR.ductus)), dPd > 0 ? velocityFromGradient(dPd) : 0,
          dPd > 0 ? velocityFromGradient(dPd) * 100 * areaD : 0, areaD, true);
      }
      return out;
    }
    function flowById(state, id) {
      var list = flowsAt(state), i;
      for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }

    /* Record every stream over time by stepping the heart. Returns
     * {timesMs, cycleTimesMs, dtMs, flows:{id:[v...]}, pressures, events,
     *  samples:[state snapshots at dt]}; velocities in m/s. */
    function record(durationMs, dtMs) {
      var dt = dtMs || 2, dur = durationMs || Math.round(60000 / (params().heartRateBpm || 70));
      var t0 = heart.state().timeMs, ev0 = events.length;
      var times = [], cycles = [], perFlow = {}, pressures = [], i;
      for (i = 0; i < Math.ceil(dur / dt); i++) {
        heart.step(dt);
        var st = heart.state(), list = flowsAt(st);
        times.push(st.timeMs - t0); cycles.push(st.cycleTimeMs);
        pressures.push({ LA: st.pressures.LA, LV: st.pressures.LV, RA: st.pressures.RA,
          RV: st.pressures.RV, Ao: st.pressures.Ao, PA: st.pressures.PA });
        list.forEach(function (fl) { (perFlow[fl.id] = perFlow[fl.id] || []).push(fl.velocityMs); });
      }
      /* atMs: event time on the recording axis (timesMs[0] is one dt
       * after t0, so an event at the first step sits near 0). */
      var evs = events.slice(ev0).map(function (e) {
        return { type: e.type, timeMs: e.timeMs, atMs: e.timeMs - t0, cycleTimeMs: e.cycleTimeMs, cycle: e.cycle };
      });
      return { timesMs: times, cycleTimesMs: cycles, dtMs: dt, flows: perFlow,
        pressures: pressures, events: evs, startTimeMs: t0,
        flowIds: Object.keys(perFlow) };
    }

    /* ECG waveform (normalised, ~-0.3..1) on the heart clock: P before
     * QRS at prMs, QRS complex, then T inside qtMs. AF has no P. Same
     * timing interfaces as kardiox-ecgwave.js / the WP1 events, so the
     * strip drawn under a spectrum is synchronised with it. */
    function ecgSample(cycleTimeMs) {
      var p = params(), pr = p.prMs || 160, ct = cycleTimeMs || 0;
      function g(c, w, a) { var d = (ct - c) / w; return a * Math.exp(-d * d); }
      var v = 0;
      if (!p.af) v += g(pr * 0.5, 34, 0.16);
      v += g(pr - 8, 7, -0.14) + g(pr + 6, 10, 1.0) + g(pr + 24, 9, -0.28);
      v += g(pr + Math.max(150, (p.qtMs || 380) - 120), 46, 0.30);
      return clamp(v, -0.4, 1.1);
    }
    function hash2(a, b) {
      var x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
      return x - Math.floor(x);
    }

    function resolveNyquist(o) {
      if (o.nyquistMs > 0) return { nyquistMs: o.nyquistMs, prfHz: o.prfHz || 0, depthMm: o.depthMm || opts.depthMm, derived: "override" };
      var depth = o.depthMm != null ? o.depthMm : opts.depthMm;
      var prf = o.prfHz > 0 ? o.prfHz : (o.depthMm != null || o.prfHz === 0 ? maxPrfHz(depth) : opts.prfHz || maxPrfHz(depth));
      if (opts.prfHz > 0 && o.depthMm == null && !o.prfHz) prf = opts.prfHz;
      return { nyquistMs: nyquistFromPrf(prf, o.transducerMHz || opts.transducerMHz),
        prfHz: prf, depthMm: depth, derived: "prf" };
    }

    /* Spectral trace for one stream. opts:
     *   flow (id, default "aorticJet"), mode "PW"|"CW" (default "CW" for
     *   jets, "PW" otherwise), sampleVolume {position, beamDirection},
     *   beamDirection [x,y,z], angleDeg (beam to flow), angleCorrection
     *   (bool), assumedAngleDeg (default the true angle), depthMm, prfHz,
     *   nyquistMs, baselineShiftMs, baselineShift (fraction of Nyquist),
     *   scaleMs (display only), durationMs, dtMs.
     * The true velocity is the flow velocity along its direction; the beam
     * velocity multiplies by cos(theta); angle correction divides by
     * cos(assumed). PW wraps the beam-corrected trace into the Nyquist
     * window moved by the baseline shift; CW never wraps. */
    function spectrum(o) {
      o = o || {};
      var mode = o.mode || "CW";
      var rec = record(o.durationMs, o.dtMs);
      var id = o.flow || "aorticJet";
      if (o.sampleVolume && o.sampleVolume.position) {
        var st0 = heart.state(), list = flowsAt(st0), best = null, bd = null;
        list.forEach(function (fl) {
          var d = len(sub(fl.origin, o.sampleVolume.position));
          if (!best || d < bd) { best = fl; bd = d; }
        });
        if (best) id = best.id;
      }
      var trace = rec.flows[id] || [];
      var refState = heart.state(), refFlow = flowById(refState, id);
      var direction = refFlow ? refFlow.direction : v3(0, 0, 1);
      var turbulent = refFlow ? refFlow.turbulent : false;
      var beam = o.beamDirection || (o.sampleVolume && o.sampleVolume.beamDirection) || null;
      var thetaDeg = beam ? angleDegBetween(beam, direction)
        : (o.angleDeg != null ? o.angleDeg : 0);
      var cosT = Math.cos(thetaDeg * Math.PI / 180);
      var assumed = o.assumedAngleDeg != null ? o.assumedAngleDeg : thetaDeg;
      var cosA = Math.cos(assumed * Math.PI / 180);
      /* Display direction: toward the probe is above the baseline,
       * away below (ASE convention). Default probe is apical, so mitral
       * inflow is toward (+) and LVOT/aortic/MR flow is away (-). */
      var probePos = o.probePosition || v3(6, -6, -55);
      var origin0 = refFlow ? refFlow.origin : v3(0, 0, 0);
      var displaySign = o.displaySign != null ? (o.displaySign < 0 ? -1 : 1)
        : (dot(direction, norm(sub(probePos, origin0))) >= 0 ? 1 : -1);
      /* First pass: true / beam-corrected (unsigned-by-window) traces. */
      var trueEnv = [], beamEnv = [], rawDisp = [], i;
      var peakBeamAbs = 0;
      for (i = 0; i < trace.length; i++) {
        var vB = trace[i] * cosT;
        var vC = o.angleCorrection ? vB / (Math.abs(cosA) < 1e-6 ? 1e-6 : cosA) : vB;
        trueEnv.push(trace[i]); beamEnv.push(vC);
        rawDisp.push(Math.abs(vC) * displaySign);
        if (Math.abs(vC) > peakBeamAbs) peakBeamAbs = Math.abs(vC);
      }
      /* Nyquist: explicit nyquist/prf/depth (or instance overrides) use
       * the PRF physics; the default PW setup instead puts Nyquist
       * ~25% above the expected peak so the peak never aliases/clips. */
      var explicitNyq = o.nyquistMs > 0 || o.prfHz > 0 || o.depthMm != null ||
        o.baselineShiftMs != null || opts.nyquistMs > 0 || opts.prfHz > 0;
      var nyq, autoNyquist = false;
      if (mode === "PW" && !explicitNyq) {
        autoNyquist = true;
        var nAuto = Math.max(0.30, 1.25 * peakBeamAbs);
        var f0Hz = (o.transducerMHz || opts.transducerMHz || 2) * 1e6;
        nyq = { nyquistMs: nAuto, prfHz: nAuto * 4 * f0Hz / C_SOUND,
          depthMm: o.depthMm != null ? o.depthMm : opts.depthMm, derived: "auto-peak" };
      } else nyq = resolveNyquist(o);
      var shift = o.baselineShiftMs != null ? o.baselineShiftMs
        : (o.baselineShift || 0) * nyq.nyquistMs;
      var envelope = rawDisp.slice();
      /* Display-only envelope shaping (beam/true traces and therefore
       * every measurement are untouched). CW aortic stenosis: rounded,
       * dense profile peaking later as severity rises. Normal PW mitral
       * inflow: ~85 ms acceleration, ~190 ms deceleration tangent,
       * diastasis, then the A wave. */
      if (id === "aorticJet" && mode === "CW") {
        var avo = [], avc = [], ei;
        (rec.events || []).forEach(function (ev) {
          if (ev.type === "AVO") avo.push(ev.atMs); if (ev.type === "AVC") avc.push(ev.atMs);
        });
        for (ei = 0; ei < avo.length; ei++) {
          var c1 = avc.filter(function (x) { return x > avo[ei]; })[0];
          if (c1 == null) continue;
          var segPeak = 0, si;
          for (si = 0; si < rec.timesMs.length; si++)
            if (rec.timesMs[si] >= avo[ei] && rec.timesMs[si] <= c1 && Math.abs(rawDisp[si]) > segPeak) segPeak = Math.abs(rawDisp[si]);
          if (!(segPeak > 0)) continue;
          var up = clamp(0.38 + 0.075 * segPeak, 0.45, 0.68);
          var cShape = 5, pE = up * cShape, qE = (1 - up) * cShape;
          for (si = 0; si < rec.timesMs.length; si++) {
            var tt = rec.timesMs[si];
            if (tt < avo[ei] || tt > c1) continue;
            var u = (tt - avo[ei]) / Math.max(1, c1 - avo[ei]);
            var sShape = Math.pow(Math.max(0, u / up), pE) * Math.pow(Math.max(0, (1 - u) / (1 - up)), qE);
            envelope[si] = displaySign * segPeak * sShape;
          }
        }
      }
      if (id === "mitralInflow" && mode === "PW" && !turbulent) {
        var mvos = [], ps = [], mi;
        (rec.events || []).forEach(function (ev) {
          if (ev.type === "MVO") mvos.push(ev.atMs); if (ev.type === "P") ps.push(ev.atMs);
        });
        function segMax(t0, t1) { var m2 = 0, k; for (k = 0; k < rec.timesMs.length; k++) if (rec.timesMs[k] >= t0 && rec.timesMs[k] <= t1 && Math.abs(rawDisp[k]) > m2) m2 = Math.abs(rawDisp[k]); return m2; }
        function smooth(u2) { u2 = clamp(u2, 0, 1); return u2 * u2 * (3 - 2 * u2); }
        for (mi = 0; mi < rec.timesMs.length; mi++) {
          var tm = rec.timesMs[mi], val = null, mvi, pi;
          for (mvi = 0; mvi < mvos.length; mvi++) {
            var dtE = tm - mvos[mvi]; if (dtE < 0 || dtE > 420) continue;
            var ePk = segMax(mvos[mvi], mvos[mvi] + 340); if (!(ePk > 0)) continue;
            var ev2;
            if (dtE <= 85) ev2 = ePk * smooth(dtE / 85);
            else if (dtE <= 85 + 143) ev2 = ePk * (1 - 0.75 * (dtE - 85) / 143);
            else if (dtE <= 85 + 190) ev2 = ePk * 0.25 * (1 - smooth((dtE - 85 - 143) / 47));
            else ev2 = 0;
            val = val == null ? ev2 : Math.max(val, ev2);
          }
          if (!params().af) for (pi = 0; pi < ps.length; pi++) {
            var dtA = tm - ps[pi]; if (dtA < 35 || dtA > 190) continue;
            var aPk = segMax(ps[pi], ps[pi] + 190); if (!(aPk > 0)) continue;
            var av2 = dtA <= 85 ? aPk * smooth((dtA - 35) / 50) : aPk * (1 - smooth((dtA - 85) / 95));
            val = val == null ? av2 : Math.max(val, av2);
          }
          if (val != null) envelope[mi] = displaySign * val;
        }
      }
      var peakDispAbs = 0;
      envelope.forEach(function (v) { if (Math.abs(v) > peakDispAbs) peakDispAbs = Math.abs(v); });
      var nBins = o.velocityBins || 64;
      /* CW autoscale: peak at ~80% of the half-scale, never clipped. */
      var scale = o.scaleMs || (mode === "PW" ? Math.max(nyq.nyquistMs * 2, 1)
        : Math.max(1, 2 * peakDispAbs / 0.8));
      var lo = -scale / 2 + shift, hi = scale / 2 + shift;
      var axis = [], bi;
      for (bi = 0; bi < nBins; bi++) axis.push(lo + (hi - lo) * bi / (nBins - 1));
      var axisStep = nBins > 1 ? (hi - lo) / (nBins - 1) : 1;
      var intensity = [], aliased = [], j;
      for (i = 0; i < envelope.length; i++) {
        var vDisp = envelope[i], isAliased = false;
        if (mode === "PW") {
          isAliased = Math.abs(vDisp - shift) > nyq.nyquistMs + 1e-12;
          vDisp = Math.abs(vDisp) < 0.02 ? 0 : wrapVelocity(vDisp, nyq.nyquistMs, shift);
          envelope[i] = vDisp;
        }
        aliased.push(isAliased);
        var row = [];
        for (j = 0; j < nBins; j++) {
          var amp = 0, av = axis[j];
          if (Math.abs(trueEnv[i]) >= 0.02 && Math.abs(vDisp) > 0.02) {
            if (turbulent && mode === "CW") {
              /* Dense fill from baseline to a bright modal edge. */
              var inside = (vDisp > 0 && av >= 0 && av <= vDisp) || (vDisp < 0 && av <= 0 && av >= vDisp);
              var edgeD = (av - vDisp) / Math.max(axisStep, 0.05 * Math.abs(vDisp));
              var edge = Math.exp(-edgeD * edgeD);
              if (inside) amp = 0.34 + 0.30 * Math.abs(av / vDisp) + 0.42 * edge + 0.10 * hash2(i, j);
              else amp = 0.95 * edge;
            } else {
              var sigma = turbulent ? 0.08 + 0.10 * Math.abs(vDisp)
                : Math.max(1.15 * axisStep, 0.025 + 0.035 * Math.abs(vDisp));
              var dv = av - vDisp;
              amp = Math.exp(-(dv * dv) / (2 * sigma * sigma));
              if (turbulent) amp *= 0.75 + 0.25 * hash2(i, j);
            }
          }
          row.push(Math.round(clamp(amp, 0, 1) * 255));
        }
        intensity.push(row);
      }
      var ecg = rec.cycleTimesMs.map(function (ct) { return ecgSample(ct); });
      return { mode: mode, flow: id, flowName: refFlow ? refFlow.name : id,
        turbulent: turbulent, timesMs: rec.timesMs, cycleTimesMs: rec.cycleTimesMs,
        dtMs: rec.dtMs, events: rec.events, pressures: rec.pressures, ecg: ecg,
        trueVelocityMs: trueEnv, beamVelocityMs: beamEnv, envelopeMs: envelope,
        displayVelocityMs: envelope, displaySign: displaySign, probePosition: probePos,
        aliased: aliased, anyAliased: aliased.indexOf(true) >= 0,
        velocityAxisMs: axis, intensity: intensity,
        nyquistMs: mode === "PW" ? nyq.nyquistMs : Infinity, autoNyquist: autoNyquist,
        prfHz: nyq.prfHz, depthMm: nyq.depthMm, baselineShiftMs: shift,
        scaleMs: scale, angleDeg: thetaDeg, assumedAngleDeg: assumed,
        angleCorrection: !!o.angleCorrection, cosTheta: cosT,
        direction: direction, origin: refFlow ? refFlow.origin : null };
    }

    /* Measurements from a spectrum (uses the angle-corrected beam trace,
     * so a wrapped PW peak is never reported as the true velocity). */
    function measure(spec) {
      var v = spec.beamVelocityMs, t = spec.timesMs, dt = spec.dtMs / 1000, i;
      var peak = 0, peakIdx = 0;
      for (i = 0; i < v.length; i++) if (Math.abs(v[i]) > Math.abs(peak)) { peak = v[i]; peakIdx = i; }
      /* One beat only: expand the contiguous active segment around the
       * peak (small gaps bridged), so VTI and mean gradient describe a
       * single ejection or filling period, not the whole recording. */
      var thr = Math.max(0.05, 0.1 * Math.abs(peak));
      var a0 = peakIdx, a1 = peakIdx, gap = 0;
      for (i = peakIdx - 1; i >= 0; i--) { if (Math.abs(v[i]) > thr) { a0 = i; gap = 0; } else if (++gap > 12) break; }
      gap = 0;
      for (i = peakIdx + 1; i < v.length; i++) { if (Math.abs(v[i]) > thr) { a1 = i; gap = 0; } else if (++gap > 12) break; }
      var active = v.map(function (x, xi) { return xi >= a0 && xi <= a1 && Math.abs(x) > thr; });
      var sumG = 0, nA = 0, vtiCm = 0;
      for (i = 0; i < v.length; i++) if (active[i]) { sumG += bernoulli(v[i]); nA++; vtiCm += v[i] * dt * 100; }
      var out = { flow: spec.flow, peakVelocityMs: peak, peakGradientMmHg: bernoulli(peak),
        meanGradientMmHg: nA ? sumG / nA : 0, vtiCm: vtiCm,
        durationMs: active.filter(Boolean).length * spec.dtMs };
      if (spec.flow === "mitralInflow" || spec.flow === "tricuspidInflow") {
        var ea = eAndA(spec);
        out.eVelocityMs = ea.e; out.aVelocityMs = ea.a;
        out.eaRatio = ea.a > 0 ? ea.e / ea.a : 0;
        out.decelerationTimeMs = ea.decelerationTimeMs;
        out.pressureHalfTimeMs = ea.pressureHalfTimeMs;
        out.mitralValveAreaCm2 = ea.pressureHalfTimeMs > 0 ? mvaFromPHT(ea.pressureHalfTimeMs) : 0;
      }
      if (spec.flow === "trJet") out.paspMmHg = estimatePASP(Math.abs(peak), opts.raPressureMmHg);
      out.raPressureMmHg = opts.raPressureMmHg;
      return out;
    }

    /* E and A peaks plus deceleration: E is the early diastolic peak
     * (cycle time in the filling half), A the atrial peak near cycle
     * start; AF has no A. Deceleration time extrapolates the least
     * squares slope after the E peak to zero (Hatle); PHT = 0.29 * DT. */
    function eAndA(spec) {
      var v = spec.beamVelocityMs, ct = spec.cycleTimesMs, n = v.length, i;
      var e = 0, eIdx = -1, a = 0;
      var af = params().af;
      for (i = 0; i < n; i++) {
        if (ct[i] > 300 && v[i] > e) { e = v[i]; eIdx = i; }
        if (!af && ct[i] < 220 && v[i] > a) a = v[i];
      }
      var dtMs = 0, phtMs = 0;
      if (eIdx >= 0 && e > 0) {
        var xs = [], ys = [];
        for (i = eIdx; i < n && ys.length < 400; i++) {
          if (i > eIdx && v[i] > v[i - 1] + 0.02 && ys.length > 5) break;
          xs.push(spec.timesMs[i] - spec.timesMs[eIdx]); ys.push(v[i]);
          if (v[i] < 0.15 * e && ys.length > 5) break;
        }
        if (xs.length > 3) {
          var mx = 0, my = 0, sxy = 0, sxx = 0, k;
          xs.forEach(function (x, j2) { mx += x; my += ys[j2]; }); mx /= xs.length; my /= xs.length;
          xs.forEach(function (x, j2) { sxy += (x - mx) * (ys[j2] - my); sxx += (x - mx) * (x - mx); });
          var slope = sxx > 0 ? sxy / sxx : 0; /* m/s per ms */
          if (slope < 0) dtMs = e / -slope;
          phtMs = 0.29 * dtMs;
        }
      }
      return { e: e, a: af ? 0 : a, decelerationTimeMs: dtMs, pressureHalfTimeMs: phtMs };
    }

    /* PISA from the live model: the aliasing shell radius follows from
     * hemispheric convergence, 2*pi*r^2*Va = EROA * Vpeak, so inverting
     * the measured radius returns the preset EROA (ASE 2017 PISA). */
    function pisa(o) {
      o = o || {};
      var jetId = o.flow || "mrJet";
      var st = heart.state(), jet = flowById(st, jetId);
      if (!jet && o.flow) jet = flowById(st, o.flow);
      var spec = spectrum({ flow: jetId, mode: "CW", durationMs: o.durationMs, dtMs: o.dtMs });
      var peak = Math.abs(measure(spec).peakVelocityMs);
      var eroaPreset = jet ? jet.areaCm2 : 0;
      var va = o.aliasingVelocityMs || 0.4; /* 40 cm/s shell (ASE setup) */
      var radius = pisaRadiusCm(eroaPreset, va, peak);
      return { flow: jetId, eroaCm2: pisaEROA(radius, va, peak), presetEroaCm2: eroaPreset,
        radiusCm: radius, aliasingVelocityMs: va, peakVelocityMs: peak,
        flowRateMlPerSec: pisaFlowMlPerSec(radius, va),
        regurgitantVolumeMl: pisaEROA(radius, va, peak) * measure(spec).vtiCm };
    }

    function colourFor(meanTowardMs, varianceMs2, nyquistMs) {
      var aliased = Math.abs(meanTowardMs) > nyquistMs;
      var disp = wrapVelocity(meanTowardMs, nyquistMs, 0);
      var frac = nyquistMs > 0 ? clamp(Math.abs(disp) / nyquistMs, 0, 1) : 0;
      /* Variance map: turbulence adds green in proportion to variance,
       * so an aliased turbulent core is a green/yellow mosaic that
       * varies with local velocity/variance, never one flat colour. */
      var varFrac = nyquistMs > 0 ? clamp(Math.sqrt(Math.max(0, varianceMs2)) / nyquistMs, 0, 1) : 0;
      var mosaic = aliased && varianceMs2 > Math.pow(0.3 * nyquistMs, 2);
      var r, g, b;
      if (disp >= 0) { r = 60 + 195 * frac; g = 28 * (1 - frac); b = 28 * (1 - frac); }
      else { r = 28 * (1 - frac); g = 52 * (1 - frac); b = 60 + 195 * frac; }
      g += 190 * varFrac * varFrac;
      if (mosaic) { r = 150 + 90 * frac; g = 150 + 90 * varFrac; b = 25 + 35 * (1 - frac); }
      return { r: Math.round(clamp(r, 0, 255)), g: Math.round(clamp(g, 0, 255)), b: Math.round(clamp(b, 0, 255)),
        displayVelocityMs: disp, aliased: aliased, mosaic: mosaic, varianceFrac: varFrac };
    }

    /* Colour flow data for the B-mode renderer (WP3 overlay, later):
     * for each point of a grid in the imaging plane (same origin/normal/
     * up convention as KARDIA_GEOM.cut), the mean velocity toward the
     * probe, its wrapped display value at the colour Nyquist, the
     * variance and the owning stream. Jets are cones from their origin
     * along their direction (vena contracta radius, entrainment spread,
     * centreline decay); the strongest stream at a point wins. */
    function colourField(o) {
      o = o || {};
      var st = o.state || heart.state();
      var list = flowsAt(st).filter(function (fl) { return Math.abs(fl.velocityMs) > 0.03; });
      var origin = o.planeOrigin || v3(0, 0, 10);
      var nrm = norm(o.planeNormal || v3(0, 1, 0));
      var up0 = norm(o.planeUp || v3(0, 0, 1));
      var right = norm([nrm[1] * up0[2] - nrm[2] * up0[1], nrm[2] * up0[0] - nrm[0] * up0[2], nrm[0] * up0[1] - nrm[1] * up0[0]]);
      var up = [right[1] * nrm[2] - right[2] * nrm[1], right[2] * nrm[0] - right[0] * nrm[2], right[0] * nrm[1] - right[1] * nrm[0]];
      var probe = o.probePosition || v3(6, -6, -55); /* apical probe */
      var nyq = o.nyquistMs || opts.colourNyquistMs;
      var nx = o.nx || 24, ny = o.ny || 24, w = o.widthMm || 160, d = o.depthMm || 160;
      var points = [], xi, yi, fi;
      for (yi = 0; yi < ny; yi++) for (xi = 0; xi < nx; xi++) {
        var xMm = -w / 2 + w * xi / (nx - 1), yMm = -d / 2 + d * yi / (ny - 1);
        var p = add(origin, add(mul(right, xMm), mul(up, yMm)));
        var best = null;
        for (fi = 0; fi < list.length; fi++) {
          var fl = list[fi], rel = sub(p, fl.origin);
          /* Jets are imaged in the scan plane: use the in-plane
           * projection of the flow axis and of the point offset. */
          var dirP0 = sub(fl.direction, mul(nrm, dot(fl.direction, nrm)));
          if (len(dirP0) < 0.2) continue;
          var dirP = norm(dirP0);
          var relP = sub(rel, mul(nrm, dot(rel, nrm)));
          var s = dot(relP, dirP);
          var vcMm = Math.sqrt(fl.areaCm2 / Math.PI) * 10;
          var radialVec = sub(relP, mul(dirP, s));
          var radial = len(radialVec);
          /* PISA: on the upstream (ventricular) side of a regurgitant
           * orifice, flow converges hemispherically toward it; speed is
           * Va at the aliasing shell r (2*pi*r^2*Va = EROA*Vpeak) and
           * rises as (rPisa/r)^2 inside it, so colour wraps at the ring. */
          if (fl.kind === "regurgitant" && s < 0) {
            var rP = pisaRadiusCm(fl.areaCm2, nyq, Math.abs(fl.velocityMs)) * 10;
            var rr = len(relP);
            if (!(rP > 0) || rr > rP || rr < 0.5) continue;
            var pSpeed = Math.min(Math.abs(fl.velocityMs), nyq * Math.pow(rP / rr, 2));
            if (!best || pSpeed > Math.abs(best.speed))
              best = { fl: fl, speed: pSpeed, weight: clamp(pSpeed / Math.max(0.05, Math.abs(fl.velocityMs)), 0, 1),
                velVec: mul(norm(relP), -pSpeed), axialMm: s, radialMm: radial, radiusMm: rP, pisa: true };
            continue;
          }
          if (s < 0) continue;
          var jetLen = fl.kind === "forward" ? 70 : 90;
          if (s > jetLen) continue;
          var spread = fl.turbulent ? 0.20 : 0.10;
          /* Narrow vena contracta, short potential core, then widening. */
          var radius = Math.max(2.5, vcMm + spread * Math.max(0, s - 8));
          if (radial > radius) continue;
          var decay = s <= 8 ? 1 : 1 / (1 + (s - 8) / 38);
          var weight = (1 - Math.pow(radial / radius, 2)) * decay;
          var speed = fl.velocityMs * weight;
          if (!best || Math.abs(speed) > Math.abs(best.speed))
            best = { fl: fl, speed: speed, weight: weight, velVec: mul(dirP, speed),
              axialMm: s, radialMm: radial, radiusMm: radius, pisa: false };
        }
        var mean = 0, variance = 0, flowId = null;
        if (best) {
          var toProbe = norm(sub(probe, p));
          mean = dot(best.velVec, toProbe);
          var sigma = best.fl.turbulent && !best.pisa ? 0.10 + 0.22 * Math.abs(best.speed) : 0.03 + 0.05 * Math.abs(best.speed);
          variance = sigma * sigma * best.weight;
          flowId = best.fl.id;
        }
        var col = colourFor(mean, variance, nyq);
        points.push({ xMm: xMm, yMm: yMm, position: p, meanVelocityMs: mean,
          displayVelocityMs: col.displayVelocityMs, varianceMs2: variance,
          varianceMs: Math.sqrt(variance), aliased: col.aliased, mosaic: col.mosaic,
          axialMm: best ? best.axialMm : null, radialMm: best ? best.radialMm : null,
          jetRadiusMm: best ? best.radiusMm : null, pisa: best ? !!best.pisa : false,
          colour: col, flow: flowId });
      }
      return { points: points, nx: nx, ny: ny, widthMm: w, depthMm: d,
        nyquistMs: nyq, probePosition: probe, planeOrigin: origin,
        planeNormal: nrm, planeUp: up, cycleTimeMs: st.cycleTimeMs, timeMs: st.timeMs };
    }

    /* Grey spectral renderer: scrolling spectrum, baseline, scale and
     * ECG event ticks (QRS marks systole) timed from the same clock. */
    function drawSpectrum(canvas, spec, o) {
      if (!canvas || typeof canvas.getContext !== "function") return false;
      var ctx = canvas.getContext("2d"); if (!ctx) return false;
      o = o || {};
      var W = canvas.width || 640, H = canvas.height || 320;
      var ecgH = o.ecgHeight || 28, plotH = H - ecgH - 8;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      var n = spec.intensity.length, bins = spec.velocityAxisMs.length, i, j;
      if (!n || !bins) return true;
      var cw = W / n, ch = plotH / bins;
      for (i = 0; i < n; i++) for (j = 0; j < bins; j++) {
        var g = spec.intensity[i][j]; if (g < 8) continue;
        ctx.fillStyle = "rgb(" + g + "," + g + "," + g + ")";
        ctx.fillRect(i * cw, plotH - (j + 1) * ch, Math.max(1, cw), Math.max(1, ch));
      }
      var lo = spec.velocityAxisMs[0], hi = spec.velocityAxisMs[bins - 1];
      var y0 = plotH - (0 - lo) / (hi - lo) * plotH;
      ctx.strokeStyle = "#3a6"; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
      ctx.fillStyle = "#9cf"; ctx.font = "11px sans-serif";
      ctx.fillText(spec.mode + " " + spec.flow + " Nyq " +
        (isFinite(spec.nyquistMs) ? spec.nyquistMs.toFixed(2) + " m/s" : "none") +
        " scale " + spec.scaleMs.toFixed(1) + " m/s toward up / away down", 6, 14);
      /* Bright envelope edge over the spectral fill. */
      if (spec.envelopeMs && spec.envelopeMs.length === n) {
        ctx.strokeStyle = "#e8e8e8"; ctx.beginPath();
        for (i = 0; i < n; i++) {
          var ey = plotH - (spec.envelopeMs[i] - lo) / (hi - lo) * plotH;
          if (i === 0) ctx.moveTo(0, ey); else ctx.lineTo(i * cw, ey);
        }
        ctx.stroke();
      }
      /* Real ECG trace (not event ticks) in the strip below, sampled on
       * the spectrum clock so QRS/T align with the flow above it. */
      var ecg = spec.ecg;
      if (!ecg || ecg.length !== n) {
        ecg = (spec.cycleTimesMs || []).map(function (ct) { return ecgSample(ct); });
      }
      ctx.strokeStyle = "#555"; ctx.beginPath(); ctx.moveTo(0, plotH + 2); ctx.lineTo(W, plotH + 2); ctx.stroke();
      ctx.strokeStyle = "#5f5"; ctx.beginPath();
      var eBase = plotH + 4 + ecgH * 0.68;
      for (i = 0; i < ecg.length; i++) {
        var ex = n > 1 ? i / (n - 1) * W : 0, ey2 = eBase - ecg[i] * ecgH * 0.52;
        if (i === 0) ctx.moveTo(ex, ey2); else ctx.lineTo(ex, ey2);
      }
      ctx.stroke();
      ctx.fillStyle = "#5f5"; ctx.fillText("ECG", 6, H - 6);
      return true;
    }

    /* Per-pixel colour renderer: bilinear interpolation of the colour
     * field onto every canvas pixel inside the colour box only, with
     * fine deterministic speckle (variance texture), so no flat blocks.
     * The greyscale image area is black here (WP3 supplies B-mode). */
    function drawColour(canvas, field, o) {
      if (!canvas || typeof canvas.getContext !== "function" || !field || !field.points) return false;
      var ctx = canvas.getContext("2d"); if (!ctx) return false;
      o = o || {};
      var W = canvas.width || 640, H = canvas.height || 320;
      var labelH = o.labelHeight != null ? o.labelHeight : 24;
      var box = o.box || o.colourBox || { x: Math.round(W * 0.16), y: 8,
        width: Math.round(W * 0.68), height: H - labelH - 16 };
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#101010"; ctx.fillRect(box.x, box.y, box.width, box.height);
      var nx = field.nx, ny = field.ny, pts = field.points;
      if (!nx || !ny || pts.length < nx * ny) return true;
      function at(gx, gy, ch) {
        var x0 = clamp(Math.floor(gx), 0, nx - 2), y0 = clamp(Math.floor(gy), 0, ny - 2);
        var fx = clamp(gx - x0, 0, 1), fy = clamp(gy - y0, 0, 1), s = 0, c;
        var idx = [y0 * nx + x0, y0 * nx + x0 + 1, (y0 + 1) * nx + x0, (y0 + 1) * nx + x0 + 1];
        var wt = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], k;
        for (k = 0; k < 4; k++) {
          var p0 = pts[idx[k]]; if (!p0) continue;
          c = ch === "a" ? (p0.flow ? 1 : 0) : ch === "v" ? (p0.varianceMs2 || 0) : p0.colour[ch];
          s += wt[k] * c;
        }
        return s;
      }
      var px, py;
      if (typeof ctx.createImageData === "function" && typeof ctx.putImageData === "function") {
        var img = ctx.createImageData(box.width, box.height), data = img.data;
        for (py = 0; py < box.height; py++) for (px = 0; px < box.width; px++) {
          var gx = px / Math.max(1, box.width - 1) * (nx - 1), gy = py / Math.max(1, box.height - 1) * (ny - 1);
          var alpha = at(gx, gy, "a");
          var off0 = (py * box.width + px) * 4;
          if (alpha < 0.12) { data[off0] = 16; data[off0 + 1] = 16; data[off0 + 2] = 16; data[off0 + 3] = 255; continue; }
          var grain = (hash2(px, py) - 0.5) * 16, grain2 = (hash2(py + 31, px + 7) - 0.5) * 16;
          var turb = clamp(at(gx, gy, "v") * 900, 0, 22);
          var off = (py * box.width + px) * 4;
          data[off] = clamp(at(gx, gy, "r") + grain, 0, 255);
          data[off + 1] = clamp(at(gx, gy, "g") + grain2 + turb * (hash2(px + 3, py + 11) - 0.3), 0, 255);
          data[off + 2] = clamp(at(gx, gy, "b") - grain, 0, 255);
          data[off + 3] = Math.round(255 * clamp(alpha * 1.6, 0, 1));
        }
        ctx.putImageData(img, box.x, box.y);
      } else {
        for (py = 0; py < box.height; py++) for (px = 0; px < box.width; px++) {
          var gx2 = px / Math.max(1, box.width - 1) * (nx - 1), gy2 = py / Math.max(1, box.height - 1) * (ny - 1);
          if (at(gx2, gy2, "a") < 0.12) continue;
          ctx.fillStyle = "rgb(" + Math.round(clamp(at(gx2, gy2, "r") + (hash2(px, py) - 0.5) * 16, 0, 255)) + "," +
            Math.round(clamp(at(gx2, gy2, "g") + (hash2(py + 31, px + 7) - 0.5) * 16, 0, 255)) + "," +
            Math.round(clamp(at(gx2, gy2, "b"), 0, 255)) + ")";
          ctx.fillRect(box.x + px, box.y + py, 1, 1);
        }
      }
      ctx.strokeStyle = "#888"; ctx.beginPath();
      ctx.moveTo(box.x, box.y); ctx.lineTo(box.x + box.width, box.y);
      ctx.lineTo(box.x + box.width, box.y + box.height); ctx.lineTo(box.x, box.y + box.height);
      ctx.lineTo(box.x, box.y); ctx.stroke();
      ctx.fillStyle = "#9cf"; ctx.font = "12px sans-serif";
      ctx.fillText("Colour Nyquist " + (field.nyquistMs || 0).toFixed(2) + " m/s  red toward / blue away / green-yellow = variance", 8, H - 8);
      return true;
    }

    return { heart: heart, options: opts, flows: flowsAt, flowById: flowById,
      record: record, spectrum: spectrum, measure: measure, pisa: pisa,
      colourField: colourField, colourFor: colourFor, drawSpectrum: drawSpectrum,
      drawColour: drawColour, ecgSample: ecgSample,
      events: function () { return events.slice(); } };
  }

  var API = { create: create, defaults: defaults, C_SOUND: C_SOUND,
    bernoulli: bernoulli, velocityFromGradient: velocityFromGradient,
    lvotAreaCm2: lvotAreaCm2, continuityAVA: continuityAVA,
    pisaEROA: pisaEROA, pisaRadiusCm: pisaRadiusCm, pisaFlowMlPerSec: pisaFlowMlPerSec,
    mvaFromPHT: mvaFromPHT, phtFromMVA: phtFromMVA, estimatePASP: estimatePASP,
    maxPrfHz: maxPrfHz, nyquistFromDepth: nyquistFromDepth, nyquistFromPrf: nyquistFromPrf,
    wrapVelocity: wrapVelocity, angleDegBetween: angleDegBetween, ANCHOR: ANCHOR };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_DOPPLER = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));


