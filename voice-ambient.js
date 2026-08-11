/* StewardMD — Ambient consultation controller (voice → live assessment autofill).
 * ---------------------------------------------------------------------------
 * Thin orchestrator over the EXISTING capture stack. It does NOT own an ASR engine —
 * it drives SMD_VOICE.listen (on-device Whisper) and, on each transcript update, runs the
 * deterministic layer (SMD_VVITALS + SMD_EMRMAP) to fill assessment fields in near-real-time.
 * Complex narrative the regex layer can't parse (complaints / history / diagnosis) is escalated
 * to an injected LLM extractor — THROTTLED, and only when a chunk is actually narrative, never
 * per word. No LLM injected ⇒ deterministic-only ⇒ fully offline.
 *
 *   SMD_AMBIENT.start({ speaker, getState, onUpdate, onTranscript, onState, onError,
 *                       language, model, llmExtract }) → { stop, pause, resume }
 *
 * Pure, exported helpers (Node-testable, no timers/DOM):
 *   reduce(transcript, {speaker,state,now}) → { updates, dropped }   (deterministic path)
 *   needsLLM(transcript, sentChars) → new narrative tail to send, or ""  (escalation gate)
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
  // Deterministic: word-boundary overlap only, case-insensitive match, prefer longer overlap.
  function accumulate(prev, chunkText) {
    prev = String(prev || "").trim();
    chunkText = String(chunkText || "").trim();
    if (!prev) return chunkText;
    if (!chunkText) return prev;
    // Find the longest word-level overlap: scan from the end of prev to find a prefix of chunkText.
    var prevWords = prev.split(/\s+/);
    var chunkWords = chunkText.split(/\s+/);
    var maxOverlap = 0, overlapLen = 0;
    for (var i = 1; i <= Math.min(prevWords.length, chunkWords.length); i++) {
      var prevTail = prevWords.slice(-i).join(" ").toLowerCase();
      var chunkHead = chunkWords.slice(0, i).join(" ").toLowerCase();
      if (prevTail === chunkHead) {
        overlapLen = i;
      }
    }
    if (overlapLen > 0) {
      // Trim overlapping words from the start of chunkText
      return prev + " " + chunkWords.slice(overlapLen).join(" ");
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

    var session = (root && root.SMD_VOICE) ? root.SMD_VOICE.listen({
      engine: "clinical",
      model: opts.model || "base-q5_1",                 // multilingual base — Telugu + code-switch
      language: opts.language || "auto",                // NOT forced "en": ambient may be Telugu/mixed
      onPartial: function (t) { tick(t, false); },
      onFinal: function (t) { tick(t, true); },
      onError: opts.onError,
      onState: opts.onState
    }) : null;

    function teardown() { running = false; if (tmr) { clearTimeout(tmr); tmr = null; } if (session && session.stop) try { session.stop(); } catch (e) {} }
    return {
      stop: teardown,
      pause: function () { paused = true; },
      resume: function () { paused = false; },
      _tick: tick                                       // exposed for the controller test
    };
  }

  var API = { start: start, reduce: reduce, needsLLM: needsLLM, accumulate: accumulate, needsRefine: needsRefine, _version: "1.0" };
  if (root) root.SMD_AMBIENT = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
