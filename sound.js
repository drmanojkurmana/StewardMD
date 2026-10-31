/* StewardMD — soft interface sounds (window.SMD_SOUND). OFF by default.
 *
 * Quiet, synthesized ticks (Web Audio, no audio files): a bell for an incoming notification, a rising
 * pair for success / task done, a low soft thud for an error, a tick at the pull-to-refresh trigger.
 * Nothing plays unless the doctor turns it on (Settings > Display & Accessibility > Sounds), nothing
 * plays while the app is in the background, and each sound is capped at a whisper.
 *
 *   SMD_SOUND.play("notify" | "success" | "error" | "tick" | "send")
 *   SMD_SOUND.enabled() / .setEnabled(bool) / .supported()
 *
 * Web Audio only starts after a user gesture, so the context is created and resumed on the first
 * touch. Kill switch for the whole module: localStorage smd_sound_module=0. */
(function () {
  "use strict";
  // Each sound: partials [{ f0, f1, t0, d, g, type }] (frequency glides f0->f1; start offset, duration in s; peak gain).
  var SOUNDS = {
    tick:    [{ f0: 1900, f1: 1300, t0: 0, d: 0.03, g: 0.045, type: "sine" }],
    notify:  [{ f0: 988, f1: 988, t0: 0, d: 0.34, g: 0.05, type: "sine" }, { f0: 1319, f1: 1319, t0: 0.03, d: 0.28, g: 0.035, type: "sine" }],
    success: [{ f0: 660, f1: 660, t0: 0, d: 0.1, g: 0.05, type: "triangle" }, { f0: 880, f1: 880, t0: 0.07, d: 0.16, g: 0.05, type: "triangle" }],
    error:   [{ f0: 240, f1: 170, t0: 0, d: 0.17, g: 0.07, type: "triangle" }],
    send:    [{ f0: 520, f1: 780, t0: 0, d: 0.1, g: 0.045, type: "sine" }]
  };
  // An attack/decay gain curve: 4ms in, exponential out, so there is never a click.
  function envelope(peak, dur) { return { attack: 0.004, peak: peak, end: Math.max(0.0001, peak * 0.001), dur: dur }; }
  var seam = { SOUNDS: SOUNDS, envelope: envelope };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined" || window.SMD_SOUND) return;
  try { if (localStorage.getItem("smd_sound_module") === "0") return; } catch (e) {}
  window.SMD_SOUND_SEAM = seam;

  var Ctx = window.AudioContext || window.webkitAudioContext, ctx = null, last = {};
  function enabled() { try { return localStorage.getItem("smd_sound") === "1"; } catch (e) { return false; } }
  // A running AudioContext takes the iOS audio session and pauses Spotify / Apple Music. So: no context unless
  // the doctor turned sounds on, and then an "ambient" session that mixes with their music instead.
  function unlock() {
    if (!Ctx || !enabled()) return;
    try { if (navigator.audioSession && navigator.audioSession.type !== "ambient") navigator.audioSession.type = "ambient"; } catch (e) {}
    try { if (!ctx) ctx = new Ctx(); if (ctx.state === "suspended") ctx.resume(); } catch (e) {}
  }
  ["pointerdown", "touchend", "keydown"].forEach(function (t) { document.addEventListener(t, unlock, { capture: true, passive: true }); });

  function play(name) {
    if (!enabled() || !ctx || ctx.state !== "running" || document.visibilityState === "hidden") return;
    var def = SOUNDS[name]; if (!def) return;
    var now = ctx.currentTime, t = performance.now();
    if (t - (last[name] || 0) < 80) return;   // never a stutter
    last[name] = t;
    def.forEach(function (p) {
      try {
        var o = ctx.createOscillator(), g = ctx.createGain(), e = envelope(p.g, p.d), st = now + p.t0;
        o.type = p.type; o.frequency.setValueAtTime(p.f0, st); o.frequency.exponentialRampToValueAtTime(Math.max(1, p.f1), st + p.d);
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(e.peak, st + e.attack); g.gain.exponentialRampToValueAtTime(e.end, st + p.d);
        o.connect(g); g.connect(ctx.destination); o.start(st); o.stop(st + p.d + 0.02);
      } catch (x) {}
    });
  }
  window.SMD_SOUND = {
    play: play,
    enabled: enabled,
    setEnabled: function (on) { try { localStorage.setItem("smd_sound", on ? "1" : "0"); } catch (e) {} if (on) unlock(); else if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; } },
    supported: function () { return !!Ctx; }
  };
})();
