# MaiK Scribe (ambient OPD scribe)

Ambient doctor-patient consultation capture inside **OPD Queue > patient > Assessment**. On-device
Whisper only; consultation audio never leaves the phone.

## Flags
- `smd_opd_maik` — advisory-reasoning kill switch. localStorage ONLY, not in `queue-flags.js` DEFS.
  On by default; off via `localStorage.setItem("smd_opd_maik","off")`.
- `smd_opd_emr` / `smd_opd_emr_write` — gate the EMR overlay and its save buttons.
- `smd_whisper_clinical_dictation`, `smd_voice_tiers`, `smd_voice_tier` — on-device engine + tier.
- `smd_scribe_live` — DEFAULT ON, localStorage only. Live-draft cadence (refineEveryChunks 2 instead
  of 8, plus an idle-speech-triggered refine); OFF restores the original ~2 min cadence byte-identically.
  Cost-guarded independently via `smd_scribe_live_mingap_ms` (default 45000) — see `gatedRefine`.
- `smd_scribe_feedback` — DEFAULT ON, localStorage only. Correction-feedback ring buffer (see below).
- `smd_scribe_consent` — DEFAULT ON, localStorage only. Per-visit recording consent gate.
- `smd_scribe_clinical` — DEFAULT ON, localStorage only. Wires the clinical modules into the OPD
  scribe: drug-name corrections, structured medicines to the prescription pad, ICD candidates on an
  accepted diagnosis, the medicine safety check, speaker labelling and the specialty picker. OFF
  restores the pre-2026-09-19 behaviour.
- `smd_scribe_offline_draft` — DEFAULT ON, localStorage only. No network means the note is drafted by
  the on-device engine and badged "Drafted on this phone" instead of failing.
- `smd_voice_lang_probe` — DEFAULT ON. Auto mode probes the first window on the multilingual weights
  and routes by what it read, instead of opening on the Telugu specialist and staying there.
- `smd_voice_continuous` — DEFAULT OFF, needs a device. Native `flushTranscribe` transcribes without
  stopping the mic, so no audio is lost at a chunk seam. Inert on any binary built before it.
- `smd_voice_hi_model` — DEFAULT OFF. Hindi specialist route. FAILS CLOSED: the weights are not
  published, so `native-bridge.js` carries an empty sha256 placeholder. Publish the file, record the
  real sha256 and byte size, rebuild natively, and only then turn this on.
- `smd_voice_prompt_multi` — DEFAULT OFF, unmeasured. A Latin-script drug-name primer for non-English
  decoding. An English primer was measured to suppress Telugu, which is why this is off.
- `smd_ward_scribe` / `smd_discharge_scribe` — DEFAULT OFF, both need a device and a real record.
  The same engine inside the ward round note (`ward.js`) and a discharge summary section
  (`discharge.js`). Accept-per-note, append-only, never overwrites.
- Server: `SCRIBE_MODEL`, `SCRIBE_CAPS` (Pro-only + time caps), `SCRIBE_SEC_DAY` / `SCRIBE_SEC_WEEK`.

## Key files
- `opd-emr.js` — Scribe UI (`oe-vc-*`), `startVoice`/`stopVoice`, `doRefine` (LLM pass), `_applyRefine`
  (folds into EMR), `scribeAccept*` (doctor-confirm gate).
  - Live draft cadence + cost guard: `scribeLiveOn`, `_liveRefineGate` (pure), `gatedRefine`,
    `maybeIdleRefine` (the "doctor paused speaking" trigger, driven off `onTranscript` growth stalling
    — there is no VAD/silence callback from voice-ambient.js, so this is a client-side heuristic).
  - Post-consult review panel (item 14): `_buildReviewRows` (pure — reads the optional `sources` /
    `ungrounded(Fields)` grounding signal off the opd-scribe extract, see Task 6 in
    `functions/api/ai/_opd-scribe.js`), `reviewPanel`/`reviewRow`, `scribeReview*` actions.
  - Correction feedback log (item 15): `_feedbackPush` (pure ring buffer), `logScribeFeedback`,
    localStorage key `smd_scribe_feedback_log` (cap 200) — field key + accepted/edited/rejected +
    language + timestamp ONLY, never transcript/audio/PHI. Accessor: `window.SMD_SCRIBE_FEEDBACK`.
  - Recording consent + persistent indicator (item 18): `_consentReducer`/`_consentStatus` (pure state
    machine, keyed per visit — `episodeId`/`visitId`/`ticketId`/mrn fallback chain), `askScribeConsent`,
    localStorage key `smd_scribe_consent_visits`; `recordingBanner` (sticky, every tab, not just
    Assessment's orb) with its own elapsed timer (`#oeRecTimer`, ticked by the existing `tickElapsed`).
- `voice-ambient.js` — `SMD_AMBIENT.start`, 15s rolling chunks, `detectScript` Auto re-routing.
- `voice.js` — `SMD_VOICE.listen`, `whisperModel()` tier/language model routing, `isGarbled` guard.
- `functions/api/ai/_opd-scribe.js` — prompt + `sanitizeScribeOutput` (whitelist; strips Indic script
  from EMR fields, keeps `out.en` intact for the VoiceNote).
- `local-plugins/capacitor-whisper/ios/.../WhisperEngine.swift` — stop-to-transcribe, one
  `whisper_full()` per chunk.

## GOTCHA — decode language vs model (measured, 2026-08-23)

whisper.cpp treats `language:"auto"` as auto-DETECTION (`src/whisper.cpp:6833`). The Telugu
specialist (`telugu-small-q8_0`, from `vasista22/whisper-telugu-small`) is a SINGLE-LANGUAGE
fine-tune, so its detection head is unreliable and a wrong language token makes the decoder emit
**invalid UTF-8** byte-BPE fragments. iOS `String(cString:)` repairs each bad byte to U+FFFD, which
is the on-screen "wall of ◇?" bug.

Measured on the shipped q8_0 weights via `whisper-cli`, same clips, only the `-l` flag changed:

| model | audio | `-l auto` | `-l te` | `-l en` |
|---|---|---|---|---|
| telugu-small-q8_0 | Telugu | valid | **valid** | INVALID (U+FFFD) |
| telugu-small-q8_0 | English | INVALID (U+FFFD) | **valid** (Telugu-script transliteration) | valid |
| small-q8_0 (control) | Telugu | garbage Devanagari `नाको निन्नती…` | – | – |
| small-q8_0 (control) | English | perfect English | – | – |

Conclusions:
1. `auto` on the specialist is UNSTABLE — never use it. `SMD_VOICE.listen()` pins `auto -> te`
   whenever it resolves the specialist. Never pin `en` on the specialist (breaks Telugu).
2. The multilingual model genuinely does mangle Telugu, so Auto cannot simply switch models — the
   "open Auto on the specialist" decision stands.
3. The ggml conversion is NOT at fault: the hosted model's vocab is byte-identical to the known-good
   `small-q8_0` (50257 tokens, 0 diffs). Do not re-investigate the conversion script.

### Known remaining limitation
In **Auto** mode an English-only consult decodes on the specialist as English *transliterated into
Telugu script* (valid UTF-8, but not Latin). `detectScript()` then reads it as Telugu and keeps the
specialist for the rest of the session. The LLM `en` translation still recovers the meaning, but an
English-speaking clinic should tap **EN** rather than Auto. A proper fix would run a detection-only
pass on the multilingual weights for the first chunk, then route. Not done.

## GOTCHA — iOS decoded segment text PER SEGMENT (second, independent cause)

whisper.cpp emits byte-level BPE, so a multi-byte character can straddle a segment boundary.
MEASURED: `whisper_full_get_segment_text()` returned a segment starting with the bare continuation
byte `b9` where `e0 b0 b9` (హ) belongs — the `e0 b0` prefix sits at the end of the previous segment.
`WhisperEngine.swift` decoded EACH segment with `String(cString:)`, whose repairing behaviour turns
both halves into U+FFFD. This is why the very first Telugu letter was destroyed while the next one
survived. Fixed by accumulating raw bytes across all segments and decoding once.

**Android was already correct** (`whisper_jni.cpp` builds a `std::string`, one `NewStringUTF`) — that
is why the bug was iPhone-only. Keep the two in step.
Runnable proof: `xcrun swift local-plugins/capacitor-whisper/ios/segment-decode-check.swift`.
Reaching the device needs `build-www` -> `cap sync` -> native rebuild.

## GOTCHA — garbage in, confabulation out
`scribeExtractPrompt` instructs the LLM to "reconstruct the intended CLINICAL meaning" from garbled
ASR. With a U+FFFD transcript that means it INVENTS a plausible consultation, which `_applyRefine`
folds into EMR fields. `voice.js isGarbled()` now drops any chunk that is >=20% U+FFFD at the source
(the single choke point all Whisper consumers route through), so nothing downstream sees it.
A dropped chunk is silent (console warning only) — an empty VoiceNote is confusing but safe; an
invented history in the chart is not.

## Tests
`test/voice-telugu-decode.test.mjs` (this gotcha), `voice-lang-route`, `voice-tier-routing`,
`voice-ambient-scribe`, `opd-scribe-extract`, `opd-scribe-fixtures`, `scribe-english`,
`opd-scribe-ground-wire`, `voice-scribe-ground`, `ai-scribe-caps`, `run-scribe-ui.mjs` (CDP).
`test/opd-emr-scribe-ux.test.mjs` — items 12/14/15/18 (live-draft cadence gate, review-panel row
building, feedback ring buffer, consent state machine) + a few `_render` smoke checks for the new
recording banner / review panel markup.


## 2026-09-19 build (branch `worktree-scribe-18`)

Eighteen improvements landed together. New pure modules, each Node-tested and injected-dependency
style like `voice-scribe-ground.js`: `scribe-drugfix.js` (unambiguous drug-name correction only),
`scribe-rx.js` (dictated treatment to structured rows plus `toRegimen` for `SMD_RX.open`),
`scribe-icdsug.js`, `scribe-safety.js` (reuses `_analyzeRegimenSafety` + `INTERACTIONS`),
`scribe-speaker.js` (acoustic path dormant until capture supplies per-segment energy/pitch),
`scribe-templates.js` (`SMD_SCRIBETPL`: general, paediatrics, obgyn, surgery follow-up).

Server (`_opd-scribe.js`): a `sources` map quoting the transcript sentence behind every field, plus
`verifySources` and `flagContradictions`, and prompt rules for negation and time. The review panel
never auto-accepts a field the recording does not support. The negation and time rules are ported
into `maik-local.js` `SCRIBE_SYS`; the `sources` map is NOT ported (the rolling-window merge there
has no equivalent) — that is the open follow-up for on-device drafts.

STILL UNMEASURED: there is still no word-error-rate or clinical-entity benchmark. `voice-benchmark/`
holds a harness and a 500-line synthetic corpus that has never been run on real consult audio. Until
it is, none of the above can be shown to have improved accuracy — only that the pipeline lost less
and guarded more. Run it before enabling the device-gated flags.

i18n: the 24 new ward and discharge scribe strings are registered in the EN catalog and listed in
`docs/wardsynq/i18n-english-fallbacks.json` for all 8 languages. They show English until the
translation pipeline runs over them.
