/* PrepNucleus natural voice: Phonon 31M (Gradium, Apache-2.0, 31M parameters, 64.5 MB at 8 bits), one voice (the model's
 * default), run by the vendored phonon-tts WebAssembly runtime (vendor/phonon-tts, MIT or Apache-2.0) in a module worker.
 * It reads the text itself, so there is no phonemizer or lexicon. The model downloads from Hugging Face (pinned commit)
 * on the first tap of Play in a lesson, is kept in the Cache API and works offline after that; no text or audio leaves
 * the phone. One <audio> element plays each rendered sentence (WebAudio is muted by the iOS silent switch), unlocked inside
 * the Play tap. After loading, a short phrase is timed once: slower than RTF_MAX (seconds of work per second of speech)
 * and the voice would stall between sentences, so usable() is false and the lesson keeps the system voice. Without this
 * file, without WebAssembly or workers, or on any failure the lesson speaks with the system voice.
 * window.SMD_PREP_VOICE = false switches it off (the UI tests do). Pure helpers load under node for tests.
 * API (window.PREP_VOICE): available(), state() none|downloading|loading|ready|error, progress() 0..1, error(), ready(),
 * usable(), rtf(), download(onProgress), init(), unlock(), say(text, rate) -> Promise (resolves when it has been
 * spoken), prefetch(text), stop(), release(), remove(). */
(function (G) {
  "use strict";
  var SR = 24000, BASE = "/vendor/phonon-tts/", RTF_MAX = 1.3, RTF_KEY = "prep_voice_rtf_phonon";

  /* ---------- pure ---------- */
  function wavBlob(f32) {
    var n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), i;
    function str(o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); }
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) { var s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
    return buf;
  }
  // The first few milliseconds fade in, so a clip never starts with a click.
  function fadeIn(a) { var out = new Float32Array(a), lead = Math.min(out.length, 480); for (var i = 0; i < lead; i++) out[i] *= i / lead; return out; }
  var PURE = { wavBlob: wavBlob, fadeIn: fadeIn, SR: SR, RTF_MAX: RTF_MAX };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ---------- engine ---------- */
  var st = { s: "none", p: 0, err: "", rtf: 0 }, lib = null, tts = null, boot = null, cbs = [], memo = {}, keys = [], ctl = null, audio = null, cur = null, tok = 0;
  function can() { return G.SMD_PREP_VOICE !== false && !!(G.WebAssembly && G.Worker && G.caches && G.Audio); }
  function tell() { for (var i = 0; i < cbs.length; i++) { try { cbs[i](st.p); } catch (e) {} } }
  function load() {
    return (lib ? Promise.resolve(lib) : import(BASE + "index.js").then(function (m) { lib = m; return m; })).then(function (m) {
      var files = {};
      return m.PhononTTS.load({
        lang: "en", quant: "q8", threads: 1, device: "cpu",
        workerUrl: BASE + "worker.js", wasmUrl: BASE + "wasm/phonon_tts_bg.wasm", simdWasmUrl: BASE + "wasm/phonon_tts_simd_bg.wasm",
        onProgress: function (x) {
          files[x.file] = { l: x.loaded || 0, t: x.total || 0 };
          var l = 0, t = 0, k;
          for (k in files) { l += files[k].l; t += files[k].t; }
          if (t > 0) { st.p = Math.min(0.98, l / t); tell(); }
        }
      });
    });
  }
  function synth(text) {
    if (memo[text]) return memo[text];
    ctl = typeof G.AbortController === "function" ? new G.AbortController() : null;
    var p = tts.synth(text, ctl ? { signal: ctl.signal } : {}).then(fadeIn);
    memo[text] = p; keys.push(text);
    if (keys.length > 10) delete memo[keys.shift()];
    p.catch(function () { delete memo[text]; });
    return p;
  }
  // Seconds of work per second of speech, from one short phrase, kept on the phone.
  function bench() {
    var old = 0, phrase = "This is a short test of the voice.";
    try { old = parseFloat(G.localStorage.getItem(RTF_KEY)); } catch (e) {}
    if (old > 0) { st.rtf = old; return Promise.resolve(); }
    var t0 = Date.now();
    return synth(phrase).then(function (a) {
      st.rtf = ((Date.now() - t0) / 1000) / (a.length / SR);
      try { G.localStorage.setItem(RTF_KEY, String(st.rtf)); } catch (e) {}
      delete memo[phrase];
    });
  }
  function download(onP) {
    if (!can()) { st.s = "error"; st.err = "unsupported"; return Promise.reject(new Error("unsupported")); }
    if (onP) cbs.push(onP);
    if (boot) return boot;
    st.s = "downloading"; st.p = 0; st.err = "";
    boot = load().then(function (t) { tts = t; st.s = "loading"; st.p = 0.99; tell(); return bench(); })
      .then(function () { st.s = "ready"; st.p = 1; tell(); cbs = []; }, function (e) { boot = null; st.s = "error"; st.err = String(e && e.message || e); cbs = []; throw e; });
    return boot;
  }
  // A voice downloaded before loads from the phone when a lesson opens.
  function init() {
    if (!can() || boot || st.s !== "none") return;
    G.caches.keys().then(function (ks) { if (ks.some(function (k) { return /phonon/i.test(k); }) && st.s === "none") download().catch(function () {}); }, function () {});
  }
  function unlock() {
    if (!audio) { audio = new G.Audio(); audio.preload = "auto"; }
    try { audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAICuAAACABAAZGF0YQAAAAA="; var pr = audio.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
  }
  function stop() { tok++; try { if (audio) { audio.pause(); audio.removeAttribute("src"); } } catch (e) {} try { if (ctl) ctl.abort(); } catch (e) {} if (cur) { cur(); cur = null; } }
  function say(text, rate) {
    if (st.s !== "ready") return Promise.reject(new Error("not ready"));
    var my = ++tok;
    return synth(text).then(function (wave) {
      if (my !== tok) return;
      return new Promise(function (res, rej) {
        if (!audio) audio = new G.Audio();
        var url = G.URL.createObjectURL(new G.Blob([wavBlob(wave)], { type: "audio/wav" })), done = function () { cur = null; try { G.URL.revokeObjectURL(url); } catch (e) {} };
        cur = function () { done(); res(); };
        audio.onended = function () { done(); res(); };
        audio.onerror = function () { done(); rej(new Error("audio")); };
        audio.src = url;
        audio.playbackRate = rate || 1;   // the speed the lesson asks for; pitch is kept
        var pr = audio.play(); if (pr && pr.catch) pr.catch(function (e) { done(); rej(e); });
      });
    });
  }
  function release() {
    stop();
    var t = tts; tts = null; boot = null; memo = {}; keys = []; cbs = [];
    if (st.s === "ready" || st.s === "loading") st = { s: "none", p: 0, err: "", rtf: st.rtf };
    try { if (t && t.dispose) t.dispose(); } catch (e) {}
  }
  function remove() {
    release(); try { G.localStorage.removeItem(RTF_KEY); } catch (e) {}
    return lib && lib.clearCache ? lib.clearCache() : Promise.resolve();
  }
  G.PREP_VOICE = {
    available: can, state: function () { return st.s; }, progress: function () { return st.p; }, error: function () { return st.err; },
    ready: function () { return st.s === "ready"; }, usable: function () { return st.s === "ready" && !(st.rtf > RTF_MAX); }, rtf: function () { return st.rtf || 0; },
    download: download, init: init, unlock: unlock, say: say, prefetch: function (t) { if (st.s === "ready") synth(t).catch(function () {}); },
    stop: stop, release: release, remove: remove, _pure: PURE
  };
})(typeof window !== "undefined" ? window : this);
