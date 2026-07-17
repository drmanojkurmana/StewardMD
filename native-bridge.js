/* StewardMD — native (Capacitor) bridge.
 * ---------------------------------------------------------------------------
 * The app is bundled LOCALLY inside the iOS/Android apps, so its origin is
 * https://localhost (Capacitor). Relative "/api/*" calls would resolve to that
 * local origin, which has no backend. Here we rewrite them to the live
 * Cloudflare Functions host. CapacitorHttp (enabled in capacitor.config.json)
 * then proxies the request through native HTTP, bypassing browser CORS.
 *
 * On the WEB build (stewardmd.in) this file is a NO-OP — `native` is false, so
 * fetch is left untouched and same-origin "/api/*" works as before. Safe to load
 * everywhere from the single shared index.html.
 *
 * Loads before app.js. No dependencies.
 */
(function () {
  "use strict";
  var API_ORIGIN = "https://stewardmd.in";
  var C = window.Capacitor;
  var native = !!(C && (typeof C.isNativePlatform === "function"
    ? C.isNativePlatform()
    : (C.platform && C.platform !== "web")));

  // Expose for any code that wants to build absolute URLs explicitly.
  window.SMD_API_BASE = native ? API_ORIGIN : "";
  window.SMD_IS_NATIVE = native;
  if (!native) return;                       // web: leave everything alone

  // Native device STT (Fast Dictation) runs on BOTH platforms via @capacitor-community/speech-
  // recognition (iOS SFSpeechRecognizer / Android SpeechRecognizer). iOS WKWebView has no Web
  // Speech API; the Android System WebView ALSO ships no Web Speech engine (only full Chrome does),
  // so this native plugin is the only on-device option on Android too — do NOT gate it to iOS.
  // (transcribe() below already handles both flavours: iOS resolves start() with the final
  // matches; Android streams via `partialResults` and ends via `listeningState:"stopped"`.)
  var isIOS = (C && (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform)) === "ios";

  // ── On-device Whisper (Clinical Dictation) models. The bytes are the official ggml quantised
  // Whisper weights (Hugging Face ggerganov/whisper.cpp, MIT); StewardMD RE-HOSTS them on its own
  // origin (never a runtime hotlink). The SHA-256 is PINNED here and verified NATIVELY before first
  // use (mismatch → model-corrupted → re-download). Audio is NEVER uploaded — only this model file
  // is fetched, once. Default is base multilingual q5_1 (~57 MB); tiny q5_1 (~31 MB) for low-end. ──
  var WHISPER_MODEL_HOST = "https://models.stewardmd.in/whisper";   // TODO(host): confirm R2 vs Pages origin before enabling in prod
  var WHISPER_MODELS = {
    // Default: small English-only q5_1 (~181 MB) — best accuracy for accented (Indian) English +
    // medical terms among the on-device options; English-only because Clinical Dictation is English-locked.
    "small.en-q5_1": { file: "ggml-small.en-q5_1.bin", sha256: "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30", bytes: 190098681 },
    "base-q5_1": { file: "ggml-base-q5_1.bin", sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898", bytes: 59707625 },
    "tiny-q5_1": { file: "ggml-tiny-q5_1.bin", sha256: "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7", bytes: 32152673 }
  };

  // ---- Native helpers (native-only; stay UNDEFINED on web because this file
  // early-returns above). Callers gate on window.SMD_IS_NATIVE / window.SMD_NATIVE
  // so the web build is byte-for-byte unchanged. ----
  function plugins() { return (window.Capacitor && window.Capacitor.Plugins) || null; }

  // Dump every same-origin stylesheet rule so an exported page looks like the app.
  function collectCss() {
    var css = "";
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var s = document.styleSheets[i];
        try { var r = s.cssRules; for (var j = 0; j < r.length; j++) css += r[j].cssText + "\n"; } catch (e) {}
      }
    } catch (e) {}
    return css;
  }
  // Wrap an HTML fragment into a standalone, print/PDF-friendly light-theme document.
  function buildHtmlDoc(fragment, title) {
    var t = String(title || "StewardMD — Clinical decision");
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + t.replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }) + '</title>' +
      '<style>' + collectCss() +
      // force a clean printable light page regardless of the app's dark theme
      ':root{color-scheme:light}html,body{background:#fff!important;color:#111!important}' +
      'body{margin:0;padding:20px;max-width:820px;margin-left:auto;margin-right:auto;font:15px/1.6 -apple-system,system-ui,sans-serif}' +
      '#smdCaseShare,.cs-row,.smd-caseprint-hide{display:none!important}' +
      '@page{margin:12mm}' +
      '</style></head><body>' + String(fragment == null ? "" : fragment) + '</body></html>';
  }

  window.SMD_NATIVE = {
    // Route to the iOS share sheet (offers Save to Files / Print / Markup / Mail).
    share: function (opts) {
      var P = plugins();
      if (P && P.Share && P.Share.share) { try { return P.Share.share(opts || {}); } catch (e) {} }
      return Promise.reject(new Error("share-unavailable"));
    },
    // There is NO print plugin on iOS — share the case as text so the share sheet
    // can Save as PDF / Print / Markup. (Plain text; rich HTML export not available.)
    exportPdf: function (text, title) {
      return this.share({ title: title || "StewardMD", text: String(text == null ? "" : text), dialogTitle: title || "Save or share" });
    },
    // Export an HTML fragment as a fully-styled, self-contained page FILE and open the
    // iOS share sheet ON THE FILE — which offers "Print" (→ pinch → Save as PDF),
    // "Save to Files", Books, Markup, Mail. This gives the whole expanded decision as a
    // real document (not plain text). Uses @capacitor/filesystem + @capacitor/share
    // (both first-party). Falls back to a stripped-text share if either is missing.
    saveHtmlFile: function (fragmentHtml, title, filename) {
      var self = this;
      var P = plugins();
      var frag = String(fragmentHtml == null ? "" : fragmentHtml);
      if (!(P && P.Filesystem && P.Filesystem.writeFile && P.Filesystem.getUri && P.Share && P.Share.share)) {
        return self.share({ title: title || "StewardMD", text: frag.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), dialogTitle: title || "Save or share" });
      }
      var name = (filename || "StewardMD-clinical-decision").replace(/[^\w.-]+/g, "-") + ".html";
      var doc = buildHtmlDoc(frag, title);
      return P.Filesystem.writeFile({ path: name, data: doc, directory: "CACHE", encoding: "utf8" })
        .then(function () { return P.Filesystem.getUri({ path: name, directory: "CACHE" }); })
        .then(function (r) { return P.Share.share({ title: title || "StewardMD", files: [r.uri], dialogTitle: "Save as PDF / Print / Share" }); });
    },
    // Native camera / photo picker → resolves to a data: URL string (rejects on cancel/error).
    // opts.camera → CAMERA; opts.prompt → PROMPT action sheet; else PHOTOS.
    pickImage: function (opts) {
      opts = opts || {};
      var P = plugins();
      if (!(P && P.Camera && P.Camera.getPhoto)) return Promise.reject(new Error("camera-unavailable"));
      var src = opts.camera ? "CAMERA" : (opts.prompt ? "PROMPT" : "PHOTOS");
      return P.Camera.getPhoto({ source: src, resultType: "dataUrl", quality: opts.quality || 80 }).then(function (img) {
        if (img && img.dataUrl) return img.dataUrl;
        if (img && img.base64String) return "data:image/jpeg;base64," + img.base64String;
        throw new Error("no-image");
      });
    },
    // Native document/file picker (PDF OR image) for "Upload PDF/file". @capacitor/camera
    // is images-only, so this uses @capawesome/capacitor-file-picker. Returns a Blob with
    // .type set so the existing handleImportFile() PDF(pdf.js)/image pipeline consumes it.
    pickFile: function (opts) {
      var P = plugins();
      var FP = P && P.FilePicker;
      if (!(FP && FP.pickFiles)) return Promise.reject(new Error("filepicker-unavailable"));
      var types = (opts && opts.types) || ["application/pdf", "image/*"];
      return FP.pickFiles({ types: types, readData: true, limit: 1 }).then(function (res) {
        var f = res && res.files && res.files[0];
        if (!f || !f.data) throw new Error("no-file");
        var mime = f.mimeType || (/\.pdf$/i.test(f.name || "") ? "application/pdf" : "application/octet-stream");
        var bin = atob(f.data), n = bin.length, bytes = new Uint8Array(n);
        for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
        var blob = new Blob([bytes], { type: mime });
        try { blob.name = f.name || "upload"; } catch (e) {}
        return blob;
      });
    },
    // On-device OCR via ML Kit text recognition. The IMAGE NEVER LEAVES THE DEVICE —
    // only recognized text is returned to JS. Resolves { text, lines:[string] }.
    ocr: function (dataUrl) {
      var P = plugins();
      var TR = P && P.VisionOcr;   // local Apple Vision plugin (@stewardmd/capacitor-vision-ocr)
      if (!(TR && TR.detectText)) return Promise.reject(new Error("ocr-unavailable"));
      var b64 = String(dataUrl || "").replace(/^data:[^;]+;base64,/, "");
      if (!b64) return Promise.reject(new Error("no-image"));
      return TR.detectText({ base64Image: b64 }).then(function (res) {
        var lines = [];
        try { (res.blocks || []).forEach(function (bl) { (bl.lines || []).forEach(function (ln) { if (ln && ln.text) lines.push(String(ln.text)); }); }); } catch (e) {}
        if (!lines.length && res && res.text) lines = String(res.text).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        return { text: (res && res.text) || lines.join("\n"), lines: lines };
      });
    },
    // MaiK Scribe — native device speech-to-text (@capacitor-community/speech-recognition:
    // iOS SFSpeechRecognizer / Android SpeechRecognizer). Audio stays on the device — only
    // text returns. Streams interim results via opts.onPartial; opts.onFinal on stop.
    // Throws SYNCHRONOUSLY if the plugin is absent so SMD_VOICE falls back to Web Speech / AI STT.
    transcribe: function (opts) {
      opts = opts || {};
      var P = plugins();
      var SP = P && P.SpeechRecognition;
      // Use the native plugin wherever it's present (iOS + Android). Throw synchronously when it's
      // absent so SMD_VOICE can fall back to Web Speech / AI STT.
      if (!(SP && SP.start)) throw new Error("speech-unavailable");
      var self = this, last = "", done = false;
      // Session token: every transcribe() bumps it. Callbacks/timers left over from a PRIOR
      // session (the 450ms "stopped" finish, the 800ms stop fallback) check `current()` and
      // no-op — otherwise a stale timer fires mid-way through the NEXT session and tears it
      // down (button dies after ~1s, native listeners orphaned). Repro: speak → stop → speak
      // again quickly. See git history for the singleton-state bug this guards against.
      var token = (self._token = (self._token || 0) + 1);
      function current() { return self._token === token; }
      // Kill any leftover subs/timers from a previous session right now.
      clearTimeout(self._finTimer);
      self._removeSpeechSub();
      function finish(txt) {
        if (done || !current()) return; done = true;
        clearTimeout(self._finTimer); self._finish = null;
        self._removeSpeechSub();
        try { if (SP.stop) SP.stop(); } catch (e) {}   // ensure native stops (no orphan mic / restart loop)
        if (opts.onFinal) opts.onFinal(String(txt != null ? txt : last));
      }
      self._finish = finish;
      // IMPORTANT (Android): SpeechRecognizer auto-endpoints — text streams via the
      // `partialResults` listener and the session ends via `listeningState:"stopped"`.
      // start() resolves IMMEDIATELY with nothing, so it must NOT be treated as the final
      // (doing so tore the listener down before any result arrived). iOS resolves start()
      // with the final matches, handled in the .then below.
      (SP.requestPermissions ? SP.requestPermissions() : Promise.resolve()).then(function () {
        if (!current()) return;   // superseded before we got going
        if (SP.addListener) {
          self._speechSub = SP.addListener("partialResults", function (data) {
            if (!current()) return;
            var m = data && data.matches && data.matches[0];
            if (m != null) { last = String(m); if (opts.onPartial) opts.onPartial(last); }
          });
          self._stateSub = SP.addListener("listeningState", function (data) {
            if (!current()) return;
            var s = data && data.status;
            if (s === "stopped") {
              // Give the trailing final `partialResults` (emitted just after "stopped") a
              // moment to update `last`, then finalize.
              clearTimeout(self._finTimer);
              self._finTimer = setTimeout(function () { finish(last); }, 450);
            }
          });
        }
        return SP.start({ language: navigator.language || "en-US", partialResults: true, popup: false, maxResults: 5 });
      }).then(function (res) {
        if (!current()) return;
        var m = res && res.matches && res.matches[0];
        if (m != null) { last = String(m); finish(last); }   // iOS: start() carried the final result
        // Android: res is empty — keep listening; finalize via listeningState / stop().
      }).catch(function (e) {
        if (!current()) return;
        var msg = String((e && e.message) || e || "");
        if (last) { finish(last); return; }   // "no match" after real speech isn't a hard error
        clearTimeout(self._finTimer); self._finish = null;
        self._removeSpeechSub();
        if (opts.onError) opts.onError(msg);
      });
      return function () { self.stopTranscribe(); };
    },
    stopTranscribe: function () {
      var P = plugins(); var SP = P && P.SpeechRecognition;
      try { if (SP && SP.stop) SP.stop(); } catch (e) {}
      // stop() triggers listeningState:"stopped" → finish() runs there. Fallback in case no
      // state event arrives: finalize with whatever we have, else just clean up. Capture the
      // session token so a NEW session started before this fires isn't torn down.
      var self = this;
      var token = self._token;
      clearTimeout(this._finTimer);
      this._finTimer = setTimeout(function () {
        if (self._token !== token) return;   // a newer session owns SMD_NATIVE now — leave it alone
        if (self._finish) self._finish(); else self._removeSpeechSub();
      }, 800);
    },
    _token: 0,
    _speechSub: null,
    _stateSub: null,
    _finTimer: null,
    _finish: null,
    _removeSpeechSub: function () {
      var rm = function (s) { try { if (!s) return; if (typeof s.remove === "function") s.remove(); else if (typeof s.then === "function") s.then(function (h) { try { if (h && h.remove) h.remove(); } catch (e) {} }); } catch (e) {} };
      rm(this._speechSub); rm(this._stateSub);
      this._speechSub = null; this._stateSub = null;
    },

    // MaiK Scribe — CLINICAL DICTATION via the on-device Whisper plugin (@stewardmd/capacitor-whisper).
    // A SEPARATE engine from transcribe() (SFSpeech): audio never leaves the device, and it NEVER
    // falls back to any cloud transcription. Throws SYNCHRONOUSLY when the plugin is absent (web, or
    // Android — not built yet) so SMD_VOICE can offer Fast Dictation instead. Stop-to-transcribe:
    // startTranscribe → (speak) → stopWhisper() runs inference natively → onFinal.
    // opts: { language?, model?, initialPrompt?, onPartial?, onFinal?, onError?, onStateChange?, onDownloadProgress? }
    transcribeWhisper: function (opts) {
      opts = opts || {};
      var P = plugins(); var W = P && P.Whisper;
      if (!(W && W.startTranscribe)) throw new Error("whisper-unavailable");
      var self = this;
      var modelKey = opts.model || "base-q5_1";
      var m = WHISPER_MODELS[modelKey]; if (!m) throw new Error("whisper-unknown-model");
      // Session token: a new session supersedes stale event handlers/callbacks from a prior one.
      var token = (self._wToken = (self._wToken || 0) + 1);
      function current() { return self._wToken === token; }
      self._removeWhisperSubs();
      var done = false;
      function fail(code) { if (done || !current()) return; done = true; self._removeWhisperSubs(); try { if (W.cancel) W.cancel(); } catch (e) {} if (opts.onError) opts.onError(code || "transcription-failure"); }
      function finalText(txt) { if (done || !current()) return; done = true; self._removeWhisperSubs(); if (opts.onFinal) opts.onFinal(String(txt != null ? txt : "")); }

      self._wSubs = [];
      function on(ev, fn) { try { self._wSubs.push(W.addListener(ev, function (d) { if (current()) fn(d || {}); })); } catch (e) {} }
      on("whisperState", function (d) { if (opts.onStateChange) opts.onStateChange(d.state); });
      on("whisperPartial", function (d) { if (opts.onPartial && d.text != null) opts.onPartial(String(d.text)); });
      on("whisperFinal", function (d) { finalText(d.text); });
      on("whisperError", function (d) { fail(d.code || "transcription-failure"); });
      on("whisperDownloadProgress", function (d) { if (opts.onDownloadProgress) opts.onDownloadProgress(Number(d.progress) || 0); });

      var lang = opts.language || "en";   // default English (Indian-English handled by initial_prompt + model); not the device locale
      function begin() {
        if (!current()) return;
        W.startTranscribe({ model: modelKey, language: lang, initialPrompt: opts.initialPrompt || "" })
          .catch(function (e) { fail((e && e.code) || "recording-failure"); });
      }
      // Ensure the model is installed (download only if missing), then start recording.
      W.isModelInstalled({ model: modelKey }).then(function (r) {
        if (!current()) return;
        if (r && r.installed) { begin(); return; }
        if (opts.onStateChange) opts.onStateChange("downloading");
        W.downloadModel({ model: modelKey, url: WHISPER_MODEL_HOST + "/" + m.file, sha256: m.sha256 })
          .then(function () { begin(); })
          .catch(function (e) { fail((e && e.code) || "model-download-failed"); });
      }).catch(function (e) { fail((e && e.code) || "transcription-failure"); });

      return function () { self.stopWhisper(); };
    },
    // Stop recording and transcribe (final arrives via the whisperFinal event → onFinal).
    stopWhisper: function () { var P = plugins(); var W = P && P.Whisper; try { if (W && W.stopTranscribe) W.stopTranscribe(); } catch (e) {} },
    // Abort with no transcription (release native resources).
    cancelWhisper: function () { var P = plugins(); var W = P && P.Whisper; try { if (W && W.cancel) W.cancel(); } catch (e) {} this._removeWhisperSubs(); },
    // Is a Clinical model on the device? Checks the given model, or ALL known models (no arg) so the
    // "Remove model" UI reflects any downloaded weights. → { installed, bytes }.
    whisperModelInstalled: function (model) {
      var P = plugins(); var W = P && P.Whisper;
      if (!(W && W.isModelInstalled)) return Promise.resolve({ installed: false, bytes: 0 });
      var keys = model ? [model] : Object.keys(WHISPER_MODELS);
      return Promise.all(keys.map(function (k) { return W.isModelInstalled({ model: k }).catch(function () { return { installed: false, bytes: 0 }; }); }))
        .then(function (rs) { var any = false, bytes = 0; rs.forEach(function (r) { if (r && r.installed) { any = true; bytes += (r.bytes || 0); } }); return { installed: any, bytes: bytes }; });
    },
    // Delete the given Clinical model, or ALL known models (no arg) to fully free the storage.
    // Re-downloads automatically on next Clinical use.
    deleteWhisperModel: function (model) {
      var P = plugins(); var W = P && P.Whisper;
      if (!(W && W.deleteModel)) return Promise.reject(new Error("whisper-unavailable"));
      var keys = model ? [model] : Object.keys(WHISPER_MODELS);
      return Promise.all(keys.map(function (k) { return W.deleteModel({ model: k }).catch(function () {}); }));
    },
    _wToken: 0,
    _wSubs: null,
    _removeWhisperSubs: function () {
      var subs = this._wSubs || []; this._wSubs = [];
      subs.forEach(function (s) { try { if (!s) return; if (typeof s.remove === "function") s.remove(); else if (typeof s.then === "function") s.then(function (h) { try { if (h && h.remove) h.remove(); } catch (e) {} }); } catch (e) {} });
    },

    // ---- Screen orientation. The app is portrait-locked everywhere (native default is
    // set in MainActivity/AppDelegate); the antibiogram grid unlocks rotation so it can be
    // read in landscape, then re-locks on close. Uses the native AppOrientation plugin when
    // present, with a best-effort Web Screen Orientation fallback for plain browsers. ----
    lockPortrait: function () {
      var P = plugins();
      try { if (P && P.AppOrientation && P.AppOrientation.lockPortrait) { P.AppOrientation.lockPortrait(); return; } } catch (e) {}
      try { if (screen.orientation && screen.orientation.lock) { var r = screen.orientation.lock("portrait"); if (r && r.catch) r.catch(function () {}); } } catch (e) {}
    },
    unlockRotation: function () {
      var P = plugins();
      try { if (P && P.AppOrientation && P.AppOrientation.unlock) { P.AppOrientation.unlock(); return; } } catch (e) {}
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    }
  };

  // Portrait by default across the app (belt-and-suspenders for web; native platforms also
  // default to portrait at the Activity/AppDelegate level).
  try { window.SMD_NATIVE.lockPortrait(); } catch (e) {}

  // ---- Native nav hardening: when a syndrome is opened from the Knowledge-Library
  // list (SB.openSyn) and the user then closes the stewardship console, return STRAIGHT
  // to the home shell — never strand them on a lurking Clinical Reasoning overlay.
  // Only the LIST-opened path is forced home; the reasoning→stewardship path is left
  // untouched so "Select diagnosis → back" still returns to the differential. ----
  (function hardenSyndromeNav() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      try {
        if (window.SB && typeof SB.openSyn === "function" && !SB.__smdListWrap) {
          SB.__smdListWrap = true;
          var _os = SB.openSyn.bind(SB);
          SB.openSyn = function () { try { window.__smdAspFromList = true; } catch (e) {} return _os.apply(SB, arguments); };
        }
        if (window.ASP && typeof ASP.close === "function" && !ASP.__smdCloseWrap) {
          ASP.__smdCloseWrap = true;
          var _ac = ASP.close.bind(ASP);
          ASP.close = function () {
            var r; try { r = _ac.apply(ASP, arguments); } catch (e) {}
            if (window.__smdAspFromList) {
              window.__smdAspFromList = false;
              try { var dx = document.querySelector(".dx-overlay.on"); if (dx && window.DX && DX.close) DX.close(); } catch (e) {}
              try { if (window.SMD_setUI) SMD_setUI(true); } catch (e) {}
            }
            return r;
          };
        }
      } catch (e) {}
      if (window.SB && SB.__smdListWrap && window.ASP && ASP.__smdCloseWrap) clearInterval(iv);
      if (tries > 80) clearInterval(iv);
    }, 200);
  })();

  // ---- Keyboard guard (native-only safety net): WKWebView pops the iOS keyboard
  // whenever code calls .focus() on a text field with no user intent (e.g. a search
  // box focused right after a screen opens). Blur any text input/textarea that gains
  // focus WITHOUT a real touch on that same field within ~350ms; genuine taps pass
  // through untouched. Covers focus() calls anywhere, including inside minified app.js. ----
  (function () {
    var lastTouchEl = null, lastTouchAt = 0;
    function mark(e) { lastTouchEl = e.target; lastTouchAt = Date.now(); }
    document.addEventListener("touchstart", mark, true);
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("mousedown", mark, true);
    function isText(el) {
      if (!el || !el.tagName) return false;
      if (el.tagName === "TEXTAREA") return true;
      if (el.tagName !== "INPUT") return false;
      var t = (el.getAttribute("type") || "text").toLowerCase();
      return t === "text" || t === "search" || t === "email" || t === "tel" || t === "url" || t === "number" || t === "password" || t === "";
    }
    document.addEventListener("focusin", function (e) {
      var el = e.target;
      if (!isText(el)) return;
      var recent = (Date.now() - lastTouchAt) < 350;
      var onEl = lastTouchEl && (lastTouchEl === el
        || (el.contains && el.contains(lastTouchEl))
        || (lastTouchEl.contains && lastTouchEl.contains(el)));
      if (recent && onEl) return;          // genuine tap on this field → allow keyboard
      try { el.blur(); } catch (x) {}      // programmatic focus → suppress the keyboard
    }, true);
  })();

  // Splash: launchAutoHide is false (see capacitor.config.json). The 35 app scripts
  // are `defer`, so the WebView does not paint the app's own boot splash until they
  // all execute — hiding the native splash before that shows a BLACK unpainted WebView.
  // The KB (~4.8MB) is now lazy-loaded AFTER first paint (see index.html), so the app's
  // own white branded loading splash (#smdBootSplash — logo + wordmark + progress + MaiK)
  // paints quickly. We hand off to it by hiding the native splash as soon as that white
  // splash has painted (DOMContentLoaded + double rAF), so the user sees the branded white
  // splash — not a lingering navy native splash. Backgrounds are white (capacitor.config)
  // so any sub-frame gap is white, not black/navy. 'load' + a timeout are backstops so the
  // native splash can never get stuck even if the app scripts throw.
  var _splashHidden = false;
  function hideNativeSplash() {
    if (_splashHidden) return;
    _splashHidden = true;
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (P && P.SplashScreen) P.SplashScreen.hide();
    } catch (e) { /* no-op */ }
  }
  // Hide the native splash on window 'load' — the only reliable signal that the WebView's
  // content is actually COMPOSITED to screen. (rAF/DOMContentLoaded fire while the WebView
  // still paints behind the native splash, so hiding then reveals an un-composited black
  // frame.) The native splash is now a WHITE branded splash (white bg + StewardMD logo — see
  // Splash.imageset + LaunchScreen.storyboard), so the user sees white-branded → the white
  // #smdBootSplash (logo + progress + MaiK) → home, with no black/navy flash. The KB is
  // lazy-loaded after first paint, so 'load' now fires quickly. Timeout is a hard backstop.
  window.addEventListener("load", hideNativeSplash);
  setTimeout(hideNativeSplash, 8000);

  function absolutize(u) {
    // Only rewrite root-relative API paths; leave everything else (assets, absolute URLs) as-is.
    return (typeof u === "string" && u.charAt(0) === "/" && u.lastIndexOf("/api/", 0) === 0)
      ? API_ORIGIN + u : u;
  }

  // ---- Native /api transport. CapacitorHttp's fetch AUTO-patch proved unreliable here
  // (patch-ordering vs. our wrapper) — relative "/api/*" calls leaked out as browser
  // CROSS-ORIGIN requests to stewardmd.in and died on the CORS preflight (the server
  // sends no CORS headers) → "Server not reachable" for GHIS login, MaiK AI/web-research,
  // and ICU vision. Fix: for /api/* on native, call the CapacitorHttp plugin EXPLICITLY
  // (a real native request, no CORS) and adapt the result into a fetch Response. Works
  // regardless of the `enabled` flag or patch order. Everything else passes through. ----
  function capHttp() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) || window.CapacitorHttp || null;
  }
  function headersToObj(h) {
    var o = {};
    try {
      if (!h) return o;
      if (typeof h.forEach === "function" && !Array.isArray(h)) h.forEach(function (v, k) { o[k] = v; });
      else if (Array.isArray(h)) h.forEach(function (p) { o[p[0]] = p[1]; });
      else for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) o[k] = h[k];
    } catch (e) {}
    return o;
  }
  function nativeApiFetch(url, init) {
    var Http = capHttp();
    if (!Http || !Http.request) return null;          // signal caller to fall back
    init = init || {};
    var headers = headersToObj(init.headers);
    // Authorize the native app past the site "coming soon" access gate (functions/_middleware.js
    // checks this against env.APP_GATE_KEY). The public web never serves this bundle — the gate
    // returns the coming-soon page for any non-/api path — so the key stays inside the app.
    headers["X-SMD-App"] = "smdapp_ec051e785edc74766ee4a6d37282d79ea9b0feeb";
    var ct = ""; for (var k in headers) if (k.toLowerCase() === "content-type") ct = String(headers[k]);
    var data = init.body;
    // CapacitorHttp wants string or JSON object on iOS; hand JSON bodies as objects so it encodes them.
    if (typeof data === "string" && /json/i.test(ct)) { try { data = JSON.parse(data); } catch (e) {} }
    return Http.request({
      url: url, method: (init.method || "GET").toUpperCase(),
      headers: headers, data: data, connectTimeout: 30000, readTimeout: 30000
    }).then(function (res) {
      var body = res && res.data;
      if (body != null && typeof body !== "string") { try { body = JSON.stringify(body); } catch (e) { body = String(body); } }
      var rh = headersToObj(res && res.headers), hasCT = false;
      for (var kk in rh) if (kk.toLowerCase() === "content-type") hasCT = true;
      if (!hasCT) rh["Content-Type"] = (res && typeof res.data === "object") ? "application/json" : "text/plain";
      return new Response(body == null ? "" : body, { status: (res && res.status) || 0, headers: rh });
    });
  }
  if (typeof window.fetch === "function") {
    // Fall-through transport for everything that ISN'T /api/*: prefer the PRISTINE native fetch on
    // Android. CapacitorHttp (enabled in capacitor.config.json) auto-patches window.fetch, and on the
    // Android WebView that patched fetch breaks Firestore's transport — every read fails `unavailable`
    // (verified live via CDP), so ICU group mode never loads its shared units and falls back to the
    // solo "This device" screen. CapacitorHttp stashes the original browser fetch as
    // window.CapacitorWebFetch; routing non-/api traffic (Firestore/Google APIs) through it lets
    // Firestore reach firestore.googleapis.com natively (WebChannel works, like the web PWA).
    // MUST bind BEFORE Firestore starts (Firestore captures its transport at start): native-bridge.js
    // runs at boot, ahead of SMD_bootFirebase's first read. iOS/web keep window.fetch unchanged
    // (WKWebView tolerates the patch); /api/* still goes through the explicit plugin below on both.
    var _plat = ""; try { _plat = (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || ""; } catch (e) {}
    var _baseFetch = (_plat === "android" && typeof window.CapacitorWebFetch === "function") ? window.CapacitorWebFetch : window.fetch;
    var origFetch = _baseFetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url = (typeof input === "string") ? input : (input && typeof input === "object" ? input.url : null);
        // Route through CapacitorHttp (a real native request, no CORS): relative "/api/*" AND the
        // absolute drug/index API worker "https://api.stewardmd.in/*" — the latter is cross-origin
        // from the WebView (origin https://localhost) and would otherwise leak out as a CORS-blocked
        // browser request (Drug Database came up empty). Absolute URLs are used as-is.
        var abs = null;
        if (typeof url === "string") {
          if (url.charAt(0) === "/" && url.lastIndexOf("/api/", 0) === 0) abs = API_ORIGIN + url;
          else if (url.lastIndexOf("https://api.stewardmd.in", 0) === 0 || url.lastIndexOf("http://api.stewardmd.in", 0) === 0) abs = url;
        }
        if (abs) {
          var merged = init || (input && typeof input === "object" ? { method: input.method, headers: input.headers } : {});
          var r = nativeApiFetch(abs, merged);
          if (r) return r;                              // native request in flight
          return origFetch(abs, init);                  // fallback: at least absolutized
        }
      } catch (e) { /* fall through */ }
      return origFetch(input, init);
    };
  }

  // Some code paths use XMLHttpRequest (and CapacitorHttp patches XHR too).
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype && window.XMLHttpRequest.prototype.open) {
    var origOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      try { if (typeof url === "string") arguments[1] = absolutize(url); } catch (e) {}
      return origOpen.apply(this, arguments);
    };
  }

  // ── Universal Links (iOS) / App Links (Android) → invite join ──────────────────────────────
  // A universal link that opens the app delivers the URL NATIVELY via the @capacitor/app plugin —
  // the WebView still loads its own start URL, so the ?icujoin= never lands in location. Forward any
  // invite URL (cold-launch getLaunchUrl + warm appUrlOpen) into the web join flow. Requires the
  // "Associated Domains" capability (applinks:stewardmd.in) on the app + the hosted AASA/assetlinks.
  (function () {
    var P = plugins(); if (!P || !P.App) return;
    function feed(u) {
      if (!u || String(u).indexOf("icujoin=") < 0 && String(u).indexOf("/i/") < 0) return;
      var tries = 0;
      (function go() {
        if (window.ICU && ICU.handleJoinUrl) { try { ICU.handleJoinUrl(u); } catch (e) {} return; }
        if (tries++ < 40) setTimeout(go, 250);   // wait for icu.js to load on a cold launch
      })();
    }
    try { P.App.getLaunchUrl().then(function (r) { if (r && r.url) feed(r.url); }).catch(function () {}); } catch (e) {}
    try { P.App.addListener("appUrlOpen", function (d) { if (d && d.url) feed(d.url); }); } catch (e) {}
  })();
})();
