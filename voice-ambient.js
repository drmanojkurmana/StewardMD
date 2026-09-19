/* StewardMD — Ambient consultation controller (voice → live assessment autofill).
 * ---------------------------------------------------------------------------
 * Thin orchestrator over the EXISTING capture stack. It does NOT own an ASR engine —
 * it drives SMD_VOICE.listen (on-device Whisper) and, on each transcript update, runs the
 * deterministic layer (SMD_VVITALS + SMD_EMRMAP) to fill assessment fields in near-real-time.
 * Complex narrative the regex layer can't parse (complaints / history / diagnosis) is escalated
 * to an injected LLM extractor — THROTTLED, and only when a chunk is actually narrative, never
 * per word. No LLM injected ⇒ deterministic-only ⇒ fully offline.
 *
 * ROLLING CAPTURE (Task 5): today's Whisper plugin only transcribes on stop (record-then-
 * transcribe, no mid-recording partials), so start() re-arms `SMD_VOICE.listen` in back-to-back
 * `chunkMs` windows — each window's onFinal is folded into a running transcript via accumulate(),
 * then the next window starts immediately. `onRefine(fullTranscript)` fires per needsRefine(state)
 * (every `refineEveryChunks` windows + on stop) so a caller can run an LLM+grounding pass on the
 * growing transcript.
 *
 * CONTINUOUS CAPTURE (flag `smd_voice_continuous`, DEFAULT OFF): when the native plugin exposes
 * flushTranscribe, a window boundary flushes the captured audio instead of stopping the mic, so the
 * few hundred ms lost at every re-arm seam are not lost at all. Falls back to the chunking above on
 * any build without it. See local-plugins/capacitor-whisper/README.md + README-ANDROID.md.
 *
 * AUTO LANGUAGE PROBE (flag `smd_voice_lang_probe`, DEFAULT ON): in Auto the first window is a SHORT
 * (~1.5s) detection-only pass on the multilingual weights, and the session routes by what it read. A
 * Latin-script probe is a clean transcript and is KEPT, folded into the transcript like any other
 * chunk — nothing captured is ever thrown away. Any other script still has to be discarded (see
 * onChunkFinal): the multilingual weights render real Telugu as garbage Devanagari too, so the text
 * alone can't tell that apart from genuine Hindi. `opts.sessionId`, if passed, remembers the probe's
 * answer across a Stop-then-restart ("record more") within the SAME encounter so the 252MB
 * probe-model load + decode + discard + specialist-load cycle is not paid twice for one consult.
 *
 *   SMD_AMBIENT.start({ speaker, getState, onUpdate, onTranscript, onState, onError,
 *                       language, model, llmExtract, chunkMs, refineEveryChunks, onRefine, sessionId })
 *     → { stop, pause, resume }
 *
 * Pure, exported helpers (Node-testable, no timers/DOM):
 *   reduce(transcript, {speaker,state,now}) → { updates, dropped }   (deterministic path)
 *   needsLLM(transcript, sentChars) → new narrative tail to send, or ""  (escalation gate)
 *   accumulate(prev, chunkText) → fullTranscript                    (seam-overlap-safe join)
 *   needsRefine(state) → bool                                       (refine cadence gate)
 *   useFlush(session, flagIsOn) → bool                              (continuous-capture gate)
 *   probeRoute(probeText) → "en" | ""                               (Auto first-chunk routing)
 *
 * window.SMD_AMBIENT + module.exports.
 */
(function (root) {
  "use strict";

  var VV = pick("SMD_VVITALS", "./voice-vitals.js");
  var MAP = pick("SMD_EMRMAP", "./voice-emr-map.js");
  function pick(glob, path) {
    if (root && root[glob]) return root[glob];
    try { return require(path); } catch (e) { return null; }
  }

  // deterministic reduce: full transcript → field updates (idempotent; extract() dedupes per field)
  // ponytail: re-extract the whole transcript each tick, O(n·ticks). Fine for consult-length text.
  function reduce(transcript, opts) {
    opts = opts || {};
    var recs = VV ? VV.extract(transcript) : [];
    return MAP ? MAP.merge(recs, opts) : { updates: [], dropped: [] };
  }

  // words the deterministic layer already handles — stripped before judging "is this narrative?"
  var CLINICAL_TOKENS = /\b(bp|pulse|hr|rr|temp|temperature|gcs|spo2|sats?|pallor|icterus|cyanosis|clubbing|oedema|edema|tender|tenderness|murmur|thrill|wheeze|rhonchi|crepts?|crackles?|vesicular|conscious|oriented|drowsy|coma|neck|kernig|bowel|liver|spleen|ascites|abdomen|regular|irregular|normal|present|absent|mmhg|min|degree|fahrenheit|celsius)\b/g;
  // Escalate to the LLM only when the NEW speech since last send carries real narrative
  // (complaints / history / diagnosis) beyond numbers + exam keywords. Returns the tail to send, or "".
  function needsLLM(transcript, sentChars, minWords) {
    minWords = minWords || 6;
    var tail = String(transcript || "").slice(sentChars || 0).trim();
    if (tail.length < 20) return "";
    var narrative = tail.toLowerCase().replace(/[\d.\/%°:-]+/g, " ").replace(CLINICAL_TOKENS, " ");
    var words = narrative.split(/\s+/).filter(function (w) { return w.length >= 4; });
    return words.length >= minWords ? tail : "";
  }

  // Accumulate transcript chunk: append chunkText to prev, trimming word-level overlap at seam.
  // Handles Whisper's terminal punctuation at clause boundaries (exactly where 15s chunks split).
  // Requires >= 2-word overlap to avoid spurious single-word dedup (protects "no"/"the"/etc).
  function accumulate(prev, chunkText) {
    prev = String(prev || "").trim();
    chunkText = String(chunkText || "").trim();
    if (!prev) return chunkText;
    if (!chunkText) return prev;
    // Normalize word for comparison: strip trailing punctuation and lowercase.
    function normWord(w) { return String(w || "").toLowerCase().replace(/[.,!?;:]+$/, ""); }
    var prevWords = prev.split(/\s+/);
    var chunkWords = chunkText.split(/\s+/);
    var overlapLen = 0;
    // Find longest word-level overlap (after punctuation normalization).
    for (var i = 1; i <= Math.min(prevWords.length, chunkWords.length); i++) {
      var prevTail = prevWords.slice(-i).map(normWord).join(" ");
      var chunkHead = chunkWords.slice(0, i).map(normWord).join(" ");
      if (prevTail === chunkHead) { overlapLen = i; }
    }
    // Only trim if overlap is >= 2 words (avoid spurious single-word dedup).
    if (overlapLen >= 2) {
      var remaining = chunkWords.slice(overlapLen).join(" ");
      if (remaining) {
        // Strip trailing punctuation from prev at overlap point (Whisper adds period at seams)
        var prevNorm = prev.replace(/[.,!?;:]+$/, "");
        return prevNorm + " " + remaining;
      } else {
        return prev;
      }
    }
    return prev + " " + chunkText;
  }

  // Check if this state should trigger a refine (LLM pass for narrative polish).
  // Fires on final OR every refineEveryChunks (guard against 0/undefined).
  function needsRefine(state) {
    state = state || {};
    if (state.final === true) return true;
    var refineEveryChunks = state.refineEveryChunks;
    var chunkN = state.chunkN;
    if (!refineEveryChunks || refineEveryChunks <= 0 || !chunkN || chunkN <= 0) return false;
    return chunkN % refineEveryChunks === 0;
  }

  function now() { try { return Date.now(); } catch (e) { return 0; } }
  // Lightweight tracing for on-device debugging (visible in Safari Web Inspector). Prefix [SV-amb].
  function dbg() { try { if (root && root.console && console.info) console.info.apply(console, ["[SV-amb]"].concat([].slice.call(arguments))); } catch (e) {} }
  // Detect the chunk's language from its script so Auto mode can route the NEXT chunk to the right
  // model (Telugu → specialist, Devanagari → Hindi, else English). Telugu block U+0C00–0C7F, Devanagari U+0900–097F.
  function detectScript(t) { t = String(t || ""); if (/[ఀ-౿]/.test(t)) return "te"; if (/[ऀ-ॿ]/.test(t)) return "hi"; if (/[a-z]/i.test(t)) return "en"; return ""; }

  // localStorage flags, read through `root` so the module stays inert in Node (tests) and on any host
  // without storage. The OFF-by-default and ON-by-default readers are separate on purpose: a value
  // nobody wrote (or a typo) can never flip a default in either direction.
  function flagOn(key) { try { var v = root && root.localStorage && root.localStorage.getItem(key); return v === "1" || v === "on" || v === "true"; } catch (e) { return false; } }
  function flagOff(key) { try { var v = root && root.localStorage && root.localStorage.getItem(key); return v === "0" || v === "off" || v === "false"; } catch (e) { return false; } }

  // CONTINUOUS CAPTURE gate (smd_voice_continuous, DEFAULT OFF). True only when the flag is on AND
  // this build's capture session actually exposes a native flush — i.e. a plugin binary that ships
  // flushTranscribe. Anything else keeps today's stop-to-transcribe chunking, unchanged.
  function useFlush(session, flagIsOn) { return !!(flagIsOn && session && typeof session.flush === "function"); }

  // AUTO first-chunk language probe (smd_voice_lang_probe, DEFAULT ON). The probe window decodes on
  // the MULTILINGUAL weights with language "auto" (the only model where "auto" is safe), and this
  // reads its text to decide the session's language.
  // Latin script => English: that is the bug being fixed — Auto opens on the Telugu specialist, so an
  // English consult comes out as English TRANSLITERATED into Telugu script and detectScript() then
  // pins the specialist for the rest of the session.
  // Anything else => "" (no decision, keep today's behaviour). MEASURED: the multilingual weights
  // render real Telugu as garbage DEVANAGARI, so a non-Latin probe cannot tell Telugu from Hindi and
  // must not try — the specialist is already the right opening for both. This is a ROUTING decision
  // only; whether the probe's TEXT is kept or discarded is decided separately in onChunkFinal (kept
  // when this returns "en", discarded otherwise — see the AUTO LANGUAGE PROBE header comment).
  function probeRoute(text) { return detectScript(text) === "en" ? "en" : ""; }
  // A benign "the speaker just paused" endpoint, not a real failure — iOS SFSpeech reports these on
  // every silence gap ("No speech detected"/"No match"/"Retry"). Kept separate from hard errors
  // (recording-failure, transcription-failed, mic-denied) which SHOULD count toward the breaker.
  function isSilence(e) { var s = String(e || "").toLowerCase(); return s.indexOf("no speech") >= 0 || s.indexOf("no match") >= 0 || s.indexOf("nomatch") >= 0 || s.indexOf("retry") >= 0 || s.indexOf("1110") >= 0 || s.indexOf("203") >= 0; }

  // Cross-restart probe memory, OPT-IN via opts.sessionId. `probeDone`/`detectedLang` used to live only
  // inside start()'s closure, so Stop then "record more" (a caller calling start() again) forgot the
  // probe ever ran and paid the whole cost again: 252MB multilingual load, decode, discard, free, THEN
  // the 252MB specialist load. Keyed by sessionId so two different encounters never share a language —
  // stale cross-consult routing is exactly the bug this module exists to avoid (real Telugu decoded on
  // the wrong model renders as garbage). No sessionId => today's behaviour, byte-for-byte: a fresh probe
  // every start() call, same as every caller that hasn't opted in yet.
  var langSessions = {};
  function getLangSession(id) {
    if (!id) return null;
    if (!langSessions[id]) langSessions[id] = { probeDone: false, detectedLang: null };
    return langSessions[id];
  }

  function start(opts) {
    opts = opts || {};
    var speaker = opts.speaker || "doctor";
    var getState = opts.getState || function () { return {}; };
    // `pausing` = a pause has been requested and the in-flight window is being flushed, but `paused`
    // must stay FALSE until that window lands. Everything that delivers a chunk (tick -> the on-screen
    // transcript, and onRefine -> the note draft) is gated on !paused, so setting paused up front
    // silently threw away whatever was said since the last chunk boundary: Stop worked, Pause showed
    // nothing. See the pause() handler below.
    var running = true, paused = false, pausing = false, sentChars = 0, tmr = null, lastTranscript = "";
    var THROTTLE = opts.throttleMs || 1200;
    var chunkMs = opts.chunkMs || 15000;
    var refineEveryChunks = opts.refineEveryChunks;
    var onRefine = opts.onRefine;
    // rolling-capture state (Task 5) — see armChunk() below
    var fullTranscript = "", chunkN = 0, chunkTimer = null, fbTimer = null, curSession = null, stopping = false;
    var chunkStarted = false, sawDownload = false;   // per-chunk: gate the window timer on real recording
    // Rolling capture starts on clinical (on-device Whisper). If Whisper is unavailable on this
    // device/build (Android ships no Whisper build; iOS model download can fail), fall back ONCE to
    // the phone's built-in on-device STT so autofill still works. Telugu accuracy still wants Whisper.
    var engine = opts.engine || "clinical", clinicalErrs = 0, errStreak = 0, rearmTimer = null, silenceStreak = 0;
    // Cross-restart memory for THIS encounter (see getLangSession() above) — undefined/null sessionId
    // just means no memory, i.e. today's behaviour.
    var langSession = getLangSession(opts.sessionId);
    // Auto-mode adaptive routing: the language observed in the last chunk picks the model for the next
    // one (Telugu → specialist, en/hi → the multilingual/turbo). null until the first chunk lands
    // (or seeded from a prior start() in the same session — see langSession above).
    var detectedLang = langSession ? langSession.detectedLang : null;
    function setDetectedLang(v) { detectedLang = v; if (langSession) langSession.detectedLang = v; }
    // Continuous capture (flag OFF by default): flush the mic buffer instead of stopping it at each
    // window boundary. Read once per session so a mid-consult flag change can't half-switch the loop.
    var continuous = flagOn("smd_voice_continuous");
    // Auto first-chunk language probe (flag ON by default) — see probeRoute() above. SHORT: a detection
    // pass, not a consultation chunk — kept short so that even a discarded (non-Latin, see onChunkFinal)
    // probe window loses only a fraction of a second, not the 4s a longer probe would cost.
    var probeEnabled = !flagOff("smd_voice_lang_probe");
    var probeMs = opts.probeMs || 1500;
    var probing = false, probeDone = langSession ? langSession.probeDone : false;
    function setProbeDone(v) { probeDone = v; if (langSession) langSession.probeDone = v; }

    function apply(transcript) {
      lastTranscript = transcript;
      if (opts.onTranscript) opts.onTranscript(transcript);
      var res = reduce(transcript, { speaker: speaker, state: getState(), now: now() });
      if (opts.onUpdate) opts.onUpdate(res);            // deterministic fields land immediately
    }

    // throttled LLM escalation for narrative fields (complaints/history/dx)
    function maybeLLM(transcript, force) {
      if (!opts.llmExtract) return;                     // no LLM ⇒ deterministic-only / offline
      var tail = needsLLM(transcript, sentChars);
      if (!tail && !force) return;
      if (!transcript || transcript.length <= sentChars) return;
      sentChars = transcript.length;
      Promise.resolve(opts.llmExtract(transcript, speaker)).then(function (res) {
        if (!running || !res || !res.fields) return;
        var recs = Object.keys(res.fields).map(function (f) { return { field: f, value: res.fields[f], confidence: res.confidence || 0.7, srcText: "" }; });
        var merged = MAP ? MAP.merge(recs, { speaker: speaker, state: getState(), now: now() }) : { updates: recs };
        if (opts.onUpdate) opts.onUpdate(merged);
      }).catch(function () {});
    }

    function tick(transcript, isFinal) {
      if (!running || paused) return;
      apply(transcript);                                // deterministic every tick (cheap)
      if (isFinal) { maybeLLM(transcript, true); return; }
      if (tmr) return;                                  // trailing throttle for the LLM only
      tmr = setTimeout(function () { tmr = null; maybeLLM(lastTranscript, false); }, THROTTLE);
    }

    // Rolling capture (Task 5, option b — JS re-arm): today's Whisper plugin is record-then-
    // transcribe (no mid-recording partials — see capacitor-whisper README, `whisperPartial`
    // reserved), so a single `listen()` call would only yield one transcript at the very end.
    // Instead we run back-to-back chunkMs-bounded recordings: start → chunkMs later, stop (which
    // triggers on-device transcription → onFinal for THAT window) → fold into the running
    // transcript via accumulate() → immediately start the next window. The deterministic path
    // (tick→apply→reduce) and the throttled per-chunk LLM (maybeLLM) run over the accumulated
    // transcript exactly as before; onRefine additionally fires per needsRefine(state).
    function armChunk() {
      if (!running || paused || !root || !root.SMD_VOICE) return;
      chunkStarted = false; sawDownload = false;   // reset per-window recording gate
      // In Auto, once we've seen a chunk's language, route the next chunk to that language's model.
      var reqLang = opts.language || "auto";
      var effLang = (reqLang === "auto" && detectedLang) ? detectedLang : reqLang;
      // MODEL = best weights for the (detected) language — Telugu routes to the Telugu specialist.
      // DECODE language = "auto" in Auto mode so ONE person speaking a mixed Telugu+English+Hindi
      // utterance is transcribed in whichever language actually dominates that window (Whisper
      // auto-detects) instead of being force-decoded as a single language. Forced EN/TE keep their hint.
      // CAVEAT (measured on the real q8_0 weights, same clip, only the flag changed): "auto" on the
      // Telugu SPECIALIST yields INVALID UTF-8 ("�లో …", U+FFFD wall on device) while "te" yields
      // clean Telugu ("హలో …"). whisper.cpp reads "auto" as auto-DETECTION, and a single-language
      // fine-tune detects badly. SMD_VOICE.listen() therefore pins auto->te whenever it resolves the
      // specialist; leaving "auto" here is still correct for the multilingual weights.
      var routedModel = opts.model || (root.SMD_VOICE.pickModel ? root.SMD_VOICE.pickModel(effLang) : undefined);
      var decodeLang = (reqLang === "auto") ? "auto" : reqLang;
      // FIRST window in Auto = a short DETECTION-ONLY pass on the multilingual weights (probeRoute()).
      // Decoding "auto" is safe there and only there; the specialist stays pinned to "te" as measured.
      // Skipped when the caller pinned a model, off Clinical (the fast fallback has no model routing),
      // and after it has run once per session.
      probing = !!(probeEnabled && !probeDone && !opts.model && engine === "clinical" &&
                   reqLang === "auto" && detectedLang === null && root.SMD_VOICE.probeModel);
      if (probing) { routedModel = root.SMD_VOICE.probeModel(); decodeLang = "auto"; }
      // Tell the caller which on-device model this chunk will use (for the "which model" chip).
      try {
        if (opts.onModel && engine === "clinical" && root.SMD_VOICE.pickModel) {
          var mk = probing ? routedModel : root.SMD_VOICE.pickModel(effLang);
          opts.onModel(root.SMD_VOICE.modelCode ? root.SMD_VOICE.modelCode(mk) : mk, effLang);
        } else if (opts.onModel && engine === "fast") { opts.onModel("Device STT", effLang); }
      } catch (e) {}
      dbg("arm", "engine=" + engine, "reqLang=" + reqLang, "effLang=" + effLang, "model=" + (opts.model || "(tier-routed)"));
      curSession = root.SMD_VOICE.listen({
        engine: engine,
        model: routedModel,                               // Telugu-containing / undetected chunks -> Telugu specialist weights
        language: decodeLang,                             // "auto" in Auto mode -> Whisper detects the window's language (code-switch friendly)
        noCloud: true,                                    // consultation audio never leaves the device: the fallback STT is native/Web only, never the cloud recorder
        onPartial: function (t) { tick(accumulate(fullTranscript, t), false); }, // clinical: no-op (record-mode); the fast fallback streams live partials here
        onFinal: onChunkFinal,
        onFlush: onChunkSegment,                          // continuous capture: a segment transcribed with the mic still open
        onError: onChunkError,
        onState: function (s) {
          dbg("state", s); if (opts.onState) opts.onState(s);
          // BUGFIX: only start the 15s window timer once the engine is actually RECORDING. Starting it
          // immediately (as before) let a first-use model download (252-547MB, >15s) get killed by
          // closeChunk mid-download → orphaned session that never re-arms ("nothing transcribed").
          var ss = String(s || "").toLowerCase();
          if (/download/.test(ss)) sawDownload = true;
          else if (/record|listen|captur|speak/.test(ss)) startChunkTimer();
        }
      });
      dbg("armed", "session=" + (curSession ? "yes" : "NULL"));
      if (!curSession) return;
      // Fallback: if the engine never announces a recording state (and isn't downloading), start the
      // timer anyway so the chunk still closes. While a download is in flight, defer and re-check.
      function scheduleFallback(delay) {
        fbTimer = setTimeout(function () {
          fbTimer = null; if (chunkStarted || !running || paused) return;
          if (sawDownload) { sawDownload = false; scheduleFallback(20000); } else startChunkTimer();
        }, delay);
      }
      scheduleFallback(2500);
    }
    function startChunkTimer() {
      if (chunkStarted || !running || paused) return;
      chunkStarted = true;
      if (fbTimer) { clearTimeout(fbTimer); fbTimer = null; }
      if (chunkTimer) clearTimeout(chunkTimer);
      chunkTimer = setTimeout(closeChunk, probing ? probeMs : chunkMs);
    }
    function closeChunk() {
      chunkTimer = null; if (fbTimer) { clearTimeout(fbTimer); fbTimer = null; }
      // CONTINUOUS CAPTURE: hand the captured audio to the transcriber WITHOUT stopping the mic, so
      // nothing is lost at the seam. The session stays live and the segment lands on onChunkSegment.
      // Never for the probe window — that is a one-shot detection pass and has to end.
      if (!probing && useFlush(curSession, continuous)) { try { curSession.flush(); return; } catch (e) {} }
      if (curSession && curSession.stop) try { curSession.stop(); } catch (e) {}
    }
    // A transient native error (recording-failure/transcription-failure) on one window must not
    // permanently kill the rolling loop: re-arm the next window (mirrors what onFinal does) instead
    // of leaving curSession/chunkTimer dangling with nothing left to call armChunk() again.
    // Deferred re-arm — NEVER re-arm synchronously from an error path. listen() reports
    // "clinical-unavailable" SYNCHRONOUSLY (and returns null), so a synchronous re-arm would recurse
    // armChunk→listen→onError→armChunk… until the stack blows (the exact "does nothing on a device
    // without Whisper" bug). A timer breaks the cycle.
    function reArm() { if (rearmTimer) return; rearmTimer = setTimeout(function () { rearmTimer = null; if (running && !paused && !curSession) armChunk(); }, 300); }
    function onChunkError(err) {
      dbg("chunkError", err, "engine=" + engine);
      curSession = null;
      if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
      if (fbTimer) { clearTimeout(fbTimer); fbTimer = null; }
      // BUGFIX: on Stop, if the flushed chunk ERRORS (vs finalizes), still run the promised final refine
      // over whatever transcript we have — else teardown()'s willRefine=true leaves the note un-drafted.
      if (stopping) { running = false; if (onRefine && !paused) { try { onRefine(fullTranscript); } catch (e) {} } if (opts.onError) opts.onError(err); return; }
      // Benign silence endpoint: iOS SFSpeech (the fast fallback) ends a window with "No speech
      // detected"/"no match" on EVERY natural pause in a consultation. That is NOT a failure —
      // re-arm and keep listening, without counting it toward the 3-strike breaker or surfacing a
      // scary error. Otherwise a few pauses trip errStreak>3 and kill the whole loop mid-consult
      // ("worked first time then suddenly stopped"). A high cap (reset by any good chunk) still
      // stops a truly dead mic that only ever endpoints on silence.
      if (isSilence(err)) { if (++silenceStreak <= 40 && running && !paused) reArm(); else running = false; return; }
      // Whisper missing/failing → fall back ONCE to the device's built-in on-device STT so autofill
      // still works (immediately on "clinical-unavailable"; after 2 clinical errors if it fails mid-run).
      if (engine === "clinical" && (err === "clinical-unavailable" || ++clinicalErrs >= 2)) {
        engine = "fast";
        if (opts.onState) opts.onState("fallback");
        if (running && !paused) reArm();
        return;
      }
      if (opts.onError) opts.onError(err);
      // transient window error: re-arm, but stop hammering if the engine fails immediately every time
      if (++errStreak <= 3 && running && !paused) reArm(); else running = false;
    }
    // ponytail: stop→transcribe→restart (re-arm) drops the audio spanning the mic/model spin-up at
    // each chunk boundary — a real word can land right on a 15s seam and get clipped on one side.
    // Ceiling: a few hundred ms per boundary, worst case a short word lost. This is still the DEFAULT
    // path. The fix now exists natively (flushTranscribe: transcribe the captured buffer while the mic
    // keeps recording — see closeChunk/onChunkSegment and the plugin READMEs) but is gated behind
    // smd_voice_continuous, DEFAULT OFF, because it cannot be verified without a physical device.
    // Known trade-off of the continuous path: one listen() session means one model for the whole
    // consult, so Auto's per-chunk model re-routing does not apply there (the first-chunk language
    // probe below picks the language up front instead).
    // Shared by the stop-to-transcribe path (onChunkFinal) and the continuous-capture flush
    // (onChunkSegment): adopt this chunk's language for Auto routing, count it, fold it in.
    function foldChunk(chunkText) {
      errStreak = 0; clinicalErrs = 0; silenceStreak = 0;   // a good window means the current engine works
      // Auto mode: adapt the model for the next chunk to THIS chunk's detected language.
      if ((opts.language || "auto") === "auto") { var d = detectScript(chunkText); if (d) setDetectedLang(d); }
      chunkN++;
      fullTranscript = accumulate(fullTranscript, chunkText);
    }
    function onChunkFinal(chunkText) {
      dbg("chunkFinal", "len=" + String(chunkText || "").length, JSON.stringify(String(chunkText || "").slice(0, 100)));
      curSession = null;
      if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
      if (fbTimer) { clearTimeout(fbTimer); fbTimer = null; }
      // AUTO LANGUAGE PROBE: this window was a detection-only pass on the multilingual weights.
      var wasProbe = probing;
      if (wasProbe) {
        probing = false; setProbeDone(true);
        var routed = probeRoute(chunkText);
        dbg("probe", "routed=" + (routed || "(none, keeping today's route)"));
        // Latin script => English: a clean, usable transcript, so it is KEPT and folded in below —
        // nothing captured is thrown away. Anything else (including Devanagari) still has to be
        // DISCARDED: the multilingual weights render real Telugu as garbage Devanagari too (measured:
        // repeated-syllable nonsense), it is perfectly valid UTF-8 so isGarbled() cannot catch it, and
        // there is no way from the text alone to tell that apart from genuine Hindi — folding it in
        // would risk poisoning the transcript AND the LLM extract. probeMs is kept short (above) so
        // this unavoidable discard costs a fraction of a second, not the 4s it used to.
        if (routed) { setDetectedLang(routed); } else { chunkText = ""; }
      }
      if (!wasProbe || chunkText) foldChunk(chunkText);
      else { errStreak = 0; clinicalErrs = 0; silenceStreak = 0; }   // the probe window still proves the engine works
      // A pause-flush is a FINAL window for delivery purposes: let it reach the screen and the note
      // draft first, and only then let the pause take effect. Ordering is the whole fix.
      var pauseFlush = pausing; if (pauseFlush) pausing = false;
      tick(fullTranscript, stopping);
      if (onRefine && !paused && needsRefine({ chunkN: chunkN, refineEveryChunks: refineEveryChunks, final: stopping || pauseFlush })) {
        try { onRefine(fullTranscript); } catch (e) {}
      }
      if (pauseFlush) paused = true;                     // now the mic stays down until resume()
      if (stopping) { running = false; return; }
      if (running && !paused) armChunk();
    }
    // CONTINUOUS CAPTURE: a window transcribed while the mic never stopped (smd_voice_continuous).
    // Delivered exactly like a window final — minus the re-arm, because the session is still live and
    // still recording. That missing re-arm IS the feature: no seam, so nothing is clipped.
    // Stop and pause still go through curSession.stop() → onChunkFinal, which delivers the tail.
    function onChunkSegment(chunkText) {
      dbg("chunkFlush", "len=" + String(chunkText || "").length, JSON.stringify(String(chunkText || "").slice(0, 100)));
      if (!running || paused || stopping) return;        // a flush that lands after teardown is dead weight
      if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
      foldChunk(chunkText);
      tick(fullTranscript, false);
      if (onRefine && needsRefine({ chunkN: chunkN, refineEveryChunks: refineEveryChunks, final: false })) {
        try { onRefine(fullTranscript); } catch (e) {}
      }
      chunkStarted = false; startChunkTimer();           // next window on the SAME open mic
    }
    armChunk();                                          // no-op (guarded) outside a browser/SMD_VOICE host

    // Returns true when an in-flight chunk is being flushed AND that flush will itself call
    // onRefine (with the COMPLETE transcript) via onChunkFinal — i.e. the caller does not need
    // its own fallback refine. False covers both "nothing to flush" and "flush won't refine"
    // (e.g. stopped while paused — onChunkFinal's onRefine is gated on !paused, see below).
    function teardown() {
      if (!running) return false;
      stopping = true;
      if (tmr) { clearTimeout(tmr); tmr = null; }
      if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
      if (fbTimer) { clearTimeout(fbTimer); fbTimer = null; }
      if (rearmTimer) { clearTimeout(rearmTimer); rearmTimer = null; }
      var willRefine = !!(curSession && curSession.stop && onRefine && !paused);
      // flushes the in-flight window (if any) -> onChunkFinal(final) sets running=false and,
      // if not paused, refines
      if (curSession && curSession.stop) { try { curSession.stop(); return willRefine; } catch (e) {} }
      else { running = false; }
      return false;
    }
    return {
      stop: teardown,
      // Returns true when an in-flight window is being flushed AND that flush will deliver it (same
      // contract as stop/teardown), so the caller must NOT also refine with its own stale transcript.
      pause: function () {   // BUGFIX: actually stop the mic on pause (was recording up to a full chunk after)
        if (rearmTimer) { clearTimeout(rearmTimer); rearmTimer = null; }
        if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
        if (fbTimer) { clearTimeout(fbTimer); fbTimer = null; }
        if (running && curSession && curSession.stop) {
          pausing = true;                                // paused is set by onChunkFinal, after delivery
          try { curSession.stop(); return true; } catch (e) { pausing = false; }
        }
        paused = true;                                   // nothing in flight — pause immediately
        return false;
      },
      resume: function () { paused = false; pausing = false; if (running && !stopping && !curSession) armChunk(); },
      _tick: tick                                       // exposed for the controller test
    };
  }

  var API = { start: start, reduce: reduce, needsLLM: needsLLM, accumulate: accumulate, needsRefine: needsRefine, detectScript: detectScript, isSilence: isSilence, useFlush: useFlush, probeRoute: probeRoute, _version: "1.0" };
  if (root) root.SMD_AMBIENT = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
