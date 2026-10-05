/* Audio: an original generative Carnatic-style instrumental in Raga Mohanam
   (tanpura drone, plucked veena phrases with gamakas, bansuri, soft mridangam, temple bells),
   synthesized with Web Audio. Nothing plays until the guest opens the invitation.
   If VK.soundtrackUrl is set, that licensed recording replaces the generated music. */
(function () {
  "use strict";
  var VK = (window.VK = window.VK || {});
  var A = (VK.audio = { ready: false, on: false });

  var AC = window.AudioContext || window.webkitAudioContext;
  A.supported = !!AC;

  var ctx, master, comp, musicBus, sfxBus, revIn, reverb, revOut;
  var enabled = true, started = false, tick = null, hiddenTimer = null;
  var VOL = 0.72;
  var scene = "opening";
  var media = null;

  /* ── tuning: Sa = D (146.83 Hz); Mohanam = S R2 G3 P D2 ── */
  var SA = 146.83, MEL = SA * 2;
  var RATIO = [0.75, 5 / 6, 1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2];
  // indices: 0 P_, 1 D_, 2 S, 3 R, 4 G, 5 P, 6 D, 7 S', 8 R', 9 G'
  var PHRASES = [
    [[4, 1], [3, .5], [2, .5], [3, 1], [4, 2]],
    [[4, .5], [5, .5], [6, 1], [5, .5], [4, .5], [5, 2]],
    [[7, 1.5], [6, .5], [5, 1], [4, 1], [3, 1], [2, 2]],
    [[2, .5], [3, .5], [4, .5], [5, .5], [6, 1], [7, 2]],
    [[6, .5], [7, .5], [8, 1], [7, .5], [6, .5], [5, 2]],
    [[5, 1], [4, .5], [5, .5], [6, 1], [5, 1], [4, 2]],
    [[9, 1], [8, .5], [7, .5], [6, 1], [7, .5], [6, .5], [5, 2]],
    [[4, 1.5], [5, .5], [4, .5], [3, .5], [2, 1], [1, .5], [2, 2.5]]
  ];
  var CADENCE = [[1, 1], [2, 1], [3, .5], [4, .5], [3, 1], [2, 3]];
  var SCENES = {
    opening:   { mode: "alap",    tempo: 58, pad: .040, flute: 0,   mrdangam: 0 },
    title:     { mode: "alap",    tempo: 58, pad: .045, flute: 0,   mrdangam: 0 },
    couple:    { mode: "phrases", tempo: 62, pad: .040, flute: 0,   mrdangam: 0 },
    muhurtham: { mode: "phrases", tempo: 62, pad: .045, flute: .6,  mrdangam: 0 },
    journey:   { mode: "alap",    tempo: 60, pad: .060, flute: .8,  mrdangam: 0 },
    reception: { mode: "phrases", tempo: 72, pad: .035, flute: .3,  mrdangam: 1 },
    lamps:     { mode: "phrases", tempo: 60, pad: .045, flute: .5,  mrdangam: 0 },
    finale:    { mode: "alap",    tempo: 56, pad: .050, flute: .4,  mrdangam: 0 }
  };

  /* ── helpers ── */
  function now() { return ctx.currentTime; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function noiseBuffer(sec) {
    var len = Math.max(1, (ctx.sampleRate * sec) | 0), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  var NOISE = null;

  function makeImpulse(sec, decay) {
    var sr = ctx.sampleRate, len = (sr * sec) | 0, b = ctx.createBuffer(2, len, sr);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c), lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len, n = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        lp = lp + (n - lp) * (0.35 - 0.25 * t); // darker tail
        d[i] = lp;
      }
    }
    return b;
  }

  /* ── Karplus-Strong plucked string (veena) ── */
  var pluckCache = {};
  function pluck(freq) {
    var key = Math.round(freq * 10);
    if (pluckCache[key]) return pluckCache[key];
    var sr = ctx.sampleRate, P = Math.max(2, Math.round(sr / freq)), dur = 3.4, N = (sr * dur) | 0;
    var b = ctx.createBuffer(1, N, sr), y = b.getChannelData(0);
    var pickPos = Math.max(1, Math.round(P / 5)), prev = 0;
    for (var i = 0; i < P; i++) {
      var r = Math.random() * 2 - 1; prev = prev * 0.45 + r * 0.55; y[i] = prev;
    }
    for (i = P - 1; i >= pickPos; i--) y[i] = y[i] - y[i - pickPos] * 0.9; // pick-position comb
    var loss = 0.9988 - Math.min(0.002, freq / 600000);
    for (i = P; i < N; i++) y[i] = loss * 0.5 * (y[i - P] + y[i - P - 1 < 0 ? 0 : i - P - 1]);
    var peak = 0;
    for (i = 0; i < N; i++) { y[i] = Math.tanh(y[i] * 1.6); if (Math.abs(y[i]) > peak) peak = Math.abs(y[i]); }
    for (i = 0; i < N; i++) y[i] /= (peak || 1);
    var res = { buf: b, rate: freq / (sr / P) };
    pluckCache[key] = res;
    return res;
  }

  /* ── tanpura: additive string with jawari-like harmonic bloom, rendered offline once ── */
  var tanpura = {};
  function renderTanpura(freq) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var sr = ctx.sampleRate, len = (sr * 5.6) | 0;
    if (!OAC) return Promise.resolve(null);
    var oc = new OAC(1, len, sr), out = oc.createGain();
    out.gain.value = 0.22; out.connect(oc.destination);
    for (var n = 1; n <= 18; n++) {
      var o = oc.createOscillator(), g = oc.createGain();
      o.frequency.value = freq * n * (1 + 0.00035 * n * n);
      var tp = 0.012 + 0.055 * Math.pow(n, 0.9);
      var amp = (1 / Math.pow(n, 0.85)) * (n >= 5 && n <= 14 ? 1.55 : 1);
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(amp * 0.6, 0.006);
      g.gain.linearRampToValueAtTime(amp, tp);
      g.gain.setTargetAtTime(0, tp, 1.9 / (1 + n * 0.06));
      o.connect(g); g.connect(out); o.start(0); o.stop(5.6);
    }
    return new Promise(function (resolve) {
      var p = oc.startRendering(function (buf) { resolve(buf); });
      if (p && p.then) p.then(resolve, function () { resolve(null); });
    });
  }

  /* ── voices ── */
  function connectVoice(node, send) {
    node.connect(musicBus);
    if (send) { var s = ctx.createGain(); s.gain.value = send; node.connect(s); s.connect(revIn); }
  }

  function veena(idx, t, beats, slideFrom, vel) {
    var freq = MEL * RATIO[idx], p = pluck(freq);
    var src = ctx.createBufferSource(), g = ctx.createGain(), body = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
    src.buffer = p.buf;
    var r = p.rate;
    if (slideFrom != null && slideFrom !== idx) {
      var from = r * RATIO[slideFrom] / RATIO[idx];
      src.playbackRate.setValueAtTime(from, t);
      src.playbackRate.setValueAtTime(from, t + 0.05);
      src.playbackRate.exponentialRampToValueAtTime(r, t + 0.19);
    } else {
      src.playbackRate.setValueAtTime(r, t);
    }
    // kampita: gentle oscillation on long G / D notes
    if (beats >= 2 && (idx === 4 || idx === 6) && Math.random() < 0.55) {
      var up = r * 1.03, t0 = t + 0.45;
      for (var k = 0; k < 3; k++) {
        src.playbackRate.setTargetAtTime(up, t0 + k * 0.36, 0.06);
        src.playbackRate.setTargetAtTime(r, t0 + k * 0.36 + 0.18, 0.06);
      }
    }
    body.type = "peaking"; body.frequency.value = 260; body.Q.value = 0.9; body.gain.value = 4;
    lp.type = "lowpass"; lp.frequency.value = 3600; lp.Q.value = 0.5;
    var v = (vel || 1) * 0.26, len = Math.min(3.3, beats * 60 / SCENES[scene].tempo + 1.6);
    g.gain.setValueAtTime(v, t);
    g.gain.setTargetAtTime(0, t + len - 0.4, 0.18);
    src.connect(body); body.connect(lp); lp.connect(g);
    connectVoice(g, 0.32);
    src.start(t); src.stop(t + len + 0.6);
  }

  function flute(idx, t, dur, level) {
    var f = MEL * RATIO[idx] * (idx <= 6 ? 2 : 1);
    var o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain();
    var lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    o.type = "sine"; o2.type = "triangle"; o.frequency.value = f; o2.frequency.value = f;
    g2.gain.value = 0.18;
    lfo.frequency.value = 5.1; lfoG.gain.setValueAtTime(0, t); lfoG.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(1.2, dur * .6));
    lfo.connect(lfoG); lfoG.connect(o.frequency); lfoG.connect(o2.frequency);
    var br = ctx.createBufferSource(), bf = ctx.createBiquadFilter(), bg = ctx.createGain();
    br.buffer = NOISE; br.loop = true; bf.type = "bandpass"; bf.frequency.value = f * 1.5; bf.Q.value = 2.5; bg.gain.value = 0.25;
    var peak = 0.05 * level;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.35);
    g.gain.setValueAtTime(peak, t + Math.max(0.4, dur - 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.8);
    o.connect(g); o2.connect(g2); g2.connect(g); br.connect(bf); bf.connect(bg); bg.connect(g);
    connectVoice(g, 0.5);
    [o, o2, lfo, br].forEach(function (n) { n.start(t); n.stop(t + dur + 1); });
  }

  function thom(t, v) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(108, t); o.frequency.exponentialRampToValueAtTime(68, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); connectVoice(g, 0.15); o.start(t); o.stop(t + 0.5);
  }
  function nam(t, v) {
    var o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.value = SA * 2.25; o2.type = "sine"; o2.frequency.value = SA * 4.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g); o2.connect(g);
    var n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = NOISE; nf.type = "bandpass"; nf.frequency.value = 2400; nf.Q.value = 1.2;
    ng.gain.setValueAtTime(0.06 * v, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    n.connect(nf); nf.connect(ng); ng.connect(g);
    connectVoice(g, 0.2);
    o.start(t); o2.start(t); n.start(t, Math.random()); o.stop(t + 0.45); o2.stop(t + 0.45); n.stop(t + 0.05);
  }

  /* ── bells & effects (sfx bus) ── */
  function bellAt(t, f, level, short) {
    var P = short ? [[1, 1, .9], [2.76, .4, .5], [5.4, .2, .3]] :
      [[1, 1, 4.2], [2.0, .45, 2.6], [2.76, .5, 2.2], [4.07, .25, 1.4], [5.43, .18, 1], [6.8, .1, .7]];
    var out = ctx.createGain(); out.gain.value = level;
    out.connect(sfxBus);
    var s = ctx.createGain(); s.gain.value = 0.45; out.connect(s); s.connect(revIn);
    P.forEach(function (p) {
      [1, 1.0028].forEach(function (det, j) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f * p[0] * det;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(p[1] * (j ? .5 : 1) * 0.5, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + p[2] + 0.05);
      });
    });
  }
  function noiseBurst(t, dur, f0, f1, q, level, dest) {
    var n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = NOISE; f.type = "bandpass"; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(dest || sfxBus);
    n.start(t, Math.random() * 1.5); n.stop(t + dur + 0.05);
  }

  /* ── sequencer ── */
  var nextDrone = 0, droneStep = 0, nextNote = 0, queue = [], phraseCount = 0, lastPhrase = -1, prevIdx = 2;
  var nextMr = 0, mrStep = 0, padNodes = null;
  var MR = "T.n.Tnn.T.n.T.nn"; // sparse eighths, soft

  function fillQueue() {
    var s = SCENES[scene];
    if (s.mode === "alap") {
      var idx = pick([2, 4, 5, 6, 7, 5, 4]);
      queue.push({ idx: idx, beats: rnd(3, 5), slide: Math.random() < 0.5 ? (idx > 2 ? idx - 1 : null) : null, vel: 0.85 });
      queue.push({ rest: rnd(2, 4) });
    } else {
      var pi;
      do { pi = (Math.random() * PHRASES.length) | 0; } while (pi === lastPhrase);
      lastPhrase = pi;
      var ph = ++phraseCount % 4 === 0 ? CADENCE : PHRASES[pi];
      ph.forEach(function (n, i) {
        var slide = null;
        if (n[1] >= 1 && i > 0 && Math.random() < 0.45) slide = ph[i - 1][0];
        queue.push({ idx: n[0], beats: n[1], slide: slide, vel: i === 0 ? 1 : 0.82 });
      });
      queue.push({ rest: pick([1, 1.5, 2]) });
    }
  }

  function schedule() {
    var horizon = now() + 0.45, s = SCENES[scene], beat = 60 / s.tempo;
    // tanpura cycle: Pa . Sa . Sa . Sa(low)
    while (nextDrone < horizon) {
      var which = droneStep % 4, buf = which === 0 ? tanpura.pa : which === 3 ? tanpura.low : tanpura.sa;
      if (buf) {
        var src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf; g.gain.value = which === 3 ? 0.42 : 0.5;
        src.connect(g); connectVoice(g, 0.28);
        src.start(nextDrone + rnd(-0.015, 0.015));
      }
      droneStep++; nextDrone += 1.16;
    }
    // melody
    while (nextNote < horizon) {
      if (!queue.length) fillQueue();
      var n = queue.shift();
      if (n.rest) { nextNote += n.rest * beat; continue; }
      veena(n.idx, nextNote, n.beats, n.slide, n.vel);
      if (s.flute && n.beats >= 2 && Math.random() < s.flute) flute(n.idx, nextNote + 0.05, n.beats * beat, 1);
      prevIdx = n.idx;
      nextNote += n.beats * beat;
    }
    // mridangam (reception only)
    while (nextMr < horizon) {
      var st = s.mrdangam ? MR.charAt(mrStep % MR.length) : ".";
      if (st === "T") thom(nextMr, 0.8); else if (st === "n") nam(nextMr, 0.7);
      mrStep++; nextMr += beat / 2;
    }
  }

  function startPad() {
    var lp = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 620; lp.Q.value = 0.6;
    lfo.frequency.value = 0.06; lfoG.gain.value = 140; lfo.connect(lfoG); lfoG.connect(lp.frequency);
    g.gain.value = 0;
    var oscs = [[SA, -6], [SA, 6], [SA * 1.5, -4], [SA * 1.5, 5], [SA * 2, 3]].map(function (p) {
      var o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = p[0]; o.detune.value = p[1]; o.connect(lp); o.start(); return o;
    });
    lp.connect(g); connectVoice(g, 0.6); lfo.start();
    padNodes = { gain: g, oscs: oscs, lfo: lfo };
    g.gain.setTargetAtTime(SCENES[scene].pad, now(), 2.5);
  }

  /* ── public API ── */
  A.init = function () {
    if (!A.supported || ctx) return !!ctx;
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch (e) {}
    try {
      ctx = new AC({ latencyHint: "playback" });
    } catch (e) {
      try { ctx = new AC(); } catch (e2) { A.supported = false; return false; }
    }
    // iOS silent-switch workaround for older Safari: a muted-length silent media element.
    try {
      if (!navigator.audioSession && /iP(hone|ad|od)/.test(navigator.userAgent)) {
        var el = document.createElement("audio");
        el.setAttribute("x-webkit-airplay", "deny"); el.preload = "auto"; el.loop = true;
        el.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
        var p = el.play(); if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {}
    if (ctx.state === "suspended") ctx.resume();
    master = ctx.createGain(); master.gain.value = 0.0001;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.4;
    musicBus = ctx.createGain(); musicBus.gain.value = 0.85;
    var lowCut = ctx.createBiquadFilter(); lowCut.type = "highpass"; lowCut.frequency.value = 70; lowCut.Q.value = 0.5;
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9;
    revIn = ctx.createGain(); reverb = ctx.createConvolver(); revOut = ctx.createGain(); revOut.gain.value = 0.42;
    NOISE = noiseBuffer(2.5);
    reverb.buffer = makeImpulse(3.2, 2.6);
    revIn.connect(reverb); reverb.connect(revOut); revOut.connect(master);
    musicBus.connect(lowCut); lowCut.connect(master); sfxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
    A.ready = true;
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", function () { if (ctx && ctx.state === "running") ctx.suspend(); });
    return true;
  };

  A.start = function () {
    if (!ctx || started) return;
    started = true;
    A.on = enabled;
    master.gain.setValueAtTime(0.0001, now());
    master.gain.exponentialRampToValueAtTime(enabled ? VOL : 0.0001, now() + 3);
    if (VK.soundtrackUrl) {
      media = new Audio(VK.soundtrackUrl); media.loop = true; media.crossOrigin = "anonymous";
      try { ctx.createMediaElementSource(media).connect(musicBus); } catch (e) {}
      var pr = media.play(); if (pr && pr.catch) pr.catch(function () {});
      return;
    }
    // drone renders first; melody enters after two tanpura cycles
    Promise.all([renderTanpura(SA * 0.75), renderTanpura(SA), renderTanpura(SA / 2)]).then(function (b) {
      tanpura = { pa: b[0], sa: b[1], low: b[2] };
    });
    nextDrone = now() + 0.25; nextNote = now() + 6.5; nextMr = now() + 6.5;
    startPad();
    tick = setInterval(schedule, 90);
  };

  A.setScene = function (name) {
    if (!SCENES[name] || name === scene) return;
    var prev = scene; scene = name;
    if (!ctx || !started) return;
    if (padNodes) padNodes.gain.gain.setTargetAtTime(SCENES[name].pad, now(), 2);
    if (SCENES[prev].mode !== SCENES[name].mode) queue.length = 0;
    if (name === "muhurtham" || name === "reception") A.bell(name === "muhurtham" ? 523 : 659, 0.18);
  };

  A.setEnabled = function (on) {
    enabled = !!on; A.on = enabled;
    if (!ctx) return;
    if (enabled && ctx.state === "suspended") ctx.resume();
    master.gain.cancelScheduledValues(now());
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now());
    master.gain.exponentialRampToValueAtTime(enabled ? VOL : 0.0001, now() + (enabled ? 1.2 : 0.5));
    if (media) { if (enabled) media.play(); else setTimeout(function () { if (!enabled) media.pause(); }, 520); }
  };

  function onVisibility() {
    if (!ctx) return;
    clearTimeout(hiddenTimer);
    if (document.hidden) {
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(0.0001, now(), 0.15);
      hiddenTimer = setTimeout(function () { if (document.hidden) { ctx.suspend(); if (media) media.pause(); } }, 700);
    } else if (enabled) {
      ctx.resume().then(function () {
        // drop anything scheduled in the past while suspended
        nextDrone = Math.max(nextDrone, now() + 0.1); nextNote = Math.max(nextNote, now() + 0.3); nextMr = Math.max(nextMr, now() + 0.3);
        master.gain.cancelScheduledValues(now());
        master.gain.setTargetAtTime(VOL, now(), 0.6);
        if (media) media.play();
      });
    }
  }

  function live() { return ctx && enabled && ctx.state === "running"; }

  A.bell = function (f, level) { if (live()) bellAt(now() + 0.01, f || 587, level || 0.22); };
  A.chime = function (level) {
    if (!live()) return;
    var t = now() + 0.01;
    [MEL * 4, MEL * 4 * 5 / 4, MEL * 4 * 3 / 2].forEach(function (f, i) { bellAt(t + i * 0.09, f, (level || 0.07) * (1 - i * .2), true); });
  };
  A.open = function () {
    if (!live()) return;
    var t = now() + 0.02;
    noiseBurst(t, 1.3, 260, 4200, 0.8, 0.05);
    bellAt(t + 0.15, 587, 0.24);
    bellAt(t + 0.75, 880, 0.12);
  };
  A.patter = function (dur, count) {
    if (!live()) return;
    var t0 = now() + 0.25, out = ctx.createGain(); out.gain.value = 1; out.connect(sfxBus);
    for (var i = 0; i < count; i++) {
      var t = t0 + Math.pow(Math.random(), 0.8) * dur;
      noiseBurst(t, rnd(0.012, 0.03), rnd(3500, 6500), rnd(4000, 8000), 3, rnd(0.008, 0.026), out);
    }
  };
  A.ignite = function (i) {
    if (!live()) return;
    var t = now() + 0.01;
    noiseBurst(t, 0.28, 900, 3200, 1.4, 0.05);
    noiseBurst(t + 0.12, 0.7, 500, 300, 0.7, 0.02);
    bellAt(t + 0.22, MEL * 2 * RATIO[[2, 4, 5, 6, 7][i % 5]], 0.06, true);
  };
  A.knot = function () {
    if (!live()) return;
    var t = now() + 0.01;
    bellAt(t, MEL * 2, 0.08, true); bellAt(t + 0.16, MEL * 3, 0.06, true);
  };
  A.whoosh = function () { if (live()) noiseBurst(now() + 0.01, 1.4, 300, 1800, 0.6, 0.035); };
  A.haptic = function (p) { try { if (navigator.vibrate) navigator.vibrate(p || 10); } catch (e) {} };
})();
