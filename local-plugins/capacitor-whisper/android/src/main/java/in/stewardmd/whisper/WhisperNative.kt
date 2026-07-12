package `in`.stewardmd.whisper

/**
 * JNI boundary to whisper.cpp.
 *
 * The native library `whisper_jni` is built from the vendored whisper.cpp sources plus
 * cpp/whisper_jni.cpp via CMake/NDK — see android/src/main/cpp/ and README-ANDROID.md.
 *
 * ── DEFERRED (plan §9b) ──────────────────────────────────────────────────────────────────────
 * The C++/CMake half is intentionally NOT wired into the Gradle build yet. This file defines the
 * STABLE Kotlin↔native interface the engine calls, so turning the native side on is purely
 * additive. Until the `.so` ships for the running ABI, [available] is false and the engine reports
 * `unsupported-architecture` instead of crashing (System.loadLibrary throws, caught below).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
object WhisperNative {
    /** True only when libwhisper_jni.so loaded for this ABI. Guards every native call below. */
    @Volatile
    var available: Boolean = false
        private set

    init {
        available = try {
            System.loadLibrary("whisper_jni")
            true
        } catch (t: Throwable) {
            false // native lib not built/bundled for this ABI yet — engine degrades gracefully
        }
    }

    /** Load a ggml model file → opaque context handle (0 on failure). `useGpu` maps to whisper GPU. */
    external fun initContext(modelPath: String, useGpu: Boolean): Long

    /** Free a context handle previously returned by [initContext]. Safe to call with 0. */
    external fun freeContext(ctx: Long)

    /**
     * Run whisper_full over a 16 kHz mono float buffer ([-1,1]) and return the joined segment text
     * (null on failure). Decoding config mirrors the iOS engine: beam search, no timestamps,
     * no_context, suppress_blank.
     */
    external fun fullTranscribe(
        ctx: Long,
        samples: FloatArray,
        language: String,
        initialPrompt: String,
        nThreads: Int,
        beamSize: Int
    ): String?
}
