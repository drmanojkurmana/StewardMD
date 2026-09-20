# capacitor-whisper — Android

On-device Whisper "Clinical Dictation" for MaiK Scribe, Android side. Mirrors the iOS plugin
(`ios/Sources/WhisperPlugin`) contract 1:1, so `native-bridge.js` / `voice.js` route Clinical
Dictation to Android with **no** JS changes.

## Status: RE-ACTIVATED + VERIFIED ON HARDWARE (2026-08-14)

Was implemented, then the `"android"` capacitor entry was removed from `package.json` (APK-size /
build-time savings) — so `Capacitor.Plugins.Whisper` was absent and Android silently fell back to
device STT. Re-activated 2026-08-14 (owner: on-device Whisper is the Android production ASR target).
**Verified end-to-end on a real Pixel 9 (arm64-v8a):** plugin registered (`available().whisper===true`),
native libs load (`libwhisper_jni.so`+`libwhisper.so`+`libggml*.so`), BASE model (`base-q5_1`, 57 MB)
downloads+SHA-verifies+stores, and native inference RUNS (record → `stopTranscribe` → `whisperFinal`;
a silent clip correctly returns `[BLANK_AUDIO]`, ~6 s inference, start latency ~222 ms). Multilingual
accuracy (English / Telugu / Hindi / code-switch) is the owner's live acceptance test.

- **Java** plugin (`src/main/java/in/stewardmd/whisper/`) — Java, not Kotlin, because the package is
  `in.stewardmd.whisper` and `in` is a reserved word in Kotlin (needs backticks, which Capacitor's
  package parser rejects). Matches the repo's other Android plugins.
  - `WhisperPlugin.java` — Capacitor plugin (`Capacitor.Plugins.Whisper`): methods, events, mic
    permission request.
  - `WhisperEngine.java` — `AudioRecord` 16 kHz mono capture → stop-to-transcribe → `whisperFinal`.
  - `ModelStore.java` / `ModelDownloader.java` — model cache (`files/whisper/`), streamed SHA-256
    verify, download with progress. `WhisperErr` / `WhisperException` mirror iOS error codes 1:1.
  - `WhisperNative.java` — JNI boundary; loads `libwhisper_jni.so`, degrades to
    `unsupported-architecture` (no crash) if the `.so` is missing.
- **Native** (`src/main/cpp/`) — `whisper_jni.cpp` (JNI shim) + `CMakeLists.txt` build against
  **whisper.cpp v1.9.1** (MIT), vendored as a git submodule at `src/main/cpp/whisper-cpp`.
- **Build** — `build.gradle` enables NDK (26.1.10909125) + CMake (3.22.1), ABI `arm64-v8a`.
- **Activated** — `package.json` has the `android` capacitor entry, so `cap sync` wires the module
  into the Gradle project and auto-registers `Capacitor.Plugins.Whisper`. This makes `voice.js`
  `whisperAvailable()` true on Android → the Fast/Clinical selector shows.

## Building
```
npm run sync                 # build:www + cap sync (wires the module + registers the plugin)
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ./gradlew :app:assembleDebug     # compiles Java + builds libwhisper_jni.so (arm64) into the APK
```
Requires the Android NDK `27.2.12479018` (matches `build.gradle` `ndkVersion`; r27+ links the
`.so` with 16 KB-page LOAD alignment, required for Android 15 devices + Play) + CMake `3.22.1`
(install via `sdkmanager "ndk;27.2.12479018" "cmake;3.22.1"`).

**The whisper.cpp submodule must be checked out first:** `git submodule update --init --recursive`
(pinned to v1.9.1 `f049fff`; URL `github.com/ggml-org/whisper.cpp`). If `src/main/cpp/whisper-cpp/`
is empty, CMake's `add_subdirectory(whisper-cpp)` fails, `libwhisper_jni.so` is never produced, and
`WhisperNative.isAvailable()` is false → Clinical Dictation silently falls back. (This was the
gap: the submodule URL previously pointed at the renamed `ggerganov` org.)

## Testing (must be a REAL arm64 device)
Install the APK on a physical arm64 Android phone (x86_64 emulators may not run inference — do not
treat an emulator failure as a code bug):
1. MaiK Scribe → **Clinical** → first use downloads the model (progress %) → speak → stop →
   transcript lands in the editable box.
2. Confirm **no** cloud transcription endpoint is hit (audio stays on-device); only the ggml model
   is fetched from `https://models.stewardmd.in/whisper/…` with the pinned SHA-256 (see
   `native-bridge.js` `WHISPER_MODELS`; **Android defaults to `base-q5_1`, the ~57 MB multilingual
   model, so English + Telugu + code-switch work**; iOS uses `small.en-q5_1`).

## Open items
- **Model host** — RESOLVED: `https://models.stewardmd.in/whisper/` serves the ggml models with
  HTTP range support and the pinned sizes/SHA-256 (verified 2026-08: `ggml-base-q5_1.bin` -> `200`,
  `59,707,625` B, matching `WHISPER_MODELS`). No further hosting work needed.
- On-device compile + arm64 inference latency + the Telugu clinical benchmark still need a **real
  arm64 device** (cannot be validated in CI or on an x86_64 emulator).
- Only `arm64-v8a` is built. Add `x86_64` in `build.gradle` `abiFilters` if emulator inference is
  needed.

## Contract (both platforms)
- Methods: `isModelInstalled({model})`, `downloadModel({model,url,sha256})`, `deleteModel({model})`,
  `startTranscribe({model,language,initialPrompt})`, `stopTranscribe()`, `cancel()`.
- Events: `whisperState{state}`, `whisperPartial{text}`, `whisperFinal{text}`,
  `whisperError{code,message}`, `whisperDownloadProgress{progress}`.

## Continuous capture (BUILT — option (c), flag-gated OFF, not yet device-verified)
`WhisperEngine.java`'s `AudioRecord` capture started as record-then-transcribe: `stopTranscribe()`
stops the recorder and runs whisper.cpp once over the whole buffer, emitting a single `whisperFinal`.
`voice-ambient.js`'s ambient/OPD-scribe controller works around that in JS (still the default): it
calls `stopTranscribe`/`startTranscribe` back-to-back in ~15s windows and stitches the finals together
(`accumulate()`). Each restart briefly closes and reopens the `AudioRecord`, so audio right at a 15s
seam can be clipped (a few hundred ms) — the boundary-gap ceiling of the JS re-arm.

**What now exists: option (c), continuous-record-with-flush** (mirrors the iOS README).
`flushTranscribe()` → `WhisperEngine.flushAndTranscribe(language, initialPrompt)` copies `samples`
under `samplesLock`, clears the list (keeping capacity — the record thread is still filling it) and
runs whisper.cpp on the copy. `AudioRecord` is never stopped or released, so there is no seam.
Inference is submitted to the same single-thread `work` executor as `stopAndTranscribe`, so flushes
and a stop queue rather than racing the one native context. Option (a), the ring buffer, was not
built — with the buffer cleared per flush there is nothing to slide.

**Contract as built**: each flush emits `whisperFlush {text}` — a NEW event, not `whisperPartial`,
because a flushed segment is consumed (appends) while a partial would replace. `whisperFinal` still
fires exactly once, on `stopTranscribe()`, carrying only the tail since the last flush.

`WhisperPlugin.java` registers `flushTranscribe` as the LAST `@PluginMethod` — registration is
positional, so never insert a method among the existing ones. After editing this class, run:
`grep -n "@PluginMethod" -A2 WhisperPlugin.java | grep "public void"` and confirm every pre-existing
method is still listed.

**Consumer**: `SMD_NATIVE.flushWhisper()` / `SMD_NATIVE.whisperCanFlush()` (native-bridge.js) →
`session.flush` (voice.js) → `voice-ambient.js`'s window boundary. Gated on
`localStorage.smd_voice_continuous` — **DEFAULT OFF**; with the flag off, or on an APK built before
this change, the JS re-arm loop runs exactly as before. No `SMD_AMBIENT` API change.

**Still needs validation on a real arm64 device**: mic continuity across a flush, whether CPU-only
inference while recording drops frames, and end-to-end timing (per the "Testing" section above).
