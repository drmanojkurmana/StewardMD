# @stewardmd/capacitor-whisper

On-device Whisper (whisper.cpp) speech-to-text for MaiK Scribe **Clinical Dictation**. Audio is
captured, resampled to 16 kHz mono and transcribed **entirely on the device** (Metal + CPU);
nothing is uploaded. Only the ggml **model** is downloaded once, from a StewardMD-hosted mirror
with a pinned SHA-256. Fully offline after that. This is a **separate** engine from the existing
`@capacitor-community/speech-recognition` (Fast Dictation) — that plugin is untouched.

Accessed from JS as `Capacitor.Plugins.Whisper` (no JS dist, same pattern as `capacitor-vision-ocr`).

## Status
- **iOS: implemented** (this commit) — SPM + prebuilt whisper.cpp v1.9.1 XCFramework.
- **Android: not yet** — lands in a later commit (NDK/JNI, arm64-v8a, NDK r28+ for 16 KB page size).

## iOS build — one decision required first

The pinned binary is the official prebuilt `whisper-v1.9.1-xcframework.zip`, whose **minimum
deployment target is iOS 16.4**. The app currently targets **iOS 15.0**. Choose one:

1. **Raise the app to iOS 16.4** — set `IPHONEOS_DEPLOYMENT_TARGET = 16.4` in
   `ios/App/App.xcodeproj/project.pbxproj` (all configs). Simplest; drops iOS 15–16.3 devices.
2. **Keep iOS 15.0, build a custom XCFramework** — clone whisper.cpp `v1.9.1`, edit
   `build-xcframework.sh` (`IOS_MIN_OS_VERSION=15.0`), run it, host the resulting zip on our R2,
   then repoint `Package.swift`'s `binaryTarget` `url` + `checksum` (`swift package compute-checksum`).

`Package.swift` currently declares `platforms: [.iOS("16.4")]` and pins:
- url: `…/releases/download/v1.9.1/whisper-v1.9.1-xcframework.zip`
- checksum: `8c3ecbe73f48b0cb9318fc3058264f951ab336fd530e82c4ccdd2298d1311a4c`
  (verified `swift package compute-checksum`; recompute if you re-host).

## Wiring into the app (after the decision above)
1. Add to the repo-root `package.json` dependencies:
   `"@stewardmd/capacitor-whisper": "file:local-plugins/capacitor-whisper"`
2. `npm install` then `npx cap sync ios` — regenerates `ios/App/CapApp-SPM/Package.swift` to add the
   local package (adds `StewardmdCapacitorWhisper`). Metal-accelerated, no CocoaPods.
3. Open Xcode; if the plugin product doesn't appear, see ionic-team/capacitor issue **#8325**
   (SPM plugin-product exposure) — resolve packages / clean build folder.
4. First real device build: mic permission strings already exist in `Info.plist`.

## JS API (native returns Promises; results/finals also arrive as events)
```
Whisper.isModelInstalled({ model })                          -> { installed, path?, bytes }
Whisper.downloadModel({ model, url, sha256 })                -> { path }   (+ 'whisperDownloadProgress' {progress})
Whisper.deleteModel({ model })                               -> { ok }
Whisper.startTranscribe({ model, language?, initialPrompt? })-> { ok }     (+ 'whisperState' {state})
Whisper.stopTranscribe()                                     -> { ok }     (final via 'whisperFinal' {text})
Whisper.cancel()                                             -> { ok }
```
Events: `whisperState` (`listening|transcribing|done|idle`), `whisperPartial` (reserved; v1 is
final-only), `whisperFinal` `{text}`, `whisperError` `{code,message}`, `whisperDownloadProgress`
`{progress 0..1}`. Error codes: `mic-permission-denied`, `model-download-failed`,
`insufficient-storage`, `unsupported-architecture`, `low-memory`, `recording-failure`,
`transcription-failure`, `user-cancelled`, `model-corrupted`, `model-missing`.

`model` is a key like `base-q5_1` (stored as `ggml-base-q5_1.bin` in Application Support/whisper,
excluded from backup). Default model: Whisper **base multilingual q5_1** (~59.7 MB); optional
**tiny q5_1** (~32.2 MB). Models are downloaded from a StewardMD R2/Pages mirror (host TBD), never
hotlinked, and the SHA-256 is verified before first load.

## Privacy
Raw audio stays in memory only (`WhisperEngine.samples`), is released immediately after inference,
is never written to disk and never logged. No audio or transcript ever leaves the device. The
plugin makes exactly one network call type: downloading the model file from the pinned URL.

## AVAudioSession
`WhisperEngine` saves the shared session's `category`/`mode`/`options` before recording and restores
them on stop/cancel, so the existing SFSpeech (Fast Dictation) path is unaffected afterwards.

## Continuous capture (BUILT — option (c), flag-gated OFF, not yet device-verified)
The plugin's original mode is **record-then-transcribe**: `startTranscribe` records, `stopTranscribe`
stops the mic and runs one inference pass, firing `whisperFinal` once. `voice-ambient.js`'s
ambient/OPD-scribe controller works around that in JS (option **b**, still the default): it calls
`stopTranscribe`/`startTranscribe` back-to-back in ~15s windows and stitches the per-window finals
into one transcript (`accumulate()`). That re-arm has a real ceiling — the mic is briefly closed and
reopened at every window boundary, so audio spanning the seam (a few hundred ms) can be clipped.

**What now exists: option (c), continuous-record-with-flush.**
`flushTranscribe()` transcribes everything captured so far and leaves the mic recording:
`WhisperEngine.flushAndTranscribe(language:initialPrompt:)` snapshots `samples` under `sampleLock`,
clears them (so the next flush only sees new audio) and runs `whisper_full` on the snapshot while the
`AVAudioEngine` tap keeps appending. No `AVAudioSession` teardown, no re-arm, no seam. Inference runs
on the same serial `work` queue as `stopAndTranscribe`, so overlapping flushes (and a stop landing on
top of one) queue instead of racing the single `whisper_context`.

**Contract as built**: each flush emits `whisperFlush {text}` — a NEW event, deliberately not
`whisperPartial`: a flushed segment is *consumed* (the buffer is cleared), so it appends, whereas a
partial would replace. `whisperFinal` still fires exactly once, when the caller calls
`stopTranscribe`, carrying only the tail captured since the last flush. The flushed session uses the
language/prompt given to `startTranscribe`. Option (a), the ring buffer, was not built — with the
buffer cleared per flush there is nothing to slide.

**Consumer**: `native-bridge.js` exposes `SMD_NATIVE.flushWhisper()` + `SMD_NATIVE.whisperCanFlush()`
(presence of `flushTranscribe` on the plugin proxy), `voice.js listen()` surfaces it as
`session.flush` when available, and `voice-ambient.js` calls it at a window boundary instead of
`stop()`. Gated on `localStorage.smd_voice_continuous` — **DEFAULT OFF**; with the flag off, or on any
app binary built before this change, the JS re-arm loop runs exactly as before. No `SMD_AMBIENT` API
change. Trade-off: one session means ONE model for the whole consult, so Auto's per-chunk model
re-routing does not apply on this path (the first-chunk language probe routes up front instead).

**Still needs a real device**: mic continuity across a flush, whether inference during recording drops
frames on a busy phone, and end-to-end timing cannot be verified on a simulator/emulator.

## Licenses
MIT (this plugin). Links whisper.cpp (MIT, ggml authors). ggml Whisper models are MIT
(OpenAI Whisper) — redistribution/mirroring permitted; notice retained in `LICENSE`.
