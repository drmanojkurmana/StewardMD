# capacitor-whisper — Android

On-device Whisper "Clinical Dictation" for MaiK Scribe, Android side. Mirrors the iOS plugin
(`ios/Sources/WhisperPlugin`) contract 1:1, so `native-bridge.js` / `voice.js` route Clinical
Dictation to Android with **no** JS changes.

## Status: IMPLEMENTED + ACTIVATED

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
Requires the Android NDK `26.1.10909125` + CMake `3.22.1` (install via
`sdkmanager "ndk;26.1.10909125" "cmake;3.22.1"`).

The submodule must be present: `git submodule update --init --recursive`.

## Testing (must be a REAL arm64 device)
Install the APK on a physical arm64 Android phone (x86_64 emulators may not run inference — do not
treat an emulator failure as a code bug):
1. MaiK Scribe → **Clinical** → first use downloads the model (progress %) → speak → stop →
   transcript lands in the editable box.
2. Confirm **no** cloud transcription endpoint is hit (audio stays on-device); only the ggml model
   is fetched from `https://models.stewardmd.in/whisper/…` with the pinned SHA-256 (see
   `native-bridge.js` `WHISPER_MODELS` — default `small.en-q5_1`, ~181 MB).

## Open items
- **Model host** — `native-bridge.js` points at `https://models.stewardmd.in/whisper/` (marked TODO
  there). That host must actually serve `ggml-small.en-q5_1.bin` etc. with the pinned SHA-256 before
  Clinical works end-to-end on a device (see `docs/WHISPER_MODEL_HOSTING.md`).
- Only `arm64-v8a` is built. Add `x86_64` in `build.gradle` `abiFilters` if emulator inference is
  needed.

## Contract (both platforms)
- Methods: `isModelInstalled({model})`, `downloadModel({model,url,sha256})`, `deleteModel({model})`,
  `startTranscribe({model,language,initialPrompt})`, `stopTranscribe()`, `cancel()`.
- Events: `whisperState{state}`, `whisperPartial{text}`, `whisperFinal{text}`,
  `whisperError{code,message}`, `whisperDownloadProgress{progress}`.
