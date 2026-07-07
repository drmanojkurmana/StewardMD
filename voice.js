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

  function isIOS() { return /iP(hone|ad|od)/i.test(navigator.userAgent || ""); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function blobToDataURL(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(b); }); }

  /* ------------------------------ capture ------------------------------ */
  var _active = null;   // { engine, mode:'stream'|'record', stop }
  function stop() { if (_active && _active.stop) { try { _active.stop(); } catch (e) {} } _active = null; }

  function listen(opts) {
    opts = opts || {};
    stop();
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
    root.innerHTML =
      '<div class="smdv-scrim" data-act="close"></div>' +
      '<div class="smdv-sheet" role="dialog" aria-modal="true" aria-label="MaiK Scribe voice intake">' +
        '<div class="smdv-hd"><span class="smdv-ttl">🎤 MaiK Scribe</span><button class="smdv-x" data-act="close" aria-label="Close">✕</button></div>' +
        '<div class="smdv-sub">' + (target === "icu" ? "Speak this patient’s vitals, labs, ABG or ventilator settings." : target === "text" ? "Speak your question or notes — tap ✓ to drop the text into the chat." : "Describe your patient in plain speech — symptoms, signs, key numbers.") + '</div>' +
        kindSel +
        '<button class="smdv-rec" id="smdvRec">🎤 Tap to speak</button>' +
        '<div class="smdv-eng" id="smdvEng"></div>' +
        '<textarea class="smdv-ta" id="smdvTa" rows="4" placeholder="Your words appear here — you can edit before extracting."></textarea>' +
        '<div class="smdv-disc">On-device speech stays private (only text is used). AI transcription/extraction sends audio/text to the server — the same as Photo scan. Nothing is applied until you review &amp; confirm.</div>' +
        '<button class="smdv-extract" id="smdvExtract" disabled>' + (target === "text" ? "✓ Use this text" : "Extract &amp; fill") + '</button>' +
        '<div class="smdv-review" id="smdvReview"></div>' +
      '</div>';
    document.body.appendChild(root);
    requestAnimationFrame(function () { root.classList.add("on"); });

    var ta = root.querySelector("#smdvTa");
    var recBtn = root.querySelector("#smdvRec");
    var engEl = root.querySelector("#smdvEng");
    var extractBtn = root.querySelector("#smdvExtract");
    var reviewEl = root.querySelector("#smdvReview");
    var kind = target === "icu" ? "monitor" : "reasoning";
    var recording = false, base = "";

    function refreshExtract() { extractBtn.disabled = !ta.value.trim(); }
    ta.addEventListener("input", function () { base = ta.value; refreshExtract(); });

    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act],[data-kind]"); if (!b) return;
      if (b.getAttribute("data-act") === "close") return close();
      var kk = b.getAttribute("data-kind");
      if (kk) { kind = kk; [].forEach.call(root.querySelectorAll(".smdv-kind"), function (x) { x.classList.toggle("on", x === b); }); }
    });

    function setState(state, engine) {
      if (state === "listening") { recBtn.textContent = "⏹ Listening… tap to stop"; recBtn.classList.add("live"); engEl.textContent = engine ? engine + " · speak now" : ""; }
      else if (state === "recording") { recBtn.textContent = "⏹ Recording… tap to stop"; recBtn.classList.add("live"); engEl.textContent = "AI · recording (transcribes when you stop)"; }
      else if (state === "transcribing") { recBtn.textContent = "⏳ Transcribing…"; recBtn.classList.remove("live"); engEl.textContent = "AI · transcribing"; }
      else { recBtn.textContent = "🎤 Tap to speak"; recBtn.classList.remove("live"); recording = false; }
    }

    recBtn.addEventListener("click", function () {
      if (recording) { recording = false; stop(); setState("idle"); return; }
      recording = true; base = ta.value ? ta.value.trim() : "";
      listen({
        onPartial: function (t) { ta.value = (base ? base + " " : "") + t; refreshExtract(); },
        onFinal: function (t) { if (t) { base = ((base ? base + " " : "") + t).trim(); ta.value = base; } refreshExtract(); recording = false; setState("idle"); },
        onError: function (err) { recording = false; setState("idle"); engEl.textContent = err === "mic-denied" ? "Microphone permission denied." : (err === "no-voice-engine" ? "No speech engine available on this device." : "Voice error: " + err); },
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
      var chips = keys.map(function (k) { return '<span class="smdv-chip" data-k="' + esc(k) + '">' + esc(labelOf[k] || k) + '<button class="smdv-chip-x" data-rm="' + esc(k) + '" aria-label="Remove">✕</button></span>'; }).join("");
      reviewEl.innerHTML =
        (pt && (pt.age || pt.sex) ? '<div class="smdv-pt">Patient: ' + esc([pt.age ? pt.age + "y" : "", pt.sex || ""].filter(Boolean).join(" ")) + '</div>' : "") +
        '<div class="smdv-rv-h">Findings heard (' + keys.length + ') — tap ✕ to remove any that are wrong:</div>' +
        '<div class="smdv-chips">' + (chips || '<span class="smdv-muted">none</span>') + '</div>' +
        (unmatched.length ? '<div class="smdv-rv-h">Heard but not matched — add by hand if needed:</div><div class="smdv-unm">' + unmatched.map(function (u) { return '<span class="smdv-unmatched">' + esc(u) + '</span>'; }).join("") + '</div>' : "") +
        '<button class="smdv-apply" id="smdvApply"' + (keys.length ? "" : " disabled") + '>＋ Add ' + keys.length + ' finding' + (keys.length === 1 ? "" : "s") + ' to reasoning</button>';
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
      "body.dark .smdv-unmatched{background:#0d1b26}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  window.SMD_VOICE = { listen: listen, stop: stop, openDialog: openDialog, available: function () { return { native: !!(window.SMD_NATIVE && window.SMD_NATIVE.transcribe), webspeech: !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !isIOS(), aistt: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder) }; } };
})();
