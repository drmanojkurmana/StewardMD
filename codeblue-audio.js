/* codeblue-audio.js: Code Blue live code audio engine (web: Web Audio plus speechSynthesis).
 * Vanilla JS, no framework, fully offline. Exposes window.CodeBlueAudio.
 * Metronome 110 per minute, 25 ms 1 kHz ticks scheduled with lookahead so the
 * beat does not drift. Breath ticks at 600 Hz. Voice cues use speechSynthesis
 * with the exact contract phrases. Voice, Metronome and Breaths mute
 * independently. The tick ducks 6 dB while voice plays, never the other way.
 * Audio starts only after a user tap (unlock on Start). Graceful no-audio
 * fallback when Web Audio or speech is missing. Also owns the screen wake
 * lock while a code runs (rejection tolerated, released on end).
 * No doses anywhere. British spelling. Plain punctuation throughout.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CodeBlueAudio = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var METRONOME_BPM = 110;
  var TICK_HZ = 1000;
  var TICK_MS = 25;
  var BREATH_HZ = 600;
  var LOOKAHEAD_MS = 120;
  var TIMER_MS = 25;

  /* Exact voice phrases from the design contract. */
  var PHRASES = {
    rhythmSoon: "Rhythm check in ten seconds",
    rhythmDue: "Rhythm check. Switch compressor",
    epiDue: "Epinephrine due",
    epiOverdue: "Epinephrine overdue",
    shockLogged: "Shock logged",
    roscLogged: "ROSC logged",
    breath: "Give breath",
    twoBreaths: "Two breaths"
  };

  var state = {
    ctx: null,
    master: null,
    tickGain: null,
    unlocked: false,
    blocked: false,
    metronomeOn: false,
    nextTickAt: 0,
    schedTimer: null,
    breathTimer: null,
    voiceOn: true,
    metroMuted: false,
    breathMuted: false,
    speaking: false,
    metroBpm: 110, voiceRate: 1, lowAlert: true,
    wakeLock: null,
    overdueTonePlayed: false,
    native: false, nativePending: false, breathInterval: 6
  };

  function nativePlugin() {
    try {
      if (typeof window === "undefined" || !window.Capacitor) return null;
      var C = window.Capacitor;
      var isNative = (typeof C.isNativePlatform === "function") ? C.isNativePlatform() : false;
      if (!isNative) return null;
      return (C.Plugins && C.Plugins.WatchBridge) || null;
    } catch (e) { return null; }
  }
  function ncall(method, args) {
    var p = nativePlugin();
    if (!p || typeof p[method] !== "function") return null;
    try { var r = p[method](args); if (r && typeof r.catch === "function") r.catch(function () {}); return r; } catch (e) { return null; }
  }
  function nativeActive() { return state.native === true; }
  function pushNativeConfig() { ncall("audioConfigure", { bpm: state.metroBpm, voiceRate: state.voiceRate, lowAlert: state.lowAlert }); }
  function pushNativeMutes() { ncall("audioMutes", mutes()); }

  function hasWindow() { return typeof window !== "undefined"; }

  function audioAvailable() {
    if (!hasWindow()) return false;
    try {
      return !!(window.AudioContext || window.webkitAudioContext);
    } catch (e) { return false; }
  }

  function speechAvailable() {
    if (!hasWindow()) return false;
    try {
      return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    } catch (e) { return false; }
  }

  function ensureCtx() {
    if (state.ctx) return state.ctx;
    if (!audioAvailable()) return null;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      state.ctx = new AC();
      state.master = state.ctx.createGain();
      state.master.gain.value = 1;
      state.master.connect(state.ctx.destination);
      state.tickGain = state.ctx.createGain();
      state.tickGain.gain.value = 1;
      state.tickGain.connect(state.master);
    } catch (e) {
      state.ctx = null;
      state.blocked = true;
    }
    return state.ctx;
  }

  /* Must be called from a user tap (Start). Resumes a suspended context.
   * Native: audioBegin() decides; only active:true switches to native. */
  function unlock() {
    var p = nativePlugin();
    if (p && typeof p.audioBegin === "function") {
      state.nativePending = true;
      var self = this;
      var promise;
      try { promise = p.audioBegin(); } catch (e) { promise = null; }
      if (promise && typeof promise.then === "function") {
        return promise.then(function (res) {
          state.nativePending = false;
          if (res && res.active === true) {
            state.native = true; state.unlocked = true; state.blocked = false;
            pushNativeConfig(); pushNativeMutes();
            if (state.metronomeOn) ncall("audioMetronome", { on: true });
            if (state._wantBreaths) ncall("audioBreaths", { on: true, intervalSeconds: state.breathInterval || 6 });
            return true;
          }
          state.native = false;
          return unlockWeb();
        }, function () { state.nativePending = false; state.native = false; return unlockWeb(); });
      }
      state.nativePending = false;
    }
    return unlockWeb();
  }
  function unlockWeb() {
    var ctx = ensureCtx();
    if (!ctx) {
      /* No Web Audio here: voice may still work, or nothing plays. */
      state.unlocked = speechAvailable();
      state.blocked = !state.unlocked && !speechAvailable();
      return state.unlocked;
    }
    try {
      if (ctx.state === "suspended") {
        if (ctx.resume) ctx.resume();
      }
      state.unlocked = true;
      state.blocked = false;
    } catch (e) {
      state.blocked = true;
    }
    return state.unlocked;
  }

  function status() {
    if (state.native) return "ok";
    if (!audioAvailable() && !speechAvailable()) return "unavailable";
    if (!state.unlocked) return "blocked";
    return "ok";
  }

  function blip(hz, ms, when, peak) {
    var ctx = state.ctx;
    if (!ctx || !state.tickGain) return;
    try {
      var t = when || ctx.currentTime;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak || 0.5, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(g);
      g.connect(state.tickGain);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.05);
    } catch (e) {}
  }

  function beatInterval() { return 60 / (state.metroBpm || METRONOME_BPM); }
  function setMetronomeBpm(bpm) { var n = Number(bpm); if (isFinite(n)) state.metroBpm = Math.max(100, Math.min(120, Math.round(n))); if (state.native) pushNativeConfig(); return state.metroBpm; }
  function setVoiceRate(r) { var n = Number(r); if (isFinite(n)) state.voiceRate = Math.max(0.5, Math.min(1.5, n)); if (state.native) pushNativeConfig(); return state.voiceRate; }
  function setLowAlert(on) { state.lowAlert = on !== false; if (state.native) pushNativeConfig(); return state.lowAlert; }
  function setCues(list) {
    if (!state.native) return false;
    var cues = (Array.isArray(list) ? list : []).slice(0, 64).map(function (c) {
      var o = { atMs: Number(c && c.atMs) }; if (c && c.speak) o.speak = String(c.speak).slice(0, 80); if (c && c.tone) o.tone = String(c.tone); return o;
    }).filter(function (c) { return isFinite(c.atMs); });
    ncall("audioSetCues", { cues: cues });
    return true;
  }

  function scheduleAhead() {
    var ctx = state.ctx;
    if (!ctx || !state.metronomeOn) return;
    try {
      var horizon = ctx.currentTime + LOOKAHEAD_MS / 1000;
      while (state.nextTickAt < horizon) {
        if (state.nextTickAt >= ctx.currentTime - 0.01) blip(TICK_HZ, TICK_MS, state.nextTickAt);
        state.nextTickAt += beatInterval();
      }
    } catch (e) {}
  }

  function startMetronome() {
    if (state.native) { state.metronomeOn = true; ncall("audioMetronome", { on: true }); return true; }
    if (state.nativePending) { state.metronomeOn = true; return true; }
    if (state.metronomeOn) return true;
    var ctx = ensureCtx();
    if (!ctx || !state.unlocked) return false;
    state.metronomeOn = true;
    try {
      state.nextTickAt = Math.max(ctx.currentTime + 0.02, state.nextTickAt || 0);
      if (state.nextTickAt < ctx.currentTime) state.nextTickAt = ctx.currentTime + 0.02;
    } catch (e) {}
    if (state.schedTimer) { try { clearInterval(state.schedTimer); } catch (e2) {} }
    state.schedTimer = setInterval(scheduleAhead, TIMER_MS);
    scheduleAhead();
    return true;
  }

  function stopMetronome() {
    if (state.native) ncall("audioMetronome", { on: false });
    state.metronomeOn = false;
    if (state.schedTimer) { try { clearInterval(state.schedTimer); } catch (e) {} }
    state.schedTimer = null;
  }

  function breathTick() {
    if (state.native) { if (state.unlocked && !state.breathMuted) ncall("audioTone", { kind: "breath" }); return; }
    if (state.nativePending) return;
    var ctx = state.ctx;
    if (!ctx || !state.unlocked || state.breathMuted) return;
    blip(BREATH_HZ, 60, 0, 0.3);
  }

  /* One soft tick every 6 s for an advanced airway. Caller starts/stops. */
  function startBreathTicks(intervalSeconds) {
    if (state.native || state.nativePending) {
      state.breathInterval = Number(intervalSeconds) > 0 ? Number(intervalSeconds) : 6;
      state._wantBreaths = true;
      if (state.native) ncall("audioBreaths", { on: true, intervalSeconds: state.breathInterval });
      return;
    }
    stopBreathTicks();
    state.breathTimer = setInterval(breathTick, 6000);
  }

  function stopBreathTicks() {
    state._wantBreaths = false;
    if (state.native) ncall("audioBreaths", { on: false, intervalSeconds: state.breathInterval || 6 });
    if (state.breathTimer) { try { clearInterval(state.breathTimer); } catch (e) {} }
    state.breathTimer = null;
  }

  /* Neonatal 3:1 three-count tick: three soft ticks now. */
  function threeCount() {
    if (state.native) { if (state.unlocked && !state.breathMuted) ncall("audioTone", { kind: "threeCount" }); return; }
    if (state.nativePending) return;
    var ctx = state.ctx;
    if (!ctx || !state.unlocked || state.breathMuted) return;
    try {
      var t = ctx.currentTime + 0.01;
      blip(BREATH_HZ, 50, t, 0.3);
      blip(BREATH_HZ, 50, t + 0.18, 0.3);
      blip(TICK_HZ, 60, t + 0.36, 0.35);
    } catch (e) {}
  }

  /* One distinct two-tone for overdue epinephrine. Played once per code. */
  function overdueTone() {
    if (state.native) {
      if (state.lowAlert === false || state.overdueTonePlayed) return;
      state.overdueTonePlayed = true; ncall("audioTone", { kind: "overdue" }); return;
    }
    if (state.nativePending) return;
    var ctx = state.ctx;
    if (state.lowAlert === false) return;
    if (!ctx || !state.unlocked || state.overdueTonePlayed) return;
    state.overdueTonePlayed = true;
    try {
      var t = ctx.currentTime + 0.01;
      blip(660, 140, t, 0.5);
      blip(520, 180, t + 0.18, 0.5);
    } catch (e) {}
  }

  function resetOverdueTone() { state.overdueTonePlayed = false; if (state.native) ncall("audioTone", { kind: "resetOverdue" }); }

  function pickVoice() {
    try {
      var synth = window.speechSynthesis;
      if (!synth || !synth.getVoices) return null;
      var vs = synth.getVoices() || [];
      for (var i = 0; i < vs.length; i++) {
        var lg = String(vs[i].lang || "").toLowerCase();
        if (lg.indexOf("en-gb") === 0 || lg.indexOf("en-in") === 0) return vs[i];
      }
    } catch (e) {}
    return null;
  }

  function duck(on) {
    try {
      if (!state.ctx || !state.tickGain) return;
      var t = state.ctx.currentTime;
      state.tickGain.gain.cancelScheduledValues(t);
      /* 6 dB duck is a factor of 0.5 in amplitude. */
      state.tickGain.gain.setTargetAtTime(on ? 0.5 : 1, t, 0.03);
    } catch (e) {}
  }

  /* Speak an exact contract phrase. key is a PHRASES key. No-op when muted. */
  function speak(key) {
    var text = PHRASES[key];
    if (!text || !state.voiceOn || !state.unlocked) return false;
    if (state.native) { ncall("audioSpeak", { text: String(text).slice(0, 80) }); return true; }
    if (state.nativePending) return false;
    if (!speechAvailable()) return false;
    try {
      var synth = window.speechSynthesis;
      try { if (synth.pending || synth.speaking) synth.cancel(); } catch (e) {}
      var u = new window.SpeechSynthesisUtterance(text);
      u.lang = "en-GB";
      var v = pickVoice();
      if (v) u.voice = v;
      u.rate = state.voiceRate || 1;
      u.volume = 1;
      state.speaking = true;
      duck(true);
      u.onend = function () { state.speaking = false; duck(false); };
      u.onerror = function () { state.speaking = false; duck(false); };
      synth.speak(u);
      return true;
    } catch (e) {
      state.speaking = false;
      try { duck(false); } catch (e2) {}
      return false;
    }
  }

  function cancelSpeech() {
    if (state.native) { state.speaking = false; return; }
    try {
      if (hasWindow() && window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {}
    state.speaking = false;
    duck(false);
  }

  function setMuted(which, muted) {
    if (which === "voice") {
      state.voiceOn = !muted;
      if (muted) cancelSpeech();
    } else if (which === "metronome") {
      state.metroMuted = !!muted;
      if (state.metroMuted) stopMetronome();
    } else if (which === "breaths") {
      state.breathMuted = !!muted;
    }
    if (state.native) pushNativeMutes();
    return mutes();
  }

  function mutes() {
    return { voice: !state.voiceOn, metronome: state.metroMuted, breaths: state.breathMuted };
  }

  function isMetroAudible() {
    if (state.native) return state.metronomeOn && !state.metroMuted && state.unlocked;
    return state.metronomeOn && !state.metroMuted && state.unlocked && !!state.ctx;
  }

  function ensureWakeLock() {
    try {
      if (!hasWindow() || !navigator.wakeLock || !navigator.wakeLock.request) return false;
      navigator.wakeLock.request("screen").then(function (lock) {
        state.wakeLock = lock;
        try {
          lock.addEventListener("release", function () { state.wakeLock = null; });
        } catch (e) {}
      }, function () { state.wakeLock = null; });
      return true;
    } catch (e) { return false; }
  }

  function releaseWakeLock() {
    try {
      if (state.wakeLock && state.wakeLock.release) state.wakeLock.release();
    } catch (e) {}
    state.wakeLock = null;
  }

  function shutdown() {
    var wasNative = state.native;
    stopMetronome();
    stopBreathTicks();
    cancelSpeech();
    if (wasNative) { ncall("audioSetCues", { cues: [] }); ncall("audioEnd"); state.native = false; }
    releaseWakeLock();
  }

  function _reset() {
    shutdown();
    state.ctx = null; state.master = null; state.tickGain = null;
    state.unlocked = false; state.blocked = false;
    state.voiceOn = true; state.metroMuted = false; state.breathMuted = false;
    state.speaking = false; state.nextTickAt = 0; state.overdueTonePlayed = false; state.metroBpm = 110; state.voiceRate = 1; state.lowAlert = true;
    state.native = false; state.nativePending = false; state.breathInterval = 6; state.metronomeOn = false;
  }

  return {
    PHRASES: PHRASES,
    METRONOME_BPM: METRONOME_BPM, TICK_HZ: TICK_HZ, TICK_MS: TICK_MS,
    audioAvailable: audioAvailable, speechAvailable: speechAvailable,
    unlock: unlock, status: status,
    startMetronome: startMetronome, stopMetronome: stopMetronome,
    isMetroAudible: isMetroAudible,
    startBreathTicks: startBreathTicks, stopBreathTicks: stopBreathTicks,
    breathTick: breathTick, threeCount: threeCount,
    overdueTone: overdueTone, resetOverdueTone: resetOverdueTone,
    speak: speak, cancelSpeech: cancelSpeech,
    setMuted: setMuted, mutes: mutes, setMetronomeBpm: setMetronomeBpm, setVoiceRate: setVoiceRate, setLowAlert: setLowAlert,
    metronomeBpm: function () { return state.metroBpm || METRONOME_BPM; }, voiceRate: function () { return state.voiceRate || 1; }, lowAlert: function () { return state.lowAlert !== false; },
    ensureWakeLock: ensureWakeLock, releaseWakeLock: releaseWakeLock,
    nativeActive: nativeActive, setCues: setCues,
    shutdown: shutdown, _reset: _reset
  };
});
