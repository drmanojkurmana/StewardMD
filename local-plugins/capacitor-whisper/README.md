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

## Continuous capture upgrade path (device-gated, not yet built)
Today's plugin is **record-then-transcribe**: `startTranscribe` records, `stopTranscribe` stops the
mic and runs one inference pass, firing `whisperFinal` once. `whisperPartial` is reserved but never
emitted. `voice-ambient.js`'s ambient/OPD-scribe controller works around this in JS today (option
**b**, shipped): it calls `stopTranscribe`/`startTranscribe` back-to-back in ~15s windows and stitches
the per-window finals into one transcript (`accumulate()` in `voice-ambient.js`). That re-arm has a
real ceiling — the mic is briefly closed and reopened at every window boundary, so audio spanning the
seam (a few hundred ms) can be clipped.

The fix is **native continuous capture**, either:
- **(a) Ring buffer** — keep `AVAudioEngine`/`AudioRecord` running continuously; every ~15s, hand the
  whisper.cpp context the last N seconds of PCM (a sliding/ring buffer) without ever stopping the mic.
- **(c) Continuous-record-with-flush** — keep recording into one buffer for the whole session; every
  ~15s, run inference on the buffer accumulated so far (or the new tail) and flush, without closing
  the audio session between windows.

**Contract for either**: emit `whisperPartial {text}` once per ~15s window *while recording
continues* (no `stopTranscribe`/`startTranscribe` round trip), and still emit one `whisperFinal` when
the caller actually calls `stopTranscribe`. `voice-ambient.js` already consumes `whisperPartial` via
`onPartial` (currently a no-op in practice since it's never fired) — wiring this in would let the JS
re-arm loop go away with no `SMD_AMBIENT` API change. Needs a **real device** to validate (mic
continuity + inference timing can't be verified on a simulator/emulator).

## Licenses
MIT (this plugin). Links whisper.cpp (MIT, ggml authors). ggml Whisper models are MIT
(OpenAI Whisper) — redistribution/mirroring permitted; notice retained in `LICENSE`.
