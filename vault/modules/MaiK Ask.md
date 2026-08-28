# MaiK Ask (AI-guided patient history)

Turn-based history interview inside the OPD Queue EMR: the pathway picks WHAT to ask, the reasoning
provider words it, TTS speaks it, on-device Whisper hears the answer, findings fold into the EMR
draft for the doctor. History aid only - never diagnoses, prescribes or advises.

## Flags
- `smd_maik_ask` - master gate. Default ON for dev (`!== "0"`); **PUBLIC-RELEASE-GATE**: set back to
  `=== "1"` before any store release, pending clinician sign-off on the pathways (`reviewed:false`).
- `smd_maik_ask_fast` - pipelined interview (below). Default ON; `"0"` restores the old serial path.
- `smd_maik_ask_demo` - scripted answers, no ASR/TTS, never touches the record.

## Key files
- `maik-ask.js` - `_runInterview` loop, `_listenTurn`, `_buildTranscript`, UI + `start()`.
- `maik-pathways.js` - pure `nextTarget()`; red flags (pri 1) before core (3) before associated (4).
- `maik-reasoning.js` - validate/retry/fallback + question cache (120, FIFO).
- `opd-emr.js` - `maikAsk()` launcher (`:716` button), `maikApplyFindings()`, `maikConfirm()`.
- Server kinds `maik-ask-next` / `maik-ask-extract` in `functions/api/ai/[[path]].js`.

## GOTCHA - the interview used to discard every answer (fixed 2026-08-23)

`realListen()`'s 14s timer called `sess.stop()` and resolved with `text` **in the same tick**.
`stop()` only STARTS whisper transcription, and clinical Whisper emits **no partials**
(`WhisperEngine.swift` declares `onPartial` but never calls it), so it resolved `""` every time and
the real `onFinal` was dropped by `if (done) return`. The loop saw an empty answer, re-asked, burned
another 14s, then gave up with `__unable__` - having captured nothing. ~20-25s per question for no
data. If you touch the listen path: **the cap must only STOP the mic; settle on `onFinal`.**
`_listenTurn()` exists precisely so this timing is unit-testable (`test/maik-ask-fast.test.mjs`).

## Endpointing
`silenceEndpointMs` (JS `voice.js` -> `native-bridge.js` -> `WhisperPlugin` -> `WhisperEngine`)
auto-stops a turn ~1.5s after the speaker goes quiet. **Opt-in (0 = off)** so the ambient Scribe's
fixed 15s chunking is unaffected. RMS against a drifting noise floor; knobs `vadAbsoluteFloor` /
`vadSpeechFactor` in `WhisperEngine.swift`. Fails safe: if VAD never fires the hard cap still ends
the turn. **Thresholds are not device-validated** - tune in a real OPD room. iOS only; on Android the
on-screen **Done** button covers it.

## Pipelining + the red-flag carve-out
In fast mode the on-device deterministic pass (duration / yes-no / cue words) routes the next
question immediately, while a slow LLM extract runs unawaited and is reconciled in `finish()`
(`known[field] = "__pending__"` holds the slot so it is not re-asked).

**Red-flag targets are NEVER pipelined.** Deterministic only catches yes/no, so a descriptive
positive ("numbness since this morning") is visible only to the LLM; deferring it would let the
interview keep asking routine questions instead of stopping and alerting the doctor. Keep this.

## Save path (changed 2026-08-23)
Every turn is recorded - including turns that produced no finding, whose answers were previously
lost - and `summary.transcript` is the A-to-Z Q&A. The review card is now a **confirmation gate**:
editable transcript + a tick box per field. Nothing is applied or written until Save. `maikConfirm()`
then applies the ticked findings through the existing guarded apply, keeps the transcript as
patient-reported history in `History_present_illness`, and mirrors it to the visit timeline via
`addToTimeline("maik-ask", ...)` -> `POST /api/queue/timeline`, behind `writeFlagOn()`.

This supersedes "Nothing auto-saves" in `docs/MAIK_ASK_OVERNIGHT.md`: the timeline write is new, and
is gated on the doctor's explicit Save.

## Tests
`maik-ask-fast` (timing/pipelining/transcript/confirm gate), `maik-ask-flow`, `maik-ask-pathways`,
`maik-ask-server`, `maik-ask-demo`. Note `listen`/`speak` are mocked everywhere except
`maik-ask-fast`, so real ASR latency is still not covered by CI.
