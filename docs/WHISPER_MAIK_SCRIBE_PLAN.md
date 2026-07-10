# Whisper "Clinical Dictation" for MaiK Scribe — Implementation Plan

**Status:** PLAN — awaiting approval. No native code written yet.
**Goal:** Add an on-device Whisper "Clinical Dictation" engine as a *second* capture engine for the
existing MaiK Scribe. It produces a better transcript for long/medical dictation, then feeds the
**unchanged** downstream pipeline (transcript → `clinical-nlp.js` normalize → `clinical-vocab.js`
matching → extraction → review → import). Current speech recognition stays the default and the
fallback.

---

## 1. What I verified in the repo (integration points)

| Concern | Fact (file:line) |
|---|---|
| Web build | `capacitor.config.json` `webDir:"www"`; `scripts/build-www.sh` copies root `*.js/*.css/html` → `www/` (does **not** touch `local-plugins/`). `index.html` cache-busts each script `?v=gold###`. |
| Local-plugin wiring (iOS) | `ios/App/CapApp-SPM/Package.swift` (CLI-managed) already lists 3 local plugins via `.package(path: "../../../local-plugins/…")`. `npx cap sync` regenerates it from root `package.json` + each plugin's `Package.swift`. Template to copy: `local-plugins/capacitor-vision-ocr` (StewardMD-authored, SPM `ios/Sources/…` layout). |
| Local-plugin wiring (npm) | root `package.json` deps: `"@capacitor-community/speech-recognition":"file:local-plugins/…"`. New plugin registered the same way. |
| JS bridge | `native-bridge.js` → `window.SMD_NATIVE`. `transcribe()` is the STT method (iOS-only gate `isIOS`, session-token pattern, `onPartial/onFinal/onError`, `stopTranscribe()`). Plugins reached via `Capacitor.Plugins.<Name>` (e.g. `VisionOcr.detectText`). |
| Voice controller | `voice.js` → `window.SMD_VOICE = { listen, stop, openDialog, available }`. `listen()` tries native → Web Speech → **aistt** (getUserMedia+MediaRecorder → `/api/ai/transcribe`). `available()` returns `{native, webspeech, aistt}`. |
| **MaiK Scribe UI** | The single shared sheet is `voice.js openDialog()` (`.smdv-sheet`, button `#smdvRec`). **All 3 entry points call `openDialog()`:** `home.js:1550` (`target:"text"`), `reasoning.js:1072` (`target:"reasoning"`), `icu.js:4120` (`target:"icu"`). → the Fast/Clinical selector goes in **one place**. |
| Downstream (DO NOT CHANGE) | `clinical-nlp.js` (`window.SMD_NLP`, `ABBREV` @20), `clinical-vocab.js` (`window.SMD_VOCAB`), app.js brand map (`piptaz→[piperacillin,tazobactam]`, etc.). |
| Flag convention | `localStorage "smd_ai"` (reasoning.js:3539/3676). New flag: `smd_whisper_clinical_dictation`. |
| Model host | None exists today. Need a StewardMD-owned host (see §Decisions). |
| Permissions | Already declared (iOS mic + speech; Android `RECORD_AUDIO`). No edits. |
| Filesystem | `@capacitor/filesystem ^8.1.2` present (model cache). |

**Design consequence:** Fast Dictation = today's `listen()` engines exactly. Clinical Dictation = a
**separate** engine that never touches the SFSpeech plugin, the Android Web Speech path, or the
`aistt` path. When the flag is off or the plugin/model is unavailable, behaviour is byte-for-byte
today's.

---

## 2. Architecture

```
MaiK Scribe sheet (voice.js openDialog)
  └─ Fast/Clinical selector  [shown only when flag ON]
        Fast    → SMD_VOICE.listen({engine:"fast"})   → (unchanged) native SFSpeech / Web Speech / aistt
        Clinical→ SMD_VOICE.listen({engine:"clinical"})→ SMD_NATIVE.transcribeWhisper()
                                                            └─ Capacitor.Plugins.Whisper  (NEW local plugin)
                                                                 iOS: whisper.cpp XCFramework + AVAudioEngine
                                                                 Android: whisper.cpp JNI/NDK + AudioRecord
  → transcript (final) → (UNCHANGED) SMD_NLP normalize + SMD_VOCAB match + brand map → review → import
```

V1 scope: **stop-to-transcribe** (record short chunk → stop → transcribe → final). No continuous
dictation, no guaranteed live partials. The sheet already handles final-only (`onFinal` at
`voice.js:149`), so all 3 entry points work without waiting on `onPartial`.

---

## 3. New local Capacitor plugin — `local-plugins/capacitor-whisper/`

npm name `@stewardmd/capacitor-whisper` → SPM package `StewardmdCapacitorWhisper` (matches the
vision-ocr/app-orientation naming so `cap sync` auto-wires it). Registered in root `package.json`
as `"file:local-plugins/capacitor-whisper"`.

Files (mirrors vision-ocr + speech-recognition):
```
local-plugins/capacitor-whisper/
  package.json                 (capacitor block, MIT, peerDep @capacitor/core >=8)
  Package.swift                (SPM; links WhisperFramework XCFramework)
  StewardmdCapacitorWhisper.podspec
  dist/…                       (prebuilt esm/cjs JS API — same buildless dist pattern as the fork)
  ios/Sources/WhisperPlugin/
      WhisperPlugin.swift      (CAPBridgedPlugin: methods + events)
      WhisperEngine.swift      (AVAudioEngine capture → 16k mono PCM; whisper.cpp inference off-main)
  ios/Frameworks/whisper.xcframework   (prebuilt, pinned whisper.cpp release)
  android/build.gradle         (NDK/CMake; arm64-v8a first)
  android/src/main/java/in/stewardmd/whisper/WhisperPlugin.kt
  android/src/main/java/in/stewardmd/whisper/WhisperEngine.kt   (AudioRecord → PCM → JNI)
  android/src/main/cpp/ (whisper.cpp sources + CMakeLists.txt + JNI shim)
```

### Native API surface (both platforms)
- `isModelInstalled({model}) → {installed, path?, bytes?}`
- `downloadModel({model, url, sha256}) → {path}` — streams to filesystem, emits `whisperDownloadProgress`, verifies SHA-256, atomic rename on success.
- `deleteModel({model}) → {ok}`
- `startTranscribe({model, language, initialPrompt}) → {ok}` — mic capture; emits `whisperState` (`listening|transcribing|done`) and (if feasible) `whisperPartial`.
- `stopTranscribe() → {ok}` — stop recording → run inference → emit `whisperFinal {text}`.
- `cancel() → {ok}` — abort, drop buffers, release resources.
- Events: `whisperState`, `whisperPartial?`, `whisperFinal`, `whisperError {code}`, `whisperDownloadProgress {pct}`.

### iOS specifics
Swift + whisper.cpp as an **XCFramework** (pinned release). `AVAudioEngine` tap → resample to 16 kHz
mono Float PCM → whisper.cpp on a background queue. **Must save the current `AVAudioSession`
category/mode/options before configuring for record and restore them on stop/cancel/error**, so the
existing SFSpeech Fast path is not left with a changed session. Model dir: `Directory.Library`
(`Library/whisper/`, excluded from iCloud backup via `NSURLIsExcludedFromBackupKey`).

### Android specifics
Kotlin + whisper.cpp via **JNI/NDK (CMake)**. `AudioRecord` (16 kHz mono PCM) → JNI inference on a
worker thread. **`arm64-v8a` first**; document that `x86_64`/`armeabi-v7a` may lack the `.so` and
that x86_64 **emulators may not run inference** (real arm64 device for testing). A **separate**
engine — the `SpeechRecognizer` fork is untouched; Android Fast Dictation still uses Web Speech.
Model dir: `Directory.Data` (`files/whisper/`, not backed up).

---

## 4. Model strategy
- Default **`ggml-base` multilingual q5_1 (~57 MB)**; optional **`ggml-tiny` q5_1** for low-end.
  No small/large. **Not bundled** in the app install.
- Downloaded **only** when the user first enables Clinical Dictation. Progress % shown; retry on
  failure. Stored via `@capacitor/filesystem` in a **non-synced/non-backed-up** dir (see §3).
- Hosted on a **StewardMD-owned, license-clean** source (Cloudflare R2 / our host) — **not** a
  runtime hotlink to a third party. **Pinned SHA-256** verified before first use; mismatch ⇒
  "model corrupted" → offer re-download.
- Delete: only if a suitable existing dev/settings area exists (do **not** build a new settings
  screen). Otherwise expose delete via the dev-flag area only.

---

## 5. JS changes (go through build:www + `?v=` bump + cap sync)

**`native-bridge.js`** — add `SMD_NATIVE.transcribeWhisper({ language, model, initialPrompt,
onPartial, onFinal, onError, onStateChange, onDownloadProgress })`:
- gate on `native` + `Capacitor.Plugins.Whisper` present (NOT iOS-only); throw synchronously if
  absent (so voice.js can offer Fast).
- flow: `isModelInstalled` → if missing, `downloadModel` (progress) → `startTranscribe`;
  `stopTranscribe`/`cancel`; wire the plugin events to the callbacks. **Never** touches cloud.
- session-token guard like `transcribe()`; release listeners each session.

**`voice.js`**:
- `available()` adds `whisper: !!(SMD_NATIVE && SMD_NATIVE.transcribeWhisper) && flagOn`.
- `listen({engine})`: `engine:"fast"` (or absent) = today's path **unchanged**; `engine:"clinical"`
  = Whisper first. If model missing → download prompt in the sheet; if Whisper errors → show
  *"Clinical Dictation unavailable. Use Fast Dictation instead?"*. **Never** auto-cloud.

**`whisper-vocab.js` (new, tiny) or a helper in voice.js** — `buildInitialPrompt()`:
assembles the Whisper `initial_prompt` from **existing** globals only (no new dictionary). Verified
sources:
- `window.SMD_VOCAB` — clinical finding labels + `syn` (has creatinine, "low sats", oedema, etc.).
- `window.MEDDRUGS` (drugs.js / app.js) — the drug **brand map**: generics + brand keys
  (piptaz→piperacillin-tazobactam, meropenem, cefoperazone-sulbactam, norepinephrine, …).
- `antibiogram-data.js` organism + antibiotic names (E coli, Klebsiella, ceftriaxone, amikacin).
- `clinical-nlp.js` medical abbreviations — **note:** `SMD_NLP` currently exposes only
  `{extract, normalize, _version}` (verified `clinical-nlp.js:173`). The bias helper needs a **tiny
  additive export** (e.g. `API.terms` / `API.abbrev`) — additive only, changes no behavior.
- **IMPORTANT constraint (verified):** whisper.cpp `initial_prompt` is token-capped (~`n_text_ctx/2`
  ≈ 224 tokens). The helper must **curate + cap** — prioritise the target terms below and the
  highest-yield drug/organism/finding names, not dump the whole vocab (which would be truncated and
  could hurt accuracy).

Target terms to guarantee: pip taz / piptaz / piperacillin-tazobactam, meropenem,
cefoperazone-sulbactam, creat/creatinine, sats/SpO2, E coli, Klebsiella, AKI, CKD, q8h/q12h,
norepinephrine, vasopressor. After Whisper returns text it passes through the **same** SMD_NLP
normalize + SMD_VOCAB match + MEDDRUGS brand map — no downstream change.

**`index.html`** — bump `?v=gold###` on every changed root JS. **`sw.js`** CACHE bump.

---

## 6. MaiK Scribe UI (minimal, inside the sheet only)
- Flag `smd_whisper_clinical_dictation` OFF in prod; enableable in dev. Whisper UI shows only when on.
- A small **Fast | Clinical** segmented toggle in `openDialog()` (reuses `.smdv-kind` pill styling).
  **Fast is default.** Selecting Clinical routes `listen({engine:"clinical"})`.
- States: "Listening…" while recording, "Transcribing…" after stop, disable duplicate start while
  active, download-progress row when fetching the model.
- The transcript lands in the existing editable `#smdvTa` for doctor review before extract/import —
  never silently replaces words.

---

## 7. Error states (simple user text; dev logs carry NO audio/transcript/PHI)
mic permission denied · model download failed · insufficient storage · unsupported architecture ·
low memory · recording failure · transcription failure · user cancelled · model corrupted/missing.

## 8. Privacy
Raw audio in memory only; buffers released immediately post-transcription; audio never persisted,
never logged; **no** audio/transcript/PHI to any cloud (Whisper is 100% on-device; only the ggml
**model file** is downloaded, from our host). A test asserts no cloud transcription endpoint is hit.

---

## 9. Delivery (separate commits/PRs, in order)
- **(a)** Plugin scaffold + JS API + iOS: model download + SHA-256 + AVAudioEngine capture + whisper.cpp inference (+ AVAudioSession save/restore).
- **(b)** Android: NDK/JNI inference + AudioRecord (arm64-v8a).
- **(c)** `native-bridge.js transcribeWhisper` + `voice.js` engine routing + feature flag.
- **(d)** MaiK Fast/Clinical selector + `buildInitialPrompt` vocab biasing.
- **(e)** Tests.
Each web-file change: `npm run build:www` → bump `?v=` (index.html) + `sw.js` CACHE → `npx cap sync`;
verify iOS, Android, and web/PWA still build.

## 10. Tests (automated where possible)
1) flag off ⇒ Fast unchanged; 2) flag on + model absent ⇒ download prompt; 3) model present ⇒
Clinical starts; 4) Whisper error ⇒ Fast fallback offered; 5) **no cloud transcription endpoint**
called (assert over CapacitorHttp + fetch); 6) transcript passes through SMD_NLP/SMD_VOCAB/brand
map; 7) no raw audio written to persistent storage; 8) duplicate start prevented; 9) stop/cancel
releases resources; 10) model cache path valid + checksum enforced. Manual: the 5 clinical phrases
on a real iPhone + arm64 Android, offline after download.

## 11. Rollback
Flag OFF ⇒ Whisper UI/engine vanish, app identical to today. Full removal: revert commits (a–e),
`npm run build:www` + cap sync. The plugin is additive (new SPM/gradle package) — removing its
`package.json` entry + running `cap sync` de-links it.

## 12. Licenses to document
whisper.cpp (MIT) + ggml model license notices (OpenAI Whisper MIT) in `docs/` and plugin README.

---

## DECISIONS I NEED FROM YOU (before native code)
1. **whisper.cpp binary strategy** — recommended: pin a whisper.cpp release and **commit a prebuilt
   `whisper.xcframework` (iOS)** + build the Android `.so` from vendored sources via NDK/CMake at
   build time. Alternative: build both from source in CI. (Committing the iOS XCFramework adds a few
   MB to the repo but makes iOS builds reproducible without an extra toolchain.) OK to commit the
   prebuilt iOS XCFramework?
2. **Model host** — I'll serve `ggml-base-q5_1.bin` (+ optional tiny) from a StewardMD-owned URL with
   a pinned SHA-256. Do you want it on **Cloudflare R2 with a custom domain** (e.g.
   `https://models.stewardmd.in/…`) or routed through the **existing Pages/Worker** (e.g.
   `https://stewardmd.in/models/…`)? I need the bucket/route provisioned (or your OK to set it up).
3. **Branching** — this repo is currently on `feat/unit-registry` (an unrelated, committed feature).
   I'll create a fresh branch off `main` for the Whisper work. Confirm that's the target.

**Stopping here for your approval — no native code will be written until you confirm the above.**
