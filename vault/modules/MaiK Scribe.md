# MaiK Scribe (ambient OPD scribe)

Ambient doctor-patient consultation capture inside **OPD Queue > patient > Assessment**. On-device
Whisper only; consultation audio never leaves the phone.

## Flags
- `smd_opd_maik` — advisory-reasoning kill switch. localStorage ONLY, not in `queue-flags.js` DEFS.
  On by default; off via `localStorage.setItem("smd_opd_maik","off")`.
- `smd_opd_emr` / `smd_opd_emr_write` — gate the EMR overlay and its save buttons.
- `smd_whisper_clinical_dictation`, `smd_voice_tiers`, `smd_voice_tier` — on-device engine + tier.
- Server: `SCRIBE_MODEL`, `SCRIBE_CAPS` (Pro-only + time caps), `SCRIBE_SEC_DAY` / `SCRIBE_SEC_WEEK`.

## Key files
- `opd-emr.js` — Scribe UI (`oe-vc-*`), `startVoice`/`stopVoice`, `doRefine` (LLM pass), `_applyRefine`
  (folds into EMR), `scribeAccept*` (doctor-confirm gate).
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
