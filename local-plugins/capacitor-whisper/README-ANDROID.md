# capacitor-whisper — Android

On-device Whisper "Clinical Dictation" for MaiK Scribe, Android side. Mirrors the iOS plugin
(`ios/Sources/WhisperPlugin`) contract 1:1 so `native-bridge.js` / `voice.js` need **no** changes
to route Clinical Dictation to Android once this is activated.

## Status: SCAFFOLD — Kotlin + Gradle done, native (C++/NDK) DEFERRED

**Done (this scaffold):**
- `src/main/java/in/stewardmd/whisper/`
  - `WhisperPlugin.kt` — Capacitor plugin (`Capacitor.Plugins.Whisper`): methods + events + mic
    permission request. Matches iOS `WhisperPlugin.swift`.
  - `WhisperEngine.kt` — `AudioRecord` 16 kHz mono capture → stop-to-transcribe → `whisperFinal`.
    Matches iOS `WhisperEngine.swift`.
  - `ModelStore.kt` — model cache (`files/whisper/`), streamed SHA-256 verify, download w/ progress.
    Matches iOS `ModelStore.swift` (incl. `WhisperErr` codes 1:1).
  - `WhisperNative.kt` — the stable Kotlin↔native JNI boundary. Loads `libwhisper_jni.so`;
    degrades to `unsupported-architecture` (no crash) until the `.so` exists.
- `build.gradle` — Kotlin/Capacitor library module (NDK/CMake block present but **commented**).
- `src/main/cpp/` — `CMakeLists.txt` + `whisper_jni.cpp` **reference skeletons** (not compiled).

**Deferred (needs the Android NDK + a real arm64 device — see plan §9b / §3 "Android specifics"):**
1. Vendor whisper.cpp v1.9.1 (MIT) as a git submodule:
   ```
   git submodule add https://github.com/ggerganov/whisper.cpp \
       local-plugins/capacitor-whisper/android/src/main/cpp/whisper-cpp
   (cd local-plugins/capacitor-whisper/android/src/main/cpp/whisper-cpp && git checkout v1.9.1)
   ```
2. Fill in `src/main/cpp/whisper_jni.cpp` (the commented bodies are the exact impl) and enable the
   `add_library(whisper_jni ...)`/`target_link_libraries` lines in `CMakeLists.txt`.
3. Uncomment the `ndk { abiFilters 'arm64-v8a' }` + `externalNativeBuild` blocks in `build.gradle`.
4. Install the NDK + CMake (`sdkmanager "ndk;26.x" "cmake;3.22.1"`).

## Activation (turn Clinical Dictation ON for Android) — do this LAST, atomically

⚠️ **Until every step below is done, leave this plugin UNREGISTERED.** The JS gate
`whisperAvailable()` (voice.js) keys on `Capacitor.Plugins.Whisper` being present. If the plugin
registers before the native `.so` works, the Clinical button re-appears on Android and every tap
fails with "Clinical Dictation unavailable" — the exact bug the current gate avoids.

1. Complete the "Deferred" native steps above; build & confirm `libwhisper_jni.so` (arm64-v8a) is
   produced.
2. Add the Android entry to **`local-plugins/capacitor-whisper/package.json`**:
   ```json
   "capacitor": { "ios": { "src": "ios" }, "android": { "src": "android" } }
   ```
   and add `"android/src"`, `"android/build.gradle"` to the `files` array.
3. `npm run sync` (build:www + `npx cap sync`) — this wires the module into
   `android/capacitor.settings.gradle` + `capacitor.build.gradle` and adds it to
   `capacitor.plugins.json` for auto-registration.
4. Verify on a **real arm64 device**: MaiK Scribe → Clinical → first use downloads the model
   (progress %) → speak → stop → transcript lands in the editable box. x86_64 emulators may not run
   inference — do not treat an emulator failure as a code bug.
5. Confirm no cloud transcription endpoint is hit (audio stays on-device); only the ggml model is
   fetched from `https://models.stewardmd.in/whisper/…` with the pinned SHA-256 (see
   `native-bridge.js` `WHISPER_MODELS`).

## Contract (both platforms)
- Methods: `isModelInstalled({model})`, `downloadModel({model,url,sha256})`, `deleteModel({model})`,
  `startTranscribe({model,language,initialPrompt})`, `stopTranscribe()`, `cancel()`.
- Events: `whisperState{state}`, `whisperPartial{text}`, `whisperFinal{text}`,
  `whisperError{code,message}`, `whisperDownloadProgress{progress}`.
