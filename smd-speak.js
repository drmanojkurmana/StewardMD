/* smd-speak.js: the app's one text-to-speech voice. window.SMD_SPEAK. ES5.
   Standard voice is Phonon 31M (owner 2026-11-17), the on-device neural voice the lessons use (prep-voice.js,
   window.PREP_VOICE). Outside PrepNucleus this file loads prep-voice.js itself. Speech never waits for the model:
   while Phonon is not ready (first use downloads it once in the background, about 64 MB, then it works offline)
   the native TextToSpeech plugin speaks, else the WebView's speechSynthesis. Code Blue keeps its own instant system
   voice on purpose (codeblue-audio.js): a resuscitation cue must never wait for a model.
   API: unlock() (call inside the tap that starts speech, iOS needs it for audio), say(text, { rate }) -> Promise
   resolved when spoken (rejected only when nothing can speak), stop(), speaking(), engine() "phonon"|"native"|"system"|"". */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  /* Sentences of at most max characters (Phonon renders a sentence at a time; long ones stall). */
  function chunks(text, max) {
    max = max || 220;
    var t = String(text || "").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim(), out = [];
    if (!t) return out;
    (t.match(/[^.!?;:]+[.!?;:]*\s*/g) || [t]).forEach(function (s) {
      s = s.trim(); if (!s) return;
      while (s.length > max) { var cut = s.lastIndexOf(" ", max); if (cut < 40) cut = max; out.push(s.slice(0, cut).trim()); s = s.slice(cut).trim(); }
      if (s) out.push(s);
    });
    return out;
  }
  var PURE = { chunks: chunks };
  if (NODE) { module.exports = PURE; return; }

  var tok = 0, busy = false, used = "", bgStarted = false;
  function V() { try { return G.PREP_VOICE || null; } catch (e) { return null; } }
  function nativeTts() { try { var C = G.Capacitor; return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.TextToSpeech || null; } catch (e) { return null; } }
  // Outside PrepNucleus PREP_VOICE is not loaded yet: load it once (prep-voice.js guards against a second copy).
  function ensureVoice() {
    if (V() || G.SMD_PREP_VOICE === false) return;
    try {
      if (G.document.querySelector('script[src*="prep-voice.js"]')) return;
      var s = G.document.createElement("script");
      s.src = "/prep-voice.js?v=" + ((G.PREP_LOADER && G.PREP_LOADER.V) || "speak1");
      G.document.head.appendChild(s);
    } catch (e) {}
  }
  // Phonon in the background: load a voice downloaded before, else download it once; this speech goes on meanwhile.
  function warm() {
    var v = V();
    if (!v || bgStarted || !v.available || !v.available()) return;
    bgStarted = true;
    try { (v.saved && v.saved() ? v.init() : v.download()).catch(function () {}); } catch (e) {}
  }
  function phononReady() { var v = V(); try { return !!(v && v.usable && v.usable()); } catch (e) { return false; } }

  function unlock() { ensureVoice(); var v = V(); try { if (v && v.unlock) v.unlock(); } catch (e) {} warm(); }
  function stop() {
    tok++; busy = false;
    try { var v = V(); if (v && v.stop) v.stop(); } catch (e) {}
    try { var T = nativeTts(); if (T && T.stop) T.stop().catch(function () {}); } catch (e) {}
    try { if (G.speechSynthesis) G.speechSynthesis.cancel(); } catch (e) {}
  }
  function sysSay(text, rate) {
    var T = nativeTts();
    if (T && T.speak) { used = "native"; return T.speak({ text: text, lang: "en-IN", rate: rate || 1, pitch: 1, volume: 1, category: "playback" }); }
    if (G.speechSynthesis && G.SpeechSynthesisUtterance) {
      used = "system";
      return new Promise(function (res) {
        var u = new G.SpeechSynthesisUtterance(text); u.lang = "en-IN"; u.rate = rate || 1;
        u.onend = res; u.onerror = function () { res(); };
        G.speechSynthesis.speak(u);
      });
    }
    return Promise.reject(new Error("no voice"));
  }
  function say(text, opts) {
    opts = opts || {};
    ensureVoice(); warm();
    stop();
    var my = tok, parts = chunks(text), rate = opts.rate || 1;
    if (!parts.length) return Promise.resolve();
    busy = true;
    var i = 0;
    function next() {
      if (my !== tok) return Promise.resolve();
      if (i >= parts.length) { busy = false; return Promise.resolve(); }
      var s = parts[i++], v = V();
      if (phononReady()) {
        used = "phonon";
        try { if (v.prefetch && parts[i]) v.prefetch(parts[i]); } catch (e) {}
        return v.say(s, rate).then(next, function () { return my === tok ? sysSay(s, rate).then(next) : null; });
      }
      return sysSay(s, rate).then(next);
    }
    return next().then(function () { if (my === tok) busy = false; }, function (e) { if (my === tok) busy = false; throw e; });
  }
  G.SMD_SPEAK = { unlock: unlock, say: say, stop: stop, speaking: function () { return busy; }, engine: function () { return used; }, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
