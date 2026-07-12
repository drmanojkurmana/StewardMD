package in.stewardmd.whisper;

/**
 * JNI boundary to whisper.cpp (v1.9.1). The native library {@code libwhisper_jni.so} is built from
 * the vendored whisper.cpp submodule + cpp/whisper_jni.cpp via CMake/NDK (see build.gradle and
 * src/main/cpp/). If the {@code .so} is missing for the running ABI, {@link #isAvailable()} is
 * false and the engine reports {@code unsupported-architecture} instead of crashing.
 */
public final class WhisperNative {
    private static final boolean available;

    static {
        boolean ok;
        try {
            System.loadLibrary("whisper_jni");
            ok = true;
        } catch (Throwable t) {
            ok = false; // native lib not built/bundled for this ABI
        }
        available = ok;
    }

    private WhisperNative() {}

    /** True only when libwhisper_jni.so loaded for this ABI. Guards every native call below. */
    public static boolean isAvailable() {
        return available;
    }

    /** Load a ggml model file → opaque context handle (0 on failure). */
    public static native long initContext(String modelPath, boolean useGpu);

    /** Free a context handle previously returned by {@link #initContext}. Safe with 0. */
    public static native void freeContext(long ctx);

    /**
     * Run whisper_full over a 16 kHz mono float buffer ([-1,1]) and return the joined segment text
     * (null on failure). Decoding config mirrors the iOS engine: beam search, no timestamps,
     * no_context, suppress_blank.
     */
    public static native String fullTranscribe(
        long ctx,
        float[] samples,
        String language,
        String initialPrompt,
        int nThreads,
        int beamSize
    );
}
