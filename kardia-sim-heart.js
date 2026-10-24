/* kardia-sim-heart.js - Kardia cardiac cycle model (WP1).
 *
 * Lumped-parameter, time-varying elastance model of LA, LV, RA, RV with
 * mitral, aortic, tricuspid and pulmonary valves (diode plus resistance,
 * optional regurgitant orifice), systemic and pulmonary Windkessel
 * circulations, driven by ONE clock (heart rate, PR, QRS and QT timing).
 * The same clock emits P, QRS, T and valve events so ECG (codeblue-ecg.js /
 * kardiox-ecgwave.js timing interfaces), heart sounds (clinix-audio.js:
 * MVC/TVC align with S1, AVC/PVC align with S2) and echo stay in sync.
 * Deterministic, no DOM. ES5 IIFE matching atlas3d.js style.
 *
 * PARAMETERS (create(params) / setParams(partial); presets below):
 *   heartRateBpm        bpm        ventricular rate (default 70)
 *   prMs                ms         P onset to QRS onset (160)
 *   qrsMs               ms         QRS duration, timing metadata (90)
 *   qtMs                ms         QRS onset to T end, timing metadata (380)
 *   af                  bool       atrial fibrillation: no P, no atrial kick,
 *                                  irregular RR (deterministic seeded jitter)
 *   rrJitter            0..1       AF RR jitter fraction (0.35)
 *   seed                int        AF deterministic seed (12345)
 *   lvEmaxMmHgPerMl     mmHg/ml    LV peak elastance (3.5)
 *   lvEminMmHgPerMl     mmHg/ml    LV diastolic elastance (0.055)
 *   rvEmaxMmHgPerMl     mmHg/ml    RV peak elastance (0.55)
 *   rvEminMmHgPerMl     mmHg/ml    RV diastolic elastance (0.04)
 *   laEmaxMmHgPerMl     mmHg/ml    LA peak elastance (0.15; atrial booster
 *                                  must stay weaker than early filling, so
 *                                  A velocity < E velocity in a normal heart)
 *   laEminMmHgPerMl     mmHg/ml    LA diastolic elastance (0.07)
 *   raEmaxMmHgPerMl     mmHg/ml    RA peak elastance (0.18)
 *   raEminMmHgPerMl     mmHg/ml    RA diastolic elastance (0.05)
 *   lvV0Ml              ml         LV unstressed volume (5)
 *   rvV0Ml              ml         RV unstressed volume (8)
 *   laV0Ml              ml         LA unstressed volume (3)
 *   raV0Ml              ml         RA unstressed volume (3)
 *   lvStiffness         mmHg/ml^3  LV passive wall stiffness coeff (see code)
 *   rvStiffness         mmHg/ml^3  RV passive wall stiffness coeff
 *   laStiffness         mmHg/ml^3  LA passive wall stiffness coeff
 *   raStiffness         mmHg/ml^3  RA passive wall stiffness coeff
 *   aorticValveAreaCm2      cm2    aortic valve effective orifice area,
 *                                  AVA (5.0 for a fully opening normal valve
 *                                  on this model's annulus; severe AS <1.0)
 *   mitralValveAreaCm2      cm2    mitral valve area, MVA (5.0; severe MS <1.0)
 *   tricuspidValveAreaCm2   cm2    tricuspid valve area (5.0)
 *   pulmonaryValveAreaCm2   cm2    pulmonary valve area (3.5)
 *   mitralRegurgAreaCm2     cm2    mitral regurgitant orifice, EROA (0; severe >=0.40)
 *   aorticRegurgAreaCm2     cm2    aortic regurgitant orifice (0)
 *   tricuspidRegurgAreaCm2  cm2    tricuspid regurgitant orifice (0)
 *   pulmonaryRegurgAreaCm2  cm2    pulmonary regurgitant orifice (0)
 *   systemicResistanceMmHgSMl  mmHg.s/ml  systemic vascular resistance (1.05)
 *   pulmonaryResistanceMmHgSMl mmHg.s/ml  pulmonary vascular resistance (0.09)
 *   systemicArterialComplianceMlMmHg  ml/mmHg  aortic compliance (0.95)
 *   pulmonaryArterialComplianceMlMmHg ml/mmHg  pulmonary artery compliance (3.5)
 *   systemicVenousComplianceMlMmHg    ml/mmHg  systemic venous compliance (70)
 *   pulmonaryVenousComplianceMlMmHg   ml/mmHg  pulmonary venous compliance (9)
 *   shuntAreaCm2        cm2        LA->RA shunt orifice, e.g. ASD (0)
 *   shuntFlowMlPerSec   ml/s       fixed shunt flow override if >0 (0 = orifice model)
 *   effusionPressureMmHg mmHg      pericardial pressure added to all chambers (0)
 *   mitralAnnulusAreaCm2 cm2       annulus area converting mitral flow to velocity (4.0)
 *   lvotAreaCm2         cm2        LVOT area for LVOT VTI = forward SV / area (3.14)
 *   totalBloodVolumeMl  ml         (documentation; initial volumes are tuned, see create)
 *
 * Units inside integration: volumes ml, pressures mmHg, flows ml/s,
 * time ms externally, seconds internally per substep.
 */
(function (G) {
  "use strict";

  var EVENT_NAMES = ["P", "QRS", "T", "MVC", "AVO", "AVC", "MVO", "TVC", "PVC"];

  function defaults() {
    return {
      heartRateBpm: 70, prMs: 160, qrsMs: 90, qtMs: 380,
      af: false, rrJitter: 0.35, seed: 12345,
      lvEmaxMmHgPerMl: 3.5, lvEminMmHgPerMl: 0.055,
      rvEmaxMmHgPerMl: 0.40, rvEminMmHgPerMl: 0.04,
      laEmaxMmHgPerMl: 0.15, laEminMmHgPerMl: 0.07,
      raEmaxMmHgPerMl: 0.18, raEminMmHgPerMl: 0.05,
      lvV0Ml: 5, rvV0Ml: 8, laV0Ml: 3, raV0Ml: 3,
      lvStiffness: 0.0000003, rvStiffness: 0.0000003,
      laStiffness: 0.00004, raStiffness: 0.00004,
      aorticValveAreaCm2: 5.0, mitralValveAreaCm2: 5.0,
      tricuspidValveAreaCm2: 5.0, pulmonaryValveAreaCm2: 3.5,
      mitralRegurgAreaCm2: 0, aorticRegurgAreaCm2: 0,
      tricuspidRegurgAreaCm2: 0, pulmonaryRegurgAreaCm2: 0,
      systemicResistanceMmHgSMl: 1.0, pulmonaryResistanceMmHgSMl: 0.09,
      systemicArterialComplianceMlMmHg: 0.95, pulmonaryArterialComplianceMlMmHg: 3.5,
      systemicVenousComplianceMlMmHg: 70, pulmonaryVenousComplianceMlMmHg: 9,
      shuntAreaCm2: 0, shuntFlowMlPerSec: 0, effusionPressureMmHg: 0,
      mitralAnnulusAreaCm2: 4.0, lvotAreaCm2: 3.14
    };
  }

  function merge(dst, src) {
    if (!src) return dst;
    for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k]; }
    return dst;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* Normalised ventricular activation: double-Hill, peak scaled to 1.
   * NORM precomputed once per shape change is approximated by a constant
   * obtained from the fixed shape constants (peak of raw curve ~0.665). */
  var ANORM = 0.62;
  /* Ventricular activation: rises linearly through systole (peak elastance
   * at end-systole, so dE/dt and hence ejection flow stay physiological),
   * then relaxes exponentially (tau 40 ms, below). */
  function ventEn(tauMs, tSysMs) {
    if (tauMs <= 0) return 0;
    if (tauMs <= tSysMs) return tauMs / tSysMs;
    /* LV relaxation is exponential with time constant tau = 40 ms (normal
     * LV relaxation time constant, Weiss et al.; ASE/EACVI 2016 diastolic
     * assessment). The previous 1/(1+x^3) tail stayed near peak elastance
     * for tens of ms after end-systole, delaying LV pressure decay and
     * mitral opening and blunting early (E-wave) filling. */
    return Math.exp(-(tauMs - tSysMs) / 40);
  }
  function atrialEn(tauMs) {
    if (tauMs <= 0 || tauMs > 320) return 0;
    var a = tauMs / 55, b = tauMs / 130;
    var a2 = a * a, b2 = b * b, b4 = b2 * b2;
    var raw = (a2 / (1 + a2)) * (1 / (1 + b4));
    var v = raw / ANORM;
    return v > 1 ? 1 : v;
  }

  function valveR(areaCm2) {
    var a = areaCm2 > 0.05 ? areaCm2 : 0.05;
    return 0.16 / (a * a); /* mmHg.s/ml; Bernoulli-consistent, see header tests */
  }
  function regurgR(areaCm2) {
    if (!(areaCm2 > 0)) return Infinity;
    var a = areaCm2 < 0.02 ? 0.02 : areaCm2;
    return 0.16 / (a * a);
  }
  /* Flow through a diode+resistance valve; regurgitant orifice when reversed.
   * Orifice (Bernoulli) law: Q = 45 * A * sqrt(|dP|) ml/s with A in cm2 and
   * dP in mmHg, so jet velocity Q/A gives gradient 4v^2 by construction. */
  function valveFlow(pUp, pDown, areaCm2, regurgAreaCm2) {
    var d = pUp - pDown;
    if (d >= 0) {
      var a = areaCm2 > 0.05 ? areaCm2 : 0.05;
      return 50 * a * Math.sqrt(d);
    }
    if (!(regurgAreaCm2 > 0)) return 0;
    var ar = regurgAreaCm2 < 0.02 ? 0.02 : regurgAreaCm2;
    return -50 * ar * Math.sqrt(-d); /* regurgitant flow (signed) */
  }

  function create(params) {
    var p = defaults();
    if (params && params.preset && presets[params.preset]) merge(p, presets[params.preset]);
    merge(p, params);
    if (p.preset) delete p.preset;

    /* ---- state (scalars only; step() allocates nothing) ---- */
    var VLA = 30, VLV = 110, VRA = 28, VRV = 110;
    var VAo = 1.15 * 98, VPA = 3.5 * 18, VSV = 70 * 10.8, VPV = 9 * 12;
    var timeMs = 0, cycleTimeMs = 0, cycleMs = 60000 / p.heartRateBpm;
    var cycleCount = 0;
    var rngState = (p.seed >>> 0) || 1;
    var nextCycleMs = cycleMs;
    var pFired = false, qrsFired = false, tFired = false;
    var fMV = 0, fAV = 0, fTV = 0, fPVv = 0;
    var fSys = 0, fPulm = 0, fSVin = 0, fPVin = 0, fShunt = 0;
    var PLA = 8, PLV = 8, PRA = 5, PRV = 6, PAo = 82, PPA = 16, PSV = 6, PPV = 9;
    var mvOpen = true, avOpen = false, tvOpen = true, pvOpen = false;
    var phase = "diastasis";
    var ev = { type: "", timeMs: 0, cycleTimeMs: 0, cycle: 0 };
    var listeners = {};
    for (var ei = 0; ei < EVENT_NAMES.length; ei++) listeners[EVENT_NAMES[ei]] = [];
    var lastEvents = []; /* {type,timeMs,cycleTimeMs,cycle} refreshed on events; read via state() */

    /* per-cycle accumulators */
    var cycLVmax = VLV, cycLVmin = VLV, cycRVmax = VRV, cycRVmin = VRV;
    var cycLVpeakP = 0, cycRVpeakP = 0, cycAoMax = 0, cycAoMin = 1e9;
    var cycLAsum = 0, cycSteps = 0;
    var cycAoFlowInt = 0, cycMVposInt = 0, cycMVnegInt = 0;
    var cycEvel = 0, cycAvel = 0;
    var cycMVC = -1, cycAVO = -1, cycAVC = -1, cycMVO = -1;
    var cycPeakAoVel = 0;
    var sum = null; /* last completed cycle summary (object reused) */

    function fire(type) {
      ev.type = type; ev.timeMs = timeMs; ev.cycleTimeMs = cycleTimeMs; ev.cycle = cycleCount;
      lastEvents.push({ type: type, timeMs: timeMs, cycleTimeMs: cycleTimeMs, cycle: cycleCount });
      if (lastEvents.length > 64) lastEvents.shift();
      var list = listeners[type], i;
      for (i = 0; i < list.length; i++) list[i](ev);
    }
    function nextRand() {
      rngState = (rngState * 1664525 + 1013904223) >>> 0;
      return rngState / 4294967296;
    }
    function planCycle() {
      var base = 60000 / p.heartRateBpm;
      if (p.af) {
        var j = p.rrJitter || 0.35;
        nextCycleMs = base * (1 + (nextRand() * 2 - 1) * j);
        if (nextCycleMs < 320) nextCycleMs = 320;
      } else nextCycleMs = base;
      /* Quantise the cycle length to the 1 ms integration grid. A
       * 857.142857 ms cycle at 70 bpm otherwise alternates 857/858 substeps,
       * so each cycle starts at a different substep phase and per-cycle
       * timings (IVC, LVET) jitter by 1 ms from cycle to cycle. Rounding
       * (rate error <0.02%) makes the discrete limit cycle exactly periodic. */
      nextCycleMs = Math.round(nextCycleMs);
    }
    planCycle(); cycleMs = nextCycleMs;

    function finishCycle() {
      var edv = cycLVmax, esv = cycLVmin;
      var fwdSV = cycAoFlowInt; /* ml ejected through aortic valve (net) */
      var totSV = edv - esv;
      if (!(fwdSV > 0)) fwdSV = totSV;
      if (fwdSV > totSV + 25) fwdSV = totSV;
      var ef = edv > 0 ? (totSV / edv) * 100 : 0;
      var rrS = cycleMs / 1000;
      var co = fwdSV * p.heartRateBpm / 1000; /* L/min, forward */
      if (p.af) co = (fwdSV / rrS) * 60 / 1000;
      var lvotVti = p.lvotAreaCm2 > 0 ? fwdSV / p.lvotAreaCm2 : 0; /* cm */
      var peakVel = cycPeakAoVel; /* m/s */
      sum = {
        EDV: edv, ESV: esv, SV: fwdSV, totalSV: totSV, EF: ef, CO: co,
        LVEDV: edv, LVESV: esv, forwardSV: fwdSV,
        RVEDV: cycRVmax, RVESV: cycRVmin,
        peakLVPressure: cycLVpeakP, peakAorticPressure: cycAoMax,
        aorticSystolic: cycAoMax, aorticDiastolic: cycAoMin === 1e9 ? 0 : cycAoMin,
        meanLAPressure: cycSteps ? cycLAsum / cycSteps : PLA,
        peakRVPressure: cycRVpeakP, RVsystolic: cycRVpeakP,
        Evelocity: cycEvel, Avelocity: cycAvel,
        eVelocityMs: cycEvel, aVelocityMs: cycAvel,
        LVOTVTI: lvotVti, lvotVtiCm: lvotVti,
        peakAorticVelocity: peakVel,
        peakAorticGradient: 4 * peakVel * peakVel,
        heartRateBpm: p.heartRateBpm, cycleMs: cycleMs,
        IVCms: (cycMVC >= 0 && cycAVO >= 0) ? (cycAVO - cycMVC) : -1,
        isovolumicContractionMs: (cycMVC >= 0 && cycAVO >= 0) ? (cycAVO - cycMVC) : -1,
        LVETms: (cycAVO >= 0 && cycAVC >= 0) ? (cycAVC - cycAVO) : -1,
        ejectionTimeMs: (cycAVO >= 0 && cycAVC >= 0) ? (cycAVC - cycAVO) : -1,
        regurgitantVolumeMl: cycMVnegInt,
        cycle: cycleCount
      };
    }
    function resetCycleAcc() {
      cycLVmax = VLV; cycLVmin = VLV; cycRVmax = VRV; cycRVmin = VRV;
      cycLVpeakP = 0; cycRVpeakP = 0; cycAoMax = 0; cycAoMin = 1e9;
      cycLAsum = 0; cycSteps = 0; cycAoFlowInt = 0; cycMVposInt = 0; cycMVnegInt = 0;
      cycEvel = 0; cycAvel = 0; cycMVC = -1; cycAVO = -1; cycAVC = -1; cycMVO = -1;
      cycPeakAoVel = 0;
    }

    function substep(dtS) {
      var dtMs = dtS * 1000;
      var prevCycleTime = cycleTimeMs;
      timeMs += dtMs; cycleTimeMs += dtMs;

      /* cycle rollover */
      if (cycleTimeMs >= cycleMs) {
        finishCycle();
        cycleTimeMs -= cycleMs;
        cycleCount++;
        planCycle(); cycleMs = nextCycleMs;
        pFired = false; qrsFired = false; tFired = false;
        resetCycleAcc();
      }

      /* ECG events from the one clock */
      if (!p.af && !pFired && cycleTimeMs >= 0 && prevCycleTime <= cycleTimeMs && cycleTimeMs >= 0) {
        /* P at cycle start (fired once, at rollover or first step) */
        if (cycleTimeMs >= 0 && !pFired && (cycleTimeMs < dtMs + 0.001 || cycleCount === 0)) { /* handled below */ }
      }
      if (!p.af && !pFired && cycleTimeMs >= 0 && cycleTimeMs < cycleMs) {
        // fire P when cycleTime crosses 0 (i.e. just after rollover)
        if (cycleTimeMs <= dtMs) { pFired = true; fire("P"); }
      }
      if (!qrsFired && cycleTimeMs >= p.prMs) { qrsFired = true; fire("QRS"); }
      var tAt = p.prMs + Math.max(120, p.qtMs - 110);
      if (!tFired && cycleTimeMs >= tAt) { tFired = true; fire("T"); }

      var tauV = cycleTimeMs - p.prMs; /* ms since QRS */
      var tauA = cycleTimeMs;          /* ms since P */
      var rr = cycleMs;
      var tSysV = 0.42 * rr;
      if (tSysV < 210) tSysV = 210; if (tSysV > 380) tSysV = 380;
      var enV = ventEn(tauV, tSysV);
      var enA = p.af ? 0 : atrialEn(tauA);
      /* atria share atrial clock; ventricles share ventricular clock */

      var eLV = p.lvEminMmHgPerMl + (p.lvEmaxMmHgPerMl - p.lvEminMmHgPerMl) * enV;
      var eRV = p.rvEminMmHgPerMl + (p.rvEmaxMmHgPerMl - p.rvEminMmHgPerMl) * enV;
      var eLA = p.laEminMmHgPerMl + (p.laEmaxMmHgPerMl - p.laEminMmHgPerMl) * enA;
      var eRA = p.raEminMmHgPerMl + (p.raEmaxMmHgPerMl - p.raEminMmHgPerMl) * enA;

      var dLV = VLV - p.lvV0Ml, dRV = VRV - p.rvV0Ml, dLA = VLA - p.laV0Ml, dRA = VRA - p.raV0Ml;
      var peri = p.effusionPressureMmHg;
      PLV = eLV * dLV + p.lvStiffness * dLV * dLV * dLV + peri;
      PRV = eRV * dRV + p.rvStiffness * dRV * dRV * dRV + peri;
      PLA = eLA * dLA + p.laStiffness * dLA * dLA * dLA + peri;
      PRA = eRA * dRA + p.raStiffness * dRA * dRA * dRA + peri;
      PAo = VAo / p.systemicArterialComplianceMlMmHg;
      PPA = VPA / p.pulmonaryArterialComplianceMlMmHg;
      PSV = VSV / p.systemicVenousComplianceMlMmHg;
      PPV = VPV / p.pulmonaryVenousComplianceMlMmHg;

      /* Valve inertance: flows lag their pressure targets (tau 15 ms), which
       * removes the non-physical 1 ms flow spike at valve opening. */
      var alpha = dtMs / (15 + dtMs), alphaSL = dtMs / (6 + dtMs);
      fMV += (valveFlow(PLA, PLV, p.mitralValveAreaCm2, p.mitralRegurgAreaCm2) - fMV) * alpha;
      fAV += (valveFlow(PLV, PAo, p.aorticValveAreaCm2, p.aorticRegurgAreaCm2) - fAV) * alphaSL;
      fTV += (valveFlow(PRA, PRV, p.tricuspidValveAreaCm2, p.tricuspidRegurgAreaCm2) - fTV) * alpha;
      fPVv += (valveFlow(PRV, PPA, p.pulmonaryValveAreaCm2, p.pulmonaryRegurgAreaCm2) - fPVv) * alphaSL;
      fSys = (PAo - PSV) / p.systemicResistanceMmHgSMl;
      fPulm = (PPA - PPV) / p.pulmonaryResistanceMmHgSMl;
      fSVin = (PSV - PRA) / 0.03; if (fSVin < 0) fSVin *= 0.3;
      fPVin = (PPV - PLA) / 0.03; if (fPVin < 0) fPVin *= 0.3;
      if (p.shuntFlowMlPerSec > 0) fShunt = p.shuntFlowMlPerSec;
      else if (p.shuntAreaCm2 > 0) fShunt = (PLA - PRA) / valveR(p.shuntAreaCm2 * 3);
      else fShunt = 0;

      /* valve state + closure/opening events (closures = S1/S2 alignment).
       * AV valves close only on ventricular systole (pressure crossover after
       * QRS), not on the small diastolic pressure dip after atrial systole. */
      var mvO = mvOpen, avO = avOpen, tvO = tvOpen, pvO = pvOpen;
      if (!mvOpen && PLA > PLV) mvO = true;
      if (mvOpen && tauV >= 0 && tauV < tSysV && PLV > PLA + 2) mvO = false;
      if (!tvOpen && PRA > PRV) tvO = true;
      if (tvOpen && tauV >= 0 && tauV < tSysV && PRV > PRA + 1) tvO = false;
      if (!avOpen && PLV > PAo) avO = true;
      if (avOpen && tauV > 150 && PAo > PLV && fAV < 25) avO = false;
      if (!pvOpen && PRV > PPA) pvO = true;
      if (pvOpen && tauV > 120 && PPA > PRV && fPVv < 25) pvO = false;
      if (mvOpen && !mvO) { if (cycMVC < 0) cycMVC = cycleTimeMs; fire("MVC"); }
      if (!mvOpen && mvO) { if (cycMVO < 0) cycMVO = cycleTimeMs; fire("MVO"); }
      if (!avOpen && avO) { if (cycAVO < 0) cycAVO = cycleTimeMs; fire("AVO"); }
      if (avOpen && !avO) { if (cycAVC < 0) cycAVC = cycleTimeMs; fire("AVC"); }
      if (tvOpen && !tvO) fire("TVC");
      if (!pvOpen && pvO) { /* pulmonary opening has no named event */ }
      if (pvOpen && !pvO) fire("PVC");
      mvOpen = mvO; avOpen = avO; tvOpen = tvO; pvOpen = pvO;

      if (avO) phase = "ejection";
      else if (mvO) phase = enA > 0.35 ? "atrialSystole" : (tauV > tSysV ? "rapidFilling" : "diastasis");
      else if (tauV >= 0 && tauV < tSysV) phase = enV > 0.05 && PLV > PLA ? "isovolumicContraction" : "isovolumicContraction";
      else phase = "isovolumicRelaxation";
      if (mvO && tauV > tSysV) phase = cycleTimeMs < p.prMs ? "rapidFilling" : phase;

      /* integrate (explicit Euler, substep <=1 ms from step()) */
      VLA += (fPVin - fMV - fShunt) * dtS;
      VLV += (fMV - fAV) * dtS;
      VRA += (fSVin - fTV + fShunt) * dtS;
      VRV += (fTV - fPVv) * dtS;
      VAo += (fAV - fSys) * dtS;
      VPA += (fPVv - fPulm) * dtS;
      VSV += (fSys - fSVin) * dtS;
      VPV += (fPulm - fPVin) * dtS;
      if (VLA < 2) VLA = 2; if (VLV < 2) VLV = 2; if (VRA < 2) VRA = 2; if (VRV < 2) VRV = 2;
      if (VAo < 5) VAo = 5; if (VPA < 5) VPA = 5; if (VSV < 20) VSV = 20; if (VPV < 5) VPV = 5;

      /* per-cycle metrics */
      if (VLV > cycLVmax) cycLVmax = VLV;
      if (VLV < cycLVmin) cycLVmin = VLV;
      if (VRV > cycRVmax) cycRVmax = VRV;
      if (VRV < cycRVmin) cycRVmin = VRV;
      if (PLV > cycLVpeakP) cycLVpeakP = PLV;
      if (PRV > cycRVpeakP) cycRVpeakP = PRV;
      if (PAo > cycAoMax) cycAoMax = PAo;
      if (PAo < cycAoMin) cycAoMin = PAo;
      cycLAsum += PLA; cycSteps++;
      if (fAV > 0) {
        cycAoFlowInt += fAV * dtS;
        /* Jet velocity at the vena contracta = flow / effective orifice
         * area. aorticValveAreaCm2 is that effective area (guideline AVA,
         * severe AS <1.0 cm2), and valveFlow()'s Q = 50*A*sqrt(dP) is the
         * Bernoulli orifice law on the same basis, so 4v^2 here equals the
         * transvalvular gradient the model actually generates. The old
         * extra 0.85 divisor counted vena-contracta contraction twice,
         * inflating velocity by 18% and gradient by 38%. */
        var vel = (fAV / p.aorticValveAreaCm2) / 100; /* cm/s -> m/s */
        if (vel > cycPeakAoVel) cycPeakAoVel = vel;
      } else if (fAV < 0) cycAoFlowInt += fAV * dtS;
      if (fMV > 0) {
        cycMVposInt += fMV * dtS;
        var mvVel = (fMV / p.mitralAnnulusAreaCm2) / 100;
        if (enA > 0.25 && tauA < p.prMs + 40) { if (mvVel > cycAvel) cycAvel = mvVel; }
        else if (cycAVC >= 0 && cycleTimeMs > cycAVC) { if (mvVel > cycEvel) cycEvel = mvVel; }
        else if (cycMVO >= 0 && cycleTimeMs >= cycMVO && tauV < 0) { if (mvVel > cycEvel) cycEvel = mvVel; }
      } else if (fMV < 0) cycMVnegInt += -fMV * dtS;
    }

    function step(dtMs) {
      if (!(dtMs > 0)) return api;
      var remaining = dtMs;
      while (remaining > 0.0001) {
        var h = remaining > 1 ? 1 : remaining;
        substep(h / 1000);
        remaining -= h;
      }
      return api;
    }

    function state() {
      return {
        timeMs: timeMs, cycleTimeMs: cycleTimeMs, cycleMs: cycleMs, rrMs: cycleMs,
        cycleDurationMs: cycleMs, cycle: cycleCount, phase: phase,
        heartRateBpm: p.heartRateBpm,
        volumes: { LA: VLA, LV: VLV, RA: VRA, RV: VRV, Ao: VAo, PA: VPA, SV: VSV, PV: VPV,
          laMl: VLA, lvMl: VLV, raMl: VRA, rvMl: VRV },
        pressures: { LA: PLA, LV: PLV, RA: PRA, RV: PRV, Ao: PAo, PA: PPA, SV: PSV, PV: PPV,
          laMmHg: PLA, lvMmHg: PLV, raMmHg: PRA, rvMmHg: PRV, aorticMmHg: PAo, pulmonaryArterialMmHg: PPA },
        valves: {
          mitral: { open: mvOpen, flow: fMV, name: "mitral" },
          aortic: { open: avOpen, flow: fAV, name: "aortic" },
          tricuspid: { open: tvOpen, flow: fTV, name: "tricuspid" },
          pulmonary: { open: pvOpen, flow: fPVv, name: "pulmonary" }
        },
        flows: { mitral: fMV, aortic: fAV, tricuspid: fTV, pulmonary: fPVv,
          systemic: fSys, pulmonaryCirculation: fPulm, shunt: fShunt,
          mitralMlPerSec: fMV, aorticMlPerSec: fAV },
        events: lastEvents.slice(),
        /* flat aliases */
        lvVolume: VLV, laVolume: VLA, rvVolume: VRV, raVolume: VRA,
        lvPressure: PLV, laPressure: PLA, rvPressure: PRV, raPressure: PRA,
        aorticPressure: PAo, pulmonaryPressure: PPA,
        mitralOpen: mvOpen, aorticOpen: avOpen, tricuspidOpen: tvOpen, pulmonaryOpen: pvOpen,
        mitralFlow: fMV, aorticFlow: fAV
      };
    }

    function summary() {
      if (!sum) {
        return { EDV: VLV, ESV: VLV, SV: 0, EF: 0, CO: 0, LVEDV: VLV, LVESV: VLV, forwardSV: 0,
          peakLVPressure: PLV, peakAorticPressure: PAo, aorticSystolic: PAo, aorticDiastolic: PAo,
          meanLAPressure: PLA, peakRVPressure: PRV, RVsystolic: PRV, Evelocity: 0, Avelocity: 0,
          LVOTVTI: 0, peakAorticVelocity: 0, peakAorticGradient: 0, heartRateBpm: p.heartRateBpm,
          IVCms: -1, LVETms: -1 };
      }
      /* return a copy so callers cannot mutate the accumulator */
      var o = {}, k;
      for (k in sum) o[k] = sum[k];
      return o;
    }

    var api = {
      step: step, state: state, summary: summary,
      setParams: function (partial) { merge(p, partial || {}); planCycle(); return api; },
      getParams: function () { var o = {}, k; for (k in p) o[k] = p[k]; return o; },
      on: function (type, fn) {
        if (!listeners[type]) listeners[type] = [];
        if (typeof fn === "function") listeners[type].push(fn);
        return api;
      },
      params: p
    };
    return api;
  }

  var presets = {
    normal: defaults(),
    /* Pathology hooks (WP7 data files will supply full sets; these are the
     * parameter-name hooks with textbook-severe values for smoke tests). */
    severeAS: merge(defaults(), { aorticValveAreaCm2: 0.8 }),
    severeMR: merge(defaults(), { mitralRegurgAreaCm2: 0.40 }),
    severeMS: merge(defaults(), { mitralValveAreaCm2: 0.9 }),
    severeAR: merge(defaults(), { aorticRegurgAreaCm2: 0.30 }),
    af: merge(defaults(), { af: true, heartRateBpm: 90 }),
    tachycardia: merge(defaults(), { heartRateBpm: 120 }),
    tamponadeHook: merge(defaults(), { effusionPressureMmHg: 15 }),
    asdHook: merge(defaults(), { shuntAreaCm2: 1.5 })
  };

  var API = { create: create, presets: presets, EVENT_NAMES: EVENT_NAMES.slice(), defaults: defaults };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_HEART = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
