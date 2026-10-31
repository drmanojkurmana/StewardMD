/* PrepNucleus Sound first-party player (rs-sound, Phase 2): ambient and white-noise
   ONLY, generated in-browser with WebAudio — no files, no downloads, no
   copyrighted audio, no paid services. window.PREP_SOUND_WEB. ES5.
   Loaded by prep-loader.js after prep-sound-providers.js (optional: without it
   nothing changes). Pure synth parameters run under node for tests; the browser
   player no-ops cleanly without AudioContext.

   Loudness contract: every track peaks low (validateSynth caps peak gain at 0.2);
   playback starts only from an explicit user tap (the controller never autostarts);
   Media Session exposes this app's own audio only, never another app's. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  /* Per-track synthesis recipes. noise seconds loop seamlessly (looped buffers);
     pad oscillators run continuously; LFOs are periodic, so nothing clicks. */
  var TRACK_SYNTH = {
    rain_soft: { noise: { color: "white", filter: { type: "bandpass", freq: 2200, Q: 0.6 }, gain: 0.10 },
      pad: null, lfo: { rate: 0.13, depth: 0.035, target: "gain" } },
    night_quiet: { noise: { color: "white", filter: { type: "lowpass", freq: 420, Q: 0.4 }, gain: 0.07 },
      pad: null, lfo: null },
    deep_drone: { noise: { color: "pink", filter: { type: "lowpass", freq: 300, Q: 0.4 }, gain: 0.05 },
      pad: [{ freq: 55, gain: 0.05, type: "sine" }, { freq: 82.5, gain: 0.03, type: "sine" }], lfo: { rate: 0.07, depth: 0.02, target: "gain" } },
    ocean_slow: { noise: { color: "pink", filter: { type: "lowpass", freq: 900, Q: 0.5 }, gain: 0.09 },
      pad: null, lfo: { rate: 0.1, depth: 320, target: "filterFreq" } }
  };
  function validateSynth(id, s) {
    var errs = [];
    if (!s || typeof s !== "object") return ["synth-missing:" + id];
    var n = s.noise || {};
    if (n.color !== "white" && n.color !== "pink") errs.push("noise-color:" + id);
    if (!n.filter || (n.filter.type !== "lowpass" && n.filter.type !== "bandpass")) errs.push("filter:" + id);
    if (!(n.filter.freq >= 40 && n.filter.freq <= 12000)) errs.push("filter-freq:" + id);
    if (!(n.gain > 0 && n.gain <= 0.2)) errs.push("gain:" + id);
    (s.pad || []).forEach(function (p, i) {
      if (!(p.freq >= 30 && p.freq <= 2000)) errs.push("pad-freq:" + id + ":" + i);
      if (!(p.gain > 0 && p.gain <= 0.2)) errs.push("pad-gain:" + id + ":" + i);
    });
    if (s.lfo) {
      if (!(s.lfo.rate > 0 && s.lfo.rate <= 1)) errs.push("lfo-rate:" + id);
      if (!(s.lfo.depth > 0)) errs.push("lfo-depth:" + id);
      if (s.lfo.target !== "gain" && s.lfo.target !== "filterFreq") errs.push("lfo-target:" + id);
      if (s.lfo.target === "gain" && s.lfo.depth >= n.gain) errs.push("lfo-clip:" + id);
    }
    return errs;
  }
  function validateAll() { var errs = []; Object.keys(TRACK_SYNTH).forEach(function (id) { validateSynth(id, TRACK_SYNTH[id]).forEach(function (e) { errs.push(e); }); }); return errs; }

  var PURE = { TRACK_SYNTH: TRACK_SYNTH, validateSynth: validateSynth, validateAll: validateAll };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var ctx = null, live = null, noiseCache = {};
  function ac() {
    if (ctx) return ctx;
    try {
      var Ctor = G.AudioContext || G.webkitAudioContext;
      if (!Ctor) return null;
      try { ctx = new Ctor({ latencyHint: "playback" }); } catch (e1) { ctx = new Ctor(); }
    } catch (e) { return null; }
    return ctx;
  }
  function noiseBuffer(c, color) {
    if (noiseCache[color]) return noiseCache[color];
    var len = Math.floor(c.sampleRate * 2), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0), i;
    if (color === "pink") { /* Paul Kellet's refined pink-noise filter, steady-state after a warm-up */
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (i = 0; i < len + 2000; i++) {
        var w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        var v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
        if (i >= 2000) d[i - 2000] = v;
      }
    } else { for (i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5; }
    noiseCache[color] = buf;
    return buf;
  }
  function stopLive() {
    if (!live) return;
    try {
      live.nodes.forEach(function (n) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) {} });
      live.master.disconnect();
    } catch (e) {}
    live = null;
  }
  function supported() { return !!(G.AudioContext || G.webkitAudioContext); }
  function isPlaying() { return !!live; }
  function current() { return live ? live.track : null; }

  /* Start (or restart) a track. Must be called from a user gesture; resumes a
     suspended context first. Returns { ok } / { ok:false, error }. */
  function start(trackId, volume) {
    var recipe = TRACK_SYNTH[trackId];
    if (!recipe) return { ok: false, error: "unknown-track" };
    var c = ac();
    if (!c) return { ok: false, error: "unavailable:webaudio" };
    try {
      if (c.state === "suspended") c.resume();
      stopLive();
      var master = c.createGain();
      master.gain.value = volume == null ? 0.8 : Math.max(0, Math.min(1, volume));
      master.connect(c.destination);
      var nodes = [];
      var src = c.createBufferSource();
      src.buffer = noiseBuffer(c, recipe.noise.color); src.loop = true;
      var f = c.createBiquadFilter();
      f.type = recipe.noise.filter.type; f.frequency.value = recipe.noise.filter.freq; f.Q.value = recipe.noise.filter.Q;
      var g = c.createGain(); g.gain.value = recipe.noise.gain;
      src.connect(f); f.connect(g); g.connect(master); src.start();
      nodes.push(src);
      (recipe.pad || []).forEach(function (p) {
        var o = c.createOscillator(), og = c.createGain();
        o.type = p.type; o.frequency.value = p.freq; og.gain.value = p.gain;
        o.connect(og); og.connect(master); o.start();
        nodes.push(o);
      });
      if (recipe.lfo) {
        var lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = recipe.lfo.rate; lg.gain.value = recipe.lfo.depth;
        lfo.connect(lg);
        lg.connect(recipe.lfo.target === "filterFreq" ? f.frequency : g.gain);
        lfo.start();
        nodes.push(lfo);
      }
      live = { track: trackId, master: master, nodes: nodes };
      mediaMeta(trackId, true);
      return { ok: true };
    } catch (e) { stopLive(); return { ok: false, error: "unavailable:start-failed" }; }
  }
  function pause() { stopLive(); mediaMeta(null, false); return { ok: true }; }
  function stop() { return pause(); }
  function setVolume(v) {
    if (!live) return { ok: false, error: "not-playing" };
    try { live.master.gain.value = Math.max(0, Math.min(1, v)); return { ok: true }; }
    catch (e) { return { ok: false, error: "unavailable:volume" }; }
  }
  /* Media Session: this app's own audio only. Handlers are wired by the controller. */
  function mediaMeta(trackId, playing) {
    try {
      var C = CORE();
      var nav = G.navigator;
      if (!nav || !nav.mediaSession) return;
      if (!trackId) { try { nav.mediaSession.metadata = null; } catch (e) {} return; }
      var t = C && C.trackById(trackId);
      try {
        nav.mediaSession.metadata = new G.MediaMetadata({
          title: t ? t.title : trackId, artist: "PrepNucleus Sound · original", album: "Focus ambience"
        });
      } catch (e) {}
    } catch (e) {}
  }
  function bindMediaKeys(handlers) {
    try {
      var ms = G.navigator && G.navigator.mediaSession;
      if (!ms || !ms.setActionHandler) return;
      ["play", "pause", "stop"].forEach(function (k) {
        try { ms.setActionHandler(k, handlers[k] || null); } catch (e) {}
      });
    } catch (e) {}
  }
  function CORE() { try { return G.PREP_SOUND_CORE || null; } catch (e) { return null; } }

  G.PREP_SOUND_WEB = { start: start, pause: pause, stop: stop, setVolume: setVolume,
    isPlaying: isPlaying, current: current, supported: supported,
    TRACK_SYNTH: TRACK_SYNTH, validateSynth: validateSynth, validateAll: validateAll, _pure: PURE, bindMediaKeys: bindMediaKeys };
})(typeof window !== "undefined" ? window : this);
