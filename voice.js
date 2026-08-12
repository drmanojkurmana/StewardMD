/* StewardMD — MaiK Scribe: voice intake → AI extract → review → autofill.
 * ===========================================================================
 * window.SMD_VOICE — a reusable capability shared by the ICU dashboard, MaiK, and the
 * Clinical Reasoning workspace. Speak → transcript → in-app AI extracts structured data
 * → clinician REVIEWS → fields/findings autofill. Nothing is auto-applied.
 *
 *   SMD_VOICE.listen({onPartial,onFinal,onError,onState}) → { engine, mode, stop }
 *   SMD_VOICE.stop()
 *   SMD_VOICE.openDialog({ target:"reasoning"|"icu", kind?, onApply? })
 *
 * Capture engine order: native device STT (SMD_NATIVE.transcribe, audio stays on device)
 * → Web Speech API (Android WebView/Chrome) → AI STT (MediaRecorder → /api/ai/transcribe).
 * Extraction: SMD_AI.extract → /api/ai/extract (never invents values or finding keys).
 * Review: reasoning → removable finding chips + DX.addFindings; ICU → ICU.reviewVoice →
 * ingestFromWard (conflict-safe, tagged source:"Voice").
 * ======================================================================== */
(function () {
  "use strict";

  // Shared inline-SVG icon accessor (window.ICONS catalog); text-safe fallback for load-order safety.
  function vcIco(n){ return (window.ICONS && ICONS.get) ? ICONS.get(n) : ""; }

  function isIOS() { return /iP(hone|ad|od)/i.test(navigator.userAgent || ""); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function blobToDataURL(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(b); }); }

  // Clinical Dictation (on-device Whisper) is ON by default — the Fast/Clinical selector shows in
  // MaiK Scribe on native builds (web is inert: gated by the native-plugin check below). Selecting
  // Clinical downloads the model on first use; a "Remove Clinical model" control frees the storage.
  // Users can still opt out by setting smd_whisper_clinical_dictation="0".
  function whisperFlagOn() { try { var v = localStorage.getItem("smd_whisper_clinical_dictation"); return v !== "0" && v !== "false"; } catch (e) { return true; } }
  // Available only when the REAL native Whisper plugin is registered AND the flag is enabled.
  // NOTE: gate on Capacitor.Plugins.Whisper — NOT on SMD_NATIVE.transcribeWhisper, which is a JS
  // wrapper that exists on every native build (so it wrongly showed Clinical on Android, where the
  // whisper.cpp plugin isn't built → every Clinical tap failed with "clinical-unavailable"). This
  // hides the Clinical selector on any platform that lacks the plugin (web + Android-until-shipped).
  function whisperPluginPresent() {
    try { var P = window.Capacitor && window.Capacitor.Plugins; return !!(P && P.Whisper && typeof P.Whisper.startTranscribe === "function"); } catch (e) { return false; }
  }
  function whisperAvailable() { return whisperPluginPresent() && whisperFlagOn(); }

  // Default recognition language for Clinical Dictation. Whisper has no region locales, so English
  // is "en"; the INDIAN-ENGLISH flavour + medical accuracy come from the initial_prompt below and
  // the multilingual model. We force "en" rather than the device locale, so a phone set to Hindi /
  // a regional language does NOT make Whisper decode the wrong language for English dictation.
  var WHISPER_LANG = "en";
  // Clinical model key (must exist in native-bridge WHISPER_MODELS). PLATFORM-SPECIFIC:
  //  • iOS keeps small.en (~181 MB) — best accuracy; the Metal GPU transcribes it in ~1-2 s.
  //  • Android uses base (~57 MB) — the CPU-only build runs small.en at ~7 s/clip, which is too
  //    slow; base is ~2-3x faster (~2.5-3.5 s) and still accurate for English clinical dictation
  //    (helped by the medical initial_prompt below). Forced "en" keeps the multilingual base English.
  function isAndroidNative() {
    try { var C = window.Capacitor; return !!(C && (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform) === "android"); } catch (e) { return false; }
  }
  // Steward Voice tiers — smd_voice_tiers gates the multilingual upgrade. OFF (default) keeps the
  // original hosted small.en/base models byte-for-byte; flip ON only AFTER host-whisper-models.sh
  // publishes the tier files (small-q8_0 / large-v3-turbo-q5_0 / telugu-small-q8_0) + a native rebuild.
  //   BASE     : Whisper Small INT8 (multilingual) for every language
  //   PRO      : Small INT8 (en/hi/auto) + verified Telugu Small INT8 (te)
  //   ULTIMATE : Large-v3-Turbo Q5 (en/hi/auto) + verified Telugu Small INT8 (te)
  function tiersFlagOn() { try { return localStorage.getItem("smd_voice_tiers") === "1"; } catch (e) { return false; } }
  function voiceTier() { try { var t = localStorage.getItem("smd_voice_tier"); return (t === "pro" || t === "ultimate") ? t : "base"; } catch (e) { return "base"; } }
  function whisperModel(lang) {
    if (!tiersFlagOn()) {
      // legacy (pre-tier) behaviour — only small.en/base/tiny are hosted until the tier rollout
      if (lang && lang !== "en") return "base-q5_1";            // multilingual: Telugu, auto-detect, code-switch
      return isAndroidNative() ? "base-q5_1" : "small.en-q5_1";  // English-only accuracy pick
    }
    var tier = voiceTier(), te = (lang === "te");
    if (tier === "ultimate") return te ? "telugu-small-q8_0" : "large-v3-turbo-q5_0";
    if (tier === "pro")      return te ? "telugu-small-q8_0" : "small-q8_0";
    return "small-q8_0";     // BASE: multilingual Whisper Small INT8 for en / hi / te / auto
  }
  // Which model keys each tier needs (for the Settings download dashboard).
  var TIER_MODELS = {
    base: ["small-q8_0"],
    pro: ["small-q8_0", "telugu-small-q8_0"],
    ultimate: ["large-v3-turbo-q5_0", "telugu-small-q8_0"]
  };
  var MODEL_META = {
    "small-q8_0":          { label: "Whisper Small · multilingual (INT8)", mb: 252 },
    "telugu-small-q8_0":   { label: "Telugu specialist · Small (INT8)", mb: 252 },
    "large-v3-turbo-q5_0": { label: "Whisper Large-v3-Turbo (Q5)", mb: 547 }
  };

  // Whisper `initial_prompt` — primes the decoder for Indian-English CLINICAL dictation so accented
  // English + drug/organism/lab terms are recognised. Built by REUSE: a high-yield medical seed
  // (antibiotics/vasopressors/organisms/labs/units that are frequently misheard) plus the app's own
  // drug names from window.MEDDRUGS._list. Capped well under Whisper's ~224-token prompt budget so it
  // biases without truncation. Pure hint — the doctor still edits the transcript before import.
  function buildInitialPrompt() {
    var seed = [
      "piperacillin-tazobactam", "meropenem", "cefoperazone-sulbactam", "ceftriaxone", "cefepime",
      "amikacin", "gentamicin", "vancomycin", "teicoplanin", "colistin", "polymyxin B", "linezolid",
      "doxycycline", "azithromycin", "levofloxacin", "metronidazole", "fluconazole", "caspofungin",
      "noradrenaline", "norepinephrine", "adrenaline", "vasopressin", "dobutamine", "dopamine",
      "hydrocortisone", "insulin", "furosemide", "heparin", "enoxaparin",
      "Escherichia coli", "Klebsiella pneumoniae", "Pseudomonas aeruginosa", "Acinetobacter baumannii",
      "Staphylococcus aureus", "Enterococcus", "Candida",
      "creatinine", "urea", "potassium", "sodium", "chloride", "bicarbonate", "haemoglobin", "platelets",
      "total leucocyte count", "bilirubin", "lactate", "procalcitonin", "C-reactive protein",
      "arterial blood gas", "SpO2", "oxygen saturation",
      "acute kidney injury", "chronic kidney disease", "septic shock", "community-acquired pneumonia",
      "urinary tract infection", "diabetic ketoacidosis",
      "milligrams", "grams", "q6h", "q8h", "q12h", "once daily", "twice daily", "three times daily", "intravenous"
    ];
    try {
      var list = (window.MEDDRUGS && window.MEDDRUGS._list) || [];
      var have = {}; seed.forEach(function (s) { have[s.toLowerCase()] = 1; });
      for (var i = 0; i < list.length && seed.length < 90; i++) {
        var g = list[i] && list[i].generic;
        if (g && !have[g.toLowerCase()]) { have[g.toLowerCase()] = 1; seed.push(g); }
      }
    } catch (e) {}
    return "Clinical case dictation in Indian English. Terms include " + seed.join(", ") + ".";
  }

  /* ------------------------------ capture ------------------------------ */
  var _active = null;   // { engine, mode:'stream'|'record', stop }
  function stop() { if (_active && _active.stop) { try { _active.stop(); } catch (e) {} } _active = null; }

  function listen(opts) {
    opts = opts || {};
    stop();
    // CLINICAL DICTATION (on-device Whisper) — only when explicitly requested via engine:"clinical"
    // AND available (native plugin + flag). Never auto-falls-back to cloud; on failure it signals
    // "clinical-unavailable" so the UI can OFFER Fast Dictation. Fast path below is untouched.
    if (opts.engine === "clinical") {
      if (whisperAvailable()) {
        try {
          var wstop = window.SMD_NATIVE.transcribeWhisper({
            language: (opts.language || WHISPER_LANG), model: opts.model || whisperModel(opts.language || WHISPER_LANG), initialPrompt: opts.initialPrompt || buildInitialPrompt(),
            onPartial: opts.onPartial, onFinal: opts.onFinal,
            onError: opts.onError, onDownloadProgress: opts.onDownloadProgress,
            onStateChange: function (s) { if (opts.onState) opts.onState(s, "Clinical (on-device)"); }
          });
          _active = { engine: "Clinical (on-device)", mode: "record", stop: (typeof wstop === "function") ? wstop : function () { try { window.SMD_NATIVE.stopWhisper && window.SMD_NATIVE.stopWhisper(); } catch (e) {} } };
          if (opts.onState) opts.onState("preparing", _active.engine);
          return _active;
        } catch (e) { /* plugin threw (unavailable) — do NOT auto-cloud */ }
      }
      if (opts.onError) opts.onError("clinical-unavailable");
      return null;
    }
    // 1) Native device STT (default on iOS/Android) — audio never leaves the device.
    if (window.SMD_NATIVE && typeof window.SMD_NATIVE.transcribe === "function") {
      try {
        var stopFn = window.SMD_NATIVE.transcribe({ onPartial: opts.onPartial, onFinal: opts.onFinal, onError: opts.onError });
        _active = { engine: "On-device", mode: "stream", stop: (typeof stopFn === "function") ? stopFn : function () { try { window.SMD_NATIVE.stopTranscribe && window.SMD_NATIVE.stopTranscribe(); } catch (e) {} } };
        if (opts.onState) opts.onState("listening", _active.engine);
        return _active;
      } catch (e) { /* fall through */ }
    }
    // 2) Web Speech API (Android WebView / Chrome). iOS WKWebView/Safari does NOT support it → skip.
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && !isIOS()) {
      try {
        var rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || "en-US";
        var finalTxt = "";
        rec.onresult = function (ev) {
          var interim = "";
          for (var i = ev.resultIndex; i < ev.results.length; i++) { var r = ev.results[i]; if (r.isFinal) finalTxt += r[0].transcript + " "; else interim += r[0].transcript; }
          if (opts.onPartial) opts.onPartial((finalTxt + interim).trim());
        };
        rec.onerror = function (ev) { if (opts.onError) opts.onError((ev && ev.error) || "speech-error"); };
        rec.onend = function () { if (opts.onFinal) opts.onFinal(finalTxt.trim()); };
        rec.start();
        _active = { engine: "On-device (browser)", mode: "stream", stop: function () { try { rec.stop(); } catch (e) {} } };
        if (opts.onState) opts.onState("listening", _active.engine);
        return _active;
      } catch (e) { /* fall through */ }
    }
    // On-device-only callers (the ambient consultation scribe) must never ship audio to the cloud
    // recorder below: if no on-device engine was available, report unavailable and stop.
    if (opts.noCloud) { if (opts.onError) opts.onError("stt-unavailable"); return null; }
    // 3) AI STT fallback — record mic, transcribe on stop via /api/ai/transcribe.
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder) {
      var chunks = [], mr = null, stream = null, stopped = false;
      _active = { engine: "AI", mode: "record", stop: function () { if (stopped) return; stopped = true; try { if (mr && mr.state !== "inactive") mr.stop(); } catch (e) {} } };
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s; mr = new MediaRecorder(s);
        mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        mr.onstop = function () {
          try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          var blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
          if (opts.onState) opts.onState("transcribing", "AI");
          blobToDataURL(blob).then(function (dataUrl) {
            (window.SMD_AI && window.SMD_AI.transcribe ? window.SMD_AI.transcribe(dataUrl) : Promise.resolve({ error: "no-ai" })).then(function (res) {
              if (res && res.transcript != null && !res.error) { if (opts.onFinal) opts.onFinal(String(res.transcript)); }
              else if (opts.onError) opts.onError((res && res.error) || "transcription-failed");
              if (opts.onState) opts.onState("idle", "AI");
            });
          });
        };
        mr.start();
        if (opts.onState) opts.onState("recording", "AI");
      }).catch(function () { if (opts.onError) opts.onError("mic-denied"); if (opts.onState) opts.onState("idle", "AI"); });
      return _active;
    }
    if (opts.onError) opts.onError("no-voice-engine");
    return null;
  }

  /* ------------------------------ dialog ------------------------------- */
  var ICU_KINDS = [["monitor", "Vitals"], ["labs", "Labs"], ["abg", "ABG"], ["ventilator", "Ventilator"]];
  var root = null;
  function close() { if (root) { stop(); root.classList.remove("on"); setTimeout(function () { if (root && !root.classList.contains("on")) { root.remove(); root = null; } }, 200); } }

  function openDialog(opts) {
    opts = opts || {};
    var target = (opts.target === "icu" || opts.target === "text") ? opts.target : "reasoning";
    injectCSS();
    stop();
    if (root) root.remove();
    root = document.createElement("div");
    root.className = "smdv"; root.id = "smdvSheet";
    var kindSel = target === "icu"
      ? '<div class="smdv-kinds">' + ICU_KINDS.map(function (k, i) { return '<button class="smdv-kind' + (i === 0 ? " on" : "") + '" data-kind="' + k[0] + '">' + esc(k[1]) + '</button>'; }).join("") + '</div>'
      : "";
    // Fast/Clinical engine selector — shown ONLY when Whisper is available (flag on + native plugin).
    // Flag off / web ⇒ empty ⇒ MaiK Scribe is byte-for-byte unchanged (Fast only).
    var modeSel = whisperAvailable()
      ? '<div class="smdv-modes" role="tablist" aria-label="Dictation engine">' +
          '<button class="smdv-mode on" data-mode="fast" role="tab">' + vcIco("spark") + ' Fast</button>' +
          '<button class="smdv-mode" data-mode="clinical" role="tab">' + vcIco("pulse") + ' Clinical</button>' +
        '</div><div class="smdv-mode-hint" id="smdvModeHint"></div>' +
        '<div class="smdv-model-mgr" id="smdvModelMgr"></div>'
      : "";
    // Clinical (Whisper) dictation language. English default (unchanged); Auto / Telugu switch to the
    // MULTILINGUAL model so Telugu + code-switch decode. Picking a non-English language auto-selects
    // the Clinical engine (Fast / native STT can't guarantee Telugu).
    var langSel = whisperAvailable()
      ? '<div class="smdv-langs" role="group" aria-label="Dictation language">' +
          '<button class="smdv-lang on" data-lang="en">English</button>' +
          '<button class="smdv-lang" data-lang="auto">Auto</button>' +
          '<button class="smdv-lang" data-lang="hi">हिंदी</button>' +
          '<button class="smdv-lang" data-lang="te">తెలుగు</button>' +
        '</div>'
      : "";
    // Steward Voice tier selector — only when the tier models are enabled (smd_voice_tiers).
    var tierSel = (whisperAvailable() && tiersFlagOn())
      ? '<div class="smdv-tiers" role="group" aria-label="Voice model tier">' +
          '<button class="smdv-tier' + (voiceTier() === "base" ? " on" : "") + '" data-tier="base">Base</button>' +
          '<button class="smdv-tier' + (voiceTier() === "pro" ? " on" : "") + '" data-tier="pro">Pro</button>' +
          '<button class="smdv-tier' + (voiceTier() === "ultimate" ? " on" : "") + '" data-tier="ultimate">Ultimate</button>' +
        '</div>'
      : "";
    root.innerHTML =
      '<div class="smdv-scrim" data-act="close"></div>' +
      '<div class="smdv-sheet" role="dialog" aria-modal="true" aria-label="MaiK Scribe voice intake">' +
        '<div class="smdv-hd"><span class="smdv-ttl">' + vcIco("mic") + ' MaiK Scribe</span><button class="smdv-x" data-act="close" aria-label="Close">' + vcIco("close") + '</button></div>' +
        '<div class="smdv-sub">' + (target === "icu" ? "Speak this patient’s vitals, labs, ABG or ventilator settings." : target === "text" ? "Speak your question or notes — tap ✓ to drop the text into the chat." : "Describe your patient in plain speech — symptoms, signs, key numbers.") + '</div>' +
        modeSel +
        tierSel +
        langSel +
        kindSel +
        '<button class="smdv-rec" id="smdvRec">' + vcIco("mic") + ' Tap to speak</button>' +
        '<div class="smdv-eng" id="smdvEng"></div>' +
        '<textarea class="smdv-ta" id="smdvTa" rows="4" placeholder="Your words appear here — you can edit before extracting."></textarea>' +
        '<div class="smdv-disc">On-device speech stays private (only text is used). AI transcription/extraction sends audio/text to the server — the same as Photo scan. Nothing is applied until you review &amp; confirm.</div>' +
        '<button class="smdv-extract" id="smdvExtract" disabled>' + (target === "text" ? vcIco("check") + " Use this text" : "Extract &amp; fill") + '</button>' +
        '<div class="smdv-review" id="smdvReview"></div>' +
      '</div>';
    document.body.appendChild(root);
    requestAnimationFrame(function () { root.classList.add("on"); });

    // Offer a "Remove Clinical model" control if any Whisper model is downloaded (frees storage).
    if (whisperAvailable() && window.SMD_NATIVE && window.SMD_NATIVE.whisperModelInstalled) {
      window.SMD_NATIVE.whisperModelInstalled().then(function (r) {
        var mgr = root && root.querySelector("#smdvModelMgr");
        if (!mgr || !r || !r.installed) return;
        var mb = r.bytes ? Math.round(r.bytes / 1048576) : null;
        mgr.innerHTML = '<button class="smdv-model-del" data-act="delmodel">' + vcIco("trash") + ' Remove Clinical model' + (mb ? " (frees ~" + mb + " MB)" : "") + '</button>';
      }).catch(function () {});
    }

    var ta = root.querySelector("#smdvTa");
    var recBtn = root.querySelector("#smdvRec");
    var engEl = root.querySelector("#smdvEng");
    var extractBtn = root.querySelector("#smdvExtract");
    var reviewEl = root.querySelector("#smdvReview");
    var kind = target === "icu" ? "monitor" : "reasoning";
    var engineMode = "fast";                 // Fast is always the default; only changes if the user picks Clinical
    var dictLang = "en";                     // Clinical dictation language: en | auto | te (Telugu)
    var recording = false, base = "";

    function refreshExtract() { extractBtn.disabled = !ta.value.trim(); }
    ta.addEventListener("input", function () { base = ta.value; refreshExtract(); });

    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act],[data-kind],[data-mode],[data-lang],[data-tier]"); if (!b) return;
      if (b.getAttribute("data-act") === "close") return close();
      if (b.getAttribute("data-act") === "delmodel") {
        if (!window.confirm("Remove the downloaded Clinical Dictation model? It will re-download next time you use Clinical.")) return;
        var mgr = root.querySelector("#smdvModelMgr");
        if (window.SMD_NATIVE && window.SMD_NATIVE.deleteWhisperModel) {
          window.SMD_NATIVE.deleteWhisperModel().then(function () {
            if (mgr) mgr.innerHTML = '<div class="smdv-model-gone">Clinical model removed.</div>';
            try { (window.toast || function () {})("Clinical model removed."); } catch (e) {}
          }).catch(function () { try { (window.toast || function () {})("Couldn’t remove the model."); } catch (e) {} });
        }
        return;
      }
      var kk = b.getAttribute("data-kind");
      if (kk) { kind = kk; [].forEach.call(root.querySelectorAll(".smdv-kind"), function (x) { x.classList.toggle("on", x === b); }); return; }
      var mm = b.getAttribute("data-mode");
      if (mm) {
        if (recording) { stop(); recording = false; setState("idle"); }   // switching engine mid-session stops the current one
        engineMode = mm;
        [].forEach.call(root.querySelectorAll(".smdv-mode"), function (x) { x.classList.toggle("on", x === b); });
        var hint = root.querySelector("#smdvModeHint");
        if (hint) hint.textContent = mm === "clinical" ? "On-device medical dictation — first use downloads the model. Better for long notes, accents & drug names. Hindi / Telugu / Auto use the on-device multilingual model." : "";
      }
      var lg = b.getAttribute("data-lang");
      if (lg) {
        if (recording) { stop(); recording = false; setState("idle"); }
        dictLang = lg;
        [].forEach.call(root.querySelectorAll(".smdv-lang"), function (x) { x.classList.toggle("on", x === b); });
        // Telugu / Hindi / Auto can only be decoded by the on-device multilingual model → force Clinical.
        if (lg !== "en" && engineMode !== "clinical") {
          engineMode = "clinical";
          [].forEach.call(root.querySelectorAll(".smdv-mode"), function (x) { x.classList.toggle("on", x.getAttribute("data-mode") === "clinical"); });
        }
      }
      var tr = b.getAttribute("data-tier");
      if (tr) {
        if (recording) { stop(); recording = false; setState("idle"); }
        try { localStorage.setItem("smd_voice_tier", tr); } catch (e) {}
        [].forEach.call(root.querySelectorAll(".smdv-tier"), function (x) { x.classList.toggle("on", x === b); });
      }
    });

    function setState(state, engine) {
      if (state === "listening") { recBtn.innerHTML = vcIco("stop") + " Listening… tap to stop"; recBtn.classList.add("live"); engEl.textContent = engine ? engine + " · speak now" : ""; }
      else if (state === "recording") { recBtn.innerHTML = vcIco("stop") + " Recording… tap to stop"; recBtn.classList.add("live"); engEl.textContent = "AI · recording (transcribes when you stop)"; }
      else if (state === "transcribing") { recBtn.innerHTML = vcIco("hourglass") + " Transcribing…"; recBtn.classList.remove("live"); engEl.textContent = (engine || "AI") + " · transcribing"; }
      else if (state === "downloading") { recBtn.innerHTML = vcIco("download") + " Downloading model…"; recBtn.classList.remove("live"); }
      else if (state === "preparing") { recBtn.innerHTML = vcIco("hourglass") + " Preparing…"; recBtn.classList.remove("live"); engEl.textContent = (engine || "") + " · preparing"; }
      else { recBtn.innerHTML = vcIco("mic") + " Tap to speak"; recBtn.classList.remove("live"); recording = false; }
    }

    recBtn.addEventListener("click", function () {
      if (recording) { recording = false; stop(); setState("idle"); return; }
      recording = true; base = ta.value ? ta.value.trim() : "";
      listen({
        engine: engineMode,                    // "fast" (default, unchanged) | "clinical" (Whisper)
        language: dictLang,                    // en | auto | te — Clinical uses the multilingual model for non-en
        onPartial: function (t) { ta.value = (base ? base + " " : "") + t; refreshExtract(); },
        onFinal: function (t) { if (t) { base = ((base ? base + " " : "") + t).trim(); ta.value = base; } refreshExtract(); recording = false; setState("idle"); },
        onDownloadProgress: function (p) { engEl.textContent = "Downloading model… " + Math.round((p || 0) * 100) + "%"; },
        onError: function (err) {
          recording = false; setState("idle");
          if (err === "clinical-unavailable") {
            engEl.textContent = "Clinical Dictation unavailable — switched to Fast. Tap to speak.";
            engineMode = "fast";
            [].forEach.call(root.querySelectorAll(".smdv-mode"), function (x) { x.classList.toggle("on", x.getAttribute("data-mode") === "fast"); });
            return;
          }
          engEl.textContent =
            (err === "mic-denied" || err === "mic-permission-denied") ? "Microphone access is off. Enable it in Settings → StewardMD → Microphone, then tap to speak." :
            // BUG-12: give the AVAudioSession/engine failure an actionable message instead of the raw code.
            (err === "recording-failure" || err === "transcription-failure") ? "Couldn't start recording. Check microphone access in Settings, close other apps using the mic, then tap to try again." :
            err === "model-download-failed" ? "Model download failed — check your connection and tap to retry." :
            (err === "model-corrupted" || err === "model-missing") ? "Clinical model unavailable — tap to re-download." :
            (err === "insufficient-storage" || err === "low-memory") ? "Not enough free space/memory for the voice model. Free up some space and try again, or use Fast mode." :
            err === "no-voice-engine" ? "No speech engine available on this device." :
            "Couldn't capture audio — tap to try again.";
        },
        onState: setState
      });
    });

    extractBtn.addEventListener("click", function () {
      var transcript = ta.value.trim(); if (!transcript) return;
      stop(); recording = false; setState("idle");
      if (target === "text") { if (opts.onText) { try { opts.onText(transcript); } catch (e) {} } close(); return; }
      extractBtn.disabled = true; extractBtn.textContent = "Extracting…";
      var catalog = (target === "reasoning" && window.DX && window.DX.findingCatalog) ? window.DX.findingCatalog() : null;
      (window.SMD_AI && window.SMD_AI.extract ? window.SMD_AI.extract(transcript, kind, catalog) : Promise.resolve({ error: "no-ai" }))
        .then(function (res) {
          extractBtn.textContent = "Extract & fill";
          if (!res || res.error) { reviewEl.innerHTML = '<div class="smdv-err">' + esc(errMsg(res && res.error)) + '</div>'; extractBtn.disabled = false; return; }
          if (target === "reasoning") reviewReasoning(res, catalog, reviewEl, opts);
          else reviewIcu(res, kind, opts);
        });
    });
  }

  function errMsg(e) {
    if (e === "ai-off") return "AI is not available on this build.";
    if (e === "quota") return "AI usage limit reached — try again later.";
    if (e === "server" || e === "no-ai") return "The extraction service is unavailable right now.";
    return "Couldn’t extract: " + (e || "unknown error");
  }

  /* --------- reasoning review: removable finding chips + unmatched --------- */
  function reviewReasoning(res, catalog, reviewEl, opts) {
    var labelOf = {}; (catalog || []).forEach(function (c) { labelOf[c.key] = c.label; });
    var keys = (res.findings || []).slice();
    var unmatched = res.unmatched || [];
    var pt = res.patient || null;
    if (!keys.length && !unmatched.length) { reviewEl.innerHTML = '<div class="smdv-err">No findings recognised. Try rephrasing, or add them by hand.</div>'; return; }
    function render() {
      var chips = keys.map(function (k) { return '<span class="smdv-chip" data-k="' + esc(k) + '">' + esc(labelOf[k] || k) + '<button class="smdv-chip-x" data-rm="' + esc(k) + '" aria-label="Remove">' + vcIco("close") + '</button></span>'; }).join("");
      reviewEl.innerHTML =
        (pt && (pt.age || pt.sex) ? '<div class="smdv-pt">Patient: ' + esc([pt.age ? pt.age + "y" : "", pt.sex || ""].filter(Boolean).join(" ")) + '</div>' : "") +
        '<div class="smdv-rv-h">Findings heard (' + keys.length + ') — tap ✕ to remove any that are wrong:</div>' +
        '<div class="smdv-chips">' + (chips || '<span class="smdv-muted">none</span>') + '</div>' +
        (unmatched.length ? '<div class="smdv-rv-h">Heard but not matched — add by hand if needed:</div><div class="smdv-unm">' + unmatched.map(function (u) { return '<span class="smdv-unmatched">' + esc(u) + '</span>'; }).join("") + '</div>' : "") +
        '<button class="smdv-apply" id="smdvApply"' + (keys.length ? "" : " disabled") + '>' + vcIco("plus") + ' Add ' + keys.length + ' finding' + (keys.length === 1 ? "" : "s") + ' to reasoning</button>';
      [].forEach.call(reviewEl.querySelectorAll("[data-rm]"), function (b) { b.addEventListener("click", function () { var k = b.getAttribute("data-rm"); keys = keys.filter(function (x) { return x !== k; }); render(); }); });
      var ap = reviewEl.querySelector("#smdvApply");
      if (ap) ap.addEventListener("click", function () {
        var added = (window.DX && window.DX.addFindings) ? window.DX.addFindings(keys) : 0;
        if (opts && opts.onApply) { try { opts.onApply(keys, pt); } catch (e) {} }
        close();
        try { (window.toast || function () {})("Added " + added + " finding" + (added === 1 ? "" : "s") + " — differential updated."); } catch (e) {}
      });
    }
    render();
  }

  /* --------- ICU review: hand extracted fields to the ICU review sheet --------- */
  function reviewIcu(res, kind, opts) {
    var fields = res.fields || {};
    if (!Object.keys(fields).length) { var rv = root && root.querySelector("#smdvReview"); if (rv) rv.innerHTML = '<div class="smdv-err">No values recognised for this category. Try again or type them in.</div>'; return; }
    close();
    if (window.ICU && typeof window.ICU.reviewVoice === "function") window.ICU.reviewVoice(fields, kind);
    else if (opts && opts.onApply) opts.onApply(fields, kind);
    else try { (window.toast || function () {})("Voice values captured — open the ICU dashboard to review."); } catch (e) {}
  }

  /* ------------------------------ styles ------------------------------- */
  function injectCSS() {
    if (document.getElementById("smdv-css")) return;
    var s = document.createElement("style"); s.id = "smdv-css";
    s.textContent = [
      ".smdv{position:fixed;inset:0;z-index:17000;font-family:var(--sans,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif);opacity:0;transition:opacity .2s;pointer-events:none}",
      ".smdv.on{opacity:1;pointer-events:auto}",
      ".smdv-scrim{position:absolute;inset:0;background:rgba(8,15,26,.55)}",
      ".smdv-sheet{position:absolute;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:var(--panel,#fff);color:var(--ink,#0f172a);border-radius:20px 20px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.3);transform:translateY(14px);transition:transform .22s}",
      ".smdv.on .smdv-sheet{transform:none}",
      ".smdv-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}",
      ".smdv-ttl{font:800 17px var(--sans)}",
      ".smdv-x{border:none;background:none;font:600 18px var(--sans);color:var(--slate-soft,#64748b);cursor:pointer;padding:4px 8px}",
      ".smdv-sub{font:500 13px/1.5 var(--sans);color:var(--slate-soft,#64748b);margin-bottom:12px}",
      ".smdv-kinds{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}",
      ".smdv-kind{border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);color:var(--ink,#0f172a);font:700 12.5px var(--sans);padding:8px 13px;border-radius:999px;cursor:pointer}",
      ".smdv-kind.on{background:var(--teal,#0f766e);color:#fff;border-color:var(--teal,#0f766e)}",
      ".smdv-modes{display:flex;gap:6px;margin-bottom:8px}",
      ".smdv-mode{flex:1;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);color:var(--ink,#0f172a);font:800 13px var(--sans);padding:10px;border-radius:12px;cursor:pointer}",
      ".smdv-mode.on{background:var(--teal,#0f766e);color:#fff;border-color:var(--teal,#0f766e)}",
      ".smdv-langs{display:flex;gap:6px;margin-bottom:8px}",
      ".smdv-lang{flex:1;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);color:var(--ink,#0f172a);font:700 12.5px var(--sans);padding:8px;border-radius:10px;cursor:pointer}",
      ".smdv-lang.on{background:var(--teal,#0f766e);color:#fff;border-color:var(--teal,#0f766e)}",
      ".smdv-tiers{display:flex;gap:6px;margin-bottom:8px}",
      ".smdv-tier{flex:1;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);color:var(--ink,#0f172a);font:800 12.5px var(--sans);padding:8px;border-radius:10px;cursor:pointer}",
      ".smdv-tier.on{background:var(--teal,#0f766e);color:#fff;border-color:var(--teal,#0f766e)}",
      ".smdv-mode-hint{font:600 11px/1.4 var(--sans);color:var(--slate-soft,#64748b);margin:-2px 0 10px;min-height:0}",
      ".smdv-model-mgr{margin:-2px 0 10px;min-height:0}",
      ".smdv-model-del{border:1px solid var(--line,#e2e8f0);background:transparent;color:var(--slate-soft,#64748b);font:700 11.5px var(--sans);padding:7px 11px;border-radius:10px;cursor:pointer}",
      ".smdv-model-del:active{transform:scale(.97)}",
      ".smdv-model-gone{font:600 11.5px var(--sans);color:var(--slate-soft,#64748b);padding:4px 0}",
      ".smdv-rec{width:100%;border:none;border-radius:14px;background:var(--teal,#0f766e);color:#fff;font:800 15px var(--sans);padding:15px;cursor:pointer;margin-bottom:8px}",
      ".smdv-rec.live{background:#b91c1c;animation:smdvpulse 1.3s infinite}",
      "@keyframes smdvpulse{0%,100%{box-shadow:0 0 0 0 rgba(185,28,28,.5)}50%{box-shadow:0 0 0 8px rgba(185,28,28,0)}}",
      ".smdv-eng{font:600 11.5px var(--sans);color:var(--slate-soft,#64748b);text-align:center;min-height:15px;margin-bottom:8px}",
      ".smdv-ta{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#e2e8f0);border-radius:12px;padding:11px 13px;font:500 14px/1.5 var(--sans);background:var(--panel,#fff);color:var(--ink,#0f172a);resize:vertical;margin-bottom:8px}",
      ".smdv-disc{font:500 11px/1.5 var(--sans);color:var(--slate-soft,#64748b);margin-bottom:12px}",
      ".smdv-extract{width:100%;border:1.5px solid var(--teal,#0f766e);background:var(--teal-soft,#e3f1ee);color:var(--teal,#0f766e);font:800 14px var(--sans);padding:13px;border-radius:12px;cursor:pointer}",
      ".smdv-extract:disabled{opacity:.5;cursor:default}",
      ".smdv-review{margin-top:14px}",
      ".smdv-err{background:#fdebe1;border:1px solid #f3b88e;color:#b5460f;border-radius:10px;padding:10px 12px;font:600 12.5px/1.5 var(--sans)}",
      ".smdv-rv-h{font:700 12.5px var(--sans);color:var(--ink,#0f172a);margin:10px 0 7px}",
      ".smdv-pt{font:700 12.5px var(--sans);color:var(--teal,#0f766e);margin-bottom:4px}",
      ".smdv-chips{display:flex;flex-wrap:wrap;gap:7px}",
      ".smdv-chip{display:inline-flex;align-items:center;gap:5px;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0f766e);border:1px solid var(--teal,#0f766e);border-radius:999px;padding:5px 6px 5px 11px;font:700 12.5px var(--sans)}",
      ".smdv-chip-x{border:none;background:rgba(15,118,110,.18);color:var(--teal,#0f766e);width:18px;height:18px;border-radius:999px;font:700 11px var(--sans);cursor:pointer;line-height:1}",
      ".smdv-unm{display:flex;flex-wrap:wrap;gap:6px}",
      ".smdv-unmatched{background:var(--bg,#f1f5f9);border:1px dashed var(--line,#cbd5e1);color:var(--slate,#334155);border-radius:8px;padding:4px 9px;font:600 12px var(--sans)}",
      ".smdv-muted{color:var(--slate-soft,#94a3b8);font:600 12.5px var(--sans)}",
      ".smdv-apply{width:100%;margin-top:12px;border:none;border-radius:12px;background:var(--teal,#0f766e);color:#fff;font:800 14px var(--sans);padding:13px;cursor:pointer}",
      ".smdv-apply:disabled{opacity:.5;cursor:default}",
      "body.dark .smdv-sheet{--panel:#132030;--ink:#e8edf2}",
      "body.dark .smdv-unmatched{background:#0d1b26}",
      // Settings dashboard (sidebar)
      ".smdv-ms{font:600 12.5px var(--sans)}",
      ".smdv-ms-note{font:600 12px var(--sans);color:var(--slate-soft,#64748b);padding:4px 0}",
      ".smdv-ms-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}",
      ".smdv-ms-lbl{color:var(--ink,#14202b)}.smdv-ms-lbl em{color:var(--slate-soft,#64748b);font-style:normal;font-weight:600}",
      ".smdv-ms-sw{width:40px;height:23px;border-radius:999px;border:none;background:var(--line,#cbd5e1);position:relative;cursor:pointer;flex:none}",
      ".smdv-ms-sw>span{position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:999px;background:#fff;transition:left .15s}",
      ".smdv-ms-sw.on{background:var(--teal,#0f766e)}.smdv-ms-sw.on>span{left:19px}",
      ".smdv-ms-tiers{display:flex;gap:6px;margin-bottom:9px}",
      ".smdv-ms-tier{flex:1;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);color:var(--ink,#0f172a);font:800 12px var(--sans);padding:7px;border-radius:9px;cursor:pointer}",
      ".smdv-ms-tier.on{background:var(--teal,#0f766e);color:#fff;border-color:var(--teal,#0f766e)}",
      ".smdv-ms-m{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line,#eef2f5)}",
      ".smdv-ms-mt{display:block;color:var(--ink,#14202b);font:700 12.5px var(--sans)}",
      ".smdv-ms-mb{display:block;color:var(--slate-soft,#64748b);font:600 11.5px var(--sans);margin-top:1px}",
      ".smdv-ms-dl,.smdv-ms-del{border:1px solid var(--teal,#0f766e);background:var(--teal-soft,#e3f1ee);color:var(--teal,#0f766e);font:800 12px var(--sans);padding:6px 12px;border-radius:9px;cursor:pointer;min-width:74px}",
      ".smdv-ms-dl:disabled{opacity:.7;cursor:default}",
      ".smdv-ms-del{border-color:#d99;background:#fdebe1;color:#b5460f}",
      ".smdv-ms-hint{font:600 11px/1.5 var(--sans);color:var(--slate-soft,#64748b);margin-top:8px}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  // ── MaiK Scribe · Voice-model dashboard (rendered in the sidebar Settings ▸ Advanced block).
  // Lets the clinician enable tiers, pick Base/Pro/Ultimate, and DOWNLOAD/DELETE each on-device model
  // with a progress %, so first use doesn't depend on dictating (and never needs a dev console). ──
  function modelSettingsHTML() {
    if (!whisperPluginPresent()) return '<div class="smdv-ms-note">On-device voice models are available in the iOS app only.</div>';
    var on = tiersFlagOn(), tier = voiceTier();
    return '<div class="smdv-ms" data-smdv-ms>' +
      '<div class="smdv-ms-row"><span class="smdv-ms-lbl">Multilingual tiers <em>(English · Hindi · Telugu)</em></span>' +
        '<button class="smdv-ms-sw' + (on ? " on" : "") + '" data-smdv-ms-flag role="switch" aria-checked="' + on + '" aria-label="Enable Steward Voice tiers"><span></span></button></div>' +
      '<div class="smdv-ms-tiers"' + (on ? "" : ' style="opacity:.4;pointer-events:none"') + '>' +
        ["base", "pro", "ultimate"].map(function (t) { return '<button class="smdv-ms-tier' + (tier === t ? " on" : "") + '" data-smdv-ms-tier="' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + "</button>"; }).join("") +
      '</div>' +
      '<div class="smdv-ms-models" data-smdv-ms-models></div>' +
      '<div class="smdv-ms-hint">Downloads once over Wi-Fi. Telugu routes to the specialist on Pro/Ultimate.</div>' +
    '</div>';
  }
  function wireModelSettings(container) {
    if (!container) return;
    var box = container.querySelector("[data-smdv-ms]"); if (!box) return;
    var modelsEl = box.querySelector("[data-smdv-ms-models]");
    var N = window.SMD_NATIVE;
    function metaRow(key) {
      var meta = MODEL_META[key] || { label: key, mb: "?" };
      return '<div class="smdv-ms-m" data-key="' + key + '">' +
        '<div class="smdv-ms-ml"><span class="smdv-ms-mt">' + meta.label + '</span><span class="smdv-ms-mb">~' + meta.mb + ' MB · <b data-st>checking…</b></span></div>' +
        '<div class="smdv-ms-actions"><button class="smdv-ms-dl" data-dl>Download</button><button class="smdv-ms-del" data-del style="display:none">Delete</button></div>' +
      '</div>';
    }
    function refreshStatus(key) {
      var rowEl = modelsEl.querySelector('.smdv-ms-m[data-key="' + key + '"]'); if (!rowEl) return;
      var st = rowEl.querySelector("[data-st]"), dl = rowEl.querySelector("[data-dl]"), del = rowEl.querySelector("[data-del]");
      if (!(N && N.whisperModelInstalled)) { st.textContent = "native app only"; dl.style.display = "none"; return; }
      N.whisperModelInstalled(key).then(function (r) {
        var ok = r && r.installed;
        st.textContent = ok ? "Installed" : "Not installed";
        dl.style.display = ok ? "none" : ""; del.style.display = ok ? "" : "none";
        if (!ok) { dl.disabled = false; dl.textContent = "Download"; }
      }).catch(function () { st.textContent = "—"; });
    }
    function renderModels() {
      if (!tiersFlagOn()) { modelsEl.innerHTML = ""; return; }
      var keys = TIER_MODELS[voiceTier()] || [];
      modelsEl.innerHTML = keys.map(metaRow).join("");
      keys.forEach(refreshStatus);
    }
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-smdv-ms-flag],[data-smdv-ms-tier],[data-dl],[data-del]"); if (!b) return;
      if (b.hasAttribute("data-smdv-ms-flag")) {
        var now = !tiersFlagOn(); try { localStorage.setItem("smd_voice_tiers", now ? "1" : "0"); } catch (e2) {}
        b.classList.toggle("on", now); b.setAttribute("aria-checked", now);
        var tiers = box.querySelector(".smdv-ms-tiers"); if (tiers) { tiers.style.opacity = now ? "" : ".4"; tiers.style.pointerEvents = now ? "" : "none"; }
        renderModels(); return;
      }
      var t = b.getAttribute("data-smdv-ms-tier");
      if (t) { try { localStorage.setItem("smd_voice_tier", t); } catch (e2) {} [].forEach.call(box.querySelectorAll(".smdv-ms-tier"), function (x) { x.classList.toggle("on", x === b); }); renderModels(); return; }
      var mrow = b.closest(".smdv-ms-m"); if (!mrow) return; var key = mrow.getAttribute("data-key");
      if (b.hasAttribute("data-dl")) {
        if (!(N && N.downloadWhisperModel)) { (window.toast || function () {})("Available in the app."); return; }
        b.disabled = true; b.textContent = "0%";
        N.downloadWhisperModel(key, { onProgress: function (p) { b.textContent = Math.round((p || 0) * 100) + "%"; } })
          .then(function () { refreshStatus(key); (window.toast || function () {})("Model downloaded."); })
          .catch(function (err) { b.disabled = false; b.textContent = "Retry"; (window.toast || function () {})("Download failed: " + err); });
        return;
      }
      if (b.hasAttribute("data-del")) {
        if (!window.confirm("Delete this voice model? It will re-download when needed.")) return;
        if (N && N.deleteWhisperModel) N.deleteWhisperModel(key).then(function () { refreshStatus(key); (window.toast || function () {})("Model removed."); }).catch(function () {});
        return;
      }
    });
    renderModels();
  }

  window.SMD_VOICE = { listen: listen, stop: stop, openDialog: openDialog, modelSettingsHTML: modelSettingsHTML, wireModelSettings: wireModelSettings, available: function () { return { native: !!(window.SMD_NATIVE && window.SMD_NATIVE.transcribe), webspeech: !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !isIOS(), aistt: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder), whisper: whisperAvailable() }; } };
})();
