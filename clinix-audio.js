/* clinix-audio.js — CliniX · auscultation sounds, SYNTHESIZED in the browser.
 *
 * WHY SYNTHESIZE RATHER THAN SOURCE RECORDINGS:
 * Breath sounds are the one part of the respiratory examination that text genuinely cannot teach.
 * Real teaching recordings are almost all copyrighted, and the licence gate correctly refuses them,
 * which left the added-sounds lesson with nothing to hear. Web Audio can generate them: a breath
 * sound IS filtered noise with an envelope, a wheeze IS a resonant peak on that noise, a crackle IS
 * a very short burst. Generated audio is licence-free, needs no download, works offline, and can be
 * varied on demand (slower, louder, one phase only) in ways a recording cannot.
 *
 * HONESTY: these are TEACHING models, not recordings of patients. They reproduce the features a
 * student is being asked to discriminate - timing within the cycle, pitch, duration, whether the
 * sound clears with a cough - and they are labelled as synthesized wherever they play. A student
 * must still listen to real patients; this is for learning what to listen FOR.
 *
 * Everything is scheduled ahead on the AudioContext clock, never with setTimeout, so the rhythm is
 * sample-accurate and does not stutter when the JS thread is busy rendering a lesson.
 */
(function () {
  "use strict";

  var AC = null;
  var noiseBuf = null;
  var active = [];          // live handles, so a screen change can stop everything

  function ctx() {
    if (AC) return AC;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      AC = new C();
    } catch (e) { return null; }
    return AC;
  }

  function available() { return !!(window.AudioContext || window.webkitAudioContext); }

  /* iOS will not start an AudioContext outside a user gesture, and leaves it "suspended".
   * Every play() is triggered by a tap, so resuming here is legitimate and required. */
  function unlock() {
    var c = ctx();
    if (c && c.state === "suspended") { try { c.resume(); } catch (e) {} }
    return c;
  }

  // One reusable 4-second white-noise buffer. Breath sounds are all shaped noise, so everything
  // downstream is filters and envelopes on this.
  function noise(c) {
    if (noiseBuf) return noiseBuf;
    var len = c.sampleRate * 4;
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /* ── the sound models ─────────────────────────────────────────────────────
   * insp/exp are seconds. gap = the pause between them (bronchial breathing has one, vesicular
   * does not - that gap is a large part of how you tell them apart).
   * band/q shape the noise. peak = extra resonance (a wheeze is a narrow peak).
   */
  var KINDS = {
    vesicular: {
      label: "Vesicular breath sounds",
      hint: "Normal. Rustling inspiration running straight into a shorter, quieter expiration, with no gap.",
      insp: 1.6, exp: 0.8, gap: 0, rest: 0.7,
      band: 380, q: 0.7, inspGain: 0.5, expGain: 0.16
    },
    bronchial: {
      label: "Bronchial breathing",
      hint: "Consolidation. Hollow and blowing, with a clear GAP between the phases, and expiration as long and as loud as inspiration.",
      insp: 1.2, exp: 1.2, gap: 0.35, rest: 0.7,
      band: 780, q: 0.6, inspGain: 0.45, expGain: 0.45
    },
    reduced: {
      label: "Reduced breath sounds",
      hint: "COPD, effusion, pneumothorax. The same shape as vesicular, much quieter, with a long expiratory phase.",
      insp: 1.5, exp: 1.8, gap: 0, rest: 0.7,
      band: 340, q: 0.7, inspGain: 0.16, expGain: 0.07
    },
    wheeze: {
      label: "Polyphonic expiratory wheeze",
      hint: "Diffuse airflow obstruction. Musical, several notes at once, through a prolonged expiration.",
      insp: 1.2, exp: 2.2, gap: 0, rest: 0.6,
      band: 360, q: 0.7, inspGain: 0.34, expGain: 0.2,
      // several simultaneous notes = POLYphonic. A single fixed note would be monophonic, which
      // means something quite different (one narrowed airway: tumour, foreign body).
      wheezeHz: [320, 430, 610, 880], wheezePhase: "exp", wheezeGain: 0.16
    },
    monophonic: {
      label: "Fixed monophonic wheeze",
      hint: "ONE note, not many. A single narrowed large airway: tumour or foreign body until proven otherwise.",
      insp: 1.3, exp: 1.9, gap: 0, rest: 0.6,
      band: 360, q: 0.7, inspGain: 0.34, expGain: 0.2,
      wheezeHz: [520], wheezePhase: "both", wheezeGain: 0.26
    },
    coarse: {
      label: "Coarse crackles, early inspiratory",
      hint: "Secretions in larger airways. Low-pitched, few, EARLY in inspiration, and they change or clear when the patient coughs.",
      insp: 1.6, exp: 0.9, gap: 0, rest: 0.7,
      band: 340, q: 0.7, inspGain: 0.34, expGain: 0.12,
      crackle: { n: 7, from: 0.05, to: 0.45, dur: 0.018, hz: 260, gain: 0.55 }
    },
    fine: {
      label: "Fine crackles, late inspiratory",
      hint: "Fibrosis or pulmonary oedema. High-pitched, many, LATE in inspiration, and they do NOT clear with coughing. Like velcro.",
      insp: 1.7, exp: 0.9, gap: 0, rest: 0.7,
      band: 380, q: 0.7, inspGain: 0.3, expGain: 0.12,
      crackle: { n: 22, from: 0.55, to: 0.98, dur: 0.006, hz: 900, gain: 0.36 }
    },
    rub: {
      label: "Pleural rub",
      hint: "Creaking leather, in BOTH phases, unaffected by coughing, often painful. It disappears as fluid separates the surfaces, which is not improvement.",
      insp: 1.5, exp: 1.2, gap: 0, rest: 0.8,
      band: 220, q: 1.2, inspGain: 0.3, expGain: 0.22,
      crackle: { n: 16, from: 0.1, to: 0.95, dur: 0.03, hz: 180, gain: 0.4, bothPhases: true }
    },
    stridor: {
      label: "Stridor",
      hint: "Harsh, HIGH pitched, loudest over the neck. Upper airway obstruction, and an emergency. This model plays the INSPIRATORY pattern of laryngeal obstruction; the phase itself localises, so biphasic stridor points to the subglottis or trachea and expiratory stridor to an intrathoracic large airway.",
      insp: 1.9, exp: 1.0, gap: 0, rest: 0.6,
      // Turbulent noise centred HIGH: this is a supraglottic/tracheal sound, not a small-airway one.
      band: 950, q: 1.3, inspGain: 0.42, expGain: 0.10,
      /* PITCH IS THE WHOLE TEACHING POINT. Stridor must sit clearly ABOVE the wheezes, or a student
       * comparing them learns the discriminator backwards. It was 420 Hz, below the 520 Hz
       * monophonic wheeze (owner report, 2026-08-25).
       * A fundamental plus its octave reads as ONE harsh note rather than as a polyphonic chord,
       * which is what makes stridor sound strained rather than musical. */
      wheezeHz: [1000, 2000], wheezePhase: "insp", wheezeGain: 0.30
    },
    s1_s2_normal: {
      label: "Normal S1 and S2 heart sounds",
      hint: "Normal 'lub-dub'. S1 marks mitral/tricuspid closure (start of systole); S2 marks aortic/pulmonary closure (start of diastole). Diastole is longer than systole at resting heart rates.",
      cardiac: true, cycle: 0.85, sysLen: 0.32,
      s1Hz: 82, s1HzEnd: 55, s1Dur: 0.09, s1Gain: 0.65,
      s2Hz: 135, s2HzEnd: 105, s2Dur: 0.07, s2Gain: 0.6
    },
    s1_s2_split: {
      label: "Physiological S2 splitting",
      hint: "Inspiration increases venous return to the right heart, delaying pulmonary valve closure (P2) relative to aortic closure (A2). The split widens on inspiration and closes on expiration.",
      cardiac: true, cycle: 0.85, sysLen: 0.32,
      s1Hz: 82, s1HzEnd: 55, s1Dur: 0.09, s1Gain: 0.65,
      s2Hz: 140, s2HzEnd: 110, s2Dur: 0.065, s2Gain: 0.6,
      s2Split: 0.045
    },
    s3_gallop: {
      label: "S3 ventricular gallop ('Kentucky')",
      hint: "Dull, low-frequency sound in early diastole caused by rapid ventricular filling into a non-compliant or volume-overloaded ventricle (heart failure, severe regurgitation). Normal in young athletes.",
      cardiac: true, cycle: 0.85, sysLen: 0.32,
      s1Hz: 82, s1HzEnd: 55, s1Dur: 0.09, s1Gain: 0.65,
      s2Hz: 135, s2HzEnd: 105, s2Dur: 0.07, s2Gain: 0.6,
      s3: true
    },
    s4_gallop: {
      label: "S4 atrial gallop ('Tennessee')",
      hint: "Low-frequency presystolic sound in late diastole caused by active atrial contraction against a stiff, hypertrophied ventricle (hypertension, aortic stenosis, HOCM). Never present in atrial fibrillation.",
      cardiac: true, cycle: 0.85, sysLen: 0.32,
      s1Hz: 82, s1HzEnd: 55, s1Dur: 0.09, s1Gain: 0.65,
      s2Hz: 135, s2HzEnd: 105, s2Dur: 0.07, s2Gain: 0.6,
      s4: true
    },
    mitral_stenosis: {
      label: "Mitral stenosis: loud S1, Opening Snap and mid-diastolic rumble",
      hint: "Loud S1 (flexible leaflets snapping shut), followed after S2 by an Opening Snap (high-pitched click of stenotic valve opening), then a low-pitched rumbling murmur with presystolic accentuation in sinus rhythm.",
      cardiac: true, cycle: 0.85, sysLen: 0.32,
      s1Hz: 95, s1HzEnd: 65, s1Dur: 0.09, s1Gain: 0.85,
      s2Hz: 135, s2HzEnd: 105, s2Dur: 0.07, s2Gain: 0.6,
      openingSnap: 0.075, diaMurmur: "mid_rumble", murmurBand: 120, murmurGain: 0.28
    },
    mitral_regurgitation: {
      label: "Mitral regurgitation: pansystolic murmur",
      hint: "Blowing holosystolic murmur beginning with a soft S1 and continuing through S2, radiating to the axilla. Backflow through incompetent mitral valve throughout ventricular systole.",
      cardiac: true, cycle: 0.85, sysLen: 0.32,
      s1Hz: 75, s1HzEnd: 50, s1Dur: 0.08, s1Gain: 0.45,
      s2Hz: 135, s2HzEnd: 105, s2Dur: 0.07, s2Gain: 0.55,
      sysMurmur: "pansystolic", murmurBand: 480, murmurGain: 0.26
    },
    aortic_stenosis: {
      label: "Aortic stenosis: ejection systolic crescendo-decrescendo murmur",
      hint: "Harsh diamond-shaped murmur starting after S1, peaking in mid-systole and ending before S2. Radiates to carotids. Often associated with a soft or absent A2 and slow rising pulse (pulsus parvus et tardus).",
      cardiac: true, cycle: 0.85, sysLen: 0.34,
      s1Hz: 80, s1HzEnd: 55, s1Dur: 0.085, s1Gain: 0.6,
      s2Hz: 125, s2HzEnd: 100, s2Dur: 0.065, s2Gain: 0.45,
      sysMurmur: "ejection", murmurBand: 320, murmurGain: 0.32
    },
    aortic_regurgitation: {
      label: "Aortic regurgitation: early diastolic decrescendo murmur",
      hint: "High-pitched, blowing murmur starting immediately at S2 and fading during diastole. Best heard with diaphragm at left sternal edge (Erb's point) with patient sitting forward in full expiration.",
      cardiac: true, cycle: 0.85, sysLen: 0.32,
      s1Hz: 82, s1HzEnd: 55, s1Dur: 0.09, s1Gain: 0.65,
      s2Hz: 140, s2HzEnd: 110, s2Dur: 0.07, s2Gain: 0.65,
      diaMurmur: "early_decrescendo", murmurBand: 580, murmurGain: 0.27
    },
    pericardial_rub: {
      label: "Pericardial friction rub (triphasic scratch)",
      hint: "Superficial, scratchy, high-pitched sound with up to three components per cardiac cycle: atrial systole, ventricular systole, and early diastolic filling. Best heard with patient leaning forward in expiration.",
      cardiac: true, cycle: 0.85, sysLen: 0.32,
      s1Hz: 80, s1HzEnd: 55, s1Dur: 0.085, s1Gain: 0.55,
      s2Hz: 130, s2HzEnd: 105, s2Dur: 0.065, s2Gain: 0.55,
      frictionRub: true, murmurBand: 620, murmurGain: 0.24
    }
  };

  /* ── scheduling ───────────────────────────────────────────────────────── */

  // One phase of one breath: shaped noise with a smooth rise and fall.
  function phase(c, dest, spec, t0, dur, gain, isInsp) {
    if (dur <= 0 || gain <= 0) return;
    var src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;

    var bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = spec.band;
    bp.Q.value = spec.q;

    // Inspiration is brighter than expiration; sweeping the filter makes it breathe rather than hiss.
    try {
      bp.frequency.setValueAtTime(spec.band * (isInsp ? 0.85 : 1.05), t0);
      bp.frequency.linearRampToValueAtTime(spec.band * (isInsp ? 1.15 : 0.8), t0 + dur);
    } catch (e) {}

    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + dur * 0.35);
    g.gain.setValueAtTime(Math.max(0.0002, gain), t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(bp); bp.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.02);
    return src;
  }

  // A wheeze is a narrow resonant peak riding on the same noise, so it is musical but breathy.
  function wheeze(c, dest, hz, t0, dur, gain) {
    var src = c.createBufferSource();
    src.buffer = noise(c); src.loop = true;
    var bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = hz; bp.Q.value = 22;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    // a slight glide is what stops it sounding like a test tone
    try {
      bp.frequency.setValueAtTime(hz * 0.97, t0);
      bp.frequency.linearRampToValueAtTime(hz * 1.06, t0 + dur);
    } catch (e) {}
    src.connect(bp); bp.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // A crackle is a very short burst. Duration is the whole difference between fine and coarse.
  function crackle(c, dest, t0, dur, hz, gain) {
    var src = c.createBufferSource();
    src.buffer = noise(c); src.loop = true;
    var bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = hz; bp.Q.value = 3.5;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.01);
  }

  function scheduleBreath(c, dest, spec, t0) {
    var i0 = t0, iDur = spec.insp;
    var e0 = t0 + spec.insp + (spec.gap || 0), eDur = spec.exp;
    phase(c, dest, spec, i0, iDur, spec.inspGain, true);
    phase(c, dest, spec, e0, eDur, spec.expGain, false);

    var k;
    if (spec.wheezeHz) {
      for (k = 0; k < spec.wheezeHz.length; k++) {
        if (spec.wheezePhase === "insp" || spec.wheezePhase === "both") wheeze(c, dest, spec.wheezeHz[k], i0 + iDur * 0.15, iDur * 0.8, spec.wheezeGain);
        if (spec.wheezePhase === "exp" || spec.wheezePhase === "both") wheeze(c, dest, spec.wheezeHz[k], e0 + eDur * 0.08, eDur * 0.88, spec.wheezeGain);
      }
    }
    if (spec.crackle) {
      var cr = spec.crackle;
      for (k = 0; k < cr.n; k++) {
        // jittered, not metronomic - evenly spaced crackles sound synthetic immediately
        var f = cr.from + (cr.to - cr.from) * (k / Math.max(1, cr.n - 1));
        var jit = (Math.random() - 0.5) * ((cr.to - cr.from) / Math.max(2, cr.n)) * 0.9;
        crackle(c, dest, i0 + iDur * Math.min(0.99, Math.max(0.01, f + jit)), cr.dur, cr.hz * (0.9 + Math.random() * 0.2), cr.gain);
        if (cr.bothPhases) crackle(c, dest, e0 + eDur * Math.min(0.99, Math.max(0.01, f + jit)), cr.dur, cr.hz * (0.9 + Math.random() * 0.2), cr.gain);
      }
    }
    return spec.insp + (spec.gap || 0) + spec.exp + spec.rest;
  }

  /* ── Cardiac Sound Synthesis ─────────────────────────────────────────── */

  // Low/mid frequency resonant pulse with chest-wall damping for heart sounds
  function heartSound(c, dest, hzStart, hzEnd, t0, dur, gain) {
    if (dur <= 0 || gain <= 0) return;
    var osc = c.createOscillator();
    osc.type = "sine";
    try {
      osc.frequency.setValueAtTime(hzStart, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, hzEnd), t0 + dur);
    } catch (e) {}

    var lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(hzStart, hzEnd) * 2.2;

    var g = c.createGain();
    try {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    } catch (e) {}

    osc.connect(lp); lp.connect(g); g.connect(dest);
    try { osc.start(t0); osc.stop(t0 + dur + 0.02); } catch (e) {}
  }

  // Shaped bandpass noise for cardiac murmurs (pansystolic, ejection diamond, diastolic decrescendo/rumble)
  function murmurNoise(c, dest, band, q, t0, dur, gainStart, gainPeak, gainEnd) {
    if (dur <= 0 || (gainStart <= 0 && gainPeak <= 0 && gainEnd <= 0)) return;
    var src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;

    var bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = band;
    bp.Q.value = q || 1.2;

    var g = c.createGain();
    try {
      g.gain.setValueAtTime(Math.max(0.0001, gainStart), t0);
      if (gainPeak != null) {
        g.gain.linearRampToValueAtTime(gainPeak, t0 + dur * 0.5);
        g.gain.linearRampToValueAtTime(Math.max(0.0001, gainEnd || 0.0001), t0 + dur);
      } else {
        g.gain.linearRampToValueAtTime(Math.max(0.0001, gainEnd || gainStart), t0 + dur);
      }
      g.gain.setValueAtTime(0.0001, t0 + dur + 0.01);
    } catch (e) {}

    src.connect(bp); bp.connect(g); g.connect(dest);
    try { src.start(t0); src.stop(t0 + dur + 0.02); } catch (e) {}
  }

  function scheduleBeat(c, dest, spec, t0) {
    var cycle = spec.cycle || 0.85;
    var sysLen = spec.sysLen || 0.32;
    var tS1 = t0;
    var tS2 = t0 + sysLen;

    // S4 (late diastolic / presystolic gallop, just before S1)
    if (spec.s4) {
      heartSound(c, dest, 55, 40, t0 + 0.01, 0.065, 0.35);
      tS1 = t0 + 0.08;
      tS2 = tS1 + sysLen;
    }

    // S1 (mitral/tricuspid closure)
    heartSound(c, dest, spec.s1Hz || 82, spec.s1HzEnd || 55, tS1, spec.s1Dur || 0.09, spec.s1Gain || 0.65);

    // Systolic Murmur
    if (spec.sysMurmur === "pansystolic") {
      murmurNoise(c, dest, spec.murmurBand || 480, 1.2, tS1 + 0.04, sysLen - 0.02, spec.murmurGain || 0.26, spec.murmurGain || 0.26, spec.murmurGain || 0.22);
    } else if (spec.sysMurmur === "ejection") {
      murmurNoise(c, dest, spec.murmurBand || 320, 1.6, tS1 + 0.06, sysLen - 0.08, 0.001, spec.murmurGain || 0.32, 0.001);
    }

    // S2 (aortic/pulmonary closure)
    heartSound(c, dest, spec.s2Hz || 135, spec.s2HzEnd || 105, tS2, spec.s2Dur || 0.07, spec.s2Gain || 0.6);
    if (spec.s2Split) {
      heartSound(c, dest, (spec.s2Hz || 135) * 0.9, (spec.s2HzEnd || 105) * 0.9, tS2 + spec.s2Split, spec.s2Dur || 0.06, (spec.s2Gain || 0.6) * 0.7);
    }

    // Diastolic Events
    var diaStart = tS2 + (spec.s2Dur || 0.07);
    var diaLen = Math.max(0.1, (t0 + cycle) - diaStart);

    // Opening Snap (MS)
    if (spec.openingSnap) {
      heartSound(c, dest, 220, 180, tS2 + spec.openingSnap, 0.025, 0.45);
    }

    // S3 (early diastolic gallop)
    if (spec.s3) {
      heartSound(c, dest, 50, 36, tS2 + 0.14, 0.075, 0.36);
    }

    // Diastolic Murmurs
    if (spec.diaMurmur === "early_decrescendo") {
      murmurNoise(c, dest, spec.murmurBand || 580, 1.0, tS2 + 0.03, diaLen * 0.75, spec.murmurGain || 0.27, null, 0.0001);
    } else if (spec.diaMurmur === "mid_rumble") {
      var rumbleStart = tS2 + (spec.openingSnap ? spec.openingSnap + 0.02 : 0.08);
      murmurNoise(c, dest, spec.murmurBand || 120, 2.2, rumbleStart, diaLen * 0.85, spec.murmurGain || 0.28, (spec.murmurGain || 0.28) * 0.6, (spec.murmurGain || 0.28) * 1.3);
    }

    // Pericardial Friction Rub (triphasic scratch)
    if (spec.frictionRub) {
      murmurNoise(c, dest, spec.murmurBand || 620, 2.0, tS1 + 0.06, 0.16, spec.murmurGain || 0.24, spec.murmurGain || 0.24, 0.001);
      murmurNoise(c, dest, spec.murmurBand || 620, 2.0, tS2 + 0.08, 0.14, (spec.murmurGain || 0.24) * 0.8, (spec.murmurGain || 0.24) * 0.8, 0.001);
      murmurNoise(c, dest, spec.murmurBand || 620, 2.0, t0 + cycle - 0.12, 0.10, (spec.murmurGain || 0.24) * 0.9, (spec.murmurGain || 0.24) * 0.9, 0.001);
    }

    return cycle;
  }

  /* play(kind, opts) -> { stop, cycle, spec }
   * opts.breaths (default 3), opts.beats (default 4 for cardiac), opts.slow (stretches everything),
   * opts.onEnd, opts.onPhase(name) so the UI can show which phase is sounding. */
  function play(kind, opts) {
    opts = opts || {};
    var spec = KINDS[kind];
    var c = unlock();
    if (!spec || !c) return null;

    stopAll();

    var s = {}, key;
    for (key in spec) if (Object.prototype.hasOwnProperty.call(spec, key)) s[key] = spec[key];
    if (opts.slow) {
      if (s.cardiac) {
        s.cycle = (s.cycle || 0.85) * 1.4;
        s.sysLen = (s.sysLen || 0.32) * 1.3;
      } else {
        s.insp *= 1.6; s.exp *= 1.6; s.gap = (s.gap || 0) * 1.6; s.rest *= 1.2;
      }
    }

    var master = c.createGain();
    master.gain.value = typeof opts.volume === "number" ? opts.volume : 0.9;
    master.connect(c.destination);

    var isCardiac = !!s.cardiac;
    var cycles = isCardiac ? (opts.beats || opts.cycles || 4) : (opts.breaths || 3);
    var t = c.currentTime + 0.08, total = 0, i;
    for (i = 0; i < cycles; i++) {
      var len = isCardiac ? scheduleBeat(c, master, s, t + total) : scheduleBreath(c, master, s, t + total);
      total += len;
    }

    var timer = null;
    if (opts.onEnd) timer = setTimeout(opts.onEnd, (total + 0.2) * 1000);

    var handle = {
      cycle: s.cycle || (s.insp + (s.gap || 0) + s.exp + s.rest),
      spec: s,
      stop: function () {
        try { master.gain.setTargetAtTime(0.0001, c.currentTime, 0.02); } catch (e) {}
        try { setTimeout(function () { try { master.disconnect(); } catch (e) {} }, 200); } catch (e) {}
        if (timer) clearTimeout(timer);
        for (var j = active.length - 1; j >= 0; j--) if (active[j] === handle) active.splice(j, 1);
      }
    };
    active.push(handle);
    return handle;
  }

  function stopAll() {
    for (var i = active.length - 1; i >= 0; i--) { try { active[i].stop(); } catch (e) {} }
    active = [];
  }

  function labelOf(kind) { return KINDS[kind] ? KINDS[kind].label : ""; }
  function hintOf(kind) { return KINDS[kind] ? KINDS[kind].hint : ""; }
  function has(kind) { return !!KINDS[kind]; }

  var API = {
    KINDS: KINDS, has: has, available: available,
    play: play, stopAll: stopAll, labelOf: labelOf, hintOf: hintOf,
    // exposed for node tests: the spec table is pure data and can be asserted without an AudioContext
    _spec: function (k) { return KINDS[k]; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_AUDIO = API;
})();
