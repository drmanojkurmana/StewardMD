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
- `smd_scribe_review` / `smd_scribe_banner` — DEFAULT ON, localStorage only. The post-consult review
  panel and the persistent recording indicator. Added after the 2026-09-19 audit found both rendering
  unconditionally, so a doctor who wants the previous screen back has a way to get it. OFF restores it
  exactly. `smd_scribe_consent` is deliberately NOT part of this: consent stays.
- `smd_scribe_offline_draft` — DEFAULT ON, localStorage only. No network means the note is drafted by
  the on-device engine and badged "Drafted on this phone" instead of failing.
- `smd_voice_lang_probe` — **DEFAULT OFF** (was ON; flipped 2026-09-20 by the owner's real-iPhone
  report). Auto mode probes the first window on the multilingual weights and routes by what it read,
  instead of opening on the Telugu specialist and staying there. OFF restores the pre-branch capture
  path exactly. Why off: Auto's normal route IS the Telugu specialist, so the probe makes the start
  of every consult pay a SECOND 252MB model load — and on a phone that does not already hold the
  multilingual weights that is a download, not a swap. `localStorage.setItem("smd_voice_lang_probe","1")`.
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
`scribe-templates.js` (`SMD_SCRIBETPL`: general, paediatrics, obgyn, surgery follow-up; since
2026-09-25 also orthopaedics, ophthalmology, ent, dermatology, psychiatry and dental, one per
[[Specialty Kits]] kit. Picking a kit chip in the OPD Specialty tab selects the matching template.
Each new template names only real `VOICE_MAP` keys and asks for what was said, never a grade,
classification or risk level that was not; `test/scribe-templates.test.mjs` enforces both).

Server (`_opd-scribe.js`): a `sources` map quoting the transcript sentence behind every field, plus
`verifySources` and `flagContradictions`, and prompt rules for negation and time. The review panel
never auto-accepts a field the recording does not support.

`verifySources`/`flagContradictions` now RUN in the handler (`attachGrounding`), and the response
carries `ungroundedFields` (+ `contradictions`, which no client reads yet). Grounding is
trustworthy-or-absent: if the reply was truncated, or the model cited fewer than
`GROUND_MIN_COVERAGE` (0.8) of the populated fields, BOTH `sources` and `ungroundedFields` are
withheld, because opd-emr.js reads a field missing from `sources` as "not found in the recording"
and an incomplete map would badge good fields as fabricated. `SCRIBE_GROUND="0"` disables the whole
signal (default on). The opd-scribe reply is generated under `SCRIBE_MAX_OUTPUT_TOKENS` (default
6000), not the 1100-token chat budget that was truncating the final refine, and `parseScribeJson`
keeps the completed fields when a reply is cut instead of returning null.

Quota: a scribe call charges `scribeChargeSec` (`functions/_ai_usage.js`) — `body.sec`, the seconds
of NEW audio since the caller's previous charged call, clamped to 300; absent, a per-kind floor
(`opd-scribe` 45, `assessment` 0, `translate` 15) that can only under-charge. **opd-emr.js does not
send `sec` yet** — see `vault/Roadmap.md`. The negation and time rules are ported
into `maik-local.js` `SCRIBE_SYS`; the `sources` map is NOT ported (the rolling-window merge there
has no equivalent) — that is the open follow-up for on-device drafts.

STILL UNMEASURED: there is still no word-error-rate or clinical-entity benchmark. `voice-benchmark/`
holds a harness and a 500-line synthetic corpus that has never been run on real consult audio. Until
it is, none of the above can be shown to have improved accuracy — only that the pipeline lost less
and guarded more. Run it before enabling the device-gated flags.

i18n: the 24 new ward and discharge scribe strings are registered in the EN catalog and listed in
`docs/wardsynq/i18n-english-fallbacks.json` for all 8 languages. They show English until the
translation pipeline runs over them.


## 2026-09-19 audit and the fixes it forced

A performance and safety audit of the branch above found the work was NOT zero-loss. What it caught,
and what was done, all of it measured rather than argued:

1. **A symptom was being deleted from the note.** `scribe-drugfix` rewrote "no vomiting" to
   "no Ondansetron": "vomiting" is 2 edits from the brand "Vomikind", which resolves unambiguously to
   Ondansetron, so the ambiguity guard never fired. Indian brands are coined from the conditions they
   treat, so this class of collision is structural, not a one-off. Fixed two ways: clinical words are
   never candidates, and an INEXACT match is now accepted only inside a prescribing sentence (a form
   word before, or a dose, unit or frequency after). An exact hit in the app's own table still stands
   alone. Regression test uses the exact failing sentence.
2. **The corrector was 2.8 s of blocking work per refine** on a long consult (O(words x vocabulary),
   vocabulary rebuilt per call). Now cached by list identity, length-bucketed, and memoised across
   refines: 8.3x faster at 15000 words, and proven identical on 160 random transcripts.
3. **The scribe exhausted its own quota and killed the recording.** A flat 120 s per call was
   calibrated to the old 120 s cadence; at the new cadence a 10 minute consult charged 1680 s of an
   1800 s daily cap. Now metered on audio captured (`scribeChargeSec` + the client's `sec` delta):
   10 minutes bills about 600 s, the same as before the cadence changed.
4. **A truncated reply used to lose the ENTIRE extraction** (the loose JSON parser needed a matching
   closing brace), most likely on the authoritative final refine. `parseScribeJson` now salvages every
   completed field, and the output budget was raised so the sources map does not cause the truncation.
5. **Two refines could overlap** at the new cadence and a slower older one could overwrite a newer
   result. Now sequenced; stale results are discarded.
6. **A slow connection counted as offline**, starting a full on-device generation every refine. Now
   only a genuine connectivity failure, and only on a doctor-initiated finish.
7. **A client bug was caught as a network error** and hidden behind that same fallback. The handler
   now sees only transport failures; a code error is logged and surfaced.
8. **The Auto probe threw away the first 4 seconds** of a non-English consult and forced a second
   252 MB model load. Now 1.5 s, and remembered per visit so a restart re-probes nothing.
9. Also: the ward screen closing mid-recording left the mic on; the consent store grew without bound
   and re-prompted clinic patients every time; `smd_scribe_live` read localStorage every second with
   the flag OFF; `smd_scribe_feedback` OFF still wrote review state.

The audit's own caveat stands: the 5-10x low-end-Android multiplier behind item 2 is an estimate from
a Mac baseline, not a device measurement. Confirm on hardware.

## 2026-09-20 — the cloud refine became incremental (`smd_scribe_delta`, **DEFAULT OFF**)

Every refine used to resend the WHOLE growing transcript, so a consult's INPUT cost grew with the
SQUARE of its length. A BACKGROUND refine now sends only the speech since the last call whose result
was actually applied, plus the draft so far (bounded by the field list, not by consult length).

**The FINAL refine (Pause/Stop) is deliberately unchanged**: whole transcript, no prior draft, a fresh
authoritative extraction. That is the safety net that makes the delta path acceptable — do not
"optimise" it.

**DEFAULT OFF since 2026-09-20.** The client half shipped without the SERVER half being deployed:
origin/main's worker has no `delta`/`priorDraft` branch, so against the live API a delta is just a
45-second fragment with no context and each background refine fills a handful of fields instead of
the note. That is what the owner saw as "autofill into the OPD Assessment form is broken".
`localStorage.setItem("smd_scribe_delta","on")` turns it on — do that only once the worker carrying
`mergeScribeDraft` is live.

Wire (`/api/ai/extract`, kind `opd-scribe`):
- FULL (unchanged): `{ transcript: <whole>, sec, specialtyPrompt? }` -> `{ en, emrFields, sources?,
  ungroundedFields?, suggestions, … }`.
- DELTA: `{ transcript: <new speech only>, delta: 1, priorDraft: { emrFields }, sec, specialtyPrompt? }`
  -> the same shape plus `delta: true`, where `emrFields` is the WHOLE merged draft, `en` is the
  translation of the NEW speech only, and grounding (`sources`/`ungroundedFields`) is WITHHELD — a
  citation map covering only the new speech would make opd-emr.js badge every earlier field
  "not found in the recording".

Key code:
- `functions/api/ai/_opd-scribe.js` — `scribeExtractPrompt(t, {priorDraft})` (delta prompt; no
  priorDraft is byte-identical to before) and the pure `mergeScribeDraft(prev, next, {contradictions})`.
- `functions/api/ai/[[path]].js` — the delta branch; `priorDraft` is REQUEST-BODY input so it goes
  through `sanitizeScribeOutput` (whitelist + 2000-char cap) before it reaches a prompt.
- `opd-emr.js` — `scribeDeltaOn`, `_deltaPlan`/`_deltaPrep` (what to send), `_enAccum` (`en`
  accumulates across deltas; a full pass still replaces it), `_draftAccum` (`st.scribeDraft`),
  `_sentUpTo`/`_sentCovered` (advanced ONLY when a result is applied).

Merge rules (a port of `maik-local.js` `scribeMerge`/`mergeText`, duplicated on purpose so the two
engines agree; maik-local is a browser IIFE the Worker cannot import): absent/blank key = "nothing new"
(never a clear); narrative fields ACCUMULATE with token-containment dedupe (so a delta can never
shorten one); `Yes` -> `No` only when `flagContradictions` over the NEW speech shows it is really
negated (a `xDetails` hit flips its `x` sibling); ddx/investigations unioned; latest provisionalDx wins.

MEASURED (`node test/bench/scribe-delta-bench.mjs`, 700 transcript chars/min, a refine every 45 s):
transcript characters sent per consult 14,525 -> 6,650 (5 min), 54,775 -> 13,825 (10 min),
159,000 -> 21,650 (20 min, with today's 8000-char client cap). As a share of the WHOLE prompt the
saving is smaller — 2% / 15% / 27% — because the ~5,200-char instruction preamble is resent on every
call in both modes. That preamble is now the dominant input cost and is the next lever.

Known, accepted: a sentence split across a delta boundary is seen only in its second half by the LIVE
draft (no overlap is sent); the final full pass reads it whole. The deterministic VITALS run is no
longer affected by that seam — `applyScribeResult` re-extracts over the ACCUMULATED
`st.voiceTranscriptEn`, not over the one delta's `en`, so "BP is 140" / "by 90" arriving in two
replies still fills BP (test/opd-emr-scribe-live.test.mjs). `SMD_AI.extract` still slices the
transcript to 8000 chars, so the FINAL refine of a consult longer than ~11 minutes sees only its first
8000 characters — that is pre-existing (reasoning.js) and unchanged here, but it is now the biggest
remaining loss in the path. Tests: `test/opd-scribe-delta.test.mjs`, `test/opd-emr-scribe-delta.test.mjs`.

## 2026-09-20 — the owner's iPhone report, and what actually broke

Three symptoms off one device: autofill into the Assessment form broken, no live transcription while
speaking, no live English translation. Two defaults flipped and two real bugs fixed; both flags still
work when switched on and both keep their tests (opted in).

1. **`smd_scribe_delta` -> OFF** (above). The client wire shipped ahead of the worker. Autofill.
2. **`smd_voice_lang_probe` -> OFF** (above). A second 252MB model load at the start of every Auto
   consult. Live transcription. NOT reproducible in Node — the cost is the model load itself, which
   only exists on a device; the code path is correct, it is the price that is wrong.
3. **The authoritative final refine could be silently skipped.** `doRefine`'s dedupe guard compared
   against the last send of ANY kind, so a Pause/Stop whose transcript had not grown since the previous
   background refine returned without calling the server. That is the COMMON case, not a corner: the
   idle-refine (`LIVE_IDLE_MS`, 4 s of silence) fires exactly when the doctor stops talking, and the
   last 15 s capture window before the Stop tap is usually that same silence. Harmless while every
   refine was a full pass — with `smd_scribe_delta` on it meant no pass EVER read the consult whole.
   Fixed with `_lastFullRefined` + the pure `_dedupeSkip(transcript, isFinal, lastSent, lastFull)`: a
   background tick still dedupes against the last send, a final only against the last FULL pass.
4. **A probe window that ERRORED never set `probeDone`**, so the next window probed again — and again
   — on weights that were failing to load, until the 2-strike clinical breaker dropped the whole
   consult to device STT. `onChunkError` now closes the probe whatever its outcome.

### Autofill completeness (the owner's bar: "EVERY DETAIL ... MUST BE AUTOFILLED")
- `EMR_FIELD_KEYS` grew from 64 to 107 keys and every one of them now has a `VOICE_MAP` target
  (asserted in test/opd-emr-scribe-live.test.mjs, both directions). What was added: `genCondition`,
  the personal-history selects (`maritalStatus`, `childrenCount`, `consanguinity`, `appetite`,
  `bowels`, `micturition` + details), `priorInvestigations`, `familyPsych`/`familyOther`, the
  menstrual/obstetric text fields (`menstrualHistory`, `menstrualDetails`, `obstetricHistory`,
  `pregnancyComplications`, `contraception`, `lactating`, `dysmenorrhoea`, `breastFeeding`,
  `feedingDuration`), the dictated examination fields (`cranialNerves`, `motorSystem`,
  `sensorySystem`, `reflexes`, `plantars`, `gait`, `speech`, `cerebellar`, `jvp`, `skin`, `entExam`,
  `musculoskeletal`, `breastExam`, `teethExam`, `headNeckExam`, `genitalExam`, `perinealExam`,
  `perRectalExam`, `hernialOrifices` + details), and `differentialDx` / `referral` / `lifestyleAdvice`.
- **`<select>` fields used to silently blank.** `putVoiceDom` assigns `el.value`, and a browser drops
  a value no `<option>` carries — so "vegetarian" for Diet, or "sick" for General condition, filled
  NOTHING even though the extractor had said the right thing. `_snapOption` now maps a spoken value
  onto a real option (exact, then a UNIQUE prefix/whole-word match: "Sick" -> "Sick / Poor"). No match
  or two matches = the field stays empty. Never a guess.
- **Deliberately NOT mapped**, with the reason: the obstetric counts, ages and dates
  (`no_of_abortions`, `children_living`, `children_died`, `age_menarche`, `age_menopause`,
  `age_marriage`, `first_delivery_age`, `last_delivery_age`, `LCB`, `IUD`, `still_birth`,
  `neonatal_death`, `molar_pregnancy`, `sterilization`) and the pre-admission dates/hospital — a
  mis-heard number in an obstetric count is a clinical error and the model has no way to say it is
  unsure; `informany_attendant` / `informant_relation` — a person's name, mis-attribution is worse
  than blank; `BMI` / `bsa` — computed from height and weight, never extracted; `waist_cm` /
  `muac_cm` — these need regexes in `voice-vitals.js`, which was outside this session's ownership.

## 2026-09-21 — merged to main, and still NOT device-verified

PR **#1153** (the 18 improvements + the autofill regression fix) and PR **#1173** (a CI-only test
fix) are merged to `main`. The OTA candidate is staged by CI. Going live is the owner pressing
**Push to devices** in `stewardmd.in/admin` → App updates; nothing reaches a phone until then.

**Nothing in this module has ever run on a physical device.** This session could not build one:
Xcode and Google Chrome are both absent from `/Applications` and the Mac is at 99.5% disk (1.2 GB
free of 244 GB), so there is no `xcodebuild`, no `devicectl`, and no headless Chrome for the CDP
harness that `CLAUDE.md` requires for UI claims. The owner declined disk cleanup and chose the OTA
route. Every claim about this module rests on Node tests alone.

**Unverified and load-bearing for the OTA route:** it was never confirmed that the app installed on
the owner's iPhone can receive OTA at all. This note says devices need a native rebuild since
2026-08-24 to carry the updater plugin, and both native `autoUpdate` and JS `isAuto()` default to
off, so the update also needs an explicit tap on the phone. The iPhone dropped off USB before
`ios_webkit_debug_proxy` could be attached to check. If the installed build predates the plugin
re-link, OTA cannot deliver this fix and a native rebuild is the only path — which needs Xcode and
disk space.

### A main-branch bug found while merging (not caused by this branch)
`home.js:7058` read the engine through a bare global inside a try/catch:
`window.SMD_MAIK_ENGINE && SMD_MAIK_ENGINE.effective ? SMD_MAIK_ENGINE.effective() : null`.
Where `SMD_MAIK_ENGINE` is not also an implicit global the bare reference throws, the catch swallows
it, `_eff` stays null, and the next line sends the question to `maikRunResearch` — the cloud path —
even though the doctor selected an on-device engine. That violates the hard Local AI policy, and it
was live on `main`: `test/maik-router-scope.test.mjs` was red at `origin/main`, the test having been
written for this exact regression. It entered with `91006578d` (2026-09-21, "Research mode
on-device"). Fixed by qualifying all three references with `window.`.

### CI gotcha this session paid for
`test/opd-emr-scribe-live.test.mjs` unrefs every timer so the real modules' polling intervals cannot
hold the process open, then built its own `await` on that same patched global. With no unref'd timer
left to keep the loop alive, node can resolve the event loop while the promise is still pending, and
the parent test is cancelled along with every later test in the file (`cancelledByParent`,
"Promise resolution is still pending but the event loop has already resolved"). It passed locally
every run and only failed on CI. A test that patches the global timer must build its own ticks on
the captured real `setTimeout`.
