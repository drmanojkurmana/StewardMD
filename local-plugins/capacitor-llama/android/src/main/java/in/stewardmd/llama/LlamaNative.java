package in.stewardmd.llama;

/**
 * JNI boundary to llama.cpp (b10502). The native library {@code libllama_jni.so} is built from the
 * vendored llama.cpp submodule + cpp/llama_jni.cpp via CMake/NDK (see build.gradle and
 * src/main/cpp/). If the {@code .so} is missing for the running ABI, {@link #isAvailable()} is
 * false and the engine reports {@code unsupported-architecture} instead of crashing.
 *
 * Mirrors capacitor-whisper's WhisperNative. Every signature here must stay in lockstep with the
 * JNIEXPORT symbols in llama_jni.cpp.
 */
public final class LlamaNative {
    private static final boolean available;

    static {
        boolean ok;
        try {
            System.loadLibrary("llama_jni");
            ok = true;
        } catch (Throwable t) {
            ok = false; // native lib not built/bundled for this ABI
        }
        available = ok;
    }

    private LlamaNative() {}

    /** Streaming sink for {@link #generate}. Called on the generating thread, once per token. */
    public interface TokenSink {
        void onToken(String piece);
    }

    /** True only when libllama_jni.so loaded for this ABI. Guards every native call below. */
    public static boolean isAvailable() {
        return available;
    }

    /** One-time ggml/llama backend init. Idempotent. */
    public static native void initBackend();

    /**
     * Push the OS thermal status down to the decode loop (0 NONE .. 6 SHUTDOWN, PowerManager's own
     * scale). The native side yields between tokens at SEVERE and stops at CRITICAL.
     *
     * Pushed from Java because PowerManager is a Java API; calling back into the JVM from the token
     * loop would cost more than the throttling saves.
     */
    public static native void setThermalStatus(int level);

    /** The token the model expects where an image belongs, e.g. "<__media__>". Comes from mtmd so it
     *  cannot drift from what the projector actually parses. */
    public static native String mediaMarker();

    /**
     * Answer a question about one or more IMAGES, entirely on device.
     *
     * `mmprojPath` is the projector for the SAME pack as the loaded model - nothing native can detect
     * a mismatched pair, it simply answers confident nonsense, so the JS pack registry owns the
     * pairing. `imagePaths` are filesystem paths, never base64: mtmd reads the files itself.
     */
    public static native String generateWithImage(long ctx, long model, String prompt,
                                                 String mmprojPath, String[] imagePaths,
                                                 int nPredict, float temperature, int seed,
                                                 TokenSink callback);

    /**
     * mmap a GGUF from disk into a model handle (0 on failure). Split models named
     * {@code <name>-00001-of-0000N.gguf} are loaded whole from the FIRST shard's path.
     *
     * @param nGpuLayers 0 on Android (no usable offload path); non-zero is reserved for iOS/Metal.
     */
    public static native long loadModel(String modelPath, int nGpuLayers);

    /** Free a model handle from {@link #loadModel}. Safe with 0. */
    public static native void freeModel(long model);

    /**
     * Create an inference context. {@code nCtx} is deliberately small (4096): the KV cache is the
     * dirty allocation that triggers jetsam on an 8 GB phone, and it scales with context.
     */
    public static native long newContext(long model, int nCtx, int nThreads,
                                        int nBatch, int nUbatch, int nThreadsBatch);

    /** Milliseconds the last generate() spent in prefill (-1 if none yet). For tuning sweeps. */
    public static native long lastPrefillMs();

    /** Prompt token count of the last generate() (-1 if none yet). */
    public static native int lastPromptTokens();

    /** Free a context handle from {@link #newContext}. Safe with 0. */
    public static native void freeContext(long ctx);

    /** Ask the in-flight {@link #generate} to stop. Also aborts a long prefill. */
    public static native void cancelGenerate();

    /**
     * Apply the GGUF's own chat template to one system+user turn. Returns null when the model
     * carries no template, in which case the caller should use its raw prompt unchanged.
     */
    public static native String applyChatTemplate(long model, String system, String user);

    /**
     * Generate up to {@code nPredict} tokens, streaming each detokenised piece to
     * {@code sink.onToken} and returning the full text (null on failure).
     *
     * @param temp <= 0 selects a greedy sampler (reproducible answers); > 0 adds top-k/top-p/temp.
     */
    public static native String generate(
        long ctx,
        long model,
        String prompt,
        int nPredict,
        float temp,
        int seed,
        TokenSink sink
    );
}
