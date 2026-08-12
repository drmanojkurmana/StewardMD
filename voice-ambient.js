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
 * growing transcript. See the native continuous-capture upgrade path documented in
 * local-plugins/capacitor-whisper/README.md + README-ANDROID.md.
 *
 *   SMD_AMBIENT.start({ speaker, getState, onUpdate, onTranscript, onState, onError,
 *                       language, model, llmExtract, chunkMs, refineEveryChunks, onRefine })
 *     → { stop, pause, resume }
 *
 * Pure, exported helpers (Node-testable, no timers/DOM):
 *   reduce(transcript, {speaker,state,now}) → { updates, dropped }   (deterministic path)
 *   needsLLM(transcript, sentChars) → new narrative tail to send, or ""  (escalation gate)
 *   accumulate(prev, chunkText) → fullTranscript                    (seam-overlap-safe join)
 *   needsRefine(state) → bool                                       (refine cadence gate)
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

  function start(opts) {
    opts = opts || {};
    var speaker = opts.speaker || "doctor";
    var getState = opts.getState || function () { return {}; };
    var running = true, paused = false, sentChars = 0, tmr = null, lastTranscript = "";
    var THROTTLE = opts.throttleMs || 1200;
    var chunkMs = opts.chunkMs || 15000;
    var refineEveryChunks = opts.refineEveryChunks;
    var onRefine = opts.onRefine;
    // rolling-capture state (Task 5) — see armChunk() below
    var fullTranscript = "", chunkN = 0, chunkTimer = null, curSession = null, stopping = false;
    // Rolling capture starts on clinical (on-device Whisper). If Whisper is unavailable on this
    // device/build (Android ships no Whisper build; iOS model download can fail), fall back ONCE to
    // the phone's built-in on-device STT so autofill still works. Telugu accuracy still wants Whisper.
    var engine = opts.engine || "clinical", clinicalErrs = 0, errStreak = 0, rearmTimer = null;

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
      curSession = root.SMD_VOICE.listen({
        engine: engine,
        model: opts.model || "base-q5_1",                // multilingual base — Telugu + code-switch
        language: opts.language || "auto",               // NOT forced "en": ambient may be Telugu/mixed
        noCloud: true,                                    // consultation audio never leaves the device: the fallback STT is native/Web only, never the cloud recorder
        onPartial: function (t) { tick(accumulate(fullTranscript, t), false); }, // clinical: no-op (record-mode); the fast fallback streams live partials here
        onFinal: onChunkFinal,
        onError: onChunkError,
        onState: opts.onState
      });
      if (curSession) chunkTimer = setTimeout(closeChunk, chunkMs);
    }
    function closeChunk() { chunkTimer = null; if (curSession && curSession.stop) try { curSession.stop(); } catch (e) {} }
    // A transient native error (recording-failure/transcription-failure) on one window must not
    // permanently kill the rolling loop: re-arm the next window (mirrors what onFinal does) instead
    // of leaving curSession/chunkTimer dangling with nothing left to call armChunk() again.
    // Deferred re-arm — NEVER re-arm synchronously from an error path. listen() reports
    // "clinical-unavailable" SYNCHRONOUSLY (and returns null), so a synchronous re-arm would recurse
    // armChunk→listen→onError→armChunk… until the stack blows (the exact "does nothing on a device
    // without Whisper" bug). A timer breaks the cycle.
    function reArm() { if (rearmTimer) return; rearmTimer = setTimeout(function () { rearmTimer = null; if (running && !paused && !curSession) armChunk(); }, 300); }
    function onChunkError(err) {
      curSession = null;
      if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
      if (stopping) { running = false; if (opts.onError) opts.onError(err); return; }
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
    // Ceiling: a few hundred ms per boundary, worst case a short word lost. Ships because it makes
    // the FULL pipeline (capture→accumulate→refine) work end-to-end today; the fix is a native
    // ring-buffer / continuous-record-with-flush plugin that never stops the mic (documented in
    // local-plugins/capacitor-whisper/README.md + README-ANDROID.md, "continuous capture upgrade").
    function onChunkFinal(chunkText) {
      curSession = null;
      errStreak = 0; clinicalErrs = 0;                   // a good window means the current engine works
      chunkN++;
      fullTranscript = accumulate(fullTranscript, chunkText);
      tick(fullTranscript, stopping);
      if (onRefine && !paused && needsRefine({ chunkN: chunkN, refineEveryChunks: refineEveryChunks, final: stopping })) {
        try { onRefine(fullTranscript); } catch (e) {}
      }
      if (stopping) { running = false; return; }
      if (running && !paused) armChunk();
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
      pause: function () { paused = true; if (rearmTimer) { clearTimeout(rearmTimer); rearmTimer = null; } },
      resume: function () { paused = false; if (running && !stopping && !curSession) armChunk(); },
      _tick: tick                                       // exposed for the controller test
    };
  }

  var API = { start: start, reduce: reduce, needsLLM: needsLLM, accumulate: accumulate, needsRefine: needsRefine, _version: "1.0" };
  if (root) root.SMD_AMBIENT = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
