# Ambient AI OPD Scribe — deliverable report

Feature: `docs/superpowers/plans/2026-08-11-ambient-ai-opd-scribe.md` (Tasks 1-6).
This report is Task 6's Step 3 deliverable: model/size, RAM/latency, Telugu status, offline
behaviour, cost, privacy, known limits and how to activate.

## What it is

In the OPD Assessment tab, one "Voice Consultation" records the whole visit in rolling 15s
windows. Two layers run over the growing transcript:

1. **Deterministic, on-device, zero-token** (`voice-vitals.js` + `voice-emr-map.js`) — parses
   explicitly-spoken numbers/exam phrases into vitals/exam fields on every tick. Speaker-gated
   (patient speech can only fill history, never a confirmed vital/finding).
2. **LLM refine pass** (new `opd-scribe` kind, `functions/api/ai/_opd-scribe.js`) — every 4th
   chunk (~60s) and at Stop, the accumulated transcript is sent to `/api/ai/extract` for narrative
   EMR fields (chief complaint / history) plus **suggest-only** Dx / differential / investigations.
   Suggestions are grounded (`voice-scribe-ground.js`: engine-sourced entries first, LLM entries
   appended and tagged `ai`) and rendered in a labelled "AI suggestions" panel — nothing is written
   to the EMR or an order until the doctor taps Accept on that specific row.

## Model + size

- Engine: **on-device Whisper.cpp** (`@stewardmd/capacitor-whisper`, MIT, v1.9.1), iOS (Metal +
  CPU) and Android (NDK/JNI, `arm64-v8a`) — both platforms implemented and activated.
- **Base app footprint: +0 MB.** The model is *not* bundled; it's downloaded once from
  `https://models.stewardmd.in/whisper/` (pinned SHA-256, HTTP range support) on first use of
  Clinical Dictation / ambient voice, and cached outside app backup.
- **Multilingual model** (`base-q5_1`, `ggml-base-q5_1.bin`): **~57 MB** (59,707,625 B verified),
  used whenever the language toggle is `Auto` or `Telugu` (తె) — this is the model that decodes
  Telugu and code-switch. English-only Clinical Dictation on iOS defaults to `small.en-q5_1`
  instead; forcing English (`en`) keeps the smaller English-only model. A `tiny-q5_1` (~32 MB)
  alternative exists but is not the ambient default.
- Server side: zero new dependencies. `opd-scribe` reuses the existing Gemini call path
  (`callGemini`/`recordUsage`) already used by the `assessment` extract kind.

## RAM / latency notes

- Not independently benchmarked for this task — **device-gated** (whisper.cpp inference cannot be
  measured meaningfully on an x86_64 simulator/CI runner; the repo's existing native-build gotcha
  applies). What's known from the plugin's own notes (`voice.js`, `README-ANDROID.md`):
  - Android is CPU-only; the smaller `small.en` model was measured at roughly **7s per clip** for
    short dictation-length audio — the ambient 15s-chunk cadence has *not* yet been latency-profiled
    on a real device with the larger multilingual `base-q5_1` model.
  - The 15s window size itself is a latency/accuracy tradeoff already baked into the design (short
    enough that the doctor sees the deterministic vitals/exam autofill within one window; long
    enough to amortize the per-window record→transcribe round trip).
  - RAM: whisper.cpp keeps raw audio samples in memory only for the duration of one window's
    inference, released immediately after (see Privacy) — no persistent buffer growth across a
    whole consult; not measured against an absolute RAM ceiling on-device.
  - **Action needed before wider rollout:** a real-device pass (per `README-ANDROID.md`'s "Open
    items") to measure actual base-q5_1 latency-per-15s-window and peak RAM on a representative
    mid-range Android phone.

## Telugu status

- **Transcription:** Telugu and English/Telugu code-switch route through the multilingual
  `base-q5_1` model when the doctor selects `Auto` or `తె` (Telugu can't be decoded by the
  English-only small model, so the UI forces Clinical + multilingual for those two toggle states).
- **Downstream parsing (verified, text-level):** `test/opd-scribe-fixtures.test.mjs` drives
  Telugu-script + code-switch transcripts (e.g. `"జ్వరం మూడు రోజులు నుండి ఉంది, BP 130/85 ఉంది,
  pulse 78 regular ga undi..."`) through the SAME deterministic extractor + LLM-sanitize/ground
  pipeline the app uses, and confirms vitals still parse correctly and no diagnosis/dose is
  invented, regardless of the language mix.
- **Not yet verified:** actual Whisper transcription *accuracy* for spoken Telugu / code-switch —
  this needs a real device + a real recording, i.e. an audio-level benchmark, which is explicitly
  **device-gated** (documented in `local-plugins/capacitor-whisper/README-ANDROID.md`'s "Open
  items": "the Telugu clinical benchmark still need[s] a real arm64 device").

## Offline behaviour

- **Capture + deterministic fill work fully offline.** `voice-vitals.js`/`voice-emr-map.js` have
  no network dependency; vitals/exam autofill continues to work with no connectivity (once the
  Whisper model is already downloaded).
- **LLM refine + grounded suggestions are online-only** and degrade cleanly: `doRefine()` in
  `opd-emr.js` and the `llmExtract` escalation both wrap the network call in `.catch(() => {})` —
  a failed/offline `opd-scribe` extract call simply skips that refine pass; the deterministic
  fields already filled are untouched, and the doctor can keep dictating and try again once online
  (typically at Stop, when the next window's refine fires).
- No offline queue/retry for missed refine passes is implemented — a consult conducted entirely
  offline ends with deterministic fields only and no AI suggestions panel. Acceptable for v1 (the
  panel is suggest-only and optional), flagged as a known limit below.

## Cost: ₹0 STT

- The ASR itself is **on-device Whisper.cpp — zero per-request cost**, unlike a cloud STT API
  (Google/Azure/AWS transcribe). The only network cost is the one-time ~57 MB (or ~32/60 MB
  depending on model) model download per device, served from StewardMD's own R2/Pages mirror.
- The LLM refine pass (`opd-scribe` extract) uses the existing Gemini call + the existing
  per-user AI usage/budget accounting (`recordUsage`) — same cost model as every other `/api/ai`
  extract kind already shipped (assessment extract, MaiK, etc.), nothing new added here.

## Privacy

- **Raw audio never leaves the device** and is never written to disk or logged — the whisper.cpp
  plugin keeps samples in memory only for the duration of one window's inference and releases them
  immediately after transcription (verified in the plugin's own README, both platforms).
- Only the resulting **text transcript** is ever sent off-device, and only for the LLM refine pass
  (`opd-scribe` extract to `/api/ai/extract`) — never for the deterministic vitals/exam layer.
- The `opd-scribe` LLM response is whitelisted server-side (`sanitizeScribeOutput`) to a fixed set
  of narrative EMR field ids + three suggestion arrays; no other key can pass through, by
  construction (see Safety below).
- No "DPDP compliant" claim is made anywhere in this feature, per the plan's constraint.

## Known limits

1. **Native continuous capture is not built.** Today's Whisper plugin is record-then-transcribe
   (no mid-recording partials); the shipped workaround is a JS re-arm loop (`voice-ambient.js`:
   start → 15s → stop→transcribe→accumulate → restart back-to-back). This drops a few hundred ms
   of audio at each 15s seam (a word landing exactly on the boundary can be clipped on one side) —
   marked with a `ponytail:` comment at the ceiling. The native upgrade path (ring-buffer /
   continuous-record-with-15s-flush, emitting `whisperPartial` per window while recording never
   stops) is documented in `local-plugins/capacitor-whisper/README.md` and `README-ANDROID.md`,
   contract-compatible with `SMD_AMBIENT` today (no API change needed when it lands).
2. **On-device Telugu accuracy benchmark is device-gated** — not measurable in CI/simulator; see
   Telugu status above.
3. **RAM/latency for the multilingual model over 15s ambient windows is unmeasured** on a real
   device — see RAM/latency notes above.
4. **No speaker diarization within a single ambient recording.** The ambient consult is captured
   from a single mic and wired with a fixed `speaker: "doctor"` for the whole session — the
   deterministic layer's patient-speech gate (`voice-emr-map.js`, tested in `test/voice-emr.test.mjs`)
   only takes effect when a caller explicitly passes `speaker: "patient"` (e.g. a future turn-taking
   UI or a manual toggle), which the ambient consult does not do today. The safety property that
   matters for THIS feature — a patient saying "my BP is 150" can never become a measured vital via
   the LLM path — instead holds structurally: `EMR_FIELD_KEYS` (the opd-scribe whitelist) contains
   **no vital field at all**, so no vital can reach the EMR through the LLM/opd-scribe extract
   regardless of who said it or how the transcript is phrased (verified in
   `test/opd-scribe-extract.test.mjs` and the Telugu/code-switch fixtures). Only the deterministic
   VV+MAP path can fill vitals, and that path is untouched by ambient's single-speaker limitation
   for the numbers it does parse (it fills whatever number was spoken, tagged `source:"voice"` —
   there's no way for it to know the speaker without diarization). Proper doctor/patient
   diarization is future work, not attempted here.
5. **Double end-of-consult refine call** (pre-existing, tracked in the Task 5 report): `stopVoice()`
   still calls `doRefine()` manually right after `_amb.stop()`, and `onRefine` already fires once
   for the final chunk inside `stop()` — so Stop currently runs the refine pass twice. Not a
   correctness bug (suggestions are idempotently overwritten by the second call), just a wasted
   API call; a one-line cleanup for a future pass, left alone here since it's outside Task 6's
   test/report scope and `opd-emr.js` may be touched by other in-flight work.
6. **Grounding engine adapter is not wired to a real differential/investigations engine yet**
   (`opd-emr.js`'s `groundOpts()` returns empty `findings`/`differential`/`investigationsFor` with
   a `ponytail:` comment) — today, `ground()` safely forwards only the LLM's own ddx/investigations
   (tagged `ai`), never fabricating, but doesn't yet add engine-sourced (`source:"engine"`) entries
   in the live app. `voice-scribe-ground.js`'s engine-merge logic is built and tested
   (`test/voice-scribe-ground.test.mjs`) and ready for when a plain `findingKeys -> ddx` adapter is
   exposed by the reasoning engine.

## How to activate

1. Flags: `smd_opd_emr` (opens the OPD profile overlay at all) and `smd_opd_emr_write` (shows the
   Save/Submit buttons) — **both default ON**, no separate flag gates the scribe/ambient voice
   itself; it's active whenever the OPD Assessment tab is open and `SMD_AMBIENT` is loaded (it is,
   unconditionally, via `index.html`'s script tags).
2. Open a patient's **OPD > Assessment** tab (from Ward Sync's patient drawer, or the OPD profile
   directly) and tap the mic in the consultation bar to **Start** the voice consultation.
3. Pick the language toggle: **Auto** (default, recommended for mixed consults), **EN**, or **తె**
   (Telugu) — Auto/Telugu force the multilingual on-device model (first use downloads it, ~57 MB,
   one-time).
4. Talk through the visit normally. Deterministic vitals/exam fields fill live as they're spoken.
   Every 4th 15s chunk (~60s) and again at Stop, the "filled N · N suggestions" readout updates and
   an "AI suggestions" panel (labelled, tagged "Review before use") appears with the provisional
   diagnosis / differential / investigations the LLM extracted — grounded, never auto-written.
5. Tap **Accept** on any individual suggestion row to write it into the assessment's
   provisional-diagnosis field or add it as an investigation-order draft. Everything else stays
   untouched until its own Accept is tapped. Tap **Save to GHIS** as usual to persist the
   assessment.
6. No native rebuild is required to activate this on a build that already has
   `@stewardmd/capacitor-whisper` wired in (iOS/Android both implemented+activated per their
   plugin READMEs) — this feature is a pure web/`www/` layer on top of the existing plugin.

## Test evidence (Task 6)

- `node --test test/opd-scribe-extract.test.mjs test/voice-scribe-ground.test.mjs
  test/opd-scribe-fixtures.test.mjs test/voice-emr.test.mjs test/voice-ambient-scribe.test.mjs
  test/opd-voice.test.mjs` — all green (safety suite + Telugu/English/code-switch fixtures +
  pre-existing regression coverage).
- `node test/run-scribe-ui.mjs` (real headless-Chrome CDP harness, extended this task with
  before/after-refine "nothing auto-written" checks) — all `PASS`.
- Full suite: `npm test` — exit 0, 0 failures.
