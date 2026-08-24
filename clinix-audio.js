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
      hint: "INSPIRATORY, harsh, loudest over the neck. Upper airway obstruction. An emergency, not a wheeze.",
      insp: 1.8, exp: 1.0, gap: 0, rest: 0.6,
      band: 500, q: 0.8, inspGain: 0.4, expGain: 0.12,
      wheezeHz: [420], wheezePhase: "insp", wheezeGain: 0.34
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

  /* play(kind, opts) -> { stop, cycle, spec }
   * opts.breaths (default 3), opts.slow (stretches everything, for learning the timing),
   * opts.onEnd, opts.onPhase(name) so the UI can show which phase is sounding. */
  function play(kind, opts) {
    opts = opts || {};
    var spec = KINDS[kind];
    var c = unlock();
    if (!spec || !c) return null;

    stopAll();

    var s = {}, key;
    for (key in spec) if (Object.prototype.hasOwnProperty.call(spec, key)) s[key] = spec[key];
    if (opts.slow) { s.insp *= 1.6; s.exp *= 1.6; s.gap = (s.gap || 0) * 1.6; s.rest *= 1.2; }

    var master = c.createGain();
    master.gain.value = typeof opts.volume === "number" ? opts.volume : 0.9;
    master.connect(c.destination);

    var breaths = opts.breaths || 3;
    var t = c.currentTime + 0.08, total = 0, i;
    for (i = 0; i < breaths; i++) {
      var len = scheduleBreath(c, master, s, t + total);
      total += len;
    }

    var timer = null;
    if (opts.onEnd) timer = setTimeout(opts.onEnd, (total + 0.2) * 1000);

    var handle = {
      cycle: s.insp + (s.gap || 0) + s.exp + s.rest,
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
