/* PrepNucleus natural voice, second engine: Phonon 31M (Gradium, Apache-2.0, 31M parameters, 64.5 MB at 8 bits), run by the
 * vendored phonon-tts WebAssembly runtime (vendor/phonon-tts, MIT or Apache-2.0) in a worker. It reads the text itself, so it
 * needs no phonemizer or lexicon. Registers with prep-voice.js, which owns the audio element, stop and engine choice; this
 * file only downloads, renders sentences and reports. The model comes from Hugging Face (pinned commit, kept in the Cache API)
 * on first use. Nothing leaves the phone after that. Same contract as the Kokoro engine: available, state, progress,
 * download, init, say, prefetch, release, remove, usable (a one-time timing says whether this phone keeps up), rtf. */
(function (G) {
  "use strict";
  if (typeof window === "undefined" || !G.PREP_VOICE || !G.PREP_VOICE.register) return;
  var BASE = "/vendor/phonon-tts/", RTF_MAX = 1.3;
  G.PREP_VOICE.register("phonon", function (host) {
    var st = { s: "none", p: 0, err: "", rtf: 0 }, lib = null, tts = null, boot = null, memo = {}, keys = [], ctl = null;
    function can() { return G.SMD_PREP_VOICE !== false && !!(G.WebAssembly && G.Worker && G.caches && G.Audio); }
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
    var cbs = [];
    function tell() { for (var i = 0; i < cbs.length; i++) { try { cbs[i](st.p); } catch (e) {} } }
    function synth(text) {
      var key = text;
      if (memo[key]) return memo[key];
      ctl = typeof G.AbortController === "function" ? new G.AbortController() : null;
      var p = tts.synth(text, ctl ? { signal: ctl.signal } : {}).then(function (a) {
        var out = new Float32Array(a), lead = Math.min(out.length, 480);
        for (var i = 0; i < lead; i++) out[i] *= i / lead;
        return out;
      });
      memo[key] = p; keys.push(key);
      if (keys.length > 10) delete memo[keys.shift()];
      p.catch(function () { delete memo[key]; });
      return p;
    }
    // Seconds of work per second of speech, from one short phrase, kept on the phone (see prep-voice.js).
    function bench() {
      var key = "prep_voice_rtf_phonon", old = 0;
      try { old = parseFloat(G.localStorage.getItem(key)); } catch (e) {}
      if (old > 0) { st.rtf = old; return Promise.resolve(); }
      var t0 = Date.now(), phrase = "This is a short test of the voice.";
      return synth(phrase).then(function (a) {
        st.rtf = ((Date.now() - t0) / 1000) / (a.length / host.sr);
        try { G.localStorage.setItem(key, String(st.rtf)); } catch (e) {}
        delete memo[phrase];
      });
    }
    var E = {
      name: "Phonon", mb: 65,
      state: function () { return st.s; }, progress: function () { return st.p; }, error: function () { return st.err; },
      ready: function () { return st.s === "ready"; }, usable: function () { return st.s === "ready" && !(st.rtf > RTF_MAX); }, rtf: function () { return st.rtf || 0; },
      available: can,
      download: function (onP) {
        if (!can()) { st.s = "error"; st.err = "unsupported"; return Promise.reject(new Error("unsupported")); }
        if (onP) cbs.push(onP);
        if (boot) return boot;
        st.s = "downloading"; st.p = 0; st.err = "";
        boot = load().then(function (t) { tts = t; st.s = "loading"; st.p = 0.99; tell(); return bench(); })
          .then(function () { st.s = "ready"; st.p = 1; tell(); cbs = []; }, function (e) { boot = null; st.s = "error"; st.err = String(e && e.message || e); cbs = []; throw e; });
        return boot;
      },
      init: function () {
        if (!can() || boot || st.s !== "none") return;
        G.caches.keys().then(function (ks) { var has = ks.some(function (k) { return /phonon/i.test(k); }); if (has && st.s === "none") E.download().catch(function () {}); }, function () {});
      },
      prefetch: function (text) { if (st.s === "ready") synth(text).catch(function () {}); },
      say: function (text, rate) {
        if (st.s !== "ready") return Promise.reject(new Error("not ready"));
        var my = host.begin();
        return synth(text).then(function (wave) { return host.play(wave, rate, my); });
      },
      release: function () {
        host.halt(); try { if (ctl) ctl.abort(); } catch (e) {}
        var t = tts; tts = null; boot = null; memo = {}; keys = [];
        if (st.s === "ready" || st.s === "loading") st = { s: "none", p: 0, err: "", rtf: st.rtf };
        try { if (t && t.dispose) t.dispose(); } catch (e) {}
      },
      remove: function () {
        E.release(); try { G.localStorage.removeItem("prep_voice_rtf_phonon"); } catch (e) {}
        return lib && lib.clearCache ? lib.clearCache() : Promise.resolve();
      }
    };
    return E;
  });
})(typeof window !== "undefined" ? window : this);
